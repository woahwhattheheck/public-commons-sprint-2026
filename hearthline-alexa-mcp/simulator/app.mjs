import { commandForKey, createOperation, dispatch, exportOperation } from './state.mjs';

const byId = (id) => document.getElementById(id);
const operations = new Map();
let selectedId = null;
let serial = 0;

const fixtureEvidence = (id, note) => ({
  id,
  digest: id === 'sensor-brief'
    ? '3df2c04b98ef9bb7a908b78d405d49217fb96516edaa9bd62328268930c77924'
    : 'd5f9441d0056ade5b3b6c361f71ee5ef7dd67410bcd964bf60e012cf2319ad86',
  note,
  capturedAt: '2026-09-13T10:45:00Z',
});

function commandId(kind) {
  serial += 1;
  return `ui-${kind}-${String(serial).padStart(4, '0')}`;
}

function seed() {
  const routine = createOperation({
    id: 'op-routine-summary',
    title: 'Summarize home sensor alerts',
    summary: 'Compile an evidence-only household status brief. This local demo performs no provider action.',
    authority: 'ROUTINE',
    evidence: [fixtureEvidence('sensor-brief', 'Synthetic sensor snapshot for the judge demo.')],
  });
  const irreversible = createOperation({
    id: 'op-plumber-booking',
    title: 'Book an emergency plumber',
    summary: 'Illustrates a high-authority action. Approval changes only this local simulator; no call, booking, payment, or contract is sent.',
    authority: 'IRREVERSIBLE',
    evidence: [fixtureEvidence('quote-brief', 'Synthetic quote evidence for the judge demo.')],
  });
  operations.set(routine.id, routine);
  operations.set(irreversible.id, irreversible);
  selectedId = irreversible.id;
}

function selected() {
  return operations.get(selectedId);
}

function update(operation) {
  operations.set(operation.id, operation);
  selectedId = operation.id;
  render();
}

function apply(command) {
  try {
    const result = dispatch(selected(), command);
    update(result.operation);
    announce(result.replayed ? 'Replay accepted without duplicating state.' : `Recorded ${command.type}.`);
  } catch (error) {
    announce(error.message, true);
  }
}

function statusClass(status) {
  if (status === 'EXECUTED') return 'ok';
  if (status === 'DENIED' || status === 'RECONCILIATION_REQUIRED') return 'warn';
  if (status === 'DECISION_REQUIRED') return 'decision';
  return 'neutral';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function announce(message, error = false) {
  const region = byId('announcer');
  region.textContent = message;
  region.dataset.error = String(error);
}

function renderList() {
  byId('operation-list').innerHTML = [...operations.values()].map((op) => `
    <button class="operation-row ${op.id === selectedId ? 'selected' : ''}" data-select="${escapeHtml(op.id)}" aria-pressed="${op.id === selectedId}">
      <span>${escapeHtml(op.title)}</span>
      <small>${escapeHtml(op.authority)} · ${escapeHtml(op.status)}</small>
    </button>`).join('');
}

function renderCard() {
  const op = selected();
  const decision = op.authority === 'IRREVERSIBLE' && op.status === 'DECISION_REQUIRED';
  byId('decision-card').innerHTML = `
    <div class="card-head">
      <div><p class="eyebrow">${escapeHtml(op.authority)} · attempt ${op.attemptGeneration}</p><h2>${escapeHtml(op.title)}</h2></div>
      <span class="status ${statusClass(op.status)}">${escapeHtml(op.status.replaceAll('_', ' '))}</span>
    </div>
    <p>${escapeHtml(op.summary)}</p>
    ${decision ? '<div class="decision-callout" role="note"><strong>Decision required.</strong> Nothing irreversible can execute until you explicitly approve this exact operation.</div>' : ''}
    <div class="actions" aria-label="Operation actions">
      <button data-action="approve" ${decision ? '' : 'disabled'}>Approve <kbd>Alt+A</kbd></button>
      <button data-action="deny" class="secondary" ${decision ? '' : 'disabled'}>Deny <kbd>Alt+D</kbd></button>
      <button data-action="execute" ${['READY', 'APPROVED'].includes(op.status) ? '' : 'disabled'}>Simulate execution <kbd>Alt+E</kbd></button>
      <button data-action="unknown" class="secondary" ${['READY', 'APPROVED'].includes(op.status) ? '' : 'disabled'}>Simulate unknown outcome</button>
      <button data-action="reconcile-not" ${op.status === 'RECONCILIATION_REQUIRED' ? '' : 'disabled'}>Reconcile: not executed <kbd>Alt+R</kbd></button>
      <button data-action="reconcile-done" class="secondary" ${op.status === 'RECONCILIATION_REQUIRED' ? '' : 'disabled'}>Reconcile: executed</button>
    </div>`;
}

function renderEvidence() {
  const op = selected();
  byId('evidence').innerHTML = op.evidence.map((item) => `
    <li><strong>${escapeHtml(item.id)}</strong><span>${escapeHtml(item.note)}</span><code>${escapeHtml(item.digest.slice(0, 16))}…</code></li>`).join('');
  byId('timeline').innerHTML = op.transcript.slice().reverse().map((row) => `
    <li><time>${escapeHtml(row.at)}</time><strong>${escapeHtml(row.type)}</strong><span>${escapeHtml(row.detail)}</span></li>`).join('');
  byId('export').textContent = exportOperation(op);
}

function render() {
  renderList();
  renderCard();
  renderEvidence();
}

function handleAction(action) {
  const op = selected();
  if (action === 'approve') return apply({ id: commandId('approve'), type: 'approve' });
  if (action === 'deny') return apply({ id: commandId('deny'), type: 'deny', reason: 'Denied in local judge simulation' });
  if (action === 'execute') return apply({ id: commandId('execute'), type: 'execute', outcome: 'success' });
  if (action === 'unknown') return apply({ id: commandId('execute'), type: 'execute', outcome: 'unknown' });
  if (action === 'reconcile-not') return apply({ id: commandId('reconcile'), type: 'reconcile', finding: 'not_executed' });
  if (action === 'reconcile-done') return apply({ id: commandId('reconcile'), type: 'reconcile', finding: 'executed' });
  if (action === 'reset') {
    operations.clear(); serial = 0; seed(); render(); announce('Demo reset.');
  }
  if (action === 'copy') {
    navigator.clipboard?.writeText(exportOperation(op)).then(
      () => announce('Deterministic receipt copied.'),
      () => announce('Clipboard unavailable; receipt remains visible below.', true),
    );
  }
}

document.addEventListener('click', (event) => {
  const select = event.target.closest('[data-select]');
  if (select) { selectedId = select.dataset.select; render(); return; }
  const action = event.target.closest('[data-action]');
  if (action && !action.disabled) handleAction(action.dataset.action);
});

document.addEventListener('keydown', (event) => {
  const command = commandForKey(event);
  if (!command) return;
  event.preventDefault();
  if (command === 'reconcile') handleAction('reconcile-not');
  else handleAction(command);
});

seed();
render();
byId('decision-card').focus();
