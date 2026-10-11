/**
 * Parse an operator-exported HTTP response header dump, preserving the exact
 * challenge-header multiplicity without retaining incidental response headers.
 * This module never makes a network request.
 * SPDX-License-Identifier: MIT
 */
import { createHash } from 'node:crypto';

const LIMIT = 64 * 1024;
const FIELD_LIMIT = 16 * 1024;
const NAME = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/;
const STATUS = /^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?)\s+([1-5][0-9]{2})(?:[ \t]+([^\r\n]*))?$/i;
const WANTED = new Set(['payment-required', 'www-authenticate']);

export class HeaderTraceError extends Error {
  constructor(code) { super(code); this.name = 'HeaderTraceError'; this.code = code; }
}

export function parseHeaderTrace(rawBytes) {
  const raw = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  if (raw.length === 0 || raw.length > LIMIT) throw new HeaderTraceError('SOURCE_SIZE_OUT_OF_RANGE');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { throw new HeaderTraceError('SOURCE_NOT_UTF8'); }
  if (source.includes('\0') || /\r(?!\n)/.test(source)) throw new HeaderTraceError('INVALID_LINE_ENDING');
  if (!source.endsWith('\n\n')) {
    // curl -D produces a terminated header section; refusing unterminated
    // input also avoids accidentally accepting a partial header/body dump.
    if (!source.endsWith('\r\n\r\n')) throw new HeaderTraceError('UNTERMINATED_HEADER_SECTION');
  }
  const chunks = source.replaceAll('\r\n', '\n').split('\n\n');
  if (chunks.at(-1) !== '') throw new HeaderTraceError('TRAILING_CONTENT');
  chunks.pop();
  if (!chunks.length || chunks.some(chunk => !chunk.trim()) || chunks.length > 4) {
    throw new HeaderTraceError('INVALID_RESPONSE_BLOCK_COUNT');
  }
  const blocks = chunks.map(chunk => {
    const lines = chunk.split('\n');
    const match = STATUS.exec(lines.shift());
    if (!match) throw new HeaderTraceError('INVALID_HTTP_STATUS_LINE');
    const status = Number(match[1]);
    const reason = match[2] ?? '';
    const headers = [];
    if (lines.length > 80) throw new HeaderTraceError('TOO_MANY_HEADER_FIELDS');
    for (const line of lines) {
      if (line.length > FIELD_LIMIT || /^[ \t]/.test(line)) throw new HeaderTraceError('INVALID_OR_FOLDED_HEADER');
      const sep = line.indexOf(':');
      if (sep <= 0 || !NAME.test(line.slice(0, sep))) throw new HeaderTraceError('INVALID_HEADER_FIELD');
      const name = line.slice(0, sep);
      const value = line.slice(sep + 1).trim();
      if (/\p{Cc}/u.test(value) || Buffer.byteLength(value, 'utf8') > FIELD_LIMIT) {
        throw new HeaderTraceError('INVALID_HEADER_VALUE');
      }
      if (WANTED.has(name.toLowerCase())) headers.push([name, value]);
    }
    return { status, reason, headers };
  });
  for (const block of blocks.slice(0, -1)) {
    // curl's proxy CONNECT prelude or a standards-defined informational
    // response may precede the real final status. Neither may contain a
    // payment challenge. Multiple final resource responses are ambiguous.
    const interim = [100, 102, 103].includes(block.status);
    const proxyConnect = block.status === 200 && /^Connection established$/i.test(block.reason.trim());
    if ((!interim && !proxyConnect) || block.headers.length) {
      throw new HeaderTraceError('MULTIPLE_FINAL_OR_CHALLENGE_BLOCKS');
    }
  }
  const last = blocks.at(-1);
  if (last.status < 200 || last.status > 599) throw new HeaderTraceError('NO_FINAL_RESPONSE');
  return {
    status: last.status,
    headers: last.headers,
    sourceHeaderSha256: createHash('sha256').update(raw).digest('hex'),
    sourceHeaderBytes: raw.length,
    discardedPreludeBlocks: blocks.length - 1,
  };
}
