// MIT. Complete original Stellar SDK installation, retained dependency graph,
// conditional exports and independent receiving for wallet and activity workspaces.
import {createHash, randomUUID} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.stellar-ratings.runtime.v1';
const SDK_ALIAS='@stellar/stellar-sdk';
const SDK_NATIVE='@stellar/stellar-sdk';
const SDK_VERSION='17.2.1';
const REGISTRY_SHA256='fd25b568ca98b7ec3b4382e62d79603f99dd879e112241e6e9142e91ac07eec9';
const SDK_INTEGRITY="sha512-kIyfnZ2zCOqV8SUJcsk9buBOvhH1wsLU7KAzqAJyY7AgmD+KdvLTMpI1gcYdhGSakuDG5s6xSO4EN9HZTxpm8g==";
const SDK_TARBALL="https://registry.npmjs.org/@stellar/stellar-sdk/-/stellar-sdk-17.2.1.tgz";
const SDK_GIT_HEAD="b4893496f69116d9db2a4a90214a7236831b6656";
const EXPORTS=[".","./rpc","./xdr","./base","./axios","./contract","./axios/rpc","./axios/contract","./http-client/axios"];
const INSTALL_SCHEMA='stellar-forge.stellar-ratings.install-operation.v1';
const INSTALL_RECEIPT_SCHEMA='stellar-forge.stellar-ratings.install-receipt.v1';
const INSTALL_COMMAND_SCHEMA='stellar-forge.stellar-ratings.install-command.v1';
const BUFFER_BYTES=256*1024;
const SHA256=/^[a-f0-9]{64}$/;
const PACKAGE_NAME=/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const VCS=new Set(['.git','.hg','.svn']);
const FILE_HASH_CACHE=new Map();
const FILE_HASH_CACHE_LIMIT=8192;

export class RatingsRuntimeError extends Error {
  constructor(code, details = {}, cause) {
    super(code, cause ? {cause} : undefined);
    this.name = 'RatingsRuntimeError';
    this.code = code;
    this.details = details;
  }
  toJSON() { return {code: this.code, details: this.details}; }
}
function fail(code, details, cause) { throw new RatingsRuntimeError(code, details, cause); }
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
    const currentIdentity=fingerprint(before),cached=FILE_HASH_CACHE.get(filename);
    if(cached?.fingerprint===currentIdentity) {
      const after=await handle.stat({bigint:true});
      if(fingerprint(after)!==currentIdentity)fail('RUNTIME_SOURCE_CHANGED',{path:filename});
      return {...cached};
    }
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
    const result={bytes,sha256:digest.digest('hex'),mode:Number(before.mode&0o777n),fingerprint:currentIdentity};
    FILE_HASH_CACHE.set(filename,result);
    if(FILE_HASH_CACHE.size>FILE_HASH_CACHE_LIMIT)FILE_HASH_CACHE.delete(FILE_HASH_CACHE.keys().next().value);
    return {...result};
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
    requireEntrypoints: Object.fromEntries(Object.entries(manifest.requireEntrypoints).map(([name, target]) => [name, join(directory, target)])),
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

function registryOriginal(value,bytes) {
  if(sha256(bytes)!==REGISTRY_SHA256||value.name!==SDK_NATIVE||value.version!==SDK_VERSION||
    value.dist?.integrity!==SDK_INTEGRITY||value.dist?.tarball!==SDK_TARBALL||
    value.gitHead!==SDK_GIT_HEAD||value.license!=='Apache-2.0'||
    canonical(Object.keys(value.exports??{}).sort())!==canonical([...EXPORTS].sort()))
    fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
  return value;
}
function requireOriginalSDK(metadata,registry) {
  if(metadata.name!==SDK_NATIVE||metadata.version!==SDK_VERSION)
    fail('RATINGS_STELLAR_VERSION_MISMATCH',{expected:SDK_VERSION,actual:metadata.version??null});
  for(const name of ['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','exports',
    'imports','main','module','type','types','engines','bin','license']) {
    if(canonical(metadata[name]??null)!==canonical(registry[name]??null))
      fail('RUNTIME_ORIGINAL_PACKAGE_DECLARATION_CHANGED',{field:name});
  }
}
function packageDeclarations(metadata) {
  const declarations=new Map();
  for(const[name,range]of Object.entries(metadata.dependencies??{}))
    declarations.set(name,{name,range,kind:'dependency',optional:false});
  for(const[name,range]of Object.entries(metadata.optionalDependencies??{}))
    declarations.set(name,{name,range,kind:'optional',optional:true});
  for(const[name,range]of Object.entries(metadata.peerDependencies??{}))
    if(!declarations.has(name))declarations.set(name,{name,range,kind:'peer',
      optional:metadata.peerDependenciesMeta?.[name]?.optional===true});
  return declarations;
}
async function publisherSources(installationDirectory) {
  const original=await readJSON(path.join(HERE,'source','stellar-sdk-registry.json'));
  const registry=registryOriginal(original.value,original.bytes);
  const files=[{path:'publisher/stellar-sdk/registry.json',content:original.bytes,mode:0o644}];
  const description={registry:{path:files[0].path,bytes:original.bytes.length,sha256:REGISTRY_SHA256},
    sourceUrl:'https://registry.npmjs.org/@stellar%2fstellar-sdk/17.2.1',
    package:SDK_NATIVE,version:SDK_VERSION,integrity:SDK_INTEGRITY,tarball:SDK_TARBALL,
    gitHead:SDK_GIT_HEAD,license:'Apache-2.0'};
  const installation=await readInstallSelection(installationDirectory,registry);
  if(installation) {
    description.installation={};
    for(const[key,item]of Object.entries(installation.files)) {
      files.push({path:item.path,content:item.content,mode:0o644});
      description.installation[key]={path:item.path,bytes:item.content.length,sha256:sha256(item.content)};
    }
  }
  return {files,description,registry};
}
async function discover(installationDirectory,registry) {
  const first=await resolvePackage(SDK_ALIAS,installationDirectory);
  if(!first)fail('RATINGS_STELLAR_NOT_INSTALLED',{package:SDK_ALIAS,version:SDK_VERSION});
  requireOriginalSDK(first.metadata,registry);
  const packages=[],byRoot=new Map(),byLookup=new Map();
  function add(found) {
    let node=byRoot.get(found.root);
    if(!node) {
      node={...found,id:'p'+String(packages.length).padStart(4,'0'),dependencies:[],installed:[]};
      node.path='packages/'+node.id;packages.push(node);byRoot.set(node.root,node);
    }
    byLookup.set(found.lookup,node);return node;
  }
  const root=add(first);
  for(let index=0;index<packages.length;index++) {
    const node=packages[index],declarations=packageDeclarations(node.metadata);
    for(const dependency of [...declarations.values()].sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const found=await resolvePackage(dependency.name,node.root);
      if(!found) {
        node.dependencies.push({...dependency,packageId:null,present:false});
        if(!dependency.optional)fail('RUNTIME_DEPENDENCY_MISSING',
          {package:node.metadata.name,dependency:dependency.name,range:dependency.range});
      }else {
        const selected=add(found);
        node.dependencies.push({...dependency,packageId:selected.id,present:true});
      }
    }
    async function scan(current,rel='') {
      for(const entry of (await fs.readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
        if(VCS.has(entry.name))continue;
        const filename=path.join(current,entry.name),childRel=rel?rel+'/'+entry.name:entry.name;
        if(entry.name==='node_modules'&&entry.isDirectory()) {
          for(const child of await installedChildren(filename)) {
            const selected=add(await packageAt(child.lookup));
            node.installed.push({path:childRel+'/'+child.name,name:child.name,packageId:selected.id});
          }
          continue;
        }
        if(entry.isDirectory()){const other=byRoot.get(filename);if(!other||other===node)await scan(filename,childRel);}
      }
    }
    await scan(node.root);
  }
  return {root,packages,byRoot,byLookup};
}
async function nativeEntrypoints(graph,installationDirectory) {
  const request={name:SDK_NATIVE,exports:EXPORTS,
    parent:pathToFileURL(path.join(graph.root.root,'__stellar_ratings_resolution__.mjs')).href};
  // Resolve the original import and require conditions without evaluating the SDK.
  const resolver='import {createRequire} from "node:module";const r=JSON.parse(process.argv[1]);'+
    'const require=createRequire(r.parent),out={import:{},require:{}};'+
    'for(const item of r.exports){const spec=r.name+(item==="."?"":item.slice(1));'+
    'out.import[item]=await import.meta.resolve(spec,r.parent);out.require[item]=require.resolve(spec);}'+
    'process.stdout.write(JSON.stringify(out));';
  const environment={...process.env};delete environment.NODE_OPTIONS;
  let output;
  try{output=await promisify(execFile)(process.execPath,
    ['--experimental-import-meta-resolve','--input-type=module','--eval',resolver,JSON.stringify(request)],
    {cwd:installationDirectory,env:environment,timeout:30000,maxBuffer:1024*1024});}
  catch(error){fail('RUNTIME_STELLAR_EXPORT_RESOLUTION_FAILED',{package:SDK_NATIVE,version:SDK_VERSION},error);}
  let entries;try{entries=JSON.parse(output.stdout);}catch(error){fail('RUNTIME_STELLAR_EXPORT_RESOLUTION_FAILED',{},error);}
  const result={import:{},require:{}};
  for(const key of ['import','require'])for(const name of EXPORTS) {
    let filename;
    if(key==='import') {
      let selected;try{selected=new URL(entries[key]?.[name]);}catch{fail('RUNTIME_STELLAR_EXPORT_UNAVAILABLE',{kind:key,export:name});}
      if(selected.protocol!=='file:'||selected.search||selected.hash)fail('RUNTIME_STELLAR_EXPORT_UNAVAILABLE',{kind:key,export:name});
      filename=fileURLToPath(selected);
    }else filename=entries[key]?.[name];
    if(typeof filename!=='string'||!path.isAbsolute(filename))fail('RUNTIME_STELLAR_EXPORT_UNAVAILABLE',{kind:key,export:name});
    const selected=await fs.realpath(filename);
    if(!within(graph.root.root,selected))fail('RUNTIME_STELLAR_EXPORT_INVALID',{kind:key,export:name});
    result[key][name]=selected;
  }
  return result;
}

async function planRuntime(installationDirectory) {
  const publisher = await publisherSources(installationDirectory);
  const graph = await discover(installationDirectory,publisher.registry);
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
    const row = {path: rel, target, ...(original === null || path.isAbsolute(original) ? {} : {originalTarget: original})};
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
  const entrypoints={},requireEntrypoints={};
  const nativeEntries=await nativeEntrypoints(graph,installationDirectory);
  for(const[kind,output]of [['import',entrypoints],['require',requireEntrypoints]])for(const name of EXPORTS) {
    const mapped=mapPhysical(nativeEntries[kind][name]);
    if(!mapped||!files.has(mapped)||!/\.(?:mjs|cjs|js)$/.test(mapped))
      fail('RUNTIME_STELLAR_EXPORT_UNAVAILABLE',{kind,export:name});
    output[name]=mapped;
  }
  for (const node of graph.packages) {
    const captured = files.get(node.path + '/package.json');
    if (!captured || captured.sha256 !== sha256(node.packageBytes))
      fail('RUNTIME_SOURCE_CHANGED', {package: node.metadata.name, member: 'package.json'});
  }
  for (const rel of files.keys()) if (directories.has(rel) || links.has(rel)) fail('RUNTIME_PATH_CONFLICT', {path: rel});
  for (const rel of directories.keys()) if (links.has(rel)) fail('RUNTIME_PATH_CONFLICT', {path: rel});
  const packageBindings = {[SDK_ALIAS]: graph.root.path};
  if (links.has('node_modules/' + SDK_NATIVE)) packageBindings[SDK_NATIVE] = graph.root.path;
  const sortedFiles = [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {
    schema: SCHEMA,
    stellar: {
      requestedName: SDK_ALIAS, packageName: graph.root.metadata.name, version: SDK_VERSION,
      packageId: graph.root.id,
      packageJsonSha256: sha256(graph.root.packageBytes)
    },
    runtime: {
      nodeVersion: process.version, platform: process.platform, architecture: process.arch,
      modulesAbi: process.versions.modules, hasNativeAddons: sortedFiles.some(item => item.path.endsWith('.node'))
    },
    entrypoints,
    requireEntrypoints,
    packageBindings,
    packages: graph.packages.map(node => ({
      id: node.id, path: node.path, name: node.metadata.name, version: node.metadata.version,
      packageJsonSha256: sha256(node.packageBytes),
      engines: node.metadata.engines ?? null,
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
      !object(manifest.entrypoints) || !object(manifest.requireEntrypoints) || manifest.stellar?.packageName !== SDK_NATIVE || manifest.stellar?.version !== SDK_VERSION)
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
  for(const entries of [manifest.entrypoints,manifest.requireEntrypoints]) {
    if(Object.keys(entries).length!==EXPORTS.length)fail('RUNTIME_ENTRYPOINTS_INVALID');
    for(const name of EXPORTS) {
      const target=relative(entries[name]);
      if(paths.get(resolveLogical(target))!=='file')fail('RUNTIME_ENTRYPOINTS_INVALID',{export:name});
    }
  }
  const packageIds = new Set();
  for (const item of manifest.packages) {
    if (!object(item) || !/^p[0-9]{4,}$/.test(item.id) || packageIds.has(item.id) ||
        item.path !== 'packages/' + item.id || paths.get(item.path + '/package.json') !== 'file' ||
        !Array.isArray(item.dependencies) || !Array.isArray(item.installed))
      fail('RUNTIME_PACKAGE_GRAPH_INVALID');
    packageIds.add(item.id);
  }
  if (!packageIds.has(manifest.stellar.packageId)) fail('RUNTIME_PACKAGE_GRAPH_INVALID');
  if (!object(manifest.packageBindings) || manifest.packageBindings[SDK_ALIAS] !== 'packages/' + manifest.stellar.packageId)
    fail('RUNTIME_PACKAGE_BINDINGS_INVALID');
  const allowedBindings = new Set([SDK_ALIAS]);
  for (const [name, target] of Object.entries(manifest.packageBindings)) {
    if (!allowedBindings.has(name) || !manifest.packages.some(item=>item.path===target) ||
        resolveLogical('node_modules/' + name) !== target) fail('RUNTIME_PACKAGE_BINDINGS_INVALID', {packageName:name});
    if (name === SDK_NATIVE && target !== 'packages/' + manifest.stellar.packageId)
      fail('RUNTIME_PACKAGE_BINDINGS_INVALID', {packageName:name});
  }
  for (const item of manifest.packages) {
    for (const edge of item.dependencies) {
      if (!object(edge) || !PACKAGE_NAME.test(edge.name) || typeof edge.present !== 'boolean' ||
          (edge.present ? !packageIds.has(edge.packageId) : edge.packageId !== null || edge.optional !== true))
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
  if(manifest.publisher?.registry?.sha256!==REGISTRY_SHA256||manifest.publisher.package!==SDK_NATIVE||
    manifest.publisher.version!==SDK_VERSION||manifest.publisher.integrity!==SDK_INTEGRITY||
    manifest.publisher.tarball!==SDK_TARBALL||manifest.publisher.gitHead!==SDK_GIT_HEAD)
    fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
  const publisherFiles=[manifest.publisher.registry];
  if(manifest.publisher.installation) {
    if(!object(manifest.publisher.installation)||
      canonical(Object.keys(manifest.publisher.installation).sort())!==canonical(['lock','package','receipt']))
      fail('RUNTIME_INSTALL_RECEIPT_INVALID');
    publisherFiles.push(...Object.values(manifest.publisher.installation));
  }
  for(const item of publisherFiles) {
    const original=manifest.files.find(file=>file.path===item?.path);
    if(!original||original.sha256!==item.sha256||original.bytes!==item.bytes)
      fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
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
        metadata.name !== item.name || metadata.version !== item.version)
      fail('RUNTIME_PACKAGE_METADATA_MISMATCH', {package: item.id});
  }
  const sdk = manifest.packages.find(item => item.id === manifest.stellar.packageId);
  const sdkFile = manifest.files.find(item => item.path === sdk.path + '/package.json');
  if (sdkFile.sha256 !== manifest.stellar.packageJsonSha256 || sdk.name !== SDK_NATIVE || sdk.version !== SDK_VERSION) fail('RUNTIME_STELLAR_BINDING_MISMATCH');
  await verifyPublisherFiles(root, manifest);
}


function validateInstallPackage(packageJSON,lock) {
  if(packageJSON?.name!=='stellar-ratings-original-consumer'||packageJSON.private!==true||
    packageJSON.type!=='module'||canonical(packageJSON.dependencies)!==canonical({[SDK_NATIVE]:SDK_VERSION})||
    lock?.lockfileVersion!==3||!object(lock.packages))fail('RUNTIME_INSTALL_SELECTION_CHANGED');
  const original=lock.packages['node_modules/'+SDK_NATIVE];
  if(original?.version!==SDK_VERSION||original.integrity!==SDK_INTEGRITY||
    typeof original.resolved!=='string'||!original.resolved.startsWith('https://'))
    fail('RUNTIME_ORIGINAL_PACKAGE_INTEGRITY_CHANGED');
}
function validateInstallReceipt(receipt) {
  if(receipt?.schema!==INSTALL_RECEIPT_SCHEMA||receipt.registrySha256!==REGISTRY_SHA256||
    receipt.package!==SDK_NATIVE||receipt.version!==SDK_VERSION||receipt.integrity!==SDK_INTEGRITY||
    typeof receipt.operationId!=='string'||!object(receipt.toolchain)||!Array.isArray(receipt.steps)||
    receipt.steps.length!==1||receipt.steps[0].name!=='package-install'||
    receipt.steps[0].status!=='COMPLETE'||receipt.steps[0].exitCode!==0)
    fail('RUNTIME_INSTALL_RECEIPT_INVALID');
  for(const item of [receipt.packageFile,receipt.lockFile]) {
    if(!object(item))fail('RUNTIME_INSTALL_RECEIPT_INVALID');
    count(item.bytes,'installation.file');hash(item.sha256,'installation.file');
  }
  return receipt;
}
async function readInstallSelection(installationDirectory,registry) {
  const marker=path.join(installationDirectory,'.stellar-ratings-install.json');
  if(!await lstatMaybe(marker))return null;
  const selected=(await readJSON(marker)).value;
  if(selected.schema!==INSTALL_SCHEMA||selected.status!=='COMPLETE'||
    selected.registrySha256!==REGISTRY_SHA256||selected.installationDirectory!==installationDirectory||
    selected.operationDirectory!==installationDirectory+'.stellar-ratings-install')
    fail('RUNTIME_INSTALL_SELECTION_INCOMPLETE');
  const receipt=validateInstallReceipt(selected.receipt);
  if(receipt.operationId!==selected.id)fail('RUNTIME_INSTALL_SELECTION_CHANGED');
  const packageFile=await readJSON(path.join(installationDirectory,'package.json'));
  const lockFile=await readJSON(path.join(installationDirectory,'package-lock.json'));
  validateInstallPackage(packageFile.value,lockFile.value);
  for(const[name,loaded]of [['packageFile',packageFile],['lockFile',lockFile]]) {
    if(receipt[name].bytes!==loaded.bytes.length||receipt[name].sha256!==sha256(loaded.bytes))
      fail('RUNTIME_INSTALL_SOURCE_CHANGED',{file:name});
  }
  const installed=await resolvePackage(SDK_NATIVE,installationDirectory);
  if(!installed)fail('RATINGS_STELLAR_NOT_INSTALLED');
  requireOriginalSDK(installed.metadata,registry);
  return {receipt,files:{
    package:{path:'installation/package.json',content:packageFile.bytes},
    lock:{path:'installation/package-lock.json',content:lockFile.bytes},
    receipt:{path:'installation/receipt.json',content:jsonBytes(receipt)}
  }};
}
async function verifyPublisherFiles(root,manifest) {
  const original=await readJSON(join(root,manifest.publisher.registry.path));
  const registry=registryOriginal(original.value,original.bytes),packages=new Map(manifest.packages.map(item=>[item.id,item]));
  const primary=packages.get(manifest.stellar.packageId);
  if(!primary)fail('RUNTIME_STELLAR_BINDING_MISMATCH');
  const primaryJSON=(await readJSON(join(root,primary.path+'/package.json'))).value;
  requireOriginalSDK(primaryJSON,registry);
  for(const item of manifest.packages) {
    const metadata=(await readJSON(join(root,item.path+'/package.json'))).value;
    const declarations=packageDeclarations(metadata);
    if(declarations.size!==item.dependencies.length)fail('RUNTIME_DEPENDENCY_DECLARATION_CHANGED',{package:item.id});
    const seen=new Set();
    for(const edge of item.dependencies) {
      const declared=declarations.get(edge.name);
      if(seen.has(edge.name)||!declared||declared.range!==edge.range||declared.kind!==edge.kind||declared.optional!==edge.optional)
        fail('RUNTIME_DEPENDENCY_DECLARATION_CHANGED',{package:item.id,dependency:edge.name});
      if(edge.present&&!packages.has(edge.packageId)||!edge.present&&!edge.optional)
        fail('RUNTIME_DEPENDENCY_MISSING',{package:item.id,dependency:edge.name});
      seen.add(edge.name);
    }
  }
  if(manifest.publisher.installation) {
    const selected=manifest.publisher.installation;
    const [packageFile,lockFile,receiptFile]=await Promise.all(
      ['package','lock','receipt'].map(name=>readJSON(join(root,selected[name].path))));
    validateInstallPackage(packageFile.value,lockFile.value);
    const receipt=validateInstallReceipt(receiptFile.value);
    if(receipt.packageFile.bytes!==packageFile.bytes.length||receipt.packageFile.sha256!==sha256(packageFile.bytes)||
      receipt.lockFile.bytes!==lockFile.bytes.length||receipt.lockFile.sha256!==sha256(lockFile.bytes))
      fail('RUNTIME_INSTALL_SOURCE_CHANGED');
  }
}
/** Install the original published Stellar SDK into this operation's private
 * project. Native npm retains its lock and lifecycle; the existing command's
 * process and durable result are reconciled before an interrupted retry. */
export async function installRatingsRuntime({installationDirectory,directory:selectedDirectory,
  npmExecutable='npm',signal,progress}={}) {
  abortInstall(signal);
  const installation=absolute(installationDirectory,'installationDirectory');
  const destination=absolute(selectedDirectory,'directory');
  if(within(installation,destination)||within(destination,installation))fail('RUNTIME_SOURCE_DESTINATION_OVERLAP');
  const loaded=await readJSON(path.join(HERE,'source','stellar-sdk-registry.json'));
  const registry=registryOriginal(loaded.value,loaded.bytes);
  const operationDirectory=installation+'.stellar-ratings-install';
  await fs.mkdir(path.dirname(operationDirectory),{recursive:true,mode:0o700});
  const release=await acquire(operationDirectory);
  try {
    const operationFile=path.join(operationDirectory,'operation.json');
    let operation;
    if(await lstatMaybe(operationDirectory)) {
      await directory(operationDirectory);
      if(await lstatMaybe(operationFile))operation=(await readJSON(operationFile)).value;
      else if((await fs.readdir(operationDirectory)).some(name=>!/^operation\.json\.partial-[0-9a-f-]{36}$/.test(name)))
        fail('RUNTIME_INSTALL_DESTINATION_CONFLICT',{directory:operationDirectory});
    }else await fs.mkdir(operationDirectory,{mode:0o700});
    if(operation) {
      if(operation.schema!==INSTALL_SCHEMA||operation.registrySha256!==REGISTRY_SHA256||
        operation.installationDirectory!==installation||operation.operationDirectory!==operationDirectory)
        fail('RUNTIME_INSTALL_SELECTION_CHANGED');
    }else {
      operation={schema:INSTALL_SCHEMA,id:randomUUID(),registrySha256:REGISTRY_SHA256,
        installationDirectory:installation,operationDirectory,createdAt:new Date().toISOString(),status:'PREPARING',steps:[]};
      await atomicBytes(operationDirectory,'operation.json',jsonBytes(operation));
    }
    const marker=path.join(installation,'.stellar-ratings-install.json');
    if(await lstatMaybe(marker)) {
      const existing=(await readJSON(marker)).value;
      if(existing.id!==operation.id)fail('RUNTIME_INSTALL_DESTINATION_CONFLICT',{directory:installation});
      if(existing.status==='COMPLETE') {
        await readInstallSelection(installation,registry);
        const retained=await retainRatingsRuntime({installationDirectory:installation,directory:destination});
        return {...retained,installation:{operationId:operation.id,installationDirectory:installation,receipt:existing.receipt}};
      }
    }else {
      if(await lstatMaybe(installation)) {
        await directory(installation);
        if((await fs.readdir(installation)).some(name=>!/^\.stellar-ratings-install\.json\.partial-[0-9a-f-]{36}$/.test(name)))
          fail('RUNTIME_INSTALL_DESTINATION_CONFLICT',{directory:installation});
      }else await fs.mkdir(installation,{mode:0o700});
      await atomicBytes(installation,'.stellar-ratings-install.json',jsonBytes(operation));
    }
    const [nodeMajor,nodeMinor]=process.versions.node.split('.').map(Number);
    if(nodeMajor<22||(nodeMajor===22&&nodeMinor<12))
      fail('RUNTIME_NODE_VERSION_REQUIRED',{minimum:'22.12.0',actual:process.versions.node});
    const {executable:npm,version:npmVersion}=await selectNpmTool(npmExecutable);
    const tools={npm,node:await fs.realpath(process.execPath)};
    const toolchain={node:process.versions.node,npm:npmVersion,platform:process.platform,architecture:process.arch};
    if(operation.tools&&(canonical(operation.tools)!==canonical(tools)||canonical(operation.toolchain)!==canonical(toolchain)))
      fail('RUNTIME_INSTALL_TOOLCHAIN_CHANGED');
    const toolBindings=await prepareInstallToolBindings(operationDirectory,tools);
    operation={...operation,tools,toolchain,
      toolDirectories:[toolBindings,...new Set(Object.values(tools).map(value=>path.dirname(value)))],status:'INSTALLING'};
    await atomicBytes(operationDirectory,'operation.json',jsonBytes(operation));
    const packageJSON={name:'stellar-ratings-original-consumer',version:'1.0.0',private:true,type:'module',
      dependencies:{[SDK_NATIVE]:SDK_VERSION}};
    await writeSelectedFile(installation,'package.json',jsonBytes(packageJSON));
    const step=await executeInstallStage(operation,'package-install',npm,
      ['install','--package-lock=true','--no-audit','--no-fund','--omit=dev'],installation,{signal,progress});
    operation.steps=[step];await atomicBytes(operationDirectory,'operation.json',jsonBytes(operation));
    const packageFile=await readJSON(path.join(installation,'package.json'));
    const lockFile=await readJSON(path.join(installation,'package-lock.json'));
    validateInstallPackage(packageFile.value,lockFile.value);
    const installed=await resolvePackage(SDK_NATIVE,installation);
    if(!installed)fail('RATINGS_STELLAR_NOT_INSTALLED');
    requireOriginalSDK(installed.metadata,registry);
    const receipt={schema:INSTALL_RECEIPT_SCHEMA,operationId:operation.id,registrySha256:REGISTRY_SHA256,
      package:SDK_NATIVE,version:SDK_VERSION,integrity:SDK_INTEGRITY,
      createdAt:operation.createdAt,completedAt:new Date().toISOString(),toolchain,steps:[step],
      packageFile:{bytes:packageFile.bytes.length,sha256:sha256(packageFile.bytes)},
      lockFile:{bytes:lockFile.bytes.length,sha256:sha256(lockFile.bytes)}};
    validateInstallReceipt(receipt);
    operation={...operation,status:'COMPLETE',receipt};
    await atomicBytes(operationDirectory,'operation.json',jsonBytes(operation));
    await atomicBytes(installation,'.stellar-ratings-install.json',jsonBytes(operation));
    const retained=await retainRatingsRuntime({installationDirectory:installation,directory:destination});
    await progress?.({stage:'runtime-retained',status:'COMPLETE',operationId:operation.id,
      runtimeId:retained.id,manifestSha256:retained.manifestSha256});
    return {...retained,installation:{operationId:operation.id,installationDirectory:installation,receipt}};
  }finally{await release();}
}

function abortInstall(signal) {
  if(signal?.aborted)fail('RUNTIME_INSTALL_ABORTED');
}
async function actualExecutable(value,name) {
  if(typeof value!=='string'||!value||value.includes('\0'))fail('RUNTIME_INSTALL_TOOL_REQUIRED',{tool:name});
  const candidates=value.includes(path.sep)?[path.resolve(value)]:
    (process.env.PATH??'').split(path.delimiter).filter(Boolean).map(root=>path.join(root,value));
  for(const candidate of candidates) {
    try {
      await fs.access(candidate,constants.X_OK);
      const original=await fs.realpath(candidate),info=await fs.stat(original);
      if(info.isFile())return original;
    }catch(error){if(!['ENOENT','EACCES','ENOTDIR'].includes(error.code))throw error;}
  }
  fail('RUNTIME_INSTALL_TOOL_REQUIRED',{tool:name,requested:value});
}
async function selectNpmTool(requested) {
  const candidates=[requested];
  if(requested==='npm') {
    if(typeof process.env.npm_execpath==='string'&&path.isAbsolute(process.env.npm_execpath))
      candidates.push(process.env.npm_execpath);
    candidates.push(path.resolve(path.dirname(process.execPath),'..','lib','node_modules','npm','bin','npm-cli.js'));
  }
  let last;
  for(const candidate of [...new Set(candidates)]) {
    try {
      const executable=await actualExecutable(candidate,'npm');
      return {executable,version:await installToolVersion(executable)};
    }catch(error) {
      if(!['RUNTIME_INSTALL_TOOL_REQUIRED','RUNTIME_INSTALL_TOOL_UNAVAILABLE'].includes(error.code))throw error;
      last=error;
    }
  }
  throw last??new RatingsRuntimeError('RUNTIME_INSTALL_TOOL_REQUIRED',{tool:'npm'});
}

async function prepareInstallToolBindings(operationDirectory,tools) {
  // Lifecycle scripts call the ordinary tool names again. Resolve those names
  // to the same verified executables as the outer native command, rather than
  // inheriting an unrelated launcher from the host's PATH.
  const root=path.join(operationDirectory,'tools');
  await fs.mkdir(root,{recursive:true,mode:0o700});await directory(root);
  for(const[name,executable]of Object.entries(tools)) {
    const target=path.join(root,name),existing=await lstatMaybe(target);
    if(existing) {
      if(!existing.isSymbolicLink()||await fs.realpath(target)!==executable)
        fail('RUNTIME_INSTALL_TOOL_BINDING_CHANGED',{tool:name});
    }else await fs.symlink(executable,target,'file');
  }
  return root;
}
async function installToolVersion(executable) {
  const env={...process.env};delete env.NODE_OPTIONS;
  try {
    const {stdout}=await promisify(execFile)(executable,['--version'],{env,timeout:30000,maxBuffer:64*1024});
    return stdout.trim().replace(/^v/,'');
  }catch(error){fail('RUNTIME_INSTALL_TOOL_UNAVAILABLE',{tool:path.basename(executable)},error);}
}
async function matchesProcessIdentity(owner) {
  if(!object(owner)||!Number.isInteger(owner.pid)||owner.pid<=0)return false;
  try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return false;if(error.code!=='EPERM')throw error;}
  const actual=await processIdentity(owner.pid);
  if(owner.boot&&actual.boot!==owner.boot)return false;
  if(owner.start&&actual.start!==owner.start)return false;
  return true;
}
async function matchingInstallProcesses(command) {
  const result=[];
  if(process.platform!=='linux')return result;
  for(const item of await fs.readdir('/proc',{withFileTypes:true})) {
    if(!item.isDirectory()||!/^\d+$/.test(item.name))continue;
    const pid=Number(item.name);if(pid===process.pid)continue;
    try {
      const info=await fs.stat('/proc/'+pid);
      if(typeof process.getuid==='function'&&info.uid!==process.getuid())continue;
      const environment=await fs.readFile('/proc/'+pid+'/environ');
      const selected=Buffer.from('RATINGS_INSTALL_COMMAND_TOKEN='+command.token+'\0');
      if(environment.includes(selected))result.push(await processIdentity(pid));
    }catch(error){if(!['ENOENT','EACCES','EPERM','ESRCH'].includes(error.code))throw error;}
  }
  return result;
}
async function installCommandActive(command,record) {
  for(const owner of [record?.wrapper,record?.child])
    if(await matchesProcessIdentity(owner))return true;
  return (await matchingInstallProcesses(command)).length>0;
}
/** Internal child entry point for the original native package installation command.
 * The command file carries only this operation's paths and selected argv. Host
 * secrets remain inherited process state and never enter the portable receipt. */
export async function runRatingsInstallChild(commandFile) {
  const file=absolute(commandFile,'commandFile'),attemptDirectory=path.dirname(file);
  const loaded=await readJSON(file),command=loaded.value;
  if(command.schema!==INSTALL_COMMAND_SCHEMA||typeof command.token!=='string'||
    !Array.isArray(command.args)||command.args.some(value=>typeof value!=='string'||value.includes('\0'))||
    typeof command.executable!=='string'||!path.isAbsolute(command.executable)||
    !['package-install'].includes(command.stage)||
    typeof command.cwd!=='string'||!path.isAbsolute(command.cwd))fail('RUNTIME_INSTALL_COMMAND_INVALID');
  if(path.basename(file)!=='command.json'||command.attemptDirectory!==attemptDirectory)fail('RUNTIME_INSTALL_COMMAND_INVALID');
  const release=await acquire(attemptDirectory);
  const statusFile=path.join(attemptDirectory,'result.json');
  try {
    if(await lstatMaybe(statusFile)) {
      const existing=(await readJSON(statusFile)).value;
      if(existing.commandSha256!==sha256(loaded.bytes))fail('RUNTIME_INSTALL_COMMAND_CHANGED');
      if(existing.status==='COMPLETE'||existing.status==='FAILED')return existing;
    }
    await directory(command.cwd);
    const env={...process.env,RATINGS_INSTALL_COMMAND_TOKEN:command.token,RATINGS_INSTALL_OPERATION_ID:command.operationId,
      npm_config_cache:command.cacheDirectory,npm_config_audit:'false',npm_config_fund:'false',
      PATH:command.toolDirectories.join(path.delimiter)+path.delimiter+(process.env.PATH??'')};
    delete env.NODE_OPTIONS;
    const stdout=await fs.open(path.join(attemptDirectory,'stdout.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND,0o600);
    let stderr;
    try{stderr=await fs.open(path.join(attemptDirectory,'stderr.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND,0o600);}
    catch(error){await stdout.close();throw error;}
    let child,termination=null,record={schema:INSTALL_COMMAND_SCHEMA,stage:command.stage,operationId:command.operationId,
      commandSha256:sha256(loaded.bytes),status:'RUNNING',startedAt:new Date().toISOString(),wrapper:await processIdentity()};
    await atomicBytes(attemptDirectory,'result.json',jsonBytes(record));
    const stop=signal=>{termination=signal;if(child&&!child.killed)try{child.kill(signal);}catch{}};
    const sigterm=()=>stop('SIGTERM'),sigint=()=>stop('SIGINT');
    process.on('SIGTERM',sigterm);process.on('SIGINT',sigint);
    try {
      child=spawn(command.executable,command.args,{cwd:command.cwd,env,stdio:['ignore',stdout.fd,stderr.fd]});
      const outcome=new Promise(resolve=>{
        child.once('error',error=>resolve({exitCode:null,signal:null,errorCode:error.code??'SPAWN_FAILED'}));
        child.once('exit',(exitCode,signal)=>resolve({exitCode,signal,errorCode:null}));
      });
      if(child.pid){record={...record,child:await processIdentity(child.pid)};await atomicBytes(attemptDirectory,'result.json',jsonBytes(record));}
      if(termination)stop(termination);
      const finished=await outcome;
      await stdout.sync();await stderr.sync();
      record={...record,...finished,status:finished.exitCode===0?'COMPLETE':'FAILED',finishedAt:new Date().toISOString()};
      await atomicBytes(attemptDirectory,'result.json',jsonBytes(record));
      return record;
    }finally{
      process.off('SIGTERM',sigterm);process.off('SIGINT',sigint);
      await stdout.close();await stderr.close();
    }
  }finally{await release();}
}
async function executeInstallStage(operation,stage,executable,args,cwd,{signal,progress}={}) {
  abortInstall(signal);
  const base=path.join(operation.operationDirectory,'commands',stage);
  await fs.mkdir(base,{recursive:true,mode:0o700});await directory(base);
  const attempts=(await fs.readdir(base)).filter(name=>/^attempt-[0-9a-f-]{36}$/.test(name)).sort();
  let previous=null;
  for(const name of attempts) {
    const attemptDirectory=path.join(base,name),commandFile=path.join(attemptDirectory,'command.json');
    if(!await lstatMaybe(commandFile))continue;
    const commandLoaded=await readJSON(commandFile),command=commandLoaded.value;
    if(command.operationId!==operation.id||command.stage!==stage||command.executable!==executable||
      command.cwd!==cwd||canonical(command.args)!==canonical(args))fail('RUNTIME_INSTALL_COMMAND_CHANGED',{stage});
    const resultFile=path.join(attemptDirectory,'result.json');
    const result=await lstatMaybe(resultFile)?(await readJSON(resultFile)).value:null;
    if(result&&result.commandSha256!==sha256(commandLoaded.bytes))fail('RUNTIME_INSTALL_COMMAND_CHANGED',{stage});
    if(result?.status==='COMPLETE') {
      return {name:stage,status:'COMPLETE',exitCode:0,startedAt:result.startedAt,finishedAt:result.finishedAt,
        argv:[path.basename(executable),...args.map(arg=>path.isAbsolute(arg)?'<operation-path>':arg)],
        recovered:true,attemptId:name,stdoutSha256:(await inspectFile(path.join(attemptDirectory,'stdout.log'))).sha256,
        stderrSha256:(await inspectFile(path.join(attemptDirectory,'stderr.log'))).sha256};
    }
    if(await installCommandActive(command,result))fail('RUNTIME_INSTALL_IN_PROGRESS',{stage,operationId:operation.id,commandFile});
    previous={attemptDirectory,command,result};
  }
  const attemptId='attempt-'+randomUUID(),attemptDirectory=path.join(base,attemptId);
  await fs.mkdir(attemptDirectory,{mode:0o700});
  const command={schema:INSTALL_COMMAND_SCHEMA,operationId:operation.id,stage,token:randomUUID(),
    executable,args,cwd,attemptDirectory,cacheDirectory:path.join(operation.operationDirectory,'npm-cache'),
    toolDirectories:operation.toolDirectories,createdAt:new Date().toISOString()};
  await atomicBytes(attemptDirectory,'command.json',jsonBytes(command));
  await progress?.({stage,status:'RUNNING',operationId:operation.id,attemptId});
  abortInstall(signal);
  const wrapper='const m=await import(process.argv[1]);await m.runRatingsInstallChild(process.argv[2]);';
  const env={...process.env,RATINGS_INSTALL_COMMAND_TOKEN:command.token};delete env.NODE_OPTIONS;
  const child=spawn(process.execPath,['--input-type=module','--eval',wrapper,import.meta.url,path.join(attemptDirectory,'command.json')],
    {cwd:operation.operationDirectory,env,stdio:'ignore'});
  const stop=()=>{if(!child.killed)try{child.kill('SIGTERM');}catch{}};
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)stop();
  const outcome=await new Promise(resolve=>{
    child.once('error',error=>resolve({errorCode:error.code??'SPAWN_FAILED'}));
    child.once('exit',(exitCode,exitSignal)=>resolve({exitCode,exitSignal}));
  });
  signal?.removeEventListener('abort',stop);
  const resultFile=path.join(attemptDirectory,'result.json');
  const result=await lstatMaybe(resultFile)?(await readJSON(resultFile)).value:null;
  if(result?.status!=='COMPLETE') {
    if(await installCommandActive(command,result))fail('RUNTIME_INSTALL_IN_PROGRESS',{stage,operationId:operation.id,
      commandFile:path.join(attemptDirectory,'command.json')});
    if(signal?.aborted)fail('RUNTIME_INSTALL_ABORTED',{stage,operationId:operation.id});
    fail('RUNTIME_INSTALL_COMMAND_FAILED',{stage,operationId:operation.id,exitCode:result?.exitCode??outcome.exitCode??null,
      errorCode:result?.errorCode??outcome.errorCode??null,
      stdout:path.join(attemptDirectory,'stdout.log'),stderr:path.join(attemptDirectory,'stderr.log')});
  }
  const retained={name:stage,status:'COMPLETE',exitCode:0,startedAt:result.startedAt,finishedAt:result.finishedAt,
    argv:[path.basename(executable),...args.map(arg=>path.isAbsolute(arg)?'<operation-path>':arg)],
    attemptId,stdoutSha256:(await inspectFile(path.join(attemptDirectory,'stdout.log'))).sha256,
    stderrSha256:(await inspectFile(path.join(attemptDirectory,'stderr.log'))).sha256};
  await progress?.({stage,status:'COMPLETE',operationId:operation.id,attemptId});
  return retained;
}
async function writeSelectedFile(root,rel,bytes,fileMode=0o644) {
  await safeParents(root,rel,{create:true});
  const target=join(root,rel),existing=await lstatMaybe(target);
  if(existing) {
    if(!existing.isFile()||existing.isSymbolicLink())fail('RUNTIME_INSTALL_DESTINATION_CONFLICT',{path:rel});
    const actual=await inspectFile(target);
    if(actual.bytes!==bytes.length||actual.sha256!==sha256(bytes))fail('RUNTIME_INSTALL_DESTINATION_CONFLICT',{path:rel});
    await fs.chmod(target,fileMode);
  }else await atomicBytes(root,rel,bytes,fileMode);
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
        const result = await verifyRatingsRuntime({directory: destination});
        if (result.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        return result;
      }
      if ((await fs.readdir(destination)).length) fail('RUNTIME_DESTINATION_NOT_EMPTY', {directory: destination});
    }
    const staging = destination + '.runtime-stage';
    const existed = await lstatMaybe(staging);
    if (!existed) {
      await fs.mkdir(staging, {mode: 0o700});
      await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.stellar-ratings.runtime-operation.v1', kind, id: plan.manifest.id}));
    } else {
      await directory(staging);
      const markerFile = path.join(staging, '.operation.json');
      if (await lstatMaybe(markerFile)) {
        const marker = (await readJSON(markerFile)).value;
        if (marker.schema !== 'stellar-forge.stellar-ratings.runtime-operation.v1' || marker.kind !== kind || marker.id !== plan.manifest.id)
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else if (await lstatMaybe(path.join(staging, 'manifest.json'))) {
        const retained = await loadManifest(staging);
        if (retained.manifest.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else {
        const leftovers = await fs.readdir(staging);
        if (leftovers.some(name => !/^\.operation\.json\.partial-[0-9a-f-]{36}$/.test(name)))
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        for (const name of leftovers) await fs.rm(path.join(staging, name), {force: true});
        await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.stellar-ratings.runtime-operation.v1', kind, id: plan.manifest.id}));
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

/** Capture the complete installed stellar package before importing any of its code.
 * The exact generation directory is caller-selected. An acknowledged immutable
 * generation reopens as itself; interrupted copies retain their original plan ID.
 */
export async function retainRatingsRuntime({directory: selectedDirectory, installationDirectory = HERE} = {}) {
  const destination = absolute(selectedDirectory, 'directory');
  const installed = absolute(installationDirectory, 'installationDirectory');
  if (await lstatMaybe(path.join(destination, 'manifest.json')))
    return verifyRatingsRuntime({directory: destination});
  const plan = await planRuntime(installed);
  return materialize(destination, plan, 'retain');
}

/** Verify original bytes, permission bits, complete package graph and real links.
 * This function reads source only; it never imports stellar.
 */
export async function verifyRatingsRuntime({directory: selectedDirectory, expectedManifestSha256} = {}) {
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
export async function restoreRatingsRuntime({sourceDirectory, destination: selectedDestination, expectedManifestSha256} = {}) {
  const source = absolute(sourceDirectory, 'sourceDirectory');
  const destination = absolute(selectedDestination, 'destination');
  if (source === destination) return verifyRatingsRuntime({directory: source, expectedManifestSha256});
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
export async function bindRatingsRuntime({directory: selectedDirectory, applicationDirectory, expectedManifestSha256} = {}) {
  const runtime = await verifyRatingsRuntime({directory:selectedDirectory, expectedManifestSha256});
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
  return {schema:'stellar-forge.stellar-ratings.runtime-binding.v1',runtimeId:runtime.id,
    runtimeDirectory:runtime.directory,manifestSha256:runtime.manifestSha256,
    applicationDirectory:applicationRoot,packageBindings:runtime.packageBindings,bindings,
    version:runtime.manifest.stellar.version};
}

/** Resolve the trusted host selection without importing stellar. A transported
 * runtime may contain regular files only; its original link/mode graph is then
 * reconstructed in an independent deterministic installed directory. */
export async function resolveRatingsRuntime({installationDirectory,runtimeDirectory,expectedManifestSha256}={}) {
  let retained;
  if(runtimeDirectory!==undefined) {
    const selected=absolute(runtimeDirectory,'runtimeDirectory');
    if(await lstatMaybe(path.join(selected,'manifest.json'))) {
      const loaded=await loadManifest(selected,expectedManifestSha256);
      await verifyFiles(selected,loaded.manifest,{layout:false});
      try { return await verifyRatingsRuntime({directory:selected,expectedManifestSha256}); }
      catch(error) {
        if(!['RUNTIME_LINK_MISMATCH','RUNTIME_DIRECTORY_MODE_MISMATCH','RUNTIME_FILE_MODE_MISMATCH','RUNTIME_DIRECTORY_REQUIRED'].includes(error.code))
          throw error;
        return restoreRatingsRuntime({sourceDirectory:selected,destination:selected+'.installed-'+loaded.manifest.id,
          expectedManifestSha256:loaded.manifestSha256});
      }
    }
    retained=await retainRatingsRuntime({directory:selected,installationDirectory:installationDirectory??HERE});
  } else {
    const installed=absolute(installationDirectory??HERE,'installationDirectory');
    const plan=await planRuntime(installed);
    retained=await materialize(path.join(installed,'.stellar-ratings-runtimes',plan.manifest.id),plan,'retain');
  }
  if(expectedManifestSha256!==undefined&&retained.manifestSha256!==hash(expectedManifestSha256,'expectedManifestSha256'))
    fail('RUNTIME_MANIFEST_HASH_MISMATCH');
  return retained;
}
export function publicRatingsRuntime(runtime) {
  return Object.freeze({id:hash(runtime.id,'runtime.id'),manifestSha256:hash(runtime.manifestSha256,'runtime.manifestSha256'),
    version:SDK_VERSION});
}
/** Import only the verified original immutable runtime; decoding uses the
 * native Stellar asset, address, XDR, RPC and contract implementation. */
export async function loadRatingsStellar(options={}) {
  const retained=await resolveRatingsRuntime(options);
  let stellar;
  try{stellar=await import(pathToFileURL(retained.entrypoint).href);}
  catch(error){fail('RATINGS_STELLAR_IMPORT_FAILED',{runtimeId:retained.id},error);}
  const required=['Asset','MuxedAccount','Address','Contract','Account','TransactionBuilder','Transaction','FeeBumpTransaction'];
  if(required.some(name=>typeof stellar[name]!=='function')||typeof stellar.StrKey?.decodeEd25519PublicKey!=='function'||
    typeof stellar.rpc?.Server!=='function'||typeof stellar.contract?.Spec!=='function'||
    typeof stellar.xdr?.LedgerKey?.contractData!=='function'||typeof stellar.scValToNative!=='function')
    fail('RATINGS_STELLAR_EXPORTS_CHANGED',{runtimeId:retained.id});
  return {stellar,runtime:publicRatingsRuntime(retained)};
}
export const ratingsRuntimeSelection=Object.freeze({schema:SCHEMA,package:SDK_NATIVE,version:SDK_VERSION,
  originalRegistrySha256:REGISTRY_SHA256,integrity:SDK_INTEGRITY,exports:Object.freeze([...EXPORTS])});

/** Read the exact retained manifest without importing or installing packages. */
export async function readRatingsRuntimeManifest({directory:selectedDirectory,expectedManifestSha256}={}) {
  return loadManifest(absolute(selectedDirectory,'directory'),expectedManifestSha256);
}
