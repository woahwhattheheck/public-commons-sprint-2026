// MIT. Retain observed cache policy through the original merchant revision engine.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readPackage, privateParent, packageName } from './model.mjs';
import { reviewMerchantRevision, saveMerchantRevision, releaseCommands } from './revisions.mjs';
import { retentionFields } from '../../sf30-seller-sdk/response-cache/workspace/model.mjs';
import { operationLease } from '../../distribution/runtime-workspace/storage.mjs';

const SCHEMA = 'stellar-forge.cache-policy-revision-review.v1';
const BINDING = 'stellar-forge.cache-package-binding.v1';
const LINEAGE = 'stellar-forge.cache-policy-revision.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const LIMIT = 6 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const need = (condition, message, status) => { if (!condition) fail(message, status); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const noteText = value => typeof value === 'string' && value.length <= 2000 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const retention = value => Object.fromEntries(retentionFields.map(key => [key, value?.[key]]));
function identity(id) { need(typeof id === 'string' && UUID.test(id), 'Choose a retained cache policy review.'); return id; }

/** Host-owned metadata added to original inspect results before SQLite capture. */
export function cachePackageBinding(project) {
  return { schema: BINDING, name: project.name, id: project.manifest.id,
    sourceSha256: project.manifest.files[project.manifest.sourceFile ?? 'original-openapi.json'],
    planSha256: project.manifest.files['merchant-plan.json'] };
}
function samePackage(actual, expected) {
  return actual?.schema === BINDING && ['id', 'sourceSha256', 'planSha256'].every(key => actual[key] === expected[key]);
}
async function directory(parent, create = false) {
  const path = join(await privateParent(parent), '.cache-policy-reviews');
  if (create) try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateParent(path);
}
function validateRecord(value) {
  need(plain(value) && value.schema === SCHEMA && UUID.test(value.id ?? '') &&
    /^[a-f0-9]{64}$/.test(value.reviewSha256 ?? ''), 'Invalid retained cache policy review.');
  const { reviewSha256, ...body } = value;
  need(sha(canonical(body)) === reviewSha256, 'The retained cache policy review changed. Prepare a fresh review.', 409);
  need(plain(value.base) && Array.isArray(value.decisions) && Array.isArray(value.routeIds) &&
    value.routeIds.length > 0 && value.routeIds.length <= 64 &&
    plain(value.snapshot) && noteText(value.note), 'Incomplete retained cache policy review.');
  identity(value.id); packageName(value.name); packageName(value.base.name);
  return value;
}
async function readRecord(parent, id) {
  const path = join(await directory(parent), identity(id) + '.json'), info = await lstat(path);
  need(info.isFile() && info.nlink === 1 && (info.mode & 0o077) === 0 && info.size <= LIMIT,
    'Expected a private retained cache policy review within 6 MiB.');
  const bytes = await readFile(path);
  need(bytes.length <= LIMIT, 'Retained cache policy review exceeds 6 MiB.');
  const value = validateRecord(JSON.parse(bytes));
  need(value.id === id, 'Cache policy review identity differs from its filename.');
  return value;
}
async function writeRecord(parent, record) {
  const bytes = Buffer.from(json(record));
  need(bytes.length <= LIMIT, 'Selected review exceeds 6 MiB. Choose fewer routes.');
  const root = await directory(parent, true), path = join(root, identity(record.id) + '.json');
  const staging = join(root, '.pending-' + record.id + '-' + randomUUID());
  const file = await open(staging, 'wx', 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    // Share the original kernel lease with other review publishers. A partial
    // preparation keeps its temporary name and never enters the retained list.
    const lockPath = join(root, '.publish.lock'), lease = await operationLease(lockPath);
    try {
      try {
        await lstat(path);
        throw Object.assign(new Error('That retained review already exists.'), { code: 'EEXIST', status: 409 });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const held = await lease.stat(), named = await lstat(lockPath);
      need(held.dev === named.dev && held.ino === named.ino && held.nlink === 1,
        'Retained review publication lease changed.', 409);
      await rename(staging, path);
      const directoryHandle = await open(root, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } finally { await lease.close(); }
  } finally { await rm(staging, { force: true }); }
}
function checkSnapshot(project, row) {
  need(plain(row) && plain(row.inspection) && samePackage(row.inspection.package, cachePackageBinding(project)),
    'Save a current operating snapshot from this exact API package before retaining its policy.', 409);
}
function decisionsFor(project, snapshot, routeIds) {
  const ids = project.manifest.preview.routes.map(route => route.id);
  need(ids.length === project.plan.operations.length && new Set(ids).size === ids.length,
    'Saved route identities do not match the original plan.');
  need(Array.isArray(routeIds) && routeIds.length > 0 && routeIds.length <= 64 &&
    new Set(routeIds).size === routeIds.length && routeIds.every(id => typeof id === 'string' && ids.includes(id)),
    'Choose one or more distinct saved package routes.');
  const selected = new Set(routeIds), changes = [];
  const decisions = project.plan.operations.map((operation, index) => {
    const routeId = ids[index], settings = structuredClone(operation);
    for (const key of ['id', 'method', 'path']) delete settings[key];
    if (selected.has(routeId)) {
      const observed = snapshot.inspection.routes[routeId];
      need(plain(settings.cache) && settings.cache.enabled !== false && plain(observed?.limits),
        'The selected route must have an existing enabled cache policy: ' + routeId);
      const after = retention(observed.limits);
      need(Object.values(after).every(value => Number.isSafeInteger(value) && value > 0),
        'The saved snapshot lacks complete retention limits for ' + routeId);
      const before = retention(project.manifest.preview.routes[index].cache ?? settings.cache);
      settings.cache = { ...settings.cache, ...after };
      changes.push({ routeId, before, after,
        changed: retentionFields.some(key => before[key] !== after[key]) });
    }
    return { routeId, action: 'keep', settings };
  });
  need(changes.some(row => row.changed), 'The selected policy already matches this saved package. Choose a changed snapshot.');
  return { decisions, changes };
}
function operatingDecision(record) {
  const row = record.snapshot, inspection = row.inspection;
  const decision = { schema: LINEAGE, id: record.id, reviewSha256: record.reviewSha256,
    createdAt: record.createdAt, note: record.note, workspaceId: record.workspaceId,
    snapshotSha256: record.snapshotSha256,
    snapshot: { id: row.id, sourceId: row.sourceId, capturedAt: row.capturedAt, label: row.label,
      inspection: { instanceId: inspection.instanceId, revision: inspection.revision,
        package: inspection.package, routes: Object.fromEntries(record.routeIds.map(id => [id, inspection.routes[id]])) } },
    routeIds: record.routeIds, retention: record.changes };
  need(Buffer.byteLength(json(decision)) <= 768 * 1024, 'Selected operating lineage exceeds the package metadata limit. Choose fewer routes.');
  return decision;
}

/** Preparation is create-only and survives closing the workspace before saving. */
export async function prepareCachePolicyRevision({ parent, baseName, workspace, inspectionId, routeIds, name, note = '', validatePlan }) {
  packageName(name); need(name !== baseName, 'Choose a new package name for the retained policy.');
  need(noteText(note), 'Use a plain operating note within 2000 characters.');
  const project = await readPackage(parent, baseName), snapshot = workspace.inspection(inspectionId);
  checkSnapshot(project, snapshot);
  const { decisions, changes } = decisionsFor(project, snapshot, routeIds);
  const review = await reviewMerchantRevision({ parent, baseName, specText: project.specText, decisions, validatePlan });
  need(review.ready, review.authorization?.message ?? review.compilationError ?? 'Complete the original merchant revision review.', 409);
  const body = { schema: SCHEMA, id: randomUUID(), name, createdAt: new Date().toISOString(), base: review.base,
    workspaceId: workspace.snapshot().id, snapshot, snapshotSha256: sha(canonical(snapshot)),
    routeIds: [...routeIds], decisions, changes, note: note.trim(),
    merchantReviewSha256: review.reviewSha256, refreshReviewId: review.refreshReviewId };
  const record = { ...body, reviewSha256: sha(canonical(body)) };
  operatingDecision(record);
  await writeRecord(parent, record);
  return { record, review, state: 'PREPARED' };
}
async function savedCandidate(parent, record) {
  const folder = join(await privateParent(parent), packageName(record.name));
  try { await lstat(folder); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const project = await readPackage(parent, record.name), decision = project.sourceRevision?.operatingDecision;
  need(decision?.schema === LINEAGE && decision.id === record.id && decision.reviewSha256 === record.reviewSha256 &&
    canonical(project.sourceRevision.base) === canonical(record.base),
    'That package name is already used by another candidate. Prepare the policy under a new name.', 409);
  return { name: project.name, folder: project.folder, manifest: project.manifest,
    preview: project.manifest.preview, sourceRevision: project.sourceRevision,
    release: releaseCommands(project.folder, project.name) };
}
export async function readCachePolicyRevision({ parent, id, baseName }) {
  const record = await readRecord(parent, id);
  need(baseName === undefined || record.base.name === baseName, 'Choose a policy review for this package.', 409);
  const saved = await savedCandidate(parent, record);
  return { record, state: saved ? 'SAVED' : 'PREPARED', ...(saved ? { saved } : {}) };
}
export async function listCachePolicyRevisions({ parent, baseName, offset = 0, limit = 50 }) {
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
    'Choose a valid policy review page.');
  let path;
  try { path = await directory(parent); } catch (error) { if (error.code === 'ENOENT') return { reviews: [], count: 0, offset, limit }; throw error; }
  const entries = (await readdir(path, { withFileTypes: true })).filter(entry =>
    entry.isFile() && UUID.test(entry.name.slice(0, -5)) && entry.name.endsWith('.json'));
  const records = [];
  for (const entry of entries) {
    const record = await readRecord(parent, entry.name.slice(0, -5));
    if (baseName === undefined || record.base.name === baseName) records.push(record);
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return { reviews: records.slice(offset, offset + limit).map(record => ({
    id: record.id, name: record.name, createdAt: record.createdAt, note: record.note,
    snapshotLabel: record.snapshot.label, routeIds: record.routeIds, reviewSha256: record.reviewSha256
  })), count: records.length, offset, limit };
}
/** Repeating a completed save returns its exact original immutable package. */
export async function saveCachePolicyRevision({ parent, baseName, workspace, id, expectedReviewSha256, validatePlan }) {
  const record = await readRecord(parent, id);
  need(baseName === undefined || record.base.name === baseName, 'Choose a policy review for this package.', 409);
  need(record.reviewSha256 === expectedReviewSha256, 'The selected retained review changed. Reopen it before saving.', 409);
  const existing = await savedCandidate(parent, record);
  if (existing) return { record, state: 'SAVED', saved: existing, recovered: true };
  const project = await readPackage(parent, record.base.name), snapshot = workspace.inspection(record.snapshot.id);
  checkSnapshot(project, snapshot);
  need(sha(canonical(snapshot)) === record.snapshotSha256, 'The saved operating snapshot changed. Prepare a fresh review.', 409);
  const recomputed = decisionsFor(project, snapshot, record.routeIds);
  need(canonical(recomputed.decisions) === canonical(record.decisions),
    'The original package settings changed. Prepare a fresh policy review.', 409);
  let saved;
  try {
    saved = await saveMerchantRevision({ parent, baseName: record.base.name, name: record.name,
      specText: project.specText, decisions: record.decisions, expectedReviewSha256: record.merchantReviewSha256,
      expectedRefreshReviewId: record.refreshReviewId, validatePlan,
      operatingDecision: () => operatingDecision(record) });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const completed = await savedCandidate(parent, record);
    if (!completed) throw error;
    return { record, state: 'SAVED', saved: completed, recovered: true };
  }
  return { record, state: 'SAVED', saved, recovered: false };
}
/** The embedded host supplies the parent, package and authorization callback. */
export async function cachePolicyRevisionApi({ parent, baseName, workspace, validatePlan, operation, method, query, body = {} }) {
  const options = { parent, baseName, workspace, validatePlan };
  if (method === 'GET' && operation === 'policy-list')
    return { body: await listCachePolicyRevisions({ ...options, offset: Number(query.get('offset') ?? 0) }) };
  if (method === 'GET' && operation === 'policy-show')
    return { body: await readCachePolicyRevision({ ...options, id: query.get('id') }) };
  if (method === 'POST' && operation === 'policy-review')
    return { status: 201, body: await prepareCachePolicyRevision({ ...options, inspectionId: body.inspectionId,
      routeIds: body.routeIds, name: body.name, note: body.note }) };
  if (method === 'POST' && operation === 'policy-save')
    return { body: await saveCachePolicyRevision({ ...options, id: body.id, expectedReviewSha256: body.expectedReviewSha256 }) };
  return { status: 404, body: { error: 'Unknown retained policy operation.' } };
}
