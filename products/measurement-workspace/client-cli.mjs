#!/usr/bin/env node
// MIT. Full original request/response files through the configured Measurements owner.
import {resolve} from 'node:path';
import {readMeasurementConfiguration,validateMeasurementConfiguration,MeasurementClient,copyClientFile,regularFile,saveClientJSON,need,CONNECTIONS_SCHEMA,CONNECTION_SCHEMA} from './client.mjs';
function options(argv){const values={};for(let n=0;n<argv.length;n+=2){const key=argv[n];need(/^--[a-z][a-z-]*$/.test(key)&&n+1<argv.length&&!Object.hasOwn(values,key.slice(2)),'Use unique --name value options.');values[key.slice(2)]=argv[n+1];}return values;}
const commands={
 configure:['config','workspace','connection','connection-sha256','exports-directory','label','inputs','out'],
 catalogue:['config','out'],inspect:['config','workspace','input','out'],
 read:['config','workspace','operation','params','request-id','out'],
 execute:['config','workspace','input','sha256','request-id','retry','out'],
 status:['config','workspace','request-id','out'],
 'file-info':['config','workspace','request-id','part','attempt','out'],
 download:['config','workspace','request-id','part','attempt','out']
};
async function jsonInput(file,maximum=1024*1024){const read=await regularFile(resolve(file),{maximum});try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(read.body));}catch{need(false,'Choose the complete original JSON file.');}}
async function main(){
 const [command,...argv]=process.argv.slice(2),args=options(argv),allowed=commands[command];
 need(allowed&&Object.keys(args).every(k=>allowed.includes(k)),'Choose configure, catalogue, inspect, read, execute, status, file-info or download with declared options.');
 need(args.config&&args.out,'Every command requires --config and an immutable --out path.');
 let result,client;
 try{
  if(command==='configure'){
   need(args.workspace&&args.connection&&args['connection-sha256']&&args['exports-directory']&&args.label,'Configure one named original managed connection.');
   const connection=await regularFile(resolve(args.connection),{maximum:1024*1024,privateOnly:true});need(connection.sha256===args['connection-sha256'],'Connection bytes differ from the reviewed digest.');
   const receipt=JSON.parse(connection.body);need(receipt.schema===CONNECTION_SCHEMA,'Choose the managed connection receipt.');
   const value={schema:CONNECTIONS_SCHEMA,workspaces:{[args.workspace]:{label:args.label,connectionFile:resolve(args.connection),connectionSha256:connection.sha256,connectionText:new TextDecoder('utf-8',{fatal:true}).decode(connection.body),tokenEnv:receipt.tokenEnv,inputs:args.inputs?await jsonInput(args.inputs):{},exportsDirectory:resolve(args['exports-directory'])}}};
   // Configuration publication is create-only; exact retry preserves the prior file.
   await validateMeasurementConfiguration(value);
   result=await saveClientJSON(args.config,value);
   result={...result,workspace:args.workspace,instanceId:receipt.instanceId};
  }else{
   const config=await readMeasurementConfiguration(args.config);client=new MeasurementClient(config);
   if(command==='catalogue')result=client.configuration();
   else{
    need(args.workspace,'Select --workspace from the configured aliases.');
    const common={requestId:args['request-id'],part:args.part??'response',...(args.attempt?{attempt:args.attempt}:{})};
    if(command==='inspect')result=await client.inspectInput(args.workspace,args.input);
    else if(command==='read'){need(args['request-id'],'Retain --request-id before the read so its exact first result can be recovered.');result=await client.read(args.workspace,{operation:args.operation,params:args.params?await jsonInput(args.params):{},requestId:args['request-id']});}
    else if(command==='execute'){need(args.retry===undefined||['true','false'].includes(args.retry),'Use --retry true only for supported exact native replay.');result=await client.execute(args.workspace,{input:args.input,expectedSha256:args.sha256,requestId:args['request-id'],retry:args.retry==='true'});}
    else if(command==='status')result=await client.status(args.workspace,args['request-id']);
    else if(command==='file-info'){const {path,directory,...info}=await client.file(args.workspace,common);result=info;}
    else if(command==='download'){result=await copyClientFile(client,args.workspace,common,args.out);console.log(JSON.stringify(result));return;}
   }
  }
  const saved=await saveClientJSON(args.out,result);console.log(JSON.stringify({...saved,...(result.requestId?{requestId:result.requestId,phase:result.phase,successful:result.successful}:{})}));
 }finally{await client?.close();}
}
main().catch(error=>{console.error(JSON.stringify({code:error.code??'MEASUREMENT_CLIENT_ERROR',message:error.message}));process.exitCode=1;});
