import { mkdir } from 'node:fs/promises';
import { startBroker } from '../src/broker.mjs';
import { testPaths } from './test-workspace.mjs';

const { workspace } = await testPaths();
await mkdir(workspace, { recursive: true, mode: 0o700 });
const broker = await startBroker(workspace);
console.log(`IR acceptance workspace: ${workspace}\nBroker: ${broker.connection.origin}\nOpen this folder in PI WEB and select Browser or IR Model.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await broker.close(); process.exit(); });
