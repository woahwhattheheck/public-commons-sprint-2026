#!/usr/bin/env node
// MIT. Full original request/response files through the configured Measurements owner.
import {resolve} from 'node:path';
import {measurementArtifact,copyMeasurementArtifact} from './scientific-files.mjs';
import {createHash} from 'node:crypto';
import {MeasurementTransfers,copyTransferFile,exportTransfer} from './transfers.mjs';
import {readMeasurementConfiguration,validateMeasurementConfiguration,MeasurementClient,copyClientFile,regularFile,saveClientJSON,need,CONNECTIONS_SCHEMA,CONNECTION_SCHEMA} from './client.mjs';
function options(argv){const values={};for(let n=0;n<argv.length;n+=2){const key=argv[n];need(/^--[a-z][a-z-]*$/.test(key)&&n+1<argv.length&&!Object.hasOwn(values,key.slice(2)),'Use unique --name value options.');values[key.slice(2)]=argv[n+1];}return values;}
const commands={
 configure:['config','workspace','connection','connection-sha256','exports-directory','label','inputs','files','out'],
 catalogue:['config','out'],inspect:['config','workspace','input','out'],
 read:['config','workspace','operation','params','request-id','out'],
 execute:['config','workspace','input','sha256','request-id','retry','out'],
 status:['config','workspace','request-id','out'],
 'file-info':['config','workspace','request-id','part','attempt','out'],
 download:['config','workspace','request-id','part','attempt','out'],
 'artifact-info':['config','workspace','request-id','out'],
 'artifact-download':['config','workspace','request-id','out'],
 'transfer-inspect':['config','workspace','file','out'],
 'transfer-start':['config','workspace','input','sha256','transfer-id','out'],
 'transfer-run':['config','workspace','transfer-id','run-id','max-chunks','until-complete','out'],
 'transfer-apply':['config','workspace','transfer-id','action-id','input','sha256','out'],
 'transfer-status':['config','workspace','transfer-id','offset','limit','out'],
 'transfer-rebind':['config','workspace','transfer-id','original-instance-id','connection-sha256','out'],
 'transfer-file-info':['config','workspace','transfer-id','part','name','out'],
 'transfer-download':['config','workspace','transfer-id','part','name','out'],
 'transfer-export':['config','workspace','transfer-id','out']
};
async function jsonInput(file,maximum=1024*1024){const read=await regularFile(resolve(file),{maximum});try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(read.body));}catch{need(false,'Choose the complete original JSON file.');}}
async function main(){
 const [command,...argv]=process.argv.slice(2),args=options(argv),allowed=commands[command];
 need(allowed&&Object.keys(args).every(k=>allowed.includes(k)),'Choose an installed Measurements client command with its declared options.');
 need(args.config&&args.out,'Every command requires --config and an immutable --out path.');
 let result,client,transfers;
 try{
  if(command==='configure'){
   need(args.workspace&&args.connection&&args['connection-sha256']&&args['exports-directory']&&args.label,'Configure one named original managed connection.');
   const connection=await regularFile(resolve(args.connection),{maximum:1024*1024,privateOnly:true});need(connection.sha256===args['connection-sha256'],'Connection bytes differ from the reviewed digest.');
   const receipt=JSON.parse(connection.body);need(receipt.schema===CONNECTION_SCHEMA,'Choose the managed connection receipt.');
   const value={schema:CONNECTIONS_SCHEMA,workspaces:{[args.workspace]:{label:args.label,connectionFile:resolve(args.connection),connectionSha256:connection.sha256,connectionText:new TextDecoder('utf-8',{fatal:true}).decode(connection.body),tokenEnv:receipt.tokenEnv,inputs:args.inputs?await jsonInput(args.inputs):{},files:args.files?await jsonInput(args.files):{},exportsDirectory:resolve(args['exports-directory'])}}};
   // Configuration publication is create-only; exact retry preserves the prior file.
   await validateMeasurementConfiguration(value);
   result=await saveClientJSON(args.config,value);
   result={...result,workspace:args.workspace,instanceId:receipt.instanceId};
  }else{
   const config=await readMeasurementConfiguration(args.config);client=new MeasurementClient(config);transfers=new MeasurementTransfers(config,client);
   if(command==='catalogue')result=client.configuration();
   else{
    need(args.workspace,'Select --workspace from the configured aliases.');
    const common={requestId:args['request-id'],part:args.part??'response',...(args.attempt?{attempt:args.attempt}:{})};
    if(command.startsWith('transfer-')){
     const transferId=args['transfer-id'],selection={transferId,part:args.part??'request',...(args.name?{name:args.name}:{})};
     if(command==='transfer-inspect')result=await transfers.inspect(args.workspace,args.file);
     else if(command==='transfer-start')result=await transfers.start(args.workspace,{transferId,input:args.input,expectedSha256:args.sha256});
     else if(command==='transfer-status')result=await transfers.status(args.workspace,transferId,{offset:Number(args.offset??0),limit:Number(args.limit??25)});
     else if(command==='transfer-rebind')result=await transfers.rebind(args.workspace,{transferId,expectedOriginalInstanceId:args['original-instance-id'],expectedConnectionSha256:args['connection-sha256']});
     else if(command==='transfer-apply')result=await transfers.apply(args.workspace,{transferId,actionId:args['action-id'],input:args.input,expectedSha256:args.sha256});
     else if(command==='transfer-run'){
      need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(args['run-id']||''),'Retain --run-id before transferring.');
      need(args['until-complete']===undefined||['true','false'].includes(args['until-complete']),'Use --until-complete true to continue the same whole transfer.');
      let iteration=0;do{
       const hash=createHash('sha256').update(args['run-id']+'\\0'+iteration).digest('hex');
       const runId=iteration===0?args['run-id']:hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
       result=await transfers.advance(args.workspace,{transferId,runId,maxChunks:Number(args['max-chunks']??64)});iteration++;
       need(iteration<=32769,'Continue this same transfer with a new explicit run UUID.');
      }while(args['until-complete']==='true'&&!result.complete);
     }else if(command==='transfer-file-info'){const {path,directory,...value}=await transfers.file(args.workspace,selection);result=value;}
     else if(command==='transfer-download'){result=await copyTransferFile(transfers,args.workspace,selection,args.out);console.log(JSON.stringify(result));return;}
     else if(command==='transfer-export'){result=await exportTransfer(transfers,args.workspace,{transferId,out:args.out});console.log(JSON.stringify(result));return;}
    }else if(command==='inspect')result=await client.inspectInput(args.workspace,args.input);
    else if(command==='read'){need(args['request-id'],'Retain --request-id before the read so its exact first result can be recovered.');result=await client.read(args.workspace,{operation:args.operation,params:args.params?await jsonInput(args.params):{},requestId:args['request-id']});}
    else if(command==='execute'){need(args.retry===undefined||['true','false'].includes(args.retry),'Use --retry true only for supported exact native replay.');result=await client.execute(args.workspace,{input:args.input,expectedSha256:args.sha256,requestId:args['request-id'],retry:args.retry==='true'});}
    else if(command==='status')result=await client.status(args.workspace,args['request-id']);
    else if(command==='artifact-info'){const {path,directory,...value}=await measurementArtifact(client,args.workspace,{requestId:args['request-id']});result=value;}
    else if(command==='artifact-download'){result=await copyMeasurementArtifact(client,args.workspace,{requestId:args['request-id']},args.out);console.log(JSON.stringify(result));return;}
    else if(command==='file-info'){const {path,directory,...info}=await client.file(args.workspace,common);result=info;}
    else if(command==='download'){result=await copyClientFile(client,args.workspace,common,args.out);console.log(JSON.stringify(result));return;}
   }
  }
  const saved=await saveClientJSON(args.out,result);console.log(JSON.stringify({...saved,...(result.requestId?{requestId:result.requestId,phase:result.phase,successful:result.successful}:{})}));
 }finally{await transfers?.close();await client?.close();}
}
main().catch(error=>{console.error(JSON.stringify({code:error.code??'MEASUREMENT_CLIENT_ERROR',message:error.message}));process.exitCode=1;});
