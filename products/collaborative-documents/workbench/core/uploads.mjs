import { mkdirSync, existsSync, openSync, closeSync, readSync, writeSync, fsyncSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson, readJson, identity, id, text, integer, digest, safeFilename, requireValue, now } from './common.mjs';

export const UPLOAD_LIMIT=512*1024*1024, CHUNK_LIMIT=8*1024*1024, DOCUMENT_LIMIT=32*1024*1024;
export class Uploads {
  constructor(store){this.store=store;this.root=join(store.directory,'uploads');this.queues=new Map();mkdirSync(this.root,{recursive:true,mode:0o700});}
  key(actorId,uploadId){id(actorId,'actorId');id(uploadId,'uploadId');return identity({actorId,uploadId});}
  paths(actorId,uploadId){const key=this.key(actorId,uploadId);return {meta:join(this.root,key+'.json'),body:join(this.root,key+'.part')};}
  async serial(actorId,uploadId,fn){
    const key=this.key(actorId,uploadId),prior=this.queues.get(key)??Promise.resolve();
    const task=prior.catch(()=>{}).then(()=>{this.store.assert();return fn();});this.queues.set(key,task);
    try{return await task;}finally{if(this.queues.get(key)===task)this.queues.delete(key);}
  }
  load(actorId,uploadId){const p=this.paths(actorId,uploadId);requireValue(existsSync(p.meta),'UPLOAD_NOT_FOUND','The original actor-bound upload was not found.',404);const m=readJson(p.meta);requireValue(m.actorId===actorId&&m.id===uploadId,'UPLOAD_IDENTITY','Upload belongs to another actor or request.',403);return m;}
  view(m){return {id:m.id,offset:m.offset,bytes:m.bytes,sha256:m.sha256,complete:m.complete,...(m.complete?{objectId:m.sha256,filename:m.filename,mediaType:m.mediaType}:{})};}
  start(actor,input){return this.serial(actor.id,input.uploadId,()=>{
    id(input.uploadId,'uploadId');safeFilename(input.filename);text(input.mediaType,'mediaType',{min:1,max:200});integer(input.bytes,'bytes',{min:1,max:UPLOAD_LIMIT});digest(input.sha256);
    const p=this.paths(actor.id,input.uploadId),bound={filename:input.filename,mediaType:input.mediaType,bytes:input.bytes,sha256:input.sha256};
    if(existsSync(p.meta)){const m=this.load(actor.id,input.uploadId);requireValue(m.inputSha256===identity(bound),'UPLOAD_ID_REUSED','This upload ID already names different source bytes.',409);return this.view(m);}
    const m={id:input.uploadId,actorId:actor.id,...bound,inputSha256:identity(bound),offset:0,chunks:[],complete:false,createdAt:now()};
    if(!existsSync(p.body)){const fd=openSync(p.body,'wx',0o600);fsyncSync(fd);closeSync(fd);}
    else requireValue(statSync(p.body).size===0,'UPLOAD_CUSTODY','Uncommitted nonempty upload bytes require original metadata reconciliation.',409);
    atomicJson(p.meta,m,{immutable:true});return this.view(m);
  });}
  status(actor,uploadId){return this.serial(actor.id,uploadId,()=>this.view(this.load(actor.id,uploadId)));}
  chunk(actor,uploadId,{start,end,total,sha256},bytes){return this.serial(actor.id,uploadId,()=>{
    const m=this.load(actor.id,uploadId),body=Buffer.from(bytes),p=this.paths(actor.id,uploadId);
    integer(start,'start');integer(end,'end');requireValue(total===m.bytes&&end-start+1===body.length&&body.length>0&&body.length<=CHUNK_LIMIT&&end<total,'UPLOAD_RANGE','Chunk range does not match this original upload.',409);
    requireValue(createHash('sha256').update(body).digest('hex')===digest(sha256),'CHUNK_IDENTITY','The chunk did not match its declared bytes.',409);
    const prior=m.chunks.find(c=>c.start===start&&c.end===end);
    if(prior){requireValue(prior.sha256===sha256,'CHUNK_IDENTITY','A committed range already has other bytes.',409);const fd=openSync(p.body,'r');try{const saved=Buffer.alloc(body.length);requireValue(readSync(fd,saved,0,saved.length,start)===saved.length&&saved.equals(body),'CHUNK_IDENTITY','Retained chunk bytes changed.',409);}finally{closeSync(fd);}return this.view(m);}
    requireValue(!m.complete,'UPLOAD_COMPLETE','The complete original upload cannot accept new chunks.',409);
    requireValue(start===m.offset,'UPLOAD_OFFSET','Continue from the actual committed upload offset.',409,{offset:m.offset});
    const fd=openSync(p.body,'r+');try{let written=0;while(written<body.length){const n=writeSync(fd,body,written,body.length-written,start+written);requireValue(n>0,'UPLOAD_WRITE','The original chunk write stopped before completion.',409);written+=n;}fsyncSync(fd);}finally{closeSync(fd);}
    this.store.assert();m.chunks.push({start,end,sha256});m.offset=end+1;atomicJson(p.meta,m);return this.view(m);
  });}
  finish(actor,uploadId){return this.serial(actor.id,uploadId,()=>{
    const m=this.load(actor.id,uploadId),p=this.paths(actor.id,uploadId);
    requireValue(m.offset===m.bytes&&statSync(p.body).size===m.bytes,'UPLOAD_INCOMPLETE','All original bytes must be retained before finishing.',409,{offset:m.offset,bytes:m.bytes});
    const object=this.store.objects.putFile(p.body,{sha256:m.sha256,bytes:m.bytes});requireValue(object.bytes===m.bytes&&object.sha256===m.sha256,'UPLOAD_IDENTITY','The source object does not match its original upload.',409);
    if(!m.complete){m.complete=true;m.completedAt=now();atomicJson(p.meta,m);}
    return this.view(m);
  });}
  completed(actor,uploadId){const m=this.load(actor.id,uploadId);requireValue(m.complete,'UPLOAD_INCOMPLETE','Finish the original upload before using it.',409);this.store.objects.verify(m.sha256,m.bytes);return m;}
  async drain(){await Promise.allSettled([...this.queues.values()]);}
}
