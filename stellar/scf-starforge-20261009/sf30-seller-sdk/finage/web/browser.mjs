// Finage operator over the original Python workspace server and retained source.
import {createDraftStore} from '/local-draft-store.mjs';
const $=s=>document.querySelector(s),clone=v=>structuredClone(v),json=v=>JSON.stringify(v,null,2),enc=new TextEncoder();
const SCHEMA='tj.finage-market-workspace.v1';
const RESULTS=new Set(['tj.finage-market-inspection.v1','tj.finage-market-build.v1','tj.finage-customer-market.v1']);
const FUNCTIONS=new Set(['inspect_market','build_market','customer_market']);
const TABS=[['overview','Overview'],['sources','Sources'],['inspection','Inspection'],['comparison','Market comparison'],['decisions','Decisions'],['mapping','Customer columns'],['delivery','Delivery'],['history','History']];
const VIEWS=[['records','Records'],['symbols','Symbols'],['events','Capture events'],['findings','Findings'],['changes','Changes'],['sources','Sources']];
const DEFAULT_COLUMNS=[{"name":"record_id","path":"/id"},{"name":"source_id","path":"/sourceId"},{"name":"source_sha256","path":"/sourceSha256"},{"name":"source_kind","path":"/sourceKind"},{"name":"record_kind","path":"/kind"},{"name":"symbol","path":"/symbol"},{"name":"customer_symbol","path":"/customerSymbol"},{"name":"event_time","path":"/time/value"},{"name":"event_time_kind","path":"/time/raw/kind"},{"name":"event_time_unit","path":"/time/unit"},{"name":"event_time_unix_ns","path":"/time/unixNs"},{"name":"event_time_utc","path":"/time/utc"},{"name":"price","path":"/values/price"},{"name":"bid","path":"/values/bid"},{"name":"ask","path":"/values/ask"},{"name":"size","path":"/values/size"},{"name":"bid_size","path":"/values/bidSize"},{"name":"ask_size","path":"/values/askSize"},{"name":"open","path":"/values/open"},{"name":"high","path":"/values/high"},{"name":"low","path":"/values/low"},{"name":"close","path":"/values/close"},{"name":"volume","path":"/values/volume"},{"name":"capture_order","path":"/localOrdinal"},{"name":"captured_at","path":"/capturedAt"}];
const fmt=v=>v===null||v===undefined||v===''?'—':typeof v==='object'?JSON.stringify(v):String(v);
const short=v=>v?String(v).slice(0,14):'—', bytes=v=>Number.isFinite(Number(v))?Number(v).toLocaleString()+' B':'—';
const count=v=>Number.isFinite(Number(v))?Number(v).toLocaleString():'—';
const terminal=status=>!['QUEUED','RUNNING'].includes(status),same=(a,b)=>canonical(a)===canonical(b);
function el(tag,attrs={},...children){
  const n=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs)){if(v===null||v===undefined||v===false)continue;
    if(k.startsWith('on')&&typeof v==='function')n.addEventListener(k.slice(2),v);
    else if(k==='class')n.className=v;
    else if(['value','checked','disabled','selected','readOnly'].includes(k))n[k]=v;
    else n.setAttribute(k,v===true?'':String(v));
  }
  for(const c of children.flat(Infinity))if(c!==null&&c!==undefined&&c!==false)n.append(c instanceof Node?c:document.createTextNode(String(c)));
  return n;
}
const txt=(tag,v,attrs={})=>el(tag,attrs,v),small=v=>txt('small',v),mono=v=>txt('code',fmt(v));
const row=(...c)=>el('div',{class:'button-row'},c),card=(...c)=>el('section',{class:'card'},c);
const badge=(v,strong=false)=>txt('span',v,{class:'badge'+(strong?' strong':'')});
const empty=v=>txt('p',v,{class:'empty'});
const detail=(title,value)=>el('details',{},txt('summary',title),el('div',{class:'details-body'},txt('pre',typeof value==='string'?value:json(value))));
function field(label,control,hint,full=false){control.id||='f-'+crypto.randomUUID();return el('div',{class:'field'+(full?' full':'')},txt('label',label,{for:control.id}),control,hint?small(hint):null);}
const input=(v,attrs={})=>el('input',{type:'text',value:v??'',...attrs}),area=(v,attrs={})=>el('textarea',{class:'code',value:v??'',spellcheck:'false',...attrs});
function select(options,value,attrs={}){return el('select',attrs,options.map(o=>{const p=Array.isArray(o)?o:[o,o];return el('option',{value:p[0],selected:p[0]===value},p[1]);}));}
function button(label,fn,{primary=false,disabled=false,id=null,read=false}={}){return el('button',{type:'button',class:primary?'primary':'',id,disabled:disabled||busy||(!read&&Boolean(pending)),onclick:()=>run(fn)},label);}
function table(headers,rows,id=null){return el('div',{class:'table-wrap',id},el('table',{},el('thead',{},el('tr',{},headers.map(h=>txt('th',h,{scope:'col'})))),el('tbody',{},rows.map(cells=>el('tr',{},cells.map(c=>el('td',{},c)))))));}
function heading(title,description,...actions){return el('div',{class:'section-head'},el('div',{},txt('h2',title),txt('p',description)),row(actions));}
const dl=items=>el('dl',{},items.flatMap(([k,v])=>[txt('dt',k),el('dd',{},v)]));
function link(url,label){try{const u=new URL(url);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)return el('a',{href:u.href,target:'_blank',rel:'noreferrer'},label||url);}catch{}return txt('span',label||fmt(url));}
function canonical(v){if(v===undefined)return 'undefined';if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
const shell=v=>"'"+String(v).replaceAll("'","'\\''")+"'";
const tokenKey='python-merchant-workspace:'+location.origin+':token';
function hashToken(){const h=location.hash.slice(1);return /^[a-f0-9]{64}$/.test(h)?h:new URLSearchParams(h).get('token')||'';}
let token=hashToken();try{token||=sessionStorage.getItem(tokenKey)||'';if(token)sessionStorage.setItem(tokenKey,token);}catch{}
if(hashToken())history.replaceState(null,'',location.pathname+location.search);
addEventListener('hashchange',()=>{if(hashToken())location.reload();});
let state=null,draft=null,historical=null,preview=null,output=null,outputId=null,busy=false,pending=null;
let store=null,namespace=null,persistTimer=null,persistRequested=false,pollTimer=null,writeQueue=Promise.resolve(),storageFailure=null;
let ui={tab:'overview',view:'records',offset:0,limit:100,focused:null,targets:[],reviewer:'',note:'',decision:'revisit',revisionNote:'',configuration:null,newEdition:null,attachments:[],delivery:{},acquisition:{}};
const fileCache=new Map();
const config=()=>historical?.config||draft?.config,revision=()=>historical?.revision||draft?.base;
const edition=()=>config()?.editions.find(e=>e.id===config().selectedEdition);
const dirty=()=>Boolean(draft&&(!same(draft.config,draft.baseConfig)||Object.keys(draft.files).length||ui.revisionNote.trim()));
const editable=()=>!historical&&!busy&&!pending;
const report=()=>output?.report||null;
const reportCurrent=()=>Boolean(report()&&preview?.revisionId===revision()?.id&&report().edition?.id===edition()?.id);
const sourceDirty=()=>!same(draft?.config.editions,draft?.baseConfig.editions);
const reviewEnabled=()=>editable()&&reportCurrent()&&!sourceDirty();
function notice(message,issue=false){$('#notice').textContent=message;$('#notice').hidden=false;$('#notice').className=issue?'issue':'';}
async function run(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){notice(e.message||String(e),true);}finally{busy=false;render();}}
async function api(route,body){
  const options={cache:'no-store',headers:{'X-Python-Workspace-Token':token}};
  if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  let response;try{response=await fetch(route,options);}catch(cause){const e=new Error('The server response did not arrive. Reopen the retained operation to recover its outcome.');e.unknownOutcome=body!==undefined;e.cause=cause;throw e;}
  let value;try{value=await response.json();}catch{const e=new Error('The server response was incomplete. The saved request remains available for recovery.');e.unknownOutcome=body!==undefined;throw e;}
  if(!response.ok){const e=new Error(value.message||value.error?.message||value.error||'Workspace request failed: '+response.status);e.status=response.status;e.unknownOutcome=body!==undefined&&response.status>=500;throw e;}
  return value;
}
async function digest(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(v=>v.toString(16).padStart(2,'0')).join('');}
function from64(value){const s=atob(value),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;}
function to64(data){let s='';for(let i=0;i<data.length;i+=32768)s+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(s);}
const fileBytes=f=>typeof f.base64==='string'?from64(f.base64):enc.encode(f.text);
function saveBytes(data,name,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([data],{type})),a=el('a',{href:url,download:name,hidden:true});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function download(route,name){
  const r=await fetch(route,{headers:{'X-Python-Workspace-Token':token},cache:'no-store'});if(!r.ok){let e={};try{e=await r.json();}catch{}throw new Error(e.message||e.error||'Download failed: '+r.status);}
  const data=new Uint8Array(await r.arrayBuffer()),sha=r.headers.get('x-content-sha256');if(sha&&await digest(data)!==sha)throw new Error('The downloaded bytes differ from the saved file identity.');
  saveBytes(data,/filename="([^"]+)"/.exec(r.headers.get('content-disposition')||'')?.[1]||name,r.headers.get('content-type')||'application/octet-stream');
}
function snapshot(){return {schema:'tj.finage-operator-draft.v1',workspaceId:namespace,draft:clone(draft),ui:clone(ui)};}
function persist(){if(!store||!draft)return;persistRequested=true;clearTimeout(persistTimer);persistTimer=setTimeout(()=>{persistTimer=null;flush().catch(()=>{});},200);}
async function flush(){
  clearTimeout(persistTimer);persistTimer=null;
  writeQueue=writeQueue.catch(()=>{}).then(async()=>{if(!persistRequested&&!storageFailure)return;persistRequested=false;await store.writeDraft(snapshot());storageFailure=null;});
  try{await writeQueue;}catch(e){storageFailure=e;notice(e.message+' Download the local draft from History to preserve these edits.',true);throw e;}finally{renderTop();}
}
function changed(){ui.configuration=null;persist();renderTop();}
async function retainedFile(id,path){const key=id+':'+path;if(!fileCache.has(key))fileCache.set(key,await api('/api/file?revision='+encodeURIComponent(id)+'&path='+encodeURIComponent(path)));return fileCache.get(key);}
async function readConfig(r){const f=await retainedFile(r.id,'workspace.json');if(typeof f.text!=='string')throw new Error('The saved workspace configuration must be UTF-8 JSON.');const c=parseJSON(f.text,'Workspace');validateConfig(c);return c;}
async function adoptHead(preserve=false){const previous=preserve&&draft?clone(draft):null,c=await readConfig(state.revision);draft={base:clone(state.revision),baseConfig:clone(c),config:clone(c),files:{},previous};historical=null;ui.configuration=null;ui.targets=[];ui.focused=null;ui.revisionNote='';ui.offset=0;persist();}
async function refresh(){state=await api('/api/state');if(!draft||!dirty())await adoptHead();if(preview)await openPreview(preview.id);}
async function clearPending(){pending=null;await store.deletePending();}
async function mutate(route,body,kind){
  if(pending)throw new Error('Recover the saved operation before another change.');await flush();
  pending={route,body:clone(body),kind,at:new Date().toISOString()};await store.writePending({workspaceId:namespace,request:pending});renderRecovery();
  try{const r=await api(route,body);await clearPending();return r;}catch(e){if(!e.unknownOutcome)await clearPending();throw e;}
}
function validateConfig(c){if(c?.schema!==SCHEMA||!Array.isArray(c.editions)||!c.editions.length||!c.editions.some(e=>e.id===c.selectedEdition))throw new Error('Use the Finage workspace schema with an existing selected edition.');if(new Set(c.editions.map(e=>e.id)).size!==c.editions.length)throw new Error('Each source edition needs a unique identity.');if(!Array.isArray(c.reviews)||!Array.isArray(c.customer?.columns))throw new Error('Keep reviews and customer.columns as arrays.');}
function checkHistory(base,next){
  const reviewed=new Set();
  for(const field of ['reviews','timeInterpretations','symbolMappings']){
    const a=base[field]||[],b=next[field]||[];if(!Array.isArray(b)||!same(a,b.slice(0,a.length)))throw new Error('Append '+field+' decisions while retaining the saved history.');
    for(const r of a)reviewed.add(r.editionId);
  }
  for(const e of base.editions){if(!reviewed.has(e.id))continue;const n=next.editions.find(x=>x.id===e.id),binding=x=>x?{id:x.id,capturedAt:x.capturedAt,scope:x.scope,sources:x.sources}:null;if(!same(binding(e),binding(n)))throw new Error('Changed input bytes or scope need a new edition; saved decisions retain their source binding.');}
}
const secretKeys=new Set(['token','apikey','authorization','password','secret','clientsecret','accesstoken','refreshtoken']);
const keyForm=v=>v.toLowerCase().replace(/[^a-z0-9]/g,'');
function checkMetadata(v){if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){
  if(secretKeys.has(keyForm(k))&&x!==null&&x!==''&&x!=='[redacted]')throw new Error('Keep credential values in the private acquisition client, outside workspace metadata.');
  if(typeof x==='string'&&/^https?:\/\//.test(x)){const u=new URL(x);if(u.username||u.password||[...u.searchParams.keys()].some(p=>secretKeys.has(keyForm(p))))throw new Error('Source URLs must not contain credentials.');}
  else if(x&&typeof x==='object')checkMetadata(x);
}}
async function saveDraft(){
  if(historical)throw new Error('Return to the working draft before saving.');if(!dirty())return state.revision;
  state=await api('/api/state');if(state.workspace.head!==draft.base.id)throw new Error('Another revision was saved. Merge the local draft with the current source in History.');
  validateConfig(draft.config);checkHistory(draft.baseConfig,draft.config);checkMetadata(draft.config);validateColumns(draft.config.customer.columns);
  const files=[{path:'workspace.json',text:json(draft.config)+'\n'},...Object.entries(draft.files).map(([path,f])=>({path,...(typeof f.base64==='string'?{base64:f.base64}:{text:f.text})}))];
  const next=new Map(draft.base.files.map(f=>[f.path,f.bytes]));for(const f of files)next.set(f.path,fileBytes(f).length);
  if([...next.values()].some(n=>n>8*1024*1024)||[...next.values()].reduce((a,b)=>a+b,0)>32*1024*1024)throw new Error('The source exceeds the workspace file or revision limit. Retain a complete named partition or use the complete-corpus streaming command.');
  const body={expectedHead:draft.base.id,baseRevision:draft.base.id,note:(ui.revisionNote.trim()||'Finage source, market review and customer delivery')+' [finage-save-'+crypto.randomUUID()+']',files};
  const saved=await mutate('/api/revisions',body,'save');state=await api('/api/state');await adoptHead();notice('Saved revision '+short(saved.id)+'.');return saved;
}
async function recover(){
  if(!pending)return;const p=clone(pending);state=await api('/api/state');
  if(p.kind==='preview'){const old=state.previews.find(x=>x.operationId===p.body.operationId),r=old?await api('/api/preview?id='+encodeURIComponent(old.id)):await api(p.route,p.body);await clearPending();await openPreview(r.id);notice('Recovered the same saved operation.');return;}
  const candidate=state.revisions.find(r=>r.parent===p.body.expectedHead&&r.note===p.body.note);
  if(candidate){const r=await api('/api/revision?id='+encodeURIComponent(candidate.id));if(p.kind==='restore'&&r.restoredFrom!==p.body.revisionId)throw new Error('The retained restore has a different selected revision.');if(p.kind==='save')for(const f of p.body.files){const sha=await digest(fileBytes(f));if(!r.files.some(x=>x.path===f.path&&x.sha256===sha))throw new Error('The saved revision differs from the retained request.');}await clearPending();await adoptHead(p.kind==='restore'&&dirty());notice('Recovered the completed revision without saving it again.');return;}
  if(state.operator?.busy)throw new Error('The saved operation is still running. Refresh its outcome when complete.');
  if(state.workspace.head!==p.body.expectedHead){await clearPending();notice('The source advanced. Your local draft remains available for a merge in History.',true);return;}
  await api(p.route,p.body);await clearPending();state=await api('/api/state');await adoptHead(p.kind==='restore'&&dirty());notice('Completed the retained request against its unchanged saved source.');
}
async function loadOutput(p){
  const r=await fetch('/api/preview-output?id='+encodeURIComponent(p.id),{headers:{'X-Python-Workspace-Token':token},cache:'no-store'});if(!r.ok)throw new Error('The saved output is unavailable: '+r.status);
  const b=new Uint8Array(await r.arrayBuffer());if(b.length!==p.result.bytes||await digest(b)!==p.result.sha256)throw new Error('The complete operation result differs from its recorded identity.');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));if(!RESULTS.has(value.schema)||!value.report?.edition)throw new Error('The result uses a different Finage report contract.');
  for(const f of value.files||[]){if(!/^[A-Za-z0-9_.-]{1,200}$/.test(f.name)||typeof f.body!=='string')throw new Error('A retained file has an unsupported name or body.');const d=enc.encode(f.body);if(d.length!==f.bytes||await digest(d)!==f.sha256)throw new Error('Generated file '+f.name+' differs from the saved output.');}
  output=value;outputId=p.id;ui.focused=null;
}
async function openPreview(id){const p=await api('/api/preview?id='+encodeURIComponent(id));preview=p;if(outputId!==id){output=null;outputId=null;}if(p.status==='COMPLETED'&&p.result){if(outputId!==id)await loadOutput(p);}else if(terminal(p.status)){output=null;outputId=null;}schedulePoll();}
function schedulePoll(){clearTimeout(pollTimer);if(!preview||terminal(preview.status))return;pollTimer=setTimeout(async()=>{if(busy){schedulePoll();return;}try{await openPreview(preview.id);state=await api('/api/state');render();}catch(e){notice(e.message+' Use Refresh to reopen this result.',true);}},1600);}
async function startPreview(fn,view=ui.view,offset=0){
  if(historical)throw new Error('Return to the working source to run an operation.');if(dirty())await saveDraft();
  const args={editionId:edition().id};if(fn==='inspect_market'){Object.assign(args,{view,offset,limit:Number(ui.limit)});ui.view=view;ui.offset=offset;}
  const r=await mutate('/api/preview',{revisionId:draft.base.id,function:fn,input:args,operationId:'finage-'+crypto.randomUUID()},'preview');ui.tab=fn==='inspect_market'?'inspection':'delivery';await openPreview(r.id);persist();
}
async function cancelPreview(){if(!preview||terminal(preview.status))return;await api('/api/preview/cancel',{id:preview.id});await openPreview(preview.id);notice('Cancelled the selected operation. Its saved source remains available.');}
function parseJSON(value,label){try{return JSON.parse(value.replace(/^\uFEFF/,''));}catch{throw new Error(label+' must be valid JSON.');}}
function go(tab){ui.tab=tab;persist();render();}
function renderRecovery(){const node=$('#recovery');if(!node)return;node.hidden=!pending;if(pending)node.replaceChildren(txt('h3','Recover the saved operation'),txt('p','The '+pending.kind+' request was retained before dispatch. Recovery uses the same source and request identity.'),row(button('Recover original operation',recover,{read:true,id:'recover-operation'}),button('Download request',()=>saveBytes(enc.encode(json(pending)+'\n'),'finage-pending-operation.json','application/json'),{read:true})));}
function renderTop(){
  if(!state||!draft)return;
  $('#workspace-label').textContent=state.workspace.label||config().title||state.workspace.id;
  $('#header-actions').replaceChildren(button('Refresh',async()=>{await refresh();notice('Saved state and operation refreshed.');},{read:true,id:'refresh-state'}),el('a',{href:'/#'+token,target:'_blank',rel:'noreferrer'},'Engineering workspace'));
  $('#save-state').replaceChildren(badge(historical?'Historical':dirty()?'Local changes':'Saved',dirty()),small(storageFailure?'Draft storage needs attention':draft.base.id!==state.workspace.head?'Newer source available':'Revision '+short(revision().id)),button('Save draft',saveDraft,{primary:true,disabled:!dirty()||!!historical,id:'save-draft'}));
  $('#edition-control').replaceChildren(field('Selected source edition',select(config().editions.map(e=>[e.id,(e.label||e.id)+' · '+(e.role||'primary')]),config().selectedEdition,{disabled:!editable(),id:'selected-edition',onchange:e=>{draft.config.selectedEdition=e.target.value;ui.targets=[];ui.focused=null;ui.offset=0;changed();render();}})));
  $('#footer-state').textContent=state.workspace.id+' · '+state.revisions.length+' saved revisions · '+state.previews.length+' operations';
  renderRecovery();
}
function banner(){
  if(!preview)return empty('Inspect a saved edition to open its full-source assessment and record views.');
  return el('div',{class:'inline-note'},row(badge(preview.status),mono(preview.function),small('Saved revision '+short(preview.revisionId))),report()&&!reportCurrent()?txt('p','This result describes another saved revision or edition. Inspect the selected source to review it.'):null,dirty()&&reportCurrent()?txt('p','The result describes saved inputs. Local changes will enter the next revision.'):null,preview.error?detail('Operation detail',preview.error):null,!terminal(preview.status)?button('Cancel this operation',cancelPreview,{read:true}):null);
}
function inspectButton(){return button(dirty()?'Save & inspect':'Inspect selected edition',()=>startPreview('inspect_market'),{primary:true,disabled:!!historical,id:'inspect-edition'});}

function overview(){
  const e=edition(),r=reportCurrent()?report():null;
  return [heading('Market data workspace','Inspect retained observations, compare editions and deliver the reviewed customer mapping.',inspectButton()),
    card(txt('h3',config().title||'Finage market workspace'),dl([['Selected edition',e.label||e.id],['Source role',e.role||'primary'],['Operation',e.scope.operation],['Market',e.scope.market],['Exact symbol selection',e.scope.symbols||'Original complete response'],['Captured',e.capturedAt],['Sources',e.sources.length]]),detail('Exact original scope',e.scope)),
    r?el('div',{class:'metrics'},[['Processed observations',r.summary.totalRecords],['Primary records',r.summary.primaryRecords],['Reference records',r.summary.referenceRecords],['Exact symbols',r.summary.uniqueExactSymbols],['Customer records',r.summary.customerRecords],['Finding groups',r.findings.total]].map(([k,v])=>el('div',{class:'metric'},small(k),txt('strong',count(v))))):null,
    banner(),r?card(txt('h3','Source assessment'),dl([['Source identities',r.assessment.sourceIntegrityVerified?'Verified against retained bytes':'Not checked'],['Review and mapping',r.ready?'Configured and reviewed':'Review or customer mapping remains'],['Comparison',r.assessment.comparison.status],['Price basis',r.assessment.priceBasis]]),detail('Original coverage',r.assessment.sourceCoverage)):null,
    card(txt('h3','Operating workflow'),txt('p','Sources keeps the complete capture files and original scope. Inspection reads every observation and pages the result. Decisions records named time interpretations, symbol mappings and review. Customer columns controls the full CSV and NDJSON. Delivery exports the selected saved revision and portable history.'),
      row(button('Inspect sources',()=>go('sources'),{read:true}),button('Compare editions',()=>go('comparison'),{read:true}),button('Prepare customer delivery',()=>go('delivery'),{read:true})))];
}
function canReview(){return !historical&&!pending&&reportCurrent()&&!sourceDirty();}
function binding(source){if(!ui.reviewer.trim()||!ui.note.trim())throw new Error('Enter the actual reviewer and a reason for this decision.');return {id:'decision-'+crypto.randomUUID(),editionId:edition().id,sourceId:source.id,sourceSha256:source.sha256,reviewer:ui.reviewer.trim(),note:ui.note.trim(),at:new Date().toISOString()};}
async function sourceDownload(source){const f=draft.files[source.path]||await retainedFile(revision().id,source.path),data=fileBytes(f);if(data.length!==source.bytes||await digest(data)!==source.sha256)throw new Error('The source differs from its original descriptor.');saveBytes(data,source.path.split('/').at(-1),'application/octet-stream');}
async function prepareImport(files){
  const all=await Promise.all(files.map(async f=>{if(f.size>8*1024*1024)throw new Error(f.name+' exceeds the native file limit.');const data=new Uint8Array(await f.arrayBuffer());return {name:f.name,data,sha256:await digest(data),bytes:data.length};}));
  const documentFile=all.find(f=>f.name==='workspace.json');if(!documentFile)throw new Error('Choose the prepared workspace.json and every referenced capture/metadata file together.');
  const incoming=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(documentFile.data));validateConfig(incoming);checkMetadata(incoming);
  const known=new Map(revision().files.map(f=>[f.path,f]));for(const[p,f]of Object.entries(draft.files))known.set(p,f);
  const additions={};
  for(const e of incoming.editions)for(const s of e.sources)for(const item of [s,...(s.metadata||[])]){
    const supplied=all.find(f=>f.sha256===item.sha256&&f.bytes===item.bytes),existing=known.get(item.path);
    if(supplied)additions[item.path]={base64:to64(supplied.data),sha256:supplied.sha256,bytes:supplied.bytes};
    else if(!existing||existing.sha256!==item.sha256||existing.bytes!==item.bytes)throw new Error('Include the exact full capture '+item.path+'.');
  }
  ui.preparedImport={configuration:incoming,workspaceSha256:documentFile.sha256,files:additions};persist();notice('Retained the complete prepared input locally. Review its edition list and append it to this workspace.');
}
function applyImport(){
  const packet=ui.preparedImport;if(!packet)throw new Error('Choose the complete prepared input first.');
  const next=clone(draft.config);
  for(const e of packet.configuration.editions){const prior=next.editions.find(x=>x.id===e.id);if(prior&&!same(prior,e))throw new Error('An existing edition ID has different metadata. Keep its original identity and create a new edition upstream.');if(!prior)next.editions.push(clone(e));}
  for(const field of ['reviews','timeInterpretations','symbolMappings'])for(const entry of packet.configuration[field]||[]){next[field]||=[];const old=next[field].find(x=>x.id===entry.id);if(old&&!same(old,entry))throw new Error('An imported decision ID conflicts with saved history.');if(!old)next[field].push(clone(entry));}
  next.selectedEdition=packet.configuration.selectedEdition;
  next.sourceImports=[...(next.sourceImports||[]),{workspaceSha256:packet.workspaceSha256,sourceAcquisition:packet.configuration.sourceAcquisition||null}];
  checkHistory(draft.baseConfig,next);draft.config=next;Object.assign(draft.files,packet.files);ui.preparedImport=null;ui.targets=[];ui.focused=null;changed();notice('Appended the prepared source editions and metadata. Save & inspect to process the complete selected source.');
}
function sources(){
  const e=edition(),packet=ui.preparedImport;
  return [heading('Source editions','Complete source bytes, original capture metadata and provider provenance stay together.',inspectButton()),
    card(txt('h3',e.label||e.id),field('Edition label',input(e.label||'',{disabled:!editable(),oninput:x=>{e.label=x.target.value;changed();}})),detail('Original scope',e.scope),detail('Source acquisition',config().sourceAcquisition||null)),
    ...e.sources.map(s=>card(txt('h3',s.id),dl([['Source kind',s.sourceKind],['Format',s.format],['Captured',s.capturedAt],['Exact bytes',bytes(s.bytes)],['SHA256',mono(s.sha256)],['Declared time unit',s.provenance?.timestampUnitDeclared||'Not declared']]),
      row(button('Download original source',()=>sourceDownload(s),{read:true}),button('Inspect source inventory',()=>startPreview('inspect_market','sources'),{disabled:!!historical})),
      detail('Original request',s.request),detail('Coverage',s.coverage),detail('Provenance',s.provenance),
      ...(s.metadata||[]).map(m=>row(mono(m.path),button('Download capture metadata',()=>sourceDownload(m),{read:true}))))),
    card(txt('h3','Import the next original capture'),txt('p','Use the existing acquisition client capture/import/prepare commands. Select its prepared workspace.json and all referenced captures and metadata files together. The original editions and decisions remain retained.'),
      field('Prepared workspace and captures',el('input',{type:'file',multiple:true,disabled:!editable(),id:'prepared-inputs',onchange:e=>run(()=>prepareImport([...e.target.files]))})),
      packet?detail('Prepared editions',packet.configuration.editions.map(e=>({id:e.id,label:e.label,sources:e.sources.map(s=>({id:s.id,bytes:s.bytes,sha256:s.sha256}))}))):null,
      row(button('Append complete prepared input',applyImport,{primary:true,disabled:!packet||!editable(),id:'append-prepared-input'}),packet?button('Discard this local import',()=>{ui.preparedImport=null;persist();},{read:true}):null),
      detail('Original client commands','python3 acquisition.py capture --plan PLAN.json --out CAPTURE_DIRECTORY\npython3 acquisition.py import --manifest RETAINED_MANIFEST.json --out CAPTURE_DIRECTORY\npython3 acquisition.py prepare --dir CAPTURE_DIRECTORY --out PREPARED_DIRECTORY'))];
}
function addTarget(type,id,sourceId,label){if(!canReview())throw new Error('Inspect the selected saved sources before adding a review target.');const source=edition().sources.find(s=>s.id===sourceId);if(!source||!id)throw new Error('The inspection row lacks an original source identity.');const t={type,id:String(id),sourceId,label:label||String(id)};if(!ui.targets.some(x=>x.type===t.type&&x.id===t.id&&x.sourceId===t.sourceId))ui.targets.push(t);persist();}
function inspection(){
  const current=reportCurrent()&&output?.page&&output.page.view===ui.view,items=current?output.page.items:[],page=current?output.page:null;
  const shown=items.map(item=>{let label=item.symbol||item.id||item.code||item.status||item.sourceId||'Observation';let kind=item.kind||item.code||item.status||item.format||item.eventKind||'';
    const source=edition().sources.find(s=>s.id===(item.sourceId||item.id)),type=ui.view==='findings'?'finding':ui.view==='symbols'?'symbol':ui.view==='sources'?'source':'record';
    return [el('div',{},mono(label),small(item.sourceId||'')),fmt(kind),item.raw?detail('Exact typed fields',item.fields||item.raw):detail('Original item',item),row(button('Open',()=>{ui.focused=clone(item);persist();},{read:true}),source&&ui.view!=='changes'&&ui.view!=='events'?button('Review',()=>{addTarget(type,type==='symbol'?item.symbol:item.id,source.id,label);go('decisions');},{disabled:!canReview()}):null)];});
  return [heading('Inspect all selected observations','The processor reads complete sources. This view presents a page with exact numbers and JSON kinds.'),
    card(el('div',{class:'toolbar'},field('View',select(VIEWS,ui.view,{onchange:e=>{ui.view=e.target.value;ui.offset=0;persist();render();}})),
      field('Page size',select(['25','100','250','1000'],String(ui.limit),{onchange:e=>{ui.limit=Number(e.target.value);persist();}})),
      button('Inspect this view',()=>startPreview('inspect_market',ui.view,0),{primary:true,disabled:!!historical,id:'inspect-view'})),banner(),
      page?row(small('Showing '+(page.items.length?page.offset+1:0)+'–'+(page.offset+page.items.length)+' of '+page.total),button('Previous',()=>startPreview('inspect_market',ui.view,Math.max(0,page.offset-Number(ui.limit))),{disabled:page.offset===0||!!historical}),button('Next',()=>startPreview('inspect_market',ui.view,page.nextOffset),{disabled:!page.hasMore||!!historical}),page.byteLimited?small('Page limited by actual output bytes; Next continues at the next record.'):null):null,
      shown.length?table(['Identity','Kind / state','Values','Actions'],shown,'inspection-table'):empty('Run this saved source view to see its records.')),
    ui.focused?card(txt('h3','Selected observation'),detail('Complete native item',ui.focused),txt('p','Displayed raw number nodes have kind/text wrappers. Full mapped exports read the original record and preserve numeric JSON tokens.')):null];
}
function comparison(){
  const e=edition(),r=reportCurrent()?report():null;
  return [heading('Compare original editions','Select the actual same-scope baseline and review its raw field changes.',button('Run comparison',()=>startPreview('inspect_market','changes'),{primary:true,disabled:!!historical})),
    card(field('Comparison baseline',select([['','No comparison'],...config().editions.filter(x=>x.id!==e.id).map(x=>[x.id,x.label||x.id])],e.compareToEdition||'',{disabled:!editable(),id:'comparison-baseline',onchange:x=>{if(x.target.value)e.compareToEdition=x.target.value;else delete e.compareToEdition;changed();}})),
      field('Price basis',select([['native','Original native fields'],['midpoint','Explicit bid/ask midpoint for quotes']],config().analysis.priceBasis||'native',{disabled:!editable(),onchange:e=>{draft.config.analysis.priceBasis=e.target.value;changed();}})),
      field('Stale threshold in seconds',input(config().analysis.staleAfterSeconds??'',{disabled:!editable(),placeholder:'No stale threshold',oninput:e=>{draft.config.analysis.staleAfterSeconds=e.target.value===''?null:e.target.value;changed();}}),'Exact decimal seconds against recorded capture UTC.'),
      txt('p','Exact scope, source-specific unit decisions and unambiguous symbol/kind keys are required for an aligned comparison. Stream intervals retain their own boundaries. No provider sequence or missing market interval is invented.')),
    banner(),r?card(txt('h3','Comparison result'),detail('Original comparison',r.assessment.comparison),button('Open complete changes view',()=>startPreview('inspect_market','changes'),{disabled:!!historical})):null];
}

function decisions(){
  const e=edition(),source=e.sources.find(s=>s.id===ui.decisionSource)||e.sources[0];
  const named=el('div',{class:'grid'},field('Reviewer',input(ui.reviewer,{id:'reviewer',disabled:!editable(),oninput:x=>{ui.reviewer=x.target.value;persist();}})),
    field('Reason',area(ui.note,{id:'review-note',disabled:!editable(),oninput:x=>{ui.note=x.target.value;persist();}})));
  return [heading('Review and interpretation','Every decision retains its reviewer, reason, time and exact original source identity.'),banner(),
    card(txt('h3','Named decision'),named,field('Original source',select(e.sources.map(s=>[s.id,s.id]),source.id,{disabled:!editable(),id:'decision-source',onchange:x=>{ui.decisionSource=x.target.value;persist();render();}})),
      row(button('Add this source to review',()=>addTarget('source',source.id,source.id),{disabled:!canReview(),id:'review-source'}))),
    card(txt('h3','Event time interpretation'),dl([['Provider declaration',source.provenance?.timestampUnitDeclared||'Not declared'],['Source',mono(source.id)]]),
      field('Interpret original event values as',select([['','Choose explicitly'],['seconds','Seconds'],['milliseconds','Milliseconds'],['microseconds','Microseconds'],['nanoseconds','Nanoseconds'],['uninterpreted','Keep uninterpreted']],ui.timeUnit||'',{disabled:!editable(),id:'time-unit',onchange:x=>{ui.timeUnit=x.target.value;persist();}})),
      txt('p','The provider declaration is retained separately. The selected unit never replaces the original event value or substitutes capture time for zero or missing values.'),
      button('Append time interpretation',()=>{if(!canReview())throw new Error('Inspect this saved source before interpreting its time.');if(!ui.timeUnit)throw new Error('Select the unit explicitly.');draft.config.timeInterpretations||=[];draft.config.timeInterpretations.push({...binding(source),unit:ui.timeUnit});changed();notice('Appended a source-bound time interpretation to the draft.');},{primary:true,disabled:!canReview(),id:'append-time-interpretation'}),
      detail('Retained time decisions',config().timeInterpretations||[])),
    card(txt('h3','Exact symbol mapping'),el('div',{class:'grid'},field('Original exact symbol',input(ui.rawSymbol||'',{disabled:!editable(),id:'raw-symbol',oninput:x=>{ui.rawSymbol=x.target.value;persist();}})),
      field('Customer symbol label',input(ui.customerSymbol||'',{disabled:!editable(),id:'customer-symbol',oninput:x=>{ui.customerSymbol=x.target.value;persist();}}))),
      button('Append symbol mapping',()=>{if(!canReview())throw new Error('Inspect this saved source first.');if(!ui.rawSymbol||!ui.customerSymbol)throw new Error('Enter the exact original symbol and customer label.');draft.config.symbolMappings||=[];draft.config.symbolMappings.push({...binding(source),symbol:ui.rawSymbol,customerSymbol:ui.customerSymbol});changed();notice('Appended the explicit customer symbol label.');},{disabled:!canReview(),id:'append-symbol-mapping'}),
      detail('Retained symbol mappings',config().symbolMappings||[])),
    card(txt('h3','Selected review targets'),ui.targets.length?table(['Type','Source / target','Remove'],ui.targets.map((t,i)=>[t.type,el('div',{},mono(t.sourceId),txt('p',t.label)),button('Remove',()=>{ui.targets.splice(i,1);persist();},{read:true})])):empty('Add a source here or choose a record, symbol or finding in Inspection.'),
      field('Decision',select([['accept','Accept for the recorded purpose'],['exclude','Exclude selected source, symbol or record'],['revisit','Keep for further review']],ui.decision,{disabled:!editable(),id:'review-decision',onchange:x=>{ui.decision=x.target.value;persist();}})),
      button('Append review decisions',()=>{
        if(!canReview()||!ui.targets.length)throw new Error('Choose original inspected targets first.');
        if(ui.decision==='exclude'&&ui.targets.some(t=>t.type==='finding'))throw new Error('To exclude data, choose its source, symbol or record. Finding review records acceptance or a revisit.');
        const entries=ui.targets.map(t=>{const s=e.sources.find(s=>s.id===t.sourceId);if(!s)throw new Error('A review target no longer belongs to this edition.');return {...binding(s),targetType:t.type,targetId:t.id,decision:ui.decision};});
        draft.config.reviews.push(...entries);ui.targets=[];changed();notice('Appended '+entries.length+' named source-bound decisions.');
      },{primary:true,disabled:!canReview()||!ui.targets.length,id:'append-reviews'}),detail('Retained review history',(config().reviews||[]).filter(r=>r.editionId===e.id)))];
}
function validateColumns(columns){
  if(!Array.isArray(columns)||columns.length>128)throw new Error('Use an ordered mapping with at most128 columns.');
  const seen=new Set();for(const c of columns){if(typeof c.name!=='string'||!c.name.trim()||seen.has(c.name)||typeof c.path!=='string'||!c.path.startsWith('/'))throw new Error('Each column needs a unique exact label and a JSON pointer.');if(c.path.startsWith('/review')||c.path.startsWith('/decision'))throw new Error('Private review fields do not belong in customer output.');seen.add(c.name);}
}
function pointer(value,path){if(!path.startsWith('/'))return null;for(const p of path.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~'))){if(value===null||typeof value!=='object'||!Object.hasOwn(value,p))return null;value=value[p];}return value;}
function mapping(){
  const cols=config().customer.columns,record=ui.focused?.raw?ui.focused:(reportCurrent()&&output?.page?.view==='records'?output.page.items[0]:null);
  return [heading('Customer columns','Map exact source values into an explicit customer CSV and NDJSON schema.'),
    card(field('Customer selection',select([['all','All primary records except explicit exclusions'],['reviewed','Only explicitly accepted primary records']],config().customer.mode||'all',{disabled:!editable(),id:'customer-mode',onchange:e=>{draft.config.customer.mode=e.target.value;changed();}})),
      txt('p','Original JSON numbers remain numbers at /raw/* and numeric /values/* pointers. /fields/*/text deliberately maps the displayed value as a string. Null and empty string remain different in NDJSON.'),
      row(button('Use the 25-column market mapping',()=>{draft.config.customer.columns=clone(DEFAULT_COLUMNS);changed();render();},{disabled:!editable(),id:'default-columns'}),
        button('Add column',()=>{draft.config.customer.columns.push({name:'column_'+(cols.length+1),path:'/symbol'});changed();render();},{disabled:!editable(),id:'add-column'}),
        button('Inspect a record for mapping',()=>startPreview('inspect_market','records'),{disabled:!!historical})),
      cols.length?table(['Output label','Original record pointer','Example value','Order'],cols.map((c,i)=>[
        input(c.name,{disabled:!editable(),oninput:e=>{c.name=e.target.value;changed();}}),
        input(c.path,{disabled:!editable(),oninput:e=>{c.path=e.target.value;changed();}}),
        record?mono(fmt(pointer(record,c.path))):small('Inspect a saved record'),
        row(button('Up',()=>{[cols[i-1],cols[i]]=[cols[i],cols[i-1]];changed();render();},{disabled:!editable()||i===0}),
          button('Remove',()=>{cols.splice(i,1);changed();render();},{disabled:!editable()}))]),'mapping-table'):empty('Choose an explicit customer mapping. The default canonical mapping remains available for inspection.')),
    record?card(txt('h3','Original inspected record'),detail('Typed display of exact source values',record)):null,
    card(txt('h3','Mapping validation'),button('Validate customer columns',()=>{validateColumns(cols);notice('Column labels and pointers are valid. Save and build to process the full source against this mapping.');},{disabled:!editable()}))];
}
function operationHistory(){
  return card(txt('h3','Saved operations'),table(['Function','Status','Revision / created','Result'],[...state.previews].filter(p=>FUNCTIONS.has(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(p=>[
    p.function,badge(p.status),el('div',{},mono(p.revisionId),small(p.createdAt)),button('Open saved result',async()=>{await openPreview(p.id);go(p.function==='inspect_market'?'inspection':'delivery');},{read:true})])));
}
function delivery(){
  const r=reportCurrent()?report():null,completeBuild=preview?.status==='COMPLETED'&&preview.function==='build_market';
  const directory=ui.delivery.directory||'FINAGE_WORKBENCH_DIRECTORY',destination=ui.delivery.destination||'finage-customer-delivery';
  const command='node workbench.mjs handoff --dir '+shell(directory)+' --preview '+shell(completeBuild?preview.id:'COMPLETED_BUILD_PREVIEW_ID')+' --out '+shell(destination)+' --audience customer';
  return [heading('Delivery','Build source-bound reports, export every mapped record and retain the complete original workspace.'),
    card(row(button('Build operator report',()=>startPreview('build_market'),{primary:true,disabled:!!historical,id:'build-market'}),
      button('Build customer report',()=>startPreview('customer_market'),{disabled:!!historical,id:'customer-market'}),
      button('Download portable workspace',()=>download('/api/export','finage.python-workspace.json'),{read:true,id:'export-workspace'})),banner(),
      r?dl([['Processed observations',count(r.summary.totalRecords)],['Selected customer records',count(r.summary.customerRecords)],['Explicitly excluded primary records',count(r.summary.excludedPrimaryRecords)],['Review and mapping',r.ready?'Configured and reviewed':'Source and review findings are retained'],['Complete mapped dataset in this preview','No — use the original full file export below']]):null),
    output?.files?.length?card(txt('h3','Retained report files'),table(['File','Bytes / identity','Download'],output.files.map(f=>[f.name,el('div',{},small(bytes(f.bytes)),mono(f.sha256)),button('Download',()=>saveBytes(enc.encode(f.body),f.name,f.contentType),{read:true})]))):null,
    card(txt('h3','Complete customer handoff'),txt('p','The original workbench handoff reconstructs this completed build’s immutable source revision, runs the full streaming export and retains its exact file inventory. Reopening the same completed handoff verifies its bytes without another provider call or native preview.'),
      el('div',{class:'grid'},field('Existing workbench directory',input(directory,{id:'delivery-workbench',oninput:e=>{ui.delivery.directory=e.target.value;persist();}})),
        field('New output directory',input(destination,{id:'delivery-destination',oninput:e=>{ui.delivery.destination=e.target.value;persist();}}))),
      detail('Full customer export command',command),button('Download handoff instruction',()=>saveBytes(enc.encode(command+'\n'),'finage-customer-handoff.txt','text/plain'),{read:true,disabled:!completeBuild}),
      r?detail('Complete processor export',r.dataExport.command):null,
      txt('p','Customer output contains complete mapped-records.csv, mapped-records.ndjson, source-index.json, output-columns.json, market-summary.json, market-summary.html and DELIVERY.md. The manifest records every file’s size and SHA256. Operator audience additionally retains private review material and the original portable workspace.')),
    card(txt('h3','Receiving and continuation'),txt('p','Receive the complete customer directory through the maintained customer warehouse. Stage the original manifest before a named customer selection; keep previous editions, exact JSON kinds, unfiltered byte-identical exports and backup/reopen. A later captured edition remains a separate delivery with its own comparison.')),
    operationHistory()];
}
function mergeValue(base,local,remote,path,conflicts){
  if(same(local,base))return clone(remote);if(same(remote,base)||same(local,remote))return clone(local);
  if(['reviews','timeInterpretations','symbolMappings'].includes(path)&&Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)&&same(local.slice(0,base.length),base)&&same(remote.slice(0,base.length),base)){
    const mine=local.slice(base.length),theirs=remote.slice(base.length),key=r=>r.editionId+'|'+r.sourceId+'|'+(r.targetType||path)+'|'+(r.targetId||r.symbol||'unit');
    if(mine.some(a=>theirs.some(b=>key(a)===key(b)&&!same(a,b)))){conflicts.push('reviews for the same target');return clone(local);}
    return [...clone(remote),...clone(mine.filter(a=>!theirs.some(b=>same(a,b))))];
  }
  if(path==='editions'&&Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)){
    const ids=[...new Set([...remote.map(x=>x.id),...local.map(x=>x.id)])];return ids.map(id=>mergeValue(base.find(x=>x.id===id),local.find(x=>x.id===id),remote.find(x=>x.id===id),'edition.'+id,conflicts)).filter(x=>x!==undefined);
  }
  if(local&&remote&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(local)&&!Array.isArray(remote)&&(base===undefined||base&&typeof base==='object'&&!Array.isArray(base))){
    const merged=Object.create(null);for(const k of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])){const v=mergeValue(base?.[k],local[k],remote[k],path?path+'.'+k:k,conflicts);if(v!==undefined)merged[k]=v;}return merged;
  }
  conflicts.push(path);return clone(local);
}
async function mergeLatest(){
  state=await api('/api/state');const remote=await readConfig(state.revision),conflicts=[],merged=mergeValue(draft.baseConfig,draft.config,remote,'',conflicts);
  if(conflicts.length){ui.latestConfiguration=remote;persist();throw new Error('Both drafts changed '+conflicts.join(', ')+'. Local and current saved configurations are retained below for an explicit merge.');}
  for(const[p,f]of Object.entries(draft.files)){const saved=state.revision.files.find(x=>x.path===p);if(saved&&saved.sha256!==f.sha256)throw new Error('The saved source has different bytes at '+p+'. Preserve both captures before merging.');}
  validateConfig(merged);checkHistory(remote,merged);draft.base=clone(state.revision);draft.baseConfig=clone(remote);draft.config=merged;ui.latestConfiguration=null;changed();notice('Merged independent local edits with the current saved revision.');
}
async function openHistorical(id){
  const r=await api('/api/revision?id='+encodeURIComponent(id));historical={revision:r,config:await readConfig(r)};ui.configuration=null;ui.focused=null;ui.targets=[];
  const found=state.previews.filter(p=>p.revisionId===id&&FUNCTIONS.has(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(found.length)await openPreview(found[0].id);else{preview=null;output=null;outputId=null;}persist();notice('Opened the saved historical revision. The working local draft remains retained.');
}
async function restoreHistorical(){
  if(!historical)return;const selected=historical.revision,previous=dirty()?clone(draft):null;
  await mutate('/api/restore',{expectedHead:state.workspace.head,revisionId:selected.id,note:'Restore Finage source '+selected.id+' [finage-restore-'+crypto.randomUUID()+']'},'restore');
  state=await api('/api/state');await adoptHead();draft.previous=previous;persist();notice('Restored the selected source as a new revision. Original history is preserved.');
}
function historyView(){
  return [heading('History and source recovery','Reopen saved editions and results, merge local edits and restore prior source as a new revision.'),
    historical?card(txt('h3','Historical source '+short(revision().id)),txt('p',revision().note||''),
      row(button('Return to working draft',()=>{historical=null;ui.configuration=null;ui.focused=null;ui.targets=[];persist();},{read:true,id:'return-to-draft'}),button('Restore as a new revision',restoreHistorical,{primary:true,id:'restore-revision'}))):null,
    card(txt('h3','Working local draft'),dl([['Based on',mono(draft.base.id)],['Current saved head',mono(state.workspace.head)],['Unsaved changes',String(dirty())],['Draft persistence',storageFailure?storageFailure.message:'Stored with this browser workspace']]),
      field('Revision note',input(ui.revisionNote,{disabled:!editable(),id:'revision-note',oninput:e=>{ui.revisionNote=e.target.value;changed();}})),
      row(button('Download local draft',()=>saveBytes(enc.encode(json(snapshot())+'\n'),'finage-local-operator-draft.json','application/json'),{read:true,id:'download-local-draft'}),
        button('Merge with current source',mergeLatest,{disabled:!!historical||!dirty()||draft.base.id===state.workspace.head,id:'merge-current'}),
        button('Use current saved source',async()=>{state=await api('/api/state');await adoptHead(dirty());notice('Opened current saved source. A previous local draft remains recoverable below.');},{read:true})),
      draft.previous?button('Recover previous local draft',()=>{const p=clone(draft.previous);draft=p;historical=null;ui.configuration=null;ui.targets=[];persist();notice('Recovered the prior local draft. Merge it with the current revision when needed.');},{read:true}):null),
    card(txt('h3','Saved source revisions'),table(['Revision','Created','Note','Source','Open'],[...state.revisions].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>[
      el('div',{},mono(r.id),r.id===state.workspace.head?badge('Current'):null),r.createdAt,r.note||'—',small(count(r.files)+' files · '+bytes(r.bytes)),button('Open revision',()=>openHistorical(r.id),{read:true,id:'open-revision-'+r.id})
    ]))),
    card(txt('h3','Complete workspace configuration'),txt('p','Apply a complete configuration while preserving original review history. Saved capture and application files stay in the same workspace.'),
      area(ui.configuration??json(config()),{class:'wide-json',disabled:!editable(),id:'workspace-json',oninput:e=>{ui.configuration=e.target.value;persist();}}),
      button('Apply configuration to draft',()=>{const c=parseJSON(ui.configuration??json(config()),'Workspace configuration');validateConfig(c);checkMetadata(c);checkHistory(draft.baseConfig,c);validateColumns(c.customer.columns);draft.config=c;ui.configuration=null;ui.targets=[];changed();notice('Applied the complete configuration to the local draft.');},{disabled:!!historical,id:'apply-workspace-json'}),
      ui.latestConfiguration?detail('Current saved configuration for merge',ui.latestConfiguration):null,detail('Saved source file identities',revision().files)),
    operationHistory(),pending?detail('Retained pending operation',pending):null];
}
function render(){
  if(!state||!draft)return;renderTop();const nav=$('#navigation');nav.replaceChildren(...TABS.map(([id,label])=>button(label,()=>go(id),{read:true,id:'tab-'+id})));for(const b of nav.querySelectorAll('button'))if(b.id==='tab-'+ui.tab)b.setAttribute('aria-current','page');
  const sections={overview,sources,inspection,comparison,decisions,mapping,delivery,history:historyView};$('#content').replaceChildren(...(sections[ui.tab]||overview)().filter(Boolean));
}
async function boot(){
  if(!token)throw new Error('Open the complete operator URL printed by the Finage workbench serve command.');
  state=await api('/api/state');namespace=state.workspace.id+':finage-operator';store=createDraftStore(namespace);
  const[saved,request]=await Promise.all([store.readDraft(),store.readPending()]);
  if(saved?.schema==='tj.finage-operator-draft.v1'&&saved.workspaceId===namespace&&saved.draft?.base?.id&&state.revisions.some(r=>r.id===saved.draft.base.id)){
    draft=saved.draft;ui={...ui,...saved.ui};if(!dirty()&&draft.base.id!==state.workspace.head)await adoptHead();
  }else await adoptHead();
  pending=request?.workspaceId===namespace?request.request:null;
  if(!TABS.some(([id])=>id===ui.tab))ui.tab='overview';
  const candidates=state.previews.filter(p=>p.revisionId===draft.base.id&&FUNCTIONS.has(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(candidates.length)await openPreview(candidates[0].id);render();
}
addEventListener('beforeunload',event=>{if(dirty()||pending||busy||persistRequested||ui.attachments.length){event.preventDefault();event.returnValue='';}});
addEventListener('pagehide',()=>clearTimeout(pollTimer));
boot().catch(e=>{notice(e.message||String(e),true);$('#content').replaceChildren(empty('Reopen the current operator URL. Saved source remains in the workspace.'));});
