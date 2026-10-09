const $ = id => document.getElementById(id);
let state = null;
let pending = null;
let lastResponse = 'I can help coordinate event coverage.';
let busy = false;
async function api(path, body) {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
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
  const next = await api('state');
  renderBoard(next);
  if (next.pending) showProposal({ ...next.pending, proposalId: next.pending.id });
  else hideProposal();
}
function setBusy(value) {
  busy = value;
  $('ask-button').disabled = value;
  $('approve').disabled = value;
  $('undo').disabled = value || !state?.canUndo;
}
$('ask').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy) return;
  const command = $('command').value.trim();
  if (!command) return;
  hideProposal(); setBusy(true); appendLine('human', command);
  try {
    const result = await api('plan', { command });
    appendLine('bot', result.message);
    renderTrace(result.trace);
    showProposal(result);
    $('command').value = '';
  } catch (e) { appendLine('bot', `I couldn't plan that: ${e.message}`); }
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
  } catch (e) { appendLine('bot', `Approval rejected: ${e.message}`); hideProposal(); await refresh(); }
  finally { setBusy(false); }
});
$('dismiss').addEventListener('click', async () => {
  if (!pending || busy) return;
  const proposalId = pending.proposalId;
  setBusy(true);
  try {
    await api('dismiss', { proposalId });
    hideProposal(); appendLine('bot', 'Dismissed. No schedule changes were made.');
  } catch (e) { appendLine('bot', `Dismissal not confirmed: ${e.message}`); await refresh(); }
  finally { setBusy(false); }
});
$('undo').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try { const result = await api('undo', { expectedRevision: state.revision }); appendLine('bot', result.message); hideProposal(); await refresh(); }
  catch (e) { appendLine('bot', `Undo declined: ${e.message}`); await refresh(); }
  finally { setBusy(false); }
});
$('reset').addEventListener('click', async () => {
  if (busy || !confirm('Reset this fictional event and discard all approvals?')) return;
  setBusy(true);
  try { const result = await api('reset', {}); appendLine('bot', result.message); hideProposal(); renderTrace([]); await refresh(); }
  catch (e) { appendLine('bot', `Reset failed: ${e.message}`); }
  finally { setBusy(false); }
});
$('listen').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) { appendLine('bot', 'Browser speech output is unavailable. Please read the message above.'); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(lastResponse);
  utterance.rate = 0.94;
  window.speechSynthesis.speak(utterance);
});
refresh().catch(e => appendLine('bot', `Unable to load local event: ${e.message}`));
