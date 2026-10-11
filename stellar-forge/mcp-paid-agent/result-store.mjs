/** MIT. Complete native MCP results, bound to the original SF32 quote. */
import {constants, lstatSync, mkdirSync, realpathSync} from 'node:fs';
import {lstat, open} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {prepareBuyerResponseFile} from '../../stellar/scf-starforge-20261009/sf31-buyer-client/response-file.mjs';
import {VerifiedFile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/result.mjs';
import {mcpJson, mcpResultContent, validateMcpInvocation, validateMcpResult, MCP_RESPONSE_BYTES} from './remote-mcp.mjs';
import {quoteSnapshot} from './quote-store.mjs';

export const MCP_RESULT_REPRESENTATION = 'MCP_CALL_TOOL_RESULT_JSON';
const MANIFEST_SCHEMA = 'stellar-forge.mcp-result.v1';
const MANIFEST_BYTES = 512 * 1024;
const RESULT_STATES = new Set(['CONFIRMED_BY_SERVER','INDETERMINATE','FREE_SUCCESS','PROBE_REJECTED']);
const fail = code => { throw Object.assign(new Error(code), {code}); };
const need = (value, code) => { if (!value) fail(code); };
const sha = value => createHash('sha256').update(value).digest('hex');
const key = value => {
  need(typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value), 'MCP_RESULT_QUOTE_INVALID');
  return value;
};
const privateOwned = stat => (stat.mode & 0o077) === 0 &&
  (typeof process.getuid !== 'function' || stat.uid === process.getuid());
const stamp = stat => [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
const parse = bytes => {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { fail('MCP_RESULT_JSON_INVALID'); }
};

/** Read a caller-selected original file without following a replaced final path. */
export async function readPrivateResultSource(path, {maxBytes = MCP_RESPONSE_BYTES} = {}) {
  need(typeof path === 'string' && isAbsolute(path), 'MCP_RESULT_ABSOLUTE_SOURCE_REQUIRED');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && privateOwned(before) && before.size <= maxBytes, 'MCP_RESULT_PRIVATE_SOURCE_REQUIRED');
    const bytes = await handle.readFile();
    need(bytes.length === before.size && stamp(await handle.stat()) === stamp(before), 'MCP_RESULT_SOURCE_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
function identity(quote) {
  key(quote?.quoteId); validateMcpInvocation(quote.invocation);
  need(quote.method === 'tools/call' && quote.url === quote.invocation.endpoint && quote.accepted,
    'MCP_RESULT_QUOTE_INVALID');
  return sha(mcpJson({quoteId:quote.quoteId, invocation:quote.invocation, accepted:quote.accepted}, 256 * 1024));
}
export function serializeMcpResult(result) {
  const bytes = Buffer.from(JSON.stringify(result));
  need(bytes.length <= MCP_RESPONSE_BYTES, 'MCP_RESULT_TOO_LARGE');
  return bytes;
}

/** Preserve the original preview and settlement identity when importing or recovering. */
async function retainedResult(quote, bytes) {
  need(bytes instanceof Uint8Array && bytes.byteLength <= MCP_RESPONSE_BYTES, 'MCP_RESULT_TOO_LARGE');
  const result = parse(bytes);
  await validateMcpResult(result);
  const preview = mcpResultContent(result), original = quote.result?.content;
  const expected = typeof original?.body === 'string'
    ? {bytes:Buffer.byteLength(original.body), sha256:sha(original.body), truncated:original.truncated === true}
    : {bytes:original?.bodyBytes, sha256:original?.bodySha256, truncated:original?.truncated === true};
  need(expected.sha256 === sha(preview.body) && expected.bytes === Buffer.byteLength(preview.body) &&
    expected.truncated === preview.truncated, 'MCP_RETAINED_RESULT_MISMATCH');
  const known = quote.result?.paymentResponse, receipt = result?._meta?.['x402/payment-response'];
  if (known) need(known.success === (receipt?.success === true) &&
    ['network','transaction','payer'].every(name => (known[name] ?? null) === (receipt?.[name] ?? null)),
    'MCP_RETAINED_RECEIPT_MISMATCH');
  return result;
}

/** Restore only mutable completion fields; the original quote owns all terms. */
function completedQuote(quote, completion) {
  need(completion && ['quoteId','resource','method','createdAt','expiresAt'].every(name =>
    completion[name] === quote[name]) && (completion.url ?? completion.requestUrl) === quote.url &&
    same(completion.invocation, quote.invocation), 'MCP_COMPLETION_IDENTITY_MISMATCH');
  if (completion.accepted) need(same(completion.accepted, quote.accepted) &&
    completion.operatorScope === quote.operatorScope && completion.fingerprint === quote.fingerprint,
    'MCP_COMPLETION_IDENTITY_MISMATCH');
  else need(['scheme','network','asset','amount','payTo'].every(name =>
    completion.selected?.[name] === quote.accepted[name]), 'MCP_COMPLETION_TERMS_MISMATCH');
  need(RESULT_STATES.has(completion.status) && completion.phase === 'RESULT' &&
    completion.result?.protocol === 'mcp' && completion.result.content &&
    Number.isSafeInteger(completion.updatedAt) && completion.updatedAt >= quote.createdAt &&
    completion.attempts === 1 && completion.attempts >= quote.attempts &&
    typeof completion.signedRequestDispatched === 'boolean' &&
    (!quote.signedRequestDispatched || completion.signedRequestDispatched) &&
    completion.signedRequestDispatched === (completion.result.paidAttempted === true), 'MCP_COMPLETION_INVALID');
  return {...structuredClone(quote), status:completion.status, phase:'RESULT', attempts:completion.attempts,
    signedRequestDispatched:completion.signedRequestDispatched,
    updatedAt:Math.max(quote.updatedAt, completion.updatedAt),
    result:structuredClone(completion.result), failure:completion.failure ?? null};
}

function requireOutcome(quote, result) {
  need(RESULT_STATES.has(quote.status) && quote.phase === 'RESULT', 'MCP_COMPLETION_INVALID');
  const paid = quote.result.paidAttempted === true, receipt = result?._meta?.['x402/payment-response'];
  if (quote.status === 'CONFIRMED_BY_SERVER') need(paid && result.isError !== true &&
    receipt?.success === true && receipt.network === quote.accepted.network &&
    typeof receipt.transaction === 'string' && /^[a-f0-9]{64}$/i.test(receipt.transaction), 'MCP_COMPLETION_OUTCOME_MISMATCH');
  if (quote.status === 'INDETERMINATE') need(paid, 'MCP_COMPLETION_OUTCOME_MISMATCH');
  if (quote.status === 'FREE_SUCCESS' || quote.status === 'PROBE_REJECTED') need(!paid &&
    !quote.signedRequestDispatched && (result.isError === true) === (quote.status === 'PROBE_REJECTED'),
    'MCP_COMPLETION_OUTCOME_MISMATCH');
}

async function manifestBytes(quote, saved, writer, signal) {
  const bytes = Buffer.from(JSON.stringify({schema:MANIFEST_SCHEMA,
    quote:quoteSnapshot({...quote, result:{...quote.result, responseFile:saved}})}));
  need(bytes.length <= MANIFEST_BYTES, 'MCP_RESULT_METADATA_TOO_LARGE');
  await writer.saveBytes(bytes, {contentType:'application/json', signal});
}

async function syncDirectory(path) {
  const directory = await open(path, constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Original streaming, JSON and create-only export methods, with native MCP metadata. */
export class McpSavedResult extends VerifiedFile {
  #saved;
  constructor(metadata) { super(); this.#saved = Object.freeze(structuredClone(metadata)); }
  get metadata() { return structuredClone(this.#saved); }
  _metadata() { return this.#saved; }
}

export class McpResultStore {
  #root; #readOnly; #closed = false; #active = new Map(); #cache = new Map();
  constructor({directory, readOnly = false} = {}) {
    need(typeof directory === 'string' && isAbsolute(directory) && !directory.includes('\0'), 'MCP_RESULT_DIRECTORY_INVALID');
    if (!readOnly) try { mkdirSync(directory, {mode:0o700}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = lstatSync(directory);
    need(stat.isDirectory() && !stat.isSymbolicLink() && privateOwned(stat) &&
      realpathSync(directory) === resolve(directory), 'MCP_RESULT_PRIVATE_DIRECTORY_REQUIRED');
    this.#root = resolve(directory); this.#readOnly = readOnly;
  }
  #open(write = false) {
    need(!this.#closed, 'MCP_RESULT_STORE_CLOSED');
    need(!write || !this.#readOnly, 'MCP_RESULT_STORE_READ_ONLY');
  }
  #destination(quote) { identity(quote); return join(this.#root, key(quote.quoteId) + '.json'); }
  #manifest(quote) { identity(quote); return join(this.#root, key(quote.quoteId) + '.meta.json'); }
  #reservation(quote) {
    return {status:'RESERVED', destination:this.#destination(quote), manifestPath:this.#manifest(quote),
      quoteId:quote.quoteId, invocationSha256:identity(quote), representation:MCP_RESULT_REPRESENTATION,
      contentType:'application/json', maxBytes:MCP_RESPONSE_BYTES};
  }
  #bound(quote, saved) {
    need(saved?.quoteId === quote.quoteId && saved.invocationSha256 === identity(quote) &&
      saved.representation === MCP_RESULT_REPRESENTATION &&
      (saved.manifestPath === undefined || saved.manifestPath === this.#manifest(quote)) &&
      (saved.path ?? saved.destination) === this.#destination(quote), 'MCP_RESULT_BINDING_CHANGED');
  }
  async prepare(quote) {
    this.#open(true);
    const id = key(quote.quoteId), destination = this.#destination(quote);
    need(!this.#active.has(id), 'MCP_RESULT_CAPTURE_ACTIVE');
    const reservation = Object.freeze(this.#reservation(quote));
    const entry = {};
    this.#active.set(id, entry);
    entry.promise = (async () => {
      let writer, metadataWriter;
      try {
        writer = await prepareBuyerResponseFile({destination, maxBytes:MCP_RESPONSE_BYTES,
          timeoutMs:30000, expectedContentType:'application/json'});
        metadataWriter = await prepareBuyerResponseFile({destination:reservation.manifestPath,
          maxBytes:MANIFEST_BYTES, timeoutMs:30000, expectedContentType:'application/json'});
        if (this.#closed) fail('MCP_RESULT_STORE_CLOSED');
      } catch (error) {
        try { await writer?.abort(); } finally { await metadataWriter?.abort(); this.#active.delete(id); }
        throw error;
      }
      let finished = false;
      const abort = async () => {
        if (!finished) {
          finished = true;
          try { await writer.abort(); } finally {
            try { await metadataWriter.abort(); } finally { this.#active.delete(id); }
          }
        }
      };
      return Object.freeze({reservation,
        async save(result, {signal} = {}) {
          need(!finished, 'MCP_RESULT_CAPTURE_FINISHED');
          try {
            const bytes = serializeMcpResult(result);
            need(identity(quote) === reservation.invocationSha256, 'MCP_RESULT_BINDING_CHANGED');
            const saved = {...reservation, ...await writer.saveBytes(bytes, {contentType:'application/json', signal}),
              status:'SAVED', manifestStatus:'SAVED', capturedAt:new Date().toISOString()};
            try {
              await manifestBytes(quote, saved, metadataWriter, signal);
              await syncDirectory(resolve(destination, '..'));
            } catch (error) {
              // A complete useful payload remains saved if the separate recovery
              // record fails. Never turn local metadata failure into another buy.
              saved.manifestStatus = 'SAVE_FAILED'; saved.manifestError = error.code ?? 'MCP_RESULT_METADATA_FAILED';
              saved.manifestPartialPath = error.partialPath ?? null;
            }
            return saved;
          } finally { await abort(); }
        },
        abort,
      });
    })();
    return entry.promise;
  }
  file(quote) {
    this.#open();
    const saved = quote.result?.responseFile;
    need(saved?.status === 'SAVED', 'MCP_RESULT_NOT_SAVED');
    this.#bound(quote, saved);
    need(saved.status === 'SAVED' && Number.isSafeInteger(saved.bytes) && saved.bytes >= 0 &&
      saved.bytes <= MCP_RESPONSE_BYTES && /^[a-f0-9]{64}$/.test(saved.sha256 ?? ''), 'MCP_RESULT_NOT_SAVED');
    const stat = lstatSync(saved.path);
    need(stat.isFile() && !stat.isSymbolicLink() && privateOwned(stat) && stat.size === saved.bytes,
      'MCP_RESULT_FILE_CHANGED');
    return new McpSavedResult(saved);
  }
  async read(quote, {byteOffset = 0, maxBytes = 32768} = {}) {
    const file = this.file(quote), saved = file.metadata;
    need(Number.isSafeInteger(byteOffset) && byteOffset >= 0 && byteOffset <= saved.bytes &&
      Number.isSafeInteger(maxBytes) && maxBytes >= 1 && maxBytes <= 65536, 'MCP_RESULT_RANGE_INVALID');
    const before = await lstat(saved.path);
    need(before.isFile() && !before.isSymbolicLink() && privateOwned(before) && before.size === saved.bytes,
      'MCP_RESULT_FILE_CHANGED');
    const fingerprint = stamp(before) + ':' + saved.sha256;
    let cached = this.#cache.get(quote.quoteId);
    if (cached?.fingerprint !== fingerprint) {
      const bytes = await file.bytes({limit:MCP_RESPONSE_BYTES});
      need(stamp(await lstat(saved.path)) === stamp(before), 'MCP_RESULT_FILE_CHANGED');
      cached = {fingerprint, bytes};
      if (!this.#closed) { this.#cache.delete(quote.quoteId); this.#cache.set(quote.quoteId, cached); }
      // At most 16 MiB, shared by every page read in this operator process.
      while (this.#cache.size > 8) this.#cache.delete(this.#cache.keys().next().value);
    }
    const chunk = cached.bytes.subarray(byteOffset, Math.min(byteOffset + maxBytes, saved.bytes));
    let text;
    if (byteOffset === 0 && chunk.length === saved.bytes) text = new TextDecoder('utf-8', {fatal:true}).decode(chunk);
    return {quoteId:quote.quoteId, representation:MCP_RESULT_REPRESENTATION,
      contentType:saved.contentType, bytes:saved.bytes, sha256:saved.sha256,
      byteOffset, returnedBytes:chunk.length, encoding:'base64', data:chunk.toString('base64'),
      ...(text === undefined ? {} : {text}),
      nextByteOffset:byteOffset + chunk.length < saved.bytes ? byteOffset + chunk.length : null};
  }
  async recover(quote) {
    this.#open(true);
    need(!this.#active.has(quote.quoteId), 'MCP_RESULT_CAPTURE_ACTIVE');
    const path = this.#destination(quote), manifestPath = this.#manifest(quote);
    let manifest;
    try {
      manifest = parse(await readPrivateResultSource(manifestPath, {maxBytes:MANIFEST_BYTES}));
      need(manifest.schema === MANIFEST_SCHEMA, 'MCP_RESULT_METADATA_INVALID');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let restored = manifest ? completedQuote(quote, manifest.quote) : structuredClone(quote);
    const bytes = await readPrivateResultSource(path), result = await retainedResult(restored, bytes);
    requireOutcome(restored, result);
    if (quote.result?.content) {
      await retainedResult(quote, bytes);
      // A previous confirmed completion must not be downgraded by older metadata.
      if (['CONFIRMED_BY_SERVER','FREE_SUCCESS'].includes(quote.status)) restored = structuredClone(quote);
    }
    const prior = manifest?.quote.result.responseFile ?? quote.result?.responseFile;
    if (prior) {
      this.#bound(quote, prior);
      if (prior.status === 'SAVED') need(prior.bytes === bytes.length && prior.sha256 === sha(bytes), 'MCP_RESULT_FILE_CHANGED');
    }
    const saved = {...this.#reservation(quote), ...prior, status:'SAVED', path, bytes:bytes.length,
      sha256:sha(bytes), manifestStatus:manifest ? 'SAVED' : 'MISSING',
      capturedAt:prior?.capturedAt ?? new Date().toISOString(), recovered:true};
    restored.result = {...restored.result, content:mcpResultContent(result), responseFile:saved};
    if (!manifest) {
      let writer;
      try {
        writer = await prepareBuyerResponseFile({destination:manifestPath,
          maxBytes:MANIFEST_BYTES, expectedContentType:'application/json'});
        saved.manifestStatus = 'SAVED';
        await manifestBytes(restored, saved, writer); await syncDirectory(this.#root);
      } catch (error) { saved.manifestStatus = 'SAVE_FAILED'; saved.manifestError = error.code ?? 'MCP_RESULT_METADATA_FAILED'; }
      finally { await writer?.abort(); }
    }
    return restored;
  }
  async import(quote, bytes) {
    this.#open(true);
    need(!['PREVIEWED','APPROVAL_PENDING','EXECUTING','CANCEL_REQUESTED'].includes(quote.status), 'MCP_RESULT_NOT_READY');
    const result = await retainedResult(quote, bytes);
    if (quote.result?.responseFile?.status === 'SAVED') { await this.file(quote).verify(); return {saved:quote.result.responseFile}; }
    return {capture:await this.prepare(quote), result};
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true; this.#cache.clear();
    await Promise.allSettled([...this.#active.values()].map(async entry => (await entry.promise).abort()));
  }
}

/** Trusted host import of a previously returned native result; no provider call. */
export async function importRetainedMcpResult({quoteStore, resultStore, quoteId, bytes, completion}) {
  let quote = quoteStore.load().find(record => record.quoteId === key(quoteId));
  need(quote, 'QUOTE_UNKNOWN');
  if (completion !== undefined) {
    const restored = completedQuote(quote, completion), result = await retainedResult(restored, bytes);
    requireOutcome(restored, result);
    if (quote.result?.content) await retainedResult(quote, bytes);
    if (!quote.result?.content || !RESULT_STATES.has(quote.status)) {
      // The full original host completion repairs an older database snapshot.
      // No approval, signer, merchant or ledger is called by this import.
      quote = restored;
      quote.result.content = mcpResultContent(result);
      delete quote.result.responseFile;
      quote.updatedAt = Date.now(); quoteStore.save(quote);
    }
  }
  const imported = await resultStore.import(quote, bytes);
  if (imported.saved) return structuredClone(imported.saved);
  const persist = () => { quote.updatedAt = Date.now(); quoteStore.save(quote); };
  try {
    quote.result.responseFile = imported.capture.reservation; persist();
    quote.result.responseFile = {...await imported.capture.save(imported.result), imported:true}; persist();
    return structuredClone(quote.result.responseFile);
  } catch (error) {
    quote.result.responseFile = {...imported.capture.reservation, status:'SAVE_FAILED',
      error:error.code ?? 'MCP_RESULT_SAVE_FAILED', partialPath:error.partialPath ?? null};
    persist(); throw error;
  } finally { await imported.capture.abort(); }
}

export async function recoverRetainedMcpResult({quoteStore, resultStore, quoteId}) {
  const original = quoteStore.load().find(record => record.quoteId === key(quoteId));
  need(original, 'QUOTE_UNKNOWN');
  const quote = await resultStore.recover(original);
  quote.updatedAt = Date.now(); quoteStore.save(quote);
  return {quoteId:quote.quoteId, status:quote.status, responseFile:structuredClone(quote.result.responseFile)};
}
