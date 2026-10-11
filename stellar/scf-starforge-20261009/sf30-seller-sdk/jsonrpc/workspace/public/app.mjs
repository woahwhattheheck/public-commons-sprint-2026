// MIT. Saved public plan editing and explicit original merchant operations.
const $ = id => document.getElementById(id);
const keyFromUrl = new URLSearchParams(location.hash.slice(1)).get('key');
if (keyFromUrl && /^[a-f0-9]{64}$/.test(keyFromUrl)) {
  sessionStorage.setItem('rpc-workspace-key',keyFromUrl);
  history.replaceState(null,'',location.pathname);
}
const key = sessionStorage.getItem('rpc-workspace-key') ?? '';
let state, active, review, working, baseRevision, dirty=false, rawDirty=false, busy=false;
let actionPage=[], nextActions=null;
const pending = new Map();
const labels = { timeoutMs:'Provider timeout (ms)',maxResponseBytes:'Response byte limit',maxInFlight:'Provider capacity',
  maxEventPage:'Events per page',maxTransactionPage:'Transactions per page',maxLedgerKeys:'Ledger keys per request',maxLedgerPage:'Ledgers per page' };
function node(tag,text,attributes={}) {
  const element=document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent=String(text);
  for (const [name,value] of Object.entries(attributes)) element.setAttribute(name,String(value));
  return element;
}
function message(text,error=false) { $('notice').textContent=text; $('notice').classList.toggle('error',error); }
async function request(path,input) {
  let response;
  try { response=await fetch(path,{ method:input === undefined ? 'GET':'POST',
    headers:{ 'x-rpc-workspace':key,...(input === undefined ? {}:{ 'content-type':'application/json' }) },
    ...(input === undefined ? {}:{ body:JSON.stringify(input) }) }); }
  catch { throw new Error('The connection was interrupted. Refresh saved status before repeating the action.'); }
  const value=await response.json();
  if (!response.ok) throw Object.assign(new Error(value.message ?? value.code ?? 'Request failed'),{ code:value.code,status:response.status });
  return value;
}
async function operation(path,input) {
  const identity=path+'\n'+JSON.stringify(input);
  const operationId=pending.get(identity) ?? 'rpc-'+crypto.randomUUID(); pending.set(identity,operationId);
  try {
    const result=await request(path,{...input,operationId}); pending.delete(identity); return result;
  } catch (cause) { if (cause.status) pending.delete(identity); throw cause; }
}
function download(kind,id,name,label) {
  const button=node('button',label ?? name ?? 'Download',{type:'button'});
  button.addEventListener('click',() => run(() => saveArtifact(kind,id,name)));
  return button;
}
async function saveArtifact(kind,id,name) {
  const query=new URLSearchParams({kind,id:String(id),...(name ? {name}:{})});
  const response=await fetch('/api/artifact?'+query,{headers:{'x-rpc-workspace':key}});
  if (!response.ok) { const issue=await response.json(); throw new Error(issue.message ?? issue.code); }
  const blob=await response.blob(), href=URL.createObjectURL(blob), link=node('a');
  link.href=href; link.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'rpc-artifact.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(href),1000);
}
function table(headers,rows) {
  const result=node('table'), head=node('thead'), heading=node('tr'), body=node('tbody');
  for (const value of headers) heading.append(node('th',value)); head.append(heading); result.append(head,body);
  for (const row of rows) {
    const tr=node('tr');
    for (const value of row) { const td=node('td'); value instanceof Node ? td.append(value) : td.textContent=String(value ?? ''); tr.append(td); }
    body.append(tr);
  }
  return result;
}
const time=value => value ? new Date(value).toLocaleString():'';
const json=value => JSON.stringify(value,null,2)+'\n';
function controls() {
  for (const element of document.querySelectorAll('button')) element.disabled=busy;
  if (!state || busy) return;
  const actionable=Boolean(review?.valid && !dirty);
  for (const id of ['prepare','diagnose','buyer']) $(id).disabled=!actionable;
  $('start').disabled=!actionable || !state.runtimeConfigured || ['RUNNING','STARTING','STOPPING'].includes(state.runtime.state);
  $('stop').disabled=state.runtime.state !== 'RUNNING';
  $('buyer').disabled ||= !$('buyer-package').value;
  $('start').disabled ||= !$('runtime-package').value;
  $('save').disabled=!dirty;
  $('older-actions').hidden=!nextActions;
}
async function run(fn) {
  if (busy) return;
  busy=true; controls();
  try { await fn(); }
  catch (cause) {
    if (cause.code === 'DRAFT_REVISION_CHANGED') $('conflict').hidden=false;
    message(cause.message,true);
  } finally { busy=false; controls(); }
}
function markDirty() {
  dirty=true;
  $('editor-meta').textContent='Editing version '+active.revision+' · unsaved changes';
  controls();
}
function formPlan() {
  const plan=structuredClone(working), value=id => $(id).value;
  plan.publicOrigin=value('public-origin'); plan.dataNetwork=value('data-network'); plan.endpointEnv=value('endpoint-env');
  plan.payment={...(plan.payment && typeof plan.payment === 'object' && !Array.isArray(plan.payment) ? plan.payment:{}),
    network:value('payment-network'),asset:value('asset'),payTo:value('recipient'),maxTimeoutSeconds:Number(value('payment-timeout'))};
  const previous=new Map((Array.isArray(plan.operations) ? plan.operations:[]).filter(row => row && typeof row === 'object' && !Array.isArray(row)).map(row => [row.method,row]));
  plan.operations=[...$('products').querySelectorAll('tr')].filter(row => row.querySelector('input[type=checkbox]').checked)
    .map(row => ({...previous.get(row.dataset.method),method:row.dataset.method,amountAtomic:row.querySelector('input[type=text]').value}));
  plan.limits=Object.fromEntries(Object.keys(state.limits).map(name => [name,Number($('limit-'+name).value)]));
  return plan;
}
function editorPlan() {
  if (!rawDirty) return formPlan();
  let parsed; try { parsed=JSON.parse($('raw-plan').value); } catch { throw new Error('Correct the complete plan JSON before saving.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The plan must be a JSON object.');
  return parsed;
}
function fillForm(plan) {
  working=structuredClone(plan);
  const values={ 'public-origin':plan.publicOrigin,'data-network':plan.dataNetwork,
    'payment-network':plan.payment?.network,'endpoint-env':plan.endpointEnv,asset:plan.payment?.asset,
    recipient:plan.payment?.payTo,'payment-timeout':plan.payment?.maxTimeoutSeconds };
  for (const [id,value] of Object.entries(values)) $(id).value=value ?? '';
  const configured=new Map((Array.isArray(plan.operations) ? plan.operations:[]).filter(row => row && typeof row === 'object').map(row => [row.method,row]));
  $('products').replaceChildren();
  for (const method of state.methods) {
    const tr=node('tr'); tr.dataset.method=method;
    const chosen=node('input',null,{type:'checkbox','aria-label':'Enable '+method}); chosen.checked=configured.has(method);
    const price=node('input',null,{type:'text',inputmode:'numeric','aria-label':method+' atomic price',autocomplete:'off'});
    price.value=configured.get(method)?.amountAtomic ?? ''; price.disabled=!chosen.checked;
    chosen.addEventListener('change',() => { price.disabled=!chosen.checked; syncForm(); });
    price.addEventListener('input',syncForm);
    for (const item of [chosen,node('span',method,{class:'method'}),price]) { const td=node('td'); td.append(item); tr.append(td); }
    $('products').append(tr);
  }
  $('limits').replaceChildren();
  for (const [name,fallback] of Object.entries(state.limits)) {
    const label=node('label',labels[name] ?? name), input=node('input',null,{id:'limit-'+name,type:'number',min:'1',step:'1'});
    input.value=plan.limits?.[name] ?? fallback; input.addEventListener('input',syncForm); label.append(input); $('limits').append(label);
  }
  $('raw-plan').value=json(plan); rawDirty=false;
}
function syncForm() {
  if (rawDirty) { message('Apply or discard the changed complete JSON before editing its fields.',true); return; }
  working=formPlan(); $('raw-plan').value=json(working); markDirty();
}
function versionOptions(select,selected) {
  select.replaceChildren(...state.drafts.map(row => node('option','Version '+row.revision,{value:row.revision})));
  select.value=String(selected ?? state.latest.revision);
}
function renderVersions() {
  $('versions').replaceChildren();
  for (const row of state.drafts) {
    const button=node('button','Version '+row.revision,{type:'button',class:'version'+(row.revision===active?.revision ? ' selected':'')});
    button.append(node('small',time(row.savedAt))); button.addEventListener('click',() => run(() => openVersion(row.revision)));
    $('versions').append(button);
  }
  const before=$('compare-before').value, after=$('compare-after').value;
  versionOptions($('compare-before'),before || state.drafts[1]?.revision || state.latest.revision);
  versionOptions($('compare-after'),after || state.latest.revision);
}
function renderReview() {
  $('review-summary').replaceChildren(); $('review-products').replaceChildren();
  if (!review?.valid) {
    $('review-summary').append(node('p',review?.error?.message ?? 'Choose a saved version to review.',{class:'review-status'}));
    $('buyer-method').replaceChildren(); return;
  }
  $('review-summary').append(node('p','Version '+review.revision+' · '+review.routes.length+' priced products',{class:'review-status'}));
  const metrics=node('div',null,{class:'metric-grid'});
  for (const [title,value] of [['Data network',review.dataNetwork],['Payment network',review.payment.network],['Environment references',review.requiredEnvironment.join(', ')]]) {
    const box=node('div',null,{class:'metric'});box.append(node('small',title),node('strong',value));metrics.append(box);
  }
  $('review-summary').append(metrics);
  if (review.crossNetwork) $('review-summary').append(node('p','Data and payment use different declared networks. Review both selections before starting.',{class:'muted'}));
  $('review-products').append(table(['Product','Resource','Payment option'],review.routes.map(row => [row.method,row.url,
    row.accepts.map(option => option.amount+' atomic · '+option.network+'\n'+option.asset+' → '+option.payTo).join('\n')])));
  const selected=$('buyer-method').value;
  $('buyer-method').replaceChildren(...review.routes.map(row => node('option',row.method,{value:row.method})));
  if (review.routes.some(row => row.method===selected)) $('buyer-method').value=selected;
}
function packageSelect(id) {
  const selected=$(id).value, matches=state.packages.filter(row => row.state==='READY' && row.revision===active?.revision);
  $(id).replaceChildren(...matches.map(row => node('option','Version '+row.revision+' / '+row.id,{value:row.id})));
  if (matches.some(row => row.id===selected)) $(id).value=selected;
}
function renderPackages() {
  $('packages').replaceChildren();
  if (!state.packages.length) $('packages').append(node('p','Prepare a reviewed version to retain its merchant package.',{class:'empty'}));
  for (const row of state.packages) {
    const details=node('details',null,{class:'package'}), title=node('summary','Version '+row.revision+' · '+row.state+' · '+row.id);
    details.append(title,node('p',time(row.createdAt),{class:'muted'}));
    if (row.error) details.append(node('p',row.error));
    if (row.summary) {
      details.append(node('code',row.summary.folder));const buttons=node('div',null,{class:'buttons'});
      for (const file of row.summary.files) buttons.append(download('package',row.id,file.name));
      details.append(buttons);
    }
    $('packages').append(details);
  }
  packageSelect('buyer-package'); packageSelect('runtime-package');
}
function renderRuntime() {
  const value=state.runtime;$('runtime-state').textContent=value.state;
  $('runtime-mode').textContent=value.launchMode==='OFFLINE' ? 'Reopen the launcher with a runtime mode to enable merchant start.' :
    'Launcher mode: '+value.launchMode.toLowerCase()+'. Provider and facilitator connections come from that launcher.';
  $('runtime-links').replaceChildren();
  for (const [label,url] of [['Merchant explorer',value.docs],['Operations',value.operations],['Product availability',value.availability]]) {
    if (!url) continue;
    const parsed=new URL(url);
    if (parsed.protocol==='http:' && parsed.hostname==='127.0.0.1')
      $('runtime-links').append(node('a',label,{href:url,target:'_blank',rel:'noopener noreferrer',class:'link-button'}));
  }
  $('runtime-detail').textContent=json({state:value.state,instanceId:value.instanceId,version:value.revision,
    packageId:value.packageId,startedAt:value.startedAt,endedAt:value.endedAt,provider:value.snapshot?.rpc});
}
function renderActions() {
  $('activities').replaceChildren();
  if (!actionPage.length) $('activities').append(node('p','Explicit provider reads and prepared buyer requests appear here.',{class:'empty'}));
  for (const row of actionPage) {
    const details=node('details',null,{class:'package'});details.append(node('summary',row.kind+' · '+row.state+' · version '+row.revision));
    details.append(node('p',time(row.createdAt)+' / '+row.id,{class:'muted'}));
    if (row.result) details.append(node('pre',json(row.result))); if (row.error) details.append(node('p',row.error));
    const buttons=node('div',null,{class:'buttons'});buttons.append(download('action',row.id,undefined,'Download retained operation'));
    if (row.kind==='buyer' && row.state==='COMPLETE')
      for (const file of row.result.files) buttons.append(download('buyer',row.id,file.name));
    details.append(buttons);$('activities').append(details);
  }
}
async function refresh(preserve=true) {
  state=await request('/api/state'); $('directory').textContent=state.directory;
  $('workspace-status').textContent='Saved version '+state.latest.revision+' · '+state.runtime.state.toLowerCase();
  actionPage=state.actions.items;nextActions=state.actions.next;
  if (!preserve || !active) await adopt(state.latest); else { renderVersions();renderPackages(); }
  renderRuntime();renderActions();controls();
}
async function adopt(saved) {
  active=saved;baseRevision=state.latest.revision;dirty=false;$('conflict').hidden=true;
  fillForm(saved.plan);review=await request('/api/review',{revision:saved.revision});
  $('editor-meta').textContent='Version '+saved.revision+' · saved '+time(saved.savedAt)+(saved.revision!==state.latest.revision ? ' · saving creates a new version':'');
  renderVersions();renderReview();renderPackages();controls();
}
async function openVersion(revision) {
  if (dirty && !confirm('Discard the unsaved editor changes and open this saved version?')) return;
  await adopt(await request('/api/draft?revision='+revision));message('Opened saved version '+revision+'.');
}
function selection() {
  if (dirty) throw new Error('Save the editor changes before operating this version.');
  if (!review?.valid) throw new Error(review?.error?.message ?? 'Review a complete saved plan first.');
  return {revision:active.revision,reviewId:review.reviewId};
}
async function save(expectedRevision=baseRevision) {
  const saved=await operation('/api/save',{expectedRevision,sourceRevision:active.revision,plan:editorPlan()});
  await refresh();await adopt(saved);message('Saved version '+saved.revision+'.');
}
for (const id of ['public-origin','data-network','payment-network','endpoint-env','asset','recipient','payment-timeout']) $(id).addEventListener('input',syncForm);
$('plan-form').addEventListener('submit',event => event.preventDefault());
$('raw-plan').addEventListener('input',() => { rawDirty=true;markDirty(); });
$('apply-json').addEventListener('click',() => run(async () => { fillForm(editorPlan());markDirty();message('Applied JSON to the editor. Save a version to retain it.'); }));
$('save').addEventListener('click',() => run(() => save()));
$('save-next').addEventListener('click',() => run(async () => {
  if (!confirm('Keep the current edits as a new version after the latest saved version?')) return;
  const current=await request('/api/state');await save(current.latest.revision);
}));
$('load-latest').addEventListener('click',() => run(async () => { await refresh();await openVersion(state.latest.revision); }));
$('refresh').addEventListener('click',() => run(async () => {await refresh();message('Refreshed saved operations and merchant status.');}));
$('import-file').addEventListener('change',() => run(async () => {
  const file=$('import-file').files[0];if (!file) return;
  if (file.size>131072) throw new Error('Choose a plan up to 128 KiB.');
  if (dirty && !confirm('Keep the imported file as a new version and discard the unsaved editor changes?')) return;
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
  const saved=await operation('/api/import',{expectedRevision:baseRevision,text});
  await refresh();await adopt(saved);$('import-file').value='';message('Imported exact original source as version '+saved.revision+'.');
}));
$('review').addEventListener('click',() => run(async () => { review=await request('/api/review',{revision:active.revision});renderReview();message('Reviewed saved version '+active.revision+'.'); }));
for (const [id,kind] of [['download-plan','plan'],['download-source','source'],['download-review','review']])
  $(id).addEventListener('click',() => run(() => saveArtifact(kind,active.revision)));
$('prepare').addEventListener('click',() => run(async () => {
  const result=await operation('/api/prepare',selection());await refresh();message('Merchant package '+result.state.toLowerCase()+': '+result.id+'.');
}));
$('diagnose').addEventListener('click',() => run(async () => {
  const result=await operation('/api/diagnose',selection());await refresh();message('Provider diagnosis '+result.state.toLowerCase()+'. Open its retained operation below.');
}));
$('compare').addEventListener('click',() => run(async () => {
  const result=await request('/api/compare',{before:Number($('compare-before').value),after:Number($('compare-after').value)});
  $('comparison').replaceChildren();
  if (!result.changes.length) $('comparison').append(node('p','The public plans are identical.',{class:'muted'}));
  else $('comparison').append(table(['Field','Earlier version','Later version'],result.changes.map(row => [row.field,
    node('pre',json(row.before)),node('pre',json(row.after))])));
}));
$('example').addEventListener('click',() => {const selected=review?.routes.find(row => row.method===$('buyer-method').value);if(selected)$('buyer-body').value=json(selected.example);});
$('buyer').addEventListener('click',() => run(async () => {
  const result=await operation('/api/buyer',{...selection(),packageId:$('buyer-package').value,method:$('buyer-method').value,
    intentId:$('buyer-intent').value,bodyText:$('buyer-body').value});await refresh();
  message('Buyer preparation '+result.state.toLowerCase()+'. Download its original review and request from saved operations.');
}));
$('start').addEventListener('click',() => run(async () => {
  const selected=selection();if(!confirm('Start this reviewed merchant version in the launcher’s '+state.runtime.launchMode.toLowerCase()+' mode?'))return;
  const result=await operation('/api/start',{...selected,packageId:$('runtime-package').value});await refresh();
  message('Merchant start '+result.state.toLowerCase()+'. Original operations are available above.');
}));
$('stop').addEventListener('click',() => run(async () => {
  if(!confirm('Drain admitted requests and stop the current merchant?'))return;
  await request('/api/stop',{instanceId:state.runtime.instanceId});await refresh();message('Merchant drained and stopped.');
}));
$('older-actions').addEventListener('click',() => run(async () => {
  const page=await request('/api/actions?before='+encodeURIComponent(nextActions));
  actionPage.push(...page.items);nextActions=page.next;renderActions();
}));
window.addEventListener('beforeunload',event => {if(dirty){event.preventDefault();event.returnValue='';}});
await run(async () => {await refresh(false);message('Workspace reopened. Choose a saved version or edit the merchant plan.');});
