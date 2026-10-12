// MIT. Immutable complete analyst files, native publication and portable receiving.
import { join, resolve } from 'node:path';
import { open, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readPrivateJson, withPrivateLock } from '../../routescan/quota.mjs';
import { readBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { MAX_ASSET_BYTES, MAX_ASSET_BUDGET } from '../../response-asset.mjs';
import { need, canonical, FRED_NOTICE, FRED_TERMS } from '../model.mjs';
import { hash, digest, jsonBytes, validateCapture } from '../source.mjs';
import { validateFredReview } from '../review.mjs';
import { BRIEFING_MODEL, buildFredBriefingModel } from './model.mjs';
import { fredBriefingCsv, renderFredBriefing } from './report.mjs';

export const BRIEFING_FILES = 'stellar-forge.fred-briefing-files.v1';
export const BRIEFING_TRANSFER = 'stellar-forge.fred-briefing-transfer.v1';
export const BRIEFING_MEMBERS = Object.freeze([
  { path: 'briefing.json', contentType: 'application/json', role: 'BRIEFING_DATA' },
  { path: 'briefing-measures.csv', contentType: 'text/csv', role: 'BRIEFING_MEASURES' },
  { path: 'briefing.html', contentType: 'text/html', role: 'BRIEFING_REPORT' },
]);
export const BRIEFING_MANIFEST_MEMBER = Object.freeze({ path: 'briefing-manifest.json', contentType: 'application/json', role: 'BRIEFING_MANIFEST' });
const SHA = /^[a-f0-9]{64}$/;
const member = (definition, bytes) => ({ ...definition, bytes: bytes.length, sha256: hash(bytes) });
function manifestIdentity(value) {
  return { schema: BRIEFING_FILES, captureId: value.captureId, reviewId: value.reviewId, reportId: value.reportId,
    calculationVersion: value.calculationVersion, rendererVersion: value.rendererVersion, files: value.files };
}
function reportIdentity(value) { const { reportId, ...body } = value; return body; }
function verifyManifest(manifest, { captureId, reviewId } = {}) {
  need(manifest?.schema === BRIEFING_FILES && SHA.test(manifest.captureId) && SHA.test(manifest.reviewId) &&
    /^fred-briefing-[a-f0-9]{64}$/.test(manifest.reportId ?? '') &&
    manifest.manifestSha256 === digest(manifestIdentity(manifest)), 'The retained briefing manifest changed.', 'FRED_BRIEFING_IDENTITY_CHANGED');
  need((captureId === undefined || captureId === manifest.captureId) && (reviewId === undefined || reviewId === manifest.reviewId),
    'Select the briefing from its original capture and review.', 'FRED_BRIEFING_IDENTITY_CHANGED');
  need(manifest.calculationVersion === 'FRED_EXACT_PERIOD_V1' && manifest.rendererVersion === 'FRED_OFFLINE_REPORT_V1' &&
    Array.isArray(manifest.files) && manifest.files.length === BRIEFING_MEMBERS.length, 'Use the original complete briefing file inventory.');
  for (let index = 0; index < BRIEFING_MEMBERS.length; index++) {
    const actual = manifest.files[index], expected = BRIEFING_MEMBERS[index];
    need(actual && actual.path === expected.path && actual.role === expected.role && actual.contentType === expected.contentType &&
      SHA.test(actual.sha256) && Number.isSafeInteger(actual.bytes) && actual.bytes > 0 && actual.bytes <= MAX_ASSET_BYTES,
      'The original briefing member descriptor changed.');
  }
  need(manifest.files.reduce((sum, item) => sum + item.bytes, 0) <= MAX_ASSET_BUDGET - 65536,
    'The complete briefing exceeds the native asset budget.', 'FRED_BRIEFING_FILE_CAPACITY');
  return manifest;
}
function verifyReport(report, manifest) {
  need(report?.schema === BRIEFING_MODEL && report.reportId === manifest.reportId && report.captureId === manifest.captureId &&
    report.reviewId === manifest.reviewId && report.reportId === 'fred-briefing-' + digest(reportIdentity(report)),
    'The original briefing data identity changed.', 'FRED_BRIEFING_IDENTITY_CHANGED');
  need(Array.isArray(report.observations) && Array.isArray(report.measures) && Array.isArray(report.series) &&
    report.observationCount === report.observations.length && report.measureCount === report.measures.length,
    'The retained briefing data inventory changed.');
  for (const row of report.measures) need(Number.isSafeInteger(row.currentIndex) && row.currentIndex >= 0 &&
    row.currentIndex < report.observations.length && (row.baselineIndex === null ||
      Number.isSafeInteger(row.baselineIndex) && row.baselineIndex >= 0 && row.baselineIndex < report.observations.length),
    'A briefing measure lost its original observation.');
  return report;
}
function reportJSON(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, 'Retain the complete original UTF-8 briefing JSON.'); }
}
export function createFredBriefingFiles({ capture, review } = {}) {
  const model = validateCapture(capture); validateFredReview(review, model);
  need(review.briefing && review.captureId === capture.captureSha256, 'Select a saved analyst review for the original source.');
  const body = { ...buildFredBriefingModel({ model, captureId: capture.captureSha256, reviewId: review.id, selection: review.briefing }),
    sourceNotice: FRED_NOTICE, sourceTerms: FRED_TERMS };
  const report = { ...body, reportId: 'fred-briefing-' + digest(body) };
  const buffers = [Buffer.from(JSON.stringify(report) + '\n'), Buffer.from(fredBriefingCsv(report)), Buffer.from(renderFredBriefing(report))];
  const files = BRIEFING_MEMBERS.map((definition, index) => ({ ...member(definition, buffers[index]), body: buffers[index] }));
  const manifest = { schema: BRIEFING_FILES, captureId: report.captureId, reviewId: report.reviewId, reportId: report.reportId,
    calculationVersion: body.calculation.version, rendererVersion: 'FRED_OFFLINE_REPORT_V1',
    files: files.map(({ body, ...descriptor }) => descriptor) };
  manifest.manifestSha256 = digest(manifestIdentity(manifest)); verifyManifest(manifest);
  const manifestBytes = jsonBytes(manifest);
  files.push({ ...member(BRIEFING_MANIFEST_MEMBER, manifestBytes), body: manifestBytes });
  return { manifest, report, files };
}
export function validateFredBriefingFiles(value, binding = {}) {
  const manifest = verifyManifest(value?.manifest, binding);
  need(Array.isArray(value.files) && value.files.length === BRIEFING_MEMBERS.length + 1,
    'Retain all original briefing files.');
  const manifestBytes = jsonBytes(manifest), descriptors = [...manifest.files, member(BRIEFING_MANIFEST_MEMBER, manifestBytes)];
  for (let index = 0; index < descriptors.length; index++) {
    const actual = value.files[index], expected = descriptors[index];
    need(actual && Buffer.isBuffer(actual.body) && actual.body.length === expected.bytes && hash(actual.body) === expected.sha256 &&
      Object.keys(expected).every(key => actual[key] === expected[key]),
      'An original complete briefing file changed.', 'FRED_BRIEFING_FILE_CHANGED');
  }
  const report = verifyReport(reportJSON(value.files[0].body), manifest);
  return { manifest, report, files: value.files };
}
async function exactBytes(directory, name, bytes) {
  const temporary = join(directory, '.' + name + '.' + randomUUID() + '.part'), destination = join(directory, name);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    try { await link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const original = await readBytes(destination, bytes.length);
      need(original.length === bytes.length && original.equals(bytes),
        'The selected briefing directory retains a different file.', 'FRED_BRIEFING_FILE_CONFLICT', 409);
    }
    await unlink(temporary);
    const folder = await open(directory, 'r'); try { await folder.sync(); } finally { await folder.close(); }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function retainFredBriefingFiles({ directory, value } = {}) {
  directory = await privateDirectory(resolve(directory));
  const checked = validateFredBriefingFiles(value);
  return withPrivateLock(directory, 'briefing.lock', async () => {
    // Publish the full manifest last, after every immutable member has completed.
    for (const file of checked.files) await exactBytes(directory, file.path, file.body);
    return { directory, ...checked };
  });
}
export async function prepareFredBriefingFiles({ directory, capture, review } = {}) {
  return retainFredBriefingFiles({ directory, value: createFredBriefingFiles({ capture, review }) });
}
export async function readFredBriefingFiles(directory, { captureId, reviewId, includeFiles = false } = {}) {
  directory = resolve(directory);
  const manifest = verifyManifest(await readPrivateJson(join(directory, BRIEFING_MANIFEST_MEMBER.path), 65536), { captureId, reviewId });
  const definition = manifest.files[0], bytes = await readBytes(join(directory, definition.path), definition.bytes);
  need(bytes.length === definition.bytes && hash(bytes) === definition.sha256, 'The retained briefing data file changed.');
  const report = verifyReport(reportJSON(bytes), manifest);
  if (!includeFiles) return { directory, manifest, report };
  const files = [];
  for (const definition of [...manifest.files, member(BRIEFING_MANIFEST_MEMBER, jsonBytes(manifest))]) {
    const body = await readBytes(join(directory, definition.path), definition.bytes);
    files.push({ ...definition, body });
  }
  return { directory, ...validateFredBriefingFiles({ manifest, files }, { captureId, reviewId }) };
}
export async function readFredBriefingMember(directory, { captureId, reviewId, format } = {}) {
  const selected = { json: 'briefing.json', csv: 'briefing-measures.csv', html: 'briefing.html', manifest: 'briefing-manifest.json' }[format];
  need(selected, 'Select the original HTML, CSV, JSON or manifest file.');
  const manifest = verifyManifest(await readPrivateJson(join(resolve(directory), BRIEFING_MANIFEST_MEMBER.path), 65536), { captureId, reviewId });
  const descriptor = selected === BRIEFING_MANIFEST_MEMBER.path ? member(BRIEFING_MANIFEST_MEMBER, jsonBytes(manifest))
    : manifest.files.find(file => file.path === selected);
  const body = await readBytes(join(resolve(directory), selected), descriptor.bytes);
  need(body.length === descriptor.bytes && hash(body) === descriptor.sha256, 'The retained briefing download changed.');
  return { ...descriptor, body, captureId: manifest.captureId, reviewId: manifest.reviewId, reportId: manifest.reportId };
}
export function exportFredBriefingFiles(value) {
  const checked = validateFredBriefingFiles(value);
  return { schema: BRIEFING_TRANSFER, manifest: checked.manifest,
    files: checked.files.map(({ body, ...descriptor }) => ({ ...descriptor, content_base64: body.toString('base64') })) };
}
export async function receiveFredBriefingFiles({ directory, transfer, capture, review } = {}) {
  need(transfer?.schema === BRIEFING_TRANSFER && Array.isArray(transfer.files) && transfer.files.length === 4,
    'Receive the complete original briefing transfer.');
  const manifest = verifyManifest(transfer.manifest, { captureId: capture.captureSha256, reviewId: review.id });
  let capacity = 0;
  const files = transfer.files.map(file => {
    need(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= MAX_ASSET_BYTES && typeof file.content_base64 === 'string' &&
      file.content_base64.length <= Math.ceil(file.bytes / 3) * 4, 'Retain a complete bounded briefing file.');
    capacity += file.bytes; need(capacity <= MAX_ASSET_BUDGET, 'The original briefing transfer exceeds its native capacity.');
    const body = Buffer.from(file.content_base64, 'base64');
    need(body.toString('base64') === file.content_base64, 'The complete original briefing base64 changed.');
    const { content_base64, ...descriptor } = file; return { ...descriptor, body };
  });
  const checked = validateFredBriefingFiles({ manifest, files });
  const source = validateCapture(capture); validateFredReview(review, source);
  const expected = { ...buildFredBriefingModel({ model: source, captureId: capture.captureSha256, reviewId: review.id, selection: review.briefing }),
    sourceNotice: FRED_NOTICE, sourceTerms: FRED_TERMS };
  need(canonical(reportIdentity(checked.report)) === canonical(expected),
    'The received analyst measures differ from the original source and review.', 'FRED_BRIEFING_SOURCE_CHANGED');
  return retainFredBriefingFiles({ directory, value: checked });
}
