/* Native WordPress merchant console. Payments remain in the original PHP handlers. */
(() => {
  'use strict';
  const config = window.SF104Console;
  const root = document.getElementById('sf104-console');
  if (!config || !root) return;
  const workspace = document.getElementById('sf104-workspace');
  const message = document.getElementById('sf104-message');
  const state = { status: null, route: {}, rows: [], selected: new Map(), order: null, notes: [], nextNotes: null, ticket: 0 };
  const sessionKey = 'sf104.merchant.route:' + location.origin + location.pathname;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
  const mono = value => '<code class="sf104-value">' + esc(text(value)) + '</code>';
  const safeUrl = value => {
    try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; }
    catch { return '#'; }
  };
  const link = (url, label, extra = '') => '<a class="sf104-button" href="' + esc(safeUrl(url)) + '" ' + extra + '>' + esc(label) + '</a>';
  const button = (action, label, extra = '') => '<button type="button" class="sf104-button" data-action="' + action + '" ' + extra + '>' + esc(label) + '</button>';
  const field = (label, value, code = false) => '<div><dt>' + esc(label) + '</dt><dd>' + (code ? mono(value) : esc(text(value))) + '</dd></div>';
  const hidden = (name, value) => '<input type="hidden" name="' + esc(name) + '" value="' + esc(value) + '">';
  const time = value => {
    if (!value) return '—';
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
    const date = new Date(normalized);
    return Number.isNaN(date.valueOf()) ? value : date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  };
  const selected = (a, b) => String(a) === String(b) ? ' selected' : '';
  const notice = (title, detail, extra = '') => '<div class="sf104-notice ' + extra + '"><strong>' + esc(title) + '</strong><p>' + esc(detail) + '</p></div>';
  function flash(value, error = false) {
    message.className = value ? 'sf104-message' + (error ? ' sf104-error' : '') : '';
    message.textContent = value || '';
  }
  async function api(path = '', options = {}) {
    const init = { method: options.method || 'GET', credentials: 'same-origin', headers: { 'X-WP-Nonce': config.nonce, 'Accept': 'application/json' } };
    if (options.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body); }
    const response = await fetch(config.api.replace(/\/$/, '') + path, init);
    const raw = await response.text();
    let result;
    try { result = JSON.parse(raw); }
    catch { throw new Error('WordPress did not return the merchant API. Check the store REST/permalink configuration, then reload this manager page.'); }
    if (!response.ok) {
      const error = new Error(result.message || 'The original merchant request could not complete.');
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function parseRoute() {
    const q = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (q.has('order')) return { view: 'order', id: q.get('order'), tab: q.get('tab') || 'overview' };
    const view = q.get('view') || 'orders';
    if (view === 'products') return { view, page: q.get('page') || '1', productId: q.get('productId') || '' };
    if (view === 'setup') return { view };
    return { view: 'orders', scope: q.get('scope') || (config.page === 'sf104-checkout-attempts' ? 'attempts' : 'checkout'),
      page: q.get('page') || '1', status: q.get('state') || (config.page === 'sf104-checkout-attempts' ? 'RESERVED' : ''),
      orderId: q.get('orderId') || '', sort: q.get('sort') || 'newest' };
  }
  function routeTo(route, replace = false) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(route)) if (value !== '' && value !== null && value !== undefined) q.set(key, String(value));
    const hash = '#' + q.toString();
    if (replace) { history.replaceState(null, '', hash); render(); }
    else if (location.hash === hash) render();
    else location.hash = hash;
  }
  function rememberRoute(hash = location.hash) { try { sessionStorage.setItem(sessionKey, hash); } catch {} }
  function busy(label = 'Reading original merchant records…') {
    workspace.innerHTML = '<div class="sf104-loading" role="status">' + esc(label) + '</div>';
  }
  function queueLabel(scope) {
    return ({ checkout: 'Native checkout orders', bound: 'All saved payment bindings', notices: 'Settlement notices', attempts: 'Payment attempts' })[scope] || scope;
  }
  function scopeStatus(scope) {
    if (scope === 'notices') return [['RECEIVED', 'Awaiting review'], ['REVIEWING', 'Release / recovery'], ['RELEASED', 'Release recorded']];
    if (scope === 'attempts') return [['RESERVED', 'Reserved'], ['RESET', 'Reset approved']];
    return Object.entries(config.wooStatuses || {}).map(([key, value]) => [key.replace(/^wc-/, ''), value]);
  }
  function optionList(values, current, first) {
    return '<option value="">' + esc(first) + '</option>' + values.map(([value, label]) => '<option value="' + esc(value) + '"' + selected(value, current) + '>' + esc(label) + '</option>').join('');
  }
  function queueCards() {
    const counts = state.status?.counts || {};
    const notices = counts.notices || {};
    const attempts = counts.attempts || {};
    return '<div class="sf104-metrics">' + [
      ['notices', 'RECEIVED', notices.RECEIVED || 0, 'Notices awaiting review'],
      ['attempts', 'RESERVED', attempts.RESERVED || 0, 'Reserved attempts'],
      ['notices', 'REVIEWING', notices.REVIEWING || 0, 'Release recovery'],
      ['notices', 'RELEASED', notices.RELEASED || 0, 'Journal releases'],
    ].map(([scope, status, value, label]) => '<a href="#view=orders&scope=' + scope + '&state=' + status + '" class="sf104-metric"><span>' + esc(label) + '</span><strong>' + value + '</strong></a>').join('') + '</div>';
  }
  function pager(page, pages, kind) {
    return '<div class="sf104-pagination"><span>Page ' + page + ' of ' + Math.max(1, pages) + '</span><div>' +
      button('page', 'Previous', 'data-kind="' + kind + '" data-page="' + Math.max(1, page - 1) + '"' + (page <= 1 ? ' disabled' : '')) +
      button('page', 'Next', 'data-kind="' + kind + '" data-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '')) + '</div></div>';
  }
  function lifecycle(order) {
    const code = order.lifecycle?.code || '';
    const attention = /CHANGED|RECOVERY|REVIEW|UNAVAILABLE|OTHER|INCOMPLETE/.test(code);
    return '<span class="sf104-state' + (attention ? ' sf104-state-attention' : '') + '">' + esc(order.lifecycle?.label || 'Review original order') + '</span>';
  }
  function selectionBar() {
    return '<div class="sf104-selection"><span id="sf104-selected-count">' + state.selected.size + ' selected</span><div>' +
      button('export-selected', 'Download handoff JSON', 'data-format="json"' + (!state.selected.size ? ' disabled' : '')) +
      button('export-selected', 'Printable handoff', 'data-format="html"' + (!state.selected.size ? ' disabled' : '')) +
      button('clear-selection', 'Clear selection', !state.selected.size ? 'disabled' : '') + '</div></div>';
  }
  function updateSelection() {
    const count = document.getElementById('sf104-selected-count');
    if (count) count.textContent = state.selected.size + ' selected';
    root.querySelectorAll('[data-action="export-selected"],[data-action="clear-selection"]').forEach(node => { node.disabled = !state.selected.size; });
    root.querySelectorAll('[data-order-select]').forEach(node => { node.checked = state.selected.has(node.dataset.orderSelect); });
    const all = root.querySelector('[data-select-page]');
    if (all) {
      const selectable = state.rows.filter(row => row.stateDigest);
      all.checked = selectable.length > 0 && selectable.every(row => state.selected.has(row.id));
      all.indeterminate = !all.checked && selectable.some(row => state.selected.has(row.id));
    }
  }
  function ordersView(data) {
    state.rows = data.orders;
    const route = state.route;
    const rows = data.orders.map(order => {
      const terms = order.binding || {};
      const attempt = order.attempt;
      const event = order.notice;
      return '<tr><td class="sf104-check-cell" data-label="Select"><input type="checkbox" data-order-select="' + esc(order.id) + '" aria-label="Select order ' + esc(order.number || order.id) + '"' +
        (!order.stateDigest ? ' disabled' : '') + (state.selected.has(order.id) ? ' checked' : '') + '></td>' +
        '<td data-label="Order"><a class="sf104-order-link" href="#order=' + esc(order.id) + '">#' + esc(order.number || order.id) + '</a><small>Native ID ' + esc(order.id) + '</small>' +
        (!order.missing ? '<small>' + esc(time(order.createdAt)) + '</small>' : '') + '</td>' +
        '<td data-label="Current operation">' + lifecycle(order) + '<small>' + esc(order.lifecycle?.detail) + '</small></td>' +
        '<td data-label="Woo order"><strong>' + esc(order.currency || '') + ' ' + esc(order.total ?? '—') + '</strong><small>' + esc(order.statusLabel || 'Order unavailable') + '</small></td>' +
        '<td data-label="Original payment">' + mono(terms.amountAtomic) + '<small>' + esc(terms.network || 'No saved payment option') + '</small><small>' +
        esc([terms.method, terms.routeId].filter(Boolean).join(' ')) + '</small></td>' +
        '<td data-label="Attempt / notice"><span>' + (attempt ? 'g' + esc(attempt.generation) + ' · ' + esc(attempt.state) : 'No reserved attempt') + '</span><small>' +
        (event ? 'Notice · ' + esc(event.state) : 'No accepted notice') + '</small></td></tr>';
    }).join('');
    workspace.innerHTML = queueCards() + '<section class="sf104-panel"><div class="sf104-panel-heading"><div><h2>Merchant order queue</h2><p>Read current native records, then open the complete order before a release or recovery.</p></div></div>' +
      '<form id="sf104-order-filter" class="sf104-filter"><label>Queue<select name="scope">' +
      ['checkout', 'bound', 'notices', 'attempts'].map(value => '<option value="' + value + '"' + selected(route.scope, value) + '>' + queueLabel(value) + '</option>').join('') +
      '</select></label><label>Status<select name="state">' + optionList(scopeStatus(route.scope), route.status, 'All statuses') + '</select></label>' +
      '<label>Native order ID<input name="orderId" inputmode="numeric" pattern="[1-9][0-9]{0,17}" placeholder="e.g. 456" value="' + esc(route.orderId) + '"></label>' +
      '<label>Order<select name="sort"><option value="newest"' + selected(route.sort, 'newest') + '>Newest IDs first</option><option value="oldest"' + selected(route.sort, 'oldest') + '>Oldest IDs first</option></select></label>' +
      '<button type="submit" class="sf104-button sf104-primary">Apply</button></form>' +
      '<div class="sf104-queue-caption"><strong>' + esc(queueLabel(route.scope)) + '</strong><span>' + data.total + ' current ' + (data.total === 1 ? 'record' : 'records') + '</span></div>' +
      (route.scope === 'bound' ? '<p class="sf104-help">This queue includes saved native checkout and manual payment bindings. It overlaps the checkout queue.</p>' : '') +
      (data.message ? notice('Order lookup', data.message) : '') +
      selectionBar() +
      (rows ? '<div class="sf104-table-scroll"><table class="sf104-order-table"><thead><tr><th class="sf104-check-cell"><input type="checkbox" data-select-page aria-label="Select this page"></th><th>Order</th><th>Current operation</th><th>Woo order</th><th>Original payment</th><th>Attempt / notice</th></tr></thead><tbody>' + rows + '</tbody></table></div>' :
        '<div class="sf104-empty"><h3>No matching records</h3><p>Change the queue or search the original numeric order ID. A new native checkout appears after its Woo order is created.</p><a href="#view=products">Review mapped products</a></div>') +
      pager(data.page, data.pages, 'orders') + '</section>';
    updateSelection();
  }
  function miniFacts(order) {
    return '<dl class="sf104-facts">' + field('Woo order', '#' + order.number + ' / ID ' + order.id) + field('Current Woo status', order.statusLabel) +
      field('Store total', order.currency + ' ' + order.total) + field('Original atomic amount', order.binding?.amountAtomic, true) +
      field('Original network', order.binding?.network, true) + field('Current generation', order.attempt ? order.attempt.generation + ' / ' + order.attempt.state : (order.snapshot?.present ? '1 / no reserved attempt' : 'No checkout generation')) + '</dl>';
  }
  function table(rows, headings) {
    return '<div class="sf104-table-scroll"><table class="sf104-data-table"><thead><tr>' + headings.map(h => '<th>' + esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function orderHeader(order) {
    return '<div class="sf104-breadcrumb"><a href="#view=orders">Merchant orders</a><span>/</span><span>Order #' + esc(order.number) + '</span></div>' +
      '<section class="sf104-order-heading"><div><span class="sf104-eyebrow">ORIGINAL ORDER / ' + esc(order.id) + '</span><h2>Order #' + esc(order.number) + '</h2>' +
      lifecycle(order) + '<p>' + esc(order.lifecycle.detail) + '</p></div><div class="sf104-actions">' + link(order.orderUrl, 'Open Woo order') +
      button('export-order', 'Download handoff', 'data-format="json"') + button('export-order', 'Print handoff', 'data-format="html"') + '</div></section>' +
      '<nav class="sf104-subnav" aria-label="Order views">' + [['overview', 'Overview'], ['terms', 'Terms and source'], ['history', 'History and notes'], ['review', 'Review and recovery'], ['refunds', 'Refunds']].map(([tab, label]) =>
        '<a href="#order=' + esc(order.id) + '&tab=' + tab + '"' + (state.route.tab === tab ? ' aria-current="page"' : '') + '>' + label + '</a>').join('') + '</nav>';
  }
  function overview(order) {
    const event = order.notice, attempt = order.attempt;
    return '<section class="sf104-panel">' + miniFacts(order) + '</section><div class="sf104-two-col">' +
      '<section class="sf104-panel"><h3>Payment and delivery</h3><dl class="sf104-facts sf104-facts-single">' +
      field('Woo paid state', order.paid ? 'Paid in WooCommerce' : 'Unpaid in WooCommerce') + field('Woo transaction', order.transactionId, true) +
      field('Original notice', event ? event.state : 'Not received') + field('Notice transaction', event?.tx_hash, true) +
      field('Notice received', time(event?.received_at)) + field('Woo paid date', time(order.paidAt)) + '</dl>' +
      '<p class="sf104-help">The notice authenticates the sender. Independent Stellar settlement review remains the merchant release decision.</p></section>' +
      '<section class="sf104-panel"><h3>Original buyer and attempt</h3><dl class="sf104-facts sf104-facts-single">' +
      field('Snapshot', order.snapshot?.valid ? 'Saved terms match this current order' : (order.snapshot?.error || 'No frozen checkout snapshot')) +
      field('Attempt state', attempt?.state || 'Not reserved') + field('Payment header SHA-256', attempt?.attempt_digest, true) +
      field('Reserved at', time(attempt?.reserved_at)) + field('Last reset', time(attempt?.reset_at)) + '</dl>' +
      (order.actions.handoff.url ? link(order.actions.handoff.url, 'Download current buyer instructions', 'rel="noreferrer"') : '<p class="sf104-help">' + esc(order.actions.handoff.reason) + '</p>') +
      '</section></div><section class="sf104-panel"><h3>Current Woo line items</h3>' +
      table(order.items.map(item => '<tr><td>' + esc(item.name) + '<small>Product ' + esc(item.productId) + (item.variationId !== '0' ? ' / variation ' + esc(item.variationId) : '') + '</small></td>' +
        '<td>' + esc(item.quantity) + '</td><td>' + esc(item.subtotal) + '</td><td>' + esc(item.total) + '</td><td>' + esc(item.tax) + '</td></tr>'),
      ['Item', 'Quantity', 'Subtotal', 'Line total', 'Tax']) + '<p class="sf104-help">Store amounts above remain exact Woo decimal text in ' + esc(order.currency) + '. Atomic Stellar units are shown separately.</p></section>';
  }
  function sourceRows(value, limit = 128) {
    return Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)).slice(0, limit) : [];
  }
  function sameSource(left, right) {
    if (left === undefined || right === undefined) return false;
    const normalized = value => Array.isArray(value) ? value.map(normalized) :
      value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
    return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
  }
  function basketLineTable(order) {
    const handoff = order.snapshot?.record?.handoff || {};
    return table(sourceRows(handoff.items, 20).map(line =>
      '<tr><td>' + esc(line.name) + '<small>Line ' + esc(line.lineId) + ' / product ' + esc(line.productId) + '</small></td>' +
      '<td>' + esc(text(line.quantity)) + '</td><td>' + mono(line.unitStoreTotal) + '</td><td>' + mono(line.lineStoreTotal) + '</td>' +
      '<td>' + mono(line.unitAmountAtomic) + '</td><td>' + mono(line.lineAmountAtomic) + '</td></tr>'),
    ['Frozen product', 'Quantity', 'Store unit (' + text(handoff.storefront?.currency) + ')', 'Store line', 'Atomic unit', 'Atomic line']);
  }
  function basketTermsView(order) {
    const record = order.snapshot.record, handoff = record.handoff, terms = handoff.operation?.expect || {};
    const frozenLines = sourceRows(record.shape?.items, 20);
    const currentLines = sourceRows(order.currentShape?.items, 20);
    const current = new Map(currentLines.map(line => [String(line.lineId), line]));
    const products = new Map(sourceRows(order.currentProducts, 20).map(product => [String(product.id), product]));
    const approvedProducts = new Map(sourceRows(record.catalog?.products, 64).map(product => [String(product.productId), product]));
    const comparisons = frozenLines.map(frozen => {
      const now = current.get(String(frozen.lineId));
      const unchanged = !!now && ['lineId', 'productId', 'quantity', 'name', 'total', 'tax'].every(key => frozen[key] === now[key]);
      const delivery = now?.delivery ?? products.get(String(frozen.productId))?.delivery;
      return '<tr><td>' + esc(frozen.name) + '<small>Line ' + esc(frozen.lineId) + ' / product ' + esc(frozen.productId) + '</small></td>' +
        '<td>' + esc(text(frozen.quantity)) + ' / ' + esc(text(now?.quantity)) + '</td>' +
        '<td>' + mono(frozen.total) + ' / ' + mono(now?.total) + '</td><td>' + mono(frozen.tax) + ' / ' + mono(now?.tax) + '</td>' +
        '<td>' + (unchanged ? 'Matches' : now ? 'Review difference' : 'Current shape unavailable') + '</td>' +
        '<td>' + (sameSource(frozen.delivery, delivery) ? 'Matches' : 'Review delivery') + '</td></tr>';
    });
    const frozenIds = new Set(frozenLines.map(line => String(line.lineId)));
    for (const line of currentLines.filter(line => !frozenIds.has(String(line.lineId)))) comparisons.push(
      '<tr><td>' + esc(line.name) + '<small>Line ' + esc(line.lineId) + '</small></td><td>' + esc(line.quantity) +
      '</td><td>' + mono(line.total) + '</td><td>' + mono(line.tax) + '</td><td colspan="2">Not in the frozen basket</td></tr>');
    const deliveryCards = frozenLines.map(line => {
      const product = products.get(String(line.productId)), frozen = line.delivery || {};
      const now = current.get(String(line.lineId))?.delivery ?? product?.delivery;
      const currentFiles = new Map(sourceRows(now?.files, 64).map(file => [String(file.id), file]));
      const frozenFiles = new Map(sourceRows(frozen.files, 64).map(file => [String(file.id), file]));
      const ids = [...new Set([...frozenFiles.keys(), ...currentFiles.keys()])].sort();
      const files = ids.map(id => {
        const saved = frozenFiles.get(id), observed = currentFiles.get(id);
        return '<tr><td>' + mono(id) + '</td><td>' + esc(text(saved?.name)) + '<br>' + mono(saved?.file) + '</td>' +
          '<td>' + esc(text(observed?.name)) + '<br>' + mono(observed?.file) + '</td><td>' +
          (sameSource(saved, observed) ? 'Matches' : saved ? 'Review changed or missing file' : 'Added file') + '</td></tr>';
      });
      const flags = [['Virtual', 'virtual'], ['Downloadable', 'downloadable'], ['Download limit', 'limit'], ['Expiry (days)', 'expiry']]
        .map(([label, key]) => '<tr><th>' + esc(label) + '</th><td>' + esc(text(frozen[key])) + '</td><td>' + esc(text(now?.[key])) + '</td></tr>');
      return '<details><summary>Product ' + esc(line.productId) + ' · ' + esc(line.name) + ' — ' +
        (sameSource(frozen, now) ? 'delivery matches' : 'review delivery change') + '</summary><div class="sf104-details-body">' +
        (product?.deliveryError || product?.missing ? notice('Current product delivery', product.deliveryError || product.error) : '') +
        table(flags, ['Definition', 'Frozen order', 'Current product']) +
        (files.length ? table(files, ['File ID', 'Frozen label / location', 'Current label / location', 'Comparison']) : '<p>No downloadable files are defined for this line.</p>') +
        '<p class="sf104-help">These are the merchant’s configured file identities. Customer instructions contain labels only; file-content storage remains with the merchant.</p></div></details>';
    }).join('');
    const productCards = sourceRows(handoff.items, 20).map(line => {
      const product = products.get(String(line.productId)), approved = approvedProducts.get(String(line.productId)) || {};
      const map = product?.mapping || {}, selected = approved.expect || {};
      const rows = [
        ['Store unit currency', approved.storefront?.currency, map.storefront?.currency],
        ['Store unit amount', approved.storefront?.total, map.storefront?.total],
        ['Native atomic unit', selected.maxAtomic, map.amountAtomic],
        ['Network', selected.network, map.network], ['Asset contract', selected.asset, map.asset],
        ['Recipient', selected.payTo, map.payTo], ['Timeout (seconds)', selected.maxTimeoutSeconds, map.maxTimeoutSeconds],
      ];
      return '<details><summary>Product ' + esc(line.productId) + ' · ' + esc(line.name) + '</summary><div class="sf104-details-body">' +
        table(rows.map(([label, frozen, now]) => '<tr><th>' + esc(label) + '</th><td>' + mono(frozen) + '</td><td>' + mono(now) + '</td></tr>'),
          ['Unit term', 'Frozen catalog', 'Current product mapping']) +
        (product?.error ? notice('Current product mapping', product.error) : '') +
        (product?.editUrl ? '<div class="sf104-actions">' + link(product.editUrl, 'Open product ' + product.id) +
          (product.exportUrl ? link(product.exportUrl, 'Export current individual route') : '') + '</div>' : '') + '</div></details>';
    }).join('');
    return '<section class="sf104-panel"><h3>Frozen digital basket</h3>' +
      notice(order.snapshot.valid ? 'Saved basket still matches' : 'Current order differs from its saved basket',
        order.snapshot.valid ? 'The original validator confirms every order line, quantity, total, configured delivery definition and payment binding.' : order.snapshot.error) +
      '<dl class="sf104-facts sf104-facts-single">' + field('Catalog SHA-256', handoff.catalogDigest, true) +
      field('Basket SHA-256', handoff.basketDigest, true) + field('Frozen snapshot SHA-256', record.digest, true) +
      field('Current observed state SHA-256', order.stateDigest, true) + '</dl>' + basketLineTable(order) +
      '<dl class="sf104-facts">' + field('Frozen store total', text(handoff.storefront?.currency) + ' ' + text(handoff.storefront?.total)) +
      field('One native atomic amount', terms.maxAtomic, true) + field('Network', terms.network, true) +
      field('Recipient', terms.payTo, true) + field('Asset contract', terms.asset, true) +
      field('Exact original resource', handoff.operation?.url, true) + '</dl></section>' +
      '<section class="sf104-panel"><h3>Frozen lines versus current saved order</h3>' +
      (order.shapeError ? notice('Current checkout shape', order.shapeError) : '') +
      table(comparisons, ['Original line', 'Quantity: saved / current', 'Net total: saved / current', 'Tax: saved / current', 'Order line', 'Delivery']) +
      '<p class="sf104-help">Net totals and taxes above are separate native Woo values. The frozen basket table shows tax-inclusive store prices. The original order validator controls release.</p></section>' +
      '<section class="sf104-panel"><h3>Per-product delivery definitions</h3><p>Reconcile changed file identities or product delivery settings before the original release. Expanding a product shows its exact saved and current definitions.</p>' +
      deliveryCards + '</section><section class="sf104-panel"><h3>Current product unit mappings</h3>' +
      '<p>These observations describe product settings now. Repricing a product or selecting a new catalog affects new orders; it does not rewrite this order’s frozen payment.</p>' + productCards + '</section>' +
      '<section class="sf104-panel"><h3>Original retained source</h3><dl class="sf104-facts sf104-facts-single">' +
      field('Original asset SHA-256', order.binding?.assetDigest, true) + field('Original recipient SHA-256', order.binding?.recipientDigest, true) +
      field('Binding approved by user ID', order.binding?.approvedBy) + field('Binding approved at', time(order.binding?.approvedAt)) + '</dl>' +
      '<details><summary>Saved snapshot and binding JSON</summary><pre class="sf104-code">' +
      esc(JSON.stringify({snapshot:record,binding:order.binding},null,2)) + '</pre></details></section>';
  }
  function termsView(order) {
    if (order.snapshot?.record?.handoff?.schema === 'stellar-forge.sf104.checkout-handoff.v2') return basketTermsView(order);
    const record = order.snapshot?.record;
    const approved = record?.shape || {};
    const current = order.currentShape || {};
    const shapeRows = [
      ['Product ID', 'productId'], ['Quantity', 'quantity'], ['Currency', 'currency'], ['Final order total', 'total'],
      ['Line total', 'lineTotal'], ['Line tax', 'lineTax'], ['Order tax', 'orderTax'],
    ].map(([label, key]) => {
      const same = approved[key] !== undefined && current[key] === approved[key];
      return '<tr><th>' + esc(label) + '</th><td>' + esc(text(approved[key])) + '</td><td>' + esc(text(current[key])) + '</td><td>' + (record ? (same ? 'Matches' : 'Review difference') : 'Manual binding') + '</td></tr>';
    });
    const terms = record?.handoff?.operation?.expect || {};
    const product = order.currentProduct;
    const map = product?.mapping || {};
    const comparisons = [
      ['Route', record?.handoff?.routeId || order.binding?.routeId, map.routeId],
      ['Method', record?.handoff?.operation?.method || order.binding?.method, map.method],
      ['Resource', record?.handoff?.operation?.url, map.url],
      ['Network', terms.network || order.binding?.network, map.network],
      ['Asset contract', terms.asset, map.asset],
      ['Recipient', terms.payTo, map.payTo],
      ['Atomic amount', terms.maxAtomic || order.binding?.amountAtomic, map.amountAtomic],
      ['Maximum timeout (seconds)', terms.maxTimeoutSeconds, map.maxTimeoutSeconds],
      ['Store currency', record?.handoff?.storefront?.currency, map.storefront?.currency],
      ['Mapped final store total', record?.handoff?.storefront?.total, map.storefront?.total],
    ];
    return '<section class="sf104-panel"><h3>Frozen order versus current Woo order</h3>' +
      (order.snapshot.present ? notice(order.snapshot.valid ? 'Saved order still matches' : 'Current order differs from its saved checkout',
        order.snapshot.valid ? 'The original snapshot validator confirms the item, quantity, currency, totals and payment binding.' : order.snapshot.error) :
        notice('Original manual binding', 'This order uses the original merchant binding without an SF104 checkout snapshot. Keep its original offer and merchant review together.')) +
      (order.shapeError ? notice('Current checkout shape', order.shapeError) : '') +
      table(shapeRows, ['Field', 'Frozen approval', 'Current Woo value', 'Comparison']) +
      '<dl class="sf104-facts sf104-facts-single">' + field('Frozen snapshot SHA-256', record?.digest, true) + field('Current observed state SHA-256', order.stateDigest, true) + '</dl></section>' +
      '<section class="sf104-panel"><h3>Order payment terms and current product mapping</h3><p>Product edits affect new orders. This order keeps its original saved price, recipient and route; a changed current catalog does not rewrite it.</p>' +
      table(comparisons.map(([label, frozen, now]) => '<tr><th>' + esc(label) + '</th><td>' + mono(frozen) + '</td><td>' + mono(now) + '</td></tr>'), ['Term', 'Original order', 'Current mapped product']) +
      (product ? '<div class="sf104-actions">' + link(product.editUrl, 'Open product ' + product.id) + (product.exportUrl ? link(product.exportUrl, 'Export current product route') : '') + '</div>' : '<p>No current product is available for comparison.</p>') +
      (product?.error ? notice('Current product mapping', product.error) : '') +
      '<dl class="sf104-facts sf104-facts-single">' + field('Original asset SHA-256', order.binding?.assetDigest, true) + field('Original recipient SHA-256', order.binding?.recipientDigest, true) +
      field('Binding approved by user ID', order.binding?.approvedBy) + field('Binding approved at', time(order.binding?.approvedAt)) + '</dl></section>' +
      '<section class="sf104-panel"><h3>Original retained source</h3><p>The selected-order handoff includes these saved fields and the current observed state. Buyer authorization uses the separate original buyer instructions.</p>' +
      '<details><summary>Saved snapshot and binding JSON</summary><pre class="sf104-code">' + esc(JSON.stringify({ snapshot: record || null, binding: order.binding }, null, 2)) + '</pre></details></section>';
  }
  function notesHtml() {
    if (!state.notes.length) return '<p class="sf104-help">No native Woo order notes were returned.</p>';
    return '<ol class="sf104-notes">' + state.notes.map(note => '<li><div><strong>' + esc(note.addedBy || 'WooCommerce') + '</strong><span>' + esc(time(note.at)) +
      ' · ' + (note.customerVisible ? 'Customer-visible native note' : 'Private native note') + '</span></div><p>' + esc(note.content) + '</p></li>').join('') + '</ol>';
  }
  function historyView(order) {
    return '<div class="sf104-two-col"><section class="sf104-panel"><h3>Retained lifecycle</h3><p>These timestamps come from the original order and journal fields. Intermediate events are not reconstructed.</p>' +
      '<ol class="sf104-timeline">' + order.timeline.map(event => '<li><span>' + esc(time(event.at)) + '</span><h4>' + esc(event.label) + '</h4><p>' + esc(event.detail) +
      (event.actorId ? '<br>User ID ' + esc(event.actorId) : '') + '</p></li>').join('') + '</ol></section>' +
      '<section class="sf104-panel"><h3>Native Woo order notes</h3><div id="sf104-notes">' + notesHtml() + '</div>' +
      '<div id="sf104-more-notes">' + (state.nextNotes !== null ? button('more-notes', 'Load earlier notes') : '') + '</div>' +
      '<form id="sf104-note-form" class="sf104-form"><label>Private operator note<textarea name="note" rows="4" required maxlength="4000" placeholder="Record the original transaction/source reviewed, the observed result, or the next merchant action."></textarea></label>' +
      '<p class="sf104-help">Saved as a private Woo order note under your existing manager account. Current order state is checked again before saving.</p>' +
      '<button type="submit" class="sf104-button sf104-primary">Save private note</button></form></section></div>';
  }
  function releaseForm(order) {
    const action = order.actions.release;
    const event = order.notice;
    if (!action.enabled) return notice('Release is not available for this current state', action.reason);
    const title = action.mode === 'recover' ? 'Reconcile the already-paid original release' : action.mode === 'continue' ? 'Continue the original release review' : 'Review settlement and release the Woo order';
    return '<h4>' + title + '</h4><p>' + esc(action.reason) + '</p>' +
      (event.state === 'REVIEWING' ? notice('Existing release transaction', 'Use the persisted transaction below. If the earlier operation completed in Woo, the original handler only finalizes its journal. A still-unpaid interrupted review can be reset after the original two-minute interval, then reviewed again.') : '') +
      '<form method="post" action="' + esc(safeUrl(config.adminPost)) + '" class="sf104-form sf104-native-form" data-native-kind="release">' +
      hidden('action', 'sf98_release') + hidden('_wpnonce', config.nonces.release) + hidden('event_id', event.event_id) +
      '<label>Independently verified original transaction hash<input name="transaction_hash" required pattern="[a-fA-F0-9]{64}" maxlength="64" autocomplete="off" spellcheck="false" value="' + esc(event.tx_hash || '') + '"' +
      (event.state === 'REVIEWING' ? ' readonly' : '') + '></label>' +
      '<label class="sf104-check"><input type="checkbox" name="independently_verified" value="1" required><span>I independently verified the original Stellar settlement, exact asset, recipient, atomic amount and order.</span></label>' +
      '<button type="submit" class="sf104-button sf104-primary">' + (action.mode === 'recover' ? 'Reconcile original release' : action.mode === 'continue' ? 'Continue original review' : 'Release Woo order') + '</button></form>';
  }
  function resetForm(order) {
    const action = order.actions.reset;
    if (!action.enabled) return notice('Attempt reset is not available for this current state', action.reason);
    const attempt = order.attempt;
    return '<h4>Reopen the same order as generation ' + (Number(attempt.generation) + 1) + '</h4><p>The original order, payment terms and buyer history stay intact. The buyer imports fresh instructions into the same workspace after its original financial outcome is reconciled.</p>' +
      '<form method="post" action="' + esc(safeUrl(config.adminPost)) + '" class="sf104-form sf104-native-form" data-native-kind="reset">' +
      hidden('action', 'sf104_reset_attempt') + hidden('_wpnonce', config.nonces.reset) + hidden('order_id', order.id) +
      hidden('attempt_digest', attempt.attempt_digest) + hidden('generation', attempt.generation) +
      '<label>Reconciliation note<textarea name="reason" required rows="3" maxlength="240" placeholder="Which original attempt and independent non-settlement observation did you review?"></textarea></label>' +
      '<label class="sf104-check"><input type="checkbox" name="not_settled" value="1" required><span>I independently confirmed this attempt did not settle and this order has no fulfillment notice.</span></label>' +
      '<button type="submit" class="sf104-button">Reopen original order for next attempt</button></form>';
  }
  function reviewView(order) {
    const event = order.notice, attempt = order.attempt;
    return '<section class="sf104-panel">' + miniFacts(order) + '<p class="sf104-help">The actions below use the original WordPress handlers and their current saved-order checks. Refresh after another manager changes the order.</p></section>' +
      '<div class="sf104-two-col"><section class="sf104-panel"><h3>Settlement review and fulfillment</h3>' +
      '<dl class="sf104-facts sf104-facts-single">' + field('Original event', event?.event_id, true) + field('Accepted body SHA-256', event?.body_sha256, true) +
      field('Journal state', event?.state) + field('Original reviewer ID', event?.reviewed_by) + '</dl>' + releaseForm(order) +
      '</section><section class="sf104-panel"><h3>Native payment attempt recovery</h3>' +
      '<dl class="sf104-facts sf104-facts-single">' + field('Current generation', attempt?.generation) + field('Current attempt state', attempt?.state) +
      field('Reserved payment-header SHA-256', attempt?.attempt_digest, true) + field('Last reset by user ID', attempt?.reset_by) +
      field('Last reset note', attempt?.reset_reason) + '</dl>' + resetForm(order) + '</section></div>';
  }
  function orderView(order) {
    state.order = order;
    const tab = ['overview', 'terms', 'history', 'review', 'refunds'].includes(state.route.tab) ? state.route.tab : 'overview';
    workspace.innerHTML = orderHeader(order) + (tab === 'refunds' ? '<div id="sf104-refund-workspace"></div>' : tab === 'terms' ? termsView(order) : tab === 'history' ? historyView(order) : tab === 'review' ? reviewView(order) : overview(order));
    if (tab === 'refunds') window.SF104Refunds.mount(document.getElementById('sf104-refund-workspace'), {orderId:order.id, config});
  }
  function productsView(data) {
    const route = state.route;
    workspace.innerHTML = '<section class="sf104-panel"><div class="sf104-panel-heading"><div><h2>Saved native product mappings</h2><p>Use the existing Woo product editor to maintain one fixed digital SKU and export the same route to the original seller.</p></div>' +
      link(state.status.links.newProduct, 'New Woo product') + '</div>' +
      '<form id="sf104-product-filter" class="sf104-filter"><label>Native product ID<input name="productId" inputmode="numeric" pattern="[1-9][0-9]{0,17}" value="' + esc(route.productId) + '" placeholder="Find an existing product"></label><button type="submit" class="sf104-button">Find product</button>' +
      button('all-products', 'Show mapped products') + '</form><p>' + data.total + ' ' + (route.productId ? 'matching' : 'mapped') + ' products</p></section>' +
      '<div class="sf104-product-grid">' + data.products.map(product => {
        const map = product.mapping || {};
        return '<section class="sf104-panel"><div class="sf104-panel-heading"><div><span class="sf104-eyebrow">PRODUCT / ' + esc(product.id) + '</span><h3>' + esc(product.name) + '</h3></div><span class="sf104-state">' +
          (product.valid ? 'Mapping valid' : 'Review mapping') + '</span></div>' +
          '<dl class="sf104-facts sf104-facts-single">' + field('Woo product', product.status + ' / ' + product.type + (product.virtual ? ' / virtual' : '') + (product.downloadable ? ' / downloadable' : '')) +
          field('Current base price', product.basePrice) + field('Mapped final checkout total', map.storefront ? map.storefront.currency + ' ' + map.storefront.total : null) +
          field('Atomic Stellar amount', map.amountAtomic, true) + field('Network', map.network, true) + field('Route', [map.method, map.routeId].filter(Boolean).join(' '), true) +
          field('Seller resource', map.url, true) + field('Recipient', map.payTo, true) + '</dl>' +
          (product.error ? notice('Product configuration', product.error) : '') +
          '<div class="sf104-actions">' + link(product.editUrl, 'Edit original product') + (product.exportUrl ? link(product.exportUrl, 'Download saved merchant route') : '') + '</div>' +
          '<p class="sf104-help">The mapped final total includes the merchant-declared store pricing conditions. Existing orders retain their saved terms when this product changes.</p></section>';
      }).join('') + '</div>' +
      (!data.products.length ? '<section class="sf104-panel sf104-empty"><h3>No saved mapping in this view</h3><p>Create or open a simple virtual Woo product. Configure its exact Stellar checkout mapping in the existing General product panel.</p>' + link(state.status.links.newProduct, 'Open product editor') + '</section>' : '') +
      '<section class="sf104-panel">' + pager(data.page, data.pages, 'products') + '</section>';
  }
  function bindForm() {
    return '<form method="post" action="' + esc(safeUrl(config.adminPost)) + '" class="sf104-form sf104-native-form" data-native-kind="bind">' +
      hidden('action', 'sf98_bind') + hidden('_wpnonce', config.nonces.bind) +
      '<div class="sf104-form-grid">' + [
        ['order_id', 'Existing unpaid Woo order ID', '[1-9][0-9]{0,17}'],
        ['route_id', 'Original seller route ID', '[A-Za-z0-9_-]{1,64}'],
        ['amount_atomic', 'Exact atomic amount', '[1-9][0-9]*'],
        ['asset', 'Original asset identifier', ''],
        ['pay_to', 'Exact public payTo recipient', ''],
      ].map(([name, label, pattern]) => '<label>' + label + '<input name="' + name + '" required autocomplete="off" spellcheck="false"' + (pattern ? ' pattern="' + pattern + '"' : '') + '></label>').join('') +
      '<label>Method<select name="method">' + ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => '<option>' + method + '</option>').join('') + '</select></label>' +
      '<label>Network<select name="network"><option>stellar:testnet</option><option>stellar:pubnet</option></select></label></div>' +
      '<p class="sf104-help">Copy the complete original offer. This action stores the original asset/recipient digests; it does not charge or fulfill an order. A frozen checkout or an order with an accepted notice cannot be rebound.</p>' +
      '<button type="submit" class="sf104-button">Prebind existing Woo order</button></form>';
  }
  function setupView() {
    const data = state.status;
    const steps = [
      ['Configure the original plugin', 'Keep the private SF98 secret in wp-config.php and the matching private environment of the original seller and delivery worker. Enable the existing native gateway only after the store HTTPS origin and REST routes are usable.'],
      ['Map and export the digital products', 'Declare each simple virtual product’s exact storefront unit total and original native Stellar unit terms. For a digital basket, enable its approved catalog in the payment gateway settings and export that exact catalog; legacy single-product orders retain their individual route exports.'],
      ['Prepare the maintained native seller', 'Use the original woo-seller prepare with --basket for each retained catalog and --route for legacy orders. Keep the same store origin and existing delivery outbox across catalog updates. Run the original seller and SF98 sender with the matching private secret.'],
      ['Operate one original order', 'A shopper uses the original checkout and receives its private buyer instructions. In Orders, inspect the saved terms, reserved generation and authenticated notice. Independently verify the original settlement, then release through the existing Woo handler.'],
    ];
    workspace.innerHTML = '<section class="sf104-panel"><div class="sf104-panel-heading"><div><h2>Merchant operating setup</h2><p>Configure the existing installation and keep its original payment, delivery and recovery components together.</p></div>' +
      link(data.links.gateway, 'Woo payment settings') + '</div><dl class="sf104-facts">' + field('Store HTTPS origin', data.storeOrigin, true) +
      field('Plugin / console', data.version) + field('WooCommerce', data.woocommerce) + field('WordPress / PHP', data.wordpress + ' / ' + data.php) + field('Native order storage', data.orderStorage) + field('Store currency', data.currency) + '</dl>' +
      '<ul class="sf104-health">' + data.health.map(item => '<li><span aria-hidden="true">' + (item.ready ? '✓' : '!') + '</span><div><strong>' + (item.ready ? 'Ready' : 'Action needed') + '</strong><p>' + esc(item.message) + '</p></div></li>').join('') + '</ul></section>' +
      '<div class="sf104-two-col"><section class="sf104-panel"><h3>Install and operate</h3><ol class="sf104-steps">' + steps.map(([title, detail]) => '<li><h4>' + title + '</h4><p>' + detail + '</p></li>').join('') +
      '</ol><div class="sf104-actions"><a class="sf104-button" href="#view=products">Review mapped products</a>' + link(data.links.permalinks, 'WordPress permalinks') + '</div></section>' +
      '<section class="sf104-panel"><h3>Actual WordPress endpoints</h3><dl class="sf104-facts sf104-facts-single">' + field('Signed checkout admission', data.endpoints.admission, true) +
      field('Signed SF98 settlement notice', data.endpoints.settlement, true) + '</dl><p>Use these exact store routes, including any WordPress installation subdirectory. A fresh unauthenticated request should reach the original authentication handler; a WordPress 404 means routing still needs configuration.</p>' +
      '<h4>Private secret wiring</h4><pre class="sf104-code">/* wp-config.php; merchant private environment */\ndefine(\'SF98_WEBHOOK_SECRET\', getenv(\'SF98_WEBHOOK_SECRET\'));</pre>' +
      '<p class="sf104-help">Define the constant from the merchant’s existing private secret. A process environment value alone is not read by the original PHP receiver. Do not paste the secret into this console, a product mapping or a handoff.</p>' +
      '<h4>Handoff and recovery</h4><p>The selected-order JSON and printable handoff contain current order, frozen terms, attempt and notice observations. Restore the store through its existing WordPress/database backup; an operating handoff does not replace that backup or independent transfer verification.</p></section></div>' +
      '<section class="sf104-panel"><details><summary>Bind an existing unpaid order to a manual merchant operation</summary><div class="sf104-details-body"><p>Use this original path for an order created outside the native digital checkout. It preserves the original SF98 merchant binding and receiver.</p>' + bindForm() + '</div></details></section>';
  }
  async function render() {
    const ticket = ++state.ticket;
    state.route = parseRoute();
    rememberRoute();
    const view = state.route.view === 'order' ? 'orders' : state.route.view;
    root.querySelectorAll('[data-view]').forEach(node => {
      if (node.dataset.view === view) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
    });
    busy();
    try {
      if (!state.status) state.status = await api('');
      if (ticket !== state.ticket) return;
      if (state.route.view === 'setup') setupView();
      else if (state.route.view === 'products') {
        const q = new URLSearchParams({ page: state.route.page, limit: '20', productId: state.route.productId });
        const data = await api('/products?' + q);
        if (ticket !== state.ticket) return;
        productsView(data);
      } else if (state.route.view === 'order') {
        if (!/^[1-9][0-9]{0,17}$/.test(state.route.id)) throw new Error('Use the original numeric Woo order ID.');
        const data = await api('/orders/' + state.route.id);
        if (ticket !== state.ticket) return;
        state.notes = []; state.nextNotes = null;
        if (state.route.tab === 'history') {
          const notes = await api('/orders/' + state.route.id + '/notes?limit=25&offset=0');
          if (ticket !== state.ticket) return;
          state.notes = notes.notes; state.nextNotes = notes.nextOffset;
        }
        orderView(data.order);
        document.getElementById('sf104-observed').textContent = 'Observed ' + time(data.observedAt);
      } else {
        const q = new URLSearchParams({ scope: state.route.scope, page: state.route.page, limit: '25', state: state.route.status, orderId: state.route.orderId, sort: state.route.sort });
        const data = await api('/orders?' + q);
        if (ticket !== state.ticket) return;
        ordersView(data);
        document.getElementById('sf104-observed').textContent = 'Observed ' + time(data.observedAt);
      }
    } catch (error) {
      if (ticket !== state.ticket) return;
      workspace.innerHTML = '<section class="sf104-panel">' + notice('The current view could not be read', error.message) + button('refresh', 'Read current state again') + '</section>';
      flash(error.message, true);
    }
  }
  function download(name, data, type) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function printable(handoff) {
    const css = 'body{font:14px/1.5 system-ui,sans-serif;color:#242424;margin:40px auto;max-width:1050px;padding:0 24px}h1{font-size:28px}h2{font-size:22px;border-bottom:2px solid #323232;padding-bottom:8px}h3{font-size:16px}small,.muted{color:#626262}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #d2d2d2;text-align:left;vertical-align:top;padding:8px;overflow-wrap:anywhere}th{background:#f2f2f2}code,pre{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}section{margin:36px 0;break-inside:avoid-page}details{margin:18px 0}@media print{body{margin:0;padding:0;max-width:none}button{display:none}details>*{display:block}summary{display:none}section{break-inside:auto}}';
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stellar merchant order handoff</title><style>' + css +
      '</style><body><header><p class="muted">STELLAR / ORIGINAL MERCHANT OPERATIONS</p><h1>Selected-order handoff</h1><p>' + esc(handoff.storeOrigin || 'Store origin unavailable') +
      '<br>Generated ' + esc(time(handoff.generatedAt)) + ' · Manager user ID ' + esc(handoff.operatorId) + '</p><p>' + esc(handoff.meaning) + '</p></header>' +
      handoff.records.map(record => {
        const order = record.order;
        return '<section><h2>Order #' + esc(order.number) + ' · native ID ' + esc(order.id) + '</h2><p><strong>' + esc(order.lifecycle.label) + '</strong><br>' + esc(order.lifecycle.detail) +
          '</p><table><tbody>' + [['Observed', time(record.observedAt)], ['Woo status', order.statusLabel], ['Woo total', order.currency + ' ' + order.total],
            ['Original route', [order.binding?.method, order.binding?.routeId].filter(Boolean).join(' ')], ['Network', order.binding?.network],
            ['Atomic amount', order.binding?.amountAtomic], ['Original asset digest', order.binding?.assetDigest], ['Original recipient digest', order.binding?.recipientDigest],
            ['Attempt state / generation', order.attempt ? order.attempt.state + ' / g' + order.attempt.generation : 'No reserved attempt'],
            ['Payment-header digest', order.attempt?.attempt_digest], ['Notice state', order.notice?.state], ['Original event ID', order.notice?.event_id],
            ['Notice body digest', order.notice?.body_sha256], ['Recorded notice transaction', order.notice?.tx_hash], ['Woo transaction', order.transactionId],
            ['Frozen order comparison', order.snapshot?.valid ? 'Matches current Woo order' : order.snapshot?.error || 'Manual binding'],
            ['Observed state digest', order.stateDigest]].map(([label, value]) => '<tr><th>' + esc(label) + '</th><td>' + esc(text(value)) + '</td></tr>').join('') +
          '</tbody></table>' + (order.snapshot?.record?.handoff?.schema === 'stellar-forge.sf104.checkout-handoff.v2' ?
            '<h3>Frozen basket items</h3>' + basketLineTable(order) + '<p>Catalog ' + mono(order.snapshot.record.handoff.catalogDigest) +
            '<br>Basket ' + mono(order.snapshot.record.handoff.basketDigest) + '</p>' : '') + '<h3>Retained lifecycle</h3><ul>' + order.timeline.map(event => '<li>' + esc(time(event.at)) + ' — ' + esc(event.label) + ': ' + esc(event.detail) + '</li>').join('') +
          '</ul><details><summary>Complete selected source record</summary><pre>' + esc(JSON.stringify(record, null, 2)) + '</pre></details></section>';
      }).join('') + '<footer><p>' + esc(handoff.schema) + ' · ' + esc(handoff.source.plugin) + ' ' + esc(handoff.source.version) + '</p></footer></body></html>';
  }
  async function exportOrders(records, format, trigger) {
    if (!records.length) return;
    if (trigger) trigger.disabled = true;
    flash('Re-reading the selected original orders…');
    try {
      const result = await api('/handoff', { method: 'POST', body: { orders: records.map(order => ({ id: order.id, stateDigest: order.stateDigest })) } });
      const stamp = result.generatedAt.replace(/[^0-9]/g, '').slice(0, 14);
      if (format === 'html') download('stellar-merchant-handoff-' + stamp + '.html', printable(result), 'text/html;charset=utf-8');
      else download('stellar-merchant-handoff-' + stamp + '.json', JSON.stringify(result, null, 2) + '\n', 'application/json;charset=utf-8');
      flash('Downloaded ' + result.records.length + ' original order observations. Each matched the state selected for this handoff.');
    } catch (error) { flash(error.message, true); }
    finally { if (trigger) trigger.disabled = false; }
  }
  root.addEventListener('click', async event => {
    const view = event.target.closest('[data-view]');
    if (view) { flash(''); routeTo({ view: view.dataset.view }); return; }
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'refresh') { flash(''); state.status = null; await render(); }
    else if (action === 'page') {
      if (target.dataset.kind === 'products') routeTo({ view: 'products', page: target.dataset.page, productId: state.route.productId });
      else routeTo({ view: 'orders', scope: state.route.scope, page: target.dataset.page, state: state.route.status, orderId: state.route.orderId, sort: state.route.sort });
    } else if (action === 'all-products') routeTo({ view: 'products' });
    else if (action === 'clear-selection') { state.selected.clear(); updateSelection(); }
    else if (action === 'export-selected') await exportOrders([...state.selected.values()], target.dataset.format, target);
    else if (action === 'export-order') await exportOrders(state.order ? [state.order] : [], target.dataset.format, target);
    else if (action === 'more-notes' && state.order && state.nextNotes !== null) {
      target.disabled = true;
      try {
        const result = await api('/orders/' + state.order.id + '/notes?limit=25&offset=' + state.nextNotes);
        state.notes.push(...result.notes); state.nextNotes = result.nextOffset;
        document.getElementById('sf104-notes').innerHTML = notesHtml();
        document.getElementById('sf104-more-notes').innerHTML = state.nextNotes !== null ? button('more-notes', 'Load earlier notes') : '';
      } catch (error) { flash(error.message, true); target.disabled = false; }
    }
  });
  root.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-order-select]')) {
      const order = state.rows.find(row => row.id === target.dataset.orderSelect);
      if (!order?.stateDigest) return;
      if (target.checked) {
        if (state.selected.size >= 100 && !state.selected.has(order.id)) { target.checked = false; flash('Export the current selection before selecting more than 100 orders.', true); return; }
        state.selected.set(order.id, order);
      } else state.selected.delete(order.id);
      updateSelection();
    } else if (target.matches('[data-select-page]')) {
      const rows = state.rows.filter(row => row.stateDigest);
      if (target.checked && new Set([...state.selected.keys(), ...rows.map(row => row.id)]).size > 100) {
        target.checked = false; flash('Export the current selection before selecting more than 100 orders.', true); return;
      }
      rows.forEach(row => { if (target.checked) state.selected.set(row.id, row); else state.selected.delete(row.id); });
      updateSelection();
    } else if (target.matches('#sf104-order-filter [name="scope"]')) {
      const statuses = root.querySelector('#sf104-order-filter [name="state"]');
      statuses.innerHTML = optionList(scopeStatus(target.value), '', 'All statuses');
    }
  });
  root.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id === 'sf104-order-filter') {
      event.preventDefault(); flash('');
      const data = new FormData(form);
      routeTo({ view: 'orders', scope: data.get('scope'), state: data.get('state'), orderId: data.get('orderId').trim(), sort: data.get('sort') });
    } else if (form.id === 'sf104-product-filter') {
      event.preventDefault(); flash('');
      routeTo({ view: 'products', productId: new FormData(form).get('productId').trim() });
    } else if (form.id === 'sf104-note-form') {
      event.preventDefault();
      const target = form.querySelector('button[type="submit"]');
      const note = new FormData(form).get('note');
      if (new TextEncoder().encode(note).length > 4000) { flash('Use a shorter note (maximum 4000 UTF-8 bytes).', true); return; }
      target.disabled = true;
      try {
        await api('/orders/' + state.order.id + '/notes', { method: 'POST', body: { stateDigest: state.order.stateDigest, note } });
        flash('Private note saved in the original Woo order.');
        await render();
      } catch (error) { flash(error.message, true); target.disabled = false; }
    } else if (form.matches('.sf104-native-form')) {
      const data = new FormData(form);
      if (form.dataset.nativeKind === 'reset' && new TextEncoder().encode(data.get('reason')).length > 240) {
        event.preventDefault(); flash('Use a shorter reconciliation note (maximum 240 UTF-8 bytes).', true); return;
      }
      const id = form.dataset.nativeKind === 'bind' ? data.get('order_id') : state.order?.id;
      if (id) rememberRoute('#order=' + encodeURIComponent(id) + '&tab=review');
      form.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = true; });
      // Submit once through the original nonce-protected PHP handler.
    }
  });
  window.addEventListener('hashchange', () => { flash(''); render(); });
  const flags = new URLSearchParams(location.search);
  const result = flags.get('sf98_result') || flags.get('sf104_result');
  const results = {
    released: 'Woo fulfillment completed and the original notice journal was updated.',
    recovered_release: 'The already-paid original transaction was reconciled into its notice journal.',
    already_released: 'The original transaction is already released in Woo and its notice journal.',
    stale_review_reset_retry: 'The interrupted unpaid release review was reopened. Verify the current original state and submit the same transaction again when ready.',
    reopened_for_new_attempt: 'The original order is reopened at its next approved attempt generation. Fresh buyer instructions are available after the original buyer outcome is reconciled.',
    order_binding_changed: 'The current Woo order differs from its frozen checkout. Correct or reconcile the original order before release.',
    transaction_conflict: 'The submitted transaction differs from the persisted original release transaction.',
    review_busy_or_unavailable: 'The original order is busy or its saved state is unavailable. Read the same order again before another action.',
    released_state_requires_reconciliation: 'The notice journal records a release but the current Woo paid state or transaction differs.',
  };
  if (result) flash(results[result] || 'Original merchant handler: ' + result.replace(/_/g, ' '), /reject|conflict|changed|unavailable|needs|not_|missing|race/.test(result));
  if (!location.hash) {
    try {
      const saved = sessionStorage.getItem(sessionKey);
      if (saved && /^#(?:order=|view=)/.test(saved)) history.replaceState(null, '', location.pathname + location.search + saved);
    } catch {}
  }
  render();
})();

