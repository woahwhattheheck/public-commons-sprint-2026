// MIT. Original control state is authoritative; review never silently rebases.
const $ = id => document.getElementById(id);
let session, manifests = [], status = null, capturedAt = null, reviewed = null;
let working = false, loading = false, connected = false, confirmAction = null, timer, outcomeUnknown = false;
const explain = {
  FLEET_REVISION_CHANGED: 'The active revision changed in another operator session. Refresh and review the current state before choosing the change again.',
  FLEET_CANDIDATE_CHANGED: 'Another preparation replaced the reviewed candidate. Review the current candidate before activating.',
  FLEET_CANDIDATE_EXPIRED: 'The candidate expired. Prepare its registered manifest again and review the new result.',
  FLEET_CHANGED_SELLER_REQUIRES_NEW_PORT: 'A changed seller must use a new local port while the original generation is serving or draining. Start the original replacement seller and update the registered manifest.',
  FLEET_SELLER_IDENTITY_DRIFT: 'The running original seller does not match the proposed configuration. Check its routes, offers, admission and payment terms before preparing again.',
  FLEET_SELLER_UNAVAILABLE: 'A required original seller is unavailable or not accepting requests. Restore that seller before preparing or rolling back.',
  FLEET_ROLLBACK_NOT_RETAINED: 'That revision is no longer retained by the original gateway. Refresh the history.',
  FLEET_OPERATION_IN_PROGRESS: 'Another gateway operation is still running. Refresh its state before submitting another change.',
  FLEET_CLOSING: 'The gateway is draining for shutdown. Reopen this workspace after its original process restarts.',
  FLEET_LIVE_CONTROL_DISABLED: 'The original gateway needs durable live control. Start it with its existing --state option.',
  FLEET_CONTROL_REJECTED: 'The original gateway rejected the operation. Check the registered manifest and original seller processes with the control CLI.',
  FLEET_CONTROL_TIMEOUT: 'The control response did not arrive. Refresh and inspect the current revision and candidate before retrying any action.',
  ORIGINAL_SELLER_PROBE_TIMEOUT: 'The original seller did not respond to its readiness check. Restore its endpoint before preparing again.',
  WORKSPACE_SESSION_REQUIRED: 'This workspace process restarted. Reload this page to open a new local session.',
  WORKSPACE_MANIFEST_NOT_REGISTERED: 'That manifest is not registered in this workspace. Restart the workspace with the required named manifest.',
  WORKSPACE_OPERATION_OUTCOME_UNKNOWN: 'The original gateway response was unavailable. It may have applied the change. Inspect the refreshed revision and candidate before deciding whether to retry; no operation is replayed automatically.',
};
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
const short = value => value ? value.slice(0, 12) : '—';
const date = value => value ? new Date(value).toLocaleString() : '—';
function notify(text, error = false) {
  $('notice').textContent = text; $('notice').dataset.error = String(error); $('notice').hidden = false;
}
function table(headers, rows, empty = 'No records.') {
  if (!rows.length) return node('p', empty, 'empty');
  const element = node('table'), head = node('thead'), header = node('tr');
  for (const label of headers) header.append(node('th', label));
  head.append(header); element.append(head);
  const body = node('tbody');
  for (const values of rows) {
    const row = node('tr');
    for (const value of values) { const cell = node('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); row.append(cell); }
    body.append(row);
  }
  element.append(body); return element;
}
function identity(merchant) {
  const box = node('div'); box.append(node('span', merchant.id, 'merchant-name'), node('code', merchant.host));
  const routes = merchant.routeDetails ?? merchant.publishedRoutes;
  if (Array.isArray(routes) && routes.length) {
    const details = node('details', undefined, 'route-detail'); details.append(node('summary', 'Original published routes'));
    for (const route of routes) {
      const view = node('div', (route.method ?? '') + ' ' + (route.url ?? route.path ?? ''), 'route');
      const choices = route.paymentChoices ?? route.accepts ?? route.offer?.accepts;
      if (Array.isArray(choices)) for (const payment of choices) {
        view.append(node('div', [payment.scheme, payment.network, 'amount ' + payment.amount,
          'asset ' + payment.asset, 'recipient ' + payment.payTo].join(' · ')));
      }
      details.append(view);
    }
    box.append(details);
  }
  return box;
}
async function api(path, payload) {
  let response;
  try {
    response = await fetch('/api/' + path, { method: payload ? 'POST' : 'GET', cache: 'no-store',
      headers: { ...(session ? { 'x-fleet-workspace': session } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
  } catch { throw new Error('WORKSPACE_CONNECTION_LOST'); }
  let value;
  try { value = await response.json(); } catch { throw new Error('WORKSPACE_RESPONSE_UNAVAILABLE'); }
  if (!response.ok) throw new Error(value.error ?? 'FLEET_CONTROL_REJECTED');
  return value;
}
function reviewValid() {
  const candidate = status?.candidate;
  return Boolean(reviewed && candidate && reviewed.id === candidate.id && reviewed.digest === candidate.digest &&
    reviewed.baseRevision === status.revision && reviewed.baseRevision === candidate.baseRevision &&
    Date.parse(candidate.expiresAt) > Date.now());
}
function ready() { return connected && !loading && !working && !status?.busy && !status?.closing; }
function render() {
  $('connection').textContent = connected ? (working || status?.busy ? 'Operation in progress' : 'Connected') : 'Disconnected';
  $('refresh').disabled = loading || working;
  $('export').disabled = !status;
  $('prepare').disabled = !ready() || !manifests.length || !status;
  $('manifest').disabled = working || !manifests.length;
  $('review').disabled = !ready() || !status?.candidate;
  $('activate').disabled = !ready() || !reviewValid();
  if (!status) return;
  $('revision').textContent = String(status.revision);
  $('merchant-count').textContent = String(status.merchants.length);
  // Include removed authorities which can exist only in retired generations.
  const allGenerations = [...status.merchants, ...(status.retired ?? []).flatMap(g => g.merchants)];
  $('inflight').textContent = String(allGenerations.reduce((sum, merchant) => sum + merchant.active, 0));
  $('observed').textContent = date(capturedAt);
  $('active-note').textContent = 'Snapshot ' + short(status.snapshotId) + ' · Activated ' + date(status.at) + ' · ' + status.mode;
  const filter = $('filter').value.toLowerCase();
  $('merchants').replaceChildren(table(['Merchant', 'Mode', 'Local port', 'Routes', 'Active / all generations', 'Capacity', 'Completed / errors'],
    status.merchants.filter(m => (m.id + ' ' + m.host).toLowerCase().includes(filter)).map(m => [
      identity(m), node('span', m.mode, 'pill'), m.upstreamPort, m.routes,
      m.active + ' / ' + (m.totalActive ?? m.active), m.maxInFlight,
      m.completed + ' / ' + m.errors,
    ]), 'No matching merchants.'));
  const candidate = status.candidate;
  $('candidate-state').textContent = !candidate ? 'None prepared' : Date.parse(candidate.expiresAt) <= Date.now() ? 'Expired' : reviewValid() ? 'Reviewed' : 'Review required';
  const candidateBox = node('div');
  if (candidate) {
    candidateBox.append(node('p', 'Based on revision ' + candidate.baseRevision + ' · Expires ' + date(candidate.expiresAt)));
    for (const key of ['added', 'changed', 'removed']) {
      const line = node('div', undefined, 'change-line');
      line.append(node('strong', key[0].toUpperCase() + key.slice(1)), node('span', candidate.changes[key].join(', ') || 'None'));
      candidateBox.append(line);
    }
    candidateBox.append(node('p', 'Retained source: ' + candidate.digest, 'digest'));
  } else candidateBox.append(node('p', 'No candidate is prepared. Choose a registered manifest to begin.'));
  $('candidate').replaceChildren(candidateBox);
  if (reviewed && !reviewValid()) {
    reviewed = null; $('review-panel').hidden = true;
    notify('The reviewed candidate or active revision changed, or the candidate expired. Review the current candidate before activating.');
  }
  const generations = node('div', undefined, 'generations');
  for (const generation of status.retired ?? []) {
    const card = node('div', undefined, 'generation'), heading = node('div', undefined, 'generation-head');
    heading.append(node('strong', 'Revision ' + generation.revision), node('span', generation.state, 'pill')); card.append(heading);
    card.append(table(['Merchant', 'Local port', 'Requests remaining'], generation.merchants.map(m => [identity(m), m.upstreamPort, m.active])));
    generations.append(card);
  }
  $('draining').replaceChildren(generations.children.length ? generations : node('p', 'No retired generations in this gateway process.', 'empty'));
  $('history').replaceChildren(table(['Revision', 'Activated', 'Snapshot', 'Action'], (status.history ?? []).map(record => {
    const button = node('button', 'Review rollback'); button.type = 'button'; button.disabled = !ready();
    button.addEventListener('click', () => confirmRollback(record));
    const source = node('div'); source.append(node('code', record.snapshotId), node('div', record.digest, 'digest'));
    return [record.revision, date(record.at), source, button];
  }), 'The gateway has no earlier retained revisions.'));
  $('storage').textContent = 'Snapshot storage: ' + (status.storage?.state ?? '—') +
    (status.storage?.retained !== undefined ? ' · ' + status.storage.retained + ' retained' : '');
}
function accept(value) {
  status = value.status; capturedAt = value.capturedAt; connected = true; render();
}
async function refresh() {
  if (loading || working) return;
  loading = true; render();
  try { accept(await api('status')); outcomeUnknown = false; }
  catch (error) { connected = false; notify(outcomeUnknown ? 'The change may have been applied, and its current status is unavailable. Restore the original gateway connection and inspect the revision and candidate before retrying.' : explain[error.message] ?? 'The original gateway cannot be reached. Restore its process, then refresh.', true); }
  finally { loading = false; render(); }
}
async function mutate(action, payload) {
  if (working) return;
  working = true; render();
  let completed = false;
  try {
    accept(await api(action, payload)); completed = true;
    if (action === 'prepare') { reviewCandidate(); notify('The original gateway retained and checked this candidate. Review its exact changes before activating.'); }
    else { reviewed = null; $('review-panel').hidden = true; notify('The original gateway ' + (action === 'activate' ? 'activated the reviewed candidate' : 'restored the selected snapshot') + ' as revision ' + status.revision + '.'); }
  } catch (error) {
    const uncertain = ['WORKSPACE_CONNECTION_LOST', 'WORKSPACE_RESPONSE_UNAVAILABLE', 'FLEET_CONTROL_TIMEOUT', 'WORKSPACE_OPERATION_OUTCOME_UNKNOWN'].includes(error.message);
    outcomeUnknown = uncertain;
    notify(explain[error.message] ?? (uncertain ? 'The operation response was lost. Inspect the refreshed candidate and revision before deciding whether to retry. No request is replayed automatically.' : 'Operation rejected: ' + error.message), true);
  } finally {
    working = false;
    // Original mutation responses can capture busy:true before their finally
    // completes. Re-read actual state, without replaying the operation.
    await refresh();
    if (completed && !connected) notify('The change was accepted, but its subsequent status read failed. Restore the original gateway connection and inspect its revision before another action.', true);
    render();
  }
}
function reviewCandidate() {
  const candidate = status?.candidate;
  if (!candidate) return;
  reviewed = structuredClone(candidate);
  $('review-panel').hidden = false;
  $('review-note').textContent = 'Candidate ' + candidate.id + ' · Base revision ' + candidate.baseRevision + ' · Source ' + short(candidate.digest);
  const current = new Map(status.merchants.map(m => [m.host, m]));
  const next = new Map(candidate.merchants.map(m => [m.host, m]));
  const hosts = [...new Set([...current.keys(), ...next.keys()])].sort();
  const cell = value => {
    if (!value) return node('span', 'Absent', 'subtle');
    const detail = identity(value); detail.append(node('span', 'Port ' + value.upstreamPort + ' · ' + value.routes + ' routes · capacity ' + value.maxInFlight, 'comparison-value'));
    return detail;
  };
  $('comparison').replaceChildren(table(['Change', 'Serving now', 'Prepared snapshot'], hosts.map(host => [
    candidate.changes.added.includes(host) ? 'Add' : candidate.changes.removed.includes(host) ? 'Remove' : candidate.changes.changed.includes(host) ? 'Change' : 'Keep',
    cell(current.get(host)), cell(next.get(host)),
  ])));
  notify('Reviewed candidate ' + short(candidate.id) + ' against active revision ' + candidate.baseRevision + '. The activation will use this retained source.');
  render();
}
function confirmChange(title, description, details, action) {
  confirmAction = action; $('confirm-title').textContent = title; $('confirm-description').textContent = description;
  $('confirm-details').textContent = details; $('confirm').returnValue = 'cancel'; $('confirm').showModal();
}
function confirmRollback(record) {
  const expectedRevision = status.revision;
  confirmChange('Restore revision ' + record.revision + '?',
    'The original gateway will recheck the retained seller configuration and create a new active revision. Keep the original seller processes available; rollback does not restart them.',
    'Current revision: ' + expectedRevision + '\nTarget revision: ' + record.revision + '\nSnapshot: ' + record.snapshotId + '\nSource digest: ' + record.digest,
    () => mutate('rollback', { expectedRevision, targetRevision: record.revision }));
}
$('confirm').addEventListener('close', () => {
  const action = confirmAction; confirmAction = null;
  if ($('confirm').returnValue === 'apply' && action) action();
});
$('prepare-form').addEventListener('submit', event => {
  event.preventDefault(); if (ready() && status) mutate('prepare', { manifest: $('manifest').value, expectedRevision: status.revision });
});
$('review').addEventListener('click', reviewCandidate);
$('clear-review').addEventListener('click', () => { reviewed = null; $('review-panel').hidden = true; render(); });
$('activate').addEventListener('click', () => {
  if (!reviewValid() || !ready()) return;
  const candidate = structuredClone(reviewed);
  confirmChange('Activate reviewed candidate?', 'New requests will use the retained configuration. Admitted requests continue on their original seller generation.',
    'Reviewed base revision: ' + candidate.baseRevision + '\nCandidate: ' + candidate.id + '\nSource digest: ' + candidate.digest +
    '\nAdded: ' + (candidate.changes.added.join(', ') || 'None') + '\nChanged: ' + (candidate.changes.changed.join(', ') || 'None') + '\nRemoved: ' + (candidate.changes.removed.join(', ') || 'None'),
    () => mutate('activate', { candidateId: candidate.id, expectedRevision: candidate.baseRevision }));
});
$('filter').addEventListener('input', render);
$('refresh').addEventListener('click', refresh);
$('export').addEventListener('click', () => {
  if (!status) return;
  const value = { schema: 'stellar-forge.fleet-workspace-report.v1', exportedAt: new Date().toISOString(),
    statusCapturedAt: capturedAt, connected, registeredManifests: manifests, status };
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = 'merchant-fleet-revision-' + status.revision + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
function schedule() { timer = setTimeout(async () => { if (!document.hidden) await refresh(); schedule(); }, 4000); }
window.addEventListener('pagehide', () => clearTimeout(timer));
try {
  const initial = await api('session'); session = initial.session; manifests = initial.manifests;
  $('manifest').replaceChildren(...manifests.map(name => { const option = node('option', name); option.value = name; return option; }));
  $('manifest-note').textContent = manifests.length ? 'Manifest paths and the gateway capability stay in the local operator process.' :
    'No manifests are registered. Status, existing candidate review and rollback remain available. Start this workspace with --manifest NAME=FILE to prepare a new configuration.';
  await refresh(); schedule();
} catch { connected = false; notify('The local workspace could not start. Reload after its original process is available.', true); render(); }
