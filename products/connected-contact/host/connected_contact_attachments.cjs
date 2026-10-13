'use strict';

/**
 * The original console attachment wire format on connected runtimes.
 * Uses the maintained connected_sha256.cjs byte hasher. No I/O, sender, account,
 * intent, recipient lease, case mutation or second body renderer lives here.
 *
 * prepare() consumes contactRuntimeInput's exact five-field manifest and bytes.
 * payload() composes the caller's original reviewed text MIME part.
 * prepareNative() normalizes an already retained native multipart payload without
 * changing its original JSON tree or text/binary representation.
 * receive() binds the original full Gmail message and, when necessary, its
 * native raw representation to every reviewed attachment byte.
 */
const CONTACT_ATTACHMENT_LIMIT_BYTES = 8 * 1024 * 1024;
const CONTACT_ATTACHMENT_COUNT = 10;
const RAW_LIMIT = 17 * 1024 * 1024;
const fields = ['item_id', 'filename', 'mime_type', 'bytes', 'sha256'];
const types = Object.freeze({
  pdf:'application/pdf', md:'text/markdown', txt:'text/plain', csv:'text/csv',
  json:'application/json', html:'text/html', htm:'text/html',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip:'application/zip'
});
const fail = code => {throw Object.assign(new Error(code), {code, status:422});};
const mime = value => String(value ?? '').split(';')[0].trim().toLowerCase();
const messageValue = value => {
  if (value?.isError) fail('CONTACT_DELIVERY_PROVIDER_ERROR');
  const result = value?.structuredContent ?? value;
  if (!result || typeof result !== 'object' || Array.isArray(result))
    fail('CONTACT_DELIVERY_RESULT_REQUIRED');
  return result;
};

/** Strict complete base64/base64url bytes, including RFC MIME line folding. */
function decodeBase64(value, maximum) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 + 1024 * 1024)
    fail('CONTACT_ATTACHMENT_BASE64_INVALID');
  const compact = value.replace(/[\t\r\n ]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) fail('CONTACT_ATTACHMENT_BASE64_INVALID');
  const bare = compact.replace(/=+$/, ''), padding = compact.length - bare.length;
  if (bare.length % 4 === 1 || (padding && padding !== (4 - bare.length % 4) % 4))
    fail('CONTACT_ATTACHMENT_BASE64_INVALID');
  const length = Math.floor(bare.length * 6 / 8);
  if (length > maximum) fail('CONTACT_ATTACHMENTS_TOO_LARGE');
  const output = new Uint8Array(length), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let accumulated = 0, bits = 0, offset = 0;
  for (let index = 0; index < bare.length; index++) {
    accumulated = accumulated * 64 + alphabet.indexOf(bare[index]); bits += 6;
    if (bits >= 8) {
      bits -= 8; output[offset++] = accumulated >>> bits;
      accumulated &= (1 << bits) - 1;
    }
  }
  if (offset !== length || accumulated !== 0) fail('CONTACT_ATTACHMENT_BASE64_INVALID');
  return output;
}
function encodeBase64Url(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const chunks = []; let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const count = Math.min(3, bytes.length - i);
    const value = bytes[i] * 65536 + (count > 1 ? bytes[i+1] * 256 : 0) + (count > 2 ? bytes[i+2] : 0);
    chunk += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63];
    if (count > 1) chunk += alphabet[(value >>> 6) & 63];
    if (count > 2) chunk += alphabet[value & 63];
    if (chunk.length >= 8192) {chunks.push(chunk); chunk = '';}
  }
  if (chunk) chunks.push(chunk);
  return chunks.join('');
}
function byteString(bytes) {
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  return chunks.join('');
}
function binaryBytes(value) {
  const result = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255) fail('CONTACT_RAW_MIME_BYTES_INVALID');
    result[i] = code;
  }
  return result;
}
function utf8Bytes(value, hash) {
  const measured = hash(value), bytes = new Uint8Array(measured.bytes);
  let offset = 0;
  for (const char of value) {
    const point = char.codePointAt(0);
    if (point < 128) bytes[offset++] = point;
    else if (point < 2048) {bytes[offset++] = 192 | point >>> 6; bytes[offset++] = 128 | point & 63;}
    else if (point < 65536) {
      bytes[offset++] = 224 | point >>> 12; bytes[offset++] = 128 | point >>> 6 & 63;
      bytes[offset++] = 128 | point & 63;
    } else {
      bytes[offset++] = 240 | point >>> 18; bytes[offset++] = 128 | point >>> 12 & 63;
      bytes[offset++] = 128 | point >>> 6 & 63; bytes[offset++] = 128 | point & 63;
    }
  }
  if (offset !== measured.bytes) fail('CONTACT_ATTACHMENT_UTF8_INVALID');
  return bytes;
}

function headersAndBody(value) {
  if (value.startsWith('\r\n') || value.startsWith('\n'))
    return {header: (name, fallback = '') => fallback, body:value.slice(value[0] === '\r' ? 2 : 1)};
  const crlf = value.indexOf('\r\n\r\n'), lf = value.indexOf('\n\n');
  const at = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf;
  if (at < 0 || at > 65536) fail('CONTACT_RAW_MIME_HEADERS_INVALID');
  const width = at === crlf ? 4 : 2, headers = new Map();
  const lines = value.slice(0, at).split(/\r?\n/), unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!unfolded.length) fail('CONTACT_RAW_MIME_HEADERS_INVALID');
      unfolded[unfolded.length - 1] += ' ' + line.trim();
    } else unfolded.push(line);
  }
  if (unfolded.length > 256) fail('CONTACT_RAW_MIME_HEADERS_INVALID');
  for (const line of unfolded) {
    const match = /^([A-Za-z0-9!#$%&'*+.^_\x60|~-]+):[ \t]*(.*)$/.exec(line);
    if (!match) fail('CONTACT_RAW_MIME_HEADERS_INVALID');
    const name = match[1].toLowerCase(), values = headers.get(name) ?? [];
    values.push(match[2]); headers.set(name, values);
  }
  const header = (name, fallback = '') => {
    const values = headers.get(name) ?? [];
    if (values.length > 1) fail('CONTACT_RAW_MIME_HEADER_DUPLICATE');
    return values[0] ?? fallback;
  };
  return {header, body:value.slice(at + width)};
}
function contentType(value) {
  const fields = []; let field = '', quoted = false, escaped = false;
  for (const char of value) {
    if (escaped) {field += char; escaped = false; continue;}
    if (char === '\\' && quoted) {field += char; escaped = true; continue;}
    if (char === '"') quoted = !quoted;
    if (char === ';' && !quoted) {fields.push(field.trim()); field = '';}
    else field += char;
  }
  if (quoted || escaped) fail('CONTACT_RAW_MIME_TYPE_INVALID');
  fields.push(field.trim());
  const type = fields.shift().toLowerCase(), parameters = new Map();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type))
    fail('CONTACT_RAW_MIME_TYPE_INVALID');
  for (const field of fields) {
    if (!field) continue;
    const match = /^([A-Za-z0-9!#$&^_.*+-]+)[ \t]*=[ \t]*(.*)$/.exec(field);
    if (!match) fail('CONTACT_RAW_MIME_TYPE_INVALID');
    const key = match[1].toLowerCase();
    if (parameters.has(key)) fail('CONTACT_RAW_MIME_TYPE_INVALID');
    let value = match[2].trim();
    if (value.startsWith('"')) {
      if (!value.endsWith('"')) fail('CONTACT_RAW_MIME_TYPE_INVALID');
      value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    parameters.set(key, value);
  }
  return {type, parameters};
}
function multipart(body, boundary) {
  if (typeof boundary !== 'string' || !boundary || boundary.length > 70 ||
      /[^\x20-\x7e]/.test(boundary) || boundary.endsWith(' '))
    fail('CONTACT_RAW_MIME_BOUNDARY_INVALID');
  const literal = boundary.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('^--' + literal + '(--)?[ \\t]*\\r?$', 'gm');
  const parts = []; let start = null, closed = false, match;
  while ((match = pattern.exec(body))) {
    if (start !== null) {
      let part = body.slice(start, match.index);
      if (part.endsWith('\r\n')) part = part.slice(0, -2);
      else if (part.endsWith('\n')) part = part.slice(0, -1);
      else fail('CONTACT_RAW_MIME_BOUNDARY_INVALID');
      parts.push(part);
      if (parts.length > 64) fail('CONTACT_RAW_MIME_PART_LIMIT');
    }
    if (match[1]) {closed = true; break;}
    const after = match.index + match[0].length;
    if (body[after] !== '\n') fail('CONTACT_RAW_MIME_BOUNDARY_INVALID');
    start = after + 1;
  }
  if (!closed || start === null || !parts.length) fail('CONTACT_RAW_MIME_INCOMPLETE');
  return parts;
}
function decodeTransfer(body, encoding) {
  const normalized = encoding.trim().toLowerCase();
  if (normalized === 'base64') return decodeBase64(body, CONTACT_ATTACHMENT_LIMIT_BYTES);
  if (normalized === 'quoted-printable') {
    // RFC 2045 section 6.7: transport-added trailing whitespace is not data.
    body = body.replace(/[ \t]+(?=\r?\n|$)/g, '');
    const output = []; let offset = 0;
    const append = value => {
      if (output.length >= CONTACT_ATTACHMENT_LIMIT_BYTES) fail('CONTACT_ATTACHMENTS_TOO_LARGE');
      output.push(value);
    };
    while (offset < body.length) {
      const code = body.charCodeAt(offset);
      if (code > 127) fail('CONTACT_RAW_MIME_TRANSFER_INVALID');
      if (body[offset] !== '=') {append(code); offset++; continue;}
      if (body.slice(offset+1, offset+3) === '\r\n') {offset += 3; continue;}
      if (body[offset+1] === '\n') {offset += 2; continue;}
      const hex = body.slice(offset+1, offset+3);
      if (!/^[a-f0-9]{2}$/i.test(hex)) fail('CONTACT_RAW_MIME_TRANSFER_INVALID');
      append(parseInt(hex, 16)); offset += 3;
    }
    return Uint8Array.from(output);
  }
  if (!['', '7bit', '8bit', 'binary'].includes(normalized))
    fail('CONTACT_RAW_MIME_TRANSFER_UNSUPPORTED');
  if (body.length > CONTACT_ATTACHMENT_LIMIT_BYTES ||
      (['', '7bit'].includes(normalized) && /[^\x00-\x7f]/.test(body)))
    fail('CONTACT_RAW_MIME_TRANSFER_INVALID');
  return binaryBytes(body);
}

/**
 * Parse only the original native MIME tree. The provider's full response owns
 * filename/header interpretation; raw bytes supply each corresponding leaf.
 * Matching tree shape, MIME type and complete attachment digest are required.
 */
function rawLeaves(raw, nativePayload) {
  const output = new Map(); let visited = 0;
  const walk = (entity, native, path, depth) => {
    if (!native || depth > 12 || ++visited > 128) fail('CONTACT_RAW_MIME_PART_LIMIT');
    const parsed = headersAndBody(entity);
    const type = contentType(parsed.header('content-type', 'text/plain'));
    if (type.type !== mime(native.mime_type ?? native.mimeType))
      fail('CONTACT_RAW_MIME_TREE_CHANGED');
    const nativeParts = native.parts ?? [];
    if (!Array.isArray(nativeParts)) fail('CONTACT_RAW_MIME_TREE_CHANGED');
    if (type.type.startsWith('multipart/')) {
      if (!['', '7bit', '8bit', 'binary'].includes(parsed.header('content-transfer-encoding').trim().toLowerCase()))
        fail('CONTACT_RAW_MIME_TRANSFER_UNSUPPORTED');
      const parts = multipart(parsed.body, type.parameters.get('boundary'));
      if (parts.length !== nativeParts.length) fail('CONTACT_RAW_MIME_TREE_CHANGED');
      parts.forEach((part, index) => walk(part, nativeParts[index], path + '.' + index, depth + 1));
    } else {
      if (nativeParts.length) fail('CONTACT_RAW_MIME_TREE_CHANGED');
      if (native.filename) output.set(path, decodeTransfer(parsed.body, parsed.header('content-transfer-encoding')));
    }
  };
  walk(raw, nativePayload, '0', 0); return output;
}


/** Google's published filename rule, inspected 2026-10-12. This describes Gmail's
 * transport, not whether software is harmful. Original artifacts remain intact. */
const GMAIL_ATTACHMENT_RULE_SOURCE = 'https://support.google.com/mail/answer/6590?hl=en';
const GMAIL_ATTACHMENT_RULE_DATE = '2026-10-12';
const GMAIL_FILENAME_TYPES = new Set(('ade adp apk appx appxbundle bat cab chm cmd com cpl diagcab diagcfg diagpkg dll dmg ex ex_ exe hta img ins iso isp jar jnlp js jse lib lnk mde mjs msc msi msix msixbundle msp mst nsh pif ps1 scr sct shb sys vb vbe vbs vhd vxd wsc wsf wsh xll').split(' '));
const ZIP_CONTAINER_TYPES = new Set(['zip','zipx','docx','xlsx','pptx','odt','ods','odp']);
const OTHER_CONTAINER_TYPES = new Set(['7z','rar','tar','tgz','gz','bz2','xz','zst']);
const fileExtension = name => {
  const leaf = String(name).split(/[\\/]/).pop();
  const position = leaf.lastIndexOf('.');
  return position < 0 ? '' : leaf.slice(position + 1).toLowerCase();
};
const zipNameLabel = (bytes, utf8) => {
  if (utf8) return decodeURIComponent(Array.from(bytes, byte => '%' + byte.toString(16).padStart(2,'0')).join(''));
  // Legacy ZIP labels retain every original name byte. ASCII suffixes use the
  // same bytes in the original legacy encodings; no guessed Unicode conversion.
  return Array.from(bytes, byte => byte >= 32 && byte < 127 ? String.fromCharCode(byte)
    : '\\x' + byte.toString(16).padStart(2,'0')).join('');
};

/**
 * Inspect the original single-disk ZIP directory and its matching local names.
 * File bodies are never extracted or executed. Stored nested ZIPs can be walked;
 * compressed/nondirectory containers are explicitly left in the returned scope.
 * This filename assessment is not a Gmail acceptance or malware verdict.
 */
function reviewGmailAttachment({filename, data} = {}) {
  if (typeof filename !== 'string' || !filename || !(data instanceof Uint8Array))
    fail('CONTACT_GMAIL_ATTACHMENT_BYTES_REQUIRED');
  const findings = [], uninspected = [];
  let entriesExamined = 0, directoryBytes = 0;
  const extensionMatch = (path, extension) => {
    if (GMAIL_FILENAME_TYPES.has(extension))
      findings.push({kind:'filename_type',path,extension:'.' + extension});
  };
  extensionMatch(filename, fileExtension(filename));
  function inspectZip(bytes, parent, depth) {
    if (depth > 8) {uninspected.push({path:parent,reason:'nested_archive_depth'});return;}
    if (bytes.length < 22) {uninspected.push({path:parent,reason:'zip_directory_unavailable'});return;}
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const u16 = offset => view.getUint16(offset,true), u32 = offset => view.getUint32(offset,true);
    let end = -1;
    for (let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--) {
      if (u32(at)===0x06054b50 && at+22+u16(at+20)===bytes.length) {end=at;break;}
    }
    if (end<0 || u16(end+4) || u16(end+6) || u16(end+8)!==u16(end+10)) {
      uninspected.push({path:parent,reason:'zip_directory_unavailable'});return;
    }
    const count=u16(end+10), central=u32(end+16), length=u32(end+12);
    if (count===65535 || central===0xffffffff || length===0xffffffff) {
      uninspected.push({path:parent,reason:'zip64_directory'});return;
    }
    if (central+length!==end || count>10000 || entriesExamined+count>10000 ||
        directoryBytes+length>8*1024*1024) {
      uninspected.push({path:parent,reason:'zip_directory_bounds'});return;
    }
    directoryBytes += length;
    const records=[];let at=central;
    for (let index=0;index<count;index++) {
      if (at+46>end || u32(at)!==0x02014b50) {
        uninspected.push({path:parent,reason:'zip_directory_incomplete'});return;
      }
      const flags=u16(at+8),method=u16(at+10),compressed=u32(at+20),size=u32(at+24);
      const nameBytes=u16(at+28),extra=u16(at+30),comment=u16(at+32),local=u32(at+42);
      if (at+46+nameBytes+extra+comment>end || !nameBytes || u16(at+34) ||
          local===0xffffffff || compressed===0xffffffff || size===0xffffffff ||
          local+30>central || u32(local)!==0x04034b50 ||
          u16(local+6)!==flags || u16(local+8)!==method || u16(local+26)!==nameBytes) {
        uninspected.push({path:parent,reason:'zip_member_directory_mismatch'});return;
      }
      const name=bytes.subarray(at+46,at+46+nameBytes),start=local+30+nameBytes+u16(local+28);
      if (start+compressed>central ||
          name.some((byte,index)=>byte!==bytes[local+30+index])) {
        uninspected.push({path:parent,reason:'zip_member_directory_mismatch'});return;
      }
      let label;
      try {label=zipNameLabel(name,Boolean(flags&0x800));}
      catch {uninspected.push({path:parent,reason:'zip_member_name_encoding'});return;}
      records.push({path:parent+'!/'+label,label,flags,method,size,compressed,start,
        directory:name[name.length-1]===47});
      at+=46+nameBytes+extra+comment;
    }
    if (at!==end) {uninspected.push({path:parent,reason:'zip_directory_incomplete'});return;}
    for (const record of records) {
      entriesExamined++;
      if (record.directory) continue;
      const extension=fileExtension(record.label);
      extensionMatch(record.path,extension);
      if (record.flags&1)
        findings.push({kind:'encrypted_archive_member',path:record.path});
      if (ZIP_CONTAINER_TYPES.has(extension)) {
        if (record.flags&1) continue;
        if (record.method===0 && record.compressed===record.size)
          inspectZip(bytes.subarray(record.start,record.start+record.compressed),record.path,depth+1);
        else uninspected.push({path:record.path,reason:'compressed_nested_archive'});
      } else if (OTHER_CONTAINER_TYPES.has(extension))
        uninspected.push({path:record.path,reason:'other_archive_format'});
    }
  }
  const extension=fileExtension(filename);
  const zipSignature=data.length>=4 && data[0]===80 && data[1]===75 &&
    (data[2]===3 && data[3]===4 || data[2]===5 && data[3]===6);
  if (ZIP_CONTAINER_TYPES.has(extension) || zipSignature) inspectZip(data,filename,0);
  else if (OTHER_CONTAINER_TYPES.has(extension)) uninspected.push({path:filename,reason:'other_archive_format'});
  return {
    schema:'commons.gmail-attachment-filename-review/v1',filename,bytes:data.length,
    source_url:GMAIL_ATTACHMENT_RULE_SOURCE,source_checked_on:GMAIL_ATTACHMENT_RULE_DATE,
    decision:findings.length ? 'GMAIL_FILENAME_OR_ENCRYPTION_MATCH'
      : uninspected.length ? 'ARCHIVE_REVIEW_INCOMPLETE' : 'NO_PUBLISHED_FILENAME_MATCH',
    entries_examined:entriesExamined,findings,uninspected_archives:uninspected,
    alternatives:['INLINE_PROPOSAL','ORDINARY_DOCUMENT_ATTACHMENTS','EXISTING_VERIFIED_SOURCE_LINK']
  };
}
function assertGmailAttachmentReviews(reviews) {
  const matched=reviews.filter(review=>review.findings.length);
  if (!matched.length) return;
  const details=matched.flatMap(review=>review.findings.map(finding=>finding.path+
    (finding.extension ? ' ('+finding.extension+')' : ' (encrypted archive member)')));
  const error=new Error('Gmail rejects these selected attachment contents: '+details.join(', ')+
    '. Send the proposal inline or select ordinary documents; deliver the unchanged complete project through its existing verified source link.');
  Object.assign(error,{code:'CONTACT_GMAIL_ATTACHMENT_POLICY_MATCH',status:422,
    gmail_attachment_reviews:reviews,source_url:GMAIL_ATTACHMENT_RULE_SOURCE});
  throw error;
}

function createConnectedContactAttachments({sha256Bytes, sha256Utf8} = {}) {
  if (typeof sha256Bytes !== 'function' || typeof sha256Utf8 !== 'function')
    throw new TypeError('Original connected SHA-256 exports required');
  function metadata(items) {
    if (!Array.isArray(items) || items.length > CONTACT_ATTACHMENT_COUNT)
      fail('CONTACT_FILE_SELECTION_INVALID');
    const ids = new Set(), names = new Set(); let total = 0;
    return items.map(item => {
      const extension = typeof item?.filename === 'string' ? item.filename.split('.').pop() : '';
      if (!item || typeof item.item_id !== 'string' || !item.item_id || item.item_id.length > 200 ||
          /[\x00-\x1f\x7f]/.test(item.item_id) || ids.has(item.item_id) ||
          typeof item.filename !== 'string' || item.filename.length > 240 || /[\\/\x00-\x1f\x7f"]/.test(item.filename) ||
          !Object.hasOwn(types, extension) || item.mime_type !== types[extension] || names.has(item.filename) ||
          !Number.isSafeInteger(item.bytes) || item.bytes < 1 || !/^[a-f0-9]{64}$/.test(item.sha256 ?? ''))
        fail('CONTACT_ATTACHMENT_MANIFEST_INVALID');
      ids.add(item.item_id); names.add(item.filename); total += item.bytes;
      if (total > CONTACT_ATTACHMENT_LIMIT_BYTES) fail('CONTACT_ATTACHMENTS_TOO_LARGE');
      return Object.freeze(Object.fromEntries(fields.map(key => [key, item[key]])));
    });
  }
  function prepare(input) {
    const attachments = metadata(input?.attachments ?? []), files = input?.attachment_data ?? [];
    if (!Array.isArray(files) || files.length !== attachments.length) fail('CONTACT_ATTACHMENT_RUNTIME_MISMATCH');
    const gmail_attachment_reviews = [];
    const attachment_data = attachments.map((item, index) => {
      const file = files[index];
      if (!file || fields.some(key => file[key] !== item[key]))
        fail('CONTACT_ATTACHMENT_RUNTIME_MISMATCH');
      const bytes = decodeBase64(file.base64_url_content, item.bytes), checked = sha256Bytes(bytes);
      if (checked.bytes !== item.bytes || checked.sha256 !== item.sha256)
        fail('CONTACT_ATTACHMENT_RUNTIME_MISMATCH');
      gmail_attachment_reviews.push(Object.freeze({...reviewGmailAttachment({filename:item.filename,data:bytes}),
        item_id:item.item_id,sha256:item.sha256}));
      return Object.freeze({...item, base64_url_content:encodeBase64Url(bytes)});
    });
    return Object.freeze({attachments:Object.freeze(attachments), attachment_data:Object.freeze(attachment_data),
      gmail_attachment_reviews:Object.freeze(gmail_attachment_reviews)});
  }
  function payload(prepared, textPart) {
    // Recheck retained input; a plain caller object cannot bypass prepare().
    const ready = prepare(prepared);
    if (!['text/plain', 'text/html'].includes(textPart?.mime_type) || textPart.charset !== 'UTF-8' ||
        typeof textPart.body?.content !== 'string' || textPart.parts)
      fail('CONTACT_REVIEWED_BODY_REQUIRED');
    sha256Utf8(textPart.body.content);
    const text = {mime_type:textPart.mime_type, charset:'UTF-8', body:{content:textPart.body.content}};
    return ready.attachments.length ? {mime_type:'multipart/mixed', parts:[text, ...ready.attachment_data.map(file => ({
      mime_type:file.mime_type, filename:file.filename, content_disposition:'attachment',
      body:{base64_url_content:file.base64_url_content}
    }))]} : text;
  }

  /**
   * Receive an already authored native MIME tree without rewriting its wire
   * representation. Attachment bytes use this module's existing decoders and
   * manifest checker; content hashes identify the original selected source.
   * A body may be one UTF-8 text part or the plain/HTML alternative pair.
   */
  function prepareNative(payload) {
    const sourceJson = JSON.stringify(payload);
    if (typeof sourceJson !== 'string' || sha256Utf8(sourceJson).bytes > RAW_LIMIT)
      fail('CONTACT_NATIVE_PAYLOAD_TOO_LARGE');
    const selected = JSON.parse(sourceJson);
    const freeze = value => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze); Object.freeze(value);
      }
      return value;
    };
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const only = (value, keys, code) => {
      if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(code);
    };
    const leafKeys = ['mime_type','charset','content_disposition','content_id','filename','body','parts'];
    const bodies = [], attachments = [], attachment_data = [], source_parts = [];
    let visited = 0;
    function inspect(part, path, role) {
      if (++visited > CONTACT_ATTACHMENT_COUNT + 4) fail('CONTACT_NATIVE_PART_LIMIT');
      only(part, leafKeys, 'CONTACT_NATIVE_PART_INVALID');
      if (typeof part.mime_type !== 'string' || part.mime_type !== part.mime_type.trim() ||
          !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(part.mime_type))
        fail('CONTACT_NATIVE_PART_INVALID');
      const type = mime(part.mime_type);
      if (part.content_id !== undefined && part.content_id !== null)
        fail('CONTACT_NATIVE_INLINE_RESOURCE_UNSUPPORTED');
      const filename = part.filename ?? null, disposition = part.content_disposition ?? null;
      if (role === 'attachment') {
        if (typeof filename !== 'string' || disposition !== 'attachment' ||
            part.parts !== undefined && part.parts !== null)
          fail('CONTACT_NATIVE_ATTACHMENT_INVALID');
        only(part.body, ['content','base64_url_content'], 'CONTACT_NATIVE_ATTACHMENT_BODY_INVALID');
        const hasText = typeof part.body.content === 'string';
        const hasBinary = typeof part.body.base64_url_content === 'string';
        if (hasText === hasBinary ||
            Object.entries(part.body).some(([key,value]) => value !== null &&
              typeof value !== 'string'))
          fail('CONTACT_NATIVE_ATTACHMENT_BODY_INVALID');
        let bytes, source_encoding;
        if (hasText) {
          if (!type.startsWith('text/') && type !== 'application/json')
            fail('CONTACT_NATIVE_ATTACHMENT_TEXT_TYPE_INVALID');
          if (typeof part.charset !== 'string' || part.charset.toLowerCase() !== 'utf-8' ||
              sha256Utf8(part.body.content).bytes > CONTACT_ATTACHMENT_LIMIT_BYTES)
            fail('CONTACT_NATIVE_ATTACHMENT_UTF8_REQUIRED');
          bytes = utf8Bytes(part.body.content, sha256Utf8);
          source_encoding = 'native-body.content-utf8';
        } else {
          if (part.charset !== undefined && part.charset !== null &&
              (typeof part.charset !== 'string' || part.charset.toLowerCase() !== 'utf-8'))
            fail('CONTACT_NATIVE_ATTACHMENT_CHARSET_INVALID');
          bytes = decodeBase64(part.body.base64_url_content, CONTACT_ATTACHMENT_LIMIT_BYTES);
          source_encoding = 'native-body.base64_url_content';
        }
        const checked = sha256Bytes(bytes);
        const item = {item_id:'native:' + path, filename, mime_type:type,
          bytes:checked.bytes, sha256:checked.sha256};
        attachments.push(item);
        attachment_data.push({...item, base64_url_content:encodeBase64Url(bytes)});
        source_parts.push({...item, part_path:path, source_encoding,
          native_part_sha256:sha256Utf8(JSON.stringify(part)).sha256});
        return;
      }
      if (filename || disposition && disposition !== 'inline')
        fail('CONTACT_NATIVE_BODY_DISPOSITION_INVALID');
      if (type === 'multipart/alternative' && role === 'body') {
        if (part.body !== undefined && part.body !== null ||
            !Array.isArray(part.parts) || part.parts.length !== 2)
          fail('CONTACT_NATIVE_ALTERNATIVE_INVALID');
        part.parts.forEach((child,index) => inspect(child, path + '.' + index, 'text'));
        if (bodies.length !== 2 || new Set(bodies.map(body => body.mime_type)).size !== 2)
          fail('CONTACT_NATIVE_ALTERNATIVE_INVALID');
        return;
      }
      if (!['text/plain','text/html'].includes(type) ||
          typeof part.charset !== 'string' || part.charset.toLowerCase() !== 'utf-8' ||
          part.parts !== undefined && part.parts !== null)
        fail('CONTACT_NATIVE_TEXT_PART_REQUIRED');
      only(part.body, ['content','base64_url_content'], 'CONTACT_NATIVE_TEXT_BODY_INVALID');
      if (typeof part.body.content !== 'string' ||
          part.body.base64_url_content !== undefined && part.body.base64_url_content !== null)
        fail('CONTACT_NATIVE_TEXT_BODY_INVALID');
      const checked = sha256Utf8(part.body.content);
      if (!checked.bytes || checked.bytes > 100000) fail('CONTACT_NATIVE_TEXT_BODY_INVALID');
      bodies.push({part_path:path, mime_type:type, charset:'UTF-8',
        content:part.body.content, bytes:checked.bytes, sha256:checked.sha256});
    }
    only(selected, leafKeys, 'CONTACT_NATIVE_PAYLOAD_INVALID');
    if (mime(selected.mime_type) === 'multipart/mixed') {
      if (selected.body !== undefined && selected.body !== null ||
          selected.filename || selected.content_disposition || selected.content_id ||
          !Array.isArray(selected.parts) || selected.parts.length < 2 ||
          selected.parts.length > CONTACT_ATTACHMENT_COUNT + 1)
        fail('CONTACT_NATIVE_MIXED_INVALID');
      inspect(selected.parts[0], '0.0', 'body');
      selected.parts.slice(1).forEach((part,index) => inspect(part, '0.' + (index+1), 'attachment'));
    } else inspect(selected, '0', 'body');
    if (!bodies.length || bodies.length > 2) fail('CONTACT_NATIVE_BODY_COUNT_INVALID');
    const prepared = prepare({attachments, attachment_data});
    return freeze({payload:selected, prepared, bodies, source_parts,
      native_payload_sha256:sha256Utf8(sourceJson).sha256,
      native_payload_bytes:sha256Utf8(sourceJson).bytes});
  }


  // Compare every original text alternative in its original container and order.
  // Header/recipient identity and attachment bytes are received by the caller.
  function receiveNativeBody(originalPayload, receivedPayload) {
    const selected = prepareNative(originalPayload);
    const hasFiles = selected.prepared.attachments.length > 0;
    const originalBody = hasFiles ? selected.payload.parts[0] : selected.payload;
    if (!receivedPayload || receivedPayload.filename ||
        receivedPayload.mime_type !== selected.payload.mime_type ||
        hasFiles && (!Array.isArray(receivedPayload.parts) ||
          receivedPayload.parts.length !== selected.prepared.attachments.length + 1))
      fail('CONTACT_NATIVE_RECEIVED_BODY_CHANGED');
    const body = hasFiles ? receivedPayload.parts[0] : receivedPayload;
    const alternative = originalBody.mime_type === 'multipart/alternative';
    if (!body || body.filename || body.mime_type !== originalBody.mime_type ||
        alternative && (!Array.isArray(body.parts) || body.parts.length !== selected.bodies.length) ||
        !alternative && body.parts?.length)
      fail('CONTACT_NATIVE_RECEIVED_BODY_CHANGED');
    const parts = alternative ? body.parts : [body];
    for (let index = 0; index < selected.bodies.length; index++) {
      const actual = parts[index], expected = selected.bodies[index];
      if (!actual || actual.filename || actual.parts?.length ||
          actual.mime_type !== expected.mime_type || actual.body?.content !== expected.content)
        fail('CONTACT_NATIVE_RECEIVED_BODY_CHANGED');
    }
    return {primary:parts[0], bodies:selected.bodies.map(({mime_type,content}) => ({
      mime_type, ...sha256Utf8(content)
    }))};
  }

  async function receive(input, rawFull, {readRaw} = {}) {
    const expected = metadata(input?.attachments ?? []), full = messageValue(rawFull);
    if (typeof full.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(full.id) || !full.payload)
      fail('CONTACT_SENT_MESSAGE_REQUIRED');
    const parts = []; let visited = 0;
    const walk = (part, path, depth = 0) => {
      if (!part || typeof part !== 'object' || depth > 12 || ++visited > 128)
        fail('CONTACT_SENT_MIME_INVALID');
      if (part.filename) parts.push({part, path});
      if (part.parts !== undefined && part.parts !== null && !Array.isArray(part.parts)) fail('CONTACT_SENT_MIME_INVALID');
      (part.parts ?? []).forEach((child, index) => walk(child, path + '.' + index, depth + 1));
    };
    walk(full.payload, '0');
    if (parts.length !== expected.length) fail('CONTACT_SENT_ATTACHMENT_COUNT_MISMATCH');
    let decodedRaw = null, rawHash = null;
    const receipts = [];
    for (const item of expected) {
      const matches = parts.filter(row => row.part.filename === item.filename);
      if (matches.length !== 1) fail('CONTACT_SENT_ATTACHMENT_MISMATCH');
      const {part, path} = matches[0], size = part.body?.size ?? part.body?.size_bytes;
      if (mime(part.mime_type ?? part.mimeType) !== item.mime_type ||
          (size !== undefined && Number(size) !== item.bytes))
        fail('CONTACT_SENT_ATTACHMENT_MISMATCH');
      let bytes = null, source = 'native-inline';
      if (typeof part.body?.base64_url_content === 'string')
        bytes = decodeBase64(part.body.base64_url_content, item.bytes);
      else if (typeof part.body?.data === 'string') bytes = decodeBase64(part.body.data, item.bytes);
      else if (typeof part.body?.content === 'string') {
        if (part.body.content.length > item.bytes) fail('CONTACT_SENT_ATTACHMENT_BYTES_MISMATCH');
        bytes = utf8Bytes(part.body.content, sha256Utf8);
      }
      if (!bytes) {
        if (!decodedRaw) {
          if (typeof readRaw !== 'function') fail('CONTACT_SENT_RAW_READER_REQUIRED');
          const raw = messageValue(await readRaw(full.id));
          if (raw.id !== full.id || typeof raw.raw !== 'string')
            fail('CONTACT_SENT_RAW_MESSAGE_CHANGED');
          const rawBytes = decodeBase64(raw.raw, RAW_LIMIT);
          rawHash = sha256Bytes(rawBytes).sha256;
          const original = byteString(rawBytes);
          const rawMessageId = headersAndBody(original).header('message-id');
          const originalIds = (full.payload.headers ?? []).filter(header => header.name?.toLowerCase() === 'message-id');
          if (originalIds.length !== 1 || !rawMessageId || rawMessageId !== originalIds[0].value)
            fail('CONTACT_SENT_RAW_MESSAGE_CHANGED');
          decodedRaw = rawLeaves(original, full.payload);
        }
        bytes = decodedRaw.get(path); source = 'native-raw';
      }
      if (!(bytes instanceof Uint8Array)) fail('CONTACT_SENT_ATTACHMENT_BYTES_REQUIRED');
      const checked = sha256Bytes(bytes);
      if (checked.bytes !== item.bytes || checked.sha256 !== item.sha256)
        fail('CONTACT_SENT_ATTACHMENT_BYTES_MISMATCH');
      const observedId = part.body?.attachment_id ?? part.body?.attachmentId;
      const attachmentId = typeof observedId === 'string' && observedId && !observedId.includes('...') &&
        !part.body?.attachment_id_truncated && !part.attachment_id_truncated ? observedId : null;
      receipts.push({...item, message_id:full.id, part_path:path, attachment_id:attachmentId,
        file_id:null, bytes_source:source, content_readback:true,
        verification:source === 'native-raw' ? 'native-raw-bytes' : 'native-inline-bytes',
        ...(source === 'native-raw' ? {base64_url_content:encodeBase64Url(bytes), raw_message_sha256:rawHash} : {})});
    }
    return {...full, contact_attachment_receipts:{
      schema:'commons.contact-attachment-receipts/v1', message_id:full.id, attachments:receipts
    }};
  }
  function review(input) { return prepare(input).gmail_attachment_reviews; }
  function assertGmailPayload(nativePayload) {
    const selected = prepareNative(nativePayload);
    assertGmailAttachmentReviews(selected.prepared.gmail_attachment_reviews);
    return selected.prepared.gmail_attachment_reviews;
  }
  return Object.freeze({prepare, prepareNative, receiveNativeBody, payload, receive, review, assertGmailPayload});
}

module.exports = {createConnectedContactAttachments, CONTACT_ATTACHMENT_LIMIT_BYTES, CONTACT_ATTACHMENT_COUNT,
  reviewGmailAttachment, assertGmailAttachmentReviews, GMAIL_ATTACHMENT_RULE_SOURCE, GMAIL_ATTACHMENT_RULE_DATE};
