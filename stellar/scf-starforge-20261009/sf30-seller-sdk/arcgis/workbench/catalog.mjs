// MIT. Immutable ArcGIS source editions under the original publisher workspace lease.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { privateDirectory, readPrivate, digest, fault, stamp, object } from '../../postgres/publisher/files.mjs';

const catalogs = new WeakMap();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
export const requestId = value => {
  if (typeof value !== 'string' || !UUID.test(value)) throw fault('ARCGIS_REQUEST_ID_REQUIRED');
  return value;
};
export function checkedText(value, label, maximum = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
    throw fault('ARCGIS_TEXT_REQUIRED', 'Enter ' + label + '.');
  return value.trim();
}
export function getArcgisCatalog(publisher) {
  const value = catalogs.get(publisher);
  if (!value) throw fault('ARCGIS_PUBLISHER_REQUIRED');
  return value;
}
export async function openArcgisCatalog(core, inspectSource) {
  const root = join(core.directory, 'arcgis');
  await privateDirectory(root, true);
  for (const name of ['editions', 'captures', 'uploads', 'deployments']) await privateDirectory(join(root, name), true);
  const db = new DatabaseSync(join(core.directory, 'publisher.sqlite'));
  let workbenchId;
  try {
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS arcgis_identity(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS arcgis_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,current TEXT);
    INSERT OR IGNORE INTO arcgis_meta VALUES(1,0,NULL);
    CREATE TABLE IF NOT EXISTS arcgis_editions(id TEXT PRIMARY KEY,created TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS arcgis_requests(id TEXT PRIMARY KEY,kind TEXT NOT NULL,fingerprint TEXT NOT NULL,
      created TEXT NOT NULL,updated TEXT NOT NULL,state TEXT NOT NULL,input TEXT NOT NULL,result TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS arcgis_selection_events(request TEXT PRIMARY KEY,revision INTEGER NOT NULL,edition TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS arcgis_captures(id TEXT PRIMARY KEY,created TEXT NOT NULL,updated TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS arcgis_uploads(id TEXT PRIMARY KEY,created TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS arcgis_deployments(id TEXT PRIMARY KEY,created TEXT NOT NULL,updated TEXT NOT NULL,data TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO arcgis_identity VALUES(1,?)').run(randomUUID());
  workbenchId = db.prepare('SELECT value FROM arcgis_identity WHERE id=1').get().value;
  if (!UUID.test(workbenchId)) throw fault('ARCGIS_WORKSPACE_ID_INVALID');
  db.prepare("UPDATE arcgis_requests SET state='INTERRUPTED',updated=?,error=? WHERE state='RUNNING'")
    .run(stamp(), JSON.stringify({ code: 'ARCGIS_OPERATION_INTERRUPTED', message: 'Continue the same retained request.' }));
  } catch (issue) { db.close(); throw issue; }
  let active = null, closing = null, closed = false;
  const pending = new Set(), controls = new Map();
  const unpack = row => row ? JSON.parse(row.data) : null;
  const meta = () => db.prepare('SELECT revision,current FROM arcgis_meta WHERE id=1').get();
  const edition = id => {
    requestId(id);
    const value = unpack(db.prepare('SELECT data FROM arcgis_editions WHERE id=?').get(id));
    if (!value) throw fault('ARCGIS_EDITION_NOT_FOUND', 'Choose a retained source edition.', 404);
    return value;
  };
  const tx = action => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (issue) { db.exec('ROLLBACK'); throw issue; }
  };
  function assertOpen() { if (closed || closing) throw fault('ARCGIS_WORKSPACE_CLOSED'); }
  function available() {
    assertOpen();
    if (active || core.status().active) throw fault('PUBLISHER_BUSY', 'The current workspace operation is still running.', 409);
  }
  async function sourcePath(fallback = core.settings.sourceFile) {
    assertOpen();
    const current = meta().current;
    if (!current) return fallback;
    const selected = edition(current), path = join(root, 'editions', current, 'source.json');
    if (!HASH.test(selected.sourceHash ?? '') || digest(await readPrivate(path)) !== selected.sourceHash)
      throw fault('ARCGIS_EDITION_SOURCE_CHANGED');
    return path;
  }
  async function describe() {
    const current = meta().current, path = await sourcePath();
    if (!current && path === join(root, 'initial-source.json')) {
      try { await lstat(path); } catch (issue) {
        if (issue.code === 'ENOENT') return { hash: null, queries: {}, needsSource: true, sourceEdition: null };
        throw issue;
      }
    }
    const value = await inspectSource(path);
    return { ...value, sourceEdition: current ? edition(current) : null };
  }
  function request(id) {
    requestId(id);
    const row = db.prepare('SELECT * FROM arcgis_requests WHERE id=?').get(id);
    if (!row) throw fault('ARCGIS_REQUEST_NOT_FOUND', 'The request has not been retained.', 404);
    return { id: row.id, kind: row.kind, state: row.state, createdAt: row.created, updatedAt: row.updated,
      result: row.result ? JSON.parse(row.result) : null, error: row.error ? JSON.parse(row.error) : null };
  }
  function start(kind, input, action, extra = {}) {
    const id = requestId(input?.requestId), fingerprint = digest(JSON.stringify({ kind, input }));
    if (!object(input) || Buffer.byteLength(JSON.stringify(input)) > 262144) throw fault('ARCGIS_REQUEST_TOO_LARGE');
    const prior = db.prepare('SELECT * FROM arcgis_requests WHERE id=?').get(id);
    if (prior && (prior.kind !== kind || prior.fingerprint !== fingerprint))
      throw fault('ARCGIS_REQUEST_REUSED', 'This request ID belongs to different input. Review a new request.', 409);
    if (prior && ['RUNNING', 'SUCCEEDED'].includes(prior.state)) return { request: request(id), started: false };
    available();
    const now = stamp();
    if (prior) db.prepare("UPDATE arcgis_requests SET state='RUNNING',updated=?,error=NULL WHERE id=?").run(now, id);
    else db.prepare('INSERT INTO arcgis_requests VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, kind, fingerprint, now, now, 'RUNNING', JSON.stringify(input), null, null);
    const operation = { id, kind, ...extra, controller: new AbortController(), promise: null };
    active = operation;
    operation.promise = Promise.resolve().then(() => action(operation.controller.signal)).then(result => {
      db.prepare("UPDATE arcgis_requests SET state='SUCCEEDED',updated=?,result=?,error=NULL WHERE id=?")
        .run(stamp(), JSON.stringify(result ?? null), id);
      return request(id);
    }, issue => {
      const code = typeof issue?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(issue.code) ? issue.code : 'ARCGIS_OPERATION_FAILED';
      const message = issue?.code ? String(issue.message).slice(0,2000) : 'The operation did not finish. Review the retained request and retry it.';
      db.prepare("UPDATE arcgis_requests SET state=?,updated=?,error=? WHERE id=?")
        .run(operation.controller.signal.aborted ? 'PAUSED' : 'FAILED', stamp(), JSON.stringify({ code, message }), id);
      return request(id);
    }).finally(() => { if (active === operation) active = null; });
    operation.promise.catch(() => {});
    return { request: request(id), started: true };
  }
  async function control(kind,input,action) {
    const id=requestId(input?.requestId),fingerprint=digest(JSON.stringify({kind,input}));
    if(!object(input)||Buffer.byteLength(JSON.stringify(input))>262144)throw fault('ARCGIS_REQUEST_TOO_LARGE');
    const prior=db.prepare('SELECT * FROM arcgis_requests WHERE id=?').get(id);
    if(prior&&(prior.kind!==kind||prior.fingerprint!==fingerprint))throw fault('ARCGIS_REQUEST_REUSED',undefined,409);
    if(prior?.state==='SUCCEEDED')return request(id);
    if(controls.has(id)){await controls.get(id);return request(id);}
    assertOpen();
    const now=stamp();
    if(prior)db.prepare("UPDATE arcgis_requests SET state='RUNNING',updated=?,error=NULL WHERE id=?").run(now,id);
    else db.prepare('INSERT INTO arcgis_requests VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,kind,fingerprint,now,now,'RUNNING',JSON.stringify(input),null,null);
    const promise=Promise.resolve().then(action).then(result=>{
      db.prepare("UPDATE arcgis_requests SET state='SUCCEEDED',updated=?,result=?,error=NULL WHERE id=?")
        .run(stamp(),JSON.stringify(result??null),id);
    },issue=>{
      const code=/^[A-Z0-9_]{1,80}$/.test(issue?.code??'')?issue.code:'ARCGIS_OPERATION_FAILED';
      const message=issue?.code?String(issue.message).slice(0,2000):'Review this retained control request.';
      db.prepare("UPDATE arcgis_requests SET state='FAILED',updated=?,error=? WHERE id=?")
        .run(stamp(),JSON.stringify({code,message}),id);
    }).finally(()=>controls.delete(id));
    controls.set(id,promise);await promise;return request(id);
  }
  function track(value) {
    const promise = value && typeof value.then === 'function' ? value : value?.completion;
    if (promise) { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); }
    return value;
  }
  function wrap() {
    const methods = {};
    for (const name of ['savePlan','startExtraction','review','publish','recover','prepareBuyer'])
      methods[name] = (...args) => { assertOpen(); if (active) throw fault('PUBLISHER_BUSY', 'The source operation is still running.', 409); return track(core[name](...args)); };
    const result = Object.freeze({ ...core, ...methods,
      status: options => { const value = core.status(options); return { ...value, active: value.active ?? (active ? { id:active.id,kind:active.kind,progress:{} } : null) }; },
      close: () => {
      if (closing) return closing;
      active?.controller.abort();
      closing = (async () => {
        try {
          await active?.promise; await Promise.allSettled([...pending,...controls.values()]);
          closed = true; db.close();
        } finally { await core.close(); }
      })();
      return closing;
    }});
    catalogs.set(result, catalog); return result;
  }
  function select(input) {
    if (!object(input) || Object.keys(input).some(key => !['requestId','editionId','expectedRevision'].includes(key)))
      throw fault('ARCGIS_INPUT_INVALID');
    return start('select-source', input, async () => {
      const chosen = edition(input.editionId);
      const path = join(root,'editions',chosen.id,'source.json');
      if (digest(await readPrivate(path)) !== chosen.sourceHash) throw fault('ARCGIS_EDITION_SOURCE_CHANGED');
      await inspectSource(path);
      return tx(() => {
        const applied = db.prepare('SELECT revision,edition FROM arcgis_selection_events WHERE request=?').get(input.requestId);
        if (applied) return { revision: applied.revision, editionId: applied.edition };
        const state = meta();
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision !== state.revision)
          throw fault('ARCGIS_SOURCE_SELECTION_CHANGED', 'Refresh and review the selected source before changing it.', 409);
        const revision = state.revision + 1;
        db.prepare('UPDATE arcgis_meta SET revision=?,current=? WHERE id=1').run(revision,chosen.id);
        db.prepare('INSERT INTO arcgis_selection_events VALUES(?,?,?)').run(input.requestId,revision,chosen.id);
        return { revision, editionId: chosen.id, sourceHash: chosen.sourceHash };
      });
    });
  }
  const catalog = { root, db, core, workbenchId, meta, edition, tx, unpack, available, assertOpen, describe, sourcePath, request, start, control, select,
    active: () => active ? { id: active.id,kind:active.kind,...(active.captureId ? { captureId:active.captureId } : {}) } : null,
    async pause(captureId) {
      assertOpen();
      const operation = active;
      if (!operation || operation.kind !== 'continue-capture' || operation.captureId !== captureId)
        return { paused: false, captureId };
      operation.controller.abort(); await operation.promise; return { paused:true,captureId,request:request(operation.id) };
    },
    wait: async id => { if (active?.id === id) await active.promise; return request(id); },
    drain: async () => { active?.controller.abort(); await active?.promise; await Promise.allSettled([...controls.values()]); },
    wrap };
  return catalog;
}
