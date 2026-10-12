// MIT. Exact package-lock inventory and portable runtime transfer format.
import { createHash, timingSafeEqual } from 'node:crypto';

export const TRANSFER_SCHEMA = 'stellar-forge.runtime-transfer.v1';
export const TRANSFER_STATE_SCHEMA = 'stellar-forge.runtime-transfer-state.v1';
export const MAX_PART_BYTES = 8 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_FILES = 25000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const fail = (code, message = code, status = 400) => Object.assign(new Error(message), { code, status });
export const need = (value, code, message, status) => { if (!value) throw fail(code, message, status); };
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX = /^[a-f0-9]{64}$/;
const ALGORITHMS = { sha512: 64, sha384: 48, sha256: 32, sha1: 20 };
export const validHash = value => typeof value === 'string' && HEX.test(value);
export const validCount = value => Number.isSafeInteger(value) && value >= 0;
export function integrityHashes(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 4096, 'RUNTIME_TRANSFER_INTEGRITY_REQUIRED');
  const tokens = value.trim().split(/\s+/).map(token => {
    const match = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
    need(match && Object.hasOwn(ALGORITHMS, match[1]), 'RUNTIME_TRANSFER_INTEGRITY_UNSUPPORTED');
    const bytes = Buffer.from(match[2], 'base64');
    need(bytes.length === ALGORITHMS[match[1]] && bytes.toString('base64') === match[2],
      'RUNTIME_TRANSFER_INTEGRITY_INVALID');
    return { algorithm: match[1], expected: match[2] };
  });
  // Subresource integrity selects the strongest represented algorithm.
  const selected = Object.keys(ALGORITHMS).find(name => tokens.some(item => item.algorithm === name));
  return tokens.filter(item => item.algorithm === selected);
}
export function verifyIntegrity(observed, expected) {
  const selected = integrityHashes(expected);
  const actual = observed[selected[0].algorithm];
  need(typeof actual === 'string', 'RUNTIME_TRANSFER_INTEGRITY_OBSERVATION_MISSING');
  const bytes = Buffer.from(actual, 'base64');
  need(selected.some(item => {
    const wanted = Buffer.from(item.expected, 'base64');
    return wanted.length === bytes.length && timingSafeEqual(wanted, bytes);
  }), 'RUNTIME_TRANSFER_PACKAGE_INTEGRITY_MISMATCH');
}
function locationName(path) {
  if (typeof path !== 'string' || path.length > 2048) return null;
  const components = path.split('/node_modules/');
  if (!components[0].startsWith('node_modules/')) return null;
  components[0] = components[0].slice('node_modules/'.length);
  return components.every(name => NAME.test(name)) ? components.at(-1) : null;
}
function publicTarball(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' &&
      (!url.port || url.port === '443') && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.endsWith('.tgz') && !url.pathname.includes('%00') && !url.pathname.includes('\\');
  } catch { return false; }
}

/** Preserve every lock location, including bundled and optional dependencies. */
export function describeRuntimeLock(lock, packageJson) {
  need(plain(lock) && [2, 3].includes(lock.lockfileVersion) && plain(lock.packages) &&
    plain(lock.packages['']) && plain(packageJson) && plain(packageJson.dependencies),
  'RUNTIME_TRANSFER_LOCK_FORMAT_UNSUPPORTED', 'Use the original npm v2/v3 package-lock from the selected runtime');
  const root = lock.packages[''];
  need(lock.name === packageJson.name && lock.version === packageJson.version &&
    root.name === packageJson.name && root.version === packageJson.version &&
    equal(root.dependencies ?? {}, packageJson.dependencies) &&
    Object.keys(root.devDependencies ?? {}).length === 0 &&
    Object.keys(root.optionalDependencies ?? {}).length === 0,
  'RUNTIME_TRANSFER_LOCK_PROFILE_MISMATCH');
  const entries = Object.entries(lock.packages).filter(([path]) => path !== '').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  need(entries.length <= MAX_FILES - 4, 'RUNTIME_TRANSFER_LOCK_TOO_LARGE');
  const records = [], problems = [];
  for (const [path, entry] of entries) {
    const location = locationName(path), name = plain(entry) ? entry.name ?? location : null;
    let code = null;
    if (!location || !plain(entry) || !NAME.test(name ?? '')) code = 'PACKAGE_LOCATION_INVALID';
    else if (entry.link) code = 'LOCAL_LINK_REQUIRES_ORIGINAL_SOURCE';
    else if (!VERSION.test(entry.version ?? '')) code = 'PACKAGE_VERSION_REQUIRED';
    else if (entry.inBundle === true) {
      const parent = records.filter(item => path.startsWith(item.path + '/node_modules/') && item.kind !== 'UNSUPPORTED').at(-1);
      if (!parent) code = 'BUNDLED_PARENT_MISSING';
      else {
        records.push({ path, name, version: entry.version, kind: 'BUNDLED', bundledIn: parent.path,
          optional: entry.optional === true, dev: entry.dev === true });
        continue;
      }
    } else if (!publicTarball(entry.resolved)) code = 'PUBLIC_REGISTRY_TARBALL_REQUIRED';
    if (!code) {
      try { integrityHashes(entry.integrity); } catch (error) { code = error.code; }
    }
    if (code) {
      // Do not echo a rejected source URL which might contain private registry credentials.
      const record = { path, name: typeof name === 'string' ? name : null,
        version: typeof entry?.version === 'string' ? entry.version : null, kind: 'UNSUPPORTED', code };
      records.push(record); problems.push(record); continue;
    }
    records.push({ path, name, version: entry.version, kind: 'PUBLIC_TARBALL',
      resolved: entry.resolved, integrity: entry.integrity, optional: entry.optional === true,
      dev: entry.dev === true, hasInstallScript: entry.hasInstallScript === true,
      os: Array.isArray(entry.os) ? [...entry.os] : [], cpu: Array.isArray(entry.cpu) ? [...entry.cpu] : [] });
  }
  for (const [name, version] of Object.entries(packageJson.dependencies)) {
    const entry = records.find(item => item.path === 'node_modules/' + name);
    if (!entry || entry.version !== version || entry.kind === 'UNSUPPORTED')
      problems.push({ path: 'node_modules/' + name, name, version, kind: 'UNSUPPORTED', code: 'SELECTED_DEPENDENCY_NOT_LOCKED' });
  }
  const byArtifact = new Map();
  for (const record of records.filter(item => item.kind === 'PUBLIC_TARBALL')) {
    const key = JSON.stringify([record.resolved, record.integrity]);
    const previous = byArtifact.get(key);
    if (previous) {
      need(previous.name === record.name && previous.version === record.version, 'RUNTIME_TRANSFER_LOCK_ARTIFACT_CONFLICT');
      previous.locations.push(record.path);
    } else byArtifact.set(key, { name: record.name, version: record.version, resolved: record.resolved,
      integrity: record.integrity, locations: [record.path] });
  }
  return { lockfileVersion: lock.lockfileVersion, records, artifacts: [...byArtifact.values()],
    packageLocations: records.length, publicArtifacts: byArtifact.size,
    bundledLocations: records.filter(item => item.kind === 'BUNDLED').length, problems,
    supported: problems.length === 0 };
}
export function partName(index) {
  need(Number.isSafeInteger(index) && index >= 0 && index < 100000, 'RUNTIME_TRANSFER_PART_INDEX_INVALID');
  return 'part-' + String(index).padStart(5, '0') + '.bin';
}
export function allowedFile(path) {
  return ['source.tgz', 'runtime-profile.json', 'package.json', 'package-lock.json'].includes(path) ||
    /^artifacts\/[a-f0-9]{64}\.tgz$/.test(path);
}
export function verifyTransferManifest(manifest, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  need(plain(manifest) && manifest.schema === TRANSFER_SCHEMA && validHash(manifest.transferId) &&
    typeof manifest.createdAt === 'string' && Number.isFinite(Date.parse(manifest.createdAt)) &&
    plain(manifest.runtime) && validHash(manifest.runtime.installationId) &&
    validHash(manifest.runtime.profileId) && validHash(manifest.runtime.archiveSha256) &&
    validHash(manifest.runtime.profileSha256) && validHash(manifest.runtime.packageJsonSha256) &&
    validHash(manifest.runtime.lockSha256) && /^[a-f0-9]{40}$/.test(manifest.runtime.sourceCommit ?? '') &&
    typeof manifest.runtime.packageName === 'string' && NAME.test(manifest.runtime.packageName) &&
    typeof manifest.runtime.packageVersion === 'string' && manifest.runtime.packageVersion.length <= 200,
  'RUNTIME_TRANSFER_MANIFEST_INVALID');
  need(validCount(maxBytes) && maxBytes > 0 && plain(manifest.payload) &&
    validCount(manifest.payload.bytes) && manifest.payload.bytes > 0 && manifest.payload.bytes <= maxBytes &&
    validHash(manifest.payload.sha256) && Number.isSafeInteger(manifest.payload.partBytes) &&
    manifest.payload.partBytes >= 64 * 1024 && manifest.payload.partBytes <= MAX_PART_BYTES,
  'RUNTIME_TRANSFER_PAYLOAD_LIMIT');
  need(Array.isArray(manifest.files) && manifest.files.length >= 4 && manifest.files.length <= MAX_FILES &&
    Array.isArray(manifest.parts) && manifest.parts.length > 0 && manifest.parts.length < 100000 &&
    Array.isArray(manifest.artifacts) && manifest.artifacts.length <= MAX_FILES - 4,
  'RUNTIME_TRANSFER_MANIFEST_COUNTS_INVALID');
  let offset = 0;
  const files = new Map();
  for (const file of manifest.files) {
    need(plain(file) && allowedFile(file.path) && !files.has(file.path) &&
      validCount(file.bytes) && file.bytes > 0 && file.offset === offset && validHash(file.sha256),
    'RUNTIME_TRANSFER_FILE_DESCRIPTOR_INVALID');
    need(file.bytes <= (file.path === 'source.tgz' ? 64 * 1024 * 1024 :
      file.path === 'package-lock.json' ? 16 * 1024 * 1024 :
      file.path.startsWith('artifacts/') ? 512 * 1024 * 1024 : 4 * 1024 * 1024),
    'RUNTIME_TRANSFER_FILE_LIMIT');
    files.set(file.path, file); offset += file.bytes;
    need(Number.isSafeInteger(offset), 'RUNTIME_TRANSFER_PAYLOAD_LIMIT');
  }
  need(offset === manifest.payload.bytes, 'RUNTIME_TRANSFER_PAYLOAD_SIZE_MISMATCH');
  const required = { 'source.tgz': 'archiveSha256', 'runtime-profile.json': 'profileSha256',
    'package.json': 'packageJsonSha256', 'package-lock.json': 'lockSha256' };
  for (const [path, field] of Object.entries(required))
    need(files.get(path)?.sha256 === manifest.runtime[field], 'RUNTIME_TRANSFER_RUNTIME_FILE_MISMATCH');
  offset = 0;
  for (const [index, part] of manifest.parts.entries()) {
    need(plain(part) && part.index === index && part.name === partName(index) && part.offset === offset &&
      Number.isSafeInteger(part.bytes) && part.bytes > 0 && part.bytes <= manifest.payload.partBytes &&
      (index === manifest.parts.length - 1 || part.bytes === manifest.payload.partBytes) && validHash(part.sha256),
    'RUNTIME_TRANSFER_PART_DESCRIPTOR_INVALID');
    offset += part.bytes;
  }
  need(offset === manifest.payload.bytes, 'RUNTIME_TRANSFER_PART_SIZE_MISMATCH');
  const artifactFiles = new Set();
  for (const artifact of manifest.artifacts) {
    need(plain(artifact) && NAME.test(artifact.name ?? '') && VERSION.test(artifact.version ?? '') &&
      publicTarball(artifact.resolved) && validHash(artifact.sha256) && validCount(artifact.bytes) &&
      Array.isArray(artifact.locations) && artifact.locations.length > 0 &&
      artifact.locations.every(path => locationName(path)) && new Set(artifact.locations).size === artifact.locations.length,
    'RUNTIME_TRANSFER_ARTIFACT_INVALID');
    integrityHashes(artifact.integrity);
    const path = 'artifacts/' + artifact.sha256 + '.tgz', file = files.get(path);
    need(file && file.sha256 === artifact.sha256 && file.bytes === artifact.bytes, 'RUNTIME_TRANSFER_ARTIFACT_FILE_MISMATCH');
    artifactFiles.add(path);
  }
  need(files.size === 4 + artifactFiles.size, 'RUNTIME_TRANSFER_UNDECLARED_FILE');
  const identity = { runtime: manifest.runtime, payload: manifest.payload, files: manifest.files,
    parts: manifest.parts, artifacts: manifest.artifacts };
  need(digest(json(canonical(identity))) === manifest.transferId, 'RUNTIME_TRANSFER_IDENTITY_MISMATCH');
  return manifest;
}
