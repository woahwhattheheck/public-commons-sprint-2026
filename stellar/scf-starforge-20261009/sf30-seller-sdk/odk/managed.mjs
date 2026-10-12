#!/usr/bin/env node
// MIT. Applications owns this process; the original Central workspace owns its writer and captures.
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openCentralWorkspace} from './workspace.mjs';
import {createCentralServer} from './server.mjs';
import {restoreCentralArchive} from './archive.mjs';
import {ODK_CONNECTION_SCHEMA,ODK_CONNECTION_FILENAME,ODK_STARTUP_SCHEMA,ODK_HASH,
  odkNeed,odkAbsolute,odkPrivateDirectory,odkWritePrivateJson,odkReadPrivateJson} from './connection.mjs';

const OPTIONS=['workspace','operator','port','restore-archive','restore-sha256'];
export function centralManagedOptions(argv){
  const raw={};
  for(let i=0;i<argv.length;i+=2){
    const flag=argv[i];
    odkNeed(typeof flag==='string'&&flag.startsWith('--')&&OPTIONS.includes(flag.slice(2))&&
      !Object.hasOwn(raw,flag.slice(2))&&typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--'),
    'ODK_MANAGED_ARGUMENT_INVALID','Use each documented option once with its value.');
    raw[flag.slice(2)]=argv[i+1];
  }
  const directory=odkAbsolute(raw.workspace),operator=raw.operator||'Central field operator';
  odkNeed(operator.trim()===operator&&operator.length>=1&&operator.length<=240&&!/[\x00-\x1f\x7f]/.test(operator),
    'ODK_OPERATOR_INVALID','Provide an operator name of 1–240 characters.');
  odkNeed(/^\d+$/.test(raw.port??'0')&&Number(raw.port??0)<=65535,
    'ODK_PORT_INVALID','Choose a local port from 0 to 65535.');
  odkNeed(Boolean(raw['restore-archive'])===Boolean(raw['restore-sha256'])&&
    (!raw['restore-sha256']||ODK_HASH.test(raw['restore-sha256'])),
  'ODK_RESTORE_SELECTION_INVALID','Select the original archive and its exact reviewed SHA-256 together.');
  return {directory,operator,port:Number(raw.port??0),
    ...(raw['restore-archive']?{restoreArchive:odkAbsolute(raw['restore-archive']),restoreSha256:raw['restore-sha256']}:{})};
}
/** Restore, if selected, completes before the one original writer is opened. */
export async function startManagedCentralWorkspace(options){
  odkNeed(Boolean(options.restoreArchive)===Boolean(options.restoreSha256),
    'ODK_RESTORE_SELECTION_INVALID','Select the original archive and its exact reviewed SHA-256 together.');
  const selected=centralManagedOptions(['--workspace',options.directory,'--operator',options.operator||'Central field operator',
    '--port',String(options.port??0),
    ...(options.restoreArchive?['--restore-archive',options.restoreArchive,'--restore-sha256',options.restoreSha256]:[])]);
  let restored=null;
  if(selected.restoreArchive)restored=await restoreCentralArchive({archive:selected.restoreArchive,
    directory:selected.directory,expectedSha256:selected.restoreSha256,signal:options.signal});
  await mkdir(selected.directory,{recursive:true,mode:0o700});
  const before=await odkPrivateDirectory(selected.directory);
  const workspace=await openCentralWorkspace({directory:before.path,
    ...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})});
  let server,connection,closePromise;
  try{
    server=await createCentralServer({workspace,host:'127.0.0.1',port:selected.port,
      token:(await import('node:crypto')).randomBytes(32).toString('hex')});
    const identity=await odkPrivateDirectory(workspace.directory),state=await workspace.state();
    odkNeed(identity.dev===before.dev&&identity.ino===before.ino,
      'ODK_DIRECTORY_CHANGED','The selected original workspace directory changed during opening.',409);
    const value={schema:ODK_CONNECTION_SCHEMA,instanceId:randomUUID(),directory:identity.path,
      directoryIdentity:{dev:identity.dev,ino:identity.ino},workspaceId:state.id,
      operator:selected.operator,pid:process.pid,startedAt:new Date().toISOString(),
      origin:server.origin,url:server.url};
    const written=await odkWritePrivateJson(join(identity.path,ODK_CONNECTION_FILENAME),value,{replace:true});
    connection={...written,value};
    const close=()=>closePromise||(closePromise=(async()=>{
      let failure;
      try{
        const current=await odkReadPrivateJson(connection.path,32768);
        if(current.sha256===connection.sha256)await unlink(connection.path);
      }catch(error){if(error.code!=='ENOENT')failure=error;}
      try{await server.close();}catch(error){failure??=error;}
      try{await workspace.close();}catch(error){failure??=error;}
      if(failure)throw failure;
    })());
    return {...server,directory:identity.path,workspace,operator:selected.operator,connection,
      instanceId:value.instanceId,restored,close};
  }catch(error){
    await server?.close().catch(()=>{});
    await workspace.close().catch(()=>{});
    throw error;
  }
}
export function centralStartup(service){
  return {schema:ODK_STARTUP_SCHEMA,status:'ODK_WORKSPACE_READY',directory:service.directory,
    operator:service.operator,workspaceId:service.connection.value.workspaceId,instanceId:service.instanceId,
    pid:service.connection.value.pid,connectionFile:service.connection.path,
    connectionSha256:service.connection.sha256,origin:service.origin,url:service.url};
}
const HELP='ODK Central managed workspace\n\n'+
  'starforge odk-central-workspace --workspace /private/central --operator "Field data operator" [--port 0]\n'+
  '  --restore-archive PATH          Original complete Central archive, selected before opening\n'+
  '  --restore-sha256 SHA256         Exact reviewed archive hash; required with --restore-archive\n\n'+
  'Data subcommands delegate to the original Central CLI: state, capture, report, dataset and release controls.\n'+
  'Applications reviews, saves, starts, opens and stops this same leased workspace.\n'+
  'Its private odk.connection.json connects the CLI and typed tools to the existing listener.\n'+
  'A same-archive restart reopens the original received workspace and preserves later editions.\n'+
  'Provider Authorization stays in the named host environment; only aliases enter saved connections.\n'+
  'SIGINT/SIGTERM closes HTTP, settles original captures and releases the original writer lease.\n';
export async function runManagedCentralCli(argv=process.argv.slice(2),{
  stdout=process.stdout,waitForClose=true,
}={}){
  if(argv.length===0||argv.length===1&&['help','--help'].includes(argv[0])){
    stdout.write(HELP);return {help:true};
  }
  if(argv[0]==='serve')argv=argv.slice(1);
  else if(!argv[0].startsWith('--'))return (await import('./cli.mjs')).runCentralCli(argv);
  const service=await startManagedCentralWorkspace(centralManagedOptions(argv));
  try{stdout.write(JSON.stringify(centralStartup(service))+'\n');}
  catch(error){await service.close();throw error;}
  if(!waitForClose)return service;
  let stopping=false;
  await new Promise((accept,reject)=>{
    const stop=async()=>{
      if(stopping)return;stopping=true;
      try{await service.close();accept();}catch(error){reject(error);}
      finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
    };
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  });
  return {status:'CLOSED',instanceId:service.instanceId};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runManagedCentralCli().catch(error=>{
    process.stderr.write(JSON.stringify({error:{code:error.code||'ODK_MANAGED_FAILED',
      message:'The original Central application could not complete. Inspect its retained operation and private workspace.'}})+'\n');
    process.exitCode=1;
  });
}
