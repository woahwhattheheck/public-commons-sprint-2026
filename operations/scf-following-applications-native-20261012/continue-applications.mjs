// MIT. Continue D1CC's original following edition through the original Apps receiver.
import { readFile, writeFile, mkdir, lstat, realpath, copyFile, rename, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const need = (value, message) => { if (!value) throw new Error(message); };
const exists = async path => {
  try { await lstat(path); return true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
};
async function save(path, value) {
  const pending = path + '.pending';
  await writeFile(pending, json(value), { mode: 0o600 });
  await rename(pending, path);
}
async function immutable(path, value) {
  const bytes = Buffer.from(json(value));
  if (await exists(path)) need((await readFile(path)).equals(bytes), 'Original continuation selection changed: ' + path);
  else await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
}
async function checked(record) {
  const info = await lstat(record.path);
  need(info.isFile() && !info.isSymbolicLink(), 'Original regular input missing: ' + record.path);
  const bytes = await readFile(record.path);
  need(bytes.length === record.bytes && digest(bytes) === record.sha256, 'Original input changed: ' + record.path);
  return bytes;
}
async function command(executable, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: 'inherit', ...options });
    const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    const detach = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('error', error => { detach(); reject(error); });
    child.once('exit', (code, signal) => {
      detach();
      if (code === 0) accept(); else reject(new Error(executable + ' ended with ' + (signal ?? code)));
    });
  });
}
export async function continueFollowingApplications(config, { onProgress = () => {} } = {}) {
  need(config.schema === 'starforge.following-applications-operation.v1', 'Select the original continuation input');
  const project = resolve(config.projectDirectory);
  need(project !== '/' && project === config.projectDirectory, 'Select the original absolute private project');
  await mkdir(project, { recursive: true, mode: 0o700 });
  const info = await lstat(project);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    await realpath(project) === project, 'The original project must be a real private directory');
  const delivery = join(project, 'delivery');
  await mkdir(delivery, { mode: 0o700, recursive: true });
  let stage = 'INPUTS';
  const progress = value => onProgress({ stage, ...value });
  try {
    const manifestBytes = await readFile(config.sourceInputs);
    need(digest(manifestBytes) === config.sourceInputsSha256, 'The retained source input manifest changed');
    const inputs = JSON.parse(manifestBytes);
    const intentBytes = await readFile(config.sourceIntent);
    need(digest(intentBytes) === config.sourceIntentSha256, 'The original following source intent changed');
    const original = JSON.parse(intentBytes);
    need(original.operationId === config.operationId && original.sourceCommit === config.sourceCommit &&
      original.sourceCommit === inputs.sourceCommit && original.sourceTree === inputs.sourceTree,
    'The original edition identity changed');
    for (const item of inputs.files) {
      const bytes = await checked(item);
      need(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') === item.blob,
        'The selected source Git object changed: ' + item.name);
    }
    for (const [name, record] of Object.entries(inputs.inputs))
      if (name !== 'sourceDonor') await checked(record);
    need((await lstat(inputs.inputs.sourceDonor.path)).isDirectory(), 'The original Git donor is missing');
    const oldPlan = JSON.parse(await readFile(inputs.inputs.priorPlan.path));
    const oldProfile = JSON.parse(await readFile(inputs.inputs.priorProfile.path));
    const oldState = JSON.parse(await readFile(inputs.inputs.priorState.path));
    need(oldPlan.directory === config.previousRuntime && oldPlan.installationId === config.previousInstallationId &&
      oldState.phase === 'READY' && oldState.installationId === oldPlan.installationId &&
      oldProfile.profileId === oldPlan.profileId, 'The original READY runtime identity changed');
    const node = process.execPath;
    const env = { ...process.env, PATH: dirname(node) + ':' + process.env.PATH,
      PYTHONDONTWRITEBYTECODE: '1', npm_config_update_notifier: 'false',
      npm_config_cache: join(project, 'npm-cache') };
    process.env.PATH = env.PATH;
    process.env.npm_config_cache = env.npm_config_cache;
    await immutable(join(project, 'continuation-input.json'), config);
    await immutable(join(project, 'source-inputs.json'), inputs);
    await save(join(project, 'input-receipts.json'), {
      checkedAt: new Date().toISOString(), sourceCommit: config.sourceCommit,
      sourceRunner: inputs.inputs.sourceRunner, sourceDonor: inputs.inputs.sourceDonor,
      previousRuntime: oldPlan.directory, previousInstallationId: oldPlan.installationId,
      previousProfileId: oldProfile.profileId, datasetArchive: inputs.inputs.datasetArchive,
      selectedFeatures: [...new Set([...oldProfile.selection.features, 'schema'])].sort(),
    });
    progress({ phase: 'FOUR_ORIGINAL_INPUTS_AVAILABLE' });

    stage = 'SOURCE';
    const git = join(project, 'source.git');
    if (!(await exists(git))) {
      await exec(config.gitExecutable, ['init', '--bare', '--quiet', git], { env });
      await copyFile(join(original.sourceCache, 'config'), join(git, 'config'));
      await writeFile(join(git, 'objects', 'info', 'alternates'),
        join(original.sourceCache, 'objects') + '\n', { mode: 0o600, flag: 'wx' });
    }
    const alternate = await readFile(join(git, 'objects', 'info', 'alternates'), 'utf8');
    need(alternate === join(original.sourceCache, 'objects') + '\n', 'The retained Git donor changed');
    const selected = { ...original, sourceCache: git, operationRoot: project,
      releaseDirectory: join(project, 'release'), installedDirectory: join(project, 'installed'),
      npmCache: join(project, 'npm-cache'),
      placement: { schema: 'starforge.following-private-placement.v1',
        originalIntent: config.sourceIntent, originalIntentSha256: config.sourceIntentSha256,
        originalSourceCache: original.sourceCache, sourceRunnerSha256: inputs.inputs.sourceRunner.sha256,
        retainedBy: 'original-native-artifact-retention' } };
    const selectedPath = join(project, 'release-intent.json');
    await immutable(selectedPath, selected);
    const { buildDistribution } = await import(pathToFileURL(join(original.builderDirectory, 'build.mjs')));
    if (await exists(selected.releaseDirectory) &&
      !(await exists(join(selected.releaseDirectory, 'distribution.json')))) {
      progress({ phase: 'RESUME_ORIGINAL_BUILD' });
      await buildDistribution({ repository: git, ref: original.sourceCommit, output: selected.releaseDirectory,
        resume: true, python: config.pythonExecutable, onProgress: event => progress({ phase: 'original_builder', ...event }) });
    }
    await command(node, [inputs.inputs.sourceRunner.path, selectedPath], { env, cwd: project });
    const source = JSON.parse(await readFile(join(project, 'installation.json')));
    need(source.state === 'SOURCE_INSTALLED' && source.sourceCommit === config.sourceCommit,
      'The original source installation did not complete');
    const installer = await import(pathToFileURL(join(source.packageRoot, 'source',
      'stellar/scf-starforge-20261009/distribution/runtime-install.mjs')));
    const features = [...new Set([...oldProfile.selection.features, 'schema'])].sort();
    const installOptions = {
      offline: config.dependencyOffline, cache: config.dependencyCache ?? join(project, 'npm-cache'),
      npm: config.npmExecutable, nodeHeaders: null,
    };

    stage = 'RUNTIME';
    let runtimeDirectory = join(project, 'runtime');
    const recovered = join(project, 'runtime-recovered');
    if (await exists(recovered)) runtimeDirectory = recovered;
    const planPath = join(runtimeDirectory, 'runtime-install.json');
    if (await exists(planPath)) {
      const retained = JSON.parse(await readFile(planPath));
      need(retained.source.sourceCommit === config.sourceCommit &&
        retained.archiveSha256 === source.receipt.sha256, 'The retained runtime belongs to another edition');
      await installer.installRuntime({ directory: runtimeDirectory, ...installOptions });
    } else if (await exists(runtimeDirectory)) {
      need(runtimeDirectory !== recovered, 'Continue the retained runtime preparation with its original recovery API');
      const preparation = JSON.parse(await readFile(join(runtimeDirectory, 'preparation.json')));
      need(preparation.archiveSha256 === source.receipt.sha256 &&
        JSON.stringify(preparation.selection.features) === JSON.stringify(features),
      'The retained preparation belongs to another edition or feature selection');
      await installer.recoverRuntime({ from: runtimeDirectory, directory: recovered,
        python: config.pythonExecutable, ...installOptions });
      runtimeDirectory = recovered;
    } else {
      await installer.upgradeRuntime({ from: config.previousRuntime, directory: runtimeDirectory,
        archive: source.receipt.archive, sha256: source.receipt.sha256, features,
        python: config.pythonExecutable, ...installOptions });
    }
    // Preparation already verifies every original archive member. Reopen the
    // maintained plan/profile and load its declared dependency before Applications.
    const runtime = await installer.inspectRuntimeInstall({ directory: runtimeDirectory, load: true });
    need(runtime.status === 'READY' && runtime.ready === true && runtime.sourceCommit === config.sourceCommit,
      'The original runtime is not READY for the selected source');
    const profile = JSON.parse(await readFile(join(runtimeDirectory, 'runtime-profile.json')));
    need(profile.selection.features.includes('schema') &&
      profile.dependencies.some(item => item.name === 're2js' && item.version === '2.8.6'),
    'The original native query dependency is not in the installed profile');
    await command(node, ['--input-type=module', '-e',
      'await import(' + JSON.stringify(pathToFileURL(join(runtime.sourceRoot,
        'stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-handler.mjs')).href) + ');'],
      { env, cwd: runtimeDirectory });
    await save(join(project, 'runtime-ready.json'), runtime);
    progress({ phase: 'READY', installationId: runtime.installationId, profileId: runtime.profileId });

    stage = 'DATASET_COPY';
    const copied = join(project, 'dataset-workspace');
    await command(config.pythonExecutable, [config.datasetCopyHelper,
      inputs.inputs.datasetArchive.path, copied, inputs.inputs.datasetArchive.sha256],
    { env, cwd: project });
    const receiver = inputs.files.find(file => file.name === 'ndjson-applications-receive.mjs');
    need(receiver, 'The original Apps receiver is missing from the selected source inputs');
    const receiving = {
      runtimeDirectory, bootstrapSourceRoot: runtime.sourceRoot, expectedSourceCommit: config.sourceCommit,
      nativeOutcome: join(copied, 'native-outcome.json'), workspaceDirectory: join(copied, 'source-workspace'),
      pythonExecutable: config.pythonExecutable, receivingDirectory: join(project, 'apps-receiving'),
    };
    await immutable(join(project, 'apps-input.json'), receiving);
    stage = 'APPLICATIONS';
    process.env.PATH = env.PATH;
    process.env.PYTHONDONTWRITEBYTECODE = '1';
    const { receiveNdjsonApplications } = await import(pathToFileURL(receiver.path));
    const result = await receiveNdjsonApplications(receiving, {
      onProgress: event => progress({ phase: 'original_applications', ...event }),
    });
    need(result.completedAt && result.passes.length === 2 &&
      result.passes.every(pass => pass.opened && pass.stoppedAt), 'The original Applications receiving is incomplete');
    const outcome = { schema: 'starforge.following-applications-result.v1', status: 'COMPLETED',
      operationId: config.operationId, completedAt: new Date().toISOString(), sourceCommit: config.sourceCommit,
      source, runtime, originalDatasetOperation: config.originalDatasetOperation,
      receiving: result };
    await save(join(project, 'continuation.json'), outcome);
    progress({ phase: 'COMPLETED', applicationId: result.applicationId, sourceCommit: runtime.sourceCommit });
    return outcome;
  } catch (error) {
    await save(join(project, 'continuation-error.json'), {
      operationId: config.operationId, sourceCommit: config.sourceCommit, stage,
      observedAt: new Date().toISOString(), code: error.code ?? null, message: String(error.message),
    }).catch(() => {});
    throw error;
  } finally {
    // The original native artifact collector retains this directory on either
    // outcome, including a completed archive when a later consumer is interrupted.
    for (const name of ['continuation-input.json', 'source-inputs.json', 'input-receipts.json',
      'release-intent.json', 'installation.json', 'operation.json', 'runtime-ready.json',
      'apps-input.json', 'continuation.json', 'continuation-error.json', 'operation-error.json']) {
      if (await exists(join(project, name)))
        await copyFile(join(project, name), join(delivery, name));
    }
    const receiptPath = join(project, 'release', 'distribution.json');
    if (await exists(receiptPath)) {
      const receipt = JSON.parse(await readFile(receiptPath));
      await copyFile(receiptPath, join(delivery, 'distribution.json'));
      if (await exists(receipt.archive))
        await copyFile(receipt.archive, join(delivery, 'source.tgz'));
    }
    for (const name of ['runtime', 'runtime-recovered']) if (await exists(join(project, name))) {
      const target = join(delivery, name);
      await mkdir(target, { recursive: true, mode: 0o700 });
      for (const file of ['runtime-install.json', 'runtime-profile.json', 'install-state.json',
        'package.json', 'package-lock.json', 'preparation.json', 'prepare-error.json', 'RUNBOOK.md'])
        if (await exists(join(project, name, file)))
          await copyFile(join(project, name, file), join(target, file));
    }
    if (await exists(join(project, 'apps-receiving')))
      await cp(join(project, 'apps-receiving'), join(delivery, 'apps-receiving'), { recursive: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  await continueFollowingApplications(config, {
    onProgress: value => process.stdout.write(JSON.stringify(value) + '\n'),
  });
}
