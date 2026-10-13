/** Browser working-copy custody for the existing Measurements collection workflow.
 * Scientific interpretation and all native collection identities stay in the server.
 */
export const COLLECTION_WORKING_FORMAT='upper-savannah-collection-working/v1';
export const MAX_WORKING_BYTES=128*1024*1024;
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const kinds=new Set(['wqp','stations','usgs-daily','companion']);
function text(value,name,max=8192){if(typeof value!=='string'||value.length>max)throw new Error('Invalid '+name);return value;}
export function memberPath(value){
 text(value,'collection member path',1024);
 if(!value||value.startsWith('/')||value.includes('\\')||value.split('/').some(p=>!p||p==='.'||p==='..'||p.includes(':')||/[\x00-\x1f\x7f]/.test(p)))throw new Error('Choose a distinct relative collection member path.');
 return value;
}
export function freshCollectionWorking(scope){
 return {format:COLLECTION_WORKING_FORMAT,scope:text(scope,'workspace scope'),title:'',rows:[],inspected:null,pending:null,history:[],revision:0};
}
export function mappingFor(row){
 const value=JSON.parse(row.mappingText||'{}');
 if(!object(value))throw new Error('Column mapping for '+row.path+' must be a JSON object.');
 return value;
}
export function collectionDefinition(state){
 return {title:state.title,rows:state.rows.map(r=>({key:r.key,path:r.path,label:r.label,kind:r.kind,mappingText:r.mappingText,source:r.source,intakeId:r.intakeId}))};
}
export function definitionKey(state){return JSON.stringify(collectionDefinition(state));}
export function validateCollectionWorking(value,scope){
 if(!object(value)||value.format!==COLLECTION_WORKING_FORMAT)throw new Error('Choose a complete collection working file.');
 if(value.scope!==scope)throw new Error('This working file belongs to a different workspace or account. Open its original workspace to resume a pending operation. Use the complete native study handover to receive originals elsewhere.');
 text(value.title,'collection title',4096);
 if(!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.rows)||value.rows.length>1000||!Array.isArray(value.history))throw new Error('Invalid collection working history.');
 const keys=new Set();
 for(const row of value.rows){
  if(!object(row)||!id(row.key)||keys.has(row.key)||!id(row.intakeId))throw new Error('Invalid or repeated source identity.');keys.add(row.key);
  text(row.path,'unfinished collection member path',1024);
  if(!kinds.has(row.kind))throw new Error('Unknown source interpretation.');
  text(row.label,'source label',4096);text(row.mappingText,'unfinished source mapping',1024*1024);
  if(!object(row.source)||!Number.isSafeInteger(row.source.bytes)||row.source.bytes<0)throw new Error('Invalid original file size.');
  text(row.source.name,'original filename',1024);
  if(row.source.lastModified!==null&&(!Number.isSafeInteger(row.source.lastModified)||row.source.lastModified<0))throw new Error('Invalid original file date.');
  if(row.inline!==undefined&&row.inline!==null&&(!object(row.inline)||typeof row.inline.base64!=='string'||!id(row.inline.sha256)))throw new Error('Invalid retained inline original.');
  if(row.retained!==null&&!object(row.retained))throw new Error('Invalid retained source response.');
  if(row.error!==null&&typeof row.error!=='string')throw new Error('Invalid retained source error.');
 }
 if(value.inspected!==null){
  const v=value.inspected;if(!object(v)||typeof v.definition!=='string'||!object(v.request)||!object(v.response)||!id(v.response.id)||!id(v.response.reviewSha256)||!Number.isSafeInteger(v.response.workspaceRevision))throw new Error('Invalid saved complete inspection.');
 }
 if(value.pending!==null){
  const p=value.pending;
  if(!object(p)||!id(p.id)||!['POST','PUT'].includes(p.method)||typeof p.path!=='string'||!/^\/(?:large\/|collections(?:\/|$))/.test(p.path)||!object(p.payload)||typeof p.definition!=='string'||!['upload','prepare','receive','publish'].includes(p.kind)||typeof p.at!=='string')throw new Error('Invalid saved original request.');
  if(p.rowKey!==null&&!keys.has(p.rowKey))throw new Error('The pending operation lost its original source row.');
 }
 for(const item of value.history)if(!object(item)||typeof item.at!=='string'||typeof item.kind!=='string'||!object(item.request)||!object(item.response))throw new Error('Invalid original operation history.');
  if(value.pending){
  const p=value.pending,row=value.rows.find(r=>r.key===p.rowKey),rid=row?.intakeId;
  const allowed=row ? (p.path==='/large/intakes'&&p.method==='POST'&&p.payload.id===rid)||(p.path==='/large/intakes/'+rid&&p.method==='PUT')||(p.path==='/large/intakes/'+rid+'/chunks'&&p.method==='PUT')||(p.path==='/large/intakes/'+rid+'/prepare'&&p.method==='POST') : p.method==='POST'&&(['/large/collections/preview','/large/collections/receive'].includes(p.path)||/^\/large\/collections\/[a-f0-9]{64}\/publish$/.test(p.path));
  if(!allowed)throw new Error('The saved request does not select an original collection operation.');
 }
 return clone(value);
}
export function addCollectionSources(state,files,makeId){
 if(state.pending)throw new Error('Resolve the saved original request before changing the source set.');
 if(state.rows.length+files.length>1000)throw new Error('A collection working copy supports at most 1000 original members; the current set is retained.');
 const names=new Set(state.rows.map(r=>r.path)),added=[];
 for(const f of files){
  const path=memberPath(f.name);
  if(names.has(path))throw new Error('The source set already has '+path+'. Reselect its original using that row, or change the member name before adding a distinct file.');
  if(!Number.isSafeInteger(f.size)||f.size<0)throw new Error('Invalid original file size.');
  names.add(path);added.push({key:makeId(),intakeId:makeId(),path,label:path,kind:'companion',mappingText:'{}',source:{name:f.name,bytes:f.size,lastModified:Number.isSafeInteger(f.lastModified)?f.lastModified:null},retained:null,inline:null,error:null});
 }
 state.rows.push(...added);state.inspected=null;state.revision++;return added;
}
export function editCollectionWorking(state,change){
 if(state.pending)throw new Error('Resolve the saved original request before editing its selected inputs.');
 change(state);state.inspected=null;state.revision++;return state;
}
export function retainCollectionRequest(state,{id,path,method='POST',payload,kind,rowKey=null,at}){
 if(state.pending)throw new Error('The original request is still pending; resume that same request.');
 state.pending={id,path,method,payload:clone(payload),kind,rowKey,at,definition:definitionKey(state)};
 state.revision++;return clone(state.pending);
}
export function acceptCollectionResponse(state,pendingId,response,at){
 if(!state.pending||state.pending.id!==pendingId)throw new Error('The reply belongs to another retained operation.');
 const p=state.pending;
 // Acknowledged upload chunks remain in the native intake; keep only the live
 // pending chunk in this working file rather than rebuilding the source in memory.
 if(p.kind!=='upload'){
  const record=clone(p);
  if(Array.isArray(record.payload.files))record.payload.files=record.payload.files.map(file=>{const next={...file};if('base64' in next||'text' in next){delete next.base64;delete next.text;next.originalBodyInWorkingSources=true;}return next;});
  state.history.push({at,kind:p.kind,request:record,response:clone(response)});
 }
 state.pending=null;state.revision++;return p;
}
export function saveCollectionInspection(state,request,response){
 state.inspected={definition:definitionKey(state),request:clone(request),response:clone(response)};
 state.revision++;return state.inspected;
}
export function validateCollectionDefinition(state){
 if(!state.title.trim()||!state.rows.length)throw new Error('Give the complete collection a title and at least one original file.');
 const paths=new Set();
 for(const row of state.rows){memberPath(row.path);if(paths.has(row.path))throw new Error('Duplicate collection member path: '+row.path);paths.add(row.path);mappingFor(row);}
 return collectionDefinition(state);
}
export function preserveUnresolvedCollectionRequest(state,at){
 if(!state.pending)return null;
 const old=clone(state.pending);state.history.push({at,kind:'unresolved-request',request:old,response:{complete:false,reason:'Operator retained this request and opened a fresh review; inspect its native operation for completed members.'}});
 state.pending=null;state.inspected=null;state.revision++;return old;
}
export function reviewedCollectionRequest(state){
 if(!state.inspected||state.inspected.definition!==definitionKey(state))throw new Error('Inspect the current complete collection before receiving it.');
 return {...clone(state.inspected.request),expectedId:state.inspected.response.id,expectedReviewSha256:state.inspected.response.reviewSha256,expectedRevision:state.inspected.response.workspaceRevision};
}
export function exportCollectionWorking(state){
 return JSON.stringify(validateCollectionWorking(state,state.scope),null,2)+'\n';
}

/** Complete in-memory host custody; downloaded working files keep their original format. */
export function captureCollectionSession({state,knownRevision=null,storageBlocked=false,storageMessage='',dirty=false}){
 return restoreCollectionSession({format:'upper-savannah-collection-session/v1',state,knownRevision,storageBlocked,storageMessage,dirty},state.scope);
}
export function restoreCollectionSession(value,scope){
 if(!object(value)||value.format!=='upper-savannah-collection-session/v1')throw new Error('The retained collection session is incomplete.');
 if(value.knownRevision!==null&&(typeof value.knownRevision!=='string'||!value.knownRevision))throw new Error('The retained collection persistence lease is invalid.');
 if(typeof value.storageBlocked!=='boolean'||typeof value.dirty!=='boolean'||typeof value.storageMessage!=='string')throw new Error('The retained collection persistence state is invalid.');
 return {format:value.format,state:validateCollectionWorking(value.state,scope),knownRevision:value.knownRevision,storageBlocked:value.storageBlocked,storageMessage:value.storageMessage,dirty:value.dirty};
}
