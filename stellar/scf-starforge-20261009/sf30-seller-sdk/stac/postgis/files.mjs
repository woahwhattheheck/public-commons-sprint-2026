import {constants, createReadStream} from 'node:fs';
import {mkdir, open, lstat, realpath, readdir, readFile, link, unlink, chmod} from 'node:fs/promises';
import {resolve, relative, dirname, isAbsolute, sep, posix} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openVectorExport, receiveVectorExport} from '../vector/index.mjs';
import {need, canonical, digest, sha256, hash, id, parseExactJSON, validateReceiving} from './contract.mjs';

export async function privateDirectory(directory) {
  const path = resolve(directory);
  await mkdir(path, {recursive: true, mode: 0o700});
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path, 'POSTGIS_PRIVATE_DIRECTORY_REQUIRED', path);
  return path;
}
export function member(directory, name) {
  need(typeof name === 'string' && name.length && !name.includes('\\') && !name.includes('\0') &&
    !isAbsolute(name) && name === posix.normalize(name) && !name.split('/').some(part => ['.', '..', ''].includes(part)),
    'POSTGIS_PACKAGE_PATH_INVALID', name);
  const root = resolve(directory), path = resolve(root, ...name.split('/'));
  need(path.startsWith(root + sep), 'POSTGIS_PACKAGE_PATH_ESCAPE', name); return path;
}
export async function regularFile(path) {
  const stat = await lstat(path);
  need(stat.isFile() && !stat.isSymbolicLink() && await realpath(path) === resolve(path), 'POSTGIS_REGULAR_FILE_REQUIRED', path);
  return stat;
}
export async function fileRecord(path, name) {
  const before = await regularFile(path), hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  const after = await regularFile(path);
  need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && bytes === after.size, 'POSTGIS_FILE_CHANGED_WHILE_READING', name);
  return {path: name, bytes, sha256: hash.digest('hex')};
}
export async function verifyFile(root, record) {
  need(record && Number.isSafeInteger(record.bytes) && record.bytes >= 0, 'POSTGIS_FILE_DESCRIPTOR_REQUIRED');
  hash(record.sha256);
  const actual = await fileRecord(member(root, record.path), record.path);
  need(actual.bytes === record.bytes && actual.sha256 === record.sha256, 'POSTGIS_PACKAGE_FILE_CHANGED', record.path);
  return actual;
}
export async function readJSON(path) {
  await regularFile(path); return parseExactJSON(await readFile(path, 'utf8'));
}
export async function writeOnce(path, bytes) {
  if (typeof bytes === 'string') bytes = Buffer.from(bytes);
  need(Buffer.isBuffer(bytes), 'POSTGIS_WRITE_BYTES_REQUIRED');
  await privateDirectory(dirname(path));
  const expected = {bytes: bytes.length, sha256: sha256(bytes)};
  try {
    const actual = await fileRecord(path, 'existing');
    need(actual.bytes === expected.bytes && actual.sha256 === expected.sha256, 'POSTGIS_EXISTING_OUTPUT_CONFLICT', path);
    return expected;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path + '.receiving-' + randomUUID();
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const actual = await fileRecord(path, 'existing');
      need(actual.bytes === expected.bytes && actual.sha256 === expected.sha256, 'POSTGIS_EXISTING_OUTPUT_CONFLICT', path);
    }
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return expected;
}
export async function writeJSONOnce(path, value) { return writeOnce(path, canonical(value) + '\n'); }
export async function claimDirectory(directory, request) {
  const root = await privateDirectory(directory);
  await writeJSONOnce(member(root, 'request.json'), request);
  return root;
}
export async function copyVerified(sourceRoot, destinationRoot, record) {
  const path = member(sourceRoot, record.path);
  await verifyFile(sourceRoot, record);
  const bytes = await readFile(path);
  need(bytes.length === record.bytes && sha256(bytes) === record.sha256, 'POSTGIS_SOURCE_CHANGED_DURING_COPY', record.path);
  await writeOnce(member(destinationRoot, record.path), bytes);
  return verifyFile(destinationRoot, record);
}
export async function listFiles(directory, excluded = new Set()) {
  const root = await privateDirectory(directory), results = [];
  async function visit(current, prefix) {
    const entries = await readdir(current, {withFileTypes: true});
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (excluded.has(name)) continue;
      const path = member(root, name);
      need(!entry.isSymbolicLink(), 'POSTGIS_PACKAGE_SYMLINK_FORBIDDEN', name);
      if (entry.isDirectory()) await visit(path, name);
      else { need(entry.isFile(), 'POSTGIS_PACKAGE_NONREGULAR_FILE', name); results.push(await fileRecord(path, name)); }
    }
  }
  await visit(root, '');
  return results;
}
export async function retainVectorSource(sourceDirectory, destination, expectedManifestSha256, options = {}) {
  hash(expectedManifestSha256);
  const original = await openVectorExport(sourceDirectory, {expectedManifestSha256, native: true, ...options});
  need(original.manifestFile?.sha256 === expectedManifestSha256, 'POSTGIS_ORIGINAL_VECTOR_MANIFEST_CHANGED');
  const received = await receiveVectorExport(sourceDirectory, destination, {expectedManifestSha256, ...options});
  need(received.manifestFile?.sha256 === expectedManifestSha256 && received.receiving?.allOriginalBindingsMatched === true,
    'POSTGIS_ORIGINAL_VECTOR_RECEIVING_REQUIRED');
  const capture = await readJSON(member(destination, 'source/capture.json'));
  const inspection = await readJSON(member(destination, 'source/inspection.json'));
  return {directory: resolve(destination), manifest: received.manifest, manifestFile: received.manifestFile,
    capture, inspection, receiving: received.receiving};
}
export async function openRetainedSource(directory, expectedManifestSha256, options = {}) {
  const opened = await openVectorExport(directory, {expectedManifestSha256, native: false, ...options});
  need(opened.manifestFile?.sha256 === expectedManifestSha256, 'POSTGIS_ORIGINAL_VECTOR_MANIFEST_CHANGED');
  return {...opened, capture: await readJSON(member(directory, 'source/capture.json')),
    inspection: await readJSON(member(directory, 'source/inspection.json'))};
}
export async function* sourceFeatures(source) {
  const descriptor = source.manifest.files.find(file => file.path === source.manifest.native.sourceFeatures.path);
  need(descriptor, 'POSTGIS_ORIGINAL_FEATURE_FILE_REQUIRED');
  await verifyFile(source.directory, descriptor);
  const path = member(source.directory, descriptor.path), before = await regularFile(path);
  const stream = createReadStream(path), hashed = createHash('sha256');
  let bytes = 0, count = 0;
  stream.on('data', chunk => { hashed.update(chunk); bytes += chunk.length; });
  const lines = createInterface({input: stream, crlfDelay: Infinity});
  try {
    for await (const line of lines) {
      need(line.length > 0, 'POSTGIS_EMPTY_FEATURE_RECORD');
      const row = parseExactJSON(line);
      hash(row.rowKey); id(row.layerId);
      need(Number.isSafeInteger(row.sourcePosition) && row.sourcePosition >= 1 &&
        Number.isSafeInteger(row.occurrence) && row.occurrence >= 1 &&
        row.identity && row.feature?.type === 'Feature' && row.propertyKinds &&
        (row.feature.properties === null || typeof row.feature.properties === 'object' && !Array.isArray(row.feature.properties)),
        'POSTGIS_ORIGINAL_FEATURE_RECORD_INVALID');
      count++; yield row;
    }
  } finally { lines.close(); stream.destroy(); }
  const after = await regularFile(path);
  need(count === source.manifest.counts.sourceFeatures && bytes === descriptor.bytes &&
    hashed.digest('hex') === descriptor.sha256 &&
    before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs,
    'POSTGIS_ORIGINAL_FEATURE_STREAM_CHANGED');
}
export async function validateSourceMapping(source, profile, srids, options = {}) {
  const layers = new Map(source.inspection.layers.map(layer => [layer.id, layer]));
  const requests = [];
  for (const mapping of profile.layers) {
    const original = layers.get(mapping.sourceLayerId);
    need(original, 'POSTGIS_ORIGINAL_SOURCE_LAYER_MISSING', mapping.sourceLayerId);
    const fields = Object.keys(original.fields).sort();
    need(canonical(fields) === canonical(mapping.fields.map(field => field.sourceName).sort()),
      'POSTGIS_MAPPING_MUST_RETAIN_ALL_SOURCE_FIELDS', mapping.sourceLayerId);
    requests.push({layerId: mapping.id, originalWkt: original.crsWkt || null,
      sourceWkt: srids.get(mapping.geometry.sourceSrid), assign: mapping.geometry.assignSourceCrs,
      targetWkt: srids.get(mapping.geometry.targetSrid)});
  }
  const script = fileURLToPath(new URL('./source_crs.py', import.meta.url));
  const python = options.python || process.env.STARFORGE_VECTOR_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  const output = await new Promise((resolveResult, reject) => {
    const child = spawn(python, ['-B', script], {stdio: ['pipe', 'pipe', 'pipe'],
      env: {...process.env, PROJ_NETWORK: 'OFF'}});
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, 120000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', part => { stdout += part; if (stdout.length > 1048576) child.kill('SIGTERM'); });
    child.stderr.on('data', part => { if (stderr.length < 16384) stderr += part; });
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on('exit', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code !== 0) reject(Object.assign(new Error('POSTGIS_NATIVE_CRS_MAPPING_FAILED'), {code: 'POSTGIS_NATIVE_CRS_MAPPING_FAILED', detail: stderr.slice(0, 4096)}));
      else resolveResult(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(canonical({layers: requests}));
  });
  const result = parseExactJSON(output);
  need(result.schema === 'starforge.postgis-crs-observation.v1' && result.layers.length === profile.layers.length,
    'POSTGIS_NATIVE_CRS_OBSERVATION_REQUIRED');
  return result;
}
export async function openReceiving(directory, expectedManifestSha256) {
  const root = await privateDirectory(directory), descriptor = await fileRecord(member(root, 'postgis-receiving.json'), 'postgis-receiving.json');
  if (expectedManifestSha256) need(descriptor.sha256 === hash(expectedManifestSha256), 'POSTGIS_RECEIVING_MANIFEST_CHANGED');
  const receipt = validateReceiving(await readJSON(member(root, 'postgis-receiving.json')));
  const paths = new Set();
  for (const file of receipt.files) {
    need(!paths.has(file.path), 'POSTGIS_RECEIVING_FILE_DUPLICATE', file.path); paths.add(file.path);
    await verifyFile(root, file);
  }
  need(paths.has(receipt.source.manifest.path) && paths.has(receipt.mapping.path), 'POSTGIS_RECEIVING_ORIGINALS_MISSING');
  await verifyFile(root, receipt.source.manifest); await verifyFile(root, receipt.mapping);
  const profile = await readJSON(member(root, receipt.mapping.path));
  need(profile.projectId === receipt.projectId, 'POSTGIS_RECEIVING_PROJECT_CHANGED');
  return {directory: root, manifest: receipt, manifestFile: descriptor, profile};
}
