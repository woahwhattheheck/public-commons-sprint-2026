import {createObjectInputsPanel} from './object-inputs.js';
// MIT. Managed document processing in the original research dossier workspace.
export function createUnstructuredPipelinesPanel({root,tab,api,task,notify,getDossier,onReceived,isBusy}){
  const array=value=>Array.isArray(value)?value:[];
  const copy=value=>JSON.parse(JSON.stringify(value));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const pretty=value=>JSON.stringify(value,null,2);
  const bytes=value=>new Intl.NumberFormat().format(value??0)+' bytes';
  const node=(tag,text,cls)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(cls)value.className=cls;return value;};
  const uuid=kind=>'pipeline-'+kind+'-'+crypto.randomUUID();
  const failure=(code,message)=>Object.assign(new Error(message),{code,detail:message});
  const friendly=error=>({
    PIPELINE_SCOPE_CHANGED:'The selected dossier or operation changed. The saved request remains with its original dossier.',
    PIPELINE_ACCOUNT_SELECTION_CHANGED:'The configured provider account changed. Reopen this operation with its original account.',
    PIPELINE_PROFILE_SELECTION_CHANGED:'The configured processing profile changed. Review a new preparation or restore the original profile.',
    PIPELINE_REVISION_CHANGED:'This job advanced after the action was reviewed. Reload its saved state before choosing another action.',
    PIPELINE_SUBMISSION_UNKNOWN:'The create response is unresolved. Inspect the provider jobs and explicitly link the original job.',
    PIPELINE_LAUNCH_BUSY:'Another create request is using this account. The saved action records that this request was not sent.',
    PIPELINE_INPUT_RESELECT_REQUIRED:'Select the original files in the same order to continue this saved preparation.',
    PIPELINE_INPUT_RESELECT_CHANGED:'The selected file bytes or metadata differ from the saved preparation. Select its original files.',
    PIPELINE_ACTION_RESULT_REQUIRED:'The reply did not identify the saved action result. Reopen that exact request to recover it.',
    PIPELINE_PREPARATION_NOT_FOUND:'The saved preparation is not published yet. Select its original files to continue it.',
    REVISION_CONFLICT:'The dossier changed after this receiving decision. Review its current revision before making a new decision.',
  })[error?.code]||error?.detail||error?.message||'The pipeline operation could not complete.';
  const unsentActionCodes=new Set(['PIPELINE_REVISION_CHANGED','PIPELINE_REVIEWED_PLAN_CHANGED',
    'PIPELINE_ACCOUNT_SELECTION_CHANGED','PIPELINE_PROFILE_SELECTION_CHANGED','PIPELINE_CREATE_ALREADY_REQUESTED',
    'PIPELINE_RECONCILIATION_NOT_REQUIRED','PIPELINE_PROVIDER_JOB_REQUIRED','PIPELINE_JOB_ALREADY_TERMINAL']);
  root.classList.add('pipelines-panel');
  root.innerHTML=`
    <div class="view-heading"><div><h2>Document pipelines</h2><p class="muted">Prepare original files, run a configured processing profile, and receive located output into a research question.</p></div><button type="button" id="pipelines-refresh">Reload saved workspace</button></div>
    <p id="pipelines-source" class="muted small"></p>
    <section id="pipelines-recovery" class="pipelines-recovery" aria-label="Saved requests" hidden></section>
    <section id="pipelines-object-intake" aria-label="Original Object Buyer files"></section>
    <details class="pipelines-intake" open>
      <summary>Prepare a processing job</summary>
      <form id="pipelines-prepare-form">
        <div class="pipelines-fields">
          <label>Processing profile<select id="pipelines-profile" required></select></label>
          <label>Research question<select id="pipelines-question" required></select></label>
          <label>Job label<input id="pipelines-label" maxlength="240" required></label>
        </div>
        <label>Original files, in processing order<input id="pipelines-files" type="file" multiple required></label>
        <p id="pipelines-upload-limit" class="muted small"></p>
        <ol id="pipelines-file-list" class="pipelines-file-list"></ol>
        <p id="pipelines-prepare-pending" class="muted small" role="status"></p>
        <div class="button-row"><button type="submit" id="pipelines-prepare" class="primary">Save preparation</button><button type="button" id="pipelines-recover-prepare" hidden>Find saved preparation</button><button type="button" id="pipelines-new-prepare" hidden>Review a new preparation</button></div>
        <p class="muted small">Saving preserves the original files and a reviewable plan. Submit the reviewed plan to start provider processing.</p>
        <p class="form-error" hidden></p>
      </form>
    </details>
    <div class="pipelines-layout">
      <aside class="pipelines-history" aria-label="Saved jobs and research editions">
        <h3>Saved jobs</h3><div id="pipelines-operations"></div><button type="button" id="pipelines-more" hidden>More jobs</button>
        <h3>Research editions</h3><div id="pipelines-editions"></div>
      </aside>
      <div class="pipelines-main">
        <p id="pipelines-empty" class="muted">Choose a saved job to review its original files and progress, or open a retained research edition.</p>
        <section id="pipelines-operation" aria-label="Selected processing job" hidden>
          <h3 id="pipelines-operation-title"></h3><p id="pipelines-operation-summary" class="muted small" role="status"></p>
          <dl id="pipelines-operation-facts" class="pipelines-facts"></dl>
          <p id="pipelines-operation-note" class="muted small"></p>
          <h4>Original inputs</h4><div id="pipelines-inputs"></div>
          <details class="original-record"><summary>Reviewed account, profile and original plan</summary><pre id="pipelines-plan"></pre></details>
          <div class="pipelines-submit">
            <label class="pipelines-check"><input type="checkbox" id="pipelines-review-plan">I reviewed these original files, the processing profile and the provider account.</label>
            <div class="button-row"><button type="button" id="pipelines-submit" class="primary">Submit reviewed job</button><button type="button" id="pipelines-reload-job">Reload saved job</button><button type="button" id="pipelines-refresh-job">Refresh provider status</button></div>
          </div>
          <form id="pipelines-cancel-form" class="pipelines-inline">
            <label>Cancellation reason<input id="pipelines-cancel-reason" maxlength="2000" required></label><button type="submit" id="pipelines-cancel">Request cancellation</button><p class="form-error" hidden></p>
          </form>
          <details id="pipelines-reconcile-section" class="pipelines-reconcile">
            <summary>Find and reconcile an existing provider job</summary>
            <p class="muted small">Use this when the original create response was lost. Compare the returned job with this preparation and record why it is the same work.</p>
            <form id="pipelines-provider-form" class="pipelines-fields">
              <label>Workflow ID filter<input id="pipelines-workflow" maxlength="512"></label>
              <label>Provider status filter<select id="pipelines-job-status"><option value="">All statuses</option><option>SCHEDULED</option><option>IN_PROGRESS</option><option>COMPLETED</option><option>STOPPED</option><option>FAILED</option></select></label>
              <button type="submit" id="pipelines-provider-jobs">Read provider jobs</button><p class="form-error" hidden></p>
            </form>
            <p id="pipelines-provider-observation" class="muted small"></p>
            <form id="pipelines-reconcile-form">
              <label>Observed provider job<select id="pipelines-provider-job" required></select></label>
              <pre id="pipelines-provider-record" class="pipelines-json"></pre>
              <label>Why this is the original job<textarea id="pipelines-reconcile-reason" rows="2" maxlength="2000" required></textarea></label>
              <button type="submit" id="pipelines-reconcile">Link this existing job</button><p class="form-error" hidden></p>
            </form>
          </details>
          <section class="pipelines-actions" aria-label="Saved action results">
            <h4>Action recovery</h4><div class="pipelines-inline"><label>Saved request<select id="pipelines-action-history"></select></label><button type="button" id="pipelines-reopen-action">Reopen exact request</button></div>
            <pre id="pipelines-action-result" class="pipelines-json"></pre>
          </section>
          <form id="pipelines-retain-form" class="pipelines-inline">
            <label>Observed provider output<select id="pipelines-output-option" required></select></label><button type="submit" id="pipelines-retain-output">Retain original output</button><p class="form-error" hidden></p>
          </form>
          <h4>Retained outputs</h4><div id="pipelines-outputs"></div>
        </section>
        <section id="pipelines-current" class="pipelines-review" aria-label="Selected output review" hidden>
          <h3 id="pipelines-output-title"></h3><p id="pipelines-output-summary" class="muted small"></p>
          <p id="pipelines-warnings" class="muted small"></p>
          <div class="button-row"><button type="button" data-pipeline-download="output">Original provider output</button><button type="button" data-pipeline-download="edition">Portable research edition</button></div>
          <details class="original-record"><summary>Original output and source bindings</summary><pre id="pipelines-output-record"></pre></details>
          <form id="pipelines-receive-form" class="pipelines-fields">
            <label>Research question<select id="pipelines-receive-question" required></select></label>
            <label>Edition label<input id="pipelines-receive-label" maxlength="240" required></label>
            <button type="submit" id="pipelines-receive" class="primary">Receive reviewed edition</button><p class="form-error" hidden></p>
          </form>
          <p id="pipelines-receive-status" class="muted small" role="status"></p>
          <form id="pipelines-filter" class="pipelines-fields">
            <label>Page number<input id="pipelines-page" maxlength="100" placeholder="All pages"></label>
            <label>Element type<input id="pipelines-type" maxlength="200" placeholder="All types"></label>
            <label>Text contains<input id="pipelines-query" maxlength="2000" type="search"></label>
            <button type="submit" id="pipelines-apply-filter">Filter elements</button>
          </form>
          <p id="pipelines-element-count" class="muted small" role="status"></p><div id="pipelines-elements"></div>
          <div class="pagination"><button type="button" id="pipelines-prev">Previous</button><span id="pipelines-page-label"></span><button type="button" id="pipelines-next">Next</button></div>
          <section id="pipelines-element-detail" class="pipelines-element-detail" hidden></section>
        </section>
      </div>
    </div>`;
  const $=id=>root.querySelector('#pipelines-'+id);
  const state={id:null,epoch:0,listEpoch:0,opEpoch:0,selectionEpoch:0,elementEpoch:0,
    shown:false,busy:0,configured:false,workspaceId:null,source:null,uploadLimitBytes:33554432,
    operations:[],editions:[],next:null,operationId:null,operation:null,selection:null,review:null,records:null,
    jobs:null,journal:null,offset:0,filters:{page:'',type:'',query:''}};
  let objectPanel=null;
  const endpoint=(ctx,suffix='')=>'/api/dossiers/'+encodeURIComponent(ctx.id)+'/pipelines'+suffix;
  const context=()=>({id:state.id,epoch:state.epoch,workspaceId:state.workspaceId,journal:state.journal});
  const live=ctx=>ctx.id===state.id&&ctx.epoch===state.epoch&&ctx.workspaceId===state.workspaceId;
  const opLive=(ctx,token,id)=>live(ctx)&&token===state.opEpoch&&state.operationId===id;
  const selectionLive=(ctx,token,selection)=>live(ctx)&&token===state.selectionEpoch&&same(selection,state.selection);
  const needLive=ctx=>{if(!live(ctx))throw failure('PIPELINE_SCOPE_CHANGED','The selected dossier changed.');};
  const key=ctx=>'unstructured-pipelines:v1:'+encodeURIComponent(ctx.workspaceId??'retained')+':'+encodeURIComponent(ctx.id);
  const emptyJournal=ctx=>({version:1,dossierId:ctx.id,workspaceId:ctx.workspaceId,preparation:null,controls:[],receives:[]});
  function readJournal(ctx){
    try{const value=JSON.parse(localStorage.getItem(key(ctx))||'null');
      if(value?.version===1&&value.dossierId===ctx.id&&value.workspaceId===ctx.workspaceId&&
        Array.isArray(value.controls)&&Array.isArray(value.receives))return value;
    }catch{}
    return ctx.journal&&ctx.journal.dossierId===ctx.id&&ctx.journal.workspaceId===ctx.workspaceId?copy(ctx.journal):emptyJournal(ctx);
  }
  function saveJournal(ctx,change){
    const value=readJournal(ctx);change(value);
    for(const name of ['controls','receives']){
      const pending=value[name].filter(row=>row.status==='pending'),closed=value[name].filter(row=>row.status!=='pending');
      value[name]=[...closed.slice(-100),...pending];
    }
    ctx.journal=value;if(live(ctx))state.journal=value;
    try{localStorage.setItem(key(ctx),JSON.stringify(value));}
    catch{if(live(ctx))notify('This browser could not save the request for a restart. Its exact recovery ID remains visible on this page.','error');}
    if(live(ctx)){renderRecovery();updateBusy();}
    return value;
  }
  function putRecord(ctx,kind,entry){
    return saveJournal(ctx,value=>{const i=value[kind].findIndex(row=>row.input.requestId===entry.input.requestId);
      if(i<0)value[kind].push(copy(entry));else value[kind][i]=copy(entry);});
  }
  const pendingControls=id=>array(state.journal?.controls).filter(row=>row.operationId===id&&row.status==='pending');
  const pendingReceives=()=>array(state.journal?.receives).filter(row=>row.status==='pending');
  const preparation=()=>state.journal?.preparation??null;
  async function withAction(action,form){
    return task(async()=>{
      state.busy++;updateBusy();
      try{return await action();}catch(error){error.detail=friendly(error);throw error;}
      finally{state.busy--;updateBusy();}
    },form);
  }
  function validText(value,max,label){
    if(typeof value!=='string'||!value.trim()||new TextEncoder().encode(value).length>max||/[\u0000-\u001f\u007f]/u.test(value))
      throw failure('PIPELINE_SELECTION_REQUIRED',label+' is required and must fit its UTF-8 field limit.');
    return value;
  }
  function currentDossier(ctx){needLive(ctx);const value=getDossier();if(value?.id!==ctx.id)throw failure('PIPELINE_SCOPE_CHANGED','The selected dossier changed.');return value;}
  function chooseOptions(select,rows,selected,placeholder){
    const children=rows.map(row=>{const value=node('option',row.label);value.value=row.value;return value;});
    if(!children.length){const value=node('option',placeholder||'None available');value.value='';children.push(value);}
    select.replaceChildren(...children);
    if(rows.some(row=>row.value===selected))select.value=selected;
  }
  function renderQuestions(){
    const questions=array(getDossier()?.id===state.id?getDossier().questions:[]);
    for(const id of ['question','receive-question']){
      const wanted=id==='question'?(preparation()?.input?.questionId??$(id).value):$(id).value;
      const rows=questions.map(q=>({value:q.id,label:q.text}));
      if(wanted&&!rows.some(q=>q.value===wanted)&&id==='question'&&preparation())rows.unshift({value:wanted,label:'Saved question '+wanted});
      chooseOptions($(id),rows,wanted,'Add a research question first');
    }
  }
  function renderConfiguration(){
    const p=preparation(),selected=p?.input.profileId??$('profile').value;
    const profiles=array(state.source?.profiles).map(row=>({value:row.id,label:row.label+' · '+(row.mode==='template'?'template':'explicit nodes')}));
    if(p&&!profiles.some(row=>row.value===selected))profiles.unshift({value:selected,label:'Saved profile '+selected});
    chooseOptions($('profile'),profiles,selected,'No processing profile configured');
    $('source').textContent=state.configured?'Workspace '+state.workspaceId+' · account '+state.source?.identity?.account+
      ' · '+state.source?.identity?.apiUrl:'Retained research editions reopen from this dossier and its portable archive. Configure a provider source to prepare new jobs.';
    const maxFiles=Math.min(10,state.source?.limits?.maxInputs??10),limit=Math.min(33554432,state.uploadLimitBytes,state.source?.limits?.maxTotalInputBytes??33554432);
    $('upload-limit').textContent='Up to '+maxFiles+' files, '+bytes(limit)+' total in this browser. Original input names, order and bytes are preserved.';
    if(p){$('profile').value=p.input.profileId;$('question').value=p.input.questionId;$('label').value=p.input.label;}
    $('prepare-pending').textContent=p?'Saved preparation request '+p.input.requestId+'. Find its saved plan, or reselect the exact original files to continue.':'';
    $('prepare').textContent=p?'Continue saved preparation':'Save preparation';
    $('recover-prepare').hidden=!p;$('new-prepare').hidden=!p;
    renderFiles();renderQuestions();
  }
  function renderFiles(){
    const files=Array.from($('files').files??[]);
    const rows=files.length?files.map(file=>({filename:file.name,bytes:file.size})):array(preparation()?.files);
    $('file-list').replaceChildren(...rows.map(file=>node('li',file.filename+' · '+bytes(file.bytes))));
  }
  function itemButton(title,subtitle,active,handler,attributes={}){
    const button=node('button',undefined,'pipelines-item'+(active?' active':''));button.type='button';
    for(const [name,value]of Object.entries(attributes))button.setAttribute(name,value);
    button.append(node('strong',title),node('span',subtitle,'muted small'));button.addEventListener('click',()=>withAction(handler));return button;
  }
  function renderList(){
    $('operations').replaceChildren(...state.operations.map(value=>itemButton(value.plan.payload.request.label||value.plan.id,
      value.plan.payload.profile.label+' · '+value.operation.phase,value.plan.id===state.operationId,()=>openOperation(value.plan.id),
      {'data-pipeline-operation':value.plan.id})));
    if(!state.operations.length)$('operations').append(node('p','Saved preparations and provider jobs appear here.','muted small'));
    $('editions').replaceChildren(...state.editions.map(value=>itemButton(value.label,bytes(value.bytes)+' · '+value.createdAt,
      state.selection?.editionId===value.id,()=>openEdition(value.id),{'data-pipeline-edition':value.id})));
    if(!state.editions.length)$('editions').append(node('p','Received research editions appear here.','muted small'));
    $('more').hidden=!state.next;
  }
  function renderRecovery(){
    const entries=[];
    for(const entry of array(state.journal?.controls).filter(row=>row.status==='pending')){
      const row=node('div',undefined,'pipelines-recovery-row');row.append(node('span','Saved '+entry.kind+' request '+entry.input.requestId));
      const button=node('button','Open original job');button.type='button';button.addEventListener('click',()=>withAction(()=>openOperation(entry.operationId)));row.append(button);entries.push(row);
    }
    for(const entry of pendingReceives()){
      const row=node('div',undefined,'pipelines-recovery-row');row.append(node('span','Saved receiving request '+entry.input.requestId+' · '+entry.input.label));
      const button=node('button','Continue exact receiving decision');button.type='button';
      button.addEventListener('click',()=>withAction(()=>dispatchReceive(context(),copy(entry))));row.append(button);entries.push(row);
    }
    $('recovery').hidden=!entries.length;$('recovery').replaceChildren(...(entries.length?[node('h3','Requests awaiting their original result'),...entries]:[]));
  }
  function renderActionHistory(){
    const selected=$('action-history').value;
    const all=array(state.journal?.controls).filter(row=>row.operationId===state.operationId).slice().reverse();
    const entries=[...all.filter(row=>row.status==='pending'),...all.filter(row=>row.status!=='pending')];
    chooseOptions($('action-history'),entries.map(row=>({value:row.input.requestId,label:row.kind+' · '+row.status+' · '+row.input.requestId})),selected,'No saved actions');
    const entry=entries.find(row=>row.input.requestId===$('action-history').value);
    $('action-result').textContent=entry?pretty({requestId:entry.input.requestId,kind:entry.kind,status:entry.status,
      expectedRevision:entry.input.expectedRevision,actionResult:entry.actionResult??null,error:entry.error??null}):'';
  }
  function renderOperation(){
    const value=state.operation;$('operation').hidden=!value;
    $('empty').hidden=!!value||!!state.review;if(!value){renderActionHistory();return;}
    const {plan,operation}=value;
    $('operation-title').textContent=plan.payload.request.label||plan.id;
    $('operation-summary').textContent=operation.phase+' · revision '+operation.revision+
      (operation.providerStatus?' · provider '+operation.providerStatus:'')+(value.running?' · action in progress':'');
    const facts=[['Operation',plan.id],['Provider job',operation.providerJobId??'Awaiting submission'],
      ['Profile',plan.payload.profile.label+' ('+plan.payload.profile.id+')'],['Prepared',plan.preparedAt],['Job observation',operation.jobObservedAt??'Not observed'],['Output details observation',operation.detailsObservedAt??'Not observed'],['Saved state updated',operation.updatedAt]];
    $('operation-facts').replaceChildren(...facts.flatMap(([label,text])=>[node('dt',label),node('dd',text)]));
    const notes=[];
    if(!value.sourceMatches)notes.push('The configured account differs from the retained source.');
    if(!value.profileMatches)notes.push('The current profile differs from the reviewed preparation.');
    if(operation.phase==='SUBMISSION_UNKNOWN')notes.push('The create outcome is unresolved. Read provider jobs and link the matching original job.');
    if(operation.cancel)notes.push('Cancellation: '+operation.cancel.status+'.');
    if(operation.lastError)notes.push(pretty(operation.lastError));
    if(pendingControls(plan.id).length)notes.push('An exact saved action awaits its result. Reopen it before choosing another action for this job.');
    $('operation-note').textContent=notes.join(' ');
    $('plan').textContent=pretty(plan);
    $('inputs').replaceChildren(...array(plan.payload.inputs).map(input=>{
      const row=node('div',undefined,'pipelines-input-row'),button=node('button','Download original');button.type='button';
      button.addEventListener('click',()=>withAction(()=>downloadInput(plan.id,input)));
      row.append(node('span',input.filename+' · '+bytes(input.bytes)),button);return row;
    }));
    const selected=$('output-option').value;
    chooseOptions($('output-option'),array(value.outputOptions).map(row=>({value:JSON.stringify([row.fileId,row.nodeId??null]),label:row.label})),selected,'Refresh provider status to inspect output choices');
    $('outputs').replaceChildren(...array(operation.outputs).map(output=>{
      const row=node('div',undefined,'pipelines-output-row');
      const review=itemButton(output.fileId+(output.nodeId?' · '+output.nodeId:''),'Review output · '+bytes(output.bytes)+' · '+output.receivedAt,
        same(state.selection,{operationId:plan.id,outputId:output.id}),()=>openOutput({operationId:plan.id,outputId:output.id}),
        {'data-pipeline-output':output.id});
      const download=node('button','Download output');download.type='button';download.setAttribute('data-pipeline-output-download',output.id);
      download.addEventListener('click',()=>withAction(()=>downloadRetainedOutput(plan.id,output)));
      row.append(review,download);return row;
    }));
    if(!array(operation.outputs).length)$('outputs').append(node('p','Retain an observed provider output to review its original bytes and document elements.','muted small'));
    renderActionHistory();
  }
  function renderProviderJobs(){
    const current=$('provider-job').value;
    chooseOptions($('provider-job'),array(state.jobs?.jobs).map(job=>({value:job.id,
      label:job.workflow_name+' · '+job.status+' · '+job.id})),current,'Read provider jobs first');
    $('provider-observation').textContent=state.jobs?array(state.jobs.jobs).length+' observed jobs · receipt '+state.jobs.receiptId:'';
    const job=array(state.jobs?.jobs).find(row=>row.id===$('provider-job').value);
    $('provider-record').textContent=job?pretty(job):'';
  }
  function renderReview(){
    const value=state.review;$('current').hidden=!value;$('empty').hidden=!!state.operation||!!value;if(!value)return;
    $('output-title').textContent=value.retained?.label||value.output.fileId;
    $('output-summary').textContent=value.format+' · '+value.itemCount+' elements · '+bytes(value.output.bytes)+
      ' · provider job '+value.binding.providerJobId;
    $('warnings').textContent=array(value.warnings).map(value=>typeof value==='string'?value:pretty(value)).join(' ');
    $('output-record').textContent=pretty({selection:value.selection,editionSha256:value.editionSha256,
      binding:value.binding,inputs:value.inputs,output:value.output});
    $('receive-form').hidden=!!value.retained;
    $('receive-status').textContent=value.retained?'Received edition '+value.retained.id+' · question '+value.retained.questionId:
      pendingReceives().length?'Continue the saved receiving decision above before making another decision.':
      'Review the original output and choose the research question for this edition.';
    renderQuestions();
  }
  function resetOutput(){
    state.selectionEpoch++;state.elementEpoch++;state.selection=null;state.review=null;state.records=null;state.offset=0;
    state.filters={page:'',type:'',query:''};$('element-detail').hidden=true;$('elements').replaceChildren();
    for(const id of ['page','type','query'])$(id).value='';
    renderReview();
  }
  function selectOperation(id){
    state.opEpoch++;state.operationId=id;state.operation=null;state.jobs=null;$('action-history').value='';resetOutput();
    $('review-plan').checked=false;$('cancel-reason').value='';$('reconcile-reason').value='';$('workflow').value='';
    renderOperation();renderProviderJobs();renderList();updateBusy();return state.opEpoch;
  }
  function applyOperation(value,{preserveReview=false}={}){
    const previous=state.operation;
    if(!previous||previous.plan.id!==value.plan.id||previous.plan.sha256!==value.plan.sha256||previous.operation.revision!==value.operation.revision)
      $('review-plan').checked=false;
    state.operation=value;state.operationId=value.plan.id;
    const index=state.operations.findIndex(row=>row.plan.id===value.plan.id);
    if(index<0)state.operations.unshift(value);else state.operations[index]=value;
    if(!preserveReview&&state.selection?.operationId&&state.selection.operationId!==value.plan.id)resetOutput();
    renderList();renderOperation();updateBusy();
  }
  async function openOperation(id){
    const ctx=context(),token=selectOperation(id);
    const value=await api(endpoint(ctx,'/operations/'+encodeURIComponent(id)));
    if(!opLive(ctx,token,id))return;
    applyOperation(value);$('workflow').value=value.operation.workflowId??'';updateBusy();
  }
  async function reloadOperation(){
    const ctx=context(),id=state.operationId,token=state.opEpoch;if(!id)return;
    const value=await api(endpoint(ctx,'/operations/'+encodeURIComponent(id)));
    if(opLive(ctx,token,id))applyOperation(value,{preserveReview:true});
  }
  async function openEdition(id){selectOperation(null);await openOutput({editionId:id});}
  async function openOutput(selection){
    const ctx=context(),token=++state.selectionEpoch;state.elementEpoch++;state.selection=copy(selection);state.review=null;state.records=null;state.offset=0;
    state.filters={page:'',type:'',query:''};for(const id of ['page','type','query'])$(id).value='';
    $('element-detail').hidden=true;renderList();renderReview();updateBusy();
    const value=await api(endpoint(ctx,'/review'),{method:'POST',body:{selection}});
    if(!selectionLive(ctx,token,selection))return;
    state.review=value;$('receive-label').value=(value.retained?.label||((state.operation?.plan.payload.request.label||value.binding.profileLabel)+' · '+value.output.fileId)).slice(0,240);
    if(value.retained)$('receive-question').value=value.retained.questionId;
    else if(state.operation?.plan.payload.request.context?.questionId)$('receive-question').value=state.operation.plan.payload.request.context.questionId;
    renderList();renderReview();renderOperation();await loadElements();updateBusy();
  }
  async function loadElements(){
    const ctx=context(),selection=copy(state.selection),token=state.selectionEpoch,queryToken=++state.elementEpoch,value=state.review;
    if(!value)return;
    const result=await api(endpoint(ctx,'/elements'),{method:'POST',body:{selection,expectedEditionSha256:value.editionSha256,
      offset:state.offset,limit:25,...state.filters}});
    if(!selectionLive(ctx,token,selection)||queryToken!==state.elementEpoch)return;
    state.records=result;
    $('element-count').textContent=result.filtered+' matching elements of '+result.total+' retained elements';
    $('page-label').textContent=result.filtered?'Elements '+(result.offset+1)+'–'+Math.min(result.offset+result.items.length,result.filtered):'No matching elements';
    $('elements').replaceChildren(...array(result.items).map(row=>{
      const item=row.item,pipeline=item.metadata?.pipeline??{},page=item.metadata?.page_number;
      const value=node('button',undefined,'pipelines-element');value.type='button';
      value.append(node('strong',row.position+'. '+(item.title||pipeline.type||'Document element')),
        node('span',(pipeline.type||'element')+(page===undefined?'':' · page '+page),'muted small'),
        node('span',(typeof item.content==='string'?item.content:pretty(item.content)).slice(0,400),'pipelines-excerpt'));
      value.addEventListener('click',()=>{
        if(!selectionLive(ctx,token,selection)||queryToken!==state.elementEpoch)return;
        const detail=$('element-detail');detail.hidden=false;detail.replaceChildren(node('h4','Element '+row.position),node('pre',pretty(item)));
      });return value;
    }));
    if(!result.items.length)$('elements').append(node('p','No elements match these filters.','muted small'));
    updateBusy();
  }
  function applyList(value,more){
    state.operations=more?[...state.operations,...value.operations.filter(row=>!state.operations.some(old=>old.plan.id===row.plan.id))]:value.operations;
    state.editions=value.editions;state.next=value.nextAfter;state.configured=value.configured;state.source=value.source;
    state.uploadLimitBytes=value.uploadLimitBytes??33554432;
    objectPanel.configure(value);
    renderConfiguration();renderList();renderOperation();renderReview();updateBusy();
  }
  async function loadList(more=false){
    if(!state.id)return;const ctx=context(),token=++state.listEpoch,cursor=more?state.next:null;
    const value=await api(endpoint(ctx)+(cursor?'?after='+encodeURIComponent(cursor):''));
    if(!live(ctx)||token!==state.listEpoch)return;
    if(value.workspaceId!==state.workspaceId){
      state.workspaceId=value.workspaceId;state.epoch++;state.journal=readJournal(context());selectOperation(null);
    }
    applyList(value,more);
    return value;
  }
  async function refresh(){
    const ctx=context(),opToken=state.opEpoch,selectionToken=state.selectionEpoch,selected=state.selection?copy(state.selection):null;
    await loadList();if(!live(ctx))return;
    if(state.operationId&&opToken===state.opEpoch)await reloadOperation();
    if(selected&&selectionToken===state.selectionEpoch&&same(selected,state.selection))await openOutput(selected);
  }
  function matchesPreparation(value,p){
    const request=value.plan.payload.request,inputs=array(value.plan.payload.inputs);
    return request.requestId===p.input.requestId&&request.profileId===p.input.profileId&&request.label===p.input.label&&
      request.context?.dossierId===p.dossierId&&request.context.questionId===p.input.questionId&&
      request.context.preparationRevision===p.input.expectedRevision&&inputs.length===p.files.length&&
      p.files.every((file,index)=>['filename','contentType','bytes','sha256'].every(key=>inputs[index][key]===file[key]));
  }
  async function findPreparation(ctx,p){
    let after='',seen=new Set();
    do{
      const value=await api(endpoint(ctx)+(after?'?after='+encodeURIComponent(after):''));
      needLive(ctx);
      const match=array(value.operations).find(row=>row.plan.payload.request.requestId===p.input.requestId);
      if(match){if(!matchesPreparation(match,p))throw failure('PIPELINE_PREPARATION_REQUEST_CHANGED','The saved request identity has different retained input metadata.');return match;}
      after=value.nextAfter;if(after&&seen.has(after))throw failure('PIPELINE_OPERATION_CURSOR_CHANGED','The saved job cursor repeated.');
      if(after)seen.add(after);
    }while(after);
    return null;
  }
  function clearPreparation(ctx,p){
    saveJournal(ctx,value=>{if(value.preparation?.input.requestId===p.input.requestId)value.preparation=null;});
    if(live(ctx)){$('files').value='';renderConfiguration();}
  }
  async function recoverPreparation({allowMissing=false}={}){
    const ctx=context(),p=preparation();if(!p)return null;
    const token=state.opEpoch,value=await findPreparation(ctx,p);
    if(!value){if(allowMissing)return null;throw failure('PIPELINE_PREPARATION_NOT_FOUND','The saved preparation is not published yet.');}
    clearPreparation(ctx,p);
    if(live(ctx)&&token===state.opEpoch){selectOperation(value.plan.id);applyOperation(value);notify('Recovered preparation '+p.input.requestId+'.');}
    return value;
  }
  async function inputFiles(ctx,p){
    const files=Array.from($('files').files??[]),limits=state.source?.limits??{};
    if(!files.length)throw failure('PIPELINE_INPUT_RESELECT_REQUIRED','Select the original input files.');
    const maximum=Math.min(33554432,state.uploadLimitBytes,limits.maxTotalInputBytes??33554432);
    if(files.length>Math.min(10,limits.maxInputs??10)||files.some(f=>f.size<=0||f.size>Math.min(33554432,limits.maxInputBytes??50000000))||
      files.reduce((n,f)=>n+f.size,0)>maximum)throw failure('PIPELINE_UPLOAD_TOO_LARGE','The selected files exceed the configured file or browser byte limit.');
    const inputs=[],metadata=[];
    for(const file of files){
      validText(file.name,1024,'File name');if(/[\\/]/.test(file.name))throw failure('PIPELINE_UPLOAD_INVALID','File names must be plain names.');
      const contentType=validText(file.type||'application/octet-stream',256,'File content type');
      const body=new Uint8Array(await file.arrayBuffer());needLive(ctx);
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body))).map(value=>value.toString(16).padStart(2,'0')).join('');needLive(ctx);
      const descriptor={filename:file.name,contentType,bytes:body.length,sha256:hash};metadata.push(descriptor);
      const chunks=[];for(let offset=0;offset<body.length;offset+=32768)chunks.push(String.fromCharCode(...body.subarray(offset,offset+32768)));
      inputs.push({filename:file.name,contentType,base64:btoa(chunks.join(''))});
    }
    if(p&&!same(metadata,p.files))throw failure('PIPELINE_INPUT_RESELECT_CHANGED','The original input bytes or metadata changed.');
    return {inputs,metadata};
  }
  async function prepare(){
    const ctx=context();let p=preparation();
    if(p){const found=await recoverPreparation({allowMissing:true});if(found)return;needLive(ctx);}
    const dossier=currentDossier(ctx),opToken=state.opEpoch;
    const input=p?.input??{requestId:uuid('prepare'),profileId:validText($('profile').value,128,'Processing profile'),
      questionId:validText($('question').value,160,'Research question'),label:validText($('label').value,240,'Job label'),expectedRevision:dossier.revision};
    const files=await inputFiles(ctx,p);needLive(ctx);
    if(opToken!==state.opEpoch)throw failure('PIPELINE_SCOPE_CHANGED','The selected job changed.');
    p=p??{dossierId:ctx.id,input,files:files.metadata,savedAt:new Date().toISOString()};
    saveJournal(ctx,value=>{value.preparation=copy(p);});renderConfiguration();
    const token=selectOperation(null);
    const value=await api(endpoint(ctx,'/prepare'),{method:'POST',body:{...p.input,inputs:files.inputs}});
    if(!matchesPreparation(value,p))throw failure('PIPELINE_PREPARATION_REQUEST_CHANGED','The reply did not match the saved preparation.');
    clearPreparation(ctx,p);
    if(live(ctx)&&token===state.opEpoch){selectOperation(value.plan.id);applyOperation(value);notify('Original files and processing plan saved for review.');}
  }
  function actionEntry(kind){
    const value=state.operation;if(!value)throw failure('PIPELINE_OPERATION_REQUIRED','Choose a saved job.');
    if(pendingControls(value.plan.id).length)throw failure('PIPELINE_SAVED_ACTION_PENDING','Reopen the exact saved action first.');
    const input={requestId:uuid(kind),expectedRevision:value.operation.revision};
    if(kind==='submit'||kind==='reconcile')input.expectedPlanSha256=value.plan.sha256;
    if(kind==='submit'&&!$('review-plan').checked)throw failure('PIPELINE_PLAN_REVIEW_REQUIRED','Review the original inputs, profile and account before submitting.');
    if(kind==='cancel')input.reason=validText($('cancel-reason').value,2000,'Cancellation reason');
    if(kind==='reconcile'){
      const job=array(state.jobs?.jobs).find(row=>row.id===$('provider-job').value);
      if(!job)throw failure('PIPELINE_PROVIDER_JOB_REQUIRED','Select an observed provider job.');
      input.providerJobId=job.id;input.reason=validText($('reconcile-reason').value,2000,'Reconciliation reason');
    }
    if(kind==='retain'){
      const output=array(value.outputOptions).find(row=>JSON.stringify([row.fileId,row.nodeId??null])===$('output-option').value);
      if(!output)throw failure('PIPELINE_OUTPUT_SELECTION_REQUIRED','Select an observed output.');
      input.fileId=output.fileId;input.nodeId=output.nodeId??null;
    }
    return {operationId:value.plan.id,kind,input,status:'pending',savedAt:new Date().toISOString()};
  }
  async function dispatchAction(entry){
    const ctx=context(),token=state.opEpoch,id=entry.operationId;
    putRecord(ctx,'controls',entry);renderActionHistory();$('action-history').value=entry.input.requestId;renderActionHistory();updateBusy();
    let result;
    try{result=await api(endpoint(ctx,'/operations/'+encodeURIComponent(id)+'/'+entry.kind),{method:'POST',body:entry.input});}
    catch(error){
      if(unsentActionCodes.has(error.code)){entry={...entry,status:'review_required',error:{code:error.code,message:friendly(error)}};putRecord(ctx,'controls',entry);}
      throw error;
    }
    const original=result.actionResult;
    if(original?.requestId!==entry.input.requestId||original.kind!==entry.kind||original.status!=='COMPLETE')
      throw failure('PIPELINE_ACTION_RESULT_REQUIRED','The exact saved action result was absent.');
    entry={...entry,status:'complete',actionResult:original,completedAt:new Date().toISOString()};putRecord(ctx,'controls',entry);
    if(!opLive(ctx,token,id))return;
    applyOperation(result,{preserveReview:true});$('action-history').value=entry.input.requestId;renderActionHistory();
    notify(original.error?'The original action completed with '+(original.error.code||'a provider error')+'. Review its saved result.':
      (result.replayed?'Recovered the original '+entry.kind+' result.':'Saved '+entry.kind+' result.'),original.error?'error':'info');
  }
  async function readProviderJobs(){
    const ctx=context(),token=state.opEpoch,id=state.operationId;if(!id)return;
    const body={};if($('workflow').value)body.workflowId=validText($('workflow').value,512,'Workflow ID');
    if($('job-status').value)body.status=$('job-status').value;
    const result=await api(endpoint(ctx,'/operations/'+encodeURIComponent(id)+'/provider-jobs'),{method:'POST',body});
    if(!opLive(ctx,token,id))return;
    state.jobs=result;renderProviderJobs();updateBusy();
  }
  async function receive(){
    const ctx=context(),value=state.review,dossier=currentDossier(ctx);
    if(!value||value.retained)throw failure('PIPELINE_ORIGINAL_OUTPUT_SELECTION_REQUIRED','Choose an original retained output.');
    const pending=pendingReceives();if(pending.length){await dispatchReceive(ctx,copy(pending[0]));return;}
    const entry={status:'pending',savedAt:new Date().toISOString(),input:{requestId:uuid('receive'),selection:copy(value.selection),
      expectedEditionSha256:value.editionSha256,questionId:validText($('receive-question').value,160,'Research question'),
      label:validText($('receive-label').value,240,'Edition label'),expectedRevision:dossier.revision}};
    await dispatchReceive(ctx,entry);
  }
  async function dispatchReceive(ctx,entry){
    const token=state.selectionEpoch,selected=state.selection?copy(state.selection):null;
    putRecord(ctx,'receives',entry);
    let result;
    try{result=await api(endpoint(ctx,'/receive'),{method:'POST',body:entry.input});}
    catch(error){
      if(error.code==='REVISION_CONFLICT'){entry={...entry,status:'review_required',error:{code:error.code,message:friendly(error)}};putRecord(ctx,'receives',entry);}
      throw error;
    }
    const receipt=result.receipt;
    if(receipt?.requestId!==entry.input.requestId||receipt.dossierId!==ctx.id||receipt.questionId!==entry.input.questionId||
      receipt.editionSha256!==entry.input.expectedEditionSha256)
      throw failure('PIPELINE_RECEIVING_RECEIPT_MISMATCH','The reply did not identify this exact receiving decision.');
    putRecord(ctx,'receives',{...entry,status:'complete',receipt,completedAt:new Date().toISOString()});
    if(!live(ctx))return;
    await onReceived(result.dossier);if(!live(ctx))return;
    await loadList();if(!live(ctx))return;
    if(token===state.selectionEpoch&&same(selected,state.selection))await openOutput({editionId:receipt.editionId});
    notify((result.replayed?'Recovered the original receiving result':'Research edition received')+' at dossier revision '+receipt.revision+'.');
  }
  async function saveDownload(response,fallback,stillSelected){
    const blob=await response.blob();if(!stillSelected())return;
    const url=URL.createObjectURL(blob),link=node('a');
    const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1];
    link.href=url;link.download=name||fallback;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function downloadInput(id,input){
    const ctx=context(),token=state.opEpoch;
    const response=await api(endpoint(ctx,'/operations/'+encodeURIComponent(id)+'/inputs/'+encodeURIComponent(input.id)),{download:true});
    await saveDownload(response,input.filename,()=>opLive(ctx,token,id));
  }
  async function downloadRetainedOutput(id,output){
    const ctx=context(),token=state.opEpoch;
    const response=await api(endpoint(ctx,'/operations/'+encodeURIComponent(id)+'/outputs/'+encodeURIComponent(output.id)),{download:true});
    await saveDownload(response,'pipeline.output',()=>opLive(ctx,token,id));
  }
  async function downloadOutput(file){
    const ctx=context(),token=state.selectionEpoch,value=state.review;if(!value)return;
    const response=await api(endpoint(ctx,'/download'),{method:'POST',download:true,
      body:{selection:value.selection,expectedEditionSha256:value.editionSha256,file}});
    await saveDownload(response,file==='edition'?'pipeline.research.json':'pipeline.output',()=>selectionLive(ctx,token,value.selection));
  }
  function updateBusy(){
    const busy=!!isBusy()||state.busy>0||!state.id;
    root.querySelectorAll('button,input,select,textarea').forEach(control=>{control.disabled=busy;});
    objectPanel?.updateBusy(busy);
    if(busy)return;
    const value=state.operation,op=value?.operation,configured=state.configured;
    for(const id of ['profile','question','label'])$(id).disabled=!configured||!!preparation();
    $('files').disabled=!configured;$('prepare').disabled=!configured||!$('files').files?.length;
    $('recover-prepare').disabled=!configured||!preparation();$('new-prepare').disabled=!configured||!preparation();
    $('more').disabled=!state.next;
    const available=!!value&&configured&&value.sourceMatches&&!value.running&&!pendingControls(value.plan.id).length;
    $('review-plan').disabled=!available||!value?.profileMatches||!['PREPARED','REJECTED'].includes(op?.phase)||op?.providerJobId!==null;
    $('submit').disabled=$('review-plan').disabled||!$('review-plan').checked;
    $('reload-job').disabled=!value||!configured;
    $('refresh-job').disabled=!available||!op.providerJobId;
    $('cancel').disabled=!available||op?.phase!=='ACTIVE'||!$('cancel-reason').value.trim();
    $('cancel-reason').disabled=!available||op?.phase!=='ACTIVE';
    $('provider-jobs').disabled=!value||!configured||!value.sourceMatches||value.running;
    for(const id of ['workflow','job-status'])$(id).disabled=$('provider-jobs').disabled;
    $('provider-job').disabled=!available||!array(state.jobs?.jobs).length;
    const job=array(state.jobs?.jobs).find(row=>row.id===$('provider-job').value);
    $('reconcile').disabled=!available||!job||!(op?.providerJobId===job.id||(!op?.providerJobId&&op?.phase==='SUBMISSION_UNKNOWN'))||!$('reconcile-reason').value.trim();
    $('reconcile-reason').disabled=!available||!job;
    const histories=array(state.journal?.controls).filter(row=>row.operationId===state.operationId);
    $('action-history').disabled=!histories.length;
    $('reopen-action').disabled=!configured||!value||value.running||!histories.some(row=>row.input.requestId===$('action-history').value);
    $('output-option').disabled=!available||!array(value?.outputOptions).length;
    $('retain-output').disabled=$('output-option').disabled;
    const reviewing=!!state.review,receivable=reviewing&&!state.review.retained&&configured&&!pendingReceives().length;
    $('receive').disabled=!receivable||!$('receive-question').value||!$('receive-label').value.trim();
    for(const id of ['receive-question','receive-label'])$(id).disabled=!receivable;
    root.querySelectorAll('[data-pipeline-download]').forEach(button=>{button.disabled=!reviewing;});
    for(const id of ['page','type','query','apply-filter'])$(id).disabled=!reviewing;
    $('prev').disabled=!reviewing||!state.records||state.offset===0;
    $('next').disabled=!reviewing||!Number.isSafeInteger(state.records?.nextOffset);
    root.querySelectorAll('#pipelines-recovery button').forEach(button=>{button.disabled=!configured;});
  }
  function resetScope(id){
    state.id=id;state.epoch++;state.listEpoch++;state.operations=[];state.editions=[];state.next=null;
    state.journal=readJournal({...context(),journal:null});selectOperation(null);
    $('files').value='';$('label').value='';renderConfiguration();renderRecovery();renderList();updateBusy();
  }
  $('refresh').addEventListener('click',()=>withAction(refresh));
  $('more').addEventListener('click',()=>withAction(()=>loadList(true)));
  $('files').addEventListener('change',()=>{renderFiles();updateBusy();});
  $('prepare-form').addEventListener('submit',event=>{event.preventDefault();withAction(prepare,event.currentTarget);});
  $('recover-prepare').addEventListener('click',()=>withAction(()=>recoverPreparation()));
  $('new-prepare').addEventListener('click',()=>withAction(async()=>{
    const ctx=context(),p=preparation();if(!p)return;
    const found=await recoverPreparation({allowMissing:true});if(found)return;
    needLive(ctx);clearPreparation(ctx,p);$('label').value='';renderConfiguration();notify('No published plan matched '+p.input.requestId+'. Review the files and scope for a new preparation.');
  }));
  $('review-plan').addEventListener('change',updateBusy);
  $('submit').addEventListener('click',()=>withAction(()=>dispatchAction(actionEntry('submit'))));
  $('reload-job').addEventListener('click',()=>withAction(reloadOperation));
  $('refresh-job').addEventListener('click',()=>withAction(()=>dispatchAction(actionEntry('refresh'))));
  $('cancel-form').addEventListener('submit',event=>{event.preventDefault();withAction(()=>dispatchAction(actionEntry('cancel')),event.currentTarget);});
  $('provider-form').addEventListener('submit',event=>{event.preventDefault();withAction(readProviderJobs,event.currentTarget);});
  $('provider-job').addEventListener('change',()=>{renderProviderJobs();updateBusy();});
  $('reconcile-form').addEventListener('submit',event=>{event.preventDefault();withAction(()=>dispatchAction(actionEntry('reconcile')),event.currentTarget);});
  $('action-history').addEventListener('change',()=>{renderActionHistory();updateBusy();});
  $('reopen-action').addEventListener('click',()=>withAction(async()=>{
    const entry=array(state.journal?.controls).find(row=>row.operationId===state.operationId&&row.input.requestId===$('action-history').value);
    if(entry)await dispatchAction({...copy(entry),status:'pending'});
  }));
  $('retain-form').addEventListener('submit',event=>{event.preventDefault();withAction(()=>dispatchAction(actionEntry('retain')),event.currentTarget);});
  $('receive-form').addEventListener('submit',event=>{event.preventDefault();withAction(receive,event.currentTarget);});
  for(const id of ['cancel-reason','reconcile-reason','receive-label','receive-question','question','profile','label'])
    $(id).addEventListener('input',updateBusy);
  $('filter').addEventListener('submit',event=>{event.preventDefault();withAction(async()=>{
    state.offset=0;state.filters={page:$('page').value,type:$('type').value,query:$('query').value};
    $('element-detail').hidden=true;await loadElements();
  });});
  $('prev').addEventListener('click',()=>withAction(async()=>{state.offset=Math.max(0,state.offset-25);$('element-detail').hidden=true;await loadElements();}));
  $('next').addEventListener('click',()=>withAction(async()=>{if(Number.isSafeInteger(state.records?.nextOffset)){state.offset=state.records.nextOffset;$('element-detail').hidden=true;await loadElements();}}));
  root.querySelectorAll('[data-pipeline-download]').forEach(button=>button.addEventListener('click',()=>withAction(()=>downloadOutput(button.dataset.pipelineDownload))));
  window.addEventListener('storage',event=>{
    if(state.id&&event.key===key(context())){state.journal=readJournal({...context(),journal:null});renderConfiguration();renderRecovery();renderActionHistory();renderReview();updateBusy();}
  });
  objectPanel=createObjectInputsPanel({root:$('object-intake'),api,task,notify,getDossier,isBusy:()=>!!isBusy()||state.busy>0,
    onPrepared:async(value,dossierId)=>{if(state.id!==dossierId)return;await loadList();
      if(state.id===dossierId){await openOperation(value.plan.id);$('operation').scrollIntoView({block:'nearest'});}}});
  renderConfiguration();renderList();renderOperation();renderReview();updateBusy();
  return {
    configure(value){
      const workspaceId=value?.workspaceId??null,changed=workspaceId!==state.workspaceId;
      state.configured=value?.configured===true;state.workspaceId=workspaceId;state.source=value?.source??null;
      state.uploadLimitBytes=value?.uploadLimitBytes??33554432;
      objectPanel.configure(value);
      if(changed&&state.id)resetScope(state.id);else{renderConfiguration();updateBusy();}
      tab.hidden=false;
    },
    setDossier(view){
      objectPanel.setDossier(view);
      if((view?.id??null)!==state.id)resetScope(view?.id??null);
      renderQuestions();renderReview();updateBusy();
    },
    show(visible){
      void objectPanel.show(visible);
      const changed=visible!==state.shown;state.shown=visible;
      if(visible&&changed&&state.id){
        const ctx=context();state.busy++;updateBusy();
        refresh().catch(error=>{if(live(ctx))notify(friendly(error),'error');}).finally(()=>{state.busy--;updateBusy();});
      }
    },
    updateBusy
  };
}
