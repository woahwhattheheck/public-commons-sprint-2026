// MIT. A retained project joins native USGS capture, analysis, editions and original commerce.
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { normalizeSelection, captureSelection, readCapture, captureRows } from './provider.mjs';
import { analyzeCapture, compareCaptures, observationsCsv, observationsGeoJson, renderReport } from './analysis.mjs';
import { prepareWaterEdition, stageWaterMerchant, startWaterMerchant, readWaterEdition } from './merchant.mjs';

const SCHEMA = 'starforge.usgs-water-project.v1';
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
function fail(message, code = 'WATER_PROJECT_INVALID', status = 400) { throw Object.assign(new Error(message), { code, status }); }
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
    if (json(retained) !== json(value)) fail('This saved operation name already contains different work. Reopen it or choose a new name.', 'WATER_OPERATION_CHANGED', 409);
    return retained;
  }
}
function captureSummary(capture) {
  return { operationId: capture.operationId, status: capture.status, captureSha256: capture.captureSha256 ?? null,
    selection: capture.selection, summary: capture.summary ?? null, pages: capture.pages?.length ?? 0,
    startedAt: capture.startedAt ?? null, completedAt: capture.completedAt ?? null,
    updatedAt: new Date().toISOString(), retryAt: capture.retryAt ?? null, error: capture.error ?? null };
}
async function names(folder, extension = '.json') {
  return (await readdir(folder)).filter(name => name.endsWith(extension) && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)).sort();
}
export async function openWaterProject(directory, { transport, env = process.env } = {}) {
  const root = await privateDirectory(resolve(directory));
  const folders = {};
  for (const name of ['revisions', 'requests', 'captures', 'capture-summaries', 'reviews', 'editions']) folders[name] = await privateDirectory(join(root, name));
  let pending = Promise.resolve(), closing = false, closed = false, closePromise;
  const operations = new Set(), acquisitions = new Map();
  function active() { if (closed || closing) fail('The project is closing.', 'WATER_PROJECT_CLOSED', 503); }
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
        sha(saved.selection) !== saved.selectionSha256)) fail('The retained project metadata changed.', 'WATER_PROJECT_CORRUPT', 409);
    return saved;
  }
  async function current(expectedRevision) {
    const saved = await read();
    if (!saved || !Number.isSafeInteger(expectedRevision) || expectedRevision !== saved.revision)
      fail('The project changed in another view. Refresh and continue from its saved revision.', 'WATER_REVISION_CHANGED', 409);
    return saved;
  }
  async function save({ title, selection, expectedRevision = 0 }) {
    return serial(async () => {
      const normalized = normalizeSelection(selection), name = titleOf(title), previous = await read();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (previous?.revision ?? 0))
        fail('The project changed in another view. Refresh before saving.', 'WATER_REVISION_CHANGED', 409);
      const selectionSha256 = sha(normalized);
      if (previous?.title === name && previous.selectionSha256 === selectionSha256) return previous;
      const at = new Date().toISOString(), revision = expectedRevision + 1;
      let next = { schema: SCHEMA, revision, title: name, selection: normalized, selectionSha256,
        createdAt: previous?.createdAt ?? at, updatedAt: at };
      const path = join(folders.revisions, revision + '.json'), retained = await readOrNull(path);
      if (retained) {
        if (retained.schema !== SCHEMA || retained.revision !== revision || retained.title !== name || retained.selectionSha256 !== selectionSha256)
          fail('An interrupted save retained a different revision. Its original file is preserved.', 'WATER_REVISION_CHANGED', 409);
        next = retained;
      } else await immutable(folders.revisions, revision + '.json', next);
      await atomicJson(root, 'project.json', next); return next;
    });
  }
  async function readRequest(id) {
    operationId(id);
    const request = await readPrivateJson(join(folders.requests, id + '.json'));
    if (request.schema !== 'starforge.usgs-water-project-request.v1' || request.operationId !== id || sha(request.selection) !== request.selectionSha256)
      fail('The original capture request changed.', 'WATER_REQUEST_CHANGED', 409);
    return request;
  }
  async function acquire({ operationId: id = randomUUID(), expectedRevision, signal, onProgress } = {}) {
    operationId(id);
    if (acquisitions.has(id)) fail('This capture is already active. Read its progress or cancel it.', 'WATER_CAPTURE_ACTIVE', 409);
    const controller = new AbortController();
    const holder = { controller, progress: null, status: 'PREPARING' };
    acquisitions.set(id, holder);
    try {
      const request = await serial(async () => {
        const retained = await readOrNull(join(folders.requests, id + '.json'));
        if (retained) {
          if (retained.revision !== expectedRevision) fail('This capture belongs to another saved project revision.', 'WATER_OPERATION_CHANGED', 409);
          return readRequest(id);
        }
        const saved = await current(expectedRevision);
        return immutable(folders.requests, id + '.json', { schema: 'starforge.usgs-water-project-request.v1',
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
    if (sha(result.selection) !== request.selectionSha256) fail('The capture belongs to another original selection.', 'WATER_CAPTURE_CHANGED', 409);
    return result;
  }
  async function analyze({ captureId, options = {}, comparisonCaptureId } = {}) {
    const retained = await capture(captureId), rows = await captureRows(retained);
    const analysis = analyzeCapture(retained, rows, options);
    let comparison = null;
    if (comparisonCaptureId) {
      const previous = await capture(comparisonCaptureId), previousRows = await captureRows(previous);
      comparison = compareCaptures(previous, previousRows, retained, rows);
    }
    return { analysis, comparison };
  }
  async function saveReview({ reviewId = randomUUID(), captureId, options = {}, note = '', comparisonCaptureId, expectedCaptureSha256 } = {}) {
    operationId(reviewId);
    if (typeof note !== 'string' || note.length > 24000) fail('Keep the decision note below 24,000 characters.');
    const existing = await readOrNull(join(folders.reviews, reviewId + '.json'), 64 * 1024 * 1024);
    if (existing) {
      if (existing.captureId !== captureId || existing.note !== note || json(existing.requestedOptions) !== json(options) ||
          (existing.comparisonCaptureId ?? null) !== (comparisonCaptureId ?? null) ||
          (expectedCaptureSha256 && existing.analysis.source.captureSha256 !== expectedCaptureSha256))
        fail('This review name already records a different decision.', 'WATER_REVIEW_CHANGED', 409);
      return readReview(reviewId);
    }
    const result = await analyze({ captureId, options, comparisonCaptureId });
    if (expectedCaptureSha256 && result.analysis.source.captureSha256 !== expectedCaptureSha256)
      fail('The source capture changed since this review was opened.', 'WATER_CAPTURE_CHANGED', 409);
    const request = await readRequest(captureId);
    const content = { schema: 'starforge.usgs-water-review.v1', reviewId, captureId, comparisonCaptureId: comparisonCaptureId ?? null,
      title: request.title, revision: request.revision, requestedOptions: options, note, ...result };
    const saved = { ...content, reviewSha256: sha(content) };
    await immutable(folders.reviews, reviewId + '.json', saved);
    return saved;
  }
  async function readReview(id) {
    operationId(id);
    const saved = await readPrivateJson(join(folders.reviews, id + '.json'), 64 * 1024 * 1024);
    const { reviewSha256, ...content } = saved;
    if (saved.schema !== 'starforge.usgs-water-review.v1' || saved.reviewId !== id || sha(content) !== reviewSha256)
      fail('The retained review changed.', 'WATER_REVIEW_CHANGED', 409);
    const { analysisSha256, ...analysis } = saved.analysis;
    if (sha(analysis) !== analysisSha256) fail('The saved analysis changed.', 'WATER_REVIEW_CHANGED', 409);
    return saved;
  }
  async function listReviews() {
    const rows = [];
    for (const name of await names(folders.reviews)) {
      const review = await readReview(name.slice(0, -5));
      rows.push({ reviewId: review.reviewId, captureId: review.captureId, title: review.title, revision: review.revision,
        reviewSha256: review.reviewSha256, captureSha256: review.analysis.source.captureSha256, options: review.analysis.options,
        counts: review.analysis.counts, note: review.note });
    }
    return rows;
  }
  async function exportReview({ reviewId, format = 'html' }) {
    const review = await readReview(reviewId);
    if (format === 'json') return { bytes: Buffer.from(json(review)), mime: 'application/json', filename: reviewId + '-review.json' };
    if (format === 'html') return { bytes: Buffer.from(renderReport(review.analysis, { title: review.title, note: review.note, comparison: review.comparison })),
      mime: 'text/html; charset=utf-8', filename: reviewId + '-report.html' };
    const source = await capture(review.captureId);
    if (source.captureSha256 !== review.analysis.source.captureSha256) fail('The original source differs from this saved review.', 'WATER_CAPTURE_CHANGED', 409);
    const rows = await captureRows(source);
    if (format === 'csv') return { bytes: Buffer.from(observationsCsv(rows)), mime: 'text/csv; charset=utf-8', filename: reviewId + '-observations.csv' };
    if (format === 'geojson') return { bytes: Buffer.from(observationsGeoJson(rows)), mime: 'application/geo+json', filename: reviewId + '-observations.geojson' };
    fail('Choose html, json, csv, or geojson.');
  }
  async function edition({ editionId = randomUUID(), reviewId }) {
    operationId(editionId);
    const review = await readReview(reviewId), retained = await capture(review.captureId);
    if (retained.captureSha256 !== review.analysis.source.captureSha256)
      fail('This source changed after the saved review.', 'WATER_CAPTURE_CHANGED', 409);
    if (retained.status !== 'COMPLETE') fail('Resume the original capture to completion before creating a merchant edition.', 'WATER_CAPTURE_PARTIAL', 409);
    return prepareWaterEdition({ directory: join(folders.editions, editionId), capture: retained, analysis: review.analysis,
      review: { reviewId, reviewSha256: review.reviewSha256, note: review.note, comparison: review.comparison } });
  }
  async function listEditions() {
    const entries = (await readdir(folders.editions, { withFileTypes: true })).filter(x => x.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(x.name));
    const result = [];
    for (const entry of entries) {
      try {
        const row = await readWaterEdition(join(folders.editions, entry.name));
        result.push({ ...row, workspaceEditionId: entry.name, directory: join(folders.editions, entry.name) });
      } catch (error) { if (error.code === 'ENOENT') result.push({ workspaceEditionId: entry.name, status: 'INCOMPLETE' }); else throw error; }
    }
    return result;
  }
  return { root, read, save: args => tracked(() => save(args)), history: async () => Promise.all((await names(folders.revisions)).map(name => readPrivateJson(join(folders.revisions, name)))),
    acquire: args => tracked(() => acquire(args)), listCaptures, capture, analyze, saveReview: args => tracked(() => saveReview(args)),
    readReview, listReviews, exportReview,
    prepareEdition: args => tracked(() => serial(() => edition(args))),
    readEdition: id => readWaterEdition(join(folders.editions, operationId(id))),
    listEditions,
    stageEdition: ({ editionId, ...args }) => tracked(() => serial(() => stageWaterMerchant({ ...args, editionDirectory: join(folders.editions, operationId(editionId)) }))),
    startEdition: ({ editionId, ...args }) => tracked(() => startWaterMerchant({ ...args, editionDirectory: join(folders.editions, operationId(editionId)) })),
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
