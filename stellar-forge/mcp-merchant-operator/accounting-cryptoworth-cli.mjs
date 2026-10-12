#!/usr/bin/env node
// MIT. Prepare, execute and recover the original installed Cryptoworth operation.
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {cwCanonical,cwHash} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/cryptoworth-csv.mjs';
import {writePrivate,privateSupportDirectory} from './config.mjs';
import {downloadAccountingMaintenanceFile} from './accounting-maintenance-cli.mjs';
import {accountingCryptoworthPreview,accountingCryptoworthSaveArguments,accountingCryptoworthRollbackArguments,
  accountingCryptoworthPacketArguments,connectAccountingCryptoworthClient} from './accounting-cryptoworth-client.mjs';
import {CRYPTOWORTH_CLIENT_OPERATION_SCHEMA} from './accounting-cryptoworth-contract.mjs';
const STATE='stellar-forge.accounting-cryptoworth-operation-state.v1',PREVIEWS=new Set(['profile','plan','capture','return']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),copy=value=>structuredClone(value);
const hash=value=>cwHash(cwCanonical(value)),now=()=>new Date().toISOString();
const fail=(code,message)=>Object.assign(new Error(message),{code:'ACCOUNTING_CRYPTOWORTH_CLIENT_'+code});
function need(ok,message,code='ARGUMENTS'){if(!ok)throw fail(code,message);}
function exact(value,fields){need(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),'The original request contains undeclared fields.','REQUEST');}
function endpoint(value){
  let url;try{url=new URL(value);}catch{throw fail('CONFIGURATION','Use the existing merchant MCP endpoint.');}
  need(!url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)),
    'Use an HTTPS or loopback HTTP merchant endpoint without credentials, query or fragment.','CONFIGURATION');return url.href;
}
async function privateDirectory(path){
  path=resolve(path);await privateSupportDirectory(path);const stat=await lstat(path);
  need(await realpath(path)===path&&(!process.getuid||stat.uid===process.getuid()),'Use the original owner-controlled private directory without symlink ancestors.','PRIVATE_DIRECTORY');
  return path;
}
async function readJson(path,maximum=2*1024*1024){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const stat=await handle.stat();need(stat.isFile()&&stat.nlink===1&&stat.size<=maximum&&!(stat.mode&0o077)&&(!process.getuid||stat.uid===process.getuid()),
      'Use the complete private regular JSON file.','PRIVATE_FILE');
    const bytes=await handle.readFile();need(bytes.length<=maximum,'The private input grew beyond its original limit.','PRIVATE_FILE');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{await handle.close();}
}
async function syncDirectory(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
function operationArguments(value){
  if(PREVIEWS.has(value.kind)){
    need(value.preview?.kind===value.kind,'Select the complete preview for this operation.','REQUEST');
    return accountingCryptoworthSaveArguments(accountingCryptoworthPreview(value.preview));
  }
  if(value.kind==='rollback')return accountingCryptoworthRollbackArguments(value.arguments);
  if(value.kind==='packet')return accountingCryptoworthPacketArguments(value.inspection,value.packetOptions);
  throw fail('REQUEST','Choose profile, plan, capture, return, rollback or packet.');
}
function validateRequest(value){
  exact(value,['schema','createdAt','url','workspace','tokenEnv','kind','preview','inspection','packetOptions','arguments','sha256']);
  const {sha256,...body}=value;
  need(value.schema===CRYPTOWORTH_CLIENT_OPERATION_SCHEMA&&hash(body)===sha256&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))&&
    endpoint(value.url)===value.url&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.workspace??'')&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.tokenEnv??''),
    'The prepared operation identity or destination changed.','REQUEST');
  need(cwCanonical(operationArguments(value))===cwCanonical(value.arguments),'The saved original native arguments changed after review.','REQUEST_BINDING');return value;
}
/** Retain one complete reviewed request locally. No merchant mutation occurs here. */
export async function prepareAccountingCryptoworthOperation({directory,url,workspace,tokenEnv='MCP_ACCESS_TOKEN',kind,preview,inspection,packetOptions,arguments:args}={}){
  const input={kind,...(preview?{preview:copy(preview)}:{}),...(inspection?{inspection:copy(inspection),packetOptions:copy(packetOptions??{})}:{}),...(args?{arguments:copy(args)}:{})};
  const body={schema:CRYPTOWORTH_CLIENT_OPERATION_SCHEMA,createdAt:now(),url:endpoint(url),workspace,tokenEnv,...input,arguments:operationArguments(input)};
  const request=validateRequest({...body,sha256:hash(body)});
  directory=resolve(directory);await privateDirectory(dirname(directory));await mkdir(directory,{mode:0o700});await privateDirectory(directory);
  await writePrivate(join(directory,'request.json'),request);
  await writePrivate(join(directory,'state.json'),{schema:STATE,requestSha256:request.sha256,phase:'PREPARED',preparedAt:request.createdAt,updatedAt:now(),observation:null});
  await syncDirectory(directory);await syncDirectory(dirname(directory));return {directory,request,submitted:false};
}
async function operate(directory,fn){
  directory=await privateDirectory(directory);const lease=await acquireStateLease(directory);
  try{
    const request=validateRequest(await readJson(join(directory,'request.json'))),state=await readJson(join(directory,'state.json'),16*1024*1024);
    need(state.schema===STATE&&state.requestSha256===request.sha256,'The local operation journal belongs to another reviewed request.','STATE');
    async function checkpoint(changes){
      lease.assertHeld();Object.assign(state,changes,{updatedAt:now()});const temporary=join(directory,'state-'+randomUUID()+'.next');
      try{await writePrivate(temporary,state);lease.assertHeld();await rename(temporary,join(directory,'state.json'));await syncDirectory(directory);}
      finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }
    return await fn({directory,request,state,checkpoint});
  }finally{await lease.close();}
}
function summary(value){
  const result=copy(value);
  if(result.record){const {files,stageFiles,captures,returns,receivedPackets,...record}=result.record;result.record={...record,
    ...(files?{fileCount:files.length}:{}),...(stageFiles?{stageFileCount:stageFiles.length}:{}),...(captures?{captureCount:captures.length}:{}),
    ...(returns?{returnCount:returns.length}:{}),...(receivedPackets?{receivedPacketCount:receivedPackets.length}:{})};}
  delete result.profile;delete result.plan;delete result.comparison;return result;
}
/** Reconcile exact original identities; execute:true continues only this saved request. */
export async function runAccountingCryptoworthOperation({directory,execute=false,client:providedClient,environment=process.env,signal,timeoutMs=30000}={}){
  need(typeof execute==='boolean'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=86400000,'Choose execute explicitly and a positive request timeout.');
  return operate(directory,async({directory,request,state,checkpoint})=>{
    const client=providedClient??await connectAccountingCryptoworthClient({url:request.url,workspace:request.workspace,tokenEnv:request.tokenEnv,environment});
    need(client.workspace===request.workspace,'The provided client belongs to another configured workspace.','WORKSPACE_CHANGED');
    if(client.endpoint)need(endpoint(client.endpoint)===request.url,'The provided connection belongs to another prepared endpoint.','DESTINATION_CHANGED');
    const options={requestSignal:signal,timeoutMs};
    try{
      signal?.throwIfAborted();await client.open(options);
      const read=()=>PREVIEWS.has(request.kind)?client.reconcile(request.preview,options):
        request.kind==='rollback'?client.reconcileRollback(request.arguments,options):client.reconcilePacket(request.inspection,options);
      let observed=await read();await checkpoint({phase:observed.found?(observed.superseded?'SUPERSEDED':'COMPLETE'):observed.unresolved?'PENDING':'REVIEWED',observation:summary(observed)});
      if(observed.found||!execute)return {directory,requestSha256:request.sha256,phase:state.phase,executed:false,...observed};
      signal?.throwIfAborted();await checkpoint({phase:'SUBMITTING',submittedAt:state.submittedAt??now()});
      observed=await (PREVIEWS.has(request.kind)?client.save(request.preview,options):request.kind==='rollback'?client.rollback(request.arguments,options):
        client.receivePacket(request.inspection,request.packetOptions,options));
      await checkpoint({phase:observed.superseded?'SUPERSEDED':observed.unresolved?'PENDING':'COMPLETE',observation:summary(observed),completedAt:observed.unresolved?null:now(),error:null});
      return {directory,requestSha256:request.sha256,phase:state.phase,executed:true,...observed};
    }catch(error){
      await checkpoint({phase:state.phase==='SUBMITTING'?'OUTCOME_PENDING':state.phase,error:{code:error.code??'ERROR',message:String(error.message??error).slice(0,1200)}}).catch(()=>{});
      throw error;
    }finally{if(!providedClient)await client.disconnect();}
  });
}
export const downloadAccountingCryptoworthFile=options=>downloadAccountingMaintenanceFile(options);
const HELP='Starforge Cryptoworth accounting client\n\n'+
'  open|close|sources|status --url MCP_URL --workspace ALIAS [--token-env NAME]\n'+
'  source --url MCP_URL --workspace ALIAS --request PRIVATE_JSON\n'+
'  template|packet-inspect --url MCP_URL --workspace ALIAS --request PRIVATE_JSON --out NEW_PRIVATE_JSON\n'+
'  profile --url MCP_URL --workspace ALIAS --id ID\n'+
'  plan|rows --url MCP_URL --workspace ALIAS --plan ID [--view NAME] [--capture ID] [--offset N] [--limit N]\n'+
'  capture|return --url MCP_URL --workspace ALIAS --plan ID --id ID\n'+
'  rollback-record --url MCP_URL --workspace ALIAS --id ID\n'+
'  preview --url MCP_URL --workspace ALIAS --kind profile|plan|capture|return --request PRIVATE_JSON [--plan ID] --out NEW_PRIVATE_JSON\n'+
'  prepare --dir NEW_PRIVATE_OPERATION --url MCP_URL --workspace ALIAS --kind profile|plan|capture|return --preview PRIVATE_JSON\n'+
'  prepare ... --kind rollback --request PRIVATE_JSON\n'+
'  prepare ... --kind packet --inspection PRIVATE_JSON --actor NAME [--name NAME]\n'+
'  execute|reconcile --dir PRIVATE_OPERATION [--timeout-ms N]\n'+
'  download --url MCP_URL --workspace ALIAS --selection PRIVATE_JSON --sha256 SHA256 --out NEW_PRIVATE_FILE\n\n'+
'Host-declared cryptoworthInputs contain the original customer template, native CSV, packet and date-source files.\n'+
'Preview saves the normalized source references and native hashes. Prepare keeps one immutable request; execute and reconcile reuse its native ID.\n'+
'Use starforge merchant-accounting-workspace cryptoworth for the original direct/local browser-owner CLI.\n';
function flags(args){
  const values={};
  for(let i=0;i<args.length;i++){
    const flag=args[i];need(/^--[a-z][a-z0-9-]*$/.test(flag)&&args[i+1]!==undefined&&!args[i+1].startsWith('--')&&!Object.hasOwn(values,flag.slice(2)),'Supply each named option once with its value.');
    values[flag.slice(2)]=args[++i];
  }
  return values;
}
function numeric(value,label){if(value===undefined)return undefined;need(/^(0|[1-9]\d*)$/.test(value),'Use a nonnegative integer for '+label+'.');const number=Number(value);need(Number.isSafeInteger(number),'Use an exact integer for '+label+'.');return number;}
async function output(value,path){
  if(path){path=resolve(path);await privateDirectory(dirname(path));await writePrivate(path,value);await syncDirectory(dirname(path));}
  process.stdout.write(JSON.stringify(path?{output:path,...value}:value,null,2)+'\n');return value;
}
export async function main(argv=process.argv.slice(2),{signal}={}){
  const [command,...rest]=argv;if(!command||['help','--help','-h'].includes(command)){process.stdout.write(HELP);return;}
  const value=flags(rest),allowed=['url','workspace','token-env','request','out','id','plan','capture','view','offset','limit','search','status','kind','dir','preview','inspection','actor','name','timeout-ms','selection','sha256','chunk-bytes'];
  need(Object.keys(value).every(key=>allowed.includes(key)),'Use a documented Cryptoworth client option.');
  if(command==='prepare'){
    const kind=value.kind,result=await prepareAccountingCryptoworthOperation({directory:value.dir,url:value.url,workspace:value.workspace,tokenEnv:value['token-env'],kind,
      ...(PREVIEWS.has(kind)?{preview:await readJson(value.preview)}:{}),
      ...(kind==='rollback'?{arguments:await readJson(value.request)}:{}),
      ...(kind==='packet'?{inspection:await readJson(value.inspection),packetOptions:{actor:value.actor,...(value.name?{name:value.name}:{})}}:{})});
    return output(result);
  }
  if(command==='execute'||command==='reconcile')return output(await runAccountingCryptoworthOperation({directory:value.dir,execute:command==='execute',signal,timeoutMs:numeric(value['timeout-ms'],'timeout-ms')??30000}));
  const client=await connectAccountingCryptoworthClient({url:value.url,workspace:value.workspace,tokenEnv:value['token-env']??'MCP_ACCESS_TOKEN'});
  const options={requestSignal:signal,timeoutMs:numeric(value['timeout-ms'],'timeout-ms')??30000};
  try{
    if(command==='open')return output(await client.open(options));
    if(command==='close')return output(await client.closeWorkspace(options));
    await client.open(options);
    const paging=Object.fromEntries(['view','offset','limit','search','status'].filter(key=>value[key]!==undefined).map(key=>[key,['offset','limit'].includes(key)?numeric(value[key],key):value[key]]));
    let result;
    if(command==='sources')result=await client.sources(options);
    else if(command==='status')result=await client.status(paging,options);
    else if(command==='source')result=await client.source(await readJson(value.request),options);
    else if(command==='template')result=await client.template(await readJson(value.request),options);
    else if(command==='packet-inspect'){const selected=await readJson(value.request);result=await client.inspectPacket(selected.file??selected,options);}
    else if(command==='profile')result=await client.profile(value.id,options);
    else if(command==='plan')result=await client.plan(value.plan,paging,options);
    else if(command==='rows')result=await client.rows(value.plan,{...paging,...(value.capture?{captureId:value.capture}:{})},options);
    else if(command==='capture')result=await client.capture(value.plan,value.id,options);
    else if(command==='return')result=await client.returned(value.plan,value.id,options);
    else if(command==='rollback-record')result=await client.rollbackRecord(value.id,options);
    else if(command==='preview'){
      need(value.out,'Keep the complete preview in a new private --out file.');
      result=await client.preview(value.kind,await readJson(value.request),{...(value.plan?{planId:value.plan}:{}),...paging},options);
    }else if(command==='download')result=await downloadAccountingCryptoworthFile({client,selection:await readJson(value.selection),expectedSha256:value.sha256,
      output:value.out,chunkBytes:numeric(value['chunk-bytes'],'chunk-bytes')??65536,signal});
    else throw fail('ARGUMENTS','Choose a documented Cryptoworth client command.');
    return output(result,command==='download'?undefined:value.out);
  }finally{await client.disconnect();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  process.stderr.write(JSON.stringify({error:{code:error.code??'ERROR',message:String(error.message??error)}})+'\n');process.exitCode=1;
});
