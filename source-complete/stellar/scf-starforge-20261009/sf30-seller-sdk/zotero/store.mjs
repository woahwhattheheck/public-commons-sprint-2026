// MIT. One native SQLite writer, immutable record revisions, and exact retained bytes.
import {DatabaseSync} from 'node:sqlite';
import {open,chmod,lstat,readdir} from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory,writeBytes,readBytes,writeJson,readJson} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {SCHEMA,LIMIT,need,plain,parse,json,sha256,clone,id,requestId,revision,now,objectReference} from './contracts.mjs';
const KINDS=new Set(['profile','capture','edition','project','comparison','handoff','rate']);
const format='stellar-forge.zotero-store.v1';
const hash=/^[a-f0-9]{64}$/;
const encode=value=>json(value).toString('utf8');

export async function openZoteroStore(directory,{receiving=false}={}) {
  need(isAbsolute(directory)&&resolve(directory)===directory,'ZOTERO_ABSOLUTE_DIRECTORY_REQUIRED');
  await privateDirectory(directory);
  const marker=await readJson(join(directory,'receiving.json')).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  need(!marker||marker.status==='COMPLETE'||receiving,'ZOTERO_RECEIVING_INCOMPLETE');
  await privateDirectory(join(directory,'objects'));
  let lease,db,closed=false;
  const secureFile=async path=>{
    const fd=await open(path,FS.O_RDWR|FS.O_CREAT|FS.O_NOFOLLOW,0o600);await fd.close();
    const st=await lstat(path);need(st.isFile()&&!st.isSymbolicLink()&&
      (typeof process.getuid!=='function'||st.uid===process.getuid())&&(st.mode&0o077)===0,
      'ZOTERO_PRIVATE_DATABASE_REQUIRED');
  };
  try{
    await secureFile(join(directory,'writer.sqlite'));
    lease=new DatabaseSync(join(directory,'writer.sqlite'));
    lease.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY);');
    try{lease.exec('BEGIN EXCLUSIVE');}catch{throw Object.assign(new Error('ZOTERO_WORKSPACE_IN_USE'),{code:'ZOTERO_WORKSPACE_IN_USE'});}
    await secureFile(join(directory,'workspace.sqlite'));
    db=new DatabaseSync(join(directory,'workspace.sqlite'));
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,sha256 TEXT NOT NULL,previous_sha TEXT,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(kind,id,revision));'+
      'CREATE TABLE IF NOT EXISTS heads (kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(kind,id),FOREIGN KEY(kind,id,revision) REFERENCES records(kind,id,revision));'+
      'CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,method TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);');
    if(!db.prepare('SELECT value FROM metadata WHERE key=?').get('identity')){
      const identity={schema:format,workspaceId:randomUUID(),createdAt:now()};
      db.prepare('INSERT INTO metadata VALUES (?,?)').run('identity',encode(identity));
    }
    let identity=parse(Buffer.from(db.prepare('SELECT value FROM metadata WHERE key=?').get('identity').value));
    need(identity.schema===format,'ZOTERO_STORE_SCHEMA_INVALID');
    for(const name of ['workspace.sqlite','workspace.sqlite-wal','workspace.sqlite-shm','writer.sqlite'])
      await chmod(join(directory,name),0o600).catch(e=>{if(e.code!=='ENOENT')throw e;});
    const live=()=>need(!closed,'ZOTERO_WORKSPACE_CLOSED');
    const decode=row=>{
      if(!row)return null;
      const payload=parse(Buffer.from(row.payload));need(sha256(json(payload))===row.sha256,'ZOTERO_RECORD_HASH_MISMATCH');
      return payload;
    };
    function get(kind,recordId,at=null) {
      live();need(KINDS.has(kind),'ZOTERO_RECORD_KIND_INVALID');id(recordId);
      const row=at===null?
        db.prepare('SELECT r.* FROM records r JOIN heads h ON r.kind=h.kind AND r.id=h.id AND r.revision=h.revision WHERE r.kind=? AND r.id=?').get(kind,recordId):
        db.prepare('SELECT * FROM records WHERE kind=? AND id=? AND revision=?').get(kind,recordId,revision(at));
      need(row,'ZOTERO_RECORD_NOT_FOUND',{kind,id:recordId});return decode(row);
    }
    function list(kind,{offset=0,limit=100}={}) {
      live();need(KINDS.has(kind),'ZOTERO_RECORD_KIND_INVALID');
      need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,'ZOTERO_PAGE_INVALID');
      const rows=db.prepare('SELECT r.* FROM records r JOIN heads h ON r.kind=h.kind AND r.id=h.id AND r.revision=h.revision WHERE r.kind=? ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?').all(kind,limit,offset);
      const total=Number(db.prepare('SELECT count(*) n FROM heads WHERE kind=?').get(kind).n);
      return {rows:rows.map(decode),offset,limit,total,next:offset+rows.length<total?offset+rows.length:null};
    }
    function history(kind,recordId) {
      live();id(recordId);need(KINDS.has(kind),'ZOTERO_RECORD_KIND_INVALID');
      return db.prepare('SELECT * FROM records WHERE kind=? AND id=? ORDER BY revision').all(kind,recordId).map(decode);
    }
    function put(kind,recordId,expected,value) {
      live();need(KINDS.has(kind)&&plain(value),'ZOTERO_RECORD_INVALID');id(recordId);revision(expected,{zero:true});
      const head=db.prepare('SELECT revision FROM heads WHERE kind=? AND id=?').get(kind,recordId);
      need((head?.revision??0)===expected,'ZOTERO_REVISION_CONFLICT',{current:head?.revision??0});
      const prior=head?db.prepare('SELECT sha256 FROM records WHERE kind=? AND id=? AND revision=?').get(kind,recordId,head.revision).sha256:null;
      const payload={...clone(value),id:recordId,revision:expected+1,previousSha256:prior,
        updatedAt:now(),createdAt:expected?get(kind,recordId).createdAt:(value.createdAt??now())};
      const body=json(payload),digest=sha256(body);
      db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?)').run(kind,recordId,payload.revision,digest,prior,body.toString('utf8'),payload.updatedAt);
      db.prepare('INSERT INTO heads VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision').run(kind,recordId,payload.revision);
      return clone(payload);
    }
    function transaction(work) {
      live();db.exec('BEGIN IMMEDIATE');
      try{const result=work();need(!(result&&typeof result.then==='function'),'ZOTERO_ASYNC_TRANSACTION_FORBIDDEN');db.exec('COMMIT');return result;}
      catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
    }
    function action(op,method,input,work) {
      const operation=requestId(op),inputHash=sha256(json({method,input}));
      return transaction(()=>{
        const old=db.prepare('SELECT * FROM requests WHERE id=?').get(operation);
        if(old){need(old.input_hash===inputHash&&old.method===method,'ZOTERO_REQUEST_INPUT_CHANGED');return {replayed:true,...parse(Buffer.from(old.result))};}
        const result=work();need(plain(result),'ZOTERO_ACTION_RESULT_INVALID');
        db.prepare('INSERT INTO requests VALUES (?,?,?,?,?)').run(operation,inputHash,method,encode(result),now());
        return {replayed:false,...clone(result)};
      });
    }
    async function putObject(bytes) {
      live();const body=Buffer.from(bytes);need(body.length<=LIMIT.transfer,'ZOTERO_OBJECT_LIMIT');
      const ref={sha256:sha256(body),bytes:body.length},path=join(directory,'objects',ref.sha256);
      try{await writeBytes(path,body,{exclusive:true});}
      catch(error){if(error.code!=='EEXIST')throw error;const old=await readBytes(path,LIMIT.transfer);
        need(old.length===body.length&&sha256(old)===ref.sha256,'ZOTERO_RETAINED_OBJECT_CHANGED');}
      return ref;
    }
    async function objectBytes(reference) {
      live();const ref=objectReference(reference),body=await readBytes(join(directory,'objects',ref.sha256),LIMIT.transfer);
      need(body.length===ref.bytes&&sha256(body)===ref.sha256,'ZOTERO_RETAINED_OBJECT_CHANGED');return body;
    }
    function snapshot() {
      live();
      return transaction(()=>({schema:format,identity:clone(identity),
        records:db.prepare('SELECT kind,id,revision,sha256,previous_sha,payload,created_at FROM records ORDER BY kind,id,revision').all(),
        heads:db.prepare('SELECT * FROM heads ORDER BY kind,id').all(),
        requests:db.prepare('SELECT * FROM requests ORDER BY created_at,id').all()}));
    }
    function adopt(snapshot) {
      live();validateSnapshot(snapshot);
      return transaction(()=>{
        need(Number(db.prepare('SELECT count(*) n FROM records').get().n)===0&&
          Number(db.prepare('SELECT count(*) n FROM requests').get().n)===0,'ZOTERO_RECEIVER_NOT_EMPTY');
        for(const r of snapshot.records)db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?)').run(r.kind,r.id,r.revision,r.sha256,r.previous_sha,r.payload,r.created_at);
        for(const h of snapshot.heads)db.prepare('INSERT INTO heads VALUES (?,?,?)').run(h.kind,h.id,h.revision);
        for(const r of snapshot.requests)db.prepare('INSERT INTO requests VALUES (?,?,?,?,?)').run(r.id,r.input_hash,r.method,r.result,r.created_at);
        identity=clone(snapshot.identity);db.prepare('UPDATE metadata SET value=? WHERE key=?').run(encode(identity),'identity');
        return clone(identity);
      });
    }
    function close() {
      if(closed)return;closed=true;const errors=[];
      try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch(e){errors.push(e);}
      try{db.close();}catch(e){errors.push(e);}
      try{lease.exec('ROLLBACK');}catch(e){errors.push(e);}
      try{lease.close();}catch(e){errors.push(e);}
      if(errors.length)throw new AggregateError(errors,'ZOTERO_CLOSE_FAILED');
    }
    return {directory,get identity(){return clone(identity);},get,list,history,put,transaction,action,putObject,objectBytes,snapshot,adopt,close};
  }catch(error){try{db?.close();}catch{}try{lease?.close();}catch{}throw error;}
}
export function validateSnapshot(value) {
  need(plain(value)&&value.schema===format&&plain(value.identity)&&value.identity.schema===format&&
    Array.isArray(value.records)&&Array.isArray(value.heads)&&Array.isArray(value.requests),'ZOTERO_TRANSFER_STATE_INVALID');
  need(value.records.length<=LIMIT.histories&&value.requests.length<=LIMIT.histories,'ZOTERO_TRANSFER_HISTORY_LIMIT');
  requestId(value.identity.workspaceId);
  const chains=new Map(),heads=new Map(),requests=new Set();
  for(const r of value.records){
    need(plain(r)&&KINDS.has(r.kind)&&typeof r.payload==='string'&&hash.test(r.sha256),'ZOTERO_TRANSFER_RECORD_INVALID');
    id(r.id);revision(r.revision);const p=parse(Buffer.from(r.payload));
    need(plain(p)&&p.id===r.id&&p.revision===r.revision&&p.previousSha256===r.previous_sha&&sha256(json(p))===r.sha256,
      'ZOTERO_TRANSFER_RECORD_HASH_MISMATCH');
    const k=r.kind+'\0'+r.id,chain=chains.get(k)??[];
    need(r.revision===chain.length+1&&r.previous_sha===(chain.at(-1)?.sha256??null),'ZOTERO_TRANSFER_HISTORY_BROKEN');
    chain.push(r);chains.set(k,chain);
  }
  for(const h of value.heads){
    need(plain(h)&&KINDS.has(h.kind),'ZOTERO_TRANSFER_HEAD_INVALID');const k=h.kind+'\0'+id(h.id);
    need(!heads.has(k)&&chains.has(k)&&h.revision===chains.get(k).length,'ZOTERO_TRANSFER_HEAD_MISMATCH');heads.set(k,h);
  }
  need(heads.size===chains.size,'ZOTERO_TRANSFER_HEADS_INCOMPLETE');
  for(const r of value.requests){
    requestId(r.id);need(!requests.has(r.id)&&hash.test(r.input_hash)&&typeof r.method==='string'&&
      typeof r.result==='string'&&plain(parse(Buffer.from(r.result))),'ZOTERO_TRANSFER_REQUEST_INVALID');requests.add(r.id);
  }
  return value;
}
export function snapshotObjectReferences(snapshot) {
  const refs=new Map();
  const walk=value=>{
    if(!value||typeof value!=='object')return;
    if(!Array.isArray(value)&&hash.test(value.sha256??'')&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&
      Object.keys(value).every(k=>['sha256','bytes'].includes(k))){const ref=objectReference(value),old=refs.get(ref.sha256);need(!old||old.bytes===ref.bytes,'ZOTERO_OBJECT_REFERENCE_CONFLICT');refs.set(ref.sha256,ref);return;}
    for(const child of Object.values(value))walk(child);
  };
  for(const row of snapshot.records)walk(parse(Buffer.from(row.payload)));
  for(const row of snapshot.requests)walk(parse(Buffer.from(row.result)));
  return [...refs.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256));
}
