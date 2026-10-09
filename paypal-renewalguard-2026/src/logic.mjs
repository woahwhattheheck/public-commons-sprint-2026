// RenewalGuard: pure, PII-free subscription triage. No payment or send actions.
import { createHash } from 'node:crypto';

const STATUSES = new Set(['APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED']);
const SUB_ID = /^I-[A-Z0-9]{6,40}$/;
export function validId(id) { return typeof id === 'string' && SUB_ID.test(id); }

export function summarize(record) {
  if (!record || !validId(record.id)) throw new Error('Invalid subscription identifier');
  const status = typeof record.status === 'string' ? record.status.toUpperCase() : '';
  if (!STATUSES.has(status)) throw new Error('Unknown subscription status; manual review required');
  const failure = record.billing_info?.last_failed_payment;
  const failedAt = typeof failure?.time === 'string' ? failure.time : null;
  const nextAt = typeof record.billing_info?.next_billing_time === 'string'
    ? record.billing_info.next_billing_time : null;
  const updatedAt = typeof record.status_update_time === 'string' ? record.status_update_time : null;
  const basis = {
    subscription_id: record.id, status, plan_id: String(record.plan_id || ''),
    last_failed_at: failedAt, next_billing_at: nextAt, status_updated_at: updatedAt,
  };
  // No subscriber identity, payer, payment instrument or amount enters this receipt.
  const fingerprint = createHash('sha256').update(JSON.stringify(basis)).digest('hex');
  let tier = 'REVIEW', rationale = 'Subscription status requires human follow-up';
  if (status === 'ACTIVE' && !failedAt) {
    tier = 'LOW'; rationale = 'Active without a disclosed last failed payment';
  } else if (status === 'ACTIVE' && failedAt) {
    tier = 'ATTENTION'; rationale = 'Active, but a last failed payment is reported';
  } else if (status === 'SUSPENDED') {
    tier = 'HIGH'; rationale = 'Subscription suspended; verify cause before contacting customer';
  } else if (status === 'CANCELLED' || status === 'EXPIRED') {
    tier = 'CLOSED'; rationale = 'Subscription is no longer active; no automated outreach';
  }
  return { ...basis, fingerprint, tier, rationale,
    data_source: 'subscription_snapshot', outreach_permitted: false, money_action_permitted: false };
}

export const DEMO = Object.freeze([
  { id:'I-DEMOACTIVE1', status:'ACTIVE', plan_id:'P-EXAMPLE-A', status_update_time:'2026-10-01T10:00:00Z',
    billing_info:{next_billing_time:'2026-11-01T10:00:00Z'} },
  { id:'I-DEMOSUSPEND1', status:'SUSPENDED', plan_id:'P-EXAMPLE-B', status_update_time:'2026-10-07T10:00:00Z',
    billing_info:{last_failed_payment:{time:'2026-10-06T10:00:00Z'}} },
  { id:'I-DEMOCANCEL1', status:'CANCELLED', plan_id:'P-EXAMPLE-C', status_update_time:'2026-09-30T10:00:00Z', billing_info:{} },
]);
