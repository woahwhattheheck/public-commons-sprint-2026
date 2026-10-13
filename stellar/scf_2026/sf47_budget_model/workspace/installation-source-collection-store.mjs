// MIT. Durable complete browser working copies over the existing native Source Desk journal.
import {mkdir,open,link,unlink,readdir,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const SOURCE_COLLECTION_STORE_SCHEMA='stellar-forge.installation-source-collection-store.v1';
export const SOURCE_COLLECTION_MAX_COPY_BYTES=512*1024*1024;
const WORKING='stellar-forge.installation-source-working-copy.v1';
const SCHEMA='stellar-forge.installation-source-desk.v1';
const MAX_SEQUENCE=Number.MAX_SAFE_INTEGER-1;
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(message,code='SOURCE_COLLECTION_STORE_CHANGED')=>Object.assign(new Error(message),{code});
function need(value,message,code){if(!value)throw fail(message,code);}
function checkedSha(value){need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Keep the complete original SHA256.');return value;}
function sequence(value){need(Number.isSafeInteger(value)&&value>=0&&value<=MAX_SEQUENCE,'Use the complete original working-copy sequence.');return value;}
function checkpointName(value){return 'checkpoint-'+String(sequence(value)).padStart(16,'0')+'.json';}
async function syncDirectory(path){const fd=await open(path,constants.O_RDONLY|(constants.O_DIRECTORY??0));try{await fd.sync();}finally{await fd.close();}}
async function privateDirectory(path,{create=false}={}){
  if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&(process.platform==='win32'||info.uid===process.getuid()&&(info.mode&0o077)===0),
    'Use an owned private original collection directory.','SOURCE_COLLECTION_PRIVATE_DIRECTORY');
  need(await realpath(path)===path,'Use the original collection path without symbolic links.','SOURCE_COLLECTION_PRIVATE_DIRECTORY');
  return path;
}
async function retirePublicationAlias(path,stat){
  if(stat.nlink===1)return;
  need(stat.nlink===2,'Keep one original immutable file.','SOURCE_COLLECTION_FILE_IDENTITY');
  const parent=dirname(path),matches=[];
  for(const name of await readdir(parent)){
    if(!/^pending-[a-f0-9-]{36}$/.test(name))continue;
    const candidate=join(parent,name),info=await lstat(candidate);
    if(info.isFile()&&!info.isSymbolicLink()&&info.dev===stat.dev&&info.ino===stat.ino&&
      info.uid===stat.uid&&(info.mode&0o077)===0)matches.push(candidate);
  }
  need(matches.length===1,'Keep the exact original publication inode and its owned temporary alias.','SOURCE_COLLECTION_FILE_IDENTITY');
  await unlink(matches[0]);await syncDirectory(parent);
}
async function readPrivate(path,maximum){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    let stat=await handle.stat();
    need(stat.isFile()&&Number.isSafeInteger(stat.size)&&stat.size<=maximum&&
      (process.platform==='win32'||stat.uid===process.getuid()&&(stat.mode&0o077)===0),
      'Read the complete owned private source file within its declared capacity.','SOURCE_COLLECTION_FILE_IDENTITY');
    await retirePublicationAlias(path,stat);stat=await handle.stat();
    need(stat.nlink===1,'Keep the exact immutable original file.','SOURCE_COLLECTION_FILE_IDENTITY');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===stat.size&&after.dev===stat.dev&&after.ino===stat.ino&&after.size===stat.size&&
      after.mtimeMs===stat.mtimeMs&&after.ctimeMs===stat.ctimeMs,'The original private file changed while receiving.','SOURCE_COLLECTION_FILE_IDENTITY');
    return bytes;
  }finally{await handle.close();}
}
async function publish(path,bytes){
  const temporary=join(dirname(path),'pending-'+randomUUID());
  const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{
    try{await link(temporary,path);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const current=await readPrivate(path,Math.max(bytes.length,1));
      need(current.equals(bytes),'A different complete checkpoint already occupies this original sequence.','SOURCE_COLLECTION_CONFLICT');
    }
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await syncDirectory(dirname(path));
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return hash(bytes);
}
function parse(bytes){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function copyIdentity(copy){
  need(copy&&copy.schema===SCHEMA&&copy.workingCopySchema===WORKING&&typeof copy.copyId==='string'&&copy.copyId&&
    copy.scope&&typeof copy.scope==='object'&&copy.state&&typeof copy.state==='object'&&
    typeof copy.state.draftId==='string'&&copy.state.draftId&&Array.isArray(copy.requests),
    'Import the complete original browser Source Desk working copy.','SOURCE_COLLECTION_COPY_REQUIRED');
  sequence(copy.sequence);
  return {copyId:copy.copyId,draftId:copy.state.draftId,scope:clone(copy.scope)};
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export class InstallationSourceCollectionStore{
  constructor({directory,workspaceDirectory}){
    this.directory=resolve(directory);this.workspaceDirectory=resolve(workspaceDirectory);
  }
  async init(){
    await privateDirectory(this.directory);
    for(const name of ['blobs','checkpoints'])await privateDirectory(join(this.directory,name));
    const manifest=parse(await readPrivate(join(this.directory,'selection.json'),128*1024));
    need(manifest.schema===SOURCE_COLLECTION_STORE_SCHEMA&&manifest.workspaceDirectory===this.workspaceDirectory,
      'Use this complete collection store with its original Grant workspace.');
    this.manifest=manifest;return this;
  }
  static async create({directory,workspaceDirectory,workingCopy,originalBytes}){
    const store=new this({directory,workspaceDirectory});
    await privateDirectory(dirname(store.directory));await privateDirectory(store.directory,{create:true});
    for(const name of ['blobs','checkpoints'])await privateDirectory(join(store.directory,name),{create:true});
    const copy=clone(workingCopy),identity=copyIdentity(copy),bytes=originalBytes===undefined?json(copy):Buffer.from(originalBytes);
    need(bytes.length<=SOURCE_COLLECTION_MAX_COPY_BYTES&&same(parse(bytes),copy),
      'Retain the complete imported browser working copy and its original bytes.');
    const manifest={schema:SOURCE_COLLECTION_STORE_SCHEMA,workspaceDirectory:store.workspaceDirectory,
      ...identity,initialSequence:copy.sequence,input:{bytes:bytes.length,sha256:hash(bytes)}};
    await publish(join(store.directory,'original-input.json'),bytes);
    await publish(join(store.directory,'selection.json'),json(manifest));store.manifest=manifest;
    await store._saveCheckpoint(copy,null);return store;
  }
  async _encode(copy){
    const document=clone(copy),strings=[];
    const visit=async(value,path=[])=>{
      if(!value||typeof value!=='object')return;
      for(const key of Object.keys(value)){
        const item=value[key],next=[...path,key];
        if(key==='contentBase64'&&typeof item==='string'){
          const bytes=Buffer.from(item,'utf8'),sha256=hash(bytes);
          await publish(join(this.directory,'blobs',sha256),bytes);
          strings.push({path:next,bytes:bytes.length,sha256});value[key]=null;
        }else if(item&&typeof item==='object')await visit(item,next);
      }
    };
    await visit(document);return {document,strings};
  }
  async _decode(record){
    const copy=clone(record.document),paths=new Set();
    for(const entry of record.strings){
      checkedSha(entry.sha256);need(Array.isArray(entry.path)&&entry.path.length>0&&
        entry.path.every(key=>typeof key==='string')&&entry.path.at(-1)==='contentBase64'&&
        Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&entry.bytes<=SOURCE_COLLECTION_MAX_COPY_BYTES,
        'Keep each complete original base64 member identity.');
      const key=JSON.stringify(entry.path);need(!paths.has(key),'Keep one immutable content member per original JSON path.');paths.add(key);
      let target=copy;
      for(const segment of entry.path.slice(0,-1)){
        need(target&&typeof target==='object'&&Object.hasOwn(target,segment),'Keep the complete original content path.');target=target[segment];
      }
      need(target&&Object.hasOwn(target,'contentBase64')&&target.contentBase64===null,'Keep the original content field.');
      const bytes=await readPrivate(join(this.directory,'blobs',entry.sha256),entry.bytes);
      need(bytes.length===entry.bytes&&hash(bytes)===entry.sha256,'The retained complete original content differs.');
      Object.defineProperty(target,'contentBase64',{value:new TextDecoder('utf-8',{fatal:true}).decode(bytes),writable:true,enumerable:true,configurable:true});
    }
    const bytes=json(copy);
    need(bytes.length===record.copyBytes&&hash(bytes)===record.copySha256&&bytes.length<=SOURCE_COLLECTION_MAX_COPY_BYTES,
      'The reconstructed complete browser copy differs from its original checkpoint.');
    need(same(copyIdentity(copy),{copyId:this.manifest.copyId,draftId:this.manifest.draftId,scope:this.manifest.scope}),
      'The saved working copy belongs to another original case, draft or copy.');
    return copy;
  }
  async _record(number){
    const bytes=await readPrivate(join(this.directory,'checkpoints',checkpointName(number)),SOURCE_COLLECTION_MAX_COPY_BYTES);
    const record=parse(bytes);
    need(record.schema===SOURCE_COLLECTION_STORE_SCHEMA&&record.sequence===number&&
      record.workspaceDirectory===this.workspaceDirectory&&Array.isArray(record.strings),
      'Open the complete original collection checkpoint.');
    return {record,sha256:hash(bytes),bytes};
  }
  async _head(){
    const numbers=(await readdir(join(this.directory,'checkpoints')))
      .filter(name=>/^checkpoint-\d{16}\.json$/.test(name)).map(name=>Number(name.slice(11,-5))).sort((a,b)=>a-b);
    need(numbers.length>0&&numbers[0]===this.manifest.initialSequence&&
      numbers.every((n,i)=>n===this.manifest.initialSequence+i),'Keep every original committed working-copy sequence.');
    return numbers.at(-1);
  }
  async load({sequence:selected}={}){
    if(!this.manifest)await this.init();
    const number=selected===undefined?await this._head():sequence(selected);
    need(number>=this.manifest.initialSequence,'Choose a retained original working-copy sequence.');
    const {record}=await this._record(number);
    if(number===this.manifest.initialSequence)need(record.previousSha256===null,'Keep the initial original working-copy boundary.');
    else{const previous=await this._record(number-1);need(record.previousSha256===previous.sha256,'The original checkpoint chain differs.');}
    return this._decode(record);
  }
  async _saveCheckpoint(copy,previousSha256){
    const encoded=await this._encode(copy),bytes=json(copy);
    need(bytes.length<=SOURCE_COLLECTION_MAX_COPY_BYTES,'The complete working copy exceeds its original 512 MiB bound.');
    const record={schema:SOURCE_COLLECTION_STORE_SCHEMA,workspaceDirectory:this.workspaceDirectory,
      sequence:sequence(copy.sequence),previousSha256,copySha256:hash(bytes),copyBytes:bytes.length,...encoded};
    await publish(join(this.directory,'checkpoints',checkpointName(copy.sequence)),json(record));
    return clone(copy);
  }
  async persist(workingCopy,{expectedSequence}){
    if(!this.manifest)await this.init();sequence(expectedSequence);
    need(expectedSequence>=this.manifest.initialSequence,'Use the retained original working-copy sequence.');
    const copy=clone(workingCopy);
    need(copy.sequence===expectedSequence||copy.sequence===expectedSequence+1,
      'Retain the complete copy at its expected original sequence.');
    copy.sequence=expectedSequence+1;
    need(same(copyIdentity(copy),{copyId:this.manifest.copyId,draftId:this.manifest.draftId,scope:this.manifest.scope}),
      'Keep the original case, draft and copy identity when saving.');
    const previous=await this._record(expectedSequence),head=await this._head();
    if(head>expectedSequence){
      const retained=await this.load({sequence:expectedSequence+1});
      need(same(retained,copy),'Another writer advanced this complete original copy. Reload its recorded requests before continuing.','SOURCE_COLLECTION_CONFLICT');
      need(head===expectedSequence+1,'This original copy has a newer retained continuation.','SOURCE_COLLECTION_CONFLICT');
      return retained;
    }
    need(head===expectedSequence,'The original working-copy sequence is unavailable.');
    await this._saveCheckpoint(copy,previous.sha256);
    return this.load({sequence:copy.sequence});
  }
  async export(options){return json(await this.load(options));}
  async history(){
    if(!this.manifest)await this.init();const last=await this._head(),items=[];
    for(let n=this.manifest.initialSequence;n<=last;n++){const {record,sha256}=await this._record(n);
      items.push({sequence:n,copySha256:record.copySha256,copyBytes:record.copyBytes,checkpointSha256:sha256,previousSha256:record.previousSha256});}
    return {schema:SOURCE_COLLECTION_STORE_SCHEMA,workspaceDirectory:this.workspaceDirectory,
      copyId:this.manifest.copyId,initialSequence:this.manifest.initialSequence,sequence:last,items};
  }
  async originalInput(){
    if(!this.manifest)await this.init();
    const bytes=await readPrivate(join(this.directory,'original-input.json'),SOURCE_COLLECTION_MAX_COPY_BYTES);
    need(bytes.length===this.manifest.input.bytes&&hash(bytes)===this.manifest.input.sha256,'Keep the complete original imported working copy.');
    return bytes;
  }
}
