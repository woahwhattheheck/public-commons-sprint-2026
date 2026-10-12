import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'stellar-forge.stellar-indexer-runtime.v1';
const SDK_ALIAS = '@stellar-indexer/stellar-indexer-sdk';
const SDK_NATIVE = '@jsr/stellar-indexer__stellar-indexer-sdk';
const SDK_VERSION = '0.0.13';
const MERCHANT_VERSION = '2.28.0';
const MERCHANT_EXPORTS = [
  {packageName:'@x402/core', specifier:'@x402/core/server'},
  {packageName:'@x402/stellar', specifier:'@x402/stellar/exact/server'},
  {packageName:'@x402/extensions', specifier:'@x402/extensions/bazaar'}
];
const CAPSULE_SHA256 = 'b12034bd1032d80bc5810be9a999c52a5ae363a82a55a224916fee37cf93829b';
const EXPORTS = ['.', './protocols/blend', './protocols/stellardomains', './protocols/reflector', './protocols/xbull-swap', './protocols/axis-markets'];
const BUFFER_BYTES = 256 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const PACKAGE_NAME = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const VCS = new Set(['.git', '.hg', '.svn']);

export class IndexerRuntimeError extends Error {
  constructor(code, details = {}, cause) {
    super(code, cause ? {cause} : undefined);
    this.name = 'IndexerRuntimeError';
    this.code = code;
    this.details = details;
  }
  toJSON() { return {code: this.code, details: this.details}; }
}
function fail(code, details, cause) { throw new IndexerRuntimeError(code, details, cause); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function identity(manifest) {
  const {id, ...body} = manifest;
  return sha256(Buffer.from(canonical(body)));
}
function absolute(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) fail('RUNTIME_PATH_REQUIRED', {field});
  return path.resolve(value);
}
function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '.' || part === '..')) fail('RUNTIME_PATH_INVALID', {path: value});
  return value;
}
function join(root, value) { return path.join(root, ...relative(value).split('/')); }
function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function mode(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0o777) fail('RUNTIME_MODE_INVALID', {mode: value});
  return value;
}
function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('RUNTIME_MANIFEST_INVALID', {field});
  return value;
}
function hash(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('RUNTIME_DIGEST_INVALID', {field});
  return value;
}
function linkTarget(link) {
  relative(link.path);
  if (typeof link.target !== 'string' || !link.target || link.target.includes('\0') || link.target.includes('\\') ||
      path.posix.isAbsolute(link.target)) fail('RUNTIME_LINK_INVALID', {path: link.path});
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(link.path), link.target));
  if (!target || target === '.' || target === '..' || target.startsWith('../')) fail('RUNTIME_LINK_ESCAPE', {path: link.path});
  return relative(target);
}
async function lstatMaybe(filename) {
  try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directory(filename) {
  const info = await lstatMaybe(filename);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) fail('RUNTIME_DIRECTORY_REQUIRED', {path: filename});
  return info;
}
async function safeParents(root, relativePath, {create = false} = {}) {
  const parts = relative(relativePath).split('/');
  let current = root;
  await directory(root);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (create) {
      try { await fs.mkdir(current, {mode: 0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await directory(current);
  }
}
async function syncDirectory(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function readFile(filename, maximumBytes = 64 * 1024 * 1024) {
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximumBytes) fail('RUNTIME_FILE_INVALID', {path: filename, bytes: info.size});
    const bytes = await handle.readFile();
    if (bytes.length !== info.size) fail('RUNTIME_SOURCE_CHANGED', {path: filename});
    return bytes;
  } finally { await handle.close(); }
}
async function readJSON(filename, maximumBytes) {
  const bytes = await readFile(filename, maximumBytes);
  try { return {bytes, value: JSON.parse(bytes.toString('utf8'))}; }
  catch (error) { fail('RUNTIME_JSON_INVALID', {path: filename}, error); }
}
function fingerprint(info) {
  return [String(info.dev), String(info.ino), String(info.size), String(info.mtimeNs), String(info.ctimeNs)].join(':');
}
async function inspectFile(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({bigint: true});
    if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('RUNTIME_FILE_INVALID', {path: filename});
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
    }
    const after = await handle.stat({bigint: true});
    if (fingerprint(before) !== fingerprint(after) || BigInt(bytes) !== before.size) fail('RUNTIME_SOURCE_CHANGED', {path: filename});
    return {bytes, sha256: digest.digest('hex'), mode: Number(before.mode & 0o777n), fingerprint: fingerprint(before)};
  } finally { await handle.close(); }
}
async function atomicBytes(root, relativePath, bytes, fileMode = 0o600) {
  await safeParents(root, relativePath, {create: true});
  const filename = join(root, relativePath);
  const temporary = filename + '.partial-' + randomUUID();
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.chmod(fileMode);
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, filename);
    await syncDirectory(path.dirname(filename));
  } finally { await fs.rm(temporary, {force: true}); }
}
function descriptor(directory, manifest, manifestSha256) {
  return {
    id: manifest.id, directory, manifest, manifestSha256,
    entrypoint: join(directory, manifest.entrypoints['.']),
    entrypoints: Object.fromEntries(Object.entries(manifest.entrypoints).map(([name, target]) => [name, join(directory, target)])),
    packageBindings: Object.fromEntries(Object.entries(manifest.packageBindings).map(([name, target]) => [name, join(directory, target)]))
  };
}

async function packageAt(lookup) {
  const entry = await lstatMaybe(lookup);
  if (!entry) return null;
  const root = await fs.realpath(lookup);
  await directory(root);
  const loaded = await readJSON(path.join(root, 'package.json'), 16 * 1024 * 1024);
  if (!object(loaded.value) || typeof loaded.value.name !== 'string' || typeof loaded.value.version !== 'string')
    fail('RUNTIME_PACKAGE_INVALID', {path: lookup});
  return {root, lookup: path.resolve(lookup), metadata: loaded.value, packageBytes: loaded.bytes};
}
async function resolvePackage(name, from) {
  if (!PACKAGE_NAME.test(name)) fail('RUNTIME_PACKAGE_NAME_INVALID', {name});
  let current = await fs.realpath(from);
  while (true) {
    if (path.basename(current) !== 'node_modules') {
      const candidate = path.join(current, 'node_modules', ...name.split('/'));
      if (await lstatMaybe(candidate)) return packageAt(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
async function installedChildren(nodeModules) {
  const children = [];
  const entries = (await fs.readdir(nodeModules, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scope = path.join(nodeModules, entry.name);
      if (!(await fs.stat(scope)).isDirectory()) continue;
      for (const item of (await fs.readdir(scope, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const lookup = path.join(scope, item.name);
        if (await lstatMaybe(path.join(lookup, 'package.json'))) children.push({name: entry.name + '/' + item.name, lookup});
      }
    } else {
      const lookup = path.join(nodeModules, entry.name);
      if (await lstatMaybe(path.join(lookup, 'package.json'))) children.push({name: entry.name, lookup});
    }
  }
  return children;
}
async function discover(installationDirectory) {
  const first = await resolvePackage(SDK_ALIAS, installationDirectory) ?? await resolvePackage(SDK_NATIVE, installationDirectory);
  if (!first) fail('INDEXER_SDK_NOT_INSTALLED', {installationDirectory, package: SDK_ALIAS, version: SDK_VERSION});
  if (first.metadata.name !== SDK_NATIVE || first.metadata.version !== SDK_VERSION)
    fail('INDEXER_SDK_VERSION_MISMATCH', {expected: {name: SDK_NATIVE, version: SDK_VERSION}, actual: {name: first.metadata.name, version: first.metadata.version}});
  const packages = [], byRoot = new Map(), byLookup = new Map();
  function add(found, requiredByIndexer = false) {
    let node = byRoot.get(found.root);
    if (!node) {
      node = {...found, id: 'p' + String(packages.length).padStart(4, '0'), requiredByIndexer, dependencies: [], installed: []};
      node.path = 'packages/' + node.id;
      packages.push(node);
      byRoot.set(node.root, node);
    }
    if (requiredByIndexer) node.requiredByIndexer = true;
    byLookup.set(found.lookup, node);
    return node;
  }
  const root = add(first, true);
  const merchant = [];
  for (const selection of MERCHANT_EXPORTS) {
    let resolutionDirectory = installationDirectory;
    let found = await resolvePackage(selection.packageName, resolutionDirectory);
    if (!found) {
      // The original paid-service factory is one directory above this module.
      // A separately installed Indexer project need not duplicate that host's
      // already selected merchant packages.
      resolutionDirectory = path.dirname(HERE);
      found = await resolvePackage(selection.packageName, resolutionDirectory);
    }
    const node = found ? add(found, false) : null;
    merchant.push({...selection, packageId:node?.id ?? null, resolutionDirectory});
  }
  for (let index = 0; index < packages.length; index++) {
    const node = packages[index];
    const declarations = new Map();
    for (const [name, range] of Object.entries(node.metadata.dependencies ?? {}))
      declarations.set(name, {name, range, kind: 'dependency', optional: false});
    for (const [name, range] of Object.entries(node.metadata.optionalDependencies ?? {}))
      declarations.set(name, {name, range, kind: 'optional', optional: true});
    for (const [name, range] of Object.entries(node.metadata.peerDependencies ?? {})) {
      if (!declarations.has(name))
        declarations.set(name, {name, range, kind: 'peer', optional: node.metadata.peerDependenciesMeta?.[name]?.optional === true});
    }
    for (const dependency of [...declarations.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const found = await resolvePackage(dependency.name, node.root);
      if (!found) {
        node.dependencies.push({...dependency, packageId: null, present: false});
      } else {
        const selected = add(found, node.requiredByIndexer && !dependency.optional);
        node.dependencies.push({...dependency, packageId: selected.id, present: true});
      }
    }
    async function scan(current, rel = '') {
      for (const entry of (await fs.readdir(current, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        if (VCS.has(entry.name)) continue;
        const filename = path.join(current, entry.name);
        const childRel = rel ? rel + '/' + entry.name : entry.name;
        if (entry.name === 'node_modules' && entry.isDirectory()) {
          for (const child of await installedChildren(filename)) {
            const found = await packageAt(child.lookup);
            const selected = add(found);
            node.installed.push({path: childRel + '/' + child.name, name: child.name, packageId: selected.id});
          }
          continue;
        }
        if (entry.isDirectory()) {
          const other = byRoot.get(filename);
          if (!other || other === node) await scan(filename, childRel);
        }
      }
    }
    await scan(node.root);
  }
  let promoted;
  do {
    promoted = false;
    for (const node of packages.filter(item => item.requiredByIndexer)) {
      for (const edge of node.dependencies.filter(item => item.present && !item.optional)) {
        const target = packages.find(item => item.id === edge.packageId);
        if (!target.requiredByIndexer) { target.requiredByIndexer = true; promoted = true; }
      }
    }
  } while (promoted);
  for (const node of packages.filter(item => item.requiredByIndexer)) {
    for (const edge of node.dependencies.filter(item => !item.present && !item.optional))
      fail('RUNTIME_DEPENDENCY_MISSING', {package:node.metadata.name, dependency:edge.name, range:edge.range});
  }
  return {root, packages, byRoot, byLookup, merchant};
}
async function nativeEntrypoints(graph, installationDirectory) {
  const selectedName = graph.root.lookup.endsWith(path.join('node_modules', ...SDK_NATIVE.split('/'))) ? SDK_NATIVE : SDK_ALIAS;
  const request = {
    name: selectedName, exports: EXPORTS,
    parent: pathToFileURL(path.join(installationDirectory, '__indexer_source_resolution__.mjs')).href
  };
  // This is Node's original import resolver, in a process that imports only its
  // built-ins. Resolving an export reads metadata and never evaluates SDK code.
  const resolver = 'const request=JSON.parse(process.argv[1]);const result={};' +
    'for(const key of request.exports){result[key]=await import.meta.resolve(' +
    'request.name+(key==="."?"":key.slice(1)),request.parent);}' +
    'process.stdout.write(JSON.stringify(result));';
  const environment = {...process.env};
  delete environment.NODE_OPTIONS;
  let output;
  try {
    output = await promisify(execFile)(process.execPath, [
      '--experimental-import-meta-resolve', '--input-type=module', '--eval', resolver, JSON.stringify(request)
    ], {cwd: installationDirectory, env: environment, timeout: 30000, maxBuffer: 1024 * 1024});
  } catch (error) { fail('RUNTIME_SDK_EXPORT_RESOLUTION_FAILED', {package: selectedName, version: SDK_VERSION}, error); }
  let entries;
  try { entries = JSON.parse(output.stdout); } catch (error) { fail('RUNTIME_SDK_EXPORT_RESOLUTION_FAILED', {}, error); }
  const result = {};
  for (const name of EXPORTS) {
    let selected;
    try { selected = new URL(entries[name]); } catch { fail('RUNTIME_SDK_EXPORT_UNAVAILABLE', {export: name}); }
    if (selected.protocol !== 'file:' || selected.search || selected.hash) fail('RUNTIME_SDK_EXPORT_UNAVAILABLE', {export: name});
    result[name] = await fs.realpath(fileURLToPath(selected));
    if (!within(graph.root.root, result[name])) fail('RUNTIME_SDK_EXPORT_INVALID', {export: name});
  }
  return result;
}

async function nativeMerchant(graph, installationDirectory, mapPhysical) {
  const entries = {}, issues = [];
  const installed = graph.merchant.filter(item => item.packageId);
  let resolved = {};
  if (installed.length) {
    const request = {entries:installed.map(item=>({specifier:item.specifier,
      parent:pathToFileURL(path.join(item.resolutionDirectory, '__merchant_source_resolution__.mjs')).href}))};
    const resolver = 'const request=JSON.parse(process.argv[1]);const result={};' +
      'for(const entry of request.entries){const key=entry.specifier;try{result[key]={url:await import.meta.resolve(key,entry.parent)};}' +
      'catch(error){result[key]={error:String(error.code||error.name)};}}process.stdout.write(JSON.stringify(result));';
    const environment = {...process.env}; delete environment.NODE_OPTIONS;
    try {
      const output = await promisify(execFile)(process.execPath, [
        '--experimental-import-meta-resolve','--input-type=module','--eval',resolver,JSON.stringify(request)
      ],{cwd:installationDirectory,env:environment,timeout:30000,maxBuffer:1024*1024});
      resolved = JSON.parse(output.stdout);
    } catch (error) { issues.push({code:'MERCHANT_EXPORT_RESOLUTION_FAILED', error:String(error.code??error.name)}); }
  }
  for (const selected of graph.merchant) {
    const node = graph.packages.find(item => item.id === selected.packageId);
    const problems = [];
    let entrypoint = null;
    if (!node) problems.push({code:'PACKAGE_NOT_INSTALLED', packageName:selected.packageName});
    else {
      if (node.metadata.name !== selected.packageName)
        problems.push({code:'PACKAGE_NAME_MISMATCH',required:selected.packageName,actual:node.metadata.name});
      if (node.metadata.version !== MERCHANT_VERSION)
        problems.push({code:'PACKAGE_VERSION_MISMATCH', required:MERCHANT_VERSION, actual:node.metadata.version});
      const seen = new Set(), queue = [node];
      for (let index=0;index<queue.length;index++) {
        const current=queue[index]; if(seen.has(current.id))continue; seen.add(current.id);
        for (const edge of current.dependencies) {
          if (!edge.present && !edge.optional)
            problems.push({code:'DEPENDENCY_NOT_INSTALLED', packageName:current.metadata.name, dependency:edge.name, range:edge.range});
          if (edge.present) queue.push(graph.packages.find(item=>item.id===edge.packageId));
        }
      }
      const native = resolved[selected.specifier];
      if (native?.url) {
        try {
          const url = new URL(native.url);
          if (url.protocol !== 'file:' || url.search || url.hash) throw new Error('UNSUPPORTED_EXPORT_URL');
          const physical = await fs.realpath(fileURLToPath(url));
          entrypoint = mapPhysical(physical);
          if (!entrypoint) throw new Error('EXPORT_OUTSIDE_RETAINED_SOURCE');
        } catch (error) { problems.push({code:'MERCHANT_EXPORT_UNAVAILABLE', error:String(error.code??error.message)}); }
      } else problems.push({code:'MERCHANT_EXPORT_UNAVAILABLE', error:native?.error??'RESOLVER_UNAVAILABLE'});
    }
    entries[selected.specifier] = {packageName:selected.packageName,packageId:node?.id??null,
      actualPackageName:node?.metadata.name??null,version:node?.metadata.version??null,
      available:problems.length===0,entrypoint,issues:problems};
    issues.push(...problems.map(item=>({...item,specifier:selected.specifier})));
  }
  const available = Object.values(entries).every(item=>item.available) && issues.length===0;
  return {available,status:available?'available':installed.length?'partial':'missing',
    requiredVersion:MERCHANT_VERSION,entries,issues};
}

async function publisherSources() {
  const capsuleFile = path.join(HERE, 'source', 'stellar-indexer-sdk-0.0.13.json');
  const registryFile = path.join(HERE, 'source', 'npm-registry-metadata.json');
  const capsule = await readJSON(capsuleFile, 4 * 1024 * 1024);
  if (sha256(capsule.bytes) !== CAPSULE_SHA256) fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH', {source: 'stellar-indexer-sdk-0.0.13.json'});
  const value = capsule.value;
  if (value.schema !== 'tjlabs.original-source-capsule.v1' || value.source?.package !== SDK_ALIAS ||
      value.source?.version !== SDK_VERSION || !Array.isArray(value.files) || value.files.length !== 28 ||
      value.fileCount !== value.files.length) fail('RUNTIME_PUBLISHER_CAPSULE_INVALID');
  const root = 'publisher/stellar-indexer-sdk-0.0.13';
  const files = [{path: root + '/capsule.json', content: capsule.bytes, mode: 0o644}];
  let bytes = 0;
  const seen = new Set();
  for (const item of value.files) {
    if (typeof item.path !== 'string' || !item.path.startsWith('/') || typeof item.content !== 'string') fail('RUNTIME_PUBLISHER_CAPSULE_INVALID');
    const rel = relative(item.path.slice(1));
    if (seen.has(rel)) fail('RUNTIME_PUBLISHER_CAPSULE_INVALID', {path: rel});
    seen.add(rel);
    const body = Buffer.from(item.content);
    if (body.length !== item.bytes || sha256(body) !== item.sha256) fail('RUNTIME_PUBLISHER_MEMBER_MISMATCH', {path: rel});
    bytes += body.length;
    files.push({path: root + '/source/' + rel, content: body, mode: 0o644});
  }
  if (bytes !== value.bytes) fail('RUNTIME_PUBLISHER_CAPSULE_INVALID', {field: 'bytes'});
  const original = value.source.originalManifest;
  if (!object(original) || typeof original.content !== 'string') fail('RUNTIME_PUBLISHER_CAPSULE_INVALID', {field: 'originalManifest'});
  const originalBytes = Buffer.from(original.content);
  if (originalBytes.length !== original.bytes || sha256(originalBytes) !== original.sha256)
    fail('RUNTIME_PUBLISHER_MANIFEST_MISMATCH');
  files.push({path: root + '/original-manifest.json', content: originalBytes, mode: 0o644});
  const registry = await readJSON(registryFile, 16 * 1024 * 1024);
  if (createHash('sha1').update('blob ' + registry.bytes.length + '\0').update(registry.bytes).digest('hex') !== 'd0fd0e9ef4ca9e6bc4982f0f9da76cb17185d856')
    fail('RUNTIME_PUBLISHER_REGISTRY_MISMATCH');
  const released = registry.value.versions?.[SDK_VERSION];
  if (registry.value.name !== SDK_NATIVE || released?.name !== SDK_NATIVE || released?.version !== SDK_VERSION ||
      released?.dist?.tarball !== 'https://npm.jsr.io/~/11/@jsr/stellar-indexer__stellar-indexer-sdk/0.0.13.tgz' ||
      released?.dist?.shasum?.toLowerCase() !== 'b77d9dfa11fe26110b73fbeffd49d9fbb66d5abc')
    fail('RUNTIME_PUBLISHER_REGISTRY_MISMATCH');
  files.push({path: 'publisher/npm-registry-metadata.json', content: registry.bytes, mode: 0o644});
  return {
    files,
    description: {
      capsule: {path: root + '/capsule.json', bytes: capsule.bytes.length, sha256: sha256(capsule.bytes)},
      originalManifest: {path: root + '/original-manifest.json', bytes: originalBytes.length, sha256: sha256(originalBytes)},
      source: {directory: root + '/source', fileCount: value.files.length, bytes},
      registry: {path: 'publisher/npm-registry-metadata.json', bytes: registry.bytes.length, sha256: sha256(registry.bytes)},
      publishedTarball: released.dist
    }
  };
}

async function planRuntime(installationDirectory) {
  const graph = await discover(installationDirectory);
  const publisher = await publisherSources();
  const files = new Map(), directories = new Map(), links = new Map(), sources = new Map();
  const resources = [], resourceByRoot = new Map();
  const pendingLinks = [];
  function addDirectory(rel, permissions = 0o755) {
    relative(rel);
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/');
      if (!directories.has(name)) directories.set(name, {path: name, mode: i === parts.length ? permissions : 0o755});
    }
  }
  function parents(rel) {
    const parent = path.posix.dirname(rel);
    if (parent !== '.') addDirectory(parent);
  }
  function addLink(rel, targetPath, original = null) {
    parents(rel);
    const target = path.posix.relative(path.posix.dirname(rel), targetPath);
    const row = {path: rel, target, ...(original === null ? {} : {originalTarget: original})};
    linkTarget(row);
    const previous = links.get(rel);
    if (previous && previous.target !== target) fail('RUNTIME_RESOLUTION_CONFLICT', {path: rel});
    links.set(rel, row);
  }
  async function addFile(filename, rel) {
    parents(rel);
    const info = await inspectFile(filename);
    const previous = files.get(rel);
    if (previous && (previous.sha256 !== info.sha256 || previous.mode !== info.mode))
      fail('RUNTIME_PATH_CONFLICT', {path: rel});
    files.set(rel, {path: rel, bytes: info.bytes, sha256: info.sha256, mode: info.mode});
    sources.set(rel, {filename, fingerprint: info.fingerprint});
  }
  function mapPhysical(filename) {
    const choices = [
      ...graph.packages.map(node => ({root: node.root, path: node.path})),
      ...resources.map(resource => ({root: resource.root, path: resource.path}))
    ].filter(item => within(item.root, filename)).sort((a, b) => b.root.length - a.root.length);
    if (!choices.length) return null;
    const chosen = choices[0];
    const rel = path.relative(chosen.root, filename).split(path.sep).join('/');
    return rel ? chosen.path + '/' + rel : chosen.path;
  }
  async function walk(filename, rel, ownRoot, {skipVcs = true} = {}) {
    const info = await fs.lstat(filename);
    if (info.isSymbolicLink()) {
      pendingLinks.push({filename, path: rel, original: await fs.readlink(filename)});
      return;
    }
    const packageNode = graph.byRoot.get(filename);
    if (packageNode && filename !== ownRoot) {
      addLink(rel, packageNode.path);
      return;
    }
    if (info.isDirectory()) {
      addDirectory(rel, info.mode & 0o777);
      for (const child of (await fs.readdir(filename, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        if (skipVcs && VCS.has(child.name)) continue;
        await walk(path.join(filename, child.name), rel + '/' + child.name, ownRoot, {skipVcs});
      }
    } else if (info.isFile()) {
      await addFile(filename, rel);
    } else fail('RUNTIME_SOURCE_FILE_TYPE_UNSUPPORTED', {path: filename});
  }
  for (const node of graph.packages) await walk(node.root, node.path, node.root);
  for (let index = 0; index < pendingLinks.length; index++) {
    const item = pendingLinks[index];
    let target;
    try { target = await fs.realpath(item.filename); }
    catch (error) { fail('RUNTIME_SOURCE_LINK_UNAVAILABLE', {path: item.filename}, error); }
    let mapped = mapPhysical(target);
    if (!mapped) {
      let resource = resourceByRoot.get(target);
      if (!resource) {
        resource = {root: target, path: 'resources/r' + String(resources.length).padStart(4, '0')};
        resources.push(resource);
        resourceByRoot.set(target, resource);
        await walk(target, resource.path, target);
      }
      mapped = resource.path;
    }
    addLink(item.path, mapped, item.original);
  }
  // Preserve each package's actual effective Node resolution, even when npm
  // hoisted a dependency to an ancestor outside that original package.
  for (const node of graph.packages) {
    for (const dependency of node.dependencies) {
      if (!dependency.present) continue;
      const selected = graph.packages.find(item => item.id === dependency.packageId);
      addLink(node.path + '/node_modules/' + dependency.name, selected.path);
    }
    for (const item of node.installed) {
      const selected = graph.packages.find(candidate => candidate.id === item.packageId);
      addLink(node.path + '/' + item.path, selected.path);
    }
  }
  addLink('node_modules/' + SDK_ALIAS, graph.root.path);
  for (const selected of graph.merchant) {
    if (selected.packageId) addLink('node_modules/' + selected.packageName,
      graph.packages.find(item => item.id === selected.packageId).path);
  }
  if (graph.root.lookup.endsWith(path.join('node_modules', ...SDK_NATIVE.split('/'))))
    addLink('node_modules/' + SDK_NATIVE, graph.root.path);
  // Keep original npm wrapper bytes in their original .bin relationship to
  // package aliases. Relative paths inside a native wrapper therefore retain
  // their meaning after receiving, including Windows companion wrappers.
  const wrapperContexts = new Map();
  for (const node of graph.packages) {
    const bin = typeof node.metadata.bin === 'string'
      ? {[node.metadata.name.split('/').at(-1)]: node.metadata.bin}
      : object(node.metadata.bin) ? node.metadata.bin : {};
    for (const selectedLookup of [...graph.byLookup.entries()].filter(([, selected]) => selected === node).map(([lookup]) => lookup)) {
      const packageParts = selectedLookup.split(path.sep);
      const at = packageParts.lastIndexOf('node_modules');
      if (at < 0) continue;
      const moduleDirectory = packageParts.slice(0, at + 1).join(path.sep) || path.sep;
      for (const name of Object.keys(bin).sort()) {
        if (!/^[A-Za-z0-9._-]+$/.test(name)) fail('RUNTIME_BIN_NAME_INVALID', {name});
        for (const suffix of ['', '.cmd', '.ps1']) {
          const wrapper = path.join(moduleDirectory, '.bin', name + suffix);
          if (!(await lstatMaybe(wrapper))) continue;
          let context = wrapperContexts.get(moduleDirectory);
          if (!context) {
            context = {path: 'wrappers/w' + String(wrapperContexts.size).padStart(4, '0') + '/node_modules'};
            wrapperContexts.set(moduleDirectory, context);
            addDirectory(context.path + '/.bin');
            for (const [lookup, selected] of graph.byLookup) {
              const rel = path.relative(moduleDirectory, lookup).split(path.sep).join('/');
              if (PACKAGE_NAME.test(rel)) addLink(context.path + '/' + rel, selected.path);
            }
          }
          const destination = context.path + '/.bin/' + name + suffix;
          const info = await fs.lstat(wrapper);
          if (info.isSymbolicLink()) {
            const target = await fs.realpath(wrapper), mapped = mapPhysical(target);
            if (!mapped) fail('RUNTIME_BIN_TARGET_UNAVAILABLE', {package: node.metadata.name, bin: name});
            addLink(destination, mapped, await fs.readlink(wrapper));
          } else if (info.isFile()) await addFile(wrapper, destination);
          else fail('RUNTIME_SOURCE_FILE_TYPE_UNSUPPORTED', {path: wrapper});
        }
      }
    }
  }
  for (const item of publisher.files) {
    parents(item.path);
    files.set(item.path, {path: item.path, bytes: item.content.length, sha256: sha256(item.content), mode: item.mode});
    sources.set(item.path, {content: item.content});
  }
  const entrypoints = {};
  const nativeEntries = await nativeEntrypoints(graph, installationDirectory);
  for (const name of EXPORTS) {
    const mapped = mapPhysical(nativeEntries[name]);
    if (!mapped || !files.has(mapped) || !/\.(?:mjs|cjs|js)$/.test(mapped))
      fail('RUNTIME_SDK_EXPORT_UNAVAILABLE', {export: name});
    entrypoints[name] = mapped;
  }
  for (const node of graph.packages) {
    const captured = files.get(node.path + '/package.json');
    if (!captured || captured.sha256 !== sha256(node.packageBytes))
      fail('RUNTIME_SOURCE_CHANGED', {package: node.metadata.name, member: 'package.json'});
  }
  for (const rel of files.keys()) if (directories.has(rel) || links.has(rel)) fail('RUNTIME_PATH_CONFLICT', {path: rel});
  for (const rel of directories.keys()) if (links.has(rel)) fail('RUNTIME_PATH_CONFLICT', {path: rel});
  const merchant = await nativeMerchant(graph, installationDirectory, mapPhysical);
  const packageBindings = {[SDK_ALIAS]: graph.root.path};
  if (links.has('node_modules/' + SDK_NATIVE)) packageBindings[SDK_NATIVE] = graph.root.path;
  for (const selected of graph.merchant) if (selected.packageId)
    packageBindings[selected.packageName] = graph.packages.find(item => item.id === selected.packageId).path;
  const sortedFiles = [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {
    schema: SCHEMA,
    sdk: {
      requestedName: SDK_ALIAS, packageName: graph.root.metadata.name, version: SDK_VERSION,
      packageId: graph.root.id, jsrRevision: graph.root.metadata._jsr_revision ?? null,
      packageJsonSha256: sha256(graph.root.packageBytes)
    },
    runtime: {
      nodeVersion: process.version, platform: process.platform, architecture: process.arch,
      modulesAbi: process.versions.modules, hasNativeAddons: sortedFiles.some(item => item.path.endsWith('.node'))
    },
    entrypoints,
    packageBindings,
    integrations: {merchant},
    packages: graph.packages.map(node => ({
      id: node.id, path: node.path, name: node.metadata.name, version: node.metadata.version,
      packageJsonSha256: sha256(node.packageBytes), requiredByIndexer:node.requiredByIndexer,
      jsrRevision: node.metadata._jsr_revision ?? null, engines: node.metadata.engines ?? null,
      dependencies: node.dependencies, installed: node.installed
    })),
    resources: resources.map(resource => ({path: resource.path})),
    publisher: publisher.description,
    directories: [...directories.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')),
    links: [...links.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')),
    files: sortedFiles,
    fileCount: sortedFiles.length,
    bytes: sortedFiles.reduce((sum, item) => sum + item.bytes, 0)
  };
  count(manifest.bytes, 'bytes');
  manifest.id = identity(manifest);
  validateManifest(manifest);
  return {manifest, sources};
}

function validateManifest(manifest) {
  if (!object(manifest) || manifest.schema !== SCHEMA || !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.directories) || !Array.isArray(manifest.links) || !Array.isArray(manifest.packages) ||
      !object(manifest.entrypoints) || manifest.sdk?.packageName !== SDK_NATIVE || manifest.sdk?.version !== SDK_VERSION)
    fail('RUNTIME_MANIFEST_INVALID');
  hash(manifest.id, 'id');
  if (identity(manifest) !== manifest.id) fail('RUNTIME_ID_MISMATCH');
  const paths = new Map();
  for (const [kind, entries] of [['file', manifest.files], ['directory', manifest.directories], ['link', manifest.links]]) {
    for (const item of entries) {
      if (!object(item)) fail('RUNTIME_MANIFEST_INVALID', {kind});
      relative(item.path);
      if (paths.has(item.path) || item.path === 'manifest.json' || item.path === '.operation.json') fail('RUNTIME_PATH_CONFLICT', {path: item.path});
      paths.set(item.path, kind);
      if (kind !== 'link') mode(item.mode);
      if (kind === 'file') { count(item.bytes, item.path); hash(item.sha256, item.path); }
      if (kind === 'link') linkTarget(item);
    }
  }
  for (const rel of paths.keys()) {
    let parent = path.posix.dirname(rel);
    while (parent !== '.') {
      if (paths.get(parent) !== 'directory') fail('RUNTIME_PARENT_INVALID', {path: rel, parent});
      parent = path.posix.dirname(parent);
    }
  }
  if (manifest.fileCount !== manifest.files.length ||
      manifest.bytes !== manifest.files.reduce((sum, item) => sum + item.bytes, 0)) fail('RUNTIME_MANIFEST_TOTAL_MISMATCH');
  count(manifest.bytes, 'bytes');
  const linkMap = new Map(manifest.links.map(item => [item.path, item]));
  function resolveLogical(rel) {
    const seen = new Set();
    for (let step = 0; step <= manifest.links.length; step++) {
      const parts = rel.split('/');
      let changed = false;
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join('/');
        if (!linkMap.has(prefix)) continue;
        if (seen.has(prefix)) fail('RUNTIME_LINK_CYCLE', {path: prefix});
        seen.add(prefix);
        const tail = parts.slice(i).join('/');
        rel = linkTarget(linkMap.get(prefix)) + (tail ? '/' + tail : '');
        changed = true;
        break;
      }
      if (!changed) {
        if (!paths.has(rel)) fail('RUNTIME_LINK_TARGET_MISSING', {path: rel});
        return rel;
      }
    }
    fail('RUNTIME_LINK_CYCLE');
  }
  for (const link of manifest.links) resolveLogical(link.path);
  if (Object.keys(manifest.entrypoints).length !== EXPORTS.length) fail('RUNTIME_ENTRYPOINTS_INVALID');
  for (const name of EXPORTS) {
    const target = relative(manifest.entrypoints[name]);
    if (paths.get(resolveLogical(target)) !== 'file') fail('RUNTIME_ENTRYPOINTS_INVALID', {export: name});
  }
  const packageIds = new Set();
  for (const item of manifest.packages) {
    if (!object(item) || !/^p[0-9]{4,}$/.test(item.id) || packageIds.has(item.id) ||
        item.path !== 'packages/' + item.id || paths.get(item.path + '/package.json') !== 'file' ||
        !Array.isArray(item.dependencies) || !Array.isArray(item.installed))
      fail('RUNTIME_PACKAGE_GRAPH_INVALID');
    packageIds.add(item.id);
  }
  if (!packageIds.has(manifest.sdk.packageId)) fail('RUNTIME_PACKAGE_GRAPH_INVALID');
  if (!object(manifest.packageBindings) || manifest.packageBindings[SDK_ALIAS] !== 'packages/' + manifest.sdk.packageId)
    fail('RUNTIME_PACKAGE_BINDINGS_INVALID');
  const allowedBindings = new Set([SDK_ALIAS, SDK_NATIVE, ...MERCHANT_EXPORTS.map(item=>item.packageName)]);
  for (const [name, target] of Object.entries(manifest.packageBindings)) {
    if (!allowedBindings.has(name) || !manifest.packages.some(item=>item.path===target) ||
        resolveLogical('node_modules/' + name) !== target) fail('RUNTIME_PACKAGE_BINDINGS_INVALID', {packageName:name});
    if (name === SDK_NATIVE && target !== 'packages/' + manifest.sdk.packageId)
      fail('RUNTIME_PACKAGE_BINDINGS_INVALID', {packageName:name});
  }
  for (const item of manifest.packages) {
    for (const edge of item.dependencies) {
      if (!object(edge) || !PACKAGE_NAME.test(edge.name) || typeof edge.present !== 'boolean' ||
          (edge.present ? !packageIds.has(edge.packageId) : edge.packageId !== null || (edge.optional !== true && item.requiredByIndexer !== false)))
        fail('RUNTIME_PACKAGE_GRAPH_INVALID', {package: item.id});
      if (edge.present) {
        const lookup = item.path + '/node_modules/' + edge.name;
        if (resolveLogical(lookup) !== 'packages/' + edge.packageId) fail('RUNTIME_RESOLUTION_MISMATCH', {package: item.id, dependency: edge.name});
      }
    }
    for (const edge of item.installed) {
      if (!packageIds.has(edge.packageId) || resolveLogical(item.path + '/' + relative(edge.path)) !== 'packages/' + edge.packageId)
        fail('RUNTIME_RESOLUTION_MISMATCH', {package: item.id});
    }
  }
  const merchant = manifest.integrations?.merchant;
  if (!object(merchant) || merchant.requiredVersion !== MERCHANT_VERSION || !object(merchant.entries) ||
      Object.keys(merchant.entries).length !== MERCHANT_EXPORTS.length || !Array.isArray(merchant.issues))
    fail('RUNTIME_MERCHANT_GRAPH_INVALID');
  for (const expected of MERCHANT_EXPORTS) {
    const entry = merchant.entries[expected.specifier];
    if (!object(entry) || entry.packageName !== expected.packageName || typeof entry.available !== 'boolean' ||
        !Array.isArray(entry.issues)) fail('RUNTIME_MERCHANT_GRAPH_INVALID');
    if (entry.packageId !== null) {
      if (!packageIds.has(entry.packageId) || manifest.packageBindings[expected.packageName] !== 'packages/' + entry.packageId ||
          resolveLogical('node_modules/' + expected.packageName) !== 'packages/' + entry.packageId)
        fail('RUNTIME_MERCHANT_GRAPH_INVALID');
      const selectedPackage = manifest.packages.find(item=>item.id===entry.packageId);
      if (entry.version !== selectedPackage.version || entry.actualPackageName !== selectedPackage.name)
        fail('RUNTIME_MERCHANT_GRAPH_INVALID');
    } else if (entry.available || entry.entrypoint !== null) fail('RUNTIME_MERCHANT_GRAPH_INVALID');
    if (entry.entrypoint !== null && paths.get(resolveLogical(relative(entry.entrypoint))) !== 'file')
      fail('RUNTIME_MERCHANT_GRAPH_INVALID');
    if (entry.available && (!entry.entrypoint || entry.actualPackageName !== expected.packageName ||
        entry.version !== MERCHANT_VERSION || entry.issues.length))
      fail('RUNTIME_MERCHANT_GRAPH_INVALID');
  }
  if (merchant.available !== (Object.values(merchant.entries).every(item=>item.available) && merchant.issues.length===0))
    fail('RUNTIME_MERCHANT_GRAPH_INVALID');
  if (manifest.publisher?.capsule?.sha256 !== CAPSULE_SHA256) fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
  for (const item of [manifest.publisher?.capsule, manifest.publisher?.originalManifest, manifest.publisher?.registry]) {
    const original = manifest.files.find(file => file.path === item?.path);
    if (!original || original.sha256 !== item.sha256 || original.bytes !== item.bytes) fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
  }
  if (manifest.runtime?.hasNativeAddons !== manifest.files.some(item => item.path.endsWith('.node')))
    fail('RUNTIME_NATIVE_ABI_METADATA_MISMATCH');
  if (manifest.runtime?.hasNativeAddons && (manifest.runtime.platform !== process.platform ||
      manifest.runtime.architecture !== process.arch || manifest.runtime.modulesAbi !== process.versions.modules))
    fail('RUNTIME_NATIVE_ABI_MISMATCH', {
      required: {platform: manifest.runtime.platform, architecture: manifest.runtime.architecture, modulesAbi: manifest.runtime.modulesAbi},
      actual: {platform: process.platform, architecture: process.arch, modulesAbi: process.versions.modules}
    });
  return manifest;
}

async function loadManifest(root, expectedManifestSha256) {
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== null) hash(expectedManifestSha256, 'expectedManifestSha256');
  await directory(root);
  const bytes = await readFile(path.join(root, 'manifest.json'));
  const digest = sha256(bytes);
  if (expectedManifestSha256 && expectedManifestSha256 !== digest) fail('RUNTIME_MANIFEST_HASH_MISMATCH');
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch (error) { fail('RUNTIME_MANIFEST_INVALID', {}, error); }
  validateManifest(manifest);
  if (!bytes.equals(jsonBytes(manifest))) fail('RUNTIME_MANIFEST_SERIALIZATION_MISMATCH');
  return {manifest, manifestSha256: digest, bytes};
}
async function verifyFiles(root, manifest, {layout = true} = {}) {
  for (const item of manifest.files) {
    await safeParents(root, item.path);
    const info = await inspectFile(join(root, item.path));
    if (info.bytes !== item.bytes || info.sha256 !== item.sha256) fail('RUNTIME_FILE_HASH_MISMATCH', {path: item.path});
    if (layout && info.mode !== item.mode) fail('RUNTIME_FILE_MODE_MISMATCH', {path: item.path});
  }
  if (layout) {
    for (const item of manifest.directories) {
      const info = await directory(join(root, item.path));
      if ((info.mode & 0o777) !== item.mode) fail('RUNTIME_DIRECTORY_MODE_MISMATCH', {path: item.path});
    }
    for (const item of manifest.links) {
      await safeParents(root, item.path);
      const filename = join(root, item.path);
      const info = await lstatMaybe(filename);
      if (!info?.isSymbolicLink() || await fs.readlink(filename) !== item.target)
        fail('RUNTIME_LINK_MISMATCH', {path: item.path});
      const target = await fs.realpath(filename);
      if (!within(root, target)) fail('RUNTIME_LINK_ESCAPE', {path: item.path});
    }
  }
  for (const item of manifest.packages) {
    const metadata = (await readJSON(join(root, item.path + '/package.json'), 16 * 1024 * 1024)).value;
    if (manifest.files.find(file => file.path === item.path + '/package.json')?.sha256 !== item.packageJsonSha256 ||
        metadata.name !== item.name || metadata.version !== item.version ||
        canonical(metadata._jsr_revision ?? null) !== canonical(item.jsrRevision))
      fail('RUNTIME_PACKAGE_METADATA_MISMATCH', {package: item.id});
  }
  const sdk = manifest.packages.find(item => item.id === manifest.sdk.packageId);
  const sdkFile = manifest.files.find(item => item.path === sdk.path + '/package.json');
  if (sdkFile.sha256 !== manifest.sdk.packageJsonSha256 || sdk.name !== SDK_NATIVE || sdk.version !== SDK_VERSION ||
      canonical(sdk.jsrRevision) !== canonical(manifest.sdk.jsrRevision)) fail('RUNTIME_SDK_BINDING_MISMATCH');
  await verifyPublisherFiles(root, manifest);
}

async function verifyPublisherFiles(root, manifest) {
  const retained = (await readJSON(join(root, manifest.publisher.capsule.path), 4 * 1024 * 1024)).value;
  const selection = manifest.publisher.source;
  if (retained.schema !== 'tjlabs.original-source-capsule.v1' || retained.source?.package !== SDK_ALIAS ||
      retained.source?.version !== SDK_VERSION || retained.fileCount !== 28 || retained.files?.length !== 28 ||
      selection?.fileCount !== 28 || selection.bytes !== retained.bytes)
    fail('RUNTIME_PUBLISHER_CAPSULE_INVALID');
  const selectedFiles = new Map(manifest.files.map(item => [item.path, item]));
  let total = 0;
  const members = new Set();
  for (const item of retained.files) {
    if (typeof item.path !== 'string' || !item.path.startsWith('/') || typeof item.content !== 'string')
      fail('RUNTIME_PUBLISHER_CAPSULE_INVALID');
    const name = relative(item.path.slice(1)), bytes = Buffer.from(item.content);
    const selected = selectedFiles.get(relative(selection.directory) + '/' + name);
    if (members.has(name) || !selected || bytes.length !== item.bytes || sha256(bytes) !== item.sha256 ||
        selected.bytes !== item.bytes || selected.sha256 !== item.sha256)
      fail('RUNTIME_PUBLISHER_MEMBER_MISMATCH', {path: name});
    members.add(name); total += bytes.length;
  }
  if (total !== retained.bytes) fail('RUNTIME_PUBLISHER_CAPSULE_INVALID', {field: 'bytes'});
  const original = retained.source.originalManifest;
  if (original?.sha256 !== manifest.publisher.originalManifest.sha256 || original?.bytes !== manifest.publisher.originalManifest.bytes)
    fail('RUNTIME_PUBLISHER_MANIFEST_MISMATCH');
  const registryBytes = await readFile(join(root, manifest.publisher.registry.path), 16 * 1024 * 1024);
  const registryBlob = createHash('sha1').update('blob ' + registryBytes.length + '\0').update(registryBytes).digest('hex');
  if (registryBlob !== 'd0fd0e9ef4ca9e6bc4982f0f9da76cb17185d856') fail('RUNTIME_PUBLISHER_REGISTRY_MISMATCH');
}

async function processIdentity(pid = process.pid) {
  let boot = null, start = null;
  try { boot = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(); } catch {}
  try {
    const stat = await fs.readFile('/proc/' + pid + '/stat', 'utf8');
    start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch {}
  return {pid, boot, start};
}
async function acquire(destination) {
  const lease = destination + '.runtime-lock';
  const token = randomUUID();
  const owner = {...await processIdentity(), token};
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = lease + '.candidate-' + token;
    await fs.mkdir(candidate, {mode: 0o700});
    try {
      await atomicBytes(candidate, 'owner.json', jsonBytes(owner));
      try {
        await fs.rename(candidate, lease);
        await syncDirectory(path.dirname(lease));
        return async () => {
          const current = (await readJSON(path.join(lease, 'owner.json'))).value;
          if (current.token !== token) fail('RUNTIME_LEASE_CHANGED');
          await fs.rm(lease, {recursive: true});
          await syncDirectory(path.dirname(lease));
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      }
    } finally { await fs.rm(candidate, {recursive: true, force: true}); }
    let previous;
    try { previous = (await readJSON(path.join(lease, 'owner.json'))).value; }
    catch { fail('RUNTIME_BUSY', {directory: destination}); }
    if (!Number.isInteger(previous.pid) || previous.pid <= 0 || typeof previous.token !== 'string')
      fail('RUNTIME_BUSY', {directory: destination});
    let alive = true;
    try { process.kill(previous.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    const current = await processIdentity(previous.pid);
    if (alive && (!previous.boot || previous.boot === current.boot) && (!previous.start || previous.start === current.start))
      fail('RUNTIME_BUSY', {directory: destination});
    const stale = lease + '.stale-' + previous.token + '-' + randomUUID();
    try { await fs.rename(lease, stale); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const moved = (await readJSON(path.join(stale, 'owner.json'))).value;
    if (moved.token !== previous.token) {
      try { await fs.rename(stale, lease); } catch {}
      fail('RUNTIME_LEASE_CHANGED');
    }
    await fs.rm(stale, {recursive: true});
  }
  fail('RUNTIME_BUSY', {directory: destination});
}
async function copyFile(source, destinationRoot, item) {
  await safeParents(destinationRoot, item.path, {create: true});
  const filename = join(destinationRoot, item.path);
  const existing = await lstatMaybe(filename);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) fail('RUNTIME_STAGING_FILE_CONFLICT', {path: item.path});
    const actual = await inspectFile(filename);
    if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) fail('RUNTIME_STAGING_FILE_CONFLICT', {path: item.path});
    await fs.chmod(filename, item.mode);
    return;
  }
  if (source.content) {
    if (source.content.length !== item.bytes || sha256(source.content) !== item.sha256) fail('RUNTIME_SOURCE_CHANGED', {path: item.path});
    await atomicBytes(destinationRoot, item.path, source.content, item.mode);
    return;
  }
  const input = await fs.open(source.filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const temporary = filename + '.partial-' + randomUUID();
  let output;
  try {
    const before = await input.stat({bigint: true});
    if (!before.isFile() || (source.fingerprint && fingerprint(before) !== source.fingerprint)) fail('RUNTIME_SOURCE_CHANGED', {path: item.path});
    output = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const {bytesRead} = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(chunk, written, bytesRead - written, null);
        if (!result.bytesWritten) fail('RUNTIME_WRITE_INCOMPLETE', {path: item.path});
        written += result.bytesWritten;
      }
      bytes += bytesRead;
    }
    const after = await input.stat({bigint: true});
    if (fingerprint(before) !== fingerprint(after) || bytes !== item.bytes || digest.digest('hex') !== item.sha256)
      fail('RUNTIME_SOURCE_CHANGED', {path: item.path});
    await output.chmod(item.mode);
    await output.sync();
    await output.close(); output = null;
    await fs.rename(temporary, filename);
    await syncDirectory(path.dirname(filename));
  } finally {
    await input.close();
    if (output) await output.close();
    await fs.rm(temporary, {force: true});
  }
}
async function materialize(destination, plan, kind) {
  const parent = path.dirname(destination);
  await fs.mkdir(parent, {recursive: true, mode: 0o700});
  await directory(parent);
  const release = await acquire(destination);
  try {
    const existing = await lstatMaybe(destination);
    if (existing) {
      await directory(destination);
      if (await lstatMaybe(path.join(destination, 'manifest.json'))) {
        const result = await verifyIndexerRuntime({directory: destination});
        if (result.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        return result;
      }
      if ((await fs.readdir(destination)).length) fail('RUNTIME_DESTINATION_NOT_EMPTY', {directory: destination});
    }
    const staging = destination + '.runtime-stage';
    const existed = await lstatMaybe(staging);
    if (!existed) {
      await fs.mkdir(staging, {mode: 0o700});
      await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.stellar-indexer-runtime-operation.v1', kind, id: plan.manifest.id}));
    } else {
      await directory(staging);
      const markerFile = path.join(staging, '.operation.json');
      if (await lstatMaybe(markerFile)) {
        const marker = (await readJSON(markerFile)).value;
        if (marker.schema !== 'stellar-forge.stellar-indexer-runtime-operation.v1' || marker.kind !== kind || marker.id !== plan.manifest.id)
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else if (await lstatMaybe(path.join(staging, 'manifest.json'))) {
        const retained = await loadManifest(staging);
        if (retained.manifest.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else {
        const leftovers = await fs.readdir(staging);
        if (leftovers.some(name => !/^\.operation\.json\.partial-[0-9a-f-]{36}$/.test(name)))
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        for (const name of leftovers) await fs.rm(path.join(staging, name), {force: true});
        await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.stellar-indexer-runtime-operation.v1', kind, id: plan.manifest.id}));
      }
    }
    for (const item of plan.manifest.directories) {
      await safeParents(staging, item.path, {create: true});
      const target = join(staging, item.path);
      try { await fs.mkdir(target, {mode: 0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await directory(target);
      await fs.chmod(target, 0o700);
    }
    for (const item of plan.manifest.files) await copyFile(plan.sources.get(item.path), staging, item);
    for (const item of plan.manifest.links) {
      await safeParents(staging, item.path);
      const filename = join(staging, item.path), info = await lstatMaybe(filename);
      if (info) {
        if (!info.isSymbolicLink() || await fs.readlink(filename) !== item.target) fail('RUNTIME_STAGING_LINK_CONFLICT', {path: item.path});
      } else await fs.symlink(item.target, filename);
    }
    // Only temporaries of this generation's declared files are ours to remove.
    const temporaryParents = new Map();
    for (const item of [...plan.manifest.files, {path: 'manifest.json'}, {path: '.operation.json'}]) {
      const parentPath = path.dirname(join(staging, item.path));
      if (!temporaryParents.has(parentPath)) temporaryParents.set(parentPath, new Set());
      temporaryParents.get(parentPath).add(path.basename(item.path));
    }
    for (const [parentPath, filenames] of temporaryParents) {
      for (const name of await fs.readdir(parentPath)) {
        const match = /^(.*)\.partial-([0-9a-f-]{36})$/.exec(name);
        if (match && filenames.has(match[1])) await fs.rm(path.join(parentPath, name), {force: true});
      }
    }
    for (const item of [...plan.manifest.directories].sort((a, b) => b.path.split('/').length - a.path.split('/').length))
      await fs.chmod(join(staging, item.path), item.mode);
    const manifestBytes = jsonBytes(plan.manifest);
    await atomicBytes(staging, 'manifest.json', manifestBytes);
    await verifyFiles(staging, plan.manifest);

    await fs.rm(path.join(staging, '.operation.json'), {force: true});
    await syncDirectory(staging);
    if (await lstatMaybe(destination)) await fs.rmdir(destination);
    await fs.rename(staging, destination);
    await syncDirectory(parent);
    return descriptor(destination, plan.manifest, sha256(manifestBytes));
  } finally { await release(); }
}

/** Capture the complete installed SDK before importing any of its code.
 * The exact generation directory is caller-selected. An acknowledged immutable
 * generation reopens as itself; interrupted copies retain their original plan ID.
 */
export async function retainIndexerRuntime({directory: selectedDirectory, installationDirectory = HERE} = {}) {
  const destination = absolute(selectedDirectory, 'directory');
  const installed = absolute(installationDirectory, 'installationDirectory');
  if (await lstatMaybe(path.join(destination, 'manifest.json')))
    return verifyIndexerRuntime({directory: destination});
  const plan = await planRuntime(installed);
  return materialize(destination, plan, 'retain');
}

/** Verify original bytes, permission bits, complete package graph and real links.
 * This function reads source only; it never imports the SDK.
 */
export async function verifyIndexerRuntime({directory: selectedDirectory, expectedManifestSha256} = {}) {
  const root = absolute(selectedDirectory, 'directory');
  const loaded = await loadManifest(root, expectedManifestSha256);
  await verifyFiles(root, loaded.manifest);
  return descriptor(root, loaded.manifest, loaded.manifestSha256);
}

/** Receive a complete runtime from declared regular source files and its exact
 * original manifest. Transport need not preserve Unix modes or symlinks: both are
 * rebuilt from that hash-bound original manifest before returning entrypaths.
 * Extra private downloader checkpoints are ignored.
 */
export async function restoreIndexerRuntime({sourceDirectory, destination: selectedDestination, expectedManifestSha256} = {}) {
  const source = absolute(sourceDirectory, 'sourceDirectory');
  const destination = absolute(selectedDestination, 'destination');
  if (source === destination) return verifyIndexerRuntime({directory: source, expectedManifestSha256});
  if (within(source, destination) || within(destination, source)) fail('RUNTIME_SOURCE_DESTINATION_OVERLAP');
  const loaded = await loadManifest(source, expectedManifestSha256);
  await verifyFiles(source, loaded.manifest, {layout: false});
  const sources = new Map(loaded.manifest.files.map(item => [item.path, {filename: join(source, item.path)}]));
  const result = await materialize(destination, {manifest: loaded.manifest, sources}, 'restore');
  if (result.manifestSha256 !== loaded.manifestSha256) fail('RUNTIME_MANIFEST_HASH_MISMATCH');
  return result;
}

/** Attach the complete retained package graph to an independently materialized
 * application source root. Original source and packages are unchanged. Each
 * alias either already selects these exact retained bytes or is added as a
 * relative symlink. An application/runtime pair has its own source directory.
 */
export async function bindIndexerRuntime({directory: selectedDirectory, applicationDirectory, expectedManifestSha256} = {}) {
  const runtime = await verifyIndexerRuntime({directory:selectedDirectory, expectedManifestSha256});
  const application = absolute(applicationDirectory, 'applicationDirectory');
  await directory(application);
  const applicationRoot = await fs.realpath(application), runtimeRoot = await fs.realpath(runtime.directory);
  if (within(runtimeRoot, applicationRoot) || within(applicationRoot, runtimeRoot))
    fail('RUNTIME_APPLICATION_OVERLAP');
  const bindings = [];
  for (const [name, retainedPath] of Object.entries(runtime.packageBindings)) {
    const destination = path.join(applicationRoot, 'node_modules', ...name.split('/'));
    const target = await fs.realpath(retainedPath);
    if (!within(runtimeRoot, target)) fail('RUNTIME_PACKAGE_BINDING_ESCAPE', {packageName:name});
    const segments = ['node_modules', ...name.split('/')].slice(0,-1);
    let parent = applicationRoot;
    for (const segment of segments) {
      parent = path.join(parent, segment);
      const existing = await lstatMaybe(parent);
      if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
        fail('RUNTIME_APPLICATION_BINDING_CONFLICT', {packageName:name, path:parent});
    }
    const existing = await lstatMaybe(destination);
    if (existing) {
      let actual = null;
      if (existing.isSymbolicLink()) { try { actual = await fs.realpath(destination); } catch {} }
      if (actual !== target) fail('RUNTIME_APPLICATION_BINDING_CONFLICT', {packageName:name, path:destination});
    }
    bindings.push({name,path:destination,target,relativeTarget:path.relative(path.dirname(destination),target)});
  }
  for (const binding of bindings) {
    const relativePath = path.relative(applicationRoot,binding.path).split(path.sep).join('/');
    await safeParents(applicationRoot,relativePath,{create:true});
    try { await fs.symlink(binding.relativeTarget,binding.path,'dir'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.lstat(binding.path);
      let actual = null;
      if (existing.isSymbolicLink()) { try { actual=await fs.realpath(binding.path); } catch {} }
      if (actual !== binding.target)
        fail('RUNTIME_APPLICATION_BINDING_CONFLICT',{packageName:binding.name,path:binding.path});
    }
    await syncDirectory(path.dirname(binding.path));
  }
  return {schema:'stellar-forge.stellar-indexer-runtime-binding.v1',runtimeId:runtime.id,
    runtimeDirectory:runtime.directory,manifestSha256:runtime.manifestSha256,
    applicationDirectory:applicationRoot,packageBindings:runtime.packageBindings,bindings,
    merchant:runtime.manifest.integrations.merchant};
}
