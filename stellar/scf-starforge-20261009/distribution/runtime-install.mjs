// MIT. Install the original release beside its selected native dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { open, writeFile, mkdir, lstat, realpath, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as osConstants } from 'node:os';
import { resolveRuntimeProfile, inspectRuntimeProfile, verifyRuntimeProfile } from './runtime-profile.mjs';

export const INSTALL_SCHEMA = 'stellar-forge.runtime-install.v1';
const STATE_SCHEMA = 'stellar-forge.runtime-install-state.v1';
const PREPARATION_SCHEMA = 'stellar-forge.runtime-preparation.v1';
const BASE = 'stellar/scf-starforge-20261009/distribution/';
const UNPACK = fileURLToPath(new URL('./runtime-unpack.py', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const now = () => new Date().toISOString();
const fail = (code, message = code) => Object.assign(new Error(message), { code });
const need = (value, code, message) => { if (!value) throw fail(code, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function regular(file, maximum = 4 * 1024 * 1024) {
  const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= maximum, 'RUNTIME_REGULAR_FILE_REQUIRED');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    need(bytes.length <= maximum && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs, 'RUNTIME_FILE_CHANGED_DURING_READ');
    return bytes;
  } finally { await handle.close(); }
}
const readJson = async file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(file)));
async function privateDirectory(directory) {
  const path = resolve(directory);
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    !(info.mode & 0o077) && (process.getuid === undefined || info.uid === process.getuid()),
  'RUNTIME_PRIVATE_DIRECTORY_REQUIRED', 'Use the original private runtime directory owned by this operator');
  return path;
}
async function createPrivate(directory) {
  const path = resolve(directory), parent = dirname(path);
  need(path !== '/' && await realpath(parent) === parent, 'RUNTIME_REAL_PARENT_REQUIRED');
  await mkdir(path, { mode: 0o700 });
  return privateDirectory(path);
}
async function save(directory, name, value, replace = false) {
  const destination = join(directory, name), temporary = join(directory, '.pending-' + randomUUID());
  const handle = await open(replace ? temporary : destination, 'wx', 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); }
  finally { await handle.close(); }
  if (replace) await rename(temporary, destination);
  const parent = await open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
}

// Same retained-open-description flock used by the original merchant stores.
// fd3 also travels to npm: a surviving npm process keeps this installation
// locked if its caller disappears. No stale PID or timed lease can unlock it.
async function installationLease(directory) {
  need(process.platform === 'linux', 'RUNTIME_LINUX_REQUIRED');
  const file = join(directory, 'install.lock');
  const handle = await open(file, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW, 0o600);
  try {
    const info = await handle.stat(), named = await lstat(file);
    need(info.isFile() && info.nlink === 1 && !(info.mode & 0o077) && info.dev === named.dev && info.ino === named.ino,
      'RUNTIME_PRIVATE_LOCK_REQUIRED');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'],
      { stdio: ['ignore', 'ignore', 'ignore', handle.fd], timeout: 5000 });
    if (result.error) throw fail('RUNTIME_FLOCK_UNAVAILABLE');
    need(result.status === 0, result.status === 75 ? 'RUNTIME_INSTALL_ALREADY_RUNNING' : 'RUNTIME_LOCK_FAILED');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

function subprocess(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, ...options });
    const forward = signal => { if (child.exitCode === null) child.kill(signal); };
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    const detach = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('error', error => { detach(); reject(error); });
    child.once('exit', (code, signal) => {
      detach(); done({ code: code ?? 128 + (osConstants.signals[signal] ?? 1), signal });
    });
  });
}
async function unpack(archive, sha256, directory, { verify = false, python = 'python3' } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(python, [UNPACK, '--archive', archive, '--sha256', sha256, '--out', directory,
      ...(verify ? ['--verify'] : [])], { shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    let stdout = '', stderr = '', overflow = false;
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 1024 * 1024) { overflow = true; child.kill('SIGTERM'); } });
    child.stderr.on('data', data => { if (stderr.length < 16384) stderr += data; });
    child.once('error', () => reject(fail('RUNTIME_PYTHON_UNAVAILABLE', 'Python 3.11+ is required to unpack the original release')));
    child.once('exit', code => {
      if (code !== 0 || overflow) {
        let detail = 'Original release extraction failed';
        try { detail = JSON.parse(stderr).error || detail; } catch {}
        reject(fail('RUNTIME_ARCHIVE_INVALID', detail));
      } else {
        try { done(JSON.parse(stdout)); } catch { reject(fail('RUNTIME_ARCHIVE_RESULT_INVALID')); }
      }
    });
  });
}

function sourceSelection(profile) {
  return { native: !!profile.selection.native, features: [...profile.selection.features],
    operator: !!profile.selection.operator,
    pins: { ...profile.selection.pins } };
}

/** A new directory is the installation boundary. Existing applications are never npm targets. */
export async function prepareRuntimeInstall({ directory, archive, sha256, native = false, features = [],
  pins = {}, operator = false, python = 'python3', from = null } = {}) {
  need(typeof directory === 'string' && directory && typeof archive === 'string' && archive,
    'RUNTIME_DIRECTORY_AND_ARCHIVE_REQUIRED');
  need(/^[a-f0-9]{64}$/.test(sha256 ?? ''), 'RUNTIME_ARCHIVE_HASH_REQUIRED');
  need(typeof native === 'boolean' && typeof operator === 'boolean' && Array.isArray(features) &&
    features.every(value => typeof value === 'string') && plain(pins) &&
    Object.values(pins).every(value => typeof value === 'string') &&
    typeof python === 'string' && python && !python.includes('\0'), 'RUNTIME_SELECTION_INVALID');
  const sourceBytes = await regular(resolve(archive), 64 * 1024 * 1024);
  need(hash(sourceBytes) === sha256, 'RUNTIME_ARCHIVE_HASH_MISMATCH');
  const target = await createPrivate(directory);
  try {
    const archivePath = join(target, 'source.tgz');
    // This retained intent makes a failed extraction/preparation recoverable in
    // a fresh directory, even before a complete installation plan exists.
    await save(target, 'preparation.json', { schema: PREPARATION_SCHEMA, createdAt: now(),
      directory: target, archivePath, archiveSha256: sha256, inputArchive: resolve(archive), python,
      selection: { native, features: [...features], pins: { ...pins }, operator } });
    const archiveHandle = await open(archivePath, 'wx', 0o600);
    try { await archiveHandle.writeFile(sourceBytes); await archiveHandle.sync(); }
    finally { await archiveHandle.close(); }
    const original = await unpack(archivePath, sha256, join(target, 'package'), { python });
    const profile = await resolveRuntimeProfile({ sourceRoot: original.sourceRoot, native, features, pins, operator });
    await verifyRuntimeProfile(profile);
    need(profile.source.sourceCommit === original.sourceCommit && profile.source.packageName === original.packageName &&
      profile.source.packageVersion === original.packageVersion, 'RUNTIME_PROFILE_SOURCE_MISMATCH');
    const packageJson = profile.packageJson;
    need(plain(packageJson) && plain(packageJson.dependencies) && !packageJson.scripts &&
      !packageJson.optionalDependencies && !packageJson.devDependencies, 'RUNTIME_PROFILE_PACKAGE_INVALID');
    const profileBytes = json(profile), packageBytes = json(packageJson);
    await writeFile(join(target, 'runtime-profile.json'), profileBytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(target, 'package.json'), packageBytes, { flag: 'wx', mode: 0o600 });
    const plan = { schema: INSTALL_SCHEMA,
      installationId: hash(json({ archiveSha256: sha256, profileId: profile.profileId })),
      createdAt: now(), directory: target, archivePath, archiveSha256: sha256, python,
      source: original, profileId: profile.profileId, profileSha256: hash(profileBytes),
      packageJsonSha256: hash(packageBytes), sourceRoot: original.sourceRoot, dependencyRoot: target,
      entrypoint: join(original.sourceRoot, BASE + 'cli.mjs'),
      previousDirectory: from ? resolve(from) : null };
    await save(target, 'runtime-install.json', plan);
    await save(target, 'install-state.json', { schema: STATE_SCHEMA, installationId: plan.installationId,
      phase: 'PREPARED', attempts: 0, updatedAt: now() });
    await writeFile(join(target, 'RUNBOOK.md'), installationRunbook(plan, profile), { flag: 'wx', mode: 0o600 });
    return { status: 'PREPARED', directory: target, installationId: plan.installationId,
      sourceCommit: original.sourceCommit, packageVersion: original.packageVersion, profileId: profile.profileId,
      dependencies: profile.dependencies, sourceRoot: plan.sourceRoot, dependencyRoot: target,
      entrypoint: plan.entrypoint };
  } catch (error) {
    await save(target, 'prepare-error.json', { phase: 'PREPARE_FAILED', at: now(), code: error.code ?? 'PREPARE_FAILED' })
      .catch(() => {});
    throw error;
  }
}

async function readInstall(directory) {
  const target = await privateDirectory(directory);
  const plan = await readJson(join(target, 'runtime-install.json'));
  need(plan.schema === INSTALL_SCHEMA && plan.directory === target &&
    plan.archivePath === join(target, 'source.tgz') && plan.sourceRoot === join(target, 'package', 'source') &&
    plan.entrypoint === join(plan.sourceRoot, BASE + 'cli.mjs') && /^[a-f0-9]{64}$/.test(plan.archiveSha256 ?? ''),
    'RUNTIME_INSTALL_PLAN_INVALID');
  const profileBytes = await regular(join(target, 'runtime-profile.json'));
  need(hash(profileBytes) === plan.profileSha256, 'RUNTIME_PROFILE_CHANGED');
  const profile = JSON.parse(profileBytes);
  await verifyRuntimeProfile(profile);
  need(profile.profileId === plan.profileId &&
    hash(json({ archiveSha256: plan.archiveSha256, profileId: profile.profileId })) === plan.installationId,
    'RUNTIME_INSTALL_IDENTITY_CHANGED');
  const packageBytes = await regular(join(target, 'package.json'));
  need(hash(packageBytes) === plan.packageJsonSha256 && packageBytes.equals(Buffer.from(json(profile.packageJson))),
    'RUNTIME_PACKAGE_PLAN_CHANGED');
  need(hash(await regular(join(target, 'package', 'manifest.json'))) === plan.source.manifestSha256,
    'RUNTIME_SOURCE_MANIFEST_CHANGED');
  const state = await readJson(join(target, 'install-state.json'));
  need(state.schema === STATE_SCHEMA && state.installationId === plan.installationId &&
    ['PREPARED', 'INSTALLING', 'FAILED', 'READY'].includes(state.phase), 'RUNTIME_INSTALL_STATE_INVALID');
  const selected = await resolveRuntimeProfile({ sourceRoot: plan.sourceRoot, ...sourceSelection(profile) });
  need(selected.profileId === profile.profileId, 'RUNTIME_SOURCE_DECLARATIONS_CHANGED');
  return { directory: target, plan, profile, state };
}
async function lockDigest(directory) {
  try { return hash(await regular(join(directory, 'package-lock.json'), 16 * 1024 * 1024)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function profileReady(report) {
  // The maintained runtime-profile inspector owns version and native load checks.
  return report.ready === true || report.passed === true;
}
async function inspect(installed, { load = true, checkRecordedLock = true } = {}) {
  const { directory, plan, profile, state } = installed;
  const report = await inspectRuntimeProfile(profile, { directory, sourceRoot: plan.sourceRoot, load,
    python: plan.python ?? 'python3' });
  const sha256 = await lockDigest(directory);
  const lockMatches = sha256 !== null && (!checkRecordedLock || state.phase !== 'READY' || state.lockSha256 === sha256);
  return { ready: profileReady(report) && lockMatches, lockSha256: sha256, lockMatches, profile: report };
}

/** Recover a completed interrupted attempt before deciding whether npm must run. */
export async function installRuntime({ directory, offline = false, cache = null, npm = 'npm' } = {}) {
  const target = await privateDirectory(directory), lease = await installationLease(target);
  let installed;
  try {
    installed = await readInstall(target);
    const { plan, profile } = installed;
    let state = installed.state;
    if (state.phase === 'READY') {
      const observed = await inspect(installed);
      need(observed.ready, 'RUNTIME_READY_INSTALL_CHANGED',
        'This completed runtime changed. Recover into a new directory to preserve running applications');
      return { status: 'READY', directory: target, reused: true, ...observed,
        sourceRoot: plan.sourceRoot, dependencyRoot: target, entrypoint: plan.entrypoint };
    }
    if (state.phase === 'INSTALLING' || state.phase === 'FAILED') {
      const observed = await inspect(installed, { checkRecordedLock: false });
      if (observed.ready) {
        state = { ...state, phase: 'READY', completedAt: now(), updatedAt: now(),
          lockSha256: observed.lockSha256, recoveredExistingInstall: true };
        await save(target, 'install-state.json', state, true);
        return { status: 'READY', directory: target, recoveredExistingInstall: true, ...observed,
          sourceRoot: plan.sourceRoot, dependencyRoot: target, entrypoint: plan.entrypoint };
      }
    }
    const existingLock = await lockDigest(target);
    const command = existingLock ? 'ci' : 'install';
    const args = [command, '--global=false', '--location=project', '--workspaces=false', '--prefix', target,
      '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps',
      '--install-strategy=hoisted', '--package-lock=true', '--omit=dev',
      ...(offline ? ['--offline'] : []), ...(cache ? ['--cache', resolve(cache)] : [])];
    const attempt = state.attempts + 1, logName = 'install-' + attempt + '-' + randomUUID() + '.log';
    const log = await open(join(target, logName), 'wx', 0o600);
    state = { ...state, phase: 'INSTALLING', attempts: attempt, updatedAt: now(), startedAt: now(),
      command, offline: !!offline, logFile: logName, previousLockSha256: existingLock };
    let result;
    try {
      await save(target, 'install-state.json', state, true);
      result = await subprocess(npm, args, { cwd: target,
        env: { ...process.env, npm_config_update_notifier: 'false' },
        stdio: ['ignore', log.fd, log.fd, lease.fd] });
    } catch (error) {
      throw fail(error.code === 'ENOENT' ? 'RUNTIME_NPM_UNAVAILABLE' : 'RUNTIME_NPM_PROCESS_FAILED');
    } finally { await log.sync().catch(() => {}); await log.close(); }
    if (result.code !== 0) {
      await save(target, 'install-state.json', { ...state, phase: 'FAILED', updatedAt: now(),
        exitCode: result.code, signal: result.signal, error: 'NPM_INSTALL_FAILED' }, true);
      throw fail('RUNTIME_NPM_INSTALL_FAILED', 'npm failed; the private installation log is ' + join(target, logName));
    }
    installed = await readInstall(target);
    const observed = await inspect(installed, { checkRecordedLock: false });
    need(observed.ready, 'RUNTIME_DEPENDENCIES_UNAVAILABLE',
      'Installation finished but the selected versions or native modules are unavailable; inspect this runtime');
    state = { ...state, phase: 'READY', updatedAt: now(), completedAt: now(),
      lockSha256: observed.lockSha256, dependencyCount: profile.dependencies.length, npmExitCode: 0 };
    await save(target, 'install-state.json', state, true);
    return { status: 'READY', directory: target, sourceCommit: plan.source.sourceCommit,
      sourceRoot: plan.sourceRoot, dependencyRoot: target, entrypoint: plan.entrypoint, ...observed };
  } catch (error) {
    if (installed) {
      const latest = await readJson(join(target, 'install-state.json')).catch(() => null);
      if (latest?.phase === 'INSTALLING') await save(target, 'install-state.json', {
        ...latest, phase: 'FAILED', updatedAt: now(), error: error.code ?? 'RUNTIME_INSTALL_FAILED',
      }, true).catch(() => {});
    }
    throw error;
  } finally { await lease.close(); }
}

export async function inspectRuntimeInstall({ directory, load = false, source = false, python } = {}) {
  const installed = await readInstall(directory);
  const observed = await inspect(installed, { load });
  if (source) await unpack(installed.plan.archivePath, installed.plan.archiveSha256,
    join(installed.directory, 'package'), { verify: true, python: python ?? installed.plan.python ?? 'python3' });
  return { status: installed.state.phase, directory: installed.directory,
    installationId: installed.plan.installationId, packageVersion: installed.plan.source.packageVersion,
    sourceCommit: installed.plan.source.sourceCommit, profileId: installed.profile.profileId,
    sourceRoot: installed.plan.sourceRoot, dependencyRoot: installed.directory,
    entrypoint: installed.plan.entrypoint, state: installed.state, ...observed,
    ...(source ? { sourceVerified: true } : {}) };
}

/** New source/dependencies get a new runtime path; the previous one stays runnable. */
export async function upgradeRuntime({ from, directory, archive, sha256, native, features, pins, operator,
  offline = false, cache = null, npm = 'npm', python, install = true } = {}) {
  const previous = await readInstall(from), selection = sourceSelection(previous.profile);
  const prepared = await prepareRuntimeInstall({ directory, archive: archive ?? previous.plan.archivePath,
    sha256: sha256 ?? previous.plan.archiveSha256, from: previous.directory,
    python: python ?? previous.plan.python ?? 'python3',
    native: native ?? selection.native, features: features ?? selection.features,
    operator: operator ?? selection.operator, pins: pins ?? selection.pins });
  // An exact recovery carries the already-resolved transitive lock. A changed
  // profile resolves its own lock in the new directory during the install step.
  if (prepared.profileId === previous.profile.profileId &&
      prepared.sourceCommit === previous.plan.source.sourceCommit && await lockDigest(previous.directory)) {
    const bytes = await regular(join(previous.directory, 'package-lock.json'), 16 * 1024 * 1024);
    const recorded = previous.state.phase === 'READY' ? previous.state.lockSha256 : hash(bytes);
    need(hash(bytes) === recorded, 'RUNTIME_PREVIOUS_LOCK_CHANGED');
    await writeFile(join(resolve(directory), 'package-lock.json'), bytes, { flag: 'wx', mode: 0o600 });
  }
  const result = install ? await installRuntime({ directory, offline, cache, npm }) : prepared;
  return { ...result, previousDirectory: previous.directory,
    comparison: await compareRuntimeInstalls({ before: previous.directory, after: directory }) };
}

/** Recover preparation as well as installation; retained source bytes are rechecked. */
export async function recoverRuntime({ from, directory, offline = false, cache = null,
  npm = 'npm', python, install = true } = {}) {
  const previousDirectory = await privateDirectory(from);
  let previous;
  try { previous = await readInstall(previousDirectory); }
  catch (error) {
    // A complete source/profile is preferred. The original preparation record
    // also covers interrupted extraction or later source damage.
    const preparation = await readJson(join(previousDirectory, 'preparation.json'));
    need(preparation.schema === PREPARATION_SCHEMA && preparation.directory === previousDirectory &&
      preparation.archivePath === join(previousDirectory, 'source.tgz') &&
      /^[a-f0-9]{64}$/.test(preparation.archiveSha256 ?? '') && plain(preparation.selection),
      'RUNTIME_PREPARATION_INVALID');
    let archive = preparation.archivePath;
    try {
      need(hash(await regular(archive, 64 * 1024 * 1024)) === preparation.archiveSha256,
        'RUNTIME_ARCHIVE_HASH_MISMATCH');
    } catch {
      // If archive copying itself was interrupted, retry only the explicitly
      // retained original input, with the same expected digest.
      need(typeof preparation.inputArchive === 'string' && preparation.inputArchive === resolve(preparation.inputArchive),
        'RUNTIME_ORIGINAL_ARCHIVE_REQUIRED');
      archive = preparation.inputArchive;
    }
    const selection = preparation.selection;
    const prepared = await prepareRuntimeInstall({ directory, archive, sha256: preparation.archiveSha256,
      native: selection.native, features: selection.features, pins: selection.pins, operator: selection.operator,
      python: python ?? preparation.python ?? 'python3', from: previousDirectory });
    const result = install ? await installRuntime({ directory, offline, cache, npm }) : prepared;
    return { ...result, previousDirectory, recoveredPreparation: true,
      previousPlanError: error.code ?? 'RUNTIME_PLAN_UNAVAILABLE' };
  }
  return upgradeRuntime({ from: previous.directory, directory, offline, cache, npm, python, install });
}

export async function compareRuntimeInstalls({ before, after }) {
  const [old, current] = await Promise.all([readInstall(before), readInstall(after)]);
  const left = new Map(old.profile.dependencies.map(item => [item.name, item.version]));
  const right = new Map(current.profile.dependencies.map(item => [item.name, item.version]));
  return { before: { directory: old.directory, sourceCommit: old.plan.source.sourceCommit, profileId: old.profile.profileId },
    after: { directory: current.directory, sourceCommit: current.plan.source.sourceCommit, profileId: current.profile.profileId },
    dependencies: [...new Set([...left.keys(), ...right.keys()])].sort().flatMap(name =>
      left.get(name) === right.get(name) ? [] : [{ name, before: left.get(name) ?? null, after: right.get(name) ?? null }]),
    sourceChanged: old.plan.source.sourceCommit !== current.plan.source.sourceCommit,
    profileChanged: old.profile.profileId !== current.profile.profileId };
}

export async function runtimeCommand({ directory, args = [] } = {}) {
  need(Array.isArray(args) && args.every(value => typeof value === 'string' && !value.includes('\0')),
    'RUNTIME_COMMAND_ARGUMENTS_INVALID');
  const installed = await readInstall(directory);
  need(installed.state.phase === 'READY', 'RUNTIME_INSTALL_NOT_READY');
  const observed = await inspect(installed, { load: false });
  need(observed.ready, 'RUNTIME_INSTALL_CHANGED');
  return { executable: process.execPath, args: [installed.plan.entrypoint, ...args],
    cwd: installed.directory, sourceRoot: installed.plan.sourceRoot,
    dependencyRoot: installed.directory, sourceCommit: installed.plan.source.sourceCommit };
}

export async function launchRuntime(options) {
  const command = await runtimeCommand(options);
  const result = await subprocess(command.executable, command.args, { cwd: command.cwd, stdio: 'inherit' });
  return result.code;
}

function installationRunbook(plan, profile) {
  return `# Starforge runtime installation\n\nSource: ${plan.source.sourceCommit}\nPackage: ${plan.source.packageVersion}\nProfile: ${profile.profileId}\n\nRun the maintained runtime-install command with --dir pointing at this directory.\nThe original package is at package/; selected dependencies install in the sibling\nnode_modules/. Native module resolution therefore follows the original source.\n\n1. Run runtime-install install --dir DIRECTORY (add --offline for a populated npm cache).\n2. Run runtime-install inspect --dir DIRECTORY --load.\n3. Run runtime-install run --dir DIRECTORY -- source, then use the original product commands.\n\nThe installation has its own package-lock.json. Interrupted installs resume in this\nsame directory; the kernel lock prevents another npm writer. A completed interrupted\nattempt is adopted when the selected dependencies and lock are already present.\n\nUpgrade or recover into a new directory with runtime-install upgrade/recover --from\nTHIS_DIRECTORY --dir NEW_DIRECTORY. Exact recovery reuses the original dependency\nlock through npm ci. Select the new absolute sourceRoot/dependencyRoot in the\noriginal host/container plan and use its existing stop/start/recovery workflow.\nThe previous runtime remains available for that workflow's rollback.\n\nSource root: ${plan.sourceRoot}\nDependency root: ${plan.dependencyRoot}\nOriginal command: ${plan.entrypoint}\n\nPrivate npm logs remain install-N-UUID.log; install-state.json names the current log. Source, signatures, operator state and\ncredentials belong to their existing original components.\n`;
}
