import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request } from './broker.mjs';

// A developer can restart this workspace's broker while Pi keeps its extension
// process alive. Select the current descriptor before sending an operation;
// never retry an operation whose result is uncertain.
export function liveProject(workspace, acquired) {
  let connection = acquired.connection;
  return { ...acquired,
    async call(operation, input, signal) {
      const saved = JSON.parse(await readFile(resolve(workspace, '.riffoid-ir/connection.json'), 'utf8'));
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(saved.origin) || !/^[a-f0-9]{64}$/.test(saved.token)) {
        throw new Error('Invalid workspace IR broker connection; restart this workspace broker');
      }
      if (saved.origin !== connection.origin || saved.token !== connection.token) {
        const response = await fetch(`${saved.origin}/health`, { headers: { authorization: `Bearer ${saved.token}` },
          signal: AbortSignal.timeout(1500) });
        if (!response.ok || (await response.json()).workspace !== resolve(workspace)) {
          throw new Error('Replacement IR broker does not serve this workspace');
        }
        connection = saved;
      }
      return request(connection, operation, input, signal);
    },
  };
}
