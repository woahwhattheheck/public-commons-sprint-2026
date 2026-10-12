// MIT. Saved Matomo launches retain the original workspace, source and listener identities.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {privateDirectory,identity,fault} from '../postgres/publisher/files.mjs';
import {sourceConfig} from './contract.mjs';
import {startMatomoWorkspace} from './server.mjs';

export const MATOMO_STARTUP_SCHEMA='stellar-forge.matomo-workspace-startup.v1';
export const MATOMO_LAUNCH_FILES=Object.freeze([
  'capture.mjs','cli.mjs','comparison.mjs','contract.mjs','customer.py','editions.mjs',
  'merchant.mjs','model.mjs','operator-handover.mjs','operator-scan.mjs','provider.mjs',
  'server.mjs','store.mjs','values.mjs','public/app.mjs','public/index.html','public/style.css',
  'launch.mjs','application-provider.mjs','workspace-transfer.mjs','workspace-transfer.py','product-cli.mjs','../source_bundle_archive.py'
]);
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function requireValue(value,code){if(!value)throw fault(code,undefined,400);}
export function matomoLaunchDirectory(value) {
  requireValue(typeof value==='string'&&value.length>0&&value.length<8192&&isAbsolute(value)&&
    !/[\x00-\x1f\x7f]/.test(value)&&resolve(value)===value,'MATOMO_CANONICAL_DIRECTORY_REQUIRED');
  return value;
}
async function retainedIdentity(path,{privateFile=false,maximum=1048576,content=false}={}) {
  let handle;
  try{
    handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=await handle.stat({bigint:true});
    requireValue(before.isFile()&&before.size>=0n&&before.size<=BigInt(maximum)&&
      (!privateFile||(before.nlink===1n&&!(before.mode&0o077n))),'MATOMO_LAUNCH_FILE_INVALID');
    const hash=createHash('sha256'),chunks=[],buffer=Buffer.alloc(65536);let offset=0;
    for(;;){
      const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(!bytesRead)break;
      offset+=bytesRead;requireValue(offset<=maximum,'MATOMO_LAUNCH_FILE_TOO_LARGE');
      const bytes=buffer.subarray(0,bytesRead);hash.update(bytes);if(content)chunks.push(Buffer.from(bytes));
    }
    const after=await handle.stat({bigint:true});
    requireValue(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&BigInt(offset)===after.size,
      'MATOMO_LAUNCH_FILE_CHANGED');
    return {bytes:offset,sha256:hash.digest('hex'),...(content?{content:Buffer.concat(chunks,offset)}:{})};
  }finally{await handle?.close();}
}
function json(bytes){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw fault('MATOMO_LAUNCH_JSON_INVALID',undefined,400);}
}
export async function inspectMatomoWorkspace(directory,{expectedIdentity,allowLoopback=false}={}) {
  directory=matomoLaunchDirectory(directory);await privateDirectory(directory,false);
  requireValue(await realpath(directory)===directory,'MATOMO_CANONICAL_DIRECTORY_REQUIRED');
  const settingsFile=await retainedIdentity(join(directory,'workspace.json'),{privateFile:true,maximum:65536,content:true});
  const settings=json(settingsFile.content);
  requireValue(settings.schema==='stellar-forge.matomo-workspace.v1'&&UUID.test(settings.id??'')&&
    HASH.test(settings.sourceSha256??'')&&identity(settings.source)===settings.sourceSha256,
    'MATOMO_WORKSPACE_IDENTITY_CHANGED');
  sourceConfig(settings.source,{allowLoopback});
  const initializationFile=await retainedIdentity(join(directory,'initialized.json'),{privateFile:true,maximum:4096,content:true});
  const initialized=json(initializationFile.content);
  requireValue(initialized.schema==='stellar-forge.matomo-initialization.v1'&&
    initialized.workspaceId===settings.id&&initialized.sourceSha256===settings.sourceSha256,
    'MATOMO_WORKSPACE_INITIALIZATION_CHANGED');
  const database=await lstat(join(directory,'matomo.sqlite'),{bigint:true});
  requireValue(database.isFile()&&!database.isSymbolicLink()&&database.nlink===1n&&!(database.mode&0o077n),
    'MATOMO_PRIVATE_DATABASE_REQUIRED');
  const value={schema:'stellar-forge.matomo-launch-identity.v1',directory,workspaceId:settings.id,
    settingsSha256:settingsFile.sha256,sourceSha256:settings.sourceSha256,
    initializationSha256:initializationFile.sha256,database:{dev:String(database.dev),ino:String(database.ino)}};
  const sha256=identity(value);
  if(expectedIdentity!==undefined)requireValue(HASH.test(expectedIdentity)&&sha256===expectedIdentity,'MATOMO_WORKSPACE_IDENTITY_CHANGED');
  return {...value,sha256,settings};
}
export async function inspectMatomoLaunchSource(directory,{expectedSha256}={}) {
  directory=matomoLaunchDirectory(directory);
  requireValue(await realpath(directory)===directory,'MATOMO_CANONICAL_DIRECTORY_REQUIRED');
  const files=[];
  for(const name of MATOMO_LAUNCH_FILES)files.push({name,...await retainedIdentity(join(directory,name))});
  const sha256=identity({schema:'stellar-forge.matomo-launch-source.v1',files});
  if(expectedSha256!==undefined)requireValue(HASH.test(expectedSha256)&&sha256===expectedSha256,'MATOMO_LAUNCH_SOURCE_CHANGED');
  return {directory,sha256,files};
}
export async function startMatomoLaunch({directory,workspaceIdentity,sourceDirectory,sourceSha256,port=0,
  python,environment=process.env,allowLoopback=false}={}) {
  requireValue(HASH.test(workspaceIdentity??'')&&HASH.test(sourceSha256??''),'MATOMO_LAUNCH_PINS_REQUIRED');
  const source=await inspectMatomoLaunchSource(sourceDirectory,{expectedSha256:sourceSha256});
  const launchSourceDirectory=await realpath(fileURLToPath(new URL('./',import.meta.url)));
  await inspectMatomoLaunchSource(launchSourceDirectory,{expectedSha256:sourceSha256});
  const before=await inspectMatomoWorkspace(directory,{expectedIdentity:workspaceIdentity,allowLoopback});
  let service;
  try{
    service=await startMatomoWorkspace({directory,port,python,environment,allowLoopback});
    const current=await inspectMatomoWorkspace(directory,{expectedIdentity:workspaceIdentity,allowLoopback});
    requireValue(service.model.store.settings.id===before.workspaceId&&current.sha256===before.sha256,
      'MATOMO_WORKSPACE_IDENTITY_CHANGED');
    return {...service,announcement:{schema:MATOMO_STARTUP_SCHEMA,status:'MATOMO_WORKSPACE_READY',
      url:service.url,directory,workspaceId:before.workspaceId,workspaceIdentity,
      settingsSha256:before.settingsSha256,sourceSha256,sourceDirectory,launchSourceDirectory,
      sourceFiles:source.files,instanceId:service.instanceId,pid:process.pid}};
  }catch(error){await service?.close().catch(()=>{});throw error;}
}
export async function run(argv=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
    workspace:{type:'string'},'workspace-identity':{type:'string'},'source-directory':{type:'string'},
    'source-sha256':{type:'string'},port:{type:'string',default:'0'},python:{type:'string'},
    'allow-loopback':{type:'boolean',default:false},'startup-json':{type:'boolean',default:false}
  }});
  requireValue(positionals.length===1&&positionals[0]==='serve'&&values['startup-json']===true,
    'MATOMO_REVIEWED_LAUNCH_REQUIRED');
  requireValue(/^(0|[1-9][0-9]*)$/.test(values.port)&&Number(values.port)<=65535,'MATOMO_PORT_INVALID');
  const service=await startMatomoLaunch({directory:values.workspace,workspaceIdentity:values['workspace-identity'],
    sourceDirectory:values['source-directory'],sourceSha256:values['source-sha256'],port:Number(values.port),
    python:values.python,allowLoopback:values['allow-loopback']});
  process.stdout.write(JSON.stringify(service.announcement)+'\n');
  const close=()=>void service.close().catch(()=>{process.exitCode=1;});
  process.once('SIGINT',close);process.once('SIGTERM',close);
  return service;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)run().catch(error=>{
  process.stderr.write(JSON.stringify({error:error.code??'MATOMO_LAUNCH_FAILED'})+'\n');process.exitCode=1;
});
