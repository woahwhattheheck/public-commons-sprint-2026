// MIT. Tenant discovery controls over the original fleet, SF82 and SF60 APIs.
const $ = id => document.getElementById(id);
const PAGE = 25;
const PERMISSIONS = [
  ['allowedOrigins', 'Origins'], ['allowedRecipients', 'Recipients'],
  ['allowedNetworks', 'Networks'], ['allowedSchemes', 'Payment schemes'],
];
const FIELDS = ['seller-id', 'source-url', 'source-mode', 'source-slot', 'source-release',
  'route', 'reason', 'history-key', 'query', 'network', 'type', 'scheme', 'payto', 'extensions', 'limit'];
const ERRORS = {
  FLEET_DISCOVERY_SERVING_CHANGED: 'The serving merchant or gateway revision changed. Review the current identity and offers again.',
  FLEET_DISCOVERY_REVIEW_EXPIRED: 'This review expired or was already consumed. Read the current state and create a new review.',
  FLEET_DISCOVERY_PERMISSIONS_CHANGED: 'These offers exceed the retained enrollment. Inspect the new origins, recipients, networks and schemes.',
  FLEET_DISCOVERY_AUTHORITY_CHANGED: 'The tenant signing authority changed. Refresh its enrollment before reviewing again.',
  FLEET_DISCOVERY_ALREADY_ENROLLED: 'This tenant already has an enrollment. Refresh to reopen its retained identity.',
  FLEET_DISCOVERY_SETUP_REQUIRED: 'Review the current serving release and create its tenant enrollment.',
  FLEET_DISCOVERY_START_REQUIRED: 'Start the tenant’s retained discovery service.',
  FLEET_DISCOVERY_CONSUMER_REQUIRED: 'Start discovery to open its original buyer explorer.',
  FLEET_DISCOVERY_CLOSING: 'The fleet discovery owner is closing. Reopen the same workspace after it stops.',
  FLEET_DISCOVERY_RESOURCE_UNKNOWN: 'This resource is not in the enrolled tenant’s original catalog.',
  FLEET_DISCOVERY_INCOMPLETE_CHANGED: 'The retained partial setup changed. Refresh its inspection and review recovery again.',
  DISCOVERY_CONSOLE_CONFLICT: 'The owned discovery instance changed. Refresh before stopping it.',
  RELEASE_CATALOG_CHANGED: 'The original catalog changed during this read. Refresh and review the current journal head.',
  RELEASE_CATALOG_REVIEW_STALE: 'The source, signer, running instance or catalog changed after review. Read the current differences.',
  RELEASE_CATALOG_NOT_LISTED: 'Select a currently listed route in this exact release source.',
  RELEASE_CATALOG_OTHER_SELLER: 'The listing belongs to another catalog seller.',
  RELEASE_CATALOG_SIGNER_CHANGED: 'The listing uses another original signer. Inspect its retained seller authority.',
  WORKSPACE_SESSION_REQUIRED: 'This workspace process restarted. Reload this page to open its current local session.',
  WORKSPACE_CONNECTION_LOST: 'The workspace connection was lost.',
  WORKSPACE_RESPONSE_UNAVAILABLE: 'The workspace response could not be read.',
};
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = String(text);
  if (className) value.className = className;
  return value;
};
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : String(value ?? '—');
const pretty = value => JSON.stringify(value, null, 2);
const bindingKey = value => value ? JSON.stringify([
  value.tenant, value.host, value.slot, value.instanceId, value.releaseId, value.releaseDigest,
  value.port, value.revision, value.digest, value.snapshotId,
]) : '';
function options(select, rows, value) {
  if (JSON.stringify([...select.options].map(row => [row.value, row.textContent])) !== JSON.stringify(rows))
    select.replaceChildren(...rows.map(([id, label]) => {
      const item = node('option', label); item.value = id; return item;
    }));
  if (rows.some(([id]) => id === value)) select.value = value;
}
function table(headers, rows, empty = 'No original records in this view.') {
  if (!rows.length) return node('p', empty, 'empty');
  const element = node('table', undefined, 'discovery-table'), head = node('thead'), heading = node('tr');
  headers.forEach(value => heading.append(node('th', value))); head.append(heading);
  const body = node('tbody');
  rows.forEach(values => {
    const row = node('tr');
    values.forEach(value => {
      const cell = node('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); row.append(cell);
    }); body.append(row);
  });
  element.append(head, body); return element;
}
function identity(rows) {
  const list = node('dl', undefined, 'discovery-identity');
  rows.forEach(([label, value]) => { if (value !== undefined && value !== null && value !== '')
    list.append(node('dt', label), node('dd', value)); });
  return list;
}
function originalDetails(label, value) {
  const details = node('details'); details.append(node('summary', label));
  let rendered = false;
  details.addEventListener('toggle', () => {
    if (details.open && !rendered) { details.append(node('pre', pretty(value))); rendered = true; }
  });
  return details;
}
function payments(values) {
  const box = node('div', undefined, 'discovery-payment');
  if (!Array.isArray(values) || !values.length) { box.append(node('span', 'None')); return box; }
  values.forEach(payment => {
    const row = node('div', undefined, 'discovery-payment-row');
    row.append(node('span', (payment.scheme ?? '—') + ' · ' + (payment.network ?? '—')),
      node('span', 'Amount ' + String(payment.amount ?? '—')),
      node('span', 'Asset ' + String(payment.asset ?? '—')),
      node('span', 'Recipient ' + String(payment.payTo ?? '—')));
    row.append(originalDetails('Exact payment choice', payment)); box.append(row);
  }); return box;
}
function offerIdentity(row) {
  const box = node('div', undefined, 'discovery-offer');
  box.append(node('strong', row.routeId ?? row.resource?.description ?? 'Resource'),
    node('code', [row.method, row.url ?? row.resource?.url].filter(Boolean).join(' ')));
  if (row.catalogKey) box.append(node('div', row.catalogKey, 'digest'));
  if (row.sourceSha256) box.append(node('div', 'Source SHA-256 ' + row.sourceSha256, 'digest'));
  return box;
}
function permissionView(value) {
  const box = node('div'); if (!value) return box;
  const requested = value.requested ?? value, enrolled = value.enrolled;
  box.append(node('h4', 'Seller permissions'));
  const wrap = node('div', undefined, 'table-wrap');
  wrap.append(table(enrolled ? ['Permission', 'Enrolled', 'Requested by this source', 'New values'] : ['Permission', 'From original source'],
    PERMISSIONS.map(([key, label]) => {
      const format = list => (list ?? []).join('\n') || 'None';
      return enrolled ? [label, node('pre', format(enrolled[key])), node('pre', format(requested[key])),
        node('pre', format(value.additions?.[key]))] : [label, node('pre', format(requested[key]))];
    })));
  box.append(wrap);
  if (value.covered === false) box.append(node('p',
    'The requested source includes permissions outside this enrollment. Publication requires matching enrolled permissions; a reviewed withdrawal can still use its retained original source.',
    'small discovery-permission-note'));
  return box;
}

export function bindFleetDiscoveryControls({ request, getReleases, isBusy, setBusy, confirmChange }) {
  let selected = null, state = null, loadedStamp = null, attemptedStamp = null, stopped = false;
  let busy = false, pending = null, queued = false, scopeVersion = 0, review = null, reviewStamp = null, reviewPage = 0;
  let initialized = false, historyPage = 0;
  let reviewTimer, sourceCatalog = null, sourceCatalogSlot = null, retainedSource = null, offersPage = 0;
  let history = null, result = null, consumer = null, navigation = null;
  const drafts = new Map(), controllers = new Set(), downloads = new Map(), listeners = [];
  const get = name => $('discovery-' + name);
  const currentTenant = () => getReleases()?.tenants?.find(row => row.id === selected);
  const serving = () => state?.serving;
  const running = () => state?.state === 'RUNNING';
  const blocked = () => stopped || busy || isBusy();
  const stamp = () => {
    const releases = getReleases(), tenant = currentTenant();
    return JSON.stringify([releases?.native?.revision, releases?.native?.digest, releases?.native?.snapshotId,
      releases?.relationship, releases?.closing, selected, tenant?.host,
      (tenant?.slots ?? []).map(row => [row.name, row.serving, row.owned, row.instanceId, row.runningReleaseId])]);
  };
  const fresh = () => state?.tenant === selected && loadedStamp === stamp() && !getReleases()?.closing;
  const displayedSource = () => get('source-mode').value === 'retained' ? retainedSource :
    state?.catalog ? { tenant: selected, slot: serving()?.slot, serving: serving(), catalog: state.catalog,
      permissions: state.permissions } : null;
  const sourceRows = () => displayedSource()?.catalog?.rows ?? [];
  const on = (element, type, fn) => { element.addEventListener(type, fn); listeners.push([element, type, fn]); };
  function notice(message, error = false) {
    get('notice').textContent = message; get('notice').dataset.error = String(error); get('notice').hidden = !message;
  }
  function saveDraft() {
    if (selected) drafts.set(selected, Object.fromEntries(FIELDS.map(key => [key, get(key).value])));
  }
  function restoreDraft() {
    const value = drafts.get(selected) ?? {};
    FIELDS.forEach(key => { get(key).value = value[key] ?? ({ 'source-mode': 'current', limit: '25' }[key] ?? ''); });
  }
  function clearReview(message) {
    const existed = Boolean(review);
    review = null; reviewStamp = null; reviewPage = 0; clearTimeout(reviewTimer);
    get('review').hidden = true;
    if (message && existed) notice(message);
  }
  function validReview() {
    return Boolean(review && fresh() && reviewStamp === stamp() && review.tenant === selected &&
      bindingKey(review.serving) === bindingKey(serving()) && Date.parse(review.expiresAt) > Date.now());
  }
  function download(name, value) {
    if (value === undefined || value === null || stopped) return;
    const blob = new Blob([pretty(value) + '\n'], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = node('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000);
    downloads.set(url, timer);
  }
  function filename(kind) { return selected + '-discovery-' + kind + '.json'; }
  async function call(path = '', body, query = {}) {
    if (stopped) return null;
    const target = selected, version = scopeVersion;
    if (!target) throw new Error('Select a merchant.');
    const controller = body === undefined ? new AbortController() : null;
    if (controller) controllers.add(controller);
    try {
      const response = await request('releases/discovery' + path +
        (body === undefined ? '?' + new URLSearchParams({ tenant: target, ...query }) : ''),
      body === undefined ? undefined : { ...body, tenant: target }, controller ? { signal: controller.signal } : undefined);
      if (stopped || version !== scopeVersion) return null;
      if (response?.tenant !== target) throw new Error('The returned discovery record belongs to another merchant. Refresh this view.');
      return response;
    } finally { if (controller) controllers.delete(controller); }
  }
  async function execute(task) {
    if (blocked() || !selected) return;
    busy = true; setBusy(true); syncButtons();
    pending = (async () => {
      try { return await task(); }
      catch (error) { if (!stopped) notice(ERRORS[error.message] ?? error.message, true); }
      finally {
        busy = false; pending = null;
        if (!stopped) { setBusy(false); update(); }
      }
    })();
    return pending;
  }
  function queueRefresh() {
    if (!initialized || queued || stopped || blocked() || !selected || attemptedStamp === stamp()) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!blocked() && selected && attemptedStamp !== stamp()) void refresh(); });
  }
  function setBuyerLink() {
    const link = get('buyer-link');
    link.hidden = true; link.removeAttribute('href');
    if (!fresh() || !running() || state.consumer?.state !== 'RUNNING') return;
    try {
      const url = new URL(state.consumer.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) return;
      link.href = url.href; link.hidden = false;
    } catch { /* Only the original owned loopback explorer is linked. */ }
  }
  function filters() {
    return { query: get('query').value.trim(), network: get('network').value, type: get('type').value,
      scheme: get('scheme').value.trim(), payTo: get('payto').value.trim(),
      extensions: get('extensions').value.trim(), limit: Number(get('limit').value) };
  }
  const filtersMatch = () => navigation && JSON.stringify(filters()) === JSON.stringify(navigation.filters);
  function nextCursor() {
    const value = consumer?.page?.pagination?.cursor;
    return typeof value === 'string' && value.length > 0 && value.length <= 512 &&
      !/[\u0000-\u001f\u007f]/.test(value) && value !== navigation?.cursor &&
      !navigation?.history?.includes(value) ? value : null;
  }
  function morePages() {
    if (!navigation || !consumer) return false;
    if (navigation.filters.query) return Boolean(nextCursor());
    const total = consumer.page.pagination?.total, rows = consumer.page.resources ?? [];
    return rows.length > 0 && (Number.isSafeInteger(total) ? navigation.offset + rows.length < total : rows.length === navigation.filters.limit);
  }
  function syncButtons() {
    const unavailable = blocked(), live = running(), exact = fresh(), original = Boolean(state?.enrollment);
    $('fleet-discovery').setAttribute('aria-busy', String(unavailable));
    get('offers').querySelectorAll('[data-discovery-history]').forEach(button => {
      button.disabled = unavailable || !live || button.dataset.historyAvailable !== 'true';
    });
    get('history').querySelectorAll('[data-discovery-history-page]').forEach(button => {
      button.disabled = unavailable || (button.dataset.discoveryHistoryPage === 'previous' ? historyPage === 0 :
        (historyPage + 1) * PAGE >= (history?.history?.length ?? 0));
    });
    const initial = ['NEW', 'INCOMPLETE'].includes(state?.state);
    get('tenant').disabled = unavailable; get('refresh').disabled = unavailable || !selected;
    for (const id of ['seller-id', 'source-url', 'source-mode', 'source-slot', 'source-release', 'route', 'reason',
      'history-key', 'query', 'network', 'type', 'scheme', 'payto', 'extensions', 'limit']) get(id).disabled = unavailable;
    get('review-enrollment').disabled = unavailable || !exact || !serving() || !initial ||
      (state?.state === 'INCOMPLETE' && !state.recovery?.inspectionId);
    get('start').disabled = unavailable || !exact || !original || live;
    get('stop').disabled = unavailable || !exact || !live || !state.instanceId;
    get('download-enrollment').disabled = unavailable || !original;
    get('read-source').disabled = unavailable || !live || (get('source-mode').value === 'retained' && !get('source-release').value);
    get('source-slot').disabled = unavailable || get('source-mode').value !== 'retained';
    get('source-release').disabled = unavailable || get('source-mode').value !== 'retained';
    get('download-source').disabled = unavailable || !displayedSource();
    get('review-publish').disabled = unavailable || !exact || !live || !serving() ||
      get('source-mode').value !== 'current' || !state.catalog || state.permissions?.covered !== true;
    get('review-withdraw').disabled = unavailable || !exact || !live || !serving() ||
      !get('route').value || !displayedSource();
    get('offers-prev').disabled = unavailable || offersPage === 0;
    get('offers-next').disabled = unavailable || (offersPage + 1) * PAGE >= sourceRows().length;
    get('clear-review').disabled = unavailable;
    get('download-review').disabled = unavailable || !review;
    get('review-prev').disabled = unavailable || reviewPage === 0;
    get('review-next').disabled = unavailable || (reviewPage + 1) * PAGE >= reviewRows().length;
    get('apply').disabled = unavailable || !validReview() ||
      (review?.catalog?.action === 'publish' && review.permissions?.covered !== true);
    get('read-history').disabled = unavailable || !live;
    get('download-history').disabled = unavailable || !history;
    get('read-page').disabled = unavailable || !live;
    get('page-prev').disabled = unavailable || !live || !filtersMatch() ||
      !navigation || (navigation.filters.query ? !navigation.history.length : navigation.offset === 0);
    get('page-next').disabled = unavailable || !live || !filtersMatch() || !morePages();
    get('restore-filters').disabled = unavailable || !navigation || filtersMatch();
    get('download-page').disabled = unavailable || !consumer;
    get('source-slot-label').hidden = get('source-mode').value !== 'retained';
    get('source-release-label').hidden = get('source-mode').value !== 'retained';
    get('enrollment-form').hidden = !initial;
    if (consumer && !filtersMatch()) get('page-note').textContent =
      'The displayed page retains its submitted filters. Read public page to apply the edited filters, or restore the displayed filters.';
    setBuyerLink();
  }
  function renderRecovery(value, target = get('recovery')) {
    target.replaceChildren(); target.hidden = !value;
    if (!value) return;
    target.append(node('h4', 'Recover the interrupted enrollment'),
      node('p', 'Review preservation of the retained partial setup before the original enrollment is created.'),
      identity([['Inspection', value.inspectionId], ['Retained bytes', value.bytes], ['Recovery action', value.action]]));
    if (Array.isArray(value.files)) {
      const list = node('ul');
      value.files.forEach(file => list.append(node('li', file.name + ' · ' + file.bytes + ' bytes')));
      target.append(list);
    }
  }
  function renderState() {
    get('state').textContent = state?.state ?? 'Loading';
    const value = serving();
    get('serving').replaceChildren(...identity(value ? [
      ['Merchant', selected + ' · ' + value.host], ['Gateway revision', value.revision],
      ['Serving slot', value.slot], ['Owned seller instance', value.instanceId],
      ['Release', value.releaseId], ['Release digest', value.releaseDigest], ['Gateway snapshot', value.snapshotId],
    ] : [['Merchant', selected], ['Serving identity', state?.servingError?.code ?? 'No current serving identity']]).children);
    renderRecovery(state?.recovery);
    const enrollment = get('enrollment'); enrollment.replaceChildren(); enrollment.hidden = !state?.enrollment;
    if (state?.enrollment) enrollment.append(node('h3', 'Retained tenant enrollment'),
      identity([['Seller ID', state.enrollment.sellerId], ['Public key SHA-256', state.enrollment.publicKeySha256],
        ['Original enrollment release', state.enrollment.source?.releaseId], ['Public export', state.enrollment.source?.sourceURL],
        ['Discovery instance', state.instanceId], ['Discovery origin', state.discoveryOrigin]]),
      originalDetails('Original public enrollment summary', state.enrollment));
    if (state?.error || state?.catalogError) {
      const error = state.error ?? state.catalogError;
      notice(error.message ?? ERRORS[error.code] ?? error.code, true);
    }
    renderSource(); syncButtons();
  }
  function renderSource() {
    const source = displayedSource(), rows = sourceRows();
    offersPage = Math.min(offersPage, Math.max(0, Math.ceil(rows.length / PAGE) - 1));
    const retained = get('source-mode').value === 'retained';
    get('source-note').textContent = source ?
      (retained ? 'Retained source ' + source.slot : 'Current serving source') + ' · ' +
        rows.length + ' original offers · Journal head ' + String(source.catalog?.catalog?.journalHead ?? '—') :
      retained ? 'Choose the retained slot and release, then read that original source.' :
        running() ? 'Current serving offers are unavailable. Refresh the original merchant status.' : 'Start discovery to inspect the original catalog against the release offers.';
    const values = source?.catalog?.release;
    get('source-identity').replaceChildren();
    if (source) get('source-identity').append(identity([['Release', values?.id ?? source.source?.releaseId],
      ['Release digest', values?.digest ?? source.source?.digest], ['Service configuration SHA-256', values?.serviceConfigSha256 ?? source.source?.serviceConfigSha256],
      ['Seller ID', source.catalog?.catalog?.sellerId], ['Source URL', source.catalog?.catalog?.sourceURL]]),
      originalDetails('Complete original source readback', source));
    get('permissions').replaceChildren(permissionView(source?.permissions));
    get('offers').replaceChildren(table(['Original resource', 'Catalog state', 'Release payment choices', 'Current catalog payments', 'History'],
      rows.slice(offersPage * PAGE, (offersPage + 1) * PAGE).map(row => {
        const button = node('button', 'History'); button.type = 'button';
        button.dataset.discoveryHistory = row.catalogKey; button.dataset.historyAvailable = String(Boolean(row.before));
        button.disabled = blocked() || !running() || !row.before;
        button.addEventListener('click', () => {
          get('history-key').value = row.catalogKey; saveDraft(); void execute(() => readHistory(row.catalogKey));
        });
        return [offerIdentity(row), row.state, payments(row.payment), row.before ? payments(row.before.payment) : 'Not listed', button];
      }), 'No offers are loaded for this source.'));
    get('offers-page').textContent = rows.length ? (offersPage * PAGE + 1) + '–' + Math.min(rows.length, (offersPage + 1) * PAGE) + ' of ' + rows.length : '0 offers';
    const chosen = get('route').value;
    const available = rows.filter(row => row.before && !row.before.retired && row.state !== 'OTHER_SELLER' && row.state !== 'SIGNER_CHANGED');
    options(get('route'), [['', 'Choose a listed route'], ...available.map(row => [row.routeId, row.routeId + ' · ' + row.method + ' ' + row.url])], chosen);
    if (!available.some(row => row.routeId === chosen)) get('route').value = '';
    syncButtons();
  }
  function reviewRows() { return review?.kind === 'enrollment' ? review.enrollment?.source?.resources ?? [] : review?.catalog?.changes ?? []; }
  function renderReview() {
    if (!review) { get('review').hidden = true; return; }
    const enrollment = review.kind === 'enrollment', action = review.catalog?.action;
    get('review').hidden = false;
    get('review-title').textContent = enrollment ? 'Review tenant enrollment' :
      action === 'withdraw' ? 'Review signed withdrawal' : 'Review signed publication';
    get('review-note').textContent = 'Gateway revision ' + review.serving.revision + ' · Instance ' + review.serving.instanceId +
      ' · Expires ' + date(review.expiresAt) + ' · Review ' + review.reviewId;
    const summary = get('review-summary'); summary.replaceChildren();
    if (enrollment) {
      summary.append(identity([['Seller ID', review.enrollment.sellerId], ['Source URL', review.enrollment.source?.sourceURL],
        ['Original release', review.enrollment.source?.releaseId], ['Source digest', review.enrollment.source?.digest]]),
        permissionView(review.enrollment.permissions));
      if (review.recovery) {
        const recovery = node('div', undefined, 'discovery-recovery'); renderRecovery(review.recovery, recovery); summary.append(recovery);
      }
    } else summary.append(identity([['Source release', review.catalog.release?.id], ['Source digest', review.catalog.release?.digest],
      ['Seller ID', review.catalog.catalog?.sellerId], ['Catalog journal head', review.catalog.catalog?.journalHead],
      ['Withdrawal reason', review.catalog.reason]]), permissionView(review.permissions));
    const rows = reviewRows();
    reviewPage = Math.min(reviewPage, Math.max(0, Math.ceil(rows.length / PAGE) - 1));
    get('review-changes').replaceChildren(table(enrollment ? ['Original resource', 'Enrolled payment choices'] :
      ['Original resource', 'Before', 'After', 'Next sequence'], rows.slice(reviewPage * PAGE, (reviewPage + 1) * PAGE).map(row =>
        enrollment ? [offerIdentity(row), payments(row.payment)] : [offerIdentity(row),
          row.before ? payments(row.before.payment) : 'Not listed',
          action === 'withdraw' ? 'Withdraw this listing' : payments(row.payment), row.nextSequence]),
      enrollment ? 'No original enrollment resources.' : 'The current original catalog already matches these offers.'));
    get('review-page').textContent = rows.length ? (reviewPage * PAGE + 1) + '–' + Math.min(rows.length, (reviewPage + 1) * PAGE) + ' of ' + rows.length : '0 changes';
    get('apply').textContent = enrollment ? (review.recovery ? 'Recover and create reviewed enrollment' : 'Create reviewed enrollment') :
      action === 'withdraw' ? 'Apply signed withdrawal' : 'Apply signed publication';
    syncButtons();
  }
  function acceptReview(value) {
    if (!value) return;
    clearReview(); review = value; reviewStamp = stamp(); reviewPage = 0;
    if (!validReview()) { clearReview(); throw new Error('FLEET_DISCOVERY_SERVING_CHANGED'); }
    reviewTimer = setTimeout(() => { clearReview('The discovery review expired. Review the original current source again.'); syncButtons(); },
      Math.max(1, Date.parse(review.expiresAt) - Date.now() + 10));
    renderReview(); get('review').scrollIntoView({ block: 'nearest' });
  }
  async function readStatus() {
    const expected = stamp(), priorInstance = state?.instanceId; attemptedStamp = expected; loadedStamp = null;
    const value = await call();
    if (!value) return;
    if (expected !== stamp()) { loadedStamp = null; attemptedStamp = null; clearReview(); return; }
    state = value; loadedStamp = expected;
    if (priorInstance && priorInstance !== state.instanceId) { consumer = null; navigation = null; renderConsumer(); }
    if (review && (!validReview() || review.kind === 'enrollment' && state.enrollment ||
      review.kind === 'publication' && state.catalog?.catalog?.journalHead !== undefined &&
      state.catalog.catalog.journalHead !== review.catalog.catalog.journalHead))
      clearReview('The serving identity, enrollment or original catalog changed. Review the current source again.');
    renderState();
  }
  async function readCatalog() {
    if (stopped) return;
    const slot = get('source-slot').value, target = selected, version = scopeVersion;
    if (!slot) return;
    const controller = new AbortController(); controllers.add(controller);
    let value;
    try { value = await request('releases/catalog?' + new URLSearchParams({ tenant: target, slot }), undefined, { signal: controller.signal }); }
    finally { controllers.delete(controller); }
    if (stopped || version !== scopeVersion || slot !== get('source-slot').value) return;
    if (!Array.isArray(value.releases)) throw new Error('The original release catalog response is incomplete.');
    sourceCatalog = value; sourceCatalogSlot = slot;
    const preferred = get('source-release').value || drafts.get(selected)?.['source-release'] || value.selectedReleaseId;
    options(get('source-release'), value.releases.length ?
      value.releases.map(row => [row.id, row.id + (row.label ? ' · ' + row.label : '')]) : [['', 'No retained release']], preferred);
    if (value.errors?.length) notice(value.errors.length + ' retained release entries could not be read. The available original entries are listed.', true);
    syncButtons();
  }
  async function readRetainedSource() {
    if (!running()) return;
    const slot = get('source-slot').value, releaseId = get('source-release').value;
    retainedSource = null;
    if (!slot || !releaseId) return;
    const value = await call('/source', undefined, { slot, releaseId });
    if (value && (value.slot !== slot || value.catalog?.release?.id !== releaseId))
      throw new Error('The returned source differs from the selected retained release.');
    retainedSource = value; offersPage = 0; renderSource();
  }
  async function refreshInside() {
    if (stopped) return;
    await readStatus();
    if (stopped || !fresh()) return;
    if (get('source-mode').value === 'retained') { await readCatalog(); if (running()) await readRetainedSource(); }
  }
  async function refresh() {
    initialized = true;
    return execute(async () => {
      notice('Reading the original tenant discovery state…');
      await refreshInside();
      if (fresh() && !state.error && !state.catalogError) notice('Original tenant discovery state refreshed.');
    });
  }
  async function readHistory(key) {
    const value = await call('/history', undefined, { catalogKey: key });
    if (!value) return;
    history = value; historyPage = 0; get('history-key').value = key; saveDraft(); renderHistory(); syncButtons();
  }
  function renderHistory() {
    const value = history; if (!value) { get('history').replaceChildren(); return; }
    const key = value.catalogKey;
    const box = get('history'); box.replaceChildren(identity([['Catalog resource', key], ['Seller ID', value.sellerId],
      ['Journal head', value.journalHead], ['Retained revisions', value.history?.length]]),
      originalDetails('Original signed lifecycle history', value));
    if (Array.isArray(value.history)) box.append(table(['Sequence', 'Action', 'Observed / recorded', 'Original record'],
      value.history.slice(historyPage * PAGE, (historyPage + 1) * PAGE).map(row => [row.sequence, row.record?.action ?? row.action ?? row.record?.schema ?? 'Record',
        row.record?.observedAt ?? row.at ?? '—', originalDetails('Read signed record', row)])));
    if (Array.isArray(value.history) && value.history.length > PAGE) {
      const pager = node('div', undefined, 'button-row'), previous = node('button', 'Previous records'), next = node('button', 'Next records');
      previous.type = next.type = 'button'; previous.dataset.discoveryHistoryPage = 'previous'; next.dataset.discoveryHistoryPage = 'next';
      previous.disabled = blocked() || historyPage === 0;
      next.disabled = blocked() || (historyPage + 1) * PAGE >= value.history.length;
      previous.addEventListener('click', () => { if (!blocked()) { historyPage--; renderHistory(); } });
      next.addEventListener('click', () => { if (!blocked()) { historyPage++; renderHistory(); } });
      pager.append(previous, node('span', (historyPage * PAGE + 1) + '–' + Math.min(value.history.length, (historyPage + 1) * PAGE) + ' of ' + value.history.length, 'small'), next);
      box.append(pager);
    }
  }
  function renderResult() {
    const box = get('result'); box.hidden = !result; box.replaceChildren();
    if (!result) return;
    box.append(node('h3', 'Original operation readback'),
      identity([['Decision', result.result?.decision ?? result.decision ?? result.state],
        ['Signatures issued', result.result?.signaturesIssued], ['Source release', result.result?.releaseId]]),
      originalDetails('Complete original result', result));
    const button = node('button', 'Download original result'); button.type = 'button';
    button.addEventListener('click', () => download(filename('result'), result)); box.append(button);
  }
  async function write(path, body) {
    clearReview(); result = null; renderResult();
    let failure;
    try { result = await call(path, body); if (result) renderResult(); }
    catch (error) { failure = error; }
    try {
      await refreshInside();
    } catch (error) { if (!failure) failure = error; }
    let historyError;
    if (history?.catalogKey && running() && fresh()) {
      try { await readHistory(history.catalogKey); } catch (error) { historyError = error; }
    }
    if (stopped) return;
    if (failure) notice((ERRORS[failure.message] ?? failure.message) +
      (fresh() ? ' The original state above has been reconciled. Review it before choosing another write.' :
        ' Refresh the original state before choosing another write.'), true);
    else if (historyError) notice('The original operation completed and its current tenant state was read back. History refresh: ' +
      (ERRORS[historyError.message] ?? historyError.message), true);
    else notice('The original operation completed and its current tenant state was read back.');
  }
  function confirmApply() {
    if (blocked() || !validReview()) return;
    const selectedReview = review, enrollment = review.kind === 'enrollment';
    const title = enrollment ? 'Create the reviewed tenant enrollment?' :
      review.catalog.action === 'withdraw' ? 'Withdraw the reviewed listing?' : 'Publish the reviewed signed changes?';
    const details = ['Merchant: ' + selected, 'Serving slot: ' + review.serving.slot,
      'Instance: ' + review.serving.instanceId, 'Gateway revision: ' + review.serving.revision,
      'Review: ' + review.reviewId, 'Original resources / changes: ' + reviewRows().length];
    if (review.recovery) details.push('Recovery: preserve the reviewed partial setup (' + review.recovery.bytes + ' bytes).');
    confirmChange(title, enrollment ? 'The original enrollment will retain the reviewed seller identity, source and permissions.' :
      'The original seller authority signs these exact reviewed catalog changes.', details.join('\n'), () => {
      if (review !== selectedReview || !validReview()) {
        clearReview('The serving identity or review changed while confirmation was open. Review the current source again.'); syncButtons(); return;
      }
      return execute(() => write(enrollment ? '/enrollment/create' : '/apply', { reviewId: selectedReview.reviewId }));
    });
  }
  async function readPage(nav) {
    const query = { view: nav.filters.query ? 'search' : 'list', limit: String(nav.filters.limit) };
    for (const key of ['network', 'type', 'scheme', 'payTo', 'extensions']) if (nav.filters[key]) query[key] = nav.filters[key];
    if (nav.filters.query) { query.query = nav.filters.query; if (nav.cursor) query.cursor = nav.cursor; }
    else query.offset = String(nav.offset);
    const value = await call('/consume', undefined, query);
    if (!value) return;
    if (!Array.isArray(value.page?.resources)) throw new Error('The original buyer explorer did not return a resource page.');
    consumer = value; navigation = { ...nav, request: Object.fromEntries(new URLSearchParams(query)) }; renderConsumer(); syncButtons();
  }
  function renderConsumer() {
    get('public-page').replaceChildren();
    if (!consumer) { get('page-note').textContent = 'Read the original public page after starting discovery.'; return; }
    const page = consumer.page, rows = page.resources;
    get('page-note').textContent = rows.length + ' resources on page ' + navigation.page +
      (Number.isSafeInteger(page.pagination?.total) ? ' · ' + page.pagination.total + ' declared by the provider' : '') +
      ' · Observed ' + date(page.observedAt) + (page.partialResults ? ' · Provider returned partial results' : '') +
      '. Displayed filters: ' + pretty(navigation.filters);
    get('public-page').append(table(['Resource', 'Description', 'Exact payment choices', 'Native resource'],
      rows.map(row => [offerIdentity(row), row.resource?.description ?? row.description ?? '—',
        payments(row.accepts ?? row.paymentChoices), originalDetails('Read native resource', row)]),
      'This original public page contains no matching resources.'), originalDetails('Original page and pagination', page));
  }
  async function selectTenant(id) {
    if (blocked() || !getReleases()?.tenants?.some(row => row.id === id)) return;
    changeTenant(id); update(); await refresh();
  }
  function changeTenant(id) {
    saveDraft(); scopeVersion++; selected = id; state = null; loadedStamp = null; attemptedStamp = null;
    clearReview(); sourceCatalog = null; sourceCatalogSlot = null; retainedSource = null;
    history = null; consumer = null; navigation = null; result = null; offersPage = 0;
    restoreDraft(); get('history').replaceChildren(); renderResult(); renderConsumer(); renderState();
  }
  function update() {
    const tenants = getReleases()?.tenants ?? [];
    $('fleet-discovery').hidden = !tenants.length;
    if (stopped) return;
    if (!tenants.length) { clearReview(); get('buyer-link').hidden = true; get('buyer-link').removeAttribute('href'); return; }
    if (!selected || !tenants.some(row => row.id === selected)) changeTenant(tenants[0].id);
    options(get('tenant'), tenants.map(row => [row.id, row.id + ' · ' + row.host]), selected);
    const tenant = currentTenant(), previous = get('source-slot').value;
    options(get('source-slot'), tenant.slots.map(row => [row.name, row.name + (row.serving ? ' · serving' : '')]),
      previous || drafts.get(selected)?.['source-slot'] || tenant.slots.find(row => row.serving)?.name);
    if (review && !validReview()) clearReview('The gateway revision or serving instance changed. Review the current merchant source again.');
    if (loadedStamp && loadedStamp !== stamp()) {
      get('state').textContent = 'Refresh required'; setBuyerLink();
      if (!busy) notice('Serving state changed. Refreshing the exact tenant discovery identity…');
    }
    syncButtons(); queueRefresh();
  }

  on(get('tenant'), 'change', () => void selectTenant(get('tenant').value));
  on(get('refresh'), 'click', () => void refresh());
  on(get('enrollment-form'), 'submit', event => {
    event.preventDefault(); if (!get('enrollment-form').reportValidity()) return;
    void execute(async () => {
      if (!fresh() || !serving()) throw new Error('FLEET_DISCOVERY_SERVING_CHANGED');
      const body = { slot: serving().slot, instanceId: serving().instanceId, sellerId: get('seller-id').value,
        ...(get('source-url').value ? { sourceURL: get('source-url').value } : {}),
        ...(state.state === 'INCOMPLETE' ? { expectedIncompleteId: state.recovery?.inspectionId } : {}) };
      saveDraft(); acceptReview(await call('/enrollment/review', body));
    });
  });
  for (const id of ['seller-id', 'source-url']) on(get(id), 'input', () => {
    saveDraft(); if (review?.kind === 'enrollment') clearReview('Enrollment inputs changed. Review their original source and permissions again.'); syncButtons();
  });
  on(get('start'), 'click', () => void execute(() => write('/start', {})));
  on(get('stop'), 'click', () => {
    if (blocked() || !fresh() || !state.instanceId) return;
    const instanceId = state.instanceId, tenant = selected;
    confirmChange('Stop tenant discovery?', 'Stop this exact owned catalog and buyer explorer. Its enrollment and signed history remain retained.',
      'Merchant: ' + tenant + '\nDiscovery instance: ' + instanceId, () => {
        if (selected !== tenant || !fresh() || state.instanceId !== instanceId) {
          notice('The owned discovery instance changed. Refresh before stopping it.', true); return;
        }
        return execute(() => write('/stop', { instanceId }));
      });
  });
  on(get('download-enrollment'), 'click', () => void execute(async () => {
    const value = await call('/enrollment'); if (value) download(filename('public-enrollment'), value.enrollment);
  }));
  on(get('source-mode'), 'change', () => {
    saveDraft(); retainedSource = null; offersPage = 0;
    clearReview('Source selection changed. Review the intended original source again.'); renderSource();
    if (get('source-mode').value === 'retained') void execute(readCatalog);
  });
  on(get('source-slot'), 'change', () => {
    get('source-release').replaceChildren(); retainedSource = null; sourceCatalog = null; sourceCatalogSlot = null;
    saveDraft(); clearReview('The retained source slot changed. Read and review its selected release again.'); renderSource(); void execute(readCatalog);
  });
  on(get('source-release'), 'change', () => { saveDraft(); retainedSource = null; clearReview('The retained release changed. Read its original source again.'); renderSource(); });
  on(get('source-form'), 'submit', event => { event.preventDefault(); void execute(async () => {
    clearReview(); if (get('source-mode').value === 'current') await readStatus();
    else { if (sourceCatalogSlot !== get('source-slot').value) await readCatalog(); await readRetainedSource(); }
    saveDraft();
  }); });
  on(get('download-source'), 'click', () => download(filename('source'), displayedSource()));
  on(get('offers-prev'), 'click', () => { if (!blocked()) { offersPage--; renderSource(); } });
  on(get('offers-next'), 'click', () => { if (!blocked()) { offersPage++; renderSource(); } });
  on(get('review-publish'), 'click', () => void execute(async () => {
    if (!fresh() || !serving()) throw new Error('FLEET_DISCOVERY_SERVING_CHANGED');
    acceptReview(await call('/review', { slot: serving().slot, instanceId: serving().instanceId, action: 'publish' }));
  }));
  on(get('withdraw-form'), 'submit', event => {
    event.preventDefault(); if (!get('withdraw-form').reportValidity()) return;
    void execute(async () => {
      if (!fresh() || !serving()) throw new Error('FLEET_DISCOVERY_SERVING_CHANGED');
      const source = displayedSource(), retained = get('source-mode').value === 'retained';
      if (!source || !sourceRows().some(row => row.routeId === get('route').value && row.before && !row.before.retired))
        throw new Error('RELEASE_CATALOG_NOT_LISTED');
      saveDraft();
      acceptReview(await call('/review', { slot: serving().slot, instanceId: serving().instanceId, action: 'withdraw',
        routeId: get('route').value, reason: get('reason').value,
        ...(retained ? { sourceSlot: source.slot, sourceReleaseId: source.catalog.release.id } : {}) }));
    });
  });
  for (const id of ['route', 'reason']) on(get(id), id === 'route' ? 'change' : 'input', () => {
    saveDraft(); if (review?.kind === 'publication') clearReview('Withdrawal inputs changed. Review the intended change again.'); syncButtons();
  });
  on(get('clear-review'), 'click', () => { if (!blocked()) { clearReview(); syncButtons(); } });
  on(get('download-review'), 'click', () => download(filename('review'), review));
  on(get('review-prev'), 'click', () => { if (!blocked()) { reviewPage--; renderReview(); } });
  on(get('review-next'), 'click', () => { if (!blocked()) { reviewPage++; renderReview(); } });
  on(get('apply'), 'click', confirmApply);
  on(get('history-form'), 'submit', event => { event.preventDefault(); if (get('history-form').reportValidity())
    void execute(() => readHistory(get('history-key').value)); });
  on(get('download-history'), 'click', () => download(filename('history'), history));
  on(get('consumer-form'), 'submit', event => { event.preventDefault(); if (!get('consumer-form').reportValidity()) return;
    saveDraft(); void execute(() => readPage({ filters: filters(), offset: 0, cursor: null, history: [], page: 1 }));
  });
  for (const id of ['query', 'network', 'type', 'scheme', 'payto', 'extensions', 'limit'])
    on(get(id), ['network', 'type', 'limit'].includes(id) ? 'change' : 'input', () => { saveDraft(); syncButtons(); });
  on(get('restore-filters'), 'click', () => {
    if (blocked() || !navigation) return;
    for (const [key, id] of [['query', 'query'], ['network', 'network'], ['type', 'type'], ['scheme', 'scheme'],
      ['payTo', 'payto'], ['extensions', 'extensions'], ['limit', 'limit']]) get(id).value = String(navigation.filters[key]);
    saveDraft(); renderConsumer(); syncButtons();
  });
  on(get('page-next'), 'click', () => {
    if (blocked() || !filtersMatch() || !morePages()) return;
    const nav = navigation, next = nav.filters.query ? { ...nav, cursor: nextCursor(),
      history: [...nav.history, nav.cursor], page: nav.page + 1 } :
      { ...nav, offset: nav.offset + nav.filters.limit, page: nav.page + 1 };
    void execute(() => readPage(next));
  });
  on(get('page-prev'), 'click', () => {
    if (blocked() || !filtersMatch() || !navigation || navigation.page <= 1) return;
    const nav = navigation, next = nav.filters.query ? { ...nav, cursor: nav.history.at(-1),
      history: nav.history.slice(0, -1), page: nav.page - 1 } :
      { ...nav, offset: Math.max(0, nav.offset - nav.filters.limit), page: nav.page - 1 };
    void execute(() => readPage(next));
  });
  on(get('download-page'), 'click', () => {
    if (!consumer?.page || !navigation?.request) return;
    const report = consumer.page;
    // Original SF61 observed-page envelope consumed by the existing SF88 buyer.
    download(filename('public-page'), {
      schema: 'scf61-observed-native-page-v1', observedAt: report.observedAt,
      sourceMode: report.mode, sourceUrl: report.sourceUrl ?? undefined,
      view: report.view, filterRequest: navigation.request, readOnly: true,
      nativeProviderRows: report.resources, pagination: report.pagination, paidOrSettled: false,
    });
  });
  return { update, refresh,
    async close() {
      if (stopped) return pending;
      const wasBusy = busy;
      saveDraft(); stopped = true; scopeVersion++; clearTimeout(reviewTimer); clearReview();
      controllers.forEach(value => value.abort()); controllers.clear();
      listeners.forEach(([element, type, fn]) => element.removeEventListener(type, fn));
      downloads.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url); }); downloads.clear();
      get('buyer-link').hidden = true; get('buyer-link').removeAttribute('href');
      await pending;
      if (wasBusy) setBusy(false);
    },
  };
}
