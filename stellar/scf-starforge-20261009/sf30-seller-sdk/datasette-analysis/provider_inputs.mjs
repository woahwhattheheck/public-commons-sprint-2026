/** Actual browser-selected provider input files, retained by the original workflow host. */
const SCHEMA='stellar-forge.provider-input-browser.v1';
const CHUNK=8*1024*1024;
const KINDS=[
 ['provider-handover','Complete provider handover','The original ZIP exported by another operator.'],
 ['handover','Original handover (legacy kind)','A complete original provider handover using its retained input kind.'],
 ['contacts','Original contacts','The complete original contact input JSON for Odoo preparation.'],
 ['native-result','Returned import result','The actual result JSON from the original target import.'],
 ['native-delivery','Original native archive','The complete original source-workflow/Analysis ZIP.'],
 ['decisions','Original mapping decisions','The retained source review and mapping decisions.']
];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const size=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';
const pretty=x=>JSON.stringify(x,null,2);
const inputId=()=> 'received-'+crypto.randomUUID().replaceAll('-','');
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function button(text,fn){const e=el('button',text,'pw-secondary');e.type='button';e.addEventListener('click',fn);return e;}
function field(label,control,help){
 const e=el('label',label);control.id='pi-'+crypto.randomUUID();control.setAttribute('aria-label',label);e.htmlFor=control.id;e.append(control);
 if(help)e.append(el('span',help,'pw-field-help'));return e;
}
function save(name,blob){
 const a=el('a');a.href=URL.createObjectURL(blob);a.download=name.replace(/[\\/\u0000-\u001f]/g,'_');document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(a.href),30000);
}
function saveJSON(name,value){save(name,new Blob([pretty(value)+'\n'],{type:'application/json'}));}
function details(title,value){const d=el('details');d.append(el('summary',title),el('pre',pretty(value)));return d;}

/** Incremental SHA-256. Only the current 8 MiB file slice is held in browser memory. */
class SHA256 {
 constructor(){this.h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.buffer=new Uint8Array(64);this.used=0;this.length=0;this.w=new Uint32Array(64);}
 block(b,o){
  const w=this.w;for(let i=0;i<16;i++){const j=o+i*4;w[i]=(b[j]<<24)|(b[j+1]<<16)|(b[j+2]<<8)|b[j+3];}
  const r=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let i=16;i<64;i++){const a=w[i-15],z=w[i-2];w[i]=(w[i-16]+(r(a,7)^r(a,18)^(a>>>3))+w[i-7]+(r(z,17)^r(z,19)^(z>>>10)))>>>0;}
  let [a,c,d,e,f,g,h,j]=this.h;
  for(let i=0;i<64;i++){
   const t=(j+(r(f,6)^r(f,11)^r(f,25))+((f&g)^(~f&h))+SHA256.K[i]+w[i])>>>0;
   const u=((r(a,2)^r(a,13)^r(a,22))+((a&c)^(a&d)^(c&d)))>>>0;
   j=h;h=g;g=f;f=(e+t)>>>0;e=d;d=c;c=a;a=(t+u)>>>0;
  }
  [a,c,d,e,f,g,h,j].forEach((v,i)=>{this.h[i]=(this.h[i]+v)>>>0;});
 }
 update(value){
  const b=value instanceof Uint8Array?value:new Uint8Array(value);this.length+=b.length;let offset=0;
  if(this.used){const n=Math.min(64-this.used,b.length);this.buffer.set(b.subarray(0,n),this.used);this.used+=n;offset=n;if(this.used===64){this.block(this.buffer,0);this.used=0;}}
  while(offset+64<=b.length){this.block(b,offset);offset+=64;}
  if(offset<b.length){this.buffer.set(b.subarray(offset),0);this.used=b.length-offset;}return this;
 }
 digest(){
  const end=new Uint8Array(this.used<56?64:128);end.set(this.buffer.subarray(0,this.used));end[this.used]=0x80;
  const view=new DataView(end.buffer);view.setUint32(end.length-8,Math.floor(this.length/0x20000000));view.setUint32(end.length-4,(this.length*8)>>>0);
  for(let i=0;i<end.length;i+=64)this.block(end,i);
  return [...this.h].map(x=>x.toString(16).padStart(8,'0')).join('');
 }
}
SHA256.K=new Uint32Array([
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);

export function mountProviderInputs({root,request,workspaceId,onComplete=async()=>{},onUse=async()=>{},notify=()=>{}}){
 if(!(root instanceof HTMLElement)||typeof request!=='function'||!workspaceId)throw Error('Open the original provider workspace before receiving input files.');
 const storageKey='source-provider-inputs:'+location.origin+':'+workspaceId;
 const state={drafts:{},selected:null,file:null,rows:[],current:null,busy:false,paused:false,controller:null,closed:false,loading:false};
 const heading=el('div',null,'pw-heading'),h=el('div');
 h.append(el('h2','Original input files'),el('p','Select the complete file you received, retain it in this workspace, then use it in the original provider operation.','pw-muted'));
 const controls=el('div',null,'pw-file-actions'),newButton=button('New file',newFile),refreshButton=button('Refresh files',()=>refresh());
 controls.append(newButton,refreshButton);heading.append(h,controls);
 const notice=el('div',null,'pw-notice');notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
 const form=el('form',null,'pw-form'),grid=el('div',null,'pw-grid');
 const kind=el('select');kind.append(...KINDS.map(([value,title])=>{const o=el('option',title);o.value=value;return o;}));
 const title=el('input');title.maxLength=300;
 const pick=el('input');pick.type='file';pick.setAttribute('aria-label','Select original input file');
 const fingerprint=el('input');fingerprint.placeholder='Optional supplied 64-character SHA-256';fingerprint.pattern='[a-fA-F0-9]{64}';fingerprint.maxLength=64;fingerprint.autocomplete='off';fingerprint.spellcheck=false;
 grid.append(field('Input purpose',kind),field('Input title',title),field('Select original input file',pick,'Choose the whole original file. After reopening this page, reselect that same file to continue.'),
  field('Supplied original SHA-256',fingerprint,'If the sender supplied a SHA-256, enter it here. The browser also calculates the complete file identity before transferring.'));
 const fileInfo=el('p','','pw-muted'),identity=el('dl',null,'pw-identity');
 const actions=el('div',null,'pw-actions'),submit=el('button','Retain original file');submit.type='submit';
 const pause=button('Pause transfer',()=>{state.paused=true;state.controller?.abort();say('Pausing this original transfer. Its received bytes stay on the server.');});
 const readStatus=button('Read original status',()=>reconcile());
 const exportDraft=button('Download transfer draft',()=>downloadDraft());
 const importDraft=el('input');importDraft.type='file';importDraft.accept='.json,application/json';importDraft.className='pw-file-input';importDraft.setAttribute('aria-label','Import retained file transfer draft');
 const importButton=button('Import transfer draft',()=>importDraft.click());
 actions.append(submit,pause,readStatus,exportDraft,importButton,importDraft);
 const progress=el('progress');progress.max=1;progress.value=0;progress.setAttribute('aria-label','Original file transfer progress');
 const phase=el('p','','pw-muted');phase.setAttribute('role','status');phase.setAttribute('aria-live','polite');
 form.append(grid,fileInfo,identity,actions,progress,phase);
 const detail=el('div',null,'pi-detail'),list=el('div',null,'pi-list'),filter=el('input');filter.type='search';filter.placeholder='Title, purpose, filename or input ID';filter.setAttribute('aria-label','Find retained input files');
 root.classList.add('provider-inputs');root.replaceChildren(heading,notice,form,detail,field('Find retained input files',filter),list);
 function say(text,error=false){notice.hidden=false;notice.textContent=text;notice.dataset.error=String(error);notify(text,error);}
 function draft(){return state.drafts[state.selected]||null;}
 function persist(){
  const value={schema:SCHEMA,workspaceId,selected:state.selected,drafts:state.drafts};
  try{localStorage.setItem(storageKey,JSON.stringify(value));}
  catch{throw Error('The transfer draft could not be retained in this browser. Download its exact draft and restore browser storage before starting the transfer.');}
 }
 function restore(){
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved?.schema===SCHEMA&&saved.workspaceId===workspaceId&&plain(saved.drafts)){
   state.drafts=Object.fromEntries(Object.entries(saved.drafts).filter(([id,d])=>/^received-[a-f0-9]{32}$/.test(id)&&plain(d)&&d.inputId===id));
   state.selected=state.drafts[saved.selected]?saved.selected:null;
  }}catch{say('The browser draft could not be opened. Read the retained server list and select the original input to continue.',true);}
 }
 function newFile(){
  if(state.busy)return;
  const id=inputId();state.drafts[id]={inputId:id,kind:'provider-handover',title:'',fileName:'',bytes:null,expectedSha256:'',createdAt:new Date().toISOString(),intent:null};
  state.selected=id;state.current=null;state.file=null;pick.value='';try{persist();}catch(e){say(e.message,true);}renderForm();renderList();
 }
 function renderForm(){
  const d=draft();form.hidden=!d;if(!d)return;
  kind.value=d.kind;title.value=d.title||'';fingerprint.value=d.expectedSha256||'';
  const frozen=!!d.intent;kind.disabled=title.disabled=fingerprint.disabled=state.busy||frozen;pick.disabled=state.busy;
  fileInfo.textContent=d.fileName?d.fileName+' · '+size(d.bytes)+(state.file?' · selected in this browser':' · reselect to continue'):'Choose an actual original file.';
  identity.replaceChildren();
  for(const [label,value] of [['Input ID',d.inputId],['Retained intent',frozen?'Saved before first request':'Editable browser draft'],['File SHA-256',d.intent?.sha256||'Calculated before upload']]){
   identity.append(el('dt',label),el('dd',value));
  }
  const complete=state.current?.status==='COMPLETE';
  submit.textContent=complete?'File retained':frozen?'Continue original transfer':'Retain original file';
  submit.disabled=state.busy||complete||(!state.file&&!frozen);pause.disabled=!state.busy||!state.controller;readStatus.disabled=state.busy||!frozen;
  exportDraft.disabled=state.busy;importButton.disabled=state.busy;newButton.disabled=state.busy;refreshButton.disabled=state.busy;
  if(!state.busy){progress.value=complete?1:state.current?.bytes?state.current.receivedBytes/state.current.bytes:0;phase.textContent=complete?'Complete original file retained.':state.current?'Retained '+size(state.current.receivedBytes)+' of '+size(state.current.bytes)+'.':frozen?'Read original status or reselect the complete file.':'Select a file and its purpose to begin.';}
  renderDetail();
 }
 function updateDraft(){
  const d=draft();if(!d||d.intent||state.busy)return;
  d.kind=kind.value;d.title=title.value;d.expectedSha256=fingerprint.value.trim().toLowerCase();try{persist();}catch(e){say(e.message,true);}
 }
 for(const control of [kind,title,fingerprint])control.addEventListener('input',updateDraft);
 pick.addEventListener('change',()=>{
  const file=pick.files?.[0];if(!file)return;const d=draft();if(!d)return;
  if(d.intent&&(file.name!==d.intent.fileName||file.size!==d.intent.bytes)){state.file=null;pick.value='';say('Reselect the original '+d.intent.fileName+' with its exact '+d.intent.bytes+' bytes.',true);renderForm();return;}
  state.file=file;if(!d.intent){d.fileName=file.name;d.bytes=file.size;if(!d.title)d.title=file.name;}
  try{persist();}catch(e){say(e.message,true);}renderForm();
 });
 function validIntent(value){
  if(!plain(value)||!/^received-[a-f0-9]{32}$/.test(value.inputId)||!KINDS.some(([k])=>k===value.kind)||typeof value.fileName!=='string'||!value.fileName||/[\\/\u0000-\u001f\u007f]/.test(value.fileName)||new TextEncoder().encode(value.fileName).length>240||
   !Number.isSafeInteger(value.bytes)||value.bytes<0||typeof value.title!=='string'||!value.title||value.title.length>300||/[\u0000-\u001f\u007f]/.test(value.title)||
   (value.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(value.sha256)))throw Error('Select the exact original retained input intent.');
  return value;
 }
 function checkRecord(row,intent){
  if(!plain(row)||row.workspaceId!==workspaceId||row.inputId!==intent.inputId||row.id!==intent.inputId||row.kind!==intent.kind||row.fileName!==intent.fileName||row.bytes!==intent.bytes||row.title!==intent.title||
   (row.expectedSha256||null)!==(intent.sha256||null))throw Error('The server input differs from this original transfer intent. Keep both original records and select the correct input.');
  if(!['UPLOADING','COMPLETE'].includes(row.status)||!Number.isSafeInteger(row.receivedBytes)||row.receivedBytes<0||row.receivedBytes>row.bytes||
    row.chunkBytes!==CHUNK||!Array.isArray(row.chunks)||row.chunkCount!==row.chunks.length)throw Error('The original input status has an incomplete chunk inventory.');
  let offset=0;
  for(const chunk of row.chunks){
   if(chunk.offset!==offset||!Number.isSafeInteger(chunk.bytes)||chunk.bytes!==Math.min(CHUNK,row.bytes-offset)||!/^[a-f0-9]{64}$/.test(chunk.sha256))throw Error('The original received chunk order or identity changed.');
   offset+=chunk.bytes;
  }
  if(offset!==row.receivedBytes||(row.status==='COMPLETE'&&(offset!==row.bytes||!/^[a-f0-9]{64}$/.test(row.sha256)||row.available!==true)))throw Error('The complete original file has not been retained.');
  if(row.status==='COMPLETE'&&intent.sha256&&row.sha256!==intent.sha256)throw Error('The completed file differs from its selected original SHA-256.');
  return row;
 }
 const route=id=>'/api/providers/inputs/'+encodeURIComponent(id);
 async function responseJSON(path,options={}){
  const response=await request(path,options);let value;try{value=await response.json();}catch{throw Error('The operator returned an unreadable input response. Read the same original input before continuing.');}
  if(!response.ok){const e=Error(value.message||value.error||'The original input could not be read.');e.status=response.status;e.code=value.code||value.error;throw e;}return value;
 }
 function post(path,body,signal){return responseJSON(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})});}
 function retain(row){state.current=row;const d=draft();if(d){d.lastStatus=row.status;d.receivedBytes=row.receivedBytes;d.sha256=row.sha256||null;d.updatedAt=row.updatedAt;persist();}const i=state.rows.findIndex(x=>x.inputId===row.inputId);if(i<0)state.rows.unshift(row);else state.rows[i]=row;renderList();}
 function stop(){if(state.paused||state.closed)throw new DOMException('Paused original file transfer','AbortError');}
 function phaseAt(text,done,total){phase.textContent=text+' '+size(done)+' / '+size(total);progress.value=total?done/total:0;}
 async function fingerprintFile(file){
  const sum=new SHA256();for(let offset=0;offset<file.size;offset+=CHUNK){stop();const bytes=new Uint8Array(await file.slice(offset,Math.min(file.size,offset+CHUNK)).arrayBuffer());sum.update(bytes);phaseAt('Reading original file identity:',Math.min(file.size,offset+bytes.length),file.size);}
  stop();return sum.digest();
 }
 async function verifyPrefix(row,file){
  for(const chunk of row.chunks){stop();const raw=await file.slice(chunk.offset,chunk.offset+chunk.bytes).arrayBuffer();const actual=hex(await crypto.subtle.digest('SHA-256',raw));
   if(actual!==chunk.sha256)throw Error('The reselected file differs at retained offset '+chunk.offset+'. Select the original source file before continuing.');
   phaseAt('Checking retained file bytes:',chunk.offset+chunk.bytes,row.bytes);
  }
 }
 async function transfer(){
  if(state.busy||!draft())return;
  updateDraft();state.busy=true;state.paused=false;state.controller=new AbortController();renderForm();
  const d=draft();
  try{
   let intent=d.intent?validIntent(d.intent):null,row=null;
   if(intent)persist();
   if(intent){try{row=checkRecord(await responseJSON(route(intent.inputId)),intent);retain(row);}catch(e){if(e.status!==404)throw e;}}
   if(row?.status==='COMPLETE'){say('This complete original file is already retained.');await onComplete(row);return;}
   const file=state.file;
   if(!file||file.name!==d.fileName||file.size!==d.bytes)throw Error('Reselect the complete original file in this browser to continue.');
   if(!Number.isSafeInteger(file.size)||file.size<0)throw Error('Select the complete original file with its exact byte count.');
   const digest=await fingerprintFile(file);
   if(d.expectedSha256&&digest!==d.expectedSha256)throw Error('The selected file differs from the supplied original SHA-256.');
   if(intent?.sha256&&intent.sha256!==digest)throw Error('The reselected file differs from this retained transfer. Keep the original ID and select its original bytes.');
   if(!intent){intent={inputId:d.inputId,kind:d.kind,fileName:file.name,title:d.title.trim()||file.name,bytes:file.size,sha256:digest};validIntent(intent);d.intent=intent;d.title=intent.title;persist();}
   stop();
   if(!row){row=checkRecord(await post('/api/providers/inputs',intent,state.controller.signal),intent);retain(row);}
   if(row.status==='COMPLETE'){say('The exact original file is already complete.');await onComplete(row);return;}
   await verifyPrefix(row,file);
   while(row.receivedBytes<row.bytes){
    stop();const offset=row.receivedBytes,end=Math.min(row.bytes,offset+CHUNK),raw=await file.slice(offset,end).arrayBuffer();
    const chunkSha=hex(await crypto.subtle.digest('SHA-256',raw));
    const reply=await responseJSON(route(intent.inputId)+'/chunks',{method:'POST',
     headers:{'Content-Type':'application/octet-stream','X-Input-Offset':String(offset),'X-Content-SHA256':chunkSha},body:raw,signal:state.controller.signal});
    if(reply.chunk?.offset!==offset||reply.chunk?.bytes!==end-offset||reply.chunk?.sha256!==chunkSha||
      reply.receivedBytes!==end||reply.replayed!==false&&reply.replayed!==true)throw Error('Read the original input status before continuing this chunk.');
    const next=checkRecord({...reply,chunks:[...row.chunks,reply.chunk]},intent);
    row=next;retain(row);phaseAt('Retaining original file:',row.receivedBytes,row.bytes);
   }
   stop();phaseAt('Finishing original file:',row.bytes,row.bytes);
   row=checkRecord(await post(route(intent.inputId)+'/complete',{sha256:digest},state.controller.signal),intent);
   if(row.status!=='COMPLETE'||row.sha256!==digest)throw Error('The operator has not completed the exact selected file.');
   retain(row);await onComplete(row);say(file.name+' is retained in full and available to the original provider workflow.');
  }catch(e){
   const paused=e.name==='AbortError'||state.paused;
   say(paused?'Transfer paused. Read the original status and reselect the same file to continue.':e.message,true);
   if(d.intent){try{const row=checkRecord(await responseJSON(route(d.inputId)),d.intent);retain(row);if(row.status==='COMPLETE'){await onComplete(row);say('The server completed the exact original file. Its full source is available.');}}catch{}}
  }finally{state.busy=false;state.controller=null;state.paused=false;renderForm();}
 }
 form.addEventListener('submit',event=>{event.preventDefault();transfer();});
 async function reconcile(){
  const d=draft();if(state.busy||!d?.intent)return;state.busy=true;renderForm();
  try{const row=checkRecord(await responseJSON(route(d.inputId)),validIntent(d.intent));retain(row);if(row.status==='COMPLETE')await onComplete(row);say(row.status==='COMPLETE'?'Complete original file reopened.':'Original received bytes reopened. Reselect its source file to continue.');}
  catch(e){say(e.message,true);}finally{state.busy=false;renderForm();}
 }
 function draftFromRecord(row){
  const intent={inputId:row.inputId,kind:row.kind,fileName:row.fileName,title:row.title,bytes:row.bytes,...(row.expectedSha256?{sha256:row.expectedSha256}:{})};
  validIntent(intent);return {inputId:row.inputId,kind:row.kind,fileName:row.fileName,title:row.title,bytes:row.bytes,expectedSha256:row.expectedSha256||'',intent,createdAt:row.createdAt};
 }
 async function select(id){
  if(state.busy)return;
  try{const row=await responseJSON(route(id));const d=state.drafts[id]||draftFromRecord(row);checkRecord(row,d.intent||draftFromRecord(row).intent);
   state.drafts[id]=d;if(!d.intent)d.intent=draftFromRecord(row).intent;state.selected=id;state.file=null;pick.value='';retain(row);renderForm();form.scrollIntoView({block:'nearest',behavior:'auto'});
  }catch(e){say(e.message,true);}
 }
 function downloadDraft(){const d=draft();if(d)saveJSON('Provider_Input_'+d.inputId+'.json',{schema:SCHEMA,workspaceId,draft:d});}
 importDraft.addEventListener('change',async()=>{
  const file=importDraft.files?.[0];if(!file||state.busy)return;
  try{const saved=JSON.parse(await file.text());if(saved.schema!==SCHEMA||saved.workspaceId!==workspaceId||!plain(saved.draft))throw Error('Select the original transfer draft for this workspace.');
   const d=saved.draft;if(!/^received-[a-f0-9]{32}$/.test(d.inputId))throw Error('Retain the original input ID.');if(d.intent){validIntent(d.intent);if(d.intent.inputId!==d.inputId||d.kind!==d.intent.kind||d.fileName!==d.intent.fileName||d.bytes!==d.intent.bytes||d.title.trim()!==d.intent.title)throw Error('The saved draft differs from its retained original intent.');}
   else if(!KINDS.some(([k])=>k===d.kind)||typeof d.title!=='string'||typeof d.fileName!=='string'||d.bytes!==null&&!Number.isSafeInteger(d.bytes))throw Error('Select a complete original transfer draft.');
   if(state.drafts[d.inputId]?.intent&&JSON.stringify(state.drafts[d.inputId].intent)!==JSON.stringify(d.intent))throw Error('This draft changes an existing original input intent.');
   state.drafts[d.inputId]=d;state.selected=d.inputId;state.current=null;state.file=null;pick.value='';persist();renderForm();if(d.intent)await reconcile();say('Original transfer draft restored. Select its actual file to continue.');
  }catch(e){say(e.message,true);}finally{importDraft.value='';}
 });
 function renderList(){
  list.replaceChildren();const q=filter.value.trim().toLowerCase();
  const rows=state.rows.filter(row=>!q||[row.title,row.kind,row.fileName,row.inputId].join(' ').toLowerCase().includes(q));
  list.append(el('p',rows.length+' shown · '+state.rows.length+' retained input transfers','pw-muted'));
  if(!rows.length){list.append(el('p','Actual uploaded files appear here, including interrupted transfers.','pw-muted'));return;}
  const table=el('table',null,'pw-table'),head=table.createTHead().insertRow(),body=table.createTBody();for(const title of ['Original file','Purpose','Received','State',''])head.append(el('th',title));
  for(const row of rows){const tr=body.insertRow(),name=el('div');name.append(el('strong',row.title||row.fileName),el('span',row.fileName,'pi-file-name'),el('code',row.inputId));
   const controls=el('div',null,'pw-file-actions'),open=button('Open',()=>select(row.inputId));open.disabled=state.busy;controls.append(open);
   if(row.status==='COMPLETE'&&row.available){const useButton=button('Use in operation',()=>use(row));useButton.disabled=state.busy;controls.append(useButton);}
   for(const value of [name,KINDS.find(([k])=>k===row.kind)?.[1]||row.kind,size(row.receivedBytes)+' / '+size(row.bytes),row.status==='COMPLETE'?'Complete':'Continue required',controls]){
    const td=tr.insertCell();if(value instanceof Node)td.append(value);else td.textContent=value;
   }
  }
  const wrap=el('div',null,'pw-table-wrap');wrap.append(table);list.append(wrap);
 }
 filter.addEventListener('input',renderList);
 function renderDetail(){
  detail.replaceChildren();const row=state.current;if(!row)return;
  const panel=el('section',null,'pw-panel');panel.append(el('h3',row.status==='COMPLETE'?'Complete original file':'Retained transfer'));
  const values=el('dl',null,'pw-identity');for(const [name,value] of [['Input ID',row.inputId],['Original filename',row.fileName],['Purpose',row.kind],['Retained bytes',size(row.receivedBytes)+' / '+size(row.bytes)],['SHA-256',row.sha256||row.expectedSha256||'Calculated at completion']])values.append(el('dt',name),el('dd',value));
  panel.append(values);
  const buttons=el('div',null,'pw-actions');
  if(row.status==='COMPLETE'&&row.available){const useButton=button('Use this file in an operation',()=>use(row)),downloadButton=button('Download complete original file',()=>download(row));useButton.disabled=downloadButton.disabled=state.busy;buttons.append(useButton,downloadButton);}
  buttons.append(button('Download input receipt',()=>saveJSON('Provider_Input_Receipt_'+row.inputId+'.json',row)));
  panel.append(buttons,details('Original input and chunk identities',row));detail.append(panel);
 }
 async function use(row){try{if(state.busy)return;await onUse(row);}catch(e){say(e.message,true);}}
 async function download(row){
  if(state.busy)return;state.busy=true;renderForm();
  let writer=null;
  try{
   if(typeof window.showSaveFilePicker==='function'){const handle=await window.showSaveFilePicker({suggestedName:row.fileName});writer=await handle.createWritable();}
   const response=await request(route(row.inputId)+'/file',{method:'GET'});
   if(!response.ok){let body;try{body=await response.json();}catch{}throw Error(body?.message||body?.error||'The complete original input could not be downloaded.');}
   const header=response.headers.get('X-Content-SHA256');if(header&&header!==row.sha256)throw Error('The original file header has a different content identity.');
   const hasher=new SHA256();let received=0;
   const monitored=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
    received+=chunk.length;if(received>row.bytes)throw Error('The original file transfer exceeds its retained size.');
    hasher.update(chunk);phaseAt('Downloading original file:',received,row.bytes);controller.enqueue(chunk);
   }}));
   let blob;
   if(writer){const reader=monitored.getReader();try{while(true){const part=await reader.read();if(part.done)break;await writer.write(part.value);}}finally{reader.releaseLock();}}
   else blob=await new Response(monitored,{headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream'}}).blob();
   if(received!==row.bytes||hasher.digest()!==row.sha256)throw Error('The download differs from the complete original input. Reopen that same input and retry.');
   if(writer){await writer.close();writer=null;}else save(row.fileName,blob);
   say(row.fileName+' downloaded in full with its original SHA-256.');
  }catch(e){if(writer)await writer.abort().catch(()=>{});if(e.name!=='AbortError')say(e.message,true);}
  finally{state.busy=false;renderForm();}
 }
 async function refresh(){
  if(state.loading||state.closed)return;state.loading=true;
  try{const value=await responseJSON('/api/providers/inputs');if(value.workspaceId!==workspaceId||value.chunkBytes!==CHUNK||!Array.isArray(value.inputs))throw Error('The original input list is incomplete.');
   state.rows=value.inputs;renderList();if(state.selected&&!state.busy&&draft()?.intent){try{const row=checkRecord(await responseJSON(route(state.selected)),draft().intent);retain(row);renderForm();}catch(e){if(e.status!==404)throw e;say('The original intent is retained in this browser. Reselect its file and continue with that same input ID.');}}
  }catch(e){say(e.message,true);}finally{state.loading=false;}
 }
 async function start(){restore();if(state.selected)renderForm();else newFile();await refresh();}
 return {start,refresh,select,show(){root.hidden=false;root.scrollIntoView({block:'start',behavior:'auto'});},destroy(){state.closed=true;state.paused=true;state.controller?.abort();}};
}
