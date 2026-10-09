const $ = id => document.getElementById(id);
let session, protocol, counter = 0, mission, reminder, firstReceipt, appReady = false;
const operationId = 'recorded-reminder-operation';
const evidence = { schemaVersion: 1, fixtureWeather: true, providerCalls: false, steps: [], assertions: {} };
window.demoEvidence = evidence;
function record(label, value) { evidence.steps.push({ at: new Date().toISOString(), label, value }); $('evidence').textContent = JSON.stringify(value, null, 2); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function runtime() {
  const response = await fetch('/demo/runtime');
  assert(response.ok, 'Runtime evidence failed');
  const value = await response.json();
  $('pid').textContent = value.backendPid; $('outbox').textContent = value.outboxCount; $('receipts').textContent = value.receiptCount;
  return value;
}
async function rpc(method, params = {}, notification = false) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (session) { headers['mcp-session-id'] = session; headers['mcp-protocol-version'] = protocol; }
  const body = { jsonrpc: '2.0', method, params, ...(!notification && { id: ++counter }) };
  const response = await fetch('/mcp', { method: 'POST', headers, body: JSON.stringify(body) });
  if (notification) { assert(response.status === 202, 'Initialization notification rejected'); return; }
  const value = await response.json();
  assert(response.ok && !value.error, value.error?.message ?? `MCP HTTP ${response.status}`);
  if (method === 'initialize') { session = response.headers.get('mcp-session-id'); protocol = value.result.protocolVersion; }
  evidence.steps.push({ at: new Date().toISOString(), label: 'MCP response', method,
    ...(method === 'tools/call' && { tool: params.name }), result: value.result });
  return value.result;
}
function renderMission() {
  if (appReady && mission) $('dashboard').contentWindow.postMessage({ jsonrpc: '2.0',
    method: 'ui/notifications/tool-result', params: { structuredContent: { mission } } }, '*');
}
window.addEventListener('message', event => {
  if (event.source !== $('dashboard').contentWindow || event.data?.jsonrpc !== '2.0') return;
  if (event.data.method === 'ui/initialize') event.source.postMessage({ jsonrpc: '2.0', id: event.data.id,
    result: { protocolVersion: '2026-01-26', hostInfo: { name: 'Hearthline local demo host', version: '1.0.0' },
      hostCapabilities: {}, hostContext: { theme: 'light' } } }, '*');
  if (event.data.method === 'ui/notifications/initialized') { appReady = true; renderMission(); }
});
async function tool(name, args, allowError = false) {
  const result = await rpc('tools/call', { name, arguments: args });
  assert(allowError || !result.isError, result.content?.[0]?.text ?? 'Tool failed');
  if (result.structuredContent?.mission) { mission = result.structuredContent.mission; renderMission(); }
  return result;
}
async function connect() {
  session = null;
  const result = await rpc('initialize', { protocolVersion: '2025-11-25',
    clientInfo: { name: 'Hearthline live recording', version: '1.0.0' }, capabilities: {} });
  await rpc('notifications/initialized', {}, true);
  return { server: result.serverInfo.name, protocol: result.protocolVersion, ...(await runtime()) };
}
const operations = {
  connect: async () => {
    const value = await connect();
    const resource = await rpc('resources/read', { uri: 'ui://hearthline/mission-dashboard.html' });
    $('dashboard').srcdoc = resource.contents[0].text; $('dashboard').hidden = false; $('intro').hidden = true;
    record('Connected to real MCP server', value); $('prepare').disabled = false;
    $('caption').textContent = 'Connected. The original MCP App is loaded from the server resource.';
  },
  prepare: async () => {
    await tool('hearthline_seed_inventory', { items: { flashlight: 1, water: 1, battery_pack: 0, first_aid_kit: 1 } });
    await tool('hearthline_prepare_storm', { title: 'Storm readiness · synthetic demo', latitude: 38.2, longitude: -85.7,
      household: { people: 2, pets: 1 } });
    reminder = mission.actions.find(action => action.kind === 'household_reminder');
    record('Mission prepared', { missionId: mission.id, pendingApprovals: mission.actions.filter(a => a.status === 'awaiting_approval').length,
      planHash: mission.planHash, weather: 'Synthetic fixture, not live NWS' });
    $('blocked').disabled = false; await runtime();
    $('caption').textContent = 'Read-only planning is complete. Two actions still require explicit approval.';
  },
  blocked: async () => {
    const result = await tool('hearthline_execute_approved', { missionId: mission.id, actionId: reminder.id, operationId }, true);
    const state = await runtime();
    assert(result.isError === true && state.outboxCount === 0 && state.receiptCount === 0, 'Unapproved execution was not rejected');
    evidence.assertions.unapprovedExecutionRejected = true;
    record('Unapproved call rejected', { rejected: result.isError, reason: result.content[0].text, outboxCount: state.outboxCount });
    $('approve').disabled = false;
    $('caption').textContent = 'The actual server rejects execution. The local outbox remains empty.';
  },
  approve: async () => {
    const result = await tool('hearthline_approve_action', { missionId: mission.id, actionId: reminder.id, planHash: mission.planHash, operationId });
    const value = result.structuredContent;
    record('Explicit approval bound', { operationId: value.approval.operationId, actionStatus: value.action.status,
      approvalDigest: value.approval.approvalDigest, authorityCeiling: value.approval.authorityCeiling });
    $('execute').disabled = false;
    $('caption').textContent = 'Approval is bound to this operation and exact plan. Approval is not execution.';
  },
  execute: async () => {
    const result = await tool('hearthline_execute_approved', { missionId: mission.id, actionId: reminder.id, operationId });
    firstReceipt = result.structuredContent.receipt;
    const state = await runtime();
    assert(state.outboxCount === 1 && state.receiptCount === 1, 'First execution did not create exactly one local result');
    record('First durable execution', { receiptId: firstReceipt.id, receiptDigest: firstReceipt.receiptDigest,
      semantics: firstReceipt.semantics, outboxCount: state.outboxCount, delivery: 'Local demo outbox, not a sent message' });
    $('restart').disabled = false;
    $('caption').textContent = 'One local outbox item. One durable receipt. Nothing was sent to a household.';
  },
  restart: async () => {
    const before = await runtime();
    const response = await fetch('/demo/restart', { method: 'POST' });
    assert(response.ok, 'Backend restart failed');
    const restarted = await response.json();
    assert(restarted.backendPid !== before.backendPid, 'Backend process did not change');
    await connect();
    const listed = await tool('hearthline_list_missions', {});
    assert(listed.structuredContent.missions.some(m => m.id === mission.id), 'Mission did not survive restart');
    const replay = (await tool('hearthline_execute_approved', { missionId: mission.id, actionId: reminder.id, operationId })).structuredContent;
    const state = await runtime();
    assert(replay.replayed === true && replay.receipt.id === firstReceipt.id && replay.receipt.receiptDigest === firstReceipt.receiptDigest && state.outboxCount === 1 && state.receiptCount === 1, 'Restart replay duplicated or changed the execution');
    Object.assign(evidence.assertions, { realProcessRestart: true, sameReceiptAfterRestart: true, noDuplicateOutbox: true });
    record('Restart recovery and idempotent replay', { previousPid: before.backendPid, newPid: restarted.backendPid,
      replayed: replay.replayed, sameReceipt: replay.receipt.id === firstReceipt.id, receiptId: replay.receipt.id,
      outboxCount: state.outboxCount, receiptCount: state.receiptCount });
    $('shopping').disabled = false;
    $('caption').textContent = 'A new server process, a new MCP session, the same receipt. No duplicate effect.';
  },
  shopping: async () => {
    const action = mission.actions.find(a => a.kind === 'shopping_proposal');
    const shoppingId = 'recorded-shopping-operation';
    await tool('hearthline_approve_action', { missionId: mission.id, actionId: action.id, planHash: mission.planHash, operationId: shoppingId });
    const result = (await tool('hearthline_execute_approved', { missionId: mission.id, actionId: action.id, operationId: shoppingId })).structuredContent;
    const output = result.mission.actions.find(a => a.id === action.id).output;
    assert(output.status === 'prepared_not_purchased', 'Shopping result was not a non-purchase handoff');
    const state = await runtime(); evidence.assertions.shoppingNotPurchased = true; evidence.finalRuntime = state;
    record('Shopping handoff only', { status: output.status, items: output.items, note: output.note, missionStatus: mission.status });
    $('export').disabled = false;
    $('caption').textContent = 'Shopping is prepared, not purchased. The complete mission and both receipts remain durable.';
  },
  export: async () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'hearthline-live-evidence.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
for (const [id, operation] of Object.entries(operations)) $(id).addEventListener('click', async () => {
  const enabled = [...document.querySelectorAll('button:not(:disabled)')];
  enabled.forEach(button => button.disabled = true); $('status').textContent = 'Calling the local server…';
  try { await operation(); $('status').textContent = 'Actual server result received'; $('stage').textContent = `Completed: ${id}`; }
  catch (error) { $('status').textContent = `ERROR: ${error.message}`; $('stage').textContent = `Failed: ${id}`; enabled.forEach(button => button.disabled = false); evidence.error = error.message; }
  if (id === 'export') $('export').disabled = false;
});
