#!/usr/bin/env node
// MIT. Complete original Indexer query, capture, service and receiving operator.
import {promises as fs,createReadStream} from 'node:fs';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openStellarIndexerOperator,readPrivateJSON,need,plain,publicOperatorError} from './operator.mjs';
import {downloadSorobanSourceFile} from '../soroban-events/source-download.mjs';

export const STELLAR_INDEXER_READY_SCHEMA='stellar-forge.stellar-indexer-workspace-startup.v1';
const common=['workspace','installation-directory','connections-file','event-workspace','event-connection-file','event-connections-file','event-publications-file'];
const changes=['request','revision'];
const commands={
  open:['port','startup-format','expected-workspace-id'],
  state:[],methods:[],
  'query-save':['input',...changes],
  'query-configure':['query','input',...changes],
  'capture-start':['query','query-version','max-pages',...changes],
  'capture-run':['capture','max-pages'],
  'capture-pause':['capture',...changes],
  'capture-resume':['capture','connection-alias','max-pages',...changes],
  'capture-status':['capture'],edition:['edition'],
  rows:['capture','edition','offset','limit'],
  compare:['before','after','offset','limit'],
  'source-export':['capture','edition',...changes],
  'source-receive':['source-directory','manifest-sha256','connection-alias',...changes],
  'delivery-export':['input',...changes],
  'delivery-receive':['source-directory','manifest-sha256','connection-alias','watch-connections-file',...changes],
  'source-file':['source','export','path','output'],
  'source-folder':['source','input','output'],
  'event-plan':['input',...changes],
  'event-capture-start':['input',...changes],
  'event-capture-resume':['capture','connection-alias',...changes],
  'event-capture-status':['capture'],
  'event-edition':['capture','name',...changes],
  'event-export':['edition',...changes],
  'event-receive':['source-directory','manifest-sha256',...changes],
  'watch-save':['input',...changes],
  'watch-configure':['watch','input',...changes],
  'watch-status':['watch'],
  'watch-start':['watch',...changes],
  'watch-daemon':['watch'],
  'watch-pause':['watch',...changes],
  'watch-catch-up':['watch','max-windows'],
  'watch-repair':['watch','input',...changes],
  'watch-export':['watch',...changes],
  'watch-receive':['source-directory','manifest-sha256','connection-alias','recovery-connection-alias','publication-directory',...changes]
};
const HELP=[
  'Stellar Indexer client workspace',
  '',
  'stellar-indexer <command> --workspace PRIVATE_ROOT [options]',
  '',
  'open                        Open the industrial browser operator',
  'state                       Original Indexer, event and watch state',
  'methods                     All original native SDK methods and complete compositions',
  'query-save --input JSON     Save original method, ordered args, SDK options and pagination',
  'query-configure --query UUID --input JSON',
  '                            Pin a new query version for later captures',
  'capture-start --query UUID [--query-version N] [--max-pages N]',
  'capture-run --capture UUID [--max-pages N]',
  'capture-pause --capture UUID',
  'capture-resume --capture UUID [--connection-alias ALIAS] [--max-pages N]',
  'capture-status --capture UUID',
  'edition --edition UUID',
  'rows (--capture UUID | --edition UUID) [--offset N] [--limit N]',
  'compare --before UUID --after UUID [--offset N] [--limit N]',
  'source-export (--capture UUID | --edition UUID)',
  'source-receive --source-directory ABS [--manifest-sha256 SHA] [--connection-alias ALIAS]',
  'delivery-export --input JSON',
  '                            Select editionIds, captureIds and original watchIds',
  'delivery-receive --source-directory ABS [--watch-connections-file PRIVATE_JSON]',
  '                            Receive SDK source and original watches together',
  'source-file --export SHA --path RELATIVE --output NEW_FILE [--source indexer|events|watches]',
  'source-folder --input EXPORT_JSON --output DIRECTORY [--source indexer|events|watches]',
  '                            Copy every original file, verify SHA/count, resume exact files',
  '',
  'event-plan --input JSON',
  'event-capture-start --input JSON',
  'event-capture-resume --capture UUID [--connection-alias ALIAS]',
  'event-capture-status --capture UUID',
  'event-edition --capture UUID --name NAME',
  'event-export --edition UUID',
  'event-receive --source-directory ABS [--manifest-sha256 SHA]',
  '',
  'watch-save --input JSON',
  'watch-configure --watch UUID --input JSON',
  'watch-status --watch UUID',
  'watch-start --watch UUID     Persist RUNNING and run in this foreground process',
  'watch-daemon [--watch UUID]  Run already enabled watches; wait while paused',
  'watch-pause --watch UUID     Pause after the active native window drains',
  'watch-catch-up --watch UUID [--max-windows 1..1000]',
  'watch-repair --watch UUID --input JSON',
  'watch-export --watch UUID',
  'watch-receive --source-directory ABS [--manifest-sha256 SHA]',
  '',
  'Mutations require --request ID --revision N; keep the exact body for interrupted-reply recovery.',
  'Use state.indexer.revision for queries/captures/delivery, state.events.revision for native',
  'event plans/captures/editions, and state.watches.revision for watch controls and receiving.',
  'capture-start/resume print the retained capture before awaiting the selected native pages.',
  'SIGINT/SIGTERM drains the original operation and preserves its source/checkpoint.',
  '',
  'All commands accept --installation-directory EXISTING_PROJECT for the original installed SDK,',
  '--connections-file PRIVATE_JSON for original SDK token aliases,',
  '--event-connection-file PRIVATE_JSON for the default Stellar RPC connection,',
  '--event-connections-file PRIVATE_JSON for additional trusted RPC aliases and',
  '--event-publications-file PRIVATE_JSON for trusted publication destinations.',
  'Watch save/configure JSON accepts publicationAlias, or the original private publication descriptor.',
  'A received workspace can be inspected without a service token.',
  'open accepts --port 0..65535, --startup-format json and --expected-workspace-id UUID.',
  'watch-receive accepts --connection-alias, --recovery-connection-alias and --publication-directory.',
  'Indexer files live under PRIVATE_ROOT/indexer; original event files live under PRIVATE_ROOT/events.'
].join('\n');

function parse(argv){
  const [command='help',...rest]=argv;
  if(['help','--help','-h'].includes(command)){need(rest.length===0,'INVALID_ARGUMENT','Help takes no options.');return {command:'help',options:{}};}
  need(Object.hasOwn(commands,command),'INVALID_COMMAND','Choose a declared Indexer command.');
  const options=Object.create(null),allowed=[...common,...commands[command]];
  for(let i=0;i<rest.length;i+=2){
    const key=rest[i],value=rest[i+1];
    need(typeof key==='string'&&/^--[a-z][a-z-]*$/.test(key)&&typeof value==='string'&&value.length>0&&
      !value.startsWith('--')&&allowed.includes(key.slice(2))&&!Object.hasOwn(options,key.slice(2)),
      'INVALID_ARGUMENT','Use each declared --name VALUE option once.');
    options[key.slice(2)]=value;
  }
  return {command,options};
}
async function input(file){
  const value=await readPrivateJSON(file);
  need(plain(value),'INVALID_ARGUMENT','Use a complete JSON object.');
  need(!['requestId','expectedRevision'].some(key=>Object.hasOwn(value,key)),
    'INVALID_ARGUMENT','Set request and revision through their declared CLI options.');
  return value;
}
async function fileHash(file){
  const stat=await fs.lstat(file);
  need(stat.isFile()&&!stat.isSymbolicLink(),'SOURCE_CONFLICT','The selected output is not a regular retained file.');
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(file)){hash.update(chunk);bytes+=chunk.length;}
  return {bytes,sha256:hash.digest('hex')};
}
function sourcePath(base,path){
  need(typeof path==='string'&&path.length>0&&!path.includes('\\')&&!path.includes('\0')&&
    !path.startsWith('/')&&path.split('/').every(piece=>piece&&piece!=='.'&&piece!=='..'),
    'INVALID_ARGUMENT','The manifest contains an invalid relative source path.');
  const target=resolve(base,path);
  need(relative(base,target)!==''&&!relative(base,target).startsWith('..'+sep),
    'INVALID_ARGUMENT','Keep every source file inside the selected receiving folder.');
  return target;
}
/** Uses the original native range reader and original streaming file transport. */
export async function copyStellarIndexerSourceFolder({source,exported,output,signal,onProgress=()=>{}}){
  exported=exported?.export??exported;
  need(plain(exported)&&plain(exported.manifest)&&Array.isArray(exported.manifest.files),
    'INVALID_ARGUMENT','Select the complete original native export JSON.');
  const manifestBytes=Buffer.from(JSON.stringify(exported.manifest,null,2)+'\n');
  need(createHash('sha256').update(manifestBytes).digest('hex')===exported.manifestSha256&&
    exported.id===exported.manifest.exportId,'SOURCE_CONFLICT','The original export manifest identity changed.');
  const directory=resolve(output);
  const parent=dirname(directory);
  need(await fs.realpath(parent)===parent,'INVALID_ARGUMENT','Select an existing canonical parent for the receiving folder.');
  try{await fs.mkdir(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const held=await fs.lstat(directory);
  need(held.isDirectory()&&!held.isSymbolicLink()&&await fs.realpath(directory)===directory,
    'INVALID_ARGUMENT','Select a real receiving directory.');
  const seen=new Set();let copied=0,bytes=0;
  for(const descriptor of exported.manifest.files){
    signal?.throwIfAborted();
    need(plain(descriptor)&&Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>=0&&
      /^[a-f0-9]{64}$/.test(descriptor.sha256??'')&&!seen.has(descriptor.path)&&descriptor.path!=='manifest.json',
      'SOURCE_CONFLICT','The original manifest has an invalid or repeated file.');
    seen.add(descriptor.path);const target=sourcePath(directory,descriptor.path);
    let parentPath=directory;
    for(const piece of descriptor.path.split('/').slice(0,-1)){
      parentPath=join(parentPath,piece);
      try{await fs.mkdir(parentPath,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
      const parentInfo=await fs.lstat(parentPath);
      need(parentInfo.isDirectory()&&!parentInfo.isSymbolicLink()&&await fs.realpath(parentPath)===parentPath,
        'SOURCE_CONFLICT','A receiving path is redirected.');
    }
    let observed;try{observed=await fileHash(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(observed)need(observed.bytes===descriptor.bytes&&observed.sha256===descriptor.sha256,
      'SOURCE_CONFLICT','The receiving folder contains a different '+descriptor.path+'.');
    else{
      const result=await downloadSorobanSourceFile({source,exportId:exported.id,path:descriptor.path,output:target,signal});
      need(result.bytes===descriptor.bytes&&result.sha256===descriptor.sha256,'SOURCE_CONFLICT','A copied file differs from its original manifest.');
    }
    copied++;bytes+=descriptor.bytes;onProgress({path:descriptor.path,fileCount:copied,totalFiles:exported.manifest.files.length,bytes});
  }
  need(copied===exported.manifest.fileCount&&bytes===exported.manifest.bytes,'SOURCE_CONFLICT','The complete source count differs from its original manifest.');
  const manifestPath=join(directory,'manifest.json');
  try{const handle=await fs.open(manifestPath,'wx',0o600);try{await handle.writeFile(manifestBytes);await handle.sync();}finally{await handle.close();}}
  catch(error){if(error.code!=='EEXIST')throw error;const existing=await fileHash(manifestPath);
    need(existing.bytes===manifestBytes.length&&existing.sha256===exported.manifestSha256,'SOURCE_CONFLICT','The destination belongs to another original export.');}
  return {directory,exportId:exported.id,manifestSha256:exported.manifestSha256,fileCount:copied,bytes};
}
export async function runStellarIndexerCLI(argv=process.argv.slice(2),io={}){
  const {command,options}=parse([...argv]),write=io.write??(value=>process.stdout.write(value));
  if(command==='help'){write(HELP+'\n');return;}
  const required=key=>{need(options[key]!==undefined,'INVALID_ARGUMENT','--'+key+' is required.');return options[key];};
  const number=(key,min=0)=>{
    const value=required(key);need(/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>=min,
      'INVALID_ARGUMENT','--'+key+' must be an exact integer.');return Number(value);
  };
  const optional=(key,name=key)=>options[key]===undefined?{}:{[name]:options[key]};
  const optionalNumber=(key,name=key,min=0)=>options[key]===undefined?{}:{[name]:number(key,min)};
  const change=()=>({requestId:required('request'),expectedRevision:number('revision')});
  const capture=()=>({captureId:required('capture')});
  const watch=()=>({watchId:required('watch')});
  const sourceSelection=()=>{
    need(Boolean(options.capture)!==Boolean(options.edition),'INVALID_ARGUMENT','Select exactly one capture or edition.');
    return options.capture?capture():{editionId:required('edition')};
  };
  const receive=()=>({...change(),sourceDirectory:resolve(required('source-directory')),
    ...optional('manifest-sha256','expectedManifestSha256')});
  const hostOptions={directory:resolve(required('workspace')),
    ...(options['installation-directory']?{installationDirectory:resolve(options['installation-directory'])}:{}),
    ...(options['event-workspace']?{eventDirectory:resolve(options['event-workspace'])}:{}),
    ...optional('connections-file','connectionsFile'),...optional('event-connection-file','eventConnectionFile'),
    ...optional('event-connections-file','eventConnectionsFile'),...optional('event-publications-file','eventPublicationsFile'),
    ...optional('expected-workspace-id','expectedWorkspaceId')};
  const controller=new AbortController(),stop=()=>controller.abort(new Error('The original Indexer operator is stopping.'));
  const external=()=>controller.abort(io.signal.reason);
  if(io.signal?.aborted)external();else io.signal?.addEventListener('abort',external,{once:true});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let host,server;
  const print=value=>write(JSON.stringify(value,null,2)+'\n');
  try{
    controller.signal.throwIfAborted();
    if(command==='open'){
      need(options['startup-format']===undefined||options['startup-format']==='json','INVALID_ARGUMENT','Use --startup-format json.');
      const {startStellarIndexerServer}=await import('./server.mjs');
      server=await startStellarIndexerServer({...hostOptions,...optionalNumber('port')});host=server.operator;
      const state=await host.workspace.describe();
      const startup={schema:STELLAR_INDEXER_READY_SCHEMA,status:'STELLAR_INDEXER_READY',
        directory:host.directory,indexerDirectory:host.indexerDirectory,eventDirectory:host.eventDirectory,
        workspaceId:state.workspaceId,installationDirectory:options['installation-directory']?resolve(options['installation-directory']):null,
        connectionsFile:options['connections-file']?resolve(options['connections-file']):null,
        eventConnectionFile:options['event-connection-file']?resolve(options['event-connection-file']):null,
        eventConnectionsFile:options['event-connections-file']?resolve(options['event-connections-file']):null,
        eventPublicationsFile:options['event-publications-file']?resolve(options['event-publications-file']):null,
        sourceDirectory:dirname(fileURLToPath(import.meta.url)),pid:process.pid,url:server.url};
      if(options['startup-format']==='json')write(JSON.stringify(startup)+'\n');
      else write('Stellar Indexer workspace\n'+server.url+'\n');
      if(!controller.signal.aborted)await new Promise(accept=>controller.signal.addEventListener('abort',accept,{once:true}));
      return startup;
    }
    host=await openStellarIndexerOperator(hostOptions);const ws=host.workspace,events=host.events,watches=host.watches;
    const watchInput=async()=>{
      const value=await input(required('input'));
      if(Object.hasOwn(value,'publicationAlias')){
        need(value.publication===undefined,'INVALID_ARGUMENT','Select the publication destination once.');
        value.publication=host.publication(value.publicationAlias);delete value.publicationAlias;
      }
      return value;
    };
    let result;
    switch(command){
      case 'state':result=await host.describe();break;
      case 'methods':result=(await ws.describe()).methods;break;
      case 'query-save':result=await ws.querySave({...await input(required('input')),...change()});break;
      case 'query-configure':result=await ws.queryConfigure({...await input(required('input')),queryId:required('query'),...change()});break;
      case 'capture-start':
      case 'capture-resume':{
        const first=command==='capture-start'?await ws.captureStart({...change(),queryId:required('query'),...optionalNumber('query-version','queryVersion',1)}):
          await ws.captureResume({...change(),...capture(),...optional('connection-alias','connectionAlias')});
        write(JSON.stringify(first)+'\n');
        result=await ws.captureRun({captureId:first.capture.id,signal:controller.signal,...optionalNumber('max-pages','maxPages',1)});break;
      }
      case 'capture-run':result=await ws.captureRun({...capture(),signal:controller.signal,...optionalNumber('max-pages','maxPages',1)});break;
      case 'capture-pause':result=await ws.capturePause({...change(),...capture()});break;
      case 'capture-status':result=await ws.status(capture());break;
      case 'edition':result=await ws.edition({editionId:required('edition')});break;
      case 'rows':result=await ws.rows({...sourceSelection(),...optionalNumber('offset'),...optionalNumber('limit','limit',1)});break;
      case 'compare':result=await ws.compare({beforeEditionId:required('before'),afterEditionId:required('after'),
        ...optionalNumber('offset'),...optionalNumber('limit','limit',1)});break;
      case 'source-export':result=await ws.sourceExport({...change(),...sourceSelection()});break;
      case 'source-receive':result=await ws.sourceReceive({...receive(),...optional('connection-alias','connectionAlias')});break;
      case 'delivery-export':result=await ws.deliveryExport({...await input(required('input')),...change()});break;
      case 'delivery-receive':result=await ws.deliveryReceive({...receive(),...optional('connection-alias','connectionAlias'),
        ...(options['watch-connections-file']?{watchConnections:await readPrivateJSON(options['watch-connections-file'])}:{})});break;
      case 'source-file':
      case 'source-folder':{
        const sources={indexer:ws,events,watches},selected=options.source??'indexer';
        need(Object.hasOwn(sources,selected),'INVALID_ARGUMENT','Select source indexer, events or watches.');
        result=command==='source-file'?await downloadSorobanSourceFile({source:sources[selected],exportId:required('export'),
          path:required('path'),output:required('output'),signal:controller.signal}):
          await copyStellarIndexerSourceFolder({source:sources[selected],exported:await readPrivateJSON(required('input'),{maximumBytes:64*1024*1024}),
            output:required('output'),signal:controller.signal});break;
      }
      case 'event-plan':result=await events.planSave({...await input(required('input')),...change()});break;
      case 'event-capture-start':result=await events.captureStart({...await input(required('input')),...change(),signal:controller.signal});break;
      case 'event-capture-resume':result=await events.captureResume({...change(),...capture(),...optional('connection-alias','connectionAlias'),signal:controller.signal});break;
      case 'event-capture-status':result=await events.captureStatus(capture());break;
      case 'event-edition':result=await events.editionCreate({...change(),...capture(),name:required('name')});break;
      case 'event-export':result=await events.sourceExport({...change(),editionId:required('edition')});break;
      case 'event-receive':result=await events.sourceReceive(receive());break;
      case 'watch-save':result=await watches.watchSave({...await watchInput(),...change()});break;
      case 'watch-configure':result=await watches.watchConfigure({...await watchInput(),...watch(),...change()});break;
      case 'watch-status':result=await watches.watchStatus(watch());break;
      case 'watch-pause':result=await watches.watchPause({...watch(),...change()});break;
      case 'watch-repair':result=await watches.watchRepair({...await input(required('input')),...watch(),...change()});break;
      case 'watch-catch-up':result=await watches.watchRun({...watch(),signal:controller.signal,...optionalNumber('max-windows','maxWindows',1)});break;
      case 'watch-export':result=await watches.watchExport({...watch(),...change()});break;
      case 'watch-receive':result=await watches.watchReceive({...receive(),...optional('connection-alias','connectionAlias'),
        ...optional('recovery-connection-alias','recoveryConnectionAlias'),
        ...(options['publication-directory']?{publicationDirectory:resolve(options['publication-directory'])}:{})});break;
      case 'watch-start':
      case 'watch-daemon':{
        const selected=command==='watch-start'?watch():optional('watch','watchId');
        const first=command==='watch-start'?await watches.watchStart({...selected,...change()}):await watches.describe();
        write(JSON.stringify({...first,runner:{state:'RUNNING',mode:'foreground',...selected}})+'\n');
        try{await watches.run({...selected,signal:controller.signal});}catch(error){if(!controller.signal.aborted)throw error;}
        result={...await watches.describe(),runner:{state:'DRAINED',...selected}};break;
      }
    }
    print(result);return result;
  }finally{
    process.off('SIGINT',stop);process.off('SIGTERM',stop);io.signal?.removeEventListener('abort',external);
    if(server)await server.close();else if(host)await host.close();
  }
}
export const main=runStellarIndexerCLI;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runStellarIndexerCLI().catch(error=>{process.stderr.write(JSON.stringify({error:publicOperatorError(error)})+'\n');process.exitCode=1;});
}
