#!/usr/bin/env node
// MIT. Installed channel operations attach to the original product or acquire its stopped native workspace.
import { open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { regular, privateDirectory } from '../distribution/runtime-workspace/storage.mjs';
import { openWorkspace, requireValue as need, hash } from '../mpp-charge/storage.mjs';
import { createChannelWorkbench } from './workbench.mjs';
import { connectMppChannel, actions } from './client.mjs';
import { parseBundle } from './receiving.mjs';
const HELP=[
 'Stellar Forge · recurring MPP channel work','',
 'Use the original running product:',
 '  starforge mpp-workspace channel state --dir PRIVATE_PRODUCT',
 '  starforge mpp-workspace channel OPERATION --dir PRIVATE_PRODUCT --input OPERATION.json [--wait-ms 30000] [--out RESULT.json]',
 '  starforge mpp-workspace channel run --dir PRIVATE_PRODUCT --input WORK.json [--out RESULT.json]',
 '  starforge mpp-workspace channel tasks|purchases|contracts|funders|funding|settlements|observations|openings --dir PRIVATE_PRODUCT --id ORIGINAL_ID',
 '  starforge mpp-workspace channel job --dir PRIVATE_PRODUCT --id ORIGINAL_JOB_ID',
 '  starforge mpp-workspace channel response --dir PRIVATE_PRODUCT --id PURCHASE_ID --out RESPONSE_FILE',
 '  starforge mpp-workspace channel handover --dir PRIVATE_PRODUCT --id BUNDLE_SHA256 --out HANDOVER.json','',
 'Direct original native workspace (product stopped):',
 '  starforge mpp-channel OPERATION --workspace ORIGINAL_WORKSPACE --input OPERATION.json [--out RESULT.json]',
 '  starforge mpp-channel serve --workspace ORIGINAL_WORKSPACE [--port 8787]',
 '  node stellar/scf-starforge-20261009/mpp-channel/cli.mjs serve --workspace ORIGINAL_WORKSPACE','',
 'Operations:',
 '  '+actions.join(', '),'',
 'opening-template input: {}; opening-prepare input: {openingId, profile: <complete source/channel/funder selection>}',
 'opening-execute/resume/reconcile/cancel input: {openingId, rpcUrl?: <reconcile archival RPC>}',
 'Opening uses the selected WASM, stable salt, original constructor and deposit, and total reviewed fee cap.',
 'task-save input: {config: <complete selected task>, expectedRevision: <current revision or 0>}',
 'task-authorize input: {taskId, expectedRevision}; original operator terminal authorizes its cap.',
 'purchase-prepare input: {taskId, purchaseId, request: {url, method, json?}}',
 'purchase-execute/resume/refresh/cancel input: {purchaseId}',
 'merchant-save input: {profile: <complete merchant profile>, expectedRevision}',
 'merchant-start input: {stream: <channel stream key>, port: 8789}',
 'funder-template input: {stream}; funder-save input: {profile: <complete selected funder>, expectedRevision}',
 'channel-observe input: {stream}; reads coherent selected chain balance, withdrawals and refund ledger.',
 'funding-prepare input: {stream, fundingId, action: "top_up" | "close_start" | "refund", amountAtomic?: <top_up only>}',
 'funding-execute/resume/reconcile/cancel input: {fundingId, rpcUrl?: <reconcile archival RPC>}',
 'collection-prepare input: {stream, settlementId}; retains the highest accepted original commitment.',
 'collection-execute/resume/reconcile/cancel input: {settlementId, rpcUrl?: <reconcile archival RPC>}',
 'close-prepare input: {stream, settlementId}; close-execute/resume/cancel input: {settlementId}',
 'close-reconcile input: {settlementId, rpcUrl?: <selected archival RPC>}',
 'export input: {channel: <original channel identity>, handoverId}; transfers operation with its complete source.',
 'receive input: {file: <complete handover path>, dependencyRoot: <installed exact native SDK>}',
 'run input: {schema: "stellar-forge.mpp-channel-work.v1", purchases: [{taskId, purchaseId, request}]}','',
 'The browser has channel opening, task forms, merchant offers, output downloads, funding, collection, refund and complete receiving.',
 'Use README.md for original source and operating instructions. No secret keys belong in JSON inputs.',''
].join('\n');
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function options(args){
 const values=new Map(),allowed=['--dir','--workspace','--input','--out','--id','--wait-ms','--port'];
 for(let index=0;index<args.length;index+=2){
  need(allowed.includes(args[index]) && !values.has(args[index]) && typeof args[index+1]==='string' &&
    !args[index+1].startsWith('--'),'MPP_CHANNEL_ARGUMENTS');
  values.set(args[index],args[index+1]);
 }
 return values;
}
function full(value){need(typeof value==='string' && value===resolve(value),'MPP_CHANNEL_ABSOLUTE_PATH_REQUIRED');return value;}
async function document(path){return JSON.parse((await regular(full(path),128*1024*1024)).toString('utf8'));}
async function write(path,bytes){
 path=full(path);await privateDirectory(dirname(path));
 let fd;
 try{fd=await open(path,'wx',0o600);await fd.writeFile(bytes);await fd.sync();}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const old=await regular(path,128*1024*1024);
  need(hash(old)===hash(bytes),'MPP_CHANNEL_OUTPUT_FILE_ALREADY_EXISTS',409);
 }finally{await fd?.close();}
 return{path,bytes:bytes.length,sha256:hash(bytes)};
}
async function untilStop(close){
 await new Promise(done=>{const stop=()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);done();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);});
 await close();
}
export async function main(args=process.argv.slice(2)){
 const [command,...rest]=args;if(!command || ['help','--help','-h'].includes(command)){process.stdout.write(HELP);return 0;}
 let client,workspace,workbench;
 try{
  const values=options(rest),directory=values.get('--dir'),nativeDirectory=values.get('--workspace');
  need(Boolean(directory)!==Boolean(nativeDirectory),'MPP_CHANNEL_SELECT_ONE_ORIGINAL_WORKSPACE');
  const input=values.has('--input')?await document(values.get('--input')):{};
  const waitMs=Number(values.get('--wait-ms')??30000);
  need(Number.isSafeInteger(waitMs)&&waitMs>=0&&waitMs<=3600000,'MPP_CHANNEL_WAIT_INVALID');
  let result,bytes;
  if(command==='serve'){
   need(nativeDirectory && !directory,'MPP_CHANNEL_DIRECT_WORKSPACE_REQUIRED');
   const {serveWorkspace}=await import('../mpp-charge/server.mjs');
   const server=await serveWorkspace({directory:full(nativeDirectory),port:Number(values.get('--port')??8787)});
   print({workspace:server.workspace.root,privateUrl:server.url,channelUrl:server.origin+'/channels#'+new URL(server.url).hash.slice(1)});
   await untilStop(server.close);return 0;
  }
  if(directory){
   client=await connectMppChannel({directory:full(directory)});
   if(command==='state')result=await client.state();
   else if(command==='job')result=await client.job(values.get('--id'));
   else if(['tasks','purchases','contracts','funders','funding','settlements','observations','openings'].includes(command))result=await client.record(command,values.get('--id'));
   else if(command==='run')result=await client.runPurchases(input,{waitMs});
   else if(command==='response')bytes=(await client.response(values.get('--id'))).bytes;
   else if(command==='handover')bytes=(await client.handover(values.get('--id'))).bytes;
   else result=await client.invoke(command,input,{waitMs});
  }else{
   workspace=await openWorkspace(full(nativeDirectory));workbench=createChannelWorkbench({workspace});
   if(command==='state')result=await workbench.state();
   else if(['tasks','purchases','contracts','funders','funding','settlements','observations','openings'].includes(command))result=await workbench.read(command,values.get('--id'));
   else if(command==='response')bytes=Buffer.from(await(await workbench.response(values.get('--id'))).arrayBuffer());
   else if(command==='handover')bytes=Buffer.from(await(await workbench.handover(values.get('--id'))).arrayBuffer());
   else{
    need(actions.includes(command),'MPP_CHANNEL_OPERATION_NOT_FOUND',404);
    result=await workbench.action(command,input);
    if(command==='merchant-start'){print(result);await untilStop(()=>workbench.close());return 0;}
   }
  }
  if(bytes){need(values.has('--out'),'MPP_CHANNEL_OUTPUT_REQUIRED');if(command==='handover')parseBundle(Buffer.from(bytes).toString('utf8'));print(await write(values.get('--out'),bytes));}
  else if(values.has('--out'))print(await write(values.get('--out'),Buffer.from(JSON.stringify(result,null,2)+'\n')));
  else print(result);
  return 0;
 }catch(error){process.stderr.write(JSON.stringify({error:error.code??'MPP_CHANNEL_OPERATION_FAILED',message:error.message,
   ...(error.jobId?{jobId:error.jobId}:{})})+'\n');return 1;}
 finally{await client?.close();await workbench?.close();await workspace?.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().then(code=>{process.exitCode=code;},error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
