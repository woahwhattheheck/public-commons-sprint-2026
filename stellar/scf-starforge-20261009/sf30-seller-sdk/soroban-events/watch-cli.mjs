#!/usr/bin/env node
// MIT. Operate the original recurring Soroban watch without a browser or HTTP host.
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openSorobanEventsWorkspace} from './engine.mjs';
import {openSorobanEventWatches} from './watch.mjs';
import {downloadSorobanSourceFile} from './source-download.mjs';
import {SorobanEventsError,requireValue} from './rpc.mjs';

const common=['workspace','connection-file','connections-file'];
const changes=['request','revision'];
const commands={
  state:[],status:['watch'],
  save:['input',...changes],configure:['watch','input',...changes],
  start:['watch',...changes],daemon:['watch'],pause:['watch',...changes],
  'catch-up':['watch','max-windows'],repair:['watch','input',...changes],
  export:['watch',...changes],
  receive:['source-directory','manifest-sha256','connection-alias','recovery-connection-alias','publication-directory',...changes],
  'source-file':['export','path','output']
};
const HELP=[
  'Soroban recurring event watches',
  '',
  'soroban-events-watch <command> --workspace ABSOLUTE_PRIVATE_DIRECTORY [options]',
  '',
  'state                         List watches, native watch revision and exports',
  'status --watch UUID           Inspect the exact watch and retained window progress',
  'save --input JSON             Save name, planId, and complete watch configuration',
  'configure --watch UUID --input JSON',
  '                              Change future windows and trusted connection selection',
  'start --watch UUID            Enable the watch, then run it in this foreground process',
  'daemon [--watch UUID]         Run already enabled watches; wait while paused',
  'pause --watch UUID            Persist PAUSED after the current source window drains',
  'catch-up --watch UUID [--max-windows N]',
  '                              Run 1–1000 finite windows, including a paused watch',
  'repair --watch UUID --input JSON',
  '                              Select original editionIds and/or recoveryConnectionAlias',
  'export --watch UUID           Retain the complete original watch source',
  'receive --source-directory ABS',
  '                              Receive the original watch in PAUSED state',
  'source-file --export SHA --path RELATIVE --output NEW_FILE',
  '                              Copy complete exact bytes of a native export file',
  '',
  'save/configure/start/pause/repair/export/receive require --request ID --revision N.',
  'This is the watch revision from state, independent of the event workspace revision.',
  'Retain the complete request; an interrupted reply is recovered by the same body.',
  '',
  'All commands accept --connection-file PRIVATE_JSON for the default RPC connection',
  'and --connections-file PRIVATE_JSON for an alias-to-native-connection object.',
  'Watches select connectionAlias and optional recoveryConnectionAlias from that map.',
  'save/configure JSON accepts publication null or the original native publication',
  'descriptor {directory,feedId?,sourceId?,label?,description?}. Local paths stay local.',
  '',
  'receive accepts --manifest-sha256 SHA, --connection-alias ALIAS,',
  '--recovery-connection-alias ALIAS and --publication-directory ABS.',
  'Rebind paths and credentials to the receiving host; native source identities persist.',
  '',
  'start and daemon own this workspace until SIGINT/SIGTERM drains their native runner.',
  'After stopping the foreground process, use pause to change its persisted desired state.',
  'Merchant or the native browser can start and pause watches inside their shared host.'
].join('\n');
const saveKeys=['name','planId','planVersion','startLedger','endLedger','windowLedgers',
  'pollIntervalMs','connectionAlias','recoveryConnectionAlias','publication'];
const configureKeys=saveKeys.filter(key=>!['planId','startLedger'].includes(key));
function args(argv){
  const [command='help',...rest]=argv;
  if(['help','--help','-h'].includes(command)){
    requireValue(rest.length===0,'INVALID_ARGUMENT','Help takes no options.');
    return {command:'help',options:{}};
  }
  requireValue(Object.hasOwn(commands,command),'INVALID_COMMAND','Choose a declared watch command.');
  const allowed=[...common,...commands[command]],options=Object.create(null);
  for(let index=0;index<rest.length;index+=2){
    const key=rest[index],value=rest[index+1];
    requireValue(typeof key==='string'&&/^--[a-z][a-z-]*$/.test(key)&&typeof value==='string'&&
      value.length>0&&!value.startsWith('--')&&allowed.includes(key.slice(2))&&!Object.hasOwn(options,key.slice(2)),
      'INVALID_ARGUMENT','Use each declared --name VALUE option once.');
    options[key.slice(2)]=value;
  }
  return {command,options};
}
async function jsonFile(path,allowed,required=[]){
  const file=resolve(path),handle=await fs.open(file,'r');
  let value;
  try{
    const stat=await handle.stat();
    requireValue(stat.isFile()&&stat.size>0&&stat.size<=2*1024*1024,'INVALID_ARGUMENT','Use a complete JSON object within 2 MiB.');
    value=JSON.parse(await handle.readFile('utf8'));
  }finally{await handle.close();}
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_ARGUMENT','Use one complete JSON object.');
  if(allowed)requireValue(Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
    'INVALID_ARGUMENT','The input file must contain the declared command fields.');
  return value;
}
export async function runSorobanEventsWatchCLI(argv=process.argv.slice(2),
  io={write:value=>process.stdout.write(value)}){
  const {command,options}=args([...argv]),write=io.write??(value=>process.stdout.write(value));
  if(command==='help'){write(HELP+'\n');return;}
  const required=key=>{
    requireValue(typeof options[key]==='string'&&options[key].length>0,'INVALID_ARGUMENT','--'+key+' is required.');
    return options[key];
  };
  const integer=(key,minimum=0)=>{
    const value=required(key);
    requireValue(/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>=minimum,
      'INVALID_ARGUMENT','--'+key+' must be an exact integer.');
    return Number(value);
  };
  const change=()=>({requestId:required('request'),expectedRevision:integer('revision')});
  const selected=()=>({watchId:required('watch')});
  const optional=(key,name)=>options[key]===undefined?{}:{[name]:options[key]};
  const connection=options['connection-file']?await jsonFile(options['connection-file']):undefined;
  const connections=options['connections-file']?await jsonFile(options['connections-file']):undefined;
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Soroban watch runner stopped.'));
  const externalStop=()=>controller.abort(io.signal.reason);
  if(io.signal?.aborted)externalStop();else io.signal?.addEventListener('abort',externalStop,{once:true});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let workspace,watches;
  try{
    controller.signal.throwIfAborted();
    workspace=await openSorobanEventsWorkspace({directory:resolve(required('workspace')),
      ...(connection?{connection}:{}),...(connections?{connections}:{})});
    watches=await openSorobanEventWatches({workspace});
    let result;
    if(command==='state')result=await watches.describe();
    else if(command==='status')result=await watches.watchStatus(selected());
    else if(command==='save')result=await watches.watchSave({
      ...await jsonFile(required('input'),saveKeys,['name','planId']),...change()});
    else if(command==='configure')result=await watches.watchConfigure({
      ...await jsonFile(required('input'),configureKeys),...selected(),...change()});
    else if(command==='pause')result=await watches.watchPause({...selected(),...change()});
    else if(command==='repair')result=await watches.watchRepair({
      ...await jsonFile(required('input'),['editionIds','recoveryConnectionAlias']),...selected(),...change()});
    else if(command==='export')result=await watches.watchExport({...selected(),...change()});
    else if(command==='receive')result=await watches.watchReceive({
      ...change(),sourceDirectory:resolve(required('source-directory')),
      ...optional('manifest-sha256','expectedManifestSha256'),...optional('connection-alias','connectionAlias'),
      ...optional('recovery-connection-alias','recoveryConnectionAlias'),
      ...(options['publication-directory']===undefined?{}:{publicationDirectory:resolve(options['publication-directory'])})});
    else if(command==='source-file')result=await downloadSorobanSourceFile({source:watches,
      exportId:required('export'),path:required('path'),output:required('output'),signal:controller.signal});
    else if(command==='catch-up')result=await watches.watchRun({
      ...selected(),signal:controller.signal,...(options['max-windows']===undefined?{}:{maxWindows:integer('max-windows',1)})});
    else if(command==='start'||command==='daemon'){
      const selection=command==='start'?selected():optional('watch','watchId');
      const initial=command==='start'?await watches.watchStart({...selection,...change()}):await watches.describe();
      write(JSON.stringify({...initial,runner:{state:'RUNNING',mode:'foreground',...selection}})+'\n');
      try{await watches.run({...selection,signal:controller.signal});}
      catch(error){if(!controller.signal.aborted)throw error;}
      result={...await watches.describe(),runner:{state:'DRAINED',...selection}};
    }else throw new SorobanEventsError('INVALID_COMMAND','Unknown watch command.');
    write(JSON.stringify(result,null,2)+'\n');
    return result;
  }finally{
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    io.signal?.removeEventListener('abort',externalStop);
    try{await watches?.close();}finally{await workspace?.close();}
  }
}
export const main=runSorobanEventsWatchCLI;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runSorobanEventsWatchCLI().catch(error=>{
    process.stderr.write(JSON.stringify({error:{code:error.code??'WATCH_ERROR',message:error.message,details:error.details??{}}})+'\n');
    process.exitCode=1;
  });
}
