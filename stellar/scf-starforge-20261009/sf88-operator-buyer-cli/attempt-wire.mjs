// MIT. Private original SF88 HTTP/signing checkpoints; SF31/SF81 retain payment authority.
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  BuyerError, digest, now, privateDirectory, readBytes, parseJson, writeBytes,
  jsonBytes, exists, need,
} from './node/store.mjs';

const SCHEMA = 'stellar-forge.sf88.attempt-wire.v1';
const SOURCE_LIMIT = 2_000_000;
const RECORD_LIMIT = 300_000;
const same = isDeepStrictEqual;
const canonical = value => value === null || typeof value !== 'object' ? value :
  Array.isArray(value) ? value.map(canonical) :
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
const valueHash = value => digest(Buffer.from(JSON.stringify(canonical(value))));
const code = (error, fallback) => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : fallback;
const wirePath = cfg => join(cfg.evidenceDir, 'wire-' + digest(Buffer.from(cfg.operation.intentId)));
const EVENTS = [
  'unsigned-request', 'unsigned-dispatch', 'unsigned-response', 'unsigned-error',
  'signing-input', 'signing-result', 'signing-error',
  'signed-request', 'signed-dispatch', 'signed-response', 'signed-error',
];

// Same private descriptor/flock ownership used by the original Node workspace.
// Readers take this lock without creating it, so an active writer cannot be
// mistaken for a stopped attempt between two checkpoint publications.
async function ownership(directory, create) {
  const path=join(directory,'active.lock');
  const handle=await open(path,constants.O_RDWR | (create ? constants.O_CREAT : 0) |
    (constants.O_NOFOLLOW ?? 0),0o600);
  try {
    const file=await handle.stat(),named=await lstat(path);
    need(file.isFile() && file.nlink===1 && !(file.mode&0o077) &&
      file.dev===named.dev && file.ino===named.ino && !named.isSymbolicLink() &&
      (!process.getuid || file.uid===process.getuid()),'WIRE_LOCK_CHANGED');
    const result=spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73','3'],
      {stdio:['ignore','pipe','pipe',handle.fd],timeout:10000});
    if (!result.error && result.status===73) {await handle.close();return null;}
    need(!result.error && result.status===0,'WIRE_FLOCK_REQUIRED');
    return handle;
  } catch(error) {await handle.close();throw error;}
}

async function originalFile(path, limit) {
  const info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink() &&
    (process.platform === 'win32' || ((info.mode & 0o077) === 0 &&
      (!process.getuid || info.uid === process.getuid()))), 'WIRE_PRIVATE_FILE_REQUIRED');
  const raw = await readBytes(path, limit);
  return { raw, value: parseJson(raw), sha256: digest(raw), bytes: raw.length };
}

function requestBody(value) {
  if (value === undefined || value === null) return {present:false, bytes:Buffer.alloc(0)};
  need(typeof value === 'string' || value instanceof Uint8Array, 'WIRE_REPLAYABLE_BODY_REQUIRED');
  const bytes = Buffer.from(value);
  need(bytes.length <= 1_048_576, 'WIRE_BODY_TOO_LARGE');
  return {present:true, bytes};
}
function bindingFor(cfg, body) {
  const operation = cfg.operation;
  need(operation && typeof operation.intentId === 'string' &&
    /^[A-Za-z0-9._:-]{1,160}$/.test(operation.intentId), 'WIRE_OPERATION_REQUIRED');
  return {
    intentId:operation.intentId, url:new URL(operation.url).href, method:operation.method ?? 'GET',
    configValueSha256:valueHash(cfg),
    bodyPresent:body.present, bodyBytes:body.bytes.length, bodySha256:digest(body.bytes),
  };
}
function headerEntries(headers) {
  const result = [...new Headers(headers).entries()];
  need(Buffer.byteLength(JSON.stringify(result)) <= 262_144, 'WIRE_HEADERS_TOO_LARGE');
  return result;
}
function stateOf(events) {
  if (events['signed-response']) return 'SIGNED_RESPONSE_HEADERS_RETAINED';
  if (events['signed-error']) return 'SIGNED_TRANSPORT_ERROR_RETAINED';
  if (events['signed-dispatch']) return 'SIGNED_DISPATCH_OUTCOME_UNRESOLVED';
  if (events['signed-request']) return 'SIGNED_REQUEST_NOT_DISPATCHED';
  if (events['signing-result']) return 'SIGNER_RESULT_RETAINED_NOT_DISPATCHED';
  if (events['signing-error']) return 'SIGNING_ERROR_RETAINED';
  if (events['signing-input']) return 'SIGNING_STARTED_NOT_DISPATCHED';
  if (events['unsigned-response']) return 'UNSIGNED_RESPONSE_HEADERS_RETAINED';
  if (events['unsigned-error']) return 'UNSIGNED_TRANSPORT_ERROR_RETAINED';
  if (events['unsigned-dispatch']) return 'UNSIGNED_DISPATCH_OUTCOME_UNRESOLVED';
  if (events['unsigned-request']) return 'UNSIGNED_REQUEST_NOT_DISPATCHED';
  return 'SOURCE_RETAINED';
}
function view(directory, source, events, writerActive = false) {
  return {
    schema:SCHEMA, intentId:source.value.binding.intentId, directory, writerActive,
    sourceSha256:source.sha256, configValueSha256:source.value.binding.configValueSha256,
    state:stateOf(events), signingEntered:!!events['signing-input'],
    signedDispatchRecorded:!!events['signed-dispatch'],
    signedResponseRecorded:!!events['signed-response'],
    records:Object.fromEntries(Object.entries(events).map(([name, item]) =>
      [name, {path:join(directory, name + '.json'),sha256:item.sha256,bytes:item.bytes,
        recordedAt:item.value.recordedAt}])),
    response:events['signed-response'] ? {
      status:events['signed-response'].value.status,
      headersSha256:valueHash(events['signed-response'].value.headers),
    } : null,
  };
}

/** Called once by original execute before the buyer/approval/signer can run.
 * All wire payloads remain in the caller's existing private evidence directory.
 * No socket, signer, approval or ledger capability is provided by this module. */
export async function createAttemptWireRecorder({cfg, body, fetchImpl}) {
  need(typeof fetchImpl === 'function', 'WIRE_ORIGINAL_TRANSPORT_REQUIRED');
  const frozen = JSON.parse(JSON.stringify(cfg));
  const originalBody = requestBody(body);
  const binding = bindingFor(frozen, originalBody);
  await privateDirectory(frozen.evidenceDir, {create:false});
  const directory = await privateDirectory(wirePath(frozen));
  const sourceValue = {
    schema:SCHEMA, binding, recordedAt:now(), config:frozen,
    requestBodyBase64:originalBody.present ? originalBody.bytes.toString('base64') : null,
  };
  const sourceRaw = jsonBytes(sourceValue);
  need(sourceRaw.length <= SOURCE_LIMIT, 'WIRE_SOURCE_TOO_LARGE');
  const held = await ownership(directory,true);
  need(held,'WIRE_ATTEMPT_ACTIVE');
  try { await writeBytes(join(directory, 'source.json'), sourceRaw, {exclusive:true}); }
  catch (error) {
    await held.close();
    if (error.code === 'EEXIST') throw new BuyerError('WIRE_ATTEMPT_ALREADY_RECORDED_USE_RECOVERY');
    throw error;
  }
  const source = {raw:sourceRaw, value:sourceValue, sha256:digest(sourceRaw),bytes:sourceRaw.length};
  const events = Object.create(null);
  let closed=false;
  async function publish(name, fields) {
    need(!closed && EVENTS.includes(name) && !events[name], 'WIRE_PHASE_ALREADY_RECORDED');
    const raw = jsonBytes({schema:SCHEMA, intentId:binding.intentId, sourceSha256:source.sha256,
      phase:name, recordedAt:now(), ...fields});
    const value = parseJson(raw);
    need(raw.length <= RECORD_LIMIT, 'WIRE_RECORD_TOO_LARGE');
    await writeBytes(join(directory, name + '.json'), raw, {exclusive:true});
    events[name] = {raw,value,sha256:digest(raw),bytes:raw.length};
    return events[name];
  }
  async function signingInput(input) {
    need(input?.intent?.intentId === binding.intentId && input.intent.url === binding.url &&
      input.intent.method === binding.method && input.intent.bodyPresent === binding.bodyPresent &&
      input.intent.bodyBytes === binding.bodyBytes && input.intent.bodySha256 === binding.bodySha256,
      'WIRE_SIGNING_REQUEST_MISMATCH');
    need(events['unsigned-response']?.value.status === 402 && !events['signing-input'],
      'WIRE_SIGNING_PHASE_MISMATCH');
    await publish('signing-input', {input, inputSha256:digest(Buffer.from(JSON.stringify(input.intent)))});
  }
  async function signingResult(result) {
    need(events['signing-input'] && !events['signing-result'] && !events['signing-error'],
      'WIRE_SIGNING_PHASE_MISMATCH');
    await publish('signing-result', {inputSha256:events['signing-input'].sha256,
      payload:result, payloadSha256:digest(Buffer.from(JSON.stringify(result)))});
  }
  async function signingError(error) {
    if (!events['signing-input'] || events['signing-result'] || events['signing-error']) return;
    await publish('signing-error', {inputSha256:events['signing-input'].sha256,
      code:code(error, 'ORIGINAL_SIGNER_ERROR')});
  }
  async function fetch(url, options = {}) {
    const href = new URL(url).href, method = options.method ?? 'GET';
    const currentBody = requestBody(options.body);
    need(href === binding.url && method === binding.method &&
      currentBody.present === binding.bodyPresent && currentBody.bytes.equals(originalBody.bytes),
      'WIRE_REQUEST_BINDING_MISMATCH');
    const headers = headerEntries(options.headers);
    const signature = headers.find(([name]) => name === 'payment-signature')?.[1];
    const leg = signature === undefined ? 'unsigned' : 'signed';
    need(!events[leg + '-request'], 'WIRE_PHASE_ALREADY_RECORDED');
    if (leg === 'signed') {
      const result = events['signing-result'];
      need(result && Buffer.from(JSON.stringify(result.value.payload)).toString('base64') === signature,
        'WIRE_SIGNED_PAYLOAD_MISMATCH');
      const unsigned = events['unsigned-request']?.value;
      need(unsigned && same(headers.filter(([name]) => name !== 'payment-signature'), unsigned.headers),
        'WIRE_REQUEST_HEADERS_CHANGED');
    } else need(!events['signing-input'], 'WIRE_PHASE_ORDER_INVALID');
    const requested = await publish(leg + '-request', {
      url:href, method, headers, bodyPresent:binding.bodyPresent,
      bodyBytes:binding.bodyBytes, bodySha256:binding.bodySha256,
      ...(leg === 'signed' ? {signingResultSha256:events['signing-result'].sha256} : {}),
    });
    // This immutable marker is durable before the original transport may open a
    // socket. Its presence is an attempted dispatch, never proof of delivery.
    await publish(leg + '-dispatch', {requestSha256:requested.sha256});
    let response;
    try { response = await fetchImpl(url, options); }
    catch (error) {
      try { await publish(leg + '-error', {requestSha256:requested.sha256,
        code:code(error, 'ORIGINAL_TRANSPORT_ERROR')}); } catch {}
      throw error;
    }
    try {
      await publish(leg + '-response', {
        requestSha256:requested.sha256, status:response.status,
        statusText:response.statusText, url:response.url || href,
        headers:headerEntries(response.headers),
      });
    } catch (error) {
      // The original request may have been paid. SF31 preserves its signed-leg
      // uncertainty on this error; a failed checkpoint never authorizes retry.
      try { await response.body?.cancel(); } catch {}
      throw error;
    }
    return response;
  }
  return Object.freeze({fetch,signingInput,signingResult,signingError,
    async close(){if(!closed){await held.close();closed=true;}},
    snapshot:() => view(directory,source,events,!closed)});
}

/** Read-only source validation. includeWire is for the original private recovery
 * consumer: it exposes signed authorization bytes and must never be logged,
 * exported to a public artifact, or sent to a different merchant. */
export async function readAttemptWireCheckpoint({cfg, body, includeWire = false}) {
  need(typeof includeWire === 'boolean', 'WIRE_INCLUDE_OPTION_INVALID');
  const directory = wirePath(cfg);
  if (!await exists(directory)) return null;
  await privateDirectory(cfg.evidenceDir, {create:false});
  await privateDirectory(directory, {create:false});
  const held=await ownership(directory,false);
  if(!held) return {schema:SCHEMA,intentId:cfg.operation.intentId,directory,
    state:'WRITER_ACTIVE',writerActive:true};
  try {
  const source = await originalFile(join(directory,'source.json'),SOURCE_LIMIT);
  const binding = bindingFor(cfg,requestBody(body));
  need(source.value.schema === SCHEMA && same(source.value.binding,binding) &&
    valueHash(source.value.config) === binding.configValueSha256, 'WIRE_SOURCE_BINDING_MISMATCH');
  const retainedBody = source.value.requestBodyBase64;
  need(retainedBody === null ? !binding.bodyPresent :
    typeof retainedBody === 'string' && binding.bodyPresent &&
      Buffer.from(retainedBody,'base64').length === binding.bodyBytes &&
      digest(Buffer.from(retainedBody,'base64')) === binding.bodySha256, 'WIRE_BODY_BINDING_MISMATCH');
  const events = Object.create(null);
  for (const name of EVENTS) {
    const path = join(directory,name+'.json');
    if (!await exists(path)) continue;
    const event = await originalFile(path,RECORD_LIMIT), value = event.value;
    need(value.schema === SCHEMA && value.intentId === binding.intentId &&
      value.sourceSha256 === source.sha256 && value.phase === name &&
      Number.isFinite(Date.parse(value.recordedAt)), 'WIRE_RECORD_BINDING_MISMATCH');
    events[name] = event;
  }
  for (const leg of ['unsigned','signed']) {
    const request = events[leg+'-request'];
    for (const suffix of ['dispatch','response','error']) {
      const event = events[leg+'-'+suffix];
      need(!event || request && event.value.requestSha256 === request.sha256,
        'WIRE_REQUEST_RECORD_MISMATCH');
      if (suffix !== 'dispatch') need(!event || events[leg+'-dispatch'], 'WIRE_DISPATCH_RECORD_MISSING');
    }
    need(!(events[leg+'-response'] && events[leg+'-error']), 'WIRE_CONTRADICTORY_RESPONSE');
    if (request) need(request.value.url === binding.url && request.value.method === binding.method &&
      request.value.bodyPresent === binding.bodyPresent && request.value.bodyBytes === binding.bodyBytes &&
      request.value.bodySha256 === binding.bodySha256, 'WIRE_REQUEST_BINDING_MISMATCH');
  }
  const input=events['signing-input'],signed=events['signing-result'],signedRequest=events['signed-request'];
  if (input) need(events['unsigned-response']?.value.status === 402 &&
    input.value.input?.intent?.intentId === binding.intentId &&
    input.value.input.intent.url === binding.url && input.value.input.intent.method === binding.method &&
    input.value.input.intent.bodyPresent === binding.bodyPresent &&
    input.value.input.intent.bodyBytes === binding.bodyBytes &&
    input.value.input.intent.bodySha256 === binding.bodySha256 &&
    digest(Buffer.from(JSON.stringify(input.value.input.intent))) === input.value.inputSha256,
    'WIRE_SIGNING_RECORD_MISMATCH');
  if (signed) need(input && signed.value.inputSha256 === input.sha256 &&
    digest(Buffer.from(JSON.stringify(signed.value.payload))) === signed.value.payloadSha256,
    'WIRE_SIGNATURE_RECORD_MISMATCH');
  if (events['signing-error']) need(input && !signed &&
    events['signing-error'].value.inputSha256 === input.sha256, 'WIRE_SIGNING_RECORD_MISMATCH');
  if (signedRequest) need(signed && signedRequest.value.signingResultSha256 === signed.sha256 &&
    signedRequest.value.headers.find(([name]) => name === 'payment-signature')?.[1] ===
      Buffer.from(JSON.stringify(signed.value.payload)).toString('base64') &&
    same(signedRequest.value.headers.filter(([name]) => name !== 'payment-signature'),
      events['unsigned-request']?.value.headers), 'WIRE_SIGNED_PAYLOAD_MISMATCH');
  const snapshot=view(directory,source,events);
  if(!includeWire) return snapshot;
  // Private capabilities remain directly accessible to the original recovery
  // consumer, while normal JSON/console projections expose only the snapshot.
  return Object.defineProperties({snapshot},{
    source:{value:source.value},
    events:{value:Object.fromEntries(Object.entries(events).map(([name,item]) => [name,item.value]))},
  });
  } finally {await held.close();}
}
