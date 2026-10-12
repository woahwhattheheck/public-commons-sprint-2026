// MIT. Complete original Fuul SDK source build, installed dependency retention,
// immutable package graph and independent receiving lifecycle.
import {createHash, randomUUID} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.fuul-stellar-runtime.v1';
const SDK_ALIAS='@fuul/sdk-stellar';
const SDK_NATIVE='@fuul/sdk-stellar';
const SDK_VERSION='0.3.0';
const STELLAR_NATIVE='@stellar/stellar-sdk';
const STELLAR_VERSION='17.2.1';
const BUN_VERSION='1.3.12';
const TYPESCRIPT_VERSION='5.9.3';
const CAPSULE_SHA256='1d99414917744d68c2e01373c3b73d3e163200b8c767993be8a68619791c48c3';
const LOCK_SHA256='4629b81191558d99c4f9fa758be47cf0a96242b03967cbeb4c7c472b56d7f0fc';
const CONTRACTS_SHA256='1fd298521fe979ae3ed68d1a2ee1db5acb807ba589de6825bbc130f828abbafb';
const EXPORTS=['.','./contracts/fuul-factory','./contracts/fuul-manager','./contracts/fuul-project','./amounts','./transactions','./resources','./events','./adapters','./lifecycle'];
const STELLAR_EXPORTS=['.','./rpc','./contract'];
const BUFFER_BYTES=256*1024;
const SHA256=/^[a-f0-9]{64}$/;
const PACKAGE_NAME=/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const VCS=new Set(['.git','.hg','.svn']);
const FILE_HASH_CACHE=new Map();
const FILE_HASH_CACHE_LIMIT=8192;

export class FuulRuntimeError extends Error {
  constructor(code, details = {}, cause) {
    super(code, cause ? {cause} : undefined);
    this.name = 'FuulRuntimeError';
    this.code = code;
    this.details = details;
  }
  toJSON() { return {code: this.code, details: this.details}; }
}
function fail(code, details, cause) { throw new FuulRuntimeError(code, details, cause); }
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
function descriptor(directory,manifest,manifestSha256) {
  const map=entries=>Object.fromEntries(Object.entries(entries).map(([name,target])=>[name,join(directory,target)]));
  return {id:manifest.id,directory,manifest,manifestSha256,
    entrypoint:join(directory,manifest.entrypoints['.']),entrypoints:map(manifest.entrypoints),
    requireEntrypoints:map(manifest.requireEntrypoints),
    stellarEntrypoint:join(directory,manifest.stellarEntrypoints['.']),
    stellarEntrypoints:map(manifest.stellarEntrypoints),stellarRequireEntrypoints:map(manifest.stellarRequireEntrypoints),
    packageBindings:map(manifest.packageBindings),
    ...(manifest.build?{buildSourceDirectory:join(directory,manifest.build.sourceDirectory)}:{})};
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

function parseJSONC(source) {
  let clean='',quoted=false,escaped=false,line=false,block=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i],next=source[i+1];
    if(line){if(c==='\n'){line=false;clean+='\n';}else clean+=' ';continue;}
    if(block){if(c==='*'&&next==='/'){block=false;clean+='  ';i++;}else clean+=c==='\n'?'\n':' ';continue;}
    if(quoted){clean+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;clean+=c;continue;}
    if(c==='/'&&next==='/'){line=true;clean+='  ';i++;continue;}
    if(c==='/'&&next==='*'){block=true;clean+='  ';i++;continue;}
    clean+=c;
  }
  if(quoted||block)fail('RUNTIME_ORIGINAL_LOCK_INVALID');
  let result='';quoted=false;escaped=false;
  for(let i=0;i<clean.length;i++) {
    const c=clean[i];
    if(quoted){result+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;result+=c;continue;}
    if(c===','){let j=i+1;while(/\s/.test(clean[j]??''))j++;if(clean[j]===']'||clean[j]==='}'){result+=' ';continue;}}
    result+=c;
  }
  try{return JSON.parse(result);}catch(error){fail('RUNTIME_ORIGINAL_LOCK_INVALID',{},error);}
}
function normalizeBunLock(bun,sourcePackage) {
  if(!object(bun)||bun.lockfileVersion!==1||!object(bun.packages)||!object(bun.workspaces?.['']))
    fail('RUNTIME_ORIGINAL_LOCK_INVALID');
  const root=bun.workspaces[''];
  if(root.name!==SDK_NATIVE||canonical(root.dependencies)!==canonical(sourcePackage.dependencies)||
    canonical(root.devDependencies)!==canonical(sourcePackage.devDependencies))fail('RUNTIME_ORIGINAL_LOCK_CHANGED');
  const records=new Map(),paths=new Map();
  for(const[key,row]of Object.entries(bun.packages)) {
    if(!Array.isArray(row)||typeof row[0]!=='string'||!object(row[2])||typeof row[3]!=='string'||
      !row[3].startsWith('sha512-'))fail('RUNTIME_ORIGINAL_LOCK_INVALID',{package:key});
    const at=row[0].lastIndexOf('@');
    if(at<=0)fail('RUNTIME_ORIGINAL_LOCK_INVALID',{package:key});
    const name=row[0].slice(0,at),version=row[0].slice(at+1);
    if(!PACKAGE_NAME.test(name)||!version)fail('RUNTIME_ORIGINAL_LOCK_INVALID',{package:key});
    records.set(key,{name,version,metadata:row[2],integrity:row[3]});
  }
  function selectedPath(key,seen=new Set()) {
    if(paths.has(key))return paths.get(key);
    if(seen.has(key)||!records.has(key))fail('RUNTIME_ORIGINAL_LOCK_INVALID',{package:key});
    seen.add(key);
    const record=records.get(key);let result;
    if(key===record.name)result='node_modules/'+record.name;
    else {
      const suffix='/'+record.name;
      if(!key.endsWith(suffix))fail('RUNTIME_ORIGINAL_LOCK_ALIAS_UNSUPPORTED',{package:key});
      result=selectedPath(key.slice(0,-suffix.length),seen)+'/node_modules/'+record.name;
    }
    paths.set(key,result);return result;
  }
  const packages={};
  for(const[key,record]of records) {
    const metadata=record.metadata;
    packages[selectedPath(key)]={packageName:record.name,version:record.version,integrity:record.integrity,
      dependencies:metadata.dependencies??{},optionalDependencies:metadata.optionalDependencies??{},
      peerDependencies:metadata.peerDependencies??{},optionalPeers:metadata.optionalPeers??[],originalKey:key};
  }
  packages['node_modules/'+SDK_NATIVE]={packageName:SDK_NATIVE,version:SDK_VERSION,
    dependencies:sourcePackage.dependencies??{},devDependencies:sourcePackage.devDependencies??{},optionalDependencies:{}};
  if(packages['node_modules/'+STELLAR_NATIVE]?.version!==STELLAR_VERSION||
    packages['node_modules/typescript']?.version!==TYPESCRIPT_VERSION)fail('RUNTIME_ORIGINAL_LOCK_CHANGED');
  return {schema:'stellar-forge.fuul-original-bun-selection.v1',packages,bun};
}
function capsuleOriginal(value,bytes) {
  if(sha256(bytes)!==CAPSULE_SHA256||value.schema!=='stellar-forge.original-source-capsule.v1'||
    value.publisher?.repository!=='fuul-protocol/protocol-sdk-stellar'||
    value.publisher?.commit!=='ea3dc792506a206991d053ef98f888da71c2248f'||
    value.publisher?.licenseDeclared!=='ISC'||value.fileCount!==74||value.files?.length!==74)
    fail('RUNTIME_ORIGINAL_SOURCE_CHANGED');
  const seen=new Set();let total=0;
  for(const item of value.files) {
    relative(item.path);
    if(seen.has(item.path)||typeof item.content!=='string'||!['100644','100755'].includes(item.mode))
      fail('RUNTIME_ORIGINAL_SOURCE_INVALID');
    const body=Buffer.from(item.content);
    if(body.length!==item.bytes||sha256(body)!==item.sha256)fail('RUNTIME_ORIGINAL_SOURCE_CHANGED',{path:item.path});
    seen.add(item.path);total+=body.length;
  }
  if(total!==value.bytes)fail('RUNTIME_ORIGINAL_SOURCE_INVALID');
  const packageFile=value.files.find(item=>item.path==='package.json'),lockFile=value.files.find(item=>item.path==='bun.lock');
  const contractsFile=value.files.find(item=>item.path==='contracts.json');
  if(!packageFile||!lockFile||lockFile.sha256!==LOCK_SHA256||contractsFile?.sha256!==CONTRACTS_SHA256)
    fail('RUNTIME_ORIGINAL_LOCK_REQUIRED');
  let packageJSON,contracts;
  try{packageJSON=JSON.parse(packageFile.content);contracts=JSON.parse(contractsFile.content);}
  catch(error){fail('RUNTIME_ORIGINAL_LOCK_INVALID',{},error);}
  if(packageJSON.name!==SDK_NATIVE||packageJSON.version!==SDK_VERSION||packageJSON.license!=='ISC'||
    packageJSON.dependencies?.[STELLAR_NATIVE]!==STELLAR_VERSION||packageJSON.devDependencies?.typescript!==TYPESCRIPT_VERSION||
    canonical(Object.keys(packageJSON.exports).sort())!==canonical([...EXPORTS].sort())||
    contracts.stellarSdk!==STELLAR_VERSION)fail('RUNTIME_ORIGINAL_PACKAGE_CHANGED');
  for(const[name,record]of Object.entries(contracts.contracts??{})) {
    const item=value.files.find(row=>row.path==='src/contracts/'+name+'/index.ts');
    if(!item||sha256(Buffer.from(item.content.replaceAll('\r\n','\n')))!==record.bindingSha256)
      fail('RUNTIME_ORIGINAL_BINDING_CHANGED',{contract:name});
  }
  const lock=normalizeBunLock(parseJSONC(lockFile.content),packageJSON);
  return {value,bytes,lock,packageJSON,packageFile,lockFile,contracts,contractsFile};
}
async function publisherSources() {
  const original=await readJSON(path.join(HERE,'source','sdk-stellar.json'));
  const checked=capsuleOriginal(original.value,original.bytes);
  const root='publisher/fuul-stellar-sdk';
  const files=[{path:root+'/capsule.json',content:original.bytes,mode:0o644}];
  for(const item of original.value.files)
    files.push({path:root+'/source/'+item.path,content:Buffer.from(item.content),mode:item.mode==='100755'?0o755:0o644});
  const selected=name=>{const item=original.value.files.find(row=>row.path===name);
    return {path:root+'/source/'+name,bytes:item.bytes,sha256:item.sha256};};
  return {files,lock:checked.lock,checked,description:{
    capsule:{path:root+'/capsule.json',bytes:original.bytes.length,sha256:sha256(original.bytes)},
    originalPackage:selected('package.json'),originalLock:selected('bun.lock'),contracts:selected('contracts.json'),
    source:{directory:root+'/source',fileCount:74,bytes:original.value.bytes},
    repository:original.value.publisher.repository,commit:original.value.publisher.commit,
    sdk:{name:SDK_NATIVE,version:SDK_VERSION,license:'ISC'},stellar:{name:STELLAR_NATIVE,version:STELLAR_VERSION},
    originalBuild:{bun:BUN_VERSION,typescript:TYPESCRIPT_VERSION,node:checked.packageJSON.engines.node,
      referencePlatform:checked.contracts.platform,script:selected('scripts/build.mjs')}
  }};
}
function lockedDependency(lock,name,from) {
  let current=from;
  for(;;) {
    if(path.posix.basename(current)!=='node_modules') {
      const candidate=(current?current+'/':'')+'node_modules/'+name;
      if(lock.packages[candidate])return candidate;
    }
    if(!current)return null;
    const parent=path.posix.dirname(current);current=parent==='.'?'':parent;
  }
}
function lockedName(selected) { return selected.split('node_modules/').at(-1); }
function requireLockedPackage(node,lock,selected) {
  const original=lock.packages[selected];
  if(!original||node.metadata.name!==original.packageName||node.metadata.version!==original.version)
    fail('RUNTIME_ORIGINAL_DEPENDENCY_CHANGED',{package:node.metadata.name,version:node.metadata.version,
      expectedPackage:original?.packageName??lockedName(selected),expectedVersion:original?.version??null});
  if(canonical(node.metadata.dependencies??{})!==canonical(original.dependencies??{})||
    canonical(node.metadata.optionalDependencies??{})!==canonical(original.optionalDependencies??{}))
    fail('RUNTIME_ORIGINAL_DEPENDENCY_DECLARATION_CHANGED',{package:node.metadata.name,version:node.metadata.version});
}
function packageDeclarations(metadata,includeDevelopment=false) {
  const declarations=new Map();
  for(const[name,range]of Object.entries(metadata.dependencies??{}))
    declarations.set(name,{name,range,kind:'dependency',optional:false});
  for(const[name,range]of Object.entries(metadata.optionalDependencies??{}))
    declarations.set(name,{name,range,kind:'optional',optional:true});
  for(const[name,range]of Object.entries(metadata.peerDependencies??{}))
    if(!declarations.has(name))declarations.set(name,{name,range,kind:'peer',optional:metadata.peerDependenciesMeta?.[name]?.optional===true});
  if(includeDevelopment)for(const[name,range]of Object.entries(metadata.devDependencies??{}))
    if(!declarations.has(name))declarations.set(name,{name,range,kind:'development',optional:false});
  return declarations;
}
async function discover(installationDirectory,lock,build=null) {
  let first=await resolvePackage(SDK_ALIAS,installationDirectory);
  if(!first&&await lstatMaybe(path.join(installationDirectory,'package.json'))) {
    const local=await packageAt(installationDirectory);
    if(local.metadata.name===SDK_NATIVE)first=local;
  }
  if(!first)fail('FUUL_STELLAR_NOT_INSTALLED',{package:SDK_ALIAS,version:SDK_VERSION});
  if(first.metadata.name!==SDK_NATIVE||first.metadata.version!==SDK_VERSION)
    fail('FUUL_STELLAR_VERSION_MISMATCH',{expected:{name:SDK_NATIVE,version:SDK_VERSION},
      actual:{name:first.metadata.name,version:first.metadata.version}});
  const packages=[],byRoot=new Map(),byLookup=new Map(),queue=[];
  function enqueue(node){if(!node.queued){node.queued=true;queue.push(node);}}
  function add(found,requiredByFuul=false,lockPath=null,{includeDevelopment=false}={}) {
    let node=byRoot.get(found.root),changed=false;
    if(!node) {
      node={...found,id:'p'+String(packages.length).padStart(4,'0'),requiredByFuul:false,
        includeDevelopment:false,dependencies:[],installed:[],lockPaths:[],scannedInstalled:false,queued:false};
      node.path='packages/'+node.id;packages.push(node);byRoot.set(node.root,node);changed=true;
    }
    if(requiredByFuul&&!node.requiredByFuul){node.requiredByFuul=true;changed=true;}
    if(includeDevelopment&&!node.includeDevelopment){node.includeDevelopment=true;changed=true;}
    if(lockPath&&!node.lockPaths.includes(lockPath)) {
      requireLockedPackage(node,lock,lockPath);node.lockPaths.push(lockPath);changed=true;
    }
    byLookup.set(found.lookup,node);
    if(changed)enqueue(node);
    return node;
  }
  const root=add(first,true,'node_modules/'+SDK_NATIVE);
  let buildRoot=null;
  if(build) {
    const selected=await packageAt(build.sourceDirectory);
    if(selected.metadata.name!==SDK_NATIVE||selected.metadata.version!==SDK_VERSION)fail('RUNTIME_BUILD_SOURCE_CHANGED');
    buildRoot=add(selected,true,'node_modules/'+SDK_NATIVE,{includeDevelopment:true});
  }
  while(queue.length) {
    const node=queue.shift();node.queued=false;
    const declarations=packageDeclarations(node.metadata,node.includeDevelopment),edges=[];
    for(const dependency of [...declarations.values()].sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const found=await resolvePackage(dependency.name,node.root);
      if(!found) {
        edges.push({...dependency,packageId:null,present:false});
        if(!dependency.optional)fail('RUNTIME_DEPENDENCY_MISSING',{package:node.metadata.name,dependency:dependency.name,range:dependency.range});
      } else {
        const lockPaths=node.lockPaths.map(selected=>lockedDependency(lock,dependency.name,selected)).filter(Boolean);
        if(node.requiredByFuul&&!dependency.optional&&lockPaths.length===0)
          fail('RUNTIME_ORIGINAL_DEPENDENCY_MISSING',{package:node.metadata.name,dependency:dependency.name});
        const selected=add(found,node.requiredByFuul&&!dependency.optional,lockPaths[0]??null);
        for(const locked of lockPaths.slice(1))add(found,selected.requiredByFuul,locked);
        edges.push({...dependency,packageId:selected.id,present:true});
      }
    }
    node.dependencies=edges;
    if(!node.scannedInstalled) {
      node.scannedInstalled=true;
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
  }
  const stellarEdge=root.dependencies.find(item=>item.name===STELLAR_NATIVE&&item.present);
  const stellar=packages.find(item=>item.id===stellarEdge?.packageId);
  if(!stellar||stellar.metadata.name!==STELLAR_NATIVE||stellar.metadata.version!==STELLAR_VERSION)
    fail('FUUL_STELLAR_DEPENDENCY_CHANGED',{expected:STELLAR_VERSION,actual:stellar?.metadata.version??null});
  return {root,stellar,buildRoot,packages,byRoot,byLookup};
}
async function nativeEntrypoints(graph,installationDirectory) {
  const request={name:SDK_NATIVE,exports:EXPORTS,stellarName:STELLAR_NATIVE,stellarExports:STELLAR_EXPORTS,
    parent:pathToFileURL(path.join(graph.root.root,'__fuul_stellar_resolution__.mjs')).href};
  // Node resolves the original conditional exports without evaluating either
  // publisher package. Every compiled file is retained before import.
  const resolver='import {createRequire} from "node:module";const r=JSON.parse(process.argv[1]);'+
    'const require=createRequire(r.parent),out={sdk:{},sdkRequire:{},stellar:{},stellarRequire:{}};'+
    'for(const [name,exports,key] of [[r.name,r.exports,"sdk"],[r.stellarName,r.stellarExports,"stellar"]])'+
    'for(const item of exports){const spec=name+(item==="."?"":item.slice(1));'+
    'out[key][item]=await import.meta.resolve(spec,r.parent);out[key+"Require"][item]=require.resolve(spec);}'+
    'process.stdout.write(JSON.stringify(out));';
  const environment={...process.env};delete environment.NODE_OPTIONS;
  let output;
  try{output=await promisify(execFile)(process.execPath,
    ['--experimental-import-meta-resolve','--input-type=module','--eval',resolver,JSON.stringify(request)],
    {cwd:installationDirectory,env:environment,timeout:30000,maxBuffer:1024*1024});}
  catch(error){fail('RUNTIME_FUUL_EXPORT_RESOLUTION_FAILED',{package:SDK_NATIVE,version:SDK_VERSION},error);}
  let entries;try{entries=JSON.parse(output.stdout);}catch(error){fail('RUNTIME_FUUL_EXPORT_RESOLUTION_FAILED',{},error);}
  const result={sdk:{},sdkRequire:{},stellar:{},stellarRequire:{}};
  for(const[key,names,node,url]of [['sdk',EXPORTS,graph.root,true],['sdkRequire',EXPORTS,graph.root,false],
    ['stellar',STELLAR_EXPORTS,graph.stellar,true],['stellarRequire',STELLAR_EXPORTS,graph.stellar,false]]) {
    for(const name of names) {
      let filename;
      if(url) {
        let selected;try{selected=new URL(entries[key]?.[name]);}catch{fail('RUNTIME_FUUL_EXPORT_UNAVAILABLE',{kind:key,export:name});}
        if(selected.protocol!=='file:'||selected.search||selected.hash)fail('RUNTIME_FUUL_EXPORT_UNAVAILABLE',{kind:key,export:name});
        filename=fileURLToPath(selected);
      }else filename=entries[key]?.[name];
      if(typeof filename!=='string'||!path.isAbsolute(filename))fail('RUNTIME_FUUL_EXPORT_UNAVAILABLE',{kind:key,export:name});
      const selected=await fs.realpath(filename);
      if(!within(node.root,selected))fail('RUNTIME_FUUL_EXPORT_INVALID',{kind:key,export:name});
      result[key][name]=selected;
    }
  }
  return result;
}

async function planRuntime(installationDirectory) {
  const publisher = await publisherSources();
  const build = await readBuildSelection(installationDirectory,publisher.checked);
  const graph = await discover(installationDirectory,publisher.lock,build);
  if(graph.buildRoot)graph.buildRoot.path='publisher/fuul-stellar-sdk/source';
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
      ...(graph.physicalPackages??graph.packages).map(node => ({root: node.root, path: node.path})),
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
  addLink('node_modules/' + STELLAR_NATIVE,graph.stellar.path);
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
  let buildDescriptor=null;
  if(build) {
    const retainedFiles=[];
    for(const item of build.files) {
      await addFile(item.filename,item.path);
      retainedFiles.push({...files.get(item.path)});
    }
    const receiptPath='build/receipt.json',receiptBytes=jsonBytes({
      ...build.receipt,sourcePackageId:graph.buildRoot.id,sourceDirectory:graph.buildRoot.path
    });
    parents(receiptPath);
    const receipt={path:receiptPath,bytes:receiptBytes.length,sha256:sha256(receiptBytes),mode:0o600};
    files.set(receiptPath,receipt);sources.set(receiptPath,{content:receiptBytes});
    buildDescriptor={schema:'stellar-forge.fuul-stellar-build.v1',sourcePackageId:graph.buildRoot.id,
      sourceDirectory:graph.buildRoot.path,sourceCapsuleSha256:CAPSULE_SHA256,
      toolchain:build.receipt.toolchain,receipt,files:retainedFiles};
  }

  // Merge only package nodes with identical complete original file/layout bytes
  // and equivalent dependency resolution. Separate source roots remain recorded
  // when any payload, native mode, installed child or selected dependency differs.
  const physicalPackages=[...graph.packages],packagePrefixes=[...physicalPackages].sort((a,b)=>b.path.length-a.path.length);
  const ownership=rel=>packagePrefixes.find(node=>rel===node.path||rel.startsWith(node.path+'/'))??null;
  const ownedFiles=new Map(),ownedDirectories=new Map(),ownedLinks=new Map();
  for(const node of physicalPackages){ownedFiles.set(node.id,[]);ownedDirectories.set(node.id,[]);ownedLinks.set(node.id,[]);}
  for(const [entries,map]of [[files,ownedFiles],[directories,ownedDirectories],[links,ownedLinks]])
    for(const item of entries.values()){const owner=ownership(item.path);if(owner)map.get(owner.id).push(item);}
  const ownRelative=(node,rel)=>rel===node.path?'':rel.slice(node.path.length+1);
  const ownRows=node=>({
    name:node.metadata.name,version:node.metadata.version,packageJsonSha256:sha256(node.packageBytes),
    includeDevelopment:node.includeDevelopment,
    files:ownedFiles.get(node.id).map(item=>({
      path:ownRelative(node,item.path),bytes:item.bytes,sha256:item.sha256,mode:item.mode
    })).sort((a,b)=>a.path.localeCompare(b.path,'en')),
    directories:ownedDirectories.get(node.id).map(item=>({
      path:ownRelative(node,item.path),mode:item.mode
    })).sort((a,b)=>a.path.localeCompare(b.path,'en')),
    linkPaths:ownedLinks.get(node.id)
      .map(item=>ownRelative(node,item.path)).sort()
  });
  const baseKeys=new Map(physicalPackages.map(node=>[node.id,canonical(ownRows(node))]));
  function partition(keys) {
    const byKey=new Map(),result=new Map();
    for(const node of physicalPackages) {
      const key=keys.get(node.id);if(!byKey.has(key))byKey.set(key,byKey.size);
      result.set(node.id,byKey.get(key));
    }
    return {groups:result,count:byKey.size};
  }
  let classes=partition(baseKeys);
  for(let round=0;round<=physicalPackages.length;round++) {
    const keys=new Map();
    for(const node of physicalPackages) {
      const ownLinks=ownedLinks.get(node.id).map(item=>{
        const target=linkTarget(item),owner=ownership(target);
        return {path:ownRelative(node,item.path),target:owner?
          {package:classes.groups.get(owner.id),path:ownRelative(owner,target)}:{path:target}};
      }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
      const dependencies=node.dependencies.map(item=>({...item,
        packageId:item.packageId===null?null:classes.groups.get(item.packageId)}));
      const installed=node.installed.map(item=>({...item,packageId:classes.groups.get(item.packageId)}));
      keys.set(node.id,canonical({previous:classes.groups.get(node.id),links:ownLinks,dependencies,installed}));
    }
    const next=partition(keys),stable=next.count===classes.count;classes=next;if(stable)break;
  }
  const selectedByClass=new Map();
  for(const node of physicalPackages)if(!selectedByClass.has(classes.groups.get(node.id)))
    selectedByClass.set(classes.groups.get(node.id),node);
  const representative=node=>selectedByClass.get(classes.groups.get(node.id));
  if(selectedByClass.size<physicalPackages.length) {
    const byId=new Map(physicalPackages.map(node=>[node.id,node]));
    const rewrite=rel=>{const node=ownership(rel);return node?
      representative(node).path+(rel===node.path?'':'/'+ownRelative(node,rel)):rel;};
    const newFiles=new Map(),newDirectories=new Map(),newLinks=new Map(),newSources=new Map();
    for(const item of files.values()) {
      const rel=rewrite(item.path),old=newFiles.get(rel);
      if(old&&(old.sha256!==item.sha256||old.bytes!==item.bytes||old.mode!==item.mode))
        fail('RUNTIME_PACKAGE_SHARING_CONFLICT',{path:rel});
      if(!old){newFiles.set(rel,{...item,path:rel});newSources.set(rel,sources.get(item.path));}
    }
    for(const item of directories.values()) {
      const rel=rewrite(item.path),old=newDirectories.get(rel);
      if(old&&old.mode!==item.mode)fail('RUNTIME_PACKAGE_SHARING_CONFLICT',{path:rel});
      newDirectories.set(rel,{...item,path:rel});
    }
    for(const item of links.values()) {
      const rel=rewrite(item.path),target=path.posix.relative(path.posix.dirname(rel),rewrite(linkTarget(item)));
      const old=newLinks.get(rel);
      if(old&&old.target!==target)fail('RUNTIME_PACKAGE_SHARING_CONFLICT',{path:rel});
      const originalTargets=[...new Set([...(old?.originalTargets??[]),...(item.originalTargets??[]),
        old?.originalTarget,item.originalTarget].filter(value=>typeof value==='string'))].sort();
      newLinks.set(rel,{...(old??item),path:rel,target,...(originalTargets.length?{originalTargets}:{})});
    }
    const replaceMap=(target,values)=>{target.clear();for(const[key,value]of values)target.set(key,value);};
    replaceMap(files,newFiles);replaceMap(directories,newDirectories);replaceMap(links,newLinks);replaceMap(sources,newSources);
    const selected=[...selectedByClass.values()];
    for(const node of selected) {
      const originals=physicalPackages.filter(item=>representative(item)===node);
      node.requiredByFuul=originals.some(item=>item.requiredByFuul);
      node.lockPaths=[...new Set(originals.flatMap(item=>item.lockPaths))];
      node.dependencies=node.dependencies.map(item=>({...item,
        packageId:item.packageId===null?null:representative(byId.get(item.packageId)).id}));
      node.installed=node.installed.map(item=>({...item,packageId:representative(byId.get(item.packageId)).id}));
    }
    graph.root=representative(graph.root);graph.stellar=representative(graph.stellar);
    if(graph.buildRoot)graph.buildRoot=representative(graph.buildRoot);
    for(const node of physicalPackages)node.path=representative(node).path;
    graph.packages=selected;graph.physicalPackages=physicalPackages;
  }

  const nativeEntries=await nativeEntrypoints(graph,installationDirectory);
  function mappedEntrypoints(selected,names) {
    const result={};
    for(const name of names) {
      const mapped=mapPhysical(selected[name]);
      if(!mapped||!files.has(mapped)||!/\.(?:mjs|cjs|js)$/.test(mapped))
        fail('RUNTIME_FUUL_EXPORT_UNAVAILABLE',{export:name});
      result[name]=mapped;
    }
    return result;
  }
  const entrypoints=mappedEntrypoints(nativeEntries.sdk,EXPORTS);
  const requireEntrypoints=mappedEntrypoints(nativeEntries.sdkRequire,EXPORTS);
  const stellarEntrypoints=mappedEntrypoints(nativeEntries.stellar,STELLAR_EXPORTS);
  const stellarRequireEntrypoints=mappedEntrypoints(nativeEntries.stellarRequire,STELLAR_EXPORTS);
  for (const node of graph.packages) {
    const captured = files.get(node.path + '/package.json');
    if (!captured || captured.sha256 !== sha256(node.packageBytes))
      fail('RUNTIME_SOURCE_CHANGED', {package: node.metadata.name, member: 'package.json'});
  }
  for (const rel of files.keys()) if (directories.has(rel) || links.has(rel)) fail('RUNTIME_PATH_CONFLICT', {path: rel});
  for (const rel of directories.keys()) if (links.has(rel)) fail('RUNTIME_PATH_CONFLICT', {path: rel});
  const packageBindings = {[SDK_ALIAS]: graph.root.path,[STELLAR_NATIVE]:graph.stellar.path};
  if (links.has('node_modules/' + SDK_NATIVE)) packageBindings[SDK_NATIVE] = graph.root.path;
  const sortedFiles = [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {
    schema: SCHEMA,
    sdk: {
      requestedName: SDK_ALIAS, packageName: graph.root.metadata.name, version: SDK_VERSION,
      packageId: graph.root.id,
      packageJsonSha256: sha256(graph.root.packageBytes)
    },
    stellar:{packageName:STELLAR_NATIVE,version:STELLAR_VERSION,packageId:graph.stellar.id,
      packageJsonSha256:sha256(graph.stellar.packageBytes)},
    build:buildDescriptor,
    runtime: {
      nodeVersion: process.version, platform: process.platform, architecture: process.arch,
      modulesAbi: process.versions.modules, hasNativeAddons: sortedFiles.some(item => item.path.endsWith('.node'))
    },
    entrypoints,requireEntrypoints,stellarEntrypoints,stellarRequireEntrypoints,
    packageBindings,
    packages: graph.packages.map(node => ({
      id: node.id, path: node.path, name: node.metadata.name, version: node.metadata.version,
      packageJsonSha256: sha256(node.packageBytes), requiredByFuul:node.requiredByFuul,
      includeDevelopment:node.includeDevelopment,lockPaths:node.lockPaths,
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
  if(!object(manifest)||manifest.schema!==SCHEMA||!Array.isArray(manifest.files)||
    !Array.isArray(manifest.directories)||!Array.isArray(manifest.links)||!Array.isArray(manifest.packages)||
    manifest.sdk?.packageName!==SDK_NATIVE||manifest.sdk?.version!==SDK_VERSION||
    manifest.stellar?.packageName!==STELLAR_NATIVE||manifest.stellar?.version!==STELLAR_VERSION)
    fail('RUNTIME_MANIFEST_INVALID');
  hash(manifest.id,'id');
  if(identity(manifest)!==manifest.id)fail('RUNTIME_ID_MISMATCH');
  const paths=new Map();
  for(const[kind,entries]of [['file',manifest.files],['directory',manifest.directories],['link',manifest.links]]) {
    for(const item of entries) {
      if(!object(item))fail('RUNTIME_MANIFEST_INVALID',{kind});
      relative(item.path);
      if(paths.has(item.path)||item.path==='manifest.json'||item.path==='.operation.json')fail('RUNTIME_PATH_CONFLICT',{path:item.path});
      paths.set(item.path,kind);
      if(kind!=='link')mode(item.mode);
      if(kind==='file'){count(item.bytes,item.path);hash(item.sha256,item.path);}
      if(kind==='link')linkTarget(item);
    }
  }
  for(const rel of paths.keys()) {
    let parent=path.posix.dirname(rel);
    while(parent!=='.'){if(paths.get(parent)!=='directory')fail('RUNTIME_PARENT_INVALID',{path:rel,parent});parent=path.posix.dirname(parent);}
  }
  if(manifest.fileCount!==manifest.files.length||manifest.bytes!==manifest.files.reduce((sum,item)=>sum+item.bytes,0))
    fail('RUNTIME_MANIFEST_TOTAL_MISMATCH');
  count(manifest.bytes,'bytes');
  const linkMap=new Map(manifest.links.map(item=>[item.path,item]));
  function resolveLogical(rel) {
    const seen=new Set();
    for(let step=0;step<=manifest.links.length;step++) {
      const parts=rel.split('/');let changed=false;
      for(let i=1;i<=parts.length;i++) {
        const prefix=parts.slice(0,i).join('/');
        if(!linkMap.has(prefix))continue;
        if(seen.has(prefix))fail('RUNTIME_LINK_CYCLE',{path:prefix});seen.add(prefix);
        const tail=parts.slice(i).join('/');
        rel=linkTarget(linkMap.get(prefix))+(tail?'/'+tail:'');changed=true;break;
      }
      if(!changed){if(!paths.has(rel))fail('RUNTIME_LINK_TARGET_MISSING',{path:rel});return rel;}
    }
    fail('RUNTIME_LINK_CYCLE');
  }
  for(const link of manifest.links)resolveLogical(link.path);
  for(const[key,names]of [['entrypoints',EXPORTS],['requireEntrypoints',EXPORTS],
    ['stellarEntrypoints',STELLAR_EXPORTS],['stellarRequireEntrypoints',STELLAR_EXPORTS]]) {
    if(!object(manifest[key])||canonical(Object.keys(manifest[key]).sort())!==canonical([...names].sort()))
      fail('RUNTIME_ENTRYPOINTS_INVALID',{kind:key});
    for(const name of names)if(paths.get(resolveLogical(relative(manifest[key][name])))!=='file')
      fail('RUNTIME_ENTRYPOINTS_INVALID',{kind:key,export:name});
  }
  const packages=new Map();
  for(const item of manifest.packages) {
    if(!object(item))fail('RUNTIME_PACKAGE_GRAPH_INVALID');
    const allowedPath=item.id===manifest.build?.sourcePackageId?'publisher/fuul-stellar-sdk/source':'packages/'+item.id;
    if(!object(item)||!/^p[0-9]{4,}$/.test(item.id)||packages.has(item.id)||item.path!==allowedPath||
      paths.get(item.path+'/package.json')!=='file'||!Array.isArray(item.dependencies)||!Array.isArray(item.installed)||
      typeof item.requiredByFuul!=='boolean'||typeof item.includeDevelopment!=='boolean')
      fail('RUNTIME_PACKAGE_GRAPH_INVALID');
    packages.set(item.id,item);
  }
  const sdk=packages.get(manifest.sdk.packageId),stellar=packages.get(manifest.stellar.packageId);
  if(!sdk||!stellar||sdk.name!==SDK_NATIVE||sdk.version!==SDK_VERSION||
    stellar.name!==STELLAR_NATIVE||stellar.version!==STELLAR_VERSION)fail('RUNTIME_PACKAGE_GRAPH_INVALID');
  const expectedBindings={[SDK_ALIAS]:sdk.path,[STELLAR_NATIVE]:stellar.path};
  if(!object(manifest.packageBindings)||canonical(manifest.packageBindings)!==canonical(expectedBindings))
    fail('RUNTIME_PACKAGE_BINDINGS_INVALID');
  for(const[name,target]of Object.entries(expectedBindings))
    if(resolveLogical('node_modules/'+name)!==target)fail('RUNTIME_PACKAGE_BINDINGS_INVALID',{packageName:name});
  for(const item of manifest.packages) {
    for(const edge of item.dependencies) {
      if(!object(edge)||!PACKAGE_NAME.test(edge.name)||typeof edge.present!=='boolean'||
        (edge.present?!packages.has(edge.packageId):edge.packageId!==null||edge.optional!==true))
        fail('RUNTIME_PACKAGE_GRAPH_INVALID',{package:item.id});
      if(edge.present&&resolveLogical(item.path+'/node_modules/'+edge.name)!==packages.get(edge.packageId).path)
        fail('RUNTIME_RESOLUTION_MISMATCH',{package:item.id,dependency:edge.name});
    }
    for(const edge of item.installed)
      if(!packages.has(edge.packageId)||resolveLogical(item.path+'/'+relative(edge.path))!==packages.get(edge.packageId).path)
        fail('RUNTIME_RESOLUTION_MISMATCH',{package:item.id});
  }
  if(manifest.publisher?.capsule?.sha256!==CAPSULE_SHA256)fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
  const pinned=[manifest.publisher?.capsule,manifest.publisher?.originalPackage,manifest.publisher?.originalLock,
    manifest.publisher?.contracts,manifest.publisher?.originalBuild?.script];
  if(manifest.build!==null) {
    const build=manifest.build,source=packages.get(build?.sourcePackageId);
    if(!object(build)||build.schema!=='stellar-forge.fuul-stellar-build.v1'||build.sourceCapsuleSha256!==CAPSULE_SHA256||
      !source||source.path!==build.sourceDirectory||source.includeDevelopment!==true||
      source.name!==SDK_NATIVE||source.version!==SDK_VERSION||!Array.isArray(build.files)||
      build.toolchain?.bun!==BUN_VERSION||build.toolchain?.typescript!==TYPESCRIPT_VERSION)
      fail('RUNTIME_BUILD_SOURCE_CHANGED');
    pinned.push(build.receipt,...build.files);
  }
  for(const item of pinned) {
    const original=manifest.files.find(file=>file.path===item?.path);
    if(!original||original.sha256!==item.sha256||original.bytes!==item.bytes)fail('RUNTIME_PUBLISHER_SOURCE_MISMATCH');
  }
  if(manifest.runtime?.hasNativeAddons!==manifest.files.some(item=>item.path.endsWith('.node')))fail('RUNTIME_NATIVE_ABI_METADATA_MISMATCH');
  if(manifest.runtime?.hasNativeAddons&&(manifest.runtime.platform!==process.platform||
    manifest.runtime.architecture!==process.arch||manifest.runtime.modulesAbi!==process.versions.modules))
    fail('RUNTIME_NATIVE_ABI_MISMATCH',{required:{platform:manifest.runtime.platform,architecture:manifest.runtime.architecture,
      modulesAbi:manifest.runtime.modulesAbi},actual:{platform:process.platform,architecture:process.arch,modulesAbi:process.versions.modules}});
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
  for(const[key,name,version]of [['sdk',SDK_NATIVE,SDK_VERSION],['stellar',STELLAR_NATIVE,STELLAR_VERSION]]) {
    const selected=manifest.packages.find(item=>item.id===manifest[key].packageId);
    const packageFile=manifest.files.find(item=>item.path===selected.path+'/package.json');
    if(packageFile.sha256!==manifest[key].packageJsonSha256||selected.name!==name||selected.version!==version)
      fail('RUNTIME_FUUL_BINDING_MISMATCH',{package:name});
  }
  await verifyPublisherFiles(root,manifest);
}


async function verifyPublisherFiles(root,manifest) {
  const original=await readJSON(join(root,manifest.publisher.capsule.path));
  const checked=capsuleOriginal(original.value,original.bytes),selectedFiles=new Map(manifest.files.map(item=>[item.path,item]));
  const source=manifest.publisher.source;
  if(source?.fileCount!==74||source.bytes!==checked.value.bytes)fail('RUNTIME_ORIGINAL_SOURCE_INVALID');
  for(const item of checked.value.files) {
    const selected=selectedFiles.get(relative(source.directory)+'/'+item.path);
    if(!selected||selected.bytes!==item.bytes||selected.sha256!==item.sha256||
      selected.mode!==(item.mode==='100755'?0o755:0o644))fail('RUNTIME_ORIGINAL_SOURCE_CHANGED',{path:item.path});
  }
  const packages=new Map(manifest.packages.map(item=>[item.id,item]));
  for(const item of manifest.packages) {
    const metadata=(await readJSON(join(root,item.path+'/package.json'))).value;
    if(!Array.isArray(item.lockPaths))fail('RUNTIME_ORIGINAL_DEPENDENCY_INVALID',{package:item.id});
    for(const selected of item.lockPaths)requireLockedPackage({metadata},checked.lock,selected);
    const declarations=packageDeclarations(metadata,item.includeDevelopment);
    if(declarations.size!==item.dependencies.length)fail('RUNTIME_DEPENDENCY_DECLARATION_CHANGED',{package:item.id});
    const seen=new Set();
    for(const edge of item.dependencies) {
      const declared=declarations.get(edge.name);
      if(seen.has(edge.name)||!declared||declared.range!==edge.range||declared.kind!==edge.kind||declared.optional!==edge.optional)
        fail('RUNTIME_DEPENDENCY_DECLARATION_CHANGED',{package:item.id,dependency:edge.name});
      seen.add(edge.name);
      if(edge.present) {
        const selected=packages.get(edge.packageId);
        for(const lockPath of item.lockPaths) {
          const pinned=lockedDependency(checked.lock,edge.name,lockPath);
          if(pinned&&!selected.lockPaths.includes(pinned))fail('RUNTIME_ORIGINAL_DEPENDENCY_CHANGED',{package:item.id,dependency:edge.name});
          if(!pinned&&item.requiredByFuul&&!edge.optional)fail('RUNTIME_ORIGINAL_DEPENDENCY_MISSING',{package:item.id,dependency:edge.name});
        }
      }
    }
    if(item.name===SDK_NATIVE) {
      if(canonical(metadata)!==canonical(checked.packageJSON))fail('RUNTIME_FUUL_PACKAGE_CHANGED');
      const contracts=selectedFiles.get(item.path+'/contracts.json');
      if(!contracts||contracts.sha256!==CONTRACTS_SHA256)fail('RUNTIME_ORIGINAL_BINDING_CHANGED');
    }
  }
  const sdk=packages.get(manifest.sdk.packageId),stellar=packages.get(manifest.stellar.packageId);
  if(!sdk.lockPaths.includes('node_modules/'+SDK_NATIVE)||!sdk.requiredByFuul||
    stellar.version!==STELLAR_VERSION||!stellar.requiredByFuul)fail('RUNTIME_FUUL_BINDING_MISMATCH');
  for(const name of EXPORTS) {
    const declared=checked.packageJSON.exports[name];
    const esm=sdk.path+'/'+relative(declared.import.default.slice(2)),cjs=sdk.path+'/'+relative(declared.require.default.slice(2));
    if(manifest.entrypoints[name]!==esm||manifest.requireEntrypoints[name]!==cjs)fail('RUNTIME_ENTRYPOINTS_INVALID',{export:name});
    for(const target of [declared.import.types,declared.require.types]) {
      if(typeof target!=='string'||!selectedFiles.has(sdk.path+'/'+relative(target.slice(2))))fail('RUNTIME_DECLARATION_FILE_MISSING',{export:name});
    }
  }
  if(manifest.build) {
    const build=manifest.build,receipt=(await readJSON(join(root,build.receipt.path))).value;
    if(receipt.schema!=='stellar-forge.fuul-stellar-build-receipt.v1'||receipt.sourceCapsuleSha256!==CAPSULE_SHA256||
      receipt.sourcePackageId!==build.sourcePackageId||receipt.sourceDirectory!==build.sourceDirectory||
      canonical(receipt.toolchain)!==canonical(build.toolchain)||!Array.isArray(receipt.steps)||
      receipt.steps.some(step=>step.status!=='COMPLETE'||step.exitCode!==0)||
      canonical(receipt.steps.map(step=>step.name))!==canonical(['source-install','source-build','source-pack','consumer-install']))
      fail('RUNTIME_BUILD_SOURCE_CHANGED');
    const builtSource=packages.get(build.sourcePackageId);
    if(!builtSource.includeDevelopment||!builtSource.requiredByFuul)fail('RUNTIME_BUILD_SOURCE_CHANGED');
    const compiler=builtSource.dependencies.find(edge=>edge.name==='typescript'&&edge.present);
    if(packages.get(compiler?.packageId)?.version!==TYPESCRIPT_VERSION)fail('RUNTIME_BUILD_COMPILER_CHANGED');
    const archive=build.files.find(item=>item.path==='build/installation/vendor/fuul-sdk-stellar-0.3.0.tgz');
    if(!archive||archive.sha256!==receipt.archive.sha256||archive.bytes!==receipt.archive.bytes)fail('RUNTIME_BUILD_ARCHIVE_CHANGED');
    const installed=(await readJSON(join(root,'build/installation/package.json'))).value;
    if(installed.dependencies?.[SDK_NATIVE]!=='file:vendor/fuul-sdk-stellar-0.3.0.tgz')fail('RUNTIME_BUILD_INSTALLATION_CHANGED');
    const lock=(await readJSON(join(root,'build/installation/package-lock.json'))).value;
    const installedSDK=lock.packages?.['node_modules/'+SDK_NATIVE];
    if(lock.lockfileVersion!==3||installedSDK?.version!==SDK_VERSION||
      installedSDK.resolved!=='file:vendor/fuul-sdk-stellar-0.3.0.tgz')fail('RUNTIME_BUILD_INSTALLATION_CHANGED');
  }
}

const BUILD_SCHEMA='stellar-forge.fuul-stellar-build-operation.v1';
const BUILD_RECEIPT_SCHEMA='stellar-forge.fuul-stellar-build-receipt.v1';
const BUILD_COMMAND_SCHEMA='stellar-forge.fuul-stellar-build-command.v1';
function abortBuild(signal) {
  if(signal?.aborted)fail('RUNTIME_BUILD_ABORTED');
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
async function verifyOriginalSource(root,checked,{allowCompiled=true}={}) {
  await directory(root);
  const expected=new Set(checked.value.files.map(item=>item.path));
  for(const item of checked.value.files) {
    await safeParents(root,item.path);
    const actual=await inspectFile(join(root,item.path));
    if(actual.sha256!==item.sha256||actual.bytes!==item.bytes||
      actual.mode!==(item.mode==='100755'?0o755:0o644))fail('RUNTIME_BUILD_SOURCE_CHANGED',{path:item.path});
  }
  async function scan(current,prefix='') {
    for(const entry of await fs.readdir(current,{withFileTypes:true})) {
      if(VCS.has(entry.name)||(allowCompiled&&['dist','node_modules'].includes(entry.name)&&!prefix))continue;
      const rel=prefix?prefix+'/'+entry.name:entry.name,filename=path.join(current,entry.name);
      if(entry.isDirectory())await scan(filename,rel);
      else if(!expected.has(rel))fail('RUNTIME_BUILD_UNDECLARED_SOURCE',{path:rel});
    }
  }
  await scan(root);
}
async function prepareBuildSource(root,checked,selectedSource) {
  await fs.mkdir(root,{recursive:true,mode:0o700});
  await directory(root);
  if(selectedSource)await verifyOriginalSource(selectedSource,checked);
  for(const item of checked.value.files) {
    await safeParents(root,item.path,{create:true});
    const target=join(root,item.path),actual=await lstatMaybe(target);
    for(const name of await fs.readdir(path.dirname(target))) {
      if(name.startsWith(path.basename(target)+'.partial-')&&
        /^[0-9a-f-]{36}$/.test(name.slice((path.basename(target)+'.partial-').length)))
        await fs.rm(path.join(path.dirname(target),name),{force:true});
    }
    if(actual) {
      if(!actual.isFile()||actual.isSymbolicLink())fail('RUNTIME_BUILD_SOURCE_CHANGED',{path:item.path});
      const retained=await inspectFile(target);
      if(retained.sha256!==item.sha256||retained.bytes!==item.bytes)fail('RUNTIME_BUILD_SOURCE_CHANGED',{path:item.path});
      await fs.chmod(target,item.mode==='100755'?0o755:0o644);
    }else {
      const bytes=selectedSource?await readFile(join(selectedSource,item.path)):Buffer.from(item.content,'utf8');
      if(sha256(bytes)!==item.sha256||bytes.length!==item.bytes)fail('RUNTIME_BUILD_SOURCE_CHANGED',{path:item.path});
      await atomicBytes(root,item.path,bytes,item.mode==='100755'?0o755:0o644);
    }
  }
  await verifyOriginalSource(root,checked);
}
async function matchesProcessIdentity(owner) {
  if(!object(owner)||!Number.isInteger(owner.pid)||owner.pid<=0)return false;
  try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return false;if(error.code!=='EPERM')throw error;}
  const actual=await processIdentity(owner.pid);
  if(owner.boot&&actual.boot!==owner.boot)return false;
  if(owner.start&&actual.start!==owner.start)return false;
  return true;
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
      const selected=Buffer.from('FUUL_BUILD_COMMAND_TOKEN='+command.token+'\0');
      if(environment.includes(selected))result.push(await processIdentity(pid));
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
export async function runFuulBuildChild(commandFile) {
  const file=absolute(commandFile,'commandFile'),attemptDirectory=path.dirname(file);
  const loaded=await readJSON(file),command=loaded.value;
  if(command.schema!==BUILD_COMMAND_SCHEMA||typeof command.token!=='string'||
    !Array.isArray(command.args)||command.args.some(value=>typeof value!=='string'||value.includes('\0'))||
    typeof command.executable!=='string'||!path.isAbsolute(command.executable)||
    !['source-install','source-build','source-pack','consumer-install'].includes(command.stage)||
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
    const env={...process.env,FUUL_BUILD_COMMAND_TOKEN:command.token,FUUL_BUILD_OPERATION_ID:command.operationId,
      npm_config_cache:command.cacheDirectory,npm_config_audit:'false',npm_config_fund:'false',
      PATH:command.toolDirectories.join(path.delimiter)+path.delimiter+(process.env.PATH??'')};
    delete env.NODE_OPTIONS;
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
        recovered:true,attemptId:name,stdoutSha256:(await inspectFile(path.join(attemptDirectory,'stdout.log'))).sha256,
        stderrSha256:(await inspectFile(path.join(attemptDirectory,'stderr.log'))).sha256};
    }
    if(await buildCommandActive(command,result))fail('RUNTIME_BUILD_IN_PROGRESS',{stage,operationId:operation.id,commandFile});
    previous={attemptDirectory,command,result};
  }
  const attemptId='attempt-'+randomUUID(),attemptDirectory=path.join(base,attemptId);
  await fs.mkdir(attemptDirectory,{mode:0o700});
  const command={schema:BUILD_COMMAND_SCHEMA,operationId:operation.id,stage,token:randomUUID(),
    executable,args,cwd,attemptDirectory,cacheDirectory:path.join(operation.buildDirectory,'npm-cache'),
    toolDirectories:operation.toolDirectories,createdAt:new Date().toISOString()};
  await atomicBytes(attemptDirectory,'command.json',jsonBytes(command));
  await progress?.({stage,status:'RUNNING',operationId:operation.id,attemptId});
  abortBuild(signal);
  const wrapper='const m=await import(process.argv[1]);await m.runFuulBuildChild(process.argv[2]);';
  const env={...process.env,FUUL_BUILD_COMMAND_TOKEN:command.token};delete env.NODE_OPTIONS;
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
    attemptId,stdoutSha256:(await inspectFile(path.join(attemptDirectory,'stdout.log'))).sha256,
    stderrSha256:(await inspectFile(path.join(attemptDirectory,'stderr.log'))).sha256};
  await progress?.({stage,status:'COMPLETE',operationId:operation.id,attemptId});
  return retained;
}
async function writeSelectedFile(root,rel,bytes,fileMode=0o644) {
  await safeParents(root,rel,{create:true});
  const target=join(root,rel),existing=await lstatMaybe(target);
  if(existing) {
    if(!existing.isFile()||existing.isSymbolicLink())fail('RUNTIME_BUILD_DESTINATION_CONFLICT',{path:rel});
    const actual=await inspectFile(target);
    if(actual.bytes!==bytes.length||actual.sha256!==sha256(bytes))fail('RUNTIME_BUILD_DESTINATION_CONFLICT',{path:rel});
    await fs.chmod(target,fileMode);
  }else await atomicBytes(root,rel,bytes,fileMode);
}
async function readBuildSelection(installationDirectory,checked) {
  const marker=path.join(installationDirectory,'.fuul-sdk-build.json');
  if(!await lstatMaybe(marker))return null;
  const selected=(await readJSON(marker)).value;
  if(selected.schema!==BUILD_SCHEMA||selected.sourceCapsuleSha256!==CAPSULE_SHA256||
    selected.installationDirectory!==installationDirectory||selected.status!=='COMPLETE'||
    typeof selected.sourceDirectory!=='string'||typeof selected.buildDirectory!=='string'||
    selected.sourceDirectory!==path.join(selected.buildDirectory,'source')||
    !object(selected.receipt)||selected.receipt.schema!==BUILD_RECEIPT_SCHEMA)
    fail('RUNTIME_BUILD_SELECTION_INCOMPLETE');
  await verifyOriginalSource(selected.sourceDirectory,checked);
  const receipt=selected.receipt;
  if(receipt.sourceCapsuleSha256!==CAPSULE_SHA256||receipt.toolchain?.bun!==BUN_VERSION||
    receipt.toolchain?.typescript!==TYPESCRIPT_VERSION||!Array.isArray(receipt.steps)||
    ['source-install','source-build','source-pack','consumer-install'].some(name=>
      !receipt.steps.some(step=>step.name===name&&step.status==='COMPLETE'&&step.exitCode===0)))
    fail('RUNTIME_BUILD_SELECTION_CHANGED');
  const files=[
    {filename:path.join(installationDirectory,'package.json'),path:'build/installation/package.json'},
    {filename:path.join(installationDirectory,'package-lock.json'),path:'build/installation/package-lock.json'},
    {filename:path.join(installationDirectory,'vendor','fuul-sdk-stellar-0.3.0.tgz'),
      path:'build/installation/vendor/fuul-sdk-stellar-0.3.0.tgz'}
  ];
  for(const file of files) {
    const actual=await inspectFile(file.filename),expected=selected.installationFiles?.find(item=>item.path===file.path);
    if(!expected||actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)
      fail('RUNTIME_BUILD_INSTALLATION_CHANGED',{path:file.path});
  }
  return {sourceDirectory:selected.sourceDirectory,files,receipt};
}
/** Build the unchanged publisher source with its frozen Bun dependency selection,
 * install its original npm archive in a private consumer project, then retain the
 * complete installed SDK, Stellar and shared source/compiler package graph. */
export async function buildFuulRuntime({installationDirectory,directory:selectedDirectory,sourceDirectory,
  bunExecutable='bun',npmExecutable='npm',signal,progress}={}) {
  abortBuild(signal);
  const installation=absolute(installationDirectory,'installationDirectory');
  const destination=absolute(selectedDirectory,'directory');
  const selectedSource=sourceDirectory===undefined?null:absolute(sourceDirectory,'sourceDirectory');
  if(within(installation,destination)||within(destination,installation))fail('RUNTIME_SOURCE_DESTINATION_OVERLAP');
  const publisher=await publisherSources(),checked=publisher.checked;
  const buildDirectory=installation+'.fuul-build',privateSource=path.join(buildDirectory,'source');
  if(selectedSource&&(within(privateSource,selectedSource)||within(selectedSource,privateSource)))
    fail('RUNTIME_BUILD_SOURCE_OVERLAP');
  await fs.mkdir(path.dirname(buildDirectory),{recursive:true,mode:0o700});
  const release=await acquire(buildDirectory);
  try {
    const operationFile=path.join(buildDirectory,'operation.json');
    let operation;
    if(await lstatMaybe(buildDirectory)) {
      await directory(buildDirectory);
      if(await lstatMaybe(operationFile))operation=(await readJSON(operationFile)).value;
      else {
        const entries=await fs.readdir(buildDirectory);
        if(entries.some(name=>!/^operation\.json\.partial-[0-9a-f-]{36}$/.test(name)))
          fail('RUNTIME_BUILD_DESTINATION_CONFLICT',{directory:buildDirectory});
      }
    }else await fs.mkdir(buildDirectory,{mode:0o700});
    if(operation) {
      if(operation.schema!==BUILD_SCHEMA||operation.sourceCapsuleSha256!==CAPSULE_SHA256||
        operation.installationDirectory!==installation||operation.sourceDirectory!==privateSource||
        operation.buildDirectory!==buildDirectory||operation.selectedSourceDirectory!==selectedSource)
        fail('RUNTIME_BUILD_SELECTION_CHANGED');
    }else {
      operation={schema:BUILD_SCHEMA,id:randomUUID(),sourceCapsuleSha256:CAPSULE_SHA256,
        installationDirectory:installation,sourceDirectory:privateSource,buildDirectory,
        selectedSourceDirectory:selectedSource,createdAt:new Date().toISOString(),status:'PREPARING',steps:[]};
      await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
    }
    if(await lstatMaybe(path.join(installation,'.fuul-sdk-build.json'))) {
      const existing=(await readJSON(path.join(installation,'.fuul-sdk-build.json'))).value;
      if(existing.id!==operation.id)fail('RUNTIME_BUILD_DESTINATION_CONFLICT',{directory:installation});
      if(existing.status==='COMPLETE') {
        await readBuildSelection(installation,checked);
        const retained=await retainFuulRuntime({installationDirectory:installation,directory:destination});
        return {...retained,build:{operationId:operation.id,installationDirectory:installation,
          sourceDirectory:privateSource,receipt:existing.receipt}};
      }
    }else {
      if(await lstatMaybe(installation)) {
        await directory(installation);
        const entries=await fs.readdir(installation);
        if(entries.some(name=>!/^\.fuul-sdk-build\.json\.partial-[0-9a-f-]{36}$/.test(name)))
          fail('RUNTIME_BUILD_DESTINATION_CONFLICT',{directory:installation});
      }else await fs.mkdir(installation,{mode:0o700});
      await atomicBytes(installation,'.fuul-sdk-build.json',jsonBytes(operation));
    }
    const bun=await actualExecutable(bunExecutable,'bun'),npm=await actualExecutable(npmExecutable,'npm');
    const [bunVersion,npmVersion]=await Promise.all([buildToolVersion(bun),buildToolVersion(npm)]);
    const [nodeMajor,nodeMinor]=process.versions.node.split('.').map(Number);
    if(nodeMajor<22||(nodeMajor===22&&nodeMinor<16))fail('RUNTIME_NODE_VERSION_REQUIRED',{minimum:'22.16.0',actual:process.versions.node});
    if(bunVersion!==BUN_VERSION)fail('RUNTIME_BUN_VERSION_MISMATCH',{expected:BUN_VERSION,actual:bunVersion});
    const tools={bun,npm,node:await fs.realpath(process.execPath)},toolchain={bun:bunVersion,typescript:TYPESCRIPT_VERSION,
      node:process.versions.node,npm:npmVersion,platform:process.platform,architecture:process.arch};
    if(operation.tools&&(canonical(operation.tools)!==canonical(tools)||canonical(operation.toolchain)!==canonical(toolchain)))
      fail('RUNTIME_BUILD_TOOLCHAIN_CHANGED');
    const toolBindings=await prepareBuildToolBindings(buildDirectory,tools);
    operation={...operation,tools,toolchain,toolDirectories:[toolBindings,...new Set(Object.values(tools).map(value=>path.dirname(value)))],status:'BUILDING'};
    await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
    await prepareBuildSource(privateSource,checked,selectedSource);
    const stages=[
      ['source-install',bun,['install','--frozen-lockfile'],privateSource],
      ['source-build',bun,['run','build'],privateSource]
    ];
    for(const[name,executable,args,cwd]of stages) {
      const receipt=await executeBuildStage(operation,name,executable,args,cwd,{signal,progress});
      operation.steps=operation.steps.filter(item=>item.name!==name).concat(receipt);
      await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
      await verifyOriginalSource(privateSource,checked);
    }
    const archiveDirectory=path.join(buildDirectory,'archive');
    await fs.mkdir(archiveDirectory,{recursive:true,mode:0o700});
    const pack=await executeBuildStage(operation,'source-pack',npm,['pack','--json','--pack-destination',archiveDirectory],privateSource,{signal,progress});
    operation.steps=operation.steps.filter(item=>item.name!=='source-pack').concat(pack);
    await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
    await verifyOriginalSource(privateSource,checked);
    const archiveFile=path.join(archiveDirectory,'fuul-sdk-stellar-0.3.0.tgz');
    const archive=await inspectFile(archiveFile);
    await fs.mkdir(path.join(installation,'vendor'),{recursive:true,mode:0o700});
    await copyFile({filename:archiveFile},installation,{path:'vendor/fuul-sdk-stellar-0.3.0.tgz',
      bytes:archive.bytes,sha256:archive.sha256,mode:0o644});
    const overrides={};
    for(const[locked,item]of Object.entries(checked.lock.packages)) {
      if(locked==='node_modules/'+item.packageName&&item.packageName!==SDK_NATIVE)
        overrides[item.packageName]=item.version;
    }
    const packageJSON={name:'fuul-stellar-original-consumer',version:'1.0.0',private:true,type:'module',
      dependencies:{[SDK_NATIVE]:'file:vendor/fuul-sdk-stellar-0.3.0.tgz'},overrides};
    await writeSelectedFile(installation,'package.json',jsonBytes(packageJSON));
    const installed=await executeBuildStage(operation,'consumer-install',npm,
      ['install','--package-lock=true','--no-audit','--no-fund'],installation,{signal,progress});
    operation.steps=operation.steps.filter(item=>item.name!=='consumer-install').concat(installed);
    await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
    const installedPackage=await resolvePackage(SDK_NATIVE,installation);
    if(!installedPackage||canonical(installedPackage.metadata)!==canonical(checked.packageJSON))
      fail('RUNTIME_BUILD_INSTALLATION_CHANGED');
    const installationFiles=[];
    for(const[name,rel]of [['package.json','build/installation/package.json'],
      ['package-lock.json','build/installation/package-lock.json'],
      ['vendor/fuul-sdk-stellar-0.3.0.tgz','build/installation/vendor/fuul-sdk-stellar-0.3.0.tgz']]) {
      const actual=await inspectFile(path.join(installation,...name.split('/')));
      installationFiles.push({path:rel,bytes:actual.bytes,sha256:actual.sha256,mode:actual.mode});
    }
    const receipt={schema:BUILD_RECEIPT_SCHEMA,operationId:operation.id,sourceCapsuleSha256:CAPSULE_SHA256,
      originalCommit:checked.value.publisher.commit,originalLockSha256:LOCK_SHA256,contractsSha256:CONTRACTS_SHA256,
      createdAt:operation.createdAt,completedAt:new Date().toISOString(),toolchain,
      steps:operation.steps,archive:{filename:'fuul-sdk-stellar-0.3.0.tgz',bytes:archive.bytes,sha256:archive.sha256}};
    operation={...operation,status:'COMPLETE',receipt,installationFiles};
    await atomicBytes(buildDirectory,'operation.json',jsonBytes(operation));
    await atomicBytes(installation,'.fuul-sdk-build.json',jsonBytes(operation));
    const retained=await retainFuulRuntime({installationDirectory:installation,directory:destination});
    await progress?.({stage:'runtime-retained',status:'COMPLETE',operationId:operation.id,runtimeId:retained.id,
      manifestSha256:retained.manifestSha256});
    return {...retained,build:{operationId:operation.id,installationDirectory:installation,
      sourceDirectory:privateSource,receipt}};
  }finally{await release();}
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
        const result = await verifyFuulRuntime({directory: destination});
        if (result.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        return result;
      }
      if ((await fs.readdir(destination)).length) fail('RUNTIME_DESTINATION_NOT_EMPTY', {directory: destination});
    }
    const staging = destination + '.runtime-stage';
    const existed = await lstatMaybe(staging);
    if (!existed) {
      await fs.mkdir(staging, {mode: 0o700});
      await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.fuul-stellar-runtime-operation.v1', kind, id: plan.manifest.id}));
    } else {
      await directory(staging);
      const markerFile = path.join(staging, '.operation.json');
      if (await lstatMaybe(markerFile)) {
        const marker = (await readJSON(markerFile)).value;
        if (marker.schema !== 'stellar-forge.fuul-stellar-runtime-operation.v1' || marker.kind !== kind || marker.id !== plan.manifest.id)
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else if (await lstatMaybe(path.join(staging, 'manifest.json'))) {
        const retained = await loadManifest(staging);
        if (retained.manifest.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else {
        const leftovers = await fs.readdir(staging);
        if (leftovers.some(name => !/^\.operation\.json\.partial-[0-9a-f-]{36}$/.test(name)))
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        for (const name of leftovers) await fs.rm(path.join(staging, name), {force: true});
        await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.fuul-stellar-runtime-operation.v1', kind, id: plan.manifest.id}));
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

/** Capture the complete installed Fuul SDK and Stellar package graph before importing code.
 * The exact generation directory is caller-selected. An acknowledged immutable
 * generation reopens as itself; interrupted copies retain their original plan ID.
 */
export async function retainFuulRuntime({directory: selectedDirectory, installationDirectory = HERE} = {}) {
  const destination = absolute(selectedDirectory, 'directory');
  const installed = absolute(installationDirectory, 'installationDirectory');
  if (await lstatMaybe(path.join(destination, 'manifest.json')))
    return verifyFuulRuntime({directory: destination});
  const plan = await planRuntime(installed);
  return materialize(destination, plan, 'retain');
}

/** Verify original bytes, permission bits, complete package graph and real links.
 * This function reads original source only; it never imports publisher code.
 */
export async function verifyFuulRuntime({directory: selectedDirectory, expectedManifestSha256} = {}) {
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
export async function restoreFuulRuntime({sourceDirectory, destination: selectedDestination, expectedManifestSha256} = {}) {
  const source = absolute(sourceDirectory, 'sourceDirectory');
  const destination = absolute(selectedDestination, 'destination');
  if (source === destination) return verifyFuulRuntime({directory: source, expectedManifestSha256});
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
export async function bindFuulRuntime({directory: selectedDirectory, applicationDirectory, expectedManifestSha256} = {}) {
  const runtime = await verifyFuulRuntime({directory:selectedDirectory, expectedManifestSha256});
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
  return {schema:'stellar-forge.fuul-stellar-runtime-binding.v1',runtimeId:runtime.id,
    runtimeDirectory:runtime.directory,manifestSha256:runtime.manifestSha256,
    applicationDirectory:applicationRoot,packageBindings:runtime.packageBindings,bindings,
    version:runtime.manifest.sdk.version,stellarVersion:runtime.manifest.stellar.version};
}

/** Resolve the trusted host selection without importing publisher code. A transported
 * runtime may contain regular files only; its original link/mode graph is then
 * reconstructed in an independent deterministic installed directory. */
export async function resolveFuulRuntime({installationDirectory,runtimeDirectory,expectedManifestSha256}={}) {
  let retained;
  if(runtimeDirectory!==undefined) {
    const selected=absolute(runtimeDirectory,'runtimeDirectory');
    if(await lstatMaybe(path.join(selected,'manifest.json'))) {
      const loaded=await loadManifest(selected,expectedManifestSha256);
      await verifyFiles(selected,loaded.manifest,{layout:false});
      try { return await verifyFuulRuntime({directory:selected,expectedManifestSha256}); }
      catch(error) {
        if(!['RUNTIME_LINK_MISMATCH','RUNTIME_DIRECTORY_MODE_MISMATCH','RUNTIME_FILE_MODE_MISMATCH','RUNTIME_DIRECTORY_REQUIRED'].includes(error.code))
          throw error;
        return restoreFuulRuntime({sourceDirectory:selected,destination:selected+'.installed-'+loaded.manifest.id,
          expectedManifestSha256:loaded.manifestSha256});
      }
    }
    retained=await retainFuulRuntime({directory:selected,installationDirectory:installationDirectory??HERE});
  } else {
    const installed=absolute(installationDirectory??HERE,'installationDirectory');
    const plan=await planRuntime(installed);
    retained=await materialize(path.join(installed,'.fuul-programmes-runtimes',plan.manifest.id),plan,'retain');
  }
  if(expectedManifestSha256!==undefined&&retained.manifestSha256!==hash(expectedManifestSha256,'expectedManifestSha256'))
    fail('RUNTIME_MANIFEST_HASH_MISMATCH');
  return retained;
}
export function publicFuulRuntime(runtime) {
  return Object.freeze({id:hash(runtime.id,'runtime.id'),manifestSha256:hash(runtime.manifestSha256,'runtime.manifestSha256'),
    version:SDK_VERSION,stellarVersion:STELLAR_VERSION});
}
/** Load the publisher's original compiled SDK and the exact Stellar dependency
 * only after their complete package/source bytes have been retained and verified. */
export async function loadFuulStellar(options={}) {
  const retained=await resolveFuulRuntime(options);
  let sdk,stellar;
  try {
    [sdk,stellar]=await Promise.all([import(pathToFileURL(retained.entrypoint).href),
      import(pathToFileURL(retained.stellarEntrypoint).href)]);
  }catch(error){fail('FUUL_STELLAR_IMPORT_FAILED',{runtimeId:retained.id},error);}
  const declared=['FuulSdk','getEventPage','decodeEvent','createClaimCheck'];
  if(declared.some(name=>typeof sdk[name]!=='function')||typeof stellar.Address!=='function'||
    typeof stellar.scValToNative!=='function'||typeof stellar.rpc?.Server!=='function'||
    !['FactoryContract','ManagerContract','ProjectContract'].every(name=>typeof sdk[name]?.Client==='function'))
    fail('FUUL_STELLAR_EXPORTS_CHANGED',{runtimeId:retained.id});
  return {sdk,stellar,runtime:publicFuulRuntime(retained)};
}
export const fuulRuntimeSelection=Object.freeze({schema:SCHEMA,package:SDK_NATIVE,version:SDK_VERSION,
  stellarPackage:STELLAR_NATIVE,stellarVersion:STELLAR_VERSION,bunVersion:BUN_VERSION,typescriptVersion:TYPESCRIPT_VERSION,
  originalLockSha256:LOCK_SHA256,originalCapsuleSha256:CAPSULE_SHA256,originalContractsSha256:CONTRACTS_SHA256});

/** Read the exact retained manifest without importing or installing packages. */
export async function readFuulRuntimeManifest({directory:selectedDirectory,expectedManifestSha256}={}) {
  return loadManifest(absolute(selectedDirectory,'directory'),expectedManifestSha256);
}
