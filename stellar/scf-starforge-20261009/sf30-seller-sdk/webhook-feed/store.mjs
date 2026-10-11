// MIT. Atomic authenticated ingestion and stable cursor pages in private SQLite.
import { DatabaseSync, backup } from 'node:sqlite';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { chmod, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SCHEMA, PAGE_SCHEMA, FeedError, digest, eventData, feedDefinition,
  integer, isRecord, parseEventPayload, projectPayload, requireId, revision, sourceDefinition } from './model.mjs';
import { verifyStandardWebhook } from './signatures.mjs';

export function privateDirectory(path) {
  const absolute = resolve(path);
  if (existsSync(absolute) && (lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isDirectory())) throw new FeedError('PRIVATE_DIRECTORY_REQUIRED', 422);
  mkdirSync(absolute, { recursive: true, mode: 0o700 }); chmodSync(absolute, 0o700); return absolute;
}
export class EventFeedStore {
  constructor(directory, { now = () => Date.now(), secretResolver = name => process.env[name] } = {}) {
    this.directory = privateDirectory(directory); this.database = resolve(this.directory, 'events.sqlite');
    this.now = now; this.secretResolver = secretResolver; this.closed = false;
    if (existsSync(this.database) && (lstatSync(this.database).isSymbolicLink() || !lstatSync(this.database).isFile())) throw new FeedError('REGULAR_DATABASE_REQUIRED', 422);
    if (!existsSync(this.database)) closeSync(openSync(this.database, 'wx', 0o600));
    chmodSync(this.database, 0o600);
    this.db = new DatabaseSync(this.database);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      this.transaction(() => {
        const version = this.db.prepare('PRAGMA user_version').get().user_version;
        if (version !== 0 && version !== 1) throw new FeedError('UNSUPPORTED_STORE_VERSION', 409);
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, revision TEXT NOT NULL, definition TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY, revision TEXT NOT NULL, definition TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, item_id TEXT NOT NULL, revision TEXT NOT NULL, definition TEXT NOT NULL, recorded_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS identities (sequence INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, event_id TEXT NOT NULL,
            source_body_sha256 TEXT NOT NULL, accepted_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, UNIQUE(source_id,event_id));
          CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY REFERENCES identities(sequence), source_id TEXT NOT NULL,
            event_id TEXT NOT NULL, type TEXT NOT NULL, occurred_at TEXT, received_at TEXT NOT NULL, source_body_sha256 TEXT NOT NULL, raw_body BLOB NOT NULL);
          CREATE INDEX IF NOT EXISTS events_source_sequence ON events(source_id,sequence);
          CREATE INDEX IF NOT EXISTS events_type_sequence ON events(type,sequence);
          PRAGMA user_version=1;
        `);
        const insert = this.db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)');
        insert.run('schema', SCHEMA); insert.run('storeId', randomBytes(16).toString('hex'));
        insert.run('cursorKey', randomBytes(32).toString('base64')); insert.run('purgedThrough', '0');
        if (this.meta('schema') !== SCHEMA) throw new FeedError('UNSUPPORTED_STORE_SCHEMA', 409);
      });
      this.storeId = this.meta('storeId'); this.cursorKey = Buffer.from(this.meta('cursorKey'), 'base64');
      if (!/^[a-f0-9]{32}$/.test(this.storeId) || this.cursorKey.length !== 32) throw new FeedError('INVALID_STORE_IDENTITY', 409);
      for (const suffix of ['-wal', '-shm']) if (existsSync(this.database + suffix)) chmodSync(this.database + suffix, 0o600);
    } catch (error) { this.db.close(); throw error; }
  }
  transaction(action, { readOnly = false } = {}) {
    if (this.closed) throw new FeedError('STORE_CLOSED', 503);
    this.db.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  meta(key) { return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value; }
  definition(kind, id, { enabled = false } = {}) {
    if (!['source', 'feed'].includes(kind)) throw new FeedError('INVALID_DEFINITION_KIND', 422);
    requireId(id);
    const table = kind === 'source' ? 'sources' : 'feeds';
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!row) throw new FeedError(kind === 'source' ? 'SOURCE_NOT_FOUND' : 'FEED_NOT_FOUND', 404);
    const result = { ...JSON.parse(row.definition), revision: row.revision, updatedAt: row.updated_at };
    if (kind === 'feed') {
      const sourcePolicies = result.sourceIds.map(id => {
        const source = this.definition('source', id);
        return { id, typePointer: source.typePointer, occurredAtPointer: source.occurredAtPointer };
      });
      result.revision = revision({ definition: JSON.parse(row.definition), sourcePolicies });
    }
    if (enabled && !result.enabled) throw new FeedError(kind === 'source' ? 'SOURCE_PAUSED' : 'FEED_PAUSED', 409);
    return result;
  }
  saveDefinition(kind, input, expectedRevision = null) {
    if (!['source', 'feed'].includes(kind)) throw new FeedError('INVALID_DEFINITION_KIND', 422);
    const value = kind === 'source' ? sourceDefinition(input) : feedDefinition(input);
    const nextRevision = revision(value), table = kind === 'source' ? 'sources' : 'feeds';
    return this.transaction(() => {
      const previous = this.db.prepare(`SELECT revision FROM ${table} WHERE id=?`).get(value.id);
      if (previous?.revision === nextRevision) return this.definition(kind, value.id);
      const currentRevision = previous ? this.definition(kind, value.id).revision : null;
      if (currentRevision !== expectedRevision) throw new FeedError('DEFINITION_CHANGED', 409, { expectedRevision, currentRevision });
      if (kind === 'feed') for (const sourceId of value.sourceIds) this.definition('source', sourceId);
      const timestamp = new Date(this.now()).toISOString(), serialized = JSON.stringify(value);
      this.db.prepare(`INSERT INTO ${table}(id,revision,definition,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,definition=excluded.definition,updated_at=excluded.updated_at`).run(value.id, nextRevision, serialized, timestamp);
      this.db.prepare('INSERT INTO changes(kind,item_id,revision,definition,recorded_at) VALUES (?,?,?,?,?)').run(kind, value.id, nextRevision, serialized, timestamp);
      return this.definition(kind, value.id);
    });
  }
  acceptWebhook(sourceId, headers, rawBody) {
    const source = this.definition('source', sourceId, { enabled: true });
    if (!Buffer.isBuffer(rawBody) || !rawBody.length || rawBody.length > source.maxEventBytes) throw new FeedError('EVENT_BODY_TOO_LARGE', 413);
    const now = this.now();
    const verified = verifyStandardWebhook({ headers, rawBody, secret: this.secretResolver(source.secretEnv), now, toleranceSeconds: source.toleranceSeconds });
    const bodyDigest = digest(rawBody), receivedAt = new Date(now).toISOString();
    return this.transaction(() => {
      if (this.definition('source', sourceId, { enabled: true }).revision !== source.revision) throw new FeedError('SOURCE_CHANGED', 409);
      const previous = this.db.prepare('SELECT * FROM identities WHERE source_id=? AND event_id=?').get(sourceId, verified.eventId);
      if (previous) {
        if (previous.source_body_sha256 !== bodyDigest) throw new FeedError('EVENT_ID_CONFLICT', 409, { eventId: verified.eventId });
        this.db.prepare('UPDATE identities SET attempts=attempts+1,last_seen_at=? WHERE sequence=?').run(receivedAt, previous.sequence);
        return { schema: 'stellar-forge.webhook-ack.v1', storeId: this.storeId, sourceId, eventId: verified.eventId,
          sequence: previous.sequence, sourceBodySha256: bodyDigest, acceptedAt: previous.accepted_at, duplicate: true,
          retained: Boolean(this.db.prepare('SELECT 1 FROM events WHERE sequence=?').get(previous.sequence)) };
      }
      // Preserve the raw body identity before extracting configured business fields.
      const event = eventData(source, rawBody);
      const result = this.db.prepare('INSERT INTO identities(source_id,event_id,source_body_sha256,accepted_at,last_seen_at) VALUES (?,?,?,?,?)').run(sourceId, verified.eventId, bodyDigest, receivedAt, receivedAt);
      const sequence = Number(result.lastInsertRowid);
      if (!Number.isSafeInteger(sequence)) throw new FeedError('SEQUENCE_EXHAUSTED', 503);
      this.db.prepare('INSERT INTO events(sequence,source_id,event_id,type,occurred_at,received_at,source_body_sha256,raw_body) VALUES (?,?,?,?,?,?,?,?)')
        .run(sequence, sourceId, verified.eventId, event.type, event.occurredAt, receivedAt, bodyDigest, rawBody);
      return { schema: 'stellar-forge.webhook-ack.v1', storeId: this.storeId, sourceId, eventId: verified.eventId,
        sequence, sourceBodySha256: bodyDigest, acceptedAt: receivedAt, duplicate: false, retained: true };
    });
  }
  encodeCursor(feed, after, through) {
    const body = Buffer.from(JSON.stringify({ v: 1, s: this.storeId, f: feed.id, r: feed.revision, a: after, t: through })).toString('base64url');
    return body + '.' + createHmac('sha256', this.cursorKey).update(body).digest('base64url');
  }
  decodeCursor(feed, cursor) {
    if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) throw new FeedError('INVALID_CURSOR', 422);
    const [body, signature] = cursor.split('.');
    const expected = createHmac('sha256', this.cursorKey).update(body).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new FeedError('INVALID_CURSOR', 422);
    let value; try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new FeedError('INVALID_CURSOR', 422); }
    if (!isRecord(value) || value.v !== 1 || value.s !== this.storeId || value.f !== feed.id || !Number.isSafeInteger(value.a) || value.a < 0 || value.t !== null && (!Number.isSafeInteger(value.t) || value.t < value.a)) throw new FeedError('INVALID_CURSOR', 422);
    if (value.r !== feed.revision) throw new FeedError('FEED_CHANGED', 409, { feedId: feed.id, currentRevision: feed.revision });
    return { after: value.a, through: value.t };
  }
  readPage(feedId, input = {}, { expectedRevision } = {}) {
    if (!isRecord(input) || Object.keys(input).some(key => !['cursor', 'limit'].includes(key))) throw new FeedError('INVALID_FEED_QUERY', 422);
    return this.transaction(() => {
      const feed = this.definition('feed', feedId, { enabled: true });
      if (expectedRevision && feed.revision !== expectedRevision) throw new FeedError('FEED_CHANGED', 409, { feedId, currentRevision: feed.revision });
      const limit = integer(input.limit, 'limit', 1, feed.maxPageSize, feed.defaultPageSize);
      const floor = Number(this.meta('purgedThrough'));
      const watermark = this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM identities').get().value;
      const position = input.cursor === undefined ? { after: floor, through: null } : this.decodeCursor(feed, input.cursor);
      if (position.after < floor) throw new FeedError('CURSOR_EXPIRED', 410, { earliestSequence: floor + 1, purgedThroughSequence: floor });
      const through = position.through ?? watermark;
      if (through > watermark || position.after > through) throw new FeedError('INVALID_CURSOR', 422);
      const sourceSlots = feed.sourceIds.map(() => '?').join(','), typeSlots = feed.types.map(() => '?').join(',');
      const statement = this.db.prepare(`SELECT * FROM events WHERE sequence>? AND sequence<=? AND source_id IN (${sourceSlots}) ${feed.types.length ? `AND type IN (${typeSlots})` : ''} ORDER BY sequence LIMIT ?`);
      const iterator = statement.iterate(position.after, through, ...feed.sourceIds, ...feed.types, limit + 1);
      const items = []; let bytes = 2048, hasMore = false, exhausted = false;
      try {
        while (true) {
          const result = iterator.next();
          if (result.done) { exhausted = true; break; }
          const row = result.value;
          if (items.length === limit) { hasMore = true; break; }
          const payload = projectPayload(parseEventPayload(Buffer.from(row.raw_body)), feed.projection);
          const item = { sequence: row.sequence, sourceId: row.source_id, eventId: row.event_id, type: row.type,
            receivedAt: row.received_at, occurredAt: row.occurred_at, payload, sourceBodySha256: row.source_body_sha256,
            payloadSha256: digest(JSON.stringify(payload)) };
          const length = Buffer.byteLength(JSON.stringify(item)) + 1;
          if (bytes + length > feed.maxPageBytes && items.length) { hasMore = true; break; }
          if (bytes + length > feed.maxPageBytes) throw new FeedError('EVENT_PROJECTION_TOO_LARGE', 422);
          items.push(item); bytes += length;
        }
      } finally {
        // Release the SQLite statement before the enclosing read transaction commits.
        // The fallback exhausts only this query's limit+1 rows on iterator runtimes
        // that omit return(), without retaining raw bodies or projecting extra data.
        if (!exhausted) {
          if (typeof iterator.return === 'function') iterator.return();
          else while (!iterator.next().done) {}
        }
      }
      const nextAfter = hasMore ? items.at(-1).sequence : through;
      return { schema: PAGE_SCHEMA, storeId: this.storeId, feedId, feedRevision: feed.revision, items,
        page: { afterSequence: position.after, throughSequence: through, returned: items.length, hasMore,
          nextCursor: hasMore ? this.encodeCursor(feed, nextAfter, through) : null,
          resumeCursor: this.encodeCursor(feed, through, null) } };
    }, { readOnly: true });
  }
  status() {
    return this.transaction(() => ({ schema: SCHEMA, storeId: this.storeId,
      acceptedEvents: this.db.prepare('SELECT COUNT(*) AS n FROM identities').get().n,
      retainedEvents: this.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,
      duplicateDeliveries: this.db.prepare('SELECT COALESCE(SUM(attempts-1),0) AS n FROM identities').get().n,
      highWatermark: this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM identities').get().n,
      purgedThroughSequence: Number(this.meta('purgedThrough')),
      retainedBodyBytes: this.db.prepare('SELECT COALESCE(SUM(length(raw_body)),0) AS n FROM events').get().n,
      sources: this.db.prepare('SELECT id FROM sources ORDER BY id').all().map(row => this.definition('source', row.id)),
      feeds: this.db.prepare('SELECT id FROM feeds ORDER BY id').all().map(row => this.definition('feed', row.id)),
    }), { readOnly: true });
  }
  listEvents({ after = 0, limit = 50, sourceId } = {}) {
    integer(after, 'after', 0, Number.MAX_SAFE_INTEGER); integer(limit, 'limit', 1, 200);
    if (sourceId !== undefined) requireId(sourceId);
    const rows = this.db.prepare(`SELECT i.sequence,i.source_id,i.event_id,i.source_body_sha256,i.accepted_at,i.last_seen_at,i.attempts,e.type,e.occurred_at,e.sequence AS retained FROM identities i LEFT JOIN events e ON e.sequence=i.sequence WHERE i.sequence>? ${sourceId ? 'AND i.source_id=?' : ''} ORDER BY i.sequence LIMIT ?`).all(after, ...(sourceId ? [sourceId] : []), limit);
    return rows.map(row => ({ sequence: row.sequence, sourceId: row.source_id, eventId: row.event_id, sourceBodySha256: row.source_body_sha256,
      acceptedAt: row.accepted_at, lastSeenAt: row.last_seen_at, attempts: row.attempts, retained: Boolean(row.retained), type: row.type, occurredAt: row.occurred_at }));
  }
  inspectEvent(sequence) {
    integer(sequence, 'sequence', 1, Number.MAX_SAFE_INTEGER);
    const row = this.db.prepare('SELECT * FROM events WHERE sequence=?').get(sequence);
    if (!row) throw new FeedError('EVENT_NOT_RETAINED', 404);
    return { sequence, sourceId: row.source_id, eventId: row.event_id, type: row.type, receivedAt: row.received_at,
      occurredAt: row.occurred_at, sourceBodySha256: row.source_body_sha256, rawBody: Buffer.from(row.raw_body).toString('utf8') };
  }
  purge(throughSequence, expectedHighWatermark) {
    integer(throughSequence, 'throughSequence', 0, Number.MAX_SAFE_INTEGER);
    integer(expectedHighWatermark, 'expectedHighWatermark', 0, Number.MAX_SAFE_INTEGER);
    return this.transaction(() => {
      const watermark = this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM identities').get().n;
      if (watermark !== expectedHighWatermark) throw new FeedError('STORE_CHANGED', 409, { highWatermark: watermark });
      const floor = Number(this.meta('purgedThrough'));
      if (throughSequence < floor || throughSequence > watermark) throw new FeedError('INVALID_RETENTION_BOUNDARY', 422);
      const deleted = this.db.prepare('DELETE FROM events WHERE sequence<=?').run(throughSequence).changes;
      this.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(String(throughSequence), 'purgedThrough');
      this.db.prepare('INSERT INTO changes(kind,item_id,revision,definition,recorded_at) VALUES (?,?,?,?,?)').run('retention', this.storeId, String(throughSequence), JSON.stringify({ throughSequence, deleted }), new Date(this.now()).toISOString());
      return { storeId: this.storeId, deleted, purgedThroughSequence: throughSequence, retainedIdentityCount: this.db.prepare('SELECT COUNT(*) AS n FROM identities').get().n };
    });
  }
  async backupTo(path) {
    const destination = resolve(path); privateDirectory(dirname(destination));
    const temporary = destination + '.partial-' + randomBytes(8).toString('hex');
    closeSync(openSync(temporary, 'wx', 0o600));
    try { await backup(this.db, temporary); await chmod(temporary, 0o600); await link(temporary, destination); }
    finally { await unlink(temporary).catch(() => {}); }
    return { storeId: this.storeId, database: destination };
  }
  merchantPlan() {
    const value = this.meta('merchantPlan');
    return { plan: value ? JSON.parse(value) : null, revision: this.meta('merchantPlanRevision') ?? null };
  }
  saveMerchantPlan(plan, expectedRevision = null) {
    if (!isRecord(plan) || plan.schema !== 'stellar-forge.webhook-feed-merchant.v1' || Buffer.byteLength(JSON.stringify(plan)) > 1048576) throw new FeedError('INVALID_MERCHANT_PLAN', 422);
    return this.transaction(() => {
      const current = this.merchantPlan(), next = revision(plan);
      if (current.revision === next) return current;
      if (current.revision !== expectedRevision) throw new FeedError('PLAN_CHANGED', 409, { currentRevision: current.revision });
      const statement = this.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      statement.run('merchantPlan', JSON.stringify(plan)); statement.run('merchantPlanRevision', next);
      this.db.prepare('INSERT INTO changes(kind,item_id,revision,definition,recorded_at) VALUES (?,?,?,?,?)').run('merchant-plan', this.storeId, next, JSON.stringify(plan), new Date(this.now()).toISOString());
      return this.merchantPlan();
    });
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
}
