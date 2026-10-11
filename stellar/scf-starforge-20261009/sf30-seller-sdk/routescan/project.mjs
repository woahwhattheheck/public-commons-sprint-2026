// MIT. Retained operator input, original source requests and original customer exports.
import { open, mkdir, readdir, lstat, readFile, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileRoutescanMerchant, merchantReview, merchantOpenApi, requestFor, json, sha256, fail } from './config.mjs';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from './quota.mjs';
import { createRoutescanSource } from './source.mjs';
import { exportSellerClient, inspectSellerClientExport, adoptSellerClientExport } from '../developer/client-export.mjs';
import { generateSellerClient } from '../developer/client-generator.mjs';

const SCHEMA = 'stellar-forge.routescan-project.v1';
const idOf = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) fail('Use a stable letters-and-digits operation ID.');
  return value;
};
const sameRequest = (a, b) => json(Object.fromEntries(Object.entries(a ?? {}).sort())) === json(Object.fromEntries(Object.entries(b ?? {}).sort()));
async function retainedBytes(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size > 24 * 1024 * 1024) fail('Invalid private export member.', 503);
    return await file.readFile();
  } finally { await file.close(); }
}
async function writeBytes(directory, name, bytes) {
  const temp = join(directory, '.body-' + randomUUID()); let file;
  try {
    file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    await link(temp, join(directory, name));
    const folder = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await folder.sync(); } finally { await folder.close(); }
  } finally { await file?.close().catch(() => {}); await unlink(temp).catch(() => {}); }
}
async function ensureBytes(directory, name, bytes) {
  try { await writeBytes(directory, name, bytes); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = await retainedBytes(join(directory, name));
    if (!prior.equals(bytes)) fail('An incomplete export contains different original bytes: ' + name, 409);
  }
}
async function completeClient(folder, openapiPath) {
  const directory = join(folder, 'client');
  let status = await inspectSellerClientExport({ directory });
  if (status.state === 'NOT_FOUND') return exportSellerClient({ openapi: openapiPath, out: directory });
  if (status.state === 'INCOMPLETE') {
    // Reuse the ORIGINAL deterministic generator to fill only missing members.
    // Every existing member must already equal its original source-derived byte string.
    const openapi = await retainedBytes(openapiPath), generated = generateSellerClient(openapi);
    for (const [name, value] of [['seller-client.mjs', generated.javascript], ['seller-client.d.mts', generated.declarations],
      ['seller-openapi.json', openapi], ['package.json', generated.packageJson], ['README.md', generated.readme]])
      await ensureBytes(directory, name, Buffer.from(value));
    status = await inspectSellerClientExport({ directory });
  }
  if (status.state === 'LEGACY_FILES_RETAINED') return adoptSellerClientExport({ directory, expectedFilesSha256: status.filesSha256 });
  if (status.state !== 'COMPLETE') fail('The original customer export is incomplete.', 503);
  return status;
}
export async function openProject(directory, { env = process.env, quotaDirectory } = {}) {
  const root = await privateDirectory(directory);
  const revisions = await privateDirectory(join(root, 'revisions'));
  const previews = await privateDirectory(join(root, 'previews'));
  const exports = await privateDirectory(join(root, 'exports'));
  const quota = await privateDirectory(quotaDirectory ?? join(root, 'quota'));
  let closed = false, stopping = false, closing, pending = Promise.resolve(), sourceRuns = new Set();
  const operations = new Set();
  function active() { if (closed) fail('The project is closed.', 503); }
  function tracked(work) {
    active(); if (stopping) fail('The project is closing.', 503);
    // Register before the first filesystem await so shutdown includes accepted
    // requests still retaining their intent, as well as active provider calls.
    const operation = Promise.resolve().then(work);
    operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  }
  async function read() {
    active();
    try {
      const saved = await readPrivateJson(join(root, 'project.json'));
      if (saved.schema !== SCHEMA || !Number.isSafeInteger(saved.revision) || saved.revision < 1 ||
          compileRoutescanMerchant(saved.input).inputSha256 !== saved.inputSha256) fail('The retained merchant revision is inconsistent.', 503);
      return saved;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function current(expectedRevision) {
    const saved = await read();
    if (!saved || !Number.isSafeInteger(expectedRevision) || expectedRevision !== saved.revision)
      fail('The saved merchant revision changed. Reopen the current project.', 409, 'ROUTESCAN_REVISION_CHANGED');
    return saved;
  }
  function serial(work) {
    const operation = pending.then(() => { active(); return withPrivateLock(root, 'project.lock', work); });
    pending = operation.catch(() => {}); return operation;
  }
  function save({ input, expectedRevision = 0 }) {
    return serial(async () => {
      const compiled = compileRoutescanMerchant(input), previous = await read();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== (previous?.revision ?? 0))
        fail('The merchant was edited elsewhere. Reopen its current revision.', 409, 'ROUTESCAN_REVISION_CHANGED');
      if (previous?.inputSha256 === compiled.inputSha256) return previous;
      const at = new Date().toISOString(), revision = expectedRevision + 1;
      let saved = { schema: SCHEMA, revision, createdAt: previous?.createdAt ?? at, updatedAt: at,
        inputSha256: compiled.inputSha256, input: compiled.config };
      try { await atomicJson(revisions, revision + '.json', saved, { exclusive: true }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const retained = await readPrivateJson(join(revisions, revision + '.json'));
        if (retained.schema !== SCHEMA || retained.revision !== revision || retained.inputSha256 !== saved.inputSha256 || json(retained.input) !== json(saved.input))
          fail('An interrupted save retained another draft at this revision. Preserve it and save this input in a new project.', 409);
        saved = retained;
      }
      await atomicJson(root, 'project.json', saved); return saved;
    });
  }
  async function history() {
    const names = (await readdir(revisions)).filter(name => /^\d+\.json$/.test(name)).sort((a, b) => Number(b.split('.')[0]) - Number(a.split('.')[0]));
    return Promise.all(names.map(async name => { const row = await readPrivateJson(join(revisions, name));
      return { revision: row.revision, updatedAt: row.updatedAt, inputSha256: row.inputSha256, title: row.input?.title }; }));
  }
  async function readRevision(revision) {
    if (!Number.isSafeInteger(revision) || revision < 1) fail('Choose a saved revision.');
    return readPrivateJson(join(revisions, revision + '.json'));
  }
  async function readPreview(id) {
    active(); idOf(id); const folder = join(previews, id);
    const request = await readPrivateJson(join(folder, 'request.json'));
    if (request.id !== id || request.schema !== 'stellar-forge.routescan-preview-request.v1') fail('Invalid source request.', 503);
    try {
      const result = await readPrivateJson(join(folder, 'result.json'), 24 * 1024 * 1024);
      if (result.id !== id || result.requestSha256 !== sha256(json(request)) || !['COMPLETE', 'FAILED'].includes(result.state) ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(result.bodyBase64 ?? '')) fail('Invalid retained source result.', 503);
      const bytes = Buffer.from(result.bodyBase64, 'base64');
      if (bytes.toString('base64') !== result.bodyBase64 || bytes.length !== result.bytes || sha256(bytes) !== result.sha256) fail('The retained source bytes changed.', 503);
      return { ...result, request, directory: folder };
    } catch (error) { if (error.code === 'ENOENT') return { id, state: 'STARTED', request, directory: folder }; throw error; }
  }
  async function listPreviews() {
    const names = (await readdir(previews, { withFileTypes: true })).filter(item => item.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(item.name));
    const rows = [];
    for (const name of names) {
      try { const item = await readPreview(name.name);
        const { bodyBase64, ...summary } = item; rows.push(summary); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      // Another process may have created the operation folder before its request record.
    }
    return rows.sort((a, b) => b.request.startedAt.localeCompare(a.request.startedAt));
  }
  async function preview({ product, request, expectedRevision, id = randomUUID(), signal } = {}) {
    active(); idOf(id);
    // Reopening a complete operation needs neither current authoring input nor a
    // provider call. Changed arguments cannot silently repurpose its stable ID.
    try {
      const prior = await readPreview(id);
      if (prior.request.product !== product || !sameRequest(prior.request.request, request) || prior.request.revision !== expectedRevision)
        fail('This source operation ID belongs to another request or reviewed revision.', 409);
      return prior;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const saved = await current(expectedRevision), compiled = compileRoutescanMerchant(saved.input);
    const selected = requestFor(compiled, product, request), folder = join(previews, id);
    await mkdir(folder, { mode: 0o700 });
    const original = { schema: 'stellar-forge.routescan-preview-request.v1', id, product,
      inputSha256: saved.inputSha256, revision: saved.revision, request: selected.request,
      sourceUrl: selected.sourceUrl, startedAt: new Date().toISOString() };
    await atomicJson(folder, 'request.json', original, { exclusive: true });
    let source, response;
    const operation = (async () => {
      try {
        source = await createRoutescanSource(compiled, { quotaDirectory: quota, env });
        response = await source.request(product, selected.request, { signal });
      } catch (error) {
        response = { status: error.status ?? 503, headers: { 'content-type': 'application/json',
          ...(error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {}) },
          body: { error: error.code ?? 'ROUTESCAN_SOURCE_UNAVAILABLE', message: error.code ? error.message : 'The gas data source is unavailable.' } };
      } finally { await source?.close(); }
      const bytes = Buffer.isBuffer(response.body) ? response.body : Buffer.from(json(response.body));
      const result = { schema: 'stellar-forge.routescan-preview.v1', id,
        requestSha256: sha256(json(original)), completedAt: new Date().toISOString(),
        state: response.status === 200 ? 'COMPLETE' : 'FAILED', status: response.status, headers: response.headers,
        bytes: bytes.length, sha256: sha256(bytes), bodyBase64: bytes.toString('base64'), source: response.source ?? null };
      await atomicJson(folder, 'result.json', result, { exclusive: true });
      return { ...result, request: original, directory: folder };
    })();
    sourceRuns.add(operation); operation.finally(() => sourceRuns.delete(operation)).catch(() => {}); return operation;
  }
  async function readExport(id) {
    active(); idOf(id); const folder = join(exports, id);
    const record = await readPrivateJson(join(folder, 'export.json'));
    if (record.id !== id || record.schema !== 'stellar-forge.routescan-export.v1') fail('Invalid original merchant export.', 503);
    for (const item of record.files) {
      if (!['merchant.json', 'review.json', 'seller-openapi.json'].includes(item.name)) fail('Invalid export member.', 503);
      const bytes = await retainedBytes(join(folder, item.name));
      if (sha256(bytes) !== item.sha256 || bytes.length !== item.bytes) fail('An original export file changed.', 503);
    }
    const client = await inspectSellerClientExport({ directory: join(folder, 'client') });
    if (client.state !== 'COMPLETE' || client.filesSha256 !== record.clientFilesSha256) fail('The original customer export changed.', 503);
    return { ...record, directory: folder, configPath: join(folder, 'merchant.json'), clientDirectory: join(folder, 'client'), client };
  }
  async function exportProject({ id = randomUUID(), expectedRevision } = {}) {
    active(); idOf(id);
    try { const prior = await readExport(id);
      if (prior.revision !== expectedRevision) fail('This export ID belongs to another reviewed revision.', 409);
      return prior; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const saved = await current(expectedRevision), compiled = compileRoutescanMerchant(saved.input), folder = join(exports, id);
    try { await mkdir(folder, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await privateDirectory(folder);
    const plan = { schema: 'stellar-forge.routescan-export-plan.v1', id, revision: saved.revision, inputSha256: saved.inputSha256 };
    await ensureBytes(folder, 'export-plan.json', Buffer.from(json(plan)));
    const members = [['merchant.json', json(compiled.config)], ['review.json', json(merchantReview(compiled))],
      // The package describes its intended original native merchant contract.
      ['seller-openapi.json', json(merchantOpenApi(compiled, 'NATIVE_X402'))]];
    for (const [name, bytes] of members) await ensureBytes(folder, name, Buffer.from(bytes));
    const client = await completeClient(folder, join(folder, 'seller-openapi.json'));
    const record = { schema: 'stellar-forge.routescan-export.v1', id, state: 'PREPARED',
      inputSha256: saved.inputSha256, revision: saved.revision, exportedAt: new Date().toISOString(),
      files: members.map(([name, body]) => ({ name, bytes: Buffer.byteLength(body), sha256: sha256(body) })),
      clientFilesSha256: client.filesSha256 };
    try { await atomicJson(folder, 'export.json', record, { exclusive: true }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return readExport(id);
  }
  async function listExports() {
    const names = (await readdir(exports, { withFileTypes: true })).filter(item => item.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(item.name));
    const rows = [];
    for (const name of names) {
      try { rows.push(await readExport(name.name)); }
      catch (error) { if (error.code === 'ENOENT') rows.push({ id: name.name, state: 'INCOMPLETE', directory: join(exports, name.name) }); else throw error; }
    }
    return rows;
  }
  return { root, quotaDirectory: quota, read, save: input => tracked(() => save(input)), history, readRevision,
    preview: input => tracked(() => preview(input)), readPreview, listPreviews,
    export: input => tracked(() => exportProject(input)), readExport, listExports,
    close() {
      if (!closing) {
        stopping = true;
        closing = (async () => { await Promise.allSettled([...operations]); await pending;
          await Promise.allSettled([...sourceRuns]); closed = true; })();
      }
      return closing;
    } };
}
