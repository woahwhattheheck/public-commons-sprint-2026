// MIT — Exact ordinary request headers for original merchant and buyer workflows.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { validateHeaderName, validateHeaderValue } from 'node:http';

const MAX_HEADER_BYTES = 8192;
const MAX_FILE_BYTES = 16384;
const canonical = new Map([['content-type','Content-Type'], ['accept','Accept'],
  ['x-sf98-order-id','X-SF98-Order-ID']]);
// Authentication, HTTP framing, payment and private ticket assembly keep their
// original owners. SF98's visible header is still checked against its order URL
// by operation(); a configured custom ticket header is checked there as well.
const reserved = /^(?:host|connection|keep-alive|content-length|transfer-encoding|te|trailer|upgrade|expect|proxy-.*|cookie|set-cookie|accept-encoding|content-encoding|origin|referer|forwarded|x-forwarded-.*|sec-.*|payment-.*|x-payment.*|extension-responses|settlement-overrides|x402-.*|www-authenticate|authorization|x-api-key|api-key|apikey|x-merchant-operation)$/i;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));

export class RequestHeadersError extends Error {
  constructor(code) { super(code); this.name = 'RequestHeadersError'; this.code = code; this.paymentSent = false; }
}
const need = (condition, code) => { if (!condition) throw new RequestHeadersError(code); };

/** Canonical names, exact values. Never silently trim a ticket-bound request. */
export function normalizeOperationHeaders(input = {}) {
  need(plain(input), 'INVALID_HEADERS');
  const entries = Object.entries(input), seen = new Set(), result = [];
  need(entries.length <= 64, 'REQUEST_HEADERS_TOO_LARGE');
  let bytes = 0;
  for (const [name,value] of entries) {
    const lower = name.toLowerCase();
    need(name.length <= 128 && typeof value === 'string', 'INVALID_HEADERS');
    need(!seen.has(lower), 'DUPLICATE_REQUEST_HEADER');
    need(!reserved.test(lower), 'RESERVED_REQUEST_HEADER');
    try { validateHeaderName(name); validateHeaderValue(name,value); }
    catch { throw new RequestHeadersError('INVALID_HEADERS'); }
    let effective;
    try { effective = new Headers([[lower,value]]).get(lower); }
    catch { throw new RequestHeadersError('INVALID_HEADERS'); }
    need(effective === value, 'REQUEST_HEADER_NORMALIZATION_REQUIRED');
    bytes += Buffer.byteLength(lower + ': ' + value + '\r\n');
    need(bytes <= MAX_HEADER_BYTES, 'REQUEST_HEADERS_TOO_LARGE');
    seen.add(lower); result.push([canonical.get(lower) ?? lower,value]);
  }
  // Keep insertion order for existing reviewed configurations and inbox jobs.
  return Object.fromEntries(result);
}

/** Read once into the prepared config; later edits cannot change that request. */
export async function readOperationHeaders(path) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path &&
    !path.includes('\0'), 'HEADERS_FILE_CANONICAL_PATH_REQUIRED');
  let file;
  try {
    need(process.platform !== 'win32', 'HEADERS_FILE_PRIVATE_POSIX_REQUIRED');
    need(await realpath(path) === path, 'HEADERS_FILE_SYMLINK_REFUSED');
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    need(info.isFile() && (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid()),
      'HEADERS_FILE_PRIVATE_REQUIRED');
    need(info.size > 0 && info.size <= MAX_FILE_BYTES, 'HEADERS_FILE_TOO_LARGE');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await file.read(buffer,size,buffer.length-size,size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    need(size <= MAX_FILE_BYTES, 'HEADERS_FILE_TOO_LARGE');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size))); }
    catch { throw new RequestHeadersError('HEADERS_FILE_JSON_INVALID'); }
    return normalizeOperationHeaders(value);
  } catch (error) {
    if (error instanceof RequestHeadersError) throw error;
    throw new RequestHeadersError(error?.code === 'ENOENT' ? 'HEADERS_FILE_MISSING' : 'HEADERS_FILE_UNREADABLE');
  } finally { if (file) await file.close(); }
}
