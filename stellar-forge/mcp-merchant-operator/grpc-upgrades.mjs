// MIT. Agent continuation over the original upgrade store and revision writer.
import { collectGrpcUpgrade } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/upgrade-receiving.mjs';

export function grpcUpgradeSummary(value) {
  return { id: value.id, reviewSha256: value.reviewSha256, createdAt: value.createdAt,
    title: value.request.title, baseRevision: value.request.baseRevision,
    candidate: value.candidate, baseSelection: value.baseSelection,
    comparison: value.comparison.summary, routes: value.routes.summary,
    planValidation: value.planValidation, currentSelection: value.currentSelection,
    adoption: value.adoption ?? null, adoptionIntent: value.adoptionIntent ?? null };
}
const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_PARAMS' }); };

/** Context capabilities belong to MerchantGrpcWorkspaces; this module creates no store or listener. */
export async function executeGrpcUpgrade(name, args, context) {
  const original = value => ({ revision: value.request.baseRevision, operationId: value.id,
    reviewSha256: value.reviewSha256, topic: 'contract-upgrade' });
  const readUpgrade = id => context.request('/api/upgrade-open', { id });
  if (name === 'merchant_grpc_upgrade_reviews') {
    const state = await context.state();
    if (!Array.isArray(state.upgrades)) throw Object.assign(new Error('Install the original gRPC contract-upgrade workspace source.'), { code: 'GRPC_UPGRADE_SOURCE_REQUIRED' });
    return { workspace: args.workspace, kind: 'upgrades', ...context.paged(state.upgrades, args) };
  }
  if (name === 'merchant_grpc_upgrade_review') {
    const value = await context.request('/api/upgrade-review', { id: args.operationId,
      baseRevision: args.baseRevision, candidate: args.candidate, plan: args.plan, title: args.title });
    return grpcUpgradeSummary(value);
  }
  if (name === 'merchant_grpc_upgrade_open') {
    const value = await readUpgrade(args.operationId), section = args.section ?? 'summary';
    if (section === 'summary') return grpcUpgradeSummary(value);
    if (section === 'full') return context.bounded(value, original(value));
    if (section === 'plan') return context.bounded({ id: value.id, reviewSha256: value.reviewSha256,
      title: value.request.title, baseRevision: value.request.baseRevision,
      candidate: value.request.candidate, plan: value.request.plan }, original(value));
    if (section === 'source') return context.bounded({ id: value.id, reviewSha256: value.reviewSha256,
      before: value.before, candidate: value.candidate, source: value.source }, original(value));
    if (section === 'adoption') return { id: value.id, reviewSha256: value.reviewSha256,
      baseSelection: value.baseSelection, currentSelection: value.currentSelection,
      adoption: value.adoption ?? null, adoptionIntent: value.adoptionIntent ?? null };
    const rows = section === 'changes' ? value.comparison.changes : section === 'methods'
      ? value.comparison.methods : section === 'routes' ? value.routes.rows : null;
    if (!Array.isArray(rows)) invalid('Choose a declared complete upgrade section.');
    return context.bounded({ id: value.id, reviewSha256: value.reviewSha256, section,
      ...context.paged(rows, args) }, original(value));
  }
  if (name === 'merchant_grpc_upgrade_method') {
    const value = await context.request('/api/upgrade-method', { id: args.operationId, method: args.method });
    return context.bounded(value, { operationId: args.operationId, topic: 'upgrade-method' });
  }
  if (name === 'merchant_grpc_upgrade_adopt') {
    const value = await context.request('/api/upgrade-adopt', { id: args.operationId,
      expectedReviewSha256: args.expectedReviewSha256 });
    return { ...grpcUpgradeSummary(value), revision: context.revisionSummary(value.revision) };
  }
  if (name === 'merchant_grpc_upgrade_export') {
    const payload = await collectGrpcUpgrade({ readUpgrade, readRevision: context.revision,
      readReflection: id => context.request('/api/reflection-open', { id }) },
    args.operationId, args.expectedReviewSha256);
    return context.retain('upgrade', payload.original, payload.sources);
  }
  invalid('Choose an installed original gRPC upgrade operation.');
}
