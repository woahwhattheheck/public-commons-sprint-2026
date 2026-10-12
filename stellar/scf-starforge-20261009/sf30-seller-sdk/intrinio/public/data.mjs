// MIT. Domain edits are source revisions in the ORIGINAL Python workspace.
export const INDEX_PATH = 'workspace.json';
export const INDEX_SCHEMA = 'tj.intrinio-fundamentals-workspace.v1';
export const CAPTURE_SCHEMA = INDEX_SCHEMA;
export const FILE_LIMIT = 8 * 1024 * 1024;
export const SOURCE_LIMIT = 32 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const STATES = new Set(['open', 'confirmed', 'question', 'excluded']);
const DISPOSITION = {confirmed: 'accept', question: 'revisit', excluded: 'exclude'};
const STATUS = {accept: 'confirmed', revisit: 'question', exclude: 'excluded'};
const SECRET = new Set(['api_key', 'apikey', 'authorization', 'access_token', 'password', 'secret']);
const OPERATIONS = {
  company: ['CompanyApi', 'get_company'],
  'company-filings': ['CompanyApi', 'get_company_filings'],
  'company-fundamentals': ['CompanyApi', 'get_company_fundamentals'],
  filing: ['FilingApi', 'get_filing_by_id'],
  'filing-fundamentals': ['FilingApi', 'get_filing_fundamentals'],
  fundamental: ['FundamentalsApi', 'get_fundamental_by_id'],
  'fundamental-lookup': ['FundamentalsApi', 'lookup_fundamental'],
  'reported-financials': ['FundamentalsApi', 'get_fundamental_reported_financials'],
  'standardized-financials': ['FundamentalsApi', 'get_fundamental_standardized_financials'],
  'standardized-dimensions': ['FundamentalsApi', 'get_fundamental_standardized_financials_dimensions'],
  'bulk-index': ['BulkDownloadsApi', 'get_bulk_download_links'],
};
const KINDS = new Set(['provider-api-response', 'customer-retained-provider-response', 'provider-published-documentation-example']);
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const fail = (code, message) => Object.assign(new Error(message), {code});
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]));
  return value;
}
export const stable = value => JSON.stringify(normalized(value));
export async function sha256(value) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function utf8(bytes) { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
export function base64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
}
export function unbase64(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
function text(value, label, maximum = 240, empty = true) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0') || !empty && !value.trim())
    throw fail('INTRINIO_TEXT', label + ' has an invalid length or value.');
  return value;
}
function id(value) {
  text(value, 'Explicit operation or source identity', 3000, false);
  if (['__proto__', 'constructor', 'prototype'].includes(value)) throw fail('INTRINIO_ID', 'Use a non-reserved explicit identity.');
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || !SHA.test(value)) throw fail('INTRINIO_SHA256', 'A complete lowercase SHA-256 is required.');
  return value;
}
export function memberPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || value.startsWith('/') ||
      /[\\:\x00-\x1f\x7f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw fail('INTRINIO_PATH', 'Select a safe relative capture member path.');
  return value;
}
function noCredentials(value) {
  if (object(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET.has(key.toLowerCase().replaceAll('-', '_'))) throw fail('INTRINIO_CREDENTIAL_METADATA', 'Keep credential values outside retained metadata.');
      noCredentials(child);
    }
  } else if (Array.isArray(value)) for (const child of value) noCredentials(child);
}
function safeUrl(value) {
  if (value === null || value === undefined || value === '') return;
  text(value, 'Source URL', 12000, false);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw fail('INTRINIO_SOURCE_URL', 'Use an HTTP(S) source URL without embedded credentials.');
  for (const [key] of url.searchParams) if (SECRET.has(key.toLowerCase().replaceAll('-', '_')))
    throw fail('INTRINIO_CREDENTIAL_URL', 'Keep credential values out of retained source URLs.');
}
export function sourceMetadata(value) {
  if (!object(value) || !KINDS.has(value.sourceKind) || !OPERATIONS[value.kind] ||
      !['primary', 'reference'].includes(value.role) || value.format !== 'intrinio-json' ||
      typeof value.originalWireBytes !== 'boolean')
    throw fail('INTRINIO_SOURCE_KIND', 'Use the original complete Intrinio source descriptor.');
  noCredentials(value);
  id(value.id); digest(value.sha256);
  if (value.path !== 'captures/' + value.sha256 + '.json' ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > FILE_LIMIT)
    throw fail('INTRINIO_SOURCE_SIZE', 'A complete source must match its content-addressed path and original 8 MiB file limit.');
  text(value.capturedAt, 'Capture time', 160, false);
  const request = value.request, provenance = value.provenance;
  if (!object(request) || !object(request.pathParams) || !object(request.query) ||
      request.apiClass !== OPERATIONS[value.kind][0] || request.apiMethod !== OPERATIONS[value.kind][1] ||
      request.method !== undefined && request.method !== 'GET')
    throw fail('INTRINIO_REQUEST', 'The source request must preserve its pinned original SDK operation and parameters.');
  if (!object(provenance) || !['observed-request', 'published-example', 'retained-customer-record'].includes(provenance.requestBasis))
    throw fail('INTRINIO_PROVENANCE', 'Retain the original source provenance and request basis.');
  text(provenance.description, 'Source description', 50000);
  safeUrl(provenance.url); safeUrl(request.url);
  if (value.page !== undefined) {
    const page = value.page;
    if (!object(page) || typeof page.collectionId !== 'string' || !page.collectionId ||
        !Number.isSafeInteger(page.index) || page.index < 0 || typeof page.first !== 'boolean' ||
        page.cursor !== null && typeof page.cursor !== 'string')
      throw fail('INTRINIO_PAGE', 'Each declared page needs its original collection, index, cursor and first-page binding.');
    if (page.first && (page.index !== 0 || page.cursor !== null || Object.hasOwn(request.query, 'next_page')) ||
        Object.hasOwn(request.query, 'next_page') && request.query.next_page !== page.cursor)
      throw fail('INTRINIO_PAGE', 'The declared page conflicts with the original incoming request cursor.');
  }
  return clone(value);
}
export function columnMap(value) {
  if (!object(value) || !Object.keys(value).length || Object.keys(value).length > 100)
    throw fail('INTRINIO_COLUMNS', 'Choose 1–100 named customer columns.');
  for (const [label, pointer] of Object.entries(value)) {
    text(label, 'Column label', 160, false); text(pointer, 'JSON pointer', 1000, false);
    if (!pointer.startsWith('/') || /~(?![01])/.test(pointer) || pointer.includes('\0'))
      throw fail('INTRINIO_COLUMNS', 'Each customer column must name a valid absolute JSON pointer into a selected record.');
  }
  return clone(value);
}
export function validateDocument(value) {
  if (!object(value) || value.schema !== INDEX_SCHEMA || !Array.isArray(value.editions) ||
      !Array.isArray(value.reviews) || !Array.isArray(value.comparisonBindings) || !object(value.export))
    throw fail('INTRINIO_WORKSPACE', 'Select workspace.json with schema tj.intrinio-fundamentals-workspace.v1.');
  text(value.title, 'Workspace title', 240, false);
  if (!['all', 'accepted'].includes(value.export.mode)) throw fail('INTRINIO_EXPORT_MODE', 'The original export mode is all or accepted.');
  columnMap(value.export.columns);
  const editionIds = new Set();
  for (const edition of value.editions) {
    if (!object(edition) || editionIds.has(id(edition.id)) || !Array.isArray(edition.sources) ||
        !object(edition.scope) || !Array.isArray(edition.scope.requests))
      throw fail('INTRINIO_EDITION', 'Each original edition needs a unique ID, exact request scope and source inventory.');
    editionIds.add(edition.id); text(edition.label, 'Edition label', 240, false);
    text(edition.capturedAt, 'Edition capture time', 160, false);
    const sourceIds = new Set();
    for (const source of edition.sources) {
      sourceMetadata(source);
      if (sourceIds.has(source.id)) throw fail('INTRINIO_SOURCE_ID', 'An edition contains a repeated source ID.');
      sourceIds.add(source.id);
    }
  }
  if (value.selectedEdition !== null && !editionIds.has(value.selectedEdition))
    throw fail('INTRINIO_SELECTED_EDITION', 'The selected edition must exist in this source document.');
  const reviewIds = new Set();
  for (const review of value.reviews) {
    if (!object(review) || !editionIds.has(review.editionId) || reviewIds.has(id(review.id)) || !STATUS[review.disposition])
      throw fail('INTRINIO_REVIEW', 'A named review must bind an existing edition, unique record and supported disposition.');
    reviewIds.add(review.id); digest(review.sourceSha256); id(review.recordId);
    text(review.reviewer, 'Reviewer', 160, false); text(review.note, 'Fact note', 10000); text(review.createdAt, 'Review time', 160, false);
  }
  const bindingIds = new Set();
  for (const binding of value.comparisonBindings) {
    if (!object(binding) || bindingIds.has(id(binding.id)) || !editionIds.has(binding.fromEditionId) || !editionIds.has(binding.toEditionId))
      throw fail('INTRINIO_COMPARISON_BINDING', 'A named comparison must select retained editions and a unique binding.');
    bindingIds.add(binding.id); id(binding.fromFundamentalId); id(binding.toFundamentalId);
    text(binding.reviewer, 'Binding reviewer', 160, false); text(binding.note, 'Binding reason', 10000, false);
    text(binding.createdAt, 'Binding time', 160, false);
  }
  if (value.operator !== undefined && (!object(value.operator) || value.operator.schema !== 'stellar-forge.intrinio-operator.v1'))
    throw fail('INTRINIO_OPERATOR', 'The original workspace contains an unsupported operator annotation version.');
  return value;
}
export const viewId = (editionId, sourceId) => encodeURIComponent(editionId).replaceAll('~', '%7E') + '~' + encodeURIComponent(sourceId).replaceAll('~', '%7E');
export function indexDocument(document) {
  validateDocument(document);
  const operator = document.operator ?? {};
  const index = {schema: INDEX_SCHEMA, document, captures: operator.captures ?? [], editions: {}, reviews: {},
    projections: operator.projections ?? {}, operations: operator.operations ?? {}, custody: operator.custody ?? []};
  for (const edition of document.editions) for (const source of edition.sources) {
    const key = viewId(edition.id, source.id);
    const record = {id: key, editionId: edition.id, responseId: source.id, label: edition.label + ' · ' + source.id,
      operation: source.kind, path: source.path, originalPath: source.path, sha256: source.sha256, bytes: source.bytes,
      source, scope: edition.scope, acquisition: edition.acquisition ?? null, importedAt: edition.capturedAt};
    index.editions[key] = record;
    const retained = document.reviews.filter(review => review.editionId === edition.id && review.sourceSha256 === source.sha256);
    const meta = operator.reviews?.[key] ?? {}, decisions = {};
    for (const review of retained) decisions[review.recordId] = {status: STATUS[review.disposition], note: review.note, reviewer: review.reviewer, createdAt: review.createdAt};
    index.reviews[key] = {revision: retained.length + (meta.sequence ?? 0), title: meta.title ?? record.label, notes: meta.notes ?? '',
      decisions, actor: meta.actor ?? retained.at(-1)?.reviewer ?? '', updatedAt: meta.updatedAt ?? retained.at(-1)?.createdAt ?? null};
  }
  return index;
}
export function validateIndex(index) {
  if (!object(index) || !object(index.document)) throw fail('INTRINIO_INDEX', 'Open the selected original source revision first.');
  return indexDocument(index.document);
}
export function parseIndex(file) {
  if (!file || file.encoding !== 'utf8' || typeof file.text !== 'string') throw fail('INTRINIO_INDEX', 'workspace.json must be complete UTF-8 source.');
  return indexDocument(JSON.parse(file.text));
}
function operator(document) {
  document.operator ??= {schema: 'stellar-forge.intrinio-operator.v1', captures: [], reviews: {}, projections: {}, operations: {}, custody: []};
  for (const name of ['reviews', 'projections', 'operations']) document.operator[name] ??= {};
  for (const name of ['captures', 'custody']) document.operator[name] ??= [];
  return document.operator;
}
export async function captureManifest(raw) {
  if (!(raw instanceof Uint8Array) || !raw.length || raw.length > FILE_LIMIT) throw fail('INTRINIO_MANIFEST_LIMIT', 'Select a complete source workspace within the original 8 MiB file limit.');
  const original = validateDocument(JSON.parse(utf8(raw)));
  if (!original.editions.length) throw fail('INTRINIO_MANIFEST', 'The selected source workspace has no captured editions.');
  noCredentials(original);
  const responses = [], originals = new Map(), sidecars = new Map();
  for (const edition of original.editions) for (const source of edition.sources) {
    responses.push({...source, editionId: edition.id, operation: source.kind, source});
    if (source.provenance.metadataPath) {
      const path = memberPath(source.provenance.metadataPath), metadataSha256 = source.provenance.metadataSha256, metadataBytes = source.provenance.metadataBytes;
      if (metadataSha256 !== undefined || metadataBytes !== undefined) {
        digest(metadataSha256);
        if (!Number.isSafeInteger(metadataBytes) || metadataBytes < 1 || metadataBytes > FILE_LIMIT)
          throw fail('INTRINIO_CAPTURE_METADATA', 'Declared capture metadata needs its complete retained byte count.');
      }
      const receipt = {path, role: 'source-capture-metadata', sourceSha256: source.sha256, sourceBytes: source.bytes,
        ...(metadataSha256 === undefined ? {} : {sha256: metadataSha256, bytes: metadataBytes})};
      if (sidecars.has(path) && stable(sidecars.get(path)) !== stable(receipt))
        throw fail('INTRINIO_CAPTURE_METADATA', 'One original metadata path cannot bind conflicting source identities.');
      sidecars.set(path, receipt);
    }
    const entity = source.provenance.originalEntity;
    if (entity) {
      if (!object(entity) || entity.complete !== true || !Number.isSafeInteger(entity.bytes) || entity.bytes < 1)
        throw fail('INTRINIO_ORIGINAL_ENTITY', 'An original HTTP entity needs its complete byte count and identity.');
      digest(entity.sha256);
      const path = memberPath(entity.nativeRetainedPath ?? entity.path);
      if (entity.nativeRetainedPath && (path !== source.path || entity.sha256 !== source.sha256 || entity.bytes !== source.bytes))
        throw fail('INTRINIO_ORIGINAL_ENTITY', 'The original identity entity must match the exact retained response.');
      const existing = originals.get(path);
      if (existing && (existing.sha256 !== entity.sha256 || existing.bytes !== entity.bytes))
        throw fail('INTRINIO_ORIGINAL_ENTITY', 'Original entity paths contain conflicting identities.');
      originals.set(path, {path, sha256: entity.sha256, bytes: entity.bytes, entity});
    }
  }
  for (const edition of original.editions) if (edition.acquisition?.originalLedger) {
    const path = memberPath(edition.acquisition.originalLedger);
    sidecars.set(path, {path, role: 'original-acquisition-ledger'});
  }
  return {id: await sha256(raw), name: original.title, responses, originals: [...originals.values()], sidecars: [...sidecars.values()], raw, original};
}
function revisionInput(revision, document, files, note) {
  validateDocument(document);
  const changed = [...files, {path: INDEX_PATH, text: JSON.stringify(document, null, 2) + '\n'}];
  const projected = new Map(revision.files.map(file => [file.path, file.bytes]));
  for (const file of changed) projected.set(file.path, file.text !== undefined ? new TextEncoder().encode(file.text).length : unbase64(file.base64).length);
  if (projected.size > 512 || [...projected.values()].some(size => size > FILE_LIMIT) || [...projected.values()].reduce((sum, size) => sum + size, 0) > SOURCE_LIMIT)
    throw fail('INTRINIO_NATIVE_SOURCE_LIMIT', 'The complete saved selection exceeds the original 512-file / 32 MiB source revision. Select an explicit complete named partition; no current source was replaced.');
  return {baseRevision: revision.id, expectedHead: revision.id, note, files: changed, remove: []};
}
function currentReview(index, editionId) {
  if (!Object.hasOwn(index.editions, editionId)) throw fail('INTRINIO_EDITION', 'Choose a retained source view.');
  return index.reviews[editionId];
}
function previousOperation(index, operationId, fingerprint) {
  if (!Object.hasOwn(index.operations, operationId)) return null;
  const original = index.operations[operationId];
  if (original.fingerprint !== fingerprint) throw fail('INTRINIO_OPERATION_CONFLICT', 'That operation ID belongs to different input. Its saved result remains unchanged.');
  return {reused: true, result: clone(original.result)};
}
export async function importCaptureInput(revision, savedIndex, manifest, files, {actor, operationId, expectedHead, externalCustody} = {}) {
  actor = text(actor, 'Operator name', 160, false); id(operationId);
  const index = validateIndex(savedIndex), document = clone(index.document), op = operator(document);
  const fingerprint = await sha256(stable({kind: 'import', manifest: manifest.id, actor, expectedHead, externalCustody: externalCustody ?? null}));
  const prior = previousOperation(index, operationId, fingerprint); if (prior) return prior;
  const existing = op.captures.find(item => item.id === manifest.id);
  if (existing) return {reused: true, result: {captureId: existing.id, editionIds: existing.editionIds}};
  if (revision.id !== expectedHead) throw fail('INTRINIO_REVISION_CHANGED', 'The original source revision changed; reopen it before importing.');
  const changes = [], known = new Map(revision.files.map(file => [file.path, file])), now = new Date().toISOString();
  async function retain(row) {
    const existing = known.get(row.path);
    if (existing) {
      if (existing.sha256 !== row.sha256 || existing.bytes !== row.bytes) throw fail('INTRINIO_RETAINED_CONFLICT', 'A retained source path has a different immutable identity.');
      return;
    }
    const raw = files.get(row.path);
    if (!(raw instanceof Uint8Array) || raw.length !== row.bytes || await sha256(raw) !== row.sha256)
      throw fail('INTRINIO_BODY_IDENTITY', 'Select the complete exact original file: ' + row.path);
    changes.push({path: row.path, base64: base64(raw)}); known.set(row.path, row);
  }
  for (const source of manifest.responses) await retain(source);
  for (const original of manifest.originals) {
    if (known.has(original.path)) { await retain(original); continue; }
    if (original.bytes <= FILE_LIMIT && files.has(original.path)) {
      await retain(original);
      op.custody.push({manifest: manifest.id, ...original, status: 'retained', retainedPath: original.path});
    } else {
      text(externalCustody, 'Explicit original-entity custody location', 2000, false);
      op.custody.push({manifest: manifest.id, path: original.path, sha256: original.sha256, bytes: original.bytes,
        status: 'external', location: externalCustody, recordedBy: actor, recordedAt: now});
    }
  }
  const retainedSidecars = [];
  for (const sidecar of manifest.sidecars ?? []) {
    const raw = files.get(sidecar.path);
    if (!(raw instanceof Uint8Array) || !raw.length || raw.length > FILE_LIMIT)
      throw fail('INTRINIO_CAPTURE_METADATA', 'Select the complete declared original metadata file: ' + sidecar.path);
    const metadata = JSON.parse(utf8(raw));
    if (sidecar.role === 'source-capture-metadata' &&
        (metadata.sha256 !== sidecar.sourceSha256 || metadata.bytes !== sidecar.sourceBytes))
      throw fail('INTRINIO_CAPTURE_METADATA', 'The original capture metadata does not bind its exact response bytes.');
    const hash = await sha256(raw), path = 'captures/metadata/' + hash + '.json';
    if (sidecar.sha256 !== undefined && (hash !== sidecar.sha256 || raw.length !== sidecar.bytes))
      throw fail('INTRINIO_CAPTURE_METADATA', 'The selected metadata bytes differ from the source manifest’s declared capture identity.');
    if (!known.has(path)) { changes.push({path, base64: base64(raw)}); known.set(path, {path, sha256: hash, bytes: raw.length}); }
    retainedSidecars.push({...sidecar, retainedPath: path, sha256: hash, bytes: raw.length});
  }
  const editionIds = [];
  for (const edition of manifest.original.editions) {
    const existing = document.editions.find(item => item.id === edition.id);
    if (existing && stable(existing) !== stable(edition)) throw fail('INTRINIO_EDITION_CONFLICT', 'An edition ID already names different source scope. Acquire a new explicit edition ID; the prior edition remains intact.');
    if (!existing) document.editions.push(clone(edition));
    editionIds.push(...edition.sources.map(source => viewId(edition.id, source.id)));
  }
  for (const key of ['reviews', 'comparisonBindings']) for (const row of manifest.original[key]) {
    const existing = document[key].find(item => item.id === row.id);
    if (existing && stable(existing) !== stable(row)) throw fail('INTRINIO_NAMED_RECORD_CONFLICT', 'A named retained review or comparison already has different content.');
    if (!existing) document[key].push(clone(row));
  }
  if (document.selectedEdition === null) {
    document.selectedEdition = manifest.original.selectedEdition;
    document.title = manifest.original.title;
    document.export = clone(manifest.original.export);
  }
  const manifestPath = 'captures/manifests/' + manifest.id + '.json';
  if (!known.has(manifestPath)) changes.push({path: manifestPath, base64: base64(manifest.raw)});
  const result = {captureId: manifest.id, editionIds};
  op.captures.push({id: manifest.id, name: manifest.name, manifestPath, importedAt: now, actor, editionIds, metadata: retainedSidecars});
  op.operations[operationId] = {kind: 'import', fingerprint, createdAt: now, actor, result};
  return {reused: false, result, index: indexDocument(document), input: revisionInput(revision, document, changes, 'Intrinio source import: ' + manifest.name + ' by ' + actor)};
}
export function previewResult(job) {
  if (!job || job.status !== 'COMPLETED' || typeof job.result?.text !== 'string')
    throw fail(job?.error?.code ?? 'INTRINIO_NATIVE_PREVIEW', job?.error?.message ?? 'The original preview has not returned a complete JSON result.');
  const result = JSON.parse(job.result.text);
  if (result.ok !== true) throw fail(result.error?.code ?? 'INTRINIO_SOURCE_REJECTED', result.error?.message ?? 'The retained input was not accepted.');
  return result;
}
export function reviewValidationInput(index, {editionId, expectedReviewRevision, decisions}) {
  id(editionId); const review = currentReview(index, editionId);
  if (!Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision !== review.revision || !object(decisions))
    throw fail('INTRINIO_REVIEW_CHANGED', 'Choose the current named review before saving.');
  for (const [rowId, decision] of Object.entries(decisions)) {
    digest(rowId);
    if (!object(decision) || !STATES.has(decision.status)) throw fail('INTRINIO_DECISION', 'Choose an original fact and supported review state.');
    if (decision.status === 'open' && review.decisions[rowId]) throw fail('INTRINIO_DECISION', 'Use Confirmed, Question or Excluded for a previously reviewed fact; its named history remains retained.');
    text(decision.note ?? '', 'Fact note', 10000);
  }
  return {edition_id: editionId, expected_revision: expectedReviewRevision,
    decisions: Object.fromEntries(Object.entries(decisions).map(([rowId, decision]) => [rowId, {status: decision.status, note: decision.note ?? ''}]))};
}
function validateJob(job, functionName, revision, input) {
  const result = previewResult(job);
  if (job.revisionId !== revision.id || job.function !== functionName || stable(job.input) !== stable(input))
    throw fail('INTRINIO_VALIDATION_BINDING', 'The completed original validation belongs to different source or input.');
  return result.validated;
}
export async function saveReviewInput(revision, savedIndex, command, job) {
  const {editionId, expectedReviewRevision, decisions, operationId, expectedHead} = command;
  const actor = text(command.actor, 'Operator name', 160, false), title = text(command.title, 'Review title', 240, false), notes = text(command.notes ?? '', 'Review notes', 50000);
  id(operationId); id(editionId);
  const index = validateIndex(savedIndex), document = clone(index.document), op = operator(document);
  const fingerprint = await sha256(stable({kind: 'review', editionId, expectedReviewRevision, decisions, actor, title, notes, expectedHead}));
  const prior = previousOperation(index, operationId, fingerprint); if (prior) return prior;
  if (revision.id !== expectedHead) throw fail('INTRINIO_REVISION_CHANGED', 'The original source changed. Reopen it before saving this review.');
  const input = reviewValidationInput(index, command), validated = validateJob(job, 'validate_review', revision, input), record = index.editions[editionId];
  if (validated.edition_id !== editionId || validated.source_sha256 !== record.sha256 || validated.review_revision !== expectedReviewRevision)
    throw fail('INTRINIO_VALIDATION_BINDING', 'The native result does not validate this exact source and review.');
  const now = new Date().toISOString();
  for (const [rowId, decision] of Object.entries(decisions)) {
    if (decision.status === 'open') continue;
    const prior = index.reviews[editionId].decisions[rowId];
    if (prior?.status === decision.status && prior?.note === (decision.note ?? '')) continue;
    document.reviews.push({id: await sha256(stable({operationId, rowId})), editionId: record.editionId, recordId: rowId,
      sourceSha256: record.sha256, sourceId: record.responseId, disposition: DISPOSITION[decision.status],
      reviewer: actor, note: decision.note ?? '', createdAt: now});
  }
  op.reviews[editionId] = {sequence: (op.reviews[editionId]?.sequence ?? 0) + 1, title, notes, actor, updatedAt: now};
  const updated = indexDocument(document), result = {editionId, review: clone(updated.reviews[editionId])};
  op.operations[operationId] = {kind: 'review', fingerprint, createdAt: now, actor, editionId, validationId: job.id, result};
  return {reused: false, result, index: indexDocument(document), input: revisionInput(revision, document, [], 'Intrinio named review: ' + record.label + ' by ' + actor)};
}
export function selectionValidationInput(index, {editionId, expectedReviewRevision, rowIds, columns}) {
  id(editionId); const review = currentReview(index, editionId);
  if (!Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision !== review.revision || !Array.isArray(rowIds) ||
      !rowIds.length || rowIds.length > 5000 || rowIds.some(value => typeof value !== 'string' || !SHA.test(value)) || new Set(rowIds).size !== rowIds.length)
    throw fail('INTRINIO_SELECTION', 'Choose distinct exact fact rows and the current review revision.');
  return {edition_id: editionId, expected_revision: expectedReviewRevision, row_ids: [...rowIds], columns: columnMap(columns ?? index.document.export.columns)};
}
export async function saveSelectionInput(revision, savedIndex, command, job) {
  const {editionId, expectedReviewRevision, rowIds, operationId, expectedHead} = command;
  const actor = text(command.actor, 'Operator name', 160, false), title = text(command.title, 'Extract title', 240, false), notes = text(command.notes ?? '', 'Extract notes', 50000);
  id(operationId); id(editionId);
  const index = validateIndex(savedIndex), document = clone(index.document), op = operator(document);
  const columns = columnMap(command.columns ?? document.export.columns);
  const fingerprint = await sha256(stable({kind: 'selection', editionId, expectedReviewRevision, rowIds, actor, title, notes, columns, expectedHead}));
  const prior = previousOperation(index, operationId, fingerprint); if (prior) return prior;
  if (revision.id !== expectedHead) throw fail('INTRINIO_REVISION_CHANGED', 'The source changed. Reopen it before freezing this extract.');
  const input = selectionValidationInput(index, {...command, columns}), validated = validateJob(job, 'validate_selection', revision, input);
  if (validated.edition_id !== editionId || validated.source_sha256 !== index.editions[editionId].sha256 || validated.review_revision !== expectedReviewRevision)
    throw fail('INTRINIO_VALIDATION_BINDING', 'The native result does not validate this exact selection.');
  const projectionId = await sha256(stable({workspaceOperation: operationId, fingerprint}));
  const result = {id: projectionId, editionId, title, notes, rowIds: [...rowIds], columns, actor, createdAt: new Date().toISOString(),
    review: clone(currentReview(index, editionId)), source: clone(index.editions[editionId]), validatedRevision: revision.id, validationId: job.id};
  op.projections[projectionId] = result;
  op.operations[operationId] = {kind: 'selection', fingerprint, createdAt: result.createdAt, actor, editionId, result: {projectionId, selection: clone(result)}};
  return {reused: false, result: op.operations[operationId].result, index: indexDocument(document), input: revisionInput(revision, document, [], 'Intrinio customer extract: ' + title + ' by ' + actor)};
}
export function comparisonValidationInput(index, command) {
  if (!index.editions[command.leftId] || !index.editions[command.rightId]) throw fail('INTRINIO_COMPARISON', 'Choose two retained source views.');
  return {left_id: command.leftId, right_id: command.rightId, mode: command.mode ?? 'revision',
    reviewer: text(command.actor, 'Binding reviewer', 160, false), note: text(command.note, 'Binding reason', 10000, false)};
}
export async function saveComparisonInput(revision, savedIndex, command, job) {
  const index = validateIndex(savedIndex), document = clone(index.document), op = operator(document);
  const input = comparisonValidationInput(index, command);
  id(command.operationId);
  const fingerprint = await sha256(stable({kind: 'binding', ...input, expectedHead: command.expectedHead}));
  const prior = previousOperation(index, command.operationId, fingerprint); if (prior) return prior;
  if (revision.id !== command.expectedHead) throw fail('INTRINIO_REVISION_CHANGED', 'The source changed before the named comparison was saved.');
  const validated = validateJob(job, 'validate_comparison', revision, input);
  const result = {...validated.binding, id: await sha256(stable({operationId: command.operationId, fingerprint})), createdAt: new Date().toISOString()};
  document.comparisonBindings.push(result);
  op.operations[command.operationId] = {kind: 'binding', fingerprint, actor: input.reviewer, createdAt: result.createdAt, result: {binding: result}};
  return {reused: false, result: op.operations[command.operationId].result, index: indexDocument(document), input: revisionInput(revision, document, [], 'Intrinio named comparison by ' + input.reviewer)};
}
export function operationOutcome(index, operationId) {
  return Object.hasOwn(index.operations, operationId) ? clone(index.operations[operationId]) : null;
}
