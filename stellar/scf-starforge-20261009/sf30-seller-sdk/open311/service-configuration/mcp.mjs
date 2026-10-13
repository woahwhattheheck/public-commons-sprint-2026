// MIT. Original service configuration, routing and implementation handovers through the installed merchant and retained-file contracts.
import { RetainedFileReads } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { failure, plain, exact } from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { canonical, digest, parseJson } from '../gis/shared.mjs';
import { openWorkspace } from './workspace.mjs';
import { readServiceConfigurationHostInput, readServiceConfigurationWorkspaceConfiguration } from './mcp-client.mjs';
import { serviceConfigurationWorkspaceTools, serviceConfigurationFileSelection } from './mcp-tools.mjs';
export { serviceConfigurationWorkspaceTools, readServiceConfigurationWorkspaceConfiguration };
export async function initializeServiceConfigurationMerchantWorkspace(options){return (await import('./mcp-setup.mjs')).initializeServiceConfigurationMerchantWorkspace(options);}
const definitions=new Map(serviceConfigurationWorkspaceTools((name,description,properties,required)=>({name,description,properties,required})).map(value=>[value.name,value]));
const need=(condition,message,code='INVALID_PARAMS')=>{if(!condition)throw failure(code,message);};
const clone=value=>JSON.parse(canonical(value));
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
function validate(value,schema,name){
  if(Array.isArray(schema.type)){
    const actual=value===null?'null':Array.isArray(value)?'array':typeof value;
    need(schema.type.includes(actual),'Use the declared '+name+'.');return validate(value,{...schema,type:actual},name);
  }
  if(schema.type==='null')need(value===null,'Use NULL for '+name+'.');
  if(schema.type==='string')need(typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Number.MAX_SAFE_INTEGER)&&(!schema.pattern||new RegExp(schema.pattern).test(value)),'Use the declared '+name+'.');
  if(schema.type==='number')need(typeof value==='number'&&Number.isFinite(value)&&value>=(schema.minimum??-Number.MAX_VALUE)&&value<=(schema.maximum??Number.MAX_VALUE),'Use a finite numeric '+name+'.');
  if(schema.type==='integer')need(Number.isSafeInteger(value)&&value>=(schema.minimum??0)&&value<=(schema.maximum??Number.MAX_SAFE_INTEGER),'Use the supported integer '+name+'.');
  if(schema.type==='boolean')need(typeof value==='boolean','Use a boolean '+name+'.');
  if(schema.enum)need(schema.enum.includes(value),'Choose a declared '+name+'.');
  if(schema.type==='array'){
    need(Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Number.MAX_SAFE_INTEGER),'Use the declared array '+name+'.');
    if(schema.uniqueItems)need(new Set(value.map(canonical)).size===value.length,'Choose distinct '+name+' entries.');
    if(schema.items)for(let i=0;i<value.length;i++)validate(value[i],schema.items,name+'['+i+']');
  }
  if(schema.type==='object'){
    need(plain(value),'Use the complete '+name+' object.');
    if(schema.additionalProperties===false)exact(value,Object.keys(schema.properties),schema.required??[]);
    for(const key of schema.required??[])need(Object.hasOwn(value,key),'Supply '+name+'.'+key+'.');
    if(schema.additionalProperties&&typeof schema.additionalProperties==='object')for(const [key,item]of Object.entries(value))if(!schema.properties?.[key])validate(item,schema.additionalProperties,name+'.'+key);
    for(const [key,item] of Object.entries(value))if(schema.properties?.[key])validate(item,schema.properties[key],name+'.'+key);
  }
}

function small(value){need(Buffer.byteLength(JSON.stringify(value))<=2*1024*1024,'Choose a smaller row page or download the complete original file.','OPEN311_SERVICE_CONFIGURATION_VIEW_TOO_LARGE');return value;}
function page(items,{offset=0,limit=25}={}){
  need(offset<=items.length,'Choose an offset within the retained set.');const selected=items.slice(offset,offset+limit),next=offset+selected.length;
  return {items:selected,total:items.length,offset,limit,returned:selected.length,nextOffset:next<items.length?next:null};
}
function finishPage(value){const next=value.offset+value.items.length;return {...value,returned:value.items.length,nextOffset:next<value.total?next:null};}
function operationView(value){
  if(!value)return null;const input={...value.input};
  if(typeof input.originalText==='string'){
    input.originalTextFile={bytes:Buffer.byteLength(input.originalText),sha256:digest(input.originalText)};delete input.originalText;
  }
  if(input.profile?.definition!==undefined){
    const definition=canonical(input.profile.definition),{definition:ignored,...profile}=input.profile;
    input.profile={...profile,definitionFile:{bytes:Buffer.byteLength(definition),sha256:digest(definition)}};
  }
  return {...value,input};
}
function selection(args){
  const value=pick(args,Object.keys(serviceConfigurationFileSelection));
  const selectors=['profileId','profileVersionId','sourceId','previewId','releaseId','operationId'].filter(key=>value[key]!==undefined);
  if(value.kind==='workspace')need(!selectors.length,'A complete service workspace does not select a single item.');
  else if(value.kind==='profile')need(selectors.length>0&&selectors.every(key=>key==='profileId'||key==='profileVersionId'),'Select the original profile, its saved version, or both.');
  else {
    const expected={source:'sourceId','preview-json':'previewId','preview-csv':'previewId','release-json':'releaseId','release-report':'releaseId',operation:'operationId'}[value.kind];
    need(expected&&selectors.length===1&&selectors[0]===expected,'Select the original item belonging to this file kind.');
  }
  need(Number.isSafeInteger(value.expectedRevision),'Pin the observed workspace revision for this file.');return value;
}
function profileSummary(profile){return pick(profile,['schema','id','versionId','previousVersionId','createdAt','sha256']);}
function previewSummary(preview){const {items,implications,overrides,...metadata}=preview;return {...metadata,implications:implications.length,overrides:overrides.length};}
export class MerchantOpen311ServiceConfigurationWorkspaces {
  #config;#exports;#workspaces=new Map();#tasks=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'OPEN311_SERVICE_CONFIGURATION',maxSnapshotBytes:268435456});
  constructor(config){this.#config=config.open311ServiceConfigurationWorkspaces;this.#exports=config.exportsDirectory;}
  get summary(){return {configured:Boolean(this.#config),workspaces:Object.keys(this.#config?.workspaces??{}),openWorkspaces:this.#workspaces.size,...this.#reads.summary};}
  #entry(alias){const entry=this.#config?.workspaces?.[alias];need(entry,'Choose a configured service workspace.','OPEN311_SERVICE_CONFIGURATION_WORKSPACE_UNKNOWN');return entry;}
  #store(alias){const entry=this.#entry(alias);if(!this.#workspaces.has(alias))this.#workspaces.set(alias,openWorkspace(entry.directory,{create:false}));return this.#workspaces.get(alias);}
  #aliases(alias){
    const entry=this.#entry(alias);return {workspace:alias,label:entry.label,inputs:Object.entries(entry.inputs).map(([input,value])=>({
      input,label:value.label,sha256:value.sha256,kind:value.kind,format:value.format,contentType:value.contentType}))};
  }
  #atRevision(store,expectedRevision,action){
    const before=store.state();need(before.revision===expectedRevision,'The service workspace revision changed. Refresh before selecting another view.','OPEN311_SERVICE_CONFIGURATION_REVISION_CONFLICT');
    const value=action(),after=store.state();
    need(after.workspaceId===before.workspaceId&&after.revision===before.revision,'The service workspace changed during this view. Reopen it at one revision.','OPEN311_SERVICE_CONFIGURATION_REVISION_CONFLICT');
    return {workspaceId:before.workspaceId,revision:before.revision,value};
  }
  async #input(entry,args,kind){
    const selected=await readServiceConfigurationHostInput(entry,args.input,args.expectedSha256);
    if(kind)need(selected.input.kind===kind,'Choose a host input declared for '+kind+'.','OPEN311_SERVICE_CONFIGURATION_INPUT_KIND');
    return selected;
  }
  async #call(name,args){
    const command=name.slice('merchant_open311_service_configuration_'.length);
    if(command==='workspaces')return {...this.summary,workspaces:Object.keys(this.#config?.workspaces??{}).map(alias=>this.#aliases(alias))};
    const alias=args.workspace,entry=this.#entry(alias),store=this.#store(alias);
    if(command==='status'){
      const state=store.state(),{directory,sources,profiles,previews,releases,operations,...metadata}=state;
      return {...metadata,workspace:alias,label:entry.label,recentOperations:operations.slice(-100),...this.#reads.status(alias)};
    }
    if(command==='records'){
      const view=this.#atRevision(store,args.expectedRevision,()=>{
        const values=store.state()[args.kind],q=String(args.q??'').toLocaleLowerCase();
        return page(q?values.filter(value=>canonical(value).toLocaleLowerCase().includes(q)):values,args);
      });return {workspaceId:view.workspaceId,revision:view.revision,kind:args.kind,...view.value};
    }
    if(command==='input'){
      const selected=await this.#input(entry,args);return {workspace:alias,input:args.input,name:selected.name,kind:selected.input.kind,
        format:selected.input.format,contentType:selected.input.contentType,bytes:selected.bytes.length,sha256:selected.sha256};
    }
    if(command==='inspect_source'){const selected=await this.#input(entry,args,'source');return store.inspectSource(selected.originalText);}
    if(['import_source','profile_import','receive'].includes(command)){
      const kind={import_source:'source',profile_import:'profile',receive:'workspace'}[command],selected=await this.#input(entry,args,kind);
      const control={...pick(args,['requestId','expectedRevision']),hostInput:{alias:args.input,sha256:selected.sha256,kind,format:selected.input.format}};
      if(command==='import_source')return store.importSource({...control,...pick(args,['name','selection']),originalText:selected.originalText});
      if(command==='profile_import'){
        const original=parseJson(selected.originalText,'Original selected service configuration'),definition=original.definition??original;
        return store.putProfile({...control,...pick(args,['expectedProfileVersionId']),profile:{...(args.profileId?{id:args.profileId}:{}),definition},originalText:selected.originalText});
      }
      return store.receive({...control,originalText:selected.originalText});
    }
    const mutations={
      profile_save:['putProfile',['profile','expectedProfileVersionId']],
      preview_create:['createPreview',['name','profileId','expectedProfileVersionId','sourceId','mapping','overrides','baseline']],
      release_create:['createRelease',['name','profileId','expectedProfileVersionId','previewId','reviewer','note']]
    };
    if(mutations[command]){const [method,keys]=mutations[command];return store[method](pick(args,['requestId','expectedRevision',...keys]));}
    if(command==='source'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.source(args.id));
      return {workspaceId:view.workspaceId,revision:view.revision,source:view.value.source};
    }
    if(command==='source_rows'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.sourceRows({...pick(args,['sourceId','q','offset']),limit:args.limit??25}));
      return {workspaceId:view.workspaceId,revision:view.revision,...finishPage(view.value)};
    }
    if(command==='profile'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.profile(args.id));
      return {workspaceId:view.workspaceId,revision:view.revision,profile:view.value.profile,section:'history',historyCount:view.value.history.length,...page(view.value.history,args)};
    }
    if(command==='preview'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.preview({...pick(args,['id','q','offset']),limit:args.limit??25}));
      return {workspaceId:view.workspaceId,revision:view.revision,...finishPage(view.value)};
    }
    if(command==='release'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.release(args.id));
      const {profile,preview,source,baseline,remaining,applyOrder,implications,...metadata}=view.value.release,section=args.section??'remaining';
      const {originalText,...sourceMetadata}=source;
      const selected={remaining,'apply-order':applyOrder,implications}[section];
      return {workspaceId:view.workspaceId,revision:view.revision,release:{...metadata,profile:{...profileSummary(profile),name:profile.definition.name},
        preview:previewSummary(preview),source:sourceMetadata,baseline:baseline?{...baseline,profile:{...profileSummary(baseline.profile),name:baseline.profile.definition.name}}:null,
        remaining:remaining.length,applyOrder:applyOrder.length,implications:implications.length},section,...page(selected,args)};
    }
    if(command==='operation')return operationView(store.operation(args.requestId));
    if(command==='file_release'){await this.#reads.release(alias,args.readId);return {workspace:alias,readId:args.readId,state:'RELEASED'};}
    if(command==='file_read'){
      const chosen=selection(args);
      return this.#reads.read({scope:alias,key:canonical(chosen),kind:'open311-service-configuration-'+chosen.kind,directory:this.#exports,
        readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
        load:()=>this.#atRevision(store,chosen.expectedRevision,()=>{
          let file;
          if(chosen.kind==='operation'){
            const operation=store.operation(chosen.operationId);need(operation,'The original service operation was not found.','OPEN311_SERVICE_CONFIGURATION_OPERATION_UNKNOWN');
            file={filename:'service-configuration-operation-'+digest(chosen.operationId).slice(0,24)+'.json',contentType:'application/json; charset=utf-8',
              body:canonical({schema:'commons.open311.service-configuration-operation-export.v1',operation})+'\n'};
          }else file=store.exportFile(chosen);
          return {name:file.filename,type:file.contentType,bytes:typeof file.body==='string'?Buffer.from(file.body,'utf8'):Buffer.from(file.body)};
        }).value});
    }
    throw failure('INVALID_PARAMS','Unknown service configuration workspace tool.');
  }
  call(name,args={}){
    need(!this.#closing,'The service configuration provider is closing.','OPEN311_SERVICE_CONFIGURATION_MCP_CLOSED');
    const definition=definitions.get(name);need(definition&&plain(args),'Choose a declared service configuration workspace tool.');
    exact(args,Object.keys(definition.properties),definition.required);
    for(const [key,value] of Object.entries(args))validate(value,definition.properties[key],key);
    const snapshot=clone(args),task=Promise.resolve().then(()=>this.#call(name,snapshot)).then(small);
    this.#tasks.add(task);task.finally(()=>this.#tasks.delete(task)).catch(()=>{});return task;
  }
  close(){
    if(!this.#close){this.#closing=true;this.#close=(async()=>{
      await Promise.allSettled([...this.#tasks]);await this.#reads.close();
      for(const store of this.#workspaces.values())store.close();this.#workspaces.clear();
    })().catch(error=>{this.#close=null;throw error;});}
    return this.#close;
  }
}
