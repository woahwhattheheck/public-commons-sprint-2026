import {grantSourceCollectionVerbs,executeGrantSourceCollectionTool} from './grant-source-collection.mjs';
import {SOURCE_COLLECTION_MAX_COPY_BYTES} from '../../stellar/scf_2026/sf47_budget_model/workspace/installation-source-collection-store.mjs';
import {grantWorkspaceTools} from './catalog/grant-workspace.mjs';
import {retainGrantFundingSave} from './grant-funding-recovery.mjs';
import {seedGrantCohortDelivery,editCohortDelivery,refreshGrantCohortDelivery,
  reviewGrantCohortDelivery,calculateCohortDelivery,openGrantCohortDelivery,exportGrantCohortDelivery}
  from '../../stellar/scf_2026/sf47_budget_model/workspace/cohort_delivery_agent.mjs';
import {seedGrantCohortAdoption,reviewGrantCohortAdoption,editCohortAdoption,rebaseGrantCohortAdoption,
  scheduleCohortAdoption,compareCohortAdoption,prepareGrantCohortAdoption,validateCohortAdoptionPrepared,
  inspectGrantCohortAdoptionRequest,saveGrantCohortAdoption,openGrantCohortAdoption,exportCohortAdoption}
  from '../../stellar/scf_2026/sf47_budget_model/workspace/cohort_planning_agent.mjs';
import {grantInstallationSourceVerbs, executeGrantInstallationSourceTool} from './grant-installation-sources.mjs';
import {INSTALLATION_SOURCE_MAX_ARCHIVE_BYTES} from '../../stellar/scf_2026/sf47_budget_model/workspace/installation-source-desk-agent.mjs';
import {grantPlanningSourceVerbs,executeGrantPlanningSourceTool} from './grant-planning-sources.mjs';
import {grantReportingCaptureVerbs,executeGrantReportingCaptureTool} from './grant-reporting-capture.mjs';
import {grantProcedureVerbs,executeGrantProcedureTool} from './grant-procedures.mjs';
import {GRANT_MAX_WORKBOOK_HANDOVER_BYTES} from '../../stellar/scf_2026/sf47_budget_model/workspace/agent-contracts.mjs';
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
const MAX_RETAINED = Math.max(MAX_JSON,GRANT_MAX_WORKBOOK_HANDOVER_BYTES,INSTALLATION_SOURCE_MAX_ARCHIVE_BYTES,SOURCE_COLLECTION_MAX_COPY_BYTES);
const canonicalSourceRequest = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '['+value.map(canonicalSourceRequest).join(',')+']'
  : '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalSourceRequest(value[key])).join(',')+'}';
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


const ADOPTION_REQUEST = 'stellar-forge.sf47-cohort-adoption-agent-request.v1';
const ADOPTION_RETURNED = 'stellar-forge.sf47-cohort-adoption-agent-returned.v1';
const adoptionCanonical = value => JSON.stringify((function order(v) {
  return Array.isArray(v) ? v.map(order) : plain(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key,order(v[key])])) : v;
})(value));
const adoptionRequestKey = (caseId, requestId) => {
  need(typeof caseId === 'string' && /^operation-[a-f0-9]{32}$/.test(caseId) &&
    typeof requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(requestId),
    'GRANT_ADOPTION_INPUT', 'Select the original adoption case and request identities.');
  return hash(Buffer.from(caseId + '\0' + requestId));
};

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
      const inputMaximum=file.kind==='source-working-copy'?SOURCE_COLLECTION_MAX_COPY_BYTES:GRANT_MAX_BUNDLE_BYTES;
      need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= inputMaximum &&
        await realpath(filename) === filename, 'GRANT_CONFIGURATION_ERROR', 'Declare a complete regular input file: ordinary inputs32 MiB, explicit source-working-copy inputs512 MiB.');
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
  #planningHandovers = new Map();
  #sourceCollections = new Map();
  #reportingCaptures = new Map();
  #procedureOperations = new Map();
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
  async #snapshotMeta(alias, selected, expected) {
    const root = await this.#root(alias), meta = decode(await readGrantAgentFile(join(root, 'snapshots', snapshotId(selected) + '.json'), 65536));
    need(meta.schema === SNAPSHOT && meta.workspace === alias && meta.id === selected &&
      sha(meta.file?.sha256) === sha(expected) && Number.isSafeInteger(meta.file.bytes) &&
      meta.file.bytes >= 0 && meta.file.bytes <= MAX_RETAINED,
    'GRANT_SNAPSHOT_CONFLICT', 'Use the original workspace, snapshot, complete byte count and file SHA together.');
    return {meta,directory:root};
  }
  async #loadSnapshot(alias, selected, expected) {
    const {meta,directory:root}=await this.#snapshotMeta(alias,selected,expected);
    const bytes = await readGrantAgentFile(join(root, 'files', meta.file.sha256), MAX_RETAINED);
    need(bytes.length === meta.file.bytes && hash(bytes) === meta.file.sha256, 'GRANT_SNAPSHOT_CHANGED', 'The retained original file differs from its manifest.');
    return {meta, bytes, directory:root};
  }
  async #openSnapshotFile(alias, selected, expected) {
    const {meta,directory:root}=await this.#snapshotMeta(alias,selected,expected);
    const handle=await open(join(root,'files',meta.file.sha256),
      constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0));
    try {
      const stat=await handle.stat();
      need(stat.isFile() && stat.size===meta.file.bytes && typeof process.getuid==='function' &&
        stat.uid===process.getuid() && (stat.mode & 0o077)===0,
      'GRANT_SNAPSHOT_CHANGED','Open the original private immutable snapshot with its complete retained size.');
      // The shared reader takes sole custody, verifies the full descriptor hash
      // and checks its identity before every chunk. Large handovers need no copy.
      return {readonlyFileHandle:handle,bytes:meta.file.bytes,sha256:meta.file.sha256,
        name:meta.file.name,type:meta.file.contentType};
    } catch(error) { await handle.close(); throw error; }
  }
  async #cachedPlanningHandover(alias, identity, create) {
    need(plain(identity) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(identity.requestId ?? '') &&
      /^plan-[a-f0-9]{32}$/.test(identity.planId ?? '') && Number.isSafeInteger(identity.revision) &&
      identity.revision>0 && identity.revision<=1000000,
    'GRANT_HANDOVER_REQUEST','Use the original request ID and exact saved plan revision.');
    sha(identity.expectedContentSha256);
    const requestSha256=hash(Buffer.from(canonicalSourceRequest(identity)));
    const key=alias+'\0'+identity.requestId, pending=this.#planningHandovers.get(key);
    if(pending) {
      need(pending.requestSha256===requestSha256,'GRANT_HANDOVER_REQUEST_CONFLICT',
        'This handover request already owns a different original saved revision or export profile.');
      return pending.promise;
    }
    const operation=(async()=>{
      const parent=await directory(join(await this.#root(alias),'planning-handovers'));
      const root=await directory(join(parent,hash(Buffer.from(identity.requestId))));
      const declaration={schema:'stellar-forge.sf47-workbook-handover-request.v1',workspace:alias,
        requestSha256,selection:JSON.parse(canonicalSourceRequest(identity))};
      await immutable(join(root,'request.json'),json(declaration));
      const existing=async()=>{
        let record;
        try {record=decode(await readGrantAgentFile(join(root,'result.json'),256*1024));}
        catch(error) {if(error.code==='ENOENT')return null;throw error;}
        need(record.schema==='stellar-forge.sf47-workbook-handover-result.v1' &&
          record.workspace===alias && record.requestSha256===requestSha256 &&
          record.result?.requestId===identity.requestId && record.result?.retention?.state==='COMPLETE',
        'GRANT_HANDOVER_RESULT_CONFLICT','Keep the original complete handover result and request together.');
        for(const item of [record.result.archive,...record.result.files]) {
          const {meta,directory:retained}=await this.#snapshotMeta(alias,item.id,item.file.sha256);
          const stat=await lstat(join(retained,'files',meta.file.sha256));
          need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===meta.file.bytes&&
            meta.file.bytes===item.file.bytes,'GRANT_HANDOVER_FILE_CHANGED',
          'A retained original handover file is unavailable at its complete size.');
        }
        return record.result;
      };
      const retained=await existing();if(retained)return retained;
      const result=await create();
      if(result.retention?.state!=='COMPLETE')return result;
      const record={schema:'stellar-forge.sf47-workbook-handover-result.v1',workspace:alias,requestSha256,result};
      try {await immutable(join(root,'result.json'),json(record));}
      catch(error) {
        // Independent clients may finish the same read-only export together.
        // The first complete original result owns this request permanently.
        if(error.code!=='GRANT_RETAINED_CONFLICT')throw error;
      }
      const complete=await existing();
      need(complete,'GRANT_HANDOVER_RESULT_UNAVAILABLE','Reopen the original complete handover result after retained storage is available.');
      return complete;
    })();
    this.#planningHandovers.set(key,{requestSha256,promise:operation});
    try {return await operation;}finally{this.#planningHandovers.delete(key);}
  }
  async #input(alias, selection, expected, maximum) {
    if(maximum!==undefined)uint(maximum,'Original input maximum',SOURCE_COLLECTION_MAX_COPY_BYTES,1);
    exact(selection, ['hostInput', 'snapshotId', 'transferId', 'sourceWorkspace']);
    need(['hostInput','snapshotId','transferId'].filter(key => selection[key] !== undefined).length === 1,
      'GRANT_INPUT_SELECTION_INVALID', 'Choose one host input, retained snapshot or completed transfer.');
    const source = selection.sourceWorkspace ?? alias, binding = this.#binding(source);
    let bytes, metadata;
    if (selection.hostInput !== undefined) {
      identifier(selection.hostInput, 'Grant input alias');
      const input = binding.inputs[selection.hostInput];
      need(input, 'GRANT_INPUT_NOT_CONFIGURED', 'Choose a declared original input alias.');
      const bound=input.kind==='source-working-copy'?(maximum??GRANT_MAX_BUNDLE_BYTES):Math.min(maximum??GRANT_MAX_BUNDLE_BYTES,GRANT_MAX_BUNDLE_BYTES);
      bytes = await readGrantAgentFile(input.file, bound);
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
    if(maximum!==undefined)need(bytes.length<=maximum,'GRANT_INPUT_TOO_LARGE','Receive the complete input within its declared original bound.');
    return {bytes, metadata, sourceWorkspace:source};
  }
  async #modelInputs(alias, args, label, maximum = GRANT_MAX_SOURCE_BYTES) {
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
    need(selectedBytes <= maximum, 'GRANT_INPUT_TOO_LARGE',
      label + ' input JSON fits the native ' + (maximum / (1024 * 1024)) + ' MiB source bound.');
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

  async #adoptionRecords(alias, caseId, requestId) {
    const id = adoptionRequestKey(caseId, requestId);
    const root = await directory(join(await this.#root(alias), 'cohort-adoption-requests'));
    return {prepared:join(root,id + '.prepared.json'),returned:join(root,id + '.returned.json')};
  }
  async #adoptionRecord(filename) {
    try { return decode(await readGrantAgentFile(filename,MAX_JSON)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  #adoptionPreparedRecord(record, selected, expectedSha256) {
    need(record?.schema === ADOPTION_REQUEST, 'GRANT_ADOPTION_RETAINED_CHANGED',
      'Select the complete retained adoption request.');
    const prepared = validateCohortAdoptionPrepared(record.prepared, expectedSha256);
    need(prepared.caseId === selected.caseId && prepared.request.requestId === selected.requestId,
      'GRANT_ADOPTION_RETAINED_CHANGED', 'The retained adoption request belongs to another original case or request.');
    return prepared;
  }
  #adoptionAccepted(record, prepared) {
    if (!record) return null;
    need(record.schema === ADOPTION_RETURNED && record.preparedSha256 === prepared.preparedSha256 &&
      plain(record.response) && typeof record.response.contentBase64 === 'string',
      'GRANT_ADOPTION_RESPONSE_CHANGED', 'Keep the complete native response for this original prepared request.');
    const original = record.response, bytes = Buffer.from(original.contentBase64,'base64');
    need(bytes.toString('base64') === original.contentBase64 && bytes.length === original.bytes &&
      hash(bytes) === original.sha256 && original.status >= 200 && original.status < 300 &&
      adoptionCanonical(decode(bytes)) === adoptionCanonical(original.value),
      'GRANT_ADOPTION_RESPONSE_CHANGED', 'The original accepted response differs from its complete retained bytes.');
    const {contentBase64,...response} = original;
    return {...response,bytes};
  }
  async #adoptionPrepare(alias, client, caseId, body) {
    const files = await this.#adoptionRecords(alias,caseId,body.requestId);
    const existing = await this.#adoptionRecord(files.prepared);
    if (existing) {
      const prepared = this.#adoptionPreparedRecord(existing,{caseId,requestId:body.requestId},
        existing.prepared?.preparedSha256);
      need(existing.intent !== null && adoptionCanonical(existing.intent) === adoptionCanonical(body),
        'GRANT_ADOPTION_REQUEST_CHANGED',
        'This request already has another complete prepared input. Reopen its original adoption_request.');
      return prepared;
    }
    const prepared = await prepareGrantCohortAdoption(client,caseId,body);
    const record = json({schema:ADOPTION_REQUEST,intent:body,prepared});
    need(record.length <= MAX_JSON, 'GRANT_ADOPTION_RETAINED_LIMIT',
      'Retain the complete adoption request within the original JSON file bound.');
    await immutable(files.prepared,record);
    return prepared;
  }
  async #adoptionSave(alias, client, prepared, expectedSha256) {
    validateCohortAdoptionPrepared(prepared,expectedSha256);
    const selected = {caseId:prepared.caseId,requestId:prepared.request.requestId};
    const files = await this.#adoptionRecords(alias,selected.caseId,selected.requestId);
    const existing = await this.#adoptionRecord(files.prepared);
    if (existing) this.#adoptionPreparedRecord(existing,selected,expectedSha256);
    else {
      const record = json({schema:ADOPTION_REQUEST,intent:null,prepared});
      need(record.length <= MAX_JSON,'GRANT_ADOPTION_RETAINED_LIMIT',
        'Retain the complete adoption request within the original JSON file bound.');
      await immutable(files.prepared,record);
    }
    const returned = await this.#adoptionRecord(files.returned);
    const acceptedResponse = this.#adoptionAccepted(returned,prepared);
    return saveGrantCohortAdoption(client,prepared,expectedSha256,{acceptedResponse,
      retainResponse:async response => {
        need(Buffer.isBuffer(response.bytes),'GRANT_ADOPTION_RESPONSE_CHANGED',
          'The native save must return its complete original response bytes.');
        const {bytes,...metadata} = response;
        const record = json({schema:ADOPTION_RETURNED,preparedSha256:expectedSha256,
          response:{...metadata,bytes:bytes.length,sha256:hash(bytes),contentBase64:bytes.toString('base64')}});
        await immutable(files.returned,record);
      }});
  }
  async #adoptionRequest(alias, client, caseId, requestId, expectedSha256) {
    sha(expectedSha256);
    const files = await this.#adoptionRecords(alias,caseId,requestId);
    const record = await this.#adoptionRecord(files.prepared);
    if (!record) return {schema:ADOPTION_REQUEST,found:false,caseId,requestId,expectedPreparedSha256:expectedSha256};
    const prepared = this.#adoptionPreparedRecord(record,{caseId,requestId},expectedSha256);
    const returned = await this.#adoptionRecord(files.returned);
    const accepted = this.#adoptionAccepted(returned,prepared);
    const status = await inspectGrantCohortAdoptionRequest(client,prepared,expectedSha256,{acceptedResult:accepted});
    return {schema:ADOPTION_REQUEST,found:true,prepared,returned,status};
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
    if (grantReportingCaptureVerbs.has(verb)) return executeGrantReportingCaptureTool(verb,args,{
      binding,root:()=>this.#root(alias),directory,immutable,pending:this.#reportingCaptures,
      load:(input,expected)=>this.#input(alias,input,expected),
      loadRetained:(id,expected)=>this.#loadSnapshot(alias,id,expected),
      retain:(original,selection)=>this.#snapshot(alias,original,selection),
    });
    if (grantProcedureVerbs.has(verb)) return executeGrantProcedureTool(verb,args,{
      binding,root:()=>this.#root(alias),directory,immutable,pending:this.#procedureOperations,
      client:()=>this.#client(alias),
      load:(input,expected)=>this.#input(alias,input,expected),
      loadRetained:(id,expected)=>this.#loadSnapshot(alias,id,expected),
      retain:(original,selection)=>this.#snapshot(alias,original,selection),
    });
    if (verb === 'receive_begin') return this.#receiveBegin(alias, args);
    if (verb === 'receive_chunk') return this.#receiveChunk(alias, args);
    if (verb === 'receive_status') return this.#transferStatus(await this.#transfer(alias, args.transferId));
    if (verb === 'receive_commit') return this.#receiveCommit(alias, args.transferId);
    if (verb === 'inputs') {
      if (args.input === undefined) return {workspace:alias, inputs:Object.entries(binding.inputs).map(([input, row]) =>
        ({input, label:row.label, kind:row.kind, mediaType:row.mediaType, declaredSha256:row.sha256 ?? null}))};
      const file = binding.inputs[identifier(args.input)];
      need(file, 'GRANT_INPUT_NOT_CONFIGURED', 'Choose one original host input alias.');
      const bytes = await readGrantAgentFile(file.file,file.kind==='source-working-copy'?SOURCE_COLLECTION_MAX_COPY_BYTES:GRANT_MAX_BUNDLE_BYTES);
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
        expectedSha256:sha(args.expectedSha256), offset:uint(args.offset ?? 0, 'Byte offset', MAX_RETAINED),
        limit:uint(args.limit ?? CHUNK, 'Byte page size', CHUNK, 1),
        load:() => this.#openSnapshotFile(alias,args.snapshotId,args.expectedSha256)});
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
    if(grantSourceCollectionVerbs.has(verb))return executeGrantSourceCollectionTool(verb,args,{
      alias,binding,client,directory,root:()=>this.#root(alias),pending:this.#sourceCollections,
      load:(input,expected,maximum)=>this.#input(alias,input,expected,maximum),
      retain:(original,selection)=>this.#snapshot(alias,original,selection),
    });
    if (grantInstallationSourceVerbs.has(verb)) return executeGrantInstallationSourceTool(verb,args,{
      alias,binding,client,load:(input,expected)=>this.#input(alias,input,expected),
      retain:(original,selection)=>this.#snapshot(alias,original,selection),
    });
    if (grantPlanningSourceVerbs.has(verb)) return executeGrantPlanningSourceTool(verb,args,{
      client,load:(input,expected)=>this.#input(alias,input,expected),
      retain:(original,selection)=>this.#snapshot(alias,original,selection),
      cachedHandover:(identity,create)=>this.#cachedPlanningHandover(alias,identity,create),
    });
    if (verb === 'open') return client.open({expectedSelectionSha256:args.expectedSelectionSha256});
    if (verb === 'inspect') return client.inspect();
    if (verb === 'browser') return client.browser();
    if (verb === 'close') return client.detach(args.expectedInstanceId);
    const rest = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'workspace'));
    const reads = {plans:'plans', plan:'plan', plan_history:'plan-history', plan_comparison:'plan-comparison', cases:'cases', case:'case',
      case_report:'case-report', operating_workflows:'operating-workflows', case_history:'case-history', amendments:'amendments', amendment:'amendment', forecasts:'forecasts', forecast:'forecast',
      portfolios:'portfolios', portfolio:'portfolio', review:'review', completion:'completion',
      settlements:'settlements',settlement:'settlement',
      risks:'risks', risk_register:'risk-register', risk_history:'risk-history', risk_comparison:'risk-comparison',
      engagements:'engagements', engagement:'engagement', delivery_calendar:'delivery-calendar', delivery_agenda:'delivery-agenda',
      work_intakes:'work-intakes',work_intake:'work-intake',task_outcomes:'task-outcomes',task_outcome:'task-outcome',
      cost_funding:'cost-funding',funding_edition:'funding-edition',funding_request:'funding-request',
      ledger_intake:'ledger-intake',ledger_intake_original:'ledger-intake-original',
      account_reconciliation:'account-reconciliation',account_reconciliation_statement_inputs:'account-reconciliation-statement-inputs',
      cash_account:'cash-account',supplier_account:'supplier-account',performance:'performance',delivery_queue:'delivery-queue',installation_returns:'installation-returns',installations:'installations',installation:'installation',installation_history:'installation-history'};
    let original;
    if (Object.hasOwn(reads, verb)) original = await client.read(reads[verb], rest);
    else if (['plan_estimate','plan_save','plan_restore','plan_clone'].includes(verb)) {
      const {planId, ...body} = rest; original = await client.plan(verb.slice(5), planId, body);
    } else if (verb === 'case_create') original = await client.createCase(rest);
    else if (verb === 'case_command') { const {caseId, ...body} = rest; original = await client.command(caseId, body); }
    else if (verb === 'account_reconciliation_preview' || verb === 'account_reconciliation_apply') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...selected}=rest;
      const document=await this.#modelInputs(alias,args,'Account reconciliation',GRANT_MAX_BUNDLE_BYTES);
      for (const [key,value] of Object.entries(selected))
        need(!Object.hasOwn(document,key) || document[key] === value,'GRANT_INPUT_CONFLICT',
          'The supplied '+key+' differs from the complete retained reconciliation request.');
      const body={...document,...selected};
      original=verb === 'account_reconciliation_preview'
        ? await client.accountReconciliationPreview(caseId,body)
        : await client.accountReconciliationApply(caseId,body);
    }
    else if (verb === 'cash_correction_preview' || verb === 'cash_correction_apply') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...selected}=rest;
      const document=await this.#modelInputs(alias,args,'Cash correction',GRANT_MAX_BUNDLE_BYTES);
      for (const [key,value] of Object.entries(selected))
        need(!Object.hasOwn(document,key) || document[key] === value,'GRANT_INPUT_CONFLICT',
          'The supplied ' + key + ' differs from the complete retained cash correction.');
      const body={...document,...selected};
      original=verb === 'cash_correction_preview'
        ? await client.cashCorrectionPreview(caseId,body)
        : await client.cashCorrectionApply(caseId,body);
    }
    else if (verb === 'ledger_intake_inspect') {
      original=await client.ledgerIntakeInspect(args.caseId,
        await this.#modelInputs(alias,args,'Ledger source file',GRANT_MAX_BUNDLE_BYTES));
    }
    else if (verb === 'ledger_intake_preview' || verb === 'ledger_intake_apply') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      const document=await this.#modelInputs(alias,args,'Ledger intake',GRANT_MAX_BUNDLE_BYTES);
      original=verb === 'ledger_intake_preview'
        ? await client.ledgerIntakePreview(caseId,{...body,document})
        : await client.ledgerIntakeApply(caseId,{...body,document});
    }
    else if (verb === 'statement_inspect') original=await client.statementInspect(args.caseId,args.expectedVersion,
      await this.#modelInputs(alias,args,'Original bank statement',GRANT_MAX_BUNDLE_BYTES));
    else if (verb === 'statement_preview') original=await client.statementPreview(args.caseId,args.expectedVersion,
      await this.#modelInputs(alias,args,'Statement',GRANT_MAX_BUNDLE_BYTES));
    else if (verb === 'statement_receive') {
      const {caseId,input,inputPointer,expectedInputSha256,...body}=rest;
      original=await client.statementReceive(caseId,{...body,inputs:await this.#modelInputs(alias,args,'Statement',GRANT_MAX_BUNDLE_BYTES)});
    }
    else if (verb === 'installation_return_review_seed') {
      const {caseId,...body}=rest; original=await client.installationReturnReviewSeed(caseId,body);
    }
    else if (verb === 'installation_return_seed') {
      const {caseId,...body}=rest; original=await client.installationReturnSeed(caseId,body);
    }
    else if (['installation_return_preview','installation_return_review_preview','installation_return','installation_return_stage'].includes(verb)) {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      const selected=await this.#modelInputs(alias,args,'Installation receiving');
      const methods={installation_return_preview:'installationReturnPreview',
        installation_return_review_preview:'installationReturnReviewPreview',
        installation_return:'installationReturn',installation_return_stage:'installationReturnStage'};
      original=await client[methods[verb]](caseId,{...body,inputs:selected});
    }
    else if (verb === 'work_intake_upload') {
      const {caseId,...body}=rest;original=await client.workIntakeUpload(caseId,body);
    }
    else if (['work_intake_preview','work_intake_save','work_intake_apply'].includes(verb)) {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      if(inputs!==undefined||input!==undefined||inputPointer!==undefined||expectedInputSha256!==undefined)
        body.document=await this.#modelInputs(alias,args,'Work intake',GRANT_MAX_BUNDLE_BYTES);
      const method={work_intake_preview:'workIntakePreview',work_intake_save:'workIntakeSave',work_intake_apply:'workIntakeApply'}[verb];
      original=await client[method](caseId,body);
    }
    else if (verb === 'funding_seed') {
      const {caseId,...body}=rest; original=await client.fundingSeed(caseId,body);
    }
    else if (verb === 'funding_preview'||verb === 'funding_save') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      const complete=await this.#modelInputs(alias,args,'Complete cost funding allocation');
      original=verb==='funding_preview'?await client.fundingPreview(caseId,{...body,inputs:complete}):
        await retainGrantFundingSave({directory:await this.#root(alias),client,caseId,body:{...body,inputs:complete}});
    }
    else if (verb === 'risk_seed') {
      const {caseId,...body}=rest; original=await client.riskSeed(caseId,body);
    }
    else if (verb === 'risk_preview'||verb === 'risk_save') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      const document=await this.#modelInputs(alias,args,'Complete delivery risk register',GRANT_MAX_SOURCE_BYTES);
      original=verb==='risk_preview'?await client.riskPreview(caseId,{...body,document}):
        await client.riskSave(caseId,{...body,document});
    }
    else if (verb === 'risk_request') {
      const command=await this.#modelInputs(alias,args,'Original delivery risk save command',GRANT_MAX_SOURCE_BYTES);
      original=await client.riskRequest(args.caseId,{command});
    }
    else if (verb === 'task_outcomes_seed') original=await client.taskOutcomesSeed(args.caseId,args.expectedVersion);
    else if (verb === 'task_outcomes_preview'||verb === 'task_outcomes_save') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      const complete=await this.#modelInputs(alias,args,'Customer task outcomes');
      original=verb==='task_outcomes_preview'?await client.taskOutcomesPreview(caseId,{...body,inputs:complete}):
        await client.taskOutcomesSave(caseId,{...body,inputs:complete});
    }
    else if (verb === 'engagement_seed') original = await client.engagementSeed(args.caseId, args.expectedVersion, args.reviewId);
    else if (verb === 'engagement_preview') original = await client.engagementPreview(args.caseId, args.expectedVersion,
      await this.#modelInputs(alias, args, 'Contributor Engagements'));
    else if (verb === 'engagement_prepare') {
      const document = await this.#modelInputs(alias, args, 'Contributor Engagements');
      original = await client.engagementPrepare(args.caseId, {
        expectedVersion:args.expectedVersion, requestId:args.requestId, actor:args.actor, note:args.note,
        document, expectedPreviewSha256:args.expectedPreviewSha256});
    }
    else if (verb === 'engagement_forecast') original = await client.engagementForecast(args.caseId, args.expectedVersion,
      await this.#modelInputs(alias, args, 'Engagement to Forecast selection'));
    else if (verb === 'engagement_portfolio') original = await client.engagementPortfolio(args.caseId, args.expectedVersion,
      await this.#modelInputs(alias, args, 'Engagement to Portfolio selection'));
    else if (verb === 'engagement_receiving') {
      const data = await this.#modelInputs(alias, args, 'Engagement receiving');
      // A referenced native selection cannot replace the separately retained command identity.
      exact(data, ['reviewId','reviewSha256','forecastId','portfolioId','forecastSelection','portfolioSelection'],
        ['reviewId','reviewSha256','forecastId','portfolioId','forecastSelection','portfolioSelection']);
      original = await client.engagementReceiving(args.caseId, {
        expectedVersion:args.expectedVersion, requestId:args.requestId, actor:args.actor, note:args.note, ...data});
    }
    else if (verb === 'customer_use_calendar') {
      const {caseId,...body}=rest;original=await client.customerUseCalendar(caseId,body);
    }
    else if (verb === 'customer_use_calendar_expand') {
      const {caseId,expectedVersion}=rest;
      const input=await this.#modelInputs(alias,args,'Complete Installation and customer-use pattern');
      exact(input,['document','pattern'],['document','pattern']);
      original=await client.customerUseCalendarExpand(caseId,{expectedVersion,...input});
    }
    else if (verb === 'customer_use_calendar_cohort') {
      const {caseId,...body}=rest;original=await client.customerUseCalendarCohort(caseId,body);
    }
    else if (verb === 'installation_seed') original=await client.installationSeed(args.caseId,args.expectedVersion);
    else if (verb === 'installation_workshares') {
      const {caseId,...body}=rest; original=await client.installationWorkshares(caseId,body);
    }
    else if (verb === 'installation_workshare_seed') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      const hasDocument=inputs!==undefined||input!==undefined||inputPointer!==undefined||expectedInputSha256!==undefined;
      if(hasDocument)body.document=await this.#modelInputs(alias,args,'Installation');
      original=await client.installationWorkshareSeed(caseId,body);
    }
    else if (verb === 'installation_workflows') {
      const {caseId,...body}=rest; original=await client.installationWorkflows(caseId,body);
    }
    else if (verb === 'installation_workflow_seed') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      if(inputs!==undefined||input!==undefined||inputPointer!==undefined||expectedInputSha256!==undefined)
        body.document=await this.#modelInputs(alias,args,'Installation');
      original=await client.installationWorkflowSeed(caseId,body);
    }
    else if (verb === 'installation_effort_seed') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      if(inputs!==undefined||input!==undefined||inputPointer!==undefined||expectedInputSha256!==undefined)
        body.document=await this.#modelInputs(alias,args,'Installation');
      original=await client.installationEffortSeed(caseId,body);
    }
    else if (verb === 'installation_effort_selection') {
      const {caseId,...body}=rest;
      original=await client.installationEffortSelection(caseId,body);
    }
    else if (verb === 'installation_preview'||verb === 'installation_save') {
      const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
      const document=await this.#modelInputs(alias,args,'Installation');
      original=verb==='installation_preview'?await client.installationPreview(caseId,{...body,document}):
        await client.installationSave(caseId,{...body,document});
    }
    else if (verb === 'work_billing_catalog') original=await client.workBillingCatalog(args.caseId);
    else if (verb === 'work_billing_authority') original=await client.workBillingAuthority(args.caseId,args.authorityId);
    else if (verb === 'work_billing_authority_save') {
      const {caseId,...body}=rest;original=await client.workBillingSaveAuthority(caseId,body);
    }
    else if (verb === 'work_billing') original=await client.workBilling(args.caseId,args.chargeId);
    else if (verb === 'work_billing_preview'||verb === 'work_billing_prepare') {
      const {caseId,...body}=rest;
      original=verb==='work_billing_preview'?await client.workBillingPreview(caseId,body):
        await client.workBillingPrepare(caseId,body);
    }
    else if (['work_billing_apply','work_billing_cancel','work_billing_issue'].includes(verb)) {
      const {caseId,chargeId,...body}=rest;
      const methods={work_billing_apply:'workBillingApply',work_billing_cancel:'workBillingCancel',work_billing_issue:'workBillingIssue'};
      original=await client[methods[verb]](caseId,chargeId,body);
    }
    else if (verb === 'work_billing_preview_issue') original=await client.workBillingPreviewIssue(args.caseId,args.chargeId);
    else if (verb === 'work_billing_refresh') original=await client.workBillingRefresh(args.caseId,args.chargeId);
    else if (verb === 'expense_billing_catalog') original=await client.expenseBillingCatalog(args.caseId);
    else if (verb === 'expense_billing') original=await client.expenseBilling(args.caseId,args.chargeId);
    else if (verb === 'expense_billing_preview'||verb === 'expense_billing_prepare') {
      const {caseId,...body}=rest;
      original=verb==='expense_billing_preview'?await client.expenseBillingPreview(caseId,body):
        await client.expenseBillingPrepare(caseId,body);
    }
    else if (['expense_billing_apply','expense_billing_cancel','expense_billing_issue'].includes(verb)) {
      const {caseId,chargeId,...body}=rest;
      const methods={expense_billing_apply:'expenseBillingApply',expense_billing_cancel:'expenseBillingCancel',expense_billing_issue:'expenseBillingIssue'};
      original=await client[methods[verb]](caseId,chargeId,body);
    }
    else if (verb === 'expense_billing_preview_issue') original=await client.expenseBillingPreviewIssue(args.caseId,args.chargeId);
    else if (verb === 'expense_billing_refresh') original=await client.expenseBillingRefresh(args.caseId,args.chargeId);
    else if (verb === 'commercial_changes') original=await client.commercialChanges(args.caseId,args.billingId,args.milestoneId);
    else if (verb === 'commercial_change') original=await client.commercialChange(args.caseId,args.changeId);
    else if (verb === 'commercial_change_preview'||verb === 'commercial_change_prepare') {
      const {caseId,billingId,milestoneId,...body}=rest;
      original=verb==='commercial_change_preview'?await client.commercialChangePreview(caseId,billingId,milestoneId,body):
        await client.commercialChangePrepare(caseId,billingId,milestoneId,body);
    }
    else if (['commercial_change_apply','commercial_change_cancel','commercial_change_issue'].includes(verb)) {
      const {caseId,changeId,...body}=rest;
      const methods={commercial_change_apply:'commercialChangeApply',commercial_change_cancel:'commercialChangeCancel',commercial_change_issue:'commercialChangeIssue'};
      original=await client[methods[verb]](caseId,changeId,body);
    }
    else if (verb === 'commercial_change_preview_issue') original=await client.commercialChangePreviewIssue(args.caseId,args.changeId);
    else if (verb === 'commercial_change_refresh') original=await client.commercialChangeRefresh(args.caseId,args.changeId);
    else if (verb === 'commercial_connections') original=await client.commercialConnections();
    else if (verb === 'commercial_connection_configure') original=await client.commercialConfigureConnection(rest);
    else if (verb === 'commercial_customers') original=await client.commercialCustomers(args.endpointId);
    else if (verb === 'commercial_list') original=await client.commercialList(args.caseId);
    else if (verb === 'commercial') original=await client.commercialDetail(args.caseId,args.billingId);
    else if (verb === 'commercial_schedule'||verb === 'commercial_prepare') {
      const {caseId,...body}=rest;
      original=verb==='commercial_schedule'?await client.commercialSchedule(caseId,body):
        await client.commercialPrepare(caseId,body);
    }
    else if (verb === 'commercial_draft'||verb === 'commercial_issue') {
      const {caseId,billingId,milestoneId,...body}=rest;
      original=verb==='commercial_draft'?await client.commercialDraft(caseId,billingId,milestoneId,body):
        await client.commercialIssue(caseId,billingId,milestoneId,body);
    }
    else if (verb === 'commercial_preview') original=await client.commercialPreview(args.caseId,args.billingId,args.milestoneId);
    else if (verb === 'commercial_refresh') original=await client.commercialRefresh(args.caseId,args.billingId);


    else if (verb.startsWith('cohort_delivery_')) {
      let value;
      if (verb==='cohort_delivery_seed') {
        const {caseId,...body}=rest;value=await seedGrantCohortDelivery(client,caseId,body);
      } else if (verb==='cohort_delivery_request') {
        value=await this.#adoptionRequest(alias,client,args.caseId,args.requestId,args.expectedPreparedSha256);
        if(value.found)need(value.prepared.document.schema==='stellar-forge.sf47-cohort-delivery-comparison.v1',
          'GRANT_DELIVERY_INPUT','Select the original recorded delivery request.');
      } else if (verb==='cohort_delivery_open') {
        value=await openGrantCohortDelivery(client,args.caseId,args.sourceId,args.expectedSourceSha256);
      } else {
        const document=await this.#modelInputs(alias,args,'Complete recorded cohort delivery',GRANT_MAX_BUNDLE_BYTES);
        if (verb==='cohort_delivery_edit') value=editCohortDelivery(document,args.changes);
        else if (verb==='cohort_delivery_review') value=await reviewGrantCohortDelivery(client,args.caseId,args.expectedVersion,document);
        else if (verb==='cohort_delivery_refresh') {
          const {caseId,inputs,input,inputPointer,expectedInputSha256,...selection}=rest;
          value=await refreshGrantCohortDelivery(client,caseId,document,selection);
        } else if (verb==='cohort_delivery_prepare') {
          const comparison=calculateCohortDelivery(document);
          const {caseId,inputs,input,inputPointer,expectedInputSha256,...body}=rest;
          value=await this.#adoptionPrepare(alias,client,caseId,{...body,document:comparison});
        } else if (verb==='cohort_delivery_save') {
          need(document.document?.schema==='stellar-forge.sf47-cohort-delivery-comparison.v1',
            'GRANT_DELIVERY_INPUT','Select the complete original prepared recorded delivery.');
          value=await this.#adoptionSave(alias,client,document,args.expectedPreparedSha256);
        } else if (verb==='cohort_delivery_export') {
          original={...exportGrantCohortDelivery(document,args.format),status:200,
            source:{kind:'GRANT_COHORT_DELIVERY',workspace:alias,selectionSha256:binding.selectionSha256,operation:verb}};
        } else throw failure('GRANT_TOOL_UNKNOWN','Choose an original cohort delivery operation.');
      }
      if(value!==undefined)original={value,bytes:json(value),mediaType:'application/json',status:200,
        filename:verb.replaceAll('_','-')+'.json',
        source:{kind:'GRANT_COHORT_DELIVERY',workspace:alias,selectionSha256:binding.selectionSha256,operation:verb}};
    }
    else if (verb.startsWith('adoption_')) {
      let value;
      if (verb === 'adoption_seed') {
        const {caseId,...body}=rest; value=await seedGrantCohortAdoption(client,caseId,body);
      } else if (verb === 'adoption_request') {
        value=await this.#adoptionRequest(alias,client,args.caseId,args.requestId,args.expectedPreparedSha256);
      } else if (verb === 'adoption_open') {
        value=await openGrantCohortAdoption(client,args.caseId,args.sourceId,args.expectedSourceSha256);
      } else {
        const document=await this.#modelInputs(alias,args,'Complete adoption document',GRANT_MAX_BUNDLE_BYTES);
        if (verb === 'adoption_review') value=await reviewGrantCohortAdoption(client,args.caseId,args.expectedVersion,document);
        else if (verb === 'adoption_edit') value=editCohortAdoption(document,args.changes,args.options);
        else if (verb === 'adoption_rebase') value=await rebaseGrantCohortAdoption(client,args.caseId,args.expectedVersion,document);
        else if (verb === 'adoption_schedule') {
          let constraints;
          const chosen=['constraints','constraintsInput','expectedConstraintsSha256','constraintsPointer']
            .some(key=>args[key]!==undefined);
          if (chosen) constraints=await this.#modelInputs(alias,{inputs:args.constraints,input:args.constraintsInput,
            expectedInputSha256:args.expectedConstraintsSha256,inputPointer:args.constraintsPointer},
            'Complete delivery constraints',GRANT_MAX_BUNDLE_BYTES);
          value=scheduleCohortAdoption({document,...(constraints===undefined?{}:{constraints}),
            ...(args.name===undefined?{}:{name:args.name}),
            ...(args.method===undefined?{}:{method:args.method}),
            ...(args.maxSearchSteps===undefined?{}:{maxSearchSteps:args.maxSearchSteps})});
        } else if (verb === 'adoption_compare') {
          const candidate=await this.#modelInputs(alias,{inputs:args.candidate,input:args.candidateInput,
            expectedInputSha256:args.expectedCandidateSha256,inputPointer:args.candidatePointer},
            'Complete adoption candidate',GRANT_MAX_BUNDLE_BYTES);
          value=compareCohortAdoption({beforeDocument:document,afterDocument:candidate,options:args.options});
        } else if (verb === 'adoption_prepare') {
          const {caseId,inputs,input,expectedInputSha256,inputPointer,...body}=rest;
          value=await this.#adoptionPrepare(alias,client,caseId,{...body,document});
        } else if (verb === 'adoption_save') {
          value=await this.#adoptionSave(alias,client,document,args.expectedPreparedSha256);
        } else if (verb === 'adoption_export') {
          original={...exportCohortAdoption(document,args.format),status:200,
            source:{kind:'GRANT_COHORT_ADOPTION',workspace:alias,selectionSha256:binding.selectionSha256,operation:verb}};
        } else throw failure('GRANT_TOOL_UNKNOWN','Choose an original adoption operation.');
      }
      if (value!==undefined) original={value,bytes:json(value),mediaType:'application/json',status:200,
        filename:verb.replaceAll('_','-')+'.json',
        source:{kind:'GRANT_COHORT_ADOPTION',workspace:alias,selectionSha256:binding.selectionSha256,operation:verb}};
    }
    else if (verb === 'cohort_seed') original=await client.cohortSeed(args.caseId,args.expectedVersion,args.tranche);
    else if (verb === 'cohort_preview') original=await client.cohortPreview(args.caseId,args.expectedVersion,
      await this.#modelInputs(alias,args,'Cohort',GRANT_MAX_BUNDLE_BYTES));
    else if (verb === 'cohort_prepare') {
      const {caseId,input,inputPointer,expectedInputSha256,...body}=rest;
      original=await client.cohortPrepare(caseId,{...body,inputs:await this.#modelInputs(alias,args,'Cohort',GRANT_MAX_BUNDLE_BYTES)});
    }
    else if (verb === 'settlement_correction_preview') {
      const {caseId,...body}=rest;original=await client.settlementCorrectionPreview(caseId,body);
    }
    else if (verb === 'settlement_correct') {
      const {caseId,...body}=rest;original=await client.settlementCorrect(caseId,body);
    }
    else if (verb === 'implementation_source') original=await client.implementationSource(args.caseId,args.expectedVersion,args.sourceId,args.asOfAt);
    else if (verb === 'implementation_preview') original=await client.implementationPreview(args.caseId,args.expectedVersion,
      await this.#modelInputs(alias,args,'Implementation',GRANT_MAX_BUNDLE_BYTES));
    else if (verb === 'implementation_prepare') {
      const {caseId,input,inputPointer,expectedInputSha256,...body}=rest;
      original=await client.implementationPrepare(caseId,{...body,inputs:await this.#modelInputs(alias,args,'Implementation',GRANT_MAX_BUNDLE_BYTES)});
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
    else if (verb === 'amendment_preview') original = await client.amendmentPreview(args.caseId, args.expectedVersion,
      await this.#modelInputs(alias, args, 'Plan amendment'));
    else if (verb === 'amendment_calendar_export') original = await client.amendmentCalendarExport(args.caseId,
      await this.#modelInputs(alias, args, 'Amendment calendar export'));
    else if (verb === 'forecast_preview') original = await client.forecastPreview(args.caseId, args.expectedVersion,
      await this.#modelInputs(alias, args, 'Forecast'));
    else if (verb === 'forecast_save') {
      const {caseId, input, inputPointer, expectedInputSha256, ...body} = rest;
      original = await client.forecastSave(caseId, {...body, inputs:await this.#modelInputs(alias, args, 'Forecast')});
    } else if (verb === 'portfolio_seed') {
      const options = {};
      if (args.installationSelections !== undefined) options.installationSelections = args.installationSelections;
      if (['inputs','input','inputPointer','expectedInputSha256'].some(key => args[key] !== undefined)) {
        options.inputs = await this.#modelInputs(alias, args, 'Portfolio');
      }
      original = await client.portfolioSeed(args.caseId, args.expectedVersion, args.forecastId, options);
    } else if (verb === 'portfolio_preview') original = await client.portfolioPreview(args.caseId, args.expectedVersion,
      await this.#modelInputs(alias, args, 'Portfolio'));
    else if (verb === 'portfolio_save') {
      const {caseId, input, inputPointer, expectedInputSha256, ...body} = rest;
      original = await client.portfolioSave(caseId, {...body, inputs:await this.#modelInputs(alias, args, 'Portfolio')});
    } else if (verb === 'portfolio_selection') original = await client.portfolioSelection(args.caseId, args.expectedVersion,
      args.portfolioId, args.alternativeId);
    else if (verb === 'export') original = await client.download(args.kind, rest);
    else if (['plan_import','case_import','source_attach','intake','support_preview','support_receive','buyer_preview','buyer_receive','settlement_preview','settlement_receive'].includes(verb)) {
      const {input, expectedInputSha256, ...body} = rest, selected = await this.#input(alias, input, expectedInputSha256);
      if (verb === 'settlement_preview') {
        const selection=body.name===undefined&&body.selections===undefined?undefined:{name:body.name,selections:body.selections};
        original=await client.settlementPreview(body.caseId,body.expectedVersion,selected.bytes,body.filename,selection);
      } else if (verb === 'settlement_receive') {
        const {caseId,...fields}=body;original=await client.settlementReceive(caseId,selected.bytes,fields);
      } else if (verb === 'support_preview') {
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
      ['planId','caseId','intakeId','forecastId','portfolioId','alternativeId','sourceId','reviewId','reviewSha256','installationId','revision','after','before','limit','kind','format',
        'requestId','riskId','beforeReviewId','beforeReviewSha256','afterReviewId','afterReviewSha256','expectedComparisonSha256','expectedRevision','expectedVersion','input','inputPointer','expectedInputSha256',
        'workshareCaseId','expectedSourceSha256','packetSourceId','expectedPacketSha256','installationRefs','groupId',
        'expectedPreparedSha256','parentSourceId','expectedParentSha256','planSourceId','expectedPlanSha256','expectedReviewBusinessSha256',
        'filename','expectedPreviewSha256','deploymentId','tranche','asOfDate','asOfAt','receiptId','cohortReviewIds','implementationReviewIds','sha256',
        'startDate','endDate','expectedReportSha256','rowId','expectedCashId','decision','expectedReviewSha256','confirmedOn','deadlineOn','submittedOn','formReference','outcomeId','state','date'].includes(key)))});
  }
  async call(name, args = {}) {
    need(!this.#closing, 'GRANT_CLOSING', 'The original grant client is closing.');
    const pending = this.#execute(name, args); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  close() {
    this.#closing = true;
    if (!this.#close) {
      const closing = (async () => {
        await Promise.allSettled([...this.#pending]);
        // Readers and clients are independent owned resources. Keep their actual
        // instances and attempt every drain even if another owner reports failure.
        const owners = [
          {name:'retained file readers', close:() => this.#readers.close()},
          ...[...this.#clients].map(([alias, client]) => ({name:alias, close:() => client.close()})),
        ];
        const outcomes = await Promise.allSettled(owners.map(owner => Promise.resolve().then(owner.close)));
        const failed = outcomes.flatMap((result, index) => result.status === 'rejected'
          ? [{owner:owners[index].name, error:result.reason}] : []);
        if (failed.length) {
          const first = failed[0].error;
          throw Object.assign(failure('GRANT_SHUTDOWN_INCOMPLETE',
            'An original grant reader or service has not finished shutdown.'), {
              cause:first,
              failures:failed.map(item => ({owner:item.owner, code:item.error?.code ?? null,
                message:String(item.error?.message ?? item.error).slice(0,1024)})),
            });
        }
      })();
      this.#close = closing;
      closing.catch(() => { if (this.#close === closing) this.#close = null; });
    }
    return this.#close;
  }
}
