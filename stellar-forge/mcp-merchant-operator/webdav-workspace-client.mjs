// MIT. Complete caller for the original WebDAV merchant tools and file readers.
import { openMerchantFileClient } from './retained-download.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-contracts.mjs';
import {
  WEBDAV_TOOL_CONTRACTS, WEBDAV_MAX_RESULT_BYTES, validateWebDavRequest,
  validateWebDavFileSelector, validateWebDavFileMetadata, webDavChunk, webDavHash,
  webDavUuid, webDavSha, webDavError, webDavPlain
} from './webdav-workspace-contracts.mjs';

const methods = Object.freeze({
  status: 'merchant_webdav_status', open: 'merchant_webdav_open', close: 'merchant_webdav_close',
  source: 'merchant_webdav_source', catalogue: 'merchant_webdav_catalogue', listing: 'merchant_webdav_listing',
  capture: 'merchant_webdav_capture', mapping: 'merchant_webdav_mapping', edition: 'merchant_webdav_edition',
  preview: 'merchant_webdav_preview', merchant: 'merchant_webdav_merchant', publisher: 'merchant_webdav_publisher',
  operation: 'merchant_webdav_operation', cancel: 'merchant_webdav_cancel', packet: 'merchant_webdav_packet',
  receive: 'merchant_webdav_receive', file: 'merchant_webdav_file', releaseFile: 'merchant_webdav_file_release'
});
export { WEBDAV_TOOL_CONTRACTS };
export async function createWebDavWorkspaceClient({
  client: provided, url, tokenEnv = 'MCP_ACCESS_TOKEN', environment = process.env, signal,
  maximumResultBytes = WEBDAV_MAX_RESULT_BYTES
} = {}) {
  if (!Number.isSafeInteger(maximumResultBytes) || maximumResultBytes < 1024 || maximumResultBytes > WEBDAV_MAX_RESULT_BYTES)
    throw webDavError('WEBDAV_CLIENT_RESULT_LIMIT', 'Choose an original full-result limit from 1024 bytes through 32 MiB.');
  if (provided && (url !== undefined || typeof provided.call !== 'function' || typeof provided.endpoint !== 'string'
      || !provided.endpoint || provided.endpoint.length > 4096 || /[\0\r\n]/.test(provided.endpoint)))
    throw webDavError('WEBDAV_CLIENT_CONFIGURATION', 'Use one original MCP client and endpoint identity, or the selected HTTP endpoint.');
  const transport = provided ?? await openMerchantFileClient({
    url, tokenEnv, environment, signal, errorPrefix: 'WEBDAV', clientName: 'starforge-webdav-workspace',
    maximumResponseBytes: 8 * 1024 * 1024
  });
  async function raw(name, args = {}, options = {}) {
    (options.requestSignal === null ? null : options.requestSignal ?? signal)?.throwIfAborted();
    const value = await transport.call(name, validateWebDavRequest(name, args), options);
    if (!webDavPlain(value)) throw webDavError('WEBDAV_CLIENT_RESPONSE', 'The original WebDAV tool returned no structured result.');
    return value;
  }
  async function release(workspace, readId) {
    if (!readId) return;
    await transport.call('merchant_webdav_file_release', { workspace, readId },
      { requestSignal: null, timeoutMs: 2000 }).catch(() => {});
  }
  async function readFileBytes({ workspace, selector, expectedSha256, maximumBytes = maximumResultBytes }, options = {}) {
    selector = validateWebDavFileSelector(selector);
    if (expectedSha256 !== undefined) webDavSha(expectedSha256);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > WEBDAV_MAX_RESULT_BYTES)
      throw webDavError('WEBDAV_CLIENT_RESULT_LIMIT', 'Use the disk receiver for files larger than 32 MiB.');
    const chunks = []; let offset = 0, readId = null, file;
    try {
      do {
        const limit = Math.min(MAX_RETAINED_CHUNK_BYTES, Math.max(1, maximumBytes - offset));
        let result;
        const args = { workspace, ...selector, offset, limit, ...(expectedSha256 ? { expectedSha256 } : {}),
          ...(readId ? { readId } : {}) };
        try { result = await raw('merchant_webdav_file', args, options); }
        catch (error) {
          if (error.code !== 'WEBDAV_READ_NOT_FOUND' || !readId) throw error;
          readId = null; delete args.readId; result = await raw('merchant_webdav_file', args, options);
        }
        readId = result.readId ?? null;
        validateWebDavFileMetadata(result.file);
        file ??= { ...result.file };
        if (file.bytes > maximumBytes || expectedSha256 !== undefined && file.sha256 !== expectedSha256)
          throw webDavError('WEBDAV_CLIENT_FILE_LIMIT', 'The selected original file differs from its requested digest or in-memory byte limit.');
        const part = webDavChunk(result, file, offset, limit, args.readId);
        chunks.push(part); offset += part.length; expectedSha256 = file.sha256;
        readId = result.nextOffset === null ? null : result.readId;
        if (offset === file.bytes) break;
      } while (true);
      const bytes = Buffer.concat(chunks, offset);
      if (webDavHash(bytes) !== file.sha256) throw webDavError('WEBDAV_CLIENT_FILE_CHANGED', 'The complete original file failed its selected SHA256.');
      return { file, bytes };
    } finally { await release(workspace, readId); }
  }
  async function readJsonFile(selection, options) {
    const value = await readFileBytes(selection, options);
    let json;
    try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value.bytes)); }
    catch { throw webDavError('WEBDAV_CLIENT_JSON_RESPONSE', 'The complete selected file is not valid UTF-8 JSON.'); }
    return { ...value, value: json };
  }
  async function request(name, args = {}, options = {}) {
    const result = await raw(name, args, options);
    if (!result.completeResult || options.resolveResult === false) return result;
    const retained = result.completeResult;
    try {
    if (retained.kind !== 'result' || typeof retained.id !== 'string'
        || !Number.isSafeInteger(retained.bytes) || retained.bytes < 0 || retained.bytes > maximumResultBytes)
      throw webDavError('WEBDAV_CLIENT_RESULT_LIMIT', 'Download the original complete-result file with the disk receiver.');
    webDavSha(retained.sha256);
    const complete = await readJsonFile({ workspace: args.workspace, selector: { kind: 'result', id: retained.id },
      expectedSha256: retained.sha256, maximumBytes: maximumResultBytes }, options);
    if (complete.file.bytes !== retained.bytes || !webDavPlain(complete.value))
      throw webDavError('WEBDAV_CLIENT_RESULT_CHANGED', 'The completed native result differs from its announced file identity.');
    return { ...result, ...complete.value, ...(result.state ? { state: result.state } : {}),
      completeResult: { ...retained, received: true } };
    } catch (error) { error.nativeEnvelope = result; throw error; }
  }
  async function assertWorkspace({ workspace, workspaceId }, options) {
    webDavUuid(workspaceId);
    const status = await request('merchant_webdav_status', { workspace }, options);
    if (status.state !== 'OPEN' || status.native?.id !== workspaceId)
      throw webDavError('WEBDAV_CLIENT_WORKSPACE_CHANGED', 'Open the original selected workspace and retain its UUID before continuing this operation.');
    return status;
  }
  async function *listingPages({ workspace, sourceId, id, offset = 0, limit = 100 }, options) {
    let binding = null;
    for (;;) {
      const page = await request('merchant_webdav_listing', { workspace, sourceId, id, offset, limit }, options);
      if (page.id !== id || page.offset !== offset || !Array.isArray(page.entries) || !Number.isSafeInteger(page.total)
          || page.total < 0 || page.entries.length !== Math.max(0, Math.min(limit, page.total - offset))
          || page.nextOffset !== (offset + limit < page.total ? offset + limit : null))
        throw webDavError('WEBDAV_CLIENT_LISTING_PAGE', 'The retained listing returned inconsistent original pagination.');
      const selected = JSON.stringify([page.id, page.sha256, page.total]);
      if (binding !== null && binding !== selected) throw webDavError('WEBDAV_CLIENT_LISTING_CHANGED', 'Continue pages from the same retained original listing.');
      binding = selected; yield page;
      if (page.nextOffset === null) return;
      offset = page.nextOffset;
    }
  }
  async function *historyPages({ workspace, offset = 0, limit = 50 }, options) {
    let binding = null;
    for (;;) {
      const page = await request('merchant_webdav_status', { workspace, offset, limit }, options);
      if (page.state !== 'OPEN' || !page.native?.pages) throw webDavError('WEBDAV_CLIENT_WORKSPACE_CLOSED', 'Open the original workspace before paging its history.');
      const selected = JSON.stringify([page.native.id, page.native.revision]);
      if (binding !== null && binding !== selected)
        throw webDavError('WEBDAV_CLIENT_HISTORY_CHANGED', 'The original workspace advanced; restart history paging at its current revision.');
      binding = selected; yield page;
      const remaining = Object.values(page.native.pages).some(row => row.nextOffset !== null);
      if (!remaining) return;
      offset += limit;
    }
  }
  return Object.freeze({ endpoint: transport.endpoint, request, call: request, readFileBytes, readJsonFile, assertWorkspace,
    listingPages, historyPages,
    ...Object.fromEntries(Object.entries(methods).map(([method, name]) => [method, (args = {}, options) => request(name, args, options)]))
  });
}
