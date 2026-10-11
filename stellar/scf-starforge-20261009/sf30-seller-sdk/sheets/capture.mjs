// MIT. Exact private Google Spreadsheet resources, imported or fetched read-only.
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { object, bytes, digest, readPrivate, createFile, privateDirectory, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES, HASH, parseQualifiedRange, spreadsheetId, integer } from './declaration.mjs';

export const GOOGLE_FIELDS = 'spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat(numberFormat)))))';
const decode = buffer => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch { throw fault('SHEETS_RESOURCE_JSON_INVALID'); }
};

/** A capture represents exactly one explicitly requested rectangle. GridData
 * omits trailing empty cells/rows and zero start offsets; these are blanks. */
export function capturedGrid(resource, range) {
  const bounds = parseQualifiedRange(range);
  if (!object(resource) || !Array.isArray(resource.sheets)) throw fault('SHEETS_RESOURCE_INVALID');
  spreadsheetId(resource.spreadsheetId);
  const matches = resource.sheets.filter(item => item?.properties?.title === bounds.title);
  if (matches.length !== 1) throw fault('SHEETS_CAPTURE_TAB_MISSING');
  const sheet = matches[0], properties = sheet.properties;
  integer(properties.sheetId, 0, 2147483647, 'SHEETS_CAPTURE_TAB_INVALID');
  if (properties.sheetType !== 'GRID' || !object(properties.gridProperties) ||
      properties.gridProperties.rowCount < bounds.endRow || properties.gridProperties.columnCount < bounds.endColumn)
    throw fault('SHEETS_CAPTURE_GRID_INVALID');
  if (!Array.isArray(sheet.data) || sheet.data.length !== 1) throw fault('SHEETS_CAPTURE_ONE_GRID_REQUIRED');
  const data = sheet.data[0];
  if (!object(data) || (data.startRow ?? 0) !== bounds.startRow || (data.startColumn ?? 0) !== bounds.startColumn ||
      data.rowData !== undefined && !Array.isArray(data.rowData)) throw fault('SHEETS_CAPTURE_RANGE_MISMATCH');
  const rows = data.rowData ?? [];
  if (rows.length > bounds.endRow - bounds.startRow || rows.some(row => !object(row) ||
      row.values !== undefined && (!Array.isArray(row.values) || row.values.length > bounds.endColumn - bounds.startColumn)))
    throw fault('SHEETS_CAPTURE_RANGE_MISMATCH');
  return { bounds, properties, cell: (row, column) => rows[row - bounds.startRow]?.values?.[column - bounds.startColumn] ?? {} };
}

export async function retainSheetsCapture(resourceBytes, directory, { range, transport = 'connected-resource', receivedAt = stamp() } = {}) {
  if (!Buffer.isBuffer(resourceBytes) || resourceBytes.length > MAX_CAPTURE_BYTES || !['connected-resource', 'google-rest'].includes(transport) ||
      typeof receivedAt !== 'string' || !Number.isFinite(Date.parse(receivedAt))) throw fault('SHEETS_CAPTURE_INPUT_INVALID');
  const resource = decode(resourceBytes), grid = capturedGrid(resource, range);
  await privateDirectory(dirname(directory));
  await mkdir(directory, { mode: 0o700 });
  await privateDirectory(directory);
  const manifest = { schema: 'stellar-forge.sheets-capture.v1', provider: 'google-sheets-v4', method: 'spreadsheets.get',
    readOnly: true, transport, receivedAt, spreadsheetId: resource.spreadsheetId, sheetId: grid.properties.sheetId,
    range, resourceFile: 'resource.json', sourceSha256: digest(resourceBytes), sourceBytes: resourceBytes.length };
  await createFile(join(directory, 'resource.json'), resourceBytes);
  const manifestBytes = bytes(manifest);
  await createFile(join(directory, 'capture.json'), manifestBytes);
  await syncDirectory(directory); await syncDirectory(dirname(directory));
  return { manifest, manifestBytes, manifestFile: join(directory, 'capture.json'), manifestSha256: digest(manifestBytes), resource, resourceBytes, grid };
}
export async function importSheetsCapture(resourceFile, directory, { range } = {}) {
  return retainSheetsCapture(await readPrivate(resourceFile, MAX_CAPTURE_BYTES), directory, { range, transport: 'connected-resource' });
}
export async function readSheetsCapture(filename, expectedHash) {
  const manifestBytes = await readPrivate(filename, 16384), manifest = decode(manifestBytes);
  if (expectedHash !== undefined && digest(manifestBytes) !== expectedHash) throw fault('SHEETS_CAPTURE_MANIFEST_CHANGED');
  if (manifest?.schema !== 'stellar-forge.sheets-capture.v1' || manifest.provider !== 'google-sheets-v4' ||
      manifest.method !== 'spreadsheets.get' || manifest.readOnly !== true || manifest.resourceFile !== 'resource.json' ||
      !['google-rest', 'connected-resource'].includes(manifest.transport) || !HASH.test(manifest.sourceSha256 ?? '') ||
      typeof manifest.receivedAt !== 'string' || !Number.isFinite(Date.parse(manifest.receivedAt))) throw fault('SHEETS_CAPTURE_MANIFEST_INVALID');
  integer(manifest.sourceBytes, 1, MAX_CAPTURE_BYTES, 'SHEETS_CAPTURE_SIZE_INVALID');
  const resourceBytes = await readPrivate(join(dirname(filename), 'resource.json'), MAX_CAPTURE_BYTES);
  if (resourceBytes.length !== manifest.sourceBytes || digest(resourceBytes) !== manifest.sourceSha256)
    throw fault('SHEETS_CAPTURE_RESOURCE_CHANGED');
  const resource = decode(resourceBytes), grid = capturedGrid(resource, manifest.range);
  if (resource.spreadsheetId !== manifest.spreadsheetId || grid.properties.sheetId !== manifest.sheetId)
    throw fault('SHEETS_CAPTURE_IDENTITY_CHANGED');
  return { manifest, manifestBytes, manifestFile: filename, manifestSha256: digest(manifestBytes), resource, resourceBytes, grid };
}
export function bindSheetsCapture(capture, config, query) {
  const original = capture.grid.bounds, selected = query.bounds;
  if (capture.manifest.spreadsheetId !== config.spreadsheetId || capture.manifest.sheetId !== query.sheetId ||
      original.title !== query.sheetTitle || selected.startRow < original.startRow || selected.endRow > original.endRow ||
      selected.startColumn < original.startColumn || selected.endColumn > original.endColumn)
    throw fault('SHEETS_CAPTURE_SELECTION_MISMATCH', 'The capture must contain the exact selected workbook, tab ID, title and rectangle.');
  return capture.grid;
}

/** One bounded GET to the fixed Google origin. No redirects, writes, credential
 * persistence or implicit retries; 401/403/429 remain distinct operator outcomes. */
export async function fetchSheetsResource(config, query, { env = process.env, signal } = {}) {
  const connection = config.connection;
  if (connection.kind !== 'google') throw fault('SHEETS_LIVE_CONNECTION_REQUIRED');
  const token = env[connection.accessTokenEnv];
  if (typeof token !== 'string' || !token.length || token.length > 16384 || /[^\x21-\x7e]/.test(token))
    throw fault('SHEETS_ACCESS_TOKEN_MISSING', 'Provide the configured environment reference with an authorized Sheets read-only OAuth access token.');
  const timeout = AbortSignal.timeout(connection.timeoutMs ?? 30000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const url = new URL('https://sheets.googleapis.com/v4/spreadsheets/' + config.spreadsheetId);
  url.searchParams.set('ranges', query.qualifiedRange); url.searchParams.set('fields', GOOGLE_FIELDS);
  let response;
  try { response = await fetch(url, { method: 'GET', headers: { authorization: 'Bearer ' + token, accept: 'application/json' }, redirect: 'error', signal: abort }); }
  catch { throw fault(signal?.aborted ? 'SHEETS_CAPTURE_CANCELLED' : timeout.aborted ? 'SHEETS_CAPTURE_TIMEOUT' : 'SHEETS_PROVIDER_UNREACHABLE'); }
  if (!response.ok) {
    await response.body?.cancel();
    const codes = { 400: 'SHEETS_PROVIDER_REQUEST_INVALID', 401: 'SHEETS_AUTH_EXPIRED', 403: 'SHEETS_ACCESS_DENIED', 404: 'SHEETS_WORKBOOK_NOT_FOUND', 429: 'SHEETS_RATE_LIMITED' };
    throw fault(codes[response.status] ?? 'SHEETS_PROVIDER_FAILED');
  }
  const maximum = connection.maxResponseBytes ?? MAX_CAPTURE_BYTES;
  if (Number(response.headers.get('content-length') ?? 0) > maximum) {
    await response.body?.cancel(); throw fault('SHEETS_RESPONSE_TOO_LARGE');
  }
  const parts = []; let size = 0;
  try {
    if (!response.body) throw fault('SHEETS_PROVIDER_EMPTY_RESPONSE');
    for await (const part of response.body) {
      size += part.byteLength;
      if (size > maximum) throw fault('SHEETS_RESPONSE_TOO_LARGE');
      parts.push(part);
    }
  } catch (issue) {
    if (issue.code?.startsWith('SHEETS_')) throw issue;
    throw fault(signal?.aborted ? 'SHEETS_CAPTURE_CANCELLED' : timeout.aborted ? 'SHEETS_CAPTURE_TIMEOUT' : 'SHEETS_RESPONSE_INTERRUPTED');
  }
  const resourceBytes = Buffer.concat(parts), resource = decode(resourceBytes);
  const grid = capturedGrid(resource, query.qualifiedRange);
  if (resource.spreadsheetId !== config.spreadsheetId || grid.properties.sheetId !== query.sheetId)
    throw fault('SHEETS_SOURCE_IDENTITY_CHANGED');
  return { resourceBytes, receivedAt: stamp() };
}
