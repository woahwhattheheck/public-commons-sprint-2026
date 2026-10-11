// MIT. Selected-event recovery through the original SF98 outbox and lease.
import { createHash } from 'node:crypto';
import { assertDeliveryLease, withDeliveryLease } from './delivery-lock.mjs';

const identifier = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const problem = (code,status=409) => Object.assign(new Error(code),{code,status});

/** This revision identifies the exact original delivery state, not a second
 * journal or application-level generation. A later exhausted cycle differs. */
export function deliveryRevision(row) {
  if (!identifier(row?.event?.id)) throw problem('DELIVERY_EVENT_INVALID',400);
  return createHash('sha256').update(JSON.stringify({id:row.event.id,state:row.state ?? null})).digest('hex');
}

export async function inspectDelivery(outbox,id) {
  if (!identifier(id) || typeof outbox?.rows !== 'function') throw problem('DELIVERY_EVENT_INVALID',400);
  const row = (await outbox.rows()).find(candidate => candidate.event.id === id);
  if (!row) throw problem('DELIVERY_EVENT_NOT_FOUND',404);
  return {row,revision:deliveryRevision(row)};
}

/** The receiver-workspace controller may pause and await ITS OWN native
 * worker before calling this, then resume that same pinned receiver profile.
 * An unrelated worker keeps its original kernel lease and is never signalled.
 * Only the original notification is requeued; this cannot invoke a payment. */
export async function requeueDelivery(outbox,{id,expectedRevision,lease}) {
  if (!identifier(id) || !identifier(expectedRevision) || typeof outbox?.requeue !== 'function')
    throw problem('DELIVERY_RECOVERY_INPUT_INVALID',400);
  try {
    const recover = async currentLease => {
      await assertDeliveryLease(currentLease,outbox.dir);
      const before = await inspectDelivery(outbox,id);
      if (before.revision !== expectedRevision) throw problem('DELIVERY_STATE_CHANGED');
      if (before.row.state?.state !== 'EXHAUSTED') throw problem('DELIVERY_NOT_EXHAUSTED');
      await outbox.requeue(id);
      const after = await inspectDelivery(outbox,id);
      return {schema:'stellar-forge.sf98.delivery-recovery.v1',id,
        previousRevision:before.revision,revision:after.revision,
        state:after.row.state.state,orderReference:after.row.event.orderReference ?? null,
        recordedAt:after.row.state.at,deliveryAttempted:false,paymentAttempted:false};
    };
    return lease === undefined ? await withDeliveryLease(outbox.dir,recover,{purpose:'requeue'}) : await recover(lease);
  } catch (error) {
    if (error.code === 'SF98_DELIVERY_BUSY') throw problem('DELIVERY_WORKER_ACTIVE');
    throw error;
  }
}
