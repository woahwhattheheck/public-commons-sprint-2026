// MIT. Receive one complete original Census edition through the maintained file engine.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { failure, identifier, plain } from './host-files.mjs';

export const CENSUS_GEOCODER_DOWNLOAD_STATE = 'stellar-forge.census-geocoder-mcp-download-state.v1';
export const CENSUS_GEOCODER_DOWNLOAD_RESULT = 'stellar-forge.census-geocoder-mcp-download-result.v1';
export const CENSUS_GEOCODER_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const CENSUS_GEOCODER_MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const EDITION_SCHEMA = 'stellar-forge.census-geocoder-edition.v1';
const WORKSPACE_SCHEMA = 'stellar-forge.census-geocoder-workspace.v1';
const BINDING_SCHEMA = 'stellar-forge.census-geocoder-download-binding.v1';
const PREFIX = 'CENSUS_GEOCODER';
const TOOL = 'merchant_census_geocoder_';
const TRANSFER = 'census_geocoder_edition';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const required = ['dataset.csv', 'dataset.json', 'review.json', 'source.json',
  'source/batch.json', 'source/input.csv', 'source/submitted.csv', 'source/response.csv', 'source/http.json'];
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => failure(PREFIX + '_DOWNLOAD_' + code, message);
const id = (value, name) => {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('CONFIGURATION', 'Use the original ' + name + ' UUID.');
  return value;
};
const digest = (value, name) => {
  if (typeof value !== 'string' || !HASH.test(value)) throw fail('CONFIGURATION', 'Use the original ' + name + ' SHA-256.');
  return value;
};
const relativeFile = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  value.split('/').length <= 32 && value.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !['.', '..'].includes(part)) &&
  value !== 'download-state' && !value.startsWith('download-state/') && value !== 'edition.json';

function binding(value) {
  if (!plain(value) || value.schema !== BINDING_SCHEMA) throw fail('BINDING_INVALID', 'Use the original Census download checkpoint.');
  identifier(value.workspace, 'Census workspace alias');
  id(value.workspaceId, 'workspace'); id(value.editionId, 'edition'); id(value.reviewId, 'review');
  digest(value.operationId, 'edition operation'); digest(value.datasetSnapshot, 'dataset snapshot');
  if (typeof value.hasSeller !== 'boolean') throw fail('BINDING_INVALID', 'Retain the original edition seller selection.');
  if (Object.keys(value).some(key => !['schema', 'workspace', 'workspaceId', 'editionId', 'reviewId', 'operationId', 'datasetSnapshot', 'hasSeller'].includes(key)))
    throw fail('BINDING_INVALID', 'The Census download binding contains unknown fields.');
  return { schema: BINDING_SCHEMA, workspace: value.workspace, workspaceId: value.workspaceId,
    editionId: value.editionId, reviewId: value.reviewId, operationId: value.operationId,
    datasetSnapshot: value.datasetSnapshot, hasSeller: value.hasSeller };
}
const publicBinding = value => { const { schema, ...selected } = value; return selected; };
function expected(value, options) {
  if (options.expectedWorkspaceId !== undefined && id(options.expectedWorkspaceId, 'workspace') !== value.workspaceId)
    throw fail('WORKSPACE_CHANGED', 'This is a different original Census workspace.');
  if (options.expectedEditionId !== undefined && id(options.expectedEditionId, 'edition') !== value.editionId)
    throw fail('EDITION_CHANGED', 'This is a different original Census edition.');
}

/** The exact native edition.json is retained; this projection only names its files for the shared receiver. */
function manifest(bytes, editionId, selection) {
  id(editionId, 'edition');
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > CENSUS_GEOCODER_MAX_MANIFEST_BYTES)
    throw fail('MANIFEST_INVALID', 'The original edition manifest exceeds its four-MiB native limit.');
  let value;
  try { value = JSON.parse(decode(bytes)); } catch { throw fail('MANIFEST_INVALID', 'Use the complete original UTF-8 edition.json.'); }
  if (!plain(value) || value.schema !== EDITION_SCHEMA || !HASH.test(value.operationId ?? '') ||
      !UUID.test(value.batchId ?? '') || !UUID.test(value.attemptId ?? '') || !UUID.test(value.reviewId ?? '') ||
      !plain(value.dataset) || !HASH.test(value.dataset.snapshot ?? '') || !plain(value.source) ||
      value.source.schema !== 'stellar-forge.census-geocoder-provenance.v1' || !Array.isArray(value.files) ||
      !value.files.length || value.files.length > 512)
    throw fail('MANIFEST_INVALID', 'The response is not a complete native Census edition manifest.');
  if (selection && (editionId !== selection.editionId || value.operationId !== selection.operationId || value.reviewId !== selection.reviewId || value.dataset.snapshot !== selection.datasetSnapshot))
    throw fail('EDITION_CHANGED', 'The original edition manifest differs from its authenticated retained workspace record.');
  const names = new Set();
  const files = value.files.map(file => {
    if (!plain(file) || !relativeFile(file.path) || names.has(file.path) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > CENSUS_GEOCODER_MAX_FILE_BYTES ||
        !HASH.test(file.sha256 ?? ''))
      throw fail('MANIFEST_INVALID', 'Use unique canonical native edition files within their original 64-MiB limit.');
    names.add(file.path); return { ...file, name: file.path };
  });
  if (selection && names.has('seller.json') !== selection.hasSeller)
    throw fail('EDITION_CHANGED', 'The received files differ from the original edition seller selection.');
  for (const name of required) if (!names.has(name))
    throw fail('MANIFEST_INVALID', 'The original edition is missing ' + name + '.');
  for (const name of names) {
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) if (names.has(parts.slice(0, index).join('/')))
      throw fail('MANIFEST_INVALID', 'An original edition file conflicts with a required directory.');
  }
  if (value.source.batchId !== value.batchId || value.source.attemptId !== value.attemptId ||
      value.source.reviewId !== value.reviewId || !HASH.test(value.source.responseSha256 ?? ''))
    throw fail('MANIFEST_INVALID', 'The original source provenance is not bound to this batch, attempt and review.');
  return { ...value, files };
}

async function originalClient(options) {
  if (options.client === undefined) return openMerchantFileClient({ url: options.url, tokenEnv: options.tokenEnv,
    environment: options.environment, signal: options.signal, errorPrefix: PREFIX, clientName: 'starforge-census-edition-receiver' });
  if (options.url !== undefined || !options.client || typeof options.client !== 'object' || Array.isArray(options.client) || typeof options.client.call !== 'function' ||
      typeof options.client.endpoint !== 'string' || !options.client.endpoint || options.client.endpoint.length > 4096 ||
      /[\0\r\n]/.test(options.client.endpoint))
    throw fail('CONFIGURATION', 'Supply one original native file client or the authenticated MCP endpoint.');
  return { endpoint: options.client.endpoint, call: options.client.call.bind(options.client) };
}

async function selectEdition(client, options) {
  const workspace = identifier(options.workspace, 'Census workspace alias'), editionId = id(options.editionId, 'edition');
  if (options.expectedManifestSha256 !== undefined) digest(options.expectedManifestSha256, 'manifest');
  let offset = 0, nativeId, instanceId;
  for (;;) {
    options.signal?.throwIfAborted();
    const result = await client.call(TOOL + 'status', { workspace, offset, limit: 100 });
    if (result.workspace !== workspace || result.state !== 'OPEN' || !plain(result.native) ||
        result.native.schema !== WORKSPACE_SCHEMA || !UUID.test(result.native.id ?? '') || !UUID.test(result.instanceId ?? ''))
      throw fail('WORKSPACE_CLOSED', 'Open this original Census workspace through its managed application or merchant tool before receiving an edition.');
    if (nativeId !== undefined && (nativeId !== result.native.id || instanceId !== result.instanceId))
      throw fail('WORKSPACE_CHANGED', 'The native workspace owner changed while its edition was being selected.');
    nativeId = result.native.id; instanceId = result.instanceId;
    if (options.expectedWorkspaceId !== undefined && id(options.expectedWorkspaceId, 'workspace') !== nativeId)
      throw fail('WORKSPACE_CHANGED', 'This MCP alias points to another original Census workspace.');
    const rows = result.native.editions, page = result.native.pages?.editions;
    if (!Array.isArray(rows) || !plain(page) || page.offset !== offset || page.limit !== 100 ||
        !Number.isSafeInteger(page.total) || page.total < 0 || rows.length > 100)
      throw fail('WORKSPACE_INVALID', 'The original Census edition history did not return its native page.');
    const row = rows.find(item => item?.id === editionId);
    if (row) {
      if (row.state !== 'COMPLETE' || !HASH.test(row.operationId ?? '') || !UUID.test(row.reviewId ?? '') ||
          !plain(row.dataset) || !HASH.test(row.dataset.snapshot ?? '') || typeof row.hasSeller !== 'boolean')
        throw fail('EDITION_INCOMPLETE', 'Finish the original reviewed Census edition before receiving it.');
      return { selection: binding({ schema: BINDING_SCHEMA, workspace, workspaceId: nativeId,
        editionId, reviewId: row.reviewId, operationId: row.operationId,
        datasetSnapshot: row.dataset.snapshot, hasSeller: row.hasSeller }), instanceId };
    }
    if (page.nextOffset === null) throw fail('EDITION_UNKNOWN', 'Choose an edition in this original Census workspace.');
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset !== offset + rows.length ||
        page.nextOffset <= offset || page.nextOffset >= page.total)
      throw fail('WORKSPACE_INVALID', 'The original edition history did not advance by its actual returned page.');
    offset = page.nextOffset;
  }
}

/** Adapt the original file calls in memory; this introduces no merchant endpoint or server-side protocol. */
function fileClient(client, selection, options) {
  let manifestSha256;
  const original = args => ({ workspace: selection.workspace, kind: 'edition-file', id: selection.editionId, ...args });
  async function probeManifest() {
    let read, outcome, primary;
    try {
      read = await client.call(TOOL + 'file', original({ filename: 'edition.json', offset: 0, limit: 1,
        ...(options.expectedManifestSha256 === undefined ? {} : { expectedSha256: options.expectedManifestSha256 }) }));
      const file = read.file;
      if (file?.name !== 'edition.json' || !Number.isSafeInteger(file.bytes) || file.bytes < 1 ||
          file.bytes > CENSUS_GEOCODER_MAX_MANIFEST_BYTES || !HASH.test(file.sha256 ?? '') ||
          options.expectedManifestSha256 !== undefined && file.sha256 !== options.expectedManifestSha256 ||
          !UUID.test(read.readId ?? '') || read.offset !== 0 || read.bytesRead !== 1 || read.encoding !== 'base64' ||
          typeof read.data !== 'string' || Buffer.from(read.data, 'base64').length !== 1 ||
          Buffer.from(read.data, 'base64').toString('base64') !== read.data ||
          read.nextOffset !== (file.bytes > 1 ? 1 : null))
        throw fail('MANIFEST_INVALID', 'The original edition manifest metadata or retained first byte changed.');
      manifestSha256 = file.sha256;
      outcome = { state: 'MANIFEST_RETAINED', exportId: selection.editionId, manifestFile: file };
    } catch (error) { primary = error; }
    if (read?.readId && read.nextOffset !== null) {
      try { await client.call(TOOL + 'file_release', { workspace: selection.workspace, readId: read.readId },
        { requestSignal: null, timeoutMs: 2000 }); }
      catch (error) {
        if (primary) throw new AggregateError([primary, error], 'Census manifest inspection and original read release did not finish.');
        throw error;
      }
    }
    if (primary) throw primary;
    return outcome;
  }
  return {
    // This stable native identity survives port-0 transport and process changes.
    endpoint: JSON.stringify(selection),
    async call(name, args, callOptions) {
      if (args.exportId !== selection.editionId) throw fail('EDITION_CHANGED', 'The retained file belongs to another edition.');
      if (name === TRANSFER + '_manifest') return probeManifest();
      if (name === TRANSFER + '_file_release')
        return client.call(TOOL + 'file_release', { workspace: selection.workspace, readId: args.readId }, callOptions);
      if (name !== TRANSFER + '_file' || !manifestSha256 || args.expectedManifestSha256 !== manifestSha256 ||
          args.file !== 'edition.json' && !relativeFile(args.file))
        throw fail('FILE_SELECTION', 'Receive exact files from the selected original edition manifest.');
      const result = await client.call(TOOL + 'file', original({ filename: args.file, expectedSha256: args.expectedSha256,
        offset: args.offset, limit: args.limit, ...(args.readId ? { readId: args.readId } : {}) }), callOptions);
      return { ...result, exportId: selection.editionId, manifestSha256 };
    }
  };
}
function receiver(selection) {
  return createRetainedDownload({
    manifestName: 'edition.json', parseManifest: (bytes, editionId) => manifest(bytes, editionId, selection),
    validateExportId: value => id(value, 'edition'), maximumBytes: CENSUS_GEOCODER_MAX_FILE_BYTES,
    maximumManifestBytes: CENSUS_GEOCODER_MAX_MANIFEST_BYTES, maximumCheckpointBytes: 4 * 1024 * 1024,
    stateSchema: CENSUS_GEOCODER_DOWNLOAD_STATE, resultSchema: CENSUS_GEOCODER_DOWNLOAD_RESULT,
    toolPrefix: TRANSFER, errorPrefix: PREFIX, clientName: 'starforge-census-edition-receiver', nestedFiles: true,
    describe: value => ({ ...(selection ? publicBinding(selection) : {}), operationId: value.operationId, batchId: value.batchId,
      attemptId: value.attemptId, reviewId: value.reviewId, dataset: value.dataset, source: value.source }),
  });
}
async function remote(options) {
  const client = await originalClient(options), selected = await selectEdition(client, options);
  return { ...selected, engine: receiver(selected.selection), client: fileClient(client, selected.selection, options) };
}

/** Inspect a selected complete edition without exporting, capturing, publishing or purchasing. */
export async function inspectCensusGeocoderEdition(options = {}) {
  const { selection, instanceId, engine, client } = await remote(options);
  const result = await engine.inspect({ client, exportId: selection.editionId, signal: options.signal });
  return { schema: 'stellar-forge.census-geocoder-mcp-download-inspection.v1', ...publicBinding(selection),
    instanceId, manifestSha256: result.manifestSha256, manifest: result.manifest,
    files: result.manifest.files.length, bytes: result.manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
}

/** Download all original members; the maintained engine retains and verifies every durable prefix. */
export async function downloadCensusGeocoderEdition(options = {}) {
  const { selection, engine, client } = await remote(options);
  const result = await engine.download({ client, exportId: selection.editionId, directory: options.directory,
    chunkSize: options.chunkSize, signal: options.signal, onProgress: options.onProgress,
    expectedManifestSha256: options.expectedManifestSha256 });
  options.signal?.throwIfAborted();
  const reopened = await reopenCensusGeocoderDownload({ directory: result.directory,
    expectedWorkspaceId: selection.workspaceId, expectedEditionId: selection.editionId,
    expectedManifestSha256: result.manifestSha256, signal: options.signal });
  return { ...result, schema: CENSUS_GEOCODER_DOWNLOAD_RESULT, ...publicBinding(selection),
    edition: reopened.edition, manifestSha256: result.manifestSha256 };
}

async function completed(options, action) {
  const engine = receiver();
  if (options.expectedManifestSha256 !== undefined) digest(options.expectedManifestSha256, 'manifest');
  return engine.lockedDownload(options.directory, async context => {
    options.signal?.throwIfAborted();
    let saved, selected;
    try {
      saved = JSON.parse(decode(await engine.bytesAt(join(context.stateDirectory, 'checkpoint.json'), 4 * 1024 * 1024)));
      selected = binding(JSON.parse(saved.endpoint));
    } catch (error) {
      if (error.code) throw error;
      throw fail('CHECKPOINT_INVALID', 'Reopen the original Census download directory and checkpoint.');
    }
    if (saved.schema !== CENSUS_GEOCODER_DOWNLOAD_STATE || saved.exportId !== selected.editionId)
      throw fail('CHECKPOINT_INVALID', 'The retained checkpoint belongs to another file workflow.');
    expected(selected, options);
    const original = await engine.bytesAt(join(context.root, 'edition.json'), CENSUS_GEOCODER_MAX_MANIFEST_BYTES);
    const manifestSha256 = hash(original);
    if (options.expectedManifestSha256 !== undefined && options.expectedManifestSha256 !== manifestSha256)
      throw fail('EDITION_CHANGED', 'The received manifest differs from the selected original digest.');
    const value = manifest(original, selected.editionId, selected);
    await engine.loadContext(context, original, selected.editionId, JSON.stringify(selected));
    for (const file of value.files) { options.signal?.throwIfAborted(); await engine.verifiedFile(join(context.root, file.name), file); }
    options.signal?.throwIfAborted();
    const { reopenEdition } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/edition.mjs');
    const edition = await reopenEdition(context.root);
    const result = { schema: CENSUS_GEOCODER_DOWNLOAD_RESULT, state: 'COMPLETE', directory: context.root,
      ...publicBinding(selected), exportId: selected.editionId, manifestSha256, files: value.files.length,
      bytes: value.files.reduce((sum, file) => sum + file.bytes, 0), edition };
    return action ? action(result, edition) : result;
  });
}

/** Reopen the complete received edition locally through its original native parser; no MCP connection is opened. */
export function reopenCensusGeocoderDownload(options = {}) { return completed(options); }

/** Query the received native dataset with its existing exact columns, filtering, sorting and cursors. */
export function queryCensusGeocoderDownload(options = {}) {
  const query = options.query ?? '';
  if (typeof query !== 'string' || query.length > 8192) throw fail('QUERY', 'Use the original dataset URL query string up to 8192 characters.');
  return completed(options, async (result, edition) => {
    options.signal?.throwIfAborted();
    const { loadDatasetConfig } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-handler.mjs');
    const dataset = await loadDatasetConfig(edition.datasetPath);
    options.signal?.throwIfAborted();
    return { ...result, schema: 'stellar-forge.census-geocoder-mcp-download-query.v1',
      response: dataset.handle({ query: new URLSearchParams(query) }) };
  });
}
