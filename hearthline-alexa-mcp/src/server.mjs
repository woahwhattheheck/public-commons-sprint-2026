import { resolve } from 'node:path';
import { JsonStore } from './store.mjs';
import { fetchActiveAlerts } from './nws.mjs';
import { HearthlineOrchestrator } from './orchestrator.mjs';
import { createMcpHttpServer } from './mcp-server.mjs';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const storePath = resolve(process.env.HEARTHLINE_STORE ?? './data/hearthline-store.json');
const allowedOrigins = String(process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const store = new JsonStore(storePath);
await store.load();
const orchestrator = new HearthlineOrchestrator({ store, alertProvider: (location) => fetchActiveAlerts(location) });
const server = createMcpHttpServer({ orchestrator, allowedOrigins });
server.listen(port, host, () => console.log(`Hearthline MCP listening on http://${host}:${port}/mcp (protocol 2025-11-25)`));
