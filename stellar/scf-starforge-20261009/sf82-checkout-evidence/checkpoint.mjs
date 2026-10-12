// MIT. Atomic private records for the original SF82 checkout and its recovery.
import {constants} from 'node:fs';
import {open,lstat,link,unlink,readdir} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const CHECKOUT_RECORD_LIMIT=262144;
const tag=/^[A-Za-z0-9._:-]{1,128}$/;
const fail=(ok,code)=>{if(!ok)throw new TypeError(code);};
const digest=raw=>createHash('sha256').update(raw).digest('hex');
export function checkoutPaths(outputDir,intentId) {
 fail(typeof outputDir==='string'&&isAbsolute(outputDir)&&!outputDir.includes('\0'),'ABSOLUTE_PRIVATE_EVIDENCE_DIRECTORY_REQUIRED');
 fail(typeof intentId==='string'&&tag.test(intentId),'TRUSTED_BUYER_AND_STABLE_INTENT_REQUIRED');
 const base=join(outputDir,digest(intentId));
 return {evidencePath:base+'.json',checkpointPath:base+'.checkpoint.json',bodyPath:base+'.body-checkpoint.json'};
}
async function privateDirectory(directory) {
 const info=await lstat(directory);
 fail(info.isDirectory()&&!info.isSymbolicLink(),'EVIDENCE_PATH_NOT_DIRECTORY');
}
export async function readCheckoutRecord(file,{optional=false}={}) {
 await privateDirectory(dirname(file));
 let handle;
 try {handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));}
 catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 try {
  const info=await handle.stat();
  fail(info.isFile()&&info.size<=CHECKOUT_RECORD_LIMIT,'CHECKOUT_RECORD_INVALID_OR_TOO_LARGE');
  const bytes=await handle.readFile();
  fail(bytes.length<=CHECKOUT_RECORD_LIMIT,'CHECKOUT_RECORD_INVALID_OR_TOO_LARGE');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return {value,bytes:bytes.length,sha256:digest(bytes),path:file};
 } finally {await handle.close();}
}
export async function createCheckoutRecord(file,value) {
 await privateDirectory(dirname(file));
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 fail(bytes.length<=CHECKOUT_RECORD_LIMIT,'CHECKOUT_RECORD_INVALID_OR_TOO_LARGE');
 const temporary=join(dirname(file),'.checkout-'+randomUUID()+'.tmp');
 const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
 try {
  try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
  // Link publishes complete bytes with create-only semantics. A failed write
  // leaves no empty terminal record, and a concurrent winner is never replaced.
  await link(temporary,file);
  const directory=await open(dirname(file),'r');
  try {await directory.sync();} finally {await directory.close();}
  return {value,bytes:bytes.length,sha256:digest(bytes),path:file};
 } finally {
  await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
}


/** Complete a publication interrupted between hard-link publication and removal
 * of this writer's temporary name. The published bytes are never replaced. */
export async function finishCheckoutRecordPublication(file) {
 await privateDirectory(dirname(file));
 let target;
 try {target=await lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}
 fail(target.isFile()&&!target.isSymbolicLink(),'CHECKOUT_RECORD_INVALID_OR_TOO_LARGE');
 if(target.nlink<=1)return;
 let removed=false;
 for(const name of await readdir(dirname(file))) {
  if(!/^\.checkout-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tmp$/.test(name))continue;
  const candidate=join(dirname(file),name);
  let info;
  try {info=await lstat(candidate);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(!info.isFile()||info.isSymbolicLink()||info.dev!==target.dev||info.ino!==target.ino)continue;
  const current=await lstat(file);
  fail(current.dev===target.dev&&current.ino===target.ino,'CHECKOUT_PUBLISHED_FILE_CHANGED');
  try {await unlink(candidate);removed=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(removed) {
  const parent=await open(dirname(file),'r');
  try {await parent.sync();}finally{await parent.close();}
 }
}
