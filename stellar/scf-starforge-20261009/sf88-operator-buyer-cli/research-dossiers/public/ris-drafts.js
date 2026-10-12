// MIT. Browser-only draft/pending custody for the original Research RIS review.
const DATABASE='research-ris-review-v1',VERSION=1,MAX_PENDING_BYTES=48*1024*1024;
let opened;
const clone=value=>structuredClone(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const canonical=value=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
};
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=240&&!/[\u0000-\u001f]/.test(value);
const checked=(value,{pending=false}={})=>{
  // Complete draft history has no smaller artificial limit than its recovery
  // file. Actual browser quota failures retain the full unacknowledged branch.
  if(pending&&new TextEncoder().encode(canonical(value)).length>MAX_PENDING_BYTES)
    fail('RIS_PENDING_REQUEST_TOO_LARGE');
  return clone(value);
};
export async function assertRisReceipt(result,{workspaceId,dossierId,requestId,body}){
  const receipt=result?.receipt;
  if(!validId(workspaceId)||result?.dossier?.id!==dossierId||body?.review?.requestId!==requestId||
    receipt?.schema!=='sf88-research-ris-receipt-v1'||receipt.requestId!==requestId||
    receipt.questionId!==body.review.questionId||receipt.planSha256!==body.expectedPlanSha256||
    canonical(receipt.source)!==canonical(body.source)||
    !/^e_[a-f0-9]{64}$/.test(receipt.editionId)||!Number.isSafeInteger(receipt.originalRevision)||
    receipt.originalRevision<1||receipt.revision!==receipt.originalRevision+1)
    fail('RIS_PENDING_RECEIPT_CHANGED');
  const bytes=new TextEncoder().encode(canonical({source:body.source,review:body.review}));
  const inputSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
  if(receipt.inputSha256!==inputSha256)fail('RIS_PENDING_RECEIPT_CHANGED');
  return receipt;
}
function database(){
  if(!opened)opened=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(Object.assign(new Error('RIS_DRAFT_STORAGE_UNAVAILABLE'),{code:'RIS_DRAFT_STORAGE_UNAVAILABLE'}));return;}
    const request=indexedDB.open(DATABASE,VERSION);let abandoned=false;
    const rejectOpen=error=>{abandoned=true;reject(error);};
    request.onupgradeneeded=()=>{
      for(const name of ['drafts','requests']){
        const table=request.result.createObjectStore(name,{keyPath:'key'});
        table.createIndex('scope','scope',{unique:false});
      }
    };
    request.onblocked=()=>rejectOpen(Object.assign(new Error('RIS_DRAFT_DATABASE_BLOCKED'),{code:'RIS_DRAFT_DATABASE_BLOCKED'}));
    request.onerror=()=>rejectOpen(request.error);
    request.onsuccess=()=>{
      const db=request.result;if(abandoned){db.close();return;}
      db.onversionchange=()=>{db.close();opened=null;};resolve(db);
    };
  }).catch(error=>{opened=null;throw error;});
  return opened;
}
async function transaction(name,mode,operation){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(name,mode),table=tx.objectStore(name);let result,error;
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(error??tx.error??new Error('RIS_DRAFT_TRANSACTION_FAILED'));
    tx.onabort=()=>reject(error??tx.error??new Error('RIS_DRAFT_TRANSACTION_ABORTED'));
    const finish=value=>{result=value;};
    const stop=reason=>{error=reason;try{tx.abort();}catch{reject(reason);}};
    try{operation(table,finish,stop);}catch(reason){stop(reason);}
  });
}
export function createRisDraftStore(workspaceId,dossierId){
  if(!validId(workspaceId)||!validId(dossierId))fail('RIS_DRAFT_WORKSPACE_REQUIRED');
  const scope=workspaceId+'\u0000'+dossierId,key=id=>{if(!validId(id))fail('RIS_DRAFT_ID_REQUIRED');return scope+'\u0000'+id;};
  const summary=value=>({requestId:value.requestId,editId:value.editId??null,
    label:value.sourceInput?.label??value.label??'RIS review',updatedAt:value.updatedAt??value.createdAt,
    phase:value.state??'DRAFT',receipt:value.receipt??null});
  function read(name,id){
    return transaction(name,'readonly',(table,finish,stop)=>{
      const request=table.get(key(id));request.onsuccess=()=>finish(request.result?clone(request.result.value):null);
      request.onerror=()=>stop(request.error);
    });
  }
  function list(name){
    return transaction(name,'readonly',(table,finish,stop)=>{
      const values=[],request=table.index('scope').openCursor(IDBKeyRange.only(scope));
      request.onerror=()=>stop(request.error);
      request.onsuccess=()=>{
        const cursor=request.result;
        if(!cursor){finish(values.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))));return;}
        values.push(summary(cursor.value.value));cursor.continue();
      };
    });
  }
  return Object.freeze({
    scope,
    readDraft:id=>read('drafts',id),
    listDrafts:()=>list('drafts'),
    readPending:id=>read('requests',id),
    listPending:()=>list('requests'),
    async putDraft(draft,{expectedEditId=null}={}){
      if(!validId(draft?.requestId)||!validId(draft?.editId)||draft.dossierId!==dossierId||draft.workspaceId!==workspaceId)
        fail('RIS_DRAFT_BINDING_CHANGED');
      const value=checked(draft);
      return transaction('drafts','readwrite',(table,finish,stop)=>{
        const request=table.get(key(value.requestId));
        request.onerror=()=>stop(request.error);
        request.onsuccess=()=>{
          try{
            const prior=request.result?.value;
            if(prior?.editId===value.editId){
              if(canonical(prior)!==canonical(value))fail('RIS_DRAFT_EDIT_ID_REUSED');
              finish(clone(prior));return;
            }
            if((prior?.editId??null)!==expectedEditId)fail('RIS_DRAFT_CHANGED_IN_ANOTHER_WINDOW');
            table.put({key:key(value.requestId),scope,value});finish(clone(value));
          }catch(error){stop(error);}
        };
      });
    },
    removeDraft: (id,expectedEditId)=>transaction('drafts','readwrite',(table,finish,stop)=>{
      const request=table.get(key(id));request.onerror=()=>stop(request.error);
      request.onsuccess=()=>{
        if(request.result&&expectedEditId!==undefined&&request.result.value.editId!==expectedEditId){finish(false);return;}
        table.delete(key(id));finish(true);
      };
    }),
    async putPending(pending){
      if(!validId(pending?.requestId)||pending.body?.review?.requestId!==pending.requestId||
        pending.dossierId!==dossierId||pending.workspaceId!==workspaceId)fail('RIS_PENDING_BINDING_CHANGED');
      const value=checked({...pending,state:'PENDING'},{pending:true});
      return transaction('requests','readwrite',(table,finish,stop)=>{
        const request=table.get(key(value.requestId));request.onerror=()=>stop(request.error);
        request.onsuccess=()=>{
          try{
            const prior=request.result?.value;
            if(prior){
              const selected=row=>({workspaceId:row.workspaceId,dossierId:row.dossierId,requestId:row.requestId,body:row.body});
              if(canonical(selected(prior))!==canonical(selected(value)))fail('RIS_PENDING_REQUEST_INPUT_CHANGED');
              finish(clone(prior));return;
            }
            table.add({key:key(value.requestId),scope,value});finish(clone(value));
          }catch(error){stop(error);}
        };
      });
    },
    rebasePending:(id,{expectedRevision,revision,proof})=>transaction('requests','readwrite',(table,finish,stop)=>{
      const request=table.get(key(id));request.onerror=()=>stop(request.error);
      request.onsuccess=()=>{
        try{
          const prior=request.result?.value;
          if(!prior||prior.state!=='PENDING'||prior.body.expectedRevision!==expectedRevision||
            !Number.isSafeInteger(revision)||revision<=expectedRevision||
            proof?.requestId!==id||proof?.error!=='RIS_REQUEST_NOT_FOUND'||proof?.dossierRevision!==revision||
            !Number.isFinite(Date.parse(proof.observedAt)))fail('RIS_PENDING_REBASE_NOT_RECONCILED');
          const value={...prior,body:{...prior.body,expectedRevision:revision},
            attempts:[...(prior.attempts??[]),{expectedRevision,notApplied:clone(proof)}]};
          table.put({key:key(id),scope,value});finish(clone(value));
        }catch(error){stop(error);}
      };
    }),
    async completePending(id,result){
      const selected=await read('requests',id);if(!selected)fail('RIS_PENDING_REQUEST_NOT_FOUND');
      await assertRisReceipt(result,selected);
      return transaction('requests','readwrite',(table,finish,stop)=>{
        const request=table.get(key(id));request.onerror=()=>stop(request.error);
        request.onsuccess=()=>{
          try{
            const prior=request.result?.value;if(!prior)fail('RIS_PENDING_REQUEST_NOT_FOUND');
            if(canonical(prior.body)!==canonical(selected.body)||
              prior.workspaceId!==selected.workspaceId||prior.dossierId!==selected.dossierId||
              prior.requestId!==selected.requestId)fail('RIS_PENDING_REQUEST_INPUT_CHANGED');
            if(prior.receipt&&canonical(prior.receipt)!==canonical(result.receipt))fail('RIS_PENDING_RECEIPT_CHANGED');
            const value={...prior,state:'COMPLETE',receipt:clone(result.receipt),completedAt:prior.completedAt??new Date().toISOString()};
            table.put({key:key(id),scope,value});finish(clone(value));
          }catch(error){stop(error);}
        };
      });
    },
  });
}
