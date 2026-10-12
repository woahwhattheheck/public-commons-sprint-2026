/** MIT. Private, single-writer SQLite quote storage for the original MCP broker. */
import { DatabaseSync } from 'node:sqlite';
import { closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { validateMcpInvocation } from './remote-mcp.mjs';

const STATES = new Set(['PREVIEWED', 'APPROVAL_PENDING', 'EXECUTING', 'CANCEL_REQUESTED',
  'CANCELLED', 'EXPIRED', 'FREE_SUCCESS', 'PROBE_REJECTED', 'CONFIRMED_BY_SERVER',
  'INDETERMINATE', 'REJECTED', 'INTERRUPTED', 'CONFIG_CHANGED']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const error = (code, message) => Object.assign(new Error(message), { code });
const digest = value => createHash('sha256').update(value).digest('hex');

function privatePath(path, directory = false) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) ||
      (stat.mode & 0o077) || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))
    throw error('QUOTE_STORAGE_PERMISSIONS', 'Quote storage must be owned by this user and private (0700 directory, 0600 files).');
}

function file(path, create) {
  if (create) {
    try { closeSync(openSync(path, 'wx', 0o600)); }
    catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
  }
  privatePath(path);
}

/** Persist payment/result metadata, never the signer payload or response body. */
export function quoteSnapshot(quote) {
  const value = structuredClone({
    quoteId: quote.quoteId, resource: quote.resource, url: quote.url, method: quote.method,
    ...(quote.invocation ? { invocation: quote.invocation } : {}),
    accepted: quote.accepted, fingerprint: quote.fingerprint, operatorScope: quote.operatorScope,
    createdAt: quote.createdAt, updatedAt: quote.updatedAt, expiresAt: quote.expiresAt,
    status: quote.status, phase: quote.phase ?? null, attempts: quote.attempts,
    signedRequestDispatched: quote.signedRequestDispatched === true,
    result: quote.result ?? null, failure: quote.failure ?? null,
  });
  if (value.result?.content && typeof value.result.content.body === 'string') {
    const content = value.result.content;
    value.result.content = {
      omitted: true, contentType: content.contentType ?? null, truncated: content.truncated === true,
      bodyBytes: Buffer.byteLength(content.body), bodySha256: digest(content.body),
    };
  }
  return value;
}

function validate(value) {
  if (!plain(value) || typeof value.quoteId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.quoteId) ||
      !STATES.has(value.status) || !['GET', 'HEAD', 'tools/call'].includes(value.method) || !plain(value.accepted) ||
      typeof value.resource !== 'string' || typeof value.url !== 'string' ||
      !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt) ||
      !Number.isSafeInteger(value.expiresAt) || !Number.isSafeInteger(value.attempts) || value.attempts < 0 ||
      typeof value.signedRequestDispatched !== 'boolean' || typeof value.operatorScope !== 'string')
    throw error('QUOTE_STORAGE_INVALID', 'Invalid persisted quote record; preserve the original database.');
  if (value.method === 'tools/call') {
    validateMcpInvocation(value.invocation);
    if (value.url !== value.invocation.endpoint)
      throw error('QUOTE_STORAGE_IDENTITY', 'The remote MCP endpoint changed.');
  } else if (value.invocation !== undefined) {
    throw error('QUOTE_STORAGE_IDENTITY', 'An HTTP quote cannot acquire an MCP invocation.');
  }
  return value;
}

/**
 * A separate SQLite EXCLUSIVE transaction owns the writer lifetime. SQLite/OS
 * releases it on process death, so a crashed broker needs no PID deletion or
 * time-based lease stealing. Data commits use their own WAL/FULL connection.
 * The directory must be on one local filesystem, not a network share.
 */
export class SqliteQuoteStore {
  #db; #owner; #closed = false; #readOnly; #maxQuotes;
  constructor({ directory, readOnly = false, maxQuotes = 10000 } = {}) {
    if (typeof directory !== 'string' || !isAbsolute(directory))
      throw error('QUOTE_STORAGE_PATH', 'An absolute private quote directory is required.');
    if (!Number.isSafeInteger(maxQuotes) || maxQuotes < 1 || maxQuotes > 100000)
      throw new RangeError('Invalid quote capacity');
    this.#readOnly = readOnly; this.#maxQuotes = maxQuotes;
    if (!readOnly) {
      try { mkdirSync(directory, { mode: 0o700 }); }
      catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
    }
    privatePath(directory, true);
    this.directory = realpathSync(directory);
    const dataPath = join(this.directory, 'quotes.sqlite');
    try {
      if (!readOnly) {
        const ownerPath = join(this.directory, 'writer.sqlite');
        file(ownerPath, true);
        this.#owner = new DatabaseSync(ownerPath);
        try { this.#owner.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;'); }
        catch { throw error('QUOTE_WORKSPACE_IN_USE', 'Another broker owns this quote workspace.'); }
      }
      file(dataPath, !readOnly);
      // Reject preexisting redirected or broadly readable SQLite sidecars too.
      for (const suffix of ['-wal', '-shm', '-journal']) {
        try { privatePath(dataPath + suffix); }
        catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      }
      this.#db = new DatabaseSync(dataPath, { readOnly });
      const version = this.#db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 1 && (readOnly || version !== 0))
        throw error('QUOTE_STORAGE_VERSION', 'Unsupported quote database version.');
      if (readOnly) this.#db.exec('PRAGMA query_only=ON;');
      else {
        this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;
          CREATE TABLE IF NOT EXISTS quotes (
            quote_id TEXT PRIMARY KEY, created_ms INTEGER NOT NULL,
            updated_ms INTEGER NOT NULL, payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS transitions (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, quote_id TEXT NOT NULL,
            at_ms INTEGER NOT NULL, status TEXT NOT NULL, phase TEXT,
            signed_dispatched INTEGER NOT NULL, attempts INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS transitions_quote ON transitions(quote_id, sequence);
          PRAGMA user_version=1;`);
      }
    } catch (failure) { this.close(); throw failure; }
  }

  #open(write = false) {
    if (this.#closed) throw error('QUOTE_STORAGE_CLOSED', 'Quote storage is closed.');
    if (write && this.#readOnly) throw error('QUOTE_STORAGE_READ_ONLY', 'This view cannot change quotes.');
  }

  load() {
    this.#open();
    const count = this.#db.prepare('SELECT count(*) AS count FROM quotes').get().count;
    if (count > this.#maxQuotes) throw error('QUOTE_STORAGE_CAPACITY', 'The workspace exceeds its configured quote capacity.');
    return this.#db.prepare('SELECT payload FROM quotes ORDER BY created_ms, quote_id').all()
      .map(row => validate(JSON.parse(row.payload)));
  }

  /** One bounded read transaction over the original validated quote projection. */
  readSnapshot({ maxBytes = 32 * 1024 * 1024 } = {}) {
    this.#open();
    if (!this.#readOnly) throw error('QUOTE_STORAGE_READ_ONLY_REQUIRED', 'Open the original quote workspace read-only for a source capture.');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 64 * 1024 * 1024)
      throw error('QUOTE_CAPTURE_LIMIT', 'Quote capture capacity must be between 1 KiB and 64 MiB.');
    this.#db.exec('BEGIN;');
    try {
      const size = this.#db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM quotes').get();
      if (size.count > this.#maxQuotes || size.bytes > maxBytes)
        throw error('QUOTE_CAPTURE_CAPACITY', 'The complete quote projection exceeds the declared capture capacity; no partial capture was made.');
      const quotes = this.load();
      const transitions = this.#db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(sequence),0) AS lastSequence FROM transitions').get();
      const value = { quotes, quoteBytes: size.bytes, transitionCount: transitions.count,
        lastSequence: transitions.lastSequence, capturedAt: new Date().toISOString() };
      this.#db.exec('COMMIT;');
      return value;
    } catch (failure) {
      try { this.#db.exec('ROLLBACK;'); } catch { /* preserve the source error */ }
      throw failure;
    }
  }

  save(quote) {
    this.#open(true);
    const value = validate(quoteSnapshot(quote));
    const payload = JSON.stringify(value);
    if (Buffer.byteLength(payload) > 256 * 1024)
      throw error('QUOTE_STORAGE_RECORD_TOO_LARGE', 'Quote metadata exceeds 256 KiB.');
    const previous = this.#db.prepare('SELECT payload FROM quotes WHERE quote_id=?').get(value.quoteId);
    if (!previous && this.#db.prepare('SELECT count(*) AS count FROM quotes').get().count >= this.#maxQuotes)
      throw error('QUOTE_STORAGE_CAPACITY', 'Quote workspace is full; existing operations have been preserved.');
    if (previous) {
      const old = validate(JSON.parse(previous.payload));
      if (['resource', 'url', 'method', 'createdAt', 'operatorScope', 'expiresAt'].some(key => old[key] !== value[key]) ||
          !same(old.invocation, value.invocation) ||
          JSON.stringify(old.accepted) !== JSON.stringify(value.accepted) || old.attempts > value.attempts ||
          (old.signedRequestDispatched && !value.signedRequestDispatched))
        throw error('QUOTE_STORAGE_IDENTITY', 'An existing quote cannot be rebound or reset.');
    }
    this.#db.exec('BEGIN IMMEDIATE;');
    try {
      this.#db.prepare(`INSERT INTO quotes VALUES(?,?,?,?) ON CONFLICT(quote_id)
        DO UPDATE SET updated_ms=excluded.updated_ms,payload=excluded.payload`)
        .run(value.quoteId, value.createdAt, value.updatedAt, payload);
      this.#db.prepare(`INSERT INTO transitions(quote_id,at_ms,status,phase,signed_dispatched,attempts)
        VALUES(?,?,?,?,?,?)`).run(value.quoteId, value.updatedAt, value.status, value.phase,
          value.signedRequestDispatched ? 1 : 0, value.attempts);
      this.#db.exec('COMMIT;');
    } catch (failure) {
      try { this.#db.exec('ROLLBACK;'); } catch { /* retain original failure */ }
      throw failure;
    }
  }

  transitions(quoteId, limit = 100) {
    this.#open();
    if (typeof quoteId !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new TypeError('Quote ID and transition limit required');
    return this.#db.prepare(`SELECT sequence,at_ms AS at,status,phase,
      signed_dispatched AS signedRequestDispatched,attempts FROM transitions
      WHERE quote_id=? ORDER BY sequence DESC LIMIT ?`).all(quoteId, limit).reverse()
      .map(row => ({ ...row, signedRequestDispatched: row.signedRequestDispatched === 1 }));
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    try { this.#db?.close(); }
    finally { this.#owner?.close(); }
  }
}
