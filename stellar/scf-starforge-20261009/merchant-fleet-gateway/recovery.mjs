// MIT. Complete deployed-fleet capture and receiving through the original SF101 engine.
import { constants } from 'node:fs';
import { lstat, readdir, realpath, open, mkdir, unlink, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { checkFleetBundle, prepareFleetDeployment, fleetDeploymentFiles } from './deploy.mjs';
import { readFleetReleasePlan } from './release-operator.mjs';
import { acquireStateLease } from './state-lease.mjs';
import { acquireReleaseLease } from '../sf82-seller-pilot/release-process.mjs';
import { readReleaseState } from '../sf82-seller-pilot/releases.mjs';
import { run as recover } from '../sf101-merchant-recovery/recover.mjs';
import { runLocalCapture, readCapturedBundle } from '../sf101-merchant-recovery/workspace/local.mjs';
import { absolute, privateDirectory, readPrivate, createFile, atomicJson, syncDirectory,
  acquireWorkspace, bytes, digest, identity, object, fault } from '../sf30-seller-sdk/postgres/publisher/files.mjs';

export const FLEET_RECOVERY_SCHEMA = 'stellar-forge.fleet-recovery-profile.v1';
export const FLEET_RECEIVING_SCHEMA = 'stellar-forge.fleet-recovery-receiving.v1';
const PLAN_SCHEMA = 'stellar-forge.merchant-recovery-plan.v1';
const BUNDLE_SCHEMA = 'stellar-forge.merchant-recovery.v1';
const CAPTURE_SCHEMA = 'stellar-forge.fleet-recovery-capture-operation.v1';
const TARGET_SCHEMA = 'stellar-forge.fleet-recovery-targets.v1';
const PLAN_ROOT = 'fleetRecoveryPlan';
const HOST_ROOT = 'fleetHostBundle';
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_PLAN = 256 * 1024;
const MAX_MANIFEST = 12 * 1024 ** 2;
const MAX_FILE = 2 * 1024 ** 3;
const MAX_TOTAL = 4 * 1024 ** 3;
const MAX_ENTRIES = 10000;
const stamp = () => new Date().toISOString();
const copy = value => structuredClone(value);
const inside = (a, b) => a === b || b.startsWith(a + '/');
const overlap = (a, b) => inside(a, b) || inside(b, a);
const need = (ok, code, message = code, status = 409) => { if (!ok) throw fault(code, message, status); };
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
function parse(raw, name) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('FLEET_RECOVERY_JSON_INVALID', 'Invalid ' + name + '.', 400); }
}
function fields(value, allowed, name) {
  need(object(value) && Object.keys(value).every(key => allowed.includes(key)),
    'FLEET_RECOVERY_INPUT_INVALID', 'Unknown or invalid ' + name + ' field.', 400);
}
function passEnv(name) {
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(name ?? ''),
    'FLEET_RECOVERY_PASSPHRASE_REQUIRED', 'Select the existing private passphrase environment variable name.', 400);
  return name;
}
function originalIdentity(deployment) {
  need(Number.isSafeInteger(deployment.serviceUid) && deployment.serviceUid > 0 &&
    Number.isSafeInteger(deployment.serviceGid) && deployment.serviceGid > 0,
    'FLEET_RECOVERY_SERVICE_IDENTITY_REQUIRED', 'The original positive numeric service UID and GID are required.');
  need(process.platform === 'linux' && typeof process.getuid === 'function',
    'FLEET_RECOVERY_LINUX_REQUIRED', 'Use the original Linux fleet host and util-linux flock.');
  need(process.getuid() === deployment.serviceUid && process.getgid() === deployment.serviceGid,
    'FLEET_RECOVERY_SERVICE_IDENTITY_REQUIRED',
    'Run this operation as the original service UID ' + deployment.serviceUid + ' and GID ' + deployment.serviceGid + '.');
}
async function regular(path, maximum = MAX_PLAN) {
  absolute(path, 'file');
  need(await realpath(path) === path, 'FLEET_RECOVERY_REAL_PATH_REQUIRED', 'Use the original path without symlink components.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && before.size <= maximum,
      'FLEET_RECOVERY_FILE_INVALID', 'Use an original bounded regular file with one link.');
    const value = await handle.readFile();
    const after = await handle.stat();
    need(value.length === before.size && value.length <= maximum && after.size === before.size &&
      after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
    'FLEET_RECOVERY_SOURCE_CHANGED', 'The selected file changed during the read.');
    return value;
  } finally { await handle.close(); }
}
async function fileHash(path, maximum = MAX_FILE) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && before.size <= maximum,
      'FLEET_RECOVERY_FILE_INVALID', 'The source must be a regular, single-link file within the SF101 limit.');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      need(size <= maximum, 'FLEET_RECOVERY_SOURCE_LIMIT');
      hash.update(chunk);
    }
    const after = await handle.stat();
    need(size === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs &&
      after.ctimeMs === before.ctimeMs, 'FLEET_RECOVERY_SOURCE_CHANGED');
    return { size, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
function treeDigest(entries) {
  const hash = createHash('sha256').update('stellar-forge.fleet-recovery-tree.v1\0');
  let files = 0, directories = 0, total = 0;
  for (const row of entries) {
    if (row.kind === 'directory') {
      directories++; hash.update(JSON.stringify([row.relative, 'directory']) + '\n');
    } else {
      files++; total += row.size;
      hash.update(JSON.stringify([row.relative, 'file', row.size, row.sha256]) + '\n');
    }
  }
  return { kind: entries[0]?.kind, sha256: hash.digest('hex'), files, directories, bytes: total };
}
async function scanRoot(path, kind, budget = { entries: 0, bytes: 0 }) {
  absolute(path, 'original root');
  need(await realpath(path) === path, 'FLEET_RECOVERY_REAL_PATH_REQUIRED');
  const entries = [];
  async function walk(current, relativePath, depth) {
    need(depth <= 16 && budget.entries < MAX_ENTRIES, 'FLEET_RECOVERY_ENTRY_LIMIT');
    const before = await lstat(current);
    need(!before.isSymbolicLink() && (before.isFile() || before.isDirectory()),
      'FLEET_RECOVERY_UNSUPPORTED_ENTRY', 'SF101 captures regular files and directories.');
    budget.entries++;
    if (before.isFile()) {
      const file = await fileHash(current);
      budget.bytes += file.size;
      need(budget.bytes <= MAX_TOTAL, 'FLEET_RECOVERY_SOURCE_LIMIT');
      entries.push({ relative: relativePath, kind: 'file', ...file });
    } else {
      entries.push({ relative: relativePath, kind: 'directory' });
      const children = (await readdir(current)).sort();
      for (const child of children) {
        need(child && child !== '.' && child !== '..' && !/[\\/\0]/.test(child),
          'FLEET_RECOVERY_PATH_INVALID');
        await walk(join(current, child), relativePath ? relativePath + '/' + child : child, depth + 1);
      }
      const after = await lstat(current);
      need(before.dev === after.dev && before.ino === after.ino && before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs, 'FLEET_RECOVERY_SOURCE_CHANGED');
    }
  }
  await walk(path, '', 0);
  const summary = treeDigest(entries);
  need(kind === undefined || kind === summary.kind, 'FLEET_RECOVERY_ROOT_CHANGED');
  return { ...summary, entries };
}
function compactTree(value) {
  const { entries, ...summary } = value;
  return summary;
}
function selectedRoots(deployment) {
  let roots = [...deployment.recoveryRoots, { name: HOST_ROOT, path: deployment.bundle }];
  // Every additional native read-only mount is a receiving input. Coalesce
  // nested selections while preserving its exact original absolute path.
  // Installed source and the separately provisioned environment remain outside.
  let ordinal = 0;
  for (const path of deployment.readOnlyRoots ?? []) {
    absolute(path, 'original read-only input');
    need(!deployment.environmentFile || !inside(path, deployment.environmentFile),
      'FLEET_RECOVERY_ENVIRONMENT_OVERLAP', 'Keep the original environment file separate from captured input roots.');
    if (roots.some(root => inside(root.path, path))) continue;
    roots = roots.filter(root => !inside(path, root.path));
    let name;
    do { name = 'fleetInput' + (++ordinal); } while (roots.some(root => root.name === name));
    roots.push({ name, path });
  }
  need(roots.length < 20 && roots.every(root => NAME.test(root.name ?? '') && root.name !== PLAN_ROOT && root.name !== 'fleetReceivingBundle') &&
    new Set(roots.map(root => root.name)).size === roots.length, 'FLEET_RECOVERY_ROOT_LIMIT',
    'The complete host, typed plan and declared sources must fit the original twenty-root limit.');
  for (let i = 0; i < roots.length; i++) {
    absolute(roots[i].path, 'original root');
    for (const other of roots.slice(i + 1))
      need(!overlap(roots[i].path, other.path), 'FLEET_RECOVERY_ROOT_OVERLAP');
  }
  return roots;
}
async function summarize(deployment, plan) {
  const merchants = [];
  for (const tenant of plan.tenants) {
    const slots = [];
    for (const [slot, spec] of Object.entries(tenant.slots)) {
      const state = await readReleaseState(spec.store);
      slots.push({ slot, port: spec.port, generation: state.generation,
        active: state.active, previous: state.previous, retainedChanges: state.history.length,
        stateSha256: digest(await regular(join(spec.store, 'state.json'), 4 * 1024 ** 2)) });
    }
    merchants.push({ id: tenant.id, host: tenant.host, startupSlot: tenant.startupSlot, slots });
  }
  const linksPath = join(deployment.releaseDirectory, 'links.json');
  let links = null, linksSha256 = null;
  if (await exists(linksPath)) {
    const raw = await regular(linksPath, 1024 * 1024);
    const saved = parse(raw, 'original fleet release links');
    need(saved.schema === 'stellar-forge.fleet-release-links.v1' && Array.isArray(saved.revisions),
      'FLEET_RECOVERY_LINKS_INVALID');
    linksSha256 = digest(raw);
    links = { revisions: saved.revisions.map(row => ({ revision: row.revision, digest: row.digest,
      snapshotId: row.snapshotId, mapping: copy(row.mapping) })),
      pending: saved.pending ? { phase: saved.pending.phase, baseRevision: saved.pending.baseRevision } : null };
  }
  return { fleet: deployment.fleet, planDigest: plan.digest,
    gateway: copy(plan.gateway), workspacePort: deployment.workspacePort,
    serviceUid: deployment.serviceUid, serviceGid: deployment.serviceGid,
    merchants, linksSha256, links };
}
async function inspectSource(deploymentBundle) {
  const checked = await checkFleetBundle(deploymentBundle);
  const { plan, ...deployment } = checked;
  const roots = selectedRoots(deployment), trees = {}, budget = { entries: 0, bytes: 0 };
  const summary = await summarize(deployment, plan);
  for (const root of roots) {
    const tree = await scanRoot(root.path, undefined, budget);
    root.kind = tree.kind; trees[root.name] = compactTree(tree);
  }
  const after = await checkFleetBundle(deploymentBundle);
  need(identity(after) === identity(checked) &&
    identity(await summarize(deployment, plan)) === identity(summary),
  'FLEET_RECOVERY_SOURCE_CHANGED', 'The original deployment or retained release selection changed during capture review.');
  return { schema: FLEET_RECOVERY_SCHEMA, deployment, roots, summary,
    source: { deploymentManifestSha256: digest(await regular(join(deploymentBundle, 'fleet-deployment.json'), 4 * 1024 ** 2)),
      trees, files: Object.values(trees).reduce((n, tree) => n + tree.files, 0),
      directories: Object.values(trees).reduce((n, tree) => n + tree.directories, 0), bytes: budget.bytes } };
}

/** Read complete selected source identities. This opens no merchant, provider or writer. */
export async function inspectFleetRecovery({ deploymentBundle } = {}) {
  absolute(deploymentBundle, 'original deployment bundle');
  return inspectSource(deploymentBundle);
}
async function withFleetLeases(deployment, plan, action) {
  originalIdentity(deployment);
  const leases = [];
  let value, failed;
  try {
    leases.push(await acquireStateLease(deployment.releaseDirectory));
    if (await exists(deployment.gatewayStateDirectory))
      leases.push(await acquireStateLease(deployment.gatewayStateDirectory));
    const stores = plan.tenants.flatMap(tenant => Object.values(tenant.slots).map(slot => slot.store)).sort();
    for (const store of stores) {
      for (const name of ['run.lock', 'state.lock']) {
        const lease = await acquireReleaseLease(store, name);
        need(lease, 'FLEET_RECOVERY_LINUX_REQUIRED'); leases.push(lease);
        need(!await exists(join(store, name)), 'FLEET_RECOVERY_SOURCE_OWNER_RETAINED',
          'Finish the original release owner shutdown before capturing ' + store + '.');
      }
    }
    for (const lease of leases) await (lease.assertHeld?.() ?? lease.assert?.());
    value = await action();
    for (const lease of leases) await (lease.assertHeld?.() ?? lease.assert?.());
  } catch (error) { failed = error; }
  const cleanup = [];
  for (const lease of leases.reverse()) try { await lease.close(); } catch (error) { cleanup.push(error); }
  if (failed) {
    if (cleanup.length) failed.cleanup = cleanup.map(error => ({ code: error.code, message: error.message }));
    throw failed;
  }
  if (cleanup.length) throw Object.assign(fault('FLEET_RECOVERY_SHUTDOWN_INCOMPLETE',
    'An original capture lease reported incomplete close.', 500), { cause: new AggregateError(cleanup) });
  return value;
}

/** The original plan includes its typed selection as an encrypted logical root. */
export async function prepareFleetRecoveryPlan({ deploymentBundle, planFile, quiesced = false } = {}) {
  absolute(deploymentBundle, 'original deployment bundle'); absolute(planFile, 'new recovery plan');
  need(quiesced === true, 'FLEET_RECOVERY_QUIESCENCE_REQUIRED',
    'Stop the fleet and its selected external writers, then keep them stopped through capture.', 400);
  await privateDirectory(dirname(planFile));
  const checked = await checkFleetBundle(deploymentBundle);
  return withFleetLeases(checked, checked.plan, async () => {
    const inspected = await inspectSource(deploymentBundle);
    need(!inspected.roots.some(root => overlap(root.path, planFile)),
      'FLEET_RECOVERY_PLAN_OVERLAP', 'Keep the typed plan outside its original captured roots.');
    const profile = { ...inspected, createdAt: stamp(), planFile };
    const plan = { schema: PLAN_SCHEMA,
      roots: [...profile.roots.map(({ name, path }) => ({ name, path })), { name: PLAN_ROOT, path: planFile }],
      merchantFleet: profile };
    const raw = bytes(plan);
    need(raw.length <= MAX_PLAN && inspected.source.bytes + raw.length <= MAX_TOTAL &&
      inspected.source.files + inspected.source.directories + 1 <= MAX_ENTRIES,
    'FLEET_RECOVERY_SOURCE_LIMIT', 'The complete original source and plan exceed SF101 limits.');
    await createFile(planFile, raw); await syncDirectory(dirname(planFile));
    return { status: 'FLEET_RECOVERY_PLAN_READY', planFile, sha256: digest(raw), plan,
      summary: profile.summary, source: profile.source };
  });
}
function typedPlan(raw) {
  need(raw.length > 0 && raw.length <= MAX_PLAN, 'FLEET_RECOVERY_PLAN_LIMIT');
  const plan = parse(raw, 'typed fleet recovery plan'), profile = plan?.merchantFleet;
  need(plan?.schema === PLAN_SCHEMA && profile?.schema === FLEET_RECOVERY_SCHEMA &&
    object(profile.deployment) && object(profile.source) && object(profile.source.trees) &&
    object(profile.summary) && Array.isArray(profile.roots),
  'FLEET_RECOVERY_PROFILE_REQUIRED', 'Select an original typed fleet snapshot.');
  const deployment = profile.deployment;
  need(deployment.schema === 'stellar-forge.fleet-host.v1' && HASH.test(deployment.planDigest ?? '') &&
    Array.isArray(deployment.recoveryRoots) && Array.isArray(deployment.sourceEntries) &&
    HASH.test(profile.source.deploymentManifestSha256 ?? ''),
  'FLEET_RECOVERY_PROFILE_CHANGED');
  absolute(profile.planFile, 'original typed plan');
  const roots = selectedRoots(deployment);
  need(identity(roots) === identity(profile.roots.map(({ name, path }) => ({ name, path }))) &&
    identity(plan.roots) === identity([...roots, { name: PLAN_ROOT, path: profile.planFile }]),
  'FLEET_RECOVERY_PROFILE_CHANGED', 'The original encrypted root mapping changed.');
  for (const root of profile.roots) {
    need(['file', 'directory'].includes(root.kind), 'FLEET_RECOVERY_PROFILE_CHANGED');
    const tree = profile.source.trees[root.name];
    need(tree?.kind === root.kind && HASH.test(tree.sha256 ?? '') &&
      ['files', 'directories', 'bytes'].every(key => Number.isSafeInteger(tree[key]) && tree[key] >= 0),
    'FLEET_RECOVERY_PROFILE_CHANGED', 'Each original source root needs its exact retained tree identity.');
  }
  need(Object.keys(profile.source.trees).length === profile.roots.length,
    'FLEET_RECOVERY_PROFILE_CHANGED');
  return { plan, profile, roots: [...profile.roots, { name: PLAN_ROOT, path: profile.planFile, kind: 'file' }] };
}
export async function inspectFleetRecoveryPlan(planFile) {
  absolute(planFile, 'original typed plan');
  const raw = await readPrivate(planFile, MAX_PLAN), { profile } = typedPlan(raw);
  need(profile.planFile === planFile, 'FLEET_RECOVERY_PLAN_MOVED');
  const current = await inspectSource(profile.deployment.bundle);
  need(identity(current) === identity({ schema: profile.schema, deployment: profile.deployment,
    roots: profile.roots, summary: profile.summary, source: profile.source }),
  'FLEET_RECOVERY_SOURCE_CHANGED', 'The fleet changed after this plan; prepare the current original source selection.');
  return { status: 'FLEET_RECOVERY_SOURCE_MATCHED', planFile, sha256: digest(raw),
    profile: copy(profile), summary: current.summary, source: current.source };
}
export async function withFleetRecoveryCapture({ planFile, expectedPlanSha256 } = {}, capture) {
  absolute(planFile, 'original typed plan');
  need(HASH.test(expectedPlanSha256 ?? '') && typeof capture === 'function',
    'FLEET_RECOVERY_CAPTURE_REVIEW_REQUIRED', 'Supply the exact reviewed plan and original capture callback.', 400);
  const raw = await readPrivate(planFile, MAX_PLAN), { profile } = typedPlan(raw);
  need(digest(raw) === expectedPlanSha256 && profile.planFile === planFile, 'FLEET_RECOVERY_PLAN_CHANGED');
  const checked = await checkFleetBundle(profile.deployment.bundle);
  return withFleetLeases(checked, checked.plan, async () => {
    const before = await inspectFleetRecoveryPlan(planFile);
    need(before.sha256 === expectedPlanSha256, 'FLEET_RECOVERY_PLAN_CHANGED');
    const result = await capture();
    const after = await inspectFleetRecoveryPlan(planFile);
    need(after.sha256 === expectedPlanSha256, 'FLEET_RECOVERY_PLAN_CHANGED');
    return result;
  });
}

/** Compare an already authenticated SF101 manifest with its encrypted original plan. */
export function inspectCapturedFleetManifest({ planBytes, manifest } = {}) {
  need(Buffer.isBuffer(planBytes) || planBytes instanceof Uint8Array, 'FLEET_RECOVERY_PLAN_BYTES_REQUIRED');
  const raw = Buffer.from(planBytes), { profile, roots } = typedPlan(raw), planSha256 = digest(raw);
  need(manifest?.schema === BUNDLE_SCHEMA && Array.isArray(manifest.roots) &&
    Array.isArray(manifest.entries) && manifest.entries.length <= MAX_ENTRIES &&
    identity(manifest.roots) === identity(roots.map(({ name, kind }) => ({ name, kind }))),
  'FLEET_RECOVERY_CAPTURE_ROOTS_CHANGED');
  const selected = manifest.entries.find(row => row.path === PLAN_ROOT);
  need(selected?.kind === 'file' && selected.size === raw.length && selected.sha256 === planSha256 &&
    manifest.capture?.schema === 'stellar-forge.merchant-recovery-capture.v1' &&
    HASH.test(manifest.capture.id ?? '') && manifest.capture.planSha256 === planSha256,
  'FLEET_RECOVERY_CAPTURE_CHANGED', 'The authenticated capture must bind this exact original plan.');
  for (const root of profile.roots) {
    const entries = manifest.entries.filter(row => row.path === root.name || row.path.startsWith(root.name + '/'))
      .map(row => ({ relative: row.path === root.name ? '' : row.path.slice(root.name.length + 1),
        kind: row.kind, ...(row.kind === 'file' ? { size: row.size, sha256: row.sha256 } : {}) }));
    need(entries.length > 0 && identity(treeDigest(entries)) === identity(profile.source.trees[root.name]),
      'FLEET_RECOVERY_CAPTURE_SOURCE_CHANGED', 'The captured ' + root.name + ' tree differs from its reviewed source.');
  }
  return { status: 'FLEET_RECOVERY_CAPTURE_MATCHED', captureId: manifest.capture.id,
    planSha256, profileSha256: identity(profile), fleet: profile.deployment.fleet,
    planDigest: profile.deployment.planDigest };
}

async function authenticated(bundleDirectory, passphraseEnv, expectedManifestSha256) {
  absolute(bundleDirectory, 'encrypted bundle'); passEnv(passphraseEnv);
  await privateDirectory(bundleDirectory);
  const raw = await readPrivate(join(bundleDirectory, 'manifest.json'), MAX_MANIFEST);
  const sha256 = digest(raw);
  if (expectedManifestSha256 !== undefined)
    need(HASH.test(expectedManifestSha256) && expectedManifestSha256 === sha256,
      'FLEET_RECOVERY_BUNDLE_CHANGED');
  const verification = await recover(['verify', '--bundle', bundleDirectory, '--pass-env', passphraseEnv]);
  need(verification.status === 'SNAPSHOT_VERIFIED' &&
    digest(await readPrivate(join(bundleDirectory, 'manifest.json'), MAX_MANIFEST)) === sha256,
  'FLEET_RECOVERY_BUNDLE_CHANGED', 'The original encrypted bundle changed during authentication.');
  return { manifest: parse(raw, 'authenticated manifest'), manifestSha256: sha256, verification };
}

/** Retain the original native local-capture operation, including its interrupted
 * attempts. The maintained local.mjs typed fleet entry owns capture and resume. */
export async function captureFleetRecovery({ planFile, bundleDirectory, operationDirectory,
  passphraseEnv, expectedPlanSha256, quiesced = false } = {}) {
  absolute(planFile, 'typed plan'); absolute(bundleDirectory, 'new encrypted bundle');
  absolute(operationDirectory, 'capture operation'); passEnv(passphraseEnv);
  need(HASH.test(expectedPlanSha256 ?? ''), 'FLEET_RECOVERY_PLAN_REVIEW_REQUIRED', undefined, 400);
  need(!overlap(operationDirectory, bundleDirectory) && !inside(operationDirectory, planFile),
    'FLEET_RECOVERY_OPERATION_OVERLAP');
  await privateDirectory(operationDirectory, true);
  const release = await acquireWorkspace(operationDirectory);
  try {
    const input = { planFile, bundleDirectory, operationDirectory, passphraseEnv, expectedPlanSha256 };
    const inputSha256 = identity(input), file = join(operationDirectory, 'capture.json');
    let state;
    if (await exists(file)) {
      state = parse(await readPrivate(file, 2 * 1024 ** 2), 'original capture operation');
      need(state.schema === CAPTURE_SCHEMA && state.inputSha256 === inputSha256 &&
        identity(state.input) === inputSha256 && typeof state.planBase64 === 'string',
      'FLEET_RECOVERY_OPERATION_CONFLICT', 'Keep the same original capture selection and operation directory.');
    } else {
      const raw = await readPrivate(planFile, MAX_PLAN), { profile } = typedPlan(raw);
      need(digest(raw) === expectedPlanSha256 &&
        !profile.roots.some(root => overlap(root.path, operationDirectory)),
      'FLEET_RECOVERY_OPERATION_OVERLAP');
      originalIdentity(profile.deployment);
      state = { schema: CAPTURE_SCHEMA, input, inputSha256, createdAt: stamp(),
        planBase64: raw.toString('base64'), native: {} };
      await createFile(file, bytes(state)); await syncDirectory(operationDirectory);
    }
    const raw = Buffer.from(state.planBase64, 'base64'), parsed = typedPlan(raw);
    need(raw.toString('base64') === state.planBase64 && digest(raw) === expectedPlanSha256,
      'FLEET_RECOVERY_PLAN_CHANGED');
    originalIdentity(parsed.profile.deployment);
    const save = async () => { state.updatedAt = stamp(); await atomicJson(operationDirectory, 'capture.json', state); };
    const options = { plan: planFile, out: bundleDirectory, passEnv: passphraseEnv,
      expectedPlanSha256, captureId: identity({ schema: CAPTURE_SCHEMA, inputSha256 }),
      captureKind: 'merchant-fleet' };
    // A complete native bundle is verified from retained bytes even after the
    // original merchant has legitimately resumed or moved.
    const found = await readCapturedBundle(options);
    need(found || quiesced === true, 'FLEET_RECOVERY_QUIESCENCE_REQUIRED',
      'Stop the selected source writers before continuing the original incomplete capture.', 400);
    try {
      const result = await runLocalCapture({ options, state: state.native, save,
        allowCapture: quiesced === true });
      const captured = await readCapturedBundle(options);
      need(result.verified && captured, 'FLEET_RECOVERY_CAPTURE_INCOMPLETE');
      const matched = inspectCapturedFleetManifest({ planBytes: raw, manifest: captured.manifest });
      state.result = { status: 'FLEET_CAPTURED', bundleDirectory, operationDirectory,
        snapshotId: captured.snapshotId, planSha256: expectedPlanSha256,
        profileSha256: matched.profileSha256, captureId: matched.captureId,
        summary: parsed.profile.summary, original: result };
      state.completedAt ??= stamp(); state.error = null; await save();
      return copy(state.result);
    } catch (error) {
      state.error = { code: error.code ?? 'FLEET_CAPTURE_FAILED', message: error.message, at: stamp() };
      await save(); throw error;
    }
  } finally { await release(); }
}

function manifestRootEntries(manifest, name) {
  return manifest.entries.filter(row => row.path === name || row.path.startsWith(name + '/'))
    .map(row => ({ relative: row.path === name ? '' : row.path.slice(name.length + 1),
      kind: row.kind, ...(row.kind === 'file' ? { size: row.size, sha256: row.sha256 } : {}) }));
}
async function verifyRestoredTrees(manifest, restoreDirectory) {
  const budget = { entries: 0, bytes: 0 };
  const actualNames = (await readdir(restoreDirectory)).sort();
  need(identity(actualNames) === identity(manifest.roots.map(row => row.name).sort()),
    'FLEET_RECOVERY_RESTORE_EXTRA_FILES', 'Keep this original restore separate from operation journals and generated output.');
  for (const root of manifest.roots) {
    const observed = await scanRoot(join(restoreDirectory, root.name), root.kind, budget);
    need(identity(compactTree(observed)) === identity(treeDigest(manifestRootEntries(manifest, root.name))),
      'FLEET_RECOVERY_RESTORED_SOURCE_CHANGED', 'The restored ' + root.name + ' differs from the authenticated original.');
  }
}
async function restoredContext({ bundleDirectory, restoreDirectory, passphraseEnv,
  expectedManifestSha256 } = {}) {
  absolute(bundleDirectory, 'encrypted bundle'); absolute(restoreDirectory, 'completed native restore');
  need(!overlap(bundleDirectory, restoreDirectory), 'FLEET_RECOVERY_RESTORE_OVERLAP');
  const auth = await authenticated(bundleDirectory, passphraseEnv, expectedManifestSha256);
  await privateDirectory(restoreDirectory);
  const raw = await readPrivate(join(restoreDirectory, PLAN_ROOT), MAX_PLAN);
  const matched = inspectCapturedFleetManifest({ planBytes: raw, manifest: auth.manifest });
  const { plan, profile, roots } = typedPlan(raw);
  await verifyRestoredTrees(auth.manifest, restoreDirectory);
  return { ...auth, bundleDirectory, restoreDirectory, passphraseEnv, plan, profile, roots,
    planBytes: raw, planSha256: matched.planSha256, profileSha256: matched.profileSha256 };
}

/** Restore through SF101, or verify the exact completed original restore.
 * Incomplete or foreign destinations are preserved for the original owner. */
export async function restoreFleetRecovery({ bundleDirectory, restoreDirectory, passphraseEnv,
  expectedManifestSha256 } = {}) {
  absolute(bundleDirectory, 'encrypted bundle'); absolute(restoreDirectory, 'new native restore');
  passEnv(passphraseEnv); await privateDirectory(dirname(restoreDirectory));
  const auth = await authenticated(bundleDirectory, passphraseEnv, expectedManifestSha256);
  let native = null, reused = false;
  if (await exists(restoreDirectory)) reused = true;
  else native = await recover(['restore', '--bundle', bundleDirectory, '--out', restoreDirectory, '--pass-env', passphraseEnv]);
  const ctx = await restoredContext({ bundleDirectory, restoreDirectory, passphraseEnv,
    expectedManifestSha256: auth.manifestSha256 });
  return { status: 'FLEET_RESTORED', bundleDirectory, restoreDirectory, reused,
    snapshotId: ctx.manifestSha256, planSha256: ctx.planSha256, profileSha256: ctx.profileSha256,
    summary: copy(ctx.profile.summary), original: { restore: native, verification: ctx.verification } };
}

async function targetSelection(ctx, targetFile, operationDirectory) {
  absolute(targetFile, 'private target declaration'); absolute(operationDirectory, 'receiving operation');
  const raw = await readPrivate(targetFile, MAX_PLAN), selected = parse(raw, 'receiving target declaration');
  fields(selected, ['schema', 'sourcePlanSha256', 'destinationParents', 'deploymentBundle'], 'target declaration');
  need(selected.schema === TARGET_SCHEMA && selected.sourcePlanSha256 === ctx.planSha256 &&
    Array.isArray(selected.destinationParents) && selected.destinationParents.length > 0 &&
    selected.destinationParents.length <= 20 && new Set(selected.destinationParents).size === selected.destinationParents.length,
  'FLEET_RECOVERY_TARGETS_REQUIRED', 'Select the original plan and receiving parents explicitly.', 400);
  for (const parent of selected.destinationParents) {
    absolute(parent, 'receiving parent');
    await privateDirectory(parent);
    const info = await lstat(parent);
    need(info.uid === ctx.profile.deployment.serviceUid && info.gid === ctx.profile.deployment.serviceGid,
      'FLEET_RECOVERY_SERVICE_IDENTITY_REQUIRED', 'Receiving parents must belong to the original numeric service account.');
    for (const other of selected.destinationParents)
      need(parent === other || !overlap(parent, other), 'FLEET_RECOVERY_PARENT_OVERLAP');
  }
  const roots = ctx.profile.roots.map(root => ({ ...root,
    restored: join(ctx.restoreDirectory, root.name), destination: root.path,
    source: copy(ctx.profile.source.trees[root.name]) }));
  const newBundle = absolute(selected.deploymentBundle, 'new generated deployment bundle');
  const paths = [...roots.map(row => row.destination), newBundle];
  for (const path of paths) {
    need(selected.destinationParents.some(parent => path !== parent && inside(parent, path)),
      'FLEET_RECOVERY_TARGET_OUTSIDE_SELECTION', 'Every destination must be inside an explicitly selected private receiving parent.');
    need(!overlap(path, ctx.restoreDirectory) && !overlap(path, ctx.bundleDirectory) &&
      !overlap(path, operationDirectory) && !overlap(path, ctx.profile.deployment.sourceRoot) &&
      !inside(path, targetFile) &&
      (!ctx.profile.deployment.environmentFile || !overlap(path, ctx.profile.deployment.environmentFile)),
    'FLEET_RECOVERY_TARGET_OVERLAP', 'Keep original source, secrets, restore, operation and receiving targets separate.');
  }
  need(!roots.some(root => overlap(root.destination, newBundle)), 'FLEET_RECOVERY_TARGET_OVERLAP',
    'Generate the receiving host bundle in a new directory outside all restored roots.');
  need(!overlap(operationDirectory, ctx.restoreDirectory) && !overlap(operationDirectory, ctx.bundleDirectory) &&
    !inside(operationDirectory, targetFile), 'FLEET_RECOVERY_OPERATION_OVERLAP');
  const review = { schema: FLEET_RECEIVING_SCHEMA, snapshotId: ctx.manifestSha256,
    sourcePlanSha256: ctx.planSha256, profileSha256: ctx.profileSha256,
    targetFile, targetSha256: digest(raw), operationDirectory,
    bundleDirectory: ctx.bundleDirectory, restoreDirectory: ctx.restoreDirectory,
    sourceRoot: ctx.profile.deployment.sourceRoot,
    destinationParents: [...selected.destinationParents], deploymentBundle: newBundle,
    serviceUid: ctx.profile.deployment.serviceUid, serviceGid: ctx.profile.deployment.serviceGid,
    roots };
  return { selected, review, reviewSha256: identity(review), targetRaw: raw };
}
async function receivingOperation(operationDirectory) {
  if (!await exists(operationDirectory)) return null;
  await privateDirectory(operationDirectory);
  const file = join(operationDirectory, 'receiving.json');
  if (!await exists(file)) return null;
  return parse(await readPrivate(file, 4 * 1024 ** 2), 'retained receiving operation');
}
function validateOperation(operation, selection) {
  if (!operation) return;
  need(operation.schema === FLEET_RECEIVING_SCHEMA && operation.reviewSha256 === selection.reviewSha256 &&
    identity(operation.review) === selection.reviewSha256 &&
    operation.operationId === identity({ purpose: 'receive-original-fleet', reviewSha256: selection.reviewSha256 }) &&
    object(operation.roots), 'FLEET_RECOVERY_OPERATION_CONFLICT',
  'Retain the original snapshot, target declaration and receiving operation.');
}
export async function inspectRestoredFleet(input = {}) {
  const ctx = await restoredContext(input);
  if (!input.targetFile)
    return { status: 'FLEET_RESTORE_INSPECTED', snapshotId: ctx.manifestSha256,
      sourcePlanSha256: ctx.planSha256, profileSha256: ctx.profileSha256,
      source: copy(ctx.profile.source), summary: copy(ctx.profile.summary),
      originalDeployment: copy(ctx.profile.deployment),
      targets: ctx.profile.roots.map(root => ({ name: root.name, path: root.path, kind: root.kind,
        source: copy(ctx.profile.source.trees[root.name]) })) };
  const selection = await targetSelection(ctx, input.targetFile, input.operationDirectory);
  const operation = await receivingOperation(input.operationDirectory);
  validateOperation(operation, selection);
  const availability = [];
  for (const root of selection.review.roots)
    availability.push({ name: root.name, destination: root.destination,
      state: operation?.roots[root.name]?.phase ?? (await exists(root.destination) ? 'EXISTING_TARGET' : 'ABSENT') });
  return { status: operation?.result ? 'FLEET_RECEIVING_COMPLETE' : 'FLEET_RECEIVING_REVIEW',
    review: selection.review, reviewSha256: selection.reviewSha256,
    summary: copy(ctx.profile.summary), availability,
    operation: operation ? { operationId: operation.operationId, phase: operation.phase,
      error: operation.error ?? null, result: copy(operation.result ?? null) } : null };
}

function inode(stat) { return { device: String(stat.dev), inode: String(stat.ino) }; }
function sameInode(a, b) { return a?.device === b?.device && a?.inode === b?.inode; }
async function ownedDirectory(path, deployment) {
  await privateDirectory(path);
  const info = await lstat(path, { bigint: true });
  need(info.uid === BigInt(deployment.serviceUid) && info.gid === BigInt(deployment.serviceGid),
    'FLEET_RECOVERY_SERVICE_IDENTITY_REQUIRED', 'The receiving directory belongs to a different service account.');
  return inode(info);
}
async function ensureReceivingParents(path, parents, deployment) {
  const anchor = parents.find(parent => path !== parent && inside(parent, path));
  need(anchor, 'FLEET_RECOVERY_TARGET_OUTSIDE_SELECTION');
  await ownedDirectory(anchor, deployment);
  const pieces = relative(anchor, dirname(path)).split('/').filter(Boolean);
  let current = anchor;
  for (const piece of pieces) {
    current = join(current, piece);
    try { await mkdir(current, { mode: 0o700 }); await syncDirectory(dirname(current)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await ownedDirectory(current, deployment);
  }
}
async function assertRootOwner(root, progress, deployment) {
  if (root.kind !== 'directory' || !progress.owner) return;
  need(sameInode(await ownedDirectory(root.destination, deployment), progress.owner),
    'FLEET_RECOVERY_TARGET_REPLACED', 'The original receiving root was replaced; preserve this operation and its files.');
}
function transferTemporary(destination, operationId) {
  return join(dirname(destination), '.fleet-receive-' + operationId.slice(0, 24) + '-' + digest(destination).slice(0, 24));
}
async function transferFile(source, destination, entry, operationId, deployment) {
  const temporary = transferTemporary(destination, operationId);
  // The operation is saved before this deterministic, private partial file can
  // be created. A retry compares every retained byte with the original before
  // appending. Publication is a create-only hard link, never an overwrite.
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output;
  try {
    const initial = await sourceHandle.stat({ bigint: true });
    need(initial.isFile() && initial.nlink === 1n && initial.size === BigInt(entry.size),
      'FLEET_RECOVERY_RESTORED_SOURCE_CHANGED');
    if (await exists(destination)) {
      const target = await lstat(destination, { bigint: true });
      if (await exists(temporary)) {
        const pending = await lstat(temporary, { bigint: true });
        if (target.isFile() && pending.isFile() && sameInode(inode(target), inode(pending)) &&
            target.nlink === 2n && target.uid === BigInt(deployment.serviceUid) &&
            target.gid === BigInt(deployment.serviceGid) && (target.mode & 0o077n) === 0n) {
          // The prior invocation published successfully and ended before the
          // temporary name was removed. Compare the inode's bytes first.
          const check = await open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const hash = createHash('sha256'); let count = 0;
            for await (const chunk of check.createReadStream({ autoClose: false })) { hash.update(chunk); count += chunk.length; }
            need(count === entry.size && hash.digest('hex') === entry.sha256 &&
              sameInode(inode(await check.stat({ bigint: true })), inode(await lstat(temporary, { bigint: true }))),
            'FLEET_RECOVERY_TARGET_CONFLICT');
          } finally { await check.close(); }
          await unlink(temporary); await syncDirectory(dirname(temporary));
        }
      }
      const found = await fileHash(destination);
      const targetNow = await lstat(destination);
      need(found.size === entry.size && found.sha256 === entry.sha256 &&
        targetNow.uid === deployment.serviceUid && targetNow.gid === deployment.serviceGid &&
        !(targetNow.mode & 0o077), 'FLEET_RECOVERY_TARGET_CONFLICT',
      'An existing receiving file differs from the original; it has been preserved.');
      need(!await exists(temporary), 'FLEET_RECOVERY_TRANSFER_CONFLICT',
        'A separate partial transfer is present beside the completed file; preserve it for the original operation.');
      return;
    }
    output = await open(temporary, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const pending = await output.stat({ bigint: true });
    need(pending.isFile() && pending.nlink === 1n && pending.size <= BigInt(entry.size) &&
      pending.uid === BigInt(deployment.serviceUid) && pending.gid === BigInt(deployment.serviceGid) &&
      (pending.mode & 0o077n) === 0n, 'FLEET_RECOVERY_TRANSFER_CONFLICT');
    const retained = Number(pending.size), buffer = Buffer.alloc(128 * 1024), compare = Buffer.alloc(128 * 1024);
    const hash = createHash('sha256'); let offset = 0;
    while (offset < entry.size) {
      const requested = Math.min(buffer.length, entry.size - offset);
      const { bytesRead } = await sourceHandle.read(buffer, 0, requested, offset);
      need(bytesRead > 0, 'FLEET_RECOVERY_RESTORED_SOURCE_CHANGED');
      const part = buffer.subarray(0, bytesRead); hash.update(part);
      const compareBytes = Math.max(0, Math.min(bytesRead, retained - offset));
      if (compareBytes) {
        let done = 0;
        while (done < compareBytes) {
          const read = await output.read(compare, done, compareBytes - done, offset + done);
          need(read.bytesRead > 0, 'FLEET_RECOVERY_TRANSFER_CONFLICT'); done += read.bytesRead;
        }
        need(part.subarray(0, compareBytes).equals(compare.subarray(0, compareBytes)),
          'FLEET_RECOVERY_TRANSFER_CONFLICT', 'The retained partial transfer differs from the original.');
      }
      let written = compareBytes;
      while (written < bytesRead) {
        const result = await output.write(part, written, bytesRead - written, offset + written);
        need(result.bytesWritten > 0, 'FLEET_RECOVERY_TRANSFER_FAILED'); written += result.bytesWritten;
      }
      offset += bytesRead;
    }
    const finalSource = await sourceHandle.stat({ bigint: true });
    need(hash.digest('hex') === entry.sha256 && finalSource.size === initial.size &&
      finalSource.mtimeNs === initial.mtimeNs && finalSource.ctimeNs === initial.ctimeNs &&
      sameInode(inode(initial), inode(await lstat(source, { bigint: true }))),
    'FLEET_RECOVERY_RESTORED_SOURCE_CHANGED');
    await output.sync();
    const finalOutput = await output.stat({ bigint: true });
    need(finalOutput.nlink === 1n && finalOutput.size === BigInt(entry.size) &&
      sameInode(inode(finalOutput), inode(await lstat(temporary, { bigint: true }))),
    'FLEET_RECOVERY_TRANSFER_CONFLICT');
    await link(temporary, destination); await syncDirectory(dirname(destination));
    need(sameInode(inode(finalOutput), inode(await lstat(temporary, { bigint: true }))) &&
      sameInode(inode(finalOutput), inode(await lstat(destination, { bigint: true }))),
    'FLEET_RECOVERY_TARGET_REPLACED');
    await unlink(temporary); await syncDirectory(dirname(temporary));
  } finally {
    await output?.close(); await sourceHandle.close();
  }
}
async function placeRoot(ctx, root, operation, save, entries = manifestRootEntries(ctx.manifest, root.name)) {
  const deployment = ctx.profile.deployment;
  const progress = operation.roots[root.name];
  await ensureReceivingParents(root.destination, operation.review.destinationParents, deployment);
  if (root.kind === 'directory') {
    if (!progress.owner) {
      try { await mkdir(root.destination, { mode: 0o700 }); await syncDirectory(dirname(root.destination)); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // A directory creation may succeed just before the owning process
        // ends. Only an empty private directory can complete that original
        // write-ahead creation; an unrelated populated root is never adopted.
        await ownedDirectory(root.destination, deployment);
        need((await readdir(root.destination)).length === 0, 'FLEET_RECOVERY_ROOT_OWNER_UNPROVEN',
          'This root contains files but has no retained receiving owner. Preserve it and the original operation.');
      }
      progress.owner = await ownedDirectory(root.destination, deployment);
      progress.phase = 'COPYING'; await save();
    }
    await assertRootOwner(root, progress, deployment);
  }
  const names = new Set(entries.map(row => join(root.destination, row.relative)));
  for (const entry of entries) {
    const destination = join(root.destination, entry.relative), source = join(root.restored, entry.relative);
    need(!names.has(transferTemporary(destination, operation.operationId)),
      'FLEET_RECOVERY_TRANSFER_NAME_COLLISION', 'An original filename conflicts with the private transfer namespace.');
    if (entry.kind === 'directory') {
      if (entry.relative) {
        try { await mkdir(destination, { mode: 0o700 }); await syncDirectory(dirname(destination)); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      await ownedDirectory(destination, deployment);
    } else await transferFile(source, destination, entry, operation.operationId, deployment);
  }
  await assertRootOwner(root, progress, deployment);
  const observed = await scanRoot(root.destination, root.kind);
  need(identity(compactTree(observed)) === identity(root.source), 'FLEET_RECOVERY_TARGET_CHANGED',
    'The complete receiving root differs from its authenticated original; all files remain available.');
  progress.phase = 'PLACED'; progress.source = compactTree(observed); progress.placedAt ??= stamp();
  await save();
}
async function generatedInputs(directory, rendered, deployment) {
  await privateDirectory(directory, true); await ownedDirectory(directory, deployment);
  const names = Object.keys(rendered);
  need((await readdir(directory)).every(name => names.includes(name)), 'FLEET_RECOVERY_GENERATION_CONFLICT');
  const entries = [{ relative: '', kind: 'directory' }];
  for (const name of names.sort()) {
    need(/^[A-Za-z0-9_.-]+$/.test(name), 'FLEET_RECOVERY_GENERATION_CONFLICT');
    const raw = Buffer.from(rendered[name]), path = join(directory, name);
    const fd = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const info = await fd.stat();
      need(info.isFile() && info.nlink === 1 && !(info.mode & 0o077) && info.size <= raw.length &&
        info.uid === deployment.serviceUid && info.gid === deployment.serviceGid,
      'FLEET_RECOVERY_GENERATION_CONFLICT');
      const retained = await fd.readFile();
      need(retained.length === info.size && retained.equals(raw.subarray(0, info.size)),
        'FLEET_RECOVERY_GENERATION_CONFLICT', 'The retained native-rendered file differs from this original bundle.');
      let offset = info.size;
      while (offset < raw.length) {
        const result = await fd.write(raw, offset, raw.length - offset, offset);
        need(result.bytesWritten > 0, 'FLEET_RECOVERY_TRANSFER_FAILED'); offset += result.bytesWritten;
      }
      await fd.sync();
    } finally { await fd.close(); }
    entries.push({ relative: name, kind: 'file', size: raw.length, sha256: digest(raw) });
  }
  await syncDirectory(directory); return entries;
}
function originalDeployment(checked) {
  const { plan, ...deployment } = checked;
  return deployment;
}
function receivedBundleMatches(checked, expected) {
  const saved = originalDeployment(checked), source = copy(expected);
  // Only the new output directory and its generated artifact hashes can
  // differ. Native generation revalidates the declaration, all original
  // absolute paths, source entries, services and plan digest.
  delete saved.bundle; delete saved.artifacts;
  delete source.bundle; delete source.artifacts;
  need(identity(saved) === identity(source), 'FLEET_RECOVERY_GENERATED_BUNDLE_CHANGED',
    'The receiving host bundle does not match the original deployment selection.');
}
export async function prepareRestoredFleet(input = {}) {
  need(input.quiesced === true, 'FLEET_RECOVERY_QUIESCENCE_REQUIRED',
    'Keep the receiving fleet and all selected source writers stopped until receiving completes.', 400);
  need(HASH.test(input.expectedReviewSha256 ?? ''), 'FLEET_RECOVERY_RECEIVING_REVIEW_REQUIRED',
    'Use the complete review hash returned by inspect-restore.', 400);
  const ctx = await restoredContext(input);
  originalIdentity(ctx.profile.deployment);
  const selection = await targetSelection(ctx, input.targetFile, input.operationDirectory);
  need(selection.reviewSha256 === input.expectedReviewSha256, 'FLEET_RECOVERY_RECEIVING_REVIEW_CHANGED');
  await privateDirectory(input.operationDirectory, true);
  const release = await acquireWorkspace(input.operationDirectory);
  try {
    let operation = await receivingOperation(input.operationDirectory);
    validateOperation(operation, selection);
    if (operation?.result) return copy(operation.result);
    if (!operation) {
      // Validate the entire destination set before the first target write.
      for (const root of selection.review.roots)
        need(!await exists(root.destination), 'FLEET_RECOVERY_TARGET_EXISTS',
          'Receiving creates the original path ' + root.destination + ' without replacing an existing root.');
      need(!await exists(selection.review.deploymentBundle), 'FLEET_RECOVERY_BUNDLE_EXISTS');
      operation = { schema: FLEET_RECEIVING_SCHEMA,
        operationId: identity({ purpose: 'receive-original-fleet', reviewSha256: selection.reviewSha256 }),
        review: copy(selection.review), reviewSha256: selection.reviewSha256,
        createdAt: stamp(), phase: 'PLACING', roots: {} };
      for (const root of selection.review.roots)
        operation.roots[root.name] = { phase: 'CREATING', destination: root.destination };
      await createFile(join(input.operationDirectory, 'receiving.json'), bytes(operation));
      await syncDirectory(input.operationDirectory);
    }
    const save = async () => {
      operation.updatedAt = stamp(); await atomicJson(input.operationDirectory, 'receiving.json', operation);
    };
    try {
      for (const root of selection.review.roots) await placeRoot(ctx, root, operation, save);
      const deployment = ctx.profile.deployment;
      const plan = await readFleetReleasePlan(deployment.planFile);
      need(plan.digest === deployment.planDigest, 'FLEET_RECOVERY_NATIVE_PLAN_CHANGED');
      return await withFleetLeases(deployment, plan, async () => {
        const original = await checkFleetBundle(deployment.bundle);
        need(identity(originalDeployment(original)) === identity(deployment),
          'FLEET_RECOVERY_ORIGINAL_DEPLOYMENT_CHANGED');
        // Leasing is observational for this already captured set: all native
        // permanent lock files were included in the original stopped capture.
        for (const root of selection.review.roots)
          need(identity(compactTree(await scanRoot(root.destination, root.kind))) === identity(root.source),
            'FLEET_RECOVERY_TARGET_CHANGED');
        const output = selection.review.deploymentBundle;
        if (operation.phase !== 'GENERATING') {
          need(!await exists(output), 'FLEET_RECOVERY_BUNDLE_EXISTS');
          operation.phase = 'GENERATING'; await save();
        }
        await ensureReceivingParents(output, selection.review.destinationParents, deployment);
        const prepared = await prepareFleetDeployment(deployment.deploymentFile, { sourceRoot: deployment.sourceRoot });
        const { files, manifest } = fleetDeploymentFiles(prepared, output);
        const rendered = Object.fromEntries(files);
        rendered['fleet-deployment.json'] = JSON.stringify(manifest, null, 2) + '\n';
        const renderedSha256 = identity(rendered);
        if (!operation.generated) {
          operation.generated = { renderedSha256, directory: join(input.operationDirectory, 'generated-artifacts') };
          operation.roots.fleetReceivingBundle = { phase: 'CREATING', destination: output };
          await save();
        }
        need(operation.generated.renderedSha256 === renderedSha256 &&
          operation.generated.directory === join(input.operationDirectory, 'generated-artifacts'),
        'FLEET_RECOVERY_GENERATION_CHANGED');
        const generatedEntries = await generatedInputs(operation.generated.directory, rendered, deployment);
        const generatedRoot = { name: 'fleetReceivingBundle', kind: 'directory', destination: output,
          restored: operation.generated.directory, source: treeDigest(generatedEntries) };
        await placeRoot(ctx, generatedRoot, operation, save, generatedEntries);
        const generated = await checkFleetBundle(output);
        receivedBundleMatches(generated, deployment);
        operation.result = { status: 'FLEET_RECEIVING_COMPLETE', operationId: operation.operationId,
          snapshotId: ctx.manifestSha256, sourcePlanSha256: ctx.planSha256,
          profileSha256: ctx.profileSha256, reviewSha256: selection.reviewSha256,
          fleet: deployment.fleet, planDigest: deployment.planDigest,
          serviceUid: deployment.serviceUid, serviceGid: deployment.serviceGid,
          originalDeploymentBundle: deployment.bundle, deploymentBundle: output,
          operationDirectory: input.operationDirectory, completedAt: stamp(),
          roots: selection.review.roots.map(root => ({ name: root.name, path: root.destination,
            kind: root.kind, source: copy(root.source) })),
          summary: copy(ctx.profile.summary),
          runtime: { unit: generated.unit, workspacePort: generated.workspacePort,
            node: generated.node, sourceRoot: generated.sourceRoot } };
        operation.phase = 'COMPLETE'; operation.error = null; await save();
        return copy(operation.result);
      });
    } catch (error) {
      operation.error = { code: error.code ?? 'FLEET_RECEIVING_FAILED', message: error.message, at: stamp() };
      await save(); throw error;
    }
  } finally { await release(); }
}
