// MIT. Strict, bounded ETIM xChange source intake. No products or header fields are projected away.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WorkspaceError } from '../../../workspace/store.mjs';

export const XCHANGE_INPUT_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024 * 1024,
  maxProductBytes: 8 * 1024 * 1024,
  maxHeaderBytes: 2 * 1024 * 1024,
  maxTokenBytes: 8 * 1024 * 1024,
  maxDepth: 128,
  maxNodes: 131072
});
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const PUNCTUATION = new Set([0x7b, 0x7d, 0x5b, 0x5d, 0x3a, 0x2c]);
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = (path, key) => path + '/' + String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const set = (target, key, value) => Object.defineProperty(target, key, {
  value, enumerable: true, configurable: true, writable: true
});
function fail(code, message, path = '', offset = null, status = 400) {
  const where = path ? ' at ' + path : '';
  const position = offset === null ? '' : ' (byte ' + offset + ')';
  throw new WorkspaceError('SUPPLIER_XCHANGE_' + code, message + where + position + '.', status);
}
function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function configuration(options) {
  if (!object(options)) fail('OPTIONS_INVALID', 'Input options must be an object');
  const chosen = options.limits ?? {};
  if (!object(chosen)) fail('LIMIT_INVALID', 'Input limits must be an object');
  for (const name of Object.keys(chosen))
    if (!Object.hasOwn(XCHANGE_INPUT_LIMITS, name)) fail('LIMIT_INVALID', 'Unknown input limit ' + name);
  const limits = { ...XCHANGE_INPUT_LIMITS, ...chosen };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1) fail('LIMIT_INVALID', name + ' must be a positive safe integer');
  if (limits.maxDepth > 512) fail('LIMIT_INVALID', 'maxDepth must not exceed 512');
  if (options.expectedBytes !== undefined &&
      (!Number.isSafeInteger(options.expectedBytes) || options.expectedBytes < 0))
    fail('SOURCE_IDENTITY_INVALID', 'expectedBytes must be a nonnegative safe integer');
  if (options.expectedSha256 !== undefined && !SHA256.test(options.expectedSha256))
    fail('SOURCE_IDENTITY_INVALID', 'expectedSha256 must be a lowercase SHA-256 digest');
  const signal = options.signal;
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
    fail('SIGNAL_INVALID', 'Use an AbortSignal for cancellation');
  return { ...options, limits, signal };
}
function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? new WorkspaceError('SUPPLIER_XCHANGE_ABORTED', 'Source intake was cancelled.', 499);
}
function waitFor(promise, signal) {
  if (!signal) return promise;
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new WorkspaceError('SUPPLIER_XCHANGE_ABORTED', 'Source intake was cancelled.', 499));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) aborted();
  });
}
function sameFile(a, b) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
}
async function originalSource(input, options) {
  checkAbort(options.signal);
  let handle = null, baseline = null, stream = null, iterator = null, ended = false, closed = false;
  try {
    if (typeof input === 'string') {
      handle = await open(input, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      baseline = await handle.stat({ bigint: true });
      if (!baseline.isFile()) fail('SOURCE_FILE_REQUIRED', 'The selected source must be a regular file');
      if (baseline.size > BigInt(options.limits.maxBytes)) fail('SOURCE_LIMIT', 'The selected source exceeds maxBytes', '', null, 413);
      if (options.expectedBytes !== undefined && baseline.size !== BigInt(options.expectedBytes))
        fail('SOURCE_CHANGED', 'The selected source byte count differs from its retained identity', '', null, 409);
      stream = handle.createReadStream({ autoClose: false, highWaterMark: 262144 });
    } else if (input instanceof Uint8Array) {
      stream = [input];
    } else {
      stream = input;
    }
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function' && typeof stream[Symbol.iterator] !== 'function')
      fail('SOURCE_REQUIRED', 'Supply an original filename or an iterable of original UTF-8 byte chunks');
    iterator = typeof stream[Symbol.asyncIterator] === 'function' ? stream[Symbol.asyncIterator]() : stream[Symbol.iterator]();
  } catch (error) {
    if (handle) await handle.close();
    throw error;
  }
  const aborted = () => {
    if (typeof stream.destroy === 'function') stream.destroy();
  };
  options.signal?.addEventListener('abort', aborted, { once: true });
  if (options.signal?.aborted) aborted();
  return {
    async next() {
      checkAbort(options.signal);
      const next = await waitFor(Promise.resolve(iterator.next()), options.signal);
      ended = next.done === true;
      if (!ended && !(next.value instanceof Uint8Array))
        fail('BYTE_CHUNK_REQUIRED', 'The original source must yield UTF-8 bytes without string conversion');
      return next;
    },
    async verify() {
      checkAbort(options.signal);
      if (!ended) fail('EOF_REQUIRED', 'Read the complete original source before accepting intake');
      if (handle && !sameFile(baseline, await handle.stat({ bigint: true })))
        fail('SOURCE_CHANGED', 'The original source changed while it was being read', '', null, 409);
    },
    async close() {
      if (closed) return;
      options.signal?.removeEventListener('abort', aborted);
      let error = null;
      try {
        if (!ended && typeof stream.destroy === 'function') stream.destroy();
        if (!ended && typeof iterator.return === 'function') await iterator.return();
      } catch (failure) { error = failure; }
      try { if (handle) await handle.close(); }
      catch (failure) { error ??= failure; }
      if (error) throw error;
      closed = true;
    }
  };
}
class Bytes {
  constructor(source, options) {
    this.source = source; this.options = options; this.buffer = Buffer.alloc(0); this.index = 0;
    this.offset = 0; this.bytes = 0; this.done = false; this.hash = createHash('sha256'); this.captures = new Set();
  }
  async ready() {
    checkAbort(this.options.signal);
    while (this.index === this.buffer.length && !this.done) {
      const next = await this.source.next();
      if (next.done) { this.done = true; break; }
      this.buffer = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      this.index = 0;
      this.bytes += this.buffer.length;
      if (!Number.isSafeInteger(this.bytes) || this.bytes > this.options.limits.maxBytes)
        fail('SOURCE_LIMIT', 'The original source exceeds maxBytes', '', this.offset, 413);
      if (this.options.expectedBytes !== undefined && this.bytes > this.options.expectedBytes)
        fail('SOURCE_CHANGED', 'The original source exceeds its retained byte count', '', this.offset, 409);
      this.hash.update(this.buffer);
    }
    return this.index < this.buffer.length;
  }
  advance(count) {
    const part = this.buffer.subarray(this.index, this.index + count);
    for (const capture of this.captures) {
      capture.bytes += count;
      if (capture.limit && capture.bytes > capture.limit)
        fail('PRODUCT_LIMIT', 'The original product exceeds maxProductBytes', capture.path, this.offset, 413);
      capture.hash.update(part);
    }
    this.index += count; this.offset += count;
  }
  capture(token, path, limit = null) {
    const capture = { hash: createHash('sha256').update(token.type), bytes: 1, path, limit };
    this.captures.add(capture);
    return capture;
  }
  finishCapture(capture) {
    this.captures.delete(capture);
    return { bytes: capture.bytes, sha256: capture.hash.digest('hex') };
  }
}
class Tokens {
  constructor(bytes) { this.bytes = bytes; this.first = true; }
  async next(path = '') {
    const reader = this.bytes;
    if (this.first) {
      this.first = false;
      if (await reader.ready() && reader.buffer[reader.index] === 0xef) {
        for (const expected of [0xef, 0xbb, 0xbf]) {
          if (!await reader.ready() || reader.buffer[reader.index] !== expected)
            fail('UTF8_INVALID', 'Invalid UTF-8 byte order marker', path, reader.offset);
          reader.advance(1);
        }
      }
    }
    while (await reader.ready()) {
      let end = reader.index;
      while (end < reader.buffer.length && WHITESPACE.has(reader.buffer[end])) end++;
      reader.advance(end - reader.index);
      if (reader.index < reader.buffer.length) break;
    }
    if (!await reader.ready()) return { type: 'eof', start: reader.offset, end: reader.offset, bytes: 0 };
    const start = reader.offset, first = reader.buffer[reader.index];
    if (PUNCTUATION.has(first)) {
      reader.advance(1);
      return { type: String.fromCharCode(first), start, end: reader.offset, bytes: 1 };
    }
    const parts = []; let size = 0, string = first === 0x22, escaped = false, complete = false;
    const take = (from, count) => {
      if (!count) return;
      size += count;
      if (size > reader.options.limits.maxTokenBytes)
        fail('TOKEN_LIMIT', 'An original JSON token exceeds maxTokenBytes', path, start, 413);
      parts.push(Buffer.from(reader.buffer.subarray(from, from + count)));
      reader.advance(count);
    };
    if (string) {
      take(reader.index, 1);
      while (await reader.ready()) {
        let cursor = reader.index;
        for (; cursor < reader.buffer.length; cursor++) {
          const byte = reader.buffer[cursor];
          if (byte < 0x20) fail('JSON_INVALID', 'Unescaped control character in a JSON string', path, reader.offset + cursor - reader.index);
          if (escaped) { escaped = false; continue; }
          if (byte === 0x5c) { escaped = true; continue; }
          if (byte === 0x22) { cursor++; complete = true; break; }
        }
        take(reader.index, cursor - reader.index);
        if (complete) break;
      }
      if (!complete) fail('JSON_INCOMPLETE', 'The original source ends inside a JSON string', path, start);
      let text;
      try { text = utf8.decode(Buffer.concat(parts, size)); }
      catch { fail('UTF8_INVALID', 'A JSON string is not valid UTF-8', path, start); }
      let value;
      try { value = JSON.parse(text); }
      catch { fail('JSON_INVALID', 'A JSON string has an invalid escape', path, start); }
      return { type: 'string', value, start, end: reader.offset, bytes: size };
    }
    while (await reader.ready()) {
      let cursor = reader.index;
      for (; cursor < reader.buffer.length; cursor++) {
        const byte = reader.buffer[cursor];
        if (WHITESPACE.has(byte) || PUNCTUATION.has(byte)) break;
      }
      take(reader.index, cursor - reader.index);
      if (cursor < reader.buffer.length) break;
    }
    const raw = Buffer.concat(parts, size).toString('latin1');
    if (raw === 'true' || raw === 'false' || raw === 'null')
      return { type: 'literal', value: raw === 'null' ? null : raw === 'true', start, end: reader.offset, bytes: size };
    if (!NUMBER.test(raw)) fail('JSON_INVALID', 'Invalid JSON number or literal', path, start);
    return { type: 'number', value: raw, start, end: reader.offset, bytes: size };
  }
}
class Document {
  constructor(bytes) { this.bytes = bytes; this.tokens = new Tokens(bytes); this.limits = bytes.options.limits; }
  budget(kind) { return { bytes: 0, nodes: 0, kind, limit: kind === 'header' ? this.limits.maxHeaderBytes : this.limits.maxProductBytes }; }
  charge(budget, token, path, node = false) {
    budget.bytes += token.bytes;
    if (node) budget.nodes++;
    if (budget.bytes > budget.limit) fail(budget.kind === 'header' ? 'HEADER_LIMIT' : 'PRODUCT_LIMIT',
      'The retained original ' + budget.kind + ' exceeds its byte limit', path, token.start, 413);
    if (budget.nodes > this.limits.maxNodes)
      fail('NODE_LIMIT', 'The retained original ' + budget.kind + ' exceeds maxNodes', path, token.start, 413);
  }
  async token(path, budget = null) {
    const token = await this.tokens.next(path);
    if (budget) this.charge(budget, token, path);
    return token;
  }
  expect(token, type, path) {
    if (token.type !== type) fail(token.type === 'eof' ? 'JSON_INCOMPLETE' : 'JSON_INVALID',
      'Expected ' + type, path, token.start);
  }
  key(token, seen, path) {
    this.expect(token, 'string', path);
    if (seen.has(token.value)) fail('DUPLICATE_KEY', 'Duplicate JSON object key', pointer(path, token.value), token.start);
    seen.add(token.value);
    return token.value;
  }
  async value(token, budget, numbers, path, depth = 0) {
    if (depth > this.limits.maxDepth) fail('DEPTH_LIMIT', 'The original JSON exceeds maxDepth', path, token.start, 413);
    this.charge(budget, token, path, true);
    if (token.type === 'string' || token.type === 'literal') return token.value;
    if (token.type === 'number') { set(numbers, path, token.value); return token.value; }
    if (token.type === '{') {
      const value = {}, seen = new Set();
      let next = await this.token(path, budget);
      if (next.type === '}') return value;
      for (;;) {
        const key = this.key(next, seen, path), child = pointer(path, key);
        this.expect(await this.token(child, budget), ':', child);
        set(value, key, await this.value(await this.token(child), budget, numbers, child, depth + 1));
        next = await this.token(path, budget);
        if (next.type === '}') return value;
        this.expect(next, ',', path);
        next = await this.token(path, budget);
      }
    }
    if (token.type === '[') {
      const value = [];
      let next = await this.token(path);
      if (next.type === ']') { this.charge(budget, next, path); return value; }
      for (;;) {
        value.push(await this.value(next, budget, numbers, pointer(path, value.length), depth + 1));
        next = await this.token(path, budget);
        if (next.type === ']') return value;
        this.expect(next, ',', path);
        next = await this.token(pointer(path, value.length));
      }
    }
    fail(token.type === 'eof' ? 'JSON_INCOMPLETE' : 'JSON_INVALID', 'Expected a JSON value', path, token.start);
  }
  async *products(supplierIndex, state) {
    const path = '/Supplier/' + supplierIndex + '/Product';
    if (this.limits.maxDepth < 3) fail('DEPTH_LIMIT', 'The original JSON exceeds maxDepth', path, this.bytes.offset, 413);
    this.expect(await this.token(path), '[', path);
    let token = await this.token(path), productIndex = 0;
    if (token.type === ']') fail('PRODUCTS_REQUIRED', 'The original supplier Product array must contain at least one product', path, token.start);
    for (;;) {
      const productPath = path + '/' + productIndex;
      this.expect(token, '{', productPath);
      const capture = this.bytes.capture(token, productPath, this.limits.maxProductBytes);
      let product, identity;
      const numberTokens = {};
      try {
        product = await this.value(token, this.budget('product'), numberTokens, '', 4);
        identity = this.bytes.finishCapture(capture);
      } catch (error) { this.bytes.captures.delete(capture); throw error; }
      state.productCount++; state.ordinal++;
      yield freeze({ type: 'product', supplierIndex, productIndex, ordinal: state.ordinal,
        product, numberTokens, source: { path: productPath, byteStart: token.start,
          byteEnd: this.bytes.offset, ...identity } });
      productIndex++;
      token = await this.token(path);
      if (token.type === ']') return;
      this.expect(token, ',', path);
      token = await this.token(path + '/' + productIndex);
    }
  }
  async *supplier(token, supplierIndex, state) {
    const path = '/Supplier/' + supplierIndex;
    if (this.limits.maxDepth < 2) fail('DEPTH_LIMIT', 'The original JSON exceeds maxDepth', path, token.start, 413);
    this.expect(token, '{', path);
    const capture = this.bytes.capture(token, path);
    const header = {}, numberTokens = {}, fieldOrder = [], seen = new Set(), budget = this.budget('header');
    const firstCount = state.productCount, byteStart = token.start;
    let hasProducts = false, next = await this.token(path);
    try {
      if (next.type !== '}') for (;;) {
        const key = this.key(next, seen, path); fieldOrder.push(key);
        const child = pointer(path, key);
        this.expect(await this.token(child), ':', child);
        if (key === 'Product') { hasProducts = true; yield* this.products(supplierIndex, state); }
        else {
          this.charge(budget, next, child);
          set(header, key, await this.value(await this.token(child), budget, numberTokens, pointer('', key), 3));
        }
        next = await this.token(path);
        if (next.type === '}') break;
        this.expect(next, ',', path);
        next = await this.token(path);
      }
      if (!hasProducts) fail('PRODUCTS_REQUIRED', 'The original supplier must contain its Product array', path, byteStart);
      const identity = this.bytes.finishCapture(capture);
      yield freeze({ type: 'supplier', supplierIndex, header, numberTokens, fieldOrder,
        productCount: state.productCount - firstCount,
        source: { path, byteStart, byteEnd: this.bytes.offset, ...identity } });
    } catch (error) { this.bytes.captures.delete(capture); throw error; }
  }
  async *suppliers(state) {
    this.expect(await this.token('/Supplier'), '[', '/Supplier');
    let token = await this.token('/Supplier'), index = 0;
    if (token.type === ']') fail('SUPPLIERS_REQUIRED', 'The original Supplier array must contain at least one supplier', '/Supplier', token.start);
    for (;;) {
      yield* this.supplier(token, index, state);
      state.supplierCount++; index++;
      token = await this.token('/Supplier');
      if (token.type === ']') return;
      this.expect(token, ',', '/Supplier');
      token = await this.token('/Supplier/' + index);
    }
  }
  async *read(state) {
    const header = {}, numberTokens = {}, fieldOrder = [], seen = new Set(), budget = this.budget('header');
    this.expect(await this.token(''), '{', '');
    let hasSuppliers = false, token = await this.token('');
    if (token.type !== '}') for (;;) {
      const key = this.key(token, seen, ''); fieldOrder.push(key);
      const child = pointer('', key);
      this.expect(await this.token(child), ':', child);
      if (key === 'Supplier') { hasSuppliers = true; yield* this.suppliers(state); }
      else {
        this.charge(budget, token, child);
        set(header, key, await this.value(await this.token(child), budget, numberTokens, child, 1));
      }
      token = await this.token('');
      if (token.type === '}') break;
      this.expect(token, ',', '');
      token = await this.token('');
    }
    if (!hasSuppliers) fail('SUPPLIERS_REQUIRED', 'The original catalogue must contain its Supplier array');
    this.expect(await this.token(''), 'eof', '');
    state.header = header; state.numberTokens = numberTokens; state.fieldOrder = fieldOrder;
  }
}

/**
 * Read one original UTF-8 document with bounded memory and backpressure.
 *
 * Input is a filename opened without following its final symlink, a Uint8Array,
 * or an iterable of immutable Uint8Array chunks. Custom asynchronous sources must
 * make iterator.return() release their input; AbortSignal also destroys Readables.
 *
 * Products are yielded as complete original subtrees, including all TradeItem
 * records. JSON numbers are exact original token strings with relative JSONPointer
 * entries in numberTokens. Originally quoted strings remain unchanged.
 *
 * Supplier events contain their complete original headers except Product.
 * The final complete event contains the original root header except Supplier.
 * fieldOrder retains the omitted streamed-array position. JSON property order is
 * unrestricted: consumers stage product events and join complete headers only
 * after the EOF/hash-verified complete event. No complete event is emitted after
 * early cancellation, a changed source, or any syntax/duplicate-key error.
 */
export async function* readXChange(input, options = {}) {
  const config = configuration(options), source = await originalSource(input, config);
  const bytes = new Bytes(source, config), document = new Document(bytes);
  const state = { supplierCount: 0, productCount: 0, ordinal: 0 };
  try {
    yield* document.read(state);
    await source.verify();
    if (config.expectedBytes !== undefined && bytes.bytes !== config.expectedBytes)
      fail('SOURCE_CHANGED', 'The complete original source byte count differs from its retained identity', '', bytes.offset, 409);
    const sha256 = bytes.hash.digest('hex');
    if (config.expectedSha256 !== undefined && sha256 !== config.expectedSha256)
      fail('SOURCE_CHANGED', 'The complete original source digest differs from its retained identity', '', bytes.offset, 409);
    await source.close();
    checkAbort(config.signal);
    yield freeze({ type: 'complete', header: state.header, numberTokens: state.numberTokens,
      fieldOrder: state.fieldOrder, supplierCount: state.supplierCount, productCount: state.productCount,
      bytes: bytes.bytes, sha256 });
  } finally { await source.close(); }
}
