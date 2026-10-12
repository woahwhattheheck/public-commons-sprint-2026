// MIT. Typed SF30 publisher receiving over the original SF101 encrypted engine.
import { lstat, readdir, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { run as recover } from './recover.mjs';
import { openDatasetVersions } from '../sf30-seller-sdk/dataset-refresh/versions.mjs';
import { acquireDatasetLease } from '../sf30-seller-sdk/dataset-refresh/writer-lease.mjs';
import { openPublisherDrafts } from '../sf30-seller-sdk/dataset-refresh/workspace-state.mjs';
import { loadDatasetConfig } from '../sf30-seller-sdk/dataset-handler.mjs';
import { absolute, privateDirectory, readPrivate, createFile, atomicJson, syncDirectory,
  acquireWorkspace, bytes, digest, identity, hashPrivate, object, fault } from '../sf30-seller-sdk/postgres/publisher/files.mjs';

export const PUBLISHER_RECOVERY_SCHEMA = 'stellar-forge.dataset-publisher-recovery-profile.v1';
export const PUBLISHER_PREPARATION_SCHEMA = 'stellar-forge.dataset-publisher-recovery-operation.v1';
const PLAN_SCHEMA = 'stellar-forge.merchant-recovery-plan.v1';
const BUNDLE_SCHEMA = 'stellar-forge.merchant-recovery.v1';
const DATASET_SCHEMAS = ['stellar-forge.dataset-versions.v1', 'stellar-forge.dataset-versions.v2'];
const HASH = /^[a-f0-9]{64}$/;
const MAX_TOTAL = 4 * 1024 ** 3;
const MAX_FILE = 2 * 1024 ** 3;
const MAX_ENTRIES = 10000;
const PLAN_LIMIT = 256 * 1024;
const INDEX_LIMIT = 8 * 1024 * 1024;
const stamp = () => new Date().toISOString();
const copy = value => structuredClone(value);
const inside = (parent, child) => parent === child || child.startsWith(parent + '/');
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const need = (condition, code, message, status = 409) => { if (!condition) throw fault(code, message ?? code, status); };

function parse(raw, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('PUBLISHER_RECOVERY_JSON_INVALID', 'Invalid retained ' + label + '.', 400); }
}
function limits(value = {}) {
  need(object(value) && Object.keys(value).every(key =>
    ['maxCandidates', 'maxSourceBytes', 'maxCachedVersions', 'maxResidentRows'].includes(key)),
  'PUBLISHER_RECOVERY_LIMITS_INVALID', 'Use the original publisher and parsed-dataset limits.', 400);
  const result = { maxCandidates: 32, maxSourceBytes: 256 * 1024 ** 2,
    maxCachedVersions: 2, maxResidentRows: 1000000, ...value };
  for (const [key, low, high] of [['maxCandidates', 1, 256], ['maxSourceBytes', 1024, MAX_TOTAL],
    ['maxCachedVersions', 1, 16], ['maxResidentRows', 1, 16000000]])
    need(Number.isSafeInteger(result[key]) && result[key] >= low && result[key] <= high,
      'PUBLISHER_RECOVERY_LIMITS_INVALID', key + ' must remain within the original native limits.', 400);
  return result;
}
function versionIndex(raw) {
  const value = parse(raw, 'dataset index');
  need(DATASET_SCHEMAS.includes(value?.schema) && HASH.test(value.current ?? '') &&
    HASH.test(value.contractHash ?? '') && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    Array.isArray(value.versions) && value.versions.length > 0 && value.versions.length <= 16 &&
    value.versions.some(row => row.snapshot === value.current) && object(value.settings),
  'PUBLISHER_RECOVERY_DATASET_INVALID', 'Select the original initialized SF30 version store.');
  return value;
}
function publisherIndex(raw, datasetDirectory) {
  const value = parse(raw, 'publisher index');
  need(value?.schema === 'stellar-forge.dataset-publisher-workspace.v1' &&
    value.datasetDirectory === datasetDirectory && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    ['candidates', 'buyers', 'removedCandidateIds', 'removedBuyerIds'].every(key => Array.isArray(value[key])),
  'PUBLISHER_RECOVERY_BINDING_INVALID', 'Select the retained publisher bound to this exact dataset directory.');
  return value;
}
function sellerConfiguration(raw) {
  const value = parse(raw, 'seller configuration');
  need(value?.schema === 'stellar-forge.seller-service.v1' && Array.isArray(value.routes) &&
    value.routes.some(route => route.handler === 'queryDataset' && route.admit === 'admitDataset'),
  'PUBLISHER_RECOVERY_SELLER_INVALID', 'Select the existing versioned dataset seller configuration.');
  need(value.routes.every(route => !Object.hasOwn(route, 'responseFile') && !Object.hasOwn(route, 'responseAsset') &&
    (!Object.hasOwn(route, 'handler') || route.handler === 'queryDataset') &&
    (!Object.hasOwn(route, 'admit') || route.admit === 'admitDataset')),
  'PUBLISHER_RECOVERY_EXTERNAL_HANDLER', 'This typed profile retains dataset handlers and inline responses. Use the original whole-host recovery for additional file or application handlers.');
  return value;
}
function summary(dataset, publisher, options, seller = null) {
  return {
    dataset: { schema: dataset.schema, current: dataset.current, revision: dataset.revision, contractHash: dataset.contractHash,
      settings: copy(dataset.settings), versions: dataset.versions.map(row => ({
        snapshot: row.snapshot, configHash: row.configHash, csvHash: row.csvHash,
        sourceBytes: row.sourceBytes, activatedAt: row.activatedAt, expiresAt: row.expiresAt })) },
    publisher: { revision: publisher.revision, createdAt: publisher.createdAt,
      candidates: publisher.candidates.length, workbooks: (publisher.workbookSources ?? []).length,
      mappings: (publisher.workbookSources ?? []).reduce((count, source) => count + (source.plans ?? []).length, 0),
      mappingEditions: (publisher.workbookSources ?? []).reduce((count, source) =>
        count + (source.plans ?? []).reduce((total, plan) => total + 1 + (plan.editions ?? []).length, 0), 0),
      buyerConfigurations: publisher.buyers.length,
      pendingPublications: publisher.candidates.filter(row => ['PENDING', 'NEEDS_REVIEW'].includes(row.publications?.at(-1)?.state))
        .map(row => ({ candidateId: row.id, candidateRevision: row.revision,
          snapshot: row.dataset?.snapshot, publicationId: row.publications.at(-1).id,
          state: row.publications.at(-1).state })),
      selectedDraftId: publisher.selectedDraftId, selection: copy(publisher.selection ?? null),
      relocationCount: (publisher.datasetRelocations ?? []).length,
       latestRelocation: copy(publisher.datasetRelocations?.at(-1) ?? null) },
    limits: copy(options),
    seller: seller ? { routes: seller.routes.length, publicOrigin: seller.publicOrigin ?? null,
      datasetRouteIds: seller.routes.filter(route => route.handler === 'queryDataset').map(route => route.id) } : null,
  };
}

// The ordered content tree binds every selected file without embedding a second
// multi-megabyte manifest in the original 256 KiB snapshot plan.
async function tree(path, kind, budget) {
  const hash = createHash('sha256').update('stellar-forge.publisher-recovery-tree.v1\0');
  let files = 0, directories = 0, totalBytes = 0;
  async function visit(current, relative, depth) {
    need(depth <= 16 && ++budget.entries < MAX_ENTRIES, 'PUBLISHER_RECOVERY_ENTRY_LIMIT',
      'The selected source exceeds the original SF101 entry or depth limit.');
    const before = await lstat(current, { bigint: true });
    need(!before.isSymbolicLink() && (before.isFile() || before.isDirectory()),
      'PUBLISHER_RECOVERY_UNSAFE_SOURCE', 'Only original regular files and real private directories can be captured.');
    if (before.isDirectory()) {
      await privateDirectory(current);
      directories++; hash.update(JSON.stringify([relative, 'directory']) + '\n');
      const names = (await readdir(current)).sort();
      for (const name of names) {
        need(name !== '.' && name !== '..' && !/[\\/\0]/.test(name),
          'PUBLISHER_RECOVERY_UNSAFE_SOURCE', 'An original filename is not portable.');
        await visit(join(current, name), relative ? relative + '/' + name : name, depth + 1);
      }
      const after = await lstat(current, { bigint: true });
      need(before.dev === after.dev && before.ino === after.ino && before.mtimeNs === after.mtimeNs &&
        before.ctimeNs === after.ctimeNs, 'PUBLISHER_RECOVERY_SOURCE_CHANGED', 'A source directory changed during review.');
    } else {
      const observed = await hashPrivate(current, MAX_FILE);
      files++; totalBytes += observed.bytes; budget.bytes += observed.bytes;
      need(budget.bytes <= MAX_TOTAL, 'PUBLISHER_RECOVERY_BYTE_LIMIT', 'The selected source exceeds the original 4 GiB limit.');
      hash.update(JSON.stringify([relative, 'file', observed.bytes, observed.hash]) + '\n');
    }
  }
  const first = await lstat(path);
  need(kind === 'directory' ? first.isDirectory() : first.isFile(),
    'PUBLISHER_RECOVERY_ROOT_CHANGED', 'An original selected root changed type.');
  await visit(path, '', 0);
  return { kind, sha256: hash.digest('hex'), files, directories, bytes: totalBytes };
}
function selectedRoots(original) {
  const roots = [
    { name: 'datasetIndex', path: join(original.datasetDirectory, 'state.json'), kind: 'file' },
    { name: 'datasetVersions', path: join(original.datasetDirectory, 'versions'), kind: 'directory' },
    { name: 'publisherWorkspace', path: original.publisherDirectory, kind: 'directory' },
  ];
  if (original.sellerConfigFile) roots.push({ name: 'sellerConfig', path: original.sellerConfigFile, kind: 'file' });
  for (let index = 0; index < roots.length; index++) for (const other of roots.slice(index + 1))
    need(!inside(roots[index].path, other.path) && !inside(other.path, roots[index].path),
      'PUBLISHER_RECOVERY_ROOT_OVERLAP', 'Keep the selected seller config outside the dataset/publisher roots already being captured.');
  return roots;
}
function originalSelection(input) {
  const datasetDirectory = absolute(input.datasetDirectory, 'dataset directory');
  const publisherDirectory = absolute(input.publisherDirectory ?? join(datasetDirectory, '.publisher-workspace'), 'publisher directory');
  need(publisherDirectory !== datasetDirectory && !inside(publisherDirectory, datasetDirectory) &&
    !inside(join(datasetDirectory, 'versions'), publisherDirectory),
  'PUBLISHER_RECOVERY_ROOT_OVERLAP', 'Use the original separate publisher directory.');
  return { datasetDirectory, publisherDirectory,
    sellerConfigFile: input.sellerConfigFile ? absolute(input.sellerConfigFile, 'seller configuration') : null };
}

/** Read only: inspect the explicitly selected original source. It acquires no
 * native writer and never collects or replays the merchant's state. */
export async function inspectPublisherRecovery(input = {}) {
  const original = originalSelection(input), selectedLimits = limits(input.limits);
  await privateDirectory(original.datasetDirectory);
  await privateDirectory(original.publisherDirectory);
  const datasetBytes = await readPrivate(join(original.datasetDirectory, 'state.json'), 262144);
  const publisherBytes = await readPrivate(join(original.publisherDirectory, 'workspace.json'), INDEX_LIMIT);
  const dataset = versionIndex(datasetBytes), publisher = publisherIndex(publisherBytes, original.datasetDirectory);
  const sellerBytes = original.sellerConfigFile ? await readPrivate(original.sellerConfigFile, 262144) : null;
  const seller = sellerBytes ? sellerConfiguration(sellerBytes) : null;
  const budget = { entries: 0, bytes: 0 }, trees = {};
  for (const root of selectedRoots(original)) trees[root.name] = await tree(root.path, root.kind, budget);
  need(digest(await readPrivate(join(original.datasetDirectory, 'state.json'), 262144)) === digest(datasetBytes) &&
    digest(await readPrivate(join(original.publisherDirectory, 'workspace.json'), INDEX_LIMIT)) === digest(publisherBytes) &&
    (!sellerBytes || digest(await readPrivate(original.sellerConfigFile, 262144)) === digest(sellerBytes)),
  'PUBLISHER_RECOVERY_SOURCE_CHANGED', 'The original state changed during review; inspect its current saved selection.');
  return { schema: PUBLISHER_RECOVERY_SCHEMA, original, limits: selectedLimits,
    source: { datasetIndexSha256: digest(datasetBytes), publisherIndexSha256: digest(publisherBytes),
      sellerConfigSha256: sellerBytes ? digest(sellerBytes) : null, trees,
      files: Object.values(trees).reduce((count, value) => count + value.files, 0),
      directories: Object.values(trees).reduce((count, value) => count + value.directories, 0), bytes: budget.bytes },
    summary: summary(dataset, publisher, selectedLimits, seller) };
}

/** Produce a normal SF101 plan. The plan includes itself as an encrypted file
 * root, so its exact typed mapping travels through existing local/remote recovery. */
export async function preparePublisherRecoveryPlan({ planFile, ...input } = {}) {
  absolute(planFile, 'new recovery plan');
  await privateDirectory(dirname(planFile));
  const inspected = await inspectPublisherRecovery(input);
  const roots = selectedRoots(inspected.original);
  need(!roots.some(root => inside(root.path, planFile) || inside(planFile, root.path)),
    'PUBLISHER_RECOVERY_PLAN_OVERLAP', 'Save the new plan outside the original selected roots.');
  const profile = { ...inspected, createdAt: stamp(), planFile };
  const plan = { schema: PLAN_SCHEMA, roots: [...roots.map(({ name, path }) => ({ name, path })),
    { name: 'publisherRecoveryPlan', path: planFile }], datasetPublisher: profile };
  const content = bytes(plan);
  need(content.length <= PLAN_LIMIT && inspected.source.bytes + content.length <= MAX_TOTAL &&
    inspected.source.files + inspected.source.directories + 1 <= MAX_ENTRIES,
  'PUBLISHER_RECOVERY_PLAN_LIMIT', 'The typed plan and original roots exceed the SF101 capture limits.');
  await createFile(planFile, content); await syncDirectory(dirname(planFile));
  return { status: 'DATASET_PUBLISHER_RECOVERY_PLAN_READY', planFile, sha256: digest(content),
    plan, summary: inspected.summary, source: inspected.source };
}

function typedPlan(raw) {
  const plan = parse(raw, 'typed recovery plan'), profile = plan?.datasetPublisher;
  need(plan?.schema === PLAN_SCHEMA && profile?.schema === PUBLISHER_RECOVERY_SCHEMA &&
    Array.isArray(plan.roots) && object(profile.original) && object(profile.source) && object(profile.summary),
  'PUBLISHER_RECOVERY_PROFILE_REQUIRED', 'Choose a snapshot made from an original typed publisher recovery plan.');
  const original = originalSelection(profile.original), selectedLimits = limits(profile.limits);
  absolute(profile.planFile, 'original recovery plan');
  const roots = [...selectedRoots(original), { name: 'publisherRecoveryPlan', path: profile.planFile, kind: 'file' }];
  need(identity(plan.roots) === identity(roots.map(({ name, path }) => ({ name, path }))) &&
    identity(original) === identity(profile.original) && identity(selectedLimits) === identity(profile.limits),
  'PUBLISHER_RECOVERY_PROFILE_CHANGED', 'The typed profile differs from its original named-root selection.');
  for (const root of roots.slice(0, -1)) {
    const item = profile.source.trees?.[root.name];
    need(item?.kind === root.kind && HASH.test(item.sha256 ?? '') &&
      ['files', 'directories', 'bytes'].every(key => Number.isSafeInteger(item[key]) && item[key] >= 0),
    'PUBLISHER_RECOVERY_PROFILE_CHANGED', 'The selected source tree is missing its retained identity.');
  }
  need(HASH.test(profile.source.datasetIndexSha256 ?? '') && HASH.test(profile.source.publisherIndexSha256 ?? '') &&
    (!original.sellerConfigFile || HASH.test(profile.source.sellerConfigSha256 ?? '')),
  'PUBLISHER_RECOVERY_PROFILE_CHANGED', 'Original dataset and publisher index identities are required.');
  return { plan, profile, roots };
}

/** Native local-capture consumers call this before their existing capture.
 * It reads the selected current roots and refuses source drift from this plan. */
export async function inspectPublisherRecoveryPlan(planFile) {
  absolute(planFile, 'recovery plan');
  const raw = await readPrivate(planFile, PLAN_LIMIT), { profile } = typedPlan(raw);
  need(profile.planFile === planFile, 'PUBLISHER_RECOVERY_PLAN_MOVED',
    'A source capture uses the plan at its declared original path; receiving uses the restored-profile operation.');
  const current = await inspectPublisherRecovery({ ...profile.original, limits: profile.limits });
  need(identity(current.source) === identity(profile.source) &&
    identity(current.summary) === identity(profile.summary),
  'PUBLISHER_RECOVERY_SOURCE_CHANGED', 'The selected source changed after this plan was prepared. Prepare a new plan for the current saved state.');
  return { status: 'DATASET_PUBLISHER_SOURCE_MATCHED', planFile, sha256: digest(raw),
    summary: current.summary, source: current.source, profile: copy(profile) };
}

/** Hold the original source writers while an existing SF101 consumer captures.
 * The consumer keeps its own operation, progress, cancellation and result. */
export async function withPublisherRecoveryCapture({ planFile, expectedPlanSha256 } = {}, capture) {
  absolute(planFile, 'recovery plan');
  need(HASH.test(expectedPlanSha256 ?? '') && typeof capture === 'function',
    'PUBLISHER_RECOVERY_CAPTURE_REVIEW_REQUIRED', 'Supply the exact reviewed plan SHA-256 and original capture callback.', 400);
  const raw = await readPrivate(planFile, PLAN_LIMIT), { profile } = typedPlan(raw);
  need(digest(raw) === expectedPlanSha256 && profile.planFile === planFile,
    'PUBLISHER_RECOVERY_PLAN_CHANGED', 'The source plan differs from the reviewed original.');
  await privateDirectory(profile.original.datasetDirectory);
  await privateDirectory(profile.original.publisherDirectory);
  // These are the same retained native leases used by the service and publisher.
  // Neither native store is opened, upgraded, collected or replayed for capture.
  const datasetLease = acquireDatasetLease(profile.original.datasetDirectory);
  let releasePublisher;
  try {
    releasePublisher = await acquireWorkspace(profile.original.publisherDirectory);
    const current = versionIndex(await readPrivate(join(profile.original.datasetDirectory, 'state.json'), 262144));
    if (current.schema === 'stellar-forge.dataset-versions.v1')
      need(!await exists(join(profile.original.datasetDirectory, 'writer.lock')),
        'PUBLISHER_RECOVERY_LEGACY_WRITER_PRESENT',
        'Close the original v1 writer, or finish its original native upgrade, before preparing this quiesced capture.');
    datasetLease.assertHeld();
    const before = await inspectPublisherRecoveryPlan(planFile);
    need(before.sha256 === expectedPlanSha256, 'PUBLISHER_RECOVERY_PLAN_CHANGED');
    const result = await capture();
    datasetLease.assertHeld();
    const after = await inspectPublisherRecoveryPlan(planFile);
    need(after.sha256 === expectedPlanSha256, 'PUBLISHER_RECOVERY_PLAN_CHANGED');
    return result;
  } finally {
    try { await releasePublisher?.(); } finally { await datasetLease.close(); }
  }
}

function validateCapturedProfile(manifest, planRaw) {
  const { profile, roots } = typedPlan(planRaw), planSha256 = digest(planRaw);
  need(identity(manifest.roots) === identity(roots.map(({ name, kind }) => ({ name, kind }))),
    'PUBLISHER_RECOVERY_ROOTS_CHANGED', 'Use the complete original typed dataset snapshot.');
  const planEntry = manifest.entries.find(entry => entry.path === 'publisherRecoveryPlan');
  need(planEntry?.kind === 'file' && planEntry.sha256 === planSha256 && planEntry.size === planRaw.length,
    'PUBLISHER_RECOVERY_PLAN_CHANGED', 'The authenticated source plan differs from its selected original.');
  if (manifest.capture !== undefined)
    need(manifest.capture.planSha256 === planSha256, 'PUBLISHER_RECOVERY_CAPTURE_CHANGED',
      'The native capture identity must bind the exact encrypted typed plan.');
  for (const root of roots.slice(0, -1)) {
    const selected = manifest.entries.filter(entry => entry.path === root.name || entry.path.startsWith(root.name + '/'));
    const hash = createHash('sha256').update('stellar-forge.publisher-recovery-tree.v1\0');
    let files = 0, directories = 0, total = 0;
    for (const entry of selected) {
      const relative = entry.path === root.name ? '' : entry.path.slice(root.name.length + 1);
      if (entry.kind === 'directory') {
        directories++; hash.update(JSON.stringify([relative, 'directory']) + '\n');
      } else {
        files++; total += entry.size;
        hash.update(JSON.stringify([relative, 'file', entry.size, entry.sha256]) + '\n');
      }
    }
    need(identity({ kind: root.kind, sha256: hash.digest('hex'), files, directories, bytes: total }) ===
      identity(profile.source.trees[root.name]), 'PUBLISHER_RECOVERY_CAPTURE_SOURCE_CHANGED',
    'The authenticated captured ' + root.name + ' tree differs from the reviewed original source.');
  }
}

/** Ordinary typed CLI capture. Encryption and verification are the native runner.
 * Shared workspaces instead wrap their existing new-capture block above. */
export async function capturePublisherRecovery({ planFile, bundleDirectory, passphraseEnv,
  expectedPlanSha256, captureId } = {}) {
  absolute(planFile, 'recovery plan'); absolute(bundleDirectory, 'encrypted bundle');
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(passphraseEnv ?? ''),
    'PUBLISHER_RECOVERY_PASSPHRASE_REQUIRED', 'Use the original private passphrase environment variable name.', 400);
  if (captureId !== undefined) need(HASH.test(captureId), 'PUBLISHER_RECOVERY_CAPTURE_ID_INVALID', undefined, 400);
  const raw = await readPrivate(planFile, PLAN_LIMIT), actualPlanSha256 = digest(raw);
  const reviewed = expectedPlanSha256 ?? actualPlanSha256;
  need(HASH.test(reviewed) && reviewed === actualPlanSha256, 'PUBLISHER_RECOVERY_PLAN_CHANGED');
  return withPublisherRecoveryCapture({ planFile, expectedPlanSha256: reviewed }, async () => {
    const id = captureId ?? identity({ schema: PUBLISHER_RECOVERY_SCHEMA, planSha256: reviewed, bundleDirectory });
    const snapshot = await recover(['snapshot', '--plan', planFile, '--out', bundleDirectory,
      '--pass-env', passphraseEnv, '--quiesced', '--capture-id', id, '--expected-plan-sha256', reviewed]);
    const manifestRaw = await readPrivate(join(bundleDirectory, 'manifest.json'), 12 * 1024 ** 2);
    const verification = await recover(['verify', '--bundle', bundleDirectory, '--pass-env', passphraseEnv]);
    need(verification.status === 'SNAPSHOT_VERIFIED' &&
      digest(await readPrivate(join(bundleDirectory, 'manifest.json'), 12 * 1024 ** 2)) === digest(manifestRaw),
    'PUBLISHER_RECOVERY_BUNDLE_CHANGED', 'The original verified recovery bundle changed.');
    const manifest = parse(manifestRaw, 'authenticated captured publisher');
    validateCapturedProfile(manifest, raw);
    need(manifest.capture?.id === id, 'PUBLISHER_RECOVERY_CAPTURE_CHANGED');
    return { status: 'DATASET_PUBLISHER_CAPTURED', bundleDirectory, manifestSha256: digest(manifestRaw),
      planSha256: reviewed, captureId: id, original: { snapshot, verification } };
  });
}

function targets(restoreDirectory) {
  return { datasetDirectory: join(restoreDirectory, 'native-dataset'),
    publisherDirectory: join(restoreDirectory, 'publisherWorkspace'),
    indexBefore: join(restoreDirectory, 'datasetIndex'),
    versionsBefore: join(restoreDirectory, 'datasetVersions'),
    operationDirectory: join(restoreDirectory, 'publisher-recovery'),
    planFile: join(restoreDirectory, 'publisherRecoveryPlan'),
    sellerConfigFile: join(restoreDirectory, 'sellerConfig') };
}
async function readOperation(target) {
  if (!await exists(target.operationDirectory)) return null;
  await privateDirectory(target.operationDirectory);
  const file = join(target.operationDirectory, 'operation.json');
  if (!await exists(file)) return null;
  return parse(await readPrivate(file, INDEX_LIMIT), 'publisher recovery operation');
}
async function context(input) {
  const bundleDirectory = absolute(input.bundleDirectory, 'encrypted bundle');
  const restoreDirectory = absolute(input.restoreDirectory, 'completed original restore');
  need(!inside(bundleDirectory, restoreDirectory) && !inside(restoreDirectory, bundleDirectory),
    'PUBLISHER_RECOVERY_RESTORE_OVERLAP', 'The encrypted bundle and original plaintext restore must be separate.');
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(input.passphraseEnv ?? ''),
    'PUBLISHER_RECOVERY_PASSPHRASE_REQUIRED', 'Use the original private passphrase environment variable name.', 400);
  await privateDirectory(bundleDirectory); await privateDirectory(restoreDirectory);
  const manifestRaw = await readPrivate(join(bundleDirectory, 'manifest.json'), 12 * 1024 ** 2);
  const manifestSha256 = digest(manifestRaw);
  if (input.expectedManifestSha256 !== undefined)
    need(HASH.test(input.expectedManifestSha256) && input.expectedManifestSha256 === manifestSha256,
      'PUBLISHER_RECOVERY_BUNDLE_CHANGED', 'The selected encrypted snapshot manifest changed.');
  const verification = await recover(['verify', '--bundle', bundleDirectory, '--pass-env', input.passphraseEnv]);
  need(verification.status === 'SNAPSHOT_VERIFIED' &&
    digest(await readPrivate(join(bundleDirectory, 'manifest.json'), 12 * 1024 ** 2)) === manifestSha256,
  'PUBLISHER_RECOVERY_BUNDLE_CHANGED', 'The original verified recovery bundle changed.');
  const manifest = parse(manifestRaw, 'authenticated recovery manifest');
  need(manifest.schema === BUNDLE_SCHEMA, 'PUBLISHER_RECOVERY_BUNDLE_INVALID');
  const target = targets(restoreDirectory);
  const planEntry = manifest.entries.find(entry => entry.path === 'publisherRecoveryPlan');
  need(planEntry?.kind === 'file' && planEntry.size <= PLAN_LIMIT,
    'PUBLISHER_RECOVERY_PROFILE_REQUIRED', 'This original snapshot has no typed publisher plan.');
  const planRaw = await readPrivate(target.planFile, PLAN_LIMIT), planSha256 = digest(planRaw);
  need(planRaw.length === planEntry.size && planSha256 === planEntry.sha256,
    'PUBLISHER_RECOVERY_PLAN_CHANGED', 'The restored plan differs from the original authenticated bytes.');
  const { plan, profile, roots } = typedPlan(planRaw);
  validateCapturedProfile(manifest, planRaw);
  const review = { schema: PUBLISHER_PREPARATION_SCHEMA, bundleDirectory, restoreDirectory,
    manifestSha256, planSha256, targetDatasetDirectory: target.datasetDirectory,
    targetPublisherDirectory: target.publisherDirectory, source: profile.source, limits: profile.limits };
  const reviewSha256 = identity(review), operationId = identity({ reviewSha256, purpose: 'prepare-original-publisher' });
  const operation = await readOperation(target);
  if (operation) need(operation.schema === PUBLISHER_PREPARATION_SCHEMA &&
    operation.operationId === operationId && operation.reviewSha256 === reviewSha256,
  'PUBLISHER_RECOVERY_OPERATION_CONFLICT', 'This restored destination belongs to another retained preparation.');
  return { bundleDirectory, restoreDirectory, target, manifest, manifestSha256, plan, planRaw, planSha256,
    profile, roots, review, reviewSha256, operationId, operation, verification };
}

async function originalTreeLocations(ctx) {
  const found = {};
  for (const root of ctx.roots.filter(root => root.name !== 'publisherRecoveryPlan')) {
    const before = join(ctx.restoreDirectory, root.name);
    const after = root.name === 'datasetIndex' ? join(ctx.target.datasetDirectory, 'state.json') :
      root.name === 'datasetVersions' ? join(ctx.target.datasetDirectory, 'versions') : before;
    if (before === after) { found[root.name] = before; continue; }
    const hasBefore = await exists(before), hasAfter = await exists(after);
    need(hasBefore !== hasAfter, 'PUBLISHER_RECOVERY_ASSEMBLY_AMBIGUOUS',
      'Preserve this receiving attempt: an original native root is missing or exists at both locations.');
    need(!hasAfter || ctx.operation, 'PUBLISHER_RECOVERY_DESTINATION_EXISTS',
      'The native dataset destination is already in use by another operation.');
    found[root.name] = hasBefore ? before : after;
  }
  return found;
}
async function verifyInitialTrees(ctx, locations) {
  const budget = { entries: 0, bytes: 0 };
  for (const root of ctx.roots.filter(root => root.name !== 'publisherRecoveryPlan')) {
    const observed = await tree(locations[root.name], root.kind, budget);
    need(identity(observed) === identity(ctx.profile.source.trees[root.name]),
      'PUBLISHER_RECOVERY_RESTORED_SOURCE_CHANGED', 'The restored ' + root.name + ' differs from the captured original source.');
  }
}
function originalIndexPath(ctx) { return join(ctx.target.operationDirectory, 'original-publisher.json'); }
function originalDatasetIndexPath(ctx) { return join(ctx.target.operationDirectory, 'original-dataset.json'); }
async function verifyDatasetIndex(ctx, path) {
  const raw = await readPrivate(originalDatasetIndexPath(ctx), 262144);
  need(digest(raw) === ctx.profile.source.datasetIndexSha256, 'PUBLISHER_RECOVERY_ORIGINAL_INDEX_CHANGED');
  const original = versionIndex(raw), current = versionIndex(await readPrivate(path, 262144));
  need(identity(original) === identity(current) || original.schema === DATASET_SCHEMAS[0] &&
    current.schema === DATASET_SCHEMAS[1] && identity({ ...original, schema: DATASET_SCHEMAS[1] }) === identity(current),
  'PUBLISHER_RECOVERY_DATASET_CHANGED', 'Only the original native v1-to-v2 writer schema upgrade may change this captured index.');
  return { from: original.schema, to: current.schema };
}
function samePriorPublisher(before, after, ctx) {
  need(after.schema === before.schema && after.createdAt === before.createdAt &&
    Number.isSafeInteger(after.revision) && after.revision >= before.revision &&
    [ctx.profile.original.datasetDirectory, ctx.target.datasetDirectory].includes(after.datasetDirectory),
  'PUBLISHER_RECOVERY_PUBLISHER_CHANGED', 'The original publisher identity changed during receiving.');
  for (const key of ['candidates', 'buyers', 'workbookSources'])
    for (const item of before[key] ?? []) {
      const current = (after[key] ?? []).find(value => value.id === item.id);
      need(current && identity(current) === identity(item), 'PUBLISHER_RECOVERY_SAVED_WORK_CHANGED',
        'Existing ' + key + ' changed during receiving; inspect the retained source before continuing.');
    }
  for (const key of ['removedCandidateIds', 'removedBuyerIds', 'removedWorkbookIds', 'selection'])
    need(identity(after[key] ?? (key === 'selection' ? null : [])) === identity(before[key] ?? (key === 'selection' ? null : [])),
      'PUBLISHER_RECOVERY_SAVED_WORK_CHANGED', 'An original removal or query selection changed during receiving.');
  if (before.selectedDraftId != null)
    need(after.selectedDraftId === before.selectedDraftId, 'PUBLISHER_RECOVERY_SAVED_WORK_CHANGED',
      'The original selected draft changed during receiving.');
  const previous = before.datasetRelocations ?? [], current = after.datasetRelocations ?? [];
  need(Array.isArray(current) && current.length >= previous.length &&
    previous.every((item, index) => identity(item) === identity(current[index])) &&
    current.slice(previous.length).every(item => item.operationId === ctx.operationId &&
      item.sourceManifestSha256 === ctx.manifestSha256 && item.sourcePlanSha256 === ctx.planSha256 &&
      item.from === ctx.profile.original.datasetDirectory && item.to === ctx.target.datasetDirectory),
  'PUBLISHER_RECOVERY_BINDING_CHANGED', 'A different publisher relocation is present in this receiving attempt.');
}
function allowedCleanup(logical, before, operation) {
  if (operation.versionsNativeStarted && /^datasetVersions\/\.(?:v2-)?stage-[a-f0-9-]{36}(?:\/|$)/.test(logical)) return true;
  if (!operation.publisherNativeStarted) return false;
  if (/^publisherWorkspace\/(?:staging|workbook-staging)\/[a-f0-9-]{36}(?:\/|$)/.test(logical)) return true;
  let match = /^publisherWorkspace\/candidates\/([a-f0-9-]{36})(?:\/|$)/.exec(logical);
  if (match) return (before.removedCandidateIds ?? []).includes(match[1]);
  match = /^publisherWorkspace\/workbooks\/([a-f0-9-]{36})(?:\/|$)/.exec(logical);
  if (match) return (before.removedWorkbookIds ?? []).includes(match[1]);
  match = /^publisherWorkspace\/buyers\/([a-f0-9-]{36})(?:\.metadata)?\.json$/.exec(logical);
  return !!match && (before.removedBuyerIds ?? []).includes(match[1]);
}

// After original native reopen has begun, only its documented staging/tombstone
// cleanup and index recovery may differ. Every retained original payload is still
// checked against the authenticated archive, including unindexed damaged work.
async function verifyResumingFiles(ctx, locations, before) {
  for (const entry of ctx.manifest.entries) {
    const [root, ...parts] = entry.path.split('/');
    if (root === 'publisherRecoveryPlan') continue;
    const path = join(locations[root], ...parts);
    if (!await exists(path)) {
      need(allowedCleanup(entry.path, before, ctx.operation), 'PUBLISHER_RECOVERY_SOURCE_MISSING',
        'An original retained payload is missing: ' + entry.path);
      continue;
    }
    if (entry.kind === 'directory') { await privateDirectory(path); continue; }
    if (entry.path === 'datasetIndex' && ctx.operation.versionsNativeStarted) {
      await verifyDatasetIndex(ctx, path); continue;
    }
    if (entry.path === 'publisherWorkspace/workspace.json' && ctx.operation.publisherNativeStarted) {
      samePriorPublisher(before, parse(await readPrivate(path, INDEX_LIMIT), 'publisher index'), ctx); continue;
    }
    const observed = await hashPrivate(path, Math.max(entry.size, 1));
    need(observed.bytes === entry.size && observed.hash === entry.sha256,
      'PUBLISHER_RECOVERY_RESTORED_SOURCE_CHANGED', 'An original retained payload changed: ' + entry.path);
  }

  // Native reopen creates only these roots/lock and private atomic-index remnants.
  // It must never adopt a new CSV/workbook/buyer payload absent from this snapshot.
  const expected = new Map(ctx.manifest.entries.map(entry => [entry.path, entry]));
  const nativeDirectories = new Set(['candidates', 'staging', 'buyers', 'workbooks', 'workbook-staging', 'workbook-parsers']);
  let count = 0;
  async function inspectExtra(path, logical, depth = 0) {
    need(depth <= 16 && ++count <= MAX_ENTRIES + 512, 'PUBLISHER_RECOVERY_ENTRY_LIMIT');
    const info = await lstat(path), original = expected.get(logical);
    need(!info.isSymbolicLink() && (info.isDirectory() || info.isFile()),
      'PUBLISHER_RECOVERY_UNSAFE_SOURCE', 'A restored source contains an unexpected file type.');
    if (original) {
      need(original.kind === (info.isDirectory() ? 'directory' : 'file'),
        'PUBLISHER_RECOVERY_SOURCE_CHANGED', 'A restored original entry changed type: ' + logical);
    } else {
      const relative = logical.startsWith('publisherWorkspace/') ? logical.slice(19) : null;
      const allowedDirectory = ctx.operation.publisherNativeStarted && relative !== null &&
        nativeDirectories.has(relative) && info.isDirectory();
      const allowedFile = ctx.operation.publisherNativeStarted && relative !== null && info.isFile() &&
        (relative === 'publisher.lock' || /^\.pending-[a-f0-9-]{36}$/.test(relative));
      need(allowedDirectory || allowedFile, 'PUBLISHER_RECOVERY_UNCAPTURED_SOURCE',
        'A receiving payload was not present in this authenticated snapshot: ' + logical);
      if (allowedFile) await hashPrivate(path, relative === 'publisher.lock' ? 262144 : INDEX_LIMIT);
    }
    if (info.isDirectory()) {
      await privateDirectory(path);
      for (const name of (await readdir(path)).sort()) await inspectExtra(join(path, name), logical + '/' + name, depth + 1);
    }
  }
  for (const root of ctx.roots.filter(root => root.name !== 'publisherRecoveryPlan'))
    await inspectExtra(locations[root.name], root.name);
}
function inspection(ctx, extra = {}) {
  return { status: ctx.operation?.phase === 'COMPLETE' ? 'RESTORED_PUBLISHER_PREPARED' :
    ctx.operation ? 'RESTORED_PUBLISHER_PREPARATION_IN_PROGRESS' : 'RESTORED_PUBLISHER_REVIEW',
    reviewSha256: ctx.reviewSha256, operationId: ctx.operationId,
    manifestSha256: ctx.manifestSha256, planSha256: ctx.planSha256,
    bundleDirectory: ctx.bundleDirectory, restoreDirectory: ctx.restoreDirectory,
    paths: { datasetDirectory: ctx.target.datasetDirectory, publisherDirectory: ctx.target.publisherDirectory,
      sellerConfigFile: ctx.profile.original.sellerConfigFile ? ctx.target.sellerConfigFile : null },
    summary: copy(ctx.profile.summary),
    preparation: ctx.operation ? { phase: ctx.operation.phase, createdAt: ctx.operation.createdAt,
      updatedAt: ctx.operation.updatedAt, error: ctx.operation.error ?? null } : null,
    ...(ctx.operation?.result ? { result: copy(ctx.operation.result) } : {}), ...extra };
}

/** Inspect an already completed native cold restore. This never opens a writer,
 * rebinds a path, changes expiry, or starts a merchant/listener. */
export async function inspectRestoredPublisher(input = {}) {
  const ctx = await context(input);
  if (ctx.operation?.phase === 'COMPLETE') return inspection(ctx);
  const locations = await originalTreeLocations(ctx);
  if (!ctx.operation) {
    need(!await exists(ctx.target.datasetDirectory), 'PUBLISHER_RECOVERY_DESTINATION_EXISTS',
      'The native dataset destination must be created by this preparation.');
    await verifyInitialTrees(ctx, locations);
  }
  else {
    const raw = await readPrivate(originalIndexPath(ctx), INDEX_LIMIT);
    need(digest(raw) === ctx.profile.source.publisherIndexSha256, 'PUBLISHER_RECOVERY_ORIGINAL_INDEX_CHANGED');
    await verifyResumingFiles(ctx, locations, parse(raw, 'original publisher index'));
  }
  return inspection(ctx);
}

async function validateNativePublisher(drafts) {
  const view = drafts.view();
  for (const candidate of view.candidates) {
    const exported = await drafts.export(candidate.id), files = drafts.files(candidate.id);
    need(exported.datasetConfig.file === './data.csv', 'PUBLISHER_RECOVERY_CANDIDATE_PATH',
      'A candidate must use its original retained local data.csv.');
    const csv = await hashPrivate(files.csvPath, candidate.sourceBytes);
    need(csv.hash === candidate.csvHash && csv.bytes === candidate.sourceBytes,
      'PUBLISHER_RECOVERY_CANDIDATE_CHANGED', 'A retained candidate CSV differs from its original identity.');
    const dataset = await loadDatasetConfig(files.configPath);
    need(identity(dataset.describe()) === identity(candidate.dataset),
      'PUBLISHER_RECOVERY_CANDIDATE_CHANGED', 'The original loader returned a different retained candidate.');
    if (candidate.workbookSource) {
      const origin = candidate.workbookSource;
      const projectionRaw = await readPrivate(join(files.directory, 'workbook-projection.json'), 1024 * 1024);
      const frozen = parse(projectionRaw, 'workbook projection');
      const rows = await hashPrivate(join(files.directory, 'source-rows.jsonl'), Math.max(origin.rowMapBytes, 1));
      need(digest(projectionRaw) === origin.projectionSha256 && rows.hash === origin.rowMapSha256 &&
        rows.bytes === origin.rowMapBytes, 'PUBLISHER_RECOVERY_WORKBOOK_PROJECTION_CHANGED');
      const original = await drafts.workbooks.verify(origin.sourceId);
      need(original.record.sha256 === origin.sourceSha256 && original.record.sourceBytes === origin.sourceBytes &&
        frozen.source?.id === origin.sourceId && frozen.source?.sha256 === origin.sourceSha256 &&
        frozen.plan?.id === origin.planId && frozen.plan?.revision === origin.planRevision &&
        frozen.plan?.planSha256 === origin.planSha256 && frozen.parser?.sha256 === origin.parserSha256 &&
        frozen.projection?.csvSha256 === candidate.csvHash && frozen.projection?.rowMapSha256 === origin.rowMapSha256,
      'PUBLISHER_RECOVERY_WORKBOOK_ORIGIN_CHANGED', 'Keep the retained original workbook, mapping edition and candidate together.');
      await drafts.workbooks.parser(origin.parserSha256);
    }
  }
  for (const source of view.workbookSources) {
    await drafts.workbooks.verify(source.id);
    for (const plan of source.plans) drafts.workbooks.plan(source.id, plan.id, plan.revision);
  }
  for (const buyer of view.buyers) await drafts.buyer(buyer.id);
  return { candidates: view.candidates.length, workbooks: view.workbookSources.length,
    mappings: view.workbookSources.reduce((count, source) => count + source.plans.length, 0),
    buyerConfigurations: view.buyers.length, recoveryWarnings: copy(view.recoveryWarnings) };
}
async function moveRoot(before, after, kind) {
  const a = await exists(before), b = await exists(after);
  need(a !== b, 'PUBLISHER_RECOVERY_ASSEMBLY_AMBIGUOUS',
    'The original root is missing or exists at both its original and native receiving locations.');
  if (b) {
    const info = await lstat(after);
    need(kind === 'directory' ? info.isDirectory() && !info.isSymbolicLink() : info.isFile() && !info.isSymbolicLink(),
      'PUBLISHER_RECOVERY_ASSEMBLY_CHANGED');
    return;
  }
  await rename(before, after); await syncDirectory(dirname(before)); await syncDirectory(dirname(after));
}

/** Compose the original writers once on the authenticated receiving copy.
 * The original encrypted bundle and source host are never modified. */
export async function prepareRestoredPublisher(input = {}) {
  let ctx = await context(input);
  need(HASH.test(input.expectedReviewSha256 ?? '') && input.expectedReviewSha256 === ctx.reviewSha256,
    'PUBLISHER_RECOVERY_REVIEW_REQUIRED', 'Prepare the exact typed restore selected in the preceding review.', 400);
  if (ctx.operation?.phase === 'COMPLETE') return { ...copy(ctx.operation.result), reused: true };
  await privateDirectory(ctx.target.operationDirectory, true);
  const release = await acquireWorkspace(ctx.target.operationDirectory);
  let drafts, versions;
  const save = async () => {
    ctx.operation.updatedAt = stamp();
    await atomicJson(ctx.target.operationDirectory, 'operation.json', ctx.operation);
  };
  try {
    const current = await readOperation(ctx.target);
    if (current) {
      need(current.operationId === ctx.operationId && current.reviewSha256 === ctx.reviewSha256,
        'PUBLISHER_RECOVERY_OPERATION_CONFLICT');
      ctx.operation = current;
      if (current.phase === 'COMPLETE') return { ...copy(current.result), reused: true };
    }
    const locations = await originalTreeLocations(ctx);
    let originalPublisher;
    if (!ctx.operation) {
      need(!await exists(ctx.target.datasetDirectory), 'PUBLISHER_RECOVERY_DESTINATION_EXISTS',
        'The native dataset destination must be created by this preparation.');
      await verifyInitialTrees(ctx, locations);
      const raw = await readPrivate(join(ctx.target.publisherDirectory, 'workspace.json'), INDEX_LIMIT);
      need(digest(raw) === ctx.profile.source.publisherIndexSha256, 'PUBLISHER_RECOVERY_ORIGINAL_INDEX_CHANGED');
      const savedOriginal = originalIndexPath(ctx);
      if (await exists(savedOriginal))
        need(digest(await readPrivate(savedOriginal, INDEX_LIMIT)) === digest(raw), 'PUBLISHER_RECOVERY_ORIGINAL_INDEX_CHANGED');
      else await createFile(savedOriginal, raw);
      originalPublisher = publisherIndex(raw, ctx.profile.original.datasetDirectory);
      const originalDataset = await readPrivate(locations.datasetIndex, 262144);
      need(digest(originalDataset) === ctx.profile.source.datasetIndexSha256, 'PUBLISHER_RECOVERY_ORIGINAL_INDEX_CHANGED');
      const savedDataset = originalDatasetIndexPath(ctx);
      if (await exists(savedDataset))
        need(digest(await readPrivate(savedDataset, 262144)) === digest(originalDataset), 'PUBLISHER_RECOVERY_ORIGINAL_INDEX_CHANGED');
      else await createFile(savedDataset, originalDataset);
      ctx.operation = { schema: PUBLISHER_PREPARATION_SCHEMA, operationId: ctx.operationId,
        reviewSha256: ctx.reviewSha256, manifestSha256: ctx.manifestSha256, planSha256: ctx.planSha256,
        bundleDirectory: ctx.bundleDirectory, restoreDirectory: ctx.restoreDirectory,
        phase: 'VERIFIED', createdAt: stamp(), publisherNativeStarted: false, versionsNativeStarted: false };
      await save();
    } else {
      const raw = await readPrivate(originalIndexPath(ctx), INDEX_LIMIT);
      need(digest(raw) === ctx.profile.source.publisherIndexSha256, 'PUBLISHER_RECOVERY_ORIGINAL_INDEX_CHANGED');
      originalPublisher = parse(raw, 'original publisher index');
      await verifyResumingFiles(ctx, locations, originalPublisher);
    }
    ctx.operation.error = null;
    ctx.operation.publisherNativeStarted = true; await save();
    const currentIndex = parse(await readPrivate(join(ctx.target.publisherDirectory, 'workspace.json'), INDEX_LIMIT), 'publisher index');
    samePriorPublisher(originalPublisher, currentIndex, ctx);
    drafts = await openPublisherDrafts({ datasetDirectory: currentIndex.datasetDirectory,
      directory: ctx.target.publisherDirectory, maxCandidates: ctx.profile.limits.maxCandidates,
      maxSourceBytes: ctx.profile.limits.maxSourceBytes });
    const publisherValidation = await validateNativePublisher(drafts);
    const nativeIndex = parse(await readPrivate(join(ctx.target.publisherDirectory, 'workspace.json'), INDEX_LIMIT), 'native publisher index');
    samePriorPublisher(originalPublisher, nativeIndex, ctx);
    ctx.operation.publisherValidation = publisherValidation;
    ctx.operation.phase = 'PUBLISHER_OPEN'; await save();

    if (!await exists(ctx.target.datasetDirectory)) {
      await mkdir(ctx.target.datasetDirectory, { mode: 0o700 }); await syncDirectory(ctx.restoreDirectory);
    } else await privateDirectory(ctx.target.datasetDirectory);
    await moveRoot(ctx.target.indexBefore, join(ctx.target.datasetDirectory, 'state.json'), 'file');
    ctx.operation.phase = 'INDEX_ASSEMBLED'; await save();
    await moveRoot(ctx.target.versionsBefore, join(ctx.target.datasetDirectory, 'versions'), 'directory');
    ctx.operation.phase = 'DATASET_ASSEMBLED'; ctx.operation.versionsNativeStarted = true; await save();
    versions = await openDatasetVersions({ directory: ctx.target.datasetDirectory, collectOnOpen: false,
      maxCachedVersions: ctx.profile.limits.maxCachedVersions, maxResidentRows: ctx.profile.limits.maxResidentRows });
    const observed = versions.status(), captured = ctx.profile.summary.dataset;
    need(observed.current === captured.current && observed.revision === captured.revision &&
      identity(observed.settings) === identity(captured.settings) &&
      identity(observed.versions.map(({ snapshot, configHash, csvHash, sourceBytes, activatedAt, expiresAt }) =>
        ({ snapshot, configHash, csvHash, sourceBytes, activatedAt, expiresAt }))) === identity(captured.versions),
    'PUBLISHER_RECOVERY_DATASET_CHANGED', 'The original native version state differs from its captured identity.');
    if (!ctx.operation.adoptionArguments) {
      ctx.operation.adoptionArguments = { datasetDirectory: ctx.target.datasetDirectory,
        expectedDirectory: ctx.profile.original.datasetDirectory, expectedRevision: drafts.view().revision,
        expectedSnapshot: observed.current, expectedDatasetRevision: observed.revision,
        sourceManifestSha256: ctx.manifestSha256, sourcePlanSha256: ctx.planSha256, operationId: ctx.operationId };
      await save();
    }
    need(typeof drafts.adoptDatasetDirectory === 'function', 'PUBLISHER_RECOVERY_NATIVE_ADOPTION_REQUIRED',
      'Use the release containing the original publisher binding-adoption method.');
    const adopted = await drafts.adoptDatasetDirectory(ctx.operation.adoptionArguments);
    need(adopted.bindingCurrent, 'PUBLISHER_RECOVERY_BINDING_CHANGED',
      'The retained operation is no longer the publisher’s current directory binding.');
    ctx.operation.phase = 'BOUND'; ctx.operation.relocation = adopted.relocation; await save();
    const finalIndex = parse(await readPrivate(join(ctx.target.publisherDirectory, 'workspace.json'), INDEX_LIMIT), 'prepared publisher index');
    samePriorPublisher(originalPublisher, finalIndex, ctx);
    const sourceLocations = { datasetIndex: join(ctx.target.datasetDirectory, 'state.json'),
      datasetVersions: join(ctx.target.datasetDirectory, 'versions'), publisherWorkspace: ctx.target.publisherDirectory,
      ...(ctx.profile.original.sellerConfigFile ? { sellerConfig: ctx.target.sellerConfigFile } : {}) };
    await verifyResumingFiles(ctx, sourceLocations, originalPublisher);
    const result = { status: 'RESTORED_PUBLISHER_PREPARED', reused: false, preparedAt: stamp(),
      operationId: ctx.operationId, reviewSha256: ctx.reviewSha256,
      manifestSha256: ctx.manifestSha256, planSha256: ctx.planSha256,
      bundleDirectory: ctx.bundleDirectory, restoreDirectory: ctx.restoreDirectory,
      datasetDirectory: ctx.target.datasetDirectory, publisherDirectory: ctx.target.publisherDirectory,
      sellerConfigFile: ctx.profile.original.sellerConfigFile ? ctx.target.sellerConfigFile : null,
      originalDatasetDirectory: ctx.profile.original.datasetDirectory,
      originalPublisherDirectory: ctx.profile.original.publisherDirectory,
      captured: copy(ctx.profile.summary), dataset: observed,
      publisher: { ...summary({ ...captured, versions: captured.versions }, finalIndex, ctx.profile.limits).publisher,
        datasetDirectory: finalIndex.datasetDirectory, capacity: drafts.view().capacity,
        indexSha256: digest(await readPrivate(join(ctx.target.publisherDirectory, 'workspace.json'), INDEX_LIMIT)) },
      nativeValidation: { versions: observed.versions.length, ...publisherValidation },
      relocation: adopted.relocation, limits: copy(ctx.profile.limits),
      nativeSchema: await verifyDatasetIndex(ctx, sourceLocations.datasetIndex),
      sourceHostChanged: false, listenerStarted: false, publicationStarted: false,
      instructions: {
        seller: 'Open the original dataset-refresh CLI with this dataset state and the retained seller configuration; keep the original facilitator and environment selection.',
        publisher: 'Open the original dataset-refresh workspace with the returned datasetDirectory and publisherDirectory.',
        retainedVersions: 'Stored expiry times are unchanged. Normal live reopening may collect expired generations; saved buyer configurations do not extend retention.',
        pendingPublications: 'Original PENDING and NEEDS_REVIEW attempts remain for the publisher’s existing explicit reconciliation.',
      } };
    ctx.operation.phase = 'COMPLETE'; ctx.operation.result = result; await save();
    return result;
  } catch (error) {
    if (ctx.operation) {
      ctx.operation.error = { at: stamp(), code: error.code ?? 'PUBLISHER_RECOVERY_FAILED',
        message: String(error.message ?? error).slice(0, 1000) };
      await save().catch(() => {});
    }
    throw error;
  } finally {
    try { await drafts?.close(); } finally {
      try { await versions?.close(); } finally { await release(); }
    }
  }
}
