// MIT. Cloud edition records inside the original workspace's owned SQLite database.
import { issue, identity } from './contract.mjs';

export function createCloudStore({ db, transaction }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO cloud_meta(id,revision) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS cloud_records (
      kind TEXT NOT NULL, id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE,
      request_sha256 TEXT NOT NULL, request TEXT NOT NULL, state TEXT NOT NULL,
      body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(kind,id)
    );
    CREATE TABLE IF NOT EXISTS cloud_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL,
      kind TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL,
      details TEXT NOT NULL
    );
  `);
  db.exec("UPDATE cloud_records SET state='INTERRUPTED' WHERE state IN ('INSPECTING','COMPARING','MATERIALIZING','EXPORTING','RECEIVING')");
  const revision = () => db.prepare('SELECT revision FROM cloud_meta WHERE id=1').get().revision;
  const decode = row => row ? { ...JSON.parse(row.body), id: row.id, state: row.state,
    request: JSON.parse(row.request), requestSha256: row.request_sha256,
    createdAt: row.created_at, updatedAt: row.updated_at } : null;
  const get = (kind, id) => decode(db.prepare('SELECT * FROM cloud_records WHERE kind=? AND id=?').get(kind, id));
  const event = (kind, id, action, details) => {
    db.prepare('UPDATE cloud_meta SET revision=revision+1 WHERE id=1').run();
    const current = revision();
    db.prepare('INSERT INTO cloud_events(revision,kind,record_id,action,at,details) VALUES(?,?,?,?,?,?)')
      .run(current, kind, id, action, new Date().toISOString(), JSON.stringify(details));
    return current;
  };
  return {
    revision, get,
    list(kind) { return db.prepare('SELECT * FROM cloud_records WHERE kind=? ORDER BY rowid DESC').all(kind).map(decode); },
    history() {
      return db.prepare('SELECT * FROM cloud_events ORDER BY sequence DESC LIMIT 500').all()
        .map(row => ({ ...row, details: JSON.parse(row.details) }));
    },
    reserve(kind, id, request, state, body = {}) {
      return transaction(() => {
        const old = db.prepare('SELECT * FROM cloud_records WHERE operation_id=?').get(request.operationId);
        const hash = identity(request);
        if (old) {
          if (old.kind !== kind || old.id !== id || old.request_sha256 !== hash)
            throw issue('CLOUD_OPERATION_CONTENT_CONFLICT', 'The retained operation ID belongs to different input.', 409);
          return { record: decode(old), existing: true, revision: revision() };
        }
        if (request.expectedRevision !== revision())
          throw issue('CLOUD_REVISION_CHANGED', 'Refresh the current cloud workspace before saving this action.', 409);
        const now = new Date().toISOString();
        db.prepare('INSERT INTO cloud_records(kind,id,operation_id,request_sha256,request,state,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(kind, id, request.operationId, hash, JSON.stringify(request), state, JSON.stringify(body), now, now);
        const current = event(kind, id, 'created', { requestSha256: hash });
        return { record: get(kind, id), existing: false, revision: current };
      });
    },
    update(kind, id, state, body, action = 'updated', apply = null) {
      return transaction(() => {
        const prior = get(kind, id);
        if (!prior) throw issue('CLOUD_RECORD_NOT_FOUND', undefined, 404);
        const merged = { ...prior, ...body }; delete merged.request; delete merged.requestSha256;
        delete merged.createdAt; delete merged.updatedAt; delete merged.state;
        db.prepare('UPDATE cloud_records SET state=?,body=?,updated_at=? WHERE kind=? AND id=?')
          .run(state, JSON.stringify(merged), new Date().toISOString(), kind, id);
        if (apply) apply();
        const current = event(kind, id, action, { state });
        return { ...get(kind, id), revision: current };
      });
    },
    importRecord(kind, record, origin) {
      const existing = get(kind, record.id);
      if (existing) {
        if (existing.requestSha256 !== record.requestSha256) throw issue('CLOUD_RECEIVED_IDENTITY_CONFLICT', undefined, 409);
        if (kind === 'comparison') {
          if (existing.reportSha256 !== record.reportSha256) throw issue('CLOUD_RECEIVED_COMPARISON_CONFLICT', undefined, 409);
          const prior = existing.review ?? { revision: 0, history: [] }, incoming = record.review ?? { revision: 0, history: [] };
          const common = Math.min(prior.history.length, incoming.history.length);
          if (identity(prior.history.slice(0, common)) !== identity(incoming.history.slice(0, common)) ||
              prior.revision === incoming.revision && identity(prior) !== identity(incoming))
            throw issue('CLOUD_RECEIVED_REVIEW_CONFLICT', undefined, 409);
          if (incoming.revision > prior.revision) {
            if (common !== prior.history.length) throw issue('CLOUD_RECEIVED_REVIEW_CONFLICT', undefined, 409);
            db.prepare('UPDATE cloud_records SET body=?,updated_at=? WHERE kind=? AND id=?')
              .run(JSON.stringify({ ...existing, review: incoming, receivedFrom: origin }), new Date().toISOString(), kind, record.id);
          }
        }
        return get(kind, record.id);
      }
      const now = new Date().toISOString();
      db.prepare('INSERT INTO cloud_records(kind,id,operation_id,request_sha256,request,state,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(kind, record.id, 'received-' + kind + '-' + identity({ id: record.id, origin }).slice(0, 40),
          record.requestSha256, JSON.stringify(record.request), record.state,
          JSON.stringify({ ...record, receivedFrom: origin }), record.createdAt, now);
      return get(kind, record.id);
    },
    patchBody(kind, id, patch) {
      const prior = get(kind, id);
      if (!prior) throw issue('CLOUD_RECORD_NOT_FOUND', undefined, 404);
      const body = { ...prior, ...patch }; delete body.request; delete body.requestSha256;
      delete body.createdAt; delete body.updatedAt; delete body.state;
      db.prepare('UPDATE cloud_records SET body=?,updated_at=? WHERE kind=? AND id=?')
        .run(JSON.stringify(body), new Date().toISOString(), kind, id);
    },
    atomic: transaction,
  };
}
