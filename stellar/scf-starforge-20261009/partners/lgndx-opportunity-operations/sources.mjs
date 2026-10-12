// MIT. Retained procurement documents use the original SF88 dossier and USAspending bridge.
import { digest, jsonBytes, parseJson, object } from '../../sf88-operator-buyer-cli/node/store.mjs';
import {
  inspectUSAspendingEdition, receiveUSAspendingEdition, recoverUSAspendingEdition,
} from '../../sf30-seller-sdk/usaspending/dossier.mjs';

export const SOURCE_ROLES = Object.freeze([
  'company', 'past_performance', 'award_background', 'solicitation',
  'amendment', 'question_response', 'partner', 'other',
]);
export const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
const WRAPPER = 'stellar-forge.opportunity-source.v1';
const HASH = /^[a-f0-9]{64}$/;
const clone = value => structuredClone(value);
function required(ok, code) {
  if (!ok) { const error = new Error(code); error.code = code; error.status = 400; throw error; }
}
function text(value, name, max = 4000, empty = false) {
  required(typeof value === 'string' && value.length <= max && (empty || value.trim()), name);
  return value;
}
export function sourceUrl(value = '') {
  value = text(value, 'SOURCE_URL_INVALID', 4000, true);
  if (value) {
    let url; try { url = new URL(value); } catch { required(false, 'SOURCE_URL_INVALID'); }
    required(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'SOURCE_URL_INVALID');
  }
  return value;
}
export function sourceTime(value) {
  required(typeof value === 'string' && /T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)), 'SOURCE_CAPTURE_TIME_REQUIRED');
  return value;
}
export function sourceBytes(input) {
  required(object(input), 'SOURCE_INPUT_REQUIRED');
  required((input.contentText !== undefined) !== (input.contentBase64 !== undefined), 'ONE_SOURCE_INPUT_REQUIRED');
  let bytes;
  if (input.contentText !== undefined) {
    required(typeof input.contentText === 'string', 'SOURCE_TEXT_REQUIRED');
    bytes = Buffer.from(input.contentText, 'utf8');
  } else {
    required(typeof input.contentBase64 === 'string' && input.contentBase64.length <= MAX_SOURCE_BYTES * 1.4,
      'SOURCE_BASE64_INVALID');
    bytes = Buffer.from(input.contentBase64, 'base64');
    required(bytes.toString('base64') === input.contentBase64, 'SOURCE_BASE64_INVALID');
  }
  required(bytes.length > 0 && bytes.length <= MAX_SOURCE_BYTES, 'SOURCE_SIZE_INVALID');
  return bytes;
}
function utf8(bytes) {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return null; }
}
function descriptor(input, bytes) {
  required(SOURCE_ROLES.includes(input.role), 'SOURCE_ROLE_INVALID');
  const source = {
    role: input.role, title: text(input.title, 'SOURCE_TITLE_REQUIRED', 240),
    url: sourceUrl(input.url), capturedAt: sourceTime(input.capturedAt),
    filename: text(input.filename, 'SOURCE_FILENAME_REQUIRED', 240),
    mediaType: text(input.mediaType ?? 'text/plain', 'SOURCE_MEDIA_TYPE_INVALID', 160),
    sourceTerms: text(input.sourceTerms ?? 'Operator-retained source; original publisher terms apply.',
      'SOURCE_TERMS_REQUIRED', 12000),
    sha256: digest(bytes), bytes: bytes.length,
    replacesSourceId: input.replacesSourceId ?? null,
  };
  required(!/[\r\n\0]/.test(source.filename + source.mediaType), 'SOURCE_FILE_METADATA_INVALID');
  required(source.replacesSourceId === null || /^src_[a-f0-9]{64}$/.test(source.replacesSourceId),
    'SOURCE_REPLACEMENT_INVALID');
  return {id: 'src_' + digest(jsonBytes(source)), ...source};
}
async function metadata(store, id) {
  return typeof store.getMetadata === 'function' ? store.getMetadata(id) : store.get(id);
}
export async function retainOpportunitySource(store, dossierId, questionId, input) {
  const bytes = sourceBytes(input), base = descriptor(input, bytes);
  const decoded = utf8(bytes);
  // The original blob retains the complete input bytes in this documented
  // envelope; the projection is only a convenient source preview.
  const response = {
    schema: 'sf88-research-results-v1', provider: 'opportunity-document',
    query: base.title, success: true, sourceTerms: base.sourceTerms,
    results: [{
      id: base.id, title: base.title, url: base.url, publishedAt: base.capturedAt,
      content: decoded === null ? {filename: base.filename, mediaType: base.mediaType,
        sha256: base.sha256, bytes: base.bytes} : decoded.slice(0, 300000),
      description: decoded === null ? base.mediaType : decoded.slice(0, 500),
      citation: {url: base.url, capturedAt: base.capturedAt, filename: base.filename, sha256: base.sha256},
      metadata: {opportunitySource: {schema: WRAPPER, ...base, contentBase64: bytes.toString('base64')}},
    }],
  };
  const before = await metadata(store, dossierId);
  const current = await store.receive(dossierId, {
    questionId, label: base.title, provider: 'opportunity-document', response,
    sourceReference: base.url, expectedRevision: before.revision, projection: 'metadata',
    origin: {mode: 'ORIGINAL_OPPORTUNITY_DOCUMENT', intentId: base.id, sourceSha256: base.sha256},
  });
  const matches = current.editions.filter(edition => edition.questionId === questionId &&
    edition.origin?.mode === 'ORIGINAL_OPPORTUNITY_DOCUMENT' && edition.origin.intentId === base.id);
  required(matches.length === 1, 'SOURCE_EDITION_IDENTITY_INVALID');
  const edition = matches[0];
  return {...base, storage: 'retained', dossierId, dossierRevision: current.revision, questionId,
    editionIds: [edition.id], occurrenceIds: ['o_' + digest(edition.id + '\n0')],
    editionBindings: [{id: edition.id, sha256: edition.raw.sha256, bytes: edition.raw.bytes}]};
}
export async function retainAwardEdition(store, dossierId, questionId, {packet, label} = {}) {
  const inspected = inspectUSAspendingEdition(packet);
  required(!Object.hasOwn(packet, 'reviews'), 'AWARD_REVIEW_IMPORT_REQUIRES_EXPLICIT_SOURCE');
  const before = await metadata(store, dossierId);
  const result = await receiveUSAspendingEdition(store, dossierId, {
    packet, questionId, label, expectedRevision: before.revision, includeReviews: false,
  });
  required(result.complete, 'AWARD_EDITION_RECEIVE_INCOMPLETE');
  const portable = parseJson((await store.exportDossier(dossierId, {format: 'json'})).body);
  const original = recoverUSAspendingEdition(portable, result.sourceSignature, {questionId});
  const bytes = jsonBytes(original);
  const bindings = result.components.map(row => ({id: row.dossierEditionId, sha256: row.sha256, bytes: row.bytes}));
  const occurrences = result.components.filter(row => row.component === 'rows').flatMap(row =>
    Array.from({length: row.records}, (_, index) => 'o_' + digest(row.dossierEditionId + '\n' + index)));
  return {
    id: 'src_' + result.sourceSignature, role: 'award_background',
    title: label ?? original.edition.name, url: 'https://api.usaspending.gov/docs/',
    capturedAt: sourceTime(original.exportedAt), filename: original.edition.id + '.usaspending.json',
    mediaType: 'application/json', sourceTerms: 'Original public USAspending award edition and retained source records.',
    sha256: digest(bytes), bytes: bytes.length, replacesSourceId: null, storage: 'usaspending',
    dossierId, dossierRevision: result.revision, questionId, editionIds: bindings.map(row => row.id),
    occurrenceIds: occurrences, editionBindings: bindings,
    award: {sourceSignature: result.sourceSignature, editionId: inspected.editionId,
      editionSha256: inspected.editionSha256, firstPacketSha256: result.firstPacketSha256,
      rowCount: inspected.rowCount, sourcePageCount: inspected.sourcePageCount,
      coverage: clone(inspected.coverage), warnings: clone(inspected.warnings)},
  };
}
export function selectDossierRevision(portable, revision) {
  required(object(portable) && portable.schema === 'sf88-research-dossier-portable-v1' &&
    Array.isArray(portable.versions) && Array.isArray(portable.blobs), 'PORTABLE_DOSSIER_REQUIRED');
  required(Number.isSafeInteger(revision) && revision >= 1 && revision <= portable.versions.length,
    'DOSSIER_REVISION_NOT_FOUND');
  const versions = portable.versions.slice(0, revision);
  const selected = new Set(versions.flatMap(row => row.state.editions
    .filter(edition => edition.mode === 'retained').map(edition => edition.raw.sha256)));
  return {...clone(portable), versions: clone(versions),
    blobs: clone(portable.blobs.filter(row => selected.has(row.sha256)))};
}
export function validateOpportunitySource(source, portable) {
  required(object(source) && /^src_[a-f0-9]{64}$/.test(source.id) && SOURCE_ROLES.includes(source.role) &&
    HASH.test(source.sha256) && Number.isSafeInteger(source.bytes) && source.bytes > 0 &&
    source.bytes <= 256 * 1024 * 1024 && Array.isArray(source.editionIds) &&
    Array.isArray(source.occurrenceIds) && Array.isArray(source.editionBindings),
    'SOURCE_BINDING_INVALID');
  sourceTime(source.capturedAt); sourceUrl(source.url);
  text(source.title, 'SOURCE_TITLE_REQUIRED', 240); text(source.filename, 'SOURCE_FILENAME_REQUIRED', 240);
  text(source.mediaType, 'SOURCE_MEDIA_TYPE_INVALID', 160); text(source.sourceTerms, 'SOURCE_TERMS_REQUIRED', 12000);
  required(source.dossierId === portable.id && Number.isSafeInteger(source.dossierRevision) &&
    source.dossierRevision >= 1 && source.dossierRevision <= portable.versions.length, 'SOURCE_DOSSIER_CHANGED');
  const state = portable.versions[source.dossierRevision - 1].state;
  required(state.questions.some(row => row.id === source.questionId), 'SOURCE_QUESTION_CHANGED');
  required(source.editionIds.length === source.editionBindings.length &&
    new Set(source.editionIds).size === source.editionIds.length, 'SOURCE_EDITION_BINDING_INVALID');
  for (const binding of source.editionBindings) {
    const edition = state.editions.find(row => row.id === binding.id);
    required(source.editionIds.includes(binding.id) && edition?.mode === 'retained' &&
      edition.questionId === source.questionId && edition.raw.sha256 === binding.sha256 &&
      edition.raw.bytes === binding.bytes, 'SOURCE_EDITION_CHANGED');
  }
  required(source.occurrenceIds.every(id => /^o_[a-f0-9]{64}$/.test(id)), 'SOURCE_OCCURRENCE_INVALID');
  return source;
}
export function readOpportunitySource(source, portable) {
  validateOpportunitySource(source, portable);
  const expectedOccurrences = [];
  for (const binding of source.editionBindings) {
    const blob = portable.blobs.find(row => row.sha256 === binding.sha256);
    required(blob && typeof blob.bodyBase64 === 'string', 'SOURCE_BLOB_MISSING');
    const raw = Buffer.from(blob.bodyBase64, 'base64');
    required(raw.toString('base64') === blob.bodyBase64 && raw.length === binding.bytes && digest(raw) === binding.sha256,
      'SOURCE_BLOB_CHANGED');
    const document = parseJson(raw);
    required(Array.isArray(document.results), 'SOURCE_EDITION_RESULTS_INVALID');
    for (let index = 0; index < document.results.length; index++) expectedOccurrences.push('o_' + digest(binding.id + '\n' + index));
  }
  required(JSON.stringify(expectedOccurrences) === JSON.stringify(source.occurrenceIds), 'SOURCE_OCCURRENCE_CHANGED');
  let bytes;
  if (source.storage === 'usaspending') {
    required(source.role === 'award_background' && HASH.test(source.award?.sourceSignature), 'AWARD_SOURCE_INVALID');
    const packet = recoverUSAspendingEdition(selectDossierRevision(portable, source.dossierRevision),
      source.award.sourceSignature, {questionId: source.questionId});
    required(source.id === 'src_' + source.award.sourceSignature && packet.sha256 === source.award.firstPacketSha256,
      'AWARD_SOURCE_IDENTITY_CHANGED');
    bytes = jsonBytes(packet);
  } else {
    required(source.storage === 'retained' && source.editionBindings.length === 1, 'SOURCE_STORAGE_INVALID');
    const binding = source.editionBindings[0], blob = portable.blobs.find(row => row.sha256 === binding.sha256);
    required(blob && typeof blob.bodyBase64 === 'string', 'SOURCE_BLOB_MISSING');
    const body = Buffer.from(blob.bodyBase64, 'base64');
    required(body.toString('base64') === blob.bodyBase64 && body.length === binding.bytes &&
      digest(body) === binding.sha256, 'SOURCE_BLOB_CHANGED');
    const retained = parseJson(body).results?.[0]?.metadata?.opportunitySource;
    required(retained?.schema === WRAPPER && retained.id === source.id && retained.sha256 === source.sha256 &&
      typeof retained.contentBase64 === 'string', 'SOURCE_PAYLOAD_CHANGED');
    bytes = Buffer.from(retained.contentBase64, 'base64');
    required(bytes.toString('base64') === retained.contentBase64, 'SOURCE_PAYLOAD_CHANGED');
    required(descriptor(retained, bytes).id === source.id, 'SOURCE_IDENTITY_CHANGED');
    for (const key of ['role', 'title', 'url', 'capturedAt', 'filename', 'mediaType', 'sourceTerms', 'bytes', 'replacesSourceId']) {
      required(retained[key] === source[key], 'SOURCE_METADATA_CHANGED');
    }
  }
  required(bytes.length === source.bytes && digest(bytes) === source.sha256, 'SOURCE_PAYLOAD_CHANGED');
  return {source: clone(source), contentBase64: bytes.toString('base64'),
    contentText: /^(?:text\/|application\/(?:json|xml|[^;]+\+json))/.test(source.mediaType) ? utf8(bytes) : null};
}
export function bindOpportunityEvidence(state, evidence = []) {
  required(Array.isArray(evidence) && evidence.length <= 200, 'EVIDENCE_LIST_INVALID');
  const seen = new Set();
  return evidence.map(row => {
    required(object(row), 'EVIDENCE_INVALID');
    const source = state.sources.find(source => source.id === row.sourceId);
    required(source, 'EVIDENCE_SOURCE_NOT_FOUND');
    const locator = text(row.locator, 'EVIDENCE_LOCATOR_REQUIRED', 4000);
    const excerpt = text(row.excerpt ?? '', 'EVIDENCE_EXCERPT_INVALID', 30000, true);
    const key = source.id + '\n' + locator;
    required(!seen.has(key), 'EVIDENCE_DUPLICATE'); seen.add(key);
    return {sourceId: source.id, locator, excerpt, sha256: source.sha256,
      dossierRevision: source.dossierRevision, editionIds: clone(source.editionIds),
      occurrenceIds: clone(source.occurrenceIds)};
  });
}
