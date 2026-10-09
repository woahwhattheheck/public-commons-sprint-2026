// The production MCP server is unchanged; only the weather provider is a fixture.
import { JsonStore } from '../hearthline-alexa-mcp/src/store.mjs';
import { HearthlineOrchestrator } from '../hearthline-alexa-mcp/src/orchestrator.mjs';
import { createMcpHttpServer } from '../hearthline-alexa-mcp/src/mcp-server.mjs';

if (!process.send || !process.argv[2]) throw new Error('Start with the browser demo host.');
const store = new JsonStore(process.argv[2]);
await store.load();
const orchestrator = new HearthlineOrchestrator({
  store,
  alertProvider: async () => [{ id: 'demo-warning', event: 'Simulated thunderstorm', severity: 'Severe', urgency: 'Immediate', headline: 'DEMO FIXTURE — not a live weather warning', onset: null, expires: null, instruction: 'Demonstration only. Consult official sources for real weather.' }],
});
const server = createMcpHttpServer({ orchestrator });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.send({ port: server.address().port, pid: process.pid });
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
});
process.on('disconnect', () => process.kill(process.pid, 'SIGTERM'));
