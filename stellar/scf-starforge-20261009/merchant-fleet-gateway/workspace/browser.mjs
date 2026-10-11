// MIT. Original control state is authoritative; review never silently rebases.
import { bindFleetClientControls } from './clients.mjs';
const $ = id => document.getElementById(id);
let session, manifests = [], status = null, capturedAt = null, reviewed = null;
let working = false, loading = false, connected = false, confirmAction = null, timer, outcomeUnknown = false;
let pendingRead = null;
let managed = false, releases = null, catalog = null, releaseReview = null, catalogLoading = false, catalogVersion = 0;
const operationDesks = new Map(), loadingDesks = new Set();
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
  FLEET_RELEASE_REVISION_CHANGED: 'Serving traffic changed after this release review. Compare against the current revision before preparing or restoring it.',
  FLEET_RELEASE_SELECTION_CHANGED: 'An original release store selection changed in another session. Reload its catalog and compare the release again.',
  FLEET_RELEASE_CANDIDATE_CHANGED: 'The prepared gateway candidate no longer matches this managed release. Compare and prepare the intended release again.',
  FLEET_RELEASE_REVIEW_EXPIRED: 'This release review expired or was already used. Compare the original releases again.',
  FLEET_RELEASE_SLOT_IN_USE: 'That slot still owns another original seller. Wait for its admitted requests to finish, retire it, then prepare the replacement.',
  FLEET_RELEASE_REPLACEMENT_SLOT_REQUIRED: 'Choose a different slot and port from the merchant currently serving traffic.',
  FLEET_RELEASE_OPERATION_IN_PROGRESS: 'Another release operation is running. Refresh its current state before submitting another change.',
  FLEET_RELEASE_SESSION_NOT_OWNED: 'This workspace no longer owns that exact running session. Refresh the process table.',
  FLEET_RELEASE_OPERATIONS_INVALID: 'The original seller returned invalid operations links. Reopen its current managed instance.',
  WORKSPACE_STARTING: 'The workspace is starting its original merchant sessions. Refresh when startup completes.',
  FLEET_RELEASE_SOURCE_CHANGED: 'The original release source changed after staging. Restore the exact release or stage a new immutable release ID.',
  FLEET_RELEASE_OUTCOME_UNKNOWN: 'The release operation response was lost. Inspect the current revision, candidate and process table before deciding whether another action is needed.',
  FLEET_RELEASE_REVISION_NOT_LINKED: 'Another control session selected a fleet outside this release plan. Use the original control history to restore a linked revision before managing these releases.',
  FLEET_RELEASE_ROLLBACK_NOT_LINKED: 'That original gateway revision has no retained release mapping. Choose a retained managed revision.',
  WORKSPACE_MANAGED_RELEASE_REVIEW_REQUIRED: 'Compare the registered original release before changing a managed fleet.',
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
  if (merchant.routeDetailsState === 'STATUS_LIMIT')
    box.append(node('p', 'Public route details exceed this status view. Inspect the original seller’s private /_seller/offers endpoint on port ' + merchant.upstreamPort + '.', 'small'));
  return box;
}
async function api(path, payload, { raw = false, signal } = {}) {
  let response;
  try {
    response = await fetch('/api/' + path, { method: payload ? 'POST' : 'GET', cache: 'no-store', signal,
      headers: { ...(session ? { 'x-fleet-workspace': session } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
  } catch { throw new Error('WORKSPACE_CONNECTION_LOST'); }
  if (raw && response.ok) return response;
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
function ready() { return connected && !loading && !working && !status?.busy && !status?.closing && !releases?.busy && !releases?.closing; }
function managedReady() { return ready() && !catalogLoading && releases?.relationship === 'LINKED'; }
function canActivate() { return reviewValid() && (!managed || (managedReady() && releases?.pending?.phase === 'PREPARED' && releases.pending.candidateId === reviewed.id)); }
function render() {
  $('connection').textContent = connected ? (working || status?.busy ? 'Operation in progress' : 'Connected') : 'Disconnected';
  $('refresh').disabled = loading || working;
  $('export').disabled = !status;
  $('prepare').disabled = managed || !ready() || !manifests.length || !status;
  $('manifest').disabled = working || !manifests.length;
  $('review').disabled = !ready() || !status?.candidate;
  $('activate').disabled = !ready() || !canActivate();
  if (managed) renderReleases();
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
  } else candidateBox.append(node('p', managed ? 'No candidate is prepared. Compare a seller release above to begin.' : 'No candidate is prepared. Choose a registered manifest to begin.'));
  $('candidate').replaceChildren(candidateBox);
  if (reviewed && !reviewValid()) {
    reviewed = null; $('review-panel').hidden = true;
    notify('The reviewed candidate or active revision changed, or the candidate expired. Review the current candidate before activating.');
  }
  const generations = node('div', undefined, 'generations');
  for (const generation of status.retired ?? []) {
    const card = node('div', undefined, 'generation'), heading = node('div', undefined, 'generation-head');
    heading.append(node('strong', 'Revision ' + generation.revision), node('span', generation.state, 'pill')); card.append(heading);
    const wrap = node('div', undefined, 'table-wrap');
    wrap.append(table(['Merchant', 'Local port', 'Requests remaining'], generation.merchants.map(m => [identity(m), m.upstreamPort, m.active]))); card.append(wrap);
    generations.append(card);
  }
  $('draining').replaceChildren(generations.children.length ? generations : node('p', 'No retired generations in this gateway process.', 'empty'));
  $('history').replaceChildren(table(['Revision', 'Activated', 'Snapshot', 'Action'], (status.history ?? []).map(record => {
    const button = node('button', 'Review rollback'); button.type = 'button';
    button.disabled = !ready() || (managed && (!managedReady() || !releases?.retained?.some(row => row.revision === record.revision)));
    button.addEventListener('click', () => confirmRollback(record));
    const source = node('div'); source.append(node('code', record.snapshotId), node('div', record.digest, 'digest'));
    return [record.revision, date(record.at), source, button];
  }), 'The gateway has no earlier retained revisions.'));
  $('storage').textContent = 'Snapshot storage: ' + (status.storage?.state ?? '—') +
    (status.storage?.retained !== undefined ? ' · ' + status.storage.retained + ' retained' : '');
}
function accept(value) {
  status = value.status;
  if (Object.hasOwn(value, 'releaseStatus')) releases = value.releaseStatus;
  capturedAt = value.capturedAt; connected = true; render();
}
function refresh() {
  if (working) return Promise.resolve();
  if (pendingRead) return pendingRead;
  loading = true; render();
  pendingRead = (async () => {
    try { accept(await api('status')); outcomeUnknown = false; }
    catch (error) { connected = false; notify(outcomeUnknown ? 'The change may have been applied, and its current status is unavailable. Restore the original gateway connection and inspect the revision and candidate before retrying.' : explain[error.message] ?? 'The original gateway cannot be reached. Restore its process, then refresh.', true); }
    finally { loading = false; pendingRead = null; render(); }
  })();
  return pendingRead;
}
async function mutate(action, payload) {
  if (working) return;
  const olderRead = pendingRead;
  working = true; render(); await olderRead;
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
  if (managed) { if (managedReady()) releaseAction('review-rollback', { targetRevision: record.revision }); return; }
  const expectedRevision = status.revision;
  confirmChange('Restore revision ' + record.revision + '?',
    'The original gateway will recheck the retained seller configuration and create a new active revision. Keep the original seller processes available; rollback does not restart them.',
    'Current revision: ' + expectedRevision + '\nTarget revision: ' + record.revision + '\nSnapshot: ' + record.snapshotId + '\nSource digest: ' + record.digest,
    () => mutate('rollback', { expectedRevision, targetRevision: record.revision }));
}
function options(select, values) {
  const previous = select.value;
  if (JSON.stringify([...select.options].map(option => [option.value, option.textContent])) === JSON.stringify(values)) return;
  select.replaceChildren(...values.map(([value, label]) => { const option = node('option', label); option.value = value; return option; }));
  if (values.some(([value]) => value === previous)) select.value = previous;
}
const selectedTenant = () => releases?.tenants?.find(row => row.id === $('release-tenant').value);
const selectedSlot = () => selectedTenant()?.slots.find(row => row.name === $('release-slot').value);
const sourceName = kind => ({ OPENAPI_WORKSPACE: 'API workspace', OPENAPI_SELLER: 'API seller',
  PYTHON_APPLICATION: 'Python application', DUCKDB_PACKAGE: 'DuckDB data product', S3_OBJECT_PACKAGE: 'S3 objects',
  JSONRPC_MERCHANT_PACKAGE: 'Stellar RPC', SQLITE_MERCHANT_PACKAGE: 'SQLite snapshot', MYSQL_MERCHANT_PACKAGE: 'MySQL / MariaDB' }[kind] ?? 'Seller source');
function releaseReviewValid() {
  return Boolean(releaseReview && releaseReview.baseRevision === status?.revision && Date.parse(releaseReview.expiresAt) > Date.now());
}
const deskKey = (tenant, slot) => tenant + '/' + slot.name + '/' + slot.instanceId;
function currentDeskSlot(tenant, slot, instanceId) {
  return connected && !releases?.closing && releases?.tenants?.find(row => row.id === tenant)?.slots
    .find(row => row.name === slot && row.instanceId === instanceId && row.owned && row.operations?.available);
}
async function loadOperations(tenant, slot, instanceId) {
  const key = tenant + '/' + slot + '/' + instanceId;
  if (loadingDesks.has(key) || !currentDeskSlot(tenant, slot, instanceId)) return;
  loadingDesks.add(key); renderReleases();
  try {
    const value = await api('releases/operations?' + new URLSearchParams({ tenant, slot, instanceId }));
    const current = currentDeskSlot(tenant, slot, instanceId);
    if (!current) return;
    const links = value.operations;
    if (value.tenant !== tenant || value.slot !== slot || value.instanceId !== instanceId ||
        value.explorer !== 'http://127.0.0.1:' + current.port + '/_seller/docs' ||
        links !== null && (typeof links?.url !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(links.url) ||
        Number(new URL(links.url).port) > 65535 || links.availability !== links.url + '/availability' ||
        links.availabilityControl !== null && (typeof links.availabilityControl !== 'string' ||
          !links.availabilityControl.startsWith(links.availability + '#') ||
          !/^[0-9a-f]{64}$/.test(links.availabilityControl.slice(links.availability.length + 1)))))
      throw new Error('FLEET_RELEASE_OPERATIONS_INVALID');
    operationDesks.set(key, { explorer: value.explorer, operations: links });
  } catch (error) {
    operationDesks.delete(key);
    notify(explain[error.message] ?? 'The current merchant tools could not be opened. Refresh its running instance.', true);
  } finally { loadingDesks.delete(key); renderReleases(); }
}
function operationsCell(tenant, slot) {
  const cell = node('div', undefined, 'release-tools');
  const handover = node('button', 'Customer SDKs'); handover.type = 'button'; handover.disabled = !ready();
  handover.addEventListener('click', () => clientDesk.open(tenant.id, slot.name)); cell.append(handover);
  if (!currentDeskSlot(tenant.id, slot.name, slot.instanceId)) { cell.append(node('span', '—')); return cell; }
  const key = deskKey(tenant.id, slot), links = operationDesks.get(key);
  if (!links) {
    const button = node('button', loadingDesks.has(key) ? 'Opening tools…' : 'Show merchant tools');
    button.type = 'button'; button.disabled = loadingDesks.has(key);
    button.addEventListener('click', () => loadOperations(tenant.id, slot.name, slot.instanceId));
    cell.append(button); return cell;
  }
  const destinations = [['Developer explorer', links.explorer]], operations = links.operations;
  if (operations) destinations.push(['Operations', operations.url],
    [operations.availabilityControl ? 'Manage availability' : 'View availability', operations.availabilityControl ?? operations.availability]);
  for (const [label, href] of destinations) {
    const link = node('a', label, 'release-tool-link');
    link.href = href; link.target = '_blank'; link.rel = 'noopener'; link.referrerPolicy = 'origin';
    cell.append(link);
  }
  return cell;
}
function renderReleases() {
  if (!releases?.tenants) return;
  clientDesk.update();
  const liveDesks = new Set(releases.tenants.flatMap(tenant => tenant.slots
    .filter(slot => currentDeskSlot(tenant.id, slot.name, slot.instanceId)).map(slot => deskKey(tenant.id, slot))));
  for (const key of operationDesks.keys()) if (!liveDesks.has(key)) operationDesks.delete(key);
  $('release-link').textContent = releases.relationship === 'LINKED' ? 'Managed releases linked' : 'Fleet changed outside plan';
  options($('release-tenant'), releases.tenants.map(row => [row.id, row.id + ' · ' + row.host]));
  const tenant = selectedTenant(), firstSlots = !$('release-slot').options.length;
  options($('release-slot'), (tenant?.slots ?? []).map(row => [row.name, row.name + ' · port ' + row.port + (row.serving ? ' · serving' : '')]));
  if (firstSlots) $('release-slot').value = tenant?.slots.find(row => !row.serving)?.name ?? tenant?.slots[0]?.name ?? '';
  const sourceTypes = new Map((tenant?.packageSources ?? []).map(source => [source.name, source.kind]));
  options($('release-package'), (tenant?.packages ?? []).map(name => [name, name + ' · ' + sourceName(sourceTypes.get(name))]));
  const chosen = selectedSlot(), available = catalog?.tenant === tenant?.id && catalog?.slot === chosen?.name;
  $('release-compare').disabled = !managedReady() || !available || !catalog?.releases?.length || chosen?.serving;
  $('release-stage').disabled = !managedReady() || !tenant?.packages.length || chosen?.serving;
  for (const id of ['release-tenant', 'release-slot', 'release-id', 'release-package', 'release-new-id']) $(id).disabled = working;
  $('release-apply').disabled = !managedReady() || !releaseReviewValid();
  if (releaseReview && !releaseReviewValid()) {
    releaseReview = null; $('release-review-panel').hidden = true;
    notify('The serving revision changed or this release review expired. Compare the original releases again.');
  }
  const rows = [];
  for (const merchant of releases.tenants) for (const slot of merchant.slots) {
    const identity = node('div'); identity.append(node('strong', merchant.id), node('div', slot.name + ' · ' + merchant.host, 'small'));
    const source = node('div'); source.append(node('code', slot.runningReleaseId ?? slot.selectedReleaseId ?? 'No release selected'));
    if (slot.runningDigest) source.append(node('div', short(slot.runningDigest), 'digest'));
    const state = [slot.state, slot.serving ? 'SERVING' : '', slot.candidate ? 'CANDIDATE' : '', slot.drainingRequests ? 'DRAINING ' + slot.drainingRequests : ''].filter(Boolean).join(' · ');
    const button = node('button', 'Retire'); button.type = 'button'; button.disabled = !managedReady() || !slot.canRetire;
    button.addEventListener('click', () => {
      const expectedRevision = status.revision, instanceId = slot.instanceId;
      confirmChange('Retire ' + merchant.id + ' / ' + slot.name + '?',
        'The gateway will confirm that this exact process has no serving, prepared or draining traffic before stopping its original release session. A later reviewed rollback can restart its retained release.',
        'Revision: ' + expectedRevision + '\nRelease: ' + slot.runningReleaseId + '\nPort: ' + slot.port + '\nSession: ' + instanceId,
        () => releaseAction('retire', { tenant: merchant.id, slot: slot.name, instanceId, expectedRevision }));
    });
    rows.push([identity, slot.port, source, state, slot.generation, operationsCell(merchant, slot), button]);
  }
  $('release-processes').replaceChildren(table(['Merchant / slot', 'Local port', 'Release', 'Process and traffic', 'Store generation', 'Merchant tools', 'Action'], rows));
  $('release-pending').textContent = releases.relationship !== 'LINKED' ? explain[releases.relationship] ?? releases.relationship :
    releases.pending ? 'Release operation: ' + releases.pending.phase + ' · Based on revision ' + releases.pending.baseRevision :
    'All serving merchants match their retained original releases. Retiring a process preserves its immutable release for rollback.';
}
async function loadCatalog(selectId) {
  const tenant = $('release-tenant').value, slot = $('release-slot').value, version = ++catalogVersion;
  if (!tenant || !slot) return;
  catalogLoading = true; catalog = null; options($('release-id'), [['', 'Loading releases…']]); render();
  try {
    const value = await api('releases/catalog?' + new URLSearchParams({ tenant, slot }));
    if (version !== catalogVersion) return;
    catalog = value;
    options($('release-id'), value.releases.length ? value.releases.map(row => [row.id, row.label + ' · ' + sourceName(row.sourceKind) + ' · ' + row.routes + ' routes']) : [['', 'No staged release']]);
    if (selectId && value.releases.some(row => row.id === selectId)) $('release-id').value = selectId;
    $('release-catalog-note').textContent = value.releases.length ? value.releases.length + ' immutable release' + (value.releases.length === 1 ? '' : 's') + ' · Store generation ' + value.generation +
      ' · Selected ' + (value.selectedReleaseId ?? 'none') + (value.errors.length ? ' · ' + value.errors.length + ' unreadable entries; inspect the original store.' : '') :
      'This replacement slot has no staged release. Stage a registered seller source below.';
  } catch (error) {
    if (version === catalogVersion) { options($('release-id'), [['', 'Catalog unavailable']]); notify(explain[error.message] ?? 'The original release catalog could not be read. Refresh after restoring its store.', true); }
  } finally { if (version === catalogVersion) { catalogLoading = false; render(); } }
}
function releaseView(release) {
  const view = node('div');
  if (!release) { view.append(node('p', 'No release')); return view; }
  view.append(node('strong', release.id), node('p', sourceName(release.sourceKind) + ' · ' + release.publicOrigin + ' · ' + release.mode + ' · port ' + release.runtime.port, 'small'),
    node('div', 'Source ' + release.digest, 'digest'));
  for (const route of release.routes) {
    const item = node('div', route.method + ' ' + route.url, 'route');
    for (const payment of route.payment ?? []) item.append(node('p',
      [payment.scheme, payment.network, 'amount ' + payment.amount, 'asset ' + payment.asset, 'recipient ' + payment.payTo].join(' · '), 'route'));
    const details = node('details'); details.append(node('summary', 'Request and application configuration'),
      node('pre', JSON.stringify({ requestContractSha256: route.requestContractSha256,
        application: route.application, ...(route.upstream ? { upstream: route.upstream } : {}) }, null, 2)));
    item.append(details); view.append(item);
  }
  return view;
}
function showReleaseReview() {
  if (!releaseReviewValid()) return;
  const rollback = releaseReview.kind === 'rollback';
  $('release-review-panel').hidden = false;
  $('release-review-title').textContent = rollback ? 'Review release rollback' : 'Review seller release';
  $('release-review-note').textContent = 'Serving revision ' + releaseReview.baseRevision + ' · Expires ' + date(releaseReview.expiresAt) + ' · Review ' + short(releaseReview.reviewId);
  $('release-apply').textContent = rollback ? 'Restore reviewed releases' : 'Start and prepare reviewed release';
  const rows = rollback ? releaseReview.comparisons : [{ tenant: releaseReview.tenant, comparison: releaseReview.comparison }];
  const content = node('div');
  for (const row of rows) {
    const section = node('div', undefined, 'release-comparison'), comparison = row.comparison;
    section.append(node('h3', row.tenant), node('p', comparison.summary.added + ' added · ' + comparison.summary.changed + ' changed · ' +
      comparison.summary.removed + ' removed · ' + comparison.summary.unchanged + ' unchanged routes'));
    const wrap = node('div', undefined, 'table-wrap');
    wrap.append(table(['Serving release', rollback ? 'Retained release to restore' : 'Replacement release'], [[releaseView(comparison.before), releaseView(comparison.after)]]));
    section.append(wrap);
    if (comparison.changes.length || comparison.runtimeChanges.length) {
      const details = node('details'); details.append(node('summary', 'Exact original configuration changes'),
        node('pre', JSON.stringify({ routes: comparison.changes, runtime: comparison.runtimeChanges }, null, 2)));
      section.append(details);
    }
    content.append(section);
  }
  $('release-comparison').replaceChildren(content); render();
}
async function releaseAction(action, payload) {
  if (working) return;
  const olderRead = pendingRead;
  working = true; render(); await olderRead;
  let result;
  try {
    result = (await api('releases/' + action, payload)).result;
    if (['review', 'review-rollback'].includes(action)) releaseReview = result;
    else if (action !== 'retire') { releaseReview = null; $('release-review-panel').hidden = true; }
  } catch (error) {
    outcomeUnknown = ['WORKSPACE_CONNECTION_LOST', 'WORKSPACE_RESPONSE_UNAVAILABLE', 'WORKSPACE_OPERATION_OUTCOME_UNKNOWN', 'FLEET_RELEASE_OUTCOME_UNKNOWN'].includes(error.message);
    notify(explain[error.message] ?? (outcomeUnknown ? 'The response was lost. Inspect the refreshed release and gateway state before choosing another action.' : 'The original release operation was rejected: ' + error.message), true);
  } finally {
    working = false; await refresh();
    if (result && connected) {
      if (['review', 'review-rollback'].includes(action)) { showReleaseReview(); notify('Review the exact original serving and proposed releases below before applying this change.'); }
      else if (action === 'stage') { await loadCatalog(result.release.id); notify('Staged immutable release ' + result.release.id + '. Compare it with the serving merchant before preparation.'); }
      else if (action === 'prepare') { reviewCandidate(); notify('The original replacement is running and the gateway retained its checked candidate. Compare its traffic changes, then activate the reviewed candidate.'); }
      else if (action === 'rollback') notify('Restored the reviewed original releases as revision ' + status.revision + '. Any stopped retained sessions were restarted before the gateway switched traffic.');
      else notify('Retired the exact drained original session. Its immutable release remains available for a reviewed rollback.');
    } else if (result) notify('The release operation was accepted, but its subsequent state read failed. Restore the connection and inspect the serving revision and process table before another action.', true);
    render();
  }
}
$('release-tenant').addEventListener('change', () => { $('release-slot').replaceChildren(); renderReleases(); loadCatalog(); });
$('release-slot').addEventListener('change', () => loadCatalog());
$('release-form').addEventListener('submit', event => {
  event.preventDefault(); if (managedReady() && !selectedSlot()?.serving) releaseAction('review', {
    tenant: $('release-tenant').value, slot: $('release-slot').value, releaseId: $('release-id').value });
});
$('release-stage-form').addEventListener('submit', event => {
  event.preventDefault(); if (managedReady() && !selectedSlot()?.serving) releaseAction('stage', {
    tenant: $('release-tenant').value, slot: $('release-slot').value, package: $('release-package').value, releaseId: $('release-new-id').value });
});
$('release-clear-review').addEventListener('click', () => { releaseReview = null; $('release-review-panel').hidden = true; render(); });
$('release-apply').addEventListener('click', () => {
  if (!managedReady() || !releaseReviewValid()) return;
  const review = structuredClone(releaseReview), rollback = review.kind === 'rollback';
  confirmChange(rollback ? 'Restore reviewed original releases?' : 'Start the reviewed replacement?',
    rollback ? 'Required retained release sessions will start before the original gateway restores this exact reviewed snapshot. Current admitted requests finish on their original generation.' :
      'The original release manager will start this immutable release on its registered replacement port. The gateway will check and retain a candidate; traffic changes only after you review and activate that candidate.',
    'Reviewed revision: ' + review.baseRevision + '\nReview: ' + review.reviewId + '\nExpires: ' + date(review.expiresAt) +
      (rollback ? '\nTarget revision: ' + review.targetRevision : '\nMerchant / slot: ' + review.tenant + ' / ' + review.slot + '\nRelease: ' + review.releaseId + '\nSource: ' + review.comparison.after.digest),
    () => releaseAction(rollback ? 'rollback' : 'prepare', { reviewId: review.reviewId }));
});
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
  if (!canActivate() || !ready()) return;
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
    statusCapturedAt: capturedAt, connected, registeredManifests: manifests, status,
    ...(releases ? { releases: { ...releases, native: undefined } } : {}) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = 'merchant-fleet-revision-' + status.revision + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
function schedule() { timer = setTimeout(async () => { if (!document.hidden) await refresh(); schedule(); }, 4000); }
window.addEventListener('pagehide', () => {
  void clientDesk.close();
  clearTimeout(timer); operationDesks.clear(); loadingDesks.clear();
  $('release-processes').querySelectorAll('.release-tool-link').forEach(link => link.remove());
});
const clientDesk = bindFleetClientControls({ request: api, getReleases: () => releases,
  isBusy: () => !ready(), setBusy(value) { working = value; render(); } });
try {
  const initial = await api('session'); session = initial.session; manifests = initial.manifests; managed = initial.managed === true;
  $('managed-releases').hidden = !managed; $('managed-processes').hidden = !managed;
  $('prepare-panel').hidden = managed; $('configuration-grid').classList.toggle('single-column', managed);
  $('manifest').replaceChildren(...manifests.map(name => { const option = node('option', name); option.value = name; return option; }));
  $('manifest-note').textContent = manifests.length ? 'Manifest paths and the gateway capability stay in the local operator process.' :
    'No manifests are registered. Status, existing candidate review and rollback remain available. Start this workspace with --manifest NAME=FILE to prepare a new configuration.';
  await refresh(); if (managed && connected) { await loadCatalog(); await clientDesk.refresh(); } schedule();
} catch { connected = false; notify('The local workspace could not start. Reload after its original process is available.', true); render(); }
