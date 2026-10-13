'use strict';
/* Copyright 2026 TokenJunkieLabs. Complete local draft compare-and-save. */
function createCollectionStorage(indexedDB, key) {
 let db;
 const open=()=>db?Promise.resolve(db):new Promise((resolve,reject)=>{const r=indexedDB.open('tjlabs-event-collections',1);r.onupgradeneeded=()=>{for(const n of ['current','preserved'])if(!r.result.objectStoreNames.contains(n))r.result.createObjectStore(n);};r.onerror=()=>reject(r.error);r.onsuccess=()=>{db=r.result;resolve(db);};});
 async function read(){const d=await open();return new Promise((resolve,reject)=>{const t=d.transaction('current','readonly'),r=t.objectStore('current').get(key);r.onsuccess=()=>resolve(r.result===undefined?null:r.result);r.onerror=()=>reject(r.error);});}
 async function compareSave(expected,next,identity,{preserveOriginal=false}={}){
  const d=await open();return new Promise((resolve,reject)=>{
   const t=d.transaction(['current','preserved'],'readwrite'),c=t.objectStore('current'),p=t.objectStore('preserved');let result;
   const r=c.get(key);r.onerror=()=>reject(r.error);r.onsuccess=()=>{
    const actual=r.result===undefined?null:r.result;
    if(actual!==expected){const pair={id:identity.id,key,at:identity.at,reason:'concurrent-change',local:next,shared:actual,expected};p.add(pair,key+'/'+identity.id);result={saved:false,pair};}
    else {if(preserveOriginal)p.add({id:identity.id,key,at:identity.at,reason:'explicit-recovery',local:next,shared:actual,expected},key+'/'+identity.id);c.put(next,key);result={saved:true,value:next};}
   };t.oncomplete=()=>resolve(result);t.onabort=()=>reject(t.error||new Error('Draft was not saved.'));t.onerror=()=>{};
  });
 }
 async function preserved(){const d=await open();return new Promise((resolve,reject)=>{const r=d.transaction('preserved','readonly').objectStore('preserved').getAll();r.onsuccess=()=>resolve(r.result.filter(x=>x.key===key));r.onerror=()=>reject(r.error);});}
 return {read,compareSave,preserved,close:()=>db?.close()};
}
module.exports={createCollectionStorage};
