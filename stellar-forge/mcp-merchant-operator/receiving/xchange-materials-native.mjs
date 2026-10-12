#!/usr/bin/env node
// MIT. Receive the original xChange delivery through the maintained material MCP.
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open,lstat } from 'node:fs/promises';
import { join,dirname,resolve,relative,isAbsolute,sep,basename } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { runXChangeDeliveryJourney } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/xchange-delivery-journey.mjs';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { initializeOpenSearchWorkspaceMerchant,readMerchantConfig } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { openMerchantFileClient } from '../retained-download.mjs';
import { createOpenSearchMaterialClient } from '../opensearch-material-client.mjs';
import { runOpenSearchMaterialCLI } from '../opensearch-material-cli.mjs';
import { openSearchMaterialTools,MATERIAL_EXPORT_FORMATS,SUPPLIER_EXPORT_FORMATS } from '../catalog/opensearch-materials.mjs';
import { materialReceivingIO } from './opensearch-materials-native.mjs';

const {privateDirectory,readBytes,readJson,maybeJson,atomicBytes,retainedBytes,
  fileIdentity,digest,allPages,operationResult,sourceReport,retainedExportFile:exportFile}=materialReceivingIO;
const HERE=dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.xchange-materials-native-receiving.v1';
const PRIMARY='xchange-original',CUSTOMER='xchange-received';
const SOURCE_INPUT='xchange-official-source',OLDER_INPUT='xchange-original-delivery',CURRENT_INPUT='xchange-mcp-delivery';
const XCHANGE_FORMATS=Object.freeze(['review.json','issues.csv','products.jsonl','xchange.json','recipient.jsonl','impact.csv']);
const REQUIRED_TOOLS=Object.freeze([
  'merchant_opensearch_material_inputs','merchant_opensearch_material_upload',
  'merchant_opensearch_material_catalog','merchant_opensearch_material_edition',
  'merchant_opensearch_material_rows','merchant_opensearch_material_get',
  'merchant_opensearch_material_source','merchant_opensearch_material_receive',
  'merchant_opensearch_material_export','merchant_opensearch_supplier_templates',
  'merchant_opensearch_supplier_plan','merchant_opensearch_supplier_history',
  'merchant_opensearch_supplier_product','merchant_opensearch_supplier_correction_get',
  'merchant_opensearch_supplier_review_get','merchant_opensearch_supplier_rows',
  'merchant_opensearch_supplier_recipient_rows','merchant_opensearch_supplier_row',
  'merchant_opensearch_supplier_export','merchant_opensearch_material_export_manifest',
  'merchant_opensearch_material_export_file','merchant_opensearch_material_export_file_release'
]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const failure=(code,message)=>Object.assign(new Error(message),{code});
const inside=(parent,child)=>{const part=relative(parent,child);return !part||!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
const rowsOf=pages=>pages.flatMap(page=>page.rows??page.items??[]);
function seal(value){
  const {sha256,...body}=value;
  assert.equal(digest(body),sha256,'The original sealed record changed.');return value;
}
function assertFormats(selected,formats){
  assert.equal(selected.manifest.files.length,formats.length);
  for(const format of formats)exportFile(selected,format);
}
async function bundleContent(path,expected){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat({bigint:true});
    assert.ok(before.isFile());assert.equal(before.size,BigInt(expected.bytes));
    const exact=createHash('sha256'),payload=createHash('sha256'),logical=createHash('sha256');
    const buffer=Buffer.allocUnsafe(65536),decoder=new TextDecoder('utf-8',{fatal:true});
    let bytes=0,pending='',frames=0,complete=false,summary=null,active=null,sources=0;
    const consume=line=>{
      assert.ok(!complete,'A complete bundle has trailing records.');
      assert.ok(Buffer.byteLength(line)<=8*1024*1024,'The original bundle row exceeds8 MiB.');
      const value=JSON.parse(line);
      if(value.type==='complete'){
        assert.equal(active,null);assert.equal(value.frames,frames);
        assert.equal(value.payloadSha256,payload.digest('hex'));
        const {payloadSha256,frames:frameCount,...stable}=value;logical.update(digest(stable)+'\n');
        complete=true;summary={schema:value.schema,catalogId:value.catalogId,rows:value.rows,sourceBytes:value.sourceBytes,sources};
        return;
      }
      payload.update(line+'\n');frames++;
      if(value.type==='source-start'){
        assert.equal(active,null);active={id:value.id,bytes:0,hash:createHash('sha256')};
      }else if(value.type==='source-chunk'){
        assert.ok(active);assert.equal(value.id,active.id);assert.equal(value.offset,active.bytes);
        const data=Buffer.from(value.base64,'base64');assert.equal(data.toString('base64'),value.base64);
        assert.ok(data.length>0);active.hash.update(data);active.bytes+=data.length;return;
      }else if(value.type==='source-end'){
        assert.ok(active);assert.equal(value.id,active.id);assert.equal(value.bytes,active.bytes);
        assert.equal(value.sha256,active.hash.digest('hex'));active=null;sources++;
      }else assert.equal(active,null,'The original source stream was interrupted by another record.');
      const selected={...value};if(value.type==='header')delete selected.exportedAt;
      logical.update(digest(selected)+'\n');
    };
    while(BigInt(bytes)<before.size){
      const result=await file.read(buffer,0,Math.min(buffer.length,Number(before.size)-bytes),bytes);
      assert.ok(result.bytesRead>0);bytes+=result.bytesRead;
      const chunk=buffer.subarray(0,result.bytesRead);exact.update(chunk);pending+=decoder.decode(chunk,{stream:true});
      let index;while((index=pending.indexOf('\n'))>=0){consume(pending.slice(0,index));pending=pending.slice(index+1);}
      assert.ok(Buffer.byteLength(pending)<=8*1024*1024);
    }
    pending+=decoder.decode();assert.equal(pending,'','Retain every complete original JSONL line.');
    assert.ok(complete,'The original bundle completion record is missing.');
    assert.equal(exact.digest('hex'),expected.sha256);
    const after=await file.stat({bigint:true}),named=await lstat(path,{bigint:true});
    const identity=info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
    assert.ok(named.isFile()&&!named.isSymbolicLink()&&identity(before)===identity(after)&&identity(after)===identity(named));
    return {...summary,contentSha256:logical.digest('hex')};
  }finally{await file.close();}
}
function nativeIdentity(journey,artifacts){
  return {operationId:journey.operationId,directory:journey.directory,sourceFile:journey.sourceFile,
    workspace:journey.workspace,catalog:journey.catalog,supplier:journey.supplier,customer:journey.customer,
    materialKeys:[...journey.materialKeys].sort(),sourceCorrection:journey.sourceCorrection,artifacts};
}

/**
 * Continue the same original xChange producer/customer receiving operation.
 * Every outbound mutation keeps its request before calling the native host.
 * A resumed complete phase still reconciles every original output at the end.
 */
export async function runXChangeMaterialsReceiving({
  xchangeDirectory,directory,xchangeOperationId='xchange-etim-2769',
  operationId='xchange-materials-2769',inputsDirectory
}={}){
  if(typeof xchangeDirectory!=='string'||typeof directory!=='string'||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/.test(operationId)||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,50}$/.test(xchangeOperationId))
    throw failure('XCHANGE_MCP_INPUT','Use the original xChange and private MCP receiving directories with their stable operation IDs.');
  xchangeDirectory=resolve(xchangeDirectory);directory=resolve(directory);
  if(inside(xchangeDirectory,directory)||inside(directory,xchangeDirectory))
    throw failure('XCHANGE_MCP_INPUT','Keep the complete source journey and MCP receiving directories distinct.');
  for(const format of XCHANGE_FORMATS)assert.ok(SUPPLIER_EXPORT_FORMATS.includes(format));
  await privateDirectory(directory);
  const control=join(directory,'control');await privateDirectory(control);
  const stateFile=join(control,'receiving-state.json'),reportFile=join(directory,'xchange-materials-native.json');
  const lease=await acquireStateLease(control);
  const selected={schema:SCHEMA,operationId,xchangeOperationId,xchangeDirectory,directory};
  let state,server,primary,customer,environment,storageFault=null;
  const calls={};
  const save=async()=>{
    if(storageFault)throw storageFault;
    lease.assertHeld();state.updatedAt=new Date().toISOString();
    for(const[name,count]of Object.entries(calls)){state.observedTools[name]=(state.observedTools[name]??0)+count;delete calls[name];}
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
      const args=await prepare();
      request={method,args:{requestId:operationId+'-'+key,...args}};
      assert.equal(request.args.requestId,operationId+'-'+key);
      state.requests[key]=request;await save();
    }
    assert.equal(request.method,method);
    const result=await client[method](request.args);
    operationResult(result);assert.equal(result.id,request.args.requestId);
    const receipt={id:result.id,kind:result.kind,requestSha256:result.requestSha256,state:result.state};
    if(state.operations[key])assert.deepEqual(receipt,state.operations[key],'The original native request changed.');
    else{state.operations[key]=receipt;await save();}
    return result;
  };
  const connect=async alias=>{
    const transport=await openMerchantFileClient({url:server.url,environment});
    return createOpenSearchMaterialClient({workspace:alias,client:{endpoint:transport.endpoint,
      call:async(name,args,options)=>{
        const result=await transport.call(name,args,options);calls[name]=(calls[name]??0)+1;return result;
      }}});
  };
  const closeHost=async()=>{
    if(!server&&!primary&&!customer)return;
    const errors=[];
    if(customer){try{await customer.close();}catch(error){errors.push(error);}customer=null;}
    if(primary){try{await primary.close();}catch(error){errors.push(error);}primary=null;}
    if(server){try{await server.close();server=null;}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'The original xChange MCP handles are still closing.');
    state.lifetimes={merchant:'CLOSED',producer:'CLOSED',receiver:'CLOSED'};
    if(!storageFault)await save();
  };
  try{
    state=await maybeJson(stateFile)??{...selected,startedAt:new Date().toISOString(),phases:{},requests:{},operations:{},
      observedTools:{},host:null,connection:null,lifetimes:{merchant:'CLOSED',producer:'CLOSED',receiver:'CLOSED'}};
    for(const[key,value]of Object.entries(selected))assert.deepEqual(state[key],value,'Keep the same original receiving selection.');
    state.state='RUNNING';state.error=null;await save();
    const journey=await runXChangeDeliveryJourney({directory:xchangeDirectory,operationId:xchangeOperationId,
      ...(inputsDirectory===undefined?{}:{inputsDirectory})});
    assert.equal(journey.schema,'stellar-forge.xchange-delivery-native.v1');
    assert.equal(journey.state,'CLOSED');assert.equal(journey.operationId,xchangeOperationId);
    assert.equal(resolve(journey.directory),xchangeDirectory);
    for(const path of Object.values(journey.workspace)){
      assert.ok(isAbsolute(path)&&inside(xchangeDirectory,path),'Use the original source journey workspace.');
      await privateDirectory(path);
    }
    assert.notEqual(journey.workspace.producer,journey.workspace.receiver);
    assert.ok(journey.customer?.reviewId&&journey.customer.correctionId,'Retain the source journey’s complete customer work.');
    const sourceFile=resolve(journey.sourceFile);
    assert.ok(inside(xchangeDirectory,sourceFile));
    const sourceIdentity=await fileIdentity(sourceFile);
    const official=await fileIdentity(journey.inputs.officialSample.path,journey.inputs.officialSample);
    const exported=[];
    for(const item of journey.exports){
      assert.equal(item.name,basename(item.name),'Retain a flat original export name.');
      exported.push({...item,...await fileIdentity(join(xchangeDirectory,'exports',item.name),item)});
    }
    assert.equal(journey.bundle.name,basename(journey.bundle.name));
    const originalBundle=await fileIdentity(join(xchangeDirectory,'exports',journey.bundle.name),journey.bundle);
    const original=nativeIdentity(journey,{source:sourceIdentity,officialSample:official,exports:exported,bundle:originalBundle});
    if(state.original)assert.deepEqual(state.original,original,'The original xChange delivery selection changed.');
    else{state.original=original;await save();}
    const sourceConfig=await readJson(sourceFile);
    assert.ok(/^[A-Z_][A-Z0-9_]{0,127}$/.test(sourceConfig.endpointEnv),'Use the original endpoint environment selector.');
    environment={...process.env,[sourceConfig.endpointEnv]:'http://127.0.0.1:9200',
      MCP_ACCESS_TOKEN:randomBytes(32).toString('hex'),MCP_CLIENT_ORIGINS:''};
    delete environment.MCP_OAUTH_CONFIG;
    const downloadsRoot=join(directory,'downloads');await privateDirectory(downloadsRoot);
    const connectionPath=join(control,'opensearch-connection.json');
    const officialSource=journey.officialSource;
    assert.ok(typeof officialSource?.sourceId==='string'&&typeof officialSource.name==='string');
    assert.equal(officialSource.bytes,official.bytes);assert.equal(officialSource.sha256,official.sha256);
    assert.equal(officialSource.format.kind,'xchange-json');
    const sourceName=officialSource.name;
    const connectionFor=extra=>{
      const inputs={
        [SOURCE_INPUT]:{path:official.path,name:sourceName,bytes:official.bytes,sha256:official.sha256},
        [OLDER_INPUT]:{path:originalBundle.path,name:journey.bundle.name,bytes:originalBundle.bytes,sha256:originalBundle.sha256}
      };
      return {schema:'stellar-forge.opensearch-workspace-connection.v1',workspaces:{
        [PRIMARY]:{label:'Original ETIM xChange supplier',directory:journey.workspace.producer,sourceFile,materialInputs:inputs},
        [CUSTOMER]:{label:'Received ETIM xChange customer',directory:journey.workspace.receiver,sourceFile,
          materialInputs:{...inputs,...(extra?{[CURRENT_INPUT]:extra}:{})}}
      }};
    };
    const installConnection=async value=>{
      const bytes=Buffer.from(json(value)),sha256=hash(bytes);
      if(!state.connection||state.connection.sha256!==sha256){
        assert.ok(!server,'Close the original host before changing a declared input selection.');
        if(state.connectionIntent)assert.deepEqual(state.connectionIntent.value,value,'Complete the same connection publication.');
        else{state.connectionIntent={sha256,previousSha256:state.connection?.sha256??null,value};await save();}
      }
      const intent=state.connectionIntent??{sha256,previousSha256:sha256,value};
      assert.equal(intent.sha256,sha256);
      let previous=null;try{previous=await readBytes(connectionPath);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(previous)assert.ok(hash(previous)===intent.sha256||hash(previous)===intent.previousSha256,'The retained host connection changed.');
      else assert.equal(intent.previousSha256,null,'The original host connection disappeared.');
      if(!previous||hash(previous)!==sha256)await atomicBytes(connectionPath,bytes);
      state.connection={path:connectionPath,sha256};delete state.connectionIntent;await save();
    };
    await installConnection(state.connectionIntent?.value??connectionFor(state.bundleInput));
    if(!state.host){
      let choice=state.hostInitialization,usable=false;
      if(choice){
        try{
          const raw=await readJson(choice.configuration);
          assert.equal(raw.opensearchWorkspaceConnection,connectionPath);
          await readMerchantConfig(choice.configuration);usable=true;
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(!usable){
        const hostDirectory=join(directory,'merchant-'+randomUUID());
        choice={directory:hostDirectory,configuration:join(hostDirectory,'merchant-mcp.json')};
        state.hostInitialization=choice;await save();
        await initializeOpenSearchWorkspaceMerchant({directory:hostDirectory,connection:connectionPath,
          name:'Original xChange supplier and customer receiving'});
      }
      state.host={...choice,configurationSha256:hash(await readBytes(choice.configuration))};await save();
    }
    assert.equal(hash(await readBytes(state.host.configuration)),state.host.configurationSha256);
    const startHost=async()=>{
      assert.ok(!server);
      server=await startMerchantMcp({configPath:state.host.configuration,port:state.port??0,environment});
      const port=Number(new URL(server.url).port);
      if(state.port!==undefined)assert.equal(port,state.port,'Resume downloads at the original endpoint.');
      else{state.port=port;await save();}
      const advertised=new Set(server.operator.tools.map(tool=>tool.name));
      for(const name of openSearchMaterialTools(name=>name))assert.ok(advertised.has(name),'The original host omitted '+name+'.');
      primary=await connect(PRIMARY);await primary.open();
      customer=await connect(CUSTOMER);await customer.open();
      state.lifetimes={merchant:'OPEN',producer:'OPEN',receiver:'OPEN'};await save();
    };
    await startHost();
    const inspectRows=async(client,review)=>{
      const pages=await allPages(client,'supplierRecipientRows',{reviewId:review.id,limit:1});
      assert.ok(pages.length>0);
      const rows=rowsOf(pages);
      assert.equal(rows.length,pages[0].total);
      assert.equal(pages.at(-1).nextOffset,null);
      for(const page of pages){
        assert.equal(page.reviewId,review.id);assert.equal(page.reviewSha256,review.sha256);
        assert.deepEqual(page.recipient,review.recipient);
      }
      const accumulator=createHash('sha256');
      for(const row of rows){
        seal(row);assert.equal(row.reviewId,review.id);
        assert.equal(row.beforeSha256,row.before===null?null:digest(row.before));
        assert.equal(row.afterSha256,row.after===null?null:digest(row.after));
        accumulator.update(row.kind+':'+row.key+':'+row.sha256+'\n');
      }
      assert.equal(accumulator.digest('hex'),review.recipient.rowsRootSha256,'The complete recipient root changed.');
      return {reviewId:review.id,reviewSha256:review.sha256,pages:pages.length,rows,recipient:review.recipient};
    };
    const baseline=await step('original_workspaces_templates_and_recipient_state',async()=>{
      const producerStatus=await primary.status(),receiverStatus=await customer.status();
      assert.equal(producerStatus.state,'OPEN');assert.equal(receiverStatus.state,'OPEN');
      assert.notEqual(producerStatus.workspaceId,receiverStatus.workspaceId);
      const inputs=await primary.materialInputs(),selectedInput=inputs.inputs.find(item=>item.inputId===SOURCE_INPUT);
      assert.equal(selectedInput.sha256,official.sha256);assert.equal(selectedInput.bytes,official.bytes);
      for(const target of ['xchange-2.0','2ba-xchange-2.0']){
        const template=await primary.supplierTemplates({target});
        assert.equal(template.profile.target,target);assert.ok(template.catalogMapping&&template.bindings['/xChange']);
      }
      const catalog=await primary.materialCatalog({catalogId:journey.catalog.id});
      assert.equal(catalog.revision,journey.catalog.revision);assert.equal(catalog.activeEditionId,journey.catalog.editionId);
      const edition=await primary.materialEdition({editionId:catalog.activeEditionId});
      const materials=rowsOf(await allPages(primary,'materialRows',{editionId:edition.id,limit:1}));
      assert.deepEqual(materials.map(value=>value.key).sort(),[...journey.materialKeys].sort());
      for(const material of materials){
        assert.deepEqual(await primary.materialGet({editionId:edition.id,materialKey:material.key}),material);
        assert.equal(material.attributes.xChange.schema,'stellar-forge.xchange-product.v1');
      }
      const originalSource=await primary.materialSource({sourceId:edition.source.id});
      assert.equal(originalSource.sha256,edition.source.sha256);
      const plan=await primary.supplierPlan({planId:journey.supplier.planId});
      const review=await primary.supplierReviewGet({reviewId:journey.supplier.reviewId});
      assert.equal(review.sha256,journey.supplier.reviewSha256);assert.equal(review.counts.errors,0);
      assert.equal(review.recipient.catalogueType,'FULL');assert.equal(review.planId,plan.id);
      const recipient=await inspectRows(primary,review);
      const customerPlan=await customer.supplierPlan({planId:journey.customer.planId});
      const customerReview=await customer.supplierReviewGet({reviewId:journey.customer.reviewId});
      assert.equal(customerReview.sha256,journey.customer.reviewSha256);assert.equal(customerReview.counts.errors,0);
      const correction=await customer.supplierCorrectionGet({correctionId:journey.customer.correctionId});
      assert.equal(correction.revision,journey.customer.correctionRevision);
      const customerRows=rowsOf(await allPages(customer,'supplierRows',{reviewId:customerReview.id,status:'all',limit:1}));
      const customerRecipient=await inspectRows(customer,customerReview);
      for(const row of customerRows){
        assert.deepEqual(await customer.supplierRow({reviewId:customerReview.id,materialKey:row.materialKey}),row);
        const product=await customer.supplierProduct({planId:customerPlan.id,materialKey:row.materialKey});
        assert.equal(product.baseProductSha256,row.baseProductSha256);
      }
      const history=rowsOf(await allPages(customer,'supplierHistory',{kind:'correction',id:correction.id,limit:1}));
      assert.ok(history.some(value=>value.revision===correction.revision));
      return {workspaceIds:{producer:producerStatus.workspaceId,receiver:receiverStatus.workspaceId},
        catalog,edition,materials,plan,review,recipient,
        customer:{plan:customerPlan,review:customerReview,correction,rows:customerRows,recipient:customerRecipient}};
    });
    const intake=await step('original_native_xchange_source_intake',async()=>{
      const result=await mutate(primary,'official-source','materialUpload',()=>({
        inputId:SOURCE_INPUT,format:{kind:'xchange-json'},
        provenance:officialSource.provenance
      }));
      const source=operationResult(result,'source');
      assert.equal(source.sha256,official.sha256);assert.equal(source.bytes,official.bytes);
      assert.equal(source.id,officialSource.sourceId);
      assert.equal(source.format.kind,'xchange-json');
      const retained=await primary.materialSource({sourceId:source.id});assert.deepEqual(retained,source);
      return {sourceId:source.id,bytes:source.bytes,sha256:source.sha256,format:source.format};
    });
    await step('recipient_filters_and_cross_plan_history',async()=>{
      const all=baseline.recipient.rows,review=baseline.review;
      for(const kind of ['product','tradeItem']){
        const selected=rowsOf(await allPages(primary,'supplierRecipientRows',{reviewId:review.id,kind,limit:1}));
        assert.deepEqual(selected,all.filter(row=>row.kind===kind));
      }
      for(const change of [...new Set(all.map(row=>row.action))]){
        const selected=rowsOf(await allPages(primary,'supplierRecipientRows',{reviewId:review.id,change,limit:1}));
        assert.deepEqual(selected,all.filter(row=>row.action===change));
      }
      for(const row of all){
        const selected=rowsOf(await allPages(primary,'supplierRecipientRows',{reviewId:review.id,search:row.supplierKey,limit:1}));
        assert.ok(selected.some(value=>value.key===row.key&&value.kind===row.kind),'Search the retained original supplier identity.');
      }
      const priorId=journey.supplier.previousReviewId;
      assert.ok(priorId,'The original source journey must retain its cross-plan previous review.');
      const previous=await primary.supplierReviewGet({reviewId:priorId});
      assert.equal(previous.catalogId,review.catalogId);assert.equal(previous.recipient.target,review.recipient.target);
      const priorRows=await inspectRows(primary,previous);
      assert.equal(review.recipient.previousReviewId,previous.id);assert.equal(review.recipient.previousReviewSha256,previous.sha256);
      const history=rowsOf(await allPages(primary,'supplierHistory',{kind:'plan',id:baseline.plan.id,limit:1}));
      assert.ok(history.some(value=>value.revision===baseline.plan.revision));
      return {filteredRecords:all.length,previousReviewId:previous.id,previousReviewSha256:previous.sha256,
        previousRecipientRootSha256:priorRows.recipient.rowsRootSha256,planHistoryRows:history.length};
    });
    const exports=await step('complete_original_material_and_xchange_exports',async()=>{
      const material=operationResult(await mutate(primary,'material-export','materialExport',()=>({
        catalogId:baseline.catalog.id,expectedCatalogRevision:baseline.catalog.revision,
        editionId:baseline.edition.id,index:'xchange-published-materials',formats:[...MATERIAL_EXPORT_FORMATS]
      })));
      const supplier=operationResult(await mutate(primary,'supplier-export','supplierExport',()=>({
        reviewId:baseline.review.id,expectedReviewSha256:baseline.review.sha256,formats:[...XCHANGE_FORMATS]
      })));
      for(const[kind,value]of Object.entries({material,supplier})){
        assertFormats(value,kind==='material'?MATERIAL_EXPORT_FORMATS:XCHANGE_FORMATS);
        const inspected=await primary.inspectExport(value.exportId);
        assert.equal(inspected.manifestSha256,value.manifestSha256);assert.deepEqual(inspected.manifest,value.manifest);
        assert.equal(value.manifest.workspaceId,baseline.workspaceIds.producer);
        assert.ok(/^[a-f0-9]{64}$/.test(value.manifest.sourceSnapshotSha256));
      }
      const info=await primary.exportManifest({exportId:supplier.exportId});
      const chunk=await primary.exportFile({exportId:info.exportId,file:info.manifestFile.name,
        expectedManifestSha256:info.manifestFile.sha256,expectedSha256:info.manifestFile.sha256,offset:0,limit:1});
      assert.equal(chunk.bytesRead,1);assert.notEqual(chunk.nextOffset,null);
      assert.equal((await primary.exportFileRelease({exportId:info.exportId,readId:chunk.readId})).released,true);
      return {material,supplier};
    });
    const materialDirectory=join(downloadsRoot,'original-materials'),supplierDirectory=join(downloadsRoot,'original-xchange');
    const download=async(client,selected,path,extra={})=>{
      const result=await client.downloadExport({exportId:selected.exportId,directory:path,
        expectedManifestSha256:selected.manifestSha256,chunkSize:16384,...extra});
      assert.equal(result.state,'COMPLETE');assert.equal(result.files,selected.manifest.files.length);
      assert.equal(result.manifestSha256,selected.manifestSha256);
      const artifacts=[await fileIdentity(join(path,'manifest.json'),selected.manifestFile)];
      for(const file of selected.manifest.files)artifacts.push({...file,...await fileIdentity(join(path,file.name),file)});
      return {...result,artifacts};
    };
    await step('interrupted_original_download',async()=>{
      if(state.downloadInterruption?.observed)return state.downloadInterruption;
      state.downloadInterruption={armed:true,observed:false};await save();
      let interrupted=false;
      try{
        await download(primary,exports.material,materialDirectory,{onProgress:async progress=>{
          if(progress.file===exportFile(exports.material,'catalog-bundle.jsonl').name&&progress.bytes>0&&progress.bytes<progress.total){
            state.downloadInterruption={armed:false,observed:true,exportId:progress.exportId,
              file:progress.file,bytes:progress.bytes,total:progress.total};await save();
            throw failure('XCHANGE_MCP_DOWNLOAD_INTERRUPTED','Resume the original complete bundle after reopening this same merchant.');
          }
        }});
      }catch(error){if(error.code!=='XCHANGE_MCP_DOWNLOAD_INTERRUPTED')throw error;interrupted=true;}
      assert.ok(interrupted,'Retain a real nonfinal prefix of the complete original bundle.');
      await closeHost();await startHost();return state.downloadInterruption;
    });
    const received=await step('resumed_complete_original_files',async()=>{
      const material=await download(primary,exports.material,materialDirectory);
      assert.ok(material.resumed&&material.resumedBytes>0,'The original verified prefix was not resumed.');
      const supplier=await download(primary,exports.supplier,supplierDirectory);
      const again=await download(primary,exports.material,materialDirectory);
      assert.equal(again.bytes,material.bytes);assert.ok(again.resumed);
      const bundle=exportFile(exports.material,'catalog-bundle.jsonl');
      const originalContent=await bundleContent(originalBundle.path,originalBundle);
      const mcpContent=await bundleContent(join(materialDirectory,bundle.name),bundle);
      assert.deepEqual(mcpContent,originalContent,'The full MCP bundle changed the original retained records or source bodies.');
      const recipientFile=exportFile(exports.supplier,'recipient.jsonl');
      const recipientText=(await readBytes(join(supplierDirectory,recipientFile.name))).toString('utf8').trim();
      const recipient=recipientText.split('\n').map(line=>JSON.parse(line));
      const [header,...rows]=recipient;
      assert.equal(header.kind,'recipient-review');assert.equal(header.reviewId,baseline.review.id);
      assert.equal(header.reviewSha256,baseline.review.sha256);assert.deepEqual(header.recipient,baseline.review.recipient);
      assert.deepEqual(header.profile,baseline.plan.profile);
      assert.deepEqual(rows,baseline.recipient.rows,'The complete recipient export omitted retained rows.');
      return {material,supplier,bundleContent:originalContent};
    });
    for(const group of Object.values(received))if(group?.artifacts)for(const item of group.artifacts)await fileIdentity(item.path,item);
    const portable=exportFile(exports.material,'catalog-bundle.jsonl');
    const bundleInput={path:join(materialDirectory,portable.name),name:portable.name,bytes:portable.bytes,sha256:portable.sha256};
    if(state.bundleInput)assert.deepEqual(state.bundleInput,bundleInput);
    else{state.bundleInput=bundleInput;await save();}
    if(state.connection.sha256!==hash(Buffer.from(json(connectionFor(bundleInput))))){
      await closeHost();await installConnection(connectionFor(bundleInput));await startHost();
    }
    const assertCustomer=async()=>{
      const status=await customer.status();assert.equal(status.workspaceId,baseline.workspaceIds.receiver);
      assert.deepEqual(await customer.supplierPlan({planId:baseline.customer.plan.id}),baseline.customer.plan);
      assert.deepEqual(await customer.supplierCorrectionGet({correctionId:baseline.customer.correction.id}),baseline.customer.correction);
      assert.deepEqual(await customer.supplierReviewGet({reviewId:baseline.customer.review.id}),baseline.customer.review);
      assert.deepEqual((await inspectRows(customer,baseline.customer.review)).rows,baseline.customer.recipient.rows);
      for(const row of baseline.customer.rows)
        assert.deepEqual(await customer.supplierRow({reviewId:baseline.customer.review.id,materialKey:row.materialKey}),row);
    };
    const receiving=await step('complete_bundle_receiving_preserves_customer_work',async()=>{
      await assertCustomer();
      const inputs=await customer.materialInputs(),selected=inputs.inputs.find(value=>value.inputId===CURRENT_INPUT);
      assert.equal(selected.sha256,portable.sha256);assert.equal(selected.bytes,portable.bytes);
      const received=await mutate(customer,'customer-receive','materialReceive',()=>({inputId:CURRENT_INPUT}));
      operationResult(received);await assertCustomer();
      const same=await customer.materialReceive(state.requests['customer-receive'].args);
      assert.equal(same.id,received.id);assert.equal(same.requestSha256,received.requestSha256);
      const older=await mutate(customer,'earlier-delivery','materialReceive',()=>({inputId:OLDER_INPUT}));
      operationResult(older);await assertCustomer();
      const retained=await inspectRows(customer,baseline.review);
      assert.deepEqual(retained.rows,baseline.recipient.rows);
      return {operation:state.operations['customer-receive'],originalBundleOperation:state.operations['earlier-delivery'],
        workspaceId:baseline.workspaceIds.receiver,customerCorrectionId:baseline.customer.correction.id,
        customerCorrectionRevision:baseline.customer.correction.revision,
        customerReviewId:baseline.customer.review.id,customerReviewSha256:baseline.customer.review.sha256,
        originalRecipientRootSha256:baseline.review.recipient.rowsRootSha256,
        currentRecipientRootSha256:baseline.customer.review.recipient.rowsRootSha256};
    });
    const customerExports=await step('complete_customer_catalog_and_delivery_files',async()=>{
      const catalog=await customer.materialCatalog({catalogId:baseline.catalog.id});
      const material=operationResult(await mutate(customer,'customer-export','materialExport',()=>({
        catalogId:catalog.id,expectedCatalogRevision:catalog.revision,editionId:catalog.activeEditionId,
        index:'xchange-received-materials',formats:[...MATERIAL_EXPORT_FORMATS]
      })));
      const supplier=operationResult(await mutate(customer,'customer-xchange','supplierExport',()=>({
        reviewId:baseline.customer.review.id,expectedReviewSha256:baseline.customer.review.sha256,formats:[...XCHANGE_FORMATS]
      })));
      assertFormats(material,MATERIAL_EXPORT_FORMATS);assertFormats(supplier,XCHANGE_FORMATS);
      const materialPath=join(downloadsRoot,'customer-materials'),supplierPath=join(downloadsRoot,'customer-xchange');
      const materialFiles=await download(customer,material,materialPath);
      const supplierFiles=await download(customer,supplier,supplierPath);
      return {material:{...material,download:materialFiles},supplier:{...supplier,download:supplierFiles}};
    });
    const cli=await step('installed_client_recipient_pages_and_complete_download',async()=>{
      const chunks=[],progress=[],stdout={write(value){chunks.push(String(value));return true;}},
        stderr={write(value){progress.push(String(value));return true;}};
      const requestFile=join(control,'recipient-page-request.json');
      await retainedBytes(requestFile,json({reviewId:baseline.customer.review.id,limit:1}));
      const paging=await runOpenSearchMaterialCLI(['supplier-recipient-rows','--url',server.url,'--workspace',CUSTOMER,
        '--input',requestFile,'--all-pages'],{environment,stdout,stderr});
      const pages=chunks.join('').trim().split('\n').map(line=>JSON.parse(line));
      assert.equal(paging.pages,pages.length);assert.equal(pages.at(-1).nextOffset,null);
      assert.deepEqual(rowsOf(pages),baseline.customer.recipient.rows);
      chunks.length=0;
      const downloaded=await runOpenSearchMaterialCLI(['download-export','--url',server.url,'--workspace',CUSTOMER,
        '--export-id',customerExports.supplier.exportId,'--directory',customerExports.supplier.download.directory,
        '--expected-manifest-sha256',customerExports.supplier.manifestSha256,'--chunk-size','16384'],
        {environment,stdout,stderr});
      assert.equal(downloaded.state,'COMPLETE');assert.ok(downloaded.resumed);
      assert.deepEqual(JSON.parse(chunks.join('')),downloaded);
      return {recipientPages:pages.length,recipientRows:rowsOf(pages).length,
        supplierFiles:downloaded.files,manifestSha256:downloaded.manifestSha256,progressMessages:progress.length};
    });
    await step('same_host_reopen_and_retained_operation_replay',async()=>{
      await closeHost();await startHost();await assertCustomer();
      const replay=operationResult(await primary.materialExport(state.requests['material-export'].args));
      assert.equal(replay.exportId,exports.material.exportId);assert.equal(replay.manifestSha256,exports.material.manifestSha256);
      const current=await customer.operation({requestId:state.requests['customer-receive'].args.requestId});
      assert.equal(current.id,receiving.operation.id);assert.equal(current.requestSha256,receiving.operation.requestSha256);
      const supplier=await customer.inspectExport(customerExports.supplier.exportId);
      assert.equal(supplier.manifestSha256,customerExports.supplier.manifestSha256);
      assert.deepEqual((await inspectRows(primary,baseline.review)).rows,baseline.recipient.rows);
      return {port:state.port,workspaceIds:baseline.workspaceIds,receivedOperationId:current.id,
        originalExportId:replay.exportId,customerExportId:supplier.exportId};
    });
    const verifyGroup=async(client,selection,path)=>{
      const inspected=await client.inspectExport(selection.exportId);
      assert.equal(inspected.manifestSha256,selection.manifestSha256);assert.deepEqual(inspected.manifest,selection.manifest);
      const files=[await fileIdentity(join(path,'manifest.json'),selection.manifestFile)];
      for(const file of selection.manifest.files)files.push({...file,...await fileIdentity(join(path,file.name),file)});
      return {exportId:selection.exportId,manifestSha256:selection.manifestSha256,directory:path,files};
    };
    const artifacts={
      producerMaterials:await verifyGroup(primary,exports.material,materialDirectory),
      producerXChange:await verifyGroup(primary,exports.supplier,supplierDirectory),
      customerMaterials:await verifyGroup(customer,customerExports.material,customerExports.material.download.directory),
      customerXChange:await verifyGroup(customer,customerExports.supplier,customerExports.supplier.download.directory)
    };
    await assertCustomer();
    for(const item of exported)await fileIdentity(item.path,item);
    await fileIdentity(originalBundle.path,originalBundle);await fileIdentity(official.path,official);
    await save();
    for(const name of REQUIRED_TOOLS)assert.ok(state.observedTools[name]>0,'The whole xChange receiving flow did not use '+name+'.');
    const source=await sourceReport();
    for(const path of ['xchange-materials-native.mjs','opensearch-materials-native.mjs']){
      const bytes=await readBytes(join(HERE,path));
      source['receiving/'+path]={bytes:bytes.length,sha256:hash(bytes),
        gitBlob:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};
    }
    await closeHost();
    state.state='COMPLETE';state.completedAt??=new Date().toISOString();state.artifacts=artifacts;await save();
    const report={schema:SCHEMA,operationId,xchangeOperationId,state:'CLOSED',directory,xchangeDirectory,
      startedAt:state.startedAt,completedAt:state.completedAt,source,original:state.original,
      workspaceIds:baseline.workspaceIds,catalog:journey.catalog,supplier:journey.supplier,customer:receiving,
      sourceIntake:intake,cli,phases:Object.keys(state.phases),operations:state.operations,
      advertisedMaterialSupplierTools:openSearchMaterialTools(name=>name).length,
      observedTools:state.observedTools,downloadInterruption:state.downloadInterruption,files:artifacts,lifetimes:state.lifetimes};
    await atomicBytes(reportFile,Buffer.from(json(report)));return report;
  }catch(error){
    if(state){state.state='INTERRUPTED';state.error={code:error.code??'XCHANGE_MCP_INTERRUPTED',message:error.message};
      if(!storageFault)await save().catch(()=>{});}
    throw error;
  }finally{
    try{if(state)await closeHost();}finally{await lease.close();}
  }
}
export async function main(args=process.argv.slice(2),{stdout=process.stdout}={}){
  if(!args.length||args.includes('--help')){
    stdout.write('Receive the original complete xChange delivery through the material MCP.\n\n'+
      '  node receiving/xchange-materials-native.mjs --xchange-directory ORIGINAL_JOURNEY_DIRECTORY\n'+
      '       --directory PRIVATE_MCP_RECEIVING_DIRECTORY [--xchange-operation xchange-etim-2769]\n'+
      '       [--operation xchange-materials-2769] [--inputs ORIGINAL_PUBLISHER_INPUT_DIRECTORY]\n\n'+
      'Retain both operation directories and IDs to continue original exports, requests and download checkpoints.\n');
    return;
  }
  const fields={'--xchange-directory':'xchangeDirectory','--directory':'directory',
    '--xchange-operation':'xchangeOperationId','--operation':'operationId','--inputs':'inputsDirectory'},options={};
  for(let index=0;index<args.length;index+=2){
    const key=fields[args[index]],value=args[index+1];
    if(!key||!value||value.startsWith('--')||Object.hasOwn(options,key))
      throw failure('XCHANGE_MCP_INPUT','Use each supported receiving option and its original value once.');
    options[key]=value;
  }
  const report=await runXChangeMaterialsReceiving(options);stdout.write(json(report));return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(json({error:{code:error.code??'XCHANGE_MCP_INTERRUPTED',message:error.message}}));process.exitCode=1;});
