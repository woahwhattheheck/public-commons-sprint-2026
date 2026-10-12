// MIT. Native agent workflow over the same retained WFS browser owner.
import { basename } from 'node:path';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { need,plain,canonical,clone,digest,LIMITS } from './model.mjs';
import { WfsWorkspaceClient,readWfsHostInput,readWfsWorkspaceConfiguration } from './mcp-client.mjs';
import { wfsWorkspaceTools,wfsFileSelection } from './mcp-tools.mjs';
export { wfsWorkspaceTools,readWfsWorkspaceConfiguration };

const definitions=new Map(wfsWorkspaceTools((name,description,properties,required)=>({name,description,properties,required})).map(item=>[item.name,item]));
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
    'Read a smaller original row/record page or download its complete source/customer file.','WFS_VIEW_TOO_LARGE',413);
  return value;
}
function projectSummary(project) {
  const collections=['sources','schemas','queries','orders','comparisons','publications','operations'];
  const view=Object.fromEntries(Object.entries(project).filter(([key])=>!collections.includes(key)&&key!=='pending'));
  return{...view,counts:Object.fromEntries(collections.map(key=>[key,project[key].length])),
    pending:project.pending?{id:project.pending.id,kind:project.pending.kind,expectedRevision:project.pending.expectedRevision,
      startedAt:project.pending.startedAt,lastError:project.pending.lastError,payloadSha256:project.pending.payloadSha256}:null};
}
function resultView(value) {
  if(!value?.page)return value;
  const{page,...metadata}=value;
  return {...metadata,delivery:{format:'ORIGINAL_DATASET_PAGE',snapshot:value.metadata?.snapshot??page.snapshot,
    nextCursor:value.metadata?.nextCursor??page.nextCursor??null,
    completeDownload:'merchant_wfs_file_read kind customer with the same publicationId and intentId'}};
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
function actionInput(args,allowed) {
  need(Object.keys(args).every(key=>['workspace','action'].includes(key)||allowed.includes(key)),
    'Use the fields belonging to this original action.');
  return pick(args,allowed);
}
export class MerchantWfsWorkspaces {
  #config;#exports;#clients=new Map();#tasks=new Set();#closed=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'WFS',maxSnapshotBytes:LIMITS.projectBytes});
  constructor(config){this.#config=config.wfsWorkspaces;this.#exports=config.exportsDirectory;}
  get summary(){return {configured:Boolean(this.#config),workspaces:Object.keys(this.#config?.workspaces??{}),
    attachedClients:this.#clients.size,...this.#reads.summary};}
  #entry(alias){need(!this.#closed,'The borrowed feature-workspace provider is closing.','WFS_MCP_CLOSED',409);
    const entry=this.#config?.workspaces?.[alias];need(entry,'Choose a configured original feature workspace.','WFS_WORKSPACE_UNKNOWN',404);return entry;}
  #client(alias){const entry=this.#entry(alias);if(!this.#clients.has(alias))this.#clients.set(alias,new WfsWorkspaceClient(entry));return this.#clients.get(alias);}
  #inputs(alias) {const entry=this.#entry(alias);return {workspace:alias,label:entry.label,projectId:entry.projectId,
    bindingSha256:entry.expectedBindingSha256,
    inputs:Object.entries(entry.inputs).map(([input,row])=>({input,label:row.label,kind:row.kind,sha256:row.sha256})),
    merchantProfiles:Object.entries(entry.merchantProfiles).map(([profile,row])=>({profile,...row}))};}
  async #state(alias,expectedRevision) {const value=await this.#client(alias).query('state');
    if(expectedRevision!==undefined)need(value.project.revision===expectedRevision,'The original project revision changed; restart this record page from its current revision.','WFS_REVISION_CONFLICT',409);return value;}
  async #call(name,args) {
    if(name==='merchant_wfs_workspaces')return {...this.summary,workspaces:Object.keys(this.#config?.workspaces??{}).map(alias=>this.#inputs(alias))};
    const alias=args.workspace,entry=this.#entry(alias),client=this.#client(alias);
    if(name==='merchant_wfs_status'){
      const value=await this.#state(alias);return {...this.#inputs(alias),project:projectSummary(value.project),
        merchant:value.merchant,busy:value.busy,buyerConfigured:value.buyerConfigured,client:client.metadata,fileReads:this.#reads.status(alias)};
    }
    if(name==='merchant_wfs_records'||name==='merchant_wfs_record'){
      const{project}=await this.#state(alias,args.expectedRevision),values=project[args.kind];
      if(name==='merchant_wfs_record'){
        const item=values.find(value=>value.id===args.id);
        if(!item&&args.kind==='operations'&&project.pending?.id===args.id)return {revision:project.revision,state:'PENDING',item:project.pending};
        need(item,'This original record does not exist.','WFS_RECORD_UNKNOWN',404);return {revision:project.revision,item};
      }
      const offset=args.offset??0,limit=args.limit??25;need(offset<=values.length,'Select an offset in the original record collection.');
      const items=values.slice(offset,offset+limit);
      return {revision:project.revision,total:values.length,offset,returned:items.length,nextOffset:offset+items.length<values.length?offset+items.length:null,items};
    }
    if(name==='merchant_wfs_query')return client.query(args.kind,args.input??{});
    if(name==='merchant_wfs_input'){
      const found=await readWfsHostInput(entry,args.input);
      return{workspace:alias,input:args.input,kind:'project',name:basename(found.input.path),bytes:found.bytes.length,
        sha256:found.sha256,schema:found.value.schema,bundleSha256:found.value.bundleSha256};
    }
    if(name==='merchant_wfs_import'){
      const found=await readWfsHostInput(entry,args.input,args.expectedSha256);
      return client.action({action:'project-receive',bundle:found.value});
    }
    if(name==='merchant_wfs_publish'||name==='merchant_wfs_export'){
      const profile=name==='merchant_wfs_publish'?entry.merchantProfiles[args.profile]:null;
      if(name==='merchant_wfs_publish')need(profile,'Choose the configured merchant profile.','WFS_PROFILE_UNKNOWN',404);
      return client.action({action:'export-order',id:args.id,expectedRevision:args.expectedRevision,orderId:args.orderId,plan:args.plan,
        ...(profile?{origin:profile.origin,path:profile.path,payment:profile.payment}:{})});
    }
    const actions={merchant_wfs_discover:'discover',merchant_wfs_describe:'describe',merchant_wfs_save_query:'save-query',
      merchant_wfs_download_order:'run-order',merchant_wfs_compare:'compare',merchant_wfs_abandon:'abandon'};
    if(actions[name]){const{workspace,...body}=args;return client.action({action:actions[name],...body});}
    if(name==='merchant_wfs_merchant')return client.action({action:args.action==='open'?'publication-open':'merchant-'+args.action,publicationId:args.publicationId});
    if(name==='merchant_wfs_purchase'){
      const keys=args.action==='prepare'?['publicationId','intentId','query','kind','file','previous','acceptIndex']:['publicationId','intentId'];
      return resultView(await client.action({action:args.action,...actionInput(args,keys)}));
    }
    if(name==='merchant_wfs_dataset'){
      const action=args.action==='reopen'?'customer-reopen':args.action==='open'?'customer-open':'dataset-'+args.action;
      const keys=args.action==='prepare'?['publicationId','id','kind','query','maxPages','maxRows','maxTotalAtomic','acceptIndex']:['publicationId','id'];
      return client.action({action,...actionInput(args,keys)});
    }
    if(name==='merchant_wfs_cancel')return client.cancel(args.id);
    if(name==='merchant_wfs_file_release'){await this.#reads.release(alias,args.readId);return {workspace:alias,readId:args.readId,state:'RELEASED'};}
    if(name==='merchant_wfs_file_read'){
      const selection=pick(args,Object.keys(wfsFileSelection)),{kind,...input}=selection;
      return this.#reads.read({scope:alias,key:canonical(selection),kind:'wfs-'+kind,directory:this.#exports,
        expectedSha256:args.expectedSha256,readId:args.readId,offset:args.offset,limit:args.limit,
        load:()=>client.download(kind,input)});
    }
    need(false,'Unknown original feature-workspace tool.');
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
