// MIT. Complete source-bound route worksheets over the original merchant MCP.
import { constants } from 'node:fs';
import { open, link, unlink, lstat } from 'node:fs/promises';
import { dirname, basename, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openMerchantFileClient } from './retained-download.mjs';
import { SF61_ALIAS, SF61_SHA, sf61Hash as hash, sf61Checked as checked, sf61Failure as fail, sf61Plain as plain } from './sf61-connection.mjs';
import { normalizeRouteSheet, routeSheetText, ROUTE_SHEET_BYTES } from
  '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/route-sheet-model.mjs';

const FILE_SCHEMA = 'stellar-forge.api-route-sheet-file.v1';
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
async function regularFile(path, maximum) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > maximum) throw fail('OPENAPI_WORKSHEET_FILE_INVALID', 'Choose a complete regular worksheet file within 4 MiB.');
    const bytes = await file.readFile(), after = await file.stat();
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw fail('OPENAPI_WORKSHEET_FILE_CHANGED', 'The worksheet changed while reading; reopen its complete file.');
    return bytes;
  } finally { await file.close(); }
}
export async function readOpenApiRouteWorksheet({ path, expectedSha256 } = {}) {
  if (typeof path !== 'string' || !path) throw fail('INVALID_PARAMS', 'Choose the original worksheet file path.');
  const bytes = await regularFile(resolve(path), ROUTE_SHEET_BYTES), sha256 = hash(bytes);
  if (expectedSha256 !== undefined && sha256 !== checked(expectedSha256, SF61_SHA, 'worksheet SHA256'))
    throw fail('OPENAPI_WORKSHEET_FILE_CHANGED', 'The worksheet differs from its selected SHA256.');
  const sheet = normalizeRouteSheet(JSON.parse(decode(bytes)));
  return { sheet, bytes: bytes.length, sha256, canonicalSha256: hash(routeSheetText(sheet)) };
}
function metadata(value) {
  if (!plain(value) || value.schema !== FILE_SCHEMA || value.filename !== 'api-route-worksheet.json' ||
      !SF61_SHA.test(value.sha256 ?? '') || !SF61_SHA.test(value.sourceSha256 ?? '') ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > ROUTE_SHEET_BYTES ||
      !Number.isSafeInteger(value.rows) || value.rows < 0 || value.rows > 2000)
    throw fail('OPENAPI_WORKSHEET_REPLY_INVALID', 'The original route worksheet returned incomplete file metadata.');
  return value;
}
async function connection(options) {
  if (options.client !== undefined) {
    if (!plain(options.client) || typeof options.client.call !== 'function' || options.url !== undefined)
      throw fail('INVALID_PARAMS', 'Choose an original merchant client or its HTTP endpoint.');
    return options.client;
  }
  return openMerchantFileClient({ url: options.url, tokenEnv: options.tokenEnv, environment: options.environment,
    signal: options.signal, errorPrefix: 'OPENAPI_WORKSHEET', clientName: 'starforge-route-worksheet' });
}
/** The request is the same complete source/plan, imported file and explicit actions on every chunk. */
export async function downloadOpenApiRouteWorksheet(options = {}) {
  const { workspace, request = {}, path, expectedWorksheetSha256, chunkBytes = 196608, signal, onProgress } = options;
  checked(workspace, SF61_ALIAS, 'original workspace alias');
  if (!plain(request) || ['workspace','offset','chunkBytes','expectedWorksheetSha256'].some(key => Object.hasOwn(request, key)))
    throw fail('INVALID_PARAMS', 'Keep workspace and worksheet transfer controls outside the original worksheet request.');
  if (typeof path !== 'string' || !path || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 196608)
    throw fail('INVALID_PARAMS', 'Choose a complete destination filename and chunk size from 1 to 196608.');
  if (expectedWorksheetSha256 !== undefined) checked(expectedWorksheetSha256, SF61_SHA, 'worksheet SHA256');
  const selected = structuredClone(request), client = await connection(options), target = resolve(path);
  const parent = await lstat(dirname(target));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw fail('INVALID_PARAMS', 'Choose an existing worksheet destination directory.');
  const pieces = []; let offset = 0, file;
  for (;;) {
    signal?.throwIfAborted();
    const reply = await client.call('merchant_openapi_route_sheet_file', { workspace, ...selected, offset, chunkBytes,
      ...(file || expectedWorksheetSha256 ? { expectedWorksheetSha256: file?.sha256 ?? expectedWorksheetSha256 } : {}) });
    const info = metadata(reply.file);
    if (reply.workspace !== workspace || file && (file.sha256 !== info.sha256 || file.bytes !== info.bytes || file.sourceSha256 !== info.sourceSha256))
      throw fail('OPENAPI_WORKSHEET_REPLY_INVALID', 'The original worksheet identity changed between chunks.');
    file ??= info;
    if (expectedWorksheetSha256 !== undefined && file.sha256 !== expectedWorksheetSha256)
      throw fail('OPENAPI_WORKSHEET_FILE_CHANGED', 'The complete worksheet differs from its reviewed SHA256.');
    const bytes = typeof reply.data === 'string' ? Buffer.from(reply.data, 'base64') : Buffer.alloc(0);
    const count = Math.min(chunkBytes, file.bytes - offset), next = offset + count, complete = next === file.bytes;
    if (reply.encoding !== 'base64' || bytes.toString('base64') !== reply.data || reply.offset !== offset ||
        bytes.length !== count || reply.bytes !== count || reply.complete !== complete || reply.nextOffset !== (complete ? null : next))
      throw fail('OPENAPI_WORKSHEET_REPLY_INVALID', 'Continue the exact original worksheet byte offset.');
    pieces.push(bytes); offset = next;
    await onProgress?.({ bytes: offset, totalBytes: file.bytes, sha256: file.sha256 });
    if (complete) break;
  }
  const bytes = Buffer.concat(pieces, file.bytes);
  if (hash(bytes) !== file.sha256) throw fail('OPENAPI_WORKSHEET_REPLY_INVALID', 'The received worksheet hash does not match its complete original bytes.');
  const sheet = normalizeRouteSheet(JSON.parse(decode(bytes)));
  if (sheet.sourceSha256 !== file.sourceSha256 || sheet.rows.length !== file.rows ||
      sheet.currency.network !== file.currency?.network || sheet.currency.asset !== file.currency?.asset ||
      !Buffer.from(routeSheetText(sheet)).equals(bytes))
    throw fail('OPENAPI_WORKSHEET_REPLY_INVALID', 'The received portable worksheet does not match its original source and file metadata.');
  const existing = async () => {
    try {
      const current = await regularFile(target, ROUTE_SHEET_BYTES);
      if (!current.equals(bytes)) throw fail('OPENAPI_WORKSHEET_DESTINATION_CONFLICT', 'This filename contains another worksheet. Choose a new destination.');
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  let state = 'REOPENED';
  if (!await existing()) {
    const temporary = join(dirname(target), '.' + basename(target) + '.' + randomUUID() + '.part');
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      signal?.throwIfAborted();
      try { await link(temporary, target); state = 'COMPLETE'; }
      catch (error) { if (error.code !== 'EEXIST' || !await existing()) throw error; }
      const directory = await open(dirname(target), constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { schema: 'stellar-forge.api-route-sheet-download.v1', state, workspace, path: target,
    bytes: file.bytes, sha256: file.sha256, sourceSha256: file.sourceSha256, rows: file.rows, currency: file.currency };
}
