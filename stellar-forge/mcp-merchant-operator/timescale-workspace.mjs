// MIT. Full Timescale operations over the original MerchantPublisher ownership tree.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exact, failure, identifier, plain, privateSupportDirectory } from './host-files.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { UUID, HASH } from './catalog/timescale-workspace.mjs';
import { TIMESCALE_DOWNLOAD_MANIFEST, TIMESCALE_DOWNLOAD_SCHEMA, TIMESCALE_MANIFEST_BYTES,
  TIMESCALE_FILE_BYTES, parseTimescaleDownloadManifest } from './timescale-export-contract.mjs';
import { identity } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import { exportTimescaleRemediationReport, inspectTimescaleRemediationReport } from './timescale-remediation-report.mjs';
import { REMEDIATION_MANIFEST } from './timescale-remediation-contract.mjs';
import { dispatchTimescaleCommissioning } from './timescale-commissioning.mjs';
export { timescaleWorkspaceTools } from './catalog/timescale-workspace.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function uuid(value){if(typeof value!=='string'||!UUID.test(value))throw failure('INVALID_PARAMS','Use the exact original lowercase UUID.');return value;}
function hash(value){if(typeof value!=='string'||!HASH.test(value))throw failure('INVALID_PARAMS','Use the exact original SHA-256.');return value;}
function count(value,maximum,minimum=0){if(!Number.isSafeInteger(value)||value<minimum||value>maximum)throw failure('INVALID_PARAMS','Use an integer in the declared range.');return value;}
function fields(args,allowed,required=[]){exact(args,['workspace','workspaceId',...allowed],['workspace','workspaceId',...required]);}
function paged(rows,args){const offset=count(args.offset??0,Number.MAX_SAFE_INTEGER),limit=count(args.limit??25,100,1);
  return{offset,limit,total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null,rows:rows.slice(offset,offset+limit)};}
function smallResult(value){
  if(!plain(value))return value??null;
  const output={};
  for(const key of ['editionId','digest','bytes','aggregateCount','reviewId','planId','publisherPlanId','runId','state',
    'commissioningId','revision','complete','createdAt','workspaceVersion','reportId','workItemId','itemRevision','itemDigest','manifestSha256','action','actor','note','at','reused','native','acknowledgedAt','window','options','atomic','matches','counts','jobId','manifestDigest','workspaceId','files','target','error'])
    if(Object.hasOwn(value,key))output[key]=value[key];
  if(value.plan)output.planKind=value.plan.schema;
  if(value.decisions)output.decisions=value.decisions.length;
  return output;
}
function operationView(value){
  const input={...value.input};delete input.outputDirectory;
  return{id:value.id,kind:value.kind,state:value.state,inputDigest:value.input_digest,created:value.created,updated:value.updated,
    attempts:value.attempts,input,result:smallResult(value.data?.result),error:value.data?.error??null,
    before:value.data?.dispatch?.before??null,
    ...(value.data?.dispatch?{dispatch:{statementDigest:value.data.dispatch.statementDigest,dispatchedAt:value.data.dispatch.dispatchedAt}}:{})};
}
function statusView(value){
  const {directory,sourceFile,targetDirectory,...result}=value;
  result.operations={...value.operations,rows:value.operations.rows.map(operationView)};
  result.plans={...value.plans,rows:value.plans.rows.map(({id,kind,created,digest,data})=>({id,kind,created,digest,title:data.title}))};
  result.reviews={...value.reviews,rows:value.reviews.rows.map(({id,created,before_id,after_id,data})=>
    ({id,created,beforeId:before_id,afterId:after_id,reviewer:data.reviewer,note:data.note,decisions:data.decisions.length,comparisonDigest:data.comparisonDigest}))};
  result.events={...value.events,rows:value.events.rows.map(({id,created,kind,operation,data})=>({id,created,kind,operation,
    data:smallResult(data)}))};
  return result;
}
function sourceView(value){
  const {before,after,fields,...metadata}=value;
  return {...metadata,changedFields:(fields??[]).map(row=>row.name),
    completeSource:'Original edition files and complete retained remediation report JSON'};
}
function changeView(value){if(!value)return null;const{before,after,fields,...metadata}=value;
  return{...metadata,changedFields:(fields??[]).map(row=>row.name)};}
function observedView(value){
  const {operation,...rest}=value;
  return {...rest,operation:{id:operation.id,kind:operation.kind,state:operation.state,created:operation.created,
    updated:operation.updated,digest:operation.digest,input:{planId:operation.input?.planId,planDigest:operation.input?.planDigest},
    result:smallResult(operation.data?.result),error:operation.data?.error??null}};
}
function resolutionView(value){
  if(!value)return null;const{change,verification,...rest}=value;
  return {...rest,change:changeView(change),verification:verification?{
    ...observedView(verification),completedAt:verification.completedAt,window:verification.window,
    definitionDigest:verification.definitionDigest,counts:verification.counts,interpretation:verification.interpretation}:null};
}
function itemView(value,args){
  const item=value.item,section=args.section??'summary';
  if(args.itemRevision!==undefined&&args.itemRevision!==item.revision||args.itemDigest!==undefined&&args.itemDigest!==value.digest)
    throw failure('TIMESCALE_REMEDIATION_ITEM_CHANGED','Use the exact inspected item revision and digest for every page.');
  const {plans,observations,...rest}=item;
  const result={schema:'stellar-forge.timescale-remediation-mcp-detail.v1',workspaceId:value.workspaceId,
    version:value.version,item:{...rest,source:sourceView(item.source),resolution:resolutionView(item.resolution),
      plans:plans.length,observations:observations.length},itemDigest:value.digest,historyCount:value.history.length,section};
  if(section!=='summary'){
    const rows=section==='plans'?plans:section==='observations'?observations.map(observedView):value.history;
    result.page=paged(rows,args);
  }
  return result;
}
function closeFailure(errors){if(errors.length){const issue=failure('TIMESCALE_CLOSE_FAILED','The original Timescale resources have not all closed; retry this same close.');issue.cause=new AggregateError(errors);throw issue;}}
async function immutableDescriptor(path,file){
  await privateSupportDirectory(dirname(path));
  if(await realpath(dirname(path))!==dirname(path))throw failure('TIMESCALE_FILE_CHANGED','The original file parent changed identity.');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const info=await handle.stat();
    if(!info.isFile()||info.nlink!==1||info.mode&0o077||info.size!==file.bytes||info.size>TIMESCALE_FILE_BYTES)
      throw failure('TIMESCALE_FILE_CHANGED','The retained original file differs from its declaration.');
    return{readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.type??'application/octet-stream'};
  }catch(issue){await handle.close();throw issue;}
}
async function exactJsonBytes(path,maximum,expectedSha){
  const descriptor=await immutableDescriptor(path,{name:'manifest.json',bytes:(await (await import('node:fs/promises')).lstat(path)).size,
    sha256:expectedSha,type:'application/json'});
  try{
    if(descriptor.bytes>maximum)throw failure('TIMESCALE_EXPORT_MANIFEST_TOO_LARGE','The complete manifest exceeds its original 64 MiB limit.');
    const before=await descriptor.readonlyFileHandle.stat({bigint:true});
    const bytes=await descriptor.readonlyFileHandle.readFile();
    const after=await descriptor.readonlyFileHandle.stat({bigint:true});
    if(bytes.length!==descriptor.bytes||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||sha(bytes)!==expectedSha)
      throw failure('TIMESCALE_EXPORT_CHANGED','The original native package manifest changed.');
    return bytes;
  }finally{await descriptor.readonlyFileHandle.close();}
}

export class MerchantTimescaleWorkspaces {
  #config;#publishers;#handles=new Map();#pending=new Set();#closing=false;#close=null;
  constructor(config,publishers){this.#config=config;this.#publishers=publishers;}
  get summary(){const resources=[...this.#handles.values()].map(entry=>entry.resource).filter(Boolean);
    return{configured:Boolean(this.#config.timescaleWorkspaces),opened:[...this.#handles.keys()],closing:this.#closing,pending:this.#pending.size,
      activeFileReads:resources.reduce((n,r)=>n+r.reads.summary.activeFileReads,0),snapshotBytes:resources.reduce((n,r)=>n+r.reads.summary.snapshotBytes,0)};}
  #declared(name){identifier(name,'Timescale workspace alias');const value=this.#config.timescaleWorkspaces?.workspaces?.[name];
    if(!value)throw failure('TIMESCALE_WORKSPACE_NOT_CONFIGURED','Choose a host-declared Timescale workspace.');return value;}
  #declaration(name,value){return{workspace:name,workspaceId:value.workspaceId,label:value.label,publisher:value.publisher};}
  #resource(name,entry,configured,owned){
    if(!owned.workspace||owned.workspace.settings.id!==configured.workspaceId)
      throw failure('TIMESCALE_WORKSPACE_CHANGED','The original publisher must own the declared Timescale workspace.');
    const resource={model:owned.workspace,publisher:owned.publisher,schedule:owned.schedule,instanceId:randomUUID(),
      publisherInstanceId:owned.instanceId,reads:new RetainedFileReads({errorPrefix:'TIMESCALE'}),browser:null,browserTail:Promise.resolve(),
      manifests:new Map(),reports:new Map(),closing:false,closePromise:null};
    resource.close=()=>{
      if(resource.closePromise)return resource.closePromise;
      resource.closing=true;
      resource.closePromise=(async()=>{
        const errors=[];await resource.browserTail.catch(()=>{});
        if(resource.browser)try{await resource.browser.close();resource.browser=null;}catch(issue){errors.push(issue);}
        try{await resource.reads.close();}catch(issue){errors.push(issue);}
        closeFailure(errors);
        resource.manifests.clear();resource.reports.clear();
        if(this.#handles.get(name)===entry)this.#handles.delete(name);
      })().catch(issue=>{resource.closePromise=null;throw issue;});
      return resource.closePromise;
    };
    entry.resource=resource;return resource;
  }
  async #open(name){
    const configured=this.#declared(name);let entry=this.#handles.get(name);
    if(entry?.closing||entry?.resource?.closing)throw failure('TIMESCALE_WORKSPACE_CLOSING','Retry the original close before opening another resource.');
    if(!entry){
      entry={opening:null,lease:null,resource:null,closing:null};this.#handles.set(name,entry);
      entry.opening=this.#publishers.borrow(configured.publisher,{kind:'timescale',key:'timescale:'+name,
        open:owned=>this.#resource(name,entry,configured,owned)}).then(lease=>{entry.lease=lease;return lease;});
      try{await entry.opening;}catch(issue){if(this.#handles.get(name)===entry)this.#handles.delete(name);throw issue;}
    }else await entry.opening;
    return this.#status(name);
  }
  async #status(name,args={}){
    if(name===undefined)return{...this.summary,workspaces:Object.entries(this.#config.timescaleWorkspaces?.workspaces??{}).map(([alias,value])=>{
      const entry=this.#handles.get(alias);return{...this.#declaration(alias,value),state:!entry?'CLOSED':entry.closing||entry.resource?.closing?'CLOSING':entry.resource?'OPEN':'OPENING'};})};
    const declaration=this.#declaration(name,this.#declared(name)),entry=this.#handles.get(name);
    if(!entry)return{...declaration,state:'CLOSED'};
    const lease=await entry.opening,resource=lease.resource;
    if(entry.closing||lease.closed||resource.closing)return{...declaration,state:'CLOSING',instanceId:resource.instanceId,publisherInstanceId:lease.instanceId};
    return lease.run(current=>({...declaration,state:'OPEN',instanceId:current.instanceId,publisherInstanceId:lease.instanceId,
      native:statusView(current.model.status({offset:count(args.offset??0,Number.MAX_SAFE_INTEGER),limit:count(args.limit??25,100,1)})),
      browser:{open:Boolean(current.browser)},fileReads:current.reads.status(name)}));
  }
  async #stop(name,entry){
    if(entry.closing)return entry.closing;
    entry.closing=(async()=>{
      const lease=await entry.opening,instanceId=lease.resource.instanceId;
      await lease.release();if(this.#handles.get(name)===entry)this.#handles.delete(name);
      return{workspace:name,instanceId,state:'CLOSED',publisherState:'OWNED_BY_MERCHANT_PUBLISHER'};
    })().catch(issue=>{entry.closing=null;throw issue;});
    return entry.closing;
  }
  #started(resource,started){return{id:started.id,reused:started.reused,operation:operationView(resource.model.operation(started.id))};}
  #input(args,keys,required=keys.filter(key=>!['timeoutMs','extraction'].includes(key))){
    fields(args,keys,required);uuid(args.requestId);count(args.expectedVersion,Number.MAX_SAFE_INTEGER);
    const {workspace,workspaceId,action,...input}=args;return input;
  }
  #nativeReference(resource,kind,id){
    const operation=resource.model.operation(uuid(id));
    if(kind==='edition'){
      const result=operation.data?.result;
      if(operation.kind!=='capture'||operation.state!=='COMPLETE'||result?.editionId!==id||!HASH.test(result.digest??'')||!Number.isSafeInteger(result.bytes))
        throw failure('TIMESCALE_FILE_NOT_RETAINED','Select a completed original source edition.');
      return{path:join(resource.model.directory,'editions',id+'.json'),file:{name:id+'.json',sha256:result.digest,bytes:result.bytes,type:'application/json'}};
    }
    const reference=kind==='result'?operation.data?.result?.native:kind==='before'?operation.data?.dispatch?.before:null;
    if(!reference||reference.file!==hash(reference.sha256)+'.json'||!Number.isSafeInteger(reference.bytes)||reference.bytes<0)
      throw failure('TIMESCALE_FILE_NOT_RETAINED','This original operation has no retained native file for that selection.');
    return{path:join(resource.model.directory,'records',reference.file),reference,
      file:{name:reference.file,sha256:reference.sha256,bytes:reference.bytes,type:'application/json'}};
  }
  async #file(name,resource,args){
    fields(args,['kind','id','expectedSha256','offset','limit','readId'],['kind','id','expectedSha256']);
    if(!['edition','result','before'].includes(args.kind))throw failure('INVALID_PARAMS','Choose edition, result or before.');
    const selected=this.#nativeReference(resource,args.kind,args.id);hash(args.expectedSha256);
    if(args.expectedSha256!==selected.file.sha256)throw failure('TIMESCALE_FILE_CHANGED','Use the inspected original file digest.');
    return resource.reads.read({scope:name,key:[args.kind,args.id].join(':'),kind:'TIMESCALE_NATIVE',
      directory:this.#config.exportsDirectory,expectedSha256:args.expectedSha256,readId:args.readId,
      offset:count(args.offset??0,selected.file.bytes),limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),
      load:()=>immutableDescriptor(selected.path,selected.file)});
  }
  async #package(name,resource,exportId){
    uuid(exportId);const original=resource.model.operation(exportId),result=original.data?.result;
    const directory=join(this.#config.exportsDirectory,'timescale-'+name+'-'+exportId);
    if(original.kind!=='export'||original.state!=='COMPLETE'||result?.directory!==directory||result.workspaceId!==resource.model.settings.id)
      throw failure('TIMESCALE_EXPORT_NOT_COMPLETE','Select this workspace’s completed host-owned native export.');
    hash(result.manifestDigest);
    const existing=resource.manifests.get(exportId);
    if(existing&&existing.nativeDigest===result.manifestDigest)return existing;
    const nativeBytes=await exactJsonBytes(join(directory,'manifest.json'),TIMESCALE_MANIFEST_BYTES,result.manifestDigest);
    const native=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(nativeBytes));
    if(native.schema!=='stellar-forge.timescale-package.v1'||native.complete!==true||native.requestId!==exportId||
        native.workspaceId!==resource.model.settings.id||!Array.isArray(native.files))
      throw failure('TIMESCALE_EXPORT_CHANGED','The original package identity differs from the completed operation.');
    const value={schema:TIMESCALE_DOWNLOAD_SCHEMA,exportId,workspace:name,workspaceId:native.workspaceId,
      createdAt:native.createdAt,nativeManifestSha256:result.manifestDigest,target:native.target,directories:native.directories,
      files:[{name:'manifest.json',bytes:nativeBytes.length,sha256:result.manifestDigest},
        ...native.files.map(file=>({name:file.path,bytes:file.bytes,sha256:file.sha256}))]};
    const bytes=Buffer.from(JSON.stringify(value)+'\n');
    parseTimescaleDownloadManifest(bytes,exportId);
    const selected={directory,nativeDigest:result.manifestDigest,bytes,sha256:sha(bytes),value};
    // Cache at most two complete manifests. File descriptors remain in the original reader.
    if(resource.manifests.size>=2)resource.manifests.delete(resource.manifests.keys().next().value);
    resource.manifests.set(exportId,selected);return selected;
  }
  async #exportFile(name,resource,args){
    fields(args,['exportId','file','expectedManifestSha256','expectedSha256','offset','limit','readId'],
      ['exportId','file','expectedManifestSha256','expectedSha256']);
    const selected=await this.#package(name,resource,args.exportId);
    if(hash(args.expectedManifestSha256)!==selected.sha256)throw failure('TIMESCALE_EXPORT_CHANGED','The complete download manifest changed.');
    const isManifest=args.file===TIMESCALE_DOWNLOAD_MANIFEST;
    const file=isManifest?{name:TIMESCALE_DOWNLOAD_MANIFEST,bytes:selected.bytes.length,sha256:selected.sha256,type:'application/json'}:
      selected.value.files.find(file=>file.name===args.file);
    if(!file||hash(args.expectedSha256)!==file.sha256)throw failure('TIMESCALE_EXPORT_FILE_CHANGED','Select the exact original file declared in this manifest.');
    const result=await resource.reads.read({scope:name+':export:'+args.exportId,key:file.name,kind:'TIMESCALE_PACKAGE',
      directory:this.#config.exportsDirectory,expectedSha256:file.sha256,readId:args.readId,
      offset:count(args.offset??0,file.bytes),limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),
      load:isManifest?async()=>({bytes:selected.bytes,name:file.name,type:'application/json'}):
        ()=>immutableDescriptor(join(selected.directory,file.name),file)});
    return{...result,exportId:args.exportId,manifestSha256:selected.sha256};
  }
  async #remediationItem(model,args){
    fields(args,['workItemId','itemRevision','itemDigest','section','offset','limit'],['workItemId']);
    const section=args.section??'summary';
    if(!['summary','plans','observations','history'].includes(section))throw failure('INVALID_PARAMS','Select summary, plans, observations or history.');
    if(section!=='summary'&&(args.itemRevision===undefined||args.itemDigest===undefined))
      throw failure('INVALID_PARAMS','Pin the inspected item revision and digest when paging its full history.');
    if(args.itemRevision!==undefined)count(args.itemRevision,Number.MAX_SAFE_INTEGER,1);
    if(args.itemDigest!==undefined)hash(args.itemDigest);
    return itemView(await model.remediation.item(uuid(args.workItemId)),args);
  }
  async #remediationContext(model,args){
    fields(args,['workItemId','itemRevision','itemDigest','editionId','offset','limit','changeOffset','changeLimit'],
      ['workItemId','itemRevision','itemDigest']);
    const selected=await model.remediation.item(uuid(args.workItemId));
    if(selected.item.revision!==count(args.itemRevision,Number.MAX_SAFE_INTEGER,1)||selected.digest!==hash(args.itemDigest))
      throw failure('TIMESCALE_REMEDIATION_ITEM_CHANGED','Use the inspected original item.');
    if(args.editionId!==undefined)uuid(args.editionId);
    const result=await model.remediation.context(args.workItemId,{editionId:args.editionId,
      offset:count(args.offset??0,Number.MAX_SAFE_INTEGER),limit:count(args.limit??25,100,1)});
    if(result.itemRevision!==args.itemRevision||result.version!==selected.version)
      throw failure('TIMESCALE_REMEDIATION_ITEM_CHANGED','The original workspace changed during this context read.');
    result.plans.rows=result.plans.rows.map(({changes,...plan})=>({...plan,changedFields:changes?Object.keys(changes):[]}));
    result.operations.rows=result.operations.rows.map(row=>observedView({operation:row}).operation);
    if(result.resolution){
      const {comparison,sourceChange,...metadata}=result.resolution,{changes,...declaration}=comparison;
      result.resolution={...metadata,sourceChange:changeView(sourceChange),comparison:{...declaration,
        changes:paged(changes.map(changeView),{offset:args.changeOffset,limit:args.changeLimit})}};
    }
    return result;
  }
  async #reportPackage(resource,id){
    uuid(id);const operation=resource.model.operation(id),result=operation.data?.result;
    if(operation.kind!=='remediation-report'||operation.state!=='COMPLETE'||result?.reportId!==id||
        result.workspaceId!==resource.model.settings.id)
      throw failure('TIMESCALE_REPORT_NOT_COMPLETE','Choose the original completed remediation report request.');
    hash(result.manifestSha256);
    const cached=resource.reports.get(id);if(cached?.manifestSha256===result.manifestSha256)return cached;
    const saved=await inspectTimescaleRemediationReport(resource.model,id,result.manifestSha256);
    if(saved.manifest.workItemId!==result.workItemId||saved.manifest.itemRevision!==result.itemRevision||
        saved.manifest.itemDigest!==result.itemDigest)throw failure('TIMESCALE_REPORT_BINDING_CHANGED','The original report receipt changed.');
    if(resource.reports.size>=2)resource.reports.delete(resource.reports.keys().next().value);
    resource.reports.set(id,saved);return saved;
  }
  async #reportFile(name,resource,args){
    fields(args,['exportId','file','expectedManifestSha256','expectedSha256','offset','limit','readId'],
      ['exportId','file','expectedManifestSha256','expectedSha256']);
    const selected=await this.#reportPackage(resource,args.exportId);
    if(hash(args.expectedManifestSha256)!==selected.manifestSha256)throw failure('TIMESCALE_REPORT_BINDING_CHANGED','Use the retained complete report manifest.');
    const isManifest=args.file===REMEDIATION_MANIFEST;
    const file=isManifest?{name:REMEDIATION_MANIFEST,bytes:selected.manifestBytes.length,sha256:selected.manifestSha256,type:'application/json'}:
      selected.manifest.files.find(file=>file.name===args.file);
    if(!file||hash(args.expectedSha256)!==file.sha256)throw failure('TIMESCALE_REPORT_BINDING_CHANGED','Select one exact declared report file.');
    const result=await resource.reads.read({scope:name+':report:'+args.exportId,key:file.name,kind:'TIMESCALE_REMEDIATION_REPORT',
      directory:this.#config.exportsDirectory,expectedSha256:file.sha256,readId:args.readId,
      offset:count(args.offset??0,file.bytes),limit:count(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),
      load:()=>immutableDescriptor(join(selected.directory,file.name),{...file,type:file.name.endsWith('.html')?'text/html':'application/json'})});
    return {...result,exportId:args.exportId,manifestSha256:selected.manifestSha256};
  }
  async #browser(resource,args){
    fields(args,['action','port'],['action']);if(!['open','close'].includes(args.action)||args.action==='close'&&args.port!==undefined)
      throw failure('INVALID_PARAMS','Choose browser open with an optional port, or close.');
    const port=count(args.port??0,65535);
    const operation=resource.browserTail.then(async()=>{
      if(args.action==='close'){if(resource.browser){await resource.browser.close();resource.browser=null;}return{state:'CLOSED'};}
      const reused=Boolean(resource.browser);
      if(!resource.browser){
        const {startTimescaleWorkspaceServer}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/server.mjs');
        resource.browser=await startTimescaleWorkspaceServer({workspace:resource.model,port,ownsWorkspace:false,schedule:resource.schedule});
      }else if(port&&Number(new URL(resource.browser.url).port||80)!==port)
        throw failure('TIMESCALE_BROWSER_ALREADY_OPEN','Close the original listener before selecting another port.');
      return{state:'OPEN',url:resource.browser.url,reused};
    });
    resource.browserTail=operation.then(()=>{},()=>{});return operation;
  }
  async #execute(tool,name,resource,args){
    if(args.workspaceId!==resource.model.settings.id)throw failure('TIMESCALE_WORKSPACE_CHANGED','Inspect and use this original persistent workspace ID.');
    const model=resource.model;
    if(tool.startsWith('merchant_timescale_commissioning_'))return dispatchTimescaleCommissioning({tool,name,resource,args,
      exportsDirectory:this.#config.exportsDirectory,started:value=>this.#started(resource,value),operationView});
    switch(tool){
      case'merchant_timescale_capture':return this.#started(resource,model.startCapture(this.#input(args,['requestId','expectedVersion','title','note','timeoutMs'])));
      case'merchant_timescale_edition':{
        fields(args,['editionId','table','offset','limit'],['editionId']);const current=await model.edition(uuid(args.editionId));
        const metadata={editionId:current.record.id,digest:current.record.digest,bytes:current.record.bytes,title:current.record.title,
          completedAt:current.value.completedAt,sourceDigest:current.value.sourceDigest,tables:Object.entries(current.value.tables).map(([table,value])=>({table,rows:value.rows.length,columns:value.columns}))};
        if(args.table!==undefined){const table=current.value.tables[args.table];if(!table)throw failure('TIMESCALE_TABLE_NOT_FOUND','Select a retained native table.');return{...metadata,table:args.table,columns:table.columns,...paged(table.rows,args)};}
        return{...metadata,catalog:paged(current.catalog,args)};
      }
      case'merchant_timescale_compare':{
        fields(args,['beforeId','afterId','offset','limit'],['beforeId','afterId']);const value=await model.comparison(uuid(args.beforeId),uuid(args.afterId));
        const{changes,...metadata}=value;return{...metadata,comparisonDigest:identity(value),changes:paged(changes,args)};
      }
      case'merchant_timescale_review':return this.#started(resource,model.saveReview(this.#input(args,['requestId','expectedVersion','beforeId','afterId','comparisonDigest','reviewer','note','decisions'])));
      case'merchant_timescale_refresh':{
        if(args.action==='prepare')return this.#started(resource,model.prepareRefresh(this.#input(args,['action','requestId','expectedVersion','plan'])));
        if(args.action==='run')return this.#started(resource,model.startRefresh(this.#input(args,['action','requestId','expectedVersion','planId','planDigest','timeoutMs'])));
        throw failure('INVALID_PARAMS','Choose refresh prepare or run.');
      }
      case'merchant_timescale_verify':return this.#started(resource,model.startVerification(this.#input(args,['requestId','expectedVersion','planId','planDigest','timeoutMs'])));
      case'merchant_timescale_job':{
        if(args.action==='prepare')return this.#started(resource,model.prepareJob(this.#input(args,['action','requestId','expectedVersion','editionId','editionDigest','jobId','changes','title','owner','note'])));
        if(args.action==='apply')return this.#started(resource,model.applyJob(this.#input(args,['action','requestId','expectedVersion','planId','planDigest'])));
        throw failure('INVALID_PARAMS','Choose job prepare or apply.');
      }
      case'merchant_timescale_publication':{
        if(args.action==='select')return this.#started(resource,model.selectAggregate(this.#input(args,['action','requestId','expectedVersion','selection','extraction'])));
        if(args.action==='extract')return this.#started(resource,model.startPublicationExtraction(this.#input(args,['action','requestId','expectedVersion','planId','planDigest'])));
        throw failure('INVALID_PARAMS','Choose publication select or extract.');
      }
      case'merchant_timescale_operation':
        fields(args,['action','requestId'],['action','requestId']);uuid(args.requestId);
        if(args.action==='inspect')return operationView(model.operation(args.requestId));
        if(args.action==='cancel')return model.cancel(args.requestId);
        throw failure('INVALID_PARAMS','Choose operation inspect or cancel.');
      case'merchant_timescale_plan':
        fields(args,['planId'],['planId']);return model.getPlan(uuid(args.planId));
      case'merchant_timescale_record':{
        fields(args,['requestId','record','table','offset','limit'],['requestId','record']);
        if(!['result','before'].includes(args.record))throw failure('INVALID_PARAMS','Choose result or before.');
        const selected=this.#nativeReference(resource,args.record,args.requestId),value=(await model.readRecord(selected.reference)).data;
        const tables={...(plain(value.tables)?value.tables:{})};
        for(const[key,item]of Object.entries(value))if(plain(item)&&Array.isArray(item.columns)&&Array.isArray(item.rows))tables[key]=item;
        if(args.table!==undefined){const table=tables[args.table];if(!table)throw failure('TIMESCALE_TABLE_NOT_FOUND','Select a named retained native table.');
          return{file:selected.file,schema:value.schema,table:args.table,columns:table.columns,...paged(table.rows,args)};}
        const metadata={};for(const[key,item]of Object.entries(value))if(item===null||['string','number','boolean'].includes(typeof item))metadata[key]=item;
        return{file:selected.file,metadata,tables:Object.entries(tables).map(([table,value])=>({table,rows:value.rows.length,columns:value.columns})),
          nested:Object.entries(value).filter(([key,item])=>plain(item)&&!tables[key]&&key!=='tables').map(([key])=>key)};
      }
      case'merchant_timescale_file':return this.#file(name,resource,args);
      case'merchant_timescale_file_release':
        fields(args,['readId'],['readId']);await resource.reads.release(name,uuid(args.readId));return{released:true,readId:args.readId};
      case'merchant_timescale_browser':return this.#browser(resource,args);
      case'merchant_timescale_export':{
        const input=this.#input(args,['requestId','expectedVersion']);
        const{exportTimescaleWorkspace}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/package.mjs');
        input.outputDirectory=join(this.#config.exportsDirectory,'timescale-'+name+'-'+input.requestId);
        return this.#started(resource,exportTimescaleWorkspace(model,input));
      }
      case'merchant_timescale_export_manifest':{
        fields(args,['exportId'],['exportId']);const selected=await this.#package(name,resource,args.exportId);
        return{state:'MANIFEST_RETAINED',exportId:args.exportId,nativeManifestSha256:selected.nativeDigest,
          files:selected.value.files.length,bytes:selected.value.files.reduce((n,file)=>n+file.bytes,0),
          manifestFile:{name:TIMESCALE_DOWNLOAD_MANIFEST,bytes:selected.bytes.length,sha256:selected.sha256}};
      }
      case'merchant_timescale_export_file':return this.#exportFile(name,resource,args);
      case'merchant_timescale_export_file_release':
        fields(args,['exportId','readId'],['exportId','readId']);uuid(args.exportId);await resource.reads.release(name+':export:'+args.exportId,uuid(args.readId));return{released:true,readId:args.readId};
      case'merchant_timescale_remediation_list':{
        fields(args,['offset','limit','status','owner','q']);
        const {workspace,workspaceId,...options}=args;
        return model.remediation.list(options);
      }
      case'merchant_timescale_remediation_sources':{
        fields(args,['offset','limit']);const value=await model.remediation.sources({
          offset:count(args.offset??0,Number.MAX_SAFE_INTEGER),limit:count(args.limit??25,100,1)});
        return {...value,sources:{...value.sources,rows:value.sources.rows.map(sourceView)}};
      }
      case'merchant_timescale_remediation_item':return this.#remediationItem(model,args);
      case'merchant_timescale_remediation_context':return this.#remediationContext(model,args);
      case'merchant_timescale_remediation_command':{
        fields(args,['requestId','expectedVersion','action','actor','note','workItemId','expectedRevision','source','fields',
          'planId','planDigest','relevance','operationId','operationDigest','resolution','status'],
          ['requestId','expectedVersion','action','actor','note']);
        uuid(args.requestId);count(args.expectedVersion,Number.MAX_SAFE_INTEGER);
        const {workspace,workspaceId,...input}=args;
        return this.#started(resource,model.remediation.command(input));
      }
      case'merchant_timescale_remediation_report':{
        const input=this.#input(args,['requestId','expectedVersion','workItemId','itemRevision','itemDigest']);
        return this.#started(resource,exportTimescaleRemediationReport(model,input));
      }
      case'merchant_timescale_remediation_report_manifest':{
        fields(args,['exportId'],['exportId']);const selected=await this.#reportPackage(resource,args.exportId);
        return {state:'MANIFEST_RETAINED',exportId:args.exportId,workItemId:selected.manifest.workItemId,
          itemRevision:selected.manifest.itemRevision,itemDigest:selected.manifest.itemDigest,
          files:selected.manifest.files.length,bytes:selected.manifest.files.reduce((sum,file)=>sum+file.bytes,0),
          manifestFile:{name:REMEDIATION_MANIFEST,bytes:selected.manifestBytes.length,sha256:selected.manifestSha256}};
      }
      case'merchant_timescale_remediation_report_file':return this.#reportFile(name,resource,args);
      case'merchant_timescale_remediation_report_file_release':
        fields(args,['exportId','readId'],['exportId','readId']);uuid(args.exportId);
        await resource.reads.release(name+':report:'+args.exportId,uuid(args.readId));return{released:true,readId:args.readId};
      default:throw failure('TOOL_NOT_FOUND','Unknown original Timescale operation.');
    }
  }
  async #dispatch(tool,args){
    if(tool==='merchant_timescale_status'){
      exact(args,['workspace','workspaceId','offset','limit']);const result=await this.#status(args.workspace,args);
      if(args.workspaceId!==undefined&&args.workspaceId!==result.workspaceId)throw failure('TIMESCALE_WORKSPACE_CHANGED','Use the declared original workspace ID.');
      return result;
    }
    if(tool==='merchant_timescale_open'){exact(args,['workspace'],['workspace']);return this.#open(args.workspace);}
    const configured=this.#declared(args.workspace),entry=this.#handles.get(args.workspace);
    if(!entry)throw failure('TIMESCALE_WORKSPACE_CLOSED','Open the original project with merchant_timescale_open.');
    const lease=await entry.opening,resource=lease.resource;
    if(tool==='merchant_timescale_close'){
      fields(args,['instanceId','publisherInstanceId'],['instanceId','publisherInstanceId']);
      if(args.workspaceId!==configured.workspaceId||args.instanceId!==resource.instanceId||args.publisherInstanceId!==lease.instanceId)
        throw failure('INSTANCE_CONFLICT','Use all current workspace and process IDs from status.');
      return this.#stop(args.workspace,entry);
    }
    if(entry.closing||resource.closing||lease.closed)throw failure('TIMESCALE_WORKSPACE_CLOSING','Retry the original close before acquiring another resource.');
    return lease.run(async current=>({workspace:args.workspace,workspaceId:current.model.settings.id,publisher:configured.publisher,
      instanceId:current.instanceId,publisherInstanceId:lease.instanceId,result:await this.#execute(tool,args.workspace,current,args)}));
  }
  async call(tool,args={}){
    if(this.#closing)throw failure('OPERATOR_CLOSING','The original Timescale adapter is closing.');
    args=structuredClone(args);
    const pending=this.#dispatch(tool,args);this.#pending.add(pending);
    try{return await pending;}catch(issue){
      if(issue.path||issue.syscall)throw failure('TIMESCALE_STORAGE_UNAVAILABLE','The retained original storage could not complete; inspect its saved operation before retrying.');
      throw issue;
    }finally{this.#pending.delete(pending);}
  }
  close(){
    if(this.#close)return this.#close;this.#closing=true;
    this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);
      const results=await Promise.allSettled([...this.#handles].map(([name,entry])=>this.#stop(name,entry)));
      closeFailure(results.filter(result=>result.status==='rejected').map(result=>result.reason));
    })().catch(issue=>{this.#close=null;throw issue;});
    return this.#close;
  }
}
