// MIT. Compare-and-save browser drafts; pending original requests stay intact.
const failure=code=>Object.assign(new Error(code),{code});
export async function openProtocolDraftStore(){
  if(!globalThis.indexedDB)throw failure('PROTOCOL_BROWSER_STORAGE_UNAVAILABLE');
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('sf88-study-protocol-drafts',1);let settled=false;
    const rejectOnce=error=>{if(!settled){settled=true;reject(error);}};
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains('drafts'))request.result.createObjectStore('drafts',{keyPath:'id'});
    };
    request.onerror=()=>rejectOnce(request.error??failure('PROTOCOL_BROWSER_STORAGE_FAILED'));
    request.onblocked=()=>rejectOnce(failure('PROTOCOL_BROWSER_STORAGE_BLOCKED'));
    request.onsuccess=()=>{
      if(settled){request.result.close();return;}
      settled=true;resolve(request.result);
    };
  });
  let closed=false;
  db.onversionchange=()=>{closed=true;db.close();};
  const transaction=(mode,work)=>new Promise((resolve,reject)=>{
    if(closed){reject(failure('PROTOCOL_BROWSER_STORAGE_CLOSED'));return;}
    let tx,outcome,error;
    try{
      tx=db.transaction('drafts',mode);
      tx.oncomplete=()=>resolve(outcome);
      tx.onabort=()=>reject(error??tx.error??failure('PROTOCOL_BROWSER_STORAGE_ABORTED'));
      tx.onerror=()=>{error??=tx.error;};
      work(tx.objectStore('drafts'),value=>{outcome=value;},value=>{error=value;tx.abort();});
    }catch(caught){
      error=caught;
      if(tx){try{tx.abort();}catch{reject(caught);}}
      else reject(caught);
    }
  });
  return Object.freeze({
    list:()=>transaction('readonly',(store,done)=>{
      const request=store.getAll();request.onsuccess=()=>done(request.result);
    }),
    read:id=>transaction('readonly',(store,done)=>{
      const request=store.get(id);request.onsuccess=()=>done(request.result??null);
    }),
    write:(snapshot,expectedRevision)=>transaction('readwrite',(store,done,abort)=>{
      if(!snapshot||typeof snapshot.id!=='string'||typeof snapshot.commitId!=='string'||
        !Number.isSafeInteger(expectedRevision)||expectedRevision<0){
        abort(failure('PROTOCOL_DRAFT_SELECTION_INVALID'));return;
      }
      const retained=structuredClone(snapshot),request=store.get(retained.id);
      request.onsuccess=()=>{
        const current=request.result;
        if(current?.snapshot?.commitId===retained.commitId){
          if(JSON.stringify(current.snapshot)!==JSON.stringify(retained)){
            abort(failure('PROTOCOL_DRAFT_COMMIT_CHANGED'));return;
          }
          done(current);return;
        }
        if((current?.revision??0)!==expectedRevision){
          abort(failure('PROTOCOL_DRAFT_CHANGED_IN_ANOTHER_TAB'));return;
        }
        const record={id:retained.id,revision:expectedRevision+1,snapshot:retained};
        const write=store.put(record);write.onsuccess=()=>done(record);
      };
    }),
    close(){if(!closed){closed=true;db.close();}},
  });
}
