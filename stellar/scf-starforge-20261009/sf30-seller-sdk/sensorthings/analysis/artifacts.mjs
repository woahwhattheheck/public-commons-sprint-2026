// MIT. Frozen files in the existing workspace's exports directory.
import {open,link,unlink} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {readOwned,privateDirectory,syncDir} from '../../stellar-expert/store.mjs';
import {openPrivateFile,hashHeldFile,inspectRetainedFile} from '../portable.mjs';
import {identity,json,sha,fault} from '../contract.mjs';
const OP=/^[A-Za-z0-9_-]{8,100}$/,HASH=/^[a-f0-9]{64}$/;
export function safeFile(name){
  if(typeof name!=='string'||!name||name!==basename(name)||name.length>200||/[\u0000-\u001f\u007f\\/:]/.test(name)||['.','..'].includes(name))
    throw fault('ANALYSIS_FILE','Choose one displayed flat file name.');
  return name;
}
export function retainedPath(store,file){
  if(!OP.test(file.storage?.operationId??'')||file.storage.filename!==safeFile(file.name)||!HASH.test(file.sha256??'')||
      !Number.isSafeInteger(file.bytes)||file.bytes<0)throw fault('ANALYSIS_FILE','The frozen file manifest is invalid.',409);
  return join(store.root,'exports',file.storage.operationId,file.storage.filename);
}
export async function retainStream(store,iterable,{operationId,createdAt,filename,type='application/octet-stream',inputIdentity,maximum=2*1024*1024*1024}){
  safeFile(filename);if(!OP.test(operationId??''))throw fault('ANALYSIS_OPERATION','Use the original stable operation identity.');
  const directory=await privateDirectory(join(store.root,'exports',operationId),{create:true}),target=join(directory,filename),
    plan={schema:'stellar-forge.sensorthings-analysis-file-plan.v1',operationId,createdAt,filename,type,inputIdentity},
    receiptPath=target+'.receipt.json';
  await store.immutable(target+'.plan.json',json(plan));
  try{
    const receipt=JSON.parse((await readOwned(receiptPath,65536)).toString('utf8'));
    if(receipt.planSha256!==identity(plan)||receipt.file.name!==filename)throw fault('ANALYSIS_FILE','The retained file receipt belongs to another selection.',409);
    await inspectRetainedFile(target,{expectedBytes:receipt.file.bytes,expectedSha256:receipt.file.sha256,maximum});return receipt.file;
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const attemptId=randomUUID(),temporaryName=filename+'.'+attemptId+'.partial',temporary=join(directory,temporaryName);
  await store.immutable(join(directory,filename+'.attempt-'+attemptId+'.json'),json({schema:'stellar-forge.sensorthings-analysis-file-attempt.v1',
    operationId,planSha256:identity(plan),attemptId,temporaryName,state:'STARTED',createdAt:new Date().toISOString()}));
  const output=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600),
    digest=createHash('sha256');let bytes=0;
  try{
    for await(const input of iterable){
      const part=Buffer.isBuffer(input)?input:Buffer.from(input);bytes+=part.length;
      if(bytes>maximum)throw fault('ANALYSIS_FILE_CAPACITY','The complete selected output exceeds its stated file capacity.',413);
      digest.update(part);await output.writeFile(part);
    }
    await output.sync();
  }finally{await output.close();}
  const file={name:filename,type,bytes,sha256:digest.digest('hex'),storage:{operationId,filename}},
    receipt={schema:'stellar-forge.sensorthings-analysis-file-receipt.v1',planSha256:identity(plan),file};
  await store.immutable(join(directory,filename+'.candidate-'+attemptId+'.json'),json({...receipt,temporaryName}));
  try{await link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;}
  await inspectRetainedFile(target,{expectedBytes:bytes,expectedSha256:file.sha256,maximum});await syncDir(directory);
  await store.immutable(receiptPath,json(receipt));
  const temp=await inspectRetainedFile(temporary,{expectedBytes:bytes,expectedSha256:file.sha256,maximum});
  if(temp.sha256===file.sha256){await unlink(temporary);await syncDir(directory);}return file;
}
export function retainBytes(store,bytes,options){return retainStream(store,[bytes],options);}
export async function importEvidence(store,{inboxDirectory,filename,expectedBytes,expectedSha256,operationId,createdAt}){
  if(!inboxDirectory||!HASH.test(expectedSha256??'')||!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>32*1024*1024)
    throw fault('ANALYSIS_EVIDENCE','Select an exact source-inbox file of at most 32 MiB.');
  safeFile(filename);
  const held=await openPrivateFile(join(inboxDirectory,filename),{expectedBytes,maximum:32*1024*1024});
  try{
    await hashHeldFile(held.handle,{expectedBytes,expectedSha256,maximum:32*1024*1024});
    async function* pieces(){
      const buffer=Buffer.alloc(65536);let offset=0;
      while(offset<expectedBytes){const {bytesRead}=await held.handle.read(buffer,0,Math.min(buffer.length,expectedBytes-offset),offset);
        if(!bytesRead)throw fault('ANALYSIS_EVIDENCE','The original evidence ended early.',409);offset+=bytesRead;yield buffer.subarray(0,bytesRead);}
    }
    const ext=filename.split('.').at(-1).toLowerCase(),type=({svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',pdf:'application/pdf',json:'application/json',txt:'text/plain'})[ext]??'application/octet-stream';
    const file=await retainStream(store,pieces(),{operationId,createdAt,filename,type,inputIdentity:{expectedBytes,expectedSha256},maximum:32*1024*1024});
    if(file.sha256!==expectedSha256||file.bytes!==expectedBytes)throw fault('ANALYSIS_EVIDENCE','The original evidence changed while being retained.',409);
    return file;
  }finally{await held.handle.close();}
}
