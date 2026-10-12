// MIT. Complete application data-edition selection, native review and receiving controls.
const TERMINAL=new Set(['SUCCEEDED','FAILED','INTERRUPTED','CANCELLED']);
const FAILED=new Set(['FAILED','INTERRUPTED','CANCELLED']);
const STAGE='/api/editions/stage',PREPARE='/api/editions/prepare',COMMIT='/api/editions/commit';
const $=id=>document.getElementById(id), json=value=>JSON.stringify(value,null,2);
function element(tag,text) {const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;}
function facts(target,values) {target.replaceChildren();for(const [key,value] of Object.entries(values)){
  if(value===undefined||value===null)continue;target.append(element('dt',key),element('dd',typeof value==='object'?json(value):value));}}
function text(id,value){$(id).textContent=value??'';}
function values(form){return Object.fromEntries(new FormData(form));}
function uuid(){return crypto.randomUUID();}
export function bootApplicationEditions() {
  let runtime='',generation=0,sourceGeneration=0,listGeneration=0,logGeneration=0,detailGeneration=0,applicationGeneration=0,source=null,application=null,edition=null,review=null,operation=null;
  let offset=0,nextOffset=null,fileOffset=0,logOffset=0,logNext=0,logTotal=0,busy=0,loading=false,polling=false,closed=false;
  const pages=[],errors=new Set(),following=new Map();
  const requestKey=item=>item.path+'#'+item.body.operationId;
  const notice=(message,error=false)=>{text('edition-notice',message);$('edition-notice').dataset.kind=error?'error':'info';};
  const ready=()=>runtime&&$('connection-state').textContent==='Connected'&&$('session-panel').hidden;
  const applicationId=()=>$('edition-application').value;
  const validApp=()=>application&&application.id===applicationId();
  const running=()=>validApp()&&Boolean(application.current?.active||['STARTING','STOPPING','RUNNING'].includes(application.phase));
  function pendingKey(){return 'starforge.ruby.application-editions.v1:'+runtime;}
  function pending(){if(!runtime)return[];try{const value=JSON.parse(sessionStorage.getItem(pendingKey())??'[]');
    return Array.isArray(value)?value.filter(item=>item&&typeof item.path==='string'&&item.body&&typeof item.body.operationId==='string'):[];}
    catch{return[];}}
  function savePending(value){sessionStorage.setItem(pendingKey(),JSON.stringify(value));renderPending();}
  function renderPending() {
    const list=pending(),selected=$('edition-pending-choice').value;
    $('edition-pending-choice').replaceChildren(...list.map(item=>{const node=element('option',item.label+' · '+item.body.operationId);node.value=requestKey(item);return node;}));
    if(list.some(item=>requestKey(item)===selected))$('edition-pending-choice').value=selected;
    const item=list.find(item=>requestKey(item)===$('edition-pending-choice').value);
    $('edition-pending-panel').hidden=!item;text('edition-pending-description',item?item.label+' · saved before dispatch':'');
    text('edition-pending-record',item?json(item):'');
  }
  async function api(path,body) {
    if(!ready())throw new Error('Connect to the original runtime before opening this view.');
    const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',
      headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    let result;try{result=await response.json();}catch{throw new Error('Read the original operation after the connection is restored.');}
    if(!response.ok)throw Object.assign(new Error(result.message??result.error?.message??'The selected action could not finish.'),{code:result.code??result.error?.code,status:response.status});
    return result;
  }
  function guarded(fn){return async event=>{event?.preventDefault?.();try{await fn(event);}catch(error){notice((error.code?error.code+': ':'')+error.message,true);}finally{controls();}};}
  function controls(){
    const selected=Boolean(validApp()),available=selected&&!running()&&!busy;
    $('edition-stage').disabled=!available||!source;
    $('edition-prepare').disabled=!available||!edition?.source;
    $('edition-commit').disabled=!available||!review?.review||Boolean(review.committed)||Boolean(edition?.operations.some(item=>item.active||item.phase==='QUEUED'));
    $('edition-stop-application').disabled=!selected||!running()||Boolean(busy);
    $('edition-application-controls').disabled=!selected;
    $('edition-resume').disabled=!operation||operation.active||!FAILED.has(operation.phase)||Boolean(busy);
    $('edition-cancel').disabled=!operation||TERMINAL.has(operation.phase)&&!operation.active||Boolean(busy);
    $('edition-previous').disabled=!pages.length||Boolean(busy);$('edition-next').disabled=nextOffset===null||Boolean(busy);
  }
  function resetDetails(){edition=null;review=null;operation=null;fileOffset=0;logOffset=0;$('edition-detail').hidden=true;controls();}
  async function applicationState() {
    const id=applicationId(),token=generation,request=++applicationGeneration;
    if(!id){application=null;facts($('edition-application-facts'),{});controls();return;}
    const value=await api('/api/application?'+new URLSearchParams({id}));
    if(token!==generation||id!==applicationId()||request!==applicationGeneration)return;
    application=value;facts($('edition-application-facts'),{Application:value.title,ID:value.id,Environment:value.environmentId,State:value.phase,'Original application manifest':value.source?.manifest?.sha256,'Working directory':value.directory});
    const link=$('edition-open-application');link.hidden=!value.current?.url;
    if(value.current?.url)link.href=value.current.url;else link.removeAttribute('href');
    controls();
  }
  async function refreshApplications() {
    const token=generation,value=await api('/api/state');if(token!==generation)return;
    const selected=applicationId(),list=value.applications??[],select=$('edition-application');
    select.replaceChildren(element('option','Choose an application'));select.firstChild.value='';
    for(const app of list){const node=element('option',app.title+' · '+app.id+' · '+app.phase);node.value=app.id;select.append(node);}
    if(list.some(app=>app.id===selected))select.value=selected;
    if(!select.value){application=null;resetDetails();$('edition-list').replaceChildren();}
    else await Promise.all([applicationState(),readList()]);
    renderPending();controls();
  }
  async function readList() {
    const id=applicationId(),token=generation,requestedOffset=offset,request=++listGeneration;if(!id)return;
    const value=await api('/api/editions?'+new URLSearchParams({id,offset:requestedOffset,limit:25}));
    if(token!==generation||id!==applicationId()||requestedOffset!==offset||request!==listGeneration)return;
    nextOffset=value.nextOffset;
    text('edition-page',value.total?String(value.offset+1)+'–'+(value.offset+value.editions.length)+' of '+value.total:'No received editions');
    $('edition-list').replaceChildren(...value.editions.map(item=>{
      const row=element('tr'),name=element('td'),button=element('button',item.selection.title);button.type='button';button.className='text-button';
      button.addEventListener('click',guarded(()=>selectEdition(item.editionId)));name.append(button,element('div',item.editionId));
      row.append(name,element('td',item.source?.rows??'Receiving'),element('td',item.phase),
        element('td',item.latestCommitted?.receipt?.revision??'—'),element('td',item.source?.manifestSha256??item.selection.source.manifestSha256));return row;
    }));controls();
  }
  async function selectEdition(id) {
    generation++;const token=generation;resetDetails();
    const value=await api('/api/edition?'+new URLSearchParams({id:applicationId(),editionId:id}));
    if(token!==generation)return;edition=value;fileOffset=0;renderEdition();await applicationState();
  }
  function renderReview() {
    review=edition?.reviews.find(item=>item.id===$('edition-review').value)??null;
    const summary=review?.review?.summary,receipt=review?.committed?.receipt;
    facts($('edition-review-facts'),review?{Review:review.id,State:review.state?.phase,
      'Exact preview SHA-256':summary?.preview_sha256,'Original operation key':review.selection.operation_key,
      'Prior stream revision':summary?.binding?.prior_revision,'Committed revision':receipt?.revision,
      'Committed source manifest':receipt?.manifest_sha256}: {});
    const counts=summary?.counts??{};
    $('edition-counts').replaceChildren(...Object.entries(counts).map(([key,value])=>{const row=element('tr');row.append(element('td',key),element('td',value));return row;}));
    text('edition-review-record',review?json({selection:review.selection,review:review.review,approval:review.approval,committed:review.committed}):'');
    text('edition-commit-state',receipt?'Committed revision '+receipt.revision+' is retained in the original application history.':
      summary?'Commit uses this exact preview digest. A changed target or preceding revision requires a fresh preview.':'Receiving prepares the full original Rails preview.');
    controls();
  }
  function renderOperation() {
    operation=edition?.operations.find(item=>item.id===$('edition-operation').value)??null;
    facts($('edition-operation-facts'),operation?{Operation:operation.id,Action:operation.action,State:operation.phase,
      Stage:operation.stage,Attempt:operation.attempt,Active:operation.active,'Stop requested':operation.stopRequested,
      Error:operation.error}:{});controls();
  }
  function renderFiles(){
    const list=edition?.files??[],slice=list.slice(fileOffset,fileOffset+50);
    text('edition-file-page',list.length?String(fileOffset+1)+'–'+(fileOffset+slice.length)+' of '+list.length:'No completed files yet');
    $('edition-files').replaceChildren(...slice.map(file=>{
      const row=element('tr'),cell=element('td'),link=element('a',file.name);
      const params={id:edition.applicationId,editionId:edition.editionId,name:file.name};if(file.reviewId)params.reviewId=file.reviewId;
      link.href='/api/edition/file?'+new URLSearchParams(params);link.download=file.name.split('/').at(-1);cell.append(link);
      row.append(cell,element('td',file.reviewId??'Source'),element('td',file.bytes??'Original file'),element('td',file.sha256??'Selected on download'));return row;
    }));
    $('edition-files-previous').disabled=fileOffset===0;$('edition-files-next').disabled=fileOffset+slice.length>=list.length;
  }
  function renderEdition() {
    $('edition-detail').hidden=false;text('edition-title',edition.selection.title);text('edition-phase',edition.phase+' · '+edition.editionId);
    facts($('edition-facts'),{Application:edition.applicationId,'Original selected packet':edition.selection.source.originalDirectory,
      Format:edition.selection.source.format,'Outer manifest SHA-256':edition.source?.manifestSha256,
      'Dataset manifest SHA-256':edition.source?.datasetManifestSha256,'Source rows':edition.source?.rows,
      Fields:edition.source?.fields,'Stream key':edition.selection.sourceKey,'Mapping SHA-256':edition.selection.mappingSha256});
    const oldReview=$('edition-review').value,oldOperation=$('edition-operation').value;
    const reviews=[...edition.reviews].sort((a,b)=>(b.selection.selected_at??'').localeCompare(a.selection.selected_at??'')||b.id.localeCompare(a.id));
    $('edition-review').replaceChildren(...reviews.map(item=>{const node=element('option',item.id+' · '+(item.committed?'revision '+item.committed.receipt.revision:item.state?.phase??'selected'));node.value=item.id;return node;}));
    if(reviews.some(item=>item.id===oldReview))$('edition-review').value=oldReview;
    $('edition-operation').replaceChildren(...edition.operations.map(item=>{const node=element('option',item.id+' · '+item.phase);node.value=item.id;return node;}));
    if(edition.operations.some(item=>item.id===oldOperation))$('edition-operation').value=oldOperation;
    if(!$('edition-actor').value)$('edition-actor').value=edition.selection.actor;
    text('edition-record',json(edition));renderReview();renderOperation();renderFiles();
  }
  async function readDetail(){
    if(!edition)return;const token=generation,selected=edition.editionId,id=applicationId(),request=++detailGeneration;
    const value=await api('/api/edition?'+new URLSearchParams({id,editionId:selected}));
    if(token!==generation||selected!==edition?.editionId||id!==applicationId()||request!==detailGeneration)return;
    edition=value;renderEdition();
  }
  async function originalOperation(key) {
    const value=await api('/api/operation?'+new URLSearchParams({operationId:key}));
    if(!value||value.id!==key)throw new Error('Read the retained operation with its exact original ID.');
    return value;
  }
  async function mutate(path,body,label,existing=null) {
    if(!ready())throw new Error('Connect to the original runtime.');
    const item=existing??{path,body,label,savedAt:new Date().toISOString()};
    const owner={generation,applicationId:applicationId()};following.set(requestKey(item),owner);
    if(!existing) {
      const retained=pending();if(retained.some(old=>requestKey(old)===requestKey(item)&&json(old.body)!==json(body)))throw new Error('This operation already has a different saved selection.');
      if(!retained.some(old=>requestKey(old)===requestKey(item)))savePending([...retained,item]);
    }
    busy++;errors.delete(body.operationId);controls();
    try {
      const response=await api(path,body);
      if(response?.id!==body.operationId||response.applicationId!==body.id&&body.id!==undefined||
        [STAGE,PREPARE,COMMIT].includes(path)&&response.action!=='application-edition')
        throw new Error('The original request is retained. Read its operation before continuing.');
      if(response.phase==='SUCCEEDED'&&!response.active)savePending(pending().filter(old=>requestKey(old)!==requestKey(item)));
      notice(label+' · '+response.phase+' · '+response.id);
      if(owner.generation===generation&&body.id&&body.id===applicationId()) {
        if(body.editionId) {
          const requestedGeneration=generation+1;
          try {await selectEdition(body.editionId);
            if(generation===requestedGeneration&&edition?.reviews.some(value=>value.id===body.reviewId)){$('edition-review').value=body.reviewId;renderReview();}
            if(generation===requestedGeneration&&edition?.operations.some(value=>value.id===body.operationId)){$('edition-operation').value=body.operationId;renderOperation();}
          }catch(error){if(!['ENOENT','RUBY_FILE_MISSING'].includes(error.code))throw error;}
          finally{if(generation===requestedGeneration)owner.generation=generation;}
        }
        await applicationState();await readList();
      } else if(owner.generation===generation&&edition){await readDetail();}
      return response;
    }finally{busy--;controls();}
  }
  async function readLog(){
    if(!operation)return;const selected=operation.id,token=generation,requestedOffset=logOffset,request=++logGeneration;
    const value=await api('/api/log?'+new URLSearchParams({operationId:selected,offset:requestedOffset,limit:65536}));
    if(token!==generation||selected!==operation?.id||requestedOffset!==logOffset||request!==logGeneration)return;
    logOffset=value.offset;logNext=value.nextOffset;logTotal=value.totalBytes;
    text('edition-log',value.text);text('edition-log-page',value.offset+'–'+value.nextOffset+' of '+value.totalBytes+' bytes');
    $('edition-log-previous').disabled=logOffset===0;$('edition-log-next').disabled=logNext>=logTotal;
  }
  function sourceChanged(){sourceGeneration++;source=null;facts($('edition-source-facts'),{});$('edition-source-details').hidden=true;text('edition-source-state','Read the selected packet manifest before receiving this edition.');controls();}
  $('edition-source-form').addEventListener('input',sourceChanged);
  $('edition-source-form').addEventListener('submit',guarded(async()=>{
    const token=++sourceGeneration,input=values($('edition-source-form'));if(!input.expectedManifestSha256)delete input.expectedManifestSha256;
    const value=await api('/api/editions/source',input);if(token!==sourceGeneration)return;
    source=value;text('edition-source-state','Original source manifest selected.');
    facts($('edition-source-facts'),{Format:value.format,Directory:value.directory,'Manifest file':value.manifest.name,
      'Manifest SHA-256':value.manifest.sha256,'Complete row count':value.dataset.rowCount,Fields:value.dataset.fields,
      'Source key':value.dataset.sourceKey,'Native query SHA-256':value.dataset.querySha256,Snapshot:value.dataset.snapshot});
    text('edition-source-record',json(value));$('edition-source-details').hidden=false;controls();
  }));
  $('edition-stage-form').addEventListener('submit',guarded(async()=>{
    if(!source||!validApp())throw new Error('Choose an application and read the selected packet.');
    const input=values($('edition-stage-form'));
    await mutate(STAGE,{id:application.id,editionId:input.editionId,title:input.title,actor:input.actor,
      format:source.format,directory:source.directory,expectedManifestSha256:source.manifest.sha256,
      reviewId:uuid(),operationId:uuid()},'Receive and prepare data edition');
  }));
  $('edition-application').addEventListener('change',guarded(async()=>{
    generation++;offset=0;pages.length=0;resetDetails();application=null;await Promise.all([applicationState(),readList()]);
  }));
  $('edition-refresh').addEventListener('click',guarded(refreshApplications));
  $('edition-previous').addEventListener('click',guarded(async()=>{offset=pages.pop()??0;await readList();}));
  $('edition-next').addEventListener('click',guarded(async()=>{if(nextOffset===null)return;pages.push(offset);offset=nextOffset;await readList();}));
  $('edition-read').addEventListener('click',guarded(async()=>{await Promise.all([readDetail(),applicationState()]);}));
  $('edition-review').addEventListener('change',renderReview);
  $('edition-operation').addEventListener('change',guarded(async()=>{renderOperation();logOffset=0;if($('edition-log-panel').open)await readLog();}));
  $('edition-operation-read').addEventListener('click',guarded(async()=>{await readDetail();if($('edition-log-panel').open)await readLog();}));
  $('edition-prepare').addEventListener('click',guarded(async()=>{
    await mutate(PREPARE,{id:application.id,editionId:edition.editionId,reviewId:uuid(),
      operationId:uuid(),actor:$('edition-actor').value},'Prepare current application preview');
  }));
  $('edition-commit').addEventListener('click',guarded(async()=>{
    if(!review?.review?.summary?.preview_sha256)throw new Error('Open the original complete preview.');
    await mutate(COMMIT,{id:application.id,editionId:edition.editionId,reviewId:review.id,
      expectedPreviewSha256:review.review.summary.preview_sha256,operationId:uuid(),actor:$('edition-actor').value},
      'Commit selected data edition');
  }));
  $('edition-resume').addEventListener('click',guarded(async()=>{await mutate('/api/operations/resume',{operationId:operation.id},'Resume original operation');}));
  $('edition-cancel').addEventListener('click',guarded(async()=>{await mutate('/api/operations/cancel',{operationId:operation.id},'Cancel original operation');}));
  $('edition-stop-application').addEventListener('click',guarded(async()=>{
    busy++;controls();try{await api('/api/applications/stop',{id:application.id});await applicationState();}finally{busy--;controls();}
  }));
  $('edition-application-controls').addEventListener('click',()=>{
    document.querySelector('[data-tab="applications"]')?.click();
    const filter=$('application-filter')??$('app-filter');if(filter){filter.value=applicationId();filter.dispatchEvent(new Event('input',{bubbles:true}));}
  });
  $('edition-files-previous').addEventListener('click',()=>{fileOffset=Math.max(0,fileOffset-50);renderFiles();});
  $('edition-files-next').addEventListener('click',()=>{if(fileOffset+50<(edition?.files.length??0))fileOffset+=50;renderFiles();});
  $('edition-log-panel').addEventListener('toggle',guarded(async()=>{if($('edition-log-panel').open)await readLog();}));
  $('edition-log-previous').addEventListener('click',guarded(async()=>{logOffset=Math.max(0,logOffset-65536);await readLog();}));
  $('edition-log-next').addEventListener('click',guarded(async()=>{logOffset=logNext;await readLog();}));
  $('edition-pending-choice').addEventListener('change',renderPending);
  $('edition-pending-dismiss').addEventListener('click',guarded(async()=>{
    const key=$('edition-pending-choice').value;savePending(pending().filter(item=>requestKey(item)!==key));
    notice('Browser reminder removed. The original operation remains in the runtime.');
  }));
  $('edition-pending-read').addEventListener('click',guarded(async()=>{
    const item=pending().find(value=>requestKey(value)===$('edition-pending-choice').value);if(!item)return;
    const value=await originalOperation(item.body.operationId);text('edition-pending-record',json({request:item,operation:value}));
    notice(value.phase+' · '+value.id);
  }));
  $('edition-pending-retry').addEventListener('click',guarded(async()=>{
    const item=pending().find(value=>requestKey(value)===$('edition-pending-choice').value);if(item)await mutate(item.path,item.body,item.label,item);
  }));
  async function connect(){
    const next=$('workspace-directory').textContent.trim();
    if($('connection-state').textContent!=='Connected'||!$('session-panel').hidden||!next.startsWith('/'))return;
    if(runtime!==next){runtime=next;generation++;sourceChanged();application=null;resetDetails();pages.length=0;offset=0;renderPending();}
    if(loading)return;loading=true;try{await refreshApplications();}catch(error){notice(error.message,true);}finally{loading=false;}
  }
  const observer=new MutationObserver(()=>{if(ready()&&runtime===$('workspace-directory').textContent.trim())return;void connect();});
  observer.observe($('connection-state'),{childList:true,subtree:true});
  observer.observe($('workspace-directory'),{childList:true,subtree:true});
  observer.observe($('session-panel'),{attributes:true,attributeFilter:['hidden']});
  document.querySelector('[data-tab="editions"]').addEventListener('click',guarded(async()=>{if(ready())await refreshApplications();}));
  const timer=setInterval(async()=>{
    if(closed||polling||busy||!ready()||document.hidden||$('panel-editions').hidden||!validApp())return;
    const waiting=pending().find(item=>item.body.id===applicationId()&&!errors.has(item.body.operationId));
    if(!waiting&&!running()&&!edition?.operations.some(item=>item.active||item.phase==='QUEUED'))return;
    polling=true;try{
      await Promise.all([applicationState(),readDetail()]);
      if(waiting) {
        const value=await originalOperation(waiting.body.operationId);
        const follow=following.get(requestKey(waiting));
        if(waiting.body.editionId&&!edition&&follow?.generation===generation&&follow.applicationId===applicationId()) {
          const requestedGeneration=generation+1;
          try{await selectEdition(waiting.body.editionId);}catch(error){if(!['ENOENT','RUBY_FILE_MISSING'].includes(error.code))throw error;}
          finally{if(generation===requestedGeneration)follow.generation=generation;}
        }
        if(value.phase==='SUCCEEDED'&&!value.active) {
          await readList();savePending(pending().filter(item=>requestKey(item)!==requestKey(waiting)));
          notice(waiting.label+' · SUCCEEDED · '+value.id);
        } else if(FAILED.has(value.phase)&&!value.active) {
          // Keep its exact request available; the original operation has a separate explicit Resume action.
          text('edition-pending-description',waiting.label+' · '+value.phase+' · read the original operation and use Resume.');
          errors.add(value.id);
        }
      }
      if(edition&&!edition.operations.some(item=>item.active||item.phase==='QUEUED'))await readList();
      if($('edition-log-panel').open)await readLog();
    }catch(error){if(!errors.has(error.message)){errors.add(error.message);notice(error.message,true);}}
    finally{polling=false;}
  },1500);
  window.addEventListener('pagehide',()=>{closed=true;clearInterval(timer);observer.disconnect();},{once:true});
  void connect();controls();
}
