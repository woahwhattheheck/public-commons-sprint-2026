import { createWorkboard } from './workboard-ui.mjs';

const $ = id => document.getElementById(id);
let session, protocol, nextId = 1, mission, lastExecution, busy = false, connected = false, needsRefresh = false;
let missions = [];
const rememberedMissionKey = 'hearthline.open-mission';
const workboardUI = createWorkboard({ tool, run, event, verdict });
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
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function rememberMission(id) { try { sessionStorage.setItem(rememberedMissionKey, id); } catch {} }
function rememberedMission() { try { return sessionStorage.getItem(rememberedMissionKey); } catch { return null; } }
function updateControls() {
  const action = selected(), unavailable = busy || !connected;
  $('prepare').disabled = unavailable;
  $('refresh-missions').disabled = unavailable;
  $('mission-picker').disabled = unavailable || !missions.length;
  $('open-mission').disabled = unavailable || !missions.length;
  $('action').disabled = unavailable || !mission;
  $('probe').disabled = unavailable || needsRefresh || action?.status !== 'awaiting_approval';
  $('approve').disabled = unavailable || needsRefresh || action?.status !== 'awaiting_approval';
  $('execute').disabled = unavailable || needsRefresh || action?.status !== 'approved' || !action.operationId;
  $('replay').disabled = unavailable || needsRefresh || !lastExecution;
  $('restart').disabled = busy;
  $('export').disabled = unavailable;
  $('download-workspace').disabled = unavailable;
  workboardUI.setBusy(unavailable);
}
function renderHistory() {
  const previous = $('mission-picker').value;
  $('mission-picker').replaceChildren();
  for (const saved of missions) {
    const option = node('option', `${saved.title} · ${saved.status.replaceAll('_', ' ')} · ${new Date(saved.createdAt).toLocaleString()}`);
    option.value = saved.id;
    $('mission-picker').append(option);
  }
  if (missions.some(item => item.id === (mission?.id ?? previous))) $('mission-picker').value = mission?.id ?? previous;
  $('history-empty').hidden = missions.length > 0;
  $('workspace-missions').textContent = missions.length;
  updateControls();
}
function renderActionDetails() {
  const action = selected(), details = $('action-detail');
  details.replaceChildren();
  if (!action) return;
  const complete = action.status === 'complete';
  details.append(node('h3', action.kind === 'shopping_proposal' ? 'Your shopping handoff' : 'Your household reminder'));
  details.append(node('p', complete ? 'Completed locally. This is the saved result.' : action.status === 'approved' ? 'Approved and saved. Execution is a separate step.' : 'Review this content before approving.', 'action-state'));
  const content = complete ? action.output : action.payload;
  if (action.kind === 'shopping_proposal') {
    const list = node('ul', undefined, 'shopping-list');
    for (const item of content?.items ?? []) list.append(node('li', `${item.quantity} × ${String(item.item).replaceAll('_', ' ')}`));
    details.append(list, node('p', 'A local handoff only; no order or purchase has been placed.', 'hint'));
  } else {
    details.append(node('blockquote', content?.message ?? 'No message returned.'), node('p', 'Local household outbox only; no message has been delivered.', 'hint'));
  }
  updateControls();
}
function render() {
  $('controls').hidden = !mission;
  $('mission-status').textContent = mission ? mission.status.replaceAll('_', ' ') : 'Not created';
  if (!mission) { $('mission-title').textContent = 'Storm-readiness mission'; $('mission-context').textContent = ''; updateControls(); return; }
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
  const selectable = [...$('action').options].map(option => option.value);
  if (selectable.includes(oldSelection)) $('action').value = oldSelection;
  else $('action').value = mission.actions.find(a => selectable.includes(a.id) && a.status === 'approved')?.id
    ?? mission.actions.find(a => a.kind === 'household_reminder')?.id ?? $('action').value;
  const index = missions.findIndex(item => item.id === mission.id);
  if (index < 0) missions.unshift(mission); else missions[index] = mission;
  rememberMission(mission.id);
  $('mission-context').textContent = `Created ${new Date(mission.createdAt).toLocaleString()} · Updated ${new Date(mission.updatedAt).toLocaleString()}`;
  renderHistory(); renderActionDetails();
}
$('action').addEventListener('change', renderActionDetails);
async function status() {
  const response = await fetch('/demo/status'); if (!response.ok) throw new Error('Runtime status unavailable');
  const value = await response.json();
  $('generation').textContent = `${value.generation} / PID ${value.pid}`;
  $('outbox').textContent = `${value.localOutboxItems} item${value.localOutboxItems === 1 ? '' : 's'}`;
  $('receipts').textContent = value.receipts;
  $('workspace-storage').textContent = value.persistent ? 'Saved on this computer' : 'Temporary session';
  $('workspace-missions').textContent = value.missions;
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
  connected = false; updateControls();
  const info = await rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'Hearthline browser demonstration', version: '1.0.0' }, capabilities: {} }, { initialize: true });
  protocol = info.protocolVersion;
  if (!session || protocol !== '2025-11-25') throw new Error('Unexpected MCP negotiation');
  await rpc('notifications/initialized', {}, { notification: true });
  const tools = await rpc('tools/list');
  $('protocol').textContent = `MCP ${protocol}`;
  $('connection').textContent = `● Connected · ${tools.tools.length} tools · loopback HTTP`;
  event(`Connected to ${info.serverInfo.name}`, { protocol, tools: tools.tools.map(t => t.name) });
  connected = true;
  await status();
  await refreshMissions({ resume: true });
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
function operationArgs(action) {
  if (!mission || !action?.operationId) throw new Error('Refresh the mission to recover its approved operation.');
  return { missionId: mission.id, actionId: action.id, operationId: action.operationId };
}
async function restoreLastExecution() {
  lastExecution = null;
  $('receipt').textContent = 'No execution for this mission yet.';
  const completed = mission?.actions.filter(action => action.status === 'complete' && action.operationId)
    .sort((a, b) => String(b.executedAt).localeCompare(String(a.executedAt))) ?? [];
  if (!completed.length) return;
  const action = completed[0], args = operationArgs(action);
  const { operation } = await tool('hearthline_get_operation', { operationId: args.operationId });
  if (operation.status !== 'complete' || operation.approval.missionId !== args.missionId || operation.approval.actionId !== args.actionId || !operation.receiptDigest)
    throw new Error('Saved operation does not match this completed action. Refresh the mission.');
  lastExecution = { args, expectedReceiptDigest: operation.receiptDigest, receipt: null };
  $('receipt').textContent = 'A completed operation is saved. Use “Replay last execution” to retrieve its original receipt.';
}
async function openMission(id) {
  needsRefresh = true; lastExecution = null; updateControls();
  const result = await tool('hearthline_get_mission', { missionId: id });
  if (result.mission?.id !== id) throw new Error('The server did not return the requested mission.');
  await restoreLastExecution();
  await workboardUI.open(mission.id);
  needsRefresh = false; render();
  event('Saved mission opened without changing any action', { missionId: mission.id });
  verdict('Saved plan reopened. Review the selected action; existing approvals and completed results are retained.');
}
async function refreshMissions({ resume = false } = {}) {
  const result = await tool('hearthline_list_missions', {});
  missions = result.missions;
  const wanted = mission?.id ?? rememberedMission();
  if (resume || mission) {
    const saved = missions.find(item => item.id === wanted) ?? (resume ? missions[0] : null);
    if (saved) await openMission(saved.id);
    else if (mission) { mission = null; lastExecution = null; needsRefresh = false; $('actions').replaceChildren(); $('mission-context').textContent = ''; render(); }
  }
  renderHistory();
  if (!mission) await workboardUI.open(null);
}
async function run(action) {
    if (busy) return;
    busy = true; updateControls();
    try { await action(); }
    catch (error) {
      needsRefresh = true;
      // Reconcile a rejected or uncertain operation with read-only tools. Never
      // silently reapprove, execute, or retry the action that just failed.
      if (mission && connected) {
        try { await openMission(mission.id); }
        catch { needsRefresh = true; }
      }
      event('Operation failed', { error: error.message });
      verdict(`Stopped: ${error.message}${needsRefresh ? ' Refresh saved missions before another action.' : ' Current saved state is shown.'}`);
    }
    finally { busy = false; updateControls(); }
}
function bind(id, action) { $(id).addEventListener('click', () => void run(action)); }
bind('refresh-missions', () => refreshMissions());
bind('open-mission', () => openMission($('mission-picker').value));
bind('prepare', async () => {
  await tool('hearthline_prepare_storm', { title: 'Get the household storm-ready', latitude: 38.2, longitude: -85.7, household: { people: 2, pets: 1 } });
  await workboardUI.open(mission.id);
  lastExecution = null; needsRefresh = false; $('receipt').textContent = 'No execution for this mission yet.'; render();
  event('Mission created; local actions await approval', { missionId: mission.id, planHash: mission.planHash });
  verdict('Plan prepared. Nothing purchased or sent. Each local action requires an explicit approval.'); await status();
});
bind('probe', async () => {
  const action = selected(); if (!action || action.status !== 'awaiting_approval') throw new Error('Choose an action still awaiting approval.');
  const response = await tool('hearthline_execute_approved', { missionId: mission.id, actionId: action.id, operationId: `demo-${action.id}` }, true);
  verdict(`Correctly blocked: ${response.message}`); await status();
});
bind('approve', async () => {
  const action = selected(); if (!action || action.status !== 'awaiting_approval') throw new Error('Choose an action awaiting approval.');
  const result = await tool('hearthline_approve_action', { missionId: mission.id, actionId: action.id, planHash: mission.planHash, operationId: `demo-${action.id}` });
  event('Explicit approval bound to this action and plan', { operationId: result.approval.operationId, approvalDigest: result.approval.approvalDigest });
  verdict('Approved, not executed. The stored approval binds the exact action payload and plan hash.'); await status();
});
bind('execute', async () => {
  const action = selected(); if (!action || action.status !== 'approved') throw new Error('Choose an approved action.');
  const args = operationArgs(action);
  const result = await tool('hearthline_execute_approved', args);
  lastExecution = { args, receipt: result.receipt, expectedReceiptDigest: result.receipt.receiptDigest };
  $('receipt').textContent = JSON.stringify(result.receipt, null, 2);
  event('Approved local action completed', { operationId: args.operationId, receipt: result.receipt, replayed: result.replayed });
  verdict(result.replayed ? 'This action was already completed. Its original receipt was returned without another local effect.'
    : action.kind === 'shopping_proposal' ? 'Shopping handoff prepared — no purchase placed.' : 'One reminder stored in the local demo outbox — no message delivered.'); await status();
});
bind('restart', async () => {
  const before = await status();
  const response = await fetch('/demo/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const result = await response.json(); if (!response.ok) throw new Error(result.error);
  await connect();
  const after = await status();
  if (result.pid === result.previousPid || before.pid !== result.previousPid || after.pid !== result.pid) throw new Error('Process restart evidence did not match');
  event('MCP process restarted; durable mission recovered', { restart: result, before, after });
  verdict('New process, same durable mission. Replay the last operation to check it is not duplicated.');
});
bind('replay', async () => {
  if (!lastExecution) throw new Error('Execute one action first.');
  const before = await status(), result = await tool('hearthline_execute_approved', lastExecution.args), after = await status();
  const sameReceipt = result.receipt.receiptDigest === lastExecution.expectedReceiptDigest
    && (!lastExecution.receipt || JSON.stringify(result.receipt) === JSON.stringify(lastExecution.receipt));
  if (!result.replayed || !sameReceipt || before.receipts !== after.receipts || before.localOutboxItems !== after.localOutboxItems) throw new Error('Replay invariant failed');
  lastExecution.receipt = result.receipt;
  $('receipt').textContent = JSON.stringify(result.receipt, null, 2);
  event('Exact receipt replayed; zero duplicate effects', { replayed: result.replayed, sameReceipt, before, after });
  verdict('PASS: same receipt after restart. No new outbox item, no duplicate effect.');
});
bind('export', async () => {
  const packet = { ...evidence, exportedAt: new Date().toISOString(), runtime: await status(), mission, lastExecution, ...workboardUI.snapshot() };
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2) + '\n'], { type: 'application/json' }));
  link.href = url; link.download = 'hearthline-browser-evidence.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
bind('download-workspace', async () => {
  const response = await fetch('/demo/workspace.json');
  if (!response.ok) throw new Error('Saved workspace download failed');
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'hearthline-workspace.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  verdict('Saved workspace downloaded. It contains your retained missions, tasks, notes and stock.');
});
window.hearthlineDemo = { evidence, snapshot: () => ({ mission, lastExecution, ...workboardUI.snapshot() }) };
busy = true; updateControls();
connect().catch(error => { connected = false; $('connection').textContent = 'Connection failed'; event('Connection failed', { error: error.message }); verdict(error.message); })
  .finally(() => { busy = false; updateControls(); });
