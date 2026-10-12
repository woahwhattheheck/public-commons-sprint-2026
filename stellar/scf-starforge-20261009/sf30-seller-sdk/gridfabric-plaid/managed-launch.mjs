#!/usr/bin/env node
// MIT. Managed ownership of the original GridFabric listener, SQLite lease and connection bytes.
import {open,lstat,realpath,link,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openGridFabricWorkspace} from './operator.mjs';
import {startGridFabricServer} from './server.mjs';
import {GRIDFABRIC_STARTUP_SCHEMA,GRIDFABRIC_HASH,GRIDFABRIC_UUID,gridFabricAbsolute,gridFabricHash,
  gridFabricSame,gridFabricNeed as need,gridFabricOriginalFile,inspectGridFabricApplicationBinding,
  inspectRetainedGridFabricStartup} from './managed-binding.mjs';

const OWN_SOURCE=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const signature=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
async function syncDirectory(path) {
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);
  try{await handle.sync();}finally{await handle.close();}
}
async function optionalFile(path,maximum) {
  try{return await gridFabricOriginalFile(path,maximum,{privateOnly:true,bytes:true});}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function sameFile(path,raw) {
  const original=await optionalFile(path,raw.length);
  need(original&&original.raw.equals(raw),'GRIDFABRIC_APPLICATION_PUBLICATION_CHANGED',
    'Preserve the different original publication file.',{path});
  return original;
}
async function removeExactStage(path,raw) {
  const stage=path+'.pending-'+gridFabricHash(raw),existing=await optionalFile(stage,raw.length);
  if(!existing)return;
  need(existing.raw.equals(raw),'GRIDFABRIC_APPLICATION_STAGING_CHANGED','Preserve the different deterministic stage.',{path:stage});
  await unlink(stage);await syncDirectory(dirname(stage));
}
async function stageComplete(path,raw) {
  const stage=path+'.pending-'+gridFabricHash(raw);let handle;
  try{handle=await open(stage,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const existing=await optionalFile(stage,raw.length);
    need(existing&&raw.subarray(0,existing.bytes).equals(existing.raw),'GRIDFABRIC_APPLICATION_STAGING_CHANGED',
      'Only the exact retained publication prefix can continue.',{path:stage});
    const before=await lstat(stage);
    handle=await open(stage,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{need(signature(await handle.stat())===signature(before),'GRIDFABRIC_APPLICATION_STAGING_CHANGED');}
    catch(caught){await handle.close();throw caught;}
  }
  try {
    const stat=await handle.stat();need(stat.isFile()&&stat.size<=raw.length,'GRIDFABRIC_APPLICATION_STAGING_CHANGED');
    if(stat.size<raw.length) {
      let offset=stat.size;
      while(offset<raw.length){const count=(await handle.write(raw,offset,raw.length-offset,offset)).bytesWritten;
        need(count>0,'GRIDFABRIC_APPLICATION_WRITE_INCOMPLETE');offset+=count;}
    }
    await handle.sync();
  }finally{await handle.close();}
  await sameFile(stage,raw);return stage;
}
/** New final files are published without clobbering any existing destination. */
async function writeExact(path,raw) {
  const existing=await optionalFile(path,raw.length);
  if(existing) {
    need(existing.raw.equals(raw),'GRIDFABRIC_APPLICATION_PUBLICATION_EXISTS','The destination contains another original file.',{path});
    await removeExactStage(path,raw);return {bytes:raw.length,sha256:gridFabricHash(raw),raw};
  }
  const stage=await stageComplete(path,raw);
  try{await link(stage,path);}
  catch(error){if(error.code!=='EEXIST')throw error;await sameFile(path,raw);}
  await syncDirectory(dirname(path));await removeExactStage(path,raw);
  return {bytes:raw.length,sha256:gridFabricHash(raw),raw};
}
/** Replacement is restricted to the exact previous managed record under the native workspace lease. */
async function replaceExact(path,raw,previous) {
  if(!previous)return writeExact(path,raw);
  const current=await sameFile(path,previous.raw);
  need(current.sha256===previous.sha256,'GRIDFABRIC_APPLICATION_PUBLICATION_CHANGED');
  const stage=await stageComplete(path,raw);
  await sameFile(path,previous.raw);
  await rename(stage,path);await syncDirectory(dirname(path));
  await removeExactStage(path,previous.raw);
  return {bytes:raw.length,sha256:gridFabricHash(raw),raw};
}
async function removeExact(path,original) {
  const current=await optionalFile(path,Math.max(original.bytes,32768));
  if(!current){await removeExactStage(path,original.raw);return;}
  need(current.bytes===original.bytes&&current.sha256===original.sha256&&current.raw.equals(original.raw),
    'GRIDFABRIC_APPLICATION_PUBLICATION_CHANGED','Another publication replaced this owner; preserve it.',{path});
  await removeExactStage(path,original.raw);
  await sameFile(path,original.raw);await unlink(path);await syncDirectory(dirname(path));
}
function sameRetained(first,second) {
  return gridFabricSame(first?{ready:first.ready.sha256,connection:first.connection?.sha256??null}:null,
    second?{ready:second.ready.sha256,connection:second.connection?.sha256??null}:null);
}
async function preservePrevious(binding,previous) {
  const observed=await inspectRetainedGridFabricStartup(binding);
  need(sameRetained(previous,observed),'GRIDFABRIC_APPLICATION_CONNECTION_CHANGED');
  if(!previous)return;
  await writeExact(binding.readyFile+'.previous-'+previous.ready.sha256+'.json',previous.ready.raw);
  if(previous.connection) {
    await writeExact(binding.connectionFile+'.previous-'+previous.connection.sha256+'.txt',previous.connection.raw);
    await removeExact(binding.connectionFile,previous.connection);
  }
}

/** This opens no new domain and performs no management/device dispatch. */
export async function startManagedGridFabricApplication({directory,connectionFile,readyFile,
  expectedWorkspaceId,expectedBindingSha256,port=0,applicationRequestId=randomUUID(),
  sourceRoot=OWN_SOURCE,environment=process.env}={}) {
  need(GRIDFABRIC_UUID.test(expectedWorkspaceId??'')&&GRIDFABRIC_HASH.test(expectedBindingSha256??'')&&
    GRIDFABRIC_UUID.test(applicationRequestId),'GRIDFABRIC_APPLICATION_REVIEW_REQUIRED');
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'GRIDFABRIC_APPLICATION_PORT');
  sourceRoot=await realpath(gridFabricAbsolute(sourceRoot));
  need(sourceRoot===await realpath(OWN_SOURCE),'GRIDFABRIC_APPLICATION_EXECUTED_SOURCE_CHANGED',
    'Launch the source selected by the original installed or adopted package.');
  const selected=await inspectGridFabricApplicationBinding({directory,sourceRoot,connectionFile,readyFile,expectedWorkspaceId});
  const {binding}=selected;
  need(binding.bindingSha256===expectedBindingSha256,'GRIDFABRIC_APPLICATION_BINDING_CHANGED');
  const previous=await inspectRetainedGridFabricStartup(binding);
  let workspace=null,listener=null,closing=null,connectionIdentity=null,readyIdentity=null;
  const instanceId=randomUUID();
  async function close() {
    if(!closing)closing=(async()=>{
      const errors=[];
      if(listener)try{await listener.close();}catch(error){errors.push(error);}
      if(workspace)try{await workspace.close();}catch(error){errors.push(error);}
      // A failed original drain retains its published connection and recovery record.
      if(!errors.length) {
        if(connectionIdentity)try{await removeExact(binding.connectionFile,connectionIdentity);}catch(error){errors.push(error);}
        if(!errors.length&&readyIdentity)try{await removeExact(binding.readyFile,readyIdentity);}catch(error){errors.push(error);}
      }
      if(errors.length) {
        const primary=errors[0];primary.gridFabricCloseErrors=errors.map(error=>({code:error.code??error.name,message:error.message}));
        throw primary;
      }
    })();
    return closing;
  }
  try {
    workspace=await openGridFabricWorkspace({directory:binding.directory,create:false,environment});
    const observed=workspace.state();
    need(observed.workspace_id===binding.workspaceId&&observed.created_at===binding.workspaceCreatedAt,
      'GRIDFABRIC_APPLICATION_WORKSPACE_CHANGED');
    // A prior PID is never used as evidence. The original lease must be held before retiring matching old bytes.
    await preservePrevious(binding,previous);
    listener=await startGridFabricServer({workspace,port,environment});
    need(listener.workspace_id===binding.workspaceId&&listener.source.sha256===binding.source.nativeSourceSha256,
      'GRIDFABRIC_APPLICATION_NATIVE_SOURCE');
    const raw=Buffer.from(listener.consoleUrl+'\n');
    connectionIdentity={bytes:raw.length,sha256:gridFabricHash(raw),raw};
    const value={schema:GRIDFABRIC_STARTUP_SCHEMA,status:'READY',instanceId,applicationRequestId,pid:process.pid,
      directory:binding.directory,workspaceId:binding.workspaceId,workspaceCreatedAt:binding.workspaceCreatedAt,
      sourceRoot,source:binding.source,node:binding.node,bindingSha256:binding.bindingSha256,
      connectionFile:binding.connectionFile,readyFile:binding.readyFile,
      url:listener.consoleUrl,connection:{bytes:raw.length,sha256:connectionIdentity.sha256},observedAt:new Date().toISOString()};
    const publishing=json({...value,status:'PUBLISHING'}),ready=json(value);
    // This exact record precedes the original plaintext connection, so interrupted publication has a source binding.
    readyIdentity=await replaceExact(binding.readyFile,publishing,previous?.ready??null);
    await writeExact(binding.connectionFile,raw);
    readyIdentity=await replaceExact(binding.readyFile,ready,readyIdentity);
    return Object.freeze({announcement:value,binding,sourceRoot,close});
  }catch(error) {
    try{await close();}catch(cleanup){error.gridFabricCloseErrors=cleanup.gridFabricCloseErrors??[{code:cleanup.code??cleanup.name,message:cleanup.message}];}
    throw error;
  }
}
const FLAGS=new Set(['workspace','connection-file','ready-file','expected-workspace-id','expected-binding-sha256','port','application-request-id']);
export function parseGridFabricManagedArguments(argv) {
  need(Array.isArray(argv)&&argv.every(value=>typeof value==='string'),'GRIDFABRIC_APPLICATION_ARGUMENTS');
  const command=argv[0]??'help',options={};
  need(['help','binding','serve','status'].includes(command),'GRIDFABRIC_APPLICATION_COMMAND');
  for(let index=1;index<argv.length;index++) {
    need(argv[index].startsWith('--'),'GRIDFABRIC_APPLICATION_ARGUMENTS');
    const key=argv[index].slice(2);
    need(FLAGS.has(key)&&!Object.hasOwn(options,key)&&typeof argv[index+1]==='string'&&!argv[index+1].startsWith('--'),
      'GRIDFABRIC_APPLICATION_ARGUMENTS');
    options[key]=argv[++index];
  }
  return {command,options};
}
export async function runGridFabricManagedCLI(argv=process.argv.slice(2),streams={}) {
  const stdout=streams.stdout??process.stdout,stderr=streams.stderr??process.stderr;
  let owner,primary,requested=false,resolveStop;
  const stopping=new Promise(resolve=>{resolveStop=resolve;});
  const signal=()=>{requested=true;resolveStop();};
  try {
    if(!argv.length||argv.includes('--help'))argv=['help'];
    const {command,options:o}=parseGridFabricManagedArguments(argv);
    if(command==='help') {
      stdout.write('GridFabric managed application\n\n'+
        'gridfabric-application binding --workspace ORIGINAL [--connection-file PRIVATE_FILE --ready-file PRIVATE_JSON]\n'+
        'gridfabric-application status --workspace ORIGINAL [--connection-file PRIVATE_FILE --ready-file PRIVATE_JSON]\n'+
        'gridfabric-application serve --workspace ORIGINAL --expected-workspace-id UUID --expected-binding-sha256 SHA [--port 0]\n\n'+
        'The complete selected package opens the original native owner. SIGINT or SIGTERM drains its listener and SQLite lease.\n');
      return 0;
    }
    const directory=gridFabricAbsolute(o.workspace),connectionFile=o['connection-file']?gridFabricAbsolute(o['connection-file']):undefined;
    const readyFile=o['ready-file']?gridFabricAbsolute(o['ready-file']):undefined;
    const selected={directory,connectionFile,readyFile,expectedWorkspaceId:o['expected-workspace-id']??null,sourceRoot:OWN_SOURCE};
    if(command==='binding'||command==='status') {
      const inspected=await inspectGridFabricApplicationBinding(selected);
      const retained=await inspectRetainedGridFabricStartup(inspected.binding);
      let native=null;
      if(command==='status'&&retained?.value.status==='READY'&&retained.connection) {
        const {verifyGridFabricApplicationAnnouncement}=await import('./managed-binding.mjs');
        const verified=await verifyGridFabricApplicationAnnouncement(inspected.binding.readyFile,retained.value);
        native={workspaceId:verified.native.workspace_id,revision:verified.state.revision,sourceSha256:verified.native.source_sha256};
      }
      stdout.write(JSON.stringify({binding:inspected.binding,observed:inspected.observed,sourceRoot:inspected.sourceRoot,
        ...(command==='status'?{retained:retained?.value??null,native}:{} )})+'\n');return 0;
    }
    need(GRIDFABRIC_UUID.test(o['expected-workspace-id']??'')&&GRIDFABRIC_HASH.test(o['expected-binding-sha256']??''),
      'GRIDFABRIC_APPLICATION_REVIEW_REQUIRED');
    need(o.port===undefined||/^(0|[1-9][0-9]{0,4})$/.test(o.port),'GRIDFABRIC_APPLICATION_PORT');
    const port=o.port===undefined?0:Number(o.port);
    process.on('SIGINT',signal);process.on('SIGTERM',signal);
    owner=await startManagedGridFabricApplication({...selected,expectedBindingSha256:o['expected-binding-sha256'],port,
      ...(o['application-request-id']?{applicationRequestId:o['application-request-id']}:{})});
    if(!requested){stdout.write(JSON.stringify(owner.announcement)+'\n');await stopping;}
    return 0;
  }catch(error) {
    primary=error;stderr.write(JSON.stringify({error:error.code??error.name,message:error.message,
      ...(error.gridFabricCloseErrors?{closeErrors:error.gridFabricCloseErrors}:{})})+'\n');return 1;
  }finally {
    try {
      if(owner)try{await owner.close();}catch(error) {
        stderr.write(JSON.stringify({error:error.code??error.name,message:error.message,closeErrors:error.gridFabricCloseErrors??[]})+'\n');
        if(!primary){process.exitCode=1;return 1;}
      }
    }finally{process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const result=await runGridFabricManagedCLI();if(process.exitCode!==1)process.exitCode=result;
}
