// MIT — Bounded saved catalog/body inputs for the original request-plan editor.
import { fields, need, stableJson } from './plan.mjs';
export const INPUT_UPLOAD_SCHEMA = 'stellar-forge.sf88.collection-input-upload.v1';
export const INPUT_CHUNK_BYTES = 1024 * 1024;
export const INPUT_LIMITS = Object.freeze({ catalog: 1024 * 1024, body: 16 * 1024 * 1024 });
const HASH = /^[a-f0-9]{64}$/;
export function inputId(value) {
  need(typeof value === 'string' && HASH.test(value), 'COLLECTION_INPUT_ID_INVALID');
  return value;
}
export function validateInputManifest(value) {
  fields(value, ['schema','kind','name','bytes','chunkSha256'], 'COLLECTION_INPUT_MANIFEST_INVALID');
  need(value.schema === INPUT_UPLOAD_SCHEMA && Object.hasOwn(INPUT_LIMITS, value.kind),
    'COLLECTION_INPUT_MANIFEST_INVALID');
  need(typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 180
    && !/[\u0000-\u001f\u007f]/.test(value.name), 'COLLECTION_INPUT_NAME_INVALID');
  need(Number.isSafeInteger(value.bytes) && value.bytes >= (value.kind === 'catalog' ? 1 : 0)
    && value.bytes <= INPUT_LIMITS[value.kind], 'COLLECTION_INPUT_SIZE_INVALID');
  need(Array.isArray(value.chunkSha256)
    && value.chunkSha256.length === Math.ceil(value.bytes / INPUT_CHUNK_BYTES)
    && value.chunkSha256.every(item => typeof item === 'string' && HASH.test(item)),
    'COLLECTION_INPUT_CHUNKS_INVALID');
  return {schema:INPUT_UPLOAD_SCHEMA,kind:value.kind,name:value.name,bytes:value.bytes,
    chunkSha256:[...value.chunkSha256]};
}
/** SHA-256 the UTF-8 bytes of this exact string to obtain the upload identity. */
export function inputManifestJson(value) {
  return stableJson(validateInputManifest(value)) + '\n';
}
export function inputChunkLength(manifest, index) {
  need(Number.isSafeInteger(index) && index >= 0 && index < manifest.chunkSha256.length,
    'COLLECTION_INPUT_CHUNK_INDEX_INVALID');
  return Math.min(INPUT_CHUNK_BYTES, manifest.bytes - index * INPUT_CHUNK_BYTES);
}
