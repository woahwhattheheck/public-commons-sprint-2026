// MIT. Portable host custody around the original SF101 recovery and workspace engines.
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, mkdir, copyFile, chmod } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectSnapshotPlan, run as recover } from '../recover.mjs';
import { runLocalCapture, readCapturedBundle } from './local.mjs';
import { readRecoveryConfiguration, readRecoveryWorkspaceIdentity, openRecoveryWorkspace } from './model.mjs';
import { recoveryHostPaths, observeRecoveryPath } from './host-profile-paths.mjs';
import { recoveryRequestPaths } from './host-request-paths.mjs';
import { inspectHostAdoption, openHostAdoption, readHostAdoption } from './host-adoption-files.mjs';
import { readObjectRecoveryPlan } from '../../sf88-operator-buyer-cli/object-session.mjs';
import { inspectObjectSessionRecovery } from '../../sf88-operator-buyer-cli/workspace-recovery.mjs';
import { acquireDeliveryLease, inspectDeliveryLease } from '../../sf98-merchant-delivery/delivery-lock.mjs';
import { retainedSourceSelectionId } from '../../distribution/source-selection.mjs';
import { readDistributionSpecification } from '../../distribution/specification.mjs';
import { createBrowserAssetIndex } from '../../distribution/browser-assets.mjs';
import { productPackageMetadata } from '../../distribution/product-package.mjs';
import { inspectDistributionSourceImports } from '../../distribution/build.mjs';
import { absolute, privateDirectory, readJson, readPrivate, createFile, atomicJson,
  syncDirectory, bytes, digest, identity, object, fault } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';

export const HOST_HANDOFF_SELECTION_SCHEMA = 'stellar-forge.recovery-workspace-handoff-selection.v1';
export const HOST_HANDOFF_SCHEMA = 'stellar-forge.recovery-workspace-handoff.v1';
export const HOST_HANDOFF_TARGET_SCHEMA = 'stellar-forge.recovery-workspace-handoff-target.v1';
export const HOST_HANDOFF_RESULT_SCHEMA = 'stellar-forge.recovery-workspace-handoff-result.v1';
const PLAN_SCHEMA = 'stellar-forge.merchant-recovery-plan.v1';
const BUNDLE_SCHEMA = 'stellar-forge.merchant-recovery.v1';
const PLAN_ROOT = 'handoffPlan';
const MAX_PLAN = 256 * 1024, MAX_MANIFEST = 12 * 1024 * 1024;
const MAX_FILE = 2 * 1024 ** 3, MAX_SOURCE_FILE = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024, MAX_ENTRIES = 10000;
const HASH = /^[a-f0-9]{64}$/, BLOB = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/, ROOT = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PASS = /^[A-Z][A-Z0-9_]{4,63}$/;
const SF = 'stellar/scf-starforge-20261009/';
const RECOVERY = SF + 'sf101-merchant-recovery/';
const CORE = ['recover.mjs', 'remote.mjs', 'remote-s3.mjs', 'workspace/cli.mjs',
  'workspace/model.mjs', 'workspace/local.mjs', 'workspace/fleet.mjs',
  'workspace/server.mjs', 'workspace/connection.mjs', 'workspace/merchant-client.mjs',
  'workspace/merchant-catalog.mjs', 'workspace/native-receiving.mjs', 'paid-jobs.mjs',
  'dataset-publisher.mjs', 'workspace/app.mjs', 'workspace/index.html',
  'workspace/style.css', 'workspace/browser-assets.json'].map(path => RECOVERY + path);
const PROVIDER_DECLARATION = SF + 'sf30-seller-sdk/s3/package.json';
const stamp = () => new Date().toISOString();
const need = (ok, code, message = code) => { if (!ok) throw fault(code, message, 409); };
const inside = (parent, child) => parent === child || child.startsWith(parent + sep);
const overlap = (a, b) => inside(a, b) || inside(b, a);
const clone = value => JSON.parse(JSON.stringify(value));
const fields = (value, allowed, label) => {
  need(object(value) && Object.keys(value).every(key => allowed.includes(key)),
    'HOST_HANDOFF_INPUT_INVALID', 'Use the documented ' + label + ' fields.');
  return value;
};
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function logical(path) {
  need(typeof path === 'string' && path.length > 0 && path.length <= 2048 &&
    !/[\\\0]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'),
  'HOST_HANDOFF_RELATIVE_PATH_INVALID');
  return path;
}
function passphraseName(name) {
  need(PASS.test(name ?? ''), 'HOST_HANDOFF_PASSPHRASE_NAME_REQUIRED',
    'Supply the existing private passphrase environment variable name.');
  return name;
}
async function realSource(path, kind) {
  absolute(path, 'source path');
  const stat = await lstat(path);
  need(!stat.isSymbolicLink() && await realpath(path) === path &&
    (kind === 'file' ? stat.isFile() && stat.nlink === 1 : stat.isDirectory()),
  'HOST_HANDOFF_SOURCE_PATH_CHANGED', 'Use an original regular source with canonical path components.');
  return stat;
}
async function regular(path, maximum = MAX_FILE, includeBytes = false) {
  await realSource(path, 'file');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum),
      'HOST_HANDOFF_SOURCE_FILE_INVALID');
    const sha = createHash('sha256');
    const git = createHash('sha1').update('blob ' + before.size.toString() + '\0');
    const chunks = []; let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      need(size <= maximum, 'HOST_HANDOFF_SOURCE_FILE_LIMIT');
      sha.update(chunk); git.update(chunk);
      if (includeBytes) chunks.push(chunk);
    }
    const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    need(BigInt(size) === before.size &&
      ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]) &&
      named.dev === before.dev && named.ino === before.ino && !named.isSymbolicLink(),
    'HOST_HANDOFF_SOURCE_CHANGED', 'Keep the selected source quiesced during its complete read.');
    return { bytes: size, sha256: sha.digest('hex'), gitBlob: git.digest('hex'),
      ...(includeBytes ? { raw: Buffer.concat(chunks, size) } : {}) };
  } finally { await handle.close(); }
}
async function jsonSource(path, maximum = MAX_MANIFEST) {
  const value = await regular(path, maximum, true);
  try { return { ...value, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value.raw)) }; }
  catch { throw fault('HOST_HANDOFF_JSON_INVALID', 'Read the complete original UTF-8 JSON file.'); }
}
async function inventoryNames(directory, prefix = '', depth = 0) {
  need(depth <= 16, 'HOST_HANDOFF_SOURCE_DEPTH_LIMIT');
  await realSource(directory, 'directory');
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    logical(name);
    const path = join(directory, name), relativePath = prefix ? prefix + '/' + name : name;
    const stat = await lstat(path);
    need(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()),
      'HOST_HANDOFF_SOURCE_KIND_INVALID', 'Source inventories cannot contain links, sockets or devices.');
    result.push({ path: relativePath, kind: stat.isDirectory() ? 'directory' : 'file' });
    if (stat.isDirectory()) result.push(...await inventoryNames(path, relativePath, depth + 1));
    need(result.length <= MAX_ENTRIES, 'HOST_HANDOFF_SOURCE_ENTRY_LIMIT');
  }
  return result;
}
export async function inspectHostHandoffApplication(application) {
  fields(application, ['sourceDirectory', 'manifestFile'], 'original application');
  const sourceDirectory = absolute(application.sourceDirectory, 'original application source directory');
  const manifestFile = absolute(application.manifestFile, 'original distribution manifest');
  await realSource(sourceDirectory, 'directory');
  const packageDirectory = dirname(sourceDirectory);
  need(sourceDirectory === join(packageDirectory, 'source') && manifestFile === join(packageDirectory, 'manifest.json'),
    'HOST_HANDOFF_ORIGINAL_PACKAGE_LAYOUT_REQUIRED', 'Select the original adjacent package manifest and source directory.');
  const retained = await jsonSource(manifestFile), manifest = retained.value;
  need(manifest.schema === 'stellar-forge.merchant-distribution-manifest.v1' &&
    BLOB.test(manifest.sourceCommit ?? '') && typeof manifest.sourceRepository === 'string' &&
    typeof manifest.packageName === 'string' && typeof manifest.packageVersion === 'string' &&
    Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= MAX_ENTRIES,
  'HOST_HANDOFF_ORIGINAL_MANIFEST_REQUIRED',
  'Select the complete original distribution manifest and its original source directory.');
  const selectionId = retainedSourceSelectionId(manifest.sourceSelection), byPath = new Map(), packageRows = [];
  let packageMetadata;
  need(object(manifest.packageFiles) && identity(Object.keys(manifest.packageFiles).sort()) ===
    identity(['LICENSE', 'README.md', 'package.json']), 'HOST_HANDOFF_ORIGINAL_PACKAGE_FILES_REQUIRED');
  for (const [path, sha256] of Object.entries(manifest.packageFiles)) {
    need(HASH.test(sha256 ?? ''), 'HOST_HANDOFF_PACKAGE_METADATA_INVALID');
    const file = await regular(join(packageDirectory, path), MAX_SOURCE_FILE, path === 'package.json');
    need(file.sha256 === sha256, 'HOST_HANDOFF_PACKAGE_METADATA_CHANGED', 'The original package metadata changed: ' + path);
    if (path === 'package.json') {
      const metadata = JSON.parse(file.raw.toString('utf8'));
      need(metadata.name === manifest.packageName && metadata.version === manifest.packageVersion && metadata.type === 'module' &&
        object(metadata.bin) && Object.keys(metadata.bin).length > 0 && Object.keys(metadata.bin).length <= 8,
        'HOST_HANDOFF_PACKAGE_IDENTITY_CHANGED');
      packageMetadata = metadata;
    }
    packageRows.push({ relative: path, kind: 'file', bytes: file.bytes, sha256: file.sha256 });
  }
  packageRows.push({ relative: 'manifest.json', kind: 'file', bytes: retained.bytes, sha256: retained.sha256 });
  let sourceBytes = 0;
  for (const row of manifest.files) {
    logical(row.path);
    need(row.packagePath === 'source/' + row.path && !byPath.has(row.path) &&
      HASH.test(row.sha256 ?? '') && BLOB.test(row.gitBlob ?? '') &&
      Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= MAX_SOURCE_FILE &&
      ['100644', '100755'].includes(row.mode), 'HOST_HANDOFF_SOURCE_MANIFEST_INVALID');
    byPath.set(row.path, row); sourceBytes += row.bytes;
  }
  need(manifest.sourceBytes === sourceBytes && CORE.every(path => byPath.has(path)) &&
    byPath.has(PROVIDER_DECLARATION), 'HOST_HANDOFF_APPLICATION_CLOSURE_MISSING',
  'The original edition must include the recovery application, local/fleet/remote providers and S3 dependency declaration.');
  const sourceNames = new Map(), packageNames = new Map();
  for (const path of byPath.keys()) {
    sourceNames.set(path, 'file');
    const pieces = path.split('/');
    for (let i = 1; i < pieces.length; i++) sourceNames.set(pieces.slice(0, i).join('/'), 'directory');
  }
  for (const [path, kind] of sourceNames) packageNames.set('source/' + path, kind);
  packageNames.set('source', 'directory');
  for (const row of packageRows) packageNames.set(row.relative, row.kind);
  const inventory = [...packageNames].map(([path, kind]) => ({ path, kind })).sort((a, b) => a.path.localeCompare(b.path));
  need(identity((await inventoryNames(packageDirectory)).sort((a, b) => a.path.localeCompare(b.path))) ===
    identity(inventory), 'HOST_HANDOFF_APPLICATION_INVENTORY_CHANGED',
  'Capture exactly the original package inventory. Keep runtime dependencies and unrelated files outside it.');
  need(sourceBytes <= MAX_SOURCE_BYTES, 'HOST_HANDOFF_APPLICATION_SIZE_LIMIT');
  const verifiedFiles = new Map();
  for (const [path, row] of byPath) {
    const file = await regular(join(sourceDirectory, ...path.split('/')), MAX_SOURCE_FILE, true);
    need(file.bytes === row.bytes && file.sha256 === row.sha256 && file.gitBlob === row.gitBlob,
      'HOST_HANDOFF_APPLICATION_FILE_CHANGED', 'The original application file changed: ' + path);
    verifiedFiles.set(path, file.raw);
    packageRows.push({ relative: 'source/' + path, kind: 'file', bytes: row.bytes, sha256: row.sha256 });
  }
  for (const [path, kind] of packageNames) if (kind === 'directory') packageRows.push({ relative: path, kind });
  packageRows.push({ relative: '', kind: 'directory' });
  const packageTreeSha256 = identity(packageRows.sort((a, b) => a.relative.localeCompare(b.relative)));
  // Reuse the maintained edition/declaration and browser-route APIs. Preserve
  // the entire declared file inventory; never prune source by guessed imports.
  const declarations = await readDistributionSpecification({ sourceRoot: sourceDirectory, selection: selectionId });
  const product = productPackageMetadata(declarations.spec.product);
  need(identity(packageMetadata.bin) === identity(Object.fromEntries(Object.entries(product.bin).map(([name, path]) =>
    [name, './source/' + path]))) && identity(packageMetadata.repository) === identity(product.repository) &&
    manifest.sourceRepository === product.sourceRepository && byPath.get(product.readme)?.sha256 === manifest.packageFiles['README.md'],
  'HOST_HANDOFF_APPLICATION_PRODUCT_CHANGED');
  need(declarations.spec.name === manifest.packageName &&
    identity(packageMetadata.exports) === identity(declarations.spec.exports), 'HOST_HANDOFF_APPLICATION_EDITION_CHANGED');
  for (const row of declarations.inputFiles) {
    const original = byPath.get(row.path);
    need(original && original.sha256 === row.sha256 && original.bytes === row.bytes,
      'HOST_HANDOFF_APPLICATION_DECLARATION_CHANGED');
  }
  const required = new Set([...CORE, PROVIDER_DECLARATION, product.readme,
    SF + 'merchant-fleet-gateway/recovery.mjs',
    SF + 'sf98-merchant-delivery/delivery-lock.mjs',
    SF + 'sf30-seller-sdk/postgres/publisher/files.mjs',
    ...Object.values(declarations.spec.commands ?? {}),
    ...(declarations.spec.supportFiles ?? []),
    ...Object.values(declarations.spec.applicationProviders ?? {}),
    ...Object.values(declarations.spec.merchantProviders ?? {}),
    ...Object.values(declarations.spec.runtimePackageManifests ?? {})]);
  const nodeEntrypoints = new Set([...CORE.filter(path => path.endsWith('.mjs') && !path.endsWith('/workspace/app.mjs')),
    ...Object.values(product.bin), ...Object.values(declarations.spec.commands ?? {}),
    ...Object.values(declarations.spec.applicationProviders ?? {}),
    ...Object.values(declarations.spec.merchantProviders ?? {})]);
  for (const path of [RECOVERY + 'workspace/host-handoff.mjs', RECOVERY + 'workspace/host-handoff-cli.mjs'])
    if (byPath.has(path)) nodeEntrypoints.add(path);
  function exported(value, node = true) {
    if (typeof value === 'string') {
      if (['./package.json', './manifest.json'].includes(value)) return;
      need(value.startsWith('./source/'), 'HOST_HANDOFF_APPLICATION_EXPORT_INVALID');
      const path = value.slice('./source/'.length);
      required.add(path);
      if (node && /\.(?:mjs|cjs|js)$/.test(path)) nodeEntrypoints.add(path);
    } else if (object(value)) for (const [condition, child] of Object.entries(value))
      exported(child, node && !['browser', 'types'].includes(condition));
    else throw fault('HOST_HANDOFF_APPLICATION_EXPORT_INVALID');
  }
  for (const value of Object.values(declarations.spec.exports ?? {})) exported(value);
  for (const value of Object.values(packageMetadata.bin)) {
    need(typeof value === 'string' && value.startsWith('./source/'), 'HOST_HANDOFF_APPLICATION_LAUNCHER_INVALID');
    required.add(value.slice('./source/'.length));
  }
  const browser = createBrowserAssetIndex(declarations.spec.browserAssets ?? [], path => {
    need(verifiedFiles.has(path), 'HOST_HANDOFF_BROWSER_SOURCE_MISSING');
    return verifiedFiles.get(path);
  });
  for (const path of browser.files) required.add(path);
  const importCoverage = inspectDistributionSourceImports({ sources: verifiedFiles, browserAssets: browser,
    nodeEntrypoints: [...nodeEntrypoints].sort() });
  for (const path of required) need(byPath.has(path), 'HOST_HANDOFF_DECLARED_MODULE_MISSING',
    'The original edition is missing a declared command, source/provider module or browser file: ' + path);
  return { sourceDirectory, manifestFile, packageDirectory, packageTreeSha256, manifestSha256: retained.sha256,
    manifestBytes: retained.bytes, packageName: manifest.packageName, packageVersion: manifest.packageVersion,
    sourceRepository: manifest.sourceRepository, sourceCommit: manifest.sourceCommit,
    sourceSelection: manifest.sourceSelection ?? null, selectionId,
    files: byPath.size, bytes: sourceBytes, declaredModulesAndAssets: required.size,
    sourceCoverage: 'COMPLETE_ORIGINAL_MANIFEST_AND_MAINTAINED_DECLARATIONS', importCoverage,
    dependencyDeclaration: PROVIDER_DECLARATION,
    runtimeStatus: 'EXTERNAL_DEPENDENCIES_NOT_INSTALLED_OR_STARTED', manifest };
}
function rootFor(roots, path) {
  return roots.find(root => root.kind === 'file' ? root.path === path : inside(root.path, path));
}
function requireCovered(roots, path, label) {
  need(rootFor(roots, path), 'HOST_HANDOFF_REQUIRED_SOURCE_NOT_CAPTURED',
    'Include the original ' + label + ' in a declared recovery root: ' + path);
}
function sourcePoint(roots, path) {
  const root = rootFor(roots, path);
  need(root, 'HOST_HANDOFF_REQUIRED_SOURCE_NOT_CAPTURED');
  return { root: root.name, relative: path === root.path ? '' : relative(root.path, path).split(sep).join('/') };
}
function pointPath(roots, point) {
  fields(point, ['root', 'relative'], 'authenticated source point');
  const root = roots.find(row => row.name === point.root);
  need(root && typeof point.relative === 'string' &&
    (point.relative === '' || root.kind === 'directory'), 'HOST_HANDOFF_SOURCE_POINT_INVALID');
  if (point.relative) logical(point.relative);
  const path = point.relative ? join(root.path, ...point.relative.split('/')) : root.path;
  need(inside(root.path, path), 'HOST_HANDOFF_SOURCE_POINT_INVALID');
  return path;
}
function manifestPath(point) { return point.root + (point.relative ? '/' + point.relative : ''); }

const PATH_INVENTORY_SCHEMA = 'stellar-forge.recovery-workspace-host-paths.v1';
function pathRows(host, requests) {
  return [...recoveryHostPaths(host), ...requests.flatMap(({ request, path }) =>
    recoveryRequestPaths(request, { path }).map(row => ({ ...row, selectionId: null,
      custody: ['provider-configuration', 'fleet-target-private'].includes(row.role) ? 'external' : 'captured' })))]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function expandedPathRows(host, requests, readPlan, hasPath) {
  const rows = pathRows(host, requests), planSources = [], unavailablePlans = [], cache = new Map();
  const originalRows = [...rows];
  for (const row of originalRows.filter(row => row.role === 'capture-plan')) {
    const request = row.operationId ? requests.find(item => item.request.review.profileId === row.profileId &&
      item.request.review.operationId === row.operationId)?.request : null;
    const expectedSha256 = request?.review.options.expectedPlanSha256;
    const embedded = !!request && originalRows.some(item => item.role === 'capture-source' &&
      item.profileId === row.profileId && item.operationId === row.operationId);
    const present = await hasPath(row.path);
    if (!present) {
      if (request) unavailablePlans.push({ path: row.path, profileId: row.profileId, operationId: row.operationId,
        expectedSha256, actualSha256: null, rootsRetainedInRequest: embedded, reason: 'ORIGINAL_PLAN_MISSING' });
      continue;
    }
    let found = cache.get(row.path);
    if (!found) { found = await readPlan(row.path); cache.set(row.path, found); }
    if (request && found.sha256 !== expectedSha256) {
      unavailablePlans.push({ path: row.path, profileId: row.profileId, operationId: row.operationId,
        expectedSha256, actualSha256: found.sha256, rootsRetainedInRequest: embedded, reason: 'ORIGINAL_PLAN_CHANGED' });
      continue;
    }
    const plan = found.value;
    need(plan?.schema === PLAN_SCHEMA && Array.isArray(plan.roots) && plan.roots.length > 0 &&
      plan.roots.length <= 20 && new Set(plan.roots.map(root => root.name)).size === plan.roots.length,
    'HOST_HANDOFF_CAPTURE_PLAN_INVALID');
    for (const root of plan.roots) {
      need(ROOT.test(root.name ?? ''), 'HOST_HANDOFF_CAPTURE_PLAN_INVALID');
      absolute(root.path, 'original capture source');
    }
    if (!planSources.some(item => item.path === row.path))
      planSources.push({ path: row.path, bytes: found.bytes, sha256: found.sha256,
        roots: plan.roots.map(({ name, path }) => ({ name, path })) });
    if (!embedded) for (const root of plan.roots) rows.push({ path: root.path, kind: 'entry', required: false,
      role: 'capture-source', profileId: row.profileId, ...(row.operationId ? { operationId: row.operationId } : {}),
      selectionId: row.selectionId, custody: 'captured' });
  }
  return { rows: rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), planSources, unavailablePlans };
}
async function exactTreeIdentity(path) {
  const stat = await realSource(path, 'directory'), rows = [{ relative: '', kind: 'directory' }];
  for (const row of await inventoryNames(path)) {
    const file = row.kind === 'file' ? await regular(join(path, ...row.path.split('/'))) : null;
    rows.push({ relative: row.path, kind: row.kind,
      ...(file ? { bytes: file.bytes, sha256: file.sha256 } : {}) });
  }
  const current = await lstat(path);
  need(current.dev === stat.dev && current.ino === stat.ino, 'HOST_HANDOFF_OBJECT_ROOT_CHANGED');
  return identity(rows.sort((a, b) => a.relative.localeCompare(b.relative)));
}
function capturedTreeIdentity(profile, manifest, path) {
  const prefix = manifestPath(sourcePoint(profile.roots, path));
  return identity(manifest.entries.filter(row => row.path === prefix || row.path.startsWith(prefix + '/'))
    .map(row => ({ relative: row.path === prefix ? '' : row.path.slice(prefix.length + 1), kind: row.kind,
      ...(row.kind === 'file' ? { bytes: row.size, sha256: row.sha256 } : {}) }))
    .sort((a, b) => a.relative.localeCompare(b.relative)));
}
async function completePathInventory(host, requests, roots, external, requiredPaths, absentOriginalInputs) {
  const paths = [], expanded = await expandedPathRows(host, requests, path => jsonSource(path, MAX_PLAN), exists);
  for (const row of expanded.rows) {
    const observed = await observeRecoveryPath(row);
    need(!row.required || observed.exists, 'HOST_HANDOFF_REQUIRED_INPUT_MISSING',
      'The original required input is missing: ' + row.path);
    if (row.custody === 'external') {
      need(observed.exists && observed.actualKind === 'file', 'HOST_HANDOFF_EXTERNAL_INPUT_MISSING');
      external.set(row.path, 'Original ' + row.role + '; private receiving custody');
    } else if (observed.exists) {
      requireCovered(roots, row.path, row.role); requiredPaths.add(row.path);
    } else absentOriginalInputs.push({ profileId: row.profileId, ...(row.operationId ? { operationId: row.operationId } : {}),
      path: row.path, kind: row.role });
    paths.push({ ...row, exists: observed.exists, ...(observed.exists ? { actualKind: observed.actualKind } : {}) });
  }
  const objectSources = [], seen = new Set();
  for (const row of paths.filter(row => row.role === 'object-directory' && row.exists)) {
    const rootsForObject = paths.filter(root => root.role === 'object-state-root' &&
      root.profileId === row.profileId && root.operationId === row.operationId &&
      root.selectionId === row.selectionId && inside(root.path, row.path) && root.path !== row.path);
    need(rootsForObject.length > 0, 'HOST_HANDOFF_OBJECT_STATE_ROOT_REQUIRED');
    for (const root of rootsForObject) {
      const key = identity({ directory: row.path, stateRoot: root.path });
      if (seen.has(key)) continue; seen.add(key);
      const sessionFile = join(row.path, 'session.json'), present = await observeRecoveryPath({ path: sessionFile, kind: 'file' });
      if (!present.exists) {
        absentOriginalInputs.push({ profileId: row.profileId, path: sessionFile, kind: 'unprepared-object-session' });
        objectSources.push({ directory: row.path, stateRoot: root.path, prepared: false }); continue;
      }
      // The native reader owns standalone/zero-cap, original configuration,
      // dependency/assembly and all unreleased native lease validation.
      const before = await inspectObjectSessionRecovery({ directory: row.path, stateRoot: root.path, include: [] });
      need(root.exists && before.objectSession.directory === row.path, 'HOST_HANDOFF_OBJECT_SOURCE_CHANGED');
      const declared = row.operationId ? null : host.profiles.find(item => item.id === row.profileId)?.objectSessions
        .find(item => item.id === row.selectionId);
      if (declared) need(before.objectSession.sessionId === declared.sessionId, 'HOST_HANDOFF_OBJECT_SESSION_CHANGED');
      const treeSha256 = await exactTreeIdentity(root.path);
      const after = await inspectObjectSessionRecovery({ directory: row.path, stateRoot: root.path, include: [] });
      need(before.reviewSha256 === after.reviewSha256, 'HOST_HANDOFF_OBJECT_SOURCE_CHANGED');
      for (const path of before.missing) absentOriginalInputs.push({ profileId: row.profileId, path, kind: 'native-object-absent-ledger' });
      objectSources.push({ directory: row.path, stateRoot: root.path, prepared: true,
        treeSha256, nativeReviewSha256: before.reviewSha256, objectSession: clone(before.objectSession),
        assemblies: clone(before.assemblies), absentLedger: clone(before.absentLedger),
        restoreMode: before.restoreMode, walletEnvironmentExported: before.walletEnvironmentExported });
    }
  }
  for (const path of external.keys()) need(!roots.some(root => overlap(root.path, path)),
    'HOST_HANDOFF_PRIVATE_CUSTODY_OVERLAP', 'Keep private receiving credentials outside captured roots: ' + path);
  return { schema: PATH_INVENTORY_SCHEMA, paths, objectSources, planSources: expanded.planSources, unavailablePlans: expanded.unavailablePlans };
}
function validatePathInventory(profile) {
  const inventory = profile.pathInventory;
  if (inventory === undefined) return;
  need(inventory?.schema === PATH_INVENTORY_SCHEMA && Array.isArray(inventory.paths) &&
    inventory.paths.length <= 10000 && Array.isArray(inventory.objectSources) &&
    inventory.objectSources.length <= 2048 && Array.isArray(inventory.planSources) &&
    inventory.planSources.length <= 2048 && Array.isArray(inventory.unavailablePlans) &&
    inventory.unavailablePlans.length <= 2048, 'HOST_HANDOFF_PATH_INVENTORY_INVALID');
  const external = new Set(profile.externalFiles.map(row => row.path));
  for (const row of inventory.paths) {
    absolute(row.path, 'original path inventory');
    need(['file', 'directory', 'entry'].includes(row.kind) && typeof row.required === 'boolean' &&
      typeof row.exists === 'boolean' && typeof row.role === 'string' &&
      ID.test(row.profileId ?? '') && ['captured', 'external'].includes(row.custody),
    'HOST_HANDOFF_PATH_INVENTORY_INVALID');
    if (row.custody === 'external') need(row.exists && external.has(row.path), 'HOST_HANDOFF_PLAN_PRIVATE_BINDING_CHANGED');
    else if (row.exists) {
      need(['file', 'directory'].includes(row.actualKind) &&
        (row.kind === 'entry' || row.actualKind === row.kind) && profile.requiredPaths.includes(row.path),
      'HOST_HANDOFF_PATH_INVENTORY_INVALID');
      requireCovered(profile.roots, row.path, row.role);
    } else need(!row.required && profile.absentOriginalInputs.some(item => item.path === row.path),
      'HOST_HANDOFF_PATH_INVENTORY_INVALID');
  }
  for (const row of inventory.unavailablePlans) {
    absolute(row.path, 'original unavailable capture plan');
    need(ID.test(row.profileId ?? '') && ID.test(row.operationId ?? '') && HASH.test(row.expectedSha256 ?? '') &&
      (row.actualSha256 === null || HASH.test(row.actualSha256 ?? '')) &&
      typeof row.rootsRetainedInRequest === 'boolean' &&
      row.reason === (row.actualSha256 === null ? 'ORIGINAL_PLAN_MISSING' : 'ORIGINAL_PLAN_CHANGED'),
    'HOST_HANDOFF_CAPTURE_PLAN_INVALID');
  }
  for (const row of inventory.planSources) {
    absolute(row.path, 'original capture plan');
    need(HASH.test(row.sha256 ?? '') && Number.isSafeInteger(row.bytes) && row.bytes > 0 &&
      row.bytes <= MAX_PLAN && Array.isArray(row.roots) && row.roots.length <= 20,
    'HOST_HANDOFF_CAPTURE_PLAN_INVALID');
    requireCovered(profile.roots, row.path, 'original capture plan');
  }
  for (const row of inventory.objectSources) {
    absolute(row.directory, 'native Object directory'); absolute(row.stateRoot, 'native Object state root');
    need(inside(row.stateRoot, row.directory) && row.directory !== row.stateRoot &&
      typeof row.prepared === 'boolean', 'HOST_HANDOFF_OBJECT_SOURCE_CHANGED');
    requireCovered(profile.roots, row.directory, 'native Object directory');
    if (row.prepared) {
      requireCovered(profile.roots, row.stateRoot, 'complete native Object state root');
      need(HASH.test(row.treeSha256 ?? '') && HASH.test(row.nativeReviewSha256 ?? '') &&
        row.objectSession?.directory === row.directory && HASH.test(row.objectSession.definitionSha256 ?? '') &&
        HASH.test(row.objectSession.configurationsSha256 ?? '') && Array.isArray(row.assemblies) &&
        row.absentLedger?.state === 'ABSENT' && row.restoreMode === 'ORIGINAL_CANONICAL_STATE_ROOT' &&
        row.walletEnvironmentExported === false, 'HOST_HANDOFF_OBJECT_SOURCE_CHANGED');
    }
  }
}
async function checkAbsentInputs(profile) {
  for (const row of profile.absentOriginalInputs) {
    const observed = await observeRecoveryPath({ path: row.path, kind: 'entry' });
    need(!observed.exists, 'HOST_HANDOFF_ORIGINAL_ABSENCE_CHANGED',
      'The original absent input is now present: ' + row.path);
  }
}
function legacyPathsSupported(host, requests) {
  need(!host.profiles.some(row => row.objectSessions.length || row.objectBundleArchives.length ||
    row.casesDirectory || row.caseSourceDirectory) &&
    !requests.some(({ request }) => /^(?:object-)/.test(request.review.command)),
  'HOST_HANDOFF_COMPLETE_PATH_REVIEW_REQUIRED',
  'Preserve the previous handoff and prepare a complete path review for this newer host configuration.');
}

async function sourceSelection(selection, { checkLeases = true, completePaths = true } = {}) {
  fields(selection, ['schema', 'operationId', 'configFile', 'workspaceDirectory', 'application', 'roots', 'externalFiles'], 'handoff selection');
  need(selection.schema === HOST_HANDOFF_SELECTION_SCHEMA && ID.test(selection.operationId ?? '') &&
    Array.isArray(selection.roots) && selection.roots.length > 0 && selection.roots.length <= 19,
  'HOST_HANDOFF_SELECTION_INVALID');
  const configFile = absolute(selection.configFile, 'original host configuration');
  const workspaceDirectory = absolute(selection.workspaceDirectory, 'original workspace');
  const names = new Set(), roots = [];
  for (const row of selection.roots) {
    fields(row, ['name', 'path'], 'source root');
    need(ROOT.test(row.name ?? '') && row.name !== PLAN_ROOT && !names.has(row.name), 'HOST_HANDOFF_ROOT_NAME_INVALID');
    names.add(row.name); absolute(row.path, 'source root');
    const stat = await lstat(row.path);
    need(stat.isFile() || stat.isDirectory(), 'HOST_HANDOFF_SOURCE_KIND_INVALID');
    const kind = stat.isDirectory() ? 'directory' : 'file';
    await realSource(row.path, kind); roots.push({ name: row.name, path: row.path, kind });
  }
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++)
    need(!overlap(roots[i].path, roots[j].path), 'HOST_HANDOFF_SOURCE_ROOT_OVERLAP');
  const configuration = await readRecoveryConfiguration(configFile);
  const workspace = await readRecoveryWorkspaceIdentity({ configFile, directory: workspaceDirectory });
  const workspaceStateFile = join(workspaceDirectory, 'workspace.json');
  const workspaceState = await readJson(workspaceStateFile, 2 * 1024 * 1024);
  need(typeof workspaceState.createdAt === 'string' && Number.isFinite(Date.parse(workspaceState.createdAt)),
    'HOST_HANDOFF_WORKSPACE_CREATED_AT_REQUIRED');
  requireCovered(roots, configFile, 'host configuration');
  requireCovered(roots, workspaceDirectory, 'workspace state and requests');
  const application = await inspectHostHandoffApplication(selection.application);
  requireCovered(roots, application.packageDirectory, 'complete original application package');
  requireCovered(roots, application.sourceDirectory, 'complete application source');
  requireCovered(roots, application.manifestFile, 'original distribution manifest');
  const external = new Map(), requiredPaths = new Set([configFile, workspaceDirectory,
    application.sourceDirectory, application.manifestFile, application.packageDirectory]), leases = new Set([workspaceDirectory]);
  need(selection.externalFiles === undefined || Array.isArray(selection.externalFiles), 'HOST_HANDOFF_EXTERNAL_FILES_INVALID');
  for (const row of selection.externalFiles ?? []) {
    fields(row, ['path', 'purpose'], 'external private file');
    absolute(row.path, 'external private file');
    need(typeof row.purpose === 'string' && row.purpose.length > 0 && row.purpose.length <= 160 &&
      !/[\0\r\n]/.test(row.purpose) && !external.has(row.path), 'HOST_HANDOFF_EXTERNAL_FILES_INVALID');
    external.set(row.path, row.purpose);
  }
  const absentOriginalInputs = [], passphraseEnvironments = new Set();
  for (const profile of configuration.host.profiles) {
    passphraseEnvironments.add(profile.passEnv);
    if (profile.storeConfig) external.set(profile.storeConfig, 'Original provider configuration; private receiving custody');
    for (const target of profile.fleetTargets) external.set(target.targetFile, 'Original private fleet receiving selection');
    for (const path of [profile.operations, ...profile.bundleRoots.map(row => row.directory),
      profile.downloadRoot, profile.restoreRoot]) {
      await realSource(path, 'directory'); requireCovered(roots, path, 'profile state, original journals or encrypted bundles');
      requiredPaths.add(path);
    }
    leases.add(profile.operations);
    for (const plan of profile.capturePlans) {
      if (await exists(plan.planFile)) {
        requireCovered(roots, plan.planFile, 'original capture plan'); requiredPaths.add(plan.planFile);
      } else absentOriginalInputs.push({ profileId: profile.id, path: plan.planFile, kind: 'capture-plan' });
    }
    for (const target of profile.fleetTargets) if (await exists(target.operationDirectory)) {
      requireCovered(roots, target.operationDirectory, 'original fleet receiving journal');
      requiredPaths.add(target.operationDirectory);
    }
  }
  for (const path of external.keys()) need(!roots.some(root => overlap(root.path, path)),
    'HOST_HANDOFF_PRIVATE_CUSTODY_OVERLAP',
    'Keep credential, passphrase-custody and private provider files outside every captured root: ' + path);
  need(!await exists(join(workspaceDirectory, 'recovery-workspace-launch.json')),
    'HOST_HANDOFF_LISTENER_NOT_RETIRED',
    'Close the original listener so it retires its private launch; retain stale launches through their original owner.');
  if (checkLeases) for (const path of [...leases].sort()) {
    const lease = await inspectDeliveryLease(path);
    need(!lease.active, 'HOST_HANDOFF_ORIGINAL_WRITER_ACTIVE', 'Stop the existing writer before capturing: ' + path);
  }
  const originalRecords = [], requests = [];
  const requestsDirectory = join(workspaceDirectory, 'requests');
  if (await exists(requestsDirectory)) for (const name of (await readdir(requestsDirectory)).sort()) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const path = join(requestsDirectory, name), row = await jsonSource(path, 2 * 1024 * 1024);
    need(row.value.schema === 'stellar-forge.recovery-workspace-request.v1' &&
      ID.test(row.value.review?.operationId ?? '') && ID.test(row.value.review?.profileId ?? ''),
      'HOST_HANDOFF_ORIGINAL_REQUEST_INVALID');
    requests.push({ request: row.value, path });
    originalRecords.push({ kind: 'workspace-request', path, bytes: row.bytes, sha256: row.sha256,
      profileId: row.value.review.profileId, operationId: row.value.review.operationId,
      command: row.value.review.command, phase: row.value.phase });
  }
  for (const profile of configuration.host.profiles) for (const name of (await readdir(profile.operations)).sort()) {
    if (!ID.test(name)) continue;
    const path = join(profile.operations, name, 'operation.json');
    if (!await exists(path)) continue;
    const row = await jsonSource(path, 1024 * 1024), journal = row.value;
    need(journal.schema === 'stellar-forge.merchant-recovery-transfer.v1' && journal.id === name &&
      object(journal.binding), 'HOST_HANDOFF_ORIGINAL_JOURNAL_INVALID');
    originalRecords.push({ kind: 'transfer-journal', path, bytes: row.bytes, sha256: row.sha256,
      profileId: profile.id, operationId: journal.id, command: journal.command, phase: journal.status,
      snapshotId: journal.snapshotId ?? null });
    for (const path of [journal.binding.bundle, journal.binding.bundleOut, journal.binding.out].filter(Boolean)) {
      absolute(path, 'original journal path');
      if (await exists(path)) { requireCovered(roots, path, 'original journal-bound bytes'); requiredPaths.add(path); }
      else {
        need(journal.status !== 'COMPLETE', 'HOST_HANDOFF_COMPLETED_SOURCE_MISSING',
          'A completed original journal has missing retained bytes: ' + path);
        absentOriginalInputs.push({ profileId: profile.id, operationId: journal.id, path, kind: 'pending-journal-output' });
      }
    }
  }
  let pathInventory;
  if (completePaths) {
    pathInventory = await completePathInventory(configuration.host, requests, roots, external, requiredPaths, absentOriginalInputs);
    await checkAbsentInputs({ absentOriginalInputs });
  } else legacyPathsSupported(configuration.host, requests);
  const externalFiles = [];
  for (const [path, purpose] of [...external].sort(([a], [b]) => a.localeCompare(b))) {
    await realSource(path, 'file');
    const selected = await readPrivate(path, 2 * 1024 * 1024);
    externalFiles.push({ path, purpose, sha256: digest(selected), bytes: selected.length });
  }
  const { manifest, ...edition } = application;
  return { schema: HOST_HANDOFF_SCHEMA, operationId: selection.operationId,
    selection: clone(selection), roots, workspace: { ...workspace, createdAt: workspaceState.createdAt,
      stateSha256: digest(await readPrivate(workspaceStateFile, 2 * 1024 * 1024)),
      state: sourcePoint(roots, workspaceStateFile), configuration: sourcePoint(roots, configFile) },
    application: { ...edition, package: sourcePoint(roots, application.packageDirectory),
      source: sourcePoint(roots, application.sourceDirectory),
      manifest: sourcePoint(roots, application.manifestFile) },
    originalRecords: originalRecords.map(row => ({ ...row, source: sourcePoint(roots, row.path) })),
    requiredPaths: [...requiredPaths].sort(), externalFiles,
    passphraseEnvironments: [...passphraseEnvironments].sort(), absentOriginalInputs,
    leases: [...leases].sort(), ...(pathInventory ? { pathInventory } : {}) };
}
async function withOriginalLeases(profile, action) {
  const held = [];
  try {
    for (const path of profile.leases) held.push(await acquireDeliveryLease(path, { purpose: 'drain' }));
    return await action();
  } finally { for (const lease of held.reverse()) await lease.release(); }
}
function typedPlan(raw) {
  need(raw.length > 0 && raw.length <= MAX_PLAN, 'HOST_HANDOFF_PLAN_SIZE_INVALID');
  let plan;
  try { plan = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('HOST_HANDOFF_PLAN_INVALID'); }
  const profile = plan?.hostHandoff;
  need(plan?.schema === PLAN_SCHEMA && profile?.schema === HOST_HANDOFF_SCHEMA &&
    ID.test(profile.operationId ?? '') && object(profile.workspace) && object(profile.application) &&
    Array.isArray(profile.roots) && profile.roots.length > 0 && profile.roots.length <= 19 &&
    Array.isArray(profile.originalRecords) && Array.isArray(profile.externalFiles) &&
    Array.isArray(profile.requiredPaths) && Array.isArray(profile.leases) &&
    Array.isArray(profile.passphraseEnvironments) && Array.isArray(profile.absentOriginalInputs),
  'HOST_HANDOFF_ORIGINAL_PLAN_REQUIRED');
  absolute(profile.planFile, 'original handoff plan');
  need(identity(plan.roots) === identity([...profile.roots.map(({ name, path }) => ({ name, path })),
    { name: PLAN_ROOT, path: profile.planFile }]), 'HOST_HANDOFF_PLAN_ROOTS_CHANGED');
  for (const root of profile.roots) {
    need(ROOT.test(root.name ?? '') && root.name !== PLAN_ROOT && ['directory', 'file'].includes(root.kind),
      'HOST_HANDOFF_PLAN_ROOTS_CHANGED');
    absolute(root.path, 'original captured root');
  }
  need(new Set(profile.roots.map(row => row.name)).size === profile.roots.length &&
    !profile.roots.some(root => overlap(root.path, profile.planFile)) &&
    HASH.test(profile.workspace.stateSha256 ?? '') && HASH.test(profile.workspace.configurationSha256 ?? '') &&
    HASH.test(profile.application.manifestSha256 ?? '') && HASH.test(profile.application.packageTreeSha256 ?? '') &&
    BLOB.test(profile.application.sourceCommit ?? ''),
  'HOST_HANDOFF_PLAN_IDENTITY_CHANGED');
  for (let i = 0; i < profile.roots.length; i++) for (let j = i + 1; j < profile.roots.length; j++)
    need(!overlap(profile.roots[i].path, profile.roots[j].path), 'HOST_HANDOFF_PLAN_ROOTS_CHANGED');
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  need(uuid.test(profile.workspace.workspaceId ?? '') && typeof profile.workspace.createdAt === 'string' &&
    Number.isFinite(Date.parse(profile.workspace.createdAt)) && object(profile.selection) &&
    profile.selection.schema === HOST_HANDOFF_SELECTION_SCHEMA &&
    profile.selection.operationId === profile.operationId &&
    identity(profile.selection.roots) === identity(profile.roots.map(({ name, path }) => ({ name, path }))),
  'HOST_HANDOFF_PLAN_IDENTITY_CHANGED');
  absolute(profile.workspace.directory, 'original workspace directory');
  absolute(profile.workspace.configFile, 'original host configuration');
  need(profile.workspace.directory === profile.selection.workspaceDirectory &&
    profile.workspace.configFile === profile.selection.configFile &&
    pointPath(profile.roots, profile.workspace.state) === join(profile.workspace.directory, 'workspace.json') &&
    pointPath(profile.roots, profile.workspace.configuration) === profile.workspace.configFile &&
    pointPath(profile.roots, profile.application.package) === profile.application.packageDirectory &&
    profile.application.sourceDirectory === join(profile.application.packageDirectory, 'source') &&
    profile.application.manifestFile === join(profile.application.packageDirectory, 'manifest.json') &&
    pointPath(profile.roots, profile.application.source) === profile.application.sourceDirectory &&
    pointPath(profile.roots, profile.application.manifest) === profile.application.manifestFile &&
    profile.application.sourceDirectory === profile.selection.application?.sourceDirectory &&
    profile.application.manifestFile === profile.selection.application?.manifestFile,
  'HOST_HANDOFF_PLAN_PATH_BINDING_CHANGED');
  requireCovered(profile.roots, profile.workspace.directory, 'workspace directory');
  for (const path of [...profile.requiredPaths, ...profile.leases]) {
    absolute(path, 'original required path'); requireCovered(profile.roots, path, 'required path');
  }
  need(profile.leases.includes(profile.workspace.directory) &&
    profile.leases.every(path => profile.requiredPaths.includes(path)), 'HOST_HANDOFF_PLAN_LEASE_BINDING_CHANGED');
  const external = new Set();
  for (const row of profile.externalFiles) {
    absolute(row.path, 'original external file');
    need(!external.has(row.path) && HASH.test(row.sha256 ?? '') &&
      Number.isSafeInteger(row.bytes) && row.bytes >= 0 &&
      !profile.roots.some(root => overlap(root.path, row.path)),
    'HOST_HANDOFF_PLAN_PRIVATE_BINDING_CHANGED');
    external.add(row.path);
  }
  for (const name of profile.passphraseEnvironments) passphraseName(name);
  for (const row of profile.originalRecords) {
    need(['workspace-request', 'transfer-journal'].includes(row.kind) && HASH.test(row.sha256 ?? '') &&
      Number.isSafeInteger(row.bytes) && row.bytes > 0 && ID.test(row.operationId ?? '') &&
      ID.test(row.profileId ?? '') && pointPath(profile.roots, row.source) === row.path,
    'HOST_HANDOFF_PLAN_RECORD_BINDING_CHANGED');
  }
  validatePathInventory(profile);
  return { plan, profile };
}
function inspectCaptured(raw, manifest) {
  const { profile } = typedPlan(raw), planSha256 = digest(raw);
  const roots = [...profile.roots, { name: PLAN_ROOT, kind: 'file' }];
  need(manifest?.schema === BUNDLE_SCHEMA && Array.isArray(manifest.entries) &&
    manifest.entries.length <= MAX_ENTRIES &&
    identity(manifest.roots) === identity(roots.map(({ name, kind }) => ({ name, kind }))) &&
    manifest.capture?.planSha256 === planSha256 && manifest.capture?.id === identity({
      purpose: 'recovery-workspace-host-handoff', operationId: profile.operationId,
      workspaceId: profile.workspace.workspaceId, planSha256 }),
  'HOST_HANDOFF_CAPTURE_BINDING_CHANGED');
  const byPath = new Map(manifest.entries.map(row => [row.path, row]));
  const checks = [
    { source: { root: PLAN_ROOT, relative: '' }, sha256: planSha256, bytes: raw.length },
    { source: profile.workspace.state, sha256: profile.workspace.stateSha256 },
    { source: profile.workspace.configuration, sha256: profile.workspace.configurationSha256 },
    { source: profile.application.manifest, sha256: profile.application.manifestSha256,
      bytes: profile.application.manifestBytes },
    ...profile.originalRecords
  ];
  for (const check of checks) {
    const row = byPath.get(manifestPath(check.source));
    need(row?.kind === 'file' && row.sha256 === check.sha256 &&
      (check.bytes === undefined || row.size === check.bytes), 'HOST_HANDOFF_ORIGINAL_BYTES_CHANGED',
    'The authenticated capture must contain the exact reviewed application, identity and original journals.');
  }
  const packagePrefix = manifestPath(profile.application.package);
  const packageRows = manifest.entries.filter(row => row.path === packagePrefix || row.path.startsWith(packagePrefix + '/'))
    .map(row => ({ relative: row.path === packagePrefix ? '' : row.path.slice(packagePrefix.length + 1),
      kind: row.kind, ...(row.kind === 'file' ? { bytes: row.size, sha256: row.sha256 } : {}) }))
    .sort((a, b) => a.relative.localeCompare(b.relative));
  need(identity(packageRows) === profile.application.packageTreeSha256,
    'HOST_HANDOFF_CAPTURE_APPLICATION_CHANGED', 'Captured application bytes must match the exact reviewed original package.');
  for (const path of profile.requiredPaths)
    need(byPath.has(manifestPath(sourcePoint(profile.roots, path))), 'HOST_HANDOFF_CAPTURE_REQUIRED_PATH_MISSING');
  for (const row of profile.absentOriginalInputs) {
    absolute(row.path, 'original absent input');
    if (rootFor(profile.roots, row.path)) need(!byPath.has(manifestPath(sourcePoint(profile.roots, row.path))),
      'HOST_HANDOFF_CAPTURE_ABSENCE_CHANGED', 'An original absent input appeared after review.');
  }
  for (const plan of profile.pathInventory?.unavailablePlans ?? []) if (plan.actualSha256 !== null) {
    const row = byPath.get(manifestPath(sourcePoint(profile.roots, plan.path)));
    need(row?.kind === 'file' && row.sha256 === plan.actualSha256, 'HOST_HANDOFF_CAPTURE_PLAN_CHANGED');
  }
  for (const plan of profile.pathInventory?.planSources ?? []) {
    const row = byPath.get(manifestPath(sourcePoint(profile.roots, plan.path)));
    need(row?.kind === 'file' && row.sha256 === plan.sha256 && row.size === plan.bytes,
      'HOST_HANDOFF_CAPTURE_PLAN_CHANGED');
  }
  for (const row of profile.pathInventory?.objectSources ?? []) if (row.prepared)
    need(capturedTreeIdentity(profile, manifest, row.stateRoot) === row.treeSha256,
      'HOST_HANDOFF_NATIVE_OBJECT_CAPTURE_CHANGED',
      'The captured complete Object root must preserve the reviewed source, inbox, lease and restoration history.');
  return { profile, planSha256 };
}
export async function prepareHostHandoffPlan({ selection, planFile, quiesced = false } = {}) {
  need(quiesced === true, 'HOST_HANDOFF_QUIESCENCE_REQUIRED', 'Stop the original workspace and selected source writers through export.');
  absolute(planFile, 'new handoff plan'); await privateDirectory(dirname(planFile));
  const selected = await sourceSelection(selection);
  need(!selected.roots.some(root => overlap(root.path, planFile)) &&
    !selected.absentOriginalInputs.some(row => overlap(row.path, planFile)), 'HOST_HANDOFF_PLAN_OVERLAP');
  return withOriginalLeases(selected, async () => {
    const current = await sourceSelection(selection, { checkLeases: false });
    need(identity(current) === identity(selected), 'HOST_HANDOFF_SOURCE_CHANGED_AFTER_REVIEW');
    const profile = { ...current, planFile, createdAt: stamp() };
    const plan = { schema: PLAN_SCHEMA, roots: [...profile.roots.map(({ name, path }) => ({ name, path })),
      { name: PLAN_ROOT, path: planFile }], hostHandoff: profile };
    const raw = bytes(plan);
    need(raw.length <= MAX_PLAN, 'HOST_HANDOFF_PLAN_SIZE_INVALID');
    await createFile(planFile, raw); await syncDirectory(dirname(planFile));
    return { schema: HOST_HANDOFF_RESULT_SCHEMA, status: 'HOST_HANDOFF_PLAN_READY',
      operationId: profile.operationId, planFile, planSha256: digest(raw),
      workspaceId: profile.workspace.workspaceId, application: clone(profile.application),
      roots: clone(profile.roots), externalFiles: clone(profile.externalFiles),
      originalRecords: clone(profile.originalRecords), absentOriginalInputs: clone(profile.absentOriginalInputs),
      pathInventory: clone(profile.pathInventory) };
  });
}
export async function exportHostHandoff({ planFile, bundleDirectory, operationDirectory,
  passphraseEnv, expectedPlanSha256, quiesced = false } = {}) {
  absolute(planFile, 'original plan'); absolute(bundleDirectory, 'encrypted handoff bundle');
  absolute(operationDirectory, 'original capture operation'); passphraseName(passphraseEnv);
  need(HASH.test(expectedPlanSha256 ?? ''), 'HOST_HANDOFF_PLAN_REVIEW_REQUIRED');
  const stateFile = join(operationDirectory, 'capture.json');
  let saved = await exists(stateFile) ? await readJson(stateFile, 2 * 1024 * 1024) : null;
  const raw = await exists(planFile) ? await readPrivate(planFile, MAX_PLAN) :
    saved?.planBase64 ? Buffer.from(saved.planBase64, 'base64') : null;
  need(raw && digest(raw) === expectedPlanSha256, 'HOST_HANDOFF_PLAN_CHANGED');
  const { profile } = typedPlan(raw);
  need(profile.planFile === planFile && !overlap(bundleDirectory, operationDirectory) &&
    !overlap(bundleDirectory, planFile) && !overlap(operationDirectory, planFile) &&
    !profile.roots.some(root => overlap(root.path, operationDirectory) || overlap(root.path, bundleDirectory)) &&
    !profile.externalFiles.some(row => overlap(row.path, operationDirectory) || overlap(row.path, bundleDirectory)) &&
    !profile.absentOriginalInputs.some(row => overlap(row.path, operationDirectory) || overlap(row.path, bundleDirectory)),
  'HOST_HANDOFF_CAPTURE_PATH_OVERLAP');
  await privateDirectory(dirname(operationDirectory));
  if (!await exists(operationDirectory)) await mkdir(operationDirectory, { mode: 0o700 });
  await privateDirectory(operationDirectory);
  const lease = await acquireDeliveryLease(operationDirectory, { purpose: 'drain' });
  try {
    // Re-read after the original capture lease; a second writer cannot replace
    // the retained selection between the harmless read and mutation.
    const now = await exists(stateFile) ? await readJson(stateFile, 2 * 1024 * 1024) : null;
    need(identity(now) === identity(saved), 'HOST_HANDOFF_CAPTURE_STATE_CHANGED');
    const options = { command: 'snapshot', id: profile.operationId, captureKind: 'generic',
      plan: planFile, out: bundleDirectory, passEnv: passphraseEnv, expectedPlanSha256,
      captureId: identity({ purpose: 'recovery-workspace-host-handoff', operationId: profile.operationId,
        workspaceId: profile.workspace.workspaceId, planSha256: expectedPlanSha256 }) };
    if (saved) need(saved.schema === HOST_HANDOFF_SCHEMA &&
      identity(saved.options) === identity(options) && saved.planBase64 === raw.toString('base64'),
    'HOST_HANDOFF_CAPTURE_SELECTION_CHANGED', 'Keep the original capture operation and its exact source selection.');
    else saved = { schema: HOST_HANDOFF_SCHEMA, options, planBase64: raw.toString('base64'), local: {} };
    const save = () => atomicJson(operationDirectory, 'capture.json', saved);
    const capture = () => runLocalCapture({ options, state: saved.local, save,
      allowCapture: quiesced === true });
    let result;
    if (await readCapturedBundle(options)) result = await capture();
    else {
      need(quiesced === true, 'HOST_HANDOFF_QUIESCENCE_REQUIRED');
      const selected = await sourceSelection(profile.selection, { completePaths: profile.pathInventory !== undefined });
      const { createdAt, planFile: ignoredPlan, ...expected } = profile;
      need(identity(selected) === identity(expected), 'HOST_HANDOFF_SOURCE_CHANGED_AFTER_REVIEW');
      result = await withOriginalLeases(profile, async () => {
        const current = await sourceSelection(profile.selection, { checkLeases: false, completePaths: profile.pathInventory !== undefined });
        need(identity(current) === identity(expected), 'HOST_HANDOFF_SOURCE_CHANGED_AFTER_REVIEW');
        await inspectSnapshotPlan({ plan: planFile, out: bundleDirectory, expectedPlanSha256 });
        await save();
        return capture();
      });
    }
    need(result.status === 'COMPLETE' && result.verified === true, 'HOST_HANDOFF_CAPTURE_INCOMPLETE');
    const found = await readCapturedBundle(options);
    inspectCaptured(raw, found.manifest);
    if (profile.pathInventory && quiesced) await checkAbsentInputs(profile);
    return { schema: HOST_HANDOFF_RESULT_SCHEMA, status: 'HOST_HANDOFF_EXPORTED',
      operationId: profile.operationId, workspaceId: profile.workspace.workspaceId,
      bundleDirectory, operationDirectory, manifestSha256: found.snapshotId,
      planSha256: expectedPlanSha256, originalCapture: result, application: clone(profile.application),
      privateCustody: { externalFiles: clone(profile.externalFiles),
        passphraseEnvironments: clone(profile.passphraseEnvironments) } };
  } finally { await lease.release(); }
}
async function authenticated(input) {
  absolute(input.bundleDirectory, 'original encrypted handoff bundle');
  passphraseName(input.passphraseEnv);
  need(HASH.test(input.expectedManifestSha256 ?? ''), 'HOST_HANDOFF_MANIFEST_REVIEW_REQUIRED');
  await privateDirectory(input.bundleDirectory);
  const raw = await readPrivate(join(input.bundleDirectory, 'manifest.json'), MAX_MANIFEST);
  need(digest(raw) === input.expectedManifestSha256, 'HOST_HANDOFF_BUNDLE_CHANGED');
  const verification = await recover(['verify', '--bundle', input.bundleDirectory, '--pass-env', input.passphraseEnv]);
  need(verification.status === 'SNAPSHOT_VERIFIED' &&
    digest(await readPrivate(join(input.bundleDirectory, 'manifest.json'), MAX_MANIFEST)) === input.expectedManifestSha256,
  'HOST_HANDOFF_BUNDLE_CHANGED');
  return { manifest: JSON.parse(raw.toString('utf8')), manifestSha256: input.expectedManifestSha256, verification };
}
function rootEntries(manifest, name) {
  return manifest.entries.filter(row => row.path === name || row.path.startsWith(name + '/')).map(row => ({
    relative: row.path === name ? '' : row.path.slice(name.length + 1), kind: row.kind,
    ...(row.kind === 'file' ? { bytes: row.size, sha256: row.sha256 } : {})
  }));
}
async function matchTree(path, entries, sourceModes = new Map()) {
  need(entries.length > 0, 'HOST_HANDOFF_ROOT_INVENTORY_MISSING');
  const root = entries.find(row => row.relative === '');
  need(root, 'HOST_HANDOFF_ROOT_INVENTORY_MISSING');
  await realSource(path, root.kind);
  const actualNames = root.kind === 'file' ? [] : await inventoryNames(path);
  need(identity(actualNames.sort((a, b) => a.path.localeCompare(b.path))) === identity(entries.filter(row => row.relative).map(row => ({
    path: row.relative, kind: row.kind })).sort((a, b) => a.path.localeCompare(b.path))), 'HOST_HANDOFF_RESTORED_TREE_CHANGED',
  'The complete original tree must match; partial or unrelated receiving bytes remain untouched.');
  for (const row of entries) {
    const selected = row.relative ? join(path, ...row.relative.split('/')) : path;
    const info = await lstat(selected);
    const sourceMode = sourceModes.get(selected);
    need(row.kind === 'file' && sourceMode !== undefined ?
      [0o600, sourceMode].includes(info.mode & 0o777) : !(info.mode & 0o077),
    'HOST_HANDOFF_PRIVATE_RESTORE_REQUIRED');
    if (row.kind === 'file') {
      const current = await regular(selected);
      need(current.bytes === row.bytes && current.sha256 === row.sha256, 'HOST_HANDOFF_RESTORED_BYTES_CHANGED');
    }
  }
}
async function restoredContext(input, { restore = false } = {}) {
  absolute(input.restoreDirectory, 'original cold restore directory');
  need(!overlap(input.bundleDirectory, input.restoreDirectory), 'HOST_HANDOFF_RESTORE_OVERLAP');
  const auth = await authenticated(input);
  let originalRestore = null;
  if (!await exists(input.restoreDirectory)) {
    need(restore, 'HOST_HANDOFF_COLD_RESTORE_REQUIRED', 'Restore the original handoff before receiving review.');
    await realSource(dirname(input.restoreDirectory), 'directory');
    originalRestore = await recover(['restore', '--bundle', input.bundleDirectory,
      '--out', input.restoreDirectory, '--pass-env', input.passphraseEnv]);
    need(originalRestore.status === 'RESTORED_TO_NEW_DIR', 'HOST_HANDOFF_COLD_RESTORE_INCOMPLETE');
  }
  await privateDirectory(input.restoreDirectory);
  need(identity((await readdir(input.restoreDirectory)).sort()) === identity(auth.manifest.roots.map(row => row.name).sort()),
    'HOST_HANDOFF_RESTORED_TREE_CHANGED');
  for (const root of auth.manifest.roots) await matchTree(join(input.restoreDirectory, root.name), rootEntries(auth.manifest, root.name));
  const raw = await readPrivate(join(input.restoreDirectory, PLAN_ROOT), MAX_PLAN);
  const { profile, planSha256 } = inspectCaptured(raw, auth.manifest);
  const sourcePath = point => join(input.restoreDirectory, point.root, ...(point.relative ? point.relative.split('/') : []));
  const configuration = await readRecoveryConfiguration(sourcePath(profile.workspace.configuration));
  const state = await readJson(sourcePath(profile.workspace.state), 2 * 1024 * 1024);
  need(state.schema === 'stellar-forge.recovery-workspace-state.v1' &&
    state.id === profile.workspace.workspaceId && state.createdAt === profile.workspace.createdAt &&
    state.configFile === profile.workspace.configFile &&
    configuration.sha256 === profile.workspace.configurationSha256,
  'HOST_HANDOFF_RESTORED_WORKSPACE_IDENTITY_CHANGED');
  const requests = [];
  for (const row of profile.originalRecords.filter(row => row.kind === 'workspace-request')) {
    const saved = await jsonSource(sourcePath(row.source), 2 * 1024 * 1024);
    requests.push({ path: row.path, request: saved.value });
  }
  if (profile.pathInventory) {
    const recordedRows = profile.pathInventory.paths.map(({ exists, actualKind, ...row }) => row);
    const expanded = await expandedPathRows(configuration.host, requests,
      path => jsonSource(sourcePath(sourcePoint(profile.roots, path)), MAX_PLAN),
      path => profile.pathInventory.paths.some(row => row.path === path && row.exists));
    need(identity(recordedRows) === identity(expanded.rows) &&
      identity(expanded.planSources) === identity(profile.pathInventory.planSources) &&
      identity(expanded.unavailablePlans) === identity(profile.pathInventory.unavailablePlans),
      'HOST_HANDOFF_RESTORED_PATH_BINDING_CHANGED');
    for (const row of profile.pathInventory.paths.filter(row => row.custody === 'captured' && row.exists)) {
      const actual = await observeRecoveryPath({ path: sourcePath(sourcePoint(profile.roots, row.path)), kind: row.kind });
      need(actual.exists && actual.actualKind === row.actualKind, 'HOST_HANDOFF_RESTORED_PATH_BINDING_CHANGED');
    }
    for (const row of profile.pathInventory.objectSources) {
      const directory = sourcePath(sourcePoint(profile.roots, row.directory));
      if (!row.prepared) {
        need(!await exists(join(directory, 'session.json')), 'HOST_HANDOFF_RESTORED_OBJECT_CHANGED'); continue;
      }
      const native = await readObjectRecoveryPlan(row.directory, { storageDirectory: directory });
      need(native.definition.sessionId === row.objectSession.sessionId &&
        native.definitionSha256 === row.objectSession.definitionSha256 &&
        native.configurationsSha256 === row.objectSession.configurationsSha256 &&
        identity(native.assemblies.map(({ destination, bytes, sha256, chunkManifestSha256 }) =>
          ({ destination, bytes, sha256, chunkManifestSha256 }))) === identity(row.assemblies),
      'HOST_HANDOFF_RESTORED_OBJECT_CHANGED');
    }
  }
  const legacyIncomplete = !profile.pathInventory && (configuration.host.profiles.some(row =>
    row.objectSessions.length || row.objectBundleArchives.length || row.casesDirectory || row.caseSourceDirectory) ||
    requests.some(({ request }) => request.review.command.startsWith('object-')));
  const expectedLeases = new Set([profile.workspace.directory]), external = new Set(profile.externalFiles.map(row => row.path));
  for (const row of configuration.host.profiles) {
    expectedLeases.add(row.operations);
    need(profile.passphraseEnvironments.includes(row.passEnv) &&
      (!row.storeConfig || external.has(row.storeConfig)), 'HOST_HANDOFF_RESTORED_PRIVATE_BINDING_CHANGED');
    for (const path of [row.operations, ...row.bundleRoots.map(root => root.directory), row.downloadRoot, row.restoreRoot])
      requireCovered(profile.roots, path, 'restored host profile');
    for (const target of row.fleetTargets) need(external.has(target.targetFile), 'HOST_HANDOFF_RESTORED_PRIVATE_BINDING_CHANGED');
  }
  need(identity([...expectedLeases].sort()) === identity(profile.leases), 'HOST_HANDOFF_RESTORED_LEASE_BINDING_CHANGED');
  const app = await inspectHostHandoffApplication({
    sourceDirectory: sourcePath(profile.application.source), manifestFile: sourcePath(profile.application.manifest)
  });
  need(app.manifestSha256 === profile.application.manifestSha256 &&
    app.sourceCommit === profile.application.sourceCommit && app.files === profile.application.files &&
    app.bytes === profile.application.bytes, 'HOST_HANDOFF_APPLICATION_IDENTITY_CHANGED');
  const sourceModes = new Map([[profile.application.manifestFile, 0o644]]);
  for (const path of Object.keys(app.manifest.packageFiles))
    sourceModes.set(join(profile.application.packageDirectory, path), 0o644);
  for (const row of app.manifest.files)
    sourceModes.set(join(profile.application.sourceDirectory, ...row.path.split('/')), row.mode === '100755' ? 0o755 : 0o644);
  return { ...auth, profile, planSha256, sourcePath, originalRestore, sourceModes, applicationManifest: app.manifest, legacyIncomplete };

}
export async function restoreHostHandoff(input = {}) {
  const ctx = await restoredContext(input, { restore: true });
  return { schema: HOST_HANDOFF_RESULT_SCHEMA, status: 'HOST_HANDOFF_RESTORED',
    operationId: ctx.profile.operationId, workspaceId: ctx.profile.workspace.workspaceId,
    bundleDirectory: input.bundleDirectory, restoreDirectory: input.restoreDirectory,
    manifestSha256: ctx.manifestSha256, planSha256: ctx.planSha256,
    originalRestore: ctx.originalRestore, verifiedExistingRestore: ctx.originalRestore === null,
    application: clone(ctx.profile.application), roots: clone(ctx.profile.roots) };
}

function adoptionControls(profile, input) {
  if (input.operationDirectory === undefined) {
    need(input.python === undefined, 'HOST_HANDOFF_ADOPTION_OPERATION_REQUIRED',
      'Select the original adoption operation directory when choosing its Python executable.');
    return null;
  }
  absolute(input.operationDirectory, 'private adoption operation');
  const python = input.python ?? '/usr/bin/python3';
  absolute(python, 'adoption publication Python');
  const reservedPaths = [...new Set([
    input.bundleDirectory, input.restoreDirectory, input.targetFile,
    ...profile.roots.map(row => row.path),
    ...profile.externalFiles.map(row => row.path),
    ...profile.absentOriginalInputs.map(row => row.path),
    ...(profile.pathInventory?.paths ?? []).filter(row => !row.exists).map(row => row.path)
  ])];
  for (const path of reservedPaths)
    need(!overlap(input.operationDirectory, path), 'HOST_HANDOFF_ADOPTION_CONTROL_OVERLAP',
      'Keep the receiving operation outside every original root, private file, absent input and receiving control.');
  return { directory: input.operationDirectory, python, reservedPaths };
}
function adoptionOptions(ctx, input, selected) {
  const controls = adoptionControls(ctx.profile, input);
  return controls ? { ...controls, binding: selected.review, roots: selected.review.roots,
    ...(input.signal ? { signal: input.signal } : {}) } : null;
}
function retainedAdoptionResult(value, selected) {
  need(value?.schema === HOST_HANDOFF_RESULT_SCHEMA && value.status === 'HOST_HANDOFF_ADOPTED' &&
    value.reviewSha256 === selected.reviewSha256 &&
    value.manifestSha256 === selected.review.manifestSha256 &&
    value.planSha256 === selected.review.planSha256 &&
    value.workspaceId === selected.review.workspaceId &&
    value.operationId === selected.review.operationId,
    'HOST_HANDOFF_ADOPTION_RESULT_CHANGED');
  return value;
}
/** Read only the original saved receiving operation; this does not reauthenticate its native bundle. */
export async function inspectHostHandoffAdoption({ operationDirectory, expectedReviewSha256, python } = {}) {
  absolute(operationDirectory, 'original adoption operation');
  need(HASH.test(expectedReviewSha256 ?? ''), 'HOST_HANDOFF_RECEIVING_REVIEW_REQUIRED');
  return readHostAdoption({ directory: operationDirectory, expectedReviewSha256, python });
}

async function targetContext(ctx, input) {
  need(!ctx.legacyIncomplete, 'HOST_HANDOFF_COMPLETE_PATH_REVIEW_REQUIRED',
    'The previous handoff remains restored; prepare a complete Object and Support path review before adoption.');
  await checkAbsentInputs(ctx.profile);
  absolute(input.targetFile, 'private receiving selection');
  const adoption = adoptionControls(ctx.profile, input);
  if (adoption) await realSource(dirname(adoption.directory), 'directory');
  const raw = await readPrivate(input.targetFile, MAX_PLAN), target = JSON.parse(raw.toString('utf8'));
  fields(target, ['schema', 'workspaceId', 'manifestSha256', 'mappings', 'externalFiles'], 'receiving target');
  need(target.schema === HOST_HANDOFF_TARGET_SCHEMA && target.workspaceId === ctx.profile.workspace.workspaceId &&
    target.manifestSha256 === ctx.manifestSha256 && Array.isArray(target.mappings) &&
    target.mappings.length === ctx.profile.roots.length && Array.isArray(target.externalFiles),
  'HOST_HANDOFF_TARGET_SELECTION_CHANGED');
  const roots = [], names = new Set(), availability = [];
  for (const row of target.mappings) {
    fields(row, ['name', 'path'], 'receiving mapping');
    const original = ctx.profile.roots.find(root => root.name === row.name);
    need(original && !names.has(row.name), 'HOST_HANDOFF_TARGET_MAPPING_INVALID');
    names.add(row.name); absolute(row.path, 'receiving root');
    need(row.path === original.path, 'HOST_HANDOFF_ORIGINAL_PATH_REQUIRED',
      'Original journals bind absolute paths. Select the captured path for ' + row.name +
      '; this version does not rewrite or rebind journals.');
    need(!overlap(row.path, input.restoreDirectory) && !overlap(row.path, input.bundleDirectory) &&
      !overlap(row.path, input.targetFile), 'HOST_HANDOFF_RECEIVING_CONTROL_OVERLAP');
    await realSource(dirname(row.path), 'directory');
    const root = { ...original, destination: row.path, restored: join(input.restoreDirectory, row.name) };
    if (await exists(row.path)) {
      await matchTree(row.path, rootEntries(ctx.manifest, row.name), ctx.sourceModes);
      availability.push({ name: row.name, path: row.path, status: 'EXACT_ORIGINAL_ALREADY_PRESENT' });
    } else availability.push({ name: row.name, path: row.path, status: 'NEW_CREATE_ONLY_ROOT' });
    roots.push(root);
  }
  for (const path of ctx.profile.leases) if (await exists(path)) {
    const lease = await inspectDeliveryLease(path);
    need(!lease.active, 'HOST_HANDOFF_RECEIVING_WRITER_ACTIVE', 'Keep the original receiving writer stopped: ' + path);
  }
  roots.sort((a, b) => a.name.localeCompare(b.name));
  const externalFiles = [];
  need(target.externalFiles.length === ctx.profile.externalFiles.length, 'HOST_HANDOFF_EXTERNAL_BINDINGS_REQUIRED');
  const externalNames = new Set();
  for (const row of target.externalFiles) {
    fields(row, ['path', 'expectedSha256'], 'receiving private binding');
    const original = ctx.profile.externalFiles.find(item => item.path === row.path);
    need(original && !externalNames.has(row.path) && HASH.test(row.expectedSha256 ?? ''),
      'HOST_HANDOFF_EXTERNAL_BINDINGS_REQUIRED');
    externalNames.add(row.path);
    await realSource(row.path, 'file');
    const selected = await readPrivate(row.path, 2 * 1024 * 1024);
    need(digest(selected) === row.expectedSha256, 'HOST_HANDOFF_RECEIVING_PRIVATE_FILE_CHANGED');
    externalFiles.push({ path: row.path, originalSha256: original.sha256,
      receivingSha256: row.expectedSha256, originalBytes: original.bytes, receivingBytes: selected.length,
      binding: original.sha256 === row.expectedSha256 ? 'ORIGINAL_BYTES' : 'EXPLICIT_RECEIVING_BYTES' });
  }
  externalFiles.sort((a, b) => a.path.localeCompare(b.path));
  const review = { schema: HOST_HANDOFF_TARGET_SCHEMA, operationId: ctx.profile.operationId,
    workspaceId: ctx.profile.workspace.workspaceId, createdAt: ctx.profile.workspace.createdAt,
    manifestSha256: ctx.manifestSha256, planSha256: ctx.planSha256,
    bundleDirectory: input.bundleDirectory, restoreDirectory: input.restoreDirectory,
    targetFile: input.targetFile, targetSha256: digest(raw),
    ...(adoption ? { adoption: { directory: adoption.directory, python: adoption.python } } : {}),
    originalWorkspaceDirectory: ctx.profile.workspace.directory, originalConfigFile: ctx.profile.workspace.configFile,
    application: clone(ctx.profile.application), roots, externalFiles,
    originalRecords: clone(ctx.profile.originalRecords), absentOriginalInputs: clone(ctx.profile.absentOriginalInputs),
    ...(ctx.profile.pathInventory ? { pathInventory: clone(ctx.profile.pathInventory) } : {}) };
  return { review, reviewSha256: identity(review), availability };
}
export async function inspectRestoredHostHandoff(input = {}) {
  const ctx = await restoredContext(input), selected = await targetContext(ctx, input);
  return { schema: HOST_HANDOFF_RESULT_SCHEMA, status: 'HOST_HANDOFF_REVIEW',
    ...selected, ...(input.operationDirectory ? { receivingOperation: await inspectHostAdoption(
      adoptionOptions(ctx, input, selected)) } : {}), passphraseEnvironments: ctx.profile.passphraseEnvironments.map(name => ({
      name, available: typeof process.env[name] === 'string' && process.env[name].length > 0
    })), runtimeStatus: 'SOURCE_AND_STATE_REVIEWED_NO_SERVICE_STARTED' };
}
export async function adoptRestoredHostHandoff(input = {}) {
  need(input.quiesced === true && HASH.test(input.expectedReviewSha256 ?? ''),
    'HOST_HANDOFF_RECEIVING_REVIEW_REQUIRED', 'Review the exact receiving map and keep the original and receiving writers stopped.');
  const ctx = await restoredContext(input), selected = await targetContext(ctx, input);
  need(selected.reviewSha256 === input.expectedReviewSha256, 'HOST_HANDOFF_RECEIVING_REVIEW_CHANGED');
  const operationOptions = adoptionOptions(ctx, input, selected);
  if (operationOptions) {
    need(input.signal === undefined || input.signal instanceof AbortSignal, 'HOST_HANDOFF_SIGNAL_INVALID');
    input.signal?.throwIfAborted();
    const operation = await openHostAdoption(operationOptions);
    try {
      const saved = await operation.readResult();
      if (saved) retainedAdoptionResult(saved, selected);
      for (const root of selected.review.roots) {
        input.signal?.throwIfAborted();
        const entries = rootEntries(ctx.manifest, root.name);
        if (await exists(root.destination)) {
          await matchTree(root.destination, entries, ctx.sourceModes);
          continue;
        }
        await operation.publishRoot(root, { entries });
        await matchTree(root.destination, entries, ctx.sourceModes);
      }
      // A prior rename may have completed before its parent fsync or receipt.
      // Flush exact existing roots as well as roots published in this call.
      for (const root of selected.review.roots)
        await syncAdoptedRoot(root, rootEntries(ctx.manifest, root.name), input.signal);
      input.signal?.throwIfAborted();
      const observed = await finishAdoption(ctx, selected, input);
      input.signal?.throwIfAborted();
      const retained = await operation.complete(saved ?? observed);
      retainedAdoptionResult(retained, selected);
      return { ...retained, reopened: Boolean(saved),
        receivingOperation: { directory: input.operationDirectory, reviewSha256: selected.reviewSha256,
          status: 'COMPLETE', currentOriginalStateVerified: true } };
    } finally { await operation.close(); }
  }
  // Existing root reuse is permitted only after the complete authenticated
  // inventory matches. Node's exclusive copy creates missing roots; a partial
  // target is retained and never treated as a resumable or completed journal.
  for (const root of selected.review.roots) {
    const entries = rootEntries(ctx.manifest, root.name);
    if (await exists(root.destination)) { await matchTree(root.destination, entries, ctx.sourceModes); continue; }
    await realSource(dirname(root.destination), 'directory');
    // mkdir is the atomic claim for a new directory root. Copying into an
    // already existing directory would merge before a later inventory check.
    if (root.kind === 'directory') {
      await mkdir(root.destination, { mode: 0o700 });
      const owner = await lstat(root.destination, { bigint: true });
      for (const entry of entries.filter(row => row.relative)) {
        const current = await lstat(root.destination, { bigint: true });
        need(current.isDirectory() && current.dev === owner.dev && current.ino === owner.ino &&
          await realpath(root.destination) === root.destination, 'HOST_HANDOFF_RECEIVING_ROOT_REPLACED');
        const destination = join(root.destination, ...entry.relative.split('/'));
        const source = join(root.restored, ...entry.relative.split('/'));
        await privateDirectory(dirname(destination));
        if (entry.kind === 'directory') await mkdir(destination, { mode: 0o700 });
        else {
          await copyFile(source, destination, constants.COPYFILE_EXCL);
          const handle = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
          try { await handle.sync(); } finally { await handle.close(); }
        }
      }
    } else {
      await copyFile(root.restored, root.destination, constants.COPYFILE_EXCL);
      const handle = await open(root.destination, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await handle.sync(); } finally { await handle.close(); }
    }
    await matchTree(root.destination, entries, ctx.sourceModes);
    // Each newly published directory owns child entries; flush children first.
    for (const row of entries.filter(row => row.kind === 'directory')
      .sort((a, b) => (b.relative ? b.relative.split('/').length : 0) - (a.relative ? a.relative.split('/').length : 0)))
      await syncDirectory(row.relative ? join(root.destination, ...row.relative.split('/')) : root.destination);
    await syncDirectory(dirname(root.destination));
  }
  return finishAdoption(ctx, selected, input);
}
async function syncAdoptedRoot(root, entries, signal) {
  for (const row of entries.filter(row => row.kind === 'file')) {
    signal?.throwIfAborted();
    const path = row.relative ? join(root.destination, ...row.relative.split('/')) : root.destination;
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      need(stat.isFile() && stat.nlink === 1 && stat.size === row.bytes,
        'HOST_HANDOFF_RECEIVING_FILE_CHANGED');
      await handle.sync();
    } finally { await handle.close(); }
  }
  for (const row of entries.filter(row => row.kind === 'directory')
    .sort((a, b) => (b.relative ? b.relative.split('/').length : 0) - (a.relative ? a.relative.split('/').length : 0))) {
    signal?.throwIfAborted();
    await syncDirectory(row.relative ? join(root.destination, ...row.relative.split('/')) : root.destination);
  }
  signal?.throwIfAborted();
  await syncDirectory(dirname(root.destination));
}
async function finishAdoption(ctx, selected, input) {
  // State stays private. Reapply the original package's declared file modes
  // behind private receiving directories so its original verifier still works.
  for (const [path, mode] of ctx.sourceModes) {
    input.signal?.throwIfAborted();
    await chmod(path, mode);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  await checkAbsentInputs(ctx.profile);
  for (const root of selected.review.roots)
    await matchTree(root.destination, rootEntries(ctx.manifest, root.name), ctx.sourceModes);
  const receivedIdentity = await readRecoveryWorkspaceIdentity({
    configFile: ctx.profile.workspace.configFile, directory: ctx.profile.workspace.directory
  });
  need(receivedIdentity.workspaceId === ctx.profile.workspace.workspaceId &&
    receivedIdentity.configurationSha256 === ctx.profile.workspace.configurationSha256 &&
    digest(await readPrivate(join(ctx.profile.workspace.directory, 'workspace.json'), 2 * 1024 * 1024)) ===
      ctx.profile.workspace.stateSha256, 'HOST_HANDOFF_RECEIVED_WORKSPACE_CHANGED');
  const workspace = await openRecoveryWorkspace({ configFile: ctx.profile.workspace.configFile,
    directory: ctx.profile.workspace.directory, readOnly: true });
  let state;
  try { state = await workspace.state(); }
  finally { await workspace.close(); }
  need(state.id === ctx.profile.workspace.workspaceId && state.createdAt === ctx.profile.workspace.createdAt &&
    state.active === null, 'HOST_HANDOFF_RECEIVED_WORKSPACE_CHANGED');
  need(digest(await readPrivate(input.targetFile, MAX_PLAN)) === selected.review.targetSha256,
    'HOST_HANDOFF_RECEIVING_TARGET_CHANGED');
  for (const row of selected.review.externalFiles) {
    await realSource(row.path, 'file');
    need(digest(await readPrivate(row.path, 2 * 1024 * 1024)) === row.receivingSha256,
      'HOST_HANDOFF_RECEIVING_PRIVATE_FILE_CHANGED');
  }
  await checkAbsentInputs(ctx.profile);
  return { schema: HOST_HANDOFF_RESULT_SCHEMA, status: 'HOST_HANDOFF_ADOPTED',
    operationId: ctx.profile.operationId, workspaceId: state.id, createdAt: state.createdAt,
    manifestSha256: ctx.manifestSha256, planSha256: ctx.planSha256,
    reviewSha256: selected.reviewSha256, configFile: ctx.profile.workspace.configFile,
    workspaceDirectory: ctx.profile.workspace.directory, sourceDirectory: ctx.profile.application.sourceDirectory,
    application: clone(ctx.profile.application), mappings: selected.review.roots.map(({ name, destination }) => ({
      name, path: destination
    })), originalRecords: clone(ctx.profile.originalRecords), externalFiles: selected.review.externalFiles,
    originalState: state, adoptedAt: stamp(), runtimeStatus: 'ADOPTED_READ_ONLY_NO_SERVICE_OR_REMOTE_OPERATION_STARTED' };
}
