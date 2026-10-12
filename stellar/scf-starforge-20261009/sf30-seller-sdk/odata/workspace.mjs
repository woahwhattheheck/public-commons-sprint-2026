// MIT. Service discovery, reviewed queries, resumable editions and receiving packages.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { discoverService, compileQuery, fetchPage } from './source.mjs';
import { acquireReleaseLease } from '../../sf82-seller-pilot/release-process.mjs';
import { openState, atomic, readJson, retain, writeNew, identifier, digest, stable, formatted, fault, now } from './state.mjs';

const copy = value => structuredClone(value);
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const publicError = error => ({ code: error.code || 'ODATA_OPERATION_FAILED', message: error.message });
export function fieldValue(row, path) {
  let current = row;
  for (const part of path.split('/')) {
    if (current === null) return { state: 'null', value: null };
    if (!own(current, part)) return { state: 'missing', value: null };
    current = current[part];
  }
  return { state: current === null ? 'null' : 'value', value: current };
}
export function rowKey(row, fields) {
  const values = fields.map(path => fieldValue(row, path));
  if (values.some(value => value.state !== 'value')) throw fault('ODATA_ENTITY_KEY', 'An entity is missing a complete non-null key.', 422);
  return stable(values.map(value => value.value));
}
function find(rows, id, label) {
  const result = rows.find(value => value.id === id);
  if (!result) throw fault('ODATA_NOT_FOUND', label + ' does not exist.', 404);
  return result;
}
const entityName = value => typeof value === 'string' ? value : value.name;
const catalogIdentity = catalog => digest(stable({serviceUrl:catalog.serviceUrl,
  service:catalog.receipts.service.sha256,metadata:catalog.receipts.metadata.sha256}));
function summary(edition) {
  const { pages, catalog, query, ...result } = edition;
  return { ...result, pageCount: pages.length, nextLink: edition.nextLink, queryUrl: query.url,
    entitySet: entityName(query.entitySet), keyFields: query.keyFields, fields: query.fields };
}
function columnName(path, used) {
  let name = path.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z]/.test(name) || ['constructor','prototype','__proto__'].includes(name)) name = 'field_' + name;
  name = name.slice(0, 35);
  if (used.has(name) || used.has(name + '_state')) name = name.slice(0, 26) + '_' + digest(path).slice(0, 8);
  if (used.has(name) || used.has(name + '_state')) throw fault('ODATA_COLUMN_COLLISION', 'Choose distinct exposed column names.');
  used.add(name); used.add(name + '_state'); return name;
}
function csvCell(value) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? stable(value) : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"','""') + '"' : text;
}
function datasetType(field) {
  if (field.collection) return 'string';
  if (['Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32'].includes(field.type)) return 'integer';
  if (['Edm.Single','Edm.Double'].includes(field.type)) return 'number';
  if (field.type === 'Edm.Boolean') return 'boolean';
  return 'string';
}

export async function openODataWorkspace({ directory, fetchImpl = globalThis.fetch } = {}) {
  if (!directory) throw fault('ODATA_WORKSPACE_REQUIRED', 'Choose a retained workspace directory.');
  const store = await openState(directory), root = store.directory, running = new Map(), completions = new Map();
  let closed = false;
  async function raw(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw fault('ODATA_SOURCE_ID', 'Invalid retained source identity.');
    const bytes = await readFile(join(root,'sources',hash));
    if (digest(bytes) !== hash) throw fault('ODATA_SOURCE_CHANGED', 'The retained source bytes changed.', 409);
    return bytes;
  }
  async function retainCatalog(catalog) {
    const result = copy(catalog);
    for (const receipt of Object.values(result.receipts || {})) {
      const encoded = receipt.rawBase64 ?? receipt.bodyBase64;
      if (encoded) {
        const source = await retain(join(root,'sources'),Buffer.from(encoded,'base64'));
        if (receipt.sha256 && receipt.sha256 !== source.sha256) throw fault('ODATA_METADATA_HASH', 'The service metadata source hash differs.', 409);
        Object.assign(receipt,source); delete receipt.rawBase64; delete receipt.bodyBase64;
      }
    }
    return result;
  }
  async function state() {
    const result = await store.read();
    return { ...result, liveProducts:result.liveProducts||[], editions: result.editions.map(summary), running: [...running.keys()] };
  }
  async function connect(input) {
    if (closed) throw fault('ODATA_CLOSED','Reopen the workspace.');
    const id = identifier(input.id || randomUUID(),'connection ID');
    const catalog = await retainCatalog(await discoverService({ url: input.url, authEnv: input.authEnv,
      fetchImpl, signal: input.signal, allowLoopback: input.allowLoopback === true }));
    return store.mutate(state => {
      if (state.connections.some(value => value.id === id)) throw fault('ODATA_CONNECTION_EXISTS','Use the existing connection or choose a new connection ID.',409);
      const record = { id, name: String(input.name || id).slice(0,128), url: catalog.serviceUrl,
        authEnv: input.authEnv || null, allowLoopback: input.allowLoopback === true, catalog,
        catalogHash: catalogIdentity(catalog), createdAt: now() };
      state.connections.push(record); return copy(record);
    });
  }
  async function refreshConnection(id) {
    const current = find((await store.read()).connections,id,'Connection');
    const catalog = await retainCatalog(await discoverService({url:current.url,authEnv:current.authEnv,
      allowLoopback:current.allowLoopback,fetchImpl}));
    return store.mutate(state => {
      const record=find(state.connections,id,'Connection');
      const unchanged=catalogIdentity(record.catalog)===catalogIdentity(catalog);
      record.catalog=catalog;if(!unchanged)record.catalogHash=catalogIdentity(catalog);record.refreshedAt=now();return copy(record);
    });
  }
  async function plan(input) {
    const current=await store.read(),connection=find(current.connections,input.connectionId,'Connection');
    const compiled=compileQuery(connection.catalog,input.query);
    const id=identifier(input.id || randomUUID(),'plan ID');
    return store.mutate(state => {
      if(state.plans.some(value=>value.id===id)) throw fault('ODATA_PLAN_EXISTS','A retained plan already has this ID; create a new revision with another ID.',409);
      const record={id,name:String(input.name||id).slice(0,128),connectionId:connection.id,catalogHash:connection.catalogHash,
        query:copy(compiled),createdAt:now(),reviewedAt:null,reviewNote:null};state.plans.push(record);return copy(record);
    });
  }
  async function reviewPlan({id,note}) {
    if(typeof note!=='string'||!note.trim()) throw fault('ODATA_REVIEW_NOTE','Describe the intended query scope.');
    return store.mutate(state=>{const record=find(state.plans,id,'Plan');record.reviewedAt=now();record.reviewNote=note.trim().slice(0,4000);return copy(record);});
  }
  async function edition(id) { return copy(find((await store.read()).editions,identifier(id),'Edition')); }
  async function rows(id) {
    const record=await edition(id),result=[];
    for(const page of record.pages){
      const data=JSON.parse(await raw(page.rowsSha256));
      if(!Array.isArray(data)||data.length!==page.rowCount) throw fault('ODATA_ROWS_CHANGED','The retained normalized page differs.',409);
      result.push(...data);
    }
    return result;
  }
  async function startCapture({planId,label}) {
    return store.mutate(state=>{
      const selected=find(state.plans,planId,'Plan'),connection=find(state.connections,selected.connectionId,'Connection');
      if(!selected.reviewedAt) throw fault('ODATA_QUERY_REVIEW','Review the displayed query before importing its records.',409);
      if(connection.catalogHash!==selected.catalogHash) throw fault('ODATA_CATALOG_CHANGED','The service schema changed. Create and review a new plan from its current metadata.',409);
      const record={id:randomUUID(),label:String(label||selected.name).slice(0,128),planId,connectionId:connection.id,
        catalog:copy(connection.catalog),catalogHash:connection.catalogHash,query:copy(selected.query),reviewNote:selected.reviewNote,
        createdAt:now(),status:'PAUSED',pages:[],rowCount:0,sourceCount:null,nextLink:selected.query.url,
        completedAt:null,error:null,decisions:[]};state.editions.push(record);return summary(record);
    });
  }
  async function capture(id,{pageBudget=10000,signal}={}) {
    id=identifier(id);
    if(closed)throw fault('ODATA_CLOSED','Reopen the workspace.');
    if(!Number.isSafeInteger(pageBudget)||pageBudget<1||pageBudget>100000) throw fault('ODATA_PAGE_BUDGET','Pages per import step must be from 1 to 100000.');
    if(running.has(id)) throw fault('ODATA_CAPTURE_RUNNING','This edition is already importing.',409);
    const control=new AbortController();running.set(id,control);
    let finished;completions.set(id,new Promise(resolve=>{finished=resolve;}));
    const combined=signal?AbortSignal.any([signal,control.signal]):control.signal;
    let lease,ownsCapture=false;
    try {
      let selected=await edition(id);
      if(selected.status==='COMPLETE') return summary(selected);
      const lockDirectory=join(root,'editions',id);await mkdir(lockDirectory,{recursive:true,mode:0o700});
      lease=await acquireReleaseLease(lockDirectory,'run.lock');ownsCapture=true;
      selected=await edition(id);if(selected.status==='COMPLETE')return summary(selected);
      const connection=find((await store.read()).connections,selected.connectionId,'Connection');
      const seenKeys=new Set((await rows(id)).map(row=>rowKey(row,selected.query.keyFields)));
      await store.mutate(state=>{const record=find(state.editions,id,'Edition');record.status='IMPORTING';record.error=null;});
      for(let used=0;selected.nextLink&&used<pageBudget;used++){
        combined.throwIfAborted();
        const requested=selected.nextLink;
        const page=await fetchPage({catalog:selected.catalog,query:selected.query,url:requested,authEnv:connection.authEnv,
          allowLoopback:connection.allowLoopback,fetchImpl,signal:combined});
        const pageKeys=new Set();
        for(const row of page.rows){const key=rowKey(row,selected.query.keyFields);
          if(seenKeys.has(key)||pageKeys.has(key)) throw fault('ODATA_DUPLICATE_ENTITY','The source repeated an entity key across this query. Refresh with a stable source query.',422);
          pageKeys.add(key);}
        if(page.nextLink&&(page.nextLink===requested||selected.pages.some(prior=>prior.source.requestedUrl===page.nextLink)))
          throw fault('ODATA_CONTINUATION_LOOP','The provider returned a repeated continuation URL.',422);
        const body=await retain(join(root,'sources'),page.raw),normalized=await retain(join(root,'sources'),formatted(page.rows));
        if(page.source.sha256&&body.sha256!==page.source.sha256) throw fault('ODATA_PAGE_HASH','The captured response hash differs.',409);
        await store.mutate(state=>{
          const record=find(state.editions,id,'Edition');
          if(record.nextLink!==requested||record.pages.length!==selected.pages.length) throw fault('ODATA_CAPTURE_ADVANCED','Another importer advanced this edition; reopen its saved state.',409);
          record.pages.push({number:record.pages.length+1,source:{...page.source,requestedUrl:requested,...body},rowsSha256:normalized.sha256,
            rowCount:page.rows.length,nextLink:page.nextLink||null,status:page.status,headers:page.headers});
          record.rowCount+=page.rows.length;record.sourceCount=page.count??record.sourceCount;record.nextLink=page.nextLink||null;
          record.updatedAt=now();record.status=record.nextLink?'PAUSED':'COMPLETE';
          if(!record.nextLink){record.completedAt=now();record.contentHash=digest(stable(record.pages.map(p=>p.rowsSha256)));}
        });
        for(const key of pageKeys)seenKeys.add(key);selected=await edition(id);
      }
      return summary(await edition(id));
    }catch(error){
      if(ownsCapture)await store.mutate(state=>{const record=find(state.editions,id,'Edition');if(record.status!=='COMPLETE'){
        record.status=combined.aborted?'PAUSED':'FAILED';record.error=publicError(error);record.updatedAt=now();}});
      throw error;
    }finally{await lease?.close();running.delete(id);completions.delete(id);finished();}
  }
  async function pause(id){running.get(id)?.abort(fault('ODATA_CAPTURE_PAUSED','Import paused with its original continuation retained.'));return summary(await edition(id));}
  async function reviewEdition({id,decision,note}){
    if(!['accept','needs-work'].includes(decision)||typeof note!=='string'||!note.trim()) throw fault('ODATA_EDITION_REVIEW','Choose a decision and explain it.');
    return store.mutate(state=>{const record=find(state.editions,id,'Edition');if(record.status!=='COMPLETE')throw fault('ODATA_EDITION_INCOMPLETE','Finish the edition before its receiving review.',409);
      const review={id:randomUUID(),editionId:id,decision,note:note.trim().slice(0,4000),createdAt:now(),contentHash:record.contentHash};
      record.decisions.push(review);state.reviews.push(review);if(decision==='accept')state.activeEdition=id;
      else if(state.activeEdition===id)state.activeEdition=null;return copy(review);});
  }
  async function compare(beforeId,afterId){
    const [before,after,left,right]=await Promise.all([edition(beforeId),edition(afterId),rows(beforeId),rows(afterId)]);
    if(before.status!=='COMPLETE'||after.status!=='COMPLETE')throw fault('ODATA_COMPARE_INCOMPLETE','Compare complete source editions.',409);
    if(before.catalog.serviceUrl!==after.catalog.serviceUrl||entityName(before.query.entitySet)!==entityName(after.query.entitySet)||stable(before.query.keyFields)!==stable(after.query.keyFields))
      throw fault('ODATA_COMPARE_IDENTITY','Compare editions of the same service, entity set and keys.');
    const keys=before.query.keyFields,a=new Map(left.map(row=>[rowKey(row,keys),row])),b=new Map(right.map(row=>[rowKey(row,keys),row]));
    const added=[],removed=[],changed=[];
    const paths=[...new Set([...before.query.fields,...after.query.fields].map(field=>field.path||field.name))];
    for(const [key,value]of a){if(!b.has(key)){removed.push({key,row:value});continue;}
      const next=b.get(key),fields=paths.filter(path=>stable(fieldValue(value,path))!==stable(fieldValue(next,path)))
        .map(path=>({path,before:fieldValue(value,path),after:fieldValue(next,path)}));
      if(fields.length)changed.push({key,fields});}
    for(const [key,value]of b)if(!a.has(key))added.push({key,row:value});
    return {schema:'stellar-forge.odata-comparison.v1',beforeId,afterId,createdAt:now(),sameQuery:before.query.url===after.query.url,
      beforeRows:left.length,afterRows:right.length,added,removed,changed,
      note:before.query.url===after.query.url?'Entity changes within the same reviewed query.':'Query scope changed; added and removed rows may reflect the selected filters or limit.'};
  }
  async function exportEdition({id,name,fields,payment,origin,path='/data',defaultLimit=50,maxLimit=250}){
    const selected=await edition(id);
    if(selected.status!=='COMPLETE')throw fault('ODATA_EXPORT_INCOMPLETE','Finish the source edition before exporting.',409);
    if(selected.decisions.at(-1)?.decision!=='accept')throw fault('ODATA_EXPORT_REVIEW','Accept this edition in the receiving review before export.',409);
    const records=await rows(id),available=new Map(selected.query.fields.map(field=>[field.path||field.name,field]));
    const paths=fields?.length?[...new Set([...selected.query.keyFields,...fields])]:[...available.keys()];
    if(paths.length<1||paths.length>32||paths.some(path=>!available.has(path)))throw fault('ODATA_EXPORT_FIELDS','Select up to 32 captured properties, including the entity keys.');
    const used=new Set(),mapping=paths.map(path=>{const field=available.get(path);return {path,name:columnName(path,used),odataType:field.type,
      type:datasetType(field),collection:field.collection===true};});
    const columns={};
    for(const field of mapping){columns[field.name]={type:field.type,nullable:field.type!=='string'};columns[field.name+'_state']='string';}
    const header=mapping.flatMap(field=>[field.name,field.name+'_state']);
    const csv=Buffer.from([header.join(','),...records.map(row=>mapping.flatMap(field=>{
      const cell=fieldValue(row,field.path);let value=cell.value;
      if(cell.state==='value'&&field.type==='number'&&!Number.isFinite(Number(value)))throw fault('ODATA_NONFINITE_EXPORT','Choose text projection for a non-finite numeric property.');
      if(cell.state==='value'&&field.type==='integer'&&!Number.isSafeInteger(Number(value)))throw fault('ODATA_INTEGER_EXPORT','This integer exceeds the exact dataset range.');
      return [csvCell(cell.state==='value'?value:''),cell.state];}).join(','))].join('\n')+'\n');
    const primary=mapping.map(field=>field.name);
    const config={schema:'stellar-forge.csv-dataset.v1',name:String(name||selected.label).slice(0,128),file:'dataset.csv',columns,
      filters:primary.slice(0,8),ranges:[],sorts:primary.slice(0,8),defaultLimit,maxLimit};
    const source={schema:'stellar-forge.odata-dataset-source.v1',serviceUrl:selected.catalog.serviceUrl,entitySet:entityName(selected.query.entitySet),
      editionId:id,catalogHash:selected.catalogHash,query:selected.query.plan,queryUrl:selected.query.url,keyFields:selected.query.keyFields,
      completedAt:selected.completedAt,sourceCount:selected.sourceCount,rowCount:records.length,contentHash:selected.contentHash,
      review:selected.decisions.at(-1),mapping,pages:selected.pages,
      valueEncoding:'Every property has a state column: value, null or missing. Decimal and Int64 retain exact source text.'};
    const exportId=digest(stable({config,source,payment:payment||null,origin:origin||null,path}));
    const output=join(root,'exports',exportId);await mkdir(output,{recursive:true,mode:0o700});
    async function save(name,bytes){try{await writeNew(join(output,name),bytes);}catch(error){if(error.code!=='EEXIST')throw error;
      if(digest(await readFile(join(output,name)))!==digest(bytes))throw fault('ODATA_EXPORT_CHANGED','An existing immutable export differs.',409);}}
    await save('dataset.csv',csv);await save('dataset.json',formatted(config));await save('source.json',formatted(source));
    await save('rows.json',formatted(records));
    const {loadDatasetConfig}=await import('../dataset-handler.mjs'),dataset=await loadDatasetConfig(join(output,'dataset.json'));
    let seller=null;
    if(payment||origin){if(!payment||!origin)throw fault('ODATA_PAYMENT_CONFIG','Supply both public payment terms and public origin.');
      const {buildDatasetSellerConfig}=await import('../dataset-cli.mjs');seller=await buildDatasetSellerConfig(dataset,{payment,origin,path});await save('seller.json',formatted(seller));}
    const record={id:exportId,editionId:id,directory:output,createdAt:now(),dataset:dataset.describe(),mapping,merchant:seller!==null,
      files:['dataset.csv','dataset.json','source.json','rows.json',...(seller?['seller.json']:[])]};
    return store.mutate(state=>{const existing=state.exports.find(value=>value.id===exportId);if(existing)return copy(existing);state.exports.push(record);return copy(record);});
  }
  async function queryExport({id,query=''}){
    const record=find((await store.read()).exports,identifier(id),'Export');
    const {loadDatasetConfig}=await import('../dataset-handler.mjs'),dataset=await loadDatasetConfig(join(root,'exports',record.id,'dataset.json'));
    const context={query:new URLSearchParams(query)},admitted=await dataset.admit(context);
    return admitted===true?await dataset.handle(context):admitted;
  }
  function liveFilePaths(record){
    identifier(record.id,'live service ID');
    const expected=['profile.json','package/catalog.json','package/plan.json','package/seller-service.json',
      'package/offers.json','package/openapi.json','package/customer-query.json','package/request.json','package/package.json'];
    if(record.schema!=='stellar-forge.odata-live-profile.v1'||!/^[a-f0-9]{64}$/.test(record.sourceBinding||'')||
      !Array.isArray(record.files)||record.files.length!==expected.length||new Set(record.files).size!==expected.length||
      record.files.some(name=>!expected.includes(name)))throw fault('ODATA_LIVE_PROFILE','Use a complete original live service profile.');
    return record.files.map(name=>'live/products/'+record.id+'/'+name);
  }
  async function recordLiveProduct(record){
    liveFilePaths(record);
    if(stable(await readJson(join(root,'live','products',record.id,'profile.json')))!==stable(record))
      throw fault('ODATA_LIVE_PROFILE','The retained live service profile differs.',409);
    return store.mutate(state=>{state.liveProducts||=[];const previous=state.liveProducts.find(value=>value.id===record.id);
      if(previous){if(stable(previous)!==stable(record))throw fault('ODATA_LIVE_EXISTS','The saved live service differs.',409);return copy(previous);}
      state.liveProducts.push(copy(record));return copy(record);});
  }
  async function backup(){
    if(running.size)throw fault('ODATA_TRANSFER_RUNNING','Pause active imports before making a portable workspace.',409);
    const saved=await store.read(),files=[];
    const liveLease=saved.liveProducts?.length?await acquireReleaseLease(join(root,'live'),'state.lock'):null;
    try{
    const hashes=new Set(saved.editions.flatMap(value=>value.pages.flatMap(page=>[page.source.sha256,page.rowsSha256])));
    for(const catalog of [...saved.connections.map(value=>value.catalog),...saved.editions.map(value=>value.catalog)])
      for(const receipt of Object.values(catalog.receipts||{}))if(receipt.sha256)hashes.add(receipt.sha256);
    for(const hash of hashes){const bytes=await raw(hash);files.push({path:'sources/'+hash,sha256:hash,bodyBase64:bytes.toString('base64')});}
    for(const record of saved.exports)for(const name of record.files){const bytes=await readFile(join(root,'exports',record.id,name));
      files.push({path:'exports/'+record.id+'/'+name,sha256:digest(bytes),bodyBase64:bytes.toString('base64')});}
    for(const record of saved.liveProducts||[]){
      for(const path of liveFilePaths(record)){const bytes=await readFile(join(root,path));files.push({path,sha256:digest(bytes),bodyBase64:bytes.toString('base64')});}
      const selected={buyers:['request.json','offers.json','buyer.json','handoff.json','response.json'],
        receiving:['original-response.json','rows.jsonl','receiving.json','next-request.json']};
      for(const [kind,names]of Object.entries(selected)){const parent='live/products/'+record.id+'/'+kind;let entries;
        try{entries=await readdir(join(root,parent),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
        for(const entry of entries){if(!entry.isDirectory()||!/^[a-f0-9]{64}$/.test(entry.name))continue;
          for(const name of names){const path=parent+'/'+entry.name+'/'+name;let bytes;
            try{bytes=await readFile(join(root,path));}catch(error){if(error.code==='ENOENT')continue;throw error;}
            files.push({path,sha256:digest(bytes),bodyBase64:bytes.toString('base64')});}}
      }
    }
    return {schema:'stellar-forge.odata-transfer.v1',exportedAt:now(),state:saved,files};
    }finally{await liveLease?.close();}
  }
  async function restore(bundle){
    if(bundle?.schema!=='stellar-forge.odata-transfer.v1'||bundle.state?.schema!=='stellar-forge.odata-workspace.v1'||!Array.isArray(bundle.files))
      throw fault('ODATA_TRANSFER_SCHEMA','Use an original OData workspace transfer.');
    const current=await store.read();if(current.connections.length||current.editions.length||current.plans.length)throw fault('ODATA_RESTORE_TARGET','Restore into an empty workspace.',409);
    const permitted=/^(sources\/[a-f0-9]{64}|exports\/[a-f0-9]{64}\/(dataset\.csv|dataset\.json|source\.json|rows\.json|seller\.json)|live\/products\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\/(profile\.json|package\/[a-z-]+\.json|buyers\/[a-f0-9]{64}\/(request|offers|buyer|handoff|response)\.json|receiving\/[a-f0-9]{64}\/(original-response\.json|rows\.jsonl|receiving\.json|next-request\.json)))$/;
    const seen=new Set(),validated=[];
    for(const file of bundle.files){if(!permitted.test(file.path)||seen.has(file.path))throw fault('ODATA_TRANSFER_PATH','The transfer contains an unsupported or repeated file path.');
      const bytes=Buffer.from(file.bodyBase64,'base64');if(digest(bytes)!==file.sha256)throw fault('ODATA_TRANSFER_HASH','A transfer file differs from its original hash.',409);
      if(file.path.startsWith('sources/')&&file.path.slice(8)!==file.sha256)throw fault('ODATA_TRANSFER_HASH','Source identity differs from its original bytes.',409);
      seen.add(file.path);validated.push({path:file.path,bytes});}
    const required=new Set(bundle.state.editions.flatMap(value=>value.pages.flatMap(page=>['sources/'+page.source.sha256,'sources/'+page.rowsSha256])));
    for(const catalog of [...bundle.state.connections.map(value=>value.catalog),...bundle.state.editions.map(value=>value.catalog)])
      for(const receipt of Object.values(catalog.receipts||{}))if(receipt.sha256)required.add('sources/'+receipt.sha256);
    for(const record of bundle.state.exports){identifier(record.id);for(const name of record.files)required.add('exports/'+record.id+'/'+name);}
    for(const record of bundle.state.liveProducts||[]){
      for(const path of liveFilePaths(record))required.add(path);
      const original=validated.find(file=>file.path==='live/products/'+record.id+'/profile.json');
      if(!original||stable(JSON.parse(original.bytes.toString('utf8')))!==stable(record))throw fault('ODATA_LIVE_PROFILE','The transferred live profile differs from its saved identity.',409);
    }
    for(const file of validated){
      if(file.path.match(/\/buyers\/[a-f0-9]{64}\/handoff\.json$/)){
        const parent=file.path.slice(0,file.path.lastIndexOf('/')+1);for(const name of ['request.json','offers.json','buyer.json'])required.add(parent+name);
      }else if(file.path.match(/\/receiving\/[a-f0-9]{64}\/receiving\.json$/)){
        const parent=file.path.slice(0,file.path.lastIndexOf('/')+1),record=JSON.parse(file.bytes.toString('utf8'));
        required.add(parent+'original-response.json');required.add(parent+'rows.jsonl');if(record.nextRequest)required.add(parent+'next-request.json');
      }
    }
    if([...required].some(path=>!seen.has(path)))throw fault('ODATA_TRANSFER_MISSING','The transfer omits a referenced source, export, or live service file.');
    for(const file of validated){const target=join(root,file.path);await mkdir(resolve(target,'..'),{recursive:true,mode:0o700});
      try{await writeNew(target,file.bytes);}catch(error){if(error.code!=='EEXIST')throw error;if(digest(await readFile(target))!==digest(file.bytes))throw fault('ODATA_RESTORE_CHANGED','A receiving file differs.',409);}}
    return store.mutate(state=>{const revision=state.revision;Object.assign(state,copy(bundle.state));state.revision=revision;state.restoredAt=now();
      for(const record of state.exports)record.directory=join(root,'exports',record.id);
      for(const record of state.editions)if(record.status==='IMPORTING')record.status='PAUSED';return {connections:state.connections.length,editions:state.editions.length,exports:state.exports.length,liveProducts:state.liveProducts?.length||0};});
  }
  async function close(){closed=true;for(const control of running.values())control.abort();await Promise.allSettled([...completions.values()]);await store.settle();}
  return {directory:root,state,connect,refreshConnection,plan,reviewPlan,startCapture,capture,pause,edition,rows,reviewEdition,compare,
    exportEdition,queryExport,recordLiveProduct,backup,restore,raw,close};
}
