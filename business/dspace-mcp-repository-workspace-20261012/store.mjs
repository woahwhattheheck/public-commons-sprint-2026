import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {deflateSync,inflateSync,gzipSync,gunzipSync} from 'node:zlib';
import {digest,json,fail} from './patch.mjs';
const encode=v=>deflateSync(Buffer.from(JSON.stringify(v)));
const decode=v=>JSON.parse(inflateSync(v).toString('utf8'));
export class Store {
 constructor(directory){
  this.directory=path.resolve(directory);fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
  this.filename=path.join(this.directory,'repository-workspace.sqlite');
  this.db=new DatabaseSync(this.filename);fs.chmodSync(this.filename,0o600);
  this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=15000; PRAGMA temp_store=MEMORY; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,summary TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS blobs(sha TEXT PRIMARY KEY,data BLOB NOT NULL,size INTEGER NOT NULL);');
  this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('revision','0');
 }
 meta(key,value){if(arguments.length===2){this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));return value;}const r=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return r?JSON.parse(r.value):null;}
 revision(){return Number(this.meta('revision'));}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.meta('revision',this.revision()+1);this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 put(kind,id,value,summary=value){this.db.prepare('INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET summary=excluded.summary,data=excluded.data').run(kind,id,JSON.stringify(summary),encode(value));return value;}
 get(kind,id){const r=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);if(!r)fail('NOT_FOUND','No '+kind+' record '+id+'.',404);return decode(r.data);}
 maybe(kind,id){const r=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);return r?decode(r.data):null;}
 list(kind){return this.db.prepare('SELECT summary FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r=>JSON.parse(r.summary));}
 all(kind){return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>decode(r.data));}
 blob(bytes){const b=Buffer.from(bytes),sha=digest(b);this.db.prepare('INSERT OR IGNORE INTO blobs VALUES (?,?,?)').run(sha,deflateSync(b),b.length);return {sha256:sha,bytes:b.length};}
 bytes(sha){const r=this.db.prepare('SELECT data,size FROM blobs WHERE sha=?').get(sha);if(!r)fail('NOT_FOUND','Saved file is absent.',404);const b=inflateSync(r.data);if(b.length!==r.size||digest(b)!==sha)fail('CORRUPT_FILE','Saved file digest mismatch.',500);return b;}
 begin(action,input){
  const {revision,operationId,...body}=input,fp=digest({action,body});
  this.db.exec('BEGIN IMMEDIATE');try{
   const old=this.maybe('operations',operationId);
   if(old){if(old.fingerprint!==fp)fail('OPERATION_CONFLICT','This operation ID already belongs to different inputs.',409);this.db.exec('COMMIT');return {existing:old};}
   if(revision!==this.revision())fail('REVISION_CONFLICT','The workspace changed. Refresh its saved state.',409,{current_revision:this.revision()});
   const op={id:operationId,action,actor:input.actor,fingerprint:fp,status:'RUNNING',started_at:new Date().toISOString()};
   this.put('operations',op.id,op);this.meta('revision',this.revision()+1);this.db.exec('COMMIT');return {created:op};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 finish(id,result,error){return this.tx(()=>{const op=this.get('operations',id);op.status=error?'FAILED':'COMPLETE';op.finished_at=new Date().toISOString();if(error)op.error={code:error.code||'ACTION_FAILED',message:error.message,status:error.status||500};else op.result=result;this.put('operations',id,op);return op;});}
 snapshot(){
  const records=this.db.prepare('SELECT kind,id,summary,data FROM records ORDER BY kind,id').all().map(r=>({kind:r.kind,id:r.id,summary:JSON.parse(r.summary),value:decode(r.data)}));
  const blobs=this.db.prepare('SELECT sha,size FROM blobs ORDER BY sha').all().map(r=>({sha256:r.sha,bytes:r.size,base64:this.bytes(r.sha).toString('base64')}));
  const meta=this.db.prepare('SELECT key,value FROM meta ORDER BY key').all().map(r=>({key:r.key,value:JSON.parse(r.value)}));
  const payload={schema:'dspace-repository-workspace-handoff/v1',created_at:new Date().toISOString(),meta,records,blobs};
  return gzipSync(Buffer.from(JSON.stringify({...payload,manifest_sha256:digest(payload)})));
 }
 restore(bytes,savedOperation=null){
  const decoded=gunzipSync(bytes);const obj=JSON.parse(decoded);
  if(obj.schema!=='dspace-repository-workspace-handoff/v1')fail('INVALID_ARCHIVE','Use a complete repository workspace handover.');
  const {manifest_sha256,...payload}=obj;if(digest(payload)!==manifest_sha256)fail('INVALID_ARCHIVE','The handover manifest does not match.');
  if(this.db.prepare("SELECT count(*) AS n FROM records WHERE kind NOT IN ('operations')").get().n>0)fail('WORKSPACE_NOT_EMPTY','Restore into a new empty workspace directory.',409);
  const allowed=new Set(['profiles','captures','requests','selections','plans','executions','assets','operations']);
  for(const row of obj.records)if(!allowed.has(row.kind)||typeof row.id!=='string')fail('INVALID_ARCHIVE','Unknown handover record type.');
  for(const b of obj.blobs){const raw=Buffer.from(b.base64,'base64');if(raw.length!==b.bytes||digest(raw)!==b.sha256)fail('INVALID_ARCHIVE','An original source/file digest differs.');}
  const result={records:obj.records.length,files:obj.blobs.length,format:'legacy-gzip-json',...(savedOperation?.archive??{})};
  this.tx(()=>{
   this.db.exec('DELETE FROM records; DELETE FROM blobs;');
   for(const b of obj.blobs)this.blob(Buffer.from(b.base64,'base64'));
   for(const r of obj.records)this.put(r.kind,r.id,r.value,r.summary||r.value);
   for(const m of obj.meta){if(['revision','selected_profile_id','tools'].includes(m.key))this.meta(m.key,m.value);}
   if(savedOperation)this.put('operations',savedOperation.id,{...savedOperation,receiving_result:result});
  });
  return result;
 }
 async nativeFile(){
  const directory=path.join(this.directory,'exports');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const filename=path.join(directory,'handover-'+randomUUID()+'.sqlite');fs.closeSync(fs.openSync(filename,'wx',0o600));
  try{await backup(this.db,filename,{rate:256});return {path:filename,filename:'DSpace_Repository_Workspace.sqlite',contentType:'application/vnd.sqlite3',bytes:fs.statSync(filename).size,temporary:true};}
  catch(error){fs.rmSync(filename,{force:true});throw error;}
 }
 inspectNative(filename,savedOperation=null){
  const source=new DatabaseSync(filename,{readOnly:true,allowExtension:false});
  const allowed=new Set(['profiles','captures','requests','selections','plans','executions','assets','operations']);
  try{
   source.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN;');
   const schema=source.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
   if(schema.length!==3||schema.some(r=>r.type!=='table'||!['blobs','meta','records'].includes(r.name)||!/^CREATE TABLE\s/i.test(r.sql||'')))fail('INVALID_ARCHIVE','The received file is not an original workspace database.');
   const columns={meta:['key','value'],records:['kind','id','summary','data'],blobs:['sha','data','size']};
   for(const [table,expected]of Object.entries(columns)){const actual=source.prepare('PRAGMA table_info('+table+')').all().map(r=>r.name);if(JSON.stringify(actual)!==JSON.stringify(expected))fail('INVALID_ARCHIVE','The received workspace schema differs.');}
   if(source.prepare('PRAGMA integrity_check').all().some(r=>Object.values(r)[0]!=='ok'))fail('INVALID_ARCHIVE','The received SQLite database failed its integrity check.');
   let records=0,files=0,assetBytes=0,pendingOperations=0;const counts={},profiles=[],assets=[];
   const blobExists=source.prepare('SELECT 1 FROM blobs WHERE sha=?');
   for(const row of source.prepare('SELECT kind,id,summary,data FROM records').iterate()){
    if(!allowed.has(row.kind)||typeof row.id!=='string')fail('INVALID_ARCHIVE','Unknown original workspace record type.');
    const value=decode(row.data);JSON.parse(row.summary);if(value?.id!==row.id)fail('INVALID_ARCHIVE','An original record identity differs.');
    for(const sha of [row.kind==='assets'?value.sha256:null,row.kind==='requests'?value.body_sha256:null,row.kind==='captures'?value.source_bundle?.sha256:null])if(sha&&!blobExists.get(sha))fail('INVALID_ARCHIVE','An original source or file body is missing.');
    records++;counts[row.kind]=(counts[row.kind]||0)+1;
    if(row.kind==='profiles')profiles.push({id:value.id,name:value.name,base_url:value.base_url});
    if(row.kind==='assets'){assetBytes+=value.bytes||0;if(assets.length<200)assets.push({id:value.id,name:value.name,bytes:value.bytes,sha256:value.sha256,media_type:value.media_type});}
    if(row.kind==='operations'&&value.status==='RUNNING')pendingOperations++;
   }
   for(const row of source.prepare('SELECT sha,data,size FROM blobs').iterate()){const bytes=inflateSync(row.data);if(bytes.length!==row.size||digest(bytes)!==row.sha)fail('INVALID_ARCHIVE','An original body/file digest differs.');files++;}
   const meta=source.prepare('SELECT key,value FROM meta').all().map(row=>({key:row.key,value:JSON.parse(row.value)}));
   if(!meta.some(m=>m.key==='revision'&&Number.isInteger(m.value)))fail('INVALID_ARCHIVE','The original workspace revision is absent.');
   const report={records,files,format:'sqlite',counts,profiles,assets,asset_bytes:assetBytes,asset_manifest_total:counts.assets||0,pending_operations:pendingOperations};
   if(!savedOperation)return report;
   this.tx(()=>{
    if(this.db.prepare("SELECT count(*) AS n FROM records WHERE kind<>'operations'").get().n>0)fail('WORKSPACE_NOT_EMPTY','Restore into a new empty workspace directory.',409);
    this.db.exec('DELETE FROM records; DELETE FROM blobs;');
    const insertRecord=this.db.prepare('INSERT INTO records VALUES (?,?,?,?)'),insertBlob=this.db.prepare('INSERT INTO blobs VALUES (?,?,?)');
    for(const row of source.prepare('SELECT kind,id,summary,data FROM records').iterate())insertRecord.run(row.kind,row.id,row.summary,row.data);
    for(const row of source.prepare('SELECT sha,data,size FROM blobs').iterate())insertBlob.run(row.sha,row.data,row.size);
    for(const m of meta)if(['revision','selected_profile_id','tools'].includes(m.key))this.meta(m.key,m.value);
    this.put('operations',savedOperation.id,{...savedOperation,receiving_result:{...report,...savedOperation.archive}});
   });
   return {...report,...savedOperation.archive};
  }finally{source.close();}
 }
 restoreNative(filename,savedOperation){return this.inspectNative(filename,savedOperation);}
 previewLegacy(bytes){
  const obj=JSON.parse(gunzipSync(bytes));const {manifest_sha256,...payload}=obj;
  if(obj.schema!=='dspace-repository-workspace-handoff/v1'||digest(payload)!==manifest_sha256)fail('INVALID_ARCHIVE','The original legacy handover manifest differs.');
  const counts={},profiles=[],assets=[];let assetBytes=0;
  for(const r of obj.records){counts[r.kind]=(counts[r.kind]||0)+1;if(r.kind==='profiles')profiles.push({id:r.value.id,name:r.value.name,base_url:r.value.base_url});if(r.kind==='assets'){assetBytes+=r.value.bytes||0;if(assets.length<200)assets.push(r.value);}}
  for(const b of obj.blobs){const raw=Buffer.from(b.base64,'base64');if(raw.length!==b.bytes||digest(raw)!==b.sha256)fail('INVALID_ARCHIVE','An original file digest differs.');}
  return {format:'legacy-gzip-json',records:obj.records.length,files:obj.blobs.length,counts,profiles,assets,asset_bytes:assetBytes,asset_manifest_total:counts.assets||0};
 }
 close(){this.db.close();}
}

