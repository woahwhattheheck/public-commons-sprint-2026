// MIT. Named programmes through the original live Analysis capability.
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { writeConsoleWorkflowStream, inspectConsoleWorkflowFile } from './console/client-files.mjs';
import { createRetainedDownload } from './retained-download.mjs';
import { WORLDBANK_ID, WORLDBANK_NAME, WORLDBANK_ALIAS, WORLDBANK_SHA, WORLDBANK_FILE_BYTES,
  WORLDBANK_MANIFEST_NAME, parseWorldBankDelivery, worldBankDescriptor, worldBankFileName,
  worldBankNeed as need, worldBankFailure as fail, plain } from './worldbank-programme-contracts.mjs';

const name = value => { need(typeof value === 'string' && WORLDBANK_NAME.test(value) && value !== 'sources', 'Select an original programme name.'); return encodeURIComponent(value); };
const id = value => { need(typeof value === 'string' && WORLDBANK_ID.test(value), 'Retain the original 32-character operation ID.'); return value; };
const root = 'worldbank-programmes';
const operation = (programme, value) => root + '/' + name(programme) + '/operations/' + id(value);
function page(options = {}, names = false) {
  need(plain(options) && Object.keys(options).every(key => ['before', 'limit'].includes(key)), 'Select the original page cursor.');
  const query = new URLSearchParams();
  if (options.before !== undefined && options.before !== null) {
    need(names ? typeof options.before === 'string' && WORLDBANK_NAME.test(options.before) :
      Number.isSafeInteger(options.before) && options.before > 0, 'Continue the actual returned page cursor.');
    query.set('before', String(options.before));
  }
  if (options.limit !== undefined) {
    need(Number.isSafeInteger(options.limit) && options.limit >= 1 && options.limit <= 100, 'Read a complete page of 1–100 records.');
    query.set('limit', String(options.limit));
  }
  return query.size ? '?' + query : '';
}
/** Pins one observed original launch and workspace for this client's lifetime. */
export class WorldBankProgrammeClient {
  #base; #token; #workspaceId; #signal; #closing = false; #controller = new AbortController();
  constructor({ launch, workspaceId, signal } = {}) {
    let url;
    try { url = new URL(launch?.url); } catch { throw fail('WORLDBANK_CONNECTION', 'Read the original private Analysis launch file.'); }
    need(launch?.schema === 'stellar-forge.customer-analysis.v1' && WORLDBANK_ID.test(workspaceId) &&
      launch.workspace_id === workspaceId && url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      !url.username && !url.password && !url.search && url.pathname === '/' &&
      /^[A-Za-z0-9_-]{24,256}$/.test(url.hash.slice(1)),
    'Use the original numeric-loopback Analysis launch and its exact workspace ID.', 'WORLDBANK_CONNECTION');
    this.#token = url.hash.slice(1); this.#base = new URL('/api/', url);
    this.#workspaceId = workspaceId; this.#signal = signal;
  }
  get workspaceId() { return this.#workspaceId; }
  async #bytes(response, maximum) {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maximum) throw fail('WORLDBANK_RESPONSE_SIZE', 'The original complete response exceeds its selected capacity.', 413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }
  async #response(route, body, consume, { timeoutMs = 120000 } = {}) {
    need(typeof route === 'string' && route && !route.startsWith('/') && !route.includes('#'), 'Select an original Analysis route.');
    const target = new URL(route, this.#base);
    need(target.origin === this.#base.origin && target.pathname.startsWith('/api/'), 'Keep the original local Analysis capability.');
    if (this.#closing) throw fail('WORLDBANK_CONNECTION_CLOSING', 'The original Analysis client is closing.');
    let encoded;
    if (body !== undefined) {
      need(plain(body), 'Retain the complete original request object.');
      encoded = JSON.stringify(body);
      need(Buffer.byteLength(encoded) <= 1024 * 1024, 'The original Analysis request accepts at most one MiB.');
    }
    const signal = AbortSignal.any([this.#controller.signal, this.#signal, AbortSignal.timeout(timeoutMs)].filter(Boolean));
    let response, answered = false;
    try {
      response = await fetch(target, { method: body === undefined ? 'GET' : 'POST',
        redirect: 'error', cache: 'no-store', signal,
        headers: { 'X-Analysis-Capability': this.#token, origin: this.#base.origin,
          ...(encoded === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(encoded === undefined ? {} : { body: encoded }) });
      if (!response.ok) {
        let value;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.#bytes(response, 1024 * 1024))); } catch {}
        const code = typeof value?.error === 'string' ? value.error : value?.error?.code;
        const error = fail(code || 'WORLDBANK_HTTP_' + response.status,
          value?.error?.message || code || 'The original Analysis service returned HTTP ' + response.status + '.', response.status);
        error.details = value ?? null; error.outcomeUnknown = body !== undefined && response.status >= 500;
        answered = true; throw error;
      }
      const result = await consume(response); answered = true; return result;
    } catch (error) {
      if (body !== undefined && !answered) error.outcomeUnknown = true;
      throw error;
    } finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
  }
  async json(route, body) {
    return this.#response(route, body, async response => {
      const raw = await this.#bytes(response, 128 * 1024 * 1024);
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
      catch { throw fail('WORLDBANK_RESPONSE', 'Read the complete original Analysis JSON response.'); }
    });
  }
  async state() {
    const value = await this.json('state');
    need(value.workspace_id === this.#workspaceId, 'The live Analysis service belongs to a different workspace.', 'WORLDBANK_WORKSPACE_CHANGED');
    return value;
  }
  list(options) { return this.json(root + page(options, true)); }
  sources(options) { return this.json(root + '/sources' + page(options)); }
  definition(programme) { return this.json(root + '/' + name(programme)); }
  history(programme, options) { return this.json(root + '/' + name(programme) + '/history' + page(options)); }
  save(programme, request) { id(request?.id); return this.json(root + '/' + name(programme), request); }
  prepare(programme, request) { id(request?.id); return this.json(root + '/' + name(programme) + '/prepare', request); }
  status(programme, operationId) { return this.json(operation(programme, operationId)); }
  review(programme, operationId) { return this.json(operation(programme, operationId) + '/review'); }
  publish(programme, request) { return this.json(operation(programme, request?.id) + '/publish', request); }
  reopen(programme, request) { id(request?.id); id(request?.operation_id); return this.json(root + '/' + name(programme) + '/reopen', request); }
  comparison(comparisonId, { kind = 'all', after = 0 } = {}) {
    id(comparisonId); need(typeof kind === 'string' && /^[a-z_-]{1,40}$/.test(kind) &&
      Number.isSafeInteger(after) && after >= 0, 'Retain the original comparison cursor and kind.');
    return this.json('changes/' + comparisonId + '?' + new URLSearchParams({ kind, after: String(after) }));
  }
  async wait(programme, operationId, { timeoutMs = 120000, pollMs = 500 } = {}) {
    need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000 &&
      Number.isSafeInteger(pollMs) && pollMs >= 100 && pollMs <= 10000, 'Select the bounded original operation wait.');
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = await this.status(programme, operationId);
      if (value.status !== 'RUNNING' || Date.now() >= until) return value;
      await delay(Math.min(pollMs, Math.max(1, until - Date.now())), undefined,
        { signal: AbortSignal.any([this.#controller.signal, this.#signal].filter(Boolean)) });
    }
  }
  async download(programme, operationId, descriptor, output) {
    return this.#download(operation(programme, operationId) + '/files/' + encodeURIComponent(worldBankFileName(descriptor.name)), descriptor, output);
  }
  async #download(route, descriptor, output) {
    worldBankDescriptor(descriptor);
    try {
      const saved = await inspectConsoleWorkflowFile(output, descriptor);
      need(saved.bytes === descriptor.bytes && saved.sha256 === descriptor.sha256,
        'The retained output contains different original bytes.', 'WORLDBANK_FILE_CHANGED');
      return { state: 'REOPENED', path: output, ...saved };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this.#response(route,
      undefined, async response => {
        need(response.headers.get('x-content-sha256') === descriptor.sha256 &&
          response.headers.get('content-length') === String(descriptor.bytes),
        'The original file download differs from its accepted descriptor.', 'WORLDBANK_FILE_CHANGED');
        return writeConsoleWorkflowStream(output, async handle => {
          let bytes = 0; const hash = createHash('sha256');
          for await (const chunk of response.body) {
            bytes += chunk.length;
            need(bytes <= descriptor.bytes && bytes <= WORLDBANK_FILE_BYTES, 'The native file exceeded its original byte count.', 'WORLDBANK_FILE_CHANGED');
            hash.update(chunk); await handle.writeFile(chunk);
          }
          const sha256 = hash.digest('hex');
          need(bytes === descriptor.bytes && sha256 === descriptor.sha256,
            'The complete native file differs from its original hash or byte count.', 'WORLDBANK_FILE_CHANGED');
          return { bytes, sha256 };
        });
      }, { timeoutMs: 60 * 60 * 1000 });
  }

  intakeList(options) { return this.json('worldbank-intake' + page(options)); }
  async intakeStatus(intakeId) {
    const value = await this.json('worldbank-intake/' + id(intakeId));
    need(value.workspace_id === this.#workspaceId && value.id === intakeId,
      'Keep the original intake and workspace identity.', 'WORLDBANK_INTAKE_CHANGED');
    return value;
  }
  intakeBegin(request) { id(request?.id); return this.json('worldbank-intake', request); }
  intakeChunk(intakeId, request) { return this.json('worldbank-intake/' + id(intakeId) + '/chunks', request); }
  intakeRegister(intakeId, { resume = false } = {}) {
    need(typeof resume === 'boolean', 'Choose explicit registration continuation.');
    return this.json('worldbank-intake/' + id(intakeId) + '/register', { resume });
  }
  async intakeWait(intakeId, { timeoutMs = 120000, pollMs = 500 } = {}) {
    need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000 &&
      Number.isSafeInteger(pollMs) && pollMs >= 100 && pollMs <= 10000, 'Select the original registration wait.');
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = await this.intakeStatus(intakeId);
      if (value.status !== 'REGISTERING' || Date.now() >= until) return value;
      await delay(Math.min(pollMs, Math.max(1, until - Date.now())), undefined,
        { signal: AbortSignal.any([this.#controller.signal, this.#signal].filter(Boolean)) });
    }
  }
  intakeDownload(intakeId, descriptor, output) {
    return this.#download('worldbank-intake/' + id(intakeId) + '/original', descriptor, output);
  }
  close() { this.#closing = true; this.#controller.abort(); }
}
export function createWorldBankProgrammeDownload(connect) {
  return createRetainedDownload({ manifestName: WORLDBANK_MANIFEST_NAME, parseManifest: parseWorldBankDelivery,
    maximumBytes: WORLDBANK_FILE_BYTES, stateSchema: 'stellar-forge.worldbank-programme-download.v1',
    resultSchema: 'stellar-forge.worldbank-programme-received.v1', toolPrefix: 'merchant_worldbank_programme',
    errorPrefix: 'WORLDBANK', clientName: 'starforge-worldbank-programme',
    validateExportId(value) { need(typeof value==='string'&&WORLDBANK_SHA.test(value), 'Select the retained original export SHA256.'); return value; },
    describe: manifest => ({ workspace: manifest.workspace, workspaceId: manifest.workspaceId,
      programme: manifest.programme, operationId: manifest.operationId }),
    ...(connect ? { connect } : {}) });
}
/** Full original MCP file receiving, preserving the original downloader checkpoint. */
export async function downloadWorldBankProgramme({ workspace, client, ...options }) {
  need(typeof workspace==='string'&&WORLDBANK_ALIAS.test(workspace), 'Select the declared Analysis workspace alias.');
  const { openMerchantFileClient } = await import('./retained-download.mjs');
  const upstream = client ?? await openMerchantFileClient({ ...options, errorPrefix: 'WORLDBANK', clientName: 'starforge-worldbank-programme' });
  const wrapped = { endpoint: upstream.endpoint + '#worldbank-programme=' + workspace,
    call: (name, args, requestOptions) => upstream.call(name, { ...args, workspace }, requestOptions) };
  const { url, tokenEnv, environment, ...rest } = options;
  let primaryError;
  try{return await createWorldBankProgrammeDownload().download({ ...rest, client: wrapped });}
  catch(error){primaryError=error;throw error;}
  finally{
    if(!client&&upstream.close)try{await upstream.close();}
    catch(error){if(!primaryError)throw error;primaryError.cleanupError=error;}
  }
}
