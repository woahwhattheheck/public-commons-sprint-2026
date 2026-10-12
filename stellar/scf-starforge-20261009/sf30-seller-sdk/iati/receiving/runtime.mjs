// MIT. Prepare the complete IATI operator through the maintained source and runtime APIs.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { operationLease, saveJSON, canonical, need } from '../../../distribution/runtime-workspace/storage.mjs';

const run = promisify(execFile);
const PREFIX = 'stellar/scf-starforge-20261009/';
const DISTRIBUTION = PREFIX + 'distribution/';
const IATI = PREFIX + 'sf30-seller-sdk/iati/';
const SCHEMA = 'stellar-forge.iati-runtime-preparation.v1';
const RESULT = 'stellar-forge.iati-runtime-ready.v1';
const SELECTION = 'iati-operator';
const PROFILE = { native: false, features: [], pins: {}, operator: true };
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const json = value => JSON.stringify(value, null, 2) + '\n';
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const ownRoot = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const bootstrapNames = [
  'build.mjs', 'build-state.mjs', 'git-source.mjs', 'browser-assets.mjs',
  'product-package.mjs', 'specification.mjs', 'source-selection.mjs', 'runtime-unpack.py',
  'git-object-receiving.py', 'runtime-workspace/storage.mjs',
];
const criticalPaths = [
  ...['DOMAIN.md', 'OPERATIONS.md', 'README.md', 'cli.mjs', 'cli.py', 'client.d.mts', 'client.mjs',
    'iati_source.py', 'iati_workspace.py', 'managed.py', 'server.py',
    'public/app.js', 'public/index.html', 'public/style.css'].map(name => IATI + name),
  DISTRIBUTION + 'contributions/iati.json',
  DISTRIBUTION + 'runtime-workspace/application-iati.mjs',
  DISTRIBUTION + 'runtime-workspace/providers/iati.mjs',
  'stellar-forge/mcp-merchant-operator/SOURCE_WORKSPACES.md',
  'stellar-forge/mcp-merchant-operator/catalog/source-workspace.mjs',
  'stellar-forge/mcp-merchant-operator/source-workspace.mjs',
  ...['xml_source.py', 'workspace.py', 'server.py', 'native.mjs']
    .map(name => PREFIX + 'sf30-seller-sdk/xml/' + name),
  PREFIX + 'sf30-seller-sdk/dataset-handler.mjs',
];

function absolute(value, name) {
  need(typeof value === 'string' && value === resolve(value) && value !== '/' && !value.includes('\0'),
    'IATI_RUNTIME_ABSOLUTE_PATH_REQUIRED', name + ' must be an absolute selected path.');
  return value;
}
const inside = (path, root) => path === root || path.startsWith(root + '/');
async function info(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directory(path, create = false, privateMode = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const entry = await lstat(path);
  need(entry.isDirectory() && !entry.isSymbolicLink() && await realpath(path) === path,
    'IATI_RUNTIME_REAL_DIRECTORY_REQUIRED', path);
  if (privateMode) need(!(entry.mode & 0o077) &&
    (!process.getuid || entry.uid === process.getuid()), 'IATI_RUNTIME_PRIVATE_DIRECTORY_REQUIRED', path);
  return path;
}
async function bytes(path, maximum = 4 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum, 'IATI_RUNTIME_REGULAR_FILE_REQUIRED', path);
    const data = await handle.readFile(), last = await handle.stat(), named = await lstat(path);
    need(data.length === first.size && last.size === first.size &&
      first.dev === named.dev && first.ino === named.ino &&
      first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs,
    'IATI_RUNTIME_FILE_CHANGED', path);
    return data;
  } finally { await handle.close(); }
}
async function record(path, optional = false) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(path, 8 * 1024 * 1024))); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
async function fileIdentity(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat();
    need(first.isFile(), 'IATI_RUNTIME_REGULAR_FILE_REQUIRED', path);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { size += chunk.length; hash.update(chunk); }
    const last = await handle.stat(), named = await lstat(path);
    need(size === first.size && last.size === first.size && first.dev === named.dev && first.ino === named.ino &&
      first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs, 'IATI_RUNTIME_FILE_CHANGED', path);
    return { path, bytes: size, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
// The original output lease covers this rename. No hard link or partial final
// metadata is created; retained .pending files never replace selected inputs.
async function immutable(path, value) {
  const current = await record(path, true);
  if (current !== null) {
    need(same(current, value), 'IATI_RUNTIME_INPUT_CHANGED', path);
    return current;
  }
  await saveJSON(path, value, true);
  const saved = await record(path);
  need(same(saved, value), 'IATI_RUNTIME_INPUT_CHANGED', path);
  return saved;
}
function receivingInput(value, repository) {
  if (value === undefined || value === null) return null;
  need(value && typeof value === 'object' && !Array.isArray(value),
    'IATI_RUNTIME_SOURCE_RECEIVING_REQUIRED');
  const selection = {
    directory: absolute(value.directory, 'sourceReceiving.directory'),
    metadata: absolute(value.metadata, 'sourceReceiving.metadata'),
    donorRepositories: value.donorRepositories ?? [], donorSources: value.donorSources ?? [],
    donorArchives: value.donorArchives ?? [], incoming: value.incoming ?? [],
  };
  need(repository === join(selection.directory, 'repository.git'),
    'IATI_RUNTIME_SOURCE_CACHE_CHANGED', 'Use the original receiver-owned repository.git.');
  for (const key of ['donorRepositories', 'donorSources', 'incoming']) {
    need(Array.isArray(selection[key]) && selection[key].length <= 128, 'IATI_RUNTIME_DONORS_INVALID');
    selection[key] = selection[key].map(path => absolute(path, key));
  }
  need(Array.isArray(selection.donorArchives) && selection.donorArchives.length <= 32, 'IATI_RUNTIME_DONORS_INVALID');
  selection.donorArchives = selection.donorArchives.map(value => {
    need(value && typeof value === 'object' && SHA.test(value.sha256 ?? ''), 'IATI_RUNTIME_DONOR_ARCHIVE_INVALID');
    return { path: absolute(value.path, 'archive donor'), sha256: value.sha256 };
  });
  for (const path of [...selection.donorRepositories, ...selection.donorSources, ...selection.incoming,
    ...selection.donorArchives.map(value => value.path)])
    need(!inside(path, selection.directory) && !inside(selection.directory, path),
      'IATI_RUNTIME_SOURCE_DONOR_OVERLAP', path);
  return selection;
}

/**
 * Build and install one committed IATI operator source selection.
 *
 * The caller owns the single native foreground. This function creates no
 * scheduler or application process. Existing source donors remain read-only.
 * Same outputDirectory/operationId/input continues the original build and the
 * latest installer attempt. Original prepare/recover/install APIs own runtime
 * state; readiness is returned only after their full source/profile/lock checks.
 */
export async function prepareIatiOperatorRuntime({
  repository, sourceRoot = ownRoot, sourceCommit, outputDirectory, operationId,
  pythonExecutable = 'python3', npmExecutable = 'npm', sourceOffline = true,
  dependencyOffline = true, sourceReceiving, onProgress = () => {},
} = {}) {
  for (const [name, value] of Object.entries({ repository, sourceRoot, outputDirectory })) absolute(value, name);
  need(COMMIT.test(sourceCommit ?? '') && typeof operationId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(operationId), 'IATI_RUNTIME_SOURCE_AND_OPERATION_REQUIRED');
  need(typeof sourceOffline === 'boolean' && typeof dependencyOffline === 'boolean' &&
    typeof onProgress === 'function', 'IATI_RUNTIME_OPTIONS_INVALID');
  for (const [name, value] of Object.entries({ pythonExecutable, npmExecutable }))
    need(typeof value === 'string' && value && !value.includes('\0'), 'IATI_RUNTIME_EXECUTABLE_REQUIRED', name);
  sourceRoot = await directory(sourceRoot);
  need(await realpath(ownRoot) === sourceRoot, 'IATI_RUNTIME_BOOTSTRAP_LOCATION_CHANGED',
    'Invoke the preparation module from the selected original sourceRoot.');
  need(!inside(outputDirectory, sourceRoot) && !inside(sourceRoot, outputDirectory) &&
    !inside(outputDirectory, repository) && !inside(repository, outputDirectory),
  'IATI_RUNTIME_SEPARATE_OUTPUT_REQUIRED');
  const receiving = receivingInput(sourceReceiving, repository);
  for (const donor of receiving ? [...receiving.donorRepositories, ...receiving.donorSources,
    ...receiving.incoming, ...receiving.donorArchives.map(value => value.path)] : [])
    need(!inside(outputDirectory, donor) && !inside(donor, outputDirectory),
      'IATI_RUNTIME_SEPARATE_OUTPUT_REQUIRED', donor);
  await directory(outputDirectory, true, true);
  const lease = await operationLease(join(outputDirectory, 'preparation.lock'));
  let stage = 'SOURCE', source, distribution, runtimeDirectory, sequence = 0;
  const progress = value => onProgress({ stage, operationId, sourceCommit, ...value });
  try {
    const input = { schema: SCHEMA, operationId, sourceCommit, sourceRoot, repository, outputDirectory,
      selection: SELECTION, profile: PROFILE, pythonExecutable, npmExecutable, sourceOffline, dependencyOffline,
      sourceReceiving: receiving ? { ...receiving, metadataIdentity: await fileIdentity(receiving.metadata) } : null };
    await immutable(join(outputDirectory, 'input.json'), input);
    const bootstrap = [];
    for (const path of [...bootstrapNames.map(name => DISTRIBUTION + name), IATI + 'receiving/runtime.mjs']) {
      const data = await bytes(join(sourceRoot, path), 2 * 1024 * 1024);
      bootstrap.push({ path, gitBlob: gitBlob(data), bytes: data.length, sha256: sha256(data) });
    }
    await immutable(join(outputDirectory, 'bootstrap.json'), { sourceCommit, files: bootstrap });
    const additionalPaths = new Set(await record(join(outputDirectory, 'source-additions.json'), true) ?? []);
    const sourceReceipts = await record(join(outputDirectory, 'source-receipts.json'), true) ?? [];
    sequence = sourceReceipts.length;
    async function acquireSource() {
      if (!receiving) return;
      const argv = [join(sourceRoot, DISTRIBUTION + 'git-object-receiving.py'),
        '--metadata', receiving.metadata, '--commit', sourceCommit, '--directory', receiving.directory];
      for (const [key, flag] of [['donorRepositories', '--donor-repository'],
        ['donorSources', '--donor-source'], ['incoming', '--incoming']])
        for (const path of receiving[key]) argv.push(flag, path);
      for (const donor of receiving.donorArchives) argv.push('--donor-archive', donor.sha256, donor.path);
      for (const path of [...additionalPaths].sort()) argv.push('--additional-path', path);
      const selected = { index: sequence++, executable: pythonExecutable, argv, selectedAt: new Date().toISOString() };
      sourceReceipts.push(selected);
      await saveJSON(join(outputDirectory, 'source-receipts.json'), sourceReceipts, true);
      let result;
      try {
        const value = await run(pythonExecutable, argv, { maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
        result = { exitCode: 0, stdout: value.stdout, stderr: value.stderr };
      } catch (error) {
        result = { exitCode: Number.isInteger(error.code) ? error.code : null,
          error: typeof error.code === 'string' ? error.code : null,
          stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
      }
      await saveJSON(join(outputDirectory, 'source-result-' + String(selected.index).padStart(4, '0') + '.json'),
        { ...selected, completedAt: new Date().toISOString(), ...result }, true);
      if (result.exitCode !== 0) throw Object.assign(new Error('Continue the original source receiving cache and missing-objects.json.'), {
        code: result.exitCode === 2 ? 'IATI_RUNTIME_SOURCE_NEEDED' : 'IATI_RUNTIME_SOURCE_RECEIVING_FAILED',
        missingObjectsFile: join(receiving.directory, 'missing-objects.json'),
        sourceReceivingDirectory: receiving.directory, sourceCommit,
      });
      progress({ phase: 'SOURCE_RECEIVED', receivingDirectory: receiving.directory });
    }
    if (receiving) await acquireSource();
    await directory(repository);
    const { openGitSource } = await import(pathToFileURL(join(sourceRoot, DISTRIBUTION + 'git-source.mjs')).href);
    source = openGitSource({ repository, ref: sourceCommit, offline: sourceOffline, onProgress: progress });
    need(source.commit === sourceCommit, 'IATI_RUNTIME_SOURCE_CHANGED');
    const byPath = new Map(source.tree.map(item => [item.path, item]));
    for (const item of bootstrap) need(byPath.get(item.path)?.blob === item.gitBlob,
      'IATI_RUNTIME_BOOTSTRAP_CHANGED', item.path);
    const { buildDistribution } = await import(pathToFileURL(join(sourceRoot, DISTRIBUTION + 'build.mjs')).href);
    const releaseDirectory = join(outputDirectory, 'release');
    for (;;) {
      try {
        distribution = await buildDistribution({ repository, ref: sourceCommit, output: releaseDirectory,
          selection: SELECTION, resume: !!await info(releaseDirectory), offline: sourceOffline,
          python: pythonExecutable, onProgress: progress });
        break;
      } catch (error) {
        if (!receiving || error.code !== 'MISSING_SOURCE_OBJECTS' || !Array.isArray(error.missingObjects)) throw error;
        const missing = new Set(error.missingObjects);
        const requested = source.tree.filter(item => missing.has(item.blob)).map(item => item.path);
        need(requested.length > 0, 'IATI_RUNTIME_MISSING_SOURCE_IDENTITY');
        const previousCount = additionalPaths.size;
        for (const path of requested) additionalPaths.add(path);
        need(additionalPaths.size > previousCount, 'IATI_RUNTIME_SOURCE_NEEDED',
          'The original missing source body is still unavailable in the selected cache.');
        await saveJSON(join(outputDirectory, 'source-additions.json'), [...additionalPaths].sort(), true);
        await acquireSource();
      }
    }
    need(distribution.status === 'PACKAGED' && distribution.sourceCommit === sourceCommit &&
      distribution.sourceSelection?.id === SELECTION && SHA.test(distribution.sha256 ?? ''),
    'IATI_RUNTIME_DISTRIBUTION_INCOMPLETE');
    const archive = await fileIdentity(distribution.archive);
    need(archive.bytes === distribution.archiveBytes && archive.sha256 === distribution.sha256,
      'IATI_RUNTIME_ARCHIVE_CHANGED');
    await saveJSON(join(outputDirectory, 'source-release.json'), distribution, true);
    const packageDirectory = join(releaseDirectory, 'package');
    const manifestBytes = await bytes(join(packageDirectory, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes), sourceManifestSha256 = sha256(manifestBytes);
    need(manifest.schema === 'stellar-forge.merchant-distribution-manifest.v1' &&
      manifest.sourceCommit === sourceCommit && manifest.sourceSelection?.id === SELECTION,
    'IATI_RUNTIME_SOURCE_MANIFEST_CHANGED');
    const inventory = new Map(manifest.files.map(item => [item.path, item]));
    const packagedRoot = join(packageDirectory, 'source');
    const critical = [];
    for (const path of criticalPaths) {
      const expected = inventory.get(path), original = byPath.get(path);
      need(expected && original && expected.gitBlob === original.blob,
        'IATI_RUNTIME_ORIGINAL_COMPONENT_MISSING', path);
      const data = await bytes(join(packagedRoot, path), 2 * 1024 * 1024);
      need(data.length === expected.bytes && sha256(data) === expected.sha256 && gitBlob(data) === original.blob,
        'IATI_RUNTIME_COMPONENT_CHANGED', path);
      critical.push({ path, gitBlob: original.blob, sha256: expected.sha256, bytes: expected.bytes });
    }
    await immutable(join(outputDirectory, 'selected-source.json'), {
      sourceCommit, sourceManifestSha256, sourceSelection: manifest.sourceSelection,
      contributions: manifest.distributionContributions, critical,
    });

    stage = 'RUNTIME';
    const installer = await import(pathToFileURL(join(packagedRoot, DISTRIBUTION + 'runtime-install.mjs')).href);
    const { inspectMerchantRuntime } = await import(pathToFileURL(join(packagedRoot,
      PREFIX + 'sf46-release/runtime-package.mjs')).href);
    const finished = await record(join(outputDirectory, 'runtime-ready.json'), true);
    async function ready(directory) {
      const plan = await record(join(directory, 'runtime-install.json'));
      const profile = await record(join(directory, 'runtime-profile.json'));
      need(plan.source?.sourceCommit === sourceCommit && plan.archiveSha256 === distribution.sha256 &&
        same(profile.selection, PROFILE), 'IATI_RUNTIME_SELECTION_CHANGED');
      const inspected = await installer.inspectRuntimeInstall({ directory, load: true, source: true, python: pythonExecutable });
      need(inspected.status === 'READY' && inspected.ready === true && inspected.lockMatches === true &&
        inspected.sourceVerified === true, 'IATI_RUNTIME_NOT_READY');
      const binding = await inspectMerchantRuntime(directory, { load: false, source: true, expectedManifest: sourceManifestSha256 });
      need(binding.state === 'READY' && binding.sourceCommit === sourceCommit && binding.dependencyCount === 0 &&
        binding.sourceManifestSha256 === sourceManifestSha256 && same(binding.selection, PROFILE),
      'IATI_RUNTIME_BINDING_CHANGED');
      for (const item of critical) {
        const value = await fileIdentity(join(binding.sourceRoot, item.path));
        need(value.bytes === item.bytes && value.sha256 === item.sha256,
          'IATI_RUNTIME_INSTALLED_COMPONENT_CHANGED', item.path);
      }
      return { inspected, binding };
    }
    if (finished) {
      need(finished.schema === RESULT && finished.operationId === operationId &&
        finished.sourceCommit === sourceCommit && finished.sourceManifestSha256 === sourceManifestSha256,
      'IATI_RUNTIME_COMPLETION_CHANGED');
      const observed = await ready(finished.runtimeDirectory);
      need(same(observed.binding, finished.runtime), 'IATI_RUNTIME_COMPLETION_CHANGED');
      return { ...finished, reused: true };
    }
    const installations = join(outputDirectory, 'installations');
    await directory(installations, true, true);
    const attemptsFile = join(outputDirectory, 'installation-attempts.json');
    let attempts = await record(attemptsFile, true) ?? [];
    need(Array.isArray(attempts) && attempts.length <= 1024, 'IATI_RUNTIME_ATTEMPTS_INVALID');
    for (let index = 0; index < attempts.length; index++)
      need(attempts[index].index === index && attempts[index].directory ===
        join(installations, 'runtime-' + String(index + 1).padStart(4, '0')),
      'IATI_RUNTIME_ATTEMPTS_CHANGED');
    async function selectAttempt(from = null, recovery = false, reason = null) {
      const index = attempts.length;
      need(index < 1024, 'IATI_RUNTIME_ATTEMPTS_FULL');
      const selected = { index, directory: join(installations, 'runtime-' + String(index + 1).padStart(4, '0')),
        from, recovery, reason, selectedAt: new Date().toISOString() };
      need(!await info(selected.directory), 'IATI_RUNTIME_UNSELECTED_INSTALLATION_EXISTS', selected.directory);
      attempts.push(selected);
      await saveJSON(attemptsFile, attempts, true);
      return selected;
    }
    let attempt = attempts.at(-1) ?? await selectAttempt();
    let existing = await info(attempt.directory), resumable = false;
    if (existing) {
      await directory(attempt.directory, false, true);
      try {
        const plan = await record(join(attempt.directory, 'runtime-install.json'));
        const profile = await record(join(attempt.directory, 'runtime-profile.json'));
        need(plan.source?.sourceCommit === sourceCommit && plan.archiveSha256 === distribution.sha256 &&
          same(profile.selection, PROFILE), 'IATI_RUNTIME_SELECTION_CHANGED');
        await installer.inspectRuntimeInstall({ directory: attempt.directory, load: false, source: false });
        resumable = true;
      } catch (error) {
        if (error.code === 'IATI_RUNTIME_SELECTION_CHANGED') throw error;
        let preparation = null;
        try { preparation = await record(join(attempt.directory, 'preparation.json')); } catch {}
        if (preparation) need(preparation.archiveSha256 === distribution.sha256 &&
          same(preparation.selection, PROFILE) && preparation.directory === attempt.directory,
        'IATI_RUNTIME_SELECTION_CHANGED');
        const retained = { at: new Date().toISOString(), directory: attempt.directory,
          code: error.code ?? 'IATI_RUNTIME_INCOMPLETE_PREPARATION',
          message: String(error.message), originalPreparationAvailable: !!preparation };
        await saveJSON(join(outputDirectory, 'preparation-interruption-' +
          String(attempt.index + 1).padStart(4, '0') + '.json'), retained, true);
        // The original installer recovers valid partial preparations in a new
        // directory. If its FIRST record was interrupted, this caller's saved
        // archive/profile intent supplies the same original prepare call.
        // Every byte in the previous attempt remains in place.
        attempt = await selectAttempt(attempt.directory, !!preparation, retained.code);
        existing = null;
      }
    }
    runtimeDirectory = attempt.directory;
    if (!existing && !resumable) {
      if (attempt.recovery) await installer.recoverRuntime({ from: attempt.from, directory: runtimeDirectory,
        install: false, python: pythonExecutable });
      else await installer.prepareRuntimeInstall({ directory: runtimeDirectory, archive: distribution.archive,
        sha256: distribution.sha256, ...PROFILE, python: pythonExecutable, from: attempt.from });
    }
    const installed = await installer.installRuntime({ directory: runtimeDirectory, offline: dependencyOffline,
      cache: join(outputDirectory, 'npm-cache'), npm: npmExecutable });
    need(installed.status === 'READY', 'IATI_RUNTIME_NOT_READY');
    const observed = await ready(runtimeDirectory);
    const outcome = {
      schema: RESULT, state: 'READY', operationId, completedAt: new Date().toISOString(),
      sourceCommit, sourceManifestSha256, sourceSelection: manifest.sourceSelection,
      installationDirectory: runtimeDirectory, runtimeDirectory,
      sourceRoot: observed.binding.sourceRoot, dependencyRoot: observed.binding.dependencyRoot,
      installationId: observed.binding.installationId, profileId: observed.binding.profileId,
      runtime: observed.binding, inspection: observed.inspected, distribution, archive,
      criticalSources: critical, preparationAttempts: attempts,
      records: {
        input: join(outputDirectory, 'input.json'), source: join(outputDirectory, 'selected-source.json'),
        sourceRelease: join(outputDirectory, 'source-release.json'),
        attempts: attemptsFile, ready: join(outputDirectory, 'runtime-ready.json'),
      },
    };
    await immutable(join(outputDirectory, 'runtime-ready.json'), outcome);
    progress({ phase: 'READY', installationId: outcome.installationId, profileId: outcome.profileId,
      sourceManifestSha256, runtimeDirectory });
    return outcome;
  } catch (error) {
    await saveJSON(join(outputDirectory, 'preparation-error.json'), {
      schema: SCHEMA, operationId, sourceCommit, stage, observedAt: new Date().toISOString(),
      code: error.code ?? 'IATI_RUNTIME_PREPARATION_FAILED', message: String(error.message),
      ...(error.missingObjects ? { missingObjects: error.missingObjects } : {}),
      ...(error.missingObjectsFile ? { missingObjectsFile: error.missingObjectsFile } : {}),
      ...(runtimeDirectory ? { runtimeDirectory } : {}),
    }, true).catch(() => {});
    throw error;
  } finally { await lease.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && ['--help', '-h', 'help'].includes(process.argv[2])) {
    process.stdout.write('node runtime.mjs /absolute/iati-runtime-input.json\n' +
      'The original builder, installer and source/profile/lock inspection return the READY runtime.\n');
  } else {
    need(process.argv.length === 3, 'IATI_RUNTIME_INPUT_FILE_REQUIRED',
      'node runtime.mjs /absolute/iati-runtime-input.json');
    const input = await record(absolute(process.argv[2], 'input file'));
    const result = await prepareIatiOperatorRuntime({ ...input,
      onProgress: event => process.stderr.write(json(event)) });
    process.stdout.write(json(result));
  }
}
