// MIT. Complete paired receiving operator over original saved cutover operations.
import {createDraftStore} from '/local-draft-store.mjs';
const $=id=>document.getElementById(id),copy=value=>structuredClone(value),pretty=value=>JSON.stringify(value,null,2);
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const kinds={get:'Value',hash:'Hash fields','sorted-set':'Sorted set',stream:'Stream',list:'List',set:'Set'};
const tokenKey='redis-cutover-token:'+location.origin;
let token=location.hash.slice(1);
if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem(tokenKey,token);history.replaceState(null,'',location.pathname+location.search);}
else token=sessionStorage.getItem(tokenKey)??'';
let state,draft,storage,storageId,pending,review,checkIndex=0,draftBase=null,busy=false,dirty=false;
let browserWriter=false,controlDirectory=null,controlRelease=null,controlTask=null,pendingCreation=null;
let historyRows=[],historyCursor=null,pollTimer=null,draftTimer=null,difference=null,differenceBack=[],activeTab='contract';
const status=(text,error=false)=>{$('cutover-status').textContent=text;$('cutover-status').dataset.error=String(error);};
function el(name,text,className){const node=document.createElement(name);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function action(text,fn){const node=el('button',text);node.type='button';node.addEventListener('click',()=>guard(fn));return node;}
function table(headers,rows){
  const node=el('table'),head=el('thead'),header=el('tr'),body=el('tbody');
  headers.forEach(value=>header.append(el('th',value)));head.append(header);
  for(const values of rows){const row=el('tr');for(const value of values){const cell=el('td');
    cell.append(value instanceof Node?value:el('span',typeof value==='object'?JSON.stringify(value):String(value??'')));row.append(cell);}body.append(row);}
  node.append(head,body);return node;
}
async function sha(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');}
function requireWriter(){
  if(!browserWriter)throw new Error('This tab is viewing the original cutover. Close its editing tab, then choose Take editing control here.');
}
function renderControl(){
  $('cutover-control-state').dataset.owner=String(browserWriter);
  $('cutover-control-state').textContent=browserWriter
    ?'This tab owns the complete draft and retained requests for this receiving directory.'
    :navigator.locks?'Read-only view. Another tab retains this directory’s complete draft and original requests.'
      :'Read-only view. Use a browser with Web Locks to retain one original editing owner.';
  $('cutover-take-control').hidden=browserWriter||!navigator.locks;
}
async function acquireBrowserWriter(directory){
  if(controlDirectory===directory&&browserWriter)return true;
  if(controlDirectory&&controlDirectory!==directory)throw new Error('Keep the current original directory in this operator tab.');
  controlDirectory=directory;
  if(!navigator.locks){renderControl();return false;}
  const name='redis-cutover-directory:'+await sha(directory);
  await new Promise((ready,failed)=>{
    controlTask=navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},async lock=>{
      browserWriter=Boolean(lock);renderControl();ready();
      if(lock)await new Promise(release=>{controlRelease=release;});
      browserWriter=false;controlRelease=null;renderControl();
    });
    controlTask.catch(failed);
  });
  controls();return browserWriter;
}
async function request(path,input){
  if(input!==undefined&&path!=='/api/review')requireWriter();
  const response=await fetch(path,{method:input===undefined?'GET':'POST',headers:{'x-workspace-token':token,
    ...(input===undefined?{}:{'content-type':'application/json'})},...(input===undefined?{}:{body:JSON.stringify(input)}),cache:'no-store'});
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error(value.message??value.error??'The original cutover request failed.'),
    {code:value.error??'HTTP_ERROR',httpStatus:response.status,details:value.details??null});
  return value;
}
function query(path,values){return path+'?'+new URLSearchParams(Object.entries(values).filter(([,value])=>value!==undefined&&value!==null));}
function parse(id,label,kind='object'){
  let value;try{value=JSON.parse($(id).value);}catch{throw new Error('Correct the complete JSON for '+label+'.');}
  if(kind==='array'?!Array.isArray(value):!value||typeof value!=='object'||Array.isArray(value))
    throw new Error(label+' must be a JSON '+kind+'.');
  return value;
}
function integer(id,label){const value=$(id).value;if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))
  throw new Error('Use an integer for '+label+'.');return Number(value);}
function showTab(tab){
  activeTab=tab;document.querySelectorAll('[data-cutover-tab]').forEach(node=>node.setAttribute('aria-current',node.dataset.cutoverTab===tab?'page':'false'));
  document.querySelectorAll('.panel').forEach(node=>{node.hidden=node.id!=='cutover-panel-'+tab;});
}
function rawForm(){return Object.fromEntries([...document.querySelectorAll('#cutover-contract-fields input[id],#cutover-contract-fields select[id],#cutover-contract-fields textarea[id]')]
  .map(node=>[node.id,node.type==='checkbox'?node.checked:node.value]));}
async function retainDraft(){
  if(!storage||!draft||!browserWriter)return;
  await storage.writeDraft({workspaceId:storageId,directory:state.directory,edition:state.edition,
    input:copy(draft),raw:rawForm(),checkIndex,dirty,expectedDraftSha256:draftBase,
    sourceInputCanonicalSha256:state.inputCanonicalSha256});
  $('cutover-draft-state').textContent=state.bound
    ?'This original receiving input is bound. New edition keeps its parent and receives corrected source data afresh.'
    :dirty?'Complete local edits retained in this browser. Save and review them before receiving.':'Complete saved draft loaded.';
}
function changed(){
  if(state?.bound||!browserWriter)return;dirty=true;review=null;$('cutover-review-result').hidden=true;controls();
  clearTimeout(draftTimer);draftTimer=setTimeout(()=>retainDraft().catch(error=>status(error.message,true)),180);
}
function reducedSetup(setup){
  const result=copy(setup);delete result.source.queries;delete result.plan.routes;delete result.plan.payment;return result;
}
function applyCheck(){
  const previous=draft.checks[checkIndex];if(!previous)return;
  const id=$('cutover-check-id').value.trim(),queryName=$('cutover-check-query').value;
  const value={id,query:queryName,input:parse('cutover-check-input','the native example input'),
    allPages:$('cutover-check-all').checked,maxPages:integer('cutover-check-pages','maximum pages'),
    maxRows:integer('cutover-check-rows','maximum collected rows'),expected:parse('cutover-check-expected','the complete expected result')};
  const oldRule=draft.comparisons.find(item=>item.checkId===previous.id);
  if(!oldRule)throw new Error('Keep one original comparison rule for every receiving example.');
  draft.checks[checkIndex]=value;oldRule.checkId=id;oldRule.mode=$('cutover-check-mode').value;
}
function capture(){
  if(state.bound)return copy(state.input);
  applyCheck();
  draft.operationId=$('cutover-operation').value.trim();
  draft.maxComparisonBytes=integer('cutover-comparison-bytes','comparison byte budget');
  draft.consistency={mode:$('cutover-consistency-mode').value,reference:$('cutover-consistency-reference').value,
    approvedBy:$('cutover-approved-by').value.trim()};
  const queries=parse('cutover-queries','the shared read products'),routes=parse('cutover-routes','the shared merchant routes','array'),
    payment=parse('cutover-payment','the shared payment terms');
  for(const side of ['baseline','candidate']){
    const profile=parse('cutover-'+side,side+' source setup');
    if(!profile.source||!profile.plan||Object.hasOwn(profile.source,'queries')||Object.hasOwn(profile.plan,'routes')||Object.hasOwn(profile.plan,'payment'))
      throw new Error('Keep shared queries, routes and payment terms in their dedicated common editors.');
    profile.source.queries=copy(queries);profile.plan.routes=copy(routes);profile.plan.payment=copy(payment);
    draft[side].setup=profile;draft[side].checks=copy(draft.checks);
  }
  if($('cutover-release-enabled').checked)draft.release=parse('cutover-release','the candidate release');
  else delete draft.release;
  const value=copy(draft);delete value.checks;return value;
}
function fromInput(input){
  draft=copy(input);draft.checks=copy(input.baseline.checks);checkIndex=Math.min(checkIndex,draft.checks.length-1);checkIndex=Math.max(0,checkIndex);
}
function renderCheck(){
  const selected=draft.checks[checkIndex];if(!selected)return;
  const declarations=draft.baseline.setup.source.queries;
  $('cutover-check-query').replaceChildren(...Object.keys(declarations).map(name=>{const option=el('option',name+' · '+(kinds[declarations[name].kind]??declarations[name].kind));option.value=name;return option;}));
  $('cutover-check-id').value=selected.id;$('cutover-check-query').value=selected.query;
  $('cutover-check-input').value=pretty(selected.input);$('cutover-check-expected').value=pretty(selected.expected);
  $('cutover-check-pages').value=selected.maxPages??100;$('cutover-check-rows').value=selected.maxRows??10000;
  $('cutover-check-all').checked=selected.allPages??false;
  $('cutover-check-mode').value=draft.comparisons.find(value=>value.checkId===selected.id)?.mode??'ordered';
}
function renderMatrix(){
  $('cutover-check-matrix').replaceChildren(table(['Example','Source product','Read kind','Collection','Rule','Expected'],draft.checks.map((value,index)=>[
    action(value.id,async()=>{if(!state.bound){capture();await retainDraft();}checkIndex=index;renderCheck();renderMatrix();await retainDraft();}),
    value.query,kinds[draft.baseline.setup.source.queries[value.query]?.kind]??'Unresolved',value.allPages?'Every page':'First page',
    draft.comparisons.find(item=>item.checkId===value.id)?.mode??'Missing',Object.keys(value.expected??{}).join(', ')])));
}
function renderDraft(){
  $('cutover-operation').value=draft.operationId;$('cutover-comparison-bytes').value=draft.maxComparisonBytes??67108864;
  $('cutover-consistency-mode').value=draft.consistency.mode;$('cutover-consistency-reference').value=draft.consistency.reference;
  $('cutover-approved-by').value=draft.consistency.approvedBy;
  for(const side of ['baseline','candidate'])$('cutover-'+side).value=pretty(reducedSetup(draft[side].setup));
  $('cutover-queries').value=pretty(draft.baseline.setup.source.queries);$('cutover-routes').value=pretty(draft.baseline.setup.plan.routes);
  $('cutover-payment').value=pretty(draft.baseline.setup.plan.payment);
  $('cutover-release-enabled').checked=Boolean(draft.release);
  $('cutover-release').value=pretty(draft.release??{releaseId:'received-valkey-application',label:'Received Valkey application'});
  $('cutover-release-label').hidden=!draft.release;renderCheck();renderMatrix();controls();
}
function sourceCard(binding){
  if(!binding)return el('p','The original saved workspace has not been created yet.','muted');
  if(binding.error)return el('p',binding.error.code+' · '+binding.error.message,'break');
  const node=el('div');node.append(el('p',binding.label),el('p',binding.workspaceId,'break'),
    el('p','Profile SHA256 '+binding.profileSha256,'muted break'),
    el('p','Current saved revision '+binding.head,'muted break'),
    el('p','Source: '+(binding.connection?.topology??'standalone')+' · '+(binding.environmentNames?.length?'Environment names: '+binding.environmentNames.join(', '):'No source variables required'),'muted'));
  return node;
}
function renderProgress(value=state){
  const p=value.attached?.progress??value.progress;
  $('cutover-state').textContent=value.state??state.state;
  const view=$('cutover-progress');view.replaceChildren();
  view.append(el('h3',value.attached?(value.attached.mode==='handover'?'Preparing complete handover':'Original operation running'):value.state??'Saved original operation'));
  if(p){
    view.append(el('p',[p.mode,p.side,p.phase,p.checkId].filter(Boolean).join(' · ')));
    view.append(el('p',[
      Number.isInteger(p.pageCount)?p.pageCount+' complete native pages':null,
      Number.isInteger(p.rowCount)?p.rowCount+' retained rows':null,
      p.members?p.members+' original archive members':null,p.file??null].filter(Boolean).join(' · ')));
    if(p.lastOperationId)view.append(el('p','Original native request '+p.lastOperationId,'muted break'));
    if(p.updatedAt)view.append(el('p','Last retained progress '+p.updatedAt,'muted'));
    if(p.error)view.append(el('pre',pretty(p.error)));
  }
  if(value.lastFailure)view.append(el('pre',pretty(value.lastFailure)));
  if(value.state==='RETAINED_RUNNING')view.append(el('p','This process has no attached run. Continue asks the original directory writer to resume; an existing live owner remains authoritative.','muted'));
  if(value.attached?.pauseRequested)view.append(el('p','Pause requested. The original current native operation finishes before its owner closes.'));
}
function renderResult(){
  const result=state.result;
  if(!result){$('cutover-result').replaceChildren(el('p','Complete paired outcomes appear here after original receiving.','empty'));return;}
  $('cutover-result').replaceChildren(el('h3','Retained paired outcome · '+result.status),table(
    ['Example','Rule','Baseline rows','Candidate rows','Rows / columns','Expected contract','Complete source'],result.comparisons.map(value=>[
      action(value.checkId,async()=>{showTab('differences');$('cutover-difference-check').value=value.checkId;selectDifferenceKind();await openDifference(0);}),
      value.mode,value.baselineRows,value.candidateRows,value.matched?'Matched':'Differences',
      value.expectationsMatch?'Matched':'Expected result differs',
      'Baseline '+value.windows.baseline.length+' pages · Candidate '+value.windows.candidate.length+' pages'])));
  const selected=$('cutover-difference-check').value;
  $('cutover-difference-check').replaceChildren(...result.comparisons.map(value=>{const option=el('option',value.checkId+' · '+value.mode);option.value=value.checkId;return option;}));
  if(result.comparisons.some(value=>value.checkId===selected))$('cutover-difference-check').value=selected;
  else selectDifferenceKind();
}
function renderHandover(){
  const value=state.handover,view=$('cutover-handover-result');view.replaceChildren();$('cutover-handover-members').replaceChildren();
  if(!value){view.append(el('p','Prepare a complete handover from the selected original receiving outcome.'));return;}
  view.append(el('h3',value.state),el('p','Original result SHA256 '+value.resultSha256,'break'));
  if(value.file)view.append(el('p',value.file.name,'break'));
  if(value.file?.sha256)view.append(el('p',value.file.bytes.toLocaleString()+' bytes · SHA256 '+value.file.sha256,'muted break'));
  if(value.members)$('cutover-handover-members').append(table(['Original member','Complete bytes','SHA256'],value.members.map(file=>[
    file.path,file.bytes.toLocaleString(),el('code',file.sha256,'break')])));
}
function renderState(){
  $('cutover-directory').textContent=state.directory;$('cutover-title').textContent=state.input.candidate.setup.label;
  $('cutover-edition-label').textContent=state.edition==='original'?'Original receiving edition':'Receiving edition '+state.edition;
  $('cutover-identity').textContent=state.operationId+' · Original input SHA256 '+state.inputSha256;
  for(const side of ['baseline','candidate'])$('cutover-'+side+'-binding').replaceChildren(sourceCard(state.bindings?.[side]));
  renderProgress();renderResult();renderHandover();controls();
}
function controls(){
  if(!state)return;
  $('cutover-contract-fields').disabled=busy||Boolean(pending);
  document.querySelectorAll('#cutover-contract-fields textarea,#cutover-contract-fields input:not([type="checkbox"])').forEach(node=>{node.readOnly=state.bound||!browserWriter;});
  document.querySelectorAll('#cutover-contract-fields select,#cutover-contract-fields input[type="checkbox"]').forEach(node=>{node.disabled=state.bound||!browserWriter;});
  for(const name of ['add-check','apply-check','remove-check'])$('cutover-'+name).disabled=busy||Boolean(pending)||state.bound;
  $('cutover-import').disabled=busy||Boolean(pending)||state.bound;
  $('cutover-save').disabled=busy||Boolean(pending)||state.bound;
  $('cutover-review').disabled=busy||Boolean(pending);
  const canStart=Boolean(review)&&!dirty&&!busy&&!pending&&!state.attached;
  $('cutover-create').disabled=!canStart;$('cutover-receive').disabled=!canStart;
  $('cutover-compare').disabled=!canStart||!state.result;
  $('cutover-handover').disabled=!canStart||!state.result;
  $('cutover-pause').disabled=busy||!state.attached||state.attached.pauseRequested;
  $('cutover-continue').disabled=busy||Boolean(pending)||Boolean(state.attached)||!['RETAINED_RUNNING','PAUSED','FAILED'].includes(state.state);
  $('cutover-download-handover').disabled=busy||state.handover?.state!=='READY';
  $('cutover-difference-open').disabled=busy||!state.result;$('cutover-difference-download').disabled=busy||!state.result;
  $('cutover-new').disabled=busy||Boolean(pending)||Boolean(state.attached);
  $('cutover-reset-local').disabled=busy||Boolean(pending);
  for(const side of ['baseline','candidate'])$('cutover-open-'+side).disabled=busy||Boolean(state.attached)||!state.bindings?.[side]||Boolean(state.bindings?.[side]?.error);
  $('cutover-close-editors').disabled=busy||Boolean(state.attached);
  $('cutover-pending').hidden=!pending;
  for(const name of ['add-check','apply-check','remove-check','import','save','create','receive','compare','handover','pause','continue',
      'new','new-submit','reset-local','open-baseline','open-candidate','close-editors','pending-continue','pending-finish','recover-edition'])
    if(!browserWriter)$('cutover-'+name).disabled=true;
  $('cutover-pending-read').disabled=busy||!browserWriter;
  $('cutover-pending-continue').disabled=busy||!browserWriter;
  $('cutover-pending-finish').disabled=busy||!browserWriter;
  $('cutover-new-submit').disabled=busy||!browserWriter;
  $('cutover-recover-edition').disabled=busy||!browserWriter||Boolean(pending)||Boolean(state.attached);
  if(pending){
    $('cutover-pending-description').textContent=pending.action+' · '+(pending.body.requestId??pending.operationId)+
      ' · '+(pending.error?.message??(pending.accepted?'Original request retained by the receiving owner.':'Exact request retained before dispatch.'));
    $('cutover-pending-finish').hidden=!pending.canFinish;
  }
}
async function pendingSave(){
  requireWriter();
  if(pending)await storage.writePending(pending);else await storage.deletePending();controls();
}
async function consume(value,{replaceDraft=false}={}){
  state=value;
  if(replaceDraft){fromInput(state.input);draftBase=state.draftSha256;dirty=false;review=null;renderDraft();await retainDraft();}
  renderState();await refreshHistory();schedulePoll();
}
async function sendAction(name,body){
  requireWriter();
  if(pending)throw new Error('Read or continue the original retained request before starting another mutation.');
  pending={workspaceId:storageId,directory:state.directory,edition:state.edition,action:name,body:copy(body),
    operationId:state.operationId,inputCanonicalSha256:state.inputCanonicalSha256,inputSha256:state.inputSha256,
    resultSha256:state.resultSha256,createdAt:new Date().toISOString()};
  await pendingSave();
  return dispatchPending();
}
async function dispatchPending(){
  const original=pending;if(!original)return;let value;
  try{value=await request('/api/'+original.action,original.body);}
  catch(error){
    pending=original;pending.error={code:error.code??'TRANSPORT_UNCERTAIN',message:error.message,httpStatus:error.httpStatus??null};
    pending.canFinish=Boolean(error.httpStatus&&error.httpStatus>=400&&error.httpStatus<500);
    await pendingSave();throw error;
  }
  // A returned provider result is retained before any subsequent UI/history
  // read. A rendering or storage failure never reclassifies that result.
  if(original.action==='start'){
    original.accepted=true;original.error=null;pending=original;await pendingSave();await consume(value);
    if(value.state==='COMPLETED'||value.handover?.state==='READY'&&original.body.mode==='handover')await reconcilePending(false);
  }else{
    pending=null;await pendingSave();
    if(original.action==='new-edition'){ $('cutover-new-dialog').close();await loadEdition(value.edition,{provided:value}); }
    else await consume(value,{replaceDraft:original.action==='save'});
  }
  return value;
}
async function reconcilePending(continueIt=false){
  if(!pending||!browserWriter)return;
  if(pending.directory!==state.directory||pending.edition!==state.edition)
    throw new Error('Return to the original receiving edition for this retained request.');
  if(pending.action!=='start'){
    if(continueIt)return dispatchPending();
    if(pending.action==='new-edition'){
      try{
        const child=await request(query('/api/state',{edition:pending.body.operationId}));
        if(child.origin?.requestId===pending.body.requestId&&child.origin.parentInputCanonicalSha256===pending.body.sourceInputCanonicalSha256&&
            child.creation?.requestId===pending.body.requestId&&child.creation.state==='COMPLETED'){
          pending=null;await pendingSave();$('cutover-new-dialog').close();return loadEdition(child.edition,{provided:child});
        }
      }catch(error){if(error.httpStatus!==404&&!['ENOENT','REDIS_CUTOVER_EDITION_INCOMPLETE'].includes(error.code))throw error;}
    }
    status('The exact '+pending.action+' request is retained. Continue sends the same original arguments.');return;
  }
  const current=await request(query('/api/state',{edition:pending.edition}));state=current;renderState();
  if(current.operationId!==pending.operationId||current.inputCanonicalSha256!==pending.inputCanonicalSha256){
    pending.canFinish=true;pending.error={code:'REDIS_CUTOVER_REVIEW_CHANGED',message:'The original saved input changed before this request was bound. Preserve these edits and review the current saved input.'};
    await pendingSave();return;
  }
  const mode=pending.body.mode;
  const complete=mode==='handover'?current.handover?.state==='READY'&&current.handover.resultSha256===pending.resultSha256:
    current.progress?.mode===mode&&current.progress.inputSha256===current.inputSha256&&current.progress.state==='COMPLETED';
  if(complete){
    pending=null;await pendingSave();renderState();status('Original '+mode+' outcome retained: '+(mode==='handover'?'HANDOVER READY':current.result?.status??current.progress.outcome));
    await refreshHistory();return;
  }
  pending.canFinish=!current.attached&&(['FAILED','PAUSED'].includes(current.progress?.state)||Boolean(current.lastFailure));
  await pendingSave();
  if(!continueIt||current.attached){schedulePoll();return;}
  if(mode==='handover'&&current.handover&&current.handover.state!=='READY'||
      current.progress?.mode===mode&&['RUNNING','PAUSED','FAILED'].includes(current.progress.state)){
    const value=await request('/api/continue',{edition:current.edition});await consume(value);
  }else{
    const retainedReview=await request('/api/review',{edition:current.edition});
    if(retainedReview.inputCanonicalSha256!==pending.inputCanonicalSha256)
      throw new Error('The retained operation belongs to different complete source input.');
    // Only the raw-file preimage can advance from a draft to its original bound
    // selection. Every source byte and original native operation ID stays pinned.
    pending.previousReviewDigest??=pending.body.digest;pending.body.digest=retainedReview.digest;
    await pendingSave();await dispatchPending();
  }
}
async function refreshHistory(more=false){
  const value=await request(query('/api/history',{after:more?historyCursor:undefined,limit:25}));
  historyRows=more?[...historyRows,...value.items]:value.items;historyCursor=value.nextCursor;
  $('cutover-editions').replaceChildren(...historyRows.map(value=>{
    const node=action('',()=>value.pending?resumeEditionCreation():loadEdition(value.edition));node.className='edition';node.setAttribute('aria-current',value.edition===state.edition?'page':'false');
    node.append(el('strong',value.label??value.operationId),el('small',value.operationId),
      el('small',[value.state,value.outcome,value.checks+' examples'].filter(Boolean).join(' · ')));return node;
  }));
  $('cutover-history-more').hidden=!historyCursor;
  pendingCreation=value.pendingEdition??null;$('cutover-recover-edition').hidden=!pendingCreation;
  if(pendingCreation)$('cutover-recover-edition').textContent='Continue edition '+pendingCreation.arguments.operationId;
  controls();
}
async function loadEdition(edition,{provided,discardLocal=false}={}){
  if(storage&&draft&&!discardLocal)await retainDraft();
  clearTimeout(pollTimer);clearTimeout(draftTimer);
  const value=provided??await request(query('/api/state',{edition}));
  state=value;await acquireBrowserWriter(state.directory);
  storageId='redis-cutover:'+await sha(state.directory+'\n'+edition);storage=createDraftStore(storageId);
  const [retained,savedPending]=await Promise.all([storage.readDraft(),storage.readPending()]);
  pending=savedPending;
  if(pending&&(pending.directory!==state.directory||pending.edition!==edition))throw new Error('The retained request belongs to another original cutover directory.');
  review=null;difference=null;differenceBack=[];
  if(!discardLocal&&retained?.directory===state.directory&&retained.edition===edition&&retained.dirty&&!state.bound){
    draft=retained.input;checkIndex=retained.checkIndex??0;dirty=true;draftBase=retained.expectedDraftSha256;
    renderDraft();for(const [id,value]of Object.entries(retained.raw??{})){const node=$(id);if(node){if(node.type==='checkbox')node.checked=value;else node.value=value;}}
    $('cutover-release-label').hidden=!$('cutover-release-enabled').checked;
  }else{fromInput(state.input);dirty=false;draftBase=state.draftSha256;renderDraft();}
  renderState();$('cutover-main').hidden=false;await refreshHistory();await retainDraft();
  if(pending)await reconcilePending(false);
  else status(state.bound?'Original saved pair reopened. Review its full input to continue or compare.':'Complete receiving draft ready.');
  schedulePoll();
}
function schedulePoll(){
  clearTimeout(pollTimer);
  if(state?.attached||state?.state==='RETAINED_RUNNING'||pending?.action==='start'&&!pending.canFinish)
    pollTimer=setTimeout(()=>poll().catch(error=>{status(error.message,true);schedulePoll();}),1500);
}
async function poll(){
  const edition=state.edition,value=await request(query('/api/progress',{edition}));
  if(state.edition!==edition)return;
  state={...state,state:value.state,attached:value.attached,progress:value.progress,handover:value.handover,lastFailure:value.lastFailure};
  renderProgress(value);controls();
  if(!value.attached&&value.state!=='RETAINED_RUNNING'){
    const full=await request(query('/api/state',{edition}));if(state.edition!==edition)return;
    state=full;renderState();if(pending)await reconcilePending(false);await refreshHistory();
  }
  schedulePoll();
}
function renderReview(value){
  review=value;$('cutover-review-result').hidden=false;
  $('cutover-review-identity').textContent='Contract '+value.review.contractSha256+' · Review '+value.digest;
  $('cutover-review-sources').replaceChildren(table(['Deployment','Connection','Required environment','Receiving examples'],['baseline','candidate'].map(side=>{
    const selected=value.review[side],source=value.input[side].setup.source.connection;
    const names=selected.setup?.environment??selected.environment??[];
    return [side,source.topology??source.transport??'standalone',names.length?names.map(item=>item.name+(item.available?' · available':' · required')).join(', '):pretty(source),value.input[side].checks.length];
  })));
  $('cutover-review-products').replaceChildren(table(['Example','Original query','Read kind','Comparison','Complete pages'],
    value.review.comparisons.map(item=>[item.checkId,item.query,kinds[item.kind]??item.kind,item.mode,
      value.input.baseline.checks.find(check=>check.id===item.checkId)?.allPages?'Required':'Selected first page'])));
  $('cutover-review-ready').textContent=dirty?'Save the complete draft, then review its retained source before starting.':
    'The saved complete input is reviewed. Receiving uses the original source environment; Compare reads the retained native pages.';
  controls();
}
function selectDifferenceKind(){
  const item=state.result?.comparisons.find(value=>value.checkId===$('cutover-difference-check').value);
  $('cutover-difference-kind').value=item?.mode==='ordered'?'changed':'removed';difference=null;differenceBack=[];
}
async function openDifference(offset=0,back=false){
  const checkId=$('cutover-difference-check').value,kind=$('cutover-difference-kind').value;
  if(!checkId)throw new Error('Complete original receiving before selecting a difference.');
  if(!back&&difference&&difference.kind===kind&&difference.file==='difference-'+checkId+'.json'&&offset!==difference.offset)differenceBack.push(difference.offset);
  const value=await request(query('/api/difference',{edition:state.edition,checkId,kind,offset,limit:25}));difference=value;
  const metadata=value.metadata;$('cutover-difference-summary').replaceChildren(
    el('h3',checkId+' · '+metadata.mode+' · '+(metadata.matched?'Matched':'Differences')),
    el('p','Original difference SHA256 '+value.sha256,'break'),
    el('p',Object.entries(value.counts).map(([name,count])=>name+': '+count).join(' · ')),
    table(['Baseline columns','Candidate columns','Baseline expected','Candidate expected'],[[metadata.baselineColumns,metadata.candidateColumns,
      metadata.baselineExpected,metadata.candidateExpected]]));
  $('cutover-difference-rows').replaceChildren(...value.items.map((item,index)=>{
    const node=el('section',undefined,'entry');node.append(el('h3',kind+' entry '+(value.offset+index)),el('pre',pretty(item)));return node;
  }));
  if(!value.items.length)$('cutover-difference-rows').append(el('p',value.oversized
    ?'The next complete entry is '+value.oversized.bytes.toLocaleString()+' bytes. Download the original complete difference file to inspect it.'
    :'No entries in this difference group.','empty'));
  $('cutover-difference-position').textContent=(value.items.length?(value.offset+1)+'–'+(value.offset+value.items.length):'0')+' of '+value.total;
  $('cutover-difference-next').disabled=value.nextOffset===null||Boolean(value.oversized);
  $('cutover-difference-previous').disabled=!differenceBack.length;
}
function download(name,value,type='application/json'){
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)+'\n'],{type});
  const url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function downloadOriginal(kind,checkId){
  const response=await fetch(query('/api/file',{edition:state.edition,kind,checkId}),{headers:{'x-workspace-token':token},cache:'no-store'});
  if(!response.ok){const error=await response.json();throw new Error(error.message??error.error);}
  const expected=response.headers.get('x-cutover-file-sha256'),size=Number(response.headers.get('x-cutover-file-bytes'));
  if(!/^[a-f0-9]{64}$/.test(expected??'')||!Number.isSafeInteger(size)||size<0)throw new Error('The complete original download metadata is missing.');
  status('Receiving the complete original '+kind+' file · '+size.toLocaleString()+' bytes.');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==size||await sha(bytes)!==expected)throw new Error('The downloaded bytes differ from the complete original file.');
  const filename=response.headers.get('content-disposition')?.match(/filename="([A-Za-z0-9_.-]+)"/)?.[1]??'redis-cutover-'+kind;
  download(filename,new Blob([bytes],{type:response.headers.get('content-type')??'application/octet-stream'}));
  status('Complete '+filename+' downloaded · SHA256 '+expected);
}
async function guard(fn){
  if(busy)return;busy=true;controls();
  try{await fn();}catch(error){status((error.code?error.code+' · ':'')+error.message,true);}
  finally{busy=false;controls();}
}
const on=(id,fn)=>$(id).addEventListener('click',()=>guard(fn));
document.querySelectorAll('[data-cutover-tab]').forEach(node=>node.addEventListener('click',()=>showTab(node.dataset.cutoverTab)));
$('cutover-contract-fields').addEventListener('input',changed);
$('cutover-release-enabled').addEventListener('change',()=>{$('cutover-release-label').hidden=!$('cutover-release-enabled').checked;changed();});
$('cutover-check-query').addEventListener('change',()=>{
  const route=draft.baseline.setup.plan.routes.find(item=>item.query===$('cutover-check-query').value);
  $('cutover-check-input').value=pretty(route?.example??{});changed();
});
on('cutover-apply-check',async()=>{const value=capture();fromInput(value);changed();renderCheck();renderMatrix();await retainDraft();status('Complete example applied to both original deployment inputs.');});
on('cutover-add-check',async()=>{
  const value=capture();fromInput(value);if(draft.checks.length>=24)throw new Error('The original commissioner supports 24 complete receiving examples.');
  let index=1;while(draft.checks.some(item=>item.id==='example-'+index))index++;
  const query=Object.keys(draft.baseline.setup.source.queries)[0],kind=draft.baseline.setup.source.queries[query].kind,id='example-'+index;
  draft.checks.push({id,query,input:copy(draft.baseline.setup.plan.routes.find(item=>item.query===query)?.example??{}),
    allPages:['set','list','stream','sorted-set'].includes(kind),maxPages:100,maxRows:10000,expected:{rowCount:1}});
  draft.comparisons.push({checkId:id,mode:kind==='set'?'set':'ordered'});checkIndex=draft.checks.length-1;changed();renderCheck();renderMatrix();await retainDraft();
});
on('cutover-remove-check',async()=>{
  if(draft.checks.length===1)throw new Error('Keep at least one complete receiving example.');
  const id=draft.checks[checkIndex].id;draft.checks.splice(checkIndex,1);draft.comparisons=draft.comparisons.filter(item=>item.checkId!==id);
  checkIndex=Math.min(checkIndex,draft.checks.length-1);changed();renderCheck();renderMatrix();await retainDraft();
});
on('cutover-save',async()=>{const input=capture();await retainDraft();await sendAction('save',{edition:state.edition,input,
  requestId:crypto.randomUUID(),expectedDraftSha256:draftBase});status('Complete draft saved. Review its retained source before receiving.');});
on('cutover-review',async()=>{const input=capture();await retainDraft();renderReview(await request('/api/review',{edition:state.edition,input}));
  status('Complete paired source, examples, comparison rules and candidate stage reviewed.');});
async function start(mode){
  if(!review||dirty)throw new Error('Save and review the complete retained input before starting.');
  showTab(mode==='handover'?'handover':'receiving');await sendAction('start',{edition:state.edition,mode,digest:review.digest});
}
for(const mode of ['create','receive','compare','handover'])on('cutover-'+mode,()=>start(mode));
on('cutover-continue',async()=>{await consume(await request('/api/continue',{edition:state.edition}));});
on('cutover-pause',async()=>{await consume(await request('/api/pause',{edition:state.edition}));status('Pause requested for the original operation.');});
on('cutover-pending-read',()=>reconcilePending(false));on('cutover-pending-continue',()=>reconcilePending(true));
on('cutover-pending-finish',async()=>{
  if(!pending?.canFinish)throw new Error('Read the original outcome before returning to review.');
  pending=null;await pendingSave();review=null;showTab('contract');status('Original saved outcome retained. The complete source remains available for review or a new edition.');
});
on('cutover-new',async()=>{if(dirty)await retainDraft();$('cutover-new-operation').value='cutover-'+crypto.randomUUID();
  $('cutover-new-note').value='';$('cutover-new-dialog').showModal();});
on('cutover-new-submit',async()=>{
  const operationId=$('cutover-new-operation').value.trim(),note=$('cutover-new-note').value;
  if(!note.trim())throw new Error('Describe the corrected source or new receiving edition.');
  await sendAction('new-edition',{edition:state.edition,operationId,requestId:crypto.randomUUID(),
    sourceInputCanonicalSha256:state.inputCanonicalSha256,note});
});
for(const side of ['baseline','candidate'])on('cutover-open-'+side,async()=>{
  const result=await request('/api/open-side',{edition:state.edition,side}),link=el('a','Open original '+side+' authoring workspace');
  link.href=result.operatorUrl;link.target='_blank';link.rel='noopener noreferrer';$('cutover-'+side+'-link').replaceChildren(link);
  status('Original '+side+' authoring workspace opened. Its complete editor link is retained below.');
});
on('cutover-close-editors',async()=>{
  await consume(await request('/api/close-editors',{edition:state.edition}));
  for(const side of ['baseline','candidate'])$('cutover-'+side+'-link').replaceChildren();
  status('Original authoring owners closed. The paired receiving operation can use those workspaces.');
});
$('cutover-difference-check').addEventListener('change',selectDifferenceKind);
$('cutover-difference-kind').addEventListener('change',()=>{difference=null;differenceBack=[];});
on('cutover-difference-open',()=>{difference=null;differenceBack=[];return openDifference(0);});
on('cutover-difference-next',()=>{if(difference&&difference.nextOffset!==null)return openDifference(difference.nextOffset);});
on('cutover-difference-previous',()=>openDifference(differenceBack.pop()??0,true));
on('cutover-difference-download',()=>downloadOriginal('difference',$('cutover-difference-check').value));
on('cutover-download-handover',()=>downloadOriginal('handover'));on('cutover-download-input',()=>downloadOriginal('input'));
on('cutover-download-draft',()=>download('redis-valkey-local-input.json',capture()));
on('cutover-reset-local',()=>loadEdition(state.edition,{discardLocal:true}));
on('cutover-refresh',async()=>{await retainDraft();state=await request(query('/api/state',{edition:state.edition}));renderState();await refreshHistory();
  if(pending)await reconcilePending(false);schedulePoll();status('Original saved state refreshed; current local edits retained.');});
on('cutover-history-more',()=>refreshHistory(true));
on('cutover-take-control',async()=>{
  if(await acquireBrowserWriter(state.directory)){storage=null;await loadEdition(state.edition);}
  else status('The original editing tab still owns this directory. Its complete draft and pending request remain retained.');
});
async function resumeEditionCreation(){
  requireWriter();
  const original=pendingCreation;if(!original)throw new Error('Read the original saved edition creation first.');
  if(state.edition!==(original.arguments.edition??'original'))await loadEdition(original.arguments.edition??'original');
  if(pending){
    if(pending.action!=='new-edition'||pending.body.requestId!==original.requestId)
      throw new Error('Continue the existing original request in this parent edition first.');
    return reconcilePending(true);
  }
  await sendAction('new-edition',original.arguments);
}
on('cutover-recover-edition',resumeEditionCreation);
$('cutover-import').addEventListener('change',()=>guard(async()=>{
  requireWriter();
  const file=$('cutover-import').files[0];if(!file)return;
  if(file.size>8388608)throw new Error('Choose the complete original cutover JSON within 8 MiB.');
  const input=JSON.parse(await file.text());
  if(input.schema!=='stellar-forge.redis-cutover-input.v1'||!Array.isArray(input.baseline?.checks)||!input.baseline.checks.length||!input.candidate?.setup)
    throw new Error('Choose a complete original paired cutover input.');
  fromInput(input);dirty=true;review=null;renderDraft();await retainDraft();$('cutover-import').value='';
  status('Complete paired input imported. Review its original contract and save this receiving edition.');
}));
window.addEventListener('beforeunload',event=>{if(dirty&&browserWriter){event.preventDefault();event.returnValue='';}});
guard(async()=>{await loadEdition(new URLSearchParams(location.search).get('edition')??'original');showTab('contract');});
