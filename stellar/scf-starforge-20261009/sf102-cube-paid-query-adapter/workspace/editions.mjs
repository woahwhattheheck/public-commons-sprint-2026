// MIT. Retained metadata editions and reviewed transitions in the original Cube workbench.
import { join } from 'node:path';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inspectCubeMetadata, text } from '../onboarding/metadata.mjs';
import { captureCubeMetadata } from '../onboarding/workspace.mjs';
import { privateDirectory, readBytes, writeNew, newDirectory, syncDirectory,
  parse, json, sha256, fileBinding, readBoundFiles } from '../onboarding/files.mjs';
import { inspectCubeRefresh, prepareCubeRefresh } from './refresh.mjs';

const ID = /^[a-z][a-z0-9-]{0,79}$/;
const METADATA = 'stellar-forge.cube-metadata-edition.v1';
const REVIEW = 'stellar-forge.cube-schema-refresh.v1';
const key = prefix => `${prefix}-${Date.now()}-${randomUUID()}`;
const checkId = value => { if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('Select a retained item'); return value; };
function page(items, { offset = 0, limit = 20 } = {}) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError('Use a nonnegative offset and a page size from 1 to 100');
  return { items: items.slice(offset, offset + limit), total: items.length, offset, next: offset + limit < items.length ? offset + limit : null };
}
async function ensure(path) {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(path);
}
async function optional(path) {
  try { return await readBytes(path, { max: 65536, privateFile: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function openCubeEditions({ root, workbenchId, originalBytes, createdAt, inspectVersion, createVersion }) {
  const metadataRoot = await ensure(join(root, 'metadata-editions'));
  const reviewRoot = await ensure(join(root, 'schema-refreshes'));
  const original = { id: 'original', schema: METADATA, workbenchId, createdAt,
    label: 'Original workspace metadata', provenance: { kind: 'WORKSPACE_ORIGINAL' },
    files: { 'cube-meta.json': fileBinding(originalBytes) }, ...summary(parse(originalBytes, 'Original metadata')) };
  const index = new Map([['original', original]]), unreadable = [];
  for (const entry of await readdir(metadataRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID.test(entry.name)) continue;
    try {
      const saved = parse(await readBytes(join(metadataRoot, entry.name, 'edition.json'), { max: 65536, privateFile: true }), 'Metadata edition');
      validateEdition(saved, entry.name); index.set(entry.name, saved);
    } catch (error) { unreadable.push({ id: entry.name, status: 'UNAVAILABLE', error: error.message }); }
  }
  let active = null;
  function validateEdition(saved, name) {
    if (saved.schema !== METADATA || saved.id !== name || saved.workbenchId !== workbenchId || !Number.isFinite(Date.parse(saved.createdAt)) ||
        !/^[a-f0-9]{64}$/.test(saved.files?.['cube-meta.json']?.sha256 ?? '')) throw new TypeError('Invalid retained metadata edition');
  }
  function summary(raw) {
    const value = inspectCubeMetadata(raw);
    return { cubeCount: value.cubeCount, memberCount: value.memberCount, excludedMembers: value.excludedMembers };
  }
  function publicEdition(saved) {
    return { id: saved.id, createdAt: saved.createdAt, label: saved.label, provenance: saved.provenance,
      metadataSha256: saved.files['cube-meta.json'].sha256, bytes: saved.files['cube-meta.json'].bytes,
      cubeCount: saved.cubeCount, memberCount: saved.memberCount, excludedMembers: saved.excludedMembers, status: 'RETAINED' };
  }
  async function metadata(value = 'original') {
    const name = checkId(value), saved = index.get(name);
    if (!saved) throw new TypeError('Select a retained metadata edition');
    const directory = name === 'original' ? root : join(metadataRoot, name);
    const bytes = name === 'original' ? await readBytes(join(root, 'cube-meta.json'), { privateFile: true }) :
      (await readBoundFiles(directory, saved, ['cube-meta.json']))['cube-meta.json'];
    if (sha256(bytes) !== saved.files['cube-meta.json'].sha256) throw new TypeError('Retained metadata binding changed');
    const raw = parse(bytes, 'Cube metadata'), catalog = inspectCubeMetadata(raw);
    return { ...publicEdition(saved), bytes, raw, catalog, path: join(directory, 'cube-meta.json') };
  }
  async function match(digest) {
    const saved = [...index.values()].find(row => row.files['cube-meta.json'].sha256 === digest);
    if (!saved) throw new TypeError('Saved version metadata is not retained by this workbench');
    await metadata(saved.id); return saved.id;
  }
  function listMetadata(options) {
    return page([...index.values()].map(publicEdition).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).concat(unreadable), options);
  }
  async function retain({ bytes, label, provenance, staging }) {
    inspectCubeMetadata(parse(bytes, 'Candidate Cube metadata'));
    const existing = [...index.values()].find(row => row.files['cube-meta.json'].sha256 === sha256(bytes));
    if (existing) { await metadata(existing.id); return { ...publicEdition(existing), alreadyRetained: true }; }
    const name = key('m'), directory = staging ?? join(metadataRoot, '.staging-' + randomUUID());
    if (!staging) { await newDirectory(directory); await writeNew(join(directory, 'cube-meta.json'), bytes); }
    const saved = { schema: METADATA, id: name, workbenchId, createdAt: new Date().toISOString(), label,
      provenance, files: { 'cube-meta.json': fileBinding(bytes) }, ...summary(parse(bytes, 'Candidate Cube metadata')) };
    try {
      await writeNew(join(directory, 'edition.json'), json(saved)); await syncDirectory(directory);
      await rename(directory, join(metadataRoot, name)); await syncDirectory(metadataRoot);
      index.set(name, saved); return publicEdition(saved);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async function importMetadata({ name, label, base64 }) {
    text(name, 'Source filename', 240); text(label, 'Metadata label', 240);
    if (typeof base64 !== 'string' || base64.length > Math.ceil(16 * 1024 * 1024 / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
      throw new TypeError('Import the complete original metadata file, at most 16 MiB');
    const bytes = Buffer.from(base64, 'base64');
    return retain({ bytes, label, provenance: { kind: 'OPERATOR_FILE', filename: name } });
  }
  async function captureMetadata({ baseVersion, label, metaPath = '/cubejs-api/v1/meta' }) {
    text(label, 'Metadata label', 240);
    const source = await inspectVersion(checkId(baseVersion)), staging = join(metadataRoot, '.staging-' + randomUUID());
    await newDirectory(staging);
    try {
      const capture = await captureCubeMetadata({ upstream: source.plan.upstream, metaPath, destination: join(staging, 'cube-meta.json') });
      const bytes = await readBytes(join(staging, 'cube-meta.json'), { privateFile: true });
      return await retain({ bytes, label, staging, provenance: { kind: 'CUBE_META_CAPTURE', baseVersion,
        sourceUrl: capture.sourceUrl, capturedAt: capture.capturedAt, bytes: capture.bytes, sha256: capture.sha256 } });
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async function impact({ baseVersion, metadataId, query = '', offset = 0, limit = 50 }) {
    if (typeof query !== 'string' || query.length > 512) throw new TypeError('Use a short member search');
    const base = await inspectVersion(checkId(baseVersion)), before = await metadata(base.metadataId), target = await metadata(metadataId);
    const result = inspectCubeRefresh(before.raw, target.raw, base.plan), needle = query.toLocaleLowerCase();
    const filtered = result.changes.filter(row => !needle || row.name.toLocaleLowerCase().includes(needle));
    return { baseVersion, metadataId, before: publicEdition(index.get(before.id)), after: publicEdition(index.get(target.id)),
      ...result, changes: page(filtered, { offset, limit }), sourcePlanSha256: base.view.planSha256 };
  }
  async function openReview(value) {
    const name = checkId(value), directory = join(reviewRoot, name), bytes = await readBytes(join(directory, 'refresh.json'), { max: 65536, privateFile: true });
    const manifest = parse(bytes, 'Schema refresh');
    if (manifest.schema !== REVIEW || manifest.id !== name || manifest.workbenchId !== workbenchId ||
        !Number.isFinite(Date.parse(manifest.createdAt))) throw new TypeError('Invalid retained schema refresh');
    const files = await readBoundFiles(directory, manifest, ['review.json', 'merchant-plan.json']);
    const review = parse(files['review.json'], 'Schema review'), plan = parse(files['merchant-plan.json'], 'Reviewed merchant plan');
    const applicationBytes = await optional(join(directory, 'applied', 'application.json'));
    const application = applicationBytes ? parse(applicationBytes, 'Applied schema refresh') : null;
    if (application && (application.schema !== 'stellar-forge.cube-schema-application.v1' || application.reviewId !== name ||
        !Number.isFinite(Date.parse(application.appliedAt)) || application.reviewSha256 !== sha256(bytes) || application.version !== manifest.targetVersion ||
        application.metadataSha256 !== manifest.metadataSha256 || application.planSha256 !== manifest.files['merchant-plan.json'].sha256))
      throw new TypeError('Applied version does not match this immutable review');
    return { id: name, directory, manifest, reviewSha256: sha256(bytes), review, plan, application };
  }
  function reviewView(saved) {
    return { id: saved.id, createdAt: saved.manifest.createdAt, operator: saved.manifest.operator,
      baseVersion: saved.manifest.baseVersion, metadataId: saved.manifest.metadataId,
      targetVersion: saved.manifest.targetVersion, previousReview: saved.manifest.previousReview,
      parentAppliedReview: saved.manifest.parentAppliedReview, reviewSha256: saved.reviewSha256,
      status: saved.application ? 'APPLIED' : saved.review.status, application: saved.application,
      review: saved.review, plan: saved.plan };
  }
  async function inspectReview(value) { return reviewView(await openReview(value)); }
  async function listReviews(options) {
    const entries = (await readdir(reviewRoot, { withFileTypes: true })).filter(row => row.isDirectory() && ID.test(row.name))
      .map(row => row.name).sort().reverse();
    const selected = page(entries, options), items = [];
    for (const name of selected.items) {
      try {
        const saved = await openReview(name), view = reviewView(saved);
        items.push({ id: name, createdAt: view.createdAt, operator: view.operator, baseVersion: view.baseVersion,
          metadataId: view.metadataId, targetVersion: view.targetVersion, status: view.status, reportCount: view.review.reportCount });
      } catch (error) { items.push({ id: name, status: 'UNAVAILABLE', error: error.message }); }
    }
    return { ...selected, items };
  }
  async function reviewRefresh({ baseVersion, metadataId, operator, decisions, previousReview = null }) {
    await restoreActive();
    text(operator, 'Review operator', 240);
    const base = await inspectVersion(checkId(baseVersion)), before = await metadata(base.metadataId), target = await metadata(metadataId);
    if (previousReview) {
      const previous = await openReview(previousReview);
      if (previous.manifest.baseVersion !== baseVersion || previous.manifest.metadataId !== metadataId)
        throw new TypeError('A revised review must retain its source version and candidate metadata');
    }
    const prepared = prepareCubeRefresh(before.raw, target.raw, base.plan, decisions), name = key('r');
    const { plan, ...review } = prepared, planBytes = json(plan), reviewBytes = json(review);
    if (planBytes.length > 1024 * 1024) throw new TypeError('Reviewed merchant plan exceeds 1 MiB');
    const manifest = { schema: REVIEW, id: name, workbenchId, createdAt: new Date().toISOString(), operator,
      baseVersion, baseMetadataSha256: base.view.metadataSha256, basePlanSha256: base.view.planSha256,
      metadataId: target.id, metadataSha256: target.metadataSha256, targetVersion: 'v-' + name.slice(2),
      parentAppliedReview: active?.id ?? null, previousReview,
      files: { 'review.json': fileBinding(reviewBytes), 'merchant-plan.json': fileBinding(planBytes) } };
    const staging = join(reviewRoot, '.staging-' + randomUUID()); await newDirectory(staging);
    try {
      await writeNew(join(staging, 'merchant-plan.json'), planBytes); await writeNew(join(staging, 'review.json'), reviewBytes);
      await writeNew(join(staging, 'refresh.json'), json(manifest)); await syncDirectory(staging);
      await rename(staging, join(reviewRoot, name)); await syncDirectory(reviewRoot);
    } finally { await rm(staging, { recursive: true, force: true }); }
    return inspectReview(name);
  }
  async function applyRefresh({ reviewId, reviewSha256 }) {
    // Recover a complete application whose subsequent fsync or cleanup failed.
    await restoreActive();
    const saved = await openReview(reviewId), { manifest, review } = saved;
    if (reviewSha256 !== saved.reviewSha256) throw new TypeError('Reopen the exact saved review before applying it');
    if (review.status !== 'READY') throw new TypeError('Resolve the original compiler findings in a successor review');
    if (saved.application) {
      const version = await inspectVersion(manifest.targetVersion);
      if (version.view.metadataSha256 !== saved.application.metadataSha256 || version.view.planSha256 !== saved.application.planSha256)
        throw new TypeError('The applied native version no longer matches its saved review');
      return { review: reviewView(saved), version, alreadyApplied: true };
    }
    if ((active?.id ?? null) !== manifest.parentAppliedReview)
      throw new TypeError('Another refresh was applied after this review. Save a successor review against the current workspace');
    const base = await inspectVersion(manifest.baseVersion), target = await metadata(manifest.metadataId), before = await metadata(base.metadataId);
    if (base.view.planSha256 !== manifest.basePlanSha256 || base.view.metadataSha256 !== manifest.baseMetadataSha256 ||
        target.metadataSha256 !== manifest.metadataSha256) throw new TypeError('The reviewed source bindings changed');
    const derived = prepareCubeRefresh(before.raw, target.raw, base.plan, review.decisions);
    if (derived.status !== 'READY' || sha256(json(derived.plan)) !== manifest.files['merchant-plan.json'].sha256)
      throw new TypeError('The reviewed migration no longer compiles to its retained plan');
    // Deterministic target plus staged native creation recovers a close after version creation.
    const version = await createVersion(manifest.targetVersion, target, join(saved.directory, 'merchant-plan.json'), manifest.files['merchant-plan.json'].sha256);
    const application = { schema: 'stellar-forge.cube-schema-application.v1', reviewId, reviewSha256: saved.reviewSha256,
      appliedAt: new Date().toISOString(), version: version.id, metadataSha256: target.metadataSha256,
      planSha256: version.view.planSha256 };
    const committing = join(saved.directory, '.applying-' + randomUUID()); await newDirectory(committing);
    try {
      await writeNew(join(committing, 'application.json'), json(application)); await syncDirectory(committing);
      // A completed nonempty directory cannot be replaced by another application.
      await rename(committing, join(saved.directory, 'applied')); await syncDirectory(saved.directory);
    } finally { await rm(committing, { recursive: true, force: true }); }
    active = { id: saved.id, ...application, metadataId: target.id };
    return { review: await inspectReview(saved.id), version, alreadyApplied: false };
  }
  async function restoreActive() {
    const applied = new Map(), children = new Map(), roots = [];
    for (const entry of await readdir(reviewRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue;
      if (!await optional(join(reviewRoot, entry.name, 'applied', 'application.json'))) continue;
      const saved = await openReview(entry.name);
      if (!saved.application || saved.review.status !== 'READY')
        throw new TypeError('An applied schema review is incomplete or was not ready');
      const version = await inspectVersion(saved.manifest.targetVersion);
      if (version.view.planSha256 !== saved.application.planSha256 || version.view.metadataSha256 !== saved.application.metadataSha256)
        throw new TypeError('An applied native version binding changed');
      applied.set(entry.name, saved);
    }
    if (!applied.size) { active = null; return null; }
    for (const [name, saved] of applied) {
      const parent = saved.manifest.parentAppliedReview;
      if (parent === null) { roots.push(name); continue; }
      if (typeof parent !== 'string' || !ID.test(parent) || !applied.has(parent))
        throw new TypeError('The retained schema application chain has a missing parent');
      if (children.has(parent))
        throw new TypeError('The retained schema application chain diverges; inspect the conflicting reviews');
      children.set(parent, name);
    }
    if (roots.length !== 1)
      throw new TypeError('The retained schema applications do not form one rooted chain');
    const visited = new Set(); let terminal = roots[0];
    while (true) {
      if (visited.has(terminal)) throw new TypeError('The retained schema application chain contains a cycle');
      visited.add(terminal);
      if (!children.has(terminal)) break;
      terminal = children.get(terminal);
    }
    if (visited.size !== applied.size)
      throw new TypeError('The retained schema application chain contains a disconnected cycle');
    const saved = applied.get(terminal);
    active = { id: saved.id, ...saved.application, metadataId: saved.manifest.metadataId };
    return active;
  }

  async function download({ kind, item, file }) {
    if (kind === 'metadata' && file === 'cube-meta.json') return (await metadata(item)).bytes;
    if (kind === 'metadata' && item !== 'original' && file === 'edition.json') {
      await metadata(item); return readBytes(join(metadataRoot, checkId(item), file), { max: 65536, privateFile: true });
    }
    if (kind === 'refreshes' && ['refresh.json', 'review.json', 'merchant-plan.json', 'application.json'].includes(file)) {
      await openReview(item); return readBytes(join(reviewRoot, checkId(item), ...(file === 'application.json' ? ['applied', file] : [file])), { privateFile: true });
    }
    throw new TypeError('Select a retained metadata or schema review file');
  }
  return { metadata, match, listMetadata, importMetadata, captureMetadata, impact, reviewRefresh, applyRefresh,
    inspectReview, listReviews, restoreActive, active: () => active, download };
}
