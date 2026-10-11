// MIT. Original customer SDK export, completion receipt and retained-file recovery.
import { constants } from 'node:fs';
import { readFile, stat, lstat, mkdir, open, link, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateSellerClient, sellerClientSnapshot } from './client-generator.mjs';
import { supportsSellerMethod } from '../http-methods.mjs';

export const CLIENT_EXPORT_MANIFEST = 'client-export.json';
export const CLIENT_EXPORT_FILES = Object.freeze(['seller-client.mjs', 'seller-client.d.mts', 'seller-openapi.json', 'package.json', 'README.md']);
export const MAX_CLIENT_EXPORT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MANIFEST_LIMIT = 65000;
const SCHEMA = 'stellar-forge.seller-client-manifest.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const json = value => JSON.stringify(value, null, 2) + '\n';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const fail = (code, message) => Object.assign(new Error(message), { code: 'CLIENT_EXPORT_' + code });
const types = { 'seller-client.mjs': 'text/javascript', 'seller-client.d.mts': 'text/plain',
  'seller-openapi.json': 'application/json', 'package.json': 'application/json', 'README.md': 'text/markdown',
  [CLIENT_EXPORT_MANIFEST]: 'application/json' };
const USAGE = `Usage:
  node client-export.mjs --openapi SAVED_SELLER_OPENAPI.json --out NEW_DIRECTORY
  node client-export.mjs python --help
  node client-export.mjs status --dir RETAINED_DIRECTORY
  node client-export.mjs adopt --dir RETAINED_DIRECTORY --expected-files-sha256 INSPECTED_DIGEST`;

function record(value, keys, label) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw fail('INVALID', 'Invalid ' + label + '.');
}
function provenance(value) {
  if (value === undefined) return undefined;
  record(value, ['exportId', 'releaseId', 'releaseDigest', 'instanceId'], 'original merchant provenance');
  if (!validId(value.exportId) || Object.keys(value).length !== 1 && Object.keys(value).length !== 4 ||
      Object.keys(value).length === 4 && (!validId(value.releaseId) || !validSha(value.releaseDigest) ||
        typeof value.instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.instanceId)))
    throw fail('INVALID', 'Retain the original export ID and either all three known release/instance fields or none.');
  return structuredClone(value);
}
function snapshotView(snapshot) {
  return { sourceSha256: snapshot.sourceSha256, origin: snapshot.origin, mode: snapshot.mode,
    operations: snapshot.operations.map(({ id, method, path }) => ({ id, method, path })) };
}
function filesSha256(files) { return sha(JSON.stringify(files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })))); }
function fileView(name, bytes) { return { name, bytes: bytes.length, sha256: sha(bytes) }; }
async function directoryAt(path) {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw fail('INVALID', 'Supply the original customer export directory.');
  const directory = resolve(path), info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('INVALID', 'The customer export must be a real directory.');
  return directory;
}
async function originalBytes(directory, name, maximum = MAX_CLIENT_EXPORT_FILE_BYTES) {
  const file = await open(join(directory, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > maximum) throw fail('INVALID', 'Invalid original customer file: ' + name + '.');
    const bytes = await file.readFile();
    if (bytes.length !== info.size || bytes.length > maximum) throw fail('FILE_CHANGED', 'Original customer file changed while reading: ' + name + '.');
    return bytes;
  } finally { await file.close(); }
}
async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const file = await open(directory, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
// An interrupted publication cannot leave a partial receipt at its final name.
async function publishManifest(directory, manifest) {
  const bytes = Buffer.from(json(manifest)); parseSellerClientManifest(bytes);
  const temporary = join(directory, '.client-export-' + randomUUID()); let file;
  try {
    file = await open(temporary, 'wx', 0o600); await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    await link(temporary, join(directory, CLIENT_EXPORT_MANIFEST)); await syncDirectory(directory);
  } finally { if (file) await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
  return { manifest, bytes, manifestFile: { ...fileView(CLIENT_EXPORT_MANIFEST, bytes), contentType: types[CLIENT_EXPORT_MANIFEST] } };
}

/** Validate the saved original receipt; no generated module is imported or executed. */
export function parseSellerClientManifest(input, exportId) {
  const bytes = Buffer.from(input ?? []); let value;
  try { if (!bytes.length || bytes.length > MANIFEST_LIMIT) throw new Error(); value = JSON.parse(decode(bytes)); }
  catch { throw fail('MANIFEST_INVALID', 'Read a complete original client-export.json receipt.'); }
  record(value, ['schema', 'completedAt', 'completion', 'sourceSha256', 'origin', 'mode', 'operations', 'files', 'filesSha256', 'provenance'], 'customer export receipt');
  if (value.schema !== SCHEMA || !['GENERATED', 'ADOPTED_RETAINED'].includes(value.completion) ||
      typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt)) ||
      new Date(value.completedAt).toISOString() !== value.completedAt || !validSha(value.sourceSha256) ||
      !['CHALLENGE_ONLY', 'NATIVE_X402'].includes(value.mode) || !Array.isArray(value.operations) ||
      !value.operations.length || value.operations.length > 64 || !Array.isArray(value.files) || value.files.length !== CLIENT_EXPORT_FILES.length)
    throw fail('MANIFEST_INVALID', 'The original customer export receipt is incomplete.');
  let origin;
  try { origin = new URL(value.origin); } catch { throw fail('MANIFEST_INVALID', 'Invalid original seller origin.'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.origin || origin.username || origin.password)
    throw fail('MANIFEST_INVALID', 'Invalid original seller origin.');
  const ids = new Set();
  for (const operation of value.operations) {
    record(operation, ['id', 'method', 'path'], 'customer operation');
    if (typeof operation.id !== 'string' || !operation.id || operation.id.length > 120 || ids.has(operation.id) ||
        !supportsSellerMethod(operation.method) || typeof operation.path !== 'string' ||
        !operation.path.startsWith('/') || operation.path.length > 4096) throw fail('MANIFEST_INVALID', 'Invalid original customer operation.');
    ids.add(operation.id);
  }
  let total = 0;
  value.files.forEach((file, index) => {
    record(file, ['name', 'bytes', 'sha256'], 'customer file identity');
    if (file.name !== CLIENT_EXPORT_FILES[index] || !Number.isSafeInteger(file.bytes) || file.bytes < 1 ||
        file.bytes > MAX_CLIENT_EXPORT_FILE_BYTES || !validSha(file.sha256)) throw fail('MANIFEST_INVALID', 'Invalid original customer file identity.');
    total += file.bytes;
  });
  if (total > MAX_TOTAL_BYTES || value.files[2].sha256 !== value.sourceSha256 ||
      !validSha(value.filesSha256) || filesSha256(value.files) !== value.filesSha256)
    throw fail('MANIFEST_INVALID', 'The saved source and complete file identities disagree.');
  const original = provenance(value.provenance);
  if (exportId !== undefined && original && original.exportId !== exportId) throw fail('IDENTITY_CONFLICT', 'The receipt belongs to a different original export ID.');
  return value;
}

export async function readSellerClientManifest({ directory, exportId } = {}) {
  directory = await directoryAt(directory); let bytes;
  try { bytes = await originalBytes(directory, CLIENT_EXPORT_MANIFEST, MANIFEST_LIMIT); }
  catch (error) { if (error.code === 'ENOENT') throw fail('MANIFEST_REQUIRED', 'Inspect the retained five files and explicitly adopt their digest before downloading a legacy export.'); throw error; }
  return { manifest: parseSellerClientManifest(bytes, exportId), bytes,
    manifestFile: { ...fileView(CLIENT_EXPORT_MANIFEST, bytes), contentType: types[CLIENT_EXPORT_MANIFEST] } };
}

export async function readSellerClientFile({ directory, exportId, file, expectedManifestSha256 } = {}) {
  if (![CLIENT_EXPORT_MANIFEST, ...CLIENT_EXPORT_FILES].includes(file) || !validSha(expectedManifestSha256))
    throw fail('INVALID', 'Select one original customer file and its inspected completion digest.');
  directory = await directoryAt(directory);
  const retained = await readSellerClientManifest({ directory, exportId });
  if (retained.manifestFile.sha256 !== expectedManifestSha256) throw fail('IDENTITY_CONFLICT', 'The completion receipt differs from the inspected original export.');
  if (file === CLIENT_EXPORT_MANIFEST) return { name: file, type: types[file], bytes: retained.bytes };
  const expected = retained.manifest.files.find(value => value.name === file), bytes = await originalBytes(directory, file);
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256) throw fail('FILE_CHANGED', 'The retained customer file differs from its completion receipt: ' + file + '.');
  return { name: file, type: types[file], bytes };
}

/** Read the complete original payload once. Missing legacy files are explicit. */
export async function inspectSellerClientExport({ directory, exportId, includeOffers = false } = {}) {
  try { directory = await directoryAt(directory); }
  catch (error) {
    if (error.code === 'ENOENT') return { schema: 'stellar-forge.seller-client-export-status.v1', state: 'NOT_FOUND', directory: resolve(directory) };
    throw error;
  }
  let retained;
  try { retained = await readSellerClientManifest({ directory, exportId }); }
  catch (error) { if (error.code !== 'CLIENT_EXPORT_MANIFEST_REQUIRED') throw error; }
  const files = [], payloads = new Map(), missingFiles = [];
  for (const name of CLIENT_EXPORT_FILES) {
    try { const bytes = await originalBytes(directory, name); files.push(fileView(name, bytes)); payloads.set(name, bytes); }
    catch (error) { if (error.code !== 'ENOENT') throw error; missingFiles.push(name); }
  }
  if (missingFiles.length) {
    if (retained) throw fail('FILE_CHANGED', 'A completed customer export is missing files: ' + missingFiles.join(', ') + '.');
    return { schema: 'stellar-forge.seller-client-export-status.v1', state: 'INCOMPLETE', directory, files, missingFiles, manifestRetained: false };
  }
  if (files.reduce((sum, file) => sum + file.bytes, 0) > MAX_TOTAL_BYTES) throw fail('INVALID', 'Customer export exceeds the 128 MiB total file limit.');
  const snapshot = sellerClientSnapshot(payloads.get('seller-openapi.json')), view = snapshotView(snapshot), digest = filesSha256(files);
  if (!payloads.get('seller-client.mjs').subarray(0, 180).toString('utf8').startsWith('// MIT. Generated from original SF30 seller OpenAPI SHA-256 ' + view.sourceSha256 + '.\n'))
    throw fail('SOURCE_CONFLICT', 'The retained generated module does not name the exact original OpenAPI digest.');
  let packageInfo;
  try { packageInfo = JSON.parse(decode(payloads.get('package.json'))); } catch { throw fail('INVALID', 'Read the original customer package metadata.'); }
  if (packageInfo.name !== 'starforge-seller-client' || packageInfo.type !== 'module' || packageInfo.main !== './seller-client.mjs' ||
      packageInfo.types !== './seller-client.d.mts') throw fail('INVALID', 'The retained files are not the original customer package layout.');
  if (retained && (digest !== retained.manifest.filesSha256 || JSON.stringify(view) !== JSON.stringify(snapshotView(retained.manifest))))
    throw fail('FILE_CHANGED', 'The retained source or files differ from their saved completion receipt.');
  return { schema: 'stellar-forge.seller-client-export-status.v1', state: retained ? 'COMPLETE' : 'LEGACY_FILES_RETAINED',
    directory, ...view, files, filesSha256: digest, manifestRetained: Boolean(retained),
    ...(includeOffers ? { snapshot } : {}),
    ...(retained ? { manifest: retained.manifest, manifestFile: retained.manifestFile } : {}) };
}

/** Explicitly retain today's observed legacy bytes, without claiming their export time. */
export async function adoptSellerClientExport({ directory, expectedFilesSha256, provenance: suppliedProvenance } = {}) {
  if (!validSha(expectedFilesSha256)) throw fail('INVALID', 'Supply the complete files digest from the original status inspection.');
  const original = provenance(suppliedProvenance);
  const inspected = await inspectSellerClientExport({ directory, exportId: original?.exportId });
  if (inspected.state === 'NOT_FOUND') throw fail('NOT_FOUND', 'The named customer export directory does not exist.');
  if (inspected.state === 'INCOMPLETE') throw fail('INCOMPLETE', 'Keep the incomplete export for recovery; adoption requires all five original files.');
  if (inspected.filesSha256 !== expectedFilesSha256) throw fail('IDENTITY_CONFLICT', 'The original customer files changed since inspection.');
  if (inspected.state === 'COMPLETE') return { ...inspected, reused: true };
  const manifest = { schema: SCHEMA, completedAt: new Date().toISOString(), completion: 'ADOPTED_RETAINED',
    ...snapshotView(inspected), files: inspected.files, filesSha256: inspected.filesSha256,
    ...(original ? { provenance: original } : {}) };
  let reused = false;
  try { await publishManifest(inspected.directory, manifest); }
  catch (error) { if (error.code !== 'EEXIST') throw error; reused = true; }
  const completed = await inspectSellerClientExport({ directory: inspected.directory, exportId: original?.exportId });
  if (completed.filesSha256 !== expectedFilesSha256) throw fail('IDENTITY_CONFLICT', 'The concurrently retained customer receipt describes different files.');
  return { ...completed, reused };
}

export async function exportSellerClient({ openapi, out, provenance: suppliedProvenance } = {}) {
  if (typeof openapi !== 'string' || typeof out !== 'string' || !openapi || !out) throw new TypeError(USAGE);
  const original = provenance(suppliedProvenance), sourcePath = resolve(openapi), directory = resolve(out);
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new TypeError('OpenAPI source must be a regular file up to 16 MiB');
  const bytes = await readFile(sourcePath), generated = generateSellerClient(bytes);
  const parent = await stat(dirname(directory));
  if (!parent.isDirectory()) throw new TypeError('Output parent directory must already exist');
  const payloads = [['seller-client.mjs', generated.javascript], ['seller-client.d.mts', generated.declarations],
    ['seller-openapi.json', bytes], ['package.json', generated.packageJson], ['README.md', generated.readme]];
  const manifest = { schema: SCHEMA, completedAt: new Date().toISOString(), completion: 'GENERATED',
    ...snapshotView(generated.snapshot), files: payloads.map(([name, data]) => fileView(name, Buffer.from(data))),
    ...(original ? { provenance: original } : {}) };
  manifest.filesSha256 = filesSha256(manifest.files); parseSellerClientManifest(Buffer.from(json(manifest)));
  // Preserve exclusive directory publication and the original five payload bytes.
  await mkdir(directory, { mode: 0o700 });
  let receipt;
  try {
    for (const [name, data] of payloads) {
      const file = await open(resolve(directory, name), 'wx', 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    }
    await syncDirectory(directory); manifest.completedAt = new Date().toISOString(); receipt = await publishManifest(directory, manifest);
  } catch (error) { throw fail('INCOMPLETE', `Client export is incomplete in ${directory}; inspect its original files before recovery. Cause: ${error.code ?? error.name}`); }
  return { schema: 'stellar-forge.seller-client-export.v1', directory, ...snapshotView(generated.snapshot),
    files: payloads.map(([name]) => name), state: 'COMPLETE', filesSha256: manifest.filesSha256,
    manifest: receipt.manifest, manifestFile: receipt.manifestFile };
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'python') return (await import('./python-client/export.mjs')).main(args.slice(1));
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const command = ['status', 'adopt'].includes(args[0]) ? args[0] : 'export';
  if (command !== 'export') args = args.slice(1);
  const allowed = command === 'export' ? ['--openapi', '--out'] : command === 'status' ? ['--dir'] : ['--dir', '--expected-files-sha256'];
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!allowed.includes(flag) || options.has(flag) || !value || value.startsWith('--')) throw new TypeError(USAGE);
    options.set(flag, value);
  }
  if (options.size !== allowed.length) throw new TypeError(USAGE);
  const result = command === 'export' ? await exportSellerClient({ openapi: options.get('--openapi'), out: options.get('--out') })
    : command === 'status' ? await inspectSellerClientExport({ directory: options.get('--dir') })
    : await adoptSellerClientExport({ directory: options.get('--dir'), expectedFilesSha256: options.get('--expected-files-sha256') });
  process.stdout.write(JSON.stringify(result) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write((error.code ? error.code + ': ' : '') + String(error?.message ?? error) + '\n'); process.exitCode = 1; });
}
