// Atomic current drafts and complete conflicting-tab recovery in the Staff-scoped Statements database.
const clone=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(value,message)=>{if(!value)throw new Error(message);};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const indexKey=caseId=>'statement-tab-recoveries:'+caseId;
const recordKey=(caseId,id)=>indexKey(caseId)+':'+id;
const idPattern=/^statement-tab-[a-zA-Z0-9-]{1,100}$/;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const statementDraftToken=value=>JSON.stringify(value??null);
export function statementDraftRequest(value){
  const states=[['PENDING',value?.pending],['ACCEPTED',value?.accepted],['SETUP',value?.setupPending]].filter(([,v])=>v);
  return states.map(([state,v])=>({state,requestId:v.payload?.requestId||null,action:v.payload?.action||null,payload:clone(v.payload||null),result:clone(v.result||null)}));
}
export function statementDraftSummary(value){
  const inputs=value?.inputs||{},requests=statementDraftRequest(value);
  return {filename:inputs.source?.filename||'No file selected',accountId:inputs.accountId||'',accountLabel:inputs.accountLabel||'',currency:inputs.currency||'',
    format:inputs.sourceFormat||'CSV',decisions:(inputs.decisions||[]).length,allocationRows:Object.keys(value?.allocationWorks||{}).length,
    state:requests.map(row=>row.state).join(', ')||'EDITABLE',requestIds:requests.map(row=>row.requestId).join(', '),revision:value?._storedRevision??0};
}
export function validateStatementDraft(value,caseId){
  need(object(value)&&value.schema==='sf47.statement-draft.v1'&&value.caseId===caseId&&object(value.inputs),'Choose a complete statement draft for this original case.');
  need(value.inputs.decisions===undefined||Array.isArray(value.inputs.decisions),'The statement decisions are incomplete.');
  need(statementDraftRequest(value).length<=1,'The original draft contains conflicting pending request states.');
  return clone(value);
}
function indexValue(value,caseId){
  if(value===undefined||value===null)return {schema:'sf47.statement-tab-recovery-index.v1',caseId,records:[]};
  need(value.schema==='sf47.statement-tab-recovery-index.v1'&&value.caseId===caseId&&Array.isArray(value.records),'The retained tab-recovery list is incomplete.');
  const ids=new Set();
  for(const row of value.records){need(idPattern.test(row.id||'')&&!ids.has(row.id),'The retained tab-recovery list repeats an identity.');ids.add(row.id);}
  return clone(value);
}
function recordValue(value,caseId){
  need(object(value)&&value.schema==='sf47.statement-tab-recovery.v1'&&value.caseId===caseId&&idPattern.test(value.id||''),'Choose a complete tab-recovery record for this case.');
  need(typeof value.savedAt==='string'&&Number.isFinite(Date.parse(value.savedAt))&&typeof value.reason==='string'&&value.reason.length<=2000,'The tab-recovery attribution is incomplete.');
  validateStatementDraft(value.local,caseId);if(value.shared!==null)validateStatementDraft(value.shared,caseId);
  if(Object.hasOwn(value,'rawShared'))need(value.shared===null,'An unreadable original stays separate from the validated shared draft.');
  return clone(value);
}
export function validateStatementDraftArchive(value,caseId){
  need(object(value)&&value.schema==='sf47.statement-tab-recovery-archive.v1'&&value.caseId===caseId&&Array.isArray(value.records),'Choose the complete tab-recovery archive for this original case.');
  need(idPattern.test(value.currentRecordId||'')&&typeof value.exportedAt==='string'&&Number.isFinite(Date.parse(value.exportedAt)),'The complete archive needs its original current-draft identity and export time.');
  const current=validateStatementDraft(value.current,caseId),seen=new Set(),records=value.records.map(row=>{
    const record=recordValue(row,caseId);need(!seen.has(record.id),'The recovery archive repeats a record.');seen.add(record.id);return record;
  });
  return {schema:value.schema,caseId,currentRecordId:value.currentRecordId,exportedAt:value.exportedAt,current,records};
}
export function statementDraftResolution(local,shared,choice){
  need(choice==='SHARED'||choice==='LOCAL','Choose this tab or the shared draft explicitly.');
  const caseId=local.caseId;validateStatementDraft(local,caseId);if(shared!==null)validateStatementDraft(shared,caseId);
  if(choice==='LOCAL')need(!statementDraftRequest(local).length&&!statementDraftRequest(shared).length,'Open the shared draft and reconcile its original request first. Preserve this tab as a recovery copy; pending or accepted requests cannot be replaced.');
  else need(shared!==null,'There is no saved shared draft to open.');
  return clone(choice==='LOCAL'?local:shared);
}
export function createStatementDraftAccess(database){
  const transact=async(key,mode,work)=>{
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts',mode),store=tx.objectStore('drafts');let result,problem;
      const fail=error=>{problem=error;try{tx.abort();}catch{}};
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(problem||tx.error||new Error('The complete statement draft could not be retained.'));
      tx.onabort=()=>reject(problem||tx.error||new Error('The statement draft transaction did not complete.'));
      const request=store.get(key);request.onerror=()=>fail(request.error);
      request.onsuccess=()=>{try{work(store,request.result,value=>{result=value;},fail);}catch(error){fail(error);}};
    });
  };
  const read=key=>transact(key,'readonly',(_store,value,done)=>done(value??null));
  function retain(store,caseId,local,shared,meta,done,fail){
    const record=recordValue({schema:'sf47.statement-tab-recovery.v1',caseId,id:meta.id,savedAt:meta.savedAt,reason:meta.reason,local:clone(local),shared:clone(shared??null),...(Object.hasOwn(meta,'rawShared')?{rawShared:clone(meta.rawShared)}:{})},caseId);
    const request=store.get(indexKey(caseId));request.onerror=()=>fail(request.error);
    request.onsuccess=()=>{try{
      const index=indexValue(request.result,caseId),existing=store.get(recordKey(caseId,record.id));existing.onerror=()=>fail(existing.error);
      existing.onsuccess=()=>{try{
        if(existing.result)need(same(existing.result,record),'An existing tab-recovery identity contains different complete content.');
        else{
          need(index.records.length<10000,'Download the complete recovery archive before retaining more than 10,000 tab conflicts.');
          store.add(record,recordKey(caseId,record.id));
          index.records.push({id:record.id,savedAt:record.savedAt,reason:record.reason,local:statementDraftSummary(record.local),shared:statementDraftSummary(record.shared)});
          store.put(index,indexKey(caseId));
        }
        done(record);
      }catch(error){fail(error);}};
    }catch(error){fail(error);}};
  }
  read.write=(key,value,expectedToken,meta)=>transact(key,'readwrite',(store,previous,done,fail)=>{
    validateStatementDraft(value,key);need(typeof expectedToken==='string','Read the current browser draft before saving it.');
    const token=statementDraftToken(previous);
    if(token!==expectedToken){retain(store,key,value,previous,meta,record=>done({saved:false,record,current:clone(previous??null),token}),fail);return;}
    const revision=(Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0)+1;
    const next={...clone(value),_storedRevision:revision};store.put(next,key);done({saved:true,token:statementDraftToken(next),revision});
  });
  read.resolve=(key,local,reviewedShared,choice,meta)=>transact(key,'readwrite',(store,previous,done,fail)=>{
    need(statementDraftToken(previous)===statementDraftToken(reviewedShared),'The shared draft changed after this comparison. Refresh the comparison and choose again.');
    const selected=statementDraftResolution(local,previous??null,choice);
    retain(store,key,local,previous,meta,record=>{
      if(choice==='LOCAL'){
        const revision=(Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0)+1;
        const next={...selected,_storedRevision:revision};store.put(next,key);
        done({value:next,token:statementDraftToken(next),record});
      }else done({value:selected,token:statementDraftToken(previous),record});
    },fail);
  });
  read.repair=(key,value,unreadable,meta)=>transact(key,'readwrite',(store,previous,done,fail)=>{
    validateStatementDraft(value,key);
    need(statementDraftToken(previous)===statementDraftToken(unreadable),'The saved original changed. Read the shared draft again before receiving a repaired copy.');
    need(same(statementDraftRequest(previous),statementDraftRequest(value)),'A repaired copy must retain the exact original pending or accepted request and result. Repair interpretation fields without removing or replacing a request.');
    retain(store,key,value,null,{...meta,rawShared:clone(previous)},record=>{
      const revision=(Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0)+1,next={...clone(value),_storedRevision:revision};
      store.put(next,key);done({value:next,token:statementDraftToken(next),record});
    },fail);
  });
  read.list=caseId=>transact(indexKey(caseId),'readonly',(_store,value,done)=>done(indexValue(value,caseId)));
  read.record=(caseId,id)=>{need(idPattern.test(id||''),'Choose an original tab-recovery identity.');return transact(recordKey(caseId,id),'readonly',(_store,value,done)=>done(recordValue(value,caseId)));};
  read.archive=async(caseId,current)=>{
    validateStatementDraft(current,caseId);
    const index=await read.list(caseId),records=[];
    for(const row of index.records)records.push(await read.record(caseId,row.id));
    return validateStatementDraftArchive({schema:'sf47.statement-tab-recovery-archive.v1',caseId,currentRecordId:'statement-tab-'+crypto.randomUUID(),exportedAt:new Date().toISOString(),current:clone(current),records},caseId);
  };
  read.importArchive=(caseId,value)=>{
    const archive=validateStatementDraftArchive(value,caseId);
    const incoming=[...archive.records,{schema:'sf47.statement-tab-recovery.v1',caseId,id:archive.currentRecordId,savedAt:archive.exportedAt,reason:'Current draft supplied with the complete imported tab-recovery archive',local:archive.current,shared:null}];
    const identities=new Map();for(const row of incoming){const prior=identities.get(row.id);need(!prior||same(prior,row),'The archive current-draft identity conflicts with an original recovery record.');identities.set(row.id,row);}
    const records=[...identities.values()];
    return transact(indexKey(caseId),'readwrite',(store,previous,done,fail)=>{
      const index=indexValue(previous,caseId);let position=0,added=0;
      const next=()=>{
        if(position>=records.length){store.put(index,indexKey(caseId));done({index,added,current:archive.current});return;}
        const record=records[position++],request=store.get(recordKey(caseId,record.id));request.onerror=()=>fail(request.error);
        request.onsuccess=()=>{try{
          if(request.result)need(same(request.result,record),'The imported tab-recovery identity differs from its complete retained record.');
          else{
            need(index.records.length<10000,'The complete archive exceeds 10,000 tab-recovery records.');
            store.add(record,recordKey(caseId,record.id));
            index.records.push({id:record.id,savedAt:record.savedAt,reason:record.reason,local:statementDraftSummary(record.local),shared:statementDraftSummary(record.shared)});added++;
          }
          next();
        }catch(error){fail(error);}};
      };next();
    });
  };
  return read;
}
export function compareStatementDrafts(local,shared){
  const before=statementDraftSummary(local),after=statementDraftSummary(shared);
  const rows=Object.keys(before).map(key=>({key,before:before[key],after:after[key],changed:!same(before[key],after[key])}));
  const details=[];
  for(const key of [...new Set([...Object.keys(local||{}),...Object.keys(shared||{})])].filter(key=>key!=='_storedRevision')){
    const a=local?.[key]??null,b=shared?.[key]??null;
    if(same(a,b))continue;
    if(key==='inputs'){
      for(const field of [...new Set([...Object.keys(a||{}),...Object.keys(b||{})])]){
        if(same(a?.[field],b?.[field]))continue;
        if(field==='source'){
          const clean=value=>value?{...value,contentBase64:value.contentBase64?'Complete original bytes retained; download this draft to inspect. Encoded characters: '+value.contentBase64.length:null}:null;
          details.push({label:'Original source (full bytes differ: '+String(a?.source?.contentBase64!==b?.source?.contentBase64)+')',before:clean(a?.source),after:clean(b?.source)});
        }else if(field==='decisions'){
          const keys=[...new Set([...(a?.decisions||[]).map(row=>row.rowNumber),...(b?.decisions||[]).map(row=>row.rowNumber)])];
          for(const number of keys){const x=a?.decisions?.find(row=>row.rowNumber===number)??null,y=b?.decisions?.find(row=>row.rowNumber===number)??null;if(!same(x,y))details.push({label:'Source row '+number+' decision',before:x,after:y});}
        }else details.push({label:'Statement '+field,before:a?.[field]??null,after:b?.[field]??null});
      }
    }else if(key==='allocationWorks'){
      for(const number of [...new Set([...Object.keys(a||{}),...Object.keys(b||{})])])if(!same(a?.[number],b?.[number]))details.push({label:'Unfinished invoice row '+number,before:a?.[number]??null,after:b?.[number]??null});
    }else details.push({label:key,before:a,after:b});
  }
  return {rows,details};
}
const button=(title,action,disabled=false,attrs='')=>'<button type="button" data-statement-action="'+action+'" data-statement-recovery="true" data-statement-draft-recovery="true" '+attrs+(disabled?' disabled data-statement-fixed="true"':'')+'>'+esc(title)+'</button>';
function safeDetails(value){
  if(Array.isArray(value))return value.map(safeDetails);
  if(!object(value))return value;
  return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,key==='contentBase64'&&typeof child==='string'?'Complete original bytes retained in recovery download ('+child.length+' encoded characters).':safeDetails(child)]));
}
export function statementDraftRecoveryPanel({local,shared,conflict=false,comparisonReady=false,index,page=0,detailPage=0,selected=null}){
  const list=index?.records||[],pages=Math.max(1,Math.ceil(list.length/20)),p=Math.max(0,Math.min(page,pages-1));
  const comparison=comparisonReady?compareStatementDrafts(local,shared):null,details=comparison?.details||[],dp=Math.max(0,Math.min(detailPage,Math.max(0,Math.ceil(details.length/10)-1)));
  const summary=value=>{const row=statementDraftSummary(value);return esc(row.filename)+' · '+esc(row.accountLabel||row.accountId||'Account not selected')+' · '+esc(row.state)+(row.requestIds?' · '+esc(row.requestIds):'');};
  return '<section class="statement-panel" aria-label="Concurrent statement draft recovery"><h4>Statement drafts in this browser</h4>'+
    (conflict?'<p class="statement-error" role="alert">Another tab saved a different current draft. This tab keeps its full work. Its recovery record was retained without replacing the shared draft. Compare both before continuing.</p>':'<p>The current draft belongs to this case and Staff identity. Writes compare the complete last-read draft atomically. Conflicting tab work remains available below.</p>')+
    '<div class="statement-actions">'+button('Compare with shared draft','draft-sync')+button('Download this tab','draft-export')+button('Download complete tab recovery archive','draft-conflict-export')+button('Open tab recovery archive','draft-conflict-import')+'</div>'+
    (comparison?'<h5>This tab and the shared draft</h5><div class="statement-table"><table><thead><tr><th>Field</th><th>This tab</th><th>Shared draft</th><th>Difference</th></tr></thead><tbody>'+comparison.rows.map(row=>'<tr><th scope="row">'+esc(row.key)+'</th><td>'+esc(row.before)+'</td><td>'+esc(row.after)+'</td><td>'+(row.changed?'Changed':'Same')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p>'+details.length+' changed sections. Every complete original source and pending payload is included in the draft downloads.</p>'+
      details.slice(dp*10,(dp+1)*10).map(row=>'<details><summary>'+esc(row.label)+'</summary><h6>This tab</h6><pre>'+esc(JSON.stringify(safeDetails(row.before),null,2))+'</pre><h6>Shared draft</h6><pre>'+esc(JSON.stringify(safeDetails(row.after),null,2))+'</pre></details>').join('')+
      '<div class="statement-actions">'+button('Previous differences','draft-detail-previous',dp===0)+button('Next differences','draft-detail-next',(dp+1)*10>=details.length)+button('Download compared shared draft','draft-shared-export',!shared)+button('Preserve this tab and open shared draft','draft-use-shared',!shared)+button('Preserve shared draft and continue this tab','draft-use-local',!!statementDraftRequest(local).length||!!statementDraftRequest(shared).length)+'</div>'+
      '<p>Both complete versions are saved as a recovery record before switching. A pending or accepted request must be resumed from its exact shared draft; it cannot be replaced with another draft.</p>':'')+
    '<h5>Retained tab conflicts and recovery choices</h5>'+
    (list.length?'<div class="statement-table"><table><thead><tr><th>Saved / reason</th><th>Local source / account</th><th>Shared source / account</th><th>Open record</th></tr></thead><tbody>'+
      list.slice(p*20,(p+1)*20).map(row=>'<tr><td>'+esc(row.savedAt)+'<small>'+esc(row.reason)+'</small></td><td>'+esc(row.local.filename)+'<small>'+esc(row.local.accountLabel||row.local.accountId)+' · '+esc(row.local.state)+'</small></td><td>'+esc(row.shared.filename)+'<small>'+esc(row.shared.accountLabel||row.shared.accountId)+' · '+esc(row.shared.state)+'</small></td><td>'+button('Inspect retained pair','draft-conflict-select',false,'data-record="'+esc(row.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No tab-conflict recovery records are retained yet.</p>')+
    '<div class="statement-actions">'+button('Previous recovery records','draft-conflict-previous',p===0)+'<span>Page '+(p+1)+' of '+pages+' · '+list.length+' complete records</span>'+button('Next recovery records','draft-conflict-next',p+1>=pages)+'</div>'+
    (selected?'<h5>Selected recovery record</h5><p>'+esc(selected.savedAt)+' · '+esc(selected.reason)+'</p><p><strong>Local:</strong> '+summary(selected.local)+'</p><p><strong>Shared:</strong> '+summary(selected.shared)+'</p>'+
      '<div class="statement-actions">'+button('Download retained local draft','draft-conflict-local-export')+button('Download retained shared draft','draft-conflict-shared-export',!selected.shared)+(Object.hasOwn(selected,'rawShared')?button('Download preserved unreadable original','draft-raw-record-export'):'')+button('Open retained local draft','draft-conflict-open',conflict||!!statementDraftRequest(local).length)+'</div><p>Opening uses the original recovery reader, keeps the current draft as a named complete edition, and requires fresh native preview. Retained native requests keep their exact request identity.</p>':'')+'</section>';
}
