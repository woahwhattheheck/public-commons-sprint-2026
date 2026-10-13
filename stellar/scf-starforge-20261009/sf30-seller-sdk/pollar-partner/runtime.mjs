// MIT. Complete original Pollar source builds, browser assets and portable dependency receiving.
import {createHash, randomUUID} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.pollar-partner.runtime.v1';
const BUFFER_BYTES=256*1024;
const SHA256=/^[a-f0-9]{64}$/;
const PACKAGE_NAME=/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const VCS=new Set(['.git','.hg','.svn']);
const FILE_HASH_CACHE=new Map();
const FILE_HASH_CACHE_LIMIT=8192;

export class PollarRuntimeError extends Error {
  constructor(code, details = {}, cause) {
    super(code, cause ? {cause} : undefined);
    this.name = 'PollarRuntimeError';
    this.code = code;
    this.details = details;
  }
  toJSON() { return {code: this.code, details: this.details}; }
}
function fail(code, details, cause) { throw new PollarRuntimeError(code, details, cause); }
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
function descriptor(directory,manifest,manifestSha256){
 const map=values=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,join(directory,value)]));
 return {id:manifest.id,directory,manifest,manifestSha256,entrypoints:map(manifest.entrypoints),
  requireEntrypoints:map(manifest.requireEntrypoints),packageBindings:map(manifest.packageBindings),
  browser:{...manifest.browser,directory:join(directory,manifest.browser.directory),
   module:join(directory,manifest.browser.module),css:join(directory,manifest.browser.css)},
  versions:{...manifest.versions}};
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


const SOURCE_COMMIT='b67e306439511df00f63374445e315b68fa36b92';
const SOURCE_INVENTORY_SHA256='d051139b7fd33ff99bb8bbc76f39ec6640f6695105e0826a8356a73def7cf5ad';
const PACKAGES=['@pollar/core','@pollar/react','@pollar/accesly-adapter'];
const SDK_VERSION='0.12.0-rc.1';
const ROOT_EXPORTS=['@pollar/core','@pollar/react','@pollar/accesly-adapter','react','react-dom/client','esbuild'];
const BUILD_SCHEMA='stellar-forge.pollar-partner.build-operation.v1';
const BUILD_RECEIPT_SCHEMA='stellar-forge.pollar-partner.build-receipt.v1';
const BUILD_COMMAND_SCHEMA='stellar-forge.pollar-partner.build-command.v1';
const BUILD_STAGES=new Set(['source-install','build-core','build-react','build-accesly','browser-bundle']);
function buildStage(value){return BUILD_STAGES.has(value)||/^recover-(?:core|react|accesly|browser)-[a-f0-9]{12}$/.test(value);}
function buildHeap(value){if(value===null||value===undefined)return null;if(!Number.isInteger(value)||value<128||value>65536)fail('RUNTIME_BUILD_HEAP_INVALID');return value;}
function abortBuild(signal){if(signal?.aborted)fail('RUNTIME_BUILD_ABORTED');}
function capsuleOriginal(value){
 if(!object(value)||!Array.isArray(value.files)||value.files.length!==343)fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
 const seen=new Set(),inventory=[];
 for(const file of value.files){
  relative(file.path);if(seen.has(file.path)||file.encoding!=='utf-8'||typeof file.content!=='string')fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
  seen.add(file.path);const content=Buffer.from(file.content,'utf8');
  if(file.bytes!==content.length||file.sha256!==sha256(content)||
   file.gitBlobSha!==createHash('sha1').update(Buffer.from('blob '+content.length+'\0')).update(content).digest('hex'))
   fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH',{path:file.path});
  inventory.push({path:file.path,mode:file.mode,bytes:file.bytes,sha256:file.sha256,gitBlobSha:file.gitBlobSha});
 }
 inventory.sort((a,b)=>a.path.localeCompare(b.path,'en'));
 if(sha256(Buffer.from(canonical(inventory)))!==SOURCE_INVENTORY_SHA256)fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
 const byPath=new Map(value.files.map(file=>[file.path,file]));
 const packageJSON=JSON.parse(byPath.get('package.json').content),lock=JSON.parse(byPath.get('package-lock.json').content);
 if(packageJSON.packageManager!=='npm@10.9.4'||lock.lockfileVersion!==3)fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
 for(const name of PACKAGES){const key='packages/'+(name==='@pollar/accesly-adapter'?'accesly-adapter':name.split('/')[1])+'/package.json';
  const metadata=JSON.parse(byPath.get(key)?.content??'null');
  if(metadata?.name!==name||metadata.version!==SDK_VERSION||metadata.license!=='Apache-2.0')fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');}
 return {value,byPath,lock,packageJSON};
}
async function publisherSources(installationDirectory){
 const original=await readJSON(path.join(HERE,'source','pollar-sdk-source.json'));
 const checked=capsuleOriginal(original.value),files=[{path:'publisher/pollar/source.json',content:original.bytes,mode:0o644}];
 const receipt=(await readJSON(path.join(installationDirectory,'.pollar-build.json'))).value;
 if(receipt.schema!==BUILD_RECEIPT_SCHEMA||receipt.commit!==SOURCE_COMMIT||receipt.sourceInventorySha256!==SOURCE_INVENTORY_SHA256)
  fail('RUNTIME_BUILD_RECEIPT_REQUIRED');
 await verifyOriginalSource(installationDirectory,checked);await verifyCompiled(installationDirectory,receipt.compiled);
 files.push({path:'publisher/pollar/build.json',content:jsonBytes(receipt),mode:0o644});
 return {checked,receipt,files,description:{repository:'pollar-xyz/pollar',commit:SOURCE_COMMIT,license:'Apache-2.0',
  sourceInventorySha256:SOURCE_INVENTORY_SHA256,source:{path:files[0].path,bytes:files[0].content.length,sha256:sha256(files[0].content)},
  build:{path:files[1].path,bytes:files[1].content.length,sha256:sha256(files[1].content)}}};
}
function packageDeclarations(metadata){
 const declarations=new Map();
 for(const[name,range]of Object.entries(metadata.dependencies??{}))declarations.set(name,{name,range,kind:'dependency',optional:false});
 for(const[name,range]of Object.entries(metadata.optionalDependencies??{}))declarations.set(name,{name,range,kind:'optional',optional:true});
 for(const[name,range]of Object.entries(metadata.peerDependencies??{}))if(!declarations.has(name))
  declarations.set(name,{name,range,kind:'peer',optional:metadata.peerDependenciesMeta?.[name]?.optional===true});
 return declarations;
}
async function discover(installationDirectory,checked){
 const packages=[],byRoot=new Map(),byLookup=new Map();
 function add(found){
  let node=byRoot.get(found.root);
  if(!node){node={...found,id:'p'+String(packages.length).padStart(4,'0'),dependencies:[],installed:[]};
   node.path='packages/'+node.id;packages.push(node);byRoot.set(node.root,node);}
  byLookup.set(found.lookup,node);return node;
 }
 const buildRoot=add(await packageAt(installationDirectory)),roots={};
 if(buildRoot.metadata.name!==checked.packageJSON.name)fail('RUNTIME_BUILD_SOURCE_CHANGED');
 for(const name of [...PACKAGES,'react','react-dom','esbuild']){
  const found=await resolvePackage(name,installationDirectory);if(!found)fail('RUNTIME_DEPENDENCY_MISSING',{package:name});
  if(PACKAGES.includes(name)&&found.metadata.version!==SDK_VERSION)fail('RUNTIME_ORIGINAL_PACKAGE_DECLARATION_CHANGED',{package:name});
  roots[name]=add(found);
 }
 for(let index=0;index<packages.length;index++){
  const node=packages[index];
  for(const dependency of [...packageDeclarations(node.metadata).values()].sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   const found=await resolvePackage(dependency.name,node.root);
   if(!found){node.dependencies.push({...dependency,packageId:null,present:false});if(!dependency.optional)fail('RUNTIME_DEPENDENCY_MISSING',{package:node.metadata.name,dependency:dependency.name});}
   else{const other=add(found);node.dependencies.push({...dependency,packageId:other.id,present:true});}
  }
  async function scan(current,rel=''){
   for(const entry of (await fs.readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(VCS.has(entry.name))continue;
    const filename=path.join(current,entry.name),childRel=rel?rel+'/'+entry.name:entry.name;
    if(entry.name==='node_modules'&&entry.isDirectory()){
     for(const child of await installedChildren(filename)){
      const found=await packageAt(child.lookup);
      if(within(installationDirectory,found.root)&&!path.relative(installationDirectory,found.root).split(path.sep).includes('node_modules')&&!PACKAGES.includes(found.metadata.name))continue;
      const other=add(found);node.installed.push({path:childRel+'/'+child.name,name:child.name,packageId:other.id});
     }continue;
    }
    if(entry.isDirectory()){const other=byRoot.get(filename);if(!other||other===node)await scan(filename,childRel);}
   }
  }
  await scan(node.root);
 }
 for(const node of packages){
  const relativeRoot=path.relative(installationDirectory,node.root).split(path.sep).join('/');
  if(!within(installationDirectory,node.root))fail('RUNTIME_DEPENDENCY_OUTSIDE_SELECTED_INSTALLATION',{package:node.metadata.name});
  const declared=checked.lock.packages[relativeRoot];
  if(!declared||declared.version!==undefined&&declared.version!==node.metadata.version)
   fail('RUNTIME_ORIGINAL_LOCK_SELECTION_CHANGED',{package:node.metadata.name,path:relativeRoot});
  node.lockPath=relativeRoot;
 }
 return {root:roots['@pollar/core'],roots,buildRoot,packages,byRoot,byLookup};
}
async function nativeEntrypoints(graph,installationDirectory){
 const request={exports:ROOT_EXPORTS,parent:pathToFileURL(path.join(installationDirectory,'__pollar_resolution__.mjs')).href};
 const resolver='import {createRequire} from "node:module";const r=JSON.parse(process.argv[1]);const require=createRequire(r.parent),out={import:{},require:{}};for(const name of r.exports){out.import[name]=await import.meta.resolve(name,r.parent);out.require[name]=require.resolve(name);}process.stdout.write(JSON.stringify(out));';
 const env={...process.env};delete env.NODE_OPTIONS;
 let output;try{output=await promisify(execFile)(process.execPath,['--experimental-import-meta-resolve','--input-type=module','--eval',resolver,JSON.stringify(request)],
  {cwd:installationDirectory,env,timeout:30000,maxBuffer:1024*1024});}catch(error){fail('RUNTIME_EXPORT_RESOLUTION_FAILED',{},error);}
 const entries=JSON.parse(output.stdout),result={import:{},require:{}};
 for(const kind of ['import','require'])for(const name of ROOT_EXPORTS){
  const file=kind==='import'?fileURLToPath(entries[kind][name]):entries[kind][name],actual=await fs.realpath(file);
  if(!within(installationDirectory,actual))fail('RUNTIME_EXPORT_RESOLUTION_FAILED',{package:name});result[kind][name]=actual;
 }return result;
}
async function planRuntime(installationDirectory) {
  const publisher = await publisherSources(installationDirectory);
  const graph = await discover(installationDirectory,publisher.checked);
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
  for(const[name,node]of Object.entries(graph.roots))addLink('node_modules/'+name,node.path);
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
  for(const[kind,output]of [['import',entrypoints],['require',requireEntrypoints]])for(const name of ROOT_EXPORTS) {
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
  const packageBindings=Object.fromEntries(Object.entries(graph.roots).map(([name,node])=>[name,node.path]));
  const sortedFiles = [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {
    schema: SCHEMA,
    versions:Object.fromEntries(Object.entries(graph.roots).map(([name,node])=>[name,node.metadata.version])),
    source:{commit:SOURCE_COMMIT,inventorySha256:SOURCE_INVENTORY_SHA256,buildPackageId:graph.buildRoot.id},
    browser:{directory:graph.buildRoot.path+'/.pollar-browser',module:graph.buildRoot.path+'/.pollar-browser/pollar-runtime.mjs',
      css:graph.buildRoot.path+'/.pollar-browser/pollar-runtime.css',metafile:graph.buildRoot.path+'/.pollar-browser/metafile.json'},
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
      !object(manifest.entrypoints) || !object(manifest.requireEntrypoints) || !object(manifest.versions)||PACKAGES.some(name=>manifest.versions[name]!==SDK_VERSION))
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
    if(Object.keys(entries).length!==ROOT_EXPORTS.length)fail('RUNTIME_ENTRYPOINTS_INVALID');
    for(const name of ROOT_EXPORTS) {
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
  if(!packageIds.has(manifest.source?.buildPackageId)||manifest.source.commit!==SOURCE_COMMIT||manifest.source.inventorySha256!==SOURCE_INVENTORY_SHA256)
    fail('RUNTIME_PACKAGE_GRAPH_INVALID');
  if(!object(manifest.packageBindings)||PACKAGES.some(name=>!manifest.packageBindings[name]))fail('RUNTIME_PACKAGE_BINDINGS_INVALID');
  for(const[name,target]of Object.entries(manifest.packageBindings)){
    const selected=manifest.packages.find(item=>item.path===target&&item.name===name);
    if(!selected||selected.version!==manifest.versions[name]||resolveLogical('node_modules/'+name)!==target)fail('RUNTIME_PACKAGE_BINDINGS_INVALID',{package:name});
  }
  for(const key of ['module','css','metafile']){
    const file=manifest.browser?.[key];
    if(typeof file!=='string'||!file.startsWith(manifest.browser.directory+'/')||paths.get(file)!=='file')
      fail('RUNTIME_BROWSER_ASSET_INVALID',{asset:key});
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
  if(manifest.publisher?.commit!==SOURCE_COMMIT||manifest.publisher?.sourceInventorySha256!==SOURCE_INVENTORY_SHA256)
    fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
  for(const item of [manifest.publisher.source,manifest.publisher.build]){
    const file=manifest.files.find(row=>row.path===item?.path);
    if(!file||file.bytes!==item.bytes||file.sha256!==item.sha256)fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
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
  await verifyPublisherFiles(root, manifest);
}



async function verifyPublisherFiles(root,manifest){
 const source=await readJSON(join(root,manifest.publisher.source.path));const checked=capsuleOriginal(source.value);
 if(sha256(source.bytes)!==manifest.publisher.source.sha256)fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
 const receipt=(await readJSON(join(root,manifest.publisher.build.path))).value;
 if(receipt.schema!==BUILD_RECEIPT_SCHEMA||receipt.commit!==SOURCE_COMMIT||receipt.sourceInventorySha256!==SOURCE_INVENTORY_SHA256)
  fail('RUNTIME_BUILD_RECEIPT_REQUIRED');
 const build=manifest.packages.find(item=>item.id===manifest.source.buildPackageId);
 if(!build)fail('RUNTIME_BUILD_SOURCE_CHANGED');
 const compiled=receipt.compiled;
 if(!object(compiled)||!Array.isArray(compiled.files)||compiled.sha256!==sha256(Buffer.from(canonical(compiled.files))))
  fail('RUNTIME_COMPILED_SOURCE_INVALID');
 for(const file of compiled.files){
  const resolved=runtimeLogicalFile(manifest,path.posix.join(build.path,relative(file.path)));
  const declared=manifest.files.find(item=>item.path===resolved),info=await inspectFile(join(root,resolved));
  if(!declared||declared.sha256!==file.sha256||declared.bytes!==file.bytes||declared.mode!==file.mode||
    info.sha256!==file.sha256||info.bytes!==file.bytes)fail('RUNTIME_COMPILED_SOURCE_CHANGED',{path:file.path});
 }
 for(const file of checked.value.files){
  // Workspace packages are deduplicated into original graph roots. Follow the
  // manifest's relative logical links only after the layout was verified.
  const original=path.posix.join(build.path,file.path);
  const resolved=runtimeLogicalFile(manifest,original);
  const info=await inspectFile(join(root,resolved));if(info.bytes!==file.bytes||info.sha256!==file.sha256)fail('RUNTIME_BUILD_SOURCE_CHANGED',{path:file.path});
 }
}
async function actualExecutable(value,name) {
  if(typeof value!=='string'||!value||value.includes('\0'))fail('RUNTIME_BUILD_TOOL_REQUIRED',{tool:name});
  const candidates=value.includes(path.sep)?[path.resolve(value)]:
    (process.env.PATH??'').split(path.delimiter).filter(Boolean).map(root=>path.join(root,value));
  for(const candidate of candidates) {
    try {
      await fs.access(candidate,constants.X_OK);
      const original=await fs.realpath(candidate),info=await fs.stat(original);
      if(info.isFile())return original;
    }catch(error){if(!['ENOENT','EACCES','ENOTDIR'].includes(error.code))throw error;}
  }
  fail('RUNTIME_BUILD_TOOL_REQUIRED',{tool:name,requested:value});
}
async function prepareBuildToolBindings(buildDirectory,tools) {
  // Lifecycle scripts call the ordinary tool names again. Resolve those names
  // to the same verified executables as the outer native command, rather than
  // inheriting an unrelated launcher from the host's PATH.
  const root=path.join(buildDirectory,'tools');
  await fs.mkdir(root,{recursive:true,mode:0o700});await directory(root);
  for(const[name,executable]of Object.entries(tools)) {
    const target=path.join(root,name),existing=await lstatMaybe(target);
    if(existing) {
      if(!existing.isSymbolicLink()||await fs.realpath(target)!==executable)
        fail('RUNTIME_BUILD_TOOL_BINDING_CHANGED',{tool:name});
    }else await fs.symlink(executable,target,'file');
  }
  return root;
}
async function buildToolVersion(executable) {
  const env={...process.env};delete env.NODE_OPTIONS;
  try {
    const {stdout}=await promisify(execFile)(executable,['--version'],{env,timeout:30000,maxBuffer:64*1024});
    return stdout.trim().replace(/^v/,'');
  }catch(error){fail('RUNTIME_BUILD_TOOL_UNAVAILABLE',{tool:path.basename(executable)},error);}
}
async function matchesProcessIdentity(owner) {
  if(!object(owner)||!Number.isInteger(owner.pid)||owner.pid<=0)return false;
  if(process.platform==='linux'){
    const actual=Number.isInteger(owner.procPid)&&owner.procPid>0?await procIdentity(owner.procPid):await processIdentity(owner.pid);
    if(!actual||actual.absent)return false;
    if(owner.boot&&actual.boot!==owner.boot||owner.namespace&&actual.namespace!==owner.namespace||
       owner.start&&actual.start!==owner.start)return false;
    if(owner.procPid&&(!owner.start||actual.procPid!==owner.procPid))return false;
    return true;
  }
  try{process.kill(owner.pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;if(error.code==='EPERM')return true;throw error;}
}
async function matchingBuildProcesses(command) {
  const result=[];
  if(process.platform!=='linux')return result;
  for(const item of await fs.readdir('/proc',{withFileTypes:true})) {
    if(!item.isDirectory()||!/^\d+$/.test(item.name))continue;
    const pid=Number(item.name);if(pid===process.pid)continue;
    try {
      const info=await fs.stat('/proc/'+pid);
      if(typeof process.getuid==='function'&&info.uid!==process.getuid())continue;
      const environment=await fs.readFile('/proc/'+pid+'/environ');
      const selected=Buffer.from('POLLAR_BUILD_COMMAND_TOKEN='+command.token+'\0');
      if(environment.includes(selected)){const actual=await procIdentity(pid);if(actual)result.push(actual);}
    }catch(error){if(!['ENOENT','EACCES','EPERM','ESRCH'].includes(error.code))throw error;}
  }
  return result;
}
async function buildCommandActive(command,record) {
  for(const owner of [record?.wrapper,record?.child])
    if(await matchesProcessIdentity(owner))return true;
  return (await matchingBuildProcesses(command)).length>0;
}
/** Internal child entry point for the original native compiler/install command.
 * The command file carries only this operation's paths and selected argv. Host
 * secrets remain inherited process state and never enter the portable receipt. */
export async function runPollarBuildChild(commandFile) {
  const file=absolute(commandFile,'commandFile'),attemptDirectory=path.dirname(file);
  const loaded=await readJSON(file),command=loaded.value;
  if(command.schema!==BUILD_COMMAND_SCHEMA||typeof command.token!=='string'||
    !Array.isArray(command.args)||command.args.some(value=>typeof value!=='string'||value.includes('\0'))||
    typeof command.executable!=='string'||!path.isAbsolute(command.executable)||
    !buildStage(command.stage)||
    typeof command.cwd!=='string'||!path.isAbsolute(command.cwd))fail('RUNTIME_BUILD_COMMAND_INVALID');
  if(path.basename(file)!=='command.json'||command.attemptDirectory!==attemptDirectory)fail('RUNTIME_BUILD_COMMAND_INVALID');
  const release=await acquire(attemptDirectory);
  const statusFile=path.join(attemptDirectory,'result.json');
  try {
    if(await lstatMaybe(statusFile)) {
      const existing=(await readJSON(statusFile)).value;
      if(existing.commandSha256!==sha256(loaded.bytes))fail('RUNTIME_BUILD_COMMAND_CHANGED');
      if(existing.status==='COMPLETE'||existing.status==='FAILED')return existing;
    }
    await directory(command.cwd);
    const env={...process.env,POLLAR_BUILD_COMMAND_TOKEN:command.token,POLLAR_BUILD_OPERATION_ID:command.operationId,
      npm_config_cache:command.cacheDirectory,npm_config_audit:'false',npm_config_fund:'false',
      PATH:command.toolDirectories.join(path.delimiter)+path.delimiter+(process.env.PATH??'')};
    delete env.NODE_OPTIONS;
    const heapMB=buildHeap(command.nodeHeapMB);
    if(heapMB!==null)env.NODE_OPTIONS='--max-old-space-size='+heapMB;
    const stdout=await fs.open(path.join(attemptDirectory,'stdout.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND,0o600);
    let stderr;
    try{stderr=await fs.open(path.join(attemptDirectory,'stderr.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND,0o600);}
    catch(error){await stdout.close();throw error;}
    let child,termination=null,record={schema:BUILD_COMMAND_SCHEMA,stage:command.stage,operationId:command.operationId,
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
async function executeBuildStage(operation,stage,executable,args,cwd,{signal,progress}={}) {
  abortBuild(signal);
  const base=path.join(operation.buildDirectory,'commands',stage);
  await fs.mkdir(base,{recursive:true,mode:0o700});await directory(base);
  const attempts=(await fs.readdir(base)).filter(name=>/^attempt-[0-9a-f-]{36}$/.test(name)).sort();
  let previous=null;
  for(const name of attempts) {
    const attemptDirectory=path.join(base,name),commandFile=path.join(attemptDirectory,'command.json');
    if(!await lstatMaybe(commandFile))continue;
    const commandLoaded=await readJSON(commandFile),command=commandLoaded.value;
    if(command.operationId!==operation.id||command.stage!==stage||command.executable!==executable||
      command.cwd!==cwd||canonical(command.args)!==canonical(args))fail('RUNTIME_BUILD_COMMAND_CHANGED',{stage});
    const resultFile=path.join(attemptDirectory,'result.json');
    const result=await lstatMaybe(resultFile)?(await readJSON(resultFile)).value:null;
    if(result&&result.commandSha256!==sha256(commandLoaded.bytes))fail('RUNTIME_BUILD_COMMAND_CHANGED',{stage});
    if(result?.status==='COMPLETE') {
      return {name:stage,status:'COMPLETE',exitCode:0,startedAt:result.startedAt,finishedAt:result.finishedAt,
        argv:[path.basename(executable),...args.map(arg=>path.isAbsolute(arg)?'<operation-path>':arg)],
        recovered:true,nodeHeapMB:buildHeap(command.nodeHeapMB),attemptId:name,stdoutSha256:(await inspectFile(path.join(attemptDirectory,'stdout.log'))).sha256,
        stderrSha256:(await inspectFile(path.join(attemptDirectory,'stderr.log'))).sha256};
    }
    if(await buildCommandActive(command,result))fail('RUNTIME_BUILD_IN_PROGRESS',{stage,operationId:operation.id,commandFile});
    previous={attemptDirectory,command,result};
  }
  const attemptId='attempt-'+randomUUID(),attemptDirectory=path.join(base,attemptId);
  await fs.mkdir(attemptDirectory,{mode:0o700});
  const command={schema:BUILD_COMMAND_SCHEMA,operationId:operation.id,stage,token:randomUUID(),
    executable,args,cwd,attemptDirectory,cacheDirectory:path.join(operation.buildDirectory,'npm-cache'),
    toolDirectories:operation.toolDirectories,nodeHeapMB:buildHeap(operation.nodeHeapMB),createdAt:new Date().toISOString()};
  await atomicBytes(attemptDirectory,'command.json',jsonBytes(command));
  await progress?.({stage,status:'RUNNING',operationId:operation.id,attemptId});
  abortBuild(signal);
  const wrapper='const m=await import(process.argv[1]);await m.runPollarBuildChild(process.argv[2]);';
  const env={...process.env,POLLAR_BUILD_COMMAND_TOKEN:command.token};delete env.NODE_OPTIONS;
  if(command.nodeHeapMB!==null)env.NODE_OPTIONS='--max-old-space-size='+command.nodeHeapMB;
  const child=spawn(process.execPath,['--input-type=module','--eval',wrapper,import.meta.url,path.join(attemptDirectory,'command.json')],
    {cwd:operation.buildDirectory,env,stdio:'ignore'});
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
    if(await buildCommandActive(command,result))fail('RUNTIME_BUILD_IN_PROGRESS',{stage,operationId:operation.id,
      commandFile:path.join(attemptDirectory,'command.json')});
    if(signal?.aborted)fail('RUNTIME_BUILD_ABORTED',{stage,operationId:operation.id});
    fail('RUNTIME_BUILD_COMMAND_FAILED',{stage,operationId:operation.id,exitCode:result?.exitCode??outcome.exitCode??null,
      errorCode:result?.errorCode??outcome.errorCode??null,
      stdout:path.join(attemptDirectory,'stdout.log'),stderr:path.join(attemptDirectory,'stderr.log')});
  }
  const retained={name:stage,status:'COMPLETE',exitCode:0,startedAt:result.startedAt,finishedAt:result.finishedAt,
    argv:[path.basename(executable),...args.map(arg=>path.isAbsolute(arg)?'<operation-path>':arg)],
    nodeHeapMB:buildHeap(command.nodeHeapMB),attemptId,stdoutSha256:(await inspectFile(path.join(attemptDirectory,'stdout.log'))).sha256,
    stderrSha256:(await inspectFile(path.join(attemptDirectory,'stderr.log'))).sha256};
  await progress?.({stage,status:'COMPLETE',operationId:operation.id,attemptId});
  return retained;
}
async function procIdentity(procPid) {
  const base=procPid==='self'?'/proc/self':'/proc/'+procPid;
  let stat;
  try { stat=await fs.readFile(base+'/stat','utf8'); }
  catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
  const actualPid=Number(stat.slice(0,stat.indexOf(' ')));
  const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
  let namespace=null,nspids=[],boot=null;
  try{namespace=await fs.readlink(base+'/ns/pid');}catch(error){if(!['ENOENT','EACCES','EPERM'].includes(error.code))throw error;}
  try{
    const status=await fs.readFile(base+'/status','utf8'),line=status.split('\n').find(row=>row.startsWith('NSpid:'));
    if(line)nspids=line.slice(6).trim().split(/\s+/).map(Number);
  }catch(error){if(!['ENOENT','EACCES','EPERM'].includes(error.code))throw error;}
  try{boot=(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();}catch{}
  if(!Number.isInteger(actualPid)||actualPid<=0||!/^\d+$/.test(fields[19]??''))fail('RUNTIME_PROCESS_IDENTITY_UNAVAILABLE');
  return {pid:nspids.at(-1)??actualPid,procPid:actualPid,boot,start:fields[19],namespace,nspids};
}
async function processIdentity(pid=process.pid) {
  if(process.platform!=='linux')return {pid,procPid:null,boot:null,start:null,namespace:null,nspids:[]};
  const self=await procIdentity('self');
  if(!self)fail('RUNTIME_PROCESS_IDENTITY_UNAVAILABLE');
  if(pid===process.pid)return {...self,pid:process.pid};
  let direct=await procIdentity(pid);
  if(direct&&direct.pid===pid&&direct.namespace===self.namespace)return direct;
  // /proc can be mounted from an ancestor PID namespace while Node reports a
  // container-local PID. Resolve children by both namespace and their NSpid.
  for(const item of await fs.readdir('/proc',{withFileTypes:true})){
    if(!item.isDirectory()||!/^\d+$/.test(item.name)||Number(item.name)===self.procPid)continue;
    try{
      const actual=await procIdentity(Number(item.name));
      if(actual&&actual.pid===pid&&actual.namespace===self.namespace)return actual;
    }catch(error){if(!['ENOENT','ESRCH','EACCES','EPERM'].includes(error.code))throw error;}
  }
  return {pid,procPid:null,boot:self.boot,start:null,namespace:self.namespace,nspids:[],absent:true};
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
    if(await matchesProcessIdentity(previous))
      fail('RUNTIME_BUSY',{directory:destination,owner:{pid:previous.pid,procPid:previous.procPid??null,
        boot:previous.boot??null,start:previous.start??null,namespace:previous.namespace??null}});
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
        const result = await verifyPollarRuntime({directory: destination});
        if (result.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        return result;
      }
      if ((await fs.readdir(destination)).length) fail('RUNTIME_DESTINATION_NOT_EMPTY', {directory: destination});
    }
    const staging = destination + '.runtime-stage';
    const existed = await lstatMaybe(staging);
    if (!existed) {
      await fs.mkdir(staging, {mode: 0o700});
      await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.pollar-partner.runtime-operation.v1', kind, id: plan.manifest.id}));
    } else {
      await directory(staging);
      const markerFile = path.join(staging, '.operation.json');
      if (await lstatMaybe(markerFile)) {
        const marker = (await readJSON(markerFile)).value;
        if (marker.schema !== 'stellar-forge.pollar-partner.runtime-operation.v1' || marker.kind !== kind || marker.id !== plan.manifest.id)
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else if (await lstatMaybe(path.join(staging, 'manifest.json'))) {
        const retained = await loadManifest(staging);
        if (retained.manifest.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else {
        const leftovers = await fs.readdir(staging);
        if (leftovers.some(name => !/^\.operation\.json\.partial-[0-9a-f-]{36}$/.test(name)))
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        for (const name of leftovers) await fs.rm(path.join(staging, name), {force: true});
        await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.pollar-partner.runtime-operation.v1', kind, id: plan.manifest.id}));
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

function runtimeLogicalFile(manifest,value){
 let current=relative(value);const map=new Map(manifest.links.map(item=>[item.path,item])),seen=new Set();
 for(let step=0;step<=manifest.links.length;step++){
  const parts=current.split('/');let changed=false;
  for(let i=1;i<=parts.length;i++){
   const prefix=parts.slice(0,i).join('/'),link=map.get(prefix);if(!link)continue;
   if(seen.has(prefix))fail('RUNTIME_LINK_CYCLE');seen.add(prefix);
   current=linkTarget(link)+(i<parts.length?'/'+parts.slice(i).join('/'):'');changed=true;break;
  }
  if(!changed){if(!manifest.files.some(item=>item.path===current))fail('RUNTIME_FILE_REQUIRED',{path:value});return current;}
 }fail('RUNTIME_LINK_CYCLE');
}
async function writeSelectedFile(root,rel,bytes,fileMode=0o644){
 const existing=await lstatMaybe(join(root,rel));
 if(existing){const actual=await inspectFile(join(root,rel));if(actual.sha256!==sha256(bytes)||actual.bytes!==bytes.length)fail('RUNTIME_SOURCE_CHANGED',{path:rel});return;}
 await atomicBytes(root,rel,bytes,fileMode);
}
async function verifyOriginalSource(root,checked){
 for(const file of checked.value.files){
  await safeParents(root,file.path);const actual=await inspectFile(join(root,file.path));
  if(actual.bytes!==file.bytes||actual.sha256!==file.sha256)fail('RUNTIME_BUILD_SOURCE_CHANGED',{path:file.path});
 }
}
async function prepareBuildSource(root,checked,selectedSource){
 await fs.mkdir(root,{recursive:true,mode:0o700});await directory(root);
 for(const file of checked.value.files){
  let bytes=Buffer.from(file.content,'utf8');
  if(selectedSource){
   await safeParents(selectedSource,file.path);bytes=await readFile(join(selectedSource,file.path));
   if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)fail('RUNTIME_BUILD_SOURCE_CHANGED',{path:file.path});
  }
  await writeSelectedFile(root,file.path,bytes,parseInt(file.mode,8)&0o777);
 }
 await verifyOriginalSource(root,checked);
}
async function compiledFiles(root,{browser=true}={}){
 const result=[];
 async function walk(rel){
  await directory(join(root,rel));
  for(const item of (await fs.readdir(join(root,rel),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   const name=rel+'/'+item.name;
   if(item.isDirectory())await walk(name);
   else if(item.isFile()){const file=await inspectFile(join(root,name));result.push({path:name,bytes:file.bytes,sha256:file.sha256,mode:file.mode});}
   else fail('RUNTIME_BUILD_OUTPUT_INVALID',{path:name});
  }
 }
 for(const name of ['core','react','accesly-adapter']){
  const base='packages/'+name+'/dist';await walk(base);
  for(const entry of ['index.mjs','index.js','index.d.ts'])
   if(!result.some(item=>item.path===base+'/'+entry))fail('RUNTIME_BUILD_OUTPUT_REQUIRED',{path:base+'/'+entry});
 }
 if(browser){await walk('.pollar-browser');for(const name of ['pollar-runtime.mjs','pollar-runtime.css','metafile.json'])
  if(!result.some(item=>item.path==='.pollar-browser/'+name))fail('RUNTIME_BROWSER_ASSET_INVALID',{asset:name});}
 result.sort((a,b)=>a.path.localeCompare(b.path,'en'));return result;
}
async function verifyCompiled(root,selection){
 if(!object(selection)||!Array.isArray(selection.files)||selection.sha256!==sha256(Buffer.from(canonical(selection.files))))fail('RUNTIME_COMPILED_SOURCE_INVALID');
 for(const file of selection.files){await safeParents(root,file.path);const info=await inspectFile(join(root,file.path));
  if(info.sha256!==file.sha256||info.bytes!==file.bytes||info.mode!==file.mode)fail('RUNTIME_COMPILED_SOURCE_CHANGED',{path:file.path});}
}
const BROWSER_ENTRY=[
 'export * as core from "@pollar/core";',
 'export * as pollarReact from "@pollar/react";',
 'export * as acceslyAdapter from "@pollar/accesly-adapter";',
 'export * as React from "react";',
 'export {createRoot} from "react-dom/client";',
 'import "@pollar/react/styles.css";'
].join('\n')+'\n';
const BROWSER_BUILD=[
 'import fs from "node:fs/promises";import path from "node:path";import {createRequire} from "node:module";import {pathToFileURL} from "node:url";',
 'const root=path.resolve(process.argv[2]),require=createRequire(path.join(root,"package.json"));',
 'const esbuild=await import(pathToFileURL(require.resolve("esbuild")).href);',
 'const entry=path.join(root,".pollar-browser-entry.mjs"),outdir=path.join(root,".pollar-browser");',
 'const result=await esbuild.build({absWorkingDir:root,entryPoints:{"pollar-runtime":entry},outdir,bundle:true,platform:"browser",format:"esm",splitting:true,',
 'chunkNames:"chunks/[name]-[hash]",assetNames:"assets/[name]-[hash]",outExtension:{".js":".mjs"},metafile:true,sourcemap:"linked",target:["es2022"],',
 'legalComments:"linked",define:{"process.env.NODE_ENV":JSON.stringify("production")},write:true,logLevel:"info"});',
 'await fs.writeFile(path.join(outdir,"metafile.json"),JSON.stringify(result.metafile,null,2)+"\\n");'
].join('\n')+'\n';
export async function buildPollarRuntime({installationDirectory,directory:selectedDirectory,sourceDirectory,npmExecutable='npm',
 nodeHeapMB=512,signal,progress}={}){
 const installed=absolute(installationDirectory,'installationDirectory'),destination=absolute(selectedDirectory,'directory');
 if(within(installed,destination)||within(destination,installed))fail('RUNTIME_SOURCE_DESTINATION_OVERLAP');
 const checked=capsuleOriginal((await readJSON(path.join(HERE,'source','pollar-sdk-source.json'))).value);
 const selectedSource=sourceDirectory===undefined?null:absolute(sourceDirectory,'sourceDirectory');
 const buildDirectory=installed+'.pollar-build';await fs.mkdir(buildDirectory,{recursive:true,mode:0o700});await directory(buildDirectory);
 const release=await acquire(buildDirectory);
 try{
  const tool=await selectPollarNpm(npmExecutable),node=await fs.realpath(process.execPath);
  const tools={node,npm:tool},toolRoot=await prepareBuildToolBindings(buildDirectory,tools);
  const versions={node:process.versions.node,npm:await buildToolVersion(tool)};
  if(Number(versions.node.split('.')[0])<22||Number(versions.node.split('.')[0])===22&&Number(versions.node.split('.')[1])<16)fail('RUNTIME_NODE_VERSION_REQUIRED',{minimum:'22.16.0',actual:versions.node});
  let operation;
  const opFile=path.join(buildDirectory,'operation.json');
  if(await lstatMaybe(opFile)){
   operation=(await readJSON(opFile)).value;
   if(operation.schema!==BUILD_SCHEMA||operation.installationDirectory!==installed||operation.commit!==SOURCE_COMMIT||
     operation.sourceInventorySha256!==SOURCE_INVENTORY_SHA256||canonical(operation.tools)!==canonical(tools))
     fail('RUNTIME_BUILD_OPERATION_CHANGED');
   operation.nodeHeapMB=buildHeap(nodeHeapMB);
  }else{
   operation={schema:BUILD_SCHEMA,id:randomUUID(),commit:SOURCE_COMMIT,sourceInventorySha256:SOURCE_INVENTORY_SHA256,
    installationDirectory:installed,buildDirectory,tools,toolDirectories:[toolRoot,path.dirname(node),path.dirname(tool)],
    toolVersions:versions,nodeHeapMB:buildHeap(nodeHeapMB),stages:{},createdAt:new Date().toISOString()};
   await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
  }
  await prepareBuildSource(installed,checked,selectedSource);
  const receiptFile=path.join(installed,'.pollar-build.json');
  if(await lstatMaybe(receiptFile)){
   const receipt=(await readJSON(receiptFile)).value;
   if(receipt.operationId!==operation.id||receipt.sourceInventorySha256!==SOURCE_INVENTORY_SHA256)fail('RUNTIME_BUILD_RECEIPT_CHANGED');
   await verifyCompiled(installed,receipt.compiled);
   const retained=await retainPollarRuntime({directory:destination,installationDirectory:installed});
   return {...retained,build:{operationId:operation.id,recovered:true,stages:receipt.stages}};
  }
  operation.stages['source-install']=await executeBuildStage(operation,'source-install',tool,
   ['ci','--workspace=@pollar/core','--workspace=@pollar/react','--workspace=@pollar/accesly-adapter','--include-workspace-root','--no-audit','--fund=false'],
   installed,{signal,progress});await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
  for(const [label,name]of [['core','@pollar/core'],['react','@pollar/react'],['accesly','@pollar/accesly-adapter']]){
   abortBuild(signal);await verifyOriginalSource(installed,checked);
   operation.stages['build-'+label]=await executeBuildStage(operation,'build-'+label,tool,['run','build','--workspace='+name],installed,{signal,progress});
   await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
  }
  await verifyOriginalSource(installed,checked);
  await writeSelectedFile(installed,'.pollar-browser-entry.mjs',Buffer.from(BROWSER_ENTRY),0o644);
  await writeSelectedFile(buildDirectory,'browser-build.mjs',Buffer.from(BROWSER_BUILD),0o644);
  operation.stages['browser-bundle']=await executeBuildStage(operation,'browser-bundle',node,[path.join(buildDirectory,'browser-build.mjs'),installed],installed,{signal,progress});
  const compiled=await compiledFiles(installed),at=new Date().toISOString();
  const receipt={schema:BUILD_RECEIPT_SCHEMA,operationId:operation.id,commit:SOURCE_COMMIT,
   sourceInventorySha256:SOURCE_INVENTORY_SHA256,toolVersions:operation.toolVersions,nodeHeapMB:operation.nodeHeapMB,
   stages:operation.stages,compiled:{files:compiled,sha256:sha256(Buffer.from(canonical(compiled)))},completedAt:at};
  await atomicBytes(installed,'.pollar-build.json',jsonBytes(receipt));
  operation.completedAt=at;await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
  const retained=await retainPollarRuntime({directory:destination,installationDirectory:installed});
  return {...retained,build:{operationId:operation.id,recovered:false,stages:receipt.stages}};
 }finally{await release();}
}

async function selectPollarNpm(requested){
 const candidates=[requested];
 if(requested==='npm'){
  if(typeof process.env.npm_execpath==='string'&&path.isAbsolute(process.env.npm_execpath))candidates.push(process.env.npm_execpath);
  candidates.push(path.resolve(path.dirname(process.execPath),'..','lib','node_modules','npm','bin','npm-cli.js'));
 }
 let last;
 for(const candidate of [...new Set(candidates)])try{
  const executable=await actualExecutable(candidate,'npm');await buildToolVersion(executable);return executable;
 }catch(error){if(!['RUNTIME_BUILD_TOOL_REQUIRED','RUNTIME_BUILD_TOOL_UNAVAILABLE'].includes(error.code))throw error;last=error;}
 throw last;
}
export async function retainPollarRuntime({directory:selectedDirectory,installationDirectory=HERE}={}){
 const destination=absolute(selectedDirectory,'directory'),installed=absolute(installationDirectory,'installationDirectory');
 if(await lstatMaybe(path.join(destination,'manifest.json')))return verifyPollarRuntime({directory:destination});
 return materialize(destination,await planRuntime(installed),'retain');
}
export async function verifyPollarRuntime({directory:selectedDirectory,expectedManifestSha256}={}){
 const root=absolute(selectedDirectory,'directory'),loaded=await loadManifest(root,expectedManifestSha256);
 await verifyFiles(root,loaded.manifest);return descriptor(root,loaded.manifest,loaded.manifestSha256);
}
export async function restorePollarRuntime({sourceDirectory,destination:selectedDestination,expectedManifestSha256}={}){
 const source=absolute(sourceDirectory,'sourceDirectory'),destination=absolute(selectedDestination,'destination');
 if(source===destination)return verifyPollarRuntime({directory:source,expectedManifestSha256});
 if(within(source,destination)||within(destination,source))fail('RUNTIME_SOURCE_DESTINATION_OVERLAP');
 const loaded=await loadManifest(source,expectedManifestSha256);await verifyFiles(source,loaded.manifest,{layout:false});
 const result=await materialize(destination,{manifest:loaded.manifest,sources:new Map(loaded.manifest.files.map(file=>[file.path,{filename:join(source,file.path)}]))},'restore');
 if(result.manifestSha256!==loaded.manifestSha256)fail('RUNTIME_MANIFEST_HASH_MISMATCH');return result;
}
export async function resolvePollarRuntime({installationDirectory,runtimeDirectory,expectedManifestSha256}={}){
 if(runtimeDirectory){
  const root=absolute(runtimeDirectory,'runtimeDirectory');
  if(await lstatMaybe(path.join(root,'manifest.json'))){
   const loaded=await loadManifest(root,expectedManifestSha256);await verifyFiles(root,loaded.manifest,{layout:false});
   try{return await verifyPollarRuntime({directory:root,expectedManifestSha256});}
   catch(error){if(!['RUNTIME_LINK_MISMATCH','RUNTIME_DIRECTORY_MODE_MISMATCH','RUNTIME_FILE_MODE_MISMATCH','RUNTIME_DIRECTORY_REQUIRED'].includes(error.code))throw error;
    return restorePollarRuntime({sourceDirectory:root,destination:root+'.installed-'+loaded.manifest.id,expectedManifestSha256:loaded.manifestSha256});}
  }
  const retained=await retainPollarRuntime({directory:root,installationDirectory:installationDirectory??HERE});
  if(expectedManifestSha256&&retained.manifestSha256!==hash(expectedManifestSha256))fail('RUNTIME_MANIFEST_HASH_MISMATCH');return retained;
 }
 const installed=absolute(installationDirectory??HERE,'installationDirectory'),plan=await planRuntime(installed);
 return materialize(installed+'.pollar-runtimes/'+plan.manifest.id,plan,'retain');
}
export function publicPollarRuntime(runtime){return Object.freeze({id:hash(runtime.id,'runtimeId'),manifestSha256:hash(runtime.manifestSha256,'manifestSha256'),versions:{...runtime.manifest.versions}});}
export async function readPollarRuntimeManifest({directory:selectedDirectory,expectedManifestSha256}={}){
 const root=absolute(selectedDirectory,'directory');return loadManifest(root,expectedManifestSha256);
}
export async function bindPollarRuntime({directory:selectedDirectory,applicationDirectory,expectedManifestSha256}={}){
 const runtime=await verifyPollarRuntime({directory:selectedDirectory,expectedManifestSha256});
 const application=absolute(applicationDirectory,'applicationDirectory');await directory(application);
 const appRoot=await fs.realpath(application),runtimeRoot=await fs.realpath(runtime.directory);
 if(within(appRoot,runtimeRoot)||within(runtimeRoot,appRoot))fail('RUNTIME_APPLICATION_OVERLAP');
 const bindings=[];
 for(const[name,retained]of Object.entries(runtime.packageBindings)){
  const rel='node_modules/'+name;await safeParents(appRoot,rel,{create:true});
  const target=await fs.realpath(retained),destination=join(appRoot,rel),existing=await lstatMaybe(destination);
  if(!within(runtimeRoot,target))fail('RUNTIME_PACKAGE_BINDING_ESCAPE');
  if(existing&&(!existing.isSymbolicLink()||await fs.realpath(destination)!==target))fail('RUNTIME_APPLICATION_BINDING_CONFLICT',{package:name});
  bindings.push({name,path:destination,target,relativeTarget:path.relative(path.dirname(destination),target)});
 }
 for(const binding of bindings){
  try{await fs.symlink(binding.relativeTarget,binding.path,'dir');}
  catch(error){if(error.code!=='EEXIST'||await fs.realpath(binding.path)!==binding.target)throw error;}
  await syncDirectory(path.dirname(binding.path));
 }
 return {schema:'stellar-forge.pollar-partner.runtime-binding.v1',...publicPollarRuntime(runtime),applicationDirectory:appRoot,
  runtimeDirectory:runtime.directory,bindings,browser:runtime.browser};
}
export async function readPollarBrowserAsset({directory:selectedDirectory,expectedManifestSha256,asset,offset=0,length}={}){
 const root=absolute(selectedDirectory,'directory'),loaded=await loadManifest(root,expectedManifestSha256);
 relative(asset);const selected=loaded.manifest.browser.directory+'/'+asset;
 const file=loaded.manifest.files.find(item=>item.path===selected);
 if(!file)fail('RUNTIME_BROWSER_ASSET_NOT_FOUND',{asset});
 const info=await inspectFile(join(root,file.path));
 if(info.sha256!==file.sha256||info.bytes!==file.bytes)fail('RUNTIME_FILE_HASH_MISMATCH',{path:file.path});
 count(offset,'offset');if(length!==undefined)count(length,'length');
 if(offset>file.bytes||length!==undefined&&(length===0||length>4*1024*1024))fail('RUNTIME_RANGE_INVALID');
 const countBytes=length===undefined?file.bytes-offset:Math.min(length,file.bytes-offset);
 const handle=await fs.open(join(root,file.path),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const before=await handle.stat({bigint:true});if(fingerprint(before)!==info.fingerprint)fail('RUNTIME_SOURCE_CHANGED',{path:file.path});
  const content=Buffer.alloc(countBytes);let read=0;
  while(read<countBytes){const {bytesRead}=await handle.read(content,read,countBytes-read,offset+read);if(!bytesRead)fail('RUNTIME_SOURCE_CHANGED');read+=bytesRead;}
  if(fingerprint(await handle.stat({bigint:true}))!==info.fingerprint)fail('RUNTIME_SOURCE_CHANGED');
  const extension=path.extname(asset),contentType=({'.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.map':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.woff2':'font/woff2'})[extension]??'application/octet-stream';
  return {path:asset,bytes:file.bytes,offset,complete:offset+content.length===file.bytes,sha256:file.sha256,contentType,content};
 }finally{await handle.close();}
}
export const pollarRuntimeSelection=Object.freeze({schema:SCHEMA,commit:SOURCE_COMMIT,sourceInventorySha256:SOURCE_INVENTORY_SHA256,packages:PACKAGES,version:SDK_VERSION});
