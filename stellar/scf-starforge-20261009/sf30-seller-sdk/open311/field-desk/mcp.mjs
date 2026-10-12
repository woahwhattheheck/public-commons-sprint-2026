// MIT. Complete municipal field-work operations over the installed merchant transport and original retained-file contract.
import { RetainedFileReads } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { failure, plain, exact } from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { canonical, digest } from '../gis/shared.mjs';
import { openWorkspace } from './workspace.mjs';
import { readFieldDeskHostInput, readFieldDeskWorkspaceConfiguration } from './mcp-client.mjs';
import { fieldDeskWorkspaceTools, fieldDeskFileSelection } from './mcp-tools.mjs';
export { fieldDeskWorkspaceTools, readFieldDeskWorkspaceConfiguration };
export async function initializeFieldDeskMerchantWorkspace(options){return (await import('./mcp-setup.mjs')).initializeFieldDeskMerchantWorkspace(options);}
const definitions=new Map(fieldDeskWorkspaceTools((name,description,properties,required)=>({name,description,properties,required})).map(value=>[value.name,value]));
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

function small(value){need(Buffer.byteLength(JSON.stringify(value))<=2*1024*1024,'Choose a smaller row page or download the complete original file.','OPEN311_FIELD_DESK_VIEW_TOO_LARGE');return value;}
function page(items,{offset=0,limit=25}={}){
  need(offset<=items.length,'Choose an offset within the retained set.');const selected=items.slice(offset,offset+limit),next=offset+selected.length;
  return {items:selected,total:items.length,offset,limit,returned:selected.length,nextOffset:next<items.length?next:null};
}
function finishPage(value){const next=value.offset+value.items.length;return {...value,returned:value.items.length,nextOffset:next<value.total?next:null};}
function attachmentMetadata(value){const {contentBase64,...metadata}=value;return metadata;}
function operationView(value){
  if(!value)return null;const input={...value.input};
  if(typeof input.originalText==='string'){
    input.originalTextFile={bytes:Buffer.byteLength(input.originalText),sha256:digest(input.originalText)};delete input.originalText;
  }
  if(typeof input.attachment?.contentBase64==='string'){
    const {contentBase64,...metadata}=input.attachment,bytes=Buffer.from(contentBase64,'base64');
    input.attachment={...metadata,originalFile:{bytes:bytes.length,sha256:digest(bytes)}};
  }
  return {...value,input};
}
function selection(args){
  const value=pick(args,Object.keys(fieldDeskFileSelection));
  const selectors=['sourceId','packageId','returnId','updateId','attachmentId','operationId'].filter(key=>value[key]!==undefined);
  const expected={source:'sourceId','crew-json':'packageId','crew-html':'packageId',returned:'returnId',
    'update-json':'updateId','update-csv':'updateId','update-geojson':'updateId','update-report':'updateId',attachment:'attachmentId',operation:'operationId'}[value.kind];
  if(value.kind==='workspace')need(!selectors.length,'A complete field workspace does not select a single item.');
  else if(value.kind==='visits-csv')need(selectors.every(key=>key==='sourceId'),'Visit CSV selects only an optional source, crew, status and search.');
  else need(expected&&selectors.length===1&&selectors[0]===expected,'Select the original item belonging to this file kind.');
  if(value.kind!=='visits-csv')need(['crewId','status','q'].every(key=>value[key]===undefined),'Visit filters belong only to the visit CSV export.');
  need(Number.isSafeInteger(value.expectedRevision),'Pin the observed workspace revision for this file.');return value;
}
export class MerchantOpen311FieldDeskWorkspaces {
  #config;#exports;#workspaces=new Map();#tasks=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'OPEN311_FIELD_DESK',maxSnapshotBytes:268435456});
  constructor(config){this.#config=config.open311FieldDeskWorkspaces;this.#exports=config.exportsDirectory;}
  get summary(){return {configured:Boolean(this.#config),workspaces:Object.keys(this.#config?.workspaces??{}),openWorkspaces:this.#workspaces.size,...this.#reads.summary};}
  #entry(alias){const entry=this.#config?.workspaces?.[alias];need(entry,'Choose a configured field desk workspace.','OPEN311_FIELD_DESK_WORKSPACE_UNKNOWN');return entry;}
  #store(alias){const entry=this.#entry(alias);if(!this.#workspaces.has(alias))this.#workspaces.set(alias,openWorkspace(entry.directory,{create:false}));return this.#workspaces.get(alias);}
  #aliases(alias){
    const entry=this.#entry(alias);return {workspace:alias,label:entry.label,inputs:Object.entries(entry.inputs).map(([input,value])=>({
      input,label:value.label,sha256:value.sha256,kind:value.kind,format:value.format,contentType:value.contentType}))};
  }
  #atRevision(store,expectedRevision,action){
    const before=store.state();need(before.revision===expectedRevision,'The field desk revision changed. Refresh before selecting another view.','OPEN311_FIELD_DESK_REVISION_CONFLICT');
    const value=action(),after=store.state();
    need(after.workspaceId===before.workspaceId&&after.revision===before.revision,'The field desk changed during this view. Reopen it at one revision.','OPEN311_FIELD_DESK_REVISION_CONFLICT');
    return {workspaceId:before.workspaceId,revision:before.revision,value};
  }
  async #input(entry,args,kind){
    const selected=await readFieldDeskHostInput(entry,args.input,args.expectedSha256);
    if(kind)need(selected.input.kind===kind,'Choose a host input declared for '+kind+'.','OPEN311_FIELD_DESK_INPUT_KIND');
    return selected;
  }
  async #call(name,args){
    const command=name.slice('merchant_open311_field_desk_'.length);
    if(command==='workspaces')return {...this.summary,workspaces:Object.keys(this.#config?.workspaces??{}).map(alias=>this.#aliases(alias))};
    const alias=args.workspace,entry=this.#entry(alias),store=this.#store(alias);
    if(command==='status'){
      const state=store.state(),{directory,sources,crews,packages,returns,updates,operations,...metadata}=state;
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
    if(command==='inspect_source'){
      const selected=await this.#input(entry,args,'source');
      return store.inspectSource(selected.originalText,pick(args,['dispatchId']));
    }
    if(['import_source','return_import','attachment_save','receive'].includes(command)){
      const kind={import_source:'source',return_import:'return',attachment_save:'attachment',receive:'workspace'}[command],
        selected=await this.#input(entry,args,kind),control={...pick(args,['requestId','expectedRevision']),hostInput:{
          alias:args.input,sha256:selected.sha256,kind,format:selected.input.format,contentType:selected.input.contentType}};
      if(command==='import_source')return store.importSource({...control,...pick(args,['name','dispatchId']),originalText:selected.originalText});
      if(command==='return_import')return store.importReturn({...control,...pick(args,['name']),originalText:selected.originalText});
      if(command==='receive')return store.receive({...control,originalText:selected.originalText});
      return store.putAttachment({...control,attachment:{filename:args.filename??selected.name,contentType:selected.input.contentType,contentBase64:selected.bytes.toString('base64')}});
    }
    const mutations={
      crew_save:['putCrew',['crew']],visit_save:['putVisit',['visit']],
      package_create:['createPackage',['name','visitIds','note']],
      decisions_apply:['applyDecisions',['returnId','reviewer','note','decisions']],
      visits_review:['reviewVisits',['reviewer','note','selections']],
      update_create:['createUpdate',['name','reviewer','destination','note','items']]
    };
    if(mutations[command]){const [method,keys]=mutations[command];return store[method](pick(args,['requestId','expectedRevision',...keys]));}
    if(command==='source'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.source(args.id)),{rows,...dispatch}=view.value.dispatch;
      return {workspaceId:view.workspaceId,revision:view.revision,...view.value,dispatch:{...dispatch,rows:rows.length}};
    }
    if(command==='source_rows'||command==='visits'){
      const keys=command==='source_rows'?['sourceId','q']:['sourceId','crewId','status','q'];
      const method=command==='source_rows'?'sourceRows':'visits';
      const view=this.#atRevision(store,args.expectedRevision,()=>store[method]({...pick(args,[...keys,'offset']),limit:args.limit??25}));
      return {workspaceId:view.workspaceId,revision:view.revision,...finishPage(view.value)};
    }
    if(command==='crew'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.crew(args.id));
      return {workspaceId:view.workspaceId,revision:view.revision,crew:view.value.crew,section:'history',...page(view.value.history,args)};
    }
    if(command==='visit'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.visit(args.id)),{history,attachments,...metadata}=view.value,section=args.section??'history';
      return {workspaceId:view.workspaceId,revision:view.revision,...metadata,historyCount:history.length,attachmentCount:attachments.length,
        section,...page(section==='attachments'?attachments:history,args)};
    }
    if(command==='package'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.package(args.id)),{visits,attachments,...metadata}=view.value.package,section=args.section??'visits';
      return {workspaceId:view.workspaceId,revision:view.revision,package:{...metadata,visits:visits.length,attachments:attachments.length},
        section,...page(section==='attachments'?attachments.map(attachmentMetadata):visits,args)};
    }
    if(command==='return'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.returned(args.id)),{proposals,decisions,...metadata}=view.value,section=args.section??'proposals';
      return {workspaceId:view.workspaceId,revision:view.revision,...metadata,section,...page(section==='decisions'?decisions:proposals,args)};
    }
    if(command==='update'){
      const view=this.#atRevision(store,args.expectedRevision,()=>store.update(args.id)),{items,attachments,...metadata}=view.value.update,section=args.section??'items';
      return {workspaceId:view.workspaceId,revision:view.revision,update:{...metadata,items:items.length,attachments:attachments.length},
        section,...page(section==='attachments'?attachments.map(attachmentMetadata):items,args)};
    }
    if(command==='operation')return operationView(store.operation(args.requestId));
    if(command==='file_release'){await this.#reads.release(alias,args.readId);return {workspace:alias,readId:args.readId,state:'RELEASED'};}
    if(command==='file_read'){
      const chosen=selection(args);
      return this.#reads.read({scope:alias,key:canonical(chosen),kind:'open311-field-desk-'+chosen.kind,directory:this.#exports,
        readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
        load:()=>this.#atRevision(store,chosen.expectedRevision,()=>{
          let file;
          if(chosen.kind==='attachment')file=store.attachment(chosen.attachmentId);
          else if(chosen.kind==='operation'){
            const operation=store.operation(chosen.operationId);need(operation,'The original field desk operation was not found.','OPEN311_FIELD_DESK_OPERATION_UNKNOWN');
            file={filename:'field-desk-operation-'+digest(chosen.operationId).slice(0,24)+'.json',contentType:'application/json; charset=utf-8',
              body:canonical({schema:'commons.open311.field-desk-operation-export.v1',operation})+'\n'};
          }else file=store.exportFile(chosen);
          return {name:file.filename,type:file.contentType,bytes:typeof file.body==='string'?Buffer.from(file.body,'utf8'):Buffer.from(file.body)};
        }).value});
    }
    throw failure('INVALID_PARAMS','Unknown field desk workspace tool.');
  }
  call(name,args={}){
    need(!this.#closing,'The field desk provider is closing.','OPEN311_FIELD_DESK_MCP_CLOSED');
    const definition=definitions.get(name);need(definition&&plain(args),'Choose a declared field desk workspace tool.');
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
