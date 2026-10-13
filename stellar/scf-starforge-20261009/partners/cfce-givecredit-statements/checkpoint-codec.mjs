// MIT. Lossless checkpoint projection; source editions and source hashes do not change.
export const CHECKPOINT_SCHEMA='stellar-forge.givecredit-checkpoint.v1';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const fail=message=>{throw Object.assign(new Error(message),{code:'CAPTURE_CHECKPOINT_INVALID'});};
const assign=(object,key,value)=>Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true});
const identityKey=path=>JSON.stringify(path);
export function checkpointIdentity(source){
  if(!plain(source)||source.schema!=='stellar-forge.givecredit-source.v1'||!['registry','ledger'].includes(source.kind)||
    !plain(source.metadata)||!plain(source.files)||!Array.isArray(source.responses)||!plain(source.tables))
    fail('Receive the complete original registry or ledger checkpoint.');
  return {kind:source.kind,selection:source.metadata.selection||null,startedAt:source.metadata.startedAt||null};
}
function originalString(path){
  return path[0]==='files'&&path.length===2||
    path[0]==='responses'&&path.length===3&&path[2]==='content'||
    path[0]==='tables'&&path[1]==='transactions'&&path.length===4&&
      ['envelopeXdr','resultXdr','resultMetaXdr'].includes(path[3]);
}
/** identify(text) returns the exact immutable encoded-string object identity. */
export function projectCheckpoint(source,identify,{threshold=16384}={}){
  checkpointIdentity(source);
  if(typeof identify!=='function')fail('Provide a checkpoint string identity function.');
  const references=[],objects=new Map(),ancestors=new Set();
  function visit(value,path,depth){
    if(depth>512)fail('The source document exceeds the supported nesting depth.');
    if(typeof value==='string'&&!(path[0]==='metadata'&&['selection','startedAt'].includes(path[1]))&&(originalString(path)||value.length>=threshold)){
      const object=identify(value);
      if(!object||!/^[a-f0-9]{64}$/.test(object.sha256)||!Number.isSafeInteger(object.bytes)||object.bytes<2)
        fail('Keep the complete encoded original string identity.');
      references.push({path,sha256:object.sha256,bytes:object.bytes});
      if(!objects.has(object.sha256))objects.set(object.sha256,{...object,content:value});
      return null;
    }
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?(Object.is(value,-0)?0:value):null;
    if(typeof value==='bigint')fail('Source integer quantities must remain exact strings.');
    if(value===undefined||typeof value==='function'||typeof value==='symbol')return undefined;
    if(!plain(value)&&!Array.isArray(value))fail('Keep the checkpoint as its original JSON document.');
    if(ancestors.has(value))fail('Checkpoint documents cannot contain cycles.');
    ancestors.add(value);
    let result;
    if(Array.isArray(value))result=Array.from({length:value.length},(_,index)=>visit(value[index],[...path,index],depth+1)??null);
    else{
      result={};
      for(const key of Object.keys(value)){
        const item=visit(value[key],[...path,key],depth+1);
        if(item!==undefined)assign(result,key,item);
      }
    }
    ancestors.delete(value);return result;
  }
  return {checkpoint:visit(source,[],0),references,objects:[...objects.values()]};
}
export function validateCheckpointManifest(manifest){
  if(!plain(manifest)||manifest.schema!==CHECKPOINT_SCHEMA||!Number.isSafeInteger(manifest.generation)||manifest.generation<1||
    !plain(manifest.checkpoint)||!Array.isArray(manifest.references)||!plain(manifest.identity)||
    typeof manifest.savedAt!=='string')fail('Open a complete committed checkpoint manifest.');
  if(manifest.imports!==undefined){
    if(!Array.isArray(manifest.imports))fail('Keep the complete original checkpoint import journal.');
    const seen=new Set();
    for(const row of manifest.imports){
      if(!plain(row)||typeof row.requestId!=='string'||!row.requestId||row.requestId.length>160||seen.has(row.requestId)||
        typeof row.actor!=='string'||!row.actor||row.actor.length>300||!['ledger','registry'].includes(row.kind)||
        !/^[a-f0-9]{64}$/.test(row.sourceSha256||'')||!Number.isSafeInteger(row.sourceBytes)||row.sourceBytes<1||
        !Number.isSafeInteger(row.generation)||row.generation<1||row.generation>manifest.generation||
        typeof row.savedAt!=='string'||!plain(row.result)||row.result.generation!==row.generation)
        fail('Restore the exact committed checkpoint import request and result.');
      seen.add(row.requestId);
    }
  }
  const identity=checkpointIdentity(manifest.checkpoint);
  if(JSON.stringify(identity)!==JSON.stringify(manifest.identity))fail('The checkpoint source identity changed.');
  const paths=new Set(),objects=new Map();
  for(const ref of manifest.references){
    if(!plain(ref)||!Array.isArray(ref.path)||!ref.path.length||ref.path.some(k=>typeof k!=='string'&&(!Number.isSafeInteger(k)||k<0))||
      !/^[a-f0-9]{64}$/.test(ref.sha256||'')||!Number.isSafeInteger(ref.bytes)||ref.bytes<2)
      fail('Retain each exact checkpoint string reference.');
    const key=identityKey(ref.path);if(paths.has(key))fail('The checkpoint repeats a source string location.');paths.add(key);
    let node=manifest.checkpoint;
    for(const part of ref.path){
      if(node===null||typeof node!=='object'||!own(node,part))fail('A checkpoint string location is absent.');
      node=node[part];
    }
    if(node!==null)fail('A checkpoint string location was replaced.');
    if(objects.has(ref.sha256)&&objects.get(ref.sha256)!==ref.bytes)fail('A retained object has conflicting sizes.');
    objects.set(ref.sha256,ref.bytes);
  }
  return manifest;
}
/** Hydrate only explicitly declared paths; arbitrary source keys remain ordinary data. */
export function restoreCheckpoint(manifest,readString){
  validateCheckpointManifest(manifest);
  const result=structuredClone(manifest.checkpoint),cache=new Map();
  for(const ref of manifest.references){
    if(!cache.has(ref.sha256)){
      const text=readString(ref);
      if(typeof text!=='string')fail('Receive the complete retained source string.');
      cache.set(ref.sha256,text);
    }
    let parent=result;
    for(const part of ref.path.slice(0,-1))parent=parent[part];
    assign(parent,ref.path.at(-1),cache.get(ref.sha256));
  }
  checkpointIdentity(result);return result;
}
