#!/usr/bin/env node
'use strict';

/* MIT. Receive complete ordinary source ZIPs with the maintained ZIP reader.
 * This module does not execute archive members or replace a source build engine.
 */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {constants}=require('node:fs');
const zip=require('./connected_zip.cjs');
const SCHEMA='commons.zip-source-receiving.v1';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'ZIP_SOURCE_RECEIVING_REQUIRED'});};
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function limits(input={}){
 const out={maxBytes:input.maxBytes??128*1024*1024,maxEntries:input.maxEntries??2000,
  maxUncompressedBytes:input.maxUncompressedBytes??128*1024*1024};
 for(const [key,value]of Object.entries(out))need(Number.isSafeInteger(value)&&value>=(key==='maxBytes'?22:0)&&
  value<=(key==='maxEntries'?1000000:0x7fffffff),'Invalid '+key);
 return out;
}
function portablePath(value){
 for(const part of value.split('/'))need(!/[<>:"|?*]/.test(part)&&!/[ .]$/.test(part)&&
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),'ZIP path cannot be received portably: '+value);
 return value;
}
function describeArchive(bytes,selected={}){
 const options=limits(selected),archive=zip.readZipArchive(bytes,options),digest=sha(bytes);
 const entries=archive.entries.map(entry=>{
  const {data,nameBytes,extraBytes,localExtraBytes,commentBytes,...metadata}=entry;
  portablePath(entry.path);
  return {...metadata,sha256:sha(data),nameBase64:zip.base64(nameBytes),extraBase64:zip.base64(extraBytes),
   localExtraBase64:zip.base64(localExtraBytes),commentBase64:zip.base64(commentBytes)};
 });
 const {data,commentBytes,...metadata}=archive.archive;
 return {schema:SCHEMA,archive:{...metadata,sha256:digest,filename:'archive.zip',commentBase64:zip.base64(commentBytes)},
  limits:options,memberRoot:'members',entries};
}
function receiptText(receipt){return JSON.stringify(receipt,null,2)+'\n';}
function expectedDigest(value){need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Supply the independently retained archive SHA-256');return value;}
function nativeFilesystem(){need(process.platform==='linux'&&constants.O_NOFOLLOW>0&&constants.O_DIRECTORY>0,'Native ZIP receiving requires the existing Linux Node filesystem owner');}
async function readOriginal(filename,maxBytes){
 nativeFilesystem();
 const handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await handle.stat();need(before.isFile()&&before.size<=maxBytes,'Select an ordinary file within its byte limit');
  const bytes=Buffer.alloc(before.size);let position=0;
  while(position<bytes.length){const result=await handle.read(bytes,position,Math.min(65536,bytes.length-position),position);need(result.bytesRead>0,'Original file truncated while reading');position+=result.bytesRead;}
  const extra=Buffer.alloc(1),tail=await handle.read(extra,0,1,position),after=await handle.stat();
  need(tail.bytesRead===0&&bytes.length===before.size&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
   before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'Original file changed while reading');
  return bytes;
 }finally{await handle.close();}
}
async function exists(filename){try{return await fs.lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(directory,create=false){
 nativeFilesystem();
 let made=false;if(create)try{await fs.mkdir(directory,{mode:0o700});made=true;}catch(error){if(error.code!=='EEXIST')throw error;}
 const stat=await fs.lstat(directory);
 need(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o700&&
  (typeof process.getuid!=='function'||stat.uid===process.getuid()),'Use an owned private receiving directory: '+directory);
 if(made)await syncDirectory(path.dirname(directory));
}
async function syncDirectory(directory){const handle=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await handle.sync();}finally{await handle.close();}}
async function exactFile(filename,bytes){
 const retained=await readOriginal(filename,bytes.length);
 need(retained.length===bytes.length&&sha(retained)===sha(bytes),'Existing received file differs; original preserved: '+filename);
}
async function publishFile(directory,filename,bytes,mode=0o600,temporaryDirectory=directory){
 const target=path.join(directory,filename),prior=await exists(target);
 if(prior){need(prior.isFile()&&!prior.isSymbolicLink(),'Received path is not an ordinary file');await exactFile(target,bytes);return;}
 const temporary=path.join(temporaryDirectory,'.zip-receive-'+crypto.randomUUID()+'.part');
 let handle;
 try{
  handle=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode);
  await handle.writeFile(bytes);await handle.chmod(mode);await handle.sync();await handle.close();handle=null;
  try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;await exactFile(target,bytes);}
  await syncDirectory(directory);
 }finally{
  if(handle)await handle.close();
  try{await fs.unlink(temporary);await syncDirectory(temporaryDirectory);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
async function ensureMemberParents(root,name){
 const parts=name.split('/');parts.pop();let current=root;
 for(const part of parts){current=path.join(current,part);await privateDirectory(current,true);}
 return current;
}
async function validateTree(root,receipt){
 const expected=new Map(),directories=new Set(['']);
 for(const item of receipt.entries){
  const parts=item.path.split('/');for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));
  if(item.kind==='directory')directories.add(item.path);else expected.set(item.path,item);
 }
 const seen=new Set();
 async function walk(directory,prefix){
  await privateDirectory(directory);
  for(const name of await fs.readdir(directory)){
   const relative=prefix?prefix+'/'+name:name,filename=path.join(directory,name),stat=await fs.lstat(filename);
   need(!stat.isSymbolicLink(),'Received tree contains a symbolic link');
   if(stat.isDirectory()){need(directories.has(relative),'Received tree contains an unlisted directory');await walk(filename,relative);}
   else{
    const item=expected.get(relative);need(item&&stat.isFile(),'Received tree contains an unlisted file');
    need(Boolean(stat.mode&0o111)===Boolean(item.mode&0o111),'Received executable mode differs: '+relative);
    const bytes=await readOriginal(filename,item.bytes);need(bytes.length===item.bytes&&sha(bytes)===item.sha256,'Received member differs: '+relative);seen.add(relative);
   }
  }
 }
 await walk(root,'');
 for(const [name]of expected)need(seen.has(name),'Received member is absent: '+name);
 // Explicit empty directories are part of the original archive too.
 for(const name of directories)await privateDirectory(path.join(root,name));
}

async function reconcileTemporaries(root,receipt,intent){
 const permitted=[{filename:path.join(root,'archive.zip'),bytes:receipt.archive.bytes,sha256:receipt.archive.sha256},
  {filename:path.join(root,'intent.json'),bytes:intent.length,sha256:sha(intent)},
  {filename:path.join(root,'RECEIVING.json'),bytes:Buffer.byteLength(receiptText(receipt)),sha256:sha(Buffer.from(receiptText(receipt)))},
  ...receipt.entries.filter(x=>x.kind==='file').map(x=>({filename:path.join(root,'members',x.path),bytes:x.bytes,sha256:x.sha256}))];
 const targets=new Map();
 for(const target of permitted){const stat=await exists(target.filename);if(stat?.isFile()&&!stat.isSymbolicLink())targets.set(stat.dev+':'+stat.ino,target);}
 for(const directory of [root,path.join(root,'.incoming')]){
  if(!await exists(directory))continue;await privateDirectory(directory);
  for(const name of await fs.readdir(directory)){
   if(!/^\.zip-receive-[a-f0-9-]{36}\.part$/.test(name))continue;
   const filename=path.join(directory,name),stat=await exists(filename);if(!stat)continue;
   need(stat.isFile()&&!stat.isSymbolicLink()&&(typeof process.getuid!=='function'||stat.uid===process.getuid()),'Receiving temporary has changed kind or owner');
   if(stat.nlink===1)continue; // Incomplete, unlinked work is preserved, never guessed away.
   const target=targets.get(stat.dev+':'+stat.ino);
   need(stat.nlink===2&&target,'Receiving temporary links outside its original allowed target');
   let bytes;try{bytes=await readOriginal(filename,target.bytes);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   need(bytes.length===target.bytes&&sha(bytes)===target.sha256,'Linked receiving temporary differs from its original target');
   try{await fs.unlink(filename);await syncDirectory(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
 }
}

async function verifyZipReceiving({directory,expectedSha256}={}){
 const root=path.resolve(directory??'');need(directory,'Supply the original receiving directory');
 await privateDirectory(root);
 const manifestBytes=await readOriginal(path.join(root,'RECEIVING.json'),64*1024*1024);
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 need(manifest.schema===SCHEMA,'Select an original complete ZIP receiving receipt');
 const selected=limits(manifest.limits),archive=await readOriginal(path.join(root,'archive.zip'),selected.maxBytes);
 const digest=expectedDigest(expectedSha256??manifest.archive?.sha256);
 need(sha(archive)===digest,'Retained original ZIP SHA-256 differs');
 const rebuilt=describeArchive(archive,selected);
 need(receiptText(rebuilt)===manifestBytes.toString('utf8'),'Retained receipt differs from its complete original archive');
 const intent=Buffer.from(JSON.stringify({schema:SCHEMA,archiveSha256:digest,archiveBytes:archive.length,limits:selected})+'\n');
 await exactFile(path.join(root,'intent.json'),intent);
 await reconcileTemporaries(root,rebuilt,intent);
 await validateTree(path.join(root,'members'),rebuilt);
 for(const name of await fs.readdir(root)){
  if(['archive.zip','intent.json','RECEIVING.json','members'].includes(name))continue;
  if(name==='.incoming'){await privateDirectory(path.join(root,name));for(const temporary of await fs.readdir(path.join(root,name))){
   const st=await fs.lstat(path.join(root,name,temporary));need(/^\.zip-receive-[a-f0-9-]{36}\.part$/.test(temporary)&&st.isFile()&&!st.isSymbolicLink()&&st.nlink===1,'Unrecognized retained receiving temporary');}continue;}
  const stat=await fs.lstat(path.join(root,name));
  need(/^\.zip-receive-[a-f0-9-]{36}\.part$/.test(name)&&stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,
   'Receiving root contains an unlisted item');
 }
 return {schema:SCHEMA,state:'VERIFIED',directory:root,archiveSha256:digest,archiveBytes:archive.length,
  entries:rebuilt.entries.length,files:rebuilt.entries.filter(x=>x.kind==='file').length,
  uncompressedBytes:rebuilt.archive.uncompressedBytes,receipt:path.join(root,'RECEIVING.json'),members:path.join(root,'members')};
}
async function receiveZipArchive({archive:filename,directory,expectedSha256,...selected}={}){
 need(typeof filename==='string'&&filename&&typeof directory==='string'&&directory,'Supply archive and receiving directory paths');
 const options=limits(selected),digest=expectedDigest(expectedSha256),bytes=await readOriginal(filename,options.maxBytes);
 need(sha(bytes)===digest,'Original ZIP differs from the independently retained SHA-256');
 const receipt=describeArchive(bytes,options),parsed=zip.readZipArchive(bytes,options),root=path.resolve(directory);
 const prior=await exists(root);let created=false;
 if(!prior){try{await fs.mkdir(root,{mode:0o700});created=true;await syncDirectory(path.dirname(root));}catch(error){if(error.code!=='EEXIST')throw error;}}
 await privateDirectory(root);
 const intent=Buffer.from(JSON.stringify({schema:SCHEMA,archiveSha256:digest,archiveBytes:bytes.length,limits:options})+'\n');
 if(!created&&!await exists(path.join(root,'intent.json'))){
  // Only an explicitly selected empty private directory, or exact original
  // exact intent prefixes left by a partial write, can finish first publication.
  for(const name of await fs.readdir(root)){
   need(/^\.zip-receive-[a-f0-9-]{36}\.part$/.test(name),'Existing destination has no original receiving intent');
   const st=await fs.lstat(path.join(root,name));need(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1,'Invalid original intent temporary');
   const residue=await readOriginal(path.join(root,name),intent.length);
   need(intent.subarray(0,residue.length).equals(residue),'Retained partial intent differs from the selected original receiving operation');
  }
 }
 await publishFile(root,'intent.json',intent);
 // Same-source concurrent callers publish identical immutable files. Exclusive
 // hard links never replace another file; the final receipt is written last.
 if(await exists(path.join(root,'RECEIVING.json')))return verifyZipReceiving({directory:root,expectedSha256:digest});
 await publishFile(root,'archive.zip',bytes);
 const members=path.join(root,'members'),incoming=path.join(root,'.incoming');await privateDirectory(members,true);await privateDirectory(incoming,true);
 for(const entry of parsed.entries){
  const parent=await ensureMemberParents(members,entry.path),name=path.basename(entry.path);
  if(entry.kind==='directory')await privateDirectory(path.join(parent,name),true);
  else await publishFile(parent,name,entry.data,(entry.mode&0o111)?0o700:0o600,incoming);
 }
 await validateTree(members,receipt);
 await publishFile(root,'RECEIVING.json',Buffer.from(receiptText(receipt)));
 await syncDirectory(root);
 return verifyZipReceiving({directory:root,expectedSha256:digest});
}
async function main(argv){
 const command=argv.shift(),args={};
 need(['inspect','receive','verify'].includes(command),'Use inspect, receive or verify');
 for(let at=0;at<argv.length;at+=2){
  const key=argv[at],value=argv[at+1];
  need(['--archive','--directory','--sha256','--max-bytes','--max-entries','--max-uncompressed-bytes'].includes(key)&&value!==undefined&&!has(args,key),'Unknown, duplicate or missing CLI option');
  args[key]=value;
 }
 const options={};
 for(const [flag,key]of [['--max-bytes','maxBytes'],['--max-entries','maxEntries'],['--max-uncompressed-bytes','maxUncompressedBytes']]){
  if(has(args,flag)){need(/^\d+$/.test(args[flag]),'Use complete decimal limits');options[key]=Number(args[flag]);}
 }
 let result;
 if(command==='inspect'){
  need(args['--archive'],'Supply --archive');const bytes=await readOriginal(args['--archive'],limits(options).maxBytes);
  if(args['--sha256'])need(sha(bytes)===expectedDigest(args['--sha256']),'Original ZIP SHA-256 differs');
  result=describeArchive(bytes,options);
 }else if(command==='receive'){
  result=await receiveZipArchive({archive:args['--archive'],directory:args['--directory'],expectedSha256:args['--sha256'],...options});
 }else{
  need(!args['--archive']&&Object.keys(options).length===0,'verify uses the retained archive and original limits');
  result=await verifyZipReceiving({directory:args['--directory'],expectedSha256:args['--sha256']});
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
module.exports={describeArchive,receiveZipArchive,verifyZipReceiving,main,
 receivingIO:Object.freeze({readOriginal,privateDirectory,syncDirectory,publishFile})};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{
 process.stderr.write(JSON.stringify({code:error.code??'ZIP_SOURCE_RECEIVING_FAILED',message:String(error.message??error)})+'\n');process.exitCode=1;
});
