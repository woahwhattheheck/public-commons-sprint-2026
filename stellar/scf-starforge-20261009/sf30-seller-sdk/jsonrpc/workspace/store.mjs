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
        WHERE state='RUNNING';`);
  } catch (cause) { db?.close(); original.close(); throw cause; }
  const action = id => decode(db.prepare('SELECT * FROM rpc_actions WHERE id=?').get(operationId(id)));
  let closed = false;
  return {
    ...original, action,
    actions({ before = null, limit = 50 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || before !== null &&
          (typeof before !== 'string' || before.length > 130 || !/^\d{4}-\d\d-\d\dT[0-9:.]+Z\|[a-z][a-z0-9-]{7,79}$/.test(before)))
        throw new WorkspaceError('INVALID_HISTORY_PAGE');
      const [timestamp, id] = before === null ? [null, null] : before.split('|');
      const rows = db.prepare('SELECT * FROM rpc_actions WHERE (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(timestamp, timestamp, timestamp, id, limit + 1);
      return { items: rows.slice(0, limit).map(decode),
        next: rows.length > limit ? rows[limit - 1].created_at + '|' + rows[limit - 1].id : null };
    },
    beginAction({ id, kind, revision, request }) {
      operationId(id); revisionNumber(revision);
      if (!['diagnose', 'buyer', 'start'].includes(kind)) throw new WorkspaceError('INVALID_RPC_ACTION');
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
