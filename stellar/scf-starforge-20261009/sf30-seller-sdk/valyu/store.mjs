// MIT. Durable Valyu queries, exact captures and immutable research editions.
import {DatabaseSync} from 'node:sqlite';
import {lstat,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {privateDirectory,need,object,digest,now} from './files.mjs';
import {normalizeValyuRequest,normalizeValyuProvider} from './config.mjs';
import {analyzeValyuResponse,compareValyuResponses} from './research.mjs';
import {assertValyuDelivery} from './delivery.mjs';

export const EDITION_SCHEMA='stellar-forge.valyu-edition.v1';
const stringify=value=>JSON.stringify(value);
export const validateDelivery=(value,options)=>{assertValyuDelivery(value,options);return value;};

const decode=value=>value===null||value===undefined?null:JSON.parse(value);
const bytes=value=>Buffer.from(stringify(value));
const exact=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const PROVENANCE_KEYS={
  NATIVE_BUYER:['intentId','merchantUrl','provider','configSha256','requestBodySha256','capturedAt',
    'nativeStatus','httpStatus','deliveryStatus','deliverySha256','deliveredBytes','exitCode','exitSignal','runtimeErrorPresent','recovered'],
  PROVIDER_OBSERVATION:['url','status','requestSha256','sha256','capturedAt','upstreamSha256','sourceResponseSha256','importedAt']
};
export function validateProvenance(value,kind){
  need(Object.hasOwn(PROVENANCE_KEYS,kind)&&exact(value,PROVENANCE_KEYS[kind])&&timestamp(value.capturedAt),'CAPTURE_PROVENANCE_INVALID');
  if(kind==='NATIVE_BUYER'){
    need(typeof value.intentId==='string'&&value.intentId.length<=256&&value.provider==='Valyu'&&
      typeof value.merchantUrl==='string'&&value.merchantUrl.length<=8192&&sha(value.configSha256)&&sha(value.requestBodySha256)&&
      value.deliveryStatus==='SAVED'&&sha(value.deliverySha256)&&Number.isSafeInteger(value.deliveredBytes)&&value.deliveredBytes>=0&&
      (value.httpStatus===null||(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599))&&
      (value.nativeStatus===null||(typeof value.nativeStatus==='string'&&/^[A-Z0-9_]{1,120}$/.test(value.nativeStatus)))&&
      (value.exitCode===null||Number.isInteger(value.exitCode))&&(value.exitSignal===null||/^SIG[A-Z0-9]+$/.test(value.exitSignal))&&
      typeof value.runtimeErrorPresent==='boolean'&&typeof value.recovered==='boolean','NATIVE_PROVENANCE_INVALID');
    let url;try{url=new URL(value.merchantUrl);}catch{}
    need(url&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'NATIVE_PROVENANCE_INVALID');
  }else need(value.url==='https://api.valyu.ai/v1/search'&&[200,206].includes(value.status)&&
    sha(value.requestSha256)&&sha(value.sha256)&&sha(value.upstreamSha256)&&sha(value.sourceResponseSha256)&&timestamp(value.importedAt),'OBSERVATION_PROVENANCE_INVALID');
  return value;
}
const revision=value=>{need(Number.isSafeInteger(value)&&value>=0,'REVISION_REQUIRED');return value;};
const text=(value,max=200)=>{need(typeof value==='string'&&value.trim()&&value.length<=max,'TEXT_INVALID');return value.trim();};
const parseResponse=raw=>{try{return {payload:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),error:null};}
  catch{return {payload:null,error:'RESPONSE_JSON_INVALID'};}};
function analyze(payload,error){
  if(error)return {status:'MALFORMED_RESPONSE',rows:[],summary:{},error};
  try{return analyzeValyuResponse(payload);}catch(e){return {status:'MALFORMED_RESPONSE',rows:[],summary:{},error:e.code??'RESPONSE_SHAPE_INVALID'};}
}
export class ValyuStore{
  static async open(directory,{provider}={}){
    await privateDirectory(directory);
    const path=join(directory,'valyu.sqlite');
    try{const info=await lstat(path);need(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'PRIVATE_DATABASE_REQUIRED');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const db=new DatabaseSync(path);await chmod(path,0o600);
    try{
      db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      db.exec(
        'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);'+
        'CREATE TABLE IF NOT EXISTS queries(id TEXT PRIMARY KEY,title TEXT NOT NULL,input_json TEXT NOT NULL,request_sha TEXT NOT NULL,revision INTEGER NOT NULL,phase TEXT NOT NULL,prepared_json TEXT,capture_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);'+
        'CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,query_id TEXT NOT NULL REFERENCES queries(id),request_sha TEXT NOT NULL,body BLOB NOT NULL,sha TEXT NOT NULL,kind TEXT NOT NULL,provenance_json TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(query_id,sha,kind));'+
        'CREATE TABLE IF NOT EXISTS annotations(capture_id TEXT NOT NULL REFERENCES captures(id),row_id TEXT NOT NULL,revision INTEGER NOT NULL,selected INTEGER NOT NULL,note TEXT NOT NULL,tags_json TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(capture_id,row_id));'+
        'CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY,query_id TEXT,title TEXT NOT NULL,manifest TEXT NOT NULL,sha TEXT NOT NULL,created TEXT NOT NULL,imported INTEGER NOT NULL DEFAULT 0);'
      );
      db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('schema','stellar-forge.valyu-store.v1');
      need(db.prepare('SELECT value FROM meta WHERE key=?').get('schema').value==='stellar-forge.valyu-store.v1','STORE_SCHEMA_MISMATCH');
      return new ValyuStore(directory,db,normalizeValyuProvider(provider??{}));
    }catch(e){db.close();throw e;}
  }
  constructor(directory,db,provider){this.directory=directory;this.db=db;this.provider=provider;this.closed=false;}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}
    catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){if(!this.closed){this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');this.db.close();this.closed=true;}}
  query(id){
    const row=this.db.prepare('SELECT * FROM queries WHERE id=?').get(id);need(row,'QUERY_NOT_FOUND');
    return {id:row.id,title:row.title,input:decode(row.input_json),requestSha256:row.request_sha,revision:row.revision,
      phase:row.phase,prepared:decode(row.prepared_json),captureId:row.capture_id,createdAt:row.created,updatedAt:row.updated};
  }
  list({offset=0,limit=30}={}){
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=100,'PAGE_INVALID');
    return {offset,limit,total:this.db.prepare('SELECT count(*) AS n FROM queries').get().n,
      queries:this.db.prepare('SELECT id,title,phase,revision,capture_id AS captureId,created AS createdAt,updated AS updatedAt FROM queries ORDER BY created DESC,id LIMIT ? OFFSET ?').all(limit,offset)};
  }
  listEditions({offset=0,limit=30}={}){
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=100,'PAGE_INVALID');
    return {offset,limit,total:this.db.prepare('SELECT count(*) AS n FROM editions').get().n,
      editions:this.db.prepare('SELECT id,query_id AS queryId,title,sha AS sha256,created AS createdAt,imported FROM editions ORDER BY created DESC,id LIMIT ? OFFSET ?').all(limit,offset)};
  }
  saveQuery({id,title,input,expectedRevision}){
    title=text(title);const checked=normalizeValyuRequest(input,this.provider),requestSha256=digest(bytes(checked));
    return this.transaction(()=>{
      const timestamp=now();
      if(id){
        const q=this.query(id);need(q.revision===revision(expectedRevision),'QUERY_STALE');need(q.phase==='DRAFT','PREPARED_REQUEST_IMMUTABLE');
        this.db.prepare('UPDATE queries SET title=?,input_json=?,request_sha=?,revision=revision+1,updated=? WHERE id=?')
          .run(title,stringify(checked),requestSha256,timestamp,id);
      }else{
        id=randomUUID();this.db.prepare('INSERT INTO queries VALUES(?,?,?,?,1,?,NULL,NULL,?,?)')
          .run(id,title,stringify(checked),requestSha256,'DRAFT',timestamp,timestamp);
      }
      return this.query(id);
    });
  }
  duplicateQuery(id,{title}={}){
    const q=this.query(id);return this.saveQuery({title:title??q.title+' — new edition',input:q.input});
  }
  beginPrepare(id,expectedRevision,record){
    need(object(record),'PREPARATION_REQUIRED');
    return this.transaction(()=>{
      const q=this.query(id);need(q.revision===revision(expectedRevision),'QUERY_STALE');
      need(['DRAFT','PREPARING'].includes(q.phase),'REQUEST_ALREADY_PREPARED');
      if(q.phase==='PREPARING')need(isDeepStrictEqual(q.prepared,record),'PREPARATION_SELECTION_CHANGED');
      this.db.prepare('UPDATE queries SET phase=?,prepared_json=?,updated=? WHERE id=?').run('PREPARING',stringify(record),now(),id);
      return this.query(id);
    });
  }
  prepared(id,requestSha256,record){
    return this.transaction(()=>{
      const q=this.query(id);need(q.phase==='PREPARING'&&q.requestSha256===requestSha256,'QUERY_STALE');
      this.db.prepare('UPDATE queries SET phase=?,prepared_json=?,revision=revision+1,updated=? WHERE id=?').run('PREPARED',stringify(record),now(),id);
      return this.query(id);
    });
  }
  attachCapture(id,requestSha256,raw,{kind,provenance,observedRequest}){
    need(Buffer.isBuffer(raw)&&raw.length<=this.provider.maxResponseBytes&&object(provenance)&&
      ['NATIVE_BUYER','PROVIDER_OBSERVATION'].includes(kind),'CAPTURE_INVALID');
    const parsed=parseResponse(raw);need(!parsed.error,'DELIVERY_JSON_INVALID');validateDelivery(parsed.payload,{profile:this.provider.deliveryProfile});validateProvenance(provenance,kind);
    const sha=digest(raw);
    need(kind==='NATIVE_BUYER'?(provenance.deliverySha256===sha&&provenance.deliveredBytes===raw.length):
      (provenance.sha256===sha&&provenance.upstreamSha256===parsed.payload.provider.upstreamSha256),'CAPTURE_PROVENANCE_BINDING_MISMATCH');
    return this.transaction(()=>{
      let q=this.query(id);need(q.requestSha256===requestSha256,'QUERY_STALE');
      if(observedRequest!==undefined){
        need(kind==='PROVIDER_OBSERVATION'&&!q.prepared&&['DRAFT','CAPTURED'].includes(q.phase)&&
          isDeepStrictEqual(normalizeValyuRequest(observedRequest,this.provider),normalizeValyuRequest(q.input,this.provider)),'OBSERVATION_REQUEST_MISMATCH');
        need(isDeepStrictEqual(parsed.payload.request,observedRequest),'DELIVERY_REQUEST_MISMATCH');
        if(!isDeepStrictEqual(observedRequest,q.input)){
          need(q.phase==='DRAFT'&&!q.captureId,'CAPTURE_REQUEST_IMMUTABLE');
          requestSha256=digest(bytes(observedRequest));
          this.db.prepare('UPDATE queries SET input_json=?,request_sha=?,revision=revision+1,updated=? WHERE id=?')
            .run(stringify(observedRequest),requestSha256,now(),id);
          q=this.query(id);
        }
      }
      need(isDeepStrictEqual(parsed.payload.request,q.input),'DELIVERY_REQUEST_MISMATCH');
      if(kind==='NATIVE_BUYER')need(q.prepared?.review&&provenance.intentId===q.prepared.request.intentId,'NATIVE_CAPTURE_BINDING_REQUIRED');
      else need(!q.prepared&&['DRAFT','CAPTURED'].includes(q.phase),'OBSERVATION_REQUIRES_UNPURCHASED_QUERY');
      const old=this.db.prepare('SELECT id FROM captures WHERE query_id=? AND sha=? AND kind=?').get(id,sha,kind);
      if(old)return this.capture(old.id);
      const captureId=randomUUID(),created=now();
      this.db.prepare('INSERT INTO captures VALUES(?,?,?,?,?,?,?,?)').run(captureId,id,requestSha256,raw,sha,kind,stringify(provenance),created);
      this.db.prepare('UPDATE queries SET capture_id=?,phase=?,revision=revision+1,updated=? WHERE id=?').run(captureId,'CAPTURED',created,id);
      return this.capture(captureId);
    });
  }
  capture(id){
    const row=this.db.prepare('SELECT * FROM captures WHERE id=?').get(id);need(row,'CAPTURE_NOT_FOUND');
    const raw=Buffer.from(row.body);need(digest(raw)===row.sha,'CAPTURE_BYTES_CHANGED');
    const query=this.query(row.query_id);need(query.requestSha256===row.request_sha,'CAPTURE_REQUEST_CHANGED');
    const parsed=parseResponse(raw);
    return {id:row.id,query,requestSha256:row.request_sha,raw,sha256:row.sha,kind:row.kind,provenance:decode(row.provenance_json),
      createdAt:row.created,payload:parsed.payload,parseError:parsed.error};
  }
  annotations(captureId){
    return Object.fromEntries(this.db.prepare('SELECT * FROM annotations WHERE capture_id=? ORDER BY row_id').all(captureId)
      .map(r=>[r.row_id,{revision:r.revision,selected:!!r.selected,note:r.note,tags:decode(r.tags_json),updatedAt:r.updated}]));
  }
  captureView(id){
    const c=this.capture(id),annotations=this.annotations(id);
    const view=analyze(c.payload,c.parseError),selectionSha256=digest(bytes({responseSha256:c.sha256,annotations}));
    return {id:c.id,sha256:c.sha256,bytes:c.raw.length,kind:c.kind,createdAt:c.createdAt,provenance:c.provenance,
      ...view,annotations,selectionSha256};
  }
  detail(id){
    const query=this.query(id);
    return {query,capture:query.captureId?this.captureView(query.captureId):null,
      captures:this.db.prepare('SELECT id,sha AS sha256,kind,created AS createdAt FROM captures WHERE query_id=? ORDER BY created DESC,id').all(id),
      editions:this.db.prepare('SELECT id,sha AS sha256,title,created AS createdAt FROM editions WHERE query_id=? ORDER BY created DESC,id').all(id)};
  }
  annotate({captureId,rowId,expectedRevision,selected,note='',tags=[]}){
    need(typeof selected==='boolean'&&typeof note==='string'&&note.length<=16000&&Array.isArray(tags)&&tags.length<=30&&
      tags.every(t=>typeof t==='string'&&t.trim()&&t.length<=80),'ANNOTATION_INVALID');
    return this.transaction(()=>{
      const c=this.capture(captureId),view=analyze(c.payload,c.parseError);
      need(view.rows.some(r=>r.id===rowId),'RESULT_NOT_FOUND');
      const existing=this.db.prepare('SELECT revision FROM annotations WHERE capture_id=? AND row_id=?').get(captureId,rowId);
      need((existing?.revision??0)===revision(expectedRevision),'ANNOTATION_STALE');
      const next=(existing?.revision??0)+1,timestamp=now();
      this.db.prepare('INSERT INTO annotations VALUES(?,?,?,?,?,?,?) ON CONFLICT(capture_id,row_id) DO UPDATE SET revision=excluded.revision,selected=excluded.selected,note=excluded.note,tags_json=excluded.tags_json,updated=excluded.updated')
        .run(captureId,rowId,next,selected?1:0,note,stringify(tags),timestamp);
      return {revision:next,selected,note,tags,updatedAt:timestamp};
    });
  }
  freeze(captureId,{expectedSelectionSha256,title}={}){
    return this.transaction(()=>{
      const c=this.capture(captureId),view=this.captureView(captureId);
      need(view.selectionSha256===expectedSelectionSha256,'RESEARCH_SELECTION_CHANGED');
      const manifest={schema:EDITION_SCHEMA,id:randomUUID(),createdAt:now(),title:text(title??c.query.title),
        query:{id:c.query.id,input:c.query.input,requestSha256:c.requestSha256},
        response:{sha256:c.sha256,bytes:c.raw.length,capturedAt:c.provenance.capturedAt??c.createdAt,bodyBase64:c.raw.toString('base64'),
          payload:c.payload,provenance:{kind:c.kind,...c.provenance}},annotations:view.annotations};
      const serialized=stringify(manifest),sha256=digest(Buffer.from(serialized));
      this.db.prepare('INSERT INTO editions VALUES(?,?,?,?,?,?,0)').run(manifest.id,c.query.id,manifest.title,serialized,sha256,manifest.createdAt);
      return {id:manifest.id,sha256,manifest};
    });
  }
  edition(id){
    const row=this.db.prepare('SELECT * FROM editions WHERE id=?').get(id);need(row,'EDITION_NOT_FOUND');
    need(digest(Buffer.from(row.manifest))===row.sha,'EDITION_BYTES_CHANGED');
    return {id:row.id,sha256:row.sha,manifest:decode(row.manifest),imported:!!row.imported};
  }
  editionView(id){
    const edition=this.edition(id),m=edition.manifest;
    validateDelivery(m.response.payload,{profile:this.provider.deliveryProfile});
    const view=analyzeValyuResponse(m.response.payload);
    return {...view,id,sha256:edition.sha256,title:m.title,createdAt:m.createdAt,query:m.query,
      response:{sha256:m.response.sha256,bytes:m.response.bytes,capturedAt:m.response.capturedAt,provenance:m.response.provenance},
      retentionMode:m.response.payload.delivery.retentionMode,validUntil:m.response.payload.delivery.validUntil,
      agreementReference:m.response.payload.delivery.agreementReference,imported:edition.imported,annotations:m.annotations};
  }
  importEdition(manifest){
    need(exact(manifest,['schema','id','createdAt','title','query','response','annotations'])&&manifest.schema===EDITION_SCHEMA&&typeof manifest.id==='string'&&/^[a-f0-9-]{36}$/.test(manifest.id)&&
      typeof manifest.createdAt==='string'&&Number.isFinite(Date.parse(manifest.createdAt))&&exact(manifest.query,['id','input','requestSha256'])&&exact(manifest.response,['sha256','bytes','capturedAt','bodyBase64','payload','provenance'])&&object(manifest.annotations),'EDITION_INVALID');
    text(manifest.title);need(object(manifest.query.input)&&typeof manifest.query.id==='string','EDITION_QUERY_INVALID');
    need(digest(bytes(manifest.query.input))===manifest.query.requestSha256,'EDITION_REQUEST_CHANGED');
    const response=manifest.response;
    need(timestamp(response.capturedAt)&&object(response.provenance),'EDITION_PROVENANCE_INVALID');
    const {kind,...provenance}=response.provenance;validateProvenance(provenance,kind);
    need(typeof response.bodyBase64==='string'&&response.bodyBase64.length<=24*1024*1024,'EDITION_RESPONSE_TOO_LARGE');
    const raw=Buffer.from(response.bodyBase64,'base64');
    need(raw.toString('base64')===response.bodyBase64&&raw.length===response.bytes&&raw.length<=16*1024*1024&&
      digest(raw)===response.sha256,'EDITION_RESPONSE_CHANGED');
    const parsed=parseResponse(raw);need(!parsed.error&&isDeepStrictEqual(parsed.payload,response.payload),'EDITION_PAYLOAD_CHANGED');
    validateDelivery(parsed.payload,{profile:this.provider.deliveryProfile});need(isDeepStrictEqual(parsed.payload.request,manifest.query.input),'EDITION_REQUEST_CHANGED');
    need(response.capturedAt===provenance.capturedAt&&(kind==='NATIVE_BUYER'?
      (provenance.deliverySha256===response.sha256&&provenance.deliveredBytes===response.bytes):
      (provenance.sha256===response.sha256&&provenance.upstreamSha256===parsed.payload.provider.upstreamSha256)),'EDITION_PROVENANCE_BINDING_MISMATCH');
    const ids=new Set(analyze(parsed.payload,parsed.error).rows.map(r=>r.id));
    for(const[key,note]of Object.entries(manifest.annotations)){
      need(ids.has(key)&&exact(note,['revision','selected','note','tags','updatedAt'])&&Number.isSafeInteger(note.revision)&&note.revision>=0&&timestamp(note.updatedAt)&&typeof note.selected==='boolean'&&typeof note.note==='string'&&note.note.length<=16000&&
        Array.isArray(note.tags)&&note.tags.length<=30&&note.tags.every(t=>typeof t==='string'&&t.length<=80),'EDITION_ANNOTATION_INVALID');
    }
    const serialized=stringify(manifest);need(Buffer.byteLength(serialized)<=40*1024*1024,'EDITION_TOO_LARGE');
    const sha256=digest(Buffer.from(serialized));
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT sha FROM editions WHERE id=?').get(manifest.id);
      if(old)need(old.sha===sha256,'EDITION_ID_COLLISION');
      else this.db.prepare('INSERT INTO editions VALUES(?,NULL,?,?,?,?,1)').run(manifest.id,manifest.title,serialized,sha256,manifest.createdAt);
      return this.edition(manifest.id);
    });
  }
  compare(leftId,rightId,{editions=false}={}){
    const read=id=>{
      if(editions){const e=this.edition(id);return {id,sha256:e.manifest.response.sha256,query:e.manifest.query,payload:e.manifest.response.payload};}
      const c=this.capture(id);return {id,sha256:c.sha256,query:{id:c.query.id,input:c.query.input,requestSha256:c.requestSha256},payload:c.payload};
    };
    const left=read(leftId),right=read(rightId);
    return {left:{id:left.id,sha256:left.sha256,query:left.query},right:{id:right.id,sha256:right.sha256,query:right.query},
      comparison:compareValyuResponses(left.payload,right.payload)};
  }
}
