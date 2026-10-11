// MIT — Derived search index and analyst revisions; the original inbox stays authoritative.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, lstat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, directory, requireValue, digest, verifyFile } from './files.mjs';
import { readSource } from './source.mjs';

function processStart(pid) {
  try { const stat = readFileSync(`/proc/${pid}/stat`,'utf8'); return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]; }
  catch { return null; }
}
function ownerStopped(owner) {
  if (owner.host !== hostname() || !Number.isInteger(owner.pid)) return false;
  try { process.kill(owner.pid,0); } catch(e) { return e.code === 'ESRCH'; }
  const start = processStart(owner.pid);
  return Boolean(start && owner.start && start !== owner.start);
}
const clock = () => new Date().toISOString();
const json = value => JSON.stringify(value);
const parse = value => value == null ? null : JSON.parse(value);
const integer = (value, minimum, maximum, code) => {
  requireValue(Number.isSafeInteger(value) && value >= minimum && value <= maximum, code);
  return value;
};
function errorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code : 'FILE_READ_FAILED';
}
export async function openLibrary({state, kind, source, roots,
  maxFileBytes, indexBytes} = {}) {
  state = absolute(state);
  await mkdir(state, {recursive:true, mode:0o700});
  await directory(state, true);
  const dbPath = join(state, 'library.sqlite');
  try {
    const st = await lstat(dbPath);
    requireValue(st.isFile() && !st.isSymbolicLink() && (process.platform === 'win32' || (st.mode & 0o077) === 0),
      'PRIVATE_INDEX_FILE_REQUIRED');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const db = new DatabaseSync(dbPath);
  await chmod(dbPath, 0o600);
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(generation TEXT,id TEXT,metadata TEXT NOT NULL,
        PRIMARY KEY(generation,id));
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(generation UNINDEXED,id UNINDEXED,label,body);
      CREATE TABLE IF NOT EXISTS annotations(id TEXT,revision INTEGER,content TEXT NOT NULL,
        PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS receipts(operation TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL);`);
    const getSetting = key => parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value);
    const putSetting = (key,value) => db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json(value));
    // Serialize the initial source binding across independently opened workspaces.
    db.exec('BEGIN IMMEDIATE');
    let config = getSetting('config');
    if (!config) {
      requireValue(['inbox','snapshot'].includes(kind), 'SOURCE_KIND_REQUIRED');
      requireValue(Array.isArray(roots) && roots.length > 0 && roots.length <= 32, 'FILES_ROOT_REQUIRED');
      config = {schema:'stellar-forge.sf88.resource-library.v1',kind,source:absolute(source),
        roots:[...new Set(await Promise.all(roots.map(p => directory(p))))].sort(),
        maxFileBytes:integer(maxFileBytes ?? 1024*1024*1024,1,Number.MAX_SAFE_INTEGER,'FILE_LIMIT_INVALID'),
        indexBytes:integer(indexBytes ?? 1024*1024,1,16*1024*1024,'INDEX_LIMIT_INVALID')};
      putSetting('config',config);
    } else {
      requireValue(config.schema === 'stellar-forge.sf88.resource-library.v1', 'LIBRARY_SCHEMA_INVALID');
      requireValue(kind === undefined || kind === config.kind, 'LIBRARY_SOURCE_CONFLICT',409);
      requireValue(source === undefined || absolute(source) === config.source, 'LIBRARY_SOURCE_CONFLICT',409);
      if (roots !== undefined) requireValue(json([...new Set(roots.map(absolute))].sort()) === json(config.roots),
        'LIBRARY_ROOTS_CONFLICT',409);
      requireValue(maxFileBytes === undefined || maxFileBytes === config.maxFileBytes,'LIBRARY_LIMIT_CONFLICT',409);
      requireValue(indexBytes === undefined || indexBytes === config.indexBytes,'LIBRARY_LIMIT_CONFLICT',409);
      for (const root of config.roots) await directory(root);
    }
    db.exec('COMMIT');
    const current = () => getSetting('scan');
    // The original process identity distinguishes an active reader from an
    // interrupted scan, including Linux PID reuse. Recovery reclaims only the
    // confirmed-dead writer's derived generation; original stores are untouched.
    db.exec('CREATE TABLE IF NOT EXISTS scan_lease(singleton INTEGER PRIMARY KEY CHECK(singleton=1),operation TEXT NOT NULL)');
    let active = null, closed = false;
    function transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const value = fn(); db.exec('COMMIT'); return value; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    function annotation(id) {
      return parse(db.prepare('SELECT content FROM annotations WHERE id=? ORDER BY revision DESC LIMIT 1').get(id)?.content)
        ?? {id,revision:0,note:'',tags:[],starred:false,updatedAt:null};
    }
    function resource(id) {
      requireValue(/^[a-f0-9]{64}$/.test(id ?? ''), 'RESOURCE_ID_INVALID');
      const row = db.prepare('SELECT metadata FROM records WHERE generation=? AND id=?').get(current()?.generation ?? '',id);
      requireValue(row, 'RESOURCE_NOT_IN_CURRENT_SOURCE',404);
      return {...parse(row.metadata),annotation:annotation(id)};
    }
    function status() {
      return {config,scan:current(),activity:active ? {...active.progress} : null,
        selection:getSetting('selection'),scanLease:parse(db.prepare('SELECT operation FROM scan_lease WHERE singleton=1').get()?.operation)};
    }
    async function scan({signal,onProgress = () => {}} = {}) {
      requireValue(!closed && !active, 'SCAN_ALREADY_RUNNING',409);
      const generation = randomUUID(), controller = new AbortController();
      const aborted = () => controller.abort(signal.reason);
      signal?.addEventListener('abort',aborted,{once:true});
      if (signal?.aborted) aborted();
      const progress = {id:generation,state:'READING_SOURCE',completed:0,total:null,startedAt:clock()};
      let settle;
      const finished = new Promise(resolve => {settle = resolve;});
      active = {controller,progress,finished};
      let acquired = false;
      const lease = json({id:generation,pid:process.pid,host:hostname(),start:processStart(process.pid)});
      try {
        transaction(() => {
          const previous = db.prepare('SELECT operation FROM scan_lease WHERE singleton=1').get();
          if (previous) {
            const owner = parse(previous.operation);
            requireValue(ownerStopped(owner),'ANOTHER_SCAN_OWNS_INDEX',409);
            db.prepare('DELETE FROM scan_lease WHERE singleton=1 AND operation=?').run(previous.operation);
            db.prepare('DELETE FROM records WHERE generation<>?').run(current()?.generation ?? '');
            db.prepare('DELETE FROM search WHERE generation<>?').run(current()?.generation ?? '');
          }
          db.prepare('INSERT INTO scan_lease VALUES(1,?)').run(lease);
        });
        acquired = true;
        controller.signal.throwIfAborted();
        const sourceRead = await readSource(config);
        progress.total = sourceRead.resources.length; progress.state = 'VERIFYING_FILES';
        const counts = {};
        for (const original of sourceRead.resources) {
          controller.signal.throwIfAborted();
          let record = {...original}, body = '';
          if (record.deliveryStatus === 'SAVED') {
            try {
              const check = await verifyFile(record,{...config,signal:controller.signal});
              const {text,...verification} = check;
              record = {...record,status:'VERIFIED',verification}; body = text ?? '';
            } catch (e) {
              controller.signal.throwIfAborted();
              record.status = 'UNAVAILABLE'; record.error = errorCode(e);
            }
          }
          counts[record.status] = (counts[record.status] ?? 0) + 1;
          transaction(() => {
            db.prepare('INSERT INTO records VALUES(?,?,?)').run(generation,record.id,json(record));
            db.prepare('INSERT INTO search VALUES(?,?,?,?)').run(generation,record.id,
              [record.intentId,record.name,record.url,record.contentType].join(' '),body);
          });
          progress.completed++; onProgress({...progress});
        }
        controller.signal.throwIfAborted();
        const result = {...sourceRead.details,generation,startedAt:progress.startedAt,completedAt:clock(),counts};
        transaction(() => {
          putSetting('scan',result);
          db.prepare('DELETE FROM records WHERE generation<>?').run(generation);
          db.prepare('DELETE FROM search WHERE generation<>?').run(generation);
        });
        progress.state = 'COMPLETE';
        return result;
      } catch (e) {
        if (acquired) transaction(() => {
          db.prepare('DELETE FROM records WHERE generation=?').run(generation);
          db.prepare('DELETE FROM search WHERE generation=?').run(generation);
        });
        throw e;
      } finally {
        if (acquired) db.prepare('DELETE FROM scan_lease WHERE singleton=1 AND operation=?').run(lease);
        signal?.removeEventListener('abort',aborted);
        active = null; settle();
      }
    }
    function search({q='',offset=0,limit=50,status:filter='',starred=false} = {}) {
      requireValue(typeof q === 'string' && q.length <= 1000, 'SEARCH_TOO_LONG');
      integer(offset,0,100000,'OFFSET_INVALID'); integer(limit,1,200,'LIMIT_INVALID');
      requireValue(['','VERIFIED','UNAVAILABLE','INCOMPLETE'].includes(filter), 'STATUS_FILTER_INVALID');
      const terms = q.match(/[\p{L}\p{N}_-]+/gu) ?? [];
      requireValue(terms.length <= 32, 'SEARCH_TERMS_EXCEEDED');
      const match = terms.map(t => '"' + t.replaceAll('"','""') + '"').join(' AND ');
      const binds = [current()?.generation ?? ''];
      let where = 'r.generation=?';
      if (match) { where += ' AND search MATCH ?'; binds.push(match); }
      if (filter) { where += " AND json_extract(r.metadata,'$.status')=?"; binds.push(filter); }
      if (starred) where += " AND EXISTS(SELECT 1 FROM annotations a WHERE a.id=r.id AND a.revision=(SELECT MAX(b.revision) FROM annotations b WHERE b.id=a.id) AND json_extract(a.content,'$.starred')=1)";
      const from = ' FROM records r JOIN search ON search.generation=r.generation AND search.id=r.id WHERE ' + where;
      const total = db.prepare('SELECT COUNT(*) AS total' + from).get(...binds).total;
      const snippets = match ? ",snippet(search,3,'[',']',' … ',24) AS snippet" : ",'' AS snippet";
      const rows = db.prepare('SELECT r.metadata' + snippets + from + ' ORDER BY r.id LIMIT ? OFFSET ?')
        .all(...binds,limit,offset);
      return {total,offset,limit,scan:current(),items:rows.map(row => {
        const record = parse(row.metadata);
        return {...record,snippet:row.snippet,annotation:annotation(record.id)};
      })};
    }
    async function preview(id,{signal} = {}) {
      const record = resource(id);
      const check = await verifyFile(record,{...config,signal});
      return {resource:record,...check};
    }
    async function download(id,{signal} = {}) {
      const record = resource(id);
      const check = await verifyFile(record,{...config,tempRoot:state,spool:true,signal});
      return {resource:record,...check};
    }
    function saveAnnotation(id,{expectedRevision,operationId,note='',tags=[],starred=false} = {}) {
      requireValue(typeof operationId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(operationId), 'OPERATION_ID_REQUIRED');
      integer(expectedRevision,0,Number.MAX_SAFE_INTEGER-1,'REVISION_REQUIRED');
      requireValue(typeof note === 'string' && Buffer.byteLength(note) <= 32768 &&
        Array.isArray(tags) && tags.length <= 20 && tags.every(t => typeof t === 'string' && t.length>0 && t.length<=64) &&
        typeof starred === 'boolean', 'ANNOTATION_INVALID');
      const input = {id,expectedRevision,note,tags:[...new Set(tags)].sort(),starred};
      const hash = digest(json(input));
      return transaction(() => {
        const existing = db.prepare('SELECT digest,result FROM receipts WHERE operation=?').get(operationId);
        if (existing) {
          requireValue(existing.digest === hash,'OPERATION_ID_CONFLICT',409); return parse(existing.result);
        }
        const record = resource(id), before = annotation(id);
        requireValue(before.revision === expectedRevision,'ANNOTATION_REVISION_CONFLICT',409);
        const result = {id,revision:before.revision+1,note,tags:input.tags,starred,updatedAt:clock(),
          source:{intentId:record.intentId,sha256:record.sha256,configSha256:record.configSha256,
            path:record.path,source:record.source}};
        db.prepare('INSERT INTO annotations VALUES(?,?,?)').run(id,result.revision,json(result));
        db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(operationId,hash,json(result));
        return result;
      });
    }
    function revisions(id) {
      requireValue(/^[a-f0-9]{64}$/.test(id ?? ''),'RESOURCE_ID_INVALID');
      return db.prepare('SELECT content FROM annotations WHERE id=? ORDER BY revision DESC').all(id).map(r => parse(r.content));
    }
    function exportReview() {
      db.exec('BEGIN');
      try {
      const result = {schema:'stellar-forge.sf88.resource-review.v1',exportedAt:clock(),config,scan:current(),
        resources:db.prepare('SELECT metadata FROM records WHERE generation=? ORDER BY id').all(current()?.generation ?? '').map(r => parse(r.metadata)),
        annotations:db.prepare('SELECT content FROM annotations ORDER BY id,revision').all().map(r => parse(r.content)),
        selection:getSetting('selection')};
      db.exec('COMMIT');
      return result;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    return Object.freeze({state,config,status,scan,search,resource,preview,download,saveAnnotation,revisions,exportReview,
      select(id) { if (id !== null) resource(id); putSetting('selection',id); return {id}; },
      cancelScan() { active?.controller.abort(new Error('SCAN_CANCELLED')); return status(); },
      async close() {
        if (closed) return;
        closed = true;
        const pending = active?.finished;
        active?.controller.abort(new Error('LIBRARY_CLOSED'));
        if (pending) await pending;
        db.close();
      }});
  } catch (e) { db.close(); throw e; }
}
