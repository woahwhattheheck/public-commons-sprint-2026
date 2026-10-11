const $ = id => document.getElementById(id);
let state = null;
let pending = null;
let lastResponse = 'I can help coordinate event coverage.';
let busy = false;
async function api(path, body) {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { code: result.code });
  return result;
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}
function appendLine(who, message) {
  const article = node('article', who === 'human' ? 'human' : 'bot');
  article.append(node('strong', '', who === 'human' ? 'You' : 'ShiftLoom'));
  article.append(node('p', '', message));
  $('conversation').append(article);
  $('conversation').scrollTop = $('conversation').scrollHeight;
  if (who === 'bot') lastResponse = message;
}
function renderBoard(next) {
  state = next;
  $('revision').textContent = `Revision ${state.revision}`;
  $('undo').disabled = !state.canUndo;
  const holder = $('shifts'); holder.replaceChildren();
  for (const shift of state.shifts) {
    const card = node('article', 'shift');
    const top = node('div', 'shift-top'), left = node('div');
    left.append(node('h3', '', shift.label));
    const clock = s => new Date(`${s}Z`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    left.append(node('div', 'time', `${clock(shift.start)}–${clock(shift.end)} · ${shift.id}`));
    top.append(left, node('span', shift.assigned.length >= shift.capacity ? 'count ok' : 'count', `${shift.assigned.length}/${shift.capacity} covered`));
    card.append(top, node('p', 'skills', `Required: ${shift.required.join(' & ')}`));
    const members = node('div');
    for (const id of shift.assigned) members.append(node('span', 'chip', state.volunteers.find(v => v.id === id)?.name || id));
    card.append(members); holder.append(card);
  }
}
function renderTrace(trace) {
  const items = $('trace-list'); items.replaceChildren();
  $('trace').hidden = !trace?.length;
  for (const step of trace || []) {
    const item = node('li'); item.append(node('b', '', step.tool.replaceAll('_', ' ') + ' → '), document.createTextNode(step.result)); items.append(item);
  }
}
function hideProposal() { pending = null; $('proposal').hidden = true; $('proposal-changes').replaceChildren(); }
function showProposal(result) {
  pending = result.ok && result.proposalId ? result : null;
  $('proposal').hidden = !pending;
  if (!pending) return;
  $('proposal-summary').textContent = `${pending.shift.label}: ${pending.chosen.map(x => `${x.name} (${x.currentAssignments} other current shift${x.currentAssignments === 1 ? '' : 's'})`).join(', ')}. All constraints passed. Revision ${pending.originalRevision}.`;
  const list = $('proposal-changes'); list.replaceChildren();
  for (const c of pending.changes) list.append(node('li', '', `${c.action === 'add' ? 'Assign' : 'Remove'} ${c.name} · ${pending.shift.label}`));
}
async function refresh() {
  try {
    const next = await api('state');
    if (state && next.sessionStarted) {
      renderTrace([]);
      appendLine('bot', 'The previous local event ended. This is a fresh sample event; earlier approvals and proposals have not been carried over.');
    }
    renderBoard(next);
    if (next.pending) showProposal({ ...next.pending, proposalId: next.pending.id });
    else hideProposal();
    $('session-status').textContent = 'This browser keeps its own sample event. Tabs share it; private windows start separately. One hour idle clears it.';
  } catch (error) {
    state = null; hideProposal(); renderTrace([]);
    $('shifts').replaceChildren();
    $('revision').textContent = 'Event unavailable';
    $('session-status').textContent = error.message + ' Use Refresh event to try again.';
    throw error;
  } finally { setBusy(busy); }
}
async function recover(prefix, error) {
  appendLine('bot', `${prefix}: ${error.message}`);
  if (error.code === 'session_expired') {
    state = null;
    hideProposal(); renderTrace([]);
    appendLine('bot', 'The previous local event expired or the server restarted. Opening a fresh sample event; please review a new plan before approving.');
  }
  try { await refresh(); }
  catch (refreshError) { appendLine('bot', `Unable to refresh the event: ${refreshError.message}`); }
}
function setBusy(value) {
  busy = value;
  const unavailable = value || !state;
  $('ask-button').disabled = unavailable;
  $('command').disabled = unavailable;
  $('approve').disabled = unavailable || !pending;
  $('dismiss').disabled = unavailable || !pending;
  $('undo').disabled = unavailable || !state?.canUndo;
  $('reset').disabled = unavailable;
  $('refresh').disabled = value;
  for (const button of document.querySelectorAll('.example')) button.disabled = unavailable;
}
$('ask').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy || !state) return;
  const command = $('command').value.trim();
  if (!command) return;
  hideProposal(); setBusy(true); appendLine('human', command);
  try {
    const result = await api('plan', { command });
    appendLine('bot', result.message);
    renderTrace(result.trace);
    showProposal(result);
    $('command').value = '';
  } catch (e) { await recover("I couldn't plan that", e); }
  finally { setBusy(false); }
});
for (const btn of document.querySelectorAll('.example')) btn.addEventListener('click', () => {
  $('command').value = btn.dataset.prompt;
  $('ask').requestSubmit();
});
$('approve').addEventListener('click', async () => {
  if (!pending || busy) return;
  setBusy(true);
  try {
    const result = await api('approve', { proposalId: pending.proposalId, expectedRevision: pending.originalRevision });
    appendLine('bot', result.message);
    hideProposal(); renderTrace([{ tool: 'human_approval', result: 'Approved and committed to local schedule' }]);
    await refresh();
  } catch (e) { hideProposal(); await recover('Approval rejected', e); }
  finally { setBusy(false); }
});
$('dismiss').addEventListener('click', async () => {
  if (!pending || busy) return;
  const proposalId = pending.proposalId;
  setBusy(true);
  try {
    await api('dismiss', { proposalId });
    hideProposal(); appendLine('bot', 'Dismissed. No schedule changes were made.');
  } catch (e) { await recover('Dismissal not confirmed', e); }
  finally { setBusy(false); }
});
$('undo').addEventListener('click', async () => {
  if (busy || !state) return;
  setBusy(true);
  try { const result = await api('undo', { expectedRevision: state.revision }); appendLine('bot', result.message); hideProposal(); await refresh(); }
  catch (e) { await recover('Undo declined', e); }
  finally { setBusy(false); }
});
$('reset').addEventListener('click', async () => {
  if (busy || !state || !confirm('Reset this browser’s fictional event and discard its approvals?')) return;
  setBusy(true);
  try { const result = await api('reset', { expectedRevision: state.revision }); appendLine('bot', result.message); hideProposal(); renderTrace([]); await refresh(); }
  catch (e) { await recover('Reset failed', e); }
  finally { setBusy(false); }
});
$('refresh').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try { await refresh(); appendLine('bot', 'The board and pending proposal now match this browser’s current event.'); }
  catch (e) { appendLine('bot', `Unable to load the local event: ${e.message}`); }
  finally { setBusy(false); }
});
$('listen').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) { appendLine('bot', 'Browser speech output is unavailable. Please read the message above.'); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(lastResponse);
  utterance.rate = 0.94;
  window.speechSynthesis.speak(utterance);
});
setBusy(true);
refresh().catch(e => appendLine('bot', `Unable to load local event: ${e.message}`)).finally(() => setBusy(false));
