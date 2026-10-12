// MIT. Operator forms for the original retained connection and Applications workflow.
const $ = id => document.getElementById(id);
const node = (tag, value, className) => { const item = document.createElement(tag);
  if (value !== undefined && value !== null) item.textContent = String(value);
  if (className) item.className = className; return item; };
const LIMITS = [
  ['timeoutMs','Provider timeout, ms',1000,60000],['maxResponseBytes','Maximum response, bytes',1024,1048576],
  ['maxInFlight','Concurrent provider requests',1,64],['dayAttempts','Daily request attempts',1,1000000],
  ['dayCredits','Daily budget',1,1000000000],['creditsPerAttempt','Budget per attempt',1,1000000],
  ['perSecond','Requests per second',1,1000],['minProviderCredits','Minimum provider credit balance',0,1000000000],
  ['quotaFreshnessMs','Quota observation age, ms',1000,3600000],['maxRecords','Retained request records',1,1000000],
  ['maxStoredBodyBytes','Retained response bytes',1048576,1073741824],
];
let state = null, selectedSource = null, selectedReview = null, selectedPackage = null;
let selectedApplicationReview = null, selectedLaunchReview = null, applications = null;
let busy = false, historyRows = [], historyAfter = null, pending = null;
const tokenKey = 'blockscout-connection-token:' + location.origin;
const pendingKey = 'blockscout-connection-pending:' + location.origin;
let token = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(token)) {
  sessionStorage.setItem(tokenKey, token);
  history.replaceState(null, '', location.pathname + location.search);
} else token = sessionStorage.getItem(tokenKey) ?? '';
try { pending = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'); } catch {}
function notice(message = '', error = false) {
  $('notice').textContent = message; $('notice').dataset.error = String(error);
}
function controls() {
  document.body.classList.toggle('busy', busy);
  for (const element of document.querySelectorAll('button,input,select')) {
    const locked = element.dataset.locked === 'true' || element.closest('fieldset[data-locked="true"]');
    element.disabled = busy || Boolean(locked);
  }
  $('history-more').hidden = !historyAfter;
}
function button(label, action, locked = false) {
  const value = node('button', label); value.type = 'button'; value.dataset.locked = String(locked);
  value.addEventListener('click', () => work(action)); return value;
}
function detail(container, rows) {
  const dl = node('dl');
  for (const [label, value] of rows) { dl.append(node('dt', label), node('dd', value ?? '—')); }
  container.replaceChildren(dl);
}
function table(container, headers, rows, empty = 'No saved records yet.') {
  container.replaceChildren();
  if (!rows.length) { container.append(node('p', empty, 'empty')); return; }
  const t = node('table'), head = node('thead'), headRow = node('tr'), body = node('tbody');
  headers.forEach(value => headRow.append(node('th', value))); head.append(headRow); t.append(head, body);
  for (const row of rows) {
    const tr = node('tr');
    for (const value of row) { const td = node('td');
      td.append(value instanceof Node ? value : node('span', value ?? '—')); tr.append(td); }
    body.append(tr);
  }
  container.append(t);
}
function time(value) { return value ? value.replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC') : '—'; }
function terms(container, plan) {
  container.replaceChildren();
  const summary = node('div');
  detail(summary, [['Merchant public origin', plan.publicOrigin], ['Payment network', plan.payment.network],
    ['Payment asset', plan.payment.asset], ['Merchant recipient', plan.payment.payTo],
    ['Payment timeout, seconds', plan.payment.maxTimeoutSeconds]]);
  const routes = node('div', undefined, 'table-wrap');
  table(routes, ['Data chain','Name','Atomic price'], plan.chains.map(row => [row.chainId,row.name,row.amountAtomic]));
  container.append(summary, routes);
}
function show(page) {
  for (const section of document.querySelectorAll('[data-section]')) section.hidden = section.dataset.section !== page;
  for (const item of document.querySelectorAll('[data-page]')) {
    if (item.dataset.page === page) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
}
async function request(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'omit',
    redirect: 'error', headers: { 'x-blockscout-connection-token': token,
      ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error?.message ?? value.error ?? 'The workspace request failed.');
    error.code = value.error?.code; error.requestId = value.error?.requestId;
    if (response.status === 401) { $('access').hidden = false; $('desk').hidden = true; }
    throw error;
  }
  return value;
}
async function act(action, payload) {
  const body = JSON.stringify(payload);
  const id = pending?.action === action && JSON.stringify(pending.payload) === body
    ? pending.requestId : crypto.randomUUID();
  pending = { action, payload, requestId: id, workspaceId: state?.workspaceId ?? null };
  try { sessionStorage.setItem(pendingKey, JSON.stringify(pending)); } catch {}
  const result = await request('/api/actions/' + action, { ...payload, requestId: id });
  pending = null; sessionStorage.removeItem(pendingKey); renderPending();
  return result;
}
async function work(fn) {
  if (busy) return;
  busy = true; controls(); notice('Working with the original saved operation…');
  try { await fn(); }
  catch (error) {
    notice((error.code ? error.code + ': ' : '') + error.message +
      (error.requestId ? ' Saved request: ' + error.requestId + '. Reopen it in History.' : ''), true);
    renderPending();
  } finally { busy = false; controls(); }
}
function chooseOptions(select, rows, selected, emptyLabel = 'Choose a saved item') {
  select.replaceChildren();
  const first = node('option', emptyLabel); first.value = ''; select.append(first);
  rows.forEach(([id,label]) => { const option = node('option',label); option.value = id; select.append(option); });
  select.value = rows.some(row => row[0] === selected) ? selected : '';
}
function selectSource(row) {
  selectedSource = row; selectedReview = null;
  $('source-detail').hidden = false;
  $('source-title').textContent = row.filename;
  detail($('source-summary'), [['Input type',row.kind === 'bundle' ? 'Complete connection bundle' : 'Token merchant plan'],
    ['Source SHA-256',row.sha256],['Plan SHA-256',row.planSha256],['Provider',row.connection.providerName],
    ['Provider origin',row.connection.origin],['Account alias',row.plan.accountAlias],['Retained at',time(row.createdAt)]]);
  terms($('source-terms'),row.plan);
  const c = row.connection;
  $('connection-intro').textContent = row.kind === 'bundle'
    ? 'This complete bundle retains its original connection review. Receive that exact review on this host.'
    : 'Review this input’s provider connection and local account limits. Payment terms and atomic prices remain visible below.';
  $('connection-fields').dataset.locked = String(row.kind === 'bundle');
  $('connection-mode').value = c.mode; $('provider-name').value = c.providerName;
  $('provider-origin').value = c.origin;
  chooseOptions($('provider-chain'),row.plan.chains.map(item=>[item.chainId,item.name+' ('+item.chainId+')']),c.chainId ?? row.plan.chains[0].chainId);
  $('provider-auth').value = c.authentication.kind;
  $('account-alias').value = row.plan.accountAlias; $('credential-env').value = row.plan.apiKeyEnv;
  $('provider-source').value = c.sourceUrl; $('provider-reviewed').value = row.kind === 'bundle' ? c.reviewedAt : new Date().toISOString();
  for (const [key] of LIMITS) $('limit-'+key).value = String(row.plan.limits[key]);
  $('connection-review').hidden = true;
  $('review-connection').textContent = row.kind === 'bundle' ? 'Retain original bundle review' : 'Create connection review';
  modeControls(false); controls();
}
function modeControls(adjust) {
  if (!selectedSource) return;
  const pro = $('connection-mode').value === 'pro';
  $('provider-origin').dataset.locked = String(pro);
  $('provider-chain').dataset.locked = String(pro);
  $('provider-auth').dataset.locked = String(pro);
  if (pro) { $('provider-origin').value = 'https://api.blockscout.com'; $('provider-auth').value = 'bearer'; }
  else if (adjust && $('provider-origin').value === 'https://api.blockscout.com') $('provider-origin').value = '';
  if (!pro && adjust) {
    $('limit-creditsPerAttempt').value = '1'; $('limit-minProviderCredits').value = '0';
    $('limit-dayCredits').value = $('limit-dayAttempts').value;
  }
  for (const name of ['dayCredits','creditsPerAttempt','minProviderCredits'])
    $('limit-'+name).dataset.locked = String(!pro);
  controls();
}
function changesFromForm() {
  const mode = $('connection-mode').value, kind = $('provider-auth').value;
  const connection = { schema: 'stellar-forge.blockscout-connection.v1', mode,
    origin: $('provider-origin').value.trim(), providerName: $('provider-name').value.trim(),
    sourceUrl: $('provider-source').value.trim(), reviewedAt: $('provider-reviewed').value.trim(),
    authentication: { kind, ...(kind === 'api-key-header' ? {header:'x-api-key'} : {}) },
    ...(mode === 'instance' ? {chainId:$('provider-chain').value} : {}) };
  const limits = {};
  for (const [key] of LIMITS) {
    const raw = $('limit-'+key).value;
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('Enter a whole-number value for '+key+'.');
    limits[key] = Number(raw);
  }
  return { connection, accountAlias:$('account-alias').value.trim(),
    apiKeyEnv:$('credential-env').value.trim(), limits };
}
function brief(value) {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map(brief).join('; ');
  if (typeof value === 'object') return Object.entries(value).map(([key,item])=>key+': '+brief(item)).join(' · ');
  return String(value);
}
function showReview(row, result = {}) {
  selectedReview = row;
  $('connection-review').hidden = false;
  const r = row.displayReview ?? row.review;
  detail($('review-summary'), [['Original review SHA-256',r.reviewSha256],['Plan SHA-256',r.planSha256],
    ['Provider',r.connection.providerName],['Provider origin',r.connection.origin],
    ['Account alias',r.plan.accountAlias],['Credential environment',r.connection.credentialEnvironment ?? 'Anonymous access'],
    ['Merchant state',r.requiresNewMerchantState ? 'Use a separate merchant state for this provider/account change.' : 'The same account’s existing merchant state can be retained.']]);
  table($('review-changes'),['Reviewed setting','Original value','Selected value'],
    r.changes.map(item=>[item.name,brief(item.before),brief(item.after)]),'The original connection settings are retained.');
  terms($('review-terms'),r.plan);
  $('package-destination').value = result.suggestedDirectory ?? state.directory+'/received/'+row.id;
  $('prepare-package').textContent = row.receiveOriginalBundle ? 'Receive original bundle' : 'Prepare private package';
}
function selectPackage(row, navigate = false) {
  selectedPackage = row; $('package-detail').hidden = false;
  detail($('package-summary'),[['Private package',row.directory],['Account alias',row.plan.accountAlias],
    ['Provider origin',row.connection.origin],['Plan SHA-256',row.planSha256],
    ['Complete bundle bytes',row.bundle.bytes],['Complete bundle SHA-256',row.bundle.sha256]]);
  terms($('package-terms'),row.plan);
  $('application-package').textContent = 'Package: '+row.directory+' · '+row.plan.accountAlias;
  $('application-label').value = row.connection.providerName+' — '+row.plan.accountAlias;
  $('merchant-state').value = state.directory+'/merchant-state/'+row.reviewId.slice(0,24);
  $('application-review').hidden = true; $('launch-review').hidden = true;
  selectedApplicationReview = null; selectedLaunchReview = null;
  if (navigate) show('packages');
}
function render() {
  $('workspace-location').textContent = state.directory;
  $('access').hidden = true; $('desk').hidden = false;
  table($('sources'),['Input','Type','Provider account','Retained','Open'],
    state.sources.map(row=>[row.filename,row.kind,row.plan.accountAlias,time(row.createdAt),
      button('Open',async()=>{selectSource(row);notice('Opened the original saved input.');})]));
  table($('saved-reviews'),['Provider account','Provider origin','Retained','Open'],
    state.reviews.map(row=>[row.connection.accountAlias,row.connection.origin,time(row.createdAt),button('Open review',async()=>{
      const full=await request('/api/records/reviews/'+row.id);
      const original=state.sources.find(source=>source.id===full.sourceId);
      if(original)selectSource(original);showReview(full);show('connection');notice('Reopened the same original connection review.');
    })]));
  table($('packages'),['Provider account','Private package','Retained','Open'],
    state.packages.map(row=>[row.plan.accountAlias,row.directory,time(row.createdAt),
      button('Open',async()=>{selectPackage(row);notice('Opened the saved package identity.');})]));
  const old = $('applications-binding').value;
  chooseOptions($('applications-binding'),state.bindings.map(row=>[row.id,row.directory]),
    old || state.bindings[0]?.id);
  if (!selectedSource && state.sources.length) selectSource(state.sources.at(-1));
  if (!selectedPackage && state.packages.length) selectPackage(state.packages.at(-1));
  $('application-form').querySelector('button[type=submit]').dataset.locked = String(!selectedPackage);
  renderPending();
}
async function reload({ apps = true } = {}) {
  state = await request('/api/state'); render();
  if (apps && $('applications-binding').value) await loadApplications();
  await loadHistory(false); controls();
}
async function loadApplications() {
  const id = $('applications-binding').value;
  if (!id) { applications=null; $('applications-list').replaceChildren(node('p','Connect the existing Applications workspace.','empty')); return; }
  applications = await request('/api/applications/'+id);
  $('applications-directory').value = applications.binding.directory;
  const old = $('application-runtime').value;
  chooseOptions($('application-runtime'),applications.runtimes.map(row=>[row.id,
    row.label+' · '+row.phase+' · '+(row.packageVersion??row.directory)]),old,'Select an installed runtime');
  const container = $('applications-list'); container.replaceChildren();
  if (!applications.applications.length) container.append(node('p','No merchant application has been saved from this connection workspace.','empty'));
  for (const app of applications.applications) {
    const card=node('article',undefined,'card'); card.append(node('h4',app.label),node('span',app.phase,'status'));
    const summary=node('div');
    detail(summary,[['Application',app.id],['Private merchant state',app.settings?.stateDirectory],
      ['Package',app.settings?.packageDirectory],['Runtime',app.runtime?.directory],['Current operation',app.current?.id ?? app.current?.operationId],
      ['Retained runs',app.totalRuns]]);
    card.append(summary);
    const actions=node('div',undefined,'actions'), current=app.current;
    actions.append(button('Reopen runtime connection',async()=>{
      await act('reconnect',{applicationId:app.id});await reload();notice('Reopened the original Applications runtime connection.');
    }));
    actions.append(button('Review launch',async()=>{
      const result=await act('launch-review',{applicationId:app.id});selectedLaunchReview=result.review;
      $('launch-review').hidden=false;
      const r=result.review.original;
      detail($('launch-review-summary'),[['Application',app.label],['Application revision',r.applicationRevision],
        ['Runtime',r.runtime.directory],['Runtime source',r.runtime.sourceCommit],['Managed release',r.releaseId],
        ['Package',app.settings.packageDirectory],['Merchant state',app.settings.stateDirectory],['Facilitator',app.settings.facilitator]]);
      show('applications');notice('The original launch inputs are retained for this application review.');
    },Boolean(current?.active)));
    if (current) {
      const runId=current.id ?? current.operationId;
      if (runId) {
        actions.append(button('Read original output',async()=>{
          const result=await request('/api/output/'+app.id+'/'+runId);
          $('output-text').textContent=result.output.text || 'The original operation has not written output.';
          $('application-output').hidden=false;notice('Opened the original retained process output.');
        }));
        actions.append(button('Recover this run',async()=>{
          await act('recover-run',{applicationId:app.id,operationId:runId});await reload();notice('Reconciled the same original run.');
        },Boolean(current.active)));
        actions.append(button('Stop this run',async()=>{
          await act('stop',{applicationId:app.id,operationId:runId});await reload();notice('Requested the original merchant’s graceful stop.');
        },!current.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(current.phase)));
      }
      if (current.privateUrl) {
        try {
          const url=new URL(current.privateUrl);
          if (url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)) {
            const link=node('a','Open running provider desk');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
          }
        } catch {}
      }
    }
    card.append(actions);container.append(card);
  }
  controls();
}
function renderPending() {
  $('pending-request').replaceChildren();
  if (!pending || state && pending.workspaceId && pending.workspaceId!==state.workspaceId) return;
  const card=node('article',undefined,'card');
  card.append(node('h3','Request awaiting receiving'),node('p',pending.action+' · '+pending.requestId));
  card.append(button('Reopen this exact request',async()=>{
    const current=pending;
    await request('/api/actions/'+current.action,{...current.payload,requestId:current.requestId});
    pending=null;sessionStorage.removeItem(pendingKey);await reload();notice('Reopened the exact saved request.');
  }));
  $('pending-request').append(card);
}
async function loadHistory(more) {
  const result=await request('/api/history?limit=30'+(more&&historyAfter?'&after='+encodeURIComponent(historyAfter):''));
  historyRows=more?[...historyRows,...result.items]:result.items;historyAfter=result.nextAfter;
  table($('history'),['Action','State','Original request','Receiving'],
    historyRows.map(row=>{
      const actions=node('div',undefined,'actions');
      actions.append(button('Open',async()=>{
        const full=await request('/api/records/operations/'+row.id);
        $('operation-detail').hidden=false;
        detail($('operation-summary'),[['Action',full.action],['State',full.status],['Request',full.id],
          ['Created',time(full.createdAt)],['Completed',time(full.completedAt)],['Receiving attempts',full.attempts],
          ['Error',full.error?.message],['Result',brief(full.result && Object.fromEntries(
            Object.entries(full.result).filter(([key])=>!['source','review'].includes(key))))]]);
        notice('Opened the original operation record.');
      }));
      if(row.status==='COMPLETED' && row.result?.review) actions.append(button('Continue review',async()=>{
        const saved=row.result.review;
        if(row.action==='review'){
          const original=state.sources.find(item=>item.id===saved.sourceId);if(original)selectSource(original);
          showReview(await request('/api/records/reviews/'+saved.id));show('connection');
        }else if(row.action==='application-review'){
          selectedApplicationReview=saved;$('application-review').hidden=false;
          const r=saved.original;
          detail($('application-review-summary'),[['Merchant',r.label],['Runtime',r.runtime.directory],
            ['Package',r.settings.packageDirectory],['Merchant state',r.settings.stateDirectory],
            ['Facilitator',r.settings.facilitator],['Review',r.id]]);show('applications');
        }else if(row.action==='launch-review'){
          selectedLaunchReview=saved;$('launch-review').hidden=false;
          const r=saved.original;
          detail($('launch-review-summary'),[['Application',r.applicationId],['Application revision',r.applicationRevision],
            ['Runtime',r.runtime.directory],['Runtime source',r.runtime.sourceCommit],['Managed release',r.releaseId]]);
          show('applications');
        }
        notice('Reopened the retained review and its original receiving action.');
      }));
      if(row.status!=='COMPLETED') actions.append(button('Recover',async()=>{
        await request('/api/actions/resume',{operationId:row.id});await reload();notice('Reopened the same operation and retained its result.');
      }));
      return[row.action,row.status,node('code',row.id),actions];
    }));
}
for(const [key,label,min,max] of LIMITS){
  const item=node('label',label),input=node('input');input.id='limit-'+key;input.type='number';
  input.min=String(min);input.max=String(max);input.step='1';input.required=true;item.append(input);$('limit-fields').append(item);
}
for(const item of document.querySelectorAll('[data-page]'))item.addEventListener('click',()=>show(item.dataset.page));
$('access-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
  const value=$('access-token').value.trim();let candidate=value;
  try{candidate=new URL(value).hash.slice(1);}catch{}
  if(!/^[a-f0-9]{64}$/.test(candidate))throw new Error('Use the private URL or token printed by the running workspace.');
  token=candidate;sessionStorage.setItem(tokenKey,token);$('access-token').value='';await reload();notice('Opened the saved connection workspace.');
});});
$('refresh').addEventListener('click',()=>work(async()=>{await reload();notice('Reopened the saved workspace and original Applications state.');}));
$('input-file').addEventListener('change',()=>{$('input-file-note').textContent=$('input-file').files[0]?.name??'Choose the complete JSON input.';});
$('intake-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
  const file=$('input-file').files[0];if(!file)throw new Error('Select an input file.');
  if(file.size>2*1024*1024)throw new Error('The input exceeds 2 MiB.');
  const result=await act('intake',{filename:file.name,text:await file.text()});
  await reload({apps:false});selectSource(result.source);notice('Retained the complete input and original source hash.');
});});
$('use-source').addEventListener('click',()=>show('connection'));
$('connection-mode').addEventListener('change',()=>modeControls(true));
$('limit-dayAttempts').addEventListener('input',()=>{if($('connection-mode').value==='instance')$('limit-dayCredits').value=$('limit-dayAttempts').value;});
$('connection-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
  if(!selectedSource)throw new Error('Select a saved input first.');
  const payload={sourceId:selectedSource.id};
  if(selectedSource.kind!=='bundle')payload.changes=changesFromForm();
  const result=await act('review',payload);showReview(result.review,result);await reload({apps:false});
  notice('Retained the original connection review. Review its payment terms and package destination below.');
});});
$('prepare-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
  if(!selectedReview)throw new Error('Create or open a connection review first.');
  const result=await act('prepare',{reviewId:selectedReview.id,directory:$('package-destination').value.trim()});
  await reload({apps:false});selectPackage(result.package,true);notice(result.status+': the complete private package is ready.');
});});
$('download-package').addEventListener('click',()=>work(async()=>{
  if(!selectedPackage)throw new Error('Select a package.');
  const response=await fetch('/api/packages/'+selectedPackage.id,{headers:{'x-blockscout-connection-token':token},credentials:'omit',redirect:'error'});
  if(!response.ok){const value=await response.json();throw new Error(value.error?.message??'The original package could not be reopened.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=node('a');
  a.href=url;a.download='blockscout-connection-'+selectedPackage.planSha256+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notice('Exported the complete original connection bundle.');
}));
$('use-package').addEventListener('click',()=>show('applications'));
$('applications-connect-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
  const result=await act('connect',{directory:$('applications-directory').value.trim()});
  await reload({apps:false});$('applications-binding').value=result.binding.id;await loadApplications();notice('Connected the original Applications workspace.');
});});
$('applications-binding').addEventListener('change',()=>work(async()=>{await loadApplications();notice('Opened the selected Applications binding.');}));
$('application-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
  if(!selectedPackage)throw new Error('Select the prepared package.');
  const settings={stateDirectory:$('merchant-state').value.trim(),facilitator:$('facilitator').value.trim(),
    drainGraceMs:$('drain-grace').value.trim(),allowLocalFacilitator:$('allow-local').checked};
  if($('environment-file').value.trim())settings.environmentFile=$('environment-file').value.trim();
  for(const [key,id] of [['port','merchant-port'],['operationsPort','operations-port'],['deskPort','desk-port']])settings[key]=Number($(id).value);
  const result=await act('application-review',{bindingId:$('applications-binding').value,runtimeId:$('application-runtime').value,
    packageId:selectedPackage.id,label:$('application-label').value.trim(),settings});
  selectedApplicationReview=result.review;$('application-review').hidden=false;
  const r=result.review.original;
  detail($('application-review-summary'),[['Merchant',r.label],['Runtime',r.runtime.directory],
    ['Runtime source',r.runtime.sourceCommit],['Package',r.settings.packageDirectory],['Merchant state',r.settings.stateDirectory],
    ['Facilitator',r.settings.facilitator],['Private environment file',r.settings.environmentFile??'Process environment'],
    ['Merchant / operations / desk ports',[r.settings.port,r.settings.operationsPort,r.settings.deskPort].join(' / ')],
    ['Review',r.id]]);
  notice('The original Applications review is ready to save.');
});});
$('save-application').addEventListener('click',()=>work(async()=>{
  if(!selectedApplicationReview)throw new Error('Review the application first.');
  const result=await act('application-save',{reviewId:selectedApplicationReview.id});
  await reload();notice(result.connectionError?'Application saved. Reopen its runtime connection below: '+result.connectionError.message:'Saved the merchant in the original Applications workspace.');
}));
$('start-application').addEventListener('click',()=>work(async()=>{
  if(!selectedLaunchReview)throw new Error('Review the original launch first.');
  const result=await act('launch',{reviewId:selectedLaunchReview.id});
  $('launch-review').hidden=true;await reload();notice('Original Applications run: '+result.operationId+'. Refresh to observe startup.');
}));
$('history-more').addEventListener('click',()=>work(async()=>{await loadHistory(true);notice('Opened the next saved operation page.');}));
if(!/^[a-f0-9]{64}$/.test(token)){$('access').hidden=false;$('desk').hidden=true;notice('Open the private startup URL to continue.');}
else await work(async()=>{await reload();notice('Opened the original saved connection workspace.');});
