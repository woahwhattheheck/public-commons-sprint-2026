#!/usr/bin/env node
// MIT. Continue the published ETIM supplier delivery through the original material MCP.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { readFile, open, mkdir, lstat, realpath, readdir, link, unlink, rename } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runSupplierDeliveryJourney } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/supplier-delivery-journey.mjs';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { initializeOpenSearchWorkspaceMerchant, readMerchantConfig } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { openMerchantFileClient } from '../retained-download.mjs';
import { createOpenSearchMaterialClient } from '../opensearch-material-client.mjs';
import { runOpenSearchMaterialCLI } from '../opensearch-material-cli.mjs';
import { openSearchMaterialTools, MATERIAL_EXPORT_FORMATS, SUPPLIER_EXPORT_FORMATS } from '../catalog/opensearch-materials.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.opensearch-materials-native-receiving.v1';
const PRIMARY='etim-original',CUSTOMER='etim-received';
const SOURCE_INPUT='etim-original-source',OLDER_INPUT='etim-original-delivery',CURRENT_INPUT='etim-mcp-delivery';
const PUBLISHED='https://www.etim-international.com/wp-content/uploads/2021/09/ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip';
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):
  Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>hash(canonical(value));
const failure=(code,message)=>Object.assign(new Error(message),{code});
const inside=(parent,child)=>{const part=relative(parent,child);return !part||!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};

async function privateDirectory(path) {
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===resolve(path),
    'Use the canonical receiving directory.');
  if(process.platform!=='win32'){
    assert.equal(info.mode&0o077,0,'Keep the original receiving directory private.');
    if(process.getuid)assert.equal(info.uid,process.getuid(),'Use the receiving owner’s directory.');
  }
}
async function syncDirectory(path) {
  const file=await open(path,'r');try{await file.sync();}finally{await file.close();}
}
async function readBytes(path,maximum=4*1024*1024) {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await file.stat({bigint:true});
    assert.ok(before.isFile()&&before.size<=BigInt(maximum),'Read a bounded original regular file.');
    const bytes=await file.readFile(),after=await file.stat({bigint:true});
    assert.ok(bytes.length<=maximum&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,
      'The original control file changed while reading.');
    return bytes;
  }finally{await file.close();}
}
async function readJson(path,maximum){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(path,maximum)));}
async function maybeJson(path) {
  try{return await readJson(path);}catch(error){if(error.code!=='ENOENT')throw error;return null;}
}
async function atomicBytes(path,bytes) {
  const temporary=path+'.'+randomUUID()+'.next',file=await open(temporary,'wx',0o600);
  try{
    await file.writeFile(bytes);await file.sync();await file.close();
    await rename(temporary,path);await syncDirectory(dirname(path));
  }finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function retainedBytes(path,bytes) {
  const expected=Buffer.from(bytes);
  try{assert.deepEqual(await readBytes(path,Math.max(expected.length,1)),expected,'The retained receiving input changed.');return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path+'.'+randomUUID()+'.part',file=await open(temporary,'wx',0o600);
  try{
    await file.writeFile(expected);await file.sync();await file.close();
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    assert.deepEqual(await readBytes(path,Math.max(expected.length,1)),expected);
    await syncDirectory(dirname(path));
  }finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function fileIdentity(path,expected) {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await file.stat({bigint:true});
    assert.ok(before.isFile()&&before.size<=8n*1024n*1024n*1024n,'Use the original regular source or delivery file.');
    if(expected)assert.equal(before.size,BigInt(expected.bytes),'The retained delivery byte count changed.');
    const accumulator=createHash('sha256'),buffer=Buffer.allocUnsafe(128*1024);let bytes=0;
    while(BigInt(bytes)<before.size){
      const read=await file.read(buffer,0,Math.min(buffer.length,Number(before.size)-bytes),bytes);
      assert.ok(read.bytesRead>0,'The retained file ended before its original length.');
      accumulator.update(buffer.subarray(0,read.bytesRead));bytes+=read.bytesRead;
    }
    const after=await file.stat({bigint:true}),named=await lstat(path,{bigint:true});
    const identity=info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
    assert.ok(named.isFile()&&!named.isSymbolicLink()&&identity(before)===identity(after)&&identity(after)===identity(named),
      'The original file changed identity during its complete read.');
    const result={path,bytes,sha256:accumulator.digest('hex')};
    if(expected)assert.equal(result.sha256,expected.sha256,'The retained delivery digest changed.');
    return result;
  }finally{await file.close();}
}
function phaseOf(report,name) {
  const item=report.phases.find(value=>value.phase===name);
  assert.ok(item,'The original supplier report omitted '+name+'.');return item;
}
function firstRow(pages,label) {
  const rows=pages.flatMap(page=>page.rows??page.items??page.candidates??[]);
  assert.ok(rows.length,label+' returned no original records.');return rows[0];
}
async function allPages(client,method,args) {
  const pages=[];for await(const page of client.pages(method,args))pages.push(page);return pages;
}
function operationResult(value,key) {
  assert.equal(value.state,'COMPLETE',value.error?.message??'The retained operation is incomplete.');
  assert.ok(value.result&&!value.result.fullResultRetained,
    'The receiving product needs its complete original result; inspect the retained operation/export when the result is oversized.');
  return key===undefined?value.result:value.result[key];
}
function assertOriginalProduct(value,expected) {
  assert.deepEqual(value,expected,'The published ETIM product changed.');
  assert.equal(value.supplierProductId,'411061');
  assert.equal(value.classification.etim.features.length,30);
  assert.equal(value.order.unit,'C62');assert.equal(value.productGtin,'03414970351821');
}
async function sourceReport() {
  const paths=['opensearch-material-client.mjs','opensearch-material-client.d.mts','opensearch-material-cli.mjs',
    'opensearch-material-contracts.mjs','opensearch-materials.mjs','opensearch-workspace.mjs','catalog/opensearch-materials.mjs'];
  const values={};
  for(const path of paths){
    const bytes=await readBytes(join(HERE,'..',path),4*1024*1024);
    values[path]={bytes:bytes.length,sha256:hash(bytes),
      gitBlob:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};
  }
  return values;
}

/**
 * One original supplier producer followed by one MCP receiving operation.
 * Reuse both directories and operation IDs after interruption. The original
 * supplier function verifies and returns its retained CLOSED report on a repeat.
 */
export async function runOpenSearchMaterialsReceiving({
  supplierDirectory,directory,supplierOperationId='supplier-etim-2769',
  operationId='opensearch-materials-2769',inputsDirectory,python
}={}) {
  if(typeof supplierDirectory!=='string'||typeof directory!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/.test(operationId)||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/.test(supplierOperationId))
    throw failure('MATERIAL_RECEIVING_INPUT','Supply the original supplier directory, private receiving directory and stable operation IDs.');
  supplierDirectory=resolve(supplierDirectory);directory=resolve(directory);
  if(inside(supplierDirectory,directory)||inside(directory,supplierDirectory))
    throw failure('MATERIAL_RECEIVING_INPUT','Keep the two complete operation directories distinct and nonoverlapping.');
  await privateDirectory(directory);const control=join(directory,'control');
  await privateDirectory(control);
  const lease=await acquireStateLease(control),stateFile=join(control,'receiving-state.json');
  const reportFile=join(directory,'materials-receiving-native.json');
  const selected={schema:SCHEMA,operationId,supplierOperationId,supplierDirectory,directory};
  let state,server,primary,customer,storageFault=null;
  const callCounts={};
  const save=async()=>{
    if(storageFault)throw storageFault;
    lease.assertHeld();state.updatedAt=new Date().toISOString();
    for(const [name,count]of Object.entries(callCounts)){
      state.observedTools[name]=(state.observedTools[name]??0)+count;delete callCounts[name];
    }
    try{await atomicBytes(stateFile,Buffer.from(json(state)));lease.assertHeld();}
    catch(error){storageFault=error;throw error;}
  };
  const step=async(name,action)=>{
    if(state.phases[name])return state.phases[name];
    const value=await action();state.phases[name]=value;await save();return value;
  };
  const mutate=async(client,key,method,prepare)=>{
    if(storageFault)throw storageFault;
    let request=state.requests[key];
    if(!request){
      const args=await prepare();request={method,args:{requestId:operationId+'-'+key,...args}};
      assert.equal(request.args.requestId,operationId+'-'+key);
      state.requests[key]=request;await save();
    }
    assert.equal(request.method,method);
    const result=await client[method](request.args);
    assert.equal(result.id,request.args.requestId);assert.equal(result.state,'COMPLETE',result.error?.message);
    const receipt={id:result.id,kind:result.kind,requestSha256:result.requestSha256,state:result.state};
    if(state.operations[key])assert.deepEqual(receipt,state.operations[key],'The original operation identity changed.');
    else{state.operations[key]=receipt;await save();}
    return result;
  };
  const connect=async alias=>{
    const transport=await openMerchantFileClient({url:server.url,environment});
    return createOpenSearchMaterialClient({workspace:alias,client:{endpoint:transport.endpoint,
      call:async(name,args,options)=>{
        const result=await transport.call(name,args,options);
        callCounts[name]=(callCounts[name]??0)+1;
        return result;
      }}});
  };
  let environment;
  const closeHost=async()=>{
    if(!server&&!primary&&!customer)return;
    const errors=[];
    if(customer){try{await customer.close();}catch(error){errors.push(error);}customer=null;}
    if(primary){try{await primary.close();}catch(error){errors.push(error);}primary=null;}
    if(server){try{await server.close();server=null;}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'The original MCP receiving owner is still closing.');
    state.lifetimes={merchant:'CLOSED',originalWorkspace:'CLOSED',receivingWorkspace:'CLOSED'};
    if(!storageFault)await save();
  };
  try{
    state=await maybeJson(stateFile)??{...selected,startedAt:new Date().toISOString(),requests:{},operations:{},phases:{},
      observedTools:{},connection:null,host:null,lifetimes:{merchant:'CLOSED',originalWorkspace:'CLOSED',receivingWorkspace:'CLOSED'}};
    for(const [key,value]of Object.entries(selected))assert.deepEqual(state[key],value,'Keep the original receiving operation selection.');
    state.state='RUNNING';state.error=null;await save();
    const supplier=await runSupplierDeliveryJourney({directory:supplierDirectory,operationId:supplierOperationId,
      ...(inputsDirectory===undefined?{}:{inputsDirectory}),...(python===undefined?{}:{python})});
    assert.equal(supplier.state,'CLOSED');assert.equal(supplier.operationId,supplierOperationId);
    const originalPhase=phaseOf(supplier,'original_source_and_catalog');
    const correctionPhase=phaseOf(supplier,'price_correction_and_delivery');
    const httpPhase=phaseOf(supplier,'http_correction_replay_and_download');
    const originalReport=await fileIdentity(join(supplierDirectory,'supplier-delivery-native.json'));
    const sourceFile=join(supplierDirectory,'source.json');
    const wrappedFile=join(supplierDirectory,'etim-original-input.jsonl');
    const originalBundlePath=join(supplierDirectory,'exports','supplier-customer-workspace-v2.jsonl');
    const originalSource=await fileIdentity(wrappedFile,originalPhase.source);
    const originalBundle=await fileIdentity(originalBundlePath,
      supplier.exports.find(item=>item.name==='supplier-customer-workspace-v2.jsonl'));
    const wrapped=JSON.parse((await readBytes(wrappedFile)).toString('utf8').trim());
    const product=wrapped.supplier;assertOriginalProduct(product,product);
    assert.equal(hash(wrapped.originalSource.contentXml),originalPhase.originalXmlSha256);
    const original={report:originalReport,catalogId:originalPhase.catalogId,editionId:originalPhase.editionId,
      planId:correctionPhase.planId,reviewId:httpPhase.reviewId,source:originalSource,bundle:originalBundle,
      productSha256:digest(product),originalXmlSha256:originalPhase.originalXmlSha256};
    if(state.original)assert.deepEqual(state.original,original,'Use the complete same original supplier delivery.');
    else{state.original=original;await save();}
    const customerDirectory=join(directory,'customer-workspace');await privateDirectory(customerDirectory);
    const downloadsRoot=join(directory,'downloads');await privateDirectory(downloadsRoot);
    environment={...process.env,SUPPLIER_JOURNEY_ENDPOINT:'http://127.0.0.1:9200',
      MCP_ACCESS_TOKEN:randomBytes(32).toString('hex'),MCP_CLIENT_ORIGINS:''};
    delete environment.MCP_OAUTH_CONFIG;
    const connectionPath=join(control,'opensearch-connection.json');
    const connectionFor=additional=>{
      const inputs={
        [SOURCE_INPUT]:{path:wrappedFile,name:'etim-original-input.jsonl',bytes:originalSource.bytes,sha256:originalSource.sha256},
        [OLDER_INPUT]:{path:originalBundlePath,name:'supplier-customer-workspace-v2.jsonl',
          bytes:originalBundle.bytes,sha256:originalBundle.sha256}
      };
      const customerInputs={...inputs,...(additional?{[CURRENT_INPUT]:additional}:{})};
      return {schema:'stellar-forge.opensearch-workspace-connection.v1',workspaces:{
        [PRIMARY]:{label:'Published ETIM supplier receiver',directory:join(supplierDirectory,'receiver'),sourceFile,materialInputs:inputs},
        [CUSTOMER]:{label:'Received original ETIM customer workspace',directory:customerDirectory,sourceFile,materialInputs:customerInputs}
      }};
    };
    const installConnection=async value=>{
      const bytes=Buffer.from(json(value)),sha256=hash(bytes);
      if(!state.connection||state.connection.sha256!==sha256){
        assert.ok(!server,'Close the original host before changing its declared input aliases.');
        state.connectionIntent={sha256,previousSha256:state.connection?.sha256??null,value};await save();
      }
      const intent=state.connectionIntent??{sha256,previousSha256:sha256,value};
      assert.equal(intent.sha256,sha256,'Finish the same host connection update.');
      let existing=null;try{existing=await readBytes(connectionPath);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(existing){
        assert.ok(hash(existing)===intent.sha256||hash(existing)===intent.previousSha256,
          'The host connection changed outside its saved receiving operation.');
      }else assert.equal(intent.previousSha256,null,'The retained host connection disappeared.');
      if(!existing||hash(existing)!==sha256)await atomicBytes(connectionPath,bytes);
      state.connection={path:connectionPath,sha256};delete state.connectionIntent;await save();
    };
    // An interrupted configuration publication resumes the same saved postimage.
    await installConnection(state.connectionIntent?.value??connectionFor(state.bundleInput));
    if(!state.host){
      let selection=state.hostInitialization;
      let usable=false;
      if(selection){
        try{
          const raw=await readJson(selection.configuration);
          assert.equal(raw.opensearchWorkspaceConnection,connectionPath);
          await readMerchantConfig(selection.configuration);usable=true;
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(!usable){
        const hostDirectory=join(directory,'merchant-'+randomUUID());
        selection={directory:hostDirectory,configuration:join(hostDirectory,'merchant-mcp.json')};
        state.hostInitialization=selection;await save();
        await initializeOpenSearchWorkspaceMerchant({directory:hostDirectory,connection:connectionPath,
          name:'Published ETIM material and supplier receiving'});
      }
      const configuration=await readBytes(selection.configuration);
      state.host={...selection,configurationSha256:hash(configuration)};await save();
    }
    assert.equal(hash(await readBytes(state.host.configuration)),state.host.configurationSha256,
      'The original merchant configuration changed.');
    const startHost=async()=>{
      assert.ok(!server);server=await startMerchantMcp({configPath:state.host.configuration,
        port:state.port??0,environment});
      const port=Number(new URL(server.url).port);
      if(state.port!==undefined)assert.equal(port,state.port,'The retained download endpoint changed.');
      else{state.port=port;await save();}
      const advertised=new Set(server.operator.tools.map(tool=>tool.name));
      for(const tool of openSearchMaterialTools((name)=>({name})))assert.ok(advertised.has(tool.name),'The original host omitted '+tool.name+'.');
      primary=await connect(PRIMARY);await primary.open();
      state.lifetimes={merchant:'OPEN',originalWorkspace:'OPEN',receivingWorkspace:'CLOSED'};await save();
    };
    await startHost();

    const baseline=await step('original_receiver',async()=>{
      const status=await primary.status();assert.equal(status.state,'OPEN');
      const inputs=await primary.materialInputs();
      const declared=inputs.inputs.find(item=>item.inputId===SOURCE_INPUT);
      assert.ok(declared);assert.equal(declared.sha256,originalSource.sha256);assert.equal(declared.bytes,originalSource.bytes);
      const catalogs=await allPages(primary,'materialList',{collection:'catalogs',limit:1});
      assert.ok(catalogs.flatMap(page=>page.items).some(item=>item.id===original.catalogId));
      const catalog=await primary.materialCatalog({catalogId:original.catalogId});
      assert.equal(catalog.activeEditionId,original.editionId);
      const edition=await primary.materialEdition({editionId:original.editionId});
      assert.equal(edition.catalogId,catalog.id);assert.equal(edition.counts.total,1);
      const material=firstRow(await allPages(primary,'materialRows',{editionId:edition.id,limit:1}),'Original edition');
      assert.equal(material.materialId,'411061');
      const complete=await primary.materialGet({editionId:edition.id,materialKey:material.key});assert.deepEqual(complete,material);
      assertOriginalProduct(material.attributes.supplier,product);
      assert.equal(hash(material.attributes.originalSource.contentXml),original.originalXmlSha256);
      const source=await primary.materialSource({sourceId:edition.source.id});
      assert.equal(source.sha256,originalSource.sha256);
      const plan=await primary.supplierPlan({planId:original.planId});
      assert.equal(plan.revision,2);assert.equal(plan.editionId,original.editionId);
      const current=await primary.supplierProduct({planId:plan.id,materialKey:material.key});
      assertOriginalProduct(current.product,product);assert.equal(current.correction.revision,3);
      const correction=await primary.supplierCorrectionGet({correctionId:current.correction.id});
      assert.deepEqual(correction,current.correction);
      const review=await primary.supplierReviewGet({reviewId:original.reviewId});
      assert.equal(review.counts.errors,0);
      const row=await primary.supplierRow({reviewId:review.id,materialKey:material.key});
      assertOriginalProduct(row.product,product);
      const reviewPages=await allPages(primary,'supplierRows',{reviewId:review.id,limit:1,status:'all'});
      assert.equal(reviewPages.flatMap(page=>page.rows).length,1);
      const templates=await primary.supplierTemplates();assert.ok(templates&&typeof templates==='object');
      return {workspaceId:status.workspaceId,catalog,edition,material,source,plan,correction,review,
        productSha256:digest(row.product),inputCount:inputs.inputs.length};
    });
    const customerId='etim-published-example',description=product.descriptions.eng.short;
    const firstCommercialSelection=await step('original_match_and_query',async()=>{
      const match=await mutate(primary,'original-match','materialDecision',()=>({
        catalogId:baseline.catalog.id,expectedCatalogRevision:baseline.catalog.revision,customerId,description,
        materialKey:baseline.material.key,expectedMaterialSha256:baseline.material.sha256,status:'APPROVED',
        note:'Published ETIM receiving example: retain the original description and product identifier for customer handover.'
      }));
      const decision=operationResult(match,'decision');
      const selected=await primary.materialDecisionGet({decisionId:decision.id});
      assert.equal(selected.status,'APPROVED');
      const suggestions=await allPages(primary,'materialSuggest',{catalogId:baseline.catalog.id,text:description,customerId,limit:1});
      assert.equal(suggestions[0].approved.id,decision.id);assert.equal(suggestions[0].approved.currentStatus,'APPROVED');
      assert.ok(suggestions.flatMap(page=>page.candidates).some(item=>item.material.key===baseline.material.key));
      const draft=await mutate(primary,'original-query','materialDraft',()=>({
        catalogId:baseline.catalog.id,expectedRevision:baseline.catalog.revision,
        index:'etim-published-materials',variant:'identifiers',title:'Published ETIM material identifiers'
      }));
      const savedDraft=operationResult(draft,'draft');
      const retainedOperation=await primary.operation({requestId:draft.id,includeRequest:true});
      assert.equal(retainedOperation.requestSha256,draft.requestSha256);
      return {decision,savedDraft,queryOperation:{id:draft.id,requestSha256:draft.requestSha256},
        queryResultSha256:digest(draft.result)};
    });
    const mapped=await step('original_unit_and_classification',async()=>{
      const uploaded=await mutate(primary,'source-intake','materialUpload',()=>({
        inputId:SOURCE_INPUT,format:{kind:'jsonl'},
        provenance:{url:PUBLISHED,publisher:'ETIM International',revision:'2024-12-12 / ETIM 10 sample',
          kind:'published-standard-example',
          note:'The complete original XML and converted product fields are received through the configured source alias.'}
      }));
      const source=operationResult(uploaded,'source');
      assert.equal(source.bytes,originalSource.bytes);assert.equal(source.sha256,originalSource.sha256);
      const mapping=structuredClone(baseline.catalog.mapping);
      Object.assign(mapping.fields,{
        description:'/supplier/descriptions/eng/long',category:'/supplier/classification/etim/classId',
        unit:'/supplier/order/contentUnit',salesUnit:'/supplier/order/unit',
        numerator:'/supplier/order/contentUnitsPerOrderUnit',
        denominator:{constant:'1',reason:'The published contentUnitsPerOrderUnit field is the number of base units per one order unit.'}
      });
      mapping.references=[...(mapping.references??[]),{kind:'GTIN',value:'/supplier/productGtin'}];
      const saved=await mutate(primary,'source-mapping','materialSave',()=>({
        catalogId:baseline.catalog.id,expectedRevision:baseline.catalog.revision,title:baseline.catalog.title,
        tenantId:baseline.catalog.tenantId,mapping
      }));
      const catalog=operationResult(saved,'catalog');
      const built=await mutate(primary,'source-edition','materialPreview',()=>({
        catalogId:catalog.id,expectedRevision:catalog.revision,sourceId:source.id,
        mode:'full',baseEditionId:baseline.edition.id
      }));
      const edition=operationResult(built,'edition');
      assert.equal(edition.counts.total,1);assert.equal(edition.counts.changed,1);assert.equal(edition.counts.added,0);
      const changes=await allPages(primary,'materialChanges',{editionId:edition.id,limit:1});
      const changed=firstRow(changes,'Saved change review');assert.equal(changed.materialId,'411061');
      assert.equal(changed.kind,'changed');assert.equal(changed.before.sha256,baseline.material.sha256);
      const selection=await mutate(primary,'select-edition','materialSelect',()=>({
        catalogId:catalog.id,expectedRevision:catalog.revision,editionId:edition.id,reviewSha256:edition.reviewSha256
      }));
      const selected=operationResult(selection,'catalog');
      const material=await primary.materialGet({editionId:edition.id,materialKey:baseline.material.key});
      assert.equal(material.unit,product.order.contentUnit);assert.equal(material.salesUnit,product.order.unit);
      assert.equal(material.category,product.classification.etim.classId);
      assert.ok(material.references.some(item=>item.kind==='GTIN'&&item.value==='03414970351821'));
      assertOriginalProduct(material.attributes.supplier,product);
      const priorDecision=await primary.materialDecisionGet({decisionId:firstCommercialSelection.decision.id});
      assert.equal(priorDecision.revision,firstCommercialSelection.decision.revision);
      const stale=(await primary.materialSuggest({catalogId:catalog.id,text:description,customerId,limit:1})).approved;
      assert.equal(stale.id,priorDecision.id);assert.equal(stale.currentStatus,'NEEDS_REVIEW');
      const facets={};
      for(const facet of ['category','manufacturer','unit']){
        facets[facet]=await allPages(primary,'materialFacets',{catalogId:catalog.id,facet,limit:1});
        assert.ok(facets[facet].flatMap(page=>page.items).length>0);
      }
      const exact=await primary.materialQuantity({catalogId:catalog.id,materialKey:material.key,
        expectedMaterialSha256:material.sha256,quantity:'5.25',unit:product.order.unit});
      assert.equal(exact.quantity.baseQuantity.numerator,'21');assert.equal(exact.quantity.baseQuantity.denominator,'4');
      assert.equal(exact.quantity.baseQuantity.decimal,'5.25');
      const reference=await allPages(primary,'materialSuggest',{catalogId:catalog.id,text:product.productGtin,
        customerId,category:material.category,manufacturer:material.manufacturer,unit:material.unit,limit:1});
      assert.ok(reference.flatMap(page=>page.candidates).some(item=>item.material.key===material.key));
      return {catalog:selected,edition,source,material,changeFields:changed.fields,quantity:exact,facets,
        priorDecisionStatus:stale.currentStatus};
    });
    const delivery=await step('reviewed_supplier_and_customer_selection',async()=>{
      const saved=await mutate(primary,'supplier-edition','supplierSave',()=>({
        planId:baseline.plan.id,expectedRevision:baseline.plan.revision,catalogId:mapped.catalog.id,
        editionId:mapped.edition.id,title:baseline.plan.title,profile:baseline.plan.profile,
        bindings:baseline.plan.bindings,previousReviewId:baseline.plan.previousReviewId
      }));
      const plan=operationResult(saved,'supplierPlan');
      const current=await primary.supplierProduct({planId:plan.id,materialKey:mapped.material.key});
      assertOriginalProduct(current.base,product);
      // The published price is now in the original mapping. Clear the redundant
      // old correction against its exact original material/base/revision pins.
      const cleared=await mutate(primary,'supplier-correction','supplierCorrection',()=>({
        planId:plan.id,expectedPlanRevision:plan.revision,materialKey:mapped.material.key,
        expectedMaterialSha256:mapped.material.sha256,expectedBaseProductSha256:current.baseProductSha256,
        expectedRevision:baseline.correction.revision,patches:[]
      }));
      const correction=operationResult(cleared,'supplierCorrection');
      assert.equal(correction.id,baseline.correction.id);assert.equal(correction.revision,baseline.correction.revision+1);
      const checked=await mutate(primary,'supplier-review','supplierReview',()=>({planId:plan.id,expectedRevision:plan.revision}));
      const review=operationResult(checked,'supplierReview');assert.equal(review.counts.errors,0);
      const row=await primary.supplierRow({reviewId:review.id,materialKey:mapped.material.key});
      assertOriginalProduct(row.product,product);
      const selected=await mutate(primary,'current-match','materialDecision',()=>({
        catalogId:mapped.catalog.id,expectedCatalogRevision:mapped.catalog.revision,customerId,description,
        materialKey:mapped.material.key,expectedMaterialSha256:mapped.material.sha256,status:'APPROVED',
        decisionId:firstCommercialSelection.decision.id,expectedRevision:firstCommercialSelection.decision.revision,
        note:'Re-reviewed the same published ETIM product after adding its original units, classification and GTIN.'
      }));
      const decision=operationResult(selected,'decision');
      const draft=await primary.materialDraft(state.requests['original-query'].args);
      assert.equal(draft.id,firstCommercialSelection.queryOperation.id);
      assert.equal(draft.requestSha256,firstCommercialSelection.queryOperation.requestSha256);
      assert.equal(digest(draft.result),firstCommercialSelection.queryResultSha256,
        'The original merchant query request was rebuilt from the newer catalog.');
      const newDraft=await mutate(primary,'current-query','materialDraft',()=>({
        catalogId:mapped.catalog.id,expectedRevision:mapped.catalog.revision,index:'etim-published-materials',
        variant:'identifiers',title:'Published ETIM material search with original units and classification'
      }));
      const histories={
        catalog:await allPages(primary,'materialHistory',{kind:'catalog',id:mapped.catalog.id,limit:1}),
        decision:await allPages(primary,'materialHistory',{kind:'decision',id:decision.id,limit:1}),
        plan:await allPages(primary,'supplierHistory',{kind:'plan',id:plan.id,limit:1}),
        correction:await allPages(primary,'supplierHistory',{kind:'correction',id:correction.id,limit:1})
      };
      for(const [kind,pages]of Object.entries(histories))assert.ok(pages.length>=2,'The complete '+kind+' history was not paged.');
      assert.deepEqual(await primary.materialCatalog({catalogId:baseline.catalog.id,revision:baseline.catalog.revision}),baseline.catalog);
      assert.deepEqual(await primary.supplierPlan({planId:baseline.plan.id,revision:baseline.plan.revision}),baseline.plan);
      assert.deepEqual(await primary.supplierCorrectionGet({correctionId:baseline.correction.id,revision:baseline.correction.revision}),baseline.correction);
      const oldRow=await primary.supplierRow({reviewId:baseline.review.id,materialKey:baseline.material.key});
      assertOriginalProduct(oldRow.product,product);
      const collections={};
      for(const collection of ['catalogs','sources','editions','decisions'])
        collections['material:'+collection]=await allPages(primary,'materialList',{collection,
          ...(collection==='editions'||collection==='decisions'?{catalogId:mapped.catalog.id}:{}),limit:1});
      for(const collection of ['plans','reviews','corrections'])
        collections['supplier:'+collection]=await allPages(primary,'supplierList',{collection,
          ...(collection==='plans'?{catalogId:mapped.catalog.id}:{planId:plan.id}),limit:1});
      return {plan,correction,review,decision,draft:operationResult(newDraft,'draft'),
        histories:Object.fromEntries(Object.entries(histories).map(([key,pages])=>[key,{pages:pages.length,
          revisions:pages.flatMap(page=>page.items).map(item=>item.revision)}])),
        collections:Object.fromEntries(Object.entries(collections).map(([key,pages])=>[key,{
          pages:pages.length,items:pages.reduce((sum,page)=>sum+page.items.length,0)}])),
        originalDraftReused:true,productSha256:digest(row.product)};
    });
    const retained=await step('complete_original_exports',async()=>{
      const material=await mutate(primary,'material-export','materialExport',()=>({
        catalogId:mapped.catalog.id,expectedCatalogRevision:mapped.catalog.revision,editionId:mapped.edition.id,
        index:'etim-published-materials',formats:[...MATERIAL_EXPORT_FORMATS]
      }));
      const supplierExport=await mutate(primary,'supplier-export','supplierExport',()=>({
        reviewId:delivery.review.id,expectedReviewSha256:delivery.review.sha256,formats:[...SUPPLIER_EXPORT_FORMATS]
      }));
      const selected={material:operationResult(material),supplier:operationResult(supplierExport)};
      for(const [kind,item]of Object.entries(selected)){
        const inspected=await primary.inspectExport(item.exportId);
        assert.equal(inspected.manifestSha256,item.manifestSha256);assert.deepEqual(inspected.manifest,item.manifest);
        assert.equal(item.manifest.workspaceId,baseline.workspaceId);assert.equal(item.manifest.kind,kind);
        assert.equal(item.manifest.files.length,kind==='material'?MATERIAL_EXPORT_FORMATS.length:SUPPLIER_EXPORT_FORMATS.length);
      }
      const info=await primary.exportManifest({exportId:selected.material.exportId});
      const chunk=await primary.exportFile({exportId:info.exportId,file:info.manifestFile.name,
        expectedManifestSha256:info.manifestFile.sha256,expectedSha256:info.manifestFile.sha256,offset:0,limit:1});
      assert.equal(chunk.bytesRead,1);assert.notEqual(chunk.nextOffset,null);
      const release=await primary.exportFileRelease({exportId:info.exportId,readId:chunk.readId});
      assert.ok(release.released);
      return selected;
    });
    const downloadDirectory=join(downloadsRoot,'original-materials');
    const supplierDownloadDirectory=join(downloadsRoot,'original-supplier');
    const download=async(client,selected,path,extra={})=>{
      const result=await client.downloadExport({exportId:selected.exportId,directory:path,
        expectedManifestSha256:selected.manifestSha256,chunkSize:16384,...extra});
      assert.equal(result.state,'COMPLETE');assert.equal(result.manifestSha256,selected.manifestSha256);
      assert.equal(result.files,selected.manifest.files.length);
      const files=[];
      files.push(await fileIdentity(join(path,'manifest.json'),selected.manifestFile));
      for(const file of selected.manifest.files)files.push({...file,...await fileIdentity(join(path,file.name),file)});
      return {...result,artifacts:files};
    };
    await step('interrupted_original_download',async()=>{
      if(state.downloadInterruption?.observed)return state.downloadInterruption;
      state.downloadInterruption={armed:true,observed:false};await save();
      let interrupted=false;
      try{
        await download(primary,retained.material,downloadDirectory,{onProgress:async progress=>{
          if(progress.file.endsWith('catalog-bundle.jsonl')&&progress.bytes>0&&progress.bytes<progress.total){
            state.downloadInterruption={armed:false,observed:true,exportId:progress.exportId,
              file:progress.file,bytes:progress.bytes,total:progress.total};
            await save();
            throw failure('MATERIAL_RECEIVING_DOWNLOAD_INTERRUPTED','Continue the original checkpoint after closing and reopening the merchant.');
          }
        }});
      }catch(error){
        if(error.code!=='MATERIAL_RECEIVING_DOWNLOAD_INTERRUPTED')throw error;
        interrupted=true;
      }
      assert.ok(interrupted,'The complete original bundle should span multiple retained chunks.');
      await closeHost();await startHost();
      return state.downloadInterruption;
    });
    const receivedFiles=await step('resumed_complete_original_files',async()=>{
      const material=await download(primary,retained.material,downloadDirectory);
      assert.ok(material.resumed&&material.resumedBytes>0,'The original verified download prefix was not resumed.');
      const supplierExport=await download(primary,retained.supplier,supplierDownloadDirectory);
      const again=await download(primary,retained.material,downloadDirectory);
      assert.equal(again.bytes,material.bytes);assert.ok(again.resumed);
      const xml=supplierExport.artifacts.find(file=>file.name?.endsWith('bmecat.xml'));
      const originalXml=supplier.exports.find(item=>item.name==='etim-original-delivery.xml');
      assert.ok(xml);assert.equal(xml.sha256,originalXml.sha256,'The full MCP XML changed the original published supplier product.');
      return {material,supplier:supplierExport,repeatedOriginalBytes:true};
    });
    // Reconcile these complete local originals on every resumed receiving path.
    for(const group of Object.values(receivedFiles))if(group?.artifacts)
      for(const artifact of group.artifacts)await fileIdentity(artifact.path,artifact);
    const portable=retained.material.manifest.files.find(file=>file.name.endsWith('catalog-bundle.jsonl'));
    assert.ok(portable);
    const bundleInput={path:join(downloadDirectory,portable.name),name:portable.name,bytes:portable.bytes,sha256:portable.sha256};
    if(!state.bundleInput){state.bundleInput=bundleInput;await save();}
    else assert.deepEqual(state.bundleInput,bundleInput);
    if(state.connection.sha256!==hash(Buffer.from(json(connectionFor(bundleInput))))){
      await closeHost();await installConnection(connectionFor(bundleInput));await startHost();
    }
    customer=await connect(CUSTOMER);await customer.open();
    state.lifetimes.receivingWorkspace='OPEN';await save();

    const customerReceived=await step('complete_customer_receiving',async()=>{
      const input=await customer.materialInputs();
      const chosen=input.inputs.find(item=>item.inputId===CURRENT_INPUT);
      assert.ok(chosen);assert.equal(chosen.sha256,portable.sha256);assert.equal(chosen.bytes,portable.bytes);
      const received=await mutate(customer,'customer-receive','materialReceive',()=>({inputId:CURRENT_INPUT}));
      operationResult(received);
      const status=await customer.status();
      assert.notEqual(status.workspaceId,baseline.workspaceId,'Receive into the selected customer workspace.');
      const catalog=await customer.materialCatalog({catalogId:mapped.catalog.id});
      assert.deepEqual(catalog,mapped.catalog,'The complete original catalog identity changed during receiving.');
      assert.deepEqual(await customer.materialEdition({editionId:mapped.edition.id}),mapped.edition);
      const plan=await customer.supplierPlan({planId:delivery.plan.id});assert.deepEqual(plan,delivery.plan);
      const correction=await customer.supplierCorrectionGet({correctionId:delivery.correction.id});
      assert.deepEqual(correction,delivery.correction);
      const decision=await customer.materialDecisionGet({decisionId:delivery.decision.id});
      assert.equal(decision.revision,delivery.decision.revision);assert.equal(decision.status,'APPROVED');
      const matching=await customer.materialSuggest({catalogId:mapped.catalog.id,text:description,customerId,limit:1});
      assert.equal(matching.approved.currentStatus,'APPROVED');
      const row=await customer.supplierRow({reviewId:delivery.review.id,materialKey:mapped.material.key});
      assertOriginalProduct(row.product,product);
      const originalRow=await customer.supplierRow({reviewId:baseline.review.id,materialKey:baseline.material.key});
      assertOriginalProduct(originalRow.product,product);
      const source=await customer.materialSource({sourceId:baseline.source.id});
      assert.equal(source.sha256,originalSource.sha256);
      return {workspaceId:status.workspaceId,catalogId:catalog.id,editionId:catalog.activeEditionId,
        planId:plan.id,planRevision:plan.revision,correctionId:correction.id,correctionRevision:correction.revision,
        decisionId:decision.id,decisionRevision:decision.revision,reviewId:delivery.review.id,
        operation:{id:received.id,requestSha256:received.requestSha256},productSha256:digest(row.product)};
    });
    const customerWork=await step('retained_customer_work_and_older_delivery',async()=>{
      const selected=await mutate(customer,'customer-match','materialDecision',()=>({
        catalogId:mapped.catalog.id,expectedCatalogRevision:mapped.catalog.revision,customerId,description,
        materialKey:mapped.material.key,expectedMaterialSha256:mapped.material.sha256,status:'APPROVED',
        decisionId:delivery.decision.id,expectedRevision:delivery.decision.revision,
        note:'Customer receiving example: confirmed the complete original ETIM product, original C62 quantity and supplier handover.'
      }));
      const decision=operationResult(selected,'decision');
      const current=await customer.supplierProduct({planId:delivery.plan.id,materialKey:mapped.material.key});
      const corrected=await mutate(customer,'customer-price','supplierCorrection',()=>({
        planId:delivery.plan.id,expectedPlanRevision:delivery.plan.revision,materialKey:mapped.material.key,
        expectedMaterialSha256:mapped.material.sha256,expectedBaseProductSha256:current.baseProductSha256,
        expectedRevision:delivery.correction.revision,
        patches:[{path:'/prices',value:product.prices,
          reason:'Customer receiving retained the exact published PRODUCT_PRICE_DETAILS from '+PUBLISHED+'.'}]
      }));
      const correction=operationResult(corrected,'supplierCorrection');
      const reviewed=await mutate(customer,'customer-review','supplierReview',()=>({
        planId:delivery.plan.id,expectedRevision:delivery.plan.revision
      }));
      const review=operationResult(reviewed,'supplierReview');
      assert.equal(review.counts.errors,0);
      assertOriginalProduct((await customer.supplierRow({reviewId:review.id,materialKey:mapped.material.key})).product,product);
      const same=await customer.materialReceive(state.requests['customer-receive'].args);
      assert.equal(same.id,customerReceived.operation.id);
      assert.equal(same.requestSha256,customerReceived.operation.requestSha256);
      const older=await mutate(customer,'older-delivery','materialReceive',()=>({inputId:OLDER_INPUT}));
      operationResult(older);
      assert.equal((await customer.materialCatalog({catalogId:mapped.catalog.id})).activeEditionId,mapped.edition.id);
      assert.equal((await customer.supplierPlan({planId:delivery.plan.id})).revision,delivery.plan.revision);
      assert.equal((await customer.supplierCorrectionGet({correctionId:correction.id})).revision,correction.revision);
      assert.equal((await customer.materialDecisionGet({decisionId:decision.id})).revision,decision.revision);
      assert.deepEqual(await customer.supplierReviewGet({reviewId:review.id}),review);
      return {decision,correction,review,originalBundleReplayPreserved:true,sameRequestReused:true,
        earlierPlanRevision:baseline.plan.revision,earlierCorrectionRevision:baseline.correction.revision};
    });
    const finalFiles=await step('customer_files_and_original_cli',async()=>{
      const materialExport=await mutate(customer,'customer-export','materialExport',()=>({
        catalogId:mapped.catalog.id,expectedCatalogRevision:mapped.catalog.revision,
        formats:['catalog-bundle.jsonl','approved-matches.csv']
      }));
      const supplierExport=await mutate(customer,'customer-xml','supplierExport',()=>({
        reviewId:customerWork.review.id,expectedReviewSha256:customerWork.review.sha256,
        formats:['review.json','bmecat.xml']
      }));
      const material=operationResult(materialExport),supplierResult=operationResult(supplierExport);
      const receivingDirectory=join(downloadsRoot,'customer-workspace');
      const customerFiles=await download(customer,material,receivingDirectory);
      const supplierDirectory=join(downloadsRoot,'customer-supplier');
      const chunks=[],progress=[];
      const stdout={write(value){chunks.push(String(value));return true;}};
      const stderr={write(value){progress.push(String(value));return true;}};
      const cli=await runOpenSearchMaterialCLI(['download-export','--url',server.url,'--workspace',CUSTOMER,
        '--export-id',supplierResult.exportId,'--directory',supplierDirectory,
        '--expected-manifest-sha256',supplierResult.manifestSha256,'--chunk-size','16384'],
        {environment,stdout,stderr});
      assert.equal(cli.state,'COMPLETE');assert.equal(cli.manifestSha256,supplierResult.manifestSha256);
      assert.deepEqual(JSON.parse(chunks.join('')),cli);
      const artifacts=[await fileIdentity(join(supplierDirectory,'manifest.json'),supplierResult.manifestFile)];
      for(const file of supplierResult.manifest.files)artifacts.push({...file,...await fileIdentity(join(supplierDirectory,file.name),file)});
      const xml=artifacts.find(item=>item.name?.endsWith('bmecat.xml'));
      assert.equal(xml.sha256,receivedFiles.supplier.artifacts.find(item=>item.name?.endsWith('bmecat.xml')).sha256);
      const inputPath=join(control,'customer-correction-history.json');
      await retainedBytes(inputPath,json({kind:'correction',id:customerWork.correction.id,limit:1}));
      chunks.length=0;
      const history=await runOpenSearchMaterialCLI(['supplier-history','--url',server.url,'--workspace',CUSTOMER,
        '--input',inputPath,'--all-pages'],{environment,stdout,stderr});
      const pages=chunks.join('').trim().split('\n').map(line=>JSON.parse(line));
      assert.equal(history.pages,pages.length);assert.ok(history.pages>=5);
      assert.equal(pages.at(-1).nextRevision,null);
      return {material:{...material,download:customerFiles},supplier:{...supplierResult,download:{...cli,artifacts}},
        cli:{command:'download-export',historyCommand:'supplier-history --all-pages',historyPages:history.pages,
          progressMessages:progress.length}};
    });
    await step('closed_handles_and_original_reopen',async()=>{
      const primaryRead=await primary.status(),customerRead=await customer.status();
      assert.equal(primaryRead.workspaceId,baseline.workspaceId);assert.equal(customerRead.workspaceId,customerReceived.workspaceId);
      await closeHost();await startHost();
      customer=await connect(CUSTOMER);await customer.open();
      const originalRead=await primary.materialCatalog({catalogId:mapped.catalog.id});
      assert.equal(originalRead.activeEditionId,mapped.edition.id);
      const customerCatalog=await customer.materialCatalog({catalogId:mapped.catalog.id});
      assert.equal(customerCatalog.activeEditionId,mapped.edition.id);
      assert.equal((await customer.supplierCorrectionGet({correctionId:customerWork.correction.id})).revision,customerWork.correction.revision);
      assert.equal((await customer.materialDecisionGet({decisionId:customerWork.decision.id})).revision,customerWork.decision.revision);
      const operation=await customer.operation({requestId:state.requests['customer-receive'].args.requestId});
      assert.equal(operation.id,customerReceived.operation.id);
      assert.equal(operation.requestSha256,customerReceived.operation.requestSha256);
      const retainedOriginal=await primary.materialExport(state.requests['material-export'].args);
      const same=operationResult(retainedOriginal);
      assert.equal(same.exportId,retained.material.exportId);assert.equal(same.manifestSha256,retained.material.manifestSha256);
      const retainedCustomer=await customer.inspectExport(finalFiles.material.exportId);
      assert.equal(retainedCustomer.manifestSha256,finalFiles.material.manifestSha256);
      await download(primary,retained.material,downloadDirectory);
      await download(customer,finalFiles.material,finalFiles.material.download.directory);
      const originalPlan=await primary.supplierPlan({planId:baseline.plan.id,revision:baseline.plan.revision});
      assert.deepEqual(originalPlan,baseline.plan);
      assertOriginalProduct((await customer.supplierRow({reviewId:baseline.review.id,materialKey:baseline.material.key})).product,product);
      return {originalWorkspaceId:baseline.workspaceId,receivingWorkspaceId:customerReceived.workspaceId,
        retainedOriginalExport:retained.material.exportId,retainedCustomerExport:finalFiles.material.exportId,
        priorSupplierHistoryPreserved:true,newerCustomerWorkPreserved:true};
    });
    // A completed report is accepted only with every complete original file
    // still present, byte-exact and bound to the same retained server export.
    const verifyGroup=async(client,selected,path)=>{
      const inspected=await client.inspectExport(selected.exportId);
      assert.equal(inspected.manifestSha256,selected.manifestSha256);
      assert.deepEqual(inspected.manifest,selected.manifest);
      const files=[await fileIdentity(join(path,'manifest.json'),selected.manifestFile)];
      for(const file of selected.manifest.files)files.push({...file,...await fileIdentity(join(path,file.name),file)});
      return {exportId:selected.exportId,manifestSha256:selected.manifestSha256,directory:path,files};
    };
    const artifacts={
      originalMaterials:await verifyGroup(primary,retained.material,downloadDirectory),
      originalSupplier:await verifyGroup(primary,retained.supplier,supplierDownloadDirectory),
      customerWorkspace:await verifyGroup(customer,finalFiles.material,finalFiles.material.download.directory),
      customerSupplier:await verifyGroup(customer,finalFiles.supplier,finalFiles.supplier.download.directory)
    };
    const currentMaterial=await customer.materialGet({editionId:mapped.edition.id,materialKey:mapped.material.key});
    assert.equal(currentMaterial.sha256,mapped.material.sha256);
    const currentRow=await customer.supplierRow({reviewId:customerWork.review.id,materialKey:mapped.material.key});
    assertOriginalProduct(currentRow.product,product);
    await save();
    const required=openSearchMaterialTools(name=>name);
    for(const name of required)assert.ok(state.observedTools[name]>0,'The complete receiving workflow has not used '+name+'.');
    const source=await sourceReport();await closeHost();
    state.state='COMPLETE';state.completedAt??=new Date().toISOString();state.artifacts=artifacts;await save();
    const report={schema:SCHEMA,operationId,supplierOperationId,state:'CLOSED',startedAt:state.startedAt,
      completedAt:state.completedAt,directory,supplierDirectory,source,original:state.original,
      workspaceIds:{original:baseline.workspaceId,received:customerReceived.workspaceId},
      catalog:{id:mapped.catalog.id,revision:mapped.catalog.revision,editionId:mapped.edition.id,
        materialId:mapped.material.materialId,materialSha256:mapped.material.sha256,unit:mapped.material.unit,
        quantity:mapped.quantity.quantity},
      supplier:{planId:delivery.plan.id,planRevision:delivery.plan.revision,originalCorrectionRevision:baseline.correction.revision,
        receivingCorrectionRevision:customerWork.correction.revision,reviewId:customerWork.review.id,
        productSha256:digest(product),products:1,features:30},
      customerDecision:{id:customerWork.decision.id,revision:customerWork.decision.revision},
      phases:Object.keys(state.phases),operations:state.operations,observedTools:state.observedTools,
      newMaterialSupplierTools:required.length,downloadInterruption:state.downloadInterruption,
      files:artifacts,lifetimes:state.lifetimes};
    await atomicBytes(reportFile,Buffer.from(json(report)));
    return report;
  }catch(error){
    if(state){
      state.state='INTERRUPTED';state.error={code:error.code??'MATERIAL_RECEIVING_INTERRUPTED',message:error.message};
      if(!storageFault)await save().catch(()=>{});
    }
    throw error;
  }finally{
    try{if(state)await closeHost();}finally{await lease.close();}
  }
}

export async function main(args=process.argv.slice(2),{stdout=process.stdout}={}) {
  if(!args.length||args.includes('--help')){
    stdout.write('Continue the complete original ETIM supplier delivery through the material MCP.\n\n'+
      '  node receiving/opensearch-materials-native.mjs --supplier-directory ORIGINAL_SUPPLIER_DIRECTORY\n'+
      '       --directory PRIVATE_RECEIVING_DIRECTORY [--supplier-operation supplier-etim-2769]\n'+
      '       [--operation opensearch-materials-2769] [--inputs ORIGINAL_INPUT_DIRECTORY] [--python EXECUTABLE]\n\n'+
      'Keep both directories and both operation IDs to resume the original requests, exports and file checkpoints.\n');
    return;
  }
  const names={'--supplier-directory':'supplierDirectory','--directory':'directory','--supplier-operation':'supplierOperationId',
    '--operation':'operationId','--inputs':'inputsDirectory','--python':'python'},options={};
  for(let index=0;index<args.length;index+=2){
    const name=names[args[index]],value=args[index+1];
    if(!name||!value||value.startsWith('--')||Object.hasOwn(options,name))
      throw failure('MATERIAL_RECEIVING_INPUT','Use each original receiving option with its value once.');
    options[name]=value;
  }
  const result=await runOpenSearchMaterialsReceiving(options);
  stdout.write(json(result));return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(json({error:{code:error.code??'MATERIAL_RECEIVING_INTERRUPTED',message:error.message}}));process.exitCode=1;});
