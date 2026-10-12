// MIT. CSV intake and resumable row work over the original geocoding workspace.
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createCsvRecordParser } from '../dataset-handler.mjs';
import { fields, object, identifier, productFor, bindGeocodeQuery, fail, text } from './config.mjs';
import { privateDirectory, readBytes, writeBytes, jsonBytes, digest, exists, readBundle, publishBundle } from '../twelvedata/files.mjs';

export const BATCH = 'stellar-forge.opencage-csv-batch.v1';
export const BATCH_REVIEW = 'stellar-forge.opencage-csv-review.v1';
export const MAX_CSV_BYTES = 2097152;
export const MAX_CSV_ROWS = 10000;
const HASH = /^[a-f0-9]{64}$/;
const BATCH_ID = /^csv-[a-f0-9]{20}$/;
const CAPTURE_ID = /^gb-([a-f0-9]{20})-([0-9a-z]+)-a([1-9][0-9]*)$/;
const errorCode = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'GEOCODE_BATCH_OPERATION_FAILED';
const now = () => new Date().toISOString();
const same = (a,b) => digest(jsonBytes(a)) === digest(jsonBytes(b));
const checkedBatch = id => { if(!BATCH_ID.test(id ?? '')) fail('GEOCODE_BATCH_ID_INVALID'); return id; };
const rowNumber = value => { if(!Number.isSafeInteger(value)||value<1||value>MAX_CSV_ROWS)fail('GEOCODE_BATCH_ROW_INVALID');return value; };
const scalar = value => value === null || ['string','number','boolean'].includes(typeof value);
const statusFor = value => !value.captureIdentity ? (value.state.state === 'PREPARED' ? 'READY' : 'NEEDS_RECONCILIATION')
  : value.state.providerStatus === 200 ? (value.candidates.length ? 'CANDIDATES' : 'NO_RESULTS') : 'EXCEPTION';
const requestId = (batchId,ordinal,attempt) => 'gb-'+batchId.slice(4)+'-'+ordinal.toString(36)+'-a'+attempt;
const compact = value => ({
  requestId:value.request.id,status:statusFor(value),outcome:value.state.outcome??value.state.state,
  responseSha256:value.responseSha256,captureIdentity:value.captureIdentity,candidateCount:value.candidates.length,
  decisionRevision:value.decision.revision,selectedIndex:value.decision.current?.index??null,
  dispatched:value.state.dispatched===true,providerStatus:value.state.providerStatus??null,
  applicationStatus:value.state.applicationStatus??null,finishedAt:value.state.finishedAt??null,
});
function csvSource(bytes) {
  bytes=Buffer.from(bytes);
  if(!bytes.length||bytes.length>MAX_CSV_BYTES)fail('GEOCODE_CSV_SIZE_INVALID','Choose a nonempty CSV file no larger than 2 MiB.');
  let decoded;
  try{decoded=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('GEOCODE_CSV_UTF8_REQUIRED');}
  const records=[];
  try{
    const parser=createCsvRecordParser(cells=>{
      if(records.length>MAX_CSV_ROWS)fail('GEOCODE_CSV_ROW_LIMIT','The entire CSV must fit within 10,000 data rows.');
      records.push([...cells]);
    },65536);
    parser.feed(decoded);parser.end();
  }catch(error){
    if(error.code)throw error;
    fail('GEOCODE_CSV_INVALID',String(error.message??'Invalid CSV').slice(0,250));
  }
  const headers=records.shift();
  if(!headers?.length||headers.length>256||headers.some(h=>!h||h.length>256||/[\x00-\x1f\x7f]/.test(h))||
      new Set(headers).size!==headers.length)fail('GEOCODE_CSV_HEADERS_INVALID','CSV headers must be nonempty, unique printable names.');
  if(!records.length)fail('GEOCODE_CSV_NO_DATA_ROWS');
  return {bytes,headers,records};
}
function mappingFor(product,headers,raw) {
  fields(raw,['idColumn','queryColumn','addressColumns','latitudeColumn','longitudeColumn','separator','options','optionColumns'],'CSV mapping');
  const column=value=>{
    if(typeof value!=='string'||!headers.includes(value))fail('GEOCODE_CSV_COLUMN_UNKNOWN');
    return value;
  };
  const result={idColumn:raw.idColumn==null?null:column(raw.idColumn),options:{},optionColumns:{}};
  if(raw.queryColumn!==undefined) {
    if(raw.addressColumns!==undefined||raw.latitudeColumn!==undefined||raw.longitudeColumn!==undefined)
      fail('GEOCODE_CSV_QUERY_MAPPING_CONFLICT');
    result.queryColumn=column(raw.queryColumn);
  } else if(product.mode==='reverse') {
    if(raw.addressColumns!==undefined||raw.separator!==undefined)fail('GEOCODE_CSV_REVERSE_MAPPING_INVALID');
    result.latitudeColumn=column(raw.latitudeColumn);result.longitudeColumn=column(raw.longitudeColumn);
    if(result.latitudeColumn===result.longitudeColumn)fail('GEOCODE_CSV_REVERSE_MAPPING_INVALID');
  } else {
    if(raw.latitudeColumn!==undefined||raw.longitudeColumn!==undefined||!Array.isArray(raw.addressColumns)||
        !raw.addressColumns.length||raw.addressColumns.length>16||new Set(raw.addressColumns).size!==raw.addressColumns.length)
      fail('GEOCODE_CSV_ADDRESS_MAPPING_INVALID');
    result.addressColumns=raw.addressColumns.map(column);
    result.separator=raw.separator??', ';
    if(typeof result.separator!=='string'||result.separator.length>20||/[\x00-\x1f\x7f]/.test(result.separator))
      fail('GEOCODE_CSV_SEPARATOR_INVALID');
  }
  fields(raw.options??{},product.options,'CSV fixed options');
  fields(raw.optionColumns??{},product.options,'CSV option columns');
  for(const key of Object.keys(raw.options??{}).sort()){
    const value=raw.options[key];
    if(!['string','number'].includes(typeof value))fail('GEOCODE_CSV_OPTION_INVALID');
    result.options[key]=value;
  }
  // Validate fixed options with an ordinary original query without using CSV row content.
  bindGeocodeQuery(product,{q:product.mode==='reverse'?'0,0':'review',...result.options});
  for(const key of Object.keys(raw.optionColumns??{}).sort()){
    if(Object.hasOwn(result.options,key))fail('GEOCODE_CSV_OPTION_MAPPING_CONFLICT');
    result.optionColumns[key]=column(raw.optionColumns[key]);
  }
  return result;
}
function mappedRows(product,source,mapping) {
  const position=new Map(source.headers.map((name,index)=>[name,index]));
  const at=(values,column)=>values[position.get(column)]??'';
  return source.records.map((values,index)=>{
    const ordinal=index+1,sourceId=mapping.idColumn===null?String(ordinal):at(values,mapping.idColumn);
    const row={ordinal,sourceId,values,query:null,querySha256:null,error:null};
    try{
      if(values.length!==source.headers.length)fail('GEOCODE_CSV_COLUMN_COUNT');
      const q=mapping.queryColumn!==undefined?at(values,mapping.queryColumn)
        :product.mode==='reverse'?at(values,mapping.latitudeColumn).trim()+','+at(values,mapping.longitudeColumn).trim()
        :mapping.addressColumns.map(column=>at(values,column).trim()).filter(Boolean).join(mapping.separator);
      const input={q,...mapping.options};
      for(const [name,column] of Object.entries(mapping.optionColumns)){
        const value=at(values,column).trim();if(value!=='')input[name]=value;
      }
      row.query=bindGeocodeQuery(product,input);
      row.querySha256=digest(jsonBytes({productId:product.id,query:row.query}));
    }catch(error){row.error=errorCode(error);}
    return row;
  });
}
function sourceIdentity(value) {
  return {requestId:value.request.id,productId:value.request.productId,query:value.request.query,
    querySha256:digest(jsonBytes({productId:value.request.productId,query:value.request.query})),
    responseSha256:value.responseSha256,captureIdentity:value.captureIdentity};
}
function reviewBody(configuration,source,product,mapping,{label,fileName,reuse,supersedesBatchId}) {
  const rows=mappedRows(product,source,mapping);
  const body={schema:BATCH_REVIEW,workspaceIdentity:configuration.identity,planSha256:configuration.planSha256,
    termsSha256:configuration.termsSha256,label:text(label??'Geocoding CSV','CSV label',120),
    fileName:text(fileName??'source.csv','CSV file name',200),productId:product.id,mode:product.mode,mapping,
    sourceSha256:digest(source.bytes),sourceBytes:source.bytes.length,headers:source.headers,
    rowCount:rows.length,validRows:rows.filter(row=>!row.error).length,
    invalidRows:rows.filter(row=>row.error).length,
    uniqueQueries:new Set(rows.filter(row=>!row.error).map(row=>row.querySha256)).size,
    rowsSha256:digest(jsonBytes(rows)),reuse,supersedesBatchId:supersedesBatchId??null};
  const reviewSha256=digest(jsonBytes(body));
  return {review:{...body,reviewSha256,batchId:'csv-'+reviewSha256.slice(0,20)},rows};
}
function page(options={}) {
  const {offset=0,limit=50,status}=options;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
    fail('GEOCODE_BATCH_PAGE_INVALID');
  if(status!==undefined&&!['READY','INVALID','CANDIDATES','NO_RESULTS','EXCEPTION','NEEDS_RECONCILIATION','SELECTED'].includes(status))
    fail('GEOCODE_BATCH_STATUS_INVALID');
  return {offset,limit,status};
}
function transaction(db,fn) {
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn();db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function getMeta(db,key){const row=db.prepare('SELECT value FROM metadata WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
function putMeta(db,key,value){db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}

export class GeocodeBatches {
  constructor(workspace){this.workspace=workspace;this.entries=new Map();this.active=null;this.closing=false;}
  async review({bytes,productId,mapping,label,fileName,reuseRequestIds=[],supersedesBatchId=null}) {
    const configuration=await this.workspace._configuration(),source=csvSource(bytes);
    const product=productFor(configuration.plan,identifier(productId));
    mapping=mappingFor(product,source.headers,mapping);
    if(!Array.isArray(reuseRequestIds)||reuseRequestIds.length>100||new Set(reuseRequestIds).size!==reuseRequestIds.length)
      fail('GEOCODE_CSV_REUSE_SELECTION_INVALID');
    const reuse=[];
    for(const id of reuseRequestIds){
      const value=await this.workspace.get(identifier(id));
      if(value.request.productId!==productId||!value.captureIdentity||value.state.providerStatus!==200)
        fail('GEOCODE_CSV_REUSE_RESULT_INVALID');
      reuse.push(sourceIdentity(value));
    }
    if(supersedesBatchId!==null)await this._load(checkedBatch(supersedesBatchId));
    const compiled=reviewBody(configuration,source,product,mapping,{label,fileName,reuse,supersedesBatchId});
    const cached=new Set(reuse.map(value=>value.querySha256));
    return {...compiled.review,estimatedFreshQueries:new Set(compiled.rows.filter(row=>!row.error&&!cached.has(row.querySha256)).map(row=>row.querySha256)).size,
      preview:compiled.rows.slice(0,50),previewCount:Math.min(compiled.rows.length,50)};
  }
  async prepare(input) {
    return this.workspace._serial(async()=>{
      const {expectedReviewSha256,...selection}=input;
      if(!HASH.test(expectedReviewSha256??''))fail('GEOCODE_CSV_REVIEW_REQUIRED');
      const reviewed=await this.review(selection);
      if(reviewed.reviewSha256!==expectedReviewSha256)fail('GEOCODE_CSV_REVIEW_CHANGED');
      const source=csvSource(selection.bytes),product=productFor(this.workspace.configuration.plan,reviewed.productId);
      const rows=mappedRows(product,source,reviewed.mapping);
      const {preview,previewCount,estimatedFreshQueries,...review}=reviewed;
      await privateDirectory(join(this.workspace.directory,'batches'));
      const directory=join(this.workspace.directory,'batches',review.batchId);
      await privateDirectory(directory);
      await publishBundle(join(directory,'intake'),BATCH,review.reviewSha256,
        [['source.csv',source.bytes],['review.json',jsonBytes(review)],['rows.json',jsonBytes(rows)]],
        {batchId:review.batchId,rowCount:review.rowCount,sourceSha256:review.sourceSha256});
      const entry=await this._load(review.batchId,{initialize:true});
      return this.status(review.batchId);
    });
  }
  async _load(id,{initialize=false}={}) {
    checkedBatch(id);
    if(this.entries.has(id))return this.entries.get(id);
    const root=join(this.workspace.directory,'batches',id);
    const intake=await readBundle(join(root,'intake'),{schema:BATCH});
    const review=JSON.parse(intake.files.get('review.json')??'null');
    const rows=JSON.parse(intake.files.get('rows.json')??'null'),source=csvSource(intake.files.get('source.csv')??[]);
    if(!object(review)||review.batchId!==id||review.workspaceIdentity!==this.workspace.configuration.identity||
        review.planSha256!==this.workspace.configuration.planSha256||review.termsSha256!==this.workspace.configuration.termsSha256)
      fail('GEOCODE_CSV_WORKSPACE_CHANGED');
    const product=productFor(this.workspace.configuration.plan,review.productId);
    const rebuilt=reviewBody(this.workspace.configuration,source,product,mappingFor(product,source.headers,review.mapping),review);
    if(!same(rebuilt.review,review)||!same(rebuilt.rows,rows)||intake.manifest.identity!==review.reviewSha256)
      fail('GEOCODE_CSV_INTAKE_CHANGED');
    const path=join(root,'progress.sqlite');
    if(!await exists(path)){
      if(!initialize||this.workspace.readOnly)fail('GEOCODE_CSV_PREPARATION_INCOMPLETE','Prepare this same reviewed source again to finish its progress index.');
      await writeBytes(path,Buffer.alloc(0),{exclusive:true});
    }
    const stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||await realpath(path)!==path||stat.size>268435456)fail('GEOCODE_CSV_INDEX_INVALID');
    let DatabaseSync;
    try{({DatabaseSync}=await import('node:sqlite'));}catch{fail('GEOCODE_CSV_NODE_SQLITE_REQUIRED','CSV work requires the installed Node runtime with node:sqlite.');}
    const db=new DatabaseSync(path,{readOnly:this.workspace.readOnly});
    try{
      db.exec('PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON');
      if(!this.workspace.readOnly){
        this.workspace.lease.assertHeld();
        db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL');
        transaction(db,()=>{
          db.exec('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);'+
            'CREATE TABLE IF NOT EXISTS rows(ordinal INTEGER PRIMARY KEY,request_id TEXT UNIQUE,status TEXT NOT NULL,attempt INTEGER NOT NULL,summary TEXT,updated_at TEXT NOT NULL);'+
            'CREATE TABLE IF NOT EXISTS attempts(ordinal INTEGER NOT NULL,attempt INTEGER NOT NULL,request_id TEXT UNIQUE NOT NULL,previous_request_id TEXT,reason TEXT,created_at TEXT NOT NULL,PRIMARY KEY(ordinal,attempt));'+
            'CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,state TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,note TEXT);'+
            'CREATE TABLE IF NOT EXISTS cache(query_sha256 TEXT PRIMARY KEY,source TEXT NOT NULL);');
          const binding=getMeta(db,'reviewSha256');
          if(binding!==null&&binding!==review.reviewSha256)fail('GEOCODE_CSV_INDEX_BINDING_CHANGED');
          if(binding===null){
            putMeta(db,'reviewSha256',review.reviewSha256);putMeta(db,'revision',0);
            const insert=db.prepare('INSERT INTO rows VALUES(?,?,?,?,?,?)');
            for(const row of rows)insert.run(row.ordinal,row.error?null:requestId(id,row.ordinal,1),row.error?'INVALID':'READY',1,null,now());
            for(const value of review.reuse)db.prepare('INSERT INTO cache VALUES(?,?) ON CONFLICT(query_sha256) DO NOTHING')
              .run(value.querySha256,JSON.stringify(value));
          }
        });
      }
      if(getMeta(db,'reviewSha256')!==review.reviewSha256||db.prepare('SELECT COUNT(*) AS n FROM rows').get().n!==rows.length)
        fail('GEOCODE_CSV_INDEX_BINDING_CHANGED');
      const entry={id,root,intake,review,rows,db};this.entries.set(id,entry);return entry;
    }catch(error){db.close();throw error;}
  }
  _changed(entry){putMeta(entry.db,'revision',(getMeta(entry.db,'revision')??0)+1);}
  _row(entry,ordinal) {
    rowNumber(ordinal);
    const native=entry.db.prepare('SELECT * FROM rows WHERE ordinal=?').get(ordinal),row=entry.rows[ordinal-1];
    if(!native||!row||row.ordinal!==ordinal||native.request_id!== (row.error?null:requestId(entry.id,ordinal,native.attempt)))
      fail('GEOCODE_CSV_ROW_BINDING_CHANGED');
    return {row,native};
  }
  async observe(value) {
    const parsed=CAPTURE_ID.exec(value.request.id);
    if(!parsed)return;
    const id='csv-'+parsed[1];
    if(!await exists(join(this.workspace.directory,'batches',id,'intake','manifest.json')))return;
    const entry=await this._load(id),ordinal=parseInt(parsed[2],36),{row,native}=this._row(entry,ordinal);
    if(native.request_id!==value.request.id)return;
    if(value.request.productId!==entry.review.productId||!same(value.request.query,row.query))
      fail('GEOCODE_CSV_CAPTURE_QUERY_CHANGED');
    if(this.workspace.readOnly)return;
    this.workspace.lease.assertHeld();
    const summary=compact(value),encoded=JSON.stringify(summary);
    if(native.summary===encoded&&native.status===summary.status)return;
    transaction(entry.db,()=>{
      entry.db.prepare('UPDATE rows SET status=?,summary=?,updated_at=? WHERE ordinal=?')
        .run(summary.status,encoded,now(),ordinal);
      if(summary.captureIdentity&&value.state.providerStatus===200)
        entry.db.prepare('INSERT INTO cache VALUES(?,?) ON CONFLICT(query_sha256) DO NOTHING')
          .run(row.querySha256,JSON.stringify(sourceIdentity(value)));
      this._changed(entry);
    });
  }
  async _readCurrent(entry,ordinal) {
    const {row,native}=this._row(entry,ordinal);
    if(!native.request_id)return {row,native,value:null};
    const path=join(this.workspace.directory,'requests',native.request_id,'request.json');
    if(!await exists(path))return {row,native,value:null};
    const value=await this.workspace.get(native.request_id);
    if(value.request.productId!==entry.review.productId||!same(value.request.query,row.query))fail('GEOCODE_CSV_CAPTURE_QUERY_CHANGED');
    await this.observe(value);
    return {row,native:this._row(entry,ordinal).native,value};
  }
  async list() {
    const root=join(this.workspace.directory,'batches');
    if(!await exists(root))return [];
    const results=[];
    for(const id of (await readdir(root)).sort()){
      if(!BATCH_ID.test(id))continue;
      const entry=await this._load(id);results.push(await this.status(id,{offset:0,limit:1,includeRows:false}));
    }
    return results;
  }
  async status(id,options={}) {
    const entry=await this._load(id),{offset,limit,status}=page(options),db=entry.db;
    const where=status==='SELECTED'?"json_extract(summary,'$.selectedIndex') IS NOT NULL":status?'status=?':'1=1';
    const params=status&&status!=='SELECTED'?[status]:[];
    const total=db.prepare('SELECT COUNT(*) AS n FROM rows WHERE '+where).get(...params).n;
    const selected=options.includeRows===false?[]:db.prepare('SELECT ordinal FROM rows WHERE '+where+' ORDER BY ordinal LIMIT ? OFFSET ?').all(...params,limit,offset);
    const rows=[];
    for(const item of selected){
      const {row,native,value}=await this._readCurrent(entry,item.ordinal);
      const summary=value?compact(value):native.summary?JSON.parse(native.summary):null;
      rows.push({...row,status:summary?.status??native.status,attempt:native.attempt,requestId:native.request_id,
        result:summary,attempts:db.prepare('SELECT attempt,request_id AS requestId,previous_request_id AS previousRequestId,reason,created_at AS createdAt FROM attempts WHERE ordinal=? ORDER BY attempt').all(row.ordinal)});
    }
    const counts=Object.fromEntries(db.prepare('SELECT status,COUNT(*) AS n FROM rows GROUP BY status').all().map(v=>[v.status,v.n]));
    const chosen=db.prepare("SELECT COUNT(*) AS n FROM rows WHERE json_extract(summary,'$.selectedIndex') IS NOT NULL").get().n;
    const latest=db.prepare('SELECT id,state,started_at AS startedAt,finished_at AS finishedAt,note FROM runs ORDER BY rowid DESC LIMIT 1').get()??null;
    if(latest&&['RUNNING','STOP_REQUESTED'].includes(latest.state)&&this.active?.runId!==latest.id)latest.state='INTERRUPTED';
    return {schema:BATCH,batchId:id,review:entry.review,revision:getMeta(db,'revision'),counts:{...counts,selected:chosen},
      active:this.active?.batchId===id?{runId:this.active.runId,stopRequested:this.active.stopRequested}:null,
      run:latest,total:entry.rows.length,filteredTotal:total,offset,rows,nextOffset:offset+limit<total?offset+limit:null};
  }
  async row(id,ordinal){
    const entry=await this._load(id),value=await this._readCurrent(entry,rowNumber(ordinal));
    return {batchId:id,row:value.row,attempt:value.native.attempt,requestId:value.native.request_id,
      result:value.value,revision:getMeta(entry.db,'revision')};
  }
  async start({batchId,runId}) {
    checkedBatch(batchId);identifier(runId);
    let active;
    const initial=await this.workspace._serial(async()=>{
      if(this.closing)fail('GEOCODE_BATCH_CLOSING');
      const entry=await this._load(batchId),prior=entry.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
      if(this.active){
        if(this.active.batchId===batchId&&this.active.runId===runId)return {batchId,runId,reused:true};
        fail('GEOCODE_BATCH_RUN_ALREADY_ACTIVE');
      }
      if(prior&&!['RUNNING','STOP_REQUESTED'].includes(prior.state))return {batchId,runId,state:prior.state,reused:true};
      transaction(entry.db,()=>{
        entry.db.prepare("UPDATE runs SET state='INTERRUPTED',finished_at=? WHERE state IN ('RUNNING','STOP_REQUESTED') AND id<>?").run(now(),runId);
        entry.db.prepare("INSERT INTO runs(id,state,started_at) VALUES(?,'RUNNING',?) ON CONFLICT(id) DO UPDATE SET state='RUNNING',finished_at=NULL,note=NULL").run(runId,now());
        this._changed(entry);
      });
      active={batchId,runId,entry,stopRequested:false,promise:null};this.active=active;
      return {batchId,runId,state:'RUNNING',reused:Boolean(prior)};
    });
    if(active){
      active.promise=this._run(active).finally(()=>{if(this.active===active)this.active=null;});
      void active.promise.catch(()=>{});
    }
    return {...initial,status:await this.status(batchId)};
  }
  async _run(active) {
    const {entry,runId}=active;let final='COMPLETE',note=null;
    try{
      for(const row of entry.rows){
        if(active.stopRequested||this.workspace.closing){final='STOPPED';break;}
        const current=await this._readCurrent(entry,row.ordinal);
        if(row.error)continue;
        if(current.native.status==='NEEDS_RECONCILIATION'){
          final='NEEDS_RECONCILIATION';note=current.native.request_id;break;
        }
        if(current.native.status!=='READY')continue;
        const source=entry.db.prepare('SELECT source FROM cache WHERE query_sha256=?').get(row.querySha256);
        const selected=source?JSON.parse(source.source):null;
        await this.workspace._serial(async()=>{
          const reread=this._row(entry,row.ordinal).native;
          if(reread.request_id!==current.native.request_id)fail('GEOCODE_CSV_ATTEMPT_CHANGED');
          transaction(entry.db,()=>{
            entry.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?) ON CONFLICT(ordinal,attempt) DO NOTHING')
              .run(row.ordinal,reread.attempt,reread.request_id,null,selected?'Reused exact retained query result':'Reviewed CSV query',now());
          });
        });
        let value;
        if(selected){
          const original=await this.workspace.get(selected.requestId);
          if(!same(sourceIdentity(original),selected))fail('GEOCODE_CSV_REUSE_RESULT_CHANGED');
          value=await this.workspace.reuseCapture({id:current.native.request_id,productId:entry.review.productId,
            input:row.query,sourceId:selected.requestId,sourceCaptureIdentity:selected.captureIdentity});
        }else{
          const previous=Date.parse(this.workspace.source.inspect().last?.startedAt??'');
          const due=Number.isFinite(previous)?previous+this.workspace.configuration.plan.minIntervalMs-Date.now():0;
          if(due>0)await new Promise(done=>{active.wake=done;active.timer=setTimeout(done,due);});
          clearTimeout(active.timer);active.timer=null;active.wake=null;
          if(active.stopRequested||this.workspace.closing){final='STOPPED';break;}
          value=await this.workspace.capture({id:current.native.request_id,productId:entry.review.productId,input:row.query});
        }
        await this.observe(value);
        const outcome=value.state.outcome??'';
        if(value.state.providerStatus===402||outcome==='QUOTA_EXCEEDED'){final='PAUSED_QUOTA';note=value.request.id;break;}
        if(value.state.providerStatus===429||outcome==='RATE_LIMITED'||outcome==='GEOCODE_LOCAL_RATE_LIMIT'){
          final='PAUSED_RATE';note=value.request.id;break;
        }
        if([401,403].includes(value.state.providerStatus)||['AUTH_REQUIRED','DISABLED_OR_IP_DENIED','GEOCODE_API_KEY_REQUIRED'].includes(outcome)){
          final='PAUSED_AUTH';note=value.request.id;break;
        }
        if(value.state.applicationStatus>=500){final='PAUSED_SOURCE';note=value.request.id;break;}
      }
    }catch(error){final=active.stopRequested||this.workspace.closing?'STOPPED':'PAUSED_ERROR';note=errorCode(error);}
    finally{
      clearTimeout(active.timer);
      this.workspace.lease.assertHeld();
      transaction(entry.db,()=>{
        entry.db.prepare('UPDATE runs SET state=?,finished_at=?,note=? WHERE id=?').run(final,now(),note,runId);
        this._changed(entry);
      });
    }
    return {batchId:entry.id,runId,state:final,note};
  }
  async wait(batchId,runId) {
    const active=this.active;
    if(active&&active.batchId===batchId&&active.runId===runId)await active.promise;
    return this.status(batchId);
  }
  async stop({batchId,runId}) {
    const active=this.active;
    if(active&&(active.batchId!==batchId||active.runId!==runId))fail('GEOCODE_BATCH_RUN_CHANGED');
    if(!active)return this.status(checkedBatch(batchId));
    active.stopRequested=true;if(active.wake)active.wake();
    await active.promise;return this.status(batchId);
  }
  async retry({batchId,ordinal,expectedRequestId,expectedResponseSha256,reason,acknowledgeUncertain=false}) {
    return this.workspace._serial(async()=>{
      if(this.active)fail('GEOCODE_BATCH_RUN_ALREADY_ACTIVE');
      const entry=await this._load(batchId),current=await this._readCurrent(entry,rowNumber(ordinal));
      const {row,native,value}=current;
      if(row.error||native.request_id!==expectedRequestId||value?.responseSha256!==(expectedResponseSha256??null))
        fail('GEOCODE_CSV_ATTEMPT_REVIEW_CHANGED');
      const uncertain=!value?.captureIdentity&&value?.state.state!=='PREPARED';
      if(!['EXCEPTION','NEEDS_RECONCILIATION'].includes(native.status)||uncertain&&!acknowledgeUncertain)
        fail('GEOCODE_CSV_RETRY_REVIEW_REQUIRED');
      reason=text(reason,'new attempt reason',500);
      if(native.attempt>=100)fail('GEOCODE_CSV_ATTEMPT_LIMIT');
      const attempt=native.attempt+1,id=requestId(batchId,ordinal,attempt);
      transaction(entry.db,()=>{
        entry.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?)').run(ordinal,attempt,id,native.request_id,reason,now());
        entry.db.prepare("UPDATE rows SET request_id=?,attempt=?,status='READY',summary=NULL,updated_at=? WHERE ordinal=?")
          .run(id,attempt,now(),ordinal);this._changed(entry);
      });
      return this.row(batchId,ordinal);
    });
  }
  async select({batchId,ordinal,expectedRequestId,responseSha256,expectedRevision,index,note=''}) {
    const entry=await this._load(batchId),{native}=this._row(entry,rowNumber(ordinal));
    if(native.request_id!==expectedRequestId)fail('GEOCODE_CSV_ATTEMPT_REVIEW_CHANGED');
    const result=await this.workspace.select({id:expectedRequestId,responseSha256,expectedRevision,index,note});
    await this.observe(result);return this.row(batchId,ordinal);
  }
  async export(input) {
    const {exportGeocodeBatch}=await import('./batch-delivery.mjs');
    return this.workspace._serial(async()=>{
      if(this.active)fail('GEOCODE_BATCH_STOP_BEFORE_EXPORT');
      const entry=await this._load(input.batchId);
      for(const row of entry.rows)await this._readCurrent(entry,row.ordinal);
      if(input.expectedRevision!==getMeta(entry.db,'revision'))fail('GEOCODE_CSV_EXPORT_REVIEW_CHANGED');
      return exportGeocodeBatch(this.workspace,this,entry,input);
    });
  }
  async close(){
    if(this.closing)return;
    this.closing=true;
    if(this.active){this.active.stopRequested=true;this.active.wake?.();await this.active.promise;}
    for(const entry of this.entries.values())entry.db.close();this.entries.clear();
  }
}
