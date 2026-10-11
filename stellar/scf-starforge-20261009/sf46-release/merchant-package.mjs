// MIT. Keep a maintained npm source package in the original SF46 lifecycle.
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_SCHEMA, MANIFEST, MAX_BYTES, canonical, sha256, relativePath,
  plainDirectory, boundedFile, putFile, verifyRelease } from './release-core.mjs';
import { CATALOG_PATH, DOCTOR_PATH, compileCommandCatalog } from './command-catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_SCHEMA = 'stellar-forge.merchant-distribution-manifest.v1';
const PACKAGE_NAME = '@tokenjunkielabs/starforge-merchant';
const REPOSITORY = 'https://github.com/woahwhattheheck/public-commons-sprint-2026';
const BASE = 'stellar/scf-starforge-20261009/sf46-release/';
const SHA = /^[0-9a-f]{64}$/;
const PIN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const gitBlob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function dependencies(value, label, { pinned = true } = {}) {
  if (!record(value)) throw new Error('Invalid package ' + label);
  const result = Object.create(null);
  for (const [name, version] of Object.entries(value)) {
    if (!PACKAGE.test(name) || typeof version !== 'string' || !version || version.length > 200 ||
        /[\x00-\x1f\x7f]/.test(version) || pinned && !PIN.test(version))
      throw new Error('Invalid dependency in ' + label);
    result[name] = version;
  }
  return result;
}
function same(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) throw new Error('Package ' + label + ' differs from its source');
}
function exportPaths(value) {
  if (typeof value === 'string') return [value];
  if (!record(value)) throw new Error('Invalid package export');
  return Object.values(value).flatMap(exportPaths);
}

async function readPackage(packageDirectory, { expectedManifest } = {}) {
  if (expectedManifest !== undefined && !SHA.test(expectedManifest))
    throw new Error('Expected manifest must be a SHA-256 digest');
  const root = await plainDirectory(packageDirectory);
  const manifestBytes = await boundedFile(root, 'manifest.json', 4 * 1024 * 1024);
  const sourceManifestSha256 = sha256(manifestBytes);
  if (expectedManifest && expectedManifest !== sourceManifestSha256)
    throw new Error('Merchant package manifest digest mismatch');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== PACKAGE_SCHEMA || manifest.packageName !== PACKAGE_NAME ||
      manifest.sourceRepository !== REPOSITORY || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? '') ||
      !PIN.test(manifest.packageVersion ?? '') || !Array.isArray(manifest.files) ||
      !manifest.files.length || manifest.files.length > 10000 ||
      !Number.isSafeInteger(manifest.sourceBytes) || manifest.sourceBytes < 0 ||
      manifest.sourceBytes > MAX_BYTES || !record(manifest.packageFiles))
    throw new Error('Invalid maintained merchant package manifest');
  same(Object.keys(manifest.packageFiles).sort(), ['LICENSE', 'README.md', 'package.json'], 'root file inventory');
  const bytesByPath = new Map([['manifest.json', manifestBytes]]);
  const files = [{ path: 'manifest.json', bytes: manifestBytes.length,
    sha256: sourceManifestSha256, mode: 0o644 }];
  const sourcePaths = new Set();
  let sourceBytes = 0, packageBytes = manifestBytes.length;
  for (const file of manifest.files) {
    const path = relativePath(file.path), packagePath = relativePath(file.packagePath);
    if (packagePath !== 'source/' + path || sourcePaths.has(path) || bytesByPath.has(packagePath) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !['100644', '100755'].includes(file.mode) ||
        !SHA.test(file.sha256 ?? '') || !/^[0-9a-f]{40}$/.test(file.gitBlob ?? '') ||
        (sourceBytes += file.bytes) > MAX_BYTES || (packageBytes += file.bytes) > MAX_BYTES)
      throw new Error('Invalid merchant source entry: ' + path);
    const bytes = await boundedFile(root, packagePath, file.bytes);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256 || gitBlob(bytes) !== file.gitBlob)
      throw new Error('Merchant package source differs: ' + path);
    sourcePaths.add(path); bytesByPath.set(packagePath, bytes);
    files.push({ path: packagePath, bytes: file.bytes, sha256: file.sha256,
      gitBlob: file.gitBlob, mode: file.mode === '100755' ? 0o755 : 0o644 });
  }
  if (sourceBytes !== manifest.sourceBytes) throw new Error('Merchant package source size differs');
  for (const [name, hash] of Object.entries(manifest.packageFiles)) {
    if (!SHA.test(hash ?? '')) throw new Error('Invalid merchant package root digest');
    const bytes = await boundedFile(root, name);
    if (sha256(bytes) !== hash) throw new Error('Merchant package root differs: ' + name);
    packageBytes += bytes.length;
    if (packageBytes > MAX_BYTES) throw new Error('Merchant package exceeds size limit');
    bytesByPath.set(name, bytes);
    files.push({ path: name, bytes: bytes.length, sha256: hash, mode: 0o644 });
  }
  const mutableEntries = [];
  async function inspectDirectory(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      // Match the original SF46 installation's explicitly separate dependency
      // tree. Only declared original package bytes are copied into a release.
      if (!prefix && ['node_modules', 'package-lock.json'].includes(entry.name)) {
        mutableEntries.push(entry.name); continue;
      }
      if (entry.isSymbolicLink()) throw new Error('Symlink in merchant package: ' + path);
      if (entry.isDirectory()) {
        if (![...bytesByPath.keys()].some(name => name.startsWith(path + '/')))
          throw new Error('Unlisted merchant package directory: ' + path);
        await inspectDirectory(join(directory, entry.name), path + '/');
      } else if (!entry.isFile() || !bytesByPath.has(path))
        throw new Error('Unlisted merchant package content: ' + path);
    }
  }
  await inspectDirectory(root);
  const metadata = JSON.parse(bytesByPath.get('package.json'));
  if (metadata.name !== manifest.packageName || metadata.version !== manifest.packageVersion ||
      metadata.type !== 'module' || metadata.bin?.starforge !== './source/' + DOCTOR_PATH)
    throw new Error('Merchant package metadata differs from its manifest');
  const node = /^>=(\d+)\.(\d+)\.0$/.exec(metadata.engines?.node ?? '');
  if (!node) throw new Error('Unsupported merchant Node requirement');
  const catalogBytes = bytesByPath.get('source/' + CATALOG_PATH);
  if (!catalogBytes || !sourcePaths.has(DOCTOR_PATH)) throw new Error('Original merchant catalog or doctor missing');
  const { catalog, commands, commandCatalog } = compileCommandCatalog(catalogBytes,
    path => sourcePaths.has(path), { prefix: 'source/' });
  if (catalog.name !== manifest.packageName ||
      catalog.version + '-source.g' + manifest.sourceCommit.slice(0, 12) !== manifest.packageVersion)
    throw new Error('Merchant package version differs from its original catalog');
  same(metadata.exports, catalog.exports, 'exports');
  for (const path of exportPaths(metadata.exports)) {
    if (!path.startsWith('./') || !bytesByPath.has(relativePath(path.slice(2))))
      throw new Error('Merchant package export missing: ' + path);
  }
  const nativePeerVersions = dependencies(manifest.optionalNativePeers ?? {}, 'native peers', { pinned: false });
  same(nativePeerVersions, Object.fromEntries(Object.entries(catalog.nativePeers ?? {})
    .map(([name, definition]) => [name, definition.version])), 'native peer declarations');
  const adapterPackages = dependencies(manifest.optionalRuntimeDependencies ?? {}, 'runtime dependencies');
  same(metadata.optionalDependencies ?? {}, adapterPackages, 'optional dependencies');
  const adapterPackageSources = {}, adapterPackageHashes = {}, resolvedAdapters = {};
  const featurePeers = { ...catalog.featurePeers };
  for (const [group, path] of Object.entries(catalog.runtimePackageManifests ?? {})) {
    relativePath(path);
    const packagePath = 'source/' + path, bytes = bytesByPath.get(packagePath);
    if (!bytes) throw new Error('Original runtime manifest missing: ' + path);
    const declared = dependencies(JSON.parse(bytes).dependencies, path);
    if (!Object.keys(declared).length) throw new Error('Original runtime dependencies missing: ' + path);
    featurePeers[group] = Object.fromEntries(Object.entries(declared).map(([name, version]) => {
      if (Object.hasOwn(resolvedAdapters, name) && resolvedAdapters[name] !== version)
        throw new Error('Conflicting original runtime dependency: ' + name);
      resolvedAdapters[name] = version;
      return [name, { version, probe: catalog.featurePeers?.[group]?.[name]?.probe ?? name }];
    }));
    adapterPackageSources[group] = packagePath;
    adapterPackageHashes[group] = sha256(bytes);
  }
  same(resolvedAdapters, adapterPackages, 'runtime dependency sources');
  same(manifest.runtimePackageSources ?? {}, catalog.runtimePackageManifests ?? {}, 'runtime manifest paths');
  const optionalFeatures = Object.fromEntries(Object.entries(featurePeers).map(([name, peers]) =>
    [name, Object.fromEntries(Object.entries(peers).map(([pkg, item]) => [pkg, item.version]))]));
  same(manifest.optionalFeaturePeers ?? {}, optionalFeatures, 'feature peers');
  const peers = { ...nativePeerVersions };
  for (const declared of Object.values(optionalFeatures)) for (const [name, version] of Object.entries(declared)) {
    if (Object.hasOwn(peers, name) && peers[name] !== version) throw new Error('Conflicting original optional peer');
    peers[name] = version;
  }
  same(metadata.peerDependencies ?? {}, peers, 'peer dependencies');
  commands.starforge = { path: 'source/' + DOCTOR_PATH, summary: 'Original toolkit initialization, workspace launch and source commands' };
  commandCatalog.aliases.push('starforge');
  // The original SF46 summary compares nativePackages by exact version. Peer
  // ranges remain intact in nativePeers and the maintained dependency doctor.
  const nativePackages = Object.fromEntries(Object.entries(nativePeerVersions).filter(([, version]) => PIN.test(version)));
  const runtime = { minimumNodeMajor: Number(node[1]), minimumNodeMinor: Number(node[2]),
    nativePackages, nativePeers: catalog.nativePeers ?? {}, adapterPackages, adapterPackageSources,
    adapterPackageHashes, featurePeers, optionalDependencies: adapterPackages, doctorPath: 'source/' + DOCTOR_PATH };
  const summary = { packageDirectory: root, packageName: manifest.packageName,
    packageVersion: manifest.packageVersion, sourceCommit: manifest.sourceCommit,
    sourceRepository: manifest.sourceRepository, sourceManifestSha256,
    sourceFiles: manifest.files.length, sourceBytes, packageFiles: files.length, packageBytes,
    commands, commandCatalog, runtime, separateDependencyEntries: mutableEntries.sort() };
  return { root, manifest, bytesByPath, files, summary, runtime, commands, commandCatalog };
}

export async function inspectMerchantPackage(packageDirectory, options = {}) {
  return (await readPackage(packageDirectory, options)).summary;
}

export async function prepareMerchantPackage({ packageDirectory, output, expectedManifest } = {}) {
  if (typeof output !== 'string' || !output) throw new Error('A new prepared release directory is required');
  const original = await readPackage(packageDirectory, { expectedManifest });
  // Resolve the parent before creation so a symlink cannot redirect this
  // create-only output into the source package being read.
  const requested = resolve(output), parent = await plainDirectory(dirname(requested));
  const out = join(parent, basename(requested));
  if (out === original.root || out.startsWith(original.root + sep))
    throw new Error('Prepare the release outside the original package');
  const bytesByPath = new Map(original.bytesByPath), files = [...original.files], manager = [];
  const managerRoot = await plainDirectory(HERE);
  for (const [source, destination] of [['product.mjs', 'forge.mjs'], ['release-core.mjs', 'release-core.mjs']]) {
    const bytes = await boundedFile(managerRoot, source);
    const identity = { path: destination, sourcePath: BASE + source,
      gitBlob: gitBlob(bytes), sha256: sha256(bytes), bytes: bytes.length };
    manager.push(identity); bytesByPath.set(destination, bytes);
    files.push({ path: destination, bytes: bytes.length, sha256: identity.sha256,
      mode: destination === 'forge.mjs' ? 0o755 : 0o644 });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (files.reduce((sum, file) => sum + file.bytes, 0) > MAX_BYTES)
    throw new Error('Prepared release exceeds size limit');
  const body = { schema: RELEASE_SCHEMA, product: 'Stellar Forge',
    version: original.manifest.packageVersion,
    source: { repository: 'woahwhattheheck/public-commons-sprint-2026', commit: original.manifest.sourceCommit },
    origin: { schema: 'stellar-forge.managed-merchant-package.v1',
      packageName: original.manifest.packageName, packageVersion: original.manifest.packageVersion,
      sourceManifest: { path: 'manifest.json', sha256: original.summary.sourceManifestSha256 },
      sourcePrefix: 'source/', manager },
    runtime: original.runtime, commands: original.commands, commandCatalog: original.commandCatalog, files };
  const manifest = { ...body, digest: sha256(canonical(body)) };
  await mkdir(out, { mode: 0o700 });
  try {
    for (const file of files) await putFile(join(out, file.path), bytesByPath.get(file.path), file.mode);
    await putFile(join(out, MANIFEST), json(manifest));
    const verified = await verifyRelease(out, manifest.digest);
    return { ...original.summary, state: 'PREPARED', release: out, id: verified.id,
      digest: manifest.digest, files: files.length, bytes: verified.totalBytes, manager };
  } catch (error) {
    try { await rm(out, { recursive: true, force: true }); }
    catch (cleanup) { error.preparedCleanup = { directory: out, error: cleanup.message, code: cleanup.code }; }
    throw error;
  }
}
