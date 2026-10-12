#!/usr/bin/env node
// MIT. Complete original SensorThings operations, serving and retained receiving.
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {open,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {openSensorThingsWorkspace} from './core.mjs';
import {serveSensorThingsWorkspace} from './server.mjs';
import {createFileAccess} from './files.mjs';
import {MerchantSensorThingsWorkspaces,readSensorThingsWorkspaceConfiguration} from './mcp.mjs';
import {inspectSensorThingsFiles,downloadSensorThingsFiles} from './download.mjs';
import {STARTUP_SCHEMA} from './schema.mjs';
import {json,plain,fault} from './contract.mjs';
import {readOwned,privateDirectory,syncDir} from '../stellar-expert/store.mjs';
import {parseExactJSON} from '../stellar-expert/exact-json.mjs';

const MAX_INPUT=2*1024*1024;
const COMMANDS=Object.freeze({
  serve:['workspace','host','port','session-file','expected-workspace-id','source-inbox','buyer-workspace'],
  schema:['workspace'],view:['workspace'],
  catalog:['workspace','id','offset','limit'],edition:['workspace','id'],summary:['workspace','id'],
  rows:['workspace','id','table','offset','limit'],capture:['workspace','id'],
  operation:['workspace','id'],release:['workspace','id'],publisher:['workspace','id'],
  files:['workspace','selection'],'file-read':['workspace','input'],
  action:['workspace','input','source-inbox','buyer-workspace'],
  connect:['config','alias','tool','input'],
  'inspect-download':['config','alias','selection'],
  download:['config','alias','selection','directory','expected-manifest-sha256','export-id','chunk-size','progress']
});
export const HELP=[
  'SensorThings observation operations in the original native workspace.',
  '',
  'serve --workspace DIR [--host 127.0.0.1|::1] [--port N] [--session-file PRIVATE_URL_FILE]',
  '      [--expected-workspace-id UUID] [--source-inbox DIR] [--buyer-workspace DIR]',
  'schema|view --workspace DIR',
  'catalog --workspace DIR --id ID [--offset N] [--limit N]',
  'edition|summary|capture|operation|release|publisher --workspace DIR --id ID',
  'rows --workspace DIR --id EDITION --table observations|components|entities [--offset N] [--limit N]',
  'files --workspace DIR --selection JSON_FILE',
  'file-read --workspace DIR --input JSON_FILE',
  'action --workspace DIR --input JSON_FILE [--source-inbox DIR] [--buyer-workspace DIR]',
  'connect --config PRIVATE_CONNECTION_FILE --alias ALIAS --tool ADVERTISED_TOOL [--input JSON_FILE]',
  'inspect-download --config PRIVATE_CONNECTION_FILE --alias ALIAS --selection JSON_FILE',
  'download --config PRIVATE_CONNECTION_FILE --alias ALIAS --selection JSON_FILE --directory DIR',
  '         [--expected-manifest-sha256 SHA] [--export-id ID] [--chunk-size N] [--progress]',
  '',
  'An action file contains exactly {operationId,expectedRevision,action,payload}.',
  'Use the current revision and keep the same operation ID and exact payload on recovery.',
  'A running Operations Desk owns its writer: use connect/download while it runs.',
  'One-shot capture.start/resume awaits its own bounded request batch before closing.',
  'Use a running listener for release.start so the original seller process stays alive.',
  'File read IDs belong to this process; after exit resume the same selector/SHA/offset without that old ID.',
  'Download keeps the existing original downloader journal and verifies every complete file.',
  'JSON_FILE may be - for bounded stdin. Startup URL/session files contain a private token.'
].join('\n');
function argumentError(message){return fault('CLI_ARGUMENT',message);}
function parse(argv){
  const [command,...values]=argv;if(!COMMANDS[command])throw argumentError('Choose an advertised command; use --help.');
  const result={command};
  for(let i=0;i<values.length;i++){
    const token=values[i];if(!/^--[a-z][a-z0-9-]*$/.test(token))throw argumentError('Use the documented --name value arguments.');
    const key=token.slice(2);
    if(!COMMANDS[command].includes(key)||Object.hasOwn(result,key))throw argumentError('Unknown or repeated '+token+' for '+command+'.');
    if(key==='progress'){result[key]=true;continue;}
    if(i+1>=values.length||values[i+1].startsWith('--'))throw argumentError('Supply a value for '+token+'.');
    result[key]=values[++i];
  }
  return result;
}
function required(options,key){if(typeof options[key]!=='string'||!options[key])throw argumentError('Supply --'+key+'.');return options[key];}
function path(options,key,{optional=false}={}){
  if(optional&&options[key]===undefined)return undefined;
  const value=required(options,key);if(value.includes('\0'))throw argumentError('Use an ordinary host path for --'+key+'.');
  return resolve(value);
}
function number(options,key,fallback,minimum,maximum){
  if(options[key]===undefined)return fallback;
  if(!/^(0|[1-9]\d*)$/.test(options[key]))throw argumentError('Use an integer --'+key+'.');
  const value=Number(options[key]);if(!Number.isSafeInteger(value)||value<minimum||value>maximum)throw argumentError('Use --'+key+' between '+minimum+' and '+maximum+'.');
  return value;
}
async function inputBytes(filename){
  if(filename==='-'){
    const parts=[];let length=0;
    for await(const part of process.stdin){length+=part.length;if(length>MAX_INPUT)throw argumentError('The JSON input exceeds 2 MiB.');parts.push(part);}
    return Buffer.concat(parts,length);
  }
  const handle=await open(resolve(filename),constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||before.size>BigInt(MAX_INPUT))throw argumentError('Select a regular JSON input of at most 2 MiB.');
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    if(bytes.length>MAX_INPUT||['dev','ino','size','mtimeNs','ctimeNs'].some(k=>before[k]!==after[k]))
      throw argumentError('The original JSON input changed while it was read.');
    return bytes;
  }finally{await handle.close();}
}
async function inputJSON(filename){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(await inputBytes(filename));
  parseExactJSON(text);return JSON.parse(text);
}
async function writeSessionFile(filename,url){
  if(!isAbsolute(filename))throw argumentError('Use an absolute private session-file path.');
  await privateDirectory(dirname(filename),{create:false});
  let existing;
  try{existing=new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(filename,4096)).trim();}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing!==undefined){
    let a,b;try{a=new URL(existing);b=new URL(url);}catch{throw argumentError('The selected session file does not contain its original private URL.');}
    if(a.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(a.hostname)||a.username||a.password||
        a.pathname!=='/'||a.search||a.hash!==b.hash)
      throw argumentError('This private session file belongs to another original workspace session.');
  }
  const temporary=join(dirname(filename),'.sensorthings-url-'+randomUUID()+'.tmp');
  let handle;
  try{
    handle=await open(temporary,'wx',0o600);await handle.writeFile(url+'\n');await handle.sync();await handle.close();handle=null;
    await rename(temporary,filename);await syncDir(dirname(filename));
  }finally{if(handle)await handle.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function shutdown(operation){
  let requested=false,error=null;const pending=[];
  const listener=()=>{if(requested)return;requested=true;const p=Promise.resolve().then(operation).catch(e=>{error=e;});pending.push(p);};
  process.once('SIGINT',listener);process.once('SIGTERM',listener);
  return {get requested(){return requested;},async finish(){process.off('SIGINT',listener);process.off('SIGTERM',listener);await Promise.all(pending);if(error)throw error;}};
}
async function connected(options,operation){
  const config=await readSensorThingsWorkspaceConfiguration(path(options,'config')),alias=required(options,'alias'),
    definition=config.workspaces[alias];
  if(!definition)throw argumentError('Choose an alias in the original host connection file.');
  const client=new MerchantSensorThingsWorkspaces(config),controller=new AbortController(),
    signals=shutdown(()=>controller.abort());
  try{return await operation({client,workspace:alias,workspaceId:definition.workspaceId,signal:controller.signal});}
  finally{try{await client.close();}finally{await signals.finish();}}
}
async function start(options,emit){
  const running=await serveSensorThingsWorkspace({directory:path(options,'workspace'),host:options.host??'127.0.0.1',
    port:number(options,'port',0,0,65535),expectedWorkspaceId:options['expected-workspace-id'],
    sourceInboxDirectory:path(options,'source-inbox',{optional:true}),buyerWorkspaceDirectory:path(options,'buyer-workspace',{optional:true})});
  let end;const stopped=new Promise(resolve=>{end=resolve;});const signals=shutdown(async()=>{try{await running.close();}finally{end();}});
  try{
    const sessionFile=path(options,'session-file',{optional:true});
    if(sessionFile)await writeSessionFile(sessionFile,running.url);
    const record={schema:STARTUP_SCHEMA,workspaceId:running.workspaceId,origin:running.origin,url:running.url,pid:process.pid,
      sessionFile:sessionFile??null,ownership:'ORIGINAL_SENSORTHINGS_WORKSPACE',fileReads:'SAME_NATIVE_HELD_FILE_OWNER'};
    emit(record);await stopped;return null;
  }finally{try{await running.close();}finally{await signals.finish();}}
}
async function direct(options){
  let request;if(options.command==='action'){
    request=await inputJSON(required(options,'input'));
    if(request?.action==='release.start')throw argumentError('Use connect against the running original listener for release.start; its seller process must outlive this one-shot command.');
  }
  const workspace=await openSensorThingsWorkspace({directory:path(options,'workspace'),
    sourceInboxDirectory:path(options,'source-inbox',{optional:true}),buyerWorkspaceDirectory:path(options,'buyer-workspace',{optional:true})}),
    files=createFileAccess(workspace),signals=shutdown(()=>workspace.close());
  try{
    const id=options.id,range={offset:number(options,'offset',0,0,Number.MAX_SAFE_INTEGER),limit:number(options,'limit',100,1,500)};
    switch(options.command){
      case 'schema':return workspace.schema();
      case 'view':return await workspace.view();
      case 'catalog':return await workspace.catalogRows(required(options,'id'),range);
      case 'edition':return await workspace.edition(required(options,'id'));
      case 'summary':return await workspace.summary(required(options,'id'));
      case 'rows':return await workspace.rows(required(options,'id'),{...range,table:required(options,'table')});
      case 'capture':return workspace.capture(required(options,'id'));
      case 'release':return await workspace.release(required(options,'id'));
      case 'publisher':return await workspace.publisher(required(options,'id'));
      case 'operation':{
        const found=workspace.store.read().operations[required(options,'id')];
        if(!found)throw fault('OPERATION','No original operation with this identity is retained.',404);
        const {payload,context,...value}=found;
        return {...value,result:found.resultSha256?JSON.parse((await workspace.store.object(found.resultSha256)).toString('utf8')):null};
      }
      case 'files':return await files.list(await inputJSON(required(options,'selection')));
      case 'file-read':{
        const value=await files.read(await inputJSON(required(options,'input')));
        return {...value,cliReadScope:'Released on this process exit; resume the same selector/SHA/offset without this old readId.'};
      }
      case 'action':{
        const result=await workspace.action(request);
        if(['capture.start','capture.resume'].includes(request.action)&&result.result?.captureId)
          return {...result,capture:await workspace.waitCapture(result.result.captureId),view:await workspace.view()};
        return result;
      }
      default:throw argumentError('Choose an original direct-workspace command.');
    }
  }finally{try{await files.close();}finally{try{await workspace.close();}finally{await signals.finish();}}}
}
export async function main(argv=process.argv.slice(2),{emit=value=>process.stdout.write(json(value))}={}){
  if(!argv.length||argv.includes('--help')){process.stdout.write(HELP+'\n');return null;}
  const options=parse(argv);
  if(options.command==='serve')return start(options,emit);
  let result;
  if(options.command==='connect'){
    const input=options.input?await inputJSON(options.input):{};
    if(!plain(input)||Object.hasOwn(input,'workspace'))throw argumentError('Connection input contains tool fields only; --alias binds the original workspace.');
    result=await connected(options,async({client,workspace})=>{
      const tool=required(options,'tool');
      const result=await client.call(tool,tool==='merchant_sensorthings_workspaces'?input:{workspace,...input});
      return options.tool==='merchant_sensorthings_file_read'?{...result,cliReadScope:'This native client closes on exit; resume the same SHA/offset without its old readId.'}:result;
    });
    if(result?.ok===false)process.exitCode=2;
  }else if(options.command==='download'||options.command==='inspect-download'){
    const selected=await inputJSON(required(options,'selection'));
    result=await connected(options,async scope=>{
      const settings={...scope,selection:selected,expectedManifestSha256:options['expected-manifest-sha256'],exportId:options['export-id'],
        chunkSize:number(options,'chunk-size',65536,1,196608),
        onProgress:options.progress?value=>process.stderr.write(json(value)):undefined};
      return options.command==='download'?downloadSensorThingsFiles({...settings,directory:path(options,'directory')}):inspectSensorThingsFiles(settings);
    });
  }else result=await direct(options);
  if(result?.capture&&result.capture.state!=='COMPLETE')process.exitCode=2;
  emit(result);return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  process.stderr.write(json({error:error.code??'SENSORTHINGS_CLI_FAILURE',message:error.message,details:error.details??{},
    operationId:error.operationId??null,currentRevision:error.currentRevision??null}));
  process.exitCode=1;
});
