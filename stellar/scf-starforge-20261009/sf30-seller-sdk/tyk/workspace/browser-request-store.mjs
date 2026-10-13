// MIT. Complete original browser requests, including carried files, in the same workspace journal.
let opening;
function database(){
  if(!opening)opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('tyk-original-browser-requests',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('requests');
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};request.onerror=()=>{opening=null;reject(request.error);};
    request.onblocked=()=>{opening=null;reject(new Error('Close the older Tyk tab to open its original request journal.'));};
  });return opening;
}
export async function readTykBrowserRequest(key){
  const db=await database();return new Promise((resolve,reject)=>{
    const tx=db.transaction('requests','readonly'),request=tx.objectStore('requests').get(key);let value=null;
    request.onsuccess=()=>{value=request.result??null;};tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error);
  });
}
export async function saveTykBrowserRequest(key,value,expectedRequestId){
  const db=await database();return new Promise((resolve,reject)=>{
    const tx=db.transaction('requests','readwrite'),store=tx.objectStore('requests'),request=store.get(key);let conflict;
    request.onsuccess=()=>{
      const prior=request.result;
      if(prior&&value&&(prior.method!==value.method||prior.args.requestId!==value.args.requestId||
        JSON.stringify(prior.args)!==JSON.stringify(value.args))){
        conflict=new Error('Recover the original pending request before sending another workspace write.');tx.abort();return;
      }
      if(value===null){if(!expectedRequestId||prior?.args.requestId===expectedRequestId)store.delete(key);}
      else store.put(value,key);
    };
    tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(conflict??tx.error);
  });
}
