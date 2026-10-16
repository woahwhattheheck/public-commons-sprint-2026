// MIT. Browser-only persistence adapter; never sends framework data to a service.
export async function bootCASEProgramme({engine,model,host,app,builder,reportHTML,assets,initial=null}) {
 const encode=s=>new TextEncoder().encode(s),hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const M=model.createCASEProgramme({uuid:()=>crypto.randomUUID(),now:()=>new Date().toISOString(),hash,encode,compare:engine.compareCASEEditions,delivery:engine.createCASEDelivery,inspectDelivery:engine.inspectCASEDelivery,inspectSource:engine.inspectCASESource});
 let openingError='',selected=initial;
 if(selected)try{await M.verify(selected);}catch(e){openingError='Opened programme needs attention: '+e.message;const raw=JSON.stringify(selected,null,2)+'\n';selected=M.initial();selected.originals.push({id:crypto.randomUUID(),name:'Invalid opened programme',kind:'recovery',at:new Date().toISOString(),text:raw,bytes:encode(raw).length,sha256:await hash(encode(raw))});}
 let db=null;try{db=await new Promise((resolve,reject)=>{const q=indexedDB.open('commons-case-programme-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('copies',{keyPath:'id'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}catch(e){openingError+=' Browser storage: '+e.message;}
 const transaction=(mode,fn)=>new Promise((resolve,reject)=>{if(!db){reject(Error('IndexedDB unavailable'));return;}const tx=db.transaction('copies',mode),q=fn(tx.objectStore('copies'));let result;q.onsuccess=()=>result=q.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error??q.error);tx.onabort=()=>reject(tx.error??Error('Storage transaction aborted'));});
 const storage={list:()=>transaction('readonly',s=>s.getAll()),read:key=>transaction('readonly',s=>s.get(key)),write:(key,value)=>transaction('readwrite',s=>s.put(value))};
 let H;const session={getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v)};
 H=host.createCASEProgrammeHost({M,storage,session,uuid:()=>crypto.randomUUID(),initial:selected,changed:()=>H?.view?.()});
 return app.startCASEProgramme({M,H,engine,reportHTML,buildHTML:builder.buildCASEProgrammeHTML,assets,initialError:openingError});
}
