// MIT. A private FRED project owns source editions, reviews and recovery.
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { canonical, clone, need, operationId, normalizeSelection, projectionPolicy, compareCaptures, MAX_CAPTURE_BYTES } from './model.mjs';
import { hash, digest, jsonBytes, optionalJson, validateCapture, captureFred, storeFredCapture, sealFredPublicTable } from './source.mjs';

const SCHEMA = 'stellar-forge.fred-project.v1';
const BUNDLE = 'stellar-forge.fred-project-bundle.v1';
const STATE_LIMIT = 8 * 1024 * 1024;
function projectState(state) {
  need(state?.schema === SCHEMA && typeof state.id === 'string' && /^[a-f0-9-]{36}$/.test(state.id) &&
    Number.isSafeInteger(state.revision) && state.revision >= 1 && Array.isArray(state.captures) &&
    Array.isArray(state.reviews) && Array.isArray(state.publications) && Array.isArray(state.operations),
    'Retained FRED project is invalid.');
  normalizeSelection(state.selection);
  return state;
}
export async function readFredProject(directory) {
  return projectState(await readPrivateJson(join(resolve(directory), 'project.json'), STATE_LIMIT));
}
export async function initializeFredProject({ directory, title, selection, apiKeyEnv = 'FRED_API_KEY' } = {}) {
  directory = await privateDirectory(resolve(directory));
  need(typeof title === 'string' && title.trim().length > 0 && title.length <= 160, 'Give the economic project a title.');
  need(typeof apiKeyEnv === 'string' && /^[A-Z_][A-Z0-9_]{0,127}$/.test(apiKeyEnv), 'Supply the key’s environment-variable name.');
  selection = normalizeSelection(selection);
  return withPrivateLock(directory, 'project.lock', async () => {
    const existing = await optionalJson(join(directory, 'project.json'), STATE_LIMIT);
    if (existing) {
      projectState(existing);
      need(existing.title === title && existing.apiKeyEnv === apiKeyEnv && canonical(existing.selection) === canonical(selection),
        'This directory already belongs to another project configuration.', 'FRED_PROJECT_EXISTS', 409);
      return existing;
    }
    const state = { schema: SCHEMA, id: randomUUID(), title, apiKeyEnv, selection, revision: 1,
      createdAt: new Date().toISOString(), selectedCapture: null, captures: [], reviews: [], publications: [], operations: [], pending: null };
    await atomicJson(directory, 'project.json', state, { exclusive: true });
    return state;
  });
}
async function transact(directory, request, apply) {
  directory = await privateDirectory(resolve(directory));
  operationId(request.id);
  need(Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 1, 'Use the project revision being reviewed.');
  const fingerprint = digest({ kind: request.kind, payload: request.payload });
  return withPrivateLock(directory, 'project.lock', async () => {
    const state = await readFredProject(directory);
    const previous = state.operations.find(item => item.id === request.id);
    if (previous) {
      need(previous.fingerprint === fingerprint, 'This operation ID retains another action.', 'FRED_OPERATION_CONFLICT', 409);
      return { ...clone(previous.result), replayed: true, revision: state.revision };
    }
    need(state.revision === request.expectedRevision, 'The project changed; read its current revision.', 'FRED_REVISION_CONFLICT', 409);
    if (state.pending) need(state.pending.id === request.id && state.pending.fingerprint === fingerprint,
      'Continue or abandon the retained operation before changing this project.', 'FRED_OPERATION_PENDING', 409);
    else {
      need(state.operations.length < 10000, 'This project has reached its retained operation capacity; export and archive it.');
      state.pending = { id: request.id, kind: request.kind, fingerprint, payload: clone(request.payload),
        expectedRevision: request.expectedRevision, startedAt: new Date().toISOString(), lastError: null };
      await atomicJson(directory, 'project.json', state);
    }
    try {
      const result = await apply(state, directory);
      state.revision++; state.pending = null;
      const retained = { ...result, revision: state.revision };
      state.operations.push({ id: request.id, kind: request.kind, fingerprint, completedAt: new Date().toISOString(), result: retained });
      need(jsonBytes(state).length <= STATE_LIMIT, 'Project index exceeds its retained capacity; export and archive it.');
      await atomicJson(directory, 'project.json', state);
      return retained;
    } catch (error) {
      // Side effects have deterministic identities; an unchanged operation resumes them.
      const current = await readFredProject(directory);
      if (current.pending?.id === request.id) {
        current.pending.lastError = { code: typeof error.code === 'string' ? error.code : 'FRED_OPERATION_INTERRUPTED',
          at: new Date().toISOString(), retryAt: typeof error.retryAt === 'string' ? error.retryAt : null };
        await atomicJson(directory, 'project.json', current);
      }
      throw error;
    }
  });
}
export async function abandonFredOperation({ directory, id, expectedRevision, pendingId } = {}) {
  directory = await privateDirectory(resolve(directory)); operationId(id); operationId(pendingId);
  return withPrivateLock(directory, 'project.lock', async () => {
    const state = await readFredProject(directory);
    const prior = state.operations.find(item => item.id === id);
    if (prior) {
      need(prior.kind === 'abandon' && prior.result.pendingId === pendingId, 'Operation ID belongs to another action.');
      return { ...prior.result, replayed: true };
    }
    need(state.revision === expectedRevision && state.pending?.id === pendingId,
      'Read the exact currently pending operation.', 'FRED_REVISION_CONFLICT', 409);
    const original = state.pending;
    // Source reads and immutable preparations stay available; no financial operation runs here.
    state.pending = null; state.revision++;
    const result = { pendingId, revision: state.revision, state: 'ABANDONED' };
    state.operations.push({ id, kind: 'abandon', fingerprint: digest({ pendingId }), abandoned: original,
      completedAt: new Date().toISOString(), result });
    await atomicJson(directory, 'project.json', state); return result;
  });
}
export const fredCaptureDirectory = (directory, captureId) => {
  need(/^[a-f0-9]{64}$/.test(captureId ?? ''), 'Select an original capture ID.');
  return join(resolve(directory), 'sources', captureId);
};
export async function getFredCapture(directory, captureId) {
  const state = await readFredProject(directory);
  need(state.captures.some(item => item.id === captureId), 'Capture does not belong to this project.');
  const capture = await readPrivateJson(join(fredCaptureDirectory(directory, captureId), 'capture.json'), MAX_CAPTURE_BYTES * 2);
  validateCapture(capture);
  need(capture.captureSha256 === captureId, 'Capture identity changed.');
  return capture;
}
async function adoptCapture(state, directory, capture) {
  const model = validateCapture(capture), captureId = capture.captureSha256;
  await storeFredCapture(fredCaptureDirectory(directory, captureId), capture);
  if (!state.captures.some(item => item.id === captureId))
    state.captures.push({ id: captureId, selection: model.selection, sourceMode: model.sourceMode, timeBasis: model.timeBasis, rowCount: model.rowCount, missing: model.missing,
      series: model.series, responses: model.sourceResponses, importedAt: new Date().toISOString() });
  state.selectedCapture = captureId;
  return { captureId, rowCount: model.rowCount, missing: model.missing };
}
export async function configureFredProject({ directory, id, expectedRevision, selection } = {}) {
  selection = normalizeSelection(selection);
  return transact(directory, { id, expectedRevision, kind: 'configure', payload: { selection } }, async state => {
    state.selection = selection; return { selection };
  });
}
export async function importFredCapture({ directory, id, expectedRevision, capture } = {}) {
  if (capture?.version === 'commons.retained-public-table.v1') capture = sealFredPublicTable(capture);
  validateCapture(capture);
  return transact(directory, { id, expectedRevision, kind: 'import', payload: { captureId: capture.captureSha256 } },
    (state, root) => adoptCapture(state, root, capture));
}
export async function acquireFredCapture({ directory, id, expectedRevision, signal, environment, fetchImpl } = {}) {
  const original = await readFredProject(directory);
  const selection = original.pending?.id === id && original.pending.kind === 'capture'
    ? original.pending.payload.selection : original.selection;
  return transact(directory, { id, expectedRevision, kind: 'capture', payload: { selection } }, async (state, root) => {
    const acquired = await captureFred({ directory: join(root, 'acquisitions', id), selection,
      apiKeyEnv: state.apiKeyEnv, signal, environment, fetchImpl });
    return { ...(await adoptCapture(state, root, acquired.capture)), acquisitionId: id };
  });
}
export async function selectFredCapture({ directory, id, expectedRevision, captureId } = {}) {
  return transact(directory, { id, expectedRevision, kind: 'select', payload: { captureId } }, async state => {
    need(state.captures.some(item => item.id === captureId), 'Select an existing capture.');
    state.selectedCapture = captureId; return { captureId };
  });
}
export async function reviewFredCapture({ directory, id, expectedRevision, captureId, policy = {}, note = '' } = {}) {
  policy = projectionPolicy(policy);
  need(typeof note === 'string' && note.length <= 8000, 'Review note exceeds 8000 characters.');
  return transact(directory, { id, expectedRevision, kind: 'review', payload: { captureId, policy, note } }, async (state, root) => {
    need(state.captures.some(item => item.id === captureId), 'Review an original retained capture.');
    const reviewId = digest({ captureId, policy, note });
    const previous = state.reviews.find(item => item.id === reviewId);
    if (!previous) {
      await privateDirectory(join(root, 'reviews'));
      const retained = await optionalJson(join(root, 'reviews', reviewId + '.json'));
      const review = retained ?? { id: reviewId, captureId, policy, note, reviewedAt: new Date().toISOString() };
      need(review.id === reviewId && review.captureId === captureId && canonical(review.policy) === canonical(policy) &&
        review.note === note, 'The retained review belongs to different source or settings.');
      if (!retained) await atomicJson(join(root, 'reviews'), reviewId + '.json', review, { exclusive: true });
      state.reviews.push(review);
    }
    return { reviewId, captureId };
  });
}
export async function compareFredCaptures({ directory, before, after } = {}) {
  const [first, second] = await Promise.all([getFredCapture(directory, before), getFredCapture(directory, after)]);
  return { ...compareCaptures(first, second), beforeCapture: before, afterCapture: after };
}
export async function publishFredReview({ directory, id, expectedRevision, reviewId, origin, path = '/economic-data', payment } = {}) {
  const parsedOrigin = new URL(origin);
  need(parsedOrigin.protocol === 'https:' && !parsedOrigin.username && !parsedOrigin.password && !parsedOrigin.search &&
    !parsedOrigin.hash && parsedOrigin.pathname === '/' && origin.replace(/\/$/, '') === parsedOrigin.origin,
    'Choose the merchant’s canonical public HTTPS origin.');
  origin = parsedOrigin.origin;
  return transact(directory, { id, expectedRevision, kind: 'publish', payload: { reviewId, origin, path, payment } },
    async (state, root) => {
      const review = state.reviews.find(item => item.id === reviewId);
      need(review, 'Select a retained reviewed edition.');
      const publicationId = digest({ reviewId, origin, path, payment });
      const { prepareFredEdition, stageFredMerchant } = await import('./merchant.mjs');
      const publicationDirectory = join(root, 'publications', publicationId);
      const edition = await prepareFredEdition({ directory: publicationDirectory,
        capture: await getFredCapture(root, review.captureId), review });
      const merchant = await stageFredMerchant({ directory: publicationDirectory, origin, path, payment });
      const result = { publicationId, reviewId, captureId: review.captureId, snapshot: edition.snapshot,
        editionId: edition.editionId, resource: merchant.resource, publicOrigin: merchant.origin };
      if (!state.publications.some(item => item.id === publicationId)) state.publications.push({ id: publicationId, ...result });
      return result;
    });
}
export function fredPublicationDirectory(directory, publicationId) {
  need(/^[a-f0-9]{64}$/.test(publicationId ?? ''), 'Select a retained publication ID.');
  return join(resolve(directory), 'publications', publicationId);
}
export async function selectFredPublication(directory, publicationId) {
  const state = await readFredProject(directory);
  need(state.publications.some(item => item.id === publicationId), 'Publication does not belong to this project.');
  return fredPublicationDirectory(directory, publicationId);
}
export async function exportFredProject({ directory } = {}) {
  directory = resolve(directory);
  return withPrivateLock(directory, 'project.lock', async () => {
    const state = await readFredProject(directory);
    need(!state.pending, 'Complete or abandon the active operation before exporting the project.', 'FRED_OPERATION_PENDING', 409);
    const captures = [];
    for (const item of state.captures) captures.push(await getFredCapture(directory, item.id));
    const publicationPlans = [];
    for (const publication of state.publications) {
      const plan = await readPrivateJson(join(fredPublicationDirectory(directory, publication.id), 'merchant-plan.json'));
      publicationPlans.push({ id: publication.id, origin: plan.origin, path: plan.path, payment: plan.payment });
    }
    const bundle = { schema: BUNDLE, state, captures, publicationPlans };
    bundle.bundleSha256 = digest({ schema: BUNDLE, state, captures, publicationPlans });
    need(jsonBytes(bundle).length <= 256 * 1024 * 1024, 'Project bundle exceeds 256 MiB; export captures separately.');
    return bundle;
  });
}
export async function receiveFredProject({ directory, bundle } = {}) {
  directory = await privateDirectory(resolve(directory));
  need(bundle?.schema === BUNDLE && Array.isArray(bundle.captures) &&
    Array.isArray(bundle.publicationPlans) &&
    bundle.bundleSha256 === digest({ schema: BUNDLE, state: bundle.state, captures: bundle.captures, publicationPlans: bundle.publicationPlans }), 'Project bundle identity changed.');
  const original = projectState(clone(bundle.state));
  need(!original.pending, 'A receiving bundle must contain a completed project state.');
  need(bundle.captures.length === original.captures.length &&
    new Set(bundle.captures.map(item => item.captureSha256)).size === bundle.captures.length, 'Bundle source inventory differs.');
  return withPrivateLock(directory, 'project.lock', async () => {
    const received = await optionalJson(join(directory, 'received.json'));
    if (received) {
      need(received.bundleSha256 === bundle.bundleSha256, 'This directory received another project.', 'FRED_RECEIVING_CONFLICT', 409);
      const state = await readFredProject(directory);
      return { ...received, revision: state.revision, reused: true };
    }
    const current = await optionalJson(join(directory, 'project.json'), STATE_LIMIT);
    need(current === null || canonical(current) === canonical(original),
      'Receive into an empty private project directory.', 'FRED_RECEIVING_CONFLICT', 409);
    for (const capture of bundle.captures) {
      validateCapture(capture);
      need(original.captures.some(item => item.id === capture.captureSha256), 'Unexpected source in receiving bundle.');
      await storeFredCapture(fredCaptureDirectory(directory, capture.captureSha256), capture);
    }
    await privateDirectory(join(directory, 'reviews'));
    for (const review of original.reviews) {
      need(review.id === digest({ captureId: review.captureId, policy: projectionPolicy(review.policy), note: review.note }) &&
        original.captures.some(item => item.id === review.captureId), 'Saved review changed.');
      const existing = await optionalJson(join(directory, 'reviews', review.id + '.json'));
      if (existing) need(canonical(existing) === canonical(review), 'Receiving review conflicts.');
      else await atomicJson(join(directory, 'reviews'), review.id + '.json', review, { exclusive: true });
    }
    // Reconstruct immutable merchant files from the original saved review and operation inputs.
    const { prepareFredEdition, stageFredMerchant } = await import('./merchant.mjs');
    for (const publication of original.publications) {
      const operation = original.operations.find(item => item.kind === 'publish' && item.result.publicationId === publication.id);
      need(operation, 'Publication has no original completed operation.');
      // Payment terms are retained separately in its portable descriptor below.
      const plan = bundle.publicationPlans?.find(item => item.id === publication.id);
      need(plan && plan.id === digest({ reviewId: publication.reviewId, origin: plan.origin, path: plan.path, payment: plan.payment }),
        'Publication needs its original portable payment plan.');
      const review = original.reviews.find(item => item.id === publication.reviewId);
      const capture = bundle.captures.find(item => item.captureSha256 === publication.captureId);
      const root = fredPublicationDirectory(directory, publication.id);
      const edition = await prepareFredEdition({ directory: root, capture, review });
      need(edition.snapshot === publication.snapshot && edition.editionId === publication.editionId, 'Receiving edition identity changed.');
      await stageFredMerchant({ directory: root, origin: plan.origin, path: plan.path, payment: plan.payment });
    }
    await atomicJson(directory, 'project.json', original);
    const receipt = { schema: 'stellar-forge.fred-receiving.v1', bundleSha256: bundle.bundleSha256,
      projectId: original.id, revision: original.revision, receivedAt: new Date().toISOString() };
    await atomicJson(directory, 'received.json', receipt, { exclusive: true }); return receipt;
  });
}
export async function fredProjectView(directory) {
  const state = await readFredProject(directory);
  let acquisition = null;
  if (state.pending?.kind === 'capture') {
    const value = await optionalJson(join(resolve(directory), 'acquisitions', state.pending.id, 'progress.json'));
    if (value) acquisition = { state: value.state, responses: value.records.length, lastError: value.lastError,
      startedAt: value.startedAt, selection: value.selection };
  }
  return { ...state, operations: state.operations.map(({ id, kind, completedAt, result }) => ({ id, kind, completedAt, result })), acquisition };
}
