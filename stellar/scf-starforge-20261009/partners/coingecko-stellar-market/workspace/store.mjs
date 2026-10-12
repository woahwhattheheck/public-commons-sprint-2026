// MIT. Retained project revisions, immutable sources and paged market rows.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {need,fail,plain,sha,uuid,now,jsonBytes,text,id,integer,page,clone} from '../common.mjs';

const stable=value=>Array.isArray(value)?value.map(stable):plain(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const search=value=>[value.name,value.title,value.id,value.endpoint,value.status,value.assignee,value.description,
  value.requestUrl,value.advertisedResourceUrl,JSON.stringify(value.identity??{}),JSON.stringify(value.path??{}),JSON.stringify(value.query??{})].filter(Boolean).join(' ').toLowerCase();
const decode=row=>row?JSON.parse(row.value):null;
const like=s=>'%'+s.replace(/[\\%_]/g,'\\$&')+'%';
export class MarketStore {
  constructor(directory) {
    this.directory=resolve(directory);mkdirSync(this.directory,{recursive:true,mode:0o700});
    need(lstatSync(this.directory).isDirectory()&&!lstatSync(this.directory).isSymbolicLink(),'INVALID_STATE_DIRECTORY');
    chmodSync(this.directory,0o700);
    this.db=new DatabaseSync(join(this.directory,'market.sqlite'),{timeout:5000});
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,config TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,search TEXT NOT NULL,value TEXT NOT NULL,FOREIGN KEY(project_id) REFERENCES projects(id));'+
      'CREATE INDEX IF NOT EXISTS record_page ON records(project_id,kind,updated DESC,id);'+
      'CREATE TABLE IF NOT EXISTS versions(id TEXT NOT NULL,project_id TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,created TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(id,version));'+
      'CREATE TABLE IF NOT EXISTS blobs(sha TEXT PRIMARY KEY,bytes INTEGER NOT NULL,data BLOB NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,content_type TEXT NOT NULL,sha TEXT NOT NULL,bytes INTEGER NOT NULL,created TEXT NOT NULL,FOREIGN KEY(project_id) REFERENCES projects(id),FOREIGN KEY(sha) REFERENCES blobs(sha));'+
      'CREATE INDEX IF NOT EXISTS file_page ON files(project_id,created DESC,id);'+
      'CREATE TABLE IF NOT EXISTS rows(owner_id TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT NOT NULL,kind TEXT NOT NULL,semantic_key TEXT NOT NULL,status TEXT,search TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(owner_id,id));'+
      'CREATE INDEX IF NOT EXISTS row_page ON rows(owner_id,kind,id);'+
      'CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,created TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT,value TEXT NOT NULL);'+
      'CREATE INDEX IF NOT EXISTS event_page ON events(project_id,id DESC);'+
      'CREATE TABLE IF NOT EXISTS operations(scope TEXT NOT NULL,op_id TEXT NOT NULL,request_sha TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(scope,op_id));'
    );
    chmodSync(join(this.directory,'market.sqlite'),0o600);
  }
  close(){this.db.close()}
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=fn();need(!result?.then,'ASYNC_TRANSACTION','Network work cannot run inside a store transaction');this.db.exec('COMMIT');return result}
    catch(error){this.db.exec('ROLLBACK');throw error}
  }
  project(projectId) {
    const r=this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    need(r,'PROJECT_NOT_FOUND','Project not found',404);
    return {id:r.id,name:r.name,revision:r.revision,createdAt:r.created,updatedAt:r.updated,config:JSON.parse(r.config)};
  }
  projects(){return this.db.prepare('SELECT id FROM projects ORDER BY updated DESC,id').all().map(r=>this.project(r.id))}
  newProject(name,config={}) {
    const value={id:uuid(),name:text(name,'project name',240),revision:0,createdAt:now(),updatedAt:now(),config};
    this.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(value.id,value.name,0,value.createdAt,value.updatedAt,JSON.stringify(config));return value;
  }
  projectConfig(projectId,config) {
    this.db.prepare('UPDATE projects SET config=? WHERE id=?').run(JSON.stringify(config),projectId);return this.project(projectId);
  }
  write(projectId,body,action,fn,target=null) {
    need(plain(body),'INVALID_WRITE');text(body.actor,'operator',240);id(body.opId,'operation ID');
    if(target){need(plain(target),'INVALID_WRITE_TARGET');id(target.id,'write target');text(target.kind,'write target kind',80);
      need(target.responseKey===undefined||['id','collectionId'].includes(target.responseKey),'INVALID_WRITE_TARGET')}
    const scope=projectId??'workspace',submitted={action,body},
      requestSha=sha(jsonBytes(stable(target?{...submitted,target:{kind:target.kind,id:target.id}}:submitted)));
    return this.transaction(()=>{
      const previous=this.db.prepare('SELECT * FROM operations WHERE scope=? AND op_id=?').get(scope,body.opId);
      if(previous) {
        const saved=JSON.parse(previous.response);
        // Existing receipts used the original action/body digest. Accept one
        // only when its saved result identifies this exact path-selected target.
        const legacySameTarget=target&&previous.request_sha===sha(jsonBytes(stable(submitted)))&&
          saved.value?.[target.responseKey??'id']===target.id;
        need(previous.request_sha===requestSha||legacySameTarget,'OPERATION_CONFLICT',
          'This operation ID already belongs to different submitted values or a different target',409);
        return {...saved,replayed:true};
      }
      if(projectId) {
        const current=this.project(projectId);integer(body.revision,'revision');
        need(body.revision===current.revision,'STALE_REVISION','The project changed; reload and combine the intended changes',409,{currentRevision:current.revision,current});
      }
      const value=fn(),actualProjectId=projectId??value.project?.id??value.id;
      let revision=0;
      if(actualProjectId) {
        this.db.prepare('UPDATE projects SET revision=revision+1,updated=? WHERE id=?').run(now(),actualProjectId);
        revision=this.project(actualProjectId).revision;
        this.event(actualProjectId,body.actor,action,value.id??value.project?.id??null,{opId:body.opId});
        if(value.id===actualProjectId)value.revision=revision;
        if(value.project?.id===actualProjectId)value.project.revision=revision;
      }
      const response={ok:true,opId:body.opId,projectId:actualProjectId,revision,value};
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(scope,body.opId,requestSha,JSON.stringify(response));return response;
    });
  }
  operation(projectId,opId) {
    id(opId,'operation ID');if(projectId)this.project(projectId);
    const scope=projectId??'workspace',row=this.db.prepare('SELECT request_sha,response FROM operations WHERE scope=? AND op_id=?').get(scope,opId);
    return row?{state:'RETAINED',scope,opId,requestSha256:row.request_sha,response:JSON.parse(row.response)}:
      {state:'NOT_RETAINED',scope,opId};
  }
  optional(kind,recordId) {return decode(this.db.prepare('SELECT value FROM records WHERE id=? AND kind=?').get(recordId,kind))}
  get(kind,recordId) {const value=this.optional(kind,recordId);need(value,'RECORD_NOT_FOUND',kind+' record not found',404);return value}
  expected(kind,recordId,version) {
    const current=this.get(kind,recordId);integer(version,'version',1);
    need(current.version===version,'STALE_VERSION','This record changed; inspect its latest values before applying your changes',409,{current});return current;
  }
  owned(kind,recordId,projectId) {
    const value=this.get(kind,recordId);need(value.projectId===projectId,'WRONG_PROJECT','Record belongs to another project');return value;
  }
  put(kind,value,{history=true}={}) {
    const existing=value.id?this.optional(kind,value.id):null,stamp=now();
    const record={...clone(value),id:value.id??uuid(),version:(existing?.version??0)+1,
      createdAt:existing?.createdAt??value.createdAt??stamp,updatedAt:stamp};
    need(record.projectId,'PROJECT_REQUIRED');
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,updated=excluded.updated,search=excluded.search,value=excluded.value')
      .run(record.id,record.projectId,kind,record.version,record.createdAt,record.updatedAt,search(record),JSON.stringify(record));
    if(history||!existing)this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?)').run(record.id,record.projectId,kind,record.version,stamp,JSON.stringify(record));
    return record;
  }
  versions(kind,recordId) {
    this.get(kind,recordId);return this.db.prepare('SELECT value FROM versions WHERE id=? AND kind=? ORDER BY version').all(recordId,kind).map(decode);
  }
  counts(projectId) {
    const result={requests:0,collections:0,files:0,captures:0,jobs:0,snapshots:0,comparisons:0,notes:0,providerPlans:0,exports:0};
    for(const row of this.db.prepare('SELECT kind,COUNT(*) total FROM records WHERE project_id=? GROUP BY kind').all(projectId))result[row.kind]=row.total;
    result.files=this.db.prepare('SELECT COUNT(*) total FROM files WHERE project_id=?').get(projectId).total;return result;
  }
  list(kind,projectId,query={}) {
    this.project(projectId);const p=page(query),where=['project_id=?','kind=?'],params=[projectId,kind];
    if(p.q){where.push("search LIKE ? ESCAPE '\\'");params.push(like(p.q))}
    if(query.status){where.push("json_extract(value,'$.status')=?");params.push(query.status)}
    const condition=where.join(' AND '),total=this.db.prepare('SELECT COUNT(*) total FROM records WHERE '+condition).get(...params).total;
    const items=this.db.prepare('SELECT value FROM records WHERE '+condition+' ORDER BY updated DESC,id LIMIT ? OFFSET ?').all(...params,p.limit,p.offset).map(decode);
    return {items,total,offset:p.offset,limit:p.limit};
  }
  all(kind,projectId){return this.db.prepare('SELECT value FROM records WHERE project_id=? AND kind=? ORDER BY created,id').all(projectId,kind).map(decode)}
  event(projectId,actor,kind,recordId,data={}) {
    const event={createdAt:now(),actor,kind,recordId,data};
    this.db.prepare('INSERT INTO events(project_id,created,actor,kind,record_id,value) VALUES(?,?,?,?,?,?)')
      .run(projectId,event.createdAt,actor,kind,recordId,JSON.stringify(event));return event;
  }
  events(projectId,query={}) {
    const p=page(query),condition=p.q?"project_id=? AND lower(value) LIKE ? ESCAPE '\\'":'project_id=?',
      params=p.q?[projectId,like(p.q)]:[projectId];
    const total=this.db.prepare('SELECT COUNT(*) total FROM events WHERE '+condition).get(...params).total;
    return {items:this.db.prepare('SELECT id,value FROM events WHERE '+condition+' ORDER BY id DESC LIMIT ? OFFSET ?').all(...params,p.limit,p.offset).map(r=>({id:r.id,...decode(r)})),
      total,offset:p.offset,limit:p.limit};
  }
  file(projectId,name,contentType,content) {
    const bytes=Buffer.from(content),digest=sha(bytes),createdAt=now(),fileId=uuid();
    this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(digest,bytes.length,bytes);
    this.db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)').run(fileId,projectId,name,contentType,digest,bytes.length,createdAt);
    return {id:fileId,projectId,name,contentType,sha256:digest,bytes:bytes.length,createdAt};
  }
  fileInfo(fileId) {
    const r=this.db.prepare('SELECT * FROM files WHERE id=?').get(fileId);need(r,'FILE_NOT_FOUND','Original file not found',404);
    return {id:r.id,projectId:r.project_id,name:r.name,contentType:r.content_type,sha256:r.sha,bytes:r.bytes,createdAt:r.created};
  }
  fileBytes(fileId) {
    const f=this.fileInfo(fileId),r=this.db.prepare('SELECT data FROM blobs WHERE sha=?').get(f.sha256);
    need(r,'FILE_BYTES_UNAVAILABLE','Original bytes are unavailable',404);const b=Buffer.from(r.data);need(sha(b)===f.sha256,'FILE_HASH_MISMATCH');return b;
  }
  files(projectId,query={}) {
    const p=page(query),where=p.q?"project_id=? AND lower(name) LIKE ? ESCAPE '\\'":'project_id=?',params=p.q?[projectId,like(p.q)]:[projectId];
    const total=this.db.prepare('SELECT COUNT(*) total FROM files WHERE '+where).get(...params).total;
    return {items:this.db.prepare('SELECT id FROM files WHERE '+where+' ORDER BY created DESC,id LIMIT ? OFFSET ?').all(...params,p.limit,p.offset).map(r=>this.fileInfo(r.id)),
      total,offset:p.offset,limit:p.limit};
  }
  setRows(ownerId,projectId,rows) {
    need(this.db.prepare('SELECT COUNT(*) total FROM rows WHERE owner_id=?').get(ownerId).total===0,'ROWS_ALREADY_RETAINED');
    const insert=this.db.prepare('INSERT INTO rows VALUES(?,?,?,?,?,?,?,?)');
    for(const row of rows)insert.run(ownerId,row.id,projectId,row.kind,row.key,row.status??null,search(row),JSON.stringify(row));
  }
  rows(ownerIds,query={}) {
    const p=page(query);if(!ownerIds.length)return {items:[],total:0,offset:p.offset,limit:p.limit};
    const where=['owner_id IN ('+ownerIds.map(()=>'?').join(',')+')'],params=[...ownerIds];
    if(p.q){where.push("search LIKE ? ESCAPE '\\'");params.push(like(p.q))}
    if(query.kind){where.push('kind=?');params.push(query.kind)}
    if(query.status){where.push('status=?');params.push(query.status)}
    const condition=where.join(' AND '),total=this.db.prepare('SELECT COUNT(*) total FROM rows WHERE '+condition).get(...params).total;
    return {items:this.db.prepare('SELECT value FROM rows WHERE '+condition+' ORDER BY semantic_key,owner_id,id LIMIT ? OFFSET ?').all(...params,p.limit,p.offset).map(decode),
      total,offset:p.offset,limit:p.limit};
  }
  row(ownerId,rowId) {
    const row=decode(this.db.prepare('SELECT value FROM rows WHERE owner_id=? AND id=?').get(ownerId,rowId));need(row,'ROW_NOT_FOUND','Original row not found',404);return row;
  }
  allRows(ownerIds) {
    if(!ownerIds.length)return [];
    return this.db.prepare('SELECT value FROM rows WHERE owner_id IN ('+ownerIds.map(()=>'?').join(',')+') ORDER BY semantic_key,owner_id,id').all(...ownerIds).map(decode);
  }
  exportProject(projectId) {
    const project=this.project(projectId),records=this.db.prepare('SELECT kind,value FROM records WHERE project_id=? ORDER BY kind,created,id').all(projectId).map(r=>({kind:r.kind,value:decode(r)}));
    const sourceReferences=new Set();
    function references(value){if(!value||typeof value!=='object')return;for(const[key,item]of Object.entries(value)){
      if(['bodyFileId','headersFileId','challengeFileId','sourceFileId','importFileId'].includes(key)&&typeof item==='string')sourceReferences.add(item);
      else if(['sourceFileIds','nativeSourceFileIds'].includes(key)&&Array.isArray(item))item.forEach(id=>sourceReferences.add(id));
      else if(typeof item==='object')references(item);
    }}
    records.filter(r=>r.kind!=='exports').forEach(r=>references(r.value));
    const unavailable=new Set(records.filter(r=>r.kind==='exports'&&!sourceReferences.has(r.value.fileId)).map(r=>r.value.fileId));
    for(const r of records)if(r.kind==='exports')r.value.available=false;
    const files=this.db.prepare('SELECT id FROM files WHERE project_id=? ORDER BY created,id').all(projectId).map(r=>this.fileInfo(r.id)).filter(f=>!unavailable.has(f.id));
    const blobs={};for(const f of files)if(!blobs[f.sha256])blobs[f.sha256]=this.fileBytes(f.id).toString('base64');
    const versions=this.db.prepare('SELECT kind,value FROM versions WHERE project_id=? ORDER BY id,version').all(projectId).filter(r=>r.kind!=='exports').map(r=>({kind:r.kind,value:decode(r)}));
    const rows=this.db.prepare('SELECT owner_id,value FROM rows WHERE project_id=? ORDER BY owner_id,id').all(projectId).map(r=>({ownerId:r.owner_id,value:decode(r)}));
    const events=this.db.prepare('SELECT id,value FROM events WHERE project_id=? ORDER BY id').all(projectId).map(r=>({id:r.id,...decode(r)}));
    return {project,records,versions,files,blobs,rows,events};
  }
}
