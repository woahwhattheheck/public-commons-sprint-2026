// MIT. Typed paid-job recovery through the original encrypted SF101 engine.
import { constants } from 'node:fs';
import { open, lstat, realpath, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { run as recover } from './recover.mjs';
import { canonical, compileJobMerchant, JOB_ID } from '../sf30-seller-sdk/jobs/config.mjs';
import { readJobMerchantSource, adoptRestoredJobSource } from '../sf30-seller-sdk/jobs/source-binding.mjs';
import { inspectJobRecoveryState, acquireJobRecoveryLeases } from '../sf30-seller-sdk/jobs/recovery-state.mjs';
import { validateManifest, validateAcknowledgment, merchantIdentity } from '../sf30-seller-sdk/jobs/result-delivery/wire.mjs';
import { readDeliveryConfig } from '../sf30-seller-sdk/jobs/result-delivery/config.mjs';
import { absolute, privateDirectory, readPrivate, createFile, atomicJson, syncDirectory,
  acquireWorkspace, bytes, digest, identity, object, fault } from '../sf30-seller-sdk/postgres/publisher/files.mjs';

export const PAID_JOB_RECOVERY_SCHEMA = 'stellar-forge.paid-job-recovery-profile.v1';
export const PAID_JOB_PREPARATION_SCHEMA = 'stellar-forge.paid-job-recovery-operation.v1';
const PLAN_SCHEMA = 'stellar-forge.merchant-recovery-plan.v1';
const BUNDLE_SCHEMA = 'stellar-forge.merchant-recovery.v1';
const PLAN_ROOT = 'paidJobRecoveryPlan';
const OPERATION_ROOT = 'paid-job-recovery';
const HASH = /^[a-f0-9]{64}$/;
const ROOT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,57}$/;
const JOB_STATES = new Set(['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING',
  'CANCELLING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
const DELIVERY_STATES = new Set(['QUEUED', 'SENDING', 'RETRY', 'DELIVERED', 'EXHAUSTED']);
const PLAN_LIMIT = 256 * 1024, MAX_MANIFEST = 12 * 1024 ** 2;
const MAX_ENTRIES = 10000, MAX_TOTAL = 4 * 1024 ** 3, MAX_FILE = 2 * 1024 ** 3;
const stamp = () => new Date().toISOString();
const copy = value => structuredClone(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const inside = (parent, child) => parent === child || child.startsWith(parent + '/');
const same = (a, b) => canonical(a) === canonical(b);
const need = (condition, code, message, status = 409) => {
  if (!condition) throw fault(code, message ?? code, status);
};
const exists = async path => {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
function parse(raw, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('PAID_JOB_RECOVERY_JSON_INVALID', 'Invalid retained ' + label + '.', 400); }
}
function validSource(source) {
  need(object(source) && source.schema === 'stellar-forge.job-source.v1' &&
    HASH.test(source.configSha256 ?? '') && HASH.test(source.applicationSha256 ?? '') &&
    typeof source.application === 'string' && source.application.endsWith('.mjs') &&
    typeof source.publicOrigin === 'string',
  'PAID_JOB_RECOVERY_SOURCE_INVALID', 'The original paid-job source identity is required.');
  absolute(source.application, 'historical application');
  let origin; try { origin = new URL(source.publicOrigin); } catch {}
  need(origin?.protocol === 'https:' && origin.origin === source.publicOrigin &&
    !origin.username && !origin.password, 'PAID_JOB_RECOVERY_SOURCE_INVALID');
  return copy(source);
}
function passphraseName(value) {
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(value ?? ''), 'PAID_JOB_RECOVERY_PASSPHRASE_REQUIRED',
    'Use the name of the private SF101 passphrase environment variable.', 400);
  return value;
}
async function regular(path, maximum = MAX_FILE) {
  absolute(path, 'original source file');
  need(await realpath(path) === path, 'PAID_JOB_RECOVERY_SOURCE_SYMLINK',
    'Capture canonical source paths with their real directory layout.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum),
      'PAID_JOB_RECOVERY_UNSAFE_SOURCE', 'Capture regular source files within the original size limit.');
    const chunks = []; let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length; need(size <= maximum, 'PAID_JOB_RECOVERY_SOURCE_LIMIT'); chunks.push(chunk);
    }
    const after = await handle.stat({ bigint: true });
    need(BigInt(size) === before.size && before.size === after.size &&
      before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
    'PAID_JOB_RECOVERY_SOURCE_CHANGED', 'An original source file changed during review.');
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}
async function hashFile(path, maximum = MAX_FILE) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum),
      'PAID_JOB_RECOVERY_UNSAFE_SOURCE', 'The original SF101 engine requires regular files without hard links.');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length; need(size <= maximum, 'PAID_JOB_RECOVERY_SOURCE_LIMIT'); hash.update(chunk);
    }
    const after = await handle.stat({ bigint: true });
    need(BigInt(size) === before.size && before.size === after.size &&
      before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
    'PAID_JOB_RECOVERY_SOURCE_CHANGED', 'An original retained file changed during review.');
    return { sha256: hash.digest('hex'), bytes: size };
  } finally { await handle.close(); }
}
async function canonicalDirectory(path, label) {
  absolute(path, label); const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path,
    'PAID_JOB_RECOVERY_DIRECTORY_REQUIRED', 'Select the real ' + label + ' directory.');
  return path;
}
function validateOriginal(value) {
  need(object(value), 'PAID_JOB_RECOVERY_SELECTION_INVALID');
  for (const name of ['configPath', 'directory', 'applicationDirectory', 'applicationPath'])
    absolute(value[name], name);
  need(value.applicationPath.endsWith('.mjs') && inside(value.applicationDirectory, value.applicationPath) &&
    value.applicationPath !== value.applicationDirectory,
  'PAID_JOB_RECOVERY_APPLICATION_CLOSURE', 'Select the complete directory containing the original application module.');
  need(Array.isArray(value.deliveryDirectories) && value.deliveryDirectories.length <= 16 &&
    new Set(value.deliveryDirectories).size === value.deliveryDirectories.length,
  'PAID_JOB_RECOVERY_DELIVERY_SELECTION_INVALID');
  for (const path of value.deliveryDirectories) absolute(path, 'result delivery directory');
  if (value.destinationsFile !== null) absolute(value.destinationsFile, 'delivery destinations');
  need(Array.isArray(value.extraRoots) && value.extraRoots.length <= 16,
    'PAID_JOB_RECOVERY_ROOTS_INVALID');
  const names = new Set();
  for (const root of value.extraRoots) {
    need(object(root) && ROOT_NAME.test(root.name ?? '') && !names.has(root.name) &&
      ![PLAN_ROOT, OPERATION_ROOT].includes(root.name) && ['file', 'directory'].includes(root.kind),
    'PAID_JOB_RECOVERY_ROOTS_INVALID', 'Use distinct portable names for explicitly selected extra roots.');
    absolute(root.path, 'extra recovery root'); names.add(root.name);
  }
  return { configPath: value.configPath, directory: value.directory,
    applicationDirectory: value.applicationDirectory, applicationPath: value.applicationPath,
    deliveryDirectories: [...value.deliveryDirectories], destinationsFile: value.destinationsFile,
    extraRoots: value.extraRoots.map(root => ({ name: root.name, path: root.path, kind: root.kind })) };
}
async function selection(input) {
  need(object(input), 'PAID_JOB_RECOVERY_SELECTION_INVALID');
  const configPath = absolute(input.configPath, 'merchant configuration');
  const directory = absolute(input.directory, 'original merchant state');
  const applicationDirectory = absolute(input.applicationDirectory, 'complete application directory');
  await privateDirectory(directory); await canonicalDirectory(applicationDirectory, 'application');
  const defaults = join(directory, 'result-delivery');
  const deliveryDirectories = [...(input.deliveryDirectories ?? [])];
  need(Array.isArray(input.deliveryDirectories ?? []) && deliveryDirectories.length <= 16,
    'PAID_JOB_RECOVERY_DELIVERY_SELECTION_INVALID');
  if (await exists(defaults) && !deliveryDirectories.includes(defaults)) deliveryDirectories.unshift(defaults);
  need(new Set(deliveryDirectories).size === deliveryDirectories.length,
    'PAID_JOB_RECOVERY_DELIVERY_SELECTION_INVALID');
  for (const path of deliveryDirectories) { absolute(path, 'result delivery directory'); await privateDirectory(path); }
  const extraRoots = [];
  for (const root of input.roots ?? input.extraRoots ?? []) {
    need(object(root), 'PAID_JOB_RECOVERY_ROOTS_INVALID');
    const path = absolute(root.path, 'extra recovery root'), info = await lstat(path);
    need(!info.isSymbolicLink() && (info.isDirectory() || info.isFile()) && await realpath(path) === path,
      'PAID_JOB_RECOVERY_UNSAFE_SOURCE');
    extraRoots.push({ name: root.name, path, kind: info.isDirectory() ? 'directory' : 'file' });
  }
  return { configPath, directory, applicationDirectory, deliveryDirectories,
    destinationsFile: input.destinationsFile ? absolute(input.destinationsFile, 'delivery destinations') : null,
    extraRoots };
}
function selectedRoots(original) {
  const candidates = [
    { name: 'merchantState', path: original.directory, kind: 'directory' },
    { name: 'merchantConfiguration', path: original.configPath, kind: 'file' },
    { name: 'applicationFiles', path: original.applicationDirectory, kind: 'directory' },
    ...original.deliveryDirectories.map((path, index) => ({ name: 'resultDelivery' + index, path, kind: 'directory' })),
    ...(original.destinationsFile ? [{ name: 'deliveryDestinations', path: original.destinationsFile, kind: 'file' }] : []),
    ...original.extraRoots.map(root => ({ ...root, name: 'extra-' + root.name })),
  ];
  candidates.sort((a, b) => a.path.length - b.path.length || compare(a.path, b.path) || compare(a.name, b.name));
  const roots = [];
  for (const candidate of candidates) {
    const covered = roots.find(root => inside(root.path, candidate.path));
    if (covered) {
      need(covered.kind === 'directory' || covered.path === candidate.path,
        'PAID_JOB_RECOVERY_ROOT_OVERLAP'); continue;
    }
    roots.push(candidate);
  }
  roots.sort((a, b) => compare(a.name, b.name));
  need(roots.length <= 19 && new Set(roots.map(root => root.name)).size === roots.length &&
    roots.every(root => ![PLAN_ROOT, OPERATION_ROOT].includes(root.name)),
  'PAID_JOB_RECOVERY_ROOT_LIMIT', 'Keep the complete source within 19 original roots plus its encrypted typed plan.');
  return roots;
}
function logicalPath(roots, path) {
  const root = roots.find(value => inside(value.path, path));
  need(root && (root.kind === 'directory' || path === root.path), 'PAID_JOB_RECOVERY_ROLE_OUTSIDE_ROOTS');
  const suffix = relative(root.path, path);
  need(suffix !== '..' && !suffix.startsWith('../') && !suffix.includes('\\'), 'PAID_JOB_RECOVERY_ROLE_INVALID');
  return root.name + (suffix ? '/' + suffix : '');
}
function selectedRoles(original, roots) {
  return { configPath: logicalPath(roots, original.configPath), directory: logicalPath(roots, original.directory),
    applicationDirectory: logicalPath(roots, original.applicationDirectory),
    applicationPath: logicalPath(roots, original.applicationPath),
    deliveryDirectories: original.deliveryDirectories.map(path => logicalPath(roots, path)),
    destinationsFile: original.destinationsFile ? logicalPath(roots, original.destinationsFile) : null,
    extraRoots: original.extraRoots.map(root => ({ name: root.name, path: logicalPath(roots, root.path), kind: root.kind })) };
}
function leasePaths(original) {
  return new Set([join(original.directory, 'lease.lock'),
    join(original.directory, 'outbox', '.sf98-delivery.lock'),
    join(original.directory, 'result-delivery', 'lease.lock'),
    ...original.deliveryDirectories.map(path => join(path, 'lease.lock'))]);
}
async function sourceTrees(roots, excluded, privateRoots = []) {
  const budget = { entries: 0, bytes: 0 }, files = new Map(), trees = {};
  for (const root of roots) {
    const hash = createHash('sha256').update('stellar-forge.paid-job-recovery-tree.v1\0');
    let countFiles = 0, directories = 0, totalBytes = 0;
    async function visit(path, suffix, depth) {
      need(depth <= 16 && ++budget.entries <= MAX_ENTRIES, 'PAID_JOB_RECOVERY_ENTRY_LIMIT',
        'The selected roots exceed the original SF101 depth or entry limit.');
      const before = await lstat(path, { bigint: true });
      need(!before.isSymbolicLink() && (before.isFile() || before.isDirectory()) && await realpath(path) === path,
        'PAID_JOB_RECOVERY_UNSAFE_SOURCE', 'Use original regular files and canonical directory roots.');
      if (privateRoots.some(parent => inside(parent, path)))
        need(!(before.mode & 0o077n), 'PAID_JOB_RECOVERY_PRIVATE_STATE_REQUIRED',
          'Keep original merchant and delivery state private.');
      if (excluded.has(path)) {
        need(before.isFile() && before.nlink === 1n, 'PAID_JOB_RECOVERY_UNSAFE_LEASE');
        return;
      }
      if (before.isDirectory()) {
        directories++; hash.update(JSON.stringify([suffix, 'directory']) + '\n');
        const names = (await readdir(path)).sort();
        for (const name of names) {
          need(name !== '.' && name !== '..' && !/[\\/\0]/.test(name),
            'PAID_JOB_RECOVERY_UNSAFE_SOURCE');
          await visit(join(path, name), suffix ? suffix + '/' + name : name, depth + 1);
        }
        const after = await lstat(path, { bigint: true });
        need(before.dev === after.dev && before.ino === after.ino &&
          before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
        'PAID_JOB_RECOVERY_SOURCE_CHANGED', 'An original directory changed during review.');
      } else {
        const observed = await hashFile(path);
        countFiles++; totalBytes += observed.bytes; budget.bytes += observed.bytes;
        need(budget.bytes <= MAX_TOTAL, 'PAID_JOB_RECOVERY_BYTE_LIMIT');
        files.set(path, observed);
        hash.update(JSON.stringify([suffix, 'file', observed.bytes, observed.sha256]) + '\n');
      }
    }
    const first = await lstat(root.path);
    need(root.kind === 'directory' ? first.isDirectory() : first.isFile(),
      'PAID_JOB_RECOVERY_ROOT_CHANGED');
    await visit(root.path, '', 0);
    trees[root.name] = { kind: root.kind, sha256: hash.digest('hex'),
      files: countFiles, directories, bytes: totalBytes };
  }
  return { trees, files, total: { files: [...Object.values(trees)].reduce((n, row) => n + row.files, 0),
    directories: [...Object.values(trees)].reduce((n, row) => n + row.directories, 0), bytes: budget.bytes } };
}

async function readJournal(path, expected) {
  if (!expected) return { entries: 0 };
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile() && info.nlink === 1 && !(info.mode & 0o077),
      'PAID_JOB_RECOVERY_PRIVATE_STATE_REQUIRED');
    let pending = Buffer.alloc(0), entries = 0, size = 0;
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length; need(size <= MAX_TOTAL, 'PAID_JOB_RECOVERY_BYTE_LIMIT'); hash.update(chunk);
      let buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let start = 0, end;
      while ((end = buffer.indexOf(10, start)) !== -1) {
        need(end - start <= 8192, 'PAID_JOB_RECOVERY_JOURNAL_INVALID');
        if (end > start) {
          const row = parse(buffer.subarray(start, end), 'original settlement journal');
          need(object(row) && HASH.test(row.id ?? ''), 'PAID_JOB_RECOVERY_JOURNAL_INVALID');
          entries++;
        }
        start = end + 1;
      }
      pending = Buffer.from(buffer.subarray(start));
      need(pending.length <= 8192, 'PAID_JOB_RECOVERY_JOURNAL_INVALID');
    }
    need(!pending.length && size === expected.bytes && hash.digest('hex') === expected.sha256,
      'PAID_JOB_RECOVERY_JOURNAL_CHANGED', 'The original settlement journal differs from its reviewed bytes.');
    return { entries };
  } finally { await handle.close(); }
}
async function retainedSummary(original, sourceIdentity, observed) {
  const files = observed.files;
  const configRaw = await regular(original.configPath, 1048576);
  const config = parse(configRaw, 'original merchant configuration');
  const compiled = compileJobMerchant(config, { baseDir: dirname(original.configPath) });
  need(digest(configRaw) === sourceIdentity.configSha256 &&
    compiled.publicOrigin === sourceIdentity.publicOrigin &&
    files.get(original.applicationPath)?.sha256 === sourceIdentity.applicationSha256,
  'PAID_JOB_RECOVERY_SOURCE_MISMATCH', 'The selected original configuration or application differs from its retained identity.');
  const saved = parse(await readPrivate(join(original.directory, 'source.json'), 2097152), 'merchant source');
  need(saved?.schema === 'stellar-forge.job-merchant-state.v1' &&
    same(saved.source, sourceIdentity) && same(saved.configuration, config),
  'PAID_JOB_RECOVERY_STATE_SOURCE_MISMATCH', 'Select this application merchant’s original state directory.');
  need(files.get(join(original.directory, 'config-source.json'))?.sha256 === sourceIdentity.configSha256 &&
    files.get(join(original.directory, 'application-source.mjs'))?.sha256 === sourceIdentity.applicationSha256,
  'PAID_JOB_RECOVERY_RETAINED_SOURCE_MISMATCH', 'Retained original source copies must match the merchant identity.');

  const records = join(original.directory, 'records'), results = join(original.directory, 'results');
  await privateDirectory(records); await privateDirectory(results);
  const jobs = new Map(), states = Object.fromEntries([...JOB_STATES].map(state => [state, 0]));
  const settlementIds = new Set(), resultFiles = new Map();
  for (const name of (await readdir(records)).sort()) {
    if (!name.endsWith('.json')) continue;
    const row = parse(await readPrivate(join(records, name), 2097152), 'original paid job');
    need(row?.schema === 'stellar-forge.application-job.v1' && JOB_ID.test(row.id ?? '') &&
      name === row.id + '.json' && !jobs.has(row.id) && JOB_STATES.has(row.state) &&
      Number.isSafeInteger(row.revision) && row.revision > 0 && same(row.source, sourceIdentity),
    'PAID_JOB_RECOVERY_JOB_INVALID', 'An original job record has an inconsistent identity.');
    if (row.settlement !== null) {
      need(object(row.settlement) && HASH.test(row.settlement.id ?? '') &&
        row.settlement.orderReference === row.id, 'PAID_JOB_RECOVERY_SETTLEMENT_INVALID');
      settlementIds.add(row.settlement.id);
    }
    if (row.result !== null) {
      const result = row.result, file = files.get(join(results, result.file ?? ''));
      need(object(result) && HASH.test(result.sha256 ?? '') &&
        result.file === result.sha256 + '.bin' && Number.isSafeInteger(result.bytes) &&
        result.bytes >= 0 && result.bytes <= 67108864 && file?.sha256 === result.sha256 &&
        file.bytes === result.bytes, 'PAID_JOB_RECOVERY_RESULT_CHANGED',
      'An original paid result differs from its saved digest or byte count.');
      resultFiles.set(result.file, result.bytes);
    }
    need(row.state !== 'COMPLETED' || row.settlement !== null && row.result !== null,
      'PAID_JOB_RECOVERY_COMPLETED_JOB_INVALID');
    states[row.state]++; jobs.set(row.id, row);
  }
  const deliveryStates = Object.fromEntries([...DELIVERY_STATES].map(state => [state, 0]));
  let deliveries = 0, deliveryAttempts = 0;
  const deliveryStores = [];
  for (const directory of original.deliveryDirectories) {
    const savedSource = parse(await readPrivate(join(directory, 'source.json'), PLAN_LIMIT), 'delivery source');
    need(savedSource?.schema === 'stellar-forge.job-result-delivery-source.v1' &&
      same(savedSource.merchant, merchantIdentity(sourceIdentity)), 'PAID_JOB_RECOVERY_DELIVERY_SOURCE_MISMATCH');
    const path = join(directory, 'records'); await privateDirectory(path);
    let count = 0;
    for (const name of (await readdir(path)).sort()) {
      if (!name.endsWith('.json')) continue;
      const row = parse(await readPrivate(join(path, name), PLAN_LIMIT), 'frozen result delivery');
      need(row?.schema === 'stellar-forge.job-result-delivery-state.v1' && HASH.test(row.id ?? '') &&
        name === row.id + '.json' && DELIVERY_STATES.has(row.state) &&
        Number.isSafeInteger(row.attemptCount) && row.attemptCount >= 0,
      'PAID_JOB_RECOVERY_DELIVERY_INVALID');
      const manifest = validateManifest(row.manifest), job = jobs.get(manifest.job.id);
      need(manifest.deliveryId === row.id && same(manifest.merchant, merchantIdentity(sourceIdentity)) &&
        job?.state === 'COMPLETED' && manifest.job.functionId === job.functionId &&
        manifest.job.inputSha256 === job.inputSha256 && manifest.nativeSettlement.id === job.settlement.id &&
        manifest.result.sha256 === job.result.sha256 && manifest.result.bytes === job.result.bytes,
      'PAID_JOB_RECOVERY_DELIVERY_RESULT_MISMATCH', 'A frozen delivery must refer to its original completed paid result.');
      if (row.state === 'DELIVERED') validateAcknowledgment(row.receipt, manifest);
      deliveryStates[row.state]++; count++; deliveries++; deliveryAttempts += row.attemptCount;
    }
    deliveryStores.push({ directory, deliveries: count });
  }
  let destinationCount = null;
  if (original.destinationsFile) destinationCount = (await readDeliveryConfig(original.destinationsFile)).destinations.length;
  const outbox = join(original.directory, 'outbox');
  const events = await readJournal(join(outbox, 'events.ndjson'), files.get(join(outbox, 'events.ndjson')));
  const attempts = await readJournal(join(outbox, 'deliveries.ndjson'), files.get(join(outbox, 'deliveries.ndjson')));
  return { merchant: { serviceName: compiled.serviceName, publicOrigin: sourceIdentity.publicOrigin,
      functions: Object.keys(compiled.functions).sort() },
    jobs: { total: jobs.size, states, nativeSettlements: settlementIds.size,
      resultFiles: resultFiles.size, resultBytes: [...resultFiles.values()].reduce((a, b) => a + b, 0) },
    outbox: { nativeReceiptEntries: events.entries, deliveryJournalEntries: attempts.entries },
    deliveries: { total: deliveries, states: deliveryStates, attempts: deliveryAttempts,
      stores: deliveryStores.map(({ deliveries: count }, index) => ({ selection: index, deliveries: count })),
      configuredDestinations: destinationCount } };
}
async function inspectLocked(selected) {
  const source = await readJobMerchantSource({ configPath: selected.configPath, directory: selected.directory });
  const original = validateOriginal({ ...selected, applicationPath: source.applicationPath });
  if (selected.applicationPath !== undefined)
    need(selected.applicationPath === original.applicationPath, 'PAID_JOB_RECOVERY_APPLICATION_CHANGED',
      'The selected original physical application changed after plan preparation.');
  const sourceIdentity = validSource(source.identity);
  const roots = selectedRoots(original), roles = selectedRoles(original, roots);
  const observed = await sourceTrees(roots, leasePaths(original), [original.directory, ...original.deliveryDirectories]);
  const state = await inspectJobRecoveryState({ directory: original.directory,
    deliveryDirectories: original.deliveryDirectories });
  need(HASH.test(state.sha256 ?? '') && (state.bindingSha256 === null || HASH.test(state.bindingSha256 ?? '')),
    'PAID_JOB_RECOVERY_STATE_IDENTITY_INVALID');
  const summary = await retainedSummary(original, sourceIdentity, observed);
  const after = await readJobMerchantSource({ configPath: original.configPath, directory: original.directory });
  need(same(after.identity, sourceIdentity) && after.applicationPath === original.applicationPath,
    'PAID_JOB_RECOVERY_SOURCE_CHANGED');
  return { schema: PAID_JOB_RECOVERY_SCHEMA, original, roots, roles,
    source: { identity: sourceIdentity, state, trees: observed.trees, ...observed.total }, summary };
}

/** Inspect the original saved merchant while holding its actual writer leases.
 * No merchant open, worker start, reconciliation or settlement takes place. */
export async function inspectPaidJobRecovery(input = {}) {
  const selected = await selection(input);
  const lease = await acquireJobRecoveryLeases({ directory: selected.directory,
    deliveryDirectories: selected.deliveryDirectories });
  try { await lease.assertHeld(); return await inspectLocked(selected); }
  finally { await lease.close(); }
}

/** Preserve the complete application directory layout and include this typed
 * mapping as an encrypted ordinary SF101 root. Overlapping role paths share one
 * ancestor root, so the original engine receives non-overlapping roots. */
export async function preparePaidJobRecoveryPlan({ planFile, ...input } = {}) {
  absolute(planFile, 'new recovery plan'); await privateDirectory(dirname(planFile));
  const inspected = await inspectPaidJobRecovery(input);
  need(!inspected.roots.some(root => inside(root.path, planFile) || inside(planFile, root.path)),
    'PAID_JOB_RECOVERY_PLAN_OVERLAP', 'Save the recovery plan outside all original selected roots.');
  const profile = { ...inspected, createdAt: stamp(), planFile };
  const plan = { schema: PLAN_SCHEMA,
    roots: [...inspected.roots.map(({ name, path }) => ({ name, path })), { name: PLAN_ROOT, path: planFile }],
    paidJobs: profile };
  const content = bytes(plan);
  need(content.length <= PLAN_LIMIT && inspected.source.bytes + content.length <= MAX_TOTAL &&
    inspected.source.files + inspected.source.directories + 1 <= MAX_ENTRIES,
  'PAID_JOB_RECOVERY_PLAN_LIMIT', 'The typed plan and selected original roots exceed the SF101 capture limits.');
  await createFile(planFile, content); await syncDirectory(dirname(planFile));
  return { status: 'PAID_JOB_RECOVERY_PLAN_READY', planFile, sha256: digest(content),
    profileSha256: identity(profile), plan, summary: inspected.summary, source: inspected.source };
}
function typedPlan(raw) {
  const plan = parse(raw, 'paid-job recovery plan'), profile = plan?.paidJobs;
  need(plan?.schema === PLAN_SCHEMA && profile?.schema === PAID_JOB_RECOVERY_SCHEMA &&
    Array.isArray(plan.roots) && object(profile.source) && object(profile.summary),
  'PAID_JOB_RECOVERY_PROFILE_REQUIRED', 'Choose a snapshot prepared with the paidJobs recovery profile.');
  const original = validateOriginal(profile.original), roots = selectedRoots(original);
  absolute(profile.planFile, 'original recovery plan');
  validSource(profile.source.identity);
  need(same(original, profile.original) && same(roots, profile.roots) &&
    same(selectedRoles(original, roots), profile.roles) &&
    same(plan.roots, [...roots.map(({ name, path }) => ({ name, path })),
      { name: PLAN_ROOT, path: profile.planFile }]) &&
    !roots.some(root => inside(root.path, profile.planFile) || inside(profile.planFile, root.path)),
  'PAID_JOB_RECOVERY_PROFILE_CHANGED', 'The typed mapping differs from its original root selection.');
  need(HASH.test(profile.source.state?.sha256 ?? '') &&
    (profile.source.state.bindingSha256 === null || HASH.test(profile.source.state.bindingSha256 ?? '')),
  'PAID_JOB_RECOVERY_PROFILE_CHANGED', 'The original state and binding identities are required.');
  for (const root of roots) {
    const tree = profile.source.trees?.[root.name];
    need(tree?.kind === root.kind && HASH.test(tree.sha256 ?? '') &&
      ['files', 'directories', 'bytes'].every(key => Number.isSafeInteger(tree[key]) && tree[key] >= 0),
    'PAID_JOB_RECOVERY_PROFILE_CHANGED', 'A selected original tree is missing its retained digest.');
  }
  return { plan, profile, roots };
}
async function reviewedPlan(planFile, expectedPlanSha256) {
  absolute(planFile, 'recovery plan');
  const raw = await readPrivate(planFile, PLAN_LIMIT), sha256 = digest(raw);
  if (expectedPlanSha256 !== undefined)
    need(HASH.test(expectedPlanSha256) && sha256 === expectedPlanSha256,
      'PAID_JOB_RECOVERY_PLAN_CHANGED', 'The reviewed original plan bytes changed.');
  const parsed = typedPlan(raw);
  need(parsed.profile.planFile === planFile, 'PAID_JOB_RECOVERY_PLAN_MOVED',
    'Capture from the plan at its original path; receive restored plans through the receiving operation.');
  return { ...parsed, raw, sha256 };
}
function matchesReview(current, profile) {
  need(same(current.original, profile.original) && same(current.roots, profile.roots) &&
    same(current.roles, profile.roles) && same(current.source, profile.source) &&
    same(current.summary, profile.summary), 'PAID_JOB_RECOVERY_SOURCE_CHANGED',
  'The original saved selection changed after review. Prepare a new plan for its current complete state.');
}
export async function inspectPaidJobRecoveryPlan(planFile) {
  const found = await reviewedPlan(planFile);
  const current = await inspectPaidJobRecovery(found.profile.original);
  matchesReview(current, found.profile);
  return { status: 'PAID_JOB_RECOVERY_SOURCE_MATCHED', planFile, sha256: found.sha256,
    profileSha256: identity(found.profile), profile: copy(found.profile),
    source: current.source, summary: current.summary };
}

/** Maintained SF101 local capture hook. Its callback contains the original new
 * snapshot, durable progress and verification block. A completed bundle resume
 * is verified by the caller independently of later legitimate source changes. */
export async function withPaidJobRecoveryCapture({ planFile, expectedPlanSha256 } = {}, operation) {
  need(typeof operation === 'function', 'PAID_JOB_RECOVERY_CAPTURE_CALLBACK_REQUIRED', undefined, 400);
  const initial = await reviewedPlan(planFile, expectedPlanSha256);
  const lease = await acquireJobRecoveryLeases({ directory: initial.profile.original.directory,
    deliveryDirectories: initial.profile.original.deliveryDirectories });
  try {
    await lease.assertHeld();
    const found = await reviewedPlan(planFile, initial.sha256);
    matchesReview(await inspectLocked(found.profile.original), found.profile);
    const result = await operation({ planFile, planSha256: found.sha256,
      profileSha256: identity(found.profile), profile: copy(found.profile) });
    const capturedPath = result?.bundleDirectory ?? result?.bundle;
    const capturedSha256 = result?.manifestSha256 ?? result?.snapshotId;
    if (capturedPath && capturedSha256) {
      absolute(capturedPath, 'captured encrypted bundle');
      const captured = await readPrivate(join(capturedPath, 'manifest.json'), MAX_MANIFEST);
      need(digest(captured) === capturedSha256, 'PAID_JOB_RECOVERY_BUNDLE_CHANGED');
      manifestMatchesProfile(parse(captured, 'captured manifest'), found.profile, found.roots);
    }
    await lease.assertHeld();
    await reviewedPlan(planFile, found.sha256);
    matchesReview(await inspectLocked(found.profile.original), found.profile);
    return result;
  } finally { await lease.close(); }
}
function manifestMatchesProfile(manifest, profile, roots) {
  const expectedRoots = [...roots.map(({ name, kind }) => ({ name, kind })), { name: PLAN_ROOT, kind: 'file' }];
  need(same(manifest.roots, expectedRoots) && Array.isArray(manifest.entries),
    'PAID_JOB_RECOVERY_ROOTS_CHANGED', 'The authenticated capture must contain the original typed roots.');
  const entries = new Map(), children = new Map(), trees = {};
  for (const entry of manifest.entries) {
    need(typeof entry.path === 'string' && !entries.has(entry.path), 'PAID_JOB_RECOVERY_BUNDLE_INVALID');
    entries.set(entry.path, entry);
    const slash = entry.path.lastIndexOf('/');
    if (slash !== -1) {
      const parent = entry.path.slice(0, slash), name = entry.path.slice(slash + 1);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push({ name, path: entry.path });
    }
  }
  const ignored = new Set([...leasePaths(profile.original)]
    .filter(path => roots.some(root => inside(root.path, path)))
    .map(path => logicalPath(roots, path)));
  let visited = 0;
  for (const root of roots) {
    const hash = createHash('sha256').update('stellar-forge.paid-job-recovery-tree.v1\0');
    let files = 0, directories = 0, totalBytes = 0;
    function visit(path, suffix, depth) {
      need(depth <= 16 && ++visited <= MAX_ENTRIES, 'PAID_JOB_RECOVERY_ENTRY_LIMIT');
      const entry = entries.get(path);
      need(entry, 'PAID_JOB_RECOVERY_BUNDLE_INVALID');
      if (ignored.has(path)) {
        need(entry.kind === 'file', 'PAID_JOB_RECOVERY_UNSAFE_LEASE'); return;
      }
      if (entry.kind === 'directory') {
        directories++; hash.update(JSON.stringify([suffix, 'directory']) + '\n');
        for (const child of (children.get(path) ?? []).sort((a, b) => compare(a.name, b.name)))
          visit(child.path, suffix ? suffix + '/' + child.name : child.name, depth + 1);
      } else {
        need(entry.kind === 'file' && HASH.test(entry.sha256 ?? '') &&
          Number.isSafeInteger(entry.size) && entry.size >= 0, 'PAID_JOB_RECOVERY_BUNDLE_INVALID');
        files++; totalBytes += entry.size;
        hash.update(JSON.stringify([suffix, 'file', entry.size, entry.sha256]) + '\n');
      }
    }
    visit(root.name, '', 0);
    trees[root.name] = { kind: root.kind, sha256: hash.digest('hex'), files, directories, bytes: totalBytes };
  }
  need(same(trees, profile.source.trees), 'PAID_JOB_RECOVERY_CAPTURE_SOURCE_MISMATCH',
    'The encrypted capture contains source bytes that differ from the reviewed typed plan.');
}
/** Compare an already authenticated SF101 manifest with the exact retained
 * reviewed plan bytes. This is a pure completed-capture check: the maintained
 * runner verifies ciphertext/HMAC first, then uses this check before adopting a
 * found bundle even if the original plan or live merchant has since changed. */
export function inspectCapturedPaidJobManifest({ planBytes, manifest } = {}) {
  need(Buffer.isBuffer(planBytes) || planBytes instanceof Uint8Array,
    'PAID_JOB_RECOVERY_PLAN_BYTES_REQUIRED', 'Supply the exact retained reviewed plan bytes.', 400);
  const raw = Buffer.from(planBytes);
  need(raw.length > 0 && raw.length <= PLAN_LIMIT, 'PAID_JOB_RECOVERY_PLAN_LIMIT', undefined, 400);
  const { profile, roots } = typedPlan(raw), planSha256 = digest(raw);
  need(object(manifest) && manifest.schema === BUNDLE_SCHEMA &&
    Array.isArray(manifest.roots) && Array.isArray(manifest.entries) &&
    manifest.entries.length <= MAX_ENTRIES,
  'PAID_JOB_RECOVERY_BUNDLE_INVALID', 'Supply the original authenticated SF101 manifest.');
  const retainedPlan = manifest.entries.find(entry => entry?.path === PLAN_ROOT);
  need(retainedPlan?.kind === 'file' && retainedPlan.size === raw.length &&
    retainedPlan.sha256 === planSha256,
  'PAID_JOB_RECOVERY_PLAN_CHANGED', 'The captured typed plan differs from its retained reviewed bytes.');
  need(manifest.capture?.schema === 'stellar-forge.merchant-recovery-capture.v1' &&
    HASH.test(manifest.capture.id ?? '') && manifest.capture.planSha256 === planSha256,
  'PAID_JOB_RECOVERY_CAPTURE_MISMATCH', 'The authenticated capture binds a different reviewed typed plan.');
  manifestMatchesProfile(manifest, profile, roots);
  return { status: 'PAID_JOB_RECOVERY_CAPTURE_MATCHED', planSha256,
    profileSha256: identity(profile), captureId: manifest.capture.id };
}

async function verifiedBundle(bundleDirectory, passphraseEnv, expectedManifestSha256) {
  absolute(bundleDirectory, 'encrypted bundle'); await privateDirectory(bundleDirectory);
  passphraseName(passphraseEnv);
  const raw = await readPrivate(join(bundleDirectory, 'manifest.json'), MAX_MANIFEST), sha256 = digest(raw);
  if (expectedManifestSha256 !== undefined)
    need(HASH.test(expectedManifestSha256) && sha256 === expectedManifestSha256,
      'PAID_JOB_RECOVERY_BUNDLE_CHANGED', 'The selected encrypted manifest changed.');
  const verification = await recover(['verify', '--bundle', bundleDirectory, '--pass-env', passphraseEnv]);
  need(verification.status === 'SNAPSHOT_VERIFIED' &&
    digest(await readPrivate(join(bundleDirectory, 'manifest.json'), MAX_MANIFEST)) === sha256,
  'PAID_JOB_RECOVERY_BUNDLE_CHANGED', 'The original encrypted snapshot changed during verification.');
  const manifest = parse(raw, 'authenticated SF101 manifest');
  need(manifest.schema === BUNDLE_SCHEMA && Array.isArray(manifest.roots) && Array.isArray(manifest.entries),
    'PAID_JOB_RECOVERY_BUNDLE_INVALID');
  return { manifest, manifestSha256: sha256, verification };
}
export async function capturePaidJobRecovery({ planFile, bundleDirectory, passphraseEnv,
  expectedPlanSha256, captureId } = {}) {
  const found = await reviewedPlan(planFile, expectedPlanSha256);
  absolute(bundleDirectory, 'new encrypted bundle'); passphraseName(passphraseEnv);
  await privateDirectory(dirname(bundleDirectory));
  const selectedId = captureId ?? identity({ schema: 'stellar-forge.paid-job-capture.v1',
    planSha256: found.sha256, bundleDirectory });
  need(HASH.test(selectedId), 'PAID_JOB_RECOVERY_CAPTURE_ID_INVALID', undefined, 400);
  const matchingCapture = checked => {
    need(checked.manifest.capture?.schema === 'stellar-forge.merchant-recovery-capture.v1' &&
      checked.manifest.capture.id === selectedId && checked.manifest.capture.planSha256 === found.sha256,
    'PAID_JOB_RECOVERY_CAPTURE_MISMATCH', 'The existing bundle belongs to a different reviewed capture.');
    manifestMatchesProfile(checked.manifest, found.profile, found.roots);
  };
  if (await exists(bundleDirectory)) {
    const checked = await verifiedBundle(bundleDirectory, passphraseEnv);
    matchingCapture(checked);
    return { status: 'PAID_JOB_RECOVERY_CAPTURED', reused: true, bundleDirectory,
      manifestSha256: checked.manifestSha256, planSha256: found.sha256, captureId: selectedId,
      original: { snapshot: null, verification: checked.verification } };
  }
  return withPaidJobRecoveryCapture({ planFile, expectedPlanSha256: found.sha256 }, async () => {
    const snapshot = await recover(['snapshot', '--plan', planFile, '--out', bundleDirectory,
      '--pass-env', passphraseEnv, '--quiesced', '--capture-id', selectedId,
      '--expected-plan-sha256', found.sha256]);
    const checked = await verifiedBundle(bundleDirectory, passphraseEnv);
    matchingCapture(checked);
    return { status: 'PAID_JOB_RECOVERY_CAPTURED', reused: false, bundleDirectory,
      manifestSha256: checked.manifestSha256, planSha256: found.sha256, captureId: selectedId,
      original: { snapshot, verification: checked.verification } };
  });
}

function restoredPath(restoreDirectory, logical) {
  need(typeof logical === 'string' && !logical.includes('\\') && !logical.includes('\0') &&
    logical.split('/').every(part => part && part !== '.' && part !== '..'),
  'PAID_JOB_RECOVERY_ROLE_INVALID');
  const path = join(restoreDirectory, ...logical.split('/'));
  need(inside(restoreDirectory, path) && path !== restoreDirectory, 'PAID_JOB_RECOVERY_ROLE_INVALID');
  return path;
}
function restoredSelection(restoreDirectory, profile) {
  const roles = profile.roles, locate = value => restoredPath(restoreDirectory, value);
  return validateOriginal({ configPath: locate(roles.configPath), directory: locate(roles.directory),
    applicationDirectory: locate(roles.applicationDirectory), applicationPath: locate(roles.applicationPath),
    deliveryDirectories: roles.deliveryDirectories.map(locate),
    destinationsFile: roles.destinationsFile ? locate(roles.destinationsFile) : null,
    extraRoots: roles.extraRoots.map(root => ({ ...root, path: locate(root.path) })) });
}
function publicPaths(ctx) {
  return { ...copy(ctx.target), operationDirectory: ctx.operationDirectory,
    restoredPlanFile: join(ctx.restoreDirectory, PLAN_ROOT) };
}
function launchCommands(target) {
  const base = ['serve', '--config', target.configPath, '--state', target.directory];
  const first = target.deliveryDirectories[0];
  if (target.destinationsFile && first)
    base.push('--delivery-config', target.destinationsFile, '--delivery-state', first);
  return { merchant: { command: 'starforge jobs', args: base },
    delivery: target.destinationsFile ? target.deliveryDirectories.map(directory => ({
      command: 'starforge jobs delivery', args: ['status', '--config', target.configPath,
        '--state', target.directory, '--destinations', target.destinationsFile, '--delivery-state', directory] })) : [],
    application: { module: 'seller/jobs', export: 'openJobMerchant',
      options: { configPath: target.configPath, directory: target.directory } },
    resultDelivery: target.deliveryDirectories.map(directory => ({
      module: 'seller/jobs/result-delivery', export: 'openResultDelivery',
      directory, destinationsFile: target.destinationsFile })) };
}
async function operationRecord(ctx) {
  if (!await exists(ctx.operationDirectory)) return null;
  await privateDirectory(ctx.operationDirectory);
  const file = join(ctx.operationDirectory, 'operation.json');
  if (!await exists(file)) return null;
  const operation = parse(await readPrivate(file, 2097152), 'paid-job receiving operation');
  need(operation?.schema === PAID_JOB_PREPARATION_SCHEMA && operation.operationId === ctx.operationId &&
    operation.reviewSha256 === ctx.reviewSha256 && operation.manifestSha256 === ctx.manifestSha256 &&
    operation.profileSha256 === ctx.profileSha256 && operation.planSha256 === ctx.planSha256 &&
    ['ADOPTING', 'COMPLETE'].includes(operation.phase) && same(operation.paths, publicPaths(ctx)),
  'PAID_JOB_RECOVERY_OPERATION_CONFLICT', 'This receiving destination belongs to a different retained operation.');
  if (operation.phase === 'COMPLETE')
    need(operation.result?.status === 'PAID_JOB_RECOVERY_READY' &&
      operation.result.operationId === ctx.operationId && operation.result.reviewSha256 === ctx.reviewSha256 &&
      same(operation.result.paths, publicPaths(ctx)) && same(operation.result.summary, ctx.profile.summary) &&
      HASH.test(operation.result.adoption?.bindingSha256 ?? ''),
    'PAID_JOB_RECOVERY_OPERATION_INVALID', 'The completed preparation is missing its retained result.');
  return operation;
}
async function receivingContext(input) {
  need(object(input), 'PAID_JOB_RECOVERY_RECEIVING_SELECTION_INVALID');
  const bundleDirectory = absolute(input.bundleDirectory, 'encrypted bundle');
  const restoreDirectory = absolute(input.restoreDirectory, 'completed plaintext restore');
  need(!inside(bundleDirectory, restoreDirectory) && !inside(restoreDirectory, bundleDirectory),
    'PAID_JOB_RECOVERY_RESTORE_OVERLAP', 'Keep the encrypted bundle separate from the original plaintext restore.');
  await privateDirectory(restoreDirectory);
  const verified = await verifiedBundle(bundleDirectory, input.passphraseEnv, input.expectedManifestSha256);
  const planEntry = verified.manifest.entries.find(entry => entry.path === PLAN_ROOT);
  need(planEntry?.kind === 'file' && planEntry.size <= PLAN_LIMIT,
    'PAID_JOB_RECOVERY_PROFILE_REQUIRED', 'This encrypted snapshot has no original paidJobs typed plan.');
  const raw = await readPrivate(join(restoreDirectory, PLAN_ROOT), PLAN_LIMIT), planSha256 = digest(raw);
  need(raw.length === planEntry.size && planSha256 === planEntry.sha256,
    'PAID_JOB_RECOVERY_PLAN_CHANGED', 'The restored typed plan differs from its authenticated original bytes.');
  const { plan, profile, roots } = typedPlan(raw);
  manifestMatchesProfile(verified.manifest, profile, roots);
  need(same(verified.manifest.roots, [...roots.map(({ name, kind }) => ({ name, kind })),
    { name: PLAN_ROOT, kind: 'file' }]), 'PAID_JOB_RECOVERY_ROOTS_CHANGED',
  'Receive the complete original paid-job snapshot.');
  if (verified.manifest.capture)
    need(verified.manifest.capture.planSha256 === planSha256,
      'PAID_JOB_RECOVERY_CAPTURE_MISMATCH', 'The original manifest capture binds a different typed plan.');
  const target = restoredSelection(restoreDirectory, profile), profileSha256 = identity(profile);
  const review = { schema: PAID_JOB_PREPARATION_SCHEMA, bundleDirectory, restoreDirectory,
    manifestSha256: verified.manifestSha256, planSha256, profileSha256,
    target, source: profile.source.identity, stateSha256: profile.source.state.sha256,
    previousBindingSha256: profile.source.state.bindingSha256 };
  const reviewSha256 = identity(review);
  const operationId = identity({ schema: PAID_JOB_PREPARATION_SCHEMA,
    purpose: 'prepare-original-paid-job-merchant', reviewSha256 });
  const ctx = { ...verified, bundleDirectory, restoreDirectory, passphraseEnv: input.passphraseEnv,
    plan, profile, roots, target, planSha256, profileSha256, review, reviewSha256, operationId,
    operationDirectory: join(restoreDirectory, OPERATION_ROOT) };
  ctx.operation = await operationRecord(ctx);
  return ctx;
}
function provenance(ctx) {
  return { bundleManifestSha256: ctx.manifestSha256, profileSha256: ctx.profileSha256,
    reviewSha256: ctx.reviewSha256, stateSha256: ctx.profile.source.state.sha256 };
}
async function selectedAdoption(ctx) {
  const file = join(ctx.target.directory, 'source-binding.json');
  if (!await exists(file)) return null;
  const raw = await readPrivate(file, 65536), binding = parse(raw, 'original source binding');
  if (binding.directory !== ctx.target.directory || binding.configPath !== ctx.target.configPath ||
      binding.applicationPath !== ctx.target.applicationPath || !same(binding.provenance, provenance(ctx)) ||
      !same(binding.source, ctx.profile.source.identity)) return null;
  const source = await readJobMerchantSource({ configPath: ctx.target.configPath, directory: ctx.target.directory });
  need(source.sourceBinding?.sha256 === digest(raw) && source.applicationPath === ctx.target.applicationPath &&
    same(source.identity, ctx.profile.source.identity),
  'PAID_JOB_RECOVERY_ADOPTION_CHANGED', 'The selected original source binding changed during receiving.');
  return { bindingSha256: source.sourceBinding.sha256, source };
}
async function verifyRestoredLocked(ctx, lease) {
  await lease.assertHeld();
  const roots = ctx.roots.map(root => ({ ...root, path: join(ctx.restoreDirectory, root.name) }));
  const originalIgnored = leasePaths(ctx.profile.original);
  const ignored = new Set([...originalIgnored]
    .filter(path => ctx.roots.some(root => inside(root.path, path)))
    .map(path => restoredPath(ctx.restoreDirectory, logicalPath(ctx.roots, path))));
  const observed = await sourceTrees(roots, ignored, [ctx.target.directory, ...ctx.target.deliveryDirectories]);
  need(same(observed.trees, ctx.profile.source.trees), 'PAID_JOB_RECOVERY_RESTORED_SOURCE_CHANGED',
    'The restored application, merchant state or frozen deliveries differ from the captured original roots.');
  const state = await inspectJobRecoveryState({ directory: ctx.target.directory,
    deliveryDirectories: ctx.target.deliveryDirectories });
  need(state.sha256 === ctx.profile.source.state.sha256 &&
    state.bindingSha256 === ctx.profile.source.state.bindingSha256,
  'PAID_JOB_RECOVERY_RESTORED_STATE_CHANGED', 'The restored original state or prior source binding changed.');
  const summary = await retainedSummary(ctx.target, ctx.profile.source.identity, observed);
  need(same(summary, ctx.profile.summary), 'PAID_JOB_RECOVERY_RESTORED_SUMMARY_CHANGED');
  await lease.assertHeld();
  return { state, summary };
}
function inspectedResult(ctx, preparation, reused = false) {
  return { status: reused ? 'PAID_JOB_RECOVERY_READY' : 'PAID_JOB_RECOVERY_REVIEW_READY',
    operationId: ctx.operationId, reviewSha256: ctx.reviewSha256,
    manifestSha256: ctx.manifestSha256, planSha256: ctx.planSha256, profileSha256: ctx.profileSha256,
    paths: publicPaths(ctx), originalSource: copy(ctx.profile.source.identity),
    summary: copy(ctx.profile.summary), preparation, launch: launchCommands(ctx.target),
    ...(reused ? { reused: true, result: copy(ctx.operation.result) } : {}) };
}

/** Inspect an existing ordinary SF101 restore. Complete operations return their
 * retained outcome even after legitimate merchant work advances the rows. */
export async function inspectRestoredPaidJobs(input = {}) {
  const ctx = await receivingContext(input);
  const lease = await acquireJobRecoveryLeases({ directory: ctx.target.directory,
    deliveryDirectories: ctx.target.deliveryDirectories });
  try {
    await lease.assertHeld();
    ctx.operation = await operationRecord(ctx);
    const adopted = await selectedAdoption(ctx);
    if (ctx.operation?.phase === 'COMPLETE') {
      need(adopted && adopted.bindingSha256 === ctx.operation.result.adoption.bindingSha256,
        'PAID_JOB_RECOVERY_COMPLETED_BINDING_CHANGED', 'The completed operation’s original source binding changed.');
      return inspectedResult(ctx, { phase: 'COMPLETE',
        bindingSha256: adopted.bindingSha256, completedAt: ctx.operation.completedAt }, true);
    }
    if (adopted) return inspectedResult(ctx, { phase: 'ADOPTED',
      bindingSha256: adopted.bindingSha256, resume: true });
    const checked = await verifyRestoredLocked(ctx, lease);
    return inspectedResult(ctx, { phase: ctx.operation?.phase ?? 'AVAILABLE',
      expectedStateSha256: checked.state.sha256, expectedBindingSha256: checked.state.bindingSha256 });
  } finally { await lease.close(); }
}

/** Publish one explicit physical source binding using the original merchant
 * adapter. Jobs, native settlement journals and frozen deliveries remain the
 * same retained files. The adapter rechecks state under its own writer leases. */
export async function prepareRestoredPaidJobs(input = {}) {
  const ctx = await receivingContext(input);
  need(HASH.test(input.expectedReviewSha256 ?? '') && input.expectedReviewSha256 === ctx.reviewSha256,
    'PAID_JOB_RECOVERY_REVIEW_CHANGED', 'Apply the exact paid-job receiving review SHA-256.', 400);
  try { await mkdir(ctx.operationDirectory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(ctx.operationDirectory); await syncDirectory(ctx.restoreDirectory);
  const unlock = await acquireWorkspace(ctx.operationDirectory);
  try {
    ctx.operation = await operationRecord(ctx);
    let lease = await acquireJobRecoveryLeases({ directory: ctx.target.directory,
      deliveryDirectories: ctx.target.deliveryDirectories });
    try {
      await lease.assertHeld();
      const adopted = await selectedAdoption(ctx);
      if (ctx.operation?.phase === 'COMPLETE') {
        need(adopted && adopted.bindingSha256 === ctx.operation.result.adoption.bindingSha256,
          'PAID_JOB_RECOVERY_COMPLETED_BINDING_CHANGED');
        return { ...copy(ctx.operation.result), reused: true };
      }
      if (!adopted) await verifyRestoredLocked(ctx, lease);
      if (!ctx.operation) {
        ctx.operation = { schema: PAID_JOB_PREPARATION_SCHEMA, operationId: ctx.operationId,
          reviewSha256: ctx.reviewSha256, manifestSha256: ctx.manifestSha256,
          planSha256: ctx.planSha256, profileSha256: ctx.profileSha256,
          phase: 'ADOPTING', createdAt: stamp(), paths: publicPaths(ctx),
          expectedStateSha256: ctx.profile.source.state.sha256,
          expectedBindingSha256: ctx.profile.source.state.bindingSha256 };
        await atomicJson(ctx.operationDirectory, 'operation.json', ctx.operation);
      }
    } finally { await lease.close(); lease = null; }

    // Release inspection leases before invoking the original non-reentrant
    // adoption adapter; it rechecks both reviewed state and previous binding.
    const adoption = await adoptRestoredJobSource({
      configPath: ctx.target.configPath, directory: ctx.target.directory,
      applicationPath: ctx.target.applicationPath, originalSource: ctx.profile.source.identity,
      bundleManifestSha256: ctx.manifestSha256, profileSha256: ctx.profileSha256,
      reviewSha256: ctx.reviewSha256, expectedStateSha256: ctx.profile.source.state.sha256,
      expectedBindingSha256: ctx.profile.source.state.bindingSha256,
      deliveryDirectories: ctx.target.deliveryDirectories,
    });
    need(adoption?.schema === 'stellar-forge.job-source-adoption.v1' &&
      adoption.directory === ctx.target.directory && adoption.configPath === ctx.target.configPath &&
      adoption.applicationPath === ctx.target.applicationPath &&
      same(adoption.source, ctx.profile.source.identity) && same(adoption.provenance, provenance(ctx)) &&
      HASH.test(adoption.bindingSha256 ?? ''), 'PAID_JOB_RECOVERY_ADOPTION_INVALID');
    const result = { status: 'PAID_JOB_RECOVERY_READY', operationId: ctx.operationId,
      reviewSha256: ctx.reviewSha256, manifestSha256: ctx.manifestSha256,
      planSha256: ctx.planSha256, profileSha256: ctx.profileSha256, paths: publicPaths(ctx),
      originalSource: copy(ctx.profile.source.identity), summary: copy(ctx.profile.summary),
      adoption, launch: launchCommands(ctx.target), completedAt: stamp() };
    ctx.operation = { ...ctx.operation, phase: 'COMPLETE', completedAt: result.completedAt, result };
    await atomicJson(ctx.operationDirectory, 'operation.json', ctx.operation);
    const saved = await operationRecord(ctx);
    need(saved?.phase === 'COMPLETE' && same(saved.result, result),
      'PAID_JOB_RECOVERY_OPERATION_COMMIT_CHANGED');
    return { ...copy(saved.result), reused: false };
  } finally { await unlock(); }
}
