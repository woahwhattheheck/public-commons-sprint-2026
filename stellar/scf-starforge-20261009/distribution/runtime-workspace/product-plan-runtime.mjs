// MIT. Saved product and installed-runtime selection over the original workspace.
export const PRODUCT_PLAN_RUNTIMES_SCHEMA = 'stellar-forge.product-plan-runtimes.v1';
export const PRODUCT_PLAN_HANDOFF_SCHEMA = 'stellar-forge.product-plan-handoff.v1';
const list = value => Array.isArray(value) ? value : [];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const HASH = /^[a-f0-9]{64}$/;
const need = (value, code, message) => {
  if (!value) throw Object.assign(new TypeError(message), { code });
};
const select = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));

export function selectedProductPlanBuild(view, { builds } = {}) {
  need(plain(view) && view.plan?.schema === 'stellar-forge.runtime-product-plan.v1',
    'PRODUCT_PLAN_REQUIRED', 'Open the saved product plan.');
  const origin = list(view.origins).find(item => item.originId === view.bindingId && item.local);
  need(origin && origin.workspaceId === view.workspaceId && origin.review?.reviewId === view.review?.reviewId &&
    origin.review?.requestId === view.buildRequest?.requestId &&
    origin.review?.sourceCommit === view.plan.intent.sourceCommit,
  'PRODUCT_PLAN_LOCAL_REVIEW_REQUIRED', 'Open the original local review for this saved product.');
  if (builds !== undefined) need(Array.isArray(builds), 'PRODUCT_PLAN_BUILDS_INVALID', 'Use the original source-build list.');
  const build = builds === undefined ? origin.currentBuild ?? null :
    builds.find(item => item.reviewId === origin.review.reviewId && item.requestId === origin.review.requestId) ?? null;
  if (build) need(build.reviewId === origin.review.reviewId && build.requestId === origin.review.requestId &&
    build.sourceCommit === view.plan.intent.sourceCommit && build.selectionSha256 === origin.review.selectionSha256,
  'PRODUCT_PLAN_BUILD_MISMATCH', 'Use the build retained by this plan’s original source review.');
  return build;
}

/** Cheap live projection; the original installer checks readiness when a handoff is opened. */
export function productPlanRuntimes(view, state, { builds } = {}) {
  need(state?.workspaceId === view.workspaceId, 'PRODUCT_PLAN_WORKSPACE_MISMATCH',
    'Open runtimes from this plan’s current workspace.');
  const build = selectedProductPlanBuild(view, { builds });
  const result = { schema: PRODUCT_PLAN_RUNTIMES_SCHEMA, workspaceId: view.workspaceId,
    planId: view.plan.planId, bindingId: view.bindingId, sourceCommit: view.plan.intent.sourceCommit,
    selection: view.plan.intent.selection, reviewId: view.review.reviewId, requestId: view.review.requestId,
    build: build ? { phase: build.phase, archiveId: build.archiveId ?? null,
      archive: build.archive ? { ...build.archive } : null } : null, runtimes: [] };
  const archiveSha256 = build?.archive?.sha256;
  if (!HASH.test(archiveSha256 ?? '')) return result;
  const entries = new Map(list(state.runtimes).map(item => [item.id, item]));
  const operations = list(state.operations), relatedByRuntime = new Map(), recoveries = new Map();
  for (const job of operations) {
    for (const id of new Set([job.runtimeId, job.targetId].filter(Boolean))) {
      if (!relatedByRuntime.has(id)) relatedByRuntime.set(id, []);
      relatedByRuntime.get(id).push(job);
    }
    if (job.operation === 'recover' && job.runtimeId && job.targetId) {
      if (!recoveries.has(job.runtimeId)) recoveries.set(job.runtimeId, []);
      recoveries.get(job.runtimeId).push(job);
    }
  }
  const candidates = new Map();
  const add = (runtimeId, via = null) => {
    if (!runtimeId || candidates.has(runtimeId)) return false;
    const item = entries.get(runtimeId);
    if (item?.archiveSha256 && item.archiveSha256 !== archiveSha256) return false;
    if (item?.sourceCommit && item.sourceCommit !== view.plan.intent.sourceCommit) return false;
    if (!item && !via) return false;
    candidates.set(runtimeId, { item: item ?? { id: runtimeId, label: via.name ?? runtimeId,
      directory: via.targetDirectory ?? null, phase: 'UNAVAILABLE' }, via });
    return true;
  };
  for (const item of entries.values()) if (item.archiveSha256 === archiveSha256) add(item.id);
  // Retained preparation requests expose the exact selected archive even before extraction.
  for (const job of operations) if (['prepare', 'upgrade'].includes(job.operation) &&
    job.archiveSha256 === archiveSha256 && job.targetId) add(job.targetId, job);
  // The existing recover operation retains its original source runtime and immutable target.
  const pending = [...candidates.keys()];
  for (let index = 0; index < pending.length; index++) {
    for (const job of recoveries.get(pending[index]) ?? [])
      if (add(job.targetId, job)) pending.push(job.targetId);
  }
  result.runtimes = [...candidates].map(([runtimeId, { item, via }]) => {
    const related = (relatedByRuntime.get(runtimeId) ?? [])
      .map(job => select(job, ['id', 'operation', 'runtimeId', 'targetId', 'phase', 'displayPhase',
        'workerActive', 'createdAt', 'updatedAt', 'completedAt', 'profileId']))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.id.localeCompare(b.id));
    return { runtimeId, label: item.label, directory: item.directory, phase: item.phase,
      sourceCommit: item.sourceCommit ?? null, packageVersion: item.packageVersion ?? null,
      profileId: item.profileId ?? via?.profileId ?? null, archiveSha256,
      installationId: item.state?.installationId ?? null,
      ...(item.error?.code ? { errorCode: item.error.code } : {}),
      ...(item.preparationError?.code ? { preparationErrorCode: item.preparationError.code } : {}),
      operations: related };
  }).sort((a, b) => String(a.label).localeCompare(String(b.label), 'en') || a.runtimeId.localeCompare(b.runtimeId));
  return result;
}

/** Attach the original native handoff to one exact saved plan and selected installation. */
export function productPlanHandoff(view, { runtime, installation, inspection, handoff, generatedAt = new Date().toISOString() }) {
  const build = selectedProductPlanBuild(view);
  need(HASH.test(build?.archive?.sha256 ?? ''),
    'PRODUCT_PLAN_PACKAGED_BUILD_REQUIRED', 'Build the saved product package before selecting its installed runtime.');
  need(installation?.archiveSha256 === build.archive.sha256 &&
    installation.source?.sourceCommit === view.plan.intent.sourceCommit &&
    installation.source?.packageName === view.review.packageName &&
    installation.source?.packageVersion === view.review.packageVersion,
  'PRODUCT_PLAN_RUNTIME_SOURCE_MISMATCH', 'Choose the installation of this saved plan’s exact original archive.');
  need(runtime?.directory === installation.directory && inspection?.directory === installation.directory &&
    handoff?.directory === installation.directory && handoff.schema === 'stellar-forge.runtime-deployment-handoff.v1' &&
    inspection.ready === true && inspection.status === 'READY' && inspection.sourceVerified === true &&
    inspection.installationId === installation.installationId && handoff.installationId === installation.installationId &&
    inspection.profileId === installation.profileId && handoff.profileId === installation.profileId &&
    inspection.sourceCommit === view.plan.intent.sourceCommit && handoff.sourceCommit === view.plan.intent.sourceCommit &&
    handoff.sourceManifestSha256 === installation.source.manifestSha256 &&
    inspection.lockSha256 === handoff.lockSha256 && inspection.lockMatches === true,
  'PRODUCT_PLAN_RUNTIME_HANDOFF_CHANGED', 'Reopen and inspect the selected original runtime before its handoff.');
  need(typeof generatedAt === 'string' && !Number.isNaN(Date.parse(generatedAt)),
    'PRODUCT_PLAN_HANDOFF_TIME_INVALID', 'Use a valid inspection timestamp.');
  return {
    schema: PRODUCT_PLAN_HANDOFF_SCHEMA, generatedAt, workspaceId: view.workspaceId,
    planId: view.plan.planId, bindingId: view.bindingId,
    sourceCommit: view.plan.intent.sourceCommit, selection: view.plan.intent.selection,
    planContentSha256: view.plan.contentSha256, sourceSha256: view.plan.sourceSha256,
    reviewId: view.review.reviewId, requestId: view.review.requestId,
    selectionSha256: view.review.selectionSha256,
    archive: { ...build.archive, archiveId: build.archiveId ?? null },
    runtime: { runtimeId: runtime.id, label: runtime.label, directory: runtime.directory,
      installationId: installation.installationId, profileId: installation.profileId,
      sourceManifestSha256: installation.source.manifestSha256,
      status: inspection.status, lockSha256: inspection.lockSha256, sourceVerified: true },
    inspection, handoff,
  };
}

/** Customer-visible installation facts; native paths stay in the complete operating handoff. */
export function productPlanInstallationSummary(view, value) {
  const build = selectedProductPlanBuild(view);
  need(value?.schema === PRODUCT_PLAN_HANDOFF_SCHEMA && value.workspaceId === view.workspaceId &&
    value.planId === view.plan.planId && value.bindingId === view.bindingId &&
    value.reviewId === view.review.reviewId && value.requestId === view.review.requestId &&
    value.sourceCommit === view.plan.intent.sourceCommit && value.archive?.sha256 === build?.archive?.sha256 &&
    value.runtime?.sourceVerified === true && value.inspection?.ready === true,
  'PRODUCT_PLAN_BRIEFING_INSTALLATION_MISMATCH', 'Choose the inspected installation for this exact saved product.');
  const groups = list(value.inspection.profile?.dependencies).map(item => ({
    name: item.name, expectedVersion: item.expectedVersion, requested: item.requested,
    ready: item.ready === true, native: item.native ?? null,
    checks: list(item.checks).map(check => ({
      group: check.group, probe: check.probe, version: check.version ?? null, state: check.state,
      importState: check.importState ?? null, importCode: check.importCode ?? null,
      ...(check.native ? { native: { state: check.native.state, kind: check.native.kind } } : {}),
    })),
  }));
  return { observedAt: value.generatedAt,
    ...select(value.runtime, ['runtimeId', 'label', 'installationId', 'profileId', 'sourceManifestSha256',
      'status', 'lockSha256', 'sourceVerified']), archiveSha256: value.archive.sha256,
    dependencies: groups, nativeRequired: value.inspection.profile?.nativeRequired === true,
    loadRequested: value.inspection.profile?.loadRequested === true };
}
