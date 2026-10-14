import { isAbsolute, join } from 'node:path';
import {
  createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';

const LOCAL_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'find', 'grep', 'ls', 'powershell']);
const keyOf = (model) => `${model.provider}/${model.modelId ?? model.id}`;
const deny = (message) => { throw new Error(message); };

function abortable(operation, signal) {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve().then(operation);
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    // Both handlers remain attached after an abort, consuming late resolution
    // and rejection from a credential implementation that ignores its signal.
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

/** This loader performs no filesystem discovery, including during reload. */
export class ControlledResourceLoader {
  #extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  #prompt;
  #skills;

  constructor({ systemPrompt, fixedSkills = [] }) {
    if (!systemPrompt?.trim()) deny('A platform system prompt is required');
    this.#prompt = systemPrompt;
    this.#skills = fixedSkills.map(({ name, content }) => {
      if (!/^[a-z0-9-]+$/.test(name) || !content?.trim()) deny('Invalid platform skill');
      return `Platform skill: ${name}\n${content}`;
    });
  }

  getExtensions() { return this.#extensions; }
  getSkills() { return { skills: [], diagnostics: [] }; }
  getPrompts() { return { prompts: [], diagnostics: [] }; }
  getThemes() { return { themes: [], diagnostics: [] }; }
  getAgentsFiles() { return { agentsFiles: [] }; }
  getSystemPrompt() { return this.#prompt; }
  getSystemPromptSource() { return undefined; }
  getAppendSystemPrompt() { return [...this.#skills]; }
  getAppendSystemPromptSources() { return []; }
  extendResources(paths) {
    if (Object.values(paths).some((value) => value?.length)) deny('Resource discovery is disabled');
  }
  async reload() { /* Fixed in-memory platform resources remain unchanged. */ }
}

/**
 * Create the Pi model adapter without global auth, models.json, catalog caches,
 * or network discovery. Provider definitions and model policy are trusted
 * platform release inputs; never populate them from project files.
 */
async function controlledModels({ allowedModels, providerDefinitions = [], resolveCredential, onProviderResponse, onProviderPayload, providerFetch, getHostSignal }) {
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) deny('At least one allowed model is required');
  if (typeof resolveCredential !== 'function') deny('An injected credential resolver is required');
  if (onProviderPayload !== undefined && typeof onProviderPayload !== 'function') deny('Invalid platform payload policy');
  if (providerFetch !== undefined && typeof providerFetch !== 'function') deny('Invalid platform provider transport');
  const emptyCredentials = {
    async read() { return undefined; },
    async list() { return []; },
    async modify() { deny('Credential mutation is disabled'); },
    async delete() { deny('Credential mutation is disabled'); },
  };
  const runtime = await ModelRuntime.create({
    credentials: emptyCredentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  for (const { provider, config } of providerDefinitions) runtime.registerProvider(provider, config);
  const models = new Map();
  for (const ref of allowedModels) {
    const model = runtime.getModel(ref.provider, ref.id);
    if (!model || models.has(keyOf(model))) deny('Unknown or duplicate allowed model');
    models.set(keyOf(model), model);
  }
  const allowedProviders = new Set([...models.values()].map((model) => model.provider));
  const canonical = (ref) => models.get(keyOf(ref)) ?? deny('Model is not allowed');
  const requestSignal = (signal) => {
    const hostSignal = getHostSignal();
    return signal && hostSignal ? AbortSignal.any([signal, hostSignal]) : hostSignal ?? signal;
  };
  const credential = async (provider, signal) => {
    if (!allowedProviders.has(provider)) deny('Provider is not allowed');
    signal = requestSignal(signal);
    signal?.throwIfAborted();
    const value = await abortable(() => resolveCredential(provider, { signal }), signal);
    signal?.throwIfAborted();
    if (typeof value !== 'string' || !value.trim()) deny('Injected provider credential is unavailable');
    return value;
  };
  const visible = (provider) => [...models.values()].filter((model) => !provider || model.provider === provider);
  const facade = new Proxy(runtime, {
    get(target, name) {
      if (name === 'getModels' || name === 'getAvailableSnapshot') return visible;
      if (name === 'getModel') return (provider, id) => models.get(`${provider}/${id}`);
      if (name === 'getAvailable') return async (provider) => visible(provider);
      if (name === 'hasConfiguredAuth') return () => false;
      if (name === 'isUsingOAuth' || name === 'isUsingSubscription') return () => false;
      if (name === 'checkAuth') return async (provider, options) => {
        await credential(provider, options?.signal);
        return { type: 'api_key', source: 'platform-injected' };
      };
      if (name === 'getAuth') return async (ref, options = {}) => {
        const provider = typeof ref === 'string' ? ref : canonical(ref).provider;
        const signal = requestSignal(options.signal);
        const apiKey = await credential(provider, signal);
        return abortable(() => target.getAuth(typeof ref === 'string' ? ref : canonical(ref), {
          ...options, apiKey, env: {}, signal,
        }), signal);
      };
      if (name === 'streamSimple') return async (ref, context, options = {}) => {
        const model = canonical(ref);
        const signal = requestSignal(options.signal);
        const apiKey = await credential(model.provider, signal);
        signal?.throwIfAborted();
        const notifyResponse = async (response) => {
          await onProviderResponse?.({ status: response.status, headers: response.headers });
          await options.onResponse?.(response);
        };
        // A platform transport owns the HTTP exchange, so observe its response
        // before the provider adapter can reject a non-2xx status. Without this
        // wrapper the SDK may throw before invoking its ordinary onResponse hook.
        const observedFetch = providerFetch ? async (...args) => {
          const response = await providerFetch(...args);
          await notifyResponse(response);
          return response;
        } : undefined;
        return target.streamSimple(model, context, {
          ...options, apiKey, env: {}, signal, maxRetries: 0,
          ...(observedFetch ? { fetch: observedFetch } : {}),
          // The SDK invokes this after serializing and merging sampling options.
          // Only a platform-injected policy may approve the final payload; project
          // resources and the public session facade cannot replace this callback.
          onPayload: async (payload, wireModel) => {
            let next = options.onPayload
              ? await abortable(() => options.onPayload(payload, wireModel), signal) ?? payload
              : payload;
            if (onProviderPayload) {
              next = await abortable(() => onProviderPayload({
                payload: next,
                model: Object.freeze({ provider: model.provider, id: model.id, api: model.api, baseUrl: model.baseUrl }),
                signal,
              }), signal);
              if (!next || typeof next !== 'object' || Array.isArray(next)) deny('Platform payload policy must return an approved object');
            }
            signal?.throwIfAborted();
            return next;
          },
          onResponse: observedFetch ? undefined : notifyResponse,
        });
      };
      if (['registerProvider', 'registerNativeProvider', 'unregisterProvider', 'refresh', 'login', 'logout',
        'setRuntimeApiKey', 'removeRuntimeApiKey', 'stream', 'complete', 'completeSimple',
        'streamDeferred', 'fetchDeferred', 'cancelDeferred'].includes(name)) {
        return () => deny('Model runtime mutation or unsupported request is disabled');
      }
      const value = Reflect.get(target, name, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { runtime: facade, models, canonical };
}

function validateSnapshot(snapshot, scope, allowedModels, toolNames) {
  if (snapshot.format !== 'riffology-pi-session-v1' || JSON.stringify(snapshot.scope) !== JSON.stringify(scope)) {
    deny('Session checkpoint scope or format mismatch');
  }
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length > 100000) deny('Invalid session entries');
  const seen = new Set();
  const supported = new Set(['model_change', 'thinking_level_change', 'message', 'compaction', 'branch_summary', 'session_info', 'label']);
  for (const entry of snapshot.entries) {
    if (!supported.has(entry.type) || typeof entry.id !== 'string' || seen.has(entry.id)
      || (entry.parentId !== null && !seen.has(entry.parentId))) deny('Invalid session entry graph or entry type');
    seen.add(entry.id);
    if (entry.type === 'model_change' && !allowedModels.has(keyOf(entry))) deny('Session model is not allowed');
    const message = entry.type === 'message' ? entry.message : undefined;
    if (message?.role === 'assistant') {
      if (!allowedModels.has(`${message.provider}/${message.model}`)) deny('Session assistant model is not allowed');
      for (const content of message.content ?? []) {
        if (content.type === 'toolCall' && !toolNames.has(content.name)) deny('Session tool is not allowed');
      }
    } else if (message?.role === 'toolResult') {
      if (!toolNames.has(message.toolName)) deny('Session tool result is not allowed');
    } else if (message && message.role !== 'user') {
      deny('Unsupported session message role');
    }
  }
  if (snapshot.leafId !== null && !seen.has(snapshot.leafId)) deny('Invalid session leaf');
}

/** Historical references may be retained without entering the dispatch registry. */
function checkpointModels(models, allowedHistoryModels) {
  if (!Array.isArray(allowedHistoryModels)) deny('Invalid history model policy');
  const references = new Set(models.keys());
  const history = new Set();
  for (const ref of allowedHistoryModels) {
    if (!ref || Object.keys(ref).sort().join(',') !== 'id,provider'
      || typeof ref.provider !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(ref.provider)
      || typeof ref.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,149}$/.test(ref.id)
      || history.has(keyOf(ref))) deny('Invalid or duplicate history model');
    history.add(keyOf(ref));
    references.add(keyOf(ref));
  }
  return references;
}

/**
 * Trusted Pi host facade. The underlying AgentSession is deliberately private:
 * its executeBash(), setModel(), and session-file APIs are not product APIs.
 * Only platform-provided bridge definitions can call project execution APIs.
 */
export async function createControlledPiSession({
  trustedCwd, scope, selectedModel, allowedModels, allowedHistoryModels = [], providerDefinitions,
  resolveCredential, onProviderResponse, onProviderPayload, providerFetch, systemPrompt, fixedSkills = [],
  bridge, snapshot, cancellationGraceMs = 5000,
}) {
  if (!isAbsolute(trustedCwd)) deny('Trusted host cwd must be absolute');
  const binding = {
    tenantId: scope?.tenantId, projectId: scope?.projectId, sessionId: scope?.sessionId,
  };
  if (Object.values(binding).some((value) => typeof value !== 'string' || !value)) deny('Complete session scope is required');
  if (!Number.isInteger(cancellationGraceMs) || cancellationGraceMs < 1 || cancellationGraceMs > 30000) deny('Invalid cancellation grace');
  let turnController;
  let pendingTurn;
  const definitions = bridge?.definitions ?? [];
  const names = new Set();
  for (const definition of definitions) {
    if (!/^project_[a-z0-9_]+$/.test(definition.name) || LOCAL_TOOLS.has(definition.name)
      || names.has(definition.name)) deny('Invalid or duplicate remote tool name');
    if (typeof bridge.execute !== 'function') deny('Remote tool executor is required');
    names.add(definition.name);
  }
  const { runtime, models, canonical } = await controlledModels({
    allowedModels, providerDefinitions, resolveCredential, onProviderResponse, onProviderPayload, providerFetch,
    getHostSignal: () => turnController?.signal,
  });
  const selected = canonical(selectedModel);
  const snapshotModels = checkpointModels(models, allowedHistoryModels);
  const loader = new ControlledResourceLoader({ systemPrompt, fixedSkills });
  let sessionManager;
  if (snapshot) {
    validateSnapshot(snapshot, binding, snapshotModels, names);
    const header = {
      type: 'session', version: 3, id: binding.sessionId, cwd: trustedCwd,
      timestamp: snapshot.createdAt,
    };
    sessionManager = SessionManager.inMemory(trustedCwd, { id: binding.sessionId },
      [header, ...structuredClone(snapshot.entries)]);
    if (snapshot.leafId === null) sessionManager.resetLeaf();
    else sessionManager.branch(snapshot.leafId);
    const previous = sessionManager.buildSessionContext().model;
    if (previous && keyOf(previous) !== keyOf(selected)) {
      // Record the platform-selected upgrade on this branch, preserving every
      // historical entry and never making its old model dispatchable.
      sessionManager.appendModelChange(selected.provider, selected.id);
    }
  } else {
    sessionManager = SessionManager.inMemory(trustedCwd, { id: binding.sessionId });
  }
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: selected.provider, defaultModel: selected.id, defaultThinkingLevel: 'off',
    defaultTools: [], defaultProjectTrust: 'never', enableSkillCommands: false,
    enableAnalytics: false, enableInstallTelemetry: false,
    compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } },
  }, { projectTrusted: false });
  const customTools = definitions.map(({ name, label, description, parameters }) => ({
    name, label, description, parameters, executionMode: 'sequential',
    execute: (toolCallId, args, signal, onUpdate) => bridge.execute({
      scope: { ...binding }, name, toolCallId, args, signal, onUpdate,
    }),
  }));
  const { session, extensionsResult, modelFallbackMessage } = await createAgentSession({
    cwd: trustedCwd, agentDir: join(trustedCwd, '.platform-pi'),
    modelRuntime: runtime, model: selected, thinkingLevel: 'off',
    scopedModels: [...models.values()].map((model) => ({ model, thinkingLevel: 'off' })),
    tools: [...names], noTools: 'all', customTools,
    resourceLoader: loader, settingsManager, sessionManager,
  });
  if (extensionsResult.extensions.length || extensionsResult.errors.length || modelFallbackMessage) {
    session.dispose();
    deny('Unexpected Pi extension or model fallback');
  }
  let closed = false;
  let active = false;
  async function cancelAndSettle() {
    turnController?.abort(new DOMException('The platform cancelled this turn', 'AbortError'));
    let timeout;
    try {
      await Promise.race([
        Promise.all([pendingTurn?.catch(() => {}), Promise.resolve().then(() => session.abort())]),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Pi cancellation did not settle; terminate the trusted host')), cancellationGraceMs);
        }),
      ]);
    } catch (error) {
      closed = true;
      throw error;
    } finally { clearTimeout(timeout); }
  }
  return Object.freeze({
    inspect() {
      return {
        scope: { ...binding }, model: { provider: selected.provider, id: selected.id },
        allowedModels: [...models.values()].map(({ provider, id }) => ({ provider, id })),
        tools: session.getActiveToolNames(), extensions: 0,
        systemPrompt: session.state.systemPrompt, messages: structuredClone(session.state.messages),
        active, closed,
      };
    },
    subscribe(listener) { return session.subscribe(listener); },
    async prompt(text) {
      if (closed || active) deny('Session is closed or already running');
      if (typeof text !== 'string' || !text.trim()) deny('A non-empty prompt is required');
      active = true;
      const controller = new AbortController();
      turnController = controller;
      pendingTurn = (async () => {
        try {
          await session.prompt(text, { expandPromptTemplates: false, source: 'rpc' });
          const reply = [...session.state.messages].reverse().find((message) => message.role === 'assistant');
          if (controller.signal.aborted) return { outcome: 'aborted', stopReason: 'aborted' };
          const outcome = reply?.stopReason === 'aborted' ? 'aborted'
            : !reply || reply.stopReason === 'error' ? 'failed' : 'completed';
          return { outcome, stopReason: reply?.stopReason, ...(reply?.errorMessage ? { errorMessage: reply.errorMessage } : {}) };
        } catch (error) {
          if (controller.signal.aborted) return { outcome: 'aborted', stopReason: 'aborted' };
          throw error;
        } finally { active = false; }
      })();
      return pendingTurn;
    },
    cancel: cancelAndSettle,
    snapshot() {
      if (active || session.isStreaming) deny('Cannot checkpoint an active Pi session');
      return structuredClone({
        format: 'riffology-pi-session-v1', scope: binding,
        createdAt: sessionManager.getHeader().timestamp,
        entries: sessionManager.getEntries(), leafId: sessionManager.getLeafId(),
      });
    },
    async dispose() {
      closed = true;
      try { await cancelAndSettle(); }
      finally { session.dispose(); }
    },
  });
}
