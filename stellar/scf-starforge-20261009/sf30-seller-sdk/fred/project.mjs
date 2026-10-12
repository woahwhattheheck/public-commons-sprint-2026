// MIT. A private FRED project owns source editions, reviews and recovery.
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { canonical, clone, need, operationId, normalizeSelection, projectionPolicy, compareCaptures, MAX_CAPTURE_BYTES, PUBLIC_CAPTURE, PUBLIC_SET_CAPTURE, FRED_NOTICE, FRED_TERMS } from './model.mjs';
import { hash, digest, jsonBytes, optionalJson, validateCapture, captureFred, storeFredCapture, sealFredPublicTable, sealFredPublicTables } from './source.mjs';

import { fredReviewIdentity, validateFredReview } from './review.mjs';
import { normalizeFredBriefing, buildFredBriefingModel, pageFredBriefing } from './briefing/model.mjs';
import { prepareFredBriefingFiles, readFredBriefingFiles, readFredBriefingMember, exportFredBriefingFiles, receiveFredBriefingFiles } from './briefing/files.mjs';

import { createFredBriefingTemplate, validateFredBriefingTemplate, materializeFredBriefingTemplate,
  compareFredBriefingSuccessor, pageFredBriefingChanges, createFredBriefingSuccessorRecord,
  validateFredBriefingSuccessorRecord } from './briefing/templates.mjs';
import { renderFredBriefingSuccessor, fredBriefingSuccessorCsv } from './briefing/template-report.mjs';

const SCHEMA = 'stellar-forge.fred-project.v1';
const BUNDLE = 'stellar-forge.fred-project-bundle.v1';
const BRIEFING_BUNDLE = 'stellar-forge.fred-project-bundle.v2';
const RECURRING_BUNDLE = 'stellar-forge.fred-project-bundle.v3';
const STATE_LIMIT = 8 * 1024 * 1024;
function projectState(state) {
  need(state?.schema === SCHEMA && typeof state.id === 'string' && /^[a-f0-9-]{36}$/.test(state.id) &&
    Number.isSafeInteger(state.revision) && state.revision >= 1 && Array.isArray(state.captures) &&
    Array.isArray(state.reviews) && Array.isArray(state.publications) && Array.isArray(state.operations),
    'Retained FRED project is invalid.');
  normalizeSelection(state.selection);
  for (const [key, validate] of [['briefingTemplates', validateFredBriefingTemplate],
    ['briefingSuccessors', validateFredBriefingSuccessorRecord]]) {
    if (state[key] !== undefined) {
      need(Array.isArray(state[key]) && new Set(state[key].map(item => item?.id)).size === state[key].length,
        'The retained recurring briefing inventory changed.');
      for (const item of state[key]) validate(item);
    }
  }
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
      series: model.series, responses: model.sourceResponses, ...(model.retrievalWindow ? { retrievalWindow: model.retrievalWindow } : {}), importedAt: new Date().toISOString() });
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
  else if (capture?.version === 'commons.retained-public-table-set.v1') capture = sealFredPublicTables(capture);
  validateCapture(capture);
  return transact(directory, { id, expectedRevision, kind: 'import', payload: { captureId: capture.captureSha256 } },
    (state, root) => adoptCapture(state, root, capture));
}

export async function combineFredTables({ directory, id, expectedRevision, captureIds } = {}) {
  need(Array.isArray(captureIds) && captureIds.length >= 1 && captureIds.length <= 50 &&
    captureIds.every(item => /^[a-f0-9]{64}$/.test(item)) && new Set(captureIds).size === captureIds.length,
    'Select one to fifty distinct retained public-table captures.');
  captureIds = [...captureIds].sort();
  return transact(directory, { id, expectedRevision, kind: 'combine', payload: { captureIds } }, async (state, root) => {
    const tables = [];
    for (const captureId of captureIds) {
      const capture = await getFredCapture(root, captureId);
      need([PUBLIC_CAPTURE, PUBLIC_SET_CAPTURE].includes(capture.schema), 'Combine complete public-table captures from this project.');
      tables.push(...(capture.schema === PUBLIC_SET_CAPTURE ? capture.source.tables : [capture.source]));
    }
    const capture = sealFredPublicTables({ version: 'commons.retained-public-table-set.v1', tables });
    return { ...(await adoptCapture(state, root, capture)), originalCaptures: captureIds };
  });
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
async function retainFredReview(state, root, identity) {
  const { captureId } = identity;
  need(state.captures.some(item => item.id === captureId), 'Review an original retained capture.');
  const reviewId = digest(identity);
  let review = state.reviews.find(item => item.id === reviewId);
  if (!review) {
    await privateDirectory(join(root, 'reviews'));
    const retained = await optionalJson(join(root, 'reviews', reviewId + '.json'));
    review = retained ?? { id: reviewId, ...identity, reviewedAt: new Date().toISOString() };
    need(review.id === reviewId && canonical(fredReviewIdentity(review)) === canonical(identity),
      'The retained review belongs to different source or settings.');
    if (!retained) await atomicJson(join(root, 'reviews'), reviewId + '.json', review, { exclusive: true });
  }
  let report = null;
  if (review.briefing) {
    const retained = await prepareFredBriefingFiles({ directory: fredBriefingDirectory(root, reviewId),
      capture: await getFredCapture(root, captureId), review });
    report = { reportId: retained.manifest.reportId, manifestSha256: retained.manifest.manifestSha256,
      files: retained.manifest.files };
  }
  if (!state.reviews.some(item => item.id === reviewId)) state.reviews.push(review);
  return { reviewId, captureId, ...(report ? { briefing: report } : {}) };
}
export async function reviewFredCapture({ directory, id, expectedRevision, captureId, policy = {}, note = '', briefing = null } = {}) {
  policy = projectionPolicy(policy);
  need(typeof note === 'string' && note.length <= 8000, 'Review note exceeds 8000 characters.');
  if (briefing !== null) briefing = normalizeFredBriefing(briefing, validateCapture(await getFredCapture(directory, captureId)));
  // Ordinary reviews preserve their original identity and operation fingerprint.
  const identity = fredReviewIdentity({ captureId, policy, note, briefing });
  return transact(directory, { id, expectedRevision, kind: 'review', payload: identity },
    (state, root) => retainFredReview(state, root, identity));
}
export function fredBriefingDirectory(directory, reviewId) {
  need(/^[a-f0-9]{64}$/.test(reviewId ?? ''), 'Select an original briefing review.');
  return join(resolve(directory), 'briefings', reviewId);
}
export async function previewFredBriefing({ directory, captureId, briefing, offset = 0, limit = 100 } = {}) {
  const capture = await getFredCapture(directory, captureId), model = validateCapture(capture);
  const report = buildFredBriefingModel({ model, captureId, selection: normalizeFredBriefing(briefing, model) });
  return { previewId: digest(report), ...pageFredBriefing(report, { offset, limit }) };
}
async function savedBriefingReview(directory, reviewId) {
  const state = await readFredProject(directory), review = state.reviews.find(item => item.id === reviewId);
  need(review?.briefing, 'Select a saved analyst briefing from this project.');
  validateFredReview(review, validateCapture(await getFredCapture(directory, review.captureId)));
  return review;
}
export async function getFredBriefing(directory, reviewId, { includeFiles = false } = {}) {
  const review = await savedBriefingReview(directory, reviewId);
  return readFredBriefingFiles(fredBriefingDirectory(directory, reviewId), { captureId: review.captureId, reviewId, includeFiles });
}
export async function downloadFredBriefing({ directory, reviewId, format } = {}) {
  const review = await savedBriefingReview(directory, reviewId);
  return readFredBriefingMember(fredBriefingDirectory(directory, reviewId), { captureId: review.captureId, reviewId, format });
}

/** Templates and report successors live inside the original project transaction. */
function templateFromState(state, templateId) {
  const value = (state.briefingTemplates ?? []).find(item => item.id === templateId);
  need(value, 'Choose a recurring briefing template from this project.', 'FRED_TEMPLATE_NOT_FOUND', 404);
  return validateFredBriefingTemplate(value);
}
function successorFromState(state, successorId) {
  const value = (state.briefingSuccessors ?? []).find(item => item.id === successorId);
  need(value, 'Choose a saved briefing successor from this project.', 'FRED_SUCCESSOR_NOT_FOUND', 404);
  return validateFredBriefingSuccessorRecord(value);
}
function originalReport(review, model) {
  validateFredReview(review, model);
  need(review.briefing, 'Choose an original analyst review.');
  const body = { ...buildFredBriefingModel({ model, captureId: review.captureId, reviewId: review.id,
    selection: review.briefing }), sourceNotice: FRED_NOTICE, sourceTerms: FRED_TERMS };
  return { ...body, reportId: 'fred-briefing-' + digest(body) };
}
function successorInput({ templateId, captureId, anchorDate = null, baselineReviewId = null,
  previousSuccessorId = null, note = '' } = {}) {
  need(typeof note === 'string' && note.length <= 8000, 'Review note exceeds 8000 characters.');
  return { templateId, captureId, anchorDate, baselineReviewId, previousSuccessorId, note };
}
async function successorContext(state, input, modelFor, reportFor) {
  const template = templateFromState(state, input.templateId);
  const origin = state.reviews.find(item => item.id === template.origin.reviewId);
  need(origin?.briefing && origin.captureId === template.origin.captureId,
    'The template lost its original reviewed source.');
  let baselineReviewId = input.baselineReviewId;
  if (input.previousSuccessorId !== null) {
    const previous = successorFromState(state, input.previousSuccessorId);
    need(previous.templateId === template.id &&
      (baselineReviewId === null || baselineReviewId === previous.reviewId),
      'The selected predecessor and baseline belong to the same recurring briefing.', 'FRED_SUCCESSOR_LINEAGE_CONFLICT', 409);
    baselineReviewId = previous.reviewId;
  }
  baselineReviewId ??= template.origin.reviewId;
  need(baselineReviewId === template.origin.reviewId ||
    (state.briefingSuccessors ?? []).some(item => item.templateId === template.id && item.reviewId === baselineReviewId),
    'Choose the original template review or one of its saved successors as baseline.');
  const model = await modelFor(input.captureId);
  const materialization = materializeFredBriefingTemplate({ template, model, captureId: input.captureId,
    anchorDate: input.anchorDate });
  const identity = fredReviewIdentity({ captureId: input.captureId, policy: origin.policy,
    note: input.note, briefing: materialization.selection });
  const reviewId = digest(identity), after = originalReport({ id: reviewId, ...identity }, model);
  const before = await reportFor(baselineReviewId);
  const comparison = compareFredBriefingSuccessor({ before, after });
  const previewId = digest({ schema: 'stellar-forge.fred-successor-preview.v1', projectId: state.id,
    templateId: template.id, materializationId: materialization.previewId, baselineReviewId,
    previousSuccessorId: input.previousSuccessorId, reviewId, reportId: after.reportId,
    comparisonId: comparison.comparisonId });
  return { previewId, template, materialization, baselineReviewId, previousSuccessorId: input.previousSuccessorId,
    reviewId, identity, after, comparison };
}
function liveContext(directory, state, input) {
  return successorContext(state, input,
    async captureId => validateCapture(await getFredCapture(directory, captureId)),
    async reviewId => (await getFredBriefing(directory, reviewId)).report);
}
export async function listFredBriefingTemplates({ directory } = {}) {
  const state = await readFredProject(directory);
  return { projectId: state.id, revision: state.revision,
    templates: clone(state.briefingTemplates ?? []), successors: clone(state.briefingSuccessors ?? []) };
}
export async function saveFredBriefingTemplate({ directory, id, expectedRevision, reviewId, name,
  window = {}, previousTemplateId = null } = {}) {
  const original = await readFredProject(directory);
  const review = original.reviews.find(item => item.id === reviewId);
  need(review?.briefing, 'Choose a saved analyst briefing from this project.');
  if (previousTemplateId !== null) templateFromState(original, previousTemplateId);
  const template = createFredBriefingTemplate({ name, review,
    model: validateCapture(await getFredCapture(directory, review.captureId)), window, previousTemplateId });
  return transact(directory, { id, expectedRevision, kind: 'template-save',
    payload: { reviewId, name: template.name, window: template.window, previousTemplateId, templateId: template.id } }, async state => {
    state.briefingTemplates ??= [];
    if (!state.briefingTemplates.some(item => item.id === template.id)) state.briefingTemplates.push(template);
    return { templateId: template.id, template };
  });
}
export async function previewFredBriefingSuccessor({ directory, offset = 0, limit = 100, changesOnly = true, ...request } = {}) {
  const state = await readFredProject(directory), input = successorInput(request);
  const value = await liveContext(directory, state, input);
  return { projectId: state.id, revision: state.revision, previewId: value.previewId, template: value.template,
    materialization: value.materialization, baselineReviewId: value.baselineReviewId,
    previousSuccessorId: value.previousSuccessorId, reviewId: value.reviewId,
    briefing: pageFredBriefing(value.after, { offset: 0, limit }),
    comparison: pageFredBriefingChanges(value.comparison, { offset, limit, changesOnly }) };
}
export async function saveFredBriefingSuccessor({ directory, id, expectedRevision, previewId, ...request } = {}) {
  const input = successorInput(request);
  need(/^[a-f0-9]{64}$/.test(previewId ?? ''), 'Preview the complete recurring briefing selection before saving it.');
  // Reject an obsolete preview before recording a pending mutation.
  const original = await readFredProject(directory);
  const prior = original.operations.find(item => item.id === id);
  if (!prior) {
    const checked = await liveContext(directory, original, input);
    need(checked.previewId === previewId, 'The recurring briefing selection changed; preview its current values.',
      'FRED_SUCCESSOR_PREVIEW_CHANGED', 409);
  }
  return transact(directory, { id, expectedRevision, kind: 'successor-save',
    payload: { ...input, previewId } }, async (state, root) => {
    const value = await liveContext(root, state, input);
    need(value.previewId === previewId, 'The recurring briefing selection changed; preview its current values.',
      'FRED_SUCCESSOR_PREVIEW_CHANGED', 409);
    const saved = await retainFredReview(state, root, value.identity);
    need(saved.briefing?.reportId === value.after.reportId,
      'The saved successor report differs from its original preview.');
    const successor = createFredBriefingSuccessorRecord({ template: value.template, materialization: value.materialization,
      reviewId: saved.reviewId, reportId: saved.briefing.reportId, comparison: value.comparison,
      previousSuccessorId: value.previousSuccessorId });
    state.briefingSuccessors ??= [];
    if (!state.briefingSuccessors.some(item => item.id === successor.id)) state.briefingSuccessors.push(successor);
    return { ...saved, successorId: successor.id, templateId: successor.templateId, summary: successor.comparison };
  });
}
async function retainedSuccessor(directory, successorId) {
  const state = await readFredProject(directory), successor = successorFromState(state, successorId);
  const review = state.reviews.find(item => item.id === successor.reviewId);
  need(review?.briefing, 'The successor lost its saved analyst review.');
  const value = await liveContext(directory, state, successorInput({ templateId: successor.templateId,
    captureId: successor.captureId, anchorDate: successor.materialization.window.anchorBasis === 'explicit'
      ? successor.materialization.window.anchorDate : null,
    baselineReviewId: successor.beforeReviewId, previousSuccessorId: successor.previousSuccessorId, note: review.note }));
  const saved = await getFredBriefing(directory, review.id);
  need(value.reviewId === review.id && value.after.reportId === saved.manifest.reportId,
    'The retained successor review differs from its original template and selection.');
  const rebuilt = createFredBriefingSuccessorRecord({ template: value.template, materialization: value.materialization,
    reviewId: review.id, reportId: saved.manifest.reportId, comparison: value.comparison,
    previousSuccessorId: successor.previousSuccessorId });
  need(canonical(rebuilt) === canonical(successor), 'The original recurring briefing lineage changed.');
  return { successor, template: value.template, materialization: value.materialization, comparison: value.comparison,
    briefing: { reviewId: review.id, reportId: saved.manifest.reportId, manifest: saved.manifest } };
}
export async function getFredBriefingSuccessor({ directory, successorId, offset = 0, limit = 100, changesOnly = true } = {}) {
  const value = await retainedSuccessor(directory, successorId);
  return { ...value, comparison: pageFredBriefingChanges(value.comparison, { offset, limit, changesOnly }) };
}
export async function downloadFredBriefingSuccessor({ directory, successorId, format } = {}) {
  need(['json', 'csv', 'html'].includes(format), 'Choose JSON, CSV or offline HTML for the full successor comparison.');
  const value = await retainedSuccessor(directory, successorId);
  const bytes = format === 'json' ? jsonBytes(value) : Buffer.from(format === 'csv'
    ? fredBriefingSuccessorCsv(value.comparison) : renderFredBriefingSuccessor(value));
  need(bytes.length <= 128 * 1024 * 1024, 'The complete comparison file exceeds the 128 MiB download capacity.',
    'FRED_SUCCESSOR_FILE_CAPACITY', 413);
  return { body: bytes, contentType: format === 'json' ? 'application/json' : format === 'csv'
    ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8',
    path: 'fred-briefing-successor.' + format, bytes: bytes.length, sha256: hash(bytes),
    successorId, reviewId: value.successor.reviewId, reportId: value.successor.reportId };
}
async function validateRecurringBundle(state, captures) {
  const templates = state.briefingTemplates ?? [], successors = state.briefingSuccessors ?? [];
  if (!templates.length && !successors.length) return;
  need(templates.length > 0, 'Retain every original recurring briefing template.');
  const models = new Map(captures.map(capture => [capture.captureSha256, validateCapture(capture)]));
  const modelFor = async id => {
    const model = models.get(id); need(model, 'A recurring briefing lost its original capture.'); return model;
  };
  const reports = new Map();
  const reportFor = async id => {
    if (!reports.has(id)) {
      const review = state.reviews.find(item => item.id === id);
      need(review?.briefing, 'A recurring briefing lost an original saved report.');
      reports.set(id, originalReport(review, await modelFor(review.captureId)));
    }
    return reports.get(id);
  };
  for (const template of templates) {
    const review = state.reviews.find(item => item.id === template.origin.reviewId);
    need(review?.captureId === template.origin.captureId, 'The original template source review changed.');
    if (template.previousTemplateId !== null) templateFromState(state, template.previousTemplateId);
    const expected = createFredBriefingTemplate({ name: template.name, review, model: await modelFor(review.captureId),
      window: template.window, previousTemplateId: template.previousTemplateId });
    need(canonical(expected) === canonical(template), 'The template differs from its complete original source review.');
  }
  for (const successor of successors) {
    const review = state.reviews.find(item => item.id === successor.reviewId);
    need(review?.briefing, 'The successor lost its original reviewed edition.');
    const value = await successorContext(state, successorInput({ templateId: successor.templateId,
      captureId: successor.captureId, anchorDate: successor.materialization.window.anchorBasis === 'explicit'
      ? successor.materialization.window.anchorDate : null,
      baselineReviewId: successor.beforeReviewId, previousSuccessorId: successor.previousSuccessorId, note: review.note }),
      modelFor, reportFor);
    need(value.reviewId === review.id, 'The successor review differs from its original materialized selection.');
    const report = await reportFor(review.id);
    const expected = createFredBriefingSuccessorRecord({ template: value.template, materialization: value.materialization,
      reviewId: review.id, reportId: report.reportId, comparison: value.comparison,
      previousSuccessorId: successor.previousSuccessorId });
    need(canonical(expected) === canonical(successor), 'The complete original successor lineage changed.');
  }
  // Portable lineage must stay acyclic even when its descriptor inventory is reordered.
  for (const [items, parent] of [[templates, 'previousTemplateId'], [successors, 'previousSuccessorId']]) {
    const byId = new Map(items.map(item => [item.id, item]));
    for (const item of items) {
      const visited = new Set(); let next = item;
      while (next) {
        need(!visited.has(next.id), 'The recurring briefing lineage contains a cycle.');
        visited.add(next.id); next = next[parent] === null ? null : byId.get(next[parent]);
      }
    }
  }
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
        capture: await getFredCapture(root, review.captureId), review,
        ...(review.briefing ? { briefing: await getFredBriefing(root, review.id, { includeFiles: true }) } : {}) });
      const merchant = await stageFredMerchant({ directory: publicationDirectory, origin, path, payment });
      const result = { publicationId, reviewId, captureId: review.captureId, snapshot: edition.snapshot,
        editionId: edition.editionId, resource: merchant.resource, publicOrigin: merchant.origin,
        ...(edition.briefing ? { briefing: edition.briefing } : {}) };
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
    const analystReviews = state.reviews.filter(review => review.briefing), briefings = [];
    for (const review of analystReviews) briefings.push(exportFredBriefingFiles(await getFredBriefing(directory, review.id, { includeFiles: true })));
    const recurring = (state.briefingTemplates?.length ?? 0) > 0;
    await validateRecurringBundle(state, captures);
    const bundle = { schema: recurring ? RECURRING_BUNDLE : briefings.length ? BRIEFING_BUNDLE : BUNDLE,
      state, captures, publicationPlans, ...(briefings.length ? { briefings } : {}) };
    bundle.bundleSha256 = digest(bundle);
    need(jsonBytes(bundle).length <= 256 * 1024 * 1024, 'Project bundle exceeds 256 MiB; export captures separately.');
    return bundle;
  });
}
export async function receiveFredProject({ directory, bundle } = {}) {
  directory = await privateDirectory(resolve(directory));
  need([BUNDLE, BRIEFING_BUNDLE, RECURRING_BUNDLE].includes(bundle?.schema) && Array.isArray(bundle.captures) &&
    Array.isArray(bundle.publicationPlans) &&
    (bundle.schema === BUNDLE ? bundle.briefings === undefined : Array.isArray(bundle.briefings) && bundle.briefings.length > 0),
    'Receive the complete original versioned project bundle.');
  const identity = { schema: bundle.schema, state: bundle.state, captures: bundle.captures, publicationPlans: bundle.publicationPlans,
    ...(bundle.schema !== BUNDLE ? { briefings: bundle.briefings } : {}) };
  need(bundle.bundleSha256 === digest(identity), 'Project bundle identity changed.');
  const original = projectState(clone(bundle.state));
  need(!original.pending, 'A receiving bundle must contain a completed project state.');
  const recurring = (original.briefingTemplates?.length ?? 0) > 0 ||
    (original.briefingSuccessors?.length ?? 0) > 0;
  need((bundle.schema === RECURRING_BUNDLE) === recurring,
    'Use the complete versioned bundle for this recurring briefing project.');
  const analystReviews = original.reviews.filter(review => review.briefing);
  need((bundle.briefings ?? []).length === analystReviews.length &&
    new Set((bundle.briefings ?? []).map(item => item.manifest?.reviewId)).size === analystReviews.length &&
    (bundle.briefings ?? []).every(item => analystReviews.some(review => review.id === item.manifest?.reviewId)),
    'The complete project bundle must retain every original analyst briefing.');
  need(bundle.publicationPlans.length === original.publications.length &&
    new Set(bundle.publicationPlans.map(item => item.id)).size === original.publications.length,
    'The complete original publication plan inventory differs.');
  need(bundle.captures.length === original.captures.length &&
    new Set(bundle.captures.map(item => item.captureSha256)).size === bundle.captures.length, 'Bundle source inventory differs.');
  await validateRecurringBundle(original, bundle.captures);
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
      const capture = bundle.captures.find(item => item.captureSha256 === review.captureId);
      need(capture, 'The saved review lost its original source.');
      validateFredReview(review, validateCapture(capture));
      const existing = await optionalJson(join(directory, 'reviews', review.id + '.json'));
      if (existing) need(canonical(existing) === canonical(review), 'Receiving review conflicts.');
      else await atomicJson(join(directory, 'reviews'), review.id + '.json', review, { exclusive: true });
    }
    for (const review of analystReviews) {
      const capture = bundle.captures.find(item => item.captureSha256 === review.captureId);
      const transfer = bundle.briefings.find(item => item.manifest.reviewId === review.id);
      await receiveFredBriefingFiles({ directory: fredBriefingDirectory(directory, review.id), transfer, capture, review });
    }
    // Reconstruct native merchant files with the original retained analyst bytes, source and payment inputs.
    for (const publication of original.publications) {
      const { prepareFredEdition, stageFredMerchant } = await import('./merchant.mjs');
      const operation = original.operations.find(item => item.kind === 'publish' && item.result.publicationId === publication.id);
      need(operation, 'Publication has no original completed operation.');
      // Payment terms are retained separately in its portable descriptor below.
      const plan = bundle.publicationPlans?.find(item => item.id === publication.id);
      need(plan && plan.id === digest({ reviewId: publication.reviewId, origin: plan.origin, path: plan.path, payment: plan.payment }),
        'Publication needs its original portable payment plan.');
      const review = original.reviews.find(item => item.id === publication.reviewId);
      const capture = bundle.captures.find(item => item.captureSha256 === publication.captureId);
      const root = fredPublicationDirectory(directory, publication.id);
      const briefing = review?.briefing ? await readFredBriefingFiles(fredBriefingDirectory(directory, review.id),
        { captureId: review.captureId, reviewId: review.id, includeFiles: true }) : null;
      const edition = await prepareFredEdition({ directory: root, capture, review, ...(briefing ? { briefing } : {}) });
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
  return { ...state, briefingTemplates: clone(state.briefingTemplates ?? []),
    briefingSuccessors: clone(state.briefingSuccessors ?? []), operations: state.operations.map(({ id, kind, completedAt, result }) => ({ id, kind, completedAt, result })), acquisition };
}
