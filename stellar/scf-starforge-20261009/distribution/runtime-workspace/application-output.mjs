// MIT. Shared retained-output bytes; source adapters authorize the original saved identity and file.
import { constants } from 'node:fs';
import { open, lstat, realpath, link, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { applicationOperation } from './applications-core.mjs';
import { need, plain, digest, absolute } from './storage.mjs';

export const OUTPUT_PAGE_BYTES = 65536;
export const OUTPUT_MAX_PAGE_BYTES = 262144;
const SCHEMA = 'stellar-forge.application-output-selection.v1';
const code = (source, suffix) => (source.errorPrefix ?? 'APPLICATION_OUTPUT') + '_' + suffix;
const hashPattern = /^[a-f0-9]{64}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const changed = source => need(false, code(source, 'CHANGED'),
  'The selected original output was replaced or shortened. Open its current output as a new selection.', 409);
function decodeSelection(value, source) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
    /^[A-Za-z0-9_-]+$/.test(value), code(source, 'SELECTION_INVALID'));
  let selected;
  try { selected = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { need(false, code(source, 'SELECTION_INVALID')); }
  need(plain(selected) && selected.schema === source.schema &&
    Object.keys(selected).every(key => ['schema', ...Object.keys(source.identity), 'sourceId', 'endOffset', 'guardSha256'].includes(key)) &&
    hashPattern.test(selected.sourceId ?? '') && hashPattern.test(selected.guardSha256 ?? '') &&
    integer(selected.endOffset), code(source, 'SELECTION_INVALID'));
  return selected;
}
async function readRange(handle, offset, bytes, source) {
  const value = Buffer.alloc(bytes); let count = 0;
  while (count < bytes) {
    const read = await handle.read(value, count, bytes - count, offset + count);
    if (!read.bytesRead) changed(source);
    count += read.bytesRead;
  }
  return value;
}
const sourceIdentity = (identity, info) => digest(JSON.stringify({
  ...identity,
  dev: String(info.dev), ino: String(info.ino), birthtimeNs: String(info.birthtimeNs),
}));
async function inspect(file) {
  const [info, named] = await Promise.all([file.handle.stat({ bigint: true }), lstat(file.path, { bigint: true })]);
  need(info.isFile() && named.isFile() && !named.isSymbolicLink(), code(file.source, 'FILE_INVALID'));
  if (info.dev !== named.dev || info.ino !== named.ino ||
    sourceIdentity(file.source.identity, info) !== file.sourceId || info.size < BigInt(file.selected.endOffset)) changed(file.source);
  need(info.size <= BigInt(Number.MAX_SAFE_INTEGER), code(file.source, 'SIZE_INVALID'));
  return Number(info.size);
}
async function guard(handle, endOffset, source) {
  const size = Math.min(4096, endOffset), tail = Math.max(size, endOffset - 4096);
  const headBytes = await readRange(handle, 0, size, source);
  const tailBytes = await readRange(handle, tail, endOffset - tail, source);
  return createHash('sha256').update(String(endOffset) + '\n').update(headBytes).update(tailBytes).digest('hex');
}
async function validateFile(file) {
  const totalBytes = await inspect(file);
  if (await guard(file.handle, file.selected.endOffset, file.source) !== file.selected.guardSha256) changed(file.source);
  return totalBytes;
}
async function applicationSource(root, input) {
  need(plain(input) && Object.keys(input).every(key =>
    ['applicationId', 'operationId', 'selection', 'offset', 'limit'].includes(key)), 'APPLICATION_OUTPUT_FIELDS_INVALID');
  await applicationOperation(root, input);
  return { path: join(root, 'operations', input.operationId, 'worker.log'),
    identity: { applicationId: input.applicationId, operationId: input.operationId },
    schema: SCHEMA, pageSchema: 'stellar-forge.application-output-page.v1',
    filename: 'application-' + input.applicationId + '-' + input.operationId + '.log' };
}
async function openSelected(source, input) {
  const path = source.path, handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat({ bigint: true });
    need(info.isFile() && info.size <= BigInt(Number.MAX_SAFE_INTEGER), code(source, 'FILE_INVALID'));
    const sourceId = sourceIdentity(source.identity, info);
    const selected = input.selection === undefined ? {
      schema: source.schema, ...source.identity,
      sourceId, endOffset: Number(info.size), guardSha256: await guard(handle, Number(info.size), source),
    } : decodeSelection(input.selection, source);
    need(Object.entries(source.identity).every(([key, value]) => selected[key] === value),
      code(source, 'SELECTION_MISMATCH'), 'Open the selected original output source.', 409);
    if (selected.sourceId !== sourceId) changed(source);
    const file = { handle, path, source, sourceId, selected,
      selection: Buffer.from(JSON.stringify(selected)).toString('base64url') };
    file.totalBytes = await validateFile(file);
    return file;
  } catch (error) { await handle.close(); throw error; }
}
const continuation = byte => (byte & 0xc0) === 0x80;
// Page edges expand by at most three bytes to avoid cutting a complete UTF-8
// sequence. An arbitrary byte jump may overlap its previous codepoint. The
// returned nextOffset is always the correct beginning of the following page.
export function outputTextRange(bytes, base, offset, wantedEnd, selectedEnd) {
  let start = offset - base;
  for (let n = 0; start > 0 && start < bytes.length && continuation(bytes[start]) && n < 3; n++) start--;
  let end = wantedEnd - base;
  for (let n = 0; base + end < selectedEnd && end < bytes.length && continuation(bytes[end]) && n < 3; n++) end++;
  return { offset: base + start, nextOffset: base + end, text: bytes.subarray(start, end).toString('utf8') };
}
export async function readApplicationOutputPage(root, input = {}) {
  return readRetainedOutputPage(await applicationSource(root, input), input);
}
// source is resolved by a native adapter; it is never accepted from an HTTP caller.
export async function readRetainedOutputPage(source, input = {}) {
  need(plain(input), code(source, 'FIELDS_INVALID'));
  const limit = input.limit === undefined ? OUTPUT_PAGE_BYTES : input.limit;
  need(Number.isSafeInteger(limit) && limit >= 4 && limit <= OUTPUT_MAX_PAGE_BYTES, code(source, 'PAGE_INVALID'));
  need(input.offset === undefined || integer(input.offset), code(source, 'OFFSET_INVALID'));
  const file = await openSelected(source, input);
  try {
    const endOffset = file.selected.endOffset;
    const offset = input.offset === undefined ? Math.max(0, endOffset - limit) : input.offset;
    need(offset <= endOffset, code(source, 'OFFSET_INVALID'));
    const wantedEnd = Math.min(endOffset, offset + limit), base = Math.max(0, offset - 3);
    const raw = await readRange(file.handle, base, Math.min(endOffset, wantedEnd + 3) - base, source);
    const page = outputTextRange(raw, base, offset, wantedEnd, endOffset);
    const totalBytes = await validateFile(file);
    return { schema: source.pageSchema, ...source.identity, sourceId: file.sourceId,
      selection: file.selection, endOffset, totalBytes, appendedBytes: totalBytes - endOffset,
      requestedOffset: offset, limit, ...page, bytes: page.nextOffset - page.offset,
      hasPrevious: page.offset > 0, hasNext: page.nextOffset < endOffset,
      encoding: 'utf-8', filename: source.filename };
  } finally { await file.handle.close(); }
}
export async function openApplicationOutputDownload(root, input = {}) {
  return openRetainedOutputDownload(await applicationSource(root, input), input);
}
export async function openRetainedOutputDownload(source, input = {}) {
  need(plain(input), code(source, 'FIELDS_INVALID'));
  need(input.offset === undefined && input.limit === undefined, code(source, 'DOWNLOAD_RANGE_INVALID'));
  const file = await openSelected(source, input);
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await file.handle.close(); } };
  async function* chunks() {
    try {
      let offset = 0;
      while (offset < file.selected.endOffset) {
        const size = Math.min(OUTPUT_PAGE_BYTES, file.selected.endOffset - offset);
        const bytes = await readRange(file.handle, offset, size, source);
        offset += bytes.length;
        // Check before the final advertised bytes can complete an HTTP download.
        if (offset === file.selected.endOffset) await validateFile(file);
        yield bytes;
      }
      await validateFile(file);
    } finally { await close(); }
  }
  const stream = Readable.from(chunks());
  // A prepared download may be inspected and closed before consumption.
  return { stream, close, bytes: file.selected.endOffset, sourceId: file.sourceId,
    selection: file.selection, ...source.identity,
    filename: source.filename, identity: { ...source.identity },
    type: 'application/octet-stream' };
}
export async function writeApplicationOutputDownload(download, output) {
  let temporary, targetHandle;
  const sha256 = createHash('sha256');
  try {
    const path = absolute(output);
    need(await realpath(dirname(path)) === dirname(path), 'APPLICATION_OUTPUT_REAL_PARENT_REQUIRED');
    temporary = join(dirname(path), '.' + basename(path) + '.' + randomUUID() + '.part');
    targetHandle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    async function* counted() {
      for await (const bytes of download.stream) { sha256.update(bytes); yield bytes; }
    }
    await pipeline(Readable.from(counted()), targetHandle.createWriteStream({ autoClose: false }));
    await targetHandle.sync(); await targetHandle.close(); targetHandle = null;
    await link(temporary, path); // Never overwrite an existing operator file.
    return { ...(download.identity ?? { applicationId: download.applicationId, operationId: download.operationId }),
      sourceId: download.sourceId, selection: download.selection, output: path,
      bytes: download.bytes, sha256: sha256.digest('hex') };
  } finally {
    download.stream.destroy(); await download.close();
    if (targetHandle) await targetHandle.close();
    if (temporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
