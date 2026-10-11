// MIT. Compose the original encrypted restore and host generator on new private state.
import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir, writeFile, copyFile, rename } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { run as recover } from '../sf101-merchant-recovery/recover.mjs';
import { checkBundle, generate, prepare, ROOT } from './host.mjs';
import { restoreRetainedSelections } from './retained-release.mjs';

const SCHEMA = 'stellar-forge.merchant-host-restore.v1';
const need = (value, message) => { if (!value) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (root, value) => root === value || value.startsWith(root + '/');
const overlaps = (a, b) => inside(a, b) || inside(b, a);
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => object(item) ?
  Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function absolute(value, name) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\x00-\x1f\x7f]/.test(value), name + ' must be an absolute normalized path');
  return value;
}
async function real(value, name, directory = false) {
  absolute(value, name);
  need(await realpath(value) === value, name + ' must not traverse a symlink');
  const info = await lstat(value);
  need(directory ? info.isDirectory() : info.isFile() && info.nlink === 1,
    name + ' must be a real ' + (directory ? 'directory' : 'single-link file'));
  return value;
}
async function bytes(file, maximum = 1024 * 1024) {
  await real(file, 'input');
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    need(before.size <= maximum, 'Input size limit exceeded');
    const value = await fd.readFile();
    const after = await fd.stat();
    need(value.length === before.size && value.length <= maximum && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'Input changed while reading');
    return value;
  } finally { await fd.close(); }
}
const decode = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
async function writeJson(file, value, exclusive = true) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
}
async function rebaseOrders(python, state, mappings) {
  const helper = fileURLToPath(new URL('./restore-orders.py', import.meta.url));
  return await new Promise((resolveResult, reject) => {
    const child = spawn(python, ['-B', helper], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', exceeded = false;
    const collect = target => chunk => {
      if (target === 'out') stdout += chunk; else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 1024 * 1024) {
        exceeded = true; child.kill();
      }
    };
    child.stdout.on('data', collect('out')); child.stderr.on('data', collect('err'));
    child.once('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.once('close', code => {
      if (code !== 0 || exceeded) return reject(new Error(exceeded ? 'Receiver rebase output limit exceeded' :
        'Restored receiver rebase failed: ' + stderr.trim().slice(0, 2000)));
      try { resolveResult(JSON.parse(stdout)); } catch { reject(new Error('Invalid receiver rebase result')); }
    });
    child.stdin.end(JSON.stringify({ state, mappings }));
  });
}

/**
 * recoveryPlan is the operator-selected original SF101 plan, not a search root.
 * Its named roots explicitly select which known filesystem fields can move.
 * The original archive remains authoritative; only this new destination is edited.
 * The caller owns quiescence, its operation journal, permissions and activation.
 */
export async function prepareRestoredHost({ previousBundle, recoveryPlan, snapshot,
  passphraseEnv, destination, sourceRoot = ROOT }) {
  await real(previousBundle, 'previousBundle', true);
  await real(recoveryPlan, 'recoveryPlan');
  await real(snapshot, 'snapshot', true);
  await real(sourceRoot, 'sourceRoot', true);
  absolute(destination, 'destination');
  await real(dirname(destination), 'destination parent', true);
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(passphraseEnv ?? ''), 'Original recovery passphrase environment name required');
  try { await lstat(destination); throw new Error('Destination already exists; select a new attempt directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const previous = await checkBundle(previousBundle);
  const previousManifestBytes = await bytes(join(previousBundle, 'deployment.json'));
  const originalPlanBytes = await bytes(previous.planFile);
  const raw = decode(originalPlanBytes);
  const retained = await prepare(previous.planFile, { sourceRoot: previous.sourceRoot });
  for (const [key, value] of Object.entries(retained))
    need(canonical(value) === canonical(previous[key]), 'Original host plan no longer matches its deployment: ' + key);

  const recoveryPlanBytes = await bytes(recoveryPlan, 256 * 1024);
  const selected = decode(recoveryPlanBytes);
  need(object(selected) && selected.schema === 'stellar-forge.merchant-recovery-plan.v1' &&
    Array.isArray(selected.roots) && selected.roots.length > 0 && selected.roots.length <= 20,
    'Original named recovery roots required');
  const manifestBytes = await bytes(join(snapshot, 'manifest.json'), 12 * 1024 * 1024);
  const manifest = decode(manifestBytes);
  need(Array.isArray(manifest.roots) && manifest.roots.length === selected.roots.length,
    'Selected recovery roots must match the complete original snapshot');
  const names = new Set();
  const mappings = selected.roots.map(item => {
    need(object(item) && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.name ?? '') && !names.has(item.name),
      'Unique original recovery root name required');
    names.add(item.name); absolute(item.path, 'selected recovery root');
    const found = manifest.roots.find(root => root.name === item.name);
    need(found && ['file', 'directory'].includes(found.kind), 'Selected root is absent from snapshot: ' + item.name);
    const restored = join(destination, 'restored', item.name);
    // A standalone file root loses its suffix in SF101. Preserve its basename for
    // module loading; a selected directory root retains its whole relative closure.
    return { name: item.name, kind: found.kind, from: item.path, restored,
      to: found.kind === 'file' ? join(destination, 'files', item.name, basename(item.path)) : restored };
  });
  for (const [index, item] of mappings.entries()) {
    need(![sourceRoot, previous.sourceRoot, previousBundle, snapshot, recoveryPlan, previous.planFile]
      .some(path => overlaps(path, destination)) && !overlaps(item.from, destination),
      'Destination must be separate from source, original state, plans and backup');
    for (const other of mappings.slice(index + 1)) need(!overlaps(item.from, other.from), 'Selected recovery roots overlap');
  }
  function mapped(value, field) {
    absolute(value, field);
    const matches = mappings.filter(root => root.kind === 'file' ? root.from === value : inside(root.from, value));
    need(matches.length === 1, 'Select the original filesystem root for ' + field + ': ' + value);
    return join(matches[0].to, relative(matches[0].from, value));
  }
  const stateRoot = mapped(previous.stateRoot, 'privateRoot');
  const configPath = mapped(previous.configPath, 'config');
  const inputPaths = new Map(previous.inputFiles.map(input => [input.path, mapped(input.path, 'configuration input')]));
  need(!previous.environmentFile || !mappings.some(root => inside(root.from, previous.environmentFile)),
    'Keep the private environment file under its separate original recovery procedure');

  // No reuse, overwrite or cleanup of another attempt. Failed staging is retained
  // inside this exclusively-created directory for the caller's existing journal.
  await mkdir(destination, { mode: 0o700 });
  const restored = await recover(['restore', '--bundle', snapshot, '--out', join(destination, 'restored'),
    '--pass-env', passphraseEnv]);
  need(sha(await bytes(join(snapshot, 'manifest.json'), 12 * 1024 * 1024)) === sha(manifestBytes),
    'Recovery manifest changed during staging');
  for (const root of mappings) if (root.kind === 'file') {
    await mkdir(dirname(root.to), { recursive: true, mode: 0o700 });
    await copyFile(root.restored, root.to, constants.COPYFILE_EXCL);
  }
  await real(stateRoot, 'restored privateRoot', true);
  const configuration = [];
  for (const input of previous.inputFiles) {
    const current = inputPaths.get(input.path), data = await bytes(current, 8 * 1024 * 1024);
    need(sha(data) === input.sha256, 'Snapshot configuration differs from the selected deployment: ' + input.path);
    configuration.push({ original: input.path, restored: current, originalSha256: input.sha256,
      restoredSha256: input.sha256 });
  }
  // SF99 deliberately grants writes only beneath privateRoot. Keep a selected
  // external idempotency journal in that same boundary by moving its complete
  // authenticated directory, never by widening systemd's writable surface.
  const upstreams = raw.upstreams ? decode(await bytes(inputPaths.get(raw.upstreams))) : null;
  if (upstreams) {
    need(object(upstreams.bindings), 'Original upstream bindings required');
    const moving = new Set();
    for (const binding of Object.values(upstreams.bindings)) if (binding.idempotency) {
      const original = absolute(binding.idempotency.stateDir, 'upstream idempotency state');
      if (inside(stateRoot, mapped(original, 'upstream idempotency state'))) continue;
      const root = mappings.find(item => item.kind === 'directory' && inside(item.from, original));
      need(root && !overlaps(root.to, stateRoot) &&
        !previous.inputFiles.some(input => inside(root.from, input.path)) &&
        ![sourceRoot, previous.sourceRoot].some(source => overlaps(root.from, source)),
        'Select a dedicated idempotency recovery directory; its current root also contains configuration, source or privateRoot');
      moving.add(root);
    }
    if (moving.size) {
      const writable = join(stateRoot, '.restored-writable');
      await mkdir(writable, { mode: 0o700 });
      for (const root of moving) {
        const target = join(writable, root.name);
        await rename(root.to, target);
        root.to = target; root.relocatedIntoPrivateRoot = true;
      }
    }
  }
  const rewrites = [];
  const rewrite = (holder, key, field, originalDirectory = null) => {
    const from = originalDirectory === null ? holder[key] : resolve(originalDirectory, holder[key]);
    const to = mapped(from, field);
    rewrites.push({ field, from, to }); holder[key] = to;
  };
  const config = previous.kind === 'release' ? null : decode(await bytes(configPath));
  if (previous.kind === 'paid-file') {
    rewrite(config, 'state', 'checkout.state'); rewrite(config, 'outbox', 'checkout.outbox');
  } else if (config) {
    for (const [index, route] of config.routes.entries()) {
      if (Object.hasOwn(route, 'responseFile')) rewrite(route, 'responseFile',
        'routes[' + index + '].responseFile', dirname(previous.configPath));
      if (Object.hasOwn(route, 'responseAsset')) rewrite(route.responseAsset, 'file',
        'routes[' + index + '].responseAsset.file', dirname(previous.configPath));
    }
  }
  if (config) await writeJson(configPath, config, false);
  const nextPlan = previous.kind === 'release' ? restoreRetainedSelections(raw, previous, mapped) : structuredClone(raw);
  if (previous.kind === 'release') {
    rewrites.push({ field: 'release.store', from: previous.release.store, to: nextPlan.release.store });
    if (previous.discovery) rewrites.push({ field: 'discovery.setup', from: previous.discovery.directory,
      to: nextPlan.discovery.setup });
  } else nextPlan.config = configPath;
  nextPlan.privateRoot = stateRoot;
  for (const key of ['handlers', 'upstreams']) if (raw[key]) nextPlan[key] = inputPaths.get(raw[key]);
  if (raw.upstreams) {
    const file = nextPlan.upstreams;
    for (const [name, binding] of Object.entries(upstreams.bindings)) if (binding.idempotency)
      rewrite(binding.idempotency, 'stateDir', 'upstreams.' + name + '.idempotency.stateDir');
    await writeJson(file, upstreams, false);
  }
  // Pin the original resolved executables, including defaults absent from its plan.
  // checkout.python is an executable selection, never a merchant-state reference.
  nextPlan.runtime = { node: previous.node, python: previous.python };
  for (const item of configuration) item.restoredSha256 = sha(await bytes(item.restored, 8 * 1024 * 1024));
  const receiver = previous.kind === 'paid-file' ?
    await rebaseOrders(previous.python, config.state, mappings) : null;
  const planFile = join(destination, 'host-plan.json');
  await writeJson(planFile, nextPlan);
  const result = await generate(planFile, join(destination, 'host'), { sourceRoot });
  const summary = { schema: SCHEMA, status: 'RESTORED_HOST_PREPARED', merchant: previous.merchant,
    kind: previous.kind, mode: previous.mode, publicOrigin: previous.publicOrigin,
    previousBundle, previousDeploymentSha256: sha(previousManifestBytes),
    originalPlan: previous.planFile, originalPlanSha256: sha(originalPlanBytes),
    recoveryPlan, recoveryPlanSha256: sha(recoveryPlanBytes), snapshot,
    snapshotManifestSha256: sha(manifestBytes), sourceRoot, configuration, rewrites,
    receiver, restored, generated: result, activated: false };
  await writeJson(join(destination, 'restore-host.json'), { ...summary, mappings, planFile, stateRoot });
  return { bundle: result.bundle, planFile, stateRoot, mappings, summary };
}
