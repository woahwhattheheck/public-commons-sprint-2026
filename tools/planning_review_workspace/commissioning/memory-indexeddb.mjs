/* MIT. Explicit in-memory IndexedDB transaction adapter for the existing source course.
   This models atomic commit/abort and serialized transactions, not a browser/OS runtime. */
export function memoryIndexedDB(){
 const databases=new Map();let failNextWrite=false,unavailable=false;
 const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
 function database(name){if(!databases.has(name))databases.set(name,{stores:new Map(),tail:Promise.resolve(),version:0});return databases.get(name);}
 function connection(state){return {
  objectStoreNames:{contains:name=>state.stores.has(name)},
  createObjectStore(name){state.stores.set(name,new Map());},
  close(){},
  transaction(names,mode){
   names=Array.isArray(names)?names:[names];const steps=[];let aborted=false,error=null,local;
   const tx={error:null,oncomplete:null,onerror:null,onabort:null,
    abort(){aborted=true;tx.error=error||Error("Authored transaction aborted");},
    objectStore(name){if(!names.includes(name))throw Error("Object store outside transaction");return {
     get(key){return request(()=>clone(local.get(name).get(key)));},
     put(value){return request(()=>{if(mode!=="readwrite")throw Error("Read-only transaction");local.get(name).set(value.id,clone(value));return value.id;});},
     add(value){return request(()=>{if(mode!=="readwrite")throw Error("Read-only transaction");if(local.get(name).has(value.id))throw Error("ConstraintError");local.get(name).set(value.id,clone(value));return value.id;});},
     openCursor(){const q={result:null,onsuccess:null,onerror:null},list=()=>[...local.get(name).entries()];let at=0;function next(){steps.push(()=>{const items=list(),item=items[at++];q.result=item?{key:item[0],value:clone(item[1]),continue:next}:null;q.onsuccess?.({target:q});});}next();return q;}
    };}
   };
   function request(fn){const q={result:undefined,error:null,onsuccess:null,onerror:null};steps.push(()=>{try{q.result=fn();q.onsuccess?.({target:q});}catch(e){q.error=e;error=e;tx.error=e;aborted=true;q.onerror?.({target:q});}});return q;}
   const execute=async()=>{local=new Map(names.map(n=>[n,new Map(state.stores.get(n)||[])]));await Promise.resolve();while(steps.length&&!aborted){steps.shift()();await Promise.resolve();}
    if(mode==="readwrite"&&(failNextWrite||unavailable)){failNextWrite=false;aborted=true;tx.error=Error("QuotaExceededError: authored failed durable commit");}
    if(aborted){tx.onabort?.({target:tx});return;}if(mode==="readwrite")for(const [name,data]of local)state.stores.set(name,data);tx.oncomplete?.({target:tx});};
   state.tail=state.tail.then(execute,execute);return tx;
  }
 };}
 return {open(name,version){const q={result:null,error:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};Promise.resolve().then(()=>{try{const state=database(name);q.result=connection(state);if(state.version<version){state.version=version;q.onupgradeneeded?.({target:q});}q.onsuccess?.({target:q});}catch(e){q.error=e;q.onerror?.({target:q});}});return q;},
 failNextCommit(){failNextWrite=true;},setWritesUnavailable(value){unavailable=!!value;},inspect(name,store){return [...(database(name).stores.get(store)||new Map()).values()].map(clone);},
 reset(){databases.clear();failNextWrite=false;unavailable=false;},
 async idle(){for(const state of databases.values())await state.tail;}
 };
}
