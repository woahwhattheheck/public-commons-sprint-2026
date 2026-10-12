// MIT. Agent operations borrow the original paid-job model, inputs and resolution owners.
import { constants } from 'node:fs';
import { readdir, rename, rm, open, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { RetainedFileReads } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { privateDirectory, syncDirectory, readPrivateJson, writePrivateJson,
  checkPrivateFile, sameFile, readChunk } from '../inputs/files.mjs';
import { INPUT_FILES_FIELD, CHUNK_BYTES, fileUploadIdentity } from '../inputs/protocol.mjs';
import { JOB_EXPORT_SCHEMA, JOB_EXPORT_MANIFEST, JOB_EXPORT_MAX_BYTES, JOB_EXPORT_DOCUMENT_BYTES,
  JOB_EXPORT_FILE_BYTES, SHA, UUID, JOB_ID, SLOT, CLAIM, plain, canonical, hash, encode, decode,
  failure, need, exact, checked, integer, text, exportIdentity, exportFileName,
  parsePaidJobExport, validatePaidJobExportRecords } from './format.mjs';

const REQUEST_SCHEMA = 'stellar-forge.paid-job-agent-request.v1';
const owners = new WeakMap();
const PAGE_LIMIT = 200;
const pageSize = value => integer(value ?? 50, 1, PAGE_LIMIT);
const selectJob = input => checked(input.jobId, JOB_ID, 'job ID');
function cursor(value, scope) {
  if (value === undefined || value === '') return null;
  checked(value, /^[A-Za-z0-9_-]{1,2048}$/, 'query cursor');
  let parsed; try { parsed = JSON.parse(decode(Buffer.from(value, 'base64url'))); } catch {}
  need(plain(parsed) && parsed.scope === scope, 'JOB_AGENT_CURSOR_CHANGED',
    'Continue the same original query or restart it after a source change.', 409);
  return parsed;
}
const nextCursor = value => Buffer.from(canonical(value)).toString('base64url');
function caseSummary(view, requestId) {
  const value = view.case;
  const summary = { schema: 'stellar-forge.paid-job-agent-case.v1', job: view.job,
    case: { job: value.job, revision: value.revision, state: value.state, createdAt: value.createdAt,
      updatedAt: value.updatedAt, issues: value.issues.length, messages: value.messages.length,
      decisions: value.decisions.length, operations: value.operations.length, previews: value.previews.length,
      accounting: value.accounting ? { source: value.accounting.source, observedAt: value.accounting.observedAt,
        totals: value.accounting.detail.totals } : null,
      needsRecovery: value.operations.filter(item => ['DISPATCHING','UNKNOWN'].includes(item.state))
        .map(item => ({ id: item.id, kind: item.kind, state: item.state })) },
    connection: view.connection };
  if (requestId) summary.selected = Object.fromEntries(
    ['messages','decisions','operations','previews'].map(section =>
      [section, value[section].filter(item => item.id === requestId || item.requestId === requestId)]));
  return summary;
}
async function bytesAt(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat(); checkPrivateFile(before, maximum);
    const bytes = await handle.readFile();
    need(bytes.length <= maximum && sameFile(before, await handle.stat()), 'JOB_AGENT_FILE_CHANGED',
      'The complete original document changed during its read.', 409);
    return bytes;
  } finally { await handle.close(); }
}
async function writeBytes(path, bytes, signal) {
  signal?.throwIfAborted();
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); signal?.throwIfAborted(); await file.sync(); }
  finally { await file.close(); }
}
async function retainedDirectory(path) {
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid()) && await realpath(path) === path,
    'JOB_AGENT_EXPORT_DIRECTORY_INVALID', 'Select an original private retained export.', 409);
  return path;
}

/** One adapter per original model. Its owning workspace drains before the model closes. */
export function acquirePaidJobAgentOperations({ model, inputDesk }) {
  let owned = owners.get(model);
  if (!owned) {
    owned = { operations: new PaidJobAgentOperations({ model, inputDesk }), references: 0 };
    owners.set(model, owned);
  }
  owned.references++;
  let released = false;
  return { operations: owned.operations, async close() {
    if (released) return; released = true;
    if (--owned.references === 0) {
      try { await owned.operations.close(); } finally { if (owners.get(model) === owned) owners.delete(model); }
    }
  } };
}

export class PaidJobAgentOperations {
  #model; #desk; #root; #requests; #exports; #ready;
  #reads = new RetainedFileReads({ errorPrefix: 'JOB_AGENT', maxSnapshotBytes: 4 * 1024 * 1024 });
  #tails = new Map(); #active = new Set(); #controllers = new Set(); #closing = false; #closed;
  constructor({ model, inputDesk } = {}) {
    need(model && typeof model.get === 'function' && typeof model.snapshot === 'function' && model.resolution,
      'JOB_AGENT_MODEL_REQUIRED', 'Open the original paid-job merchant first.');
    this.#model = model; this.#desk = inputDesk;
    this.#root = join(model.directory, 'agent-operations');
    this.#requests = join(this.#root, 'requests'); this.#exports = join(this.#root, 'exports');
  }
  async #storage() {
    this.#ready ??= (async () => {
      await privateDirectory(this.#root); await privateDirectory(this.#requests); await privateDirectory(this.#exports);
    })().catch(error => { this.#ready = null; throw error; });
    return this.#ready;
  }
  #serial(key, action) {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    this.#tails.set(key, pending);
    pending.finally(() => { if (this.#tails.get(key) === pending) this.#tails.delete(key); }).catch(() => {});
    return pending;
  }
  async #source() { return hash(canonical((await this.#model.snapshot()).source)); }
  async #intent(kind, input, { claim = false, sourceSha256, signal } = {}) {
    await this.#storage();
    const requestId = checked(input.requestId, UUID, 'request UUID');
    const path = join(this.#requests, requestId + '.json'), payloadSha256 = hash(canonical(input));
    let retained;
    try { retained = await readPrivateJson(path, 65000); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      retained = { schema: REQUEST_SCHEMA, requestId, kind, payloadSha256,
        sourceSha256: sourceSha256 ?? await this.#source(), createdAt: new Date().toISOString(),
        ...(claim ? { claimToken: input.claimToken ?? randomBytes(32).toString('base64url') } : {}) };
      await writePrivateJson(path, retained, () => signal?.throwIfAborted());
    }
    need(retained.schema === REQUEST_SCHEMA && retained.requestId === requestId && retained.kind === kind &&
      retained.payloadSha256 === payloadSha256 && SHA.test(retained.sourceSha256 ?? '') &&
      (kind === 'export' || retained.sourceSha256 === (sourceSha256 ?? await this.#source())) &&
      (!claim || CLAIM.test(retained.claimToken ?? '')), 'JOB_AGENT_REQUEST_CONFLICT',
      'Resume this original request with the same fields, or select a new request UUID.', 409);
    return retained;
  }
  async #status() {
    const { jobs, ...state } = await this.#model.snapshot();
    return { ...state, schema: 'stellar-forge.paid-job-agent-status.v1',
      resolution: await this.#model.resolution.status(), fileReads: this.#reads.summary };
  }
  async #jobs(input) {
    exact(input, ['limit','cursor','q','status','functionId']);
    const limit = pageSize(input.limit), q = input.q === undefined ? '' : text(input.q, 300, { empty: true }).toLowerCase();
    if (input.status !== undefined) checked(input.status, /^[A-Z_]{1,32}$/, 'job state');
    if (input.functionId !== undefined) checked(input.functionId, SLOT, 'function ID');
    const snapshot = await this.#model.snapshot();
    const scope = hash(canonical({ type: 'jobs', source: snapshot.source, q,
      status: input.status ?? null, functionId: input.functionId ?? null }));
    const resume = cursor(input.cursor, scope);
    need(!resume || resume.revision === snapshot.revision && Number.isSafeInteger(resume.offset) && resume.offset >= 0,
      'JOB_AGENT_CURSOR_CHANGED', 'The original jobs changed; restart this query at the current collection revision.', 409);
    const rows = snapshot.jobs.filter(row => (!input.status || row.state === input.status) &&
      (!input.functionId || row.functionId === input.functionId) &&
      (!q || [row.id,row.functionId,row.label].some(value => String(value ?? '').toLowerCase().includes(q))));
    const offset = resume?.offset ?? 0; need(offset <= rows.length, 'JOB_AGENT_CURSOR_CHANGED', 'Restart the current query.', 409);
    const jobs = rows.slice(offset, offset + limit), next = offset + jobs.length;
    return { schema: 'stellar-forge.paid-job-agent-job-page.v1', revision: snapshot.revision,
      total: rows.length, jobs, nextCursor: next < rows.length ? nextCursor({ scope, revision: snapshot.revision, offset: next }) : null };
  }
  #prepare(input, signal) {
    exact(input, ['requestId','reference','functionId','input','label','claimToken'], ['requestId','functionId','input']);
    checked(input.requestId, UUID, 'request UUID'); checked(input.functionId, SLOT, 'function ID');
    if (input.reference !== undefined) checked(input.reference, JOB_ID, 'job reference');
    if (input.label !== undefined) text(input.label, 300, { empty: true });
    if (input.claimToken !== undefined) checked(input.claimToken, CLAIM, 'private original customer claim');
    need(plain(input.input), 'JOB_AGENT_INVALID_PARAMS', 'Supply the complete original input object.');
    if (this.#model.configuration.functions[input.functionId]?.inputFiles &&
        Object.keys(input.input[INPUT_FILES_FIELD] ?? {}).length)
      need(input.reference && input.claimToken, 'JOB_AGENT_INPUT_CLAIM_REQUIRED',
        'Use the original uploaded files, their job reference and their private customer claim.');
    return this.#serial(input.requestId, async () => {
      const retained = await this.#intent('prepare', input, { claim: true, signal });
      signal.throwIfAborted();
      return this.#model.createJob({ functionId: input.functionId, input: input.input, label: input.label,
        reference: input.reference ?? ('job_' + input.requestId), claimToken: retained.claimToken, signal });
    });
  }
  #renew(input, signal) {
    exact(input, ['requestId','jobId','expectedRevision','reason'], ['requestId','jobId','expectedRevision','reason']);
    checked(input.requestId, UUID, 'request UUID'); selectJob(input); integer(input.expectedRevision, 1); text(input.reason, 500);
    return this.#serial(input.requestId, async () => {
      const retained = await this.#intent('renew', input, { claim: true, signal });
      signal.throwIfAborted();
      const job = await this.#model.get(input.jobId);
      if (job.revision === input.expectedRevision) return this.#model.renewClaim({ id: input.jobId,
        expectedRevision: input.expectedRevision, reason: input.reason, claimToken: retained.claimToken });
      try { return await this.#model.createJob({ reference: job.id, functionId: job.functionId,
        input: job.input, claimToken: retained.claimToken, signal }); }
      catch (error) {
        if (error.code === 'JOB_REFERENCE_EXISTS') throw failure('JOB_AGENT_REQUEST_SUPERSEDED',
          'Another decision changed this claim or job revision. Read the original job before renewing again.', 409);
        throw error;
      }
    });
  }
  async #caseRead(input) {
    exact(input, ['jobId','section','limit','cursor','requestId'], ['jobId']);
    selectJob(input); const section = input.section ?? 'summary';
    checked(section, /^(summary|issues|messages|decisions|operations|previews|history|accounting|receipt)$/, 'case section');
    if (input.requestId !== undefined) checked(input.requestId, UUID, 'request UUID');
    const view = await this.#model.resolution.get(input.jobId), selected = caseSummary(view, input.requestId);
    if (section === 'summary') return selected;
    if (section === 'accounting' || section === 'receipt')
      return { ...selected, section, value: section === 'accounting' ? view.case.accounting : view.customer };
    const limit = pageSize(input.limit);
    const scope = hash(canonical({ type: 'case', jobId: input.jobId, section, requestId: input.requestId ?? null }));
    const resume = cursor(input.cursor, scope);
    need(!resume || resume.revision === view.case.revision && Number.isSafeInteger(resume.offset) && resume.offset >= 0,
      'JOB_AGENT_CURSOR_CHANGED', 'The original case changed; read the selected section at its new revision.', 409);
    const rows = view.case[section].filter(item => !input.requestId || item.id === input.requestId || item.requestId === input.requestId);
    const offset = resume?.offset ?? 0; need(offset <= rows.length, 'JOB_AGENT_CURSOR_CHANGED', 'Restart this case section.', 409);
    const items = rows.slice(offset, offset + limit), next = offset + items.length;
    return { ...selected, section, items, total: rows.length,
      nextCursor: next < rows.length ? nextCursor({ scope, revision: view.case.revision, offset: next }) : null };
  }
  async #caseAction(action, input) {
    const methods = { reply: 'reply', state: 'setCase', job: 'jobAction', bind: 'bind', refresh: 'refresh',
      preview: 'preview', record: 'record', verify: 'verify', withdraw: 'withdraw', recover: 'recover', resume: 'resume' };
    need(Object.hasOwn(methods, action), 'JOB_AGENT_INVALID_PARAMS', 'Select an original case operation.');
    const fields = {
      reply: ['requestId','expectedRevision','message','issueId'],
      state: ['requestId','expectedRevision','state','message','actor'],
      job: ['requestId','expectedRevision','kind','expectedJobRevision','message','actor'],
      bind: ['runId','expectedRevision'], refresh: [],
      preview: ['requestId','expectedRevision','kind','amountAtomic','effectiveAt','reason','actor','reference'],
      record: ['requestId','expectedRevision'],
      verify: ['requestId','expectedRevision','adjustmentId','transaction','actor'],
      withdraw: ['requestId','expectedRevision','adjustmentId','actor','reason'],
      recover: ['requestId'], resume: ['requestId','expectedRevision'],
    };
    exact(input, ['jobId', ...fields[action]], ['jobId', ...fields[action].filter(key => !['issueId','reference'].includes(key))]);
    const { jobId, ...decision } = input; selectJob(input);
    const view = await this.#model.resolution[methods[action]](jobId, decision);
    return caseSummary(view, input.requestId);
  }
  async #copyInput(directory, selected, signal) {
    const source = await this.#model.inputs.openFile(selected.uploadId, undefined, { signal });
    let target;
    try {
      target = await open(join(directory, selected.file),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      const digest = createHash('sha256');
      for (let position = 0; position < selected.descriptor.bytes; position += CHUNK_BYTES) {
        const body = await readChunk(source.file, Math.min(CHUNK_BYTES, selected.descriptor.bytes - position), position, signal);
        digest.update(body);
        for (let offset = 0; offset < body.length;) {
          signal.throwIfAborted();
          const { bytesWritten } = await target.write(body, offset, body.length - offset, position + offset);
          need(bytesWritten > 0, 'JOB_AGENT_EXPORT_WRITE_FAILED', 'The original input copy could not advance.', 500);
          offset += bytesWritten;
        }
      }
      signal.throwIfAborted();
      need(digest.digest('hex') === selected.descriptor.sha256 && sameFile(source.info, await source.file.stat()),
        'JOB_AGENT_INPUT_CHANGED', 'The original input changed during its complete export.', 409);
      await target.sync();
    } finally { try { await target?.close(); } finally { await source.file.close(); } }
  }
  #export(input, signal) {
    exact(input, ['requestId','jobId','expectedRevision','expectedCaseRevision'],
      ['requestId','jobId','expectedRevision','expectedCaseRevision']);
    checked(input.requestId, UUID, 'request UUID'); selectJob(input); integer(input.expectedRevision, 1);
    if (input.expectedCaseRevision !== null) integer(input.expectedCaseRevision);
    return this.#serial(input.requestId, async () => {
      const retained = await this.#intent('export', input, { signal });
      const exportId = exportIdentity(retained.sourceSha256, input.requestId), directory = join(this.#exports, exportId);
      try { return await this.#manifestInfo({ exportId }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      signal.throwIfAborted();
      const job = await this.#model.get(input.jobId), sourceSha256 = hash(canonical(job.source));
      need(sourceSha256 === retained.sourceSha256 && job.revision === input.expectedRevision,
        'JOB_AGENT_EXPORT_REVISION_CHANGED', 'Read the original job and export its current source and revision.', 409);
      const resolution = job.settlement ? await this.#model.resolution.export(job.id) : null;
      need((resolution?.case.revision ?? null) === input.expectedCaseRevision,
        'JOB_AGENT_EXPORT_REVISION_CHANGED', 'Read the original case and select its current revision.', 409);
      const bodies = new Map([['job.json', encode(job)]]);
      const policy = this.#model.configuration.functions[job.functionId]?.inputFiles ?? null;
      if (policy) bodies.set('input-policy.json', encode(policy));
      const result = job.state === 'COMPLETED' ? await this.#model.result(job.id) : null;
      if (result) bodies.set('result.bin', result.body);
      if (resolution) {
        bodies.set('resolution.json', encode(resolution));
        bodies.set('customer-receipt.json', encode(resolution.customerReceipt));
      }
      let accounting = null;
      if (resolution?.case.accounting) {
        const file = await this.#model.resolution.accountingExport(job.id);
        need(file.bytes instanceof Uint8Array, 'JOB_AGENT_ACCOUNTING_EXPORT_INVALID',
          'Receive the complete unchanged original accounting export.', 409);
        bodies.set('accounting.json', Buffer.from(file.bytes));
        accounting = { runId: resolution.case.accounting.source.runId,
          eventId: resolution.case.accounting.source.eventId, sha256: hash(file.bytes) };
      }
      const inputs = Object.entries(policy ? job.input[INPUT_FILES_FIELD] ?? {} : {}).sort(([a],[b]) => a.localeCompare(b))
        .map(([slot, descriptor]) => ({ slot, descriptor,
          uploadId: fileUploadIdentity({ origin: job.source.publicOrigin, reference: job.id, functionId: job.functionId, slot, file: descriptor }),
          file: 'input_' + slot + '.bin' }));
      const files = [...bodies].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) }))
        .concat(inputs.map(item => ({ name: item.file, bytes: item.descriptor.bytes, sha256: item.descriptor.sha256 })));
      const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
      need(totalBytes <= JOB_EXPORT_MAX_BYTES, 'JOB_AGENT_EXPORT_LIMIT', 'The original complete export exceeds its receiving limit.', 413);
      const manifest = { schema: JOB_EXPORT_SCHEMA, exportId, sourceSha256, request: { ...input },
        job: { id: job.id, functionId: job.functionId, revision: job.revision, state: job.state,
          inputSha256: job.inputSha256, configSha256: job.source.configSha256, applicationSha256: job.source.applicationSha256,
          result: result ? { bytes: result.bytes, sha256: result.sha256, filename: result.filename, contentType: result.contentType } : null },
        resolution: resolution ? { revision: resolution.case.revision, caseSha256: resolution.caseSha256 } : null,
        accounting, inputPolicy: policy ? { file: 'input-policy.json', policySha256: policy.policySha256 } : null,
        inputs, files, totalBytes };
      const manifestBytes = encode(manifest); parsePaidJobExport(manifestBytes, exportId);
      validatePaidJobExportRecords(manifest, { jobBytes: bodies.get('job.json'),
        resolutionBytes: bodies.get('resolution.json'), receiptBytes: bodies.get('customer-receipt.json'),
        accountingBytes: bodies.get('accounting.json'), policyBytes: bodies.get('input-policy.json') });
      const temporary = await privateDirectory(join(this.#exports, '.pending-' + exportId));
      try {
        // A prior process may have left only an incomplete private export stage.
        // Its immutable destination is absent; recreate just this request's stage.
        await rm(temporary, { recursive: true, force: true });
        await privateDirectory(temporary);
        for (const [name, bytes] of bodies) await writeBytes(join(temporary, name), bytes, signal);
        for (const selected of inputs) await this.#copyInput(temporary, selected, signal);
        const after = await this.#model.get(job.id);
        const currentCase = resolution ? await this.#model.resolution.get(job.id) : null;
        need(canonical(after) === canonical(job) && (currentCase?.case.revision ?? null) === input.expectedCaseRevision &&
          (!currentCase || canonical(currentCase.case) === canonical(resolution.case)),
          'JOB_AGENT_EXPORT_REVISION_CHANGED', 'The original job or case changed during export; refresh their selected revisions.', 409);
        await writeBytes(join(temporary, JOB_EXPORT_MANIFEST), manifestBytes, signal);
        await syncDirectory(temporary); signal.throwIfAborted();
        await rename(temporary, directory); await syncDirectory(this.#exports);
      } finally { await rm(temporary, { recursive: true, force: true }); }
      return this.#manifestInfo({ exportId });
    });
  }
  async #manifest(exportId) {
    checked(exportId, SHA, 'export SHA256'); await this.#storage();
    const directory = await retainedDirectory(join(this.#exports, exportId));
    const bytes = await bytesAt(join(directory, JOB_EXPORT_MANIFEST), 65000);
    return { directory, bytes, manifest: parsePaidJobExport(bytes, exportId), sha256: hash(bytes) };
  }
  async #manifestInfo(input) {
    exact(input, ['exportId'], ['exportId']); const saved = await this.#manifest(input.exportId);
    return { state: 'MANIFEST_RETAINED', exportId: input.exportId,
      manifestFile: { name: JOB_EXPORT_MANIFEST, bytes: saved.bytes.length, sha256: saved.sha256 } };
  }
  async #exportsPage(input) {
    exact(input, ['limit','cursor','jobId']); const limit = pageSize(input.limit);
    if (input.jobId !== undefined) selectJob(input);
    await this.#storage();
    const scope = hash(canonical({ type: 'exports', directory: this.#model.directory, jobId: input.jobId ?? null }));
    const resume = cursor(input.cursor, scope);
    if (resume) checked(resume.after, SHA, 'last export SHA256');
    const names = (await readdir(this.#exports, { withFileTypes: true }))
      .filter(item => item.isDirectory() && SHA.test(item.name)).map(item => item.name).sort();
    const snapshotSha256 = hash(canonical(names));
    need(!resume || resume.snapshotSha256 === snapshotSha256, 'JOB_AGENT_CURSOR_CHANGED',
      'The retained export inventory changed; restart this query to read its current complete inventory.', 409);
    const exports = [];
    for (const exportId of names) {
      if (resume && exportId <= resume.after) continue;
      const saved = await this.#manifest(exportId);
      if (input.jobId && saved.manifest.job.id !== input.jobId) continue;
      exports.push({ exportId, job: saved.manifest.job, resolution: saved.manifest.resolution,
        accounting: saved.manifest.accounting, files: saved.manifest.files,
        totalBytes: saved.manifest.totalBytes, manifestSha256: saved.sha256 });
      if (exports.length > limit) break;
    }
    const more = exports.length > limit; if (more) exports.pop();
    return { schema: 'stellar-forge.paid-job-agent-export-page.v1', snapshotSha256, exports,
      nextCursor: more ? nextCursor({ scope, snapshotSha256, after: exports.at(-1).exportId }) : null };
  }
  async #file(input) {
    exact(input, ['exportId','file','expectedManifestSha256','expectedSha256','offset','limit','readId'],
      ['exportId','file','expectedManifestSha256','expectedSha256']);
    checked(input.expectedManifestSha256, SHA, 'manifest SHA256'); checked(input.expectedSha256, SHA, 'file SHA256');
    if (input.readId !== undefined) checked(input.readId, UUID, 'read UUID');
    need(input.file === JOB_EXPORT_MANIFEST || exportFileName(input.file),
      'JOB_AGENT_INVALID_PARAMS', 'Select an original file from the complete export manifest.');
    const saved = await this.#manifest(input.exportId);
    need(saved.sha256 === input.expectedManifestSha256, 'JOB_AGENT_EXPORT_CHANGED', 'The selected manifest SHA256 differs.', 409);
    const file = input.file === JOB_EXPORT_MANIFEST ? { name: input.file, bytes: saved.bytes.length, sha256: saved.sha256 }
      : saved.manifest.files.find(item => item.name === input.file);
    need(file, 'JOB_AGENT_FILE_NOT_FOUND', 'This export has no selected original file.', 404);
    need(file.sha256 === input.expectedSha256, 'JOB_AGENT_FILE_CHANGED', 'The original file SHA256 differs.', 409);
    const read = await this.#reads.read({ scope: input.exportId, key: input.file, kind: 'paid-job-export',
      directory: this.#root, expectedSha256: input.expectedSha256, readId: input.readId,
      offset: input.offset, limit: input.limit, load: async () => {
        const handle = await open(join(saved.directory, input.file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try { const info = await handle.stat(); checkPrivateFile(info, file.bytes);
          need(info.size === file.bytes, 'JOB_AGENT_FILE_CHANGED', 'The retained original file size differs.', 409);
        } catch (error) { await handle.close(); throw error; }
        return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256, name: file.name,
          type: file.name.endsWith('.json') ? 'application/json' : 'application/octet-stream' };
      } });
    return { ...read, exportId: input.exportId, manifestSha256: saved.sha256 };
  }
  async #release(input) {
    exact(input, ['exportId','readId'], ['exportId','readId']);
    checked(input.exportId, SHA, 'export SHA256'); checked(input.readId, UUID, 'read UUID');
    await this.#reads.release(input.exportId, input.readId);
    return { state: 'FILE_READ_RELEASED', exportId: input.exportId, readId: input.readId };
  }
  async #execute(action, input, signal) {
    if (action === 'status') { exact(input, []); return this.#status(); }
    if (action === 'jobs') return this.#jobs(input);
    if (action === 'job') { exact(input, ['jobId'], ['jobId']); return this.#model.get(selectJob(input)); }
    if (action === 'prepare') return this.#prepare(input, signal);
    if (action === 'renew') return this.#renew(input, signal);
    if (action === 'case_read') return this.#caseRead(input);
    if (action.startsWith('case_')) return this.#caseAction(action.slice(5), input);
    if (action === 'accounting') { exact(input, []); return this.#model.resolution.accountingState(); }
    if (action === 'receive') { const view = await this.#model.resolution.receive(input); return caseSummary(view); }
    if (action === 'inputs') return this.#desk.query(input);
    if (action === 'input') { exact(input, ['uploadId'], ['uploadId']); checked(input.uploadId, SHA, 'upload ID'); return this.#desk.get(input.uploadId); }
    if (action === 'input_preview') {
      exact(input, ['uploadId','maxBytes'], ['uploadId']); checked(input.uploadId, SHA, 'upload ID');
      return this.#desk.preview(input.uploadId, { maxBytes: input.maxBytes, signal });
    }
    if (action === 'input_discard') {
      exact(input, ['uploadId','expectedRevision','reason','releaseOrphan'], ['uploadId','expectedRevision','reason']);
      checked(input.uploadId, SHA, 'upload ID');
      const { uploadId, ...decision } = input; return this.#desk.discard({ id: uploadId, ...decision });
    }
    if (action === 'export') return this.#export(input, signal);
    if (action === 'exports') return this.#exportsPage(input);
    if (action === 'manifest') return this.#manifestInfo(input);
    if (action === 'file') return this.#file(input);
    if (action === 'file_release') return this.#release(input);
    throw failure('JOB_AGENT_ACTION_NOT_FOUND', 'Select an original paid-job agent operation.', 404);
  }
  call(action, input = {}, { signal } = {}) {
    if (this.#closing) return Promise.reject(failure('JOB_AGENT_CLOSING', 'The original job agent workspace is closing.', 503));
    const controller = new AbortController(); this.#controllers.add(controller);
    const selected = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const pending = (async () => { selected.throwIfAborted(); return this.#execute(action, input, selected); })();
    this.#active.add(pending);
    pending.finally(() => { this.#active.delete(pending); this.#controllers.delete(controller); }).catch(() => {});
    return pending;
  }
  close() {
    return this.#closed ??= (async () => {
      this.#closing = true;
      for (const controller of this.#controllers) controller.abort(failure('JOB_AGENT_CLOSING', 'The original agent workspace is closing.', 503));
      const reads = this.#reads.close();
      await Promise.allSettled([...this.#active]); await reads;
    })();
  }
}
