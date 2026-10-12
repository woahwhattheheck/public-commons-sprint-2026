// MIT. Browser drafts and immutable submitted requests belong to one original workspace/dossier.
const DATABASE='research-study-extraction-v1',STORE='records';
export function openStudyExtractionDrafts(){
  let database,opening,closed=false;
  async function open(){
    if(closed)throw new Error('Extraction draft storage is closed.');
    if(database)return database;
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DATABASE,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'key'});
      request.onerror=()=>reject(request.error??new Error('Could not open extraction drafts.'));
      request.onblocked=()=>reject(new Error('Close the older Research window to open draft storage.'));
      request.onsuccess=()=>{
        if(closed){request.result.close();reject(new Error('Extraction draft storage is closed.'));return;}
        database=request.result;database.onversionchange=()=>{database.close();database=null;};
        resolve(database);
      };
    }).finally(()=>{opening=null;});
    return opening;
  }
  const scope=value=>{
    if(!value||!/^research_[a-f0-9]{64}$/.test(value.workspaceId)||typeof value.dossierId!=='string'||!value.dossierId)
      throw new Error('Open the original workspace and dossier before saving a draft.');
    return value.workspaceId+'/'+value.dossierId+'/';
  };
  async function transaction(mode,work){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let result;
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Draft write interrupted.'));
      try{work(store,value=>{result=value;});}catch(error){try{tx.abort();}catch{}reject(error);}
    });
  }
  return {
    async get(context,name){
      const key=scope(context)+name;
      return transaction('readonly',(store,done)=>{const r=store.get(key);r.onsuccess=()=>done(r.result?.value??null);});
    },
    async put(context,name,value){
      const key=scope(context)+name,copy=structuredClone(value);
      return transaction('readwrite',(store,done)=>{store.put({key,value:copy,updatedAt:new Date().toISOString()});done(copy);});
    },
    async remove(context,name){
      const key=scope(context)+name;return transaction('readwrite',(store,done)=>{store.delete(key);done(true);});
    },
    async list(context,prefix=''){
      const start=scope(context)+prefix,rows=[];
      return transaction('readonly',(store,done)=>{
        const r=store.openCursor(IDBKeyRange.bound(start,start+'\uffff',false,false));
        r.onsuccess=()=>{const cursor=r.result;if(cursor){rows.push(cursor.value);cursor.continue();}else done(rows);};
      });
    },
    async prepare(context,record){
      const key=scope(context)+'request/'+record.request.requestId,copy=structuredClone(record);
      if(copy.workspaceId!==context.workspaceId||copy.dossierId!==context.dossierId)
        throw new Error('The saved request belongs to a different workspace.');
      return transaction('readwrite',(store,done)=>{
        const r=store.get(key);
        r.onsuccess=()=>{
          const old=r.result?.value;
          if(old){
            if(JSON.stringify(old.request)!==JSON.stringify(copy.request)||old.route!==copy.route){
              txAbort();return;
            }
            done(old);return;
          }
          store.put({key,value:copy,updatedAt:new Date().toISOString()});done(copy);
        };
        function txAbort(){store.transaction.abort();}
      });
    },
    close(){closed=true;database?.close();database=null;},
  };
}
