// MIT. Native agent workflow over the same retained GDELT browser owner.
import { basename } from 'node:path';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { need,plain,canonical,clone,digest,LIMITS } from './model.mjs';
import { GdeltWorkspaceClient,readGdeltHostInput,readGdeltWorkspaceConfiguration } from './mcp-client.mjs';
import { gdeltWorkspaceTools,gdeltFileSelection } from './mcp-tools.mjs';
export { gdeltWorkspaceTools,readGdeltWorkspaceConfiguration };

const definitions=new Map(gdeltWorkspaceTools((name,description,properties,required)=>({name,description,properties,required})).map(item=>[item.name,item]));
function validate(value,schema,key) {
  if(schema.type==='string')need(typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Number.MAX_SAFE_INTEGER)&&
    (!schema.pattern||new RegExp(schema.pattern).test(value)),'Use the declared '+key+'.');
  if(schema.type==='integer')need(Number.isSafeInteger(value)&&value>=(schema.minimum??0)&&value<=(schema.maximum??Number.MAX_SAFE_INTEGER),'Use the supported integer '+key+'.');
  if(schema.type==='boolean')need(typeof value==='boolean','Use a boolean '+key+'.');
  if(schema.type==='object')need(plain(value),'Use a complete JSON '+key+' object.');
  if(schema.enum)need(schema.enum.includes(value),'Choose a declared '+key+'.');
  if(schema.type==='array'){
    need(Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??1000)&&
      (!schema.uniqueItems||new Set(value.map(canonical)).size===value.length),'Use the complete distinct '+key+' list.');
    value.forEach(item=>validate(item,schema.items,key));
  }
}
function small(value) {
  need(Buffer.byteLength(JSON.stringify(value))<=2*1024*1024,
    'Read a smaller original row/record page or download its complete source/customer file.','GDELT_VIEW_TOO_LARGE',413);
  return value;
}
function projectSummary(project) {
  const{captures,reviews,publications,operations,pending,...rest}=project;
  return {...rest,counts:{captures:captures.length,reviews:reviews.length,publications:publications.length,operations:operations.length},
    pending:pending?{id:pending.id,kind:pending.kind,expectedRevision:pending.expectedRevision,
      startedAt:pending.startedAt,lastError:pending.lastError,payloadSha256:digest(pending.payload)}:null};
}
function discoveryView(value) {
  const {body,...manifest}=value.manifest;
  return {...value,manifest,sourceManifestBytes:Buffer.byteLength(body),completeManifest:'Retained under this discoveryId in the original project.'};
}
function resultView(value) {
  if(!value?.page)return value;
  const{page,...metadata}=value;
  return {...metadata,delivery:{format:'ORIGINAL_DATASET_PAGE',snapshot:value.metadata?.snapshot??page.snapshot,
    nextCursor:value.metadata?.nextCursor??page.nextCursor??null,
    completeDownload:'merchant_gdelt_file_read kind customer with the same publicationId and intentId'}};
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
function actionInput(args,allowed) {
  need(Object.keys(args).every(key=>['workspace','action'].includes(key)||allowed.includes(key)),
    'Use the fields belonging to this original action.');
  return pick(args,allowed);
}
export class MerchantGdeltWorkspaces {
  #config;#exports;#clients=new Map();#tasks=new Set();#closed=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'GDELT',maxSnapshotBytes:LIMITS.projectBytes});
  constructor(config){this.#config=config.gdeltWorkspaces;this.#exports=config.exportsDirectory;}
  get summary(){return {configured:Boolean(this.#config),workspaces:Object.keys(this.#config?.workspaces??{}),
    attachedClients:this.#clients.size,...this.#reads.summary};}
  #entry(alias){need(!this.#closed,'The borrowed event-desk provider is closing.','GDELT_MCP_CLOSED',409);
    const entry=this.#config?.workspaces?.[alias];need(entry,'Choose a configured original event desk.','GDELT_WORKSPACE_UNKNOWN',404);return entry;}
  #client(alias){const entry=this.#entry(alias);if(!this.#clients.has(alias))this.#clients.set(alias,new GdeltWorkspaceClient(entry));return this.#clients.get(alias);}
  #inputs(alias) {const entry=this.#entry(alias);return {workspace:alias,label:entry.label,projectId:entry.projectId,
    bindingSha256:entry.expectedBindingSha256,
    inputs:Object.entries(entry.inputs).map(([input,row])=>({input,label:row.label,kind:row.kind,sha256:row.sha256})),
    merchantProfiles:Object.entries(entry.merchantProfiles).map(([profile,row])=>({profile,...row}))};}
  async #state(alias,expectedRevision) {const value=await this.#client(alias).query('state');
    if(expectedRevision!==undefined)need(value.project.revision===expectedRevision,'The original project revision changed; restart this record page from its current revision.','GDELT_REVISION_CONFLICT',409);return value;}
  async #call(name,args) {
    if(name==='merchant_gdelt_workspaces')return {...this.summary,workspaces:Object.keys(this.#config?.workspaces??{}).map(alias=>this.#inputs(alias))};
    const alias=args.workspace,entry=this.#entry(alias),client=this.#client(alias);
    if(name==='merchant_gdelt_status'){
      const value=await this.#state(alias);return {...this.#inputs(alias),project:projectSummary(value.project),
        merchant:value.merchant,busy:value.busy,buyerConfigured:value.buyerConfigured,client:client.metadata,fileReads:this.#reads.status(alias)};
    }
    if(name==='merchant_gdelt_records'||name==='merchant_gdelt_record'){
      const{project}=await this.#state(alias,args.expectedRevision),values=project[args.kind];
      if(name==='merchant_gdelt_record'){
        const item=values.find(value=>value.id===args.id);
        if(!item&&args.kind==='operations'&&project.pending?.id===args.id)return {revision:project.revision,state:'PENDING',item:project.pending};
        need(item,'This original record does not exist.','GDELT_RECORD_UNKNOWN',404);return {revision:project.revision,item};
      }
      const offset=args.offset??0,limit=args.limit??25;need(offset<=values.length,'Select an offset in the original record collection.');
      const items=values.slice(offset,offset+limit);
      return {revision:project.revision,total:values.length,offset,returned:items.length,nextOffset:offset+items.length<values.length?offset+items.length:null,items};
    }
    if(name==='merchant_gdelt_query')return client.query(args.kind,args.input??{});
    if(name==='merchant_gdelt_discover')return discoveryView(await client.action({action:'discover',history:args.history??false}));
    if(name==='merchant_gdelt_discovery')return discoveryView({...await client.query('discovery',{id:args.id}),discoveryId:args.id});
    if(name==='merchant_gdelt_input'){
      const found=await readGdeltHostInput(entry,args.input);
      return {workspace:alias,input:args.input,kind:found.input.kind,name:basename(found.input.path),
        bytes:found.bytes.length,sha256:found.sha256,schema:found.value.schema,captureId:found.value.captureId??null,
        batch:found.value.batch??null,bundleSha256:found.value.bundleSha256??null};
    }
    if(name==='merchant_gdelt_import'){
      const found=await readGdeltHostInput(entry,args.input,args.expectedSha256);
      if(found.input.kind==='project')return client.action({action:'project-receive',bundle:found.value});
      return client.action({action:'import',id:args.id,expectedRevision:args.expectedRevision,capture:found.value});
    }
    if(name==='merchant_gdelt_publish'){
      const profile=entry.merchantProfiles[args.profile];need(profile,'Choose an original configured merchant profile.','GDELT_PROFILE_UNKNOWN',404);
      return client.action({action:'publish',id:args.id,expectedRevision:args.expectedRevision,reviewId:args.reviewId,
        origin:profile.origin,path:profile.path,payment:profile.payment});
    }
    for(const action of ['capture','review','select','abandon'])if(name==='merchant_gdelt_'+action){
      const{workspace,...body}=args;return client.action({action,...body});
    }
    if(name==='merchant_gdelt_merchant')return client.action({action:'merchant-'+args.action,publicationId:args.publicationId});
    if(name==='merchant_gdelt_purchase'){
      const keys=args.action==='prepare'?['publicationId','intentId','query','kind','file','previous','acceptIndex']:['publicationId','intentId'];
      return resultView(await client.action({action:args.action,...actionInput(args,keys)}));
    }
    if(name==='merchant_gdelt_dataset'){
      const action=args.action==='reopen'?'customer-reopen':args.action==='open'?'customer-open':'dataset-'+args.action;
      const keys=args.action==='prepare'?['publicationId','id','kind','query','maxPages','maxRows','maxTotalAtomic','acceptIndex']:['publicationId','id'];
      return client.action({action,...actionInput(args,keys)});
    }
    if(name==='merchant_gdelt_cancel')return client.cancel(args.id);
    if(name==='merchant_gdelt_file_release'){await this.#reads.release(alias,args.readId);return {workspace:alias,readId:args.readId,state:'RELEASED'};}
    if(name==='merchant_gdelt_file_read'){
      const selection=pick(args,Object.keys(gdeltFileSelection)),{kind,...input}=selection;
      return this.#reads.read({scope:alias,key:canonical(selection),kind:'gdelt-'+kind,directory:this.#exports,
        expectedSha256:args.expectedSha256,readId:args.readId,offset:args.offset,limit:args.limit,
        load:()=>client.download(kind,input)});
    }
    need(false,'Unknown original event-desk tool.');
  }
  call(name,args={}) {
    const definition=definitions.get(name);
    need(!this.#closed&&definition&&plain(args)&&Object.keys(args).every(key=>Object.hasOwn(definition.properties,key))&&
      definition.required.every(key=>Object.hasOwn(args,key)),'Use the declared original tool fields.');
    for(const [key,value]of Object.entries(args))validate(value,definition.properties[key],key);
    const task=Promise.resolve().then(()=>this.#call(name,args)).then(small);this.#tasks.add(task);
    task.finally(()=>this.#tasks.delete(task)).catch(()=>{});return task;
  }
  close() {
    if(!this.#close){this.#closed=true;this.#close=(async()=>{
      await Promise.all([...this.#clients.values()].map(client=>client.close()));
      await Promise.allSettled([...this.#tasks]);await this.#reads.close();this.#clients.clear();
    })().catch(error=>{this.#close=null;throw error;});}return this.#close;
  }
}
