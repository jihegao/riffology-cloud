import type { ResourceLoader } from '@earendil-works/pi-coding-agent';
import { ControlledResourceLoader, type ControlledPiOptions, type ControlledPiSession } from '../../../services/runtime/controlled-pi.mjs';
import { createProxyPiSession, type ProxyPiOptions } from '../../../services/runtime/proxy-pi.mjs';

const loader: ResourceLoader = new ControlledResourceLoader({ systemPrompt: 'platform prompt' });
void loader;

export function useHost(host: ControlledPiSession, options: ControlledPiOptions): void {
  const snapshot = host.snapshot();
  options.snapshot = snapshot;
  host.subscribe((event) => { void event.type; });
  // @ts-expect-error The public host cannot run local shell commands.
  host.executeBash('pwd');
  // @ts-expect-error The public host cannot select an arbitrary model.
  host.setModel({ provider: 'untrusted', id: 'untrusted' });
}

export async function useProxyHost(options: ProxyPiOptions): Promise<void> {
  const host = await createProxyPiSession(options);
  const cancellation = await host.cancel();
  const terminalConfirmed: false = cancellation.serverTerminalConfirmed;
  const checkpoint = host.snapshot();
  options.snapshot = checkpoint;
  void terminalConfirmed;
  // @ts-expect-error The coordinator retains the capability; public inspection never returns it.
  void host.inspect().invocation.token;
}
