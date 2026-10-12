// MIT. Agent operations on the original live n8n merchant and its retained jobs.
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, rename, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { privateDirectory, readPrivate, writePrivate } from './store.mjs';
import { N8N_EXPORT_SCHEMA, N8N_EXPORT_MANIFEST, N8N_EXPORT_MAX_BYTES, N8N_EXPORT_MAX_FILE_BYTES,
  N8N_SHA, N8N_UUID, N8N_JOB_ID, plain, canonical, hash, encode, decode, failure, exact, checked,
  exportIdentity, parseN8nJobExport, validateN8nExportRecords } from './transfer-format.mjs';

const REQUEST_SCHEMA = 'stellar-forge.n8n-agent-request.v1';
const bad = (code, message, status = 400) => { throw failure(code, message, status); };
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) bad('N8N_INVALID_PARAMS', 'Select the current original job revision.');
  return value;
}
function text(value, maximum, label, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    bad('N8N_INVALID_PARAMS', 'Supply ' + label + ' as a single line of up to ' + maximum + ' characters.');
  return value;
}
function limit(value) {
  value ??= 50;
  if (!Number.isSafeInteger(value) || value < 1 || value > 200)
    bad('N8N_INVALID_PARAMS', 'Select a page size from 1 to 200.');
  return value;
}
function cursor(value, scope) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
    bad('N8N_INVALID_PARAMS', 'Use the cursor returned by this original query.');
  let data;
  try { data = JSON.parse(decode(Buffer.from(value, 'base64url'))); } catch {}
  if (!plain(data) || data.scope !== scope)
    bad('N8N_CURSOR_CHANGED', 'Use the cursor returned by the same original query.', 409);
  return data;
}
function selected(row, input) {
  if (row.job.revision !== input.expectedRevision ||
      (row.dispatch?.revision ?? null) !== input.expectedDispatchRevision)
    bad('N8N_EXPORT_REVISION_CHANGED', 'Refresh the original job and dispatch, then select their current revisions.', 409);
}
async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/**
 * Owned by the existing private operator server, which already holds the original
 * merchant lease. Intents retain only operation identity and private claim tokens;
 * all jobs, execution decisions and settlement still use the original owners.
 */
export class N8nAgentOperations {
  #merchant; #root; #requests; #exports; #configurationSha256; #ready;
  #reads = new RetainedFileReads({ errorPrefix: 'N8N' });
  #tails = new Map(); #closing = false; #closed;
  constructor(merchant) {
    this.#merchant = merchant;
    this.#configurationSha256 = checked(merchant.prepared.configurationSha256, N8N_SHA, 'configuration SHA256');
    this.#root = join(merchant.directory, 'agent-operations');
    this.#requests = join(this.#root, 'requests'); this.#exports = join(this.#root, 'exports');
    // Initialize on the first agent operation; a browser-only launch does not
    // allocate agent storage or a second model.
  }
  async #storage() {
    this.#ready ??= (async () => {
      await privateDirectory(this.#root); await privateDirectory(this.#requests); await privateDirectory(this.#exports);
    })().catch(error => { this.#ready = null; throw error; });
    return this.#ready;
  }
  #serial(key, action) {
    if (this.#closing) return Promise.reject(failure('N8N_CLOSING', 'The original agent operator is closing.', 503));
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => { await this.#storage(); return action(); });
    this.#tails.set(key, operation);
    operation.finally(() => { if (this.#tails.get(key) === operation) this.#tails.delete(key); }).catch(() => {});
    return operation;
  }
  async #intent(kind, input, { claim = false } = {}) {
    const requestId = checked(input.requestId, N8N_UUID, 'request UUID');
    const payloadSha256 = hash(canonical(input)), path = join(this.#requests, requestId + '.json');
    let record;
    try { record = JSON.parse(decode(await readPrivate(path, 65000))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      record = { schema: REQUEST_SCHEMA, kind, requestId, payloadSha256,
        configurationSha256: this.#configurationSha256, createdAt: new Date().toISOString(),
        ...(claim ? { claimToken: randomBytes(32).toString('base64url') } : {}) };
      await writePrivate(path, encode(record));
    }
    if (record.schema !== REQUEST_SCHEMA || record.kind !== kind || record.requestId !== requestId ||
        record.payloadSha256 !== payloadSha256 || record.configurationSha256 !== this.#configurationSha256 ||
        claim && !/^[A-Za-z0-9_-]{43}$/.test(record.claimToken ?? ''))
      bad('N8N_REQUEST_CONFLICT', 'This request UUID belongs to a different original operation. Resume its exact fields or choose a new request UUID.', 409);
    return record;
  }
  async status() {
    if (this.#closing) bad('N8N_CLOSING', 'The original agent operator is closing.', 503);
    const state = await this.#merchant.model.snapshot();
    const { jobs, ...summary } = state;
    return { schema: 'stellar-forge.n8n-agent-status.v1',
      configuration: { configurationSha256: this.#configurationSha256,
        normalized: this.#merchant.prepared.normalized, environment: this.#merchant.prepared.environment },
      jobs: summary, services: this.#merchant.services, fileReads: this.#reads.summary };
  }
  async jobs(input = {}) {
    exact(input, ['limit','cursor','q','status']);
    const size = limit(input.limit), q = input.q === undefined ? '' : text(input.q, 300, 'a search query', { empty: true }).toLowerCase();
    const stateFilter = input.status === undefined ? '' : checked(input.status, /^[A-Z_]{1,32}$/, 'job state');
    const scope = hash(canonical({ type: 'jobs', configurationSha256: this.#configurationSha256, q, status: stateFilter }));
    const resume = cursor(input.cursor, scope), snapshot = await this.#merchant.model.snapshot();
    if (resume && (resume.revision !== snapshot.revision || !Number.isSafeInteger(resume.offset) || resume.offset < 0))
      bad('N8N_CURSOR_CHANGED', 'The original job collection changed. Refresh this query to continue from its current revisions.', 409);
    const rows = snapshot.jobs.filter(row => (!stateFilter || row.state === stateFilter) &&
      (!q || [row.id,row.functionId,row.label].some(value => String(value ?? '').toLowerCase().includes(q))));
    const offset = resume?.offset ?? 0;
    if (offset > rows.length) bad('N8N_CURSOR_CHANGED', 'Refresh the original job query.', 409);
    const page = rows.slice(offset, offset + size), next = offset + page.length;
    return { schema: 'stellar-forge.n8n-job-page.v1', revision: snapshot.revision, total: rows.length, jobs: page,
      nextCursor: next < rows.length ? Buffer.from(canonical({ scope, revision: snapshot.revision, offset: next })).toString('base64url') : null };
  }
  prepare(input) {
    exact(input, ['requestId','reference','functionId','input','label'], ['requestId','functionId','input']);
    checked(input.requestId, N8N_UUID, 'request UUID');
    checked(input.functionId, /^[A-Za-z][A-Za-z0-9_]{0,55}$/, 'function identifier');
    if (input.reference !== undefined) checked(input.reference, N8N_JOB_ID, 'job identifier');
    if (input.label !== undefined) text(input.label, 300, 'a job label', { empty: true });
    if (!plain(input.input)) bad('N8N_INVALID_PARAMS', 'Supply the complete original JSON input object.');
    return this.#serial(input.requestId, async () => {
      const retained = await this.#intent('prepare', input, { claim: true });
      return this.#merchant.model.createJob({ functionId: input.functionId, input: input.input,
        label: input.label, reference: input.reference ?? ('job_' + input.requestId), claimToken: retained.claimToken });
    });
  }
  renew(input) {
    exact(input, ['requestId','jobId','expectedRevision','reason'], ['requestId','jobId','expectedRevision','reason']);
    checked(input.requestId, N8N_UUID, 'request UUID'); checked(input.jobId, N8N_JOB_ID, 'job identifier');
    revision(input.expectedRevision); text(input.reason, 500, 'the claim renewal reason');
    return this.#serial(input.requestId, async () => {
      const retained = await this.#intent('renew', input, { claim: true });
      const job = await this.#merchant.model.get(input.jobId);
      if (job.revision === input.expectedRevision)
        return this.#merchant.model.renewClaim({ id: input.jobId, expectedRevision: input.expectedRevision,
          reason: input.reason, claimToken: retained.claimToken });
      // A lost HTTP reply after renewal retains the exact private token. The
      // existing create operation verifies that token against this original job;
      // it returns its handoff without changing or recreating the job.
      try {
        return await this.#merchant.model.createJob({ reference: job.id, functionId: job.functionId,
          input: job.input, claimToken: retained.claimToken });
      } catch (error) {
        if (error.code === 'JOB_REFERENCE_EXISTS')
          bad('N8N_REQUEST_SUPERSEDED', 'Refresh the original job; another operation changed this claim or the selected revision.', 409);
        throw error;
      }
    });
  }
  export(input) {
    exact(input, ['requestId','jobId','expectedRevision','expectedDispatchRevision'],
      ['requestId','jobId','expectedRevision','expectedDispatchRevision']);
    checked(input.requestId, N8N_UUID, 'request UUID'); checked(input.jobId, N8N_JOB_ID, 'job identifier');
    revision(input.expectedRevision);
    if (input.expectedDispatchRevision !== null) revision(input.expectedDispatchRevision);
    return this.#serial(input.requestId, async () => {
      await this.#intent('export', input);
      const exportId = exportIdentity(this.#configurationSha256, input.requestId), directory = join(this.#exports, exportId);
      try { return await this.manifest({ exportId }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const before = await this.#merchant.get(input.jobId); selected(before, input);
      const bodies = new Map([['job.json', encode(before.job)], ['dispatch.json', encode(before.dispatch)]]);
      const result = before.job.state === 'COMPLETED' ? await this.#merchant.model.result(input.jobId) : null;
      if (result) bodies.set('result.json', result.body);
      const after = await this.#merchant.get(input.jobId); selected(after, input);
      if (canonical(before) !== canonical(after))
        bad('N8N_EXPORT_REVISION_CHANGED', 'The original records changed during export. Refresh and select their current revisions.', 409);
      const files = [...bodies].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) }));
      const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
      if (files.some(file => file.bytes > N8N_EXPORT_MAX_FILE_BYTES) || totalBytes > N8N_EXPORT_MAX_BYTES)
        bad('N8N_EXPORT_LIMIT', 'The complete original export exceeds its 96 MiB receiving limit.', 413);
      const job = before.job;
      const manifest = { schema: N8N_EXPORT_SCHEMA, exportId, configurationSha256: this.#configurationSha256,
        request: { ...input }, job: { id: job.id, functionId: job.functionId, revision: job.revision, state: job.state,
          inputSha256: job.inputSha256, configSha256: job.source.configSha256,
          applicationSha256: job.source.applicationSha256,
          result: result ? { bytes: result.bytes, sha256: result.sha256, contentType: result.contentType, filename: result.filename } : null },
        files, totalBytes };
      const bytes = encode(manifest); parseN8nJobExport(bytes, exportId);
      validateN8nExportRecords(manifest, bodies.get('job.json'), bodies.get('dispatch.json'));
      const temporary = await privateDirectory(join(this.#exports, '.pending-' + randomUUID()));
      try {
        for (const [name, body] of bodies) await writePrivate(join(temporary, name), body);
        await writePrivate(join(temporary, N8N_EXPORT_MANIFEST), bytes);
        await rename(temporary, directory); await syncDirectory(this.#exports);
      } finally { await rm(temporary, { recursive: true, force: true }); }
      return this.manifest({ exportId });
    });
  }
  async #manifest(exportId) {
    checked(exportId, N8N_SHA, 'export SHA256'); await this.#storage();
    const directory = await privateDirectory(join(this.#exports, exportId), { create: false });
    const bytes = await readPrivate(join(directory, N8N_EXPORT_MANIFEST), 65000);
    const manifest = parseN8nJobExport(bytes, exportId);
    if (manifest.configurationSha256 !== this.#configurationSha256)
      bad('N8N_EXPORT_CHANGED', 'The retained export belongs to a different original merchant configuration.', 409);
    return { directory, bytes, manifest, sha256: hash(bytes) };
  }
  async manifest(input) {
    exact(input, ['exportId'], ['exportId']); const saved = await this.#manifest(input.exportId);
    return { state: 'MANIFEST_RETAINED', exportId: input.exportId,
      manifestFile: { name: N8N_EXPORT_MANIFEST, bytes: saved.bytes.length, sha256: saved.sha256 } };
  }
  async exports(input = {}) {
    exact(input, ['limit','cursor','jobId']); const size = limit(input.limit);
    if (input.jobId !== undefined) checked(input.jobId, N8N_JOB_ID, 'job identifier');
    await this.#storage();
    const scope = hash(canonical({ type: 'exports', configurationSha256: this.#configurationSha256, jobId: input.jobId ?? null }));
    const resume = cursor(input.cursor, scope);
    if (resume && !N8N_SHA.test(resume.after ?? '')) bad('N8N_CURSOR_CHANGED', 'Use the retained export query cursor.', 409);
    const entries = (await readdir(this.#exports, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && N8N_SHA.test(entry.name) && (!resume || entry.name > resume.after))
      .map(entry => entry.name).sort();
    const exports = [];
    for (const exportId of entries) {
      const retained = await this.#manifest(exportId);
      if (input.jobId && retained.manifest.job.id !== input.jobId) continue;
      exports.push({ exportId, job: retained.manifest.job, files: retained.manifest.files,
        totalBytes: retained.manifest.totalBytes, manifestSha256: retained.sha256 });
      if (exports.length > size) break;
    }
    const more = exports.length > size; if (more) exports.pop();
    return { schema: 'stellar-forge.n8n-export-page.v1', exports,
      nextCursor: more ? Buffer.from(canonical({ scope, after: exports.at(-1).exportId })).toString('base64url') : null };
  }
  async file(input) {
    exact(input, ['exportId','file','expectedManifestSha256','expectedSha256','offset','limit','readId'],
      ['exportId','file','expectedManifestSha256','expectedSha256']);
    checked(input.expectedManifestSha256, N8N_SHA, 'manifest SHA256'); checked(input.expectedSha256, N8N_SHA, 'file SHA256');
    if (input.readId !== undefined) checked(input.readId, N8N_UUID, 'read UUID');
    if (![N8N_EXPORT_MANIFEST,'job.json','dispatch.json','result.json'].includes(input.file))
      bad('N8N_INVALID_PARAMS', 'Select a complete file from the original export manifest.');
    const saved = await this.#manifest(input.exportId);
    if (saved.sha256 !== input.expectedManifestSha256)
      bad('N8N_EXPORT_CHANGED', 'The retained manifest differs from the selected SHA256.', 409);
    const descriptor = input.file === N8N_EXPORT_MANIFEST
      ? { name: input.file, bytes: saved.bytes.length, sha256: saved.sha256 }
      : saved.manifest.files.find(file => file.name === input.file);
    if (!descriptor) bad('N8N_FILE_NOT_FOUND', 'This original export does not contain the selected file.', 404);
    if (descriptor.sha256 !== input.expectedSha256)
      bad('N8N_FILE_CHANGED', 'The original manifest lists a different file SHA256.', 409);
    const read = await this.#reads.read({ scope: input.exportId, key: input.file, kind: 'n8n-job-export',
      directory: this.#root, expectedSha256: input.expectedSha256, readId: input.readId,
      offset: input.offset, limit: input.limit,
      load: async () => {
        const bytes = input.file === N8N_EXPORT_MANIFEST ? saved.bytes
          : await readPrivate(join(saved.directory, input.file), N8N_EXPORT_MAX_FILE_BYTES);
        if (bytes.length !== descriptor.bytes || hash(bytes) !== descriptor.sha256)
          bad('N8N_FILE_CHANGED', 'The complete original file differs from its retained manifest.', 409);
        return { bytes, name: descriptor.name, type: 'application/json' };
      } });
    return { ...read, exportId: input.exportId, manifestSha256: saved.sha256 };
  }
  async release(input) {
    exact(input, ['exportId','readId'], ['exportId','readId']);
    checked(input.exportId, N8N_SHA, 'export SHA256'); checked(input.readId, N8N_UUID, 'read UUID');
    await this.#reads.release(input.exportId, input.readId);
    return { state: 'FILE_READ_RELEASED', exportId: input.exportId, readId: input.readId };
  }
  close() {
    return this.#closed ??= (async () => {
      this.#closing = true; await Promise.allSettled([...this.#tails.values()]); await this.#reads.close();
    })();
  }
}
