// Private browser controller for the original SF101 merchant order store.
// The launch capability exists only in this tab's memory, never in storage.
const fragment = new URLSearchParams(location.hash.slice(1));
const launchToken = fragment.get('token') ?? '';
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

const $ = (id) => document.getElementById(id);
const state = {
  token: /^[a-f0-9]{64}$/i.test(launchToken) ? launchToken : '',
  session: null,
  orders: [],
  listResult: null,
  loadedPage: null,
  listError: false,
  listEpoch: 0,
  listLoading: false,
  after: '',
  before: [],
  nextAfter: null,
  status: 'all',
  limit: 25,
  ref: null,
  detail: null,
  detailEpoch: 0,
  detailLoading: false,
  action: null,
  pendingActions: new Map(),
  files: [],
  filesAfter: null,
  filesEpoch: 0,
  filesLoading: false,
  filesSkipped: 0,
  enrollRef: null,
  enrollMode: 'edit',
};

class DeskError extends Error {
  constructor(code, message, status = 0) {
    super(message || code);
    this.name = 'DeskError';
    this.code = code;
    this.status = status;
  }
}

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

function friendly(error) {
  if (error?.code === 'ACCESS_REVISION_CONFLICT' || error?.code === 'TOKEN_REVISION_CONFLICT') {
    return 'This order changed after you opened it. Review the refreshed order before applying a new change.';
  }
  if (error?.code === 'ORDER_NOT_FOUND') return 'No order exists with that reference in this merchant workspace.';
  if (error?.code === 'ORDER_NOT_ENTITLED') return 'This order is awaiting its entitlement. Refresh it after the successful settlement notification arrives.';
  if (error?.code === 'CHECKOUT_ORDER_REFERENCE_INVALID') return 'Checkout references cannot start with a hyphen or be only one or two periods. Use another reference for a new enrollment.';
  if (error?.code === 'TOKEN_UNCHANGED') return 'That server variable contains the current claim credential. Select a variable with the intended replacement.';
  if (error?.code === 'EXPIRY_MUST_BE_IN_FUTURE_USE_SUSPEND_FOR_IMMEDIATE_STOP') return 'Choose a future access deadline. Use Suspend access when the order should stop accepting requests immediately.';
  if (error?.code === 'ACCESS_ALREADY_SUSPENDED') return 'Access is already suspended. The latest order state has been refreshed.';
  if (error?.code === 'ACCESS_ALREADY_ENABLED') return 'Access is already enabled. The current deadline still applies.';
  if (error?.code === 'EXPIRY_UNCHANGED') return 'That deadline is already recorded for this order.';
  if (error?.code === 'NO_EXPIRY_CONFIGURED') return 'This order already has no access deadline.';
  if (error?.code === 'OPERATION_ID_REUSED_WITH_DIFFERENT_REQUEST') return 'The operation identifier belongs to a different recorded request. Close this change and review the order before preparing a new one.';
  return error?.message || 'The request did not complete. Refresh the workspace and inspect the current order.';
}

function showNotice(message, error = false) {
  const box = $('notice');
  box.classList.toggle('error', error);
  box.setAttribute('role', error ? 'alert' : 'status');
  const close = el('button', '', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss message');
  close.addEventListener('click', () => { box.hidden = true; });
  box.replaceChildren(el('span', '', message), close);
  box.hidden = false;
}

function formMessage(id, message, error = false) {
  const box = $(id);
  box.classList.toggle('error', error);
  box.setAttribute('role', error ? 'alert' : 'status');
  box.textContent = message;
  box.hidden = !message;
  return box;
}

function requestPath(path) {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || url.username || url.password || url.hash) {
    throw new DeskError('INVALID_DESK_PATH', 'The desk received an invalid local API path.');
  }
  return url.pathname + url.search;
}

async function responseFor(path, body) {
  if (!state.token) throw new DeskError('LAUNCH_LINK_REQUIRED', 'Open the desk from its original private launch link.');
  let response;
  try {
    response = await fetch(requestPath(path), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization: `Bearer ${state.token}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      cache: 'no-store', credentials: 'omit', redirect: 'error', mode: 'same-origin',
      signal: AbortSignal.timeout(path.startsWith('/api/recovery') ? 310000 : 90000),
    });
  } catch (error) {
    if (error instanceof DeskError) throw error;
    throw new DeskError('CONNECTION_UNAVAILABLE', 'Could not reach the merchant desk. Check that its original launcher is still running.');
  }
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { /* Keep the status-specific error below. */ }
    const code = typeof payload.error === 'string' ? payload.error : `HTTP_${response.status}`;
    const message = typeof payload.message === 'string' ? payload.message : code.replaceAll('_', ' ');
    if (response.status === 401 || response.status === 403) {
      state.token = '';
      state.session = null;
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      showConnection('This launch connection was refused. Reopen the private link from the current merchant desk launcher.', false);
      refreshControls();
    }
    throw new DeskError(code, message, response.status);
  }
  return response;
}

async function api(path, body) {
  const response = await responseFor(path, body);
  try { return await response.json(); }
  catch { throw new DeskError('UNREADABLE_RESPONSE', 'The desk returned an unreadable response. Refresh the order before repeating a change.', response.status); }
}

function bytes(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return '—';
  if (count < 1024) return `${count.toLocaleString()} B`;
  if (count < 1024 ** 2) return `${(count / 1024).toLocaleString(undefined, {maximumFractionDigits: 1})} KiB`;
  return `${(count / 1024 ** 2).toLocaleString(undefined, {maximumFractionDigits: 2})} MiB`;
}

function dateObject(value) {
  if (value === undefined || value === null || value === '') return null;
  let input = value;
  if (typeof input === 'number' || (typeof input === 'string' && /^\d+(\.\d+)?$/.test(input))) {
    const count = Number(input);
    input = count < 1e12 ? count * 1000 : count;
  }
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date : null;
}

function when(value, {utc = false, empty = '—'} = {}) {
  const date = dateObject(value);
  if (!date) return empty;
  return utc ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : date.toLocaleString();
}

function title(value, empty = 'Unknown') {
  if (value === undefined || value === null || value === '') return empty;
  return String(value).toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (s) => s.toUpperCase());
}

function statusBadge(value) {
  const normalized = String(value || 'unknown').toLowerCase();
  const kind = /suspend|expir|unavailable/.test(normalized) ? 'blocked' : /entitled|available|match/.test(normalized) ? 'strong' : 'pending';
  return el('span', `badge ${kind}`, title(value));
}

function facts(id, rows) {
  const target = $(id);
  target.replaceChildren();
  for (const [label, value, code = false] of rows) {
    target.append(el('dt', '', label), el('dd', code ? 'code' : '', value === undefined || value === null || value === '' ? '—' : value));
  }
}

function canUse() { return Boolean(state.session?.initialized && state.token); }
function availableClaims() { return (state.session?.claimEnvs || []).filter((item) => item.available === true); }
function busy(button) { return button?.dataset.busy === 'true'; }

function setDisabled(id, disabled) {
  const node = $(id);
  node.disabled = Boolean(disabled || busy(node));
}

function refreshControls() {
  refreshRecoveryControls();
  document.querySelectorAll('[data-needs-init]').forEach((node) => {
    node.disabled = !canUse() || busy(node);
  });
  setDisabled('refresh-orders', !canUse() || state.listLoading);
  setDisabled('previous-page', !canUse() || state.listLoading || state.before.length === 0);
  setDisabled('next-page', !canUse() || state.listLoading || !state.nextAfter);
  setDisabled('order-status', !canUse() || state.listLoading);
  setDisabled('page-size', !canUse() || state.listLoading);
  setDisabled('initialize', !state.session || state.session.initialized);
  const loaded = Boolean(state.detail?.order && !state.detailLoading && state.detail.order.orderRef === state.ref);
  const revision = state.detail?.order?.access?.revision;
  const canChange = loaded && Number.isSafeInteger(revision) && revision >= 0;
  for (const id of ['refresh-detail', 'handoff-export', 'file-inspect']) setDisabled(id, !loaded);
  setDisabled('receipt-export', !loaded || state.detail.order.nativeState !== 'ENTITLED');
  $('receipt-export').title = loaded && state.detail.order.nativeState !== 'ENTITLED'
    ? 'A receipt becomes available after the settlement notification entitles this order.' : '';
  for (const id of ['suspend-access', 'resume-access', 'set-expiry', 'clear-expiry', 'rotate-token']) setDisabled(id, !canChange || Boolean(state.action?.sending));
  if (canChange) {
    setDisabled('suspend-access', state.detail.order.access.enabled === false || Boolean(state.action?.sending));
    setDisabled('resume-access', state.detail.order.access.enabled !== false || Boolean(state.action?.sending));
    setDisabled('clear-expiry', !state.detail.order.access.expiresAt || Boolean(state.action?.sending));
    setDisabled('rotate-token', availableClaims().length === 0 || Boolean(state.action?.sending));
  }
  $('access-unavailable').hidden = canChange;
  const enrollLocked = state.enrollMode !== 'edit' || busy($('enroll-submit'));
  for (const id of ['enroll-ref', 'enroll-file', 'enroll-claim']) $(id).disabled = enrollLocked;
  setDisabled('enroll-submit', !canUse() || state.enrollMode !== 'edit' || state.filesLoading || state.files.length === 0 || availableClaims().length === 0);
  setDisabled('reload-files', state.filesLoading || enrollLocked);
  setDisabled('load-more-files', state.filesLoading || enrollLocked || !state.filesAfter);
  if (state.action) {
    const locked = state.action.sending || state.action.ambiguous || state.action.conflict;
    for (const id of ['access-reason', 'access-expiry', 'access-claim']) $(id).disabled = Boolean(locked);
    setDisabled('access-submit', state.action.sending || state.action.conflict || (state.action.action === 'rotate-token' && availableClaims().length === 0));
  }
}

async function buttonTask(button, label, task, onError = (error) => showNotice(friendly(error), true)) {
  if (busy(button)) return;
  const original = button.textContent;
  button.dataset.busy = 'true';
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  refreshControls();
  button.disabled = true;
  try { return await task(); }
  catch (error) { onError(error); }
  finally {
    delete button.dataset.busy;
    button.removeAttribute('aria-busy');
    button.textContent = original;
    button.disabled = false;
    refreshControls();
  }
}

function showConnection(message, retry = true) {
  $('connect-panel').hidden = false;
  $('desk').hidden = true;
  $('connect-message').textContent = message;
  $('connection-state').textContent = 'Disconnected';
  $('connection-state').className = 'badge blocked';
  $('reconnect').hidden = !retry || !state.token;
}

function renderSession() {
  const {checkout = {}, roots = {}, actor, initialized} = state.session;
  const payment = checkout.payment || {};
  $('connect-panel').hidden = true;
  $('desk').hidden = false;
  $('connection-state').textContent = 'Connected';
  $('connection-state').className = 'badge';
  $('actor-label').textContent = typeof actor === 'string' ? actor : actor?.login || actor?.name || '';
  $('checkout-description').textContent = checkout.description || 'Merchant checkout';
  $('checkout-resource').textContent = `${checkout.method || 'GET'} ${checkout.resourceUrl || ''}`;
  $('checkout-network').textContent = payment.network || 'Configured rail';
  $('checkout-amount').textContent = payment.amount ? `${payment.amount} atomic units` : '';
  $('initialize-panel').hidden = Boolean(initialized);
  facts('workspace-facts', [
    ['Operator', typeof actor === 'string' ? actor : actor?.login || actor?.name],
    ['Order store', initialized ? 'Initialized' : 'Not initialized'],
    ['Route', checkout.routeId, true],
    ['Purchase resource', `${checkout.method || 'GET'} ${checkout.resourceUrl || ''}`, true],
    ['Network', payment.network, true],
    ['Price', payment.amount ? `${payment.amount} atomic units` : null, true],
    ['Asset', payment.asset, true],
    ['Recipient', payment.payTo, true],
    ['Approved files', roots.filesRoot, true],
    ['Private exports', roots.outputRoot, true],
  ]);
  $('workspace-claims').replaceChildren();
  for (const item of state.session.claimEnvs || []) {
    const row = el('li');
    row.append(el('code', '', item.name), el('span', 'badge', item.available ? 'Available' : 'Unavailable'));
    $('workspace-claims').append(row);
  }
  if (!(state.session.claimEnvs || []).length) $('workspace-claims').append(el('li', 'muted', 'No claim variables configured for this desk.'));
  facts('enroll-terms', [
    ['Checkout', checkout.description || checkout.routeId],
    ['Network', payment.network, true],
    ['Price', payment.amount ? `${payment.amount} atomic units` : null, true],
    ['Asset', payment.asset, true],
    ['Recipient', payment.payTo, true],
  ]);
  claimOptions('enroll-claim');
  claimOptions('access-claim');
  refreshControls();
}

function claimOptions(id) {
  const select = $(id);
  const previous = select.value;
  select.replaceChildren();
  const claims = state.session?.claimEnvs || [];
  if (!claims.length || availableClaims().length === 0) {
    const empty = el('option', '', 'No available claim variable');
    empty.value = '';
    select.append(empty);
  }
  for (const item of claims) {
    const option = el('option', '', `${item.name}${item.available ? '' : ' — unavailable'}`);
    option.value = item.name;
    option.disabled = !item.available;
    select.append(option);
  }
  if (claims.some((item) => item.name === previous && item.available)) select.value = previous;
  else if (availableClaims()[0]) select.value = availableClaims()[0].name;
}

async function start() {
  if (!state.token) {
    showConnection('Use the private link printed by your merchant desk launcher. Reopen that original link after reloading or closing this tab.', false);
    return;
  }
  try {
    state.session = await api('/api/session');
    renderSession();
    if (state.session.initialized) await loadOrders();
    else renderOrders();
  } catch (error) {
    showConnection(friendly(error), ![401, 403].includes(error.status));
  }
}

function renderOrders() {
  const tbody = $('order-rows');
  tbody.replaceChildren();
  for (const order of state.orders) {
    const row = el('tr', order.orderRef === state.ref ? 'selected' : '');
    const reference = el('td');
    const open = el('button', 'order-link', order.orderRef);
    open.type = 'button';
    open.setAttribute('aria-label', `Open order ${order.orderRef}`);
    open.setAttribute('aria-pressed', String(order.orderRef === state.ref));
    open.addEventListener('click', () => { void selectOrder(order.orderRef, true); });
    reference.append(open, el('span', 'order-sub', when(order.createdAt)));
    const native = el('td');
    native.append(statusBadge(order.nativeState));
    const access = el('td');
    access.append(statusBadge(order.access?.state));
    if (order.access?.expiresAt) access.append(el('span', 'order-sub', `Until ${when(order.access.expiresAt)}`));
    row.append(reference, native, access, el('td', 'numeric', bytes(order.fileBytes)));
    row.addEventListener('click', (event) => {
      if (!event.target.closest('button')) void selectOrder(order.orderRef, true);
    });
    tbody.append(row);
  }
  $('order-count').textContent = state.orders.length ? `(${state.orders.length} shown)` : '';
  $('orders-empty').hidden = state.orders.length > 0 || state.listLoading;
  $('orders-empty-title').textContent = !canUse() ? 'Your order inventory will appear here' : state.status === 'all' ? 'No orders yet' : 'No matching orders';
  $('orders-empty-copy').textContent = !canUse() ? 'Initialize this workspace to enroll approved files.' : state.status === 'all' ? 'Enroll an approved file to create an order and customer handoff.' : 'Choose another access filter or open an exact order reference.';
  const counts = state.listResult?.nativeCounts;
  const countsText = counts && typeof counts === 'object' ? Object.entries(counts).filter(([, count]) => Number.isFinite(Number(count))).map(([name, count]) => `${Number(count).toLocaleString()} ${String(name).toLowerCase()}`).join(' · ') : '';
  $('inventory-summary').textContent = countsText ? `All orders: ${countsText}` : state.listResult ? `Showing ${state.orders.length} ${state.orders.length === 1 ? 'order' : 'orders'} in this view` : '';
  $('page-label').textContent = `Page ${state.before.length + 1}`;
  if (state.listError) $('last-sync').textContent = 'Inventory could not refresh; displayed rows may be older';
  else if (state.listResult?.capturedAt) $('last-sync').textContent = `Inventory updated ${when(state.listResult.capturedAt)}`;
  refreshControls();
}

async function loadOrders({notifyError = true} = {}) {
  if (!canUse()) return;
  const epoch = ++state.listEpoch;
  state.listLoading = true;
  $('orders-loading').hidden = false;
  $('orders-empty').hidden = true;
  $('order-table-wrap').setAttribute('aria-busy', 'true');
  refreshControls();
  const query = new URLSearchParams({status: state.status, limit: String(state.limit)});
  if (state.after) query.set('after', state.after);
  try {
    const result = await api(`/api/orders?${query}`);
    if (epoch !== state.listEpoch) return;
    if (!Array.isArray(result.orders)) throw new DeskError('UNREADABLE_INVENTORY', 'The inventory response did not contain an order list.');
    state.orders = result.orders;
    state.listResult = result;
    state.nextAfter = result.nextAfter || null;
    state.loadedPage = {status: state.status, limit: state.limit, after: state.after, before: [...state.before], nextAfter: state.nextAfter};
    state.listError = false;
    renderOrders();
  } catch (error) {
    if (epoch === state.listEpoch && notifyError) showNotice(`Inventory refresh failed. ${friendly(error)}`, true);
    if (epoch === state.listEpoch) {
      state.listError = true;
      if (state.loadedPage) {
        Object.assign(state, {...state.loadedPage, before: [...state.loadedPage.before]});
        $('order-status').value = state.status;
        $('page-size').value = String(state.limit);
      }
    }
  } finally {
    if (epoch === state.listEpoch) {
      state.listLoading = false;
      $('orders-loading').hidden = true;
      $('order-table-wrap').removeAttribute('aria-busy');
      renderOrders();
    }
  }
}

function policyExplanation(order) {
  if (order.access?.enabled === false) return 'Access is suspended. Future checkout and download requests are blocked until access is resumed.';
  const deadline = dateObject(order.access?.expiresAt);
  if (deadline && deadline.getTime() <= Date.now()) return 'The access deadline has passed. Set a later deadline or remove it to permit future requests under the existing entitlement.';
  if (order.nativeState === 'ENTITLED') return 'The successful settlement notification has entitled this order. Downloads require its current claim credential and an unchanged enrolled file.';
  return 'Awaiting the successful settlement notification. Enrollment alone does not grant file access.';
}

function renderDetail() {
  const order = state.detail?.order;
  if (!order || order.orderRef !== state.ref) {
    $('detail-content').hidden = true;
    $('detail-empty').hidden = false;
    refreshControls();
    return;
  }
  $('detail-content').hidden = false;
  $('detail-empty').hidden = true;
  $('detail-ref').textContent = order.orderRef;
  const nativeBadge = statusBadge(order.nativeState);
  const accessBadge = statusBadge(order.access?.state);
  $('native-status').className = nativeBadge.className;
  $('native-status').textContent = `Order: ${nativeBadge.textContent}`;
  $('access-status').className = accessBadge.className;
  $('access-status').textContent = `Access: ${accessBadge.textContent}`;
  $('detail-revision').textContent = Number.isSafeInteger(order.access?.revision) ? `Revision ${order.access.revision}` : 'Policy unavailable';
  $('access-explanation').textContent = policyExplanation(order);
  facts('order-facts', [
    ['Route', `${order.method || 'GET'} · ${order.routeId || ''}`, true],
    ['Network', order.network, true],
    ['Price', order.amountAtomic ? `${order.amountAtomic} atomic units` : null, true],
    ['Created', when(order.createdAt)],
    ['Entitled', when(order.entitledAt, {empty: 'Awaiting settlement notification'})],
    ['Access deadline', when(order.access?.expiresAt, {utc: true, empty: 'No deadline'})],
    ['Event', order.eventId, true],
    ['Asset digest', order.assetDigest, true],
    ['Recipient binding', order.recipientDigest || 'Legacy order — recipient binding not recorded', true],
  ]);
  facts('file-facts', [
    ['Promised bytes', Number.isFinite(Number(order.fileBytes)) ? `${Number(order.fileBytes).toLocaleString()} (${bytes(order.fileBytes)})` : null],
    ['SHA-256', order.fileSha256, true],
  ]);
  const actions = Array.isArray(state.detail.latestActions) ? state.detail.latestActions : [];
  $('access-history').replaceChildren();
  for (const item of actions) {
    const row = el('li');
    const heading = el('div', 'history-title');
    heading.append(el('strong', '', title(item.action)), el('span', 'muted', `Revision ${item.revision}`));
    row.append(heading, el('p', '', item.reason || 'No reason recorded'), el('small', '', `${item.actor || 'Operator'} · ${when(item.occurred_at)}`), el('small', 'mono', item.operation_id));
    $('access-history').append(row);
  }
  $('history-empty').hidden = actions.length > 0;
  $('history-count').textContent = actions.length ? `${actions.length} latest` : '';
  $('detail-captured').textContent = `Order snapshot ${when(state.detail.capturedAt)} · Times are local unless marked UTC`;
  refreshControls();
}

async function selectOrder(ref, focus = false) {
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(ref)) {
    showNotice('Enter a valid order reference of up to 80 letters, numbers, periods, underscores, colons or hyphens.', true);
    return;
  }
  const changed = ref !== state.ref;
  const epoch = ++state.detailEpoch;
  state.ref = ref;
  state.detailLoading = true;
  if (changed) {
    state.detail = null;
    $('file-health').replaceChildren(el('p', 'muted', 'Inspect the current server file to compare it with the enrolled promise.'));
    $('order-export-result').hidden = true;
  }
  renderDetail();
  renderOrders();
  $('detail-loading').hidden = false;
  $('detail-panel').setAttribute('aria-busy', 'true');
  try {
    const result = await api(`/api/orders/${encodeURIComponent(ref)}`);
    if (epoch !== state.detailEpoch) return;
    if (!result.order || result.order.orderRef !== ref) throw new DeskError('UNREADABLE_ORDER', 'The order response did not match the selected reference.');
    state.detail = result;
    renderDetail();
    if (focus) {
      if (matchMedia('(max-width: 790px)').matches) $('detail-panel').scrollIntoView({block: 'start'});
      $('detail-ref').focus({preventScroll: true});
    }
  } catch (error) {
    if (epoch === state.detailEpoch) showNotice(friendly(error), true);
  } finally {
    if (epoch === state.detailEpoch) {
      state.detailLoading = false;
      $('detail-loading').hidden = true;
      $('detail-panel').removeAttribute('aria-busy');
      renderDetail();
    }
  }
}

async function refreshInventoryAndOrder(ref = state.ref) {
  await Promise.all([loadOrders(), ref ? selectOrder(ref) : Promise.resolve()]);
}

function validExport(result) {
  if (!result || typeof result.name !== 'string' || typeof result.download !== 'string') throw new DeskError('EXPORT_RESPONSE_INVALID', 'The export was created but its download descriptor could not be read.');
  const url = new URL(result.download, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/exports/') || url.search || url.hash || url.username || url.password) {
    throw new DeskError('EXPORT_PATH_INVALID', 'The desk returned an invalid local export location.');
  }
  return result;
}

async function downloadExport(result) {
  validExport(result);
  const response = await responseFor(result.download);
  const blob = await response.blob();
  if (Number.isSafeInteger(result.bytes) && blob.size !== result.bytes) throw new DeskError('EXPORT_SIZE_MISMATCH', 'The export download did not match its recorded size. Download it again from the existing export.');
  if (typeof result.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(result.sha256) && crypto.subtle) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== result.sha256.toLowerCase()) throw new DeskError('EXPORT_DIGEST_MISMATCH', 'The export download did not match its recorded hash. Download it again from the existing export.');
  }
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = result.name.replaceAll(/[\\/]/g, '_');
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function renderExport(id, descriptor, heading = 'Export ready') {
  validExport(descriptor);
  const box = $(id);
  box.replaceChildren(el('strong', '', `${heading} · ${descriptor.name}`), el('p', '', `${bytes(descriptor.bytes)} · Private JSON download`));
  if (descriptor.sha256) box.append(el('p', 'mono', `SHA-256 ${descriptor.sha256}`));
  const button = el('button', '', 'Download again');
  button.type = 'button';
  button.addEventListener('click', () => { void buttonTask(button, 'Downloading…', () => downloadExport(descriptor)); });
  box.append(button);
  box.hidden = false;
}

async function makeOrderExport(kind, button) {
  const ref = state.ref;
  if (!ref || !state.detail?.order) return;
  await buttonTask(button, 'Preparing…', async () => {
    const result = await api(`/api/${kind}`, {ref});
    if (ref === state.ref) renderExport('order-export-result', result, kind === 'handoff' ? 'Customer handoff ready' : 'Entitlement receipt ready');
    try {
      await downloadExport(result);
      showNotice(`${kind === 'handoff' ? 'Handoff' : 'Receipt'} for ${ref} is ready. Its download has been requested.`);
    } catch (error) {
      showNotice(`The ${kind} was created. ${friendly(error)}`, true);
    }
  });
}

async function inspectFile() {
  const ref = state.ref;
  if (!ref) return;
  await buttonTask($('file-inspect'), 'Inspecting…', async () => {
    const result = await api('/api/file-health', {ref});
    if (ref !== state.ref) return;
    const box = $('file-health');
    const labels = {MATCH: 'File matches the enrolled promise', SOURCE_CHANGED: 'File differs from the enrolled promise', SOURCE_UNAVAILABLE: 'The original file is unavailable'};
    box.replaceChildren(el('h4', '', labels[result.status] || title(result.status)));
    if (result.status === 'MATCH') box.append(el('p', '', 'The original size and SHA-256 match the current private file.'));
    if (result.status === 'SOURCE_CHANGED') box.append(el('p', '', 'Restore the enrolled bytes before the customer retries. This inspection does not replace the file or change the order promise.'));
    if (result.status === 'SOURCE_UNAVAILABLE') box.append(el('p', '', 'Restore the original private file and its access permissions, then inspect it again.'));
    box.append(el('p', 'mono', `Expected ${bytes(result.expectedBytes)} · ${result.expectedSha256 || 'No hash returned'}`));
    if (result.actualBytes !== undefined || result.actualSha256) box.append(el('p', 'mono', `Actual ${bytes(result.actualBytes)} · ${result.actualSha256 || 'No hash returned'}`));
    box.append(el('p', 'muted', `Inspected ${new Date().toLocaleString()}`));
  });
}

function renderFiles() {
  const select = $('enroll-file');
  const previous = select.value;
  select.replaceChildren();
  const placeholder = el('option', '', state.files.length ? 'Select an approved file' : state.filesLoading ? 'Loading files…' : 'No eligible files found');
  placeholder.value = '';
  select.append(placeholder);
  for (const item of state.files) {
    const option = el('option', '', `${item.name} · ${bytes(item.bytes)}`);
    option.value = item.name;
    select.append(option);
  }
  if (state.files.some((item) => item.name === previous)) select.value = previous;
  $('load-more-files').hidden = !state.filesAfter;
  $('file-picker-status').textContent = state.files.length ? `${state.files.length} eligible ${state.files.length === 1 ? 'file' : 'files'} loaded${state.filesAfter ? ' · More available' : ''}` : state.filesLoading ? 'Reading the approved files directory…' : `Add a private regular file under ${state.session?.roots?.filesRoot || 'the configured files directory'}, then refresh.`;
  if (state.filesSkipped > 0) $('file-picker-status').textContent += ` · ${state.filesSkipped} ineligible entries skipped`;
  refreshControls();
}

async function loadFiles(append = false) {
  const epoch = ++state.filesEpoch;
  state.filesLoading = true;
  if (!append) { state.files = []; state.filesAfter = null; state.filesSkipped = 0; }
  renderFiles();
  const query = new URLSearchParams({limit: '100'});
  if (append && state.filesAfter) query.set('after', state.filesAfter);
  try {
    const result = await api(`/api/files?${query}`);
    if (epoch !== state.filesEpoch) return;
    if (!Array.isArray(result.files)) throw new DeskError('UNREADABLE_FILE_LIST', 'The approved file listing could not be read.');
    const byName = new Map(state.files.map((item) => [item.name, item]));
    for (const item of result.files) byName.set(item.name, item);
    state.files = [...byName.values()];
    state.filesAfter = result.nextAfter || null;
    state.filesSkipped = Number(result.skipped) || 0;
    renderFiles();
  } catch (error) {
    if (epoch === state.filesEpoch) formMessage('enroll-feedback', friendly(error), true);
  } finally {
    if (epoch === state.filesEpoch) { state.filesLoading = false; renderFiles(); }
  }
}

async function openEnrollment() {
  if (!canUse()) return;
  $('enroll-form').reset();
  state.enrollMode = 'edit';
  state.enrollRef = null;
  $('enroll-submit').textContent = 'Enroll & export handoff';
  formMessage('enroll-feedback', '');
  $('enroll-export-result').hidden = true;
  claimOptions('enroll-claim');
  $('enroll-dialog').showModal();
  refreshControls();
  await loadFiles();
}

function recoveryButton(ref) {
  const button = el('button', '', 'Recover existing handoff');
  button.type = 'button';
  button.addEventListener('click', () => {
    void buttonTask(button, 'Recovering…', async () => {
      const result = await api('/api/handoff', {ref});
      state.enrollMode = 'done';
      formMessage('enroll-feedback', `The existing order ${ref} was recovered. Its claim credential and file enrollment were preserved.`);
      renderExport('enroll-export-result', result, 'Customer handoff recovered');
      await refreshInventoryAndOrder(ref);
      await downloadExport(result);
    }, (error) => {
      const box = formMessage('enroll-feedback', `Recovery for ${ref}: ${friendly(error)} You can inspect the order by its exact reference or retry handoff recovery.`, true);
      const row = el('div', 'button-row');
      row.append(recoveryButton(ref));
      box.append(row);
    });
  });
  return button;
}

async function enroll(event) {
  event.preventDefault();
  if (state.enrollMode !== 'edit' || !$('enroll-form').reportValidity()) return;
  const ref = $('enroll-ref').value.trim();
  if (ref.startsWith('-') || ref === '.' || ref === '..') {
    formMessage('enroll-feedback', 'Use an order reference that does not start with a hyphen and is not only one or two periods.', true);
    return;
  }
  const file = $('enroll-file').value;
  const claimEnv = $('enroll-claim').value;
  if (!state.files.some((item) => item.name === file) || !availableClaims().some((item) => item.name === claimEnv)) {
    formMessage('enroll-feedback', 'Select an available approved file and claim variable.', true);
    return;
  }
  state.enrollRef = ref;
  await buttonTask($('enroll-submit'), 'Enrolling…', async () => {
    formMessage('enroll-feedback', 'Enrolling the approved file and preparing the customer handoff…');
    const result = await api('/api/enroll', {ref, file, claimEnv});
    state.enrollMode = 'done';
    formMessage('enroll-feedback', `Order ${ref} is enrolled. Its handoff is ready for the customer.`);
    renderExport('enroll-export-result', result, 'Customer handoff ready');
    await refreshInventoryAndOrder(ref);
    try { await downloadExport(result); }
    catch (error) { formMessage('enroll-feedback', `The order is enrolled and its handoff is retained. ${friendly(error)}`, true); }
  }, (error) => {
    const rejected = [400, 422].includes(error.status);
    state.enrollMode = rejected ? 'edit' : 'recover';
    const box = formMessage('enroll-feedback', rejected ? friendly(error) : `Enrollment outcome for ${ref} needs checking. Recover the same order's handoff before starting another enrollment. ${friendly(error)}`, true);
    if (!rejected) {
      const row = el('div', 'button-row');
      row.append(recoveryButton(ref));
      box.append(row);
    }
  });
}

const actionInfo = {
  suspend: ['Suspend access', 'Block future checkout and download requests for this order. Previously downloaded customer copies are unaffected.'],
  resume: ['Resume access', 'Enable future requests under this order’s existing entitlement and deadline. An elapsed deadline still applies.'],
  expire: ['Set access deadline', 'Choose the exact deadline for future checkout and download access. This preserves the enrolled file and entitlement.'],
  'clear-expiry': ['Remove access deadline', 'Remove this order’s deadline. Its current enabled or suspended setting is preserved.'],
  'rotate-token': ['Rotate claim credential', 'Replace the claim credential for future downloads using a configured private server variable. The previous credential will stop working.'],
};

function operationId() {
  if (typeof crypto.randomUUID === 'function') return `desk-${crypto.randomUUID()}`;
  return `desk-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function localDateInput(value) {
  const date = dateObject(value) || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

function openAccess(action) {
  const order = state.detail?.order;
  if (!order || !Number.isSafeInteger(order.access?.revision) || !actionInfo[action]) return;
  const pending = state.pendingActions.get(order.orderRef);
  if (pending) action = pending.action;
  state.action = pending || {ref: order.orderRef, action, expectedRevision: order.access.revision, operationId: operationId(), sending: false, ambiguous: false, conflict: false, body: null};
  $('access-form').reset();
  $('access-dialog-title').textContent = actionInfo[action][0];
  $('access-dialog-copy').textContent = actionInfo[action][1];
  $('access-submit').textContent = pending ? 'Retry exact operation' : actionInfo[action][0];
  $('expiry-field').hidden = action !== 'expire';
  $('access-expiry').required = action === 'expire';
  $('access-expiry').value = localDateInput(order.access.expiresAt);
  $('rotate-field').hidden = action !== 'rotate-token';
  $('access-claim').required = action === 'rotate-token';
  claimOptions('access-claim');
  if (pending?.body) {
    $('access-reason').value = pending.body.reason;
    if (pending.body.expiresAt) $('access-expiry').value = localDateInput(pending.body.expiresAt);
    if (pending.body.claimEnv) $('access-claim').value = pending.body.claimEnv;
  }
  facts('access-dialog-facts', [
    ['Order', order.orderRef, true],
    ['Current access', title(order.access.state)],
    ['Deadline', when(order.access.expiresAt, {utc: true, empty: 'No deadline'})],
    ['Reviewed revision', String(state.action.expectedRevision)],
  ]);
  formMessage('access-feedback', pending ? `A previous change for this order has an unconfirmed outcome. This retries the same reviewed request and identifier, not a new change.\nOperation: ${pending.operationId}` : '', Boolean(pending));
  $('access-dialog').showModal();
  refreshControls();
}

async function changeAccess(event) {
  event.preventDefault();
  const decision = state.action;
  if (!decision || decision.sending || decision.conflict || !$('access-form').reportValidity()) return;
  if (!decision.body) {
    const reason = $('access-reason').value.trim();
    if (!reason) { formMessage('access-feedback', 'Enter a reason for this change.', true); return; }
    decision.body = {ref: decision.ref, action: decision.action, expectedRevision: decision.expectedRevision, operationId: decision.operationId, reason};
    if (decision.action === 'expire') {
      const deadline = dateObject($('access-expiry').value);
      if (!deadline) { decision.body = null; formMessage('access-feedback', 'Enter a valid access deadline.', true); return; }
      if (deadline.getTime() <= Date.now()) { decision.body = null; formMessage('access-feedback', 'Choose a future deadline, or use Suspend access for an immediate stop.', true); return; }
      decision.body.expiresAt = deadline.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    if (decision.action === 'rotate-token') {
      const claimEnv = $('access-claim').value;
      if (!availableClaims().some((item) => item.name === claimEnv)) { decision.body = null; formMessage('access-feedback', 'Select an available claim variable.', true); return; }
      decision.body.claimEnv = claimEnv;
    }
  }
  decision.sending = true;
  $('access-submit').textContent = 'Applying…';
  formMessage('access-feedback', 'Applying the reviewed change to the order…');
  refreshControls();
  try {
    const result = await api('/api/access', decision.body);
    if (result.operationId !== decision.operationId || !result.order || result.order.orderRef !== decision.ref) {
      throw new DeskError('UNREADABLE_OPERATION_RESULT', 'The saved change could not be matched to this request.');
    }
    decision.ambiguous = false;
    state.pendingActions.delete(decision.ref);
    $('access-dialog').close();
    state.action = null;
    showNotice(`${actionInfo[decision.action][0]} recorded for ${decision.ref}${result.replayed ? ' (existing operation recovered)' : ''}.`);
    await refreshInventoryAndOrder(decision.ref);
  } catch (error) {
    if (error.status === 409) {
      decision.conflict = true;
      state.pendingActions.delete(decision.ref);
      formMessage('access-feedback', `${friendly(error)} Close this dialog to review the latest state. No new operation was submitted.`, true);
      await refreshInventoryAndOrder(decision.ref);
    } else if (error.status >= 400 && error.status < 500) {
      // Validation errors are confirmed rejections; edits retain this unsaved ID.
      decision.body = null;
      decision.ambiguous = false;
      state.pendingActions.delete(decision.ref);
      formMessage('access-feedback', friendly(error), true);
    } else {
      // Do not manufacture a new mutation after a lost response. The explicit
      // retry reuses both the original body and its native idempotency key.
      decision.ambiguous = true;
      state.pendingActions.set(decision.ref, decision);
      formMessage('access-feedback', `The outcome is not yet confirmed. You can retry this exact reviewed operation with the same identifier. ${friendly(error)}\nOperation: ${decision.operationId}`, true);
    }
  } finally {
    decision.sending = false;
    if (state.action === decision) $('access-submit').textContent = decision.ambiguous ? 'Retry exact operation' : actionInfo[decision.action][0];
    refreshControls();
  }
}


const recovery = {selected:null, nextAfter:null, loading:false};
function recoveryName() { return 'desk-' + new Date().toISOString().replace(/[-:.]/g, '') + '-' + operationId().slice(-8); }
function recoveryBusy() { return busy($('recovery-create')) || busy($('recovery-restore')); }
function refreshRecoveryControls() {
  const ready = Boolean(state.session && state.token);
  const working = recoveryBusy();
  setDisabled('recovery-open', !ready);
  setDisabled('recovery-create', !canUse() || working);
  setDisabled('recovery-new-name', !ready || working);
  setDisabled('recovery-name', !ready || working);
  setDisabled('recovery-restore-name', !ready || working);
  setDisabled('recovery-restore', !ready || !recovery.selected || working);
  setDisabled('recovery-refresh', !ready || recovery.loading || working);
  setDisabled('recovery-more', !ready || recovery.loading || working || !recovery.nextAfter);
}
function recoveryMessage(message, error=false) { formMessage('recovery-feedback', message, error); }
function recoveryFailure(error) {
  const messages = {
    MERCHANT_SNAPSHOT_INCOMPLETE:'This name contains an unfinished image. A completed snapshot has snapshot.json; inspect the private directory before choosing a new name.',
    RECOVERY_MERCHANT_MISMATCH:'This snapshot belongs to another merchant state path. Open it through that merchant’s configuration or the installed recovery command.',
    RECOVERY_DESTINATION_EXISTS:'This restoration name belongs to another destination. Review the saved directory and choose a different restoration name.',
    MERCHANT_SNAPSHOT_NOT_FOUND:'This saved image is no longer in the private export directory. Refresh the snapshot list.',
  };
  recoveryMessage(messages[error.code] || friendly(error), true);
}
function selectedRecovery(id, result) {
  recovery.selected = id;
  $('recovery-selected').hidden = false;
  if (!$('recovery-restore-name').value) $('recovery-restore-name').value = recoveryName();
  facts('recovery-facts', [
    ['Name',id,true], ['Orders',result.orders], ['Paid files',result.uniquePaidFiles],
    ['Saved',when(result.createdAt,{utc:true})], ['Image',result.snapshot,true],
    ['Manifest SHA-256',result.manifestSha256,true], ['Database SHA-256',result.databaseSha256,true],
  ]);
  refreshRecoveryControls();
}
async function loadRecovery(after) {
  if (recovery.loading) return;
  recovery.loading = true;
  refreshRecoveryControls();
  try {
    const suffix = after ? '?limit=25&after=' + encodeURIComponent(after) : '?limit=25';
    const result = await api('/api/recovery' + suffix);
    recovery.nextAfter = result.nextAfter;
    $('recovery-rows').replaceChildren();
    for (const item of result.snapshots) {
      const row = el('tr'), name = el('td'), open = el('button','text-button',item.id);
      open.type = 'button';
      open.disabled = item.status !== 'SAVED';
      open.addEventListener('click',() => {
        if (recoveryBusy()) return;
        void buttonTask(open,'Verifying…',async () => {
          const inspected = await api('/api/recovery/' + encodeURIComponent(item.id));
          selectedRecovery(item.id,inspected);
          recoveryMessage('Snapshot database and enrolled files verified.');
        },recoveryFailure);
      });
      name.append(open);
      row.append(name,el('td','muted',when(item.createdAt)),el('td','numeric',item.orders ?? '—'),
        el('td','',item.status === 'SAVED' ? 'Saved' : 'Incomplete'));
      $('recovery-rows').append(row);
    }
    $('recovery-empty').hidden = result.snapshots.length !== 0;
    $('recovery-more').hidden = !result.nextAfter;
  } catch(error) { recoveryFailure(error); }
  finally { recovery.loading = false; refreshRecoveryControls(); }
}
async function openRecovery() {
  if (!$('recovery-name').value) $('recovery-name').value = recoveryName();
  $('recovery-dialog').showModal();
  await loadRecovery();
}
async function createRecovery(event) {
  event.preventDefault();
  if (recoveryBusy() || !$('recovery-create-form').reportValidity()) return;
  const id = $('recovery-name').value.trim();
  await buttonTask($('recovery-create'),'Saving…',async () => {
    recoveryMessage('Saving a consistent merchant database and its enrolled files…');
    const result = await api('/api/recovery',{operationId:id});
    selectedRecovery(id,result);
    recoveryMessage('Recovery image saved. Keep this name to reopen the same result.');
    await loadRecovery();
  },(error) => {
    recoveryFailure(error);
    if (!error.status || error.status >= 500) recoveryMessage('Keep snapshot name ' + id + ' and reopen it to recover the same operation. ' + friendly(error),true);
  });
}
async function restoreRecovery(event) {
  event.preventDefault();
  if (recoveryBusy() || !recovery.selected || !$('recovery-restore-form').reportValidity()) return;
  const id = recovery.selected, restoreId = $('recovery-restore-name').value.trim();
  await buttonTask($('recovery-restore'),'Restoring…',async () => {
    recoveryMessage('Restoring the saved database and paid files into a new private state directory…');
    const result = await api('/api/recovery/restore',{operationId:id,restoreId});
    facts('recovery-result',[
      ['Restored merchant state',result.state,true],['Orders',result.orders],
      ['Restored',when(result.restoredAt,{utc:true})],['Snapshot SHA-256',result.snapshotManifestSha256,true],
    ]);
    $('recovery-result').hidden = false;
    recoveryMessage('Restoration ready. Point the existing receiver and checkout at the displayed state directory. To open its merchant desk, use a separate approved product directory and an export directory outside this restored state and its parent export directory. The installed merchant-order-recovery guide covers the host configuration.');
  },(error) => {
    recoveryFailure(error);
    if (!error.status || error.status >= 500) recoveryMessage('Keep restoration name ' + restoreId + ' and reopen the same snapshot result. ' + friendly(error),true);
  });
}

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => {
    const dialog = $(button.dataset.close);
    if (dialog.id === 'recovery-dialog' && recoveryBusy()) return;
    if (dialog.id === 'access-dialog' && state.action?.sending) return;
    if (dialog.id === 'enroll-dialog' && busy($('enroll-submit'))) return;
    dialog.close();
  });
}
$('access-dialog').addEventListener('cancel', (event) => { if (state.action?.sending) event.preventDefault(); });
$('enroll-dialog').addEventListener('cancel', (event) => { if (busy($('enroll-submit'))) event.preventDefault(); });
$('access-dialog').addEventListener('close', () => {
  if (state.action?.ambiguous) showNotice(`The outcome of operation ${state.action.operationId} for ${state.action.ref} remains unconfirmed. Its exact request is retained in this tab; opening an access control for this order will recover that request.`, true);
  state.action = null;
  refreshControls();
});
$('workspace-open').addEventListener('click', () => $('workspace-dialog').showModal());
$('enroll-open').addEventListener('click', () => { void openEnrollment(); });
$('enroll-form').addEventListener('submit', (event) => { void enroll(event); });
$('reload-files').addEventListener('click', () => { void loadFiles(); });
$('load-more-files').addEventListener('click', () => { void loadFiles(true); });
$('access-form').addEventListener('submit', (event) => { void changeAccess(event); });
for (const [id, action] of [['suspend-access', 'suspend'], ['resume-access', 'resume'], ['set-expiry', 'expire'], ['clear-expiry', 'clear-expiry'], ['rotate-token', 'rotate-token']]) {
  $(id).addEventListener('click', () => openAccess(action));
}
$('file-inspect').addEventListener('click', () => { void inspectFile(); });
$('handoff-export').addEventListener('click', () => { void makeOrderExport('handoff', $('handoff-export')); });
$('receipt-export').addEventListener('click', () => { void makeOrderExport('receipt', $('receipt-export')); });
$('refresh-orders').addEventListener('click', () => { void refreshInventoryAndOrder(); });
$('refresh-detail').addEventListener('click', () => { if (state.ref) void selectOrder(state.ref); });
$('order-status').addEventListener('change', () => {
  state.status = $('order-status').value; state.after = ''; state.before = []; state.nextAfter = null;
  void loadOrders();
});
$('page-size').addEventListener('change', () => {
  state.limit = Number($('page-size').value); state.after = ''; state.before = []; state.nextAfter = null;
  void loadOrders();
});
$('next-page').addEventListener('click', () => {
  if (state.listLoading || !state.nextAfter) return;
  state.before.push(state.after); state.after = state.nextAfter; state.nextAfter = null;
  void loadOrders();
});
$('previous-page').addEventListener('click', () => {
  if (state.listLoading || state.before.length === 0) return;
  state.after = state.before.pop(); state.nextAfter = null;
  void loadOrders();
});
$('order-jump').addEventListener('submit', (event) => {
  event.preventDefault();
  if ($('order-jump').reportValidity()) void selectOrder($('jump-ref').value.trim(), true);
});
$('initialize').addEventListener('click', () => {
  void buttonTask($('initialize'), 'Initializing…', async () => {
    await api('/api/initialize', {});
    state.session = await api('/api/session');
    renderSession();
    await loadOrders();
    showNotice('The merchant order store is ready. Enroll an approved file to create a customer handoff.');
  });
});
$('support-export').addEventListener('click', () => {
  void buttonTask($('support-export'), 'Exporting…', async () => {
    const result = await api('/api/support', {});
    await downloadExport(result);
    showNotice(`Private support export ${result.name} is ready. Its download has been requested.`);
  });
});
$('reconnect').addEventListener('click', () => { void buttonTask($('reconnect'), 'Connecting…', start); });

$('recovery-open').addEventListener('click',()=>{ void openRecovery(); });
$('recovery-create-form').addEventListener('submit',(event)=>{ void createRecovery(event); });
$('recovery-restore-form').addEventListener('submit',(event)=>{ void restoreRecovery(event); });
$('recovery-refresh').addEventListener('click',()=>{ void loadRecovery(); });
$('recovery-more').addEventListener('click',()=>{ if (recovery.nextAfter) void loadRecovery(recovery.nextAfter); });
$('recovery-new-name').addEventListener('click',()=>{ $('recovery-name').value = recoveryName(); });
$('recovery-dialog').addEventListener('cancel',(event)=>{ if (recoveryBusy()) event.preventDefault(); });

void start();
