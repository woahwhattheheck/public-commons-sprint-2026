const config=JSON.parse(document.getElementById('runtimeConfig').textContent);
const el=id=>document.getElementById(id);
const ID=/^[A-Za-z0-9_-]{1,80}$/;
const STORAGE='evidenceforge-operations-v1';
let current=null,recent=[],busy=false,verifiedRun=null,indexRows=[];
function node(tag,text,className){
  const value=document.createElement(tag);
  if(text!==undefined)value.textContent=String(text);
  if(className)value.className=className;
  return value;
}
function message(text){el('state').textContent=text;}
function controls(){
  el('run').disabled=busy||current!==null;
  for(const id of ['task','control','operation','load','refreshRuns'])el(id).disabled=busy;
  for(const id of ['copyOperation','inspectCurrent','newOperation'])el(id).disabled=busy||!current;
  el('downloadRun').disabled=busy||!verifiedRun||verifiedRun.operation_id!==current;
  for(const button of el('runs').querySelectorAll('button'))button.disabled=busy;
}
function saveSelection(){
  try{
    localStorage.setItem(STORAGE,JSON.stringify({schema:1,current,recent}));
    el('storageStatus').textContent='The selected operation and up to 20 recent IDs are saved in this browser. No action token or run content is stored.';
  }catch{
    el('storageStatus').textContent='Browser storage is unavailable. Copy the operation ID before leaving; retained server files remain separate.';
  }
}
function readSelection(){
  try{
    const raw=localStorage.getItem(STORAGE);
    if(!raw)return;
    if(raw.length>16384)throw new Error('oversized selection');
    const saved=JSON.parse(raw);
    if(saved.schema!==1||!Array.isArray(saved.recent)||saved.recent.length>20||
      (saved.current!==null&&(typeof saved.current!=='string'||!ID.test(saved.current))))throw new Error('invalid selection');
    recent=saved.recent.filter(row=>row&&typeof row.operation_id==='string'&&ID.test(row.operation_id))
      .map(row=>({operation_id:row.operation_id,
        task:config.tasks.some(task=>task.task_id===row.task)?row.task:null,
        control:['baseline','corrected'].includes(row.control)?row.control:null,
        kind:row.kind==='request'?'request':'selection'}));
    current=saved.current;
  }catch{
    current=null;recent=[];
    el('storageStatus').textContent='The browser selection could not be restored. Use a retained operation or enter its ID; no run was started.';
  }
}
function remember(identity,metadata={}){
  current=identity;
  const prior=recent.find(row=>row.operation_id===identity);
  recent=[{operation_id:identity,task:null,control:null,kind:'selection',...prior,...metadata},
    ...recent.filter(row=>row.operation_id!==identity)].slice(0,20);
  saveSelection();showCurrent();renderIndex();
}
function showCurrent(){
  el('operationPanel').hidden=!current;
  el('currentOperation').textContent=current||'';
  if(current)el('operation').value=current;
  controls();
}
function clearDisplay(){
  verifiedRun=null;
  el('result').hidden=true;el('journalPanel').hidden=true;
  el('patch').textContent='';el('envelope').textContent='';el('journal').textContent='';
  controls();
}
async function api(path,body){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',
    headers:{'X-Action-Token':config.token,...(body===undefined?{}:{'Content-Type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body)});
  let data;
  try{data=await response.json();}catch{throw new Error('The response was interrupted or unreadable. Inspect the saved operation ID; no automatic retry was made.');}
  if(!response.ok)throw new Error(data.error||`Request failed (HTTP ${response.status})`);
  return data;
}
function renderIndex(){
  const known=new Set(indexRows.map(row=>row.operation_id));
  const local=recent.filter(row=>!known.has(row.operation_id)).map(row=>({...row,local:true}));
  const rows=[...local,...indexRows];
  el('runs').replaceChildren(...rows.map(row=>{
    const button=node('button',undefined,'operation-card'+(row.operation_id===current?' selected':''));
    button.type='button';button.disabled=busy;
    button.setAttribute('aria-pressed',String(row.operation_id===current));
    const description=row.local
      ?`${row.kind==='request'?'Browser request ID':'Browser selection'} · server state not listed`
      :`${row.state} · ${row.has_result_file?'result file present, not yet verified':'journal only'} · observed file time ${row.modified_at||'unavailable'}`;
    button.append(node('span',row.operation_id,'operation-id'),node('span',description,'operation-meta'));
    button.addEventListener('click',()=>openOperation(row.operation_id));
    return button;
  }));
  if(!rows.length)el('runs').append(node('p','No retained operations were listed. Start an original control or enter a known operation ID.','empty-state'));
}
async function refreshIndex(){
  const data=await api('/api/operations');
  indexRows=data.operations;
  el('runsStatus').textContent=data.truncated
    ?`Partial index: up to ${data.limit} operations from a bounded directory scan. This may omit newer or older operations; enter a known ID to open it directly.`
    :`${indexRows.length} retained operation${indexRows.length===1?'':'s'} listed. Recorded journal state is not verified completion.`;
  renderIndex();
}
function displayResult(run){
  verifiedRun=run;
  el('result').hidden=false;
  const passed=run.receipt.required_tests_green===true;
  el('heading').textContent=passed?'Original named checks passed':'Original named checks did not all pass';
  el('heading').className=passed?'green':'red';
  const elapsed=Number.isFinite(run.wall_seconds)?run.wall_seconds.toFixed(3)+' seconds':'runtime not recorded';
  el('facts').textContent=`${run.provider?.provider||'Provider not recorded'} · ${elapsed} · ${run.task_id||'Task not recorded'} · operation ${run.operation_id}. ${run.qualifying_nebius_runtime_observed===true
    ?'The envelope records a Nebius runtime; the original API call record is still needed to authenticate that claim.'
    :'No qualifying Nebius runtime is recorded by this run.'}`;
  const after=run.checks?.[0]?.cases||[];
  el('checks').replaceChildren(...(run.baseline?.cases||[]).map(before=>{
    const row=node('tr'),matched=after.find(item=>item.name===before.name);
    row.append(node('th',before.name),node('td',before.passed?'PASS':'FAIL'),
      node('td',matched?(matched.passed?'PASS':'FAIL'):'not executed'));
    row.firstChild.scope='row';return row;
  }));
  el('patch').textContent=run.patch||'No source delta.';
  el('envelope').textContent=JSON.stringify(run,null,2);
}
async function inspect(identity){
  const view=await api('/api/operation?id='+encodeURIComponent(identity));
  if(view.operation_id!==identity)throw new Error('The returned operation did not match the selected ID.');
  el('journalPanel').hidden=false;
  el('journalState').textContent=view.journal?.state
    ?`Recorded journal state: ${view.journal.state}`:'Original journal unavailable';
  el('journal').textContent=view.journal?JSON.stringify(view.journal,null,2):'No readable original journal was returned.';
  el('operationMessage').textContent=view.message;
  if(view.result_verified===true&&view.run?.operation_id===identity){
    displayResult(view.run);
    message('Opened the retained result. Hash and receipt consistency were checked; nothing was executed or approved.');
  }else{
    message('Opened the recorded operation state. No verified result is available; no retry or new run was dispatched.');
  }
  return view.result_verified===true&&view.run?.operation_id===identity;
}
async function openOperation(identity){
  if(busy)return;
  if(typeof identity!=='string'||!ID.test(identity)){message('Enter a valid operation ID using letters, numbers, underscores or hyphens (up to 80 characters).');return;}
  busy=true;clearDisplay();remember(identity);message('Reading the retained operation…');
  try{await inspect(identity);}
  catch(error){
    el('journalPanel').hidden=false;el('journalState').textContent='Operation not confirmed';
    el('operationMessage').textContent=error.message;
    message('Keep this ID and inspect again when ready. Missing or unreadable records do not prove a request was never received. Nothing was dispatched.');
  }finally{busy=false;controls();}
}
for(const task of config.tasks){const option=node('option',task.task_id);option.value=task.task_id;el('task').append(option);}
function goal(){el('goal').textContent=config.tasks.find(task=>task.task_id===el('task').value)?.goal||'';}
el('task').addEventListener('change',goal);goal();
el('run').addEventListener('click',async()=>{
  if(busy||current)return;
  if(!crypto.randomUUID){message('This browser cannot generate an operation ID. Open the local app in a current browser.');return;}
  const request={task:el('task').value,control:el('control').value,operation_id:crypto.randomUUID()};
  busy=true;clearDisplay();
  // Persist and display the operation before the one dispatch, including if its response is lost.
  remember(request.operation_id,{task:request.task,control:request.control,kind:'request'});
  message('Executing the original selected control. Its operation ID is retained above.');
  try{
    const run=await api('/api/run',request);
    if(run.operation_id!==request.operation_id)throw new Error('The run response did not match the dispatched operation ID.');
    // The original result endpoint reopens and verifies the retained envelope.
    if(await inspect(request.operation_id))
      message('The original control finished and its retained result is open. Reopening this operation never dispatches it again.');
  }catch(error){
    message(`${error.message} Keep the operation ID and use Inspect operation. No automatic retry was made.`);
    el('journalPanel').hidden=false;el('journalState').textContent='Response not confirmed';
    el('operationMessage').textContent='Read the existing journal and result before deciding whether to start another operation.';
  }finally{
    try{await refreshIndex();}catch{el('runsStatus').textContent='Retained list could not be refreshed. The selected operation ID remains available for direct inspection.';}
    busy=false;controls();
  }
});
el('load').addEventListener('click',()=>openOperation(el('operation').value.trim()));
el('operation').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void openOperation(el('operation').value.trim());}});
el('inspectCurrent').addEventListener('click',()=>{if(current)void openOperation(current);});
el('newOperation').addEventListener('click',()=>{
  if(busy)return;
  current=null;clearDisplay();saveSelection();showCurrent();renderIndex();
  message('Choose the task and control, then Run. Prior operation IDs and server files are retained; this action did not execute anything.');
});
el('copyOperation').addEventListener('click',async()=>{
  if(!current||busy)return;
  const identity=current;
  try{await navigator.clipboard.writeText(identity);message('Operation ID copied. Use it to reopen the retained operation.');}
  catch{el('operation').value=identity;el('operation').focus();el('operation').select();message('Select and copy the operation ID in the input field.');}
});
el('refreshRuns').addEventListener('click',async()=>{
  if(busy)return;busy=true;controls();
  try{await refreshIndex();}catch(error){el('runsStatus').textContent=error.message;}
  finally{busy=false;controls();}
});
el('downloadRun').addEventListener('click',()=>{
  if(busy||!verifiedRun||verifiedRun.operation_id!==current)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(verifiedRun,null,2)+'\n'],{type:'application/json'}));
  const link=node('a');link.href=url;link.download='evidenceforge-'+current+'.json';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  message('Downloaded the original retained run envelope. Its hashes do not authenticate provider claims or grant approval.');
});
readSelection();showCurrent();renderIndex();
const selected=recent.find(row=>row.operation_id===current);
if(selected?.task){el('task').value=selected.task;goal();}
if(selected?.control)el('control').value=selected.control;
async function boot(){
  busy=true;controls();
  try{await refreshIndex();}catch(error){el('runsStatus').textContent=error.message;}
  finally{busy=false;controls();}
  if(current)await openOperation(current); // Read-only resume: never call /api/run on reload.
}
void boot();
