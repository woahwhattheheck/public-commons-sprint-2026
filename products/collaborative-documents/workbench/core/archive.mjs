import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, openSync, closeSync, readSync, writeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { ObjectStore, hashFile } from './objects.mjs';
import { clone, canonical, sha, identity, now, id, digest, integer, text, requireValue, collectSourceFiles, safeRelative, atomicBytes, fsyncDirectory } from './common.mjs';

const SCHEMA='tjlabs.tiptap-portable.v1',MAX_UNPACKED=2*1024*1024*1024,CHUNK=1024*1024;
function objectsIn(state){
  const found=new Map(),add=value=>{if(value?.sha256&&Number.isSafeInteger(value.bytes)){digest(value.sha256);const old=found.get(value.sha256);requireValue(!old||old.bytes===value.bytes,'OBJECT_MANIFEST','One retained hash has inconsistent lengths.',409);found.set(value.sha256,{sha256:value.sha256,bytes:value.bytes});}};
  for(const s of state.sources)add(s);
  for(const m of state.migrations)for(const row of m.rows)add(row.prepared);
  for(const d of state.documents){add(d.persisted);for(const epoch of d.previousEpochs??[])add(epoch.persisted);}
  for(const c of state.checkpoints){add(c.descriptor);for(const d of c.documents)add(d);for(const f of c.files)add(f);}
  for(const j of state.jobs){for(const f of j.files)add(f);for(const a of j.attempts)add(a.receipt);}
  for(const h of state.handoffs)add(h);
  return found;
}
function nativeRows(state){
  const rows=[];for(const d of state.documents){
    const add=(epochId,documentName,p)=>{if(p)rows.push({project_id:state.id,document_id:d.id,epoch_id:epochId,document_name:documentName,sha256:p.sha256,bytes:p.bytes,vector_sha256:p.stateVectorSha256,vector_base64:p.stateVectorBase64,saved_at:p.savedAt,sequence:p.sequence});};
    add(d.epochId,d.documentName,d.persisted);for(const e of d.previousEpochs??[])add(e.epochId,e.documentName,e.persisted);
  }return rows.sort((a,b)=>(a.document_name).localeCompare(b.document_name));
}
export class Archives {
  constructor(workspace){this.workspace=workspace;this.store=workspace.store;this.runtime=workspace.runtime;this.root=join(this.store.directory,'portable');mkdirSync(this.root,{recursive:true,mode:0o700});}
  assertClosed(projectId){
    requireValue(!this.runtime.has(projectId),'DEPLOYMENT_BUSY','Drain a checkpoint or stop the original collaboration deployment before preparing or receiving a handoff.',423);
    if(this.store.exists(projectId))this.workspace.noActiveJob(this.store.get(projectId));
  }
  async exportFile(projectId,revision,{title,notes='',candidatePath}){
    const versionRows=this.store.versionRows(projectId,revision);requireValue(versionRows.length===revision+1,'PROJECT_HISTORY','The complete original project prefix is required.',409);
    const selected=this.store.get(projectId,revision),objects=new Map();
    for(const row of versionRows)for(const [hash,entry] of objectsIn(JSON.parse(row.state_json)))objects.set(hash,entry);
    const sources=this.workspace.sourceFiles??collectSourceFiles(this.workspace.sourceRoot),sourceManifest=sources.map(({path,bytes,sha256})=>({path,bytes,sha256}));
    const header={type:'header',schema:SCHEMA,projectId,revision,title,notes,createdAt:selected.updatedAt,instanceId:this.store.instanceId,sourceManifest,objectManifest:[...objects.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)),versionManifest:versionRows.map(r=>({revision:Number(r.revision),sha256:r.sha256,parentSha256:r.parent_sha256})),requestCount:this.store.requestsFor(projectId,revision).length};
    const headerSha=identity(header),target=candidatePath??join(this.root,headerSha+'.ndjson.gz');
    if(existsSync(target)){
      const reopened=await this.inspect(target,{retainObjects:false});requireValue(reopened.headerSha===headerSha,'HANDOFF_CANDIDATE_CHANGED','The retained original archive candidate has another source selection.',409);return {path:target,...hashFile(target),header};
    }
    for(const object of header.objectManifest)this.store.objects.verify(object.sha256,object.bytes);
    const requestRows=this.store.requestsFor(projectId,revision),native=nativeRows(selected),store=this.store;
    async function* records(){
      let count=0;const emit=value=>{count++;return Buffer.from(canonical(value)+'\n');};
      yield emit(header);
      for(const row of versionRows)yield emit({type:'version',row});
      for(const row of requestRows)yield emit({type:'request',row});
      for(const row of native)yield emit({type:'native',row});
      for(const source of sources)yield emit({type:'source',path:source.path,sha256:source.sha256,bytes:source.bytes,data:source.body.toString('base64')});
      for(const object of header.objectManifest){
        const fd=openSync(store.objects.path(object.sha256),'r');let offset=0;try{
          const buffer=Buffer.alloc(Math.min(CHUNK,Math.max(1,object.bytes)));
          while(offset<object.bytes){const n=readSync(fd,buffer,0,Math.min(buffer.length,object.bytes-offset),offset);requireValue(n>0,'OBJECT_TRUNCATED','Original retained object ended before its selected length.',409);yield emit({type:'object',sha256:object.sha256,offset,data:buffer.subarray(0,n).toString('base64')});offset+=n;}
          if(object.bytes===0)yield emit({type:'object',sha256:object.sha256,offset:0,data:''});
        }finally{closeSync(fd);}
      }
      yield Buffer.from(canonical({type:'complete',headerSha256:headerSha,records:count})+'\n');
    }
    const temp=target+'.partial';try{
      await pipeline(Readable.from(records()),createGzip({level:6}),createWriteStream(temp,{mode:0o600}));
      const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,target);fsyncDirectory(dirname(target));
    }catch(error){try{unlinkSync(temp);}catch{}throw error;}
    const verified=await this.inspect(target,{retainObjects:false});requireValue(verified.headerSha===headerSha,'HANDOFF_IDENTITY','The completed original archive has another header.',409);
    return {path:target,...hashFile(target),header};
  }
  async inspect(path,{retainObjects=true,sourceDestination}={}){
    let header=null,headerSha=null,complete=null,count=0,total=0,current=null,objectIndex=0;
    const versions=[],requests=[],native=[],sourceFiles=[],expectedSource=new Map(),seenSource=new Set(),seenVersions=new Set(),seenRequests=new Set();
    const input=createReadStream(path),gunzip=createGunzip();input.on('error',e=>gunzip.destroy(e));input.pipe(gunzip);
    const lines=createInterface({input:gunzip,crlfDelay:Infinity});
    const archiveHash=hashFile(path).sha256,stage=join(this.root,'receiving-'+archiveHash);if(retainObjects)mkdirSync(stage,{recursive:true,mode:0o700});
    try{
      for await(const line of lines){
        total+=Buffer.byteLength(line)+1;requireValue(total<=MAX_UNPACKED&&Buffer.byteLength(line)<=64*1024*1024,'HANDOFF_SIZE','Portable contents exceed the selected receiving limits.',413);
        requireValue(!complete,'HANDOFF_TRAILING_DATA','The original portable contains records after its complete marker.',409);
        const row=JSON.parse(line);
        if(!header){
          requireValue(row.type==='header'&&row.schema===SCHEMA,'HANDOFF_SCHEMA','This is not the complete original Tiptap portable schema.',409);id(row.projectId,'projectId');integer(row.revision,'revision');header=row;headerSha=identity(header);
          requireValue(Array.isArray(header.versionManifest)&&header.versionManifest.length===header.revision+1&&Array.isArray(header.sourceManifest)&&Array.isArray(header.objectManifest),'HANDOFF_MANIFEST','The complete version/source/object manifests are required.',409);
          for(const s of header.sourceManifest){safeRelative(s.path);digest(s.sha256);integer(s.bytes,'source bytes',{max:64*1024*1024});requireValue(!expectedSource.has(s.path),'HANDOFF_SOURCE_DUPLICATE','Duplicate editable source path.',409);expectedSource.set(s.path,s);}
          const hashes=new Set();for(const o of header.objectManifest){digest(o.sha256);integer(o.bytes,'object bytes',{max:512*1024*1024});requireValue(!hashes.has(o.sha256),'HANDOFF_OBJECT_DUPLICATE','Duplicate retained object identity.',409);hashes.add(o.sha256);}
        }else if(row.type==='version'){
          const v=row.row,meta=header.versionManifest[versions.length];requireValue(meta&&v.project_id===header.projectId&&Number(v.revision)===versions.length&&!seenVersions.has(v.revision),'HANDOFF_HISTORY','Project versions must form the complete ordered prefix.',409);
          requireValue(sha(Buffer.from(v.state_json))===v.sha256&&v.sha256===meta.sha256&&v.parent_sha256===meta.parentSha256&&v.parent_sha256===(versions.length?versions.at(-1).sha256:null),'HANDOFF_HISTORY','A retained version or parent identity differs.',409);
          const state=JSON.parse(v.state_json);requireValue(state.id===header.projectId&&state.revision===versions.length,'HANDOFF_HISTORY','The original project body has another identity.',409);versions.push(v);seenVersions.add(v.revision);
        }else if(row.type==='request'){
          const r=row.row,key=r.actor_id+'\0'+r.request_id;requireValue(r.project_id===header.projectId&&Number(r.revision)<=header.revision&&!seenRequests.has(key),'HANDOFF_REQUEST','A retained request is duplicated or outside the selected project prefix.',409);id(r.actor_id,'actorId');id(r.request_id,'requestId');digest(r.input_sha256);JSON.parse(r.result_json);requests.push(r);seenRequests.add(key);
        }else if(row.type==='native'){
          const r=row.row;requireValue(r.project_id===header.projectId,'HANDOFF_NATIVE_SCOPE','A native document belongs to another project.',409);id(r.document_id,'documentId');id(r.epoch_id,'epochId');digest(r.sha256);digest(r.vector_sha256);requireValue(sha(Buffer.from(r.vector_base64,'base64'))===r.vector_sha256,'HANDOFF_VECTOR','A retained native state vector changed.',409);native.push(r);
        }else if(row.type==='source'){
          const expected=expectedSource.get(row.path),bytes=Buffer.from(row.data,'base64');requireValue(expected&&!seenSource.has(row.path)&&bytes.length===expected.bytes&&sha(bytes)===expected.sha256&&row.sha256===expected.sha256&&row.bytes===expected.bytes,'HANDOFF_SOURCE','The editable source differs from its complete manifest.',409);
          if(sourceDestination)atomicBytes(join(sourceDestination,safeRelative(row.path)),bytes,{immutable:true});
          sourceFiles.push({path:row.path,bytes:bytes.length,sha256:expected.sha256});seenSource.add(row.path);
        }else if(row.type==='object'){
          const expected=header.objectManifest[objectIndex];requireValue(expected&&row.sha256===expected.sha256,'HANDOFF_OBJECT_ORDER','Portable object records differ from the original manifest.',409);
          if(!current){requireValue(row.offset===0,'HANDOFF_OBJECT_OFFSET','An original object does not begin at offset zero.',409);current={...expected,offset:0,parts:[],fd:retainObjects?openSync(join(stage,expected.sha256+'.part'),'w',0o600):null,hash:(await import('node:crypto')).createHash('sha256')};}
          const bytes=Buffer.from(row.data,'base64');requireValue(row.offset===current.offset&&bytes.length<=CHUNK&&current.offset+bytes.length<=current.bytes,'HANDOFF_OBJECT_OFFSET','Original binary chunks are out of order or exceed the selected length.',409);
          current.hash.update(bytes);if(current.fd!==null){let done=0;while(done<bytes.length){const n=writeSync(current.fd,bytes,done,bytes.length-done,current.offset+done);requireValue(n>0,'HANDOFF_WRITE','Receiving stopped during an original binary write.',409);done+=n;}}
          current.offset+=bytes.length;
          if(current.offset===current.bytes){
            requireValue(current.hash.digest('hex')===current.sha256,'HANDOFF_OBJECT_HASH','A retained native/source object failed SHA256.',409);
            if(current.fd!==null){fsyncSync(current.fd);closeSync(current.fd);current.fd=null;this.store.objects.putFile(join(stage,current.sha256+'.part'),{sha256:current.sha256,bytes:current.bytes});}
            objectIndex++;current=null;
          }
        }else if(row.type==='complete'){
          requireValue(row.headerSha256===headerSha&&row.records===count,'HANDOFF_COMPLETE','The original complete marker does not match the retained records.',409);complete=row;
        }else requireValue(false,'HANDOFF_RECORD','Unknown record in the original portable.',409);
        if(row.type!=='complete')count++;
      }
      requireValue(header&&complete&&!current&&objectIndex===header.objectManifest.length&&seenSource.size===expectedSource.size&&versions.length===header.versionManifest.length&&requests.length===header.requestCount,'HANDOFF_INCOMPLETE','The full original portable did not close all source, history and binary records.',409);
      const selected=JSON.parse(versions.at(-1).state_json),expectedNative=nativeRows(selected);requireValue(canonical(native)===canonical(expectedNative),'HANDOFF_NATIVE_SCOPE','The native rows do not exactly match the selected original document epochs.',409);
      const closure=new Map();for(const row of versions)for(const [hash,entry] of objectsIn(JSON.parse(row.state_json)))closure.set(hash,entry);requireValue(canonical([...closure.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)))===canonical(header.objectManifest),'HANDOFF_OBJECT_CLOSURE','The portable does not contain exactly its complete project-scoped object closure.',409);
      return {header,headerSha,versions,requests,native,sourceFiles,archiveSha256:archiveHash,unpackedBytes:total};
    }finally{if(current?.fd!==null&&current?.fd!==undefined)closeSync(current.fd);lines.close();input.destroy();gunzip.destroy();}
  }
  async prepare(actor,input){
    const p=input.payload,projectId=input.projectId;this.assertClosed(projectId);
    const current=this.store.get(projectId),revision=p.revision??current.revision;integer(revision,'revision',{max:current.revision});text(p.title,'title',{min:1,max:300});text(p.notes??'','notes',{max:10000});
    if(revision===current.revision)for(const d of current.documents){const native=this.store.nativeReceipt(projectId,d.id,d.epochId);requireValue(!native||identity(native)===identity(d.persisted),'CHECKPOINT_REQUIRED','Retain a drained checkpoint so this project revision includes the final native save before handoff.',409);}
    const candidate=join(this.root,'request-'+identity({actorId:actor.id,input})+'.ndjson.gz');
    const archive=await this.exportFile(projectId,revision,{title:p.title,notes:p.notes??'',candidatePath:candidate});const object=this.store.objects.putFile(archive.path,{sha256:archive.sha256,bytes:archive.bytes});
    return this.store.commit(actor,input,state=>{
      this.assertClosed(projectId);
      const handoff={id:'handoff_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),title:p.title,notes:p.notes??'',revision,createdAt:archive.header.createdAt,filename:projectId+'-r'+revision+'.ndjson.gz',...object,sourceIds:state.sources.map(s=>s.id),checkpointId:state.checkpoints.at(-1)?.id??null,sourceManifest:archive.header.sourceManifest};
      state.handoffs.push(handoff);return {handoffId:handoff.id,projectId,revision,filename:handoff.filename,...object};
    });
  }
  async receive(actor,input){
    const uploaded=this.workspace.uploads.completed(actor,input.payload.uploadId),path=this.store.objects.path(uploaded.sha256);
    const preview=await this.inspect(path,{retainObjects:false}),projectId=preview.header.projectId;
    return this.workspace.serial(projectId,async()=>{
    requireValue(!this.workspace.receiving.has(projectId),'RECEIVING_BUSY','This original project is already being received.',423);this.assertClosed(projectId);this.workspace.receiving.add(projectId);
    try{
      const sourceDirectory=join(this.root,'received-'+uploaded.sha256,'source');
      const packet=await this.inspect(path,{retainObjects:true,sourceDestination:sourceDirectory});this.assertClosed(projectId);
      return this.store.transaction(()=>{
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
        if(packet.header.revision>oldHead)for(const row of packet.native)this.store.restoreNativeRow(row);
        const disposition=!existing?'imported':packet.header.revision>oldHead?'forward':packet.header.revision===oldHead?'same':'older';
        const result={projectId,receivedRevision:packet.header.revision,currentRevision:targetHead,disposition,packageSha256:uploaded.sha256,editableSource:'portable/received-'+uploaded.sha256+'/source',runtimeState:'stopped'};
        const localKey=identity({actorId:actor.id,input});this.store.db.prepare('INSERT OR IGNORE INTO local_receiving VALUES(?,?,?,?,?)').run(localKey,projectId,uploaded.sha256,packet.header.revision,now());
        this.store.setLocal(projectId,{instanceId:this.store.instanceId,status:'received',sourceInstanceId:packet.header.instanceId,packageSha256:uploaded.sha256,receivedRevision:packet.header.revision});
        this.store.saveRequest(actor.id,input.requestId,projectId,input,targetHead,result);
        return {view:this.store.get(projectId),result,replayed:false,currentRevision:targetHead};
      });
    }finally{this.workspace.receiving.delete(projectId);}
    });
  }
}
