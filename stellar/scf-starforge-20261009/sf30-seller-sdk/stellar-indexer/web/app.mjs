// MIT. Client operations through the original native workspace methods.
import {saveSourceFolder} from '/source-transfer.mjs';
const $=id=>document.getElementById(id);
const parse=value=>JSON.parse(value);
const pretty=value=>JSON.stringify(value,null,2);
const text=(id,value)=>{$(id).textContent=value??'';};
const list=value=>Array.isArray(value)?value:[];
const short=value=>typeof value==='string'&&value.length>22?value.slice(0,10)+'…'+value.slice(-8):String(value??'');
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const uid=()=>crypto.randomUUID();
const sessionKey='stellar-indexer.session:'+location.origin;
const fragment=new URLSearchParams(location.hash.slice(1));
let token=fragment.get('token')??sessionStorage.getItem(sessionKey)??'';
if(fragment.has('token')){sessionStorage.setItem(sessionKey,token);history.replaceState(null,'',location.pathname+location.search);}
let state=null,selectedCapture=null,selectedWatch=null,selectedExport=null;
let rowSelection=null,rowOffset=0,rowNext=null;
let comparison=null,compareOffset=0,compareNext=null,refreshing=null;
const journalKey='stellar-indexer.requests:'+location.origin;
let pending;
try{pending=JSON.parse(localStorage.getItem(journalKey)??'[]');if(!Array.isArray(pending))pending=[];}catch{pending=[];}
const exportCache=new Map(),dispatches=new Map();
function notice(message,kind='info'){$('notice').hidden=!message;$('notice').textContent=message??'';$('notice').dataset.kind=kind;}
function fail(error){notice((error.code?error.code+': ':'')+(error.message??String(error)),'error');}
function element(tag,content,attributes={}){
  const node=document.createElement(tag);if(content!==undefined&&content!==null)node.textContent=String(content);
  for(const [key,value]of Object.entries(attributes)){if(key==='class')node.className=value;else node.setAttribute(key,String(value));}
  return node;
}
function action(label,handler){
  const button=element('button',label,{type:'button'});button.addEventListener('click',()=>busy(button,handler));return button;
}
async function busy(button,work){
  if(button.disabled)return;button.disabled=true;
  try{await work();}catch(error){fail(error);}finally{button.disabled=false;}
}
function bind(id,work){$(id).addEventListener('click',event=>{event.preventDefault();busy(event.currentTarget,work);});}
function form(id,work){$(id).addEventListener('submit',event=>{event.preventDefault();busy(event.submitter??event.currentTarget.querySelector('button[type=submit]'),work);});}
function show(tab){
  for(const panel of document.querySelectorAll('.tab'))panel.hidden=panel.id!=='tab-'+tab;
  for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===tab));
}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>show(button.dataset.tab));
function storage(){
  localStorage.setItem(journalKey,JSON.stringify(pending));renderPending();
}
function requestScope(path){
  return path.startsWith('/api/watch/')?'watches':path.startsWith('/api/event/')?'events':'indexer';
}
function workspaceSelection(scope){
  const operatorWorkspaceId=state?.indexer?.workspaceId,sourceWorkspaceId=state?.[scope]?.workspaceId;
  if(!['indexer','events','watches'].includes(scope)||typeof operatorWorkspaceId!=='string'||typeof sourceWorkspaceId!=='string')
    throw Object.assign(new Error('Refresh the original workspace before continuing this request.'),{code:'WORKSPACE_SELECTION_REQUIRED'});
  return {scope,operatorWorkspaceId,sourceWorkspaceId};
}
function selectionMatches(selection){
  if(!selection)return false;
  try{return stable(selection)===stable(workspaceSelection(selection.scope));}catch{return false;}
}
function requireSelection(row){
  if(!row.selection||row.selection.scope!==requestScope(row.path))
    throw Object.assign(new Error('This retained request has no original workspace identity. Review its full body and original workspace result before removing the local retry.'),{code:'REQUEST_WORKSPACE_UNRECORDED'});
  if(!selectionMatches(row.selection))
    throw Object.assign(new Error('Reopen the original workspace for this retained request: '+row.selection.operatorWorkspaceId+' / '+row.selection.sourceWorkspaceId+'.'),{code:'WORKSPACE_ID_MISMATCH'});
}
async function api(path,{method='GET',body,bytes=false,selection}={}){
  const selected=body===undefined?null:(selection??workspaceSelection(requestScope(path)));
  const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,
    ...(body===undefined?{}:{'content-type':'application/json',
      'x-stellar-indexer-workspace':selected.operatorWorkspaceId,
      'x-stellar-source-workspace':selected.sourceWorkspaceId})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store'});
  if(!response.ok){
    let value;try{value=await response.json();}catch{value={};}
    throw Object.assign(new Error(value.error?.message??'The original operation returned HTTP '+response.status+'.'),value.error??{code:'HTTP_'+response.status});
  }
  return bytes?new Uint8Array(await response.arrayBuffer()):await response.json();
}
const get=(path,args={})=>api(path+'?'+new URLSearchParams(Object.entries(args).filter(([,v])=>v!==undefined&&v!==null)));
const post=(path,body,selection)=>api(path,{method:'POST',body,selection});
const revision=scope=>{
  const value=state?.[scope]?.revision;if(!Number.isSafeInteger(value))throw new Error('Refresh the original '+scope+' workspace before changing it.');return value;
};
function dispatch(row,{refreshRevision=false}={}){
  if(dispatches.has(row.id))return dispatches.get(row.id);
  const task=(async()=>{
    try{
      await refresh();requireSelection(row);
      if(refreshRevision){
        if(row.lastError?.code!=='REVISION_CONFLICT')
          throw Object.assign(new Error('Recover this request with its unchanged original body.'),{code:'ORIGINAL_REQUEST_REQUIRED'});
        const current=revision(row.selection.scope);
        // All three native engines exclude expectedRevision from request identity.
        // Only an explicit conflict retry replaces this precondition; requestId
        // and every selected source/input remain the original saved values.
        if(current!==row.body.expectedRevision){
          row.revisionHistory??=[];
          row.revisionHistory.push({at:new Date().toISOString(),body:JSON.parse(JSON.stringify(row.body)),
            rejection:JSON.parse(JSON.stringify(row.lastError)),nextExpectedRevision:current});
          row.body={...row.body,expectedRevision:current};storage();
        }
      }
      const result=await post(row.path,row.body,row.selection);
      pending=pending.filter(item=>item.id!==row.id);storage();text('last-result',pretty(result));
      if(result.export)retainExport(row.path.startsWith('/api/watch/')?'watch':row.path.startsWith('/api/event/')?'event':'indexer',result.export);
      // An acknowledged native result remains successful if a later state read
      // loses its connection. Its original completed request is already retained.
      try{await refresh();notice(row.label+' saved.');}
      catch(error){notice(row.label+' saved. Refresh the connection to read its current workspace: '+error.message);}
      return result;
    }catch(error){
      row.lastError={code:error.code??'OPERATOR_ERROR',message:error.message,
        ...(error.details===undefined?{}:{details:error.details}),at:new Date().toISOString()};
      if(error.code==='REVISION_CONFLICT'){
        try{await refresh();if(selectionMatches(row.selection))row.lastError.currentRevision=revision(row.selection.scope);}catch{}
      }
      storage();throw error;
    }
  })().finally(()=>{if(dispatches.get(row.id)===task)dispatches.delete(row.id);renderPending();});
  dispatches.set(row.id,task);renderPending();return task;
}
async function mutate(path,input,scope,label){
  const selection=workspaceSelection(scope),fingerprint=stable({path,input,selection});
  let row=pending.find(item=>item.fingerprint===fingerprint&&selectionMatches(item.selection));
  if(!row){row={id:uid(),path,input,selection,fingerprint,label,createdAt:new Date().toISOString(),
    body:{...input,requestId:uid(),expectedRevision:revision(scope)}};pending.push(row);storage();}
  return dispatch(row,{refreshRevision:row.lastError?.code==='REVISION_CONFLICT'});
}
function renderPending(){
  const target=$('pending-requests');target.replaceChildren();
  if(!pending.length){target.append(element('p','No interrupted request is waiting.'));return;}
  for(const row of pending){
    const node=element('div',undefined,{class:'record'});node.append(element('strong',row.label??row.path));
    const matching=selectionMatches(row.selection),running=dispatches.has(row.id),conflict=row.lastError?.code==='REVISION_CONFLICT';
    const identity=row.selection?row.selection.scope+' · '+short(row.selection.operatorWorkspaceId)+' / '+short(row.selection.sourceWorkspaceId):
      'Original workspace identity was not recorded';
    node.append(element('p',identity,{class:'hint'}));
    node.append(element('p',(row.lastError?.message??'Original request retained.')+' · '+row.createdAt,{class:'hint'}));
    if(conflict&&matching)node.append(element('p','The workspace is now at revision '+revision(row.selection.scope)+
      '. Review its current source and the retained request before retrying at that revision.',{class:'hint'}));
    const buttons=element('div',undefined,{class:'button-row'});
    const retry=action(running?'Original request running':conflict?'Retry with current revision':'Retry original request',
      ()=>dispatch(row,{refreshRevision:conflict}));
    retry.disabled=running||!matching;buttons.append(retry);
    buttons.append(action('Review original body',()=>{text('last-result',pretty(row));}));
    buttons.append(action('Remove local retry',async()=>{
      if(dispatches.has(row.id))return;
      if(!confirm('Remove this local retry after checking its original workspace result? Its source operation stays retained.'))return;
      pending=pending.filter(item=>item.id!==row.id);storage();await refresh();
    }));node.append(buttons);target.append(node);
  }
}
function options(id,rows,label,placeholder){
  const select=$(id),previous=select.value;
  select.replaceChildren();
  if(placeholder!==undefined)select.append(element('option',placeholder,{value:''}));
  for(const row of rows)select.append(element('option',label(row),{value:row.id??row.alias}));
  if([...select.options].some(option=>option.value===previous))select.value=previous;
}
function empty(node,message){node.replaceChildren(element('p',message,{class:'empty'}));}
function metric(label,value){const node=element('div',undefined,{class:'metric'});node.append(element('strong',value),element('span',label));return node;}
function records(id,rows,build,message){
  const node=$(id);node.replaceChildren();if(!rows.length){empty(node,message);return;}
  for(const row of rows)node.append(build(row));
}
function record(title,status,description,buttons=[]){
  const node=element('div',undefined,{class:'record'}),heading=element('div',undefined,{class:'record-title'});
  heading.append(element('strong',title));if(status)heading.append(element('span',status,{class:'badge'}));
  node.append(heading);if(description)node.append(element('p',description,{class:'hint'}));
  if(buttons.length){const line=element('div',undefined,{class:'button-row'});line.append(...buttons);node.append(line);}
  return node;
}
const queryTitle=q=>(q.name??q.id)+' · v'+q.currentVersion;
const editionTitle=e=>(e.method??e.name??'Edition')+' · '+(e.rowCount??e.eventCount??0)+' rows · '+short(e.id);
function checkboxes(id,rows,label){
  const target=$(id),selected=new Set([...target.querySelectorAll('input:checked')].map(input=>input.value));
  target.replaceChildren();if(!rows.length){empty(target,'No retained selections yet.');return;}
  for(const row of rows){const labelNode=element('label'),input=element('input',undefined,{type:'checkbox',value:row.id});
    input.checked=selected.has(row.id);labelNode.append(input,element('span',label(row)));target.append(labelNode);}
}
function checked(id){return [...$(id).querySelectorAll('input:checked')].map(input=>input.value);}
function number(id,{optional=false,min=0}={}){
  const value=$(id).value;if(optional&&value==='')return undefined;
  const valueNumber=Number(value);if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(valueNumber)||valueNumber<min)
    throw new Error('Enter an exact integer for '+id.replaceAll('-',' ')+'.');return valueNumber;
}
function jsonInput(id,kind='object'){
  let value;try{value=JSON.parse($(id).value);}catch{throw new Error('Enter complete JSON in '+id.replaceAll('-',' ')+'.');}
  if(kind==='array'?!Array.isArray(value):!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Use a JSON '+kind+' in '+id.replaceAll('-',' ')+'.');return value;
}
function required(id){const value=$(id).value.trim();if(!value)throw new Error('Select '+id.replaceAll('-',' ')+'.');return value;}
function methodDetails(){
  const method=list(state?.indexer.methods).find(item=>item.id===$('query-method').value);
  if(!method)return;
  text('method-description',(method.kind==='composition'?'Complete native composition. ':'Original SDK method. ')+method.description);
  const labels=list(method.arguments);
  text('method-arguments','Ordered arguments: '+(labels.length?labels.join(' → '):'none')+
    (method.requiresOptions?.length?'. Required SDK options: '+method.requiresOptions.join(', '):''));
  $('query-mode').disabled=!method.pagination;$('query-page').disabled=!method.pagination;$('query-limit').disabled=!method.pagination;
  if(!method.pagination)$('query-mode').value='once';
  text('query-source',pretty(method));
}
function render(){
  const sdk=state.indexer,events=state.events,watches=state.watches;
  const queries=list(sdk.queries),captures=list(sdk.captures),editions=list(sdk.editions),watchRows=list(watches.watches);
  text('connection-status','Saved · Indexer revision '+sdk.revision+' · Events '+events.revision+' · Watches '+watches.revision);
  text('workspace-id',sdk.workspaceId);
  $('metrics').replaceChildren(metric('Saved queries',queries.length),metric('Captures',captures.length),
    metric('Completed editions',editions.length),metric('Recurring watches',watchRows.length));
  const connections=$('connections');connections.replaceChildren();
  for(const connection of list(sdk.connections))connections.append(record(connection.alias,'INDEXER',connection.network+' · '+(connection.apiUrl??'')));
  for(const connection of list(events.connections))connections.append(record(connection.alias,'EVENT RPC',connection.network+' · '+(connection.rpcOrigin??'')));
  if(!connections.childNodes.length)empty(connections,'Source review and receiving are available. Add private connection aliases to run new native captures.');
  const runners=$('runners');runners.replaceChildren();
  for(const row of list(state.runners.captures))runners.append(record(short(row.captureId),row.status,row.startedAt));
  runners.append(record('Original event service runner',state.runners.events.status,state.runners.events.lastError?.message??'Source progress stays in its native watch.'));
  text('state-source',pretty(state));
  options('query-existing',queries,queryTitle,'New query');
  options('query-method',list(sdk.methods),method=>(method.kind==='composition'?'Composition · ':'Native · ')+method.name);
  options('query-connection',list(sdk.connections),row=>row.alias+' · '+row.network,'Select service alias');
  options('capture-query',queries,queryTitle,'Select saved query');
  options('capture-recovery-alias',list(sdk.connections),row=>row.alias+' · '+row.network,'Original alias');
  options('compare-before',editions,editionTitle,'Select before edition');options('compare-after',editions,editionTitle,'Select after edition');
  options('watch-existing',watchRows,row=>row.name+' · '+short(row.id),'New watch');
  options('watch-plan',list(events.plans),row=>(row.name??row.id)+' · v'+(row.currentVersion??row.version??1),'Select event plan');
  options('watch-connection',list(events.connections),row=>row.alias+' · '+row.network,'Select primary RPC alias');
  options('watch-recovery',list(events.connections),row=>row.alias+' · '+row.network,'None');
  options('watch-publication',[{id:'__clear__',label:'Stop future publication'},...list(state.publicationAliases)],row=>row.label,'Keep selected publication');
  options('receive-alias',list(sdk.connections),row=>row.alias+' · '+row.network,'Keep original alias');
  options('receive-watch-recovery',list(events.connections),row=>row.alias+' · '+row.network,'None');
  if($('receive-kind').value==='watch')options('receive-alias',list(events.connections),row=>row.alias+' · '+row.network,'Keep original alias');
  records('query-list',queries,q=>record(q.name,'v'+q.currentVersion,short(q.id),[
    action('Load query',()=>loadQuery(q.id)),action('Use for capture',async()=>{$('capture-query').value=q.id;show('captures');})]),'Save the client’s first native source query.');
  records('capture-list',captures,c=>record(c.query?.name??short(c.queryId),c.status,
    short(c.id)+' · '+(c.rowCount??0)+' rows · '+(c.pageCount??0)+' pages · next '+c.nextPage,[
      action('Inspect',()=>selectCapture(c.id)),action('Rows',()=>selectRows({captureId:c.id})),action('Full source',()=>exportCapture(c.id))]),'The original saved captures will appear here.');
  records('edition-list',editions,e=>record(e.method??e.name??short(e.id),'EDITION',
    (e.rowCount??0)+' rows · '+short(e.sha256)+' · '+(e.completedAt??e.createdAt??''),[
      action('Rows',()=>selectRows({editionId:e.id})),
      action('Source identity',async()=>{text('capture-source',pretty(await get('/api/edition',{editionId:e.id})));show('captures');}),
      action('Full source',()=>mutate('/api/source/export',{editionId:e.id},'indexer','Edition source export'))]),'A native capture produces an edition when its selected source completes.');
  records('event-plan-list',list(events.plans),p=>record(p.name,'v'+(p.currentVersion??p.version??1),short(p.id),[
    action('Select for watch',async()=>{$('watch-plan').value=p.id;$('watch-plan-version').value=p.currentVersion??p.version??'';}),
    action('Original plan',async()=>text('watch-source',pretty(p)))]),'Save the exact client contract and topic selection.');
  records('watch-list',watchRows,w=>record(w.name,w.status,
    short(w.id)+' · next ledger '+(w.nextLedger??'source latest')+' · '+list(w.windows).length+' completed windows',[
      action('Inspect',()=>selectWatch(w.id)),action('Load configuration',()=>loadWatch(w.id)),
      action('Start',()=>mutate('/api/watch/start',{watchId:w.id},'watches','Watch start')),
      action('Pause',()=>mutate('/api/watch/pause',{watchId:w.id},'watches','Watch pause'))]),'Saved services retain every original window and recovery choice.');
  text('watch-revision','Original watch revision '+watches.revision);
  checkboxes('delivery-editions',editions,editionTitle);checkboxes('delivery-captures',captures,c=>short(c.id)+' · '+c.status+' · '+(c.rowCount??0)+' rows');
  checkboxes('delivery-watches',watchRows,w=>w.name+' · '+w.status+' · '+short(w.id));
  for(const [kind,items]of [['indexer',sdk.exports],['event',events.exports],['watch',watches.exports]])
    for(const exported of list(items))retainExport(kind,exported,false);
  renderExports();renderPending();
}
async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    const next=await get('/api/state');
    const identity=value=>stable({indexer:value?.indexer?.workspaceId,events:value?.events?.workspaceId,watches:value?.watches?.workspaceId});
    if(state&&identity(state)!==identity(next)){
      selectedCapture=null;selectedWatch=null;selectedExport=null;rowSelection=null;comparison=null;
      rowOffset=0;rowNext=null;compareOffset=0;compareNext=null;exportCache.clear();
      for(const id of ['capture-source','row-source','watch-source','query-source','receive-source','last-result'])text(id,'');
      notice('The selected workspace changed. Original interrupted requests remain attached to their recorded workspace.');
    }
    state=next;render();if(!$('method-description').textContent)methodDetails();return state;
  })().finally(()=>{refreshing=null;});return refreshing;
}
function loadQuery(id){
  id=id??required('query-existing');const query=list(state.indexer.queries).find(item=>item.id===id);
  if(!query)throw new Error('Select an original saved query.');
  const version=list(query.versions).find(item=>item.version===query.currentVersion)??query.versions?.at(-1);
  if(!version)throw new Error('The original query version is unavailable.');
  $('query-existing').value=id;$('query-name').value=version.name??query.name;$('query-method').value=version.method;
  $('query-connection').value=version.connectionAlias;$('query-mode').value=version.pagination?.mode??'once';
  $('query-page').value=version.pagination?.startPage??0;$('query-limit').value=version.pagination?.limit??25;
  $('query-args').value=pretty(version.args??[]);$('query-options').value=pretty(version.sdkOptions??{});
  methodDetails();text('query-source',pretty(query));show('queries');
}
function queryInput(){
  const method=list(state.indexer.methods).find(item=>item.id===required('query-method'));
  return {name:required('query-name'),connectionAlias:required('query-connection'),method:method.id,
    args:jsonInput('query-args','array'),sdkOptions:jsonInput('query-options'),
    pagination:method.pagination?{mode:$('query-mode').value,startPage:number('query-page'),limit:number('query-limit',{min:1})}:{mode:'once'}};
}
async function selectCapture(id){
  selectedCapture=id;text('capture-selected-id',id);text('capture-source',pretty(await get('/api/capture',{captureId:id})));show('captures');
}
function needCapture(){if(!selectedCapture)throw new Error('Select the original capture first.');return selectedCapture;}
async function exportCapture(id){const result=await mutate('/api/source/export',{captureId:id},'indexer','Capture source export');selectExport('indexer',result.export);}
function table(target,headings,rows,renderRow){
  const host=$(target),table=element('table'),head=element('thead'),tr=element('tr');
  for(const heading of headings)tr.append(element('th',heading));head.append(tr);table.append(head);
  const body=element('tbody');for(const row of rows){const tr=element('tr');for(const value of renderRow(row)){const td=element('td');td.append(value instanceof Node?value:document.createTextNode(String(value??'')));tr.append(td);}body.append(tr);}
  table.append(body);host.replaceChildren(table);if(!rows.length)host.append(element('p','No rows in this selection.',{class:'empty'}));
}
async function selectRows(selection,offset=0){
  rowSelection=selection;rowOffset=offset;const result=await get('/api/rows',{...selection,offset,limit:50});rowNext=result.nextOffset;
  text('rows-label',(selection.editionId?'Edition ':'Capture ')+short(selection.editionId??selection.captureId)+
    ' · '+result.total+' rows · '+(result.rows.length?offset+1:0)+'–'+(offset+result.rows.length));
  table('rows-table',['Row','Original key','Native value','Source'],list(result.rows),row=>[
    row.index,short(row.key),element('pre',pretty(row.display??row.value)),
    action('Inspect complete value',async()=>text('row-source',pretty(row)))]);
  $('rows-prev').disabled=offset===0;$('rows-next').disabled=rowNext===null||rowNext===undefined;show('captures');
}
async function compareRows(offset=0){
  if(!comparison)throw new Error('Select two original editions.');
  const result=await get('/api/compare',{...comparison,offset,limit:50});compareOffset=offset;compareNext=result.nextOffset;
  const summary=result.summary??{};$('compare-summary').replaceChildren();
  for(const [key,value]of Object.entries(summary))if(['number','string','boolean'].includes(typeof value))$('compare-summary').append(metric(key.replaceAll('_',' '),value));
  table('compare-table',['Change','Full retained difference'],list(result.changes),row=>[
    row.kind??row.type??short(row.key),element('pre',pretty(row))]);
  text('compare-source',pretty({...result,changes:undefined}));$('compare-prev').disabled=offset===0;
  $('compare-next').disabled=compareNext===null||compareNext===undefined;
}
async function selectWatch(id){
  selectedWatch=id;text('watch-selected-id',id);const result=await get('/api/watch',{watchId:id});text('watch-source',pretty(result));show('events');return result.watch;
}
async function loadWatch(id){
  id=id??required('watch-existing');const watch=await selectWatch(id),config=watch.config;
  $('watch-existing').value=id;$('watch-name').value=watch.name;$('watch-plan').value=watch.planId;
  $('watch-plan-version').value=watch.planVersion;$('watch-start-ledger').value=watch.initialLedger??'';
  $('watch-end-ledger').value=watch.endLedger??'';$('watch-window').value=config.windowLedgers;
  $('watch-poll').value=config.pollIntervalMs;$('watch-connection').value=config.connectionAlias;
  $('watch-recovery').value=config.recoveryConnectionAlias??'';
  // Keep a retained publication descriptor unchanged unless the operator selects a new alias.
  $('watch-publication').value='';$('watch-publication').dataset.keep=JSON.stringify(config.publication??null);
}
function needWatch(){if(!selectedWatch)throw new Error('Select the original watch first.');return selectedWatch;}
function watchInput(configure=false){
  const value={name:required('watch-name'),windowLedgers:number('watch-window',{min:1}),pollIntervalMs:number('watch-poll',{min:1000}),
    connectionAlias:required('watch-connection'),recoveryConnectionAlias:$('watch-recovery').value||null,
    endLedger:number('watch-end-ledger',{optional:true,min:2})??null};
  const version=number('watch-plan-version',{optional:true,min:1});if(version!==undefined)value.planVersion=version;
  if(!configure){value.planId=required('watch-plan');const start=number('watch-start-ledger',{optional:true,min:1});if(start!==undefined)value.startLedger=start;}
  if($('watch-publication').value==='__clear__')value.publication=null;
  else if($('watch-publication').value)value.publicationAlias=$('watch-publication').value;
  else if(!(configure&&$('watch-publication').dataset.keep))value.publication=null;
  return value;
}
function retainExport(kind,exported,select=true){
  if(!exported?.id)return;const key=kind+':'+exported.id,old=exportCache.get(key);
  exportCache.set(key,{kind,exported:{...old?.exported,...exported}});
  if(select)selectExport(kind,exported);
}
function renderExports(){
  records('export-list',[...exportCache.values()].reverse(),({kind,exported})=>record(short(exported.id),kind.toUpperCase(),
    (exported.manifest?.fileCount??exported.fileCount??'?')+' original files · '+(exported.manifest?.bytes??exported.bytes??'?')+' bytes',[
      action('Inspect full manifest',()=>selectExport(kind,exported))]),'Create a retained source or complete client delivery.');
}
async function selectExport(kind,exported){
  if(!exported?.manifest){
    const path=sourceRoute(kind);const bytes=await api(path+'?'+new URLSearchParams({exportId:exported.id,path:'manifest.json'}),{bytes:true});
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const sha=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    exported={...exported,manifest,manifestSha256:sha};exportCache.set(kind+':'+exported.id,{kind,exported});
  }
  selectedExport={kind,exported};text('export-selected-id',exported.id);text('export-source',pretty(exported));
  table('export-files',['Original file','Bytes','SHA256'],list(exported.manifest?.files),file=>[file.path,file.bytes,file.sha256]);
  show('handover');return exported;
}
function sourceRoute(kind){return kind==='watch'?'/api/watch/source-file':kind==='event'?'/api/event/source-file':'/api/source-file';}
function downloadJSON(value,name){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const link=element('a',undefined,{href:url,download:name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
bind('refresh',refresh);
bind('start-watch-runner',async()=>{text('last-result',pretty(await post('/api/watch/runner/start',{})));await refresh();});
bind('query-load',()=>loadQuery());
bind('query-new',async()=>{$('query-existing').value='';$('query-name').value='';$('query-args').value='[]';$('query-options').value='{}';methodDetails();});
$('query-method').addEventListener('change',methodDetails);
form('query-form',()=>mutate('/api/query/save',queryInput(),'indexer','Native query'));
bind('query-configure',()=>mutate('/api/query/configure',{...queryInput(),queryId:required('query-existing')},'indexer','Pinned query version'));
form('capture-start-form',async()=>{
  const version=number('capture-version',{optional:true,min:1});
  const result=await mutate('/api/capture/start',{queryId:required('capture-query'),...(version===undefined?{}:{queryVersion:version})},'indexer','Native capture');
  await selectCapture(result.capture.id);
});
bind('capture-inspect',()=>selectCapture(needCapture()));
bind('capture-pause',async()=>{await mutate('/api/capture/pause',{captureId:needCapture()},'indexer','Capture pause');await selectCapture(selectedCapture);});
bind('capture-run',async()=>{text('last-result',pretty(await post('/api/capture/run',{captureId:needCapture()})));await selectCapture(selectedCapture);await refresh();});
bind('capture-resume',async()=>{await mutate('/api/capture/resume',{captureId:needCapture(),
  ...($('capture-recovery-alias').value?{connectionAlias:$('capture-recovery-alias').value}:{})},'indexer','Native capture resume');await selectCapture(selectedCapture);});
bind('capture-export',()=>exportCapture(needCapture()));
bind('rows-prev',()=>selectRows(rowSelection,Math.max(0,rowOffset-50)));
bind('rows-next',()=>selectRows(rowSelection,rowNext));
form('compare-form',async()=>{comparison={beforeEditionId:required('compare-before'),afterEditionId:required('compare-after')};await compareRows(0);});
bind('compare-prev',()=>compareRows(Math.max(0,compareOffset-50)));bind('compare-next',()=>compareRows(compareNext));
form('event-plan-form',async()=>{
  const contracts=required('event-contracts').split(/[\s,]+/).filter(Boolean),topics=jsonInput('event-topics','array');
  const result=await mutate('/api/event/plan',{name:required('event-plan-name'),filters:[{type:'contract',contractIds:contracts,...(topics.length?{topics}:{})}],
    pageSize:number('event-page',{min:1}),startLedger:number('event-start',{optional:true,min:1})??null,
    endLedger:number('event-end',{optional:true,min:2})??null},'events','Original event plan');
  if(result.plan?.id)$('watch-plan').value=result.plan.id;text('watch-source',pretty(result));
});
form('watch-form',async()=>{const result=await mutate('/api/watch/save',watchInput(),'watches','Recurring event watch');await selectWatch(result.watch.id);});
bind('watch-load',()=>loadWatch());
$('watch-existing').addEventListener('change',()=>{delete $('watch-publication').dataset.keep;});
$('watch-publication').addEventListener('change',()=>{delete $('watch-publication').dataset.keep;});
bind('watch-configure',async()=>{const watchId=required('watch-existing');await mutate('/api/watch/configure',{...watchInput(true),watchId},'watches','Future watch configuration');await selectWatch(watchId);});
bind('watch-start',async()=>{await mutate('/api/watch/start',{watchId:needWatch()},'watches','Watch start');await selectWatch(selectedWatch);});
bind('watch-pause',async()=>{await mutate('/api/watch/pause',{watchId:needWatch()},'watches','Watch pause');await selectWatch(selectedWatch);});
bind('watch-catch-up',async()=>{text('last-result',pretty(await post('/api/watch/run',{watchId:needWatch(),maxWindows:number('watch-max-windows',{min:1})})));await refresh();await selectWatch(selectedWatch);});
bind('watch-repair',async()=>{await mutate('/api/watch/repair',{...jsonInput('watch-repair-input'),watchId:needWatch()},'watches','Original source repair');await selectWatch(selectedWatch);});
bind('watch-export',async()=>{const result=await mutate('/api/watch/export',{watchId:needWatch()},'watches','Complete watch export');await selectExport('watch',result.export);});
bind('watch-inspect',()=>selectWatch(needWatch()));
form('delivery-form',async()=>{
  const input={editionIds:checked('delivery-editions'),captureIds:checked('delivery-captures'),watchIds:checked('delivery-watches')};
  if(!input.editionIds.length&&!input.captureIds.length&&!input.watchIds.length)throw new Error('Select the original client editions, captures or watches.');
  const result=await mutate('/api/delivery/export',input,'indexer','Complete client delivery');await selectExport('indexer',result.export);
});
$('receive-kind').addEventListener('change',()=>{if(!state)return;const isWatch=$('receive-kind').value==='watch';
  options('receive-alias',list(isWatch?state.events.connections:state.indexer.connections),row=>row.alias+' · '+row.network,'Keep original alias');});
form('receive-form',async()=>{
  const kind=required('receive-kind'),input={sourceDirectory:required('receive-directory')},manifest=$('receive-sha').value.trim(),alias=$('receive-alias').value;
  if(manifest)input.expectedManifestSha256=manifest;
  if(kind!=='event'&&alias)input.connectionAlias=alias;
  if(kind==='delivery')input.watchConnections=jsonInput('receive-watch-connections');
  if(kind==='watch'){
    if($('receive-watch-recovery').value)input.recoveryConnectionAlias=$('receive-watch-recovery').value;
    if($('receive-publication-directory').value.trim())input.publicationDirectory=$('receive-publication-directory').value.trim();
  }
  const route=kind==='event'?'/api/event/receive':kind==='watch'?'/api/watch/receive':kind==='delivery'?'/api/delivery/receive':'/api/source/receive';
  const result=await mutate(route,input,kind==='event'?'events':kind==='watch'?'watches':'indexer','Complete source receiving');text('receive-source',pretty(result));
});
bind('export-json',async()=>{if(!selectedExport)throw new Error('Select a retained export.');downloadJSON(selectedExport.exported,'stellar-client-'+selectedExport.exported.id+'.json');});
bind('export-download',async()=>{
  if(!selectedExport)throw new Error('Select a retained export.');
  const {kind,exported}=selectedExport,route=sourceRoute(kind),progress=$('export-progress');progress.hidden=false;
  try{
    const result=await saveSourceFolder({exported,filenamePrefix:'stellar-client',readRange:async(path,offset,length)=>
      api(route+'?'+new URLSearchParams({exportId:exported.id,path,offset,length}),{bytes:true}),
      progress:update=>{
        progress.max=Math.max(1,update.totalBytes??1);progress.value=update.bytes??0;
        text('export-progress-label',(update.phase??'Copying')+' · '+(update.path??'')+' · '+(update.bytes??0)+' / '+(update.totalBytes??0)+' bytes');
      }});
    text('last-result',pretty(result));notice('The complete original source folder was saved and verified.');
  }finally{progress.hidden=true;}
});
renderPending();
refresh().catch(fail);
setInterval(()=>{if(!document.hidden)refresh().catch(error=>{text('connection-status','Refresh needed');fail(error);});},5000);
