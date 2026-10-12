// MIT. Original USGS customer delivery identity, shared by merchant and receiver.
export const USGS_DELIVERY_SCHEMA = 'stellar-forge.usgs-customer-delivery.v1';
export const USGS_DELIVERY_MANIFEST = 'usgs-delivery.json';
export const USGS_MAX_HANDOVER_BYTES = 8 * 1024 * 1024 * 1024;
const alias = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const nativeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const digest = /^[0-9a-f]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const valid = (value, re) => typeof value === 'string' && re.test(value);
function fail() { throw Object.assign(new Error('Use the complete original USGS delivery manifest and its selected delivery ID.'), { code: 'USGS_DOWNLOAD_MANIFEST_INVALID' }); }
export function parseUSGSDeliveryManifest(bytes, exportId) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 65000) fail();
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(); }
  if (!plain(value) || value.schema !== USGS_DELIVERY_SCHEMA || !valid(exportId, alias) || value.exportId !== exportId ||
      !valid(value.workspace, alias) || !valid(value.dssId, nativeId) || !valid(value.nativeExportSha256, digest) ||
      !valid(value.planSha256, digest) || !plain(value.source) || !valid(value.source.captureSha256, digest) ||
      typeof value.source.editionId !== 'string' || !plain(value.totals) ||
      !Object.values(value.totals).every(n => Number.isSafeInteger(n) && n >= 0) ||
      !Array.isArray(value.files) || value.files.length !== 1) fail();
  const file = value.files[0];
  if (!plain(file) || Object.keys(file).some(key => !['name','kind','bytes','sha256','contentType'].includes(key)) ||
      file.name !== exportId + '-HEC-DSS-handover.zip' || file.kind !== 'handover' ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > USGS_MAX_HANDOVER_BYTES ||
      !valid(file.sha256, digest) || file.contentType !== 'application/zip') fail();
  return value;
}
