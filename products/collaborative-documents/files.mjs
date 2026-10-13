// SPDX-License-Identifier: MIT
// Whole original response and artifact retention through the maintained Merchant reader.
import {open,link,unlink,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {RetainedFileReads} from '../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {need,plain,hash,digest,integer,readJson,readFile,writeJson,writePrivate,privateDirectory,MAX_JSON,MAX_FILE} from './connection.mjs';

const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':
  '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const schema='stellar-forge.collaborative-retained-file.v1';
const pointerKey=k=>k.replace(/~/g,'~0').replace(/\//g,'~1');
export function pointer(value,path=''){
  need(typeof path==='string'&&path.length<=4000&&(path===''||path.startsWith('/')),'COLLABORATIVE_POINTER','Use a complete JSON pointer.');
  if(!path)return value;
  for(const encoded of path.slice(1).split('/')){
    need(!/~(?![01])/.test(encoded),'COLLABORATIVE_POINTER','Use JSON pointer escaping.');
    const key=encoded.replace(/~1/g,'/').replace(/~0/g,'~');
    need(value!==null&&typeof value==='object'&&Object.hasOwn(value,key),'COLLABORATIVE_POINTER','The selected pointer is absent.',404);value=value[key];
  }
  return value;
}
export function present(value,path='',depth=0,budget={remaining:16000}){
  const reference=()=>{
    if(Array.isArray(value))return{pointer:path,type:'array',count:value.length};
    if(plain(value))return{pointer:path,type:'object',totalKeys:Object.keys(value).length};
    return{pointer:path,type:typeof value,...(typeof value==='string'?{characters:value.length}:{})};
  };
  if(Array.isArray(value)||depth>=4||budget.remaining<=256)return reference();
  if(plain(value)){
    const entries=Object.entries(value);
    if(entries.length>80)return reference();
    const result={};
    for(const[k,v]of entries){
      if(budget.remaining<k.length+256)return reference();
      budget.remaining-=k.length+8;result[k]=present(v,path+'/'+pointerKey(k),depth+1,budget);
    }
    return result;
  }
  const cost=typeof value==='string'?value.length*2+8:32;
  if(cost>2008||cost>budget.remaining)return reference();
  budget.remaining-=cost;return value;
}
async function identity(path){
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await fd.stat(),h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
    need(before.isFile()&&before.size<=MAX_FILE,'COLLABORATIVE_RETAINED_FILE','Use the complete retained regular file.');
    while(offset<before.size){const{bytesRead}=await fd.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);
      need(bytesRead>0,'COLLABORATIVE_RETAINED_FILE','The retained artifact ended early.',409);h.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
    const after=await fd.stat();need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),'COLLABORATIVE_RETAINED_CHANGED','The retained artifact changed.',409);
    return{bytes:offset,sha256:h.digest('hex')};
  }finally{await fd.close();}
}
export class CollaborativeFiles{
  #root;#authorize;#reads=new RetainedFileReads({errorPrefix:'COLLABORATIVE',maxImmutableFileBytes:MAX_FILE});
  constructor(root,{authorize}={}){need(typeof authorize==='function','COLLABORATIVE_AUTHORIZATION','Bind retained access to the current original actor.');this.#root=root;this.#authorize=authorize;}
  get summary(){return this.#reads.summary;}
  async directory(alias){
    await privateDirectory(this.#root);
    const root=join(this.#root,'collaborative-documents');await privateDirectory(root,{create:true});
    const scoped=join(root,alias);await privateDirectory(scoped,{create:true});return scoped;
  }
  async #meta(alias,fileId){
    digest(fileId);const root=await this.directory(alias),r=await readJson(join(root,fileId+'.json'),MAX_FILE);
    need(r.value.schema===schema&&r.value.fileId===fileId&&r.value.workspace===alias,
      'COLLABORATIVE_RETAINED_IDENTITY','The selected retained file belongs to another workspace.',409);
    digest(r.value.sha256);integer(r.value.bytes,'retained byte count',MAX_FILE);
    await this.#authorize(alias,r.value.selection);
    return{root,value:r.value};
  }
  async #publish(alias,file,selection){
    const root=await this.directory(alias),fileId=hash(canonical({workspace:alias,sha256:file.sha256,bytes:file.bytes,selection}));
    const record={schema,fileId,workspace:alias,filename:file.filename,mediaType:file.mediaType,bytes:file.bytes,sha256:file.sha256,selection};
    const path=join(root,fileId+'.json');
    try{await writeJson(path,record);}catch(e){
      if(e.code!=='EEXIST')throw e;
      need(canonical((await readJson(path,MAX_FILE)).value)===canonical(record),'COLLABORATIVE_RETAINED_CONFLICT','The original retained file selection changed.',409);
    }
    return{...record,fileRead:{tool:'merchant_collaboration_file',workspace:alias,fileId,expectedSha256:file.sha256}};
  }
  async retain(alias,response,selection){
    await this.#authorize(alias,selection);
    const bytes=response.bytes,sha256=hash(bytes),root=await this.directory(alias),path=join(root,sha256+'.content');
    try{await writePrivate(path,bytes);}catch(e){
      if(e.code!=='EEXIST')throw e;
      const existing=await readFile(path,MAX_FILE);need(existing.sha256===sha256&&existing.bytes.length===bytes.length,'COLLABORATIVE_RETAINED_CHANGED','The original retained response changed.',409);
    }
    const retained=await this.#publish(alias,{filename:'collaborative-response-'+sha256.slice(0,16)+'.json',mediaType:'application/json',bytes:bytes.length,sha256},selection);
    return{...retained,originalStatus:response.status??200,...(response.value===undefined?{}:{value:present(response.value)})};
  }
  async artifact(alias,client,selection,expected,access){
    await this.#authorize(alias,{operation:'artifact',...selection,access});
    digest(expected.sha256);integer(expected.bytes,'original artifact bytes',MAX_FILE);
    const root=await this.directory(alias),path=join(root,expected.sha256+'.content');
    const selectionKey={operation:'artifact',...selection,access};
    const knownId=hash(canonical({workspace:alias,sha256:expected.sha256,bytes:expected.bytes,selection:selectionKey}));
    let known;try{known=(await this.#meta(alias,knownId)).value;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(known){
      const current=await identity(path);
      need(current.sha256===known.sha256&&current.bytes===known.bytes&&
        (expected.filename===undefined||expected.filename===known.filename)&&
        (expected.mediaType===undefined||expected.mediaType===known.mediaType),
        'COLLABORATIVE_RETAINED_CHANGED','The exact retained artifact selection changed.',409);
      return{...known,reused:true,fileRead:{tool:'merchant_collaboration_file',workspace:alias,fileId:known.fileId,expectedSha256:known.sha256}};
    }
    let prior=null;try{prior=await identity(path);}catch(e){if(e.code!=='ENOENT')throw e;}
    let observed;
    if(prior){need(prior.sha256===expected.sha256&&prior.bytes===expected.bytes,'COLLABORATIVE_RETAINED_CHANGED','The retained original artifact differs.',409);
      observed=await client.artifact(selection,{sink:async()=>{}});
      need(observed.originalSha256===expected.sha256&&observed.sha256===expected.sha256&&observed.bytes===expected.bytes,
        'COLLABORATIVE_ARTIFACT_IDENTITY','This original selection does not bind the retained bytes.',409);
    }
    else{
      const temporary=join(root,'.artifact-'+randomUUID()),fd=await open(temporary,'wx',0o600);let offset=0;
      try{
        observed=await client.artifact(selection,{sink:async chunk=>{
          let done=0;while(done<chunk.length){const r=await fd.write(chunk,done,chunk.length-done,offset+done);
            need(r.bytesWritten>0,'COLLABORATIVE_RETAINED_WRITE','The complete artifact write stopped.',507);done+=r.bytesWritten;}offset+=chunk.length;
        }});
        need(observed.originalSha256===expected.sha256&&observed.sha256===expected.sha256&&observed.bytes===expected.bytes&&offset===expected.bytes,
          'COLLABORATIVE_ARTIFACT_IDENTITY','The complete original artifact differs from the selected source descriptor.',409);
        await fd.sync();
      }catch(e){await fd.close();await unlink(temporary).catch(()=>{});throw e;}
      await fd.close();
      try{await link(temporary,path);}catch(e){
        if(e.code!=='EEXIST')throw e;const same=await identity(path);need(same.sha256===expected.sha256&&same.bytes===expected.bytes,'COLLABORATIVE_RETAINED_CHANGED','An existing artifact has different bytes.',409);
      }finally{await unlink(temporary).catch(()=>{});}
      const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}
    }
    need(expected.filename===undefined||observed.filename===undefined||expected.filename===observed.filename,'COLLABORATIVE_ARTIFACT_FILENAME','The selected filename differs from the original download name.',409);
    const filename=expected.filename??observed.filename??('collaborative-'+selection.kind+'-'+selection.id+(['handoff','checkpoint'].includes(selection.kind)?'.ndjson.gz':selection.kind==='job'?'.bin':'.source'));
    need(filename===basename(filename)&&filename.length<=240&&!/[\x00-\x1f\x7f\\]/.test(filename),'COLLABORATIVE_FILENAME','Use a plain original download name.');
    return this.#publish(alias,{filename,mediaType:expected.mediaType??observed.contentType??'application/octet-stream',bytes:observed.bytes,sha256:observed.sha256},{operation:'artifact',...selection,access});
  }
  async list(alias,{offset=0,limit=50}={}){
    integer(offset,'file offset');integer(limit,'file page size',100,1);const root=await this.directory(alias);
    const names=(await readdir(root)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort();
    return{workspace:alias,total:names.length,offset,nextOffset:offset+limit<names.length?offset+limit:null,
      files:await Promise.all(names.slice(offset,offset+limit).map(async n=>(await this.#meta(alias,n.slice(0,-5))).value))};
  }
  async read(alias,args){
    const{root,value:m}=await this.#meta(alias,args.fileId);
    need(args.expectedSha256===m.sha256,'COLLABORATIVE_RETAINED_SELECTION','Use this original complete file digest.',409);
    return this.#reads.read({scope:alias,key:m.fileId,kind:'collaborative-original',directory:root,
      readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
      load:async()=>({readonlyFileHandle:await open(join(root,m.sha256+'.content'),constants.O_RDONLY|constants.O_NOFOLLOW),
        name:m.filename,type:m.mediaType,bytes:m.bytes,sha256:m.sha256})});
  }
  async inspect(alias,{fileId,expectedSha256,pointer:at='',offset=0,limit=25}){
    const{root,value:m}=await this.#meta(alias,fileId);need(m.sha256===expectedSha256,'COLLABORATIVE_RETAINED_SELECTION','Use the original snapshot SHA-256.',409);
    const bytes=await readFile(join(root,m.sha256+'.content'),MAX_FILE);need(bytes.sha256===m.sha256&&bytes.bytes.length===m.bytes,'COLLABORATIVE_RETAINED_CHANGED','The retained response changed.',409);
    const selected=pointer(JSON.parse(bytes.bytes.toString('utf8')),at);integer(offset,'row offset');integer(limit,'row page size',50,1);
    if(Array.isArray(selected))return{workspace:alias,fileId,sha256:m.sha256,pointer:at,total:selected.length,offset,nextOffset:offset+limit<selected.length?offset+limit:null,
      rows:(()=>{const budget={remaining:16000};return selected.slice(offset,offset+limit).map((v,i)=>({index:offset+i,value:present(v,at+'/'+(offset+i),0,budget)}));})()};
    return{workspace:alias,fileId,sha256:m.sha256,pointer:at,value:present(selected,at)};
  }
  release(alias,readId){return this.#reads.release(alias,readId);}
  disconnect(alias){return this.#reads.closeScope(alias);}
  close(){return this.#reads.close();}
}
