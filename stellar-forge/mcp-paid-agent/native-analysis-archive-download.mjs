#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Recoverable transport for an original completed Analysis workspace archive.
// Archive validation and workspace publication remain the original Python receiver.
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,readdir,rename,link,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const DOWNLOAD='stellar-forge.analysis-workspace-download.v1';
const JOURNAL='stellar-forge.analysis-workspace-download-journal.v1';
const NATIVE='stellar-forge.mcp-native-analysis.v1';
const EXPORT='stellar-forge.analysis-workspace-export.v1';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/,NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FILES=['archive-manifest.json','workspace.zip'],MAX_RECORD=1024*1024,MAX_CHUNK=65536;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const failure=code=>Object.assign(new Error(code),{code:'MCP_ANALYSIS_ARCHIVE_DOWNLOAD_'+code});
const requireThat=(value,code)=>{if(!value)throw failure(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const now=()=>new Date().toISOString();
const validHash=value=>typeof value==='string'&&HASH.test(value);
function identity(analysisWorkspace,id){
  requireThat(typeof analysisWorkspace==='string'&&NAME.test(analysisWorkspace)&&
    typeof id==='string'&&ID.test(id),'SOURCE_ID_REQUIRED');
}
function verifySource(source){
  requireThat(object(source),'SOURCE_CHANGED');identity(source.analysisWorkspace,source.archiveId);
  requireThat(ID.test(source.workspaceId??'')&&validHash(source.manifestSha256)&&
    Array.isArray(source.files)&&source.files.length===2&&
    new Set(source.files.map(file=>file?.name)).size===2,'SOURCE_CHANGED');
  for(const filename of FILES){
    const file=source.files.find(value=>value?.name===filename);
    requireThat(object(file)&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&validHash(file.sha256)&&
      file.mime===(filename==='workspace.zip'?'application/zip':'application/json'),'SOURCE_CHANGED');
  }
  requireThat(source.files.find(file=>file.name==='archive-manifest.json').sha256===source.manifestSha256,
    'SOURCE_CHANGED');
  return source;
}
function selectedHashes(source,expectedSha256,expectedManifestSha256){
  requireThat(validHash(expectedSha256)&&validHash(expectedManifestSha256),'REVIEWED_DIGESTS_REQUIRED');
  requireThat(source.manifestSha256===expectedManifestSha256&&
    source.files.find(file=>file.name==='workspace.zip').sha256===expectedSha256,'SOURCE_CHANGED');
}
const own=info=>(process.platform==='win32'||!(info.mode&0o077))&&
  (typeof process.getuid!=='function'||info.uid===process.getuid());
async function syncDirectory(path){
  const handle=await open(path,constants.O_RDONLY);
  try{await handle.sync();}finally{await handle.close();}
}
async function privateDirectory(path,create=false){
  if(create){
    try{await mkdir(path,{mode:0o700});await syncDirectory(dirname(path));}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const info=await lstat(path);
  requireThat(info.isDirectory()&&!info.isSymbolicLink()&&own(info)&&await realpath(path)===path,
    'PRIVATE_DIRECTORY_REQUIRED');
}
async function regular(path,flags=constants.O_RDONLY,maximum=Number.MAX_SAFE_INTEGER){
  const handle=await open(path,flags|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0),0o600);
  try{
    const info=await handle.stat();
    requireThat(info.isFile()&&own(info)&&Number.isSafeInteger(info.size)&&info.size<=maximum,
      'PRIVATE_FILE_REQUIRED');
    return {handle,info};
  }catch(error){await handle.close();throw error;}
}
async function readJson(path){
  const {handle}=await regular(path,constants.O_RDONLY,MAX_RECORD);
  try{
    const raw=await handle.readFile();requireThat(raw.length<=MAX_RECORD,'JOURNAL_INVALID');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    requireThat(object(value),'JOURNAL_INVALID');return value;
  }catch(error){if(error instanceof SyntaxError||error instanceof TypeError)throw failure('JOURNAL_INVALID');throw error;}
  finally{await handle.close();}
}
async function removeOwned(path){
  let opened;try{opened=await regular(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
  await opened.handle.close();await unlink(path);
}
async function atomicRecord(context,name,value){
  context.lease.assertHeld();
  const destination=join(context.control,name),temporary=destination+'.next';
  await removeOwned(temporary);
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(json(value));await handle.sync();}finally{await handle.close();}
  context.lease.assertHeld();await rename(temporary,destination);await syncDirectory(context.control);
}
async function checkpoint(context){await atomicRecord(context,'operation.json',context.state);}
async function prefixHash(handle,length){
  const sha=createHash('sha256'),buffer=Buffer.alloc(MAX_CHUNK);let offset=0;
  while(offset<length){
    const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,length-offset),offset);
    requireThat(bytesRead>0,'FILE_CHANGED');sha.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
  }
  return sha;
}
function stamp(info){return [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');}
async function verifyFile(path,file){
  const {handle,info}=await regular(path,constants.O_RDONLY,file.bytes);
  try{
    const before=await handle.stat({bigint:true});
    requireThat(info.size===file.bytes&&(await prefixHash(handle,file.bytes)).digest('hex')===file.sha256&&
      stamp(before)===stamp(await handle.stat({bigint:true})),'FILE_CHANGED');
    await handle.sync();
  }finally{await handle.close();}
}
async function locked(directory,create,operation){
  requireThat(typeof directory==='string'&&directory.length>0&&!directory.includes('\0')&&resolve(directory)!=='/',
    'DIRECTORY_REQUIRED');
  const root=resolve(directory);await privateDirectory(root,create);
  const rootNames=new Set(['download-state','download-receipt.json',...FILES]);
  requireThat((await readdir(root)).every(name=>rootNames.has(name)),'DIRECTORY_IN_USE');
  const control=join(root,'download-state');
  if(create){
    const names=await readdir(root);
    requireThat(names.length===0||names.includes('download-state'),'DIRECTORY_IN_USE');
  }
  await privateDirectory(control,create);
  let lease;
  try{lease=await acquireStateLease(control);}
  catch(error){
    throw failure(error.message==='FLEET_STATE_ALREADY_OWNED'?'BUSY':
      error.message==='FLEET_LINUX_FLOCK_REQUIRED'?'LINUX_FLOCK_REQUIRED':'LEASE_UNAVAILABLE');
  }
  try{
    const allowed=new Set(['lease.lock','operation.json','operation.json.next','download-receipt.json.next',
      ...FILES.map(name=>name+'.part')]);
    requireThat((await readdir(control)).every(name=>allowed.has(name)),'DIRECTORY_IN_USE');
    return await operation({root,control,lease});
  }finally{await lease.close();}
}
async function loadState(context,source){
  let state;
  try{state=await readJson(join(context.control,'operation.json'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(!state){
    requireThat(source&&
      (await readdir(context.root)).every(name=>name==='download-state')&&
      (await readdir(context.control)).every(name=>['lease.lock','operation.json.next'].includes(name)),
      'ORIGINAL_JOURNAL_REQUIRED');
    state={schema:JOURNAL,source,phase:'DOWNLOADING',createdAt:now(),files:{}};
  }else{
    requireThat(state.schema===JOURNAL&&['DOWNLOADING','PUBLISHING','COMPLETE'].includes(state.phase)&&
      object(state.files)&&Object.keys(state.files).every(name=>FILES.includes(name)),'JOURNAL_INVALID');
    verifySource(state.source);
    if(source)requireThat(JSON.stringify(state.source)===JSON.stringify(source),'SOURCE_CHANGED');
    for(const value of Object.values(state.files))
      requireThat(object(value)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&validHash(value.sha256)&&
        typeof value.complete==='boolean','JOURNAL_INVALID');
  }
  context.state=state;await checkpoint(context);return state;
}
function unpack(value,alias,operation){
  requireThat(object(value)&&value.schema===NATIVE&&value.analysisWorkspace===alias&&value.operation===operation&&
    object(value.result),'NATIVE_RESPONSE_CHANGED');
  return value.result;
}

/** Reuse the original authenticated MCP JSON-RPC transport. */
export async function openNativeAnalysisArchiveClient({url,analysisWorkspace,tokenEnv,environment,signal}={}){
  identity(analysisWorkspace,'0'.repeat(32));
  const client=await openMerchantFileClient({url,tokenEnv,environment,signal,
    errorPrefix:'MCP_ANALYSIS_ARCHIVE',clientName:'starforge-analysis-archive'});
  return {endpoint:client.endpoint,analysisWorkspace,async call(operation,body,options){
    return unpack(await client.call('sf43_discover_review_and_pay',{action:'analysis',
      analysisWorkspace,analysisOperation:operation,analysisRequest:body},options),analysisWorkspace,operation);
  }};
}
async function connection(options){
  if(options.client){
    requireThat(typeof options.client.call==='function'&&options.client.analysisWorkspace===options.analysisWorkspace,
      'CLIENT_REQUIRED');
    return options.client;
  }
  return openNativeAnalysisArchiveClient(options);
}
async function completed(client,analysisWorkspace,id){
  identity(analysisWorkspace,id);
  const job=await client.call('job',{id});
  requireThat(job.id===id&&job.kind==='workspace-export'&&job.status==='COMPLETE'&&
    job.result?.schema===EXPORT&&job.result.id===id&&ID.test(job.result.workspace_id??''),'COMPLETE_ARCHIVE_REQUIRED');
  const result=job.result;
  requireThat(Array.isArray(result.files)&&result.files.length===2,'SOURCE_CHANGED');
  const source={analysisWorkspace,archiveId:id,workspaceId:result.workspace_id,
    manifestSha256:result.files?.find(file=>file?.name==='archive-manifest.json')?.sha256,
    files:FILES.map(name=>result.files?.find(file=>file?.name===name))};
  return verifySource(source);
}
export async function inspectNativeAnalysisArchive(options={}){
  const client=await connection(options);
  return completed(client,options.analysisWorkspace,options.id);
}
function chunk(value,source,file,offset,limit){
  const size=Math.min(limit,file.bytes-offset),part=value?.file;
  requireThat(value?.id===source.archiveId&&value.workspaceId===source.workspaceId&&
    value.manifestSha256===source.manifestSha256&&value.filename===file.name&&object(part)&&
    part.verifiedSavedFile===true&&part.bytes===file.bytes&&part.sha256===file.sha256&&
    part.contentType===file.mime&&part.byteOffset===offset&&part.returnedBytes===size&&
    part.encoding==='base64'&&part.nextByteOffset===(offset+size<file.bytes?offset+size:null)&&
    typeof part.data==='string','CHUNK_CHANGED');
  const bytes=Buffer.from(part.data,'base64');
  requireThat(bytes.length===size&&bytes.toString('base64')===part.data,'CHUNK_INVALID');
  return bytes;
}
async function persistFile(context,client,file,{chunkSize,signal,onProgress}){
  const source=context.state.source,destination=join(context.root,file.name),partial=join(context.control,file.name+'.part');
  try{
    await verifyFile(destination,file);
    context.state.files[file.name]={bytes:file.bytes,sha256:file.sha256,complete:true};
    await checkpoint(context);await removeOwned(partial);await syncDirectory(context.control);return;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const saved=context.state.files[file.name]??{bytes:0,sha256:hash(Buffer.alloc(0)),complete:false};
  requireThat(!saved.complete&&saved.bytes<=file.bytes,'FILE_CHANGED');
  let opened;
  try{opened=await regular(partial,constants.O_RDWR,file.bytes);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    requireThat(saved.bytes===0,'FILE_CHANGED');
    const handle=await open(partial,'wx+',0o600);opened={handle,info:await handle.stat()};
  }
  const {handle,info}=opened;let offset=saved.bytes;
  try{
    const sha=await prefixHash(handle,offset);
    requireThat(info.size>=offset&&sha.copy().digest('hex')===saved.sha256,'FILE_CHANGED');
    // Release only this operation's uncheckpointed suffix after interruption.
    await handle.truncate(offset);
    while(offset<file.bytes){
      signal?.throwIfAborted();context.lease.assertHeld();
      const value=await client.call('workspace-archive-file',{id:source.archiveId,filename:file.name,
        manifest_sha256:source.manifestSha256,sha256:file.sha256,byteOffset:offset,maxBytes:chunkSize});
      const bytes=chunk(value,source,file,offset,chunkSize);
      let written=0;
      while(written<bytes.length){
        const next=await handle.write(bytes,written,bytes.length-written,offset+written);
        requireThat(next.bytesWritten>0,'WRITE_FAILED');written+=next.bytesWritten;
      }
      sha.update(bytes);offset+=bytes.length;await handle.sync();
      context.state.files[file.name]={bytes:offset,sha256:sha.copy().digest('hex'),complete:false};
      await checkpoint(context);
      await onProgress?.({id:source.archiveId,workspaceId:source.workspaceId,file:file.name,bytes:offset,total:file.bytes});
    }
    requireThat(sha.digest('hex')===file.sha256,'FILE_CHANGED');context.lease.assertHeld();
    try{await link(partial,destination);}
    catch(error){if(error.code!=='EEXIST')throw error;await verifyFile(destination,file);}
    await syncDirectory(context.root);
    await unlink(partial);await syncDirectory(context.control);
    context.state.files[file.name]={bytes:file.bytes,sha256:file.sha256,complete:true};
    await checkpoint(context);
  }finally{await handle.close();}
}
async function publishReceipt(context){
  const state=context.state,source=state.source;
  if(state.phase==='DOWNLOADING'){
    const archive=source.files.find(file=>file.name==='workspace.zip');
    state.receipt={schema:DOWNLOAD,state:'COMPLETE',analysisWorkspace:source.analysisWorkspace,
      archiveId:source.archiveId,workspaceId:source.workspaceId,manifestSha256:source.manifestSha256,
      archiveSha256:archive.sha256,archiveBytes:archive.bytes,directory:context.root,
      archive:join(context.root,'workspace.zip'),files:source.files,
      createdAt:state.createdAt,completedAt:now()};
    state.phase='PUBLISHING';await checkpoint(context);
  }
  requireThat(object(state.receipt)&&state.receipt.schema===DOWNLOAD&&state.receipt.archiveId===source.archiveId&&
    state.receipt.workspaceId===source.workspaceId&&state.receipt.manifestSha256===source.manifestSha256&&
    state.receipt.directory===context.root,'JOURNAL_INVALID');
  const destination=join(context.root,'download-receipt.json'),temporary=join(context.control,'download-receipt.json.next');
  let saved;
  try{saved=await readJson(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(saved)requireThat(JSON.stringify(saved)===JSON.stringify(state.receipt),'RECEIPT_CHANGED');
  else{
    await removeOwned(temporary);
    const handle=await open(temporary,'wx',0o600);
    try{await handle.writeFile(json(state.receipt));await handle.sync();}finally{await handle.close();}
    context.lease.assertHeld();
    try{await link(temporary,destination);}
    catch(error){if(error.code!=='EEXIST')throw error;
      requireThat(JSON.stringify(await readJson(destination))===JSON.stringify(state.receipt),'RECEIPT_CHANGED');}
    await syncDirectory(context.root);await unlink(temporary);await syncDirectory(context.control);
  }
  // Preserve the same completed receipt on response loss and offline reopen.
  if(state.phase!=='COMPLETE'){state.phase='COMPLETE';await checkpoint(context);}
  return state.receipt;
}

/** Download both exact completed files. The same directory retains durable progress. */
export async function downloadNativeAnalysisArchive(options={}){
  const {directory,signal,onProgress,expectedSha256,expectedManifestSha256,chunkSize=MAX_CHUNK}=options;
  requireThat(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=MAX_CHUNK,'CHUNK_SIZE_INVALID');
  const client=await connection(options),source=await completed(client,options.analysisWorkspace,options.id);
  selectedHashes(source,expectedSha256,expectedManifestSha256);
  return locked(directory,true,async context=>{
    const prior=await readdir(context.control),reused=prior.includes('operation.json');
    await loadState(context,source);
    for(const file of source.files)await persistFile(context,client,file,{chunkSize,signal,onProgress});
    const result=await publishReceipt(context);return {...result,reused};
  });
}

/** Reopen the complete transport files without a running MCP or Analysis service. */
export async function reopenNativeAnalysisArchive({directory,expectedSha256,expectedManifestSha256}={}){
  return locked(directory,false,async context=>{
    const state=await loadState(context);
    selectedHashes(state.source,expectedSha256,expectedManifestSha256);
    requireThat(['PUBLISHING','COMPLETE'].includes(state.phase),'DOWNLOAD_INCOMPLETE');
    for(const file of state.source.files)await verifyFile(join(context.root,file.name),file);
    return {...await publishReceipt(context),reused:true};
  });
}
function argumentsFor(argv){
  const [command,...rest]=argv,allowed={
    inspect:['--url','--workspace','--id','--token-env'],
    download:['--url','--workspace','--id','--dir','--sha256','--manifest-sha256','--token-env','--chunk-size'],
    reopen:['--dir','--sha256','--manifest-sha256']};
  requireThat(Object.hasOwn(allowed,command)&&rest.length%2===0,'ARGUMENTS_INVALID');
  const values={};
  for(let index=0;index<rest.length;index+=2){
    requireThat(allowed[command].includes(rest[index])&&!Object.hasOwn(values,rest[index])&&rest[index+1],
      'ARGUMENTS_INVALID');values[rest[index]]=rest[index+1];
  }
  return {command,options:{url:values['--url'],analysisWorkspace:values['--workspace'],id:values['--id'],
    directory:values['--dir'],expectedSha256:values['--sha256'],expectedManifestSha256:values['--manifest-sha256'],
    tokenEnv:values['--token-env'],...(values['--chunk-size']===undefined?{}:{chunkSize:Number(values['--chunk-size'])})}};
}
export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){
    process.stdout.write('Original Analysis workspace archive transport.\n'+
      'inspect --url MCP_URL --workspace ALIAS --id UUID32 [--token-env NAME]\n'+
      'download --url MCP_URL --workspace ALIAS --id UUID32 --dir PRIVATE_DIR --sha256 ZIP_SHA256 --manifest-sha256 MANIFEST_SHA256 [--token-env NAME] [--chunk-size 1..65536]\n'+
      'reopen --dir PRIVATE_DIR --sha256 ZIP_SHA256 --manifest-sha256 MANIFEST_SHA256\n');
    return 0;
  }
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const {command,options}=argumentsFor(argv);options.signal=controller.signal;
    const result=await (command==='inspect'?inspectNativeAnalysisArchive(options):
      command==='download'?downloadNativeAnalysisArchive(options):reopenNativeAnalysisArchive(options));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
  }catch(error){
    const code=controller.signal.aborted?'MCP_ANALYSIS_ARCHIVE_DOWNLOAD_INTERRUPTED':
      ['ENOSPC','EDQUOT'].includes(error?.code)?'MCP_ANALYSIS_ARCHIVE_DOWNLOAD_STORAGE_FULL':
      /^[A-Z0-9_]{1,180}$/.test(error?.code??'')?error.code:
      'MCP_ANALYSIS_ARCHIVE_DOWNLOAD_FAILED';
    process.stderr.write(JSON.stringify({error:code})+'\n');return controller.signal.aborted?130:2;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode=await main();
