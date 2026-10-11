import { bindDiscoveryControls } from './discovery.mjs';
const $ = selector => document.querySelector(selector);
const fragment = location.hash.slice(1);
if (fragment) { sessionStorage.setItem('seller-release-token', fragment); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem('seller-release-token') ?? '';
let snapshot = null, selected = null, comparison = null, cacheSnapshot = null, busy = false;
let catalogSnapshot = null, catalogReview = null;
const node = (tag, text, className) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result; };
const date = value => value ? new Date(value).toLocaleString() : '—';
const literal = value => value === null || value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const quoted = value => "'" + value.replaceAll("'", "'\\''") + "'";
function stageCommand(release) {
  const command = 'node release-cli.mjs stage --store ' + quoted(snapshot.root) + ' --id release-name';
  if (release?.jsonrpc) return command + ' --jsonrpc-package prepared-rpc-package';
  if (release?.s3) return command + ' --s3-package configured-s3-package';
  if (release?.duckdb) return command + ' --duckdb-package prepared-duckdb-package --duckdb-python ' + quoted(release.duckdb.interpreter);
  if (release?.python) return command + ' --python python-merchant.json';
  return command + ' --spec openapi.json --config selections.json --bindings bindings.json';
}
function notice(message = '', error = false) { $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
async function request(path, payload) {
  const options = { headers: { 'x-release-token': token }, cache: 'no-store' };
  if (payload !== undefined) { options.method = 'POST'; options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(payload); }
  const response = await fetch(path, options), value = await response.json();
  if (!response.ok) throw new Error(value.message ?? 'Operator action failed.');
  return value;
}
function buttons() {
  const blocked = busy || !snapshot || snapshot.console.busy;
  for (const button of document.querySelectorAll('button')) button.disabled = blocked;
  discovery.buttons(blocked);
  if (!snapshot || blocked) return;
  $('#activate').disabled = !comparison || selected === snapshot.state.active;
  $('#rollback').disabled = !snapshot.state.previous;
  const owns = snapshot.console.managesRunningSeller;
  $('#start').disabled = !snapshot.state.active || owns || !['STOPPED'].includes(snapshot.runtime.state);
  $('#restart').disabled = !owns || !snapshot.state.active;
  $('#stop').disabled = !owns;
  $('#cache-invalidate-all').disabled = !owns || !cacheSnapshot?.available ||
    cacheSnapshot.instanceId !== snapshot.console.instanceId;
  for (const button of document.querySelectorAll('[data-cache-route]')) button.disabled = $('#cache-invalidate-all').disabled;
  const catalogReady = snapshot.console.catalogConfigured && selected;
  $('#catalog-refresh').disabled = !catalogReady;
  $('#catalog-review').disabled = !catalogReady || !catalogSnapshot?.runtime?.running;
  $('#catalog-apply').disabled = !catalogReview?.changes.length;
  for (const button of document.querySelectorAll('[data-catalog-route]'))
    button.disabled = !catalogReady || !$('#catalog-reason').value.trim();
}
function terms(values) {
  return values?.map(term => term.amount + ' atomic · ' + term.asset + ' · ' + term.network + '\n' + term.scheme + ' → ' + term.payTo).join('\n\n') ?? 'Not listed';
}
function clearCatalogReview() {
  catalogReview = null; $('#catalog-review-panel').hidden = true;
}
function renderCatalog(value) {
  catalogSnapshot = value; clearCatalogReview();
  const rows = $('#catalog-routes'); rows.replaceChildren();
  $('#catalog-state').textContent = value.configured === false
    ? discovery.catalogHint()
    : 'Release ' + value.release.id + ' · catalog seller ' + value.catalog.sellerId +
      (value.runtime.running ? ' · this release is running in ' + value.release.mode + '.' : ' · start this release before publishing its offers.') +
      ' Refresh reads the original catalog; it sends no payment.';
  for (const item of value.rows ?? []) {
    const row = node('tr'), route = node('td');
    route.append(node('strong', item.method + ' · ' + item.routeId), node('div', item.url));
    const state = node('td', item.state.replaceAll('_', ' '));
    if (item.before) state.append(node('div', 'Sequence ' + item.before.sequence));
    const before = node('td'), after = node('td');
    before.append(node('pre', terms(item.before?.payment))); after.append(node('pre', terms(item.payment)));
    const action = node('td');
    if (item.before && !item.before.retired && !['OTHER_SELLER', 'SIGNER_CHANGED'].includes(item.state)) {
      const button = node('button', 'Review withdrawal'); button.dataset.catalogRoute = item.routeId;
      button.addEventListener('click', () => reviewCatalog('withdraw', item.routeId)); action.append(button);
    }
    row.append(route, state, before, after, action); rows.append(row);
  }
  buttons();
}
async function refreshCatalog() {
  clearCatalogReview();
  if (!snapshot?.console.catalogConfigured || !selected) { renderCatalog({ configured: false }); return; }
  try { renderCatalog(await request('/api/catalog?id=' + encodeURIComponent(selected))); }
  catch (error) {
    catalogSnapshot = null; $('#catalog-routes').replaceChildren();
    $('#catalog-state').textContent = error.message; buttons();
  }
}
async function reviewCatalog(action = 'publish', routeId) {
  if (busy || !selected) return;
  busy = true; clearCatalogReview(); buttons();
  try {
    catalogReview = await request('/api/catalog/review', { id: selected, action,
      ...(action === 'withdraw' ? { routeId, reason: $('#catalog-reason').value.trim() } : {}) });
    $('#catalog-review-title').textContent = action === 'publish'
      ? 'Publish ' + catalogReview.changes.length + ' changed offers from release ' + selected
      : 'Withdraw the selected catalog listing';
    const changes = $('#catalog-changes'); changes.replaceChildren();
    for (const row of catalogReview.changes) {
      changes.append(fieldPair(row.method + ' ' + row.url,
        { sequence: row.before?.sequence ?? null, payment: row.before?.payment ?? null,
          sourceURL: row.before?.sourceURL ?? null, sourceSha256: row.before?.sourceSha256 ?? null },
        { sequence: row.nextSequence, payment: action === 'withdraw' ? null : row.payment,
          sourceURL: catalogReview.catalog.sourceURL,
          ...(action === 'publish' ? { sourceSha256: row.sourceSha256 } : {}),
          ...(action === 'withdraw' ? { reason: catalogReview.reason } : {}) }));
    }
    if (!catalogReview.changes.length) changes.append(node('p', 'The catalog already contains these exact release offers.'));
    $('#catalog-apply').textContent = action === 'publish' ? 'Publish reviewed offers' : 'Withdraw reviewed listing';
    $('#catalog-review-panel').hidden = false;
    notice('Review the exact catalog changes. Signing occurs when you apply them.');
  } catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
}
async function applyCatalog() {
  if (busy || !catalogReview) return;
  busy = true; buttons();
  try {
    const result = await request('/api/catalog/apply', { reviewId: catalogReview.id });
    clearCatalogReview();
    await refreshCatalog();
    notice(result.decision === 'UNCHANGED' ? 'The exact offers are already published.'
      : 'Catalog ' + (result.action === 'withdraw' ? 'withdrawal' : 'publication') + ' committed. The original catalog history retains the result.');
  } catch (error) { clearCatalogReview(); await refreshCatalog(); notice(error.message, true); }
  finally { busy = false; buttons(); }
}
function renderCaches(value) {
  cacheSnapshot = value;
  $('#cache-state').textContent = value.available
    ? 'Running release ' + value.releaseId + '. Invalidation clears retained data; existing buyers finish their original read.'
    : 'No active cached source. Start a release with an explicit shared GET/HEAD policy.';
  const rows = $('#cache-routes'); rows.replaceChildren();
  for (const [id, route] of Object.entries(value.routes ?? {})) {
    const row = node('tr'), title = node('td');
    title.append(node('strong', id), node('div', route.binding));
    const policy = route.policy, configured = node('td',
      'TTL ' + (policy.ttlMs ?? 1000) + ' ms · ' + (policy.maxEntries ?? 256) + ' entries');
    configured.append(node('div', 'Source capacity ' + (policy.maxSourceInFlight ?? 16)));
    const source = route.source.cache ?? route.source;
    const cache = source.cache ?? source;
    const activity = node('td', 'Reads ' + (source.sourceStarted ?? cache.sourceReads ?? 0) +
      ' · shared followers ' + (cache.coalesced ?? 0) + ' · hits ' + (cache.hits ?? 0));
    activity.append(node('div', (cache.entries ?? 0) + ' retained · ' + (cache.bytes ?? 0) + ' bytes'));
    const details = node('details'), summary = node('summary', 'Source counters');
    details.append(summary, node('pre', literal(route.source))); activity.append(details);
    const action = node('td'), button = node('button', 'Invalidate'); button.dataset.cacheRoute = id;
    button.addEventListener('click', () => invalidateCache(id)); action.append(button);
    row.append(title, configured, activity, action); rows.append(row);
  }
  buttons();
}
async function refreshCaches() {
  renderCaches(await request('/api/cache'));
}
async function invalidateCache(routeId) {
  if (busy || !cacheSnapshot?.available) return;
  busy = true; buttons();
  try {
    const result = await request('/api/cache/invalidate', { instanceId: cacheSnapshot.instanceId, ...(routeId ? { routeId } : {}) });
    renderCaches(result);
    notice('Source cache invalidated for ' + result.invalidatedRoutes.join(', ') + '.');
  } catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
}
function renderStatus(value) {
  snapshot = value;
  $('#selected').textContent = value.state.active ?? 'None selected';
  $('#generation').textContent = 'Selection generation ' + value.state.generation;
  $('#running').textContent = ['STOPPED'].includes(value.runtime.state) ? 'Stopped' : value.runtime.observed?.releaseId ?? 'Starting';
  $('#runtime').textContent = value.runtime.state.replaceAll('_', ' ');
  $('#listener').textContent = value.runtime.state === 'STOPPED' ? '—' : value.runtime.observed?.listener ?? '—';
  $('#mode').textContent = value.runtime.state === 'STOPPED' ? 'Ready to start a selected release' : value.runtime.observed?.mode ?? '—';
  const operations = value.console.operations;
  for (const [selector, target] of [['#operations-link', operations?.url], ['#availability-link', operations?.availabilityControl]]) {
    const link = $(selector), visible = value.console.managesRunningSeller && typeof target === 'string' &&
      /^http:\/\/127\.0\.0\.1:\d+(?:\/availability#[0-9a-f]{64})?$/.test(target);
    link.hidden = !visible;
    if (visible) link.href = target; else link.removeAttribute('href');
  }
  $('#store').textContent = value.root;
  $('#stage-command').textContent = stageCommand(value.releases.find(release => release.id === (selected ?? value.state.active)));
  const list = $('#release-list'); list.replaceChildren();
  for (const release of value.releases) {
    const button = node('button', undefined, 'release-card'); button.dataset.id = release.id;
    button.setAttribute('aria-pressed', String(release.id === selected));
    button.append(node('strong', release.label), node('span', release.id + ' · ' + (release.jsonrpc ? 'Stellar RPC · ' : release.s3 ? 'S3 objects · ' : release.duckdb ? 'DuckDB / Parquet · ' : release.python ? 'Python · ' : '') + release.routes.length + ' routes'),
      node('span', date(release.createdAt)), node('span', release.id === value.state.active ? 'Selected for next start' : 'Prepared'));
    button.addEventListener('click', () => choose(release.id)); list.append(button);
  }
  if (!value.releases.length) list.append(node('p', 'No releases staged. Use the stage command below.'));
  for (const error of value.errors) list.append(node('p', error.id + ': ' + error.message));
  const historyRows = $('#history'); historyRows.replaceChildren();
  for (const event of [...value.state.history].reverse().slice(0, 40)) {
    const row = node('tr'); row.append(node('td', date(event.at)), node('td', String(event.generation)),
      node('td', (event.from ?? 'None') + ' → ' + event.to + ' (' + event.operation + ')'), node('td', event.reason)); historyRows.append(row);
  }
  if (!value.state.history.length) { const row = node('tr'), cell = node('td', 'No selection changes yet.'); cell.colSpan = 4; row.append(cell); historyRows.append(row); }
  $('#process-description').textContent = value.runtime.state === 'RESTART_REQUIRED'
    ? 'The selected release differs from the running seller. Restart selected stops this console’s seller and launches the selected configuration.'
    : value.console.managesRunningSeller ? 'This console owns the running seller. Closing the console command stops that seller.'
    : value.runtime.state !== 'STOPPED' ? 'Another manager owns this seller. Stop it from its original terminal or console before starting here.'
    : 'Start the selected seller release. Its prepared configuration, responses and application entry are checked first.';
  buttons();
}
function fieldPair(field, before, after) {
  const section = node('div', undefined, 'change'); section.append(node('h3', field));
  const columns = node('div', undefined, 'fields');
  for (const [label, value] of [['Before', before], ['After', after]]) {
    const column = node('div'); column.append(node('label', label), node('pre', literal(value))); columns.append(column);
  }
  section.append(columns); return section;
}
function rpcRuntimeChange(before, after) {
  const section = node('section', undefined, 'change'); section.append(node('h3', 'Stellar RPC configuration'));
  const rows = [
    ['Data network', before?.dataNetwork, after?.dataNetwork],
    ['Payment network', before?.paymentNetwork, after?.paymentNetwork],
    ['Selected methods', before?.methodCount, after?.methodCount],
    ...Object.entries({ timeoutMs: 'Provider deadline (ms)', maxResponseBytes: 'Maximum response bytes',
      maxInFlight: 'Provider concurrent reads', maxEventPage: 'Maximum events per request',
      maxTransactionPage: 'Maximum transactions per request', maxLedgerKeys: 'Maximum ledger keys per request',
      maxLedgerPage: 'Maximum ledgers per request' }).map(([key, label]) => [label, before?.limits?.[key], after?.limits?.[key]]),
  ].filter(([, previous, next]) => previous !== next);
  for (const [label, previous, next] of rows) section.append(fieldPair(label, previous, next));
  if (!rows.length) section.append(node('p', 'The selected public limits and networks are unchanged. Review the changed products and source declaration.'));
  const details = node('details'); details.append(node('summary', 'Retained source identity and complete declaration'),
    fieldPair('Source declaration', before, after)); section.append(details);
  return section;
}
function renderDiff(value) {
  comparison = value;
  $('#stage-command').textContent = stageCommand(value.after);
  $('#comparison-caption').textContent = (value.before?.id ?? 'No selected release') + ' → ' + value.after.id;
  $('#review-title').textContent = value.after.label;
  $('#review-mode').textContent = value.after.mode;
  $('#review-description').textContent = value.after.publicOrigin + ' · ' + value.after.routes.length + ' routes. Selection applies on the next start; the running seller is unchanged until restart.';
  const summary = $('#review-summary'); summary.replaceChildren();
  for (const [label, count] of [['Added', value.summary.added], ['Changed', value.summary.changed], ['Removed', value.summary.removed], ['Unchanged', value.summary.unchanged]]) {
    const item = node('div'); item.append(node('strong', String(count)), node('span', label)); summary.append(item);
  }
  const changes = $('#route-changes'); changes.replaceChildren();
  const rpcReview = Boolean(value.before?.jsonrpc || value.after.jsonrpc);
  for (const change of value.changes) {
    const section = node('section', undefined, 'change'); section.append(node('h3', change.state + ' · ' + change.route));
    if (change.state !== 'CHANGED') {
      const route = change.after ?? change.before;
      section.append(node('small', 'Exact payment alternatives · amounts in atomic units'), node('pre', rpcReview ? terms(route.payment) : literal(route.payment)));
      if (route.upstream) section.append(node('small', 'Original upstream configuration and sharing policy'), node('pre', literal(route.upstream)));
    }
    for (const field of change.fields) {
      if (rpcReview && ['application', 'requestContractSha256'].includes(field.field)) {
        const details = node('details');
        details.append(node('summary', field.field === 'application' ? 'Retained RPC execution changed' : 'RPC request or response contract changed'),
          fieldPair(field.field === 'application' ? 'Execution identity' : 'Contract identity', field.before, field.after));
        section.append(details);
      } else section.append(fieldPair(rpcReview && field.field === 'payment' ? 'Payment alternatives' : field.field,
        rpcReview && field.field === 'payment' ? terms(field.before) : field.before,
        rpcReview && field.field === 'payment' ? terms(field.after) : field.after));
    }
    changes.append(section);
  }
  if (!value.changes.length) changes.append(node('p', 'Route offers, input contracts and application bindings match.', 'section-note'));
  const runtime = $('#runtime-changes'); runtime.replaceChildren();
  for (const change of value.runtimeChanges) runtime.append(change.field === 'jsonrpc'
    ? rpcRuntimeChange(change.before, change.after) : fieldPair('Runtime · ' + change.field, change.before, change.after));
  if (value.after.handlerEntry) runtime.append(node('p', 'Handler entry module is pinned. Its imported files and installed package dependencies are managed separately by the operator.', 'section-note'));
  $('#selection-actions').hidden = false;
  for (const button of document.querySelectorAll('.release-card')) button.setAttribute('aria-pressed', String(button.dataset.id === selected));
  discovery.selectRelease(value.after);
  buttons();
}
async function choose(releaseId) {
  selected = releaseId; comparison = null; busy = true; buttons();
  try { renderDiff(await request('/api/diff?to=' + encodeURIComponent(releaseId))); await refreshCatalog(); notice(); }
  catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
}
async function refresh() {
  busy = true; buttons();
  try {
    const value = await request('/api/status'); renderStatus(value);
    await refreshCaches();
    await discovery.refresh();
    if (selected && !value.releases.some(r => r.id === selected)) selected = null;
    selected ??= value.state.active ?? value.releases[0]?.id ?? null;
    if (selected) renderDiff(await request('/api/diff?to=' + encodeURIComponent(selected)));
    await refreshCatalog();
    if (value.console.lastError) notice(value.console.lastError, true);
  } catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
}
async function act(action) {
  if (!snapshot || busy) return;
  const payload = { expectedGeneration: comparison?.generation ?? snapshot.state.generation,
    instanceId: snapshot.console.instanceId, reason: $('#reason').value.trim() || 'Operator ' + action };
  if (action === 'activate') payload.id = selected;
  if (['run', 'restart'].includes(action)) payload.expectedGeneration = snapshot.state.generation;
  busy = true; buttons(); notice(action === 'run' || action === 'restart' ? 'Starting the selected seller release…' : 'Saving operator action…');
  try {
    const value = await request('/api/' + action, payload); renderStatus(value);
    await refreshCaches();
    if (action === 'rollback') selected = value.state.active;
    if (selected) renderDiff(await request('/api/diff?to=' + encodeURIComponent(selected)));
    await refreshCatalog();
    notice(action === 'activate' || action === 'rollback' ? 'Selection saved. Use Start or Restart selected to run it.' : 'Operator action completed.');
  } catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
}
const discovery = bindDiscoveryControls({ request, notice, refresh, isBusy: () => busy || !snapshot || snapshot.console.busy,
  setBusy: value => { busy = value; buttons(); } });
$('#refresh').addEventListener('click', () => { notice(); refresh(); });
$('#activate').addEventListener('click', () => act('activate'));
$('#rollback').addEventListener('click', () => act('rollback'));
$('#start').addEventListener('click', () => act('run'));
$('#restart').addEventListener('click', () => act('restart'));
$('#stop').addEventListener('click', () => act('stop'));
$('#catalog-refresh').addEventListener('click', async () => {
  if (busy) return; busy = true; buttons();
  try { await refreshCatalog(); } finally { busy = false; buttons(); }
});
$('#catalog-review').addEventListener('click', () => reviewCatalog());
$('#catalog-apply').addEventListener('click', () => applyCatalog());
$('#catalog-reason').addEventListener('input', buttons);
$('#cache-refresh').addEventListener('click', async () => {
  if (busy) return; busy = true; buttons();
  try { await refreshCaches(); notice(); } catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
});
$('#cache-invalidate-all').addEventListener('click', () => invalidateCache());
refresh();
