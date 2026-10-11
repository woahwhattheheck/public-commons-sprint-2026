// MIT. Retain original upstream JSON as an immutable SF82 release input.
import { createHash } from 'node:crypto';
import { lstat, readFile, open } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { compileUpstreamBindings, validateUpstreamService, upstreamCredentialReferences } from '../sf30-seller-sdk/upstream.mjs';

const LIMIT = 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  return value;
}
export function upstreamReleaseSnapshot(value) {
  if (!plain(value) || Object.keys(value).some(key => !['file', 'sha256'].includes(key)) ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') || value.file !== `pilot-upstreams-${value.sha256}.json`)
    throw new TypeError('Invalid original upstream release snapshot.');
  return { file: value.file, sha256: value.sha256 };
}
/** Resolve a saved ORIGINAL workspace package through its own integrity reader. */
export async function readReleaseWorkspace(path) {
  const { readPackage } = await import('../sf61-openapi-seller-import/workspace/model.mjs');
  const folder = resolve(path), project = await readPackage(dirname(folder), basename(folder));
  const manifestBytes = await bytesAt(join(folder, 'merchant-package.json'));
  const retainedManifest = JSON.parse(manifestBytes);
  if (stable(retainedManifest) !== stable(project.manifest))
    throw new Error('Saved merchant package changed while reading. Save a new package and stage it.');
  return {
    inputs: { spec: join(folder, 'facade-openapi.json'), config: join(folder, 'selections.json'),
      bindings: join(folder, 'route-bindings.json'), upstreams: join(folder, 'upstreams.json') },
    allowLoopbackUpstream: project.plan.allowLoopbackUpstream === true,
    hashes: project.manifest.files,
    provenance: { name: project.name, id: project.manifest.id, manifestSha256: digest(manifestBytes),
      originalOpenApiSha256: project.manifest.files[project.manifest.sourceFile ?? 'original-openapi.json'],
      ...(project.sourceRevision ? {sourceRevisionSha256:project.manifest.files['source-revision.json'],
        sourceRevision:project.sourceRevision} : {}) },
  };
}
async function bytesAt(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > LIMIT) throw new TypeError('Upstream release input must be a regular JSON file up to 1 MiB.');
  const bytes = await readFile(path);
  if (bytes.length > LIMIT) throw new TypeError('Upstream release input grew beyond 1 MiB.');
  return bytes;
}
function inspectBytes(bytes, service, allowLoopback) {
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  // Validate reference syntax with the ORIGINAL compiler. Staging does not
  // consult process.env or import a handler; actual values resolve at launch.
  const references = upstreamCredentialReferences(input);
  const compiled = compileUpstreamBindings(input, { allowLoopback,
    // A syntax-only value satisfies both original header and 32-byte key input
    // validation. No operator value is read; no durable operation is opened.
    env: Object.fromEntries(references.map(name => [name, '0'.repeat(64)])) });
  validateUpstreamService(service, compiled);
  const bindings = Object.create(null);
  for (const [name, value] of Object.entries(compiled)) {
    const raw = input.bindings[name];
    bindings[name] = {
      binding: name, configurationSha256: digest(stable(value.transport ? {binding:raw,transport:value.transport} : raw)),
      origin: value.origin, path: value.path, method: value.method, query: value.query,
      requestHeaders: value.requestHeaders, headerEnvironment: raw.headerEnv ?? {},
      responseHeaders: value.responseHeaders, responseMode: value.responseMode,
      responseContractSha256: raw.responseContract ? digest(stable(raw.responseContract)) : null,
      timeoutMs: value.timeoutMs, maxResponseBytes: value.maxResponseBytes,
      maxInFlight: value.maxInFlight, availability: value.availability,
      idempotency: raw.idempotency ?? null,
      cache: raw.cache ?? null,
      ...(raw.oauth2 === undefined ? {} : { oauth2: raw.oauth2 }),
      ...(value.transport ? { transport: value.transport } : {}),
    };
  }
  return { bindings, environment: references, credentialValuesChecked: false };
}
// Let configured operator interfaces display this same original review before
// staging. This pure reader neither resolves credentials nor creates snapshots.
export { inspectBytes as inspectUpstreamConfiguration };
export async function inspectReleaseUpstreams(directory, snapshot, service, { allowLoopback = false } = {}) {
  const retained = upstreamReleaseSnapshot(snapshot), bytes = await bytesAt(join(directory, retained.file));
  if (digest(bytes) !== retained.sha256) throw new Error('Staged upstream configuration changed. Restore the original release or stage a new one.');
  return { ...retained, bytes: bytes.length, ...inspectBytes(bytes, service, allowLoopback) };
}
export async function stageReleaseUpstreams(directory, inputPath, service, options = {}) {
  const bytes = await bytesAt(inputPath), sha256 = digest(bytes);
  inspectBytes(bytes, service, options.allowLoopback === true);
  const snapshot = { file: `pilot-upstreams-${sha256}.json`, sha256 };
  const file = await open(join(directory, snapshot.file), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  return snapshot;
}
