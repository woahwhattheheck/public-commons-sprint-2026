const $=id=>document.getElementById(id);
const token=location.hash.slice(1)||sessionStorage.getItem('sf-analysis-capability')||'';
if(token)sessionStorage.setItem('sf-analysis-capability',token);
history.replaceState(null,'',location.pathname);
const state={workspace:null,selected:null,busy:false,before:null,pages:[],next:null,poll:null,generation:0,pending:null};
const apiRoot='/api/worldbank-intake';
const id=()=>crypto.randomUUID().replaceAll('-','');
const pretty=value=>JSON.stringify(value,null,2);
const bytes=n=>new Intl.NumberFormat().format(n)+' bytes';
const key=()=> 'worldbank-intake:'+state.workspace;
const hex=buffer=>Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async body=>hex(await crypto.subtle.digest('SHA-256',body));
const encode=body=>{let text='';for(let i=0;i<body.length;i+=8192)text+=String.fromCharCode(...body.subarray(i,i+8192));return btoa(text);};
const message=text=>{$('message').textContent=text;};
function pending(value){state.pending=value;if(value)localStorage.setItem(key(),JSON.stringify(value));else localStorage.removeItem(key());}
function node(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;}
async function api(path,body){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Analysis-Capability':token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 let value;try{value=await response.json();}catch{throw Error('The original workspace did not return a complete response. Refresh status before continuing the same intake.');}
 if(!response.ok)throw Error(value.error||value.message||'Original workspace request failed ('+response.status+').');
 return value;
}
function controls(){
 const v=state.selected;
 $('upload').disabled=state.busy;
 $('new-intake').disabled=state.busy;
 $('continue').disabled=state.busy||!v||!['UPLOADED','ERROR','INTERRUPTED'].includes(v.status)||v.needs_original_file;
 $('original').disabled=state.busy||v?.status!=='REGISTERED';
 $('use-source').disabled=state.busy||v?.status!=='REGISTERED';
 $('refresh').disabled=state.busy||!v;
 $('newer').disabled=state.busy||!state.pages.length;
 $('older').disabled=state.busy||state.next===null;
}
async function act(fn){if(state.busy)return;state.busy=true;controls();message('');try{await fn();}catch(error){message(error.message);}finally{state.busy=false;controls();}}
function sourceSummary(v){
 $('source-summary').replaceChildren();const result=v.result;
 if(!result){$('source-summary').textContent=v.progress?.phase||'The original source registration will appear here after validation.';return;}
 const p=node('p',new Intl.NumberFormat().format(result.observations)+' approved observations. Source '+result.source.name+', revision '+result.source.revision+'.');
 $('source-summary').append(p);const selection=result.source_metadata?.selection;
 if(selection)$('source-summary').append(node('p','Selection: '+pretty(selection)));
 $('source-metadata').textContent=pretty(result.source_metadata);
 $('original-review').textContent=pretty(result.original_review);
}
function render(v){
 state.selected=v;$('selected').hidden=false;$('selection-empty').hidden=true;
 const rows=[['Original file',v.intent.filename],['Intake',v.id],['Status',v.status],['Full handover',bytes(v.intent.bytes)],['SHA-256',v.intent.sha256],['Retained upload',bytes(v.received_bytes)],['Available in this installation',bytes(v.available_bytes??v.received_bytes)]];
 if(v.result){rows.push(['Registered source',v.result.source.name],['Source revision',v.result.source.revision],['Original document',v.result.source.document_id]);}
 $('identity').replaceChildren(...rows.flatMap(([a,b])=>[node('dt',a),node('dd',b)]));
 $('selected-error').textContent=v.error||'';
 $('attempts').textContent=pretty(v.attempts);
 $('source-metadata').textContent='';$('original-review').textContent='';sourceSummary(v);
 if(v.needs_original_file&&v.received_bytes>0)$('upload-phase').textContent='Select the same original file to continue this intake from the available upload.';
 if(v.status==='REGISTERED'&&state.pending?.id===v.id)pending(null);
 controls();
 clearTimeout(state.poll);
 if(v.status==='REGISTERING')state.poll=setTimeout(()=>refreshSelected().catch(e=>message(e.message)),1200);
}
async function refreshSelected(){
 if(!state.selected)return;
 const selectedId=state.selected.id,g=state.generation;
 const current=await api(apiRoot+'/'+selectedId);
 if(g===state.generation&&state.selected?.id===selectedId)render(current);
}
async function choose(intakeId){state.generation++;render(await api(apiRoot+'/'+intakeId));}
async function historyPage(before=null,pages=[]){
 const result=await api(apiRoot+(before===null?'':'?before='+before));
 if(state.workspace===null){
  state.workspace=result.workspace_id;$('workspace').textContent='Customer workspace: '+state.workspace;
  const saved=localStorage.getItem(key());
  if(saved){const p=JSON.parse(saved);if(!p||!/^[a-f0-9]{32}$/.test(p.id)||!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('The retained intake reminder is invalid. Preserve browser storage before repairing it.');state.pending=p;}
 }else if(state.workspace!==result.workspace_id)throw Error('The original customer workspace changed.');
 state.before=before;state.pages=pages;state.next=result.next_before;
 $('history').replaceChildren(...result.intakes.map(v=>{
  const tr=node('tr'),button=node('button','Open');button.type='button';button.addEventListener('click',()=>act(()=>choose(v.id)));
  for(const value of [v.intent.filename,v.status,bytes(v.received_bytes)+' / '+bytes(v.intent.bytes),v.result?v.result.source.name+' / '+v.result.source.revision:'—'])tr.append(node('td',value));
  const cell=node('td');cell.append(button);tr.append(cell);return tr;
 }));
 controls();return result;
}
async function upload(){
 const file=$('handover').files[0];if(!file)throw Error('Choose the approved original handover ZIP.');
 if(file.size===0||file.size>32*1024*1024)throw Error('Choose a complete handover between 1 byte and 32 MiB, matching the original source importer.');
 $('upload-phase').textContent='Reading the complete original handover…';
 const data=new Uint8Array(await file.arrayBuffer()),digest=await hash(data);
 const existing=state.selected?.status!=='REGISTERED'?state.selected:null;
 let request;
 if(existing){if(existing.intent.sha256!==digest||existing.intent.bytes!==data.length)throw Error('This file differs from the selected intake. Use Start another intake for a different approved handover.');request={id:existing.id,...existing.intent};}
 else if(state.pending){if(state.pending.sha256!==digest||state.pending.bytes!==data.length)throw Error('A different original upload is pending. Continue it, or choose Start another intake explicitly.');request=state.pending;}
 else request={id:id(),filename:file.name,bytes:data.length,sha256:digest};
 // Retain intent before the first network mutation; a lost response uses this ID.
 pending(request);
 let current=await api(apiRoot,request);render(current);
 if(current.status==='REGISTERED'){message('This exact handover is already registered.');return;}
 if(current.status==='REGISTERING'){message('The original registration is already running.');return;}
 $('upload-progress').hidden=false;
 let offset=current.available_bytes??0;
 while(offset<data.length){
  const chunk=data.subarray(offset,Math.min(offset+current.chunk_bytes,data.length));
  $('upload-phase').textContent='Receiving original bytes: '+bytes(offset)+' of '+bytes(data.length);
  await api(apiRoot+'/'+request.id+'/chunks',{offset,sha256:await hash(chunk),content:encode(chunk)});
  offset+=chunk.length;$('upload-progress').value=offset/data.length*100;
 }
 $('upload-phase').textContent='Original bytes retained. Validating and registering the complete approved source…';
 current=await api(apiRoot+'/'+request.id+'/register',{resume:true});
 render(await api(apiRoot+'/'+request.id));await historyPage();
}
async function download(){
 const v=state.selected;
 const response=await fetch(apiRoot+'/'+v.id+'/original',{headers:{'X-Analysis-Capability':token},cache:'no-store'});
 if(!response.ok){let e=await response.json();throw Error(e.error||'Original handover unavailable.');}
 const body=await response.arrayBuffer();
 if(body.byteLength!==v.intent.bytes||await hash(body)!==v.intent.sha256)throw Error('The original handover download did not match its retained identity.');
 const url=URL.createObjectURL(new Blob([body],{type:'application/zip'})),a=node('a');a.href=url;a.download='WorldBank_Approved_Handover.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('workspace-link').href='/#'+token;
$('upload-form').addEventListener('submit',e=>{e.preventDefault();act(upload);});
$('handover').addEventListener('change',()=>{$('file-summary').textContent=$('handover').files[0]?$('handover').files[0].name+' · '+bytes($('handover').files[0].size):'';});
$('new-intake').addEventListener('click',()=>act(async()=>{clearTimeout(state.poll);state.generation++;state.selected=null;pending(null);$('selected').hidden=true;$('selection-empty').hidden=false;$('handover').value='';$('file-summary').textContent='';$('upload-phase').textContent='';$('upload-progress').hidden=true;message('Choose the next approved handover. Earlier intake history remains available.');}));
$('refresh').addEventListener('click',()=>act(refreshSelected));
$('continue').addEventListener('click',()=>act(async()=>{await api(apiRoot+'/'+state.selected.id+'/register',{resume:true});await refreshSelected();await historyPage(state.before,state.pages);}));
$('original').addEventListener('click',()=>act(download));
$('refresh-history').addEventListener('click',()=>act(()=>historyPage()));
$('newer').addEventListener('click',()=>act(()=>historyPage(state.pages.at(-1),state.pages.slice(0,-1))));
$('older').addEventListener('click',()=>act(()=>historyPage(state.next,[...state.pages,state.before])));
$('use-source').addEventListener('click',()=>act(async()=>{
 const source=state.selected.result.source;
 sessionStorage.setItem('worldbank-intake-selection:'+state.workspace,JSON.stringify({name:source.name,revision:source.revision,intake_id:state.selected.id}));
 location.href='/#'+token;
}));
window.addEventListener('pagehide',()=>clearTimeout(state.poll));
await act(async()=>{if(!token)throw Error('Open source intake from the original private Analysis application.');await historyPage();if(state.pending)await choose(state.pending.id);});
