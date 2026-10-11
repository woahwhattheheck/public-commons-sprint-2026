// MIT. Select the original SF30 public object description for the existing buyer.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {config, operation, need, InputError} from './config.mjs';

const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value > 0;

/** Shared original row selection for saved files and receiving applications.
 * The descriptor supplies product facts; the original buyer reviews payment. */
export function selectObjectDescriptionBytes(raw, {objectId, chunkBytes} = {}) {
  need(raw instanceof Uint8Array && raw.byteLength <= 8 * 1024 * 1024,
    'OBJECT_DESCRIPTION_BYTE_LIMIT');
  need(typeof objectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(objectId),
    'OBJECT_EXPLICIT_SELECTION_REQUIRED');
  let description;
  try { description = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { throw new InputError('OBJECT_DESCRIPTION_JSON_INVALID'); }
  need(object(description) && description.schema === 'stellar-forge.s3-description.v1' &&
    Array.isArray(description.objects), 'OBJECT_ORIGINAL_S3_DESCRIPTION_REQUIRED');
  const selected = description.objects.filter(value => object(value) && value.id === objectId);
  need(selected.length === 1, 'OBJECT_DESCRIPTION_SELECTION_NOT_UNIQUE');
  const item = selected[0];
  need(item.mode === 'chunks' && count(item.bytes) && count(item.maxBytes) &&
    item.maxBytes <= 1048576 && typeof item.snapshot === 'string' && HASH.test(item.snapshot),
    'OBJECT_DESCRIPTION_CHUNK_CONTRACT_INVALID');
  need(typeof item.path === 'string' && item.path.startsWith('/') &&
    typeof item.contentType === 'string' && item.contentType.length > 0 &&
    item.contentType.length <= 256 && !/[\r\n]/.test(item.contentType) &&
    typeof item.filename === 'string' && item.filename.length <= 120 &&
    /^[A-Za-z0-9][A-Za-z0-9_. -]*$/.test(item.filename) && !/[. ]$/.test(item.filename),
    'OBJECT_DESCRIPTION_DELIVERY_INVALID');
  need(item.expectedSha256 === undefined ||
    typeof item.expectedSha256 === 'string' && HASH.test(item.expectedSha256),
    'OBJECT_DESCRIPTION_DIGEST_INVALID');
  const requested = chunkBytes ?? item.maxBytes;
  need(count(requested) && requested <= item.maxBytes, 'OBJECT_DESCRIPTION_CHUNK_LIMIT');
  return {
    bytes:item.bytes, chunkBytes:requested, expectedSnapshot:item.snapshot,
    expectedSha256:item.expectedSha256 ?? null, expectedContentType:item.contentType,
    selection:{schema:'stellar-forge.sf88.object-selection.v1',
      descriptionSha256:createHash('sha256').update(raw).digest('hex'),
      objectId:item.id, filename:item.filename, path:item.path},
  };
}

/** Offline selection of one row from the merchant's ORIGINAL objects.json.
 * The original buyer still binds and reviews each actual query-bearing quote. */
export async function selectObjectDescription({descriptionPath, objectId, configPath, chunkBytes} = {}) {
  need(typeof descriptionPath === 'string' && isAbsolute(descriptionPath) &&
    !descriptionPath.includes('\0'), 'OBJECT_DESCRIPTION_ABSOLUTE_PATH_REQUIRED');
  const handle = await open(descriptionPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let raw;
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size <= 8 * 1024 * 1024, 'OBJECT_DESCRIPTION_FILE_INVALID');
    raw = await handle.readFile();
  } finally { await handle.close(); }
  const selected = selectObjectDescriptionBytes(raw, {objectId, chunkBytes});
  const source = await config(configPath), op = operation(source.operation), url = new URL(op.url);
  need(op.method === 'GET' && !url.search && url.pathname === selected.selection.path,
    'OBJECT_DESCRIPTION_BUYER_ROUTE_MISMATCH');
  return selected;
}
