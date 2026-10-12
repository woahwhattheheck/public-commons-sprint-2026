// MIT. Verify the actual native MEF archive before retaining it as a recovery payload.
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseXml, xmlChildren, xmlText } from './native.mjs';
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function pathName(bytes, flags) {
  need((flags & 1) === 0 && ((flags & 0x800) !== 0 || bytes.every(value => value < 128)), 'CATALOGUE_ZIP_NAME_ENCODING');
  const name = utf8.decode(bytes);
  need(name.length > 0 && name.length <= 2048 && !name.startsWith('/') &&
    !name.includes('\\') && !name.includes('\0') &&
    name.replace(/\/$/, '').split('/').every(part => part && part !== '.' && part !== '..') &&
    !/^[A-Za-z]:/.test(name), 'CATALOGUE_ZIP_PATH_INVALID');
  return name;
}
/** ZIP64 descriptors have a different width even when their file sizes are small. */
function checkExtra(bytes) {
  let at = 0;
  while (at < bytes.length) {
    need(at + 4 <= bytes.length, 'CATALOGUE_ZIP_EXTRA_INVALID');
    const kind = bytes.readUInt16LE(at), size = bytes.readUInt16LE(at + 2);
    need(at + 4 + size <= bytes.length, 'CATALOGUE_ZIP_EXTRA_INVALID');
    need(kind !== 1, 'CATALOGUE_ZIP64_OR_SPLIT_UNSUPPORTED');
    at += 4 + size;
  }
}
/** Single-disk ZIP, stored or DEFLATE entries, bounded by the selected native archive limit. */
export function inspectZip(value, { maxBytes = 268435456, maxExpandedBytes = 1073741824,
  maxFiles = 100000, maxFileBytes = 268435456 } = {}) {
  const bytes = Buffer.from(value);
  need(bytes.length >= 22 && bytes.length <= maxBytes, 'CATALOGUE_ZIP_SIZE_INVALID');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--)
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  need(end >= 0 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0,
    'CATALOGUE_ZIP_DIRECTORY_INVALID');
  const entries = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12),
    centralOffset = bytes.readUInt32LE(end + 16);
  need(entries === bytes.readUInt16LE(end + 8) && entries !== 0xffff &&
    centralSize !== 0xffffffff && centralOffset !== 0xffffffff && entries <= maxFiles &&
    centralOffset + centralSize === end, 'CATALOGUE_ZIP64_OR_SPLIT_UNSUPPORTED');
  const files = [], directories = [], names = new Set(), rows = []; let at = centralOffset, expanded = 0;
  for (let index = 0; index < entries; index++) {
    need(at + 46 <= end && bytes.readUInt32LE(at) === 0x02014b50, 'CATALOGUE_ZIP_ENTRY_INVALID');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10),
      crc = bytes.readUInt32LE(at + 16), compressed = bytes.readUInt32LE(at + 20),
      size = bytes.readUInt32LE(at + 24), nameSize = bytes.readUInt16LE(at + 28),
      extraSize = bytes.readUInt16LE(at + 30), commentSize = bytes.readUInt16LE(at + 32),
      disk = bytes.readUInt16LE(at + 34), external = bytes.readUInt32LE(at + 38),
      offset = bytes.readUInt32LE(at + 42);
    need(at + 46 + nameSize + extraSize + commentSize <= end && [0, 8].includes(method) &&
      disk === 0 && (flags & 1) === 0 && size <= maxFileBytes && size !== 0xffffffff &&
      compressed !== 0xffffffff && offset !== 0xffffffff, 'CATALOGUE_ZIP_ENTRY_UNSUPPORTED');
    const rawName = bytes.subarray(at + 46, at + 46 + nameSize), name = pathName(rawName, flags);
    need(!names.has(name), 'CATALOGUE_ZIP_DUPLICATE_PATH'); names.add(name);
    const unixType = (external >>> 16) & 0xf000;
    need(unixType !== 0xa000 && (!unixType || unixType === 0x8000 || unixType === 0x4000),
      'CATALOGUE_ZIP_SPECIAL_FILE');
    checkExtra(bytes.subarray(at + 46 + nameSize, at + 46 + nameSize + extraSize));
    need(offset + 30 <= centralOffset && bytes.readUInt32LE(offset) === 0x04034b50 &&
      bytes.readUInt16LE(offset + 6) === flags && bytes.readUInt16LE(offset + 8) === method,
      'CATALOGUE_ZIP_LOCAL_HEADER_CHANGED');
    const localCrc = bytes.readUInt32LE(offset + 14), localCompressed = bytes.readUInt32LE(offset + 18),
      localSize = bytes.readUInt32LE(offset + 22), localNameSize = bytes.readUInt16LE(offset + 26),
      localExtraSize = bytes.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameSize + localExtraSize, dataEnd = dataStart + compressed;
    need(dataStart <= centralOffset && dataEnd <= centralOffset, 'CATALOGUE_ZIP_OVERLAPPING_ENTRY');
    need(localNameSize === nameSize &&
      bytes.subarray(offset + 30, offset + 30 + localNameSize).equals(rawName), 'CATALOGUE_ZIP_LOCAL_NAME_CHANGED');
    checkExtra(bytes.subarray(offset + 30 + localNameSize, dataStart));
    // A streamed local header may retain zeros or the final values, never conflicting values.
    need((flags & 8) ? (localCrc === 0 || localCrc === crc) &&
      (localCompressed === 0 || localCompressed === compressed) && (localSize === 0 || localSize === size) :
      localCrc === crc && localCompressed === compressed && localSize === size,
      'CATALOGUE_ZIP_LOCAL_CONTENT_CHANGED');
    expanded += size; need(expanded <= maxExpandedBytes, 'CATALOGUE_ZIP_EXPANDED_LIMIT');
    rows.push({ name, flags, method, crc, compressed, size, offset, dataStart, dataEnd });
    at += 46 + nameSize + extraSize + commentSize;
  }
  need(at === end, 'CATALOGUE_ZIP_DIRECTORY_CHANGED');
  // Central-directory order need not match local-header order. Check complete physical spans
  // before inflating any entry, including the descriptor when general-purpose bit 3 is set.
  const ordered = [...rows].sort((left, right) => left.offset - right.offset);
  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index], next = ordered[index + 1]?.offset ?? centralOffset;
    need(row.offset < next && row.dataEnd <= next, 'CATALOGUE_ZIP_OVERLAPPING_ENTRY');
    if (row.flags & 8) {
      const matches = at => at + 12 <= next && bytes.readUInt32LE(at) === row.crc &&
        bytes.readUInt32LE(at + 4) === row.compressed && bytes.readUInt32LE(at + 8) === row.size;
      const candidates = [];
      if (matches(row.dataEnd)) candidates.push(row.dataEnd + 12);
      if (row.dataEnd + 16 <= next && bytes.readUInt32LE(row.dataEnd) === 0x08074b50 &&
        matches(row.dataEnd + 4)) candidates.push(row.dataEnd + 16);
      // The CRC can itself equal the optional signature; validate whole candidates.
      need(candidates.length === 1, 'CATALOGUE_ZIP_DESCRIPTOR_INVALID');
    }
  }
  const fileNames = new Set(rows.filter(row => !row.name.endsWith('/')).map(row => row.name));
  for (const row of rows) {
    const parts = row.name.replace(/\/$/, '').split('/');
    if (row.name.endsWith('/')) need(!fileNames.has(parts.join('/')), 'CATALOGUE_ZIP_PATH_CONFLICT');
    for (let count = 1; count < parts.length; count++)
      need(!fileNames.has(parts.slice(0, count).join('/')), 'CATALOGUE_ZIP_PATH_CONFLICT');
    let data;
    try { data = row.method === 0 ? bytes.subarray(row.dataStart, row.dataEnd) :
      inflateRawSync(bytes.subarray(row.dataStart, row.dataEnd), { maxOutputLength: Math.max(1, maxFileBytes) }); }
    catch { need(false, 'CATALOGUE_ZIP_DEFLATE_INVALID'); }
    need(data.length === row.size && crc32(data) === row.crc, 'CATALOGUE_ZIP_CONTENT_CHANGED');
    if (row.name.endsWith('/')) {
      need(row.size === 0, 'CATALOGUE_ZIP_DIRECTORY_CONTENT');
      directories.push(row.name);
    } else files.push({ path: row.name, bytes: row.size, sha256: digest(data), data: Buffer.from(data) });
  }
  return { bytes: bytes.length, sha256: digest(bytes), expandedBytes: expanded, files, directories };
}

function infoUuid(xml) {
  const { root } = parseXml(xml);
  need(root.localName === 'info' && root.namespaceURI === '', 'CATALOGUE_MEF_INFO_INVALID');
  const generals = xmlChildren(root, 'general').filter(node => node.namespaceURI === '');
  need(generals.length === 1, 'CATALOGUE_MEF_UUID_REQUIRED');
  const uuids = xmlChildren(generals[0], 'uuid').filter(node => node.namespaceURI === '');
  need(uuids.length === 1 && xmlChildren(uuids[0]).length === 0, 'CATALOGUE_MEF_UUID_REQUIRED');
  const value = xmlText(uuids[0]);
  need(value.length > 0, 'CATALOGUE_MEF_UUID_REQUIRED');
  return value; // parseXml already decoded entities once; CDATA remains literal.
}
/** Native attachment names/sizes are compared; the archive supplies the actual byte hashes. */
export function inspectMef(value, { records, ...limits } = {}) {
  need(Array.isArray(records) && records.length > 0 && records.every(record =>
    typeof record?.uuid === 'string' && record.uuid.length > 0 && record.uuid.length <= 1024 &&
    !/[\/\\\0]/.test(record.uuid) && record.uuid !== '.' && record.uuid !== '..') &&
    new Set(records.map(record => record.uuid)).size === records.length, 'CATALOGUE_MEF_RECORD_SELECTION_REQUIRED');
  const zip = inspectZip(value, limits), members = new Map(zip.files.map(file => [file.path, file]));
  const selected = new Set(records.map(record => record.uuid)), inventory = [];
  // The native ZIP filesystem visitor visits every top-level directory, including empty
  // directories. Only its two root index files may live outside selected record roots.
  for (const path of [...zip.files.map(file => file.path), ...zip.directories]) {
    const slash = path.indexOf('/');
    need(slash < 0 ? path === 'index.csv' || path === 'index.html' : selected.has(path.slice(0, slash)),
      'CATALOGUE_MEF_UNSELECTED_MEMBER');
  }
  need([...selected].every(uuid => members.has(uuid + '/metadata/metadata.xml')), 'CATALOGUE_MEF_RECORDS_INCOMPLETE');
  for (const record of records) {
    const uuid = record.uuid, metadata = members.get(uuid + '/metadata/metadata.xml'),
      info = members.get(uuid + '/info.xml');
    need(metadata && info && infoUuid(utf8.decode(info.data)) === uuid, 'CATALOGUE_MEF_RECORD_BINDING_CHANGED');
    parseXml(utf8.decode(metadata.data));
    const attachments = zip.files.filter(file =>
      file.path.startsWith(uuid + '/public/') || file.path.startsWith(uuid + '/private/'));
    const expected = Array.isArray(record.attachments) ? record.attachments : [];
    const expectedPaths = new Set();
    for (const entry of expected) {
      const visibility = String(entry.visibility).toLowerCase();
      need(['public', 'private'].includes(visibility) && typeof entry.filename === 'string' &&
        entry.filename.length && !entry.filename.includes('\\') && !entry.filename.startsWith('/') &&
        entry.filename.split('/').every(part => part && part !== '.' && part !== '..'),
        'CATALOGUE_MEF_ATTACHMENT_DESCRIPTOR_INVALID');
      const path = uuid + '/' + visibility + '/' + entry.filename;
      need(!expectedPaths.has(path), 'CATALOGUE_MEF_ATTACHMENT_DESCRIPTOR_REPEATED'); expectedPaths.add(path);
      const file = members.get(path);
      need(file && Number.isSafeInteger(entry.size) && entry.size >= 0 && file.bytes === entry.size,
        'CATALOGUE_MEF_ATTACHMENT_MISSING');
    }
    if (record.attachmentInventoryComplete === true)
      need(attachments.length === expectedPaths.size && attachments.every(file => expectedPaths.has(file.path)),
        'CATALOGUE_MEF_ATTACHMENT_INVENTORY_CHANGED');
    inventory.push({ uuid, metadata: { path: metadata.path, bytes: metadata.bytes, sha256: metadata.sha256 },
      info: { path: info.path, bytes: info.bytes, sha256: info.sha256 },
      attachments: attachments.map(({ data, ...file }) => file),
      attachmentInventoryComplete: record.attachmentInventoryComplete === true });
  }
  return { bytes: zip.bytes, sha256: zip.sha256, expandedBytes: zip.expandedBytes,
    records: inventory, recordCount: inventory.length, files: zip.files.map(({ data, ...file }) => file),
    completeSelectedRecords: true,
    completeNativeAttachments: inventory.every(record => record.attachmentInventoryComplete),
    externalLinkedAssetsIncluded: false };
}
