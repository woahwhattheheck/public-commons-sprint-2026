// MIT. Matomo editions composed with the ORIGINAL SQLite workbench, publisher and SF82.
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstat,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openWorkbench,compileDraft} from '../sqlite/workbench/model.mjs';
import {openSqlitePublisher} from '../sqlite/publisher/model.mjs';
import {prepareSqliteRelease} from '../../sf82-seller-pilot/release-sqlite.mjs';
import {initReleaseStore,readReleaseState,listReleases,inspectRelease,stageRelease,compareReleases,activateRelease,rollbackRelease,releaseStatus,runActiveRelease,normalizeReleaseRuntime} from '../../sf82-seller-pilot/releases.mjs';
import {startReleaseConsole} from '../../sf82-seller-pilot/release-console.mjs';
import {privateDirectory,bytes,digest,identity,fault,stamp} from '../postgres/publisher/files.mjs';
import {identifier,only,text} from './contract.mjs';
import {SOURCE_COLUMNS,ROW_COLUMNS} from './editions.mjs';
import {writeNew,readRetainedJson} from './store.mjs';

const quote=name=>'"'+name.replaceAll('"','""')+'"';
const integerColumns=new Set(['file_bytes','chunk_index','chunk_count','source_row','depth','source_index']);
const SDK=fileURLToPath(new URL('../',import.meta.url));
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function name(value){if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))throw fault('MATOMO_PACKAGE_NAME');return value;}
function projection(edition,names) {
  if(!Array.isArray(names)||names.length>52||new Set(names).size!==names.length)throw fault('MATOMO_QUERY_FIELD_SELECTION');
  return names.map(item=>{const field=edition.fields.find(x=>x.name===item);if(!field)throw fault('MATOMO_QUERY_FIELD_NOT_FOUND');return field;});
}
export function matomoMerchantDraft(edition,{merchant,amount,fields=[],path='/matomo'}={}) {
  if(typeof merchant?.name!=='string'||! /^[\x20-\x7e]{1,32}$/.test(merchant.name))throw fault('MATOMO_MERCHANT_NAME_INVALID',undefined,400);
  if(typeof amount!=='string'||! /^[1-9][0-9]*$/.test(amount))throw fault('MATOMO_PAYMENT_AMOUNT_REQUIRED');
  if(typeof path!=='string'||! /^\/[A-Za-z0-9/_-]*$/.test(path)||path.endsWith('/'))throw fault('MATOMO_RESOURCE_PATH_REQUIRED');
  const selected=projection(edition,fields),columns=[...ROW_COLUMNS,...selected.map(x=>x.column)];
  const query=(name,sql,columns,parameters,publicInput,suffix,description)=>({name,sql,columns,parameters,publicInput,method:'GET',path:path+suffix,description,amount,
    maxRows:1000,maxBytes:917504,timeoutMs:30000});
  const paging={offset:{type:'integer',minimum:'0',maximum:'1000000',optional:true,default:'0'},limit:{type:'integer',minimum:'1',maximum:'1000',optional:true,default:'100'}};
  return {merchant,queries:[
    query('reportRows','SELECT '+columns.map(quote).join(',')+' FROM matomo_rows ORDER BY row_id LIMIT $limit OFFSET $offset',columns,paging,{offset:'0',limit:'100'},'/rows','Source-linked retained Matomo processed report rows. Typed original JSON, null/absence and hierarchy are included.'),
    query('reportRow','SELECT '+columns.map(quote).join(',')+' FROM matomo_rows WHERE row_id=$row_id',columns,{row_id:{type:'string',minLength:64,maxLength:64}},{row_id:'0'.repeat(64)},'/row','One retained source row by its immutable row ID.'),
    query('sourceFiles','SELECT '+SOURCE_COLUMNS.map(quote).join(',')+' FROM source_files ORDER BY path,chunk_index LIMIT $limit OFFSET $offset',SOURCE_COLUMNS,
      {...paging,limit:{type:'integer',minimum:'1',maximum:'12',optional:true,default:'10'}},{offset:'0',limit:'10'},'/source-files','Original report manifests and responses in the maintained source-file chunk protocol. Retain the complete selected file population before receiving.')
  ]};
}
function inspectMerchantDraft(draft,database) {
  try{return compileDraft(draft,database);}
  catch(error){
    if(error instanceof TypeError||error instanceof RangeError||(Number.isInteger(error.status)&&error.status>=400&&error.status<500))throw fault('MATOMO_MERCHANT_DRAFT_INVALID',undefined,400);
    throw error;
  }
}
export function createMatomoMerchant(store,editions,{environment=process.env}={}) {
  store.db.exec('CREATE TABLE IF NOT EXISTS merchants(id TEXT PRIMARY KEY,edition_id TEXT NOT NULL REFERENCES editions(id),data TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS merchant_packages(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),data TEXT NOT NULL,created_at TEXT NOT NULL);');
  const runtimes=new Map();let consoleApp=null,closing=null;
  const root=join(store.directory,'merchant'),releaseRoot=join(root,'releases');
  const record=(table,id)=>{const row=store.db.prepare('SELECT * FROM '+table+' WHERE id=?').get(identifier(id));if(!row)throw fault('MATOMO_MERCHANT_RECORD_NOT_FOUND','Choose a retained merchant or delivery.',404);return {...row,data:JSON.parse(row.data)};};
  const change=(table,id,patch,event)=>store.transaction(()=>{const old=record(table,id);store.db.prepare('UPDATE '+table+' SET data=? WHERE id=?').run(JSON.stringify({...old.data,...patch}),id);store.event(event,id);return record(table,id);});
  const merchant=id=>record('merchants',id),packageRecord=id=>record('merchant_packages',id),delivery=id=>record('deliveries',id);
  function list(){return {merchants:store.db.prepare('SELECT id FROM merchants ORDER BY rowid DESC').all().map(x=>merchant(x.id)),packages:store.db.prepare('SELECT id FROM merchant_packages ORDER BY rowid DESC').all().map(x=>packageRecord(x.id))};}
  async function selected(id) {
    const current=merchant(id),value=await editions.manifest(current.edition_id,{database:true});
    if(current.data.editionSha256!==value.edition.data.manifest.sha256)throw fault('MATOMO_MERCHANT_EDITION_CHANGED');
    return {current,value,directory:join(root,id)};
  }
  async function workbench(id,fn) {
    const item=await selected(id);await privateDirectory(item.directory,true);const api=await openWorkbench({database:item.value.database,workspace:join(item.directory,'workbench')});
    try{return await fn(api,item);}finally{await api.close();}
  }
  async function state(id){return {merchant:merchant(id),workbench:await workbench(id,api=>api.state())};}
  async function configure(input) {
    only(input,['operationId','expectedRevision','editionId','configuration']);
    const id=identifier(input.operationId),edition=await editions.manifest(input.editionId,{database:true});
    const draft=matomoMerchantDraft(edition.value,input.configuration);
    // Validate the complete public draft with the original native compiler before
    // allocating a retained merchant identity. No source query or provider read.
    inspectMerchantDraft(draft,edition.database);
    return store.perform('configure-merchant',input,async()=>{
      store.transaction(()=>{store.db.prepare('INSERT INTO merchants(id,edition_id,data,created_at) VALUES(?,?,?,?)').run(id,input.editionId,JSON.stringify({
        editionSha256:edition.edition.data.manifest.sha256,configuration:input.configuration,state:'CONFIGURING'}),stamp());store.event('MERCHANT_STARTED',id);});
      await workbench(id,async api=>{await api.inspectDraft(draft);const current=await api.state();await api.save(draft,current.revision);});
      change('merchants',id,{state:'CONFIGURED'},'MERCHANT_CONFIGURED');return state(id);
    });
  }
  async function resumeConfiguration(input) {
    only(input,['operationId','expectedRevision','merchantId']);const item=await selected(input.merchantId);
    return store.perform('resume-merchant-configuration',input,async()=>{
      if(item.current.data.state==='CONFIGURING')await workbench(input.merchantId,async api=>{
        const current=await api.state(),draft=matomoMerchantDraft(item.value.value,item.current.data.configuration);
        if(current.draft.queries.length&&identity(current.draft)!==identity(draft))throw fault('MATOMO_MERCHANT_DRAFT_CHANGED');
        if(identity(current.draft)!==identity(draft)){await api.inspectDraft(draft);await api.save(draft,current.revision);}
      });
      change('merchants',input.merchantId,{state:'CONFIGURED'},'MERCHANT_CONFIGURATION_RECOVERED');return state(input.merchantId);
    });
  }
  async function save(input) {
    only(input,['operationId','expectedRevision','merchantId','draft','draftRevision']);
    const item=await selected(input.merchantId);inspectMerchantDraft(input.draft,item.value.database);
    return store.perform('save-merchant',input,async()=>workbench(input.merchantId,async api=>{
      await api.inspectDraft(input.draft);const saved=await api.save(input.draft,input.draftRevision);
      change('merchants',input.merchantId,{state:'CONFIGURED',draftRevision:saved.revision},'MERCHANT_DRAFT_SAVED');
      return {merchant:merchant(input.merchantId),workbench:saved};
    }));
  }
  async function preview(input) {
    only(input,['merchantId','query','input','draftRevision']);
    return workbench(input.merchantId,async api=>{
      const current=await api.state();if(current.revision!==input.draftRevision)throw fault('MATOMO_MERCHANT_DRAFT_CHANGED');
      const query=current.draft.queries.find(x=>x.name===input.query);if(!query)throw fault('MATOMO_QUERY_NOT_FOUND');
      return {merchantId:input.merchantId,draftRevision:current.revision,query:query.name,result:await api.preview(query,input.input??{})};
    });
  }
  async function finishExport(id) {
    const current=packageRecord(id),item=await selected(current.merchant_id);
    const directory=join(item.directory,'workbench','exports',current.data.name);
    let native;
    if(await exists(join(directory,'manifest.json')))native=await prepareSqliteRelease(directory);
    else {
      await workbench(current.merchant_id,api=>api.exportPack(current.data.name,current.data.draftRevision));
      native=await prepareSqliteRelease(directory);
    }
    if(native.manifest.draftRevision!==current.data.draftRevision||native.source.database!==item.value.database)throw fault('MATOMO_PACKAGE_SOURCE_CHANGED');
    const originalManifest=native.originals.get('manifest.json');
    change('merchant_packages',id,{state:'EXPORTED',directory,manifestSha256:digest(originalManifest),routes:native.service.routes.map(r=>({id:r.id,path:r.path,method:r.offer.method??r.offer.extensions?.bazaar?.info?.input?.method})),error:null},'MERCHANT_PACKAGE_EXPORTED');
    return {package:packageRecord(id)};
  }
  async function exportPackage(input) {
    only(input,['operationId','expectedRevision','merchantId','draftRevision','name']);
    const id=identifier(input.operationId),packageName=name(input.name),item=await selected(input.merchantId);
    return store.perform('export-merchant',input,async()=>{
      const current=await workbench(input.merchantId,api=>api.state());
      if(current.revision!==input.draftRevision)throw fault('MATOMO_MERCHANT_DRAFT_CHANGED');
      store.transaction(()=>{store.db.prepare('INSERT INTO merchant_packages(id,merchant_id,data,created_at) VALUES(?,?,?,?)').run(id,item.current.id,
        JSON.stringify({state:'EXPORTING',name:packageName,draftRevision:current.revision,editionSha256:item.current.data.editionSha256}),stamp());store.event('MERCHANT_EXPORT_STARTED',id);});
      return finishExport(id);
    });
  }
  async function recoverPackage(input) {
    only(input,['operationId','expectedRevision','packageId']);packageRecord(input.packageId);
    return store.perform('recover-merchant-package',input,()=>finishExport(input.packageId));
  }
  async function ensureReleases(){await privateDirectory(root,true);if(!await exists(releaseRoot))await initReleaseStore(releaseRoot);return readReleaseState(releaseRoot);}
  async function releases(){if(!await exists(releaseRoot))return {state:null,releases:[],runtime:{state:'STOPPED'}};return releaseStatus(releaseRoot);}
  async function stage(input) {
    only(input,['operationId','expectedRevision','packageId','releaseId','label','runtime']);
    const saved=packageRecord(input.packageId),releaseId=name(input.releaseId);
    if(saved.data.state!=='EXPORTED')throw fault('MATOMO_PACKAGE_NOT_EXPORTED');
    const item=await selected(saved.merchant_id),native=await prepareSqliteRelease(saved.data.directory);
    if(digest(native.originals.get('manifest.json'))!==saved.data.manifestSha256||native.source.database!==item.value.database)throw fault('MATOMO_PACKAGE_SOURCE_CHANGED');
    return store.perform('stage-release',input,async({signal})=>{
      await ensureReleases();
      let result;
      if((await listReleases(releaseRoot)).releases.some(x=>x.id===releaseId)){
        result=await inspectRelease(releaseRoot,releaseId);
        if(result.sqlite?.packageManifestSha256!==saved.data.manifestSha256||result.sqlite?.originalSourceSha256!==digest(native.originals.get('source.json'))||identity(result.runtime)!==identity(normalizeReleaseRuntime(input.runtime??{port:0}))||result.label!==input.label)
          throw fault('MATOMO_RELEASE_ID_CONFLICT');
      }else result=await stageRelease(releaseRoot,{id:releaseId,label:text(input.label,'the release label',160),sqlitePackage:saved.data.directory,
        runtime:input.runtime??{port:0},signal});
      change('merchant_packages',input.packageId,{releaseId,releaseDigest:result.digest},'MERCHANT_RELEASE_STAGED');
      return {release:result,status:await releases()};
    });
  }
  async function diff(before,after){await ensureReleases();return compareReleases(releaseRoot,before??null,name(after));}
  async function select(input) {
    only(input,['operationId','expectedRevision','releaseId','expectedGeneration','reason','rollback']);
    return store.perform(input.rollback?'rollback-release':'select-release',input,async()=>{
      await ensureReleases();const reason=text(input.reason,'the release selection reason',2000);
      const result=input.rollback?await rollbackRelease(releaseRoot,{to:name(input.releaseId),expectedGeneration:input.expectedGeneration,reason}):
        await activateRelease(releaseRoot,name(input.releaseId),{expectedGeneration:input.expectedGeneration,reason});
      store.transaction(()=>store.event('RELEASE_SELECTION_RECORDED',input.releaseId,{generation:result.state.generation}));
      return {selection:result,status:await releases()};
    });
  }
  async function start(input) {
    only(input,['operationId','expectedRevision','expectedGeneration']);
    return store.perform('start-release',input,async({signal})=>{
      signal.throwIfAborted();await ensureReleases();
      if(runtimes.size)throw fault('MATOMO_OWNED_RELEASE_RUNNING');
      const app=await runActiveRelease(releaseRoot,{expectedGeneration:input.expectedGeneration,handleSignals:false,env:{...environment,SF30_SQLITE_SDK:SDK}});
      runtimes.set(app.observation.instanceId,app);
      void app.completion.finally(()=>runtimes.delete(app.observation.instanceId)).catch(()=>{});
      if(signal.aborted){await app.close();signal.throwIfAborted();}
      store.transaction(()=>store.event('RELEASE_STARTED',app.release.id,{instanceId:app.observation.instanceId,mode:app.mode}));
      return {runtime:{url:app.url,mode:app.mode,observation:app.observation},status:await releases()};
    });
  }
  async function stop(input) {
    only(input,['operationId','expectedRevision','instanceId']);
    return store.perform('stop-release',input,async()=>{
      const app=runtimes.get(input.instanceId);if(app)await app.close();
      const result=await releases();
      if(!app&&result.runtime?.observed?.instanceId===input.instanceId&&['RUNNING','STARTING','ORPHANED','OTHER_HOST'].includes(result.runtime.state))
        throw fault('MATOMO_RUNTIME_NOT_OWNED','Use the original release-store manager for this still-running instance.',409);
      store.transaction(()=>store.event('RELEASE_STOPPED',input.instanceId,{state:result.runtime.state}));return result;
    });
  }
  async function openConsole(input) {
    only(input,['operationId','expectedRevision']);
    return store.perform('open-release-console',input,async()=>{
      await ensureReleases();if(!consoleApp)consoleApp=await startReleaseConsole(releaseRoot,{port:0,env:{...environment,SF30_SQLITE_SDK:SDK}});
      return {url:consoleApp.operatorUrl,root:releaseRoot};
    });
  }

  // The publisher executes these ORIGINAL named SQLite queries in its retained
  // read transaction. The API query's page limit is not used for full extraction.
  function publicationSource(value,projectionName) {
    const files=projectionName==='source-files',columns=files?[...SOURCE_COLUMNS]:[...ROW_COLUMNS,...value.fields.slice(0,52).map(x=>x.column)];
    return {schema:'stellar-forge.sqlite-source.v1',database:value.databasePath,queries:{publication:{
      sql:'SELECT '+columns.map(quote).join(',')+' FROM '+(files?'source_files':'matomo_rows'),
      columns,parameters:{},maxRows:1000,maxBytes:917504,timeoutMs:30000}}};
  }
  async function publisher(id,fn,{create=false}={}) {
    const current=delivery(id),folder=join(store.directory,'deliveries',id),sourceFile=join(folder,'source.json');
    const api=await openSqlitePublisher({directory:join(folder,'publisher'),create,sourceFile,targetDirectory:join(folder,'versions'),environment});
    try{return await fn(api,current,folder);}finally{await api.close();}
  }
  async function finishDelivery(id,{signal}) {
    let current=delivery(id);const selected=await editions.manifest(current.data.editionId,{database:true});
    if(selected.edition.data.manifest.sha256!==current.data.editionSha256)throw fault('MATOMO_DELIVERY_EDITION_CHANGED');
    const folder=join(store.directory,'deliveries',id);await privateDirectory(folder,true);
    const source=publicationSource({...selected.value,databasePath:selected.database},current.data.projection);
    await writeNew(join(folder,'source.json'),bytes(source));
    return publisher(id,async api=>{
      current=delivery(id);
      let saved;
      if(current.data.planId)saved=api.plan(current.data.planId);
      else{
        const query=source.queries.publication,files=current.data.projection==='source-files';
        const declaration={title:current.data.label,query:'publication',input:{},sourceHash:(await api.source()).hash,
          dataset:{name:current.data.label,columns:Object.fromEntries(query.columns.map(column=>[column,{type:integerColumns.has(column)?'integer':'string',nullable:false}])),
            filters:files?['capture_id','path']:['row_id','report_id'],sorts:files?['path','chunk_index']:['row_id'],ranges:[],
            maxCellChars:files?65536:1048576,defaultLimit:files?10:50,maxLimit:files?12:250,maxPageBytes:917504},
          extraction:{maxRows:Math.max(1,files?selected.value.sourceFiles.rows:selected.value.rows),maxBytes:268435456,maxRowBytes:8388608,timeoutMs:300000,
            order:files?[{column:'path',direction:'asc'},{column:'chunk_index',direction:'asc'}]:[{column:'row_id',direction:'asc'}]}};
        // A saved native plan surviving a lost wrapper response can be reused.
        const match=api.status({limit:100}).plans.find(x=>identity({source:x.data.sourceHash,query:x.data.query,dataset:x.data.dataset.name})===identity({source:declaration.sourceHash,query:declaration.query,dataset:declaration.dataset.name}));
        saved=match??await api.savePlan(declaration);
        change('deliveries',id,{planId:saved.id,planDigest:saved.data.digest},'DELIVERY_PLAN_RETAINED');
      }
      current=delivery(id);let native;
      try{native=api.run(current.data.runId);}catch(error){if(error.code!=='RUN_NOT_FOUND')throw error;}
      if(!native) {
        const task=api.startExtraction(saved.id,{id:current.data.runId}),abort=()=>{try{api.cancel(task.id);}catch{}};
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        try{native=await task.completion;}finally{signal.removeEventListener('abort',abort);}
      }else if(['INTERRUPTED','FAILED','CANCELLED','PUBLICATION_UNKNOWN'].includes(native.state))native=await api.recover(native.id);
      const result=await api.inspect(native.id);
      if(!result.run.data.candidate)throw fault('MATOMO_NATIVE_EXTRACTION_INCOMPLETE','The original extraction has no completed candidate. Its run remains retained.');
      const expected=current.data.projection==='source-files'?selected.value.sourceFiles.rows:selected.value.rows;
      if(result.run.data.candidate.dataset.rowCount!==expected)throw fault('MATOMO_DELIVERY_POPULATION_CHANGED');
      change('deliveries',id,{state:result.run.state,native:result.run,candidate:result.run.data.candidate,error:null},'DELIVERY_EXTRACTED');
      return {delivery:delivery(id),inspection:result};
    },{create:!await exists(join(folder,'publisher','workspace.json'))});
  }
  async function prepareDelivery(input) {
    only(input,['operationId','expectedRevision','editionId','projection','label','note']);
    if(!['source-files','report-rows'].includes(input.projection))throw fault('MATOMO_DELIVERY_PROJECTION');
    const id=identifier(input.operationId),value=await editions.manifest(input.editionId,{database:true});
    const label=text(input.label,'the dataset name',128),note=text(input.note,'the delivery scope and intended-use note',4000);
    return store.perform('prepare-delivery',input,async({signal})=>{
      store.transaction(()=>{store.db.prepare('INSERT INTO deliveries(id,data,created_at) VALUES(?,?,?)').run(id,JSON.stringify({kind:'native-sqlite-dataset',
        editionId:input.editionId,editionSha256:value.edition.data.manifest.sha256,projection:input.projection,label,note,
        runId:randomUUID(),state:'PREPARING'}),stamp());store.event('DELIVERY_STARTED',id);});
      return finishDelivery(id,{signal});
    });
  }
  async function recoverDelivery(input) {
    only(input,['operationId','expectedRevision','deliveryId']);delivery(input.deliveryId);
    return store.perform('recover-delivery',input,({signal})=>finishDelivery(input.deliveryId,{signal}));
  }
  async function inspectDelivery(id,query){return publisher(id,async(api,current)=>({delivery:current,inspection:await api.inspect(current.data.runId,query),target:await api.target()}));}
  async function reviewDelivery(input) {
    only(input,['operationId','expectedRevision','deliveryId','reviewer','note','initialize','expectedSnapshot','expectedTargetRevision']);
    return store.perform('review-delivery',input,()=>publisher(input.deliveryId,async(api,current)=>{
      const native=await api.review(current.data.runId,{reviewer:input.reviewer,note:input.note,initialize:input.initialize,
        expectedSnapshot:input.expectedSnapshot,expectedRevision:input.expectedTargetRevision});
      change('deliveries',current.id,{state:native.state,native},'DELIVERY_REVIEWED');return {delivery:delivery(current.id),native};
    }));
  }
  async function publishDelivery(input) {
    only(input,['operationId','expectedRevision','deliveryId','reviewId']);
    return store.perform('publish-delivery',input,()=>publisher(input.deliveryId,async(api,current)=>{
      let native=api.run(current.data.runId);
      if(native.state==='PUBLISHED')return {delivery:change('deliveries',current.id,{state:native.state,native},'DELIVERY_PUBLICATION_REOPENED'),native};
      if(native.state==='PUBLICATION_UNKNOWN')native=await api.recover(native.id);
      if(native.state!=='PUBLISHED')native=await api.publish(native.id,input.reviewId);
      change('deliveries',current.id,{state:native.state,native},'DELIVERY_PUBLICATION_RECORDED');return {delivery:delivery(current.id),native};
    }));
  }
  async function deliveryFile(id,kind) {
    return publisher(id,async(api,current,folder)=>{
      await api.candidate(current.data.runId);
      const names={csv:'data.csv',config:'dataset.json',manifest:'candidate.json'};
      if(!names[kind])throw fault('MATOMO_DELIVERY_FILE');
      return {path:join(folder,'publisher','runs',current.data.runId,names[kind]),name:id+'-'+names[kind],mediaType:kind==='csv'?'text/csv':'application/json'};
    });
  }
  async function close() {
    if(closing)return closing;
    closing=(async()=>{await consoleApp?.close();for(const app of [...runtimes.values()])await app.close();runtimes.clear();})();return closing;
  }
  return Object.freeze({list,merchant,state,configure,resumeConfiguration,save,preview,exportPackage,recoverPackage,packageRecord,releases,stage,diff,select,start,stop,openConsole,
    delivery,prepareDelivery,recoverDelivery,inspectDelivery,reviewDelivery,publishDelivery,deliveryFile,close});
}
