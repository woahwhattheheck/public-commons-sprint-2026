// MIT. Tenant ingestion UI using the original workbench capability and operation lifecycle.
const token = location.hash.slice(1) || sessionStorage.getItem('opendatasoft-workbench-capability') || '';
if (location.hash) { sessionStorage.setItem('opendatasoft-workbench-capability',token); history.replaceState(null,'',location.pathname + location.search); }
const form = document.querySelector('#prepare-form'), notice = document.querySelector('#notice');
const state = { project:null,targets:[],edition:null,plan:null,busy:false,disposed:false };
let polling = null;
function node(tag,text,attrs = {}) {
  const value = document.createElement(tag);
  if (text !== undefined && text !== null) value.textContent = String(text);
  for (const [key,item] of Object.entries(attrs)) value.setAttribute(key,String(item));
  return value;
}
function message(value,error = false) { notice.textContent = value; notice.dataset.error = String(error); }
async function request(path,body) {
  const response = await fetch('/api/' + path,{ method:body === undefined ? 'GET':'POST',
    headers:{ authorization:'Bearer ' + token,...(body !== undefined ? { 'content-type':'application/json' }: {}) },
    ...(body !== undefined ? { body:JSON.stringify(body) }: {}) });
  let value; try { value = await response.json(); } catch { throw new Error('The workbench did not return a complete result. Refresh its original operation.'); }
  if (!response.ok) throw new Error(value.message || value.error || 'The request did not complete.');
  return value;
}
function numericIdentity(source) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) return null;
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/,'');
  if (!digits) return '0';
  let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  if (trailing) { digits = digits.slice(0,-trailing); exponent += BigInt(trailing); }
  return match[1] + digits + 'e' + exponent.toString();
}
function json(name) {
  let value, precise = true;
  try {
    value = JSON.parse(form.elements[name].value,(_key,item,context) => {
      if (typeof item === 'number' && (typeof context?.source !== 'string' || !Number.isFinite(item) ||
          numericIdentity(context.source) !== numericIdentity(String(item)))) precise = false;
      return item;
    });
  } catch { throw new Error('Enter valid JSON for ' + name + '.'); }
  if (!precise) throw new Error('Use Complete native plan JSON to preserve the exact numeric literals in ' + name + '.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use a JSON object for ' + name + '.');
  return value;
}
function button(label,action,disabled = false) {
  const value = node('button',label,{ type:'button' }); value.disabled = disabled;
  value.addEventListener('click',() => Promise.resolve().then(action).catch(error => message(error.message,true)));
  return value;
}
function details(label,value,raw = false) {
  const section = node('details'); section.append(node('summary',label),node('pre',raw ? value:JSON.stringify(value,null,2))); return section;
}
function describe(rows) {
  const list = node('dl');
  for (const [label,value] of rows) list.append(node('dt',label),node('dd',value ?? '—'));
  return list;
}
function setBusy(value) {
  state.busy = value;
  for (const control of document.querySelectorAll('button[data-native],#prepare-form button[type=submit]')) control.disabled = value;
}
function nativeButton(label,action) { const value = button(label,action,state.busy); value.dataset.native = 'true'; return value; }
function drawOperation() {
  const root = document.querySelector('#operation'), operation = state.project?.operation; root.replaceChildren();
  if (!operation || operation.state !== 'RUNNING') return;
  root.append(node('span',operation.kind + (operation.progress?.phase ? ' · ' + operation.progress.phase : '')));
  root.append(button('Cancel operation',async () => { await request('cancel',{}); message('Cancellation requested. The original operation retains its native state.'); }));
}
function drawPlans() {
  const root = document.querySelector('#plans'); root.replaceChildren();
  const plans = [...(state.project?.tenantPlans ?? [])].reverse();
  if (!plans.length) root.append(node('p','Save a plan from a complete retained edition.',{ class:'empty' }));
  for (const item of plans) {
    const select = button('',() => selectPlan(item.id)); select.className = 'plan-button';
    select.setAttribute('aria-pressed',String(state.plan?.id === item.id));
    select.append(node('span',item.target.datasetId),node('span',item.state.replaceAll('_',' '),{ class:'status' }));
    root.append(select);
  }
}
async function refresh(loadSelected = false) {
  state.project = await request('status'); drawOperation(); drawPlans();
  if (loadSelected && state.plan) await selectPlan(state.plan.id);
}
async function run(path,input = {}) {
  if (state.busy) return;
  setBusy(true); message('Operation started.');
  try {
    const started = await request(path,input);
    while (!state.disposed) {
      await refresh(false);
      const operation = state.project.operation;
      if (!operation || operation.id !== started.operationId) throw new Error('The original operation changed. Refresh the saved plan.');
      if (operation.state !== 'RUNNING') {
        if (operation.result?.id && path === 'tenant-plans') state.plan = { id:operation.result.id };
        if (state.plan) await selectPlan(state.plan.id);
        if (operation.state !== 'COMPLETE') throw new Error(operation.error?.message || 'The operation did not complete. Its retained state is available below.');
        message(operation.kind + ' completed.'); return operation.result;
      }
      await new Promise(resolve => { polling = setTimeout(resolve,1200); });
    }
  } finally { setBusy(false); polling = null; }
}
async function selectPlan(id) {
  state.plan = await request('tenant-plans/' + encodeURIComponent(id)); drawPlans(); drawPlan();
}
async function download(id,guide = false) {
  const response = await fetch('/api/tenant-deliveries/' + encodeURIComponent(id) + (guide ? '/guide':'/download'),{ headers:{ authorization:'Bearer ' + token } });
  if (!response.ok) { const value = await response.json(); throw new Error(value.message || 'The delivery could not be downloaded.'); }
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = node('a',null,{ href:url,download:'huwise-tenant-' + id + (guide ? '.md':'.tar.gz') });
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),10000);
}
function drawPlan() {
  const plan = state.plan, root = document.querySelector('#selected'); root.replaceChildren();
  if (!plan) return;
  const heading = node('div',null,{ class:'row heading' }); heading.append(node('h2',plan.target.datasetId),node('span',plan.state.replaceAll('_',' '),{ class:'status' })); root.append(heading);
  root.append(describe([
    ['Tenant',plan.target.origin],['Source',plan.source.datasetId + ' · ' + plan.source.rowCount.toLocaleString() + ' rows'],
    ['Dataset UID',plan.datasetUid],['Source edition',plan.source.editionId],['Plan',plan.id],
    ['Plan SHA256',plan.planSha256],
  ]));
  if (plan.error) root.append(node('p',plan.error.message ?? plan.error.code));
  const actions = node('div',null,{ class:'actions' });
  if (!Object.values(plan.steps ?? {}).some(step => !['READY','NOT_DISPATCHED'].includes(step.state)))
    actions.append(nativeButton('Inspect tenant',() => run('tenant-plans/' + plan.id + '/inspect')));
  if (plan.inspection && ['INSPECTED','REVIEWED'].includes(plan.state)) actions.append(nativeButton('Save this review',async () => {
    const note = document.querySelector('#review-note')?.value ?? '';
    await run('tenant-plans/' + plan.id + '/review',{ planSha256:plan.planSha256,configurationSha256:plan.inspection.configurationSha256,note });
  }));
  if (plan.review && plan.state !== 'ACCEPTED') actions.append(nativeButton('Apply reviewed plan',() => run('tenant-plans/' + plan.id + '/apply',{ reviewId:plan.review.id })));
  if (plan.review) actions.append(nativeButton('Recover original operation',async () => {
    let input = {};
    const raw = document.querySelector('#recovery-input')?.value.trim();
    if (raw) { input = JSON.parse(raw); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Use a recovery JSON object.'); }
    await run('tenant-plans/' + plan.id + '/recover',input);
  }));
  if (plan.datasetUid) actions.append(nativeButton('Read processing status',() => run('tenant-plans/' + plan.id + '/status')));
  if (plan.datasetUid && plan.workflow?.some(step => step.key === 'publish'))
    actions.append(nativeButton('Receive full publication',() => run('tenant-plans/' + plan.id + '/receive')));
  actions.append(nativeButton('Prepare delivery',async () => {
    const result = await run('tenant-plans/' + plan.id + '/export');
    if (result?.id) message('Delivery prepared. Download the complete package below.');
  }));
  root.append(actions);
  if (plan.inspection && ['INSPECTED','REVIEWED'].includes(plan.state)) {
    const label = node('label','Review note'); const input = node('input',null,{ id:'review-note',maxlength:'2048',placeholder:'Record any receiving or configuration decisions.' }); label.append(input); root.append(label);
  }
  if (plan.lastExport) {
    const downloads = node('div',null,{ class:'actions' });
    downloads.append(button('Download complete delivery',() => download(plan.lastExport.id)),button('Download operating guide',() => download(plan.lastExport.id,true))); root.append(downloads);
  }
  if (plan.workflow) {
    const table = node('table'), head = node('tr'); ['Step','Native operation','Result'].forEach(value => head.append(node('th',value))); const thead = node('thead'); thead.append(head); table.append(thead);
    const tbody = node('tbody');
    for (const step of plan.workflow) {
      const row = node('tr'), result = plan.steps[step.key];
      row.append(node('td',step.key),node('td',step.operationId),node('td',(result?.state ?? 'READY').replaceAll('_',' '))); tbody.append(row);
    }
    table.append(tbody); const wrapper = node('div',null,{ class:'table-scroll' }); wrapper.append(table); root.append(wrapper);
  }
  if (plan.providerStatus) root.append(details('Native processing result',plan.providerStatus));
  if (plan.receiving) {
    root.append(node('h3',plan.receiving.acceptance?.accepted ? 'Published receiving accepted':'Published receiving'));
    const result = plan.receiving.acceptance;
    if (result) root.append(describe([
      ['Receiving',result.criteria.mode],['Published rows',result.receivedRows],['Expected rows',result.criteria.expectedRows],
      ['Mapped fields',result.comparedFields],['Missing source rows',result.missingRows],['Additional rows',result.differentRows],
      ['Record errors',result.recordErrors?.length ?? 0],['Capture SHA256',result.captureSha256],
    ]));
    root.append(details('Full receiving result',plan.receiving));
  }
  root.append(details('Reviewed configuration',plan.specificationJson,true));
  if (plan.remoteJson) root.append(details('Original tenant configuration',plan.remoteJson,true));
  if (plan.review) {
    root.append(details('Saved review',plan.review));
    const recovery = node('details'); recovery.append(node('summary','Native recovery identifiers'),node('p','Recovery first looks up the unique reviewed upload filename and compares the complete native file. Supply fileUid when the tenant uses another identifier. Existing configuration identifiers can be supplied in stepIds.'));
    const textarea = node('textarea',null,{ id:'recovery-input',rows:'4',spellcheck:'false' }); textarea.value = '{}'; recovery.append(textarea); root.append(recovery);
  }
  if (plan.nativePlanJson) root.append(details('Complete native plan and operations',plan.nativePlanJson,true));
}
async function chooseEdition() {
  const id = form.elements.edition.value; if (!id) return;
  const edition = await request('editions/' + encodeURIComponent(id)); state.edition = edition;
  form.elements.datasetId.value = edition.datasetId + '-reviewed';
  form.elements.title.value = edition.datasetTitle || edition.datasetId;
  form.elements.resourceTitle.value = edition.datasetTitle || edition.datasetId;
  form.elements.modified.value = edition.completedAt || edition.source.completedAt;
  form.elements.acceptance.value = JSON.stringify({ mode:'source-match',expectedRows:edition.rowCount,fieldMap:{},allowAdditionalRows:false },null,2);
  document.querySelector('#edition-summary').textContent = edition.rowCount.toLocaleString() + ' retained rows · ' + edition.fields.length + ' fields · Notes revision ' + (edition.notes?.revision ?? 0);
}
function chooseTarget() {
  const target = state.targets.find(item => item.alias === form.elements.target.value);
  document.querySelector('#target-summary').textContent = target ? target.origin + (target.available ? '' : ' · Connection unavailable on this host') : 'Add a named tenant connection in the host settings to prepare a plan.';
}
form.elements.edition.addEventListener('change',() => chooseEdition().catch(error => message(error.message,true)));
form.elements.target.addEventListener('change',chooseTarget);
document.querySelector('#find-dataset').addEventListener('click',async () => {
  try {
    const alias = form.elements.target.value, datasetId = form.elements.datasetId.value.trim();
    if (!alias || !datasetId) throw new Error('Choose a tenant and enter its dataset ID.');
    const result = await request('tenant-datasets?target=' + encodeURIComponent(alias) + '&datasetId=' + encodeURIComponent(datasetId));
    const root = document.querySelector('#dataset-search'); root.replaceChildren();
    const rows = result.datasets ?? [];
    if (!rows.length) root.append(node('p','This tenant has no dataset with that ID.',{ class:'muted' }));
    for (const item of rows) root.append(button('Use ' + item.dataset_id + ' · ' + item.uid,() => { form.elements.datasetUid.value = item.uid; form.elements.datasetId.value = item.dataset_id; }));
  } catch (error) { message(error.message,true); }
});
form.addEventListener('submit',async event => {
  event.preventDefault();
  try {
    const complete = form.elements.planJson.value.trim();
    if (complete) { await run('tenant-plans',{ planJson:complete }); return; }
    if (!form.reportValidity()) return;
    if (!state.edition) throw new Error('Select a complete retained source edition.');
    const datasetId = form.elements.datasetId.value.trim(), datasetUid = form.elements.datasetUid.value.trim(), resourceUid = form.elements.resourceUid.value.trim();
    const metadata = json('metadata'), template = form.elements.metadataTemplate.value.trim();
    const input = {
      editionId:state.edition.id,captureSha256:state.edition.manifestSha256,notesRevision:state.edition.notes?.revision ?? 0,
      target:{ alias:form.elements.target.value,datasetId,...(datasetUid ? { datasetUid }: {}) },
      dataset:{ dataset_id:datasetId,is_restricted:form.elements.visibility.value === 'restricted',
        metadata:{ ...metadata,[template]:{ ...(metadata[template] ?? {}),title:{ value:form.elements.title.value.trim() },modified:{ value:form.elements.modified.value.trim() },language:{ value:form.elements.language.value } } } },
      resource:{ ...(resourceUid ? { uid:resourceUid }: {}),type:form.elements.extractor.value.trim(),title:form.elements.resourceTitle.value.trim(),params:json('params') },
      resourceMode:form.elements.resourceMode.value,changes:json('changes'),publish:form.elements.publish.checked,acceptance:json('acceptance'),
    };
    await run('tenant-plans',input);
  } catch (error) { message(error.message,true); }
});
document.querySelector('#refresh').addEventListener('click',() => refresh(true).catch(error => message(error.message,true)));
window.addEventListener('pagehide',() => { state.disposed = true; if (polling) clearTimeout(polling); });
async function start() {
  if (!token) throw new Error('Open the complete original workbench link before using tenant ingestion.');
  await refresh(false); state.targets = await request('tenant-targets');
  const editions = (state.project.editions ?? []).filter(item => item.state === 'COMPLETE');
  for (const edition of editions) form.elements.edition.append(node('option',(edition.datasetTitle || edition.datasetId) + ' · ' + edition.rowCount.toLocaleString() + ' rows',{ value:edition.id }));
  for (const target of state.targets) form.elements.target.append(node('option',target.label,{ value:target.alias }));
  chooseTarget(); if (editions.length) await chooseEdition();
  if (!editions.length) message('Capture or import a complete source edition in the original workbench first.');
  const latest = state.project.tenantPlans?.at(-1); if (latest) await selectPlan(latest.id);
}
start().catch(error => message(error.message,true));
