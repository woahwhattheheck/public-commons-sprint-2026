// MIT. Appraisal panel in the original authenticated Research dossier.
import {renderInspectedSource,renderOriginalRecordControl} from '/source-inspection.js';
const CACHE='research-risk-of-bias-browser-v1',PAGE=30,MAX_BYTES=16*1024*1024;
const ACTIONS=['create-review','revise-protocol','create-assessment','revise-assessment','save-draft','submit-review','adjudicate','review-impact'];
const SECTIONS=[['overview','Overview'],['protocols','Instruments & protocols'],['assessments','Assessments'],['drafts','Reviewer drafts'],['submissions','Submitted reviews'],['comparisons','Compare & resolve'],['impact','Source changes'],['operations','History']];
const ANSWER_STATUS=[['unanswered','Not yet reviewed'],['answered','Answered'],['not_reported','Not reported'],['unavailable','Source unavailable'],['not_applicable','Not applicable']];
const BASIS_STATUS=[['supported','Supported by retained evidence'],['not_reported','Not reported'],['unavailable','Source unavailable'],['not_applicable','Not applicable']];
const arr=v=>Array.isArray(v)?v:[],clone=v=>structuredClone(v),now=()=>new Date().toISOString();
const uid=p=>p+crypto.randomUUID().replaceAll('-','');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const text=v=>v===null||v===undefined?'':String(v),readable=v=>text(v).replaceAll('_',' ').replaceAll('-',' ');
const fail=(code,message)=>Object.assign(new Error(message),{code,detail:message});
const need=(condition,code,message)=>{if(!condition)throw fail(code,message);};
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const date=v=>{const d=new Date(v);return v&&!Number.isNaN(d.getTime())?d.toLocaleString():text(v)||'Not recorded';};
const node=(tag,value,css)=>{const n=document.createElement(tag);if(value!==undefined&&value!==null)n.textContent=text(value);if(css)n.className=css;return n;};
const href=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const download=(body,name,type='application/json')=>{const url=URL.createObjectURL(new Blob([body],{type})),a=node('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);};
async function browserCache(){
 need(globalThis.indexedDB,'APPRAISAL_BROWSER_STORAGE','This browser needs IndexedDB to retain appraisal drafts and original requests.');
 const names={drafts:'workspaceDrafts',requests:'workspaceRequests'};
 const db=await new Promise((resolve,reject)=>{
  let settled=false;const q=indexedDB.open(CACHE,2);
  q.onupgradeneeded=()=>{for(const name of Object.values(names))if(!q.result.objectStoreNames.contains(name)){const store=q.result.createObjectStore(name,{keyPath:['workspaceId','id']});store.createIndex('workspaceDossier',['workspaceId','dossierId']);}};
  q.onerror=()=>{if(!settled){settled=true;reject(q.error);}};
  q.onblocked=()=>{if(!settled){settled=true;reject(fail('APPRAISAL_BROWSER_STORAGE','Close the older appraisal window to reopen its draft storage.'));}};
  q.onsuccess=()=>{if(settled){q.result.close();return;}settled=true;resolve(q.result);};
 });
 let closed=false;db.onversionchange=()=>{closed=true;db.close();};db.onclose=()=>{closed=true;};
 const transact=(name,mode,work)=>new Promise((resolve,reject)=>{
  if(closed){reject(fail('APPRAISAL_BROWSER_STORAGE','Reload the original workspace to reopen its retained drafts.'));return;}
  let tx,result,error;
  try{tx=db.transaction(names[name],mode,mode==='readwrite'?{durability:'strict'}:undefined);}catch(e){reject(e);return;}
  const abort=e=>{error=e;try{tx.abort();}catch{}};
  const read=(request,fn)=>{request.onsuccess=()=>{try{fn(request.result);}catch(e){abort(e);}};};
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||fail('APPRAISAL_BROWSER_STORAGE','The browser did not commit this edit.'));
  try{work(tx.objectStore(names[name]),read,v=>{result=v;},abort);}catch(e){abort(e);}
 });
 const key=value=>{need(typeof value.workspaceId==='string'&&value.workspaceId,'APPRAISAL_WORKSPACE_REQUIRED','Retain the original workspace identity with this browser record.');return[value.workspaceId,value.id];};
 return {
  list:(name,workspaceId,dossierId)=>transact(name,'readonly',(s,r,done)=>r(s.index('workspaceDossier').getAll([workspaceId,dossierId]),v=>done(v.sort((a,b)=>(b.updatedAt||b.createdAt).localeCompare(a.updatedAt||a.createdAt))))),
  saveDraft:value=>transact('drafts','readwrite',(s,r,done)=>r(s.get(key(value)),old=>{
   need(!old||old.writer===value.writer&&(old.editVersion<value.editVersion||same(old,value)),'APPRAISAL_DRAFT_CHANGED','Another window changed this draft. Download the open edit before reopening its saved copy.');
   if(!old||!same(old,value))s.put(clone(value));done(clone(value));
  })),
  removeDraft:(id,expected)=>transact('drafts','readwrite',(s,r,done)=>r(s.get(key({...expected,id})),old=>{const match=!!old&&same(old,expected);if(match)s.delete(key(old));done(match);})),
  prepare:value=>transact('requests','readwrite',(s,r,done)=>r(s.get(key(value)),old=>{
   need(!old||old.workspaceId===value.workspaceId&&old.dossierId===value.dossierId&&same(old.payload,value.payload),'APPRAISAL_REQUEST_CHANGED','This original request ID belongs to different input.');
   if(old){done(old);return;}
   r(s.index('workspaceDossier').getAll([value.workspaceId,value.dossierId]),rows=>{
    need(!rows.some(v=>['READY','SENDING','UNCERTAIN'].includes(v.state)),'APPRAISAL_REQUEST_PENDING','Recover the original outstanding request before preparing another save for this workspace and dossier.');
    s.add(clone(value));done(clone(value));
   });
  })),
  receipt:(id,workspaceId,changes)=>transact('requests','readwrite',(s,r,done)=>r(s.get(key({id,workspaceId})),old=>{
   need(old,'APPRAISAL_REQUEST_MISSING','The original retained request is unavailable.');
   need(!Object.keys(changes).some(k=>['id','workspaceId','instanceId','dossierId','payload','createdAt','draft'].includes(k)),'APPRAISAL_REQUEST_CHANGED','The original request, destination and source draft are immutable.');
   if(old.state==='COMPLETE'){
    if(changes.state==='COMPLETE')need(same(old.reply?.operation,changes.reply?.operation),'APPRAISAL_RECEIPT_CHANGED','The original operation returned a different receipt.');
    done(old);return;
   }
   const value={...old,...clone(changes),updatedAt:now()};s.put(value);done(value);
  })),
  close(){closed=true;db.close();}
 };
}
export function createRiskOfBiasPanel({root,tab,api:hostApi,task,notify,getDossier,getWorkspace,isBusy,onReceived}){
 const writer=uid('window_'),initial=new URLSearchParams(location.hash.slice(1));
 const state={dossier:null,workspace:null,visible:false,closed:false,mounted:false,mountPromise:null,loading:false,busy:false,accepting:false,
  reviewId:initial.get('robReview')||null,assessmentId:initial.get('robAssessment')||null,assessmentEditionId:initial.get('robEdition')||null,
  section:SECTIONS.some(([k])=>k===initial.get('robSection'))?initial.get('robSection'):'overview',
  revision:null,offset:0,actorId:'',filter:'',view:null,focus:null,loadGeneration:0,sourceGeneration:0,
  catalog:{revision:null,reviews:[],protocols:[],studies:[],results:[],sources:[]},
  draft:null,savedDrafts:[],requests:[],cache:null,cachePromise:null,writeQueue:Promise.resolve(),storageError:null,message:null,lastReply:null};
 const controls={},unsaved=new Map();
 function hostWorkspace(){
  const value=typeof getWorkspace==='function'?getWorkspace():null;
  need(value&&typeof value.workspaceId==='string'&&value.workspaceId&&typeof value.instanceId==='string'&&value.instanceId,'APPRAISAL_WORKSPACE_REQUIRED','Open the original Research workspace session before using appraisal.');
  return {workspaceId:value.workspaceId,instanceId:value.instanceId};
 }
 function captureContext(){const workspace=hostWorkspace();need(state.workspace&&same(state.workspace,workspace),'APPRAISAL_WORKSPACE_CHANGED','The selected workspace changed. Open its current dossier.');return{...workspace,dossierId:state.dossier?.id||null};}
 function current(c){let workspace;try{workspace=hostWorkspace();}catch{return false;}return !state.closed&&same(workspace,state.workspace)&&workspace.workspaceId===c.workspaceId&&workspace.instanceId===c.instanceId&&(state.dossier?.id||null)===c.dossierId;}
 function requireContext(c){need(current(c),'APPRAISAL_WORKSPACE_CHANGED','The original workspace or dossier changed while this operation was opening. Its retained drafts and requests remain with their original workspace.');}
 async function api(url,options={},captured=captureContext()){
  requireContext(captured);const result=await hostApi(url,{...options,workspaceId:captured.workspaceId});requireContext(captured);return result;
 }
 const base=(id=state.dossier?.id)=>'/api/dossiers/'+encodeURIComponent(id);
 const pending=()=>state.requests.find(v=>['READY','SENDING','UNCERTAIN'].includes(v.state));
 const busy=()=>state.busy||state.loading||!!isBusy();
 function message(value,kind='info'){state.message=value?{value,kind}:null;if(controls.message){controls.message.textContent=value||'';controls.message.dataset.kind=kind;controls.message.hidden=!value;}}
 function report(e){const value=e?.detail||e?.message||String(e);message(value,'error');notify(value,'error');}
 const run=fn=>{const captured=captureContext();return task(async()=>{requireContext(captured);state.busy=true;updateBusy();try{return await fn();}catch(e){if(current(captured))report(e);else notify(e?.detail||e?.message||String(e),'error');}finally{state.busy=false;updateBusy();}});};
 function button(label,fn,{primary=false,disabled=false}={}){
  const b=node('button',label,primary?'primary':'');b.type='button';b.dataset.robButton='1';b.dataset.robDisabled=disabled?'1':'0';b.disabled=disabled||busy();b.addEventListener('click',()=>run(fn));return b;
 }
 const tag=label=>node('span',label,'rob-tag');
 const actions=(...items)=>{const n=node('div',undefined,'rob-actions');n.append(...items.filter(Boolean));return n;};
 const details=(title,value)=>{const d=node('details',undefined,'rob-original');d.append(node('summary',title));let rendered=false;d.addEventListener('toggle',()=>{if(d.open&&!rendered){rendered=true;d.append(node('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));}});return d;};
 const field=(label,control,hint)=>{const n=node('label',undefined,'rob-field');n.append(node('span',label),control);if(hint)n.append(node('small',hint));return n;};
 function input(value,onChange,{rows,type='text',required=false,max=100000,min,readonly=false,placeholder=''}={}){
  const e=node(rows?'textarea':'input');if(rows)e.rows=rows;else e.type=type;e.value=text(value);e.required=required;e.maxLength=max;e.readOnly=readonly;e.placeholder=placeholder;if(min!==undefined)e.min=String(min);e.dataset.robEdit='1';
  e.addEventListener('input',()=>onChange(e.value));return e;
 }
 function select(options,value,onChange,{required=false,disabled=false}={}){
  const e=node('select');e.required=required;e.dataset.robEdit='1';e.dataset.robDisabled=disabled?'1':'0';e.disabled=disabled;
  for(const [key,label] of options){const o=node('option',label);o.value=text(key);e.append(o);}e.value=text(value);e.addEventListener('change',()=>onChange(e.value));return e;
 }
 function check(label,value,onChange){const e=node('input');e.type='checkbox';e.checked=!!value;e.dataset.robEdit='1';e.addEventListener('change',()=>onChange(e.checked));const l=node('label',undefined,'rob-check');l.append(e,node('span',label));return l;}
 const grid=(...items)=>{const n=node('div',undefined,'rob-form-grid');n.append(...items);return n;};
 const wide=n=>{n.classList.add('rob-wide');return n;};
 function fieldset(title){const n=node('fieldset',undefined,'rob-fieldset');n.append(node('legend',title));return n;}
 const titleOf=v=>v?.name||v?.title||v?.label||v?.instrument?.title||v?.id||v?.assessmentId||v?.resultId||v?.studyId||'Retained record';
 const rowId=v=>v?.editionId||v?.id||v?.assessmentEditionId||v?.resultId||v?.studyId||v?.occurrenceId||'';
 const protocolDefinition=p=>p?.definition||p?.protocol||p;
 async function ensureMounted(){
  if(state.mounted)return;
  if(!state.mountPromise)state.mountPromise=(async()=>{
   const response=await fetch('/risk-of-bias/panel.html',{credentials:'same-origin',cache:'no-cache'});
   need(response.ok,'APPRAISAL_PANEL_ASSET','The original appraisal panel asset could not be opened.');
   const doc=new DOMParser().parseFromString(await response.text(),'text/html'),panel=doc.body.firstElementChild;
   need(panel?.classList.contains('rob-panel')&&doc.body.children.length===1&&!panel.querySelector('script,iframe,object,embed'),'APPRAISAL_PANEL_ASSET','The appraisal panel asset differs from its declared structure.');
   if(state.closed)return;root.replaceChildren(document.importNode(panel,true));
   for(const e of root.querySelectorAll('[data-rob]'))controls[e.dataset.rob]=e;
   for(const key of ['primary-actions','message','context','toolbar','navigation','summary','loading','section-title','section-count','list-actions','filters','records','pagination','detail','editor','sources','recovery'])need(controls[key],'APPRAISAL_PANEL_ASSET','The original panel is missing '+key+'.');
   state.mounted=true;
  })().catch(e=>{state.mountPromise=null;throw e;});
  return state.mountPromise;
 }
 async function cache(){if(state.cache)return state.cache;if(!state.cachePromise)state.cachePromise=browserCache().then(v=>{state.cache=v;return v;}).catch(e=>{state.cachePromise=null;throw e;});return state.cachePromise;}
 async function browserRecords(){const id=state.dossier?.id;if(!id)return;const captured=captureContext(),c=await cache(),[drafts,requests]=await Promise.all([c.list('drafts',captured.workspaceId,id),c.list('requests',captured.workspaceId,id)]);if(current(captured)){state.savedDrafts=drafts;state.requests=requests;}}
 function persistDraft(){
  if(!state.draft)return state.writeQueue;
  const value=clone(state.draft);unsaved.set(value.id,value);
  state.writeQueue=state.writeQueue.catch(()=>{}).then(async()=>{
   await(await cache()).saveDraft(value);
   if(unsaved.get(value.id)?.editVersion===value.editVersion)unsaved.delete(value.id);
   if(state.workspace?.workspaceId===value.workspaceId&&state.dossier?.id===value.dossierId)state.storageError=null;
  }).catch(e=>{if(state.workspace?.workspaceId===value.workspaceId&&state.dossier?.id===value.dossierId)state.storageError=e.message;throw e;});
  state.writeQueue.catch(()=>{});return state.writeQueue;
 }
 function touch(change){need(state.draft,'APPRAISAL_DRAFT_REQUIRED','Open an appraisal draft.');change(state.draft);state.draft.editVersion++;state.draft.updatedAt=now();persistDraft();updateDraftStatus();}
 function updateDraftStatus(){
  const label=controls.editor?.querySelector('[data-rob-draft-status]'),id=state.draft?.id;
  if(label)label.textContent=state.storageError?'Browser storage: '+state.storageError:unsaved.has(id)?'Saving browser draft…':'Browser draft retained';
  state.writeQueue.finally(()=>{if(label?.isConnected&&state.draft?.id===id)label.textContent=state.storageError?'Browser storage: '+state.storageError:'Browser draft retained';}).catch(()=>{});
 }
 function updateBusy(){
  for(const b of root.querySelectorAll('[data-rob-button]'))b.disabled=busy()||b.dataset.robDisabled==='1';
  for(const e of root.querySelectorAll('[data-rob-edit]'))e.disabled=busy()||e.dataset.robDisabled==='1';
 }
 function rememberSelection(){
  const p=new URLSearchParams(location.hash.slice(1));
  for(const [key,value] of [['robReview',state.reviewId],['robAssessment',state.assessmentId],['robEdition',state.assessmentEditionId],['robSection',state.section]])if(value)p.set(key,value);else p.delete(key);
  history.replaceState(null,'','#'+p);
 }
 function viewUrl({section=state.section,reviewId=state.reviewId,assessmentId=state.assessmentId,assessmentEditionId=state.assessmentEditionId,offset=state.offset,limit=PAGE,revision=state.revision||state.dossier?.revision,actorId=state.actorId}={}){
  const p=new URLSearchParams({section,revision:String(revision),offset:String(offset),limit:String(limit)});
  for(const [k,v] of Object.entries({reviewId,assessmentId,assessmentEditionId,actorId}))if(v)p.set(k,v);
  return base()+'/risk-of-bias?'+p;
 }
 async function allRows(section,options={}){
  const captured=captureContext(),id=state.dossier.id,revision=state.revision||state.dossier.revision,reviewId=options.reviewId===undefined?state.reviewId:options.reviewId,items=[],seen=new Set();let offset=0;
  do{
   need(!seen.has(offset),'APPRAISAL_PAGE_LOOP','The original page cursor repeated.');seen.add(offset);
   need(state.dossier?.id===id&&(state.revision||state.dossier.revision)===revision,'APPRAISAL_VIEW_CHANGED','The selected dossier changed while opening these pages.');
   requireContext(captured);const v=await api(viewUrl({...options,reviewId,section,offset,limit:100,revision}),{},captured);
   need(v.schema==='sf88-research-risk-of-bias-view/v1'&&v.dossierId===id&&v.revision===revision&&state.dossier?.id===id&&(state.revision||state.dossier.revision)===revision,'APPRAISAL_VIEW_CHANGED','This page belongs to another dossier revision.');
   items.push(...arr(v.items));offset=v.nextOffset;
  }while(offset!==null&&offset!==undefined);
  return items;
 }
 async function load({offset=state.offset,section=state.section}={}){
  if(!state.dossier||!state.visible||state.closed)return;
  const captured=captureContext();await ensureMounted();if(!current(captured))return;
  const generation=++state.loadGeneration,id=state.dossier.id,revision=state.revision||state.dossier.revision;
  state.loading=true;state.offset=offset;state.section=section;render();
  try{
   const [view,reviews]=await Promise.all([api(viewUrl({offset,section,revision})),
    state.catalog.revision!==revision?allRows('reviews',{reviewId:null,assessmentId:null,assessmentEditionId:null}):null]);
   if(generation!==state.loadGeneration||state.dossier?.id!==id)return;
   need(view.schema==='sf88-research-risk-of-bias-view/v1'&&view.dossierId===id&&view.revision===revision,'APPRAISAL_VIEW_CHANGED','The appraisal page belongs to another saved dossier revision.');
   state.view=view;state.revision=revision;
   if(state.catalog.revision!==revision)state.catalog={revision,reviews:reviews||[],protocols:[],studies:[],results:[],sources:[]};
   if(view.reviewId)state.reviewId=view.reviewId;
   if(state.focus){const current=arr(view.items).find(v=>rowId(v)===rowId(state.focus));state.focus=current?clone(current):null;}
   await browserRecords();rememberSelection();
  }catch(e){if(generation===state.loadGeneration)report(e);}
  finally{if(generation===state.loadGeneration){state.loading=false;render();}}
 }
 async function fresh(){
  need(state.dossier,'APPRAISAL_DOSSIER_REQUIRED','Open a dossier first.');
  const captured=captureContext(),id=state.dossier.id,view=await api(base(id),{},captured);if(!current(captured))return;
  state.accepting=true;try{await onReceived(view);}finally{state.accepting=false;}
  if(!current(captured))return;state.dossier=view;state.revision=view.revision;state.offset=0;state.catalog.revision=null;await load({offset:0});
 }
 async function choose({reviewId=state.reviewId,assessmentId=state.assessmentId,assessmentEditionId=state.assessmentEditionId,section=state.section}={}){
  const captured=captureContext();if(state.draft)await persistDraft();requireContext(captured);
  const changed=reviewId!==state.reviewId,scopeChanged=changed||assessmentId!==state.assessmentId||assessmentEditionId!==state.assessmentEditionId||section!==state.section;
  if(scopeChanged)state.draft=null;if(changed)state.actorId='';
  state.loadGeneration++;state.sourceGeneration++;state.view=null;state.focus=null;state.focusContext=null;state.offset=0;state.filter='';
  state.reviewId=reviewId||null;state.assessmentId=changed?null:assessmentId||null;state.assessmentEditionId=changed?null:assessmentEditionId||null;state.section=section;
  if(changed){state.catalog.protocols=[];state.catalog.studies=[];state.catalog.results=[];state.catalog.sources=[];}
  if(controls.sources){controls.sources.hidden=true;controls.sources.replaceChildren();}
  await load({offset:0});
 }
 async function begin(action,data,context={}){
  need(state.dossier&&ACTIONS.includes(action),'APPRAISAL_ACTION_REQUIRED','Open a dossier and choose an appraisal operation.');const captured=captureContext();
  await browserRecords();requireContext(captured);need(!pending(),'APPRAISAL_REQUEST_PENDING','Recover the original outstanding request before preparing another save.');
  if(state.draft)await persistDraft();
  requireContext(captured);
  state.draft={schema:'sf88-research-appraisal-browser-draft/v1',id:uid('draft_'),writer,editVersion:1,workspaceId:captured.workspaceId,instanceId:captured.instanceId,dossierId:state.dossier.id,
   reviewId:action==='create-review'?null:state.reviewId,action,actor:{id:state.actorId||'',name:''},baseRevision:state.revision||state.dossier.revision,
   data:clone(data),context:clone(context),createdAt:now(),updatedAt:now()};
  const reviewer=arr(protocolDefinition(context.protocol||state.view?.protocol)?.reviewers).find(v=>v.id===state.draft.actor.id);
  if(reviewer)state.draft.actor=clone(reviewer);
  await persistDraft();await browserRecords();renderEditor();controls.editor?.scrollIntoView({block:'start',behavior:'smooth'});
 }
 async function reopenDraft(old){
  const captured=captureContext();need(old.workspaceId===captured.workspaceId&&old.dossierId===captured.dossierId,'APPRAISAL_DRAFT_DOSSIER','Open the original workspace and dossier for this draft.');
  if(state.draft)await persistDraft();requireContext(captured);
  state.loadGeneration++;state.sourceGeneration++;state.focus=null;state.focusContext=null;state.view=null;state.offset=0;state.filter='';
  state.reviewId=old.reviewId||null;state.assessmentId=old.data?.assessmentId||old.context?.assessment?.id||null;state.assessmentEditionId=old.data?.assessmentEditionId||old.context?.assessment?.editionId||null;
  state.actorId=old.actor?.id||'';state.section=({'create-review':'overview','revise-protocol':'protocols','create-assessment':'assessments','revise-assessment':'assessments','save-draft':'drafts','submit-review':'submissions','adjudicate':'comparisons','review-impact':'impact'})[old.action];
  state.catalog={revision:null,reviews:[],protocols:[],studies:[],results:[],sources:[]};
  state.draft={...clone(old),id:uid('draft_'),writer,editVersion:1,parentDraft:{id:old.id,value:clone(old)},updatedAt:now()};
  await persistDraft();await load({offset:0});if(state.reviewId&&['create-assessment','revise-assessment','save-draft','adjudicate'].includes(old.action))await prepareCatalog();renderEditor();
 }
 function wireFromDraft(){
  const d=state.draft;
  const captured=captureContext();need(d&&d.workspaceId===captured.workspaceId&&d.dossierId===captured.dossierId,'APPRAISAL_DRAFT_REQUIRED','Open this workspace’s original dossier draft.');
  need(d.actor.id.trim()&&d.actor.name.trim(),'APPRAISAL_ACTOR_REQUIRED','Enter the exact named reviewer or resolver identity.');
  need(d.baseRevision===state.dossier.revision&&d.baseRevision===(state.revision||state.dossier.revision),'REVISION_CONFLICT','Refresh the dossier, review this retained draft and explicitly rebase it before saving.');
  validateDraft(d);
  const payload={requestId:uid('appraisal_'),expectedRevision:d.baseRevision,actor:clone(d.actor),action:d.action,data:clone(d.data)};
  if(d.reviewId)payload.reviewId=d.reviewId;
  need(bytes(payload)<=MAX_BYTES,'APPRAISAL_REQUEST_SIZE','This save exceeds the original 16 MiB request limit.');return payload;
 }
 async function saveDraft(form){
  need(form.reportValidity(),'APPRAISAL_FORM_REQUIRED','Complete the highlighted fields.');const captured=captureContext(),draftId=state.draft?.id;
  await persistDraft();requireContext(captured);need(state.draft?.id===draftId,'APPRAISAL_DRAFT_CHANGED','The selected draft changed before request preparation.');const payload=wireFromDraft(),entry={schema:'sf88-research-appraisal-browser-request/v1',id:payload.requestId,workspaceId:captured.workspaceId,instanceId:captured.instanceId,dossierId:state.dossier.id,payload,draft:clone(state.draft),state:'READY',createdAt:now(),updatedAt:now()};
  const retained=await(await cache()).prepare(entry);await browserRecords();await sendOriginal(retained);
 }
 async function sendOriginal(entry){
  const captured=captureContext();need(entry.workspaceId===captured.workspaceId&&entry.dossierId===captured.dossierId,'APPRAISAL_REQUEST_DOSSIER','Open the original workspace and dossier to recover this request.');
  need(['READY','SENDING','UNCERTAIN'].includes(entry.state),'APPRAISAL_REQUEST_TERMINAL','This request already has a recorded outcome.');
  const c=await cache();requireContext(captured);await c.receipt(entry.id,entry.workspaceId,{state:'SENDING',lastAttemptAt:now()});await browserRecords();requireContext(captured);renderRecovery();let reply;
  try{
   reply=await hostApi(base(entry.dossierId)+'/risk-of-bias/reviews?projection=metadata',{method:'POST',body:entry.payload,workspaceId:entry.workspaceId});
   need(reply?.operation?.requestId===entry.id&&reply.operation.action===entry.payload.action&&reply.dossier?.id===entry.dossierId,'APPRAISAL_OPERATION_RECEIPT','The response did not contain this original request’s operation receipt.');
   await c.receipt(entry.id,entry.workspaceId,{state:'COMPLETE',reply:clone(reply),error:null});
  }catch(e){
   const terminal=Number.isInteger(e?.status)&&[400,403,404,405,409,413,415,422].includes(e.status);
   await c.receipt(entry.id,entry.workspaceId,{state:terminal?'REJECTED':'UNCERTAIN',error:{code:e?.code||'REQUEST_FAILED',message:e?.detail||e?.message||String(e),at:now()}}).catch(storage=>{if(current(captured))state.storageError=storage.message;});
   if(current(captured)){await browserRecords();renderRecovery();}throw e;
  }
  if(!current(captured)){notify('The original appraisal operation was saved for its workspace '+entry.workspaceId+' and dossier '+entry.dossierId+'.');return;}
  state.lastReply=reply;
  if(state.draft?.id===entry.draft?.id){const old=clone(state.draft);await c.removeDraft(old.id,old);if(old.parentDraft)await c.removeDraft(old.parentDraft.id,old.parentDraft.value);state.draft=null;}
  const result=reply.operation.result||{},reviewId=reply.operation.reviewId||result.review?.id||entry.payload.reviewId||state.reviewId;
  if(reviewId!==state.reviewId){state.assessmentId=null;state.assessmentEditionId=null;state.actorId='';state.focus=null;state.focusContext=null;state.view=null;state.filter='';state.loadGeneration++;state.sourceGeneration++;}
  state.reviewId=reviewId;
  if(result.assessment){state.assessmentId=result.assessment.id||result.assessment.assessmentId;state.assessmentEditionId=result.assessment.editionId||result.assessment.assessmentEditionId;state.section='assessments';}
  if(result.draft)state.section='drafts';if(result.submission)state.section='submissions';if(result.adjudication)state.section='comparisons';
  await browserRecords();await fresh();
  message((reply.duplicate?'Recovered original operation. ':'Saved operation. ')+readable(entry.payload.action)+' · revision '+reply.operation.revision);
  notify('Appraisal '+readable(entry.payload.action)+' saved.');
 }
 async function rebase(){
  const original=state.draft;need(original,'APPRAISAL_DRAFT_REQUIRED','Open a draft first.');await browserRecords();need(!pending(),'APPRAISAL_REQUEST_PENDING','Recover the original request before rebasing a draft.');
  await fresh();need(state.draft?.id===original.id,'APPRAISAL_DRAFT_CHANGED','The selected draft changed.');
  touch(d=>{d.baseRevision=state.dossier.revision;d.rebasedAt=now();});await persistDraft();renderEditor();
  message('The draft now uses the current dossier revision. Review its selected protocol, source and any superseded draft or submission before saving.');
 }
 async function importRequest(file){
  need(file&&file.size<=MAX_BYTES,'APPRAISAL_REQUEST_SIZE','Choose a complete original request of at most 16 MiB.');
  const captured=captureContext();let v;try{v=JSON.parse(await file.text());}catch{throw fail('JSON_INVALID','The request file is not valid JSON.');}requireContext(captured);
  const p=v.payload||v;
  need(p&&typeof p.requestId==='string'&&ACTIONS.includes(p.action)&&p.actor?.id&&p.actor?.name&&Number.isSafeInteger(p.expectedRevision)&&p.data&&typeof p.data==='object','APPRAISAL_REQUEST_INVALID','The complete original request must include its ID, actor, action, data and expected revision.');
  need(v.workspaceId===captured.workspaceId&&v.dossierId===captured.dossierId,'APPRAISAL_REQUEST_DOSSIER','Open the request file in its original workspace and dossier. Use the complete downloaded request envelope, which retains that destination.');
  const c=await cache();requireContext(captured);await c.prepare({schema:'sf88-research-appraisal-browser-request/v1',id:p.requestId,workspaceId:v.workspaceId,instanceId:v.instanceId||captured.instanceId,dossierId:v.dossierId,payload:clone(p),state:'READY',createdAt:now(),updatedAt:now()});
  await browserRecords();renderRecovery();message('Original request imported. Review its retained input, then submit that same request.');
 }


 const linesOf=v=>text(v).split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
 const emptyRights=()=>({basis:'original',statement:'',url:''});
 const DESIGNS=['randomized-parallel','randomized-cluster','randomized-crossover','nonrandomized-intervention','cohort','case-control','cross-sectional','diagnostic-accuracy','prognostic','systematic-review','other'];
 function designChoices(selected,change){const box=fieldset('Applicable study designs');for(const value of DESIGNS)box.append(check(readable(value),arr(selected).includes(value),chosen=>change(value,chosen)));return box;}
 async function useProjectForm(){
  const draftId=state.draft?.id;need(draftId,'APPRAISAL_DRAFT_REQUIRED','Open a protocol draft.');
  const response=await fetch('/risk-of-bias/form-template.json',{credentials:'same-origin',cache:'no-cache'});need(response.ok,'APPRAISAL_FORM_ASSET','The original project appraisal form could not be opened.');
  const template=await response.json();need(state.draft?.id===draftId,'APPRAISAL_DRAFT_CHANGED','The selected protocol draft changed.');
  need(template.instrument?.origin==='reviewer_authored'&&template.form?.origin==='reviewer_authored'&&template.instrument?.version&&template.form?.version&&Array.isArray(template.form.domains)&&Array.isArray(template.form.judgments),'APPRAISAL_FORM_ASSET','The project form asset differs from its declared authored structure.');
  const original=clone(state.draft);await persistDraft();await reopenDraft(original);
  touch(d=>{d.data.protocol.instrument=clone(template.instrument);d.data.protocol.form=clone(template.form);if(!d.data.protocol.name)d.data.protocol.name=template.form.title+' protocol';});
  await persistDraft();await browserRecords();renderEditor();renderRecovery();message('The original project form is selected. Name its reviewers, assign a resolver, and review its applicability before saving.');
 }
 async function openMethodReferences(){
  const dossierId=state.dossier.id,generation=++state.sourceGeneration;
  const response=await fetch('/risk-of-bias/method-references.json',{credentials:'same-origin',cache:'no-cache'});need(response.ok,'APPRAISAL_METHOD_ASSET','The original method references could not be opened.');
  const value=await response.json();if(state.dossier?.id!==dossierId||generation!==state.sourceGeneration)return;const box=controls.sources;box.hidden=false;box.replaceChildren(node('h3','Instrument and method references'),node('p','Use the exact published version, design applicability and rights statement when selecting an instrument.','rob-muted'));
  const full=details('Original method metadata and source links',value);full.open=true;box.append(full,button('Close references',async()=>{box.hidden=true;box.replaceChildren();}));box.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 function blankProtocol(){return {name:'',description:'',instrument:{id:uid('instrument_'),title:'',version:'',origin:'reviewer_authored',sourceUrls:[],applicableDesigns:[],scope:'result',rights:emptyRights()},
  form:{title:'',version:'',origin:'reviewer_authored',sourceUrls:[],rights:emptyRights(),domains:[{id:'domain_1',title:'',description:'',requiresEvidence:true,fields:[{id:'field_1',label:'',type:'text',choices:[],required:true,requiresEvidence:true,help:''}]}],
   judgments:[{id:'judgment_1',label:'',description:''}],requireDomainJudgments:true,requireOverall:true},
  reviewers:[{id:'reviewer_1',name:''},{id:'reviewer_2',name:''}],resolverIds:[],minimumReviewers:2,disagreementProcedure:''};}
 function validateProtocol(p){
  need(p?.name&&p.instrument?.id&&p.instrument.title&&p.instrument.version&&p.form?.title&&p.form.version,'APPRAISAL_PROTOCOL_REQUIRED','Name the protocol, instrument and review form, including their explicit versions.');
  need(arr(p.instrument.applicableDesigns).length&&p.instrument.applicableDesigns.every(v=>DESIGNS.includes(v)),'APPRAISAL_DESIGN_REQUIRED','Choose the study designs to which this instrument applies.');
  need(arr(p.form.domains).length&&arr(p.form.judgments).length,'APPRAISAL_FORM_REQUIRED','Add the review domains and configured judgment choices.');
  need(arr(p.reviewers).length>=2&&arr(p.reviewers).every(r=>r.id&&r.name)&&new Set(p.reviewers.map(r=>r.id)).size===p.reviewers.length&&Number.isSafeInteger(p.minimumReviewers)&&p.minimumReviewers>=2&&p.minimumReviewers<=p.reviewers.length,'APPRAISAL_REVIEWERS_REQUIRED','Assign at least two distinct named reviewers and a minimum of two or more independent reviews.');
  need(arr(p.resolverIds).length&&text(p.disagreementProcedure).trim(),'APPRAISAL_RESOLUTION_REQUIRED','Assign a resolver and describe the disagreement procedure.');
  for(const domain of p.form.domains){
   need(domain.id&&domain.title&&arr(domain.fields).length,'APPRAISAL_DOMAIN_REQUIRED','Each review domain needs its stable identifier, title and fields.');
   for(const f of domain.fields){
    need(f.id&&f.label,'APPRAISAL_FIELD_REQUIRED','Each review field needs its stable identifier and label.');
    if(['choice','multi'].includes(f.type))need(arr(f.choices).length&&f.choices.every(c=>c.id&&c.label),'APPRAISAL_CHOICES_REQUIRED','Complete each choice identifier and label.');
   }
  }
  need(p.form.judgments.every(j=>j.id&&j.label),'APPRAISAL_JUDGMENTS_REQUIRED','Complete every judgment identifier and label.');
 }
 function validateDraft(d){
  if(['create-review','revise-protocol'].includes(d.action))validateProtocol(d.data.protocol);
  if(d.action==='create-review')need(d.data.questionId&&d.data.eligibilityReviewId&&d.data.name,'APPRAISAL_REVIEW_REQUIRED','Choose the original question, eligibility review and appraisal name.');
  else need(text(d.data.reason).trim(),'APPRAISAL_REASON_REQUIRED','Record the reason for this saved operation.');
  if(['create-assessment','revise-assessment'].includes(d.action)){
   const t=d.data.target;need(d.data.name&&d.data.protocolId&&t.studyId&&Number.isSafeInteger(t.studyVersion)&&t.studySha256,'APPRAISAL_TARGET_REQUIRED','Choose the exact retained study and protocol edition.');
   need(t.design&&text(t.designRationale).trim(),'APPRAISAL_DESIGN_REQUIRED','Select the study design and record the source-based rationale.');
   if(t.scope==='result')need(t.resultId&&Number.isSafeInteger(t.resultVersion)&&t.resultSha256,'APPRAISAL_RESULT_REQUIRED','Choose the exact original result edition.');
   need(arr(t.occurrenceIds).length,'APPRAISAL_SOURCE_REQUIRED','Select the retained reports that supply the appraisal source basis.');
  }
  if(d.action==='submit-review')need(d.data.draftId,'APPRAISAL_DRAFT_REQUIRED','Select this reviewer’s exact saved draft.');
  if(d.action==='adjudicate')need(arr(d.data.submissionIds).length&&d.data.expectedComparisonSha256,'APPRAISAL_COMPARISON_REQUIRED','Open the exact current comparison before resolving its submitted reviews.');
 }
 async function eligibilityReviews(){
  const captured=captureContext(),id=state.dossier.id,revision=state.revision||state.dossier.revision,items=[],seen=new Set();let offset=0;
  do{
   need(!seen.has(offset),'APPRAISAL_PAGE_LOOP','The original eligibility page cursor repeated.');seen.add(offset);
   requireContext(captured);const v=await api(base(id)+'/eligibility?'+new URLSearchParams({section:'reviews',revision:String(revision),offset:String(offset),limit:'100'}),{},captured);
   need(v.dossier?.id===id&&v.dossier.revision===revision,'APPRAISAL_VIEW_CHANGED','The eligibility review page belongs to another saved revision.');
   items.push(...arr(v.items));offset=v.nextOffset;
  }while(offset!==undefined&&offset!==null);
  return items;
 }
 async function beginNewReview(){
  const captured=captureContext(),reviews=await eligibilityReviews();requireContext(captured);need(reviews.length,'APPRAISAL_ELIGIBILITY_REQUIRED','Create and retain the original eligibility review and study links before starting appraisal.');
  await begin('create-review',{questionId:'',eligibilityReviewId:'',name:'',description:'',protocol:blankProtocol()},{eligibilityReviews:reviews});
 }
 function editRights(value,change,label){
  const box=fieldset(label);
  box.append(grid(field('Rights basis',select([['original','Original authored content'],['license','Published license'],['permission','Explicit permission'],['public_domain','Public domain'],['reference_only','Reference metadata']],value.basis,v=>change('basis',v),{required:true})),
   field('Terms or permission URL',input(value.url,v=>change('url',v),{type:'url',max:4000}))),
   field('Rights statement',input(value.statement,v=>change('statement',v),{rows:2,max:20000,required:true}),'Retain the actual terms for this instrument or form edition.'));
  return box;
 }
 function protocolEditor(){
  const d=state.draft,p=d.data.protocol,box=node('div');
  box.append(actions(button('Use project appraisal form',useProjectForm),button('Open instrument references',openMethodReferences)),node('p','The project form supplies five domains and ten original questions. Selecting it preserves the current browser draft and leaves reviewer assignment to this protocol.','rob-muted'));
  if(d.action==='create-review'){
   const questions=arr(state.dossier.questions),reviews=arr(d.context.eligibilityReviews);
   box.append(grid(field('Original research question',select([['','Choose question'],...questions.map(q=>[q.id,q.text||q.title||q.id])],d.data.questionId,v=>{touch(x=>{x.data.questionId=v;x.data.eligibilityReviewId='';});renderEditor();},{required:true})),
    field('Original eligibility review',select([['','Choose saved review'],...reviews.filter(r=>!d.data.questionId||!r.questionId||r.questionId===d.data.questionId).map(r=>[r.id,r.name||r.id])],d.data.eligibilityReviewId,v=>touch(x=>{x.data.eligibilityReviewId=v;}),{required:true}))),
    grid(field('Appraisal review name',input(d.data.name,v=>touch(x=>{x.data.name=v;}),{max:240,required:true})),field('Review description',input(d.data.description,v=>touch(x=>{x.data.description=v;}),{rows:2,max:20000}))));
  }
  box.append(grid(field('Protocol name',input(p.name,v=>touch(x=>{x.data.protocol.name=v;}),{max:240,required:true})),field('Protocol description and instructions',input(p.description,v=>touch(x=>{x.data.protocol.description=v;}),{rows:3,max:20000}))));
  const instrument=fieldset('Selected appraisal instrument');
  instrument.append(grid(field('Instrument identifier',input(p.instrument.id,v=>touch(x=>{x.data.protocol.instrument.id=v;}),{max:240,required:true})),field('Instrument title',input(p.instrument.title,v=>touch(x=>{x.data.protocol.instrument.title=v;}),{max:1000,required:true}))),
   grid(field('Exact instrument version',input(p.instrument.version,v=>touch(x=>{x.data.protocol.instrument.version=v;}),{max:240,required:true})),field('Instrument origin',select([['reviewer_authored','Reviewer authored'],['published','Published instrument']],p.instrument.origin,v=>touch(x=>{x.data.protocol.instrument.origin=v;}),{required:true}))),
   grid(field('Appraisal scope',select([['result','Specific result'],['study','Study']],p.instrument.scope,v=>touch(x=>{x.data.protocol.instrument.scope=v;}),{required:true})),
    designChoices(p.instrument.applicableDesigns,(design,chosen)=>touch(x=>{const original=x.data.protocol.instrument.applicableDesigns;x.data.protocol.instrument.applicableDesigns=chosen?[...new Set([...original,design])]:original.filter(v=>v!==design);}))),
   field('Original instrument source URLs',input(arr(p.instrument.sourceUrls).join('\n'),v=>touch(x=>{x.data.protocol.instrument.sourceUrls=linesOf(v);}),{rows:2,max:20000}),'One original source URL per line.'),
   editRights(p.instrument.rights,(k,v)=>touch(x=>{x.data.protocol.instrument.rights[k]=v;}),'Instrument provenance and rights'));
  box.append(instrument);
  const form=fieldset('Review form');
  form.append(grid(field('Form title',input(p.form.title,v=>touch(x=>{x.data.protocol.form.title=v;}),{max:1000,required:true})),field('Exact form version',input(p.form.version,v=>touch(x=>{x.data.protocol.form.version=v;}),{max:240,required:true}))),
   grid(field('Form origin',select([['reviewer_authored','Project-authored form'],['licensed_reproduction','Licensed reproduction']],p.form.origin,v=>touch(x=>{x.data.protocol.form.origin=v;}),{required:true})),
    field('Original form source URLs',input(arr(p.form.sourceUrls).join('\n'),v=>touch(x=>{x.data.protocol.form.sourceUrls=linesOf(v);}),{rows:2,max:20000}))),
   editRights(p.form.rights,(k,v)=>touch(x=>{x.data.protocol.form.rights[k]=v;}),'Form provenance and rights'),
   node('p','Fields, answer choices and judgments belong to this explicit form edition. The workspace records the reviewer’s assessment; it does not calculate an instrument score.','rob-muted'));
  p.form.domains.forEach((domain,i)=>{
   const dom=fieldset('Domain '+(i+1));
   dom.append(grid(field('Stable domain identifier',input(domain.id,v=>touch(x=>{x.data.protocol.form.domains[i].id=v;}),{max:240,required:true})),field('Domain title',input(domain.title,v=>touch(x=>{x.data.protocol.form.domains[i].title=v;}),{max:1000,required:true}))),
    field('Domain instructions',input(domain.description,v=>touch(x=>{x.data.protocol.form.domains[i].description=v;}),{rows:3,max:20000})),
    check('Require a source basis for this domain judgment',domain.requiresEvidence,v=>touch(x=>{x.data.protocol.form.domains[i].requiresEvidence=v;})));
   domain.fields.forEach((f,j)=>{
    const row=fieldset('Field '+(j+1));
    row.append(grid(field('Stable field identifier',input(f.id,v=>touch(x=>{x.data.protocol.form.domains[i].fields[j].id=v;}),{max:240,required:true})),field('Field label',input(f.label,v=>touch(x=>{x.data.protocol.form.domains[i].fields[j].label=v;}),{rows:2,max:4000,required:true}))),
     grid(field('Answer format',select([['text','Authored text'],['choice','One configured choice'],['multi','Several configured choices']],f.type,v=>{touch(x=>{x.data.protocol.form.domains[i].fields[j].type=v;if(v==='text')x.data.protocol.form.domains[i].fields[j].choices=[];});renderEditor();},{required:true})),
      field('Reviewer help',input(f.help,v=>touch(x=>{x.data.protocol.form.domains[i].fields[j].help=v;}),{rows:2,max:20000}))),
     check('Required before submission',f.required,v=>touch(x=>{x.data.protocol.form.domains[i].fields[j].required=v;})),
     check('Require evidence for this answer',f.requiresEvidence,v=>touch(x=>{x.data.protocol.form.domains[i].fields[j].requiresEvidence=v;})));
    if(f.type!=='text'){
     f.choices.forEach((c,k)=>row.append(grid(field('Choice identifier',input(c.id,v=>touch(x=>{x.data.protocol.form.domains[i].fields[j].choices[k].id=v;}),{max:240,required:true})),
      field('Choice label',input(c.label,v=>touch(x=>{x.data.protocol.form.domains[i].fields[j].choices[k].label=v;}),{max:1000,required:true})),
      actions(button('Remove choice',async()=>{touch(x=>{x.data.protocol.form.domains[i].fields[j].choices.splice(k,1);});renderEditor();})))));
     row.append(button('Add choice',async()=>{touch(x=>{x.data.protocol.form.domains[i].fields[j].choices.push({id:uid('choice_'),label:''});});renderEditor();}));
    }
    row.append(actions(button('Remove field',async()=>{touch(x=>{x.data.protocol.form.domains[i].fields.splice(j,1);});renderEditor();},{disabled:domain.fields.length===1})));dom.append(row);
   });
   dom.append(actions(button('Add field',async()=>{touch(x=>{x.data.protocol.form.domains[i].fields.push({id:uid('field_'),label:'',type:'text',choices:[],required:true,requiresEvidence:true,help:''});});renderEditor();}),
    button('Remove domain',async()=>{touch(x=>{x.data.protocol.form.domains.splice(i,1);});renderEditor();},{disabled:p.form.domains.length===1})));form.append(dom);
  });
  form.append(button('Add review domain',async()=>{touch(x=>{x.data.protocol.form.domains.push({id:uid('domain_'),title:'',description:'',requiresEvidence:true,fields:[{id:uid('field_'),label:'',type:'text',choices:[],required:true,requiresEvidence:true,help:''}]});});renderEditor();}));
  const judgments=fieldset('Configured reviewer judgments');
  p.form.judgments.forEach((j,i)=>judgments.append(grid(field('Judgment identifier',input(j.id,v=>touch(x=>{x.data.protocol.form.judgments[i].id=v;}),{max:240,required:true})),
   field('Displayed judgment',input(j.label,v=>touch(x=>{x.data.protocol.form.judgments[i].label=v;}),{max:1000,required:true})),
   wide(field('Definition',input(j.description,v=>touch(x=>{x.data.protocol.form.judgments[i].description=v;}),{rows:2,max:20000}))),
   actions(button('Remove judgment',async()=>{touch(x=>{x.data.protocol.form.judgments.splice(i,1);});renderEditor();},{disabled:p.form.judgments.length===1})))));
  judgments.append(actions(button('Add judgment',async()=>{touch(x=>{x.data.protocol.form.judgments.push({id:uid('judgment_'),label:'',description:''});});renderEditor();})),
   check('Require a judgment for every domain before submission',p.form.requireDomainJudgments,v=>touch(x=>{x.data.protocol.form.requireDomainJudgments=v;})),
   check('Require an overall judgment before submission',p.form.requireOverall,v=>touch(x=>{x.data.protocol.form.requireOverall=v;})));
  form.append(judgments);box.append(form);
  const reviewers=fieldset('Independent reviewers and resolution');
  p.reviewers.forEach((r,i)=>reviewers.append(grid(field('Reviewer identifier',input(r.id,v=>touch(x=>{x.data.protocol.reviewers[i].id=v;}),{max:240,required:true})),field('Reviewer name',input(r.name,v=>touch(x=>{x.data.protocol.reviewers[i].name=v;}),{max:1000,required:true})),
   actions(button('Remove reviewer',async()=>{touch(x=>{const id=x.data.protocol.reviewers[i].id;x.data.protocol.reviewers.splice(i,1);x.data.protocol.resolverIds=x.data.protocol.resolverIds.filter(v=>v!==id);});renderEditor();},{disabled:p.reviewers.length===1})))));
  reviewers.append(actions(button('Add named reviewer',async()=>{touch(x=>{x.data.protocol.reviewers.push({id:uid('reviewer_'),name:''});});renderEditor();})),
   field('Minimum independent reviewers',input(p.minimumReviewers,v=>touch(x=>{x.data.protocol.minimumReviewers=v===''?null:Number(v);}),{type:'number',min:2,required:true})),
   field('Resolver identifiers',input(p.resolverIds.join('\n'),v=>touch(x=>{x.data.protocol.resolverIds=linesOf(v);}),{rows:2,required:true}),'Use exact assigned reviewer identifiers, one per line.'),
   field('Disagreement procedure',input(p.disagreementProcedure,v=>touch(x=>{x.data.protocol.disagreementProcedure=v;}),{rows:4,max:20000,required:true})));
  box.append(reviewers);return box;
 }
 const passageInput=p=>({occurrenceId:p.occurrenceId,...(p.fileName?{fileName:p.fileName}:{}),locator:p.locator||'',quote:p.quote||'',jsonPointer:p.jsonPointer||'',note:p.note||''});
 const targetInput=t=>({studyId:t.studyId,studyVersion:t.studyVersion,studySha256:t.studySha256,design:t.design||'',designRationale:t.designRationale||'',scope:t.scope,
  resultId:t.resultId??null,resultVersion:t.resultVersion??null,resultSha256:t.resultSha256??null,occurrenceIds:clone(t.occurrenceIds||[]),designBasis:arr(t.designBasis).map(passageInput)});
 const answerInput=a=>({fieldId:a.fieldId,status:a.status,value:clone(a.value??null),rationale:a.rationale||'',basis:arr(a.basis).map(passageInput)});
 const judgmentInput=(j,overall=false)=>j?{...(overall?{}:{domainId:j.domainId}),judgmentId:j.judgmentId,basisStatus:j.basisStatus,rationale:j.rationale||'',basis:arr(j.basis).map(passageInput)}:null;
 async function prepareCatalog(){
  const captured=captureContext(),id=state.dossier.id,revision=state.revision||state.dossier.revision,reviewId=state.reviewId;
  const [protocols,studies,results,sources]=await Promise.all(['protocols','studies','results','sources'].map(section=>allRows(section,{assessmentId:null,assessmentEditionId:null,actorId:null})));
  requireContext(captured);need(state.dossier?.id===id&&state.reviewId===reviewId&&(state.revision||state.dossier.revision)===revision,'APPRAISAL_VIEW_CHANGED','The selected dossier or review changed while opening its original records.');
  Object.assign(state.catalog,{revision,protocols,studies,results,sources});
 }
 function blankTarget(protocol){return {studyId:'',studyVersion:null,studySha256:'',design:'',designRationale:'',scope:protocolDefinition(protocol).instrument.scope,resultId:null,resultVersion:null,resultSha256:null,occurrenceIds:[],designBasis:[]};}
 async function beginAssessment(protocol,assessment=null){
  const captured=captureContext();need(protocol?.id,'APPRAISAL_PROTOCOL_REQUIRED','Open the exact protocol edition first.');await prepareCatalog();requireContext(captured);
  const action=assessment?'revise-assessment':'create-assessment';
  const data={...(assessment?{assessmentId:assessment.id,assessmentEditionId:assessment.editionId}:{}),name:assessment?.name||'',protocolId:protocol.id,target:assessment?targetInput(assessment.target):blankTarget(protocol),reason:''};
  await begin(action,data,{protocol,assessment}); 
 }
 function sourceLabel(id){const s=state.catalog.sources.find(v=>v.occurrenceId===id||v.id===id);return s?(s.title||s.name||id)+' · '+id:id;}
 function passageEditor(basis,setBasis,allowedIds,title){
  const commitBasis=setBasis;setBasis=value=>{basis=clone(value);commitBasis(clone(value));};
  const wrap=fieldset(title);
  if(!basis.length)wrap.append(node('p','No source passage selected. Availability is recorded separately in the answer or judgment.','rob-muted'));
  basis.forEach((p,i)=>{
   const box=fieldset('Passage '+(i+1)),update=(k,v)=>{const copy=clone(basis);if(k==='fileName'&&!v)delete copy[i].fileName;else copy[i][k]=v;setBasis(copy);};
   const fileInput=input(p.fileName||'',v=>update('fileName',v),{max:2048}),source=state.catalog.sources.find(s=>s.occurrenceId===p.occurrenceId||s.id===p.occurrenceId),snap=source?.source||source;
   const inspections=arr(state.dossier.sources).flatMap(s=>[s.inspection,...arr(s.variants).map(v=>v.inspection)]).filter(Boolean),inspection=inspections.find(i=>i.selection?.occurrenceId===p.occurrenceId||(snap?.editionId&&i.selection?.editionId===snap.editionId&&String(i.selection?.key)===String(snap.key)));
   const names=arr(inspection?.files).map(f=>f.name);if(names.length){const list=node('datalist');list.id=uid('rob_file_');for(const name of names){const option=node('option');option.value=name;list.append(option);}fileInput.setAttribute('list',list.id);box.append(list);}
   box.append(field('Exact retained report',select([['','Choose report occurrence'],...allowedIds.map(id=>[id,sourceLabel(id)])],p.occurrenceId,v=>{update('occurrenceId',v);renderEditor();},{required:true})),
    field('Original retained filename',fileInput,'For a source bundle, copy the exact original filename shown in its inspector. Leave empty for a passage in the retained result record.'),
    field('Page, table, field or other original locator',input(p.locator,v=>update('locator',v),{rows:2,max:4000,required:true})),
    field('Literal source passage',input(p.quote,v=>update('quote',v),{rows:3,max:100000}),'Optional. The saved source must contain this exact string.'),
    field('JSON pointer, when applicable',input(p.jsonPointer,v=>update('jsonPointer',v),{max:4096}),'Use the original document pointer for a structured record; leave empty for the engine’s literal string match.'),
    field('Source note',input(p.note,v=>update('note',v),{rows:2,max:20000})),
    actions(button('Inspect original report',()=>openSource(basis[i]?.occurrenceId,basis[i]?.fileName),{disabled:!p.occurrenceId}),button('Remove passage',async()=>{const copy=clone(basis);copy.splice(i,1);setBasis(copy);renderEditor();})));
   wrap.append(box);
  });
  wrap.append(button('Add source passage',async()=>{setBasis([...clone(basis),{occurrenceId:'',locator:'',quote:'',jsonPointer:'',note:''}]);renderEditor();},{disabled:!allowedIds.length}));return wrap;
 }
 function assessmentEditor(){
  const d=state.draft,t=d.data.target,p=protocolDefinition(d.context.protocol),box=node('div');
  if(d.context.assessment)box.append(node('p','This change creates a new immutable assessment edition. Earlier reviews remain bound to their original edition.','rob-notice'),details('Original assessment edition',d.context.assessment));
  box.append(field('Assessment name',input(d.data.name,v=>touch(x=>{x.data.name=v;}),{max:1000,required:true})),
   field('Exact protocol edition',select(state.catalog.protocols.map(v=>[v.id,(v.definition?.name||v.id)+' · edition '+v.edition]),d.data.protocolId,v=>{
    const chosen=state.catalog.protocols.find(p=>p.id===v);if(!chosen)return;
    touch(x=>{x.data.protocolId=chosen.id;x.context.protocol=clone(chosen);const def=protocolDefinition(chosen);x.data.target.scope=def.instrument.scope;if(!def.instrument.applicableDesigns.includes(x.data.target.design))x.data.target.design='';if(def.instrument.scope==='study'){x.data.target.resultId=null;x.data.target.resultVersion=null;x.data.target.resultSha256=null;}});renderEditor();
   },{required:true})),
   details('Selected instrument and form',d.context.protocol));
  const studyKey=s=>JSON.stringify([s.studyId,s.studyVersion,s.studySha256]),resultKey=r=>JSON.stringify([r.resultId,r.resultVersion,r.resultSha256]);
  const study=state.catalog.studies.find(s=>s.studyId===t.studyId&&s.studyVersion===t.studyVersion&&s.studySha256===t.studySha256);
  const studyOptions=[['','Choose study'],...state.catalog.studies.map(s=>[studyKey(s),(s.name||s.studyId)+' · version '+s.studyVersion])];
  if(t.studyId&&!study)studyOptions.push([studyKey(t),'Retained study '+t.studyId+' · version '+t.studyVersion]);
  box.append(field('Original retained study',select(studyOptions,t.studyId?studyKey(t):'',value=>{
   const chosen=state.catalog.studies.find(s=>studyKey(s)===value);if(value&&!chosen)return;
   touch(x=>{Object.assign(x.data.target,{studyId:chosen?.studyId||'',studyVersion:chosen?.studyVersion??null,studySha256:chosen?.studySha256||'',resultId:null,resultVersion:null,resultSha256:null,occurrenceIds:clone(chosen?.occurrenceIds||[]),designBasis:[]});});renderEditor();
  },{required:true})));
  if(t.studyId)box.append(node('p','Retained study version '+t.studyVersion,'rob-muted'),node('code',t.studySha256,'rob-id'));
  if(study)box.append(details('Complete original study record',study.record));
  else if(t.studyId)box.append(node('p','This target retains an earlier study version. Its exact binding remains in the original assessment; selecting a current study explicitly adopts that record’s version and hash.','rob-notice'));
  let selectedResult=null;
  if(t.scope==='result'){
   const rows=state.catalog.results.filter(r=>r.studyId===t.studyId);
   selectedResult=rows.find(r=>r.resultId===t.resultId&&r.resultVersion===t.resultVersion&&r.resultSha256===t.resultSha256)||null;
   const resultOptions=[['','Choose result'],...rows.map(r=>[resultKey(r),(r.name||r.resultId)+' · version '+r.resultVersion])];
   if(t.resultId&&!selectedResult)resultOptions.push([resultKey(t),'Retained result '+t.resultId+' · version '+t.resultVersion]);
   box.append(field('Original result edition',select(resultOptions,t.resultId?resultKey(t):'',value=>{
    const result=rows.find(r=>resultKey(r)===value);if(value&&!result)return;
    touch(x=>{x.data.target.resultId=result?.resultId??null;x.data.target.resultVersion=result?.resultVersion??null;x.data.target.resultSha256=result?.resultSha256??null;
     if(result)x.data.target.occurrenceIds=[...new Set([...x.data.target.occurrenceIds,...arr(result.occurrenceIds)])];});renderEditor();
   },{required:true})));
   if(t.resultId)box.append(node('p','Retained result version '+t.resultVersion,'rob-muted'),node('code',t.resultSha256,'rob-id'));
   if(selectedResult)box.append(details('Complete original result record',selectedResult.record));
   else if(t.resultId)box.append(node('p','This target retains an earlier result version. Choose a current result explicitly to change its saved source basis.','rob-notice'));
  }
  box.append(grid(field('Applicable study design',select([['','Choose design'],...p.instrument.applicableDesigns.map(v=>[v,v])],t.design,v=>touch(x=>{x.data.target.design=v;}),{required:true})),
   field('Design rationale',input(t.designRationale,v=>touch(x=>{x.data.target.designRationale=v;}),{rows:3,max:20000,required:true}))));
  const reports=fieldset('Linked report occurrences');
  for(const id of [...new Set([...arr(study?.occurrenceIds||t.occurrenceIds),...arr(selectedResult?.occurrenceIds)])]){
   const required=arr(selectedResult?.occurrenceIds).includes(id),choice=check(sourceLabel(id)+(required?' · selected result source':''),t.occurrenceIds.includes(id),checked=>{
    touch(x=>{x.data.target.occurrenceIds=checked?[...new Set([...x.data.target.occurrenceIds,id])]:x.data.target.occurrenceIds.filter(v=>v!==id);});renderEditor();
   });if(required){choice.querySelector('input').dataset.robDisabled='1';choice.querySelector('input').disabled=true;}reports.append(choice);
  }
  reports.append(node('p','The selected identities remain tied to their original source editions and hashes.','rob-muted'));box.append(reports);
  box.append(passageEditor(t.designBasis,v=>touch(x=>{x.data.target.designBasis=v;}),t.occurrenceIds,'Evidence for the study design'));
  return box;
 }


 function assignedActor(protocol,{resolver=false}={}){
  const p=protocolDefinition(protocol),actor=arr(p?.reviewers).find(v=>v.id===state.actorId);
  need(actor,'APPRAISAL_ACTOR_REQUIRED','Choose the named reviewer in the appraisal toolbar.');
  if(resolver)need(arr(p.resolverIds).includes(actor.id),'APPRAISAL_RESOLVER_REQUIRED','Choose a resolver assigned in this protocol.');
  return clone(actor);
 }
 async function selectedView(section,assessment,actorId=state.actorId){
  const id=state.dossier.id,revision=state.revision||state.dossier.revision;
  const value=await api(viewUrl({section,assessmentId:assessment?.id||state.assessmentId,assessmentEditionId:assessment?.editionId||state.assessmentEditionId,actorId,revision,offset:0}));
  need(value.schema==='sf88-research-risk-of-bias-view/v1'&&value.dossierId===id&&value.revision===revision&&state.dossier?.id===id&&(state.revision||state.dossier.revision)===revision,'APPRAISAL_VIEW_CHANGED','The selected appraisal response belongs to another saved revision.');
  return value;
 }
 const blankAnswers=protocol=>protocolDefinition(protocol).form.domains.flatMap(d=>d.fields.map(f=>({fieldId:f.id,status:'unanswered',value:null,rationale:'',basis:[]})));
 async function beginReviewerDraft(assessment){
  const captured=captureContext(),v=await selectedView('drafts',assessment);requireContext(captured);need(v.assessment&&v.protocol,'APPRAISAL_ASSESSMENT_REQUIRED','Open the exact assessment and protocol edition.');
  const actor=assignedActor(v.protocol),old=v.actorDraft||null;await prepareCatalog();requireContext(captured);
  await begin('save-draft',{assessmentId:v.assessment.id,assessmentEditionId:v.assessment.editionId,
   answers:old?arr(old.answers).map(answerInput):blankAnswers(v.protocol),judgments:old?arr(old.judgments).map(j=>judgmentInput(j)):[],overall:judgmentInput(old?.overall,true),
   supersedes:old?.id||null,reason:''},{protocol:v.protocol,assessment:v.assessment,actorLocked:actor,actorDraft:old});
  state.draft.actor=actor;await persistDraft();renderEditor();
 }
 async function beginSubmission(draft){
  const captured=captureContext();need(draft.actor?.id===state.actorId,'APPRAISAL_ACTOR_REQUIRED','Choose this draft’s original reviewer before submitting it.');
  const a={id:draft.assessmentId,editionId:draft.assessmentEditionId},v=await selectedView('submissions',a),actor=assignedActor(v.protocol);
  requireContext(captured);need(!v.actorDraft||v.actorDraft.id===draft.id,'APPRAISAL_DRAFT_CHANGED','A newer draft exists for this reviewer. Open that exact current draft before submitting.');
  await begin('submit-review',{assessmentId:draft.assessmentId,assessmentEditionId:draft.assessmentEditionId,draftId:draft.id,supersedes:v.actorSubmission?.id||null,reason:''},
   {protocol:v.protocol,assessment:v.assessment,submittedDraft:clone(draft),previousSubmission:v.actorSubmission||null,actorLocked:actor});
  state.draft.actor=actor;await persistDraft();renderEditor();
 }
 async function comparisonContext(assessment){
  const v=await selectedView('comparisons',assessment,null),c=v.comparison;
  need(v.assessment&&v.protocol&&c,'APPRAISAL_COMPARISON_REQUIRED','Open a saved assessment comparison.');
  const all=await allRows('submissions',{assessmentId:v.assessment.id,assessmentEditionId:v.assessment.editionId,actorId:null});
  const byId=new Map(all.map(s=>[s.id,s])),submissions=arr(c.submissionIds).map(id=>byId.get(id));
  need(submissions.every(Boolean),'APPRAISAL_COMPARISON_CHANGED','The complete original submitted review set could not be opened at this revision.');
  return {view:v,comparison:c,submissions};
 }
 async function beginAdjudication(assessment){
  const captured=captureContext(),{view:v,comparison,submissions}=await comparisonContext(assessment),actor=assignedActor(v.protocol,{resolver:true});requireContext(captured);
  need(submissions.length>=protocolDefinition(v.protocol).minimumReviewers,'APPRAISAL_REVIEWERS_REQUIRED','The protocol still needs more independent submitted reviews.');
  await prepareCatalog();requireContext(captured);
  const previous=comparison.adjudication||null;
  await begin('adjudicate',{assessmentId:v.assessment.id,assessmentEditionId:v.assessment.editionId,submissionIds:clone(comparison.submissionIds),expectedComparisonSha256:comparison.sha256,
   answers:blankAnswers(v.protocol),judgments:[],overall:null,supersedes:previous?.id||null,reason:''},
   {protocol:v.protocol,assessment:v.assessment,comparison,submissions,previousAdjudication:previous,actorLocked:actor});
  state.draft.actor=actor;await persistDraft();renderEditor();
 }
 function updateAnswer(fieldId,change){
  touch(d=>{let a=d.data.answers.find(v=>v.fieldId===fieldId);if(!a){a={fieldId,status:'unanswered',value:null,rationale:'',basis:[]};d.data.answers.push(a);}change(a);});
 }
 function updateJudgment(domainId,change,{overall=false}={}){
  touch(d=>{
   let j=overall?d.data.overall:d.data.judgments.find(v=>v.domainId===domainId);
   if(!j){j={...(overall?{}:{domainId}),judgmentId:'',basisStatus:'',rationale:'',basis:[]};if(overall)d.data.overall=j;else d.data.judgments.push(j);}
   change(j);
  });
 }
 function judgmentEditor(domain,protocol,allowedIds,{overall=false}={}){
  const d=state.draft,definition=protocolDefinition(protocol),id=domain?.id,j=overall?d.data.overall:d.data.judgments.find(v=>v.domainId===id),box=fieldset(overall?'Overall judgment':'Domain judgment');
  const label=value=>arr(definition.form.judgments).find(j=>j.id===value)?.label||value;
  box.append(field('Configured reviewer judgment',select([['','Choose judgment'],...definition.form.judgments.map(v=>[v.id,v.label])],j?.judgmentId||'',value=>{
   if(!value)touch(x=>{if(overall)x.data.overall=null;else x.data.judgments=x.data.judgments.filter(v=>v.domainId!==id);});
   else updateJudgment(id,x=>{x.judgmentId=value;},{overall});
   renderEditor();
  })));
  if(!j?.judgmentId){box.append(node('p','A partial draft can leave this judgment unchosen. Select a configured judgment to record its rationale and source basis.','rob-muted'));return box;}
  const chosen=definition.form.judgments.find(v=>v.id===j.judgmentId);if(chosen?.description)box.append(node('p',chosen.description,'rob-domain-instructions'));
  box.append(field('Basis for '+label(j.judgmentId),select([['','Choose basis status'],...BASIS_STATUS],j.basisStatus,v=>{updateJudgment(id,x=>{x.basisStatus=v;},{overall});renderEditor();},{required:true})),
   field('Reviewer rationale',input(j.rationale,v=>updateJudgment(id,x=>{x.rationale=v;},{overall}),{rows:4,max:100000,required:d.action==='adjudicate'})),
   passageEditor(arr(j.basis),value=>updateJudgment(id,x=>{x.basis=value;},{overall}),allowedIds,'Supporting source passages'));
  return box;
 }
 function answersEditor(){
  const d=state.draft,p=protocolDefinition(d.context.protocol),assessment=d.context.assessment,allowed=arr(assessment.target.occurrenceIds),box=node('div');
  box.append(details('Exact selected study/result and source bindings',assessment.target),details('Protocol instrument, form and reviewer instructions',d.context.protocol));
  if(d.action==='adjudicate'){
   box.append(node('p','The resolution is bound to all current submitted review IDs and their exact comparison. Choose values deliberately and record the reason for the decision.','rob-notice'),
    comparisonTable(d.context.comparison,d.context.submissions,d.context.protocol));
   const starts=fieldset('Use a submitted review as a starting point');
   for(const s of d.context.submissions)starts.append(button('Use '+(s.actor?.name||s.actor?.id)+' review',async()=>{
    touch(x=>{x.data.answers=arr(s.answers).map(answerInput);x.data.judgments=arr(s.judgments).map(j=>judgmentInput(j));x.data.overall=judgmentInput(s.overall,true);});renderEditor();
   }));
   box.append(starts);
  }else if(d.context.actorDraft)box.append(details('Previous saved reviewer draft',d.context.actorDraft));
  for(const domain of p.form.domains){
   const section=node('section',undefined,'rob-domain');section.append(node('h4',domain.title),node('p',domain.description||'','rob-domain-instructions'));
   for(const f of domain.fields){
    const a=d.data.answers.find(v=>v.fieldId===f.id)||{fieldId:f.id,status:'unanswered',value:null,rationale:'',basis:[]},row=fieldset(f.label);
    if(f.help)row.append(node('p',f.help,'rob-domain-instructions'));
    row.append(field('Answer status',select(ANSWER_STATUS,a.status,v=>{
     updateAnswer(f.id,x=>{x.status=v;if(v!=='answered')x.value=null;else if(x.value===null)x.value=f.type==='multi'?[]:'';});renderEditor();
    },{required:true})));
    if(a.status==='answered'){
     if(f.type==='text')row.append(field('Authored answer',input(a.value,v=>updateAnswer(f.id,x=>{x.value=v;}),{rows:4,max:100000,required:true})));
     else if(f.type==='choice')row.append(field('Configured answer choice',select([['','Choose answer'],...f.choices.map(v=>[v.id,v.label])],a.value,v=>updateAnswer(f.id,x=>{x.value=v;}),{required:true})));
     else{const choices=fieldset('Configured answer choices');for(const c of f.choices)choices.append(check(c.label,arr(a.value).includes(c.id),v=>updateAnswer(f.id,x=>{x.value=v?[...new Set([...arr(x.value),c.id])]:arr(x.value).filter(id=>id!==c.id);})));row.append(choices);}
    }
    row.append(field('Answer rationale',input(a.rationale,v=>updateAnswer(f.id,x=>{x.rationale=v;}),{rows:3,max:100000,required:d.action==='adjudicate'&&a.status!=='unanswered'})),
     passageEditor(arr(a.basis),v=>updateAnswer(f.id,x=>{x.basis=v;}),allowed,'Answer source basis'));
    if(f.required)row.append(node('p','This field is required by the protocol before submission.','rob-muted'));
    section.append(row);
   }
   section.append(judgmentEditor(domain,d.context.protocol,allowed));box.append(section);
  }
  box.append(judgmentEditor(null,d.context.protocol,allowed,{overall:true}));
  return box;
 }
 function submissionEditor(){
  const d=state.draft,box=node('div'),draft=d.context.submittedDraft;
  box.append(node('p','Submission freezes this exact saved draft as the reviewer’s independent review. Later corrections retain the previous submission.','rob-notice'),
   recordFacts(draft,[['Draft','id'],['Assessment','assessmentId'],['Assessment edition','assessmentEditionId'],['Saved','createdAt']]),
   reviewSummary(draft,d.context.protocol),
   details('Complete immutable draft being submitted',draft));
  if(d.context.previousSubmission)box.append(details('Previous submission retained by this correction',d.context.previousSubmission));
  return box;
 }
 function impactEditor(){
  const d=state.draft,impact=d.context.impact,box=node('div');box.append(node('h4',impact.title||readable(impact.kind)),details('Exact observed change',impact),
   field('Disposition',select([['','Choose disposition'],['reviewed','Reviewed'],['needs_review','Further review needed'],['out_of_scope','Outside this appraisal scope']],d.data.disposition,v=>touch(x=>{x.data.disposition=v;}),{required:true})),
   node('p','This records the disposition of this exact impact. A changed protocol or source is applied through a new assessment edition and its original review workflow.','rob-muted'));return box;
 }
 function renderEditor(){
  if(!controls.editor)return;controls.editor.replaceChildren();const d=state.draft;if(!d)return;
  const form=node('form',undefined,'rob-editor'),heading=node('div',undefined,'rob-section-heading');heading.append(node('h3',({ 'create-review':'Start appraisal review','revise-protocol':'Revise the protocol','create-assessment':'Create an assessment','revise-assessment':'Revise the assessment','save-draft':'Reviewer draft','submit-review':'Submit independent review','adjudicate':'Resolve submitted reviews','review-impact':'Review source change'})[d.action]),
   button('Close editor',async()=>{await persistDraft();state.draft=null;await browserRecords();renderEditor();renderRecovery();}));
  form.append(heading,node('p','Original dossier revision '+d.baseRevision+(d.reviewId?' · review '+d.reviewId:''),'rob-editor-context'));
  if(d.baseRevision!==state.dossier?.revision)form.append(node('p','This draft was prepared at revision '+d.baseRevision+'. The current dossier is revision '+state.dossier.revision+'.','rob-foreign-revision'),button('Refresh and rebase this draft',rebase,{disabled:!!pending()}));
  const locked=d.context.actorLocked;
  form.append(grid(field('Reviewer / operator identifier',input(d.actor.id,v=>touch(x=>{x.actor.id=v;}),{max:240,required:true,readonly:!!locked})),
   field('Reviewer / operator name',input(d.actor.name,v=>touch(x=>{x.actor.name=v;}),{max:1000,required:true,readonly:!!locked}))));
  if(locked)form.append(node('p','This edit retains the original named reviewer. Choose another reviewer in the toolbar to start that person’s own draft.','rob-muted'));
  if(['create-review','revise-protocol'].includes(d.action))form.append(protocolEditor());
  else if(['create-assessment','revise-assessment'].includes(d.action))form.append(assessmentEditor());
  else if(['save-draft','adjudicate'].includes(d.action))form.append(answersEditor());
  else if(d.action==='submit-review')form.append(submissionEditor());
  else if(d.action==='review-impact')form.append(impactEditor());
  if(d.action!=='create-review')form.append(field(d.action==='adjudicate'?'Reason for the resolution':'Reason for this saved operation',input(d.data.reason,v=>touch(x=>{x.data.reason=v;}),{rows:3,max:100000,required:true})));
  const savebar=node('div',undefined,'rob-savebar'),save=node('button',d.action==='save-draft'?'Save reviewer draft':d.action==='submit-review'?'Submit this review':d.action==='adjudicate'?'Save adjudication':'Save operation','primary');
  save.type='submit';save.dataset.robButton='1';save.dataset.robDisabled=pending()?'1':'0';const status=node('span','','rob-draft-status');status.dataset.robDraftStatus='1';
  savebar.append(save,button('Download browser draft',async()=>download(JSON.stringify(d,null,2)+'\n','appraisal-draft-'+d.id+'.json')),status);
  form.append(savebar,details('Complete authored operation data',d.data));
  form.addEventListener('submit',event=>{event.preventDefault();run(()=>saveDraft(form));});controls.editor.append(form);updateDraftStatus();updateBusy();
 }
 function recordFacts(value,pairs){
  const dl=node('dl');for(const [label,key] of pairs)if(value?.[key]!==undefined&&value[key]!==null)dl.append(node('dt',label),node('dd',typeof value[key]==='object'?JSON.stringify(value[key]):text(value[key])));return dl;
 }
 const judgmentLabel=(id,protocol)=>protocolDefinition(protocol)?.form?.judgments?.find(v=>v.id===id)?.label||id||'Not chosen';
 function reviewSummary(review,protocol){
  const box=node('div'),p=protocolDefinition(protocol);
  if(!p?.form)return details('Saved review',review);
  for(const domain of p.form.domains){
   const card=node('section',undefined,'rob-domain');card.append(node('h4',domain.title));
   for(const f of domain.fields){const a=arr(review.answers).find(a=>a.fieldId===f.id);card.append(node('p',f.label),node('strong',a?readable(a.status)+(a.status==='answered'?' · '+(Array.isArray(a.value)?a.value.map(id=>f.choices?.find(c=>c.id===id)?.label||id).join('; '):f.choices?.find(c=>c.id===a.value)?.label||a.value):''):'Not yet reviewed'));if(a?.rationale)card.append(node('p',a.rationale));if(a?.basis?.length)card.append(details('Original source passages',a.basis));}
   const judgment=arr(review.judgments).find(j=>j.domainId===domain.id);card.append(node('p','Domain judgment: '+judgmentLabel(judgment?.judgmentId,protocol)));if(judgment?.rationale)card.append(node('p',judgment.rationale));if(judgment?.basis?.length)card.append(details('Judgment source basis',judgment.basis));box.append(card);
  }
  box.append(node('h4','Overall judgment'),node('p',judgmentLabel(review.overall?.judgmentId,protocol)));if(review.overall?.rationale)box.append(node('p',review.overall.rationale));if(review.overall?.basis?.length)box.append(details('Overall source basis',review.overall.basis));return box;
 }
 function comparisonTable(comparison,submissions,protocol){
  const wrap=node('div');wrap.append(node('p','Comparison: '+readable(comparison?.status||'pending')+' · '+submissions.length+' independent submissions','rob-muted'));
  if(!submissions.length){wrap.append(node('p','No independent reviews have been submitted for this assessment edition.','rob-empty'));return wrap;}
  const table=node('table',undefined,'rob-review-compare'),head=node('thead'),header=node('tr');header.append(node('th','Field / judgment'));
  for(const s of submissions)header.append(node('th',(s.actor?.name||s.actor?.id)+' · '+s.id));head.append(header);table.append(head);
  const body=node('tbody'),p=protocolDefinition(protocol);
  for(const row of arr(comparison.rows)){
   const tr=node('tr'),title=node('th',row.label||row.fieldId||row.domainId||'Overall judgment');
   if(row.valueDisagreement)title.append(node('p','Values differ','rob-tag'));if(row.rationaleVariation)title.append(node('p','Rationales differ','rob-tag'));
   tr.append(title);
   for(const submission of submissions){
    const cell=arr(row.values).find(v=>v.submissionId===submission.id),td=node('td');td.dataset.disagrees=String(!!row.valueDisagreement||!!row.rationaleVariation);
    if(!cell){td.append(node('p','This original comparison row has no value for the retained submission.'));tr.append(td);continue;}
    const answer=cell.answer,judgment=cell.judgment,field=p.form.domains.flatMap(d=>d.fields).find(f=>f.id===row.fieldId);
    if(answer){
     const value=Array.isArray(answer.value)?answer.value.map(id=>field?.choices?.find(c=>c.id===id)?.label||id).join('; '):field?.choices?.find(c=>c.id===answer.value)?.label||answer.value;
     td.append(node('strong',readable(answer.status)+(answer.status==='answered'?' · '+value:'')),node('p',answer.rationale||''));
     if(answer.basis?.length)td.append(details('Original answer passages',answer.basis));
    }else if(judgment){
     td.append(node('strong',judgmentLabel(judgment.judgmentId,protocol)),node('p',readable(judgment.basisStatus)),node('p',judgment.rationale||''));
     if(judgment.basis?.length)td.append(details('Original judgment passages',judgment.basis));
    }else td.append(node('p','No saved answer or judgment'));
    tr.append(td);
   }
   body.append(tr);
  }
  table.append(body);wrap.append(table,details('Exact native comparison and submission binding',comparison));return wrap;
 }
 async function openSource(occurrenceId,fileName=null){
  need(occurrenceId,'APPRAISAL_SOURCE_REQUIRED','Select an original retained report.');const captured=captureContext(),sourceApi=(url,options)=>api(url,options,captured),generation=++state.sourceGeneration,id=state.dossier.id,revision=state.revision||state.dossier.revision;
  let source=state.catalog.sources.find(v=>v.occurrenceId===occurrenceId||v.id===occurrenceId);
  if(!source){const rows=await allRows('sources',{assessmentId:null,assessmentEditionId:null,actorId:null});if(generation!==state.sourceGeneration||state.dossier?.id!==id)return;state.catalog.sources=rows;source=rows.find(v=>v.occurrenceId===occurrenceId||v.id===occurrenceId);}
  need(source,'APPRAISAL_SOURCE_REQUIRED','The selected original report occurrence is absent at this saved revision.');
  const snap=source.source||source,box=controls.sources;box.hidden=false;box.replaceChildren();
  box.append(actions(node('h3',source.title||snap.title||occurrenceId),button('Close source',async()=>{state.sourceGeneration++;box.hidden=true;box.replaceChildren();})),
   recordFacts(snap,[['Occurrence','occurrenceId'],['Source edition','editionId'],['Source SHA-256','sourceSha256'],['Bytes','sourceBytes'],['Question','questionId']]));
  const url=href(snap.url||source.url);if(url){const a=node('a','Open original source URL');a.href=url;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}
  const group=arr(state.dossier.sources).find(s=>arr(s.citations).some(c=>c.occurrenceId===occurrenceId||(c.editionId===snap.editionId&&String(c.key)===String(snap.key)))),
   citation=arr(group?.citations).find(c=>c.occurrenceId===occurrenceId||(c.editionId===snap.editionId&&String(c.key)===String(snap.key)));
  if(citation)renderOriginalRecordControl({root:box,citation,dossierId:id,revision,api:sourceApi,task,notify});
  const variant=arr(group?.variants).find(v=>v.inspection?.selection?.editionId===snap.editionId&&String(v.inspection?.selection?.key)===String(snap.key));
  if(group&&(variant||group.inspection?.selection?.occurrenceId===occurrenceId)){
   const files=node('div'),excerpt=node('pre',undefined,'rob-quote');box.append(files,excerpt);renderInspectedSource({filesRoot:files,excerpt,source:group,variant,dossierId:id,revision,api:sourceApi,task,notify});
  }
  if(snap.editionId&&snap.key!==undefined){
   box.append(button('Open complete retained source inspection',async()=>{
    const exact=await sourceApi(base(id)+'/retained-editions/'+encodeURIComponent(snap.editionId)+'/occurrences/'+encodeURIComponent(snap.key)+'?revision='+revision);
    if(generation!==state.sourceGeneration||state.dossier?.id!==id)return;const full=details('Complete original source inspection',exact);full.open=true;box.append(full);
   }));
  }
  if(fileName){box.append(node('p','Selected original file: '+fileName,'rob-notice'));for(const row of box.querySelectorAll('.source-bundle-file'))if(row.querySelector('strong')?.textContent===fileName)row.dataset.robSelectedFile='true';}
  box.append(details('Complete source occurrence',source));box.scrollIntoView({block:'nearest',behavior:'smooth'});
 }


 function selectedProtocol(){return state.focusContext?.protocol||state.focusContext?.view?.protocol||state.view?.protocol||null;}
 function sourceLinks(values,box){
  for(const value of arr(values)){const url=href(value);if(!url)continue;const p=node('p'),a=node('a',url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);box.append(p);}
 }
 function factsProtocol(protocol){
  const p=protocolDefinition(protocol),box=node('article',undefined,'rob-card');
  box.append(node('h3',p.name||p.instrument?.title||'Appraisal protocol'),node('p',p.description||'','rob-muted'),
   recordFacts(protocol,[['Protocol edition','id'],['Edition','edition'],['Saved revision','revision'],['Recorded','createdAt']]));
  if(p.instrument){
   box.append(node('h4','Instrument and applicability'),recordFacts(p.instrument,[['Title','title'],['Version','version'],['Origin','origin'],['Scope','scope'],['Study designs','applicableDesigns']]));
   sourceLinks(p.instrument.sourceUrls,box);
   if(p.instrument.rights)box.append(details('Instrument source and rights statement',p.instrument.rights));
  }
  if(p.form){
   box.append(node('h4','Review form'),recordFacts(p.form,[['Title','title'],['Version','version'],['Origin','origin']]));
   sourceLinks(p.form.sourceUrls,box);
   for(const domain of arr(p.form.domains)){const section=node('section',undefined,'rob-domain');section.append(node('h4',domain.title),node('p',domain.description||'','rob-domain-instructions'));const list=node('ul');for(const f of arr(domain.fields))list.append(node('li',f.label+(f.required?' · required':'')+(f.requiresEvidence?' · evidence required':'')));section.append(list);box.append(section);}
   if(p.form.rights)box.append(details('Review form source and rights statement',p.form.rights));
  }
  box.append(node('h4','Independent reviewers and resolution'));
  const reviewers=node('ul');for(const reviewer of arr(p.reviewers))reviewers.append(node('li',reviewer.name+' · '+reviewer.id+(arr(p.resolverIds).includes(reviewer.id)?' · resolver':'')));
  box.append(reviewers,node('p','Required independent reviewers: '+p.minimumReviewers),node('p',p.disagreementProcedure||''));
  box.append(actions(button('Create assessment with this protocol',()=>beginAssessment(protocol),{disabled:!state.reviewId||!!pending()}),
   button('Revise protocol',async()=>{await begin('revise-protocol',{protocol:clone(p),reason:''},{protocol});},{disabled:!state.reviewId||!!pending()})),
   details('Complete immutable protocol edition',protocol));
  return box;
 }
 function assessmentCard(assessment,protocol,{compact=false}={}){
  const box=node('article',undefined,'rob-card'),target=assessment.target||{};
  box.append(node('h3',assessment.name||'Assessment'),node('p','Assessment edition '+assessment.version,'rob-muted'),
   recordFacts(assessment,[['Assessment','id'],['Edition','editionId'],['Protocol','protocolId'],['Saved revision','revision']]),
   recordFacts(target,[['Study','studyId'],['Study version','studyVersion'],['Study SHA-256','studySha256'],['Scope','scope'],['Result','resultId'],['Result version','resultVersion'],['Result SHA-256','resultSha256'],['Design','design']]));
  if(target.designRationale)box.append(node('p',target.designRationale));
  const links=actions();for(const id of arr(target.occurrenceIds))links.append(button('Inspect '+sourceLabel(id),()=>openSource(id)));if(links.childElementCount)box.append(node('h4','Selected original reports'),links);
  if(target.designBasis?.length)box.append(details('Retained design evidence',target.designBasis));
  box.append(actions(button('Open my reviewer draft',()=>beginReviewerDraft(assessment),{primary:true,disabled:!state.actorId||!!pending()}),
   button('Submitted reviews',()=>choose({assessmentId:assessment.id,assessmentEditionId:assessment.editionId,section:'submissions'})),
   button('Compare submitted reviews',()=>openComparison(assessment)),
   button('Revise assessment edition',async()=>{await prepareCatalog();await beginAssessment(protocol,assessment);},{disabled:!protocol||!!pending()})));
  if(!state.actorId)box.append(node('p','Choose a named reviewer in the toolbar to open that reviewer’s independent draft.','rob-muted'));
  if(!compact)box.append(details('Complete assessment target and source bindings',assessment));
  return box;
 }
 async function openComparison(assessment){
  if(state.draft)await persistDraft();state.draft=null;
  const generation=++state.loadGeneration;state.sourceGeneration++;state.focus=null;state.focusContext=null;state.section='comparisons';
  const context=await comparisonContext(assessment);
  if(generation!==state.loadGeneration)return;
  state.assessmentId=context.view.assessment.id;state.assessmentEditionId=context.view.assessment.editionId;state.view=context.view;
  state.focus={assessmentId:state.assessmentId,assessmentEditionId:state.assessmentEditionId,assessmentName:context.view.assessment.name,...clone(context.comparison)};
  state.focusContext=context;state.offset=0;state.filter='';rememberSelection();render();
 }
 async function openRecord(record){
  const row=clone(record),section=state.section;
  if(section==='overview'){
   await choose({reviewId:row.id,assessmentId:null,assessmentEditionId:null,section:'overview'});
   state.focus=clone(state.view?.review||row);state.focusContext={kind:'review'};render();return;
  }
  if(state.draft)await persistDraft();state.draft=null;
  const generation=++state.loadGeneration;state.sourceGeneration++;state.focus=null;state.focusContext=null;
  if(controls.sources){controls.sources.replaceChildren();controls.sources.hidden=true;}
  if(section==='protocols'){
   state.focus=row;state.focusContext={protocol:row};render();return;
  }
  const assessment=section==='assessments'?{id:row.id,editionId:row.editionId}:
   row.assessmentId?{id:row.assessmentId,editionId:row.assessmentEditionId}:null;
  if(section==='comparisons'&&assessment){await openComparison(assessment);return;}
  let view=state.view;
  if(assessment){
   need(assessment.editionId,'APPRAISAL_EDITION_REQUIRED','Open the exact saved assessment edition from the register.');
   view=await selectedView(section,assessment);
   if(generation!==state.loadGeneration)return;
   state.assessmentId=assessment.id;state.assessmentEditionId=assessment.editionId;state.view=view;state.offset=0;
  }
  state.focus=row;state.focusContext=view?{protocol:view.protocol,assessment:view.assessment}:null;
  rememberSelection();render();
 }
 function reviewOverview(review){
  const box=node('article',undefined,'rob-card');
  box.append(node('h3',review?.name||'Appraisal workflow'));
  if(review){
   if(review.description)box.append(node('p',review.description));
   box.append(recordFacts(review,[['Review','id'],['Research question','questionId'],['Eligibility review','eligibilityReviewId'],['Created','createdAt']]));
  }
  const steps=node('ol');
  for(const instruction of [
   'Record the instrument, version, applicability, source rights and the complete review form.',
   'Select the retained study or exact result, then bind its design and original reports in an assessment edition.',
   'Each named reviewer saves an independent draft and submits that exact draft.',
   'Compare the submitted answers, judgments and rationales. The assigned resolver records an explicit adjudication.',
   'Review later source, result and protocol changes; retain the earlier assessment and reviewer history.'
  ])steps.append(node('li',instruction));
  box.append(steps,actions(button('Open protocols',()=>choose({section:'protocols'}),{disabled:!state.reviewId}),
   button('Open assessments',()=>choose({section:'assessments'}),{disabled:!state.reviewId}),
   button('Review source changes',()=>choose({section:'impact'}),{disabled:!state.reviewId})));
  if(review)box.append(details('Complete saved appraisal review',review));
  return box;
 }
 function renderDetail(){
  const box=controls.detail;if(!box)return;box.replaceChildren();
  const row=state.focus,v=state.view,protocol=selectedProtocol(),assessment=state.focusContext?.assessment||state.focusContext?.view?.assessment||v?.assessment;
  if(!v){box.append(node('p',state.loading?'Opening the original appraisal view…':'Open a saved dossier to review its appraisals.','rob-empty'));return;}
  if(state.section==='overview'){box.append(reviewOverview(v.review||row));return;}
  if(row&&state.section==='protocols'){box.append(factsProtocol(row));return;}
  if(state.section==='comparisons'){
   const context=state.focusContext?.comparison?state.focusContext:null;
   if(context){
    const article=node('article',undefined,'rob-card'),c=context.comparison,p=context.view.protocol;
    article.append(node('h3',context.view.assessment.name||'Independent review comparison'),recordFacts(context.view.assessment,[['Assessment','id'],['Edition','editionId'],['Protocol','protocolId']]),
     comparisonTable(c,context.submissions,p));
    const actor=arr(protocolDefinition(p).reviewers).find(x=>x.id===state.actorId),
     resolver=!!actor&&arr(protocolDefinition(p).resolverIds).includes(actor.id),enough=context.submissions.length>=protocolDefinition(p).minimumReviewers;
    article.append(actions(button('Record adjudication',()=>beginAdjudication(context.view.assessment),{primary:true,disabled:!resolver||!enough||!!pending()}),
     button('Open assessment',()=>choose({assessmentId:context.view.assessment.id,assessmentEditionId:context.view.assessment.editionId,section:'assessments'}))));
    if(!resolver)article.append(node('p','Choose a resolver assigned in this protocol to record a resolution.','rob-muted'));
    if(!enough)article.append(node('p','The saved protocol requires '+protocolDefinition(p).minimumReviewers+' independent submissions before adjudication.','rob-muted'));
    if(c.adjudication){
     article.append(node('h4','Recorded adjudication'),tag(c.adjudicationCurrent?'Current submitted basis':'Earlier submitted basis'),reviewSummary(c.adjudication,p),details('Complete immutable adjudication',c.adjudication));
    }
    box.append(article);return;
   }
   if(assessment){box.append(assessmentCard(assessment,protocol,{compact:true}));return;}
  }
  if(row&&['drafts','submissions'].includes(state.section)){
   const article=node('article',undefined,'rob-card');
   article.append(node('h3',(state.section==='drafts'?'Reviewer draft':'Submitted independent review')+' · '+(row.actor?.name||row.actor?.id||'')),
    tag(row.current?'Current for this reviewer':'Retained earlier version'),
    recordFacts(row,[['Record','id'],['Assessment','assessmentId'],['Edition','assessmentEditionId'],['Saved revision','revision'],['Recorded','createdAt'],['Replaces','supersedes']]),
    reviewSummary(row,protocol));
   if(state.section==='drafts'){
    article.append(actions(button('Submit this exact saved draft',()=>beginSubmission(row),{primary:true,disabled:!row.current||row.actor?.id!==state.actorId||!!pending()}),
     button('Continue my current draft',()=>beginReviewerDraft({id:row.assessmentId,editionId:row.assessmentEditionId}),{disabled:row.actor?.id!==state.actorId||!!pending()})));
   }else article.append(actions(button('Compare current submitted reviews',()=>openComparison({id:row.assessmentId,editionId:row.assessmentEditionId})),
    button('Open my current draft',()=>beginReviewerDraft({id:row.assessmentId,editionId:row.assessmentEditionId}),{disabled:!state.actorId||!!pending()})));
   article.append(details('Complete immutable review record',row));box.append(article);return;
  }
  if(row&&state.section==='impact'){
   const article=node('article',undefined,'rob-card');article.append(node('h3',row.title||readable(row.kind)),tag(readable(row.status||row.lastReview?.disposition||'Needs review')),
    recordFacts(row,[['Impact','id'],['Kind','kind'],['Assessment','assessmentId'],['Assessment edition','assessmentEditionId'],['Fingerprint','fingerprint']]),
    details('Previous bound basis',row.before),details('Current observed basis',row.after));
   if(row.lastReview)article.append(details('Last recorded disposition',row.lastReview));
   article.append(button('Review this exact change',()=>begin('review-impact',{impactId:row.id,fingerprint:row.fingerprint,disposition:'',reason:''},{impact:row,protocol}),{primary:true,disabled:!!pending()}));
   if(row.assessmentId&&row.assessmentEditionId)article.append(button('Open affected assessment',()=>choose({assessmentId:row.assessmentId,assessmentEditionId:row.assessmentEditionId,section:'assessments'})));
   article.append(details('Complete native source-change projection',row));box.append(article);return;
  }
  if(row&&state.section==='operations'){
   const article=node('article',undefined,'rob-card');article.append(node('h3',readable(row.action)),recordFacts(row,[['Request','requestId'],['Operation','id'],['Review','reviewId'],['Revision','revision'],['Original revision','originalRevision'],['Recorded','createdAt']]),
    details('Complete immutable operation and authored input',row));box.append(article);return;
  }
  if(assessment){box.append(assessmentCard(assessment,protocol));return;}
  if(protocol&&state.section==='protocols'){box.append(factsProtocol(protocol));return;}
  if(row){const article=node('article',undefined,'rob-card');article.append(node('h3',titleOf(row)),details('Complete saved record',row));box.append(article);return;}
  box.append(node('p','Choose a record from the register to inspect its exact saved edition.','rob-empty'));
 }
 function rowTitle(row){
  if(state.section==='protocols')return protocolDefinition(row)?.name||titleOf(row);
  if(state.section==='comparisons')return row.assessmentName||row.assessmentId||'Assessment comparison';
  if(['drafts','submissions'].includes(state.section))return (row.actor?.name||row.actor?.id||'Reviewer')+' · '+(row.assessmentName||row.assessmentId||'Assessment');
  if(state.section==='operations')return readable(row.action)||'Saved operation';
  return titleOf(row);
 }
 function renderRows(){
  const v=state.view,rows=arr(v?.items),search=state.filter.trim().toLocaleLowerCase(),visible=search?rows.filter(r=>{
   const parts=[rowTitle(r),rowId(r),r.assessmentId,r.reviewId,r.actor?.name,r.actor?.id,r.status,r.kind,r.action];
   return parts.some(x=>text(x).toLocaleLowerCase().includes(search));
  }):rows;
  controls.records.replaceChildren();
  if(!visible.length)controls.records.append(node('p',state.loading?'Opening saved records…':search?'No records on this loaded page match the filter.':'There are no saved records in this selection.','rob-empty'));
  for(const row of visible){
   const article=node('article',undefined,'rob-record');article.dataset.selected=String(!!state.focus&&rowId(state.focus)===rowId(row));
   const open=button(rowTitle(row),()=>openRecord(row));open.classList.add('rob-record-title');article.append(open,node('code',rowId(row)||row.assessmentId||row.requestId||'','rob-id'));
   if(row.description||row.title&&row.title!==rowTitle(row))article.append(node('p',row.description||row.title));
   const footer=node('div',undefined,'rob-record-footer');
   if(row.version!==undefined)footer.append(tag('Edition '+row.version));else if(row.edition!==undefined)footer.append(tag('Edition '+row.edition));
   if(row.current!==undefined)footer.append(tag(row.current?'Current':'Earlier'));
   if(row.status)footer.append(tag(readable(row.status)));if(row.action)footer.append(tag(readable(row.action)));
   if(row.revision!==undefined)footer.append(node('span','Revision '+row.revision));if(row.createdAt)footer.append(node('span',date(row.createdAt)));
   article.append(footer);controls.records.append(article);
  }
  controls.pagination.replaceChildren();
  if(v){
   const total=Number.isSafeInteger(v.total)?v.total:rows.length,offset=v.offset??state.offset,limit=v.limit||PAGE,
    count=rows.length?'Records '+(offset+1)+'–'+(offset+rows.length)+' of '+total:'0 records';
   controls['section-count'].textContent=count+(search?' · '+visible.length+' visible on this page':'')+' · revision '+v.revision;
   controls.pagination.append(button('Previous page',()=>load({offset:Math.max(0,offset-limit)}),{disabled:offset===0}),
    node('span',count),button('Next page',()=>load({offset:v.nextOffset}),{disabled:v.nextOffset===null||v.nextOffset===undefined}));
  }else controls['section-count'].textContent='';
 }
 async function importBrowserDraft(file){
  need(file&&file.size<=MAX_BYTES,'APPRAISAL_DRAFT_SIZE','Choose a complete browser draft of at most 16 MiB.');
  const captured=captureContext();let draft;try{draft=JSON.parse(await file.text());}catch{throw fail('JSON_INVALID','The browser draft is not valid JSON.');}requireContext(captured);
  need(draft?.schema==='sf88-research-appraisal-browser-draft/v1'&&typeof draft.id==='string'&&draft.workspaceId===captured.workspaceId&&draft.dossierId===captured.dossierId&&ACTIONS.includes(draft.action)&&Number.isSafeInteger(draft.baseRevision)&&draft.actor&&typeof draft.actor.id==='string'&&typeof draft.actor.name==='string'&&draft.data&&draft.context,'APPRAISAL_DRAFT_INVALID','Open the complete original browser draft in its original workspace and dossier.');
  const protocol=['create-review','revise-protocol'].includes(draft.action)?draft.data.protocol:draft.context.protocol?.definition;
  if(protocol)need(protocol.instrument?.rights&&protocol.form?.rights&&Array.isArray(protocol.instrument.applicableDesigns)&&Array.isArray(protocol.form.domains)&&protocol.form.domains.every(d=>Array.isArray(d.fields)&&d.fields.every(f=>Array.isArray(f.choices)))&&Array.isArray(protocol.form.judgments)&&Array.isArray(protocol.reviewers)&&Array.isArray(protocol.resolverIds),'APPRAISAL_DRAFT_INVALID','The retained protocol/form structure is incomplete.');
  if(['create-review','revise-protocol','create-assessment','revise-assessment','save-draft','submit-review','adjudicate'].includes(draft.action))need(protocol,'APPRAISAL_DRAFT_INVALID','The original protocol definition is required.');
  if(['create-assessment','revise-assessment'].includes(draft.action))need(draft.data.target&&Array.isArray(draft.data.target.occurrenceIds)&&Array.isArray(draft.data.target.designBasis),'APPRAISAL_DRAFT_INVALID','The original target/source selection is incomplete.');
  if(['save-draft','adjudicate'].includes(draft.action))need(Array.isArray(draft.data.answers)&&Array.isArray(draft.data.judgments)&&draft.context.assessment?.target&&Array.isArray(draft.context.assessment.target.occurrenceIds),'APPRAISAL_DRAFT_INVALID','The original reviewer draft is incomplete.');
  if(draft.action==='adjudicate')need(draft.context.comparison&&Array.isArray(draft.context.submissions),'APPRAISAL_DRAFT_INVALID','The original submitted comparison is incomplete.');
  if(draft.action==='submit-review')need(draft.context.submittedDraft,'APPRAISAL_DRAFT_INVALID','The submitted original draft is missing.');
  if(draft.action==='review-impact')need(draft.context.impact,'APPRAISAL_DRAFT_INVALID','The original impact is missing.');
  await browserRecords();need(!pending(),'APPRAISAL_REQUEST_PENDING','Recover the original outstanding request before reopening another draft.');
  await reopenDraft(draft);await browserRecords();renderRecovery();message('Browser draft opened with its original reviewer, revision and source selections.');
 }
 function renderRecovery(){
  const rootBox=controls.recovery;if(!rootBox||!state.dossier)return;rootBox.replaceChildren();
  const box=node('details'),outstanding=state.requests.filter(x=>['READY','SENDING','UNCERTAIN'].includes(x.state));
  box.open=outstanding.length>0||!!state.storageError;box.append(node('summary','Browser drafts and original requests · '+state.savedDrafts.length+' drafts · '+outstanding.length+' awaiting an outcome'));
  if(state.storageError)box.append(node('p','Browser storage: '+state.storageError,'rob-notice'));
  const importControl=node('input');importControl.type='file';importControl.accept='.json,application/json';importControl.dataset.robEdit='1';
  importControl.addEventListener('change',()=>{const file=importControl.files?.[0];if(file)run(()=>importRequest(file));});
  box.append(field('Open an original request file',importControl,'This preserves the original ID, reviewer, expected revision and exact body. Inspect it, then submit that same request.'));
  const draftControl=node('input');draftControl.type='file';draftControl.accept='.json,application/json';draftControl.dataset.robEdit='1';draftControl.addEventListener('change',()=>{const file=draftControl.files?.[0];if(file)run(()=>importBrowserDraft(file));});
  box.append(field('Open a downloaded browser draft',draftControl,'Review its original selections and explicitly rebase if the saved dossier advanced.'));
  const unsavedHere=Array.from(unsaved.values()).filter(x=>x.workspaceId===state.workspace?.workspaceId&&x.dossierId===state.dossier.id);
  if(unsavedHere.length){
   box.append(node('h4','Open edits awaiting browser storage'));
   for(const draft of unsavedHere)box.append(button('Download open '+readable(draft.action),async()=>download(JSON.stringify(draft,null,2)+'\n','appraisal-unsaved-'+draft.id+'.json')));
  }
  if(state.savedDrafts.length)box.append(node('h4','Retained browser drafts'));
  for(const draft of state.savedDrafts){
   const row=node('article',undefined,'rob-browser-row');row.append(node('h4',readable(draft.action)),node('span','Revision '+draft.baseRevision+' · '+(draft.actor?.name||'Reviewer not yet chosen')+' · '+date(draft.updatedAt)),
    actions(button('Reopen draft',()=>reopenDraft(draft),{disabled:!!pending()}),
     button('Download draft',async()=>download(JSON.stringify(draft,null,2)+'\n','appraisal-draft-'+draft.id+'.json')),
     button('Remove saved browser draft',async()=>{
      need(state.draft?.id!==draft.id,'APPRAISAL_DRAFT_OPEN','Close this editor before removing its saved draft.');
      const removed=await(await cache()).removeDraft(draft.id,draft);
      need(removed,'APPRAISAL_DRAFT_CHANGED','This saved draft changed in another window. Open the current browser records before removing it.');
      await browserRecords();renderRecovery();
     })),details('Complete retained browser draft',draft));
   box.append(row);
  }
  if(state.requests.length)box.append(node('h4','Original save requests'));
  for(const entry of state.requests){
   const row=node('article',undefined,'rob-browser-row');row.append(node('h4',readable(entry.payload.action)),tag(readable(entry.state)),node('code',entry.id,'rob-id'),
    node('span','Expected revision '+entry.payload.expectedRevision+' · '+(entry.payload.actor?.name||entry.payload.actor?.id)+' · '+date(entry.createdAt)));
   if(entry.error)row.append(node('p',entry.error.message,'rob-notice'));
   row.append(actions(button('Download original request',async()=>download(JSON.stringify({schema:entry.schema,workspaceId:entry.workspaceId,instanceId:entry.instanceId,dossierId:entry.dossierId,payload:entry.payload},null,2)+'\n','appraisal-request-'+entry.id+'.json')),
    ['READY','SENDING','UNCERTAIN'].includes(entry.state)?button(entry.state==='READY'?'Submit original request':'Recover original request',()=>sendOriginal(entry),{primary:true}):null),
    details('Exact original request input',entry.payload));
   if(entry.reply)row.append(details('Original saved operation receipt',entry.reply));
   if(entry.state==='REJECTED'&&entry.draft)row.append(button('Reopen rejected draft',()=>reopenDraft(entry.draft),{disabled:!!pending()}));
   box.append(row);
  }
  rootBox.append(box);updateBusy();
 }
 async function exportReport(format){
  need(state.dossier&&['json','csv','md','html'].includes(format),'APPRAISAL_EXPORT_REQUIRED','Choose an appraisal report format.');
  const captured=captureContext(),dossierId=state.dossier.id,revision=state.revision||state.dossier.revision,p=new URLSearchParams({revision:String(revision),format});
  for(const [key,value] of Object.entries({reviewId:state.reviewId,assessmentId:state.assessmentId,assessmentEditionId:state.assessmentEditionId,actorId:state.actorId}))if(value)p.set(key,value);
  const response=await api(base(dossierId)+'/risk-of-bias/export?'+p,{download:true});
  need(response?.ok&&typeof response.arrayBuffer==='function','APPRAISAL_EXPORT_RESPONSE','The original export did not return a downloadable report.');
  const body=await response.arrayBuffer();requireContext(captured);const contentType=response.headers.get('content-type')||'application/octet-stream',
   declared=response.headers.get('content-length');
  if(declared&&!response.headers.get('content-encoding'))need(Number(declared)===body.byteLength,'APPRAISAL_EXPORT_INCOMPLETE','The exported report ended before its declared byte length.');
  const disposition=response.headers.get('content-disposition')||'',encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition),quoted=/filename="([^"]+)"/i.exec(disposition);
  let filename=quoted?.[1]||'research-appraisal-'+dossierId+'-r'+revision+'.'+format;
  if(encoded)try{filename=decodeURIComponent(encoded[1]);}catch{}
  filename=filename.replace(/[\\/\u0000-\u001f\u007f]/g,'_');need(filename&&filename!=='.'&&filename!=='..','APPRAISAL_EXPORT_FILENAME','The original export filename is invalid.');
  download(body,filename,contentType);message('Downloaded '+filename+' from dossier revision '+revision+'.');
 }
 function render(){
  if(!state.mounted||state.closed)return;
  if(state.message)message(state.message.value,state.message.kind);else message(null);
  controls.context.replaceChildren();controls['primary-actions'].replaceChildren();controls.toolbar.replaceChildren();controls.navigation.replaceChildren();controls.summary.replaceChildren();
  controls.loading.hidden=!state.loading;controls['section-title'].textContent=SECTIONS.find(([key])=>key===state.section)?.[1]||'Saved records';
  if(!state.dossier){
   controls.context.append(node('p','Open a Research dossier to use its retained studies, results and appraisal history.','rob-muted'));
   for(const name of ['records','pagination','detail','editor','filters','list-actions','recovery'])controls[name].replaceChildren();return;
  }
  controls.context.append(node('strong',state.dossier.name||state.dossier.id),node('span','Workspace '+state.workspace.workspaceId),node('span','Dossier '+state.dossier.id),node('span','Saved revision '+(state.revision||state.dossier.revision),'rob-revision'));
  if(state.assessmentId)controls.context.append(node('span','Assessment '+state.assessmentId),node('span','Edition '+state.assessmentEditionId));
  controls['primary-actions'].append(button('Refresh saved dossier',fresh),button('Start appraisal review',beginNewReview,{primary:true,disabled:!!pending()}));
  const protocol=selectedProtocol(),definition=protocolDefinition(protocol),reviewers=arr(definition?.reviewers);
  if(state.actorId&&protocol&&!reviewers.some(r=>r.id===state.actorId))state.actorId='';
  controls.toolbar.append(field('Appraisal review',select([['','All appraisal reviews'],...state.catalog.reviews.map(r=>[r.id,r.name||r.id])],state.reviewId,
   value=>run(()=>choose({reviewId:value||null,assessmentId:null,assessmentEditionId:null,section:'overview'})))));
  const actorControl=select([['','Choose named reviewer'],...reviewers.map(r=>[r.id,r.name+' · '+r.id+(arr(definition?.resolverIds).includes(r.id)?' · resolver':'')])],state.actorId,
   value=>run(async()=>{const captured=captureContext();if(state.draft)await persistDraft();requireContext(captured);state.draft=null;state.actorId=value;state.focus=null;state.focusContext=null;await load({offset:0});}),{disabled:!reviewers.length});
  controls.toolbar.append(field('Reviewer identity',actorControl,'Independent drafts and submissions stay with this exact assigned reviewer.'));
  if(state.assessmentId)controls.toolbar.append(button('All assessment editions',()=>choose({assessmentId:null,assessmentEditionId:null,section:'assessments'})));
  for(const [key,label] of SECTIONS){const b=button(label,()=>choose({section:key}),{disabled:key!=='overview'&&!state.reviewId});if(key===state.section)b.setAttribute('aria-current','page');controls.navigation.append(b);}
  const overview=state.view?.overview||{};
  for(const [key,value] of Object.entries(overview))if(typeof value==='number'&&Number.isFinite(value)&&value>=0){
   const card=node('div',undefined,'rob-stat');card.append(node('strong',value.toLocaleString()),node('span',readable(key).replace(/([a-z])([A-Z])/g,'$1 $2')));controls.summary.append(card);
  }
  controls['list-actions'].replaceChildren();
  if(state.section==='protocols'&&protocol)controls['list-actions'].append(button('Create assessment',()=>beginAssessment(protocol),{disabled:!!pending()}));
  if(state.section==='assessments'&&protocol)controls['list-actions'].append(button('New assessment',()=>beginAssessment(protocol),{disabled:!!pending()}));
  const exportChoice=select([['','Export report…'],['json','JSON'],['csv','CSV'],['md','Markdown'],['html','HTML']],'',format=>{if(format)run(()=>exportReport(format));});
  controls['list-actions'].append(exportChoice);
  controls.filters.replaceChildren();
  const filter=input(state.filter,value=>{state.filter=value;renderRows();},{type:'search',max:500,placeholder:'Name, identifier, reviewer or status'});
  controls.filters.append(field('Filter this loaded page',filter,'Pagination keeps the selected saved revision.'));
  renderRows();renderDetail();renderEditor();renderRecovery();updateBusy();
 }
 return {
  setDossier(value){
   if(state.closed)return;
   const workspace=value?hostWorkspace():null,prior=state.dossier,workspaceChanged=!same(state.workspace,workspace),changed=workspaceChanged||prior?.id!==value?.id,revisionChanged=prior?.revision!==value?.revision;
   if(changed){
    if(state.draft)persistDraft();
    state.loadGeneration++;state.sourceGeneration++;state.view=null;state.focus=null;state.focusContext=null;state.draft=null;
    state.savedDrafts=[];state.requests=[];state.catalog={revision:null,reviews:[],protocols:[],studies:[],results:[],sources:[]};
    state.actorId='';state.filter='';state.offset=0;state.revision=null;state.loading=false;state.message=null;state.lastReply=null;
    if(prior||workspaceChanged&&state.workspace||initial.get('dossier')!==value?.id){state.reviewId=null;state.assessmentId=null;state.assessmentEditionId=null;state.section='overview';}
    if(controls.sources){controls.sources.replaceChildren();controls.sources.hidden=true;}
   }
   state.workspace=workspace;state.dossier=value||null;
   if((workspaceChanged||revisionChanged)&&value){state.revision=value.revision;state.offset=0;state.catalog.revision=null;state.focus=null;state.focusContext=null;}
   if(changed||revisionChanged){render();if(state.visible&&value&&!state.accepting)load({offset:0});}
  },
  show(visible){
   if(state.closed)return;const opening=!!visible&&!state.visible;state.visible=!!visible;
   if(tab){tab.hidden=!state.dossier;tab.setAttribute('aria-selected',String(state.visible));}
   if(!opening)return;
   ensureMounted().then(async()=>{render();if(state.dossier)await load({offset:state.offset});}).catch(report);
  },
  updateBusy,
  hasUnsaved(){return unsaved.size>0||!!state.storageError&&!!state.draft||state.requests.some(r=>['READY','SENDING','UNCERTAIN'].includes(r.state));},
  close(){
   if(state.closed)return;state.closed=true;state.visible=false;state.loadGeneration++;state.sourceGeneration++;
   if(state.draft)persistDraft();state.writeQueue.catch(()=>{}).finally(()=>state.cache?.close());
  }
 };
}
