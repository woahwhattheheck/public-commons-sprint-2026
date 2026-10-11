// MIT. Research annotations and immutable editions; payments remain in the original Buyer.
import {DatabaseSync} from 'node:sqlite';
import {mkdir,realpath,chmod,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {plain,need,encoded,sha,requestInput,resultView} from './contract.mjs';
const now=()=>new Date().toISOString();
const decode=v=>v===null||v===undefined?null:JSON.parse(v);
const version=v=>{need(Number.isSafeInteger(v)&&v>=0,'REVISION_REQUIRED');return v;};
const label=(v,max=200)=>{need(typeof v==='string'&&v.trim()&&v.length<=max,'TEXT_INVALID');return v;};
export class ResearchStore{
  static async open(directory){
    need(typeof directory==='string'&&resolve(directory)===directory,'PRIVATE_CANONICAL_DIRECTORY_REQUIRED');
    await mkdir(directory,{recursive:true,mode:0o700});
    need(await realpath(directory)===directory,'PRIVATE_CANONICAL_DIRECTORY_REQUIRED');
    const info=await lstat(directory);need(info.isDirectory()&&(info.mode&0o077)===0,'PRIVATE_DIRECTORY_REQUIRED');
    const path=join(directory,'research.sqlite');
    try{const dbInfo=await lstat(path);need(dbInfo.isFile()&&!dbInfo.isSymbolicLink()&&(dbInfo.mode&0o077)===0,'PRIVATE_DATABASE_REQUIRED');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const db=new DatabaseSync(path);await chmod(path,0o600);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    db.exec(
      'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS queries(id TEXT PRIMARY KEY,title TEXT NOT NULL,operation TEXT NOT NULL,input TEXT NOT NULL,input_sha TEXT NOT NULL,revision INTEGER NOT NULL,phase TEXT NOT NULL,prepared TEXT,capture_id TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,query_id TEXT NOT NULL REFERENCES queries(id),input_sha TEXT NOT NULL,raw BLOB NOT NULL,sha TEXT NOT NULL,kind TEXT NOT NULL,provenance TEXT NOT NULL,created TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS annotations(capture_id TEXT NOT NULL REFERENCES captures(id),row_id TEXT NOT NULL,revision INTEGER NOT NULL,selected INTEGER NOT NULL,note TEXT NOT NULL,tags TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(capture_id,row_id));'+
      'CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,title TEXT NOT NULL,revision INTEGER NOT NULL,description TEXT NOT NULL,updated TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS members(collection_id TEXT NOT NULL REFERENCES collections(id),capture_id TEXT NOT NULL REFERENCES captures(id),PRIMARY KEY(collection_id,capture_id));'+
      'CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY,collection_id TEXT NOT NULL REFERENCES collections(id),collection_revision INTEGER NOT NULL,manifest TEXT NOT NULL,sha TEXT NOT NULL,created TEXT NOT NULL);'
    );
    db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('schema','stellar-forge.firecrawl-research.v1');
    need(db.prepare('SELECT value FROM meta WHERE key=?').get('schema').value==='stellar-forge.firecrawl-research.v1','RESEARCH_SCHEMA_MISMATCH');
    return new ResearchStore(directory,db);
  }
  constructor(directory,db){this.directory=directory;this.db=db;this.closed=false;}
  transaction(action){
    this.db.exec('BEGIN IMMEDIATE');
    try{const value=action();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  close(){if(!this.closed){this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');this.db.close();this.closed=true;}}
  query(id){
    const row=this.db.prepare('SELECT * FROM queries WHERE id=?').get(id);need(row,'QUERY_NOT_FOUND');
    return {...row,input:decode(row.input),prepared:decode(row.prepared)};
  }
  list({offset=0,limit=30}={}){
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=100,'PAGE_INVALID');
    return {total:this.db.prepare('SELECT count(*) AS total FROM queries').get().total,
      queries:this.db.prepare('SELECT id,title,operation,revision,phase,capture_id,created,updated FROM queries ORDER BY created DESC,id LIMIT ? OFFSET ?').all(limit,offset),
      collections:this.db.prepare('SELECT * FROM collections ORDER BY updated DESC,id').all()};
  }
  captures({offset=0,limit=100}={}){
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=100,'PAGE_INVALID');
    return {total:this.db.prepare('SELECT count(*) AS total FROM captures').get().total,rows:this.db.prepare('SELECT c.id,c.sha,c.kind,c.created,q.id AS query_id,q.title,q.operation FROM captures c JOIN queries q ON q.id=c.query_id ORDER BY c.created DESC,c.id LIMIT ? OFFSET ?').all(limit,offset)};
  }
  saveQuery({id,title,operation,input,expectedRevision},p){
    label(title);const checked=requestInput(operation,input,p),digest=sha(encoded({operation,input:checked}));
    return this.transaction(()=>{
      const timestamp=now();
      if(id){
        const old=this.query(id);need(old.revision===version(expectedRevision),'QUERY_STALE');
        need(old.phase==='DRAFT','PREPARED_REQUEST_IMMUTABLE');
        this.db.prepare('UPDATE queries SET title=?,operation=?,input=?,input_sha=?,revision=revision+1,updated=? WHERE id=?').run(title,operation,JSON.stringify(checked),digest,timestamp,id);
      }else{
        id=randomUUID();
        this.db.prepare('INSERT INTO queries VALUES(?,?,?,?,?,1,?,NULL,NULL,?,?)').run(id,title,operation,JSON.stringify(checked),digest,'DRAFT',timestamp,timestamp);
      }
      return this.query(id);
    });
  }
  beginPrepare(id,expectedRevision,record){
    return this.transaction(()=>{
      const q=this.query(id);need(q.revision===version(expectedRevision),'QUERY_STALE');
      need(q.phase==='DRAFT'||q.phase==='PREPARING','REQUEST_ALREADY_PREPARED');
      need(plain(record),'PREPARATION_REQUIRED');
      if(q.phase==='PREPARING')need(JSON.stringify(q.prepared)===JSON.stringify(record),'PREPARATION_SELECTION_CHANGED');
      this.db.prepare('UPDATE queries SET phase=?,prepared=?,updated=? WHERE id=?').run('PREPARING',JSON.stringify(record),now(),id);return this.query(id);
    });
  }
  prepared(id,inputSha,record){
    return this.transaction(()=>{
      const q=this.query(id);need(q.input_sha===inputSha&&q.phase==='PREPARING','QUERY_STALE');
      this.db.prepare('UPDATE queries SET phase=?,prepared=?,revision=revision+1,updated=? WHERE id=?').run('PREPARED',JSON.stringify(record),now(),id);
      return this.query(id);
    });
  }
  attachCapture(id,inputSha,bytes,{kind,provenance}){
    need(Buffer.isBuffer(bytes)&&bytes.length<=1048576&&plain(provenance)&&['NATIVE_BUYER','PROVIDER_OBSERVATION'].includes(kind),'CAPTURE_INVALID');
    const digest=sha(bytes),q=this.query(id);
    resultView(q.operation,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    return this.transaction(()=>{
      const current=this.query(id);need(current.input_sha===inputSha,'QUERY_STALE');
      if(kind==='PROVIDER_OBSERVATION')need(!current.prepared&&['DRAFT','CAPTURED'].includes(current.phase),'OBSERVATION_REQUIRES_UNPURCHASED_QUERY');
      const existing=this.db.prepare('SELECT id FROM captures WHERE query_id=? AND sha=? AND kind=?').get(id,digest,kind);
      if(existing)return this.capture(existing.id);
      const captureId=randomUUID(),timestamp=now();
      this.db.prepare('INSERT INTO captures VALUES(?,?,?,?,?,?,?,?)').run(captureId,id,inputSha,bytes,digest,kind,JSON.stringify(provenance),timestamp);
      this.db.prepare('UPDATE queries SET phase=?,capture_id=?,revision=revision+1,updated=? WHERE id=?').run('CAPTURED',captureId,timestamp,id);
      return this.capture(captureId);
    });
  }
  capture(id){
    const row=this.db.prepare('SELECT * FROM captures WHERE id=?').get(id);need(row,'CAPTURE_NOT_FOUND');
    const raw=Buffer.from(row.raw);need(sha(raw)===row.sha,'CAPTURE_BYTES_CHANGED');
    const query=this.query(row.query_id);need(query.input_sha===row.input_sha,'CAPTURE_INPUT_CHANGED');
    return {...row,raw,query,provenance:decode(row.provenance),payload:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
  }
  detail(id){
    const q=this.query(id),capture=q.capture_id?this.capture(q.capture_id):null;
    if(!capture)return {query:q,capture:null};
    const notes=new Map(this.db.prepare('SELECT * FROM annotations WHERE capture_id=?').all(capture.id).map(n=>[n.row_id,n]));
    return {query:q,capture:{id:capture.id,sha:capture.sha,kind:capture.kind,created:capture.created,provenance:capture.provenance,
      ...resultView(q.operation,capture.payload),
      annotations:Object.fromEntries([...notes].map(([key,n])=>[key,{revision:n.revision,selected:!!n.selected,note:n.note,tags:decode(n.tags)}]))}};
  }
  annotate({captureId,rowId,expectedRevision,selected,note,tags=[]}){
    need(typeof selected==='boolean'&&typeof note==='string'&&note.length<=16000&&Array.isArray(tags)&&
      tags.length<=20&&tags.every(t=>typeof t==='string'&&t.trim()&&t.length<=80),'ANNOTATION_INVALID');
    return this.transaction(()=>{
      const c=this.capture(captureId);need(resultView(c.query.operation,c.payload).rows.some(r=>r.id===rowId),'RESULT_NOT_FOUND');
      const existing=this.db.prepare('SELECT revision FROM annotations WHERE capture_id=? AND row_id=?').get(captureId,rowId);
      need((existing?.revision??0)===version(expectedRevision),'ANNOTATION_STALE');
      const revision=(existing?.revision??0)+1;
      this.db.prepare('INSERT INTO annotations VALUES(?,?,?,?,?,?,?) ON CONFLICT(capture_id,row_id) DO UPDATE SET revision=excluded.revision,selected=excluded.selected,note=excluded.note,tags=excluded.tags,updated=excluded.updated')
        .run(captureId,rowId,revision,selected?1:0,note,JSON.stringify(tags),now());
      return {revision,selected,note,tags};
    });
  }
  saveCollection({id,title,description='',captureIds,expectedRevision}){
    label(title);need(typeof description==='string'&&description.length<=16000&&Array.isArray(captureIds)&&
      captureIds.length<=1000&&new Set(captureIds).size===captureIds.length,'COLLECTION_INVALID');
    return this.transaction(()=>{
      for(const capture of captureIds)need(this.db.prepare('SELECT id FROM captures WHERE id=?').get(capture),'CAPTURE_NOT_FOUND');
      const timestamp=now();let revision=1;
      if(id){
        const old=this.db.prepare('SELECT * FROM collections WHERE id=?').get(id);need(old,'COLLECTION_NOT_FOUND');
        need(old.revision===version(expectedRevision),'COLLECTION_STALE');revision=old.revision+1;
        this.db.prepare('UPDATE collections SET title=?,description=?,revision=?,updated=? WHERE id=?').run(title,description,revision,timestamp,id);
        this.db.prepare('DELETE FROM members WHERE collection_id=?').run(id);
      }else{id=randomUUID();this.db.prepare('INSERT INTO collections VALUES(?,?,?,?,?)').run(id,title,revision,description,timestamp);}
      for(const capture of captureIds)this.db.prepare('INSERT INTO members VALUES(?,?)').run(id,capture);
      return this.collection(id);
    });
  }
  collection(id){
    const value=this.db.prepare('SELECT * FROM collections WHERE id=?').get(id);need(value,'COLLECTION_NOT_FOUND');
    const captureIds=this.db.prepare('SELECT capture_id FROM members WHERE collection_id=? ORDER BY capture_id').all(id).map(x=>x.capture_id);
    const selection=captureIds.map(captureId=>({captureId,sha256:this.db.prepare('SELECT sha FROM captures WHERE id=?').get(captureId).sha,annotations:this.db.prepare('SELECT row_id,revision,selected,note,tags FROM annotations WHERE capture_id=? ORDER BY row_id').all(captureId)}));
    return {...value,captureIds,selectionSha256:sha(encoded(selection)),
      editions:this.db.prepare('SELECT id,collection_revision,sha,created FROM editions WHERE collection_id=? ORDER BY created DESC').all(id)};
  }
  freezeCollection(id,expectedRevision,expectedSelectionSha256){
    return this.transaction(()=>{
      const collection=this.collection(id);need(collection.revision===version(expectedRevision),'COLLECTION_STALE');
      need(collection.selectionSha256===expectedSelectionSha256,'COLLECTION_SELECTION_CHANGED');
      let retainedBytes=0;
      const captures=collection.captureIds.map(captureId=>{
        const c=this.capture(captureId);
        const annotations=Object.fromEntries(this.db.prepare('SELECT * FROM annotations WHERE capture_id=?').all(captureId).map(n=>[n.row_id,{revision:n.revision,selected:!!n.selected,note:n.note,tags:decode(n.tags)}]));
        const retained={id:c.id,query:{id:c.query.id,title:c.query.title,operation:c.query.operation,input:c.query.input,inputSha256:c.input_sha},
          responseSha256:c.sha,kind:c.kind,created:c.created,provenance:c.provenance,
          responseBase64:c.raw.toString('base64'),annotations};
        retainedBytes+=encoded(retained).length;need(retainedBytes<=64*1024*1024,'COLLECTION_EDITION_EXCEEDS_64_MIB');
        return retained;
      });
      const manifest={schema:'stellar-forge.firecrawl-collection.v1',id:randomUUID(),created:now(),
        collection:{id,title:collection.title,description:collection.description,revision:collection.revision},captures};
      const raw=encoded(manifest);need(raw.length<=64*1024*1024,'COLLECTION_EDITION_EXCEEDS_64_MIB');const digest=sha(raw);
      this.db.prepare('INSERT INTO editions VALUES(?,?,?,?,?,?)').run(manifest.id,id,collection.revision,raw.toString('utf8'),digest,manifest.created);
      return {id:manifest.id,sha256:digest,manifest};
    });
  }
  edition(id){
    const row=this.db.prepare('SELECT * FROM editions WHERE id=?').get(id);need(row,'EDITION_NOT_FOUND');
    need(sha(Buffer.from(row.manifest))===row.sha,'EDITION_BYTES_CHANGED');
    return {id,sha256:row.sha,manifest:decode(row.manifest)};
  }
}
