// MIT. Receiving files and process custody; domain operations remain in the original product.
import {open,readFile,readdir,mkdir,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
export const now=()=>new Date().toISOString();
export const hash=raw=>createHash('sha256').update(raw).digest('hex');
export const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const need=(ok,code,message=code)=>{if(!ok)throw Object.assign(new Error(message),{code});};
export const view=error=>({code:error.code??'PROPERTY_RECEIVING',message:error.message,status:error.status??null,uncertain:error.uncertain??false,
 ...(error.details?{details:error.details}:{}),...(error.result?{result:error.result}:{})});
export const same=(a,b)=>canonical(a)===canonical(b);
export function canonical(value){return JSON.stringify(value===undefined?null:value,function(key,v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;});}
export function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0'),'PROPERTY_RECEIVING_PATH');return resolve(value);}
export function member(value){need(typeof value==='string'&&value.length>0&&value.length<=1000&&!value.includes('\\')&&!/[\u0000-\u001f]/u.test(value)&&!isAbsolute(value)&&value.split('/').every(v=>v&&v!=='.'&&v!=='..'),'PROPERTY_RECEIVING_MEMBER');return value;}
export async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export async function directory(path,{create=false}={}){
 path=absolute(path);if(create)await mkdir(path,{mode:0o700,recursive:true});
 const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path,'PROPERTY_RECEIVING_DIRECTORY');
 need(process.platform==='win32'||(s.mode&0o077)===0&&(!process.getuid||s.uid===process.getuid()),'PROPERTY_RECEIVING_PRIVATE');return path;
}
export function separate(parent,path){const r=relative(absolute(parent),absolute(path));need(r!==''&&(r==='..'||r.startsWith('../')||isAbsolute(r)),'PROPERTY_RECEIVING_OVERLAP');}
export async function identity(path,{maximum=1024*1024*1024,raw=false}={}){
 path=absolute(path);const before=await lstat(path,{bigint:true});
 const signature=s=>[s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs].join(':');
 need(before.isFile()&&!before.isSymbolicLink()&&before.size<=BigInt(maximum)&&await realpath(path)===path,'PROPERTY_RECEIVING_FILE');
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let count=0;
 const digest=createHash('sha256'),chunks=raw?[]:null,buffer=Buffer.alloc(256*1024);
 try{need(signature(await h.stat({bigint:true}))===signature(before),'PROPERTY_RECEIVING_FILE_CHANGED');
  for(;;){const item=await h.read(buffer,0,buffer.length,count);if(!item.bytesRead)break;
   count+=item.bytesRead;need(count<=maximum,'PROPERTY_RECEIVING_FILE_LIMIT');const bytes=buffer.subarray(0,item.bytesRead);digest.update(bytes);if(chunks)chunks.push(Buffer.from(bytes));}
  need(BigInt(count)===before.size&&signature(await h.stat({bigint:true}))===signature(before)&&signature(await lstat(path,{bigint:true}))===signature(before),'PROPERTY_RECEIVING_FILE_CHANGED');
 }finally{await h.close();}
 return {bytes:count,sha256:digest.digest('hex'),...(chunks?{raw:Buffer.concat(chunks)}:{})};
}
export async function readJSON(path,{optional=false,maximum=64*1024*1024}={}){
 if(optional&&!await exists(path))return null;const file=await identity(path,{maximum,raw:true});
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(file.raw));
}
export async function syncParent(path){const h=await open(dirname(path),constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}
export async function writeBytes(path,raw,{replace=false}={}){
 path=absolute(path);need(Buffer.isBuffer(raw),'PROPERTY_RECEIVING_BYTES');await directory(dirname(path),{create:true});
 if(await exists(path)){const old=await identity(path);
  if(old.bytes===raw.length&&old.sha256===hash(raw))return old;
  need(replace,'PROPERTY_RECEIVING_FILE_CONFLICT','The retained customer file differs: '+basename(path));}
 const staging=join(dirname(path),'.'+basename(path)+'.'+hash(raw)+'.staging');
 if(await exists(staging)){const old=await identity(staging);if(old.bytes!==raw.length||old.sha256!==hash(raw))await unlink(staging);}
 if(!await exists(staging)){const h=await open(staging,'wx',0o600);try{await h.writeFile(raw);await h.sync();}finally{await h.close();}}
 if(!replace&&await exists(path)){const old=await identity(path);need(old.bytes===raw.length&&old.sha256===hash(raw),'PROPERTY_RECEIVING_FILE_CONFLICT');await unlink(staging);return old;}
 await rename(staging,path);await syncParent(path);return {bytes:raw.length,sha256:hash(raw)};
}
export const writeJSON=(path,value,options)=>writeBytes(path,json(value),options);
export async function copyOriginal(source,target,expected=null){
 const original=await identity(source);if(expected)need(original.bytes===expected.bytes&&original.sha256===expected.sha256,'PROPERTY_RECEIVING_INPUT_CHANGED');
 if(await exists(target)){const old=await identity(target);need(same(old,original),'PROPERTY_RECEIVING_FILE_CONFLICT');return old;}
 await directory(dirname(target),{create:true});const stage=join(dirname(target),'.'+basename(target)+'.'+original.sha256+'.copying');
 if(await exists(stage)){const old=await identity(stage);if(!same(old,original))await unlink(stage);}
 if(!await exists(stage)){
  const buffer=Buffer.alloc(256*1024);let pos=0,src=null,out=null;
  try{src=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);out=await open(stage,'wx',0o600);
   for(;;){const part=await src.read(buffer,0,buffer.length,pos);if(!part.bytesRead)break;pos+=part.bytesRead;await out.writeFile(buffer.subarray(0,part.bytesRead));}await out.sync();}
  finally{try{if(out)await out.close();}finally{if(src)await src.close();}}
 }
 need(same(await identity(source),original)&&same(await identity(stage),original),'PROPERTY_RECEIVING_INPUT_CHANGED');
 if(await exists(target)){need(same(await identity(target),original),'PROPERTY_RECEIVING_FILE_CONFLICT');await unlink(stage);}
 else{await rename(stage,target);await syncParent(target);}return original;
}
export async function runProcess(executable,args,{maximum=128*1024*1024,cwd,environment=process.env}={}){
 const child=spawn(executable,args,{cwd,env:environment,stdio:['ignore','pipe','pipe']});
 const chunks={stdout:[],stderr:[]},counts={stdout:0,stderr:0};let failure=null;
 for(const name of ['stdout','stderr'])child[name].on('data',bytes=>{counts[name]+=bytes.length;
  if(counts[name]>maximum){failure??=Object.assign(new Error('The complete child output exceeds its declared receiving limit.'),{code:'PROPERTY_RECEIVING_PROCESS_OUTPUT'});child.kill('SIGTERM');}
  else chunks[name].push(bytes);});
 return await new Promise((done,reject)=>{child.once('error',error=>{failure??=error;});
  child.once('close',(code,signal)=>{const result={executable,args,code,signal,stdout:Buffer.concat(chunks.stdout).toString('utf8'),stderr:Buffer.concat(chunks.stderr).toString('utf8')};
   if(failure||code!==0){const error=failure??Object.assign(new Error('The original product command did not complete.'),{code:'PROPERTY_RECEIVING_PROCESS'});error.result=result;reject(error);}else done(result);});});
}
export async function poll(read,accept,{seconds=300,label='original operation',observe}={}){
 const end=Date.now()+seconds*1000;for(;;){const value=await read();if(observe)await observe(value);if(accept(value))return value;
  need(Date.now()<end,'PROPERTY_RECEIVING_PENDING','The '+label+' remains pending; preserve its original journal.');
  await new Promise(done=>setTimeout(done,1000));}
}
export async function tree(root,path=root){
 const result=[];for(const row of await readdir(path,{withFileTypes:true})){
  need(!row.isSymbolicLink(),'PROPERTY_RECEIVING_LINK');const full=join(path,row.name);
  if(row.isDirectory())result.push(...await tree(root,full));else{need(row.isFile(),'PROPERTY_RECEIVING_MEMBER');result.push({path:member(relative(root,full)),...await identity(full)});}
 }
 need(result.length<=100000,'PROPERTY_RECEIVING_MEMBER_LIMIT');return result.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function sealCustomer({journal,customer,output,save}){
 if(!journal.freeze){journal.freeze={at:now(),members:await tree(customer)};await save();}
 const files=journal.freeze.members;for(const item of files)need(same(await identity(join(customer,item.path)),{bytes:item.bytes,sha256:item.sha256}),'PROPERTY_RECEIVING_FILE_CHANGED');
 const manifest={schema:'stellar-forge.property-customer-delivery.v1',operationId:journal.operationId,createdAt:journal.createdAt,propertyId:journal.propertyId,source:journal.source,files};
 await writeJSON(join(customer,'MANIFEST.json'),manifest);
 const actual=await tree(customer),wanted=[...files,{path:'MANIFEST.json',bytes:json(manifest).length,sha256:hash(json(manifest))}].sort((a,b)=>a.path.localeCompare(b.path));
 need(same(actual,wanted),'PROPERTY_RECEIVING_UNDECLARED_MEMBER');
 const archive=join(output,'Property_Operations_Complete_Delivery.tar.gz');
 if(!journal.package){
  const temp=archive+'.staging';
  if(!journal.packaging){journal.packaging={stage:temp,final:archive,startedAt:now()};await save();}
  need(journal.packaging.stage===temp&&journal.packaging.final===archive,'PROPERTY_RECEIVING_PACKAGE_CHANGED');
  if(!journal.packaging.identity){
   need(!await exists(archive),'PROPERTY_RECEIVING_PACKAGE_CONFLICT');
   if(await exists(temp))await unlink(temp);
   await runProcess('tar',['-czf',temp,'-C',customer,'.']);
   const h=await open(temp,'r');try{await h.sync();}finally{await h.close();}
   journal.packaging.identity=await identity(temp);await save();
  }
  const packed=journal.packaging.identity;
  if(await exists(archive)){need(same(await identity(archive),packed),'PROPERTY_RECEIVING_PACKAGE_CONFLICT');if(await exists(temp)){need(same(await identity(temp),packed),'PROPERTY_RECEIVING_PACKAGE_CHANGED');await unlink(temp);}}
  else{need(same(await identity(temp),packed),'PROPERTY_RECEIVING_PACKAGE_CHANGED');await rename(temp,archive);await syncParent(archive);}
  journal.package={path:archive,...packed};journal.status='COMPLETE';await save();
 }
 need(same(await identity(archive),{bytes:journal.package.bytes,sha256:journal.package.sha256}),'PROPERTY_RECEIVING_PACKAGE_CHANGED');
 return {status:'COMPLETE',operationId:journal.operationId,package:journal.package,manifest:{path:join(customer,'MANIFEST.json'),...await identity(join(customer,'MANIFEST.json'))},files:files.length};
}
