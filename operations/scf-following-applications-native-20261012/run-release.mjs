import { readFile, writeFile, mkdir, rename, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const intentPath = resolve(process.argv[2]);
const intent = JSON.parse(await readFile(intentPath, 'utf8'));
const npmWriteCache = join(intent.operationRoot, 'npm-cache');
process.env.npm_config_cache = npmWriteCache;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const json = value => JSON.stringify(value, null, 2) + '\n';
const exists = path => lstat(path).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
async function save(name, value) {
  const path = join(intent.operationRoot, name), pending = path + '.pending';
  await writeFile(pending, json(value), { mode: 0o600 });
  await rename(pending, path);
}
async function execute(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    const detach = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('error', error => { detach(); reject(error); });
    child.once('exit', (code, signal) => {
      detach();
      if (code === 0) accept();
      else reject(new Error(command + ' ended with ' + (signal ?? code)));
    });
  });
}
async function verifyInstallation(packageRoot, receipt) {
  const manifestBytes = await readFile(join(packageRoot, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.sourceCommit !== intent.sourceCommit || manifest.packageVersion !== receipt.packageVersion)
    throw new Error('Installed source/version differs from the frozen archive');
  const canonicalRoot = await realpath(packageRoot);
  let bytes = 0;
  const entries = [...manifest.files, ...Object.entries(manifest.packageFiles).map(([path, sha256]) => ({ path, sha256 }))];
  for (const entry of entries) {
    const path = resolve(packageRoot, entry.packagePath ?? entry.path);
    if (!path.startsWith(canonicalRoot + sep) || await realpath(path) !== path)
      throw new Error('Installed manifest entry escaped its immutable package: ' + entry.path);
    const info = await lstat(path);
    if (!info.isFile() || entry.bytes !== undefined && info.size !== entry.bytes)
      throw new Error('Installed file size/type differs: ' + entry.path);
    const content = await readFile(path);
    if (hash(content) !== entry.sha256) throw new Error('Installed bytes differ: ' + entry.path);
    bytes += content.length;
  }
  const spec = JSON.parse(await readFile(join(packageRoot, 'source/stellar/scf-starforge-20261009/distribution/distribution.json')));
  return { manifestSha256: hash(manifestBytes), sourceFiles: manifest.files.length,
    packageFiles: Object.keys(manifest.packageFiles).length, verifiedBytes: bytes, components: manifest.components.length,
    commands: Object.keys(spec.commands).length, exports: Object.keys(spec.exports).length };
}

try {
  if (intent.schema !== 'starforge.following-source-release-operation.v1' || !/^[0-9a-f]{40}$/.test(intent.sourceCommit))
    throw new Error('Unknown frozen source intent');
  for (const file of intent.builderFiles) {
    const bytes = await readFile(join(intent.builderDirectory, file.name));
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
      throw new Error('Selected original builder changed: ' + file.name);
  }
  const { buildDistribution } = await import(pathToFileURL(join(intent.builderDirectory, 'build.mjs')));
  const receiptPath = join(intent.releaseDirectory, 'distribution.json');
  let receipt;
  if (await exists(receiptPath)) {
    receipt = JSON.parse(await readFile(receiptPath));
    output({ phase: 'retained_original_archive', archive: receipt.archive });
  } else {
    if (await exists(intent.releaseDirectory)) throw new Error('Retain and reconcile the original partial build directory');
    await save('operation.json', { state: 'BUILDING', sourceCommit: intent.sourceCommit, intentPath });
    receipt = await buildDistribution({ repository: intent.sourceCache, ref: intent.sourceCommit,
      output: intent.releaseDirectory, onProgress: event => output({ phase: 'original_builder', ...event }) });
  }
  if (receipt.status !== 'PACKAGED' || receipt.sourceCommit !== intent.sourceCommit)
    throw new Error('Original package receipt differs from the selected source');
  const archive = await readFile(receipt.archive);
  if (archive.length !== receipt.archiveBytes || hash(archive) !== receipt.sha256)
    throw new Error('Original archive differs from its completed receipt');
  const packageRoot = join(intent.installedDirectory, 'node_modules/@tokenjunkielabs/starforge-merchant');
  if (!(await exists(join(packageRoot, 'manifest.json')))) {
    await mkdir(intent.installedDirectory, { recursive: true });
    await save('operation.json', { state: 'INSTALLING_ORIGINAL_ARCHIVE', sourceCommit: intent.sourceCommit, receipt });
    await execute('npm', ['install', '--prefix', intent.installedDirectory, '--offline', '--ignore-scripts',
      '--omit=optional', '--legacy-peer-deps', '--no-audit', '--no-fund', '--package-lock=false',
      '--cache', npmWriteCache, receipt.archive], { cwd: intent.installedDirectory });
  }
  const verified = await verifyInstallation(packageRoot, receipt);
  const result = { state: 'SOURCE_INSTALLED', completedAt: new Date().toISOString(), sourceCommit: intent.sourceCommit,
    sourceTree: intent.sourceTree, packageRoot, npmWriteCache, receipt, ...verified };
  await save('installation.json', result);
  await save('operation.json', result);
  output(result);
} catch (error) {
  const failure = { state: 'RECONCILE_CURRENT_PHASE', sourceCommit: intent.sourceCommit,
    observedAt: new Date().toISOString(), error: error.message };
  try { await save('operation-error.json', failure); } catch {}
  output(failure);
  process.exitCode = 1;
}
