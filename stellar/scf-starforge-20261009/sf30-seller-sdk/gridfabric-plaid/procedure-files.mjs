// MIT. Private files belonging to the original Grid procedure controller.
import {constants,createReadStream} from 'node:fs';
import {open,lstat,realpath,mkdir,readdir,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,join,isAbsolute} from 'node:path';

export const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function need(value,code,message,statusCode=400,details={}) {
  if(!value)throw Object.assign(new Error(message),{code,statusCode,details});
}
export function memberPath(value) {
  need(typeof value==='string'&&value.length>0&&value.length<=4096&&!isAbsolute(value)&&
    !/[\\\x00-\x1f\x7f]/.test(value)&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'),
    'GRID_PROCEDURE_PATH','Use a complete relative original capture member.');
  return value;
}
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode,s.nlink].join(':');
export async function privateDirectory(path,{create=false}={}) {
  path=resolve(path);
  if(create){try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}}
  const st=await lstat(path);
  need(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&await realpath(path)===path,
    'GRID_PROCEDURE_DIRECTORY','Keep the original private ordinary directory.',409,{path});
  return path;
}
export async function makeParents(root,relative) {
  memberPath(relative);let current=await privateDirectory(root);
  for(const part of relative.split('/').slice(0,-1)){current=join(current,part);await privateDirectory(current,{create:true});}
}
export async function originalFile(path,{maximum=Number.MAX_SAFE_INTEGER,privateOnly=true}={}) {
  path=resolve(path);
  const st=await lstat(path);
  need(st.isFile()&&!st.isSymbolicLink()&&st.size<=maximum&&(!privateOnly||(st.mode&0o077)===0),
    'GRID_PROCEDURE_FILE','Keep the complete ordinary private file.',409,{path});
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    need(stamp(await handle.stat())===stamp(st),'GRID_PROCEDURE_FILE_CHANGED','The original file changed.',409);
    const unchanged=async()=>{
      need(stamp(await handle.stat())===stamp(st)&&stamp(await lstat(path))===stamp(st),
        'GRID_PROCEDURE_FILE_CHANGED','The original file changed while it was received.',409,{path});
    };
    return {handle,stat:st,path,unchanged};
  }catch(e){await handle.close();throw e;}
}
export async function readBytes(path,maximum=Number.MAX_SAFE_INTEGER) {
  const file=await originalFile(path,{maximum});
  try{const bytes=await file.handle.readFile();await file.unchanged();return bytes;}
  finally{await file.handle.close();}
}
export async function readJSON(path,maximum=96*1024*1024) {
  const raw=await readBytes(path,maximum);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw Object.assign(new Error('Keep complete UTF-8 JSON: '+path),{code:'GRID_PROCEDURE_JSON',statusCode:409});}
}
export async function exists(path) {
  try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
export async function syncDirectory(path) {
  const h=await open(path,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}
}
export async function writeNew(path,bytes) {
  const h=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
}
export async function publishNew(path,bytes) {
  const temporary=join(dirname(path),'.publish-'+randomUUID());
  await writeNew(temporary,bytes);
  try{await link(temporary,path);await syncDirectory(dirname(path));}
  finally{await unlink(temporary);}
}
export async function frozenJSON(path,value) {
  const bytes=jsonBytes(value);
  if(await exists(path)){
    need((await readBytes(path)).equals(bytes),'GRID_PROCEDURE_IDENTITY','The retained original request differs.',409);
    return value;
  }
  try{await publishNew(path,bytes);}
  catch(e){if(e.code!=='EEXIST')throw e;need((await readBytes(path)).equals(bytes),'GRID_PROCEDURE_IDENTITY','The retained original request differs.',409);}
  return value;
}
export async function fileIdentity(path) {
  const file=await originalFile(path);const hash=createHash('sha256');let bytes=0;
  try{
    for await(const chunk of file.handle.createReadStream({autoClose:false})){bytes+=chunk.length;hash.update(chunk);}
    await file.unchanged();need(bytes===file.stat.size,'GRID_PROCEDURE_FILE_CHANGED','The complete file length changed.',409);
    return {bytes,sha256:hash.digest('hex')};
  }finally{await file.handle.close();}
}
export async function ordinaryNames(path) {
  const names=await readdir(await privateDirectory(path));return names.sort();
}
export async function streamOriginal(path,response,identity) {
  const selected=await originalFile(path);
  try{
    need(!identity||selected.stat.size===identity.bytes,'GRID_PROCEDURE_FILE_CHANGED','The complete file changed.',409);
    const hash=createHash('sha256');let count=0;
    for await(const bytes of selected.handle.createReadStream({autoClose:false})){
      hash.update(bytes);count+=bytes.length;
      if(!response.write(bytes))await new Promise((ok,no)=>{const close=()=>{cleanup();no(new Error('The receiving connection closed.'));};
        const drain=()=>{cleanup();ok();};const cleanup=()=>{response.off('close',close);response.off('error',error);response.off('drain',drain);};
        const error=e=>{cleanup();no(e);};response.once('close',close);response.once('error',error);response.once('drain',drain);});
    }
    await selected.unchanged();
    need(count===selected.stat.size&&(!identity||hash.digest('hex')===identity.sha256),
      'GRID_PROCEDURE_FILE_CHANGED','The complete original download changed.',409);
    response.end();
  }finally{await selected.handle.close();}
}
