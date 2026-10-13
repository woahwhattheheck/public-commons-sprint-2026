// Uses the original operator origin and job queue. All external strings use text nodes.
const base = location.pathname.replace(/\/$/, '');
const $ = id => document.getElementById(id);
let current = null;
let shown = null;
let poll = null;
let busy = false;
const parameters = new URLSearchParams(location.search);
const fragment = new URLSearchParams(location.hash.slice(1));
const storage = (()=>{try{return sessionStorage;}catch{return {getItem:()=>null,setItem:()=>{},removeItem:()=>{}};}})();
const capability = fragment.get('token') || storage.getItem('upstate-operator-capability');
const workspace = parameters.get('workspace') || storage.getItem('upstate-selected-workspace');
if(fragment.get('token')){storage.setItem('upstate-operator-capability',capability);history.replaceState(null,'',location.pathname+location.search);}
let jobId = null;
const pending = new Map();
function operationId(kind){
  const key='upstate-refresh-operation:'+String(workspace)+':'+String(current)+':'+kind;
  let id=storage.getItem(key)||pending.get(key);
  if(!id){id=crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');storage.setItem(key,id);pending.set(key,id);}
  return {id,clear:()=>{storage.removeItem(key);pending.delete(key);}};
}
function headers(json=false){return {'Accept':'application/json',...(capability?{Authorization:'Bearer '+capability}:{}),...(json?{'Content-Type':'application/json'}:{})};}
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',...options});
  if(!response.ok){let value;try{value=await response.json();}catch{}throw Error(value?.error?.message||value?.error||`HTTP ${response.status}`);}
  return response;
}
async function native(path,payload){const post=payload!==undefined;return (await request(path,{method:post?'POST':'GET',headers:headers(post),...(post?{body:JSON.stringify(payload)}:{})})).json();}

function element(tag, text, parent) { const e=document.createElement(tag); if(text!==undefined)e.textContent=String(text); if(parent)parent.append(e); return e; }
function notice(message){ $('notice').textContent=message; }
function object(id, optional=false){ const raw=$(id).value.trim(); if(!raw&&optional)return undefined; const value=JSON.parse(raw||'{}'); if(value===null||Array.isArray(value)||typeof value!=='object')throw Error(`${id} must be a JSON object`); return value; }
async function api(action, payload, method='POST'){
  let url=base+'/api/'+action;
  const value={...(workspace?{workspace}:{}),...(payload||{})};
  const options={method,headers:headers(method!=='GET')};
  if(method==='GET')url+='?'+new URLSearchParams(value).toString();
  else options.body=JSON.stringify(value);
  return (await request(url,options)).json();
}
async function report(format){
  const url=base+'/api/report?'+new URLSearchParams({...(workspace?{workspace}:{}),plan_id:current,format});
  const response=await request(url,{headers:headers()});
  const objectURL=URL.createObjectURL(await response.blob());
  const link=element('a');link.href=objectURL;link.download=`source-refresh-${current.slice(0,16)}.${format}`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),30000);
}
async function jobState(){
  if(!jobId)return;
  const job=await native('/api/task?id='+encodeURIComponent(jobId));
  if(['failed','interrupted','cancelled'].includes(job.state)){
    $('resume-job').hidden=false;notice(`Original task ${job.state}: ${job.error?.message||'Resume the retained selection.'}`);
  }else if(job.state==='complete'){
    $('resume-job').hidden=true;
    if(job.action==='workspace.backup'){
      $('downloads').replaceChildren();
      for(const file of job._downloads||[]){const a=element('a','Download complete editable workspace',$('downloads'));a.href='/api/file/'+encodeURIComponent(file.id)+'?download=1';}
      notice('Complete workspace backup is ready through the original download service.');
    }
  }else schedulePoll();
  return job;
}

function table(target, headings, rows){target.replaceChildren(); const wrap=element('div',undefined,target);wrap.className='table-wrap';const t=element('table',undefined,wrap);const head=element('tr',undefined,element('thead',undefined,t));headings.forEach(x=>element('th',x,head));const body=element('tbody',undefined,t);rows.forEach(row=>{const tr=element('tr',undefined,body);row.forEach((value,i)=>{const cell=element('td',value??'—',tr);cell.dataset.label=headings[i];});});return t;}
function payload(){if(!$('previous').value||!$('replacement').value)throw Error('Choose both source editions.');return {from_collection_id:$('previous').value,to_collection_id:$('replacement').value,mapping:object('mapping'),roots:object('roots',true),title:$('title').value};}
function displayDiff(diff){table($('changes'),['Previous source','Replacement','Change','Reason'],diff.changes.map(r=>[r.source_id,r.replacement_id,r.change,r.reason]));}
function displayState(state){
  const option=Array.from($('saved').options).find(o=>o.value===current);if(option?.dataset.title)option.textContent=`${option.dataset.title} · ${state.status} · ${current.slice(0,12)}`;
  if(state.status==='complete')notice('Refresh complete. New selections are listed below; original results remain available.');
  else if(state.status==='prepared')notice('Changed selections are prepared. Run them to compute new results, or reopen this plan later.');
  const target=$('progress');target.replaceChildren();element('p',`Status: ${state.status}`,target).className='status';
  if(state.error)element('p',`${state.error.type}: ${state.error.message}`,target);
  const pane=element('div',undefined,target);
  table(pane,['Selection','Action','Refresh step','Native run state','Result ID'],Object.entries(state.steps||{}).map(([key,s])=>[key,s.action,s.status,s.native_state || '—',s.new_id]));
  element('p','Refresh completion describes the source replacement operation. Native run state shows whether each model has completed; unchanged runs retain their original source bindings.',target);
  if(state.status==='running')schedulePoll();
}
function displayPlan(value){
  if(!Array.isArray(value.plan.nodes) && value.plan.selection && value.plan.preview){
    location.assign('/web/source-refresh.html?'+new URLSearchParams({...(workspace?{workspace}:{}),plan_id:value.plan.id}));
    return;
  }
  if(shown!==value.plan.id){
    shown=value.plan.id;$('previous').value=value.plan.from_collection_id;$('replacement').value=value.plan.to_collection_id;$('title').value=value.plan.title;
    $('mapping').value=JSON.stringify(value.plan.mapping,null,2);$('downloads').replaceChildren();
  }
  current=value.plan.id;$('saved').value=current;history.replaceState(null,'',base+'?'+new URLSearchParams({...(workspace?{workspace}:{}),plan_id:current}));
  table($('plan'),['Kind','Action','Original selection','Reason'],value.plan.nodes.map(n=>[n.kind,n.action,n.old_id,n.reasons.join('; ')]));
  const unresolved=value.plan.nodes.some(n=>n.action==='missing');
  $('prepare').disabled=unresolved;$('execute').disabled=unresolved;$('reload').disabled=false;
  $('export').disabled=false;$('reports').replaceChildren();['html','csv','json'].forEach(format=>{const a=element('a',`${format.toUpperCase()} refresh report`,$('reports'));a.href='#report-'+format;a.addEventListener('click',event=>{event.preventDefault();guard(()=>report(format));});});
  displayDiff({changes:value.plan.changes});displayState(value.state);
}
async function catalog(){
  const data=await api('catalog',{},'GET');
  for(const id of ['previous','replacement']){const selected=$(id).value;$(id).replaceChildren();element('option','Choose a retained source edition',$(id)).value='';data.sources.forEach(s=>{const o=element('option',`${s.title} · ${s.id.slice(0,12)} · ${s.entries} files`,$(id));o.value=s.id;});if(selected)$(id).value=selected;}
  const selected=current||$('saved').value;$('saved').replaceChildren();element('option','Select a saved refresh',$('saved')).value='';
  data.plans.forEach(p=>{const o=element('option',`${p.title} · ${p.status} · ${p.id.slice(0,12)}`,$('saved'));o.value=p.id;o.dataset.title=p.title;});if(selected)$('saved').value=selected;
}
async function reload(){if(!current)return;displayPlan(await api('show',{plan_id:current},'GET'));await jobState();}
function schedulePoll(){clearTimeout(poll);poll=setTimeout(()=>guard(reload),2000);}
async function guard(action){if(busy)return;busy=true;try{await action();}catch(error){notice(error.message);}finally{busy=false;}}
$('selection').addEventListener('submit',event=>{event.preventDefault();guard(async()=>{notice('Comparing retained originals…');displayDiff(await api('diff',payload()));notice('Comparison complete. Review changes, then save the rebuild plan.');});});
$('create').addEventListener('click',()=>guard(async()=>{notice('Saving the dependency plan…');const plan=await api('plan',payload());current=plan.id;jobId=storage.getItem('upstate-refresh-job:'+String(workspace)+':'+current);await catalog();await reload();notice('Saved. Review exactly which selections are reused or derived.');}));
$('saved').addEventListener('change',()=>guard(async()=>{clearTimeout(poll);current=$('saved').value;jobId=current?storage.getItem('upstate-refresh-job:'+String(workspace)+':'+current):null;if(current){await reload();notice('Reopened the saved refresh.');}}));
$('reload').addEventListener('click',()=>guard(reload));
for(const [id,execute] of [['prepare',false],['execute',true]])$(id).addEventListener('click',()=>guard(async()=>{const operation=operationId('apply:'+execute);const job=await api('apply',{plan_id:current,execute_runs:execute,operation_id:operation.id});operation.clear();jobId=job.id;storage.setItem('upstate-refresh-job:'+String(workspace)+':'+current,jobId);notice(`Submitted to the original operator job queue${job.id?' · '+job.id:''}. Progress remains saved in this workspace.`);await reload();schedulePoll();}));
$('resume-job').addEventListener('click',()=>guard(async()=>{await native('/api/task/resume',{id:jobId});notice('Resumed the same original task.');schedulePoll();}));
$('export').addEventListener('click',()=>guard(async()=>{
  await native('/api/session',{});
  const operation=operationId('export');const job=await api('export',{plan_id:current,operation_id:operation.id});operation.clear();jobId=job.id;
  storage.setItem('upstate-refresh-job:'+String(workspace)+':'+current,jobId);notice('Complete backup submitted to the original operator.');await jobState();
}));
window.addEventListener('pagehide',()=>clearTimeout(poll));
await guard(async()=>{await catalog();const key=new URLSearchParams(location.search).get('plan_id');if(key){current=key;jobId=storage.getItem('upstate-refresh-job:'+String(workspace)+':'+key);await reload();}});
