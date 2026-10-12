#!/usr/bin/env node
// MIT. Saved event operations and complete source transfers through Merchant.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fileBytes} from '../host-files.mjs';
import {openSorobanEventsMerchantClient,initializeSorobanEventsMerchant,
  downloadSorobanEventsExport,inspectSorobanEventsExport,reopenSorobanEventsExport,
  readSorobanEventsJson,receiveSorobanEventsExport,sorobanEventsDefinitions} from './client.mjs';
import {MAX_REQUEST_BYTES,need,plain,exact,decode} from './contracts.mjs';

const remoteFlags=['url','token-env'],selectedFlags=['workspace','export-id','manifest-sha256'],
  changeFlags=['request-id','expected-revision'];
const commands={
  tools:[],init:['directory','connection','name'],
  call:[...remoteFlags,'action','args'],
  workspaces:remoteFlags,
  open:[...remoteFlags,'workspace'],close:[...remoteFlags,'workspace'],state:[...remoteFlags,'workspace'],
  plan:[...remoteFlags,'workspace',...changeFlags,'args'],
  capture:[...remoteFlags,'workspace',...changeFlags,'plan-id'],
  resume:[...remoteFlags,'workspace',...changeFlags,'capture-id'],
  status:[...remoteFlags,'workspace','capture-id'],
  events:[...remoteFlags,'workspace','capture-id','after','limit','contract-id','type'],
  edition:[...remoteFlags,'workspace',...changeFlags,'capture-id','name'],
  'show-edition':[...remoteFlags,'workspace','edition-id'],
  export:[...remoteFlags,'workspace',...changeFlags,'edition-id'],
  'publisher-source':[...remoteFlags,'workspace','edition-id'],
  inspect:[...remoteFlags,...selectedFlags],
  json:[...remoteFlags,...selectedFlags,'file','pointer','offset','limit'],
  value:[...remoteFlags,...selectedFlags,'file'],
  download:[...remoteFlags,...selectedFlags,'directory','chunk-size'],
  reopen:[...selectedFlags,'directory'],
  receive:[...remoteFlags,...selectedFlags,'receiver',...changeFlags]
};
const help=[
  'starforge-merchant merchant-soroban-events tools',
  'starforge-merchant merchant-soroban-events init --directory ABS --connection ABS [--name NAME]',
  'starforge-merchant merchant-soroban-events workspaces --url MCP_URL [--token-env ENV]',
  'starforge-merchant merchant-soroban-events open|close|state --url MCP_URL --workspace ALIAS',
  'starforge-merchant merchant-soroban-events plan --url MCP_URL --workspace ALIAS --request-id ID --expected-revision N --args PLAN_JSON',
  'starforge-merchant merchant-soroban-events capture --url MCP_URL --workspace ALIAS --request-id ID --expected-revision N --plan-id UUID',
  'starforge-merchant merchant-soroban-events resume --url MCP_URL --workspace ALIAS --request-id ID --expected-revision N --capture-id UUID',
  'starforge-merchant merchant-soroban-events status --url MCP_URL --workspace ALIAS --capture-id UUID',
  'starforge-merchant merchant-soroban-events events --url MCP_URL --workspace ALIAS --capture-id UUID [--after CURSOR] [--limit N] [--contract-id ID] [--type TYPE]',
  'starforge-merchant merchant-soroban-events edition --url MCP_URL --workspace ALIAS --request-id ID --expected-revision N --capture-id UUID --name NAME',
  'starforge-merchant merchant-soroban-events show-edition|publisher-source --url MCP_URL --workspace ALIAS --edition-id UUID',
  'starforge-merchant merchant-soroban-events export --url MCP_URL --workspace ALIAS --request-id ID --expected-revision N --edition-id UUID',
  'starforge-merchant merchant-soroban-events inspect --url MCP_URL --workspace ALIAS --export-id SHA [--manifest-sha256 SHA]',
  'starforge-merchant merchant-soroban-events json --url MCP_URL --workspace ALIAS --export-id SHA --file PATH [--pointer POINTER] [--offset N] [--limit N] [--manifest-sha256 SHA]',
  'starforge-merchant merchant-soroban-events value --url MCP_URL --workspace ALIAS --export-id SHA --file PATH [--manifest-sha256 SHA]',
  'starforge-merchant merchant-soroban-events download --url MCP_URL --workspace ALIAS --export-id SHA --directory ABS [--manifest-sha256 SHA] [--chunk-size N]',
  'starforge-merchant merchant-soroban-events reopen --workspace ALIAS --export-id SHA --directory ABS [--manifest-sha256 SHA]',
  'starforge-merchant merchant-soroban-events receive --url MCP_URL --workspace ALIAS --export-id SHA --receiver ALIAS --request-id ID --expected-revision N [--manifest-sha256 SHA]',
  'starforge-merchant merchant-soroban-events call --url MCP_URL --action ACTION --args ARGS_JSON',
  '',
  'Every remote command accepts --token-env; its default is MCP_ACCESS_TOKEN.',
  'Open the original workspace once on the Merchant host before its other operations.',
  'Retain the same mutation request ID, expected revision and arguments after a lost reply.',
  'Resume uses the original capture ID and retained cursor. Read state for the current revision.',
  'receive expected-revision belongs to the configured receiving workspace.',
  'json browses a value; value reads every original JSON byte up to 128 MiB.',
  'download retains all native files and resumes in the same private directory.',
  'reopen verifies the complete local export without a remote connection.',
  'Only a host connection file selects RPC endpoints, original directories and receiver aliases.'
].join('\n');

export async function main(argv=process.argv.slice(2),
  {environment=process.env,signal,write=value=>process.stdout.write(value)}={}){
  const [command,...rest]=argv;
  if(!command||command==='help'||command==='--help'){
    need(!rest.length,'SOROBAN_EVENTS_CLI_INPUT','Help takes no options.');
    write(help+'\n');return;
  }
  const allowed=commands[command];
  need(allowed,'SOROBAN_EVENTS_CLI_INPUT','Choose a declared merchant-soroban-events command.');
  const flags=Object.create(null);
  for(let index=0;index<rest.length;index+=2){
    const key=rest[index],value=rest[index+1];
    need(/^--[a-z][a-z-]*$/.test(key??'')&&typeof value==='string'&&value.length>0&&
      !value.startsWith('--')&&!Object.hasOwn(flags,key)&&allowed.includes(key.slice(2)),
      'SOROBAN_EVENTS_CLI_INPUT','Use one value after each declared option.');
    flags[key]=value;
  }
  const required=key=>{
    const value=flags['--'+key];
    need(typeof value==='string'&&value.length>0,'SOROBAN_EVENTS_CLI_INPUT','Missing --'+key+'.');
    return value;
  };
  const integer=(key,minimum=0)=>{
    const value=required(key);
    need(/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>=minimum,
      'SOROBAN_EVENTS_CLI_INPUT','Use an exact integer for --'+key+'.');
    return Number(value);
  };
  const optional=(key,name=key)=>flags['--'+key]===undefined?{}:{[name]:flags['--'+key]};
  const remote=()=>({url:required('url'),tokenEnv:flags['--token-env']??'MCP_ACCESS_TOKEN',environment,signal});
  const workspace=()=>({workspace:required('workspace')});
  const change=()=>({requestId:required('request-id'),expectedRevision:integer('expected-revision')});
  const selected=()=>({...workspace(),exportId:required('export-id'),...optional('manifest-sha256','expectedManifestSha256')});
  const argsFile=async()=>{
    const value=decode(await fileBytes(resolve(required('args')),MAX_REQUEST_BYTES));
    need(plain(value),'SOROBAN_EVENTS_CLI_INPUT','Use one complete JSON argument object.');
    return value;
  };
  const invoke=async(action,args)=>{const client=await openSorobanEventsMerchantClient(remote());return client.call(action,args);};
  let result;
  if(command==='tools')result={tools:sorobanEventsDefinitions};
  else if(command==='init')result=await initializeSorobanEventsMerchant({
    directory:resolve(required('directory')),connection:resolve(required('connection')),...optional('name')});
  else if(command==='call')result=await invoke(required('action'),await argsFile());
  else if(command==='workspaces')result=await invoke('workspaces',{});
  else if(['open','close','state'].includes(command))result=await invoke(command,workspace());
  else if(command==='plan'){
    const input=await argsFile();
    exact(input,['planId','name','startLedger','endLedger','filters','pageSize'],['name']);
    result=await invoke('plan_save',{...input,...workspace(),...change()});
  }else if(command==='capture')result=await invoke('capture_start',{...workspace(),...change(),planId:required('plan-id')});
  else if(command==='resume')result=await invoke('capture_resume',{...workspace(),...change(),captureId:required('capture-id')});
  else if(command==='status')result=await invoke('capture_status',{...workspace(),captureId:required('capture-id')});
  else if(command==='events')result=await invoke('events',{...workspace(),captureId:required('capture-id'),
    ...optional('after'),...optional('contract-id','contractId'),...optional('type'),
    ...(flags['--limit']===undefined?{}:{limit:integer('limit',1)})});
  else if(command==='edition')result=await invoke('edition_create',{
    ...workspace(),...change(),captureId:required('capture-id'),name:required('name')});
  else if(command==='show-edition'||command==='publisher-source')result=await invoke(
    command==='show-edition'?'edition':'publisher_source',{...workspace(),editionId:required('edition-id')});
  else if(command==='export')result=await invoke('source_export',{...workspace(),...change(),editionId:required('edition-id')});
  else if(command==='inspect')result=await inspectSorobanEventsExport({...remote(),...selected()});
  else if(command==='value')result=await readSorobanEventsJson({...remote(),...selected(),file:required('file')});
  else if(command==='json'){
    const client=await openSorobanEventsMerchantClient(remote()),selection=selected(),
      manifest=await client.inspectExport(selection);
    result=await client.json({...selection,expectedManifestSha256:manifest.manifestSha256,file:required('file'),
      ...optional('pointer'),...(flags['--offset']===undefined?{}:{offset:integer('offset')}),
      ...(flags['--limit']===undefined?{}:{limit:integer('limit',1)})});
  }else if(command==='download')result=await downloadSorobanEventsExport({
    ...remote(),...selected(),directory:resolve(required('directory')),
    ...(flags['--chunk-size']===undefined?{}:{chunkSize:integer('chunk-size',1)})});
  else if(command==='reopen')result=await reopenSorobanEventsExport({...selected(),directory:resolve(required('directory')),signal});
  else if(command==='receive')result=await receiveSorobanEventsExport({
    ...remote(),...selected(),...change(),receiver:required('receiver')});
  write(JSON.stringify(result,null,2)+'\n');
  return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Soroban event command cancelled.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await main(undefined,{signal:controller.signal});}
  catch(error){
    process.stderr.write(JSON.stringify({error:{code:error.code??error.name,message:error.message,
      ...(error.requestId?{requestId:error.requestId}:{}),...(error.workspace?{workspace:error.workspace}:{}),
      ...(error.action?{action:error.action}:{})}})+'\n');
    process.exitCode=1;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
