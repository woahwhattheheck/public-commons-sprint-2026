// MIT. PMTiles purchases on the original SF88 object, payment and receipt engines.
import {resolve,join,isAbsolute,sep} from 'node:path';
import {privateDirectory,readBytes,readJson,exists,jsonBytes,writeBytes} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {Buyer} from '../../../sf88-operator-buyer-cli/node/client.mjs';
import {ObjectDelivery} from '../../../sf88-operator-buyer-cli/node/object.mjs';
import {selectObjectDescriptionBytes} from '../../../sf88-operator-buyer-cli/object-description.mjs';
import {operation as originalBuyerOperation} from '../../../sf88-operator-buyer-cli/config.mjs';
import {need,clone,digest,hash,identifier,rights,plain} from '../model.mjs';
import {retainJson,MAX_RESOURCE_BYTES} from '../files.mjs';
import {receiveOperationsPackage} from '../portable.mjs';
import {withNativeLease} from '../native.mjs';
import {OUTPUT_CATALOG_SCHEMA,OBJECT_DESCRIPTION_SCHEMA,OUTPUT_METADATA_BYTES,outputId,outputHash,
  outputCount,fields,outputFilename,outputOrigin,outputSnapshot,MAX_OUTPUT_BYTES,MAX_OUTPUT_CHUNKS} from './model.mjs';

const format=jsonBytes;
const PURCHASE_SCHEMA='starforge.pmtiles-output-purchase.v1';
const atomic=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(value);
function buyerIdentity(buyer){
  need(buyer instanceof Buyer,'PMTILES_ORIGINAL_BUYER_REQUIRED');
  return {stateDirectory:buyer.stateDirectory,runtimeDirectory:buyer.runtime.directory};
}
export function selectOutputCatalog(catalog,objectId){
  need(catalog?.schema===OUTPUT_CATALOG_SCHEMA&&Array.isArray(catalog.objects)&&
    catalog.objects.length>=1&&catalog.objects.length<=64,'PMTILES_OUTPUT_CATALOG_INVALID');
  const rows=catalog.objects.filter(row=>row.id===objectId);need(rows.length===1,'PMTILES_OUTPUT_SELECTION_NOT_UNIQUE');
  const row=clone(rows[0]);outputFilename(row.filename);outputHash(row.expectedSha256);outputHash(row.snapshot);
  need(row.url===outputOrigin(catalog.origin)+row.path&&row.offer?.resource?.url===row.url&&
    row.offer.resource.mimeType===row.contentType&&plain(row.pricing)&&atomic(row.pricing.atomicPerRequest),
    'PMTILES_OUTPUT_CATALOG_OFFER_CHANGED');
  const description={schema:OBJECT_DESCRIPTION_SCHEMA,objects:catalog.objects};
  const selected=selectObjectDescriptionBytes(format(description),{objectId});
  const requests=row.mode==='whole'?1:Math.ceil(row.bytes/row.maxBytes);
  outputCount(row.bytes,'Output bytes',1,MAX_OUTPUT_BYTES);
  need(requests<=MAX_OUTPUT_CHUNKS&&
    (row.mode!=='chunks'||row.fixedChunkBytes===row.maxBytes)&&
    row.snapshot===outputSnapshot({...row,sha256:row.expectedSha256,chunkBytes:row.maxBytes})&&
    row.path==='/maps/'+catalog.offerId+'/'+row.id+'/'+row.snapshot,
    'PMTILES_OUTPUT_CATALOG_SNAPSHOT_CHANGED');
  need(row.pricing.requests===requests&&row.pricing.unit===(row.mode==='whole'?'whole-object':'chunk')&&
    row.pricing.completeDownloadAtomic===(BigInt(row.pricing.atomicPerRequest)*BigInt(requests)).toString()&&
    Array.isArray(row.offer.accepts)&&row.offer.accepts.length>0&&
    row.offer.accepts.every(payment=>payment.amount===row.pricing.atomicPerRequest),
    'PMTILES_OUTPUT_CATALOG_PRICE_CHANGED');
  need(row.product?.schema==='starforge.pmtiles-output-product.v1'&&
    row.product.workspaceId===catalog.release?.workspaceId&&row.product.releaseId===catalog.release?.releaseId&&
    row.product.manifestSha256===catalog.release?.manifestSha256,'PMTILES_OUTPUT_CATALOG_RELEASE_CHANGED');
  need((row.product.resource!==undefined)!==(row.product.package!==undefined),'PMTILES_OUTPUT_PRODUCT_INVALID');
  if(row.product.resource){rights(row.product.resource.rights);identifier(row.product.resource.id);
    need(['pmtiles','style','sprite-json','sprite-png','glyph','document'].includes(row.product.resource.kind),
      'PMTILES_OUTPUT_RESOURCE_KIND_INVALID');}
  else{
    const pkg=row.product.package;outputHash(pkg.manifestSha256);outputHash(pkg.handoverSha256);
    need(pkg.archiveSha256===row.expectedSha256,'PMTILES_OUTPUT_PACKAGE_CHANGED');identifier(pkg.packageId);identifier(pkg.requestId);
  }
  return {row,description,selected};
}
function selectedConfiguration(configuration,row,requestId){
  need(plain(configuration),'PMTILES_OUTPUT_CONFIGURATION_REQUIRED');
  const op=originalBuyerOperation(configuration.operation);
  need(op.intentId===requestId&&op.method==='GET'&&op.url===row.url&&
    op.expect.maxAtomic===row.pricing.atomicPerRequest&&
    row.offer.accepts.some(payment=>payment.scheme===op.expect.scheme&&payment.network===op.expect.network&&
      payment.asset===op.expect.asset&&payment.payTo===op.expect.payTo&&payment.amount===op.expect.maxAtomic&&
      (op.expect.maxTimeoutSeconds===undefined||payment.maxTimeoutSeconds<=op.expect.maxTimeoutSeconds)),
    'PMTILES_OUTPUT_SELECTED_PAYMENT_TERMS_REQUIRED');
  return configuration;
}
function purchaseSummary(saved,progress=null){
  return {schema:PURCHASE_SCHEMA,requestId:saved.requestId,requestSha256:saved.requestSha256,
    objectId:saved.object.id,catalogSha256:saved.catalogSha256,configurationSha256:saved.configurationSha256,
    bytes:saved.object.bytes,sha256:saved.object.expectedSha256,snapshot:saved.object.snapshot,
    pricing:clone(saved.object.pricing),product:clone(saved.object.product),destination:saved.destination,
    ...(progress?{status:progress.status,native:progress.native,process:progress.process}:{} )};
}
async function purchaseFiles(buyer,directory,requestId){
  const owner=buyerIdentity(buyer);identifier(requestId);
  need(isAbsolute(directory),'PMTILES_OUTPUT_ABSOLUTE_PURCHASE_DIRECTORY_REQUIRED');
  const root=await privateDirectory(resolve(directory),{create:false});
  const request=await readJson(join(root,'request.json'),OUTPUT_METADATA_BYTES);
  const saved=await readJson(join(root,'purchase.json'),OUTPUT_METADATA_BYTES);
  need(request.requestId===requestId&&saved.schema===PURCHASE_SCHEMA&&saved.requestId===requestId&&
    saved.requestSha256===digest(request)&&digest(saved.buyer)===digest(owner)&&
    request.objectId===saved.object.id&&request.catalogSha256===saved.catalogSha256&&
    request.maxTotalAtomic===saved.maxTotalAtomic&&
    saved.destination===join(root,'received',outputFilename(saved.object.filename)),'PMTILES_OUTPUT_PURCHASE_CHANGED');
  const catalogRaw=await readBytes(join(root,'catalog.json'),OUTPUT_METADATA_BYTES);
  const configRaw=await readBytes(join(root,'configuration.json'),65536);
  const descriptionRaw=await readBytes(join(root,'objects.json'),OUTPUT_METADATA_BYTES);
  need(hash(catalogRaw)===saved.catalogSha256&&hash(configRaw)===saved.configurationSha256&&
    hash(descriptionRaw)===saved.descriptionSha256,'PMTILES_OUTPUT_PURCHASE_INPUT_CHANGED');
  const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(catalogRaw));
  const chosen=selectOutputCatalog(catalog,saved.object.id);
  need(digest(chosen.row)===digest(saved.object)&&format(chosen.description).equals(descriptionRaw),
    'PMTILES_OUTPUT_PURCHASE_OBJECT_CHANGED');
  const configuration=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configRaw));
  selectedConfiguration(configuration,saved.object,requestId);
  const acquisition=buyer.object(requestId);
  return {root,request,saved,catalog,configuration,chosen,acquisition};
}
async function originalObjectBinding(value){
  const metadata=await readJson(join(value.acquisition.directory,'object.json'),131072);
  const saved=value.saved;
  need(metadata.schema==='stellar-forge.node-object.v1'&&metadata.id===saved.requestId&&
    metadata.entryDirectory===value.acquisition.directory&&
    metadata.sessionDirectory===join(value.acquisition.directory,'session')&&metadata.source.kind==='prepared'&&
    metadata.inputs['config.json']===hash(jsonBytes(value.configuration))&&
    metadata.inputs['description.json']===saved.descriptionSha256&&metadata.plan.objectId===saved.object.id&&
    metadata.plan.maxTotalAtomic===saved.maxTotalAtomic&&metadata.plan.chunkBytes===undefined,
    'PMTILES_OUTPUT_ORIGINAL_OBJECT_CHANGED');
  return metadata;
}
/** Capture the selected public catalog and original operator configuration before native preparation. */
export async function prepareOutputPurchase({buyer,directory,input,signal}){
  input=clone(input);fields(input,['requestId','catalog','catalogSha256','objectId','configuration','operatorProfile','maxTotalAtomic'],
    ['requestId','catalog','catalogSha256','objectId','configuration','maxTotalAtomic']);
  identifier(input.requestId);outputId(input.objectId);outputHash(input.catalogSha256);
  need(atomic(input.maxTotalAtomic),'PMTILES_OUTPUT_TOTAL_BUDGET_REQUIRED');
  const owner=buyerIdentity(buyer);
  const catalogRaw=typeof input.catalog==='string'?null:format(input.catalog);
  need(catalogRaw||isAbsolute(input.catalog),'PMTILES_OUTPUT_CATALOG_FILE_REQUIRED');
  need(typeof directory==='string'&&isAbsolute(directory)&&!directory.includes('\0'),
    'PMTILES_OUTPUT_ABSOLUTE_PURCHASE_DIRECTORY_REQUIRED');
  const selectedRoot=resolve(directory);
  need(selectedRoot!==owner.stateDirectory&&!owner.stateDirectory.startsWith(selectedRoot+sep)&&
    selectedRoot!==join(owner.stateDirectory,'objects')&&!selectedRoot.startsWith(join(owner.stateDirectory,'objects')+sep),
    'PMTILES_OUTPUT_SEPARATE_PURCHASE_DIRECTORY_REQUIRED');
  const root=await privateDirectory(selectedRoot);
  await privateDirectory(join(root,'locks'));await privateDirectory(join(root,'received'));
  return withNativeLease(join(root,'locks'),'purchase-mutate',async()=>{
    signal?.throwIfAborted();
    need(format(input).length<=OUTPUT_METADATA_BYTES,'PMTILES_OUTPUT_REQUEST_SIZE_LIMIT');
    await retainJson(join(root,'request.json'),input);
    if(!await exists(join(root,'purchase.json'))){
      let raw;
      if(await exists(join(root,'catalog.json')))raw=await readBytes(join(root,'catalog.json'),OUTPUT_METADATA_BYTES);
      else raw=catalogRaw??await readBytes(input.catalog,OUTPUT_METADATA_BYTES);
      need(hash(raw)===input.catalogSha256,'PMTILES_OUTPUT_CATALOG_CHANGED');
      const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),chosen=selectOutputCatalog(catalog,input.objectId);
      need(BigInt(input.maxTotalAtomic)>=BigInt(chosen.row.pricing.completeDownloadAtomic),
        'PMTILES_OUTPUT_COMPLETE_DOWNLOAD_BUDGET_REQUIRED');
      selectedConfiguration(input.configuration,chosen.row,input.requestId);
      // Resolve the existing buyer profile once, then pass the retained exact config
      // with an empty override so a later profile edit cannot change this purchase.
      let configuration;
      if(await exists(join(root,'configuration.json')))configuration=await readJson(join(root,'configuration.json'),65536);
      else configuration=clone(await buyer._profile(input.configuration,input.operatorProfile));
      selectedConfiguration(configuration,chosen.row,input.requestId);
      const configRaw=format(configuration),descriptionRaw=format(chosen.description);
      need(configRaw.length<=65536,'PMTILES_OUTPUT_CONFIGURATION_SIZE_LIMIT');
      // Preserve complete catalog bytes, including their selected public hash.
      try{await writeBytes(join(root,'catalog.json'),raw,{exclusive:true});}
      catch(error){if(error.code!=='EEXIST')throw error;
        need((await readBytes(join(root,'catalog.json'),OUTPUT_METADATA_BYTES)).equals(raw),'PMTILES_OUTPUT_CATALOG_CHANGED');}
      await retainJson(join(root,'configuration.json'),configuration);await retainJson(join(root,'objects.json'),chosen.description);
      const saved={schema:PURCHASE_SCHEMA,requestId:input.requestId,requestSha256:digest(input),buyer:owner,
        catalogSha256:hash(raw),configurationSha256:hash(configRaw),descriptionSha256:hash(descriptionRaw),
        maxTotalAtomic:input.maxTotalAtomic,object:chosen.row,destination:join(root,'received',chosen.row.filename)};
      await retainJson(join(root,'purchase.json'),saved);
    }
    const value=await purchaseFiles(buyer,root,input.requestId);signal?.throwIfAborted();
    if(!await exists(join(value.acquisition.directory,'object.json'))){
      await buyer.createObject({id:input.requestId,config:value.configuration,operatorProfile:{},
        descriptionFile:join(root,'objects.json'),objectId:value.saved.object.id,maxTotalAtomic:value.saved.maxTotalAtomic});
    }else{await originalObjectBinding(value);await value.acquisition.initialize({signal});}
    await originalObjectBinding(value);
    return purchaseSummary(value.saved,await value.acquisition.inspect({signal}));
  });
}
export async function inspectOutputPurchase({buyer,directory,requestId,signal}){
  const value=await purchaseFiles(buyer,directory,requestId);await originalObjectBinding(value);
  return purchaseSummary(value.saved,await value.acquisition.inspect({signal}));
}
function assemblyIdentity(assembly){
  return Object.fromEntries(['id','assemblyId','sessionId','configurationSha256','snapshot','destination','bytes','sha256']
    .filter(key=>Object.hasOwn(assembly,key)).map(key=>[key,assembly[key]]));
}
async function runSelectedPurchase(value,signal){
  const delivery=await exists(value.saved.destination)
    ?await value.acquisition.delivery(value.saved.destination,{signal})
    :await value.acquisition.download(value.saved.destination,{signal});
  need(delivery instanceof ObjectDelivery&&delivery.assembly.sha256===value.saved.object.expectedSha256&&
    delivery.assembly.bytes===value.saved.object.bytes&&delivery.assembly.snapshot===value.saved.object.snapshot,
    'PMTILES_OUTPUT_DELIVERY_CHANGED');
  const path=join(value.root,'delivery.json'),record={schema:'starforge.pmtiles-output-delivery.v1',
    requestSha256:value.saved.requestSha256,requestId:value.saved.requestId,objectId:value.saved.object.id,
    catalogSha256:value.saved.catalogSha256,assembly:clone(delivery.assembly)};
  if(await exists(path)){
    const prior=await readJson(path,OUTPUT_METADATA_BYTES);
    need(prior.schema===record.schema&&prior.requestSha256===record.requestSha256&&prior.requestId===record.requestId&&
      prior.objectId===record.objectId&&prior.catalogSha256===record.catalogSha256&&
      digest(assemblyIdentity(prior.assembly))===digest(assemblyIdentity(record.assembly)),
      'PMTILES_OUTPUT_RETAINED_DELIVERY_CHANGED');
  }else await retainJson(path,record);
  return {...purchaseSummary(value.saved,delivery.report),delivery:{path:delivery.path,assembly:clone(delivery.assembly)}};
}
export async function runOutputPurchase({buyer,directory,requestId,signal}){
  const value=await purchaseFiles(buyer,directory,requestId);
  return withNativeLease(join(value.root,'locks'),'purchase-mutate',async()=>{
    signal?.throwIfAborted();await originalObjectBinding(value);return runSelectedPurchase(value,signal);
  });
}
export async function recoverOutputPurchase({buyer,directory,requestId,signal}){
  const value=await purchaseFiles(buyer,directory,requestId);
  return withNativeLease(join(value.root,'locks'),'purchase-mutate',async()=>{
    signal?.throwIfAborted();await originalObjectBinding(value);
    const progress=await value.acquisition.recover({signal});
    if(progress.status==='COMPLETE')return runSelectedPurchase(value,signal);
    return purchaseSummary(value.saved,progress);
  });
}
async function selectedDelivery(buyer,directory,requestId,signal){
  const value=await purchaseFiles(buyer,directory,requestId);await originalObjectBinding(value);
  const delivery=await value.acquisition.delivery(value.saved.destination,{signal});
  need(delivery.assembly.sha256===value.saved.object.expectedSha256&&delivery.assembly.bytes===value.saved.object.bytes&&
    delivery.assembly.snapshot===value.saved.object.snapshot,'PMTILES_OUTPUT_DELIVERY_CHANGED');
  return {...value,delivery};
}
export async function adoptPurchasedMapResource({buyer,directory,purchaseRequestId,workspace,input,signal}){
  input=clone(input);fields(input,['requestId','expectedWorkspaceId'],['requestId','expectedWorkspaceId']);
  identifier(input.requestId);identifier(input.expectedWorkspaceId);
  const value=await selectedDelivery(buyer,directory,purchaseRequestId,signal),resource=value.saved.object.product.resource;
  need(resource&&value.saved.object.bytes<=MAX_RESOURCE_BYTES,'PMTILES_OUTPUT_MAP_RESOURCE_REQUIRED');
  need(workspace.state().id===input.expectedWorkspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
  return workspace.adoptObject({...input,name:resource.name,kind:resource.kind,rights:clone(resource.rights),
    expected:{bytes:value.saved.object.bytes,sha256:value.saved.object.expectedSha256},maxBytes:value.saved.object.bytes},
    value.delivery,{signal});
}
export async function receivePurchasedMapOperations({buyer,directory,purchaseRequestId,input,signal}){
  input=clone(input);fields(input,['requestId','directory','workspaceDirectory','pythonExecutable'],
    ['requestId','directory','workspaceDirectory','pythonExecutable']);
  identifier(input.requestId);
  for(const key of ['directory','workspaceDirectory','pythonExecutable'])need(isAbsolute(input[key]),'PMTILES_OUTPUT_ABSOLUTE_RECEIVING_PATH_REQUIRED');
  const value=await selectedDelivery(buyer,directory,purchaseRequestId,signal);
  need(value.saved.object.product.package,'PMTILES_OUTPUT_OPERATIONS_PACKAGE_REQUIRED');
  const bound={schema:'starforge.pmtiles-output-customer-receiving.v1',...input,
    purchaseRequestId,catalogSha256:value.saved.catalogSha256,sourceAssembly:assemblyIdentity(value.delivery.assembly)};
  const retained=join(value.root,'receiving',input.requestId);await privateDirectory(retained);
  await retainJson(join(retained,'request.json'),bound);
  return withNativeLease(join(value.root,'locks'),'purchase-mutate',async()=>{
    signal?.throwIfAborted();
    const result=await receiveOperationsPackage({...input,archive:value.delivery.path,
      expectedArchiveSha256:value.saved.object.expectedSha256,expectedWorkspaceId:value.saved.object.product.workspaceId},{signal});
    need(result.archiveSha256===value.saved.object.expectedSha256&&result.workspaceId===value.saved.object.product.workspaceId&&
      result.packageId===value.saved.object.product.package.packageId,'PMTILES_OUTPUT_CUSTOMER_PACKAGE_CHANGED');
    const path=join(retained,'complete.json');
    let original;
    if(await exists(path)){
      original=await readJson(path,OUTPUT_METADATA_BYTES);
      const stable=record=>Object.fromEntries(Object.entries(record)
        .filter(([key])=>!['currentRevision','currentRelease','reused'].includes(key)));
      need(original.schema==='starforge.pmtiles-output-customer-complete.v1'&&
        original.requestSha256===digest(bound)&&digest(stable(original.result))===digest(stable(result)),
        'PMTILES_OUTPUT_RETAINED_CUSTOMER_CHANGED');
    }else{
      original={schema:'starforge.pmtiles-output-customer-complete.v1',requestSha256:digest(bound),result};
      await retainJson(path,original);
    }
    return {...result,purchaseRequestId,catalogSha256:value.saved.catalogSha256,
      sourceReleaseId:value.saved.object.product.releaseId,originalReceiving:clone(original.result)};
  });
}
