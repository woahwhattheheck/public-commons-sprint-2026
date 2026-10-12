// MIT. One WordPress source workspace with original SF30/SF82/SF88 publication.
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKSPACE_SCHEMA, UUID, identity, sha256, jsonBytes, clone, now, id, hash, directory as absolute,
  object, only, text, integer, fail, validateSource, credentialReferences, errorRecord, newId } from './config.mjs';
import { privateDirectory, acquireWorkspace, readJson, readPrivate, atomicJson, immutableJson, copied, exists, hashPrivate, inventory } from './files.mjs';
import { openWordPressSource } from './capture.mjs';
import { suggestedProjection, validateProjection, projectionPreview, buildEdition, readEdition, compareEditions } from './edition.mjs';
import { packet } from './packet.mjs';
import { inspectWordPressWorkspaceBinding } from './managed.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { openSocrataPublisher } from '../socrata/publisher.mjs';
import { readDatasetSourceFiles } from '../../sf82-seller-pilot/release-dataset.mjs';
const STATE_BYTES=33554432, RESULT_BYTES=33554432;
const recoverable=new Set(['source.save','source.select','source.discover','capture.start','capture.resume','capture.pause',
  'mapping.save','edition.build','merchant.save','edition.export','product.select','source.packet','source.files']);
export async function openWordPressWorkspace({directory,environment=process.env,python='python3',fetchImpl=fetch,onEvent,expectedWorkspaceId,expectedWorkspaceIdentity}={}) {
  directory=absolute(directory);await privateDirectory(directory,true);
  const release=await acquireWorkspace(directory),sources=new Map(),publishers=new Map(),active=new Map();
  let tail=Promise.resolve(),closed=false,closing;
  const root=name=>join(directory,name);
  async function stored() {
    const value=await readJson(root('workspace.json'),STATE_BYTES);
    if(value.schema!==WORKSPACE_SCHEMA||!UUID.test(value.id??'')||!Number.isSafeInteger(value.revision)||
       ['sources','mappings','editions','merchants','exports','products','operations','packets'].some(key=>!Array.isArray(value[key])))
      fail('WORDPRESS_WORKSPACE_STATE','The original workspace record is invalid.',409);
    return value;
  }
  async function commit(value) {value.revision++;value.updatedAt=now();await atomicJson(directory,'workspace.json',value);return value;}
  async function sourceRecord(sourceId,current) {
    const value=current??await stored(),row=value.sources.find(item=>item.id===id(sourceId));
    if(!row)fail('WORDPRESS_SOURCE_NOT_FOUND','Select a saved WordPress source.',404);
    const raw=await readPrivate(join(root('sources'),row.id+'.json'),1048576);
    if(sha256(raw)!==row.fileSha256)fail('WORDPRESS_SOURCE_CHANGED','The original source declaration has changed.',409);
    const source=validateSource(JSON.parse(raw));
    if(identity(source)!==row.sourceSha256)fail('WORDPRESS_SOURCE_CHANGED','The original source identity has changed.',409);
    return {...row,source};
  }
  async function sourceFor(sourceId) {
    const selected=await sourceRecord(sourceId),key=selected.sourceSha256;
    if(!sources.has(key))sources.set(key,openWordPressSource({directory:join(root('cache'),key),source:selected.source,environment,fetchImpl,onEvent}));
    try{return await sources.get(key);}catch(error){sources.delete(key);throw error;}
  }
  async function captureRecord(sourceId,captureId) {return (await sourceFor(sourceId)).inspect(id(captureId));}
  async function mappingRecord(mappingId,current) {
    const value=current??await stored(),selected=value.mappings.find(item=>item.id===id(mappingId));
    if(!selected)fail('WORDPRESS_MAPPING_NOT_FOUND','Select a saved native projection.',404);
    const raw=await readPrivate(join(root('mappings'),mappingId+'.json'),1048576);
    if(sha256(raw)!==selected.fileSha256)fail('WORDPRESS_MAPPING_CHANGED','The original projection has changed.',409);
    return JSON.parse(raw);
  }
  async function editionRecord(editionId,current) {
    const value=current??await stored(),selected=value.editions.find(item=>item.id===id(editionId));
    if(!selected)fail('WORDPRESS_EDITION_NOT_FOUND','Select a completed native edition.',404);
    const record=await readEdition(join(root('editions'),editionId));
    if(record.dataset.snapshot!==selected.snapshot||record.intentSha256!==selected.intentSha256)
      fail('WORDPRESS_EDITION_CHANGED','The original edition identity has changed.',409);
    return {...record,id:editionId,sourceId:selected.sourceId,mappingId:selected.mappingId};
  }
  async function publisherFor(productId,create=false) {
    id(productId);
    if(!(await stored()).products.some(row=>row.id===productId))fail('WORDPRESS_PRODUCT_NOT_FOUND','Select the retained product.',404);
    const location=join(root('publishers'),productId);
    if(!create&&!await exists(join(location,'drafts')))return null;
    if(!publishers.has(productId))publishers.set(productId,openSocrataPublisher({directory:location}));
    try{return await publishers.get(productId);}catch(error){publishers.delete(productId);throw error;}
  }
  async function inspect() {
    const value=await stored(),jobs=[];
    for(const source of value.sources) {
      const engine=await sourceFor(source.id);
      for(const job of await engine.list())jobs.push({...job,sourceId:source.id});
    }
    const selected=value.activeSourceId?await sourceRecord(value.activeSourceId,value):null;
    let publisher=null;
    if(value.activeProductId){const original=await publisherFor(value.activeProductId);if(original)publisher=await original.state();}
    return {...value,directory,source:selected?.source??null,jobs,
      environment:selected?credentialReferences(selected.source).map(name=>({name,configured:typeof environment[name]==='string'&&!!environment[name]})):[],
      exports:value.exports.map(row=>({...row,directory:join(root('exports'),row.id),files:row.files.map(file=>({...file,name:file.path}))})),
      publisher,running:[...active].map(([id,row])=>({id,action:row.action,startedAt:row.startedAt})),
      operations:value.operations.slice(-100).reverse()};
  }
  async function productForExport(input,operation,current) {
    if(input.productId) {
      const existing=current.products.find(row=>row.id===id(input.productId));
      if(!existing)fail('WORDPRESS_PRODUCT_NOT_FOUND','Select the original publisher product.',404);
      return existing;
    }
    return {id:operation.id,label:text(input.productLabel??'WordPress data product',160,'the product label'),createdAt:operation.createdAt};
  }
  async function exportEdition(input,operation,current) {
    const edition=await editionRecord(input.editionId,current),merchant=current.merchants.find(row=>row.id===id(input.merchantId));
    if(!merchant)fail('WORDPRESS_MERCHANT_NOT_FOUND','Select saved original merchant terms.',404);
    text(input.reviewer,160,'the export reviewer');text(input.note??'',4000,'the export note',true);
    const native=await loadDatasetConfig(join(edition.directory,'dataset.json')),
      seller=await buildDatasetSellerConfig(native,{origin:merchant.origin,path:merchant.path,payment:merchant.payment}),
      location=join(root('exports'),operation.id),files=[],sourceFiles=[];
    await privateDirectory(location,true);
    for(const name of ['dataset.csv','dataset.json'])files.push({path:name,...await copied(join(edition.directory,name),join(location,name))});
    const mapping=await mappingRecord(edition.mappingId,current),selected=await sourceRecord(edition.sourceId,current),
      engine=await sourceFor(edition.sourceId),capture=await engine.completion(edition.captureId);
    if(capture.sha256!==edition.captureSha256)fail('WORDPRESS_EXPORT_CAPTURE','The edition and retained source capture differ.',409);
    const retain=async(name)=>{
      const member='wordpress/'+name;
      sourceFiles.push({path:member,...await copied(root(name),join(location,member))});
    };
    await retain('sources/'+selected.id+'.json');await retain('mappings/'+mapping.id+'.json');await retain('merchants/'+merchant.id+'.json');
    const cache='cache/'+selected.sourceSha256;
    await retain(cache+'/source.json');
    const captureState=await engine.inspect(edition.captureId);
    for(const jobId of [captureState.intent.input.discoveryId,edition.captureId]) {
      const prefix=cache+'/jobs/'+jobId;
      for(const file of await inventory(root(prefix)))await retain(prefix+'/'+file.path);
    }
    for(const file of await inventory(edition.directory))await retain('editions/'+edition.id+'/'+file.path);
    sourceFiles.sort((a,b)=>a.path.localeCompare(b.path));
    await readDatasetSourceFiles(location,{sourceFiles});
    const originalSource=await readJson(join(edition.directory,'source.json'),1048576),source={...originalSource,sourceFiles};
    await immutableJson(join(location,'source.json'),source);await immutableJson(join(location,'seller.json'),seller);
    for(const name of ['source.json','seller.json']){const row=await hashPrivate(join(location,name),name==='source.json'?2097152:1048576);files.push({path:name,bytes:row.bytes,sha256:row.hash});}
    files.push(...sourceFiles);
    const product=await productForExport(input,operation,current);
    const record={id:operation.id,delivery:'content',createdAt:operation.createdAt,editionId:edition.id,sourceId:edition.sourceId,
      captureId:edition.captureId,captureSha256:edition.captureSha256,merchantId:merchant.id,productId:product.id,
      snapshot:edition.dataset.snapshot,reviewer:input.reviewer,note:input.note??'',files};
    await immutableJson(join(location,'manifest.json'),record,RESULT_BYTES);
    return {result:record,apply:value=>{
      if(!value.products.some(row=>row.id===product.id))value.products.push(product);
      if(!value.exports.some(row=>row.id===record.id))value.exports.push(record);
      value.activeProductId=product.id;
    }};
  }
  async function dispatch(action,input,operation,signal) {
    const current=await stored(),sourceId=operation.sourceId;
    switch(action) {
      case 'source.save': {
        only(input,['source'],'source save');
        const source=validateSource(input.source),raw=jsonBytes(source),
          record={id:operation.id,createdAt:operation.createdAt,label:source.label,apiRoot:source.apiRoot,
            context:source.context,sourceSha256:identity(source),fileSha256:sha256(raw)};
        await immutableJson(join(root('sources'),record.id+'.json'),source);
        return {result:record,apply:value=>{if(!value.sources.some(row=>row.id===record.id))value.sources.push(record);value.activeSourceId=record.id;}};
      }
      case 'source.select': {
        only(input,['sourceId'],'source selection');await sourceRecord(input.sourceId,current);
        return {result:{sourceId:input.sourceId},apply:value=>{value.activeSourceId=input.sourceId;}};
      }
      case 'source.discover':
      case 'capture.start': {
        only(input,action==='source.discover'?['sourceId']:['sourceId','discoveryId','selection'],'source capture');
        if(!sourceId)fail('WORDPRESS_SOURCE_REQUIRED','Save and select the original WordPress REST source.');
        const engine=await sourceFor(sourceId),job=await engine.create({id:operation.id,kind:action==='source.discover'?'discovery':'capture',
          ...(action==='capture.start'?{discoveryId:input.discoveryId,selection:input.selection}:{})});
        const start=engine.run(job.id);
        return {result:{sourceId,jobId:job.id,...start},apply:value=>{value.activeSourceId=sourceId;}};
      }
      case 'capture.resume':
      case 'capture.pause': {
        only(input,['sourceId','captureId'],'original capture continuation');
        const engine=await sourceFor(sourceId);
        await engine.inspect(id(input.captureId));
        const result=action==='capture.resume'?engine.run(id(input.captureId)):await engine.cancel(id(input.captureId));
        return {result:{sourceId,jobId:input.captureId,...result}};
      }
      case 'mapping.save': {
        only(input,['sourceId','captureId','expectedCaptureSha256','projection'],'projection');
        const capture=await(await sourceFor(sourceId)).completion(id(input.captureId));
        if(capture.sha256!==input.expectedCaptureSha256)fail('WORDPRESS_MAPPING_REVIEW','Select the exact completed source capture.',409);
        const projection=validateProjection(input.projection,capture),
          record={id:operation.id,sourceId,captureId:input.captureId,captureSha256:capture.sha256,
            projection,projectionHash:identity(projection),createdAt:operation.createdAt};
        const result=await immutableJson(join(root('mappings'),record.id+'.json'),record);
        return {result:record,apply:value=>{if(!value.mappings.some(row=>row.id===record.id))value.mappings.push({...record,fileSha256:result.sha256});}};
      }
      case 'edition.build': {
        only(input,['mappingId','dataset','review'],'edition build');
        const mapping=await mappingRecord(input.mappingId,current),engine=await sourceFor(mapping.sourceId),
          edition=await buildEdition({source:engine,captureId:mapping.captureId,projection:mapping.projection,
            dataset:input.dataset,review:input.review,destination:join(root('editions'),operation.id),signal}),
          record={id:operation.id,sourceId:mapping.sourceId,mappingId:mapping.id,captureId:mapping.captureId,
            captureSha256:mapping.captureSha256,snapshot:edition.dataset.snapshot,intentSha256:edition.intentSha256,
            name:edition.dataset.name??input.dataset.name,rowCount:edition.rowCount,csvBytes:edition.csvBytes,createdAt:operation.createdAt};
        return {result:{...edition,id:operation.id},apply:value=>{if(!value.editions.some(row=>row.id===record.id))value.editions.push(record);}};
      }
      case 'merchant.save': {
        only(input,['editionId','origin','path','payment','reviewer','note'],'merchant terms');
        const edition=await editionRecord(input.editionId,current),native=await loadDatasetConfig(join(edition.directory,'dataset.json'));
        await buildDatasetSellerConfig(native,{origin:input.origin,path:input.path,payment:input.payment});
        const record={id:operation.id,origin:input.origin,path:input.path,payment:clone(input.payment),
          reviewer:text(input.reviewer,160,'the merchant reviewer'),note:text(input.note??'',4000,'the merchant note',true),createdAt:operation.createdAt};
        await immutableJson(join(root('merchants'),record.id+'.json'),record);
        return {result:record,apply:value=>{if(!value.merchants.some(row=>row.id===record.id))value.merchants.push(record);}};
      }
      case 'edition.export': {
        only(input,['editionId','merchantId','productId','productLabel','reviewer','note'],'edition export');
        return exportEdition(input,operation,current);
      }
      case 'product.select': {
        only(input,['productId'],'product selection');
        if(!current.products.some(row=>row.id===id(input.productId)))fail('WORDPRESS_PRODUCT_NOT_FOUND','Select the original product.',404);
        return {result:{productId:input.productId},apply:value=>{value.activeProductId=input.productId;}};
      }
      case 'source.packet': {
        only(input,[],'source packet');
        for(const selected of current.sources){const jobs=await(await sourceFor(selected.id)).list();if(jobs.some(row=>row.active))fail('WORDPRESS_CAPTURE_ACTIVE','Pause the current source capture before exporting its portable cursor.',409);}
        const output=join(root('packets'),operation.id+'.zip');
        let result;
        if(await exists(output)) {
          result=await packet('inspect',{input:output,python,signal});
          if(result.workspaceId!==current.id||result.manifest.operationId!==operation.id||result.manifest.createdAt!==operation.createdAt)
            fail('WORDPRESS_PACKET_OPERATION_CHANGED','The retained packet belongs to a different original export.',409);
        } else {
          const check=await hashPrivate(root('workspace.json'),STATE_BYTES);
          result=await packet('create',{directory,output,python,signal,
            request:{workspaceId:current.id,revision:current.revision,workspaceSha256:check.hash,createdAt:operation.createdAt,operationId:operation.id}});
        }
        const record={id:operation.id,createdAt:operation.createdAt,sha256:result.sha256,bytes:result.bytes,
          manifestSha256:result.manifestSha256,workspaceId:result.workspaceId,revision:result.revision,files:result.files,sourceBytes:result.sourceBytes};
        return {result:record,apply:value=>{if(!value.packets.some(row=>row.id===record.id))value.packets.push(record);}};
      }
      case 'source.files': {
        only(input,['packetId','merchantId','productId','productLabel','name','reviewer','note'],'complete-source product');
        const selected=current.packets.find(row=>row.id===id(input.packetId)),merchant=current.merchants.find(row=>row.id===id(input.merchantId));
        if(!selected||!merchant)fail('WORDPRESS_SOURCE_PRODUCT_INPUT','Select the complete packet and original merchant terms.');
        text(input.reviewer,160,'the source-file product reviewer');text(input.note??'',4000,'the source-file review note',true);
        const location=join(root('exports'),operation.id);await privateDirectory(location,true);
        const result=await packet('project',{input:join(root('packets'),selected.id+'.zip'),directory:location,python,signal});
        if(result.captureId!==selected.manifestSha256)fail('WORDPRESS_SOURCE_PACKET_CHANGED','The selected complete packet has changed.',409);
        const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name:text(input.name,128,'the source-file dataset name'),
          columns:Object.fromEntries(result.columns.map(name=>[name,{type:['file_bytes','chunk_index','chunk_count'].includes(name)?'integer':'string',nullable:false}])),
          filters:['path'],ranges:[],sorts:[],maxBytes:268435456,maxRows:1000000,maxCellChars:65536,defaultLimit:8,maxLimit:10,maxPageBytes:921600};
        await immutableJson(join(location,'dataset.json'),config);
        const native=await loadDatasetConfig(join(location,'dataset.json')),seller=await buildDatasetSellerConfig(native,{
          origin:merchant.origin,path:merchant.path,payment:merchant.payment}),
          source={schema:'stellar-forge.wordpress-complete-source.v1',captureId:result.captureId,workspaceId:result.workspaceId,
            manifest:result.manifest,packetId:selected.id,packetSha256:selected.sha256,
            review:{reviewer:input.reviewer,note:input.note??'',reviewedManifestSha256:result.captureId},receiver:'wordpress.source_files.restore_wordpress_source'};
        await immutableJson(join(location,'source.json'),source,STATE_BYTES);await immutableJson(join(location,'seller.json'),seller);
        const files=[];for(const name of ['dataset.csv','dataset.json','source.json','seller.json']){const row=await hashPrivate(join(location,name),268435456);files.push({path:name,bytes:row.bytes,sha256:row.hash});}
        const product=await productForExport(input,operation,current),record={id:operation.id,delivery:'source-files',createdAt:operation.createdAt,
          packetId:selected.id,captureSha256:result.captureId,merchantId:merchant.id,productId:product.id,
          snapshot:native.describe().snapshot,rowCount:result.rows,reviewer:input.reviewer,note:input.note??'',files};
        await immutableJson(join(location,'manifest.json'),record);
        return {result:record,apply:value=>{if(!value.products.some(row=>row.id===product.id))value.products.push(product);
          if(!value.exports.some(row=>row.id===record.id))value.exports.push(record);value.activeProductId=product.id;}};
      }
      default: {
        if(!action.startsWith('publisher.'))fail('WORDPRESS_ACTION','Select an existing source or publisher action.',404);
        const productId=input.productId??current.activeProductId,payload={...input};delete payload.productId;
        if(!productId)fail('WORDPRESS_PRODUCT_REQUIRED','Export and select a reviewed product first.');
        if(action==='publisher.prepare') {
          const selected=current.exports.find(row=>join(root('exports'),row.id)===payload.exportDirectory&&row.productId===productId);
          if(!selected)fail('WORDPRESS_PUBLISHER_EXPORT','Select an original export belonging to this product.');
        }
        const original=await publisherFor(productId,true),result=await original.act(action,payload);
        return {result:result.result,apply:value=>{value.activeProductId=productId;}};
      }
    }
  }
  async function operationRecord(operationId) {
    const current=await stored(),row=current.operations.find(item=>item.id===id(operationId));
    if(!row)fail('WORDPRESS_OPERATION_NOT_FOUND','This workspace has no retained operation with that ID.',404);
    const retained=await readJson(join(root('operations'),row.id+'.intent.json'),1048576);
    if(identity({action:retained.action,input:retained.input})!==row.intentSha256)fail('WORDPRESS_OPERATION_CHANGED','The retained original operation has changed.',409);
    let result=null;
    if(row.resultSha256) {
      const raw=await readPrivate(join(root('operations'),row.id+'.result.json'),RESULT_BYTES);
      if(sha256(raw)!==row.resultSha256)fail('WORDPRESS_OPERATION_CHANGED','The retained original result has changed.',409);
      const envelope=JSON.parse(raw);
      if(envelope.schema!=='stellar-forge.wordpress-operation-result.v1'||envelope.intentSha256!==row.intentSha256)
        fail('WORDPRESS_OPERATION_CHANGED','The saved operation result has different original input.',409);
      result=envelope.result;
    }
    return {operation:{...row,input:retained.input},result,active:active.has(row.id)};
  }
  const mutationKeys=['sources','mappings','editions','merchants','exports','products','packets'];
  function mutation(before,after) {
    const result={upsert:{},select:{}};
    for(const key of mutationKeys) {
      const previous=new Map(before[key].map(row=>[row.id,identity(row)]));
      const changed=after[key].filter(row=>previous.get(row.id)!==identity(row));
      if(changed.length)result.upsert[key]=changed;
    }
    for(const key of ['activeSourceId','activeProductId'])if(before[key]!==after[key])result.select[key]=after[key];
    return result;
  }
  function applyMutation(value,patch) {
    for(const [key,rows] of Object.entries(patch.upsert??{})) {
      if(!mutationKeys.includes(key)||!Array.isArray(rows))fail('WORDPRESS_OPERATION_CHANGED','The retained source result has an invalid state join.',409);
      for(const row of rows) {
        id(row.id);const found=value[key].findIndex(item=>item.id===row.id);
        if(found===-1)value[key].push(row);
        else if(identity(value[key][found])!==identity(row))fail('WORDPRESS_OPERATION_STATE_CONFLICT','The retained record changed after this original operation.',409,{key,id:row.id});
      }
    }
    for(const [key,selected] of Object.entries(patch.select??{})) {
      if(!['activeSourceId','activeProductId'].includes(key))fail('WORDPRESS_OPERATION_CHANGED','The retained source selection is invalid.',409);
      value[key]=selected;
    }
  }
  async function finishResult(operationId,envelope,reused=false) {
    const current=await stored(),saved=current.operations.find(row=>row.id===operationId);
    if(!saved||envelope.schema!=='stellar-forge.wordpress-operation-result.v1'||envelope.intentSha256!==saved.intentSha256)
      fail('WORDPRESS_OPERATION_CHANGED','The retained source result belongs to different original input.',409);
    applyMutation(current,envelope.mutation);
    const actual=await hashPrivate(join(root('operations'),operationId+'.result.json'),RESULT_BYTES);
    saved.status='complete';saved.completedAt=envelope.completedAt;saved.error=null;saved.resultSha256=actual.hash;
    await commit(current);
    return {operation:clone(saved),result:envelope.result,state:await inspect(),reused};
  }
  async function execute(action,{operationId,expectedRevision,input={}}={}) {
    if(closed)fail('WORDPRESS_WORKSPACE_CLOSED','The original workspace is closed.',409);
    id(operationId);text(action,120,'the original operation name');only(input,Object.keys(input),'operation input');
    let current=await stored(),record=current.operations.find(row=>row.id===operationId),intentSha256=identity({action,input});
    if(record) {
      if(record.intentSha256!==intentSha256)fail('WORDPRESS_OPERATION_ID_REUSED','This operation UUID belongs to a different original request.',409);
      const retained=await operationRecord(operationId);
      if(record.status==='complete')return {...retained,state:await inspect(),reused:true};
      if(await exists(join(root('operations'),operationId+'.result.json')))
        return finishResult(operationId,await readJson(join(root('operations'),operationId+'.result.json'),RESULT_BYTES),true);
      if(!recoverable.has(action))fail('WORDPRESS_ORIGINAL_PUBLICATION_RECOVERY','Inspect the original publisher state and recover its saved request or session.',409,{operationId});
    } else {
      if(expectedRevision!==current.revision)fail('WORDPRESS_WORKSPACE_REVISION','Reload the current original workspace before saving.',409);
      record={id:operationId,action,intentSha256,createdAt:now(),sourceId:input.sourceId??current.activeSourceId,
        status:'running',error:null};
      const path=join(root('operations'),operationId+'.intent.json');
      if(await exists(path)) {
        const saved=await readJson(path,1048576);
        if(identity({action:saved.action,input:saved.input})!==intentSha256)fail('WORDPRESS_OPERATION_ID_REUSED','The retained intent has different original input.',409);
        record={...record,createdAt:saved.createdAt,sourceId:saved.sourceId};
      } else await immutableJson(path,{...record,input});
      current.operations.push(record);await commit(current);
    }
    const controller=new AbortController();active.set(operationId,{controller,action,startedAt:now()});
    try {
      const outcome=await dispatch(action,input,record,controller.signal);
      current=await stored();const joined=clone(current);outcome.apply?.(joined);
      const envelope={schema:'stellar-forge.wordpress-operation-result.v1',intentSha256,result:outcome.result??null,
        mutation:mutation(current,joined),completedAt:now()};
      await immutableJson(join(root('operations'),operationId+'.result.json'),envelope,RESULT_BYTES);
      return finishResult(operationId,envelope);
    } catch(error) {
      current=await stored();const saved=current.operations.find(row=>row.id===operationId);
      saved.status=controller.signal.aborted?'interrupted':'attention';saved.error=errorRecord(error);saved.updatedAt=now();await commit(current);
      throw error;
    } finally {active.delete(operationId);}
  }
  function act(action,payload) {
    if(closed)return Promise.reject(new Error('WORDPRESS_WORKSPACE_CLOSED'));
    const operation=tail.catch(()=>{}).then(()=>execute(action,payload));tail=operation;return operation;
  }
  async function cancel(operationId) {const row=active.get(id(operationId));row?.controller.abort();return {operationId,cancelling:!!row};}
  async function preview({sourceId,captureId,projection,offset=0,limit=20}) {
    return projectionPreview(await sourceFor(sourceId),id(captureId),projection,{offset,limit});
  }
  async function datasetPreview({editionId,query=''}) {
    text(query,8192,'the original dataset query',true);
    const edition=await editionRecord(editionId),native=await loadDatasetConfig(join(edition.directory,'dataset.json')),
      context={query:new URLSearchParams(query.replace(/^\?/,''))},admission=await native.admit(context);
    return {editionId,snapshot:edition.dataset.snapshot,...(admission===true?await native.handle(context):admission)};
  }
  async function download(kind,recordId,name,sourceId) {
    let path,expected,filename=name,contentType='application/json';
    if(kind==='source'){const row=await sourceRecord(recordId);path=join(root('sources'),row.id+'.json');expected=row.fileSha256;filename='wordpress-source-connection.json';}
    else if(kind==='response') {
      const source=await sourceRecord(sourceId),engine=await sourceFor(sourceId),value=await engine.inspect(id(recordId)),
        sequence=integer(Number(name),1,value.responseCount,'the original response sequence'),
        selected=value.responses.find(row=>row.sequence===sequence);
      path=join(root('cache'),source.sourceSha256,'jobs',recordId,selected.file);expected=selected.fileSha256;filename='wordpress-response-'+sequence+'.json';
    } else if(kind==='edition') {
      await editionRecord(recordId);
      if(!['dataset.csv','dataset.json','source.json','edition.json','records.json'].includes(name))fail('WORDPRESS_DOWNLOAD_FILE','Select an original edition member.');
      path=join(root('editions'),recordId,name);
    } else if(kind==='export') {
      const row=(await stored()).exports.find(item=>item.id===id(recordId));
      if(!row)fail('WORDPRESS_EXPORT_NOT_FOUND','Select a completed export.',404);
      const member=row.files.find(item=>item.path===name);
      if(!member)fail('WORDPRESS_EXPORT_MEMBER','Select a declared exported file.',404);
      path=join(root('exports'),recordId,member.path);expected=member.sha256;filename=member.path.replaceAll('/','-');
    } else if(kind==='packet') {
      const row=(await stored()).packets.find(item=>item.id===id(recordId));
      if(!row)fail('WORDPRESS_PACKET_NOT_FOUND','Select the completed portable source packet.',404);
      path=join(root('packets'),recordId+'.zip');expected=row.sha256;filename='wordpress-source-'+recordId+'.zip';contentType='application/zip';
    } else fail('WORDPRESS_DOWNLOAD_KIND','Select an original retained file.',404);
    const actual=await hashPrivate(path,kind==='packet'?4362076160:536870912);
    if(expected&&actual.hash!==expected)fail('WORDPRESS_DOWNLOAD_CHANGED','The retained download no longer matches its original hash.',409);
    if(filename?.endsWith('.csv'))contentType='text/csv; charset=utf-8';
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    return {handle,size:actual.bytes,sha256:actual.hash,filename,contentType};
  }
  async function publisherDownload(productId,kind,recordId) {
    const original=await publisherFor(productId);
    if(!original)fail('WORDPRESS_PUBLISHER_REQUIRED','Prepare this product at its selected host.',409);
    return original.readExport(kind,recordId);
  }
  const close=()=>closing??=(async()=>{
    closed=true;for(const row of active.values())row.controller.abort();
    // Source jobs are independent of a completed launch request and drain first.
    const resources=await Promise.allSettled([...sources.values()]);
    await Promise.allSettled(resources.filter(row=>row.status==='fulfilled').map(row=>row.value.close()));
    await tail.catch(()=>{});
    const remaining=await Promise.allSettled([...sources.values()]);
    await Promise.allSettled(remaining.filter(row=>row.status==='fulfilled').map(row=>row.value.close()));
    const original=await Promise.allSettled([...publishers.values()]);
    try {await Promise.all(original.filter(row=>row.status==='fulfilled').map(row=>row.value.close()));}
    finally {await release();}
  })();
  try {
    for(const name of ['sources','cache','mappings','editions','merchants','exports','publishers','packets','operations'])await privateDirectory(root(name),true);
    if(!await exists(root('workspace.json'))&&(expectedWorkspaceId!==undefined||expectedWorkspaceIdentity!==undefined))
      fail('WORDPRESS_WORKSPACE_BINDING_CHANGED','The selected original workspace is no longer present.',409);
    if(!await exists(root('workspace.json')))await atomicJson(directory,'workspace.json',{
      schema:WORKSPACE_SCHEMA,id:newId(),revision:0,createdAt:now(),updatedAt:now(),activeSourceId:null,activeProductId:null,
      sources:[],mappings:[],editions:[],merchants:[],exports:[],products:[],operations:[],packets:[]});
    await stored();
    await inspectWordPressWorkspaceBinding(directory,{expectedWorkspaceId,expectedWorkspaceIdentity});
  } catch(error){await close();throw error;}
  return {directory,inspect,health:async()=>{const value=await stored();return {workspaceId:value.id,revision:value.revision,createdAt:value.createdAt,workspaceIdentity:identity({schema:WORKSPACE_SCHEMA,id:value.id,createdAt:value.createdAt})};},act,cancel,operation:operationRecord,preview,datasetPreview,download,publisherDownload,
    source:sourceRecord,job:captureRecord,wait:async(sourceId,captureId)=>(await sourceFor(sourceId)).wait(id(captureId)),mapping:mappingRecord,edition:editionRecord,
    records:async(sourceId,captureId,options)=>(await sourceFor(sourceId)).sample(id(captureId),options),
    suggestedProjection:async(sourceId,captureId)=>suggestedProjection(await(await sourceFor(sourceId)).completion(id(captureId))),
    response:async(sourceId,captureId,sequence)=>(await sourceFor(sourceId)).response(id(captureId),sequence),
    compare:async(beforeId,afterId,options)=>{await editionRecord(beforeId);await editionRecord(afterId);
      return compareEditions(join(root('editions'),beforeId),join(root('editions'),afterId),options);},
    close};
}
