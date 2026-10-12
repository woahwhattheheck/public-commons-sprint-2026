// MIT. Durable product intent and portable receiving in the original Runtime workspace.
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeSourceBuildWorkspace, sourceBuildCatalog, sourceBuildProduct,
  reviewSourceBuild, readSourceBuildReview, validateSourceBuildReview,
  sourceBuildWorkspaceState } from './source-build-workspace.mjs';
import { normalizeProductRequirements, productReviewRequest, productRequirementIndex } from '../discovery/product-requirements.mjs';
import { sourceSelectionPath } from '../source-selection.mjs';
import { plain, need, now, canonical, json, digest, recordId, operationId, absolute,
  privateDirectory, makePrivate, regular, readJSON, saveJSON, operationLease } from './storage.mjs';

export const PRODUCT_PLAN_SCHEMA = 'stellar-forge.runtime-product-plan.v1';
export const PRODUCT_PLAN_BUNDLE_SCHEMA = 'stellar-forge.runtime-product-plan-bundle.v1';
export const PRODUCT_PLAN_MAX_BYTES = 16 * 1024 * 1024;
const ORIGIN_SCHEMA = 'stellar-forge.runtime-product-plan-origin.v1';
const RECEIPT_SCHEMA = 'stellar-forge.runtime-product-plan-receiving.v1';
const SUMMARY_SCHEMA = 'stellar-forge.runtime-product-plan-receiving-summary.v1';
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA = /^[a-f0-9]{64}$/;
const identity = value => digest(json(canonical(value)));
const clone = value => JSON.parse(JSON.stringify(value));
const only = (value, keys, code) => need(plain(value) && Object.keys(value).every(key => keys.includes(key)), code);
const same = (left, right, code) => need(identity(left) === identity(right), code);
const timestamp = value => need(typeof value === 'string' && !Number.isNaN(Date.parse(value)), 'PRODUCT_PLAN_TIME_INVALID');
const errorView = error => ({ code: error.code ?? 'PRODUCT_PLAN_ERROR', message: String(error.message ?? error).slice(0, 2000) });

function intent(value) {
  only(value, ['label', 'purpose', 'sourceCommit', 'selection', 'requirements'], 'PRODUCT_PLAN_INTENT_FIELDS_INVALID');
  need(typeof value.label === 'string' && (value.purpose === undefined || typeof value.purpose === 'string'),
    'PRODUCT_PLAN_LABEL_PURPOSE_REQUIRED');
  const label = value.label.trim(), purpose = (value.purpose ?? '').trim();
  need(typeof label === 'string' && label && label.length <= 200 && !/[\u0000-\u001f\u007f]/.test(label),
    'PRODUCT_PLAN_LABEL_REQUIRED', 'Give this saved product plan a name.');
  need(typeof purpose === 'string' && purpose.length <= 8000 && !/[\u0000\u007f]/.test(purpose), 'PRODUCT_PLAN_PURPOSE_INVALID');
  need(OID.test(value.sourceCommit ?? ''), 'PRODUCT_PLAN_COMMIT_REQUIRED');
  sourceSelectionPath(value.selection);
  return { label, purpose, sourceCommit: value.sourceCommit, selection: value.selection,
    requirements: normalizeProductRequirements(value.requirements ?? []) };
}
function sourceInput(value) {
  const repository = absolute(value.repository), offline = value.offline ?? true, python = value.python ?? 'python3';
  need(typeof offline === 'boolean', 'PRODUCT_PLAN_OFFLINE_BOOLEAN_REQUIRED');
  need(typeof python === 'string' && python && python.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(python) &&
    (python.includes('/') ? python === absolute(python) : /^[A-Za-z0-9_.+-]+$/.test(python)),
  'PRODUCT_PLAN_PYTHON_REQUIRED');
  return { repository, offline, python };
}
function receivingBinding(input, origins = []) {
  const repository = absolute(input.repository);
  const saved = origins.find(item => item.review.repository === repository &&
    (input.offline === undefined || item.review.offline === input.offline) &&
    (input.python === undefined || item.review.python === input.python));
  return sourceInput({ repository, offline: input.offline ?? saved?.review.offline,
    python: input.python ?? saved?.review.python });
}
/** Original review identity, excluding only host binding and optional discovery inspection. */
function sourceDefinition(value) {
  const { repository, offline, python, runtimeRequirements, reviewId, selectionSha256,
    requestId, reviewedAt, ...definition } = value;
  return definition;
}
function originalReview(value) {
  return validateSourceBuildReview(value, recordId(value?.reviewId));
}
function validatePlan(value) {
  only(value, ['schema', 'planId', 'intent', 'sourceSha256', 'catalogProduct', 'source', 'createdAt', 'contentSha256'],
    'PRODUCT_PLAN_FIELDS_INVALID');
  need(value.schema === PRODUCT_PLAN_SCHEMA, 'PRODUCT_PLAN_SCHEMA_INVALID');
  const selected = intent(value.intent);
  same(selected, value.intent, 'PRODUCT_PLAN_INTENT_CHANGED');
  need(value.planId === identity(selected).slice(0, 24), 'PRODUCT_PLAN_ID_CHANGED');
  need(SHA.test(value.sourceSha256 ?? '') && identity(value.source) === value.sourceSha256,
    'PRODUCT_PLAN_SOURCE_CHANGED');
  need(value.source?.sourceCommit === selected.sourceCommit && value.source?.selection === selected.selection &&
    value.catalogProduct?.id === selected.selection && value.catalogProduct?.available === true &&
    Array.isArray(value.catalogProduct.requirements) &&
    selected.requirements.every(id => value.catalogProduct.requirements.includes(id)),
  'PRODUCT_PLAN_CAPABILITY_SOURCE_CHANGED');
  timestamp(value.createdAt);
  const { contentSha256, ...body } = value;
  need(identity(body) === contentSha256, 'PRODUCT_PLAN_CONTENT_CHANGED');
  return value;
}
function validateOrigin(value, plan) {
  only(value, ['schema', 'originId', 'planId', 'workspaceId', 'review', 'runtimeRequirements', 'createdAt'], 'PRODUCT_PLAN_ORIGIN_FIELDS_INVALID');
  need(value.schema === ORIGIN_SCHEMA && value.planId === plan.planId, 'PRODUCT_PLAN_ORIGIN_INVALID');
  operationId(value.workspaceId); originalReview(value.review);
  need(plain(value.runtimeRequirements), 'PRODUCT_PLAN_INSPECTION_REQUIRED');
  need(identity(sourceDefinition(value.review)) === plan.sourceSha256, 'PRODUCT_PLAN_ORIGIN_SOURCE_CHANGED');
  const { originId, createdAt, ...body } = value;
  need(originId === identity(body).slice(0, 24), 'PRODUCT_PLAN_ORIGIN_CHANGED'); timestamp(createdAt);
  return value;
}
function validateObservation(value, origins) {
  only(value, ['observationId', 'originId', 'workspaceId', 'observedAt', 'build'], 'PRODUCT_PLAN_OBSERVATION_FIELDS_INVALID');
  const origin = origins.find(item => item.originId === value.originId);
  need(origin && value.workspaceId === origin.workspaceId && plain(value.build) &&
    value.build.requestId === origin.review.requestId && value.build.reviewId === origin.review.reviewId &&
    value.build.selectionSha256 === origin.review.selectionSha256 &&
    value.build.sourceCommit === origin.review.sourceCommit, 'PRODUCT_PLAN_OBSERVATION_SOURCE_CHANGED');
  const { observationId, observedAt, ...body } = value;
  need(observationId === identity(body).slice(0, 24), 'PRODUCT_PLAN_OBSERVATION_CHANGED'); timestamp(observedAt);
  return value;
}
export function inspectProductPlanBundle(value) {
  only(value, ['schema', 'plan', 'origins', 'observations', 'exportedAt', 'sha256'], 'PRODUCT_PLAN_BUNDLE_FIELDS_INVALID');
  need(value.schema === PRODUCT_PLAN_BUNDLE_SCHEMA && Array.isArray(value.origins) && Array.isArray(value.observations),
    'PRODUCT_PLAN_BUNDLE_SCHEMA_INVALID');
  const plan = validatePlan(value.plan), origins = value.origins.map(item => validateOrigin(item, plan));
  need(new Set(origins.map(item => item.originId)).size === origins.length, 'PRODUCT_PLAN_DUPLICATE_ORIGIN');
  const observations = value.observations.map(item => validateObservation(item, origins));
  need(new Set(observations.map(item => item.observationId)).size === observations.length, 'PRODUCT_PLAN_DUPLICATE_OBSERVATION');
  const { sha256, ...body } = value;
  need(identity(body) === sha256, 'PRODUCT_PLAN_BUNDLE_CHANGED'); timestamp(value.exportedAt);
  need(Buffer.byteLength(json(value)) <= PRODUCT_PLAN_MAX_BYTES, 'PRODUCT_PLAN_DOCUMENT_TOO_LARGE');
  return clone(value);
}
export async function readProductPlanDocument(path) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(absolute(path), PRODUCT_PLAN_MAX_BYTES)));
}
async function directory(path) {
  try { return await makePrivate(path); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return privateDirectory(path); }
}
async function rootContext(root) {
  const base = await initializeSourceBuildWorkspace(root), config = await readJSON(join(root, 'workspace.json'));
  need(config.schema === 'stellar-forge.runtime-workspace.v1' && config.directory === root, 'PRODUCT_PLAN_WORKSPACE_INVALID');
  operationId(config.workspaceId);
  const plans = await directory(join(base, 'plans')), receiving = await directory(join(base, 'plan-receiving'));
  return { root, plans, receiving, workspaceId: config.workspaceId };
}
async function planDirectory(context, id, create = false) {
  recordId(id);
  const path = join(context.plans, id);
  await (create ? directory(path) : privateDirectory(path));
  for (const part of ['origins', 'bindings', 'observations']) await (create ? directory(join(path, part)) : privateDirectory(join(path, part)));
  return path;
}
async function document(path, optional = false, maximum = PRODUCT_PLAN_MAX_BYTES + 8192) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    await regular(absolute(path), maximum))); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
async function createRecord(path, value, compare = (left, right) => same(left, right, 'PRODUCT_PLAN_RECORD_COLLISION')) {
  try { await saveJSON(path, value); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const saved = await document(path); compare(saved, value); return saved;
}
async function records(path) {
  const names = (await readdir(path)).filter(name => /^[a-f0-9]{24}\.json$/.test(name)).sort();
  const values = [];
  for (const name of names) values.push(await document(join(path, name)));
  return values;
}
async function savedPlan(context, id) {
  const path = await planDirectory(context, id), plan = validatePlan(await document(join(path, 'plan.json')));
  need(plan.planId === id, 'PRODUCT_PLAN_PATH_CHANGED');
  return { path, plan };
}
async function localOrigins(context, path, plan) {
  const result = [];
  for (const binding of await records(join(path, 'bindings'))) {
    only(binding, ['planId', 'originId', 'workspaceId'], 'PRODUCT_PLAN_BINDING_INVALID');
    need(binding.planId === plan.planId && binding.workspaceId === context.workspaceId, 'PRODUCT_PLAN_BINDING_CHANGED');
    const origin = validateOrigin(await document(join(path, 'origins', recordId(binding.originId) + '.json')), plan);
    need(origin.workspaceId === context.workspaceId, 'PRODUCT_PLAN_LOCAL_ORIGIN_CHANGED');
    const review = await readSourceBuildReview(context.root, origin.review.reviewId);
    same(review, origin.review, 'PRODUCT_PLAN_NATIVE_REVIEW_CHANGED');
    result.push(origin);
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.originId.localeCompare(b.originId));
}
async function retainPlan(context, selected, catalogProduct, source) {
  const sourceBody = sourceDefinition(source), sourceSha256 = identity(sourceBody);
  const body = { schema: PRODUCT_PLAN_SCHEMA, planId: identity(selected).slice(0, 24), intent: selected,
    sourceSha256, catalogProduct: clone(catalogProduct), source: clone(sourceBody), createdAt: now() };
  const next = { ...body, contentSha256: identity(body) }, path = await planDirectory(context, body.planId, true);
  const plan = await createRecord(join(path, 'plan.json'), next, (saved, expected) => {
    validatePlan(saved); same(saved.intent, expected.intent, 'PRODUCT_PLAN_INTENT_COLLISION');
    need(saved.sourceSha256 === expected.sourceSha256, 'PRODUCT_PLAN_SOURCE_COLLISION');
    same(saved.catalogProduct, expected.catalogProduct, 'PRODUCT_PLAN_CATALOG_CHANGED');
  });
  return { path, plan };
}
async function retainOrigin(context, path, plan, review, runtimeRequirements) {
  const body = { schema: ORIGIN_SCHEMA, planId: plan.planId, workspaceId: context.workspaceId,
    review: clone(review), runtimeRequirements: clone(runtimeRequirements ?? {}) };
  const origin = { ...body, originId: identity(body).slice(0, 24), createdAt: now() };
  const saved = await createRecord(join(path, 'origins', origin.originId + '.json'), origin, (left, right) => {
    validateOrigin(left, plan); need(left.originId === right.originId, 'PRODUCT_PLAN_ORIGIN_COLLISION');
  });
  await createRecord(join(path, 'bindings', saved.originId + '.json'), {
    planId: plan.planId, originId: saved.originId, workspaceId: context.workspaceId,
  });
  return saved;
}
async function observedSource(selected, binding) {
  const catalog = await sourceBuildCatalog({ repository: binding.repository, ref: selected.sourceCommit, offline: binding.offline });
  const request = productReviewRequest(catalog, selected.selection, { python: binding.python, requirements: selected.requirements });
  const source = await sourceBuildProduct(request);
  return { catalogProduct: catalog.products.find(item => item.id === selected.selection), source, request };
}
async function selectLocal(context, path, plan, bindingId) {
  const origins = await localOrigins(context, path, plan);
  const selected = bindingId ? origins.find(item => item.originId === recordId(bindingId)) : origins[0];
  need(selected, 'PRODUCT_PLAN_LOCAL_BINDING_REQUIRED', 'Receive this plan with the existing Git repository on this workspace.');
  return { selected, origins };
}
export async function readSourceProductPlan(root, { planId, bindingId } = {}) {
  const context = await rootContext(root), { path, plan } = await savedPlan(context, recordId(planId));
  const { selected, origins } = await selectLocal(context, path, plan, bindingId);
  const all = (await records(join(path, 'origins'))).map(item => validateOrigin(item, plan));
  const reviews = await sourceBuildWorkspaceState(root);
  const observations = (await records(join(path, 'observations'))).map(item => validateObservation(item, all));
  const catalogProduct = clone(plan.catalogProduct), binding = sourceInput(selected.review);
  return { plan, bindingId: selected.originId, workspaceId: context.workspaceId, review: selected.review,
    catalog: { repository: binding.repository, sourceCommit: plan.intent.sourceCommit, offline: binding.offline,
      products: [catalogProduct], capabilities: productRequirementIndex([catalogProduct]), savedPlanId: plan.planId },
    product: { ...clone(plan.source), ...binding, runtimeRequirements: clone(selected.runtimeRequirements) },
    buildRequest: { requestId: selected.review.requestId, operation: 'source-build',
      reviewId: selected.review.reviewId, selectionSha256: selected.review.selectionSha256 },
    origins: all.map(item => ({ ...item, local: origins.some(local => local.originId === item.originId),
      currentBuild: origins.some(local => local.originId === item.originId) ?
        reviews.builds.find(build => build.reviewId === item.review.reviewId && build.requestId === item.review.requestId) ?? null : null })),
    observations };
}
export async function saveSourceProductPlan(root, input) {
  only(input, ['repository', 'ref', 'selection', 'offline', 'python', 'requirements', 'label', 'purpose'], 'PRODUCT_PLAN_SAVE_FIELDS_INVALID');
  const selected = intent({ label: input.label, purpose: input.purpose, sourceCommit: input.ref,
    selection: input.selection, requirements: input.requirements });
  const context = await rootContext(root), planId = identity(selected).slice(0, 24);
  let existing;
  try { existing = await savedPlan(context, planId); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const locals = existing ? await localOrigins(context, existing.path, existing.plan) : [];
  const binding = receivingBinding(input, locals);
  if (existing) {
    const local = locals.find(item =>
      item.review.repository === binding.repository && item.review.offline === binding.offline && item.review.python === binding.python);
    if (local) return readSourceProductPlan(root, { planId, bindingId: local.originId });
  }
  const actual = await observedSource(selected, binding);
  const { path, plan } = await retainPlan(context, selected, actual.catalogProduct, actual.source);
  const review = await reviewSourceBuild(root, actual.request);
  const origin = await retainOrigin(context, path, plan, review, actual.source.runtimeRequirements);
  return readSourceProductPlan(root, { planId, bindingId: origin.originId });
}
export async function refreshSourceProductPlan(root, { planId, bindingId } = {}) {
  const context = await rootContext(root), { path, plan } = await savedPlan(context, recordId(planId));
  const { selected } = await selectLocal(context, path, plan, bindingId);
  const actual = await observedSource(plan.intent, sourceInput(selected.review));
  need(identity(sourceDefinition(actual.source)) === plan.sourceSha256, 'PRODUCT_PLAN_SOURCE_CHANGED');
  same(actual.catalogProduct, plan.catalogProduct, 'PRODUCT_PLAN_CATALOG_CHANGED');
  const review = await readSourceBuildReview(root, selected.review.reviewId);
  const origin = await retainOrigin(context, path, plan, review, actual.source.runtimeRequirements);
  return readSourceProductPlan(root, { planId, bindingId: origin.originId });
}
export async function exportSourceProductPlan(root, { planId } = {}) {
  const context = await rootContext(root), { path, plan } = await savedPlan(context, recordId(planId));
  const local = await localOrigins(context, path, plan), state = await sourceBuildWorkspaceState(root);
  for (const origin of local) {
    const build = state.builds.find(item => item.reviewId === origin.review.reviewId && item.requestId === origin.review.requestId);
    if (!build) continue;
    const body = { originId: origin.originId, workspaceId: context.workspaceId, build };
    const observation = { ...body, observationId: identity(body).slice(0, 24), observedAt: now() };
    await createRecord(join(path, 'observations', observation.observationId + '.json'), observation, (left, right) => {
      validateObservation(left, local); need(left.observationId === right.observationId, 'PRODUCT_PLAN_OBSERVATION_COLLISION');
    });
  }
  const origins = await records(join(path, 'origins')), observations = await records(join(path, 'observations'));
  const body = { schema: PRODUCT_PLAN_BUNDLE_SCHEMA, plan, origins, observations, exportedAt: now() };
  return inspectProductPlanBundle({ ...body, sha256: identity(body) });
}

function receiptIdentity(value) {
  return { schema: RECEIPT_SCHEMA, workspaceId: value.workspaceId, bundleSha256: value.bundleSha256,
    repository: value.repository, offline: value.offline, python: value.python };
}
function receivingState(value, id) {
  if (value) need(value.receiptId === id && ['RECEIVED', 'FAILED', 'COMPLETE'].includes(value.status),
    'PRODUCT_PLAN_RECEIVING_STATE_INVALID');
  return value;
}
async function retainReceivingSummary(context, path, input) {
  const selected = input.bundle.plan.intent;
  const body = { schema: SUMMARY_SCHEMA, receiptId: input.receiptId, workspaceId: context.workspaceId,
    bundleSha256: input.bundleSha256, repository: input.repository, offline: input.offline, python: input.python,
    label: selected.label, planId: input.bundle.plan.planId, selection: selected.selection,
    sourceCommit: selected.sourceCommit, receivedAt: input.receivedAt };
  return createRecord(join(path, 'summary.json'), { ...body, sha256: identity(body) });
}
/** Shelf reads small metadata only; opening/continuing still validates the full input. */
async function receivingSummary(context, id) {
  const path = join(context.receiving, recordId(id)); await privateDirectory(path);
  const summary = await document(join(path, 'summary.json'), true, 65536);
  const state = receivingState(await document(join(path, 'state.json'), true, 32768), id);
  if (!summary) {
    // A crash between retaining input and publishing its summary remains visible.
    // Recover the complete description when the operator continues that input.
    let info;
    try { info = await lstat(join(path, 'input.json')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    need(info.isFile() && !info.isSymbolicLink(), 'PRODUCT_PLAN_RECEIVING_INPUT_INVALID');
    return { receiptId: id, label: 'Retained product plan ' + id, planId: null, selection: null,
      sourceCommit: null, repository: null, receivedAt: new Date(info.mtimeMs).toISOString(),
      status: state?.status ?? 'RECEIVED', error: state?.error ?? null, bindingId: state?.bindingId ?? null,
      summaryPending: true };
  }
  only(summary, ['schema', 'receiptId', 'workspaceId', 'bundleSha256', 'repository', 'offline', 'python',
    'label', 'planId', 'selection', 'sourceCommit', 'receivedAt', 'sha256'], 'PRODUCT_PLAN_RECEIVING_SUMMARY_FIELDS_INVALID');
  const { sha256, ...body } = summary;
  need(summary.schema === SUMMARY_SCHEMA && summary.workspaceId === context.workspaceId &&
    summary.receiptId === id && identity(receiptIdentity(summary)).slice(0, 24) === id &&
    sha256 === identity(body), 'PRODUCT_PLAN_RECEIVING_SUMMARY_CHANGED');
  sourceInput(summary); recordId(summary.planId); sourceSelectionPath(summary.selection);
  need(typeof summary.label === 'string' && OID.test(summary.sourceCommit), 'PRODUCT_PLAN_RECEIVING_SUMMARY_INVALID');
  timestamp(summary.receivedAt);
  return { receiptId: id, label: summary.label, planId: summary.planId, selection: summary.selection,
    sourceCommit: summary.sourceCommit, repository: summary.repository, receivedAt: summary.receivedAt,
    status: state?.status ?? 'RECEIVED', error: state?.error ?? null, bindingId: state?.bindingId ?? null,
    summaryPending: false };
}
async function receivingRecord(context, id) {
  const path = join(context.receiving, recordId(id)); await privateDirectory(path);
  const input = await document(join(path, 'input.json'));
  only(input, ['schema', 'receiptId', 'workspaceId', 'bundleSha256', 'repository', 'offline', 'python', 'bundle', 'receivedAt'],
    'PRODUCT_PLAN_RECEIVING_FIELDS_INVALID');
  need(input.schema === RECEIPT_SCHEMA && input.workspaceId === context.workspaceId &&
    input.receiptId === id && identity(receiptIdentity(input)).slice(0, 24) === id, 'PRODUCT_PLAN_RECEIVING_CHANGED');
  const bundle = inspectProductPlanBundle(input.bundle);
  need(bundle.sha256 === input.bundleSha256, 'PRODUCT_PLAN_RECEIVING_DOCUMENT_CHANGED');
  sourceInput(input); timestamp(input.receivedAt);
  const state = receivingState(await document(join(path, 'state.json'), true, 32768), id);
  return { path, input, state };
}
export async function readProductPlanReceiving(root, { receiptId } = {}) {
  const context = await rootContext(root), { input, state } = await receivingRecord(context, recordId(receiptId));
  return { input, state: state ?? { receiptId, status: 'RECEIVED' } };
}
export async function receiveSourceProductPlan(root, input) {
  only(input, ['bundle', 'repository', 'offline', 'python'], 'PRODUCT_PLAN_RECEIVE_FIELDS_INVALID');
  const bundle = inspectProductPlanBundle(input.bundle), context = await rootContext(root);
  let existing = null;
  try { existing = await savedPlan(context, bundle.plan.planId); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const binding = receivingBinding(input, existing ? await localOrigins(context, existing.path, existing.plan) : []);
  const body = { schema: RECEIPT_SCHEMA, workspaceId: context.workspaceId, bundleSha256: bundle.sha256, ...binding };
  const receiptId = identity(body).slice(0, 24), path = await directory(join(context.receiving, receiptId));
  const value = { ...body, receiptId, bundle, receivedAt: now() };
  const received = await createRecord(join(path, 'input.json'), value, (left, right) => {
    same(receiptIdentity(left), receiptIdentity(right), 'PRODUCT_PLAN_RECEIVING_COLLISION');
    same(left.bundle, right.bundle, 'PRODUCT_PLAN_RECEIVING_DOCUMENT_COLLISION');
  });
  await retainReceivingSummary(context, path, received);
  return continueProductPlanReceiving(root, { receiptId });
}
export async function continueProductPlanReceiving(root, { receiptId } = {}) {
  const context = await rootContext(root), retained = await receivingRecord(context, recordId(receiptId));
  await retainReceivingSummary(context, retained.path, retained.input);
  const lease = await operationLease(join(retained.path, 'receiving.lock'));
  try {
    const current = await receivingRecord(context, receiptId);
    if (current.state?.status === 'COMPLETE') {
      const view = await readSourceProductPlan(root, { planId: current.state.planId, bindingId: current.state.bindingId });
      need(view.plan.planId === current.input.bundle.plan.planId &&
        view.plan.sourceSha256 === current.input.bundle.plan.sourceSha256 &&
        view.review.repository === current.input.repository && view.review.offline === current.input.offline &&
        view.review.python === current.input.python && view.review.reviewId === current.state.reviewId &&
        view.review.requestId === current.state.requestId && view.review.selectionSha256 === current.state.selectionSha256,
      'PRODUCT_PLAN_RECEIVING_BINDING_CHANGED');
      same(view.plan.catalogProduct, current.input.bundle.plan.catalogProduct, 'PRODUCT_PLAN_RECEIVING_CATALOG_CHANGED');
      return { receiptId, receiving: current.state, ...view };
    }
    const { bundle } = current.input, selected = bundle.plan.intent, binding = sourceInput(current.input);
    // A known local plan already has an original native review and materialized
    // inspection. Reopen that binding directly, including an offline workspace.
    let known = null, local = null, actual = null;
    try { known = await savedPlan(context, bundle.plan.planId); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (known) {
      same(known.plan.intent, selected, 'PRODUCT_PLAN_INTENT_COLLISION');
      need(known.plan.sourceSha256 === bundle.plan.sourceSha256, 'PRODUCT_PLAN_SOURCE_COLLISION');
      same(known.plan.catalogProduct, bundle.plan.catalogProduct, 'PRODUCT_PLAN_CATALOG_CHANGED');
      local = (await localOrigins(context, known.path, known.plan)).find(item =>
        item.review.repository === binding.repository && item.review.offline === binding.offline && item.review.python === binding.python);
    }
    if (!local) {
      actual = await observedSource(selected, binding);
      need(identity(sourceDefinition(actual.source)) === bundle.plan.sourceSha256, 'PRODUCT_PLAN_RECEIVED_SOURCE_CHANGED',
        'The selected repository does not reproduce this plan’s original product source.');
      same(actual.catalogProduct, bundle.plan.catalogProduct, 'PRODUCT_PLAN_RECEIVED_CAPABILITIES_CHANGED');
    }
    const path = await planDirectory(context, bundle.plan.planId, true);
    const plan = await createRecord(join(path, 'plan.json'), bundle.plan, (left, right) => {
      validatePlan(left); same(left.intent, right.intent, 'PRODUCT_PLAN_INTENT_COLLISION');
      need(left.sourceSha256 === right.sourceSha256, 'PRODUCT_PLAN_SOURCE_COLLISION');
      same(left.catalogProduct, right.catalogProduct, 'PRODUCT_PLAN_CATALOG_CHANGED');
    });
    for (const origin of bundle.origins)
      await createRecord(join(path, 'origins', origin.originId + '.json'), origin, (left, right) => {
        validateOrigin(left, plan); need(left.originId === right.originId, 'PRODUCT_PLAN_ORIGIN_COLLISION');
      });
    for (const observation of bundle.observations)
      await createRecord(join(path, 'observations', observation.observationId + '.json'), observation, (left, right) => {
        validateObservation(left, bundle.origins); need(left.observationId === right.observationId, 'PRODUCT_PLAN_OBSERVATION_COLLISION');
      });
    const review = local ? local.review : await reviewSourceBuild(root, actual.request);
    const origin = local ?? await retainOrigin(context, path, plan, review, actual.source.runtimeRequirements);
    const state = { receiptId, status: 'COMPLETE', planId: plan.planId, bindingId: origin.originId,
      reviewId: review.reviewId, requestId: review.requestId, selectionSha256: review.selectionSha256,
      receivedOrigins: bundle.origins.length, completedAt: now() };
    await saveJSON(join(retained.path, 'state.json'), state, true);
    return { receiptId, receiving: state, ...await readSourceProductPlan(root, { planId: plan.planId, bindingId: origin.originId }) };
  } catch (error) {
    await saveJSON(join(retained.path, 'state.json'), { receiptId, status: 'FAILED', updatedAt: now(), error: errorView(error) }, true);
    error.receiptId = receiptId;
    error.message = 'Saved plan receiving ' + receiptId + ': ' + error.message;
    throw error;
  } finally { await lease.close(); }
}
export async function sourceProductPlansState(root, input = {}) {
  only(input, ['query', 'limit', 'cursor', 'receivingQuery', 'receivingStatus', 'receivingLimit', 'receivingCursor'], 'PRODUCT_PLANS_QUERY_FIELDS_INVALID');
  const query = input.query ?? '', limit = input.limit ?? 30;
  need(typeof query === 'string' && query.length <= 2000, 'PRODUCT_PLANS_QUERY_INVALID');
  need(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'PRODUCT_PLANS_LIMIT_INVALID');
  if (input.cursor !== undefined) recordId(input.cursor);
  const receivingQuery = input.receivingQuery ?? '', receivingStatus = input.receivingStatus ?? 'all';
  const receivingLimit = input.receivingLimit ?? 30;
  need(typeof receivingQuery === 'string' && receivingQuery.length <= 2000, 'PRODUCT_PLAN_RECEIVING_QUERY_INVALID');
  need(['all', 'RECEIVED', 'FAILED', 'COMPLETE'].includes(receivingStatus), 'PRODUCT_PLAN_RECEIVING_STATUS_INVALID');
  need(Number.isInteger(receivingLimit) && receivingLimit >= 1 && receivingLimit <= 100, 'PRODUCT_PLAN_RECEIVING_LIMIT_INVALID');
  if (input.receivingCursor !== undefined) recordId(input.receivingCursor);
  const receivingWords = receivingQuery.toLocaleLowerCase('en').trim().split(/\s+/).filter(Boolean);
  const context = await rootContext(root), plans = [], receiving = [];
  const words = query.toLocaleLowerCase('en').trim().split(/\s+/).filter(Boolean);
  for (const id of (await readdir(context.plans)).filter(name => /^[a-f0-9]{24}$/.test(name))) {
    let retained;
    try { retained = await savedPlan(context, id); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const { plan, path } = retained;
    const text = [plan.intent.label, plan.intent.purpose, plan.intent.selection, ...plan.intent.requirements].join(' ').toLocaleLowerCase('en');
    if (!words.every(word => text.includes(word))) continue;
    const local = await localOrigins(context, path, plan);
    plans.push({ planId: id, label: plan.intent.label, purpose: plan.intent.purpose,
      sourceCommit: plan.intent.sourceCommit, selection: plan.intent.selection, requirements: plan.intent.requirements,
      title: plan.catalogProduct.title, createdAt: plan.createdAt,
      bindings: local.map(item => ({ bindingId: item.originId, repository: item.review.repository,
        offline: item.review.offline, python: item.review.python, reviewId: item.review.reviewId,
        requestId: item.review.requestId, selectionSha256: item.review.selectionSha256, createdAt: item.createdAt })) });
  }
  plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.planId.localeCompare(b.planId));
  const start = input.cursor === undefined ? 0 : plans.findIndex(item => item.planId === input.cursor) + 1;
  need(input.cursor === undefined || start > 0, 'PRODUCT_PLANS_CURSOR_CHANGED', 'Refresh the saved plan list for this search.');
  const selected = plans.slice(start, start + limit);
  for (const id of (await readdir(context.receiving)).filter(name => /^[a-f0-9]{24}$/.test(name))) {
    const summary = await receivingSummary(context, id);
    if (!summary || receivingStatus !== 'all' && summary.status !== receivingStatus) continue;
    const text = [summary.label, summary.selection, summary.planId, summary.sourceCommit, summary.repository, id].join(' ').toLocaleLowerCase('en');
    if (receivingWords.every(word => text.includes(word))) receiving.push(summary);
  }
  receiving.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.receiptId.localeCompare(b.receiptId));
  const receivingStart = input.receivingCursor === undefined ? 0 : receiving.findIndex(item => item.receiptId === input.receivingCursor) + 1;
  need(input.receivingCursor === undefined || receivingStart > 0, 'PRODUCT_PLAN_RECEIVING_CURSOR_CHANGED',
    'Refresh the received plan list for this search and status.');
  const received = receiving.slice(receivingStart, receivingStart + receivingLimit);
  return { plans: selected, total: plans.length, nextCursor: start + selected.length < plans.length ? selected.at(-1).planId : null,
    receiving: received, receivingTotal: receiving.length,
    receivingNextCursor: receivingStart + received.length < receiving.length ? received.at(-1).receiptId : null,
    workspaceId: context.workspaceId };
}
