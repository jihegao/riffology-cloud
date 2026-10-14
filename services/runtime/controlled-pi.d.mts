import type {
  AgentSession, AgentSessionEventListener, AgentToolResult, AgentToolUpdateCallback,
  ModelRuntime, ResourceLoader, SessionManager, ToolDefinition,
} from '@earendil-works/pi-coding-agent';

export interface SessionScope {
  tenantId: string;
  projectId: string;
  sessionId: string;
}
export interface AllowedModel { provider: string; id: string }
export interface FixedPlatformSkill { name: string; content: string }
export interface PiCheckpoint {
  format: 'riffology-pi-session-v1';
  scope: SessionScope;
  createdAt: string;
  entries: ReturnType<SessionManager['getEntries']>;
  leafId: string | null;
}
export interface ProjectToolCall {
  scope: SessionScope;
  name: string;
  toolCallId: string;
  args: unknown;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
}
export interface ControlledPiOptions {
  /** An internal host path, never a mount of the untrusted project filesystem. */
  trustedCwd: string;
  scope: SessionScope;
  selectedModel: AllowedModel;
  /** Models authorized for new provider requests. */
  allowedModels: AllowedModel[];
  /** Release-controlled checkpoint references only; never authorize dispatch. */
  allowedHistoryModels?: AllowedModel[];
  /** Release-controlled definitions; project files are not a source for these. */
  providerDefinitions?: Array<{ provider: string; config: Parameters<ModelRuntime['registerProvider']>[1] }>;
  resolveCredential(provider: string, options: { signal?: AbortSignal }): Promise<string | undefined>;
  onProviderResponse?(response: { status: number; headers: HeadersInit }): void | Promise<void>;
  /** Release-controlled transport; takes precedence over SDK per-call fetch options. */
  providerFetch?: typeof globalThis.fetch;
  /** Final serialized request policy, injected by the platform. Not a substitute for Worker budget authority. */
  onProviderPayload?(request: {
    payload: unknown;
    model: Readonly<AllowedModel & { api: string; baseUrl: string }>;
    signal?: AbortSignal;
  }): Record<string, unknown> | Promise<Record<string, unknown>>;
  systemPrompt: string;
  fixedSkills?: FixedPlatformSkill[];
  bridge?: {
    definitions: Array<Pick<ToolDefinition, 'name' | 'label' | 'description' | 'parameters'>>;
    execute(call: ProjectToolCall): Promise<AgentToolResult<unknown>>;
  };
  /** A coordinator-verified checkpoint, not a project file or arbitrary client upload. */
  snapshot?: PiCheckpoint;
  /** After this grace, a non-cooperative tool requires supervisor termination. */
  cancellationGraceMs?: number;
}
export interface ControlledPiSession {
  inspect(): {
    scope: SessionScope;
    model: AllowedModel;
    allowedModels: AllowedModel[];
    tools: string[];
    extensions: number;
    systemPrompt: string;
    messages: AgentSession['state']['messages'];
    active: boolean;
    closed: boolean;
  };
  subscribe(listener: AgentSessionEventListener): () => void;
  prompt(text: string): Promise<{ outcome: 'completed' | 'aborted' | 'failed'; stopReason?: string; errorMessage?: string }>;
  cancel(): Promise<void>;
  snapshot(): PiCheckpoint;
  dispose(): Promise<void>;
}
export declare function createControlledPiSession(options: ControlledPiOptions): Promise<ControlledPiSession>;
export declare class ControlledResourceLoader implements ResourceLoader {
  constructor(options: { systemPrompt: string; fixedSkills?: FixedPlatformSkill[] });
  getExtensions: ResourceLoader['getExtensions'];
  getSkills: ResourceLoader['getSkills'];
  getPrompts: ResourceLoader['getPrompts'];
  getThemes: ResourceLoader['getThemes'];
  getAgentsFiles: ResourceLoader['getAgentsFiles'];
  getSystemPrompt: ResourceLoader['getSystemPrompt'];
  getSystemPromptSource: ResourceLoader['getSystemPromptSource'];
  getAppendSystemPrompt: ResourceLoader['getAppendSystemPrompt'];
  getAppendSystemPromptSources: ResourceLoader['getAppendSystemPromptSources'];
  extendResources(paths: Parameters<ResourceLoader['extendResources']>[0]): void;
  reload(): Promise<void>;
}
