// MIT — Import the original SF30 merchant-issued capability; never issue one here.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { validateHeaderName } from 'node:http';

const SCHEMA = 'stellar-forge.upstream-operation-ticket.v1';
const MAX_BYTES = 16384;
const HASH = /^[a-f0-9]{64}$/;
// These headers belong to HTTP, original payment/identity handling, or SF98.
const PROTECTED_HEADER = /^(?:host$|connection$|keep-alive$|te$|trailer$|upgrade$|expect$|content-|transfer-|accept$|accept-|authorization$|cookie$|set-cookie$|x-api-key$|api-key$|apikey$|proxy-|forwarded$|x-forwarded-|sec-|payment-|x-payment|x402-|extension-responses$|settlement-overrides$|x-sf98-order-id$)/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export class OperationTicketError extends Error {
  constructor(code) {
    super(code); this.name = 'OperationTicketError'; this.code = code;
    this.paymentSent = false;
  }
}
const need = (ok, code) => { if (!ok) throw new OperationTicketError(code); };

/** Validate only the private reference. Configuration never contains the bearer. */
export function operationTicketReference(operation) {
  const {ticketFile, ticketHeader} = operation;
  if (ticketFile === undefined) {
    need(ticketHeader === undefined, 'OPERATION_TICKET_FILE_REQUIRED');
    return null;
  }
  need(typeof ticketFile === 'string' && isAbsolute(ticketFile) &&
    !ticketFile.includes('\0') && resolve(ticketFile) === ticketFile,
    'OPERATION_TICKET_CANONICAL_PATH_REQUIRED');
  need((operation.method ?? 'GET') === 'POST', 'OPERATION_TICKET_POST_REQUIRED');
  const requestHeader = ticketHeader ?? 'x-merchant-operation';
  need(typeof requestHeader === 'string' && requestHeader.length >= 1 &&
    requestHeader.length <= 128 && requestHeader === requestHeader.toLowerCase(),
    'OPERATION_TICKET_HEADER_INVALID');
  try { validateHeaderName(requestHeader); }
  catch { throw new OperationTicketError('OPERATION_TICKET_HEADER_INVALID'); }
  need(!PROTECTED_HEADER.test(requestHeader) &&
    !Object.keys(operation.headers ?? {}).some(name => name.toLowerCase() === requestHeader),
    'OPERATION_TICKET_HEADER_RESERVED');
  return {file:ticketFile, requestHeader};
}

/** Bounded, same-owner, private regular file with no symlink aliases. */
async function privateBytes(path) {
  let handle;
  try {
    need(process.platform !== 'win32', 'OPERATION_TICKET_PRIVATE_POSIX_FILE_REQUIRED');
    need(await realpath(path) === path, 'OPERATION_TICKET_SYMLINK_REFUSED');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    need(info.isFile() && (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid()),
      'OPERATION_TICKET_PRIVATE_FILE_REQUIRED');
    need(info.size > 0 && info.size <= MAX_BYTES, 'OPERATION_TICKET_FILE_TOO_LARGE');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    need(size <= MAX_BYTES, 'OPERATION_TICKET_FILE_TOO_LARGE');
    return buffer.subarray(0, size);
  } catch (error) {
    if (error instanceof OperationTicketError) throw error;
    throw new OperationTicketError(error?.code === 'ENOENT' ?
      'OPERATION_TICKET_FILE_MISSING' : 'OPERATION_TICKET_FILE_UNREADABLE');
  } finally { if (handle) await handle.close(); }
}

export function requireCurrentOperationTicket(ticket, now = Date.now()) {
  if (ticket) need(ticket.expiresAt > now, 'OPERATION_TICKET_EXPIRED');
}

/** Read the merchant envelope without pretending to verify its private HMAC. */
export async function loadOperationTicket(operation, {requireCurrent = false} = {}) {
  const reference = operationTicketReference(operation);
  if (!reference) return null;
  const raw = await privateBytes(reference.file);
  return parseOperationTicketBytes(raw, operation, {requireCurrent});
}

/** The same envelope validation for a private transfer before creating files. */
export function parseOperationTicketBytes(raw, operation, {requireCurrent = false} = {}) {
  const reference = operationTicketReference(operation);
  need(reference && raw instanceof Uint8Array && raw.byteLength > 0 && raw.byteLength <= MAX_BYTES,
    'OPERATION_TICKET_SCHEMA_INVALID');
  raw = Buffer.from(raw);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { throw new OperationTicketError('OPERATION_TICKET_JSON_INVALID'); }
  need(object(value) && Object.keys(value).length === 5 &&
    Object.keys(value).every(name => ['schema','ticket','operationKey','requestHash','expiresAt'].includes(name)) &&
    value.schema === SCHEMA && typeof value.ticket === 'string' && value.ticket.length <= 4096 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value.ticket) &&
    typeof value.operationKey === 'string' && HASH.test(value.operationKey) &&
    typeof value.requestHash === 'string' && HASH.test(value.requestHash) &&
    Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0,
    'OPERATION_TICKET_SCHEMA_INVALID');
  const result = {schema:SCHEMA, operationKey:value.operationKey,
    requestHash:value.requestHash, expiresAt:value.expiresAt,
    requestHeader:reference.requestHeader,
    sha256:createHash('sha256').update(raw).digest('hex'), bytes:raw.length};
  // Accidental JSON/spread output remains metadata-only. Only request assembly
  // and private file copying access these two non-enumerable values.
  Object.defineProperties(result, {
    headerValue:{value:value.ticket}, sourceBytes:{value:raw},
  });
  if (requireCurrent) requireCurrentOperationTicket(result);
  return Object.freeze(result);
}

/** Safe for offline CLI/queue records. No ticket bytes, bearer, or HMAC key. */
export function operationTicketView(ticket) {
  return ticket ? {...ticket, expired:ticket.expiresAt <= Date.now()} : null;
}

/** The ordinary merchant header follows original SF31's unsigned + paid call. */
export function operationTicketHeaders(operation, ticket) {
  if (!ticket) return operation.headers;
  const reference = operationTicketReference(operation);
  need(reference?.requestHeader === ticket.requestHeader, 'OPERATION_TICKET_HEADER_CHANGED');
  return {...operation.headers, [ticket.requestHeader]:ticket.headerValue};
}

/** The queue pins the exact private file and rechecks it at execution entry. */
export function requireOperationTicketFingerprint(ticket, expected) {
  if (expected !== undefined)
    need((ticket?.sha256 ?? null) === expected, 'OPERATION_TICKET_SNAPSHOT_CHANGED');
}
