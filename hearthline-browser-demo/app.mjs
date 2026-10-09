const $ = id => document.getElementById(id);
let session, protocol, nextId = 1, mission, lastExecution, busy = false;
const evidence = { schema: 'hearthline.browser-demonstration/v1', startedAt: new Date().toISOString(), environment: { runtime: 'real local MCP over HTTP', weather: 'synthetic fixture', externalEffects: false, alexaDevice: false, languageModel: false }, events: [] };

function event(label, details = {}) {
  const item = { at: new Date().toISOString(), label, ...details };
  evidence.events.push(item);
  const li = document.createElement('li'), time = document.createElement('time');
  time.textContent = new Date(item.at).toLocaleTimeString('en-GB');
  li.append(time, document.createTextNode(label)); $('events').prepend(li);
  while ($('events').children.length > 8) $('events').lastChild.remove();
}
function verdict(text) { $('verdict').textContent = text; }
function selected() { return mission?.actions.find(a => a.id === $('action').value); }
function render() {
  $('controls').hidden = !mission;
  $('mission-status').textContent = mission ? mission.status.replaceAll('_', ' ') : 'Not created';
  if (!mission) return;
  const oldSelection = $('action').value;
  $('mission-title').textContent = mission.title;
  $('actions').replaceChildren(); $('action').replaceChildren();
  for (const action of mission.actions) {
    const card = document.createElement('div'); card.className = 'action';
    const title = document.createElement('strong'), status = document.createElement('span'), summary = document.createElement('p');
    title.textContent = action.kind.replaceAll('_', ' '); status.textContent = action.status.replaceAll('_', ' '); summary.textContent = action.summary;
    card.append(title, status, summary); $('actions').append(card);
    if (['household_reminder', 'shopping_proposal'].includes(action.kind)) {
      const option = document.createElement('option'); option.value = action.id; option.textContent = action.kind === 'household_reminder' ? 'Household reminder — local outbox only' : 'Shopping handoff — no purchase'; $('action').append(option);
    }
  }
  if (mission.actions.some(a => a.id === oldSelection)) $('action').value = oldSelection;
  else $('action').value = mission.actions.find(a => a.kind === 'household_reminder')?.id ?? $('action').value;
}
async function status() {
  const response = await fetch('/demo/status'); if (!response.ok) throw new Error('Runtime status unavailable');
  const value = await response.json();
  $('generation').textContent = `${value.generation} / PID ${value.pid}`;
  $('outbox').textContent = `${value.localOutboxItems} item${value.localOutboxItems === 1 ? '' : 's'}`;
  $('receipts').textContent = value.receipts;
  return value;
}
async function rpc(method, params = {}, { notification = false, initialize = false } = {}) {
  const request = { jsonrpc: '2.0', ...(notification ? {} : { id: nextId++ }), method, params };
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (!initialize) { headers['mcp-session-id'] = session; headers['mcp-protocol-version'] = protocol; }
  const response = await fetch('/mcp', { method: 'POST', headers, body: JSON.stringify(request) });
  if (notification) { if (response.status !== 202) throw new Error(`Notification failed: ${response.status}`); return; }
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  if (initialize) session = response.headers.get('mcp-session-id');
  return body.result;
}
async function connect() {
  const info = await rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'Hearthline browser demonstration', version: '1.0.0' }, capabilities: {} }, { initialize: true });
  protocol = info.protocolVersion;
  if (!session || protocol !== '2025-11-25') throw new Error('Unexpected MCP negotiation');
  await rpc('notifications/initialized', {}, { notification: true });
  const tools = await rpc('tools/list');
  $('protocol').textContent = `MCP ${protocol}`;
  $('connection').textContent = `● Connected · ${tools.tools.length} tools · loopback HTTP`;
  event(`Connected to ${info.serverInfo.name}`, { protocol, tools: tools.tools.map(t => t.name) });
  await status();
}
async function tool(name, args, expectedError = false) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (result.isError) {
    const message = result.content?.filter(c => c.type === 'text').map(c => c.text).join(' ') || 'Tool failed';
    if (!expectedError) throw new Error(message);
    event('Execution rejected before approval', { tool: name, toolError: message });
    return { blocked: true, message };
  }
  if (expectedError) throw new Error('Expected rejection, but the action executed');
  if (result.structuredContent?.mission) { mission = result.structuredContent.mission; render(); }
  return result.structuredContent;
}
function bind(id, action) {
  $(id).addEventListener('click', async () => {
    if (busy) return;
    busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await action(); }
    catch (error) { event('Operation failed', { error: error.message }); verdict(`Stopped: ${error.message}`); }
    finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
  });
}
bind('prepare', async () => {
  await tool('hearthline_seed_inventory', { items: { flashlight: 1, water: 1, battery_pack: 0, first_aid_kit: 1 } });
  await tool('hearthline_prepare_storm', { title: 'Get the household storm-ready', latitude: 38.2, longitude: -85.7, household: { people: 2, pets: 1 } });
  lastExecution = null;
  event('Mission created; local actions await approval', { missionId: mission.id, planHash: mission.planHash });
  verdict('Plan prepared. Nothing purchased or sent. Each local action requires an explicit approval.'); await status();
});
bind('probe', async () => {
  const action = selected(); if (!action || action.status !== 'awaiting_approval') throw new Error('Choose an action still awaiting approval.');
  const response = await tool('hearthline_execute_approved', { missionId: mission.id, actionId: action.id, operationId: `demo-${action.id}` }, true);
  verdict(`Correctly blocked: ${response.message}`); await status();
});
bind('approve', async () => {
  const action = selected(); if (!action) throw new Error('Create a mission first.');
  const result = await tool('hearthline_approve_action', { missionId: mission.id, actionId: action.id, planHash: mission.planHash, operationId: `demo-${action.id}` });
  event('Explicit approval bound to this action and plan', { operationId: result.approval.operationId, approvalDigest: result.approval.approvalDigest });
  verdict('Approved, not executed. The stored approval binds the exact action payload and plan hash.'); await status();
});
bind('execute', async () => {
  const action = selected(); if (!action) throw new Error('Create a mission first.');
  const args = { missionId: mission.id, actionId: action.id, operationId: `demo-${action.id}` };
  const result = await tool('hearthline_execute_approved', args);
  lastExecution = { args, receipt: result.receipt };
  $('receipt').textContent = JSON.stringify(result.receipt, null, 2);
  event('Approved local action completed', { operationId: args.operationId, receipt: result.receipt, replayed: result.replayed });
  verdict(action.kind === 'shopping_proposal' ? 'Shopping handoff prepared — no purchase placed.' : 'One reminder stored in the local demo outbox — no message delivered.'); await status();
});
bind('restart', async () => {
  const before = await status();
  const response = await fetch('/demo/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const result = await response.json(); if (!response.ok) throw new Error(result.error);
  await connect();
  if (mission) await tool('hearthline_get_mission', { missionId: mission.id });
  const after = await status();
  if (result.pid === result.previousPid || before.pid !== result.previousPid || after.pid !== result.pid) throw new Error('Process restart evidence did not match');
  event('MCP process restarted; durable mission recovered', { restart: result, before, after });
  verdict('New process, same durable mission. Replay the last operation to check it is not duplicated.');
});
bind('replay', async () => {
  if (!lastExecution) throw new Error('Execute one action first.');
  const before = await status(), result = await tool('hearthline_execute_approved', lastExecution.args), after = await status();
  const sameReceipt = JSON.stringify(result.receipt) === JSON.stringify(lastExecution.receipt);
  if (!result.replayed || !sameReceipt || before.receipts !== after.receipts || before.localOutboxItems !== after.localOutboxItems) throw new Error('Replay invariant failed');
  event('Exact receipt replayed; zero duplicate effects', { replayed: result.replayed, sameReceipt, before, after });
  verdict('PASS: same receipt after restart. No new outbox item, no duplicate effect.');
});
bind('export', async () => {
  const packet = { ...evidence, exportedAt: new Date().toISOString(), runtime: await status(), mission, lastExecution };
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2) + '\n'], { type: 'application/json' }));
  link.href = url; link.download = 'hearthline-browser-evidence.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.hearthlineDemo = { evidence, snapshot: () => ({ mission, lastExecution }) };
connect().catch(error => { $('connection').textContent = 'Connection failed'; event('Connection failed', { error: error.message }); verdict(error.message); });
