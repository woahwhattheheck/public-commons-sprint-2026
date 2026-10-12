// MIT. Complete Utility operations through the existing private Python owner.
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, link, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openUtilityWorkspace } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/utility-energy/utility-client.mjs';
import { utilityEnergyWorkspaceTools, utilityEnergyActionNames, utilityEnergyInventoryKinds,
  utilityEnergyInspectKinds, utilityEnergyPublisherKinds } from './catalog/utility-energy-workspace.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
export { utilityEnergyWorkspaceTools } from './catalog/utility-energy-workspace.mjs';

export const UTILITY_ENERGY_CONNECTION_SCHEMA = 'stellar-forge.utility-workspace-connection.v1';
export const UTILITY_ENERGY_APPLICATION_SCHEMA = 'stellar-forge.utility-workspace.v1';
export const UTILITY_ENERGY_EXPORT_SCHEMA = 'stellar-forge.utility-mcp-export.v1';
export const UTILITY_ENERGY_MANIFEST = 'utility-export.json';
const SHA = /^[0-9a-f]{64}$/, ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILE = 2 * 1024 * 1024 * 1024, MAX_SOURCE = 256 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const sha = value => createHash('sha256').update(value).digest('hex');
const stamp = info => [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
const canonical = value => JSON.stringify(plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))
  : Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : value);
function ensure(value, message, code = 'INVALID_PARAMS') { if (!value) throw fail(code, message); }
function exact(value, keys, required = []) {
  ensure(plain(value) && Object.keys(value).every(key => keys.includes(key)) &&
    required.every(key => Object.hasOwn(value,key)), 'Supply the declared fields and every required field.');
}
function checked(value, pattern, label) {
  ensure(typeof value === 'string' && pattern.test(value), 'Choose a valid ' + label + '.'); return value;
}
function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  ensure(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'Use an integer in the declared range.'); return value;
}
function text(value, label, maximum = 240) {
  ensure(typeof value === 'string' && value.trim() && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value),
    label + ' must be nonempty single-line text.'); return value;
}
function hostPath(value, base) {
  ensure(typeof value === 'string' && value && !value.includes('\0'), 'Declare an original host path.', 'CONFIGURATION_ERROR');
  return resolve(base,value);
}
function relativeName(value) {
  text(value,'Original relative filename',512);
  ensure(!value.startsWith('/') && !/[\\:]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'), 'Select an original declared relative filename.');
  return value;
}
function deliveryName(value) {
  text(value,'Receiving filename',160);
  ensure(!/[\\/:]/.test(value) && value !== '.' && value !== '..', 'Use a simple original receiving filename.');
  return value;
}
async function regular(path, maximum, privateFile = false) {
  const handle = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({bigint:true});
    ensure(info.isFile() && info.size <= BigInt(maximum) &&
      (!privateFile || process.platform === 'win32' || info.uid === BigInt(process.getuid()) && !(info.mode & 0o077n)),
    'Use an original regular file within its size and privacy limits.','UTILITY_FILE_INVALID');
    return {handle,info};
  } catch (error) { await handle.close(); throw error; }
}
async function bytes(path, maximum, privateFile = false) {
  const {handle,info} = await regular(path,maximum,privateFile);
  try {
    const data = await handle.readFile();
    ensure(data.length <= maximum && stamp(await handle.stat({bigint:true})) === stamp(info),
      'The original file changed while reading it.','UTILITY_FILE_CHANGED');
    return data;
  } finally { await handle.close(); }
}
async function identity(path, maximum, privateFile = false) {
  const {handle,info} = await regular(path,maximum,privateFile);
  try {
    const digest = createHash('sha256');
    for await (const part of handle.createReadStream({autoClose:false,start:0})) digest.update(part);
    ensure(stamp(await handle.stat({bigint:true})) === stamp(info), 'The original file changed during review.','UTILITY_FILE_CHANGED');
    return {bytes:Number(info.size),sha256:digest.digest('hex')};
  } finally { await handle.close(); }
}
async function privateDirectory(path, create = false) {
  if (create) await mkdir(path,{mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  ensure(info.isDirectory() && !info.isSymbolicLink() &&
    (process.platform === 'win32' || info.uid === process.getuid() && !(info.mode & 0o077)),
  'Use the original private retained delivery directory.','UTILITY_EXPORT_DIRECTORY_INVALID');
  return path;
}
async function syncDirectory(path) {
  const handle = await open(path,constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function immutableRecord(path, value) {
  const temporary = join(dirname(path),'.record-' + randomUUID()); let handle;
  try {
    handle = await open(temporary,'wx',0o600); await handle.writeFile(value); await handle.sync();
    await handle.close(); handle = null;
    try { await link(temporary,path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; return false; }
    await syncDirectory(dirname(path)); return true;
  } finally {
    await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
function page(items, {offset = 0,limit = 50,expectedSnapshot} = {}) {
  integer(offset); integer(limit,1,250);
  const snapshot = sha(canonical(items));
  ensure(!offset || expectedSnapshot !== undefined,'Continue the original page-zero snapshot.','UTILITY_SNAPSHOT_REQUIRED');
  if (expectedSnapshot !== undefined) ensure(checked(expectedSnapshot,SHA,'inventory SHA256') === snapshot,
    'The original inventory changed. Review its current page zero.','UTILITY_INVENTORY_CHANGED');
  ensure(offset <= items.length,'Offset exceeds the original inventory.');
  return {total:items.length,snapshot,offset,items:items.slice(offset,offset+limit),
    nextOffset:offset+limit < items.length ? offset+limit : null};
}
function namedMap(value, maximum, label) {
  ensure(value === undefined || plain(value) && Object.keys(value).length <= maximum,
    'Declare up to ' + maximum + ' ' + label + '.','CONFIGURATION_ERROR');
  return Object.entries(value ?? {});
}
/** Paths are host configuration. MCP arguments select only these reviewed aliases. */
export async function readUtilityEnergyWorkspaceConfiguration(path) {
  path = resolve(path);
  const value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(path,1024*1024,true)));
  exact(value,['schema','workspaces'],['schema','workspaces']);
  ensure(value.schema === UTILITY_ENERGY_CONNECTION_SCHEMA && plain(value.workspaces) &&
    Object.keys(value.workspaces).length >= 1 && Object.keys(value.workspaces).length <= 32,
  'Declare 1–32 existing Utility consoles.','CONFIGURATION_ERROR');
  const workspaces = Object.create(null), base = dirname(path);
  for (const [alias,input] of Object.entries(value.workspaces)) {
    checked(alias,ALIAS,'workspace alias');
    exact(input,['label','consoleUrlFile','expectedBindingSha256','workspaceDirectory','files','captures','buyerWorkspaces'],['consoleUrlFile']);
    const files = Object.create(null), captures = Object.create(null), buyerWorkspaces = Object.create(null);
    for (const [key,file] of namedMap(input.files,128,'original source or packet handles')) {
      checked(key,ALIAS,'file alias');
      exact(file,['path','kind','name','label','sha256','provider','sourceKind','context'],['path','kind']);
      ensure(['source','workspace'].includes(file.kind),'Choose source or workspace input.','CONFIGURATION_ERROR');
      if (file.provider !== undefined) ensure(['auto','utilityapi','greenbutton'].includes(file.provider),'Choose the native source provider.');
      if (file.context !== undefined) ensure(plain(file.context) && Buffer.byteLength(JSON.stringify(file.context)) <= 65536,'Use a short original source context.');
      files[key] = {path:hostPath(file.path,base),kind:file.kind,
        ...(file.name === undefined ? {} : {name:text(file.name,'Source name',160)}),
        ...(file.label === undefined ? {} : {label:text(file.label,'Source label')}),
        ...(file.sha256 === undefined ? {} : {sha256:checked(file.sha256,SHA,'source SHA256')}),
        ...(file.provider === undefined ? {} : {provider:file.provider}),
        ...(file.sourceKind === undefined ? {} : {sourceKind:text(file.sourceKind,'Original source kind',64)}),
        ...(file.context === undefined ? {} : {context:file.context})};
    }
    for (const [key,capture] of namedMap(input.captures,128,'native capture profiles')) {
      checked(key,ALIAS,'capture alias'); exact(capture,['path','sha256','label'],['path']);
      captures[key] = {path:hostPath(capture.path,base),
        ...(capture.sha256 === undefined ? {} : {sha256:checked(capture.sha256,SHA,'capture profile SHA256')}),
        ...(capture.label === undefined ? {} : {label:text(capture.label,'Capture label')})};
    }
    for (const [key,buyer] of namedMap(input.buyerWorkspaces,128,'original buyer workspaces')) {
      checked(key,ALIAS,'buyer workspace alias'); exact(buyer,['directory','label'],['directory']);
      buyerWorkspaces[key] = {directory:hostPath(buyer.directory,base),label:text(buyer.label ?? key,'Buyer workspace label')};
    }
    workspaces[alias] = {label:text(input.label ?? alias,'Workspace label'),consoleUrlFile:hostPath(input.consoleUrlFile,base),
      ...(input.expectedBindingSha256 === undefined ? {} : {expectedBindingSha256:checked(input.expectedBindingSha256,SHA,'managed binding SHA256')}),
      ...(input.workspaceDirectory === undefined ? {} : {workspaceDirectory:hostPath(input.workspaceDirectory,base)}),
      files,captures,buyerWorkspaces};
  }
  return {schema:UTILITY_ENERGY_CONNECTION_SCHEMA,workspaces};
}
const definitions = new Map(utilityEnergyWorkspaceTools((name,description,properties,required) =>
  ({name,description,properties,required})).map(value => [value.name,value]));
function field(value, schema) {
  if (schema.enum) ensure(schema.enum.includes(value),'Choose one of the declared original values.');
  if (schema.type === 'string') {
    ensure(typeof value === 'string','Use a string value.');
    if (schema.pattern) ensure(new RegExp(schema.pattern).test(value),'The identifier differs from its original format.');
    if (schema.minLength !== undefined) ensure(value.length >= schema.minLength,'The value is too short.');
    if (schema.maxLength !== undefined) ensure(value.length <= schema.maxLength,'The value is too long.');
  } else if (schema.type === 'integer') integer(value,schema.minimum ?? 0,schema.maximum);
  else if (schema.type === 'boolean') ensure(typeof value === 'boolean','Use a boolean value.');
  else if (schema.type === 'array') {
    ensure(Array.isArray(value) && (schema.maxItems === undefined || value.length <= schema.maxItems),'Use an array within the declared size.');
    value.forEach(item => field(item,schema.items));
  } else if (schema.type === 'object') {
    ensure(plain(value),'Use an original object payload.');
    if (schema.properties) {
      exact(value,Object.keys(schema.properties),schema.required);
      for (const [key,item] of Object.entries(value)) field(item,schema.properties[key]);
    }
  }
}
export function validateUtilityEnergyArguments(name,args = {}) {
  const definition = definitions.get(name); ensure(definition,'Choose a declared Utility operation.','TOOL_NOT_FOUND');
  exact(args,Object.keys(definition.properties),definition.required);
  for (const [key,value] of Object.entries(args)) field(value,definition.properties[key]);
  return args;
}
function fileSelection(input) {
  ensure(plain(input),'Choose an original native file selection.');
  const required = {
    delivery:['kind','exportId'],workspace:['kind'],'export-file':['kind','exportId','name'],
    original:['kind','id'],changes:['kind','id'],'native-project':['kind','id'],
    publisher:['kind','publisherKind','id']
  }[input.kind];
  ensure(required,'Choose a complete original Utility file kind.');
  exact(input,required,required);
  if (input.exportId !== undefined) checked(input.exportId,SHA,'original export');
  if (input.id !== undefined) checked(input.id,input.kind === 'publisher' ? UUID : SHA,'original file selection');
  if (input.name !== undefined) relativeName(input.name);
  if (input.publisherKind !== undefined) ensure(utilityEnergyPublisherKinds.includes(input.publisherKind),'Choose an original publisher file kind.');
  return {...input};
}
function manifestIdentity(value) {
  return {schema:value.schema,workspace:value.workspace,applicationSchema:value.applicationSchema,
    bindingSha256:value.bindingSha256,revision:value.revision,revisionAfter:value.revisionAfter,source:value.source,files:value.files};
}
export function parseUtilityEnergyExport(data,exportId) {
  ensure(Buffer.isBuffer(data) && data.length <= 65000,'Use the complete original Utility delivery manifest.','UTILITY_EXPORT_INVALID');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)); }
  catch { throw fail('UTILITY_EXPORT_INVALID','The retained manifest must be complete UTF-8 JSON.'); }
  exact(value,['schema','workspace','applicationSchema','bindingSha256','revision','revisionAfter','source','files','exportId','createdAt'],
    ['schema','workspace','applicationSchema','bindingSha256','revision','revisionAfter','source','files','exportId','createdAt']);
  checked(exportId,SHA,'export SHA256'); checked(value.workspace,ALIAS,'workspace alias');
  checked(value.bindingSha256,SHA,'original source binding'); integer(value.revision); integer(value.revisionAfter);
  ensure(value.schema === UTILITY_ENERGY_EXPORT_SCHEMA && value.applicationSchema === UTILITY_ENERGY_APPLICATION_SCHEMA &&
    value.exportId === exportId && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    Array.isArray(value.files) && value.files.length === 1,'The Utility delivery has a different identity.','UTILITY_EXPORT_INVALID');
  fileSelection(value.source);
  for (const item of value.files) {
    exact(item,['name','bytes','sha256','contentType'],['name','bytes','sha256','contentType']);
    deliveryName(item.name); integer(item.bytes,0,MAX_FILE); checked(item.sha256,SHA,'complete file SHA256');
    text(item.contentType,'Original content type',256);
    ensure(![UTILITY_ENERGY_MANIFEST,'download-state'].includes(item.name),'Original data and manifest names must differ.');
  }
  ensure(sha(canonical(manifestIdentity(value))) === exportId,'The original file selection or byte identity changed.','UTILITY_EXPORT_INVALID');
  return value;
}

export class MerchantUtilityEnergyWorkspaces {
  #config; #clients = new Map(); #bindings = new Map(); #pending = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({errorPrefix:'UTILITY'});
  constructor(config) { this.#config = config; }
  get summary() {
    return {configured:Boolean(this.#config.utilityEnergyWorkspaces),ownership:'EXISTING_UTILITY_CONSOLE',
      ...this.#reads.summary,workspaces:Object.entries(this.#config.utilityEnergyWorkspaces?.workspaces ?? {}).map(([workspace,value]) => ({
        workspace,label:value.label,connection:'ORIGINAL_CONSOLE_URL_FILE',attached:this.#clients.has(workspace),
        expectedBindingSha256:value.expectedBindingSha256 ?? null,
        files:Object.entries(value.files).map(([file,input]) => ({file,kind:input.kind,name:input.name ?? null,
          label:input.label ?? null,sha256:input.sha256 ?? null})),
        captures:Object.entries(value.captures).map(([profile,input]) => ({profile,label:input.label ?? profile,sha256:input.sha256 ?? null})),
        buyerWorkspaces:Object.entries(value.buyerWorkspaces).map(([buyerWorkspace,input]) => ({buyerWorkspace,label:input.label}))
      }))};
  }
  #definition(workspace) {
    checked(workspace,ALIAS,'workspace alias');
    const value = this.#config.utilityEnergyWorkspaces?.workspaces[workspace];
    ensure(value,'The Utility workspace is not declared by this host.','UTILITY_WORKSPACE_NOT_CONFIGURED');
    return value;
  }
  async #client(workspace) {
    const definition = this.#definition(workspace);
    if (!this.#clients.has(workspace)) {
      const pending = (async () => {
        const client = await openUtilityWorkspace({connectionFile:definition.consoleUrlFile,
          expectedBindingSha256:definition.expectedBindingSha256,expectedWorkspace:definition.workspaceDirectory});
        try {
          const launch = await client.launch(), binding = canonical({
            workspace:launch.workspace,workspaceIdentity:launch.workspaceIdentity,bindingSha256:launch.bindingSha256});
          ensure(!this.#bindings.has(workspace) || this.#bindings.get(workspace) === binding,
            'The original workspace or source binding changed. Review its host declaration before reattaching.','UTILITY_BINDING_CHANGED');
          this.#bindings.set(workspace,binding); return client;
        } catch (error) { await client.close(); throw error; }
      })();
      this.#clients.set(workspace,pending);
      pending.catch(() => { if (this.#clients.get(workspace) === pending) this.#clients.delete(workspace); });
    }
    return this.#clients.get(workspace);
  }
  async #root() {
    ensure(typeof this.#config.exportsDirectory === 'string','Use the original private merchant export directory.','CONFIGURATION_ERROR');
    await privateDirectory(this.#config.exportsDirectory);
    return privateDirectory(join(this.#config.exportsDirectory,'utility-energy'),true);
  }
  async #retained(exportId) {
    checked(exportId,SHA,'export SHA256');
    const directory = await privateDirectory(join(await this.#root(),exportId));
    const manifestBytes = await bytes(join(directory,UTILITY_ENERGY_MANIFEST),65000,true);
    const manifest = parseUtilityEnergyExport(manifestBytes,exportId);
    this.#definition(manifest.workspace);
    return {directory,manifest,manifestBytes,manifestSha256:sha(manifestBytes),
      manifestFile:{name:UTILITY_ENERGY_MANIFEST,bytes:manifestBytes.length,sha256:sha(manifestBytes),contentType:'application/json'}};
  }
  async #exports(workspace) {
    if (workspace !== undefined) this.#definition(workspace);
    const root = await this.#root(), result = [];
    for (const entry of await readdir(root,{withFileTypes:true})) {
      if (!SHA.test(entry.name) || !entry.isDirectory()) continue;
      let saved;
      try { saved = await this.#retained(entry.name); }
      catch (error) { if (['ENOENT','UTILITY_WORKSPACE_NOT_CONFIGURED'].includes(error.code)) continue; throw error; }
      if (workspace === undefined || saved.manifest.workspace === workspace)
        result.push({...saved.manifest,manifestSha256:saved.manifestSha256,manifestFile:saved.manifestFile});
    }
    return result.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.exportId.localeCompare(b.exportId));
  }
  async #files(definition,selected) {
    if (selected !== undefined) checked(selected,ALIAS,'file alias');
    const result = [];
    for (const alias of selected === undefined ? Object.keys(definition.files) : [selected]) {
      const input = definition.files[alias]; ensure(input,'Choose a declared original file.');
      const actual = await identity(input.path,input.kind === 'source' ? MAX_SOURCE : MAX_FILE);
      result.push({file:alias,kind:input.kind,name:input.name ?? basename(input.path),label:input.label ?? null,
        provider:input.provider ?? 'auto',sourceKind:input.sourceKind ?? 'auto',context:input.context ?? {},
        ...actual,expectedSha256:input.sha256 ?? null,matchesConfiguredSha256:input.sha256 ? actual.sha256 === input.sha256 : null});
    }
    return result;
  }
  async #profiles(definition,selected) {
    if (selected !== undefined) checked(selected,ALIAS,'capture profile');
    const result = [];
    for (const alias of selected === undefined ? Object.keys(definition.captures) : [selected]) {
      const input = definition.captures[alias]; ensure(input,'Choose a declared original capture profile.');
      const data = await bytes(input.path,65536,true);
      const profile = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
      exact(profile,['name','token_env','meter_ids','collections','start','end'],['meter_ids','start','end']);
      if (profile.token_env !== undefined) checked(profile.token_env,/^[A-Z][A-Z0-9_]{0,127}$/,'token environment reference');
      result.push({profile:alias,label:input.label ?? alias,configuration:profile,bytes:data.length,sha256:sha(data),
        expectedSha256:input.sha256 ?? null,matchesConfiguredSha256:input.sha256 ? input.sha256 === sha(data) : null});
    }
    return result;
  }
  async #retain(workspace,client,args) {
    const source = fileSelection(args.selection), before = await client.state(), launch = await client.launch();
    if (args.expectedRevision !== undefined) ensure(before.revision === args.expectedRevision,
      'The original Utility revision changed before file preparation.','UTILITY_REVISION_CHANGED');
    const root = await this.#root(), temporary = join(root,'.native-' + randomUUID());
    try {
      let received;
      if (source.kind === 'delivery') received = await client.downloadDelivery(source.exportId,temporary);
      else if (source.kind === 'workspace') received = await client.downloadWorkspace(temporary);
      else if (source.kind === 'export-file') received = await client.downloadFile(source.exportId,source.name,temporary);
      else if (source.kind === 'original') received = await client.downloadOriginal(source.id,temporary);
      else if (source.kind === 'changes') received = await client.downloadChanges(source.id,temporary);
      else if (source.kind === 'native-project') received = await client.downloadNativeProject(source.id,temporary);
      else received = await client.downloadPublisher(source.publisherKind,source.id,temporary);
      if (args.expectedSha256 !== undefined) ensure(received.sha256 === args.expectedSha256,
        'The original file differs from the reviewed SHA256.','UTILITY_FILE_CHANGED');
      const after = await client.state();
      if (args.expectedRevision !== undefined) ensure(after.revision === args.expectedRevision,
        'The original Utility revision changed during file preparation.','UTILITY_REVISION_CHANGED');
      let name = deliveryName(received.filename);
      if ([UTILITY_ENERGY_MANIFEST,'download-state'].includes(name)) name = 'original-' + name;
      const file = {name,bytes:received.bytes,sha256:received.sha256,contentType:received.contentType};
      const original = {schema:UTILITY_ENERGY_EXPORT_SCHEMA,workspace,applicationSchema:UTILITY_ENERGY_APPLICATION_SCHEMA,
        bindingSha256:launch.bindingSha256,revision:before.revision,revisionAfter:after.revision,source,files:[file]};
      const exportId = sha(canonical(original)), directory = await privateDirectory(join(root,exportId),true);
      try { await link(temporary,join(directory,name)); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await identity(join(directory,name),MAX_FILE,true);
        ensure(existing.bytes === file.bytes && existing.sha256 === file.sha256,
          'The retained destination differs from its original file.','UTILITY_FILE_CHANGED');
      }
      await unlink(temporary); await syncDirectory(directory);
      const manifest = {...original,exportId,createdAt:new Date().toISOString()};
      const manifestBytes = Buffer.from(JSON.stringify(manifest,null,2)+'\n');
      parseUtilityEnergyExport(manifestBytes,exportId);
      await immutableRecord(join(directory,UTILITY_ENERGY_MANIFEST),manifestBytes);
      const saved = await this.#retained(exportId);
      return {state:'MANIFEST_RETAINED',workspace,exportId,manifest:saved.manifest,
        manifestFile:saved.manifestFile,manifestSha256:saved.manifestSha256};
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async #execute(name,args) {
    if (name === 'merchant_utility_workspaces') return this.summary;
    if (name === 'merchant_utility_exports') return {state:'RETAINED_EXPORTS',...page(await this.#exports(args.workspace),args)};
    if (['merchant_utility_manifest','merchant_utility_file','merchant_utility_file_release'].includes(name)) {
      const saved = await this.#retained(args.exportId);
      if (name === 'merchant_utility_manifest') return {state:'MANIFEST_RETAINED',exportId:args.exportId,
        manifest:saved.manifest,manifestFile:saved.manifestFile,manifestSha256:saved.manifestSha256};
      if (name === 'merchant_utility_file_release') {
        await this.#reads.release(args.exportId,args.readId); return {state:'RELEASED',exportId:args.exportId,readId:args.readId};
      }
      ensure(args.expectedManifestSha256 === saved.manifestSha256,'Repeat the exact retained manifest SHA256.','UTILITY_EXPORT_CHANGED');
      deliveryName(args.file);
      const file = args.file === UTILITY_ENERGY_MANIFEST ? saved.manifestFile : saved.manifest.files.find(item => item.name === args.file);
      ensure(file && file.sha256 === args.expectedSha256,'Select a declared retained file with its exact SHA256.','UTILITY_FILE_CHANGED');
      return {exportId:args.exportId,manifestSha256:saved.manifestSha256,
        ...await this.#reads.read({scope:args.exportId,key:args.file,kind:saved.manifest.source.kind,directory:saved.directory,
          expectedSha256:file.sha256,readId:args.readId,offset:args.offset,limit:args.limit,
          load:async () => {
            const {handle,info} = await regular(join(saved.directory,file.name),MAX_FILE,true);
            try {
              ensure(Number(info.size) === file.bytes,'The retained original file length changed.','UTILITY_FILE_CHANGED');
              return {readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.contentType};
            } catch (error) { await handle.close(); throw error; }
          }})};
    }
    const {workspace,...input} = args, definition = this.#definition(workspace);
    if (name === 'merchant_utility_files') return {workspace,files:await this.#files(definition,input.file)};
    if (name === 'merchant_utility_capture_profiles') return {workspace,profiles:await this.#profiles(definition,input.profile)};
    if (name === 'merchant_utility_reopen') {
      const existing = this.#clients.get(workspace);
      if (existing) { const client = await existing; await client.close(); if (this.#clients.get(workspace) === existing) this.#clients.delete(workspace); }
      const client = await this.#client(workspace);
      return {workspace,state:await client.state(),launch:await client.launch(),ownership:'EXISTING_UTILITY_CONSOLE',reattached:true};
    }
    const client = await this.#client(workspace), native = value => ({workspace,native:value});
    if (name === 'merchant_utility_status') return {workspace,state:await client.state(),launch:await client.launch(),
      retainedExports:(await this.#exports(workspace)).length,ownership:'EXISTING_UTILITY_CONSOLE',fileReads:this.#reads.summary};
    if (name === 'merchant_utility_inventory') {
      const state = await client.state();
      const items = input.kind === 'operations' ? (await client.read('/api/operations')).operations : state[input.kind];
      ensure(utilityEnergyInventoryKinds.includes(input.kind) && Array.isArray(items),'Choose an original retained inventory.');
      return native({revision:state.revision,kind:input.kind,...page(items,input)});
    }
    if (name === 'merchant_utility_inspect') {
      ensure(utilityEnergyInspectKinds.includes(input.kind),'Choose an original complete record.');
      return native(await client.read('/api/'+input.kind,{id:input.id}));
    }
    if (name === 'merchant_utility_records') return native(await client.records({...input,
      ...(input.imports === undefined ? {} : {imports:input.imports.join(',')})}));
    if (name === 'merchant_utility_series') return native(await client.series(input.imports));
    if (name === 'merchant_utility_changes') return native(await client.changes(input.id,input.offset,input.limit));
    if (name === 'merchant_utility_operation') return native(await client.operation(input.requestId));
    if (name === 'merchant_utility_publisher_state') return native(await client.publisherState());
    if (name === 'merchant_utility_file_prepare') return this.#retain(workspace,client,input);
    const options = {expectedRevision:input.expectedRevision,requestId:input.requestId};
    if (name === 'merchant_utility_ingest' || name === 'merchant_utility_restore') {
      const source = definition.files[input.file], kind = name.endsWith('restore') ? 'workspace' : 'source';
      ensure(source && source.kind === kind,'Choose a declared '+kind+' input.');
      ensure(!source.sha256 || source.sha256 === input.expectedSha256,'Repeat the host-reviewed original input SHA256.','UTILITY_FILE_CHANGED');
      return native(kind === 'workspace' ? await client.restore(source.path,{...options,expectedSha256:input.expectedSha256}) :
        await client.upload({...options,file:source.path,expectedSha256:input.expectedSha256,name:source.name,
          provider:source.provider ?? 'auto',kind:source.sourceKind ?? 'auto',context:source.context ?? {}}));
    }
    if (name === 'merchant_utility_capture_start') {
      const [profile] = await this.#profiles(definition,input.profile);
      ensure(profile.sha256 === input.expectedSha256 && (!profile.expectedSha256 || profile.expectedSha256 === profile.sha256),
        'The native capture profile changed after review.','UTILITY_FILE_CHANGED');
      return native(await client.act('capture.start',profile.configuration,options));
    }
    if (name === 'merchant_utility_buyer_session') {
      const buyer = definition.buyerWorkspaces[input.buyerWorkspace]; ensure(buyer,'Choose an original declared buyer workspace.');
      const payload = {workspaceDirectory:buyer.directory,buyerId:input.buyerId,maxPages:input.maxPages,maxTotalAtomic:input.maxTotalAtomic,
        ...(input.maxRows === undefined ? {} : {maxRows:input.maxRows}),
        ...(input.maxPageBytes === undefined ? {} : {maxPageBytes:input.maxPageBytes})};
      return native(await client.act('publisher.buyer.session',payload,options));
    }
    ensure(name === 'merchant_utility_action' && utilityEnergyActionNames.includes(input.action),'Choose an original Utility action.','TOOL_NOT_FOUND');
    return native(await client.act(input.action,input.payload,options));
  }
  async call(name,args = {}) {
    ensure(!this.#closing,'The Utility attachment is closing.','UTILITY_WORKSPACE_CLOSING');
    validateUtilityEnergyArguments(name,args);
    const task = Promise.resolve().then(() => this.#execute(name,args)); this.#pending.add(task);
    try { return await task; } finally { this.#pending.delete(task); }
  }
  close() {
    this.#closing = true;
    if (!this.#close) this.#close = (async () => {
      await Promise.allSettled([...this.#pending]);
      const results = await Promise.allSettled([
        this.#reads.close(),...[...this.#clients.values()].map(async value => { const client = await value; await client.close(); })
      ]);
      if (results.some(value => value.status === 'rejected')) throw fail('UTILITY_CLOSE_INCOMPLETE','An owned Utility read has not finished closing.');
    })().catch(error => { this.#close = null; throw error; });
    return this.#close;
  }
}
