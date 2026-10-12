// MIT. File selection for transporting the original SEC merchant export.
export const EDGAR_TRANSFER_SCHEMA = 'stellar-forge.sec-edgar-mcp-export.v1';
export const EDGAR_TRANSFER_MANIFEST = 'edgar-transfer.json';
export const EDGAR_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const EDGAR_NATIVE_FILES = Object.freeze([
  'export-plan.json', 'merchant.json', 'review.json', 'seller-openapi.json',
  'buyer-handoff.json', 'client/seller-client.mjs', 'client/seller-client.d.mts',
  'client/seller-openapi.json', 'client/package.json', 'client/README.md', 'manifest.json',
]);
const HASH = /^[a-f0-9]{64}$/;
const EDITION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = message => Object.assign(new Error(message), { code: 'EDGAR_TRANSFER_INVALID' });
const requireThat = (value, message) => { if (!value) throw invalid(message); };

/** Flat transport names map only to the original export's declared native paths. */
export function edgarTransferName(path) {
  if (EDGAR_NATIVE_FILES.includes(path))
    return path.startsWith('client/') ? 'client--' + path.slice(7) : path;
  const edition = path.match(/^source-store\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})\.json$/);
  if (edition) return 'edition--' + edition[1] + '.json';
  const capture = path.match(/^source-store\/blobs\/([a-f0-9]{64})\.json$/);
  if (capture) return 'capture--' + capture[1] + '.json';
  throw invalid('Choose a file from the original SEC merchant export.');
}
export function edgarTransferPaths(editions) {
  const paths = new Set(EDGAR_NATIVE_FILES);
  for (const edition of editions) {
    requireThat(object(edition) && EDITION.test(edition.id ?? '') && HASH.test(edition.sourceSha256 ?? ''),
      'The selected original edition identity is invalid.');
    paths.add('source-store/editions/' + edition.id + '.json');
    paths.add('source-store/blobs/' + edition.sourceSha256 + '.json');
  }
  return [...paths];
}

/** Used by both the server and receiver before any transport path is selected. */
export function parseEdgarTransfer(bytes, exportId) {
  requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 65000,
    'The SEC transfer manifest must fit the existing retained-file transport.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw invalid('The SEC transfer manifest must be complete UTF-8 JSON.'); }
  requireThat(object(value) && value.schema === EDGAR_TRANSFER_SCHEMA &&
    ALIAS.test(value.exportId ?? '') && (exportId === undefined || value.exportId === exportId) &&
    typeof value.workspaceId === 'string' && /^edgar-[a-f0-9-]{36}$/.test(value.workspaceId) &&
    Number.isSafeInteger(value.revision) && value.revision >= 1 &&
    HASH.test(value.configSha256 ?? '') && HASH.test(value.inputSha256 ?? '') &&
    HASH.test(value.nativeManifestSha256 ?? ''), 'The original merchant export binding is invalid.');
  requireThat(Array.isArray(value.editions) && value.editions.length >= 1 && value.editions.length <= 64 &&
    new Set(value.editions.map(item => item?.id)).size === value.editions.length,
    'The transfer must identify each selected original edition exactly once.');
  for (const edition of value.editions)
    requireThat(object(edition) && EDITION.test(edition.id ?? '') &&
      ['facts', 'filings'].includes(edition.kind) && /^\d{10}$/.test(edition.cik ?? '') &&
      HASH.test(edition.sourceSha256 ?? '') && Number.isSafeInteger(edition.sourceBytes) &&
      edition.sourceBytes > 0 && edition.sourceBytes <= EDGAR_MAX_FILE_BYTES,
      'The selected original edition identity is invalid.');
  const paths = edgarTransferPaths(value.editions), expected = new Set(paths);
  requireThat(Array.isArray(value.files) && value.files.length === paths.length &&
    new Set(value.files.map(file => file?.path)).size === paths.length &&
    new Set(value.files.map(file => file?.name)).size === paths.length,
    'The transfer must contain the complete original merchant, client and sources.');
  for (const file of value.files) {
    requireThat(object(file) && expected.has(file.path) && file.name === edgarTransferName(file.path) &&
      Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= EDGAR_MAX_FILE_BYTES &&
      HASH.test(file.sha256 ?? ''), 'The transfer contains an invalid original file.');
    if (file.path === 'manifest.json')
      requireThat(file.sha256 === value.nativeManifestSha256, 'The original export manifest changed.');
  }
  for (const edition of value.editions) {
    const source = value.files.find(file => file.path === 'source-store/blobs/' + edition.sourceSha256 + '.json');
    requireThat(source?.sha256 === edition.sourceSha256 && source.bytes === edition.sourceBytes,
      'The retained source differs from its original edition.');
  }
  return value;
}
