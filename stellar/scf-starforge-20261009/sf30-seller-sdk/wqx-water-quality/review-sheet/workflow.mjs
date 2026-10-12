// MIT. Retain reviewer choices and reproduce both original and resulting native plans.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../../routescan/quota.mjs';
import { openWatersHash, openWatersCanonical, normalizeOpenWatersOptions, verifyOpenWatersPlan } from '../openwaters.mjs';
import { REVIEW_SHEET_SCHEMA, normalizeReviewSheetDocument, reviewSheetSource, composeReviewSheet,
  reviewSheetImpact, reviewSheetIssues, reviewSheetFail } from './model.mjs';
import { reviewSheetCsv, reviewSheetTsv } from './csv.mjs';

export const REVIEW_SHEET_REVIEW_SCHEMA = 'starforge.wqx-receiving-decision-review.v1';
export const REVIEW_SHEET_BUNDLE_SCHEMA = 'starforge.wqx-receiving-decision-bundle.v1';
const PENDING_SCHEMA = 'starforge.wqx-receiving-decision-pending.v1';
const PREVIEW_SCHEMA = 'starforge.wqx-receiving-decision-preview.v1';
const RECORD_LIMIT = 64 * 1024 * 1024;
const json = value => JSON.stringify(value, null, 2) + '\n';
const same = (a, b) => openWatersCanonical(a) === openWatersCanonical(b);
const NATIVE_FORMATS = ['locations', 'results', 'crosswalk', 'report', 'references', 'bundle'];
const OWN_FORMATS = ['json', 'csv', 'tsv', 'report', 'bundle'];
function id(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))
    reviewSheetFail('Choose a stable ' + name + ' containing letters, digits, hyphens or underscores.');
  return value;
}
function sha(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) reviewSheetFail('Provide the exact ' + name + ' SHA-256.');
  return value;
}
function projectOf(project) {
  if (!project || typeof project.root !== 'string' || !['readOpenWaters', 'saveOpenWaters', 'previewOpenWaters',
    'exportOpenWaters', 'receiveOpenWaters'].every(name => typeof project[name] === 'function'))
    reviewSheetFail('Open the original WQX water-quality project.');
  return project;
}
async function folder(project) { projectOf(project); return privateDirectory(join(project.root, 'review-sheets')); }
async function maybe(path) { try { return await readPrivateJson(path, RECORD_LIMIT); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function immutable(directory, filename, value) {
  try { await atomicJson(directory, filename, value, { exclusive: true }); return value; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readPrivateJson(join(directory, filename), RECORD_LIMIT);
    if (!same(existing, value)) reviewSheetFail('This decision review name already contains different work. Reopen it or use a new name.',
      'WQX_REVIEW_SHEET_REVIEW_CHANGED', 409);
    return existing;
  }
}
function requestOf({ reviewId, document, newPlanId, expectedPreviewSha256 }) {
  id(reviewId, 'decision review name'); id(newPlanId, 'new receiving plan name'); sha(expectedPreviewSha256, 'preview');
  document = normalizeReviewSheetDocument(document);
  if (newPlanId === document.sourcePlanId) reviewSheetFail('Save the reviewed choices under a new receiving plan name.');
  return { reviewId, document, newPlanId, expectedPreviewSha256 };
}
function verifyPending(input, reviewId) {
  if (!input || input.schema !== PENDING_SCHEMA || input.status !== 'PREPARED') reviewSheetFail('The prepared decision review changed.', 'WQX_REVIEW_SHEET_RECORD_CHANGED', 409);
  const { pendingSha256, ...content } = input;
  if (openWatersHash(content) !== pendingSha256 || input.request?.reviewId !== reviewId ||
    openWatersHash(requestOf(input.request)) !== input.requestSha256)
    reviewSheetFail('The original prepared decision request changed.', 'WQX_REVIEW_SHEET_RECORD_CHANGED', 409);
  return input;
}
function verifyReview(input, reviewId = input?.reviewId) {
  if (!input || input.schema !== REVIEW_SHEET_REVIEW_SCHEMA || input.status !== 'COMPLETE' || input.reviewId !== reviewId)
    reviewSheetFail('Choose a complete saved decision review.', 'WQX_REVIEW_SHEET_RECORD_CHANGED', 409);
  const { reviewSha256, files, ...content } = input;
  if (openWatersHash(content) !== reviewSha256) reviewSheetFail('The saved decision review changed.', 'WQX_REVIEW_SHEET_RECORD_CHANGED', 409);
  const document = normalizeReviewSheetDocument(input.document);
  if (!same(document, input.document) || openWatersHash(document) !== input.documentSha256 ||
    document.sourcePlanId !== input.source?.sourcePlanId || document.sourcePlanSha256 !== input.source?.sourcePlanSha256 ||
    openWatersHash(requestOf({ reviewId, document, newPlanId: input.newPlanId, expectedPreviewSha256: input.previewSha256 })) !== input.requestSha256)
    reviewSheetFail('The saved decision review no longer matches its original request.', 'WQX_REVIEW_SHEET_RECORD_CHANGED', 409);
  normalizeOpenWatersOptions(input.sourceOptions); sha(input.newPlanSha256, 'resulting plan');
  return { ...content, reviewSha256 };
}
function assignPlanId(preview, newPlanId) {
  const { planSha256, files, ...content } = verifyOpenWatersPlan(preview);
  content.planId = newPlanId;
  return { ...content, planSha256: openWatersHash(content) };
}
export async function previewReviewSheet({ project, document, newPlanId } = {}) {
  projectOf(project); id(newPlanId, 'new receiving plan name');
  const normalized = normalizeReviewSheetDocument(document);
  if (newPlanId === normalized.sourcePlanId) reviewSheetFail('Choose a new immutable receiving plan name.');
  const original = await project.readOpenWaters(normalized.sourcePlanId), composed = composeReviewSheet(original, normalized);
  const plan = assignPlanId(await project.previewOpenWaters({ reviewId: original.reviewId, options: composed.options,
    expectedReviewSha256: original.reviewSha256 }), newPlanId);
  const result = { schema: PREVIEW_SCHEMA, source: composed.source, document: composed.document,
    documentSha256: composed.documentSha256, newPlanId, newPlanSha256: plan.planSha256,
    changes: composed.changes, decisionCounts: composed.decisionCounts,
    before: structuredClone(original.summary), after: structuredClone(plan.summary), impact: reviewSheetImpact(original, plan) };
  return { ...result, previewSha256: openWatersHash(result), sourceOptions: normalizeOpenWatersOptions(original.options),
    options: composed.options, issues: reviewSheetIssues(plan), plan };
}
function pendingView(pending) {
  return { schema: REVIEW_SHEET_REVIEW_SCHEMA, status: 'PREPARED', reviewId: pending.request.reviewId,
    source: { sourcePlanId: pending.request.document.sourcePlanId, sourcePlanSha256: pending.request.document.sourcePlanSha256 },
    document: pending.request.document, newPlanId: pending.request.newPlanId,
    previewSha256: pending.request.expectedPreviewSha256, expectedPreviewSha256: pending.request.expectedPreviewSha256,
    createdAt: pending.createdAt, requestSha256: pending.requestSha256, files: [] };
}
function ownFile(reviewId, format) {
  const table = {
    json: [reviewId + '-decisions.json', 'application/json'],
    csv: [reviewId + '-decisions.csv', 'text/csv; charset=utf-8'],
    tsv: [reviewId + '-decisions.tsv', 'text/tab-separated-values; charset=utf-8'],
    report: [reviewId + '-decision-report.html', 'text/html; charset=utf-8'],
    bundle: [reviewId + '-complete-decisions.json', 'application/json'],
  };
  const [filename, mime] = table[format] ?? [];
  if (!filename) reviewSheetFail('Choose an available decision-review export.');
  return { format, filename, mime };
}
function exportFiles(record, plan) {
  return [...OWN_FORMATS.map(format => ownFile(record.reviewId, format)),
    ...plan.files.map(file => ({ ...file, format: 'native-' + file.format }))];
}
export async function readReviewSheet({ project, reviewId } = {}) {
  const directory = await folder(project); id(reviewId, 'decision review name');
  const stored = await maybe(join(directory, reviewId + '.json'));
  if (!stored) {
    const pending = await maybe(join(directory, reviewId + '.pending.json'));
    if (pending) return pendingView(verifyPending(pending, reviewId));
    reviewSheetFail('The selected decision review is not saved in this project.', 'WQX_REVIEW_SHEET_NOT_FOUND', 404);
  }
  const record = verifyReview(stored, reviewId);
  const source = await project.readOpenWaters(record.source.sourcePlanId);
  const plan = await project.readOpenWaters(record.newPlanId);
  if (!same(reviewSheetSource(source), record.source) || !same(source.options, record.sourceOptions) ||
    plan.planSha256 !== record.newPlanSha256 || plan.captureSha256 !== source.captureSha256 || plan.reviewSha256 !== source.reviewSha256)
    reviewSheetFail('The decision review’s original or resulting native plan changed.', 'WQX_REVIEW_SHEET_SOURCE_CHANGED', 409);
  return { ...record, files: exportFiles(record, plan) };
}
export async function listReviewSheets({ project } = {}) {
  const directory = await folder(project), ids = new Set();
  for (const name of await readdir(directory)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,95})(?:\.pending)?\.json$/.exec(name);
    if (match) ids.add(match[1]);
  }
  const result = [];
  for (const reviewId of [...ids].sort()) {
    const value = await maybe(join(directory, reviewId + '.json'));
    const record = value ? verifyReview(value, reviewId)
      : pendingView(verifyPending(await maybe(join(directory, reviewId + '.pending.json')), reviewId));
    result.push({ reviewId, status: record.status, source: record.source, newPlanId: record.newPlanId,
      newPlanSha256: record.newPlanSha256 ?? null, reviewSha256: record.reviewSha256 ?? null,
      previewSha256: record.previewSha256, createdAt: record.createdAt, completedAt: record.completedAt ?? null,
      changes: record.changes?.length ?? null, before: record.before ?? null, after: record.after ?? null });
  }
  return result;
}
export async function saveReviewSheet({ project, reviewId, document, newPlanId, expectedPreviewSha256 } = {}) {
  const request = requestOf({ reviewId, document, newPlanId, expectedPreviewSha256 });
  const directory = await folder(project), requestSha256 = openWatersHash(request);
  return withPrivateLock(directory, reviewId + '.lock', async () => {
    const existing = await maybe(join(directory, reviewId + '.json'));
    if (existing) {
      if (verifyReview(existing, reviewId).requestSha256 !== requestSha256)
        reviewSheetFail('This saved review name belongs to another decision request.', 'WQX_REVIEW_SHEET_REVIEW_CHANGED', 409);
      return readReviewSheet({ project, reviewId });
    }
    let pending = await maybe(join(directory, reviewId + '.pending.json'));
    if (pending && verifyPending(pending, reviewId).requestSha256 !== requestSha256)
      reviewSheetFail('Resume the original prepared decisions or choose a new review name.', 'WQX_REVIEW_SHEET_REVIEW_CHANGED', 409);
    const preview = await previewReviewSheet({ project, document: request.document, newPlanId });
    if (preview.previewSha256 !== expectedPreviewSha256)
      reviewSheetFail('The native preview changed. Review the current preview before saving.', 'WQX_REVIEW_SHEET_PREVIEW_CHANGED', 409);
    if (!pending) {
      const content = { schema: PENDING_SCHEMA, status: 'PREPARED', request, requestSha256, createdAt: new Date().toISOString() };
      pending = { ...content, pendingSha256: openWatersHash(content) };
      await immutable(directory, reviewId + '.pending.json', pending);
    }
    const saved = await project.saveOpenWaters({ planId: newPlanId, reviewId: preview.source.reviewId,
      options: preview.options, expectedReviewSha256: preview.source.reviewSha256 });
    if (saved.planSha256 !== preview.newPlanSha256)
      reviewSheetFail('The saved native plan differs from its reviewed preview.', 'WQX_REVIEW_SHEET_PREVIEW_CHANGED', 409);
    const content = { schema: REVIEW_SHEET_REVIEW_SCHEMA, status: 'COMPLETE', reviewId, requestSha256,
      createdAt: pending.createdAt, completedAt: new Date().toISOString(), source: preview.source,
      sourceOptions: preview.sourceOptions, document: preview.document, documentSha256: preview.documentSha256,
      newPlanId, newPlanSha256: preview.newPlanSha256, previewSha256: preview.previewSha256,
      changes: preview.changes, decisionCounts: preview.decisionCounts, before: preview.before, after: preview.after,
      impact: preview.impact, issues: preview.issues };
    await immutable(directory, reviewId + '.json', { ...content, reviewSha256: openWatersHash(content) });
    return readReviewSheet({ project, reviewId });
  });
}
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const displayChoice = selected => !selected.present ? '(native default)' : selected.value === '' ? '(explicit empty)' : selected.value;
export function renderReviewSheetReport(input) {
  const record = verifyReview(input);
  const cells = values => values.map(value => '<td>' + escape(value) + '</td>').join('');
  const changes = record.changes.map(row => '<tr>' + cells([row.kind, row.sourceId, row.field, row.currentValue,
    displayChoice(row.beforeChoice), row.action, displayChoice(row.afterChoice), row.reason]) + '</tr>').join('');
  const kept = record.document.decisions.filter(row => row.action === 'keep' && row.reason)
    .map(row => '<tr>' + cells([row.targetId, row.reason]) + '</tr>').join('');
  const summary = Object.keys(record.before).filter(key => typeof record.before[key] === 'number')
    .map(key => '<tr>' + cells([key, record.before[key], record.after[key], record.after[key] - record.before[key]]) + '</tr>').join('');
  const issues = record.issues.map(row => '<tr>' + cells([row.kind, row.sourceId, row.field, row.severity, row.code, row.message]) + '</tr>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escape(record.reviewId) + ' · receiving decisions</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:white;margin:32px;max-width:1600px}' +
    'h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #aaa;text-align:left;vertical-align:top;padding:8px;overflow-wrap:anywhere}' +
    'th{background:#eee}code,pre{white-space:pre-wrap;overflow-wrap:anywhere}section{overflow:auto}small{color:#444}@media print{body{margin:12px;font-size:10pt}thead{display:table-header-group}tr{break-inside:avoid}}</style>' +
    '<h1>Open Waters receiving decisions</h1><p>' + escape(record.source.title) + '</p><p>Decision review <strong>' + escape(record.reviewId) +
    '</strong> · ' + escape(record.status) + ' · ' + escape(record.completedAt) + '</p><p>Original plan <code>' + escape(record.source.sourcePlanId) +
    '</code><br>SHA-256 <code>' + escape(record.source.sourcePlanSha256) + '</code></p><p>Resulting plan <code>' + escape(record.newPlanId) +
    '</code><br>SHA-256 <code>' + escape(record.newPlanSha256) + '</code></p><p>The original scientific review, source identifiers, units, detection conditions and reported limits remain in the complete native receiving bundle. The new plan applies the recorded receiving choices through the original Open Waters planner.</p>' +
    '<h2>Native receiving impact</h2><section><table><thead><tr><th>Measure</th><th>Original</th><th>Reviewed</th><th>Change</th></tr></thead><tbody>' + summary + '</tbody></table></section>' +
    '<h2>Changed choices and reasons</h2><section><table><thead><tr><th>Kind</th><th>Original identity</th><th>Field</th><th>Original receiving value</th><th>Original explicit choice</th><th>Action</th><th>Reviewed choice</th><th>Reason</th></tr></thead><tbody>' + changes + '</tbody></table></section>' +
    (kept ? '<h2>Reasons for keeping choices</h2><section><table><thead><tr><th>Original target</th><th>Reason</th></tr></thead><tbody>' + kept + '</tbody></table></section>' : '') +
    '<h2>Native issues after review</h2><section><table><thead><tr><th>Kind</th><th>Original identity</th><th>Field</th><th>Severity</th><th>Code</th><th>Original planner message</th></tr></thead><tbody>' + issues + '</tbody></table></section>' +
    '<h2>Retained source</h2><p>Scientific review <code>' + escape(record.source.reviewId) + '</code> · <code>' + escape(record.source.reviewSha256) +
    '</code><br>Capture <code>' + escape(record.source.captureId) + '</code> · <code>' + escape(record.source.captureSha256) +
    '</code></p><p>Decision review SHA-256 <code>' + escape(record.reviewSha256) + '</code><br>Native preview SHA-256 <code>' +
    escape(record.previewSha256) + '</code></p></html>';
}
export async function exportReviewSheet({ project, reviewId, format } = {}) {
  const record = await readReviewSheet({ project, reviewId });
  if (record.status !== 'COMPLETE') reviewSheetFail('Resume this prepared review before exporting completed native outputs.', 'WQX_REVIEW_SHEET_PREPARED', 409);
  if (typeof format === 'string' && format.startsWith('native-')) {
    const selected = format.slice(7);
    if (!NATIVE_FORMATS.includes(selected)) reviewSheetFail('Choose one of the original native receiving formats.');
    return project.exportOpenWaters({ planId: record.newPlanId, format: selected });
  }
  const file = ownFile(reviewId, format);
  let content;
  if (format === 'json') content = json(record.document);
  else if (format === 'csv' || format === 'tsv') {
    const source = await project.readOpenWaters(record.source.sourcePlanId);
    content = (format === 'csv' ? reviewSheetCsv : reviewSheetTsv)(source, record.document, { attentionOnly: false });
  } else if (format === 'report') content = renderReviewSheetReport(record);
  else {
    const native = await project.exportOpenWaters({ planId: record.newPlanId, format: 'bundle' });
    const body = { schema: REVIEW_SHEET_BUNDLE_SCHEMA, decisionReview: verifyReview(record),
      openWatersFile: { filename: native.filename, bytes: native.bytes.length, sha256: openWatersHash(native.bytes) },
      openWaters: JSON.parse(native.bytes.toString('utf8')) };
    content = json({ ...body, bundleSha256: openWatersHash(body) });
  }
  const bytes = Buffer.from(content);
  if (bytes.length > 128 * 1024 * 1024) reviewSheetFail('This complete decision export exceeds 128 MiB.', 'WQX_REVIEW_SHEET_BUNDLE_TOO_LARGE', 413);
  return { filename: file.filename, mime: file.mime, bytes };
}
export async function receiveReviewSheet({ project, bundle } = {}) {
  projectOf(project);
  if (!bundle || bundle.schema !== REVIEW_SHEET_BUNDLE_SCHEMA) reviewSheetFail('Choose the complete receiving decision bundle.');
  const { bundleSha256, ...content } = bundle;
  if (openWatersHash(content) !== bundleSha256) reviewSheetFail('The complete decision bundle changed.', 'WQX_REVIEW_SHEET_BUNDLE_CHANGED', 409);
  const record = verifyReview(bundle.decisionReview);
  const nativeBytes = Buffer.from(json(bundle.openWaters));
  if (nativeBytes.length !== bundle.openWatersFile?.bytes || openWatersHash(nativeBytes) !== bundle.openWatersFile?.sha256 ||
    bundle.openWatersFile?.filename !== record.newPlanId + '-complete-open-waters.json' ||
    bundle.openWaters?.plan?.planSha256 !== record.newPlanSha256)
    reviewSheetFail('The complete bundle’s exact native receiving file changed.', 'WQX_REVIEW_SHEET_BUNDLE_CHANGED', 409);
  const directory = await folder(project);
  return withPrivateLock(directory, record.reviewId + '.lock', async () => {
    const existing = await maybe(join(directory, record.reviewId + '.json'));
    if (existing) {
      if (verifyReview(existing).reviewSha256 !== record.reviewSha256)
        reviewSheetFail('This decision review name already retains different work.', 'WQX_REVIEW_SHEET_REVIEW_CHANGED', 409);
      return readReviewSheet({ project, reviewId: record.reviewId });
    }
    const pending = await maybe(join(directory, record.reviewId + '.pending.json'));
    if (pending && verifyPending(pending, record.reviewId).requestSha256 !== record.requestSha256)
      reviewSheetFail('This review name already has a different prepared request.', 'WQX_REVIEW_SHEET_REVIEW_CHANGED', 409);
    const received = await project.receiveOpenWaters({ bundle: bundle.openWaters });
    const nativeFile = received.files.find(file => file.format === 'bundle');
    if (!nativeFile || nativeFile.bytes !== bundle.openWatersFile.bytes || nativeFile.sha256 !== bundle.openWatersFile.sha256)
      reviewSheetFail('The received native output differs from its original complete file.', 'WQX_REVIEW_SHEET_BUNDLE_CHANGED', 409);
    const sourcePreview = assignPlanId(await project.previewOpenWaters({ reviewId: record.source.reviewId,
      options: record.sourceOptions, expectedReviewSha256: record.source.reviewSha256 }), record.source.sourcePlanId);
    if (sourcePreview.planSha256 !== record.source.sourcePlanSha256 || !same(reviewSheetSource(sourcePreview), record.source))
      reviewSheetFail('The original choices do not reproduce the original source plan.', 'WQX_REVIEW_SHEET_SOURCE_CHANGED', 409);
    await project.saveOpenWaters({ planId: record.source.sourcePlanId, reviewId: record.source.reviewId,
      options: record.sourceOptions, expectedReviewSha256: record.source.reviewSha256 });
    const preview = await previewReviewSheet({ project, document: record.document, newPlanId: record.newPlanId });
    if (preview.previewSha256 !== record.previewSha256 || preview.newPlanSha256 !== record.newPlanSha256)
      reviewSheetFail('The reviewed decisions do not reproduce the resulting native plan.', 'WQX_REVIEW_SHEET_PREVIEW_CHANGED', 409);
    await immutable(directory, record.reviewId + '.json', record);
    return readReviewSheet({ project, reviewId: record.reviewId });
  });
}
