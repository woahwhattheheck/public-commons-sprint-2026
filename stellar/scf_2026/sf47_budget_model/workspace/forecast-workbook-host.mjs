// MIT. Original Forecast workbook source, preview and interrupted-request continuation.
import { signature, validateForecastWorkbookReturn, reconcileForecastWorkbook, receiveForecastWorkbook } from './forecast-workbook.mjs';

const draftStoreQueues=new Map();
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>signature(a)===signature(b);
const failure=message=>{throw new Error(message);};
const options=current=>({caseId:current.program.id,originCaseId:current.program.origin?.programId,
  planContentSha256:current.plan.contentSha256});
const terminal=error=>Number.isInteger(error?.status)&&error.status>=400&&error.status<500&&
  ![401,403,408,425,429].includes(error.status);
export const FORECAST_DRAFT_SCHEMA='stellar-forge.forecast-working-session.v1';


export function validateForecastDraftInputs(value){
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const check=(yes,message)=>{if(!yes)throw new Error(message);};
  function safe(v,depth=0){
    check(depth<48,'Retain the original forecast draft within its supported nesting.');
    if(Array.isArray(v)){check(v.length<=20000,'A forecast draft list is too large.');v.forEach(x=>safe(x,depth+1));}
    else if(object(v)){for(const [key,x] of Object.entries(v)){check(!['__proto__','constructor','prototype'].includes(key),'Use ordinary forecast draft fields.');safe(x,depth+1);}}
    else check(v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=100000||typeof v==='number'&&Number.isFinite(v),'Retain the original draft as ordinary JSON values.');
  }
  safe(value);check(object(value),'Retain a complete forecast draft.');
  const strings=(v,keys)=>keys.every(key=>typeof v[key]==='string');
  const array=(v,key)=>Array.isArray(v[key]);
  const ids=(v,key)=>array(v,key)&&v[key].every(x=>typeof x==='string');
  const optional=v=>v===null||typeof v==='string'||typeof v==='number'&&Number.isFinite(v);
  const rows=(name,key,limit)=>{
    check(array(value,name)&&value[name].length<=limit,'Retain the complete '+name+' draft rows.');
    const seen=new Set();
    for(const row of value[name]){check(object(row)&&typeof row[key]==='string'&&row[key]&&!seen.has(row[key]),'Keep unique original '+name+' identities.');seen.add(row[key]);}
    return value[name];
  };
  check(strings(value,['name','asOfDate','calendarStart','note'])&&object(value.openingCash)&&object(value.capacity),'Retain the original forecast headings, opening cash and capacity.');
  check(strings(value.openingCash,['basis','note'])&&ids(value.openingCash,'sourceIds')&&optional(value.openingCash.amountUsd),'Retain the complete opening-cash draft.');
  check(strings(value.capacity,['note'])&&optional(value.capacity.weeklyHours),'Retain the complete capacity draft.');
  for(const row of rows('packageOverrides','costId',5000)){
    check(['remainingCostUsd','remainingHours','startDate','endDate'].every(k=>row[k]===undefined||optional(row[k]))&&
      (row.directCashIds===undefined||ids(row,'directCashIds'))&&(row.note===undefined||typeof row.note==='string'),
      'Retain every original package estimate and source selection.');
  }
  for(const row of rows('invoiceOverrides','invoiceId',5000))
    check((row.dueDate===undefined||optional(row.dueDate))&&(row.include===undefined||typeof row.include==='boolean')&&
      (row.note===undefined||typeof row.note==='string'),'Retain complete invoice timing drafts.');
  check(array(value,'grantReceipts')&&value.grantReceipts.length<=5000,'Retain original grant receipt drafts.');
  for(const row of value.grantReceipts)check(object(row)&&Number.isSafeInteger(row.tranche)&&
    (row.date===undefined||optional(row.date))&&(row.include===undefined||typeof row.include==='boolean')&&
    (row.note===undefined||typeof row.note==='string'),'Retain complete grant receipt timing drafts.');
  for(const row of rows('commercial','id',50)){
    check(strings(row,['title','caseRef','stage','paymentMode','sourceUrl','scope','note'])&&typeof row.selected==='boolean'&&
      ['sourceIds','cashIds','invoiceIds','directCashIds'].every(k=>ids(row,k))&&
      ['remainingHours','startDate','endDate'].every(k=>optional(row[k]))&&array(row,'receipts')&&row.receipts.length<=30,
      'Retain every customer project, milestone and original source selection.');
    for(const receipt of row.receipts)check(object(receipt)&&strings(receipt,['id','label'])&&optional(receipt.date)&&
      (optional(receipt.amountUsd)||optional(receipt.amountNative)),'Retain the complete customer receipt drafts.');
    if(row.nativePricing!==undefined){
      const native=row.nativePricing;check(object(native)&&object(native.price)&&object(native.deliveryCost)&&
        array(native,'priceCredits')&&array(native,'costCredits'),'Retain the original native pricing draft.');
      for(const money of [native.price,native.deliveryCost])check(optional(money.amount)&&typeof money.currency==='string'&&
        (money.fxRateId===undefined||money.fxRateId===null||typeof money.fxRateId==='string'),'Retain original native amounts and rate selections.');
      for(const credit of [...native.priceCredits,...native.costCredits])check(object(credit)&&optional(credit.amount)&&typeof credit.note==='string','Retain original unfinished credit amounts and basis text.');
    }else check(optional(row.priceUsd)&&optional(row.totalDeliveryCostUsd),'Retain original USD amount drafts.');
    if(row.timing!==undefined)check(object(row.timing)&&row.timing.mode==='EVENT_DEPENDENT'&&
      typeof row.timing.startCondition==='string'&&optional(row.timing.reviewedReleaseDate)&&
      optional(row.timing.deliveryBusinessDays)&&array(row.timing,'receiptConditions')&&
      row.timing.receiptConditions.every(x=>object(x)&&strings(x,['receiptId','condition'])),'Retain complete original event-dependent terms.');
  }
  if(Object.hasOwn(value,'customerFunding')){
    const f=value.customerFunding,customerIds=new Set(value.commercial.map(row=>row.id));
    check(object(f)&&Object.keys(f).every(k=>['enabled','opening','note'].includes(k))&&typeof f.enabled==='boolean'&&typeof f.note==='string'&&f.note.length<=8000&&
      Array.isArray(f.opening)&&f.opening.length<=50,'Retain the complete customer funding policy and opening attributions.');
    const seen=new Set();
    for(const row of f.opening){
      check(object(row)&&Object.keys(row).every(k=>['commercialId','amountUsd','basis','cashIds','sourceIds','note'].includes(k))&&
        typeof row.commercialId==='string'&&customerIds.has(row.commercialId)&&!seen.has(row.commercialId)&&optional(row.amountUsd)&&
        ['NOT_ENTERED','OBSERVED_BALANCE','PLANNING_ASSUMPTION'].includes(row.basis)&&ids(row,'cashIds')&&ids(row,'sourceIds')&&
        typeof row.note==='string'&&row.note.length<=4000,'Retain each original customer attribution, partial amount, basis and evidence.');
      seen.add(row.commercialId);
    }
  }
  if(value.fxRates!==undefined){
    check(array(value,'fxRates')&&value.fxRates.length<=5000,'Retain the original exchange-rate drafts.');
    for(const row of value.fxRates)check(object(row)&&strings(row,['id','baseCurrency','quoteCurrency','rate','observationDate',
      'basis','rounding','sourceUrl','sourceReference','note'])&&ids(row,'sourceIds')&&optional(row.publicationDate),
      'Retain complete original exchange-rate fields and sources.');
  }
  return clone(value);
}

// IndexedDB retains a complete permitted source beyond sessionStorage's smaller quota.
// A source command is sent only after this complete journal has been durably written.
export function createForecastDraftStore(key,{indexedDB=globalThis.indexedDB}={}){
  let database=null,opening=null,queue=draftStoreQueues.get(key)||Promise.resolve(),closed=false,revision=null;
  function open(){
    if(closed)return Promise.reject(new Error('The original forecast draft store is closed.'));
    if(database)return Promise.resolve(database);
    if(opening)return opening;
    if(!indexedDB)return Promise.reject(new Error('This browser cannot retain the complete working forecast. Use a browser with IndexedDB and reopen the complete working file.'));
    opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('sf47-forecast-working-sessions',1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('sessions'))request.result.createObjectStore('sessions');};
      request.onerror=()=>{opening=null;reject(request.error||new Error('The forecast working store could not open.'));};
      request.onblocked=()=>{opening=null;reject(new Error('Close the older forecast store connection and reopen this original desk.'));};
      request.onsuccess=()=>{if(closed){request.result.close();reject(new Error('The original forecast desk closed.'));return;}
        database=request.result;database.onversionchange=()=>{database.close();database=null;opening=null;};resolve(database);};
    });
    return opening;
  }
  async function transaction(mode,operation){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('sessions',mode);let value;
      tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(tx.error||new Error('The complete forecast draft could not be retained.'));
      const request=operation(tx.objectStore('sessions'));
      if(request)request.onsuccess=()=>{value=request.result;};
    });
  }
  return {
    async read(){
      await (draftStoreQueues.get(key)||queue).catch(()=>{});
      const row=await transaction('readonly',s=>s.get(key));
      revision=row?.revision??0;return row?.value;
    },
    write(value){
      const retained=clone(value);
      const task=(draftStoreQueues.get(key)||queue).catch(()=>{}).then(async()=>{
        if(revision===null)throw new Error('Open the original retained forecast before saving its working state.');
        const db=await open();
        return new Promise((resolve,reject)=>{
          const tx=db.transaction('sessions','readwrite'),store=tx.objectStore('sessions');let problem=null,nextRevision;
          tx.oncomplete=()=>{revision=nextRevision;resolve();};
          tx.onabort=tx.onerror=()=>reject(problem||tx.error||new Error('The complete forecast draft could not be retained.'));
          const current=store.get(key);
          current.onsuccess=()=>{
            if((current.result?.revision??0)!==revision){
              problem=new Error('Another page changed this working forecast. Download this complete working file, then reopen the selected original case.');tx.abort();return;
            }
            nextRevision=revision+1;store.put({revision:nextRevision,value:retained},key);
          };
        });
      });
      queue=task;draftStoreQueues.set(key,task);return task;
    },
    flush(){return queue;},
    async close(){await queue.catch(()=>{});closed=true;if(database)database.close();database=null;}
  };
}

export function createForecastWorkbookHost({getCurrent,getInputs,api,mutationId,recordingActor,
    getJournal,setJournal,persist,adopt,onCase,available=()=>true}){
  const requireActive=()=>{if(!available())failure('Reopen this original forecast to continue its retained workbook request.');};
  async function validateSelection(value,{reinspect=false}={}){
    if(!value||typeof value!=='object'||!value.review||typeof value.expectedCurrentSignature!=='string')
      failure('Retain the complete reviewed workbook selection and original draft.');
    const review=value.review;
    let received=await validateForecastWorkbookReturn(review.received,options(getCurrent()));
    if(reinspect&&received.transport==='xlsx'){
      const replay=await receiveForecastWorkbook(received.source,{...options(getCurrent()),receivedAt:received.receivedAt,
        inspectWorkbook:body=>api('/api/source-tables/workbook/inspect',body),
        projectWorkbook:body=>api('/api/source-tables/workbook/project',body)});
      if(!same(replay.baseInputs,received.baseInputs)||!same(replay.returnedInputs,received.returnedInputs))
        failure('The restored workbook review differs from its original native worksheet cells. Receive the same complete workbook again.');
      received=replay;
    }
    if(!same(value.source,received.source)||!same(review.reviewedInputs,value.inputs)||
       signature(review.beforeInputs)!==value.expectedCurrentSignature)
      failure('The reviewed workbook source or original draft differs from its retained selection.');
    if(typeof review.note!=='string'||!review.note.trim()||review.note.length>12000)
      failure('Enter the source and review note for these forecast assumptions.');
    const result=reconcileForecastWorkbook(received,review.beforeInputs,review.choices||{});
    if(result.unresolved||!same(result.inputs,value.inputs))
      failure('Complete every original workbook decision before applying these assumptions.');
    return clone({...value,review:{...review,received}});
  }
  async function validateJournal(journal,{reinspect=false}={}){
    if(!journal)return null;
    if(journal.caseId!==getCurrent().program.id||!['SOURCE_PENDING','SOURCE_SAVED'].includes(journal.stage))
      failure('Recover the complete source request in its original forecast case.');
    const selected=await validateSelection(journal.selection,{reinspect}),request=journal.request;
    if(request){
      const source=selected.source;
      if(request.action!=='source.add'||!Number.isSafeInteger(request.expectedVersion)||request.expectedVersion<1||
        typeof request.requestId!=='string'||!request.requestId||
        typeof request.actor!=='string'||!request.actor.trim()||request.note!==selected.review.note||
        !same(request.data,{filename:source.filename,contentBase64:source.dataBase64,kind:'other',
          mediaType:source.mediaType,sourceUrl:'',observedAt:selected.review.received.receivedAt}))
        failure('Retain the exact original workbook source request before recovering it.');
    }else if(journal.stage!=='SOURCE_SAVED')failure('The source request body is missing.');
    if(journal.receipt){
      const r=journal.receipt;
      if(!/^source-[a-f0-9]{32}$/.test(r.id)||r.sha256!==selected.source.sha256||
        !Number.isSafeInteger(r.version)||r.version<1)
        failure('The original workbook source receipt is incomplete.');
    }else if(journal.stage==='SOURCE_SAVED')failure('The saved workbook source receipt is missing.');
    return clone({...journal,selection:selected});
  }
  function matchingSource(current,source){
    return current.sources.find(row=>row.sha256===source.sha256&&row.bytes===source.bytes&&
      row.filename===source.filename&&row.mediaType===source.mediaType);
  }
  async function retain(journal){setJournal(journal);await persist();}
  async function finish(journal){
    requireActive();
    if(journal.stage==='SOURCE_PENDING'){
      let result;
      try{result=await api('/api/operations/'+journal.caseId+'/command',clone(journal.request));}
      catch(error){
        if(terminal(error)&&getJournal()===journal){
          journal.rejection={status:error.status,code:error.code||'',message:error.message};
          // Keep the exact rejected request in the completed review for inspection;
          // a corrected version starts only through a fresh explicit review.
          setJournal(null,{failedSource:clone(journal)});await persist();
          const refreshed=await api('/api/operations/'+journal.caseId);requireActive();onCase(refreshed);
        }
        throw error;
      }
      if(!/^source-[a-f0-9]{32}$/.test(result?.recordId)||!Number.isSafeInteger(result?.version))
        failure('The source reply has no complete original identity. Recover the same retained request.');
      journal.receipt={id:result.recordId,version:result.version,requestId:journal.request.requestId,
        sha256:journal.selection.source.sha256};
      journal.stage='SOURCE_SAVED';await retain(journal);
    }
    requireActive();
    const current=await api('/api/operations/'+journal.caseId);
    requireActive();
    const original=matchingSource(current,journal.selection.source);
    if(!original||original.id!==journal.receipt.id)
      failure('The current case does not contain the exact saved workbook source. Keep this original request and reopen its case.');
    onCase(current);
    const previous=clone(getInputs());
    if(signature(previous)!==journal.selection.expectedCurrentSignature){
      setJournal(null,{savedSource:clone(journal)});await persist();
      return {adopted:false,inputs:previous,sourceReceipt:clone(journal.receipt),
        message:'The original workbook is saved. The current draft also changed; review those changes before applying it.'};
    }
    const preview=await api('/api/operations/'+journal.caseId+'/forecast-preview',
      {expectedVersion:current.program.version,inputs:clone(journal.selection.inputs)});
    requireActive();
    if(signature(getInputs())!==journal.selection.expectedCurrentSignature)
      failure('The current forecast changed during preview. Recover this saved-source review against the original draft.');
    // Native normalization is authoritative; original edited values and decisions
    // remain in the complete workbook review alongside these normalized inputs.
    await adopt({inputs:clone(preview.inputs),preview,sourceReceipt:clone(journal.receipt),
      review:clone(journal.selection.review)});
    setJournal(null,{appliedSource:clone(journal)});await persist();
    return {adopted:true,inputs:clone(preview.inputs),sourceReceipt:clone(journal.receipt),preview};
  }
  return {
    validateSelection,validateJournal,
    async apply(value){
      requireActive();if(getJournal())failure('Recover the retained original workbook source request first.');
      const selected=await validateSelection(value);requireActive();
      if(getCurrent().program.state==='CLOSED')failure('Reopen the original case before retaining a workbook source.');
      if(signature(getInputs())!==selected.expectedCurrentSignature)
        failure('The current forecast changed while the returned source was read. Review the current draft again.');
      const current=getCurrent(),existing=matchingSource(current,selected.source);
      let journal={caseId:current.program.id,stage:existing?'SOURCE_SAVED':'SOURCE_PENDING',
        selection:selected,request:null,receipt:existing?{id:existing.id,version:current.program.version,
          requestId:null,sha256:existing.sha256}:null};
      if(!existing){
        if(current.sources.length>=200||current.sources.reduce((sum,row)=>sum+row.bytes,0)+selected.source.bytes>24*1024*1024)
          failure('This case reached its complete-source allowance. Retain the working file and use the original case source workflow.');
        const source=selected.source;
        const request={expectedVersion:current.program.version,actor:recordingActor(),note:selected.review.note,
          action:'source.add',data:{filename:source.filename,contentBase64:source.dataBase64,kind:'other',
            mediaType:source.mediaType,sourceUrl:'',observedAt:selected.review.received.receivedAt}};
        request.requestId=await mutationId('forecast-workbook:'+current.program.id,request);requireActive();
        if(signature(getInputs())!==selected.expectedCurrentSignature)
          failure('The original draft changed before its source request. Review it again.');
        journal.request=request;
      }
      await retain(journal);requireActive();return finish(journal);
    },
    async resume(){
      requireActive();const original=getJournal();if(!original)failure('There is no retained workbook source request.');
      const validated=await validateJournal(original,{reinspect:true});requireActive();
      if(getJournal()!==original)failure('The selected workbook continuation changed during recovery.');
      setJournal(validated);await persist();return finish(validated);
    }
  };
}
