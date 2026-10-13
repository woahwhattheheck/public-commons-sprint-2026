// MIT. Source-owned Applications lifecycle for the original signed webhook store.
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup}
 from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {digest,encode,need,SESSION_SCHEMA} from './contracts.mjs';
const ENTRY='products/webhook-feed/runtime.mjs';
const ORIGINAL='stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/';
export const WEBHOOK_LAUNCH_FILES=Object.freeze([
 ENTRY,'products/webhook-feed/application-provider.mjs','products/webhook-feed/connection.mjs',
 'products/webhook-feed/contracts.mjs','products/webhook-feed/operator.mjs',
 ...['store.mjs','model.mjs','receiver.mjs','signatures.mjs','merchant.mjs',
  'snapshots.mjs','workspace.mjs','public/index.html','public/app.mjs','public/style.css'].map(file=>ORIGINAL+file)
]);
export function webhookOperationsApplication(common=[]){
 return {id:'webhook-event-operations',command:'webhook-operations-workspace',
  title:'Webhook event operations',terminal:false,requiredSource:ENTRY,
  description:'Operate signed source ingestion, reviewed event feeds, original merchant terms and complete customer snapshots in one retained workspace.',
  fields:[
   {name:'state',label:'Original event store',type:'path',required:true,
    description:'Select the original initialized private webhook store. Its accepted events, retries, definitions, merchant terms and cursor identity remain here.'},
   {name:'runtimeFile',label:'Listener configuration',type:'path',required:false,
    description:'Optional private JSON for receiver and merchant ports and your existing facilitator. The default starts the receiver and private workspace on available local ports.'},
   ...common
  ]};
}
export async function prepareWebhookOperationsApplication(settings,{inputPath,runtimeDirectory}={}){
 need(typeof inputPath==='function'&&typeof settings.state==='string','APPLICATION_WEBHOOK_STORE_REQUIRED');
 const runtime=await inspectMerchantRuntime(resolve(runtimeDirectory),{load:false});
 const native=await import(pathToFileURL(join(runtime.sourceRoot,ENTRY)).href);
 const directory=resolve(settings.state),original=await native.inspectWebhookStore(directory);
 const inputs=[await inputPath(directory,'directory',false,true)];
 for(const file of WEBHOOK_LAUNCH_FILES)inputs.push(await inputPath(join(runtime.sourceRoot,file),'file'));
 const args=['--state',directory,'--expected-store-id',original.storeId,'--port',String(settings.port??0)];
 if(settings.runtimeFile){
  const file=resolve(settings.runtimeFile);await native.readRuntimeOptions(file);
  inputs.push(await inputPath(file,'file'));args.push('--runtime-file',file);
 }
 return {args,inputs,createDirectories:[],
  resourceKey:digest(encode({family:'webhook-event-operations',directory}))};
}
function launchArguments(args){
 need(Array.isArray(args)&&args.length%2===0,'APPLICATION_WEBHOOK_ARGUMENTS_CHANGED');
 const accepted=new Set(['--state','--port','--runtime-file','--expected-store-id','--operation-id']),value={};
 for(let index=0;index<args.length;index+=2){
  need(accepted.has(args[index])&&!Object.hasOwn(value,args[index])&&typeof args[index+1]==='string',
   'APPLICATION_WEBHOOK_ARGUMENTS_CHANGED');value[args[index]]=args[index+1];
 }
 need(value['--state']&&value['--expected-store-id']&&value['--operation-id'],'APPLICATION_WEBHOOK_ARGUMENTS_CHANGED');
 return value;
}
export async function webhookOperationsStartup(request,text,context={}){
 if(request.command!=='webhook-operations-workspace'||typeof text!=='string'||
  text.length>32768||!text.startsWith('{"schema":"'+SESSION_SCHEMA+'",'))return null;
 const selected=launchArguments(request.args),directory=resolve(selected['--state']);
 const sourceRoot=join(resolve(request.releaseDirectory),'source');
 let startup;try{startup=JSON.parse(text);}catch{need(false,'APPLICATION_WEBHOOK_STARTUP_INVALID');}
 need(startup.schema===SESSION_SCHEMA&&startup.state==='READY'&&startup.directory===directory&&
  startup.storeId===selected['--expected-store-id']&&startup.operationId===selected['--operation-id']&&
  startup.sourceRoot===sourceRoot&&Number.isSafeInteger(startup.pid)&&startup.pid>0&&
  (!context.pid||startup.pid===context.pid)&&
  startup.runtimeFile===(selected['--runtime-file']?resolve(selected['--runtime-file']):null),
 'APPLICATION_WEBHOOK_STARTUP_CHANGED');
 const [{readWebhookFeedSession},{openWebhookFeedOperator}]=await Promise.all([
  import(pathToFileURL(join(sourceRoot,'products/webhook-feed/connection.mjs')).href),
  import(pathToFileURL(join(sourceRoot,'products/webhook-feed/operator.mjs')).href)
 ]);
 const definition={directory,sessionFile:join(directory,'.webhook-operations-session.json'),expectedStoreId:startup.storeId};
 const retained=await readWebhookFeedSession(definition);
 need(digest(encode(retained.session))===digest(encode(startup)),'APPLICATION_WEBHOOK_SESSION_CHANGED');
 const active=await openWebhookFeedOperator(definition);
 need(active.instanceId===startup.instanceId&&active.storeId===startup.storeId,
  'APPLICATION_WEBHOOK_LISTENER_CHANGED');
 return {url:startup.url,original:{schema:SESSION_SCHEMA,instanceId:startup.instanceId,
  operationId:startup.operationId,storeId:startup.storeId,directory,sourceRoot,pid:startup.pid,
  receiver:startup.receiver,merchant:startup.merchant}};
}
export default {
 schema:APPLICATION_PROVIDER_SCHEMA,id:'webhook-event-operations',order:1170,appendPort:false,
 catalog({common}){return [webhookOperationsApplication(common)];},
 prepare(type,settings,context){return prepareWebhookOperationsApplication(settings,context);},
 resourceKey(type,settings,{hash}){return hash({family:'webhook-event-operations',directory:resolve(settings.state)});},
 runArguments({command,args,requestId}){
  need(command==='webhook-operations-workspace'&&!args.includes('--operation-id'),'APPLICATION_WEBHOOK_ARGUMENTS_CHANGED');
  return [...args,'--operation-id',requestId];
 },
 matchRequest(request){return !request.pythonCommand&&request.command==='webhook-operations-workspace';},
 createObserver(request,directory,context){
  return observeApplicationStartup(request,directory,text=>{
   if(!text.startsWith('{"schema":"'+SESSION_SCHEMA+'",'))return null;
   return ()=>webhookOperationsStartup(request,text,context);
  },{lineLimit:32768});
 }
};
