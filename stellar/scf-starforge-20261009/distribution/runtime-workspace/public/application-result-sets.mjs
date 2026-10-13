// MIT. Deliberately selected run files, original run observations, and reusable companion sets.
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn)=>{const n=node('button',text);n.type='button';n.addEventListener('click',fn);return n;};
const field=(text,input)=>{const label=node('label',text);label.append(input);return label;};
const json=value=>JSON.stringify(value,null,2);
const count=value=>new Intl.NumberFormat().format(value??0);
function facts(rows){const dl=node('dl',undefined,'paths');for(const [key,value] of rows){const row=node('div');row.append(node('dt',key),node('dd',value??'—'));dl.append(row);}return dl;}
function readableDate(value){if(!value)return 'Not recorded';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'medium',timeZone:'UTC'}).format(date)+' UTC';}
function detail(title,value){const block=node('details');block.append(node('summary',title),node('pre',typeof value==='string'?value:json(value)));return block;}
function download(value,name){const url=URL.createObjectURL(new Blob([json(value)+'\n'],{type:'application/json'})),a=node('a');a.href=url;a.download=name;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function createApplicationResultSetsView({root,api,getWorkspaceId,getContext,readSaved,saveSaved,openSet,onMessage,onError}){
  let workspace=getWorkspaceId(),epoch=0,listVersion=0,openVersion=0,busy=false,loading=false,offset=0,total=0,review=null,opened=null;
  let draft={},pending=null,retired=[],absent=null,restored=false;
  const panel=node('details',undefined,'panel');panel.id='application-result-sets';
  panel.append(node('summary','Application result sets'));
  const intro=node('p','Keep a selected output folder with an original Application operation, then reuse its complete files through Companion file sets. Choose the folder deliberately; the retained operation observation does not establish who created each file.','note');
  const status=node('p','','note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const context=node('div');
  const useCurrent=button('Use selected operation',()=>perform(async()=>adoptContext()));
  const directory=node('input');directory.required=true;directory.autocomplete='off';directory.maxLength=4096;directory.placeholder='/absolute/path/to/output-folder';
  const name=node('input');name.required=true;name.maxLength=180;name.autocomplete='off';
  const actor=node('input');actor.required=true;actor.maxLength=240;actor.autocomplete='name';
  const note=node('textarea');note.required=true;note.rows=3;note.maxLength=16000;
  const form=node('form'),columns=node('div',undefined,'columns');
  columns.append(field('Complete output folder on this host',directory),field('Result set name',name),field('Operator',actor),field('Selection note',note));
  const reviewButton=node('button','Review complete folder');reviewButton.type='submit';
  form.append(columns,reviewButton);
  const reviewPanel=node('div',undefined,'result'),openedPanel=node('div',undefined,'result');
  const recover=button('Continue original request',()=>perform(()=>dispatchPending()));
  const pendingDownload=button('Download original request',()=>{if(pending)download(pending,'application-result-request-'+(pending.body.requestId??'export')+'.json');});
  const checkPending=button('Check retained request status',()=>perform(async()=>{
    const own=scope(),request=pending;if(!request||request.action==='export')return;
    const value=await api('/api/application-result-sets/'+(request.action==='capture'?'read':'received'),{requestId:request.body.requestId});
    if(!current(own)||pending!==request)return;
    if(value.phase==='NOT_FOUND'){
      absent=request;notice('No intent is retained for this exact request. You may keep its full body in unsent history and edit the source.');
    }else{
      absent=null;opened={value,origin:request.action==='capture'?'capture':'received'};
      if(complete(value,opened.origin)){pending=null;persist();notice('The original request is complete. Its result is open below.');}
      else notice('The original request was accepted. Continue this same request to finish.');
      renderOpened();
    }
    enabled();
  }));
  const retirePending=button('Keep unsent request and edit source',()=>perform(async()=>{
    if(!pending||absent!==pending)throw Error('Check this exact request and confirm that no intent is retained before editing.');
    const original=pending;retired=[...retired,{...original,observedAbsentAt:new Date().toISOString()}];pending=null;absent=null;
    if(!persist()){pending=original;retired=retired.slice(0,-1);throw Error('The complete unsent request could not be retained. Download it before using another browser or the CLI.');}
    review=null;persist();renderReview();notice('The complete unsent request is retained in this browser. Edit the folder selection and review again.');
  }));
  const retiredDownload=button('Download unsent request history',()=>download(retired,'application-result-unsent-requests.json'));
  const pendingPanel=node('div',undefined,'result'),pendingText=node('p','','note'),pendingActions=node('div',undefined,'actions');
  pendingActions.append(recover,checkPending,retirePending,pendingDownload);pendingPanel.append(node('h3','Retained request'),pendingText,pendingActions);
  const list=node('div'),receivedList=node('div'),page=node('span','','note');
  const previous=button('Previous result sets',()=>{offset=Math.max(0,offset-20);void refresh();});
  const next=button('Next result sets',()=>{offset+=20;void refresh();});
  const refreshButton=button('Refresh result sets',()=>void refresh());
  const paging=node('div',undefined,'actions');paging.append(previous,next,page,refreshButton);
  const receiveForm=node('form'),receiveDirectory=node('input');receiveDirectory.maxLength=4096;receiveDirectory.autocomplete='off';receiveDirectory.placeholder='/absolute/path/to/complete-result-export';
  const receiveButton=node('button','Receive complete result folder');receiveButton.type='submit';
  receiveForm.append(field('Complete result export on this host',receiveDirectory),receiveButton);
  const exportDirectory=node('input');exportDirectory.maxLength=4096;exportDirectory.autocomplete='off';exportDirectory.placeholder='/absolute/path/to/new-result-export';
  const exportForm=node('form'),exportButton=node('button','Export complete result folder');exportButton.type='submit';
  exportForm.append(field('Export destination on this host',exportDirectory),exportButton);
  panel.append(intro,context,useCurrent,form,status,pendingPanel,retiredDownload,reviewPanel,
    node('h3','Retained result sets'),list,node('h3','Received result sets'),receivedList,paging,
    openedPanel,exportForm,node('h3','Receive from another workspace'),node('p','Use a complete result-folder export, including every original file, empty directory and run record. Receiving preserves its original workspace and operation.','note'),receiveForm);
  root.replaceChildren(panel);
  const scope=()=>({epoch,workspace:getWorkspaceId()});
  const current=own=>own.epoch===epoch&&own.workspace===workspace&&own.workspace===getWorkspaceId();
  function state(){return {draft,review,pending,retired,opened:opened?{requestId:opened.value.requestId,origin:opened.origin}:null};}
  function persist(){return saveSaved('result-sets',state(),workspace);}
  function requirePersist(){if(!persist())throw Error('This browser could not retain the full original request. Download the review and use the CLI, or restore browser storage before sending.');}
  function notice(text){status.textContent=text;onMessage(text);}
  function renderContext(){
    context.replaceChildren(facts([['Selected source Application',draft.applicationLabel??draft.applicationId??'Choose an Application and operation above'],
      ['Original operation',draft.operationId??'No operation selected']]));
  }
  function enabled(){
    const locked=busy||Boolean(pending);
    directory.disabled=name.disabled=actor.disabled=note.disabled=useCurrent.disabled=locked;
    reviewButton.disabled=locked||!draft.applicationId||!draft.operationId;
    receiveDirectory.disabled=receiveButton.disabled=locked;
    exportDirectory.disabled=exportButton.disabled=locked||!opened||!complete(opened.value,opened.origin);
    recover.disabled=busy;pendingDownload.disabled=busy||!pending;
    checkPending.disabled=busy||!pending;checkPending.hidden=pending?.action==='export';
    retirePending.hidden=!pending||absent!==pending;retirePending.disabled=busy;
    retiredDownload.hidden=!retired.length;retiredDownload.disabled=busy;
    previous.disabled=busy||loading||offset===0;next.disabled=busy||loading||offset+20>=total;refreshButton.disabled=busy||loading;
    pendingPanel.hidden=!pending;
    pendingText.textContent=pending?'Original '+pending.action+' · '+(pending.body.requestId??'')+'. Retry uses this exact retained request.':'';
    form.setAttribute('aria-busy',String(busy));
    for(const b of reviewPanel.querySelectorAll('button[data-mutation]'))b.disabled=locked;
    for(const b of openedPanel.querySelectorAll('button[data-mutation]'))b.disabled=locked;
    for(const b of list.querySelectorAll('button'))b.disabled=busy;
    for(const b of receivedList.querySelectorAll('button'))b.disabled=busy;
  }
  function fill(){
    directory.value=draft.directory??'';name.value=draft.name??'';actor.value=draft.actor??'';note.value=draft.note??'';
    receiveDirectory.value=draft.receiveDirectory??'';exportDirectory.value=draft.exportDirectory??'';
    renderContext();renderReview();enabled();
  }
  function restore(){
    if(restored)return;restored=true;
    const saved=readSaved('result-sets',workspace);
    if(saved&&typeof saved==='object'){
      draft=saved.draft&&typeof saved.draft==='object'?saved.draft:{};
      review=saved.review??null;pending=saved.pending??null;retired=Array.isArray(saved.retired)?saved.retired:[];
    }
    fill();
    if(saved?.opened?.requestId)void perform(()=>inspect(saved.opened.requestId,saved.opened.origin==='received'?'received':'capture'));
  }
  function adoptContext(){
    if(pending)throw Error('Continue the retained request before selecting another source operation.');
    const value=getContext();
    if(!value?.application?.id||!value.operationId)throw Error('Choose an Application and one of its original operations above.');
    draft={...draft,applicationId:value.application.id,applicationLabel:value.application.label,operationId:value.operationId};
    review=null;requirePersist();fill();notice('Source operation selected. Choose the complete output folder and review its current contents.');
  }
  function draftChanged(key,input){
    input.addEventListener('input',()=>{
      if(busy||pending)return;
      draft={...draft,[key]:input.value};
      if(!['receiveDirectory','exportDirectory'].includes(key)){review=null;renderReview();}
      if(!persist())status.textContent='The current draft could not be saved in browser storage. Sending remains dependent on retaining its exact original request.';
      enabled();
    });
  }
  for(const [key,input] of [['directory',directory],['name',name],['actor',actor],['note',note],['receiveDirectory',receiveDirectory],['exportDirectory',exportDirectory]])draftChanged(key,input);
  function showReview(value,target){
    const manifest=value.manifest??{},provenance=value.provenance??{},files=manifest.files??[],directories=manifest.directories??[];
    target.append(facts([['Result name',value.name??manifest.name],['Origin workspace',value.workspaceId],
      ['Application',value.applicationId],['Operation',value.operationId],['Selected host folder',value.directory],
      ['Operator',value.actor],['Selection note',value.note],['Files',count(files.length)],
      ['Directories',count(directories.length)],['Original file bytes',count(files.reduce((sum,item)=>sum+item.bytes,0))],
      ['Review SHA-256',value.reviewSha256],['Source set',value.setId]]));
    target.append(detail('Original observed run state',provenance.state??null),
      detail('Original command result',provenance.commandResult??null));
    const entries=node('details');entries.append(node('summary','Complete folder manifest ('+files.length+' files, '+directories.length+' directories)'));
    const wrap=node('div',undefined,'table-wrap'),table=node('table'),head=node('thead'),header=node('tr');
    for(const title of ['Relative path','Kind','Bytes','SHA-256'])header.append(node('th',title));head.append(header);table.append(head);
    const body=node('tbody');
    for(const path of directories){const row=node('tr');row.append(node('td',path),node('td','Directory'),node('td','—'),node('td','—'));body.append(row);}
    for(const item of files){const row=node('tr');row.append(node('td',item.path),node('td','File'),node('td',count(item.bytes)),node('td',item.sha256));body.append(row);}
    if(!files.length&&!directories.length){const row=node('tr'),cell=node('td','The selected folder is empty.');cell.colSpan=4;row.append(cell);body.append(row);}
    table.append(body);wrap.append(table);entries.append(wrap);target.append(entries,detail('Complete original run records and observation',provenance));
    const actions=node('div',undefined,'actions');actions.append(button('Download full reviewed metadata',()=>download(value,'application-result-review-'+value.operationId+'.json')));target.append(actions);
  }
  function renderReview(){
    reviewPanel.replaceChildren();reviewPanel.hidden=!review;if(!review)return;
    reviewPanel.append(node('h3','Review selected result folder'));showReview(review,reviewPanel);
    const capture=button('Capture this reviewed result set',()=>perform(async()=>{
      if(pending)throw Error('Continue the retained request first.');
      if(!review)throw Error('Review the complete folder first.');
      pending={action:'capture',body:{requestId:crypto.randomUUID(),review}};requirePersist();enabled();await dispatchPending();
    }));capture.dataset.mutation='true';reviewPanel.append(capture);enabled();
  }
  function sourceReview(value,origin){
    return origin==='received'?value.origin?.capture?.review:
      value.intent?.review??value.review;
  }
  function complete(value,origin){return origin==='received'?value.phase==='RECEIVED'||value.phase==='CAPTURED':value.phase==='CAPTURED';}
  function renderOpened(){
    openedPanel.replaceChildren();openedPanel.hidden=!opened;if(!opened)return;
    const {value,origin}=opened,original=sourceReview(value,origin);
    openedPanel.append(node('h3',origin==='received'?'Received original result set':'Original captured result set'),
      facts([['Request',value.requestId],['Phase',value.phase],['Source set',value.setId],
        ['Opened from',origin==='received'?'Received result history':'Local result capture history']]));
    if(original)showReview(original,openedPanel);
    const actions=node('div',undefined,'actions');
    actions.append(button('Download complete retained metadata',()=>download(value,'application-result-'+value.requestId+'.json')));
    if(complete(value,origin)&&value.setId){
      const use=button('Open in Companion file sets',()=>perform(async()=>{
        await openSet(value.setId);
        notice('Open the intended Application setting, prepare this complete working set, then use its existing Review and Save controls.');
      }));use.dataset.mutation='true';actions.append(use);
    }else if(origin==='received'&&value.phase==='RECEIVING'){
      const resume=button('Continue original receiving request',()=>perform(async()=>{
        if(pending&&pending.body.requestId!==value.requestId)throw Error('Continue the other retained request first.');
        pending={action:'receive',body:{requestId:value.requestId,directory:value.directory}};absent=null;requirePersist();enabled();await dispatchPending();
      }));resume.dataset.mutation='true';actions.append(resume);
    }else if(origin==='capture'&&original){
      const resume=button('Continue original capture',()=>perform(async()=>{
        if(pending&&pending.body.requestId!==value.requestId)throw Error('Continue the other retained request first.');
        pending={action:'capture',body:{requestId:value.requestId,review:original}};requirePersist();enabled();await dispatchPending();
      }));resume.dataset.mutation='true';actions.append(resume);
    }
    openedPanel.append(actions,detail('Complete retained capture or receipt',value));enabled();
  }
  async function inspect(requestId,origin='capture'){
    const own=scope(),version=++openVersion,value=await api('/api/application-result-sets/'+(origin==='received'?'received':'read'),{requestId});
    if(!current(own)||version!==openVersion)return;
    if(value.phase==='NOT_FOUND'){notice('No original request is retained under this identity. Use its saved request status control to reconcile it.');return;}
    opened={value,origin};persist();renderOpened();
  }
  async function dispatchPending(){
    const own=scope(),request=pending;
    if(!request||!['capture','receive','export'].includes(request.action))throw Error('No resumable original request is retained.');
    absent=null;requirePersist();
    const result=await api('/api/application-result-sets/'+request.action,request.body);
    if(!current(own))return;
    if(pending!==request)return;
    if(request.action==='capture'){
      opened={value:result,origin:'capture'};
      if(complete(result,'capture'))pending=null;
      notice(result.phase==='CAPTURED'?'Complete result set captured. Its original operation and folder remain available below.':'The original capture is retained. Continue this same request to finish.');
    }else if(request.action==='receive'){
      opened={value:result,origin:'received'};
      if(complete(result,'received'))pending=null;
      notice(pending?'The original receiving request is retained. Continue this same request to finish.':'Complete original result set received. Its files can now be prepared through Companion file sets.');
    }else{
      pending=null;
      notice('Complete result folder exported to '+request.body.directory+'. The destination includes the original files and retained run document.');
    }
    if(!persist())status.textContent+=' Browser storage could not be updated; the same original request can be reconciled after reopening.';
    renderOpened();enabled();await refresh();
  }
  async function perform(work){
    if(busy)return;if(workspace!==getWorkspaceId())reset();const own=scope();busy=true;enabled();status.textContent='Working…';
    try{await work();}catch(error){if(current(own)){status.textContent=error.message;onError(error);}}
    finally{if(current(own)){busy=false;enabled();}}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
    if(pending)throw Error('Continue the retained request first.');
    const own=scope(),request={applicationId:draft.applicationId,operationId:draft.operationId,directory:directory.value,name:name.value,actor:actor.value,note:note.value};
    if(!request.applicationId||!request.operationId)throw Error('Use a selected original operation before reviewing its files.');
    draft={...draft,...request};requirePersist();
    const value=await api('/api/application-result-sets/review',request);if(!current(own))return;
    review=value;requirePersist();renderReview();notice('Review every selected file and the original run observation before capturing.');
  });});
  receiveForm.addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
    if(pending)throw Error('Continue the retained request first.');
    if(!receiveDirectory.value)throw Error('Enter the absolute host path of a complete result export.');
    pending={action:'receive',body:{requestId:crypto.randomUUID(),directory:receiveDirectory.value}};requirePersist();enabled();await dispatchPending();
  });});
  exportForm.addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
    if(pending)throw Error('Continue the retained request first.');
    if(!opened||!complete(opened.value,opened.origin))throw Error('Open a complete captured or received result set first.');
    if(!exportDirectory.value)throw Error('Enter a new absolute host export destination.');
    pending={action:'export',body:{requestId:opened.value.requestId,origin:opened.origin,directory:exportDirectory.value}};requirePersist();enabled();await dispatchPending();
  });});
  function row(item,origin){
    const article=node('article',undefined,'operation'),actions=node('div',undefined,'actions');
    article.append(node('h4',item.name??item.setId??item.requestId),
      node('p',item.phase+' · '+readableDate(item.createdAt),'note'),
      facts([['Request',item.requestId],['Source set',item.setId],
        ...(origin==='capture'?[['Original Application',item.applicationId],['Original operation',item.operationId],
          ['Files',count(item.files)],['File bytes',count(item.bytes)]]:[['Origin workspace',item.originWorkspaceId]])]));
    actions.append(button('Open retained result set',()=>perform(()=>inspect(item.requestId,origin))));article.append(actions);return article;
  }
  async function refresh(){
    if(workspace!==getWorkspaceId())reset();restore();if(!panel.open)return;
    const own=scope(),version=++listVersion;loading=true;enabled();page.textContent='Loading result sets…';
    try{
      const value=await api('/api/application-result-sets?'+new URLSearchParams({offset,limit:20}));
      if(!current(own)||version!==listVersion)return;
      const captures=value.items??[],received=value.received?.items??[];total=Math.max(value.total??0,value.received?.total??0);
      list.replaceChildren(...captures.map(item=>row(item,'capture')));
      receivedList.replaceChildren(...received.map(item=>row(item,'received')));
      if(!captures.length)list.append(node('p','No local result captures on this page.','note'));
      if(!received.length)receivedList.append(node('p','No received result sets on this page.','note'));
      page.textContent=(value.total??0)+' captured · '+(value.received?.total??0)+' received · page '+(Math.floor(offset/20)+1);
    }catch(error){if(current(own)&&version===listVersion){page.textContent='Result sets could not be loaded.';status.textContent=error.message;onError(error);}}
    finally{if(current(own)&&version===listVersion){loading=false;enabled();}}
  }
  function reset(){
    epoch++;listVersion++;openVersion++;workspace=getWorkspaceId();busy=loading=false;offset=total=0;review=opened=pending=absent=null;draft={};retired=[];restored=false;
    status.textContent=page.textContent='';list.replaceChildren();receivedList.replaceChildren();openedPanel.replaceChildren();restore();fill();renderOpened();
  }
  panel.addEventListener('toggle',()=>{if(panel.open)void refresh();});
  return {refresh,reset,update(){if(workspace!==getWorkspaceId())reset();else restore();enabled();}};
}
