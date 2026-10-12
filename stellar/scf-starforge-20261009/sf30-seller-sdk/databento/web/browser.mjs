// Databento operator over the original Python workspace server and retained source.
import {createDraftStore} from '/local-draft-store.mjs';
const $=s=>document.querySelector(s),clone=v=>structuredClone(v),json=v=>JSON.stringify(v,null,2),enc=new TextEncoder();
const SCHEMA='tj.databento-migration-workspace.v1';
const RESULTS=new Set(['tj.databento-migration-inspection.v1','tj.databento-migration-build.v1','tj.databento-customer-migration.v1']);
const FUNCTIONS=new Set(['inspect_migration','build_migration','customer_migration']);
const TABS=[['overview','Overview'],['sources','Sources'],['inspection','Inspection'],['comparison','Migration comparison'],['decisions','Decisions'],['mapping','Customer columns'],['delivery','Delivery'],['history','History']];
const VIEWS=[['records','Records'],['instruments','Instruments'],['sessions','Sessions'],['findings','Findings'],['changes','Changes'],['sources','Sources']];
const DEFAULT_COLUMNS=[['identity','/identity/key'],['symbol','/identity/rawSymbol'],['event_time','/time/event/raw'],['event_ns','/time/event/ns'],['price','/prices/price/raw'],['price_atomic','/prices/price/atomic'],['decision','/review/decision']].map(([name,path])=>({name,path}));
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
function snapshot(){return {schema:'tj.databento-operator-draft.v1',workspaceId:namespace,draft:clone(draft),ui:clone(ui)};}
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
function validateConfig(c){if(c?.schema!==SCHEMA||!Array.isArray(c.editions)||!c.editions.length||!c.editions.some(e=>e.id===c.selectedEdition))throw new Error('Use the Databento workspace schema with an existing selected edition.');if(new Set(c.editions.map(e=>e.id)).size!==c.editions.length)throw new Error('Each source edition needs a unique identity.');if(!Array.isArray(c.reviews)||!Array.isArray(c.outputColumns))throw new Error('Keep reviews and outputColumns as arrays.');}
function checkHistory(base,next){
  const a=base.reviews||[],b=next.reviews||[];if(!same(a,b.slice(0,a.length)))throw new Error('Keep saved review history and append the new decision.');
  const reviewed=new Set(a.map(r=>r.editionId));for(const e of base.editions){if(!reviewed.has(e.id))continue;const n=next.editions.find(x=>x.id===e.id),binding=x=>x?{id:x.id,capturedAt:x.capturedAt,scope:x.scope,sources:x.sources}:null;if(!same(binding(e),binding(n)))throw new Error('Create a new edition for changed source inputs. The existing reviews remain attached to their original sources.');}
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
  validateConfig(draft.config);checkHistory(draft.baseConfig,draft.config);checkMetadata(draft.config);validateColumns(draft.config.outputColumns);
  const files=[{path:'workspace.json',text:json(draft.config)+'\n'},...Object.entries(draft.files).map(([path,f])=>({path,...(typeof f.base64==='string'?{base64:f.base64}:{text:f.text})}))];
  const next=new Map(draft.base.files.map(f=>[f.path,f.bytes]));for(const f of files)next.set(f.path,fileBytes(f).length);
  if([...next.values()].some(n=>n>8*1024*1024)||[...next.values()].reduce((a,b)=>a+b,0)>32*1024*1024)throw new Error('The source exceeds the workspace file or revision limit. Retain a complete named partition or use the complete-corpus streaming command.');
  const body={expectedHead:draft.base.id,baseRevision:draft.base.id,note:(ui.revisionNote.trim()||'Databento source, migration review and delivery')+' [databento-save-'+crypto.randomUUID()+']',files};
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
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));if(!RESULTS.has(value.schema)||!value.report?.edition)throw new Error('The result uses a different Databento report contract.');
  for(const f of value.files||[]){if(!/^[A-Za-z0-9_.-]{1,200}$/.test(f.name)||typeof f.body!=='string')throw new Error('A retained file has an unsupported name or body.');const d=enc.encode(f.body);if(d.length!==f.bytes||await digest(d)!==f.sha256)throw new Error('Generated file '+f.name+' differs from the saved output.');}
  output=value;outputId=p.id;ui.focused=null;
}
async function openPreview(id){const p=await api('/api/preview?id='+encodeURIComponent(id));preview=p;if(outputId!==id){output=null;outputId=null;}if(p.status==='COMPLETED'&&p.result){if(outputId!==id)await loadOutput(p);}else if(terminal(p.status)){output=null;outputId=null;}schedulePoll();}
function schedulePoll(){clearTimeout(pollTimer);if(!preview||terminal(preview.status))return;pollTimer=setTimeout(async()=>{if(busy){schedulePoll();return;}try{await openPreview(preview.id);state=await api('/api/state');render();}catch(e){notice(e.message+' Use Refresh to reopen this result.',true);}},1600);}
async function startPreview(fn,view=ui.view,offset=0){
  if(historical)throw new Error('Return to the working source to run an operation.');if(dirty())await saveDraft();
  const args={editionId:edition().id};if(fn==='inspect_migration'){Object.assign(args,{view,offset,limit:Number(ui.limit)});ui.view=view;ui.offset=offset;}
  const r=await mutate('/api/preview',{revisionId:draft.base.id,function:fn,input:args,operationId:'databento-'+crypto.randomUUID()},'preview');ui.tab=fn==='inspect_migration'?'inspection':'delivery';await openPreview(r.id);persist();
}
async function cancelPreview(){if(!preview||terminal(preview.status))return;await api('/api/preview/cancel',{id:preview.id});await openPreview(preview.id);notice('Cancelled the selected operation. Its saved source remains available.');}
function parseJSON(value,label){try{return JSON.parse(value.replace(/^\uFEFF/,''));}catch{throw new Error(label+' must be valid JSON.');}}
function go(tab){ui.tab=tab;persist();render();}
function renderRecovery(){const node=$('#recovery');if(!node)return;node.hidden=!pending;if(pending)node.replaceChildren(txt('h3','Recover the saved operation'),txt('p','The '+pending.kind+' request was retained before dispatch. Recovery uses the same source and request identity.'),row(button('Recover original operation',recover,{read:true,id:'recover-operation'}),button('Download request',()=>saveBytes(enc.encode(json(pending)+'\n'),'databento-pending-operation.json','application/json'),{read:true})));}
function renderTop(){
  if(!state||!draft)return;
  $('#workspace-label').textContent=state.workspace.label||config().title||state.workspace.id;
  $('#header-actions').replaceChildren(button('Refresh',async()=>{await refresh();notice('Saved state and operation refreshed.');},{read:true,id:'refresh-state'}),el('a',{href:'/#'+token,target:'_blank',rel:'noreferrer'},'Engineering workspace'));
  $('#save-state').replaceChildren(badge(historical?'Historical':dirty()?'Local changes':'Saved',dirty()),small(storageFailure?'Draft storage needs attention':draft.base.id!==state.workspace.head?'Newer source available':'Revision '+short(revision().id)),button('Save draft',saveDraft,{primary:true,disabled:!dirty()||!!historical,id:'save-draft'}));
  $('#edition-control').replaceChildren(field('Selected source edition',select(config().editions.map(e=>[e.id,(e.label||e.id)+' · '+e.role]),config().selectedEdition,{disabled:!editable(),id:'selected-edition',onchange:e=>{draft.config.selectedEdition=e.target.value;ui.targets=[];ui.focused=null;ui.offset=0;changed();render();}})));
  $('#footer-state').textContent=state.workspace.id+' · '+state.revisions.length+' saved revisions · '+state.previews.length+' operations';
  renderRecovery();
}
function banner(){
  if(!preview)return empty('Inspect a saved edition to open its full-source assessment and record views.');
  return el('div',{class:'inline-note'},row(badge(preview.status),mono(preview.function),small('Saved revision '+short(preview.revisionId))),report()&&!reportCurrent()?txt('p','This result describes another saved revision or edition. Inspect the selected source to review it.'):null,dirty()&&reportCurrent()?txt('p','The result describes saved inputs. Local changes will enter the next revision.'):null,preview.error?detail('Operation detail',preview.error):null,!terminal(preview.status)?button('Cancel this operation',cancelPreview,{read:true}):null);
}
function inspectButton(){return button(dirty()?'Save & inspect':'Inspect selected edition',()=>startPreview('inspect_migration'),{primary:true,disabled:!!historical,id:'inspect-edition'});}
function overview(){
  const e=edition(),r=reportCurrent()?report():null,s=r?.summary;
  return [heading('Historical migration review','Inspect complete source scopes, record migration decisions and deliver the selected customer mapping.',inspectButton()),
    card(txt('h3',config().title||'Databento migration'),dl([['Selected edition',e.label||e.id],['Source role',badge(e.role)],['Dataset / schema',fmt(e.scope.dataset)+' / '+fmt(e.scope.schema)],['Symbols',(e.scope.symbols||[]).join(', ')],['Time window',fmt(e.scope.start)+' → '+fmt(e.scope.end)],['Time field / environment',fmt(e.scope.timeField)+' / '+fmt(e.scope.gateway)],['Source capture time',fmt(e.capturedAt)],['Retained source files',count(e.sources.length)]])),
    s?el('div',{class:'metrics'},[['Processed records',s.totalRecords],['Primary records',s.primaryRecords],['Reference records',s.referenceRecords],['Instruments',s.instrumentCount],['Customer records',s.customerRecords],['Excluded primary',s.excludedPrimaryRecords]].map(([k,v])=>el('div',{class:'metric'},small(k),txt('strong',count(v))))):null,
    banner(),r?card(txt('h3','Migration assessment'),...Object.entries(r.assessment||{}).map(([k,v])=>detail(({instrumentIdMigration:'Historical instrument IDs',afterHours:'EST after-hours window',midnightSnapshots:'Midnight snapshots',batch:'Batch receiving',comparison:'Production / preview comparison'})[k]||k,v))):null,
    card(txt('h3','Review and deliver'),txt('p','Sources retains the original records and capture scope. Inspection reads every selected source and presents the requested page. Decisions records named review events. Customer columns determines the complete mapped CSV and NDJSON. Delivery keeps the saved reports, full export commands and portable workspace.'),
      row(button('Open sources',()=>go('sources'),{read:true}),button('Review migration scope',()=>go('comparison'),{read:true}),button('Open customer delivery',()=>go('delivery'),{read:true}))),
    card(txt('h3','Published migration rules'),row(link('https://databento.com/blog/nasdaq-historical-data-changes-2026-09','XNAS historical migration'),link('https://databento.com/blog/batch-api-changes-2026-08','Batch API transition')),txt('p','Historical comparisons require a production and preview capture of the same requested scope. Independent sample sessions remain identifiable reference editions.'))];
}

function protectedEdition(){return (draft?.baseConfig.reviews||[]).some(r=>r.editionId===edition()?.id);}
function canReview(){return !historical&&!pending&&reportCurrent()&&!sourceDirty();}
function editScope(key,value){edition().scope[key]=value;changed();}
function scopeEditor(){
  const e=edition(),locked=!editable()||protectedEdition(),s=e.scope;
  return card(txt('h3','Edition and capture scope'),el('div',{class:'grid'},
    field('Edition label',input(e.label||'',{disabled:!editable(),id:'edition-label',oninput:x=>{e.label=x.target.value;changed();}})),
    field('Actual capture timestamp',input(e.capturedAt||'',{disabled:locked,id:'edition-captured-at',oninput:x=>{e.capturedAt=x.target.value;changed();}}),'Preserve the original capture time. A saved review is a separate event.'),
    field('Edition role',select(['reference','baseline','preview'],e.role,{disabled:!editable(),id:'edition-role',onchange:x=>{e.role=x.target.value;changed();render();}})),
    field('Capture environment',select([['public-sample','Published sample'],['historical','Historical production'],['preview','Migration preview']],s.gateway,{disabled:locked,id:'scope-gateway',onchange:x=>editScope('gateway',x.target.value)})),
    field('Dataset',input(s.dataset,{disabled:locked,id:'scope-dataset',oninput:x=>editScope('dataset',x.target.value)})),
    field('Record schema',select(['mbp-1','mbo','definition','status','mixed'],s.schema,{disabled:locked,id:'scope-schema',onchange:x=>editScope('schema',x.target.value)})),
    field('Requested symbols',input((s.symbols||[]).join(', '),{disabled:locked,id:'scope-symbols',oninput:x=>editScope('symbols',x.target.value.split(',').map(v=>v.trim()).filter(Boolean))})),
    field('Input symbology',input(s.stypeIn||'',{disabled:locked,id:'scope-stype',oninput:x=>editScope('stypeIn',x.target.value)})),
    field('Inclusive start',input(s.start||'',{disabled:locked,id:'scope-start',oninput:x=>editScope('start',x.target.value)}),'Original timestamp text, including timezone and nanoseconds.'),
    field('Exclusive end',input(s.end||'',{disabled:locked,id:'scope-end',oninput:x=>editScope('end',x.target.value)})),
    field('Window time field',select(['ts_recv','ts_event'],s.timeField,{disabled:locked,id:'scope-time-field',onchange:x=>editScope('timeField',x.target.value)}))),
    protectedEdition()?txt('p','This edition has saved reviews. Create an edition for changed source inputs; the existing decisions remain attached to their original sources.'):null,
    button('Create edition from selected',()=>{const n=clone(e);n.id='edition-'+crypto.randomUUID();n.label=(e.label||e.id)+' — new review';n.role='reference';delete n.compareToEditionId;draft.config.editions.push(n);draft.config.selectedEdition=n.id;ui.targets=[];ui.focused=null;ui.offset=0;changed();notice('Created a new review edition using the same captures and original capture time. Set its actual scope before adding new inputs.');},{disabled:!editable(),id:'clone-edition'}));
}
async function chooseFiles(files){
  const received=[];for(const f of files){
    if(f.size>8*1024*1024)throw new Error(f.name+' exceeds 8 MiB. Use the original complete partition or compressed source.');
    const b=new Uint8Array(await f.arrayBuffer()),sha=await digest(b),gzip=/\.gz$/i.test(f.name),stem=f.name.replace(/\.gz$/i,'');
    const format=/\.csv$/i.test(stem)?'csv':/\.(jsonl|ndjson)$/i.test(stem)?'dbn-jsonl':'json',ext=format==='csv'?'.csv':format==='dbn-jsonl'?'.jsonl':'.json';
    received.push({name:f.name,id:'source-'+sha.slice(0,16),path:'captures/'+sha+ext+(gzip?'.gz':''),bytes:b.length,sha256:sha,base64:to64(b),format,compression:gzip?'gzip':null,kind:format==='json'?'dbn-metadata':'records',role:'primary',schema:edition().scope.schema,prices:'unknown',timestamps:'unknown',sourceUrl:''});
  }
  ui.attachments=[...ui.attachments,...received.filter(f=>!ui.attachments.some(x=>x.sha256===f.sha256))];persist();notice('Retained '+received.length+' complete file(s) locally. Set their actual representation before attaching them.');
}
function attachSources(){
  if(protectedEdition())throw new Error('Create an edition for the new source inputs before attaching captures.');if(!ui.attachments.length)throw new Error('Choose complete source files first.');
  const e=edition();for(const f of ui.attachments){const old=e.sources.find(s=>s.id===f.id);if(old){if(old.sha256===f.sha256)continue;throw new Error('A source ID already identifies different bytes.');}
    const s={id:f.id,path:f.path,bytes:f.bytes,sha256:f.sha256,format:f.format,kind:f.kind,role:f.role,dataset:e.scope.dataset,schema:f.schema,encoding:{prices:f.prices,timestamps:f.timestamps},representation:{sourceKind:'operator-retained-original-file',sourceUrl:f.sourceUrl||null,dbnVersion:null,upgradePolicy:null,mapSymbols:false},completeness:{status:'unknown'}};
    if(f.compression)s.compression=f.compression;checkMetadata(s);draft.files[f.path]={base64:f.base64,sha256:f.sha256,bytes:f.bytes};e.sources.push(s);
  }
  ui.attachments=[];changed();notice('Added complete captures. Import their exact completeness and corpus descriptor below; native inspection reads every record.');
}
async function sourceDownload(s){const f=(!historical&&draft.files[s.path])||await retainedFile(revision().id,s.path),b=fileBytes(f);if(b.length!==Number(s.bytes)||await digest(b)!==s.sha256)throw new Error('The capture differs from its original descriptor.');saveBytes(b,s.path.split('/').at(-1),s.compression?'application/gzip':s.format==='csv'?'text/csv':'application/json');}
function attachmentControls(){
  return card(txt('h3','Add complete source captures'),txt('p','Choose the original CSV, DBN JSON Lines, metadata or gzip files. The workspace keeps exact source bytes.'),
    field('Original files',el('input',{type:'file',multiple:true,disabled:!editable()||protectedEdition(),id:'source-files',onchange:e=>run(()=>chooseFiles([...e.target.files]))})),
    ...ui.attachments.map((f,i)=>el('div',{class:'inset'},txt('h3',f.name),small(bytes(f.bytes)+' · '+f.sha256),el('div',{class:'grid'},
      field('Source identity',input(f.id,{disabled:!editable(),oninput:e=>{f.id=e.target.value;persist();}})),
      field('Format',select(['csv','dbn-jsonl','json'],f.format,{disabled:!editable(),onchange:e=>{f.format=e.target.value;persist();}})),
      field('Record kind',select(['records','dbn-metadata','symbology','batch-list','batch-details'],f.kind,{disabled:!editable(),onchange:e=>{f.kind=e.target.value;persist();}})),
      field('Source role',select(['primary','reference'],f.role,{disabled:!editable(),onchange:e=>{f.role=e.target.value;persist();}})),
      field('Actual schema',input(f.schema,{disabled:!editable(),oninput:e=>{f.schema=e.target.value;persist();}})),
      field('Price representation',select([['unknown','Not specified'],['decimal-fixed9','Decimal with nine fractional digits'],['integer-nanos','Original scaled integer']],f.prices,{disabled:!editable(),onchange:e=>{f.prices=e.target.value;persist();}})),
      field('Timestamp representation',select([['unknown','Not specified'],['iso8601-nanoseconds','ISO 8601 with nanoseconds'],['integer-nanos','Original integer nanoseconds']],f.timestamps,{disabled:!editable(),onchange:e=>{f.timestamps=e.target.value;persist();}})),
      field('Original URL',input(f.sourceUrl,{disabled:!editable(),oninput:e=>{f.sourceUrl=e.target.value;persist();}}))),
      row(badge(f.compression==='gzip'?'Lossless gzip':'Uncompressed'),button('Remove from draft',()=>{ui.attachments.splice(i,1);persist();},{read:true})))),
    button('Add captures to selected edition',attachSources,{primary:true,disabled:!ui.attachments.length||!!historical||protectedEdition(),id:'attach-sources'}));
}
function editionDescriptor(){
  return card(txt('h3','Import an exact edition descriptor'),txt('p','Use the original acquisition descriptor, including source/corpus hashes, complete partition bounds and capture scope. A new edition ID appends an edition. Referenced files must be saved or attached.'),
    area(ui.newEdition??json(edition()),{class:'wide-json',disabled:!editable(),id:'edition-descriptor',oninput:e=>{ui.newEdition=e.target.value;persist();}}),
    row(button('Apply descriptor',()=>{
      const e=parseJSON(ui.newEdition??json(edition()),'Edition descriptor');if(!e?.id||!e.scope||!Array.isArray(e.sources)||!['reference','baseline','preview'].includes(e.role))throw new Error('Provide the complete edition identity, role, scope and sources.');
      checkMetadata(e);const known=new Map(revision().files.map(f=>[f.path,f]));for(const[p,f]of Object.entries(draft.files))known.set(p,f);
      const additions={};for(const s of e.sources){const f=known.get(s.path)||ui.attachments.find(a=>a.sha256===s.sha256);if(!f||f.sha256!==s.sha256||Number(f.bytes)!==Number(s.bytes))throw new Error('Retain the exact bytes for '+s.id+' first.');if(f.base64)additions[s.path]={base64:f.base64,sha256:f.sha256,bytes:f.bytes};}
      const next=clone(draft.config),i=next.editions.findIndex(x=>x.id===e.id);if(i<0)next.editions.push(e);else next.editions[i]=e;next.selectedEdition=e.id;
      validateConfig(next);checkHistory(draft.baseConfig,next);draft.config=next;Object.assign(draft.files,additions);ui.newEdition=null;ui.attachments=ui.attachments.filter(f=>!e.sources.some(s=>s.sha256===f.sha256));ui.targets=[];changed();notice('Applied the full source descriptor to the local draft.');
    },{primary:true,disabled:!!historical,id:'apply-edition-descriptor'}),button('Use selected descriptor',()=>{ui.newEdition=null;persist();},{read:true})));
}
function acquisitionPlan(){const a=ui.acquisition,e=edition();return {schema:'tj.databento-reviewed-acquisition-scope.v1',editionId:e.id,scope:clone(e.scope),accountProfile:a.profile||null,credentialEnvironmentVariable:a.keyEnv||'DATABENTO_API_KEY',operationId:a.operationId||null,comparisonBaseline:e.compareToEditionId||null};}
function acquisitionPanel(){
  const a=ui.acquisition,set=(k,v)=>{a[k]=v;persist();};
  return card(txt('h3','Account and batch receiving'),txt('p','The original acquisition client retains account metadata, exact-scope quotes, full batch details, downloads/resume and AS_IS DBN projection. Import its source descriptors here.'),
    el('div',{class:'grid'},
      field('Private account profile label',input(a.profile||'',{id:'account-profile',oninput:e=>set('profile',e.target.value)}),'A label for the selected account; enter no key here.'),
      field('Credential environment variable name',input(a.keyEnv||'DATABENTO_API_KEY',{id:'credential-env',oninput:e=>set('keyEnv',e.target.value)})),
      field('Existing acquisition operation ID',input(a.operationId||'',{id:'acquisition-operation',oninput:e=>set('operationId',e.target.value)}),'Keep the existing identity when recovering a request.')),
    row(button('Download exact reviewed scope',()=>{const p=acquisitionPlan();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.credentialEnvironmentVariable))throw new Error('Use an environment variable name.');saveBytes(enc.encode(json(p)+'\n'),'databento-reviewed-scope.json','application/json');},{read:true,id:'download-acquisition-scope'}),
      button('Inspect batch/source inventory',()=>startPreview('inspect_migration','sources',0),{disabled:!!historical})),
    detail('Original client entrypoint','python3 acquisition.py --help\n'),detail('Reviewed scope',acquisitionPlan()),
    reportCurrent()&&report().assessment?.batch?detail('Retained batch assessment',report().assessment.batch):null,
    txt('p','The compact job list identifies jobs. A matching batch-details response supplies full state. Actual provider responses determine dataset charges and file coverage.'));
}
function sources(){
  const e=edition();return [heading('Retained source inventory','Keep complete captures, definitions, status and batch responses with their original scope.',inspectButton()),scopeEditor(),
    card(txt('h3','Files in the selected edition'),table(['Source','Representation and scope','Original identity','Actions'],e.sources.map(s=>[
      el('div',{},txt('strong',s.id),small(s.kind+' · '+s.role),small(s.schema||e.scope.schema)),
      el('div',{},badge(s.format+(s.compression?' / '+s.compression:'')),small(fmt(s.completeness?.status)),s.completeness?.records!==undefined?small(count(s.completeness.records)+' declared records'):null,detail('Complete descriptor',s)),
      el('div',{},small(bytes(s.bytes)),mono(s.sha256),small(s.path)),
      row(button('Download original',()=>sourceDownload(s),{read:true}),button('Review source',()=>{addTarget('source',s.id,s.id);go('decisions');},{disabled:!reviewEnabled()}))
    ]))),attachmentControls(),editionDescriptor(),acquisitionPanel()];
}
function addTarget(type,id,label){if(!canReview())throw new Error('Inspect the selected saved sources before review.');if(!id)throw new Error('The result has no target identity.');const t={type,id:String(id),label:label||String(id)};if(!ui.targets.some(x=>x.type===t.type&&x.id===t.id))ui.targets.push(t);persist();}
function inspectItems(){return reportCurrent()&&output?.page?output.page.items||[]:[];}
function openItem(item){ui.focused=clone(item);persist();}
function inspectionRows(view,items){
  if(view==='records')return table(['Original record','Event and session','Instrument','Price and flags','Review target'],items.map(r=>[
    el('div',{},button(r.id,()=>openItem(r),{read:true}),small(r.sourceId+' · row '+r.row),small(r.schema+' · '+r.role)),
    el('div',{},mono(r.time?.event?.raw),small('ns '+fmt(r.time?.event?.ns)),small(fmt(r.time?.newYorkDate)+' '+fmt(r.time?.newYorkTime)+' · '+fmt(r.time?.session))),
    el('div',{},mono(r.identity?.key),small(r.identity?.rawSymbol),small('Exchange ID '+fmt(r.identity?.rawInstrumentId))),
    el('div',{},mono(r.prices?.price?.raw),small('atomic '+fmt(r.prices?.price?.atomic)),small('state '+fmt(r.prices?.price?.state)),small('flags '+fmt(r.flags?.raw))),
    row(button('Instrument',()=>addTarget('instrument',r.identity?.key,r.identity?.rawSymbol),{disabled:!reviewEnabled()}),button('Source',()=>addTarget('source',r.sourceId,r.sourceId),{disabled:!reviewEnabled()}))
  ]),'inspection-table');
  if(view==='instruments')return table(['Instrument','Symbols and exchange IDs','Records','Event window','Review'],items.map(i=>[
    button(i.id,()=>openItem(i),{read:true}),el('div',{},small((i.rawSymbols||[]).join(', ')),mono((i.rawInstrumentIds||[]).join(', ')),small('Currencies '+(i.currencies||[]).join(', '))),
    el('div',{},count(i.records),small(count(i.primaryRecords)+' primary / '+count(i.referenceRecords)+' reference')),el('div',{},mono(i.firstEventNs),small('→ '+fmt(i.lastEventNs))),
    button('Select instrument',()=>addTarget('instrument',i.id,(i.rawSymbols||[]).join(', ')),{disabled:!reviewEnabled()})
  ]),'inspection-table');
  if(view==='findings')return table(['Finding','Assessment','Observed references','Review'],items.map(f=>[
    el('div',{},button(f.code||f.id,()=>openItem(f),{read:true}),badge(f.severity)),el('div',{},txt('p',f.message),small('Count '+count(f.count))),el('div',{},mono(f.sourceId),detail('Examples',f.examples||[])),
    button('Select finding',()=>addTarget('finding',f.id,f.code||f.id),{disabled:!reviewEnabled()})
  ]),'inspection-table');
  if(view==='sessions')return table(['Session','Source scope','Records','Boundary observations','Details'],items.map(s=>[
    el('div',{},txt('strong',s.session),small('New York '+fmt(s.newYorkDate))),el('div',{},mono(s.dataset+' / '+s.publisherId),small('UTC '+fmt(s.utcDate))),
    el('div',{},count(s.records),small(count(s.primaryRecords)+' primary / '+count(s.referenceRecords)+' reference')),small(count(s.estAfterHoursRecords)+' EST after-hours / '+count(s.utcMidnightRecords)+' UTC midnight'),
    button('Open session',()=>openItem(s),{read:true})
  ]),'inspection-table');
  if(view==='sources')return table(['Source','Observed coverage','Original identity','Review'],items.map(s=>[
    el('div',{},button(s.id||s.sourceId||s.originalDescriptor?.id,()=>openItem(s),{read:true}),small(s.kind||s.originalDescriptor?.kind)),
    el('div',{},small(count(s.records??s.observedRecords)+' records'),detail('Original scope and observations',s)),
    mono(s.sha256||s.originalDescriptor?.sha256),button('Select source',()=>addTarget('source',s.id||s.sourceId||s.originalDescriptor?.id,s.id||s.sourceId),{disabled:!reviewEnabled()})
  ]),'inspection-table');
  return table(['Change','Original identity and comparison'],items.map((x,i)=>[button(x.type||x.change||x.id||'Change '+(Number(ui.offset)+i+1),()=>openItem(x),{read:true}),detail('Complete change record',x)]),'inspection-table');
}
function inspection(){
  const page=reportCurrent()?output?.page:null,items=inspectItems(),next=page?.nextOffset,prev=Math.max(0,(page?.offset||0)-Number(ui.limit));
  return [heading('Complete-source inspection','The assessment processes selected sources in full. Pages select the records shown in the interface.',inspectButton()),banner(),
    card(el('div',{class:'toolbar'},field('View',select(VIEWS,ui.view,{id:'inspection-view',onchange:e=>{ui.view=e.target.value;ui.offset=0;ui.focused=null;persist();}})),
      field('First row offset',input(ui.offset,{type:'number',min:0,step:1,id:'inspection-offset',oninput:e=>{ui.offset=e.target.value;persist();}})),
      field('Rows per page',select([['25','25'],['50','50'],['100','100'],['250','250']],String(ui.limit),{id:'inspection-limit',onchange:e=>{ui.limit=Number(e.target.value);persist();}}))),
      row(button(dirty()?'Save & load view':'Load view',()=>{const n=Number(ui.offset);if(!Number.isSafeInteger(n)||n<0)throw new Error('Use a nonnegative whole-number offset.');return startPreview('inspect_migration',ui.view,n);},{primary:true,disabled:!!historical,id:'load-view'}),button('Review '+ui.targets.length+' selected targets',()=>go('decisions'),{read:true,disabled:!ui.targets.length}))),
    page?card(txt('h3',VIEWS.find(v=>v[0]===page.view)?.[1]||page.view),
      row(small('Showing '+count(items.length?page.offset+1:page.offset)+'–'+count(page.offset+items.length)+' of '+count(page.total)+' · '+count(report().summary.totalRecords)+' records processed'),
        button('Previous',()=>startPreview('inspect_migration',page.view,prev),{disabled:!!historical||page.offset===0,id:'previous-page'}),
        button('Next',()=>startPreview('inspect_migration',page.view,next),{disabled:!!historical||!page.hasMore,id:'next-page'})),
      page.byteLimited?txt('p','This page reached the response byte limit. Next continues from the next undisplayed record.'):null,items.length?inspectionRows(page.view,items):empty('No items at this offset.')):empty('Load a view to open its saved records.'),
    ui.focused?card(txt('h3','Complete selected item'),detail(ui.focused.id||'Original record',ui.focused),button('Download selected item',()=>saveBytes(enc.encode(json(ui.focused)+'\n'),'databento-selected-item.json','application/json'),{read:true}),txt('p','Nanosecond timestamps and exact prices remain strings. Unknown and undefined values retain their original states.')):null];
}
function comparison(){
  const e=edition(),r=reportCurrent()?report():null,b=config().editions.find(x=>x.id===e.compareToEditionId),fields=['dataset','schema','symbols','stypeIn','start','end','timeField'];
  return [heading('Migration comparison','Compare explicit historical production and preview captures of the same requested scope.',inspectButton()),
    card(txt('h3','Selected capture pair'),dl([['Selected role / environment',fmt(e.role)+' / '+fmt(e.scope.gateway)],['Selected baseline',b?.label||b?.id||'None'],['Baseline environment',b?.scope.gateway||'None']]),
      field('Production baseline',select([['','No baseline'],...config().editions.filter(x=>x.id!==e.id&&x.role==='baseline').map(x=>[x.id,x.label||x.id])],e.compareToEditionId||'',{disabled:!editable(),id:'comparison-baseline',onchange:x=>{if(x.target.value)e.compareToEditionId=x.target.value;else delete e.compareToEditionId;changed();render();}})),
      b?table(['Scope field','Selected edition','Baseline'],fields.map(k=>[k,mono(e.scope[k]),mono(b.scope[k])])):txt('p','Published sample editions are identifiable reference scopes. Add original production and preview captures for the migration comparison.')),
    banner(),r?card(txt('h3','Observed comparison'),detail('Native comparison result',r.assessment.comparison),button('Open complete change view',()=>startPreview('inspect_migration','changes',0),{disabled:!!historical,id:'inspect-changes'})):null,
    r?card(txt('h3','Specific migration rules'),detail('Pre-2023 instrument identity',r.assessment.instrumentIdMigration),detail('EST after-hours hour',r.assessment.afterHours),detail('Midnight snapshot flags',r.assessment.midnightSnapshots)):null,
    card(txt('h3','Scope used by this application'),txt('p','Instrument identity includes dataset, publisher and UTC date. Exchange raw_instrument_id stays separate. Windows are half open and use the retained time field. Missing fields and status values remain as observed.'),
      txt('p','The report identifies rule applicability for the captured dates and observed changes between eligible captures. The complete customer export uses the same sources and saved field mapping.'))];
}

function appendDecisions(){
  if(!canReview())throw new Error('Inspect the selected saved source before recording decisions.');
  const reviewer=ui.reviewer.trim();if(!reviewer)throw new Error('Enter the actual reviewer name.');if(!ui.targets.length)throw new Error('Select actual source, instrument or finding targets first.');if(!['accept','revisit','exclude'].includes(ui.decision))throw new Error('Choose a supported decision.');
  const at=new Date().toISOString();for(const t of ui.targets){
    if(!['source','instrument','finding','edition'].includes(t.type))throw new Error('Unsupported review target.');
    if(t.type==='source'&&!edition().sources.some(s=>s.id===t.id))throw new Error('The source target is outside the selected edition.');
    if(t.type==='edition'&&t.id!==edition().id)throw new Error('The edition target differs from the selected edition.');
    draft.config.reviews.push({id:'review-'+crypto.randomUUID(),editionId:edition().id,targetType:t.type,targetId:t.id,decision:ui.decision,reviewer,at,note:ui.note});
  }
  notice('Appended '+ui.targets.length+' named '+ui.decision+' decision(s). Save and build to produce the corresponding customer output.');ui.targets=[];changed();
}
function decisions(){
  const events=(config().reviews||[]).filter(r=>r.editionId===edition().id),latest=new Map();for(const r of events)latest.set(r.targetType+':'+r.targetId,r.id);
  return [heading('Named review decisions','Review the selected edition and preserve each decision in its original order.',inspectButton()),banner(),
    card(txt('h3','Selected review targets'),ui.targets.length?table(['Type','Target','Selection'],ui.targets.map((t,i)=>[badge(t.type),el('div',{},txt('strong',t.label),mono(t.id)),button('Remove',()=>{ui.targets.splice(i,1);persist();},{read:true})])):empty('Select targets in Sources or Inspection, or select the whole edition below.'),
      row(button('Select this edition',()=>addTarget('edition',edition().id,edition().label||edition().id),{disabled:!reviewEnabled(),id:'review-edition'}),button('Select all current sources',()=>{for(const s of edition().sources)addTarget('source',s.id,s.id);},{disabled:!reviewEnabled(),id:'review-all-sources'}),button('Clear selection',()=>{ui.targets=[];persist();},{read:true}))),
    card(txt('h3','Append a decision'),el('div',{class:'grid'},
      field('Reviewer',input(ui.reviewer,{disabled:!reviewEnabled(),id:'reviewer',oninput:e=>{ui.reviewer=e.target.value;persist();}})),
      field('Decision',select([['accept','Accept'],['revisit','Revisit'],['exclude','Exclude']],ui.decision,{disabled:!reviewEnabled(),id:'review-decision',onchange:e=>{ui.decision=e.target.value;persist();}})),
      field('Operator note',area(ui.note,{disabled:!reviewEnabled(),id:'review-note',oninput:e=>{ui.note=e.target.value;persist();}}),'Names and notes remain in the operator handoff.',true)),
      button('Append decision for '+ui.targets.length+' target(s)',appendDecisions,{primary:true,disabled:!reviewEnabled()||!ui.targets.length,id:'append-review'}),
      txt('p','The last decision for the exact edition and target applies. Source and instrument exclusions remove their primary records from the customer data, with the exact excluded count in the report. Revisit and unreviewed records remain visible.')),
    card(txt('h3','Selected-edition decision history'),events.length?table(['Recorded decision','Target','Reviewer and time','Operator note'],events.map(r=>[
      el('div',{},badge(r.decision,latest.get(r.targetType+':'+r.targetId)===r.id),small(latest.get(r.targetType+':'+r.targetId)===r.id?'Current for this target':'Previous decision')),
      el('div',{},small(r.targetType),mono(r.targetId)),el('div',{},txt('strong',r.reviewer),small(r.at)),r.note||'—'
    ])):empty('No decisions have been saved for this edition.')),
    row(button('Save & build operator files',()=>startPreview('build_migration'),{primary:true,disabled:!!historical,id:'build-reviewed-output'}),button('Open customer columns',()=>go('mapping'),{read:true}))];
}
function validateColumns(columns){
  if(!Array.isArray(columns)||!columns.length)throw new Error('Keep at least one customer column.');const names=new Set();
  for(const c of columns){if(typeof c.name!=='string'||!c.name.trim()||names.has(c.name))throw new Error('Customer column names must be nonempty and unique.');names.add(c.name);
    const p=c.path;if(typeof p!=='string'||/~/g.test(p.replace(/~[01]/g,''))||!(['/id','/sourceId','/row','/schema','/review/decision'].includes(p)||/^\/(?:identity|time|prices|flags|record)\/.+/.test(p)))throw new Error('Choose a public record pointer for '+c.name+'. Operator review names and notes are not customer columns.');
  }
}
function pointer(value,path){if(typeof path!=='string'||!path.startsWith('/'))return undefined;for(const part of path.slice(1).split('/').map(p=>p.replaceAll('~1','/').replaceAll('~0','~'))){if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return undefined;value=value[part];}return value;}
const pointerPart=p=>String(p).replaceAll('~','~0').replaceAll('/','~1');
function availablePointers(value){
  const out=[];function visit(v,p,depth){if(depth>12)return;if(v===null||typeof v!=='object'){out.push({path:p,value:v});return;}if(Array.isArray(v)){v.forEach((x,i)=>visit(x,p+'/'+i,depth+1));return;}for(const[k,x]of Object.entries(v))visit(x,p+'/'+pointerPart(k),depth+1);}
  for(const k of ['identity','time','prices','flags','record'])if(value?.[k])visit(value[k],'/'+k,0);
  out.unshift(...['id','sourceId','row','schema'].map(k=>({path:'/'+k,value:value?.[k]})));out.push({path:'/review/decision',value:value?.review?.decision});return out;
}
function mapping(){
  const columns=config().outputColumns,sample=ui.focused?.identity?ui.focused:inspectItems().find(x=>x.identity),choices=sample?availablePointers(sample):[];
  return [heading('Customer column mapping','Select fields from the original normalized record. The complete exporter uses these exact names and pointers.',
    button('Save & build customer reports',()=>startPreview('customer_migration'),{primary:true,disabled:!!historical,id:'build-customer-reports'})),
    card(txt('h3','Output columns'),table(['Customer column name','Original record pointer','Order'],columns.map((c,i)=>[
      input(c.name,{disabled:!editable(),'aria-label':'Column '+(i+1)+' name',oninput:e=>{c.name=e.target.value;changed();}}),
      input(c.path,{disabled:!editable(),class:'code','aria-label':'Column '+(i+1)+' source pointer',oninput:e=>{c.path=e.target.value;changed();}}),
      row(button('Up',()=>{[columns[i-1],columns[i]]=[columns[i],columns[i-1]];changed();},{disabled:!!historical||i===0}),button('Down',()=>{[columns[i],columns[i+1]]=[columns[i+1],columns[i]];changed();},{disabled:!!historical||i===columns.length-1}),button('Remove',()=>{columns.splice(i,1);changed();},{disabled:!!historical||columns.length===1}))
    ]),'mapping-table'),
      row(button('Add column',()=>{columns.push({name:'column_'+(columns.length+1),path:'/record/'});changed();},{disabled:!!historical,id:'add-column'}),button('Use standard columns',()=>{draft.config.outputColumns=clone(DEFAULT_COLUMNS);changed();},{disabled:!!historical}),button('Use saved mapping',()=>{draft.config.outputColumns=clone(draft.baseConfig.outputColumns);changed();},{disabled:!!historical}),button('Download column map',()=>{validateColumns(columns);saveBytes(enc.encode(json(columns)+'\n'),'databento-output-columns.json','application/json');},{read:true})),
      txt('p','Missing values remain empty CSV cells or JSON null. Timestamps, IDs and exact atomic prices remain text. Review decisions can be selected; operator review names and notes remain private.')),
    sample?card(txt('h3','Selected original record preview'),small(sample.id+' · '+sample.sourceId),
      table(['Output name','Mapped original value'],columns.map(c=>[c.name,mono(pointer(sample,c.path))])),
      detail('Complete original normalized record',sample)):card(txt('h3','Inspect an original record'),txt('p','Open a record in Inspection to preview its actual mapped values and select any of its original fields.'),button('Open records',()=>startPreview('inspect_migration','records',0),{disabled:!!historical})),
    choices.length?card(txt('h3','Fields from the selected record'),table(['Source pointer','Original value','Mapping'],choices.map(p=>[
      mono(p.path),mono(p.value),button('Add field',()=>{const stem=p.path.split('/').filter(Boolean).slice(-2).join('_').replace(/~[01]/g,'_');let name=stem||'field',n=2;while(columns.some(c=>c.name===name))name=stem+'_'+n++;columns.push({name,path:p.path});changed();},{disabled:!!historical})
    ]))):null];
}
function deliveryPlan(audience='operator'){
  if(!preview||preview.status!=='COMPLETED'||preview.function!=='build_migration')throw new Error('Open a completed operator build from the operation history for the complete source-bound handoff.');
  const d=ui.delivery,root=(d.sourceRoot||'/path/to/original-source').replace(/\/$/,''),dir=d.directory||'./databento-workbench',out=d.output||'./databento-delivery';
  const argv=['node',root+'/stellar/scf-starforge-20261009/sf30-seller-sdk/databento/workbench.mjs','handoff','--source-root',root,'--dir',dir,'--preview',preview.id,'--out',out,'--audience',audience];if(d.python)argv.push('--python',d.python);
  return '# Saved revision '+preview.revisionId+'\n# Edition '+report().edition.id+'\n# Completed build '+preview.id+'\n# Output directory must be new. The selected build supplies the saved source.\n'+argv.map(shell).join(' ')+'\n';
}
function delivery(){
  const files=output?.files||[],privateNames=new Set(['migration-report.json','review-decisions.json']);
  const fileTable=selected=>table(['Saved file','Complete identity','Download'],selected.map(f=>[
    txt('strong',f.name),el('div',{},small(bytes(f.bytes)),mono(f.sha256)),button('Download '+f.name,()=>saveBytes(enc.encode(f.body),f.name,f.contentType||'application/octet-stream'),{read:true,id:'download-'+f.name.replaceAll('.','-')})
  ]));
  const d=ui.delivery,set=(k,v)=>{d[k]=v;persist();};
  let command,error;try{command=deliveryPlan(d.audience||'operator');}catch(e){error=e.message;}
  return [heading('Customer delivery and operator handoff','Reopen complete saved reports and export every mapped record from the selected source revision.',
    button(dirty()?'Save & build operator files':'Build operator files',()=>startPreview('build_migration'),{primary:true,disabled:!!historical,id:'build-operator-files'}),button('Build customer reports',()=>startPreview('customer_migration'),{disabled:!!historical,id:'build-customer-only'})),banner(),
    preview?.result?card(txt('h3','Selected saved output'),dl([['Operation',mono(preview.id)],['Source revision',mono(preview.revisionId)],['Function',preview.function],['Edition',report()?.edition?.id||'—'],['Complete output',bytes(preview.result.bytes)],['SHA256',mono(preview.result.sha256)]]),
      button('Download complete native output',()=>download('/api/preview-output?id='+encodeURIComponent(preview.id),'databento-operation-output.json'),{read:true,id:'download-native-output'})):null,
    files.length?card(txt('h3','Customer report files'),txt('p','These exact files contain the customer summary, original source index, output map and delivery instructions. Full mapped CSV and NDJSON are generated by the complete export below.'),fileTable(files.filter(f=>!privateNames.has(f.name)))):empty('Build the saved source to create its complete report files.'),
    files.some(f=>privateNames.has(f.name))?card(txt('h3','Operator report and review history'),txt('p','Keep these reports and named review notes with the operator handoff.'),fileTable(files.filter(f=>privateNames.has(f.name)))):null,
    card(txt('h3','Export the full mapped dataset'),txt('p','This command selects the existing completed build, opens its saved source and streams every included primary record into complete CSV and NDJSON files. The final manifest records exact source and output identities.'),
      report()?.dataExport?dl([['Candidate primary records',count(report().dataExport.candidateRecords)],['Customer records',count(report().dataExport.customerRecords)],['Excluded records',count(report().dataExport.excludedRecords??report().summary.excludedPrimaryRecords)]]):null,
      el('div',{class:'grid'},
        field('Original source root',input(d.sourceRoot||'',{id:'delivery-source-root',placeholder:'/path/to/original-source',oninput:e=>set('sourceRoot',e.target.value)})),
        field('Existing workbench directory',input(d.directory||'',{id:'delivery-directory',placeholder:'./databento-workbench',oninput:e=>set('directory',e.target.value)}),'The directory created by the workbench, containing its workspace/ store.'),
        field('New output directory',input(d.output||'',{id:'delivery-output',placeholder:'./databento-delivery',oninput:e=>set('output',e.target.value)})),
        field('Delivery audience',select([['operator','Complete operator and customer handoff'],['customer','Customer files only']],d.audience||'operator',{id:'delivery-audience',onchange:e=>{set('audience',e.target.value);render();}})),
        field('Python executable (optional)',input(d.python||'',{id:'delivery-python',oninput:e=>set('python',e.target.value)}))),
      row(button('Refresh export command',()=>{persist();notice('Export command uses the displayed saved build and current directory selections.');},{read:true}),button('Download full export command',()=>saveBytes(enc.encode(deliveryPlan(d.audience||'operator')),'databento-complete-export.txt','text/plain'),{read:true,disabled:!!error,id:'download-full-export-command'})),
      error?txt('p',error):detail('Exact saved-build export command',command)),
    card(txt('h3','Portable workspace'),txt('p','The complete operator export retains source captures, code, revisions, decisions and original operation results. Import it into a new workbench directory to reopen the same history.'),
      row(button('Download complete workspace',()=>download('/api/export','databento-migration.python-workspace.json'),{read:true,id:'export-workspace'}),
        button('Download receiving commands',()=>{
          const root=(d.sourceRoot||'/path/to/original-source').replace(/\/$/,''),entry=root+'/stellar/scf-starforge-20261009/sf30-seller-sdk/databento/workbench.mjs';
          const lines=[['node',entry,'import','--source-root',root,'--dir','./received-databento-workbench','--bundle','databento-migration.python-workspace.json'],['node',entry,'serve','--source-root',root,'--dir','./received-databento-workbench']];
          saveBytes(enc.encode(lines.map(a=>a.map(shell).join(' ')).join('\n')+'\n'),'databento-receiving-commands.txt','text/plain');
        },{read:true}))),
    operationHistory()];
}
function operationHistory(){
  const previews=state.previews.filter(p=>FUNCTIONS.has(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return previews.length?card(txt('h3','Saved operation history'),table(['Operation','Source revision','Status','Created','Open'],previews.map(p=>[
    el('div',{},txt('strong',p.function),small(p.id)),mono(p.revisionId),badge(p.status),p.createdAt,button('Open result',()=>openPreview(p.id),{read:true,id:'open-preview-'+p.id})
  ]))):null;
}
function mergeValue(base,local,remote,path,conflicts){
  if(same(local,base))return clone(remote);if(same(remote,base)||same(local,remote))return clone(local);
  if(path==='reviews'&&Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)&&same(local.slice(0,base.length),base)&&same(remote.slice(0,base.length),base)){
    const mine=local.slice(base.length),theirs=remote.slice(base.length),key=r=>r.editionId+'|'+r.targetType+'|'+r.targetId;
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
  await mutate('/api/restore',{expectedHead:state.workspace.head,revisionId:selected.id,note:'Restore Databento source '+selected.id+' [databento-restore-'+crypto.randomUUID()+']'},'restore');
  state=await api('/api/state');await adoptHead();draft.previous=previous;persist();notice('Restored the selected source as a new revision. Original history is preserved.');
}
function historyView(){
  return [heading('History and source recovery','Reopen saved editions and results, merge local edits and restore prior source as a new revision.'),
    historical?card(txt('h3','Historical source '+short(revision().id)),txt('p',revision().note||''),
      row(button('Return to working draft',()=>{historical=null;ui.configuration=null;ui.focused=null;ui.targets=[];persist();},{read:true,id:'return-to-draft'}),button('Restore as a new revision',restoreHistorical,{primary:true,id:'restore-revision'}))):null,
    card(txt('h3','Working local draft'),dl([['Based on',mono(draft.base.id)],['Current saved head',mono(state.workspace.head)],['Unsaved changes',String(dirty())],['Draft persistence',storageFailure?storageFailure.message:'Stored with this browser workspace']]),
      field('Revision note',input(ui.revisionNote,{disabled:!editable(),id:'revision-note',oninput:e=>{ui.revisionNote=e.target.value;changed();}})),
      row(button('Download local draft',()=>saveBytes(enc.encode(json(snapshot())+'\n'),'databento-local-operator-draft.json','application/json'),{read:true,id:'download-local-draft'}),
        button('Merge with current source',mergeLatest,{disabled:!!historical||!dirty()||draft.base.id===state.workspace.head,id:'merge-current'}),
        button('Use current saved source',async()=>{state=await api('/api/state');await adoptHead(dirty());notice('Opened current saved source. A previous local draft remains recoverable below.');},{read:true})),
      draft.previous?button('Recover previous local draft',()=>{const p=clone(draft.previous);draft=p;historical=null;ui.configuration=null;ui.targets=[];persist();notice('Recovered the prior local draft. Merge it with the current revision when needed.');},{read:true}):null),
    card(txt('h3','Saved source revisions'),table(['Revision','Created','Note','Source','Open'],[...state.revisions].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>[
      el('div',{},mono(r.id),r.id===state.workspace.head?badge('Current'):null),r.createdAt,r.note||'—',small(count(r.files)+' files · '+bytes(r.bytes)),button('Open revision',()=>openHistorical(r.id),{read:true,id:'open-revision-'+r.id})
    ]))),
    card(txt('h3','Complete workspace configuration'),txt('p','Apply a complete configuration while preserving original review history. Saved capture and application files stay in the same workspace.'),
      area(ui.configuration??json(config()),{class:'wide-json',disabled:!editable(),id:'workspace-json',oninput:e=>{ui.configuration=e.target.value;persist();}}),
      button('Apply configuration to draft',()=>{const c=parseJSON(ui.configuration??json(config()),'Workspace configuration');validateConfig(c);checkMetadata(c);checkHistory(draft.baseConfig,c);validateColumns(c.outputColumns);draft.config=c;ui.configuration=null;ui.targets=[];changed();notice('Applied the complete configuration to the local draft.');},{disabled:!!historical,id:'apply-workspace-json'}),
      ui.latestConfiguration?detail('Current saved configuration for merge',ui.latestConfiguration):null,detail('Saved source file identities',revision().files)),
    operationHistory(),pending?detail('Retained pending operation',pending):null];
}
function render(){
  if(!state||!draft)return;renderTop();
  $('#navigation').replaceChildren(...TABS.map(([id,label])=>el('button',{type:'button','aria-current':ui.tab===id?'page':null,onclick:()=>go(id)},label)));
  const views={overview,sources,inspection,comparison,decisions,mapping,delivery,history:historyView};
  $('#content').replaceChildren(...(views[ui.tab]||overview)().filter(Boolean));
}
async function boot(){
  if(!token)throw new Error('Open the complete operator URL printed by the Databento workbench serve command.');
  state=await api('/api/state');namespace=state.workspace.id+':databento-operator';store=createDraftStore(namespace);
  const[saved,request]=await Promise.all([store.readDraft(),store.readPending()]);
  if(saved?.schema==='tj.databento-operator-draft.v1'&&saved.workspaceId===namespace&&saved.draft?.base?.id&&state.revisions.some(r=>r.id===saved.draft.base.id)){
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
