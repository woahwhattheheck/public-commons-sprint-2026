/* SPDX-License-Identifier: MIT */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory(require("./workspace.cjs"));else root.CmdbStore=factory(root.CmdbWorkspace);})(typeof globalThis!=="undefined"?globalThis:this,function(C){
 "use strict";
 const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
 const names=["books","meta","pending"];
 function temporary(reason){
  const stores=Object.fromEntries(names.map(name=>[name,new Map()]));
  const selected=name=>{if(!stores[name])throw Error("Unknown working store.");return stores[name];};
  return {mode:"temporary",reason:String(reason?.message||reason||"Browser storage is unavailable."),
   async get(name,key){return copy(selected(name).get(key));},
   async put(name,key,value){selected(name).set(key,copy(value));},
   async list(name){return [...selected(name).values()].map(copy);},
   async commit(key,command){
    const row=stores.books.get(key);if(!row)throw Error("The original working workspace is missing.");
    const result=C.transition(row.workspace,command);
    stores.books.set(key,{key,workspace:copy(result.workspace)});stores.pending.delete(key);
    return copy(result);
   },close(){for(const store of Object.values(stores))store.clear();}
  };
 }
 function persistent(db){
  return {mode:"browser",reason:"",
   get(name,key){return new Promise((resolve,reject)=>{const r=db.transaction(name,"readonly").objectStore(name).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});},
   put(name,key,value){return new Promise((resolve,reject)=>{const tx=db.transaction(name,"readwrite");tx.objectStore(name).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error("The browser could not save this operation."));});},
   list(name){return new Promise((resolve,reject)=>{const r=db.transaction(name,"readonly").objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});},
   commit(key,command){return new Promise((resolve,reject)=>{
    const tx=db.transaction(["books","pending"],"readwrite"),books=tx.objectStore("books");let result,error;
    const request=books.get(key);
    request.onsuccess=()=>{try{if(!request.result)throw Error("The original saved workspace is missing.");result=C.transition(request.result.workspace,command);books.put({key,workspace:result.workspace},key);tx.objectStore("pending").delete(key);}catch(e){error=e;tx.abort();}};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error||Error("The complete save did not finish."));
   });},close(){db.close();}
  };
 }
 async function open({getIndexedDB=()=>globalThis.indexedDB}={}){
  try{
   const provider=getIndexedDB();if(!provider||typeof provider.open!=="function")throw Error("This browser does not expose local working storage.");
   const db=await new Promise((resolve,reject)=>{
    const request=provider.open("tjlabs-cmdb-acceptance",1);
    request.onupgradeneeded=()=>{for(const name of names)if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||Error("Local working storage could not open."));
   });
   return persistent(db);
  }catch(error){return temporary(error);}
 }
 return {open};
});
