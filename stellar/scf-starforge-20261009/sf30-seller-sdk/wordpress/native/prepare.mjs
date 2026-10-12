// MIT. Freeze one native receiving operation from installed source and host references.
import assert from 'node:assert/strict';
import { readFile, mkdir, realpath, lstat, readdir, open, link, unlink } from 'node:fs/promises';
import { dirname, basename, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const HERE=dirname(fileURLToPath(import.meta.url));
const options={};
for(let i=2;i<process.argv.length;i+=2){
 const name=process.argv[i],value=process.argv[i+1];
 assert(/^--[a-z][a-z-]+$/.test(name)&&value&&!value.startsWith('--')&&!Object.hasOwn(options,name),'Use each option once with a value.');
 options[name]=value;
}
const required=name=>{assert(options[name],name+' is required.');return options[name];};
const allowed=new Set(['--out','--operation','--source','--helper','--work','--results','--python','--chromium','--playwright',
 '--buyer-workspace','--merchant','--route','--seller-runtime','--php','--wordpress-core','--sqlite']);
assert(Object.keys(options).every(name=>allowed.has(name)),'Unknown native selector option.');
async function original(name,kind){
 const value=required(name);assert(isAbsolute(value)&&resolve(value)===value,name+' must be canonical absolute.');
 const path=await realpath(value),info=await lstat(path);assert(kind==='directory'?info.isDirectory():info.isFile(),name+' has the wrong type.');
 return path;
}
async function destination(name){
 const path=resolve(required(name));assert(isAbsolute(required(name))&&path===required(name)&&path!=='/',name+' must be normalized absolute.');
 await mkdir(dirname(path),{recursive:true,mode:0o700});assert.equal(await realpath(dirname(path)),dirname(path));return path;
}
const sourceRoot=await original('--source','directory'),nativeHelper=await original('--helper','file');
assert.equal(basename(sourceRoot),'source','Use the original installed release/source layout.');
const wordpressSource=join(sourceRoot,'stellar/scf-starforge-20261009/sf30-seller-sdk/wordpress');
const selected=JSON.parse(await readFile(join(HERE,'component-source.json'),'utf8'));
assert.equal(selected.schema,'stellar-forge.wordpress-native-source.v1');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
for(const [name,expected] of Object.entries(selected.files)){
 const bytes=await readFile(join(wordpressSource,name));assert.equal(blob(bytes),expected,'Selected published WordPress source differs: '+name);
}
const merchantPath=await original('--merchant','file'),merchantRaw=await readFile(merchantPath),input=JSON.parse(merchantRaw);
let merchant;
if(input.schema==='stellar-forge.seller-service.v1'){
 const candidates=input.routes.filter(row=>!options['--route']||row.id===options['--route']);
 assert.equal(candidates.length,1,'Select exactly one original seller route with --route.');
 merchant={origin:input.publicOrigin,path:candidates[0].path,payment:candidates[0].definition?.payment};
}else{
 assert(typeof input.origin==='string'&&typeof input.path==='string'&&input.payment,'Select original saved merchant terms or a native seller configuration.');
 merchant={origin:input.origin,path:input.path,payment:input.payment};
}
assert.equal(merchant.payment?.network,'stellar:testnet','This native journey uses the selected testnet merchant.');
assert(/^[1-9]\d*$/.test(merchant.payment.amount),'Retain the exact positive atomic payment amount.');
let sellerRuntime={};
if(options['--seller-runtime']){
 sellerRuntime=JSON.parse(await readFile(await original('--seller-runtime','file'),'utf8'));
 assert(Object.keys(sellerRuntime).every(key=>['port','facilitator','allowLocalFacilitator'].includes(key)),'Use the original release runtime fields.');
}
const config={
 schema:'stellar-forge.wordpress-native-journey.v1',operationId:required('--operation'),sourceRef:selected.sourceRef,
 sourceRoot,sourceFiles:selected.files,nativeHelper,workDirectory:await destination('--work'),resultDirectory:await destination('--results'),
 python:await original('--python','file'),chromium:await original('--chromium','file'),
 playwrightModule:await original('--playwright','file'),buyerWorkspace:await original('--buyer-workspace','directory'),
 merchant,sellerRuntime,sourceInputs:{merchant:{path:merchantPath,bytes:merchantRaw.length,sha256:sha(merchantRaw)}},
 nativeEnvironment:{
  TJL_NATIVE_PHP_BIN:await original('--php','file'),
  TJL_NATIVE_WORDPRESS_SOURCE:await original('--wordpress-core','directory'),
  TJL_NATIVE_SQLITE_SOURCE:await original('--sqlite','directory'),
  TJL_WORKSPACE_PYTHON:await original('--python','file'),
 },
};
assert(/^[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(config.operationId),'Select the retained native operation identity.');
assert(config.workDirectory!==sourceRoot&&!config.workDirectory.startsWith(sourceRoot+'/')&&!sourceRoot.startsWith(config.workDirectory+'/'),'Keep mutable native work separate from selected source.');
assert(config.workDirectory!==config.buyerWorkspace&&!config.buyerWorkspace.startsWith(config.workDirectory+'/')&&!config.workDirectory.startsWith(config.buyerWorkspace+'/'),'Preserve the original external buyer workspace.');
let existingWork=null;
try{existingWork=await lstat(config.workDirectory);}catch(error){if(error.code!=='ENOENT')throw error;}
if(existingWork){
 assert(existingWork.isDirectory()&&!existingWork.isSymbolicLink(),'Use a private native work directory.');
 if((await readdir(config.workDirectory)).length){
  const previous=JSON.parse(await readFile(join(config.workDirectory,'journey-checkpoint.json'),'utf8'));
  assert.equal(previous.operationId,config.operationId,'The work directory belongs to another original operation.');
  assert.equal(previous.sourceRef,config.sourceRef,'The retained component selection differs.');
 }
}
for(const original of [sourceRoot,config.buyerWorkspace])
 assert(config.resultDirectory!==original&&!config.resultDirectory.startsWith(original+'/')&&!original.startsWith(config.resultDirectory+'/'),'Keep native results separate from original source and buyer state.');
const out=await destination('--out'),bytes=Buffer.from(JSON.stringify(config,null,2)+'\n');
try{
 const current=await readFile(out);assert(current.equals(bytes),'The original selected invocation differs; reconcile its existing operation.'); 
}catch(error){
 if(error.code!=='ENOENT')throw error;
 const temporary=out+'.pending-'+randomUUID(),file=await open(temporary,'wx',0o600);
 try{
  await file.writeFile(bytes);await file.sync();await file.close();
  try{await link(temporary,out);}
  catch(error){if(error.code!=='EEXIST'||!(await readFile(out)).equals(bytes))throw error;}
 }finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 const parent=await open(dirname(out),'r');try{await parent.sync();}finally{await parent.close();}
}
console.log(JSON.stringify({schema:config.schema,operationId:config.operationId,sourceRef:config.sourceRef,
 selector:out,bytes:bytes.length,sha256:sha(bytes),entrypoint:join(HERE,'journey.mjs'),sourceFiles:Object.keys(config.sourceFiles).length}));
