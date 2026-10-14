'use strict';
/**
 * Read original RFC 2822/MIME bytes in a connected JavaScript runtime.
 * No filesystem, provider requests, attachment uploads, or active-content execution.
 * Uses the existing Commons byte and maintained SHA-256 implementations.
 */
const {base64} = require('./connected_archive_bytes.cjs');
const {sha256Bytes} = require('./connected_sha256.cjs');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUES = new Int16Array(128);
B64_VALUES.fill(-1);
for (let i = 0; i < B64.length; i++) B64_VALUES[B64.charCodeAt(i)] = i;

function decodeBase64(value) {
  if (typeof value !== 'string') throw new TypeError('Base64 input must be a string');
  const s = value.replace(/[ \t\r\n]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const firstPad = s.indexOf('='), n = firstPad < 0 ? s.length : firstPad;
  const pad = firstPad < 0 ? 0 : s.length - firstPad;
  if (n % 4 === 1 || pad > 2 || (pad && (s.length % 4 || !/^=+$/.test(s.slice(n)) ||
      pad !== (4 - n % 4) % 4))) throw new TypeError('Invalid base64 length or padding');
  const out = new Uint8Array(Math.floor(n * 6 / 8));
  let acc = 0, bits = 0, at = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i), v = c < 128 ? B64_VALUES[c] : -1;
    if (v < 0) throw new TypeError('Invalid base64 character at ' + i);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[at++] = (acc >>> bits) & 255; }
  }
  if (bits && (acc & ((1 << bits) - 1))) throw new TypeError('Nonzero unused base64 bits');
  return out;
}
function latin1(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return chunks.join('');
}
function latin1Bytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 255) throw new TypeError('Expected original byte-preserving Latin-1');
    out[i] = code;
  }
  return out;
}
function percentBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%') {
      if (!/^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3)))
        throw new TypeError('Invalid RFC 2231 percent escape');
      out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2;
    } else {
      if (s.charCodeAt(i) > 255) throw new TypeError('Non-byte extended parameter');
      out.push(s.charCodeAt(i));
    }
  }
  return Uint8Array.from(out);
}
function decodeCharset(bytes, charset) {
  const c = String(charset || 'utf-8').trim().toLowerCase().replace(/_/g, '-');
  if (c === 'utf-8' || c === 'utf8')
    return decodeURIComponent(Array.from(bytes, b => '%' + b.toString(16).padStart(2, '0')).join(''));
  if (c === 'us-ascii' || c === 'ascii') {
    if (bytes.some(b => b > 127)) throw new TypeError('Non-ASCII bytes in ASCII header');
    return latin1(bytes);
  }
  if (c === 'iso-8859-1' || c === 'latin1' || c === 'latin-1') return latin1(bytes);
  if (c === 'windows-1252' || c === 'cp1252') {
    const special = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
    return Array.from(bytes, b => b >= 128 && b <= 159 ? special[b - 128] : String.fromCharCode(b)).join('');
  }
  if (typeof TextDecoder === 'function') return new TextDecoder(c, {fatal: true}).decode(bytes);
  throw new TypeError('Charset requires a decoder: ' + c);
}
function quotedPrintable(s, warnings) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '=') { out.push(s.charCodeAt(i)); continue; }
    if (s.slice(i + 1, i + 3) === '\r\n') { i += 2; continue; }
    if (s[i + 1] === '\n') { i++; continue; }
    if (/^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; continue;
    }
    warnings.push({code: 'INVALID_QUOTED_PRINTABLE_ESCAPE', offset: i});
    out.push(61);
  }
  return Uint8Array.from(out);
}
function decodeHeaderWords(value, warnings) {
  // RFC 2047 ignores whitespace between adjacent encoded words.
  return value.replace(/(\?=)[ \t\r\n]+(?==\?[^? \t]+\?[bq]\?)/gi, '$1')
    .replace(/=\?([^? \t]+)\?([bq])\?([^?]*)\?=/gi, (original, charset, encoding, data) => {
      try {
        const bytes = encoding.toLowerCase() === 'b' ? decodeBase64(data) :
          quotedPrintable(data.replace(/_/g, ' '), warnings);
        return decodeCharset(bytes, charset);
      } catch (error) {
        warnings.push({code: 'HEADER_DECODE_ERROR', charset, message: error.message});
        return original;
      }
    });
}
function parseParameterized(value) {
  const chunks = [];
  let chunk = '', quote = false, escape = false;
  for (const c of String(value || '')) {
    if (escape) { chunk += c; escape = false; continue; }
    if (quote && c === '\\') { chunk += c; escape = true; continue; }
    if (c === '"') quote = !quote;
    if (c === ';' && !quote) { chunks.push(chunk); chunk = ''; } else chunk += c;
  }
  chunks.push(chunk);
  const parameters = [];
  for (const part of chunks.slice(1)) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    let v = part.slice(at + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    parameters.push({name, value: v});
  }
  return {value: chunks[0].trim().toLowerCase(), parameters};
}
function parameter(parsed, name, warnings) {
  const exact = key => parsed.parameters.filter(p => p.name === key);
  const extended = exact(name + '*');
  const continuations = parsed.parameters.map(p => {
    const m = p.name.match(/^([^*]+)\*(\d+)(\*)?$/);
    return m && m[1] === name ? {index: Number(m[2]), encoded: !!m[3], value: p.value} : null;
  }).filter(Boolean).sort((a, b) => a.index - b.index);
  try {
    if (continuations.length) {
      if (continuations.some((p, i) => p.index !== i))
        throw new TypeError('Non-contiguous or duplicate RFC 2231 parameter pieces');
      let charset = null, pieces = [];
      for (let i = 0; i < continuations.length; i++) {
        const p = continuations[i];
        let value = p.value;
        if (i === 0 && p.encoded) {
          const m = value.match(/^([^']*)'[^']*'(.*)$/s);
          if (!m) throw new TypeError('Missing RFC 2231 charset/language prefix');
          charset = m[1] || 'us-ascii'; value = m[2];
        }
        pieces.push(p.encoded ? percentBytes(value) : latin1Bytes(value));
      }
      const joined = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
      let at = 0; for (const p of pieces) { joined.set(p, at); at += p.length; }
      return charset ? decodeCharset(joined, charset) : decodeHeaderWords(latin1(joined), warnings);
    }
    if (extended.length) {
      if (extended.length > 1) warnings.push({code: 'DUPLICATE_EXTENDED_PARAMETER', name});
      const m = extended[0].value.match(/^([^']*)'[^']*'(.*)$/s);
      if (!m) throw new TypeError('Missing RFC 2231 charset/language prefix');
      return decodeCharset(percentBytes(m[2]), m[1] || 'us-ascii');
    }
  } catch (error) { warnings.push({code: 'PARAMETER_DECODE_ERROR', name, message: error.message}); }
  const plain = exact(name);
  if (plain.length > 1) warnings.push({code: 'DUPLICATE_PARAMETER', name});
  if (plain.length) return decodeHeaderWords(plain[0].value, warnings);
  // Preserve a recoverable original name if its declared encoding is unsupported.
  if (extended.length) return extended[0].value;
  if (continuations.length) return continuations.map(p => p.value).join('');
  return null;
}
function splitHeaders(raw, warnings) {
  let end, skip;
  if (raw.startsWith('\r\n')) { end = 0; skip = 2; }
  else if (raw.startsWith('\n')) { end = 0; skip = 1; }
  else {
    const crlf = raw.indexOf('\r\n\r\n'), lf = raw.indexOf('\n\n');
    if (crlf < 0 && lf < 0) throw new TypeError('MIME header/body separator missing');
    if (crlf >= 0 && (lf < 0 || crlf < lf)) { end = crlf; skip = 4; }
    else { end = lf; skip = 2; }
  }
  const headerText = raw.slice(0, end), headers = [];
  for (const line of headerText.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) {
      const h = headers[headers.length - 1]; h.raw += '\r\n' + line; h.value += ' ' + line.trim();
      continue;
    }
    if (!line) continue;
    const m = line.match(/^([!-9;-~]+):(.*)$/);
    if (!m) { warnings.push({code: 'INVALID_HEADER_LINE', line}); continue; }
    headers.push({name: m[1].toLowerCase(), value: m[2].trim(), raw: line});
  }
  return {headers, rawHeaders: headerText, body: raw.slice(end + skip)};
}
function header(headers, name, warnings) {
  const values = headers.filter(h => h.name === name);
  if (values.length > 1) warnings.push({code: 'REPEATED_HEADER', name, count: values.length});
  return values[0]?.value || '';
}
function transfer(body, encoding, warnings) {
  switch (encoding) {
    case 'base64': return decodeBase64(body);
    case 'quoted-printable': return quotedPrintable(body, warnings);
    case '7bit': {
      if (/[^\x00-\x7f]/.test(body)) warnings.push({code: 'NON_ASCII_7BIT_BODY'});
      return latin1Bytes(body);
    }
    case '8bit': case 'binary': case '': return latin1Bytes(body);
    default: throw new TypeError('Unsupported MIME Content-Transfer-Encoding: ' + encoding);
  }
}
function multipartPieces(body, boundary) {
  if (!boundary || /[\r\n]/.test(boundary)) throw new TypeError('Missing or invalid MIME boundary');
  const prefix = '--' + boundary, lines = [];
  let at = 0;
  while (at <= body.length) {
    const nl = body.indexOf('\n', at), end = nl < 0 ? body.length : nl;
    let line = body.slice(at, end); if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.startsWith(prefix)) {
      const suffix = line.slice(prefix.length), closing = /^--[ \t]*$/.test(suffix);
      if (closing || /^[ \t]*$/.test(suffix)) lines.push({start: at, after: nl < 0 ? end : end + 1, closing});
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  if (!lines.length || lines[0].closing) throw new TypeError('MIME opening boundary missing');
  const pieces = [];
  let closed = false;
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    if (current.closing) { closed = true; break; }
    const next = lines[i + 1];
    if (!next) break;
    let end = next.start;
    // RFC 2046 section 5.1.1: the CRLF preceding a boundary belongs to that delimiter.
    if (body.slice(end - 2, end) === '\r\n') end -= 2;
    else if (body[end - 1] === '\n') end--;
    pieces.push(body.slice(current.after, Math.max(current.after, end)));
  }
  if (!closed) throw new TypeError('MIME closing boundary missing; original source is incomplete');
  return pieces;
}
function detectMediaType(bytes) {
  const head = latin1(bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return 'application/pdf';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('PK\x03\x04') || head.startsWith('PK\x05\x06')) return 'application/zip';
  return null;
}
function parseMimeMessage(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Original RFC 2822 Uint8Array required');
  const result = {schema: 'commons.connected-mime.v1', source: options.source || {},
    rfc2822: sha256Bytes(bytes), nodes: [], parts: [], errors: [], complete: true};
  // Existing callers retain their original behavior. Receivers of arbitrary
  // messages can require a finite complete parse instead of a clipped tree.
  const parseLimit = (value, name) => {
    if (value === undefined) return Infinity;
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(name + ' must be a positive integer');
    return value;
  };
  const maxParts = parseLimit(options.maxParts, 'maxParts'), maxDepth = parseLimit(options.maxDepth, 'maxDepth');
  const visit = (raw, id, fallbackType, depth = 0) => {
    if (result.nodes.length >= maxParts || depth >= maxDepth) {
      result.errors.push({partId: id, name: 'RangeError', message: 'MIME parse limit exceeded'});
      result.complete = false; return;
    }
    const warnings = [], node = {partId: id, children: [], warnings};
    result.nodes.push(node);
    try {
      const h = splitHeaders(raw, warnings);
      node.headers = h.headers; node.rawHeaders = h.rawHeaders;
      const ct = parseParameterized(header(h.headers, 'content-type', warnings) || fallbackType || 'text/plain');
      const disposition = parseParameterized(header(h.headers, 'content-disposition', warnings));
      node.mimeType = ct.value;
      node.contentTypeParameters = ct.parameters; node.disposition = disposition.value;
      node.contentDispositionParameters = disposition.parameters;
      node.filename = parameter(disposition, 'filename', warnings) || parameter(ct, 'name', warnings);
      node.contentId = header(h.headers, 'content-id', warnings) || null;
      node.transferEncoding = header(h.headers, 'content-transfer-encoding', warnings).toLowerCase();
      const decoded = transfer(h.body, node.transferEncoding, warnings);
      node.decoded = sha256Bytes(decoded);
      if (node.mimeType.startsWith('multipart/')) {
        const boundary = parameter(ct, 'boundary', warnings);
        const children = multipartPieces(latin1(decoded), boundary);
        children.forEach((child, i) => {
          const childId = id + '.' + (i + 1); node.children.push(childId);
          visit(child, childId, node.mimeType === 'multipart/digest' ? 'message/rfc822' : 'text/plain', depth + 1);
        });
        return;
      }
      const part = {partId: id, filename: node.filename, mimeType: node.mimeType,
        detectedMediaType: detectMediaType(decoded), disposition: node.disposition, contentId: node.contentId,
        transferEncoding: node.transferEncoding, ...node.decoded, warnings};
      if (options.includeBase64 !== false) part.base64 = base64(decoded);
      if (node.mimeType.startsWith('text/') && options.includeText === true) {
        const charset = parameter(ct, 'charset', warnings) || 'us-ascii';
        try { part.text = decodeCharset(decoded, charset); }
        catch (error) { warnings.push({code: 'BODY_CHARSET_DECODE_ERROR', charset, message: error.message}); }
      }
      if (part.detectedMediaType && part.detectedMediaType !== node.mimeType)
        warnings.push({code: 'DECLARED_MEDIA_TYPE_DIFFERS', declared: node.mimeType, detected: part.detectedMediaType});
      result.parts.push(part);
      if (node.mimeType === 'message/rfc822' || node.mimeType === 'message/global') {
        const childId = id + '.1'; node.children.push(childId); visit(latin1(decoded), childId, 'text/plain', depth + 1);
      }
    } catch (error) {
      node.error = {name: error.name, message: error.message};
      result.errors.push({partId: id, ...node.error}); result.complete = false;
    }
  };
  visit(latin1(bytes), '1', 'text/plain');
  result.pdfPartIds = result.parts.filter(p => p.detectedMediaType === 'application/pdf').map(p => p.partId);
  return result;
}
function parseGmailRaw(message, options = {}) {
  if (!message || typeof message.raw !== 'string')
    throw new TypeError('Pass the original Gmail messages.get format=raw message object');
  return parseMimeMessage(decodeBase64(message.raw), {...options, source: {
    ...options.source, provider: 'gmail', accountId: options.accountId || options.source?.accountId || null,
    messageId: message.id || options.source?.messageId || null, threadId: message.threadId || message.thread_id || null,
    historyId: message.historyId || message.history_id || null,
    internalDate: message.internalDate || message.internal_date || null}});
}
function pdfParts(message) {
  return message.parts.filter(p => p.detectedMediaType === 'application/pdf');
}
module.exports = {decodeBase64, latin1, latin1Bytes, decodeCharset, decodeHeaderWords,
  parseMimeMessage, parseGmailRaw, pdfParts, detectMediaType};
