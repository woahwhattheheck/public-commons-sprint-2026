// MIT. Original merchant settlement receiving in the existing SF47 Operations case.
import {currentStaffContext,staffDeskStorageKey} from './staff-session.mjs';
const MAX_SOURCE = 8 * 1024 * 1024;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const human = value => String(value ?? '').toLowerCase().replaceAll('_',' ').replace(/^./, c => c.toUpperCase());
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const button = (label, action, extra='') => '<button type="button" data-settlement-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const field = (label, control, help='', wide=false) => '<label'+(wide?' class="settlement-wide"':'')+'>'+esc(label)+control+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const textInput = (name, value='', type='text', maximum=4000) => '<input name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'" maxlength="'+maximum+'">';
const textArea = (name, value='', maximum=12000, rows=3) => '<textarea name="'+esc(name)+'" rows="'+rows+'" maxlength="'+maximum+'">'+esc(value)+'</textarea>';
const issueText = item => typeof item === 'string' ? human(item) : item?.message || item?.reason || item?.code || JSON.stringify(item);
const facts = entries => '<dl class="settlement-facts">'+entries.map(([name,value])=>'<div><dt>'+esc(name)+'</dt><dd>'+esc(value ?? 'Unrecorded')+'</dd></div>').join('')+'</dl>';
function picker(name, entries, value='', multiple=false) {
  const selected = new Set(multiple ? (value || []).map(String) : [String(value ?? '')]);
  const options = entries.map(entry => Array.isArray(entry) ? entry : [entry,human(entry)]);
  for (const old of selected) if(old && !options.some(([id])=>String(id)===old)) options.push([old,'Retained selection unavailable: '+old]);
  return '<select name="'+esc(name)+'"'+(multiple?' multiple size="3"':'')+'>'+options.map(([id,label])=>
    '<option value="'+esc(id)+'"'+(selected.has(String(id))?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
}
function base64(buffer) {
  let value=''; const bytes=new Uint8Array(buffer);
  for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(value);
}
async function digest(buffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function download(raw,name,type='application/json') {
  const bytes=raw instanceof Blob ? raw : new Blob([typeof raw==='string'||raw instanceof ArrayBuffer||ArrayBuffer.isView(raw)?raw:JSON.stringify(raw,null,2)+'\n'],{type});
  const url=URL.createObjectURL(bytes),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function compactRequest(request) {
  if(!request)return null;const result=clone(request);if(result.data)delete result.data.contentBase64;return result;
}
function exactQuantity(atomic, decimals) {
  if(typeof atomic!=='string'||!/^(0|[1-9][0-9]*)$/.test(atomic)||!Number.isInteger(decimals)||decimals<0||decimals>12)return null;
  const digits=atomic.padStart(decimals+1,'0');
  if(!decimals)return digits;
  const fraction=digits.slice(-decimals).replace(/0+$/,'');
  return digits.slice(0,-decimals)+(fraction?'.'+fraction:'');
}

const DESK_SCHEMA = 'sf47.settlement-desk.v2';
const DESK_LIMIT = 64 * 1024 * 1024;
const SETTLEMENT_DATABASE='sf47-merchant-settlement-desks',settlementDatabases=new Map();
function deskDatabase(name=SETTLEMENT_DATABASE) {
  if(!settlementDatabases.has(name)){
    const opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        db.createObjectStore('desks',{keyPath:'id'});
        const index=db.createObjectStore('desk-index',{keyPath:'id'});
        index.createIndex('caseId','caseId',{unique:false});
        db.createObjectStore('archives',{keyPath:'id'});
      };
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();settlementDatabases.delete(name);};resolve(db);};
      request.onerror=()=>reject(request.error||new Error('Browser draft storage is unavailable.'));
      request.onblocked=()=>reject(new Error('Close the older settlement storage view, then reopen this desk.'));
    }).catch(error=>{settlementDatabases.delete(name);throw error;});
    settlementDatabases.set(name,opening);
  }
  return settlementDatabases.get(name);
}
async function readDeskValue(store,key,indexName=null,name=SETTLEMENT_DATABASE) {
  const db=await deskDatabase(name);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readonly'),table=tx.objectStore(store);
    const request=indexName?table.index(indexName).getAll(key):table.get(key);
    let value;
    request.onsuccess=()=>{value=request.result;};
    tx.oncomplete=()=>resolve(value);
    tx.onabort=()=>reject(tx.error||request.error||new Error('The saved settlement desk could not be opened.'));
    tx.onerror=()=>{};
  });
}
async function writeDeskValue(desk,archive,name=SETTLEMENT_DATABASE) {
  const db=await deskDatabase(name);
  return new Promise((resolve,reject)=>{
    const stores=archive?['desks','desk-index','archives']:['desks','desk-index'];
    const tx=db.transaction(stores,'readwrite');
    tx.objectStore('desks').put(desk);
    tx.objectStore('desk-index').put({id:desk.id,caseId:desk.caseId,deskId:desk.deskId,savedAt:desk.savedAt,
      name:desk.draft?.name||desk.fileMeta?.filename||'Settlement correction',
      source:desk.fileMeta?.filename||'',requestId:desk.pending?.requestId||null});
    if(archive)tx.objectStore('archives').put(archive);
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(tx.error||new Error('The complete settlement draft could not be retained.'));
    tx.onerror=()=>{};
  });
}
const readableTime = value => {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value??''):date.toLocaleString();
};
function validDeskShape(desk,caseId) {
  if(!plain(desk)||desk.schema!==DESK_SCHEMA||desk.caseId!==caseId)throw new Error('Choose a complete settlement desk for this original case.');
  if(desk.draft!==null&&desk.draft!==undefined) {
    const draft=desk.draft;
    if(!plain(draft)||typeof draft.name!=='string'||typeof draft.note!=='string'||!Array.isArray(draft.selections)||draft.selections.length>5000)
      throw new Error('Retain the complete original receiving draft and its selected rows.');
    for(const row of draft.selections) {
      if(!plain(row)||typeof row.rowId!=='string'||typeof row.decision!=='string'||typeof row.reason!=='string'
        ||!Array.isArray(row.deploymentIds)||!Array.isArray(row.workIds)||!plain(row.cash)
        ||!Array.isArray(row.cash.unitSourceIds)||!Array.isArray(row.cash.valuationSourceIds)||!Array.isArray(row.cash.allocations))
        throw new Error('Retain each complete receiving row, source selection and cash editor.');
    }
  }
  if(desk.correction!==null&&desk.correction!==undefined) {
    const correction=desk.correction;
    if(!plain(correction)||typeof correction.reviewId!=='string'||typeof correction.rowId!=='string'
      ||typeof correction.decision!=='string'||typeof correction.reason!=='string'
      ||!Array.isArray(correction.deploymentIds)||!Array.isArray(correction.workIds)||!plain(correction.cash)
      ||!Array.isArray(correction.cash.unitSourceIds)||!Array.isArray(correction.cash.valuationSourceIds)||!Array.isArray(correction.cash.allocations))
      throw new Error('Retain the complete original correction editor.');
  }
  if(desk.fileMeta!==null&&desk.fileMeta!==undefined) {
    if(!plain(desk.fileMeta)||typeof desk.fileMeta.filename!=='string'||!desk.fileMeta.filename
      ||!Number.isInteger(desk.fileMeta.bytes)||desk.fileMeta.bytes<1||desk.fileMeta.bytes>MAX_SOURCE
      ||typeof desk.fileMeta.sha256!=='string'||!/^[a-f0-9]{64}$/.test(desk.fileMeta.sha256))
      throw new Error('Retain the original archive name, byte count and content identity.');
  }
  if(desk.pending!==null&&desk.pending!==undefined) {
    const pending=desk.pending;
    if(!plain(pending)||!['settlement.receive','settlement.correct'].includes(pending.action)
      ||typeof pending.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(pending.requestId)
      ||typeof pending.actor!=='string'||!pending.actor.trim()||typeof pending.note!=='string'
      ||!Number.isInteger(pending.expectedVersion)||pending.expectedVersion<1||!plain(pending.data))
      throw new Error('Retain the exact original pending settlement request.');
    if(pending.action==='settlement.receive'&&(!desk.fileMeta||typeof pending.data.filename!=='string'))
      throw new Error('The original receiving request needs its matching archive identity.');
  }
  if(desk.selectedReviewId!==null&&desk.selectedReviewId!==undefined&&typeof desk.selectedReviewId!=='string')
    throw new Error('Retain the original selected review identity.');
  return desk;
}
async function validateDeskArchive(desk,archive) {
  const pendingContent=desk.pending?.action==='settlement.receive'?desk.pending.data?.contentBase64:null;
  if(!archive&&typeof pendingContent==='string')archive={contentBase64:pendingContent};
  if(!archive)return null;
  if(typeof pendingContent==='string'&&pendingContent!==archive.contentBase64)
    throw new Error('Retain the exact original archive encoding used by the pending request.');
  if(!desk.fileMeta||!plain(archive)||typeof archive.contentBase64!=='string'
    ||archive.contentBase64.length>Math.ceil(MAX_SOURCE/3)*4||archive.contentBase64.length%4!==0
    ||!/^[A-Za-z0-9+/]*={0,2}$/.test(archive.contentBase64))
    throw new Error('The complete desk archive must retain its original base64 bytes.');
  let raw;
  try {raw=atob(archive.contentBase64);}catch{throw new Error('The retained archive encoding is invalid.');}
  const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  if(bytes.byteLength!==desk.fileMeta.bytes||await digest(bytes)!==desk.fileMeta.sha256)
    throw new Error('The retained archive differs from the original desk source.');
  return {id:desk.caseId+':'+desk.fileMeta.sha256,caseId:desk.caseId,sha256:desk.fileMeta.sha256,
    bytes:desk.fileMeta.bytes,contentBase64:archive.contentBase64};
}

const definite = error => [400,409,413,415,422].includes(error.status)&&typeof error.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(error.code);
const blankCash = (kind='PAYMENT') => ({category:kind==='REFUND'?'REFUND':'CUSTOMER',date:'',currency:'',decimals:'',unitSourceIds:[],unitNote:'',usdValue:null,valuationSourceIds:[],valuationNote:'',tranche:null,allocations:[]});
const nativeCashLabel = row => [row.date,row.currency,row.amount,row.externalRef||row.id].filter(v=>v!==undefined&&v!==null&&v!=='').join(' · ');
const cashUnits = cash => Object.fromEntries(['currency','decimals','unitSourceIds','unitNote'].map(key=>[key,clone(cash[key])]));
const decisionLabels = {UNSELECTED:'Keep in original source',RECORD_CASH:'Record received cash',LINK_CASH:'Link existing cash',OBSERVE:'Receive observation',OMIT:'Exclude with reason',
  CORRECT_CASH:'Void and replace cash',VOID_CASH:'Void cash',RELINK:'Update work and deployment links'};

export function mountSettlementReceiving({container,current,api,saveApi=api,mutationId,recordingActor,onSaved,onReload,session={},staffContext=currentStaffContext()}) {
  const root=document.createElement('section');root.className='settlement-desk';root.setAttribute('aria-label','Merchant settlements');container.replaceChildren(root);
  const base='/api/operations/'+current.program.id,legacyStorageKey='sf47.settlement-receiving.'+current.program.id;
  const deskContext=staffContext?clone(staffContext):null,databaseName=staffDeskStorageKey(SETTLEMENT_DATABASE,deskContext),boundStaff=databaseName!==SETTLEMENT_DATABASE;
  const storageKey=staffDeskStorageKey(legacyStorageKey,deskContext);
  const readOwned=(store,key,indexName=null)=>readDeskValue(store,key,indexName,databaseName);
  const writeOwned=(desk,archive)=>writeDeskValue(desk,archive,databaseName);
  let legacyDesks=null,legacyLocal=null,legacyCopy=null,legacyMessage='';
  function pendingActorProblem(body) {
    if(!boundStaff||deskContext.role==='owner'||!body)return null;
    if(typeof body.actor==='string'&&body.actor.trim()===deskContext.actor)return null;
    const original=typeof body.actor==='string'&&body.actor.trim()?body.actor.trim():'an unrecorded operator';
    return Object.assign(new Error('This original request belongs to '+original+'. Sign in as that operator to resume it. The complete original copy remains available to download.'),{code:'STAFF_REQUEST_ACTOR_CHANGED',status:403});
  }

  const $=selector=>root.querySelector(selector),available=()=>active&&root.isConnected;
  let active=true,busy=false,hostBusy=false;
  function activeCheck(){if(!available())throw new Error('Reopen this original case to continue settlement receiving.');}
  const editable=()=>current.program.state==='OPEN'&&!session.pending&&!session.accepted&&!session.sending;
  session.deskId??=crypto.randomUUID();
  session.savedDrafts??=[];
  const deskIdentity=()=>current.program.id+':'+session.deskId;
  function snapshot() {
    return {schema:DESK_SCHEMA,id:deskIdentity(),deskId:session.deskId,caseId:current.program.id,savedAt:new Date().toISOString(),
      draft:clone(session.draft??null),correction:clone(session.correction??null),fileMeta:clone(session.fileMeta??null),
      pending:compactRequest(session.pending),selectedReviewId:session.selectedReviewId??null,
      archiveId:session.fileMeta?current.program.id+':'+session.fileMeta.sha256:null};
  }
  function archiveFor(desk) {
    const content=session.pending?.action==='settlement.receive'?session.pending.data.contentBase64:session.selected?.contentBase64;
    return desk.fileMeta&&typeof content==='string'?{id:desk.archiveId,caseId:desk.caseId,
      sha256:desk.fileMeta.sha256,bytes:desk.fileMeta.bytes,contentBase64:content}:null;
  }
  function persist() {
    if(!session.loaded) {
      if(!session.draft&&!session.correction&&!session.pending&&!session.fileMeta&&!session.selectedReviewId)return Promise.resolve();
      session.loaded=true;session.initialization=null;
    }
    const saved=snapshot(),archive=archiveFor(saved);
    const pending=(session.persistence??Promise.resolve()).catch(()=>{}).then(async()=>{
      await writeOwned(saved,archive&&session.storedArchiveId!==archive.id?archive:null);
      if(archive)session.storedArchiveId=archive.id;
      try {sessionStorage.setItem(storageKey+'.active-desk',saved.id);session.pointerWarning=null;}
      catch {
        session.pointerWarning='The complete desk is saved. Use Saved editing desks to reopen this copy if this window cannot retain its selection.';
        tell(session.pointerWarning,true);
      }
      const summary={id:saved.id,caseId:saved.caseId,deskId:saved.deskId,savedAt:saved.savedAt,
        name:saved.draft?.name||saved.fileMeta?.filename||'Settlement correction',
        source:saved.fileMeta?.filename||'',requestId:saved.pending?.requestId||null};
      session.savedDrafts=[summary,...session.savedDrafts.filter(item=>item.id!==saved.id)];
      session.storageError=null;
    });
    session.persistence=pending;
    return pending;
  }
  async function listDesks() {
    session.savedDrafts=(await readOwned('desk-index',current.program.id,'caseId')||[])
      .filter(item=>item.caseId===current.program.id).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
    return session.savedDrafts;
  }
  async function loadDesk(saved,sourceDatabase=databaseName) {
    validDeskShape(saved,current.program.id);
    const stored=saved.archiveId?await readDeskValue('archives',saved.archiveId,null,sourceDatabase):null;
    return {saved,archive:await validateDeskArchive(saved,stored)};
  }
  function applyDesk(saved,archive) {
    for(const key of ['draft','correction','fileMeta','pending','selectedReviewId'])session[key]=clone(saved[key]??null);
    session.selected=archive?{filename:session.pending?.data?.filename||session.fileMeta.filename,contentBase64:archive.contentBase64}:null;
    if(archive&&session.pending?.action==='settlement.receive')session.pending.data.contentBase64=archive.contentBase64;
    session.storedArchiveId=archive?.id??null;
    session.sourceReview=null;session.savedReview=null;session.preview=null;session.correctionPreview=null;
    session.previewInput=null;session.correctionPreviewInput=null;session.accepted=null;session.rejected=null;
    session.message=session.pending?'The original request and draft are retained. Recover the same request to continue.':
      archive?'The complete original source and editing draft are reopened. Review the current case before saving.':
      session.fileMeta?'Reselect the exact original archive to reopen this retained draft.':'The saved correction draft is reopened.';
    session.error=false;
  }
  async function initializeDesk() {
    if(session.loaded){await listDesks();return;}
    if(!session.initialization) {
      session.initialization=(async()=>{
        const items=(await readOwned('desk-index',current.program.id,'caseId')||[])
          .filter(item=>item.caseId===current.program.id).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
        let pointer;
        try {pointer=sessionStorage.getItem(storageKey+'.active-desk');}catch{}
        const selected=items.find(item=>item.id===pointer)||items[0];
        if(selected) {
          const saved=await readOwned('desks',selected.id);
          return {items,complete:await loadDesk(saved)};
        }
        let legacy;
        if(!boundStaff)try{legacy=JSON.parse(localStorage.getItem(legacyStorageKey)||'null');}catch{}
        if(legacy?.schema==='sf47.settlement-draft.v1'&&legacy.caseId===current.program.id) {
          const saved={...legacy,schema:DESK_SCHEMA,archiveId:null};
          validDeskShape(saved,current.program.id);
          return {items,complete:{saved,archive:null}};
        }
        return {items,complete:null};
      })();
    }
    const work=session.initialization;
    let result;
    try {result=await work;}
    catch(error){if(session.initialization===work)session.initialization=null;throw error;}
    if(!available()||session.initialization!==work||session.loaded)return;
    session.savedDrafts=result.items;
    if(result.complete)applyDesk(result.complete.saved,result.complete.archive);
    session.loaded=true;session.initialization=null;
  }
  async function listLegacyDesks() {
    const items=[],problems=[];let local=null;
    try {
      const retained=await readDeskValue('desk-index',current.program.id,'caseId');
      for(const item of retained||[])if(item.caseId===current.program.id)items.push({...item,kind:'database'});
    }catch(error){problems.push(error.message||'Earlier saved desks could not be read.');}
    try {
      const value=JSON.parse(localStorage.getItem(legacyStorageKey)||'null');
      if(value?.schema==='sf47.settlement-draft.v1'&&value.caseId===current.program.id) {
        local=validDeskShape({...value,schema:DESK_SCHEMA,archiveId:null},current.program.id);
        items.push({id:'earlier-local-copy',kind:'local',name:local.draft?.name||local.fileMeta?.filename||'Earlier settlement draft',
          savedAt:local.savedAt||'',requestId:local.pending?.requestId||null});
      }
    }catch(error){problems.push(error.message||'The earlier local copy could not be read.');}
    activeCheck();legacyDesks=items.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
    legacyLocal=local;legacyCopy=null;legacyMessage=problems.join(' ');render();
  }
  async function inspectLegacyDesk(id,kind) {
    const item=legacyDesks?.find(row=>row.id===id&&row.kind===kind);
    if(!item)throw new Error('Select one of the earlier browser copies.');
    const saved=kind==='local'?clone(legacyLocal):await readDeskValue('desks',id);
    const complete=kind==='local'?{saved,archive:await validateDeskArchive(saved,null)}:await loadDesk(saved,SETTLEMENT_DATABASE);
    activeCheck();legacyCopy=complete;render();
  }
  async function openLegacyDesk() {
    if(!legacyCopy)throw new Error('Review an earlier browser copy first.');
    if(session.pending||session.sending||session.accepted)throw new Error('Recover the current original request before opening another draft.');
    const problem=pendingActorProblem(legacyCopy.saved.pending);if(problem)throw problem;
    const complete=legacyCopy;readDraft();await persist();activeCheck();
    session.deskId=crypto.randomUUID();applyDesk(complete.saved,complete.archive);
    session.storedArchiveId=null;session.loaded=true;session.initialization=null;legacyCopy=null;render();
    await persist();activeCheck();await loadReviews();
    if(session.selected&&!session.pending)await openSource();else render();
  }
  function downloadLegacyDesk() {
    if(!legacyCopy)throw new Error('Review an earlier browser copy first.');
    download({...legacyCopy.saved,originalArchive:legacyCopy.archive?{contentBase64:legacyCopy.archive.contentBase64}:null},
      current.program.id+'-earlier-settlement-desk.json');
  }
  function legacyView() {
    if(legacyDesks===null)return '';
    const saved=legacyCopy?.saved,problem=pendingActorProblem(saved?.pending);
    return '<section class="settlement-section"><h4>Earlier browser copies</h4>'+
      '<p>Review an earlier copy before opening it in this sign-in. The current desk and each original earlier copy remain separately retained.</p>'+
      (legacyMessage?'<p>'+esc(legacyMessage)+'</p>':'')+
      (legacyDesks.length?'<ul>'+legacyDesks.map(item=>'<li>'+esc(item.name)+' · '+esc(item.savedAt?readableTime(item.savedAt):'Earlier local draft')+
        (item.requestId?' · original request '+esc(item.requestId):'')+' '+button('Review earlier copy','legacy-inspect','data-desk="'+esc(item.id)+'" data-kind="'+esc(item.kind)+'"')+'</li>').join('')+'</ul>':'<p>No earlier settlement copies are saved for this case.</p>')+
      (saved?'<div class="settlement-section"><h5>Selected earlier copy</h5>'+
        facts([['Original case',saved.caseId],['Original source',saved.fileMeta?.filename||'Correction draft'],['Original request',saved.pending?.requestId||'No pending request'],['Original operator',saved.pending?.actor||'No pending request'],
          ['Archive',legacyCopy.archive?'Complete original bytes retained':saved.fileMeta?'Original archive can be reopened from this case or reselected':'No archive selected']])+
        (problem?'<p>'+esc(problem.message)+'</p>':'')+'<div class="settlement-actions">'+button('Open selected earlier copy','legacy-open',problem?'disabled data-settlement-fixed="true"':'')+
        button('Download earlier copy','legacy-download')+'</div></div>':'')+
      button('Close earlier copies','legacy-close')+'</section>';
  }
  async function retainDeskCopy() {
    readDraft();await persist();activeCheck();
    session.deskId=crypto.randomUUID();
  }
  async function openDesk(id) {
    if(session.pending||session.sending||session.accepted)throw new Error('Recover the original retained request before opening another draft.');
    readDraft();await persist();
    const saved=await readOwned('desks',id),complete=await loadDesk(saved);activeCheck();
    const problem=pendingActorProblem(complete.saved.pending);if(problem)throw problem;
    session.deskId=crypto.randomUUID();applyDesk(complete.saved,complete.archive);render();
    await persist();activeCheck();await loadReviews();
    if(session.selected&&!session.pending)await openSource();else render();
  }
  async function downloadDesk() {
    readDraft();
    const saved=snapshot();
    let archive=archiveFor(saved);
    if(!archive&&saved.archiveId)archive=await readOwned('archives',saved.archiveId).catch(()=>null);
    if(!archive&&saved.fileMeta) {
      const original=current.sources.find(row=>row.sha256===saved.fileMeta.sha256&&row.bytes===saved.fileMeta.bytes);
      if(original)archive={contentBase64:base64(await originalBytes(original))};
    }
    activeCheck();
    download({...saved,originalArchive:archive?{contentBase64:archive.contentBase64}:null},
      current.program.id+'-settlement-desk.json');
  }
  async function importDesk(file) {
    if(session.pending||session.sending||session.accepted)throw new Error('Recover the original retained request before importing another draft.');
    if(file.size>DESK_LIMIT)throw new Error('Choose a complete settlement desk JSON up to 64 MiB.');
    const saved=validDeskShape(JSON.parse(await file.text()),current.program.id);
    const archive=await validateDeskArchive(saved,saved.originalArchive);activeCheck();
    const problem=pendingActorProblem(saved.pending);if(problem)throw problem;
    readDraft();await persist();activeCheck();
    session.deskId=crypto.randomUUID();applyDesk(saved,archive);
    session.storedArchiveId=null;render();await persist();activeCheck();await loadReviews();
    if(session.selected&&!session.pending)await openSource();else render();
  }
  function tell(message,error=false) {
    session.message=message;session.error=error;
    if(available()){const el=$('[data-settlement-message]');if(el){el.textContent=message;el.setAttribute('role',error?'alert':'status');}}
  }
  function persistDraft() {
    void persist().catch(error=>{
      session.storageError=error.message||'Browser storage is unavailable.';
      tell('This complete draft remains open. Download the complete desk to retain it, then reopen browser storage to continue saving.',true);
    });
  }
  const value=(form,name)=>String(form.elements.namedItem(name)?.value??'');
  const selected=(form,name)=>[...(form.elements.namedItem(name)?.selectedOptions??[])].map(option=>option.value);
  function readCash(form,prefix) {
    const prior=prefix==='correction.'?session.correction?.cash:
      session.draft?.selections?.[Number(prefix.split('.')[1])]?.cash;
    const count=prior?.allocations?.length??0;
    const allocations=Array.from({length:count},(_,i)=>({invoiceId:value(form,prefix+'allocation.'+i+'.invoiceId'),amountUsd:value(form,prefix+'allocation.'+i+'.amountUsd')}));
    return {category:value(form,prefix+'category')||prior?.category,date:value(form,prefix+'date'),currency:value(form,prefix+'currency'),
      decimals:value(form,prefix+'decimals')===''?'':Number(value(form,prefix+'decimals')),
      unitSourceIds:selected(form,prefix+'unitSourceIds'),unitNote:value(form,prefix+'unitNote'),
      usdValue:value(form,prefix+'usdValue').trim()||null,valuationSourceIds:selected(form,prefix+'valuationSourceIds'),
      valuationNote:value(form,prefix+'valuationNote'),tranche:value(form,prefix+'tranche')===''?null:Number(value(form,prefix+'tranche')),allocations};
  }
  function readDraft(invalidate=false) {
    const form=$('[data-settlement-form]');
    if(form&&session.sourceReview) {
      session.draft={name:value(form,'name'),note:value(form,'note'),selections:session.sourceReview.rows.map((row,index)=>{
        const prefix='selection.'+index+'.';
        return {rowId:row.rowId,decision:value(form,prefix+'decision')||'UNSELECTED',reason:value(form,prefix+'reason'),
          cashId:value(form,prefix+'cashId')||null,cash:readCash(form,prefix),
          deploymentIds:selected(form,prefix+'deploymentIds'),workIds:selected(form,prefix+'workIds')};
      })};
      if(invalidate)session.preview=null;
    }
    const correction=$('[data-settlement-correction]');
    if(correction&&session.correction) {
      session.correction={...session.correction,decision:value(correction,'correction.decision'),
        reason:value(correction,'correction.reason'),cashId:value(correction,'correction.cashId')||null,cash:readCash(correction,'correction.'),
        deploymentIds:selected(correction,'correction.deploymentIds'),workIds:selected(correction,'correction.workIds'),note:value(correction,'correction.note')};
      if(invalidate)session.correctionPreview=null;
    }
    persistDraft();
  }
  function selectionInput() {
    const rows=(session.draft?.selections??[]).filter(row=>row.decision!=='UNSELECTED').map(row=>{
      const out={rowId:row.rowId,decision:row.decision,reason:row.reason,deploymentIds:row.deploymentIds,workIds:row.workIds};
      if(row.decision==='LINK_CASH') {
        out.cashId=row.cashId;
        out.cash=cashUnits(row.cash);
      }
      if(row.decision==='RECORD_CASH')out.cash=clone(row.cash);
      return out;
    });
    if(!rows.length&&session.sourceReview?.rows.length)throw new Error('Choose at least one original settlement row to receive.');
    return {name:session.draft.name.trim(),selections:rows};
  }
  function correctionInput() {
    const draft=session.correction;
    if(!draft)throw new Error('Choose a saved original row to correct.');
    const out={reviewId:draft.reviewId,rowId:draft.rowId,expectedCashId:draft.expectedCashId,
      decision:draft.decision,reason:draft.reason,deploymentIds:draft.deploymentIds,workIds:draft.workIds};
    if(draft.decision==='CORRECT_CASH')out.cash=clone(draft.cash);
    if(draft.decision==='LINK_CASH'){out.cashId=draft.cashId;out.cash=cashUnits(draft.cash);}
    return out;
  }
  const selectedDraft=index=>index==='correction'?session.correction:session.draft?.selections?.[Number(index)];
  const selectedCash=index=>index==='correction'?current.records.cash:(session.sourceReview?.cash??current.records.cash);
  function sameInput(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function sync() {
    if(!available())return;
    const pending=Boolean(session.pending||session.accepted||session.sending);
    root.setAttribute('aria-busy',String(busy||hostBusy||Boolean(session.sending)));
    for(const el of root.querySelectorAll('button,input,select,textarea')) {
      const draft=el.closest('[data-settlement-draft]'),action=el.dataset.settlementAction;
      el.disabled=busy||hostBusy||Boolean(session.sending)||el.dataset.settlementFixed==='true'||Boolean(draft&&pending);
      if(el.closest('[data-settlement-cash-fields]')) {
        const index=el.closest('[data-settlement-cash-fields]').dataset.settlementCashFields;
        const choice=index==='correction'?session.correction?.decision:session.draft?.selections?.[Number(index)]?.decision;
        el.disabled=el.disabled||!['RECORD_CASH','CORRECT_CASH','LINK_CASH'].includes(choice);
        if(choice==='LINK_CASH')el.disabled=el.disabled||!/\.(currency|decimals|unitSourceIds|unitNote)$/.test(el.name??'');
      }
      if(el.closest('[data-settlement-link-fields]'))el.disabled=el.disabled||selectedDraft(el.closest('[data-settlement-link-fields]').dataset.settlementLinkFields)?.decision!=='LINK_CASH';
      if(el.matches('[data-settlement-save]'))el.disabled=el.disabled||!editable()||!session.preview?.proposed?.canApply;
      if(el.matches('[data-settlement-correction-save]'))el.disabled=el.disabled||!editable()||!session.correctionPreview?.proposed?.canApply;
      if(['preview','open-source','open-review','correct-row','preview-correction','allocation-add','allocation-remove','open-desk','legacy-open'].includes(action))el.disabled=el.disabled||pending;
      if(action==='recover')el.disabled=el.disabled||!!pendingActorProblem(session.pending);
      if(el.matches('[data-settlement-desk-file]'))el.disabled=el.disabled||pending;
      if(el.matches('[data-settlement-file]'))el.disabled=el.disabled||Boolean(session.pending&&session.pending.action!=='settlement.receive')||Boolean(session.accepted);
    }
    for(const panel of root.querySelectorAll('[data-settlement-cash-fields]')) {
      const index=panel.dataset.settlementCashFields,choice=index==='correction'?session.correction?.decision:session.draft?.selections?.[Number(index)]?.decision;
      panel.hidden=!['RECORD_CASH','CORRECT_CASH','LINK_CASH'].includes(choice);
      for(const label of panel.querySelectorAll('label'))label.hidden=choice==='LINK_CASH'&&!/\.(currency|decimals|unitSourceIds|unitNote)$/.test(label.querySelector('[name]')?.name??'');
      const allocations=panel.querySelector('[data-settlement-allocations]');if(allocations)allocations.hidden=choice==='LINK_CASH';
      const draft=index==='correction'?session.correction:session.draft?.selections?.[Number(index)];
      const row=index==='correction'?session.savedReview?.rows.find(item=>item.rowId===draft?.rowId):session.sourceReview?.rows?.[Number(index)];
      const quantity=exactQuantity(row?.transfer?.amountAtomic,draft?.cash?.decimals);
      const output=panel.querySelector('[data-settlement-quantity]');
      if(output)output.textContent=quantity===null?'Choose the original asset precision to inspect the quantity.':
        'Original '+row.transfer.amountAtomic+' atomic units = '+quantity+' '+(draft?.cash?.currency||'native units')+'. The native review validates this exact quantity.';
    }
    for(const panel of root.querySelectorAll('[data-settlement-link-fields]'))panel.hidden=selectedDraft(panel.dataset.settlementLinkFields)?.decision!=='LINK_CASH';
    for(const proposal of root.querySelectorAll('[data-settlement-proposal]'))proposal.hidden=proposal.dataset.settlementProposal==='correction'?!session.correctionPreview:!session.preview;
    for(const node of root.querySelectorAll('[data-settlement-linked-cash]')) {
      const index=node.dataset.settlementLinkedCash,draft=selectedDraft(index);
      const original=selectedCash(index).find(item=>item.id===draft?.cashId);
      node.textContent=original?'Existing cash: '+nativeCashLabel(original)+'; USD value '+(original.usdValue??'unvalued')+'. Its date, valuation and allocations are retained.':'Choose the existing original cash record.';
    }
    const count=$('[data-settlement-selected]');
    if(count)count.textContent=(session.draft?.selections??[]).filter(row=>row.decision!=='UNSELECTED').length+' of '+(session.sourceReview?.rows.length??0)+' original rows selected';
  }
  const setHostBusy=value=>{hostBusy=Boolean(value);sync();};
  async function run(fn) {
    if(busy||hostBusy||!available())return;
    busy=true;sync();try{await fn();}catch(error){if(available())tell(error.message||String(error),true);}finally{busy=false;if(available())sync();}
  }
  const sourceChoices=()=>current.sources.map(row=>[row.id,row.filename+' · '+human(row.kind)]);
  function attribution(prefix,entry) {
    return field('Deployment links',picker(prefix+'deploymentIds',(session.sourceReview?.deployments??current.records.deployments).map(row=>[row.id,row.name+' · '+row.operator]),entry.deploymentIds??[],true),'Choose the deployments this original payment or observation supports.')+
      field('Recorded work links',picker(prefix+'workIds',(session.sourceReview?.work??current.records.work).map(row=>[row.id,row.description||row.name||row.id]),entry.workIds??[],true),'Keep the original recorded work and its acceptance history.');
  }
  function cashEditor(prefix,cash,index) {
    const original=index==='correction'?session.savedReview?.rows.find(item=>item.rowId===session.correction?.rowId):session.sourceReview?.rows?.[Number(index)];
    const kind=original?.kind??'PAYMENT',row=cash??blankCash(kind),invoices=(current.records.invoices??[]).filter(item=>item.state!=='VOID');
    const allocations=(row.allocations??[]).map((allocation,i)=>'<div class="settlement-fields">'+
      field('Invoice',picker(prefix+'allocation.'+i+'.invoiceId',[['','Choose invoice'],...invoices.map(v=>[v.id,v.number+' · USD '+v.totalUsd])],allocation.invoiceId))+
      field('Allocated USD',textInput(prefix+'allocation.'+i+'.amountUsd',allocation.amountUsd,'text',80))+
      button('Remove allocation','allocation-remove','data-row="'+index+'" data-allocation="'+i+'"')+'</div>').join('');
    return '<div class="settlement-fields" data-settlement-cash-fields="'+index+'">'+
      field('Cash observation date',textInput(prefix+'date',row.date,'date'),'Use the dated source for this cash observation.')+
      field('Cash category',picker(prefix+'category',kind==='REFUND'?['REFUND']:['CUSTOMER','INVOICE','OTHER'],row.category||(kind==='REFUND'?'REFUND':'CUSTOMER')))+
      field('Currency label',textInput(prefix+'currency',row.currency,'text',40),'The original asset and network remain fixed to this transfer.')+
      field('Asset decimals',picker(prefix+'decimals',[['','Choose original asset precision'],...Array.from({length:13},(_,n)=>[String(n),String(n)])],row.decimals),'The native review converts the exact atomic amount using this explicit precision.')+
      field('Tranche attribution',picker(prefix+'tranche',[['','Unassigned'],['0','Advance'],['1','Tranche 1'],['2','Tranche 2'],['3','Tranche 3']],row.tranche??''))+
      field('Unit sources',picker(prefix+'unitSourceIds',sourceChoices(),row.unitSourceIds??[],true))+
      field('Unit source explanation',textArea(prefix+'unitNote',row.unitNote,4000),'Identify the original source for the currency label and asset precision.')+
      field('USD value',textInput(prefix+'usdValue',row.usdValue??'','text',80),'Leave blank when no separate USD valuation is available. Exact decimal text is retained.')+
      field('Valuation sources',picker(prefix+'valuationSourceIds',sourceChoices(),row.valuationSourceIds??[],true))+
      field('Valuation explanation',textArea(prefix+'valuationNote',row.valuationNote,4000),'Identify the observation supporting the entered USD value.',true)+
      '<p class="settlement-note settlement-wide" data-settlement-quantity="'+index+'" aria-live="polite"></p>'+
      (kind==='REFUND'?'<div class="settlement-wide" data-settlement-allocations><details><summary>Invoice allocations ('+(row.allocations?.length??0)+')</summary>'+allocations+
      button('Add invoice allocation','allocation-add','data-row="'+index+'"')+'</details></div>':'<p class="settlement-note settlement-wide">Incoming merchant payments retain their customer cash attribution. Supplier invoice payments are allocated from original cash outflows.</p>')+'</div>';
  }
  function cashLinkEditor(prefix,entry,index) {
    const candidates=selectedCash(index).filter(item=>item.state==='OBSERVED');
    return '<div class="settlement-fields" data-settlement-link-fields="'+index+'">'+field('Existing cash record',
      picker(prefix+'cashId',[['','Choose existing cash'],...candidates.map(item=>[item.id,nativeCashLabel(item)])],entry.cashId??''),
      'The native review verifies the original transfer identity and exact amount before linking.')+'<p class="settlement-note settlement-wide" data-settlement-linked-cash="'+index+'"></p></div>';
  }
  function rowEditor(row,index) {
    const entry=session.draft.selections[index],prefix='selection.'+index+'.',transfer=row.transfer??{};
    const decisions=[['UNSELECTED',decisionLabels.UNSELECTED],['OBSERVE',decisionLabels.OBSERVE],['OMIT',decisionLabels.OMIT]];
    if(row.canRecordCash)decisions.splice(1,0,['RECORD_CASH',decisionLabels.RECORD_CASH],['LINK_CASH',decisionLabels.LINK_CASH]);
    return '<article class="settlement-transfer"><header><div><strong>'+esc(row.eventId||row.rowId)+'</strong><small>'+esc(human(row.kind))+'</small></div><span class="settlement-status">'+
      (row.canRecordCash?'Verified transfer':'Source observation')+'</span></header>'+
      facts([['Network / asset',[transfer.network,transfer.asset].filter(Boolean).join(' / ')],['Original atomic amount',transfer.amountAtomic],['Transaction',transfer.transaction],
        ['Recipient',transfer.recipient],['Payer',transfer.payer],['Original event time',row.sourceTime]])+
      '<div class="settlement-fields">'+field('Receive this row as',picker(prefix+'decision',decisions,entry.decision))+
      field('Receiving reason',textArea(prefix+'reason',entry.reason,4000,2),'Required for the selected decision.')+
      attribution(prefix,entry)+'</div>'+
      cashLinkEditor(prefix,entry,index)+
      cashEditor(prefix,entry.cash,index)+
      (row.issues?.length?'<ul class="settlement-findings">'+row.issues.map(item=>'<li>'+esc(issueText(item))+'</li>').join(''):'')+
      '<details><summary>Original transfer and source details</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details></article>';
  }
  function proposedView(preview,correction=false) {
    if(!preview?.proposed)return '';
    const proposed=preview.proposed;
    const effects=Array.isArray(proposed.effects)?proposed.effects:[proposed.effects].filter(Boolean);
    const findings=[...(proposed.findings??[]),...effects.flatMap(effect=>effect.findings??[])];
    const rows=effects.map(effect=>{
      const cash=effect.cash??{};
      return [effect.rowId,decisionLabels[effect.decision]??human(effect.decision),
        cash.amount??'',cash.currency??'',cash.usdValue??'Unvalued',
        effect.cashId??effect.existingCashId??effect.replacedCashId??effect.voidedCashId??''];
    });
    return '<section class="settlement-section" data-settlement-proposal="'+(correction?'correction':'receiving')+'"><h4>Reviewed '+(correction?'correction':'receiving changes')+'</h4>'+
      '<p>'+ (proposed.canApply?'The complete selection is ready to save.':'Review the reported findings before saving.')+'</p>'+
      (rows.length?'<div class="settlement-table-wrap"><table><thead><tr>'+['Original row','Change','Native amount','Currency','USD value','Existing cash'].map(v=>'<th scope="col">'+v+'</th>').join('')+'</tr></thead><tbody>'+
        rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'')+
      (findings.length?'<ul class="settlement-findings">'+findings.map(item=>'<li>'+esc(issueText(item))+'</li>').join(''):'')+
      '<p class="settlement-note">Reviewed case version '+esc(preview.version)+'. Changes to this draft require a new native review.</p>'+
      '<details><summary>Complete reviewed source and changes</summary><pre>'+esc(JSON.stringify(preview,null,2))+'</pre></details>'+
      '<div class="settlement-actions">'+button('Download reviewed changes','download-preview',correction?'data-correction="true"':'')+
      (preview.html?button('Download native report','download-preview-html',correction?'data-correction="true"':''):'')+'</div></section>';
  }
  function retainedView() {
    const items=session.list?.items??[];
    const listing=items.length?'<div class="settlement-table-wrap"><table><thead><tr>'+['Saved review','Recorded by','Case version',''].map(v=>'<th scope="col">'+v+'</th>').join('')+
      '</tr></thead><tbody>'+items.map(item=>'<tr><td>'+esc(item.name)+'<small>'+esc(item.createdAt)+'</small></td><td>'+esc(item.actor)+'</td><td>'+esc(item.version)+'</td><td>'+
      button('Open review','open-review','data-review="'+esc(item.id)+'"')+' '+button('Download complete review','export-review','data-review="'+esc(item.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>':
      '<p class="settlement-note">Saved settlement reviews and their original sources will appear here.</p>';
    const saved=session.savedReview;
    if(!saved)return '<section class="settlement-section"><h4>Saved settlement reviews</h4>'+listing+'</section>';
    const cash=new Map((saved.currentCash??[]).map(row=>[row.id,row])),review=saved.review;
    const rows=saved.rows.map((row,index)=>{const actual=cash.get(row.cashId);return '<tr><td>'+esc(row.eventId||row.rowId)+'</td><td>'+esc(decisionLabels[row.decision]??human(row.decision))+
      '</td><td>'+esc(actual?[actual.amount,actual.currency,actual.state].join(' · '):'No linked cash')+'</td><td>'+esc(row.reason??'')+'</td><td>'+
      (row.decision!=='UNSELECTED'?button('Correct row','correct-row','data-row="'+index+'"'):'')+'</td></tr>';}).join('');
    const history=(saved.history??[]).map(item=>'<li>'+esc([item.name,item.version===undefined?null:'v'+item.version,item.createdAt,item.actor].filter(v=>v!==null&&v!==undefined).join(' · '))+
      (item.id? ' '+button('Open edition','open-review','data-review="'+esc(item.id)+'"'):'')+'</li>').join('');
    return '<section class="settlement-section"><h4>Saved settlement reviews</h4>'+listing+'</section>'+
      '<section class="settlement-section"><h4>'+esc(review.name||'Selected settlement review')+'</h4><p>Saved by '+esc(review.actor??'')+' · '+esc(review.createdAt??'')+
      ' · case version '+esc(review.version??'')+'</p><div class="settlement-table-wrap"><table><thead><tr>'+
      ['Original row','Decision','Current cash','Reason',''].map(v=>'<th scope="col">'+v+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="settlement-actions">'+button('Download complete review','export-review','data-review="'+esc(review.id)+'"')+
      (saved.downloadSourceId?button('Download original archive','download-source','data-source="'+esc(saved.downloadSourceId)+'"'):'')+
      (saved.inspectionSourceId?button('Download original inspection','download-source','data-source="'+esc(saved.inspectionSourceId)+'"'):'')+
      button('Download complete case','export-case')+'</div>'+
      (history?'<details><summary>Original review and correction history</summary><ul>'+history+'</ul></details>':'')+
      '<details><summary>Full retained review and source</summary><pre>'+esc(JSON.stringify(saved,null,2))+'</pre></details></section>';
  }
  function correctionView() {
    const draft=session.correction,saved=session.savedReview;
    if(!draft||!saved||saved.review.id!==draft.reviewId)return '';
    const row=saved.rows.find(item=>item.rowId===draft.rowId);if(!row)return '';
    const actual=(saved.currentCash??[]).find(item=>item.id===draft.expectedCashId);
    const decisions=[['RELINK',decisionLabels.RELINK],...(row.canRecordCash?[['LINK_CASH',decisionLabels.LINK_CASH]]:[]),...(actual?.state==='OBSERVED'?
      [['CORRECT_CASH',decisionLabels.CORRECT_CASH],['VOID_CASH',decisionLabels.VOID_CASH]]:[])];
    return '<form data-settlement-correction><fieldset data-settlement-draft><legend>Correct the selected original row</legend>'+
      '<p><strong>'+esc(row.eventId||row.rowId)+'</strong> · '+esc(human(row.kind))+'</p>'+
      facts([['Original atomic amount',row.transfer?.amountAtomic],['Network / asset',[row.transfer?.network,row.transfer?.asset].filter(Boolean).join(' / ')],
        ['Current cash',actual?nativeCashLabel(actual)+' · '+actual.state:'No linked cash']])+
      '<div class="settlement-fields">'+field('Correction',picker('correction.decision',decisions,draft.decision))+
      field('Reason',textArea('correction.reason',draft.reason,4000),'Explain the selected cash link, corrected attribution or voided observation.')+
      attribution('correction.',draft)+
      field('History note',textArea('correction.note',draft.note??'',12000,2),'Leave blank to use the correction reason.',true)+'</div>'+
      cashLinkEditor('correction.',draft,'correction')+
      cashEditor('correction.',draft.cash,'correction')+
      '<div class="settlement-actions">'+button('Review correction','preview-correction')+
      '<button type="submit" class="settlement-primary" data-settlement-correction-save>Save reviewed correction</button>'+
      button('Close correction editor','close-correction')+'</div></fieldset>'+
      proposedView(session.correctionPreview,true)+'</form>';
  }
  function render() {
    if(!available())return;
    const review=session.sourceReview,source=review?.source,pending=session.pending;
    const rows=review?.rows??[],eligible=rows.filter(row=>row.canRecordCash).length;
    root.innerHTML='<header class="settlement-heading"><div><h3>Merchant settlements</h3><p>Receive an original merchant period or accounting archive. Review the transfer, its cash treatment and the work it supports, then save the complete attribution.</p></div>'+
      '<div class="settlement-actions">'+button('Download complete desk','download-desk')+button('Refresh case','reload')+'</div></header><p class="settlement-message" data-settlement-message role="'+(session.error?'alert':'status')+'" aria-live="polite">'+esc(session.message??'')+'</p>'+
      '<section class="settlement-section"><details><summary>Saved editing desks ('+session.savedDrafts.length+')</summary>'+
      '<p>Each open window retains its own complete draft. Opening a saved copy creates a separate desk with its original source and request.</p>'+
      '<div class="settlement-actions">'+button('Refresh saved desks','list-desks')+(boundStaff?button('Find earlier browser copies','legacy-list'):'')+'</div>'+
      (session.savedDrafts.length?'<ul>'+session.savedDrafts.map(item=>'<li>'+esc(item.name)+' · '+esc(readableTime(item.savedAt))+
        (item.requestId?' · original request retained':'')+' '+button('Open saved copy','open-desk','data-desk="'+esc(item.id)+'"')+'</li>').join('')+'</ul>':'')+
      field('Open complete desk JSON','<input type="file" accept=".json,application/json" data-settlement-desk-file>',
        'Use a complete desk exported from this original case. The current draft is retained separately.')+'</details></section>'+legacyView()+
      (pending?'<section class="settlement-pending"><h4>Original request retained</h4><p>'+esc(human(pending.action.replace('.',' ')))+
        ' was prepared at case version '+pending.expectedVersion+'.</p><p>'+esc(pendingActorProblem(pending)?.message||'Recover this same request to obtain its saved result or finish the original action.')+'</p><div class="settlement-actions">'+
        button('Recover original request','recover')+button('Download retained request','download-request')+'</div></section>':'')+
      '<section class="settlement-section"><h4>1 / Original accounting archive</h4>'+field(pending?.action==='settlement.receive'?'Reselect the exact original archive':'Choose the original period-close or accountant TAR',
        '<input type="file" accept=".tar,application/x-tar,application/octet-stream" data-settlement-file>','Use the complete archive exported by the existing merchant accounting workspace.')+
      (session.fileMeta?'<p>'+esc(session.fileMeta.filename)+' · '+session.fileMeta.bytes+' bytes</p>':'')+
      (session.selected&&!pending?button('Reopen original source review','open-source'):'')+
      (source?'<details><summary>Selected original source</summary><pre>'+esc(JSON.stringify({source,reader:review.reader,units:review.units},null,2))+'</pre></details>':'')+'</section>'+
      (review?'<section class="settlement-metrics" aria-label="Original settlement source"><div><strong>'+rows.length+'</strong><span>Original rows</span></div><div><strong>'+eligible+
        '</strong><span>Verified transfers</span></div><div><strong>'+(rows.length-eligible)+'</strong><span>Other source observations</span></div><div><strong>'+
        esc(review.retainedReviews?.length??0)+'</strong><span>Prior source reviews</span></div></section>'+
        '<form data-settlement-form><div class="settlement-draft" data-settlement-draft><fieldset><legend>2 / Review cash and delivery attribution</legend>'+
        '<div class="settlement-fields">'+field('Review name',textInput('name',session.draft.name,'text',300))+
        field('Receiving note',textArea('note',session.draft.note),'Record the purpose of this source and the reviewed treatment.')+'</div>'+
        '<p data-settlement-selected></p><div class="settlement-transfers">'+rows.map(rowEditor).join('')+'</div></fieldset>'+
        '<div class="settlement-actions">'+button('Review selected changes','preview')+
        '<button type="submit" class="settlement-primary" data-settlement-save>Save reviewed attribution</button></div></div>'+
        proposedView(session.preview)+'</form>':'')+
      retainedView()+correctionView()+
      (current.program.state!=='OPEN'?'<p class="settlement-note">Reopen the saved case before receiving or correcting another settlement.</p>':'');
    sync();
  }
  function seedRows(review) {
    const prior=new Map((session.draft?.selections??[]).map(row=>[row.rowId,row]));
    session.draft={name:session.draft?.name||review.source.filename,note:session.draft?.note||'',
      selections:review.rows.map(row=>prior.get(row.rowId)??{rowId:row.rowId,decision:'UNSELECTED',reason:'',cashId:null,cash:blankCash(row.kind),deploymentIds:[],workIds:[]})};
  }
  async function openSource() {
    if(session.pending||session.accepted||session.sending)throw new Error('Recover the original retained request first.');
    if(!session.selected)throw new Error('Select the original accounting archive.');
    const selected=session.selected;
    const review=await api(base+'/settlement/preview',{expectedVersion:current.program.version,...selected});
    activeCheck();if(session.selected!==selected)return;
    session.sourceReview=review;session.preview=null;seedRows(review);persistDraft();
    tell('The original source is open at case version '+review.version+'. Choose the rows and their cash and delivery treatment.');render();
  }
  async function originalBytes(source) {
    const response=await api(base+'/sources/'+source.id,undefined,{download:true});
    const bytes=await response.arrayBuffer();activeCheck();
    if(bytes.byteLength!==source.bytes||await digest(bytes)!==source.sha256)throw new Error('The downloaded source differs from its retained original identity.');
    return bytes;
  }
  async function selectArchive(filename,buffer) {
    if(!buffer.byteLength||buffer.byteLength>MAX_SOURCE)throw new Error('Select a complete original accounting archive up to 8 MiB.');
    const metadata={filename,bytes:buffer.byteLength,sha256:await digest(buffer)};activeCheck();
    if(session.pending) {
      if(session.pending.action!=='settlement.receive')throw new Error('Recover the retained correction first.');
      if(!session.fileMeta||metadata.sha256!==session.fileMeta.sha256||metadata.bytes!==session.fileMeta.bytes)
        throw new Error('Reselect the same original bytes used by the retained receiving request.');
      session.pending.data.contentBase64=base64(buffer);session.selected={filename:session.pending.data.filename,contentBase64:session.pending.data.contentBase64};
      await persist();tell('The original archive has been restored. Recover the retained request.');render();return;
    }
    if(session.fileMeta?.sha256!==metadata.sha256||session.fileMeta?.filename!==metadata.filename) {
      if(session.draft||session.correction)await retainDeskCopy();
      session.draft=null;session.correction=null;session.correctionPreview=null;
    }
    session.fileMeta=metadata;session.selected={filename,contentBase64:base64(buffer)};
    session.sourceReview=null;session.preview=null;await persist();await openSource();
  }
  async function previewSelection() {
    readDraft();if(!session.selected||!session.sourceReview)throw new Error('Open the original source archive first.');
    const inputs=selectionInput(),selected=session.selected;
    const result=await api(base+'/settlement/preview',{expectedVersion:current.program.version,...selected,...inputs});
    activeCheck();if(selected!==session.selected)return;
    session.preview=result;session.previewInput=clone(inputs);
    tell(result.proposed?.canApply?'The complete cash and delivery selection is reviewed and ready to save.':'Review the native findings for this selection.',!result.proposed?.canApply);render();
  }
  async function loadReviews() {
    const list=await api(base+'/settlements');activeCheck();session.list=list;
    const reviewId=session.selectedReviewId;
    if(reviewId) {
      const saved=await api(base+'/settlements/'+encodeURIComponent(reviewId));activeCheck();
      if(session.selectedReviewId===reviewId)session.savedReview=saved;
    }
  }
  async function openReview(id) {
    if(session.pending||session.sending)throw new Error('Recover the original request first.');
    readDraft();const saved=await api(base+'/settlements/'+encodeURIComponent(id));activeCheck();
    if(session.correction)await retainDeskCopy();
    session.savedReview=saved;session.selectedReviewId=id;session.correction=null;session.correctionPreview=null;persistDraft();render();
  }
  async function seedCorrection(index) {
    const saved=session.savedReview,row=saved?.rows?.[index];
    if(!row||row.decision==='UNSELECTED')throw new Error('Choose a received original row.');
    if(session.correction)await retainDeskCopy();
    const actual=(saved.currentCash??[]).find(item=>item.id===row.cashId),original=row.cash??{};
    const cash={...blankCash(row.kind),...(actual?{category:actual.category,date:actual.date,currency:actual.currency,usdValue:actual.usdValue,
      valuationSourceIds:actual.valuationSourceIds??[],valuationNote:actual.valuationNote??'',tranche:actual.tranche,
      allocations:clone(actual.allocations??[])}:{}),...clone(original)};
    session.correction={reviewId:saved.review.id,rowId:row.rowId,expectedCashId:row.cashId??null,cashId:actual?.state==='OBSERVED'?actual.id:null,decision:'RELINK',reason:'',note:'',
      cash,deploymentIds:clone(row.deploymentIds??[]),workIds:clone(row.workIds??[])};
    session.correctionPreview=null;persistDraft();render();$('[data-settlement-correction]')?.scrollIntoView({block:'start'});
  }
  async function previewCorrection() {
    readDraft();const inputs=correctionInput();
    const result=await api(base+'/settlement/correction-preview',{expectedVersion:current.program.version,...inputs});activeCheck();
    session.correctionPreview=result;session.correctionPreviewInput=clone(inputs);
    tell(result.proposed?.canApply?'The original correction is reviewed and ready to save.':'Review the native correction findings.',!result.proposed?.canApply);render();
  }
  async function retainAndSend(action,data,version,note) {
    const request={expectedVersion:version,actor:recordingActor(),note,action,data};
    request.requestId=await mutationId('operations:'+current.program.id,request);activeCheck();
    session.pending=clone(request);render();await persist();await sendPending();
  }
  async function sendPending() {
    if(!session.pending)throw new Error('No original request is retained.');
    const problem=pendingActorProblem(session.pending);if(problem)throw problem;
    if(session.pending.action==='settlement.receive'&&!session.pending.data.contentBase64) {
      const source=current.sources.find(row=>session.fileMeta&&row.sha256===session.fileMeta.sha256&&row.bytes===session.fileMeta.bytes);
      if(!source)throw new Error('Reselect the exact original archive to recover the receiving request.');
      session.pending.data.contentBase64=base64(await originalBytes(source));
    }
    await persist();
    if(!session.sending) {
      const request=clone(session.pending);
      session.sending=(async()=>{
        try {
          let result;
          try {result=await saveApi(base+'/command',request);}
          catch(error) {
            if(definite(error)) {
              session.pending=null;session.preview=null;session.correctionPreview=null;session.rejected={code:error.code,message:error.message};
              try{await persist();}catch{}
              session.message=error.message+' The original draft is retained. Refresh the case and review it again.';
            } else session.message=error.message||'The response is unavailable. Recover this same request.';
            session.error=true;throw error;
          }
          session.accepted=result;session.pending=null;session.rejected=null;session.preview=null;session.correctionPreview=null;session.correction=null;
          session.selectedReviewId=result.reviewId;
          if(request.action==='settlement.receive'){session.sourceReview=null;session.selected=null;session.fileMeta=null;session.draft=null;}
          session.message='Saved settlement '+(request.action==='settlement.correct'?'correction':'attribution')+' at case version '+result.version+'.';
          session.error=false;
          try{await persist();}catch{session.message+=' The original result is saved; the browser could not clear its local draft. Reopening that request returns the same result.';}
          return result;
        } finally {session.sending=null;session.notify?.();}
      })();
    }
    try {
      const result=await session.sending;
      if(available()){session.accepted=null;await onSaved(result);}
    } catch(error) {
      if(session.rejected&&available()){await onReload();return;}
      throw error;
    }
  }
  function allocationChange(target) {
    readDraft(true);
    const owner=target.dataset.row==='correction'?session.correction:session.draft?.selections?.[Number(target.dataset.row)];
    if(!owner)throw new Error('Reopen the original row before changing its allocation.');
    owner.cash??=blankCash();owner.cash.allocations??=[];
    if(target.dataset.settlementAction==='allocation-add')owner.cash.allocations.push({invoiceId:'',amountUsd:''});
    else {
      const index=Number(target.dataset.allocation);
      if(!Number.isInteger(index)||index<0||index>=owner.cash.allocations.length)throw new Error('Choose a retained allocation.');
      owner.cash.allocations.splice(index,1);
    }
    persistDraft();render();
  }
  root.addEventListener('input',event=>{
    if(event.target.closest('[data-settlement-form],[data-settlement-correction]')){readDraft(true);sync();}
  });
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-settlement-desk-file]')){const file=event.target.files?.[0];if(file)run(()=>importDesk(file));return;}
    if(event.target.matches('[data-settlement-file]')) {
      const file=event.target.files?.[0];if(file)run(async()=>{
        if(file.size>MAX_SOURCE)throw new Error('Select a complete original accounting archive up to 8 MiB.');
        await selectArchive(file.name,await file.arrayBuffer());
      });
      return;
    }
    if(event.target.closest('[data-settlement-form],[data-settlement-correction]')){readDraft(true);sync();}
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-settlement-action]');if(!target)return;
    const action=target.dataset.settlementAction;
    run(async()=>{
      if(action==='reload'){readDraft();await onReload();return;}
      if(action==='download-desk')return downloadDesk();
      if(action==='list-desks'){await listDesks();render();return;}
      if(action==='legacy-list')return listLegacyDesks();
      if(action==='legacy-inspect')return inspectLegacyDesk(target.dataset.desk,target.dataset.kind);
      if(action==='legacy-open')return openLegacyDesk();
      if(action==='legacy-download')return downloadLegacyDesk();
      if(action==='legacy-close'){legacyDesks=null;legacyLocal=null;legacyCopy=null;render();return;}
      if(action==='open-desk')return openDesk(target.dataset.desk);
      if(action==='open-source')return openSource();
      if(action==='preview')return previewSelection();
      if(action==='recover')return sendPending();
      if(action==='download-request'){if(session.pending)download({schema:'sf47.settlement-original-request.v1',caseId:current.program.id,source:session.fileMeta,request:compactRequest(session.pending)},session.pending.requestId+'.json');return;}
      if(action==='open-review')return openReview(target.dataset.review);
      if(action==='correct-row'){readDraft();await seedCorrection(Number(target.dataset.row));return;}
      if(action==='preview-correction')return previewCorrection();
      if(action==='close-correction'){await retainDeskCopy();session.correction=null;session.correctionPreview=null;persistDraft();render();return;}
      if(action==='allocation-add'||action==='allocation-remove'){allocationChange(target);return;}
      if(action==='download-preview'||action==='download-preview-html') {
        const preview=target.dataset.correction?session.correctionPreview:session.preview;
        if(!preview)throw new Error('Review the current draft first.');
        download(action==='download-preview-html'?preview.html:preview,action==='download-preview-html'?'settlement-review.html':'settlement-review.json',action==='download-preview-html'?'text/html':'application/json');return;
      }
      if(action==='download-source') {
        const source=current.sources.find(row=>row.id===target.dataset.source);
        if(!source)throw new Error('Refresh the case to open this original source.');
        download(await originalBytes(source),source.filename,source.mediaType);return;
      }
      if(action==='export-review') {
        const id=target.dataset.review,response=await api(base+'/settlements/'+encodeURIComponent(id)+'/export',undefined,{download:true});
        activeCheck();download(await response.arrayBuffer(),id+'-settlement.zip','application/zip');return;
      }
      if(action==='export-case') {
        const response=await api(base+'/export.zip',undefined,{download:true});activeCheck();
        download(await response.arrayBuffer(),current.program.id+'.zip','application/zip');return;
      }
    });
  });
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-settlement-form],[data-settlement-correction]'))return;
    event.preventDefault();if(!editable())return;
    const correction=event.target.matches('[data-settlement-correction]');
    readDraft();
    run(async()=>{
      if(correction) {
        const inputs=correctionInput(),preview=session.correctionPreview;
        if(!preview?.proposed?.canApply||!sameInput(inputs,session.correctionPreviewInput))throw new Error('Review this exact correction before saving.');
        const note=(session.correction.note||session.correction.reason).trim();if(!note)throw new Error('Record the correction reason.');
        await retainAndSend('settlement.correct',{...inputs,expectedPreviewSha256:preview.previewSha256},preview.version,note);
      } else {
        const inputs=selectionInput(),preview=session.preview;
        if(!preview?.proposed?.canApply||!session.selected||!sameInput(inputs,session.previewInput))throw new Error('Review these exact selected changes before saving.');
        const note=session.draft.note.trim();if(!note)throw new Error('Record the receiving note.');
        await retainAndSend('settlement.receive',{...session.selected,...inputs,expectedPreviewSha256:preview.previewSha256},preview.version,note);
      }
    });
  });
  function dispose(){if(session.loaded)readDraft();active=false;if(session.notify===render)session.notify=null;}
  session.notify=render;render();
  const ready=(async()=>{
    if(session.sending){try{await session.sending;}catch{}if(available()&&session.accepted){const value=session.accepted;session.accepted=null;await onSaved(value);}return;}
    if(session.accepted){const value=session.accepted;session.accepted=null;await onSaved(value);return;}
    busy=true;sync();
    try {
      try {await initializeDesk();}
      catch(error) {
        if(!available())return;
        session.storageError=error.message||'Browser storage is unavailable.';
        tell('Saved browser drafts could not be opened. The current draft and complete desk download remain available; saved case reviews are loading.',true);
      }
      activeCheck();render();await loadReviews();
      if(session.selected&&!session.pending&&(!session.sourceReview||session.sourceReview.version!==current.program.version))await openSource();
      else render();
    } catch(error){if(available())tell(error.message,true);}
    finally{busy=false;sync();}
  })();
  return {root,ready,dispose,setHostBusy};
}
