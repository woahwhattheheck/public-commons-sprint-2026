import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../src/store.mjs';
import { HearthlineOrchestrator } from '../src/orchestrator.mjs';
import { createMcpHttpServer, PROTOCOL_VERSION } from '../src/mcp-server.mjs';

const store = new JsonStore(join(await mkdtemp(join(tmpdir(), 'hearthline-demo-')), 'state.json'));
await store.load();
const orchestrator = new HearthlineOrchestrator({ store, alertProvider: async () => [{ id: 'demo-alert', event: 'Severe Thunderstorm Warning', severity: 'Severe', urgency: 'Immediate', headline: 'Demo: severe thunderstorm warning for the configured area', onset: null, expires: null, instruction: 'Follow official local guidance.' }] });
const server = createMcpHttpServer({ orchestrator, logger: { error() {} } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/mcp`;
const baseHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
async function raw(body, headers = {}) { const response = await fetch(url, { method: 'POST', headers: { ...baseHeaders, ...headers }, body: JSON.stringify(body) }); return { response, body: response.status === 202 ? null : await response.json() }; }
function print(label, value) { console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`); }
try {
  const init = await raw({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: 'Hearthline demo', version: '0.1' }, capabilities: {} } });
  const session = init.response.headers.get('mcp-session-id');
  const h = { 'mcp-session-id': session, 'mcp-protocol-version': PROTOCOL_VERSION };
  await raw({ jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  await raw({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'hearthline_seed_inventory', arguments: { items: { flashlight: 1, water: 1, battery_pack: 0, first_aid_kit: 1 } } } }, h);
  const prepared = await raw({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hearthline_prepare_storm', arguments: { latitude: 38.2, longitude: -85.7, household: { people: 2, pets: 1 } } } }, h);
  const mission = prepared.body.result.structuredContent.mission;
  print('mission prepared', { id: mission.id, status: mission.status, alerts: mission.alertsSummary, actions: mission.actions.map(({ id, kind, status, summary }) => ({ id, kind, status, summary })) });
  const reminder = mission.actions.find(a => a.kind === 'household_reminder');
  const blocked = await raw({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'hearthline_execute_approved', arguments: { missionId: mission.id, actionId: reminder.id, idempotencyKey: 'demo-reminder-001' } } }, h);
  print('pre-approval execution fails closed', blocked.body.result);
  const approved = await raw({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'hearthline_approve_action', arguments: { missionId: mission.id, actionId: reminder.id, planHash: mission.planHash } } }, h);
  print('explicit approval', { status: approved.body.result.structuredContent.action.status, newPlanHash: approved.body.result.structuredContent.mission.planHash });
  const executed = await raw({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'hearthline_execute_approved', arguments: { missionId: mission.id, actionId: reminder.id, idempotencyKey: 'demo-reminder-001' } } }, h);
  const replay = await raw({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'hearthline_execute_approved', arguments: { missionId: mission.id, actionId: reminder.id, idempotencyKey: 'demo-reminder-001' } } }, h);
  print('first execution receipt', executed.body.result.structuredContent.receipt);
  print('idempotent replay', { replayed: replay.body.result.structuredContent.replayed, sameReceipt: replay.body.result.structuredContent.receipt.id === executed.body.result.structuredContent.receipt.id });
} finally { await new Promise(resolve => server.close(resolve)); }
