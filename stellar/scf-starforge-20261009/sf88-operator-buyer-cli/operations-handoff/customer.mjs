// MIT. Customer APIs for the original private Inbox-to-Operations handoff.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';
import {captureInbox,saveHandoff} from './capture.mjs';
import {MAX_BYTES,MAX_JOBS,inspectHandoff,need} from './contract.mjs';

const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
function absolute(path){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&!path.includes('\0'),
    'BUYER_HANDOFF_ABSOLUTE_PATH_REQUIRED');
  return path;
}
function checkSignal(signal){
  need(signal===undefined||signal instanceof AbortSignal,'BUYER_SIGNAL_INVALID');
  need(!signal?.aborted,'BUYER_CAPTURE_ABORTED');
}
async function privateParent(path){
  const parent=dirname(path),stat=await lstat(parent);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(parent)===parent&&
    (process.platform==='win32'||(stat.mode&0o077)===0&&stat.uid===process.getuid()),
    'BUYER_PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
}
function metadata(path,report){
  return {path,bytes:report.source.bytes,sha256:report.source.sha256,
    counts:report.counts,intentIds:report.rows.map(row=>row.intentId),
    canReceive:report.rows.every(row=>row.canReceive),noExecution:true};
}

/** Capture the selected original jobs once and publish only to a new private file. */
export async function exportSelectedInbox({directory,intentIds,destination,maxVerifyBytes=268435456,signal}={}){
  directory=absolute(directory);destination=absolute(destination);checkSignal(signal);
  need(Array.isArray(intentIds)&&intentIds.length>0&&intentIds.length<=MAX_JOBS&&
    new Set(intentIds).size===intentIds.length&&intentIds.every(value=>typeof value==='string'&&
      /^[A-Za-z0-9._:-]{1,128}$/.test(value)),'BUYER_SELECT_ORIGINAL_INTENTS');
  need(Number.isSafeInteger(maxVerifyBytes)&&maxVerifyBytes>=0&&maxVerifyBytes<=1073741824,
    'BUYER_OUTPUT_LIMIT_INVALID');
  await privateParent(destination);
  // A capture records its actual time. Do not silently manufacture another
  // edition after a saved result was lost; inspect that original file instead.
  let exists=false;
  try{await lstat(destination);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  need(!exists,'BUYER_HANDOFF_ALREADY_EXISTS_USE_INSPECT');
  checkSignal(signal);
  const captured=await captureInbox({directory,intentIds:[...intentIds],maxVerifyBytes,signal});
  checkSignal(signal);
  const saved=await saveHandoff(destination,captured.raw);
  need(saved.bytes===captured.report.source.bytes&&saved.sha256===captured.report.source.sha256,
    'BUYER_HANDOFF_SAVED_IDENTITY_MISMATCH');
  return metadata(destination,captured.report);
}

/** Inspect the saved edition without reading current Inbox state or making a new capture. */
export async function inspectSavedHandoff({file,signal}={}){
  file=absolute(file);checkSignal(signal);await privateParent(file);
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  let raw;
  try{
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.size>0n&&before.size<=BigInt(MAX_BYTES)&&
      (process.platform==='win32'||(before.mode&0o077n)===0n&&before.uid===BigInt(process.getuid())),
      'BUYER_ORIGINAL_PRIVATE_SOURCE_REQUIRED');
    const buffer=Buffer.alloc(Number(before.size)+1);let length=0;
    while(length<buffer.length){
      checkSignal(signal);
      const read=await handle.read(buffer,length,buffer.length-length,length);
      if(!read.bytesRead)break;length+=read.bytesRead;
    }
    const after=await handle.stat({bigint:true}),named=await lstat(file,{bigint:true});
    need(length===Number(before.size)&&same(before,after)&&!named.isSymbolicLink()&&
      same(after,named)&&await realpath(file)===file,'BUYER_HANDOFF_CHANGED');
    raw=buffer.subarray(0,length);
  }finally{await handle.close();}
  checkSignal(signal);
  const report=inspectHandoff(raw);
  return {...metadata(file,report),report};
}
