// MIT. Original tool metadata; provider runtimes load only when selected.


const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuid = { type: 'string', pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };

const sha256 = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const revision = { type: 'integer', minimum: 1 };

const actor = { type: 'string', minLength: 1, maxLength: 1000 };

const instant = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$' };

const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };

const base = { workspace: alias };

const selected = { ...base, adjustmentId: uuid };

const readOnly = { readOnly: true, idempotent: true };

const draft = { ...base, id: uuid, runId: uuid, eventId: sha256,
  kind: { type: 'string', enum: ['CANCELLATION', 'REFUND'] },
  amountAtomic: { type: 'string', pattern: '^[1-9][0-9]{0,38}$' }, effectiveAt: instant,
  reason: { type: 'string', minLength: 1, maxLength: 4000 },
  reference: { type: 'string', maxLength: 1000 }, actor, createdAt: instant };

const requiredDraft = ['workspace', 'runId', 'eventId', 'kind', 'amountAtomic', 'effectiveAt', 'reason', 'actor'];

const adjustmentDefinitions = [
  ['merchant_accounting_adjustment_status', 'Inspect the original merchant adjustment and refund-read inventory. Page all retained requests or jobs; summary includes exact counts and the newest ten of each. No payment or RPC starts.', { ...base, view: { type: 'string', enum: ['summary', 'adjustments', 'jobs'] }, ...page }, ['workspace'], readOnly],
  ['merchant_accounting_adjustment_events', 'Page the selected original reconciliation with its canonical gross, pending, cancelled and independently verified returned amounts. Keeps original payment identity and date meanings.', { ...base, runId: uuid, search: { type: 'string', maxLength: 500 }, ...page }, ['workspace', 'runId'], readOnly],
  ['merchant_accounting_adjustment_event', 'Review one original payment, its original proof identity, return direction, canonical available amount and retained adjustment requests. Page those original requests without altering the gross row.', { ...base, runId: uuid, eventId: sha256, ...page }, ['workspace', 'runId', 'eventId'], readOnly],
  ['merchant_accounting_adjustment_preview', 'Preview a dated cancellation or refund request against the original payment and current adjustment capacity. Retain the returned normalized request, previewSha256 and workspaceRevision for record. This does not submit a transaction.', draft, requiredDraft, readOnly],
  ['merchant_accounting_adjustment_record', 'Save the exact reviewed normalized request. Carry id, createdAt, reference, previewSha256 and revision from its preview unchanged. The original UUID reconciles an identical lost reply and preserves earlier history.', { ...draft, revision, previewSha256: sha256 }, [...requiredDraft, 'id', 'createdAt', 'reference', 'revision', 'previewSha256'], { idempotent: true }],
  ['merchant_accounting_adjustment', 'Inspect the selected original adjustment, payment and file identities. Page its dated history or saved verification jobs. Verified returned amounts and original gross remain the native controller values.', { ...selected, view: { type: 'string', enum: ['summary', 'history', 'jobs'] }, ...page }, ['workspace', 'adjustmentId'], readOnly],
  ['merchant_accounting_adjustment_verify', 'Ask the original SF86 reader to verify an already executed reverse-transfer transaction for this saved refund. Uses the original payment network and host transport, saves its job before reading, and never signs or submits a transaction. Inspect retained jobs after a lost reply before explicitly retrying a failed read.', { ...selected, revision, actor, transaction: sha256 }, ['workspace', 'adjustmentId', 'revision', 'actor', 'transaction'], { openWorld: true }],
  ['merchant_accounting_adjustment_job', 'Reconcile one retained native refund-read job, including a saved result from an interrupted caller. This reads its original persisted proof and does not start another RPC verification.', { ...base, jobId: uuid }, ['workspace', 'jobId'], { idempotent: true }],
  ['merchant_accounting_adjustment_withdraw', 'Withdraw an unverified refund request with the original operator and reason after its native read has stopped. Keeps the original payment, prior request and complete history. A verified returned transfer cannot be withdrawn.', { ...selected, revision, actor, reason: { type: 'string', minLength: 1, maxLength: 4000 } }, ['workspace', 'adjustmentId', 'revision', 'actor', 'reason'], { idempotent: true }],
];

export { adjustmentDefinitions, base, page, readOnly, uuid, sha256, draft, requiredDraft, revision, selected, actor, alias, instant };
