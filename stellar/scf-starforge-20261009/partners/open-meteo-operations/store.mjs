// MIT. Versioned weather requests, immutable original source and frozen operating reports.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {native} from './runtime.mjs';
import {privateDirectory,privateSqliteFile} from './files.mjs';
import {SCHEMA,need,keys,normalizeSite,normalizeRequest,parsePayload,canonical,sha,clone,text,ATTRIBUTION} from './contract.mjs';
import {decisionInput,evaluate,reportDigest} from './analysis.mjs';
const {acquireStateLease}=await native('merchant-fleet-gateway/state-lease.mjs');
const now=()=>new Date().toISOString(),parse=s=>s===null?null:JSON.parse(s);
const ident=(id,prefix)=>{need(typeof id==='string'&&new RegExp('^'+prefix+'-[a-f0-9-]{36}$').test(id),'IDENTITY_INVALID');return id;};
export class WeatherStore{
 static async open(directory){
  await privateDirectory(directory,{create:true});const lease=await acquireStateLease(directory);let db;
  try{await privateSqliteFile(join(directory,'weather.sqlite'));db=new DatabaseSync(join(directory,'weather.sqlite'));
   db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
   const version=db.prepare('PRAGMA user_version').get().user_version;need(version===0||version===1,'WEATHER_SCHEMA_VERSION_UNSUPPORTED');
   db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS sites(id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(id,revision));'+
    'CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,spec TEXT NOT NULL,spec_sha TEXT NOT NULL,native TEXT,capture_id TEXT,error TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES requests(id),spec_sha TEXT NOT NULL,raw BLOB NOT NULL,sha TEXT NOT NULL,provenance TEXT NOT NULL,metadata TEXT NOT NULL,created TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS source_reads(id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES requests(id),spec_sha TEXT NOT NULL,raw BLOB NOT NULL,sha TEXT NOT NULL,provenance TEXT NOT NULL,created TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS decisions(id TEXT NOT NULL,revision INTEGER NOT NULL,capture_id TEXT NOT NULL REFERENCES captures(id),payload TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(id,revision));'+
    'CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,payload TEXT NOT NULL,sha TEXT NOT NULL,created TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,subject TEXT NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL);PRAGMA user_version=1;');
   const store=new WeatherStore(directory,db,lease);
   store.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('schema',SCHEMA);
   need(store.db.prepare('SELECT value FROM meta WHERE key=?').get('schema').value===SCHEMA,'WEATHER_STATE_SCHEMA_MISMATCH');return store;
  }catch(error){try{db?.close();}finally{await lease.close();}throw error;}
 }
 constructor(directory,db,lease){this.directory=directory;this.db=db;this.lease=lease;this.closed=false;}
 assert(){need(!this.closed,'WEATHER_STORE_CLOSED');this.lease.assertHeld();}
 transaction(fn){this.assert();this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 event(kind,subject,payload){this.db.prepare('INSERT INTO events(kind,subject,payload,created) VALUES (?,?,?,?)').run(kind,subject,canonical(payload),now());}
 site(id,revision){this.assert();ident(id,'site');const row=revision===undefined?this.db.prepare('SELECT * FROM sites WHERE id=? ORDER BY revision DESC LIMIT 1').get(id):this.db.prepare('SELECT * FROM sites WHERE id=? AND revision=?').get(id,revision);need(row,'SITE_NOT_FOUND');return {id:row.id,revision:row.revision,...parse(row.payload),createdAt:row.created};}
 sites(){this.assert();return this.db.prepare('SELECT s.* FROM sites s JOIN (SELECT id,MAX(revision) r FROM sites GROUP BY id) q ON s.id=q.id AND s.revision=q.r ORDER BY s.created DESC').all().map(r=>({id:r.id,revision:r.revision,...parse(r.payload),createdAt:r.created}));}
 saveSite(input){
  keys(input,['id','expectedRevision','site']);const value=normalizeSite(input.site),id=input.id??'site-'+randomUUID(),expected=input.expectedRevision??0;ident(id,'site');
  need(Number.isSafeInteger(expected)&&expected>=0,'REVISION_INVALID');
  return this.transaction(()=>{const old=this.db.prepare('SELECT MAX(revision) r FROM sites WHERE id=?').get(id).r??0;
   need(old===expected,'SITE_REVISION_CHANGED');this.db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run(id,old+1,canonical(value),now());
   this.event('SITE_SAVED',id,{revision:old+1});return this.site(id);});
 }
 request(id){this.assert();ident(id,'request');const r=this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);need(r,'REQUEST_NOT_FOUND');
  return {id:r.id,revision:r.revision,state:r.state,spec:parse(r.spec),specSha256:r.spec_sha,native:parse(r.native),captureId:r.capture_id,error:parse(r.error),createdAt:r.created,updatedAt:r.updated};}
 requests(){this.assert();return this.db.prepare('SELECT id FROM requests ORDER BY updated DESC LIMIT 500').all().map(r=>this.request(r.id));}
 saveRequest(input){
  keys(input,['id','expectedRevision','siteId','siteRevision','request','title']);const id=input.id??'request-'+randomUUID(),expected=input.expectedRevision??0;ident(id,'request');
  need(Number.isSafeInteger(expected)&&expected>=0,'REVISION_INVALID');const site=this.site(input.siteId,input.siteRevision);
  const r=normalizeRequest({...input.request,latitude:site.latitude,longitude:site.longitude,timezone:site.timezone,cellSelection:site.cellSelection,...(site.elevation===undefined?{}:{elevation:site.elevation})});
  const spec={title:text(input.title,'REQUEST_TITLE'),site,request:r},hash=sha(Buffer.from(canonical(spec)));
  return this.transaction(()=>{const old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
   need((old?.revision??0)===expected,'REQUEST_REVISION_CHANGED');need(!old||old.state==='DRAFT','RETAINED_REQUEST_REQUIRES_NEW_COPY');
   const stamp=now();if(old)this.db.prepare('UPDATE requests SET revision=?,spec=?,spec_sha=?,updated=? WHERE id=?').run(expected+1,canonical(spec),hash,stamp,id);
   else this.db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,NULL,NULL,NULL,?,?)').run(id,1,'DRAFT',canonical(spec),hash,stamp,stamp);
   this.event('REQUEST_SAVED',id,{revision:expected+1,specSha256:hash});return this.request(id);});
 }
 beginSource(id,revision,{reprocess=false}={}){
  return this.transaction(()=>{const q=this.request(id);need(q.revision===revision,'REQUEST_REVISION_CHANGED');need(q.native===null,'SOURCE_CAPTURE_HAS_NATIVE_PREPARATION');
   need(['DRAFT','SOURCE_CAPTURED','SOURCE_FAILED','ACQUIRING'].includes(q.state),'SOURCE_CAPTURE_STATE_INVALID');
   const attempt='source-'+randomUUID();this.db.prepare('UPDATE requests SET state=?,revision=revision+1,error=NULL,updated=? WHERE id=?').run('ACQUIRING',now(),id);
   this.event(reprocess?'SOURCE_REPROCESS_STARTED':'SOURCE_CAPTURE_STARTED',id,{attempt,previousState:q.state,specSha256:q.specSha256});return {...this.request(id),sourceAttempt:attempt};});
 }
 sourceRead(requestId,{raw=true}={}){
  this.assert();const fields=raw?'*':'id,request_id,spec_sha,sha,provenance,created,LENGTH(raw) AS bytes';
  const r=this.db.prepare('SELECT '+fields+' FROM source_reads WHERE request_id=? ORDER BY created DESC,rowid DESC LIMIT 1').get(requestId);
  if(!r)return null;
  const bytes=raw?Buffer.from(r.raw):null;if(raw)need(sha(bytes)===r.sha,'RETAINED_PROVIDER_READ_CHANGED');
  return {id:r.id,requestId:r.request_id,specSha256:r.spec_sha,sha256:r.sha,provenance:parse(r.provenance),createdAt:r.created,bytes:raw?bytes.length:r.bytes,...(raw?{raw:bytes}:{})};
 }
 retainSourceRead(requestId,specSha256,bytes,provenance){
  return this.transaction(()=>{const q=this.request(requestId);need(q.specSha256===specSha256&&q.state==='ACQUIRING'&&q.native===null,'SOURCE_CAPTURE_CHANGED');
   const id='read-'+randomUUID(),digest=sha(bytes);this.db.prepare('INSERT INTO source_reads VALUES (?,?,?,?,?,?,?)').run(id,requestId,specSha256,Buffer.from(bytes),digest,canonical(provenance),now());
   this.event('ORIGINAL_PROVIDER_BYTES_RETAINED',requestId,{id,sha256:digest,bytes:bytes.length});
   return {id,sha256:digest,bytes:bytes.length};
  });
 }
 sourceFailed(id,specSha256,error){
  return this.transaction(()=>{const q=this.request(id);need(q.specSha256===specSha256&&q.native===null&&q.state==='ACQUIRING','SOURCE_CAPTURE_CHANGED');
   this.db.prepare('UPDATE requests SET state=?,revision=revision+1,error=?,updated=? WHERE id=?').run('SOURCE_FAILED',canonical(error),now(),id);this.event('SOURCE_CAPTURE_FAILED',id,error);return this.request(id);});
 }
 attachCapture(id,specSha256,bytes,provenance){
  const q=this.request(id);need(q.specSha256===specSha256,'SOURCE_REQUEST_CHANGED');const view=parsePayload(bytes,q.spec.request);
  need(provenance.kind==='PROVIDER_CAPTURE'||provenance.kind==='NATIVE_BUYER','CAPTURE_AUTHORITY_INVALID');
  return this.transaction(()=>{const current=this.request(id);need(current.specSha256===specSha256,'SOURCE_REQUEST_CHANGED');
   if(provenance.kind==='PROVIDER_CAPTURE')need(current.native===null&&current.state==='ACQUIRING','SOURCE_CAPTURE_CHANGED');
   else need(current.native?.review&&provenance.intentId===current.native.request.intentId&&provenance.configSha256===current.native.review.configSha256,'NATIVE_CAPTURE_BINDING_CHANGED');
   const digest=sha(bytes),duplicate=this.db.prepare('SELECT id FROM captures WHERE request_id=? AND sha=? AND provenance=?').get(id,digest,canonical(provenance));
   if(duplicate){
    if(provenance.kind==='PROVIDER_CAPTURE'){
     this.db.prepare('UPDATE requests SET state=?,revision=revision+1,capture_id=?,error=NULL,updated=? WHERE id=?').run('SOURCE_CAPTURED',duplicate.id,now(),id);
     this.event('SOURCE_REPROCESSED',id,{captureId:duplicate.id,sha256:digest,sourceHttpRequests:0});
    }
    return this.capture(duplicate.id);
   }
   const captureId='capture-'+randomUUID();this.db.prepare('INSERT INTO captures VALUES (?,?,?,?,?,?,?,?)').run(captureId,id,specSha256,Buffer.from(bytes),digest,canonical(provenance),canonical(view.metadata),now());
   this.db.prepare('UPDATE requests SET state=?,revision=revision+1,capture_id=?,error=NULL,updated=? WHERE id=?').run(provenance.kind==='PROVIDER_CAPTURE'?'SOURCE_CAPTURED':'RESULT_SAVED',captureId,now(),id);
   this.event('CAPTURE_SAVED',id,{captureId,sha256:digest,bytes:bytes.length,kind:provenance.kind});return this.capture(captureId);});
 }
 capture(id,{raw=true}={}){
  this.assert();ident(id,'capture');const fields=raw?'*':'id,request_id,spec_sha,sha,provenance,metadata,created,LENGTH(raw) AS byte_count';
  const r=this.db.prepare('SELECT '+fields+' FROM captures WHERE id=?').get(id);need(r,'CAPTURE_NOT_FOUND');const request=this.request(r.request_id);
  need(request.specSha256===r.spec_sha,'RETAINED_CAPTURE_REQUEST_CHANGED');const bytes=raw?Buffer.from(r.raw):null;if(raw)need(sha(bytes)===r.sha,'RETAINED_CAPTURE_BYTES_CHANGED');
  return {id:r.id,requestId:r.request_id,specSha256:r.spec_sha,sha256:r.sha,bytes:raw?bytes.length:r.byte_count,provenance:parse(r.provenance),metadata:parse(r.metadata),capturedAt:r.created,request:request.spec,...(raw?{raw:bytes,view:parsePayload(bytes,request.spec.request)}:{})};
 }
 captures(){this.assert();return this.db.prepare('SELECT id FROM captures ORDER BY created DESC LIMIT 500').all().map(r=>this.capture(r.id,{raw:false}));}
 beginPrepare(id,revision,record){
  return this.transaction(()=>{const q=this.request(id);need(q.revision===revision,'REQUEST_REVISION_CHANGED');need(q.state==='DRAFT'||q.state==='PREPARING','BUYER_PREPARATION_REQUIRES_NEW_REQUEST');
   if(q.native)need(canonical(q.native)===canonical(record),'PREPARATION_SELECTION_CHANGED');
   this.db.prepare('UPDATE requests SET state=?,native=?,revision=revision+1,error=NULL,updated=? WHERE id=?').run('PREPARING',canonical(record),now(),id);
   this.event('BUYER_PREPARATION_STARTED',id,{intentId:record.request.intentId,specSha256:q.specSha256});return this.request(id);});
 }
 prepared(id,specSha256,record){
  return this.transaction(()=>{const q=this.request(id);need(q.state==='PREPARING'&&q.specSha256===specSha256&&q.native.request.intentId===record.request.intentId,'PREPARATION_CHANGED');
   this.db.prepare('UPDATE requests SET state=?,native=?,revision=revision+1,error=NULL,updated=? WHERE id=?').run('PREPARED',canonical(record),now(),id);
   this.event('BUYER_PREPARED',id,{intentId:record.request.intentId,configSha256:record.review.configSha256});return this.request(id);});
 }
 nativeOutcome(id,outcome){
  return this.transaction(()=>{const q=this.request(id);need(q.native?.review,'BUYER_NOT_PREPARED');
   this.db.prepare('UPDATE requests SET native=?,revision=revision+1,updated=? WHERE id=?').run(canonical({...q.native,lastOutcome:outcome}),now(),id);
   this.event('NATIVE_OUTCOME',id,outcome);return this.request(id);});
 }
 decision(id,revision){this.assert();ident(id,'decision');const row=revision===undefined?this.db.prepare('SELECT * FROM decisions WHERE id=? ORDER BY revision DESC LIMIT 1').get(id):this.db.prepare('SELECT * FROM decisions WHERE id=? AND revision=?').get(id,revision);need(row,'DECISION_NOT_FOUND');return {id:row.id,revision:row.revision,captureId:row.capture_id,...parse(row.payload),result:parse(row.result),createdAt:row.created};}
 decisions(){this.assert();return this.db.prepare('SELECT d.id,d.revision FROM decisions d JOIN (SELECT id,MAX(revision) r FROM decisions GROUP BY id) q ON d.id=q.id AND d.revision=q.r ORDER BY d.created DESC').all().map(r=>this.decision(r.id,r.revision));}
 saveDecision(input){
  keys(input,['id','expectedRevision','captureId','decision']);const id=input.id??'decision-'+randomUUID(),expected=input.expectedRevision??0;ident(id,'decision');
  need(Number.isSafeInteger(expected)&&expected>=0,'REVISION_INVALID');const payload=decisionInput(input.decision),capture=this.capture(input.captureId),result=evaluate(capture.view,payload.rule);
  return this.transaction(()=>{const old=this.db.prepare('SELECT MAX(revision) r FROM decisions WHERE id=?').get(id).r??0;need(old===expected,'DECISION_REVISION_CHANGED');
   this.db.prepare('INSERT INTO decisions VALUES (?,?,?,?,?,?)').run(id,old+1,capture.id,canonical(payload),canonical({...result,captureSha256:capture.sha256,specSha256:capture.specSha256}),now());
   this.event('DECISION_SAVED',id,{revision:old+1,captureId:capture.id});return this.decision(id);});
 }
 freezeReport(input){
  keys(input,['title','owner','notes','decisions']);need(Array.isArray(input.decisions)&&input.decisions.length>=1&&input.decisions.length<=32,'REPORT_SELECTION_INVALID');
  return this.transaction(()=>{const selected=input.decisions.map(d=>{keys(d,['id','revision']);need(Number.isSafeInteger(d.revision)&&d.revision>=1,'REPORT_REVISION_REQUIRED');return this.decision(d.id,d.revision);});
   need(new Set(selected.map(d=>d.id)).size===selected.length,'DUPLICATE_REPORT_DECISION');
   const captureIds=[...new Set(selected.map(d=>d.captureId))];need(captureIds.length<=16,'REPORT_SOURCE_LIMIT');
   const captures=captureIds.map(id=>this.capture(id,{raw:false}));
   const id='report-'+randomUUID(),createdAt=now(),payload={schema:'stellar-forge.weather-report.v1',id,createdAt,title:text(input.title,'REPORT_TITLE'),owner:text(input.owner,'REPORT_OWNER',120),notes:input.notes??'',decisions:selected,captures,attribution:ATTRIBUTION};
   need(typeof payload.notes==='string'&&payload.notes.length<=10000&&!payload.notes.includes('\0'),'REPORT_NOTES_INVALID');
   const digest=reportDigest(payload);this.db.prepare('INSERT INTO reports VALUES (?,?,?,?)').run(id,canonical(payload),digest,createdAt);
   this.event('REPORT_FROZEN',id,{sha256:digest,decisions:selected.length,captures:captures.length});return {...payload,sha256:digest};});
 }
 report(id){this.assert();ident(id,'report');const r=this.db.prepare('SELECT * FROM reports WHERE id=?').get(id);need(r,'REPORT_NOT_FOUND');const payload=parse(r.payload);need(reportDigest(payload)===r.sha,'FROZEN_REPORT_CHANGED');return {...payload,sha256:r.sha};}
 reports(){this.assert();return this.db.prepare('SELECT id FROM reports ORDER BY created DESC LIMIT 200').all().map(r=>this.report(r.id));}
 events({after=0,limit=100}={}){this.assert();need(Number.isSafeInteger(after)&&after>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=500,'PAGINATION_INVALID');return this.db.prepare('SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT ?').all(after,limit).map(r=>({...r,payload:parse(r.payload)}));}
 summary(){this.assert();return {schema:SCHEMA,directory:this.directory,sites:this.sites(),requests:this.requests(),captures:this.captures(),decisions:this.decisions(),reports:this.reports(),attribution:ATTRIBUTION};}
 closeDatabase(){this.assert();this.db.close();this.db=null;}
 reopenDatabase(){need(!this.closed&&!this.db,'WEATHER_DATABASE_STATE_INVALID');this.db=new DatabaseSync(join(this.directory,'weather.sqlite'));this.db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;');}
 async close(){if(this.closed)return;this.closed=true;try{this.db?.close();}finally{await this.lease.close();}}
}
