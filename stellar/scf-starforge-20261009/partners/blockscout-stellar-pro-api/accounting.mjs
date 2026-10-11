// MIT. Provider-attempt accounting. Native SF98/SF88 retain payment ownership.
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { error, planSha, QUOTA_HEADERS } from './product.mjs';

const SCHEMA = 'stellar-forge.blockscout-provider-accounting.v1';
const fail = (code, status = 503) => { throw error(code, status); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const LIMIT = 100;
export async function syncDirectory(path) {
  const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await fd.sync(); } finally { await fd.close(); }
}
const integer = n => Number.isSafeInteger(n) && n >= 0;
export async function privateDirectory(directory, create = true) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    fail('BLOCKSCOUT_PRIVATE_DIRECTORY_REQUIRED', 400);
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const s = await lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || await realpath(directory) !== directory)
    fail('BLOCKSCOUT_PRIVATE_DIRECTORY_REQUIRED', 400);
  return directory;
}
async function privateFile(path, flags) {
  const file = await open(path, flags | constants.O_NOFOLLOW, 0o600);
  const s = await file.stat();
  if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077)) {
    await file.close(); fail('BLOCKSCOUT_PRIVATE_FILE_REQUIRED', 400);
  }
  return file;
}
export function providerQuota(headers = {}) {
  const raw = {};
  for (const key of QUOTA_HEADERS) {
    const v = headers[key];
    if (typeof v === 'string' && /^-?\d{1,16}$/.test(v)) raw[key] = v;
  }
  const value = key => {
    const n = Number(raw[key]);
    return Object.hasOwn(raw, key) && integer(n) ? n : null;
  };
  return { raw, creditsRemaining: value('x-credits-remaining'), rateLimit: value('x-ratelimit-limit'),
    rateRemaining: value('x-ratelimit-remaining'), resetMs: value('x-ratelimit-reset') };
}
function rowView(row) {
  if (!row) return null;
  return { sequence: row.sequence, id: row.id, planSha256: row.plan_sha,
    chainId: row.chain_id, addressHash: row.address_hash, purpose: row.purpose,
    startedAt: row.started_at, finishedAt: row.finished_at, state: row.state,
    dispatched: row.dispatched === null ? null : row.dispatched === 1,
    localCredits: row.local_credits, status: row.http_status, upstreamStatus: row.upstream_status,
    error: row.error, response: row.body_sha ? { sha256: row.body_sha, bytes: row.body_bytes,
      retained: row.body_retained === 1 } : null,
    quota: row.quota_json ? JSON.parse(row.quota_json) : null };
}
const COLUMNS = 'sequence,id,plan_sha,chain_id,address_hash,purpose,started_at,finished_at,state,dispatched,' +
  'local_credits,http_status,upstream_status,error,body_sha,body_bytes,(body IS NOT NULL) AS body_retained,quota_json';

export async function openProviderAccounting({ directory, plan, now = () => Date.now() }) {
  await privateDirectory(directory);
  const lockPath = join(directory, 'provider.lock');
  const lock = await privateFile(lockPath, constants.O_CREAT | constants.O_RDWR);
  let db, closed = false, closing;
  const exports = new Set();
  const assertLease = async () => {
    const [a, b] = await Promise.all([lock.stat(), lstat(lockPath)]);
    if (!b.isFile() || b.isSymbolicLink() || a.dev !== b.dev || a.ino !== b.ino || a.nlink !== 1 || (a.mode & 0o077))
      fail('BLOCKSCOUT_ACCOUNTING_LEASE_LOST');
  };
  const planId = planSha(plan), limits = plan.limits;
  try {
    const held = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'pipe', 'pipe', lock.fd], timeout: 10000 });
    if (held.error || held.status !== 0) fail(held.error?.code === 'ENOENT' ? 'BLOCKSCOUT_LINUX_FLOCK_REQUIRED' :
      held.status === 73 ? 'BLOCKSCOUT_ACCOUNTING_ALREADY_OPEN' : 'BLOCKSCOUT_ACCOUNTING_LEASE_FAILED');
    const path = join(directory, 'provider.sqlite');
    const f = await privateFile(path, constants.O_CREAT | constants.O_RDWR); await f.close();
    db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS plans(sha TEXT PRIMARY KEY,json TEXT NOT NULL,created_at TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS attempts(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,' +
      'plan_sha TEXT NOT NULL REFERENCES plans(sha),chain_id TEXT NOT NULL,address_hash TEXT NOT NULL,purpose TEXT NOT NULL,' +
      'started_at TEXT NOT NULL,started_ms INTEGER NOT NULL,day TEXT NOT NULL,finished_at TEXT,finished_ms INTEGER,finished_order INTEGER,state TEXT NOT NULL,' +
      'dispatched INTEGER,local_credits INTEGER NOT NULL,http_status INTEGER,upstream_status INTEGER,error TEXT,' +
      'body_sha TEXT,body_bytes INTEGER NOT NULL DEFAULT 0,body BLOB,quota_json TEXT);' +
      'CREATE INDEX IF NOT EXISTS attempt_day ON attempts(day,started_ms);' +
      'CREATE INDEX IF NOT EXISTS attempt_token ON attempts(chain_id,address_hash,sequence);');
    const columns = new Set(db.prepare('PRAGMA table_info(attempts)').all().map(row => row.name));
    for (const name of ['finished_ms', 'finished_order'])
      if (!columns.has(name)) db.exec('ALTER TABLE attempts ADD COLUMN ' + name + ' INTEGER');
    db.exec("UPDATE attempts SET finished_ms=CAST((julianday(finished_at)-2440587.5)*86400000 AS INTEGER) WHERE finished_at IS NOT NULL AND finished_ms IS NULL;");
    db.exec('CREATE INDEX IF NOT EXISTS attempt_finished ON attempts(finished_ms,finished_order);');
    const saved = db.prepare('SELECT value FROM meta WHERE key=?');
    const schema = saved.get('schema')?.value;
    if (schema !== undefined && schema !== SCHEMA) fail('BLOCKSCOUT_ACCOUNTING_SCHEMA_INVALID');
    const alias = saved.get('accountAlias')?.value;
    if (alias !== undefined && alias !== plan.accountAlias) fail('BLOCKSCOUT_ACCOUNT_ALIAS_MISMATCH');
    db.exec('BEGIN IMMEDIATE');
    try {
      const insert = db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)');
      insert.run('schema', SCHEMA); insert.run('accountAlias', plan.accountAlias);
      db.prepare('INSERT OR IGNORE INTO plans(sha,json,created_at) VALUES(?,?,?)')
        .run(planId, JSON.stringify(plan), new Date(now()).toISOString());
      const retained = db.prepare('SELECT json FROM plans WHERE sha=?').get(planId);
      if (digest(retained.json) !== planId) fail('BLOCKSCOUT_RETAINED_PLAN_INVALID');
      // The previous sole writer has ended. A pending provider read stays
      // charged against its local attempt budget; opening does not retry it.
      db.prepare("UPDATE attempts SET state='outcome_unknown',finished_at=? WHERE state='in_progress'")
        .run(new Date(now()).toISOString());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    await assertLease();
  } catch (e) { db?.close(); await lock.close(); throw e; }
  const live = () => { if (closed) fail('BLOCKSCOUT_ACCOUNTING_CLOSED'); };
  function totals(time) {
    const day = new Date(time).toISOString().slice(0, 10);
    const today = db.prepare('SELECT COUNT(*) AS attempts,COALESCE(SUM(local_credits),0) AS credits ' +
      'FROM attempts WHERE day=? AND (dispatched IS NULL OR dispatched=1)').get(day);
    const second = db.prepare('SELECT COUNT(*) AS attempts FROM attempts WHERE started_ms>? AND ' +
      '(dispatched IS NULL OR dispatched=1)').get(time - 1000).attempts;
    const stored = db.prepare("SELECT COUNT(*) AS records,COALESCE(SUM(body_bytes),0) AS bytes," +
      "COALESCE(SUM(CASE WHEN state='in_progress' THEN 1 ELSE 0 END),0) AS pending FROM attempts").get();
    return { day, today, second, stored };
  }
  function quotaState(time) {
    const latest = db.prepare('SELECT id,started_at,finished_at,finished_ms,quota_json FROM attempts ' +
      'WHERE quota_json IS NOT NULL ORDER BY finished_ms DESC,finished_order DESC,sequence DESC LIMIT 1').get();
    const credit = db.prepare("SELECT id,started_at,finished_ms,quota_json FROM attempts WHERE quota_json IS NOT NULL " +
      "AND finished_ms>? AND finished_ms<=? AND json_type(quota_json,'$.creditsRemaining')='integer' " +
      "ORDER BY json_extract(quota_json,'$.creditsRemaining'),finished_ms DESC,finished_order DESC LIMIT 1")
      .get(time - limits.quotaFreshnessMs, time);
    const rate = db.prepare("SELECT id,started_at,finished_ms,quota_json FROM attempts WHERE quota_json IS NOT NULL " +
      "AND finished_ms<=? AND json_type(quota_json,'$.rateRemaining')='integer' " +
      "AND json_type(quota_json,'$.resetMs')='integer' AND finished_ms+json_extract(quota_json,'$.resetMs')>? " +
      "ORDER BY json_extract(quota_json,'$.rateRemaining'),finished_ms DESC,finished_order DESC LIMIT 1").get(time, time);
    // A response can arrive after other requests were sent or completed. Use
    // the lowest still-applicable provider sample and reserve every other
    // attempt that might not have been included in that sample. Raw provider
    // balance remains separate from this deliberately conservative estimate.
    // Reopening records an interruption time, never a remote completion: an
    // outcome_unknown call may still be charged after any later sample.
    const reservations = row => db.prepare("SELECT COALESCE(SUM(local_credits),0) AS credits,COUNT(*) AS requests " +
      "FROM attempts WHERE id<>? AND (dispatched IS NULL OR dispatched=1) AND " +
      "(state='outcome_unknown' OR finished_at IS NULL OR finished_at>=?)").get(row.id, row.started_at);
    let credits = null, requests = null;
    if (credit) {
      const q = JSON.parse(credit.quota_json), reserved = reservations(credit);
      credits = { observationId: credit.id, reported: q.creditsRemaining, reserved: reserved.credits,
        available: Math.max(0, q.creditsRemaining - reserved.credits),
        expiresInMs: Math.max(0, credit.finished_ms + limits.quotaFreshnessMs - time) };
    }
    if (rate) {
      const q = JSON.parse(rate.quota_json), reserved = reservations(rate);
      requests = { observationId: rate.id, reported: q.rateRemaining, reserved: reserved.requests,
        available: Math.max(0, q.rateRemaining - reserved.requests),
        expiresInMs: Math.max(0, rate.finished_ms + q.resetMs - time) };
    }
    return { latest, credits, requests };
  }
  function admission(time = now()) {
    live(); const usage = totals(time);
    if (usage.stored.pending >= limits.maxInFlight)
      return { allowed: false, status: 503, code: 'BLOCKSCOUT_PROVIDER_IN_FLIGHT_LIMIT', retryAfter: 1 };
    if (usage.today.attempts >= limits.dayAttempts || usage.today.credits + limits.creditsPerAttempt > limits.dayCredits)
      return { allowed: false, status: 429, code: 'BLOCKSCOUT_LOCAL_DAILY_BUDGET', retryAfter: Math.ceil((Date.parse(usage.day + 'T00:00:00Z') + 86400000 - time) / 1000) };
    if (usage.second >= limits.perSecond) return { allowed: false, status: 429, code: 'BLOCKSCOUT_LOCAL_RATE_LIMIT', retryAfter: 1 };
    if (usage.stored.records >= limits.maxRecords ||
        usage.stored.bytes + (usage.stored.pending + 1) * limits.maxResponseBytes > limits.maxStoredBodyBytes)
      return { allowed: false, status: 503, code: 'BLOCKSCOUT_RETAINED_CAPACITY_FULL' };
    const quota = quotaState(time);
    if (quota.credits && quota.credits.available < Math.max(limits.minProviderCredits, limits.creditsPerAttempt))
      return { allowed: false, status: 503, code: 'BLOCKSCOUT_PROVIDER_CREDITS_LOW',
        retryAfter: Math.max(1, Math.ceil(quota.credits.expiresInMs / 1000)) };
    if (quota.requests && quota.requests.available < 1)
      return { allowed: false, status: 429, code: 'BLOCKSCOUT_PROVIDER_RATE_LIMIT',
        retryAfter: Math.max(1, Math.ceil(quota.requests.expiresInMs / 1000)) };
    return { allowed: true };
  }
  function begin({ chainId, addressHash, purpose = 'customer' }) {
    live();
    if (!['customer', 'diagnostic'].includes(purpose)) fail('BLOCKSCOUT_ATTEMPT_PURPOSE_INVALID', 400);
    db.exec('BEGIN IMMEDIATE');
    try {
      const time = now(), decision = admission(time);
      if (!decision.allowed) throw Object.assign(error(decision.code, decision.status), { retryAfter: decision.retryAfter });
      const id = randomUUID(), at = new Date(time).toISOString();
      db.prepare("INSERT INTO attempts(id,plan_sha,chain_id,address_hash,purpose,started_at,started_ms,day,state,local_credits) " +
        "VALUES(?,?,?,?,?,?,?,?,'in_progress',?)").run(id, planId, chainId, addressHash, purpose, at, time, at.slice(0, 10), limits.creditsPerAttempt);
      db.exec('COMMIT'); return id;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function finish(id, { dispatched, status, upstreamStatus, code, body, headers }) {
    live();
    if (typeof dispatched !== 'boolean' || !Number.isInteger(status) || status < 100 || status > 599)
      fail('BLOCKSCOUT_ATTEMPT_RESULT_INVALID');
    const raw = Buffer.isBuffer(body) ? body : null;
    if (raw && raw.length > limits.maxResponseBytes) fail('BLOCKSCOUT_RESPONSE_TOO_LARGE');
    const q = providerQuota(headers);
    const safeCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(code) ? code : null;
    const nativeStatus = Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599 ? upstreamStatus : null;
    const finishedMs = now();
    const finishedOrder = db.prepare('SELECT COALESCE(MAX(finished_order),0)+1 AS n FROM attempts').get().n;
    const result = db.prepare('UPDATE attempts SET finished_at=?,finished_ms=?,finished_order=?,state=?,dispatched=?,local_credits=?,http_status=?,' +
      'upstream_status=?,error=?,body_sha=?,body_bytes=?,body=?,quota_json=? WHERE id=? AND state=?')
      .run(new Date(finishedMs).toISOString(), finishedMs, finishedOrder, dispatched ? status < 400 ? 'provider_succeeded' : 'provider_failed' : 'not_dispatched',
        dispatched ? 1 : 0, dispatched ? limits.creditsPerAttempt : 0, status, nativeStatus, safeCode,
        raw ? digest(raw) : null, raw?.length ?? 0, raw,
        Object.keys(q.raw).length ? JSON.stringify(q) : null, id, 'in_progress');
    if (result.changes !== 1) fail('BLOCKSCOUT_ATTEMPT_STATE_CHANGED');
    return get(id);
  }
  function get(id) {
    live();
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) fail('BLOCKSCOUT_ATTEMPT_ID_INVALID', 400);
    const row = rowView(db.prepare('SELECT ' + COLUMNS + ' FROM attempts WHERE id=?').get(id));
    if (!row) fail('BLOCKSCOUT_ATTEMPT_NOT_FOUND', 404);
    return row;
  }
  function list({ after = 0, limit = 50, chainId, addressHash } = {}) {
    live();
    if (!integer(after) || !Number.isInteger(limit) || limit < 1 || limit > LIMIT ||
        chainId !== undefined && !/^[1-9][0-9]{0,19}$/.test(chainId) ||
        addressHash !== undefined && !/^0x[A-Fa-f0-9]{40}$/.test(addressHash)) fail('BLOCKSCOUT_ATTEMPT_FILTER_INVALID', 400);
    const filters = [], params = [];
    if (chainId !== undefined) { filters.push('chain_id=?'); params.push(chainId); }
    if (addressHash !== undefined) { filters.push('lower(address_hash)=?'); params.push(addressHash.toLowerCase()); }
    const base = filters.length ? ' AND ' + filters.join(' AND ') : '';
    const total = db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE 1=1' + base).get(...params).n;
    const rows = db.prepare('SELECT ' + COLUMNS + ' FROM attempts WHERE sequence>?' + base + ' ORDER BY sequence LIMIT ?')
      .all(after, ...params, limit + 1);
    const hasMore = rows.length > limit; if (hasMore) rows.pop();
    return { rows: rows.map(rowView), nextAfter: hasMore ? rows.at(-1).sequence : null, total };
  }
  function response(id) {
    const info = get(id), row = db.prepare('SELECT body FROM attempts WHERE id=?').get(id);
    if (row.body === null) fail('BLOCKSCOUT_RESPONSE_NOT_RETAINED', 404);
    const bytes = Buffer.from(row.body);
    if (bytes.length !== info.response.bytes || digest(bytes) !== info.response.sha256) fail('BLOCKSCOUT_RESPONSE_INTEGRITY_FAILED');
    return { info, bytes };
  }
  function snapshot() {
    live(); const time = now(), usage = totals(time);
    const last = db.prepare('SELECT ' + COLUMNS + ' FROM attempts ORDER BY sequence DESC LIMIT 1').get();
    const constraints = quotaState(time), quota = constraints.latest;
    const states = db.prepare('SELECT state,COUNT(*) AS count FROM attempts GROUP BY state').all();
    return { schema: SCHEMA, accountAlias: plan.accountAlias, planSha256: planId, capturedAt: new Date(time).toISOString(),
      contract: 'blockscout-pro-token-detail-2026-10-11', limits: { ...limits }, day: usage.day,
      localUsage: { attempts: usage.today.attempts, configuredCredits: usage.today.credits, lastSecondAttempts: usage.second },
      retention: { records: usage.stored.records, bodyBytes: usage.stored.bytes, inProgress: usage.stored.pending },
      states: Object.fromEntries(states.map(row => [row.state, row.count])), admission: admission(time),
      providerQuota: quota ? { observedAt: quota.finished_at, ageMs: Math.max(0, time - Date.parse(quota.finished_at)),
        fresh: time >= quota.finished_ms && time - quota.finished_ms < limits.quotaFreshnessMs, ...JSON.parse(quota.quota_json) } : null,
      quotaEstimates: { credits: constraints.credits, requests: constraints.requests },
      latest: rowView(last) };
  }
  async function createBackup(destination) {
    if (typeof destination !== 'string' || !isAbsolute(destination) || resolve(destination) !== destination)
      fail('BLOCKSCOUT_BACKUP_DESTINATION_INVALID', 400);
    await privateDirectory(dirname(destination), false);
    try { await lstat(destination); fail('BLOCKSCOUT_BACKUP_DESTINATION_EXISTS', 409); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await assertLease();
    // SQLite supplies a consistent complete database image while the original
    // writer remains responsible for current requests and their later results.
    db.prepare('VACUUM INTO ?').run(destination);
    const f = await open(destination, constants.O_RDWR | constants.O_NOFOLLOW);
    try { await f.chmod(0o600); await f.sync(); const h = createHash('sha256'); let bytes = 0;
      for await (const part of f.createReadStream({ autoClose: false })) { h.update(part); bytes += part.length; }
      await syncDirectory(dirname(destination));
      return { schema: 'stellar-forge.blockscout-provider-backup.v1', destination, sha256: h.digest('hex'), bytes,
        accountAlias: plan.accountAlias, createdAt: new Date(now()).toISOString() };
    } finally { await f.close(); }
  }
  function backup(destination) {
    live();
    const work = createBackup(destination);
    exports.add(work); work.finally(() => exports.delete(work)).catch(() => {});
    return work;
  }
  return Object.freeze({ directory, planSha256: planId, admission, begin, finish, get, list, response, snapshot, backup,
    close() {
      if (!closing) {
        closed = true;
        closing = (async () => { await Promise.allSettled([...exports]); db.close(); await lock.close(); })();
      }
      return closing;
    } });
}

/** Restore exact retained bytes to a new private root; no request is replayed. */
export async function restoreProviderBackup({ source, sha256, directory }) {
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) fail('BLOCKSCOUT_BACKUP_SHA_REQUIRED', 400);
  if (typeof source !== 'string' || !isAbsolute(source) || resolve(source) !== source) fail('BLOCKSCOUT_BACKUP_SOURCE_INVALID', 400);
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || directory === '/')
    fail('BLOCKSCOUT_PRIVATE_DIRECTORY_REQUIRED', 400);
  await privateDirectory(dirname(directory), false);
  await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory, false);
  const sourceFile = await privateFile(source, constants.O_RDONLY);
  const destination = join(directory, 'provider.sqlite'); let target;
  try {
    target = await privateFile(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of sourceFile.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > 1200000000) fail('BLOCKSCOUT_BACKUP_TOO_LARGE', 400);
      hash.update(chunk); await target.writeFile(chunk);
    }
    if (hash.digest('hex') !== sha256) fail('BLOCKSCOUT_BACKUP_SHA_MISMATCH', 400);
    await target.sync(); await target.close(); target = null;
    const db = new DatabaseSync(destination, { readOnly: true });
    try {
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
          db.prepare('SELECT value FROM meta WHERE key=?').get('schema')?.value !== SCHEMA)
        fail('BLOCKSCOUT_BACKUP_DATABASE_INVALID', 400);
      const plans = db.prepare('SELECT sha,json FROM plans').all();
      if (plans.some(row => digest(row.json) !== row.sha)) fail('BLOCKSCOUT_BACKUP_PLAN_INVALID', 400);
      await syncDirectory(directory); await syncDirectory(dirname(directory));
      return { schema: 'stellar-forge.blockscout-provider-restored.v1', directory, sha256, bytes,
        accountAlias: db.prepare('SELECT value FROM meta WHERE key=?').get('accountAlias').value,
        retainedAttempts: db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n };
    } finally { db.close(); }
  } catch (e) { await target?.close().catch(() => {}); await unlink(destination).catch(() => {}); throw e; }
  finally { await sourceFile.close(); }
}
