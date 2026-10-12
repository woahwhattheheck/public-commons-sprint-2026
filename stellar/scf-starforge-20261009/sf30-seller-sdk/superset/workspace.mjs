// MIT. One retained Superset workspace over the original dataset and file-lease engines.
import {DatabaseSync} from 'node:sqlite';
import {open,lstat,chmod,link,unlink,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {SupersetClient,sourceOptions} from './client.mjs';
import {readCapture,buildEdition,compareEditions} from './source.mjs';
import {stringifyExact} from './exact-json.mjs';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {absolute,object,bytes,digest,identity,readPrivate,hashPrivate,privateDirectory,
  syncDirectory,fault,acquireWorkspace,saveExact,MiB} from './files.mjs';

export const WORKSPACE_SCHEMA='stellar-forge.superset-workspace.v1';
export const WORKSPACE_FILE='superset.sqlite3';
const APP_ID=0x53465355;
const KINDS=['sources','captures','editions','reviews','comparisons','merchants','publications','buyers','deliveries'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_BLOB=256*MiB;
const TABLES=[
'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
'CREATE TABLE blobs (sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL, data BLOB NOT NULL)',
'CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, sha256 TEXT NOT NULL, summary TEXT NOT NULL, body BLOB NOT NULL, PRIMARY KEY(kind,id))',
'CREATE TABLE operations (id TEXT PRIMARY KEY, input_sha256 TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, progress TEXT NOT NULL, result TEXT, error TEXT)'
];
const decode=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const now=()=>new Date().toISOString();
function id(value,label='record'){if(typeof value!=='string'||!ID.test(value))throw fault('SUPERSET_ID','Choose a stable '+label+' ID using letters, numbers, _ and -.');return value;}
function label(value,maximum=200){if(typeof value!=='string'||!value.trim()||value.trim().length>maximum||/[\x00-\x1f\x7f]/.test(value))throw fault('SUPERSET_LABEL','A printable label is required.');return value.trim();}
function small(kind,doc){
  const common={id:doc.id,sha256:doc.sha256,createdAt:doc.createdAt};
  if(kind==='sources')return{...common,label:doc.label,baseUrl:doc.options.baseUrl,authentication:doc.options.auth.mode};
  if(kind==='captures')return{...common,label:doc.label,sourceId:doc.sourceId,chartId:doc.source.chartId,
    capturedAt:doc.capturedAt,queries:doc.queries,job:doc.job?{status:doc.job.status,jobId:doc.job.job_id}:null};
  if(kind==='editions')return{...common,label:doc.label,captureId:doc.captureId,rows:doc.rows,snapshot:doc.snapshot,
    selection:doc.selection,definitionSha256:doc.definitionSha256};
  if(kind==='reviews')return{...common,editionId:doc.editionId,editionSha256:doc.editionSha256,decision:doc.decision,actor:doc.actor,note:doc.note,distributionBasis:doc.distributionBasis};
  if(kind==='comparisons')return{...common,beforeId:doc.beforeId,afterId:doc.afterId,...doc.counts};
  if(kind==='buyers')return{...common,merchantId:doc.merchantId,editionId:doc.editionId,snapshot:doc.snapshot,
    configurationSha256:doc.configurationSha256,relative:doc.relative,commands:doc.commands};
  if(kind==='deliveries')return{...common,buyerId:doc.buyerId,editionId:doc.editionId,snapshot:doc.snapshot,
    rows:doc.rows,pages:doc.pages,deliverySha256:doc.deliverySha256,relative:doc.relative};
  if(kind==='publications')return{...common,merchantId:doc.merchantId,editionId:doc.editionId,snapshot:doc.snapshot,native:doc.native};
  return{...common,editionId:doc.editionId,snapshot:doc.snapshot,label:doc.label,resource:doc.resource,versionGroup:doc.versionGroup};
}
export class SupersetWorkspace{
  constructor({directory,db,unlock,env,fetchImpl}){
    this.directory=directory;this.db=db;this.unlock=unlock;this.env=env;this.fetchImpl=fetchImpl;
    this.tail=Promise.resolve();this.closed=false;this.closing=false;this.active=null;this.pending=new Map();
  }
  meta(key){const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  setMeta(key,value){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  revision(){return this.meta('revision');}
  blob(raw){
    if(!Buffer.isBuffer(raw)||raw.length>MAX_BLOB)throw fault('SUPERSET_BLOB_LIMIT','An original source member exceeds 256 MiB.',413);
    const sha256=digest(raw),row=this.db.prepare('SELECT bytes FROM blobs WHERE sha256=?').get(sha256);
    if(row&&row.bytes!==raw.length)throw fault('SUPERSET_BLOB_CHANGED','An original source identity changed.',409);
    if(!row)this.db.prepare('INSERT INTO blobs VALUES(?,?,?)').run(sha256,raw.length,gzipSync(raw));
    return{sha256,bytes:raw.length};
  }
  bytes(sha256){
    if(!HASH.test(sha256??''))throw fault('SUPERSET_BLOB_ID','Choose an original response digest.');
    const row=this.db.prepare('SELECT bytes,data FROM blobs WHERE sha256=?').get(sha256);
    if(!row)throw fault('SUPERSET_BLOB_MISSING','An original source member is missing.',409);
    const raw=gunzipSync(row.data,{maxOutputLength:MAX_BLOB});
    if(raw.length!==row.bytes||digest(raw)!==sha256)throw fault('SUPERSET_BLOB_CHANGED','An original source member failed its digest.',409);
    return raw;
  }
  get(kind,key){
    if(!KINDS.includes(kind))throw fault('SUPERSET_RECORD_KIND','Unknown workspace record.');
    id(key);
    const row=this.db.prepare('SELECT sha256,body FROM records WHERE kind=? AND id=?').get(kind,key);
    if(!row)throw fault('SUPERSET_RECORD_MISSING','The selected workspace record does not exist.',404);
    const raw=gunzipSync(row.body,{maxOutputLength:MAX_BLOB});
    if(digest(raw)!==row.sha256)throw fault('SUPERSET_RECORD_CHANGED','A retained workspace record failed its digest.',409);
    const doc=decode(raw),{sha256,...unsigned}=doc;
    if(doc.id!==key||identity(unsigned)!==sha256)throw fault('SUPERSET_RECORD_CHANGED','The original record identity differs.',409);
    return doc;
  }
  put(kind,input){
    const doc={...input};delete doc.sha256;doc.sha256=identity(doc);
    const raw=bytes(doc),summary=small(kind,doc);
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(kind,doc.id,digest(raw),JSON.stringify(summary),gzipSync(raw));
    return doc;
  }
  list(kind){
    if(!KINDS.includes(kind))throw fault('SUPERSET_RECORD_KIND','Unknown workspace record.');
    return this.db.prepare('SELECT summary FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row=>JSON.parse(row.summary));
  }
  operation(operationId){
    const row=this.db.prepare('SELECT * FROM operations WHERE id=?').get(id(operationId,'operation'));
    if(!row)throw fault('SUPERSET_OPERATION_MISSING','The original operation does not exist.',404);
    return{id:row.id,status:row.status,inputSha256:row.input_sha256,startedAt:row.started_at,updatedAt:row.updated_at,
      request:JSON.parse(row.request),progress:JSON.parse(row.progress),result:row.result?JSON.parse(row.result):null,error:row.error?JSON.parse(row.error):null};
  }
  state(){
    if(this.closed)throw fault('SUPERSET_WORKSPACE_CLOSED','The workspace is closed.',409);
    return{schema:WORKSPACE_SCHEMA,workspaceId:this.meta('workspace_id'),revision:this.revision(),
      selectedEditionId:this.meta('selected_edition_id'),createdAt:this.meta('created_at'),
      ...Object.fromEntries(KINDS.map(kind=>[kind,this.list(kind)])),
      buyers:this.list('buyers').map(buyer=>({...buyer,commands:this.buyerCommands(buyer)})),
      operations:this.db.prepare('SELECT id,status,started_at,updated_at,error FROM operations ORDER BY rowid DESC LIMIT 100').all()
        .map(row=>({id:row.id,status:row.status,startedAt:row.started_at,updatedAt:row.updated_at,error:row.error?JSON.parse(row.error):null})),
      operationCount:this.db.prepare('SELECT COUNT(*) AS n FROM operations').get().n,
      connectionRequirements:[...new Set(this.list('sources').flatMap(source=>{
        const auth=this.get('sources',source.id).options.auth;
        return Object.entries(auth).filter(([name])=>name.endsWith('Env')).map(([,name])=>name);
      }))]};
  }
  serial(fn){
    if(this.closing||this.closed)return Promise.reject(fault('SUPERSET_WORKSPACE_CLOSED','The workspace is closing.',409));
    const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;
  }
  cancel(operationId){
    const current=this.operation(operationId);
    if(this.active?.id===operationId)this.active.controller.abort();
    else if(current.status==='QUEUED')this.db.prepare("UPDATE operations SET status='CANCELLED',updated_at=? WHERE id=?").run(now(),operationId);
    return{...this.operation(operationId),cancellationRequested:['QUEUED','RUNNING'].includes(current.status)};
  }
  buyerCommands(buyer){
    const shell=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
    const root=join(this.directory,'buyers',id(buyer.id)),session=join(root,'session'),config=join(root,'buyer.json');
    return{initialize:'starforge-merchant superset buyer init --session '+shell(session)+' --config '+shell(config)+' --max-pages 100 --max-total-atomic YOUR_REVIEWED_TOTAL',
      run:'starforge-merchant superset buyer run --session '+shell(session),
      recover:'starforge-merchant superset buyer recover --session '+shell(session)};
  }
  captureDetail(captureId,{queryOrdinal=0,offset=0,limit=50}={}){
    if(!Number.isSafeInteger(queryOrdinal)||queryOrdinal<0||!Number.isSafeInteger(offset)||offset<0||
        !Number.isSafeInteger(limit)||limit<1||limit>250)throw fault('SUPERSET_CAPTURE_PAGE','Choose an original query and a page of 1–250 rows.');
    const capture=this.get('captures',captureId),native=readCapture(capture,hash=>this.bytes(hash));
    const query=native.queries[queryOrdinal],original=native.exact[queryOrdinal];
    if(!query)throw fault('SUPERSET_CAPTURE_QUERY','Choose an original query ordinal.',404);
    return{capture:small('captures',capture),metadata:native.metadata,context:native.context,queries:native.queries,
      principal:capture.source.principal,queryOrdinal,offset,limit,total:query.rows,
      rows:Array.isArray(original.data)?original.data.slice(offset,offset+limit).map(row=>query.columns.map(column=>{
        const state=!Object.prototype.hasOwnProperty.call(row,column.name)?'missing':row[column.name]===null?'null':'value';
        return{name:column.name,state,value:state==='value'?stringifyExact(row[column.name]):null};
      })):[]};
  }
  inventory(sourceId,options={}){
    return this.serial(async()=>{
      const source=this.get('sources',sourceId);
      return new SupersetClient(source.options,{env:this.env,fetchImpl:this.fetchImpl}).inventory(options);
    });
  }
  dispatch(action,input){
    if(!object(input))return Promise.reject(fault('SUPERSET_OPERATION_INPUT','Supply an operation object.'));
    input=JSON.parse(JSON.stringify(input));id(input.operationId,'operation');
    const retry=input.retry===true,request={action,input:{...input}};delete request.input.retry;
    const inputSha256=identity(request);
    let prior;
    try{prior=this.operation(input.operationId);}catch(e){if(e.code!=='SUPERSET_OPERATION_MISSING')throw e;}
    if(prior){
      if(prior.inputSha256!==inputSha256)throw fault('SUPERSET_OPERATION_CONFLICT','The same operation ID is bound to different work.',409);
      if(prior.status==='COMPLETED')return Promise.resolve(prior);
      if(this.pending.has(input.operationId))return this.pending.get(input.operationId);
      if(!retry)return Promise.resolve(prior);
    }
    if(this.closing||this.closed)return Promise.reject(fault('SUPERSET_WORKSPACE_CLOSED','The workspace is closing.',409));
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==this.revision())
      throw fault('SUPERSET_REVISION_CHANGED','Refresh the workspace before committing this reviewed operation.',409);
    const startedAt=prior?.startedAt??now(),previousProgress=prior?.progress??[];
    this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,error=NULL')
      .run(input.operationId,inputSha256,JSON.stringify(request),'QUEUED',startedAt,now(),JSON.stringify(previousProgress),null,null);
    const operation=this.serial(async()=>{
      if(this.operation(input.operationId).status==='CANCELLED')return this.operation(input.operationId);
      const controller=new AbortController();
      const update=async progress=>{
        previousProgress.push(progress);
        this.db.prepare('UPDATE operations SET progress=?,updated_at=? WHERE id=?').run(JSON.stringify(previousProgress),now(),input.operationId);
      };
      try{
        if(this.closing)throw fault('SUPERSET_PROCESS_INTERRUPTED','The workspace closed before this queued operation started.',409);
        if(input.expectedRevision!==this.revision())throw fault('SUPERSET_REVISION_CHANGED','An earlier committed operation changed the reviewed revision.',409);
        this.db.prepare("UPDATE operations SET status='RUNNING',updated_at=? WHERE id=?").run(now(),input.operationId);
        this.active={id:input.operationId,controller};
        const result=await this.execute(action,input,{startedAt,signal:controller.signal,update});
        this.db.exec('BEGIN IMMEDIATE');
        try{
          let record=null;
          if(result.record)record=this.put(result.kind,result.record);
          if(result.selectEditionId)this.setMeta('selected_edition_id',result.selectEditionId);
          this.setMeta('revision',this.revision()+1);
          const returned={revision:this.revision(),kind:result.kind??null,record:record?small(result.kind,record):null,...(result.extra??{})};
          this.db.prepare('UPDATE operations SET status=?,updated_at=?,result=?,error=NULL WHERE id=?')
            .run('COMPLETED',now(),JSON.stringify(returned),input.operationId);
          this.db.exec('COMMIT');
        }catch(error){this.db.exec('ROLLBACK');throw error;}
      }catch(error){
        const safe={code:typeof error.code==='string'?error.code:'SUPERSET_OPERATION_FAILED',
          message:error.code?error.message:'The original operation did not complete.',nativeStatus:error.nativeStatus??null,job:error.job??null};
        this.db.prepare('UPDATE operations SET status=?,updated_at=?,error=? WHERE id=?')
          .run(controller.signal.aborted?'CANCELLED':error.code==='SUPERSET_PROCESS_INTERRUPTED'?'INTERRUPTED':'FAILED',now(),JSON.stringify(safe),input.operationId);
      }finally{if(this.active?.id===input.operationId)this.active=null;}
      return this.operation(input.operationId);
    });
    this.pending.set(input.operationId,operation);
    operation.finally(()=>this.pending.delete(input.operationId)).catch(()=>{});
    return operation;
  }
  async execute(action,input,{startedAt,signal,update}){
    const recordId=input.recordId??action+'-'+input.operationId;id(recordId);
    if(action==='source'){
      return{kind:'sources',record:{id:recordId,createdAt:startedAt,label:label(input.label),options:sourceOptions(input.options)}};
    }
    if(action==='capture'){
      const source=this.get('sources',input.sourceId);
      const client=new SupersetClient(source.options,{env:this.env,fetchImpl:this.fetchImpl,signal,
        retain:async raw=>this.blob(raw),onProgress:update});
      const capture=await client.capture({chartId:input.chartId,force:input.force??false});
      const unsigned={...capture,id:recordId,createdAt:startedAt,label:label(input.label??'Chart '+input.chartId),sourceId:source.id};
      const bound={...unsigned,sha256:identity(unsigned)};
      const native=readCapture(bound,hash=>this.bytes(hash));
      return{kind:'captures',record:{...unsigned,queries:native.queries}};
    }
    if(action==='edition'){
      const capture=this.get('captures',input.captureId);
      const built=buildEdition(capture,hash=>this.bytes(hash),input.selection);
      const csv=this.blob(built.csv),config=this.blob(bytes(built.config)),lineage=this.blob(bytes(built.lineage));
      const staged=await this.materialize(recordId,csv.sha256,config.sha256);
      const dataset=await loadDatasetConfig(staged.datasetPath),description=dataset.describe();
      return{kind:'editions',selectEditionId:recordId,record:{id:recordId,createdAt:startedAt,label:built.selection.name,
        captureId:capture.id,selection:built.selection,csv,config,lineage,rows:description.rowCount,snapshot:description.snapshot,
        definitionSha256:built.semantics.definitionSha256,semanticsSha256:built.semantics.sha256}};
    }
    if(action==='review'){
      const edition=this.get('editions',input.editionId);
      if(input.editionSha256!==edition.sha256||!['approved','rejected'].includes(input.decision))
        throw fault('SUPERSET_REVIEW_CHANGED','Review the exact retained edition identity.',409);
      return{kind:'reviews',record:{id:recordId,createdAt:startedAt,editionId:edition.id,editionSha256:edition.sha256,
        decision:input.decision,actor:label(input.actor,128),note:label(input.note,2000),distributionBasis:label(input.distributionBasis,4000)}};
    }
    if(action==='compare'){
      const left=this.get('editions',input.beforeId),right=this.get('editions',input.afterId);
      const compared=compareEditions({capture:this.get('captures',left.captureId),selection:left.selection},
        {capture:this.get('captures',right.captureId),selection:right.selection},hash=>this.bytes(hash));
      const counts=Object.fromEntries(['beforeRows','afterRows','unchanged','added','removed','changed','keyMode'].map(key=>[key,compared[key]]));
      return{kind:'comparisons',record:{id:recordId,createdAt:startedAt,beforeId:left.id,afterId:right.id,
        beforeSha256:left.sha256,afterSha256:right.sha256,counts,comparison:compared}};
    }
    if(action==='select'){
      const edition=this.get('editions',input.editionId);return{selectEditionId:edition.id,extra:{editionId:edition.id}};
    }
    if(action==='prepare-merchant'){
      const edition=this.get('editions',input.editionId);
      const exported=await this.exportDatasetNow(edition.id,join(this.directory,'exports','merchant-source-'+recordId));
      const {prepareSupersetMerchant}=await import('./merchant.mjs');
      const previous=input.targetMerchantId?this.get('merchants',input.targetMerchantId):null;
      const versionGroup=previous?.versionGroup??previous?.id??recordId;
      const prepared=await prepareSupersetMerchant({editionExport:exported,
        directory:join(this.directory,'merchants',recordId),datasetDirectory:join(this.directory,'versions',versionGroup),
        publicOrigin:input.publicOrigin,path:input.path,payment:input.payment,manifestUrl:input.manifestUrl});
      return{kind:'merchants',record:{id:recordId,createdAt:startedAt,label:label(input.label??edition.label),
        editionId:edition.id,editionSha256:edition.sha256,snapshot:edition.snapshot,resource:prepared.resource,
        preparedRelative:'merchants/'+recordId,versionGroup,reviewId:exported.lineage.review.id,
        definition:{publicOrigin:input.publicOrigin,path:input.path??'/report-data',payment:input.payment},sourceSha256:prepared.binding.sourceSha256}};
    }
    if(action==='publish'){
      const merchant=this.get('merchants',input.merchantId);
      const {publishSupersetMerchant}=await import('./merchant.mjs');
      const result=await publishSupersetMerchant({directory:join(this.directory,merchant.preparedRelative),
        expectedSnapshot:input.expectedSnapshot,expectedRevision:input.expectedNativeRevision});
      return{kind:'publications',record:{id:recordId,createdAt:startedAt,merchantId:merchant.id,
        editionId:merchant.editionId,snapshot:result.snapshot,native:result}};
    }
    if(action==='prepare-buyer'){
      const merchant=this.get('merchants',input.merchantId),root=join(this.directory,'buyers',recordId);
      await privateDirectory(root,true);
      const {prepareSupersetBuyer}=await import('./customer.mjs');
      const prepared=await prepareSupersetBuyer({directory:join(this.directory,merchant.preparedRelative),seller:input.seller,
        query:input.query??{},intentId:input.intentId,acceptIndex:input.acceptIndex,offerSha256:input.offerSha256,
        destination:join(root,'buyer.json')});
      const shell=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
      const session=join(root,'session'),config=join(root,'buyer.json');
      return{kind:'buyers',record:{id:recordId,createdAt:startedAt,merchantId:merchant.id,editionId:merchant.editionId,
        snapshot:prepared.snapshot,configurationSha256:prepared.configSha256,configuration:this.blob(Buffer.from(prepared.configText)),relative:'buyers/'+recordId,
        commands:{initialize:'starforge-merchant superset buyer init --session '+shell(session)+' --config '+shell(config)+' --max-pages 100 --max-total-atomic YOUR_REVIEWED_TOTAL',
          run:'starforge-merchant superset buyer run --session '+shell(session),
          recover:'starforge-merchant superset buyer recover --session '+shell(session)}}};
    }
    if(action==='receive-buyer'){
      const buyer=this.get('buyers',input.buyerId),merchant=this.get('merchants',buyer.merchantId);
      const {receiveSupersetBuyer}=await import('./customer.mjs'),relative='deliveries/'+recordId;
      const result=await receiveSupersetBuyer({directory:join(this.directory,merchant.preparedRelative),
        sessionDirectory:join(this.directory,buyer.relative,'session'),destination:join(this.directory,relative),
        includeSourceCaptures:input.includeSourceCaptures??false});
      const files=[];
      for(const member of result.manifest.files){
        const raw=await readPrivate(join(this.directory,relative,member.path),member.bytes);
        if(raw.length!==member.bytes||digest(raw)!==member.sha256)throw fault('SUPERSET_DELIVERY_CHANGED','An original delivered file changed.',409);
        files.push({path:member.path,...this.blob(raw)});
      }
      const manifestRaw=await readPrivate(join(this.directory,relative,'delivery.json'),16*MiB);
      files.push({path:'delivery.json',...this.blob(manifestRaw)});
      return{kind:'deliveries',record:{id:recordId,createdAt:startedAt,buyerId:buyer.id,editionId:buyer.editionId,
        snapshot:buyer.snapshot,rows:result.manifest.rows,pages:result.manifest.pages,
        deliverySha256:result.manifest.sha256,relative,files}};
    }
    if(action==='replay'){
      const edition=this.get('editions',input.editionId),capture=this.get('captures',edition.captureId);
      const rebuilt=buildEdition(capture,hash=>this.bytes(hash),edition.selection);
      if(digest(rebuilt.csv)!==edition.csv.sha256||digest(bytes(rebuilt.config))!==edition.config.sha256||
          digest(bytes(rebuilt.lineage))!==edition.lineage.sha256)
        throw fault('SUPERSET_REPLAY_CHANGED','The current projection differs from the original retained source.',409);
      const native=await loadDatasetConfig((await this.materialize(edition.id,edition.csv.sha256,edition.config.sha256)).datasetPath);
      if(native.describe().snapshot!==edition.snapshot)throw fault('SUPERSET_REPLAY_CHANGED','The original native dataset snapshot differs.',409);
      return{extra:{editionId:edition.id,snapshot:edition.snapshot,rows:edition.rows,sourceReplayed:true}};
    }
    throw fault('SUPERSET_ACTION','Unknown workspace action.');
  }
  async materialize(editionId,csvSha256,configSha256){
    const root=join(this.directory,'datasets',id(editionId));
    await privateDirectory(root,true);
    await saveExact(join(root,'dataset.csv'),this.bytes(csvSha256));
    await saveExact(join(root,'dataset.json'),this.bytes(configSha256));
    return{directory:root,datasetPath:join(root,'dataset.json')};
  }
  query(editionId,query={}){
    return this.serial(async()=>{
      const edition=this.get('editions',editionId),staged=await this.materialize(edition.id,edition.csv.sha256,edition.config.sha256);
      const dataset=await loadDatasetConfig(staged.datasetPath);
      if(dataset.describe().snapshot!==edition.snapshot)throw fault('SUPERSET_SNAPSHOT_CHANGED','The retained native snapshot differs.',409);
      const context={query},admitted=dataset.admit(context);
      return admitted===true?dataset.handle(context):admitted;
    });
  }
  exportDataset(editionId,destination){return this.serial(()=>this.exportDatasetNow(editionId,destination));}
  async exportDatasetNow(editionId,destination,{reviewId}={}){
    const edition=this.get('editions',editionId),capture=this.get('captures',edition.captureId);
    const reviewSummary=reviewId?this.get('reviews',reviewId):this.list('reviews').filter(r=>r.editionId===edition.id&&r.editionSha256===edition.sha256).at(-1);
    const review=reviewSummary?this.get('reviews',reviewSummary.id):null;
    if(review?.decision!=='approved'||review.editionId!==edition.id||review.editionSha256!==edition.sha256)throw fault('SUPERSET_REVIEW_REQUIRED','Approve the exact fields, source scope and distribution basis before preparing this merchant edition.',409);
    destination=absolute(destination);await privateDirectory(destination,true);
    const csv=this.bytes(edition.csv.sha256),config=this.bytes(edition.config.sha256);
    const lineage={...decode(this.bytes(edition.lineage.sha256)),workspaceId:this.meta('workspace_id'),
      edition:{id:edition.id,sha256:edition.sha256,createdAt:edition.createdAt,snapshot:edition.snapshot},review};
    await saveExact(join(destination,'dataset.csv'),csv);await saveExact(join(destination,'dataset.json'),config);
    await saveExact(join(destination,'lineage.json'),lineage);await saveExact(join(destination,'capture.json'),capture);
    await saveExact(join(destination,'edition.json'),edition);await saveExact(join(destination,'review.json'),review);
    const members=[
      {path:'lineage.json',bytes:bytes(lineage).length,sha256:digest(bytes(lineage))},
      {path:'capture.json',bytes:bytes(capture).length,sha256:digest(bytes(capture))},
      {path:'edition.json',bytes:bytes(edition).length,sha256:digest(bytes(edition))},
      {path:'review.json',bytes:bytes(review).length,sha256:digest(bytes(review))}
    ];
    for(const entry of capture.entries){
      const name='responses/'+entry.body.sha256+'.json';
      if(members.some(m=>m.path===name))continue;
      await saveExact(join(destination,name),this.bytes(entry.body.sha256));members.push({path:name,...entry.body});
    }
    members.sort((a,b)=>a.path.localeCompare(b.path));
    await saveExact(join(destination,'source-files.json'),{schema:'stellar-forge.superset-source-files.v1',files:members});
    const native=await loadDatasetConfig(join(destination,'dataset.json'));
    if(native.describe().snapshot!==edition.snapshot)throw fault('SUPERSET_EXPORT_CHANGED','The exported native snapshot differs.',409);
    return{directory:destination,edition:small('editions',edition),lineage,capture,sourceFiles:members,snapshot:edition.snapshot};
  }
  materializeMerchant(merchantId){
    return this.serial(async()=>{
      const merchant=this.get('merchants',merchantId);
      if(merchant.preparedRelative!=='merchants/'+merchant.id||!ID.test(merchant.versionGroup??merchant.id))
        throw fault('SUPERSET_MERCHANT_PATH','The retained merchant path differs from its original ID.',409);
      const exported=await this.exportDatasetNow(merchant.editionId,
        join(this.directory,'exports','merchant-source-'+merchant.id),{reviewId:merchant.reviewId});
      const {prepareSupersetMerchant}=await import('./merchant.mjs');
      const result=await prepareSupersetMerchant({editionExport:exported,
        directory:join(this.directory,merchant.preparedRelative),
        datasetDirectory:join(this.directory,'versions',merchant.versionGroup??merchant.id),...merchant.definition});
      if(result.binding.sourceSha256!==merchant.sourceSha256)throw fault('SUPERSET_MERCHANT_REOPEN_CHANGED','The original merchant source changed on receiving.',409);
      return result;
    });
  }
  materializeDelivery(deliveryId){
    return this.serial(async()=>{
      const delivery=this.get('deliveries',deliveryId);
      if(delivery.relative!=='deliveries/'+delivery.id||!Array.isArray(delivery.files))
        throw fault('SUPERSET_DELIVERY_PATH','The retained delivery path differs from its original ID.',409);
      const root=join(this.directory,delivery.relative);
      for(const file of delivery.files){
        if(typeof file.path!=='string'||file.path.startsWith('/')||file.path.includes('\\')||
            file.path.split('/').some(p=>!p||p==='.'||p==='..'))throw fault('SUPERSET_DELIVERY_PATH','An original received member path is invalid.');
        const raw=this.bytes(file.sha256);
        if(raw.length!==file.bytes)throw fault('SUPERSET_DELIVERY_CHANGED','An original delivered member changed.',409);
        await saveExact(join(root,file.path),raw);
      }
      const {inspectSupersetDelivery}=await import('./customer.mjs');
      const result=await inspectSupersetDelivery(root);
      if(result.manifest.sha256!==delivery.deliverySha256)throw fault('SUPERSET_DELIVERY_CHANGED','The delivered customer identity changed on receiving.',409);
      return result;
    });
  }
  exportFile(kind,recordId){
    return this.serial(async()=>{
      const root=join(this.directory,'downloads');await privateDirectory(root,true);
      if(kind==='workspace'){
        const temporary=join(root,'workspace.partial-'+randomUUID());
        try{
          this.db.exec("VACUUM INTO '"+temporary.replaceAll("'","''")+"'");
          await chmod(temporary,0o600);
          const handle=await open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
          const actual=await hashPrivate(temporary,2*1024*MiB);
          const name='superset-'+this.meta('workspace_id')+'-r'+this.revision()+'-'+actual.hash.slice(0,16)+'.sqlite3',file=join(root,name);
          try{await link(temporary,file);await syncDirectory(root);}
          catch(error){
            if(error.code!=='EEXIST')throw error;
            const prior=await hashPrivate(file,2*1024*MiB);
            if(prior.hash!==actual.hash||prior.bytes!==actual.bytes)throw fault('SUPERSET_EXPORT_CHANGED','An existing complete workspace export differs.',409);
          }
          return{file,name,contentType:'application/vnd.sqlite3',bytes:actual.bytes,sha256:actual.hash};
        }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      }
      let content,name,type='application/json; charset=utf-8';
      if(kind==='capture'){content=bytes(this.get('captures',recordId));name='capture-'+recordId+'.json';}
      else if(kind==='comparison'){content=bytes(this.get('comparisons',recordId));name='comparison-'+recordId+'.json';}
      else if(kind==='csv'){const edition=this.get('editions',recordId);content=this.bytes(edition.csv.sha256);name='edition-'+recordId+'.csv';type='text/csv; charset=utf-8';}
      else if(kind==='lineage'){content=this.bytes(this.get('editions',recordId).lineage.sha256);name='lineage-'+recordId+'.json';}
      else throw fault('SUPERSET_EXPORT_KIND','Choose a complete workspace, original capture, comparison, lineage or CSV.');
      const file=join(root,name);await saveExact(file,content);
      return{file,name,contentType:type,bytes:content.length,sha256:digest(content)};
    });
  }
  close(){
    if(this.closePromise)return this.closePromise;
    this.closing=true;this.active?.controller.abort();
    this.closePromise=(async()=>{await this.tail;try{this.db.close();}finally{this.closed=true;await this.unlock();}})();
    return this.closePromise;
  }
}
export async function openSupersetWorkspace({directory,env=process.env,fetchImpl=globalThis.fetch}={}){
  directory=absolute(resolve(directory));await privateDirectory(directory,true);
  const unlock=await acquireWorkspace(directory);let db;
  try{
    const file=join(directory,WORKSPACE_FILE);
    try{const handle=await open(file,'wx',0o600);await handle.close();}catch(e){if(e.code!=='EEXIST')throw e;}
    const stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.mode&0o077)throw fault('SUPERSET_PRIVATE_DATABASE','Use a private original workspace database.');
    db=new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout=10000; PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    const applicationId=Number(db.prepare('PRAGMA application_id').get().application_id);
    if(applicationId===0&&db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get().n===0){
      db.exec('BEGIN IMMEDIATE');
      try{
        db.exec('PRAGMA application_id='+APP_ID);for(const sql of TABLES)db.exec(sql);
        const meta=db.prepare('INSERT INTO meta VALUES(?,?)');
        for(const [key,value]of Object.entries({schema:WORKSPACE_SCHEMA,workspace_id:randomUUID(),created_at:now(),revision:0,selected_edition_id:null}))
          meta.run(key,JSON.stringify(value));
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      await syncDirectory(directory);
    }else if(applicationId!==APP_ID)throw fault('SUPERSET_WORKSPACE_FORMAT','The selected file is not a Superset workspace.');
    const workspace=new SupersetWorkspace({directory,db,unlock,env,fetchImpl});
    if(workspace.meta('schema')!==WORKSPACE_SCHEMA)throw fault('SUPERSET_WORKSPACE_FORMAT','Unsupported Superset workspace version.');
    db.prepare("UPDATE operations SET status='INTERRUPTED',updated_at=?,error=? WHERE status IN ('RUNNING','QUEUED')")
      .run(now(),JSON.stringify({code:'SUPERSET_PROCESS_INTERRUPTED',message:'The original process ended before completing this operation. Its retained reads are preserved; retry the same operation explicitly.'}));
    return workspace;
  }catch(e){db?.close();await unlock();throw e;}
}
export async function receiveSupersetWorkspace({file,directory}={}){
  file=absolute(resolve(file));directory=absolute(resolve(directory));
  const sourceIdentity=await hashPrivate(file,2*1024*MiB);
  await privateDirectory(directory,true);
  const unlock=await acquireWorkspace(directory),finalFile=join(directory,WORKSPACE_FILE);
  let source,target;
  const receiving={schema:'stellar-forge.superset-receiving.v1',bytes:sourceIdentity.bytes,sha256:sourceIdentity.hash};
  try{
    let exists=true;try{await lstat(finalFile);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
    if(exists){
      const prior=new DatabaseSync(finalFile,{readOnly:true});
      try{
        prior.exec('PRAGMA trusted_schema=OFF');
        const row=prior.prepare('SELECT value FROM meta WHERE key=?').get('receiving_source');
        if(!row||identity(JSON.parse(row.value))!==identity(receiving))throw fault('SUPERSET_RECEIVING_EXISTS','The destination retains another workspace.',409);
      }finally{prior.close();}
    }else{
      source=new DatabaseSync(file,{readOnly:true});source.exec('PRAGMA trusted_schema=OFF;BEGIN');
      if(Number(source.prepare('PRAGMA application_id').get().application_id)!==APP_ID||
          source.prepare('PRAGMA quick_check').get().quick_check!=='ok')
        throw fault('SUPERSET_RECEIVING_FORMAT','Choose a complete original Superset workspace.');
      const tableNames=['meta','blobs','records','operations'];
      for(let i=0;i<tableNames.length;i++){
        const row=source.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?').get(tableNames[i]);
        if(!row||row.type!=='table'||row.sql!==TABLES[i])throw fault('SUPERSET_RECEIVING_SCHEMA','The original workspace schema differs.');
      }
      const metadata=source.prepare('SELECT key,value FROM meta').all(),values=new Map(metadata.map(r=>[r.key,JSON.parse(r.value)]));
      if(values.get('schema')!==WORKSPACE_SCHEMA||!Number.isSafeInteger(values.get('revision'))||values.get('revision')<0)
        throw fault('SUPERSET_RECEIVING_FORMAT','The retained workspace metadata is invalid.');
      const stage=join(directory,'receiving-stage');target=await openSupersetWorkspace({directory:stage});
      const prior=target.meta('receiving_source');
      if(prior&&identity(prior)!==identity(receiving))throw fault('SUPERSET_RECEIVING_CHANGED','The retained stage belongs to another source.',409);
      if(!prior){
        if(target.revision()!==0||target.state().operationCount||KINDS.some(k=>target.list(k).length))
          throw fault('SUPERSET_RECEIVING_CHANGED','The receiving stage contains other work.',409);
        target.db.exec('BEGIN IMMEDIATE');
        try{
          target.db.exec('DELETE FROM meta');
          for(const row of metadata)target.db.prepare('INSERT INTO meta VALUES(?,?)').run(row.key,row.value);
          for(const row of source.prepare('SELECT sha256,bytes,data FROM blobs').iterate()){
            if(!HASH.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>MAX_BLOB)throw fault('SUPERSET_RECEIVING_BLOB','An original source identity is invalid.');
            const raw=gunzipSync(row.data,{maxOutputLength:MAX_BLOB});
            if(raw.length!==row.bytes||digest(raw)!==row.sha256)throw fault('SUPERSET_RECEIVING_BLOB','An original source file failed its digest.');
            target.db.prepare('INSERT INTO blobs VALUES(?,?,?)').run(row.sha256,row.bytes,row.data);
          }
          for(const row of source.prepare('SELECT kind,id,sha256,summary,body FROM records').iterate()){
            if(!KINDS.includes(row.kind))throw fault('SUPERSET_RECEIVING_RECORD','Unknown original record kind.');
            const raw=gunzipSync(row.body,{maxOutputLength:MAX_BLOB}),doc=decode(raw),{sha256,...unsigned}=doc;
            if(!ID.test(row.id)||digest(raw)!==row.sha256||identity(unsigned)!==sha256||doc.id!==row.id||identity(small(row.kind,doc))!==identity(JSON.parse(row.summary)))
              throw fault('SUPERSET_RECEIVING_RECORD','An original record or summary failed its identity.');
            target.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(row.kind,row.id,row.sha256,row.summary,row.body);
          }
          for(const row of source.prepare('SELECT * FROM operations').iterate()){
            const request=JSON.parse(row.request);
            if(!ID.test(row.id)||identity(request)!==row.input_sha256||!['COMPLETED','FAILED','INTERRUPTED','CANCELLED','RUNNING','QUEUED'].includes(row.status))
              throw fault('SUPERSET_RECEIVING_OPERATION','An original operation identity is invalid.');
            JSON.parse(row.progress);if(row.result)JSON.parse(row.result);if(row.error)JSON.parse(row.error);
            target.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,row.input_sha256,row.request,row.status,row.started_at,row.updated_at,row.progress,row.result,row.error);
          }
          for(const summary of target.list('sources'))sourceOptions(target.get('sources',summary.id).options);
          for(const summary of target.list('captures'))readCapture(target.get('captures',summary.id),hash=>target.bytes(hash));
          for(const summary of target.list('editions')){
            const edition=target.get('editions',summary.id),capture=target.get('captures',edition.captureId);
            const rebuilt=buildEdition(capture,hash=>target.bytes(hash),edition.selection);
            if(digest(rebuilt.csv)!==edition.csv.sha256||digest(bytes(rebuilt.config))!==edition.config.sha256||
                digest(bytes(rebuilt.lineage))!==edition.lineage.sha256)throw fault('SUPERSET_RECEIVING_EDITION','The original source projection differs.');
          }
          for(const item of target.list('reviews')){
            const review=target.get('reviews',item.id),edition=target.get('editions',review.editionId);
            if(review.editionSha256!==edition.sha256||!['approved','rejected'].includes(review.decision))
              throw fault('SUPERSET_RECEIVING_REVIEW','An original review is bound to another edition.');
          }
          for(const item of target.list('merchants')){
            const merchant=target.get('merchants',item.id),edition=target.get('editions',merchant.editionId),review=target.get('reviews',merchant.reviewId);
            if(merchant.preparedRelative!=='merchants/'+merchant.id||!ID.test(merchant.versionGroup??merchant.id)||
                merchant.editionSha256!==edition.sha256||merchant.snapshot!==edition.snapshot||
                review.editionId!==edition.id||review.editionSha256!==edition.sha256||review.decision!=='approved')
              throw fault('SUPERSET_RECEIVING_MERCHANT','An original merchant differs from its reviewed edition.');
          }
          for(const item of target.list('buyers')){
            const buyer=target.get('buyers',item.id),merchant=target.get('merchants',buyer.merchantId);
            if(buyer.relative!=='buyers/'+buyer.id||buyer.editionId!==merchant.editionId||buyer.snapshot!==merchant.snapshot||
                buyer.configurationSha256!==buyer.configuration?.sha256||target.bytes(buyer.configurationSha256).length!==buyer.configuration.bytes)
              throw fault('SUPERSET_RECEIVING_BUYER','An original buyer configuration differs from its merchant.');
          }
          for(const item of target.list('deliveries')){
            const delivery=target.get('deliveries',item.id),buyer=target.get('buyers',delivery.buyerId);
            if(delivery.relative!=='deliveries/'+delivery.id||!Array.isArray(delivery.files)||delivery.snapshot!==buyer.snapshot||delivery.editionId!==buyer.editionId)
              throw fault('SUPERSET_RECEIVING_DELIVERY','An original delivery differs from its buyer.');
          }
          target.setMeta('receiving_source',receiving);target.db.exec('COMMIT');
        }catch(e){target.db.exec('ROLLBACK');throw e;}
      }
      await target.close();target=null;
      const stageFile=join(stage,WORKSPACE_FILE);
      await rename(stageFile,finalFile);await syncDirectory(stage);await syncDirectory(directory);
      source.exec('COMMIT');source.close();source=null;
    }
  }finally{try{await target?.close();source?.close();}finally{await unlock();}}
  const workspace=await openSupersetWorkspace({directory});
  try{
    // The original engine verifies every reconstructed public dataset on receiving.
    for(const summary of workspace.list('editions')){
      const edition=workspace.get('editions',summary.id),staged=await workspace.materialize(edition.id,edition.csv.sha256,edition.config.sha256);
      const native=await loadDatasetConfig(staged.datasetPath);
      if(native.describe().snapshot!==edition.snapshot)throw fault('SUPERSET_RECEIVING_SNAPSHOT','The original dataset snapshot differs.',409);
    }
    for(const item of workspace.list('buyers')){
      const buyer=workspace.get('buyers',item.id);
      await saveExact(join(workspace.directory,'buyers',buyer.id,'buyer.json'),workspace.bytes(buyer.configurationSha256));
    }
    for(const item of workspace.list('deliveries'))await workspace.materializeDelivery(item.id);
    return{...workspace.state(),receiving};
  }finally{await workspace.close();}
}
