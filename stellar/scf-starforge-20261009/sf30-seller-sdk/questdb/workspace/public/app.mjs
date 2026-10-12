const $ = id => document.getElementById(id);
const pretty = value => JSON.stringify(value, null, 2);
const split = text => text.split(',').map(value => value.trim()).filter(Boolean);
const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const state = { saved: null, source: { schema: 'stellar-forge.questdb-source.v1', endpointEnv: 'QUESTDB_ENDPOINT', queries: {} },
  merchant: null, payments: [], dirty: false, reportDirty: false, selectedReport: '', reportWindow: { start: 'from', end: 'to' }, windowParameters: {}, rawReport: false, catalogue: null, captures: null, offset: 0, product: null, offer: null };
const token = location.hash.slice(1);
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message ?? value.error ?? 'Workspace request failed');
  return value;
}
async function run(action) { try { await action(); } catch (issue) { notice(issue.message, true); } }
function on(id, action) { $(id).addEventListener('click', () => run(action)); }
function json(text, kind = 'object') {
  const value = JSON.parse(text || (kind === 'array' ? '[]' : '{}'));
  if (kind === 'array' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Enter a JSON ' + kind + '.');
  return value;
}
function options(target, values, selected) {
  target.replaceChildren(...values.map(({ value, label }) => { const item = el('option', label); item.value = value; return item; }));
  if (values.some(item => String(item.value) === String(selected))) target.value = selected;
}
function button(label, action) { const n = el('button', label); n.type = 'button'; n.addEventListener('click', () => run(action)); return n; }
function facts(target, entries) {
  const list = el('dl', undefined, 'facts');
  for (const [name, value] of entries) list.append(el('dt', name), el('dd', value === null || value === undefined ? '—' : String(value)));
  target.replaceChildren(list);
}
function details(value, title = 'Complete metadata') { const d = el('details'); d.append(el('summary', title), el('pre', pretty(value))); return d; }
function grid(headers, rows) {
  const wrap = el('div', undefined, 'table-wrap'), table = el('table'), head = el('thead'), line = el('tr'), body = el('tbody');
  for (const name of headers) line.append(el('th', name)); head.append(line);
  for (const row of rows) {
    const tr = el('tr');
    for (const value of row) {
      const td = el('td');
      if (value instanceof Node) td.append(value);
      else if (value === null) td.append(el('span', 'NULL', 'null'));
      else if (value === '') td.append(el('span', 'empty text', 'empty'));
      else td.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body); wrap.append(table); return wrap;
}
function rowsView(target, value) {
  const rows = value.rows ?? value.dataset ?? value.result?.rows ?? [];
  const columns = (value.columns ?? value.columnTypes ?? []).map(item => typeof item === 'string' ? item : item.name);
  const names = columns.length ? columns : rows[0] && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : [];
  target.replaceChildren();
  if (rows.length && names.length) target.append(grid(names, rows.slice(0, 100).map(row => Array.isArray(row) ? row : names.map(name => row[name]))));
  target.append(details(value));
}
function markDirty() { state.dirty = true; status(); }
function status() {
  $('revision').textContent = 'Saved revision ' + (state.saved?.revision ?? 0);
  $('draft-status').textContent = [state.dirty ? 'Source or terms edited' : 'Source and terms saved', state.reportDirty ? 'Report edits pending' : ''].filter(Boolean).join(' · ');
  $('source-summary').textContent = state.source.endpointEnv + ' · ' + Object.keys(state.source.queries ?? {}).length + ' reports';
}
function tab(name) {
  for (const n of document.querySelectorAll('nav [data-tab]')) n.setAttribute('aria-selected', String(n.dataset.tab === name));
  for (const n of document.querySelectorAll('.tab')) n.hidden = n.id !== name;
  if (name === 'captures') void run(refreshCaptures);
  if (name === 'products') void run(refreshProducts);
}
for (const n of document.querySelectorAll('nav [data-tab]')) n.addEventListener('click', () => tab(n.dataset.tab));
function authFields() {
  const kind = $('auth-kind').value;
  $('user-env').disabled = $('password-env').disabled = kind !== 'basic'; $('token-env').disabled = kind !== 'token';
}
function renderPayments() {
  $('payments').replaceChildren(...state.payments.map((choice, index) => {
    const row = el('tr');
    for (const key of ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds']) {
      const td = el('td'), input = el('input'); input.value = choice[key] ?? '';
      input.setAttribute('aria-label', key + ' for choice ' + index);
      input.addEventListener('input', () => { choice[key] = key === 'maxTimeoutSeconds' ? Number(input.value) : input.value;
        $('payment-json').value = pretty(state.payments); markDirty(); });
      td.append(input); row.append(td);
    }
    const td = el('td'); td.append(button('Remove', () => { state.payments.splice(index, 1); renderPayments(); markDirty(); })); row.append(td); return row;
  }));
  $('payment-json').value = pretty(state.payments);
}
function sourceFields(source, merchant) {
  $('endpoint-env').value = source.endpointEnv ?? 'QUESTDB_ENDPOINT';
  $('auth-kind').value = source.tokenEnv ? 'token' : source.userEnv || source.passwordEnv ? 'basic' : 'none';
  $('user-env').value = source.userEnv ?? 'QUESTDB_USER'; $('password-env').value = source.passwordEnv ?? 'QUESTDB_PASSWORD';
  $('token-env').value = source.tokenEnv ?? 'QUESTDB_TOKEN'; $('max-inflight').value = source.maxInFlight ?? 2;
  $('allow-local').checked = source.allowLocal === true; authFields();
  $('merchant-origin').value = merchant?.publicOrigin ?? ''; $('merchant-service').value = merchant?.serviceName ?? 'QuestDB datasets';
  $('merchant-description').value = merchant?.description ?? 'Versioned QuestDB time-series reports';
  state.payments = structuredClone(merchant?.paymentOptions ?? (merchant?.payment ? [merchant.payment] : [])); renderPayments();
  $('source-json').value = pretty(source); refreshReportOptions();
}
function currentSource() {
  const source = { ...state.source, schema: 'stellar-forge.questdb-source.v1', endpointEnv: $('endpoint-env').value.trim(),
    maxInFlight: Number($('max-inflight').value), allowLocal: $('allow-local').checked };
  delete source.userEnv; delete source.passwordEnv; delete source.tokenEnv;
  if ($('auth-kind').value === 'basic') { source.userEnv = $('user-env').value.trim(); source.passwordEnv = $('password-env').value.trim(); }
  if ($('auth-kind').value === 'token') source.tokenEnv = $('token-env').value.trim();
  return source;
}
function currentMerchant() {
  if (!$('merchant-origin').value.trim()) return null;
  const original = state.merchant ?? {};
  const value = { ...original, publicOrigin: $('merchant-origin').value.trim(), serviceName: $('merchant-service').value,
    description: $('merchant-description').value, tags: original.tags ?? ['questdb','dataset'] };
  delete value.payment; delete value.paymentOptions;
  if (original.payment && state.payments.length === 1) value.payment = structuredClone(state.payments[0]);
  else value.paymentOptions = structuredClone(state.payments);
  return value;
}
function refreshReportOptions(selected = $('report-select').value) {
  const values = Object.keys(state.source.queries ?? {}).map(name => ({ value: name, label: name }));
  options($('report-select'), values, selected); options($('product-query'), values, $('product-query').value || selected);
}
function install(saved, loadReport = true) {
  state.saved = saved; state.source = structuredClone(saved.source ?? { schema: 'stellar-forge.questdb-source.v1', endpointEnv: 'QUESTDB_ENDPOINT', queries: {} });
  state.merchant = structuredClone(saved.merchant); state.dirty = false;
  if (loadReport) { state.reportDirty = false; sourceFields(state.source, state.merchant); loadSelectedReport(); }
  $('environment').replaceChildren(grid(['Variable', 'Available'], (saved.environment ?? []).map(item => [item.name, item.configured ? 'Yes' : 'Missing at launch'])));
  $('history').replaceChildren(...(saved.history ?? []).map(item => button('Revision ' + item.revision + ' · ' + item.savedAt, async () => {
    const prior = await api('revisions/' + item.revision); state.source = structuredClone(prior.source); state.merchant = structuredClone(prior.merchant);
    sourceFields(state.source, state.merchant); loadSelectedReport(); markDirty(); notice('Revision ' + item.revision + ' loaded as a new draft.');
  })));
  refreshReportOptions(); status(); renderProducts();
}
async function saveSource() {
  const source = currentSource(), merchant = currentMerchant();
  const saved = await api('save', { expectedRevision: state.saved?.revision ?? 0, source, merchant });
  install(saved, false); $('source-json').value = pretty(state.source); notice('Saved source revision ' + saved.revision + '.'); return saved;
}
function requireSaved() {
  if (!state.saved?.revision || state.dirty || state.reportDirty) throw new Error('Save the current source and report edits before running this selection.');
  return state.saved.revision;
}
function kindFields() {
  const raw = state.rawReport;
  for (const input of document.querySelectorAll('#report-builder-panel input,#report-builder-panel select,#report-builder-panel textarea'))
    input.disabled = raw;
  $('compile-report').disabled = $('save-report').disabled = raw;
  $('raw-report-note').hidden = !raw;
  $('sample-fields').hidden = raw || $('report-kind').value !== 'sample';
  $('asof-fields').hidden = raw || $('report-kind').value !== 'asof';
  $('report-columns').disabled = raw || $('report-kind').value === 'sample';
  $('run-from').parentElement.hidden = $('run-to').parentElement.hidden = raw;
}
function reportSpec() {
  const kind = $('report-kind').value, timestampType = $('timestamp-type').value;
  if (!$('run-from').value.trim() || !$('run-to').value.trim()) throw new Error('Enter the From and To timestamps in Report parameter values before saving this report.');
  const report = { kind, table: $('report-table').value.trim(), timestamp: $('report-timestamp').value.trim(), timestampType,
    window: { ...state.reportWindow }, probe: runInput(), parameters: { ...json($('report-parameters').value), [state.reportWindow.start]: { ...state.windowParameters[state.reportWindow.start], type: timestampType }, [state.reportWindow.end]: { ...state.windowParameters[state.reportWindow.end], type: timestampType } },
    columns: split($('report-columns').value).map(value => {
      const parts = value.split('='), path = (parts[1] ?? parts[0]).trim(), side = path.startsWith('right.') ? 'right' : 'left';
      const column = path.replace(/^(left|right)\./, ''); return { name: (parts[1] ? parts[0] : column).trim(), column, side };
    }), filters: json($('report-filters').value, 'array'),
    maxRows: Number($('report-max-rows').value), maxBytes: Number($('report-max-bytes').value), timeoutMs: Number($('report-timeout').value) };
  if (kind === 'sample') report.timestampAlias = $('sample-timestamp-alias').value.trim();
  if (kind === 'sample') report.sample = { interval: $('sample-interval').value.trim(), keys: split($('sample-keys').value),
    fill: $('sample-fill').value, alignment: $('sample-alignment').value,
    aggregates: $('sample-aggregates').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(value => {
      const match = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(count|sum|avg|min|max|first|last)\(([^()]*)\)$/.exec(value);
      if (!match) throw new Error('Use alias=function(column) for each aggregate.');
      return { name: match[1], fn: match[2], ...(match[3].trim() ? { column: match[3].trim() } : {}) };
    }) };
  if (kind === 'asof') report.asof = { table: $('asof-table').value.trim(), timestamp: $('asof-timestamp').value.trim(),
    ...($('asof-timestamp-type').value ? { timestampType: $('asof-timestamp-type').value } : {}),
    ...($('asof-tolerance').value.trim() ? { tolerance: $('asof-tolerance').value.trim() } : {}), filters: json($('asof-filters').value, 'array'), keys: split($('asof-keys').value).map(value => {
      const [left,right] = value.split('=').map(item => item.trim()); return { left, right: right ?? left };
    }) };
  return report;
}
function loadSelectedReport(fresh = false) {
  const name = fresh ? '' : $('report-select').value, declaration = state.source.queries?.[name], report = declaration?.report;
  state.selectedReport = name; state.rawReport = Boolean(declaration && !report);
  state.reportWindow = report?.window ? { ...report.window } : { start: 'from', end: 'to' };
  state.windowParameters = Object.fromEntries(Object.values(state.reportWindow).filter(key => declaration?.parameters?.[key]).map(key => [key, structuredClone(declaration.parameters[key])]));
  if (fresh) $('report-select').value = '';
  $('report-name').value = name || 'trades_window'; $('report-kind').value = state.rawReport ? 'raw' : report?.kind ?? 'window';
  $('report-table').value = report?.table ?? 'trades'; $('report-timestamp').value = report?.timestamp ?? 'timestamp';
  $('timestamp-type').value = report?.timestampType ?? 'timestamp';
  $('report-columns').value = report?.columns?.map(item => (item.name !== item.column || item.side === 'right' ? item.name + '=' : '') +
    (item.side === 'right' ? 'right.' : '') + item.column).join(', ') ?? declaration?.columns?.join(', ') ?? 'timestamp, symbol, price, amount';
  const parameters = structuredClone(report?.parameters ?? declaration?.parameters ?? {});
  if (!state.rawReport) { delete parameters[state.reportWindow.start]; delete parameters[state.reportWindow.end]; }
  $('report-parameters').value = pretty(parameters); $('report-filters').value = pretty(report?.filters ?? []);
  $('sample-timestamp-alias').value = report?.timestampAlias ?? 'timestamp';
  $('sample-interval').value = report?.sample?.interval ?? '1m'; $('sample-keys').value = report?.sample?.keys?.join(', ') ?? 'symbol';
  $('sample-fill').value = report?.sample?.fill ?? 'none'; $('sample-alignment').value = report?.sample?.alignment ?? 'calendar';
  $('sample-aggregates').value = report?.sample?.aggregates?.map(item => item.name + '=' + item.fn + '(' + (item.column ?? '') + ')').join('\n') ?? 'trade_count=count()\nmean_price=avg(price)';
  $('asof-table').value = report?.asof?.table ?? 'trades'; $('asof-timestamp').value = report?.asof?.timestamp ?? 'timestamp';
  $('asof-timestamp-type').value = report?.asof?.timestampType ?? '';
  $('asof-keys').value = report?.asof?.keys?.map(item => item.left + '=' + item.right).join(', ') ?? 'symbol=symbol';
  $('asof-tolerance').value = report?.asof ? report.asof.tolerance ?? '' : '1s'; $('asof-filters').value = pretty(report?.asof?.filters ?? []);
  $('report-max-rows').value = report?.maxRows ?? declaration?.maxRows ?? 100;
  $('report-max-bytes').value = report?.maxBytes ?? declaration?.maxBytes ?? 1048576;
  $('report-timeout').value = report?.timeoutMs ?? declaration?.timeoutMs ?? 30000;
  if (declaration?.probe || fresh) {
    const values = structuredClone(declaration?.probe ?? {});
    $('run-from').value = state.rawReport ? '' : values[state.reportWindow.start] ?? '';
    $('run-to').value = state.rawReport ? '' : values[state.reportWindow.end] ?? '';
    if (!state.rawReport) { delete values[state.reportWindow.start]; delete values[state.reportWindow.end]; }
    $('run-input').value = pretty(values);
  }
  $('compiled-report').textContent = declaration ? pretty(declaration) : ''; kindFields(); state.reportDirty = false; status();
}
function runInput() { return { ...json($('run-input').value), ...(state.rawReport ? {} : { [state.reportWindow.start]: $('run-from').value.trim(), [state.reportWindow.end]: $('run-to').value.trim() }) }; }
async function download(path, filename) {
  const response = await fetch('/api/' + path, { headers: { authorization: 'Bearer ' + token } });
  if (!response.ok) { const value = await response.json(); throw new Error(value.error ?? 'Download failed'); }
  const url = URL.createObjectURL(await response.blob()), a = el('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function refreshCaptures() {
  state.captures = await api('captures?limit=20&offset=' + state.offset);
  const host = $('capture-list'); host.replaceChildren();
  for (const record of state.captures.items) {
    const card = el('article', undefined, 'capture-card'), title = el('h3', record.query); title.append(el('span', record.state, 'badge')); card.append(title);
    const info = el('div'); facts(info, [['Capture',record.id],['Source revision',record.revision],['Started',record.startedAt],
      ['Rows',record.manifest?.rowCount],['Completed',record.completedAt]]); card.append(info);
    if (record.error) card.append(el('p', record.error.message));
    const actions = el('div', undefined, 'actions');
    if (record.state === 'COMPLETE') for (const [name,file] of Object.entries(record.files)) actions.append(button(file.path, () => download('captures/' + record.id + '/files/' + name, file.path)));
    if (['INTERRUPTED','FAILED','CANCELLED'].includes(record.state)) actions.append(button('Recover completed native files',async()=>{await api('capture/recover',{id:record.id});await refreshCaptures();}));
    if (record.state === 'CAPTURING') actions.append(button('Cancel capture', async () => { await api('capture/cancel', { id: record.id }); await refreshCaptures(); }));
    actions.append(button('Select for receiving', () => { $('receive-command').textContent = 'questdb-workbench receive --capture ' + record.id + ' --directory /absolute/customer-edition'; }));
    card.append(actions, details(record)); host.append(card);
  }
  if (!state.captures.items.length) host.append(el('p','Capture a saved report to retain its complete source edition.','empty-state'));
  const complete = state.captures.items.filter(item => item.state === 'COMPLETE').map(item => ({ value:item.id, label:item.query + ' · ' + item.startedAt }));
  options($('compare-before'), complete, $('compare-before').value || complete[1]?.value);
  options($('compare-after'), complete, $('compare-after').value || complete[0]?.value);
  $('captures-prev').disabled = state.offset === 0; $('captures-next').disabled = state.captures.nextOffset === null;
}
function renderProducts() {
  $('products-list').replaceChildren(...(state.saved?.publications ?? []).map(item => {
    const card = el('article',undefined,'capture-card'); card.append(el('h3',item.query),el('p',item.path),
      button('Open product',async()=>{state.product=await api('publications/'+item.id);state.offer=null;renderProduct();}));return card;
  }));
}
async function refreshProducts() { state.saved = await api('state'); renderProducts(); if (state.product) await refreshProduct(); }
async function refreshProduct() { state.product = await api('publications/'+state.product.id); renderProduct(); }
function renderProduct() {
  const product=state.product;if(!product)return;$('selected-product').hidden=false;$('product-title').textContent=product.query;
  $('publisher-link').href=product.consoleUrl;facts($('product-facts'),[['Resource',product.merchant.publicOrigin+product.path],['Saved source revision',product.revision],
    ['Seller',product.seller?.origin??'Stopped'],['Scheduler',product.schedule?.enabled?'Enabled':'Paused'],['Product',product.id]]);
  const runs=product.status.runs??[]; $('product-runs').replaceChildren(grid(['Run','State','Action'],runs.map(item=>[item.id,item.state,
    button('Inspect',async()=>{const result=await api('publications/'+product.id+'/run?runId='+encodeURIComponent(item.id));$('product-runs').append(details(result,'Run '+item.id));})])));
  options($('buyer-run'),runs.filter(item=>['PUBLISHED','READY'].includes(item.state)).map(item=>({value:item.id,label:item.id+' · '+item.state})),$('buyer-run').value);
  if(!$('buyer-intent').value)$('buyer-intent').value='questdb-'+crypto.randomUUID();
}
on('reload',async()=>{install(await api('state'));notice('Loaded the saved source and merchant terms.');});
on('save-source',saveSource);
on('add-payment',()=>{state.payments.push({scheme:'exact',network:'',asset:'',amount:'',payTo:'',maxTimeoutSeconds:60});renderPayments();markDirty();});
on('apply-payments',()=>{state.payments=json($('payment-json').value,'array');renderPayments();markDirty();});
on('apply-source-json',()=>{state.source=json($('source-json').value);sourceFields(state.source,currentMerchant());loadSelectedReport();markDirty();});
for(const name of ['endpoint-env','auth-kind','user-env','password-env','token-env','max-inflight','allow-local','merchant-origin','merchant-service','merchant-description'])
  $(name).addEventListener('input',()=>{authFields();markDirty();});
on('discover',async()=>{const result=await api('catalogue',{expectedRevision:requireSaved(),...($('discovery-tables').value.trim()?{tables:split($('discovery-tables').value)}:{})});
  state.catalogue=result.catalogue;const entries=Array.isArray(result.catalogue.tables)?result.catalogue.tables:[];$('catalogue').replaceChildren();
  if(entries.length)$('catalogue').append(grid(['Table','Timestamp','Partition'],entries.map(item=>[item.table??item.name??item.table_name,item.timestamp??item.designatedTimestamp??item.timestampName??'',item.partitionBy??item.partition??''])));
  $('catalogue').append(details(result.catalogue,'Native table and column metadata'));notice('Native catalogue captured.');});
$('report-select').addEventListener('change',()=>{if(state.reportDirty){$('report-select').value=state.selectedReport;notice('Save or keep a copy of the report draft before switching reports.',true);return;}loadSelectedReport();});
on('new-report',()=>{loadSelectedReport(true);state.reportDirty=true;status();});
on('remove-report',()=>{delete state.source.queries[$('report-select').value];refreshReportOptions();loadSelectedReport();markDirty();});
for(const n of document.querySelectorAll('#report-builder-panel input,#report-builder-panel select,#report-builder-panel textarea'))
  n.addEventListener('input',()=>{state.reportDirty=true;kindFields();status();});
on('compile-report',async()=>{$('compiled-report').textContent=pretty(await api('report/compile',{report:reportSpec()}));notice('Compiled the report using native QuestDB rules.');});
on('save-report',async()=>{const name=$('report-name').value.trim();if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))throw new Error('Use a report name containing letters, digits and underscores.');
  const declaration=await api('report/compile',{report:reportSpec()});state.source.queries??={};state.source.queries[name]=declaration;state.reportDirty=false;markDirty();await saveSource();refreshReportOptions(name);loadSelectedReport();$('compiled-report').textContent=pretty(declaration);});
on('preview',async()=>{const result=await api('sample',{expectedRevision:requireSaved(),query:$('report-select').value,input:runInput()});rowsView($('preview-result'),result.sample);notice('Preview returned from the saved report.');});
on('capture',async()=>{const result=await api('capture',{expectedRevision:requireSaved(),query:$('report-select').value,input:runInput(),captureId:'capture-'+Date.now()+'-'+crypto.randomUUID(),includeNativeCsv:$('native-csv').checked,
    extraction:{maxRows:Number($('capture-max-rows').value),maxBytes:Number($('capture-max-bytes').value),timeoutMs:Number($('capture-timeout').value)}});
  tab('captures');await refreshCaptures();notice('Capture '+result.id+' started.');});
on('refresh-captures',refreshCaptures);on('captures-prev',async()=>{state.offset=Math.max(0,state.offset-20);await refreshCaptures();});
on('captures-next',async()=>{if(state.captures.nextOffset!==null){state.offset=state.captures.nextOffset;await refreshCaptures();}});
on('compare',async()=>{const result=await api('captures/compare',{before:$('compare-before').value,after:$('compare-after').value,keys:split($('compare-keys').value)});
  const host=$('comparison');facts(host,Object.entries(result.counts));host.append(el('p',result.sameSelection?'Both editions use the same named report and parameter values.':'The report selection or parameter values differ between these editions.'));
  for(const name of ['added','removed','changed'])if(result[name].length){host.append(el('h3',name[0].toUpperCase()+name.slice(1)+' · first '+result[name].length),grid(['Identity','Earlier row','Later row'],result[name].map(row=>[row.key,row.before??null,row.after??null])));}
  host.append(details(result));notice('Compared every retained row.');});
on('refresh-products',refreshProducts);on('refresh-product',refreshProduct);
on('create-product',async()=>{state.product=await api('publications',{expectedRevision:requireSaved(),query:$('product-query').value,path:$('product-path').value.trim()});
  await refreshProducts();renderProduct();notice('Created the original dataset publication.');});
on('start-seller',async()=>{state.product=await api('publications/'+state.product.id+'/seller/start',{});renderProduct();});
on('stop-seller',async()=>{state.product=await api('publications/'+state.product.id+'/seller/stop',{});renderProduct();});
on('read-offer',async()=>{const offer=await api('publications/'+state.product.id+'/buyer?runId='+encodeURIComponent($('buyer-run').value)+'&query='+encodeURIComponent($('buyer-query').value));state.offer=offer;
  options($('buyer-option'),offer.accepts.map((choice,index)=>({value:String(index),label:index+' · '+choice.network+' · '+choice.amount})),'0');$('buyer-result').replaceChildren(details(offer,'Exact customer offer'));});
on('prepare-buyer',async()=>{if(!state.offer)throw new Error('Read the exact buyer offer first.');const result=await api('publications/'+state.product.id+'/buyer',{
  runId:$('buyer-run').value,query:$('buyer-query').value,intentId:$('buyer-intent').value,acceptIndex:Number($('buyer-option').value),offerSha256:state.offer.offerSha256});
  $('buyer-result').replaceChildren(details(result,'Prepared customer request'),button('Download customer request',()=>download('files/buyer/'+state.product.id+'/'+result.id,'QuestDB-Dataset-Buyer-'+result.id+'.json')));});
for(const name of ['buyer-run','buyer-query'])$(name).addEventListener('input',()=>{state.offer=null;});
window.addEventListener('beforeunload',event=>{if(state.dirty||state.reportDirty){event.preventDefault();event.returnValue='';}});
setInterval(()=>{if(!document.hidden&&!$('captures').hidden&&state.captures?.items.some(item=>item.state==='CAPTURING'))void run(refreshCaptures);},3000);
await run(async()=>{install(await api('state'));notice('Opened the original workbench.');});
