// SPDX-License-Identifier: MIT
import {dirname,join,resolve} from 'node:path';
import {lstat} from 'node:fs/promises';
import {HiveClient,need,hash,absolute,inside,integer,privateDirectory,readJson,MAX_JSON,MAX_FILE} from './connection.mjs';
import {alias,canonical,digest,exact,plain,requestId,text,relativeName,verifyFile,verifyEdition} from './helpers.mjs';
import {HiveFiles,present} from './files.mjs';
import {HiveRequests,hiveResponse} from './requests.mjs';
import {recoverEffect,entity} from './recovery.mjs';
import {hiveTools} from './tools.mjs';
export const HIVE_HOST_SCHEMA='stellar-forge.hive-routing-host.v1';
const schemas=new Map(hiveTools((name,description,properties,required)=>({name,properties,required})).map(v=>[v.name,v]));
const label=(v,f)=>text(v??f,'host label',240);
const nativeId=v=>{need(typeof v==='string'&&/^[A-Za-z0-9_.-]{1,200}$/.test(v),'HIVE_NATIVE_ID','Select the actual plain original entity ID.');return v;};
export async function readHiveRoutingConfiguration(path){
  const source=await readJson(path,4*1024*1024),raw=source.value,base=dirname(source.path);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  need(raw.schema===HIVE_HOST_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>0&&Object.keys(raw.workspaces).length<=32,
    'HIVE_HOST_CONFIGURATION','Declare one to32 original Hive workspaces.');
  const workspaces=Object.create(null),connections=new Map();
  for(const[name,v]of Object.entries(raw.workspaces)){
    alias(name);exact(v,['label','directory','connectionFile','editions','binaries','archives','outputDirectory'],['directory','connectionFile','outputDirectory']);
    const directory=absolute(resolve(base,v.directory)),connectionFile=absolute(resolve(base,v.connectionFile)),outputDirectory=absolute(resolve(base,v.outputDirectory));
    await privateDirectory(dirname(directory));await privateDirectory(dirname(connectionFile));await privateDirectory(outputDirectory);
    need(!inside(directory,connectionFile)&&!inside(directory,outputDirectory)&&!inside(outputDirectory,directory)&&connectionFile!==source.path&&
      (!connections.has(connectionFile)||connections.get(connectionFile)===directory),'HIVE_HOST_LAYOUT','Keep connections and new receive/change output roots beside the original workspace.');
    connections.set(connectionFile,directory);
    const inputs={editions:Object.create(null),binaries:Object.create(null),archives:Object.create(null)};
    for(const group of Object.keys(inputs)){
      need(v[group]===undefined||plain(v[group])&&Object.keys(v[group]).length<=256,'HIVE_HOST_INPUTS','Declare bounded exact original inputs.');
      for(const[key,row]of Object.entries(v[group]??{})){
        alias(key);
        if(group==='editions'){
          exact(row,['label','directory','files'],['directory','files']);
          const dir=absolute(resolve(base,row.directory));
          need(Array.isArray(row.files)&&row.files.length>0,'HIVE_EDITION_INPUT','Declare complete edition members.');
          const files=row.files.map(f=>{exact(f,['path','bytes','sha256'],['path','bytes','sha256']);relativeName(f.path);digest(f.sha256);integer(f.bytes,'member bytes',MAX_FILE);return{...f};});
          const item={label:label(row.label,key),directory:dir,files};await verifyEdition(item);
          inputs[group][key]={...item,sha256:hash(canonical(files))};
        }else{
          exact(row,['label','file','bytes','sha256'],['file','bytes','sha256']);
          const item={label:label(row.label,key),file:absolute(resolve(base,row.file)),bytes:row.bytes,sha256:row.sha256};
          await verifyFile(item);inputs[group][key]=item;
        }
      }
    }
    workspaces[name]={label:label(v.label,name),directory,connectionFile,outputDirectory,...inputs};
  }
  return{configuration:source.path,sha256:source.sha256,workspaces};
}
function validateAction(action,data,state){
  const shape={
    'workspace.verify':[[],[]],
    'configuration.review':[['edition','decisions','note','expected'],['edition','decisions','note']],
    'native.start':[['deployment'],['deployment']],'native.status':[['deployment'],['deployment']],
    'native.stop':[['deployment'],['deployment']],'native.reconcile':[['deployment'],['deployment']],
    'programme.run':[['deployment','run_id','name'],['deployment','run_id']],
    'programme.compare':[['baseline','candidate'],['baseline','candidate']],
    'programme.review':[['programme','decisions','note','expected'],['programme','decisions','note']],
    'deployment.cutover':[['deployment','programme','note','expected'],['deployment','programme','note']],
    'deployment.rollback':[['deployment','programme','note','expected'],['deployment','programme','note']]
  }[action];
  need(shape,'HIVE_ACTION','Select a declared original non-path action.');exact(data,...shape);
  for(const k of ['deployment','programme','baseline','candidate','run_id'])if(data[k]!==undefined)nativeId(data[k]);
  if(data.edition!==undefined)digest(data.edition);
  if(data.expected!==undefined&&data.expected!==null)digest(data.expected);
  if(data.note!==undefined)text(data.note,'complete review note');
  if(data.name!==undefined)text(data.name,'name',300);
  if(data.decisions!==undefined){
    need(Array.isArray(data.decisions),'HIVE_DECISIONS','Supply the complete original review decisions.');
    const config=action==='configuration.review',key=config?'feature':'id',known=config?
      entity(state,'edition',data.edition)?.data.features.map(x=>x.feature):
      entity(state,'programme',data.programme)?.data.rows.map(x=>x.id);
    need(known&&data.decisions.length===known.length,'HIVE_REVIEW_SELECTION','Review every original selected item.');
    const seen=new Set();for(const row of data.decisions){exact(row,[key,'decision','reason'],[key,'decision','reason']);
      need(known.includes(row[key])&&!seen.has(row[key])&&(config?['retain','changed','needs-work']:['accept','change-required']).includes(row.decision),
        'HIVE_REVIEW_SELECTION','Select each original item and allowed decision exactly once.');seen.add(row[key]);text(row.reason,'engineering reason');}
  }
}
export class MerchantHiveWorkspaces{
  #config;#clients=new Map();#files;#requests;#tail=Promise.resolve();#pending=new Set();#closing=false;#closed=null;
  constructor(config){this.#config=config;this.#files=new HiveFiles(config.exportsDirectory,{authorize:(a,s)=>this.#authorize(a,s)});this.#requests=new HiveRequests(this.#files);}
  get summary(){return{configured:Boolean(this.#config.hiveRoutingWorkbench),connected:[...this.#clients.keys()],pending:this.#pending.size,closing:this.#closing,retainedReads:this.#files.summary};}
  #scope(name){const s=this.#config.hiveRoutingWorkbench?.workspaces?.[alias(name)];need(s,'HIVE_WORKSPACE_NOT_CONFIGURED','Choose a declared original workspace.',404);return{...s,alias:name};}
  #client(scope){const c=this.#clients.get(scope.alias);need(c,'HIVE_WORKSPACE_DISCONNECTED','Connect the selected original Applications listener.',409);return c;}
  #view(scope){const c=this.#clients.get(scope.alias),describe=group=>Object.entries(scope[group]).map(([name,v])=>({alias:name,label:v.label,sha256:v.sha256,
    ...(group==='editions'?{files:v.files,bytes:v.files.reduce((n,r)=>n+r.bytes,0)}:{bytes:v.bytes})}));
    return{workspace:scope.alias,label:scope.label,state:c?'CONNECTED':'DISCONNECTED',...(c?{connection:c.connection}:{}),
      editions:describe('editions'),binaries:describe('binaries'),archives:describe('archives')};}
  async #access(scope,state=null){const current=state??(await this.#client(scope).state()).value;
    need(current.format==='hive-router-workspace.v1'&&typeof current.id==='string'&&Array.isArray(current.entities),'HIVE_WORKSPACE_IDENTITY','Read the complete original workspace.',409);
    return{workspaceId:current.id,sourcePin:current.sourcePin,directory:scope.directory};}
  async #authorize(name,selection){const s=this.#scope(name),c=this.#client(s),access=selection?.access;
    need(access&&access.directory===s.directory,'HIVE_RETAINED_AUTHORITY','The selected snapshot belongs to this original installation.',403);
    const current=(await c.state()).value;need(current.id===access.workspaceId&&current.sourcePin===access.sourcePin,
      'HIVE_RETAINED_AUTHORITY','Reconnect the same original workspace and source before retained disclosure.',403);return current;}
  async #retain(scope,response,selection,access=null){return{workspace:scope.alias,...await this.#files.retain(scope.alias,response,{...selection,access:access??await this.#access(scope)})};}
  async #archive(scope,client,args){
    need(Boolean(args.archiveInput)!==Boolean(args.exportRequestId),'HIVE_ARCHIVE_SELECTION','Choose exactly one declared archive or retained export request.');
    digest(args.expectedSha256);
    if(args.archiveInput){
      const source=scope.archives[alias(args.archiveInput)];need(source&&source.sha256===args.expectedSha256,'HIVE_ARCHIVE_SELECTION','Select the declared full archive SHA.',409);
      await verifyFile(source);return{path:source.file,sha256:source.sha256,bytes:source.bytes};
    }
    const state=(await client.state()).value,record=await this.#requests.selected(scope.alias,state.id,args.exportRequestId);
    need(record?.resolved.action==='delivery.export','HIVE_EXPORT_SELECTION','Select this workspace’s exact original export request.',404);
    const found=await(await import('./helpers.mjs')).identity(record.resolved.data.destination);
    need(found.sha256===args.expectedSha256,'HIVE_ARCHIVE_SELECTION','The selected original export SHA differs.',409);
    return{path:record.resolved.data.destination,sha256:found.sha256,bytes:found.bytes};
  }
  async #resolve(scope,client,operation,input,before){
    const requestKey=hash(canonical({workspaceId:before.id,requestId:input.requestId})),destination=join(scope.outputDirectory,requestKey);
    switch(operation){
      case'action':validateAction(input.action,input.data,before);return{action:input.action,data:input.data};
      case'edition_import':{
        const source=scope.editions[alias(input.editionInput)];digest(input.expectedSourceSha256);
        need(source&&source.sha256===input.expectedSourceSha256,'HIVE_EDITION_SELECTION','Select the complete declared edition SHA.',409);
        await verifyEdition(source);if(input.name!==undefined)text(input.name,'name',300);
        return{action:'edition.import',data:{directory:source.directory,...(input.name===undefined?{}:{name:input.name})},files:source.files};
      }
      case'edition_change':{
        digest(input.edition);text(input.name,'edition name',300);need(entity(before,'edition',input.edition),'HIVE_EDITION_SELECTION','Open the original retained edition.',404);
        need(plain(input.changes)&&Object.keys(input.changes).length>0,'HIVE_EDITION_CHANGES','Supply complete replacement files.');
        for(const[k,v]of Object.entries(input.changes)){relativeName(k);need(typeof v==='string','HIVE_EDITION_CHANGES','Use full UTF-8 source text.');}
        return{action:'edition.change',data:{edition:input.edition,name:input.name,changes:input.changes,directory:destination+'-edition'}};
      }
      case'native_prepare':{
        digest(input.edition);digest(input.expectedBinarySha256);const binary=scope.binaries[alias(input.binaryInput)];
        need(binary&&binary.sha256===input.expectedBinarySha256,'HIVE_BINARY_SELECTION','Select the declared original published binary.',409);await verifyFile(binary);
        need(input.environmentNames===undefined||Array.isArray(input.environmentNames)&&input.environmentNames.length<=256&&
          input.environmentNames.every(v=>typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)),
          'HIVE_ENVIRONMENT','Select only existing private environment variable names.');
        if(input.name!==undefined)text(input.name,'deployment name',300);
        return{action:'native.prepare',data:{edition:input.edition,binary:binary.file,...(input.name===undefined?{}:{name:input.name}),
          environment_names:input.environmentNames??[]},binary:{sha256:binary.sha256,bytes:binary.bytes}};
      }
      case'archive_export':{
        const dir=join(scope.directory,'deliveries');await privateDirectory(dir,{create:true});
        return{action:'delivery.export',data:{destination:join(dir,requestKey+'.zip')}};
      }
      case'archive_receive':{const selected=await this.#archive(scope,client,input);return{action:'delivery.receive',data:{archive:selected.path,destination:destination+'-received'},archive:selected};}
      default:need(false,'HIVE_OPERATION','Select the original declared operation.');
    }
  }
  async #mutation(scope,client,operation,input){
    requestId(input.requestId);
    const before=(await client.state()).value,access=await this.#access(scope,before),selectedInput={operation,...input};
    const prior=await this.#requests.selected(scope.alias,before.id,input.requestId);
    if(prior)need(canonical(prior.input)===canonical(selectedInput),'HIVE_REQUEST_REUSED','Retain this request’s complete original data.',409);
    const resolved=prior?.resolved??await this.#resolve(scope,client,operation,input,before);
    const value=await this.#requests.run({alias:scope.alias,access,input:selectedInput,resolved,before,
      dispatch:r=>client.action(r.resolved.action,r.resolved.data),recover:r=>recoverEffect(r,client)});
    const retained=await this.#retain(scope,value.response,{operation,requestId:input.requestId,outcome:value.outcome},value.record.access);
    return{...retained,requestId:input.requestId,originalOutcome:value.outcome,replayed:value.replayed,
      originalRequest:value.record.originalRequest,reconciliationRequired:value.outcome==='RECONCILIATION_REQUIRED'||
        value.response.status>=400};
  }
  async #artifact(scope,client,args){
    exact(args.selection,['kind','edition','path','programme','operation','sha256','name','deployment','exportRequestId'],['kind']);
    const s={...args.selection};switch(s.kind){
      case'edition':exact(s,['kind','edition','path'],['kind','edition','path']);digest(s.edition);relativeName(s.path);break;
      case'response':exact(s,['kind','programme','operation'],['kind','programme','operation']);nativeId(s.programme);nativeId(s.operation);break;
      case'object':exact(s,['kind','sha256','name'],['kind','sha256']);digest(s.sha256);break;
      case'native-log':exact(s,['kind','deployment'],['kind','deployment']);nativeId(s.deployment);break;
      case'archive':{exact(s,['kind','exportRequestId'],['kind','exportRequestId']);const a=await this.#archive(scope,client,{exportRequestId:s.exportRequestId,expectedSha256:args.expectedSha256});
        delete s.exportRequestId;s.path=a.path;s.sha256=a.sha256;break;}
      default:need(false,'HIVE_ARTIFACT','Select an original artifact family.');
    }
    return this.#files.artifact(scope.alias,client,s,{sha256:args.expectedSha256,bytes:args.expectedBytes,
      ...(args.filename===undefined?{}:{filename:args.filename}),...(args.mediaType===undefined?{}:{mediaType:args.mediaType})},await this.#access(scope));
  }
  async #dispatch(name,args){
    const schema=schemas.get(name);need(schema,'HIVE_TOOL_UNKNOWN','Select a declared Hive tool.');exact(args,Object.keys(schema.properties),schema.required);
    if(name==='merchant_hive_status'&&args.workspace===undefined)return{...this.summary,workspaces:Object.keys(this.#config.hiveRoutingWorkbench?.workspaces??{}).map(n=>this.#view(this.#scope(n)))};
    const scope=this.#scope(args.workspace);
    if(name==='merchant_hive_status')return this.#view(scope);
    if(name==='merchant_hive_connect'){
      const c=await HiveClient.connect(scope.connectionFile,{expectedLaunchId:args.expectedLaunchId});
      try{need(c.connection.directory===scope.directory,'HIVE_CONNECTION_DIRECTORY','The selected launch uses another original workspace.',409);
        const old=this.#clients.get(scope.alias);if(old){await old.close();await this.#files.disconnect(scope.alias);}}
      catch(e){await c.close();throw e;}
      this.#clients.set(scope.alias,c);return{...this.#view(scope),native:await this.#retain(scope,await c.info(),{operation:'info'})};
    }
    if(name==='merchant_hive_disconnect'){
      const c=this.#clients.get(scope.alias);need(!c||c.connection.launchId===args.launchId,'HIVE_LAUNCH_CHANGED','Disconnect the selected original launch.',409);
      await c?.close();await this.#files.disconnect(scope.alias);this.#clients.delete(scope.alias);return{workspace:scope.alias,state:'DISCONNECTED',launchId:args.launchId};
    }
    const{workspace,...input}=args,client=this.#client(scope);
    switch(name){
      case'merchant_hive_browser':await client.info();return{workspace:scope.alias,url:client.connection.origin+'/',connection:client.connection};
      case'merchant_hive_info':return this.#retain(scope,await client.info(),{operation:'info'});
      case'merchant_hive_state':return this.#retain(scope,await client.state(),{operation:'state'});
      case'merchant_hive_entity':{
        const state=(await client.state()).value;const e=entity(state,args.kind,args.id);need(e,'HIVE_ENTITY','The original selected entity is absent.',404);
        return this.#retain(scope,hiveResponse(e),{operation:'entity',kind:args.kind,id:args.id},await this.#access(scope,state));}
      case'merchant_hive_requests':{const page=await this.#requests.list(scope.alias,input),state=(await client.state()).value;
        need(page.requests.every(r=>r.workspaceId===state.id),'HIVE_REQUEST_WORKSPACE','The retained requests belong to this original workspace.',403);return page;}
      case'merchant_hive_files':return this.#files.list(scope.alias,input);
      case'merchant_hive_file':return this.#files.read(scope.alias,input);
      case'merchant_hive_file_release':await this.#files.release(scope.alias,args.readId);return{workspace:scope.alias,readId:args.readId,released:true};
      case'merchant_hive_inspect':return this.#files.inspect(scope.alias,input);
      case'merchant_hive_artifact':return this.#artifact(scope,client,args);
      case'merchant_hive_archive_inspect':
      case'merchant_hive_archive_compare':{
        const a=await this.#archive(scope,client,input),action=name.endsWith('_inspect')?'delivery.inspect':'delivery.compare';
        return this.#retain(scope,await client.action(action,{archive:a.path}),{operation:action,archiveSha256:a.sha256});}
      default:return this.#mutation(scope,client,name.slice('merchant_hive_'.length),input);
    }
  }
  async call(name,args={}){
    need(!this.#closing,'HIVE_MCP_CLOSING','This original application attachment is closing.',409);
    const pending=this.#tail.then(()=>this.#dispatch(name,args));this.#tail=pending.catch(()=>{});this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close(){if(this.#closed)return this.#closed;this.#closing=true;return this.#closed=(async()=>{
    await Promise.allSettled([...this.#pending]);for(const c of this.#clients.values())await c.close();
    await this.#files.close();this.#clients.clear();
  })().catch(e=>{this.#closed=null;throw e;});}
}
export {hiveTools} from './tools.mjs';
