// MIT. Retained upgrade decisions over the original workspace writer and revision APIs.
import { join } from 'node:path';
import { compareGrpcContracts } from '../contract-upgrade.mjs';
import { compileProtoSource } from '../proto.mjs';
import { compileGrpcMerchantPlan } from '../prepare.mjs';
import { normalizeGrpcRequest, serializeGrpcRequest, grpcMethodSchema } from '../values.mjs';
import { validateGrpcConfig } from '../config.mjs';
import { prepareGrpcInput, grpcOperationSchema } from '../request-series.mjs';
import { atomicJson } from '../../../sf46-release/release-core.mjs';
import { canonical, sha256, fields, text, fail, jsonBytes, readJson, writeJsonSnapshot } from '../common.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const REPORT_LIMIT = 8388608;
const INDEX_LIMIT = 1048576;
const PLAN_LIMIT = 262144;
const stamp = () => new Date().toISOString();
const clone = value => structuredClone(value);
const id = (value, expression = SHA) => {
  if (typeof value !== 'string' || !expression.test(value)) fail('GRPC_UPGRADE_IDENTIFIER_INVALID');
  return value;
};
const errorView = issue => ({ code: issue.code ?? 'GRPC_UPGRADE_PLAN_INVALID',
  field: issue.field_path ?? issue.field ?? null, message: issue.message ?? String(issue) });
async function optional(path, cap) {
  try { return await readJson(path, cap); } catch (issue) { if (issue.code === 'ENOENT') return null; throw issue; }
}
function candidateValue(value) {
  if (value?.kind === 'revision') {
    fields(value, ['kind', 'id'], 'GRPC_UPGRADE_CANDIDATE_INVALID');
    return { kind: 'revision', id: id(value.id) };
  }
  if (value?.kind === 'reflection') {
    fields(value, ['kind', 'id', 'captureSha256'], 'GRPC_UPGRADE_CANDIDATE_INVALID');
    return { kind: 'reflection', id: id(value.id, UUID), captureSha256: id(value.captureSha256) };
  }
  fail('GRPC_UPGRADE_CANDIDATE_REQUIRED');
}
function planValue(value) {
  fields(value, ['schema', 'publicOrigin', 'payment', 'paymentOptions', 'routes'], 'GRPC_UPGRADE_PLAN_INVALID');
  if (value.schema !== 'stellar-forge.grpc-merchant-plan.v1' || !Array.isArray(value.routes) ||
      value.routes.length > 64) fail('GRPC_UPGRADE_PLAN_INVALID');
  jsonBytes(value, PLAN_LIMIT);
  return clone(value);
}
function requestValue(value) {
  fields(value, ['id', 'baseRevision', 'candidate', 'plan', 'title'], 'GRPC_UPGRADE_REVIEW_FIELDS_INVALID');
  return { id: id(value.id, UUID), baseRevision: id(value.baseRevision),
    candidate: candidateValue(value.candidate), plan: planValue(value.plan),
    title: text(value.title, 'GRPC_WORKSPACE_TITLE_REQUIRED', 120) };
}
function documentDigest(value) {
  const { reviewSha256, ...document } = value;
  return sha256(canonical(document));
}
function sameSelection(a, b) {
  return a?.revision === b?.revision && a?.generation === b?.generation;
}
function terms(plan, route) {
  const selected = Object.hasOwn(route, 'payment') || Object.hasOwn(route, 'paymentOptions') ? route : plan;
  if (Object.hasOwn(selected, 'payment')) return [clone(selected.payment)];
  return Object.hasOwn(selected, 'paymentOptions') ? clone(selected.paymentOptions) : [];
}
function routeIdentity(plan, route) {
  return { id: route.id, path: route.path ?? null, method: route.grpcMethod ?? null,
    publicOrigin: plan.publicOrigin ?? null, paymentOptions: terms(plan, route),
    serviceName: route.serviceName ?? null, description: route.description ?? null, tags: clone(route.tags ?? []) };
}
function compilePlan(contract, source, plan) {
  try {
    if (!plan.routes.length) fail('GRPC_SELECT_AT_LEAST_ONE_SINGLE_REQUEST_METHOD');
    const compiled = compileGrpcMerchantPlan(contract, plan, { limits: source.limits });
    return { valid: true, compiled, error: null };
  } catch (issue) {
    return { valid: false, compiled: null, error: errorView(issue) };
  }
}
function requestCheck(contract, method, input, limits) {
  try {
    const selected = contract.methods[method];
    if (!selected || selected.requestStream && !limits.requestStream) fail('GRPC_APPROVED_SINGLE_REQUEST_METHOD_REQUIRED');
    if (selected.responseStream && !limits.stream) fail('GRPC_STREAM_LIMITS_REQUIRED');
    if (selected.requestStream) {
      const prepared = prepareGrpcInput(contract, method, input, { limits });
      const json = Buffer.from(JSON.stringify(prepared.value));
      // A framed list of original protobuf hashes preserves message boundaries.
      const wireMessages = prepared.messages.map(value => {
        const wire = serializeGrpcRequest(contract, method, value);
        return { bytes: wire.length, sha256: sha256(wire) };
      });
      return { accepted: true, jsonBytes: json.length, jsonSha256: sha256(json),
        wireBytes: prepared.requestBytes, wireSha256: sha256(canonical(wireMessages)),
        wireEncoding: 'ordered-protobuf-message-sha256-v1', requestMessages: wireMessages.length, error: null };
    }
    const value = normalizeGrpcRequest(contract, method, input);
    const json = Buffer.from(JSON.stringify(value));
    if (json.length > limits.maxJsonRequestBytes) fail('GRPC_JSON_REQUEST_TOO_LARGE', 413);
    const wire = serializeGrpcRequest(contract, method, value);
    if (wire.length > limits.maxRequestBytes) fail('GRPC_REQUEST_TOO_LARGE', 413);
    return { accepted: true, jsonBytes: json.length, jsonSha256: sha256(json),
      wireBytes: wire.length, wireSha256: sha256(wire), error: null };
  } catch (issue) { return { accepted: false, error: errorView(issue) }; }
}
function schemaIdentity(contract, method) {
  const selected = contract.methods[method];
  if (!selected) return null;
  const value = grpcMethodSchema(contract, method);
  return { requestType: selected.requestType, responseType: selected.responseType,
    requestStream: Boolean(selected.requestStream), responseStream: Boolean(selected.responseStream),
    requestSha256: sha256(canonical(value.request)), responseSha256: sha256(canonical(value.response)) };
}
function routeReview(before, after, plan, diff) {
  const previous = new Map(before.plan.routes.map(route => [route.id, route]));
  const proposed = new Map();
  const invalidIds = [];
  for (let index = 0; index < plan.routes.length; index++) {
    const route = plan.routes[index];
    if (!route || typeof route !== 'object' || Array.isArray(route) ||
        typeof route.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(route.id) || proposed.has(route.id)) {
      invalidIds.push({ index, error: 'GRPC_ROUTE_ID_INVALID' }); continue;
    }
    proposed.set(route.id, route);
  }
  const methods = new Map(diff.methods.map(method => [method.path, method]));
  const rows = [...new Set([...previous.keys(), ...proposed.keys()])].sort().map(key => {
    const old = previous.get(key), next = proposed.get(key);
    const beforeRoute = old ? routeIdentity(before.plan, old) : null;
    const afterRoute = next ? routeIdentity(plan, next) : null;
    const sourceMethod = old?.grpcMethod ?? next?.grpcMethod ?? null;
    const candidateMethod = next?.grpcMethod ?? old?.grpcMethod ?? null;
    const comparison = methods.get(candidateMethod);
    const oldSchema = old ? schemaIdentity(before.contract, old.grpcMethod) : null;
    const nextSchema = next ? schemaIdentity(after.contract, next.grpcMethod) : null;
    return { id: key, status: !old ? 'added' : !next ? 'removed' : 'retained',
      before: beforeRoute, after: afterRoute,
      publicPathChanged: Boolean(old && next && (old.path !== next.path || before.plan.publicOrigin !== plan.publicOrigin)),
      methodChanged: Boolean(old && next && old.grpcMethod !== next.grpcMethod),
      paymentChanged: Boolean(old && next && canonical(beforeRoute.paymentOptions) !== canonical(afterRoute.paymentOptions)),
      beforeContract: oldSchema, afterContract: nextSchema,
      requestContractChanged: Boolean(oldSchema && nextSchema && oldSchema.requestSha256 !== nextSchema.requestSha256),
      responseContractChanged: Boolean(oldSchema && nextSchema && oldSchema.responseSha256 !== nextSchema.responseSha256),
      sourceExampleOnCandidate: old ? requestCheck(after.contract, candidateMethod, old.example, after.source.limits) : null,
      selectedExample: next ? requestCheck(after.contract, next.grpcMethod, next.example, after.source.limits) : null,
      beforeExampleSha256: old ? sha256(canonical(old.example)) : null,
      selectedExampleSha256: next && next.example !== undefined ? sha256(canonical(next.example)) : null,
      requestChanges: comparison?.requestChanges ?? [], responseChanges: comparison?.responseChanges ?? [],
      sourceMethod, candidateMethod };
  });
  return { rows, invalidIds,
    summary: { total: rows.length, added: rows.filter(row => row.status === 'added').length,
      removed: rows.filter(row => row.status === 'removed').length,
      paymentChanges: rows.filter(row => row.paymentChanged).length,
      pathChanges: rows.filter(row => row.publicPathChanged).length,
      methodChanges: rows.filter(row => row.methodChanged).length,
      sourceExamplesRejected: rows.filter(row => row.sourceExampleOnCandidate?.accepted === false).length,
      selectedExamplesRejected: rows.filter(row => row.selectedExample?.accepted === false).length } };
}

/** All mutating methods are called inside the ORIGINAL model's execute/lease. */
export function createGrpcUpgradeWorkspace({ directory, selection, loadRevision, loadReflection,
  saveRevision, visibleRevision }) {
  let index = [];
  const reportPath = value => join(directory, id(value, UUID) + '.json');
  const intentPath = value => join(directory, id(value, UUID) + '.adopt.json');
  const resultPath = value => join(directory, id(value, UUID) + '.result.json');
  async function resolveCandidate(selected) {
    selected = candidateValue(selected);
    if (selected.kind === 'revision') {
      const retained = await loadRevision(selected.id);
      return { source: retained.source, protoSource: retained.protoSource, contract: retained.contract,
        identity: { kind: 'revision', id: retained.id, protoSha256: retained.protoSource.sha256,
          sourceSha256: sha256(canonical(retained.source)) } };
    }
    const retained = await loadReflection(selected.id);
    if (retained.captureSha256 !== selected.captureSha256) fail('GRPC_REFLECTION_CAPTURE_CHANGED', 409);
    const source = validateGrpcConfig(retained.request.source), contract = compileProtoSource(retained.protoSource);
    return { source, protoSource: contract.source, contract,
      identity: { kind: 'reflection', id: retained.id, captureSha256: retained.captureSha256,
        protoSha256: contract.source.sha256, sourceSha256: sha256(canonical(source)) } };
  }
  async function remember(report) {
    const item = { id: report.id, createdAt: report.createdAt, title: report.request.title,
      baseRevision: report.request.baseRevision, candidate: report.request.candidate,
      protoSha256: report.candidate.protoSha256, reviewSha256: report.reviewSha256,
      readyToAdopt: report.planValidation.valid, routeCount: report.request.plan.routes.length };
    const found = index.find(row => row.id === report.id);
    if (found) {
      if (canonical(found) !== canonical(item)) fail('GRPC_UPGRADE_INDEX_CHANGED', 409);
      return;
    }
    const next = [...index, item]; jsonBytes(next, INDEX_LIMIT);
    await atomicJson(join(directory, 'index.json'), next); index = next;
  }
  async function readReport(value) {
    const report = await readJson(reportPath(value), REPORT_LIMIT);
    if (report.schema !== 'stellar-forge.grpc-workspace-upgrade.v1' || report.id !== value ||
        report.request.id !== value || report.requestSha256 !== sha256(canonical(report.request)) ||
        report.reviewSha256 !== documentDigest(report)) fail('GRPC_UPGRADE_REVIEW_CHANGED', 409);
    requestValue(report.request);
    const before = await loadRevision(report.request.baseRevision), after = await resolveCandidate(report.request.candidate);
    if (before.protoSource.sha256 !== report.before.protoSha256 ||
        sha256(canonical(before.source)) !== report.before.sourceSha256 ||
        canonical(after.identity) !== canonical(report.candidate)) fail('GRPC_UPGRADE_SOURCE_CHANGED', 409);
    return { report, before, after };
  }
  async function currentResult(report) {
    const result = await optional(resultPath(report.id), 65536);
    if (result && (result.schema !== 'stellar-forge.grpc-upgrade-adoption.v1' ||
        result.id !== report.id || result.reviewSha256 !== report.reviewSha256 ||
        typeof result.completedAt !== 'string')) fail('GRPC_UPGRADE_ADOPTION_CHANGED', 409);
    const intent = await optional(intentPath(report.id), 65536);
    if (intent && (intent.schema !== 'stellar-forge.grpc-upgrade-adopt-intent.v1' ||
        intent.id !== report.id || intent.reviewSha256 !== report.reviewSha256))
      fail('GRPC_UPGRADE_ADOPTION_CHANGED', 409);
    return { result, intent };
  }
  async function visible(report) {
    const { result, intent } = await currentResult(report);
    return { ...clone(report), adoption: clone(result), adoptionIntent: clone(intent),
      currentSelection: clone(selection()) };
  }
  async function review(input) {
    const request = requestValue(input), requestSha256 = sha256(canonical(request));
    const existing = await optional(reportPath(request.id), REPORT_LIMIT);
    if (existing) {
      const retained = await readReport(request.id);
      if (retained.report.requestSha256 !== requestSha256) fail('GRPC_UPGRADE_OPERATION_REUSED', 409);
      await remember(retained.report); return visible(retained.report);
    }
    const selected = clone(selection());
    if (selected.revision !== request.baseRevision) fail('GRPC_WORKSPACE_REVISION_CONFLICT', 409);
    const before = await loadRevision(request.baseRevision), after = await resolveCandidate(request.candidate);
    const comparison = compareGrpcContracts(before.contract, after.contract);
    const plans = compilePlan(after.contract, after.source, request.plan);
    const routes = routeReview(before, after, request.plan, comparison);
    const report = { schema: 'stellar-forge.grpc-workspace-upgrade.v1', id: request.id, createdAt: stamp(),
      request, requestSha256, baseSelection: selected,
      before: { revision: before.id, protoSha256: before.protoSource.sha256, sourceSha256: sha256(canonical(before.source)) },
      candidate: after.identity, comparison, routes,
      source: { before: clone(before.source), after: clone(after.source),
        changed: canonical(before.source) !== canonical(after.source) },
      planValidation: { valid: plans.valid, error: plans.error,
        planSha256: sha256(canonical(request.plan)),
        customerMethodsSha256: plans.compiled ? sha256(canonical(plans.compiled.methods)) : null,
        serviceSha256: plans.compiled ? sha256(canonical(plans.compiled.service)) : null },
      interpretation: 'Captured contract and selected merchant-plan review. Request examples are normalized and serialized by the original native runtime; no application RPC or payment is dispatched. Changed business meaning requires the operator and service owner to decide.' };
    report.reviewSha256 = documentDigest(report);
    await writeJsonSnapshot(reportPath(report.id), report, REPORT_LIMIT);
    await remember(report); return visible(report);
  }
  async function open(input) {
    fields(input, ['id'], 'GRPC_UPGRADE_OPEN_FIELDS_INVALID');
    const { report } = await readReport(id(input.id, UUID));
    await remember(report); return visible(report);
  }
  async function adopt(input) {
    fields(input, ['id', 'expectedReviewSha256'], 'GRPC_UPGRADE_ADOPT_FIELDS_INVALID');
    const { report, before, after } = await readReport(id(input.id, UUID));
    if (id(input.expectedReviewSha256) !== report.reviewSha256) fail('GRPC_UPGRADE_REVIEW_CHANGED', 409);
    if (!report.planValidation.valid) fail('GRPC_UPGRADE_PLAN_REQUIRES_CORRECTION', 422);
    const request = report.request;
    const targetId = sha256(canonical({ source: after.source, protoSource: after.protoSource,
      plan: request.plan, title: request.title }));
    let { intent, result } = await currentResult(report);
    if (result) {
      if (result.revision !== targetId || result.baseRevision !== before.id) fail('GRPC_UPGRADE_ADOPTION_CHANGED', 409);
      return { ...(await visible(report)), revision: visibleRevision(await loadRevision(targetId)) };
    }
    if (!intent) {
      if (!sameSelection(selection(), report.baseSelection)) fail('GRPC_WORKSPACE_REVISION_CONFLICT', 409);
      intent = { schema: 'stellar-forge.grpc-upgrade-adopt-intent.v1', id: report.id,
        createdAt: stamp(), reviewSha256: report.reviewSha256, before: clone(report.baseSelection),
        after: { revision: targetId, generation: report.baseSelection.generation + 1 } };
      await writeJsonSnapshot(intentPath(report.id), intent, 65536);
    }
    if (intent.after.revision !== targetId || !sameSelection(intent.before, report.baseSelection) ||
        intent.after.generation !== report.baseSelection.generation + 1) fail('GRPC_UPGRADE_ADOPTION_CHANGED', 409);
    let revision;
    if (sameSelection(selection(), intent.after)) {
      revision = visibleRevision(await loadRevision(targetId));
    } else {
      if (!sameSelection(selection(), intent.before)) fail('GRPC_WORKSPACE_REVISION_CONFLICT', 409);
      // This is the original atomic source/plan Save. Retrying an interrupted
      // pure save never runs a provider RPC, payment or another release engine.
      revision = await saveRevision({ source: after.source, protoSource: after.protoSource,
        plan: request.plan, title: request.title, baseRevision: before.id });
      if (revision.id !== targetId || !sameSelection(selection(), intent.after))
        fail('GRPC_UPGRADE_ADOPTION_CHANGED', 409);
    }
    result = { schema: 'stellar-forge.grpc-upgrade-adoption.v1', id: report.id,
      completedAt: stamp(), reviewSha256: report.reviewSha256, baseRevision: before.id,
      revision: targetId, selection: clone(intent.after),
      nextAction: 'Open this saved revision in the original workspace, review its channel, prepare its merchant package and use the original release controls.' };
    await writeJsonSnapshot(resultPath(report.id), result, 65536);
    return { ...(await visible(report)), revision };
  }
  async function method(input) {
    fields(input, ['id', 'method'], 'GRPC_UPGRADE_METHOD_FIELDS_INVALID');
    const { after } = await readReport(id(input.id, UUID));
    text(input.method, 'GRPC_METHOD_REQUIRED', 512);
    return after.contract.methods[input.method]?.requestStream && !after.source.limits.requestStream
      ? grpcMethodSchema(after.contract, input.method)
      : grpcOperationSchema(after.contract, input.method, { limits: after.source.limits });
  }
  async function initialize() {
    index = await optional(join(directory, 'index.json'), INDEX_LIMIT) ?? [];
    if (!Array.isArray(index) || index.some(row => !UUID.test(row.id) || !SHA.test(row.reviewSha256)))
      fail('GRPC_UPGRADE_INDEX_CHANGED', 409);
  }
  return { initialize, review, open, adopt, method,
    list: () => clone(index).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
