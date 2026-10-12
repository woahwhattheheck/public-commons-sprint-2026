// MIT. A retained project joins native WQX capture, analysis, editions and original commerce.
import { readdir, readFile, rm, realpath } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { normalizeSelection, captureSelection, readCapture, retainedFiles } from './provider.mjs';
import { joinCapture } from './samples.mjs';
import { writeBytes as writeNativeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { summarizeWaterQuality, compareWaterQualityCaptures, waterQualityObservationCsv, waterQualityObservationGeoJson, renderWaterQualityReport } from './analysis.mjs';
import { prepareQualityEdition, stageQualityMerchant, startQualityMerchant, readQualityEdition } from './merchant.mjs';

const SCHEMA = 'starforge.wqx-water-quality-project.v1';
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
function fail(message, code = 'WQX_PROJECT_INVALID', status = 400) { throw Object.assign(new Error(message), { code, status }); }
export function operationId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)) fail('Use a stable operation name containing letters, digits, hyphens or underscores.');
  return value;
}
function titleOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('Give this water-data project a title of at most 200 characters.');
  return value.trim();
}
async function readOrNull(path, limit) { try { return await readPrivateJson(path, limit); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function immutable(folder, name, value) {
  try { await atomicJson(folder, name, value, { exclusive: true }); return value; }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const retained = await readPrivateJson(join(folder, name), 64 * 1024 * 1024);
    if (json(retained) !== json(value)) fail('This saved operation name already contains different work. Reopen it or choose a new name.', 'WQX_OPERATION_CHANGED', 409);
    return retained;
  }
}
function captureSummary(capture) {
  return { operationId: capture.operationId, status: capture.status, captureSha256: capture.captureSha256 ?? null,
    selection: capture.selection, summary: capture.summary ?? null, pages: capture.resources?.length ?? 0, resources: capture.resources ?? [],
    startedAt: capture.startedAt ?? null, completedAt: capture.completedAt ?? null,
    updatedAt: new Date().toISOString(), retryAt: capture.retryAt ?? null, error: capture.error ?? null };
}
async function names(folder, extension = '.json') {
  return (await readdir(folder)).filter(name => name.endsWith(extension) && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)).sort();
}

function safeMember(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') ||
      relative.split('/').some(part => !part || part === '.' || part === '..'))
    fail('Use a relative retained member path.', 'WQX_MEMBER_PATH', 409);
  const file = resolve(root, relative);
  if (!file.startsWith(root + sep)) fail('The retained member leaves its project.', 'WQX_MEMBER_PATH', 409);
  return file;
}
const byteHash = bytes => createHash('sha256').update(bytes).digest('hex');
async function immutableBytes(root, relative, bytes) {
  const file = safeMember(root, relative);
  await privateDirectory(dirname(file));
  try { await writeNativeBytes(file, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await realpath(file) !== file || !(await readFile(file)).equals(bytes))
      fail('This retained member already contains different work.', 'WQX_MEMBER_CHANGED', 409);
  }
}
const BUNDLE = 'starforge.wqx-review-bundle.v1';
const BUNDLE_BYTES = 64 * 1024 * 1024;
function bundleContent(bundle) {
  if (!bundle || bundle.schema !== BUNDLE || !Array.isArray(bundle.members) || !bundle.members.length || bundle.members.length > 4096)
    fail('Choose a complete WQX private review bundle.', 'WQX_BUNDLE_INVALID');
  operationId(bundle.reviewId);
  const { archiveSha256, ...content } = bundle;
  if (sha(content) !== archiveSha256) fail('The private review bundle changed.', 'WQX_BUNDLE_CHANGED', 409);
  let total = 0;
  const seen = new Set(), members = [];
  for (const item of bundle.members) {
    if (!item || typeof item.path !== 'string' || seen.has(item.path) ||
        !/^(?:project\.json|(?:revisions|requests|capture-summaries|reviews)\/[A-Za-z0-9][A-Za-z0-9_-]*\.json|captures\/[A-Za-z0-9][A-Za-z0-9_-]*\/.+)$/.test(item.path))
      fail('The bundle contains an unexpected or repeated member.', 'WQX_BUNDLE_INVALID', 409);
    safeMember('/wqx-bundle', item.path);
    if (typeof item.dataBase64 !== 'string' || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
        typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256))
      fail('A retained bundle member has invalid metadata.', 'WQX_BUNDLE_INVALID', 409);
    total += item.bytes;
    if (total > BUNDLE_BYTES) fail('This review bundle exceeds 64 MiB of retained source.', 'WQX_BUNDLE_TOO_LARGE', 413);
    const bytes = Buffer.from(item.dataBase64, 'base64');
    if (bytes.toString('base64') !== item.dataBase64 || bytes.length !== item.bytes || byteHash(bytes) !== item.sha256)
      fail('A retained bundle member changed.', 'WQX_BUNDLE_CHANGED', 409);
    seen.add(item.path); members.push({ ...item, bytesValue: bytes });
  }
  if (!seen.has('project.json') || !seen.has('reviews/' + bundle.reviewId + '.json'))
    fail('The bundle is missing its project or selected review.', 'WQX_BUNDLE_INVALID', 409);
  return { members, total };
}

export async function openWaterQualityProject(directory, { transport, env = process.env } = {}) {
  const root = await privateDirectory(resolve(directory));
  const folders = {};
  for (const name of ['revisions', 'requests', 'captures', 'capture-summaries', 'reviews', 'editions', 'imports']) folders[name] = await privateDirectory(join(root, name));
  let pending = Promise.resolve(), closing = false, closed = false, closePromise;
  const operations = new Set(), acquisitions = new Map();
  function active() { if (closed || closing) fail('The project is closing.', 'WQX_PROJECT_CLOSED', 503); }
  function tracked(work) {
    active(); const promise = Promise.resolve().then(work); operations.add(promise);
    promise.finally(() => operations.delete(promise)).catch(() => {}); return promise;
  }
  function serial(work) {
    const next = pending.then(() => withPrivateLock(root, 'project.lock', work)); pending = next.catch(() => {}); return next;
  }
  async function read() {
    const saved = await readOrNull(join(root, 'project.json'));
    if (saved && (saved.schema !== SCHEMA || !Number.isSafeInteger(saved.revision) || saved.revision < 1 ||
        sha(saved.selection) !== saved.selectionSha256)) fail('The retained project metadata changed.', 'WQX_PROJECT_CORRUPT', 409);
    return saved;
  }
  async function current(expectedRevision) {
    const saved = await read();
    if (!saved || !Number.isSafeInteger(expectedRevision) || expectedRevision !== saved.revision)
      fail('The project changed in another view. Refresh and continue from its saved revision.', 'WQX_REVISION_CHANGED', 409);
    return saved;
  }
  async function save({ title, selection, expectedRevision = 0 }) {
    return serial(async () => {
      const normalized = normalizeSelection(selection), name = titleOf(title), previous = await read();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (previous?.revision ?? 0))
        fail('The project changed in another view. Refresh before saving.', 'WQX_REVISION_CHANGED', 409);
      const selectionSha256 = sha(normalized);
      if (previous?.title === name && previous.selectionSha256 === selectionSha256) return previous;
      const at = new Date().toISOString(), revision = expectedRevision + 1;
      let next = { schema: SCHEMA, revision, title: name, selection: normalized, selectionSha256,
        createdAt: previous?.createdAt ?? at, updatedAt: at };
      const path = join(folders.revisions, revision + '.json'), retained = await readOrNull(path);
      if (retained) {
        if (retained.schema !== SCHEMA || retained.revision !== revision || retained.title !== name || retained.selectionSha256 !== selectionSha256)
          fail('An interrupted save retained a different revision. Its original file is preserved.', 'WQX_REVISION_CHANGED', 409);
        next = retained;
      } else await immutable(folders.revisions, revision + '.json', next);
      await atomicJson(root, 'project.json', next); return next;
    });
  }
  async function readRequest(id) {
    operationId(id);
    const request = await readPrivateJson(join(folders.requests, id + '.json'));
    if (request.schema !== 'starforge.wqx-water-quality-project-request.v1' || request.operationId !== id || sha(request.selection) !== request.selectionSha256)
      fail('The original capture request changed.', 'WQX_REQUEST_CHANGED', 409);
    return request;
  }
  async function acquire({ operationId: id = randomUUID(), expectedRevision, signal, onProgress } = {}) {
    operationId(id);
    if (acquisitions.has(id)) fail('This capture is already active. Read its progress or cancel it.', 'WQX_CAPTURE_ACTIVE', 409);
    const controller = new AbortController();
    const holder = { controller, progress: null, status: 'PREPARING' };
    acquisitions.set(id, holder);
    try {
      const request = await serial(async () => {
        const retained = await readOrNull(join(folders.requests, id + '.json'));
        if (retained) {
          if (retained.revision !== expectedRevision) fail('This capture belongs to another saved project revision.', 'WQX_OPERATION_CHANGED', 409);
          return readRequest(id);
        }
        const saved = await current(expectedRevision);
        return immutable(folders.requests, id + '.json', { schema: 'starforge.wqx-water-quality-project-request.v1',
          operationId: id, revision: saved.revision, title: saved.title, selection: saved.selection,
          selectionSha256: saved.selectionSha256, startedAt: new Date().toISOString() });
      });
      holder.status = 'RUNNING';
      const capture = await captureSelection({ directory: folders.captures, operationId: id, selection: request.selection,
        transport, env, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        onProgress: async value => { holder.progress = value; await onProgress?.(value); } });
      const result = captureSummary(capture);
      await atomicJson(folders['capture-summaries'], id + '.json', result);
      return { ...result, revision: request.revision };
    } catch (error) {
      try {
        const capture = await readCapture(folders.captures, id);
        await atomicJson(folders['capture-summaries'], id + '.json', captureSummary(capture));
      } catch {}
      throw error;
    } finally { acquisitions.delete(id); }
  }

  async function importCapture({ sourceDirectory, expectedRevision = 0, title = 'Water quality review' } = {}) {
    const source = await readCapture(resolve(sourceDirectory)), id = operationId(source.operationId);
    const members = await retainedFiles(source);
    return serial(async () => {
      let saved;
      if (!await read() && expectedRevision === 0) {
        const at = new Date().toISOString(), selection = normalizeSelection(source.selection);
        saved = { schema: SCHEMA, revision: 1, title: titleOf(title), selection, selectionSha256: sha(selection), createdAt: at, updatedAt: at };
        const retained = await readOrNull(join(folders.revisions, '1.json'));
        if (retained) {
          if (retained.title !== saved.title || retained.selectionSha256 !== saved.selectionSha256) fail('An interrupted initial project save contains different work.', 'WQX_REVISION_CHANGED', 409);
          saved = retained;
        } else await immutable(folders.revisions, '1.json', saved);
        await atomicJson(root, 'project.json', saved);
      } else saved = await current(expectedRevision);
      if (sha(source.selection) !== saved.selectionSha256)
        fail('Save this capture’s original selection before importing it.', 'WQX_SELECTION_CHANGED', 409);
      const destination = await privateDirectory(join(folders.captures, id));
      for (const item of [...members].sort((a, b) => Number(a.path === 'capture.json') - Number(b.path === 'capture.json'))) {
        const sourceFile = safeMember(source.directory, item.path);
        if (await realpath(sourceFile) !== sourceFile) fail('An original source member changed.', 'WQX_CAPTURE_CHANGED', 409);
        const bytes = await readFile(sourceFile);
        if (bytes.length !== item.bytes || byteHash(bytes) !== item.sha256)
          fail('An original source member changed.', 'WQX_CAPTURE_CHANGED', 409);
        await immutableBytes(destination, item.path, bytes);
      }
      const copied = await readCapture(destination);
      if (copied.captureSha256 !== source.captureSha256) fail('The imported capture differs from its source.', 'WQX_CAPTURE_CHANGED', 409);
      await immutable(folders.requests, id + '.json', { schema: 'starforge.wqx-water-quality-project-request.v1',
        operationId: id, revision: saved.revision, title: saved.title, selection: saved.selection,
        selectionSha256: saved.selectionSha256, startedAt: source.startedAt });
      const result = captureSummary(copied);
      await atomicJson(folders['capture-summaries'], id + '.json', result);
      return { ...result, revision: saved.revision };
    });
  }
  async function exportReviewBundle({ reviewId } = {}) {
    const review = await readReview(reviewId), project = await read(), members = new Map();
    async function retain(relative, expected) {
      if (members.has(relative)) return;
      const file = safeMember(root, relative);
      if (await realpath(file) !== file) fail('A private source member changed.', 'WQX_MEMBER_CHANGED', 409);
      const bytes = await readFile(file), sha256 = byteHash(bytes);
      if (expected && (expected.sha256 !== sha256 || expected.bytes !== bytes.length))
        fail('An original capture member changed.', 'WQX_CAPTURE_CHANGED', 409);
      members.set(relative, { path: relative, bytes: bytes.length, sha256, dataBase64: bytes.toString('base64') });
    }
    if (!project) fail('Open a saved project before exporting its review.');
    await retain('project.json'); await retain('reviews/' + reviewId + '.json');
    const revisions = new Set([project.revision, review.revision]);
    for (const id of [review.captureId, review.comparisonCaptureId].filter(Boolean)) {
      const source = await capture(id), request = await readRequest(id);
      if (id === review.captureId && source.captureSha256 !== review.captureSha256)
        fail('The selected review’s source changed.', 'WQX_CAPTURE_CHANGED', 409);
      revisions.add(request.revision);
      await retain('requests/' + id + '.json');
      for (const item of await retainedFiles(source)) await retain('captures/' + id + '/' + item.path, item);
      if (await readOrNull(join(folders['capture-summaries'], id + '.json'))) await retain('capture-summaries/' + id + '.json');
    }
    for (const revision of revisions) await retain('revisions/' + revision + '.json');
    const content = { schema: BUNDLE, reviewId, title: review.title, captureSha256: review.captureSha256,
      members: [...members.values()].sort((a, b) => a.path.localeCompare(b.path)) };
    const result = { ...content, archiveSha256: sha(content) };
    bundleContent(result);
    return { bytes: Buffer.from(json(result)), mime: 'application/json', filename: reviewId + '-water-quality.json' };
  }
  async function receiveReviewBundle({ bundle } = {}) {
    const { members, total } = bundleContent(bundle), archiveSha256 = bundle.archiveSha256;
    return serial(async () => {
      const receiptName = archiveSha256 + '.json', intentName = archiveSha256 + '-intent.json';
      const receipt = await readOrNull(join(folders.imports, receiptName));
      if (receipt) {
        const review = await readReview(bundle.reviewId), retained = await capture(review.captureId);
        if (review.captureSha256 !== bundle.captureSha256 || retained.captureSha256 !== bundle.captureSha256)
          fail('The received review source changed.', 'WQX_CAPTURE_CHANGED', 409);
        return { ...receipt, review };
      }
      const intent = await readOrNull(join(folders.imports, intentName));
      if (await read() && !intent)
        fail('Open an empty private project directory to receive a complete review.', 'WQX_RECEIVE_NOT_EMPTY', 409);
      for (const name of await names(folders.imports)) {
        if (name.endsWith('-intent.json') && name !== intentName && !await readOrNull(join(folders.imports, name.replace('-intent.json', '.json'))))
          fail('Finish the original review bundle already being received here.', 'WQX_RECEIVE_ACTIVE', 409);
      }
      await immutable(folders.imports, intentName, { schema: 'starforge.wqx-review-receive-intent.v1', archiveSha256, reviewId: bundle.reviewId });
      const stage = await privateDirectory(join(root, '.receive-' + archiveSha256));
      for (const item of members) await immutableBytes(stage, item.path, item.bytesValue);
      const receiver = await openWaterQualityProject(stage);
      let review;
      try {
        const saved = await receiver.read();
        review = await receiver.readReview(bundle.reviewId);
        const retained = await receiver.capture(review.captureId);
        if (!saved || review.captureSha256 !== bundle.captureSha256 || retained.captureSha256 !== bundle.captureSha256)
          fail('The received review and source do not match.', 'WQX_BUNDLE_CHANGED', 409);
        if (review.comparisonCaptureId) await receiver.capture(review.comparisonCaptureId);
      } finally { await receiver.close(); }
      for (const item of [...members].sort((a, b) => Number(a.path === 'project.json') - Number(b.path === 'project.json')))
        await immutableBytes(root, item.path, item.bytesValue);
      const received = { schema: 'starforge.wqx-review-received.v1', archiveSha256,
        reviewId: bundle.reviewId, captureSha256: bundle.captureSha256, files: members.length, bytes: total };
      await immutable(folders.imports, receiptName, received);
      await rm(stage, { recursive: true });
      return { ...received, review };
    });
  }

  async function listCaptures() {
    const rows = [];
    for (const name of await names(folders.requests)) {
      const request = await readRequest(name.slice(0, -5));
      const summary = await readOrNull(join(folders['capture-summaries'], name));
      const running = acquisitions.get(request.operationId);
      rows.push({ operationId: request.operationId, revision: request.revision, selection: request.selection,
        ...summary, startedAt: summary?.startedAt ?? request.startedAt, ...(running ? { status: running.status, progress: running.progress } : {}),
        status: running?.status ?? summary?.status ?? 'INTERRUPTED' });
    }
    return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async function capture(id) {
    const request = await readRequest(id), result = await readCapture(folders.captures, id);
    if (sha(result.selection) !== request.selectionSha256) fail('The capture belongs to another original selection.', 'WQX_CAPTURE_CHANGED', 409);
    return result;
  }
  async function analyze({ captureId, options = {}, comparisonCaptureId } = {}) {
    const retained = await capture(captureId), model = await joinCapture(retained);
    if (model.captureSha256 !== retained.captureSha256) fail('The capture progressed while its review was opening. Refresh the retained source.', 'WQX_CAPTURE_CHANGED', 409);
    const analysis = summarizeWaterQuality(model, options);
    let comparison = null;
    if (comparisonCaptureId) {
      const previous = await capture(comparisonCaptureId), previousModel = await joinCapture(previous);
      if (previousModel.captureSha256 !== previous.captureSha256) fail('The comparison capture progressed while opening. Refresh the retained source.', 'WQX_CAPTURE_CHANGED', 409);
      comparison = compareWaterQualityCaptures(model, previousModel, options);
    }
    return { captureSha256: retained.captureSha256, analysis, comparison };
  }

  async function readResult({ captureId, resultId, sourceSha256, sourceIndex, expectedCaptureSha256 } = {}) {
    if (typeof resultId !== 'string' || !/^wqx-record-[0-9a-f]{64}$/.test(resultId) ||
        typeof sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sourceSha256) ||
        !Number.isSafeInteger(sourceIndex) || sourceIndex < 0)
      fail('Choose a result with its original retained source pointer.', 'WQX_RESULT_POINTER');
    const retained = await capture(captureId);
    if (expectedCaptureSha256 && retained.captureSha256 !== expectedCaptureSha256)
      fail('The selected result belongs to an earlier capture. Refresh its analysis.', 'WQX_CAPTURE_CHANGED', 409);
    const model = await joinCapture(retained);
    if (model.captureSha256 !== retained.captureSha256) fail('The capture progressed while opening its original result.', 'WQX_CAPTURE_CHANGED', 409);
    const rows = model.rows.filter(row => row.id === resultId && row.source?.sha256 === sourceSha256 && row.source?.index === sourceIndex);
    if (rows.length !== 1) fail('This source pointer does not identify exactly one original result.', 'WQX_RESULT_NOT_FOUND', 404);
    return rows[0];
  }

  async function saveReview({ reviewId = randomUUID(), captureId, options = {}, note = '', comparisonCaptureId, expectedCaptureSha256 } = {}) {
    operationId(reviewId);
    if (typeof note !== 'string' || note.length > 24000) fail('Keep the decision note below 24,000 characters.');
    const existing = await readOrNull(join(folders.reviews, reviewId + '.json'), 64 * 1024 * 1024);
    if (existing) {
      if (existing.captureId !== captureId || existing.note !== note || json(existing.requestedOptions) !== json(options) ||
          (existing.comparisonCaptureId ?? null) !== (comparisonCaptureId ?? null) ||
          (expectedCaptureSha256 && existing.captureSha256 !== expectedCaptureSha256))
        fail('This review name already records a different decision.', 'WQX_REVIEW_CHANGED', 409);
      return readReview(reviewId);
    }
    const result = await analyze({ captureId, options, comparisonCaptureId });
    if (expectedCaptureSha256 && result.captureSha256 !== expectedCaptureSha256)
      fail('The source capture changed since this review was opened.', 'WQX_CAPTURE_CHANGED', 409);
    const request = await readRequest(captureId);
    const content = { schema: 'starforge.wqx-water-quality-review.v1', reviewId, captureId, comparisonCaptureId: comparisonCaptureId ?? null,
      title: request.title, revision: request.revision, requestedOptions: options, note, ...result };
    const saved = { ...content, reviewSha256: sha(content) };
    await immutable(folders.reviews, reviewId + '.json', saved);
    return saved;
  }
  async function readReview(id) {
    operationId(id);
    const saved = await readPrivateJson(join(folders.reviews, id + '.json'), 64 * 1024 * 1024);
    const { reviewSha256, ...content } = saved;
    if (saved.schema !== 'starforge.wqx-water-quality-review.v1' || saved.reviewId !== id || sha(content) !== reviewSha256)
      fail('The retained review changed.', 'WQX_REVIEW_CHANGED', 409);
    return saved;
  }
  async function listReviews() {
    const rows = [];
    for (const name of await names(folders.reviews)) {
      const review = await readReview(name.slice(0, -5));
      rows.push({ reviewId: review.reviewId, captureId: review.captureId, title: review.title, revision: review.revision,
        reviewSha256: review.reviewSha256, captureSha256: review.captureSha256, options: review.analysis.options,
        counts: review.analysis.inventory, note: review.note });
    }
    return rows;
  }
  async function exportReview({ reviewId, format = 'html' }) {
    const review = await readReview(reviewId);
    if (format === 'json') return { bytes: Buffer.from(json(review)), mime: 'application/json', filename: reviewId + '-review.json' };
    if (format === 'html') return { bytes: Buffer.from(renderWaterQualityReport({ ...review.analysis, captureComparison: review.comparison }, { title: review.title, note: review.note })),
      mime: 'text/html; charset=utf-8', filename: reviewId + '-report.html' };
    const source = await capture(review.captureId);
    if (source.captureSha256 !== review.captureSha256) fail('The original source differs from this saved review.', 'WQX_CAPTURE_CHANGED', 409);
    const model = await joinCapture(source);
    if (format === 'csv') return { bytes: Buffer.from(waterQualityObservationCsv(model, review.requestedOptions)), mime: 'text/csv; charset=utf-8', filename: reviewId + '-observations.csv' };
    if (format === 'geojson') { const value = waterQualityObservationGeoJson(model, review.requestedOptions); return { bytes: Buffer.from(typeof value === 'string' ? value : json(value)), mime: 'application/geo+json', filename: reviewId + '-observations.geojson' }; }
    fail('Choose html, json, csv, or geojson.');
  }
  async function edition({ editionId = randomUUID(), reviewId }) {
    operationId(editionId);
    const review = await readReview(reviewId), retained = await capture(review.captureId);
    if (retained.captureSha256 !== review.captureSha256)
      fail('This source changed after the saved review.', 'WQX_CAPTURE_CHANGED', 409);
    if (retained.status !== 'COMPLETE') fail('Resume the original capture to completion before creating a merchant edition.', 'WQX_CAPTURE_PARTIAL', 409);
    return prepareQualityEdition({ directory: join(folders.editions, editionId), capture: retained, analysis: review.analysis,
      review: { reviewId, reviewSha256: review.reviewSha256, note: review.note, comparison: review.comparison } });
  }
  async function listEditions() {
    const entries = (await readdir(folders.editions, { withFileTypes: true })).filter(x => x.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(x.name));
    const result = [];
    for (const entry of entries) {
      try {
        const row = await readQualityEdition(join(folders.editions, entry.name));
        result.push({ ...row, workspaceEditionId: entry.name, directory: join(folders.editions, entry.name) });
      } catch (error) { if (error.code === 'ENOENT') result.push({ workspaceEditionId: entry.name, status: 'INCOMPLETE' }); else throw error; }
    }
    return result;
  }
  return { root, read, save: args => tracked(() => save(args)), history: async () => Promise.all((await names(folders.revisions)).map(name => readPrivateJson(join(folders.revisions, name)))),
    acquire: args => tracked(() => acquire(args)), listCaptures, capture, analyze, saveReview: args => tracked(() => saveReview(args)),
    readReview, listReviews, exportReview, readResult,
    importCapture: args => tracked(() => importCapture(args)), exportReviewBundle,
    receiveReviewBundle: args => tracked(() => receiveReviewBundle(args)),
    prepareEdition: args => tracked(() => serial(() => edition(args))),
    readEdition: id => readQualityEdition(join(folders.editions, operationId(id))),
    listEditions,
    stageEdition: ({ editionId, ...args }) => tracked(() => serial(() => stageQualityMerchant({ ...args, editionDirectory: join(folders.editions, operationId(editionId)) }))),
    startEdition: ({ editionId, ...args }) => tracked(() => startQualityMerchant({ ...args, editionDirectory: join(folders.editions, operationId(editionId)) })),
    cancelCapture(id) { operationId(id); const run = acquisitions.get(id); if (run) run.controller.abort(new Error('Capture cancelled by the operator.')); return { operationId: id, cancellationRequested: Boolean(run) }; },
    close() {
      return closePromise ??= (async () => {
        closing = true;
        for (const run of acquisitions.values()) run.controller.abort(new Error('The workspace is closing; retain this capture for reopening.'));
        await Promise.allSettled([...operations]); await pending; closed = true; return { closed: true };
      })();
    },
  };
}
