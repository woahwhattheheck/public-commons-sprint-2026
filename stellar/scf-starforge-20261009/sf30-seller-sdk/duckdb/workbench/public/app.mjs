// MIT. Local operator UI; all source, query and merchant compilation stays native.
const $ = id => document.getElementById(id);
const token = location.hash.slice(1);
let state, draft, selected = null, selectedCursor = null, editing = -1, filters = [], order = [];
let relations = new Map(), nextCursor = null, editorDirty = false, dirty = false, busy = false, reviewed = null;
const clone = value => structuredClone(value);
const node = (tag, text, className) => {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
};
const notice = message => { $('notice').textContent = message; };
const identifier = value => {
  const result = value.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '').slice(0,40);
  return result && !['constructor','prototype'].includes(result.toLowerCase()) ? result : 'query';
};
function markDirty(editor = false) {
  dirty = true; editorDirty ||= editor; reviewed = null;
  $('save-state').textContent = 'Unsaved changes'; $('review-summary').replaceChildren();
  $('review-downloads').replaceChildren(); $('review-source').textContent = 'Review the current draft to see its native plan.';
}
async function api(path, value) {
  const result = await fetch('/api/' + path, { method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const data = await result.json();
  if (!result.ok) throw new Error(data.message ?? data.error ?? 'Request failed.');
  return data;
}
async function run(action, message = '') {
  if (busy) return;
  busy = true;
  const controls = new Map([...document.querySelectorAll('button,input,select,textarea')].map(item => [item,item.disabled]));
  for (const item of controls.keys()) item.disabled = true;
  notice(message);
  try { await action(); }
  catch (issue) { notice(issue.message); }
  finally { for (const [item,disabled] of controls) if (item.isConnected) item.disabled = disabled; busy = false; }
}
function field(labelText, input) {
  const label = node('label',labelText); label.append(input); return label;
}
function input(value = '', type = 'text') {
  const result = document.createElement('input'); result.type = type; result.value = value ?? ''; return result;
}
function select(values, value) {
  const result = document.createElement('select');
  for (const item of values) {
    const [key,label] = Array.isArray(item) ? item : [item,item], option = node('option',label);
    option.value = key; result.append(option);
  }
  result.value = value ?? (Array.isArray(values[0]) ? values[0][0] : values[0]) ?? '';
  return result;
}
function button(label, action, className) {
  const result = node('button', label, className); result.type = 'button'; result.addEventListener('click',action); return result;
}
function download(name, value, type = 'application/json') {
  const data = typeof value === 'string' ? value : JSON.stringify(value,null,2) + '\n';
  const url = URL.createObjectURL(new Blob([data],{type})), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
async function fileDownload(packageName, filename) {
  const result = await fetch('/api/export?package=' + encodeURIComponent(packageName) + '&file=' + encodeURIComponent(filename),
    {headers:{authorization:'Bearer ' + token}});
  if (!result.ok) throw new Error((await result.json()).message ?? 'Export failed.');
  download(filename.split('/').pop(), await result.text(), 'application/octet-stream');
}
function renderPayments() {
  const holder = $('payments'); holder.replaceChildren();
  draft.merchant.paymentOptions.forEach((payment,index) => {
    const card = node('div',undefined,'payment-card'), heading = node('div',undefined,'section-heading');
    heading.append(node('h3','Accepted option ' + (index+1)));
    if (draft.merchant.paymentOptions.length > 1) heading.append(button('Remove', () => {
      readMerchant(); draft.merchant.paymentOptions.splice(index,1); renderPayments(); markDirty();
    }));
    card.append(heading); const grid = node('div',undefined,'field-grid');
    for (const [key,label,type] of [['network','Network'],['scheme','Scheme'],['amount','Atomic amount'],
      ['asset','Token contract'],['payTo','Recipient'],['maxTimeoutSeconds','Timeout, seconds','number']]) {
      const control = key === 'network' ? select(['stellar:testnet','stellar:pubnet'], payment[key]) :
        key === 'scheme' ? select(['exact'], payment[key]) : input(payment[key],type);
      control.dataset.paymentField = key; control.dataset.paymentIndex = String(index);
      if (key === 'maxTimeoutSeconds') { control.min='1'; control.max='3600'; }
      if (['asset','payTo'].includes(key)) control.placeholder = 'Enter the merchant’s selected value';
      grid.append(field(label,control));
      control.addEventListener('input',() => { readMerchant(); markDirty(); });
    }
    card.append(grid); holder.append(card);
  });
}
function readMerchant() {
  draft.merchant.publicOrigin = $('public-origin').value.trim();
  for (const control of document.querySelectorAll('[data-payment-field]')) {
    const payment = draft.merchant.paymentOptions[Number(control.dataset.paymentIndex)];
    if (payment) payment[control.dataset.paymentField] = control.dataset.paymentField === 'maxTimeoutSeconds' ?
      Number(control.value) : control.value.trim();
  }
}
function renderRelations() {
  const text = $('relation-search').value.toLowerCase(), holder = $('relations'); holder.replaceChildren();
  for (const {relation,cursor} of relations.values()) {
    if (!(relation.name + ' ' + (relation.namespace ?? '')).toLowerCase().includes(text)) continue;
    const card = node('div',undefined,'small-card' + (selected?.id === relation.id ? ' selected' : ''));
    const action = button('',() => {
      commitEditor(); editing = -1; selectRelation(relation,cursor);
    });
    action.append(node('strong',relation.name), node('p',(relation.namespace ? relation.namespace + ' · ' : '') + relation.kind));
    if (relation.unavailable) action.disabled = true;
    card.append(action); holder.append(card);
  }
  $('more').hidden = !nextCursor;
}
async function loadCatalog(cursor = null) {
  const data = await api('catalog',{cursor});
  if (!cursor) relations.clear();
  for (const relation of data.relations) relations.set(relation.id,{relation,cursor:data.cursor});
  nextCursor = data.nextCursor; renderRelations();
  $('catalog-status').textContent = 'DuckDB ' + data.engineVersion + ' · ' + relations.size + ' of ' + data.totalRelations +
    ' relations · ' + data.source.approvedFileCount + ' approved files';
  return data;
}
function uniqueName(base) {
  const existing = new Set(draft.queries.map(item => item.author.queryName.toLowerCase()));
  let candidate=base,index=2; while (existing.has(candidate.toLowerCase())) candidate=base+'_'+index++;
  return candidate;
}
function clearEditor() {
  selected=null; selectedCursor=null; editing=-1; filters=[]; order=[]; editorDirty=false;
  $('relation-title').textContent='Select a relation'; $('relation-description').textContent='';
  for(const id of ['query-name','route-path','service-name','route-description']) $(id).value='';
  $('route-method').value='GET'; $('max-rows').value=100; $('max-bytes').value=524288; $('timeout').value=5000;
  for(const id of ['columns','filters','order','preview-inputs','preview-result']) $(id).replaceChildren();
  $('preview-summary').textContent=''; $('column-count').textContent='(0 selected)';
  $('remove-query').hidden=true; $('keep-query').textContent='Keep query in draft';
}
function selectRelation(relation,cursor,entry = null) {
  selected=relation; selectedCursor=cursor;
  const queryName=entry?.author.queryName ?? uniqueName(identifier(relation.name.replace(/\.parquet$/i,'')));
  $('relation-title').textContent=(relation.namespace ? relation.namespace + '.' : '') + relation.name;
  $('relation-description').textContent=relation.kind + ' · ' + relation.columns.length + ' inspected columns' +
    (relation.columnsTruncated ? ' · Additional columns exceed this metadata page.' : '');
  $('query-name').value=queryName; $('route-path').value=entry?.route.path ?? '/'+queryName.replaceAll('_','-');
  $('route-method').value=entry?.route.method ?? 'GET'; $('service-name').value=entry?.route.serviceName ?? queryName.slice(0,32);
  $('route-description').value=entry?.route.description ?? '';
  $('max-rows').value=entry?.author.maxRows ?? 100; $('max-bytes').value=entry?.author.maxBytes ?? 524288;
  $('timeout').value=entry?.author.timeoutMs ?? 5000;
  filters=clone(entry?.author.filters ?? []); order=clone(entry?.author.orderBy ?? []);
  if (!order.length) {
    const first=relation.columns.find(column=>column.parameter); if(first) order=[{column:first.name,direction:'asc'}];
  }
  const chosen=new Set(entry?.author.columns ?? []);
  $('columns').replaceChildren();
  for(const column of relation.columns) {
    const label=node('label',undefined,'column-choice'), check=input('','checkbox'); check.checked=chosen.has(column.name);
    check.dataset.column=column.name;
    const text=node('span',column.name); text.append(node('span',column.type + (column.nullable ? ' · nullable' : ''),'column-type'));
    label.append(check,text); $('columns').append(label);
    check.addEventListener('change',()=>{ markDirty(true); updateColumnCount(); });
  }
  renderFilters(); renderOrder(); renderPreviewInputs(); updateColumnCount(); renderRelations();
  $('remove-query').hidden=editing<0; $('keep-query').textContent=editing<0 ? 'Keep query in draft' : 'Update query in draft';
  editorDirty=false; $('preview-result').replaceChildren(); $('preview-summary').textContent='';
}
function updateColumnCount() {
  $('column-count').textContent='(' + document.querySelectorAll('[data-column]:checked').length + ' selected)';
}
function eligibleColumns() { return selected?.columns.filter(column=>column.parameter) ?? []; }
function operations(column) {
  const result=[['eq','Equals']], spec=column?.parameter;
  if(spec?.ordered) result.push(['min','At least'],['max','At most'],['gt','Greater than'],['lt','Less than']);
  if(spec?.prefix) result.push(['prefix','Starts with']); return result;
}
function renderFilters() {
  $('filters').replaceChildren();
  filters.forEach((filter,index)=>{
    const row=node('div',undefined,'filter-row'), fields=node('div',undefined,'row-fields');
    const column=select(eligibleColumns().map(item=>item.name),filter.column);
    const operation=select(operations(selected?.columns.find(item=>item.name===filter.column)),filter.operator);
    const parameter=input(filter.name);
    column.addEventListener('change',()=>{filter.column=column.value;filter.operator='eq';markDirty(true);renderFilters();renderPreviewInputs();});
    operation.addEventListener('change',()=>{filter.operator=operation.value;markDirty(true);renderPreviewInputs();});
    parameter.addEventListener('input',()=>{filter.name=parameter.value;markDirty(true);renderPreviewInputs();});
    fields.append(field('Column',column),field('Comparison',operation));
    row.append(fields,field('Buyer parameter',parameter),button('Remove filter',()=>{filters.splice(index,1);markDirty(true);renderFilters();renderPreviewInputs();}));
    $('filters').append(row);
  });
}
function renderOrder() {
  $('order').replaceChildren();
  order.forEach((item,index)=>{
    const row=node('div',undefined,'order-row'), fields=node('div',undefined,'row-fields');
    const column=select(eligibleColumns().map(value=>value.name),item.column), direction=select([['asc','Ascending'],['desc','Descending']],item.direction);
    column.addEventListener('change',()=>{item.column=column.value;markDirty(true);});
    direction.addEventListener('change',()=>{item.direction=direction.value;markDirty(true);});
    fields.append(field('Column',column),field('Order',direction));
    row.append(fields,button('Remove order column',()=>{order.splice(index,1);markDirty(true);renderOrder();})); $('order').append(row);
  });
}
function renderPreviewInputs() {
  const old=new Map([...document.querySelectorAll('[data-preview-param]')].map(item=>[item.dataset.previewParam,item.value]));
  $('preview-inputs').replaceChildren();
  for(const filter of filters) {
    const column=selected?.columns.find(item=>item.name===filter.column), spec=column?.parameter;
    if(!spec) continue;
    const control=spec.type==='boolean' ? select([['','Unrestricted'],['true','True'],['false','False']],old.get(filter.name)??'') : input(old.get(filter.name)??'');
    control.dataset.previewParam=filter.name; control.placeholder=String(spec.example)+' · leave blank to omit';
    $('preview-inputs').append(field(filter.name+' ('+column.type+')',control));
  }
}
function readEditor() {
  if(!selected) throw new Error('Select a relation first.');
  const previous=editing>=0 ? draft.queries[editing] : null;
  return {catalogCursor:selectedCursor,author:{relationId:selected.id,relationFingerprint:selected.fingerprint,
    queryName:$('query-name').value.trim(),columns:[...document.querySelectorAll('[data-column]:checked')].map(item=>item.dataset.column),
    orderBy:clone(order),filters:clone(filters),maxRows:Number($('max-rows').value),maxBytes:Number($('max-bytes').value),timeoutMs:Number($('timeout').value)},
    route:{...(previous?.route??{}),id:$('query-name').value.trim(),path:$('route-path').value.trim(),method:$('route-method').value,
      serviceName:$('service-name').value.trim(),description:$('route-description').value.trim()}};
}
function commitEditor(force=false) {
  if(!selected || !editorDirty && !force) return;
  const entry=readEditor();
  if(editing<0) {draft.queries.push(entry);editing=draft.queries.length-1;} else draft.queries[editing]=entry;
  editorDirty=false; markDirty(); renderQueries(); $('remove-query').hidden=false; $('keep-query').textContent='Update query in draft';
}
function renderQueries() {
  $('queries').replaceChildren(); $('query-empty').hidden=draft.queries.length>0;
  draft.queries.forEach((entry,index)=>{
    const card=node('div',undefined,'small-card'+(index===editing?' selected':''));
    const action=button('',()=>run(async()=>{
      commitEditor();
      if(!relations.has(entry.author.relationId)) await loadCatalog(entry.catalogCursor??null);
      const found=relations.get(entry.author.relationId);
      if(!found) throw new Error('The saved relation is unavailable. Refresh metadata and reselect it.');
      editing=index;selectRelation(found.relation,found.cursor,entry);renderQueries();
    }));
    action.append(node('strong',entry.author.queryName||'Unnamed query'),node('p',entry.route.method+' '+entry.route.path));
    card.append(action);$('queries').append(card);
  });
}
function renderPreview(result) {
  $('preview-result').replaceChildren();
  $('preview-summary').textContent=result.rowCount+' rows returned'+(result.truncated?' · More rows are available; continue with your key filter.':'');
  if(!result.rows.length) return;
  const table=node('table'), head=node('tr');
  for(const column of result.columns) head.append(node('th',column));
  const thead=node('thead');thead.append(head);table.append(thead);
  const body=node('tbody');
  for(const row of result.rows) {
    const line=node('tr');
    for(const column of result.columns) {
      const value=row[column];line.append(node('td',value===null?'null':typeof value==='object'?JSON.stringify(value):String(value??'')));
    }
    body.append(line);
  }
  table.append(body);$('preview-result').append(table);
}
function renderReview(data) {
  reviewed=data;const holder=$('review-summary');holder.replaceChildren();
  for(const route of data.review.routes) {
    const card=node('div',undefined,'small-card');card.append(node('strong',route.method+' '+route.url));
    card.append(node('p',route.columns.join(', ')+' · up to '+route.maxRows+' rows'));
    for(const option of route.paymentOptions) card.append(node('p',option.amount+' atomic units · '+option.network+' · '+option.asset+' → '+option.payTo));
    holder.append(card);
  }
  $('review-source').textContent=JSON.stringify({queries:data.source.queries,plan:data.plan},null,2);
  $('review-downloads').replaceChildren(button('Download merchant plan',()=>download('merchant-plan.json',data.plan)),
    button('Download OpenAPI',()=>download('seller-openapi.json',data.openapi)),button('Download source declaration',()=>download('source.json',data.source)));
}
function renderRuntime() {
  const runtime=state.runtime;$('runtime-label').textContent=runtime.state==='RUNNING'?runtime.package+' · '+runtime.mode:'Seller stopped';
  $('runtime-links').replaceChildren();$('stop').hidden=runtime.state!=='RUNNING';
  if(runtime.state==='RUNNING') for(const [label,url] of [['Developer page',runtime.docs],['Readiness',runtime.ready],['Operations',runtime.operations]]) {
    if(!url) continue;const a=node('a',label);a.href=url;a.target='_blank';a.rel='noreferrer';$('runtime-links').append(a);
  }
}
function renderPackages() {
  $('packages').replaceChildren();
  for(const item of state.packages) {
    const card=node('div',undefined,'package-card');card.append(node('h3',item.name),
      node('p',item.state+(item.datasetBytes?' · '+item.datasetBytes+' data bytes':'')+(item.createdAt?' · '+new Date(item.createdAt).toLocaleString():''),'muted'));
    const actions=node('div',undefined,'actions');
    if(['SAVED','RUNNING'].includes(item.state)) {
      actions.append(button('Inspect saved package',()=>run(async()=>{
        const result=await api('package',{name:item.name});
        const lines=node('div',undefined,'review-lines');lines.append(node('p','DuckDB '+result.manifest.nativePreflight.engineVersion+' · '+result.manifest.datasetBytes+' retained data bytes'));
        for(const route of result.review.routes)lines.append(node('p',route.method+' '+route.url+' · '+route.columns.join(', ')));
        card.querySelector('.review-lines')?.remove();card.append(lines);notice('Saved package reopened and checked.');
      },'Reopening saved package…')));
      if(item.state==='SAVED') actions.append(button('Start package',()=>run(async()=>{
        state=await api('start',{name:item.name});renderPackages();renderRuntime();notice('Merchant seller started.');
      },'Starting the original merchant seller…')));
      for(const [label,file] of [['OpenAPI','openapi.json'],['Client','client/seller-client.mjs'],['Client types','client/seller-client.d.mts'],['Plan','plan.json']])
        actions.append(button(label,()=>run(()=>fileDownload(item.name,file),'Preparing download…')));
    } else card.append(node('p','Retain this directory for inspection. Prepare a new version after correcting the reported source or filesystem issue.','muted'));
    card.append(actions);$('packages').append(card);
  }
}
function applyState(next,{reload=false}={}) {
  state=next;
  if(reload) {
    draft=clone(state.draft); clearEditor(); relations.clear(); nextCursor=null; reviewed=null;
    $('catalog-status').textContent='Inspect metadata to load the current relations.';
    $('review-summary').replaceChildren(); $('review-downloads').replaceChildren();
    $('review-source').textContent='Review the current draft to see its native plan.';
    $('public-origin').value=draft.merchant.publicOrigin??'';
    draft.merchant.paymentOptions??=[draft.merchant.payment];delete draft.merchant.payment;
    renderPayments();renderQueries();renderRelations();
  }
  dirty=false;$('save-state').textContent='Saved '+new Date(state.savedAt).toLocaleTimeString();
  $('source').textContent=state.source;$('workspace-path').textContent=state.workspace;
  $('native-mode').textContent=state.nativeEnabled?'This session uses the configured native facilitator. Starting a package makes its configured offer available through the original seller.':
    'This session serves native HTTP 402 offers. Start the workbench with the merchant’s selected facilitator to enable its native payment runtime.';
  renderPackages();renderRuntime();
}

$('refresh').addEventListener('click',()=>run(async()=>{commitEditor();await loadCatalog();notice('Actual source metadata loaded.');},'Inspecting the selected data source…'));
$('more').addEventListener('click',()=>run(()=>loadCatalog(nextCursor),'Loading the next metadata page…'));
$('relation-search').addEventListener('input',renderRelations);
$('new-query').addEventListener('click',()=>{commitEditor();clearEditor();renderQueries();renderRelations();notice('Choose a table, view or Parquet file.');});
$('add-filter').addEventListener('click',()=>{
  const column=eligibleColumns()[0];if(!column)return notice('Select a relation first.');
  filters.push({column:column.name,name:identifier(column.name)+'_'+(filters.length+1),operator:'eq'});markDirty(true);renderFilters();renderPreviewInputs();
});
$('add-order').addEventListener('click',()=>{
  const column=eligibleColumns().find(value=>!order.some(item=>item.column===value.name));
  if(!column||order.length>=4)return notice('Choose up to four distinct scalar ordering columns.');
  order.push({column:column.name,direction:'asc'});markDirty(true);renderOrder();
});
$('keep-query').addEventListener('click',()=>{try{commitEditor(true);notice('Query retained in the draft. Save the draft to retain it across restarts.');}catch(issue){notice(issue.message);}});
$('remove-query').addEventListener('click',()=>{if(editing>=0){draft.queries.splice(editing,1);clearEditor();markDirty();renderQueries();renderRelations();notice('Query removed from the current draft.');}});
$('preview').addEventListener('click',()=>run(async()=>{
  const query=readEditor(), input={};
  for(const item of document.querySelectorAll('[data-preview-param]'))if(item.value!=='')input[item.dataset.previewParam]=item.value;
  renderPreview(await api('preview',{query,input}));notice('Actual local query completed.');
},'Running the selected native query…'));
$('public-origin').addEventListener('input',()=>{readMerchant();markDirty();});
$('add-payment').addEventListener('click',()=>{readMerchant();draft.merchant.paymentOptions.push({scheme:'exact',network:'stellar:testnet',asset:'',payTo:'',amount:'',maxTimeoutSeconds:60});renderPayments();markDirty();});
$('save').addEventListener('click',()=>run(async()=>{
  commitEditor();readMerchant();applyState(await api('save',{draft,revision:state.revision}));notice('Draft saved.');
}));
$('reload').addEventListener('click',()=>run(async()=>{
  if(dirty&&!confirm('Replace unsaved changes with the saved draft?'))return;
  applyState(await api('state'),{reload:true});notice('Saved draft reopened.');
}));
$('review').addEventListener('click',()=>run(async()=>{commitEditor();readMerchant();renderReview(await api('review',{draft}));notice('Native merchant terms and query bindings compiled.');},'Reviewing the merchant draft…'));
$('prepare').addEventListener('click',()=>run(async()=>{
  if(editorDirty||dirty)throw new Error('Save the current draft before preparing a package.');
  const result=await api('prepare',{name:$('package-name').value.trim(),revision:state.revision});
  applyState(result);notice('Merchant package prepared at '+result.prepared.directory);
},'Copying approved data and preparing the native merchant package…'));
$('stop').addEventListener('click',()=>run(async()=>{state=await api('stop',{});renderPackages();renderRuntime();notice('Seller stopped and its native queries closed.');},'Draining the merchant seller…'));
for(const id of ['query-name','route-path','route-method','service-name','route-description','max-rows','max-bytes','timeout'])
  $(id).addEventListener('input',()=>markDirty(true));
if(!/^[a-f0-9]{64}$/.test(token))notice('Open the private launch URL printed by the workbench command.');
else await run(async()=>{applyState(await api('state'),{reload:true});notice('Workspace ready. Inspect metadata or reopen a saved query.');});
