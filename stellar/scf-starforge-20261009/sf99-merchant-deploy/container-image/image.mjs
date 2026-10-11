// MIT. Prepare a runtime image from one already-built merchant source release.
import { constants, createReadStream } from 'node:fs';
import { readFile, writeFile, copyFile, mkdir, lstat, rm, realpath, open, link, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { inspectDistribution } from './archive.mjs';
import { verifyRuntimeProfile, verifyRuntimeSource } from '../../distribution/runtime-profile.mjs';

export const PLAN_SCHEMA = 'stellar-forge.merchant-container-image.v1';
export const CONTEXT_SCHEMA = 'stellar-forge.merchant-image-context.v1';
export const RECEIPT_SCHEMA = 'stellar-forge.merchant-image-receipt.v1';
export const PORTABLE_SCHEMA = 'stellar-forge.merchant-image-portable.v1';
const CONTAINER_BASE = 'stellar/scf-starforge-20261009/sf99-merchant-deploy/';
const CONTAINER_ENTRIES = ['container.mjs','container-mounts.mjs','container-runtime.mjs',
  'container-cli.mjs','container-operations.mjs','compose-maintenance.mjs'];
export const need = (yes, message) => { if (!yes) throw new Error(message); };
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonText = value => JSON.stringify(value, null, 2) + '\n';
export const inside = (root, value) => root === value || value.startsWith(root + '/');
export function absolute(value, name = 'path') {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), name + ' must be an absolute normalized path'); return value;
}
function imagePath(value, name) {
  absolute(value, name);
  need(/^\/[A-Za-z0-9._/-]+$/.test(value), name + ' must use plain POSIX image path characters'); return value;
}
export async function regular(file, maximum = 16 * 1024 * 1024) {
  const stat = await lstat(file);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'Regular bounded file required: ' + file);
  const bytes = await readFile(file);
  need(bytes.length <= maximum, 'File grew beyond its limit'); return bytes;
}
export async function readJSON(file) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(file))); }
export async function writeJSON(file, value, exclusive = true) {
  const temporary = file + '.' + randomUUID() + '.partial';
  let handle;
  try {
    handle = await open(temporary,'wx',0o600);
    await handle.writeFile(jsonText(value)); await handle.sync(); await handle.close(); handle = null;
    if (exclusive) await link(temporary,file);
    else await rename(temporary,file);
    const directory = await open(dirname(file),'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if(error.code !== 'ENOENT') throw error; });
  }
}
async function fileHash(file, maximum) {
  const stat = await lstat(file);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum,'Regular bounded image input required: ' + file);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length; need(bytes <= maximum,'Image input grew beyond its limit'); hash.update(chunk);
  }
  need(bytes === stat.size,'Image input changed while reading'); return hash.digest('hex');
}
function fields(value, allowed, name) {
  need(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'Unknown or invalid ' + name + ' field');
}
function buildDirectory(p) {
  return p.installation ? p.dependencyRoot + '.merchant-build' : join(p.dependencyRoot, 'merchant-build');
}
function dockerfile(p) {
  const build = buildDirectory(p);
  const json = values => JSON.stringify(values);
  if (p.installation) return [
    '# Original installer owns selected source, dependency lock and native preparation.',
    'FROM ' + p.baseImage + ' AS prepared',
    'USER 0:0',
    'ENV PATH=' + dirname(p.runtime.node) + ':' + dirname(p.runtime.npm) + ':${PATH}',
    'WORKDIR ' + build,
    'COPY ' + json(['package.json','package-lock.json','merchant.tgz','archive.mjs',
      'runtime.mjs','runtime-profile.mjs','runtime-install.mjs','runtime-unpack.py',
      'profile.json','runtime-contract.json',build + '/']),
    'RUN ' + json([p.runtime.node,join(build,'runtime.mjs'),'install',join(build,'runtime-contract.json')]),
    '',
    'FROM ' + p.baseImage,
    'ENV PATH=' + dirname(p.runtime.node) + ':' + dirname(p.runtime.npm) + ':${PATH}',
    'COPY --from=prepared --chown=' + p.uid + ':' + p.gid + ' ' +
      json([p.dependencyRoot,p.dependencyRoot]),
    'COPY --from=prepared --chown=' + p.uid + ':' + p.gid + ' ' + json([build,build]),
    'WORKDIR ' + p.sourceRoot,
    'ENV PYTHONDONTWRITEBYTECODE=1',
    'LABEL org.opencontainers.image.title=' + JSON.stringify('Stellar Forge merchant runtime'),
    'LABEL org.opencontainers.image.revision=' + JSON.stringify(p.release.sourceCommit),
    'LABEL org.opencontainers.image.version=' + JSON.stringify(p.release.packageVersion),
    'LABEL org.opencontainers.image.source=' + JSON.stringify(p.release.sourceRepository),
    'LABEL org.tokenjunkielabs.starforge.archive-sha256=' + JSON.stringify(p.release.archiveSha256),
    'USER ' + p.uid + ':' + p.gid,
    'RUN ' + json([p.runtime.node,join(build,'runtime.mjs'),'check',join(build,'runtime-contract.json')]),
    'ENTRYPOINT []',
    'CMD ' + json([p.runtime.node,join(p.sourceRoot,'stellar/scf-starforge-20261009/distribution/cli.mjs'),'doctor']),
    '',
  ].join('\n');
  return [
    '# Original merchant source and selected runtime. No private service configuration is copied.',
    'FROM ' + p.baseImage + ' AS prepared',
    'USER 0:0',
    'WORKDIR ' + p.dependencyRoot,
    'COPY ' + json(['package.json','package-lock.json',p.dependencyRoot + '/']),
    'RUN ' + json([p.runtime.npm,'ci','--ignore-scripts','--omit=dev','--omit=optional','--no-audit','--no-fund']),
    'COPY ' + json(['merchant.tgz','archive.mjs','runtime.mjs','runtime-profile.mjs','profile.json','runtime-contract.json',build + '/']),
    'RUN ' + json([p.runtime.node,join(build,'runtime.mjs'),'install',join(build,'runtime-contract.json')]),
    '',
    'FROM ' + p.baseImage,
    'COPY --from=prepared ' + json([p.dependencyRoot,p.dependencyRoot]),
    'WORKDIR ' + p.sourceRoot,
    'ENV PYTHONDONTWRITEBYTECODE=1',
    'LABEL org.opencontainers.image.title=' + JSON.stringify('Stellar Forge merchant runtime'),
    'LABEL org.opencontainers.image.revision=' + JSON.stringify(p.release.sourceCommit),
    'LABEL org.opencontainers.image.version=' + JSON.stringify(p.release.packageVersion),
    'LABEL org.opencontainers.image.source=' + JSON.stringify(p.release.sourceRepository),
    'LABEL org.tokenjunkielabs.starforge.archive-sha256=' + JSON.stringify(p.release.archiveSha256),
    'USER ' + p.uid + ':' + p.gid,
    'RUN ' + json([p.runtime.node,join(build,'runtime.mjs'),'check',join(build,'runtime-contract.json')]),
    'ENTRYPOINT []',
    'CMD ' + json([p.runtime.node,join(p.sourceRoot,'stellar/scf-starforge-20261009/distribution/cli.mjs'),'doctor']),
    '',
  ].join('\n');
}

export async function inspectPlan(planFile) {
  planFile = absolute(resolve(planFile), 'image plan');
  const planBytes = await regular(planFile, 1024 * 1024), raw = JSON.parse(planBytes);
  fields(raw, ['schema','id','archive','archiveSha256','baseImage','platform','sourceRoot','runtime',
    'runtimeProfile','selectedSourceRoot','pythonModules','uid','gid','nodeHeaders'], 'image plan');
  need(raw.schema === PLAN_SCHEMA && /^[a-z][a-z0-9-]{0,39}$/.test(raw.id ?? ''), 'Image schema and stable ID required');
  absolute(raw.archive, 'distribution archive');
  need(/^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(raw.baseImage ?? ''),
    'Select an existing OCI runtime base by repository and immutable sha256 digest');
  need(/^linux\/(?:amd64|arm64(?:\/v8)?)$/.test(raw.platform ?? ''), 'Select linux/amd64 or linux/arm64');
  const sourceRoot = imagePath(raw.sourceRoot, 'sourceRoot');
  fields(raw.runtime, ['node','python','npm'], 'runtime');
  const runtime = Object.fromEntries(['node','python','npm'].map(name => [name,imagePath(raw.runtime[name], name)]));
  const uid = raw.uid ?? 65532, gid = raw.gid ?? 65532;
  need([uid,gid].every(value => Number.isInteger(value) && value > 0 && value < 2147483647), 'Unprivileged numeric uid/gid required');
  const pythonModules = raw.pythonModules ?? [];
  need(Array.isArray(pythonModules) && pythonModules.length <= 32 && new Set(pythonModules).size === pythonModules.length &&
    pythonModules.every(name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)),
    'Python modules must be explicit module names');
  const original = await inspectDistribution(raw.archive, raw.archiveSha256);
  const runtimeProfileFile = absolute(raw.runtimeProfile,'retained runtime profile');
  const profileBytes = await regular(runtimeProfileFile), profile = verifyRuntimeProfile(JSON.parse(profileBytes));
  need(profile.selection.operator === true, 'Select the original operator runtime profile for a merchant host');
  const declaredNative = profile.dependencies.some(dependency => dependency.native);
  const dependencyRoot = declaredNative ? dirname(dirname(sourceRoot)) : dirname(sourceRoot);
  need(dependencyRoot !== '/' && !sourceRoot.split('/').includes('..') &&
    !inside(join(dependencyRoot,'node_modules'), sourceRoot) &&
    !['node_modules','merchant-build','merchant-release'].includes(sourceRoot.split('/').at(-1)),
    'sourceRoot needs its own directory beside the image dependency node_modules');
  need(!Object.values(runtime).some(path => inside(dependencyRoot,path)),
    'Runtime executables must be supplied by the selected base image');
  let installation = null;
  if (declaredNative) {
    need(sourceRoot === join(dependencyRoot,'package','source'),
      'A declared native profile uses the original installer sourceRoot RUNTIME_DIRECTORY/package/source');
    need(original.archiveBytes <= 64 * 1024 * 1024,
      'Declared native image source exceeds the original installer archive limit');
    const nodeHeaders = raw.nodeHeaders == null ? null : imagePath(raw.nodeHeaders,'nodeHeaders');
    need(!nodeHeaders || !inside(dependencyRoot,nodeHeaders),
      'Matching Node headers must be supplied by the selected build base outside the runtime directory');
    installation = { schema:'stellar-forge.image-runtime-installation.v1',
      directory:dependencyRoot,sourceRoot,nodeHeaders };
  } else need(raw.nodeHeaders === undefined,
    'nodeHeaders belongs to a selected declared-native runtime profile');
  const selectedSourceRoot = absolute(await realpath(raw.selectedSourceRoot),'selected release source');
  await verifyRuntimeSource(profile,{sourceRoot:selectedSourceRoot});
  need(profile.source.sourceCommit === original.manifest.sourceCommit &&
    profile.source.packageVersion === original.manifest.packageVersion &&
    profile.source.packageName === original.manifest.packageName, 'Runtime profile and distribution archive must select the same original release');
  const sourceRecords = new Map(original.manifest.files.map(file=>[file.path,file]));
  for (const input of profile.source.inputFiles) {
    const expected = sourceRecords.get(input.path);
    need(expected && expected.sha256 === input.sha256 && expected.bytes === input.bytes,
      'Runtime profile input differs from the original distribution archive: ' + input.path);
  }
  const sourceModes = CONTAINER_ENTRIES.every(name=>sourceRecords.has(CONTAINER_BASE+name))
    ? ['bind','image'] : ['bind'];
  const dependencies = profile.packageJson.dependencies;
  const release = { sourceCommit: original.manifest.sourceCommit, sourceRepository: original.manifest.sourceRepository,
    packageName: original.manifest.packageName, packageVersion: original.manifest.packageVersion,
    archiveSha256: original.archiveSha256, archiveBytes: original.archiveBytes,
    manifestSha256: original.manifestSha256, sourceFiles: original.sourceFiles, sourceBytes: original.sourceBytes };
  return { schema: PLAN_SCHEMA, id: raw.id, planFile, planSha256: sha256(planBytes), archive: raw.archive,
    baseImage: raw.baseImage, platform: raw.platform, sourceRoot, dependencyRoot, runtime, uid, gid,
    features: [...(profile.selection.native?['native']:[]),...profile.selection.features].sort(),
    pythonModules: [...pythonModules].sort(), runtimeProfileFile,selectedSourceRoot,profile,
    profileSha256:sha256(profileBytes),sourceModes,dependencies,release,
    ...(installation ? { installation } : {}) };
}

export async function prepareImage(planFile, directory) {
  const p = await inspectPlan(planFile), out = absolute(resolve(directory), 'new image context');
  need(!inside(out,p.archive) && !inside(out,p.planFile), 'Image context must be separate from original inputs');
  const contract = { schema: 'stellar-forge.merchant-image-runtime.v1', sourceRoot: p.sourceRoot,
    dependencyRoot: p.dependencyRoot, runtime: p.runtime, release: p.release,
    features: p.features,profileId:p.profile.profileId,pythonModules: p.pythonModules,
    sourceModes:p.sourceModes,...(p.installation ? { installation:p.installation } : {}) };
  const packageJson = p.profile.packageJson;
  const runtimeSource = (await regular(fileURLToPath(new URL('./runtime.mjs',import.meta.url)))).toString('utf8');
  const profileImport = "from '../../distribution/runtime-profile.mjs'";
  need(runtimeSource.split(profileImport).length === 2, 'Original image runtime profile import changed');
  // The generated build context carries the same maintained profile module
  // beside its runtime helper, instead of the repository directory layout.
  let generatedRuntime = runtimeSource.replace(profileImport,"from './runtime-profile.mjs'");
  if (p.installation) {
    const installerImport = "const INSTALLER = '../../distribution/runtime-install.mjs';";
    need(generatedRuntime.split(installerImport).length === 2, 'Original image runtime installer import changed');
    generatedRuntime = generatedRuntime.replace(installerImport,"const INSTALLER = './runtime-install.mjs';");
  }
  const files = new Map([
    ['Dockerfile',dockerfile(p)], ['package.json',jsonText(packageJson)],
    ['runtime-contract.json',jsonText(contract)],
    ['.dockerignore','*\n!Dockerfile\n!package.json\n!package-lock.json\n!merchant.tgz\n!archive.mjs\n!runtime.mjs\n!runtime-profile.mjs\n!profile.json\n!runtime-contract.json\n' +
      (p.installation ? '!runtime-install.mjs\n!runtime-unpack.py\n' : '')],
    ['archive.mjs',await regular(fileURLToPath(new URL('./archive.mjs',import.meta.url)))],
    ['runtime.mjs',generatedRuntime],
    ['runtime-profile.mjs',await regular(fileURLToPath(new URL('../../distribution/runtime-profile.mjs',import.meta.url)))],
    ['profile.json',await regular(p.runtimeProfileFile)],
  ]);
  if (p.installation) for (const name of ['runtime-install.mjs','runtime-unpack.py'])
    files.set(name,await regular(fileURLToPath(new URL('../../distribution/' + name,import.meta.url))));
  await mkdir(out, { mode: 0o700 });
  try {
    for (const [name,bytes] of files) await writeFile(join(out,name),bytes,{mode:0o600,flag:'wx'});
    await copyFile(p.archive,join(out,'merchant.tgz'),constants.COPYFILE_EXCL);
    need(await fileHash(join(out,'merchant.tgz'),512*1024*1024) === p.release.archiveSha256,
      'Original distribution changed during context preparation');
    const artifacts = Object.fromEntries([...files].map(([name,bytes])=>[name,sha256(bytes)]));
    artifacts['merchant.tgz'] = p.release.archiveSha256;
    const manifest = { ...p, schema: CONTEXT_SCHEMA, directory: out, status:'PREPARED', artifacts };
    await writeJSON(join(out,'context.json'),manifest);
    return { status:'IMAGE_CONTEXT_PREPARED',directory:out,id:p.id,baseImage:p.baseImage,
      platform:p.platform,release:p.release,features:p.features,dependencies:p.dependencies,
      sourceRoot:p.sourceRoot,dependencyRoot:p.dependencyRoot,runtime:p.runtime,
      sourceModes:p.sourceModes,...(p.installation ? { installation:p.installation } : {}) };
  } catch(error) { await rm(out,{recursive:true,force:true}); throw error; }
}

export function inspectLock(lock, p) {
  need(object(lock) && lock.lockfileVersion === 3 && object(lock.packages) &&
    object(lock.packages['']) && object(lock.packages[''].dependencies ?? {}), 'npm lockfileVersion 3 is required');
  need(JSON.stringify(Object.entries(lock.packages[''].dependencies ?? {}).sort()) ===
    JSON.stringify(Object.entries(p.dependencies).sort()), 'Lockfile must retain exactly the selected root dependencies');
  for (const [name,version] of Object.entries(p.dependencies))
    need(lock.packages['node_modules/' + name]?.version === version, 'Lockfile selected a different package version: ' + name);
  for (const [path,value] of Object.entries(lock.packages)) {
    if (!path) continue;
    need(path.startsWith('node_modules/') && !path.split('/').includes('..') && !path.includes('\\') &&
      object(value) && !value.link && typeof value.version === 'string' && typeof value.resolved === 'string',
      'Lockfile must use resolved registry packages');
    let url; try { url = new URL(value.resolved); } catch { throw new Error('Invalid locked package URL'); }
    need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      url.hostname === 'registry.npmjs.org' && /^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/.test(value.integrity ?? ''),
      'Locked package needs an integrity-pinned public npm registry tarball: ' + path);
  }
  return { packages:Object.keys(lock.packages).length-1,dependencies:p.dependencies };
}

export async function checkContext(directory, { requireLock = true } = {}) {
  directory = absolute(resolve(directory),'image context');
  need(await realpath(directory) === directory, 'Image context must not traverse a symlink');
  const p = await readJSON(join(directory,'context.json'));
  need(p.schema === CONTEXT_SCHEMA && p.directory === directory && object(p.artifacts), 'Original image context manifest required');
  const requiredArtifacts = ['Dockerfile','package.json','runtime-contract.json','.dockerignore',
    'archive.mjs','runtime.mjs','runtime-profile.mjs','profile.json','merchant.tgz',
    ...(p.installation ? ['runtime-install.mjs','runtime-unpack.py'] : [])];
  need(requiredArtifacts.every(name => Object.hasOwn(p.artifacts,name)) &&
    Object.keys(p.artifacts).length === requiredArtifacts.length,
    'Image context must contain its complete original artifact selection');
  if (p.installation) {
    need(object(p.installation) && p.installation.schema === 'stellar-forge.image-runtime-installation.v1' &&
      p.installation.directory === p.dependencyRoot && p.installation.sourceRoot === p.sourceRoot &&
      p.sourceRoot === join(p.dependencyRoot,'package','source') &&
      p.profile?.dependencies?.some(dependency=>dependency.native),
      'Native image context lost the original installer layout or selected declaration');
    if (p.installation.nodeHeaders !== null) {
      imagePath(p.installation.nodeHeaders,'nodeHeaders');
      need(!inside(p.dependencyRoot,p.installation.nodeHeaders),
        'Node headers must be supplied by the original build base');
    }
  }
  for (const [name,expected] of Object.entries(p.artifacts)) {
    need(/^(?:[A-Za-z0-9][A-Za-z0-9_.-]*|\.dockerignore)$/.test(name) &&
      /^[a-f0-9]{64}$/.test(expected), 'Invalid context artifact');
    need(await fileHash(join(directory,name),name==='merchant.tgz'?512*1024*1024:16*1024*1024) === expected,
      'Image context artifact changed: ' + name);
  }
  need(p.artifacts['merchant.tgz'] === p.release.archiveSha256, 'Image context lost its source release identity');
  const contract = await readJSON(join(directory,'runtime-contract.json'));
  need(contract.sourceRoot === p.sourceRoot && contract.dependencyRoot === p.dependencyRoot &&
    JSON.stringify(contract.runtime) === JSON.stringify(p.runtime) &&
    JSON.stringify(contract.release) === JSON.stringify(p.release) &&
    JSON.stringify(contract.sourceModes) === JSON.stringify(p.sourceModes) &&
    JSON.stringify(contract.installation ?? null) === JSON.stringify(p.installation ?? null),
    'Image metadata differs from its retained runtime contract');
  const profile = verifyRuntimeProfile(await readJSON(join(directory,'profile.json')));
  need(profile.profileId === contract.profileId && profile.profileId === p.profile.profileId &&
    profile.source.sourceCommit === p.release.sourceCommit, 'Runtime profile differs from the selected image source');
  need(sha256(dockerfile(p)) === p.artifacts.Dockerfile, 'Image declaration differs from its generated Dockerfile');
  const packageJson = await readJSON(join(directory,'package.json'));
  need(JSON.stringify(packageJson) === JSON.stringify(profile.packageJson) &&
    JSON.stringify(packageJson.dependencies) === JSON.stringify(p.dependencies), 'Selected runtime package changed');
  if (requireLock) {
    need(p.status === 'LOCKED' && /^[a-f0-9]{64}$/.test(p.lockSha256 ?? ''), 'Lock the selected runtime dependencies first');
    const bytes = await regular(join(directory,'package-lock.json'));
    need(sha256(bytes) === p.lockSha256, 'Locked dependency bytes changed');
    inspectLock(JSON.parse(bytes),p);
  }
  return p;
}

export async function acceptLock(directory, lockFile = null) {
  const p = await checkContext(directory,{requireLock:false});
  const source = lockFile ? absolute(resolve(lockFile),'retained lockfile') : join(p.directory,'package-lock.json');
  const bytes = await regular(source), summary = inspectLock(JSON.parse(bytes),p);
  if (source !== join(p.directory,'package-lock.json'))
    await writeFile(join(p.directory,'package-lock.json'),bytes,{mode:0o600,flag:'wx'});
  const manifest = { ...p,status:'LOCKED',lockSha256:sha256(bytes),lockedPackages:summary.packages };
  await writeJSON(join(p.directory,'context.json'),manifest,false);
  return { status:'RUNTIME_DEPENDENCIES_LOCKED',directory:p.directory,lockSha256:manifest.lockSha256,...summary };
}

export function contextIdentity(p) {
  return sha256(JSON.stringify({ id:p.id,artifacts:p.artifacts,lockSha256:p.lockSha256,
    baseImage:p.baseImage,platform:p.platform,sourceRoot:p.sourceRoot,runtime:p.runtime,uid:p.uid,gid:p.gid }));
}
