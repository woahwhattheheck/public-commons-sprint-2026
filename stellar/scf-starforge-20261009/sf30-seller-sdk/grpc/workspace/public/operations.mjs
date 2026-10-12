// MIT. Shared native operations editor for the original gRPC workspace and Merchant Console.
const PAGE=50,blank=()=>({title:'',severity:'medium',state:'open',summary:'',impact:'',findings:'',
  review:{state:'draft',reviewer:'',note:''},links:[],actions:[]});
const copy=value=>JSON.parse(JSON.stringify(value)),pretty=value=>JSON.stringify(value,null,2),short=value=>value?value.slice(0,12):'—';
const node=(tag,text,kind)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(kind)value.className=kind;return value;};
export function mountGrpcOperations({root,json,api,work,notice,storageKey='grpc-operations',onExport,onReceive,receiveMode='file'}){
  root.classList.add('grpc-operations');
  const ui={},own={epoch:0,binding:null,inventory:null,capture:null,capturePage:null,casesPage:null,
    rows:null,detail:null,caseView:null,caseId:null,edit:blank(),baseline:null,dirty:false,pending:false,exported:null,saveIntent:null};
  function el(name,tag='div',parent=root,text){const value=node(tag,text);value.dataset.operations=name;ui[name]=value;parent.append(value);return value;}
  function field(parent,key,label,type='text',value=''){
    const wrap=node('label',label),control=type==='textarea'?node('textarea'):type==='select'?node('select'):node('input');
    if(!['textarea','select'].includes(type))control.type=type;control.value=value;control.id='grpc-ops-'+key;
    wrap.htmlFor=control.id;wrap.append(control);parent.append(wrap);ui[key]=control;return control;
  }
  function options(control,values){for(const [value,label]of values)control.append(new Option(label??value,value));}
  function button(parent,key,label,fn){const b=el(key,'button',parent,label);b.type='button';b.onclick=()=>perform(fn,label);return b;}
  function section(parent,title){const value=node('section',undefined,'ops-panel');value.append(node('h3',title));parent.append(value);return value;}
  function actions(parent){const value=node('div',undefined,'ops-actions');parent.append(value);return value;}
  function storage(name,value){try{if(value===undefined)return JSON.parse(sessionStorage.getItem(storageKey+':operations:'+String(own.binding??'native')+':'+name));sessionStorage.setItem(storageKey+':operations:'+name,JSON.stringify(value));}
    catch(error){if(value!==undefined)throw new Error('Keep this tab’s private session storage available before saving an operation. '+error.message);return null;}}
  function removeStorage(name){try{sessionStorage.removeItem(storageKey+':operations:'+name);}catch{}}
  function current(epoch){if(epoch!==own.epoch)throw new Error('The selected workspace or operations case changed. Reopen the saved original operation.');}
  async function perform(fn,label){
    return work(async()=>{if(own.pending)return;own.pending=true;root.inert=true;
      try{return await fn();}finally{own.pending=false;root.inert=false;sync();}},label);
  }
  function changed(){own.dirty=true;own.exported=null;own.saveIntent=null;sync();}
  function discard(){return !own.dirty||window.confirm('Replace this unsaved incident draft? Its saved revisions remain available.');}
  el('heading','h2',root,'Operations & incidents');
  el('intro','p',root,'Investigate the original workspace’s calls, source revisions and service-health histories. A capture freezes those saved records; an incident retains your findings, review and corrective actions.');
  const top=el('top','div');top.className='ops-columns';
  const capturePanel=section(top,'Capture original records');
  field(capturePanel,'from','Calls started from · local time','datetime-local');
  field(capturePanel,'to','Calls started through · local time','datetime-local');
  field(capturePanel,'revisionFilter','Source revision cohort','select');options(ui.revisionFilter,[['','All saved revisions']]);
  field(capturePanel,'methods','Exact method paths · one per line','textarea').rows=3;
  ui.methods.placeholder='/package.Service/Method';
  const healthLabel=node('label',undefined,'ops-check'),health=node('input');health.type='checkbox';health.checked=true;ui.includeHealth=health;
  healthLabel.append(health,document.createTextNode('Include matching Check, List and Watch history'));capturePanel.append(healthLabel);
  button(actions(capturePanel),'capture','Capture selected records',capture);
  el('captureId','p',capturePanel).className='ops-identity';
  const library=section(top,'Saved captures and incidents');
  const libraryActions=actions(library);button(libraryActions,'refresh','Refresh saved work',()=>refresh());
  const lists=el('lists','div',library);lists.className='ops-columns';
  const captures=section(lists,'Captures'),cases=section(lists,'Incidents');
  el('captures','div',captures).className='ops-list';const cp=actions(captures);
  button(cp,'capturesPrevious','Previous',()=>captureList(Math.max(0,own.capturePage.offset-PAGE),true));
  el('capturesCount','span',cp);button(cp,'capturesNext','Next',()=>captureList(own.capturePage.nextOffset,true));
  const caseFilters=actions(cases);field(caseFilters,'caseSearch','Find incident','search');
  field(caseFilters,'caseState','State','select');options(ui.caseState,[['','All'],...['open','investigating','monitoring','resolved'].map(x=>[x])]);
  button(caseFilters,'filterCases','Find',()=>caseList());
  el('cases','div',cases).className='ops-list';const ip=actions(cases);
  button(ip,'casesPrevious','Previous',()=>caseList(Math.max(0,own.casesPage.offset-PAGE),true));
  el('casesCount','span',ip);button(ip,'casesNext','Next',()=>caseList(own.casesPage.nextOffset,true));

  const evidence=section(root,'Captured operations');
  el('captureSummary','div',evidence).className='ops-summary';el('meaning','p',evidence).className='ops-hint';
  const tableControls=actions(evidence);
  field(tableControls,'section','View','select');options(ui.section,[['calls','Call outcomes'],['health','Health events'],
    ['timeline','Combined timeline'],['methods','Method outcomes'],['revisions','Source revision cohorts']]);
  field(tableControls,'search','Search captured rows','search');
  field(tableControls,'phase','Call phase','select');options(ui.phase,[['','All phases'],...['ATTEMPTED','COMPLETED','OUTCOME_UNCONFIRMED','NOT_STARTED'].map(x=>[x])]);
  button(tableControls,'filter','Apply filters',()=>rows());
  el('table','div',evidence).className='ops-table-wrap';
  const paging=actions(evidence);button(paging,'previous','Previous',()=>rows(Math.max(0,own.rows.offset-PAGE)));
  el('rowCount','span',paging);button(paging,'next','Next',()=>rows(own.rows.nextOffset));
  const detail=el('detail','details',evidence);detail.append(node('summary','Original selected record'));
  el('detailValue','pre',detail);button(actions(detail),'downloadRecord','Download complete original record',()=>{if(own.detail)saveBlob(JSON.stringify(own.detail.value,null,2)+'\n','grpc-original-record.json','application/json');});button(actions(detail),'link','Link this record to the incident',linkDetail);

  const editor=section(root,'Incident and corrective actions');
  el('caseIdentity','p',editor).className='ops-identity';
  const editActions=actions(editor);button(editActions,'newCase','New incident from this capture',()=>newCase());
  button(editActions,'save','Save incident revision',save);
  button(editActions,'export','Prepare complete delivery',deliver);
  const editGrid=el('editGrid','div',editor);editGrid.className='ops-columns';
  const left=node('div'),right=node('div');editGrid.append(left,right);
  field(left,'title','Incident title');ui.title.maxLength=200;
  const stateRow=actions(left);field(stateRow,'severity','Severity','select');options(ui.severity,['low','medium','high','critical'].map(x=>[x]));
  field(stateRow,'state','State','select');options(ui.state,['open','investigating','monitoring','resolved'].map(x=>[x]));
  for(const [key,label,maximum]of [['summary','Summary',4000],['impact','Customer or operator impact',4000],['findings','Findings and interpretation',12000]]){
    field(left,key,label,'textarea').rows=key==='findings'?7:4;ui[key].maxLength=maximum;
  }
  field(right,'reviewState','Review','select');options(ui.reviewState,[['draft','Draft'],['reviewed','Reviewed']]);
  field(right,'reviewer','Reviewer');ui.reviewer.maxLength=200;
  field(right,'reviewNote','Review note','textarea').rows=4;ui.reviewNote.maxLength=4000;
  el('linksTitle','h4',right,'Linked original records');el('links','div',right).className='ops-list';
  el('historyTitle','h4',right,'Revision history');field(right,'history','Saved revision','select');
  button(actions(right),'openHistory','Open historical revision',()=>openCase(own.caseId,Number(ui.history.value)));
  el('historyHint','p',right,'Opening a historical revision copies its edit into this draft. Saving creates a new revision against the current version.').className='ops-hint';
  el('actionsTitle','h4',editor,'Corrective actions');el('actionRows','div',editor).className='ops-action-list';
  button(actions(editor),'addAction','Add corrective action',()=>{own.edit.actions.push({id:crypto.randomUUID(),title:'',owner:'',state:'planned',dueAt:null,note:''});changed();renderActions();});
  el('delivery','div',editor).className='ops-delivery';
  const receive=section(root,'Receive a complete original case');
  if(receiveMode==='file'){field(receive,'receiveFile','Original grpc-operations.json','file');ui.receiveFile.accept='.json,application/json';}
  else{field(receive,'receiveKind','Retained input','select');options(ui.receiveKind,[['exportId','Existing operations export ID'],['file','Host-declared operations file alias']]);
    field(receive,'receiveValue','Original export or configured file');}
  button(actions(receive),'receive','Receive full capture and incident history',receiveOriginal);
  el('receiveInfo','p',receive,'The complete original capture, incident revision chain and action IDs are retained. Matching earlier revisions can be received again.').className='ops-hint';

  function renderList(parent,items,choose,label){
    parent.replaceChildren();for(const item of items){const b=node('button',label(item),'ops-item');b.type='button';b.dataset.originalId=item.id;
      b.onclick=()=>perform(()=>choose(item),'Open saved selection');parent.append(b);}
    if(!items.length)parent.append(node('p','No saved records.','ops-hint'));
  }
  function counter(page){return page?(page.total?String(page.offset+1)+'–'+String(page.offset+page.items.length)+' of '+page.total:'0 records'):'Not loaded';}
  async function captureList(offset=0,pinned=false){const epoch=own.epoch,args={offset,limit:PAGE};
    if(pinned)args.expectedSnapshot=own.capturePage?.snapshot;
    const value=await json('operations-captures',args);current(epoch);own.capturePage=value;
    renderList(ui.captures,value.items,item=>selectCapture(item.id),item=>item.capturedAt+' · '+item.attempts+' calls · '+short(item.id));ui.capturesCount.textContent=counter(value);sync();}
  async function caseList(offset=0,pinned=false){const epoch=own.epoch,args={offset,limit:PAGE};
    if(pinned)args.expectedSnapshot=own.casesPage?.snapshot;
    if(ui.caseSearch.value)args.search=ui.caseSearch.value;if(ui.caseState.value)args.state=ui.caseState.value;
    const value=await json('operations-cases',args);current(epoch);own.casesPage=value;
    renderList(ui.cases,value.items,item=>openCase(item.id),item=>item.title+' · '+item.state+' · v'+item.version+' · '+item.outstandingActions+' actions');
    ui.casesCount.textContent=counter(value);sync();}
  async function refresh(){await captureList();await caseList();notice('Saved operations captures and incident revisions loaded.');}
  function selected(){const asIso=id=>ui[id].value?new Date(ui[id].value).toISOString():null;return {from:asIso('from'),to:asIso('to'),
    revisions:ui.revisionFilter.value?[ui.revisionFilter.value]:[],methods:ui.methods.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),includeHealth:ui.includeHealth.checked};}
  async function capture(){
    if(!discard())return;const selection=selected(),signature=JSON.stringify(selection);
    let pending=storage('capture');if(!pending||pending.signature!==signature)pending={id:crypto.randomUUID(),signature,selection};
    storage('capture',pending);ui.captureId.textContent='Original capture '+pending.id;
    const epoch=own.epoch,result=await json('operations-capture',{id:pending.id,selection:pending.selection});current(epoch);
    removeStorage('capture');await selectCapture(result.id,true);await captureList();notice('Captured '+result.attempts+' original calls and '+result.healthObservations+' health observations.');
  }
  function summary(value){
    ui.captureSummary.replaceChildren();if(!value){ui.captureSummary.append(node('p','Choose or create a saved capture.'));ui.meaning.textContent='';return;}
    const pairs=[['Original calls',value.attempts],['Completed',value.outcomes.COMPLETED],['Outcome unconfirmed',value.outcomes.OUTCOME_UNCONFIRMED],
      ['Not started',value.outcomes.NOT_STARTED],['Health observations',value.healthObservations],['Source revisions',value.sourceRevisions]];
    for(const [title,count]of pairs){const item=node('div');item.append(node('span',title),node('strong',String(count??0)));ui.captureSummary.append(item);}
    ui.meaning.textContent=value.meaning;ui.captureId.textContent='Capture '+value.id+' · '+value.captureSha256+' · '+value.capturedAt;
  }
  async function selectCapture(id,accepted=false){
    if(!accepted&&!discard())return;own.epoch++;const epoch=own.epoch,value=await json('operations-read',{id,section:'summary'});current(epoch);
    own.capture=value;own.caseView=null;own.caseId=null;own.edit=blank();own.dirty=false;own.saveIntent=null;own.exported=null;own.rows=null;own.detail=null;
    summary(value);fillEdit();await rows();sync();
  }
  const columns={
    calls:[['startedAt','Started'],['method','Method'],['phase','Original phase'],['revision','Revision'],['recordedElapsedMs','Recorded ms'],['responseMessages','Returned records']],
    health:[['observedAt','Observed'],['service','Service'],['type','Event'],['reportedStatus','Reported status'],['grpcCode','Native code'],['sequence','Sequence']],
    timeline:[['observedAt','Observed'],['kind','Event'],['method','Method / service'],['description','Original state'],['sequence','Sequence']],
    methods:[['method','Method'],['attempts','Calls'],['outcomes.COMPLETED','Completed'],['outcomes.OUTCOME_UNCONFIRMED','Unconfirmed'],['recordedElapsed.p50Ms','Recorded p50 ms'],['recordedElapsed.p95Ms','Recorded p95 ms']],
    revisions:[['title','Source'],['revision','Revision'],['target','Target'],['attempts','Calls'],['outcomes.COMPLETED','Completed'],['outcomes.OUTCOME_UNCONFIRMED','Unconfirmed'],['recordedElapsed.p50Ms','Recorded p50 ms']]
  };
  async function rows(offset=0){
    if(!own.capture)return;const epoch=own.epoch,args={id:own.capture.id,section:ui.section.value,offset,limit:PAGE,expectedSnapshot:own.capture.captureSha256};
    if(ui.search.value)args.search=ui.search.value;if(ui.phase.value&&args.section==='calls')args.phase=ui.phase.value;
    const value=await json('operations-read',args);current(epoch);own.rows=value;own.detail=null;ui.detailValue.textContent='';
    ui.table.replaceChildren();const table=node('table'),thead=node('thead'),tr=node('tr'),tbody=node('tbody');
    for(const [,label]of columns[args.section]){const th=node('th',label);th.scope='col';tr.append(th);}const th=node('th','Original record');th.scope='col';tr.append(th);thead.append(tr);
    for(const item of value.items){const row=node('tr');for(const [key]of columns[args.section]){const value=key.split('.').reduce((value,key)=>value?.[key],item);row.append(node('td',value===null||value===undefined?'—':String(value)));}
      const cell=node('td'),b=node('button',args.section==='methods'?'Show calls':'Open');b.type='button';b.onclick=()=>perform(()=>inspect(item,args.section),'Open original record');cell.append(b);row.append(cell);tbody.append(row);}
    table.append(thead,tbody);ui.table.append(table);ui.rowCount.textContent=counter(value)+' · '+short(value.snapshot);sync();
  }
  async function inspect(item,kind){
    if(kind==='methods'){ui.section.value='calls';ui.search.value=item.method;ui.phase.value='';await rows();return;}
    let link,section,id=item.id;
    if(kind==='revisions'){section='source';id=item.revision;link={kind:'revision',id};}
    else if(kind==='health'||kind==='timeline'&&item.kind.startsWith('health-')){section='health-observation';link={kind:'health',id,...(item.sequence?{sequence:item.sequence}:{})};}
    else{section='call';link={kind:'call',id};}
    const epoch=own.epoch,value=await json('operations-read',{id:own.capture.id,section,recordId:id,expectedSnapshot:own.capture.captureSha256});current(epoch);
    own.detail={value,link};const text=pretty(value.record);ui.detailValue.textContent=text.length>131072?text.slice(0,131072)+'\n… Preview ends here. Download complete original record above.':text;ui.detail.open=true;sync();
  }
  function linkDetail(){if(!own.detail)return;if(!own.caseId){own.caseId=crypto.randomUUID();ui.caseIdentity.textContent='New incident '+own.caseId;}
    if(!own.edit.links.some(value=>JSON.stringify(value)===JSON.stringify(own.detail.link))){own.edit.links.push(copy(own.detail.link));changed();renderLinks();}}
  function newCase(){if(!own.capture||!discard())return;own.caseId=crypto.randomUUID();own.caseView=null;own.edit=blank();own.saveIntent=null;own.exported=null;
    own.dirty=false;fillEdit();ui.title.focus();sync();}
  function readEdit(){return {title:ui.title.value,severity:ui.severity.value,state:ui.state.value,summary:ui.summary.value,impact:ui.impact.value,findings:ui.findings.value,
    review:{state:ui.reviewState.value,reviewer:ui.reviewer.value,note:ui.reviewNote.value},links:copy(own.edit.links),actions:copy(own.edit.actions)};}
  function fillEdit(){const value=own.edit;for(const key of ['title','severity','state','summary','impact','findings'])ui[key].value=value[key]??'';
    ui.reviewState.value=value.review.state;ui.reviewer.value=value.review.reviewer;ui.reviewNote.value=value.review.note;
    own.baseline=JSON.stringify(value);ui.history.replaceChildren();for(const row of own.caseView?.history??[])ui.history.append(new Option('v'+row.version+' · '+row.updatedAt+' · '+row.review.state,String(row.version)));
    if(own.caseView)ui.history.value=String(own.caseView.revision.version);
    ui.caseIdentity.textContent=own.caseView?'Incident '+own.caseId+' · viewing v'+own.caseView.revision.version+' · current v'+own.caseView.currentVersion+' · '+own.caseView.revision.sha256:
      own.caseId?'New incident '+own.caseId:'Start an incident from this saved capture.';
    ui.delivery.replaceChildren();renderActions();renderLinks();sync();}
  function renderLinks(){ui.links.replaceChildren();for(const [index,item]of own.edit.links.entries()){const row=node('div',undefined,'ops-linked');
    row.append(node('code',item.kind+' · '+item.id+(item.sequence?' · event '+item.sequence:'')));
    const b=node('button','Remove');b.type='button';b.onclick=()=>{own.edit.links.splice(index,1);changed();renderLinks();};row.append(b);ui.links.append(row);}
    if(!own.edit.links.length)ui.links.append(node('p','Open an original record above to link it.','ops-hint'));}
  function renderActions(){ui.actionRows.replaceChildren();for(const item of own.edit.actions){const box=node('fieldset');box.append(node('legend','Action '+short(item.id)));
    const grid=node('div',undefined,'ops-columns');box.append(grid);
    for(const [key,label,type]of [['title','Action','text'],['owner','Owner','text'],['state','State','select'],['dueAt','Due · local time','datetime-local'],['note','Progress and result','textarea']]){
      const wrap=node('label',label),control=type==='textarea'?node('textarea'):type==='select'?node('select'):node('input');
      if(type==='select')options(control,['planned','in-progress','completed','cancelled'].map(x=>[x]));else if(type!=='textarea')control.type=type;
      control.value=key==='dueAt'?(item.dueAt?localTime(item.dueAt):''):item[key]??'';control.maxLength=key==='title'?400:key==='owner'?200:4000;
      control.oninput=()=>{item[key]=key==='dueAt'?(control.value?new Date(control.value).toISOString():null):control.value;changed();};wrap.append(control);grid.append(wrap);}
    const b=node('button','Remove action');b.type='button';b.onclick=()=>{own.edit.actions=own.edit.actions.filter(value=>value.id!==item.id);changed();renderActions();};box.append(b);ui.actionRows.append(box);}
    if(!own.edit.actions.length)ui.actionRows.append(node('p','Add an action with an owner, intended outcome and retained progress.','ops-hint'));}
  function localTime(value){const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  async function openCase(id,version){
    if(!discard())return;own.epoch++;const epoch=own.epoch,result=await json('operations-case',{id,...(version?{version}:{})});current(epoch);
    own.caseId=id;own.caseView=result;own.capture=result.capture;own.edit=copy(result.revision.edit);own.dirty=false;own.saveIntent=null;own.exported=null;
    own.rows=null;own.detail=null;summary(own.capture);fillEdit();await rows();
  }
  async function save(){
    if(!own.capture)throw new Error('Select a complete operations capture.');own.caseId??=crypto.randomUUID();
    const edit=readEdit(),input={id:own.caseId,captureId:own.capture.id,expectedVersion:own.caseView?.currentVersion??0,edit},signature=JSON.stringify(input);
    let intent=storage('save');if(!intent||intent.signature!==signature)intent={signature,body:{operationId:crypto.randomUUID(),...input}};
    storage('save',intent);own.saveIntent=intent;const epoch=own.epoch,result=await json('operations-save',intent.body);current(epoch);
    removeStorage('save');own.caseView=result;own.edit=copy(result.revision.edit);own.dirty=false;own.saveIntent=null;own.exported=null;fillEdit();await caseList();
    notice('Saved incident revision '+result.revision.version+' with '+result.revision.edit.actions.length+' corrective actions.');
  }
  function saveBlob(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function deliver(){
    if(own.dirty)throw new Error('Save this incident draft before preparing its complete delivery.');
    if(!own.caseView)throw new Error('Save or open an original incident revision.');
    const epoch=own.epoch,selection={id:own.caseId,version:own.caseView.revision.version};
    if(onExport){const value=await onExport(selection);current(epoch);ui.delivery.replaceChildren(node('p','The complete five-file incident delivery is selected in Customer files. Its saved request and receiving remain in this Console.'),node('pre',pretty(value)));return value;}
    const descriptor=await json('operations-export',selection);current(epoch);own.exported=descriptor;ui.delivery.replaceChildren(node('h4','Complete delivery · v'+selection.version));
    ui.delivery.append(node('p',descriptor.exportSha256,'ops-identity'));
    for(const file of descriptor.files){const row=node('div',undefined,'ops-linked'),b=node('button','Download '+file.path);b.type='button';
      b.onclick=()=>perform(async()=>{const response=await api('operations-download',{exportSha256:descriptor.exportSha256,file:file.path}),bytes=await response.arrayBuffer();
        if(bytes.byteLength!==file.bytes)throw new Error('The original file length changed.');
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
        if(digest!==file.sha256||response.headers.get('x-content-sha256')!==digest)throw new Error('The original file differs from its saved SHA-256.');
        saveBlob(bytes,file.filename??file.path,file.contentType);},'Download complete original file');
      row.append(b,node('span',file.bytes+' bytes · '+file.sha256,'ops-identity'));ui.delivery.append(row);}
    notice('All five original delivery files are ready, including the full capture and every incident revision.');
  }
  async function receiveOriginal(){
    let input,signature;
    if(receiveMode==='file'){const file=ui.receiveFile.files[0];if(!file)throw new Error('Choose the complete original grpc-operations.json file.');
      if(file.size>128*1024*1024)throw new Error('The complete operations file exceeds 128 MiB.');
      const text=await file.text();try{input={bundle:JSON.parse(text)};}catch{throw new Error('The selected file is not complete JSON.');}
      signature=input.bundle.exportSha256;if(!/^[a-f0-9]{64}$/.test(signature??''))throw new Error('Choose a complete original operations export.');
    }else{const value=ui.receiveValue.value.trim();if(!value)throw new Error('Select the original export ID or declared operations file.');input={[ui.receiveKind.value]:value};signature=JSON.stringify(input);}
    let intent=storage('receive');if(!intent||intent.signature!==signature)intent={signature,operationId:crypto.randomUUID()};
    storage('receive',intent);const body={operationId:intent.operationId,...input},epoch=own.epoch,result=onReceive?await onReceive(body):await json('operations-receive',body);current(epoch);
    removeStorage('receive');ui.receiveInfo.textContent='Received original incident '+result.caseId+' through v'+result.receivedVersion+' · capture '+result.captureId;
    await refresh();if(discard()){own.dirty=false;await openCase(result.caseId);}notice('Complete incident history received into this original workspace.');
  }
  function sync(){
    ui.capture.disabled=own.pending||own.binding===false;ui.capture.setAttribute('aria-disabled',String(ui.capture.disabled));
    ui.capturesPrevious.disabled=!own.capturePage?.offset;ui.capturesNext.disabled=own.capturePage?.nextOffset===null||!own.capturePage;
    ui.casesPrevious.disabled=!own.casesPage?.offset;ui.casesNext.disabled=own.casesPage?.nextOffset===null||!own.casesPage;
    ui.previous.disabled=!own.rows?.offset;ui.next.disabled=own.rows?.nextOffset===null||!own.rows;
    for(const key of ['filter','newCase','save','addAction'])ui[key].disabled=!own.capture;
    ui.link.disabled=!own.detail;ui.downloadRecord.disabled=!own.detail;ui.export.disabled=!own.caseView||own.dirty;ui.openHistory.disabled=!own.caseView;
    ui.save.textContent=own.dirty?'Save incident revision · unsaved':'Save incident revision';
  }
  for(const key of ['title','severity','state','summary','impact','findings','reviewState','reviewer','reviewNote'])ui[key].addEventListener('input',changed);
  ui.section.onchange=()=>perform(()=>rows(),'Read captured records');
  function reset(binding=null){own.epoch++;own.binding=binding;own.capture=null;own.caseView=null;own.caseId=null;own.edit=blank();own.dirty=false;
    own.capturePage=null;own.casesPage=null;own.rows=null;own.detail=null;own.exported=null;own.saveIntent=null;
    for(const key of ['captures','cases','table','detailValue','delivery'])ui[key].replaceChildren();summary(null);fillEdit();sync();}
  function update(inventory,binding){
    if(binding!==undefined&&binding!==own.binding)reset(binding);
    own.inventory=inventory;const previous=ui.revisionFilter.value;
    ui.revisionFilter.replaceChildren(new Option('All saved revisions',''),...(inventory?.revisions??[]).map(value=>new Option(value.title+' · '+short(value.id),value.id)));
    if([...ui.revisionFilter.options].some(value=>value.value===previous))ui.revisionFilter.value=previous;
    sync();
  }
  summary(null);fillEdit();sync();
  return {update,reset,refresh,openCase,selectCapture,get dirty(){return own.dirty;},get selection(){return own.caseView?{id:own.caseId,version:own.caseView.revision.version,captureId:own.capture.id}:null;}};
}
