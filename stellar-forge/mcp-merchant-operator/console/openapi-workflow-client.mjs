// MIT. Typed consumer of the original Console recipe, workflow and customer APIs.
import { open, link, unlink, realpath, lstat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { privateSupportDirectory } from '../host-files.mjs';
import { downloadOpenApiPackage } from '../openapi-workspace-client.mjs';
import { normalizeWorkflowRecipe } from './workflow-recipes.mjs';
import { canonical, digest, fail } from './records.mjs';
import { createOpenApiMaintenanceRecipe, createOpenApiReceivingRecipe,
  OPENAPI_MAINTENANCE_TOOLS, OPENAPI_RECEIVING_TOOLS } from './openapi-workflow-recipes.mjs';
import { validateOpenApiCustomerSelection, validateOpenApiCustomerRecord } from './openapi-customer-records.mjs';
import { encode, parseMerchantPackageExport } from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/package-export-format.mjs';

export const OPENAPI_WORKFLOW_PREPARATION = 'stellar-forge.openapi-workflow-preparation.v1';
export const OPENAPI_WORKFLOW_RUN_REQUEST = 'stellar-forge.openapi-workflow-run-request.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const need = (value, message, code = 'OPENAPI_WORKFLOW_INPUT') => {
  if (!value) throw fail(code, message, 400);
};
const privateError = () => fail('OPENAPI_WORKFLOW_FILE', 'Select a private regular output file in an existing private directory.', 400);
async function recoverCompletedLink(path, handle, info) {
  const parent = dirname(path), prefix = '.' + basename(path) + '.pending-';
  const matches = [];
  for (const name of await readdir(parent)) {
    if (!name.startsWith(prefix) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name.slice(prefix.length))) continue;
    const candidate = join(parent, name);
    let current; try { current = await lstat(candidate); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (current.dev === info.dev && current.ino === info.ino) matches.push(candidate);
  }
  const final = await lstat(path), current = await handle.stat();
  if (!final.isFile() || final.isSymbolicLink() || final.dev !== info.dev || final.ino !== info.ino) throw privateError();
  if (current.nlink === 1) return;
  if (current.nlink !== 2 || matches.length !== 1) throw privateError();
  const pending = matches[0], owned = await lstat(pending).catch(error => {
    if (error.code === 'ENOENT') return null; throw error;
  });
  if (!owned) { if ((await handle.stat()).nlink === 1) return; throw privateError(); }
  if (!owned.isFile() || owned.isSymbolicLink() || owned.dev !== info.dev || owned.ino !== info.ino ||
      process.platform !== 'win32' && (owned.mode & 0o077)) throw privateError();
  const directory = await open(parent, constants.O_RDONLY);
  try {
    await directory.sync();
    const selected = await lstat(pending).catch(error => {
      if (error.code === 'ENOENT') return null; throw error;
    });
    if (selected) {
      if (selected.dev !== info.dev || selected.ino !== info.ino) throw privateError();
      await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await directory.sync();
  } finally { await directory.close(); }
  if ((await handle.stat()).nlink !== 1) throw privateError();
}
async function fileHash(path, expected) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || ![1, 2].includes(info.nlink) || process.platform !== 'win32' && (info.mode & 0o077) ||
        process.getuid && info.uid !== process.getuid()) throw privateError();
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let bytes = 0;
    while (bytes < info.size) {
      const read = await handle.read(buffer, 0, Math.min(buffer.length, info.size - bytes), bytes);
      if (!read.bytesRead) throw privateError();
      hash.update(buffer.subarray(0, read.bytesRead)); bytes += read.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw privateError();
    const result = { bytes, sha256: hash.digest('hex') };
    if (expected.bytes === result.bytes && expected.sha256 === result.sha256 && after.nlink === 2)
      await recoverCompletedLink(path, handle, info);
    return result;
  } finally { await handle.close(); }
}
/** Publish one complete output only after its original bytes have been synced. */
async function retainOutput(path, write) {
  path = resolve(path);
  const parent = dirname(path);
  await privateSupportDirectory(parent);
  if (await realpath(parent) !== parent) throw privateError();
  const temporary = join(parent, '.' + basename(path) + '.pending-' + randomUUID());
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  let summary;
  try {
    summary = await write(handle);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error;
  }
  await handle.close();
  let state = 'SAVED';
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const original = await fileHash(path, summary);
      if (original.bytes !== summary.bytes || original.sha256 !== summary.sha256)
        throw fail('OPENAPI_WORKFLOW_OUTPUT_CONFLICT', 'This output name retains different complete bytes. Choose another name.', 409);
      state = 'REOPENED';
    }
    const directory = await open(parent, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary).catch(() => {}); }
  return { state, path, ...summary };
}
export async function writeOpenApiWorkflowFile(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value) : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return retainOutput(path, async handle => { await handle.writeFile(bytes); return { bytes: bytes.length, sha256: digest(bytes) }; });
}
function preparation(value) {
  need(plain(value) && value.schema === OPENAPI_WORKFLOW_PREPARATION && plain(value.review) && plain(value.install),
    'Read the complete saved recipe preparation.');
  const recipe = normalizeWorkflowRecipe(value.recipe);
  const { contentSha256, ...review } = value.review;
  need(sha(contentSha256) && digest(canonical(review)) === contentSha256 &&
    value.review.canInstall === true && value.install.expectedReviewSha256 === contentSha256 &&
    value.review.recipeSha256 === recipe.contentSha256 &&
    normalizeWorkflowRecipe(value.install.recipe).contentSha256 === recipe.contentSha256 &&
    value.install.id === value.review.id && value.install.profileId === value.review.profileId,
    'Retain the exact original recipe, target review and frozen install request.');
  return value;
}
/** This client pins the existing loopback Console and token for its lifetime. */
export class OpenApiWorkflowClient {
  #base; #token; #signal; #closing = false; #controller = new AbortController(); #maximum;
  constructor({ url, tokenEnv = 'MCP_ACCESS_TOKEN', environment = process.env, signal,
    maximumResponseBytes = 128 * 1024 * 1024 } = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw fail('OPENAPI_CONSOLE_CONNECTION', 'Select the original Console URL and bearer-token environment variable.'); }
    need(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash && ['/operator', '/operator/'].includes(parsed.pathname),
      'Use the original http://127.0.0.1:PORT/operator/ Console URL.', 'OPENAPI_CONSOLE_CONNECTION');
    need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv) && typeof environment[tokenEnv] === 'string' &&
      environment[tokenEnv].length >= 24 && !/[^\x21-\x7e]/.test(environment[tokenEnv]),
      'Use the existing Console bearer-token environment variable.', 'OPENAPI_CONSOLE_CONNECTION');
    need(Number.isSafeInteger(maximumResponseBytes) && maximumResponseBytes >= 1024 && maximumResponseBytes <= 128 * 1024 * 1024,
      'Choose a complete response capacity from 1024 bytes to 128 MiB.');
    this.#base = new URL('/operator/api/', parsed); this.#token = environment[tokenEnv];
    this.#signal = signal; this.#maximum = maximumResponseBytes;
  }
  get endpoint() { return this.#base.href; }
  async response(route, { body, method = body === undefined ? 'GET' : 'POST', signal, timeoutMs = 120000 } = {}, consume) {
    need(typeof route === 'string' && route && !route.startsWith('/') && !route.includes('#'), 'Select an original Console API route.');
    const target = new URL(route, this.#base);
    need(target.origin === this.#base.origin && target.pathname.startsWith(this.#base.pathname),
      'Keep the request on its original Console.');
    if (this.#closing) throw fail('OPENAPI_CONSOLE_CLOSING', 'The selected Console client is closed.');
    const combined = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(timeoutMs), this.#signal, signal].filter(Boolean));
    const writing = method !== 'GET' && method !== 'HEAD';
    let received = false, response;
    try {
      response = await fetch(target, { method, redirect: 'error', cache: 'no-store', signal: combined,
        headers: { authorization: 'Bearer ' + this.#token, origin: this.#base.origin,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) {
        let value;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.#bytes(response, 1024 * 1024))); }
        catch {}
        const error = fail(value?.error?.code ?? 'OPENAPI_CONSOLE_HTTP_' + response.status,
          value?.error?.message ?? 'The original Console returned HTTP ' + response.status + '.', response.status);
        error.outcomeUnknown = writing && response.status >= 500;
        received = true; throw error;
      }
      const result = await consume(response);
      received = true; return result;
    } catch (error) {
      if (writing && !received) error.outcomeUnknown = true;
      throw error;
    } finally {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  }
  async #bytes(response, maximum = this.#maximum) {
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maximum) throw fail('OPENAPI_CONSOLE_RESPONSE_SIZE', 'The complete original response exceeds the selected byte capacity.', 413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes);
  }
  async json(route, body) {
    return this.response(route, { body }, async response => {
      const bytes = await this.#bytes(response);
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw fail('OPENAPI_CONSOLE_RESPONSE', 'Read the complete original Console JSON response.'); }
    });
  }
  host() { return this.json('host'); }
  profiles() { return this.json('profiles'); }
  profile(profileId) { need(id(profileId), 'Select the original profile ID.'); return this.json('profile/' + encodeURIComponent(profileId)); }
  createProfile(input) { return this.json('profiles', input); }
  bindProfile(input) { return this.json('bind', input); }
  definition(workflowId, revision) {
    need(id(workflowId), 'Select the original workflow ID.');
    return this.json('workflow/' + encodeURIComponent(workflowId) + (revision === undefined ? '' : '?revision=' + revision));
  }
  installation(installationId) {
    need(id(installationId), 'Select the original installation ID.');
    return this.json('workflow-recipe-install/' + encodeURIComponent(installationId));
  }
  async createRecipe({ kind = 'maintenance', ...input }) {
    need(['maintenance', 'receiving'].includes(kind), 'Select maintenance or receiving.');
    const names = kind === 'maintenance' ? OPENAPI_MAINTENANCE_TOOLS :
      OPENAPI_RECEIVING_TOOLS.slice(0, input.releaseId === undefined ? 2 : 3);
    const definitions = await Promise.all(names.map(async name => (await this.json('tool/' + name)).definition));
    return (kind === 'maintenance' ? createOpenApiMaintenanceRecipe : createOpenApiReceivingRecipe)({ ...input, definitions });
  }
  async prepare({ kind = 'maintenance', id: installationId, profileId, inputs, acceptToolChanges = [], ...source }) {
    need(id(installationId) && id(profileId), 'Choose the original profile and new installation ID.');
    const recipe = source.recipe === undefined ? await this.createRecipe({ kind, ...source }) : normalizeWorkflowRecipe(source.recipe);
    const request = { id: installationId, profileId, recipe, ...(source.name === undefined ? {} : { name: source.name }),
      ...(inputs === undefined ? {} : { inputs }), acceptToolChanges };
    const received = await this.json('workflow-recipe-review', request);
    need(received.recipe?.contentSha256 === recipe.contentSha256 && plain(received.review),
      'The original review returned another recipe.', 'OPENAPI_CONSOLE_RESPONSE');
    return { schema: OPENAPI_WORKFLOW_PREPARATION, kind, recipe: received.recipe, review: received.review,
      install: { ...request, expectedReviewSha256: received.review.contentSha256 } };
  }
  install(value) { return this.json('workflow-recipe-install', clone(preparation(value).install)); }
  async prepareRun({ id: runId, installationId, workflowRevision, inputs } = {}) {
    need(id(runId) && id(installationId), 'Choose the retained installation and stable run ID.');
    const installed = await this.installation(installationId);
    const definition = workflowRevision === undefined || workflowRevision === installed.definition.revision ? installed.definition :
      (await this.definition(installed.definition.id, workflowRevision)).definition;
    const [host, profile] = await Promise.all([this.host(), this.profile(definition.profileId)]);
    need(host.configurationFingerprint === profile.profile.hostFingerprint,
      'Review and bind this original profile to the destination host before preparing its new run.', 'CONSOLE_HOST_CHANGED');
    need(inputs === undefined || plain(inputs) && Object.keys(inputs).every(key => Object.hasOwn(installed.runInputs, key)),
      'Override only declared complete workflow input fields.');
    const request = { id: runId, profileId: definition.profileId, workflowId: definition.id,
      workflowRevision: definition.revision, expectedWorkflowSha256: definition.contentSha256,
      expectedHostFingerprint: host.configurationFingerprint, inputs: { ...installed.runInputs, ...clone(inputs ?? {}) } };
    return { schema: OPENAPI_WORKFLOW_RUN_REQUEST, installationId, recipeSha256: installed.installation.recipeSha256, request };
  }
  start(value) {
    need(value?.schema === OPENAPI_WORKFLOW_RUN_REQUEST && plain(value.request), 'Read the complete saved original run request.');
    return this.json('workflow-runs', clone(value.request));
  }
  run(runId) { need(id(runId), 'Select the original run ID.'); return this.json('workflow-run/' + encodeURIComponent(runId)); }
  async waitRun(runId, { timeoutMs = 120000, pollMs = 500, signal } = {}) {
    need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && Number.isSafeInteger(pollMs) && pollMs >= 100,
      'Use explicit positive receiving time and polling intervals.');
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = await this.run(runId);
      if (!value.run.active && ['PAUSED', 'WAITING', 'COMPLETE'].includes(value.run.state)) return value;
      if (Date.now() >= until) return value;
      await delay(pollMs, undefined, { signal: signal ?? this.#signal });
    }
  }
  async continueReviewed({ id: runId, expectedRevision, expectedReviewSha256 }) {
    need(Number.isSafeInteger(expectedRevision) && expectedRevision > 0 && sha(expectedReviewSha256),
      'Select the displayed current run revision and complete native policy-review SHA256.');
    const { run } = await this.run(runId), step = run.steps.find(value => value.id === 'review');
    need(run.revision === expectedRevision && run.state === 'PAUSED' && !run.active &&
      step && ['COMPLETE', 'RECOVERED'].includes(step.state), 'Reopen the paused original policy review before continuing.', 'CONSOLE_WORKFLOW_RUN_CHANGED');
    const call = await this.json('call/' + encodeURIComponent(step.resolvedCallId ?? step.callId));
    const result = JSON.parse(call.resultJson);
    need(call.profileId === run.profileId && call.state === 'COMPLETE' && result?.review?.sha256 === expectedReviewSha256,
      'The selected saved native review differs from this original run.', 'OPENAPI_WORKFLOW_REVIEW_CHANGED');
    return this.json('workflow-resume', { id: runId, expectedRevision });
  }
  resume(input) { return this.json('workflow-resume', input); }
  pause(input) { return this.json('workflow-pause', input); }
  resolve(input) { return this.json('workflow-resolve', input); }
  handover(input) { return this.json('workflow-handover', input); }
  exportRecipe(input) { return this.json('workflow-recipe-export', input); }
  saveWorkflow(input) { return this.json('workflows', input); }
  async exportedPackage(runId) {
    const { run } = await this.run(runId);
    const step = run.steps.find(value => value.id === 'export');
    need(step && ['COMPLETE', 'RECOVERED'].includes(step.state), 'Complete the original export step before customer receiving.');
    const call = await this.json('call/' + encodeURIComponent(step.resolvedCallId ?? step.callId));
    need(call.state === 'COMPLETE' && call.profileId === run.profileId && call.tool === 'merchant_openapi_export',
      'Select the original completed package export from this workflow.');
    const result = JSON.parse(call.resultJson), args = JSON.parse(call.argumentsJson);
    const manifestBytes = encode(result.manifest), manifest = parseMerchantPackageExport(manifestBytes, result.exportId);
    need(result.state === 'EXPORTED' && result.workspace === args.workspace && result.manifestFile?.name === 'package-export.json' &&
      result.manifestFile.bytes === manifestBytes.length && result.manifestFile.sha256 === digest(manifestBytes),
      'Retain the complete original export result and its exact manifest.', 'OPENAPI_WORKFLOW_EXPORT_CHANGED');
    return { runId, callId: call.id, profileId: run.profileId, hostFingerprint: call.hostFingerprint,
      family: 'openapi', workspace: result.workspace, exportId: manifest.exportId,
      expectedManifestSha256: result.manifestFile.sha256, manifest, package: manifest.package };
  }
  async receiveCustomer(runId, { expectedHostFingerprint } = {}) {
    const original = await this.exportedPackage(runId);
    const selection = { profileId: original.profileId, family: 'openapi', workspace: original.workspace,
      exportId: original.exportId, expectedManifestSha256: original.expectedManifestSha256,
      expectedHostFingerprint: expectedHostFingerprint ?? original.hostFingerprint };
    return this.json('customers', selection);
  }
  async waitCustomer(profileId, deliveryId, { timeoutMs = 120000, pollMs = 500, signal } = {}) {
    need(id(deliveryId) && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && Number.isSafeInteger(pollMs) && pollMs >= 100,
      'Select the original delivery and receiving interval.');
    const until = Date.now() + timeoutMs;
    for (;;) {
      const profile = await this.profile(profileId), delivery = profile.deliveries.find(value => value.id === deliveryId);
      need(delivery, 'Reopen the original customer receiving record.');
      if (!delivery.active || Date.now() >= until) return { delivery };
      await delay(pollMs, undefined, { signal: signal ?? this.#signal });
    }
  }
  async downloadPackage(runId, options = {}) {
    const selected = await this.exportedPackage(runId);
    if (options.expectedManifestSha256 !== undefined)
      need(options.expectedManifestSha256 === selected.expectedManifestSha256, 'The receiving command selected another export manifest.');
    return downloadOpenApiPackage({ ...options, workspace: selected.workspace, exportId: selected.exportId,
      expectedManifestSha256: selected.expectedManifestSha256 });
  }
  async exportProfile(profileId) {
    need(id(profileId), 'Select the original profile ID.');
    return this.response('export/' + encodeURIComponent(profileId), {}, async response => {
      const bytes = await this.#bytes(response);
      need(response.headers.get('x-content-sha256') === digest(bytes), 'The complete original profile bytes changed.', 'OPENAPI_CONSOLE_RESPONSE');
      const archive = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return { archive, bytes, sha256: digest(bytes) };
    });
  }
  importProfile(archive) {
    need(plain(archive) && sha(archive.contentSha256), 'Receive the complete original profile archive.');
    return this.json('import', { archive, expectedContentSha256: archive.contentSha256 });
  }
  async downloadCustomerArchive({ profileId, deliveryId, output }) {
    const profile = await this.profile(profileId), record = profile.deliveries.find(value => value.id === deliveryId);
    need(record?.localFiles && record.state === 'COMPLETE', 'Finish the original local customer receiving before downloading its archive.');
    validateOpenApiCustomerSelection(record.identity); validateOpenApiCustomerRecord(record);
    return this.response('customer-archive/' + encodeURIComponent(deliveryId), {}, async response => {
      need(response.headers.get('x-client-manifest-sha256') === record.identity.expectedManifestSha256,
        'The streamed customer archive selected another complete manifest.');
      return retainOutput(output, async handle => {
        const hash = createHash('sha256'); let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 130 * 1024 * 1024) throw fail('OPENAPI_WORKFLOW_ARCHIVE_SIZE', 'The complete archive exceeds the original 128 MiB package capacity.');
          hash.update(chunk); await handle.writeFile(chunk);
        }
        return { bytes, sha256: hash.digest('hex'), exportId: record.identity.exportId,
          manifestSha256: record.identity.expectedManifestSha256, root: 'package/' };
      });
    });
  }
  close() { this.#closing = true; this.#controller.abort(); }
}
