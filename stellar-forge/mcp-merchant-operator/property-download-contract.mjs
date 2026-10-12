// MIT. Complete Property file-receiving identity; native files remain unchanged.
import { createHash } from 'node:crypto';
import { exact, plain, failure } from './host-files.mjs';
import {canonical} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/property-operations/propply.mjs';

export const PROPERTY_DOWNLOAD_MANIFEST = 'Property-Download.json';
export const PROPERTY_DOWNLOAD_SCHEMA = 'stellar-forge.property-download-manifest.v1';
export const PROPERTY_MAX_FILE_BYTES = 512 * 1024 * 1024;
export const PROPERTY_MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
export const PROPERTY_NATIVE_MANIFEST = 'native-manifest.json';
const HASH = /^[a-f0-9]{64}$/;
const fail = message => {throw failure('PROPERTY_DOWNLOAD_MANIFEST_INVALID', message);};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function validatePropertyExportId(value) {
  if (typeof value !== 'string' || !HASH.test(value))
    throw failure('PROPERTY_DOWNLOAD_CONFIGURATION', 'Use the exact retained Property receiving export ID.');
  return value;
}
export function propertyRelativeFile(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.startsWith('/') ||
      /[\\:\u0000-\u001f\u007f]/.test(value) || value.split('/').length > 32 || value.split('/').some(part => !part || part === '.' || part === '..'))
    fail('Use the complete original relative filename.');
  return value;
}
function identity(value) {
  return {schema:value.schema, workspaceId:value.workspaceId, native:value.native,
    files:value.files, totalBytes:value.totalBytes};
}
function validate(value) {
  exact(value, ['schema','exportId','workspaceId','native','files','totalBytes'],
    ['schema','exportId','workspaceId','native','files','totalBytes']);
  if (value.schema !== PROPERTY_DOWNLOAD_SCHEMA || typeof value.workspaceId !== 'string' ||
      !value.workspaceId || value.workspaceId.length > 256 || /[\u0000-\u001f\u007f]/.test(value.workspaceId) ||
      !plain(value.native) || !HASH.test(value.native.manifestSha256 ?? '') ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 30001)
    fail('The complete native Property manifest and workspace binding are required.');
  const names = new Set(); let total = 0;
  for (const file of value.files) {
    exact(file, ['name','bytes','sha256'], ['name','bytes','sha256']);
    propertyRelativeFile(file.name);
    if (names.has(file.name) || file.name !== PROPERTY_NATIVE_MANIFEST && !file.name.startsWith('files/') ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > PROPERTY_MAX_FILE_BYTES ||
        !HASH.test(file.sha256 ?? ''))
      fail('Every native member needs its exact unique name, original byte count and SHA-256.');
    names.add(file.name); total += file.bytes;
    if (!Number.isSafeInteger(total)) fail('The complete declared byte total is outside its safe integer range.');
  }
  for (const name of names) {
    const parts = name.split('/');
    for (let i=1;i<parts.length;i++) if (names.has(parts.slice(0,i).join('/')))
      fail('A retained file cannot also be the parent directory of another native file.');
  }
  const native = value.files.find(file => file.name === PROPERTY_NATIVE_MANIFEST);
  if (!native || native.sha256 !== value.native.manifestSha256 ||
      native.bytes > PROPERTY_MAX_MANIFEST_BYTES || value.totalBytes !== total)
    fail('The complete receiving inventory of original native identities must be included.');
  validatePropertyExportId(value.exportId);
  if (sha(Buffer.from(canonical(identity(value)))) !== value.exportId)
    fail('The complete receiving identity differs from the original manifest.');
  return value;
}
export function createPropertyDownloadManifest({workspaceId,native,files}) {
  const value = {schema:PROPERTY_DOWNLOAD_SCHEMA, workspaceId, native, files,
    totalBytes:files.reduce((sum,file) => sum + file.bytes,0)};
  value.exportId = sha(Buffer.from(canonical(value)));
  validate(value);
  const bytes = Buffer.from(canonical(value) + '\n');
  if (bytes.length > PROPERTY_MAX_MANIFEST_BYTES) fail('The complete receiving manifest exceeds its declared byte limit.');
  return {manifest:value, bytes, sha256:sha(bytes)};
}
export function parsePropertyDownloadManifest(raw, exportId) {
  validatePropertyExportId(exportId);
  if (!Buffer.isBuffer(raw) || raw.length > PROPERTY_MAX_MANIFEST_BYTES)
    fail('Read the complete bounded UTF-8 manifest.');
  let value;
  try {value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch {fail('The saved receiving manifest must be complete UTF-8 JSON.');}
  validate(value);
  if (value.exportId !== exportId) fail('This manifest belongs to a different receiving export.');
  return value;
}


export function propertyCanonical(value) { return canonical(value); }
