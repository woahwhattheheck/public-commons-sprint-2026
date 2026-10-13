// MIT. Issued buyer expenses and accountant references in the original SF47 case.
import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
import {mountEarlierStaffDesk} from './staff-desk-recovery.mjs';
const MAX_FILE=8*1024*1024;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const human=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const canonical=value=>JSON.stringify(order(value));
function order(value){return Array.isArray(value)?value.map(order):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value;}
const action=(label,name,attrs='')=>'<button type="button" data-expense-action="'+name+'" '+attrs+'>'+esc(label)+'</button>';
const input=(name,value='',type='text',attrs='')=>'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'>';
const label=(name,body,help='')=>'<label>'+esc(name)+body+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const select=(name,values,value='',attrs='')=>'<select name="'+name+'" '+attrs+'>'+values.map(row=>{
  const [id,text]=Array.isArray(row)?row:[row,human(row)];
  const selected=Array.isArray(value)?value.includes(id):String(value??'')===String(id);
  return '<option value="'+esc(id)+'"'+(selected?' selected':'')+'>'+esc(text)+'</option>';
}).join('')+'</select>';
const area=(name,value='',attrs='')=>'<textarea name="'+name+'" rows="3" '+attrs+'>'+esc(value)+'</textarea>';
const table=(headers,rows)=>'<div class="expense-table"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+
  '</tr></thead><tbody>'+(rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')||
  '<tr><td colspan="'+headers.length+'">No retained entries.</td></tr>')+'</tbody></table></div>';
function b64(buffer){let out='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);}
async function hash(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function download(raw,name,type){const link=document.createElement('a'),url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const definite=error=>[400,409,413,415,422].includes(error.status)&&typeof error.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(error.code);

export function mountExpenseAttribution({container,current,api,saveApi=api,mutationId,recordingActor,
  onSaved,onReload,onSources,onBusy=()=>{},session={},staffContext=currentStaffContext()}){
  if(!document.querySelector('link[data-expense-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./operations_expenses.css',import.meta.url).href;
    style.dataset.expenseStyle='true';document.head.append(style);
  }
  const root=document.createElement('section');root.className='expense-desk';root.setAttribute('aria-label','Issued expense attribution');container.replaceChildren(root);
  const pinnedContext=staffContext?{...staffContext}:null;
  const legacyKey='sf47.issued-expense.'+current.program.id;
  const key=staffDeskStorageKey(legacyKey,pinnedContext);
  const databaseName=staffDeskStorageKey('sf47-issued-expense-desks-v1',pinnedContext);
  let active=true,busy=false,hostBusy=false,initializing=true,initialized=Boolean(session.loaded);
  let storageSequence=session.storageSequence??0,storageSerial=session.storageWrites??Promise.resolve(),databasePromise,retainedSource=null;
  const persistedFields=['draft','drafts','draftSelection','draftBase','pending','fileMeta','selectedLine',
    'selectedAttribution','filter','page','note','receiveNote','lastReceipt'];
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function database(){
    if(!databasePromise)databasePromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(databaseName,1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('desks',{keyPath:'caseId'});
        request.result.createObjectStore('sources',{keyPath:'sha256'});};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>{databasePromise=null;reject(request.error||new Error('The browser could not open the complete expense desk.'));};
      request.onblocked=()=>{databasePromise=null;reject(new Error('Close an earlier expense reader before reopening this complete desk.'));};
    });
    return databasePromise;
  }
  async function readStored(store,id){
    const db=await database();
    return new Promise((resolve,reject)=>{
      const request=db.transaction(store).objectStore(store).get(id);
      request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);
    });
  }
  async function retainSource(file,meta){
    if(!file||!meta)return;
    if(retainedSource?.sha256===meta.sha256&&retainedSource.bytes===meta.bytes&&retainedSource.contentBase64===file.contentBase64)return;
    const raw=Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0));
    if(raw.length!==meta.bytes||await hash(raw)!==meta.sha256)throw new Error('Keep the complete original expense source bytes.');
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('sources','readwrite'),store=tx.objectStore('sources'),request=store.get(meta.sha256);
      let failure;
      request.onsuccess=()=>{
        const old=request.result;
        if(old&&(old.bytes!==meta.bytes||old.contentBase64!==file.contentBase64)){
          failure=new Error('The retained original expense source identity changed.');tx.abort();return;
        }
        if(!old)store.put({sha256:meta.sha256,bytes:meta.bytes,contentBase64:file.contentBase64});
      };
      tx.oncomplete=()=>{retainedSource={sha256:meta.sha256,bytes:meta.bytes,contentBase64:file.contentBase64};resolve();};
      tx.onabort=tx.onerror=()=>reject(failure||tx.error||new Error('The complete original source was not retained.'));
    });
  }
  function checkDesk(value){
    if(!object(value)||value.schema!=='sf47.issued-expense-editor.v1'||value.caseId!==current.program.id)
      throw new Error('Open this original case’s complete issued-expense editor.');
    for(const name of ['draft','drafts','draftSelection','draftBase','pending','fileMeta','lastReceipt'])
      if(value[name]!=null&&!object(value[name]))throw new Error('Keep the complete original expense editor fields.');
    if(value.draft&&!Array.isArray(value.draft.allocations))throw new Error('Keep all original allocation rows.');
    if(value.pending){
      const p=value.pending,b=p.body;
      if(!object(b)||!object(b.data)||!['expense.receive','expense.save','expense.review','expense.reopen','expense.void'].includes(b.action)||
        !Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<1||typeof b.requestId!=='string'||!b.requestId||
        typeof b.actor!=='string'||typeof b.note!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||
        typeof p.uncertain!=='boolean')throw new Error('Keep the complete unchanged original expense request.');
    }
    if(value.fileMeta&&(!Number.isSafeInteger(value.fileMeta.bytes)||value.fileMeta.bytes<1||value.fileMeta.bytes>MAX_FILE||
      typeof value.fileMeta.filename!=='string'||!/^[a-f0-9]{64}$/.test(value.fileMeta.sha256)))
      throw new Error('Keep the original expense filename, byte count and digest.');
    if(value.pending?.body.action==='expense.receive'){
      if(!value.fileMeta||value.pending.body.data.filename!==value.fileMeta.filename)
        throw new Error('Keep the original receiving filename and exact source identity.');
      if(!value.file&&value.pending.body.data.contentBase64)
        value={...value,file:{filename:value.fileMeta.filename,contentBase64:value.pending.body.data.contentBase64}};
    }
    for(const name of ['filter','note','receiveNote'])
      if(value[name]!=null&&typeof value[name]!=='string')throw new Error('Keep original expense text fields.');
    if(value.page!=null&&(!Number.isSafeInteger(value.page)||value.page<0))throw new Error('Keep the original expense page selection.');
    for(const d of [value.draft,...Object.values(value.drafts??{}).map(v=>v?.draft??v)].filter(Boolean)){
      if(!object(d)||!Array.isArray(d.allocations)||d.allocations.some(row=>!object(row)))
        throw new Error('Keep every complete original expense allocation draft.');
      for(const name of ['valuationSources','rateSources','linkedInvoiceIds','linkedPurchaseIds','linkedWorkIds'])
        if(d[name]!=null&&(!Array.isArray(d[name])||d[name].some(v=>typeof v!=='string')))
          throw new Error('Keep the draft’s original source and record selections.');
    }
    if(value.file&&(!object(value.file)||typeof value.file.contentBase64!=='string'||value.file.filename!==value.fileMeta?.filename))
      throw new Error('Keep the complete selected expense source.');
    return copy(value);
  }
  const $=value=>root.querySelector(value),live=()=>active&&root.isConnected;
  const view=()=>current.expenseAttribution;
  const editable=()=>current.program.state==='OPEN'&&!session.pending&&!session.inFlight;
  const lineKey=line=>line.workspaceId+'\n'+line.sourceLineId;
  const selectionFor=(line,record)=>line?{workspaceId:line.workspaceId,sourceLineId:line.sourceLineId,
    intakeId:line.intakeId,sourceRowSha256:line.sourceRowSha256,attributionId:record?.id??null,
    attributionVersion:record?.version??null,attributionContentSha256:record?.contentSha256??null}:null;
  const selected=()=>view().lines.find(row=>row.workspaceId+'\n'+row.sourceLineId===session.selectedLine);
  const attributed=row=>row&&view().attributions.find(item=>item.id===row.attributionId);
  const currentRecord=()=>view().attributions.find(row=>row.id===session.selectedAttribution)||attributed(selected());
  const sourceOptions=()=>current.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,12)]);
  function alive(){if(!live())throw new Error('Reopen this retained Operations case to continue.');}
  // Durable initialization is shared across remounts; only the active mount installs its result.
  session.page??=0;session.filter??='';session.note??='';
  function retainedPending(){
    if(!session.pending)return null;
    const value=copy(session.pending);
    if(value.body.action==='expense.receive')delete value.body.data.contentBase64;
    return value;
  }
  function stashDraft(){
    if(!session.draft||!session.selectedLine)return;
    session.drafts??={};
    session.drafts[session.selectedLine]={schema:'sf47.issued-expense-draft.v1',
      selection:copy(session.draftSelection??null),base:copy(session.draftBase??null),
      draft:copy(session.draft),note:session.note??''};
  }
  const draftStale=()=>Boolean(session.draft)&&canonical(session.draftSelection??null)!==
    canonical(selectionFor(selected(),currentRecord()));
  function draftContent(value){
    if(!value)return null;const content=copy(value);
    for(const key of ['valuationSources','rateSources','linkedInvoiceIds','linkedPurchaseIds','linkedWorkIds'])
      if(Array.isArray(content[key]))content[key].sort();
    for(const part of content.allocations??[])part.usdValue??='';
    return content;
  }
  const draftDirty=()=>Boolean(session.draft)&&canonical(draftContent(session.draft))!==canonical(draftContent(session.draftBase));
  function deskValue({complete=false}={}){
    stashDraft();
    return {schema:'sf47.issued-expense-editor.v1',caseId:current.program.id,
      draft:session.draft??null,drafts:session.drafts??{},draftSelection:session.draftSelection??null,
      draftBase:session.draftBase??null,pending:complete?copy(session.pending??null):retainedPending(),
      fileMeta:session.fileMeta??null,selectedLine:session.selectedLine??null,
      selectedAttribution:session.selectedAttribution??null,filter:session.filter,page:session.page,
      note:session.note,receiveNote:session.receiveNote??'',lastReceipt:session.lastReceipt??null,
      ...(complete?{file:copy(session.file??null)}:{})};
  }
  function persist(){
    if(!initialized)return Promise.resolve();
    const value=copy(deskValue()),meta=copy(session.fileMeta??null);
    const source=copy(session.file??(session.pending?.body.action==='expense.receive'&&session.pending.body.data.contentBase64?
      {filename:session.pending.body.data.filename,contentBase64:session.pending.body.data.contentBase64}:null));
    const task=storageSerial.then(async()=>{
      await retainSource(source,meta);
      const db=await database(),expected=session.storageSequence??storageSequence;
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('desks','readwrite'),store=tx.objectStore('desks'),request=store.get(current.program.id);
        let failure;
        request.onsuccess=()=>{
          if((request.result?.storageSequence??0)!==expected){
            failure=Object.assign(new Error('Another window changed this complete expense desk. Download your current work and reopen the saved local copy before continuing.'),
              {code:'EXPENSE_DESK_CHANGED'});tx.abort();return;
          }
          store.put({...value,storageSequence:expected+1});
        };
        tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(failure||tx.error||new Error('The complete expense desk was not retained.'));
      });
      storageSequence=expected+1;session.storageSequence=storageSequence;session.storageFault=null;
    });
    session.storageWrites=storageSerial=task.catch(error=>{session.storageFault=error.message;if(live())message(error.message,true);});
    return task;
  }
  async function completeDesk(){
    const value=copy(deskValue({complete:true}));
    if(value.fileMeta&&!value.file){
      const source=await readStored('sources',value.fileMeta.sha256).catch(()=>null);
      if(source)value.file={filename:value.fileMeta.filename,contentBase64:source.contentBase64};
    }
    if(value.pending?.body.action==='expense.receive'&&!value.pending.body.data.contentBase64&&value.file)
      value.pending.body.data.contentBase64=value.file.contentBase64;
    return value;
  }
  async function downloadDesk(name='Issued_Expense_Complete_Desk.json'){
    storeDraft(false);download(JSON.stringify(await completeDesk(),null,2)+'\n',name,'application/json');
  }
  async function installDesk(value,{saved=false}={}){
    const received=checkDesk(value);alive();
    if(session.pending&&(!saved||received.pending?.sha256!==session.pending.sha256||received.pending?.body.requestId!==session.pending.body.requestId))
      throw new Error('Receive the current original request before opening another expense desk. Its complete download remains available.');
    if(received.pending)assertStaffRequestActor(received.pending.body,pinnedContext);
    if(received.file){
      await retainSource(received.file,received.fileMeta);alive();
    }
    if(received.pending&&received.pending.body.action==='expense.receive'&&!received.pending.body.data.contentBase64&&received.file)
      received.pending.body.data.contentBase64=received.file.contentBase64;
    if(received.pending&&(received.pending.body.action!=='expense.receive'||received.pending.body.data.contentBase64)&&
      await hash(canonical(received.pending.body))!==received.pending.sha256)
      throw new Error('The received original request differs from its exact retained body.');
    await downloadDesk('Issued_Expense_Before_Opening.json');alive();
    await storageSerial;alive();
    for(const name of persistedFields)delete session[name];
    for(const name of persistedFields)if(Object.hasOwn(received,name))session[name]=copy(received[name]);
    session.file=copy(received.file??null);session.review=null;session.page??=0;session.filter??='';session.note??='';
    if(saved){storageSequence=received.storageSequence??0;session.storageSequence=storageSequence;}
    initialized=true;session.loaded=true;render();
    await persist();alive();await restoreSelectedSource();alive();
    message('Opened the complete original expense desk and its retained source/request selection.');
  }
  async function openDeskFile(file){
    if(!file)return;
    if(file.size>64*1024*1024)throw new Error('Open a complete expense desk within 64 MiB.');
    const raw=await file.text();alive();await installDesk(JSON.parse(raw));
  }
  function message(text,error=false){
    session.message=text;session.error=error;
    if(live()){const target=$('[data-expense-message]');if(target){target.textContent=text;target.setAttribute('role',error?'alert':'status');}}
  }
  function storeDraft(retain=true){
    const form=$('[data-expense-editor]');
    if(!form||!session.draft)return;
    const d=session.draft;
    for(const name of ['unattributedReason','valuationMode','valuationDate','valuationNote','currency','decimals',
      'rateId','rateBase','rateQuote','rateValue','rateObservation','ratePublication','rateBasis','rateRounding','rateUrl','rateReference','rateNote']){
      const el=form.elements.namedItem(name);if(el)d[name]=el.value;
    }
    for(const name of ['valuationSources','rateSources','linkedInvoiceIds','linkedPurchaseIds','linkedWorkIds']){
      const el=form.elements.namedItem(name);if(el)d[name]=[...el.selectedOptions].map(row=>row.value);
    }
    d.allocations=[...form.querySelectorAll('[data-expense-split]')].map(part=>Object.fromEntries(
      ['costId','fundingBasis','nativeAmount','usdValue','memo'].map(name=>[name,part.querySelector('[name="'+name+'"]').value])));
    const note=$('[name=expenseNote]');if(note)session.note=note.value;
    if(retain)try{persist();}catch{message('The browser could not retain this draft. Keep the selected view open and free browser storage before sending.',true);}
    updateBalance();sync();
  }
  function sync(){
    if(!live())return;
    root.setAttribute('aria-busy',String(initializing||busy||hostBusy||Boolean(session.inFlight)));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      let disabled=initializing||!initialized||busy||hostBusy||Boolean(session.inFlight)||el.dataset.expenseFixed==='true';
      if(el.closest('[data-expense-editor]')||el.closest('[data-expense-receive]'))disabled ||= !editable();
      if(el.dataset.expenseAction==='preview')disabled ||= !session.file||Boolean(session.pending);
      if(el.dataset.expenseAction==='receive')disabled ||= !session.review||!session.file||!editable();
      if(['select-line','select-attribution','discard-draft'].includes(el.dataset.expenseAction))disabled ||= Boolean(session.pending);
      if(el.dataset.expenseAction==='recover')disabled ||= !session.pending;
      if(['add-split','remove-split'].includes(el.dataset.expenseAction))disabled ||= Boolean(currentRecord()&&currentRecord().state!=='DRAFT');
      if(el.dataset.expenseAction==='save')disabled ||= !session.draft||!editable()||draftStale()||Boolean(currentRecord()&&currentRecord().state!=='DRAFT');
      if(el.dataset.expenseTransition)disabled ||= !currentRecord()?.allowedActions.includes(el.dataset.expenseTransition)||!editable()||
        (['expense.review','expense.void'].includes(el.dataset.expenseTransition)&&(draftStale()||draftDirty()));
      el.disabled=disabled;
    }
    const mode=$('[name=valuationMode]')?.value;
    for(const el of root.querySelectorAll('[data-expense-value]'))el.hidden=mode==='NONE';
    for(const el of root.querySelectorAll('[data-expense-rate]'))el.hidden=mode!=='RETAINED_RATE';
    for(const el of root.querySelectorAll('[data-expense-direct]'))el.hidden=mode!=='ENTERED_USD';
  }
  const setHostBusy=value=>{hostBusy=Boolean(value);sync();};
  async function run(fn){
    if(initializing||!initialized||busy||hostBusy||!live())return;
    busy=true;onBusy(true);sync();
    try{await fn();}catch(error){if(live())message(error.message||String(error),true);}
    finally{busy=false;onBusy(false);if(live())sync();}
  }
  function baseDraft(line,record){
    const val=record?.valuation,rate=val?.rate;
    return {intakeId:line.intakeId,sourceLineId:line.sourceLineId,expectedSourceRowSha256:line.sourceRowSha256,
      ...(record?{id:record.id}:{}),allocations:record?record.allocations.map(({line,...row})=>({...copy(row),usdValue:row.usdValue??''})):
        [{costId:'',fundingBasis:'GRANT',nativeAmount:line.original.amount,usdValue:'',memo:''}],
      unattributedReason:record?.unattributedReason??'',
      valuationMode:val?.mode??'NONE',valuationDate:val?.date??new Date().toISOString().slice(0,10),
      valuationSources:val?.sourceIds??[],valuationNote:val?.note??'',
      currency:val?.nativeUnit?.currency??'',decimals:String(val?.nativeUnit?.decimals??''),
      rateId:rate?.id??'expense-rate-'+crypto.randomUUID(),rateBase:rate?.baseCurrency??'',
      rateQuote:rate?.quoteCurrency??'USD',rateValue:rate?.rate??'',
      rateObservation:rate?.observationDate??'',ratePublication:rate?.publicationDate??'',
      rateBasis:rate?.basis??'REFERENCE_OBSERVATION',rateRounding:rate?.rounding??'HALF_UP',
      rateUrl:rate?.sourceUrl??'',rateSources:rate?.sourceIds??[],rateReference:rate?.sourceReference??'',rateNote:rate?.note??'',
      linkedInvoiceIds:record?.linkedInvoiceIds??[],linkedPurchaseIds:record?.linkedPurchaseIds??[],linkedWorkIds:record?.linkedWorkIds??[]};
  }
  function selectDraft(line,record,discard=false){
    const ident=lineKey(line),saved=discard?null:session.drafts?.[ident];
    session.selectedLine=ident;session.selectedAttribution=record?.id??null;
    if(saved?.schema==='sf47.issued-expense-draft.v1'&&saved.draft){
      session.draft=copy(saved.draft);session.note=saved.note??'';
      session.draftSelection=copy(saved.selection);session.draftBase=copy(saved.base);
    }else if(saved?.allocations){
      // Keep an older browser draft readable; its missing review binding requires an explicit reload.
      session.draft=copy(saved);session.note='';session.draftSelection=null;session.draftBase=null;
    }else{
      session.draft=baseDraft(line,record);session.note='';
      session.draftSelection=selectionFor(line,record);session.draftBase=copy(session.draft);
    }
  }
  function pick(line,record){
    storeDraft();selectDraft(line,record);
    persist();render();$('[data-expense-editor] h4')?.focus();
  }
  function draftData(){
    storeDraft();
    const d=session.draft;
    if(!d)throw new Error('Select an original issued expense or credit.');
    if(draftStale())throw new Error('This retained draft belongs to an earlier source or attribution revision. Save a copy, then reload the current selection before recording it.');
    const allocations=d.allocations.map(part=>({costId:part.costId,fundingBasis:part.fundingBasis,
      nativeAmount:part.nativeAmount,memo:part.memo,
      ...(d.valuationMode==='ENTERED_USD'?{usdValue:part.usdValue||null}:{})}));
    let valuation=null;
    if(d.valuationMode!=='NONE'){
      valuation={mode:d.valuationMode,date:d.valuationDate,sourceIds:d.valuationSources,note:d.valuationNote};
      if(d.valuationMode==='RETAINED_RATE'){
        valuation.nativeUnit={currency:d.currency.trim().toUpperCase(),decimals:Number(d.decimals)};
        if(d.decimals===''||!Number.isInteger(valuation.nativeUnit.decimals))throw new Error('Retain the original unit decimal places explicitly.');
        valuation.rate=d.rateValue?{id:d.rateId,baseCurrency:d.rateBase.trim().toUpperCase(),
          quoteCurrency:d.rateQuote.trim().toUpperCase(),rate:d.rateValue,observationDate:d.rateObservation,
          publicationDate:d.ratePublication||null,basis:d.rateBasis,rounding:d.rateRounding,
          sourceUrl:d.rateUrl,sourceIds:d.rateSources,sourceReference:d.rateReference,note:d.rateNote}:null;
      }
    }
    return {...(d.id?{id:d.id}:{}),intakeId:d.intakeId,sourceLineId:d.sourceLineId,
      expectedSourceRowSha256:d.expectedSourceRowSha256,allocations,valuation,unattributedReason:d.unattributedReason,
      linkedInvoiceIds:d.linkedInvoiceIds,linkedPurchaseIds:d.linkedPurchaseIds,linkedWorkIds:d.linkedWorkIds};
  }
  function splitForm(part,index){
    const costs=[['','Choose the original work package'],...view().costs.map(row=>[row.id,row.id+' · T'+row.tranche])];
    return '<fieldset data-expense-split><legend>Cost allocation '+(index+1)+'</legend><div class="expense-fields">'+
      label('Work package',select('costId',costs,part.costId,'required'))+
      label('Funding basis',select('fundingBasis',['GRANT','CUSTOMER','INTERNAL','PREAWARD'],part.fundingBasis))+
      label('Native-unit amount',input('nativeAmount',part.nativeAmount,'text','inputmode="numeric" pattern="[0-9]+" required'), 'Integer units from this exact issued line.')+
      '<div data-expense-direct>'+label('Explicit USD value',input('usdValue',part.usdValue,'text','inputmode="decimal"'), 'Use the attached original valuation source.')+'</div>'+
      label('Allocation note',input('memo',part.memo,'text','maxlength="2000"'))+
      '</div>'+action('Remove allocation','remove-split','data-index="'+index+'"')+'</fieldset>';
  }
  function editor(){
    const line=selected(),record=currentRecord(),d=session.draft;
    if(!line||!d)return '<p class="expense-empty">Select an original issued line to attribute its cost or credit.</p>';
    const original=line.original,disabled=record&&record.state!=='DRAFT';
    const links=kind=>current.records[kind].map(row=>[row.id,(row.name||row.number||row.description||row.id)+' · '+human(row.state)]);
    return '<form data-expense-editor><h4 tabindex="-1">'+esc(human(line.kind))+' allocation</h4>'+
      '<div class="expense-native"><strong>'+esc(original.amount)+' native units</strong><span>'+esc(original.network)+' / '+esc(original.asset)+'</span></div>'+
      '<p><code>'+esc(line.sourceLineId)+'</code></p>'+
      (record?'<p>Retained '+esc(record.id)+' · '+esc(human(record.state))+
        (record.bookkeepingChanged?' · later accountant references are available':'')+'</p>':'')+
      (disabled?'<p class="expense-note">Reopen the retained attribution before editing its native amounts or source edition.</p>':'')+
      (draftStale()?'<p class="expense-note" role="alert">This draft retains an earlier source or attribution revision. Save its full values and note, then reload the current selection before recording changes.</p>':'')+
      '<p data-expense-draft-state role="status"></p>'+
      '<div data-expense-splits>'+d.allocations.map(splitForm).join('')+'</div>'+
      action('Add work-package allocation','add-split')+'<p data-expense-balance role="status"></p>'+
      label('Reason for any unattributed remainder',area('unattributedReason',d.unattributedReason,'maxlength="4000"'))+
      '<fieldset><legend>Original valuation</legend>'+
      label('Valuation method',select('valuationMode',[['NONE','Retain native amounts'],['ENTERED_USD','Enter sourced USD values'],['RETAINED_RATE','Use original unit definition and retained rate']],d.valuationMode))+
      '<div data-expense-value><div class="expense-fields">'+
      label('Valuation date',input('valuationDate',d.valuationDate,'date'))+
      label('Original valuation / unit attachments',select('valuationSources',sourceOptions(),d.valuationSources,'multiple size="4"'))+
      label('Valuation method and source reference',area('valuationNote',d.valuationNote,'maxlength="4000"'))+
      '</div></div><div data-expense-rate>'+
      '<p>The original Forecast currency model performs this conversion. Select the asset’s actual unit definition and source; native amounts stay unchanged.</p>'+
      '<div class="expense-fields">'+
      label('Unit currency code',input('currency',d.currency,'text','maxlength="3"'), 'Explicit three-letter currency or unit label used by the original rate.')+
      label('Decimal places per native integer',input('decimals',d.decimals,'number','min="0" max="18" step="1"'))+
      label('Retained rate identity',input('rateId',d.rateId))+
      label('Rate base currency',input('rateBase',d.rateBase,'text','maxlength="3"'))+
      label('Rate quote currency',input('rateQuote',d.rateQuote,'text','maxlength="3"'))+
      label('Quote units per one base unit',input('rateValue',d.rateValue,'text','inputmode="decimal"'), 'Leave empty to retain an unvalued foreign amount. USD uses its original units.')+
      label('Observation date',input('rateObservation',d.rateObservation,'date'))+
      label('Publication date',input('ratePublication',d.ratePublication,'date'))+
      label('Rate basis',select('rateBasis',['REFERENCE_OBSERVATION','PLANNING_ASSUMPTION'],d.rateBasis))+
      label('USD cent rounding',select('rateRounding',['HALF_UP','HALF_EVEN'],d.rateRounding))+
      label('Original rate URL',input('rateUrl',d.rateUrl,'url'))+
      label('Retained rate attachments',select('rateSources',sourceOptions(),d.rateSources,'multiple size="4"'))+
      label('Rate edition / series',input('rateReference',d.rateReference))+
      label('Rate interpretation / assumption',area('rateNote',d.rateNote,'maxlength="4000"'))+
      '</div></div></fieldset><fieldset><legend>Related original operating records</legend><div class="expense-fields">'+
      label('Invoices',select('linkedInvoiceIds',links('invoices'),d.linkedInvoiceIds,'multiple size="4"'))+
      label('Purchase observations',select('linkedPurchaseIds',links('purchases'),d.linkedPurchaseIds,'multiple size="4"'))+
      label('Work records',select('linkedWorkIds',links('work'),d.linkedWorkIds,'multiple size="4"'))+
      '</div></fieldset>'+label('Recording / review note',area('expenseNote',session.note,'maxlength="12000"'))+
      '<div class="expense-actions">'+(disabled?'':action('Save native allocation','save'))+
      (record?record.allowedActions.filter(x=>x!=='expense.save').map(x=>action(human(x.split('.')[1])+' attribution','transition','data-expense-transition="'+x+'"')).join(''):'')+
      action('Save draft and note','download-draft')+action('Reload retained selection','discard-draft')+'</div>'+
      '<details><summary>Original issued fields and accepted accountant references</summary><pre>'+esc(JSON.stringify({original,bookkeeping:line.bookkeeping,retainedSource:record?.source??null,review:record?.review??null},null,2))+'</pre></details></form>';
  }
  function summary(){
    const r=view().summary;
    return '<div class="expense-summary"><div><span>Operational expense USD</span><strong>'+esc(r.operationalExpenseUsd)+'</strong></div>'+
      '<div><span>Operational credit USD</span><strong>'+esc(r.operationalCreditUsd)+'</strong></div>'+
      '<div><span>Operational net USD</span><strong>'+esc(r.operationalNetUsd)+'</strong></div>'+
      '<div><span>Reviewed / draft attributions</span><strong>'+r.reviewed+' / '+r.draftIds.length+'</strong></div></div>'+
      '<p class="expense-note">Cost attribution retains its own review and valuation. Original invoice balances, recorded cash and conditional grant funding retain their existing records.</p>'+
      (r.excludedOperationalIds?.length?'<p>'+r.excludedOperationalIds.length+' development or planning-value records are retained outside operational USD totals.</p>':'');
  }
  function receiving(){
    const review=session.review,meta=session.fileMeta;
    return '<section class="expense-receiving"><h4>Receive an issued expense source</h4>'+
      '<p>Choose the original issued buyer JSON, or its complete Accountant delivery ZIP to include accepted return history.</p>'+
      '<label class="expense-file">Original file<input type="file" data-expense-file accept=".json,.zip,application/json,application/zip"></label>'+
      (meta?'<p>'+esc(meta.filename)+' · '+meta.bytes+' bytes<br><code>'+esc(meta.sha256)+'</code></p>':'')+
      '<div class="expense-actions">'+action('Review selected file','preview')+
      (session.pending?'':action('Open source attachments','sources'))+'</div>'+
      (review?'<div data-expense-receive><h4>Original source review</h4>'+
        table(['Buyer workspace','Issued close','Period','Native lines','Bookkeeping revision'],
          [[esc(review.inspection.source.buyer.workspaceId),esc(review.inspection.source.buyer.closeId),
            esc(canonical(review.inspection.issued.period)),review.rows.length,esc(review.inspection.bookkeeping.revision??'Issued source')]])+
        '<p>'+esc(human(review.receiving))+' · preview <code>'+esc(review.previewSha256)+'</code></p>'+
        table(['Kind','Original amount','Network / asset','Original issued row'],
          review.rows.map(row=>[esc(row.kind),esc(row.original.amount),esc(row.original.network)+'<small>'+esc(row.original.asset)+'</small>',esc(row.sourceLineId)]))+
        label('Receiving note',area('receiveNote',session.receiveNote??'','maxlength="12000"'))+
        action(review.receiving==='ALREADY_RETAINED'?'Reopen original receipt':'Receive reviewed original','receive')+'</div>':'')+'</section>';
  }
  function register(){
    const text=session.filter.trim().toLowerCase();
    const lines=view().lines.filter(row=>!text||[row.kind,row.original.network,row.original.asset,row.sourceLineId,row.closeId,row.attributionState||'unattributed'].join(' ').toLowerCase().includes(text));
    const totalPages=Math.max(1,Math.ceil(lines.length/40));session.page=Math.min(Math.max(0,session.page),totalPages-1);
    const shown=lines.slice(session.page*40,(session.page+1)*40);
    return '<section><h4>Issued expense and credit register</h4>'+
      label('Filter original lines',input('expenseFilter',session.filter,'search','data-expense-filter'))+
      table(['Kind / state','Original native amount','Buyer close / asset','Open allocation'],shown.map(row=>[
        esc(row.kind)+'<small>'+esc(human(row.attributionState||'UNATTRIBUTED'))+'</small>',
        '<strong>'+esc(row.original.amount)+'</strong><small>'+esc(row.original.network)+'</small>',
        esc(row.closeId)+'<small>'+esc(row.original.asset)+'</small>',
        action(row.attributionId?'Open retained attribution':'Attribute original line','select-line','data-workspace="'+esc(row.workspaceId)+'" data-line="'+esc(row.sourceLineId)+'"')
      ]))+'<div class="expense-actions">'+action('Previous','page-prev',session.page===0?'data-expense-fixed="true"':'')+
      '<span>Page '+(session.page+1)+' of '+totalPages+' · '+lines.length+' original lines</span>'+
      action('Next','page-next',session.page+1===totalPages?'data-expense-fixed="true"':'')+'</div>'+
      '<h4>Attribution history</h4>'+table(['Original attribution','State','Source changed','Open'],view().attributions.map(row=>[
        esc(row.id)+'<small>'+esc(row.source.kind)+' · '+esc(row.source.original.amount)+' units</small>',
        esc(row.state),row.bookkeepingChanged?'Later references received':'Retained source current',
        action('Open','select-attribution','data-id="'+esc(row.id)+'"')
      ]))+'</section>';
  }
  function sources(){
    return '<details class="expense-sources"><summary>Received original files and accepted accountant history ('+view().sources.length+')</summary>'+
      table(['Original file','Close / edition','Exact source','Download'],view().sources.map(row=>[
        esc(row.filename)+'<small>'+esc(row.createdAt)+' · '+esc(row.actor)+'</small>',
        esc(row.source.buyer.closeId)+'<small>'+esc(row.bookkeeping.revision??'Issued source')+' · '+(row.current?'current':'historical')+'</small>',
        '<code>'+esc(row.fileSha256)+'</code>',
        action('Original file','download-source','data-source="'+esc(row.sourceId)+'"')+
        '<details><summary>Accountant history</summary><pre>'+esc(JSON.stringify(row.bookkeeping,null,2))+'</pre></details>'
      ]))+'</details>';
  }
  function render(){
    if(!live())return;
    root.innerHTML='<header class="expense-heading"><div><p class="expense-eyebrow">DELIVERY OPERATIONS / ISSUED BUYER EXPENSES</p>'+
      '<h3>Attribute original costs and credits</h3><p>Connect issued buyer allocations and returned accountant references to this case’s original work packages.</p></div>'+
      '<div class="expense-actions">'+action('Refresh case','reload')+action('Readable review','export-html')+action('Allocation CSV','export-csv')+action('Complete case','export-case')+action('Download complete editor','download-desk')+action('Open complete editor','open-desk')+action('Download work and reopen saved local desk','reopen-local')+'</div><input type="file" hidden data-expense-desk-file accept=".json,application/json"></header>'+
      '<p data-expense-message role="'+(session.error?'alert':'status')+'" aria-live="polite">'+esc(session.message||'')+'</p>'+
      (session.storageFault?'<p class="expense-note" role="alert">'+esc(session.storageFault)+' Your complete current editor remains available for download.</p>':'')+
      (session.pending?'<section class="expense-pending"><h4>Original request awaiting reconciliation</h4><p>'+esc(session.pending.body.action)+' · <code>'+esc(session.pending.body.requestId)+'</code></p>'+
        '<p>Retained request SHA256 <code>'+esc(session.pending.sha256)+'</code></p>'+
        '<div class="expense-actions">'+action('Reconcile / resume original request','recover')+action('Save retained request','download-request')+'</div></section>':'')+
      summary()+receiving()+sources()+'<div class="expense-layout"><div>'+register()+'</div><div>'+editor()+'</div></div>'+
      '<details><summary>Retained review items ('+view().reviewItems.length+')</summary>'+table(['Record','Item'],view().reviewItems.map(x=>[esc(x.id),esc(x.message)]))+'</details>';
    const record=currentRecord();
    if(record&&record.state!=='DRAFT')for(const el of root.querySelectorAll('[data-expense-editor] input,[data-expense-editor] select,[data-expense-editor] textarea')){
      if(el.name!=='expenseNote')el.dataset.expenseFixed='true';
    }
    sync();updateBalance();
  }
  function updateBalance(){
    const state=$('[data-expense-draft-state]');if(state)state.textContent=draftStale()?'Retained draft needs the current original selection.':draftDirty()?'Allocation edits are retained in this browser. Save them before reviewing the original attribution.':'The displayed allocation matches its selected original revision.';
    const output=$('[data-expense-balance]'),line=selected();if(!output||!line||!session.draft)return;
    try{
      const parts=session.draft.allocations.map(row=>row.nativeAmount);
      if(parts.some(value=>!/^(0|[1-9][0-9]*)$/.test(value)))throw new Error();
      const total=parts.reduce((sum,value)=>sum+BigInt(value),0n),left=BigInt(line.original.amount)-total;
      output.textContent='Allocated '+total+' native units · remaining '+left+'.';
      output.setAttribute('role',left<0n?'alert':'status');
    }catch{output.textContent='Enter exact native integer amounts to review the remainder.';}
  }
  async function restoreSelectedSource(){
    if(session.file||!session.fileMeta)return;
    const meta=copy(session.fileMeta),source=await readStored('sources',meta.sha256);
    alive();
    if(!source||session.file||canonical(session.fileMeta)!==canonical(meta))return;
    const bytes=Uint8Array.from(atob(source.contentBase64),c=>c.charCodeAt(0));
    if(source.bytes!==meta.bytes||bytes.length!==meta.bytes||await hash(bytes)!==meta.sha256)
      throw new Error('The retained original expense source differs from its selected identity.');
    alive();
    if(session.file||canonical(session.fileMeta)!==canonical(meta))return;
    session.file={filename:meta.filename,contentBase64:source.contentBase64};
    retainedSource=source;render();
  }
  async function sourceBytes(source){
    const response=await api('/api/operations/'+current.program.id+'/sources/'+source.id,undefined,{download:true});
    const bytes=await response.arrayBuffer();alive();
    if(bytes.byteLength!==source.bytes||await hash(bytes)!==source.sha256)throw new Error('The original downloaded source differs from its retained identity.');
    return bytes;
  }
  async function selectFile(filename,bytes){
    if(bytes.byteLength===0||bytes.byteLength>MAX_FILE)throw new Error('Choose a complete original issued source or accountant ZIP up to 8 MiB.');
    const meta={filename,bytes:bytes.byteLength,sha256:await hash(bytes)};
    alive();
    if(session.pending?.body.action==='expense.receive'){
      const expected=session.fileMeta;
      if(!expected||meta.bytes!==expected.bytes||meta.sha256!==expected.sha256||meta.filename!==expected.filename)
        throw new Error('Reselect the exact original filename and bytes for the retained receiving request.');
      session.pending.body.data.contentBase64=b64(bytes);
      if(await hash(canonical(session.pending.body))!==session.pending.sha256)throw new Error('The retained complete request identity differs.');
    }else if(session.pending)throw new Error('Reconcile the original pending attribution first.');
    session.fileMeta=meta;session.file={filename,contentBase64:b64(bytes)};session.review=null;render();
    await retainSource(session.file,meta);alive();await persist();
    message(session.pending?'Original source bytes restored. Reconcile the same request.':'Original file selected. Review its issued period and complete accountant history.');
  }
  async function preview(){
    if(!session.file)throw new Error('Reselect the original source file.');
    session.review=await api('/api/operations/'+current.program.id+'/expense-preview',{expectedVersion:current.program.version,...session.file});
    alive();render();message('Reviewed '+session.review.rows.length+' original issued lines against case version '+session.review.version+'.');
  }
  async function fullPending(){
    const pending=session.pending;if(!pending)throw new Error('There is no retained original request.');
    assertStaffRequestActor(pending.body,pinnedContext);
    if(pending.body.action==='expense.receive'&&!pending.body.data.contentBase64){
      const retained=session.file?.contentBase64?session.file:
        await readStored('sources',session.fileMeta?.sha256).catch(()=>null);
      if(retained?.contentBase64)pending.body.data.contentBase64=retained.contentBase64;
      else{
        const file=current.sources.find(row=>row.sha256===session.fileMeta?.sha256&&row.bytes===session.fileMeta?.bytes);
        if(!file)throw new Error('Reselect the exact original file to reopen this retained request.');
        pending.body.data.contentBase64=b64(await sourceBytes(file));
      }
    }
    if(await hash(canonical(pending.body))!==pending.sha256)throw new Error('The retained request differs from its original complete body.');
    assertStaffRequestActor(pending.body,pinnedContext);
    return pending;
  }
  async function accepted(receipt){
    const pending=session.pending;
    if(!pending||receipt?.id!==current.program.id||receipt.action!==pending.body.action||
      !Number.isInteger(receipt.version)||receipt.version<pending.body.expectedVersion)
      throw new Error('The returned original receipt does not match this selected request.');
    session.lastReceipt=copy(receipt);session.pending=null;session.review=null;
    if(receipt.action==='expense.receive'){session.file=null;session.fileMeta=null;session.receiveNote='';}
    if(['expense.save','expense.review','expense.reopen','expense.void'].includes(receipt.action)){
      if(session.drafts&&session.selectedLine)delete session.drafts[session.selectedLine];
      session.draft=null;session.draftSelection=null;session.draftBase=null;session.note='';
      session.selectedAttribution=receipt.recordId;
    }
    session.message='Original '+human(receipt.action)+' retained at case version '+receipt.version+'.';
    session.error=false;
    try{await persist();}catch{session.message+=' The save is complete; reopening the retained browser request will return this same receipt.';}
    if(live())await onSaved(receipt);
    return receipt;
  }
  async function reconcileOnly(){
    const pending=await fullPending();
    const result=await saveApi('/api/operations/'+current.program.id+'/expense-request',copy(pending.body));
    if(result?.caseId!==current.program.id||result.requestId!==pending.body.requestId||!Number.isInteger(result.currentVersion))
      throw new Error('The original request reader did not return this selected case and request.');
    if(result.status==='COMMITTED'){await accepted(result.receipt);return 'COMMITTED';}
    if(result.status!=='NOT_RECORDED')throw new Error('The original request state is unavailable.');
    if(result.currentVersion!==pending.body.expectedVersion){
      session.pending=null;session.review=null;persist();
      message('The original request is unrecorded and its reviewed case version changed. The source and allocation draft remain; refresh and review them.');
      if(live())await onReload();
      return 'STALE';
    }
    message('The original request has no committed receipt and the selected case version remains current. Resume uses the same request and inputs.');
    return 'READY';
  }
  async function sendPending(){
    const pending=await fullPending();
    if(session.inFlight)return session.inFlight;
    session.inFlight=(async()=>{
      try{
        if(pending.uncertain){const status=await reconcileOnly();if(status!=='READY')return;}
        const wasUncertain=pending.uncertain;
        pending.uncertain=true;await persist();
        let receipt;
        try{receipt=await saveApi('/api/operations/'+current.program.id+'/command',copy(pending.body));}
        catch(error){
          if(!wasUncertain&&definite(error)){session.pending=null;session.review=null;persist();}
          else persist();
          throw error;
        }
        await accepted(receipt);
      }finally{session.inFlight=null;session.notify?.();}
    })();
    return session.inFlight;
  }
  async function prepare(actionName,data,note){
    if(!editable())throw new Error('Reconcile the retained original request or reopen the closed case first.');
    const body={expectedVersion:current.program.version,actor:recordingActor(),note:note.trim(),action:actionName,data};
    assertStaffRequestActor(body,pinnedContext);
    body.requestId=await mutationId('operations:'+current.program.id,body);alive();
    session.pending={body:copy(body),sha256:await hash(canonical(body)),uncertain:false};
    await persist();alive();render();await sendPending();
  }
  root.addEventListener('input',event=>{
    if(event.target.matches('[data-expense-filter]')){
      session.filter=event.target.value;session.page=0;persist();
    }else if(event.target.name==='receiveNote'){session.receiveNote=event.target.value;persist();}
    else if(event.target.closest('[data-expense-editor]'))storeDraft();
  });
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-expense-desk-file]')){const file=event.target.files?.[0];if(file)run(()=>openDeskFile(file));}
    else if(event.target.matches('[data-expense-file]')){
      const file=event.target.files?.[0];if(file)run(async()=>selectFile(file.name,await file.arrayBuffer()));
    }else if(event.target.matches('[data-expense-filter]'))render();
    else if(event.target.closest('[data-expense-editor]')){storeDraft();sync();}
  });
  root.addEventListener('submit',event=>{if(event.target.matches('[data-expense-editor]'))event.preventDefault();});
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-expense-action]');if(!target)return;
    const choice=target.dataset.expenseAction;
    if(choice==='select-line'||choice==='select-attribution'){
      if(busy||hostBusy||session.pending)return;
      const record=choice==='select-attribution'?view().attributions.find(row=>row.id===target.dataset.id):null;
      const line=choice==='select-line'?view().lines.find(row=>row.workspaceId===target.dataset.workspace&&row.sourceLineId===target.dataset.line):
        view().lines.find(row=>row.workspaceId===record?.source.workspaceId&&row.sourceLineId===record?.source.sourceLineId);
      if(!line)return message('This original issued row is unavailable in the current source edition.',true);
      pick(line,record||attributed(line));
      return;
    }
    if(choice==='add-split'||choice==='remove-split'){
      if(!editable()||busy||hostBusy||!session.draft||currentRecord()?.state==='REVIEWED'||currentRecord()?.state==='VOID')return;
      storeDraft();
      if(choice==='add-split'){
        if(session.draft.allocations.length>=200)return message('This original allocation supports up to 200 cost splits.',true);
        session.draft.allocations.push({costId:'',fundingBasis:'GRANT',nativeAmount:'',usdValue:'',memo:''});
      }else session.draft.allocations.splice(Number(target.dataset.index),1);
      persist();render();return;
    }
    let saveData=null;
    if(choice==='save'){try{saveData=draftData();}catch(error){message(error.message,true);return;}}
    const note=$('[name=expenseNote]')?.value??session.note;
    run(async()=>{
      if(choice==='download-desk')return downloadDesk();
      if(choice==='open-desk'){root.querySelector('[data-expense-desk-file]').click();return;}
      if(choice==='reopen-local'){await storageSerial;alive();const saved=await readStored('desks',current.program.id);alive();if(!saved)throw new Error('No complete saved local expense desk is available.');return installDesk(saved,{saved:true});}
      if(choice==='reload'){storeDraft();return onReload();}
      if(choice==='sources'){storeDraft();return onSources();}
      if(choice==='preview')return preview();
      if(choice==='recover')return sendPending();
      if(choice==='receive'){
        if(!session.review||!session.file||session.review.version!==current.program.version)throw new Error('Review the exact original file against the current case first.');
        const reason=($('[name=receiveNote]')?.value??session.receiveNote??'').trim();
        if(!reason)throw new Error('Record the source receiving reason.');
        return prepare('expense.receive',{...session.file,expectedPreviewSha256:session.review.previewSha256},reason);
      }
      if(choice==='save')return prepare('expense.save',saveData,note||'');
      if(choice==='transition'){
        const row=currentRecord(),verb=target.dataset.expenseTransition;
        if(!row?.allowedActions.includes(verb))throw new Error('That review transition is unavailable.');
        storeDraft();
        if(['expense.review','expense.void'].includes(verb)&&(draftStale()||draftDirty()))throw new Error('Save the edited allocation, or reload its retained selection, before reviewing or voiding the original record.');
        if(!note?.trim())throw new Error('Record the reason for this original attribution transition.');
        return prepare(verb,{id:row.id,expectedContentSha256:row.contentSha256},note);
      }
      if(choice==='discard-draft'){
        const line=selected();if(line){if(session.drafts)delete session.drafts[session.selectedLine];selectDraft(line,currentRecord(),true);persist();render();}return;
      }
      if(choice==='page-prev'||choice==='page-next'){
        storeDraft();session.page+=choice==='page-prev'?-1:1;persist();render();return;
      }
      if(choice==='download-source'){
        const source=current.sources.find(row=>row.id===target.dataset.source);
        if(!source)throw new Error('Select a retained source.');
        const bytes=await sourceBytes(source);download(bytes,source.filename,'application/octet-stream');return;
      }
      if(choice==='download-draft'){
        storeDraft();const saved=session.drafts?.[session.selectedLine];if(!saved)throw new Error('Select an original allocation draft.');
        download(JSON.stringify({caseId:current.program.id,...saved},null,2)+'\n','issued-expense-draft.json','application/json');return;
      }
      if(choice==='download-request'){
        const pending=await fullPending();download(JSON.stringify(pending.body,null,2)+'\n',pending.body.requestId+'.json','application/json');return;
      }
      const names={'export-html':'expense-attribution.html','export-csv':'expense-attributions.csv','export-case':'export.zip'};
      if(names[choice]){
        const name=names[choice],response=await api('/api/operations/'+current.program.id+'/'+name,undefined,{download:true});
        const raw=await response.blob();alive();download(raw,name==='export.zip'?current.program.id+'.zip':name,response.headers.get('content-type'));return;
      }
    });
  });
  const earlier=mountEarlierStaffDesk({root,staffContext:pinnedContext,title:'Issued expense',
    readCopy:()=>{const raw=localStorage.getItem(legacyKey);return raw?checkDesk(JSON.parse(raw)):null;},
    openCopy:value=>installDesk(value),describeCopy:value=>'Original case '+value.caseId+
      (value.pending?' · retained '+value.pending.body.action+' · '+value.pending.body.requestId:' · complete editable allocations'),
    downloadCopy:value=>download(JSON.stringify(value,null,2)+'\n','Issued_Expense_Earlier_Desk.json','application/json'),
    isBusy:()=>initializing||busy||hostBusy||Boolean(session.inFlight)||!initialized,
    setDeskBusy:value=>{busy=value;if(value)sync();else render();},
    filename:'Issued_Expense_Earlier_Desk.json'});
  function dispose(){
    if(initialized)storeDraft();active=false;earlier.dispose();if(session.notify===render)session.notify=null;
    Promise.allSettled([session.inFlight,session.initializing]).then(()=>storageSerial).then(async()=>{
      if(databasePromise){const db=await databasePromise;db.close();databasePromise=null;}
    }).catch(()=>{});
  }
  session.notify=render;render();
  const ready=(async()=>{
    await storageSerial;if(!live())return;
    storageSequence=session.storageSequence??storageSequence;
    if(!initialized){
      if(!session.initializing)session.initializing=(async()=>{
        const saved=await readStored('desks',current.program.id);
        if(saved)return checkDesk(saved);
        const raw=localStorage.getItem(key);return raw?checkDesk(JSON.parse(raw)):null;
      })();
      const opening=session.initializing;
      let saved;
      try{saved=await opening;}
      catch(error){if(live()&&session.initializing===opening){session.initializing=null;initialized=true;session.loaded=true;render();message(error.message,true);}throw error;}
      if(!live()||session.initializing!==opening)return;
      session.initializing=null;
      if(saved){
        for(const name of persistedFields)if(Object.hasOwn(saved,name))session[name]=copy(saved[name]);
        storageSequence=saved.storageSequence??0;session.storageSequence=storageSequence;
        session.file=copy(saved.file??null);
        session.message=session.pending?'The complete original request is retained. Reconcile its exact receipt.':'Complete expense selections reopened.';
      }
      session.page??=0;session.filter??='';session.note??='';
      initialized=true;session.loaded=true;
    }
    if(!live())return;
    if(!session.draft&&selected())selectDraft(selected(),currentRecord());
    render();
    try{await restoreSelectedSource();}catch(error){if(live())message(error.message,true);}
    if(!live())return;
    if(session.inFlight){try{await session.inFlight;}catch{}return;}
    if(session.pending){
      busy=true;onBusy(true);sync();
      try{await reconcileOnly();}catch(error){if(live())message(error.message,true);}
      finally{busy=false;onBusy(false);sync();}
    }
  })().finally(()=>{initializing=false;if(live())sync();});
  return {root,ready,dispose,setHostBusy};
}
