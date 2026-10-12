// MIT. Upgrade tools share the original native workspace and saved review identities.
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const workspace = { workspace: alias };
const review = { ...workspace, operationId: uuid };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 },
  expectedSnapshot: digest };
const read = { readOnly: true, idempotent: true };
const candidate = { oneOf: [
  { type: 'object', properties: { kind: { const: 'revision' }, id: digest },
    required: ['kind', 'id'], additionalProperties: false },
  { type: 'object', properties: { kind: { const: 'reflection' }, id: uuid, captureSha256: digest },
    required: ['kind', 'id', 'captureSha256'], additionalProperties: false },
] };
export function grpcUpgradeTools(tool) {
  return [
    tool('merchant_grpc_upgrade_reviews', 'Page all original immutable contract-upgrade reviews. Keep the returned snapshot across pages and reopen by the retained operationId.', { ...workspace, ...page }, ['workspace'], read),
    tool('merchant_grpc_upgrade_review', 'Retain a complete native contract/route/example/payment-plan upgrade review against the current saved base. Choose an existing candidate revision or immutable reflected capture, supply the whole merchant plan, and keep the same UUID for recovery. Changed review inputs need a new UUID.', {
      ...review, baseRevision: digest, candidate, plan: { type: 'object' },
      title: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['workspace', 'operationId', 'baseRevision', 'candidate', 'plan', 'title'], { idempotent: true }),
    tool('merchant_grpc_upgrade_open', 'Reopen the original review, exact selected plan, source configuration, adoption or complete field/method/route changes. Large results remain available through the original retained-file transport. Read this same operationId after an interrupted review or adoption.', {
      ...review, section: { type: 'string', enum: ['summary', 'full', 'plan', 'source', 'adoption', 'changes', 'methods', 'routes'] }, ...page,
    }, ['workspace', 'operationId'], read),
    tool('merchant_grpc_upgrade_method', 'Inspect the exact candidate request/response schema inside the retained upgrade, including field numbers, maps, presence, oneofs and stream shape.', {
      ...review, method: { type: 'string', minLength: 1, maxLength: 512 },
    }, ['workspace', 'operationId', 'method'], read),
    tool('merchant_grpc_upgrade_adopt', 'Adopt the exact reviewed candidate and complete merchant plan through the original revision/generation check. The same review digest reopens a completed adoption. Continue the resulting revision through the original channel review, preparation and release tools.', {
      ...review, expectedReviewSha256: digest,
    }, ['workspace', 'operationId', 'expectedReviewSha256'], { idempotent: true }),
    tool('merchant_grpc_upgrade_export', 'Retain four complete receiving files: original review/adoption, base revision, candidate revision or descriptor capture, and selected merchant plan. The original source IDs and review digest bind resumable delivery.', {
      ...review, expectedReviewSha256: digest,
    }, ['workspace', 'operationId', 'expectedReviewSha256'], { idempotent: true }),
  ];
}
