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
if (!Object.keys(store.snapshot().inventory).length && !Object.keys(store.snapshot().missions).length) {
  await orchestrator.seedInventory({ flashlight: 1, water: 1, battery_pack: 0, first_aid_kit: 1 });
}
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.send({ port: server.address().port, pid: process.pid });
let closing = false;
process.on('SIGTERM', () => {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await store.mutationChain;
    await store.writeChain;
    process.exit(0);
  });
  server.closeIdleConnections();
});
process.on('disconnect', () => process.kill(process.pid, 'SIGTERM'));
