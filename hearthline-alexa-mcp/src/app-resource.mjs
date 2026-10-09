export const APP_URI = 'ui://hearthline/mission-dashboard.html';
export const APP_MIME = 'text/html;profile=mcp-app';

export function dashboardHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hearthline Mission Dashboard</title>
<style>
:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0;padding:18px;background:Canvas;color:CanvasText}.wrap{max-width:760px;margin:auto}.hero{display:flex;justify-content:space-between;gap:12px;align-items:center}h1{margin:0 0 4px}.badge{border:1px solid color-mix(in srgb,CanvasText 25%,transparent);border-radius:999px;padding:5px 10px;font-size:12px}.card{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:14px;padding:14px;margin:12px 0}.muted{opacity:.7}.actions{display:grid;gap:8px}.action{padding:12px;border-radius:10px;background:color-mix(in srgb,CanvasText 6%,Canvas)}.action p{margin:6px 0 10px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button{font:inherit;padding:8px 12px;border:1px solid color-mix(in srgb,CanvasText 30%,Canvas);border-radius:8px;background:Canvas;color:CanvasText;cursor:pointer}button:hover:enabled{background:color-mix(in srgb,CanvasText 10%,Canvas)}button:disabled{opacity:.5;cursor:not-allowed}pre{white-space:pre-wrap;word-break:break-word;font-size:12px}.err{color:crimson}.notice{min-height:22px;margin:12px 0}details{margin-top:12px}.small{font-size:12px}
</style></head><body><main class="wrap"><div class="hero"><div><h1>Hearthline</h1><div class="muted">Stateful household mission control</div></div><span id="status" class="badge">connecting</span></div>
<p class="small muted">Local demo effects only. Shopping creates a handoff, never a purchase. Reminders remain in the local outbox.</p>
<div class="toolbar"><button id="refresh" disabled>Refresh mission</button><span id="connection" class="small muted">Connecting to the MCP Apps host…</span></div>
<p id="notice" class="notice" role="status" aria-live="polite"></p><section id="root" class="card"><p>Waiting for a mission from the host.</p></section>
<details id="receipt-box" hidden><summary>Latest execution receipt</summary><pre id="receipt"></pre></details></main>
<script>(${dashboardRuntime.toString()})();</script></body></html>`;
}

// Runs inside the resource's sandboxed iframe; all server access stays mediated
// by the host. No credentials, fetch() calls, automatic approval, or polling.
function dashboardRuntime() {
  const root = document.getElementById('root');
  const status = document.getElementById('status');
  const connection = document.getElementById('connection');
  const notice = document.getElementById('notice');
  const refresh = document.getElementById('refresh');
  const receiptBox = document.getElementById('receipt-box');
  const receipt = document.getElementById('receipt');
  const protocolVersion = '2026-01-26';
  const instance = globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + '-' + Math.random();
  const initId = 'hearthline-ui-init-' + instance;
  const pending = new Map();
  let sequence = 0, ready = false, serverTools = false, busy = false, needsRefresh = false;
  let mission = null, parentOrigin = null;

  function post(message) { window.parent.postMessage(message, parentOrigin || '*'); }
  function message(text, error = false) { notice.textContent = text; notice.className = error ? 'notice err' : 'notice'; }
  function pickMission(value) {
    if (!value || typeof value !== 'object' || value.isError) return null;
    const candidate = value.mission ?? value.structuredContent?.mission ?? value.params?.structuredContent?.mission ?? value.result?.structuredContent?.mission;
    return candidate && typeof candidate.id === 'string' && Array.isArray(candidate.actions) ? candidate : null;
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function render() {
    refresh.disabled = !ready || !serverTools || busy || !mission;
    status.textContent = mission?.status ?? (ready ? 'ready' : 'connecting');
    if (!mission) return;
    root.replaceChildren(node('h2', mission.title || mission.id), node('p', mission.id, 'muted small'));
    const actions = node('div', undefined, 'actions');
    for (const action of mission.actions) {
      const card = node('div', undefined, 'action');
      card.dataset.actionId = action.id;
      card.append(node('strong', String(action.kind).replaceAll('_', ' ')), node('span', ' · ' + action.status, 'small'), node('p', action.summary || ''));
      const local = action.kind === 'shopping_proposal' || action.kind === 'household_reminder';
      if (local && action.risk === 'external_commit') {
        const actionButton = node('button');
        let verb = null;
        if (action.status === 'awaiting_approval') { verb = 'approve'; actionButton.textContent = action.kind === 'shopping_proposal' ? 'Approve local handoff' : 'Approve local reminder'; }
        else if (action.status === 'approved') { verb = 'execute'; actionButton.textContent = 'Execute approved local action'; }
        else if (action.status === 'complete') { verb = 'replay'; actionButton.textContent = 'Replay original receipt'; }
        if (verb) {
          actionButton.dataset.verb = verb;
          actionButton.disabled = !ready || !serverTools || busy || needsRefresh || (verb !== 'approve' && !action.operationId);
          actionButton.addEventListener('click', () => act(action.id, verb));
          card.append(actionButton);
        }
      }
      actions.append(card);
    }
    const details = node('details');
    details.append(node('summary', 'Plan and weather evidence'), node('pre', JSON.stringify({ planHash: mission.planHash, alertsSummary: mission.alertsSummary }, null, 2)));
    root.append(actions, details);
  }
  function callTool(name, args) {
    if (!ready || !serverTools) return Promise.reject(new Error('This host does not support server tool calls.'));
    const id = 'hearthline-call-' + instance + '-' + ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host response timed out. The outcome is unknown; refresh before another action.')); }, 30000);
      pending.set(id, { resolve, reject, timer });
      try { post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  async function act(actionId, verb) {
    if (busy || needsRefresh || !mission) return;
    const target = mission.actions.find(action => action.id === actionId);
    if (!target) return;
    const missionId = mission.id;
    busy = true; message(verb === 'approve' ? 'Requesting approval for the displayed local action…' : 'Requesting the approved operation…'); render();
    try {
      const args = { missionId, actionId };
      let tool;
      if (verb === 'approve') {
        if (target.status !== 'awaiting_approval') throw new Error('Refresh the changed action before approving.');
        args.planHash = mission.planHash;
        // Same displayed action + plan retries bind to the same durable operation.
        args.operationId = 'ui:' + actionId + ':' + String(mission.planHash).slice(0, 48);
        tool = 'hearthline_approve_action';
      } else {
        if (!target.operationId) throw new Error('Refresh to recover the approved operation ID.');
        args.operationId = target.operationId;
        tool = 'hearthline_execute_approved';
      }
      const result = await callTool(tool, args);
      const updated = pickMission(result);
      if (!updated || updated.id !== missionId) throw new Error('No matching mission was returned. Refresh to reconcile the outcome.');
      if (mission?.id === missionId) {
        mission = updated;
        const evidence = result.structuredContent;
        if (evidence?.receipt) { receipt.textContent = JSON.stringify({ ...evidence.receipt, replayed: evidence.replayed }, null, 2); receiptBox.hidden = false; }
        message(verb === 'approve' ? 'Approved. Nothing has executed; use the separate execution control.' : evidence?.replayed ? 'Original receipt replayed. No duplicate local effect.' : 'Local action completed. The server returned an execution receipt.');
      }
    } catch (error) { needsRefresh = true; message(error.message || 'Host request failed. Refresh to reconcile the outcome.', true); }
    finally { busy = false; render(); }
  }
  refresh.addEventListener('click', async () => {
    if (busy || !mission) return;
    const missionId = mission.id;
    busy = true; message('Reading durable mission state…'); render();
    try {
      const updated = pickMission(await callTool('hearthline_get_mission', { missionId }));
      if (!updated || updated.id !== missionId) throw new Error('The host did not return the requested mission.');
      if (mission?.id === missionId) { mission = updated; needsRefresh = false; message('Mission refreshed from the server.'); }
    } catch (error) { needsRefresh = true; message(error.message || 'Refresh failed.', true); }
    finally { busy = false; render(); }
  });
  const initTimer = setTimeout(() => { if (!ready) { connection.textContent = 'Host initialization did not complete; view only.'; message('Reconnect through a compatible MCP Apps host.', true); } }, 15000);
  window.addEventListener('message', event => {
    if (event.source !== window.parent || (parentOrigin && event.origin !== parentOrigin)) return;
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.id === initId && !ready) {
      clearTimeout(initTimer);
      if (msg.error || msg.result?.protocolVersion !== protocolVersion || !msg.result?.hostCapabilities) {
        connection.textContent = 'Host initialization rejected; view only.'; message(msg.error?.message || 'Incompatible MCP Apps initialization response.', true); return;
      }
      if (event.origin && event.origin !== 'null') parentOrigin = event.origin;
      ready = true;
      serverTools = typeof msg.result.hostCapabilities.serverTools === 'object' && msg.result.hostCapabilities.serverTools !== null;
      connection.textContent = serverTools ? 'Connected · host-mediated controls' : 'Connected · view-only host';
      post({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
      render(); return;
    }
    if (pending.has(msg.id) && ('result' in msg || 'error' in msg)) {
      const request = pending.get(msg.id); pending.delete(msg.id); clearTimeout(request.timer);
      if (msg.error) request.reject(new Error(msg.error.message || 'Host rejected the request.'));
      else if (msg.result?.isError) request.reject(new Error((msg.result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n') || 'Server rejected the tool call.'));
      else request.resolve(msg.result);
      return;
    }
    if (msg.method === 'ui/notifications/tool-result') {
      const incoming = pickMission(msg.params);
      if (incoming) {
        if (mission?.id !== incoming.id) { receiptBox.hidden = true; needsRefresh = false; }
        mission = incoming; render();
      }
    }
  });
  post({ jsonrpc: '2.0', id: initId, method: 'ui/initialize', params: { protocolVersion, appInfo: { name: 'Hearthline Mission Dashboard', version: '0.2.0' }, appCapabilities: {} } });
}
