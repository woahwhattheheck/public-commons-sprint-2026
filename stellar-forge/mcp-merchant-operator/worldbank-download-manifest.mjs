// MIT. Transport metadata for the unchanged original World Bank handover.
import { createHash } from 'node:crypto';
export const WORLDBANK_DOWNLOAD_MANIFEST = 'worldbank-download.json';
export const WORLDBANK_DOWNLOAD_SCHEMA = 'stellar-forge.worldbank-mcp-download.v1';
export const WORLDBANK_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const worldbankId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value))
    throw Object.assign(new Error('Use the original 1–96 character World Bank record ID.'), { code: 'WORLDBANK_ID' });
  return value;
};
const hash = /^[a-f0-9]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = () => Object.assign(new Error('The selected original World Bank export manifest is invalid.'), { code: 'WORLDBANK_DOWNLOAD_MANIFEST_INVALID' });
export function parseWorldBankDownloadManifest(bytes, exportId, workspace) {
  worldbankId(exportId);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
  if (bytes.length > 65000 || value?.schema !== WORLDBANK_DOWNLOAD_SCHEMA || value.exportId !== exportId ||
      typeof value.workspace !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.workspace) ||
      workspace !== undefined && value.workspace !== workspace ||
      !hash.test(value.sourceManifestSha256) || !hash.test(value.captureSha256) ||
      typeof value.reviewId !== 'string' || !Number.isSafeInteger(value.reviewRevision) || value.reviewRevision < 1 ||
      !Number.isSafeInteger(value.observations) || value.observations < 0 ||
      !Array.isArray(value.files) || value.files.length !== 6)
    throw invalid();
  worldbankId(value.reviewId);
  const expected = new Set(['dataset.csv','dataset.json','review.json','selection.json','source.json','handover.zip']);
  for (const file of value.files) {
    if (!expected.delete(file?.name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        file.bytes > WORLDBANK_MAX_FILE_BYTES || !hash.test(file.sha256)) throw invalid();
  }
  if (expected.size) throw invalid();
  return value;
}
export function worldbankDownloadManifest(workspace, retained) {
  const original = retained?.manifest;
  if (original?.schema !== 'stellar-forge.worldbank-export-manifest.v1' || original.id !== retained.id ||
      !Array.isArray(original.files)) throw invalid();
  // The archive already contains every nested source page. Keep its original
  // bytes and expose the five original root inputs beside it for direct use.
  const names = ['dataset.csv','dataset.json','review.json','selection.json','source.json','handover.zip'];
  const files = names.map(name => {
    const selected = original.files.filter(file => file.path === name);
    if (selected.length !== 1) throw invalid();
    return { name, bytes: selected[0].bytes, sha256: selected[0].sha256 };
  }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const value = { schema: WORLDBANK_DOWNLOAD_SCHEMA, workspace, exportId: retained.id,
    sourceManifestSha256: retained.manifestSha256, captureSha256: original.captureSha256,
    reviewId: original.reviewId, reviewRevision: original.reviewRevision,
    observations: original.observations, files };
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  parseWorldBankDownloadManifest(bytes, retained.id, workspace);
  return { value, bytes, sha256: sha(bytes), file: { name: WORLDBANK_DOWNLOAD_MANIFEST, bytes: bytes.length, sha256: sha(bytes) } };
}
