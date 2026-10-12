// Records operator over the original Python workspace and reconciliation engine.
import {createDraftStore} from '/local-draft-store.mjs';
const $=s=>document.querySelector(s),clone=v=>structuredClone(v),json=v=>JSON.stringify(v,null,2),enc=new TextEncoder();
const SCHEMA='tj.records-operator-workspace.v1';
const RESULTS=new Set(['tj.records-operator-inspection.v1','tj.records-operator-build.v1','tj.records-operator-customer.v1']);
const FUNCTIONS=new Set(['inspect_records','build_records','customer_records']);
const TABS=[['overview','Overview'],['sources','Sources & contracts'],['inspection','Reconciliation'],['transition','Inventory & transfer'],['cooperative','Monthly reporting'],['requirements','Requirements & catalog'],['delivery','Customer handoff'],['history','History']];
const VIEWS=[['findings','Findings'],['customer-invoices','Customer projection'],['invoices','Invoice rows'],['rates','Contract rates'],['sites','Sites'],['cartons','Cartons'],['events','Service events'],['sources','Source files'],['input-errors','Input corrections'],['changes','Edition changes'],['reviews','Review history'],['transition','Inventory assignments'],['checks','Transfer checkpoints'],['cooperative','Monthly agency rows'],['cooperative-basis','Monthly basis rows'],['requirements','Technical questions'],['catalog','Cost catalog']];
const DEFAULT_COLUMNS=[['Invoice','/values/invoice_ref'],['InvoiceLine','/values/row_id'],['ChargeCode','/values/charge_code'],['Carton','/values/carton_ref'],['Quantity','/values/quantity'],['Unit','/values/unit'],['BilledMinor','/values/amount_minor'],['ExpectedMinor','/analysis/expectedAmountMinor'],['VarianceMinor','/analysis/varianceMinor'],['EngineStates','/analysis/states'],['ReviewStatus','/analysis/reviewStatus'],['Source','/_source/id'],['SourceSHA256','/_source/sha256']].map(([name,path])=>({name,path}));
const fmt=v=>v===null||v===undefined||v===''?'—':typeof v==='object'?JSON.stringify(v):String(v);
const short=v=>v?String(v).slice(0,14):'—', bytes=v=>Number.isFinite(Number(v))?Number(v).toLocaleString()+' B':'—';
const count=v=>Number.isFinite(Number(v))?Number(v).toLocaleString():'—';
const terminal=status=>!['QUEUED','RUNNING'].includes(status),same=(a,b)=>canonical(a)===canonical(b);
function el(tag,attrs={},...children){
  const n=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs)){if(v===null||v===undefined||v===false)continue;
    if(k.startsWith('on')&&typeof v==='function')n.addEventListener(k.slice(2),event=>{try{const result=v(event);if(result&&typeof result.catch==='function')result.catch(error=>notice(error.message||String(error),true));}catch(error){notice(error.message||String(error),true);}});
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
let ui={tab:'overview',view:'findings',offset:0,limit:100,query:'',exactId:'',focused:null,targets:[],revisionNote:'',configuration:null,newEdition:null,newPeriod:null,attachments:[],sourceId:null,sourceDraft:null,rawFile:null,review:{status:'open',owner:'',note:'',evidence:[]},correction:null,waveId:null,assignment:{},checkpoint:{kind:'manifest',status:'pending',owner:'',note:'',evidence:[]},cooperativeDraft:null,requirement:null,columns:null,delivery:{},pageCache:{},mappingSample:null};
const fileCache=new Map();
const config=()=>historical?.config||draft?.config,revision=()=>historical?.revision||draft?.base;
const period=()=>config()?.periods.find(p=>p.id===config().selectedPeriod);
const edition=()=>period()?.editions.find(e=>e.id===period().selectedEdition);
const dirty=()=>Boolean(draft&&(!same(draft.config,draft.baseConfig)||Object.keys(draft.files).length||ui.revisionNote.trim()));
const editable=()=>!historical&&!busy&&!pending;
const report=()=>output?.report||null;
const reportCurrent=()=>Boolean(report()&&preview?.revisionId===revision()?.id&&report().period?.id===period()?.id&&report().edition?.id===edition()?.id);
const sourceDirty=()=>!same(draft?.config.periods,draft?.baseConfig.periods);
const reviewEnabled=()=>editable()&&reportCurrent()&&!sourceDirty()&&Boolean(report()?.reconciliation?.requestSha256);
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
function snapshot(){return {schema:'tj.records-operator-draft.v1',workspaceId:namespace,draft:clone(draft),ui:clone(ui)};}
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


const TABLE_FIELDS={
 sites:['site_ref','active_from','active_until'],
 rates:['charge_code','unit','scope','rate_minor','event_required','effective_from','effective_until','pricing','pricing.kind','pricing.minimum_minor','pricing.maximum_minor','pricing.percent','pricing.basis_scope','pricing.basis_charge_codes','pricing.tiers','pricing.credit_method'],
 cartons:['carton_ref','site_ref','admitted_at','terminated_at','termination_kind','evidence_ref','evidence_sha256'],
 events:['event_id','site_ref','carton_ref','charge_code','occurred_at','quantity','unit','evidence_ref','evidence_sha256'],
 invoices:['row_id','invoice_ref','site_ref','carton_ref','event_id','charge_code','service_at','quantity','unit','rate_minor','amount_minor','evidence_ref','evidence_sha256','line_kind','row_role','credit_of','basis_row_ids','billed_at','billed_percent']
};
const REVIEW_STATUSES=['open','accepted','dispute-prepared','resolved-in-source','revisit'];
const ASSIGNMENT_STATUSES=['planned','ready','in-transit','received','reconciled','exception'];
const CHECK_KINDS=['manifest','custody-transfer','destination-receipt','inventory-reconciliation','access-handoff'];
const CHECK_STATUSES=['pending','accepted','rejected'];
const utcNow=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
function required(value,label){if(typeof value!=='string'||!value.trim())throw new Error(label+' is required.');return value;}
function utcText(value,label){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value||'')||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().replace('.000Z','Z')!==value)throw new Error(label+' must be an exact whole-second UTC timestamp.');return value;}
function safeInteger(value,label){if(!/^-?(?:0|[1-9]\d*)$/.test(String(value)))throw new Error(label+' must be a whole minor-unit integer.');const n=Number(value);if(!Number.isSafeInteger(n))throw new Error(label+' is outside the original exact integer range.');return n;}
function decimalText(value,label){if(!/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(String(value)))throw new Error(label+' must be exact decimal text, with up to 18 fractional places.');return String(value);}
function validateColumns(columns){if(!Array.isArray(columns)||columns.length>100)throw new Error('Choose at most 100 output columns.');const names=new Set();for(const c of columns){required(c.name,'Output column name');if(names.has(c.name))throw new Error('Output column names must be unique.');names.add(c.name);if(typeof c.path!=='string'||!c.path.startsWith('/')||/~(?![01])/.test(c.path))throw new Error('Use a complete RFC6901 source pointer for '+c.name+'.');}}
function validateConfig(c){
 if(c?.schema!==SCHEMA||!Array.isArray(c.periods)||!c.periods.length||!c.periods.some(x=>x.id===c.selectedPeriod))throw new Error('Use the records workspace schema with a selected named period.');
 const periods=new Set();for(const p of c.periods){required(p.id,'Period ID');if(periods.has(p.id))throw new Error('Period IDs must be unique.');periods.add(p.id);
  if(!Array.isArray(p.editions)||!p.editions.length||!p.editions.some(e=>e.id===p.selectedEdition))throw new Error('Each period needs an existing selected edition.');
  const editions=new Set();for(const e of p.editions){required(e.id,'Edition ID');if(editions.has(e.id))throw new Error('Edition IDs must be unique within their period.');editions.add(e.id);
   if(!Array.isArray(e.sources)||!Array.isArray(e.corrections))throw new Error('Keep source and correction arrays for every edition.');
   if(e.compareToEdition&&(!p.editions.some(x=>x.id===e.compareToEdition)||e.compareToEdition===e.id))throw new Error('Compare to a different retained edition in the same period.');
  }}
 if(!Array.isArray(c.reviews))throw new Error('Keep original reviews as an array.');validateColumns(c.customer?.columns||[]);
}
function checkHistory(base,next){
 for(const [label,a,b] of [['review',base.reviews||[],next.reviews||[]],['checkpoint',base.transition?.checks||[],next.transition?.checks||[]],['requirement response',base.requirements?.responses||[],next.requirements?.responses||[]]]){
  if(!same(a,b.slice(0,a.length)))throw new Error('Append to the saved '+label+' history so earlier attributed records remain available.');
 }
}
async function saveDraft(){
 if(historical)throw new Error('Return to the working draft before saving.');if(!dirty())return state.revision;
 state=await api('/api/state');if(state.workspace.head!==draft.base.id)throw new Error('Another source revision was saved. Merge the local draft with current source in History.');
 validateConfig(draft.config);checkHistory(draft.baseConfig,draft.config);
 const files=[{path:'workspace.json',text:json(draft.config)+'\n'},...Object.entries(draft.files).map(([path,f])=>({path,...(typeof f.base64==='string'?{base64:f.base64}:{text:f.text})}))];
 const next=new Map(draft.base.files.map(f=>[f.path,f.bytes]));for(const f of files)next.set(f.path,fileBytes(f).length);
 if(next.size>512||[...next.values()].some(n=>n>8*1024*1024)||[...next.values()].reduce((a,b)=>a+b,0)>32*1024*1024)throw new Error('The saved source supports 512 files, 8 MiB per file and 32 MiB total. Keep the complete intended source within those limits.');
 const body={expectedHead:draft.base.id,baseRevision:draft.base.id,note:(ui.revisionNote.trim()||'Records source, review and delivery')+' [records-save-'+crypto.randomUUID()+']',files};
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
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));if(!RESULTS.has(value.schema)||!value.report?.edition||!value.report?.period)throw new Error('The result uses a different Records report contract.');
  for(const f of value.files||[]){if(!/^[A-Za-z0-9_.-]{1,200}$/.test(f.name)||typeof f.body!=='string')throw new Error('A retained file has an unsupported name or body.');const d=enc.encode(f.body);if(d.length!==f.bytes||await digest(d)!==f.sha256)throw new Error('Generated file '+f.name+' differs from the saved output.');}
  output=value;outputId=p.id;ui.focused=null;
}
async function openPreview(id,{retainTrail=false}={}){const different=preview?.id!==id,p=await api('/api/preview?id='+encodeURIComponent(id));preview=p;if(different&&p.function==='inspect_records'){ui.view=p.input?.view||'findings';ui.offset=p.input?.offset||0;ui.limit=p.input?.limit||100;ui.query=p.input?.query||'';ui.exactId=p.input?.id||'';if(!retainTrail)ui.pageTrail=[];}if(outputId!==id){output=null;outputId=null;}if(p.status==='COMPLETED'&&p.result){if(outputId!==id)await loadOutput(p);}else if(terminal(p.status)){output=null;outputId=null;}schedulePoll();}
function schedulePoll(){clearTimeout(pollTimer);if(!preview||terminal(preview.status))return;pollTimer=setTimeout(async()=>{if(busy){schedulePoll();return;}try{await openPreview(preview.id);state=await api('/api/state');render();}catch(e){notice(e.message+' Use Refresh to reopen this result.',true);}},1600);}


async function startPreview(fn,view=ui.view,offset=0,{tab,force=false}={}){
 if(pending)throw new Error('Recover the retained operation first.');
 if(!historical&&dirty())await saveDraft();
 const args={periodId:period().id,editionId:edition().id};
 if(fn==='inspect_records'){Object.assign(args,{view,offset,limit:Number(ui.limit)});if(ui.query)args.query=ui.query;if(ui.exactId)args.id=ui.exactId;ui.view=view;ui.offset=offset;}
 const key=canonical({revisionId:revision().id,function:fn,input:args}),cached=ui.pageCache[key];
 if(!force&&cached&&state.previews.some(p=>p.id===cached&&p.status==='COMPLETED')){await openPreview(cached,{retainTrail:true});ui.tab=tab||ui.tab;persist();notice('Opened the retained result for this exact saved source and selection.');return;}
 const r=await mutate('/api/preview',{revisionId:revision().id,function:fn,input:args,operationId:'records-'+crypto.randomUUID()},'preview');
 ui.pageCache[key]=r.id;ui.tab=tab||(fn==='inspect_records'?'inspection':'delivery');await openPreview(r.id,{retainTrail:true});persist();
}
async function inspectView(view,tab='inspection',id=''){ui.pageTrail=[];ui.query='';ui.exactId=id;ui.focused=null;return startPreview('inspect_records',view,0,{tab});}
async function cancelPreview(){if(!preview||terminal(preview.status))return;await api('/api/preview/cancel',{id:preview.id});await openPreview(preview.id);notice('Cancelled the selected operation. Its saved source remains available.');}
function parseJSON(value,label){try{return JSON.parse(value.replace(/^\uFEFF/,''));}catch{throw new Error(label+' must be valid JSON.');}}
function go(tab){ui.tab=tab;persist();render();}
function renderRecovery(){const n=$('#recovery');if(!n)return;n.hidden=!pending;if(pending)n.replaceChildren(txt('h3','Recover the saved operation'),txt('p','The '+pending.kind+' request was retained before dispatch. Recovery reconciles the same request and saved source.'),row(button('Recover original operation',recover,{read:true,id:'recover-operation'}),button('Download request',()=>saveBytes(enc.encode(json(pending)+'\n'),'records-pending-operation.json','application/json'),{read:true})));}
function clearSelection(){ui.pageTrail=[];ui.cartons=[];ui.focused=null;ui.targets=[];ui.offset=0;ui.sourceId=null;ui.sourceDraft=null;ui.rawFile=null;ui.requirement=null;ui.correction=null;}
function renderTop(){
 if(!state||!draft)return;document.body.setAttribute('aria-busy',String(busy));
 $('#workspace-label').textContent=config().title||state.workspace.label||state.workspace.id;
 $('#header-actions').replaceChildren(button('Refresh',async()=>{await refresh();notice('Saved state and selected operation refreshed.');},{read:true,id:'refresh-state'}),el('a',{href:'/#'+token,target:'_blank',rel:'noreferrer'},'Engineering workspace'));
 $('#save-state').replaceChildren(badge(historical?'Historical':dirty()?'Local changes':'Saved',dirty()),small(storageFailure?'Draft storage needs attention':draft.base.id!==state.workspace.head?'Newer source available':'Revision '+short(revision().id)),button('Save draft',saveDraft,{primary:true,disabled:!dirty()||!!historical,id:'save-draft'}));
 $('#edition-control').replaceChildren(
 field('Named period',select(config().periods.map(p=>[p.id,p.label||p.id]),config().selectedPeriod,{disabled:!editable(),id:'selected-period',onchange:e=>{draft.config.selectedPeriod=e.target.value;clearSelection();changed();render();}})),
 field('Retained source edition',select(period().editions.map(e=>[e.id,e.label||e.id]),period().selectedEdition,{disabled:!editable(),id:'selected-edition',onchange:e=>{period().selectedEdition=e.target.value;clearSelection();changed();render();}})));
 $('#footer-state').textContent=state.workspace.id+' · '+state.revisions.length+' saved revisions · '+state.previews.length+' retained operations';renderRecovery();
}
function banner(){
 if(!preview)return empty('Inspect a saved edition to open its calculation, source rows and original findings.');
 return el('div',{class:'inline-note'},row(badge(preview.status),mono(preview.function),small('Saved revision '+short(preview.revisionId))),report()&&!reportCurrent()?txt('p','This result describes another saved revision, period or edition. Open the selected source before adding bound decisions.'):null,dirty()&&reportCurrent()?txt('p','This result describes saved inputs. The local draft enters the next source revision.'):null,preview.error?detail('Operation detail',preview.error):null,!terminal(preview.status)?button('Cancel this operation',cancelPreview,{read:true}):null);
}
function inspectButton(view='findings',tab='inspection'){return button(dirty()?'Save & inspect':'Inspect selected edition',()=>inspectView(view,tab),{primary:true,id:'inspect-edition'});}
function summaryTable(value){if(!value)return empty('No calculated summary is available for this saved selection.');return table(['Original summary field','Exact value'],Object.entries(value).map(([key,v])=>[key,typeof v==='object'?detail('Value',v):mono(v)]));}
function metadataFields(object,descriptors){return el('div',{class:'grid'},descriptors.map(([key,label,type='text',hint=''])=>{
 const control=type==='textarea'?area(object[key]||'',{disabled:!editable(),oninput:e=>{object[key]=e.target.value;changed();}}):input(object[key]??'',{disabled:!editable(),oninput:e=>{object[key]=e.target.value;changed();}});
 return field(label,control,hint);
}));}
function evidenceEditor(items,onChange,{disabled=false}={}){
 return el('div',{},table(['Source ID (optional)','Exact reference',''],items.map((item,index)=>[
 input(item.sourceId||'',{disabled:disabled||!editable(),oninput:e=>{item.sourceId=e.target.value;onChange();}}),
 input(item.reference||'',{disabled:disabled||!editable(),oninput:e=>{item.reference=e.target.value;onChange();}}),
 button('Remove',()=>{items.splice(index,1);onChange();},{disabled:disabled||!!historical})])),
 button('Add source reference',()=>{items.push({sourceId:'',reference:''});onChange();},{disabled:disabled||!!historical}));
}
function cleanEvidence(items){return items.map(x=>({sourceId:x.sourceId||'',reference:required(x.reference,'Evidence reference')}));}


function overview(){
 const r=reportCurrent()?report():null,c=r?.counts||{};
 return [heading('Records reconciliation','Work through original contract, custody, service and invoice ledgers for one named period and retained edition.',inspectButton()),
 banner(),
 el('div',{class:'metric-grid'},[['Invoice rows',c.invoices],['Findings requiring review',c.reviewRequired],['Inventory cartons',c.cartons],['Unassigned cartons',r?.transition?.unassigned]].map(([label,value])=>el('div',{class:'metric'},txt('span',label),txt('strong',count(value))))),
 card(txt('h3','Selected source'),dl([['Period',period().label||period().id],['Edition',edition().label||edition().id],['Source kind',edition().sourceKind||'—'],['Captured at',edition().capturedAt||'—'],['Review mode',edition().mode||'—'],['Configuration',mono('workspace.json')],['Original source files',count(edition().sources.length)],['Explicit corrections',count(edition().corrections.length)]]),
 edition().requestSource?txt('p','This edition retains the complete original request file. Its labelled provenance remains visible; it has not been relabelled as a customer export.'):null,
 row(button('Open source and contract mapping',()=>go('sources'),{read:true}),button('Open inventory and transfer',()=>go('transition'),{read:true}))),
 r?card(txt('h3','Original calculation'),row(badge(r.reconciliation.status,true),small(r.reconciliation.mode)),dl([['Request SHA256',mono(r.reconciliation.requestSha256)],['Packet SHA256',mono(r.reconciliation.packetSha256)],['Evaluated at',r.reconciliation.evaluatedAt||'—']]),
 summaryTable(r.reconciliation.summary),
 r.input.errorCount?el('div',{class:'inline-note'},txt('strong',count(r.input.errorCount)+' input corrections'),txt('p','Open the affected source rows, original mapping and retained values.'),button('Open input corrections',()=>inspectView('input-errors'),{read:true})):null,
 r.reconciliation.holdReasons?.length?detail('Original source reasons and affected inputs',r.reconciliation.holdReasons):null):null,
 r?card(txt('h3','Review and handoff status'),dl([['Current bound reviews',count(r.reviews.current)],['Retained earlier or stale reviews',count(r.reviews.stale)],['Completed transition waves',count(r.transition.completeWaves)+' / '+count(r.transition.waveCount)],['Technical responses',count(r.requirements.answered)+' / '+count(r.requirements.total)],['Reviewed technical responses',count(r.requirements.reviewed)],['Cost catalog items',count(r.catalog.total)],['Original priced items',count(r.catalog.priced)]]),
 txt('p','Calculated variance, review disposition, payment, transfer and remittance are separate records. The operator report retains each original state and exact amount.'),row(button('Open findings',()=>inspectView('findings'),{read:true}),button('Prepare complete handoff',()=>go('delivery'),{read:true}))):null,
 r?.comparison?card(txt('h3','Edition comparison'),r.comparison.comparableScope?summaryTable(r.comparison.counts):txt('p',r.comparison.reason||'Select an earlier edition in Sources to compare exact records.'),button('Open exact changes',()=>inspectView('changes'),{read:true}),detail('Original comparison basis and totals',r.comparison)):null];
}
function openNewEdition(){ui.newEdition={id:'',label:'',compareToEdition:edition().id,sourceEdition:edition().id};persist();}
function createEdition(){
 const value=ui.newEdition,id=required(value.id,'New edition ID');if(period().editions.some(e=>e.id===id))throw new Error('That edition ID already exists.');
 const old=period().editions.find(e=>e.id===value.sourceEdition);if(!old)throw new Error('Select an existing source edition.');
 const next=clone(old);next.id=id;next.label=required(value.label,'New edition label');next.compareToEdition=value.compareToEdition||old.id;
 period().editions.push(next);period().selectedEdition=id;ui.newEdition=null;clearSelection();changed();notice('Created a correction edition in the local draft. Original sources and review bindings remain retained.');go('sources');
}
function newEditionForm(){
 if(!ui.newEdition)return null;const n=ui.newEdition,set=(k,v)=>{n[k]=v;persist();};
 return card(txt('h3','Create a retained correction edition'),txt('p','Copy the selected source and explicit corrections, then apply the new changes to this named edition. Earlier decisions keep their original edition and request bindings.'),
 el('div',{class:'grid'},field('New edition ID',input(n.id,{id:'new-edition-id',oninput:e=>set('id',e.target.value)})),field('New edition label',input(n.label,{id:'new-edition-label',oninput:e=>set('label',e.target.value)})),field('Copy source edition',select(period().editions.map(e=>[e.id,e.label||e.id]),n.sourceEdition,{onchange:e=>{set('sourceEdition',e.target.value);set('compareToEdition',e.target.value);render();}}))),
 row(button('Create correction edition',createEdition,{primary:true,id:'create-edition'}),button('Cancel',()=>{ui.newEdition=null;persist();},{read:true})));
}
function createPeriod(){
 const n=ui.newPeriod,id=required(n.id,'Period ID');if(config().periods.some(p=>p.id===id))throw new Error('That period already exists.');
 const start=utcText(n.start,'Period start'),end=utcText(n.end,'Period end');if(start>=end)throw new Error('Period end must be after its start.');
 const ledgers={};for(const key of ['policy','custody','services','invoices'])ledgers[key]={authority_id:'',entity_ref:'',provider_ref:'',period_start:start,period_end:end,captured_at:'',complete:false};
 ledgers.policy={...ledgers.policy,currency:'',minor_unit_digits:2,rounding_mode:'EXACT',max_authority_age_days:365};ledgers.invoices.currency='';
 const editionId=required(n.edition,'First edition ID'),e={id:editionId,label:n.editionLabel||editionId,capturedAt:'',sourceKind:'operator-provided-export',mode:'HISTORICAL_INTEGRITY_ONLY',evaluatedAt:'',ledgers,sources:[],corrections:[]};
 config().periods.push({id,label:required(n.label,'Period label'),selectedEdition:editionId,editions:[e]});config().selectedPeriod=id;ui.newPeriod=null;clearSelection();changed();notice('Created an empty named period. Supply its original ledger metadata and exports in Sources.');
}
function periodForm(){
 if(!ui.newPeriod)return null;const n=ui.newPeriod,set=(k,v)=>{n[k]=v;persist();};
 return card(txt('h3','Add a named period'),el('div',{class:'grid'},[['id','Period ID'],['label','Period label'],['start','Inclusive period start (UTC)'],['end','Exclusive period end (UTC)'],['edition','First edition ID'],['editionLabel','First edition label']].map(([k,l])=>field(l,input(n[k]||'',{oninput:e=>set(k,e.target.value),placeholder:['start','end'].includes(k)?'2026-09-01T00:00:00Z':''})))),
 row(button('Create period',createPeriod,{primary:true}),button('Cancel',()=>{ui.newPeriod=null;persist();},{read:true})));
}
function ledgerEditor(name,value){
 const set=(k,v)=>{value[k]=v;changed();};
 return el('details',{open:name==='policy'},txt('summary',name[0].toUpperCase()+name.slice(1)+' ledger authority and scope'),el('div',{class:'details-body grid'},
 ...[['authority_id','Authority ID'],['entity_ref','Exact entity reference'],['provider_ref','Exact provider reference'],['period_start','Inclusive period start (UTC)'],['period_end','Exclusive period end (UTC)'],['captured_at','Authority captured at (UTC)']].map(([k,label])=>field(label,input(value[k]??'',{disabled:!editable(),oninput:e=>set(k,e.target.value)}))),
 field('Declared complete export',select([['false','Completeness not declared'],['true','Complete for this exact ledger scope']],String(value.complete===true),{disabled:!editable(),onchange:e=>set('complete',e.target.value==='true')}),'Retains the operator’s actual source completeness statement.'),
 ...(['policy','invoices'].includes(name)?[field('Currency',input(value.currency||'',{disabled:!editable(),oninput:e=>set('currency',e.target.value)}))]:[]),
 ...(name==='policy'?[
 field('Currency minor-unit digits',input(value.minor_unit_digits??2,{type:'number',min:0,max:6,step:1,disabled:!editable(),onchange:e=>{value.minor_unit_digits=safeInteger(e.target.value,'Minor-unit digits');changed();}})),
 field('Contract calculation rounding',select(['EXACT','HALF_UP','HALF_EVEN','DOWN','UP'],value.rounding_mode||'EXACT',{disabled:!editable(),onchange:e=>set('rounding_mode',e.target.value)}),'EXACT retains unresolved fractional minor units.'),
 field('Maximum authority age in days',input(value.max_authority_age_days??365,{type:'number',min:0,step:1,disabled:!editable(),onchange:e=>{value.max_authority_age_days=safeInteger(e.target.value,'Maximum authority age');changed();}}))]:[])));
}
function csvHeaders(text){
 let value='',quoted=false,result=[];if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"')quoted=false;else value+=c;}
 else if(c==='"'&&value==='')quoted=true;else if(c===','){result.push(value);value='';}else if(c==='\r'||c==='\n'){result.push(value);return result;}else value+=c;}
 if(quoted)throw new Error('The CSV header has an unfinished quoted value.');result.push(value);return result;
}
function pointer(value,path){if(path==='')return value;if(typeof path!=='string'||!path.startsWith('/')||/~(?![01])/.test(path))return undefined;for(const part of path.slice(1).split('/')){if(value==null)return undefined;const key=part.replace(/~1/g,'/').replace(/~0/g,'~');value=value[key];}return value;}
function headersFrom(text,format,rowPath=''){
 if(format==='csv')return csvHeaders(text);const parsed=parseJSON(text,'Original JSON source'),rows=pointer(parsed,rowPath);return Array.isArray(rows)&&rows[0]&&typeof rows[0]==='object'?Object.keys(rows[0]):[];
}
async function attachFiles(list){
 if(historical)throw new Error('Return to the working source before importing exports.');
 for(const file of [...list]){if(file.size>8*1024*1024)throw new Error(file.name+' exceeds the original 8 MiB per-file limit.');
 const b=new Uint8Array(await file.arrayBuffer()),text=new TextDecoder('utf-8',{fatal:true}).decode(b),sha=await digest(b),format=/\.csv$/i.test(file.name)?'csv':'json';
 const path='captures/'+sha+'.'+format;
 ui.attachments.push({name:file.name,bytes:b.length,sha256:sha,path,base64:to64(b),id:'source-'+sha.slice(0,12),table:'invoices',format,label:file.name,capturedAt:utcNow(),sourceKind:'operator-provided-export',rowPath:'',moneyScale:'',headers:headersFrom(text,format)});
 }
 persist();notice('Retained '+ui.attachments.length+' exact file selection(s). Declare each ledger table and money scale before adding it.');render();
}
function addAttachment(index){
 const a=ui.attachments[index];required(a.id,'Source ID');if(edition().sources.some(s=>s.id===a.id))throw new Error('Choose a unique source ID in this edition.');
 if(['rates','invoices'].includes(a.table)&&!['major','minor'].includes(a.moneyScale))throw new Error('Declare whether this source contains major or minor money units.');
 utcText(a.capturedAt,'Source capture time');
 draft.files[a.path]={base64:a.base64,sha256:a.sha256,bytes:a.bytes};
 const source={id:a.id,table:a.table,format:a.format,path:a.path,sha256:a.sha256,bytes:a.bytes,capturedAt:a.capturedAt,sourceKind:required(a.sourceKind,'Source kind'),label:a.label,rowPath:a.rowPath||'',mapping:{},constants:{},valueMaps:{},...(['rates','invoices'].includes(a.table)?{moneyScale:a.moneyScale}:{})};
 edition().sources.push(source);ui.attachments.splice(index,1);ui.sourceId=source.id;ui.sourceDraft={source:clone(source),headers:a.headers,constantsText:'{}',mapsText:'{}'};changed();notice('Added the exact source to the draft. Apply its case-sensitive column mapping below.');
}
function attachmentCards(){return ui.attachments.map((a,index)=>{const set=(k,v)=>{a[k]=v;persist();};return card(txt('h3','Selected file: '+a.name),dl([['Bytes',bytes(a.bytes)],['SHA256',mono(a.sha256)],['Saved path',mono(a.path)]]),
 el('div',{class:'grid'},
 field('Source ID',input(a.id,{oninput:e=>set('id',e.target.value)})),field('Source label',input(a.label,{oninput:e=>set('label',e.target.value)})),
 field('Ledger table',select(Object.keys(TABLE_FIELDS),a.table,{onchange:e=>{set('table',e.target.value);render();}})),
 field('Original format',select(['csv','json'],a.format,{onchange:e=>{set('format',e.target.value);render();}})),
 field('Money unit',select([['','Choose source units'],['minor','Already minor units'],['major','Major-unit decimal text']],a.moneyScale,{onchange:e=>set('moneyScale',e.target.value),disabled:!['rates','invoices'].includes(a.table)})),
 field('JSON row pointer',input(a.rowPath,{placeholder:'/rows',disabled:a.format!=='json',oninput:e=>set('rowPath',e.target.value)}),'Empty selects a root array.'),
 field('Captured at (whole-second UTC)',input(a.capturedAt,{oninput:e=>set('capturedAt',e.target.value)})),
 field('Source kind',input(a.sourceKind,{oninput:e=>set('sourceKind',e.target.value)}))),
 detail('Original column names',a.headers),row(button('Add this source to the edition',()=>addAttachment(index),{primary:true,id:'add-source-'+index}),button('Remove selected file',()=>{ui.attachments.splice(index,1);persist();},{read:true})));});}
async function openSource(id){
 const s=edition().sources.find(x=>x.id===id);if(!s)throw new Error('The source is absent from this edition.');
 ui.sourceId=id;ui.sourceDraft={source:clone(s),headers:[],constantsText:json(s.constants||{}),mapsText:json(s.valueMaps||{})};
 try{const f=draft.files[s.path]||await retainedFile(revision().id,s.path),text=new TextDecoder('utf-8',{fatal:true}).decode(fileBytes(f));ui.sourceDraft.headers=headersFrom(text,s.format,s.rowPath||'');}catch(e){ui.sourceDraft.readMessage=e.message;}
 persist();
}
async function showSource(path){
 const f=(!historical&&draft.files[path])||await retainedFile(revision().id,path),b=fileBytes(f);
 if(f.sha256&&await digest(b)!==f.sha256)throw new Error('The original source bytes differ from their saved identity.');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{text='Binary source — download the exact retained file.';}
 ui.rawFile={path,bytes:b.length,sha256:f.sha256||await digest(b),preview:text.slice(0,65536),truncated:text.length>65536};persist();
}
async function downloadSource(path){
 const f=(!historical&&draft.files[path])||await retainedFile(revision().id,path),b=fileBytes(f);if(f.sha256&&await digest(b)!==f.sha256)throw new Error('The original source identity differs.');
 saveBytes(b,path.split('/').pop(),/\.csv$/i.test(path)?'text/csv':'application/octet-stream');
}
function applySourceMapping(){
 const d=ui.sourceDraft,s=d.source,original=edition().sources.find(x=>x.id===ui.sourceId);if(!original)throw new Error('The selected source changed.');
 s.constants=parseJSON(d.constantsText,'Explicit constants');s.valueMaps=parseJSON(d.mapsText,'Exact value maps');
 for(const [name,value] of Object.entries(s.mapping||{})){if(!value)delete s.mapping[name];else if(Object.hasOwn(s.constants,name))throw new Error('Field '+name+' is defined by both a column and a constant.');}
 if(['rates','invoices'].includes(s.table)&&!['minor','major'].includes(s.moneyScale))throw new Error('Select the original source money unit.');
 Object.assign(original,clone(s));d.edited=false;changed();notice('Applied source mapping to the local edition. Inspect its saved source to see exact typed values and any input corrections.');
}
function sourceMapping(){
 const d=ui.sourceDraft;if(!d||d.source.id!==ui.sourceId)return null;const s=d.source,set=(k,v)=>{s[k]=v;d.edited=true;persist();},mapping=s.mapping||(s.mapping={}),choices=TABLE_FIELDS[s.table]||[];
 return card(txt('h3','Source mapping · '+s.id),d.edited?badge('Unapplied mapping edits',true):null,d.readMessage?txt('p',d.readMessage):null,
 el('div',{class:'grid'},
 field('Source label',input(s.label||'',{disabled:!editable(),oninput:e=>set('label',e.target.value)})),
 field('Table',select(Object.keys(TABLE_FIELDS),s.table,{disabled:!editable(),onchange:e=>{set('table',e.target.value);render();}})),
 field('Row pointer (JSON)',input(s.rowPath||'',{disabled:!editable()||s.format!=='json',oninput:e=>set('rowPath',e.target.value)})),
 field('Money scale',select([['','Not a monetary table'],['minor','Minor units'],['major','Major decimal units']],s.moneyScale||'',{disabled:!editable()||!['rates','invoices'].includes(s.table),onchange:e=>set('moneyScale',e.target.value)}))),
 txt('p','An empty mapping uses identical canonical column names. Once a mapping is declared, include every intended field. Exact constants supply absent fields; value maps apply to the original raw cell before conversion.'),
 el('datalist',{id:'source-columns'},(d.headers||[]).map(h=>el('option',{value:h}))),
 table(['Canonical field','Exact source column'],choices.map(key=>[mono(key),input(mapping[key]||'',{list:'source-columns',disabled:!editable(),oninput:e=>{if(e.target.value)mapping[key]=e.target.value;else delete mapping[key];d.edited=true;persist();}})])),
 el('div',{class:'grid'},field('Explicit constants (JSON)',area(d.constantsText,{disabled:!editable(),oninput:e=>{d.constantsText=e.target.value;d.edited=true;persist();}}),'Use exact declared values. Do not map the same field twice.'),
 field('Exact raw value maps (JSON)',area(d.mapsText,{disabled:!editable(),oninput:e=>{d.mapsText=e.target.value;d.edited=true;persist();}}),'For example, {"line_kind":{"Credit":"CREDIT"}}.')),
 row(button('Apply mapping to draft',applySourceMapping,{primary:true,disabled:!!historical,id:'apply-source-mapping'}),button('Show original file',()=>showSource(s.path),{read:true}),button('Download original file',()=>downloadSource(s.path),{read:true})),detail('Complete original source binding',s));
}
function sources(){
 const e=edition(),set=(k,v)=>{e[k]=v;changed();};
 return [heading('Sources and contract scope','Retain original files, exact column names and explicit money/authority settings for all four ledgers.',button('New correction edition',openNewEdition,{disabled:!!historical,id:'new-correction-edition'}),button('Add period',()=>{ui.newPeriod={id:'',label:'',start:'',end:'',edition:'original',editionLabel:'Original exported ledgers'};persist();},{disabled:!!historical})),
 newEditionForm(),periodForm(),
 card(txt('h3','Named period and edition'),el('div',{class:'grid'},
 field('Workspace title',input(config().title||'',{disabled:!editable(),oninput:x=>{config().title=x.target.value;changed();}})),
 field('Period label',input(period().label||'',{disabled:!editable(),oninput:x=>{period().label=x.target.value;changed();}})),
 field('Edition label',input(e.label||'',{disabled:!editable(),oninput:x=>set('label',x.target.value)})),
 field('Edition captured at (UTC)',input(e.capturedAt||'',{disabled:!editable(),oninput:x=>set('capturedAt',x.target.value)})),
 field('Original source kind',input(e.sourceKind||'',{disabled:!editable(),oninput:x=>set('sourceKind',x.target.value)})),
 field('Review mode',select([['HISTORICAL_INTEGRITY_ONLY','Historical integrity review'],['CURRENT_OWNER_REVIEW','Current authority review']],e.mode||'HISTORICAL_INTEGRITY_ONLY',{disabled:!editable(),onchange:x=>set('mode',x.target.value)})),
 field('Historical evaluated-at UTC',input(e.evaluatedAt||'',{disabled:!editable(),oninput:x=>set('evaluatedAt',x.target.value)}),'Current review uses the actual process UTC; the historical mode preserves this selected timestamp.'),
 field('Compare with retained edition',select([['','No comparison'],...period().editions.filter(x=>x.id!==e.id).map(x=>[x.id,x.label||x.id])],e.compareToEdition||'',{disabled:!editable(),onchange:x=>{if(x.target.value)set('compareToEdition',x.target.value);else{delete e.compareToEdition;changed();}}}))),
 e.requestSource?el('div',{class:'inline-note'},txt('strong','Complete original request source'),detail('Original V1/V2 request identity',e.requestSource),row(button('Read original request',()=>showSource(e.requestSource.path),{read:true}),button('Download original request',()=>downloadSource(e.requestSource.path),{read:true})),txt('p','Mapped corrections can bind the original request rows. Create another named edition when moving to separate ledger files.')):null),
 e.ledgers?card(txt('h3','Four source authorities'),...['policy','custody','services','invoices'].map(name=>ledgerEditor(name,e.ledgers[name]||(e.ledgers[name]={})))):
 card(txt('h3','Original request authorities'),txt('p','This edition uses its retained complete request. Open its exact input to inspect contract, custody, service and invoice authority.'),detail('Original request descriptor',e.requestSource)),
 card(txt('h3','Original ledger exports'),e.sources.length?table(['Source / table','Original identity','Money unit','Open'],e.sources.map(s=>[
 el('div',{},txt('strong',s.label||s.id),small(s.id+' · '+s.table+' · '+s.format)),el('div',{},mono(s.sha256),small(bytes(s.bytes)+' · '+s.capturedAt)),s.moneyScale||'—',row(button('Map columns',()=>openSource(s.id),{read:true,id:'map-source-'+s.id}),button('Read original',()=>showSource(s.path),{read:true}))])):empty('No separate table files are declared in this edition.'),
 field('Import complete CSV / JSON ledger exports',el('input',{type:'file',accept:'.csv,.json,text/csv,application/json',multiple:true,disabled:!editable(),id:'import-source-files',onchange:event=>run(()=>attachFiles(event.target.files))}),'Original bytes are retained under their content hash. Declare the table and exact money unit before adding.')),
 ...attachmentCards(),sourceMapping(),
 ui.rawFile?card(txt('h3','Original source · '+ui.rawFile.path),dl([['Bytes',bytes(ui.rawFile.bytes)],['SHA256',mono(ui.rawFile.sha256)]]),ui.rawFile.truncated?small('Showing the first 65,536 characters. Download retains the complete original file.'):null,txt('pre',ui.rawFile.preview),row(button('Download complete original',()=>downloadSource(ui.rawFile.path),{read:true}),button('Close original view',()=>{ui.rawFile=null;persist();},{read:true}))):null,
 card(txt('h3','Attributed source corrections'),e.corrections.length?table(['Correction','Source row','Field','Before → value','Author / reason'],e.corrections.map(c=>[mono(c.id),el('div',{},mono(c.sourceId),small('Row '+c.recordIndex)),mono(c.field),el('div',{},mono(c.before),txt('span',' → '),mono(c.value)),el('div',{},c.author,small(c.at),txt('p',c.note))])):empty('No original cells have been corrected.'),txt('p','Open a mapped invoice, rate, carton or event in Reconciliation to add an exact before/value correction. Omitted rows remain visible with their source and reason.'),button('Open mapped invoice rows',()=>inspectView('invoices'),{read:true})),
 inspectButton('sources','inspection')];
}


function pageKey(){return canonical({revision:revision()?.id,period:period()?.id,edition:edition()?.id,view:ui.view,query:ui.query,id:ui.exactId});}
function pageControls({allowed=VIEWS,tab='inspection'}={}){
 const page=output?.page,selectedView=allowed.some(v=>v[0]===ui.view)?ui.view:allowed[0][0],actual=page&&reportCurrent()&&allowed.some(v=>v[0]===page.view);return card(el('div',{class:'list-controls'},
 field('Inspect original records',select(allowed,selectedView,{id:'inspection-view',onchange:e=>{ui.view=e.target.value;ui.offset=0;ui.focused=null;persist();render();}})),
 field('Literal search',input(ui.query,{id:'inspection-query',oninput:e=>{ui.query=e.target.value;persist();}}),'Matches retained text; no inferred joins.'),
 field('Exact record ID',input(ui.exactId,{id:'inspection-exact-id',oninput:e=>{ui.exactId=e.target.value;persist();}})),
 field('Page size',input(ui.limit,{id:'inspection-limit',type:'number',min:1,max:500,step:1,oninput:e=>{ui.limit=e.target.value;persist();}})),
 button('Open selected page',()=>{ui.pageTrail=[];ui.view=selectedView;return startPreview('inspect_records',selectedView,0,{tab});},{primary:true,id:'inspect-page'})),
 actual?el('div',{class:'selected-count'},small('Showing '+count(page.offset+1)+'–'+count(page.offset+page.items.length)+' of '+count(page.total)+' matching records'+(page.byteLimited?' · native byte limit shortened this page':'')),
 row(button('First',()=>{ui.pageTrail=[];return startPreview('inspect_records',page.view,0,{tab});},{read:true,disabled:page.offset===0}),
 button('Previous',()=>{const offset=(ui.pageTrail||[]).pop();return startPreview('inspect_records',page.view,offset,{tab});},{read:true,disabled:!(ui.pageTrail||[]).length}),
 button('Next',()=>{(ui.pageTrail||(ui.pageTrail=[])).push(page.offset);return startPreview('inspect_records',page.view,page.nextOffset,{tab});},{read:true,disabled:!page.hasMore,id:'next-page'}))):null);
}
function focusRecord(item,view=output?.page?.view){ui.focused={view,item:clone(item),revisionId:preview.revisionId,periodId:report().period.id,editionId:report().edition.id,requestSha256:report().reconciliation.requestSha256};ui.correction=null;persist();}
function findingBinding(f){return {findingId:f.id,findingSha256:f.sha256,periodId:report().period.id,editionId:report().edition.id,requestSha256:report().reconciliation.requestSha256};}
function toggleFinding(f,checked){const b=findingBinding(f),key=x=>x.periodId+'|'+x.editionId+'|'+x.requestSha256+'|'+x.findingId;ui.targets=ui.targets.filter(x=>key(x)!==key(b));if(checked)ui.targets.push(b);persist();}
function findingSelected(f){return ui.targets.some(x=>x.findingId===f.id&&x.findingSha256===f.sha256&&x.requestSha256===report()?.reconciliation?.requestSha256&&x.editionId===edition()?.id&&x.periodId===period()?.id);}
function recordsTable(view,items,{actions=true}={}){
 if(!items?.length)return empty('No records in this retained page. Original total and scope are shown above.');
 if(view==='findings')return table(['Select','Finding / exact identity','Original states','Expected minor units','Review','Open'],items.map(f=>[
 el('input',{type:'checkbox',checked:findingSelected(f),disabled:!reviewEnabled(),'aria-label':'Select finding '+f.id,onchange:e=>{toggleFinding(f,e.target.checked);render();}}),
 el('div',{},mono(f.id),small(f.sha256)),el('div',{},(f.states||[]).map(s=>badge(s))),mono(f.calculation?.expected_amount_minor),
 el('div',{},badge(f.currentReview?.status||'unreviewed'),small(f.currentReview?.owner||''),f.staleReviewCount?small(f.staleReviewCount+' earlier bindings'):null),
 button('Inspect finding',()=>focusRecord(f,view),{read:true,id:'finding-'+f.id})]));
 if(TABLE_FIELDS[view]||view==='customer-invoices'){
 const fields=view==='invoices'||view==='customer-invoices'?['invoice_ref','row_id','charge_code','quantity','amount_minor']:view==='rates'?['charge_code','unit','rate_minor','scope']:view==='sites'?['site_ref','active_from','active_until']:view==='cartons'?['carton_ref','site_ref','admitted_at','terminated_at']:['event_id','charge_code','quantity','occurred_at'];
 return table(['Record',...fields,'State','Open'],items.map(item=>[mono(item.id),...fields.map(k=>mono(item.values?.[k])),el('div',{},item.omitted?badge('Omitted'):null,(item.errors||[]).length?badge('Input correction',true):null,(item.analysis?.states||[]).map(s=>badge(s))),
 button('Inspect row',()=>focusRecord(item,view),{read:true,id:'record-'+item.id})]));
 }
 const columns={
 sources:[['id','Source'],['table','Table'],['format','Format'],['records','Rows'],['mappingSha256','Mapping SHA']],
 changes:[['id','Change'],['table','Table'],['state','State'],['changedFields','Changed fields']],
 reviews:[['findingId','Finding'],['status','Disposition'],['owner','Owner'],['at','Recorded'],['applies','Current binding']],
 checks:[['waveId','Wave'],['kind','Checkpoint'],['status','Status'],['owner','Owner'],['at','Recorded']],
 'input-errors':[['code','Input correction'],['sourceId','Source'],['recordIndex','Row index'],['message','Detail']],
 cooperative:[['month','Month'],['agencyId','Agency ID'],['agencyName','Agency name'],['netSalesMinor','Net sales minor'],['adminFeeMinor','Admin fee minor'],['findings','Findings']],
 'cooperative-basis':[['month','Month'],['agencyId','Agency'],['invoiceRef','Invoice'],['rowId','Row'],['chargeCode','Charge'],['amountMinor','Billed minor']]
 }[view]||[['id','Record'],['status','Status']];
 return table([...columns.map(x=>x[1]),'Open'],items.map(item=>[...columns.map(([key])=>typeof item[key]==='object'?mono(item[key]):fmt(item[key])),button('Inspect detail',()=>focusRecord(item,view),{read:true})]));
}
function exactValue(text,kind){
 if(kind==='text')return text;const value=parseJSON(text,'Mapped cell value');
 const check=v=>{if(typeof v==='number'&&!Number.isSafeInteger(v))throw new Error('Use quoted decimal text for fractional quantities, rates and percentages.');if(v&&typeof v==='object')Object.values(v).forEach(check);};check(value);return value;
}
function flatValue(value,field){return field.split('.').reduce((v,k)=>v==null?undefined:v[k],value);}
function prepareCorrection(item){
 if(!item._source||!item.mapped)throw new Error('Open the original mapped source row before correcting it.');
 const fields=TABLE_FIELDS[item.table]||Object.keys(item.mapped),field=fields.find(k=>flatValue(item.mapped,k)!==undefined)||fields[0],before=flatValue(item.mapped,field);
 ui.correction={field,before:clone(before??null),value:typeof before==='string'?before:json(before??null),valueKind:typeof before==='string'?'text':'json',author:ui.review.owner||'',note:'',newEditionId:'',newEditionLabel:''};persist();
}
function appendCorrection({newEdition=false,omit=false}={}){
 const f=ui.focused,c=ui.correction;if(!f||!c||!reportCurrent()||sourceDirty()||f.revisionId!==revision().id)throw new Error('Reopen this row from the current saved source before applying a bound correction.');
 const item=f.item,meta=item._source;required(c.author,'Correction author');required(c.note,'Correction reason');
 let target=edition();
 if(newEdition){const id=required(c.newEditionId,'New correction edition ID');if(period().editions.some(e=>e.id===id))throw new Error('That edition already exists.');target=clone(edition());target.id=id;target.label=required(c.newEditionLabel,'New correction edition label');target.compareToEdition=edition().id;period().editions.push(target);period().selectedEdition=id;}
 const before=omit?Boolean(item.omitted):flatValue(item.mapped,c.field);if(before===undefined&&!omit)throw new Error('The selected mapped field is absent. Correct its source mapping first.');
 const value=omit?true:exactValue(c.value,c.valueKind);
 target.corrections.push({id:'correction-'+crypto.randomUUID(),sourceId:meta.id,sourceSha256:meta.sha256,recordIndex:meta.recordIndex,mappingSha256:meta.mappingSha256,field:omit?'$omit':c.field,before:clone(before),value,author:c.author,note:c.note,at:utcNow()});
 ui.correction=null;ui.targets=[];changed();notice('Appended the attributed correction. Save and inspect the corrected edition to recalculate the exact original request.');ui.tab='sources';
}
function correctionEditor(){
 const f=ui.focused,c=ui.correction;if(!c||!f?.item?._source)return null;const item=f.item,set=(k,v)=>{c[k]=v;persist();};
 return card(txt('h3','Correct the mapped source cell'),txt('p','Values here precede canonical type and money conversion. Original source bytes remain unchanged. The recorded before value and mapping identity must still match.'),
 el('div',{class:'grid'},
 field('Canonical mapped field',select((TABLE_FIELDS[item.table]||Object.keys(item.mapped)).filter(k=>flatValue(item.mapped,k)!==undefined),c.field,{id:'correction-field',onchange:e=>{c.field=e.target.value;c.before=clone(flatValue(item.mapped,c.field));c.value=typeof c.before==='string'?c.before:json(c.before);c.valueKind=typeof c.before==='string'?'text':'json';persist();render();}})),
 field('Exact existing mapped value',area(json(c.before),{readOnly:true})),
 field('Replacement format',select([['text','Exact text'],['json','JSON integer, boolean, array or object']],c.valueKind,{onchange:e=>{set('valueKind',e.target.value);render();}})),
 field('Replacement value',area(c.value,{id:'correction-value',oninput:e=>set('value',e.target.value)}),'Use quoted decimal strings inside JSON pricing/tier objects.'),
 field('Author',input(c.author,{id:'correction-author',oninput:e=>set('author',e.target.value)})),
 field('Reason and source reference',area(c.note,{id:'correction-note',oninput:e=>set('note',e.target.value)})),
 field('New correction edition ID',input(c.newEditionId,{id:'correction-edition-id',oninput:e=>set('newEditionId',e.target.value)})),
 field('New correction edition label',input(c.newEditionLabel,{id:'correction-edition-label',oninput:e=>set('newEditionLabel',e.target.value)}))),
 detail('Bound original source and mapping',item._source),
 row(button('Create edition & append correction',()=>appendCorrection({newEdition:true}),{primary:true,id:'create-corrected-edition'}),
 button('Append to current draft edition',()=>appendCorrection(),{id:'append-source-correction'}),
 button('Record row omission',()=>appendCorrection({omit:true}),{disabled:item.omitted===true}),
 button('Cancel correction',()=>{ui.correction=null;persist();},{read:true})));
}
function focusPanel(){
 const f=ui.focused;if(!f)return null;const x=f.item,current=f.revisionId===revision()?.id&&f.periodId===period()?.id&&f.editionId===edition()?.id;
 return card(el('div',{class:'record-title'},txt('h3','Original detail · '+(x.id||x.findingId||x.code||f.view)),row(button('Close detail',()=>{ui.focused=null;ui.correction=null;persist();},{read:true}),x._source?.path?button('Read source bytes',()=>{ui.tab='sources';return showSource(x._source.path);},{read:true}):null)),
 !current?txt('p','This detail is retained from an earlier selection. Open its saved revision to act on its exact binding.'):null,
 x.states?el('div',{},(x.states||[]).map(s=>badge(s))):null,
 x.calculation?detail('Exact original calculation',x.calculation):null,
 x.analysis?detail('Invoice calculation and disposition',x.analysis):null,
 x.currentReview?detail('Current source-bound review',x.currentReview):null,
 x.mapped?detail('Mapped values before typed/scaled conversion',x.mapped):null,
 x.values?detail('Original typed values',x.values):null,
 x.original?detail('Exact original row cells',x.original):null,
 x._source?detail('Retained source row and mapping identity',x._source):null,
 x.omitted?badge('Explicitly omitted; original retained',true):null,
 x.errors?.length?detail('Actionable row corrections',x.errors):null,
 detail('Complete retained record',x),
 row(f.view==='findings'&&String(x.id).startsWith('invoice:')?button('Open corresponding invoice row',()=>inspectView('invoices','inspection',x.id.slice(8)),{read:true}):null,
 x._source&&x.mapped?button('Correct mapped source cell',()=>prepareCorrection(x),{disabled:!current||!reviewEnabled(),id:'correct-mapped-cell'}):null,
 f.view==='invoices'?button('Use invoice for customer mapping',()=>{ui.mappingSample=null;return inspectView('customer-invoices','delivery',x.id);},{read:true}):null,
 f.view==='findings'?button(findingSelected(x)?'Remove from selected review':'Select for review',()=>{toggleFinding(x,!findingSelected(x));persist();},{disabled:!reviewEnabled()}):null));
}
function addReviews(){
 if(!reportCurrent()||sourceDirty()||!report()?.reconciliation.requestSha256)throw new Error('Open the current saved request before binding decisions.');
 const r=ui.review;required(r.owner,'Review owner');const evidence=cleanEvidence(r.evidence||[]),at=utcNow(),bound=ui.targets.filter(x=>x.periodId===period().id&&x.editionId===edition().id&&x.requestSha256===report().reconciliation.requestSha256);
 if(!bound.length||bound.length!==ui.targets.length)throw new Error('Select exact current findings. Earlier source selections remain visible and must be reopened separately.');
 for(const item of bound)config().reviews.push({...clone(item),status:r.status,owner:r.owner,note:r.note||'',evidence:clone(evidence),at});
 ui.targets=[];changed();notice('Added '+bound.length+' named decision(s) to the local draft. Original calculation states remain unchanged.');
}
function reviewEditor(){
 const r=ui.review,set=(k,v)=>{r[k]=v;persist();};
 return card(txt('h3','Named finding review'),txt('p','Select explicit finding IDs across retained pages. Each decision binds its own finding digest and the exact current request.'),
 el('div',{class:'selected-count'},badge(ui.targets.length+' selected',ui.targets.length>0),row(button('Select this page',()=>{if(output?.page?.view!=='findings')return;for(const f of output.page.items)toggleFinding(f,true);persist();},{disabled:!reviewEnabled()||output?.page?.view!=='findings'}),button('Clear selected findings',()=>{ui.targets=[];persist();},{read:true}))),
 ui.targets.length?detail('Exact selected finding identities',ui.targets):null,
 el('div',{class:'grid'},field('Disposition',select(REVIEW_STATUSES,r.status,{disabled:!editable(),id:'review-status',onchange:e=>set('status',e.target.value)})),field('Owner',input(r.owner,{disabled:!editable(),id:'review-owner',oninput:e=>set('owner',e.target.value)})),
 field('Private operator note',area(r.note,{disabled:!editable(),id:'review-note',oninput:e=>set('note',e.target.value)}),'A decision does not rewrite a bill, post AP or mark a payment.')),
 txt('h4','Evidence references'),evidenceEditor(r.evidence||(r.evidence=[]),persist),
 button('Append decisions for selected findings',addReviews,{primary:true,disabled:!ui.targets.length||!reviewEnabled(),id:'append-selected-reviews'}),
 (config().reviews.length-(draft.baseConfig.reviews||[]).length)>0?small((config().reviews.length-draft.baseConfig.reviews.length)+' local review entries will enter the next saved revision.'):null);
}
function inspection(){
 return [heading('Reconciliation and source review','Inspect original findings, exact pricing calculations and mapped cells; corrections and decisions remain separately attributed.',inspectButton()),banner(),pageControls(),
 output?.page?card(txt('h3',(VIEWS.find(v=>v[0]===output.page.view)||[null,output.page.view])[1]),recordsTable(output.page.view,output.page.items)):null,
 focusPanel(),correctionEditor(),reviewEditor(),
 reportCurrent()&&report()?.comparison?card(txt('h3','Same-period comparison'),detail('Original scope, counts and both summaries',report().comparison),button('Open changed records',()=>inspectView('changes'),{read:true})):null];
}


function transitionConfig(){return config().transition||(config().transition={waves:[],assignments:[],checks:[]});}
function selectCarton(item,checked){ui.cartons=(ui.cartons||[]).filter(x=>x.cartonRef!==item.id);if(checked)ui.cartons.push({cartonRef:item.id,periodId:period().id,editionId:edition().id,source:clone(item._source)});persist();}
function editWave(id){const wave=transitionConfig().waves.find(w=>w.id===id);ui.waveDraft=wave?{...clone(wave),originalId:wave.id}:{id:'',label:'',owner:'',targetAt:'',notes:''};persist();}
function saveWave(){
 const w=ui.waveDraft;required(w.id,'Wave ID');required(w.label,'Wave label');if(w.targetAt)utcText(w.targetAt,'Wave target time');
 const waves=transitionConfig().waves,index=waves.findIndex(x=>x.id===w.id);if(index>=0&&w.originalId!==w.id)throw new Error('That wave ID already exists.');
 const value={id:w.id,label:w.label,owner:w.owner||'',notes:w.notes||'',...(w.targetAt?{targetAt:w.targetAt}:{})};if(index<0)waves.push(value);else waves[index]=value;
 ui.waveId=w.id;ui.waveDraft=null;changed();notice('Saved the wave in the local operator draft.');
}
function waveEditor(){
 const w=ui.waveDraft;if(!w)return null;const set=(k,v)=>{w[k]=v;persist();};
 return card(txt('h3',w.originalId?'Edit retained wave':'Create transfer wave'),el('div',{class:'grid'},
 ...[['id','Wave ID'],['label','Wave label'],['owner','Owner'],['targetAt','Target UTC time'],['notes','Planning notes']].map(([k,l])=>field(l,k==='notes'?area(w[k]||'',{oninput:e=>set(k,e.target.value)}):input(w[k]||'',{readOnly:k==='id'&&Boolean(w.originalId),oninput:e=>set(k,e.target.value)})))),
 row(button('Apply wave',saveWave,{primary:true,id:'save-wave'}),button('Cancel',()=>{ui.waveDraft=null;persist();},{read:true})));
}
function saveAssignments(){
 const a=ui.assignment,selected=ui.cartons||[];if(!selected.length)throw new Error('Select exact retained cartons first.');
 if(!transitionConfig().waves.some(w=>w.id===a.waveId))throw new Error('Select an existing wave.');required(a.destination,'Destination');required(a.owner,'Assignment owner');
 if(selected.some(x=>x.periodId!==period().id||x.editionId!==edition().id))throw new Error('Reopen the selected inventory scope before changing its assignments.');
 const ids=new Set(selected.map(x=>x.cartonRef)),t=transitionConfig();
 t.assignments=t.assignments.filter(x=>!(x.periodId===period().id&&x.editionId===edition().id&&ids.has(x.cartonRef)));
 for(const carton of selected)t.assignments.push({periodId:period().id,editionId:edition().id,cartonRef:carton.cartonRef,waveId:a.waveId,destination:a.destination,owner:a.owner,status:a.status||'planned',notes:a.notes||''});
 ui.cartons=[];changed();notice('Updated '+selected.length+' explicit carton assignment(s) in the draft. Prior saved plans remain in source history.');
}
function appendCheckpoint(){
 const c=ui.checkpoint;if(!transitionConfig().waves.some(w=>w.id===ui.waveId))throw new Error('Select the exact wave.');
 const value={periodId:period().id,editionId:edition().id,waveId:ui.waveId,kind:c.kind,status:c.status,owner:required(c.owner,'Checkpoint owner'),note:c.note||'',evidence:cleanEvidence(c.evidence||[]),at:utcNow()};
 transitionConfig().checks.push(value);changed();notice('Appended the attributed checkpoint. The native report evaluates all five named checkpoints and evidence references.');
}
function copyEarlierAssignments(){
 const before=edition().compareToEdition;if(!before)throw new Error('Select the earlier same-period edition in Sources.');
 const t=transitionConfig(),original=t.assignments.filter(x=>x.periodId===period().id&&x.editionId===before),existing=new Set(t.assignments.filter(x=>x.periodId===period().id&&x.editionId===edition().id).map(x=>x.cartonRef));
 const copied=original.filter(x=>!existing.has(x.cartonRef)).map(x=>({...clone(x),editionId:edition().id}));t.assignments.push(...copied);changed();notice('Copied '+copied.length+' explicit original assignments to this correction edition. Its own checkpoint history remains visible separately.');
}
function transition(){
 const t=transitionConfig(),r=reportCurrent()?report()?.transition:null,items=output?.page?.view==='transition'?output.page.items:null,a=ui.assignment,c=ui.checkpoint;
 const setA=(k,v)=>{a[k]=v;persist();},setC=(k,v)=>{c[k]=v;persist();};
 return [heading('Inventory and transfer planning','Join original custody to named carton assignments, accountable waves and five receiving checkpoints.',button('Inspect retained inventory',()=>inspectView('transition','transition'),{primary:true,id:'inspect-transition'}),button('Create wave',()=>editWave(null),{disabled:!!historical,id:'new-wave'})),banner(),
 r?card(txt('h3','Inventory readiness'),dl([['Retained cartons',count(r.cartons)],['Unassigned cartons',count(r.unassigned)],['Multiple assignments',count(r.multipleAssignments)],['Complete waves',count(r.completeWaves)+' / '+count(r.waveCount)]]),r.errors?.length?detail('Assignment and checkpoint corrections',r.errors):null):null,
 card(txt('h3','Named waves'),t.waves.length?table(['Wave','Owner','Target','Assigned / acceptance','Edit'],t.waves.map(w=>{const observed=r?.waves?.find(x=>x.id===w.id);return[el('div',{},txt('strong',w.label),mono(w.id)),w.owner||'—',w.targetAt||'—',observed?el('div',{},count(observed.assignedCartons)+' cartons',badge(observed.acceptanceComplete?'Complete':'Open checkpoints'),small((observed.pendingOrRejected||[]).join(', '))):'Inspect saved inputs',button('Edit wave',()=>editWave(w.id),{disabled:!!historical})];})):empty('No operator wave has been created.'),edition().compareToEdition?button('Copy earlier edition’s explicit assignments',copyEarlierAssignments,{disabled:!!historical}):null),
 waveEditor(),
 pageControls({allowed:[['transition','Inventory assignments'],['cartons','Original cartons'],['checks','Checkpoint history']],tab:'transition'}),
 items?card(txt('h3','Original carton assignments'),table(['Select','Carton / site','Availability at review','Wave / status','Original findings','Open'],items.map(item=>[
 el('input',{type:'checkbox',checked:(ui.cartons||[]).some(x=>x.cartonRef===item.id&&x.periodId===period().id&&x.editionId===edition().id),disabled:!editable()||!reportCurrent(),'aria-label':'Select carton '+item.id,onchange:e=>{selectCarton(item,e.target.checked);render();}}),
 el('div',{},mono(item.id),small(item.carton?.site_ref)),el('div',{},fmt(item.availableAtReviewBoundary),small(item.availabilityBasisAt||'')),
 el('div',{},item.assignment?.waveId||'Unassigned',small(item.assignment?.status||'')),(item.findings||[]).map(s=>badge(s)),button('Inspect custody and assignment',()=>{focusRecord(item,'transition');ui.assignment={...(item.assignment||{}),waveId:item.assignment?.waveId||ui.waveId||t.waves[0]?.id||'',status:item.assignment?.status||'planned'};persist();},{read:true})]))):output?.page?card(recordsTable(output.page.view,output.page.items)):null,
 card(txt('h3','Assign explicit cartons'),txt('p','This operation replaces the selected cartons’ current draft assignments. Existing source revisions retain the earlier plans. Inactive or destroyed cartons stay visible with their original custody state.'),
 row(badge((ui.cartons||[]).length+' selected'),button('Clear carton selection',()=>{ui.cartons=[];persist();},{read:true})),
 (ui.cartons||[]).length?detail('Exact selected cartons',ui.cartons):null,
 el('div',{class:'grid'},field('Wave',select([['','Choose a wave'],...t.waves.map(w=>[w.id,w.label])],a.waveId||'',{disabled:!editable(),id:'assignment-wave',onchange:e=>setA('waveId',e.target.value)})),
 field('Destination',input(a.destination||'',{disabled:!editable(),id:'assignment-destination',oninput:e=>setA('destination',e.target.value)})),
 field('Assignment owner',input(a.owner||'',{disabled:!editable(),id:'assignment-owner',oninput:e=>setA('owner',e.target.value)})),
 field('Recorded status',select(ASSIGNMENT_STATUSES,a.status||'planned',{disabled:!editable(),onchange:e=>setA('status',e.target.value)})),
 field('Operator notes',area(a.notes||'',{disabled:!editable(),oninput:e=>setA('notes',e.target.value)}))),
 button('Replace selected carton assignments',saveAssignments,{primary:true,disabled:!editable()||!(ui.cartons||[]).length,id:'save-assignments'})),
 card(txt('h3','Five receiving checkpoints'),txt('p','Record manifest, custody transfer, destination receipt, inventory reconciliation and access handoff independently. The report lists incomplete, rejected or unreferenced acceptance.'),
 el('div',{class:'grid'},field('Wave',select([['','Choose a wave'],...t.waves.map(w=>[w.id,w.label])],ui.waveId||'',{disabled:!editable(),id:'checkpoint-wave',onchange:e=>{ui.waveId=e.target.value;persist();render();}})),
 field('Checkpoint',select(CHECK_KINDS,c.kind,{disabled:!editable(),id:'checkpoint-kind',onchange:e=>setC('kind',e.target.value)})),
 field('Recorded status',select(CHECK_STATUSES,c.status,{disabled:!editable(),id:'checkpoint-status',onchange:e=>setC('status',e.target.value)})),
 field('Owner',input(c.owner,{disabled:!editable(),id:'checkpoint-owner',oninput:e=>setC('owner',e.target.value)})),
 field('Note',area(c.note,{disabled:!editable(),oninput:e=>setC('note',e.target.value)}))),
 evidenceEditor(c.evidence||(c.evidence=[]),persist),
 row(button('Append named checkpoint',appendCheckpoint,{primary:true,disabled:!editable(),id:'append-checkpoint'}),button('Inspect full checkpoint history',()=>inspectView('checks','transition'),{read:true})),
 ui.waveId?table(['Kind','Latest draft status','Owner','References'],CHECK_KINDS.map(kind=>{const checks=t.checks.filter(x=>x.periodId===period().id&&x.editionId===edition().id&&x.waveId===ui.waveId&&x.kind===kind),last=checks.map((v,i)=>({v,i})).sort((a,b)=>String(a.v.at).localeCompare(String(b.v.at))||a.i-b.i).at(-1)?.v;return[kind,last?.status||'pending',last?.owner||'—',count(last?.evidence?.length||0)];})):null),
 focusPanel()];
}
function beginCooperative(){
 ui.cooperativeDraft=clone(config().cooperative||{supplier:'',contractId:'',leadAgencyId:'',percent:'',roundingMode:'EXACT',creditTreatment:'',reportingTimeZone:'',includedChargeCodes:[],agencyAssignments:[],remittances:[]});
 ui.cooperativeCodes=(ui.cooperativeDraft.includedChargeCodes||[]).join('\n');persist();
}
function applyCooperative(){
 const c=clone(ui.cooperativeDraft);for(const k of ['supplier','contractId','leadAgencyId','reportingTimeZone'])required(c[k],k);
 c.percent=decimalText(c.percent,'Administrative fee percentage');if(!['NET_BILLED','EXCLUDE_CREDITS'].includes(c.creditTreatment))throw new Error('Choose the actual credit treatment.');
 c.includedChargeCodes=(ui.cooperativeCodes||'').split(/\r?\n/).filter(x=>x!=='');if(!c.includedChargeCodes.length||new Set(c.includedChargeCodes).size!==c.includedChargeCodes.length)throw new Error('Declare distinct included charge codes.');
 for(const r of c.remittances){if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(r.month||''))throw new Error('A recorded remittance needs a YYYY-MM month.');required(r.checkWireNumber,'Recorded check/wire number');r.amountMinor=safeInteger(r.amountMinor,'Recorded remittance amount');}
 for(const a of c.agencyAssignments)required(a.invoiceRef,'Original invoice reference');
 config().cooperative=c;ui.cooperativeDraft=null;ui.cooperativeCodes=null;changed();notice('Applied the explicit monthly reporting settings. Build the saved edition for exact grouped amounts and remittance comparison.');
}
function cooperative(){
 const r=reportCurrent()?report()?.cooperative:null,c=ui.cooperativeDraft,set=(k,v)=>{c[k]=v;persist();};
 return [heading('Cooperative monthly reporting','Prepare exact grouped billed-sales and fee reports using the supplied contract, credit policy, timezone and agency IDs.',button(config().cooperative?'Edit reporting inputs':'Configure reporting',beginCooperative,{disabled:!!historical,id:'configure-monthly'}),button('Inspect monthly agency rows',()=>inspectView('cooperative','cooperative'),{primary:true,id:'inspect-monthly'})),banner(),
 config().cooperative?card(txt('h3','Saved / draft reporting basis'),dl([['Supplier',config().cooperative.supplier||'—'],['Contract',config().cooperative.contractId||'—'],['Lead agency',config().cooperative.leadAgencyId||'—'],['Exact percentage text',config().cooperative.percent||'—'],['Reporting timezone',config().cooperative.reportingTimeZone||'—'],['Credit treatment',config().cooperative.creditTreatment||'—'],['Rounding',config().cooperative.roundingMode||'—']]),detail('Included source charge codes',config().cooperative.includedChargeCodes||[])):
 card(txt('h3','No cooperative report has been configured'),txt('p','Supply the actual header, agency mapping, included charge codes, timezone and rounding/credit policy before preparing monthly amounts. This workspace performs no filing or remittance.')),
 c?card(txt('h3','Explicit reporting configuration'),el('div',{class:'grid'},
 ...[['supplier','Supplier name'],['contractId','Contract ID'],['leadAgencyId','Lead agency ID'],['percent','Exact fee percentage'],['reportingTimeZone','Reporting IANA timezone']].map(([k,label])=>field(label,input(c[k]||'',{id:'cooperative-'+k,oninput:e=>set(k,e.target.value),placeholder:k==='reportingTimeZone'?'America/New_York':''}))),
 field('Contract rounding',select(['EXACT','HALF_UP','HALF_EVEN','DOWN','UP'],c.roundingMode,{onchange:e=>set('roundingMode',e.target.value)})),
 field('Credit treatment',select([['','Choose the actual policy'],['NET_BILLED','Net billed charges and credits'],['EXCLUDE_CREDITS','Exclude credits from this reporting basis']],c.creditTreatment,{onchange:e=>set('creditTreatment',e.target.value)})),
 field('Included charge codes — one exact code per line',area(ui.cooperativeCodes||'',{id:'cooperative-codes',oninput:e=>{ui.cooperativeCodes=e.target.value;persist();}}),'The native report lists excluded codes and keeps their original source rows.')),
 txt('h4','Actual invoice-to-agency mapping'),table(['Original invoice reference','Agency ID','Agency name',''],c.agencyAssignments.map((a,index)=>[
 input(a.invoiceRef||'',{oninput:e=>{a.invoiceRef=e.target.value;persist();}}),input(a.agencyId||'',{oninput:e=>{a.agencyId=e.target.value;persist();}}),input(a.agencyName||'',{oninput:e=>{a.agencyName=e.target.value;persist();}}),button('Remove draft mapping',()=>{c.agencyAssignments.splice(index,1);persist();})])),
 button('Add agency mapping',()=>{c.agencyAssignments.push({invoiceRef:'',agencyId:'',agencyName:''});persist();},{id:'add-agency-mapping'}),
 txt('h4','Previously recorded remittances'),table(['Month','Check / wire reference','Amount in minor units',''],c.remittances.map((r,index)=>[
 input(r.month||'',{placeholder:'2026-09',oninput:e=>{r.month=e.target.value;persist();}}),input(r.checkWireNumber||'',{oninput:e=>{r.checkWireNumber=e.target.value;persist();}}),input(r.amountMinor??'',{inputmode:'numeric',oninput:e=>{r.amountMinor=e.target.value;persist();}}),button('Remove draft record',()=>{c.remittances.splice(index,1);persist();})])),
 button('Add recorded remittance',()=>{c.remittances.push({month:'',checkWireNumber:'',amountMinor:''});persist();},{id:'add-remittance'}),
 row(button('Apply monthly configuration',applyCooperative,{primary:true,id:'apply-monthly'}),button('Cancel edit',()=>{ui.cooperativeDraft=null;persist();},{read:true}))):null,
 r?card(txt('h3','Original monthly calculation'),row(badge(r.complete?'Complete report':'Reporting corrections',true),small(count(r.groupCount)+' agency groups · '+count(r.basisRowCount)+' original basis rows')),
 ...(r.months||[]).filter(m=>m.coverage&&m.coverage.complete===false).map(m=>el('div',{class:'inline-note'},txt('strong','Partial calendar-month source · '+m.month),txt('p','The calculated amount covers the retained source interval. A complete monthly report needs the full calendar-month source in the selected reporting timezone.'),dl([['Reporting timezone',m.coverage.reportingTimeZone],['Calendar month starts',m.coverage.monthStart],['Calendar month ends (exclusive)',m.coverage.monthEndExclusive],['Retained source starts',m.coverage.sourcePeriodStart],['Retained source ends (exclusive)',m.coverage.sourcePeriodEndExclusive]]))),
 r.months?.length?table(['Month','Calculated fee minor','Recorded remittance minor','Variance minor','Report / remittance'],r.months.map(m=>[m.month,mono(m.feeMinor),mono(m.remittedMinor),mono(m.varianceMinor),el('div',{},badge(m.reportComplete?'Report complete':'Report review'),badge(m.remittanceRecorded?'Remittance recorded':'No remittance record'))])):empty('No complete monthly row is available yet.'),
 r.errors?.length?detail('Concrete reporting inputs to correct',r.errors):null,detail('Full original reporting summary',r),
 row(button('Inspect complete basis rows',()=>inspectView('cooperative-basis','cooperative'),{read:true}),button('Open invoice review',()=>inspectView('invoices'),{read:true}))):null,
 pageControls({allowed:[['cooperative','Monthly agency rows'],['cooperative-basis','Original fee basis rows']],tab:'cooperative'}),
 output?.page?card(recordsTable(output.page.view,output.page.items)):null,focusPanel()];
}


function originalText(value,keys){for(const k of keys)if(typeof value?.[k]==='string'&&value[k])return value[k];return value?JSON.stringify(value):'—';}
function editRequirement(item){ui.requirement={id:item.id,original:clone(item.original),source:clone(item.source),status:item.response?.status||'draft',response:item.response?.response||'',owner:item.response?.owner||ui.review.owner||'',evidence:clone(item.response?.evidence||[])};persist();}
function saveRequirement(){
 const r=ui.requirement;if(!r)return;const value={id:r.id,status:r.status,response:r.response||'',owner:r.owner||'',evidence:cleanEvidence(r.evidence||[]),at:utcNow()};
 if(value.status==='reviewed')required(value.owner,'Actual reviewer');
 const requirements=config().requirements||(config().requirements={responses:[]});(requirements.responses||(requirements.responses=[])).push(value);
 ui.requirement=null;changed();notice('Appended the attributed response for original question '+value.id+'.');
}
async function importReference(file,kind){
 if(!file)return;if(file.size>8*1024*1024)throw new Error('The original reference exceeds 8 MiB.');
 const b=new Uint8Array(await file.arrayBuffer()),parsed=parseJSON(new TextDecoder('utf-8',{fatal:true}).decode(b),'Original reference'),key=kind==='requirements'?'questions':'items';
 if(!Array.isArray(parsed[key]))throw new Error('Use the original structured reference with a complete '+key+' array.');
 const sha=await digest(b),path='reference/'+sha+'.json';draft.files[path]={base64:to64(b),bytes:b.length,sha256:sha};
 const before=config()[kind]||{};config()[kind]={...before,path,sha256:sha,bytes:b.length,...(kind==='requirements'?{responses:before.responses||[]}:{})};changed();notice('Retained the complete original '+kind+' file with '+parsed[key].length+' entries.');
}
function requirements(){
 const r=reportCurrent()?report():null,page=output?.page,q=ui.requirement,set=(k,v)=>{q[k]=v;persist();};
 return [heading('Original requirements and cost catalog','Read complete source questions and unpriced catalog items. Each answer remains attributed and distinct from a supplier certification.',button('Open technical questions',()=>inspectView('requirements','requirements'),{primary:true,id:'inspect-requirements'}),button('Open source cost catalog',()=>inspectView('catalog','requirements'),{read:true,id:'inspect-cost-catalog'})),banner(),
 card(txt('h3','Reference sources'),dl([['Technical question source',mono(config().requirements?.path)],['Question count',count(r?.requirements?.total)],['Answered / reviewed',count(r?.requirements?.answered)+' / '+count(r?.requirements?.reviewed)],['Cost catalog source',mono(config().catalog?.path)],['Catalog items',count(r?.catalog?.total)],['Original priced items',count(r?.catalog?.priced)]]),
 el('div',{class:'grid'},field('Import original question JSON',el('input',{type:'file',accept:'.json,application/json',disabled:!editable(),onchange:e=>run(()=>importReference(e.target.files[0],'requirements'))}),'Must retain the complete questions array and original workbook/sheet/row identities.'),
 field('Import original cost catalog JSON',el('input',{type:'file',accept:'.json,application/json',disabled:!editable(),onchange:e=>run(()=>importReference(e.target.files[0],'catalog'))}),'Must retain the complete items array; original blank prices remain blank.')),
 row(config().requirements?.path?button('Download complete questions',()=>downloadSource(config().requirements.path),{read:true}):null,config().catalog?.path?button('Download complete cost catalog',()=>downloadSource(config().catalog.path),{read:true}):null)),
 pageControls({allowed:[['requirements','Original technical questions'],['catalog','Original cost catalog']],tab:'requirements'}),
 page?.view==='requirements'?card(table(['Original question','Response / owner','Source location','Edit'],page.items.map(item=>[
 el('div',{},mono(item.id),txt('p',originalText(item.original,['question','text','questionText','description']))),
 el('div',{},badge(item.response?.status||'unanswered'),small(item.response?.owner||''),txt('p',(item.response?.response||'').slice(0,500))),
 el('div',{},fmt(item.original.sheet),small('Row '+fmt(item.original.row)),detail('Original workbook cells',item.original)),
 button('Edit response',()=>editRequirement(item),{disabled:!!historical,id:'question-'+item.id})]))):
 page?.view==='catalog'?card(table(['Source item','Description / unit','Original price','Complete source'],page.items.map(item=>[
 mono(item.id),el('div',{},txt('p',originalText(item.original,['description','item','name','title','service'])),small(item.original.uom||item.original.unit||item.original.unitOfMeasure||'')),
 item.original.unitPrice===null||item.original.unitPrice===undefined?'Unpriced original item':mono(item.original.unitPrice),
 detail('Original catalog row',item)]))):null,
 q?card(txt('h3','Response · '+q.id),txt('p',originalText(q.original,['question','text','questionText','description'])),detail('Complete original question and source',q.original),
 el('div',{class:'grid'},field('Response status',select(['unanswered','draft','reviewed'],q.status,{id:'requirement-status',onchange:e=>set('status',e.target.value)})),field('Owner / reviewer',input(q.owner,{id:'requirement-owner',oninput:e=>set('owner',e.target.value)})),
 field('Complete answer',area(q.response,{class:'wide-json',id:'requirement-response',oninput:e=>set('response',e.target.value)}),null,true)),evidenceEditor(q.evidence||(q.evidence=[]),persist),
 row(button('Append attributed response',saveRequirement,{primary:true,id:'save-requirement-response'}),button('Cancel response edit',()=>{ui.requirement=null;persist();},{read:true}))):null,
 card(txt('h3','Retained response history'),(config().requirements?.responses||[]).length?detail('All attributed responses',config().requirements.responses):empty('No answers have been entered.'))];
}
function customerSample(){
 if(output?.page?.view==='customer-invoices'&&output.page.items.length)return ui.mappingSample&&output.page.items.some(x=>x.id===ui.mappingSample)?output.page.items.find(x=>x.id===ui.mappingSample):output.page.items[0];
 return null;
}
function leafPointers(value,path='',depth=0,result=[]){
 if(depth>9||result.length>350)return result;
 if(value===null||typeof value!=='object'){if(path)result.push({path,value});return result;}
 for(const [key,v]of Object.entries(value)){if(path===''&&['customerFields','unavailableFields'].includes(key))continue;const next=path+'/'+key.replaceAll('~','~0').replaceAll('/','~1');if(v&&typeof v==='object'&&Object.keys(v).length===0)result.push({path:next,value:v});else leafPointers(v,next,depth+1,result);}
 return result;
}
function beginColumns(){ui.columns=clone(config().customer?.columns?.length?config().customer.columns:DEFAULT_COLUMNS);persist();}
function applyColumns(){validateColumns(ui.columns);config().customer={...(config().customer||{}),columns:clone(ui.columns)};ui.columns=null;changed();notice('Applied the customer column map to the draft. The next saved build reports available, null and unavailable projected fields.');}
function columnEditor(){
 const sample=customerSample(),columns=ui.columns,choices=sample?leafPointers(sample):[];
 return card(txt('h3','Customer field mapping'),txt('p','The preview comes from the original customer-invoices projection. Private source rows and review notes stay outside this projection. Existing null values and unavailable paths are reported separately.'),
 row(button(columns?'Reset editor to current map':'Edit customer columns',beginColumns,{disabled:!!historical,id:'edit-customer-columns'}),button('Inspect original customer projection',()=>inspectView('customer-invoices','delivery'),{read:true,id:'inspect-customer-projection'})),
 sample?el('div',{},field('Actual projected invoice',select(output.page.items.map(x=>[x.id,x.values?.invoice_ref+' · '+x.id]),sample.id,{onchange:e=>{ui.mappingSample=e.target.value;persist();render();}})),detail('Complete customer projection',sample),sample.unavailableFields?.length?detail('Unavailable configured paths',sample.unavailableFields):null):empty('Open an original customer-projection page to inspect actual available fields.'),
 columns?el('div',{},table(['Output column','RFC6901 projected field','Actual value / availability','Order'],columns.map((c,index)=>{
 const value=sample?pointer(sample,c.path):undefined;
 return [input(c.name,{disabled:!editable(),oninput:e=>{c.name=e.target.value;persist();}}),input(c.path,{disabled:!editable(),list:'customer-pointers',oninput:e=>{c.path=e.target.value;persist();}}),sample?(value===undefined?badge('Path unavailable'):value===null?badge('Present null'):mono(value)):'Open a projected invoice',
 row(button('Up',()=>{[columns[index-1],columns[index]]=[columns[index],columns[index-1]];persist();},{disabled:index===0||!!historical}),button('Down',()=>{[columns[index+1],columns[index]]=[columns[index],columns[index+1]];persist();},{disabled:index===columns.length-1||!!historical}),button('Remove',()=>{columns.splice(index,1);persist();},{disabled:!!historical}))];
 })),
 el('datalist',{id:'customer-pointers'},choices.map(x=>el('option',{value:x.path}))),
 row(button('Add output column',()=>{columns.push({name:'',path:'/values/'});persist();},{disabled:!!historical}),button('Apply customer columns',applyColumns,{primary:true,disabled:!!historical,id:'apply-customer-columns'}),button('Cancel column editor',()=>{ui.columns=null;persist();},{read:true})),
 choices.length?detail('Actual projected field pointers',choices):null):
 table(['Current output column','Projected field'],(config().customer?.columns?.length?config().customer.columns:DEFAULT_COLUMNS).map(c=>[c.name,mono(c.path)])),
 reportCurrent()&&report()?.customerMapping?detail('Original whole-source mapping coverage',report().customerMapping):null);
}
function deliveryCommand(audience='operator'){
 if(!preview||preview.status!=='COMPLETED'||preview.function!=='build_records'||!report())throw new Error('Open a completed build_records result for the full source-bound export.');
 const d=ui.delivery,product=required(d.productDirectory,'Product source directory'),runtime=required(d.sourceRoot,'Original runtime source root'),directory=required(d.directory,'Existing workbench directory'),out=required(d.output,'New output directory');
 const argv=['node',product.replace(/\/$/,'')+'/workbench.mjs','handoff','--source-root',runtime,'--dir',directory,'--preview',preview.id,'--out',out,'--audience',audience];if(d.python)argv.push('--python',d.python);
 return '# Existing completed build: '+preview.id+'\n# Saved source revision: '+preview.revisionId+'\n# Original period / edition: '+report().period.id+' / '+report().edition.id+'\n# The original handoff writes full files into a new destination.\n'+argv.map(shell).join(' ')+'\n';
}
function receivingCommands(){
 const d=ui.delivery,product=required(d.productDirectory,'Product source directory').replace(/\/$/,''),runtime=required(d.sourceRoot,'Original runtime source root');
 return [['node',product+'/workbench.mjs','import','--source-root',runtime,'--dir','./received-records-workbench','--bundle','records-operator.python-workspace.json'],['node',product+'/workbench.mjs','serve','--source-root',runtime,'--dir','./received-records-workbench']].map(a=>a.map(shell).join(' ')).join('\n')+'\n';
}
function operationHistory(){
 const previews=state.previews.filter(p=>FUNCTIONS.has(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return previews.length?card(txt('h3','Retained operation history'),table(['Operation / original identity','Saved source','Status','Created','Open'],previews.map(p=>[
 el('div',{},txt('strong',p.function),small(p.id)),mono(p.revisionId),badge(p.status),p.createdAt,
 button('Open retained result',()=>openPreview(p.id),{read:true,id:'open-preview-'+p.id})]))):null;
}
function delivery(){
 const files=output?.files||[],d=ui.delivery,set=(k,v)=>{d[k]=v;persist();};let command,error;try{command=deliveryCommand(d.audience||'operator');}catch(e){error=e.message;}
 return [heading('Customer and operator handoff','Map the original customer projection, reopen compact reports and export every selected source row through the complete original handoff.',
 button(dirty()?'Save & build operator report':'Build operator report',()=>startPreview('build_records'),{primary:true,id:'build-operator'}),
 button('Build customer report',()=>startPreview('customer_records'),{id:'build-customer'})),banner(),columnEditor(),
 output?.page?.view==='customer-invoices'?card(pageControls({allowed:[['customer-invoices','Original customer projection']],tab:'delivery'}),recordsTable('customer-invoices',output.page.items)):null,
 preview?.result?card(txt('h3','Exact retained output'),dl([['Operation',mono(preview.id)],['Function',preview.function],['Revision',mono(preview.revisionId)],['Period / edition',(report()?.period?.id||'—')+' / '+(report()?.edition?.id||'—')],['Complete output bytes',bytes(preview.result.bytes)],['SHA256',mono(preview.result.sha256)]]),
 button('Download complete native output',()=>download('/api/preview-output?id='+encodeURIComponent(preview.id),'records-operation-output.json'),{read:true,id:'download-native-output'})):null,
 files.length?card(txt('h3',preview.function==='customer_records'?'Customer report files':'Operator report files'),table(['File','Exact original identity','Download'],files.map(f=>[
 txt('strong',f.name),el('div',{},small(bytes(f.bytes)),mono(f.sha256)),button('Download '+f.name,()=>saveBytes(enc.encode(f.body),f.name,f.contentType||'application/octet-stream'),{read:true,id:'download-'+f.name.replaceAll('.','-')})]))):null,
 card(txt('h3','Complete ledger and AP handoff'),txt('p','The existing wrapper selects this completed build’s exact source revision, processes all rows through the same engine and writes the full customer CSV/NDJSON, AP reconciliation, inventory, transition, cooperative and requirement files. Operator delivery additionally retains the original request, calculation, corrections, private reviews and complete portable workspace.'),
 el('div',{class:'grid'},
 field('Product source directory',input(d.productDirectory||'',{id:'handoff-product',placeholder:'/path/to/records-product',oninput:e=>set('productDirectory',e.target.value)}),'The delivered application directory containing workbench.mjs.'),
 field('Original runtime source root',input(d.sourceRoot||'',{id:'handoff-runtime',placeholder:'/path/to/maintained-package/source',oninput:e=>set('sourceRoot',e.target.value)})),
 field('Existing workbench directory',input(d.directory||'',{id:'handoff-directory',placeholder:'./records-workbench',oninput:e=>set('directory',e.target.value)}),'The directory containing operation.json and the existing workspace/ store.'),
 field('New output directory',input(d.output||'',{id:'handoff-output',placeholder:'./records-delivery',oninput:e=>set('output',e.target.value)})),
 field('Audience',select([['operator','Complete operator and customer handoff'],['customer','Customer files only']],d.audience||'operator',{id:'handoff-audience',onchange:e=>{set('audience',e.target.value);render();}})),
 field('Python executable (optional)',input(d.python||'',{oninput:e=>set('python',e.target.value)}))),
 row(button('Refresh export command',()=>{persist();notice('Command now uses the displayed source and directory selections.');},{read:true}),
 button('Download full export command',()=>saveBytes(enc.encode(deliveryCommand(d.audience||'operator')),'records-complete-export.txt','text/plain'),{read:true,disabled:!!error,id:'download-export-command'})),
 error?txt('p',error):detail('Exact saved-source export command',command)),
 card(txt('h3','Portable source and history'),txt('p','Download the original workspace to retain every source edition, attributed decision, native result and saved revision. Create-only import reopens the same history in a new destination.'),
 row(button('Download complete workspace',()=>download('/api/export','records-operator.python-workspace.json'),{read:true,id:'export-workspace'}),
 button('Download original receiving commands',()=>saveBytes(enc.encode(receivingCommands()),'records-receiving-commands.txt','text/plain'),{read:true,id:'download-receiving-commands'}))),
 operationHistory()];
}


function mergeValue(base,local,remote,path,conflicts){
 if(same(local,base))return clone(remote);if(same(remote,base)||same(local,remote))return clone(local);
 if(Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)&&
 (path==='reviews'||path.endsWith('.checks')||path==='requirements.responses')&&same(local.slice(0,base.length),base)&&same(remote.slice(0,base.length),base)){
  return [...clone(remote),...clone(local.slice(base.length).filter(x=>!remote.slice(base.length).some(y=>same(x,y))))];
 }
 if(Array.isArray(local)&&Array.isArray(remote)&&(/(?:^|\.)(periods|editions|sources|waves)$/.test(path))){
  const ids=[...new Set([...remote.map(x=>x.id),...local.map(x=>x.id)])];
  if([...local,...remote].some(x=>typeof x?.id!=='string')||new Set(local.map(x=>x.id)).size!==local.length||new Set(remote.map(x=>x.id)).size!==remote.length){conflicts.push(path);return clone(local);}
  return ids.map(id=>mergeValue((base||[]).find(x=>x.id===id),local.find(x=>x.id===id),remote.find(x=>x.id===id),path+'.'+id,conflicts)).filter(x=>x!==undefined);
 }
 if(local&&remote&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(local)&&!Array.isArray(remote)&&(base===undefined||base&&typeof base==='object'&&!Array.isArray(base))){
  const merged=Object.create(null);for(const k of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])){const v=mergeValue(base?.[k],local[k],remote[k],path?path+'.'+k:k,conflicts);if(v!==undefined)merged[k]=v;}return merged;
 }
 conflicts.push(path||'workspace');return clone(local);
}
async function mergeLatest(){
 state=await api('/api/state');const remote=await readConfig(state.revision),conflicts=[],merged=mergeValue(draft.baseConfig,draft.config,remote,'',conflicts);
 if(conflicts.length){ui.latestConfiguration=remote;persist();throw new Error('Both local and saved source changed '+conflicts.join(', ')+'. Both configurations remain available below for an explicit merge.');}
 for(const [path,f]of Object.entries(draft.files)){const saved=state.revision.files.find(x=>x.path===path),sha=f.sha256||await digest(fileBytes(f));if(saved&&saved.sha256!==sha)throw new Error('The saved source has different bytes at '+path+'. Retain both original captures while resolving the path.');}
 validateConfig(merged);checkHistory(remote,merged);draft.base=clone(state.revision);draft.baseConfig=clone(remote);draft.config=merged;ui.latestConfiguration=null;changed();notice('Merged independent local changes with the current saved revision. All attributed history is retained.');
}
async function openHistorical(id){
 const r=await api('/api/revision?id='+encodeURIComponent(id));historical={revision:r,config:await readConfig(r)};ui.configuration=null;clearSelection();
 const found=state.previews.filter(p=>p.revisionId===id&&FUNCTIONS.has(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));if(found.length)await openPreview(found[0].id);else{preview=null;output=null;outputId=null;}
 persist();notice('Opened historical source. Your working draft remains retained separately.');
}
async function restoreHistorical(){
 if(!historical)return;const selected=historical.revision,previous=dirty()?clone(draft):null;
 state=await api('/api/state');
 await mutate('/api/restore',{expectedHead:state.workspace.head,revisionId:selected.id,note:'Restore records source '+selected.id+' [records-restore-'+crypto.randomUUID()+']'},'restore');
 state=await api('/api/state');await adoptHead();draft.previous=previous;clearSelection();persist();notice('Restored the selected source as a new revision. Earlier source and operation history remain available.');
}
async function importLocalDraft(file){
 if(!file)return;const value=parseJSON(await file.text(),'Retained local draft');if(value.schema!=='tj.records-operator-draft.v1'||value.workspaceId!==namespace||!value.draft?.base?.id||!state.revisions.some(r=>r.id===value.draft.base.id))throw new Error('Choose a local draft belonging to this exact workspace and an existing source revision.');
 validateConfig(value.draft.config);const previous=clone(draft);draft=clone(value.draft);draft.previous=previous;ui={...ui,...clone(value.ui||{})};historical=null;ui.tab='history';persist();notice('Reopened the retained local draft. Merge with current saved source if its head has advanced.');
}
function historyView(){
 const files=revision().files;
 return [heading('Source history and recovery','Reopen exact source revisions and retained results, recover local edits and restore prior source as a new revision.'),
 historical?card(txt('h3','Historical source '+short(revision().id)),txt('p',revision().note||''),row(button('Return to working draft',()=>{historical=null;ui.configuration=null;clearSelection();persist();},{read:true,id:'return-to-draft'}),button('Restore as a new revision',restoreHistorical,{primary:true,id:'restore-revision'}))):null,
 card(txt('h3','Local operator draft'),dl([['Based on saved revision',mono(draft.base.id)],['Current head',mono(state.workspace.head)],['Applied draft changes',String(dirty())],['Draft persistence',storageFailure?storageFailure.message:'Original browser workspace storage']]),
 field('Revision note',input(ui.revisionNote,{disabled:!editable(),id:'revision-note',oninput:e=>{ui.revisionNote=e.target.value;changed();}})),
 row(button('Download complete local draft',()=>saveBytes(enc.encode(json(snapshot())+'\n'),'records-local-operator-draft.json','application/json'),{read:true,id:'download-local-draft'}),
 button('Merge current saved source',mergeLatest,{disabled:!!historical||!dirty()||draft.base.id===state.workspace.head,id:'merge-current'}),
 button('Open current saved source',async()=>{state=await api('/api/state');await adoptHead(dirty());clearSelection();notice('Opened the current source. A prior working draft remains available below.');},{read:true})),
 field('Reopen a retained local draft',el('input',{type:'file',accept:'.json,application/json',onchange:e=>run(()=>importLocalDraft(e.target.files[0]))})),
 draft.previous?button('Recover previous working draft',()=>{draft=clone(draft.previous);historical=null;ui.configuration=null;clearSelection();persist();notice('Recovered the prior local draft; source history remains unchanged.');},{read:true}):null),
 card(txt('h3','Original source revisions'),table(['Revision','Created','Source note','Size','Open'],[...state.revisions].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>[
 el('div',{},mono(r.id),r.id===state.workspace.head?badge('Current'):null),r.createdAt,r.note||'—',small(count(r.files)+' files · '+bytes(r.bytes)),button('Open saved revision',()=>openHistorical(r.id),{read:true,id:'open-revision-'+r.id})]))),
 card(txt('h3','Complete saved configuration'),txt('p','Advanced edits preserve every unknown application field and append original attributed review, checkpoint and response history. Use the normal source editors for exact file mapping and correction identities.'),
 area(ui.configuration??json(config()),{class:'wide-json',disabled:!editable(),id:'workspace-json',oninput:e=>{ui.configuration=e.target.value;persist();}}),
 row(button('Apply complete configuration',()=>{const c=parseJSON(ui.configuration??json(config()),'Workspace configuration');validateConfig(c);checkHistory(draft.baseConfig,c);draft.config=c;ui.configuration=null;clearSelection();changed();notice('Applied the complete configuration to the local draft.');},{disabled:!!historical,id:'apply-workspace-json'}),
 button('Download working configuration',()=>saveBytes(enc.encode(json(config())+'\n'),'workspace.json','application/json'),{read:true})),
 ui.latestConfiguration?detail('Concurrent current configuration for explicit merge',ui.latestConfiguration):null),
 card(txt('h3','Exact saved files'),el('div',{class:'file-list'},table(['Source path','Bytes','SHA256','Download'],files.map(f=>[mono(f.path),bytes(f.bytes),mono(f.sha256),button('Download original',()=>downloadSource(f.path),{read:true})])))),
 operationHistory(),pending?detail('Original pending mutation',pending):null];
}
function render(){
 if(!state||!draft)return;renderTop();
 $('#navigation').replaceChildren(...TABS.map(([id,label])=>el('button',{type:'button','aria-current':ui.tab===id?'page':null,onclick:()=>go(id)},label)));
 const views={overview,sources,inspection,transition,cooperative,requirements,delivery,history:historyView};
 $('#content').replaceChildren(...(views[ui.tab]||overview)().filter(Boolean));
}
async function boot(){
 if(!token)throw new Error('Open the complete operator URL printed by the records workbench serve command.');
 state=await api('/api/state');namespace=state.workspace.id+':records-operator';store=createDraftStore(namespace);
 const [saved,request]=await Promise.all([store.readDraft(),store.readPending()]);
 if(saved?.schema==='tj.records-operator-draft.v1'&&saved.workspaceId===namespace&&saved.draft?.base?.id&&state.revisions.some(r=>r.id===saved.draft.base.id)){
  draft=saved.draft;ui={...ui,...saved.ui};if(!dirty()&&draft.base.id!==state.workspace.head)await adoptHead();
 }else await adoptHead();
 pending=request?.workspaceId===namespace?request.request:null;
 if(!TABS.some(([id])=>id===ui.tab))ui.tab='overview';
 const latest=state.previews.filter(p=>p.revisionId===draft.base.id&&FUNCTIONS.has(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));if(latest.length)await openPreview(latest[0].id);render();
}
addEventListener('beforeunload',event=>{if(dirty()||pending||busy||persistRequested||ui.attachments.length||ui.sourceDraft?.edited||ui.cooperativeDraft||ui.columns||ui.requirement||ui.correction){event.preventDefault();event.returnValue='';}});
addEventListener('pagehide',()=>clearTimeout(pollTimer));
boot().catch(e=>{notice(e.message||String(e),true);$('#content').replaceChildren(empty('Reopen the current operator URL. Saved source and native history remain in the existing workspace.'));});
