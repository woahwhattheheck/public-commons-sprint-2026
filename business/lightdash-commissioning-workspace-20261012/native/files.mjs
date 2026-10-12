import {open,readFile,writeFile,mkdir,rename,link,unlink,readdir,lstat,realpath,chmod} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export const objectDigest=value=>digest(canonical(value));
export function fail(code,message,details={}){const e=new Error(message);e.code=code;e.details=details;throw e;}
export function check(test,code,message,details={}){if(!test)fail(code,message,details);}
export function safeRelative(value){check(typeof value==='string'&&value.length>0&&value.length<2048&&!value.includes('\\')&&!value.includes('\0')&&!path.posix.isAbsolute(value)&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'),'LIGHTDASH_PATH','Use a normalized relative file path.');return value;}
export function inside(root,relative){safeRelative(relative);const p=path.resolve(root,relative);check(p.startsWith(path.resolve(root)+path.sep),'LIGHTDASH_PATH','File escapes its declared directory.');return p;}
export async function optional(file){try{return await readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function readJson(file,{optional:missing=false}={}){const b=missing?await optional(file):await readFile(file);return b===null?null:JSON.parse(b);}
export async function durable(file,bytes,{createOnly=false}={}){
 bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+randomUUID()+'.partial',f=await open(tmp,'wx',0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 try{if(createOnly){try{await link(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;check((await readFile(file)).equals(bytes),'LIGHTDASH_RETAINED_BYTES_CHANGED','Existing retained bytes differ.');}await unlink(tmp);}else await rename(tmp,file);}
 catch(e){try{await unlink(tmp);}catch{}throw e;}
 const d=await open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}
}
export const saveJson=(file,value,options)=>durable(file,jsonBytes(value),options);
export async function fileIdentity(file){
 const s=await lstat(file);check(s.isFile()&&!s.isSymbolicLink(),'LIGHTDASH_REGULAR_FILE','Expected a regular file.');
 const h=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){h.update(chunk);bytes+=chunk.length;}
 const after=await lstat(file);check(s.dev===after.dev&&s.ino===after.ino&&s.size===after.size&&s.mtimeMs===after.mtimeMs&&bytes===s.size,'LIGHTDASH_FILE_CHANGED','File changed while reading.');
 return {bytes,sha256:h.digest('hex')};
}
export async function inventory(directory,{exclude=[]}={}){
 const root=path.resolve(directory),st=await lstat(root);check(st.isDirectory()&&!st.isSymbolicLink(),'LIGHTDASH_DIRECTORY','Expected an actual directory.');check(await realpath(root)===root,'LIGHTDASH_DIRECTORY','Directory must resolve to its declared path.');
 const omitted=new Set(exclude),out=[];
 async function walk(dir,prefix=''){for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const rel=prefix+e.name;if(omitted.has(rel))continue;safeRelative(rel);const p=path.join(dir,e.name);check(!e.isSymbolicLink(),'LIGHTDASH_SOURCE_SYMLINK','Source and content inventories do not follow symlinks.',{path:rel});if(e.isDirectory())await walk(p,rel+'/');else{check(e.isFile(),'LIGHTDASH_SOURCE_TYPE','Only regular source files are accepted.',{path:rel});out.push({path:rel,...await fileIdentity(p),executable:((await lstat(p)).mode&0o111)!==0});}}}
 await walk(root);out.sort((a,b)=>a.path.localeCompare(b.path));return out;
}
export async function verifyManifest({directory,manifestFile,manifestSha256}){
 check(path.isAbsolute(directory)&&path.isAbsolute(manifestFile)&&/^[a-f0-9]{64}$/.test(manifestSha256),'LIGHTDASH_MANIFEST','Supply absolute source paths and the complete manifest SHA256.');
 const bytes=await readFile(manifestFile);check(digest(bytes)===manifestSha256,'LIGHTDASH_MANIFEST_CHANGED','Selected manifest bytes changed.');
 const manifest=JSON.parse(bytes);check(Array.isArray(manifest.files)&&manifest.files.length<=100000,'LIGHTDASH_MANIFEST','Manifest requires a complete file inventory.');
 const expected=manifest.files.map(f=>({path:safeRelative(f.path),bytes:f.bytes,sha256:f.sha256,...(typeof f.executable==='boolean'?{executable:f.executable}:{})}));
 check(expected.every(f=>Number.isSafeInteger(f.bytes)&&f.bytes>=0&&/^[a-f0-9]{64}$/.test(f.sha256))&&new Set(expected.map(f=>f.path)).size===expected.length,'LIGHTDASH_MANIFEST','Manifest contains an invalid or duplicate file.');
 expected.sort((a,b)=>a.path.localeCompare(b.path));
 const rel=path.relative(directory,manifestFile).split(path.sep).join('/'),exclude=rel&&!rel.startsWith('../')&&!path.isAbsolute(rel)?[rel]:[];
 const actual=await inventory(directory,{exclude});
 const comparison=actual.map(f=>{const e=expected.find(x=>x.path===f.path);if(e&&e.executable===undefined){const {executable,...rest}=f;return rest;}return f;});
 check(canonical(comparison)===canonical(expected),'LIGHTDASH_SOURCE_CHANGED','The full source directory differs from its reviewed inventory.');
 return {manifest,files:actual,bytes:actual.reduce((n,f)=>n+f.bytes,0),manifestSha256};
}
export async function copyInventory(source,destination,files){
 await mkdir(destination,{recursive:true,mode:0o700});
 for(const item of files){const sourceFile=inside(source,item.path),target=inside(destination,item.path),old=await optional(target);if(old!==null){check(old.length===item.bytes&&digest(old)===item.sha256,'LIGHTDASH_COPY_CHANGED','A retained source copy differs.',{path:item.path});if(item.executable)await chmod(target,0o700);continue;}
  const b=await readFile(sourceFile);check(b.length===item.bytes&&digest(b)===item.sha256,'LIGHTDASH_SOURCE_CHANGED','Source changed before its native copy.',{path:item.path});await durable(target,b,{createOnly:true});if(item.executable)await chmod(target,0o700);}
}
export function scrub(value,secrets=[]){
 if(typeof value==='string'){let v=value;for(const secret of secrets)if(typeof secret==='string'&&secret.length>=4)v=v.split(secret).join('[redacted]');return v;}
 if(Array.isArray(value))return value.map(x=>scrub(x,secrets));
 if(value&&typeof value==='object'){const out={};for(const[k,v]of Object.entries(value))out[k]=/(?:password|passphrase|private.?key|api.?key|access.?token|refresh.?token|authorization|cookie|secret|credentials)/i.test(k)?'[redacted]':scrub(v,secrets);return out;}
 return value;
}
