#!/usr/bin/env node
// MIT. Install, select and run existing Stellar Forge source releases.
import { spawn } from 'node:child_process';
import { mkdir, readdir, lstat, rm, rename, mkdtemp, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as osConstants } from 'node:os';
import { HOME_SCHEMA, MANIFEST, UPDATE_CLAIMS, sha256, verifyRelease, plainDirectory, boundedFile, putFile,
  atomicFile, atomicJson, jsonFile, validateId, withHomeLock } from './release-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELP = `Stellar Forge | portable product

  node forge.mjs install BUNDLE --home DIRECTORY [--expect DIGEST] [--activate]
  node forge.mjs status [--home DIRECTORY]
  node forge.mjs activate RELEASE_ID [--home DIRECTORY]
  node forge.mjs rollback [--home DIRECTORY]
  node forge.mjs verify [BUNDLE] [--expect DIGEST]
  node forge.mjs doctor [--home DIRECTORY]
  node forge.mjs run COMMAND [--home DIRECTORY] -- ORIGINAL_ARGUMENTS

The first install becomes active. Later installs are staged unless --activate
is supplied. Activation selects code for NEW launches; existing processes keep
their original code. Configuration and merchant state live in home/config and
home/state, outside releases. Native command arguments are passed unchanged.
Use status for command names and paths. No shell, network install, service
restart, payment approval or test runner is added by this launcher.
`;

async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function flags(args, allowed) {
  const result = { positional: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) { result.positional.push(arg); continue; }
    if (!allowed.includes(arg) || result[arg] !== undefined) throw new Error(HELP);
    if (arg === '--activate') result[arg] = true;
    else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(HELP);
      result[arg] = args[++index];
    }
  }
  return result;
}
async function homeInfo(input) {
  const home = await plainDirectory(input);
  const metadata = await jsonFile(join(home, 'installation.json'));
  if (metadata.schema !== HOME_SCHEMA) throw new Error('Not a Stellar Forge installation: ' + home);
  for (const name of ['config', 'state', 'releases']) {
    if (await plainDirectory(join(home, name)) !== join(home, name)) throw new Error('Installation directory was redirected: ' + name);
  }
  return home;
}
async function activeInfo(home) {
  if (!await exists(join(home, 'active.json'))) return null;
  const state = await jsonFile(join(home, 'active.json'));
  if (state.schema !== 'stellar-forge.active-release.v1') throw new Error('Invalid active release');
  validateId(state.releaseId);
  if (state.previousReleaseId !== null) validateId(state.previousReleaseId);
  if (!/^[0-9a-f]{64}$/.test(state.digest ?? '')) throw new Error('Invalid active release digest');
  return state;
}
async function initialize(home, bundle) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = await plainDirectory(home);
  if (!await exists(join(path, 'installation.json'))) {
    const pendingPath = join(path, 'initializing.json');
    const bootstrap = Object.fromEntries(await Promise.all(['forge.mjs', 'release-core.mjs']
      .map(async name => {
        const file = bundle.files.find(entry => entry.path === name);
        const bytes = await boundedFile(bundle.root, name, file.bytes);
        if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
          throw new Error('Release content differs: ' + name);
        return [name, bytes];
      })));
    const tempName = /^(forge\.mjs|release-core\.mjs|initializing\.json|installation\.json)\.new-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    let pending;
    if (await exists(pendingPath)) {
      pending = await jsonFile(pendingPath);
      if (pending.schema !== HOME_SCHEMA || pending.sourceDigest !== bundle.manifest.digest)
        throw new Error('Resume this interrupted first install with the same release bundle');
    } else {
      const entries = (await readdir(path)).filter(name => name !== UPDATE_CLAIMS &&
        !(name.startsWith('initializing.json.new-') && tempName.test(name)));
      if (entries.length) throw new Error('Install into a new or empty directory');
      pending = { schema: HOME_SCHEMA, createdAt: new Date().toISOString(), sourceDigest: bundle.manifest.digest };
      await atomicJson(pendingPath, pending);
    }
    for (const name of ['releases', 'config', 'state']) {
      await mkdir(join(path, name), { recursive: true, mode: 0o700 });
      if (await plainDirectory(join(path, name)) !== join(path, name)) throw new Error('Invalid installation directory');
    }
    // Only an unfinished installation with this verified source digest reaches
    // here. Repair partial bootstrap bytes from an interrupted older writer, and
    // publish new files only after their complete bytes have been synced.
    for (const [name, bytes] of Object.entries(bootstrap))
      await atomicFile(join(path, name), bytes, name === 'forge.mjs' ? 0o755 : 0o644);
    for (const name of await readdir(path)) if (tempName.test(name)) await unlink(join(path, name));
    await atomicJson(join(path, 'installation.json'), pending);
    await unlink(pendingPath);
  }
  return homeInfo(path);
}
async function selectUnlocked(home, id) {
  validateId(id);
  const release = await verifyRelease(join(home, 'releases', id));
  if (release.id !== id) throw new Error('Release directory identity differs from manifest');
  const before = await activeInfo(home);
  if (before?.releaseId === id) {
    if (before.digest !== release.manifest.digest) throw new Error('Active release digest changed');
    return { ...before, changed: false };
  }
  const state = { schema: 'stellar-forge.active-release.v1', releaseId: id,
    digest: release.manifest.digest, previousReleaseId: before?.releaseId ?? null,
    activatedAt: new Date().toISOString() };
  await atomicJson(join(home, 'active.json'), state);
  return { ...state, changed: true };
}
export async function install(bundleInput, homeInput, { expected, activate = false } = {}) {
  const bundle = await verifyRelease(bundleInput, expected), home = resolve(homeInput);
  if (home === bundle.root || home.startsWith(bundle.root + '/')) throw new Error('Installation must be outside its release bundle');
  await mkdir(home, { recursive: true, mode: 0o700 });
  return withHomeLock(home, async lockedHome => {
    await initialize(lockedHome, bundle);
    const target = join(lockedHome, 'releases', bundle.id);
    let state = 'ALREADY_INSTALLED';
    if (await exists(target)) {
      await verifyRelease(target, bundle.manifest.digest);
    } else {
      const stage = await mkdtemp(join(lockedHome, 'releases', '.install-'));
      try {
        for (const file of bundle.files)
          await putFile(join(stage, file.path), await boundedFile(bundle.root, file.path, file.bytes), file.mode);
        await putFile(join(stage, MANIFEST), bundle.manifestBytes);
        // A changed input cannot be promoted after the initial source read.
        await verifyRelease(stage, bundle.manifest.digest);
        await rename(stage, target);
        state = 'INSTALLED';
      } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
    }
    const previous = await activeInfo(lockedHome);
    const selection = activate || !previous ? await selectUnlocked(lockedHome, bundle.id) : previous;
    return { state, home: lockedHome, releaseId: bundle.id, digest: bundle.manifest.digest,
      activeReleaseId: selection.releaseId, staged: selection.releaseId !== bundle.id,
      config: join(lockedHome, 'config'), merchantState: join(lockedHome, 'state') };
  });
}
export async function activate(homeInput, id) {
  const home = await homeInfo(homeInput);
  return withHomeLock(home, () => selectUnlocked(home, id));
}
export async function rollback(homeInput) {
  const home = await homeInfo(homeInput);
  return withHomeLock(home, async () => {
    const state = await activeInfo(home);
    if (!state?.previousReleaseId) throw new Error('There is no previous release');
    return selectUnlocked(home, state.previousReleaseId);
  });
}
async function selected(input = HERE) {
  const root = await plainDirectory(input);
  if (await exists(join(root, 'installation.json'))) {
    const home = await homeInfo(root), active = await activeInfo(home);
    if (!active) throw new Error('Install or activate a release first');
    const release = await verifyRelease(join(home, 'releases', active.releaseId), active.digest);
    if (release.id !== active.releaseId) throw new Error('Active release identity mismatch');
    return { ...release, home, active };
  }
  return verifyRelease(root);
}
export async function status(input = HERE) {
  const release = await selected(input);
  const releases = [];
  if (release.home) for (const entry of await readdir(join(release.home, 'releases'), { withFileTypes: true })) {
    if (entry.name.startsWith('.install-')) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unexpected installed release entry');
    validateId(entry.name);
    const manifest = await jsonFile(join(release.home, 'releases', entry.name, MANIFEST));
    releases.push({ id: entry.name, version: manifest.version, sourceCommit: manifest.source?.commit,
      active: entry.name === release.id });
  }
  return { product: 'Stellar Forge', activeReleaseId: release.id, releaseDirectory: release.root,
    digest: release.manifest.digest, sourceCommit: release.manifest.source.commit,
    files: release.files.length, bytes: release.totalBytes, commands: release.manifest.commands,
    ...(release.home ? { home: release.home, config: join(release.home, 'config'), state: join(release.home, 'state'),
      previousReleaseId: release.active.previousReleaseId, releases } : {}) };
}
export async function doctor(input = HERE) {
  const release = await selected(input);
  async function inspectPackages(declarations) {
    const result = [];
    for (const [name, expected] of Object.entries(declarations ?? {})) {
      let installed = null;
      try { installed = (await jsonFile(join(release.root, 'node_modules', name, 'package.json'))).version; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      result.push({ name, requested: expected, installed,
        state: installed === expected ? 'MATCH' : installed ? 'VERSION_DIFFERS' : 'NOT_INSTALLED' });
    }
    return result;
  }
  const packages = await inspectPackages(release.manifest.runtime.nativePackages);
  const adapterPackages = await inspectPackages(release.manifest.runtime.adapterPackages);
  return { node: process.version, nodeReady: Number(process.versions.node.split('.')[0]) >= 22,
    releaseId: release.id, sourceVerified: true, standardLibraryCommands: 'AVAILABLE', nativePackages: packages,
    nativeSdkInstalled: packages.every(pkg => pkg.state === 'MATCH'),
    adapterPackages, postgresDriversInstalled: adapterPackages.some(pkg => pkg.name === 'pg') &&
      adapterPackages.every(pkg => pkg.state === 'MATCH'),
    note: 'SDK presence does not configure or authorize facilitator, signer, network or merchant operations.' };
}
export async function runNative(name, args, input = HERE) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Stellar Forge requires Node 22 or newer');
  const release = await selected(input), command = release.manifest.commands[name];
  if (!command) throw new Error('Unknown native command: ' + name + '. Use status to list commands.');
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(release.root, command.path), ...args], { stdio: 'inherit', shell: false });
    const signals = ['SIGINT', 'SIGTERM'];
    const handlers = signals.map(signal => () => { child.kill(signal); });
    signals.forEach((signal, index) => process.on(signal, handlers[index]));
    const clean = () => signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
    child.on('error', error => { clean(); reject(error); });
    child.on('close', (code, signal) => { clean(); accept(code ?? (128 + (osConstants.signals[signal] ?? 1))); });
  });
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ['help', '--help'].includes(command)) { console.log(HELP); return 0; }
  if (command === 'run') {
    const separator = rest.indexOf('--');
    if (separator < 0) throw new Error(HELP);
    const options = flags(rest.slice(0, separator), ['--home']);
    if (options.positional.length !== 1) throw new Error(HELP);
    return runNative(options.positional[0], rest.slice(separator + 1), options['--home'] ?? HERE);
  }
  const allowed = { install: ['--home', '--expect', '--activate'], activate: ['--home'],
    rollback: ['--home'], status: ['--home'], doctor: ['--home'], verify: ['--expect'] };
  if (!allowed[command]) throw new Error(HELP);
  const options = flags(rest, allowed[command]);
  const home = options['--home'] ?? HERE;
  let result;
  if (command === 'install' && options.positional.length === 1 && options['--home'])
    result = await install(options.positional[0], home, { expected: options['--expect'], activate: options['--activate'] });
  else if (command === 'activate' && options.positional.length === 1) result = await activate(home, options.positional[0]);
  else if (command === 'rollback' && !options.positional.length) result = await rollback(home);
  else if (command === 'status' && !options.positional.length) result = await status(home);
  else if (command === 'doctor' && !options.positional.length) result = await doctor(home);
  else if (command === 'verify' && options.positional.length <= 1) {
    const release = await verifyRelease(options.positional[0] ?? HERE, options['--expect']);
    result = { id: release.id, digest: release.manifest.digest, files: release.files.length, bytes: release.totalBytes };
  } else throw new Error(HELP);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
