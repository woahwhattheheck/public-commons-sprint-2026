// SPDX-License-Identifier: MIT
// Generated from the complete current evaluation_fence.mjs by the composer.
import {claimStaleEvaluation} from './evaluation_fence.mjs';
import {ensureProjectionRecoverySchema,ACTIVE_INCIDENT_PREDICATE} from './branch_projection_recovery.mjs';

/** Internal durable-state choice. Callers supply the original fence options. */
export async function claimBranchProjectionStaleEvaluation(env, options) {
  await ensureProjectionRecoverySchema(env.DB);
  const recovered=await env.DB.prepare(
    "SELECT 1 AS present FROM publication_projection_recovery p JOIN ops o ON o.op_id=p.operation_id "+
    "WHERE o.op_id=? AND o.digest=? AND p.original_digest=o.digest "+
    "AND p.projection_version='branch-publication-content/v1' LIMIT 1"
  ).bind(options.operationId,options.digest).first();
  if(!recovered)return claimStaleEvaluation(env,options);
  return claimRecoveredStaleEvaluation(env,options);
}

// The full current fence module follows. The recovered claim changes only its
// name and the exact incident predicate; all other source is retained.
// Same-operation recovery for classifier calls that outlive a client timeout.
// Every claim is bound to the immutable operation digest and observed row
// version. A new token fences every later state transition and provider send.
export const EVALUATION_STALE_MS = 15 * 60 * 1000;
export const EVALUATION_LOCK_MS = 10 * 60 * 1000;

const run = (env, sql, ...values) => env.DB.prepare(sql).bind(...values).run();

async function claimRecoveredStaleEvaluation(env, {
  operationId, digest, observedUpdatedAt, observedEvaluationToken = null, attemptToken, resource = null,
  timestamp = Date.now(), staleBefore = timestamp - EVALUATION_STALE_MS,
}) {
  if (!operationId || !digest || !attemptToken
      || !Number.isSafeInteger(observedUpdatedAt)
      || observedUpdatedAt > staleBefore) return false;

  const update = env.DB.prepare(`UPDATE ops SET evaluation_token=?,write_generation=write_generation+1,updated_at=?
    WHERE op_id=? AND digest=? AND evaluation_token IS ?
      AND state='EVALUATING' AND result IS NULL
      AND response_status IS NULL AND updated_at=? AND updated_at<=?
      AND ${ACTIVE_INCIDENT_PREDICATE}${resource
        ? ` AND NOT EXISTS (SELECT 1 FROM locks WHERE resource=? AND expires_at>=?)` : ''}`)
    .bind(attemptToken, timestamp, operationId, digest, observedEvaluationToken, observedUpdatedAt, staleBefore,
      operationId, ...(resource ? [resource, timestamp] : []));

  if (!resource) {
    const result = await update.run();
    return result.meta.changes === 1;
  }

  // D1 batch is transactional. The token CAS and lock acquisition are one
  // unit; competing reclaimers cannot both become the current evaluator.
  const purge = env.DB.prepare('DELETE FROM locks WHERE resource=? AND expires_at<?')
    .bind(resource, timestamp);
  const acquire = env.DB.prepare(`INSERT OR IGNORE INTO locks(resource,op_id,expires_at)
    SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM ops WHERE op_id=? AND digest=?
      AND state='EVALUATING' AND evaluation_token=? AND updated_at=?)`)
    .bind(resource, attemptToken, timestamp + EVALUATION_LOCK_MS,
      operationId, digest, attemptToken, timestamp);
  const [, claimed, locked] = await env.DB.batch([purge, update, acquire]);
  return claimed.meta.changes === 1 && locked.meta.changes === 1;
}

export async function fencedTransition(env, {
  operationId, digest, attemptToken, from = 'EVALUATING', to,
  timestamp = Date.now(), resource = null,
}) {
  const allowedFrom = Array.isArray(from) ? from : [from];
  if (!to || !allowedFrom.length || allowedFrom.some(state => !/^[A-Z_]+$/u.test(state))) return false;
  const placeholders = allowedFrom.map(() => '?').join(',');
  const lock = resource
    ? ` AND EXISTS (SELECT 1 FROM locks WHERE resource=? AND op_id=? AND expires_at>=?)` : '';
  const result = await run(env, `UPDATE ops SET state=?,write_generation=write_generation+1,updated_at=? WHERE op_id=? AND digest=?
    AND evaluation_token=? AND state IN (${placeholders})${lock}`,
  to, timestamp, operationId, digest, attemptToken, ...allowedFrom,
  ...(resource ? [resource, attemptToken, timestamp] : []));
  return result.meta.changes === 1;
}

export async function fencedFinish(env, {
  operationId, digest, attemptToken, state, result, status = 200,
  timestamp = Date.now(), from = ['EVALUATING', 'DISPATCHING'],
}) {
  const allowedFrom = Array.isArray(from) ? from : [from];
  const placeholders = allowedFrom.map(() => '?').join(',');
  const saved = await run(env, `UPDATE ops SET state=?,result=?,response_status=?,write_generation=write_generation+1,updated_at=?
    WHERE op_id=? AND digest=? AND evaluation_token=? AND state IN (${placeholders})`,
  state, JSON.stringify(result), status, timestamp, operationId, digest, attemptToken, ...allowedFrom);
  return saved.meta.changes === 1;
}

export async function releaseEvaluationLock(env, {resource, attemptToken}) {
  const result = await run(env,
    'DELETE FROM locks WHERE resource=? AND op_id=?', resource, attemptToken);
  return result.meta.changes === 1;
}

export function evaluationToken() {
  return crypto.randomUUID();
}

