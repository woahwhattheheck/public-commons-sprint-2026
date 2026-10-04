import { resolve } from 'node:path';
import { JsonStore } from './store.mjs';
import { fetchActiveAlerts } from './nws.mjs';
import { HearthlineOrchestrator } from './orchestrator.mjs';
import { runMcpStdio } from './stdio-transport.mjs';

const storePath = resolve(process.env.HEARTHLINE_STORE ?? './data/hearthline-store.json');
const store = new JsonStore(storePath);
await store.load();
const orchestrator = new HearthlineOrchestrator({ store, alertProvider: (location) => fetchActiveAlerts(location) });
await runMcpStdio({ orchestrator, logger: { error: (...args) => console.error(...args) } });
