// MIT. Follow an already accepted paid job through the original SF31 transport.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, link, unlink, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';
import { absolute, privateDirectory, readBytes, readJson, writeBytes, writeJson,
  jsonBytes, digest, syncDirectory, exists } from '../../sf88-operator-buyer-cli/node/store.mjs';

const BUYER_SCHEMA = 'stellar-forge.job-buyer.v1';
const DELIVERY_SCHEMA = 'stellar-forge.job-buyer-delivery.v1';
const HASH = /^[a-f0-9]{64}$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const STATES = new Set(['PREPARED', 'AWAITING_SETTLEMENT', 'QUEUED', 'RUNNING',
  'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED', 'CANCELLING']);
const TERMINAL = new Set(['FAILED', 'INTERRUPTED', 'CANCELLED']);
const MAX_OUTPUT = 67108864;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = () => new Date().toISOString();

export class JobBuyerError extends Error {
  constructor(code, details = {}) {
    super(code); this.name = 'JobBuyerError'; this.code = code;
    Object.defineProperty(this, 'details', { value: Object.freeze({ ...details }) });
  }
  toJSON() { return { error: this.code, ...this.details }; }
}
const fail = (code, details) => { throw new JobBuyerError(code, details); };
const need = (condition, code) => { if (!condition) fail(code); };
const safeCode = error => /^[A-Z][A-Z0-9_]{0,119}$/.test(error?.code ?? '') ? error.code : 'JOB_BUYER_FAILED';
function token(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(value), 'JOB_CLAIM_TOKEN_REQUIRED');
  return value;
}
function sameToken(a, b) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function json(raw) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { fail('JOB_BUYER_JSON_INVALID'); }
}
function acceptance(value) {
  need(plain(value) && value.schema === 'stellar-forge.job-accepted.v1' &&
    typeof value.jobId === 'string' && JOB_ID.test(value.jobId) &&
    typeof value.functionId === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,55}$/.test(value.functionId) &&
    HASH.test(value.inputSha256) && value.state === 'AWAITING_SETTLEMENT', 'JOB_ACCEPTANCE_INVALID');
  let url;
  try { url = new URL(value.statusUrl); } catch { fail('JOB_ACCEPTANCE_URL_INVALID'); }
  const expectedPath = '/jobs/' + encodeURIComponent(value.jobId);
  need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === expectedPath && value.statusUrl === url.origin + expectedPath &&
    value.resultUrl === value.statusUrl + '/result', 'JOB_ACCEPTANCE_URL_INVALID');
  return Object.freeze({ schema: value.schema, jobId: value.jobId, functionId: value.functionId,
    inputSha256: value.inputSha256, state: value.state, statusUrl: value.statusUrl, resultUrl: value.resultUrl });
}
function status(value, accepted) {
  need(plain(value) && value.schema === 'stellar-forge.job-status.v1' && value.jobId === accepted.jobId &&
    value.functionId === accepted.functionId && value.inputSha256 === accepted.inputSha256 &&
    STATES.has(value.state) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    typeof value.label === 'string' && value.label.length <= 512 &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)), 'JOB_STATUS_INVALID');
  const settlement = value.nativeSettlement;
  need(settlement === null || plain(settlement) && HASH.test(settlement.id) &&
    typeof settlement.at === 'string' && Number.isFinite(Date.parse(settlement.at)), 'JOB_STATUS_SETTLEMENT_INVALID');
  need(value.error === null || plain(value.error) && /^[A-Z][A-Z0-9_]{0,119}$/.test(value.error.code),
    'JOB_STATUS_ERROR_INVALID');
  if (value.state === 'COMPLETED') {
    const result = value.result;
    need(settlement !== null && plain(result) && Number.isSafeInteger(result.bytes) &&
      result.bytes >= 0 && result.bytes <= MAX_OUTPUT && HASH.test(result.sha256) &&
      typeof result.contentType === 'string' && result.contentType.length <= 160 &&
      /^[\x20-\x7e]+$/.test(result.contentType) && typeof result.filename === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(result.filename) && result.url === accepted.resultUrl,
      'JOB_RESULT_METADATA_INVALID');
  } else need(value.result === null, 'JOB_RESULT_STATE_INVALID');
  return { schema: value.schema, jobId: value.jobId, functionId: value.functionId, label: value.label,
    state: value.state, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
    inputSha256: value.inputSha256, nativeSettlement: settlement ? { id: settlement.id, at: settlement.at } : null,
    result: value.result ? { bytes: value.result.bytes, sha256: value.result.sha256,
      contentType: value.result.contentType, filename: value.result.filename, url: value.result.url } : null,
    error: value.error ? { code: value.error.code } : null };
}
async function scoped({ signal, deadlineMs = 30000 } = {}, action) {
  need(Number.isSafeInteger(deadlineMs) && deadlineMs >= 1 && deadlineMs <= 86400000,
    'JOB_BUYER_DEADLINE_INVALID');
  need(signal === undefined || signal !== null && typeof signal.addEventListener === 'function' &&
    typeof signal.removeEventListener === 'function', 'JOB_BUYER_SIGNAL_INVALID');
  if (signal?.aborted) fail('JOB_BUYER_ABORTED');
  const controller = new AbortController();
  let expired = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { expired = true; controller.abort(); }, deadlineMs);
  const check = () => { if (controller.signal.aborted) fail(expired ? 'JOB_BUYER_DEADLINE_EXCEEDED' : 'JOB_BUYER_ABORTED'); };
  try { check(); return await action(controller.signal, check); }
  catch (error) { check(); throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
async function pause(ms, signal) {
  await new Promise((resolveWait, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new JobBuyerError('JOB_BUYER_ABORTED')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolveWait(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
async function consume(response, signal, check, accept) {
  if (response.body === null) { check(); return; }
  need(response.body?.getReader, 'JOB_RESPONSE_BODY_REQUIRED');
  const reader = response.body.getReader();
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    for (;;) {
      const { value, done } = await reader.read();
      check();
      if (done) break;
      need(value instanceof Uint8Array, 'JOB_RESPONSE_BYTES_REQUIRED');
      await accept(value);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function responseJson(response, signal, check) {
  let bytes = 0; const chunks = [];
  await consume(response, signal, check, chunk => {
    bytes += chunk.length;
    need(bytes <= 65536, 'JOB_STATUS_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  });
  return json(Buffer.concat(chunks));
}
async function immutable(path, bytes) {
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await readBytes(path, Math.max(bytes.length, 65536))).equals(bytes), 'JOB_BUYER_STATE_CONFLICT');
  }
}
async function optionalJson(path, limit = 1048576) {
  return await exists(path) ? readJson(path, limit) : null;
}
async function verifiedFile(path, expected, check) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    need(before.isFile() && before.size === expected.bytes, 'JOB_RESULT_FILE_MISMATCH');
    const hash = createHash('sha256'), chunk = Buffer.alloc(65536);
    let bytes = 0;
    for (;;) {
      check();
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      bytes += bytesRead; need(bytes <= expected.bytes, 'JOB_RESULT_FILE_MISMATCH');
      hash.update(chunk.subarray(0, bytesRead));
    }
    const after = await file.stat(); check();
    need(bytes === expected.bytes && hash.digest('hex') === expected.sha256 &&
      after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
      'JOB_RESULT_FILE_MISMATCH');
  } finally { await file.close(); }
}

/** Retain one original saved HTTP 202 acceptance and its private claim capability. */
export async function createJobBuyer({ directory, result, acceptanceFile, claimToken, handoff,
  transport, fetchImpl, requestTimeoutMs, signal } = {}) {
  directory = absolute(directory);
  if (signal?.aborted) fail('JOB_BUYER_ABORTED');
  if (handoff !== undefined) {
    need(claimToken === undefined && plain(handoff) && handoff.schema === 'stellar-forge.job-handoff.v1',
      'JOB_HANDOFF_INVALID');
    claimToken = handoff.claimToken;
  }
  token(claimToken);
  need((result !== undefined) !== (acceptanceFile !== undefined), 'JOB_ACCEPTANCE_SOURCE_REQUIRED');
  let bytes, source;
  if (result !== undefined) {
    need(typeof result?.bytes === 'function' && plain(result.record) &&
      result.native?.httpStatus === 202 && result.native?.status === 'DELIVERED_REPORTED_SETTLED',
      'JOB_ORIGINAL_PAID_ACCEPTANCE_REQUIRED');
    bytes = Buffer.from(await result.bytes({ limit: 65536, signal }));
    source = { kind: 'SF88_NATIVE_RESULT', nativeRecord: result.record };
  } else {
    acceptanceFile = absolute(acceptanceFile);
    bytes = await readBytes(acceptanceFile, 65536);
    source = { kind: 'SAVED_ACCEPTANCE_FILE', path: acceptanceFile };
  }
  const accepted = acceptance(json(bytes)), acceptedSha256 = digest(bytes);
  if (handoff !== undefined) need(JSON.stringify(acceptance(handoff.acceptance)) === JSON.stringify(accepted),
    'JOB_HANDOFF_ACCEPTANCE_MISMATCH');
  await privateDirectory(directory);
  const current = await optionalJson(join(directory, 'buyer.json'));
  if (current) {
    need(current.acceptanceSha256 === acceptedSha256 && typeof current.claimToken === 'string' &&
      sameToken(current.claimToken, claimToken), 'JOB_BUYER_STATE_CONFLICT');
    return openJobBuyer({ directory, transport, fetchImpl, requestTimeoutMs });
  }
  await immutable(join(directory, 'acceptance.json'), bytes);
  const purchasePath = join(directory, 'purchase.json');
  const purchase = { schema: 'stellar-forge.job-purchase.v1', retainedAt: iso(),
    jobId: accepted.jobId, acceptanceSha256: acceptedSha256, source };
  need(jsonBytes(purchase).length <= 1048576, 'JOB_PURCHASE_RECORD_TOO_LARGE');
  try { await writeJson(purchasePath, purchase, { exclusive: true }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const retainedBytes = await readBytes(purchasePath, 1048576), retained = json(retainedBytes);
  need(retained.schema === purchase.schema && retained.acceptanceSha256 === acceptedSha256 &&
    retained.jobId === accepted.jobId, 'JOB_BUYER_STATE_CONFLICT');
  const state = { schema: BUYER_SCHEMA, acceptanceSha256: acceptedSha256, purchaseSha256: digest(retainedBytes),
    claimToken, retainedAt: retained.retainedAt };
  try { await writeJson(join(directory, 'buyer.json'), state, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const other = await readJson(join(directory, 'buyer.json'));
    need(other.acceptanceSha256 === acceptedSha256 && other.purchaseSha256 === state.purchaseSha256 &&
      typeof other.claimToken === 'string' && sameToken(other.claimToken, claimToken), 'JOB_BUYER_STATE_CONFLICT');
  }
  return openJobBuyer({ directory, transport, fetchImpl, requestTimeoutMs });
}

/** Reopen without importing a signer, executing a paid request, or changing purchase intent. */
export async function openJobBuyer({ directory, transport, fetchImpl, requestTimeoutMs = 60000 } = {}) {
  directory = absolute(directory);
  await privateDirectory(directory, { create: false });
  const state = await readJson(join(directory, 'buyer.json'));
  need(state.schema === BUYER_SCHEMA && HASH.test(state.acceptanceSha256) && HASH.test(state.purchaseSha256),
    'JOB_BUYER_STATE_INVALID'); token(state.claimToken);
  const bytes = await readBytes(join(directory, 'acceptance.json'), 65536);
  const purchaseBytes = await readBytes(join(directory, 'purchase.json'), 1048576);
  need(digest(bytes) === state.acceptanceSha256 && digest(purchaseBytes) === state.purchaseSha256,
    'JOB_BUYER_STATE_CHANGED');
  const accepted = acceptance(json(bytes)), purchase = json(purchaseBytes);
  need(purchase.jobId === accepted.jobId && purchase.acceptanceSha256 === state.acceptanceSha256,
    'JOB_BUYER_STATE_INVALID');
  need(fetchImpl === undefined || typeof fetchImpl === 'function', 'JOB_BUYER_FETCH_INVALID');
  const fetch = fetchImpl ?? createPublicHttpsFetch({ timeoutMs: requestTimeoutMs, trustedProxy: transport ?? null });
  return new JobBuyer(directory, state, accepted, purchase, fetch);
}

class JobBuyer {
  #state; #purchase; #fetch; #writes = Promise.resolve();
  constructor(directory, state, accepted, purchase, fetch) {
    Object.defineProperties(this, { directory: { value: directory, enumerable: true },
      jobId: { value: accepted.jobId, enumerable: true }, acceptance: { value: accepted, enumerable: true } });
    this.#state = state; this.#purchase = purchase; this.#fetch = fetch;
  }
  async #request(url, signal, check) {
    check();
    const response = await this.#fetch(url, { method: 'GET', headers: {
      'x-sfjobs-token': this.#state.claimToken, accept: url === this.acceptance.statusUrl ? 'application/json' : '*/*',
    }, redirect: 'manual', signal });
    check();
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 402) fail('JOB_FOLLOW_UP_PAYMENT_REQUESTED');
      if (response.status >= 300 && response.status <= 399) fail('JOB_BUYER_REDIRECT_REFUSED');
      fail('JOB_FOLLOW_UP_HTTP_ERROR', { httpStatus: response.status });
    }
    try {
      need(!response.url || response.url === url, 'JOB_FOLLOW_UP_URL_CHANGED');
      const encoding = response.headers.get('content-encoding');
      need(!encoding || encoding.toLowerCase() === 'identity', 'JOB_RESULT_ENCODING_UNSUPPORTED');
    } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    return response;
  }
  async #inspect(signal, check) {
    const response = await this.#request(this.acceptance.statusUrl, signal, check);
    const current = status(await responseJson(response, signal, check), this.acceptance);
    const write = async () => {
      const previous = await optionalJson(join(this.directory, 'status.json'));
      if (previous) {
        const old = status(previous.status, this.acceptance);
        need(current.revision >= old.revision, 'JOB_STATUS_REVISION_REGRESSED');
        if (old.state === 'COMPLETED') need(current.state === 'COMPLETED' &&
          current.result.sha256 === old.result.sha256 && current.result.bytes === old.result.bytes,
          'JOB_COMPLETED_RESULT_CHANGED');
      }
      await writeJson(join(this.directory, 'status.json'), { schema: 'stellar-forge.job-buyer-status.v1', observedAt: iso(), status: current });
    };
    const pending = this.#writes.then(write);
    this.#writes = pending.catch(() => {});
    await pending; return current;
  }
  inspect(options = {}) { return scoped(options, (signal, check) => this.#inspect(signal, check)); }
  wait({ signal, deadlineMs = 300000, pollMs = 1000 } = {}) {
    need(Number.isSafeInteger(pollMs) && pollMs >= 100 && pollMs <= 30000, 'JOB_BUYER_POLL_INVALID');
    return scoped({ signal, deadlineMs }, async (active, check) => {
      for (;;) {
        const current = await this.#inspect(active, check);
        if (current.state === 'COMPLETED') return current;
        if (TERMINAL.has(current.state)) fail('JOB_APPLICATION_' + current.state,
          { jobId: this.jobId, state: current.state, applicationCode: current.error?.code ?? null });
        await pause(pollMs, active);
      }
    });
  }
  download({ destination, signal, deadlineMs = 300000 } = {}) {
    destination = absolute(destination);
    return scoped({ signal, deadlineMs }, async (active, check) => {
      const retained = await optionalJson(join(this.directory, 'status.json'));
      if (retained?.status?.state === 'COMPLETED' && await exists(destination)) {
        const completed = status(retained.status, this.acceptance);
        try { await verifiedFile(destination, completed.result, check); }
        catch { check(); fail('JOB_DESTINATION_EXISTS'); }
        return this.#recordDelivery(completed, destination, true);
      }
      const current = await this.#inspect(active, check);
      if (current.state !== 'COMPLETED') fail(TERMINAL.has(current.state) ? 'JOB_APPLICATION_' + current.state :
        'JOB_RESULT_NOT_READY', { jobId: this.jobId, state: current.state });
      const expected = current.result;
      const parent = await lstat(dirname(destination));
      need(parent.isDirectory() && !parent.isSymbolicLink(), 'JOB_DESTINATION_DIRECTORY_REQUIRED');
      let reused = false;
      if (await exists(destination)) {
        try { await verifiedFile(destination, expected, check); reused = true; }
        catch (error) { check(); fail('JOB_DESTINATION_EXISTS'); }
      }
      if (!reused) {
        const temporary = join(dirname(destination), '.job-result-' + randomUUID());
        let file, response;
        try {
          response = await this.#request(this.acceptance.resultUrl, active, check);
          need(response.headers.get('x-content-sha256') === expected.sha256 &&
            response.headers.get('etag') === '"' + expected.sha256 + '"', 'JOB_RESULT_HEADERS_MISMATCH');
          const length = response.headers.get('content-length');
          need(length === null || /^(0|[1-9][0-9]*)$/.test(length) && Number(length) === expected.bytes,
            'JOB_RESULT_LENGTH_MISMATCH');
          need(response.headers.get('content-type') === expected.contentType, 'JOB_RESULT_CONTENT_TYPE_MISMATCH');
          file = await open(temporary, 'wx', 0o600);
          const hash = createHash('sha256'); let bytes = 0;
          await consume(response, active, check, async chunk => {
            bytes += chunk.length; need(bytes <= expected.bytes, 'JOB_RESULT_LENGTH_MISMATCH');
            hash.update(chunk);
            let offset = 0;
            while (offset < chunk.length) {
              check();
              const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset, null);
              need(bytesWritten > 0, 'JOB_RESULT_WRITE_FAILED'); offset += bytesWritten;
            }
          });
          need(bytes === expected.bytes && hash.digest('hex') === expected.sha256, 'JOB_RESULT_DIGEST_MISMATCH');
          await file.sync(); await file.close(); file = null; check();
          try { await link(temporary, destination); }
          catch (error) {
            if (error.code !== 'EEXIST') throw error;
            try { await verifiedFile(destination, expected, check); reused = true; }
            catch { check(); fail('JOB_DESTINATION_EXISTS'); }
          }
          await unlink(temporary);
          await syncDirectory(dirname(destination));
        } finally {
          await file?.close().catch(() => {});
          if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      }
      return this.#recordDelivery(current, destination, reused);
    });
  }
  async #recordDelivery(current, destination, reused) {
    const expected = current.result;
    const delivery = { schema: DELIVERY_SCHEMA, jobId: this.jobId, functionId: this.acceptance.functionId,
      inputSha256: this.acceptance.inputSha256, acceptanceSha256: this.#state.acceptanceSha256,
      completedRevision: current.revision, nativeSettlement: current.nativeSettlement,
      deliveredAt: iso(), path: destination, bytes: expected.bytes, sha256: expected.sha256,
      contentType: expected.contentType, filename: expected.filename, sourceUrl: this.acceptance.resultUrl };
    try { await writeJson(join(this.directory, 'delivery.json'), delivery); }
    catch { fail('JOB_DELIVERY_RECORD_WRITE_FAILED', { destinationPublished: true, destination }); }
    return { ...delivery, reused };
  }
  async receipt() {
    const observed = await optionalJson(join(this.directory, 'status.json'));
    if (observed) status(observed.status, this.acceptance);
    const delivery = await optionalJson(join(this.directory, 'delivery.json'));
    if (delivery) need(delivery.schema === DELIVERY_SCHEMA && delivery.jobId === this.jobId &&
      delivery.acceptanceSha256 === this.#state.acceptanceSha256 && HASH.test(delivery.sha256) &&
      Number.isSafeInteger(delivery.bytes) && delivery.bytes >= 0 && delivery.bytes <= MAX_OUTPUT,
      'JOB_DELIVERY_RECORD_INVALID');
    const native = this.#purchase.source?.nativeRecord?.native;
    return { schema: 'stellar-forge.job-buyer-receipt.v1', jobId: this.jobId, retainedAt: this.#state.retainedAt,
      acceptanceSha256: this.#state.acceptanceSha256, acceptance: this.acceptance,
      purchase: { kind: this.#purchase.source?.kind, ...(native ? { httpStatus: native.httpStatus, status: native.status } : {}) },
      latestStatus: observed?.status ?? null, delivery };
  }
}

/** CLI bridge; callers receive printable metadata with the capability omitted. */
export async function runJobBuyerCommand(argv) {
  const [command, ...rest] = argv, args = Object.create(null);
  need(['retain', 'inspect', 'wait', 'fetch'].includes(command), 'JOB_BUYER_COMMAND_REQUIRED');
  const allowed = new Set(['--state', '--acceptance-file', '--claim-token-file', '--handoff-file', '--transport-file', '--out', '--deadline-ms', '--poll-ms']);
  for (let i = 0; i < rest.length; i += 2) {
    need(allowed.has(rest[i]) && typeof rest[i + 1] === 'string' && !rest[i + 1].startsWith('--') &&
      !(rest[i] in args), 'JOB_BUYER_ARGUMENT_INVALID'); args[rest[i]] = rest[i + 1];
  }
  const directory = absolute(args['--state']);
  const transport = args['--transport-file'] ? await readJson(absolute(args['--transport-file'])) : undefined;
  if (command === 'retain') {
    need(args['--acceptance-file'] && (!!args['--claim-token-file'] !== !!args['--handoff-file']) &&
      !args['--out'] && !args['--poll-ms'] && !args['--deadline-ms'], 'JOB_BUYER_ARGUMENT_INVALID');
    let claimToken, handoff;
    if (args['--handoff-file']) handoff = await readJson(absolute(args['--handoff-file']), 1048576);
    else {
      const raw = await readBytes(absolute(args['--claim-token-file']), 1024);
      claimToken = new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/\r?\n$/, '');
    }
    const buyer = await createJobBuyer({ directory, acceptanceFile: absolute(args['--acceptance-file']), claimToken, handoff, transport });
    return buyer.receipt();
  }
  need(!args['--acceptance-file'] && !args['--claim-token-file'] && !args['--handoff-file'] &&
    (command === 'fetch' || !args['--out']) && (command === 'wait' || !args['--poll-ms']), 'JOB_BUYER_ARGUMENT_INVALID');
  const options = {};
  for (const [flag, key] of [['--deadline-ms', 'deadlineMs'], ['--poll-ms', 'pollMs']]) {
    if (args[flag] !== undefined) {
      need(/^[1-9][0-9]*$/.test(args[flag]), 'JOB_BUYER_ARGUMENT_INVALID'); options[key] = Number(args[flag]);
    }
  }
  const buyer = await openJobBuyer({ directory, transport });
  if (command === 'fetch') return buyer.download({ destination: absolute(args['--out']), ...options });
  return buyer[command](options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(await runJobBuyerCommand(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write(JSON.stringify(error instanceof JobBuyerError ? error.toJSON() : { error: safeCode(error) }) + '\n'); process.exitCode = 1; }
}
