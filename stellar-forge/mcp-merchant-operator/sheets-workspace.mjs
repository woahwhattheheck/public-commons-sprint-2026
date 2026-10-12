// MIT. Browser and agent authoring over the one original Sheets workspace.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { MAX_CAPTURE_BYTES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/declaration.mjs';
import { normalizeConnections } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/workspace/provider.mjs';

export const SHEETS_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.sheets-authoring-connection.v1';
const NATIVE_SCHEMA = 'stellar-forge.sheets-authoring.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const text = { type: 'string', minLength: 1, maxLength: 128 };
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: UUID.source };
const digest = { type: 'string', pattern: SHA256.source };
const revision = { type: 'integer', minimum: 0 };
const version = { type: 'integer', minimum: 1 };
const selection = { type: ['integer', 'null'], minimum: 1 };
const range = { type: 'string', minLength: 1, maxLength: 512 };
const selected = { workspace: alias };
const read = { readOnly: true, idempotent: true };
const column = { type: 'object', additionalProperties: false,
  properties: { column: { type: 'string', pattern: '^[A-Z]+$' }, header: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: ['string', 'integer', 'number', 'boolean'] },
    nullable: { type: 'boolean' }, formula: { type: 'string', enum: ['reject', 'effective'] } },
  required: ['column', 'header', 'type', 'nullable', 'formula'] };
const draftSchema = { type: 'object', additionalProperties: false, properties: {
  captureId: uuid, title: text, name: text, range, columns: { type: 'object', minProperties: 1, additionalProperties: column },
  emptyRows: { type: 'string', enum: ['skip', 'reject'] }, mode: { type: 'string', enum: ['capture', 'live'] },
  connectionAlias: { type: ['string', 'null'] } },
  required: ['captureId', 'title', 'name', 'range', 'columns', 'emptyRows', 'mode', 'connectionAlias'] };


const deploymentFile = { type: 'string', enum: ['dataset.csv','dataset.json','seller.json','source.json','binding.json'] };
const merchantTerms = { type: 'object', additionalProperties: false, properties: {
  origin: { type:'string', minLength:1, maxLength:2048 }, path: { type:'string', minLength:1, maxLength:1024 },
  payment: { type:'object', additionalProperties:false, properties: {
    scheme:text, network:text, asset:{type:'string',minLength:1,maxLength:512},
    payTo:{type:'string',minLength:1,maxLength:512}, amount:{type:'string',pattern:'^[0-9]+$'},
    maxTimeoutSeconds:{type:'integer',minimum:1}
  }, required:['scheme','network','asset','payTo','amount','maxTimeoutSeconds'] }
}, required:['origin','path','payment'] };
const deploymentRuntime = { type:'object', additionalProperties:false, properties: {
  port:{type:'integer',minimum:0,maximum:65535}, facilitator:{type:'string',minLength:1,maxLength:2048},
  allowLocalFacilitator:{type:'boolean'}
} };

export function sheetsWorkspaceTools(tool) {
  return [
    tool('merchant_sheets_workspaces', 'List host-declared original Sheets source-authoring aliases and this MCP process ownership. Does not open a model, query Google or start a publisher.', {}, [], read),
    tool('merchant_sheets_open', 'Open one existing original Sheets source workspace under its native lease and serve its same browser on loopback. The browser and these tools share one model. Release a separately running source CLI first. This does not start the publisher or read Google.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_sheets_close', 'Close this exact owned Sheets/browser instance, drain its original operations, publisher and deployment console/owned merchant, release verified file reads and its original lease. Saved source versions and operation receipts remain.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_sheets_status', 'Read original source selection, current draft/revision, capture and version pages, latest preview, native operation IDs and current browser/publisher/deployment ownership. Public samples retain original values; local storage and credential references are omitted.', {
      ...selected, capturesOffset: revision, versionsOffset: revision, limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['workspace'], read),
    tool('merchant_sheets_inputs', 'List host-declared input aliases, or inspect one original observation/private packet file to obtain its current exact bytes and SHA256. Does not import, parse source values or read Google. Import requires this reviewed SHA256.', {
      ...selected, input: alias,
    }, ['workspace'], read),
    tool('merchant_sheets_import', 'Import one host-declared exact Spreadsheet CellData observation with its host-bound original requested range. Recheck expectedSha256 before the original importer retains the bytes. Reusing requestId with the same retained bytes preserves native idempotency; use merchant_sheets_operation or resume if the host input has changed. This does not query Google or change the draft.', {
      ...selected, input: alias, expectedSha256: digest, title: text, requestId: uuid,
    }, ['workspace', 'input', 'expectedSha256', 'title', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_import_packet', 'Import one host-declared original private source packet as a capture-backed editable draft. Rechecks original packet/hash bindings and the current draft revision; live credential references are never imported. Reuse the same requestId after an uncertain reply.', {
      ...selected, input: alias, expectedSha256: digest, title: text, expectedDraftRevision: revision, requestId: uuid,
    }, ['workspace', 'input', 'expectedSha256', 'title', 'expectedDraftRevision', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_workbook', 'Read original Google workbook metadata through one existing host-declared connection: exact workbook identity and tab IDs/titles. Does not capture cells or grant access. Workbook URLs must be ordinary Google Sheets URLs.', {
      ...selected, connectionAlias: text, spreadsheet: { type: 'string', minLength: 1, maxLength: 2048 },
    }, ['workspace', 'connectionAlias', 'spreadsheet'], { readOnly: true, openWorld: true }),
    tool('merchant_sheets_capture', 'Explicitly read and retain the selected original Google tab and bounded CellData range through an existing host connection. The original request ID and read receipt govern recovery; an uncertain Google request is never automatically repeated by resume.', {
      ...selected, connectionAlias: text, spreadsheet: { type: 'string', minLength: 1, maxLength: 2048 },
      sheetId: revision, sheetTitle: text, range, title: text, requestId: uuid,
    }, ['workspace', 'connectionAlias', 'spreadsheet', 'sheetId', 'sheetTitle', 'range', 'title', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_sheets_columns', 'Inspect actual retained headers, types, formula/blank counts and source samples for one original capture and an optional bounded subrange. Nothing is public until the operator explicitly selects columns and publishes through the original publisher.', {
      ...selected, captureId: uuid, range,
    }, ['workspace', 'captureId'], read),
    tool('merchant_sheets_draft_save', 'Save the explicit public projection against the original expected draft revision. Column letters and exact headers, scalar types, blank and formula policies retain their original meanings. No new provider observation or publication occurs.', {
      ...selected, draft: draftSchema, expectedRevision: revision, requestId: uuid,
    }, ['workspace', 'draft', 'expectedRevision', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_preview', 'Validate the complete selected retained range with the original typed extractor for this saved draft revision. Returns its retained preview ID, complete row count and first25 public rows. Live-source authoring preview uses the retained observation, not another Google read.', {
      ...selected, draftRevision: revision, requestId: uuid,
    }, ['workspace', 'draftRevision', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_version_save', 'Review the exact original draft/preview and save a source version, installing its managed source declaration only when the current selection still matches. The original request UUID prevents duplicate saved versions after a lost reply.', {
      ...selected, draftRevision: revision, previewId: uuid, reviewer: text, note: { type: 'string', minLength: 1, maxLength: 2000 },
      expectedSelectedVersion: selection, requestId: uuid,
    }, ['workspace', 'draftRevision', 'previewId', 'reviewer', 'note', 'expectedSelectedVersion', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_version', 'Read one original saved source version, reviewer and public projection. Does not replace the current draft or selection.', {
      ...selected, versionId: version,
    }, ['workspace', 'versionId'], read),
    tool('merchant_sheets_compare', 'Compare two original source versions and their retained typed previews, including observation/range/projection identity. Original values and nulls are returned without recomputing the source or performing a provider read.', {
      ...selected, leftVersion: version, rightVersion: version,
    }, ['workspace', 'leftVersion', 'rightVersion'], read),
    tool('merchant_sheets_select', 'Select a saved source version using the current expected selection and original request UUID. It changes the managed source used by a new original publisher plan; existing plans and buyer snapshots retain their native source.', {
      ...selected, versionId: version, expectedSelectedVersion: selection, requestId: uuid,
    }, ['workspace', 'versionId', 'expectedSelectedVersion', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_operation', 'Read the original request receipt and current source/publisher state after a lost response. A historical publisher-open receipt does not establish that its old URL is still running.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], read),
    tool('merchant_sheets_resume', 'Continue only the original retained interrupted request. Uses its saved bytes and original engine recovery; it never repeats an uncertain Google request. Pending stays attached to the same request and terminal errors retain their original code.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], { idempotent: true }),
    tool('merchant_sheets_publisher_open', 'Open the SAME original publisher against the exact selected source version. Saved enabled original publication policies may resume. A replay returns the original receipt plus live currentPublisher; use only that current URL. Does not start a second publisher for the same directory.', {
      ...selected, expectedSelectedVersion: version, requestId: uuid,
    }, ['workspace', 'expectedSelectedVersion', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_sheets_publisher_close', 'Close and drain the original publisher owned by this source workspace using one retained request UUID. Original plans, candidates, versions, schedules and buyer handoffs remain.', {
      ...selected, requestId: uuid,
    }, ['workspace', 'requestId'], { idempotent: true, destructive: true }),

    tool('merchant_sheets_deployment_status', 'Read original published runs matched to saved Sheets source versions, deployment request history, immutable release selection and current original merchant/console ownership. Uses retained native data; no Google read, extraction or merchant start.', {
      ...selected, runsOffset:revision, operationsOffset:revision, limit:{type:'integer',minimum:1,maximum:100},
    }, ['workspace'], read),
    tool('merchant_sheets_deployment_review', 'Bind one originally published run and exact retained source version to reviewed public merchant terms. Reuses the original candidate and seller compiler. The amount is an atomic integer string. Retain requestId and returned reviewSha256.', {
      ...selected, versionId:version, runId:uuid, terms:merchantTerms, requestId:uuid,
    }, ['workspace','versionId','runId','terms','requestId'], {idempotent:true}),
    tool('merchant_sheets_deployment_prepare', 'Prepare the five original dataset-release files from the completed deployment review and exact reviewSha256. Retains the original dataset directory and public projection; no raw Sheet cells, Google credentials, extraction or version-store migration. Same request recovery completes the same package.', {
      ...selected, reviewRequestId:uuid, expectedReviewSha256:digest, requestId:uuid,
    }, ['workspace','reviewRequestId','expectedReviewSha256','requestId'], {idempotent:true}),
    tool('merchant_sheets_deployment_package', 'Inspect the exact completed original package request, public file hashes, source binding and merchant configuration hash. Package and dataset paths are host-local and omitted from MCP output.', {
      ...selected, packageRequestId:uuid,
    }, ['workspace','packageRequestId'], read),
    tool('merchant_sheets_deployment_stage', 'Stage the reviewed package through the original SF82 release store. Requires the package source SHA256 and a stable immutable release ID. Reusing an ID requires identical package, label and normalized runtime. Does not select or start the merchant.', {
      ...selected, packageRequestId:uuid, expectedSourceSha256:digest, id:text,
      label:{type:'string',minLength:1,maxLength:240}, runtime:deploymentRuntime, requestId:uuid,
    }, ['workspace','packageRequestId','expectedSourceSha256','id','requestId'], {idempotent:true}),
    tool('merchant_sheets_deployment_compare', 'Compare retained merchant releases through the original SF82 comparator. Omit from to use the original active selection. Returns the current selection generation and original diff; does not change either release or the dataset.', {
      ...selected, from:{type:['string','null']}, to:text,
    }, ['workspace','to'], read),
    tool('merchant_sheets_deployment_console_open', 'Open the original loopback SF82 deployment console inside this same Sheets workspace. That original console solely owns merchant lifecycle. CurrentDeployment establishes the live URL/instance; a recorded receipt alone does not. Opening does not start a merchant.', {
      ...selected, requestId:uuid,
    }, ['workspace','requestId'], {idempotent:true}),
    tool('merchant_sheets_deployment_console_close', 'Close only the exact current deployment console instance, drain its owned merchant and retain release/dataset state. Reusing the original request never closes a successor console.', {
      ...selected, instanceId:uuid, requestId:uuid,
    }, ['workspace','instanceId','requestId'], {idempotent:true,destructive:true}),
    tool('merchant_sheets_deployment_command', 'Run one explicit activate, rollback, run, stop or restart through the SAME original console used by the browser. Use current consoleInstanceId and expectedGeneration; use the inspected target release expectedDigest except for stop, and exact merchant instanceId for stop/restart. Activate uses id; rollback uses to or original previous release. Original receiving review may be supplied. After an uncertain local reply, operation/resume only observes current native state and NEVER replays the command; inspect before a new explicit request.', {
      ...selected, action:{type:'string',enum:['activate','rollback','run','stop','restart']},
      consoleInstanceId:uuid, expectedGeneration:revision, expectedDigest:digest, instanceId:uuid, id:text, to:text,
      reason:{type:'string',maxLength:2000}, receiving:{type:'object'}, requestId:uuid,
    }, ['workspace','action','consoleInstanceId','expectedGeneration','requestId'], {idempotent:true,destructive:true,openWorld:true}),
    tool('merchant_sheets_deployment_file_read', 'Read one exact verified original package file through the existing SHA256-pinned retained-file reader. Files over its existing 256,000,000-byte limit use the original browser/CLI download. Reuse readId, expectedSha256 and offset; after expiry/restart omit readId and resume the SAME package/file/hash/offset. No host path input.', {
      ...selected, packageRequestId:uuid, file:deploymentFile, readId:uuid, expectedSha256:digest, offset:revision,
      limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES},
    }, ['workspace','packageRequestId','file'], read),
    tool('merchant_sheets_deployment_file_release', 'Release only the current alias retained-file snapshot. Does not delete a package, source, dataset version or release.', {
      ...selected, readId:uuid,
    }, ['workspace','readId'], read),
    tool('merchant_sheets_packet_read', 'Read a private portable source packet from the original saved version. Live credential references are stripped by the original exporter. Returns SHA256-pinned base64 chunks through the existing retained-file reader; reuse readId, expectedSha256 and offset. After expiry or restart omit readId and resume the SAME version/hash/offset.', {
      ...selected, versionId: version, readId: uuid, expectedSha256: digest, offset: revision,
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'versionId'], read),
    tool('merchant_sheets_packet_release', 'Release only this alias original verified packet-read snapshot. Does not delete a source version, capture, handoff or workspace.', {
      ...selected, readId: uuid,
    }, ['workspace', 'readId'], read),
  ];
}

function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw failure('CONFIGURATION_ERROR', 'Declare a nonempty host path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
function nativeId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure('INVALID_PARAMS', 'Use the original request/instance UUID.');
  return value;
}
function expectedDigest(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw failure('INVALID_PARAMS', 'Use the inspected exact SHA256.');
  return value;
}
function nativeVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw failure('INVALID_PARAMS', 'Select an original positive source version.');
  return value;
}
function decode(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('SHEETS_INPUT_JSON_INVALID', 'The declared input must be complete UTF-8 JSON.'); }
}
async function privateFile(path, maximum, consume = false) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.mode & 0o077n || before.size > BigInt(maximum))
      throw failure('SHEETS_INPUT_PRIVATE_FILE_REQUIRED', 'Use one private regular file within the original size limit.');
    const hash = createHash('sha256'), blocks = [], buffer = Buffer.alloc(65536);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      if (position > maximum) throw failure('SHEETS_INPUT_SIZE_LIMIT', 'The declared original file exceeds its size limit.');
      const block = buffer.subarray(0, bytesRead); hash.update(block);
      if (consume) blocks.push(Buffer.from(block));
    }
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(position) !== after.size)
      throw failure('SHEETS_INPUT_CHANGED', 'The declared file changed while being read. Inspect its new original identity.');
    return { sha256: hash.digest('hex'), bytes: position, ...(consume ? { content: Buffer.concat(blocks, position) } : {}) };
  } catch (issue) {
    if (/^SHEETS_/.test(issue.code ?? '')) throw issue;
    throw failure('SHEETS_INPUT_UNAVAILABLE', 'The host-declared private input is unavailable. Check that same input alias on the host.');
  } finally { await handle?.close(); }
}
async function readConnectionFile(path) {
  return decode((await privateFile(path, 1024 * 1024, true)).content);
}

/** Host configuration only. Native model validates its saved database on explicit open. */
export async function readSheetsWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await readConnectionFile(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== SHEETS_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare between1 and32 original Sheets source workspaces.');
  const base = dirname(path), directories = new Set(), workspaces = Object.create(null);
  for (const [key, input] of Object.entries(raw.workspaces)) {
    identifier(key, 'Sheets workspace alias');
    exact(input, ['label', 'directory', 'connections', 'inputs', 'seller', 'resource'], ['directory']);
    const directory = hostPath(input.directory, base);
    await privateSupportDirectory(directory);
    const canonical = await realpath(directory), database = await lstat(join(directory, 'sources.sqlite'));
    if (canonical !== directory || directories.has(canonical) || !database.isFile() || database.isSymbolicLink() ||
        database.nlink !== 1 || database.mode & 0o077)
      throw failure('CONFIGURATION_ERROR', 'Bind each existing private original Sheets source database through one canonical alias.');
    directories.add(canonical);
    let connections = {};
    if (input.connections !== undefined) {
      const file = hostPath(input.connections, base), declarations = await readConnectionFile(file);
      if (!plain(declarations)) throw failure('CONFIGURATION_ERROR', 'Use the original named Sheets connection map.');
      connections = normalizeConnections(Object.fromEntries(Object.entries(declarations).map(([alias, definition]) =>
        [alias, plain(definition) && definition.oauthDirectory !== undefined
          ? { ...definition, oauthDirectory: hostPath(definition.oauthDirectory, dirname(file)) } : definition])));
    }
    if (input.inputs !== undefined && (!plain(input.inputs) || Object.keys(input.inputs).length > 64))
      throw failure('CONFIGURATION_ERROR', 'Declare at most64 named original observation or private packet inputs.');
    const inputs = Object.create(null);
    for (const [alias, item] of Object.entries(input.inputs ?? {})) {
      identifier(alias, 'Sheets input alias');
      exact(item, ['kind', 'file', 'range', 'label'], ['kind', 'file']);
      if (!['observation', 'packet'].includes(item.kind) ||
          item.kind === 'observation' && (typeof item.range !== 'string' || !item.range || item.range.length > 512) ||
          item.kind === 'packet' && item.range !== undefined)
        throw failure('CONFIGURATION_ERROR', 'An observation needs its exact provider-requested qualified range; a packet retains its own range.');
      inputs[alias] = { kind: item.kind, file: hostPath(item.file, base), range: item.range ?? null,
        label: line(item.label ?? alias, 'Sheets input label') };
    }
    if ((input.seller === undefined) !== (input.resource === undefined))
      throw failure('CONFIGURATION_ERROR', 'Declare seller and resource together for the original buyer handoff.');
    for (const key of ['seller', 'resource']) if (input[key] !== undefined) {
      let url;
      try { url = new URL(input[key]); } catch {}
      if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw failure('CONFIGURATION_ERROR', 'Use a host-declared HTTP(S) seller and resource without URL credentials or fragments.');
    }
    workspaces[key] = { label: line(input.label ?? key, 'Sheets workspace label'), directory, connections, inputs,
      seller: input.seller ?? null, resource: input.resource ?? null };
  }
  return { schema: SHEETS_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}

// Public column names and values are data, even when a selected alias happens
// to be named "directory" or "sourceFile". Never filter a public row/projection.
const dataFields = new Set(['draft', 'columns', 'sample', 'columnTypes']);
const privateFields = new Set(['directory', 'sourceFile', 'targetDirectory', 'publisherDirectory', 'manifestFile',
  'resourceFile', 'oauthDirectory', 'accessTokenEnv', 'root', 'releaseDirectory', 'packageDirectory', 'datasetDirectory']);
function view(value) {
  if (Array.isArray(value)) return value.map(view);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key)).map(([key, item]) => {
    if (dataFields.has(key)) return [key, structuredClone(item)];
    if (key === 'error' && plain(item)) return [key, { code: item.code ?? 'SHEETS_OPERATION_FAILED', status: item.status ?? null }];
    return [key, view(item)];
  }));
}
function safeError(issue) {
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(issue?.code ?? '') ? issue.code : 'SHEETS_WORKSPACE_OPERATION_FAILED';
  return failure(code, 'Original Sheets operation: ' + code + '. Read its original request receipt and current source state before continuing.');
}

export class MerchantSheetsWorkspaces {
  #config; #entries = new Map(); #opening = new Map(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'SHEETS_PACKET' });
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.sheetsWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.sheetsWorkspaces?.workspaces ?? {}).map(([workspace, value]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: value.label, open: Boolean(entry), opening: this.#opening.has(workspace),
          closing: Boolean(entry?.closing), instanceId: entry?.instanceId ?? null,
          browserUrl: entry?.service.url ?? null, inputAliases: Object.keys(value.inputs),
          connectionAliases: Object.keys(value.connections), buyerConfigured: Boolean(value.seller) };
      }) };
  }
  #definition(alias) {
    identifier(alias, 'Sheets workspace alias');
    const definition = this.#config.sheetsWorkspaces?.workspaces[alias];
    if (!definition) throw failure('SHEETS_WORKSPACE_NOT_CONFIGURED', 'Choose a host-declared alias from merchant_sheets_workspaces.');
    return definition;
  }
  #entry(alias) {
    this.#definition(alias);
    const entry = this.#entries.get(alias);
    if (!entry) throw failure('SHEETS_WORKSPACE_NOT_OPEN', 'Explicitly open this original Sheets source workspace first.');
    if (entry.closing) throw failure('SHEETS_WORKSPACE_CLOSING', 'This owned original Sheets workspace is draining.');
    return entry;
  }
  #scope(alias) { return 'sheets:' + alias + ':' + this.#definition(alias).directory; }
  async #state(entry, options) {
    const native = await entry.model.status(options);
    if (native.schema !== NATIVE_SCHEMA) throw failure('SHEETS_WORKSPACE_SCHEMA_CHANGED', 'Use the original supported Sheets source workspace.');
    return { workspace: entry.alias, instanceId: entry.instanceId, browserUrl: entry.service.url,
      native: view(native), packetReads: this.#reads.status(this.#scope(entry.alias)) };
  }
  async #open(alias) {
    const definition = this.#definition(alias);
    if (this.#entries.has(alias)) return this.#state(this.#entry(alias));
    if (this.#opening.has(alias)) return this.#opening.get(alias);
    const opening = (async () => {
      const { openSheetsAuthoring } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/workspace/model.mjs');
      const { serveSheetsAuthoring } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/workspace/server.mjs');
      let model, service;
      try {
        model = await openSheetsAuthoring({ directory: definition.directory, connections: definition.connections,
          seller: definition.seller, resource: definition.resource });
        service = await serveSheetsAuthoring({ workspace: model, port: 0 });
        if (this.#closing) throw failure('SHEETS_WORKSPACE_CLOSING', 'The merchant operator is closing.');
        const entry = { alias, model, service, instanceId: randomUUID(), pending: new Set(), closing: null };
        this.#entries.set(alias, entry);
        try { return await this.#state(entry); }
        catch (issue) { this.#entries.delete(alias); throw issue; }
      } catch (issue) { if (service) await service.close().catch(() => {}); else await model?.close().catch(() => {}); throw issue; }
    })();
    this.#opening.set(alias, opening);
    try { return await opening; } finally { this.#opening.delete(alias); }
  }
  async #closeEntry(entry) {
    if (!entry.closing) entry.closing = (async () => {
      await Promise.allSettled([...entry.pending]);
      try { await this.#reads.closeScope(this.#scope(entry.alias)); }
      finally {
        await entry.service.close();
        if (this.#entries.get(entry.alias) === entry) this.#entries.delete(entry.alias);
      }
      return { workspace: entry.alias, instanceId: entry.instanceId, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  #input(alias, input) {
    identifier(input, 'Sheets input alias');
    const configured = this.#definition(alias).inputs[input];
    if (!configured) throw failure('SHEETS_INPUT_NOT_CONFIGURED', 'Choose an original input declared by this host.');
    return configured;
  }
  async #inputs(alias, selectedInput) {
    const configured = this.#definition(alias).inputs;
    if (selectedInput === undefined) return { workspace: alias,
      inputs: Object.entries(configured).map(([input, value]) => ({ input, label: value.label, kind: value.kind, range: value.range })) };
    const input = this.#input(alias, selectedInput);
    const current = await privateFile(input.file, input.kind === 'packet' ? MAX_CAPTURE_BYTES * 2 : MAX_CAPTURE_BYTES);
    return { workspace: alias, input: selectedInput, label: input.label, kind: input.kind, range: input.range,
      file: { name: basename(input.file), bytes: current.bytes, sha256: current.sha256 } };
  }
  async #import(entry, args, kind) {
    const input = this.#input(entry.alias, args.input), expected = expectedDigest(args.expectedSha256);
    if (input.kind !== kind) throw failure('SHEETS_INPUT_KIND_CONFLICT', 'Choose the declared original input kind.');
    nativeId(args.requestId);
    const source = await privateFile(input.file, kind === 'packet' ? MAX_CAPTURE_BYTES * 2 : MAX_CAPTURE_BYTES, true);
    if (source.sha256 !== expected) throw failure('SHEETS_INPUT_CHANGED', 'Inspect the exact current host input before importing it.');
    const result = kind === 'packet'
      ? await entry.model.importPacket({ packet: decode(source.content), title: args.title,
        expectedDraftRevision: args.expectedDraftRevision, requestId: args.requestId })
      : await entry.model.importObservation({ resourceBytes: source.content, range: input.range,
        title: args.title, requestId: args.requestId });
    return { workspace: entry.alias, input: args.input, importedSha256: source.sha256, native: view(result) };
  }
  async #execute(entry, name, args) {
    const original = entry.model, { workspace, ...input } = args;
    switch (name) {
      case 'merchant_sheets_status': return this.#state(entry, input);
      case 'merchant_sheets_inputs': return this.#inputs(workspace, input.input);
      case 'merchant_sheets_import': return this.#import(entry, args, 'observation');
      case 'merchant_sheets_import_packet': return this.#import(entry, args, 'packet');
      case 'merchant_sheets_workbook': return { workspace, native: view(await original.workbook(input)) };
      case 'merchant_sheets_capture': return { workspace, native: view(await original.readLive(input)) };
      case 'merchant_sheets_columns': return { workspace, native: view(await original.inspectCapture(nativeId(input.captureId), input.range)) };
      case 'merchant_sheets_draft_save': return { workspace, native: view(await original.saveDraft(input)) };
      case 'merchant_sheets_preview': return { workspace, native: view(await original.preview(input)) };
      case 'merchant_sheets_version_save': return { workspace, native: view(await original.saveVersion(input)) };
      case 'merchant_sheets_version': return { workspace, native: view(original.version(nativeVersion(input.versionId))) };
      case 'merchant_sheets_compare': return { workspace, native: view(await original.compareVersions(nativeVersion(input.leftVersion), nativeVersion(input.rightVersion))) };
      case 'merchant_sheets_select': return { workspace, native: view(await original.selectVersion(input)) };
      case 'merchant_sheets_operation': {
        const receipt = original.operation(nativeId(input.requestId)), state = await original.status();
        return { workspace, receipt: view(receipt), currentPublisher: view(state.publisher), currentDeployment: view(state.deployment),
          currentSelection: state.selectedVersion, currentDraftRevision: state.draftRevision };
      }
      case 'merchant_sheets_resume': {
        const result = await original.resume(nativeId(input.requestId)), state = await original.status();
        return { workspace, native: view(result), receipt: view(original.operation(input.requestId)),
          currentPublisher: view(state.publisher), currentDeployment: view(state.deployment), currentSelection: state.selectedVersion };
      }
      case 'merchant_sheets_publisher_open':
      case 'merchant_sheets_publisher_close': {
        const result = name === 'merchant_sheets_publisher_open' ? await original.openPublisher(input) : await original.closePublisher(input);
        const state = await original.status();
        const { url: recordedBrowserUrl, ...receipt } = result;
        return { workspace, receipt: view({ ...receipt, ...(recordedBrowserUrl ? { recordedBrowserUrl } : {}) }),
          currentPublisher: view(state.publisher), currentSelection: state.selectedVersion };
      }
      case 'merchant_sheets_deployment_status': return { workspace, native: view(await original.deploymentStatus(input)) };
      case 'merchant_sheets_deployment_review': return { workspace, native: view(await original.reviewDeployment(input)) };
      case 'merchant_sheets_deployment_prepare': return { workspace, native: view(await original.prepareDeployment(input)) };
      case 'merchant_sheets_deployment_package': return { workspace, native: view(await original.inspectDeploymentPackage(nativeId(input.packageRequestId))) };
      case 'merchant_sheets_deployment_stage': return { workspace, native: view(await original.stageDeployment(input)) };
      case 'merchant_sheets_deployment_compare': return { workspace, native: view(await original.compareDeployment(input)) };
      case 'merchant_sheets_deployment_command': {
        const result = await original.commandDeployment(input), current = await original.deploymentStatus();
        return { workspace, receipt:view(result), currentDeployment:view(current.console), native:view(current.native) };
      }
      case 'merchant_sheets_deployment_console_open':
      case 'merchant_sheets_deployment_console_close': {
        const result = name === 'merchant_sheets_deployment_console_open'
          ? await original.openDeploymentConsole(input) : await original.closeDeploymentConsole(input);
        const current = await original.status(), { url:recordedConsoleUrl, ...receipt } = result;
        return { workspace, receipt:view({...receipt, ...(recordedConsoleUrl ? {recordedConsoleUrl} : {})}),
          currentDeployment:view(current.deployment) };
      }
      case 'merchant_sheets_deployment_file_read': {
        const packageRequestId = nativeId(input.packageRequestId), filename = input.file;
        if (!deploymentFile.enum.includes(filename)) throw failure('INVALID_PARAMS','Choose one original package filename.');
        const chunk = await this.#reads.read({ scope:this.#scope(workspace),
          key:'deployment:' + packageRequestId + ':' + filename, kind:'sheets-deployment-file',
          directory:this.#definition(workspace).directory,
          readId:input.readId, expectedSha256:input.expectedSha256, offset:input.offset, limit:input.limit,
          load:async () => { const file = await original.deploymentFile(packageRequestId,filename);
            return {name:file.filename,type:file.mime,bytes:file.bytes}; } });
        return { workspace, packageRequestId, file:filename, ...chunk };
      }
      case 'merchant_sheets_deployment_file_release':
        await this.#reads.release(this.#scope(workspace), nativeId(input.readId));
        return { workspace, readId:input.readId, state:'RELEASED' };
      case 'merchant_sheets_packet_read': {
        const versionId = nativeVersion(input.versionId); original.version(versionId);
        const chunk = await this.#reads.read({ scope: this.#scope(workspace), key: 'source-version:' + versionId,
          kind: 'sheets-source-packet', directory: this.#definition(workspace).directory,
          readId: input.readId, expectedSha256: input.expectedSha256, offset: input.offset, limit: input.limit,
          load: async () => { const packet = await original.exportVersion(versionId);
            return { name: packet.filename, type: packet.mime, bytes: packet.bytes }; } });
        return { workspace, versionId, ...chunk };
      }
      case 'merchant_sheets_packet_release':
        await this.#reads.release(this.#scope(workspace), nativeId(input.readId));
        return { workspace, readId: input.readId, state: 'RELEASED' };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown Sheets authoring operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('SHEETS_WORKSPACE_CLOSING', 'The merchant operator is closing.');
    try {
      if (name === 'merchant_sheets_workspaces') return this.summary;
      if (name === 'merchant_sheets_open') return await this.#open(args.workspace);
      if (name === 'merchant_sheets_close') {
        const entry = this.#entry(args.workspace);
        if (entry.instanceId !== nativeId(args.instanceId))
          throw failure('SHEETS_INSTANCE_CONFLICT', 'Close only the current Sheets instance owned by this MCP process.');
        return await this.#closeEntry(entry);
      }
      const entry = this.#entry(args.workspace), pending = Promise.resolve().then(() => this.#execute(entry, name, args));
      entry.pending.add(pending);
      try { return await pending; } finally { entry.pending.delete(pending); }
    } catch (issue) { throw safeError(issue); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await Promise.allSettled([...this.#opening.values()]);
        const results = await Promise.allSettled([...this.#entries.values()].map(entry => this.#closeEntry(entry)));
        await this.#reads.close();
        if (results.some(result => result.status === 'rejected'))
          throw failure('SHEETS_SHUTDOWN_INCOMPLETE', 'An original owned Sheets workspace reported incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
