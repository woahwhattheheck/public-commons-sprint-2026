// MIT. Original workspace HTTP and browser request custody.
const database='sensorthings-operations-desk-v1',storeName='pending';
export class ApiError extends Error {
  constructor(message,{status=0,code='TRANSPORT',details=null}={}) {super(message);this.name='ApiError';this.status=status;this.code=code;this.details=details;}
}
function databaseOpen(){return new Promise((resolve,reject)=>{const r=indexedDB.open(database,1);r.onupgradeneeded=()=>r.result.createObjectStore(storeName);r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);});}
async function saved(key,value,write=false){const db=await databaseOpen();try{return await new Promise((resolve,reject)=>{const t=db.transaction(storeName,write?'readwrite':'readonly'),s=t.objectStore(storeName);const r=write?(value===null?s.delete(key):s.put(value,key)):s.get(key);let result;r.onsuccess=()=>{result=r.result;};t.oncomplete=()=>resolve(result??null);t.onerror=()=>reject(t.error??r.error);t.onabort=()=>reject(t.error??new Error('Browser request custody was not saved.'));});}finally{db.close();}}
async function savePending(key,value,expectedId) {
  const db=await databaseOpen();try{return await new Promise((resolve,reject)=>{
    const t=db.transaction(storeName,'readwrite'),s=t.objectStore(storeName),r=s.get(key);let failure=null;
    r.onsuccess=()=>{const current=r.result??null,observed=current?.body?.operationId??null;
      if(observed!==expectedId&&!(value===null&&observed===null)){failure=new ApiError('Another tab changed the original saved request. Reopen that request before continuing.',{code:'BROWSER_REQUEST_CHANGED'});t.abort();return;}
      if(value===null)s.delete(key);else s.put(value,key);
    };
    t.oncomplete=()=>resolve();t.onerror=()=>reject(failure??t.error??r.error);t.onabort=()=>reject(failure??t.error??new Error('The original request was not retained.'));
  });}finally{db.close();}
}
export const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(b=>b.toString(16).padStart(2,'0')).join('');
export function createDeskClient(token) {
  if(!/^[A-Za-z0-9_-]{32,200}$/.test(token??''))throw new ApiError('Open the private Start/Open link or enter its session token.',{code:'SESSION'});
  let workspaceId=null,key=null,view=null,pending=null,info=null;
  const listeners=new Set();
  const notify=()=>{for(const f of listeners)f({view,pending,info,workspaceId});};
  async function request(path,{method='GET',body,headers={},raw=false}={}) {
    const u=new URL(path,location.origin);
    if(u.origin!==location.origin||!u.pathname.startsWith('/api/'))throw new ApiError('Use this workspace API.',{code:'ORIGIN'});
    const selected={Authorization:'Bearer '+token,...(workspaceId?{'X-SensorThings-Workspace':workspaceId}:{}),...headers};
    if(body!==undefined&&!(body instanceof Blob)&&!(body instanceof ArrayBuffer)&&!ArrayBuffer.isView(body)){body=JSON.stringify(body);selected['Content-Type']='application/json';}
    let response;try{response=await fetch(u,{method,body,headers:selected,credentials:'same-origin',cache:'no-store',redirect:'error'});}
    catch(e){throw new ApiError('The original request has no readable response. Keep its saved identity and reconcile it after reopening. '+e.message);}
    if(workspaceId&&response.headers.get('X-SensorThings-Workspace')!==workspaceId){await response.body?.cancel().catch(()=>{});throw new ApiError('The responding workspace UUID changed.',{status:response.status,code:'WORKSPACE'});}
    if(raw&&response.ok)return response;
    let result;try{result=await response.json();}catch{throw new ApiError('The selected API returned an unreadable response.',{status:response.status,code:'RESPONSE'});}
    if(!response.ok){
      const nested=result?.error&&typeof result.error==='object'?result.error:null;
      const message=typeof nested?.message==='string'?nested.message:typeof result?.message==='string'?result.message:'The original operation could not complete.';
      const code=typeof result?.error==='string'?result.error:nested?.code??result?.code??'API';
      throw new ApiError(message,{status:response.status,code,details:nested?.details??result});
    }
    return result;
  }
  async function refresh(){view=await request('/api/view');if(view.workspaceId!==workspaceId)throw new ApiError('The workspace UUID changed.',{code:'WORKSPACE'});notify();return view;}
  async function open(){const schema=await request('/api/schema');workspaceId=schema.workspaceId;key=location.origin+'|'+workspaceId;info=await request('/api/desk/info');if(info.workspaceId!==workspaceId)throw new ApiError('The Desk belongs to another workspace.',{code:'WORKSPACE'});pending=await saved(key);await refresh();return{schema,view,info,pending};}
  async function retain(value){try{await savePending(key,value,pending?.body?.operationId??null);pending=value;notify();}catch(error){pending=await saved(key);notify();throw error;}}
  async function sendPending() {
    if(!pending)throw new ApiError('No saved request is pending.',{code:'REQUEST'});
    const original=pending;
    try {
      const result=await request('/api/action',{method:'POST',body:original.body});
      if(result.operationId!==original.body.operationId)throw new ApiError('The response belongs to another operation.',{code:'OPERATION'});
      if(result.view){view=result.view;notify();}
      if(result.state==='RUNNING'){await retain({...original,state:'RUNNING'});return result;}
      await retain(null);await refresh();return result;
    } catch(error) {
      await retain({...original,state:'RECONCILE',lastError:{message:error.message,code:error.code,status:error.status}});
      throw error;
    }
  }
  async function act(action,payload) {
    if(pending)throw new ApiError('Reconcile the saved '+pending.body.action+' operation before creating another request.',{code:'PENDING'});
    if(!view)throw new ApiError('Read the workspace before changing it.',{code:'WORKSPACE'});
    const body={operationId:'desk-'+crypto.randomUUID(),expectedRevision:view.revision,action,payload};
    await retain({schema:'stellar-forge.sensorthings-desk-pending.v1',workspaceId,body,createdAt:new Date().toISOString(),state:'PREPARED'});
    return sendPending();
  }
  async function reconcile() {
    if(!pending)return null;
    let record;
    try{record=await request('/api/operations/'+encodeURIComponent(pending.body.operationId));}
    catch(e){if(e.status===404){await refresh();await retain({...pending,state:'UNOBSERVED'});return{state:'UNOBSERVED',operationId:pending.body.operationId,currentRevision:view.revision};}throw e;}
    if(record.state==='COMPLETE'){const result=record.result;await retain(null);await refresh();return{...record,result};}
    await retain({...pending,state:record.state,record});await refresh();return record;
  }
  async function replay({reviewLatestRevision=false}={}) {
    const record=await reconcile();if(!pending)return record;
    if(record.state==='FAILED')throw new ApiError(record.error?.message??'The original operation failed. Review its retained error.',{code:record.error?.code??'OPERATION_FAILED'});
    if(record.state==='UNOBSERVED'&&pending.body.expectedRevision!==view.revision){
      if(!reviewLatestRevision)throw new ApiError('Review the current revision and explicitly rebind this unobserved request.',{code:'REVISION_REVIEW'});
      await retain({...pending,body:{...pending.body,expectedRevision:view.revision},reboundAt:new Date().toISOString(),state:'PREPARED'});
    }
    return sendPending();
  }
  async function dismissFailed(){if(!pending)return;const record=await reconcile();if(!pending)return;if(record.state!=='FAILED'&&!(record.state==='UNOBSERVED'&&pending.lastError?.status>=400&&pending.lastError.status<500))throw new ApiError('Keep the original pending request until its outcome or ended pre-dispatch response is known.',{code:'PENDING'});await saved(key+'|history|'+pending.body.operationId,pending,true);await retain(null);}
  async function upload(file,onProgress=()=>{}) {
    if(!info?.sourceInboxConfigured)throw new ApiError('The host must bind a source inbox before receiving a source archive.',{code:'INBOX'});
    if(!(file instanceof File)||file.size>info.uploadMaxBytes)throw new ApiError('Choose a file within the displayed source archive limit.',{code:'UPLOAD_SIZE'});
    // The browser holds a SHA input at this size. Larger original files use the
    // installed held-file receiver into the same configured inbox.
    const browserMax=Math.min(info.uploadMaxBytes,128*1024*1024);
    if(file.size>browserMax)throw new ApiError('Use the installed source-file receiver for files above 128 MiB, then select the same inbox file here.',{code:'UPLOAD_MEMORY'});
    const bytes=await file.arrayBuffer(),hash=await sha256(bytes),params=new URLSearchParams({filename:file.name,sha256:hash,bytes:String(file.size)});
    let status=await request('/api/desk/inbox/upload?'+params);
    if(status.sha256!==hash||status.bytes!==file.size)throw new ApiError('The inbox upload identity changed.',{code:'UPLOAD_IDENTITY'});
    onProgress({offset:status.offset??0,bytes:file.size,sha256:hash});
    while(!status.complete){
      const offset=status.offset??0;
      if(offset>=file.size){status=await request('/api/desk/inbox/upload?'+params);if(!status.complete)throw new ApiError('The original complete upload has not been published; reopen its same status.',{code:'UPLOAD_FINALIZE'});break;}
      const chunk=bytes.slice(offset,Math.min(file.size,offset+info.uploadChunkBytes)),q=new URLSearchParams(params);q.set('offset',String(offset));q.set('chunkSha256',await sha256(chunk));
      status=await request('/api/desk/inbox/upload?'+q,{method:'POST',body:chunk,headers:{'Content-Type':'application/octet-stream'}});
      onProgress({offset:status.offset??file.size,bytes:file.size,sha256:hash});
    }
    return status;
  }
  async function readComplete(file,{maximum=1024*1024}={}) {
    if(!file.selection)throw new ApiError('Select one original file.',{code:'FILE_SELECTION'});
    const selection={...file.selection};
    let readId=null,expectedSha256=file.sha256??undefined,offset=0,metadata=null;const chunks=[];
    try{
      for(;;){
        const input={selection,offset,limit:Math.min(196608,Math.max(1,maximum)),...(readId?{readId}:{}),...(expectedSha256?{expectedSha256}:{})};
        const result=await request('/api/files/read',{method:'POST',body:input});
        if(readId&&result.readId!==readId)throw new ApiError('The original held-file read identity changed.',{code:'FILE_CHANGED'});
        readId=result.readId;metadata??={...result.file};
        if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(readId??'')||
            !Number.isSafeInteger(metadata.bytes)||metadata.bytes<0||metadata.bytes>maximum||
            !/^[a-f0-9]{64}$/.test(metadata.sha256??'')||result.offset!==offset||
            result.encoding!=='base64'||typeof result.data!=='string')
          throw new ApiError('Use the complete installed file receiver for this selected source.',{code:'FILE_PREVIEW_SIZE'});
        if(expectedSha256&&metadata.sha256!==expectedSha256||
            file.bytes!==null&&file.bytes!==undefined&&metadata.bytes!==file.bytes||
            result.file?.sha256!==metadata.sha256||result.file?.bytes!==metadata.bytes)
          throw new ApiError('The original held-file identity changed.',{code:'FILE_CHANGED'});
        expectedSha256=metadata.sha256;const chunk=Uint8Array.from(atob(result.data),c=>c.charCodeAt(0));
        if(chunk.length!==result.bytesRead||chunk.length>input.limit||offset+chunk.length>metadata.bytes)
          throw new ApiError('The original file chunk length changed.',{code:'FILE_LENGTH'});
        chunks.push(chunk);offset+=chunk.length;
        const next=offset<metadata.bytes?offset:null;
        if(result.nextOffset!==next||next!==null&&!chunk.length)
          throw new ApiError('The original file continuation changed.',{code:'FILE_RANGE'});
        if(next===null)break;
      }
      const data=new Uint8Array(offset);let cursor=0;for(const chunk of chunks){data.set(chunk,cursor);cursor+=chunk.length;}
      if(await sha256(data)!==metadata.sha256)throw new ApiError('The complete original file SHA-256 differs.',{code:'FILE_CHANGED'});
      return{selection,metadata,data};
    }finally{if(readId)await request('/api/files/release',{method:'POST',body:{readId}}).catch(()=>{});}
  }
  async function readText(file,options) {
    const {selection,metadata,data}=await readComplete(file,options);
    return{selection,...metadata,text:new TextDecoder('utf-8',{fatal:true}).decode(data)};
  }
  function browserFile(data,file,verification) {
    const name=file.name??file.selection?.file??'sensorthings-source.bin';
    if(typeof name!=='string'||!name||name.length>255||/[\\/\u0000-\u001f\u007f]/.test(name))
      throw new ApiError('The original download filename is invalid.',{code:'FILE_NAME'});
    const blob=new Blob([data],{type:file.type??file.contentType??'application/octet-stream'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    return{filename:name,bytes:data.byteLength,sha256:file.sha256,verification};
  }
  async function download(file) {
    const selection=file.selection;if(!selection)throw new ApiError('The file list must return its original complete selection.',{code:'FILE_SELECTION'});
    const generated=selection.kind==='publisher'&&selection.file==='draft-review'&&
      file.retention==='ORIGINAL_GENERATED_READ_SESSION'&&file.verification==='SNAPSHOT_SHA_RETURNED_BY_FIRST_READ';
    if(generated&&file.sha256===null&&file.bytes===null){
      // List has no physical identity for this generated view. The first native
      // read fixes one snapshot; every chunk and the final hash use that read.
      const held=await readComplete(file,{maximum:16*1024*1024});
      return browserFile(held.data,{...held.metadata,selection},'Complete browser SHA-256 and the original generated held-read snapshot.');
    }
    if(!/^[a-f0-9]{64}$/.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<0)
      throw new ApiError('Retain the original file byte count and SHA-256 before downloading.',{code:'FILE_IDENTITY'});
    const large=file.bytes>256*1024*1024;
    let destination=null;
    if(large){
      if(!window.showSaveFilePicker)throw new ApiError('Use the installed retained-file receiver for this large file; it keeps a resumable byte/hash-bound directory.',{code:'FILE_MEMORY'});
      // Ask while the original download gesture is still active, before a
      // network round-trip. The selected file is committed only after EOF.
      destination=await window.showSaveFilePicker({suggestedName:file.name??'sensorthings-source.bin'});
    }
    const q=new URLSearchParams({selection:JSON.stringify(selection),expectedSha256:file.sha256});
    const response=await request('/api/files/download?'+q,{raw:true});
    const digest=response.headers.get('X-Source-SHA256'),length=response.headers.get('Content-Length');
    if(digest!==file.sha256||length!==null&&length!==String(file.bytes)){
      await response.body?.cancel().catch(()=>{});
      throw new ApiError('The response does not match the selected original file identity.',{code:'FILE_CHANGED'});
    }
    const reader=response.body?.getReader();
    if(!reader)throw new ApiError('The original download has no readable byte stream.',{code:'FILE_LENGTH'});
    let writer=null,count=0,complete=false;
    try{
      if(large)writer=await destination.createWritable();
      const data=large?null:new Uint8Array(file.bytes);
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        if(count+value.byteLength>file.bytes)throw new ApiError('The received stream exceeds its original manifest.',{code:'FILE_LENGTH'});
        if(writer)await writer.write(value);else data.set(value,count);count+=value.byteLength;
      }
      if(count!==file.bytes)throw new ApiError('The received file length differs from its original manifest.',{code:'FILE_LENGTH'});
      if(writer){
        await writer.close();complete=true;
        return{filename:file.name,bytes:count,sha256:digest,verification:'Original server-held descriptor SHA and complete received byte count.'};
      }
      if(await sha256(data)!==file.sha256)throw new ApiError('The downloaded bytes differ from their original manifest.',{code:'FILE_CHANGED'});
      const result=browserFile(data,file,'Complete browser SHA-256 and original manifest.');complete=true;return result;
    }finally{
      if(!complete){await reader.cancel().catch(()=>{});if(writer)await writer.abort().catch(()=>{});}
      reader.releaseLock();
    }
  }
  function openAnalysis(){
    if(pending)throw new ApiError('Reconcile this Desk’s saved request before opening analysis.',{code:'PENDING'});
    if(!workspaceId)throw new ApiError('Open the original workspace first.',{code:'WORKSPACE'});
    const target=new URL('/analysis/',location.origin);target.hash=token;
    // Same original listener and private session. No new workspace or process.
    window.open(target.href,'_blank','noopener,noreferrer');
  }
  return{open,refresh,request,act,reconcile,replay,dismissFailed,upload,download,readText,openAnalysis,
    get view(){return view;},get pending(){return pending;},get info(){return info;},
    subscribe(f){listeners.add(f);return()=>listeners.delete(f);}};
}
