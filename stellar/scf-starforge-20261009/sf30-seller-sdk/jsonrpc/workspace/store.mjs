// MIT. RPC operation history beside the original private merchant revision store.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openWorkspaceStore, WorkspaceError, sha256, json, operationId, revisionNumber }
  from '../../duckdb/workspace/store.mjs';

export { WorkspaceError, sha256, json, operationId, revisionNumber };
const decode = row => row ? { id: row.id, kind: row.kind, revision: row.revision,
  state: row.state, createdAt: row.created_at, completedAt: row.completed_at,
  request: JSON.parse(row.request), result: row.result ? JSON.parse(row.result) : null,
  error: row.error } : null;
const commerce = row => row ? { id: row.id, revision: row.revision, packageId: row.package_id,
  directory: row.directory, state: row.state, binding: JSON.parse(row.binding),
  reviewSha256: row.review_sha256, createdAt: row.created_at, completedAt: row.completed_at,
  result: row.result ? JSON.parse(row.result) : null, error: row.error } : null;
function page(before, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || before !== null &&
      (typeof before !== 'string' || before.length > 130 || !/^\d{4}-\d\d-\d\dT[0-9:.]+Z\|[a-z][a-z0-9-]{7,79}$/.test(before)))
    throw new WorkspaceError('INVALID_HISTORY_PAGE');
  return before === null ? [null, null] : before.split('|');
}
const pageResult = (rows, limit, decode) => ({ items: rows.slice(0, limit).map(decode),
  next: rows.length > limit ? rows[limit - 1].created_at + '|' + rows[limit - 1].id : null });

export async function openRpcWorkspaceStore(directory) {
  const original = await openWorkspaceStore({ directory, sourceFile: join(directory, 'source-plan.json') });
  let db;
  try {
    db = new DatabaseSync(join(original.directory, 'workspace.sqlite'));
    db.exec(`PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS rpc_actions (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL,
        state TEXT NOT NULL, request TEXT NOT NULL, request_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL, completed_at TEXT, result TEXT, error TEXT
      );
      UPDATE rpc_actions SET state='INTERRUPTED', error='PROCESS_INTERRUPTED'
        WHERE state='RUNNING';
      CREATE TABLE IF NOT EXISTS rpc_commerce_preparations (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, package_id TEXT NOT NULL,
        directory TEXT NOT NULL UNIQUE, state TEXT NOT NULL, binding TEXT NOT NULL,
        review_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, result TEXT, error TEXT
      );
      CREATE TABLE IF NOT EXISTS rpc_commerce_intents (
        intent_id TEXT PRIMARY KEY, buyer_action_id TEXT NOT NULL UNIQUE, preparation_id TEXT NOT NULL
      );
      UPDATE rpc_commerce_preparations SET state='INTERRUPTED', error='PROCESS_INTERRUPTED'
        WHERE state='PREPARING';`);
  } catch (cause) { db?.close(); original.close(); throw cause; }
  const action = id => decode(db.prepare('SELECT * FROM rpc_actions WHERE id=?').get(operationId(id)));
  const getCommerce = id => commerce(db.prepare('SELECT * FROM rpc_commerce_preparations WHERE id=?').get(operationId(id)));
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (cause) { db.exec('ROLLBACK'); throw cause; }
  }
  let closed = false;
  return {
    ...original, action, getCommerce,
    actions({ before = null, limit = 50 } = {}) {
      const [timestamp, id] = page(before, limit);
      const rows = db.prepare('SELECT * FROM rpc_actions WHERE (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(timestamp, timestamp, timestamp, id, limit + 1);
      return pageResult(rows, limit, decode);
    },
    commerceBuyers({ revision, packageId, before = null, limit = 50 }) {
      revisionNumber(revision); operationId(packageId);
      const [timestamp, id] = page(before, limit);
      const rows = db.prepare(`SELECT a.*, i.preparation_id FROM rpc_actions a
        LEFT JOIN rpc_commerce_intents i ON i.buyer_action_id=a.id
        WHERE a.kind='buyer' AND a.state='COMPLETE' AND a.revision=? AND json_extract(a.request,'$.packageId')=?
          AND (? IS NULL OR a.created_at < ? OR (a.created_at = ? AND a.id < ?))
        ORDER BY a.created_at DESC,a.id DESC LIMIT ?`).all(revision, packageId, timestamp, timestamp, timestamp, id, limit + 1);
      return pageResult(rows, limit, row => {
        const action = decode(row), body = action.result.files.find(item => item.name === 'request.json');
        return { id: action.id, revision: action.revision, packageId, createdAt: action.createdAt,
          intentId: action.request.intentId, method: action.request.method, bodySha256: body?.sha256,
          bodyBytes: body?.bytes, preparationId: row.preparation_id ?? null };
      });
    },
    commercePreparations({ before = null, limit = 50 } = {}) {
      const [timestamp, id] = page(before, limit);
      const rows = db.prepare(`SELECT * FROM rpc_commerce_preparations
        WHERE (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC,id DESC LIMIT ?`).all(timestamp, timestamp, timestamp, id, limit + 1);
      return pageResult(rows, limit, commerce);
    },
    reserveCommerce({ id, revision, packageId, directory, binding, reviewSha256 }) {
      operationId(id); revisionNumber(revision); operationId(packageId);
      const encoded = json(binding);
      if (!/^[a-f0-9]{64}$/.test(reviewSha256) || Buffer.byteLength(encoded) > 262144)
        throw new WorkspaceError('RPC_COMMERCE_BINDING_INVALID');
      return transaction(() => {
        const prior = getCommerce(id);
        if (prior) {
          if (prior.revision !== revision || prior.packageId !== packageId || prior.directory !== directory ||
            prior.reviewSha256 !== reviewSha256 || json(prior.binding) !== encoded)
            throw new WorkspaceError('OPERATION_CONTENT_CONFLICT', 409);
          if (prior.state !== 'READY') db.prepare("UPDATE rpc_commerce_preparations SET state='PREPARING',error=NULL WHERE id=?").run(id);
          return getCommerce(id);
        }
        const existingDirectory = db.prepare('SELECT id FROM rpc_commerce_preparations WHERE directory=?').get(directory);
        if (existingDirectory) throw new WorkspaceError('RPC_COMMERCE_ALREADY_RETAINED', 409,
          'Open the existing preparation ' + existingDirectory.id + '.');
        for (const buyer of binding.buyers) {
          const owner = db.prepare('SELECT preparation_id FROM rpc_commerce_intents WHERE intent_id=? OR buyer_action_id=?')
            .get(buyer.intentId, buyer.buyerActionId);
          if (owner) throw new WorkspaceError('RPC_COMMERCE_INTENT_ALREADY_PREPARED', 409,
            'This request already belongs to preparation ' + owner.preparation_id + '. Open that retained session.');
        }
        db.prepare(`INSERT INTO rpc_commerce_preparations
          (id,revision,package_id,directory,state,binding,review_sha256,created_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(id, revision, packageId, directory, 'PREPARING', encoded, reviewSha256, new Date().toISOString());
        for (const buyer of binding.buyers) db.prepare('INSERT INTO rpc_commerce_intents(intent_id,buyer_action_id,preparation_id) VALUES (?,?,?)')
          .run(buyer.intentId, buyer.buyerActionId, id);
        return getCommerce(id);
      });
    },
    finishCommerce(id, result, error = null) {
      db.prepare("UPDATE rpc_commerce_preparations SET state=?,completed_at=?,result=?,error=? WHERE id=? AND state='PREPARING'")
        .run(error ? 'FAILED' : 'READY', new Date().toISOString(), result === null ? null : json(result), error, operationId(id));
      return getCommerce(id);
    },
    beginAction({ id, kind, revision, request }) {
      operationId(id); revisionNumber(revision);
      if (!['diagnose', 'buyer', 'start', 'commerce-review', 'commerce-prepare', 'commerce-open', 'commerce-inspect'].includes(kind))
        throw new WorkspaceError('INVALID_RPC_ACTION');
      const encoded = json(request), hash = sha256(encoded);
      if (Buffer.byteLength(encoded) > 270336) throw new WorkspaceError('RPC_ACTION_TOO_LARGE');
      const existing = db.prepare('SELECT * FROM rpc_actions WHERE id=?').get(id);
      if (existing) {
        if (existing.kind !== kind || existing.revision !== revision || existing.request_sha256 !== hash)
          throw new WorkspaceError('OPERATION_CONTENT_CONFLICT', 409);
        return { existing: true, action: decode(existing) };
      }
      db.prepare('INSERT INTO rpc_actions (id,kind,revision,state,request,request_sha256,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, kind, revision, 'RUNNING', encoded, hash, new Date().toISOString());
      return { existing: false, action: action(id) };
    },
    finishAction(id, result, error = null) {
      db.prepare('UPDATE rpc_actions SET state=?,completed_at=?,result=?,error=? WHERE id=? AND state=?')
        .run(error ? 'FAILED' : 'COMPLETE', new Date().toISOString(), result === null ? null : json(result),
          error, operationId(id), 'RUNNING');
      return action(id);
    },
    close() {
      if (closed) return;
      closed = true;
      try { db.close(); } finally { original.close(); }
    },
  };
}

