import {errorMessage, msg, uiError} from './i18n.js';
import {bindValue} from './i18n-bindings.js';

const MESSAGES = {
  'export-too-large': 'export-too-large',
  'export-sensitive-file': 'export-sensitive-file',
  'export-result-missing': 'export-result-missing',
  'export-source-mismatch': 'export-source-mismatch',
  'export-evidence-mismatch': 'export-evidence-mismatch',
  'export-model-spec-invalid': 'export-model-spec-invalid',
  'export-dependencies-invalid': 'export-dependencies-invalid',
  'export-model-changed': 'export-model-changed',
  'export-busy': 'export-busy',
};
const MAX_BYTES = 16 * 1024 * 1024;
const text = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value !== undefined) bindValue(node, value);
  if (className) node.className = className;
  return node;
};

export function createExportPanel({root, fetcher = fetch}) {
  let context = null;
  let generation = 0;
  let busy = false;
  let controller = null;

  function render(message = '') {
    root.replaceChildren();
    if (!context) return;
    const title = text('h2', msg('export-title'));
    const description = text('p', msg('export-description'));
    const button = text('button', () => msg(busy ? 'export-preparing' : 'export-download'));
    button.type = 'button'; button.className = 'button'; button.disabled = busy;
    button.onclick = () => void download();
    const status = text('p', message); status.setAttribute('role', 'status');
    root.append(title, description, button, status);
  }

  async function download() {
    if (!context || busy) return;
    const token = generation, current = context;
    busy = true;
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 60000);
    let response;
    render();
    try {
      response = await fetcher(`/api/workspaces/${encodeURIComponent(current.workspaceId)}/research-export`, {
        credentials: 'same-origin', headers: {accept: 'application/zip'}, signal: requestController.signal,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw uiError(MESSAGES[error.error] || 'export-request-failed', {status: response.status});
      }
      if (response.headers.get('content-type')?.split(';')[0] !== 'application/zip' || Number(response.headers.get('content-length')) > MAX_BYTES) throw uiError('export-response-invalid');
      const hash = response.headers.get('x-riffology-export-sha256');
      if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !response.body) throw uiError('export-integrity-missing');
      const reader = response.body.getReader(), parts = [];
      let size = 0;
      try {
        for (;;) {
          const value = await reader.read();
          if (value.done) break;
          size += value.value.byteLength;
          if (size > MAX_BYTES) throw uiError('export-response-too-large');
          parts.push(value.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== hash || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw uiError('export-integrity-invalid');
      if (token !== generation || current !== context) return;
      const filename = /filename="([A-Za-z0-9_-]+\.zip)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'riffology-project.zip';
      const url = URL.createObjectURL(new Blob([bytes], {type: 'application/zip'}));
      const link = document.createElement('a');
      link.href = url; link.download = filename; root.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      busy = false;
      render(msg('export-complete'));
    } catch (error) {
      if (token === generation) { busy = false; render(error.name === 'AbortError' ? msg('export-timeout') : errorMessage(error)); }
    } finally {
      clearTimeout(timeout);
      await response?.body?.cancel().catch(() => {});
      if (token === generation) { busy = false; controller = null; }
    }
  }

  function enter(value) {
    leave();
    if (!value || typeof value.workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.workspaceId)) throw Error('invalid-export-context');
    context = value; render();
  }
  function leave() { generation++; controller?.abort(); controller = null; busy = false; context = null; root.replaceChildren(); }
  return {enter, leave};
}
