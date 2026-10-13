const DATABASE = 'stellar-forge-merchant-drafts';
const STORE = 'drafts';

export class DraftConflictError extends Error {
  constructor() {
    super('A newer version of this draft was saved in another tab. Reopen it, or save your current work as a new draft.');
    this.name = 'DraftConflictError';
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Draft storage is unavailable in this browser. Download a draft JSON to keep your work.'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close another Stellar Forge tab, then reopen saved drafts.'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    let failure;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(failure || tx.error || new Error('Draft storage could not finish. Download your draft JSON.')); };
    operation(tx.objectStore(STORE), value => { result = value; }, error => { failure = error; tx.abort(); });
  });
}

export function listDrafts() {
  return transaction('readonly', (store, done) => {
    const metadata = [];
    // Keep the original key order for equal timestamps without materializing
    // every complete saved input at once merely to open a draft selector.
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        done(metadata.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        return;
      }
      const { input, ...record } = cursor.value;
      metadata.push(record);
      cursor.continue();
    };
  });
}

export function loadDraft(id) {
  return transaction('readonly', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => done(request.result || null);
  });
}

export function saveDraft({ id, revision = 0, input }) {
  const key = id || crypto.randomUUID();
  return transaction('readwrite', (store, done, fail) => {
    const read = store.get(key);
    read.onsuccess = () => {
      const previous = read.result;
      if ((previous?.revision || 0) !== revision) return fail(new DraftConflictError());
      const record = {
        id: key, revision: revision + 1, name: input.folder || 'Untitled merchant',
        resources: Array.isArray(input.resources) ? input.resources.length : 0,
        updatedAt: new Date().toISOString(), input: structuredClone(input),
      };
      store.put(record);
      done(record);
    };
  });
}

export function deleteDraft(id, revision) {
  return transaction('readwrite', (store, done, fail) => {
    const read = store.get(id);
    read.onsuccess = () => {
      if (read.result && read.result.revision !== revision) return fail(new DraftConflictError());
      store.delete(id);
      done(true);
    };
  });
}


// Complete library operations use the same original store and transaction owner.
export function readDraftRecords(){
  return transaction('readonly',(store,done)=>{const request=store.getAll();request.onsuccess=()=>done(request.result);});
}
// Project one original readonly snapshot synchronously, releasing each full
// cursor value before advancing. The mapper must not retain unrelated records
// or await; IDB remains active through the immediately scheduled next request.
export function projectDraftRecords(mapper,{ids=null}={}){
  if(typeof mapper!=='function'||ids!==null&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')))
    throw new TypeError('Use a synchronous saved-record projection and exact selected IDs.');
  const selected=ids===null?null:new Set(ids);
  return transaction('readonly',(store,done,fail)=>{
    const values=[];
    const request=store.openCursor();
    request.onsuccess=()=>{
      const cursor=request.result;
      if(!cursor){done(values);return;}
      try{
        if(selected===null||selected.has(cursor.key)){
          const value=mapper(cursor.value);
          if(value&&typeof value.then==='function')throw new TypeError('Saved-record projection cannot await inside its original transaction.');
          if(value!==undefined)values.push(value);
        }
        cursor.continue();
      }catch(error){fail(error);}
    };
  });
}
function sameSavedValue(a,b,seen=new Map(),reverse=new Map()){
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return Object.is(a,b);
  if(seen.has(a)||reverse.has(b))return seen.get(a)===b&&reverse.get(b)===a;
  seen.set(a,b);reverse.set(b,a);
  if(a instanceof Date||b instanceof Date)return a instanceof Date&&b instanceof Date&&Object.is(a.getTime(),b.getTime());
  if(a instanceof ArrayBuffer||b instanceof ArrayBuffer){
    if(!(a instanceof ArrayBuffer&&b instanceof ArrayBuffer)||a.byteLength!==b.byteLength)return false;
    const av=new Uint8Array(a),bv=new Uint8Array(b);return av.every((x,i)=>x===bv[i]);
  }
  if(ArrayBuffer.isView(a)||ArrayBuffer.isView(b)){
    if(!(ArrayBuffer.isView(a)&&ArrayBuffer.isView(b))||a.constructor!==b.constructor||a.byteLength!==b.byteLength||a.byteOffset!==b.byteOffset)return false;
    return sameSavedValue(a.buffer,b.buffer,seen,reverse);
  }
  if(Array.isArray(a)!==Array.isArray(b)||Array.isArray(a)&&a.length!==b.length)return false;
  const ak=Object.keys(a),bk=Object.keys(b);
  return ak.length===bk.length&&ak.every((k,i)=>bk[i]===k&&sameSavedValue(a[k],b[k],seen,reverse));
}
export function commitDraftRecords({receiptId,requestHash,expected,puts,removals,receiptRecord}){
  if(!receiptId?.startsWith('draft-library-journal:')||receiptRecord?.id!==receiptId||
      receiptRecord.input?.schema!=='stellar-forge.saved-project-receipt.v1'||
      receiptRecord.input.requestHash!==requestHash)throw new Error('A complete original library receipt is required.');
  if(!Array.isArray(expected)||!Array.isArray(puts)||!Array.isArray(removals))throw new Error('A complete receiving transaction is required.');
  const checked=new Set(expected.map(x=>x.id)),written=new Set(puts.map(x=>x.id));
  if(checked.size!==expected.length||written.size!==puts.length||new Set(removals).size!==removals.length||
      puts.some(x=>!checked.has(x.id)||x.id===receiptId)||removals.some(id=>!checked.has(id)||written.has(id)||id===receiptId))
    throw new Error('The original reviewed receiving inventory is inconsistent.');
  const frozen=structuredClone({receiptId,requestHash,expected,puts,removals,receiptRecord});
  return transaction('readwrite',(store,done,fail)=>{
    const prior=store.get(frozen.receiptId);
    prior.onsuccess=()=>{
      if(prior.result){
        if(prior.result.input?.schema!=='stellar-forge.saved-project-receipt.v1'||prior.result.input.requestHash!==frozen.requestHash)
          return fail(new Error('The original receiving request already selected different input.'));
        done({record:prior.result,replayed:true});return;
      }
      let remaining=frozen.expected.length,failed=false;
      const write=()=>{
        if(failed)return;
        for(const record of frozen.puts)store.put(record);
        for(const id of frozen.removals)store.delete(id);
        store.add(frozen.receiptRecord);
        done({record:frozen.receiptRecord,replayed:false});
      };
      if(!remaining){write();return;}
      for(const item of frozen.expected){
        const read=store.get(item.id);
        read.onsuccess=()=>{
          if(failed)return;
          if(!sameSavedValue(read.result??null,item.record)){
            failed=true;fail(new DraftConflictError());return;
          }
          if(--remaining===0)write();
        };
      }
    };
  });
}
