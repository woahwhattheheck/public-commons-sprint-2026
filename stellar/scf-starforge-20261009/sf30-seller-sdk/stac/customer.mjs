// MIT. Complete STAC acquisition and portable receiving through the original buyers.
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Buyer,BuyerResult,DatasetDelivery,ObjectReport,ObjectDelivery}
  from '../../sf88-operator-buyer-cli/node/index.mjs';
import {absolute,privateDirectory,readBytes,readJson,parseJson,jsonBytes,exists,
  digest,object,need,intent} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {withPrivateLock} from '../routescan/quota.mjs';
import {stacItemKey} from './provider.mjs';
import {readStacMerchant,stageStacMerchant,startStacMerchant,stacMerchantStatus,
  prepareStacRequest,validateStacManifest,stacQueryEntries,StacFile,stacMemberPath,
  stacRetain,stacFileRecord,stacHash,stacSame,STAC_FIELDS,STAC_CHUNK_BYTES,
  STAC_MAX_MANIFEST_BYTES} from './merchant.mjs';

const CUSTOMER='stellar-forge.stac-customer.v1';
const SELECTION='stellar-forge.stac-customer-selection.v1';
const BINDINGS='stellar-forge.stac-customer-native-bindings.v1';
const DELIVERY='stellar-forge.stac-customer-delivery.v1';
const HASH=/^[a-f0-9]{64}$/;
const NATIVE_OUTPUTS=['dataset.jsonl','dataset.csv','review.html','manifest.json'];
const MAX_REPORT=33554432;
const clone=value=>structuredClone(value);
const frozen=value=>{
  if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}
  return value;
};
function atomic(value) {
  need(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,38})$/.test(value)&&
    BigInt(value)<2n**127n,'STAC_ATOMIC_CAP_INVALID');
  return BigInt(value);
}
function integer(value,min,max,code) {
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,code);return value;
}
function selectionCore(selection){const result={...selection};delete result.selectionSha256;return result;}
function validateSelection(selection) {
  need(selection?.schema===SELECTION&&HASH.test(selection.selectionSha256??'')&&
    stacHash(selectionCore(selection))===selection.selectionSha256&&
    HASH.test(selection.editionDigest??'')&&HASH.test(selection.manifestSha256??'')&&
    HASH.test(selection.snapshot??'')&&HASH.test(selection.planSha256??'')&&
    HASH.test(selection.offersSha256??'')&&Array.isArray(selection.members)&&selection.members.length<=16384&&
    object(selection.dataset)&&object(selection.manifest),'STAC_CUSTOMER_SELECTION_CHANGED');
  intent(selection.id);integer(selection.dataset.maxPages,1,10000,'STAC_MAX_PAGES_INVALID');
  need(selection.editionId==='stac-edition-'+selection.editionDigest.slice(0,24),
    'STAC_CUSTOMER_EDITION_CHANGED');
  const ids=new Set(),names=new Set();
  for(const item of [selection.dataset,selection.manifest,...selection.members]){
    intent(item.id);intent(item.intentId);
    need(!ids.has(item.id)&&HASH.test(item.requestSha256??'')&&
      typeof item.url==='string','STAC_CUSTOMER_REQUEST_INVALID');
    const url=new URL(item.url);
    need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'STAC_CUSTOMER_URL_INVALID');
    ids.add(item.id);atomic(item.maxTotalAtomic);
  }
  for(const item of selection.members){
    stacFileRecord(item);
    need(!names.has(item.path)&&['single','object'].includes(item.mode)&&
      HASH.test(item.snapshot??'')&&item.fileId===digest(item.path),'STAC_CUSTOMER_MEMBER_CHANGED');
    names.add(item.path);
    if(item.mode==='object'){
      integer(item.chunkBytes,1,STAC_CHUNK_BYTES,'STAC_OBJECT_CHUNK_SIZE_INVALID');
      need(item.bytes>STAC_CHUNK_BYTES&&item.chunkCount===Math.ceil(item.bytes/item.chunkBytes),
        'STAC_OBJECT_CHUNK_PLAN_CHANGED');
    }else need(item.bytes<=STAC_CHUNK_BYTES&&item.chunkCount===1,'STAC_WHOLE_RESPONSE_LIMIT');
  }
  need(selection.manifest.bytes===selection.manifestBytes&&
    selection.manifest.sha256===selection.manifestSha256&&selection.manifest.mime==='application/json'&&
    selection.manifest.path==='manifest.json','STAC_SELECTED_MANIFEST_CHANGED');
  const planned=[selection.dataset,selection.manifest,...selection.members]
    .reduce((total,item)=>total+atomic(item.maxTotalAtomic),0n);
  need(planned.toString()===selection.plannedMaxAtomic&&planned<=atomic(selection.maxTotalAtomic),
    'STAC_AGGREGATE_NATIVE_CAP_CHANGED');
  return selection;
}
function info(request,{id,maxTotalAtomic,...more}) {
  return {id,intentId:request.intentId,url:request.url,requestSha256:request.configSha256,
    maxTotalAtomic,...more};
}
function preparedMap(requests) {
  need(object(requests)&&Array.isArray(requests.items),'STAC_PREPARED_REQUESTS_INVALID');
  return new Map(requests.items.map(request=>[request.intentId,request]));
}
function checkRequest(request,selection) {
  need(request&&request.editionId===selection.editionId&&request.editionDigest===selection.editionDigest&&
    request.planSha256===selection.planSha256&&request.offersSha256===selection.offersSha256&&
    request.configSha256===digest(jsonBytes(request.config)),'STAC_SAVED_PREPARATION_CHANGED');
}
/** Prepare once. Only run() obtains pages or files. The original profile stays in Buyer. */
export async function createStacCustomer({buyer,directory,merchantDirectory,id,query={},files,
  maxPages,maxTotalAtomic,chunkBytes=STAC_CHUNK_BYTES}={}) {
  need(buyer&&typeof buyer.createDataset==='function'&&typeof buyer.createObject==='function'&&
    typeof buyer.fromConfig==='function','STAC_ORIGINAL_BUYER_REQUIRED');
  intent(id);directory=absolute(directory);
  integer(maxPages,1,10000,'STAC_MAX_PAGES_INVALID');atomic(maxTotalAtomic);
  integer(chunkBytes,1,STAC_CHUNK_BYTES,'STAC_OBJECT_CHUNK_SIZE_INVALID');
  const merchant=await readStacMerchant(merchantDirectory),{plan,edition}=merchant;
  const requested=Object.fromEntries([...stacQueryEntries(query)].sort(([a],[b])=>a.localeCompare(b)));
  if(requested.fields!==undefined)need(requested.fields.split(',').includes('item_key'),
    'STAC_FEATURE_RECEIVING_REQUIRES_ITEM_KEY');
  const assetPaths=new Set(edition.manifest.assets.map(item=>item.path));
  const names=files===undefined?plan.files.filter(item=>!assetPaths.has(item.path)).map(item=>item.path):files;
  need(Array.isArray(names)&&names.length<=plan.files.length&&names.every(name=>typeof name==='string')&&
    new Set(names).size===names.length&&names.includes(edition.manifest.paths.items),
    'STAC_SELECT_DECLARED_MEMBERS_AND_ORIGINAL_ITEMS');
  const members=names.map(name=>{const file=plan.files.find(item=>item.path===name);
    need(file,'STAC_FILE_NOT_DECLARED');return file;}).sort((a,b)=>a.path.localeCompare(b.path));
  const seed=stacHash({id,planSha256:plan.planSha256,query:requested,files:members.map(item=>item.path),
    maxPages,maxTotalAtomic,chunkBytes});
  const entityId=kind=>'stac-'+seed.slice(0,24)+'-'+digest(kind).slice(0,16);
  const datasetRequest=await prepareStacRequest(merchant,{intentId:entityId('dataset'),query:requested});
  const manifestRequest=await prepareStacRequest(merchant,{intentId:entityId('manifest'),kind:'edition'});
  const requests=[datasetRequest,manifestRequest];
  const cap=request=>atomic(request.config.operation.expect.maxAtomic);
  const dataset=info(datasetRequest,{id:datasetRequest.intentId,
    maxTotalAtomic:(cap(datasetRequest)*BigInt(maxPages)).toString(),
    maxPages,maxRows:1000000,maxPageBytes:STAC_CHUNK_BYTES,expectedSnapshot:plan.snapshot});
  const manifest=info(manifestRequest,{id:manifestRequest.intentId,maxTotalAtomic:cap(manifestRequest).toString(),
    ...manifestRequest.expected,mode:'single'});
  const chosen=[];
  for(const file of members){
    const mode=file.bytes<=STAC_CHUNK_BYTES?'single':'object';
    const request=await prepareStacRequest(merchant,{intentId:entityId('file:'+file.path),kind:'file',
      file:file.path,whole:mode==='single'});
    requests.push(request);
    const count=mode==='object'?Math.ceil(file.bytes/chunkBytes):1;
    chosen.push(info(request,{id:request.intentId,maxTotalAtomic:(cap(request)*BigInt(count)).toString(),
      ...clone(file),mode,chunkBytes:mode==='object'?chunkBytes:null,chunkCount:count,
      asset:assetPaths.has(file.path)}));
  }
  const planned=[dataset,manifest,...chosen].reduce((total,item)=>total+atomic(item.maxTotalAtomic),0n);
  need(planned<=atomic(maxTotalAtomic),'STAC_DECLARED_CAP_BELOW_NATIVE_PAGE_AND_FILE_PLAN');
  const core={schema:SELECTION,id,editionId:plan.editionId,editionDigest:plan.editionDigest,
    manifestSha256:plan.manifestSha256,manifestBytes:plan.manifestBytes,snapshot:plan.snapshot,
    planSha256:plan.planSha256,offersSha256:plan.offersSha256,serviceConfigSha256:plan.serviceConfigSha256,
    payment:clone(plan.payment),query:requested,dataset,manifest,members:chosen,
    maxTotalAtomic,plannedMaxAtomic:planned.toString()};
  const selection=validateSelection({...core,selectionSha256:stacHash(core)});
  await buyer.ready();await privateDirectory(directory);
  return withPrivateLock(directory,'customer.lock',async()=>{
    const requestBytes=jsonBytes({schema:'stellar-forge.stac-customer-requests.v1',items:requests});
    need(requestBytes.length<=STAC_MAX_MANIFEST_BYTES,'STAC_PREPARED_REQUEST_BYTE_LIMIT');
    const metadata={schema:CUSTOMER,id,selectionSha256:selection.selectionSha256,
      requestsSha256:digest(requestBytes),buyerStateDirectory:buyer.stateDirectory,
      runtimeDirectory:buyer.runtime.directory};
    await stacRetain(join(directory,'selection.json'),jsonBytes(selection));
    await stacRetain(join(directory,'requests.json'),requestBytes);
    await stacRetain(join(directory,'customer.json'),jsonBytes(metadata));
    return new StacCustomer({buyer,directory,metadata,selection,requests:preparedMap({items:requests})});
  });
}
export async function openStacCustomer({buyer,directory}={}) {
  directory=await privateDirectory(absolute(directory),{create:false});
  const metadata=await readJson(join(directory,'customer.json'),65536);
  need(metadata.schema===CUSTOMER&&buyer&&metadata.buyerStateDirectory===buyer.stateDirectory&&
    metadata.runtimeDirectory===buyer.runtime.directory,'STAC_ORIGINAL_BUYER_STATE_REQUIRED');
  const selection=validateSelection(await readJson(join(directory,'selection.json'),STAC_MAX_MANIFEST_BYTES));
  need(metadata.selectionSha256===selection.selectionSha256,'STAC_CUSTOMER_SELECTION_CHANGED');
  const raw=await readBytes(join(directory,'requests.json'),STAC_MAX_MANIFEST_BYTES);
  need(digest(raw)===metadata.requestsSha256,'STAC_PREPARED_REQUESTS_CHANGED');
  const requests=preparedMap(parseJson(raw));
  for(const item of [selection.dataset,selection.manifest,...selection.members]){
    const request=requests.get(item.intentId);checkRequest(request,selection);
    need(request.configSha256===item.requestSha256&&request.url===item.url,'STAC_PREPARED_REQUEST_CHANGED');
  }
  return new StacCustomer({buyer,directory,metadata,selection,requests});
}
async function importedConfig(entity,request) {
  const raw=await readBytes(join(entity.directory,'config.json'),65536),config=parseJson(raw);
  for(const [key,value]of Object.entries(request.config)){
    if(key==='responseFile'){
      need(object(config.responseFile)&&Object.entries(value).every(([key,value])=>
        stacSame(config.responseFile[key],value)),'STAC_NATIVE_RESPONSE_SELECTION_CHANGED');
    }else need(stacSame(config[key],value),'STAC_NATIVE_REQUEST_CHANGED');
  }
  return {raw,config,sha256:digest(raw)};
}
function checkAcquisition(report,selection,binding) {
  need(report?.schema==='stellar-forge.sf88.dataset-acquisition.v1'&&report.status==='COMPLETE'&&
    report.configurationSha256===binding.configurationSha256&&report.sessionId===binding.sessionId&&
    report.sessionId===selection.dataset.intentId&&report.directory===binding.sessionDirectory&&
    report.expectedSnapshot===selection.snapshot&&report.snapshot===selection.snapshot&&
    Number.isSafeInteger(report.totalRows)&&report.totalRows>=0&&report.acquiredRows===report.totalRows,
    'STAC_ORIGINAL_DATASET_ACQUISITION_CHANGED');
  return report;
}
function checkSingle(record,item,binding) {
  const saved=record?.native?.responseFile;
  need(record?.schema==='stellar-forge.node-buyer.v1'&&record.intentId===item.intentId&&
    record.native?.intentId===item.intentId&&record.configSha256===binding.configurationSha256&&
    saved?.status==='SAVED'&&saved.bytes===item.bytes&&saved.sha256===item.sha256&&
    saved.contentType?.split(';')[0].trim().toLowerCase()===item.mime.toLowerCase(),
    'STAC_ORIGINAL_SAVED_RESPONSE_CHANGED');
  return saved;
}
function checkObject(value,item,binding) {
  const record=value?.record,report=record?.report;
  need(report?.schema==='stellar-forge.sf88.object-acquisition.v1'&&
    report.status==='COMPLETE'&&report.sessionId===binding.sessionId&&
    report.sourceIntentId===item.intentId&&report.configurationSha256===binding.configurationSha256&&
    report.expectedSnapshot===item.snapshot&&report.expectedSha256===item.sha256&&
    report.expectedContentType===item.mime&&report.bytes===item.bytes&&report.objectSha256===item.sha256&&
    report.sourceUrl===item.url,'STAC_NATIVE_OBJECT_DELIVERY_CHANGED');
  return new ObjectDelivery(new ObjectReport(record,value.process));
}
async function firstRecord(path,value) {
  if(await exists(path))return readJson(path,MAX_REPORT);
  const bytes=jsonBytes(value);
  need(bytes.length<=MAX_REPORT,'STAC_NATIVE_REPORT_LIMIT');
  await stacRetain(path,bytes);return value;
}
function bindingCore(selection,entries){return {schema:BINDINGS,selectionSha256:selection.selectionSha256,entries};}
function bindingManifest(selection,entries) {
  const core=bindingCore(selection,entries);return {...core,bindingSha256:stacHash(core)};
}
function validateBindings(selection,bindings) {
  need(bindings?.schema===BINDINGS&&bindings.selectionSha256===selection.selectionSha256&&
    object(bindings.entries)&&bindings.bindingSha256===stacHash(bindingCore(selection,bindings.entries)),
    'STAC_NATIVE_BINDINGS_CHANGED');
  for(const item of [selection.dataset,selection.manifest,...selection.members]){
    const bound=bindings.entries[item.id];
    need(bound&&bound.id===item.id&&bound.intentId===item.intentId&&
      bound.requestSha256===item.requestSha256&&HASH.test(bound.configurationSha256??'')&&
      HASH.test(bound.importedConfigSha256??''),'STAC_NATIVE_REQUEST_BINDING_CHANGED');
  }
  return bindings;
}

export class StacCustomer {
  constructor({buyer,directory,metadata,selection,requests}) {
    this.buyer=buyer;this.directory=directory;this.selection=frozen(clone(selection));
    this.metadata=frozen(clone(metadata));this._requests=requests;
  }
  async _fresh() {
    const current=await openStacCustomer({buyer:this.buyer,directory:this.directory});
    need(current.selection.selectionSha256===this.selection.selectionSha256,'STAC_CUSTOMER_CHANGED');
    return current;
  }
  async _one(item,kind) {
    const request=this._requests.get(item.intentId);checkRequest(request,this.selection);
    let entity=kind==='dataset'?this.buyer.dataset(item.id):
      kind==='object'?this.buyer.object(item.id):this.buyer.operation(item.intentId);
    if(!await exists(entity.directory)){
      try {
        if(kind==='dataset')entity=await this.buyer.createDataset({id:item.id,config:request.config,
          maxPages:item.maxPages,maxRows:item.maxRows,maxPageBytes:item.maxPageBytes,
          maxTotalAtomic:item.maxTotalAtomic,expectedSnapshot:this.selection.snapshot});
        else if(kind==='object')entity=await this.buyer.createObject({id:item.id,config:request.config,
          bytes:item.bytes,chunkBytes:item.chunkBytes,maxTotalAtomic:item.maxTotalAtomic,
          expectedSnapshot:item.snapshot,expectedSha256:item.sha256,expectedContentType:item.mime});
        else entity=await this.buyer.fromConfig(request.config);
      }catch(error){
        if(!['DATASET_ALREADY_EXISTS_USE_OPEN','OBJECT_ALREADY_EXISTS_USE_OPEN',
          'INTENT_ALREADY_EXISTS_USE_RECOVER'].includes(error.code))throw error;
      }
    }
    const imported=await importedConfig(entity,request);
    let bound={id:item.id,intentId:item.intentId,requestSha256:item.requestSha256,
      importedConfigSha256:imported.sha256};
    if(kind==='single'){
      // This is the actual original review written by Buyer.fromConfig().
      // Operation.execute() rechecks its config/body/ticket pins before a send.
      const review=await readJson(join(entity.directory,'review.json'),MAX_REPORT);
      need(review.intentId===item.intentId&&review.configSha256===imported.sha256,
        'STAC_ORIGINAL_REVIEW_CHANGED');
      bound={...bound,configurationSha256:review.configSha256};
    }else{
      const initialized=await entity.initialize(),native=initialized.native;
      need(HASH.test(native.configurationSha256??'')&&native.expectedSnapshot===
        (kind==='dataset'?this.selection.snapshot:item.snapshot),'STAC_NATIVE_SELECTION_CHANGED');
      if(kind==='dataset')need(native.sessionId===item.intentId,'STAC_NATIVE_DATASET_ID_CHANGED');
      else need(native.sourceIntentId===item.intentId&&native.sourceUrl===item.url&&
        native.bytes===item.bytes&&native.expectedSha256===item.sha256&&
        native.limits?.maxTotalAtomic===item.maxTotalAtomic,'STAC_NATIVE_OBJECT_PLAN_CHANGED');
      bound={...bound,configurationSha256:native.configurationSha256,
        sessionId:native.sessionId,sessionDirectory:native.directory};
    }
    const path=join(this.directory,'bindings',item.id+'.json');
    await stacRetain(path,jsonBytes(bound));
    return {entity,bound};
  }
  async _entries() {
    const result=new Map();
    result.set(this.selection.dataset.id,await this._one(this.selection.dataset,'dataset'));
    result.set(this.selection.manifest.id,await this._one(this.selection.manifest,'single'));
    for(const item of this.selection.members)result.set(item.id,await this._one(item,item.mode));
    const entries=Object.fromEntries([...result].map(([id,value])=>[id,value.bound]));
    const bindings=bindingManifest(this.selection,entries);
    await stacRetain(join(this.directory,'native-bindings.json'),jsonBytes(bindings));
    return {result,bindings};
  }
  async _single(item,entry,{signal}={}) {
    let result=await entry.entity.recover();
    if(result===null){
      const state=await entry.entity.inspect();
      need(state.state==='PREPARED','STAC_ORIGINAL_ATTEMPT_REQUIRES_RECOVERY');
      const review=await readJson(join(entry.entity.directory,'review.json'),MAX_REPORT);
      result=await entry.entity.execute({review,signal});
    }
    checkSingle(result.record,item,entry.bound);
    await result.verify({signal});
    const saved=await firstRecord(join(this.directory,'native',item.id+'.json'),result.record);
    checkSingle(saved,item,entry.bound);
    return result;
  }
  async inspect() {
    await this._fresh();
    const result={selection:clone(this.selection),dataset:null,manifest:null,members:[]};
    const d=this.buyer.dataset(this.selection.dataset.id);
    if(await exists(d.directory))result.dataset=await d.inspect();
    const m=this.buyer.operation(this.selection.manifest.intentId);
    if(await exists(m.directory))result.manifest=await m.inspect();
    for(const item of this.selection.members){
      const entity=item.mode==='object'?this.buyer.object(item.id):this.buyer.operation(item.intentId);
      result.members.push({path:item.path,mode:item.mode,
        native:await exists(entity.directory)?await entity.inspect():null});
    }
    return result;
  }
  /** Stop/restart reuses native IDs, attempts and byte windows. No paid send occurs in recover(). */
  async recover({signal}={}) {
    return withPrivateLock(this.directory,'customer.lock',async()=>{
      await this._fresh();
      const result={dataset:null,manifest:null,members:[]};
      const dataset=this.buyer.dataset(this.selection.dataset.id);
      if(await exists(dataset.directory))result.dataset=await dataset.recover({signal});
      const manifest=this.buyer.operation(this.selection.manifest.intentId);
      if(await exists(manifest.directory)){
        const native=await manifest.recover();result.manifest=native?.record??null;
      }
      for(const item of this.selection.members){
        const entity=item.mode==='object'?this.buyer.object(item.id):this.buyer.operation(item.intentId);
        if(await exists(entity.directory)){
          const native=await entity.recover({signal});
          result.members.push({path:item.path,native:item.mode==='object'
            ?{record:native.record,process:native.process}:native?.record??null});
        }
      }
      return result;
    });
  }
  async run({signal,progress}={}) {
    need(signal===undefined||signal instanceof AbortSignal,'STAC_ABORT_SIGNAL_INVALID');
    need(progress===undefined||typeof progress==='function','STAC_PROGRESS_CALLBACK_INVALID');
    return withPrivateLock(this.directory,'customer.lock',async()=>{
      await this._fresh();const {result:entries}=await this._entries();
      const notify=async event=>{if(progress)await progress(event);};
      await notify({phase:'edition',completedMembers:0,totalMembers:this.selection.members.length});
      const edition=await this._single(this.selection.manifest,entries.get(this.selection.manifest.id),{signal});
      const manifest=validateStacManifest(await edition.json({limit:STAC_MAX_MANIFEST_BYTES,signal}));
      need(manifest.id===this.selection.editionId&&manifest.digest===this.selection.editionDigest,
        'STAC_PURCHASED_EDITION_CHANGED');
      await notify({phase:'dataset',completedMembers:0,totalMembers:this.selection.members.length});
      const dataset=await entries.get(this.selection.dataset.id).entity.run({signal});
      if(dataset.native.status!=='COMPLETE')return {selection:clone(this.selection),dataset,completedMembers:0};
      checkAcquisition(dataset.native,this.selection,entries.get(this.selection.dataset.id).bound);
      await firstRecord(join(this.directory,'native','dataset-acquisition.json'),dataset.native);
      let completedMembers=0;
      for(const item of this.selection.members){
        need(!signal?.aborted,'STAC_CUSTOMER_ABORTED');
        const entry=entries.get(item.id);
        await notify({phase:'member',path:item.path,mode:item.mode,completedMembers,
          totalMembers:this.selection.members.length});
        if(item.mode==='single')await this._single(item,entry,{signal});
        else{
          const native=await entry.entity.run({signal});
          if(native.native.status!=='COMPLETE')return {selection:clone(this.selection),dataset,
            member:{path:item.path,record:native.record,process:native.process},completedMembers};
        }
        completedMembers++;
      }
      await notify({phase:'acquired',completedMembers,totalMembers:this.selection.members.length});
      return {selection:clone(this.selection),dataset,completedMembers};
    });
  }
  /** Native SF100 delivery and object assembly are offline; the portable manifest is published last. */
  async deliver(destination,{signal,progress}={}) {
    return withPrivateLock(this.directory,'customer.lock',async()=>{
      await this._fresh();const {result:entries,bindings}=await this._entries();
      const selection=this.selection,small={'selection.json':jsonBytes(selection),
        'native-bindings.json':jsonBytes(bindings)},streams=new Map(),native={members:{}};
      const acquisitionPath=join(this.directory,'native','dataset-acquisition.json');
      if(await exists(acquisitionPath))native.acquisition=await readJson(acquisitionPath,MAX_REPORT);
      else{
        const inspected=(await entries.get(selection.dataset.id).entity.inspect({signal})).native;
        checkAcquisition(inspected,selection,bindings.entries[selection.dataset.id]);
        native.acquisition=await firstRecord(acquisitionPath,inspected);
      }
      checkAcquisition(native.acquisition,selection,bindings.entries[selection.dataset.id]);
      small['native/dataset-acquisition.json']=jsonBytes(native.acquisition);
      const datasetPath=join(this.directory,'native','dataset-delivery.json');
      let dataset;
      if(await exists(datasetPath)){
        native.dataset=await readJson(datasetPath,MAX_REPORT);dataset=await DatasetDelivery.open(native.dataset);
      }else{
        dataset=await entries.get(selection.dataset.id).entity.deliver(join(this.directory,'dataset-delivery'),{signal});
        native.dataset=await firstRecord(datasetPath,dataset.report);
      }
      need(native.dataset.nativeStatus?.snapshot===selection.snapshot&&
        native.dataset.sourceDirectory===bindings.entries[selection.dataset.id].sessionDirectory&&
        native.dataset.nativeStatus.rows===native.acquisition.totalRows&&
        native.dataset.nativeStatus.total===native.acquisition.totalRows,
        'STAC_NATIVE_DATASET_DELIVERY_CHANGED');
      small['native/dataset-delivery.json']=jsonBytes(native.dataset);
      for(const name of NATIVE_OUTPUTS)streams.set('dataset/'+name,dataset.file(name));
      for(const item of [selection.manifest,...selection.members]){
        const entry=entries.get(item.id);
        let file,record;
        if(item.mode==='object'){
          const target=join(this.directory,'received',item.fileId+'.bin');
          const reportPath=join(this.directory,'native',item.id+'.json');
          await privateDirectory(join(this.directory,'received'));
          if(await exists(reportPath))record=await readJson(reportPath,MAX_REPORT);
          else{
            const delivery=await (await exists(target)?entry.entity.delivery(target,{signal}):
              entry.entity.assemble(target,{signal}));
            record=await firstRecord(reportPath,{record:delivery.report.record,process:delivery.report.process});
          }
          file=checkObject(record,item,entry.bound);await file.verify({signal});
        }else{
          const recovered=await entry.entity.recover();
          need(recovered,'STAC_NATIVE_RESPONSE_NOT_AVAILABLE');
          checkSingle(recovered.record,item,entry.bound);
          record=await firstRecord(join(this.directory,'native',item.id+'.json'),recovered.record);
          checkSingle(record,item,entry.bound);
          const response=(await importedConfig(entry.entity,this._requests.get(item.intentId))).config.responseFile;
          file=new BuyerResult(record,response,this.buyer.runtime.directory);await file.verify({signal});
        }
        const isManifest=item.id===selection.manifest.id;
        if(isManifest)native.manifest=record;else native.members[item.fileId]=record;
        small['native/'+item.id+'.json']=jsonBytes(record);
        streams.set('edition/'+item.path,file);
      }
      const edition=validateStacManifest(await streams.get('edition/manifest.json')
        .json({limit:STAC_MAX_MANIFEST_BYTES,signal}));
      need(edition.digest===selection.editionDigest,'STAC_PURCHASED_EDITION_CHANGED');
      const records={};
      for(const [path,bytes]of Object.entries(small))records[path]=
        {path,mime:'application/json',bytes:bytes.length,sha256:digest(bytes)};
      for(const name of NATIVE_OUTPUTS){
        const output=native.dataset.outputs[name];
        records['dataset/'+name]={path:'dataset/'+name,
          mime:name.endsWith('.csv')?'text/csv':name.endsWith('.html')?'text/html':
            name.endsWith('.jsonl')?'application/x-ndjson':'application/json',
          bytes:output.bytes,sha256:output.sha256};
      }
      for(const item of [selection.manifest,...selection.members])records['edition/'+item.path]=
        {path:'edition/'+item.path,mime:item.mime,bytes:item.bytes,sha256:item.sha256};
      const core={schema:DELIVERY,selectionSha256:selection.selectionSha256,
        editionId:selection.editionId,editionDigest:selection.editionDigest,snapshot:selection.snapshot,
        nativeBindingSha256:bindings.bindingSha256,files:records};
      const manifest={...core,bundleSha256:stacHash(core)};
      return copyBundle({manifest,small,streams},destination,{signal,progress});
    });
  }
}
function readSmall(directory,manifest,name,limit=MAX_REPORT) {
  const record=manifest.files[name];need(record,'STAC_DELIVERY_MEMBER_MISSING');
  return new StacFile(directory,record).bytes({limit});
}
function bundleIdentity(manifest){const core={...manifest};delete core.bundleSha256;return core;}
function localSingle(original,item,binding,path) {
  checkSingle(original,item,binding);
  const local=clone(original);local.native.responseFile.path=path;
  return new BuyerResult(local,{destination:path,maxBytes:Math.max(1,item.bytes),
    expectedBytes:item.bytes,expectedSha256:item.sha256,expectedContentType:item.mime});
}
function localObject(original,item,binding,path) {
  checkObject(original,item,binding);
  const local=clone(original);
  local.record.delivery.file.path=path;local.record.delivery.assembly.destination=path;
  return new ObjectDelivery(new ObjectReport(local.record,local.process));
}
/** Offline receiving needs only this directory. Original reports are kept unchanged;
 * a separate local view resolves paths for the maintained native file readers.
 */
export class StacDelivery {
  constructor({directory,manifest,selection,bindings,edition,native,dataset,files,small}) {
    this.directory=directory;this.manifest=frozen(clone(manifest));this.selection=frozen(clone(selection));
    this.edition=frozen(clone(edition));this.native=frozen(clone(native));
    this.bindings=frozen(clone(bindings));this._dataset=dataset;this._files=files;this._small=small;
    this.pathMapping=frozen({dataset:{original:native.dataset.directory,local:dataset.report.directory},
      members:Object.fromEntries([selection.manifest,...selection.members].map(item=>{
        const original=item.id===selection.manifest.id?native.manifest:native.members[item.fileId];
        return [item.path,{original:item.mode==='object'?original.record.delivery.file.path:
          original.native.responseFile.path,local:stacMemberPath(directory,'edition/'+item.path)}];
      }))});
  }
  static async open(directory,{signal}={}) {
    directory=await privateDirectory(absolute(directory),{create:false});
    const manifest=await readJson(join(directory,'manifest.json'),STAC_MAX_MANIFEST_BYTES);
    need(manifest.schema===DELIVERY&&HASH.test(manifest.bundleSha256??'')&&object(manifest.files)&&
      Object.keys(manifest.files).length<=32790&&manifest.bundleSha256===stacHash(bundleIdentity(manifest)),
      'STAC_DELIVERY_MANIFEST_CHANGED');
    for(const [name,record]of Object.entries(manifest.files))
      need(stacFileRecord(record).path===name,'STAC_DELIVERY_PATH_CHANGED');
    const small={};
    const read=async(name,limit)=>{const bytes=await readSmall(directory,manifest,name,limit);
      small[name]=bytes;return parseJson(bytes);};
    const selection=validateSelection(await read('selection.json',STAC_MAX_MANIFEST_BYTES));
    const bindings=validateBindings(selection,await read('native-bindings.json',STAC_MAX_MANIFEST_BYTES));
    need(manifest.selectionSha256===selection.selectionSha256&&manifest.editionId===selection.editionId&&
      manifest.editionDigest===selection.editionDigest&&manifest.snapshot===selection.snapshot&&
      manifest.nativeBindingSha256===bindings.bindingSha256,'STAC_DELIVERY_SELECTION_CHANGED');
    const expected=['selection.json','native-bindings.json','native/dataset-acquisition.json','native/dataset-delivery.json',
      ...NATIVE_OUTPUTS.map(name=>'dataset/'+name),
      ...[selection.manifest,...selection.members].flatMap(item=>['native/'+item.id+'.json','edition/'+item.path])];
    need(expected.length===Object.keys(manifest.files).length&&expected.every(name=>Object.hasOwn(manifest.files,name)),
      'STAC_DELIVERY_FILE_SET_CHANGED');
    const native={acquisition:await read('native/dataset-acquisition.json',MAX_REPORT),
      dataset:await read('native/dataset-delivery.json',MAX_REPORT),members:{}};
    const binding=bindings.entries[selection.dataset.id];
    checkAcquisition(native.acquisition,selection,binding);
    need(native.dataset.schema==='stellar-forge.sf88.dataset-delivery.v1'&&
      native.dataset.nativeStatus?.finalized===true&&native.dataset.nativeStatus.snapshot===selection.snapshot&&
      native.dataset.sourceDirectory===binding.sessionDirectory&&HASH.test(native.dataset.sourceBindingSha256??'')&&
      native.dataset.nativeStatus.rows===native.acquisition.totalRows&&
      native.dataset.nativeStatus.total===native.acquisition.totalRows,
      'STAC_NATIVE_DATASET_DELIVERY_CHANGED');
    const local=clone(native.dataset);local.directory=join(directory,'dataset');
    local.outputs={};
    for(const name of NATIVE_OUTPUTS){
      const original=native.dataset.outputs[name],saved=manifest.files['dataset/'+name];
      need(original&&original.path===join(absolute(native.dataset.directory),name)&&
        original.bytes===saved.bytes&&original.sha256===saved.sha256,'STAC_NATIVE_DATASET_OUTPUT_CHANGED');
      local.outputs[name]={...original,path:join(local.directory,name)};
    }
    const dataset=await DatasetDelivery.open(local);
    need(dataset.manifest.dataset.projectedFields.includes('item_key'),'STAC_NATIVE_DATASET_ITEM_KEY_MISSING');
    for(const name of NATIVE_OUTPUTS)await dataset.file(name).verify({signal});
    const files=new Map();
    for(const item of [selection.manifest,...selection.members]){
      const name='native/'+item.id+'.json',original=await read(name,MAX_REPORT);
      const saved=manifest.files['edition/'+item.path];
      need(saved.bytes===item.bytes&&saved.sha256===item.sha256&&saved.mime===item.mime,
        'STAC_DELIVERY_MEMBER_CHANGED');
      const path=stacMemberPath(directory,'edition/'+item.path);
      const file=item.mode==='object'?localObject(original,item,bindings.entries[item.id],path):
        localSingle(original,item,bindings.entries[item.id],path);
      await file.verify({signal});files.set(item.path,file);
      if(item.id===selection.manifest.id)native.manifest=original;else native.members[item.fileId]=original;
    }
    const edition=validateStacManifest(await files.get('manifest.json').json({limit:STAC_MAX_MANIFEST_BYTES,signal}));
    need(edition.id===selection.editionId&&edition.digest===selection.editionDigest,
      'STAC_ORIGINAL_EDITION_CHANGED');
    for(const item of selection.members){
      const original=edition.files.find(entry=>entry.path===item.path);
      need(original&&['bytes','sha256','mime'].every(key=>original[key]===item[key]),
        'STAC_RECEIVED_MEMBER_EDITION_BINDING_CHANGED');
    }
    need(files.has(edition.paths.items),'STAC_ORIGINAL_FEATURES_REQUIRED');
    return new StacDelivery({directory,manifest,selection,bindings,edition,native,dataset,files,small});
  }
  members(){return [this.selection.manifest,...this.selection.members].map(item=>
    ({path:item.path,bytes:item.bytes,sha256:item.sha256,mime:item.mime,asset:item.asset===true}));}
  file(relativeMemberPath) {
    need(this._files.has(relativeMemberPath),'STAC_MEMBER_WAS_NOT_ACQUIRED');
    return this._files.get(relativeMemberPath);
  }
  rows(options){return this._dataset.rows(options);}
  readRows(options){return this._dataset.readRows(options);}
  get datasetManifest(){return this._dataset.manifest;}
  /** Exact original Feature objects, in acquired dataset order; no reconstructed fields. */
  async *features({signal,maxBytes=268435456}={}) {
    integer(maxBytes,1,268435456,'STAC_FEATURE_READ_LIMIT_INVALID');
    const original=await this.file(this.edition.paths.items).json({limit:maxBytes,signal});
    need(original?.type==='FeatureCollection'&&Array.isArray(original.features),
      'STAC_ORIGINAL_FEATURE_COLLECTION_REQUIRED');
    const byKey=new Map();
    for(const feature of original.features){
      need(feature?.type==='Feature','STAC_ORIGINAL_FEATURE_REQUIRED');
      const key=stacItemKey(feature),list=byKey.get(key)??[];list.push(feature);byKey.set(key,list);
    }
    for await(const row of this.rows({signal})){
      const candidates=byKey.get(row.item_key)??[];
      const matching=candidates.filter(feature=>[
        ['geometry_json',feature.geometry??null],['properties_json',feature.properties],
        ['assets_json',feature.assets??{}],['links_json',feature.links??[]]
      ].every(([column,value])=>!Object.hasOwn(row,column)||row[column]===JSON.stringify(value)));
      need(matching.length>0&&matching.every(item=>stacSame(item,matching[0])),
        'STAC_ACQUIRED_SCENE_ORIGINAL_FEATURE_CHANGED');
      yield clone(matching[0]);
    }
  }
  async copyTo(destination,options={}) {
    const streams=new Map();
    for(const name of NATIVE_OUTPUTS)streams.set('dataset/'+name,this._dataset.file(name));
    for(const [name,file]of this._files)streams.set('edition/'+name,file);
    return copyBundle({manifest:this.manifest,small:this._small,streams},destination,options);
  }
}
async function copyBundle({manifest,small,streams},destination,{signal,progress}={}) {
  destination=absolute(destination);
  need(signal===undefined||signal instanceof AbortSignal,'STAC_ABORT_SIGNAL_INVALID');
  need(progress===undefined||typeof progress==='function','STAC_PROGRESS_CALLBACK_INVALID');
  await privateDirectory(destination);
  if(await exists(join(destination,'manifest.json'))){
    const existing=await StacDelivery.open(destination,{signal});
    need(existing.manifest.bundleSha256===manifest.bundleSha256,'STAC_DESTINATION_HAS_ANOTHER_DELIVERY');
    return existing;
  }
  need((await readdir(destination)).every(name=>['selection.json','native-bindings.json','native','dataset','edition'].includes(name)||
    /^\.write-[a-f0-9-]{36}$/.test(name)),'STAC_SEPARATE_DELIVERY_DIRECTORY_REQUIRED');
  let completedBytes=0,completedFiles=0;
  const totalBytes=Object.values(manifest.files).reduce((sum,file)=>sum+file.bytes,0);
  for(const [name,record]of Object.entries(manifest.files)){
    need(!signal?.aborted,'STAC_DELIVERY_COPY_ABORTED');
    const path=stacMemberPath(destination,name);await privateDirectory(join(path,'..'));
    if(small[name])await stacRetain(path,small[name]);
    else if(await exists(path))await new StacFile(destination,record).verify({signal});
    else{
      const file=streams.get(name);need(file,'STAC_NATIVE_DELIVERY_STREAM_MISSING');
      await file.saveAs(path,{signal});
    }
    completedBytes+=record.bytes;completedFiles++;
    if(progress)await progress({phase:'receiving',path:name,completedBytes,totalBytes,
      completedFiles,totalFiles:Object.keys(manifest.files).length});
  }
  await stacRetain(join(destination,'manifest.json'),jsonBytes(manifest));
  return StacDelivery.open(destination,{signal});
}

function requiredFlag(flags,name) {
  const value=flags[name]??flags['--'+name];
  need(typeof value==='string'&&value.length>0,'STAC_FLAG_'+name.toUpperCase().replace(/-/g,'_')+'_REQUIRED');
  return value;
}
function optionalFlag(flags,name) {return flags[name]??flags['--'+name];}
function boolFlag(flags,name) {
  const value=optionalFlag(flags,name);
  need(value===undefined||typeof value==='boolean','STAC_BOOLEAN_FLAG_INVALID');return value===true;
}
function numberFlag(flags,name,fallback) {
  const value=optionalFlag(flags,name);
  if(value===undefined)return fallback;
  need(typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value),'STAC_INTEGER_FLAG_INVALID');
  const result=Number(value);need(Number.isSafeInteger(result),'STAC_INTEGER_FLAG_INVALID');return result;
}
async function jsonFlag(flags,name,{optional=false}={}) {
  const value=optionalFlag(flags,name);
  if(value===undefined&&optional)return undefined;
  return parseJson(await readBytes(absolute(requiredFlag(flags,name)),STAC_MAX_MANIFEST_BYTES));
}
/** This is the only commercial CLI loader. Private JSON stays out of analyst browser state. */
export async function runStacCommercialCommand({command,flags={}}={}) {
  need(object(flags),'STAC_FLAGS_INVALID');
  if(command==='merchant-stage')return {result:await stageStacMerchant({
    editionDirectory:absolute(requiredFlag(flags,'edition')),directory:absolute(requiredFlag(flags,'directory')),
    origin:requiredFlag(flags,'origin'),path:optionalFlag(flags,'path')??'/stac',payment:await jsonFlag(flags,'payment')})};
  if(command==='merchant-status')return {result:await stacMerchantStatus(absolute(requiredFlag(flags,'directory')))};
  if(command==='merchant-serve'){
    const session=await startStacMerchant({directory:absolute(requiredFlag(flags,'directory')),
      port:numberFlag(flags,'port',8423),facilitator:optionalFlag(flags,'facilitator'),
      allowLocalFacilitator:boolFlag(flags,'allow-local-facilitator'),challengeOnly:boolFlag(flags,'challenge-only')});
    return {result:{url:session.url,mode:session.mode,editionId:session.editionId,snapshot:session.snapshot,
      paths:session.paths,publicOrigin:session.publicOrigin,merchantDirectory:session.merchantDirectory},
      close:()=>session.close()};
  }
  if(command==='customer-open'){
    const delivery=await StacDelivery.open(absolute(requiredFlag(flags,'directory')));
    return {result:{directory:delivery.directory,manifest:delivery.manifest,edition:delivery.edition,
      members:delivery.members(),dataset:delivery.datasetManifest.dataset}};
  }
  need(['customer-create','customer-inspect','customer-run','customer-recover','customer-deliver'].includes(command),
    'STAC_COMMERCIAL_COMMAND_UNKNOWN');
  const options=await jsonFlag(flags,'buyer-config');
  need(object(options),'STAC_ORIGINAL_BUYER_CONFIG_REQUIRED');
  const buyer=await new Buyer(options).ready(),directory=absolute(requiredFlag(flags,'directory'));
  const customer=command==='customer-create'?await createStacCustomer({buyer,directory,
    merchantDirectory:absolute(requiredFlag(flags,'merchant')),id:requiredFlag(flags,'id'),
    query:await jsonFlag(flags,'query',{optional:true}),files:await jsonFlag(flags,'files',{optional:true}),
    maxPages:numberFlag(flags,'max-pages'),maxTotalAtomic:requiredFlag(flags,'max-total-atomic'),
    chunkBytes:numberFlag(flags,'chunk-bytes',STAC_CHUNK_BYTES)}):await openStacCustomer({buyer,directory});
  if(command==='customer-create')return {result:{directory,selection:customer.selection}};
  if(command==='customer-inspect')return {result:await customer.inspect()};
  if(command==='customer-recover')return {result:await customer.recover()};
  if(command==='customer-run')return {result:await customer.run()};
  const delivery=await customer.deliver(absolute(requiredFlag(flags,'out')));
  return {result:{directory:delivery.directory,manifest:delivery.manifest,members:delivery.members(),
    dataset:delivery.datasetManifest.dataset}};
}
