// MIT. Source-owned Merchant provider runtime for complete Carbon customer work.
import {lstat} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';
import {OPERATION_SCHEMAS,PREVIEW_SCHEMAS} from './operation-schemas.mjs';
import {VIEWS,IMPORTS,STATEMENT_FILES} from './catalog.mjs';
import {carbonCustomerTools} from './catalog.mjs';
import {attachCarbonWorkspace} from './agent-client.mjs';
import {receiveCarbonWorkspace,receivedBinding} from './receive.mjs';
import {need,exact,identifier,operationId,privateDirectory,identity,same} from './files.mjs';
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
export {readCarbonCustomerConfiguration} from './configuration.mjs';
export {carbonCustomerTools} from './catalog.mjs';
const definitions=new Map(carbonCustomerTools((name,description,properties,required)=>({name,description,properties,required})).map(v=>[v.name,v]));
export class MerchantCarbonCustomerWorkspaces{
 #config;#entries=new Map();#opening=new Map();#closing=false;#close;#journal;#reads=new RetainedFileReads({errorPrefix:'CARBON_FILE',maxImmutableFileBytes:512*1024*1024});
 constructor(config,{fetchImpl=globalThis.fetch}={}){this.#config=config;this.fetchImpl=fetchImpl;}
 get summary(){const selected=this.#config.carbonCustomerWorkspaces;return {configured:Boolean(selected),...this.#reads.summary,
  workspaces:Object.entries(selected?.workspaces??{}).map(([workspace,v])=>({workspace,label:v.label,kind:v.kind,mode:v.mode,open:this.#entries.has(workspace),files:Object.keys(v.files)})),
  destinations:Object.keys(selected?.destinations??{}),open:[...this.#entries].map(([workspace,e])=>({workspace,...e.client.summary}))};}
 async #root(){
  if(!this.#journal){
   const root=await privateDirectory(this.#config.exportsDirectory);
   for(const d of Object.values(this.#config.carbonCustomerWorkspaces?.workspaces??{})){
    const r=relative(d.directory,root);need(r==='..'||r.startsWith('..'+sep)||isAbsolute(r),'CARBON_EXPORT_DIRECTORY','Keep complete agent exports outside the editable original workspace.');
   }
   this.#journal=await privateDirectory(join(root,'carbon-customer-workspaces'),{create:true});
  }return this.#journal;
 }
 async #definition(alias){
  identifier(alias,'workspace alias');const selected=this.#config.carbonCustomerWorkspaces;
  need(selected,'CARBON_NOT_CONFIGURED','Configure the original Carbon customer connection.');
  if(selected.workspaces[alias])return selected.workspaces[alias];
  const destination=selected.destinations[alias];need(destination,'CARBON_NOT_CONFIGURED','Choose a configured original or receiving alias.');
  const receipt=await receivedBinding(await this.#root(),destination);need(receipt,'CARBON_RECEIVER_PENDING','Receive the complete original handover before opening this receiver.');
  await privateDirectory(receipt.directory);need(receipt.directory===destination.path&&same(receipt.identity,identity(await lstat(receipt.directory))),'CARBON_RECEIVER_CHANGED','The original received directory changed.');
  return {kind:receipt.kind,label:alias,directory:receipt.directory,workspaceId:receipt.workspaceId,identity:receipt.identity,mode:'owned',files:{}};
 }
 #entry(alias){identifier(alias,'workspace alias');const e=this.#entries.get(alias);need(e&&!e.closing,'CARBON_NOT_OPEN','Open the configured original workspace before operating it.');return e;}
 #scope(alias){return 'carbon-customer:'+alias;}
 async #open(alias){
  const current=this.#entries.get(alias);if(current){need(!current.closing,'CARBON_CLOSING','Finish closing this original instance.');await current.client.verify();return {workspace:alias,...current.client.summary,native:await current.client.view('state')};}
  if(this.#opening.has(alias))return this.#opening.get(alias);
  const task=(async()=>{let client;
   try{const definition=await this.#definition(alias),root=await this.#root(),exportDirectory=await privateDirectory(join(root,alias),{create:true});
    client=await attachCarbonWorkspace(definition,{exportDirectory,fetchImpl:this.fetchImpl});need(!this.#closing,'CARBON_CLOSING','The original customer provider is closing.');
    const native=await client.view('state');this.#entries.set(alias,{client,pending:new Set(),tail:Promise.resolve(),closing:false});return {workspace:alias,...client.summary,native};
   }catch(error){await client?.close();throw error;}})();
  this.#opening.set(alias,task);try{return await task;}finally{this.#opening.delete(alias);}
 }
 async #source(args){
  if(!args.sourceWorkspace)return undefined;
  need(args.sourceExport&&!args.sourceFile,'CARBON_SOURCE_SELECTION','Cross-workspace receiving selects one complete retained export.');
  return this.#entry(args.sourceWorkspace).client.exportReceipt(args.sourceExport);
 }
 async #execute(alias,client,name,input){
  switch(name){
   case 'merchant_carbon_contract':return {kind:client.kind,actions:OPERATION_SCHEMAS[client.kind],previews:PREVIEW_SCHEMAS[client.kind],imports:IMPORTS[client.kind],statementFiles:STATEMENT_FILES[client.kind],views:Object.fromEntries(Object.entries(VIEWS).filter(([,v])=>!v.kind||v.kind===client.kind))};
   case 'merchant_carbon_view':return client.view(input.view,input.query);
   case 'merchant_carbon_preview':return client.preview(input.kind,input.value);
   case 'merchant_carbon_save':return client.save(input);
   case 'merchant_carbon_import':return client.import(input,await this.#source(input));
   case 'merchant_carbon_capture':return client.capture(input);
   case 'merchant_carbon_checkpoint':return client.checkpoint(input,await this.#source(input));
   case 'merchant_carbon_operation':return client.operation(input.requestId);
   case 'merchant_carbon_resume':return client.resume(input.requestId);
   case 'merchant_carbon_export':return client.download(input);
   case 'merchant_carbon_receive':{
    operationId(input.requestId);const destination=this.#config.carbonCustomerWorkspaces.destinations[input.destination];
    need(destination,'CARBON_DESTINATION_NOT_CONFIGURED','Choose a configured independent receiving alias.');
    need(!this.#entries.has(input.destination)&&!this.#opening.has(input.destination),'CARBON_RECEIVER_OPEN','Close the exact receiving instance before replaying its creation.');
    const source=await client.sourceForReceive(input,await this.#source(input));need(source,'CARBON_HANDOVER_REQUIRED','Select a complete retained handover or configured original handover file.');
    const receipt=await receiveCarbonWorkspace({kind:client.kind,destination,source,requestId:input.requestId,originWorkspaceId:client.summary.workspaceId,journalDirectory:await this.#root()});
    return {state:'RECEIVED',workspace:input.destination,kind:receipt.kind,workspaceId:receipt.workspaceId,source:receipt.source,requestId:receipt.requestId,
     next:'Open the returned receiver alias, inspect its preserved source and statement versions, then edit the independent workspace.'};
   }
   case 'merchant_carbon_file_read':{
    operationId(input.exportId);
    need(input.expectedSha256===undefined||/^[a-f0-9]{64}$/.test(input.expectedSha256),'CARBON_FILE_SHA','Use the exact retained SHA256.');
    need(input.offset===undefined||Number.isSafeInteger(input.offset)&&input.offset>=0,'CARBON_FILE_OFFSET','Use the original next byte offset.');
    need(input.limit===undefined||Number.isInteger(input.limit)&&input.limit>=1&&input.limit<=MAX_RETAINED_CHUNK_BYTES,'CARBON_FILE_LIMIT','Use a retained byte chunk from 1 to 196608.');
    return this.#reads.read({scope:this.#scope(alias),key:input.exportId,kind:'carbon-original-export',directory:client.directory,...input,load:()=>client.retained(input.exportId)});
   }
   case 'merchant_carbon_file_release':await this.#reads.release(this.#scope(alias),input.readId);return {state:'RELEASED',readId:input.readId};
   default:throw Object.assign(new Error('Unknown Carbon customer tool.'),{code:'TOOL_NOT_FOUND'});
  }
 }
 async #closeEntry(alias,e){
  if(!e.close){e.closing=true;e.client.requestClose();e.close=(async()=>{await Promise.allSettled([...e.pending]);
   try{await this.#reads.closeScope(this.#scope(alias));}finally{await e.client.close();}
   this.#entries.delete(alias);return {workspace:alias,...e.client.summary,state:e.client.summary.ownership==='owned'?'CLOSED':'DETACHED'};})();}
  return e.close;
 }
 async call(name,args={}){
  const spec=definitions.get(name);need(spec,'TOOL_NOT_FOUND','Choose an original Carbon customer tool.');exact(args,Object.keys(spec.properties),spec.required);
  need(!this.#closing||name==='merchant_carbon_close','CARBON_CLOSING','The original customer provider is closing.');
  if(name==='merchant_carbon_workspaces')return this.summary;
  if(name==='merchant_carbon_open')return this.#open(args.workspace);
  const e=this.#entry(args.workspace),{workspace,...input}=args;
  if(name==='merchant_carbon_close'){need(args.instanceId===e.client.instanceId,'CARBON_INSTANCE_CHANGED','Close only the exact returned attachment instance.');return this.#closeEntry(workspace,e);}
  const perform=()=>{need(!e.closing,'CARBON_CLOSING','The original attachment is closing.');return this.#execute(workspace,e.client,name,input);};
  const concurrent=name==='merchant_carbon_capture'&&input.command!=='start';
  const task=concurrent?Promise.resolve().then(perform):e.tail.then(perform);if(!concurrent)e.tail=task.catch(()=>{});
  e.pending.add(task);try{return {workspace,result:await task};}finally{e.pending.delete(task);}
 }
 requestClose(){this.#closing=true;for(const e of this.#entries.values()){e.closing=true;e.client.requestClose();}}
 close(){if(!this.#close){this.requestClose();this.#close=(async()=>{await Promise.allSettled([...this.#opening.values()]);
  const results=await Promise.allSettled([...this.#entries].map(([alias,e])=>this.#closeEntry(alias,e)));await this.#reads.close();
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;})();}return this.#close;}
}
