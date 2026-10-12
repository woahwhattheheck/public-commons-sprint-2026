// MIT. Retained DSpace data editions on the original SF30 dataset engine.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync, gunzipSync} from 'node:zlib';
import {acquireDatasetLease} from '../dataset-refresh/writer-lease.mjs';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {inspectDspaceSource,projectDspaceSources,compareDspaceEditions,hash,canonical,fault,object,MAX_SOURCE_BYTES} from './source.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.dspace-workspace.v1';
const FILE = 'repository-datasets.sqlite3';
const APPLICATION_ID = 1397113939;
const KINDS = ['sources','editions','reviews','comparisons','publications'];
const HASH = /^[a-f0-9]{64}$/;
const REQUEST = /^[A-Za-z0-9_.:-]{8,128}$/;
const now = () => new Date().toISOString();
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const clone = value => structuredClone(value);
const tableSchema = [
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,sha256 TEXT NOT NULL,summary TEXT NOT NULL,body BLOB NOT NULL,PRIMARY KEY(kind,id))',
  'CREATE TABLE IF NOT EXISTS blobs (sha256 TEXT PRIMARY KEY,bytes INTEGER NOT NULL,data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL)'
];
function directory(root) {
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const st=fs.lstatSync(root);
  if (!st.isDirectory()||st.isSymbolicLink()) throw fault('DSPACE_PRIVATE_DIRECTORY','Choose a regular private workspace directory.');
}
function regular(file) {
  const st=fs.lstatSync(file);
  if (!st.isFile()||st.isSymbolicLink()) throw fault('DSPACE_REGULAR_FILE','Use an original regular file.');
  return st;
}
function decode(buffer) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
}
async function hashFile(file){
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of fs.createReadStream(file)){hash.update(chunk);bytes+=chunk.length;}
  return {bytes,sha256:hash.digest('hex')};
}
async function writeExact(file, bytes) {
  const temporary=file+'.partial-'+randomUUID();
  let handle;
  try{
    handle=await fsp.open(temporary,'wx',0o600);
    await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    try{await fsp.link(temporary,file);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const actual=await hashFile(file);regular(file);
      if(actual.bytes!==bytes.length||actual.sha256!==hash(bytes))
        throw fault('DSPACE_EXPORT_CHANGED','The destination contains different original bytes.',409);
    }
  }finally{await handle?.close();await fsp.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function validPage(offset,limit) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw fault('DSPACE_PAGE','Use an offset of zero or greater and a limit from 1 to 100.');
}
function summary(kind,doc) {
  const common={id:doc.id,sha256:doc.sha256,created_at:doc.created_at??doc.recorded_at};
  if(kind==='sources')return {...common,name:doc.name,base_url:doc.base_url,bytes:doc.bytes,item_count:doc.item_count,
    variant_count:doc.variant_count,conflicting_uuids:doc.conflicting_uuids,scope:doc.scope,request_count:doc.requests.length,original_file_count:doc.original_file_count};
  if(kind==='editions')return {...common,name:doc.name,mode:doc.mode,item_count:doc.item_count,row_count:doc.row_count,
    metadataFields:doc.metadataFields,source_ids:doc.source_ids,snapshot:doc.snapshot,previous_edition_id:doc.previous_edition_id};
  if(kind==='comparisons')return {...common,before_id:doc.before_id,after_id:doc.after_id,counts:doc.counts};
  return clone(doc);
}

export class DspaceWorkspace {
  constructor({directory:root}) {
    if(typeof root!=='string'||!root)throw new TypeError('A private workspace directory is required.');
    this.directory=path.resolve(root);directory(this.directory);
    this.lease=acquireDatasetLease(this.directory);this.tail=Promise.resolve();this.closed=false;this.closing=false;
    try {
      const file=path.join(this.directory,FILE),existed=fs.existsSync(file);
      if(existed)regular(file);
      this.db=new DatabaseSync(file);
      this.db.exec('PRAGMA busy_timeout=10000; PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      if(existed) {
        const id=Number(this.db.prepare('PRAGMA application_id').get().application_id);
        if(id!==APPLICATION_ID)throw fault('DSPACE_WORKSPACE_FORMAT','The selected database is not a repository dataset workspace.');
      }
      for(const sql of tableSchema)this.db.exec(sql);
      if(!existed) {
        this.db.exec('PRAGMA application_id='+APPLICATION_ID);
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.setMeta('schema',WORKSPACE_SCHEMA);this.setMeta('workspace_id','dspace-'+randomUUID());
          this.setMeta('created_at',now());this.setMeta('revision',0);this.setMeta('selected_edition_id',null);
          this.db.exec('COMMIT');
        }catch(error){this.db.exec('ROLLBACK');throw error;}
      }
      if(this.meta('schema')!==WORKSPACE_SCHEMA)throw fault('DSPACE_WORKSPACE_FORMAT','Unsupported repository dataset workspace format.');
    }catch(error){this.db?.close();this.lease.close();throw error;}
  }
  meta(key){const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  setMeta(key,value){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  revision(){return this.meta('revision');}
  get(kind,id){
    if(!KINDS.includes(kind))throw fault('DSPACE_RECORD_KIND','Unknown original record kind.');
    const row=this.db.prepare('SELECT sha256,body FROM records WHERE kind=? AND id=?').get(kind,id);
    if(!row)throw fault('DSPACE_RECORD_MISSING','The selected original record does not exist.',404);
    const raw=gunzipSync(row.body,{maxOutputLength:MAX_SOURCE_BYTES});
    if(hash(raw)!==row.sha256)throw fault('DSPACE_RECORD_CHANGED','A retained original record differs from its digest.',409);
    return decode(raw);
  }
  put(kind,doc){
    const raw=json(doc),digest=hash(raw),small=summary(kind,doc);
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(kind,doc.id,digest,JSON.stringify(small),gzipSync(raw));
    return small;
  }
  blob(bytes){
    const digest=hash(bytes);
    this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(digest,bytes.length,gzipSync(bytes));
    return digest;
  }
  bytes(digest){
    const row=this.db.prepare('SELECT bytes,data FROM blobs WHERE sha256=?').get(digest);
    if(!row)throw fault('DSPACE_FILE_MISSING','An original file is absent from this workspace.',404);
    const bytes=gunzipSync(row.data,{maxOutputLength:MAX_SOURCE_BYTES});
    if(bytes.length!==row.bytes||hash(bytes)!==digest)throw fault('DSPACE_FILE_CHANGED','Original retained file bytes differ from their digest.',409);
    return bytes;
  }
  list(kind){return this.db.prepare('SELECT summary FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>JSON.parse(r.summary));}
  state(){
    this.lease.assertHeld();
    return {schema:WORKSPACE_SCHEMA,id:this.meta('workspace_id'),revision:this.revision(),created_at:this.meta('created_at'),
      selected_edition_id:this.meta('selected_edition_id'),selected_review_id:this.meta('selected_review_id'),...Object.fromEntries(KINDS.map(k=>[k,this.list(k)])),
      operation_count:Number(this.db.prepare('SELECT count(*) AS n FROM operations').get().n)};
  }
  read(kind,id,{offset=0,limit=50}={}){
    this.lease.assertHeld();validPage(offset,limit);const doc=this.get(kind,id);
    if(kind==='sources')return {...doc,items:doc.items.slice(offset,offset+limit),total:doc.items.length,offset,limit};
    if(kind==='editions'){
      const records=doc.records.slice(offset,offset+limit);
      return {...doc,records,rows:records.map(v=>v.row),total:doc.records.length,offset,limit};
    }
    if(kind==='comparisons')return {...doc,changes:doc.changes.slice(offset,offset+limit),source_changes:doc.source_changes.slice(offset,offset+limit),source_total:doc.source_changes.length,total:doc.changes.length,offset,limit};
    return doc;
  }
  operation(id){
    const row=this.db.prepare('SELECT request_sha256,input,result FROM operations WHERE id=?').get(id);
    if(!row)throw fault('DSPACE_OPERATION_MISSING','The original request has not committed.',404);
    return {...row,input:JSON.parse(row.input),result:JSON.parse(row.result)};
  }
  run(task){
    if(this.closing||this.closed)return Promise.reject(fault('DSPACE_WORKSPACE_CLOSED','The original workspace is closing.',409));
    const result=this.tail.then(()=>{this.lease.assertHeld();return task();});
    this.tail=result.catch(()=>{});return result;
  }
  dispatch(action,input){
    if(!object(input))return Promise.reject(fault('DSPACE_REQUEST','An original operation input is required.'));
    const copy=clone(input);
    return this.run(()=>this.mutate(action,copy));
  }
  async mutate(action,input){
    if(!REQUEST.test(input.operationId??''))throw fault('DSPACE_OPERATION_ID','Use a persistent request ID of 8–128 safe characters.');
    if(typeof input.actor!=='string'||!input.actor.trim()||input.actor.length>256)throw fault('DSPACE_ACTOR','Name the operator making this change.');
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw fault('DSPACE_REVISION','Use the current workspace revision.');
    let rawSource=null;
    const intent={action,...input};delete intent.operationId;
    if(action==='import-source'){
      if(typeof input.sourceBase64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.sourceBase64))
        throw fault('DSPACE_SOURCE_BYTES','Use the exact complete source file bytes.');
      rawSource=Buffer.from(input.sourceBase64,'base64');
      intent.sourceBase64={sha256:hash(rawSource),bytes:rawSource.length};
    }
    const requestSha=hash(canonical(intent));
    const previous=this.db.prepare('SELECT request_sha256,result FROM operations WHERE id=?').get(input.operationId);
    if(previous){
      if(previous.request_sha256!==requestSha)throw fault('DSPACE_REQUEST_CHANGED','This request ID belongs to different original inputs.',409);
      return {...JSON.parse(previous.result),replayed:true};
    }
    if(this.revision()!==input.expectedRevision)throw fault('DSPACE_REVISION_CHANGED','The workspace changed. Review its current state before a new decision.',409);
    let prepared=null;
    if(action==='import-source')prepared=inspectDspaceSource(rawSource);
    if(action==='save-edition'){
      const sourceIds=[...new Set((input.selection??[]).map(v=>v.sourceId))];
      prepared=projectDspaceSources(sourceIds.map(id=>this.get('sources',id)),input);
      const staged=await this.materializeDataset({csv:prepared.csv,config:prepared.config},'prepare-'+input.operationId);
      const native=await loadDatasetConfig(staged.datasetPath);
      prepared.snapshot=native.describe().snapshot;prepared.description=native.describe();
    }
    let result;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.revision()!==input.expectedRevision)throw fault('DSPACE_REVISION_CHANGED','The workspace changed while preparing this operation.',409);
      if(action==='import-source'){
        const existing=this.db.prepare('SELECT id FROM records WHERE kind=? AND id=?').get('sources',prepared.id);
        if(existing)result={source:summary('sources',this.get('sources',prepared.id)),already_retained:true};
        else {
          prepared.raw_sha256=this.blob(rawSource);prepared.created_at=now();prepared.actor=input.actor;
          result={source:this.put('sources',prepared)};
        }
      }else if(action==='save-edition'){
        if(input.previousEditionId)this.get('editions',input.previousEditionId);
        const configBytes=json(prepared.config);
        const doc={schema:'stellar-forge.dspace-edition.v1',id:'edition-'+input.operationId,name:prepared.name,
          mode:prepared.mode,selection:prepared.selection,metadataFields:prepared.metadataFields,rights:prepared.rights,
          columns:prepared.columns,records:prepared.records,item_count:prepared.item_count,row_count:prepared.row_count,
          source_ids:prepared.source_ids,snapshot:prepared.snapshot,description:prepared.description,
          csv_sha256:this.blob(prepared.csv),config_sha256:this.blob(configBytes),
          previous_edition_id:input.previousEditionId??null,actor:input.actor,created_at:now()};
        doc.sha256=hash(canonical(doc));result={edition:this.put('editions',doc)};
      }else if(action==='review-edition'){
        const edition=this.get('editions',input.editionId);
        if(input.editionSha256!==edition.sha256)throw fault('DSPACE_EDITION_CHANGED','Review the exact selected edition digest.',409);
        if(!['approved','needs-changes'].includes(input.decision))throw fault('DSPACE_REVIEW','Choose approved or needs-changes.');
        if(typeof input.comment!=='string'||!input.comment.trim()||input.comment.length>32000)
          throw fault('DSPACE_REVIEW','Explain the source, field and distribution review.');
        const doc={schema:'stellar-forge.dspace-review.v1',id:'review-'+input.operationId,edition_id:edition.id,
          edition_sha256:edition.sha256,decision:input.decision,comment:input.comment,actor:input.actor,created_at:now()};
        doc.sha256=hash(canonical(doc));result={review:this.put('reviews',doc)};
      }else if(action==='select-edition'){
        const edition=this.get('editions',input.editionId),review=this.get('reviews',input.reviewId);
        if(review.edition_id!==edition.id||review.edition_sha256!==edition.sha256||review.decision!=='approved')
          throw fault('DSPACE_REVIEW_REQUIRED','Select the approval of this exact edition.');
        this.setMeta('selected_edition_id',edition.id);this.setMeta('selected_review_id',review.id);
        result={selected_edition_id:edition.id,selected_review_id:review.id,snapshot:edition.snapshot};
      }else if(action==='compare-editions'){
        const before=this.get('editions',input.beforeId),after=this.get('editions',input.afterId);
        const doc={...compareDspaceEditions(before,after),id:'comparison-'+input.operationId,actor:input.actor,created_at:now()};
        doc.sha256=hash(canonical(doc));result={comparison:this.put('comparisons',doc)};
      }else if(action==='record-publication'){
        const edition=this.get('editions',input.editionId);
        if(!object(input.publication)||input.publication.snapshot!==edition.snapshot)
          throw fault('DSPACE_PUBLICATION','Retain the returned original publication for this exact dataset snapshot.');
        const doc={schema:'stellar-forge.dspace-publication.v1',id:'publication-'+input.operationId,
          edition_id:edition.id,edition_sha256:edition.sha256,publication:input.publication,actor:input.actor,created_at:now()};
        doc.sha256=hash(canonical(doc));result={publication:this.put('publications',doc)};
      }else throw fault('DSPACE_ACTION','Unknown repository dataset operation.');
      this.setMeta('revision',input.expectedRevision+1);
      result={operationId:input.operationId,revision:this.revision(),...result};
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(input.operationId,requestSha,JSON.stringify(intent),JSON.stringify(result));
      this.db.exec('COMMIT');return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  async materializeDataset({csv,config},key){
    const root=path.join(this.directory,'dataset-files',hash(key));directory(root);
    await writeExact(path.join(root,'data.csv'),csv);
    await writeExact(path.join(root,'dataset.json'),json(config));
    return {directory:root,datasetPath:path.join(root,'dataset.json')};
  }
  query(editionId,query={}){
    return this.run(async()=>{
      const edition=this.get('editions',editionId);
      const staged=await this.materializeDataset({csv:this.bytes(edition.csv_sha256),config:decode(this.bytes(edition.config_sha256))},edition.id);
      const dataset=await loadDatasetConfig(staged.datasetPath);
      if(dataset.describe().snapshot!==edition.snapshot)throw fault('DSPACE_SNAPSHOT_CHANGED','The original dataset engine differs from the retained edition.',409);
      const context={query},admitted=dataset.admit(context);
      return admitted===true?dataset.handle(context):admitted;
    });
  }
  exportDataset(editionId,destination){
    return this.run(async()=>{
      const edition=this.get('editions',editionId);
      const approvals=this.list('reviews').filter(r=>r.edition_id===edition.id&&r.edition_sha256===edition.sha256&&r.decision==='approved');
      if(!approvals.length)throw fault('DSPACE_REVIEW_REQUIRED','Approve the exact customer fields and distribution basis before exporting a merchant dataset.');
      const root=path.resolve(destination);directory(root);
      const csv=this.bytes(edition.csv_sha256),config=this.bytes(edition.config_sha256);
      const sources=edition.source_ids.map(id=>{
        const source=this.get('sources',id);
        return {id,sha256:source.sha256,bytes:source.bytes,name:source.name,base_url:source.base_url,
          recorded_at:source.recorded_at,scope:source.scope,source:source.source};
      });
      const lineage={schema:'stellar-forge.dspace-lineage.v1',workspace_id:this.meta('workspace_id'),
        edition:{id:edition.id,sha256:edition.sha256,name:edition.name,created_at:edition.created_at},
        snapshot:edition.snapshot,mode:edition.mode,selection:edition.selection,metadata_fields:edition.metadataFields,
        rights:edition.rights,sources,item_count:edition.item_count,row_count:edition.row_count,
        files:{'data.csv':{bytes:csv.length,sha256:hash(csv)},'dataset.json':{bytes:config.length,sha256:hash(config)}}};
      await writeExact(path.join(root,'data.csv'),csv);await writeExact(path.join(root,'dataset.json'),config);
      await writeExact(path.join(root,'dspace-lineage.json'),json(lineage));
      const native=await loadDatasetConfig(path.join(root,'dataset.json'));
      if(native.describe().snapshot!==edition.snapshot)throw fault('DSPACE_EXPORT_SNAPSHOT','The exported dataset differs from its original snapshot.',409);
      return {directory:root,datasetPath:path.join(root,'dataset.json'),lineagePath:path.join(root,'dspace-lineage.json'),
        edition:summary('editions',edition),snapshot:edition.snapshot,lineage};
    });
  }
  exportFile(kind,id){
    return this.run(async()=>{
      const root=path.join(this.directory,'downloads');directory(root);
      let bytes,filename,contentType='application/json; charset=utf-8',file;
      if(kind==='project'){
        filename='DSpace_Repository_Datasets_'+this.revision()+'.sqlite3';
        file=path.join(root,this.meta('workspace_id')+'-'+this.revision()+'.sqlite3');
        if(!fs.existsSync(file)){
          const temporary=file+'.partial-'+randomUUID();
          try{
            this.db.exec("VACUUM INTO '"+temporary.replaceAll("'","''")+"'");
            const handle=await fsp.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
            await fsp.link(temporary,file);
          }finally{await fsp.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
        }
        regular(file);
        const check=new DatabaseSync(file,{readOnly:true});
        try{
          if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok'||
              JSON.parse(check.prepare('SELECT value FROM meta WHERE key=?').get('workspace_id').value)!==this.meta('workspace_id')||
              JSON.parse(check.prepare('SELECT value FROM meta WHERE key=?').get('revision').value)!==this.revision())
            throw fault('DSPACE_ARCHIVE_CHANGED','The retained project archive differs from its original workspace.',409);
        }finally{check.close();}
        contentType='application/vnd.sqlite3';
      }else if(kind==='source'){
        const source=this.get('sources',id);bytes=this.bytes(source.raw_sha256);filename=source.id+'.json';
      }else if(kind==='dataset'){
        const edition=this.get('editions',id);bytes=this.bytes(edition.csv_sha256);filename=edition.id+'.csv';contentType='text/csv; charset=utf-8';
      }else if(kind==='config'){
        const edition=this.get('editions',id);bytes=this.bytes(edition.config_sha256);filename=edition.id+'.dataset.json';
      }else if(kind==='comparison'){bytes=json(this.get('comparisons',id));filename=id+'.json';}
      else if(KINDS.includes(kind)){bytes=json(this.get(kind,id));filename=id+'.json';}
      else throw fault('DSPACE_DOWNLOAD_KIND','Choose an original source, edition, dataset, comparison or project.');
      if(bytes){file=path.join(root,hash(bytes));await writeExact(file,bytes);}
      return {path:file,filename,contentType,...await hashFile(file)};
    });
  }
  close(){
    if(this.closePromise)return this.closePromise;
    this.closing=true;
    this.closePromise=(async()=>{await this.tail;this.db.close();await this.lease.close();this.closed=true;})();
    return this.closePromise;
  }
}
export async function openDspaceWorkspace(options){return new DspaceWorkspace(options);}

/** Read a transferred project as data, then populate only our own schema.
 * The receiver preserves original workspace, request, edition and file IDs. */
export async function receiveDspaceWorkspace({file,directory:root}={}){
  if(typeof file!=='string'||typeof root!=='string')throw new TypeError('A complete original project file and private receiving directory are required.');
  const sourceFile=path.resolve(file),targetRoot=path.resolve(root);regular(sourceFile);
  const identity={schema:'stellar-forge.dspace-receiving.v1',...await hashFile(sourceFile)};
  directory(targetRoot);
  const receivingLease=acquireDatasetLease(targetRoot),finalFile=path.join(targetRoot,FILE);
  let source,target;
  try{
    // The database becomes visible only after all original records and bytes validate.
    // A retry after publication reopens the same workspace, including later edits.
    if(fs.existsSync(finalFile)){
      regular(finalFile);
      const existing=new DatabaseSync(finalFile,{readOnly:true});
      try{
        existing.exec('PRAGMA trusted_schema=OFF');
        const row=existing.prepare('SELECT value FROM meta WHERE key=?').get('receiving_source');
        if(!row||canonical(JSON.parse(row.value))!==canonical(identity))
          throw fault('DSPACE_RECEIVING_EXISTS','This destination already contains a different original workspace.',409);
      }finally{existing.close();}
    }else{
      await writeExact(path.join(targetRoot,'receiving-intent.json'),json(identity));
      source=new DatabaseSync(sourceFile,{readOnly:true});
      source.exec('PRAGMA trusted_schema=OFF; BEGIN');
      if(Number(source.prepare('PRAGMA application_id').get().application_id)!==APPLICATION_ID||
          source.prepare('PRAGMA quick_check').get().quick_check!=='ok')
        throw fault('DSPACE_ARCHIVE_FORMAT','Select a complete original repository dataset project.');
      const metadata=source.prepare('SELECT key,value FROM meta').all();
      const values=new Map(metadata.map(row=>[row.key,JSON.parse(row.value)]));
      if(values.get('schema')!==WORKSPACE_SCHEMA||typeof values.get('workspace_id')!=='string'||
          !Number.isSafeInteger(values.get('revision'))||values.get('revision')<0)
        throw fault('DSPACE_ARCHIVE_FORMAT','The original workspace metadata is invalid.');
      const stage=path.join(targetRoot,'receiving-stage');
      target=await openDspaceWorkspace({directory:stage});
      const ready=target.meta('receiving_source');
      if(ready&&canonical(ready)!==canonical(identity))
        throw fault('DSPACE_RECEIVING_CHANGED','The retained receiving stage belongs to another original archive.',409);
      if(!ready){
        if(target.revision()!==0||target.state().operation_count!==0||KINDS.some(kind=>target.list(kind).length))
          throw fault('DSPACE_RECEIVING_CHANGED','The receiving stage contains a different original workspace.',409);
    target.db.exec('BEGIN IMMEDIATE');
    try{
      target.db.exec('DELETE FROM meta');
      for(const row of metadata)target.db.prepare('INSERT INTO meta VALUES(?,?)').run(row.key,row.value);
      for(const row of source.prepare('SELECT sha256,bytes,data FROM blobs').iterate()){
        if(!HASH.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>MAX_SOURCE_BYTES)
          throw fault('DSPACE_ARCHIVE_FILE','The project contains an invalid original file identity.');
        const bytes=gunzipSync(row.data,{maxOutputLength:MAX_SOURCE_BYTES});
        if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw fault('DSPACE_ARCHIVE_FILE','An original project file failed its digest.');
        target.db.prepare('INSERT INTO blobs VALUES(?,?,?)').run(row.sha256,row.bytes,row.data);
      }
      for(const row of source.prepare('SELECT kind,id,sha256,summary,body FROM records').iterate()){
        if(!KINDS.includes(row.kind)||typeof row.id!=='string'||!HASH.test(row.sha256))
          throw fault('DSPACE_ARCHIVE_RECORD','Invalid original record identity.');
        const raw=gunzipSync(row.body,{maxOutputLength:MAX_SOURCE_BYTES}),doc=decode(raw);
        if(hash(raw)!==row.sha256||doc.id!==row.id||canonical(JSON.parse(row.summary))!==canonical(summary(row.kind,doc)))
          throw fault('DSPACE_ARCHIVE_RECORD','A retained record or summary differs from its original data.');
        target.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(row.kind,row.id,row.sha256,row.summary,row.body);
      }
      for(const row of source.prepare('SELECT id,request_sha256,input,result FROM operations').iterate()){
        if(!REQUEST.test(row.id)||hash(canonical(JSON.parse(row.input)))!==row.request_sha256||JSON.parse(row.result).operationId!==row.id)
          throw fault('DSPACE_ARCHIVE_OPERATION','An original request differs from its retained identity.');
        target.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(row.id,row.request_sha256,row.input,row.result);
      }
      for(const sourceSummary of target.list('sources')){
        const saved=target.get('sources',sourceSummary.id);
        const actual=inspectDspaceSource(target.bytes(saved.raw_sha256));
        if(actual.id!==saved.id||canonical(actual.items)!==canonical(saved.items))
          throw fault('DSPACE_ARCHIVE_SOURCE','The saved repository objects differ from the original source capture.');
      }
      for(const small of target.list('editions')){
        const edition=target.get('editions',small.id),unsigned={...edition};delete unsigned.sha256;
        if(hash(canonical(unsigned))!==edition.sha256)throw fault('DSPACE_ARCHIVE_EDITION','The immutable edition digest differs.');
        const projected=projectDspaceSources(edition.source_ids.map(id=>target.get('sources',id)),{
          name:edition.name,mode:edition.mode,selection:edition.selection,metadataFields:edition.metadataFields,rights:edition.rights});
        if(hash(projected.csv)!==edition.csv_sha256||hash(json(projected.config))!==edition.config_sha256||
            canonical(projected.records)!==canonical(edition.records))
          throw fault('DSPACE_ARCHIVE_PROJECTION','The selected original source does not reproduce its saved customer projection.');
      }
      target.setMeta('receiving_source',identity);
      target.db.exec('COMMIT');
    }catch(error){target.db.exec('ROLLBACK');throw error;}

      }
      if(canonical(await hashFile(sourceFile))!==canonical({bytes:identity.bytes,sha256:identity.sha256}))
        throw fault('DSPACE_ARCHIVE_CHANGED','The original archive changed while being received.',409);
      await target.close();target=null;source.close();source=null;
      await fsp.link(path.join(stage,FILE),finalFile);
      const handle=await fsp.open(targetRoot,'r');try{await handle.sync();}finally{await handle.close();}
      // Both names referred to the validated SQLite bytes. Retire only our own stage.
      await fsp.unlink(path.join(stage,FILE));
    }
  }finally{await target?.close();source?.close();await receivingLease.close();}
  return openDspaceWorkspace({directory:targetRoot});
}
