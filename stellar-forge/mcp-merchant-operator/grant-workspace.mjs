import {grantWorkspaceTools} from './catalog/grant-workspace.mjs';
export {grantWorkspaceTools} from './catalog/grant-workspace.mjs';
import {GRANT_TRANSFER_CHUNK_BYTES as CHUNK} from '../../stellar/scf_2026/sf47_budget_model/workspace/agent-contracts.mjs';
// MIT. Merchant MCP tools for the original SF47 grant planning and delivery service.
import { mkdir, open, link, unlink, readdir, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { failure, identifier, exact, plain, line, privateSupportDirectory } from './host-files.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { GrantWorkspaceClient, inspectGrantAgentBinding, readGrantAgentFile,
  GRANT_MAX_BUNDLE_BYTES, GRANT_MAX_SOURCE_BYTES } from '../../stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs';

export const GRANT_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.sf47-workspace-connection.v1';
const SNAPSHOT = 'stellar-forge.sf47-agent-snapshot.v1', TRANSFER = 'stellar-forge.sf47-agent-input.v1';
const MAX_JSON = 64 * 1024 * 1024, PAGE_BYTES = 48000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value) + '\n');
const need = (test, code, message, details = {}) => {
  if (!test) throw Object.assign(failure(code, message), details);
};
const hpath = (value, base) => {
  need(typeof value === 'string' && value && !value.includes('\0'), 'GRANT_CONFIGURATION_ERROR',
    'Use a declared original host path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
};
const sha = value => {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'GRANT_INVALID_INPUT', 'Use the exact SHA256.'); return value;
};
const name = value => {
  need(typeof value === 'string' && value.length >= 1 && value.length <= 240 &&
    !/[\x00-\x1f\x7f\\/]/.test(value) && !['.', '..'].includes(value), 'GRANT_INVALID_INPUT',
  'Use a plain original filename without directory components.'); return value;
};
const boundedText = (value, label, maximum) => {
  need(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum &&
    !/[\x00-\x1f\x7f]/.test(value), 'GRANT_INVALID_INPUT', label + ' must be bounded text without control characters.');
  return value;
};
const decode = bytes => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
const uint = (value, label, max, minimum = 0) => {
  need(Number.isSafeInteger(value) && value >= minimum && value <= max, 'GRANT_INVALID_INPUT',
    label + ' is outside its declared integer bound.'); return value;
};
const snapshotId = value => {
  need(typeof value === 'string' && /^snapshot-[a-f0-9-]{36}$/.test(value), 'GRANT_SNAPSHOT_INVALID',
    'Use the retained snapshot ID returned by the original read.'); return value;
};
const transferId = value => {
  need(typeof value === 'string' && /^input-[a-f0-9]{64}$/.test(value), 'GRANT_TRANSFER_INVALID',
    'Use the retained input transfer ID.'); return value;
};
async function syncDirectory(directory) {
  const fd = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await fd.sync(); } finally { await fd.close(); }
}
async function immutable(filename, bytes) {
  const temporary = join(dirname(filename), '.new-' + randomUUID());
  const fd = await open(temporary, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  try {
    try { await link(temporary, filename); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = await readGrantAgentFile(filename, Math.max(bytes.length, MAX_JSON));
      need(old.equals(bytes), 'GRANT_RETAINED_CONFLICT', 'This retained identity already belongs to different original bytes.');
    }
    await syncDirectory(dirname(filename));
  } finally { await unlink(temporary).catch(() => {}); }
}
async function directory(filename) {
  await mkdir(filename, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await privateSupportDirectory(filename);
  need(await realpath(filename) === filename, 'GRANT_PRIVATE_DIRECTORY_REQUIRED', 'Use an original private directory without symlink traversal.');
  return filename;
}

/** Connection aliases are host input; tools never choose paths or executables. */
export async function readGrantWorkspaceConfiguration(filename) {
  filename = resolve(filename);
  const input = decode(await readGrantAgentFile(filename, 1024 * 1024, true)), base = dirname(filename);
  exact(input, ['schema', 'workspaces'], ['schema', 'workspaces']);
  need(input.schema === GRANT_WORKSPACE_CONNECTION_SCHEMA && plain(input.workspaces) &&
    Object.keys(input.workspaces).length >= 1 && Object.keys(input.workspaces).length <= 32,
  'GRANT_CONFIGURATION_ERROR', 'Declare one through 32 named original grant workspaces.');
  const workspaces = Object.create(null), selected = new Set();
  for (const [alias, item] of Object.entries(input.workspaces)) {
    identifier(alias, 'Grant workspace alias');
    exact(item, ['label', 'directory', 'scenarioFile', 'pythonExecutable', 'allowStart', 'inputs'], ['directory']);
    const binding = await inspectGrantAgentBinding({directory:hpath(item.directory, base), label:item.label ?? alias,
      ...(item.scenarioFile === undefined ? {} : {scenarioFile:hpath(item.scenarioFile, base)}),
      ...(item.pythonExecutable === undefined ? {} : {pythonExecutable:hpath(item.pythonExecutable, base)}),
      ...(item.allowStart === undefined ? {} : {allowStart:item.allowStart})});
    need(!selected.has(binding.directory), 'GRANT_CONFIGURATION_ERROR', 'Give each original grant directory one host alias.');
    selected.add(binding.directory);
    const files = item.inputs ?? {};
    need(plain(files) && Object.keys(files).length <= 64, 'GRANT_CONFIGURATION_ERROR', 'Declare up to 64 original input-file aliases.');
    const inputs = Object.create(null);
    for (const [inputAlias, file] of Object.entries(files)) {
      identifier(inputAlias, 'Grant input alias');
      exact(file, ['file', 'sha256', 'kind', 'label', 'mediaType'], ['file']);
      const filename = hpath(file.file, base), stat = await lstat(filename);
      need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= GRANT_MAX_BUNDLE_BYTES &&
        await realpath(filename) === filename, 'GRANT_CONFIGURATION_ERROR', 'Declare a complete regular input file up to 32 MiB.');
      if (file.sha256 !== undefined) sha(file.sha256);
      inputs[inputAlias] = {file:filename, label:line(file.label ?? inputAlias),
        kind:boundedText(file.kind ?? 'original', 'Input kind', 80),
        mediaType:boundedText(file.mediaType ?? 'application/octet-stream', 'Input MIME type', 200),
        ...(file.sha256 ? {sha256:file.sha256} : {})};
    }
    workspaces[alias] = {...binding, inputs};
  }
  return {schema:GRANT_WORKSPACE_CONNECTION_SCHEMA, workspaces};
}


function pointer(value, selected = '') {
  need(typeof selected === 'string' && selected.length <= 4000 && (selected === '' || selected.startsWith('/')),
    'GRANT_POINTER_INVALID', 'Use an original JSON pointer, with ~0 for tilde and ~1 for slash.');
  if (!selected) return value;
  for (const bit of selected.slice(1).split('/')) {
    need(!/~(?![01])/u.test(bit), 'GRANT_POINTER_INVALID', 'Use valid JSON pointer escapes.');
    const key = bit.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(value)) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length,
      'GRANT_POINTER_NOT_FOUND', 'Use an original zero-based array index.');
    need(value !== null && typeof value === 'object' && Object.hasOwn(value, key),
      'GRANT_POINTER_NOT_FOUND', 'The selected pointer is not in this exact original response.');
    value = value[key];
  }
  return value;
}
const escaped = value => value.replace(/~/g, '~0').replace(/\//g, '~1');
function presentation(value, base = '') {
  let budget = 16000;
  const arrays = [];
  function visit(item, at, depth) {
    if (Array.isArray(item)) {
      arrays.push({pointer:at, count:item.length});
      return {$originalArray:at, count:item.length};
    }
    if (!plain(item)) {
      const size = Buffer.byteLength(JSON.stringify(item));
      if (size <= budget) { budget -= size; return item; }
      return {$originalValue:at, bytes:size, type:typeof item};
    }
    const reference = () => ({$originalValue:at, type:'object',
      availableKeys:Object.keys(item).slice(0,40), additionalKeys:Math.max(0,Object.keys(item).length - 40)});
    if (depth >= 8 || budget <= 0) return reference();
    const result = {};
    for (const [key, child] of Object.entries(item)) {
      if (budget <= 0) return reference();
      budget -= Buffer.byteLength(key) + 8;
      Object.defineProperty(result, key, {value:visit(child, at + '/' + escaped(key), depth + 1), enumerable:true});
    }
    return result;
  }
  return {value:visit(value, base, 0), arrays};
}

export class MerchantGrantWorkspaces {
  #config; #clients = new Map(); #readers = new RetainedFileReads({errorPrefix:'GRANT'});
  #closing = false; #close; #pending = new Set();
  constructor(config) { this.#config = config; }
  get summary() { return {configured:Boolean(this.#config.grantWorkspaces),
    workspaces:Object.keys(this.#config.grantWorkspaces?.workspaces ?? {}),
    clients:[...this.#clients].map(([workspace, client]) => ({workspace, ...client.summary})), ...this.#readers.summary}; }
  #binding(alias) {
    identifier(alias, 'Grant workspace alias');
    const binding = this.#config.grantWorkspaces?.workspaces?.[alias];
    need(binding, 'GRANT_WORKSPACE_NOT_CONFIGURED', 'Choose a host-declared original grant workspace alias.');
    return binding;
  }
  #client(alias) {
    const binding = this.#binding(alias);
    if (!this.#clients.has(alias)) this.#clients.set(alias, new GrantWorkspaceClient(binding));
    return this.#clients.get(alias);
  }
  async #root(alias) {
    this.#binding(alias);
    const root = await directory(join(this.#config.exportsDirectory, 'grant-workspaces'));
    return directory(join(root, alias));
  }
  async #snapshot(alias, original, selection) {
    const digest = hash(original.bytes);
    const id = 'snapshot-' + randomUUID(), mediaType = original.mediaType ?? 'application/octet-stream';
    const retained = {schema:SNAPSHOT, id, workspace:alias, createdAt:new Date().toISOString(), selection,
      source:original.source, file:{name:original.filename ?? (original.value === undefined ? 'original-export.bin' : 'original-response.json'),
        sha256:digest, bytes:original.bytes.length, contentType:mediaType}};
    try {
      const root = await this.#root(alias), files = await directory(join(root, 'files')),
        snapshots = await directory(join(root, 'snapshots'));
      await immutable(join(files, digest), original.bytes);
      await immutable(join(snapshots, id + '.json'), json(retained));
    } catch (error) {
      // The original HTTP response is already known. A full local disk must not
      // relabel a committed native request as an unknown or rejected operation.
      return {...retained, id:null, originalStatus:original.status, ...(original.value === undefined ? {} : presentation(original.value)),
        retention:{state:'FAILED', code:error.code ?? 'GRANT_RETENTION_FAILED',
          recovery:selection.requestId
            ? 'Original request ' + selection.requestId + ' returned successfully. Restore local storage and repeat the identical native request ID and payload to retain its original saved result.'
            : 'Restore local storage and repeat this original read or export to retain the complete bytes.'}};
    }
    return {...retained, retention:{state:'COMPLETE'}, ...(original.value === undefined ? {} : presentation(original.value)),
      fileRead:{tool:'merchant_grant_file_read', workspace:alias, snapshotId:id, expectedSha256:digest}};
  }
  async #loadSnapshot(alias, selected, expected) {
    const root = await this.#root(alias), meta = decode(await readGrantAgentFile(join(root, 'snapshots', snapshotId(selected) + '.json'), 65536));
    need(meta.schema === SNAPSHOT && meta.workspace === alias && meta.id === selected &&
      sha(meta.file?.sha256) === sha(expected), 'GRANT_SNAPSHOT_CONFLICT', 'Use the original workspace, snapshot and file SHA together.');
    const bytes = await readGrantAgentFile(join(root, 'files', meta.file.sha256), MAX_JSON);
    need(bytes.length === meta.file.bytes && hash(bytes) === meta.file.sha256, 'GRANT_SNAPSHOT_CHANGED', 'The retained original file differs from its manifest.');
    return {meta, bytes, directory:root};
  }
  async #input(alias, selection, expected) {
    exact(selection, ['hostInput', 'snapshotId', 'transferId', 'sourceWorkspace']);
    need(['hostInput','snapshotId','transferId'].filter(key => selection[key] !== undefined).length === 1,
      'GRANT_INPUT_SELECTION_INVALID', 'Choose one host input, retained snapshot or completed transfer.');
    const source = selection.sourceWorkspace ?? alias, binding = this.#binding(source);
    let bytes, metadata;
    if (selection.hostInput !== undefined) {
      identifier(selection.hostInput, 'Grant input alias');
      const input = binding.inputs[selection.hostInput];
      need(input, 'GRANT_INPUT_NOT_CONFIGURED', 'Choose a declared original input alias.');
      bytes = await readGrantAgentFile(input.file, GRANT_MAX_BUNDLE_BYTES);
      if (input.sha256) need(hash(bytes) === input.sha256, 'GRANT_INPUT_CHANGED', 'The declared original input hash changed.');
      metadata = {name:input.file.split(/[\\/]/).at(-1), sha256:hash(bytes), bytes:bytes.length, contentType:input.mediaType};
    } else if (selection.snapshotId !== undefined) {
      const original = await this.#loadSnapshot(source, selection.snapshotId, expected);
      bytes = original.bytes; metadata = original.meta.file;
    } else {
      const transfer = await this.#transfer(source, selection.transferId);
      const result = await this.#committed(transfer);
      need(result, 'GRANT_TRANSFER_INCOMPLETE', 'Commit and verify the complete original input before native import.');
      bytes = await readGrantAgentFile(join(transfer.root, 'complete'), GRANT_MAX_BUNDLE_BYTES);
      metadata = result;
    }
    need(hash(bytes) === sha(expected) && bytes.length === metadata.bytes, 'GRANT_INPUT_CHANGED',
      'The selected input differs from the exact reviewed SHA256 or byte count.');
    return {bytes, metadata, sourceWorkspace:source};
  }
  async #modelInputs(alias, args, label) {
    need((args.inputs !== undefined) !== (args.input !== undefined), 'GRANT_INPUT_SELECTION_INVALID',
      'Supply original ' + label.toLowerCase() + ' inputs inline or one verified input reference.');
    if (args.inputs !== undefined) {
      need(plain(args.inputs) && args.expectedInputSha256 === undefined && args.inputPointer === undefined,
        'GRANT_INVALID_INPUT', 'Inline ' + label.toLowerCase() + ' inputs are one native JSON object.');
      return args.inputs;
    }
    const original = await this.#input(alias, args.input, args.expectedInputSha256);
    // Verify the entire retained file before selecting its explicitly requested original object.
    const inputs = pointer(decode(original.bytes), args.inputPointer ?? '');
    need(plain(inputs), 'GRANT_INVALID_INPUT',
      label + ' input must select its original JSON object. Use inputPointer for an original response wrapper.');
    const selectedBytes = args.inputPointer ? Buffer.byteLength(JSON.stringify(inputs)) : original.bytes.length;
    need(selectedBytes <= GRANT_MAX_SOURCE_BYTES, 'GRANT_INPUT_TOO_LARGE',
      label + ' input JSON fits the native 8 MiB source bound.');
    return inputs;
  }
  async #transfer(alias, selected) {
    const root = join(await this.#root(alias), 'inputs', transferId(selected));
    const manifest = decode(await readGrantAgentFile(join(root, 'manifest.json'), 32768));
    need(manifest.schema === TRANSFER && manifest.id === selected && manifest.workspace === alias,
      'GRANT_TRANSFER_CONFLICT', 'Keep the original workspace and transfer together.');
    return {root, manifest};
  }
  async #committed(transfer) {
    try {
      const result = decode(await readGrantAgentFile(join(transfer.root, 'completed.json'), 32768));
      need(result.sha256 === transfer.manifest.sha256 && result.bytes === transfer.manifest.bytes,
        'GRANT_TRANSFER_CONFLICT', 'The completed input differs from its original declaration.');
      return result;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async #transferStatus(transfer) {
    const result = await this.#committed(transfer);
    if (result) return {transferId:transfer.manifest.id, state:'COMPLETE', file:result, missingOffsets:[], chunkBytes:CHUNK};
    const present = new Set(await readdir(transfer.root)), missingOffsets = [];
    for (let offset = 0; offset < transfer.manifest.bytes; offset += CHUNK)
      if (!present.has('part-' + offset)) missingOffsets.push(offset);
    return {transferId:transfer.manifest.id, state:missingOffsets.length ? 'RECEIVING' : 'READY_TO_COMMIT',
      file:{name:transfer.manifest.filename, bytes:transfer.manifest.bytes, sha256:transfer.manifest.sha256,
        contentType:transfer.manifest.mediaType}, missingOffsets, chunkBytes:CHUNK};
  }
  async #receiveBegin(alias, args) {
    name(args.filename); sha(args.sha256); uint(args.bytes, 'Input length', GRANT_MAX_BUNDLE_BYTES);
    if (args.mediaType !== undefined) boundedText(args.mediaType, 'Input MIME type', 200);
    need(typeof args.requestId === 'string' && args.requestId.length >= 1 && args.requestId.length <= 180,
      'GRANT_INVALID_INPUT', 'Retain the original transfer request ID.');
    const id = 'input-' + hash(Buffer.from(alias + '\0' + args.requestId));
    const parent = await directory(join(await this.#root(alias), 'inputs')), root = await directory(join(parent, id));
    const manifest = {schema:TRANSFER, id, workspace:alias, requestId:args.requestId, filename:args.filename,
      bytes:args.bytes, sha256:args.sha256, mediaType:args.mediaType ?? 'application/octet-stream', chunkBytes:CHUNK};
    await immutable(join(root, 'manifest.json'), json(manifest));
    return this.#transferStatus({root, manifest});
  }
  async #receiveChunk(alias, args) {
    const transfer = await this.#transfer(alias, args.transferId), total = transfer.manifest.bytes;
    const offset = uint(args.offset, 'Original part offset', total), count = Math.min(CHUNK, total - offset);
    need(offset % CHUNK === 0 && count > 0 && typeof args.data === 'string' && args.data.length <= Math.ceil(CHUNK / 3) * 4 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.data),
    'GRANT_PART_INVALID', 'Send the declared fixed part offset and complete canonical base64 bytes.');
    const bytes = Buffer.from(args.data, 'base64');
    need(bytes.length === count && bytes.toString('base64') === args.data, 'GRANT_PART_INVALID', 'The part has another original byte count.');
    if (await this.#committed(transfer)) {
      const fd = await open(join(transfer.root, 'complete'), constants.O_RDONLY | constants.O_NOFOLLOW), original = Buffer.alloc(count);
      try {
        const read = await fd.read(original, 0, count, offset);
        need(read.bytesRead === count && original.equals(bytes), 'GRANT_RETAINED_CONFLICT', 'This completed part has different original bytes.');
      } finally { await fd.close(); }
    } else await immutable(join(transfer.root, 'part-' + offset), bytes);
    return {transferId:args.transferId, offset, bytes:count, nextOffset:offset + count < total ? offset + count : null,
      ...await this.#transferStatus(transfer)};
  }
  async #receiveCommit(alias, selected) {
    const transfer = await this.#transfer(alias, selected), status = await this.#transferStatus(transfer);
    if (status.state === 'COMPLETE') return status;
    need(!status.missingOffsets.length, 'GRANT_TRANSFER_INCOMPLETE', 'Receive each missing original offset before committing.',
      {missingOffsets:status.missingOffsets});
    const temporary = join(transfer.root, '.complete-' + randomUUID()), fd = await open(temporary, 'wx', 0o600);
    const digest = createHash('sha256'); let size = 0;
    try {
      for (let offset = 0; offset < transfer.manifest.bytes; offset += CHUNK) {
        const bytes = await readGrantAgentFile(join(transfer.root, 'part-' + offset), CHUNK);
        need(bytes.length === Math.min(CHUNK, transfer.manifest.bytes - offset), 'GRANT_PART_CHANGED', 'An original part changed before commit.');
        digest.update(bytes); size += bytes.length; await fd.writeFile(bytes);
      }
      need(size === transfer.manifest.bytes && digest.digest('hex') === transfer.manifest.sha256,
        'GRANT_INPUT_CHANGED', 'The assembled bytes differ from the original whole-file SHA256.');
      await fd.sync();
    } catch (error) { await fd.close(); await unlink(temporary).catch(() => {}); throw error; }
    await fd.close();
    try {
      try { await link(temporary, join(transfer.root, 'complete')); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await readGrantAgentFile(join(transfer.root, 'complete'), GRANT_MAX_BUNDLE_BYTES);
        need(existing.length === size && hash(existing) === transfer.manifest.sha256, 'GRANT_RETAINED_CONFLICT',
          'The completed input differs from this original transfer.');
      }
      const file = {name:transfer.manifest.filename, bytes:size, sha256:transfer.manifest.sha256,
        contentType:transfer.manifest.mediaType};
      await immutable(join(transfer.root, 'completed.json'), json(file));
      for (let offset = 0; offset < size; offset += CHUNK) await unlink(join(transfer.root, 'part-' + offset)).catch(() => {});
      return {transferId:selected, state:'COMPLETE', file, missingOffsets:[], chunkBytes:CHUNK};
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async #execute(name, args) {
    const definition = grantWorkspaceTools.find(tool => tool.name === name);
    need(definition, 'GRANT_TOOL_UNKNOWN', 'Choose an original grant tool.');
    exact(args, Object.keys(definition.inputSchema.properties), definition.inputSchema.required);
    const verb = name.slice('merchant_grant_'.length), alias = args.workspace;
    if (verb === 'workspaces') return {schema:GRANT_WORKSPACE_CONNECTION_SCHEMA,
      workspaces:Object.entries(this.#config.grantWorkspaces?.workspaces ?? {}).map(([workspace, value]) =>
        ({workspace, label:value.label, selectionSha256:value.selectionSha256, allowStart:value.allowStart,
          inputs:Object.keys(value.inputs)}))};
    const binding = this.#binding(alias);
    if (verb === 'receive_begin') return this.#receiveBegin(alias, args);
    if (verb === 'receive_chunk') return this.#receiveChunk(alias, args);
    if (verb === 'receive_status') return this.#transferStatus(await this.#transfer(alias, args.transferId));
    if (verb === 'receive_commit') return this.#receiveCommit(alias, args.transferId);
    if (verb === 'inputs') {
      if (args.input === undefined) return {workspace:alias, inputs:Object.entries(binding.inputs).map(([input, row]) =>
        ({input, label:row.label, kind:row.kind, mediaType:row.mediaType, declaredSha256:row.sha256 ?? null}))};
      const file = binding.inputs[identifier(args.input)];
      need(file, 'GRANT_INPUT_NOT_CONFIGURED', 'Choose one original host input alias.');
      const bytes = await readGrantAgentFile(file.file, GRANT_MAX_BUNDLE_BYTES);
      need(!file.sha256 || hash(bytes) === file.sha256, 'GRANT_INPUT_CHANGED', 'The declared original input changed.');
      return {workspace:alias, input:args.input, name:file.file.split(/[\\/]/).at(-1), bytes:bytes.length,
        sha256:hash(bytes), mediaType:file.mediaType, kind:file.kind};
    }
    if (verb === 'file_release') {
      snapshotId(args.snapshotId); await this.#readers.release(alias + ':' + args.snapshotId, args.readId);
      return {workspace:alias, snapshotId:args.snapshotId, readId:args.readId, state:'RELEASED'};
    }
    if (['snapshot','rows','file_read'].includes(verb)) {
      if (verb === 'file_read') return this.#readers.read({scope:alias + ':' + snapshotId(args.snapshotId),
        key:args.snapshotId, kind:'SF47_ORIGINAL', directory:await this.#root(alias), readId:args.readId,
        expectedSha256:sha(args.expectedSha256), offset:uint(args.offset ?? 0, 'Byte offset', MAX_JSON),
        limit:uint(args.limit ?? CHUNK, 'Byte page size', CHUNK, 1),
        load:async () => { const data = await this.#loadSnapshot(alias, args.snapshotId, args.expectedSha256);
          return {bytes:data.bytes, name:data.meta.file.name, type:data.meta.file.contentType}; }});
      const original = await this.#loadSnapshot(alias, args.snapshotId, args.expectedSha256);
      need(/^application\/json\b/i.test(original.meta.file.contentType), 'GRANT_JSON_REQUIRED', 'This complete native file is not a JSON snapshot.');
      const value = pointer(decode(original.bytes), args.pointer ?? '');
      if (verb === 'snapshot') return {...original.meta, pointer:args.pointer ?? '', ...presentation(value, args.pointer ?? '')};
      need(Array.isArray(value), 'GRANT_ARRAY_REQUIRED', 'Choose an original array pointer from this exact snapshot.');
      const offset = uint(args.offset ?? 0, 'Row offset', value.length), limit = uint(args.limit ?? 50, 'Row page size', 200, 1);
      const rows = []; let size = 0, next = offset;
      while (next < value.length && rows.length < limit) {
        const bytes = Buffer.byteLength(JSON.stringify(value[next]));
        if (size + bytes > PAGE_BYTES) break;
        rows.push(value[next++]); size += bytes;
      }
      return {workspace:alias, snapshotId:args.snapshotId, sha256:args.expectedSha256, pointer:args.pointer,
        offset, count:value.length, rows, nextOffset:next < value.length ? next : null,
        ...(next === offset && next < value.length ? {largeRow:{index:next, bytes:Buffer.byteLength(JSON.stringify(value[next])),
          pointer:args.pointer + '/' + next, recovery:'Use merchant_grant_snapshot for selected nested values or merchant_grant_file_read for the complete original response.'}} : {})};
    }
    const client = this.#client(alias);
    if (verb === 'open') return client.open({expectedSelectionSha256:args.expectedSelectionSha256});
    if (verb === 'inspect') return client.inspect();
    if (verb === 'browser') return client.browser();
    if (verb === 'close') return client.detach(args.expectedInstanceId);
    const rest = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'workspace'));
    const reads = {plans:'plans', plan:'plan', plan_history:'plan-history', cases:'cases', case:'case',
      case_report:'case-report', case_history:'case-history', forecasts:'forecasts', forecast:'forecast',
      portfolios:'portfolios', portfolio:'portfolio', review:'review', completion:'completion'};
    let original;
    if (Object.hasOwn(reads, verb)) original = await client.read(reads[verb], rest);
    else if (['plan_estimate','plan_save','plan_restore','plan_clone'].includes(verb)) {
      const {planId, ...body} = rest; original = await client.plan(verb.slice(5), planId, body);
    } else if (verb === 'case_create') original = await client.createCase(rest);
    else if (verb === 'case_command') { const {caseId, ...body} = rest; original = await client.command(caseId, body); }
    else if (verb === 'cohort_seed') original=await client.cohortSeed(args.caseId,args.expectedVersion,args.tranche);
    else if (verb === 'cohort_preview') original=await client.cohortPreview(args.caseId,args.expectedVersion,
      await this.#modelInputs(alias,args,'Cohort'));
    else if (verb === 'cohort_prepare') {
      const {caseId,input,inputPointer,expectedInputSha256,...body}=rest;
      original=await client.cohortPrepare(caseId,{...body,inputs:await this.#modelInputs(alias,args,'Cohort')});
    }
    else if (verb === 'completion_seed') original=await client.completionSeed(args.caseId,args.expectedVersion,args.tranche);
    else if (verb === 'completion_preview') {
      const {caseId,expectedVersion,...inputs}=rest;
      original=await client.completionPreview(caseId,expectedVersion,inputs);
    } else if (verb === 'completion_save') {
      const {caseId,input,inputPointer,expectedInputSha256,...body}=rest;
      original=await client.completionSave(caseId,{...body,inputs:await this.#modelInputs(alias,args,'Completion')});
    } else if (['completion_prepare','completion_extension','completion_submit','completion_decision'].includes(verb)) {
      const {caseId,...body}=rest;
      const method={completion_prepare:'completionPrepare',completion_extension:'completionExtension',
        completion_submit:'completionSubmit',completion_decision:'completionDecision'}[verb];
      original=await client[method](caseId,body);
    }
    else if (verb === 'forecast_preview') original = await client.forecastPreview(args.caseId, args.expectedVersion,
      await this.#modelInputs(alias, args, 'Forecast'));
    else if (verb === 'forecast_save') {
      const {caseId, input, inputPointer, expectedInputSha256, ...body} = rest;
      original = await client.forecastSave(caseId, {...body, inputs:await this.#modelInputs(alias, args, 'Forecast')});
    } else if (verb === 'portfolio_seed') original = await client.portfolioSeed(args.caseId, args.expectedVersion, args.forecastId);
    else if (verb === 'portfolio_preview') original = await client.portfolioPreview(args.caseId, args.expectedVersion,
      await this.#modelInputs(alias, args, 'Portfolio'));
    else if (verb === 'portfolio_save') {
      const {caseId, input, inputPointer, expectedInputSha256, ...body} = rest;
      original = await client.portfolioSave(caseId, {...body, inputs:await this.#modelInputs(alias, args, 'Portfolio')});
    } else if (verb === 'portfolio_selection') original = await client.portfolioSelection(args.caseId, args.expectedVersion,
      args.portfolioId, args.alternativeId);
    else if (verb === 'export') original = await client.download(args.kind, rest);
    else if (['plan_import','case_import','source_attach','intake','support_preview','support_receive','buyer_preview','buyer_receive'].includes(verb)) {
      const {input, expectedInputSha256, ...body} = rest, selected = await this.#input(alias, input, expectedInputSha256);
      if (verb === 'support_preview') {
        original = await client.supportPreview(body.caseId, body.expectedVersion, selected.bytes, body.filename);
      } else if (verb === 'support_receive') {
        const {caseId, ...fields} = body;
        original = await client.supportReceive(caseId, selected.bytes, fields);
      } else if (verb === 'buyer_preview') {
        original = await client.buyerPreview(body.caseId, body.expectedVersion, selected.bytes, body.filename);
      } else if (verb === 'buyer_receive') {
        const {caseId, ...fields} = body;
        original = await client.buyerReceive(caseId, selected.bytes, fields);
      } else if (verb === 'plan_import') {
        const {kind, ...fields} = body;
        if (kind === 'plan') need(!['note','planning','filename'].some(key => Object.hasOwn(fields,key)),
          'GRANT_INVALID_INPUT', 'A complete planning ZIP retains its own note, planning and filename. Supply only the received name and original request ID.');
        original = kind === 'scenario' ? await client.importScenario(selected.bytes, fields)
          : await client.importBundle(kind, selected.bytes, fields);
      } else if (verb === 'case_import') original = await client.importBundle('case', selected.bytes, body);
      else if (verb === 'intake') {
        const {mode, note, ...fields} = body;
        original = await client.intake(selected.bytes, fields);
      } else { const {caseId, ...fields} = body; original = await client.attach(caseId, selected.bytes, fields); }
    } else throw failure('GRANT_TOOL_UNKNOWN', 'Choose an original grant operation.');
    return this.#snapshot(alias, original, {tool:name, ...Object.fromEntries(Object.entries(rest).filter(([key]) =>
      ['planId','caseId','forecastId','portfolioId','alternativeId','sourceId','reviewId','revision','after','limit','kind',
        'requestId','expectedRevision','expectedVersion','input','inputPointer','expectedInputSha256',
        'filename','expectedPreviewSha256','deploymentId','tranche','asOfDate','receiptId','cohortReviewIds',
        'expectedReviewSha256','confirmedOn','deadlineOn','submittedOn','formReference','outcomeId','state','date'].includes(key)))});
  }
  async call(name, args = {}) {
    need(!this.#closing, 'GRANT_CLOSING', 'The original grant client is closing.');
    const pending = this.#execute(name, args); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await Promise.allSettled([...this.#pending]); await this.#readers.close();
        const outcomes = await Promise.allSettled([...this.#clients.values()].map(client => client.close()));
        if (outcomes.some(result => result.status === 'rejected'))
          throw failure('GRANT_SHUTDOWN_INCOMPLETE', 'An original owned grant service reported an incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
