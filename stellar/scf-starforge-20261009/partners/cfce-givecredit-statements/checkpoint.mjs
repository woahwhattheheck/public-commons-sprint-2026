// MIT. Durable incremental checkpoint storage over unchanged complete source editions.
import {constants} from 'node:fs';
import {open,lstat,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {privateDirectory,operationLease} from '../../distribution/runtime-workspace/storage.mjs';
import {CHECKPOINT_SCHEMA,checkpointIdentity,projectCheckpoint,restoreCheckpoint,validateCheckpointManifest} from './checkpoint-codec.mjs';
import {jsonIdentity,fileIdentity,writeJSONFile,readJSONDocument,withNativeDocumentWrite} from './native-json.mjs';
export {CHECKPOINT_SCHEMA};
const HASH=/^[a-f0-9]{64}$/;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const maximum=512*1024*1024;
async function directory(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  return privateDirectory(path);
}
async function optional(path){try{return await readJSONDocument(path,maximum);}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}
const manifestStats=manifest=>({
  schema:CHECKPOINT_SCHEMA,kind:manifest.identity.kind,generation:manifest.generation,savedAt:manifest.savedAt,
  sourceStatus:manifest.checkpoint.metadata.status||null,phase:manifest.progress?.phase||null,
  responses:manifest.checkpoint.responses.length,sourceFiles:Object.keys(manifest.checkpoint.files).length,
  tables:Object.fromEntries(Object.entries(manifest.checkpoint.tables).map(([name,rows])=>[name,Array.isArray(rows)?rows.length:0])),
  ...manifest.storage,
});
/**
 * Objects are immutable JSON-encoded strings, hashed and written once. The atomic
 * manifest is the commit point. Unreferenced objects left by interruption are safe
 * to retain and may be reused by the next save; the prior manifest stays readable.
 */
export class CaptureCheckpointStore{
  constructor(directoryPath,{legacyPath,expectedKind}={}){
    if(expectedKind!==undefined&&!['registry','ledger'].includes(expectedKind))fail('CAPTURE_KIND','Choose registry or ledger checkpoint storage.');
    this.expectedKind=expectedKind;
    this.directory=directoryPath;this.manifestPath=join(directoryPath,'checkpoint.json');
    this.legacyPath=legacyPath?resolve(legacyPath):null;this.identities=new Map();this.verified=new Set();
    this.queue=Promise.resolve();this.lastStatus=null;
  }
  static async open(directoryPath,options={}){
    directoryPath=resolve(directoryPath);await privateDirectory(dirname(directoryPath));
    await withNativeDocumentWrite(join(dirname(directoryPath),'.capture-directory'),async()=>{
      await directory(directoryPath);await directory(join(directoryPath,'objects'));
    });
    return new CaptureCheckpointStore(directoryPath,options);
  }
  acceptSource(source){const identity=checkpointIdentity(source);if(this.expectedKind&&identity.kind!==this.expectedKind)fail('CAPTURE_KIND','The original checkpoint kind does not match the selected capture store.');return identity;}
  objectPath(sha256){if(!HASH.test(sha256))fail('CAPTURE_OBJECT_ID','Use the exact original object identity.');return join(this.directory,'objects',sha256+'.json');}
  serial(work){const result=this.queue.then(work);this.queue=result.catch(()=>{});return result;}
  async status(){
    await this.queue;const manifest=await optional(this.manifestPath);
    if(manifest){validateCheckpointManifest(manifest);return {...manifestStats(manifest),directory:this.directory,manifest:this.manifestPath};}
    if(this.legacyPath){
      try{const identity=await fileIdentity(this.legacyPath,maximum);return {schema:'stellar-forge.givecredit-legacy-checkpoint.v1',legacy:true,file:this.legacyPath,...identity};}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return null;
  }
  async load(){
    await this.queue;
    const manifest=await optional(this.manifestPath);
    if(!manifest){
      if(!this.legacyPath)return undefined;
      const source=await optional(this.legacyPath);if(source)this.acceptSource(source);return source;
    }
    validateCheckpointManifest(manifest);
    const strings=new Map();
    for(const ref of manifest.references)if(!strings.has(ref.sha256)){
      const path=this.objectPath(ref.sha256),actual=await fileIdentity(path,maximum);
      if(actual.bytes!==ref.bytes||actual.sha256!==ref.sha256)fail('CAPTURE_OBJECT_CHANGED','Restore the original complete checkpoint object '+ref.sha256+'.');
      const content=await readJSONDocument(path,maximum);
      if(typeof content!=='string')fail('CAPTURE_OBJECT_TYPE','A retained checkpoint object must contain its complete original string.');
      const received=jsonIdentity(content);if(received.sha256!==ref.sha256||received.bytes!==ref.bytes)fail('CAPTURE_OBJECT_CHANGED','The original object changed between reading and receiving.');
      strings.set(ref.sha256,content);this.identities.set(content,{sha256:ref.sha256,bytes:ref.bytes});this.verified.add(ref.sha256);
    }
    const source=restoreCheckpoint(manifest,ref=>strings.get(ref.sha256));this.acceptSource(source);
    this.lastStatus={...manifestStats(manifest),directory:this.directory,manifest:this.manifestPath};
    return source;
  }
  save(source,{phase=null,provenance=null,request=null}={}){
    // Native acquisition awaits each save before mutating its borrowed checkpoint.
    return this.serial(()=>withNativeDocumentWrite(this.manifestPath,async()=>{
      const lock=join(this.directory,'.writer');
      try{const file=await open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);await file.close();}
      catch(error){if(error.code!=='EEXIST')throw error;}
      const lease=await operationLease(lock);
      try{
        const prior=await optional(this.manifestPath);if(prior)validateCheckpointManifest(prior);
        const identity=this.acceptSource(source),captureKey=JSON.stringify(identity);
        const imports=prior?.imports||[];
        let importIntent=null;
        if(request){
          if(typeof request.requestId!=='string'||!request.requestId||request.requestId.length>160||
             typeof request.actor!=='string'||!request.actor||request.actor.length>300)
            fail('CAPTURE_IMPORT_REQUEST','Keep the original import request ID and operator.');
          const original=jsonIdentity(source,{canonical:true});
          importIntent={requestId:request.requestId,actor:request.actor,kind:identity.kind,
            sourceSha256:original.sha256,sourceBytes:original.bytes};
          const previous=imports.find(row=>row.requestId===request.requestId);
          if(previous){
            for(const key of Object.keys(importIntent))if(previous[key]!==importIntent[key])
              fail('REQUEST_REUSED','This checkpoint request belongs to another exact original source or operator.');
            return {...manifestStats(prior),directory:this.directory,manifest:this.manifestPath,
              operation:previous,replayed:true};
          }
        }
        if(this.captureKey&&this.captureKey!==captureKey)this.identities.clear();
        this.captureKey=captureKey;
        const projection=projectCheckpoint(source,text=>{
          let item=this.identities.get(text);
          if(!item){item=jsonIdentity(text);this.identities.set(text,item);}
          return item;
        });
        let writtenObjects=0,writtenBytes=0,reusedBytes=0;
        for(const object of projection.objects){
          const path=this.objectPath(object.sha256);
          if(!this.verified.has(object.sha256)){
            try{
              const written=await writeJSONFile(path,object.content,{pretty:false,newline:false});
              if(written.sha256!==object.sha256||written.bytes!==object.bytes)fail('CAPTURE_OBJECT_WRITE','The complete source object write changed.');
              writtenObjects++;writtenBytes+=written.bytes;
            }catch(error){
              if(error.code!=='EEXIST')throw error;
              const actual=await fileIdentity(path,maximum);
              if(actual.bytes!==object.bytes||actual.sha256!==object.sha256)fail('CAPTURE_OBJECT_CHANGED','The original checkpoint object was replaced.');
              reusedBytes+=object.bytes;
            }
            this.verified.add(object.sha256);
          }else reusedBytes+=object.bytes;
        }
        const manifest={schema:CHECKPOINT_SCHEMA,generation:(prior?.generation||0)+1,savedAt:new Date().toISOString(),
          identity,progress:{phase},checkpoint:projection.checkpoint,references:projection.references,
          provenance:provenance||(prior&&JSON.stringify(prior.identity)===captureKey?prior.provenance:null)||null,
          imports:[...imports],
          storage:{objects:projection.objects.length,objectBytes:projection.objects.reduce((n,row)=>n+row.bytes,0),
            references:projection.references.length,writtenObjects,writtenBytes,reusedBytes}};
        if(importIntent)manifest.imports.push({...importIntent,generation:manifest.generation,savedAt:manifest.savedAt,
          result:{kind:identity.kind,generation:manifest.generation,savedAt:manifest.savedAt,sourceStatus:source.metadata.status||null}});
        const written=await writeJSONFile(this.manifestPath,manifest,{replace:true,pretty:false});
        this.lastStatus={...manifestStats(manifest),manifestBytes:written.bytes,manifestSha256:written.sha256,directory:this.directory,manifest:this.manifestPath};
        return importIntent?{...this.lastStatus,operation:manifest.imports.at(-1),replayed:false}:this.lastStatus;
      }finally{await lease.close();}
    }));
  }
  async operation(requestId){
    await this.queue;const manifest=await optional(this.manifestPath);
    if(!manifest)return null;validateCheckpointManifest(manifest);
    return manifest.imports?.find(row=>row.requestId===requestId)||null;
  }
  releaseMemory(){this.identities.clear();}
  async importLegacy(path){
    path=resolve(path);
    const before=await fileIdentity(path,maximum),source=await readJSONDocument(path,maximum),after=await fileIdentity(path,maximum);
    if(before.sha256!==after.sha256||before.bytes!==after.bytes)fail('CAPTURE_LEGACY_CHANGED','The original checkpoint changed during migration.');
    this.acceptSource(source);
    const originalIdentity=jsonIdentity(source);
    const saved=await this.save(source,{phase:'legacy-import',provenance:{kind:'original-checkpoint-file',file:path,...before,importedAt:new Date().toISOString()}});
    const received=await new CaptureCheckpointStore(this.directory,{expectedKind:this.expectedKind}).load(),receivedIdentity=jsonIdentity(received);
    if(originalIdentity.sha256!==receivedIdentity.sha256||originalIdentity.bytes!==receivedIdentity.bytes)
      fail('CAPTURE_MIGRATION_CHANGED','The complete restored checkpoint differs from the original saved source.');
    return {...saved,verifiedSource:originalIdentity,originalFile:before};
  }
  async export(path){
    const source=await this.load();if(!source)fail('CAPTURE_CHECKPOINT_MISSING','Acquire or import an original checkpoint first.');
    const written=await writeJSONFile(resolve(path),source,{replace:false,pretty:true});
    return {...written,sourceIdentity:checkpointIdentity(source),status:await this.status()};
  }
}
export async function readCaptureCheckpoint(path){
  path=resolve(path);const info=await lstat(path);
  if(info.isSymbolicLink())fail('CAPTURE_CHECKPOINT_PATH','Choose the original regular checkpoint or private checkpoint directory.');
  if(info.isDirectory()){
    await privateDirectory(path);
    const store=new CaptureCheckpointStore(path);return store.load();
  }
  const source=await readJSONDocument(path,maximum);
  if(source?.schema===CHECKPOINT_SCHEMA){
    if(path!==join(dirname(path),'checkpoint.json'))fail('CAPTURE_MANIFEST_PATH','Open the checkpoint manifest beside its complete objects directory.');
    await privateDirectory(dirname(path));return new CaptureCheckpointStore(dirname(path)).load();
  }
  checkpointIdentity(source);return source;
}
