import { mkdir, open, rename, unlink, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireInitialization, initializationDirectory, initializationBytes,
  optionalInitializationBytes, retainInitializationFile, initializationJson,
  syncInitializationDirectory } from '../../sf88-operator-buyer-cli/initialization.mjs';
import { canonical, sha256 } from './provider.mjs';

export const jsonBytes = initializationJson;
export const now = () => new Date().toISOString();
export function need(value, code, message = code) {
  if (!value) throw Object.assign(new Error(message), { code });
}
export const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id);

/** The maintained SF88 constructor owns the actual OS lease and exact-byte writes. */
export async function openCaptureStore(directory, { python = process.env.STARFORGE_PYTHON || process.env.PYTHON || '/usr/bin/python3', maxResponseBytes = 128 * 1024 * 1024 } = {}) {
  need(typeof directory === 'string' && resolve(directory) === directory && directory !== '/', 'ACQUISITION_ABSOLUTE_DIRECTORY_REQUIRED');
  need(Number.isSafeInteger(maxResponseBytes) && maxResponseBytes > 0, 'ACQUISITION_RESPONSE_LIMIT_INVALID');
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  await initializationDirectory(directory, { create: true });
  for (const child of ['runs', 'sources', 'rate']) await initializationDirectory(join(directory, child), { create: true });
  const runDirectory = id => { need(validId(id), 'ACQUISITION_ID_INVALID'); return join(directory, 'runs', sha256(id)); };
  const readJson = async (path, optional = false) => {
    const bytes = optional ? await optionalInitializationBytes(path, maxResponseBytes) : await initializationBytes(path, maxResponseBytes);
    return bytes === null ? null : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  };
  async function atomicJson(path, value) {
    const temporary = join(dirname(path), '.acquisition-' + randomUUID());
    const file = await open(temporary, 'wx', 0o600);
    try {
      try { await file.writeFile(jsonBytes(value)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path);
      await syncInitializationDirectory(dirname(path));
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function withRun(id, work) {
    const path = runDirectory(id);
    const lease = await acquireInitialization(path, { python, resume: true });
    try { return await work(path); } finally { await lease.close(); }
  }
  async function retainSource(source) {
    need(source && typeof source.file === 'string' && /^[a-f0-9]{64}$/.test(source.sha256) && typeof source.url === 'string', 'ACQUISITION_SOURCE_REQUIRED');
    const bytes = await readFile(source.file);
    need(sha256(bytes) === source.sha256, 'ACQUISITION_SOURCE_HASH_MISMATCH');
    const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    need(document.paths && document.openapi, 'ACQUISITION_OPENAPI_REQUIRED');
    await retainInitializationFile(join(directory, 'sources', source.sha256 + '.json'), bytes, { resume: true });
    return { document, source: { url: source.url, sha256: source.sha256 } };
  }
  async function readSource(hash) {
    need(/^[a-f0-9]{64}$/.test(hash), 'ACQUISITION_SOURCE_HASH_INVALID');
    const body = await initializationBytes(join(directory, 'sources', hash + '.json'), maxResponseBytes);
    need(sha256(body) === hash, 'ACQUISITION_RETAINED_SOURCE_CHANGED');
    return JSON.parse(body.toString('utf8'));
  }
  async function get(id) {
    const path = runDirectory(id);
    const intent = await readJson(join(path, 'intent.json'));
    const manifest = await readJson(join(path, 'manifest.json'));
    need(intent.id === id && manifest.id === id && manifest.fingerprint === sha256(canonical(intent.binding)), 'ACQUISITION_IDENTITY_CHANGED');
    need(canonical(manifest.request) === canonical(intent.binding.request) && manifest.requestHash === sha256(canonical(intent.binding.request)) &&
      manifest.sourceHash === intent.binding.source.sha256 && canonical(manifest.source) === canonical(intent.binding.source) &&
      manifest.credentialEnv === intent.binding.credentialEnv && canonical(manifest.review) === canonical(intent.binding.review), 'ACQUISITION_MANIFEST_BINDING_CHANGED');
    return manifest;
  }
  async function list() {
    const values = [];
    for (const entry of await readdir(join(directory, 'runs'), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const manifest = await readJson(join(directory, 'runs', entry.name, 'manifest.json'), true);
      if (manifest) values.push(await get(manifest.id));
    }
    return values.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }
  async function checkpoint(path, manifest) {
    manifest.revision += 1;
    manifest.updatedAt = now();
    await atomicJson(join(path, 'manifest.json'), manifest);
    return manifest;
  }
  async function captureBody(id, capture) {
    need(/^[a-z0-9-]+$/.test(capture.id) && capture.bodyFile === 'responses/' + capture.id + '.body', 'ACQUISITION_CAPTURE_PATH_INVALID');
    const body = await initializationBytes(join(runDirectory(id), capture.bodyFile), maxResponseBytes);
    need(body.length === capture.bytes && sha256(body) === capture.sha256, 'ACQUISITION_RETAINED_RESPONSE_CHANGED');
    return body;
  }
  async function withRate(key, work) {
    const path = join(directory, 'rate', sha256(key));
    const lease = await acquireInitialization(path, { python, resume: true });
    try { return await work(path); } finally { await lease.close(); }
  }
  return { directory, python, maxResponseBytes, runDirectory, readJson, atomicJson, withRun,
    retainSource, readSource, get, list, checkpoint, captureBody, withRate,
    retain: (path, bytes) => retainInitializationFile(path, bytes, { resume: true }) };
}
