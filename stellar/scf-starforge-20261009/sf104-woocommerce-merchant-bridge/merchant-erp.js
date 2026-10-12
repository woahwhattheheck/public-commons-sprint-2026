/* MIT. Original Woo ERP operator surface; all writes use the same native journal. */
(() => {
  'use strict';
  const root = document.getElementById('sf104-erp'), config = window.SF104ERP;
  if (!root || !config) return;
  const content = document.getElementById('sf104-erp-content');
  const S = {view:'orders', status:null, queue:null, selected:null, edition:null, busy:false,
    message:'', kind:'info', filter:{q:'',state:'',page:1}, draft:null, dirty:false,
    tablePages:{customerBindings:1,productBindings:1,feeBindings:1}, reason:'', providerOutcome:'',
    confirmNoOrder:false, confirmOperationEnded:false, acceptBaseline:false, expandedAttempt:null, allDecisions:false};
  const TABLES = {
    customerBindings:{title:'Customers',fields:['sourceKey','customerId','locationId'],labels:['Woo source','ERP customer','ERP location'],hint:'Use customer:42 or email:buyer@example.com for an approved existing ERP customer.'},
    productBindings:{title:'Products',fields:['sourceKey','inventoryId','uom','taxCategory','warehouseId'],labels:['Woo product / SKU','ERP inventory','Unit','Tax category','Warehouse'],hint:'Use product:42 for the actual product or variation ID, or sku:ITEM-42.'},
    feeBindings:{title:'Fees',fields:['sourceKey','inventoryId','uom','taxCategory','warehouseId'],labels:['Woo fee','ERP inventory','Unit','Tax category','Warehouse'],hint:'Use fee: followed by the exact original Woo fee name.'}
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const json = value => JSON.stringify(value, null, 2);
  const copy = value => JSON.parse(JSON.stringify(value));
  const badge = value => '<span class="erp-badge">' + esc(String(value ?? '').replaceAll('_',' ')) + '</span>';
  const disabled = condition => condition || S.busy ? ' disabled' : '';
  const showValue = value => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const minor = (value, scale) => { const s = String(value ?? '0').padStart(scale + 1,'0'); return scale ? s.slice(0,-scale) + '.' + s.slice(-scale) : s; };
  const chosenEdition = record => record.editions.find(e => e.id === (S.edition || record.currentEditionId)) || record.editions.find(e => e.id === record.currentEditionId);
  const field = (path, label, value, extra = '') => '<label>' + esc(label) + '<input data-map-path="' + path + '" value="' + esc(value) + '"' + extra + '></label>';
  const options = (values, selected) => values.map(v => '<option value="' + esc(typeof v === 'string' ? v : v[0]) + '"' + ((typeof v === 'string' ? v : v[0]) === selected ? ' selected' : '') + '>' + esc(typeof v === 'string' ? v : v[1]) + '</option>').join('');
  const note = text => '<div class="erp-note">' + esc(text) + '</div>';

  async function api(path, body, timeoutMs = 30000) {
    const base = new URL(config.api, location.href);
    if (base.origin !== location.origin) throw Error('The WordPress REST address must use this administrator origin.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(base.href.replace(/\/$/,'') + path, {method:body === undefined ? 'GET' : 'POST',
        credentials:'same-origin', redirect:'error', signal:controller.signal,
        headers:{'Accept':'application/json','X-WP-Nonce':config.nonce,...(body === undefined ? {} : {'Content-Type':'application/json'})},
        ...(body === undefined ? {} : {body:JSON.stringify(body)})});
      const value = await response.json();
      if (!response.ok) throw Error(value.message || 'The original ERP operation returned HTTP ' + response.status + '.');
      return value;
    } catch (error) {
      if (error.name === 'AbortError') throw Error('The request ended without a completed response. Refresh this original order to read its retained delivery state before continuing.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function busy(fn) {
    if (S.busy) return;
    S.busy = true; S.message = ''; render();
    try { await fn(); }
    catch (error) { S.message = error.message || String(error); S.kind = 'error'; }
    finally { S.busy = false; render(); }
  }
  async function status(resetDraft = false) {
    S.status = await api('');
    if (resetDraft || !S.draft) { S.draft = copy(S.status.selectedMap?.mapping || blankMap()); S.dirty = false; }
  }
  async function queue() {
    S.queue = await api('/orders?' + new URLSearchParams({q:S.filter.q,state:S.filter.state,page:String(S.filter.page),limit:'25'}));
  }
  function setSelected(value) {
    if (S.selected?.record.operationId !== value.record.operationId) { S.reason = ''; S.providerOutcome = ''; S.allDecisions = false; }
    S.selected = value; S.edition = value.record.currentEditionId; S.acceptBaseline = false;
    S.confirmNoOrder = false; S.confirmOperationEnded = false; S.expandedAttempt = null;
  }
  async function refresh() {
    await status(false);
    if (S.view === 'orders') await queue();
    if (S.selected) setSelected(await api('/orders/' + S.selected.record.operationId));
  }
  function blankBinding() { return {inventoryId:'',uom:'EA',taxCategory:'',warehouseId:''}; }
  function blankMap() {
    return {schema:'stellar-forge.sf104.erp-map.v1',name:'',storeNamespace:'',reviewOwner:'',
      currency:'USD',currencyDecimals:2,unitPriceDecimals:4,admittedStatuses:['processing','completed'],
      addressMode:'order_override',target:{baseUrl:'',endpoint:'Default',version:'25.200.001',
        orderType:'SO',tokenEnv:'SF104_ERP_ACUMATICA_TOKEN',branch:'',taxZone:'',hold:true,contractReference:'',allowLocal:false},
      customerBindings:[],productBindings:[],feeBindings:[],shippingBinding:null};
  }
  function mapOptions(selected) {
    return '<option value="">Select mapping</option>' + (S.status?.maps || []).map(m =>
      '<option value="' + m.id + '"' + (m.id === selected ? ' selected' : '') + '>' + esc(m.name + ' / ' + m.storeNamespace + ' / ' + m.id.slice(0,10)) + '</option>').join('');
  }
  function issueList(issues) {
    if (!issues?.length) return '';
    return '<div class="erp-note"><ul>' + issues.map(i => '<li>' + esc(typeof i === 'string' ? i : i.field + ': expected ' + showValue(i.expected) + '; returned ' + showValue(i.actual)) + '</li>').join('') + '</ul></div>';
  }
  function renderOrders() {
    const q = S.queue;
    let html = '<section class="erp-card"><header><div><h2>Original order queue</h2><p class="erp-muted">Search by Woo order, customer reference, or ERP order number.</p></div>' + badge(S.status.selectedMap ? S.status.selectedMap.mapping.name : 'No mapping selected') + '</header>' +
      '<form data-form="queue" class="erp-toolbar"><label>Order search<input name="q" value="' + esc(S.filter.q) + '" maxlength="100" placeholder="Woo ID, STORE-42, or SO/000123"></label><label class="erp-compact">State<select name="state">' +
      options([['','All states'],...S.status.states.map(v => [v,v.replaceAll('_',' ')])], S.filter.state) + '</select></label><button type="submit"' + disabled(false) + '>Search</button></form>';
    if (!q) html += '<p>Reading the retained queue…</p>';
    else {
      html += '<div class="erp-scroll"><table class="erp-table erp-orders-table"><thead><tr><th>Woo order</th><th>Customer order reference</th><th>State</th><th>ERP order</th><th class="erp-number">Original total</th><th>Operating owner</th><th>Updated</th><th></th></tr></thead><tbody>' +
        (q.orders.length ? q.orders.map(row => '<tr><td><strong>#' + esc(row.orderId) + '</strong><br><span class="erp-small">Edition ' + row.editionNumber + '</span></td><td><code>' + esc(row.externalReference) +
          '</code></td><td>' + badge(row.state) + '</td><td>' + esc(row.targetKey ? row.targetKey.orderType + '/' + row.targetKey.orderNbr : 'Unreceived') + '</td><td class="erp-number">' +
          esc(row.currency + ' ' + row.total) + '</td><td>' + esc(row.owner) + '</td><td class="erp-small">' + esc(row.updatedAt) +
          '</td><td><button data-action="open-order" data-id="' + row.operationId + '"' + disabled(false) + '>Open</button></td></tr>').join('') : '<tr><td colspan="8">No retained ERP orders match this selection.</td></tr>') +
        '</tbody></table></div><div class="erp-pager"><span>' + q.total + ' orders · Page ' + q.page + ' of ' + Math.max(1,q.pages) + '</span><button data-action="queue-prev"' + disabled(q.page <= 1) + '>Previous</button><button data-action="queue-next"' + disabled(q.page >= q.pages) + '>Next</button></div>';
    }
    html += '<div class="erp-section"><h3>Prepare a Woo order</h3><p class="erp-muted">Select its original numeric ID and the mapping reviewed for this store. Existing history stays with the same order.</p>' +
      '<form data-form="prepare" class="erp-toolbar"><label class="erp-compact">Woo order ID<input required name="orderId" inputmode="numeric" pattern="[1-9][0-9]{0,17}" placeholder="42"></label><label>Mapping revision<select required name="mapId">' +
      mapOptions(S.status.currentMapId) + '</select></label><button class="erp-primary" type="submit"' + disabled(!S.status.currentMapId) + '>Prepare original order</button></form></div></section>';
    if (S.selected) html += renderOrder();
    return html;
  }
  function sourceDifferences(record, edition) {
    const previous = record.editions.filter(e => e.number < edition.number).at(-1);
    if (!previous) return '';
    const rows = [];
    const add = (label, before, after) => { if (JSON.stringify(before) !== JSON.stringify(after)) rows.push([label,before,after]); };
    for (const name of ['total','totalTax','discountTotal','currency','customerId','billing','shipping','refundIds']) add(name,previous.source[name],edition.source[name]);
    add('mapping revision',previous.mapId,edition.mapId);
    const before = new Map(previous.source.lines.map(l => [l.kind + ':' + l.id,l]));
    const after = new Map(edition.source.lines.map(l => [l.kind + ':' + l.id,l]));
    for (const id of new Set([...before.keys(),...after.keys()])) {
      if (!before.has(id) || !after.has(id)) add('Line ' + id,before.get(id) || null,after.get(id) || null);
      else for (const field of ['name','sku','productId','variationId','quantity','subtotal','total','tax']) add('Line ' + id + ' / ' + field,before.get(id)[field],after.get(id)[field]);
    }
    return '<details class="erp-section"><summary>Source changes from edition ' + previous.number + ' (' + rows.length + ')</summary>' + diffTable(rows.map(r => ({field:r[0],expected:r[1],actual:r[2]})), 'Previous edition', 'Shown edition') + '</details>';
  }
  function diffTable(rows, expected = 'Approved source', actual = 'Returned ERP') {
    if (!rows?.length) return '<p>The compared fields match.</p>';
    return '<div class="erp-scroll"><table class="erp-table"><thead><tr><th>Field</th><th>' + esc(expected) + '</th><th>' + esc(actual) + '</th></tr></thead><tbody>' +
      rows.map(row => '<tr><td>' + esc(row.field) + '</td><td><code>' + esc(showValue(row.expected)) + '</code></td><td><code>' + esc(showValue(row.actual)) + '</code></td></tr>').join('') + '</tbody></table></div>';
  }
  function renderOrder() {
    const view = S.selected, record = view.record, edition = chosenEdition(record), plan = edition.plan;
    const current = edition.id === record.currentEditionId, live = view.sourceStatus, lookup = record.lastLookup;
    const ready = current && plan && !record.imported && !record.importNeedsReconcile && !record.pendingWrite && live.available && live.sameOrderKey && live.matchesEdition;
    const state = record.state, key = record.target?.key;
    let html = '<section class="erp-card" id="erp-order"><header><div><p class="erp-eyebrow">ORIGINAL WOO ORDER #' + esc(record.orderId) + '</p><h2>' + esc(record.externalReference) +
      '</h2><p class="erp-small erp-muted">Operation <code>' + record.operationId + '</code> · Revision ' + record.revision + '</p></div><div class="erp-actions"><button data-action="export-project"' + disabled(false) + '>Export complete project</button></div></header>' +
      '<dl class="erp-metrics"><div><dt>Delivery state</dt><dd>' + badge(state) + '</dd></div><div><dt>ERP document</dt><dd>' + esc(key ? key.orderType + '/' + key.orderNbr : 'Unreceived') +
      '</dd></div><div><dt>Original Woo total</dt><dd>' + esc(edition.source.currency + ' ' + edition.source.total) + '</dd></div><div><dt>Operating owner</dt><dd>' + esc(edition.reviewOwner) + '</dd></div></dl>';
    html += note(live.available ? (live.sameOrderKey && live.matchesEdition ? 'The current Woo source matches the current retained edition. Woo state: ' + live.status + '.' :
      'The current Woo source differs from the retained edition. Prepare its current contents before approving a delivery.') : live.message || 'The original Woo source is unavailable in this installation.');
    html += issueList(record.issues);
    html += '<div class="erp-toolbar"><label>Retained source edition<select id="erp-edition">' + record.editions.map(e => '<option value="' + e.id + '"' + (e.id === edition.id ? ' selected' : '') + '>Edition ' + e.number + ' · ' + esc(e.preparedAt) + (e.id === record.currentEditionId ? ' · current' : '') + '</option>').join('') + '</select></label><button data-action="prepare-current"' +
      disabled(record.imported || !S.status.currentMapId) + '>Prepare current Woo source</button><button data-action="reconcile"' + disabled(!plan || record.imported || !current) + '>Reconcile ERP</button></div>' +
      '<p class="erp-small">Mapping <code>' + edition.mapId + '</code> · Prepared ' + esc(edition.preparedAt) + '</p>';
    if (plan) {
      html += '<h3>Mapped order lines</h3><div class="erp-scroll"><table class="erp-table erp-lines-table"><thead><tr><th>Original Woo line</th><th>ERP inventory</th><th>Unit</th><th class="erp-number">Quantity</th><th class="erp-number">Unit price</th><th class="erp-number">Discount</th><th class="erp-number">Net</th><th>Tax / warehouse</th></tr></thead><tbody>' +
        plan.lines.map(line => '<tr><td><strong>' + esc(line.name) + '</strong><br><code>' + esc(line.sourceLineId) + '</code></td><td>' + esc(line.payload.InventoryID.value) + '</td><td>' + esc(line.payload.UOM.value) +
          '</td><td class="erp-number">' + esc(line.payload.OrderQty.value) + '</td><td class="erp-number">' + esc(line.payload.UnitPrice.value) + '</td><td class="erp-number">' + esc(line.payload.DiscountAmount.value) +
          '</td><td class="erp-number">' + esc(minor(line.netMinor,plan.expected.currencyDecimals)) + '</td><td>' + esc((line.payload.TaxCategory?.value || 'ERP default') + ' / ' + (line.payload.WarehouseID?.value || 'ERP default')) + '</td></tr>').join('') +
        '</tbody></table></div><p class="erp-small">Lines ' + esc(minor(plan.expected.netMinor,plan.expected.currencyDecimals)) + ' + tax ' + esc(minor(plan.expected.taxMinor,plan.expected.currencyDecimals)) + ' = ' +
        esc(plan.expected.currency + ' ' + minor(plan.expected.totalMinor,plan.expected.currencyDecimals)) + '. ' + esc(plan.rounding) + '</p>' +
        '<details><summary>Mapped customer, addresses and exact request</summary><pre>' + esc(json(plan.payload)) + '</pre></details>';
    } else html += issueList(edition.errors);
    html += sourceDifferences(record,edition);
    if (lookup) {
      html += '<div class="erp-section"><h3>Latest native ERP read</h3><p class="erp-small">' + esc(lookup.completedAt || lookup.startedAt) + ' · HTTP ' + esc(lookup.httpStatus ?? 'unavailable') + ' · ' +
        esc(lookup.matchCount === null ? 'No completed result' : lookup.matchCount + ' matching document(s)') + '</p>';
      if (lookup.comparison) html += diffTable(lookup.comparison.differences);
      if (lookup.matchCount > 1) html += '<pre>' + esc(json(lookup.candidates)) + '</pre>';
      if (lookup.document) html += '<details><summary>Current target document and line keys</summary><pre>' + esc(json(lookup.document)) + '</pre></details>';
      html += '</div>';
    }
    html += '<div class="erp-section"><h3>Operating decision</h3><label>Reason for approval or recovery<textarea id="erp-reason" maxlength="2000" placeholder="Describe the reviewed source, mapping and intended correction.">' + esc(S.reason) + '</textarea></label>';
    if (record.target && lookup?.documentSha256) html += '<label class="erp-check"><input id="erp-accept-baseline" type="checkbox"' + (S.acceptBaseline ? ' checked' : '') + '>Use the exact target shown in the latest read as the correction baseline.</label>' +
      '<p class="erp-small erp-muted">Coordinate edits to this ERP order during delivery. Its published write contract checks document existence and does not lock a document revision.</p>';
    html += '<div class="erp-actions"><button class="erp-primary" data-action="approve"' + disabled(!ready) + '>Approve shown edition</button><button class="erp-primary" data-action="deliver"' +
      disabled(!ready || state !== 'APPROVED') + '>Deliver approved edition</button>' + (record.imported ? '<button data-action="bind-import"' + disabled(false) + '>Bind original Woo source</button>' : '') + '</div>';
    if (record.pendingWrite || (lookup?.document && lookup.comparison && !lookup.comparison.matched)) {
      html += '<details class="erp-danger-zone"><summary>Resolve an interrupted or differing receipt</summary><p>Use the original ERP document and completed operation state to resolve this attempt. A search returning no rows alone does not show whether earlier processing has finished.</p>';
      if (record.pendingWrite) html += '<label>Completed ERP operation check<textarea id="erp-provider-outcome" maxlength="2000" placeholder="Record what the ERP operator or operation status showed.">' + esc(S.providerOutcome) +
        '</textarea></label><label class="erp-check"><input id="erp-confirm-ended" type="checkbox"' + (S.confirmOperationEnded ? ' checked' : '') + '>I checked that the original ERP processing has finished.</label>';
      if (lookup?.document && lookup.comparison && !lookup.comparison.matched) html += '<p>The shown target must match this original Woo order and contain only its owned line references. Its financial fields remain unaccepted until a corrected receiving read matches.</p><button data-action="identify-target"' + disabled(record.imported || !current) + '>Use shown target for correction</button>';
      if (record.pendingWrite && lookup?.matchCount === 0 && !record.target) html += '<label class="erp-check"><input id="erp-confirm-none" type="checkbox"' + (S.confirmNoOrder ? ' checked' : '') + '>No order was received by the completed original ERP operation.</label><button data-action="authorize-retry"' + disabled(record.imported || !current) + '>Record recovery and review retry</button>';
      html += '</details>';
    }
    html += '</div><div class="erp-section"><h3>Delivery history</h3>';
    if (!record.attempts.length) html += '<p>No ERP write has been attempted for this order.</p>';
    else html += '<div class="erp-scroll"><table class="erp-table"><thead><tr><th>Attempt</th><th>Edition</th><th>Original request</th><th>ERP response</th><th>Resolution</th><th></th></tr></thead><tbody>' +
      record.attempts.map((attempt,i) => '<tr><td>' + esc(attempt.type.toUpperCase()) + '<br><span class="erp-small">' + esc(attempt.startedAt) + '</span></td><td>' +
        esc(record.editions.find(e => e.id === attempt.editionId)?.number ?? '?') + '</td><td><code>' + esc(attempt.requestSha256.slice(0,16)) + '…</code></td><td>' + esc(attempt.response ? 'HTTP ' + (attempt.response.httpStatus ?? 'unavailable') : 'No completed response') +
        '</td><td>' + esc(attempt.resolution?.outcome || 'Unresolved') + '</td><td><button data-action="inspect-attempt" data-index="' + i + '">Inspect</button></td></tr>').join('') + '</tbody></table></div>';
    if (S.expandedAttempt !== null && record.attempts[S.expandedAttempt]) html += '<h3>Retained attempt ' + esc(record.attempts[S.expandedAttempt].id) + '</h3><pre>' + esc(json(record.attempts[S.expandedAttempt])) + '</pre>';
    const decisions = S.allDecisions ? record.decisions : record.decisions.slice(-20);
    html += '<details><summary>Operator decisions (' + record.decisions.length + ')</summary><div class="erp-scroll"><table class="erp-table"><thead><tr><th>UTC</th><th>Action</th><th>Operator</th><th>Reason</th></tr></thead><tbody>' +
      decisions.map(d => '<tr><td class="erp-small">' + esc(d.at) + '</td><td>' + esc(d.action) + '</td><td>' + esc(d.operatorId) + '</td><td>' + esc(d.reason) + '</td></tr>').join('') + '</tbody></table></div>' +
      (!S.allDecisions && record.decisions.length > 20 ? '<button data-action="all-decisions">Show complete decision history</button>' : '') + '</details></div></section>';
    return html;
  }
  function renderBindings(key) {
    const meta = TABLES[key], rows = S.draft[key], page = Math.max(1,Math.min(S.tablePages[key],Math.ceil(rows.length / 50) || 1));
    S.tablePages[key] = page;
    return '<section class="erp-section"><header><div><h3>' + meta.title + '</h3><p class="erp-small erp-muted">' + esc(meta.hint) + '</p></div><div class="erp-actions"><button type="button" data-action="add-row" data-table="' + key + '">Add row</button><button type="button" data-action="export-csv" data-table="' + key + '">Export CSV</button></div></header>' +
      '<div class="erp-scroll"><table class="erp-table erp-map-table"><thead><tr>' + meta.labels.map(label => '<th>' + esc(label) + '</th>').join('') + '<th></th></tr></thead><tbody>' +
      (rows.length ? rows.slice((page - 1) * 50,page * 50).map((row,index) => { const n = (page - 1) * 50 + index; return '<tr>' + meta.fields.map(field => '<td><input aria-label="' + esc(meta.title + ' row ' + (n + 1) + ' ' + field) + '" data-binding-table="' + key + '" data-row="' + n + '" data-field="' + field + '" value="' + esc(row[field] || '') + '"' + (['sourceKey','customerId','inventoryId','uom'].includes(field) ? ' required' : '') + '></td>').join('') +
        '<td><button type="button" data-action="remove-row" data-table="' + key + '" data-index="' + n + '">Remove</button></td></tr>'; }).join('') :
        '<tr><td colspan="' + (meta.fields.length + 1) + '">No bindings entered.</td></tr>') + '</tbody></table></div><div class="erp-pager"><span>' + rows.length + ' mappings · Page ' + page + ' of ' + Math.max(1,Math.ceil(rows.length / 50)) +
      '</span><button type="button" data-action="binding-prev" data-table="' + key + '"' + disabled(page <= 1) + '>Previous</button><button type="button" data-action="binding-next" data-table="' + key + '"' + disabled(page * 50 >= rows.length) + '>Next</button></div>' +
      '<label class="erp-file erp-small">Replace this table from CSV<input type="file" accept=".csv,text/csv" data-file="bindings" data-table="' + key + '"><small>Header: ' + meta.fields.join(',') + '. All rows stay in the saved revision.</small></label></section>';
  }
  function renderMapping() {
    const m = S.draft, t = m.target, selected = S.status.selectedMap;
    let html = '<section class="erp-card"><header><div><h2>Approved order mapping</h2><p class="erp-muted">Map source identities to existing ERP records and retain each reviewed revision.</p></div>' + badge(S.dirty ? 'Unsaved changes' : selected ? 'Retained mapping' : 'New mapping') +
      '</header><div class="erp-toolbar"><label>Load a retained revision<select id="erp-map-revision">' + mapOptions(S.status.currentMapId) + '</select></label><button data-action="load-map"' + disabled(!S.status.maps.length) + '>Load revision</button><button data-action="new-map"' + disabled(false) + '>New mapping</button></div>' +
      '<form id="erp-map-form" data-form="mapping"><div class="erp-grid">' + field('name','Mapping name',m.name,' required maxlength="120"') +
      field('storeNamespace','Stable store namespace',m.storeNamespace,' required maxlength="16" pattern="[A-Za-z][A-Za-z0-9_-]{0,15}"') + field('reviewOwner','Operating owner',m.reviewOwner,' required maxlength="160"') +
      field('currency','Order currency',m.currency,' required maxlength="3" pattern="[A-Z]{3}"') + field('currencyDecimals','Currency decimal places',m.currencyDecimals,' required type="number" data-number="1" min="0" max="4"') +
      field('unitPriceDecimals','Unit price decimal places',m.unitPriceDecimals,' required type="number" data-number="1" min="0" max="8"') +
      '<label>Address policy<select data-map-path="addressMode">' + options([['order_override','Use original Woo addresses'],['customer_default','Use existing ERP customer addresses']],m.addressMode) + '</select></label>' +
      '<div class="erp-wide"><label>Admitted Woo states</label><div class="erp-actions">' + ['pending','on-hold','processing','completed'].map(v => '<label class="erp-check"><input type="checkbox" data-status="' + v + '"' +
        (m.admittedStatuses.includes(v) ? ' checked' : '') + '>' + esc(v) + '</label>').join('') + '</div></div></div>' +
      '<section class="erp-section"><h3>Installed ERP connection</h3><p class="erp-muted erp-small">Select the exact application and environment reference registered by the WordPress administrator. Credential values stay in that environment.</p><div class="erp-grid">' +
      field('target.baseUrl','ERP application URL',t.baseUrl,' required type="url" maxlength="2048" placeholder="https://erp.example.com"') + field('target.endpoint','Endpoint name',t.endpoint,' required maxlength="64"') +
      field('target.version','Endpoint version',t.version,' required readonly') + field('target.tokenEnv','Credential environment reference',t.tokenEnv,' required maxlength="80"') +
      field('target.orderType','ERP order type',t.orderType,' required maxlength="2" pattern="[A-Za-z0-9]{2}"') + field('target.branch','Branch (optional)',t.branch,' maxlength="30"') +
      field('target.taxZone','Tax zone (optional)',t.taxZone,' maxlength="10"') + field('target.contractReference','Installed contract reference',t.contractReference,' required maxlength="2048"') +
      '<div><label class="erp-check"><input type="checkbox" data-map-path="target.hold"' + (t.hold ? ' checked' : '') + '>Receive the ERP order on hold</label><label class="erp-check"><input type="checkbox" data-map-path="target.allowLocal"' + (t.allowLocal ? ' checked' : '') +
      '>Administrator-approved loopback development</label></div></div></section>';
    for (const key of Object.keys(TABLES)) html += renderBindings(key);
    html += '<section class="erp-section"><h3>Shipping</h3><label class="erp-check"><input id="erp-shipping-enabled" type="checkbox"' + (m.shippingBinding ? ' checked' : '') + '>Map original Woo shipping lines to an ERP inventory item</label>';
    if (m.shippingBinding) html += '<div class="erp-grid">' + field('shippingBinding.inventoryId','ERP shipping inventory',m.shippingBinding.inventoryId,' required maxlength="30"') +
      field('shippingBinding.uom','Unit of measure',m.shippingBinding.uom,' required maxlength="6"') + field('shippingBinding.taxCategory','Shipping tax category',m.shippingBinding.taxCategory,' maxlength="10"') +
      field('shippingBinding.warehouseId','Warehouse',m.shippingBinding.warehouseId,' maxlength="30"') + '</div>';
    html += '</section><div class="erp-actions"><button type="submit" class="erp-primary"' + disabled(false) + '>Save and select revision</button><button type="button" data-action="check-map"' + disabled(S.dirty || !S.status.currentMapId) +
      '>Read installed contract</button><button type="button" data-action="export-map"' + disabled(false) + '>Export mapping JSON</button></div></form><section class="erp-section"><label>Load mapping JSON<input type="file" accept=".json,application/json" data-file="mapping"></label></section>';
    if (selected) {
      html += '<section class="erp-section"><h3>Selected installed contract</h3><p><code>' + esc(selected.id) + '</code></p>' +
        note('Connection registration: ' + (S.status.connectionAuthorized ? 'matched' : 'not registered') + '. Credential reference: ' + (S.status.credentialConfigured ? 'configured' : 'not configured') + '.');
      if (selected.check) html += badge(selected.check.usable ? 'Contract fields available' : 'Contract review required') + '<p class="erp-small">' + esc(selected.check.checkedAt) + ' · HTTP ' + esc(selected.check.httpStatus ?? 'unavailable') +
        ' · <code>' + esc(selected.check.schemaSha256 || '') + '</code></p>' + issueList(selected.check.issues) + (selected.check.transportError ? note(selected.check.transportError) : '');
      else html += '<p>Read this installed endpoint before approving its first delivery.</p>';
      html += '</section>';
    }
    return html + '</section>';
  }
  function renderHandoff() {
    const target = S.status.selectedMap?.mapping.target;
    const registration = [{baseUrl:target?.baseUrl || 'https://erp.example.com',tokenEnv:target?.tokenEnv || 'SF104_ERP_ACUMATICA_TOKEN'}];
    return '<section class="erp-card"><header><div><h2>Complete project handoff</h2><p class="erp-muted">A second operator reopens the original order, mapping, delivery attempts and receiving history.</p></div></header>' +
      (S.selected ? '<p>Selected project: <strong>' + esc(S.selected.record.externalReference) + '</strong> · Revision ' + S.selected.record.revision + '</p><button class="erp-primary" data-action="export-project"' + disabled(false) + '>Export complete selected project</button>' :
      note('Open an order in the queue to export its complete project.')) +
      '<ol class="erp-list"><li>Retain the original Woo database and plugin source, together with the ERP project export. The export includes source snapshots and customer data; it does not recreate Woo orders.</li>' +
      '<li>Install this plugin version in the receiving WordPress environment. Restore the original Woo order, register its ERP application, and configure its named credential.</li>' +
      '<li>Import the complete ERP project below. Existing live or divergent history is preserved. Reimporting the same saved project reopens its existing import.</li>' +
      '<li>Select the retained mapping in Mapping. Open the imported order, enter the operating reason, and bind its original Woo source.</li>' +
      '<li>Reconcile the actual ERP target. Continue any unresolved original attempt before approving a corrected edition or another delivery.</li></ol>' +
      '<label>Import complete ERP project<input type="file" accept=".json,application/json" data-file="project"><small>Maximum 16 MiB. All referenced mappings, source editions, attempts and decisions must be present.</small></label>' +
      '<section class="erp-section"><h3>Administrator connection setup</h3><p>Register approved ERP applications through the WordPress process environment. Set <code>SF104_ERP_CONNECTIONS</code> to the JSON below, and set the separately named token environment variable to the existing authorized bearer token.</p><pre>' +
      esc(json(registration)) + '</pre><p>For an explicitly selected loopback development connection, also set <code>SF104_ERP_ALLOW_LOOPBACK=1</code>. The mapping must select that same local connection. Production applications use HTTPS.</p>' +
      '<p class="erp-small">The command-line operator uses the existing WordPress application-password configuration. Run <code>node merchant-erp-cli.mjs help</code> from the installed source for the complete mapping, order, delivery and handoff commands.</p></section></section>';
  }
  function render() {
    root.querySelectorAll('[data-view]').forEach(button => { button.setAttribute('aria-current',button.dataset.view === S.view ? 'page' : 'false'); button.disabled = S.busy; });
    root.querySelectorAll('.erp-nav [data-action="refresh"]').forEach(button => { button.disabled = S.busy; });
    const message = document.getElementById('sf104-erp-message');
    message.innerHTML = S.message ? '<div class="erp-message" data-kind="' + esc(S.kind) + '">' + esc(S.message) + '</div>' : '';
    if (!S.status) { content.innerHTML = '<p>Reading the original ERP workspace…</p>'; return; }
    content.innerHTML = S.view === 'orders' ? renderOrders() : S.view === 'mapping' ? renderMapping() : renderHandoff();
    if (S.busy) root.querySelectorAll('button,input,select,textarea').forEach(control => { control.disabled = true; });
    document.getElementById('sf104-erp-observed').textContent = S.status.observedAt;
  }
  function captureMap() {
    const form = document.getElementById('erp-map-form'); if (!form) return;
    for (const input of form.querySelectorAll('[data-map-path]')) {
      const path = input.dataset.mapPath.split('.'); let object = S.draft;
      for (const key of path.slice(0,-1)) object = object[key];
      object[path.at(-1)] = input.type === 'checkbox' ? input.checked : input.dataset.number ? Number(input.value) : input.value;
    }
    for (const input of form.querySelectorAll('[data-binding-table]')) S.draft[input.dataset.bindingTable][Number(input.dataset.row)][input.dataset.field] = input.value;
    S.draft.admittedStatuses = [...form.querySelectorAll('[data-status]:checked')].map(input => input.dataset.status);
  }
  function download(name, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text],{type})), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function csvRead(text) {
    const rows = []; let row = [], value = '', quoted = false, closed = false;
    text = text.replace(/^\uFEFF/,'');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === '"') { if (text[i+1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } } else value += c; }
      else if (c === '"' && value === '' && !closed) quoted = true;
      else if (c === ',') { row.push(value); value = ''; closed = false; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(value); if (row.some(v => v !== '')) rows.push(row); row = []; value = ''; closed = false; }
      else { if (closed) throw Error('The CSV has text after a closing quote.'); value += c; }
    }
    if (quoted) throw Error('The CSV has an unclosed quoted field.');
    row.push(value); if (row.some(v => v !== '')) rows.push(row);
    return rows;
  }
  function draftFromFile(raw) {
    if (!raw || raw.schema !== 'stellar-forge.sf104.erp-map.v1' || !raw.target || !Array.isArray(raw.admittedStatuses) ||
        Object.keys(TABLES).some(key => !Array.isArray(raw[key]) || raw[key].length > 5000 || raw[key].some(row => !row || typeof row !== 'object' || Array.isArray(row)))) throw Error('Select a complete supported ERP mapping JSON file.');
    return raw;
  }
  async function prepareOrder(orderId, mapId, expectedRevision) {
    if (expectedRevision === undefined) {
      const found = await api('/orders?' + new URLSearchParams({q:orderId,page:'1',limit:'100'}));
      const row = found.orders.find(item => item.orderId === orderId);
      expectedRevision = row ? (await api('/orders/' + row.operationId)).record.revision : 0;
    }
    setSelected(await api('/prepare',{orderId,mapId,expectedRevision}));
    S.view = 'orders'; await queue(); S.message = 'The original Woo source and mapping are retained for review.'; S.kind = 'info';
  }
  root.addEventListener('input', event => {
    const input = event.target;
    if (input.closest('#erp-map-form')) { captureMap(); S.dirty = true; const check = root.querySelector('[data-action="check-map"]'); if (check) check.disabled = true; }
    if (input.id === 'erp-reason') S.reason = input.value;
    if (input.id === 'erp-provider-outcome') S.providerOutcome = input.value;
    if (input.id === 'erp-confirm-none') S.confirmNoOrder = input.checked;
    if (input.id === 'erp-confirm-ended') S.confirmOperationEnded = input.checked;
    if (input.id === 'erp-accept-baseline') S.acceptBaseline = input.checked;
  });
  root.addEventListener('change', event => {
    const input = event.target;
    if (input.id === 'erp-edition') { S.edition = input.value; S.acceptBaseline = false; render(); return; }
    if (input.id === 'erp-shipping-enabled') { captureMap(); S.draft.shippingBinding = input.checked ? blankBinding() : null; S.dirty = true; render(); return; }
    if (!input.dataset.file || !input.files?.[0]) return;
    const file = input.files[0], kind = input.dataset.file, key = input.dataset.table;
    busy(async () => {
      if (file.size > (kind === 'project' ? S.status.maxImportBytes : 2097152)) throw Error('The selected file exceeds its import size limit.');
      const text = await file.text();
      if (kind === 'mapping') { S.draft = draftFromFile(JSON.parse(text)); S.dirty = true; S.view = 'mapping'; }
      else if (kind === 'project') { setSelected(await api('/import',{project:JSON.parse(text)},60000)); S.view = 'orders'; await status(false); await queue(); S.message = 'The complete project is retained. Select its mapping and bind the original Woo source.'; }
      else {
        const rows = csvRead(text), fields = TABLES[key].fields, header = rows.shift()?.map(v => v.trim());
        if (!header || header.length !== fields.length || new Set(header).size !== fields.length || fields.some(field => !header.includes(field))) throw Error('Use exactly these CSV headers: ' + fields.join(','));
        if (rows.length > 5000 || rows.some(row => row.length !== header.length)) throw Error('The CSV requires consistent columns and at most 5,000 binding rows.');
        S.draft[key] = rows.map(row => Object.fromEntries(header.map((field,i) => [field,row[i]])));
        S.tablePages[key] = 1; S.dirty = true;
      }
      S.kind = 'info';
    });
  });
  root.addEventListener('submit', event => {
    const form = event.target.closest('[data-form]'); if (!form) return; event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form), kind = form.dataset.form;
    if (kind === 'mapping') captureMap();
    busy(async () => {
      if (kind === 'queue') { S.filter = {q:values.get('q').trim(),state:values.get('state'),page:1}; await queue(); }
      else if (kind === 'prepare') await prepareOrder(values.get('orderId').trim(),values.get('mapId'));
      else {
        const saved = await api('/maps',{mapping:S.draft,expectedCurrentMapId:S.status.currentMapId});
        await status(true); S.message = 'The mapping revision is saved and selected. Read its installed ERP contract before approval.'; S.kind = 'info';
      }
    });
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-view],button[data-action]'); if (!button || button.disabled) return;
    const view = button.dataset.view, action = button.dataset.action, table = button.dataset.table;
    if (view) { if (S.view === 'mapping') captureMap(); S.view = view; render(); if (view === 'orders' && !S.queue) busy(queue); return; }
    if (['add-row','remove-row','binding-prev','binding-next'].includes(action)) {
      captureMap();
      if (action === 'add-row') {
        if (S.draft[table].length >= 5000) { S.message = 'This mapping table already contains 5,000 rows.'; S.kind = 'error'; render(); return; }
        S.draft[table].push(Object.fromEntries(TABLES[table].fields.map(field => [field,field === 'uom' ? 'EA' : ''])));
        S.tablePages[table] = Math.ceil(S.draft[table].length / 50); S.dirty = true;
      } else if (action === 'remove-row') { S.draft[table].splice(Number(button.dataset.index),1); S.dirty = true; }
      else S.tablePages[table] += action === 'binding-prev' ? -1 : 1;
      render(); return;
    }
    if (action === 'inspect-attempt') { S.expandedAttempt = Number(button.dataset.index); render(); return; }
    if (action === 'all-decisions') { S.allDecisions = true; render(); return; }
    if (action === 'new-map') { S.draft = blankMap(); S.dirty = true; render(); return; }
    if (action === 'export-map') { captureMap(); download('woo-erp-mapping.json',json(S.draft) + '\n'); return; }
    if (action === 'export-csv') {
      captureMap(); const fields = TABLES[table].fields, quote = value => '"' + String(value ?? '').replaceAll('"','""') + '"';
      download('woo-erp-' + table + '.csv',[fields,...S.draft[table].map(row => fields.map(field => row[field]))].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n','text/csv'); return;
    }
    const mapToLoad = action === 'load-map' ? document.getElementById('erp-map-revision').value : null;
    busy(async () => {
      if (action === 'refresh') { await refresh(); return; }
      if (action === 'queue-prev' || action === 'queue-next') { S.filter.page += action === 'queue-prev' ? -1 : 1; await queue(); return; }
      if (action === 'open-order') { setSelected(await api('/orders/' + button.dataset.id)); S.reason = ''; S.providerOutcome = ''; return; }
      if (action === 'load-map') {
        if (!mapToLoad) throw Error('Select a retained mapping revision.');
        S.draft = copy((await api('/maps/' + mapToLoad)).mapping); S.dirty = mapToLoad !== S.status.currentMapId; return;
      }
      if (action === 'check-map') { await api('/maps/' + S.status.currentMapId + '/check',{},45000); await status(false); S.message = 'The installed contract read is retained with the selected mapping.'; S.kind = 'info'; return; }
      const record = S.selected?.record; if (!record) throw Error('Open the original order first.');
      if (action === 'export-project') {
        const project = await api('/orders/' + record.operationId + '/export',undefined,45000);
        download('woo-erp-' + record.orderId + '-r' + record.revision + '.json',json(project) + '\n'); return;
      }
      if (action === 'prepare-current') { await prepareOrder(record.orderId,S.status.currentMapId,record.revision); return; }
      const body = {expectedRevision:record.revision,editionId:record.currentEditionId};
      if (['approve','bind-import','identify-target','authorize-retry'].includes(action)) {
        if (!S.reason.trim()) throw Error('Enter the operating reason for this approval or recovery.');
        body.reason = S.reason.trim();
      }
      if (S.acceptBaseline && record.lastLookup?.documentSha256 && action === 'approve') body.targetBaselineSha256 = record.lastLookup.documentSha256;
      if (action === 'identify-target') {
        body.targetBaselineSha256 = record.lastLookup?.documentSha256;
        if (record.pendingWrite) { body.confirmOperationEnded = S.confirmOperationEnded; body.providerOutcome = S.providerOutcome.trim(); }
      }
      if (action === 'authorize-retry') {
        if (!S.confirmOperationEnded) throw Error('Check that the original ERP processing has finished.');
        body.confirmNoOrder = S.confirmNoOrder; body.providerOutcome = S.providerOutcome.trim();
      }
      setSelected(await api('/orders/' + record.operationId + '/' + action,body,75000)); await queue();
      S.message = 'Original order updated: ' + S.selected.record.state.replaceAll('_',' ') + '.'; S.kind = 'info';
    });
  });
  busy(async () => { await status(true); await queue(); });
})();
