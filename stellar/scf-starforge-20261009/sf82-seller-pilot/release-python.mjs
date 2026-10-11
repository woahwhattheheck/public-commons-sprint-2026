// MIT. Retain Python source and operate it through the original SF30 merchant.
import { open, readFile, lstat, realpath, mkdir, readdir, rename, rm, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePythonMerchant } from '../sf30-seller-sdk/python/config.mjs';
import { startPythonMerchant } from '../sf30-seller-sdk/python/merchant.mjs';

export const PYTHON_SOURCE_SCHEMA = 'stellar-forge.python-seller-manifest.v1';
const OFFERS_SCHEMA = 'stellar-forge.python-seller-offers.v1';
const CONFIG = 'python/declaration.json', RUNTIME_CONFIG = 'python/merchant.json';
const SOURCE = 'python/source/';
const MiB = 1024 * 1024;
const MAX_FILES = 512, MAX_SOURCE_BYTES = 32 * MiB, MAX_ASSET_BYTES = 8 * MiB;
const EXCLUDED_DIRECTORIES = ['.git', '.hg', '.svn', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'node_modules'];
const EXCLUDED_SUFFIXES = ['.pyc', '.pyo'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const stable = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  return value;
}
function parse(bytes) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
function inside(root, target) {
  const path = relative(root, target);
  return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
}
function portable(path) { return path.split(sep).join('/'); }
function validRelative(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 4096 &&
    !/[\\\u0000-\u001f\u007f]/.test(path) && !path.startsWith('/') &&
    path.split('/').every(part => part && part !== '.' && part !== '..');
}
async function directory(path) {
  if (!(await lstat(path)).isDirectory()) throw new TypeError('Python source must use real directories, without symlinks: ' + path);
}
async function regular(path, maximum = MAX_ASSET_BYTES) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maximum)
    throw new TypeError('Expected a regular file without symlinks, up to ' + maximum + ' bytes: ' + path);
  const bytes = await readFile(path);
  if (bytes.length > maximum) throw new RangeError('Python source file grew beyond its limit: ' + path);
  return bytes;
}
const descriptor = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });
const order = files => files.sort((a, b) => a.file.localeCompare(b.file));

async function sourceFiles(root, { excludeCaches = false, prefix = '' } = {}) {
  const files = [];
  let total = 0;
  async function walk(current, relativePath = '') {
    await directory(current);
    for (const item of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const local = relativePath ? relativePath + '/' + item.name : item.name;
      if (!validRelative(local)) throw new TypeError('Unsupported Python source filename.');
      if (item.isSymbolicLink()) throw new TypeError('Python source snapshots do not follow symlinks: ' + local);
      const path = join(current, item.name);
      if (item.isDirectory()) {
        if (excludeCaches && EXCLUDED_DIRECTORIES.includes(item.name)) continue;
        await walk(path, local);
      } else {
        if (!item.isFile()) throw new TypeError('Python source snapshots require regular files: ' + local);
        if (excludeCaches && EXCLUDED_SUFFIXES.some(suffix => item.name.endsWith(suffix))) continue;
        const data = await regular(path);
        total += data.length;
        files.push({ ...descriptor(prefix + local, data), data });
        if (files.length > MAX_FILES + (excludeCaches ? 0 : 2) || total > MAX_SOURCE_BYTES + (excludeCaches ? 0 : 3 * MiB))
          throw new RangeError('Python source snapshot exceeds 512 files or 32 MiB. Select the application source directory without dependencies or generated data.');
      }
    }
  }
  await walk(root);
  return order(files);
}

function metadata(compiled, configBytes, files, { entry, sourceScope, declarationSourceFile = null }) {
  const application = files.find(file => file.file === entry);
  if (!application || !entry.startsWith(SOURCE) || !entry.endsWith('.py') || application.bytes > 2 * MiB)
    throw new TypeError('The original Python entry must be retained in the source snapshot and fit its 2 MiB execution limit.');
  const options = compiled.options;
  const summaries = files.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 }));
  const execution = {
    entry, files: summaries.filter(file => file.file !== declarationSourceFile),
    executable: options.executable, environment: options.environment,
    workerCount: options.workerCount, maxPending: options.maxPending,
    startupTimeoutMs: options.startupTimeoutMs, shutdownTimeoutMs: options.shutdownTimeoutMs,
    lifecycle: options.lifecycle,
    functions: Object.fromEntries(Object.entries(compiled.functions).map(([name, definition]) => [name, {
      method: definition.method, inputSchema: definition.inputSchema, output: definition.output,
      maxInputBytes: definition.maxInputBytes, maxOutputBytes: definition.maxOutputBytes, timeoutMs: definition.timeoutMs,
    }])),
  };
  return {
    schema: 'stellar-forge.python-release-source.v1', entry, sourceScope, declarationSourceFile,
    configSha256: hash(configBytes), applicationSha256: application.sha256,
    sourceSha256: hash(stable(summaries)), executionSha256: hash(stable(execution)),
    interpreter: options.executable, environment: [...options.environment],
    workerCount: options.workerCount, maxPending: options.maxPending,
    startupTimeoutMs: options.startupTimeoutMs, shutdownTimeoutMs: options.shutdownTimeoutMs,
    lifecycle: { ...options.lifecycle }, fileCount: files.length,
    totalBytes: files.reduce((bytes, file) => bytes + file.bytes, 0),
    excludedDirectories: [...EXCLUDED_DIRECTORIES], excludedSuffixes: [...EXCLUDED_SUFFIXES],
  };
}

function interpreterSelection(declaration, interpreterBase) {
  const executable = declaration.python ?? 'python3';
  const relativePath = typeof executable === 'string' && executable.includes('/') && !isAbsolute(executable);
  if (relativePath) {
    if (typeof interpreterBase !== 'string' || !isAbsolute(interpreterBase) || resolve(interpreterBase) !== interpreterBase)
      throw new TypeError('A relative interpreter path requires its original staging directory.');
    return resolve(interpreterBase, executable);
  }
  if (interpreterBase !== null) throw new TypeError('Only a pathful relative interpreter records a staging directory.');
  return executable;
}
function retainedDeclaration(declaration, entry, interpreterBase) {
  const executable = interpreterSelection(declaration, interpreterBase);
  return { ...declaration, application: entry.slice('python/'.length),
    ...(interpreterBase === null ? {} : { python: executable }) };
}

/** Compile and read trusted source only. This does not import a Python application. */
export async function preparePythonRelease(configPath, { sourceRoot } = {}) {
  configPath = resolve(configPath);
  const configBytes = await regular(configPath, MiB), declaration = parse(configBytes);
  let compiled = compilePythonMerchant(declaration, { baseDir: dirname(configPath) });
  const originalExecutable = compiled.options.executable;
  const interpreterBase = originalExecutable.includes('/') && !isAbsolute(originalExecutable) ? process.cwd() : null;
  if (interpreterBase !== null)
    compiled = compilePythonMerchant({ ...declaration, python: interpreterSelection(declaration, interpreterBase) }, { baseDir: dirname(configPath) });
  const application = compiled.options.application;
  const root = sourceRoot === undefined ? dirname(application) : resolve(sourceRoot);
  await directory(root);
  if (!inside(root, application)) throw new TypeError('The Python application entry must be inside --python-root.');
  const entry = SOURCE + portable(relative(root, application));
  if (!validRelative(entry)) throw new TypeError('The Python entry has an unsupported relative path.');
  let files;
  if (sourceRoot === undefined) {
    const data = await regular(application, 2 * MiB);
    files = [{ ...descriptor(entry, data), data }];
  } else files = await sourceFiles(root, { excludeCaches: true, prefix: SOURCE });
  if (files.length > MAX_FILES || files.reduce((bytes, file) => bytes + file.bytes, 0) > MAX_SOURCE_BYTES)
    throw new RangeError('Python source snapshot exceeds 512 files or 32 MiB.');
  const declarationSourceFile = sourceRoot !== undefined && inside(root, configPath)
    ? SOURCE + portable(relative(root, configPath)) : null;
  if (declarationSourceFile) {
    const saved = files.find(file => file.file === declarationSourceFile);
    if (!saved || saved.sha256 !== hash(configBytes)) throw new Error('The Python declaration changed during source capture or belongs to an excluded directory.');
  }
  const python = metadata(compiled, configBytes, files, {
    entry, sourceScope: sourceRoot === undefined ? 'ENTRY_MODULE_ONLY' : 'SOURCE_DIRECTORY', declarationSourceFile,
  });
  return { compiled, configBytes, declaration, interpreterBase, sourceFiles: files, configSha256: python.configSha256,
    applicationSha256: python.applicationSha256, python };
}

function compiledFiles(compiled) {
  const offers = { schema: OFFERS_SCHEMA,
    offers: Object.entries(compiled.functions).map(([id, definition]) => ({ id, seller: definition.offer })) };
  return { offers, service: compiled.service, offersBytes: formatted(offers), serviceBytes: formatted(compiled.service) };
}
async function syncDirectory(path) {
  let handle;
  try { handle = await open(path, 'r'); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}
async function writeNew(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
async function privateParents(root, file) {
  const components = file.split('/').slice(0, -1);
  let path = root;
  for (const component of components) {
    path = join(path, component);
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await directory(path); }
  }
}

/** Create a new private release directory, retaining declarations and selected source. */
export async function stagePythonRelease(directoryPath, configPath, { sourceRoot } = {}) {
  const target = resolve(directoryPath);
  if (sourceRoot !== undefined) {
    await directory(resolve(sourceRoot));
    const canonicalRoot = await realpath(resolve(sourceRoot));
    const canonicalTarget = join(await realpath(dirname(target)), basename(target));
    if (inside(canonicalRoot, canonicalTarget))
      throw new TypeError('The release destination must be outside --python-root.');
  }
  const prepared = await preparePythonRelease(configPath, { sourceRoot });
  const runtimeDeclaration = retainedDeclaration(prepared.declaration, prepared.python.entry, prepared.interpreterBase);
  const runtimeBytes = formatted(runtimeDeclaration);
  const compiled = compilePythonMerchant(runtimeDeclaration, { baseDir: join(target, 'python') });
  const produced = compiledFiles(compiled);
  if (runtimeBytes.length > 2 * MiB || produced.offersBytes.length > 8 * MiB || produced.serviceBytes.length > 4 * MiB)
    throw new RangeError('Compiled Python release configuration exceeds its retained artifact limit.');
  const retained = [
    { ...descriptor(CONFIG, prepared.configBytes), data: prepared.configBytes },
    { ...descriptor(RUNTIME_CONFIG, runtimeBytes), data: runtimeBytes },
    ...prepared.sourceFiles,
  ];
  const manifest = { schema: PYTHON_SOURCE_SCHEMA, offersSha256: hash(produced.offersBytes),
    serviceConfigSha256: hash(produced.serviceBytes), python: prepared.python, interpreterBase: prepared.interpreterBase,
    files: order(retained.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 }))) };
  const manifestBytes = formatted(manifest);
  if (manifestBytes.length > 2 * MiB) throw new RangeError('Python source manifest exceeds its 2 MiB retained limit.');
  let created = false;
  try {
    await mkdir(target, { mode: 0o700 }); created = true;
    for (const { file, data } of retained) { await privateParents(target, file); await writeNew(join(target, file), data); }
    await writeNew(join(target, 'offers.json'), produced.offersBytes);
    await writeNew(join(target, 'seller-service.json'), produced.serviceBytes);
    await writeNew(join(target, 'manifest.json'), manifestBytes);
    await syncDirectory(target);
    return { manifest, offers: produced.offers, service: produced.service, compiled, python: prepared.python,
      files: order([descriptor('manifest.json', manifestBytes), descriptor('offers.json', produced.offersBytes),
        descriptor('seller-service.json', produced.serviceBytes), ...manifest.files]) };
  } catch (error) {
    if (created) await rm(target, { recursive: true, force: true });
    throw error;
  }
}

/** Verify the exact retained file set and recompile its original Python declaration. */
export async function inspectPythonRelease(directoryPath) {
  const path = resolve(directoryPath); await directory(path);
  const manifestBytes = await regular(join(path, 'manifest.json'), 2 * MiB), manifest = parse(manifestBytes);
  if (manifest.schema !== PYTHON_SOURCE_SCHEMA || !Array.isArray(manifest.files) ||
      !manifest.python || !['ENTRY_MODULE_ONLY', 'SOURCE_DIRECTORY'].includes(manifest.python.sourceScope))
    throw new TypeError('Expected a retained Python seller release.');
  const actual = await sourceFiles(join(path, 'python'), { prefix: 'python/' });
  const descriptors = actual.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 }));
  if (stable(descriptors) !== stable(manifest.files)) throw new Error('Retained Python source files were added, removed or changed. Stage the new application as another release.');
  const lookup = new Map(actual.map(file => [file.file, file]));
  if (!lookup.has(CONFIG) || !lookup.has(RUNTIME_CONFIG) || !validRelative(manifest.python.entry))
    throw new TypeError('The Python release is missing its declaration, runtime configuration or entry.');
  const configBytes = lookup.get(CONFIG).data, declaration = parse(configBytes);
  const runtimeDeclaration = parse(lookup.get(RUNTIME_CONFIG).data);
  const expected = retainedDeclaration(declaration, manifest.python.entry, manifest.interpreterBase ?? null);
  if (stable(runtimeDeclaration) !== stable(expected)) throw new Error('Python runtime configuration no longer matches the retained original declaration.');
  const files = actual.filter(file => file.file.startsWith(SOURCE));
  if (files.length !== actual.length - 2 || files.length > MAX_FILES ||
      files.reduce((bytes, file) => bytes + file.bytes, 0) > MAX_SOURCE_BYTES)
    throw new TypeError('The Python release has an invalid source layout.');
  if (manifest.python.sourceScope === 'ENTRY_MODULE_ONLY' && files.length !== 1)
    throw new TypeError('An entry-only Python release cannot acquire additional source files.');
  const declarationSourceFile = manifest.python.declarationSourceFile;
  if (declarationSourceFile !== null && (!validRelative(declarationSourceFile) ||
      !declarationSourceFile.startsWith(SOURCE) || lookup.get(declarationSourceFile)?.sha256 !== hash(configBytes)))
    throw new Error('The declaration retained inside the Python source directory changed.');
  const compiled = compilePythonMerchant(runtimeDeclaration, { baseDir: join(path, 'python') });
  const python = metadata(compiled, configBytes, files, {
    entry: manifest.python.entry, sourceScope: manifest.python.sourceScope, declarationSourceFile,
  });
  if (stable(python) !== stable(manifest.python)) throw new Error('Python execution metadata no longer matches its retained source.');
  const offersBytes = await regular(join(path, 'offers.json'), 8 * MiB);
  const serviceBytes = await regular(join(path, 'seller-service.json'), 4 * MiB);
  const produced = compiledFiles(compiled);
  if (hash(offersBytes) !== manifest.offersSha256 || hash(serviceBytes) !== manifest.serviceConfigSha256 ||
      !offersBytes.equals(produced.offersBytes) || !serviceBytes.equals(produced.serviceBytes))
    throw new Error('Python offers or service configuration differ from the original merchant compiler.');
  return { manifest, offers: produced.offers, service: produced.service, compiled, python,
    files: order([descriptor('manifest.json', manifestBytes), descriptor('offers.json', offersBytes),
      descriptor('seller-service.json', serviceBytes), ...descriptors]) };
}

function listenerDigest(offers) { return hash(offers.map(offer => JSON.stringify(offer)).sort().join('\n')); }
async function readListener(seller, snapshot) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(seller.url)) throw new TypeError('The original Python seller must report its loopback listener.');
  const [healthResponse, offersResponse] = await Promise.all([
    fetch(seller.url + '/_seller/health', { signal: AbortSignal.timeout(4000), redirect: 'error' }),
    fetch(seller.url + '/_seller/offers', { signal: AbortSignal.timeout(4000), redirect: 'error' }),
  ]);
  if (!healthResponse.ok || !offersResponse.ok) throw new Error('Python seller listener readback failed.');
  const [health, offers] = await Promise.all([healthResponse.json(), offersResponse.json()]);
  const expectedDigest = listenerDigest(snapshot.offers.offers.map(offer => offer.seller));
  if (health.schema !== 'stellar-forge.seller-service.v1' || health.mode !== seller.mode ||
      !Array.isArray(health.routes) || health.routes.length !== snapshot.service.routes.length ||
      !Array.isArray(offers) || listenerDigest(offers) !== expectedDigest)
    throw new Error('The running original Python seller differs from its retained release.');
  return { health, expectedDigest };
}
async function atomic(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try { await writeNew(temporary, formatted(value)); await rename(temporary, path); await syncDirectory(dirname(path)); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function nativeFactoryFor(runtime) {
  if (!runtime.facilitator) return null;
  const endpoint = new URL(runtime.facilitator);
  const local = runtime.allowLocalFacilitator === true && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
  if ((!local && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new TypeError('Facilitator requires a credential-free HTTPS URL, or explicitly enabled loopback HTTP.');
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../sf30-seller-sdk/native-factory.mjs'),
  ]);
  return routes => createNativeSellerServer(routes, { facilitatorClient: new HTTPFacilitatorClient({ url: endpoint.href.replace(/\/$/, '') }) });
}

/** Entry for the existing SF82 release child; it retains original merchant shutdown. */
export async function launch(args = process.argv.slice(2), deps = {}) {
  if (args.length !== 2 || args[0] !== '--resume') throw new TypeError('Usage: node release-python.mjs --resume RELEASE_DIRECTORY');
  const path = resolve(args[1]), snapshot = await inspectPythonRelease(path);
  const saved = parse(await regular(join(path, 'pilot-runtime.json'), 65536));
  if (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' ||
      saved.source?.offersSha256 !== snapshot.manifest.offersSha256 ||
      saved.source?.serviceConfigSha256 !== snapshot.manifest.serviceConfigSha256)
    throw new Error('Python runtime options belong to a different retained release.');
  const runtime = saved.options;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)) ||
      !/^\d{1,5}$/.test(String(runtime.port)) || Number(runtime.port) > 65535 ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean' ||
      runtime.allowLocalFacilitator && !runtime.facilitator)
    throw new TypeError('Invalid retained Python release runtime options.');
  const nativeFactory = deps.nativeFactory ?? await nativeFactoryFor(runtime);
  let session, starting, closing, interrupted = false;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      try {
        const current = session ?? await starting?.catch(() => null);
        return await current?.close() ?? null;
      } finally {
        process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
      }
    })();
    return closing;
  };
  const onSignal = () => {
    interrupted = true;
    close().then(shutdown => {
      process.stdout.write(JSON.stringify({ status: shutdown?.clean === false ? 'MERCHANT_STOP_INCOMPLETE' : 'MERCHANT_STOPPED', shutdown }) + '\n');
      if (shutdown?.clean === false) process.exitCode = 1;
    }).catch(() => { process.stderr.write('PYTHON_MERCHANT_SHUTDOWN_FAILED\n'); process.exitCode = 1; });
  };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    starting = startPythonMerchant(snapshot.compiled, { port: Number(runtime.port), nativeFactory,
      expectedApplicationSha256: snapshot.python.applicationSha256 });
    session = await starting;
    if (interrupted) throw new Error('Python seller startup was interrupted.');
    const { health, expectedDigest } = await readListener(session.seller, snapshot);
    if (interrupted) throw new Error('Python seller startup was interrupted.');
    const receipt = { schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: snapshot.manifest.offersSha256, originalServiceConfigSha256: snapshot.manifest.serviceConfigSha256,
      nativeOfferDigestSha256: expectedDigest, runtimeMode: session.seller.mode, runtime,
      routeCount: health.routes.length, listener: session.seller.url,
      healthEndpoint: session.seller.url + '/_seller/health', offersEndpoint: session.seller.url + '/_seller/offers',
      python: snapshot.python, pythonStarted: Boolean(session.source),
      paidRequestsSent: 0, settlementVerified: false, buyerAdoptionVerified: false };
    await atomic(join(path, 'runtime-readiness.json'), receipt);
    if (interrupted) throw new Error('Python seller startup was interrupted.');
    process.stdout.write(JSON.stringify({ pilotReady: true, ...receipt, output: path, routes: health.routes }) + '\n');
    return { ...session.seller, source: session.source, python: snapshot.python, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  launch().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
