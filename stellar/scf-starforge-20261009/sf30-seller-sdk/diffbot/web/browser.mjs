// Diffbot dataset operator over the original retained PythonWorkspace.
import {createDraftStore} from '/local-draft-store.mjs';
import {mountRecurring} from './recurring/recurring.mjs';

const $ = selector => document.querySelector(selector);
const clone = value => structuredClone(value);
const json = value => JSON.stringify(value, null, 2);
const enc = new TextEncoder();
const SCHEMA = 'tj.diffbot-workspace.v1';
const REPORT = 'tj.diffbot-dataset-report.v1';
const TABS = [['overview','Overview'],['sources','Sources & acquisition'],['review','Dataset review'],['mapping','Customer columns'],['recurring','Recurring delivery'],['delivery','Files & handover'],['history','History']];
const DEFAULT_COLUMNS = {'Record':'/id','Type':'/kind','Title':'/fields/title','Source':'/sourceUrl','Provider identity':'/providerId','Review':'/review/decision'};
const SOURCE_FORMATS = [['diffbot-extract-json','Extract / Analyze JSON'],['diffbot-bulk-data-json','Bulk complete data array'],['diffbot-bulk-status-json','Bulk status JSON'],['diffbot-bulk-url-report-csv','Bulk URL report CSV'],['diffbot-safe-capture-v1','Acquisition safe-capture wrapper']];
const PAGE_SIZE = 40;
const terminal = status => !['QUEUED','RUNNING'].includes(status);
const short = value => value ? String(value).slice(0, 14) : '—';
const fmt = value => value === undefined || value === null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const when = value => value ? new Date(value).toLocaleString() : '—';
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const byteText = n => Number.isFinite(n) ? n.toLocaleString() + ' B' : '—';
function element(tag,attrs={},...children){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)){
    if(value===null||value===undefined||value===false)continue;
    if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2),value);
    else if(key==='class')node.className=value;
    else if(['value','checked','disabled','selected','readOnly'].includes(key))node[key]=value;
    else node.setAttribute(key,value===true?'':String(value));
  }
  for(const child of children.flat(Infinity))if(child!==undefined&&child!==null&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
const text=(tag,value,attrs={})=>element(tag,attrs,value);
const small=value=>text('small',value);
const mono=value=>text('code',fmt(value));
const row=(...children)=>element('div',{class:'button-row'},children);
const card=(...children)=>element('section',{class:'card'},children);
const badge=(value,strong=false)=>text('span',value,{class:'badge'+(strong?' strong':'')});
const empty=value=>text('p',value,{class:'empty'});
const detail=(title,value)=>element('details',{},text('summary',title),element('div',{class:'details-body'},text('pre',typeof value==='string'?value:json(value))));
function field(label,control,hint,full=false){const id=control.id||'f-'+crypto.randomUUID();control.id=id;return element('div',{class:'field'+(full?' full':'')},text('label',label,{for:id}),control,hint?small(hint):null);}
const input=(value,attrs={})=>element('input',{type:'text',value:value??'',...attrs});
const area=(value,attrs={})=>element('textarea',{class:'code',value:value??'',spellcheck:'false',...attrs});
function select(options,value,attrs={}){return element('select',attrs,options.map(option=>{const pair=Array.isArray(option)?option:[option,option];return element('option',{value:pair[0],selected:pair[0]===value},pair[1]);}));}
function button(label,fn,{primary=false,disabled=false,id=null,read=false}={}){
  return element('button',{type:'button',class:primary?'primary':'',id,disabled:disabled||busy||(!read&&Boolean(pending)),onclick:()=>run(fn)},label);
}
function table(headers,rows){return element('div',{class:'table-wrap'},element('table',{},element('thead',{},element('tr',{},headers.map(h=>text('th',h,{scope:'col'})))),element('tbody',{},rows.map(cells=>element('tr',{},cells.map(cell=>element('td',{},cell)))))));}
function heading(title,description,...actions){return element('div',{class:'section-head'},element('div',{},text('h2',title),text('p',description)),row(actions));}

function sourceLink(url,label){try{const parsed=new URL(url);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)return element('a',{href:parsed.href,target:'_blank',rel:'noreferrer'},label||url);}catch{}return text('span',label||fmt(url));}
function definitions(rows){return element('dl',{},rows.flatMap(([key,value])=>[text('dt',key),element('dd',{},value)]));}
const storageKey='python-merchant-workspace:'+location.origin+':token';
const tokenFromHash=()=>{
  const value=location.hash.slice(1);return /^[a-f0-9]{64}$/.test(value)?value:new URLSearchParams(value).get('token')||'';
};
let token=tokenFromHash();
try {token ||= sessionStorage.getItem(storageKey)||'';if(token)sessionStorage.setItem(storageKey,token);}catch{}
if(tokenFromHash())history.replaceState(null,'',location.pathname+location.search);
addEventListener('hashchange',()=>{if(tokenFromHash())location.reload();});
let state=null,draft=null,historical=null,preview=null,report=null,reportId=null,busy=false,pending=null;
let store=null,namespace=null,writeQueue=Promise.resolve(),storageFailure=null,pollTimer=null,persistTimer=null,persistRequested=false;
let ui={tab:'overview',search:'',reviewFilter:'all',kind:'all',page:0,selected:[],focused:null,reviewer:'',reviewNote:'',reviewStatus:'revisit',capture:null,importForm:null,configText:null,acquisition:{},mappingRows:null};
let recurringMount=null,recurringSaveInFlight=false;
const fileCache=new Map();
const activeConfig=()=>historical?.config||draft?.config;
const activeRevision=()=>historical?.revision||draft?.base;
const selectedEdition=()=>activeConfig()?.editions?.find(e=>e.id===activeConfig().selectedEdition)||null;
const dirty=()=>Boolean(draft&&(!same(draft.config,draft.baseConfig)||Object.keys(draft.files).length||draft.note.trim()));
const editable=()=>!historical&&!busy&&!pending;
const sourceDirty=()=>Boolean(draft&&(!same(draft.config.editions,draft.baseConfig.editions)||draft.config.selectedEdition!==draft.baseConfig.selectedEdition||!same(draft.config.resolutions||[],draft.baseConfig.resolutions||[])));
const reportCurrent=()=>Boolean(report&&reportId===preview?.id&&preview?.revisionId===activeRevision()?.id&&report.edition?.id===activeConfig()?.selectedEdition);
const reviewEnabled=()=>editable()&&reportCurrent()&&report.ready!==false&&!sourceDirty();

function notice(message,issue=false){$('#notice').textContent=message;$('#notice').className=issue?'issue':'';$('#notice').hidden=false;}
function clearNotice(){$('#notice').hidden=true;}
async function run(fn){
  if(busy)return;
  busy=true;render();
  try{await fn();}catch(error){notice(error.message||String(error),true);}
  finally{busy=false;render();}
}
async function api(route,body){
  const options={cache:'no-store',headers:{'X-Python-Workspace-Token':token}};
  if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  let response;
  try{response=await fetch(route,options);}catch(cause){const error=new Error('The local server did not return a response. The exact request and current draft remain retained.');error.unknownOutcome=body!==undefined;error.cause=cause;throw error;}
  let value;
  try{value=await response.json();}catch{const error=new Error('The local response was incomplete. Reconcile the retained operation before repeating it.');error.unknownOutcome=body!==undefined;throw error;}
  if(!response.ok){const error=new Error(value.message||value.error?.message||value.error||'Local request failed: '+response.status);error.status=response.status;error.code=value.error;error.unknownOutcome=body!==undefined&&response.status>=500;throw error;}
  return value;
}
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function decodeBase64(value){const s=atob(value),bytes=new Uint8Array(s.length);for(let i=0;i<s.length;i++)bytes[i]=s.charCodeAt(i);return bytes;}
function saveBytes(bytes,name,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type}));const link=element('a',{href:url,download:name,hidden:true});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function download(route,fallback){
  const response=await fetch(route,{headers:{'X-Python-Workspace-Token':token},cache:'no-store'});
  if(!response.ok){let value={};try{value=await response.json();}catch{}throw new Error(value.message||value.error||'Download returned '+response.status+'.');}
  const bytes=new Uint8Array(await response.arrayBuffer()),expected=response.headers.get('x-content-sha256');
  if(expected&&await digest(bytes)!==expected)throw new Error('The complete download differs from its retained server digest. Reopen this same saved output.');
  const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||fallback;
  saveBytes(bytes,name,response.headers.get('content-type')||'application/octet-stream');
  return bytes;
}
function snapshot(){return {workspaceId:namespace,schema:'tj.diffbot-operator-local.v1',draft:clone(draft),ui:clone(ui)};}
function persist(){
  if(!store||!draft)return;
  persistRequested=true;clearTimeout(persistTimer);
  persistTimer=setTimeout(()=>{persistTimer=null;flushDraft().catch(()=>{});},180);
}
async function flushDraft(){
  clearTimeout(persistTimer);persistTimer=null;
  writeQueue=writeQueue.catch(()=>{}).then(async()=>{
    if(!persistRequested&&!storageFailure)return;
    persistRequested=false;await store.writeDraft(snapshot());storageFailure=null;
  });
  try{await writeQueue;}catch(error){storageFailure=error;notice(error.message+' Download the local draft from History to retain it outside this browser.',true);throw error;}
  finally{renderSaveState();}
}
function changed(){ui.configText=null;persist();renderSaveState();}
async function currentFile(revision,path){
  const key=revision+':'+path;
  if(!fileCache.has(key))fileCache.set(key,await api('/api/file?revision='+encodeURIComponent(revision)+'&path='+encodeURIComponent(path)));
  return fileCache.get(key);
}
async function readConfig(revision){
  const record=await currentFile(revision.id,'workspace.json');
  if(typeof record.text!=='string')throw new Error('The saved workspace.json is not UTF-8 text.');
  let config;try{config=JSON.parse(record.text.replace(/^\uFEFF/,''));}catch{throw new Error('The saved workspace.json is not valid JSON. Open the original engineering editor to repair it.');}
  if(config.schema!==SCHEMA||!Array.isArray(config.editions))throw new Error('This source is not a supported Diffbot dataset workspace.');
  return config;
}
async function adoptHead({preservePrevious=false}={}){
  const previous=preservePrevious&&draft?clone(draft):null;
  const config=await readConfig(state.revision);
  draft={base:clone(state.revision),baseConfig:clone(config),config:clone(config),files:{},note:'',previous};
  historical=null;ui.configText=null;ui.queryText=null;ui.mappingRows=null;ui.selected=[];ui.focused=null;ui.page=0;ui.capture=null;ui.importForm=null;persist();
}
async function refresh({pickReport=true}={}){
  state=await api('/api/state');
  if(!draft||!dirty())await adoptHead();
  if(pickReport&&!historical){
    const candidates=state.previews.filter(p=>['inspect_dataset','build_dataset'].includes(p.function)&&p.revisionId===draft.base.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(candidates.length&&(!preview||preview.revisionId!==draft.base.id))await openPreview(candidates[0].id);
  }
}
async function clearPending(){pending=null;await store.deletePending();}
async function mutate(route,body,kind){
  if(pending)throw new Error('Reconcile the retained operation before starting another change.');
  await flushDraft();
  pending={route,body:clone(body),kind,startedAt:new Date().toISOString()};
  await store.writePending({workspaceId:namespace,request:pending});renderRecovery();
  try{const result=await api(route,body);await clearPending();return result;}
  catch(error){if(!error.unknownOutcome)await clearPending();throw error;}
}
async function saveDraft(){
  if(historical)throw new Error('Return to the working draft before saving.');
  if(!dirty())return state.revision;
  if(draft.base.id!==state.workspace.head)throw new Error('The current saved source changed. Merge the retained draft with the latest revision from History before saving.');
  assertHistoryPrefix(draft.baseConfig,draft.config);
  assertReviewedSourcesStable(draft.baseConfig,draft.config);
  noCredentials(draft.config);
  const operation='diffbot-save-'+crypto.randomUUID();
  const files=[{path:'workspace.json',text:json(draft.config)+'\n'},...Object.entries(draft.files).map(([path,file])=>({path,text:file.text}))];
  const payload={expectedHead:draft.base.id,baseRevision:draft.base.id,note:(draft.note.trim()||'Dataset source, review and delivery')+' ['+operation+']',files};
  const saved=await mutate('/api/revisions',payload,'save');
  state=await api('/api/state');await adoptHead();notice('Saved dataset workspace revision '+short(saved.id)+'.');
  return saved;
}
async function recover(){
  if(!pending)return;
  const request=clone(pending);state=await api('/api/state');
  if(request.kind==='preview'){
    const existing=state.previews.find(p=>p.operationId===request.body.operationId);
    const result=existing?await api('/api/preview?id='+encodeURIComponent(existing.id)):await api(request.route,request.body);
    await clearPending();await openPreview(result.id);notice('Reopened the same retained native preview.');return;
  }
  const match=state.revisions.find(r=>r.parent===request.body.expectedHead&&r.note===request.body.note);
  if(match){
    const revision=await api('/api/revision?id='+encodeURIComponent(match.id));
    if(request.kind==='restore'&&revision.restoredFrom!==request.body.revisionId)throw new Error('The selected recovery revision has another restore source.');
    if(request.kind==='save')for(const file of request.body.files){const expected=await digest(enc.encode(file.text));if(!revision.files.some(r=>r.path===file.path&&r.sha256===expected))throw new Error('The recovered source revision differs from the retained request.');}
    await clearPending();await adoptHead({preservePrevious:request.kind==='restore'&&dirty()});notice('Recovered saved revision '+short(match.id)+' without saving it again.');return;
  }
  if(state.operator.busy)throw new Error('The original server is still completing an action. Refresh its saved outcome when it finishes.');
  if(state.workspace.head!==request.body.expectedHead){
    await clearPending();notice('Another saved revision is now current. The original expected-head request cannot overwrite it; your local draft remains available for a merge.',true);return;
  }
  await api(request.route,request.body);await clearPending();state=await api('/api/state');await adoptHead({preservePrevious:request.kind==='restore'&&dirty()});notice('Completed the retained request against its original unchanged head.');
}
async function startPreview(fn,targetTab=null){
  if(historical)throw new Error('Return to the current source to start an operation.');
  if(dirty())await saveDraft();
  const edition=draft.config.selectedEdition;
  const result=await mutate('/api/preview',{revisionId:draft.base.id,function:fn,input:{editionId:edition},operationId:'diffbot-'+crypto.randomUUID()},'preview');
  ui.tab=targetTab||(fn==='build_dataset'?'delivery':'review');await openPreview(result.id);persist();
}
async function loadOutput(record){
  const response=await fetch('/api/preview-output?id='+encodeURIComponent(record.id),{headers:{'X-Python-Workspace-Token':token},cache:'no-store'});
  if(!response.ok){const problem=await response.json();throw new Error(problem.message||'The retained output is unavailable.');}
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==record.result.bytes||await digest(bytes)!==record.result.sha256)throw new Error('The complete native preview output does not match its retained identity.');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(value.schema!==REPORT||(!Array.isArray(value.records)&&value.ready!==false))throw new Error('This native output uses a different dataset report contract.');
  for(const file of value.files||[]){
    if(!/^[A-Za-z0-9_.-]{1,200}$/.test(file.name)||typeof file.body!=='string')throw new Error('A generated customer file has an unsupported name or body.');
    const body=enc.encode(file.body);
    if(body.length!==file.bytes||await digest(body)!==file.sha256)throw new Error('Generated file '+file.name+' differs from the retained native build.');
  }
  report=value;reportId=record.id;
}
async function openPreview(id){
  const record=await api('/api/preview?id='+encodeURIComponent(id));preview=record;
  if(reportId!==record.id){report=null;reportId=null;}
  if(record.status==='COMPLETED'&&record.result){if(reportId!==record.id)await loadOutput(record);}
  else if(terminal(record.status)){report=null;reportId=null;}
  schedulePoll();
}
function schedulePoll(){
  clearTimeout(pollTimer);
  if(!preview||terminal(preview.status))return;
  pollTimer=setTimeout(async()=>{
    if(busy){schedulePoll();return;}
    try{await openPreview(preview.id);state=await api('/api/state');render();}
    catch(error){notice(error.message+' Use Refresh to reopen the retained result.',true);}
  },1400);
}
async function cancelPreview(){
  if(!preview||terminal(preview.status))return;
  await api('/api/preview/cancel',{id:preview.id});await openPreview(preview.id);notice('The original preview was cancelled and its source worker closed.');
}
function renderSaveState(){
  const node=$('#save-state');if(!node)return;
  node.replaceChildren(badge(historical?'Historical revision':dirty()?'Local changes':'Saved',dirty()),small(storageFailure?'Browser draft storage needs attention':draft?.base.id!==state?.workspace.head?'A newer saved source is available':draft?'Revision '+short(draft.base.id):''),
    button('Save draft',saveDraft,{primary:true,disabled:!draft||!dirty()||Boolean(historical),id:'save-draft'}));
}
function renderHeader(){
  if(!state)return;
  $('#workspace-label').textContent=state.workspace.label||draft?.config.title||state.workspace.id;
  $('#header-actions').replaceChildren(button('Refresh',async()=>{await refresh({pickReport:false});if(preview)await openPreview(preview.id);notice('Current saved state and retained operation refreshed.');},{read:true,id:'refresh-state'}),
    element('a',{href:'/#'+token,target:'_blank',rel:'noreferrer'},'Engineering workspace'));
  $('#footer-state').textContent='Workspace '+state.workspace.id+' · '+state.revisions.length+' saved revisions';
  renderSaveState();renderRecovery();
}
function renderRecovery(){
  const node=$('#recovery');if(!node)return;
  node.hidden=!pending;if(!pending)return;
  node.replaceChildren(text('h3','A retained operation needs its saved outcome'),text('p','This '+pending.kind+' request was retained before it reached the native server. Recovery uses the same request and original source identity.'),
    row(button('Recover original operation',recover,{read:true,id:'recover-operation'}),button('Download pending request',()=>saveBytes(enc.encode(json(pending)+'\n'),'diffbot-pending-request.json','application/json'),{read:true})));
}

function renderNavigation(){
  $('#navigation').replaceChildren(...TABS.map(([id,label])=>element('button',{type:'button','aria-current':ui.tab===id?'page':null,disabled:recurringSaveInFlight,onclick:()=>{ui.tab=id;persist();render();}},label)));
}
function renderEditionControl(){
  const config=activeConfig();if(!config)return;
  const control=select(config.editions.map(e=>[e.id,(e.label||e.id)+' · '+e.id]),config.selectedEdition,{
    disabled:!editable(),id:'selected-edition',onchange:event=>{
      draft.config.selectedEdition=event.target.value;ui.importForm=null;ui.capture=null;ui.selected=[];ui.focused=null;ui.page=0;
      changed();render();
    }});
  $('#edition-control').replaceChildren(field('Selected source edition',control,historical?'Historical source is read-only.':'The selected edition and its comparison belong to the next saved revision.'));
}
function parseJSON(value,label){
  try{return JSON.parse(value);}catch{throw new Error(label+' must be valid JSON.');}
}
function parseObject(value,label){const result=parseJSON(value,label);if(!result||typeof result!=='object'||Array.isArray(result))throw new Error(label+' must be a JSON object.');return result;}
function splitLines(value){return [...new Set(String(value||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean))];}
function validTime(value,label){if(!value||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)||!Number.isFinite(Date.parse(value)))throw new Error(label+' needs an actual ISO8601 timestamp with timezone.');return value;}
const secretKeys=new Set(['token','accesstoken','apikey','authorization','childtokens','secret','password','clientsecret','refreshtoken']);
const keyForm=value=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
function requireSourceUrl(value){
  let parsed;try{parsed=new URL(value);}catch{throw new Error('Use an original HTTP(S) source URL.');}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||[...parsed.searchParams.keys()].some(k=>secretKeys.has(keyForm(k))))
    throw new Error('Provider credentials belong to the private acquisition client, outside source URLs and the workspace.');
  return value;
}
// Inspection-only parser: numeric tokens are exact strings; original bytes are never rewritten.
// Reject duplicate object keys before credential inspection so a later key cannot hide an earlier value.
function parseOriginalJSON(source){
  let i=0,depth=0;const fail=()=>{throw new Error('The capture needs valid JSON with unique object keys.');};
  const ws=()=>{while(i<source.length&&/\s/.test(source[i]))i++;};
  function string(){
    const start=i++;let escaped=false;
    while(i<source.length){const c=source[i++];if(c==='"'&&!escaped){try{return JSON.parse(source.slice(start,i));}catch{fail();}}if(c==='\\'&&!escaped)escaped=true;else escaped=false;}
    fail();
  }
  function value(){
    ws();if(++depth>160)throw new Error('The source JSON nesting exceeds the operator inspection limit.');
    let result,c=source[i];
    if(c==='"')result=string();
    else if(c==='{'){
      result=Object.create(null);i++;ws();
      if(source[i]!=='}')while(true){
        ws();if(source[i]!=='"')fail();const k=string();if(Object.hasOwn(result,k))fail();ws();if(source[i++]!==':')fail();
        result[k]=value();ws();if(source[i]===','){i++;continue;}break;
      }
      if(source[i++]!=='}')fail();
    }else if(c==='['){
      result=[];i++;ws();if(source[i]!==']')while(true){result.push(value());ws();if(source[i]===','){i++;continue;}break;}
      if(source[i++]!==']')fail();
    }else{
      const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
      if(!match)fail();i+=match[0].length;result=match[0]==='true'?true:match[0]==='false'?false:match[0]==='null'?null:match[0];
    }
    depth--;return result;
  }
  if(source.charCodeAt(0)===0xfeff)i++;
  const result=value();ws();if(i!==source.length)fail();return result;
}
function noCredentials(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item]of Object.entries(value)){
    if(secretKeys.has(keyForm(key))){
      if(!(item===null||item===''||Array.isArray(item)&&item.length===0||typeof item==='string'&&['[redacted]','<redacted>','redacted','***'].includes(item.toLowerCase())))
        throw new Error('This capture contains a credential field. Export its safe-capture wrapper with the original acquisition client before import.');
    }else if(typeof item==='string'&&/^https?:\/\//.test(item))requireSourceUrl(item);
    else if(item&&typeof item==='object')noCredentials(item);
  }
}
function csvRows(value){
  const rows=[];let row=[],field='',quoted=false,afterQuote=false;
  if(value.charCodeAt(0)===0xfeff)value=value.slice(1);
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(quoted){if(c==='"'){if(value[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}}else field+=c;continue;}
    if(c==='"'&&!field&&!afterQuote){quoted=true;continue;}
    if(c===','){row.push(field);field='';afterQuote=false;continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&value[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';afterQuote=false;continue;}
    if(afterQuote)throw new Error('The CSV has content after a closing quoted field.');
    field+=c;
  }
  if(quoted)throw new Error('The original CSV has an unterminated quoted field.');
  if(field||row.length||afterQuote){row.push(field);rows.push(row);}
  if(!rows.length||new Set(rows[0]).size!==rows[0].length||rows.some(r=>r.length!==rows[0].length))
    throw new Error('The original CSV needs unique headers and consistent columns.');
  return rows;
}
function inspectCapture(textValue,format){
  if(format==='diffbot-bulk-url-report-csv'){
    const rows=csvRows(textValue),headers=rows[0];
    noCredentials(rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]]))));
    return {headers,rows:rows.length-1};
  }
  const parsed=parseOriginalJSON(textValue);noCredentials(parsed);
  if(format==='diffbot-safe-capture-v1'&&parsed?.schema!=='tj.diffbot-safe-capture.v1')
    throw new Error('Choose the original tj.diffbot-safe-capture.v1 wrapper.');
  const payload=format==='diffbot-safe-capture-v1'?parsed.payload:parsed;
  const originalFormat=format==='diffbot-safe-capture-v1'?parsed.format:format;
  if(originalFormat==='diffbot-bulk-url-report-csv'){
    const rows=csvRows(payload),headers=rows[0];noCredentials(rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]]))));
    return {headers,rows:rows.length-1,wrapper:format==='diffbot-safe-capture-v1'};
  }
  return {keys:parsed&&typeof parsed==='object'?Object.keys(parsed):[],objectCount:Array.isArray(payload)?payload.length:Array.isArray(payload?.objects)?payload.objects.length:null,wrapper:format==='diffbot-safe-capture-v1'};
}
async function captureFile(file,format){
  if(!file)throw new Error('Choose the original source file.');
  if(file.size>8*1024*1024)throw new Error('Each source file must fit the original 8 MiB workspace limit.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  let content;try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new Error('Choose the original UTF-8 JSON or CSV export.');}
  if(enc.encode(content).length!==bytes.length)throw new Error('This UTF-8 source cannot be retained exactly.');
  const selectedFormat=format||(/\.csv$/i.test(file.name)?'diffbot-bulk-url-report-csv':'diffbot-extract-json');
  const inspection=inspectCapture(content,selectedFormat),sha256=await digest(bytes);
  return {name:file.name,path:'captures/'+sha256+(selectedFormat==='diffbot-bulk-url-report-csv'?'.csv':'.json'),text:content,sha256,bytes:bytes.length,inspection};
}
async function chooseCapture(file){
  const format=ui.importForm?.format||(/\.csv$/i.test(file.name)?'diffbot-bulk-url-report-csv':'diffbot-extract-json');
  const captured=await captureFile(file,format);
  ui.capture=captured;ui.importForm??={};ui.importForm.format=format;persist();
}
async function sourceFile(source){
  const record=(!historical&&draft?.files[source.path])||await currentFile(activeRevision().id,source.path);
  if(typeof record.text!=='string')throw new Error('The retained capture is not UTF-8 text.');
  const bytes=enc.encode(record.text);
  if(bytes.length!==Number(source.bytes)||await digest(bytes)!==source.sha256)throw new Error('The capture bytes differ from their original source metadata.');
  return {bytes,text:record.text};
}
function reportBanner(){
  if(!preview)return empty('Inspect the saved edition to open its original records, numeric tokens and source lineage.');
  return element('div',{class:'inline-note'},row(badge(preview.status),mono(preview.function),small('Saved revision '+short(preview.revisionId)+' · '+when(preview.createdAt))),
    report&&!reportCurrent()?text('p','This retained output belongs to another saved revision or edition. Inspect the current source to review it.'):null,
    dirty()&&reportCurrent()?text('p','Local changes are retained in the draft; this output still describes the saved source.'):null,
    report?.ready===false?text('p',report.error?.message||'The original engine reported an input issue. The full finding is retained below.'):null,
    preview.error?text('p',preview.error.message||json(preview.error)):null,
    !terminal(preview.status)?button('Cancel this original preview',cancelPreview,{read:true}):null);
}
function sourceFindings(){
  const findings=report?.findings||[];
  if(!findings.length&&!report?.error)return null;
  return card(text('h3','Original dataset findings'),report?.error?detail('Original error',report.error):null,
    table(['Level','Finding','Source / record'],findings.slice(0,40).map(f=>[badge(f.severity||f.level||'info'),element('div',{},text('strong',f.code||''),text('p',f.message||fmt(f))),mono(f.recordId||f.sourceId)])),
    findings.length>40?detail('All '+findings.length+' findings',findings):null);
}
function overview(){
  const config=activeConfig(),edition=selectedEdition(),current=reportCurrent()?report:null,coverage=current?.coverage;
  return [heading('Retained web data to customer delivery','Review original captures, resolve the dataset, select customer columns and deliver the accepted edition.',
    button(dirty()?'Save & inspect':'Inspect saved edition',()=>startPreview('inspect_dataset'),{primary:true,disabled:!!historical,id:'inspect-dataset'})),
    card(text('h3',config.title||'Diffbot dataset'),definitions([
      ['Edition',edition?(edition.label||edition.id)+' · '+edition.id:'Not selected'],['Captured at',edition?.capturedAt||'Not recorded'],
      ['Selected URLs',String(edition?.scope?.urls?.length||0)],['Original captures',String(edition?.sources?.length||0)],
      ['Extractor',edition?.scope?.api||'Not selected'],['Comparison',edition?.compareToEdition||'No previous edition selected'],
      ['Saved revision',mono(activeRevision()?.id)]])),
    current?.records?element('div',{class:'metrics'},[
      ['Observations',current.records.length],['Accepted',current.records.filter(r=>r.review?.decision==='accept').length],
      ['Unresolved variants',current.records.filter(r=>r.conflicts?.length).length],['Successful URLs',coverage?.successfulUrls?.length||0],
      ['Failed URLs',coverage?.failedUrls?.length||0],['Coverage',coverage?.state||'Not recorded']
    ].map(([label,value])=>element('div',{class:'metric'},small(label),text('strong',fmt(value))))):null,
    reportBanner(),sourceFindings(),
    current?.changes?card(text('h3','Source comparison'),definitions([
      ['Original base',current.changes.baseEditionId||'Initial retained edition'],['Comparable scope',String(current.changes.comparableScope)],
      ['Added',String(current.changes.added?.length||0)],['Changed',String(current.changes.changed?.length||0)],
      ['Not seen',String(current.changes.notSeen?.length||0)],['Unchanged',String(current.changes.unchanged?.length||0)]]),
      text('p','Not seen is a coverage observation. It does not mean a page or product was deleted.'),detail('Original change references',current.changes)):null,
    card(text('h3','Working sequence'),text('p','Create a retained edition with its actual URL and extractor scope, import complete captures, inspect the original dataset, and record review or version decisions. Customer columns configures the base dataset. Recurring delivery adds exact watches and an accepted customer report. Files & handover retains each complete output and the original portable workspace.'),
      text('p','Provider acquisition uses the existing private client. Its reviewed command inputs and account-credit estimate are available under Sources & acquisition.'))];
}
function formValue(key,fallback=''){return ui.importForm?.[key]??fallback;}
function setForm(key,value){ui.importForm??={};ui.importForm[key]=value;persist();}
function setEdition(key,value){if(!editable())return;selectedEdition()[key]=value;changed();}
function editionEditor(){
  const e=selectedEdition();if(!e)return null;
  const scope=e.scope||{urls:[],api:'analyze',fields:[],format:'json',options:{}};
  return card(text('h3','Edition and reviewed source scope'),element('div',{class:'grid'},
    field('Edition label',input(e.label||e.id,{disabled:!editable(),id:'edition-label',oninput:event=>setEdition('label',event.target.value)})),
    field('Original captured-at time',input(e.capturedAt,{disabled:!editable(),id:'edition-captured-at',onchange:event=>{try{setEdition('capturedAt',validTime(event.target.value,'Edition captured-at'));}catch(err){notice(err.message,true);}}}),'Preserve the actual capture timestamp; saving a review is not a new provider capture.'),
    field('Previous edition',select([['','No comparison'],...activeConfig().editions.filter(x=>x.id!==e.id).map(x=>[x.id,(x.label||x.id)+' · '+x.id])],e.compareToEdition||'',{disabled:!editable(),id:'compare-edition',onchange:event=>{if(event.target.value)e.compareToEdition=event.target.value;else delete e.compareToEdition;changed();}}),'The original engine compares exact scope, including URLs, extractor, fields and options.'),
    field('Extractor',select(['analyze','article','product','image','video','discussion','event','list','job'],scope.api||'analyze',{disabled:!editable(),id:'scope-api',onchange:event=>{scope.api=event.target.value;changed();}})),
    field('Reviewed source URLs',area((scope.urls||[]).join('\n'),{disabled:!editable(),id:'scope-urls',rows:4,onchange:event=>{try{const urls=splitLines(event.target.value);urls.forEach(requireSourceUrl);scope.urls=urls;changed();}catch(err){notice(err.message,true);}}}),'One exact source URL per line.',true),
    field('Selected structured fields',input((scope.fields||[]).join(', '),{disabled:!editable(),id:'scope-fields',onchange:event=>{scope.fields=[...new Set(event.target.value.split(',').map(x=>x.trim()).filter(Boolean))];changed();}}),'Comma-separated; an empty list leaves the provider’s default structured fields.'),
    field('Format',input(scope.format||'json',{disabled:true}),'This dataset workflow consumes retained structured JSON/CSV.'),
    field('Original request options',area(json(scope.options||{}),{disabled:!editable(),rows:4,id:'scope-options',onchange:event=>{try{const value=parseObject(event.target.value,'Request options');noCredentials(value);scope.options=value;changed();}catch(err){notice(err.message,true);}}}),'Keep only actual request options. Native scope comparison preserves their values.',true)),
    row(button('New edition from this scope',()=>{
      const id='edition-'+crypto.randomUUID();activeConfig().editions.push({id,label:'New acquisition edition',capturedAt:new Date().toISOString(),scope:clone(scope),compareToEdition:e.id,sources:[]});
      activeConfig().selectedEdition=id;ui.capture=null;ui.importForm=null;ui.focused=null;ui.selected=[];changed();notice('New empty edition created. Import its actual captures and set their original times before inspection.');
    },{disabled:!editable(),id:'new-edition'})),
    small('Each new acquisition belongs to a new edition. Existing captures, source identities and prior review decisions remain in saved history.'));
}
function editSource(source){
  ui.capture=null;ui.importForm={editId:source.id,sourceId:source.id,format:source.format,capturedAt:source.capturedAt,sourceKind:source.sourceKind||'retained-provider-capture',
    originalWireBytes:source.originalWireBytes===true,requestText:json(source.request||{}),jobText:json(source.job||{}),
    provenanceText:json(source.provenance||{}),completeDownload:source.completeDownload===true,csvMappingText:json(source.csvMapping||{})};
  persist();
}
async function importDescriptor(file){
  if(!file||file.size>1024*1024)throw new Error('Choose the acquisition client’s original source metadata JSON.');
  const raw=await file.text(),checked=parseOriginalJSON(raw);noCredentials(checked);
  const parsed=parseJSON(raw.replace(/^\uFEFF/,''),'Source descriptor'),source=parsed.source||parsed;
  if(!SOURCE_FORMATS.some(([f])=>f===source.format)||typeof source.id!=='string'||typeof source.sha256!=='string')
    throw new Error('Choose the original exported *.source.json metadata or tj.diffbot-capture-export.v1 result.');
  if(ui.capture&&(ui.capture.sha256!==source.sha256||ui.capture.bytes!==Number(source.bytes)))throw new Error('The selected capture differs from this original source descriptor.');
  ui.importForm={sourceId:source.id,format:source.format,capturedAt:source.capturedAt,sourceKind:source.sourceKind||'retained-provider-capture',
    originalWireBytes:source.originalWireBytes===true,requestText:json(source.request||{}),jobText:json(source.job||{}),
    provenanceText:json(source.provenance||{}),completeDownload:source.completeDownload===true,csvMappingText:json(source.csvMapping||{}),
    descriptor:source};persist();notice('Original source metadata loaded. Select the exact matching capture file to complete import.');
}
async function addSource(){
  if(historical||pending||recurringSaveInFlight)throw new Error('Return to the current editable source.');
  const e=selectedEdition(),form=ui.importForm||{},old=e.sources.find(s=>s.id===form.editId),capture=ui.capture;
  if(!old&&!capture)throw new Error('Choose the original capture file.');
  const id=String(form.sourceId||old?.id||'').trim();if(!id)throw new Error('Give this retained source an explicit capture identity.');
  if(e.sources.some(s=>s.id===id&&s.id!==old?.id))throw new Error('This source ID already exists in the selected edition.');
  const format=form.format||old?.format||'diffbot-extract-json';
  const retained=capture||{path:old.path,sha256:old.sha256,bytes:old.bytes,text:(await sourceFile(old)).text};
  inspectCapture(retained.text,format);
  if(form.descriptor&&(retained.sha256!==form.descriptor.sha256||retained.bytes!==Number(form.descriptor.bytes)))
    throw new Error('The selected original bytes do not match the retained source descriptor.');
  const request=parseObject(form.requestText||'{}','Original request'),job=parseObject(form.jobText||'{}','Original job metadata'),provenance=parseObject(form.provenanceText||'{}','Capture provenance');
  noCredentials({request,job,provenance});if(request.pageUrl)requireSourceUrl(request.pageUrl);
  const source={...(old||{}),id,format,path:retained.path,sha256:retained.sha256,bytes:retained.bytes,
    capturedAt:validTime(form.capturedAt||'','Source captured-at'),sourceKind:(form.sourceKind||'retained-provider-capture').trim(),
    originalWireBytes:form.originalWireBytes===true,request,provenance};
  if(Object.keys(job).length)source.job=job;else delete source.job;
  if(form.completeDownload)source.completeDownload=true;else delete source.completeDownload;
  const csvMap=parseObject(form.csvMappingText||'{}','Original CSV coverage mapping');
  if(Object.keys(csvMap).length)source.csvMapping=csvMap;else delete source.csvMapping;
  if(capture)draft.files[capture.path]={text:capture.text,sha256:capture.sha256,bytes:capture.bytes};
  if(old)e.sources[e.sources.indexOf(old)]=source;else e.sources.push(source);
  ui.capture=null;ui.importForm=null;changed();notice('Exact source capture and metadata added to the original draft. Save & inspect to derive records and coverage.');
}
function importForm(){
  const form=ui.importForm||{},format=form.format||'diffbot-extract-json',old=selectedEdition()?.sources.find(s=>s.id===form.editId);
  return card(text('h3',old?'Edit original capture metadata':'Import an original capture'),
    element('div',{class:'grid'},
      field('Original capture file',element('input',{type:'file',accept:'.json,.csv,application/json,text/csv',disabled:!editable(),id:'capture-file',
        onchange:event=>{const file=event.target.files[0];if(file)run(()=>chooseCapture(file));}}),
        ui.capture?ui.capture.name+' · '+byteText(ui.capture.bytes)+' · '+ui.capture.sha256:old?'Existing capture stays unchanged unless another original file is selected.':'Original UTF-8 bytes are retained without numeric decoding/reformatting.',true),
      field('Original acquisition source descriptor (optional)',element('input',{type:'file',accept:'.json,application/json',disabled:!editable(),id:'source-descriptor',onchange:event=>{const file=event.target.files[0];if(file)run(()=>importDescriptor(file));}}),'Use the existing client’s *.source.json alongside its captures/<digest>.json file.',true),
      field('Capture identity',input(form.sourceId||'',{disabled:!editable(),id:'capture-id',oninput:event=>setForm('sourceId',event.target.value)}),'A local retained capture ID; no provider run ID is inferred.'),
      field('Original format',select(SOURCE_FORMATS,format,{disabled:!editable(),id:'capture-format',onchange:event=>{setForm('format',event.target.value);render();}})),
      field('Actual capture time',input(form.capturedAt||'',{disabled:!editable(),id:'capture-time',placeholder:'2026-10-11T22:32:37.590Z',oninput:event=>setForm('capturedAt',event.target.value)})),
      field('Source representation',input(form.sourceKind||'retained-provider-capture',{disabled:!editable(),id:'capture-kind',oninput:event=>setForm('sourceKind',event.target.value)}),'Describe the actual API response, official displayed result, or exported safe derivative.'),
      field('Original request metadata',area(form.requestText||json({pageUrl:'',api:selectedEdition()?.scope?.api||'analyze'}),{disabled:!editable(),id:'capture-request',rows:5,oninput:event=>setForm('requestText',event.target.value)}),'Original safe request object, including pageUrl and extractor; no credential.',true),
      field('Original job metadata',area(form.jobText||'{}',{disabled:!editable(),id:'capture-job',rows:3,oninput:event=>setForm('jobText',event.target.value)}),'For Bulk, retain the exact job name and actual status metadata.',true),
      field('Capture provenance',area(form.provenanceText||'{}',{disabled:!editable(),id:'capture-provenance',rows:4,oninput:event=>setForm('provenanceText',event.target.value)}),'Retain original URL, observation method and any derivative/original relation.',true),
      field('Coverage mapping for original URL-report CSV',area(form.csvMappingText||'{}',{disabled:!editable(),id:'capture-csv-mapping',rows:4,oninput:event=>setForm('csvMappingText',event.target.value)}),'Object fields: url, outcome, successValues[], failureValues[]. Choose actual original headers and documented outcomes.',true)),
    element('label',{class:'check'},element('input',{type:'checkbox',checked:!!form.originalWireBytes,disabled:!editable(),id:'capture-wire',onchange:event=>setForm('originalWireBytes',event.target.checked)}),'This file contains the actual original HTTP response bytes'),
    element('label',{class:'check'},element('input',{type:'checkbox',checked:!!form.completeDownload,disabled:!editable(),id:'capture-complete',onchange:event=>setForm('completeDownload',event.target.checked)}),'This is the complete unbounded Bulk data download'),
    ui.capture?detail('Inspection of the exact selected bytes',ui.capture.inspection):null,
    row(button(old?'Apply source metadata':'Add capture to edition',addSource,{primary:true,disabled:!editable(),id:'add-source'}),
      button('Clear import form',()=>{ui.capture=null;ui.importForm=null;persist();},{disabled:!editable()})));
}


const shellQuote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
function acquisitionPlan(){
  const e=selectedEdition(),scope=e?.scope||{},a=ui.acquisition||{},urls=scope.urls||[],apiName=scope.api||'analyze';
  const stem=(a.operationId||'diffbot-'+e?.id||'diffbot-capture').replace(/[^A-Za-z0-9_.-]/g,'-').slice(0,110);
  const client=a.clientPath||'acquisition.py',storePath=a.storePath||'./private-diffbot-transport',tokenEnv=a.tokenEnv||'DIFFBOT_TOKEN';
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv))throw new Error('The credential environment variable needs a valid variable name.');
  const timeout=Number(a.timeoutMs??scope.options?.timeout??30000),proxy=a.useProxy||scope.options?.useProxy||'none',repetitions=Number(a.repetitions??1);
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>300000||!Number.isSafeInteger(repetitions)||repetitions<1)throw new Error('Timeout needs 1–300000 milliseconds and repetitions a positive whole number.');
  if(!['none','default'].includes(proxy))throw new Error('Choose the original client’s none/default proxy option.');
  urls.forEach(requireSourceUrl);
  const base=['python3',client,'--store',storePath,'--token-env',tokenEnv],cmd=parts=>parts.map(shellQuote).join(' '),
    extractFlags=['--api',apiName,'--timeout-ms',String(timeout),'--use-proxy',proxy,...(scope.fields?.length?['--fields',scope.fields.join(',')]:[])],
    lines=['# Reviewed source scope for '+e.id,'# Set '+tokenEnv+' privately before the original client runs. Its value is never in this file.',
      '# The following are operator commands; this file does not run them automatically.','',
      cmd([...base,'account','--id',stem+'-account']),cmd([...base,'estimate','--urls','selected-urls.json','--use-proxy',proxy,'--repetitions',String(repetitions),'--account-operation',stem+'-account']),''];
  urls.forEach((url,i)=>lines.push(cmd([...base,'extract','--id',stem+'-extract-'+String(i+1),'--url',url,...extractFlags])));
  const jobName=a.jobName||stem+'-bulk';
  lines.push('','# Bulk requires the actual eligible provider plan. Exact-name lookup precedes the original POST.',
    cmd([...base,'bulk-create','--id',stem+'-create','--name',jobName,'--urls','selected-urls.json',...extractFlags]),
    '# After an uncertain create, reconcile that same operation before another create.',
    cmd([...base,'reconcile','--id',stem+'-reconcile','--create-operation',stem+'-create']),
    cmd([...base,'bulk-status','--id',stem+'-status','--name',jobName]),
    '# Retain the complete result, without num, and the original URL report.',
    cmd([...base,'bulk-download','--id',stem+'-data','--name',jobName]),
    cmd([...base,'bulk-download','--id',stem+'-urls','--name',jobName,'--url-report']),
    cmd([...base,'reopen','--id',stem+'-data']),
    cmd([...base,'export','--id',stem+'-data','--out','./diffbot-safe-data']),
    '# Import the emitted original *.source.json and matching captures/<sha>.json into this workspace.');
  return {schema:'tj.diffbot-reviewed-acquisition-input.v1',editionId:e.id,scope:clone(scope),operationId:stem,jobName,timeoutMs:timeout,useProxy:proxy,repetitions,
    selectedUrls:urls,commands:lines.join('\n')+'\n',urlFile:json(urls)+'\n',
    estimateCommand:cmd(['python3',client,'estimate','--urls','selected-urls.json','--use-proxy',proxy,'--repetitions',String(repetitions)])};
}
function acquisitionControls(){
  const a=ui.acquisition??={},set=(key,value)=>{a[key]=value;persist();};
  let plan,error;try{plan=acquisitionPlan();}catch(e){error=e.message;}
  return card(text('h3','Prepare the original acquisition workflow'),
    text('p','The saved edition supplies the exact URL, extractor and field scope. Credentials stay in the existing private client. These controls prepare reviewed input files and commands; they do not create another acquisition worker.'),
    element('div',{class:'grid'},
      field('Original client path',input(a.clientPath||'acquisition.py',{id:'acquisition-client',oninput:event=>set('clientPath',event.target.value)})),
      field('Private transport directory',input(a.storePath||'./private-diffbot-transport',{id:'acquisition-store',oninput:event=>set('storePath',event.target.value)}),'Separate from the publishable workspace. Only the path is retained in the local operator draft.'),
      field('Credential environment variable name',input(a.tokenEnv||'DIFFBOT_TOKEN',{id:'acquisition-token-env',oninput:event=>set('tokenEnv',event.target.value)}),'Variable name only; enter no credential here.'),
      field('Original operation prefix',input(a.operationId||('diffbot-'+selectedEdition().id),{id:'acquisition-operation',oninput:event=>set('operationId',event.target.value)}),'Keep an existing operation identity when reopening or reconciling it.'),
      field('Exact Bulk job name',input(a.jobName||'',{id:'acquisition-job',oninput:event=>set('jobName',event.target.value)})),
      field('Proxy',select([['none','No datacenter proxy'],['default','Original default proxy']],a.useProxy||'none',{id:'acquisition-proxy',onchange:event=>{set('useProxy',event.target.value);render();}})),
      field('Per-page timeout (milliseconds)',input(a.timeoutMs??selectedEdition()?.scope?.options?.timeout??30000,{type:'number',min:1,step:1,id:'acquisition-timeout',oninput:event=>set('timeoutMs',event.target.value)})),
      field('Planned repetitions',input(a.repetitions??1,{type:'number',min:1,step:1,id:'acquisition-repetitions',oninput:event=>set('repetitions',event.target.value)}),'The original estimate command applies actual account data when an account operation is supplied.')),
    row(button('Refresh reviewed command plan',()=>{persist();notice('Reviewed command inputs refreshed.');},{read:true}),
      button('Download exact URL selection',()=>{const p=acquisitionPlan();saveBytes(enc.encode(p.urlFile),'selected-urls.json','application/json');},{read:true,id:'download-urls'}),
      button('Download original-client commands',()=>{const p=acquisitionPlan();saveBytes(enc.encode(p.commands),'diffbot-acquisition-commands.txt','text/plain');},{read:true,id:'download-acquisition-commands'}),
      button('Download reviewed scope',()=>{const p=acquisitionPlan();delete p.commands;saveBytes(enc.encode(json(p)+'\n'),'diffbot-reviewed-scope.json','application/json');},{read:true})),
    error?text('p',error,{class:'issue'}):detail('Exact original-client plan',plan.commands),
    text('p','Run the original account/estimate operation to obtain the actual selected plan and remaining credits. The original acquisition client retains complete raw responses privately and exports an explicit safe derivative with its original digest. Completed Bulk results should be retained before the provider’s documented expiry.'),
    row(sourceLink('https://www.diffbot.com/docs/extract/','Original Extract documentation'),sourceLink('https://www.diffbot.com/docs/bulk/','Original Bulk documentation')));
}
function sources(){
  const e=selectedEdition();
  return [heading('Sources and acquisition','Preserve actual selected URLs, complete captures and the original request/provenance of each edition.',
    button(dirty()?'Save & inspect':'Inspect saved edition',()=>startPreview('inspect_dataset'),{primary:true,disabled:!!historical})),
    editionEditor(),
    card(text('h3','Original captures in this edition'),
      e.sources.length?table(['Capture','Representation / identity','Actions'],e.sources.map(s=>[
        element('div',{},text('strong',s.id),small(s.format),small(s.capturedAt)),
        element('div',{},mono(s.sha256),small(byteText(Number(s.bytes))),small(s.sourceKind||'Unspecified representation'),small('Original wire bytes: '+String(s.originalWireBytes===true))),
        row(button('Edit metadata',()=>editSource(s),{disabled:!editable(),id:'edit-source-'+s.id.replace(/[^A-Za-z0-9_-]/g,'-')}),
          button('Download original capture',async()=>{const file=await sourceFile(s);saveBytes(file.bytes,s.path.split('/').at(-1),s.format.endsWith('csv')?'text/csv':'application/json');},{read:true}),
          button('View original metadata',()=>{ui.sourceDetail=clone(s);persist();},{read:true}),
          button('Remove from this selection',()=>{e.sources=e.sources.filter(x=>x.id!==s.id);changed();notice('Source removed from this edition selection. Its original bytes and saved history remain retained.');},{disabled:!editable()}))
      ])):empty('No capture is attached yet. Import actual results for the selected edition.')),
    ui.sourceDetail?card(text('h3','Selected source metadata'),detail(ui.sourceDetail.id,ui.sourceDetail),button('Close metadata',()=>{ui.sourceDetail=null;persist();},{read:true})):null,
    importForm(),acquisitionControls(),
    reportCurrent()&&report?.coverage?card(text('h3','Original acquisition coverage'),detail('Complete URL sets and coverage state',report.coverage),detail('Original Bulk job records',report.jobs||[])):null,
    reportBanner(),sourceFindings()];
}
function effectiveDecision(recordId){
  const e=activeConfig().selectedEdition,rows=[...(activeConfig().reviews||[]),...(activeConfig().recurring?.decisions||[])];
  return rows.filter(r=>r.recordId===recordId&&r.editionId===e).at(-1)||null;
}
function recordStatus(record){return effectiveDecision(record.id)?.decision||record.review?.decision||'unreviewed';}
function changeStatus(recordId){
  const changes=report?.changes||{};
  for(const [key,label]of [['changed','Changed'],['added','Added'],['notSeen','Not seen'],['unchanged','Unchanged']])
    if(changes[key]?.some(r=>(typeof r==='string'?r:r.id)===recordId))return label;
  return changes.baseEditionId?'Unclassified':'Initial observation';
}
function filteredRecords(){
  const needle=ui.search.toLowerCase();
  return (report?.records||[]).filter(r=>(ui.kind==='all'||r.kind===ui.kind)&&
    (ui.reviewFilter==='all'||ui.reviewFilter==='conflicts'&&r.conflicts?.length||recordStatus(r)===ui.reviewFilter)&&
    (!needle||[r.id,r.providerId,r.kind,r.sourceUrl,r.fields?.title,r.fields?.brand,r.fields?.sku].some(x=>fmt(x).toLowerCase().includes(needle))));
}
function renderReviewTable(){
  const host=$('#review-table');if(!host)return;
  const rows=filteredRecords(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));ui.page=Math.min(ui.page,pages-1);
  const page=rows.slice(ui.page*PAGE_SIZE,(ui.page+1)*PAGE_SIZE);
  host.replaceChildren(row(text('p',rows.length+' matching observations · page '+(ui.page+1)+' of '+pages),
    button('Previous page',()=>{ui.page--;persist();},{read:true,disabled:ui.page===0}),
    button('Next page',()=>{ui.page++;persist();},{read:true,disabled:ui.page+1>=pages}),
    button('Select this page',()=>{ui.selected=[...new Set([...ui.selected,...page.map(r=>r.id)])];persist();},{read:true})),
    table(['Select','Original observation','Type / change','Review','Source'],page.map(r=>[
      element('input',{type:'checkbox',checked:ui.selected.includes(r.id),disabled:!reviewEnabled(),'aria-label':'Select '+r.id,onchange:event=>{ui.selected=event.target.checked?[...new Set([...ui.selected,r.id])]:ui.selected.filter(id=>id!==r.id);persist();}}),
      element('div',{},button(r.fields?.title||r.id,()=>{ui.focused=r.id;persist();},{read:true,id:'open-record-'+(report.records.indexOf(r))}),small(r.id)),
      element('div',{},badge(r.kind),small(changeStatus(r.id)),r.conflicts?.length?badge('Version conflict',true):null),
      badge(recordStatus(r)),element('div',{},sourceLink(r.sourceUrl,'Original source page'),small(r.sourceId))
    ])));
}
function recurringConfig(config=activeConfig()){
  config.recurring??={};
  config.recurring.watchlist??=[];config.recurring.decisions??=[];
  config.recurring.delivery??={title:'Reviewed web intelligence',fields:['title','text','author','date','brand','offerPrice','offerPriceDetails','availability']};
  return config.recurring;
}
function appendReview(ids){
  if(historical||!reportCurrent()||sourceDirty()||report.ready===false)throw new Error('Inspect the current saved source before recording this decision.');
  const reviewer=ui.reviewer.trim();if(!reviewer)throw new Error('Enter the actual reviewer name.');
  const unique=[...new Set(ids)];if(!unique.length)throw new Error('Select at least one actual observation.');
  const records=new Map(report.records.map(r=>[r.id,r]));for(const id of unique)if(!records.has(id))throw new Error('A selected observation is outside this original report.');
  if(ui.reviewStatus==='accept'&&unique.some(id=>records.get(id).conflicts?.length))throw new Error('Resolve the original retained version conflict before accepting that observation.');
  const cfg=recurringConfig(draft.config),at=new Date().toISOString();
  for(const recordId of unique)cfg.decisions.push({recordId,editionId:report.edition.id,decision:ui.reviewStatus,reviewer,at,note:ui.reviewNote});
  changed();notice('Appended '+unique.length+' '+ui.reviewStatus+' decision(s) for the exact current edition. Save & build to produce the corresponding customer files.');
}
function reviewForm(){
  return card(text('h3','Review selected observations'),element('div',{class:'grid'},
    field('Reviewer',input(ui.reviewer,{disabled:!reviewEnabled(),id:'reviewer',oninput:event=>{ui.reviewer=event.target.value;persist();}})),
    field('Decision',select([['accept','Accept'],['ignore','Ignore'],['revisit','Revisit']],ui.reviewStatus,{disabled:!reviewEnabled(),id:'review-decision',onchange:event=>{ui.reviewStatus=event.target.value;persist();}})),
    field('Operator note',area(ui.reviewNote,{disabled:!reviewEnabled(),id:'review-note',rows:3,oninput:event=>{ui.reviewNote=event.target.value;persist();}}),'Retained in the complete operator workspace; excluded from the recurring customer projection.',true)),
    row(button('Append decision for '+ui.selected.length+' selected',()=>appendReview(ui.selected),{primary:true,disabled:!reviewEnabled()||!ui.selected.length,id:'append-review'}),
      button('Clear selection',()=>{ui.selected=[];persist();},{read:true})),
    small('Review order is authoritative within the exact record and edition. A prior-edition decision never approves the next captured edition.'));
}
function pointerPiece(value){return String(value).replaceAll('~','~0').replaceAll('/','~1');}
function fieldDetails(record){
  return table(['Original field','Original value'],Object.entries(record.fields||{}).map(([key,value])=>[
    element('div',{},text('strong',key),small('/fields/'+pointerPiece(key))),text('pre',fmt(value))
  ]));
}
function focusedRecord(){
  const record=report?.records?.find(r=>r.id===ui.focused);if(!record)return card(text('h3','Original record detail'),empty('Open an observation to inspect its complete source fields, numeric tokens, lineage and version records.'));
  const source=(report.sources||[]).find(s=>s.id===record.sourceId),variants=record.conflicts?.length?record.conflicts:record.retainedVariants||[];
  return card(text('h3',record.fields?.title||record.id),definitions([
    ['Exact identity',mono(record.id)],['Identity kind',record.identityKind],['Provider identity',mono(record.providerId)],['Kind',record.kind],
    ['Original source page',sourceLink(record.sourceUrl)],['Resolved URL',sourceLink(record.resolvedUrl)],['Captured',record.capturedAt],
    ['Field SHA256',mono(record.fieldSha256)],['Review',recordStatus(record)]]),
    fieldDetails(record),
    detail('Exact numeric tokens and original field pointers',record.numberTokens||{}),detail('Complete original lineage',record.lineage||[]),
    detail('Original source provenance',source||{}),
    detail('Exact-edition decision history',[...(activeConfig().reviews||[]),...(activeConfig().recurring?.decisions||[])].filter(r=>r.recordId===record.id&&r.editionId===report.edition.id)),
    variants.length?element('div',{class:'inset'},text('h3','Explicit original version selection'),
      text('p','Choose an actual retained source and object index. The original engine retains all variants and this recorded reason.'),
      field('Retained source variant',select(variants.map((v,i)=>[String(i),v.sourceId+' · object '+v.sourceIndex+' · '+short(v.fieldSha256)]),String(ui.variantIndex??0),{disabled:!reviewEnabled(),id:'variant-source',onchange:event=>{ui.variantIndex=Number(event.target.value);persist();}})),
      field('Resolution reason',area(ui.variantReason||'',{disabled:!reviewEnabled(),id:'variant-reason',rows:3,oninput:event=>{ui.variantReason=event.target.value;persist();}})),
      button('Record version resolution',()=>{
        if(historical||!reportCurrent()||sourceDirty())throw new Error('Inspect the current saved source before resolving variants.');
        const chosen=variants[ui.variantIndex??0];if(!chosen||!ui.reviewer.trim()||!ui.variantReason?.trim())throw new Error('Choose the actual variant and enter reviewer and reason.');
        (draft.config.resolutions??=[]).push({recordId:record.id,editionId:report.edition.id,sourceId:chosen.sourceId,sourceIndex:chosen.sourceIndex,reviewer:ui.reviewer.trim(),reason:ui.variantReason.trim(),at:new Date().toISOString()});
        changed();notice('Original version resolution appended. Save & inspect before accepting its resulting record.');
      },{disabled:!reviewEnabled(),id:'resolve-variant'}),detail('Retained original variant references',variants),
      record.resolution?detail('Current original resolution',record.resolution):null):null,
    row(button('Select this observation',()=>{ui.selected=[...new Set([...ui.selected,record.id])];persist();},{disabled:!reviewEnabled()})));
}
function review(){
  return [heading('Dataset and original object review','Article, product and list observations keep their exact original identity, fields and provenance.',
    button(dirty()?'Save & inspect':'Inspect saved edition',()=>startPreview('inspect_dataset'),{primary:true,disabled:!!historical})),reportBanner(),
    report?.records?element('div',{},element('div',{class:'toolbar'},
      field('Search original observations',input(ui.search,{id:'record-search',oninput:event=>{ui.search=event.target.value;ui.page=0;persist();renderReviewTable();}})),
      field('Kind',select([['all','All types'],...[...new Set(report.records.map(r=>r.kind))].map(k=>[k,k])],ui.kind,{id:'record-kind',onchange:event=>{ui.kind=event.target.value;ui.page=0;persist();renderReviewTable();}})),
      field('Review',select([['all','All decisions'],['unreviewed','Unreviewed'],['accept','Accepted'],['ignore','Ignored'],['revisit','Revisit'],['conflicts','Version conflicts']],ui.reviewFilter,{id:'record-filter',onchange:event=>{ui.reviewFilter=event.target.value;ui.page=0;persist();renderReviewTable();}}))),
      element('div',{id:'review-table'}),element('div',{class:'split'},reviewForm(),focusedRecord())):null,
    sourceFindings()];
}
function mappedRows(){if(!ui.mappingRows)ui.mappingRows=Object.entries(activeConfig().export?.columns||DEFAULT_COLUMNS).map(([name,pointer])=>({name,pointer}));return ui.mappingRows;}
function mapping(){
  const config=activeConfig(),rows=mappedRows(),pointers=new Set(Object.values(DEFAULT_COLUMNS));
  for(const r of report?.records||[])for(const key of Object.keys(r.fields||{}))pointers.add('/fields/'+pointerPiece(key));
  return [heading('Customer columns','Map receiving columns to actual original record pointers. Numeric source fields stay exact text with their numeric-token sidecar.',
    button(dirty()?'Save & build':'Build customer files',()=>startPreview('build_dataset'),{primary:true,disabled:!!historical,id:'build-customer'})),
    card(text('h3','Dataset export selection'),
      field('Included observations',select([['all','All non-ignored records without version conflicts'],['accepted','Only explicitly accepted records without version conflicts']],config.export?.mode||'all',{disabled:!editable(),id:'export-mode',onchange:event=>{(config.export??={}).mode=event.target.value;changed();}})),
      text('p','The recurring customer report separately includes accepted records selected by the saved watchlist. Both projections retain coverage and original source identity.')),
    card(text('h3','Receiving system columns'),element('datalist',{id:'record-pointer-options'},[...pointers].sort().map(p=>element('option',{value:p}))),
      table(['Customer column','Original JSON pointer','Order'],rows.map((item,i)=>[
        input(item.name,{disabled:!editable(),'aria-label':'Customer column '+(i+1),oninput:event=>{item.name=event.target.value;persist();}}),
        input(item.pointer,{disabled:!editable(),list:'record-pointer-options','aria-label':'Source pointer '+(i+1),oninput:event=>{item.pointer=event.target.value;persist();}}),
        row(button('Up',()=>{[rows[i-1],rows[i]]=[rows[i],rows[i-1]];persist();},{disabled:!editable()||i===0}),
          button('Down',()=>{[rows[i],rows[i+1]]=[rows[i+1],rows[i]];persist();},{disabled:!editable()||i===rows.length-1}),
          button('Remove',()=>{rows.splice(i,1);persist();},{disabled:!editable()}))
      ])),
      row(button('Add column',()=>{rows.push({name:'',pointer:'/fields/title'});persist();},{disabled:!editable(),id:'add-column'}),
        button('Apply customer columns',()=>{
          if(!rows.length||rows.length>100)throw new Error('Choose between 1 and 100 original columns.');
          const columns=Object.create(null);
          for(const r of rows){
            const name=r.name.trim();if(!name||Object.hasOwn(columns,name))throw new Error('Customer column names must be nonempty and unique.');
            if(!/^\/(?:id|identityKind|providerId|kind|sourceId|sourceUrl|resolvedUrl|capturedAt|fields|numberTokens)(?:\/|$)/.test(r.pointer)&&r.pointer!=='/review/decision'||/~(?![01])/.test(r.pointer))
              throw new Error('Use an original supported JSON pointer; escape ~ as ~0 and / inside a field name as ~1.');
            columns[name]=r.pointer;
          }
          (config.export??={}).columns=columns;changed();notice('Customer columns applied to the local draft. Save & build to retain the corresponding outputs.');
        },{primary:true,disabled:!editable(),id:'apply-columns'})),
      small('Examples: /fields/title, /fields/offerPriceDetails/amount, /fields/tags/0/score. Missing values remain missing/null in the typed output; no currency or availability is inferred.')),
    reportCurrent()&&report?.export?card(text('h3','Last saved native mapping'),detail('Original export configuration and counts',report.export)):null,reportBanner()];
}


async function saveRecurring(next){
  if(historical||busy||pending)throw new Error('Return to the current workspace and reconcile the original operation before saving.');
  if(!reportCurrent()||sourceDirty())throw new Error('Inspect the current source edition before saving a recurring decision.');
  const previous=draft.config.recurring?.decisions||[];
  if(!same(next.decisions.slice(0,previous.length),previous))throw new Error('The existing exact-edition decision history must remain an unchanged prefix.');
  busy=true;recurringSaveInFlight=true;renderHeader();renderNavigation();
  try{
    draft.config.recurring=clone(next);changed();await saveDraft();
    const revisionId=draft.base.id,editionId=draft.config.selectedEdition;
    const started=await mutate('/api/preview',{revisionId,function:'build_dataset',input:{editionId},operationId:'diffbot-recurring-'+crypto.randomUUID()},'preview');
    await openPreview(started.id);
    const deadline=Date.now()+120000;
    while(!terminal(preview.status)){
      if(Date.now()>deadline)throw new Error('The source and original preview are retained. Refresh that same operation to collect its outcome; no duplicate build was started.');
      await new Promise(resolve=>setTimeout(resolve,900));
      await openPreview(started.id);
    }
    if(preview.status!=='COMPLETED'||!report)throw new Error(preview.error?.message||'The original preview did not return a complete result. Reopen its retained record under Files & handover.');
    if(report.ready===false)throw new Error(report.error?.message||'The original dataset reported an input issue. Inspect its retained findings.');
    if(!report.recurring||report.recurring.schema!=='tj.diffbot-recurring-report.v1')throw new Error('The native result does not yet contain the recurring report. Reopen this result after the integrator’s original recurring engine is installed.');
    state=await api('/api/state');persist();
    return {report:report.recurring,config:clone(draft.config.recurring)};
  }finally{busy=false;recurringSaveInFlight=false;renderHeader();renderNavigation();}
}
function recurringView(){
  const available=reportCurrent()&&report?.ready!==false&&report?.recurring?.schema==='tj.diffbot-recurring-report.v1';
  return [heading('Recurring customer delivery','Review the saved watchlist, exact source changes and named decisions, then export the matching accepted customer report.',
    button(dirty()?'Save & build recurring report':'Build recurring report',()=>{ui.tab='recurring';return startPreview('build_dataset','recurring');},{primary:true,disabled:!!historical,id:'build-recurring'})),
    reportBanner(),
    available?element('div',{id:'recurring-host'}):card(text('h3','Open the original recurring result'),text('p','Build the selected saved edition to join its original before/after records with the retained watchlist and customer decisions.'),
      activeConfig().recurring?detail('Saved recurring configuration',activeConfig().recurring):empty('The report uses its documented defaults until delivery settings are saved.')),
    sourceFindings()];
}
function delivery(){
  const files=report?.files||[],operatorNames=new Set(['dataset-report.json','review-decisions.json','DELIVERY.md']);
  function fileTable(selected){
    return table(['File','Original result identity','Download'],selected.map(file=>[
      element('div',{},text('strong',file.name)),
      element('div',{},small(byteText(file.bytes)),mono(file.sha256)),
      button('Download '+file.name,()=>saveBytes(enc.encode(file.body),file.name,
        file.name.endsWith('.html')?'text/html;charset=utf-8':file.name.endsWith('.json')||file.name.endsWith('.ndjson')?'application/json':file.name.endsWith('.csv')?'text/csv;charset=utf-8':'text/markdown;charset=utf-8'),{read:true,id:'download-'+file.name.replaceAll('.','-')})
    ]));
  }
  return [heading('Files and receiving handover','Download complete files from the original retained native build, then reopen the same portable source workspace.',
    button(dirty()?'Save & build files':'Build files',()=>startPreview('build_dataset'),{primary:true,disabled:!!historical,id:'build-files'})),
    reportBanner(),
    preview?.result?card(text('h3','Retained original native output'),definitions([
      ['Operation',mono(preview.id)],['Saved revision',mono(preview.revisionId)],['Function',preview.function],
      ['Complete bytes',byteText(preview.result.bytes)],['SHA256',mono(preview.result.sha256)]]),
      button('Download complete operator output',()=>download('/api/preview-output?id='+encodeURIComponent(preview.id),'diffbot-dataset-output.json'),{read:true,id:'download-native-output'})):null,
    files.length?card(text('h3','Customer dataset and recurring delivery'),text('p','These are the exact generated bodies from the selected build. recurring-report.json/html are the accepted watch-selected customer projection. Base customer files use the saved customer-column map and export mode.'),
      fileTable(files.filter(f=>!operatorNames.has(f.name)))):empty('Build the saved source to retain complete downloadable files.'),
    files.some(f=>operatorNames.has(f.name))?card(text('h3','Operator analysis and decision history'),
      text('p','The full dataset report and decision log retain unselected observations and operator notes. Keep these with the complete operating handover.'),
      fileTable(files.filter(f=>operatorNames.has(f.name)))):null,
    card(text('h3','Portable original workspace'),
      text('p','This complete export retains the saved Python application, original captures, source revisions, decisions and native outputs. Reopen it through the same workbench import command.'),
      row(button('Export complete operator workspace',()=>download('/api/export','diffbot-dataset.python-workspace.json'),{read:true,id:'export-workspace'}),
        button('Download receiving commands',()=>{
          const base=['node','workbench.mjs','import','--source-root','/path/to/original-source','--dir','./new-diffbot-workspace','--bundle','diffbot-dataset.python-workspace.json'].map(shellQuote).join(' ');
          const serve=['node','workbench.mjs','serve','--source-root','/path/to/original-source','--dir','./new-diffbot-workspace'].map(shellQuote).join(' ');
          saveBytes(enc.encode('# Use the same complete source distribution containing the original Python workspace and Diffbot operator.\n'+base+'\n'+serve+'\n'),'diffbot-reopen-commands.txt','text/plain');
        },{read:true}))),
    state.previews.length?card(text('h3','Original operation history'),table(['Function','Saved revision','Status','When','Open'],
      state.previews.filter(p=>['inspect_dataset','build_dataset'].includes(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(p=>[
        p.function,mono(p.revisionId),badge(p.status),when(p.createdAt),button('Open retained result',()=>openPreview(p.id),{read:true,id:'open-preview-'+p.id})
      ]))):null,sourceFindings()];
}
function canonical(value){
  if(value===undefined)return 'undefined';
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

function reviewedEditionIds(config){
  return new Set([...(config.reviews||[]),...(config.recurring?.decisions||[])].map(r=>r.editionId));
}
function assertReviewedSourcesStable(base,next){
  const reviewed=reviewedEditionIds(base);
  for(const original of base.editions||[]){
    if(!reviewed.has(original.id))continue;
    const current=next.editions.find(e=>e.id===original.id);
    const binding=e=>e?{id:e.id,capturedAt:e.capturedAt,scope:e.scope,sources:e.sources}:null;
    if(canonical(binding(original))!==canonical(binding(current)))
      throw new Error('This edition already has recorded reviews. Create a new edition from its scope for changed capture/source inputs, preserving the reviewed edition and its original decisions.');
  }
}

function assertHistoryPrefix(base,next){
  for(const path of ['reviews','resolutions','recurring.decisions']){
    const get=(value)=>path.split('.').reduce((v,k)=>v?.[k],value)||[];
    const previous=get(base),candidate=get(next);
    if(!Array.isArray(candidate)||canonical(candidate.slice(0,previous.length))!==canonical(previous))
      throw new Error('Keep the original '+path+' array as an unchanged history prefix. Append a new decision or use the native historical restore.');
  }
}
function mergeValue(base,local,remote,path,conflicts){
  const equal=(a,b)=>canonical(a)===canonical(b);
  if(equal(local,base))return clone(remote);
  if(equal(remote,base)||equal(local,remote))return clone(local);
  const leaf=path.split('.').at(-1);
  if(['decisions','reviews','resolutions'].includes(leaf)&&Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)&&equal(local.slice(0,base.length),base)&&equal(remote.slice(0,base.length),base)){
    const keyOf=x=>x.recordId+'\n'+x.editionId,add=local.slice(base.length),theirs=remote.slice(base.length);
    if(!add.some(a=>theirs.some(b=>keyOf(a)===keyOf(b)&&!equal(a,b))))
      return [...clone(remote),...clone(add.filter(a=>!theirs.some(b=>equal(a,b))))];
  }
  if(local&&remote&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(local)&&!Array.isArray(remote)&&(base===undefined||base&&typeof base==='object'&&!Array.isArray(base))){
    const merged=Object.create(null);
    for(const key of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])){
      const value=mergeValue(base?.[key],local[key],remote[key],path?path+'.'+key:key,conflicts);
      if(value!==undefined)merged[key]=value;
    }
    return merged;
  }
  conflicts.push(path);return clone(local);
}
async function mergeLatest(){
  state=await api('/api/state');const remote=await readConfig(state.revision),conflicts=[],merged=mergeValue(draft.baseConfig,draft.config,remote,'',conflicts);
  if(conflicts.length){ui.latestConfig=remote;persist();throw new Error('Both operators changed these sections: '+conflicts.join(', ')+'. Original local and latest source remain available for an explicit merge.');}
  for(const [path,file]of Object.entries(draft.files)){
    const existing=state.revision.files.find(f=>f.path===path);
    if(existing&&existing.sha256!==file.sha256)throw new Error('The latest source has different original bytes at '+path+'. Preserve both captures before merging.');
  }
  assertHistoryPrefix(remote,merged);
  draft.base=clone(state.revision);draft.baseConfig=clone(remote);draft.config=merged;ui.latestConfig=null;ui.mappingRows=null;changed();
  notice('Merged disjoint local changes with the current original revision. Concurrent decisions for the same record remain an explicit operator choice.');
}
async function openHistorical(id){
  const revision=await api('/api/revision?id='+encodeURIComponent(id)),config=await readConfig(revision);
  historical={revision,config};ui.configText=null;ui.mappingRows=null;ui.selected=[];ui.focused=null;ui.page=0;
  const candidates=state.previews.filter(p=>p.revisionId===id&&['inspect_dataset','build_dataset'].includes(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(candidates.length)await openPreview(candidates[0].id);else{preview=null;report=null;reportId=null;}
  notice('Opened the original historical source read-only. The working local draft remains retained.');persist();
}
async function restoreHistorical(){
  if(!historical)return;
  const previous=dirty()?clone(draft):null,selected=historical.revision;
  const body={expectedHead:state.workspace.head,revisionId:selected.id,note:'Restored dataset source '+selected.id+' [diffbot-restore-'+crypto.randomUUID()+']'};
  await mutate('/api/restore',body,'restore');state=await api('/api/state');await adoptHead();draft.previous=previous;persist();
  notice('Restored the selected original source as a new native revision. Saved history remains available.'+(previous?' The former local draft is recoverable below.':''));
}
function historyView(){
  const config=activeConfig(),textValue=ui.configText??json(config);
  return [heading('History and source recovery','Reopen original saved source, restore it as a new revision, merge a concurrent draft, or export the complete retained workspace.',
    button('Export workspace',()=>download('/api/export','diffbot-dataset.python-workspace.json'),{read:true})),
    historical?card(text('h3','Historical revision '+short(historical.revision.id)),text('p',historical.revision.note||'No revision note'),
      row(button('Return to working draft',()=>{historical=null;ui.configText=null;ui.mappingRows=null;persist();},{read:true}),button('Restore as a new revision',restoreHistorical,{primary:true,id:'restore-revision'}))):null,
    card(text('h3','Local operator draft'),definitions([
      ['Based on',mono(draft.base.id)],['Current saved head',mono(state.workspace.head)],['Unsaved source changes',String(dirty())],
      ['Draft storage',storageFailure?storageFailure.message:'Original workspace draft store']]),
      field('Revision note',input(draft.note,{disabled:!editable(),id:'revision-note',oninput:event=>{draft.note=event.target.value;changed();}})),
      row(button('Download local operator draft',()=>saveBytes(enc.encode(json(snapshot())+'\n'),'diffbot-operator-local-draft.json','application/json'),{read:true,id:'download-local-draft'}),
        button('Merge with current source',mergeLatest,{disabled:!!historical||!dirty()||draft.base.id===state.workspace.head,id:'merge-current'}),
        button('Use current saved source',async()=>{state=await api('/api/state');await adoptHead({preservePrevious:dirty()});notice('Current saved source opened. The previous local draft remains recoverable below.');},{read:true})),
      draft.previous?button('Recover previous local draft',()=>{const previous=clone(draft.previous);draft.previous=null;draft=previous;historical=null;ui.configText=null;ui.mappingRows=null;persist();notice('Recovered the previous local draft. Merge with the current source if its base is older.');},{read:true}):null),
    card(text('h3','Original saved revisions'),table(['Revision','When','Note','Retained source','Open'],[...state.revisions].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>[
      element('div',{},mono(r.id),r.id===state.workspace.head?badge('Current'):null),when(r.createdAt),r.note,fmt(r.files)+' files · '+byteText(r.bytes),
      button('Open revision',()=>openHistorical(r.id),{read:true,id:'open-revision-'+r.id})
    ]))),
    card(text('h3','Complete dataset configuration'),text('p','Edit the saved application configuration while preserving original source code, captures and merchant settings. Existing decision history remains an unchanged prefix.'),
      area(textValue,{class:'code wide-json',disabled:!editable(),id:'workspace-json',oninput:event=>{ui.configText=event.target.value;persist();}}),
      button('Apply configuration JSON to draft',()=>{
        const raw=ui.configText??json(config),safe=parseOriginalJSON(raw);noCredentials(safe);
        const value=parseJSON(raw,'Workspace configuration');
        if(value?.schema!==SCHEMA||!Array.isArray(value.editions)||!value.editions.length)throw new Error('Keep the original Diffbot workspace schema and actual source editions.');
        assertHistoryPrefix(draft.baseConfig,value);draft.config=value;ui.configText=null;ui.mappingRows=null;changed();notice('Configuration applied to the local draft. Original native inspection reports any source contract issue.');
      },{disabled:!!historical,id:'apply-workspace-json'}),
      ui.latestConfig?detail('Latest saved source for an explicit merge',ui.latestConfig):null,
      detail('Original retained file identities',activeRevision().files)),
    pending?detail('Exact retained pending operation',pending):null];
}
function render(){
  if(!state||!draft)return;
  if(recurringSaveInFlight){renderHeader();renderNavigation();return;}
  recurringMount?.destroy();recurringMount=null;
  renderHeader();renderNavigation();renderEditionControl();
  const views={overview,sources,review,mapping,recurring:recurringView,delivery,history:historyView};
  $('#content').replaceChildren(...(views[ui.tab]||overview)().filter(Boolean));
  if(ui.tab==='review')renderReviewTable();
  const host=$('#recurring-host');
  if(host)recurringMount=mountRecurring(host,{report:report.recurring,config:activeConfig().recurring||report.recurring.config,
    onChange:saveRecurring,readOnly:!!historical||busy||!!pending||sourceDirty()});
}
async function boot(){
  if(!token)throw new Error('Open the complete operator URL printed by the current Diffbot workbench serve command.');
  state=await api('/api/state');namespace=state.workspace.id+':diffbot-operator';store=createDraftStore(namespace);
  const [saved,retained]=await Promise.all([store.readDraft(),store.readPending()]);
  if(saved?.schema==='tj.diffbot-operator-local.v1'&&saved.workspaceId===namespace&&saved.draft?.base?.id&&state.revisions.some(r=>r.id===saved.draft.base.id)){
    draft=saved.draft;ui={...ui,...saved.ui};if(!dirty()&&draft.base.id!==state.workspace.head)await adoptHead();
  }else await adoptHead();
  pending=retained?.workspaceId===namespace?retained.request:null;
  if(!TABS.some(([id])=>id===ui.tab))ui.tab='overview';
  const candidates=state.previews.filter(p=>p.revisionId===draft.base.id&&['inspect_dataset','build_dataset'].includes(p.function)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(candidates.length)await openPreview(candidates[0].id);
  render();
}
addEventListener('beforeunload',event=>{if(dirty()||pending||busy||persistRequested||ui.capture){event.preventDefault();event.returnValue='';}});
addEventListener('pagehide',()=>clearTimeout(pollTimer));
boot().catch(error=>{notice(error.message||String(error),true);$('#content').replaceChildren(empty('Reopen the current operator URL. Original saved source remains in the native workspace.'));});
