// MIT. Full follow-through operating workflow through the maintained merchant transport and retained reader.
import { RetainedFileReads } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { failure, plain, exact } from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { canonical, digest } from '../gis/shared.mjs';
import { openWorkspace } from './workspace.mjs';
import { readFollowThroughHostInput, readFollowThroughWorkspaceConfiguration } from './mcp-client.mjs';
import { followThroughWorkspaceTools, followThroughFileSelection } from './mcp-tools.mjs';
export { followThroughWorkspaceTools, readFollowThroughWorkspaceConfiguration };
export async function initializeFollowThroughMerchantWorkspace(options){return (await import('./mcp-setup.mjs')).initializeFollowThroughMerchantWorkspace(options);}
const definitions=new Map(followThroughWorkspaceTools((name,description,properties,required)=>({name,description,properties,required})).map(value=>[value.name,value]));
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
function small(value){need(Buffer.byteLength(JSON.stringify(value))<=2*1024*1024,'Choose a smaller row page or download the complete original file.','OPEN311_FOLLOW_THROUGH_VIEW_TOO_LARGE');return value;}
function page(items,{offset=0,limit=25}={}){need(offset<=items.length,'Choose an offset within the retained set.');const selected=items.slice(offset,offset+limit),next=offset+selected.length;return {items:selected,total:items.length,offset,limit,returned:selected.length,nextOffset:next<items.length?next:null};}
function finishPage(value){const next=value.offset+value.items.length;return {...value,returned:value.items.length,nextOffset:next<value.total?next:null};}
function operationView(value){
  if(!value)return null;const input={...value.input};
  if(typeof input.originalText==='string'){input.originalTextFile={bytes:Buffer.byteLength(input.originalText),sha256:digest(input.originalText)};delete input.originalText;}
  if(typeof input.contentBase64==='string'){const bytes=Buffer.from(input.contentBase64,'base64');input.originalBinaryFile={bytes:bytes.length,sha256:digest(bytes)};delete input.contentBase64;}
  if(typeof input.metadataText==='string'){input.metadataTextFile={bytes:Buffer.byteLength(input.metadataText),sha256:digest(input.metadataText)};delete input.metadataText;}
  return {...value,input};
}
function selection(args){
  const value=pick(args,Object.keys(followThroughFileSelection)),keys=['editionId','dispatchId','sourceId','returnId','operationId'].filter(key=>value[key]!==undefined);
  if(value.kind==='workspace')need(!keys.length&&!value.fileId,'A whole follow-through workspace does not select an item.');
  else if(value.kind==='source')need(keys.length===1&&keys[0]==='sourceId','Select one complete original source file.');
  else if(value.kind==='returned')need(keys.length===1&&keys[0]==='returnId','Select one complete reviewer file.');
  else if(value.kind==='operation')need(keys.length===1&&keys[0]==='operationId','Select one original operation.');
  else if(value.kind.startsWith('dispatch-'))need(keys.length===1&&keys[0]==='dispatchId','Select one reviewed dispatch.');
  else need(keys.length===1&&keys[0]==='editionId','Select one saved follow-through edition.');
  if(value.kind!=='source')need(!value.fileId,'An original file selection belongs to a source export.');
  need(Number.isSafeInteger(value.expectedRevision),'Pin the observed workspace revision for this file.');return value;
}
export class MerchantOpen311FollowThroughWorkspaces {
  #config;#exports;#workspaces=new Map();#tasks=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'OPEN311_FOLLOW_THROUGH',maxSnapshotBytes:268435456});
  constructor(config){this.#config=config.open311FollowThroughWorkspaces;this.#exports=config.exportsDirectory;}
  get summary(){return {configured:Boolean(this.#config),workspaces:Object.keys(this.#config?.workspaces??{}),openWorkspaces:this.#workspaces.size,...this.#reads.summary};}
  #entry(alias){const value=this.#config?.workspaces?.[alias];need(value,'Choose a configured follow-through workspace.','OPEN311_FOLLOW_THROUGH_WORKSPACE_UNKNOWN');return value;}
  #store(alias){const entry=this.#entry(alias);if(!this.#workspaces.has(alias))this.#workspaces.set(alias,openWorkspace(entry.directory));return this.#workspaces.get(alias);}
  #aliases(alias){const entry=this.#entry(alias);return {workspace:alias,label:entry.label,inputs:Object.entries(entry.inputs).map(([input,value])=>({input,label:value.label,sha256:value.sha256,kind:value.kind,format:value.format}))};}
  #atRevision(store,expectedRevision,action){
    const before=store.state();need(before.revision===expectedRevision,'The follow-through workspace revision changed. Refresh before selecting another view.','OPEN311_FOLLOW_THROUGH_REVISION_CONFLICT');
    const value=action(),after=store.state();
    need(after.workspaceId===before.workspaceId&&after.revision===before.revision,'The follow-through workspace changed during this view. Reopen it at one revision.','OPEN311_FOLLOW_THROUGH_REVISION_CONFLICT');
    return {workspaceId:before.workspaceId,revision:before.revision,value};
  }
  async #input(entry,args,kind){
    const selected=await readFollowThroughHostInput(entry,args.input,args.expectedSha256);
    if(kind)need(selected.input.kind===kind,'Choose a host input declared for '+kind+'.','OPEN311_FOLLOW_THROUGH_INPUT_KIND');
    return selected;
  }
  async #sourceOptions(entry,args,selected){
    const options={name:args.name??selected.name,kind:args.kind??selected.input.format,...pick(args,['sourceUrl','captureIds'])};let hostMetadata;
    if(args.metadataInput){
      const metadata=await this.#input(entry,{input:args.metadataInput,expectedSha256:args.expectedMetadataSha256},'metadata');
      options.metadataText=metadata.originalText;hostMetadata={alias:args.metadataInput,sha256:metadata.sha256,kind:'metadata',format:'json'};
    }else need(args.expectedMetadataSha256===undefined,'Select a metadata input before pinning its SHA-256.');
    return {options,...(hostMetadata?{hostMetadata}:{})};
  }
  async #call(name,args){
    const prefix='merchant_open311_follow_through_',command=name.slice(prefix.length);
    if(command==='workspaces')return {...this.summary,workspaces:Object.keys(this.#config?.workspaces??{}).map(alias=>this.#aliases(alias))};
    const alias=args.workspace,entry=this.#entry(alias),store=this.#store(alias);
    if(command==='status'){
      const state=store.state(),{sources,profiles,editions,work,returns,dispatches,operations,directory,...metadata}=state;
      return {...metadata,workspace:alias,label:entry.label,counts:{sources:sources.length,profiles:profiles.length,editions:editions.length,work:work.length,returns:returns.length,dispatches:dispatches.length},recentOperations:operations,...this.#reads.status(alias)};
    }
    if(command==='records'){
      const state=store.state();need(state.revision===args.expectedRevision,'The selected follow-through record revision changed.','OPEN311_FOLLOW_THROUGH_REVISION_CONFLICT');
      return {workspaceId:state.workspaceId,revision:state.revision,kind:args.kind,...page(state[args.kind],args)};
    }
    if(command==='input'){const selected=await this.#input(entry,args);return {workspace:alias,input:args.input,name:selected.name,kind:selected.input.kind,format:selected.input.format,bytes:selected.bytes.length,sha256:selected.sha256};}
    if(command==='inspect_source'){
      const selected=await this.#input(entry,args,'source'),prepared=await this.#sourceOptions(entry,args,selected);
      return store.inspectSource(selected.originalText,prepared.options);
    }
    if(['import_source','review_import','receive'].includes(command)){
      const kind=command==='import_source'?'source':command==='review_import'?'review':'workspace',selected=await this.#input(entry,args,kind),control={...pick(args,['requestId','expectedRevision']),hostInput:{alias:args.input,sha256:selected.sha256,kind,format:selected.input.format}};
      if(kind==='source'){const prepared=await this.#sourceOptions(entry,args,selected);return store.importSource({...control,...prepared.options,...(prepared.hostMetadata?{hostMetadata:prepared.hostMetadata}:{}),...pick(args,['role','seriesId','observedAt']),originalText:selected.originalText});}
      if(kind==='workspace')return store.receive({...control,originalText:selected.originalText});
      return store.importReview({...control,originalText:selected.originalText});
    }
    const mutations={profile_save:['putProfile','profile'],edition_build:['build','definition'],link_review:['putLink','selection'],work_save:['putWork','work'],review_apply:['applyReview','selection'],dispatch_create:['putDispatch','definition']};
    if(mutations[command]){const [method,key]=mutations[command];return store[method](pick(args,['requestId','expectedRevision',key]));}
    if(command==='record_info'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store[args.kind](args.id));return {workspaceId:view.workspaceId,revision:view.revision,...view.value};
    }
    const paged={source_rows:['sourceRows',['id','q']],requests:['requests',['editionId','q','discrepancy','assignee','workStatus']],orders:['orders',['editionId','q']],changes:['changes',['before','after','entity']],work_queue:['workQueue',['editionId','approval','assignee','status','q']]};
    if(paged[command]){
      const [method,keys]=paged[command],view=this.#atRevision(store,args.expectedRevision,()=>store[method]({...pick(args,[...keys,'offset']),limit:args.limit??25}));
      return {workspaceId:view.workspaceId,revision:view.revision,...finishPage(view.value)};
    }
    if(command==='request'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.request(pick(args,['editionId','key'])));return {workspaceId:view.workspaceId,revision:view.revision,...view.value};
    }
    if(command==='work_info'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.work(args.id));return {workspaceId:view.workspaceId,revision:view.revision,work:view.value.work,section:'history',...page(view.value.history,args)};
    }
    if(command==='return_info'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.returned(args.id,pick(args,['targetEditionId']))),section=args.section??'proposals',{proposals,decisions,...metadata}=view.value;
      return {workspaceId:view.workspaceId,revision:view.revision,...metadata,section,...page(section==='proposals'?proposals:decisions,args)};
    }
    if(command==='dispatch_info'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.dispatch(args.id)),{rows,...metadata}=view.value;
      return {workspaceId:view.workspaceId,revision:view.revision,...metadata,...page(rows,args)};
    }
    if(command==='operation')return operationView(store.operation(args.requestId));
    if(command==='file_release'){await this.#reads.release(alias,args.readId);return {workspace:alias,readId:args.readId,state:'RELEASED'};}
    if(command==='file_read'){
      const chosen=selection(args);
      return this.#reads.read({scope:alias,key:canonical(chosen),kind:'open311-follow-through-'+chosen.kind,directory:this.#exports,readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
        load:()=>this.#atRevision(store,chosen.expectedRevision,()=>{
          let file;if(chosen.kind==='operation'){
            const operation=store.operation(chosen.operationId);need(operation,'The original follow-through operation was not found.','OPEN311_FOLLOW_THROUGH_OPERATION_UNKNOWN');
            file={filename:'follow-through-operation-'+digest(chosen.operationId).slice(0,24)+'.json',contentType:'application/json; charset=utf-8',body:canonical({schema:'commons.open311.follow-through-operation-export.v1',operation})+'\n'};
          }else file=store.exportFile(chosen);
          return {name:file.filename,type:file.contentType,bytes:Buffer.isBuffer(file.body)?file.body:Buffer.from(file.body,'utf8')};
        }).value});
    }
    throw failure('INVALID_PARAMS','Unknown follow-through workspace tool.');
  }
  call(name,args={}){
    need(!this.#closing,'The follow-through provider is closing.','OPEN311_FOLLOW_THROUGH_MCP_CLOSED');
    const definition=definitions.get(name);need(definition&&plain(args),'Choose a declared follow-through workspace tool.');
    exact(args,Object.keys(definition.properties),definition.required);
    for(const [key,value] of Object.entries(args))validate(value,definition.properties[key],key);
    const snapshot=clone(args),task=Promise.resolve().then(()=>this.#call(name,snapshot)).then(small);
    this.#tasks.add(task);task.finally(()=>this.#tasks.delete(task)).catch(()=>{});return task;
  }
  close(){
    if(!this.#close){this.#closing=true;this.#close=(async()=>{await Promise.allSettled([...this.#tasks]);await this.#reads.close();for(const store of this.#workspaces.values())store.close();this.#workspaces.clear();})().catch(error=>{this.#close=null;throw error;});}
    return this.#close;
  }
}
