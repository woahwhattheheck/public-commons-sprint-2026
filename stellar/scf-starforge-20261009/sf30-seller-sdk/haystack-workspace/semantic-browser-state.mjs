import { stringifyJson } from "./json-codec.mjs";
// Reuses the original application database and both original stores unchanged.
let databasePromise;
function database(){
  if(databasePromise)return databasePromise;
  databasePromise=new Promise((resolve,reject)=>{
    const opening=indexedDB.open("commons.haystack.operator.v1",1);
    opening.onupgradeneeded=()=>{
      const db=opening.result;
      if(!db.objectStoreNames.contains("operations"))db.createObjectStore("operations",{keyPath:"operationId"});
      if(!db.objectStoreNames.contains("drafts"))db.createObjectStore("drafts",{keyPath:"key"});
    };
    opening.onsuccess=()=>resolve(opening.result);
    opening.onerror=()=>reject(opening.error||new Error("Browser request storage could not be opened."));
    opening.onblocked=()=>reject(new Error("Close another outdated workspace tab so request storage can open."));
  });
  return databasePromise;
}
export async function dbRead(storeName,key){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readonly"),call=key===undefined?tx.objectStore(storeName).getAll():tx.objectStore(storeName).get(key);
    let result;
    call.onsuccess=()=>{result=call.result;};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error||call.error||new Error("Browser storage read failed."));
    tx.onabort=()=>reject(tx.error||new Error("Browser storage read was interrupted."));
  });
}
export async function dbWrite(storeName,value,{original=false}={}){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readwrite"),store=tx.objectStore(storeName);
    if(original){
      const lookup=store.get(value.operationId);
      lookup.onsuccess=()=>{
        const existing=lookup.result;
        if(existing&&(
          existing.workspaceId!==value.workspaceId||existing.action!==value.action||
          stringifyJson(existing.args)!==stringifyJson(value.args)
        )){tx.abort();return;}
        if(!existing)store.add(value);
      };
    }else store.put(value);
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error||new Error("The complete original request could not be retained in this browser."));
    tx.onabort=()=>reject(tx.error||new Error("A different original request already occupies this operation ID."));
  });
}

export async function retainSemanticOperation(identity, action, args) {
  const record={operationId:args.operationId,workspaceId:identity.workspaceId,instanceId:identity.instanceId,serverUrl:identity.url,
    action,args:structuredClone(args),createdAt:new Date().toISOString(),state:"prepared",receipt:null,error:null,source:"semantic"};
  await dbWrite("operations",record,{original:true}); return record;
}
export async function finishSemanticOperation(record,state,receipt=null,error=null) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("operations","readwrite"),table=tx.objectStore("operations"),get=table.get(record.operationId);
    let saved;
    get.onsuccess=()=>{
      const current=get.result;
      if(!current||current.workspaceId!==record.workspaceId||current.action!==record.action||stringifyJson(current.args)!==stringifyJson(record.args)){tx.abort();return;}
      if(current.state==="completed"&&state!=="completed"){saved=current;return;}
      saved={...current,state,receipt,error,updatedAt:new Date().toISOString()};table.put(saved);
    };
    tx.oncomplete=()=>resolve(saved);tx.onerror=()=>reject(tx.error||new Error("The original request receipt could not be retained."));
    tx.onabort=()=>reject(tx.error||new Error("The original request changed before its receipt."));
  });
}
export async function semanticOperations(workspaceId) {
  return (await dbRead("operations")).filter(row=>row.workspaceId===workspaceId&&(row.source==="semantic"||row.action?.startsWith("semantic."))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
