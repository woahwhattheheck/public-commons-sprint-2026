// MIT. Complete first-party notice evidence for an explicitly derived one-row CSV.
import { canonical, failure, plain, sha256, text, timestamp, safeURL } from './core.mjs';
export const DERIVED_SOURCE_KIND = 'derived-notice-utf8-csv';
export const DERIVATION_SCHEMA = 'starforge.canadabuys.notice-derivation.v1';
export const SOURCE_WORKSPACE_SCHEMA = 'starforge.canadabuys.workspace.v3';
export const SOURCE_PACKAGE_SCHEMA = 'starforge.canadabuys.package.v3';
const invalid = message => { throw failure('SOURCE_PROVENANCE_INVALID', message, 422); };
const required = (value, name, max = 32768) => {
  const result = text(value, name, max);
  if (!result.trim()) invalid(name + ' must be explicit.');
  return result;
};
function keys(value, allowed, name) {
  if (!plain(value)) invalid(name + ' must be a complete object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(name + ' has an unsupported field: ' + key);
}
function originalBytes(original) {
  keys(original, ['url','retrievedAt','mediaType','encoding','bytes','sha256','bodyBase64','response'], 'derivation.original');
  if (!safeURL(original.url) || original.mediaType !== 'text/html' || original.encoding !== 'base64' ||
      !Number.isSafeInteger(original.bytes) || original.bytes < 1 || original.bytes > 8 * 1024 * 1024 ||
      typeof original.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(original.sha256) ||
      typeof original.bodyBase64 !== 'string' || original.bodyBase64.length > 12 * 1024 * 1024)
    invalid('Retain one complete HTTP(S) HTML capture within 8 MiB, with its exact original bytes and SHA256.');
  const bytes = Buffer.from(original.bodyBase64, 'base64');
  if (bytes.length !== original.bytes || bytes.toString('base64') !== original.bodyBase64 || sha256(bytes) !== original.sha256)
    invalid('The complete original HTML bytes differ from their descriptor.');
  // Byte spans are UTF-8 spans, never offsets into a rendered page or decoded entities.
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { invalid('This derived notice path requires an original UTF-8 HTML response.'); }
  if (typeof original.retrievedAt !== 'string') invalid('The original capture needs its explicit retrieval timestamp.');
  timestamp(original.retrievedAt, 'original.retrievedAt');
  if (original.response !== null && !plain(original.response)) invalid('Retain response metadata as an object or explicit null.');
  return bytes;
}
/** Original CSV defaults and source IDs remain byte-for-byte compatible. */
export function sourceProvenance(meta, parsed, stream, csvSha256) {
  const kind = meta.bodyKind === undefined ? 'original-utf8-csv' : meta.bodyKind;
  if (kind === 'original-utf8-csv') {
    if (meta.derivation !== undefined || meta.derivationSha256 !== undefined ||
        meta.coverage !== undefined && meta.coverage !== 'federal')
      invalid('A separately derived notice needs its explicit derived bodyKind and single-notice coverage.');
    return { id: 'source-' + sha256(stream + '\n' + csvSha256),
      metadata: { coverage: 'federal', bodyKind: 'original-utf8-csv' } };
  }
  if (kind !== DERIVED_SOURCE_KIND || stream !== 'complete-tenders' ||
      meta.coverage !== 'single-notice' || parsed.rows.length !== 1)
    invalid('A separately derived notice must be exactly one complete-tenders row with single-notice coverage.');
  const d = meta.derivation;
  keys(d, ['schema','method','createdAt','author','jurisdiction','note','original','fields'], 'derivation');
  if (d.schema !== DERIVATION_SCHEMA || d.method !== 'manual-field-map')
    invalid('Select the complete versioned manual field mapping.');
  if (typeof d.createdAt !== 'string') invalid('The manual mapping needs its explicit creation timestamp.');
  timestamp(d.createdAt, 'derivation.createdAt');
  required(d.author, 'derivation.author', 1024);
  required(d.jurisdiction, 'derivation.jurisdiction', 2048);
  required(d.note, 'derivation.note', 65536);
  const bytes = originalBytes(d.original);
  if (meta.url !== d.original.url || meta.retrievedAt === undefined ||
      timestamp(meta.retrievedAt) !== timestamp(d.original.retrievedAt))
    invalid('The selected source URL and retrieval time must bind the same complete HTML capture.');
  if (!Array.isArray(d.fields) || d.fields.length !== parsed.columns.length)
    invalid('Map every derived CSV column exactly once, including unknown blanks.');
  const row = parsed.rows[0].row, seen = new Set();
  for (const field of d.fields) {
    keys(field, ['column','value','status','fragments','note'], 'derivation.fields entry');
    if (!parsed.columns.includes(field.column) || seen.has(field.column) ||
        typeof field.value !== 'string' || field.value !== row[field.column])
      invalid('A mapping must identify one exact original CSV column and its complete value.');
    seen.add(field.column);
    if (!['observed','normalized','unknown'].includes(field.status) ||
        !Array.isArray(field.fragments) || field.fragments.length > 32)
      invalid('Each field needs an explicit observed, normalized or unknown status and bounded original spans.');
    text(field.note, 'field note', 65536);
    if (field.status === 'unknown') {
      if (field.value !== '' || field.fragments.length || !field.note.trim())
        invalid('Unknown fields must remain blank, with no asserted source span and an explicit reason.');
      continue;
    }
    if (!field.value.trim() || !field.fragments.length || field.status === 'normalized' && !field.note.trim())
      invalid('A nonblank field needs original evidence; a normalized field also needs its transformation note.');
    const fragments = [];
    for (const fragment of field.fragments) {
      keys(fragment, ['startByte','endByte','sha256'], 'original fragment');
      if (!Number.isSafeInteger(fragment.startByte) || !Number.isSafeInteger(fragment.endByte) ||
          fragment.startByte < 0 || fragment.endByte <= fragment.startByte || fragment.endByte > bytes.length)
        invalid('An evidence span must be a nonempty range within the retained original HTML.');
      const selected = bytes.subarray(fragment.startByte, fragment.endByte);
      if (sha256(selected) !== fragment.sha256) invalid('An evidence span differs from its original bytes.');
      try { fragments.push(new TextDecoder('utf-8', { fatal: true }).decode(selected)); }
      catch { invalid('Evidence spans must end on complete UTF-8 character boundaries.'); }
    }
    if (field.status === 'observed' && !fragments.some(fragment => fragment.includes(field.value)))
      invalid('An observed value must occur literally in a bound source span; use normalized with a note for transformations.');
  }
  const derivation = JSON.parse(canonical(d));
  const derivationSha256 = sha256(canonical({ coverage: meta.coverage, derivation }));
  if (meta.derivationSha256 !== undefined && meta.derivationSha256 !== derivationSha256)
    invalid('The saved derivation digest differs from its complete original evidence and field mapping.');
  return { id: 'source-' + sha256(stream + '\n' + csvSha256 + '\n' + derivationSha256),
    metadata: { coverage: 'single-notice', bodyKind: DERIVED_SOURCE_KIND, derivationSha256, derivation } };
}
