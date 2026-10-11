// MIT. Durable merchant backend operations; never verifies, signs or settles payments.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, openSync, closeSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { hostname } from 'node:os';

const SCHEMA = 'stellar-forge.upstream-operation.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX = /^[a-f0-9]{64}$/;
const STATES = ['IN_FLIGHT','COMPLETE','UNCERTAIN','RETRY_READY'];
const PUBLIC_COLUMNS = `operation_key,request_hash,state,attempt,generation,created_at,updated_at,
  status,COALESCE(length(body),0) AS body_bytes,body_hash,error,reference`;
const active = new Map();
const runId = randomUUID();
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const hash = v => createHash('sha256').update(v).digest('hex');
const fail = (code, status = 409) => Object.assign(new Error(code), { code, status });
const reply = (status, error) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: { error } });
const clone = response => ({ status: response.status, headers: { ...response.headers },
  body: Buffer.isBuffer(response.body) ? Buffer.from(response.body) : structuredClone(response.body) });

/** Canonicalize parsed JSON once; enabled POSTs send these exact bytes upstream. */
export function canonicalOperationJSON(value) {
  let nodes = 0;
  function visit(v, depth) {
    if (++nodes > 100000 || depth > 64) throw fail('OPERATION_JSON_TOO_COMPLEX', 400);
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(x => visit(x, depth + 1)).join(',') + ']';
    if (!plain(v)) throw fail('OPERATION_JSON_INVALID', 400);
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + visit(v[k], depth + 1)).join(',') + '}';
  }
  return visit(value, 0);
}

export function operationRequestHash({ scope, method, sourceUrl, targetUrl, headers, body }) {
  if (typeof scope !== 'string' || !ID.test(scope) || method !== 'POST' ||
      typeof sourceUrl !== 'string' || typeof targetUrl !== 'string' || !plain(headers) || !Buffer.isBuffer(body)) {
    throw fail('OPERATION_REQUEST_INVALID', 400);
  }
  return hash(canonicalOperationJSON({ schema: SCHEMA, scope, method, sourceUrl, targetUrl,
    headers, bodyBytes: body.length, bodySha256: hash(body) }));
}

function processStamp(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const start = text.slice(text.lastIndexOf(')') + 2).split(' ')[19];
    const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return { host: hash(hostname()), start: boot + ':' + start };
  } catch { return null; }
}
const ownStamp = processStamp(process.pid);

function checkPrivatePath(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory) {
    throw fail('OPERATION_STATE_PATH_INVALID', 503);
  }
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || realpathSync(directory) !== directory) {
    throw fail('OPERATION_STATE_DIRECTORY_NOT_PRIVATE', 503);
  }
}

function serializeResponse(response, maxBytes) {
  if (!plain(response) || !Number.isInteger(response.status) || response.status < 200 || response.status > 599 ||
      response.status === 402 || !plain(response.headers ?? {})) throw fail('OPERATION_RESPONSE_INVALID', 503);
  const headers = Object.create(null);
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    const key = name.toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key) || typeof value !== 'string' ||
        value.length > 8192 || /[\r\n\0]/.test(value) || Object.hasOwn(headers, key) ||
        /^(?:payment-|x-payment|x402-|extension-responses$|settlement-overrides$|set-cookie$|cookie$|authorization$|proxy-|connection$|transfer-encoding$|content-length$|host$)/.test(key)) {
      throw fail('OPERATION_RESPONSE_HEADERS_INVALID', 503);
    }
    headers[key] = value;
  }
  if (Object.keys(headers).length > 32) throw fail('OPERATION_RESPONSE_HEADERS_INVALID', 503);
  const bytes = Buffer.isBuffer(response.body) || response.body instanceof Uint8Array ? Buffer.from(response.body) :
    Buffer.from(typeof response.body === 'string' ? response.body : canonicalOperationJSON(response.body ?? null));
  if (bytes.length > maxBytes || [204, 205, 304].includes(response.status) && bytes.length) throw fail('OPERATION_RESPONSE_TOO_LARGE', 503);
  return { status: response.status, headers: canonicalOperationJSON(headers), bytes, sha: hash(bytes) };
}

/** Config is trusted merchant data. Tickets authenticate an operation capability,
 * not the network caller, a Stellar payer, a payment, or a settled transaction. */
export function createDurableUpstreamOperations({ scope, stateDir, key, maxResponseBytes = 1048576,
  maxEntries = 10000, maxStoredBytes = 268435456, maxTicketSeconds = 86400, waitMs = 15000 } = {}) {
  if (!ID.test(scope ?? '') || !Buffer.isBuffer(key) || key.length !== 32 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 16777216 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000000 ||
      !Number.isSafeInteger(maxStoredBytes) || maxStoredBytes < maxResponseBytes || maxStoredBytes > 17179869184 ||
      !Number.isSafeInteger(maxTicketSeconds) || maxTicketSeconds < 1 || maxTicketSeconds > 604800 ||
      !Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 120000) throw new TypeError('Invalid durable upstream operation options');
  if (typeof stateDir !== 'string' || !isAbsolute(stateDir) || resolve(stateDir) !== stateDir) throw new TypeError('Idempotency stateDir must be absolute and canonical');
  const secret = Buffer.from(key), databasePath = join(stateDir, 'operations.sqlite');
  let databasePromise;
  const counts = { executed: 0, replayed: 0, coalesced: 0, uncertain: 0, conflicts: 0 };
  const mac = encoded => createHmac('sha256', secret).update(SCHEMA + '\n' + encoded).digest();
  function identity(payload) { return hash(canonicalOperationJSON({ scope, id: payload.id, subject: payload.subject })); }
  function verify(ticket, requestHash) {
    if (typeof ticket !== 'string' || ticket.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket) || !HEX.test(requestHash ?? '')) throw fail('OPERATION_TICKET_REQUIRED', 401);
    const [encoded, signature] = ticket.split('.');
    const signatureBytes = Buffer.from(signature, 'base64url');
    if (signatureBytes.length !== 32 || !timingSafeEqual(mac(encoded), signatureBytes)) throw fail('OPERATION_TICKET_INVALID', 401);
    let payload;
    try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw fail('OPERATION_TICKET_INVALID', 401); }
    if (!plain(payload) || Object.keys(payload).sort().join(',') !== 'expiresAt,id,requestHash,schema,scope,subject' ||
        payload.schema !== SCHEMA || payload.scope !== scope || !ID.test(payload.id ?? '') || !ID.test(payload.subject ?? '') ||
        payload.requestHash !== requestHash || !Number.isSafeInteger(payload.expiresAt)) throw fail('OPERATION_REQUEST_MISMATCH', 409);
    if (payload.expiresAt <= Date.now()) throw fail('OPERATION_TICKET_EXPIRED', 401);
    return { ...payload, operationKey: identity(payload) };
  }
  function issue({ requestHash, id, subject, expiresAt }) {
    if (!HEX.test(requestHash ?? '') || !ID.test(id ?? '') || !ID.test(subject ?? '') ||
        !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + maxTicketSeconds * 1000) throw new TypeError('Explicit operation id, subject, request hash and permitted future expiry required');
    const payload = { schema: SCHEMA, scope, id, subject, requestHash, expiresAt };
    const encoded = Buffer.from(canonicalOperationJSON(payload)).toString('base64url');
    return { ticket: encoded + '.' + mac(encoded).toString('base64url'), operationKey: identity(payload), requestHash, expiresAt };
  }
  async function database() {
    if (!databasePromise) databasePromise = (async () => {
      checkPrivatePath(stateDir);
      try { closeSync(openSync(databasePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const info = lstatSync(databasePath);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || realpathSync(databasePath) !== databasePath) throw fail('OPERATION_DATABASE_NOT_PRIVATE', 503);
      let DatabaseSync;
      try { ({ DatabaseSync } = await import('node:sqlite')); } catch { throw fail('OPERATION_SQLITE_REQUIRES_NODE_22_13', 503); }
      const db = new DatabaseSync(databasePath);
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
      db.exec(`CREATE TABLE IF NOT EXISTS merchant_operations (
        operation_key TEXT PRIMARY KEY, scope TEXT NOT NULL, request_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('IN_FLIGHT','COMPLETE','UNCERTAIN','RETRY_READY')),
        attempt INTEGER NOT NULL, generation INTEGER NOT NULL, claim_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL, owner_host TEXT, owner_start TEXT, owner_run TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status INTEGER, headers TEXT,
        body BLOB, body_hash TEXT, error TEXT, reference TEXT);
        CREATE TABLE IF NOT EXISTS merchant_operation_audit (
          seq INTEGER PRIMARY KEY, operation_key TEXT NOT NULL, generation INTEGER NOT NULL,
          state TEXT NOT NULL, at INTEGER NOT NULL, reference TEXT);
        CREATE INDEX IF NOT EXISTS merchant_operation_scope ON merchant_operations(scope);
        CREATE INDEX IF NOT EXISTS merchant_operation_recent ON merchant_operations(scope,updated_at DESC,operation_key DESC);
        CREATE INDEX IF NOT EXISTS merchant_operation_state_recent ON merchant_operations(scope,state,updated_at DESC,operation_key DESC);
        CREATE INDEX IF NOT EXISTS merchant_operation_audit_key ON merchant_operation_audit(operation_key,seq);`);
      return db;
    })().catch(error => { databasePromise = undefined; throw error; });
    return databasePromise;
  }
  function transaction(db, fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }
  const rowFor = (db, operationKey) => db.prepare('SELECT * FROM merchant_operations WHERE operation_key=?').get(operationKey);
  function audit(db, row, reference = null) {
    db.prepare('INSERT INTO merchant_operation_audit(operation_key,generation,state,at,reference) VALUES(?,?,?,?,?)')
      .run(row.operation_key, row.generation, row.state, Date.now(), reference);
  }
  function ensureMatch(row, requestHash) {
    if (row && (row.scope !== scope || row.request_hash !== requestHash)) { counts.conflicts++; throw fail('OPERATION_REQUEST_CONFLICT'); }
  }
  function decoded(row) {
    const bytes = Buffer.from(row.body ?? []);
    if (bytes.length > maxResponseBytes || hash(bytes) !== row.body_hash) throw fail('OPERATION_STORED_RESPONSE_INVALID', 503);
    const response = { status: row.status, headers: JSON.parse(row.headers), body: bytes };
    serializeResponse(response, maxResponseBytes);
    return response;
  }
  function publicRow(row) {
    return row ? { operationKey: row.operation_key, backendKey: 'sf30_' + row.operation_key,
      requestHash: row.request_hash, state: row.state,
      attempt: row.attempt, generation: row.generation, createdAt: row.created_at, updatedAt: row.updated_at,
      status: row.status, bodyBytes: row.body_bytes ?? row.body?.length ?? 0, bodySha256: row.body_hash, error: row.error,
      reference: row.reference } : null;
  }
  async function inspect(operationKey) {
    if (!HEX.test(operationKey ?? '')) throw new TypeError('Exact operationKey required');
    const row = rowFor(await database(), operationKey);
    if (row && row.scope !== scope) throw fail('OPERATION_SCOPE_MISMATCH');
    return publicRow(row);
  }
  // Trusted merchant-side retrieval of the same immutable completed payload.
  // Reading never claims, issues, dispatches or retries an operation.
  async function response(operationKey) {
    if (!HEX.test(operationKey ?? '')) throw new TypeError('Exact operationKey required');
    const row = rowFor(await database(), operationKey);
    if (!row) return null;
    if (row.scope !== scope) throw fail('OPERATION_SCOPE_MISMATCH');
    if (row.state !== 'COMPLETE') throw fail('OPERATION_RESPONSE_NOT_COMPLETE');
    return decoded(row);
  }
  // Read the original ledger's metadata, never its response payloads or tickets.
  // Keyset pagination stays bounded even when the ledger has many completed rows.
  async function list({ state, cursor, limit = 25 } = {}) {
    if (state !== undefined && !STATES.includes(state) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new TypeError('Valid operation state and limit 1–100 required');
    let position;
    if (cursor !== undefined) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
        position = JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
        if (!plain(position) || Object.keys(position).sort().join(',') !== 'key,time' ||
            !HEX.test(position.key ?? '') || !Number.isSafeInteger(position.time) || position.time < 0) throw new Error();
      } catch { throw new TypeError('Invalid operation cursor'); }
    }
    const db = await database(), conditions = ['scope=?'], parameters = [scope];
    if (state !== undefined) { conditions.push('state=?'); parameters.push(state); }
    if (position) {
      conditions.push('(updated_at<? OR (updated_at=? AND operation_key<?))');
      parameters.push(position.time,position.time,position.key);
    }
    const rows = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM merchant_operations WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC,operation_key DESC LIMIT ?`).all(...parameters,limit + 1);
    const more = rows.length > limit, page = rows.slice(0,limit), last = page.at(-1);
    const totals = Object.fromEntries(STATES.map(state => [state,0]));
    for (const row of db.prepare('SELECT state,COUNT(*) AS total FROM merchant_operations WHERE scope=? GROUP BY state').all(scope)) totals[row.state] = row.total;
    return { capturedAt: Date.now(), totals, records: page.map(publicRow),
      nextCursor: more ? Buffer.from(JSON.stringify({time:last.updated_at,key:last.operation_key})).toString('base64url') : null };
  }
  async function auditHistory(operationKey, { after = 0, limit = 100 } = {}) {
    if (!HEX.test(operationKey ?? '') || !Number.isSafeInteger(after) || after < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Exact operationKey and valid audit page required');
    const db = await database();
    const operation = db.prepare('SELECT scope FROM merchant_operations WHERE operation_key=?').get(operationKey);
    if (!operation) return null;
    if (operation.scope !== scope) throw fail('OPERATION_SCOPE_MISMATCH');
    const rows = db.prepare(`SELECT seq,generation,state,at,reference FROM merchant_operation_audit
      WHERE operation_key=? AND seq>? ORDER BY seq LIMIT ?`).all(operationKey,after,limit + 1);
    const more = rows.length > limit, events = rows.slice(0,limit);
    return { events, nextAfter: more ? events.at(-1).seq : null };
  }
  async function admit({ ticket, requestHash }) {
    try {
      const payload = verify(ticket, requestHash), row = rowFor(await database(), payload.operationKey);
      ensureMatch(row, requestHash);
      if (row?.state === 'UNCERTAIN') return reply(409, 'OPERATION_OUTCOME_UNCERTAIN');
      return true;
    } catch (error) { return reply(error.status ?? 503, error.code ?? 'OPERATION_STATE_UNAVAILABLE'); }
  }
  function reserve(db, payload) {
    return transaction(db, () => {
      const row = rowFor(db, payload.operationKey);
      ensureMatch(row, payload.requestHash);
      if (row && row.state !== 'RETRY_READY') return { row };
      const usage = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(COALESCE(length(body),0) +
        CASE WHEN state='IN_FLIGHT' THEN ? ELSE 0 END),0) AS bytes FROM merchant_operations`).get(maxResponseBytes);
      if (!row && usage.count >= maxEntries || usage.bytes + maxResponseBytes > maxStoredBytes) throw fail('OPERATION_STORAGE_CAPACITY', 503);
      const now = Date.now(), claim = randomUUID(), attempt = (row?.attempt ?? 0) + 1, generation = (row?.generation ?? 0) + 1;
      if (row) db.prepare(`UPDATE merchant_operations SET state='IN_FLIGHT',attempt=?,generation=?,claim_id=?,
        owner_pid=?,owner_host=?,owner_start=?,owner_run=?,updated_at=?,error=NULL WHERE operation_key=? AND generation=?`)
        .run(attempt,generation,claim,process.pid,ownStamp?.host ?? null,ownStamp?.start ?? null,runId,now,payload.operationKey,row.generation);
      else db.prepare(`INSERT INTO merchant_operations(operation_key,scope,request_hash,state,attempt,generation,
        claim_id,owner_pid,owner_host,owner_start,owner_run,created_at,updated_at) VALUES(?,?,?,'IN_FLIGHT',?,?,?,?,?,?,?,?,?)`)
        .run(payload.operationKey,scope,payload.requestHash,attempt,generation,claim,process.pid,ownStamp?.host ?? null,ownStamp?.start ?? null,runId,now,now);
      const current = rowFor(db, payload.operationKey); audit(db, current);
      return { row: current, claim };
    });
  }
  function finalize(db, payload, claim, result) {
    return transaction(db, () => {
      const row = rowFor(db, payload.operationKey);
      if (!row || row.state !== 'IN_FLIGHT' || row.claim_id !== claim) throw fail('OPERATION_CLAIM_CHANGED', 503);
      const state = result.outcome === 'NOT_DISPATCHED' ? 'RETRY_READY' : result.outcome === 'COMPLETE' ? 'COMPLETE' : 'UNCERTAIN';
      const response = state === 'COMPLETE' ? serializeResponse(result.response, maxResponseBytes) : null;
      db.prepare(`UPDATE merchant_operations SET state=?,generation=generation+1,updated_at=?,status=?,headers=?,body=?,body_hash=?,error=?
        WHERE operation_key=? AND claim_id=?`).run(state,Date.now(),response?.status ?? null,response?.headers ?? null,
          response?.bytes ?? null,response?.sha ?? null,state === 'COMPLETE' ? null : result.error ?? 'UPSTREAM_OUTCOME_UNCERTAIN',payload.operationKey,claim);
      const current = rowFor(db, payload.operationKey); audit(db, current);
      return current;
    });
  }
  async function waitFor(db, payload, signal) {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      if (signal?.aborted) return reply(499, 'OPERATION_WAIT_ABORTED');
      const row = rowFor(db, payload.operationKey); ensureMatch(row, payload.requestHash);
      if (row?.state === 'COMPLETE') { counts.replayed++; return decoded(row); }
      if (row?.state === 'UNCERTAIN') return reply(409, 'OPERATION_OUTCOME_UNCERTAIN');
      if (row?.state === 'RETRY_READY') return reply(503, 'OPERATION_RETRY_REQUIRES_NEW_REQUEST');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return reply(409, 'OPERATION_IN_PROGRESS');
  }
  async function execute({ ticket, requestHash, signal }, perform) {
    let payload, db;
    try { payload = verify(ticket, requestHash); db = await database(); }
    catch (error) { return reply(error.status ?? 503, error.code ?? 'OPERATION_STATE_UNAVAILABLE'); }
    const localKey = databasePath + '\n' + payload.operationKey;
    if (active.has(localKey)) {
      const pending = active.get(localKey);
      if (pending.requestHash !== requestHash) return reply(409, 'OPERATION_REQUEST_CONFLICT');
      counts.coalesced++;
      return waitFor(db, payload, signal);
    }
    const pending = { requestHash };
    // Claim local ownership before the first await; the SQLite transaction also
    // serializes independent processes, with no transaction held during HTTP.
    active.set(localKey, pending);
    try {
      if (signal?.aborted) return reply(499, 'OPERATION_ABORTED_BEFORE_DISPATCH');
      const reserved = reserve(db, payload);
      if (!reserved.claim) {
        if (reserved.row.state === 'COMPLETE') { counts.replayed++; return decoded(reserved.row); }
        if (reserved.row.state === 'UNCERTAIN') return reply(409, 'OPERATION_OUTCOME_UNCERTAIN');
        counts.coalesced++; return await waitFor(db, payload, signal);
      }
      counts.executed++;
      let result;
      try { result = await perform({ backendKey: 'sf30_' + payload.operationKey }); }
      catch { result = { outcome: 'UNCERTAIN', error: 'UPSTREAM_EXECUTION_INTERRUPTED' }; }
      if (!plain(result) || !['COMPLETE','UNCERTAIN','NOT_DISPATCHED'].includes(result.outcome)) result = { outcome: 'UNCERTAIN', error: 'UPSTREAM_EXECUTION_UNCLASSIFIED' };
      let row;
      try { row = finalize(db, payload, reserved.claim, result); }
      catch { counts.uncertain++; return reply(503, 'OPERATION_OUTCOME_NOT_DURABLE'); }
      if (row.state === 'COMPLETE') return decoded(row);
      if (row.state === 'UNCERTAIN') { counts.uncertain++; return reply(409, 'OPERATION_OUTCOME_UNCERTAIN'); }
      return result.response ? clone(result.response) : reply(503, 'OPERATION_NOT_DISPATCHED');
    } catch (error) { return reply(error.status ?? 503, error.code ?? 'OPERATION_STATE_UNAVAILABLE'); }
    finally { if (active.get(localKey) === pending) active.delete(localKey); }
  }
  async function recover({ operationKey, expectedGeneration, requestHash, action, reference, response }) {
    if (!HEX.test(operationKey ?? '') || !HEX.test(requestHash ?? '') || !Number.isSafeInteger(expectedGeneration) ||
        expectedGeneration < 1 || !['complete','retry'].includes(action) || typeof reference !== 'string' ||
        reference.trim().length < 8 || reference.length > 512 || /[\x00-\x1f\x7f]/.test(reference)) throw new TypeError('Explicit operation, generation, request hash, action and backend reference required');
    const saved = action === 'complete' ? serializeResponse(response, maxResponseBytes) : null;
    const db = await database();
    return transaction(db, () => {
      const row = rowFor(db, operationKey); ensureMatch(row, requestHash);
      if (!row || row.generation !== expectedGeneration || !['UNCERTAIN','IN_FLIGHT'].includes(row.state)) throw fail('OPERATION_RECOVERY_CONFLICT');
      if (row.state === 'IN_FLIGHT') {
        const stamp = processStamp(row.owner_pid);
        if (!ownStamp || row.owner_host !== ownStamp.host || stamp && stamp.host === row.owner_host && stamp.start === row.owner_start) throw fail('OPERATION_OWNER_STILL_ACTIVE');
      }
      if (saved) {
        const usage = db.prepare(`SELECT COALESCE(SUM(COALESCE(length(body),0) +
          CASE WHEN state='IN_FLIGHT' AND operation_key<>? THEN ? ELSE 0 END),0) AS bytes
          FROM merchant_operations`).get(operationKey,maxResponseBytes);
        if (usage.bytes + saved.bytes.length > maxStoredBytes) throw fail('OPERATION_STORAGE_CAPACITY', 503);
      }
      db.prepare(`UPDATE merchant_operations SET state=?,generation=generation+1,updated_at=?,status=?,headers=?,body=?,body_hash=?,error=NULL,reference=?
        WHERE operation_key=? AND generation=?`).run(saved ? 'COMPLETE' : 'RETRY_READY',Date.now(),saved?.status ?? null,
          saved?.headers ?? null,saved?.bytes ?? null,saved?.sha ?? null,reference,operationKey,expectedGeneration);
      const current = rowFor(db, operationKey); audit(db, current, reference); return publicRow(current);
    });
  }
  return Object.freeze({ issue, verify, admit, execute, inspect, response, list, audit: auditHistory, recover,
    snapshot: () => Object.freeze({ ...counts }),
    async close() { if (databasePromise) { const db = await databasePromise; db.close(); databasePromise = undefined; } },
  });
}
