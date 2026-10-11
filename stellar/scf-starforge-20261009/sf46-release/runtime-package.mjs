// MIT. Adopt an original completed runtime into the existing SF46 lifecycle.
import { lstat, mkdtemp, readlink, realpath, rm, stat, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { inspectRuntimeInstall } from '../distribution/runtime-install.mjs';
import { inspectRuntimeProfile, verifyRuntimeProfile, verifyRuntimeSource } from '../distribution/runtime-profile.mjs';
import { prepareMerchantPackage } from './merchant-package.mjs';
import { install, status } from './product.mjs';
import { MANIFEST, atomicFile, boundedFile, canonical, plainDirectory, sha256,
  validateId, verifyRelease } from './release-core.mjs';

const BINDING_SCHEMA = 'stellar-forge.managed-runtime.v1';
const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function requiredPath(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' is required');
  return value;
}

async function exists(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function destinationPath(input) {
  let path = resolve(input);
  const missing = [];
  for (;;) {
    try { return join(await realpath(path), ...missing); }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
      missing.unshift(basename(path)); path = dirname(path);
    }
  }
}

function validateBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== BINDING_SCHEMA ||
      typeof value.directory !== 'string' || !isAbsolute(value.directory) ||
      resolve(value.directory) !== value.directory || !COMMIT.test(value.sourceCommit ?? '') ||
      !Number.isSafeInteger(value.dependencyCount) || value.dependencyCount < 0 ||
      ['installationId', 'profileId', 'profileSha256', 'lockSha256', 'sourceManifestSha256']
        .some(name => !SHA.test(value[name] ?? '')))
    throw new Error('Invalid managed runtime identity');
  return { schema: value.schema, directory: value.directory, installationId: value.installationId,
    profileId: value.profileId, profileSha256: value.profileSha256, lockSha256: value.lockSha256,
    sourceCommit: value.sourceCommit, sourceManifestSha256: value.sourceManifestSha256,
    dependencyCount: value.dependencyCount };
}

function sameBinding(actual, expected) {
  if (canonical(validateBinding(actual)) !== canonical(validateBinding(expected)))
    throw new Error('The retained runtime differs from this managed release identity');
}

async function readyRuntime(directory, { expectedManifest, load = false, source = true } = {}) {
  requiredPath(directory, 'directory');
  if (typeof load !== 'boolean' || typeof source !== 'boolean')
    throw new TypeError('load and source must be booleans');
  if (expectedManifest !== undefined && !SHA.test(expectedManifest))
    throw new Error('Expected manifest must be a SHA-256 digest');
  const root = await plainDirectory(await realpath(resolve(directory)));
  // The original installer validates its absolute plan identity, original
  // package, frozen profile, dependency package.json and exact saved lockfile.
  const observed = await inspectRuntimeInstall({ directory: root, load, source });
  if (observed.status !== 'READY' || observed.ready !== true || observed.lockMatches !== true ||
      source && observed.sourceVerified !== true)
    throw new Error('The original runtime must be READY with its recorded profile and lockfile before adoption');
  if (observed.directory !== root || observed.dependencyRoot !== root ||
      observed.sourceRoot !== join(root, 'package', 'source'))
    throw new Error('The original runtime returned different installation paths');

  const profileBytes = await boundedFile(root, 'runtime-profile.json', 4 * 1024 * 1024);
  const profile = verifyRuntimeProfile(JSON.parse(profileBytes));
  if (profile.profileId !== observed.profileId || profile.source.sourceCommit !== observed.sourceCommit)
    throw new Error('The runtime profile changed during inspection');
  const sourceManifestSha256 = sha256(await boundedFile(join(root, 'package'), 'manifest.json', 4 * 1024 * 1024));
  if (expectedManifest && sourceManifestSha256 !== expectedManifest)
    throw new Error('Merchant package manifest digest mismatch');
  const binding = validateBinding({ schema: BINDING_SCHEMA, directory: root,
    installationId: observed.installationId, profileId: observed.profileId,
    profileSha256: sha256(profileBytes), lockSha256: observed.lockSha256,
    sourceCommit: observed.sourceCommit, sourceManifestSha256,
    dependencyCount: profile.dependencies.length });
  const summary = { state: 'READY', ...binding, packageVersion: observed.packageVersion,
    sourceRoot: observed.sourceRoot, dependencyRoot: root, entrypoint: observed.entrypoint,
    selection: profile.selection,
    dependencies: profile.dependencies.map(({ name, version }) => ({ name, version })) };
  return { root, binding, profile, summary };
}

/** Inspect the exact completed source/runtime operation that will be adopted. */
export async function inspectMerchantRuntime(directory, options = {}) {
  return (await readyRuntime(directory, options)).summary;
}

/** Prepare a source release whose identity includes one retained runtime. */
export async function prepareMerchantRuntime({ directory, output, expectedManifest } = {}) {
  requiredPath(output, 'output');
  const runtime = await readyRuntime(directory, { expectedManifest });
  const destination = await destinationPath(output);
  if (destination === runtime.root || destination.startsWith(runtime.root + sep))
    throw new Error('Prepare the managed release outside the retained runtime directory');
  const prepared = await prepareMerchantPackage({ packageDirectory: join(runtime.root, 'package'),
    output, expectedManifest: runtime.binding.sourceManifestSha256 });
  try {
    await verifyRuntimeSource(runtime.profile, { sourceRoot: join(prepared.release, 'source') });
    const original = await verifyRelease(prepared.release, prepared.digest);
    const { digest: _originalDigest, ...originalBody } = original.manifest;
    const body = { ...originalBody, origin: { ...originalBody.origin, runtimeInstallation: runtime.binding } };
    const manifest = { ...body, digest: sha256(canonical(body)) };
    // The original package and source bytes are unchanged. This existing
    // manager manifest alone binds the dependency selection into release ID.
    await atomicFile(join(prepared.release, MANIFEST), json(manifest));
    const verified = await verifyRelease(prepared.release, manifest.digest);
    return { ...prepared, id: verified.id, digest: manifest.digest,
      runtimeInstallation: runtime.summary };
  } catch (error) {
    try { await rm(prepared.release, { recursive: true, force: true }); }
    catch (cleanup) {
      if (error && typeof error === 'object' && Object.isExtensible(error))
        error.preparedCleanup = { directory: prepared.release, error: cleanup.message, code: cleanup.code };
    }
    throw error;
  }
}

function releaseBinding(release) {
  const origin = release.manifest.origin;
  const binding = validateBinding(origin?.runtimeInstallation);
  if (origin.schema !== 'stellar-forge.managed-merchant-package.v1' || origin.sourcePrefix !== 'source/' ||
      origin.sourceManifest?.path !== 'manifest.json' ||
      origin.sourceManifest.sha256 !== binding.sourceManifestSha256 ||
      release.manifest.source.commit !== binding.sourceCommit)
    throw new Error('Managed release source differs from its retained runtime');
  return binding;
}

async function exactLink(path, target) {
  const entry = await exists(path);
  if (!entry) return false;
  if (!entry.isSymbolicLink() || resolve(dirname(path), await readlink(path)) !== target)
    throw new Error('Managed release already has a different node_modules entry: ' + path);
  return true;
}

async function inspectAttachment(release, runtime, { load = false } = {}) {
  sameBinding(runtime.binding, releaseBinding(release));
  await verifyRuntimeSource(runtime.profile, { sourceRoot: join(release.root, 'source') });
  const link = join(release.root, 'node_modules'), target = join(runtime.root, 'node_modules');
  if (runtime.binding.dependencyCount) {
    if (!await exactLink(link, target))
      throw new Error('Managed runtime dependency link is missing; repeat adopt-runtime with the same runtime and home');
    if (!(await stat(target)).isDirectory()) throw new Error('The retained runtime node_modules is not a directory');
  } else if (await exists(link)) {
    throw new Error('This empty runtime profile requires no managed node_modules entry: ' + link);
  }
  const observed = await inspectRuntimeProfile(runtime.profile, {
    directory: runtime.root, sourceRoot: join(release.root, 'source'), load });
  if (!observed.ready) throw new Error('The selected managed source cannot load its recorded runtime profile');
  return { state: 'READY', ...runtime.summary, releaseId: release.id, releaseDirectory: release.root,
    managedSourceRoot: join(release.root, 'source'),
    nodeModules: runtime.binding.dependencyCount ? { path: link, target } : null,
    loadRequested: load, inspection: observed };
}

// Called only by the original product.install while it owns the home lock,
// after the source copy verifies and before any active selection is changed.
async function prepareInstalledRuntime(context, expectedBinding) {
  const release = await verifyRelease(context.releaseDirectory, context.digest);
  if (release.id !== context.releaseId || release.root !== join(context.home, 'releases', release.id))
    throw new Error('The installer returned a different target release');
  const binding = releaseBinding(release);
  sameBinding(binding, expectedBinding);
  const runtime = await readyRuntime(binding.directory, {
    expectedManifest: binding.sourceManifestSha256, source: false });
  sameBinding(runtime.binding, binding);
  await verifyRuntimeSource(runtime.profile, { sourceRoot: join(release.root, 'source') });
  const link = join(release.root, 'node_modules'), target = join(runtime.root, 'node_modules');
  let created = false;
  try {
    if (binding.dependencyCount) {
      if (!(await stat(target)).isDirectory()) throw new Error('The retained runtime node_modules is not a directory');
      if (!await exactLink(link, target)) {
        await symlink(target, link, 'dir'); created = true;
      }
    }
    const result = await inspectAttachment(release, runtime);
    return { ...result, attachment: binding.dependencyCount ? created ? 'LINKED' : 'REOPENED' : 'NOT_REQUIRED' };
  } catch (error) {
    // Undo only a link made by this invocation. Existing links and any
    // unexpected files stay owned by their original operator.
    if (created) try {
      if (await exactLink(link, target)) await unlink(link);
    } catch (cleanup) {
      if (error && typeof error === 'object' && Object.isExtensible(error))
        error.runtimeLinkCleanup = { path: link, error: cleanup.message, code: cleanup.code };
    }
    throw error;
  }
}

/** Adopt a completed original runtime; npm and its source directory stay owned by that installer. */
export async function adoptMerchantRuntime({ directory, home, activate = false, expectedManifest } = {}) {
  requiredPath(directory, 'directory'); requiredPath(home, 'home');
  if (typeof activate !== 'boolean') throw new TypeError('activate must be a boolean');
  const originalDirectory = await plainDirectory(await realpath(resolve(directory)));
  const destination = await destinationPath(home);
  if (destination === originalDirectory || destination.startsWith(originalDirectory + sep))
    throw new Error('Installation must be outside the retained runtime directory');
  const temporaryParent = await plainDirectory(tmpdir());
  if (temporaryParent === originalDirectory || temporaryParent.startsWith(originalDirectory + sep))
    throw new Error('Use a temporary directory outside the retained runtime directory');
  const temporary = await mkdtemp(join(temporaryParent, 'starforge-runtime-adopt-'));
  let prepared, installed, attachment, failure, cleanup, failed = false;
  try {
    prepared = await prepareMerchantRuntime({ directory: originalDirectory, output: join(temporary, 'release'), expectedManifest });
    installed = await install(prepared.release, home, { expected: prepared.digest, activate,
      prepareInstalledRelease: async context => {
        attachment = await prepareInstalledRuntime(context, prepared.runtimeInstallation);
      } });
    if (!attachment) throw new Error('The current release manager must support runtime preparation before selection');
  } catch (error) { failed = true; failure = error; }
  try { await rm(temporary, { recursive: true, force: true }); }
  catch (error) {
    cleanup = { state: 'RETAINED', directory: temporary, error: error.message,
      ...(error.code ? { code: error.code } : {}) };
  }
  if (failed) {
    if (cleanup && failure && typeof failure === 'object' && Object.isExtensible(failure))
      failure.temporaryCleanup = cleanup;
    throw failure;
  }
  return { ...installed, releaseDirectory: join(installed.home, 'releases', installed.releaseId),
    packageName: prepared.packageName, packageVersion: prepared.packageVersion,
    sourceCommit: prepared.sourceCommit, sourceManifestSha256: prepared.sourceManifestSha256,
    runtimeInstallation: attachment,
    ...(cleanup ? { temporaryCleanup: cleanup } : {}) };
}

/** Read back the retained runtime through an installed release's actual source imports. */
export async function inspectInstalledRuntime({ home, releaseId, load = false } = {}) {
  requiredPath(home, 'home');
  if (typeof load !== 'boolean') throw new TypeError('load must be a boolean');
  const selected = await status(home);
  if (!selected.home) throw new Error('A managed installation home is required');
  const id = releaseId ?? selected.activeReleaseId;
  validateId(id);
  const release = await verifyRelease(join(selected.home, 'releases', id));
  if (release.id !== id) throw new Error('Installed release identity differs from its directory');
  const binding = releaseBinding(release);
  const runtime = await readyRuntime(binding.directory, {
    expectedManifest: binding.sourceManifestSha256, load, source: false });
  return inspectAttachment(release, runtime, { load });
}
