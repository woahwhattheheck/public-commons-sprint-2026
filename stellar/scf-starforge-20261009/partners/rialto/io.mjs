// MIT — Private, complete receiving and original source transport.
import {createHash,randomUUID} from 'node:crypto';
import {promises as fs,constants as FC} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {validateHeaderName,validateHeaderValue} from 'node:http';
import {SCHEMA,need,https,canonical} from './core.mjs';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export async function read(file){return fs.readFile(path.resolve(file));}
export async function readJson(file){return JSON.parse((await read(file)).toString('utf8'));}
export async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function privateDir(dir,{create=false}={}){
 dir=path.resolve(dir);if(create)await fs.mkdir(dir,{mode:0o700});
 const st=await fs.lstat(dir);need(st.isDirectory()&&!st.isSymbolicLink()&&await fs.realpath(dir)===dir,'Private directory must have an original, nonsymlink path');
 need((st.mode&0o077)===0,'Set directory mode0700 before receiving');return dir;
}
async function sync(dir){const f=await fs.open(dir,'r');try{await f.sync();}finally{await f.close();}}
export async function writeNew(file,data){
 file=path.resolve(file);const temp=path.join(path.dirname(file),'.receiving-write-'+randomUUID()),f=await fs.open(temp,'wx',0o600);
 try{
  try{await f.writeFile(data);await f.sync();}finally{await f.close();}
  await fs.link(temp,file);await sync(path.dirname(file));
 }finally{await fs.unlink(temp).catch(()=>{});}
}
export async function retain(file,data){if(await exists(file)){need((await read(file)).equals(Buffer.from(data)),'Retained original bytes differ: '+path.basename(file));return;}await writeNew(file,data);}
export async function lock(dir,fn){
 dir=await privateDir(dir);const file=path.join(dir,'.receiving-lock');
 const descriptor=await fs.open(file,FC.O_RDWR|FC.O_CREAT|FC.O_NOFOLLOW,0o600);
 try{
  const st=await descriptor.stat();need(st.isFile()&&(st.mode&0o077)===0,'Receiving lock must be a private ordinary file');
  // flock(2) belongs to the shared open-file description. The short acquisition
  // child, this parent and any native writer all inherit that same descriptor.
  // Closing this parent cannot release a surviving native writer's lock.
  await new Promise((resolve,reject)=>{
   const child=spawn(process.env.RIALTO_FLOCK??'flock',['--exclusive','--nonblock','--conflict-exit-code','75','3'],{stdio:['ignore','ignore','pipe',descriptor.fd]});let failure='';
   child.stderr.on('data',part=>{failure+=part.toString();});child.once('error',reject);
   child.once('close',code=>{if(code===0)resolve();else reject(new Error(code===75?'Receiving writer is active':'Linux flock could not acquire receiving directory: '+failure));});
  });
  return await fn(descriptor.fd);
 }finally{await descriptor.close();}
}
// Follows the original SF88 request-headers.mjs reserved-field contract (MIT).
export function ordinaryHeaders(input={}){
 need(input&&typeof input==='object'&&!Array.isArray(input),'Request headers must be an object');
 const reserved=/^(?:host|connection|keep-alive|content-length|transfer-encoding|te|trailer|upgrade|expect|proxy-.*|cookie|set-cookie|accept-encoding|content-encoding|origin|referer|forwarded|x-forwarded-.*|sec-.*|payment-.*|x-payment.*|extension-responses|settlement-overrides|x402-.*|www-authenticate|authorization|x-api-key|api-key|apikey|x-merchant-operation)$/i;
 const seen=new Set(),out={};let bytes=0;need(Object.keys(input).length<=64,'At most64 ordinary headers');
 for(const [name,value]of Object.entries(input)){const lower=name.toLowerCase();need(name.length<=128&&typeof value==='string'&&!seen.has(lower)&&!reserved.test(lower),'Invalid, duplicate or reserved request header: '+name);validateHeaderName(name);validateHeaderValue(name,value);need(new Headers([[name,value]]).get(name)===value,'Request header would be normalized: '+name);bytes+=Buffer.byteLength(lower+': '+value+'\r\n');need(bytes<=8192,'Request headers exceed8KiB');seen.add(lower);out[lower]=value;}return out;
}
export async function http(url,{method='GET',body,headers={},timeoutMs=30000,maxBytes=32*1024*1024}={}){
 https(url);const startedAt=new Date().toISOString(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 const requestHeaders={accept:'application/json','user-agent':'TokenJunkieLabs-Rialto-Receiving/1.0',...ordinaryHeaders(headers)};
 try{
  const response=await fetch(url,{method,body,headers:requestHeaders,redirect:'manual',signal:controller.signal});
  const parts=[];let size=0;for await(const part of response.body??[]){size+=part.byteLength;if(size>maxBytes){controller.abort();throw new Error('Original HTTP response exceeds configured capture bytes');}parts.push(part);}
  const raw=Buffer.concat(parts);let bodyUtf8=null;try{bodyUtf8=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{}
  return{url,method,requestHeaders,startedAt,retrievedAt:new Date().toISOString(),status:response.status,headers:Object.fromEntries(response.headers),bodyBase64:raw.toString('base64'),bodySha256:sha(raw),bodyBytes:raw.length,bodyUtf8,...(body===undefined?{}:{requestBodySha256:sha(body),requestBodyBytes:body.length})};
 }catch(error){return{url,method,requestHeaders,startedAt,retrievedAt:new Date().toISOString(),status:null,error:String(error.message),...(body===undefined?{}:{requestBodySha256:sha(body),requestBodyBytes:body.length})};}
 finally{clearTimeout(timer);}
}
export function verifyHttp(value){
 need(typeof value.url==='string'&&typeof value.method==='string','HTTP request identity missing');
 if(value.status===null)return value;
 need(typeof value.bodyBase64==='string','Complete HTTP body missing');const raw=Buffer.from(value.bodyBase64,'base64');
 need(raw.toString('base64')===value.bodyBase64&&raw.length===value.bodyBytes&&sha(raw)===value.bodySha256,'Original HTTP bytes changed');
 if(value.bodyUtf8!==null)need(Buffer.from(value.bodyUtf8,'utf8').equals(raw),'Original HTTP text changed');
 return value;
}
export async function captureGet(root,url){
 const dir=path.join(root,'captures');if(!await exists(dir))await fs.mkdir(dir,{mode:0o700});
 const prefix=sha(Buffer.from(url)),names=(await fs.readdir(dir)).filter(n=>n.startsWith(prefix+'-')&&n.endsWith('.json')).sort();
 for(const name of names){const v=verifyHttp(await readJson(path.join(dir,name)));need(v.url===url&&v.method==='GET','Retained GET identity changed');if(v.status===200)return{name:'captures/'+name,value:v};}
 const value=await http(url),name=prefix+'-'+String(names.length).padStart(6,'0')+'.json';await writeNew(path.join(dir,name),json(value));
 return{name:'captures/'+name,value};
}
export async function inventory(root){
 root=await privateDir(root);const files=[];
 async function walk(dir){for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name==='.receiving-lock'||entry.name.startsWith('.receiving-write-'))continue;const full=path.join(dir,entry.name);
  need(!entry.isSymbolicLink(),'Receive ordinary files only: '+entry.name);
  if(entry.isDirectory())await walk(full);else{need(entry.isFile(),'Unsupported file in receiving package');const raw=await fs.readFile(full);files.push({path:path.relative(root,full).split(path.sep).join('/'),bytes:raw.length,sha256:sha(raw),base64:raw.toString('base64')});}
 }}await walk(root);return files;
}
export async function pack(root,out){
 root=await privateDir(root);out=path.resolve(out);need(out!==root&&!out.startsWith(root+path.sep),'Archive destination must be outside its original directory');
 return lock(root,async()=>{const files=await inventory(root),packet={schema:SCHEMA,kind:'complete-private-receiving',sourceDirectoryName:path.basename(root),createdAt:new Date().toISOString(),files};
 const raw=json(packet);await writeNew(out,raw);return{file:out,bytes:raw.length,sha256:sha(raw),files:files.length};});
}
export async function receive(file,destination){
 const raw=await read(file),p=JSON.parse(raw);need(p.schema===SCHEMA&&p.kind==='complete-private-receiving'&&Array.isArray(p.files),'Complete Rialto receiving packet required');
 const out=path.resolve(destination);need(!await exists(out),'Receiving destination already exists');
 const seen=new Set();let total=0;
 for(const f of p.files){need(typeof f.path==='string'&&!f.path.includes('\\')&&!f.path.includes('\0')&&!f.path.startsWith('/')&&f.path.split('/').every(x=>x&&x!=='.'&&x!=='..')&&!seen.has(f.path),'Invalid or duplicate receiving path');seen.add(f.path);const b=Buffer.from(f.base64,'base64');need(b.toString('base64')===f.base64&&b.length===f.bytes&&sha(b)===f.sha256,'Receiving member bytes changed: '+f.path);total+=b.length;}
 need(total<=1024*1024*1024,'Receiving package exceeds1GiB');const stage=path.join(path.dirname(out),'.rialto-receive-'+randomUUID());await fs.mkdir(stage,{mode:0o700});
 try{for(const f of p.files){const dest=path.join(stage,...f.path.split('/'));await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await writeNew(dest,Buffer.from(f.base64,'base64'));}await fs.rename(stage,out);await sync(path.dirname(out));}
 catch(e){await fs.rm(stage,{recursive:true,force:true});throw e;}
 return{directory:out,sourcePacketSha256:sha(raw),files:p.files.length,bytes:total};
}
export async function copyOriginal(source,destination){
 const a=path.resolve(source),b=path.resolve(destination);need(a!==b&&!b.startsWith(a+path.sep),'Receiving destination must be outside original source');
 return lock(a,async()=>{await fs.mkdir(b,{mode:0o700});for(const f of await inventory(a)){const dest=path.join(b,...f.path.split('/'));await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await writeNew(dest,Buffer.from(f.base64,'base64'));}
 return b;});
}
