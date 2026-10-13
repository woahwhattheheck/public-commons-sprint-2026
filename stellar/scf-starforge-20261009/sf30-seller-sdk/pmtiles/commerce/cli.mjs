#!/usr/bin/env node
// MIT. Local paid map operations and original customer receiving on retained inputs.
import {resolve,join,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {Buyer} from '../../../sf88-operator-buyer-cli/node/client.mjs';
import {openPMTilesWorkspace} from '../workspace.mjs';
import {need,clone,identifier} from '../model.mjs';
import {PMTilesOutputController} from './controller.mjs';
import {fields,OUTPUT_METADATA_BYTES} from './model.mjs';
import {prepareOutputPurchase,inspectOutputPurchase,runOutputPurchase,recoverOutputPurchase,
  adoptPurchasedMapResource,receivePurchasedMapOperations,
  inspectOutputPurchaseAccounting,finalizeOutputPurchaseAccounting,recoverOutputPurchaseAccounting} from './buyer.mjs';

const HELP='Paid map outputs\n\n'+
'starforge pmtiles-output prepare|package|catalog|stage|release|compare|activate|request|status --connection /PRIVATE/output.json [--request /PRIVATE/request.json]\n'+
'starforge pmtiles-output serve --connection /PRIVATE/output.json --request /PRIVATE/start.json\n'+
'starforge pmtiles-output purchase-prepare|purchase-status|purchase-run|purchase-recover|purchase-accounting|purchase-finalize|purchase-accounting-recover|purchase-adopt|purchase-receive --connection /PRIVATE/customer.json --request /PRIVATE/request.json\n\n'+
'Serve keeps the original owned SF82 seller in this foreground process; Ctrl-C drains it.\n'+
'Keep the same request ID, source/catalog hashes and original purchase directory after interruption.\n';
function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0'),
  'PMTILES_OUTPUT_ABSOLUTE_PATH_REQUIRED');return resolve(value);}
async function privateJson(path){
  const file=await open(absolute(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await file.stat();
    need(info.isFile()&&info.size<=OUTPUT_METADATA_BYTES&&(process.platform==='win32'||
      (info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid())),'PMTILES_OUTPUT_PRIVATE_JSON_REQUIRED');
    const raw=await file.readFile();need(raw.length<=OUTPUT_METADATA_BYTES,'PMTILES_OUTPUT_REQUEST_SIZE_LIMIT');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  }finally{await file.close();}
}
function options(argv){
  const out={};
  for(let n=0;n<argv.length;n+=2){
    const key=argv[n],value=argv[n+1];
    need(['--connection','--request'].includes(key)&&typeof value==='string'&&!Object.hasOwn(out,key),
      'PMTILES_OUTPUT_CLI_OPTIONS_INVALID');out[key]=value;
  }
  need(out['--connection'],'PMTILES_OUTPUT_CONNECTION_REQUIRED');return out;
}
async function connection(path){
  const value=await privateJson(path);
  fields(value,['schema','workspaceDirectory','expectedWorkspaceId','outputDirectory','releaseStore','runtimes',
    'buyer','purchasesDirectory'],['schema']);
  need(value.schema==='starforge.pmtiles-output-cli.v1','PMTILES_OUTPUT_CLI_CONNECTION_INVALID');
  for(const key of ['workspaceDirectory','outputDirectory','releaseStore','purchasesDirectory'])
    if(value[key]!==undefined)value[key]=absolute(value[key]);
  if(value.expectedWorkspaceId!==undefined)identifier(value.expectedWorkspaceId);
  if(value.buyer!==undefined){
    fields(value.buyer,['runtimeDirectory','stateDirectory','operatorProfile','operatorWorkspace'],['runtimeDirectory','stateDirectory']);
    for(const key of ['runtimeDirectory','stateDirectory'])value.buyer[key]=absolute(value.buyer[key]);
    if(value.buyer.operatorProfile!==undefined)value.buyer.operatorProfile=absolute(value.buyer.operatorProfile);
    if(value.buyer.operatorWorkspace!==undefined)value.buyer.operatorWorkspace=absolute(value.buyer.operatorWorkspace);
  }
  return value;
}
export async function runPMTilesOutputCommand(argv,{signal,onReady}={}){
  argv=[...argv];const [command,...rest]=argv;
  if(!command||command==='help'||command==='--help')return {help:HELP};
  const opt=options(rest),config=await connection(opt['--connection']);
  need(command==='status'||opt['--request'],'PMTILES_OUTPUT_REQUEST_REQUIRED');
  const request=opt['--request']?clone(await privateJson(opt['--request'])):{};
  let workspace,controller,failure;
  const openWorkspace=async()=>{
    if(!workspace){
      need(config.workspaceDirectory&&config.expectedWorkspaceId,'PMTILES_OUTPUT_WORKSPACE_CONNECTION_REQUIRED');
      workspace=await openPMTilesWorkspace({directory:config.workspaceDirectory,create:false,
        expectedWorkspaceId:config.expectedWorkspaceId});
    }
    return workspace;
  };
  try{
    signal?.throwIfAborted();
    if(command.startsWith('purchase-')){
      need(config.buyer&&config.purchasesDirectory,'PMTILES_OUTPUT_BUYER_CONNECTION_REQUIRED');
      const {operatorWorkspace,...buyerOptions}=config.buyer;
      const buyer=new Buyer(buyerOptions),action=command.slice('purchase-'.length);
      const purchaseRequestId=identifier(action==='prepare'?request.requestId:request.purchaseRequestId);
      const directory=join(config.purchasesDirectory,purchaseRequestId);
      if(config.workspaceDirectory)need(directory!==config.workspaceDirectory&&!directory.startsWith(config.workspaceDirectory+sep)&&
        !config.workspaceDirectory.startsWith(directory+sep),'PMTILES_OUTPUT_SEPARATE_PURCHASE_DIRECTORY_REQUIRED');
      const common={buyer,directory,requestId:purchaseRequestId,signal};
      if(action==='prepare'){
        // The local request may point at its already reviewed original config.
        const input=clone(request);
        if(typeof input.configuration==='string')input.configuration=await privateJson(input.configuration);
        return await prepareOutputPurchase({buyer,directory,input,signal});
      }
      if(['status','run','recover'].includes(action)){
        fields(request,['purchaseRequestId'],['purchaseRequestId']);
        return await (action==='status'?inspectOutputPurchase(common):action==='run'?runOutputPurchase(common):recoverOutputPurchase(common));
      }
      if(action==='accounting'||action==='finalize'){
        fields(request,['purchaseRequestId','offset','limit'],['purchaseRequestId']);
        need(operatorWorkspace,'PMTILES_OUTPUT_ORIGINAL_OPERATOR_WORKSPACE_REQUIRED');
        const {purchaseRequestId:_selected,...range}=request;
        return await (action==='finalize'?finalizeOutputPurchaseAccounting:inspectOutputPurchaseAccounting)(
          {...common,input:{...range,workspaceDirectory:operatorWorkspace}});
      }
      if(action==='accounting-recover'){
        fields(request,['purchaseRequestId','commandId'],['purchaseRequestId']);
        const {purchaseRequestId:_selected,...input}=request;
        return await recoverOutputPurchaseAccounting({...common,input});
      }
      if(action==='adopt'){
        fields(request,['requestId','purchaseRequestId'],['requestId','purchaseRequestId']);
        return await adoptPurchasedMapResource({buyer,directory,purchaseRequestId,workspace:await openWorkspace(),
          input:{requestId:request.requestId,expectedWorkspaceId:config.expectedWorkspaceId},signal});
      }
      if(action==='receive'){
        fields(request,['requestId','purchaseRequestId','directory','workspaceDirectory','pythonExecutable'],
          ['requestId','purchaseRequestId','directory','workspaceDirectory','pythonExecutable']);
        const {purchaseRequestId:_selected,...input}=request;
        return await receivePurchasedMapOperations({buyer,directory,purchaseRequestId,input,signal});
      }
      need(false,'PMTILES_OUTPUT_PURCHASE_COMMAND_INVALID');
    }
    need(['prepare','package','catalog','stage','release','compare','activate','request','status','serve'].includes(command),
      'PMTILES_OUTPUT_CLI_COMMAND_INVALID');
    need(config.outputDirectory&&config.releaseStore,'PMTILES_OUTPUT_MERCHANT_CONNECTION_REQUIRED');
    controller=new PMTilesOutputController({workspace:await openWorkspace(),directory:config.outputDirectory,
      releaseStore:config.releaseStore,runtimes:config.runtimes??{}});
    const result=await controller.execute(command==='serve'?'start':command,
      {...request,expectedWorkspaceId:config.expectedWorkspaceId},{signal});
    if(command==='serve'&&controller.ownedRuntime){
      await onReady?.(result);
      if(signal){
        let stop;
        const aborted=new Promise(resolve=>{stop=()=>resolve();signal.addEventListener('abort',stop,{once:true});if(signal.aborted)resolve();});
        try{await Promise.race([controller.wait(),aborted]);}finally{signal.removeEventListener('abort',stop);}
      }else await controller.wait();
      return {operation:result,stopped:true};
    }
    return result;
  }catch(error){failure=error;throw error;}finally{
    const results=await Promise.allSettled([controller?.close()??Promise.resolve()]);
    try{await workspace?.close();}catch(error){results.push({status:'rejected',reason:error});}
    const failed=results.find(row=>row.status==='rejected');
    if(failed){if(failure)throw new AggregateError([failure,failed.reason],'PMTILES_OUTPUT_COMMAND_AND_CLOSE_FAILED');throw failed.reason;}
  }
}
export async function main(argv=process.argv.slice(2)){
  const abort=new AbortController(),stop=()=>abort.abort(new Error('PMTILES_OUTPUT_COMMAND_STOPPED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await runPMTilesOutputCommand(argv,{signal:abort.signal,
      onReady:value=>process.stdout.write(JSON.stringify({sellerReady:true,...value})+'\n')});
    process.stdout.write(result?.help??JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'PMTILES_OUTPUT_COMMAND_FAILED')+': '+error.message+'\n');process.exitCode=1;});
