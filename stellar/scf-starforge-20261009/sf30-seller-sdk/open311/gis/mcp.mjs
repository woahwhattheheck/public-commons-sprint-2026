// MIT. Full GIS operating workflow through the maintained merchant transport and retained reader.
import { RetainedFileReads } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { failure, plain, exact } from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { canonical, digest } from './shared.mjs';
import { openWorkspace } from './workspace.mjs';
import { readGISHostInput, readGISWorkspaceConfiguration } from './mcp-client.mjs';
import { gisWorkspaceTools, gisFileSelection } from './mcp-tools.mjs';
export { gisWorkspaceTools, readGISWorkspaceConfiguration };
export async function initializeGISMerchantWorkspace(options){return (await import('./mcp-setup.mjs')).initializeGISMerchantWorkspace(options);}
const definitions=new Map(gisWorkspaceTools((name,description,properties,required)=>({name,description,properties,required})).map(value=>[value.name,value]));
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
    for(const [key,item] of Object.entries(value))if(schema.properties?.[key])validate(item,schema.properties[key],name+'.'+key);
  }
}
function small(value){need(Buffer.byteLength(JSON.stringify(value))<=2*1024*1024,'Choose a smaller row page or download the complete original file.','OPEN311_GIS_VIEW_TOO_LARGE');return value;}
function page(items,{offset=0,limit=25}={}){need(offset<=items.length,'Choose an offset within the retained set.');const selected=items.slice(offset,offset+limit),next=offset+selected.length;return {items:selected,total:items.length,offset,limit,returned:selected.length,nextOffset:next<items.length?next:null};}
function finishPage(value){const next=value.offset+value.items.length;return {...value,returned:value.items.length,nextOffset:next<value.total?next:null};}
function operationView(value){
  if(!value)return null;const input={...value.input};
  if(typeof input.originalText==='string'){input.originalTextFile={bytes:Buffer.byteLength(input.originalText),sha256:digest(input.originalText)};delete input.originalText;}
  if(typeof input.contentBase64==='string'){const bytes=Buffer.from(input.contentBase64,'base64');input.originalBinaryFile={bytes:bytes.length,sha256:digest(bytes)};delete input.contentBase64;}
  return {...value,input};
}
function selection(args){
  const value=pick(args,Object.keys(gisFileSelection)),keys=['handoffId','dispatchId','sourceId','returnId','operationId'].filter(key=>value[key]!==undefined);
  if(value.kind==='workspace')need(!keys.length,'A whole GIS workspace export has no item selection.');
  else if(value.kind==='source')need(keys.length===1&&keys[0]==='sourceId','Select one complete original source file.');
  else if(value.kind==='returned')need(keys.length===1&&keys[0]==='returnId','Select one original returned file.');
  else if(value.kind==='operation')need(keys.length===1&&keys[0]==='operationId','Select one original operation.');
  else need(keys.length===1&&['handoffId','dispatchId'].includes(keys[0]),'Select one handoff or reviewed dispatch.');
  need(Number.isSafeInteger(value.expectedRevision),'Pin the observed workspace revision for this file.');
  return value;
}
export class MerchantOpen311GISWorkspaces {
  #config;#exports;#workspaces=new Map();#tasks=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'OPEN311_GIS',maxSnapshotBytes:268435456});
  constructor(config){this.#config=config.open311GISWorkspaces;this.#exports=config.exportsDirectory;}
  get summary(){return {configured:Boolean(this.#config),workspaces:Object.keys(this.#config?.workspaces??{}),openWorkspaces:this.#workspaces.size,...this.#reads.summary};}
  #entry(alias){const value=this.#config?.workspaces?.[alias];need(value,'Choose a configured GIS workspace.','OPEN311_GIS_WORKSPACE_UNKNOWN');return value;}
  #store(alias){const entry=this.#entry(alias);if(!this.#workspaces.has(alias))this.#workspaces.set(alias,openWorkspace(entry.directory));return this.#workspaces.get(alias);}
  #aliases(alias){const entry=this.#entry(alias);return {workspace:alias,label:entry.label,inputs:Object.entries(entry.inputs).map(([input,value])=>({input,label:value.label,sha256:value.sha256,kind:value.kind,format:value.format}))};}
  #atRevision(store,expectedRevision,action){
    const before=store.state();need(before.revision===expectedRevision,'The GIS workspace revision changed. Refresh before selecting another view.','OPEN311_GIS_REVISION_CONFLICT');
    const value=action(),after=store.state();
    need(after.workspaceId===before.workspaceId&&after.revision===before.revision,'The GIS workspace changed during this view. Reopen it at one revision.','OPEN311_GIS_REVISION_CONFLICT');
    return {workspaceId:before.workspaceId,revision:before.revision,value};
  }
  async #input(entry,args,kind){
    const selected=await readGISHostInput(entry,args.input,args.expectedSha256);
    if(kind)need(selected.input.kind===kind,'Choose a host input declared for '+kind+'.','OPEN311_GIS_INPUT_KIND');
    return selected;
  }
  async #call(name,args){
    if(name==='merchant_open311_gis_workspaces')return {...this.summary,workspaces:Object.keys(this.#config?.workspaces??{}).map(alias=>this.#aliases(alias))};
    const alias=args.workspace,entry=this.#entry(alias),store=this.#store(alias);
    if(name==='merchant_open311_gis_status'){
      const state=store.state(),{sources,handoffs,returns,decisions,dispatches,operations,directory,...metadata}=state;
      return {...metadata,workspace:alias,label:entry.label,counts:{sources:sources.length,handoffs:handoffs.length,returns:returns.length,decisions:decisions.length,dispatches:dispatches.length},recentOperations:operations,...this.#reads.status(alias)};
    }
    if(name==='merchant_open311_gis_records'){
      const state=store.state();need(state.revision===args.expectedRevision,'The selected GIS record revision changed.','OPEN311_GIS_REVISION_CONFLICT');
      return {workspaceId:state.workspaceId,revision:state.revision,kind:args.kind,...page(state[args.kind],args)};
    }
    if(name==='merchant_open311_gis_input'){
      const selected=await this.#input(entry,args);
      return {workspace:alias,input:args.input,name:selected.name,kind:selected.input.kind,format:selected.input.format,bytes:selected.bytes.length,sha256:selected.sha256};
    }
    if(name==='merchant_open311_gis_inspect_source'){
      const selected=await this.#input(entry,args,'source');
      return store.inspectSource(selected.originalText,pick(args,['reportId']));
    }
    if(['merchant_open311_gis_import_source','merchant_open311_gis_return_import','merchant_open311_gis_receive'].includes(name)){
      const kind=name==='merchant_open311_gis_import_source'?'source':name==='merchant_open311_gis_return_import'?'return':'workspace';
      const selected=await this.#input(entry,args,kind);
      const control={...pick(args,['requestId','expectedRevision']),hostInput:{alias:args.input,sha256:selected.sha256,kind,format:selected.input.format}};
      if(kind==='source')return store.importSource({...control,originalText:selected.originalText,...pick(args,['reportId','name'])});
      if(kind==='workspace')return store.receive({...control,originalText:selected.originalText});
      return store.importReturn({...control,...pick(args,['handoffId','analyst','name']),format:selected.input.format,
        ...(selected.input.format==='gpkg'?{contentBase64:selected.bytes.toString('base64')}:{originalText:selected.originalText})});
    }
    if(name==='merchant_open311_gis_handoff_create')return store.putHandoff(pick(args,['requestId','expectedRevision','definition']));
    if(name==='merchant_open311_gis_decision_save')return store.putDecision(pick(args,['requestId','expectedRevision','selection']));
    if(name==='merchant_open311_gis_dispatch_create')return store.putDispatch(pick(args,['requestId','expectedRevision','definition']));
    if(name==='merchant_open311_gis_source_rows'||name==='merchant_open311_gis_handoff_info'){
      const method=name.endsWith('source_rows')?'sourceRows':'handoff';
      const view=this.#atRevision(store,args.expectedRevision,()=>store[method]({...pick(args,['id','q','offset']),limit:args.limit??25}));
      return {workspaceId:view.workspaceId,revision:view.revision,...finishPage(view.value)};
    }
    if(name==='merchant_open311_gis_row'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.row(pick(args,['handoffId','key'])));
      return {workspaceId:view.workspaceId,revision:view.revision,...view.value};
    }
    if(name==='merchant_open311_gis_return_info'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.returned(args.id)),section=args.section??'changes';
      return {workspaceId:view.workspaceId,revision:view.revision,summary:view.value.summary,section,...page(view.value[section],args)};
    }
    if(name==='merchant_open311_gis_dispatch_info'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.dispatch(args.id)),{rows,...metadata}=view.value;
      return {workspaceId:view.workspaceId,revision:view.revision,...metadata,...page(rows,args)};
    }
    if(name==='merchant_open311_gis_operation')return operationView(store.operation(args.requestId));
    if(name==='merchant_open311_gis_file_release'){await this.#reads.release(alias,args.readId);return {workspace:alias,readId:args.readId,state:'RELEASED'};}
    if(name==='merchant_open311_gis_file_read'){
      const chosen=selection(args);
      return this.#reads.read({scope:alias,key:canonical(chosen),kind:'open311-gis-'+chosen.kind,directory:this.#exports,
        readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
        load:()=>this.#atRevision(store,chosen.expectedRevision,()=>{
          let file;
          if(chosen.kind==='operation'){
            const operation=store.operation(chosen.operationId);need(operation,'The original GIS operation was not found.','OPEN311_GIS_OPERATION_UNKNOWN');
            file={filename:'open311-gis-operation-'+digest(chosen.operationId).slice(0,24)+'.json',contentType:'application/json; charset=utf-8',
              body:canonical({schema:'commons.open311.gis-operation-export.v1',operation})+'\n'};
          }else file=store.exportFile(chosen);
          return {name:file.filename,type:file.contentType,bytes:Buffer.isBuffer(file.body)?file.body:Buffer.from(file.body,'utf8')};
        }).value});
    }
    throw failure('INVALID_PARAMS','Unknown GIS workspace tool.');
  }
  call(name,args={}){
    need(!this.#closing,'The GIS provider is closing.','OPEN311_GIS_MCP_CLOSED');
    const definition=definitions.get(name);need(definition&&plain(args),'Choose a declared GIS workspace tool.');
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
