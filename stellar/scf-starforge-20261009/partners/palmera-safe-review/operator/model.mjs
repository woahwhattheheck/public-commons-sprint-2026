// MIT. Local operator composition over the original Safe selection and SF88 buyer.
import {randomUUID} from 'node:crypto';
import {readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {absolute,need,object,intent,digest,jsonBytes,parseJson,readBytes,readJson,
  privateDirectory,exists,safeCode} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {captureSafeTransaction,capturePalmeraTransaction,saveSelection,openSelection,
  receiveSelection,describeSelection,exactWrite} from '../transaction.mjs';
import {prepareSafePurchase,openPreparedPurchase} from '../preparation.mjs';
import {SafeSimulationBuyer,REVIEW_SCHEMA} from '../workspace.mjs';
import {HANDOVER_SCHEMA,openHandover,describeHandover,receiveHandover} from '../handover.mjs';
import {startAnalysisWorkspace} from '../../../sf88-operator-buyer-cli/tenderly-analysis/server.mjs';

const SCHEMA='stellar-forge.safe-buyer-workspace.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const META=4*1024*1024;
const key=id=>digest(Buffer.from(intent(id)));
const hash=value=>{need(typeof value==='string'&&HASH.test(value),'SAFE_WORKSPACE_HASH_REQUIRED');return value;};
const clone=value=>parseJson(jsonBytes(value));
const errorCode=error=>safeCode(error?.code,'SAFE_WORKSPACE_OPERATION_FAILED');
const handoverKey=value=>digest(jsonBytes({intentId:value.intentId,selectionId:value.selectionId,
  configSha256:value.configSha256,bodySha256:value.bodySha256,responseSha256:value.responseSha256}));
async function childDirectory(root,name){return privateDirectory(join(root,name));}
async function names(directory,pattern){
  return (await readdir(directory,{withFileTypes:true})).filter(row=>row.isDirectory()&&!row.isSymbolicLink()&&pattern.test(row.name))
    .map(row=>row.name).sort();
}
function publicError(error){return {error:errorCode(error)};}

/** Inspect the selected original paths and identity without creating a workspace. */
export async function inspectSafeBuyerConfiguration({directory,runtimeDirectory,stateDirectory,
  analysisWorkspace,operatorProfile,captureModule}={}) {
  const root=absolute(directory);
  const paths={runtimeDirectory:absolute(runtimeDirectory),stateDirectory:absolute(stateDirectory),
    analysisWorkspace:absolute(analysisWorkspace)};
  const optional={};
  for(const [name,path] of Object.entries({operatorProfile,captureModule})) {
    if(path!==undefined&&path!==null) {
      const file=absolute(path),raw=await readBytes(file,name==='operatorProfile'?65536:META);
      optional[name]={path:file,sha256:digest(raw)};
    }
  }
  const configuration={...paths,operatorProfile:optional.operatorProfile??null,
    captureModule:optional.captureModule??null};
  let manifest=null,manifestSha256=null;
  try {
    const bytes=await readBytes(join(root,'workspace.json'),65536);
    manifest=parseJson(bytes);manifestSha256=digest(bytes);
    need(object(manifest)&&manifest.schema===SCHEMA&&UUID.test(manifest.id)&&typeof manifest.createdAt==='string'&&
      (manifest.createdBy===undefined||typeof manifest.createdBy==='string'),
      'SAFE_WORKSPACE_MANIFEST_INVALID');
    if(manifest.createdBy!==undefined)intent(manifest.createdBy);
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  return {root,configuration,configurationSha256:digest(jsonBytes(configuration)),manifest,manifestSha256};
}
function launchMatches(selected,binding,creationId) {
  if(binding===undefined)return;
  need(object(binding)&&Object.keys(binding).every(name=>
    ['workspaceSha256','configurationSha256'].includes(name))&&
    (binding.workspaceSha256==='new'||HASH.test(binding.workspaceSha256??''))&&
    HASH.test(binding.configurationSha256??''),'SAFE_WORKSPACE_LAUNCH_BINDING_INVALID');
  need(binding.configurationSha256===selected.configurationSha256,'SAFE_WORKSPACE_CONFIGURATION_CHANGED');
  if(binding.workspaceSha256==='new') {
    // Continue receives the same managed request ID, never a replacement run ID.
    need(!selected.manifest||(creationId!==undefined&&selected.manifest.createdBy===creationId),
      'SAFE_WORKSPACE_IDENTITY_CHANGED');
  } else need(selected.manifestSha256===binding.workspaceSha256,'SAFE_WORKSPACE_IDENTITY_CHANGED');
}

/** All payment, request, retry and response state stays in the original Buyer. */
export async function openSafeBuyerWorkspace(options={}) {
  const {creationId,launchBinding}=options;
  if(creationId!==undefined)intent(creationId);
  const selected=await inspectSafeBuyerConfiguration(options);
  launchMatches(selected,launchBinding,creationId);
  const root=await privateDirectory(selected.root);
  need(await realpath(root)===root,'SAFE_WORKSPACE_DIRECTORY_SYMLINK');
  const file=join(root,'workspace.json');
  let createdId=null;
  if(!selected.manifest) {
    const initial={schema:SCHEMA,id:randomUUID(),createdAt:new Date().toISOString(),
      ...(creationId===undefined?{}:{createdBy:creationId})};
    createdId=initial.id;
    try {await exactWrite(file,jsonBytes(initial));}
    catch(error) {if(!await exists(file))throw error;}
  }
  const opened=await inspectSafeBuyerConfiguration(options);
  need(opened.configurationSha256===selected.configurationSha256,'SAFE_WORKSPACE_CONFIGURATION_CHANGED');
  if(launchBinding?.workspaceSha256==='new'&&creationId===undefined&&createdId!==null)
    need(opened.manifest?.id===createdId,'SAFE_WORKSPACE_IDENTITY_CHANGED');
  else launchMatches(opened,launchBinding,creationId);
  need(opened.manifest,'SAFE_WORKSPACE_MANIFEST_INVALID');
  const {configuration,configurationSha256,manifest,manifestSha256}=opened;
  const {runtimeDirectory,stateDirectory,analysisWorkspace}=configuration;
  await privateDirectory(stateDirectory);await privateDirectory(analysisWorkspace);
  const directories={};
  for(const name of ['selections','captures','prepared','reviews','handovers'])
    directories[name]=await childDirectory(root,name);
  const buyer=new SafeSimulationBuyer({runtimeDirectory,stateDirectory,analysisWorkspace,
    ...(configuration.operatorProfile?{operatorProfile:configuration.operatorProfile.path}:{})});
  return new SafeBuyerWorkspace({root,manifest,manifestSha256,
    configuration,configurationSha256,directories,buyer});
}
export class SafeBuyerWorkspace {
  constructor(value) {
    Object.assign(this,value);
    this.scope={workspaceId:this.manifest.id,configurationSha256:this.configurationSha256};
    this.jobs=new Map();this.errors=new Map();this.analysis=null;this.analysisStarting=null;this.closing=false;
  }
  async bound() {
    need(!this.closing,'SAFE_WORKSPACE_CLOSING');
    need(digest(await readBytes(join(this.root,'workspace.json')))===this.manifestSha256,
      'SAFE_WORKSPACE_IDENTITY_CHANGED');
    for(const [name,selected] of Object.entries(this.configuration)) {
      if(name==='operatorProfile'||name==='captureModule') {
        if(selected)need(digest(await readBytes(selected.path,name==='operatorProfile'?65536:META))===selected.sha256,
          'SAFE_WORKSPACE_CONFIGURATION_CHANGED');
      }
    }
  }
  requireScope(scope) {
    need(object(scope)&&scope.workspaceId===this.scope.workspaceId&&
      scope.configurationSha256===this.scope.configurationSha256,'SAFE_WORKSPACE_SCOPE_CHANGED');
  }
  active(id) {
    const job=this.jobs.get(id);
    return job?{action:job.action,abortRequested:job.controller.signal.aborted}:null;
  }
  idle(id){need(!this.jobs.has(id),'SAFE_OPERATION_ACTIVE');}
  work(id,action,binding,fn) {
    const previous=this.jobs.get(id);
    if(previous) {
      need(previous.action===action&&previous.binding===binding,'SAFE_OPERATION_ACTIVE');
      return previous.promise;
    }
    need(!this.closing,'SAFE_WORKSPACE_CLOSING');
    const controller=new AbortController(),job={id,action,binding,controller};
    this.jobs.set(id,job);this.errors.delete(id);
    job.promise=Promise.resolve().then(()=>fn(controller.signal)).catch(error=>{
      this.errors.set(id,publicError(error));throw error;
    }).finally(()=>{if(this.jobs.get(id)===job)this.jobs.delete(id);});
    return job.promise;
  }
  async state() {
    await this.bound();
    const selections=[],operations=[],captures=[],handovers=[];
    for(const id of await names(this.directories.selections,HASH)) {
      try {selections.push(describeSelection(await openSelection(join(this.directories.selections,id))));}
      catch(error){selections.push({id,...publicError(error)});}
    }
    for await(const operation of this.buyer.list()) {
      try {operations.push(await this.operation(operation.intentId));}
      catch(error){operations.push({intentId:operation.intentId,active:this.active(operation.intentId),...publicError(error)});}
    }
    for(const captureId of await names(this.directories.captures,UUID)) {
      try {
        const directory=join(this.directories.captures,captureId);
        const saved=await readJson(join(directory,'capture-input.json'));
        need(saved.captureId===captureId&&saved.schema===SCHEMA+'.capture','SAFE_CAPTURE_INPUT_CHANGED');
        const path=join(directory,'selection'),complete=await exists(join(path,'selection.json'));
        const selected=complete?await openSelection(path):null;
        captures.push({captureId,state:complete?'COMPLETE':'INPUT_SAVED',
          ...(selected?{selectionId:selected.id}:{}),active:this.active('capture:'+captureId),
          ...(this.errors.get('capture:'+captureId)??{})});
      } catch(error){captures.push({captureId,...publicError(error)});}
    }
    // Listing reads the original completion manifests. Opening a selected handover
    // validates its complete original bytes through openHandover.
    for(const id of await names(this.directories.handovers,HASH)) {
      const directory=join(this.directories.handovers,id);
      try {
        if(!await exists(join(directory,'manifest.json'))) {
          handovers.push({id,directory,state:'PREPARING'});continue;
        }
        const manifest=await readJson(join(directory,'manifest.json'));
        need(manifest.schema===HANDOVER_SCHEMA&&handoverKey(manifest.binding)===id,
          'SAFE_HANDOVER_BINDING_INVALID');
        handovers.push({id,directory,state:'SAVED',intentId:manifest.binding.intentId,
          selectionId:manifest.binding.selectionId,captureId:manifest.analysisCaptureId,
          response:manifest.files['tenderly/response.json'],files:Object.keys(manifest.files).length+1});
      } catch(error){handovers.push({id,directory,...publicError(error)});}
    }
    return {workspace:{id:this.manifest.id,directory:this.root},
      configuration:{...this.configuration,operatorConfigured:this.configuration.operatorProfile!==null,
        capture:{configured:this.configuration.captureModule!==null,
          path:this.configuration.captureModule?.path??null,sha256:this.configuration.captureModule?.sha256??null}},
      selections,operations,captures,handovers,
      active:[...this.jobs.values()].map(job=>({id:job.id,...this.active(job.id)}))};
  }
  async publishSelection(selected) {
    const destination=join(this.directories.selections,selected.id);
    const retained=destination===selected.directory?selected:await receiveSelection(selected.directory,destination);
    return describeSelection(retained);
  }
  async receiveSelection({directory}) {
    await this.bound();
    return this.publishSelection(await openSelection(absolute(directory)));
  }
  async capture({captureId,context,label=''}) {
    await this.bound();
    need(UUID.test(captureId),'SAFE_CAPTURE_ID_REQUIRED');
    need(this.configuration.captureModule,'SAFE_CAPTURE_MODULE_REQUIRED');
    need(object(context)&&typeof label==='string'&&label.length<=160,'SAFE_CAPTURE_INPUT_INVALID');
    const input={schema:SCHEMA+'.capture',captureId,configurationSha256:this.configurationSha256,
      context:clone(context),label};
    const raw=jsonBytes(input),directory=await childDirectory(this.directories.captures,captureId);
    await exactWrite(join(directory,'capture-input.json'),raw);
    return this.work('capture:'+captureId,'CAPTURE',digest(raw),async signal=>{
      const destination=join(directory,'selection');
      let selected;
      if(await exists(join(destination,'selection.json')))selected=await openSelection(destination);
      else {
        const module=await import(pathToFileURL(this.configuration.captureModule.path).href);
        need(typeof module.loadTransaction==='function','SAFE_CALLER_TRANSACTION_FACTORY_REQUIRED');
        const context=Object.freeze(clone(input.context));
        const source=await module.loadTransaction({context,signal});
        try {
          need(source&&source.transaction&&Boolean(source.palmera)!==Boolean(source.safe),
            'SAFE_CALLER_TRANSACTION_RESULT_REQUIRED');
          need(!signal.aborted,'OPERATION_ABORTED_BEFORE_START');
          const args={transaction:source.transaction,context,label:input.label||source.label||'',origin:source.origin??{}};
          const record=source.palmera?await capturePalmeraTransaction({...args,palmera:source.palmera}):
            await captureSafeTransaction({...args,safe:source.safe});
          await this.bound();
          need(!signal.aborted,'OPERATION_ABORTED_BEFORE_START');
          selected=await saveSelection(destination,record);
        } finally {if(typeof source?.close==='function')await source.close();}
      }
      return {captureId,selection:await this.publishSelection(selected)};
    });
  }
  async importPrepared(prepared) {
    let operation;
    try {operation=await this.buyer.fromPrepared(prepared.directory);}
    catch(error) {
      if(error.code!=='INTENT_ALREADY_EXISTS_USE_RECOVER')throw error;
      const original=this.buyer.customer.buyer.operation(prepared.intentId);
      const existing=await readJson(original.configPath),incoming=await readJson(prepared.configFile);
      const logical=configuration=>({
        operation:{...configuration.operation,bodyFile:null,ticketFile:null},
        expect:configuration.expect??null
      });
      need(jsonBytes(logical(existing)).equals(jsonBytes(logical(incoming))),
        'SAFE_ORIGINAL_PREPARATION_MISMATCH');
      const expectedTicket=await readBytes(prepared.ticketFile,16384);
      need(typeof existing.operation.ticketFile==='string'&&
        (await readBytes(existing.operation.ticketFile,16384)).equals(expectedTicket),
        'SAFE_ORIGINAL_PREPARATION_MISMATCH');
      operation=await this.buyer.attach(prepared.intentId,{selectionDirectory:prepared.selectionDirectory,
        merchantSelection:prepared.merchantSelection});
    }
    return {prepared,operation:await this.operation(operation.intentId)};
  }
  async prepare({selectionId,planFile,ticketFile,intentId}) {
    await this.bound();hash(selectionId);intent(intentId);
    const input={selectionId,planFile:absolute(planFile),ticketFile:absolute(ticketFile),intentId};
    const [plan,ticket]=await Promise.all([readBytes(input.planFile,65536),readBytes(input.ticketFile,16384)]);
    const binding=digest(jsonBytes({...input,planSha256:digest(plan),ticketSha256:digest(ticket)}));
    return this.work(intentId,'PREPARE',binding,async()=>{
      const prepared=await prepareSafePurchase({selectionDirectory:join(this.directories.selections,selectionId),
        planFile:input.planFile,ticketFile:input.ticketFile,intentId,directory:join(this.directories.prepared,key(intentId))});
      await this.bound();return this.importPrepared(prepared);
    });
  }
  async import({directory}) {
    await this.bound();
    const prepared=await openPreparedPurchase(absolute(directory));
    await this.publishSelection(await openSelection(prepared.selectionDirectory));
    return this.work(prepared.intentId,'IMPORT',digest(jsonBytes(prepared)),()=>this.importPrepared(prepared));
  }
  async operation(intentId) {
    intent(intentId);
    const operation=this.buyer.operation(intentId),result=await operation.inspect();
    const reviews=[],directory=join(this.directories.reviews,key(intentId));
    if(await exists(directory)) {
      for(const name of (await readdir(directory)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name))) {
        const raw=await readBytes(join(directory,name),META),review=parseJson(raw);
        need(digest(raw)===name.slice(0,-5)&&review.schema===REVIEW_SCHEMA&&review.intentId===intentId,
          'SAFE_REVIEW_FILE_CHANGED');
        reviews.push({reviewSha256:name.slice(0,-5),reviewedAt:review.original?.reviewedAt??null,
          selectionId:review.selectionId,configSha256:review.configSha256,bodySha256:review.bodySha256});
      }
      reviews.sort((a,b)=>(b.reviewedAt??'').localeCompare(a.reviewedAt??'')||a.reviewSha256.localeCompare(b.reviewSha256));
    }
    return {...result,active:this.active(intentId),reviews,...(this.errors.get(intentId)??{})};
  }
  async review({intentId}) {
    await this.bound();intent(intentId);this.idle(intentId);
    const review=await this.buyer.operation(intentId).review(),raw=jsonBytes(review),reviewSha256=digest(raw);
    const directory=await childDirectory(this.directories.reviews,key(intentId));
    await exactWrite(join(directory,reviewSha256+'.json'),raw);
    return {intentId,reviewSha256,review};
  }
  async reviewFile({intentId,sha256}) {
    await this.bound();intent(intentId);hash(sha256);
    const raw=await readBytes(join(this.directories.reviews,key(intentId),sha256+'.json'),META);
    const review=parseJson(raw);
    need(digest(raw)===sha256&&review.schema===REVIEW_SCHEMA&&review.intentId===intentId,
      'SAFE_REVIEW_FILE_CHANGED');
    return {bytes:raw,sha256,filename:'safe-review-'+key(intentId).slice(0,12)+'.json',
      type:'application/json; charset=utf-8',review};
  }
  async execute({intentId,reviewSha256}) {
    await this.bound();intent(intentId);hash(reviewSha256);
    const saved=await this.reviewFile({intentId,sha256:reviewSha256});
    const current=this.jobs.get(intentId);
    if(current) {
      need(current.action==='EXECUTE'&&current.binding===reviewSha256,'SAFE_OPERATION_ACTIVE');
      return {intentId,state:'RUNNING',active:this.active(intentId)};
    }
    const operation=this.buyer.operation(intentId);
    const retained=await operation.recover();
    if(retained)return {intentId,state:'RETAINED',result:await retained.summary(),active:null};
    // The original Buyer creates the exclusive native attempt marker and enforces
    // review, operator and payment policy before any request can be executed.
    const promise=this.work(intentId,'EXECUTE',reviewSha256,async signal=>{
      const result=await operation.execute({review:saved.review,signal});
      return result.summary();
    });
    promise.catch(()=>{});
    return {intentId,state:'RUNNING',active:this.active(intentId)};
  }
  async recover({intentId}) {
    await this.bound();intent(intentId);this.idle(intentId);
    const result=await this.buyer.operation(intentId).recover();
    return {intentId,result:result?await result.summary():null,operation:await this.operation(intentId)};
  }
  async abort({intentId}) {
    await this.bound();intent(intentId);
    const job=this.jobs.get(intentId);
    need(!job||job.action==='EXECUTE','SAFE_OPERATION_ACTIVE');
    if(job)job.controller.abort();
    return {intentId,abortRequested:job!==undefined,active:this.active(intentId)};
  }
  async result(intentId) {
    intent(intentId);this.idle(intentId);
    const result=await this.buyer.operation(intentId).recover();
    need(result,'SAFE_COMPLETE_RESULT_REQUIRED');return result;
  }
  async analysisUrl() {
    await this.bound();
    if(this.analysis)return this.analysis.url;
    if(!this.analysisStarting)this.analysisStarting=startAnalysisWorkspace({
      workspace:this.configuration.analysisWorkspace,port:0}).then(value=>{this.analysis=value;return value;})
      .finally(()=>{this.analysisStarting=null;});
    return (await this.analysisStarting).url;
  }
  async analyze({intentId}) {
    await this.bound();
    const capture=await (await this.result(intentId)).analyze();
    return {intentId,captureId:capture.record.id,record:capture.record,analysisUrl:await this.analysisUrl()};
  }
  async compare({beforeIntentId,afterIntentId,title='',notes=''}) {
    await this.bound();this.idle(intent(beforeIntentId));this.idle(intent(afterIntentId));
    need(typeof title==='string'&&title.length<=300&&typeof notes==='string'&&notes.length<=80000,
      'SAFE_COMPARISON_TEXT_INVALID');
    const comparison=await this.buyer.compare(beforeIntentId,afterIntentId,{title,notes});
    return {comparison,analysisUrl:await this.analysisUrl()};
  }
  async handoverDescription(saved,id) {
    need(handoverKey(saved.intent)===id,'SAFE_HANDOVER_BINDING_INVALID');
    const raw=await readBytes(join(saved.directory,'manifest.json'));
    return {handover:{id,...describeHandover(saved)},
      files:{...saved.manifest.files,'manifest.json':{bytes:raw.length,sha256:digest(raw)}}};
  }
  async handover({intentId}) {
    await this.bound();
    const result=await this.result(intentId),bound=await result.operation._binding();
    const id=handoverKey({intentId,selectionId:bound.selected.id,configSha256:bound.binding.configSha256,
      bodySha256:bound.binding.bodySha256,responseSha256:result.delivery.sha256});
    return this.work('handover:'+id,'HANDOVER',id,async signal=>{
      const directory=join(this.directories.handovers,id);
      await result.export(directory,{signal});
      return this.handoverDescription(await openHandover(directory),id);
    });
  }
  async openHandover({id}) {
    await this.bound();hash(id);
    return this.handoverDescription(await openHandover(join(this.directories.handovers,id)),id);
  }
  async receive({directory}) {
    await this.bound();
    const source=await openHandover(absolute(directory)),id=handoverKey(source.intent);
    const destination=join(this.directories.handovers,id);
    let result;
    if(source.directory===destination) {
      result=describeHandover(source);
    } else {
      result=await this.work('handover:'+id,'RECEIVE',digest(jsonBytes(source.manifest)),()=>
        receiveHandover(source.directory,{directory:destination,workspace:this.configuration.analysisWorkspace}));
    }
    return {...await this.openHandover({id}),received:result,analysisUrl:await this.analysisUrl()};
  }
  async download({handover:id,file}) {
    await this.bound();hash(id);
    const saved=await openHandover(join(this.directories.handovers,id));
    const described=await this.handoverDescription(saved,id),metadata=described.files[file];
    need(typeof file==='string'&&Object.hasOwn(described.files,file),'SAFE_HANDOVER_MEMBER_INVALID');
    const bytes=await readBytes(join(saved.directory,file),metadata.bytes);
    need(bytes.length===metadata.bytes&&digest(bytes)===metadata.sha256,'SAFE_HANDOVER_MEMBER_CHANGED');
    return {bytes,sha256:metadata.sha256,filename:file.split('/').at(-1),
      type:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.csv')?
        'text/csv; charset=utf-8':file.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream'};
  }
  async close() {
    if(this.closing)return this.closePromise;
    this.closing=true;
    return this.closePromise=(async()=>{
      for(const job of this.jobs.values())job.controller.abort();
      await Promise.allSettled([...this.jobs.values()].map(job=>job.promise));
      if(this.analysisStarting)await this.analysisStarting.catch(()=>{});
      if(this.analysis)await this.analysis.close();
    })();
  }
}
