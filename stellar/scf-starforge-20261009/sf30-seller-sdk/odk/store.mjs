// MIT. Indexed native capture state and immutable, streamed source bodies.
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, link, mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { acquireReleaseLease } from '../../sf82-seller-pilot/release-process.mjs';
import { digest, fault, formatted, identifier, now, retain, stable, writeNew } from '../odata/state.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.odk-central-workspace.v1';
const hashPattern = /^[a-f0-9]{64}$/;
export function requireHash(hash) {
  if (typeof hash !== 'string' || !hashPattern.test(hash)) throw fault('CENTRAL_SOURCE_HASH', 'Choose a retained source hash.');
  return hash;
}
export async function verifyFile(path, expected) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
  const sha256 = hash.digest('hex');
  if (expected && sha256 !== expected) throw fault('CENTRAL_SOURCE_CHANGED', 'An original retained source file changed.', 409);
  return { sha256, bytes };
}
export async function openCentralStore(directory) {
  if (!directory) throw fault('CENTRAL_WORKSPACE_REQUIRED', 'Choose a retained workspace directory.');
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const child of ['sources','exports','reports','transfers','temporary']) await mkdir(join(root,child), { recursive: true, mode: 0o700 });
  const lease = await acquireReleaseLease(root, 'run.lock');
  if (!lease) throw fault('CENTRAL_PLATFORM', 'Run this workspace on Linux with Node 24 or newer and util-linux flock.');
  let db, closed = false;
  try {
    const path = join(root,'central.sqlite');
    try { const file = await open(path,'wx',0o600); await file.close(); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    db = new DatabaseSync(path);
    await chmod(path,0o600);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec(
      'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));' +
      'CREATE TABLE IF NOT EXISTS resources (capture TEXT NOT NULL,key TEXT NOT NULL,kind TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(capture,key));' +
      'CREATE INDEX IF NOT EXISTS resources_kind ON resources(capture,kind);' +
      'CREATE TABLE IF NOT EXISTS pages (capture TEXT NOT NULL,table_id TEXT NOT NULL,ordinal INTEGER NOT NULL,request_url TEXT NOT NULL,source_hash TEXT NOT NULL,rows_hash TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(capture,table_id,ordinal),UNIQUE(capture,table_id,request_url));' +
      'CREATE TABLE IF NOT EXISTS rows (capture TEXT NOT NULL,table_id TEXT NOT NULL,row_id TEXT NOT NULL,parent_table TEXT,parent_id TEXT,body_hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(capture,table_id,row_id));' +
      'CREATE INDEX IF NOT EXISTS rows_parent ON rows(capture,parent_table,parent_id);' +
      'CREATE TABLE IF NOT EXISTS submissions (capture TEXT NOT NULL,form_key TEXT NOT NULL,instance_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(capture,form_key,instance_id));'
    );
    const schema = db.prepare('SELECT value FROM metadata WHERE key=?').get('schema')?.value;
    if (schema && schema !== WORKSPACE_SCHEMA) throw fault('CENTRAL_WORKSPACE_SCHEMA', 'This workspace uses another storage version.');
    db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('schema',WORKSPACE_SCHEMA);
    db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('createdAt',now());
    db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('revision','0');
    db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('workspaceId',randomUUID());
  } catch (error) { db?.close(); await lease.close(); throw error; }
  function assertOpen() { if (closed) throw fault('CENTRAL_CLOSED', 'Reopen the workspace.'); }
  function transaction(operation) {
    assertOpen(); db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const recordRow = row => row ? { ...JSON.parse(row.value), revision: row.revision } : null;
  function get(kind,id,required = true) {
    assertOpen(); const result = recordRow(db.prepare('SELECT revision,value FROM records WHERE kind=? AND id=?').get(kind,id));
    if (!result && required) throw fault('CENTRAL_NOT_FOUND', 'This ' + kind + ' does not exist.',404);
    return result;
  }
  function list(kind) { assertOpen(); return db.prepare('SELECT revision,value FROM records WHERE kind=? ORDER BY rowid').all(kind).map(recordRow); }
  function changed() { db.prepare("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run(); }
  function writeRecord(kind,id,value,expectedRevision) {
    const old = get(kind,id,false);
    if (expectedRevision !== undefined && (old?.revision ?? 0) !== expectedRevision)
      throw fault('CENTRAL_REVISION_CHANGED','This record changed; reopen its current revision.',409);
    const revision = (old?.revision ?? 0) + 1, saved = { ...value,id,revision,updatedAt:now() };
    db.prepare('INSERT INTO records(kind,id,revision,value) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,value=excluded.value')
      .run(kind,id,revision,JSON.stringify(saved));
    changed(); return saved;
  }
  const put = (kind,id,value,expectedRevision) => transaction(() => writeRecord(kind,id,value,expectedRevision));
  const update = (kind,id,operation) => transaction(() => { const old=get(kind,id);return writeRecord(kind,id,operation(old),old.revision); });
  function resource(capture,key) {
    const row=db.prepare('SELECT value FROM resources WHERE capture=? AND key=?').get(capture,key);
    return row ? JSON.parse(row.value) : null;
  }
  function saveResource(capture,key,kind,receipt) {
    requireHash(receipt.sha256);
    const previous = resource(capture,key);
    if (previous) {
      if (stable(previous) !== stable(receipt)) throw fault('CENTRAL_RESOURCE_CHANGED','An immutable capture resource already has another body or receipt.',409);
      return previous;
    }
    db.prepare('INSERT INTO resources(capture,key,kind,sha256,bytes,value) VALUES (?,?,?,?,?,?)')
      .run(capture,key,kind,receipt.sha256,receipt.bytes,JSON.stringify(receipt));
    changed(); return receipt;
  }
  async function retainStream(body) {
    assertOpen(); const path=join(root,'temporary',randomUUID()+'.part'), file=await open(path,'wx',0o600);
    const hash=createHash('sha256');let bytes=0;
    try {
      try { for await (const chunk of body ?? []) { bytes+=chunk.byteLength;hash.update(chunk);await file.writeFile(chunk); } await file.sync(); }
      finally { await file.close(); }
      const sha256=hash.digest('hex'), destination=join(root,'sources',sha256);
      try { await link(path,destination); }
      catch(error) { if(error.code!=='EEXIST')throw error;await verifyFile(destination,sha256); }
      const directory=await open(join(root,'sources'),'r');try { await directory.sync(); } finally { await directory.close(); }
      return {sha256,bytes};
    } finally { await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
  }
  async function raw(hash) {
    const bytes=await readFile(join(root,'sources',requireHash(hash)));
    if(digest(bytes)!==hash)throw fault('CENTRAL_SOURCE_CHANGED','A retained source body changed.',409);
    return bytes;
  }
  async function sourceFile(hash) {
    const path=join(root,'sources',requireHash(hash));return {path,...await verifyFile(path,hash)};
  }
  function pageRecords(capture,tableId) {
    return db.prepare('SELECT value FROM pages WHERE capture=? AND table_id=? ORDER BY ordinal').all(capture,tableId).map(row=>JSON.parse(row.value));
  }
  function commitPage(captureId,tableId,expectedUrl,page,sourceReceipt,rowsReceipt,relation) {
    return transaction(()=>{
      const capture=get('capture',captureId),table=capture.tables.find(item=>item.id===tableId);
      if(!table||table.nextLink!==expectedUrl||capture.status!=='CAPTURING')throw fault('CENTRAL_CAPTURE_CHANGED','The retained capture cursor changed.',409);
      if(page.nextLink===expectedUrl||page.nextLink&&db.prepare('SELECT 1 AS found FROM pages WHERE capture=? AND table_id=? AND request_url=?').get(captureId,tableId,page.nextLink))
        throw fault('CENTRAL_PAGE_LOOP','Central repeated a continuation URL.',502);
      const insert=db.prepare('INSERT INTO rows(capture,table_id,row_id,parent_table,parent_id,body_hash,body) VALUES (?,?,?,?,?,?,?)');
      for(const row of page.rows) {
        if(typeof row.__id!=='string'||!row.__id)throw fault('CENTRAL_ROW_ID','A source row has no native string __id.',502);
        const body=stable(row),parentId=relation ? row[relation.parentField] : null;
        if(relation&&typeof parentId!=='string')throw fault('CENTRAL_REPEAT_PARENT','A repeat row has no native parent identity.',502);
        if(db.prepare('SELECT 1 AS found FROM rows WHERE capture=? AND table_id=? AND row_id=?').get(captureId,tableId,row.__id))
          throw fault('CENTRAL_DUPLICATE_ROW','Central repeated an entity key across pages; retain and review this capture before retrying.',502);
        insert.run(captureId,tableId,row.__id,relation?.parentTableId??null,parentId,digest(body),body);
      }
      const record={ordinal:table.pageCount,requestedUrl:expectedUrl,rowCount:page.rows.length,
        source:{...page.source,...sourceReceipt},rowsSha256:rowsReceipt.sha256,
        nextLink:page.nextLink,count:page.count,headers:page.headers,status:page.status};
      db.prepare('INSERT INTO pages(capture,table_id,ordinal,request_url,source_hash,rows_hash,value) VALUES (?,?,?,?,?,?,?)')
        .run(captureId,tableId,table.pageCount,expectedUrl,sourceReceipt.sha256,rowsReceipt.sha256,JSON.stringify(record));
      table.rowCount+=page.rows.length;table.pageCount++;table.nextLink=page.nextLink;
      if(page.count!==null&&!table.observedCounts.includes(page.count))table.observedCounts.push(page.count);
      table.status=page.nextLink?'CAPTURING':'COMPLETE';table.updatedAt=now();
      return writeRecord('capture',captureId,capture,capture.revision);
    });
  }
  function rows(capture,tableId,{after='',limit=100,search=''}={}) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>10000)throw fault('CENTRAL_ROWS_LIMIT','Choose 1 to 10,000 rows per page.');
    const items=db.prepare('SELECT row_id,body FROM rows WHERE capture=? AND table_id=? AND row_id>? AND (? = \'\' OR instr(lower(body),lower(?))>0) ORDER BY row_id LIMIT ?')
      .all(capture,tableId,after,search,search,limit+1);
    const more=items.length>limit; if(more)items.pop();
    return {rows:items.map(item=>JSON.parse(item.body)),next:more?items.at(-1).row_id:null};
  }
  function row(capture,tableId,rowId) {
    const result=db.prepare('SELECT body FROM rows WHERE capture=? AND table_id=? AND row_id=?').get(capture,tableId,rowId);
    if(!result)throw fault('CENTRAL_ROW_NOT_FOUND','This source row does not exist.',404);return JSON.parse(result.body);
  }
  function* iterateRows(capture,tableId) {
    for(const row of db.prepare('SELECT body FROM rows WHERE capture=? AND table_id=? ORDER BY row_id').iterate(capture,tableId))yield JSON.parse(row.body);
  }
  function saveSubmission(capture,formKey,instanceId,value) {
    db.prepare('INSERT INTO submissions(capture,form_key,instance_id,value) VALUES (?,?,?,?) ON CONFLICT(capture,form_key,instance_id) DO UPDATE SET value=excluded.value')
      .run(capture,formKey,instanceId,JSON.stringify(value));changed();return value;
  }
  function submission(capture,formKey,instanceId) {
    const result=db.prepare('SELECT value FROM submissions WHERE capture=? AND form_key=? AND instance_id=?').get(capture,formKey,instanceId);
    return result?JSON.parse(result.value):null;
  }
  function resourceList(capture,{after=0,limit=100,kind=''}={}) {
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>10000)
      throw fault('CENTRAL_RESOURCE_PAGE','Choose a valid resource page.');
    const items=db.prepare('SELECT rowid AS cursor,key,kind,value FROM resources WHERE capture=? AND rowid>? AND (? = \'\' OR kind=?) ORDER BY rowid LIMIT ?')
      .all(capture,after,kind,kind,limit+1);const more=items.length>limit;if(more)items.pop();
    return {resources:items.map(({value,...item})=>({...item,...JSON.parse(value)})),next:more?items.at(-1).cursor:null};
  }
  function* resourceEntries(capture) {
    for(const item of db.prepare('SELECT key,kind,value FROM resources WHERE capture=? ORDER BY rowid').iterate(capture))
      yield {key:item.key,kind:item.kind,...JSON.parse(item.value)};
  }
  function* iterateSubmissions(capture) {
    for(const item of db.prepare('SELECT form_key,instance_id,value FROM submissions WHERE capture=? ORDER BY form_key,instance_id').iterate(capture))
      yield {formKey:item.form_key,...JSON.parse(item.value)};
  }
  function resourceTotals(capture) {
    return db.prepare('SELECT kind,COUNT(*) AS count,SUM(bytes) AS bytes FROM resources WHERE capture=? GROUP BY kind ORDER BY kind').all(capture);
  }
  function orphanCounts(capture) {
    return db.prepare('SELECT child.table_id AS tableId,COUNT(*) AS count FROM rows AS child LEFT JOIN rows AS parent ON parent.capture=child.capture AND parent.table_id=child.parent_table AND parent.row_id=child.parent_id WHERE child.capture=? AND child.parent_table IS NOT NULL AND parent.row_id IS NULL GROUP BY child.table_id').all(capture);
  }
  function* compareRows(left,right,tableId) {
    const sql='SELECT a.row_id AS id,\'removed\' AS change,a.body AS before,NULL AS after FROM rows a LEFT JOIN rows b ON b.capture=? AND b.table_id=a.table_id AND b.row_id=a.row_id WHERE a.capture=? AND a.table_id=? AND b.row_id IS NULL UNION ALL '+
      'SELECT b.row_id AS id,CASE WHEN a.row_id IS NULL THEN \'added\' ELSE \'changed\' END AS change,a.body AS before,b.body AS after FROM rows b LEFT JOIN rows a ON a.capture=? AND a.table_id=b.table_id AND a.row_id=b.row_id WHERE b.capture=? AND b.table_id=? AND (a.row_id IS NULL OR a.body_hash<>b.body_hash) ORDER BY id';
    for(const item of db.prepare(sql).iterate(right,left,tableId,left,right,tableId))
      yield {...item,before:item.before===null?null:JSON.parse(item.before),after:item.after===null?null:JSON.parse(item.after)};
  }
  async function snapshot(id=randomUUID()) {
    assertOpen();identifier(id,'archive operation ID');const directory=join(root,'transfers',id);
    await mkdir(directory,{recursive:true,mode:0o700});
    const path=join(directory,'central.sqlite');
    try{await stat(path);return {id,directory,path};}catch(error){if(error.code!=='ENOENT')throw error;}
    const temporary=path+'.'+randomUUID()+'.part';
    try{await sqliteBackup(db,temporary);await chmod(temporary,0o600);await link(temporary,path);}
    finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    return {id,directory,path};
  }
  return {directory:root,db,get,list,put,update,writeRecord,transaction,resource,saveResource,retainStream,raw,sourceFile,
    retain:bytes=>retain(join(root,'sources'),bytes),pageRecords,commitPage,rows,row,iterateRows,
    saveSubmission,submission,resourceList,resourceEntries,iterateSubmissions,resourceTotals,orphanCounts,compareRows,snapshot,
    identity:()=>Object.fromEntries(db.prepare('SELECT key,value FROM metadata').all().map(row=>[row.key,row.value])),
    async close(){if(!closed){closed=true;try{db.close();}finally{await lease.close();}}}};
}
