// MIT. Authenticated browser transport into the original host-selected source inbox.
// The native edition.import action remains the sole source receiver/reviewer.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,readdir,rename,link,unlink} from 'node:fs/promises';
import {join,isAbsolute,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fault,identity,json} from '../contract.mjs';
import {privateDirectory,readOwned,atomicJSON,syncDir} from '../../stellar-expert/store.mjs';

const MAX_FILE=2*1024*1024*1024,CHUNK=4*1024*1024,NOFOLLOW=constants.O_NOFOLLOW??0;
const HASH=/^[a-f0-9]{64}$/;
const locks=new Map();
function scalar(url,name){const values=url.searchParams.getAll(name);if(values.length!==1)throw fault('DESK_INBOX_INPUT','Supply one '+name+'.');return values[0];}
function selected(url){
  const filename=scalar(url,'filename'),sha256=scalar(url,'sha256'),raw=scalar(url,'bytes');
  if(!filename||filename!==basename(filename)||/[\\/\u0000-\u001f\u007f]/.test(filename)||filename.startsWith('.')||Buffer.byteLength(filename)>220)
    throw fault('DESK_INBOX_FILENAME','Use the original single-component archive filename.');
  if(!HASH.test(sha256)||!/^(0|[1-9]\d*)$/.test(raw))throw fault('DESK_INBOX_IDENTITY','Supply the complete source SHA256 and integer byte count.');
  const bytes=Number(raw);if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX_FILE)throw fault('DESK_INBOX_CAPACITY','The original source inbox accepts complete files up to2GiB.',413);
  return {filename,sha256,bytes,id:identity({filename,sha256,bytes})};
}
const directory=(path,options)=>privateDirectory(path,options);
async function ownedFile(path,flags=constants.O_RDONLY){
  const fd=await open(path,flags|NOFOLLOW,0o600);
  try{const s=await fd.stat();if(!s.isFile()||s.mode&0o077||typeof process.getuid==='function'&&s.uid!==process.getuid())
    throw fault('DESK_INBOX_FILE','Use a private regular inbox file owned by this host account.',409);return fd;}
  catch(e){await fd.close();throw e;}
}
async function hashed(path){
  const fd=await ownedFile(path);try{const stat=await fd.stat(),h=createHash('sha256'),buffer=Buffer.alloc(192*1024);let offset=0;
    while(offset<stat.size){const r=await fd.read(buffer,0,Math.min(buffer.length,stat.size-offset),offset);if(!r.bytesRead)throw fault('DESK_INBOX_CHANGED','The original file ended while reading.',409);h.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
    const after=await fd.stat();if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino)throw fault('DESK_INBOX_CHANGED','The selected inbox file changed during its complete read.',409);
    return {bytes:offset,sha256:h.digest('hex')};
  }finally{await fd.close();}
}
async function jsonFile(path){return JSON.parse((await readOwned(path,1024*1024)).toString('utf8'));}
const syncDirectory=syncDir;
const save=atomicJSON;
function response(res,status,value){const b=json(value);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(b);}
async function exclusive(id,run){
  if(locks.has(id))throw fault('DESK_UPLOAD_ACTIVE','This exact source upload already has a writer; reopen its saved status.',409);
  const p=run();locks.set(id,p);try{return await p;}finally{if(locks.get(id)===p)locks.delete(id);}
}
export function createDeskInbox({sourceInboxDirectory=null,instanceId=null}={}){
  let closing=false;
  const pending=new Set();
  async function roots(){if(!sourceInboxDirectory)throw fault('DESK_INBOX_NOT_CONFIGURED','The host must bind the original source inbox in Applications before browser receiving.',409);
    const root=await directory(sourceInboxDirectory),staging=await directory(join(root,'.sensorthings-desk-incoming'),{create:true});return {root,staging};}
  async function uploadState(input){
    const {root,staging}=await roots(),target=join(root,input.filename),metadata=join(staging,input.id+'.json'),part=join(staging,input.id+'.part');
    try{const current=await hashed(target);if(current.bytes!==input.bytes||current.sha256!==input.sha256)throw fault('DESK_INBOX_CONFLICT','This original filename already contains different bytes; preserve it and choose the actual source filename.',409);
      return {root,staging,target,metadata,part,complete:true,offset:input.bytes,record:null};}catch(e){if(e.code!=='ENOENT')throw e;}
    let record;try{record=await jsonFile(metadata);if(record.schema!=='stellar-forge.sensorthings-desk-upload.v1'||identity(record.selection)!==identity(input))throw fault('DESK_UPLOAD_IDENTITY','The retained original upload belongs to another source.',409);}
    catch(e){if(e.code!=='ENOENT')throw e;record={schema:'stellar-forge.sensorthings-desk-upload.v1',selection:input,createdAt:new Date().toISOString(),chunks:[],offset:0};await save(metadata,record);}
    let offset=0;try{const fd=await ownedFile(part);try{offset=(await fd.stat()).size;}finally{await fd.close();}}catch(e){if(e.code!=='ENOENT')throw e;}
    if(offset<record.offset||offset>input.bytes)throw fault('DESK_UPLOAD_PREFIX_CHANGED','The retained upload prefix differs from its original receipt.',409);
    // A crash after data fsync but before metadata commit leaves an uncommitted
    // tail. Keep those bytes, expose only the original committed offset, and
    // verify any replay against them before moving the original cursor.
    return {root,staging,target,metadata,part,record,complete:false,offset:record.offset,uncommittedBytes:offset-record.offset};
  }
  async function finish(input,s){
    const complete=await hashed(s.part);if(complete.bytes!==input.bytes||complete.sha256!==input.sha256)throw fault('DESK_UPLOAD_HASH','The complete upload differs from the selected original source; its retained prefix remains available for inspection.',409,{bytes:complete.bytes,sha256:complete.sha256});
    try{await link(s.part,s.target);}catch(e){if(e.code!=='EEXIST')throw e;const prior=await hashed(s.target);if(prior.bytes!==input.bytes||prior.sha256!==input.sha256)throw fault('DESK_INBOX_CONFLICT','The original destination changed before publication.',409);}
    await syncDirectory(s.root);
    await save(s.metadata,{...s.record,offset:input.bytes,completedAt:s.record.completedAt??new Date().toISOString(),state:'COMPLETE'});
    await unlink(s.part).catch(e=>{if(e.code!=='ENOENT')throw e;});
    return {schema:'stellar-forge.sensorthings-desk-upload-result.v1',complete:true,filename:input.filename,bytes:input.bytes,sha256:input.sha256,offset:input.bytes,chunkBytes:CHUNK,
      receiving:{action:'edition.import',payload:{filename:input.filename,expectedBytes:input.bytes,expectedSha256:input.sha256}}};
  }
  async function route(req,res,{url,workspaceId}){
    if(!url.pathname.startsWith('/api/desk/'))return false;
    if(closing)throw fault('DESK_INBOX_CLOSING','The original source receiving transport is closing.',503);
    if(url.pathname==='/api/desk/info'&&req.method==='GET'){response(res,200,{schema:'stellar-forge.sensorthings-desk-info.v1',workspaceId,instanceId,sourceInboxConfigured:Boolean(sourceInboxDirectory),uploadMaxBytes:MAX_FILE,uploadChunkBytes:CHUNK});return true;}
    if(url.pathname==='/api/desk/inbox'&&req.method==='GET'){
      const {root}=await roots(),wanted=url.searchParams.get('filename');
      if(wanted!==null){if(!wanted||wanted!==basename(wanted)||wanted.startsWith('.')||/[\\/\u0000-\u001f\u007f]/.test(wanted))throw fault('DESK_INBOX_FILENAME','Choose one listed inbox filename.');
        response(res,200,{filename:wanted,...await hashed(join(root,wanted))});return true;}
      const entries=await readdir(root,{withFileTypes:true}),files=[];
      for(const entry of entries.filter(e=>e.isFile()&&!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name))){
        if(files.length>=1000)break;const path=join(root,entry.name),s=await lstat(path);
        if(s.isFile()&&!s.isSymbolicLink()&&!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid()))files.push({filename:entry.name,bytes:s.size,modifiedAt:s.mtime.toISOString()});
      }
      response(res,200,{files,limit:1000,additionalEntries:entries.filter(e=>e.isFile()&&!e.name.startsWith('.')).length>files.length});return true;
    }
    if(url.pathname!=='/api/desk/inbox/upload')return false;
    const input=selected(url);
    if(req.method==='GET'){
      const s=await exclusive(input.id,async()=>{const current=await uploadState(input);if(!current.complete&&current.offset===input.bytes)return {...await finish(input,current),uncommittedBytes:0};return current;});
      response(res,200,{complete:s.complete,filename:input.filename,bytes:input.bytes,sha256:input.sha256,offset:s.offset,chunkBytes:CHUNK,uncommittedBytes:s.uncommittedBytes??0});return true;
    }
    if(req.method!=='POST')throw fault('DESK_INBOX_METHOD','Use the original upload status or chunk operation.',405);
    if(String(req.headers['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/octet-stream')throw fault('DESK_UPLOAD_TYPE','Send the exact selected file bytes.',415);
    const rawOffset=scalar(url,'offset'),chunkSha=scalar(url,'chunkSha256');
    if(!/^(0|[1-9]\d*)$/.test(rawOffset)||!HASH.test(chunkSha))throw fault('DESK_UPLOAD_CHUNK','Supply the original chunk offset and complete chunk hash.');
    const offset=Number(rawOffset);if(!Number.isSafeInteger(offset))throw fault('DESK_UPLOAD_CHUNK','The original chunk offset is invalid.');
    const result=await exclusive(input.id,async()=>{
      const s=await uploadState(input);
      const parts=[];let count=0;for await(const part of req){count+=part.length;if(count>CHUNK)throw fault('DESK_UPLOAD_CHUNK','Use the original four-MiB chunk capacity.',413);parts.push(part);}
      const bytes=Buffer.concat(parts,count);if(!count||createHash('sha256').update(bytes).digest('hex')!==chunkSha||offset+count>input.bytes)throw fault('DESK_UPLOAD_CHUNK','The selected chunk identity or byte range changed.',409);
      if(s.complete)return {complete:true,filename:input.filename,bytes:input.bytes,sha256:input.sha256,offset:input.bytes,chunkBytes:CHUNK};
      if(offset<s.offset){const previous=s.record.chunks.find(c=>c.offset===offset);if(!previous||previous.bytes!==count||previous.sha256!==chunkSha)throw fault('DESK_UPLOAD_REPLAY_CHANGED','The repeated original chunk differs from its retained receipt.',409);
        return {complete:false,filename:input.filename,bytes:input.bytes,sha256:input.sha256,offset:s.offset,chunkBytes:CHUNK,reused:true};}
      if(offset!==s.offset)throw fault('DESK_UPLOAD_OFFSET','Resume the committed original upload prefix.',409,{offset:s.offset});
      const f=await ownedFile(s.part,constants.O_RDWR|constants.O_CREAT);
      try{const before=await f.stat();if(before.size<offset)throw fault('DESK_UPLOAD_PREFIX_CHANGED','The retained original prefix ended before its receipt.',409);
        if(before.size>offset){if(before.size>offset+count)throw fault('DESK_UPLOAD_PREFIX_CHANGED','The uncommitted tail exceeds this exact replay.',409);
          const previous=Buffer.alloc(before.size-offset);await f.read(previous,0,previous.length,offset);if(!previous.equals(bytes.subarray(0,previous.length)))throw fault('DESK_UPLOAD_REPLAY_CHANGED','The retained uncommitted original tail differs from this selected replay.',409);}
        let written=0;while(written<bytes.length){const r=await f.write(bytes,written,bytes.length-written,offset+written);if(!r.bytesWritten)throw fault('DESK_UPLOAD_WRITE','The original upload write made no progress.',507);written+=r.bytesWritten;}
        await f.sync();
      }finally{await f.close();}
      s.record={...s.record,offset:offset+count,chunks:[...s.record.chunks,{offset,bytes:count,sha256:chunkSha}]};
      await save(s.metadata,s.record);
      if(s.record.offset===input.bytes)return finish(input,s);
      return {complete:false,filename:input.filename,bytes:input.bytes,sha256:input.sha256,offset:s.record.offset,chunkBytes:CHUNK};
    });
    response(res,200,result);return true;
  }
  function handleApi(req,res,context){const p=route(req,res,context);pending.add(p);void p.finally(()=>pending.delete(p)).catch(()=>{});return p;}
  async function close(){closing=true;await Promise.allSettled([...pending]);}
  return {handleApi,close};
}
