// MIT. Portable capture refresh packets around the original HAR workspace store.
import { constants as C } from 'node:fs';
import { open, lstat, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  prepare, openWorkspace, readRevision, readRegular, copyWorkspace,
  inspectWorkspace, saveReview, exportReview, digest,
} from './store.mjs';
import { canonical } from './model.mjs';
import { createRefreshPlan, REFRESH_SCHEMA } from './refresh-model.mjs';

const MAX_JSON = 4 * 1024 * 1024;
const MAX_REPORT = 32 * 1024 * 1024;
const FILES = ['change-report.json', 'draft.json', 'review.html'];
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = (previousSourceSha256, previousReviewSha256, candidateSourceSha256) => ({
  schema: REFRESH_SCHEMA, previousSourceSha256, previousReviewSha256, candidateSourceSha256,
});
async function syncDirectory(path) {
  const fd = await open(path, C.O_RDONLY);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function privateDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077))
    throw new Error('Refresh packet requires a private nonsymlink directory: ' + path);
}
async function writeNew(path, bytes) {
  const fd = await open(path, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function createDirectory(destination, build) {
  destination = resolve(destination);
  // Exclusive reservation and inode comparison preserve another writer's directory.
  await mkdir(destination, { mode: 0o700 });
  const reserved = await lstat(destination);
  const stage = join(dirname(destination), '.' + basename(destination) + '.' + randomUUID() + '.refresh-stage');
  let published = false;
  try {
    await mkdir(stage, { mode: 0o700 });
    await build(stage); await syncDirectory(stage);
    const current = await lstat(destination);
    if (current.ino !== reserved.ino || current.dev !== reserved.dev || (await readdir(destination)).length)
      throw new Error('Refresh destination reservation changed');
    await rename(stage, destination); published = true;
    await syncDirectory(dirname(destination));
  } catch (error) {
    if (!published) {
      await rm(stage, { recursive: true, force: true });
      try {
        const current = await lstat(destination);
        if (current.ino === reserved.ino && current.dev === reserved.dev && !(await readdir(destination)).length)
          await rm(destination, { recursive: true });
      } catch {}
    }
    throw error;
  }
}

export async function openRefresh(directory) {
  const root = resolve(directory); await privateDirectory(root);
  const manifest = json(await readRegular(join(root, 'refresh.json'), MAX_JSON, true));
  if (manifest.schema !== 'stellar.har-refresh-packet.v1' || !manifest.lineage ||
      manifest.lineage.schema !== REFRESH_SCHEMA ||
      !hash(manifest.lineage.previousSourceSha256) || !hash(manifest.lineage.previousReviewSha256) ||
      !hash(manifest.lineage.candidateSourceSha256))
    throw new Error('Invalid HAR refresh packet manifest');
  const expectedId = digest(Buffer.from(canonical(manifest.lineage)));
  if (manifest.operationId !== expectedId) throw new Error('Refresh operation identity changed');
  const previous = await openWorkspace(join(root, 'previous'));
  const candidate = await openWorkspace(join(root, 'candidate'));
  if (previous.manifest.sourceSha256 !== manifest.lineage.previousSourceSha256 ||
      candidate.manifest.sourceSha256 !== manifest.lineage.candidateSourceSha256)
    throw new Error('Refresh packet source edition changed');
  const saved = await readRevision(previous, manifest.lineage.previousReviewSha256);
  const computed = createRefreshPlan(previous.inventory, saved.review, candidate.inventory, saved.revision);
  const bytes = {};
  for (const filename of FILES) {
    const limit = filename === 'draft.json' ? MAX_JSON : MAX_REPORT;
    const descriptor = manifest.files?.[filename];
    if (!descriptor || !hash(descriptor.sha256) || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > limit)
      throw new Error('Invalid refresh file descriptor: ' + filename);
    bytes[filename] = await readRegular(join(root, filename), limit, true);
    if (bytes[filename].length !== descriptor.bytes || digest(bytes[filename]) !== descriptor.sha256)
      throw new Error('Retained refresh file changed: ' + filename);
  }
  const report = json(bytes['change-report.json']), draft = json(bytes['draft.json']);
  if (canonical(report) !== canonical(computed.report) || canonical(draft) !== canonical(computed.review))
    throw new Error('Refresh decisions or comparison disagree with their original source editions');
  return { root, manifest, previous, candidate, report, draft, bytes };
}

function result(packet, reused = false) {
  return {
    directory: packet.root, operationId: packet.manifest.operationId, reused,
    previousWorkspace: packet.previous.root, candidateWorkspace: packet.candidate.root,
    previousSourceSha256: packet.previous.manifest.sourceSha256,
    previousReviewSha256: packet.manifest.lineage.previousReviewSha256,
    candidateSourceSha256: packet.candidate.manifest.sourceSha256,
    reviewPage: join(packet.root, 'review.html'), draftFile: join(packet.root, 'draft.json'),
    reportFile: join(packet.root, 'change-report.json'), summary: packet.report.summary,
  };
}

export async function prepareRefresh({ workspace, revision, harFile, destination }) {
  const previous = await openWorkspace(workspace), saved = await readRevision(previous, revision);
  const candidateSha = digest(await readRegular(harFile));
  const lineage = identity(previous.manifest.sourceSha256, saved.revision, candidateSha);
  destination = resolve(destination);
  if (await exists(destination)) {
    const retained = await openRefresh(destination);
    if (canonical(retained.manifest.lineage) !== canonical(lineage))
      throw new Error('Refresh destination belongs to a different source/review selection');
    return result(retained, true);
  }
  await createDirectory(destination, async stage => {
    await copyWorkspace(previous.root, join(stage, 'previous'));
    await prepare(harFile, join(stage, 'candidate'));
    const before = await openWorkspace(join(stage, 'previous'));
    const candidate = await openWorkspace(join(stage, 'candidate'));
    if (candidate.manifest.sourceSha256 !== candidateSha) throw new Error('Candidate capture changed during refresh preparation');
    const original = await readRevision(before, saved.revision);
    const { report, review } = createRefreshPlan(before.inventory, original.review, candidate.inventory, original.revision);
    const draftBytes = encode(review), reportBytes = encode(report);
    if (draftBytes.length > MAX_JSON || reportBytes.length > MAX_REPORT)
      throw new Error('Refresh exceeds the original review or comparison size limit');
    const manifest = {
      schema: 'stellar.har-refresh-packet.v1', operationId: digest(Buffer.from(canonical(lineage))), lineage, files: {},
    };
    const { renderRefreshReview } = await import('./refresh-review.mjs');
    const page = Buffer.from(await renderRefreshReview({ manifest, report, previous: before, candidate, draft: review }, review));
    if (page.length > MAX_REPORT) throw new Error('Offline refresh page exceeds 32 MiB');
    for (const [filename, bytes] of [['change-report.json', reportBytes], ['draft.json', draftBytes], ['review.html', page]]) {
      await writeNew(join(stage, filename), bytes);
      manifest.files[filename] = { sha256: digest(bytes), bytes: bytes.length };
    }
    await writeNew(join(stage, 'refresh.json'), encode(manifest));
    await openRefresh(stage);
  });
  return result(await openRefresh(destination));
}

export async function inspectRefresh(directory) {
  const packet = await openRefresh(directory);
  const candidate = await inspectWorkspace(packet.candidate.root);
  return { ...result(packet), candidateReviews: candidate.reviews,
    changedOperations: packet.report.operations.filter(row => row.status !== 'carried').map(row => ({
      operationId: row.operationId, method: row.method, path: row.path, status: row.status,
      changedSections: row.changes.map(change => change.section),
    })),
    ambiguousGroups: packet.report.ambiguous,
  };
}

function requireLineage(packet, review) {
  if (review.sourceSha256 !== packet.candidate.manifest.sourceSha256 ||
      canonical(review['x-har-refresh']) !== canonical(packet.manifest.lineage))
    throw new Error('Decisions must retain this refresh packet source/review lineage');
}

export async function saveRefreshReview(directory, decisionFile) {
  const packet = await openRefresh(directory);
  const bytes = await readRegular(decisionFile, MAX_JSON);
  const review = json(bytes); requireLineage(packet, review);
  // Snapshot the caller's exact bytes before the native writer reads its input.
  const temporary = join(packet.root, '.decisions.' + randomUUID() + '.json');
  await writeNew(temporary, bytes);
  try {
    const saved = await saveReview(packet.candidate.root, temporary);
    return { ...saved, directory: packet.root, operationId: packet.manifest.operationId,
      workspace: packet.candidate.root, previousReviewSha256: packet.manifest.lineage.previousReviewSha256 };
  } finally { await rm(temporary, { force: true }); }
}

export async function writeRefreshPage(directory, destination, revision) {
  const packet = await openRefresh(directory);
  const review = revision ? (await readRevision(packet.candidate, revision)).review : packet.draft;
  requireLineage(packet, review);
  const { renderRefreshReview } = await import('./refresh-review.mjs');
  const bytes = Buffer.from(await renderRefreshReview(packet, review));
  if (bytes.length > MAX_REPORT) throw new Error('Offline refresh page exceeds 32 MiB');
  await writeNew(resolve(destination), bytes);
  return { reviewPage: resolve(destination), operationId: packet.manifest.operationId,
    candidateSourceSha256: packet.candidate.manifest.sourceSha256, revision: revision || null };
}

export async function exportRefresh(directory, revision, destination) {
  const packet = await openRefresh(directory);
  requireLineage(packet, (await readRevision(packet.candidate, revision)).review);
  return { ...(await exportReview(packet.candidate.root, revision, destination)),
    operationId: packet.manifest.operationId, previousReviewSha256: packet.manifest.lineage.previousReviewSha256 };
}

export async function packageRefresh({ directory, revision, planFile, parent, name }) {
  const packet = await openRefresh(directory);
  requireLineage(packet, (await readRevision(packet.candidate, revision)).review);
  const { saveHarMerchant } = await import('./merchant.mjs');
  return saveHarMerchant({ workspace: packet.candidate.root, revision, planFile, parent, name });
}

export async function copyRefresh(directory, destination) {
  const packet = await openRefresh(directory); destination = resolve(destination);
  if (destination === packet.root) throw new Error('Choose a new receiving packet directory');
  await createDirectory(destination, async stage => {
    await copyWorkspace(packet.previous.root, join(stage, 'previous'));
    await copyWorkspace(packet.candidate.root, join(stage, 'candidate'));
    for (const filename of FILES) await writeNew(join(stage, filename), packet.bytes[filename]);
    await writeNew(join(stage, 'refresh.json'), encode(packet.manifest));
    await openRefresh(stage);
  });
  return result(await openRefresh(destination));
}
