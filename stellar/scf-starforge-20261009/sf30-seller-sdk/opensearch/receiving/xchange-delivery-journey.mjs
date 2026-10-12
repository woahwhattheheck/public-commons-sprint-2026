// MIT. Complete original ETIM xChange source through supplier delivery and customer receiving.
import assert from 'node:assert/strict';
import { readFile, mkdir, open, link, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createOpenSearchWorkspace } from '../workspace/service.mjs';
import { startOpenSearchWorkspace } from '../workspace/server.mjs';
import { hashCatalogFile } from '../catalog/workspace.mjs';
import { main as catalogCli } from '../catalog/cli.mjs';
import { readXChange } from '../catalog/supplier/xchange/input.mjs';
import { validateXChange, XCHANGE_SCHEMA, XCHANGE_PRODUCT_SCHEMA,
  XCHANGE_SUPPLIER_SCHEMA } from '../catalog/supplier/xchange/schema.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const SAMPLE='ETIM_xChange_SampleFile_V2.0_2025-11-27.json';
const SCHEMA='ETIM_xChange_Schema_V2.0_2025-11-27.json';
const PUBLISHED='https://etim.de/wp-content/uploads/2025/12/ETIM-xChange_V2.0-2025-11-27.zip';
const SAMPLE_SHA='cf81492486cdd2c3a976e07dc901c45fa101fe95797ee6697364e7b56533e04e';
const SCHEMA_SHA='5d05577f392661397fbbeff7a1e0486796a515ae65afbe8ab069ab1c9697f20a';
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const FORMATS=['xchange.json','recipient.jsonl','impact.csv','review.json','issues.csv','products.jsonl'];
const URI_PATH='/xChange/product/LcaEnvironmental/ProductSpecificRulesUri';
const URI_RELATIVE='/LcaEnvironmental/ProductSpecificRulesUri';

async function syncDirectory(path) {
  const directory=await open(dirname(path),'r');
  try{await directory.sync();}finally{await directory.close();}
}
async function originalFile(path,body) {
  const expected=Buffer.from(body);
  try{assert.ok((await readFile(path)).equals(expected),'The retained original file differs: '+path);return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path+'.'+randomUUID()+'.part',file=await open(temporary,'wx',0o600);
  try{
    await file.writeFile(expected);await file.sync();await file.close();
    try{await link(temporary,path);}
    catch(error){if(error.code!=='EEXIST')throw error;assert.ok((await readFile(path)).equals(expected),'The retained original file differs: '+path);}
    await syncDirectory(path);
  }finally{await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
async function operation(workspace,id,action) {
  let value;
  try{value=workspace.operation(id);}catch(error){if(error.code!=='WORKSPACE_OPERATION_NOT_FOUND')throw error;}
  value??=await action(id);
  if(value.state!=='COMPLETE')throw Object.assign(new Error(value.error?.message??'The original operation remains '+value.state),
    {code:value.error?.code??'XCHANGE_JOURNEY_OPERATION_INCOMPLETE',operation:value});
  return value.result;
}
async function output(path,describe,operationId) {
  const name=basename(path),receiptPath=path+'.receipt.json';
  const retained=async receipt=>{
    assert.equal(receipt.schema,'stellar-forge.xchange-export-receipt.v1');
    assert.equal(receipt.operationId,operationId);assert.equal(receipt.name,name);
    assert.match(receipt.temporary,/^xchange-export-[0-9a-f-]{36}\.part$/);
    const temporary=join(dirname(path),receipt.temporary);
    let actual;
    try{actual=await hashCatalogFile(path);}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const pending=await hashCatalogFile(temporary);
      assert.equal(pending.bytes,receipt.bytes);assert.equal(pending.sha256,receipt.sha256);
      try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
      await syncDirectory(path);actual=await hashCatalogFile(path);
    }
    assert.equal(actual.bytes,receipt.bytes,'Retained export size: '+name);
    assert.equal(actual.sha256,receipt.sha256,'Retained export identity: '+name);
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    return{name,bytes:receipt.bytes,sha256:receipt.sha256,type:receipt.type,retained:true};
  };
  let receipt;
  try{receipt=JSON.parse(await readFile(receiptPath,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(receipt)return retained(receipt);
  // Open the original descriptor only if its complete retained result is absent.
  const descriptor=await describe();
  const temporaryName='xchange-export-'+randomUUID()+'.part',temporary=join(dirname(path),temporaryName);
  const file=await open(temporary,'wx',0o600);let receiptAttempted=false;
  try{
    const values=typeof descriptor.body==='string'||Buffer.isBuffer(descriptor.body)?[descriptor.body]:descriptor.body;
    for await(const value of values)await file.writeFile(value);
    await file.sync();await file.close();
    const actual=await hashCatalogFile(temporary);
    try{
      const existing=await hashCatalogFile(path);
      assert.equal(existing.bytes,actual.bytes,'Unreceipted export differs: '+name);
      assert.equal(existing.sha256,actual.sha256,'Unreceipted export differs: '+name);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    receipt={schema:'stellar-forge.xchange-export-receipt.v1',operationId,name,
      bytes:actual.bytes,sha256:actual.sha256,type:descriptor.type,temporary:temporaryName};
    receiptAttempted=true;await originalFile(receiptPath,JSON.stringify(receipt)+'\n');
    const result=await retained(receipt);return{...result,retained:false};
  }finally{
    await file.close().catch(()=>{});
    if(!receiptAttempted)await unlink(temporary).catch(()=>{});
  }
}
async function nativeDocument(path,expected={}) {
  const products=[],suppliers=[];let complete;
  for await(const event of readXChange(path,expected)){
    if(event.type==='product')products.push(event);
    else if(event.type==='supplier')suppliers.push(event);
    else if(event.type==='complete')complete=event;
  }
  assert.ok(complete,'The original reader must reach complete EOF and source identity.');
  assert.equal(complete.productCount,products.length);assert.equal(complete.supplierCount,suppliers.length);
  const findings=[];
  findings.push(...validateXChange(complete.header,{schema:XCHANGE_SCHEMA,numberTokens:complete.numberTokens,omit:['Supplier']}));
  for(const row of suppliers)findings.push(...validateXChange(row.header,{
    schema:XCHANGE_SUPPLIER_SCHEMA,numberTokens:row.numberTokens,omit:['Product'],path:'/Supplier/'+row.supplierIndex}));
  for(const row of products)findings.push(...validateXChange(row.product,{
    schema:XCHANGE_PRODUCT_SCHEMA,numberTokens:row.numberTokens,path:'/Supplier/'+row.supplierIndex+'/Product/'+row.productIndex}));
  return{products,suppliers,complete,findings};
}
function allRecipientRows(supplier,reviewId,filters={}) {
  const rows=[];let offset=0,identity=null,total=null;
  do{
    const page=supplier.recipientRows({reviewId,...filters,offset,limit:1});
    if(identity===null){identity=page.reviewSha256;total=page.total;}
    else{assert.equal(page.reviewSha256,identity);assert.equal(page.total,total);}
    rows.push(...page.rows);
    if(page.nextOffset!==null)assert.ok(page.nextOffset>offset,'Recipient pagination must advance.');
    offset=page.nextOffset;
  }while(offset!==null);
  assert.equal(rows.length,total);return rows;
}
function scopedTokens(tokens,{withoutTrade=false}={}) {
  return Object.fromEntries(Object.entries(tokens).filter(([path])=>!withoutTrade||
    (path!=='/TradeItem'&&!path.startsWith('/TradeItem/'))));
}
function temporaryIntakeTables(workspace) {
  return workspace.store.db.prepare("SELECT name FROM sqlite_temp_master WHERE type='table' AND (name LIKE 'catalog_xchange_%' OR name LIKE 'xchange_compare_%') ORDER BY name").all().map(row=>row.name);
}

export async function runXChangeDeliveryJourney({directory,
  inputsDirectory=join(HERE,'../catalog/supplier/xchange/source'),
  operationId='xchange-etim-2769'}={}) {
  if(!directory||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/.test(operationId))
    throw new TypeError('Supply a private directory and stable operation ID.');
  directory=resolve(directory);inputsDirectory=resolve(inputsDirectory);
  for(const child of ['inputs','exports'])await mkdir(join(directory,child),{recursive:true,mode:0o700});
  const samplePath=join(directory,'inputs',SAMPLE),schemaPath=join(directory,'inputs',SCHEMA);
  const originalSample=await readFile(join(inputsDirectory,SAMPLE)),originalSchema=await readFile(join(inputsDirectory,SCHEMA));
  assert.equal(originalSample.length,27705);assert.equal(hash(originalSample),SAMPLE_SHA);
  assert.equal(originalSchema.length,62128);assert.equal(hash(originalSchema),SCHEMA_SHA);
  await originalFile(samplePath,originalSample);await originalFile(schemaPath,originalSchema);
  const sourceFile=join(directory,'source.json');
  const sourceConfig={schema:'stellar-forge.opensearch-source.v1',endpointEnv:'XCHANGE_JOURNEY_ENDPOINT',
    auth:{type:'none'},allowLocal:true,maxInFlight:1,queries:{catalog_bootstrap:{
      indices:['supplier_catalog'],query:{match_all:{}},parameters:{},fields:['material_id'],sort:[],
      pageSize:100,maxHits:1000,maxBytes:917504,timeoutMs:15000,probe:{}}}};
  await originalFile(sourceFile,JSON.stringify(sourceConfig,null,2)+'\n');
  const reportPath=join(directory,'xchange-delivery-native.json');
  const implementationBytes=await readFile(fileURLToPath(import.meta.url));
  const implementation={path:fileURLToPath(import.meta.url),bytes:implementationBytes.length,sha256:hash(implementationBytes)};
  try{
    const completed=JSON.parse(await readFile(reportPath,'utf8'));
    assert.equal(completed.schema,'stellar-forge.xchange-delivery-native.v1');
    assert.equal(completed.operationId,operationId);assert.equal(completed.state,'CLOSED');
    assert.equal(completed.directory,directory);assert.equal(completed.sourceFile,sourceFile);
    assert.equal(completed.implementation.sha256,implementation.sha256,'Resume uses the complete original receiving program.');
    for(const artifact of completed.exports){
      assert.equal(basename(artifact.name),artifact.name);
      const actual=await hashCatalogFile(join(directory,'exports',artifact.name));
      assert.equal(actual.sha256,artifact.sha256);assert.equal(actual.bytes,artifact.bytes);
    }
    assert.ok(completed.exports.some(file=>file.name===completed.bundle.name&&file.sha256===completed.bundle.sha256));
    return completed;
  }catch(error){if(error.code!=='ENOENT')throw error;}

  const published=await nativeDocument(samplePath,{expectedBytes:27705,expectedSha256:SAMPLE_SHA});
  assert.equal(published.products.length,1);assert.equal(published.suppliers.length,1);
  const originalProduct=published.products[0],originalSupplier=published.suppliers[0],originalHeader=published.complete;
  assert.equal(originalProduct.product.ProductIdentification.ManufacturerProductNumber,'04011969');
  assert.equal(originalProduct.product.TradeItem.length,1);
  assert.equal(originalProduct.product.TradeItem[0].ItemIdentification.SupplierItemNumber,'221099');
  assert.equal(Object.keys(originalProduct.numberTokens).length,38);
  assert.equal(published.findings.length,1,JSON.stringify(published.findings));
  assert.equal(published.findings[0].code,'XCHANGE_SCHEMA_FORMAT');
  assert.equal(published.findings[0].path,'/Supplier/0/Product/0'+URI_RELATIVE);
  const originalUri=originalProduct.product.LcaEnvironmental.ProductSpecificRulesUri,correctedUri=originalUri.trimEnd();
  assert.notEqual(originalUri,correctedUri);assert.equal(originalUri,correctedUri+' ');
  const uriPatch={path:URI_PATH,value:correctedUri,reason:'Remove the single trailing U+0020 after the PDF URI in the complete original publisher example '+PUBLISHED+'#'+SAMPLE+'.'};
  const correctedProduct=clone(originalProduct.product);correctedProduct.LcaEnvironmental.ProductSpecificRulesUri=correctedUri;
  assert.deepEqual(validateXChange(correctedProduct,{schema:XCHANGE_PRODUCT_SCHEMA,numberTokens:originalProduct.numberTokens}),[]);
  const config={sourceFile,env:{...process.env,XCHANGE_JOURNEY_ENDPOINT:'http://127.0.0.1:9200'}};
  const workspacePaths={producer:join(directory,'producer'),receiver:join(directory,'receiver')};
  const openWorkspace=async name=>{
    const workspace=await createOpenSearchWorkspace({...config,directory:workspacePaths[name]});
    workspace.store.db.exec('PRAGMA wal_autocheckpoint=100;');return workspace;
  };
  const inputs={officialSample:{path:samplePath,bytes:27705,sha256:SAMPLE_SHA},
    officialSchema:{path:schemaPath,bytes:62128,sha256:SCHEMA_SHA}};
  const phases=[],exports=[],startedAt=new Date().toISOString();
  const record=(phase,value)=>phases.push({phase,...value});
  const emit=async(name,describe)=>{
    const artifact=await output(join(directory,'exports',name),describe,operationId);exports.push(artifact);return artifact;
  };
  const exportReview=async(workspace,review,label,formats=FORMATS)=>{
    const files=[];
    for(const format of formats)files.push({...await emit(label+'-'+format,()=>workspace.catalog.supplier.export({
      reviewId:review.id,format,expectedReviewSha256:review.sha256})),format});
    return files;
  };
  const verifyNative=async(artifact,{type,version,tradeItems,product=correctedProduct,tokens=originalProduct.numberTokens}={})=>{
    const result=await nativeDocument(join(directory,'exports',artifact.name),{
      expectedBytes:artifact.bytes,expectedSha256:artifact.sha256});
    assert.deepEqual(result.findings,[],'The complete exported message must satisfy the pinned publisher schema.');
    assert.equal(result.complete.header.CatalogueType,type);assert.equal(result.complete.header.CatalogueVersion,version);
    assert.equal(result.suppliers.length,1);assert.deepEqual(result.suppliers[0].header,originalSupplier.header);
    assert.equal(result.products.length,1);assert.deepEqual(result.products[0].product,product);
    assert.deepEqual(result.products[0].numberTokens,tokens);
    assert.equal(result.products[0].product.TradeItem?.length??0,tradeItems);
    return{bytes:artifact.bytes,sha256:artifact.sha256,products:result.products.length,tradeItems,
      numberTokens:Object.keys(result.products[0].numberTokens).length,schemaSha256:SCHEMA_SHA};
  };
  let producer,receiver,running;
  try{
    producer=await openWorkspace('producer');
    const template=producer.catalog.supplier.templates({target:'xchange-2.0'});
    const recipientTemplate=producer.catalog.supplier.templates({target:'2ba-xchange-2.0'});
    assert.equal(template.profile.target,'xchange-2.0');assert.equal(recipientTemplate.profile.target,'2ba-xchange-2.0');
    assert.equal(recipientTemplate.profile.statusMapping,null);
    const saved=await operation(producer,operationId+'-catalog',requestId=>producer.catalog.save({
      requestId,title:'ETIM xChange original supplier delivery',tenantId:'etim-xchange-published-sample',mapping:template.catalogMapping}));
    const catalogId=saved.catalog.id;
    const provenance={url:PUBLISHED+'#'+SAMPLE,publisher:'ETIM International',revision:'2.0 / 2025-11-27',
      kind:'published-standard-example',note:'Complete unchanged publisher JSON, including native headers, product/trade records and exact numeric tokens.'};
    const uploaded=await operation(producer,operationId+'-source',requestId=>producer.catalog.upload({
      requestId,name:SAMPLE,bytes:27705,sha256:SAMPLE_SHA,format:{kind:'xchange-json'},provenance},createReadStream(samplePath)));
    const officialSource={sourceId:uploaded.source.id,name:uploaded.source.name,provenance:clone(uploaded.source.provenance),
      bytes:uploaded.source.bytes,sha256:uploaded.source.sha256,format:clone(uploaded.source.format)};
    const preview=await operation(producer,operationId+'-edition',requestId=>producer.catalog.preview({
      requestId,catalogId,expectedRevision:saved.catalog.revision,sourceId:uploaded.source.id,mode:'full',baseEditionId:null}));
    const selected=await operation(producer,operationId+'-select',requestId=>producer.catalog.select({
      requestId,catalogId,expectedRevision:saved.catalog.revision,editionId:preview.edition.id,reviewSha256:preview.edition.reviewSha256}));
    const materials=producer.catalog.materials({editionId:preview.edition.id,offset:0,limit:200});
    assert.equal(materials.total,1);const material=materials.rows[0],materialKey=material.key;
    assert.deepEqual(material.attributes.xChange.product,originalProduct.product);
    assert.deepEqual(material.attributes.xChange.numberTokens,originalProduct.numberTokens);
    assert.deepEqual(material.attributes.xChange.supplier.header,originalSupplier.header);
    assert.deepEqual(material.attributes.xChange.catalogue.header,originalHeader.header);
    assert.deepEqual(material.attributes.xChange.source.document,{bytes:27705,sha256:SAMPLE_SHA});
    assert.deepEqual(temporaryIntakeTables(producer),[]);
    const catalogOnly=await emit('xchange-catalog-before-supplier-v1.jsonl',()=>producer.catalog.export(catalogId,'catalog-bundle.jsonl'));
    record('original_native_source',{catalogId,editionId:preview.edition.id,materialKey,officialSource,
      suppliers:1,products:1,tradeItems:1,numberTokens:38,publisherFindings:published.findings,catalogBundle:catalogOnly});

    const initial=await operation(producer,operationId+'-full-original-plan',requestId=>producer.catalog.supplierSave({
      requestId,catalogId,editionId:preview.edition.id,title:'Original publisher FULL catalogue 2.0',
      profile:template.profile,bindings:template.bindings}));
    const first=await operation(producer,operationId+'-original-findings',requestId=>producer.catalog.supplierReview({
      requestId,planId:initial.supplierPlan.id,expectedRevision:initial.supplierPlan.revision}));
    const originalRow=producer.catalog.supplier.reviewRow({reviewId:first.supplierReview.id,materialKey});
    const originalRecipientRows=allRecipientRows(producer.catalog.supplier,first.supplierReview.id);
    assert.ok(originalRow.findings.some(item=>item.code==='XCHANGE_SCHEMA_FORMAT'&&item.path===URI_PATH));
    assert.ok(first.supplierReview.counts.errors>0);
    await exportReview(producer,first.supplierReview,'xchange-original-findings',['review.json','issues.csv','products.jsonl']);
    const correction=await operation(producer,operationId+'-original-uri',requestId=>{
      const current=producer.catalog.supplier.currentProduct({planId:initial.supplierPlan.id,materialKey});
      return producer.catalog.supplierCorrection({requestId,planId:initial.supplierPlan.id,
        expectedPlanRevision:initial.supplierPlan.revision,expectedRevision:0,materialKey,
        expectedMaterialSha256:current.material.sha256,expectedBaseProductSha256:current.baseProductSha256,patches:[uriPatch]});
    });
    const ready=await operation(producer,operationId+'-full-original-review',requestId=>producer.catalog.supplierReview({
      requestId,planId:initial.supplierPlan.id,expectedRevision:initial.supplierPlan.revision}));
    assert.equal(ready.supplierReview.counts.errors,0,JSON.stringify(ready.supplierReview.findings));
    const firstRows=allRecipientRows(producer.catalog.supplier,ready.supplierReview.id);
    assert.deepEqual(firstRows.map(row=>row.kind).sort(),['product','tradeItem']);
    assert.equal(ready.supplierReview.recipient.counts.productsAdded,1);
    assert.equal(ready.supplierReview.recipient.counts.tradeItemsAdded,1);
    const firstFiles=await exportReview(producer,ready.supplierReview,'ETIM_XCHANGE_original_FULL');
    const firstNative=firstFiles.find(file=>file.format==='xchange.json');
    await verifyNative(firstNative,{type:'FULL',version:'2.0',tradeItems:1});
    const earlierBundle=await emit('xchange-first-full-v2.jsonl',()=>producer.catalog.export(catalogId,'catalog-bundle.jsonl'));
    record('source_correction_and_first_full',{planId:initial.supplierPlan.id,reviewId:ready.supplierReview.id,
      reviewSha256:ready.supplierReview.sha256,correctionRevision:correction.supplierCorrection.revision,
      sourceCorrection:{path:URI_PATH,original:originalUri,corrected:correctedUri},counts:ready.supplierReview.recipient.counts,
      native:firstNative,bundle:earlierBundle});

    const withoutTrade=clone(correctedProduct);delete withoutTrade.TradeItem;
    const withoutTradeNumbers=scopedTokens(originalProduct.numberTokens,{withoutTrade:true});
    const makeDelivery=async({suffix,type,version,previous,omitTrade})=>{
      const header=clone(originalHeader.header);header.CatalogueType=type;header.CatalogueVersion=version;
      if(type==='CHANGE')header.ChangeReferenceCatalogueVersion=previous.recipient.header.CatalogueVersion;
      else delete header.ChangeReferenceCatalogueVersion;
      const profile={...clone(template.profile),header:{value:header,numberTokens:clone(originalHeader.numberTokens),
        reason:'Receiving workflow '+suffix+' uses the complete original publisher headers with explicit catalogue version '+version+
          (type==='CHANGE'?' and its selected previous version '+previous.recipient.header.CatalogueVersion:'.')+
          (omitTrade?' The original trade item is deliberately omitted from this complete delivery selection.':' The complete original trade item is included.')}};
      const planned=await operation(producer,operationId+'-'+suffix+'-plan',requestId=>producer.catalog.supplierSave({
        requestId,catalogId,editionId:preview.edition.id,title:'ETIM xChange '+type+' '+version,
        profile,bindings:template.bindings,previousReviewId:previous.id}));
      const plan=planned.supplierPlan;
      const changed=await operation(producer,operationId+'-'+suffix+'-correction',requestId=>{
        const current=producer.catalog.supplier.currentProduct({planId:plan.id,materialKey});
        const patches=omitTrade?[{
          path:'/xChange/product',value:withoutTrade,
          reason:'Use the complete original published product with the documented URI correction while omitting its trade-item array for this '+type+' receiving phase.'
        },{path:'/xChange/numberTokens',value:withoutTradeNumbers,reason:'Retain every original numeric token outside the deliberately omitted trade-item subtree.'}]:[uriPatch];
        return producer.catalog.supplierCorrection({requestId,planId:plan.id,expectedPlanRevision:plan.revision,
          expectedRevision:0,materialKey,expectedMaterialSha256:current.material.sha256,
          expectedBaseProductSha256:current.baseProductSha256,patches});
      });
      const reviewed=await operation(producer,operationId+'-'+suffix+'-review',requestId=>producer.catalog.supplierReview({
        requestId,planId:plan.id,expectedRevision:plan.revision}));
      const review=reviewed.supplierReview;assert.equal(review.counts.errors,0,JSON.stringify(review.findings));
      assert.equal(review.recipient.previousReviewId,previous.id);assert.equal(review.recipient.previousReviewSha256,previous.sha256);
      const files=await exportReview(producer,review,'ETIM_XCHANGE_'+suffix+'_'+type);
      const native=files.find(file=>file.format==='xchange.json');
      const validation=await verifyNative(native,{type,version,tradeItems:omitTrade?0:1,
        product:omitTrade?withoutTrade:correctedProduct,tokens:omitTrade?withoutTradeNumbers:originalProduct.numberTokens});
      const rows=allRecipientRows(producer.catalog.supplier,review.id);
      return{plan,review,correction:changed.supplierCorrection,files,native,validation,rows};
    };
    const changed=await makeDelivery({suffix:'change-retain',type:'CHANGE',version:'2.1',previous:ready.supplierReview,omitTrade:true});
    const retainedTrade=changed.rows.find(row=>row.kind==='tradeItem');
    assert.equal(retainedTrade.identifier,'221099');assert.equal(retainedTrade.action,'unchanged');
    assert.deepEqual(retainedTrade.before,retainedTrade.after);assert.equal(changed.review.recipient.counts.tradeItemsTotal,1);
    assert.equal(changed.review.recipient.counts.tradeItemsUnchanged,1);
    assert.equal(changed.review.recipient.header.ChangeReferenceCatalogueVersion,'2.0');
    record('change_retains_unlisted_trade_item',{planId:changed.plan.id,reviewId:changed.review.id,
      previousReviewId:ready.supplierReview.id,version:'2.1',reference:'2.0',counts:changed.review.recipient.counts,
      retainedTradeItem:retainedTrade.identifier,native:changed.validation});

    const removed=await makeDelivery({suffix:'full-remove',type:'FULL',version:'2.2',previous:changed.review,omitTrade:true});
    const deletedTrade=removed.rows.find(row=>row.kind==='tradeItem');
    assert.equal(deletedTrade.identifier,'221099');assert.equal(deletedTrade.action,'deleted');
    assert.ok(deletedTrade.before);assert.equal(deletedTrade.after,null);
    assert.equal(removed.review.recipient.counts.tradeItemsDeleted,1);assert.equal(removed.review.recipient.counts.tradeItemsTotal,0);
    record('full_removes_unlisted_trade_item',{planId:removed.plan.id,reviewId:removed.review.id,
      previousReviewId:changed.review.id,version:'2.2',counts:removed.review.recipient.counts,native:removed.validation});

    const restored=await makeDelivery({suffix:'full-restore',type:'FULL',version:'2.3',previous:removed.review,omitTrade:false});
    const restoredTrade=restored.rows.find(row=>row.kind==='tradeItem');
    assert.equal(restoredTrade.identifier,'221099');assert.equal(restoredTrade.action,'added');assert.equal(restoredTrade.before,null);
    assert.equal(restored.review.recipient.counts.tradeItemsAdded,1);assert.equal(restored.review.recipient.counts.tradeItemsTotal,1);
    const bySupplier=allRecipientRows(producer.catalog.supplier,restored.review.id,{search:originalSupplier.header.SupplierName});
    assert.equal(bySupplier.length,restored.rows.length);
    const bundle=await emit('xchange-complete-producer-v2.jsonl',()=>producer.catalog.export(catalogId,'catalog-bundle.jsonl'));
    record('full_restores_original_trade_item',{planId:restored.plan.id,reviewId:restored.review.id,
      previousReviewId:removed.review.id,version:'2.3',counts:restored.review.recipient.counts,native:restored.validation,bundle});
    await producer.close();producer=null;

    receiver=await openWorkspace('receiver');
    const receive=(artifact,suffix)=>operation(receiver,operationId+suffix,requestId=>receiver.catalog.importBundle({
      requestId,name:artifact.name,bytes:artifact.bytes,sha256:artifact.sha256},createReadStream(join(directory,'exports',artifact.name))));
    const receivedCatalog=await receive(catalogOnly,'-receive-v1');
    const receivedFirst=await receive(earlierBundle,'-receive-first-v2');
    const receivedFull=await receive(bundle,'-receive-complete-v2');
    assert.equal(receivedCatalog.handover.schema,'stellar-forge.material-catalog-bundle.v1');
    assert.equal(receivedFirst.handover.schema,'stellar-forge.material-catalog-bundle.v2');
    assert.equal(receivedFull.handover.schema,'stellar-forge.material-catalog-bundle.v2');
    for(const [review,rows] of [[first.supplierReview,originalRecipientRows],[ready.supplierReview,firstRows],
      [changed.review,changed.rows],[removed.review,removed.rows],[restored.review,restored.rows]]){
      assert.equal(receiver.catalog.supplier.review(review.id).sha256,review.sha256);
      assert.deepEqual(allRecipientRows(receiver.catalog.supplier,review.id),rows);
    }
    assert.ok(receiver.catalog.supplier.reviewRow({reviewId:first.supplierReview.id,materialKey}).findings.some(f=>f.path===URI_PATH));
    assert.deepEqual(receiver.catalog.supplier.currentProduct({planId:restored.plan.id,materialKey}).product.xChange.product,correctedProduct);
    await receiver.close();receiver=await openWorkspace('receiver');
    const source=await receiver.catalog.retainedSource(uploaded.source.id);
    assert.equal(source.bytes,27705);assert.equal(source.sha256,SAMPLE_SHA);
    assert.ok((await readFile(source.path)).equals(originalSample));
    record('complete_portable_receive_and_reopen',{schemas:[receivedCatalog.handover.schema,receivedFirst.handover.schema,receivedFull.handover.schema],
      sourceSha256:source.sha256,reviewIds:[first.supplierReview.id,ready.supplierReview.id,changed.review.id,removed.review.id,restored.review.id],
      producerReviewSha256:restored.review.sha256,originalSourceReopened:true});
    await receiver.close();receiver=null;

    const runCli=async(args)=>{
      const stdout=[],stderr=[],capture=chunks=>new Writable({write(chunk,encoding,next){chunks.push(Buffer.from(chunk));next();}});
      const result=await catalogCli([...args,'--source',sourceFile,'--workspace',workspacePaths.receiver],
        {env:config.env,stdout:capture(stdout),stderr:capture(stderr)});
      const text=Buffer.concat(stdout).toString('utf8'),errors=Buffer.concat(stderr).toString('utf8');
      assert.ok(result===undefined||result===0||typeof result==='object','Original CLI failure: '+errors);
      return{result,stdout:text,stderr:errors};
    };
    const cliTemplate=await runCli(['catalog-supplier-profile','--target','xchange-2.0']);
    assert.equal(JSON.parse(cliTemplate.stdout).profile.target,'xchange-2.0');
    const cliPage=await runCli(['catalog-supplier-recipient-rows','--review',restored.review.id,'--limit','1']);
    const cliRows=JSON.parse(cliPage.stdout);assert.equal(cliRows.total,2);assert.equal(cliRows.rows.length,1);
    assert.equal(cliRows.reviewSha256,restored.review.sha256);assert.equal(cliRows.nextOffset,1);
    const cliPage2=await runCli(['catalog-supplier-recipient-rows','--review',restored.review.id,'--offset','1','--limit','1']);
    const cliRows2=JSON.parse(cliPage2.stdout);assert.equal(cliRows2.nextOffset,null);
    assert.deepEqual([...cliRows.rows,...cliRows2.rows],restored.rows);
    const cliPath=join(directory,'exports','ETIM_XCHANGE_cli_FULL.json');
    const cliExport=await runCli(['catalog-supplier-export','--review',restored.review.id,
      '--review-sha256',restored.review.sha256,'--format','xchange.json','--output',cliPath]);
    const cliFile={name:basename(cliPath),...await hashCatalogFile(cliPath),type:'application/json'};
    assert.equal(cliFile.sha256,restored.native.sha256);exports.push(cliFile);
    record('installed_cli_native_delivery',{entry:'catalog/cli.mjs',recipientPages:2,rows:2,
      reviewId:restored.review.id,export:JSON.parse(cliExport.stdout),native:await verifyNative(cliFile,{type:'FULL',version:'2.3',tradeItems:1})});

    receiver=await openWorkspace('receiver');
    running=await startOpenSearchWorkspace({workspace:receiver,port:0});
    const sessionResponse=await fetch(running.url+'/api/session');assert.equal(sessionResponse.status,200);
    const session=await sessionResponse.json();
    const api=async(path,request)=>{
      const response=await fetch(running.url+path,request?{method:'POST',headers:{
        origin:running.url,'x-workspace-token':session.token,'content-type':'application/json'},body:JSON.stringify(request)}:undefined);
      const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
    };
    for(const path of ['/xchange.mjs','/supplier.mjs','/catalog.mjs','/style.css']){
      const response=await fetch(running.url+path);assert.equal(response.status,200);assert.ok((await response.text()).length>0);
    }
    const httpTemplate=await api('/api/catalog/supplier/profile?target=2ba-xchange-2.0');
    assert.equal(httpTemplate.profile.target,'2ba-xchange-2.0');
    const page=await api('/api/catalog/supplier/recipient-rows?'+new URLSearchParams({
      reviewId:restored.review.id,search:originalSupplier.header.SupplierName,limit:'1'}));
    assert.equal(page.total,2);assert.equal(page.reviewSha256,restored.review.sha256);
    const current=await api('/api/catalog/supplier/product?'+new URLSearchParams({planId:restored.plan.id,materialKey}));
    const warrantyPath='/ProductDetails/WarrantyConsumer',warranty=originalProduct.numberTokens[warrantyPath];
    assert.equal(warranty,'24');
    const customerPatches=[uriPatch,{path:'/xChange/product'+warrantyPath,value:warranty,
      reason:'Receiving operator confirmed the original 24-month consumer warranty directly against the complete retained ETIM publisher sample.'},
      {path:'/xChange/numberTokens',value:clone(originalProduct.numberTokens),
        reason:'Retain all 38 original native number tokens while recording the receiving operator confirmation.'}];
    const request={action:'supplier-correction',requestId:operationId+'-customer-confirmation',
      planId:restored.plan.id,expectedPlanRevision:restored.plan.revision,materialKey,
      expectedRevision:restored.correction.revision,expectedMaterialSha256:current.material.sha256,
      expectedBaseProductSha256:current.baseProductSha256,patches:customerPatches};
    const sent=await api('/api/catalog',request),replayed=await api('/api/catalog',request);
    assert.deepEqual(sent,replayed);
    const customerCorrection=sent.result.supplierCorrection;
    assert.equal(customerCorrection.revision,restored.correction.revision+1);
    const reviewed=await api('/api/catalog',{action:'supplier-review',requestId:operationId+'-customer-review',
      planId:restored.plan.id,expectedRevision:restored.plan.revision});
    const customerReview=reviewed.result.supplierReview;assert.equal(customerReview.counts.errors,0);
    const customerRows=allRecipientRows(receiver.catalog.supplier,customerReview.id);
    assert.equal(customerRows.length,2);
    await receive(bundle,'-older-producer-replay');
    await receive(earlierBundle,'-older-first-replay');
    const kept=receiver.catalog.supplier.currentProduct({planId:restored.plan.id,materialKey});
    assert.equal(kept.correction.revision,customerCorrection.revision);assert.equal(kept.correction.sha256,customerCorrection.sha256);
    assert.deepEqual(kept.correction.patches,customerPatches);assert.deepEqual(kept.product.xChange.product,correctedProduct);
    assert.equal(receiver.catalog.supplier.review(customerReview.id).sha256,customerReview.sha256);
    const response=await fetch(running.url+'/api/catalog/supplier/export?'+new URLSearchParams({
      reviewId:customerReview.id,expectedReviewSha256:customerReview.sha256,format:'xchange.json'}));
    assert.equal(response.status,200);const httpBody=Buffer.from(await response.arrayBuffer());
    assert.equal(hash(httpBody),restored.native.sha256);
    const httpPath=join(directory,'exports','ETIM_XCHANGE_http_customer_FULL.json');
    await originalFile(httpPath,httpBody);
    const httpFile={name:basename(httpPath),...await hashCatalogFile(httpPath),type:'application/json'};exports.push(httpFile);
    const finalFiles=await exportReview(receiver,customerReview,'ETIM_XCHANGE_customer_FULL');
    const customerBundle=await emit('xchange-complete-customer-v2.jsonl',()=>receiver.catalog.export(catalogId,'catalog-bundle.jsonl'));
    record('http_customer_correction_and_older_replay',{requestId:request.requestId,replayedSameOperation:true,
      planId:restored.plan.id,correctionId:customerCorrection.id,correctionRevision:customerCorrection.revision,
      correctionSha256:customerCorrection.sha256,reviewId:customerReview.id,reviewSha256:customerReview.sha256,
      olderProducerBundleSha256:bundle.sha256,counts:customerReview.recipient.counts,native:httpFile,
      customerBundle,exports:finalFiles.map(file=>file.name)});
    await running.close();running=null;receiver=null;
    receiver=await openWorkspace('receiver');
    assert.equal(receiver.catalog.supplier.currentProduct({planId:restored.plan.id,materialKey}).correction.sha256,customerCorrection.sha256);
    assert.deepEqual(receiver.catalog.supplier.reviewRow({reviewId:customerReview.id,materialKey}).product.xChange.product,correctedProduct);
    assert.deepEqual(allRecipientRows(receiver.catalog.supplier,customerReview.id),customerRows);
    assert.deepEqual(temporaryIntakeTables(receiver),[]);
    const retainedSource=await receiver.catalog.retainedSource(uploaded.source.id);
    assert.ok((await readFile(retainedSource.path)).equals(originalSample));
    await receiver.close();receiver=null;
    producer=await openWorkspace('producer');
    assert.equal(producer.catalog.supplier.plan(restored.plan.id).sha256,restored.plan.sha256);
    assert.equal(producer.catalog.supplier.review(restored.review.id).sha256,restored.review.sha256);
    assert.equal(producer.catalog.supplier.currentProduct({planId:restored.plan.id,materialKey}).correction.sha256,restored.correction.sha256);
    await producer.close();producer=null;
    for(const artifact of exports){const actual=await hashCatalogFile(join(directory,'exports',artifact.name));
      assert.equal(actual.bytes,artifact.bytes);assert.equal(actual.sha256,artifact.sha256);}
    record('final_original_source_and_lifetime_close',{sourceSha256:SAMPLE_SHA,schemaSha256:SCHEMA_SHA,
      sourceBytes:27705,exportFiles:exports.length,recipientRecords:customerRows.length,
      customerCorrectionRevision:customerCorrection.revision,producerCorrectionRevision:restored.correction.revision,
      workspacesClosed:true,httpClosed:true});
    const report={schema:'stellar-forge.xchange-delivery-native.v1',operationId,state:'CLOSED',
      startedAt,completedAt:new Date().toISOString(),runtime:{node:process.version},
      directory,sourceFile,implementation,sourceEndpointEnv:'XCHANGE_JOURNEY_ENDPOINT',workspace:workspacePaths,
      catalog:{id:catalogId,revision:selected.catalog.revision,editionId:preview.edition.id},
      supplier:{planId:restored.plan.id,reviewId:restored.review.id,reviewSha256:restored.review.sha256,
        previousReviewId:removed.review.id},
      materialKeys:[materialKey],inputs,officialSource,exports,bundle,phases,
      sourceCorrection:{path:URI_PATH,original:originalUri,corrected:correctedUri},
      customer:{planId:restored.plan.id,reviewId:customerReview.id,reviewSha256:customerReview.sha256,
        correctionId:customerCorrection.id,correctionRevision:customerCorrection.revision,
        correctionSha256:customerCorrection.sha256,bundle:customerBundle}};
    await originalFile(reportPath,JSON.stringify(report,null,2)+'\n');return report;
  }finally{
    if(running)await running.close().catch(()=>{});
    if(producer)await producer.close().catch(()=>{});
    if(receiver)await receiver.close().catch(()=>{});
  }
}
export async function main(args=process.argv.slice(2)){
  const values={};
  for(let i=0;i<args.length;i+=2){
    const name={'--directory':'directory','--inputs':'inputsDirectory','--operation':'operationId'}[args[i]];
    if(!name||values[name]!==undefined||!args[i+1])throw new TypeError('Use --directory PRIVATE_DIRECTORY [--inputs DIRECTORY] [--operation STABLE_ID].');
    values[name]=args[i+1];
  }
  const report=await runXChangeDeliveryJourney(values);process.stdout.write(JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??error.name,message:error.message,operation:error.operation})+'\n');process.exitCode=1;});
