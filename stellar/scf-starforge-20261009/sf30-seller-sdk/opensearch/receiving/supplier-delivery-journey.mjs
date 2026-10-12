// MIT. Published ETIM product through supplier correction, XML delivery and portable receiving.
import assert from 'node:assert/strict';
import { readFile, mkdir, open, link, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createOpenSearchWorkspace } from '../workspace/service.mjs';
import { startOpenSearchWorkspace } from '../workspace/server.mjs';
import { hashCatalogFile } from '../catalog/workspace.mjs';
import { main as catalogCli } from '../catalog/cli.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const exec=promisify(execFile), hash=value=>createHash('sha256').update(value).digest('hex');
const PUBLISHED='https://www.etim-international.com/wp-content/uploads/2021/09/ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip';
const INPUTS={
  'etim10-supplier-products.jsonl':'e8903a41da5ddbaef6bbaa9b6a585aef051488400c02ff5538d364bba0f72903',
  'etim10-supplier-profile.json':'87b91d494209ffeff782c473913679632e1c95c5516b57b4e3411ec0e6596020',
  'SampleFile_bmecat_etim_V5_T_NEW_CATALOG_ETIM10.xml':'50568f0357c982a853eaf523475d18d6f2a594d0c8a392143a4df50007cddf8e',
  'bmecat_etim_501.xsd':'821e4dbcec9fa32b64df4298531adc5d3cdab68507686317dd08e8266378b005'
};
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
    {code:value.error?.code??'SUPPLIER_JOURNEY_OPERATION_INCOMPLETE',operation:value});
  return value.result;
}
async function output(path,descriptor,operationId) {
  const name=basename(path),receiptPath=path+'.receipt.json';
  const retained=async receipt=>{
    assert.equal(receipt.schema,'stellar-forge.supplier-export-receipt.v1');
    assert.equal(receipt.operationId,operationId);assert.equal(receipt.name,name);
    assert.match(receipt.temporary,/^supplier-export-[0-9a-f-]{36}\.part$/);
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
  const temporaryName='supplier-export-'+randomUUID()+'.part',temporary=join(dirname(path),temporaryName);
  const file=await open(temporary,'wx',0o600);let receiptAttempted=false;
  try{
    const values=typeof descriptor.body==='string'||Buffer.isBuffer(descriptor.body)?[descriptor.body]:descriptor.body;
    for await(const value of values)await file.writeFile(value);
    await file.sync();await file.close();
    const actual=await hashCatalogFile(temporary);
    // A filename left by an earlier version is adopted only after comparing a fresh complete export.
    try{
      const existing=await hashCatalogFile(path);
      assert.equal(existing.bytes,actual.bytes,'Unreceipted export differs from the current delivery: '+name);
      assert.equal(existing.sha256,actual.sha256,'Unreceipted export differs from the current delivery: '+name);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    receipt={schema:'stellar-forge.supplier-export-receipt.v1',operationId,name,
      bytes:actual.bytes,sha256:actual.sha256,type:descriptor.type,temporary:temporaryName};
    // Commit identity before installing the final name or advancing to another workspace phase.
    receiptAttempted=true;await originalFile(receiptPath,JSON.stringify(receipt)+'\n');
    const result=await retained(receipt);return{...result,retained:false};
  }finally{
    await file.close().catch(()=>{});
    if(!receiptAttempted)await unlink(temporary).catch(()=>{});
  }
}
const XML_CHECK=String.raw`
import json,sys
from lxml import etree
parser=etree.XMLParser(resolve_entities=False,no_network=True)
schema=etree.XMLSchema(etree.parse(sys.argv[1],parser))
results=[]
for name in sys.argv[2:]:
    doc=etree.parse(name,parser)
    schema.assertValid(doc)
    ns={'b':'https://www.etim-international.com/bmecat/50'}
    products=doc.findall('.//b:PRODUCT',ns)
    results.append({'file':name,'valid':True,'products':len(products),
      'identifiers':[p.findtext('b:SUPPLIER_PID',namespaces=ns) for p in products],
      'features':sum(len(p.findall('b:PRODUCT_FEATURES/b:FEATURE',ns)) for p in products)})
print(json.dumps({'schema':sys.argv[1],'validator':'lxml.etree.XMLSchema','files':results}))
`;
export async function runSupplierDeliveryJourney({directory,inputsDirectory=join(HERE,'../examples/supplier-etim'),
  operationId='supplier-etim-original',python=process.env.PYTHON??'python3'}={}) {
  if(!directory||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/.test(operationId))
    throw new TypeError('Supply a private directory and stable operation ID.');
  directory=resolve(directory);inputsDirectory=resolve(inputsDirectory);
  await mkdir(join(directory,'exports'),{recursive:true,mode:0o700});
  const sourceFile=join(directory,'source.json'),wrappedFile=join(directory,'etim-original-input.jsonl');
  const sourceConfig={schema:'stellar-forge.opensearch-source.v1',endpointEnv:'SUPPLIER_JOURNEY_ENDPOINT',
    auth:{type:'none'},allowLocal:true,maxInFlight:1,queries:{catalog_bootstrap:{
      indices:['supplier_catalog'],query:{match_all:{}},parameters:{},fields:['material_id'],sort:[],
      pageSize:100,maxHits:1000,maxBytes:917504,timeoutMs:15000,probe:{}}}};
  await originalFile(sourceFile,JSON.stringify(sourceConfig,null,2)+'\n');
  const inputs={},raw={};
  for(const [name,expected]of Object.entries(INPUTS)){
    raw[name]=await readFile(join(inputsDirectory,name));
    assert.equal(hash(raw[name]),expected,'Original publisher/conversion input '+name);
    inputs[name]={bytes:raw[name].length,sha256:expected};
  }
  try{
    const completed=JSON.parse(await readFile(join(directory,'supplier-delivery-native.json'),'utf8'));
    assert.equal(completed.operationId,operationId);assert.equal(completed.state,'CLOSED');
    for(const artifact of completed.exports){const actual=await hashCatalogFile(join(directory,'exports',artifact.name));
      assert.equal(actual.sha256,artifact.sha256);assert.equal(actual.bytes,artifact.bytes);}
    return completed;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const records=raw['etim10-supplier-products.jsonl'].toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
  assert.equal(records.length,1,'The complete published ETIM10 sample contains one product.');
  const original=records[0],product=original.supplier,profile=JSON.parse(raw['etim10-supplier-profile.json']);
  const xmlName='SampleFile_bmecat_etim_V5_T_NEW_CATALOG_ETIM10.xml';
  // Retain every original XML node, including fields outside the current supplier projection.
  const wrapped=records.map(record=>({...record,originalSource:{url:PUBLISHED+'#'+xmlName,
    filename:xmlName,...inputs[xmlName],contentXml:raw[xmlName].toString('utf8')}}));
  await originalFile(wrappedFile,wrapped.map(record=>JSON.stringify(record)+'\n').join(''));
  const sourceIdentity=await hashCatalogFile(wrappedFile);
  const config={sourceFile,env:{...process.env,SUPPLIER_JOURNEY_ENDPOINT:'http://127.0.0.1:9200'}};
  const openWorkspace=async name=>{
    const workspace=await createOpenSearchWorkspace({...config,directory:join(directory,name)});
    workspace.store.db.exec('PRAGMA wal_autocheckpoint=100;');return workspace;
  };
  const phases=[],exports=[],startedAt=new Date().toISOString();
  const record=(phase,value)=>phases.push({phase,...value});
  const emit=async(name,descriptor)=>{const value=await output(join(directory,'exports',name),descriptor,operationId);exports.push(value);return value;};
  let producer,receiver,running;
  try{
    producer=await openWorkspace('producer');
    const mapping={schema:'stellar-forge.material-catalog-mapping.v1',fields:{
      materialId:'/materialId',title:'/supplier/descriptions/eng/short',
      partNumber:'/supplier/manufacturerProductId',manufacturer:'/supplier/manufacturerName'},
      attributes:{supplier:'/supplier',originalSource:'/originalSource'},identifierPolicy:'exact'};
    const saved=await operation(producer,operationId+'-catalog',requestId=>producer.catalog.save({
      requestId,title:'Published ETIM supplier delivery',tenantId:'etim-published-sample',mapping}));
    const catalogId=saved.catalog.id;
    const uploaded=await operation(producer,operationId+'-source',requestId=>producer.catalog.upload({
      requestId,name:'etim-original-input.jsonl',...sourceIdentity,format:{kind:'jsonl'},
      provenance:{url:PUBLISHED,publisher:'ETIM International',revision:'2024-12-12 / ETIM 10 sample',
        kind:'published-standard-example',note:'The complete original XML and all converted product fields are retained in each source record.'}
    },createReadStream(wrappedFile)));
    const preview=await operation(producer,operationId+'-edition',requestId=>producer.catalog.preview({
      requestId,catalogId,expectedRevision:saved.catalog.revision,sourceId:uploaded.source.id,mode:'full',baseEditionId:null}));
    const selected=await operation(producer,operationId+'-select',requestId=>producer.catalog.select({
      requestId,catalogId,expectedRevision:saved.catalog.revision,editionId:preview.edition.id,reviewSha256:preview.edition.reviewSha256}));
    const material=producer.catalog.materials({editionId:preview.edition.id}).rows[0];
    assert.deepEqual(material.attributes.supplier,product);
    assert.equal(material.attributes.originalSource.contentXml,raw[xmlName].toString('utf8'));
    const originalBundle=await emit('catalog-before-supplier-v1.jsonl',await producer.catalog.export(catalogId,'catalog-bundle.jsonl'));
    record('original_source_and_catalog',{catalogId,editionId:preview.edition.id,materials:preview.edition.counts.total,
      source:sourceIdentity,originalXmlSha256:inputs[xmlName].sha256,bundle:originalBundle});

    const allBindings=Object.fromEntries(Object.keys(product).map(key=>['/'+key,'/attributes/supplier/'+key]));
    const initialBindings={...allBindings};delete initialBindings['/prices'];
    const initial=await operation(producer,operationId+'-submission',requestId=>producer.catalog.supplierSave({
      requestId,catalogId,editionId:preview.edition.id,title:'Published ETIM sample supplier submission',profile,bindings:initialBindings}));
    const planId=initial.supplierPlan.id;
    const first=await operation(producer,operationId+'-review-incomplete',requestId=>producer.catalog.supplierReview({
      requestId,planId,expectedRevision:initial.supplierPlan.revision}));
    assert.ok(first.supplierReview.counts.errors>0,'The unmapped published price must remain in the correction queue.');
    assert.throws(()=>producer.catalog.supplier.export({reviewId:first.supplierReview.id,format:'bmecat.xml',
      expectedReviewSha256:first.supplierReview.sha256}),{code:'SUPPLIER_CORRECTIONS_REQUIRED'});
    await emit('initial-correction-findings.csv',producer.catalog.supplier.export({
      reviewId:first.supplierReview.id,format:'issues.csv',expectedReviewSha256:first.supplierReview.sha256}));
    const current=producer.catalog.supplier.currentProduct({planId,materialKey:material.key});
    const corrected=await operation(producer,operationId+'-original-price',requestId=>producer.catalog.supplierCorrection({
      requestId,planId,expectedPlanRevision:initial.supplierPlan.revision,materialKey:material.key,
      expectedMaterialSha256:current.material.sha256,expectedBaseProductSha256:current.baseProductSha256,
      expectedRevision:0,patches:[{path:'/prices',value:product.prices,
        reason:'Copy the original PRODUCT_PRICE_DETAILS from '+PUBLISHED+'#'+xmlName+' into the unmapped price field.'}]}));
    const ready=await operation(producer,operationId+'-review-original',requestId=>producer.catalog.supplierReview({
      requestId,planId,expectedRevision:initial.supplierPlan.revision}));
    assert.equal(ready.supplierReview.counts.errors,0,JSON.stringify(ready.supplierReview.findings));
    assert.deepEqual(producer.catalog.supplier.reviewRow({reviewId:ready.supplierReview.id,materialKey:material.key}).product,product);
    const originalXml=await emit('etim-original-delivery.xml',producer.catalog.supplier.export({
      reviewId:ready.supplierReview.id,format:'bmecat.xml',expectedReviewSha256:ready.supplierReview.sha256}));
    const earlierBundle=await emit('supplier-earlier-v2.jsonl',await producer.catalog.export(catalogId,'catalog-bundle.jsonl'));
    record('price_correction_and_delivery',{planId,reviewId:ready.supplierReview.id,
      originalPrice:product.prices,correctionRevision:corrected.supplierCorrection.revision,
      counts:ready.supplierReview.counts,xml:originalXml,bundle:earlierBundle});
    await producer.close();producer=null;

    receiver=await openWorkspace('receiver');
    const receive=(bundle,suffix)=>operation(receiver,operationId+suffix,requestId=>receiver.catalog.importBundle({
      requestId,name:bundle.name,bytes:bundle.bytes,sha256:bundle.sha256},createReadStream(join(directory,'exports',bundle.name))));
    const receivedV1=await receive(originalBundle,'-receive-v1');
    assert.equal(receivedV1.handover.schema,'stellar-forge.material-catalog-bundle.v1');
    const receivedV2=await receive(earlierBundle,'-receive-v2');
    assert.equal(receivedV2.handover.schema,'stellar-forge.material-catalog-bundle.v2');
    assert.deepEqual(receiver.catalog.supplier.reviewRow({reviewId:ready.supplierReview.id,materialKey:material.key}).product,product);
    await receiver.close();receiver=await openWorkspace('receiver');
    assert.deepEqual(receiver.catalog.supplier.currentProduct({planId,materialKey:material.key}).product,product);

    const completeMapping=await operation(receiver,operationId+'-complete-mapping',requestId=>receiver.catalog.supplierSave({
      requestId,planId,expectedRevision:1,catalogId,editionId:preview.edition.id,
      title:initial.supplierPlan.title,previousReviewId:ready.supplierReview.id,profile,bindings:allBindings}));
    const stale=await operation(receiver,operationId+'-review-mapping-change',requestId=>receiver.catalog.supplierReview({
      requestId,planId,expectedRevision:completeMapping.supplierPlan.revision}));
    assert.ok(stale.supplierReview.findings.some(item=>item.code==='SUPPLIER_CORRECTION_STALE'));
    const fresh=receiver.catalog.supplier.currentProduct({planId,materialKey:material.key});
    await operation(receiver,operationId+'-clear-redundant-correction',requestId=>receiver.catalog.supplierCorrection({
      requestId,planId,expectedPlanRevision:2,materialKey:material.key,expectedRevision:1,
      expectedMaterialSha256:fresh.material.sha256,expectedBaseProductSha256:fresh.baseProductSha256,patches:[]}));
    const remapped=await operation(receiver,operationId+'-review-complete-mapping',requestId=>receiver.catalog.supplierReview({
      requestId,planId,expectedRevision:2}));
    assert.equal(remapped.supplierReview.counts.errors,0);
    await receive(earlierBundle,'-older-replay');
    assert.equal(receiver.catalog.supplier.plan(planId).revision,2);
    assert.ok(receiver.catalog.supplier.currentProduct({planId,materialKey:material.key}).correction.revision>=2);
    record('portable_receiving_and_older_replay',{v1:receivedV1.handover.schema,v2:receivedV2.handover.schema,
      planRevision:2,earlierCorrectionRevision:1,retainedCorrectionRevision:receiver.catalog.supplier.currentProduct({
        planId,materialKey:material.key}).correction.revision,sourceReopened:true});
    await receiver.close();receiver=null;

    const runCli=async(args)=>{
      const stdout=[],stderr=[],capture=chunks=>new Writable({write(chunk,encoding,next){chunks.push(Buffer.from(chunk));next();}});
      const result=await catalogCli([...args,'--source',sourceFile,'--workspace',join(directory,'receiver')],
        {env:config.env,stdout:capture(stdout),stderr:capture(stderr)});
      return{result,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')};
    };
    const cliRow=await runCli(['catalog-supplier-row','--review',remapped.supplierReview.id,'--material-key',material.key]);
    assert.deepEqual(JSON.parse(cliRow.stdout).product,product);
    const cliPath=join(directory,'exports','etim-cli-delivery.xml');
    const cliExport=await runCli(['catalog-supplier-export','--review',remapped.supplierReview.id,
      '--review-sha256',remapped.supplierReview.sha256,'--format','bmecat.xml','--output',cliPath]);
    const cliReceipt=JSON.parse(cliExport.stdout);assert.equal(cliReceipt.sha256,originalXml.sha256);exports.push({name:'etim-cli-delivery.xml',...await hashCatalogFile(cliPath)});
    record('cli_reopen_and_export',{entry:'catalog/cli.mjs',reviewId:remapped.supplierReview.id,export:cliReceipt});

    receiver=await openWorkspace('receiver');
    running=await startOpenSearchWorkspace({workspace:receiver,port:0});
    const session=await fetch(running.url+'/api/session').then(response=>response.json());
    const api=async(path,request)=>{
      const response=await fetch(running.url+path,request?{method:'POST',headers:{
        origin:running.url,'x-workspace-token':session.token,'content-type':'application/json'},body:JSON.stringify(request)}:undefined);
      const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
    };
    const state=await api('/api/catalog/supplier/state?'+new URLSearchParams({catalogId}));
    assert.equal(state.plans.find(item=>item.id===planId).revision,2);
    for(const path of ['/supplier.mjs','/catalog.mjs','/style.css']){
      const response=await fetch(running.url+path);assert.equal(response.status,200);assert.ok((await response.text()).length>0);
    }
    const live=await api('/api/catalog/supplier/product?'+new URLSearchParams({planId,materialKey:material.key}));
    const httpRequest={action:'supplier-correction',requestId:operationId+'-http-original-price',planId,
      expectedPlanRevision:2,materialKey:material.key,expectedRevision:2,
      expectedMaterialSha256:live.material.sha256,expectedBaseProductSha256:live.baseProductSha256,
      patches:[{path:'/prices',value:product.prices,
        reason:'Receiving operator confirmed original PRODUCT_PRICE_DETAILS against '+PUBLISHED+'#'+xmlName+'.'}]};
    const firstSend=await api('/api/catalog',httpRequest),replay=await api('/api/catalog',httpRequest);
    assert.equal(firstSend.result.supplierCorrection.revision,3);
    assert.deepEqual(firstSend,replay);
    const reviewed=await api('/api/catalog',{action:'supplier-review',requestId:operationId+'-http-review',planId,expectedRevision:2});
    const finalReview=reviewed.result.supplierReview;assert.equal(finalReview.counts.errors,0);
    const response=await fetch(running.url+'/api/catalog/supplier/export?'+new URLSearchParams({
      reviewId:finalReview.id,expectedReviewSha256:finalReview.sha256,format:'bmecat.xml'}));
    assert.equal(response.status,200);const body=Buffer.from(await response.arrayBuffer());
    assert.equal(hash(body),originalXml.sha256);
    await originalFile(join(directory,'exports','etim-http-delivery.xml'),body);
    exports.push({name:'etim-http-delivery.xml',...await hashCatalogFile(join(directory,'exports','etim-http-delivery.xml'))});
    record('http_correction_replay_and_download',{origin:running.url,requestId:httpRequest.requestId,
      correctionRevision:3,replayedSameOperation:true,reviewId:finalReview.id,counts:finalReview.counts,xmlSha256:hash(body)});
    for(const format of ['review.json','issues.csv','products.jsonl'])await emit('supplier-final-'+format,receiver.catalog.supplier.export({
      reviewId:finalReview.id,format,expectedReviewSha256:finalReview.sha256}));
    const finalBundle=await emit('supplier-customer-workspace-v2.jsonl',await receiver.catalog.export(catalogId,'catalog-bundle.jsonl'));
    await running.close();running=null;receiver=null;
    receiver=await openWorkspace('receiver');
    assert.equal(receiver.catalog.supplier.currentProduct({planId,materialKey:material.key}).correction.revision,3);
    assert.deepEqual(receiver.catalog.supplier.reviewRow({reviewId:finalReview.id,materialKey:material.key}).product,product);
    const retained=await receiver.catalog.retainedSource(uploaded.source.id);
    assert.equal(retained.sha256,sourceIdentity.sha256);
    const receivedSource=JSON.parse((await readFile(retained.path,'utf8')).trim());
    assert.equal(receivedSource.originalSource.contentXml,raw[xmlName].toString('utf8'));
    await receiver.close();receiver=null;
    const validation=await exec(python,['-c',XML_CHECK,join(inputsDirectory,'bmecat_etim_501.xsd'),
      join(inputsDirectory,xmlName),join(directory,'exports','etim-original-delivery.xml'),
      cliPath,join(directory,'exports','etim-http-delivery.xml')],{maxBuffer:1048576});
    const schemaValidation=JSON.parse(validation.stdout);
    for(const file of schemaValidation.files){assert.equal(file.products,1);assert.deepEqual(file.identifiers,['411061']);assert.equal(file.features,30);}
    record('official_schema_and_final_reopen',{schema:inputs['bmecat_etim_501.xsd'],
      validation:schemaValidation,retainedCorrectionRevision:3,completeOriginalXmlPreserved:true,customerBundle:finalBundle});
    const report={schema:'stellar-forge.supplier-delivery-native.v1',operationId,state:'CLOSED',
      startedAt,completedAt:new Date().toISOString(),runtime:{node:process.version,python},
      directory,inputs,productId:product.supplierProductId,products:records.length,phases,exports};
    await originalFile(join(directory,'supplier-delivery-native.json'),JSON.stringify(report,null,2)+'\n');
    return report;
  }finally{
    if(running)await running.close().catch(()=>{});
    if(producer)await producer.close().catch(()=>{});
    if(receiver)await receiver.close().catch(()=>{});
  }
}
export async function main(args=process.argv.slice(2)){
  const values={};
  for(let i=0;i<args.length;i+=2){
    const name={'--directory':'directory','--inputs':'inputsDirectory','--operation':'operationId','--python':'python'}[args[i]];
    if(!name||values[name]!==undefined||!args[i+1])throw new TypeError('Use --directory PRIVATE_DIRECTORY [--inputs DIRECTORY] [--operation STABLE_ID] [--python EXECUTABLE].');
    values[name]=args[i+1];
  }
  const report=await runSupplierDeliveryJourney(values);process.stdout.write(JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??error.name,message:error.message,operation:error.operation})+'\n');process.exitCode=1;});
