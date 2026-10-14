// SPDX-License-Identifier: MIT
import { proveLegacyBranchProjection } from './branch_projection.mjs';

// Original incident rows and their notification status are never changed.
export const PROJECTION_RECOVERY_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS publication_projection_recovery (',
  'operation_id TEXT NOT NULL, incident_id TEXT NOT NULL, original_digest TEXT NOT NULL,',
  'original_result TEXT NOT NULL, incident_content TEXT NOT NULL, incident_destination TEXT NOT NULL,',
  'projection_version TEXT NOT NULL, binding TEXT NOT NULL, attempt_token TEXT NOT NULL, recovered_at INTEGER NOT NULL,',
  'PRIMARY KEY (operation_id, incident_id))'
].join('\n');

/** This predicate is used inside the existing atomic retry UPDATE on ops. */
export const ACTIVE_INCIDENT_PREDICATE = [
  'NOT EXISTS (SELECT 1 FROM incidents i WHERE i.op_id=? AND NOT EXISTS (',
  'SELECT 1 FROM publication_projection_recovery p',
  'WHERE p.operation_id=i.op_id AND p.incident_id=i.id',
  'AND p.original_digest=ops.digest',
  'AND p.incident_content=i.content AND p.incident_destination=i.destination',
  "AND p.projection_version='branch-publication-content/v1'))"
].join('\n');

const schemaReady=new WeakMap();
export async function ensureProjectionRecoverySchema(db) {
  if(!schemaReady.has(db)) {
    const ready=Promise.resolve().then(()=>db.prepare(PROJECTION_RECOVERY_SCHEMA).run());
    schemaReady.set(db,ready);
    ready.catch(()=>schemaReady.delete(db));
  }
  await schemaReady.get(db);
}

/**
 * Uses one existing D1 transaction: insert immutable recovery history and claim
 * exactly the observed original row. The same request digest and operation ID
 * continue through ordinary ownership, economics, lease, and dispatch fencing.
 */
export async function claimBranchProjectionRecovery(db,{input,actor,path,row,incident,operation,attemptToken,timestamp}) {
  const proof=proveLegacyBranchProjection({input,actor,path,row,incident,operation});
  if(!proof || typeof attemptToken!=='string' || attemptToken.length<8
      || !Number.isSafeInteger(timestamp) || timestamp<0) return false;
  await ensureProjectionRecoverySchema(db);
  const unchanged=[
    "op_id=? AND digest=? AND state='BLOCKED_INCIDENT'",
    'AND response_status=403 AND result=? AND updated_at=?',
    'AND evaluation_token IS ? AND write_generation=?',
    'AND (SELECT COUNT(*) FROM incidents WHERE op_id=ops.op_id)=1',
    "AND EXISTS (SELECT 1 FROM incidents i WHERE i.op_id=ops.op_id AND i.id=? AND i.reason='self_fault_admission'",
    'AND i.content=? AND i.destination=?)'
  ].join('\n');
  const guard=[row.op_id,row.digest,row.result,row.updated_at,row.evaluation_token,
    row.write_generation,incident.id,incident.content,incident.destination];
  const insert=db.prepare(
    'INSERT OR IGNORE INTO publication_projection_recovery '+
    '(operation_id,incident_id,original_digest,original_result,incident_content,incident_destination,'+
    'projection_version,binding,attempt_token,recovered_at) '+
    'SELECT ?,?,?,?,?,?,?,?,?,? FROM ops WHERE '+unchanged
  ).bind(proof.operation_id,proof.incident_id,proof.original_digest,proof.original_result,
      proof.incident_content,proof.incident_destination,proof.version,JSON.stringify(proof.binding),
      attemptToken,timestamp,...guard);
  const update=db.prepare(
    "UPDATE ops SET state='EVALUATING',result=NULL,response_status=NULL,evaluation_token=?,"+
    'write_generation=write_generation+1,updated_at=? WHERE '+unchanged+
    ' AND EXISTS (SELECT 1 FROM publication_projection_recovery p '+
    'WHERE p.operation_id=ops.op_id AND p.incident_id=? AND p.original_digest=ops.digest '+
    'AND p.original_result=ops.result AND p.attempt_token=?)'
  ).bind(attemptToken,timestamp,...guard,incident.id,attemptToken);
  const returned=await db.batch([insert,update]);
  return Array.isArray(returned) && returned.length===2
    && Number(returned[1]?.meta?.changes)===1;
}
