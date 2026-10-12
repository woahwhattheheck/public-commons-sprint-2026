// MIT. Industrial registry console over the single original retained workspace.
import { createPublisherPanel } from '/publisher.mjs';

const $ = id => document.getElementById(id);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2);
const text = value => value === null || value === undefined ? '—' : typeof value === 'object' ? json(value) : String(value);
const short = value => value ? String(value).slice(0, 14) : '—';
const number = value => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString('en-US') : '—';
const node = (tag, content, className) => {
  const out = document.createElement(tag);
  if (content !== undefined) out.textContent = text(content);
  if (className) out.className = className;
  return out;
};
const storageKey = 'clinicaltrials:' + location.origin;
let token = location.hash.slice(1);
if (token.startsWith('token=')) token = token.slice(6);
if (token) { sessionStorage.setItem(storageKey + ':token', token); history.replaceState(null, '', location.pathname + location.search); }
else token = sessionStorage.getItem(storageKey + ':token') || '';
let model = null, busy = false, selectedSection = 'cohort', captureLoop = false, stopCapture = false;
let pending = null;
try { pending = JSON.parse(sessionStorage.getItem(storageKey + ':pending') || 'null'); } catch {}
let selectedStudy = null, studyPage = null, studySequence = 0, loadedCaptureId = null;
let activePlan = null, planDirty = false, cohortDirty = false, merchantDirty = false;
let inventory = null, inventoryOffset = 0, comparison = null, comparisonOffset = 0;
let queryResult = null, querySelection = null, currentPrs = null;
const contracts = ['clinicaltrials-openapi.yaml','ProtocolRecordSchema.xsd','RRSUploadSchema.xsd','source-contracts.json','api-contract.json'];

function notice(message, kind = '') {
  $('notice').textContent = message; $('notice').className = 'notice ' + kind; $('notice').hidden = !message;
}
function facts(target, entries) {
  target.replaceChildren();
  const list = node('dl');
  for (const [label, value] of entries) list.append(node('dt',label),node('dd',value));
  target.append(list);
}
function options(id, items, preferred) {
  const control = $(id), previous = control.value;
  control.replaceChildren();
  for (const [value,label] of items) { const item = node('option',label); item.value = value; control.append(item); }
  if (!items.length) { const item = node('option','No retained selection'); item.value = ''; control.append(item); }
  const choice = preferred ?? previous;
  control.value = items.some(([value]) => value === choice) ? choice : items[0]?.[0] || '';
}
function table(target, headers, rows, empty = 'No retained records yet.') {
  target.replaceChildren();
  if (!rows.length) { target.append(node('p',empty,'empty')); return; }
  const t = node('table'), head = node('thead'), hr = node('tr'), body = node('tbody');
  for (const label of headers) hr.append(node('th',label)); head.append(hr);
  for (const row of rows) {
    const tr = node('tr');
    for (const value of row) { const td = node('td'); td.append(value instanceof Node ? value : node('span',value)); tr.append(td); }
    body.append(tr);
  }
  t.append(head,body); target.append(t);
}
function button(label, action) {
  const control = node('button',label); control.type = 'button';
  control.addEventListener('click',() => handle(action)); return control;
}
function details(label,value) {
  const result = node('details'); result.append(node('summary',label),node('pre',json(value))); return result;
}
function savePending(value) {
  pending = value;
  if (value) sessionStorage.setItem(storageKey + ':pending',JSON.stringify(value));
  else sessionStorage.removeItem(storageKey + ':pending');
}
async function api(path, options = {}) {
  const response = await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...(options.headers || {})}});
  let value;
  const type = response.headers.get('Content-Type') || '';
  if (type.includes('application/json')) value = await response.json();
  else value = {error:await response.text()};
  if (!response.ok) {
    const error = new Error(value.error || value.message || 'The original request failed.');
    error.received = true; error.status = response.status;
    if (response.status === 403) $('connection').hidden = false;
    throw error;
  }
  return value;
}
function params(values) { return new URLSearchParams(Object.entries(values).filter(([,v]) => v !== undefined && v !== null)).toString(); }
async function refresh() {
  if (!token) { $('connection').hidden = false; return; }
  model = await api('/api/state'); $('connection').hidden = true; render();
}
async function reconcile() {
  if (!pending) return;
  const result = await api('/api/clinical/operation?' + params({requestId:pending.requestId}));
  if (result.state) model = result.state;
  pending.outcome = result; savePending(pending);
  $('pending-details').textContent = json(pending);
  if (result.status === 'COMPLETE') {
    savePending(null); notice('The original operation completed and its retained result is reconciled.');
  } else if (result.status === 'FAILED') {
    savePending(null); notice(result.error || 'The original operation returned an error. Review the current state.','error');
  } else if (result.status === 'RUNNING') notice('The same original operation is still running. Read its status again when ready.');
  else if (result.status === 'INTERRUPTED') notice('The previous process ended during this operation. Review the retained records before continuing.','error');
  else notice('No completed operation is recorded for this request. Review the current state before creating a new action.');
  render();
}
async function perform(action, payload = {}) {
  if (busy) throw new Error('The current original operation is still running.');
  if (pending) throw new Error('Reconcile the retained request before starting another action.');
  if (!model) throw new Error('Open the original workspace first.');
  const request = {action,payload,expectedRevision:model.revision,requestId:crypto.randomUUID()};
  savePending(request); busy = true; controls();
  try {
    const response = await api('/api/clinical/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    model = response.state; savePending(null); render();
    return response.result;
  } catch (error) {
    if (error.received) {
      try {
        const result = await api('/api/clinical/operation?' + params({requestId:request.requestId}));
        if (result.state) model = result.state;
        if (['FAILED','COMPLETE','UNKNOWN'].includes(result.status)) savePending(null);
        else { pending.outcome = result; savePending(pending); }
      } catch {}
    }
    throw error;
  } finally { busy = false; render(); }
}
async function upload(path, file, extra = {}) {
  if (busy || pending) throw new Error('Finish or reconcile the current original operation first.');
  if (!file) throw new Error('Choose the original file.');
  const request = {action:path.endsWith('restore')?'package.import':'prs.import',requestId:crypto.randomUUID(),
    expectedRevision:model.revision,upload:{name:file.name,bytes:file.size}};
  savePending(request); busy = true; controls();
  try {
    const response = await api(path,{method:'POST',headers:{
      'Content-Type':'application/octet-stream','X-Request-Id':request.requestId,
      'X-Expected-Revision':String(request.expectedRevision),'X-Clinical-Name':encodeURIComponent(file.name),...extra},body:file});
    model = response.state; savePending(null); render(); return response.result;
  } catch (error) {
    if (error.received) {
      try {
        const result = await api('/api/clinical/operation?'+params({requestId:request.requestId}));
        if (result.state) model = result.state;
        if (['FAILED','COMPLETE','UNKNOWN'].includes(result.status)) savePending(null);
        else { pending.outcome = result; savePending(pending); }
      } catch {}
    }
    throw error;
  } finally { busy = false; render(); }
}
async function download(path, filename) {
  const response = await fetch(path,{headers:{Authorization:'Bearer '+token}});
  if (!response.ok) {
    let problem; try { problem = await response.json(); } catch {}
    throw new Error(problem?.error || 'The retained download failed.');
  }
  const data = await response.blob();
  const matched = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '');
  const name = filename || matched?.[1] || 'retained-file';
  const url = URL.createObjectURL(data), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),15000);
}
async function handle(action) {
  try { await action(); } catch (error) { notice(error.message || String(error),'error'); }
}
function form(id, callback) { $(id).addEventListener('submit',event => { event.preventDefault(); handle(callback); }); }
function selectSection(name) {
  selectedSection = name;
  document.querySelectorAll('[data-panel]').forEach(element => { element.hidden = element.dataset.panel !== name; });
  document.querySelectorAll('[data-section]').forEach(element => {
    if (element.dataset.section === name) element.setAttribute('aria-current','page'); else element.removeAttribute('aria-current');
  });
  if (name === 'studies' && model?.capture && loadedCaptureId !== model.capture.id) handle(() => readStudies(0));
}
const publisherPanel = createPublisherPanel({
  getState:() => model, perform,
  download:(kind,id) => download('/api/clinical/publisher-export?'+params({kind,id})),
  handle,notice,selectSection,
});
function controls() {
  const locked = !model || busy || !!pending;
  document.querySelectorAll('[data-write]').forEach(control => { control.disabled = locked; });
  const status = model?.capture?.status;
  $('capture-page').disabled = locked || status !== 'running';
  $('capture-complete').disabled = locked || !['running','paused','error','starting'].includes(status);
  $('capture-resume').disabled = locked || !['paused','error','starting'].includes(status);
  $('capture-pause').disabled = !captureLoop && (locked || status !== 'running');
  $('capture-start').disabled = locked || !model?.configuration;
  $('edition-build').disabled = locked || status !== 'completed' || !model?.activePlan;
  $('package-export').disabled = locked || !model?.activeBuild;
  $('query-next').disabled = locked || !queryResult?.body?.page?.nextCursor;
  $('restore-submit').disabled = locked || !!model?.sources?.length;
  $('pending').hidden = !pending || busy;
  if (pending) {
    $('pending-summary').textContent = pending.action + ' · ' + (pending.outcome?.status || 'Response needs reconciliation');
    $('pending-details').textContent = json(pending);
    $('pending-clear').disabled = pending.outcome?.status === 'RUNNING' || !pending.outcome;
  }
  publisherPanel.controls(locked);
}
function renderCohort() {
  const config = model.configuration, c = model.capture;
  if (config && !cohortDirty) {
    $('cohort-name').value = config.name; $('cohort-lead').value = config.query['query.lead'] || '';
    $('cohort-condition').value = config.query['query.cond'] || ''; $('cohort-term').value = config.query['query.term'] || '';
    $('cohort-results').value = config.query.aggFilters || ''; $('cohort-sort').value = config.query.sort || '';
    $('cohort-page-size').value = config.pageSize; $('cohort-markup').value = config.markupFormat;
    $('cohort-max-studies').value = config.maxStudies; $('cohort-max-bytes').value = config.maxBytes / (1024*1024);
    const standard = new Set(['query.lead','query.cond','query.term','aggFilters','sort']);
    $('cohort-advanced').value = json(Object.fromEntries(Object.entries(config.query).filter(([k]) => !standard.has(k))));
  }
  $('query-contract').textContent = json(model.contract);
  options('capture-select',model.captures.map(v => [v.id,v.configuration.name+' · '+v.status+' · '+number(v.rowCount)+' studies']),c?.id);
  facts($('capture-summary'),[
    ['Status',c?.status || 'No capture selected'],['Captured studies',c?.rowCount],
    ['Provider total',c?.expectedRows],['Retained pages',c?.pageCount],
    ['Provider data timestamp, UTC',c?.version?.dataTimestamp],['Source bytes',c?.byteCount],
  ]);
  $('capture-progress').textContent = c?.error || (captureLoop ? 'Capturing the original page chain. Pause stops before the next request.' :
    c?.status === 'completed' ? 'Complete original cohort is ready for whole-study review and native mapping.' : '');
}
function renderSelectors() {
  const captures = model.captures.map(c => [c.id,c.configuration.name+' · '+c.createdAt+' · '+c.rowCount+' studies']);
  options('study-before',captures); options('study-after',captures,model.capture?.id);
  const builds = model.builds.map(b => [b.id,(b.name || b.id.slice(0,14))+' · '+b.rowCount+' rows · '+short(b.native?.snapshot)]);
  options('query-build',builds,querySelection?.buildId || model.activeBuild);
  options('edition-before',builds); options('edition-after',builds,model.activeBuild);
  options('mapping-select',model.plans.map(p => [p.id,(p.name || short(p.id))+' · '+short(p.id)]),activePlan?.id || model.activePlan);
  options('prs-documents',model.prs.map(p => [p.id,p.name+' · '+(p.report.schemaValid?'Schema valid':'Review schema errors')]),currentPrs?.record.id);
  options('prs-plans',model.prsPlans.map(p => [p.id,short(p.id)+' · '+p.reviewer]));
  options('prs-reconciliations',model.prsReconciliations.map(p => [p.id,short(p.id)+' · '+number(p.studies)+' studies']));
  options('export-select',model.exports.map(e => [e.id,e.createdAt+' · '+e.rowCount+' rows · '+short(e.snapshot)]));
}
function renderEditions() {
  table($('editions-table'),['Edition','Rows','Source','Mapping','Native snapshot','Actions'],model.builds.map(b => [
    short(b.id),number(b.rowCount),short(b.source),short(b.plan),short(b.native?.snapshot),
    button('Open native query',() => { querySelection={buildId:b.id}; $('query-build').value=b.id; selectSection('query'); }),
  ]));
}
function renderPrs() {
  const report = model.runtime?.prs;
  $('prs-runtime').textContent = report?.error || 'Original PRS validation and reviewed transformation use the retained official schema closure.';
  if (currentPrs) facts($('prs-document-summary'),[
    ['Document',currentPrs.record.name],['Schema',currentPrs.record.report.schemaKind],
    ['Schema validation',currentPrs.record.report.schemaValid?'Valid':'Review original findings'],
    ['Original bytes',currentPrs.record.report.bytes],['Legacy occurrences',currentPrs.record.report.legacyElements?.length ?? 'See report'],
  ]);
}
function renderMerchant() {
  const m = model.merchant;
  if (m && !merchantDirty) {
    for (const [id,value] of Object.entries({'merchant-origin':m.origin,'merchant-path':m.path,
      'payment-scheme':m.payment.scheme,'payment-network':m.payment.network,'payment-asset':m.payment.asset,
      'payment-amount':m.payment.amount,'payment-timeout':m.payment.maxTimeoutSeconds,'payment-recipient':m.payment.payTo}))
      $(id).value = value;
  }
  $('merchant-summary').textContent = m ? 'Validated original offer: '+m.origin+m.path+' · '+m.payment.amount+' atomic units per original request.' : 'Save the actual operator-selected terms before preparing seller and customer files.';
}
function renderExport() {
  const selected = model.exports.find(e => e.id === $('export-select').value);
  facts($('export-summary'),selected ? [['Created',selected.createdAt],['Studies',selected.rowCount],['Native snapshot',selected.snapshot],['Files',selected.files.length]] : [['Export','Build and export a complete captured cohort.']]);
  table($('export-files'),['File','Bytes','SHA256',''],(selected?.files || []).map(file => [
    file.name,number(file.bytes),short(file.sha256),button('Download',() => download('/api/clinical/export?'+params({exportId:selected.id,file:file.name}),file.name.split('/').at(-1))),
  ]));
  $('restore-hint').textContent = model.sources.length ? 'For independent receiving, initialize a new private workspace and open its console. This workspace retains its current source.' : 'This original workspace is empty and ready to receive a complete portable packet.';
}
function render() {
  if (!model) { controls(); return; }
  $('workspace-summary').replaceChildren(node('strong',model.configuration?.name || 'New registry workspace'),
    node('p',(model.capture?.rowCount || 0)+' captured studies'),node('p',model.builds.length+' native editions'),
    node('p','Revision '+model.revision),node('p',model.capture?.version?.dataTimestamp || 'Provider edition not yet read'));
  renderCohort(); renderSelectors(); renderEditions(); renderPrs(); renderMerchant(); renderExport();
  $('state-details').textContent = json(model);
  publisherPanel.render(model); controls();
}
async function readCapture() {
  if (!model?.capture) throw new Error('Select a retained capture.');
  const capture = await api('/api/clinical/capture?'+params({captureId:model.capture.id}));
  $('capture-details').textContent = json(capture);
  table($('capture-files'),['Original member','Bytes','SHA256',''],capture.files.map(file => [
    file.name,number(file.bytes),short(file.sha256),button('Download',() => download('/api/clinical/source-file?'+params({captureId:capture.id,file:file.name}),file.name)),
  ]));
  return capture;
}
async function readStudies(offset = 0) {
  if (!model?.capture) throw new Error('Select a retained cohort.');
  const sequence = ++studySequence, captureId = model.capture.id;
  const result = await api('/api/clinical/studies?'+params({captureId,offset,limit:50,query:$('study-search').value}));
  if (sequence !== studySequence) return;
  studyPage=result; loadedCaptureId=captureId;
  $('study-count').textContent = result.total ? 'Studies '+(offset+1)+'–'+(offset+result.rows.length)+' of '+result.total : 'No matching studies';
  $('study-next').disabled = result.nextOffset === null;
  table($('studies-table'),['NCT ID / open','Study title','Status','Lead sponsor','Last update','Results','Review'],result.rows.map(r => [
    button(r.nctId,() => readStudy(captureId,r.nctId)),r.title,r.status,r.sponsor,r.lastUpdate,r.hasResults?'Available':'No results flag',r.review?.decision || 'Pending',
  ]));
}
async function readStudy(captureId,nctId) {
  selectedStudy = await api('/api/clinical/study?'+params({captureId,nctId}));
  $('study-open').hidden=false; $('study-title').textContent=selectedStudy.summary.title;
  $('study-public').href='https://clinicaltrials.gov/study/'+selectedStudy.nctId;
  facts($('study-facts'),[['NCT identifier',nctId],['Status',selectedStudy.summary.status],
    ['Lead sponsor',selectedStudy.summary.sponsor],['Last posted update',selectedStudy.summary.lastUpdate],['Study type',selectedStudy.summary.studyType]]);
  const sections = Object.keys(selectedStudy.sectionJson || {}).map(name => [name,name.replace(/([A-Z])/g,' $1').trim()]);
  options('study-section',sections);
  $('study-json').textContent=selectedStudy.sectionJson[$('study-section').value] || selectedStudy.json;
  $('study-full-json').textContent=selectedStudy.json;
  facts($('study-source'),[['Capture',selectedStudy.captureId],['Whole-study SHA256',selectedStudy.sourceSha256],['Original page',selectedStudy.page.url],['Original page SHA256',selectedStudy.page.sha256]]);
  $('study-review-history').replaceChildren(...selectedStudy.reviews.map(r => details(r.decision+' · '+r.reviewedBy+' · '+r.createdAt,r)));
  $('study-compare-id').value=nctId;
}
function planFromForm() {
  if (!activePlan) throw new Error('Load the original registry mapping or an explicit mapping first.');
  const columns=[...$('mapping-columns').children].map(row => ({
    name:row.querySelector('[data-field=name]').value,
    path:JSON.parse(row.querySelector('[data-field=path]').value),
    mode:row.querySelector('[data-field=mode]').value,type:row.querySelector('[data-field=type]').value,
    nullable:row.querySelector('[data-field=nullable]').checked,missing:row.querySelector('[data-field=missing]').value,
  }));
  const names = id => $(id).value.split(',').map(v => v.trim()).filter(Boolean);
  return {...activePlan.plan,name:$('mapping-name').value,columns,keys:names('mapping-keys'),filters:names('mapping-filters'),
    ranges:names('mapping-ranges'),sorts:names('mapping-sorts'),defaultLimit:Number($('mapping-limit').value),maxLimit:Number($('mapping-max-limit').value)};
}
function renderPlan(value,ident=null) {
  activePlan={id:ident,plan:structuredClone(value)}; planDirty=false;
  $('mapping-name').value=value.name || '';
  for (const k of ['keys','filters','ranges','sorts']) $('mapping-'+k).value=(value[k]||[]).join(', ');
  $('mapping-limit').value=value.defaultLimit || 50; $('mapping-max-limit').value=value.maxLimit || 250;
  $('mapping-columns').replaceChildren();
  for (const column of value.columns || []) {
    const row=node('tr');
    const field = (kind,name,value,choices) => {
      let control=node(kind);
      if (kind==='select') for(const item of choices) { const option=node('option',item); option.value=item; control.append(option); }
      control.dataset.field=name;
      if (name==='nullable') { control.type='checkbox'; control.checked=value; }
      else control.value=value;
      const td=node('td');td.append(control);row.append(td);
    };
    field('input','name',column.name);field('input','path',JSON.stringify(column.path));
    field('select','mode',column.mode,['scalar','json','state']);field('select','type',column.type,['string','integer','number','boolean']);
    field('input','nullable',column.nullable);field('select','missing',column.missing,['error','null']);
    const td=node('td');td.append(button('Remove',() => { row.remove();planDirty=true;syncPlanJson(); }));row.append(td);
    $('mapping-columns').append(row);
  }
  $('mapping-json').value=json(value);
}
function syncPlanJson() { try { $('mapping-json').value=json(planFromForm()); } catch {} }
async function loadPlan(id) {
  const result=await api('/api/plan?'+params({id}));renderPlan(result.plan,result.id);renderSelectors();
}
function renderInventory() {
  const search=$('inventory-search').value.toLowerCase();
  const all=(inventory?.paths || []).filter(p => JSON.stringify(p.path).toLowerCase().includes(search));
  const rows=all.slice(inventoryOffset,inventoryOffset+100);
  $('inventory-summary').textContent=inventory ? number(inventory.records)+' whole records · '+all.length+' matching paths · '+(inventoryOffset+1)+'–'+(inventoryOffset+rows.length) : '';
  table($('inventory-table'),['Exact source path','Records','Observed types','Original lexical samples'],rows.map(p => [
    JSON.stringify(p.path),number(p.records),json(p.types),(p.samples||[]).map(s=>s.type+': '+s.json).join('\n'),
  ]));
  $('inventory-next').disabled=inventoryOffset+rows.length>=all.length;
}
function readQueryForm() {
  const parsed = new URLSearchParams($('query-params').value.replace(/^\?/,'')), result={};
  for (const [k,v] of parsed) { if (Object.hasOwn(result,k)) throw new Error('Repeated native parameter: '+k); result[k]=v; }
  return result;
}
function renderQuery(result) {
  queryResult=result;
  $('query-result').textContent=json(result);
  const body=result.body || {}, rows=body.rows || [], fields=body.fields || [];
  $('query-summary').textContent = result.status === 200 ? number(rows.length)+' rows · '+(body.page?.nextCursor?'Next original page available':'End of this selection')+' · snapshot '+short(body.dataset?.snapshot) : text(body.error || body.message || body);
  table($('query-table'),fields,rows.map(row=>fields.map((name,i)=>Array.isArray(row)?row[i]:row[name])),'No rows returned for this original selection.');
  controls();
}
async function runQuery(query) {
  const buildId=$('query-build').value;if(!buildId)throw new Error('Build a native edition first.');
  const result=await perform('dataset.query',{buildId,query});
  querySelection={buildId,query:{...query}};renderQuery(result);
}
async function readChanges(offset=0) {
  if(!comparison)return;
  const result=await api('/api/changes?'+params({id:comparison.id,offset,limit:50}));
  comparisonOffset=offset;
  const rows=result.rows || result.changes || [];
  table($('edition-change-table'),['Change','Key','Fields','Before','After'],rows.map(r=>[r.kind,json(r.key),r.fields?.join(', '),json(r.before),json(r.after)]));
  $('edition-change-next').disabled=rows.length<50;
}
async function readPrs(id=$('prs-documents').value) {
  if(!id)throw new Error('Retain an original PRS XML document first.');
  currentPrs=await api('/api/clinical/prs?'+params({documentId:id}));
  $('prs-inspection').textContent=json(currentPrs.record.report);$('prs-xml').textContent=currentPrs.xml;
  renderPrs();renderSelectors();
  return currentPrs;
}
function getPrsId() { const id=$('prs-documents').value; if(!id)throw new Error('Choose a retained PRS document.');return id; }
async function readPrsPlan() {
  const plan=await api('/api/clinical/prs-plan?'+params({planId:$('prs-plans').value}));
  $('prs-plan-details').textContent=json(plan);return plan;
}
async function readPrsReconciliation() {
  const result=await api('/api/clinical/prs-reconciliation?'+params({reportId:$('prs-reconciliations').value}));
  $('prs-reconciliation-details').textContent=json(result);return result;
}

document.querySelectorAll('[data-section]').forEach(control=>control.addEventListener('click',()=>selectSection(control.dataset.section)));
$('refresh').addEventListener('click',()=>handle(refresh));
form('connection-form',async()=>{
  let value=$('connection-token').value.trim();
  if(value.startsWith('http'))value=new URL(value).hash.slice(1);
  token=value.startsWith('token=')?value.slice(6):value;sessionStorage.setItem(storageKey+':token',token);
  $('connection-token').value='';await refresh();
});
$('pending-read').addEventListener('click',()=>handle(reconcile));
$('pending-clear').addEventListener('click',()=>handle(async()=>{
  if(!pending?.outcome || pending.outcome.status==='RUNNING')throw new Error('Read the original operation before clearing this attempt.');
  await refresh();savePending(null);render();notice('Current retained state is loaded. The original operation history remains available.');
}));
$('cohort-form').addEventListener('input',()=>{cohortDirty=true;});
form('cohort-form',async()=>{
  const query=JSON.parse($('cohort-advanced').value);
  if(!object(query))throw new Error('Additional source parameters must be an object.');
  const selected={'query.lead':$('cohort-lead').value,'query.cond':$('cohort-condition').value,
    'query.term':$('cohort-term').value,aggFilters:$('cohort-results').value,sort:$('cohort-sort').value};
  for(const [key,value] of Object.entries(selected))if(value){if(Object.hasOwn(query,key))throw new Error('Source parameter supplied twice: '+key);query[key]=value;}
  await perform('cohort.configure',{name:$('cohort-name').value,query,pageSize:Number($('cohort-page-size').value),
    markupFormat:$('cohort-markup').value,maxStudies:Number($('cohort-max-studies').value),maxBytes:Number($('cohort-max-bytes').value)*1024*1024});
  cohortDirty=false;render();notice('The complete original source selection is saved.');
});
$('version-read').addEventListener('click',()=>handle(async()=>{const result=await perform('version.inspect');notice('Provider '+result.version.apiVersion+' · data timestamp '+result.version.dataTimestamp+' UTC');}));
$('capture-start').addEventListener('click',()=>handle(async()=>{await perform('capture.start');loadedCaptureId=null;notice('New original capture started. Capture its first page or continue the complete selection.');}));
$('capture-page').addEventListener('click',()=>handle(()=>perform('capture.advance',{captureId:model.capture.id})));
$('capture-resume').addEventListener('click',()=>handle(()=>perform('capture.resume',{captureId:model.capture.id})));
$('capture-pause').addEventListener('click',()=>handle(async()=>{
  stopCapture=true;
  if(captureLoop){notice('Pause requested. The current original page will finish and remain retained.');return;}
  await perform('capture.pause',{captureId:model.capture.id});
}));
$('capture-complete').addEventListener('click',()=>handle(async()=>{
  if(!model.capture)throw new Error('Start a configured capture first.');
  captureLoop=true;stopCapture=false;controls();
  try{
    if(['paused','error','starting'].includes(model.capture.status))await perform('capture.resume',{captureId:model.capture.id});
    while(model.capture.status==='running'&&!stopCapture)await perform('capture.advance',{captureId:model.capture.id});
    if(stopCapture&&model.capture.status==='running')await perform('capture.pause',{captureId:model.capture.id});
    if(model.capture.status==='completed')notice('The complete '+model.capture.rowCount+'-study cohort is retained and ready for review.');
  }finally{captureLoop=false;stopCapture=false;render();}
}));
$('capture-select').addEventListener('change',()=>handle(async()=>{await perform('capture.select',{captureId:$('capture-select').value});loadedCaptureId=null;selectedStudy=null;$('study-open').hidden=true;}));
$('capture-inspect').addEventListener('click',()=>handle(readCapture));
form('study-search-form',()=>readStudies(0));
$('study-first').addEventListener('click',()=>handle(()=>readStudies(0)));
$('study-next').addEventListener('click',()=>handle(()=>readStudies(studyPage?.nextOffset ?? 0)));
$('study-section').addEventListener('change',()=>{$('study-json').textContent=selectedStudy?.sectionJson?.[$('study-section').value]||'';});
form('study-review-form',async()=>{
  if(!selectedStudy)throw new Error('Open the exact retained study first.');
  await perform('review.record',{captureId:selectedStudy.captureId,nctId:selectedStudy.nctId,expectedSha256:selectedStudy.sourceSha256,
    decision:$('study-decision').value,reviewedBy:$('study-reviewer').value,note:$('study-note').value});
  await readStudy(selectedStudy.captureId,selectedStudy.nctId);await readStudies(studyPage?.offset||0);notice('Study review retained alongside its original source.');
});
form('study-compare-form',async()=>{
  const result=await api('/api/clinical/study-compare?'+params({beforeId:$('study-before').value,afterId:$('study-after').value,nctId:$('study-compare-id').value}));
  $('study-changes').textContent=json(result);
});
$('mapping-default').addEventListener('click',()=>handle(async()=>{const result=await perform('mapping.default',{name:'Registry review'});await loadPlan(result.id);}));
$('mapping-select').addEventListener('change',()=>handle(()=>loadPlan($('mapping-select').value)));
$('mapping-form').addEventListener('input',event=>{planDirty=true;if(event.target.id!=='mapping-json')syncPlanJson();});
form('mapping-form',async()=>{const result=await perform('mapping.save',{plan:planFromForm()});await loadPlan(result.id);notice('Explicit mapping saved in the original source engine.');});
$('mapping-add').addEventListener('click',()=>handle(()=>{
  const plan=planFromForm();plan.columns.push({name:'new_column',path:[],mode:'scalar',type:'string',nullable:false,missing:'error'});
  renderPlan(plan);planDirty=true;
}));
$('mapping-add-state').addEventListener('click',()=>handle(()=>{
  const plan=planFromForm(),states=new Set(plan.columns.filter(c=>c.mode==='state').map(c=>JSON.stringify(c.path)));
  for(const column of [...plan.columns])if(column.mode!=='state'&&column.missing==='null'&&!states.has(JSON.stringify(column.path))){
    plan.columns.push({name:column.name+'_state',path:column.path,mode:'state',type:'string',nullable:false,missing:'error'});
    states.add(JSON.stringify(column.path));
  }
  renderPlan(plan);planDirty=true;
}));
$('mapping-load-json').addEventListener('click',()=>handle(()=>{renderPlan(JSON.parse($('mapping-json').value));planDirty=true;}));
$('edition-build').addEventListener('click',()=>handle(async()=>{
  if(planDirty)throw new Error('Save the reviewed mapping before building.');
  const result=await perform('edition.build',{captureId:model.capture.id,planId:model.activePlan});
  querySelection={buildId:result.id};render();notice('The original native dataset contains '+result.rowCount+' records.');
}));
$('inventory-read').addEventListener('click',()=>handle(async()=>{
  if(!model.capture?.source)throw new Error('Complete the whole source capture first.');
  const result=await api('/api/source?'+params({id:model.capture.source}));inventory=result.inventory;inventoryOffset=0;renderInventory();
}));
$('inventory-search').addEventListener('input',()=>{inventoryOffset=0;renderInventory();});
$('inventory-next').addEventListener('click',()=>{inventoryOffset+=100;renderInventory();});
form('edition-compare-form',async()=>{comparison=await perform('edition.compare',{beforeId:$('edition-before').value,afterId:$('edition-after').value});$('edition-comparison').textContent=json(comparison);await readChanges(0);});
$('edition-change-next').addEventListener('click',()=>handle(()=>readChanges(comparisonOffset+50)));
form('query-form',()=>runQuery(readQueryForm()));
$('query-next').addEventListener('click',()=>handle(()=>{
  if(!queryResult?.body?.page?.nextCursor||!querySelection)throw new Error('No original continuation page is available.');
  $('query-build').value=querySelection.buildId;
  return runQuery({...querySelection.query,cursor:queryResult.body.page.nextCursor});
}));
$('query-load').addEventListener('click',()=>{
  if(!model.lastQuery){notice('No native query is retained yet.');return;}
  $('query-build').value=model.lastQuery.buildId;$('query-params').value=new URLSearchParams(model.lastQuery.initialQuery).toString();
  querySelection={buildId:model.lastQuery.buildId};notice('Saved initial query loaded for review; its previous cursor remains in the retained query record.');
});
$('query-build').addEventListener('change',()=>{querySelection={buildId:$('query-build').value};queryResult=null;controls();});
$('merchant-form').addEventListener('input',()=>{merchantDirty=true;});
form('merchant-form',async()=>{
  await perform('merchant.configure',{origin:$('merchant-origin').value,path:$('merchant-path').value,payment:{
    scheme:$('payment-scheme').value,network:$('payment-network').value,asset:$('payment-asset').value,amount:$('payment-amount').value,
    payTo:$('payment-recipient').value,maxTimeoutSeconds:Number($('payment-timeout').value)}});
  merchantDirty=false;render();notice('Original native merchant terms are validated and saved.');
});
form('prs-upload-form',async()=>{const result=await upload('/api/clinical/prs-upload',$('prs-file').files[0],{'X-Clinical-Schema':$('prs-schema').value});await readPrs(result.id);notice('Original XML and its complete inspection are retained.');});
$('prs-documents').addEventListener('change',()=>handle(()=>readPrs()));
$('prs-inspect').addEventListener('click',()=>handle(()=>readPrs()));
$('prs-download-xml').addEventListener('click',()=>handle(()=>download('/api/clinical/prs-file?'+params({documentId:getPrsId(),kind:'xml'}))));
$('prs-download-report').addEventListener('click',()=>handle(()=>download('/api/clinical/prs-file?'+params({documentId:getPrsId(),kind:'report'}))));
form('prs-plan-form',async()=>{
  const result=await perform('prs.plan',{documentId:getPrsId(),decisions:JSON.parse($('prs-decisions').value),reviewer:$('prs-reviewer').value,rationale:$('prs-rationale').value});
  $('prs-plans').value=result.id;$('prs-plan-details').textContent=json(result);
});
$('prs-read-plan').addEventListener('click',()=>handle(readPrsPlan));
$('prs-apply').addEventListener('click',()=>handle(async()=>{
  const plan=await readPrsPlan();
  const result=await perform('prs.apply',{documentId:plan.documentId,planId:plan.id});
  await readPrs(result.document.id);notice('Reviewed candidate retained with the original plan and comparison.');
}));
form('prs-candidate-form',async()=>{
  const result=await perform('prs.candidate',{originalId:getPrsId(),xml:$('prs-candidate-xml').value,
    name:$('prs-candidate-name').value,reviewedBy:$('prs-reviewer').value,note:$('prs-candidate-note').value});
  await readPrs(result.id);
});
form('prs-reconcile-form',async()=>{
  if(!model.capture)throw new Error('Choose the original captured API cohort.');
  const result=await perform('prs.reconcile',{documentId:getPrsId(),captureId:model.capture.id,plan:JSON.parse($('prs-reconcile-plan').value)});
  $('prs-reconciliations').value=result.id;$('prs-reconciliation-details').textContent=json(result);
});
$('prs-read-reconciliation').addEventListener('click',()=>handle(readPrsReconciliation));
$('package-export').addEventListener('click',()=>handle(async()=>{
  const result=await perform('package.export',{buildId:model.activeBuild});
  $('export-select').value=result.id;renderExport();notice('Complete registry customer package retained with '+result.files.length+' declared files.');
}));
$('export-select').addEventListener('change',renderExport);
form('restore-form',async()=>{await upload('/api/clinical/restore',$('restore-file').files[0]);await refresh();notice('Original source, review history and native dataset were received into this workspace.');});
$('contract-files').append(...contracts.map(name=>button(name,()=>download('/api/clinical/contract?'+params({name}),name))));
await handle(async()=>{
  await refresh();
  if(model?.activePlan)await loadPlan(model.activePlan);
  if(model?.lastQuery)$('query-params').value=new URLSearchParams(model.lastQuery.initialQuery).toString();
});
