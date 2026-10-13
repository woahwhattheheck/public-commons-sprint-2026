import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, openSync, closeSync, readSync, writeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { hashFile } from './objects.mjs';
import { clone, canonical, sha, identity, now, id, digest, integer, text, requireValue, collectSourceFiles, safeRelative, atomicBytes, fsyncDirectory } from './common.mjs';

const SCHEMA='tjlabs.sling-portable.v2',LEGACY='tjlabs.sling-portable.v1',MAX_UNPACKED=8*1024*1024*1024,CHUNK=1024*1024,MAX_HEADER=64*1024*1024;
const requestKey=row=>row.actor_id+'\0'+row.request_id;
const isFlat=record=>record.portableSchema===SCHEMA;
function addObject(found,value){
  if(!value)return;
  requireValue(value.sha256&&Number.isSafeInteger(value.bytes),'OBJECT_MANIFEST','A retained object descriptor is incomplete.',409);
  digest(value.sha256);integer(value.bytes,'object bytes');
  const old=found.get(value.sha256);requireValue(!old||old.bytes===value.bytes,'OBJECT_MANIFEST','One retained hash has inconsistent lengths.',409);
  found.set(value.sha256,{sha256:value.sha256,bytes:value.bytes});
}
function addDelivery(found,record){
  if(isFlat(record)){
    addObject(found,{sha256:record.headerSha256,bytes:record.headerBytes});
    // A historical intent may be newer than its selected version prefix.
    // Retain that frozen source edition through the sealed record itself.
    for(const source of record.sourceManifest??[])addObject(found,source);
  }else addObject(found,record); // Original v1 keeps its literal complete archive closure.
}
function objectsIn(state){
  const found=new Map(),add=value=>addObject(found,value);
  for(const s of state.sources)add(s);
  for(const p of state.plans){add(p.compiled);if(p.replication)add(p.replication);}
  if(state.runtime?.archive)add(state.runtime.archive);
  for(const j of state.jobs){add(j.selection);add(j.replication);if(j.runtime?.archive)add(j.runtime.archive);for(const v of j.files??[])add(v);}
  for(const c of state.comparisons){add(c.observations);add(c.report);}
  for(const c of state.cutovers){add(c.selection?.snapshot);add(c.previous?.snapshot);}
  for(const c of state.downstreamPlans??[]){add(c.originalFiles);add(c.edits);add(c.plan);}
  for(const c of state.downstreamOperations??[]){for(const v of c.files??[])add(v);for(const v of c.consumerBinding?.initialFiles??[])add(v);}
  for(const h of state.handoffs??[]){if(h.sha256)addDelivery(found,h);for(const source of h.sourceManifest??[])add(source);}
  return found;
}
function validateHeader(header){
  requireValue(header?.type==='header'&&[SCHEMA,LEGACY].includes(header.schema),'HANDOFF_SCHEMA','Select a complete original Sling migration portable.',409);
  id(header.projectId,'projectId');integer(header.revision,'revision');integer(header.requestCount,'request count');
  requireValue(Array.isArray(header.versionManifest)&&header.versionManifest.length===header.revision+1&&Array.isArray(header.sourceManifest)&&Array.isArray(header.objectManifest),'HANDOFF_MANIFEST','The complete version/source/object manifests are required.',409);
  const intent=header.handoff;
  requireValue(intent&&intent.projectId===header.projectId&&intent.revision===header.revision&&Array.isArray(header.deliveryManifest),'HANDOFF_INTENT','The complete original handoff intent and sealed delivery manifest are required.',409);
  id(intent.id,'handoffId');integer(intent.intentRevision,'intentRevision');text(intent.title,'handoff title',{min:1,max:300});text(intent.notes??'','handoff notes',{max:10000});
  requireValue(canonical(intent.sourceManifest)===canonical(header.sourceManifest)&&intent.createdAt===header.createdAt&&intent.instanceId===header.instanceId,'HANDOFF_INTENT','The original handoff source or creation identity differs.',409);
  if(header.schema===SCHEMA)requireValue(intent.portableSchema===SCHEMA,'HANDOFF_SCHEMA','The original intent must select the canonical v2 format.',409);
  const deliveries=new Set();
  for(const delivery of header.deliveryManifest){
    id(delivery.id,'handoffId');digest(delivery.sha256);digest(delivery.headerSha256);integer(delivery.bytes,'handoff bytes',{max:4*1024*1024*1024});integer(delivery.revision,'handoff revision',{max:header.revision});
    requireValue(delivery.projectId===header.projectId&&delivery.status==='complete'&&delivery.id!==intent.id&&!deliveries.has(delivery.id),'HANDOFF_DELIVERY','A sealed prior handoff has another project, duplicate ID or invalid state.',409);deliveries.add(delivery.id);
    if(isFlat(delivery))integer(delivery.headerBytes,'original header bytes',{min:1,max:MAX_HEADER});
    if(header.schema===LEGACY)requireValue(!isFlat(delivery),'HANDOFF_LEGACY_DELIVERY','A legacy v1 archive cannot introduce a later v2 delivery.',409);
  }
  const sources=new Set();for(const s of header.sourceManifest){safeRelative(s.path);digest(s.sha256);integer(s.bytes,'source bytes',{max:MAX_HEADER});requireValue(!sources.has(s.path),'HANDOFF_SOURCE_DUPLICATE','Duplicate editable source path.',409);sources.add(s.path);}
  const hashes=new Set();for(const o of header.objectManifest){digest(o.sha256);integer(o.bytes,'object bytes',{max:4*1024*1024*1024});requireValue(!hashes.has(o.sha256),'HANDOFF_OBJECT_DUPLICATE','Duplicate retained object identity.',409);hashes.add(o.sha256);}
  for(const [i,v] of header.versionManifest.entries()){requireValue(v.revision===i,'HANDOFF_HISTORY','The original version manifest must be a complete ordered prefix.',409);digest(v.sha256);requireValue(v.parentSha256===(i?header.versionManifest[i-1].sha256:null),'HANDOFF_HISTORY','The selected version-parent manifest differs.',409);}
  if(header.schema===SCHEMA){
    requireValue(Array.isArray(header.requestManifest)&&header.requestManifest.length===header.requestCount,'HANDOFF_REQUEST_MANIFEST','Every original request row must be frozen by identity.',409);
    const keys=new Set();for(const row of header.requestManifest){id(row.actorId,'actorId');id(row.requestId,'requestId');digest(row.sha256);const key=row.actorId+'\0'+row.requestId;requireValue(!keys.has(key),'HANDOFF_REQUEST_DUPLICATE','Duplicate request in the frozen original manifest.',409);keys.add(key);}
  }
}
function selectedRows(header,versions,requests){
  const versionMap=new Map(versions.map(row=>[Number(row.revision),row])),requestMap=new Map(requests.map(row=>[requestKey(row),row]));
  const selectedVersions=header.versionManifest.map(meta=>{
    const row=versionMap.get(meta.revision);
    requireValue(row&&row.project_id===header.projectId&&row.sha256===meta.sha256&&row.parent_sha256===meta.parentSha256&&sha(Buffer.from(row.state_json))===meta.sha256,'HANDOFF_HISTORY','The frozen handoff version is not in the received original prefix.',409);
    return row;
  });
  const selectedRequests=header.schema===SCHEMA?header.requestManifest.map(meta=>{
    const row=requestMap.get(meta.actorId+'\0'+meta.requestId);
    requireValue(row&&row.project_id===header.projectId&&Number(row.revision)<=header.revision&&identity(row)===meta.sha256,'HANDOFF_REQUEST_IDENTITY','The exact request selected by this original handoff is missing or changed.',409);
    return row;
  }):requests.filter(row=>Number(row.revision)<=header.revision);
  requireValue(selectedRequests.length===header.requestCount,'HANDOFF_REQUEST_COUNT','The original frozen request population differs.',409);
  return{versions:selectedVersions,requests:selectedRequests};
}
function exactClosure(header,versions){
  const found=new Map();for(const row of versions)for(const [hash,entry] of objectsIn(JSON.parse(row.state_json)))addObject(found,entry);
  for(const source of header.sourceManifest)addObject(found,source);
  for(const delivery of header.deliveryManifest)addDelivery(found,delivery);
  requireValue(canonical([...found.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)))===canonical(header.objectManifest),'HANDOFF_OBJECT_CLOSURE','The portable must carry exactly its complete original project object closure.',409);
}
function* fileChunks(path,bytes){
  const fd=openSync(path,'r'),buffer=Buffer.alloc(Math.min(CHUNK,Math.max(1,bytes)));let offset=0;
  try{while(offset<bytes){const length=Math.min(buffer.length,bytes-offset);let got=0;while(got<length){const n=readSync(fd,buffer,got,length-got,offset+got);requireValue(n>0,'OBJECT_TRUNCATED','An original retained object ended before its selected length.',409);got+=n;}yield{offset,body:Buffer.from(buffer.subarray(0,length))};offset+=length;}if(bytes===0)yield{offset:0,body:Buffer.alloc(0)};}
  finally{closeSync(fd);}
}
function* records(header,context){
  const rows=selectedRows(header,context.versions,context.requests);let count=0;const emit=value=>{count++;return Buffer.from(canonical(value)+'\n');};
  yield emit(header);
  for(const row of rows.versions)yield emit({type:'version',row});
  for(const row of rows.requests)yield emit({type:'request',row});
  for(const source of header.sourceManifest){
    const body=context.read(source.sha256,source.bytes);
    requireValue(body.length===source.bytes&&sha(body)===source.sha256,'HANDOFF_SOURCE','The exact frozen editable source is unavailable.',409);
    yield emit({type:'source',path:source.path,sha256:source.sha256,bytes:source.bytes,data:body.toString('base64')});
  }
  for(const object of header.objectManifest){
    let offset=0;const hash=createHash('sha256');
    for(const chunk of context.chunks(object)){
      requireValue(chunk.offset===offset&&chunk.body.length===Math.min(CHUNK,object.bytes-offset),'OBJECT_CHUNK_IDENTITY','The original canonical object chunk differs.',409);
      hash.update(chunk.body);yield emit({type:'object',sha256:object.sha256,offset,data:chunk.body.toString('base64')});offset+=chunk.body.length;
    }
    requireValue(offset===object.bytes&&hash.digest('hex')===object.sha256,'OBJECT_IDENTITY_CHANGED','The original object changed while reproducing its named handoff.',409);
  }
  yield Buffer.from(canonical({type:'complete',headerSha256:identity(header),records:count})+'\n');
}
function streamIdentity(header,context){
  const hash=createHash('sha256');let bytes=0;
  for(const body of records(header,context)){hash.update(body);bytes+=body.length;}
  return{sha256:hash.digest('hex'),bytes};
}
function plainContext(path,index,manifest,versions,requests){
  const expected=new Map(manifest.map(o=>[o.sha256,o]));
  function* chunks(object){
    requireValue(expected.get(object.sha256)?.bytes===object.bytes&&index.has(object.sha256),'HANDOFF_OBJECT_MISSING','The exact prior handoff object is absent from the complete received pool.',409);
    const fd=openSync(path,'r');
    try{for(const span of index.get(object.sha256)){
      const body=Buffer.alloc(span.bytes);let got=0;while(got<body.length){const n=readSync(fd,body,got,body.length-got,span.offset+got);requireValue(n>0,'HANDOFF_TRUNCATED','The received canonical record ended early.',409);got+=n;}
      const row=JSON.parse(body.toString('utf8'));requireValue(row.type==='object'&&row.sha256===object.sha256,'HANDOFF_OBJECT_CHANGED','The original received object index changed.',409);
      yield{offset:row.offset,body:Buffer.from(row.data,'base64')};
    }}finally{closeSync(fd);}
  }
  const read=(hash,bytes)=>{requireValue(bytes<=MAX_HEADER,'HANDOFF_SOURCE_SIZE','The retained header or editable source exceeds its declared limit.',413);const result=Buffer.concat([...chunks({sha256:hash,bytes})].map(x=>x.body));requireValue(result.length===bytes&&sha(result)===hash,'HANDOFF_OBJECT_HASH','The original retained header or source object differs.',409);return result;};
  return{versions,requests,read,chunks};
}
export class Archives {
  constructor(workspace){this.workspace=workspace;this.store=workspace.store;this.runtime=workspace.runtime;this.root=join(this.store.directory,'portable');this.generating=new Map();mkdirSync(this.root,{recursive:true,mode:0o700});}
  async assertClosed(projectId){await this.workspace.assertIdle(projectId);}
  context(header){
    const objects=this.store.objects,store=this.store;
    return{versions:store.versions(header.projectId,header.revision),requests:store.requests(header.projectId,header.revision),
      read:(hash,bytes)=>objects.read(hash,bytes),
      *chunks(object){store.assert();objects.verify(object.sha256,object.bytes);yield*fileChunks(objects.path(object.sha256),object.bytes);}};
  }
  headerFor(record,context){
    requireValue(isFlat(record),'HANDOFF_HEADER_FORMAT','Only canonical v2 deliveries select a separate frozen header.',409);
    const body=context?context.read(record.headerSha256,record.headerBytes):this.store.objects.read(record.headerSha256,record.headerBytes);
    const header=JSON.parse(body.toString('utf8'));validateHeader(header);
    requireValue(header.schema===SCHEMA&&body.equals(Buffer.from(canonical(header)))&&canonical(this.sealedRecord(header,record))===canonical(record),'HANDOFF_HEADER_IDENTITY','The retained original header does not reproduce this exact sealed handoff.',409);
    return header;
  }
  validateNamed(header,context,archive){
    const rows=selectedRows(header,context.versions,context.requests);exactClosure(header,rows.versions);
    const deliveries=new Map(header.deliveryManifest.map(record=>[record.id,record]));
    for(const record of header.deliveryManifest){
      if(!isFlat(record))continue; // Legacy complete gzip bytes remain an ordinary verified object.
      const prior=this.headerFor(record,context),selected=selectedRows(prior,context.versions,context.requests);exactClosure(prior,selected.versions);
      for(const before of prior.deliveryManifest)requireValue(deliveries.has(before.id)&&canonical(deliveries.get(before.id))===canonical(before),'HANDOFF_DELIVERY_PREFIX','A prior named package selects a different sealed delivery history.',409);
      const reproduced=streamIdentity(prior,context);
      requireValue(reproduced.sha256===record.sha256&&reproduced.bytes===record.bytes,'HANDOFF_NAMED_IDENTITY','The complete received pool cannot reproduce an original named package byte-for-byte.',409,{handoffId:record.id});
    }
    if(archive){const reproduced=streamIdentity(header,context);requireValue(reproduced.sha256===archive.sha256&&reproduced.bytes===archive.bytes,'HANDOFF_CANONICAL_IDENTITY','The v2 portable differs from its exact canonical original stream.',409);}
  }
  frozenHeader(intent){
    const path=join(this.root,intent.id+'.header.json');
    if(existsSync(path)){
      const body=readFileSync(path),header=JSON.parse(body.toString('utf8'));validateHeader(header);
      requireValue(header.schema===SCHEMA&&body.equals(Buffer.from(canonical(header)))&&canonical(header.handoff)===canonical(intent),'HANDOFF_CANDIDATE_CHANGED','The original frozen candidate header selects another handoff.',409);
      this.store.objects.put(body);return header;
    }
    const versions=this.store.versions(intent.projectId,intent.revision),requests=this.store.requests(intent.projectId,intent.revision),objects=new Map();
    requireValue(versions.length===intent.revision+1,'PROJECT_HISTORY','The complete original project prefix is required.',409);
    for(const row of versions)for(const entry of objectsIn(JSON.parse(row.state_json)).values())addObject(objects,entry);
    for(const source of intent.sourceManifest)addObject(objects,source);
    const deliveryManifest=this.store.handoffs(intent.projectId,intent.revision).filter(h=>h.id!==intent.id);
    for(const record of deliveryManifest)addDelivery(objects,record);
    const header={type:'header',schema:SCHEMA,projectId:intent.projectId,revision:intent.revision,title:intent.title,notes:intent.notes,createdAt:intent.createdAt,instanceId:intent.instanceId,handoff:clone(intent),deliveryManifest,sourceManifest:clone(intent.sourceManifest),objectManifest:[...objects.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)),versionManifest:versions.map(r=>({revision:Number(r.revision),sha256:r.sha256,parentSha256:r.parent_sha256})),requestCount:requests.length,requestManifest:requests.map(row=>({actorId:row.actor_id,requestId:row.request_id,sha256:identity(row)}))};
    validateHeader(header);const body=Buffer.from(canonical(header));
    requireValue(body.length<=MAX_HEADER,'HANDOFF_HEADER_SIZE','The original frozen header exceeds the selected limit.',413);
    atomicBytes(path,body,{immutable:true});this.store.objects.put(body);return header;
  }
  async writeSelected(header,target,expected){
    validateHeader(header);const context=this.context(header);this.validateNamed(header,context);
    if(existsSync(target)){
      const actual=hashFile(target),selected=expected??streamIdentity(header,context);
      requireValue(actual.sha256===selected.sha256&&actual.bytes===selected.bytes,'HANDOFF_CANDIDATE_CHANGED','The completed original archive candidate differs from its exact frozen stream.',409);
      return{path:target,...actual,header};
    }
    const temp=target+'.partial';let selected;
    const stream=records(header,context),hash=createHash('sha256');let bytes=0;
    async function* counted(){for(const body of stream){hash.update(body);bytes+=body.length;yield body;}selected={sha256:hash.digest('hex'),bytes};}
    try{
      await pipeline(Readable.from(counted()),createWriteStream(temp,{mode:0o600}));
      requireValue(selected&&(!expected||selected.sha256===expected.sha256&&selected.bytes===expected.bytes),'HANDOFF_NAMED_IDENTITY','The exact original named stream could not be reproduced.',409);
      const actual=hashFile(temp);requireValue(actual.sha256===selected.sha256&&actual.bytes===selected.bytes,'HANDOFF_WRITE_IDENTITY','The original canonical stream changed during publication.',409);
      const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,target);fsyncDirectory(dirname(target));
      return{path:target,...actual,header};
    }catch(error){try{unlinkSync(temp);}catch{}throw error;}
  }
  async exportFile(projectId,revision,{intent,candidatePath}){
    requireValue(intent&&intent.projectId===projectId&&intent.revision===revision,'HANDOFF_INTENT','Select the committed original handoff intent.',409);
    return this.writeSelected(this.frozenHeader(intent),candidatePath??join(this.root,intent.id+'.ndjson'));
  }
  verifyRecord(record){
    if(isFlat(record)){const header=this.headerFor(record);this.validateNamed(header,this.context(header),record);const path=this.store.objects.path(record.sha256);if(existsSync(path))this.store.objects.verify(record.sha256,record.bytes);}
    else this.store.objects.verify(record.sha256,record.bytes);
    return{sha256:record.sha256,bytes:record.bytes,headerSha256:record.headerSha256};
  }
  async ensureFile(record){
    const path=this.store.objects.path(record.sha256);
    if(existsSync(path)){this.store.objects.verify(record.sha256,record.bytes);return{path,...record};}
    requireValue(isFlat(record),'HANDOFF_LEGACY_MISSING','The original literal v1 archive must remain retained.',409);
    if(this.generating.has(record.id))return this.generating.get(record.id);
    const work=(async()=>{
      const header=this.headerFor(record),archive=await this.writeSelected(header,join(this.root,record.id+'.ndjson'),record);
      this.store.objects.putClosedFile(archive.path,{sha256:record.sha256,bytes:record.bytes});
      return{path:this.store.objects.path(record.sha256),...record};
    })();this.generating.set(record.id,work);
    try{return await work;}finally{this.generating.delete(record.id);}
  }
  async close(){await Promise.all([...this.generating.values()]);}
  async inspect(path,{retainObjects=true,sourceDestination}={}){
    let header=null,headerSha=null,complete=null,count=0,total=0,current=null,objectIndex=0;
    const versions=[],requests=[],sourceFiles=[],expectedSource=new Map(),seenSource=new Set(),seenVersions=new Set(),seenRequests=new Set(),objectIndexRows=new Map();
    const archive=hashFile(path),fd=openSync(path,'r'),magic=Buffer.alloc(2);let gzip;try{readSync(fd,magic,0,2,0);gzip=magic[0]===31&&magic[1]===139;}finally{closeSync(fd);}
    const input=createReadStream(path),decoded=gzip?createGunzip():input;if(gzip){input.on('error',e=>decoded.destroy(e));input.pipe(decoded);}
    const lines=createInterface({input:decoded,crlfDelay:Infinity}),stage=join(this.root,'receiving-'+archive.sha256);if(retainObjects)mkdirSync(stage,{recursive:true,mode:0o700});
    try{
      for await(const line of lines){
        this.store.assert();const lineOffset=total,lineBytes=Buffer.byteLength(line)+1;total+=lineBytes;
        requireValue(total<=MAX_UNPACKED&&lineBytes<=64*1024*1024,'HANDOFF_SIZE','Portable contents exceed the selected receiving limits.',413);
        requireValue(!complete,'HANDOFF_TRAILING_DATA','The original portable contains records after its complete marker.',409);
        const row=JSON.parse(line);
        if(!header){
          validateHeader(row);requireValue(gzip?row.schema===LEGACY:row.schema===SCHEMA,'HANDOFF_ENCODING','Select the original gzip-v1 or canonical plain-NDJSON-v2 encoding.',409);header=row;headerSha=identity(header);
          for(const s of header.sourceManifest)expectedSource.set(s.path,s);
        }else if(row.type==='version'){
          const v=row.row,meta=header.versionManifest[versions.length];requireValue(meta&&v.project_id===header.projectId&&Number(v.revision)===versions.length&&!seenVersions.has(v.revision),'HANDOFF_HISTORY','Project versions must form the complete ordered prefix.',409);
          requireValue(sha(Buffer.from(v.state_json))===v.sha256&&v.sha256===meta.sha256&&v.parent_sha256===meta.parentSha256&&v.parent_sha256===(versions.length?versions.at(-1).sha256:null),'HANDOFF_HISTORY','A retained version or parent identity differs.',409);
          const state=JSON.parse(v.state_json);requireValue(state.id===header.projectId&&state.revision===versions.length,'HANDOFF_HISTORY','The original project body has another identity.',409);versions.push(v);seenVersions.add(v.revision);
        }else if(row.type==='request'){
          const r=row.row,key=requestKey(r);requireValue(r.project_id===header.projectId&&Number(r.revision)<=header.revision&&!seenRequests.has(key),'HANDOFF_REQUEST','A retained request is duplicated or outside the selected project prefix.',409);id(r.actor_id,'actorId');id(r.request_id,'requestId');digest(r.input_sha256);JSON.parse(r.result_json);requests.push(r);seenRequests.add(key);
        }else if(row.type==='source'){
          const expected=expectedSource.get(row.path),bytes=Buffer.from(row.data,'base64');requireValue(expected&&!seenSource.has(row.path)&&bytes.length===expected.bytes&&sha(bytes)===expected.sha256&&row.sha256===expected.sha256&&row.bytes===expected.bytes,'HANDOFF_SOURCE','The editable source differs from its complete manifest.',409);
          if(sourceDestination)atomicBytes(join(sourceDestination,safeRelative(row.path)),bytes,{immutable:true});
          sourceFiles.push({path:row.path,bytes:bytes.length,sha256:expected.sha256});seenSource.add(row.path);
        }else if(row.type==='object'){
          const expected=header.objectManifest[objectIndex];requireValue(expected&&row.sha256===expected.sha256,'HANDOFF_OBJECT_ORDER','Portable object records differ from the original manifest.',409);
          if(!current){
            requireValue(row.offset===0,'HANDOFF_OBJECT_OFFSET','An original object does not begin at offset zero.',409);
            const present=retainObjects&&existsSync(this.store.objects.path(expected.sha256));
            if(present)this.store.objects.verify(expected.sha256,expected.bytes);
            current={...expected,offset:0,fd:retainObjects&&!present?openSync(join(stage,expected.sha256+'.part'),'w',0o600):null,hash:createHash('sha256')};objectIndexRows.set(expected.sha256,[]);
          }
          const bytes=Buffer.from(row.data,'base64');
          requireValue(row.offset===current.offset&&bytes.length<=CHUNK&&current.offset+bytes.length<=current.bytes,'HANDOFF_OBJECT_OFFSET','Original binary chunks are out of order or exceed the selected length.',409);
          if(header.schema===SCHEMA)requireValue(bytes.length===Math.min(CHUNK,current.bytes-current.offset)&&row.data===bytes.toString('base64'),'HANDOFF_CANONICAL_CHUNK','The v2 object must keep its exact original canonical chunk encoding.',409);
          current.hash.update(bytes);objectIndexRows.get(current.sha256).push({offset:lineOffset,bytes:lineBytes});
          if(current.fd!==null){let done=0;while(done<bytes.length){const n=writeSync(current.fd,bytes,done,bytes.length-done,current.offset+done);requireValue(n>0,'HANDOFF_WRITE','Receiving stopped during an original binary write.',409);done+=n;}}
          current.offset+=bytes.length;
          if(current.offset===current.bytes){
            requireValue(current.hash.digest('hex')===current.sha256,'HANDOFF_OBJECT_HASH','A retained native/source object failed SHA256.',409);
            if(current.fd!==null){fsyncSync(current.fd);closeSync(current.fd);current.fd=null;this.store.objects.adoptClosedFile(join(stage,current.sha256+'.part'),{sha256:current.sha256,bytes:current.bytes});}
            objectIndex++;current=null;
          }
        }else if(row.type==='complete'){
          requireValue(row.headerSha256===headerSha&&row.records===count,'HANDOFF_COMPLETE','The original complete marker does not match the retained records.',409);complete=row;
        }else requireValue(false,'HANDOFF_RECORD','Unknown record in the original portable.',409);
        if(row.type!=='complete')count++;
      }
      requireValue(header&&complete&&!current&&objectIndex===header.objectManifest.length&&seenSource.size===expectedSource.size&&versions.length===header.versionManifest.length&&requests.length===header.requestCount,'HANDOFF_INCOMPLETE','The full original portable did not close all source, history and binary records.',409);
      const selected=JSON.parse(versions.at(-1).state_json),retainedIntent=(selected.handoffs??[]).find(h=>h.id===header.handoff.id);
      if(header.handoff.intentRevision<=header.revision)requireValue(retainedIntent&&canonical(retainedIntent)===canonical(header.handoff),'HANDOFF_INTENT_HISTORY','The original handoff intent differs from its selected canonical revision.',409);
      else requireValue(header.handoff.historical===true,'HANDOFF_INTENT_HISTORY','A historical handoff must explicitly retain its later preparation revision.',409);
      exactClosure(header,versions);
      if(header.schema===SCHEMA){
        const context=plainContext(path,objectIndexRows,header.objectManifest,versions,requests);
        this.validateNamed(header,context,archive);
        if(retainObjects)this.store.objects.put(Buffer.from(canonical(header)));
      }
      return{header,headerSha,versions,requests,sourceFiles,archiveSha256:archive.sha256,archiveBytes:archive.bytes,unpackedBytes:total};
    }finally{if(current?.fd!==null&&current?.fd!==undefined)closeSync(current.fd);lines.close();input.destroy();if(decoded!==input)decoded.destroy();}
  }
  sealedRecord(header,object){
    return{...clone(header.handoff),status:'complete',sha256:object.sha256,bytes:object.bytes,headerSha256:identity(header),...(header.schema===SCHEMA?{portableSchema:SCHEMA,headerBytes:Buffer.byteLength(canonical(header))}:{})};
  }
  async seal(intent){
    const previous=this.store.handoff(intent.id);
    if(previous){if(isFlat(previous))this.headerFor(previous);else this.store.objects.verify(previous.sha256,previous.bytes);return previous;}
    await this.assertClosed(intent.projectId);
    const archive=await this.exportFile(intent.projectId,intent.revision,{intent,candidatePath:join(this.root,intent.id+'.ndjson')});
    const object=this.store.objects.putClosedFile(archive.path,{sha256:archive.sha256,bytes:archive.bytes}),record=this.sealedRecord(archive.header,object);
    return this.store.saveHandoff(record);
  }
  async sealPending(projectId){
    const state=this.store.get(projectId);
    if(state.jobs.some(j=>['queued','running','cancelling'].includes(j.status))||(state.downstreamOperations??[]).some(j=>['queued','running','cancelling'].includes(j.status)))return;
    for(const intent of state.handoffs??[])if(!this.store.handoff(intent.id))await this.seal(intent);
  }
  async prepare(actor,input){
    const p=input.payload,projectId=input.projectId;await this.assertClosed(projectId);
    const current=this.store.get(projectId),requested=p.revision??current.revision;integer(requested,'revision',{max:current.revision});text(p.title,'title',{min:1,max:300});text(p.notes??'','notes',{max:10000});
    const historical=requested<current.revision,revision=historical?requested:current.revision+1,selected=historical?this.store.get(projectId,requested):current;
    const sources=this.workspace.sourceFiles??collectSourceFiles(this.workspace.sourceRoot),sourceManifest=[];
    for(const source of sources){const object=this.store.objects.put(source.body);requireValue(object.sha256===source.sha256&&object.bytes===source.bytes,'HANDOFF_SOURCE_CHANGED','The selected editable application source changed before preparation.',409);sourceManifest.push({path:source.path,...object});}
    const output=this.store.commit(actor,input,state=>{
      this.workspace.noActive(state);
      const intent={id:'handoff_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),projectId,instanceId:this.store.instanceId,title:p.title,notes:p.notes??'',revision,intentRevision:current.revision+1,historical,createdAt:now(),portableSchema:SCHEMA,filename:projectId+'-r'+revision+'.ndjson',sourceIds:selected.sources.map(s=>s.id),nativeJobIds:selected.jobs.map(j=>j.id),sourceManifest};
      state.handoffs.push(intent);return{handoffId:intent.id,projectId,revision,filename:intent.filename};
    });
    await this.seal(output.view.handoffs.find(h=>h.id===output.result.handoffId));
    return output;
  }
  async receive(actor,input){
    const uploaded=this.workspace.uploads.completed(actor,input.payload.uploadId),path=this.store.objects.path(uploaded.sha256);
    const preview=await this.inspect(path,{retainObjects:false}),projectId=preview.header.projectId;
    return this.workspace.serial(projectId,async()=>{
    requireValue(!this.workspace.receiving.has(projectId),'RECEIVING_BUSY','This original project is already being received.',423);this.workspace.receiving.add(projectId);
    try{
      await this.runtime.drainReads(projectId);await this.assertClosed(projectId);
      const sourceDirectory=join(this.root,'received-'+uploaded.sha256,'source');
      const packet=await this.inspect(path,{retainObjects:true,sourceDestination:sourceDirectory});await this.assertClosed(projectId);
      const adopted=this.store.transaction(()=>{
        const replay=this.store.request(actor.id,input.requestId,input);if(replay)return replay;
        requireValue(this.store.head(input.projectId)===input.expectedRevision,'REVISION_CONFLICT','The selected receiving project changed before adoption.',409);
        const existing=this.store.exists(projectId),oldHead=existing?this.store.head(projectId):-1;
        for(const row of packet.versions){
          const present=this.store.db.prepare('SELECT * FROM versions WHERE project_id=? AND revision=?').get(projectId,row.revision);
          if(present)requireValue(present.sha256===row.sha256&&present.state_json===row.state_json&&present.parent_sha256===row.parent_sha256,'PROJECT_HISTORY_CONFLICT','The received project diverges from this original immutable history.',409,{revision:row.revision});
          else this.store.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?)').run(projectId,row.revision,row.state_json,row.sha256,row.parent_sha256);
        }
        const targetHead=Math.max(oldHead,packet.header.revision);
        if(existing)this.store.db.prepare('UPDATE projects SET head=? WHERE id=?').run(targetHead,projectId);
        else this.store.db.prepare('INSERT INTO projects VALUES(?,?)').run(projectId,targetHead);
        for(const row of packet.requests){
          const old=this.store.db.prepare('SELECT * FROM requests WHERE actor_id=? AND request_id=?').get(row.actor_id,row.request_id);
          if(old)requireValue(canonical(old)===canonical(row),'REQUEST_HISTORY_CONFLICT','A received original request ID already belongs to different retained input.',409);
          else this.store.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(row.actor_id,row.request_id,row.project_id,row.input_sha256,row.revision,row.result_json);
        }
        for(const record of packet.header.deliveryManifest)this.store.saveHandoff(record);
        this.store.saveHandoff(this.sealedRecord(packet.header,{sha256:uploaded.sha256,bytes:uploaded.bytes}));
        if(packet.header.revision>oldHead){
          const receivedAt=now(),incoming=JSON.parse(packet.versions.at(-1).state_json);
          for(const job of incoming.jobs){
            const binding=this.store.binding(job.id)??{id:'unrestored_'+identity({instanceId:this.store.instanceId,jobId:job.id,packageSha256:uploaded.sha256}).slice(0,32),jobId:job.id,projectId,restored:false,directory:null};
            this.store.setBinding(projectId,job.id,{...binding,suspended:true,supersededBy:{packageSha256:uploaded.sha256,revision:packet.header.revision,receivedAt}});
          }
          for(const operation of incoming.downstreamOperations??[]){
            const binding=this.store.downstreamBinding(operation.id)??{id:'received_'+identity({instanceId:this.store.instanceId,operationId:operation.id,packageSha256:uploaded.sha256}).slice(0,32),operationId:operation.id,projectId,directory:null,restored:false};
            this.store.setDownstreamBinding(projectId,operation.id,{...binding,suspended:true,supersededBy:{packageSha256:uploaded.sha256,revision:packet.header.revision,receivedAt}});
          }
        }
        const disposition=!existing?'imported':packet.header.revision>oldHead?'forward':packet.header.revision===oldHead?'same':'older';
        const result={projectId,receivedRevision:packet.header.revision,currentRevision:targetHead,disposition,packageSha256:uploaded.sha256,editableSource:'portable/received-'+uploaded.sha256+'/source',runtimeState:'received_closed'};
        const localKey=identity({actorId:actor.id,input});this.store.db.prepare('INSERT OR IGNORE INTO local_receiving VALUES(?,?,?,?,?)').run(localKey,projectId,uploaded.sha256,packet.header.revision,now());
        this.store.saveRequest(actor.id,input.requestId,projectId,input,targetHead,result);
        return {view:this.store.get(projectId),result,replayed:false,currentRevision:targetHead};
      });
      this.workspace.materializeConsumer(this.store.get(projectId));return adopted;
    }finally{this.workspace.receiving.delete(projectId);}
    });
  }
}
