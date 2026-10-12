// MIT. Complete Fiscal files through the maintained retained-download and portable receiver.
import { constants } from 'node:fs';
import { open, realpath, lstat, readdir, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { alias as fiscalAlias } from './catalog/fiscaldata-workspace.mjs';
import { createRetainedDownload } from './retained-download.mjs';
import { MAX_RETAINED_CHUNK_BYTES, MAX_RETAINED_IMMUTABLE_FILE_BYTES } from './retained-file-reads.mjs';

export const FISCALDATA_SELECTION_SCHEMA = 'stellar-forge.fiscaldata-download-selection.v1';
export const FISCALDATA_SELECTION_FILE = 'fiscal-selection.json';
const STATE_SCHEMA = 'stellar-forge.fiscaldata-download-checkpoint.v1';
const RESULT_SCHEMA = 'stellar-forge.fiscaldata-download.v1';
const PREFIX = 'fiscaldata_selected';
const MAX_MANIFEST = 32 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const kinds = new Set(['capture','edition','comparison','export','package']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code,message) => {throw Object.assign(new Error(message),{code:'FISCALDATA_' + code});};
const ordered = value => Array.isArray(value) ? value.map(ordered) : plain(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key,ordered(value[key])])) : value;
const encode = value => Buffer.from(JSON.stringify(ordered(value),null,2) + '\n');
const decode = bytes => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const exact = (value,keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
function identity(value) {
  if (!exact(value,['id','label']) || typeof value.id !== 'string' || !value.id ||
      typeof value.label !== 'string' || !value.label || value.id.length > 160 || value.label.length > 1000)
    fail('DOWNLOAD_OPERATOR','Retain the original named MCP operator.');
  return {id:value.id,label:value.label};
}
function canonicalSelection(value) {
  if (!exact(value,['schema','selectionId','endpoint','workspace','kind','id','reader','source','files']) ||
      value.schema !== FISCALDATA_SELECTION_SCHEMA || !kinds.has(value.kind) ||
      !exact(value.workspace,['alias','id']) || !new RegExp(fiscalAlias.pattern).test(value.workspace.alias ?? '') ||
      !UUID.test(value.workspace.id ?? '') || !(value.kind === 'package' ? SHA : UUID).test(value.id ?? ''))
    fail('DOWNLOAD_SELECTION','Use a complete original Fiscal download selection.');
  let endpoint; try {endpoint = new URL(value.endpoint);} catch {fail('DOWNLOAD_SELECTION','The retained MCP endpoint is invalid.');}
  if (endpoint.href !== value.endpoint || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1','[::1]'].includes(endpoint.hostname)))
    fail('DOWNLOAD_SELECTION','Retain the canonical original HTTPS or loopback MCP endpoint.');
  if (!plain(value.source) || value.source.id !== value.id || !SHA.test(value.source.sha256 ?? '') ||
      !Array.isArray(value.files) || !value.files.length || value.files.length > 100000)
    fail('DOWNLOAD_SELECTION','Select a sealed original record with its complete file inventory.');
  const names = new Set(); let total = 0;
  const files = value.files.map(file => {
    if (!exact(file,['name','bytes','sha256','mime']) || !NAME.test(file.name ?? '') || file.name === FISCALDATA_SELECTION_FILE ||
        file.name === 'download-state' || names.has(file.name) || !SHA.test(file.sha256 ?? '') ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_RETAINED_IMMUTABLE_FILE_BYTES ||
        typeof file.mime !== 'string' || !file.mime || file.mime.length > 240 || /[\0\r\n]/.test(file.mime))
      fail('DOWNLOAD_SELECTION','Retain distinct original filenames, exact byte counts and full SHA-256 values.');
    names.add(file.name); total += file.bytes;
    if (total > MAX_TOTAL) fail('DOWNLOAD_CAPACITY','This complete selection exceeds the explicit 32 GiB local delivery bound.');
    return {name:file.name,bytes:file.bytes,sha256:file.sha256,mime:file.mime};
  }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const base = {schema:FISCALDATA_SELECTION_SCHEMA,endpoint:value.endpoint,
    workspace:{alias:value.workspace.alias,id:value.workspace.id},kind:value.kind,id:value.id,
    reader:identity(value.reader),source:structuredClone(value.source),files};
  const selectionId = sha(encode(base));
  if (value.selectionId !== undefined && value.selectionId !== selectionId)
    fail('DOWNLOAD_SELECTION_CHANGED','The selected source, operator or original file identities changed.');
  const result = {...base,selectionId}, bytes = encode(result);
  if (bytes.length > MAX_MANIFEST) fail('DOWNLOAD_CAPACITY','The full file selection exceeds 32 MiB.');
  return result;
}
function parseSelection(bytes, exportId) {
  const result = canonicalSelection(decode(bytes));
  if (result.selectionId !== exportId || !encode(result).equals(bytes))
    fail('DOWNLOAD_SELECTION_CHANGED','The saved selection differs from its exact canonical bytes.');
  return result;
}
const receiver = createRetainedDownload({
  manifestName:FISCALDATA_SELECTION_FILE,parseManifest:parseSelection,maximumBytes:MAX_RETAINED_IMMUTABLE_FILE_BYTES,
  stateSchema:STATE_SCHEMA,resultSchema:RESULT_SCHEMA,toolPrefix:PREFIX,errorPrefix:'FISCALDATA',
  clientName:'starforge-fiscaldata-download',maximumManifestBytes:MAX_MANIFEST,maximumCheckpointBytes:64 * 1024 * 1024,
  validateExportId:value => {if (!SHA.test(value ?? '')) fail('DOWNLOAD_SELECTION','Use the full original selection ID.');},
  describe:value => ({kind:value.kind,id:value.id,workspace:value.workspace,sourceSha256:value.source.sha256})
});
function sourceSummary(item, kind, id) {
  const source = {id,sha256:item.sha256,status:item.status};
  for (const key of ['revision','createdAt','name','sourceId','sourceSha256','captureId','captureSha256','leftEditionId','rightEditionId'])
    if (item[key] !== undefined) source[key] = structuredClone(item[key]);
  if (kind === 'export') source.exportKind = item.kind;
  return source;
}

/** Selects complete original files; this creates no export, capture, checkpoint or payment. */
export async function selectFiscalDownload({client,kind,id,expectedSha256,signal} = {}) {
  if (!client || typeof client.status !== 'function' || !kinds.has(kind))
    fail('DOWNLOAD_CONFIGURATION','Use the original Fiscal client and a supported retained record kind.');
  let item,workspaceId,operator,source;
  const options = {signal};
  if (kind === 'package') {
    const found = await client.package(id,options);
    ({item,workspaceId,operator} = found);
    const compressed = item.files?.find(file => file.name === 'workspace.fiscal.gz');
    if (!compressed || item.files.length !== 2 || !item.files.some(file => file.name === 'manifest.json'))
      fail('DOWNLOAD_SELECTION','The sealed portable package must retain both original outer files.');
    source = {id,sha256:compressed.sha256,status:'COMPLETE',createdAt:item.createdAt,
      operationId:item.operationId,workspace:structuredClone(item.workspace)};
  } else {
    const state = await client.assertOpen(options);
    workspaceId = state.workspaceId; operator = state.operator;
    if (kind === 'export') item = (await client.find('exports',id,options)).item;
    else item = await client.value(({capture:'captures',edition:'editions',comparison:'comparisons'}[kind]) + '.get',
      {id,...(kind === 'comparison' ? {offset:0,limit:1} : {})},{...options,offset:0,limit:1});
    if (item.id !== id || item.status !== (kind === 'capture' ? 'COMPLETE' : 'READY') || !SHA.test(item.sha256 ?? ''))
      fail('DOWNLOAD_NOT_READY','Complete the selected original record before downloading its sealed files.');
    source = sourceSummary(item,kind,id);
  }
  if (expectedSha256 !== undefined && expectedSha256 !== source.sha256)
    fail('DOWNLOAD_SOURCE_CHANGED','The original record differs from the reviewed source SHA-256.');
  if (!Array.isArray(item.files)) fail('DOWNLOAD_SELECTION','The original record has no complete file inventory.');
  const selection = canonicalSelection({schema:FISCALDATA_SELECTION_SCHEMA,endpoint:client.endpoint,
    workspace:{alias:client.workspace,id:workspaceId},kind,id,reader:operator,source,
    files:item.files.map(file => ({name:file.name,bytes:file.size,sha256:file.sha256,mime:file.mime}))});
  return {selection,selectionSha256:sha(encode(selection))};
}
function virtualClient(client, selection, signal) {
  const manifestBytes = encode(selection), manifestSha256 = sha(manifestBytes), localReads = new Map(), localIds = new Set();
  const fileMap = new Map(selection.files.map(file => [file.name,file]));
  const metadata = {name:FISCALDATA_SELECTION_FILE,bytes:manifestBytes.length,sha256:manifestSha256};
  function localChunk(args) {
    if (args.expectedSha256 !== manifestSha256) fail('DOWNLOAD_SELECTION_CHANGED','The selected manifest SHA-256 changed.');
    const offset = args.offset ?? 0, limit = args.limit ?? MAX_RETAINED_CHUNK_BYTES;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= manifestBytes.length ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RETAINED_CHUNK_BYTES)
      fail('DOWNLOAD_CHUNK_CONFLICT','Select the original manifest byte offset and bounded chunk length.');
    const readId = args.readId ?? randomUUID();
    if (args.readId && !localReads.has(readId)) fail('READ_NOT_FOUND','Reopen this exact selection manifest at its retained offset.');
    localIds.add(readId); localReads.set(readId,true);
    const bytes = manifestBytes.subarray(offset,Math.min(offset + limit,manifestBytes.length));
    const nextOffset = offset + bytes.length < manifestBytes.length ? offset + bytes.length : null;
    if (nextOffset === null) localReads.delete(readId);
    return {exportId:selection.selectionId,manifestSha256,readId,file:metadata,offset,
      bytesRead:bytes.length,nextOffset,encoding:'base64',data:bytes.toString('base64')};
  }
  return {endpoint:client.endpoint,async call(name,args,options = {}) {
    if (args.exportId !== selection.selectionId) fail('DOWNLOAD_SELECTION_CHANGED','This request selects another download.');
    if (name === PREFIX + '_manifest') return {state:'MANIFEST_RETAINED',exportId:selection.selectionId,manifestFile:metadata};
    if (name === PREFIX + '_file_release') {
      if (localIds.has(args.readId)) {localReads.delete(args.readId); return {released:true,readId:args.readId};}
      return client.releaseFile(args.readId,options);
    }
    if (name !== PREFIX + '_file' || args.expectedManifestSha256 !== manifestSha256)
      fail('DOWNLOAD_SELECTION_CHANGED','Use the original complete selection manifest.');
    if (args.file === FISCALDATA_SELECTION_FILE) return localChunk(args);
    const file = fileMap.get(args.file);
    if (!file || args.expectedSha256 !== file.sha256) fail('DOWNLOAD_SELECTION_CHANGED','The original file selection changed.');
    const result = await client.file({kind:selection.kind,id:selection.id,filename:file.name,expectedSha256:file.sha256,
      offset:args.offset,limit:args.limit,...(args.readId ? {readId:args.readId} : {})},
      {...options,...(Object.hasOwn(options,'requestSignal') ? {} : {signal})});
    return {...result,exportId:selection.selectionId,manifestSha256};
  }};
}

/** Full, resumable reception. The original helper owns partial bytes, leases and atomic publication. */
export async function downloadFiscalSelection({client,selection,directory,expectedSelectionSha256,signal,chunkSize,onProgress} = {}) {
  selection = canonicalSelection(selection);
  const selectionSha256 = sha(encode(selection));
  if (expectedSelectionSha256 !== undefined && expectedSelectionSha256 !== selectionSha256)
    fail('DOWNLOAD_SELECTION_CHANGED','The reviewed selection manifest changed.');
  if (client.endpoint !== selection.endpoint || client.workspace !== selection.workspace.alias)
    fail('DOWNLOAD_SELECTION_CHANGED','Resume through the same canonical MCP endpoint and workspace alias.');
  const current = await selectFiscalDownload({client,kind:selection.kind,id:selection.id,
    expectedSha256:selection.source.sha256,signal});
  if (current.selectionSha256 !== selectionSha256)
    fail('DOWNLOAD_SELECTION_CHANGED','The original workspace, named reader or selected file manifest changed. Keep the prior download.');
  return receiver.download({client:virtualClient(client,selection,signal),exportId:selection.selectionId,directory,
    expectedManifestSha256:selectionSha256,signal,chunkSize,onProgress});
}
async function privateBytes(path, maximum = MAX_MANIFEST) {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path)
    fail('DOWNLOAD_PRIVATE_FILE_REQUIRED','Use the canonical absolute original selection file.');
  const handle = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({bigint:true});
    if (!before.isFile() || before.size > BigInt(maximum) || process.platform !== 'win32' &&
        (before.mode & 0o077n || process.getuid && before.uid !== BigInt(process.getuid())))
      fail('DOWNLOAD_PRIVATE_FILE_REQUIRED','Keep the original receiving file private, regular and within its declared size.');
    const bytes = await handle.readFile(), after = await handle.stat({bigint:true});
    if (bytes.length !== Number(before.size) || ['dev','ino','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key]))
      fail('DOWNLOAD_FILE_CHANGED','The selected file changed during readback.');
    return bytes;
  } finally {await handle.close();}
}
export async function readFiscalSelection(path) {
  const bytes = await privateBytes(path), parsed = decode(bytes);
  const selection = canonicalSelection(parsed.selection ?? parsed);
  if (!encode(selection).equals(parsed.selection ? encode(parsed.selection) : bytes))
    fail('DOWNLOAD_SELECTION_CHANGED','Use the exact canonical selection written by this client.');
  const selectionSha256=sha(encode(selection));
  if (parsed.selection && parsed.selectionSha256 !== undefined && parsed.selectionSha256 !== selectionSha256)
    fail('DOWNLOAD_SELECTION_CHANGED','The saved selection digest differs from its exact canonical bytes.');
  return {selection,selectionSha256};
}
/** New selection metadata is published only after complete private write, readback and fsync. */
export async function writeFiscalSelection(path, selection) {
  selection = canonicalSelection(selection); const bytes = encode(selection);
  if (!isAbsolute(path) || resolve(path) !== path) fail('DOWNLOAD_CONFIGURATION','Choose an absolute selection filename.');
  const parent = dirname(path);
  if (await realpath(parent) !== parent) fail('DOWNLOAD_PRIVATE_FILE_REQUIRED','Use the canonical private selection directory.');
  const info = await lstat(parent);
  if (!info.isDirectory() || process.platform !== 'win32' && info.mode & 0o077)
    fail('DOWNLOAD_PRIVATE_FILE_REQUIRED','Use a private 0700 selection directory.');
  const temporary = join(parent,'.fiscal-selection-' + randomUUID() + '.partial');
  const handle = await open(temporary,'wx',0o600);
  try {await handle.writeFile(bytes); await handle.sync();}
  finally {await handle.close();}
  if (!(await privateBytes(temporary)).equals(bytes)) fail('DOWNLOAD_FILE_CHANGED','The staged selection differs from its intended bytes.');
  try {
    try {await link(temporary,path);}
    catch (error) {if (error.code !== 'EEXIST' || !(await privateBytes(path)).equals(bytes)) throw error;}
    const directory = await open(parent,constants.O_RDONLY);
    try {await directory.sync();} finally {await directory.close();}
  } finally {await unlink(temporary);}
  return {path,bytes:bytes.length,sha256:sha(bytes),selectionId:selection.selectionId};
}
/** Checks every original file under the same maintained local download lease. */
export async function verifyFiscalDownload({directory,expectedSelectionSha256} = {}) {
  directory = resolve(directory);
  const manifestBytes = await privateBytes(join(directory,FISCALDATA_SELECTION_FILE));
  const selection = canonicalSelection(decode(manifestBytes)), selectionSha256 = sha(manifestBytes);
  if (!encode(selection).equals(manifestBytes) || expectedSelectionSha256 !== undefined && expectedSelectionSha256 !== selectionSha256)
    fail('DOWNLOAD_SELECTION_CHANGED','The retained complete selection differs from its reviewed original.');
  return receiver.lockedDownload(directory,async context => {
    const allowed = new Set(['download-state',FISCALDATA_SELECTION_FILE,...selection.files.map(file => file.name)]);
    if ((await readdir(context.root)).some(name => !allowed.has(name))) fail('DOWNLOAD_DIRECTORY_IN_USE','This directory contains files outside the selected original delivery.');
    if (!(await privateBytes(join(context.root,FISCALDATA_SELECTION_FILE))).equals(manifestBytes))
      fail('DOWNLOAD_SELECTION_CHANGED','The selected manifest changed before its receiving lease.');
    for (const file of selection.files) await receiver.verifiedFile(join(context.root,file.name),file);
    return {schema:'stellar-forge.fiscaldata-download-verification.v1',state:'VERIFIED',directory:context.root,
      selection,selectionSha256,files:selection.files.length,bytes:selection.files.reduce((sum,file) => sum + file.bytes,0)};
  });
}
/** Uses the original portable parser and receiver; no archive extraction or replacement workspace engine. */
export async function receiveFiscalDownload({directory,destination,operationId,actor,expectedSelectionSha256,expectedWorkspaceId} = {}) {
  const checked = await verifyFiscalDownload({directory,expectedSelectionSha256}), {selection} = checked;
  if (selection.kind !== 'package') fail('DOWNLOAD_PACKAGE_REQUIRED','Choose a complete portable workspace package.');
  if (expectedWorkspaceId !== undefined && selection.workspace.id !== expectedWorkspaceId)
    fail('DOWNLOAD_WORKSPACE_CHANGED','This package belongs to another original workspace.');
  const packageFile = selection.files.find(file => file.name === 'workspace.fiscal.gz');
  if (!packageFile) fail('DOWNLOAD_PACKAGE_REQUIRED','The complete portable payload is missing.');
  const {inspectFiscalSourcePackage,receiveFiscalSourcePackage} =
    await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/portable.mjs');
  const packagePath = join(checked.directory,packageFile.name);
  const inspected = await inspectFiscalSourcePackage({packagePath,expectedSha256:packageFile.sha256});
  const originalManifest = decode(await privateBytes(join(checked.directory,'manifest.json')));
  if (inspected.manifest.workspace.id !== selection.workspace.id ||
      !encode(inspected.manifest).equals(encode(originalManifest)))
    fail('DOWNLOAD_PACKAGE_CHANGED','The original inner and outer workspace manifests differ.');
  const receiving = await receiveFiscalSourcePackage({directory:destination,packagePath,expectedSha256:packageFile.sha256,operationId,actor});
  return {schema:'stellar-forge.fiscaldata-remote-receiving.v1',state:'RECEIVED',selectionId:selection.selectionId,
    selectionSha256:checked.selectionSha256,packageSha256:packageFile.sha256,receiving};
}
/** Reopens an actual received source under the original model's identity-bound kernel lease, then closes it. */
export async function inspectReceivedFiscalWorkspace({directory,expectedWorkspaceId} = {}) {
  if (!isAbsolute(directory) || resolve(directory) !== directory || !UUID.test(expectedWorkspaceId ?? ''))
    fail('DOWNLOAD_CONFIGURATION','Select the canonical received directory and original workspace UUID.');
  const header = decode(await privateBytes(join(directory,'workspace.json'),1024 * 1024));
  if (header.id !== expectedWorkspaceId) fail('DOWNLOAD_WORKSPACE_CHANGED','This directory names another original workspace.');
  const stat = await lstat(directory,{bigint:true});
  const {openFiscalWorkspace} = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/workspace-model.mjs');
  const model = await openFiscalWorkspace({directory,expectedWorkspace:{id:header.id,createdAt:header.createdAt,
    directoryIdentity:{dev:String(stat.dev),ino:String(stat.ino)}}});
  try {return {workspaceId:header.id,snapshot:await model.snapshot()};}
  finally {await model.close();}
}
