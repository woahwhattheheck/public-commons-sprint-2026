// MIT. Saved bidder capability and evidence semantics for the original CanadaBuys workspace.
// This module performs no I/O, decision submission, source acquisition or workspace mutation.
import { canonical, sha256, failure, plain, text } from './core.mjs';
import { closingTime } from './domain.mjs';

export const CAPABILITY_PROFILE_SCHEMA = 'starforge.canadabuys.capability-profile.v1';
export const EVIDENCE_DOCUMENT_SCHEMA = 'starforge.canadabuys.evidence-document.v1';
export const REQUIREMENT_ASSESSMENT_SCHEMA = 'starforge.canadabuys.requirement-assessment.v1';
export const CAPABILITY_FIT_SCHEMA = 'starforge.canadabuys.capability-fit.v1';
export const DECISION_CONTEXT_CHANGE_SCHEMA = 'starforge.canadabuys.decision-context-change.v1';
export const DECISION_CHOICES = Object.freeze(['BID', 'NO_BID', 'INVESTIGATE', 'PARK']);
export const CODE_FAMILIES = Object.freeze(['GSIN', 'UNSPSC', 'UNSPECIFIED']);
export const REGION_FAMILIES = Object.freeze(['CANADABUYS', 'SOSA', 'TEXT', 'UNSPECIFIED']);
export const EVIDENCE_KINDS = Object.freeze([
  'SOLICITATION', 'AMENDMENT', 'ANNEX', 'QUESTIONS_AND_ANSWERS', 'SUPPLIER',
  'REGISTRATION', 'CERTIFICATION', 'SECURITY', 'PAST_PERFORMANCE', 'OTHER'
]);
export const EVIDENCE_ACCESS_STATES = Object.freeze([
  'CAPTURED', 'LINK_ONLY', 'ACCESS_RESTRICTED', 'RETRIEVAL_FAILED', 'NOT_YET_REVIEWED'
]);
export const REQUIREMENT_KINDS = Object.freeze(['MANDATORY', 'RATED', 'CONTRACTUAL', 'INFORMATIONAL', 'UNKNOWN']);
export const REQUIREMENT_APPLICABILITY = Object.freeze(['APPLIES', 'DOES_NOT_APPLY', 'UNKNOWN']);
export const REQUIREMENT_RESULTS = Object.freeze(['UNREVIEWED', 'MET', 'NOT_MET', 'UNKNOWN', 'NOT_APPLICABLE']);
export const FIT_CHECK_STATUSES = Object.freeze(['MATCH', 'GAP', 'UNKNOWN', 'NOT_APPLICABLE']);

const META_FIELDS = ['id', 'noticeId', 'revision', 'createdAt', 'updatedAt', 'operator', 'editionSha256'];
const PROFILE_FIELDS = ['schema', 'label', 'legalName', 'operatingNames', 'description', 'keywords',
  'excludedKeywords', 'categories', 'commodityCodes', 'deliveryRegions', 'opportunityRegions',
  'qualificationClaims', 'capacity', 'commercial', 'evidenceIds', 'notes'];
const EVIDENCE_FIELDS = ['schema', 'title', 'kind', 'sourceUrl', 'localOrigin', 'accessState', 'sha256',
  'bytes', 'language', 'capturedAt', 'issuedAt', 'version', 'pageOrSection', 'relatedNoticeIdentifiers',
  'supersedes', 'review', 'accessFailure', 'notes'];
const REQUIREMENT_FIELDS = ['schema', 'kind', 'applicability', 'requirementText', 'sourceEvidence',
  'assessment', 'supplierEvidence', 'applicabilityBasis', 'reviewedBy', 'reviewedAt', 'owner',
  'dueAt', 'clarificationQuestion', 'notes'];
const CATEGORY_CODES = new Set(['CNST', 'GD', 'SRV', 'SRVTGD']);
const KNOWN_STATUSES = {
  open: new Set(['OPEN', 'OUVERT', 'OUVERTE']),
  expired: new Set(['EXPIRED', 'EXPIRÉ', 'EXPIRÉE', 'EXPIRE', 'EXPIREE']),
  cancelled: new Set(['CANCELLED', 'CANCELED', 'ANNULÉ', 'ANNULÉE', 'ANNULE', 'ANNULEE'])
};
const owns = (object, key) => Object.hasOwn(object, key);
const key = value => String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
const unknownCode = value => !String(value).trim() || /^\*+$/.test(String(value).trim());

function object(value, name) {
  if (!plain(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw failure('INVALID_FIELD', name + ' must be a plain object');
  }
  return value;
}
function copyJSON(value, name = 'value', depth = 0, counter = { value: 0 }) {
  if (++counter.value > 150000 || depth > 48) throw failure('VALUE_TOO_LARGE', name + ' exceeds the supported JSON size');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, name, 4000000);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => copyJSON(item, name + '[' + index + ']', depth + 1, counter));
  object(value, name);
  return Object.fromEntries(Object.entries(value).map(([field, item]) =>
    [field, copyJSON(item, name + '.' + field, depth + 1, counter)]));
}
function fields(input, current, allowed, name) {
  object(input, name);
  object(current, 'current ' + name);
  const permitted = new Set([...allowed, ...META_FIELDS]);
  for (const field of Object.keys(input)) {
    if (!permitted.has(field)) throw failure('UNKNOWN_FIELD', name + '.' + field + ' is not a supported field');
  }
  return { ...current, ...input };
}
function nested(input, current, name, allowed) {
  const result = { ...(current === undefined ? {} : object(current, 'current ' + name)),
    ...(input === undefined ? {} : object(input, name)) };
  for (const field of Object.keys(result)) {
    if (!allowed.includes(field)) throw failure('UNKNOWN_FIELD', name + '.' + field + ' is not a supported field');
  }
  return result;
}
function string(value, name, maximum = 32768, required = false) {
  const result = text(value === undefined ? '' : value, name, maximum);
  if (required && !result.trim()) throw failure('INVALID_FIELD', name + ' must not be blank');
  return result;
}
function identifier(value, name) {
  const result = string(value, name, 240, true);
  if (/[\u0000-\u001f\u007f]/.test(result)) throw failure('INVALID_FIELD', name + ' must not contain control characters');
  return result;
}
function enumeration(value, allowed, fallback, name) {
  const result = value === undefined ? fallback : value;
  if (!allowed.includes(result)) throw failure('INVALID_FIELD', name + ' must be one of ' + allowed.join(', '));
  return result;
}
function array(value, name, maximum = 1000) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) throw failure('INVALID_FIELD', name + ' must be an array of at most ' + maximum + ' items');
  return value;
}
function strings(value, name, maximum = 1000, itemMaximum = 1000, ids = false) {
  const results = array(value, name, maximum).map((item, index) =>
    ids ? identifier(item, name + '[' + index + ']') : string(item, name + '[' + index + ']', itemMaximum).trim());
  return [...new Set(results.filter(item => item !== ''))];
}
function digest(value, name, nullable = true) {
  if ((value === undefined || value === null || value === '') && nullable) return null;
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) throw failure('INVALID_FIELD', name + ' must be a SHA-256 hex digest');
  return value.toLowerCase();
}
function calendarValid(y, m, d) {
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
function dateValue(value, name, dateOnly = false) {
  if (value === undefined || value === null || value === '') return null;
  const raw = string(value, name, 80);
  if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    if (calendarValid(y, m, d)) return raw;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:[Zz]|[+-]\d{2}:\d{2})$/.exec(raw);
  const parsed = Date.parse(raw);
  if (!match || !calendarValid(Number(match[1]), Number(match[2]), Number(match[3])) ||
      Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59 ||
      !Number.isFinite(parsed)) {
    throw failure('INVALID_TIMESTAMP', name + ' must be a valid timestamp with an explicit offset' +
      (dateOnly ? ' or a YYYY-MM-DD date' : ''));
  }
  return new Date(parsed).toISOString();
}
function dateMillis(value, endOfDate = false) {
  if (value === null) return null;
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ?
    value + (endOfDate ? 'T23:59:59.999Z' : 'T00:00:00.000Z') : value);
}
function nonnegative(value, name, maximum, integer = false) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum ||
      (integer && !Number.isSafeInteger(value))) {
    throw failure('INVALID_FIELD', name + ' must be a nonnegative ' + (integer ? 'integer' : 'number') + ' at most ' + maximum);
  }
  return value;
}
function money(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const result = string(value, name, 40).trim();
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(result)) {
    throw failure('INVALID_MONEY', name + ' must be a nonnegative decimal string with at most two fraction digits');
  }
  return result;
}
function cents(value) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function meta(value) {
  const result = {};
  if (value.id !== undefined) result.id = identifier(value.id, 'id');
  if (value.noticeId !== undefined) result.noticeId = value.noticeId === null ? null : identifier(value.noticeId, 'noticeId');
  if (value.editionSha256 !== undefined) result.editionSha256 = digest(value.editionSha256, 'editionSha256', false);
  if (value.revision !== undefined) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw failure('INVALID_REVISION', 'revision must be a nonnegative safe integer');
    result.revision = value.revision;
  }
  for (const field of ['createdAt', 'updatedAt']) if (value[field] !== undefined) result[field] = dateValue(value[field], field);
  if (value.operator !== undefined) result.operator = copyJSON(value.operator, 'operator');
  return result;
}
function schema(value, expected) {
  if (value !== undefined && value !== expected) throw failure('INVALID_SCHEMA', 'Expected schema ' + expected);
  return expected;
}
function region(item, name) {
  object(item, name);
  for (const field of Object.keys(item)) if (!['family', 'code', 'label', 'note'].includes(field)) {
    throw failure('UNKNOWN_FIELD', name + '.' + field + ' is not supported');
  }
  return {
    family: enumeration(item.family, REGION_FAMILIES, 'UNSPECIFIED', name + '.family'),
    code: string(item.code, name + '.code', 1000),
    label: string(item.label, name + '.label', 1000),
    note: string(item.note, name + '.note', 32768)
  };
}
function reference(item, name) {
  object(item, name);
  for (const field of Object.keys(item)) if (!['evidenceId', 'revision', 'sha256', 'pageOrSection', 'quote', 'note'].includes(field)) {
    throw failure('UNKNOWN_FIELD', name + '.' + field + ' is not supported');
  }
  const result = {
    evidenceId: identifier(item.evidenceId, name + '.evidenceId'),
    pageOrSection: string(item.pageOrSection, name + '.pageOrSection', 2000),
    quote: string(item.quote, name + '.quote', 32768),
    note: string(item.note, name + '.note', 32768)
  };
  if (item.revision !== undefined) {
    if (!Number.isSafeInteger(item.revision) || item.revision < 1) throw failure('INVALID_REVISION', name + '.revision must be a positive safe integer');
    result.revision = item.revision;
  }
  if (item.sha256 !== undefined) result.sha256 = digest(item.sha256, name + '.sha256', false);
  return result;
}

/** Normalize an authored profile; omitted fields retain current values. Arrays replace explicitly. */
export function normalizeCapabilityProfile(input, current = {}) {
  const value = fields(input, current, PROFILE_FIELDS, 'profile');
  const capacity = nested(input.capacity, current.capacity, 'capacity', ['state', 'availableFrom', 'minimumLeadDays', 'note']);
  const commercial = nested(input.commercial, current.commercial, 'commercial',
    ['currency', 'minimumContractValue', 'maximumContractValue', 'maximumBidCost', 'note']);
  const normalizedCommercial = {
    currency: string(commercial.currency === undefined ? 'CAD' : commercial.currency, 'commercial.currency', 3, true).toUpperCase(),
    minimumContractValue: money(commercial.minimumContractValue, 'commercial.minimumContractValue'),
    maximumContractValue: money(commercial.maximumContractValue, 'commercial.maximumContractValue'),
    maximumBidCost: money(commercial.maximumBidCost, 'commercial.maximumBidCost'),
    note: string(commercial.note, 'commercial.note')
  };
  if (!/^[A-Z]{3}$/.test(normalizedCommercial.currency)) throw failure('INVALID_FIELD', 'commercial.currency must be a three-letter currency code');
  if (normalizedCommercial.minimumContractValue !== null && normalizedCommercial.maximumContractValue !== null &&
      cents(normalizedCommercial.minimumContractValue) > cents(normalizedCommercial.maximumContractValue)) {
    throw failure('INVALID_MONEY_RANGE', 'minimumContractValue exceeds maximumContractValue');
  }
  const claims = array(value.qualificationClaims, 'qualificationClaims', 500).map((claim, index) => {
    const name = 'qualificationClaims[' + index + ']';
    object(claim, name);
    for (const field of Object.keys(claim)) if (!['id', 'label', 'state', 'evidenceIds', 'expiresAt', 'note'].includes(field)) {
      throw failure('UNKNOWN_FIELD', name + '.' + field + ' is not supported');
    }
    const result = {
      id: identifier(claim.id, name + '.id'),
      label: string(claim.label, name + '.label', 1000, true),
      state: enumeration(claim.state, ['DECLARED', 'SUPPORTED', 'NOT_HELD', 'UNKNOWN'], 'UNKNOWN', name + '.state'),
      evidenceIds: strings(claim.evidenceIds, name + '.evidenceIds', 500, 240, true),
      expiresAt: dateValue(claim.expiresAt, name + '.expiresAt', true),
      note: string(claim.note, name + '.note')
    };
    if (result.state === 'SUPPORTED' && result.evidenceIds.length === 0) {
      throw failure('CLAIM_EVIDENCE_REQUIRED', name + ' marked SUPPORTED must identify its supplier evidence');
    }
    return result;
  });
  if (new Set(claims.map(item => item.id)).size !== claims.length) throw failure('DUPLICATE_ID', 'qualificationClaims contain duplicate IDs');
  return {
    ...meta(value), schema: schema(value.schema, CAPABILITY_PROFILE_SCHEMA),
    label: string(value.label, 'profile.label', 1000, true),
    legalName: string(value.legalName, 'profile.legalName', 1000),
    operatingNames: strings(value.operatingNames, 'profile.operatingNames', 100, 1000),
    description: string(value.description, 'profile.description', 65536),
    keywords: strings(value.keywords, 'profile.keywords', 500, 500),
    excludedKeywords: strings(value.excludedKeywords, 'profile.excludedKeywords', 500, 500),
    categories: strings(value.categories, 'profile.categories', 100, 100),
    commodityCodes: array(value.commodityCodes, 'commodityCodes', 2000).map((item, index) => {
      const name = 'commodityCodes[' + index + ']';
      object(item, name);
      for (const field of Object.keys(item)) if (!['family', 'code', 'label'].includes(field)) {
        throw failure('UNKNOWN_FIELD', name + '.' + field + ' is not supported');
      }
      return {
        family: enumeration(item.family, CODE_FAMILIES, 'UNSPECIFIED', name + '.family'),
        code: string(item.code, name + '.code', 500),
        label: string(item.label, name + '.label', 2000)
      };
    }),
    deliveryRegions: array(value.deliveryRegions, 'deliveryRegions', 500).map((item, index) => region(item, 'deliveryRegions[' + index + ']')),
    opportunityRegions: array(value.opportunityRegions, 'opportunityRegions', 500).map((item, index) => region(item, 'opportunityRegions[' + index + ']')),
    qualificationClaims: claims,
    capacity: {
      state: enumeration(capacity.state, ['AVAILABLE', 'LIMITED', 'UNAVAILABLE', 'UNKNOWN'], 'UNKNOWN', 'capacity.state'),
      availableFrom: dateValue(capacity.availableFrom, 'capacity.availableFrom', true),
      minimumLeadDays: nonnegative(capacity.minimumLeadDays, 'capacity.minimumLeadDays', 3650),
      note: string(capacity.note, 'capacity.note')
    },
    commercial: normalizedCommercial,
    evidenceIds: strings(value.evidenceIds, 'profile.evidenceIds', 2000, 240, true),
    notes: string(value.notes, 'profile.notes', 65536)
  };
}

/** Describes original bytes or an unresolved original link; it never performs a retrieval. */
export function normalizeEvidenceDocument(input, current = {}) {
  const value = fields(input, current, EVIDENCE_FIELDS, 'evidence');
  const review = nested(input.review, current.review, 'evidence.review', ['state', 'reviewedBy', 'reviewedAt', 'note']);
  const sourceUrl = string(value.sourceUrl, 'evidence.sourceUrl', 8192);
  if (sourceUrl) {
    let url;
    try { url = new URL(sourceUrl); } catch { throw failure('INVALID_URL', 'evidence.sourceUrl must be an absolute HTTP(S) URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw failure('INVALID_URL', 'evidence.sourceUrl must be an HTTP(S) URL without embedded credentials');
    }
  }
  const result = {
    ...meta(value), schema: schema(value.schema, EVIDENCE_DOCUMENT_SCHEMA),
    title: string(value.title, 'evidence.title', 2000, true),
    kind: enumeration(value.kind, EVIDENCE_KINDS, 'OTHER', 'evidence.kind'),
    sourceUrl,
    localOrigin: string(value.localOrigin, 'evidence.localOrigin', 8192),
    accessState: enumeration(value.accessState, EVIDENCE_ACCESS_STATES, 'NOT_YET_REVIEWED', 'evidence.accessState'),
    sha256: digest(value.sha256, 'evidence.sha256'),
    bytes: nonnegative(value.bytes, 'evidence.bytes', Number.MAX_SAFE_INTEGER, true),
    language: enumeration(value.language, ['en', 'fr', 'bilingual', 'other', 'unknown'], 'unknown', 'evidence.language'),
    capturedAt: dateValue(value.capturedAt, 'evidence.capturedAt'),
    issuedAt: dateValue(value.issuedAt, 'evidence.issuedAt', true),
    version: string(value.version, 'evidence.version', 1000),
    pageOrSection: string(value.pageOrSection, 'evidence.pageOrSection', 2000),
    relatedNoticeIdentifiers: strings(value.relatedNoticeIdentifiers, 'evidence.relatedNoticeIdentifiers', 1000, 1000),
    supersedes: value.supersedes === undefined || value.supersedes === null || value.supersedes === '' ? null :
      identifier(value.supersedes, 'evidence.supersedes'),
    review: {
      state: enumeration(review.state, ['UNREVIEWED', 'REVIEWED'], 'UNREVIEWED', 'evidence.review.state'),
      reviewedBy: string(review.reviewedBy, 'evidence.review.reviewedBy', 1000),
      reviewedAt: dateValue(review.reviewedAt, 'evidence.review.reviewedAt'),
      note: string(review.note, 'evidence.review.note')
    },
    accessFailure: string(value.accessFailure, 'evidence.accessFailure', 32768),
    notes: string(value.notes, 'evidence.notes', 65536)
  };
  if (result.accessState === 'CAPTURED' && (!result.sha256 || result.bytes === null || !result.capturedAt ||
      (!result.sourceUrl.trim() && !result.localOrigin.trim()))) {
    throw failure('CAPTURED_EVIDENCE_INCOMPLETE', 'CAPTURED evidence requires original SHA-256, byte length, capture time and origin');
  }
  if (result.accessState === 'LINK_ONLY' && !result.sourceUrl) throw failure('EVIDENCE_LINK_REQUIRED', 'LINK_ONLY evidence requires its original source URL');
  if (result.review.state === 'REVIEWED' && (!result.review.reviewedBy.trim() || !result.review.reviewedAt)) {
    throw failure('EVIDENCE_REVIEW_REQUIRED', 'Reviewed evidence must identify the human reviewer and review time');
  }
  return result;
}

/** A human assessment keeps original clause and supplier-document revision references. */
export function normalizeRequirementAssessment(input, current = {}) {
  const value = fields(input, current, REQUIREMENT_FIELDS, 'requirement');
  const result = {
    ...meta(value), schema: schema(value.schema, REQUIREMENT_ASSESSMENT_SCHEMA),
    kind: enumeration(value.kind, REQUIREMENT_KINDS, 'UNKNOWN', 'requirement.kind'),
    applicability: enumeration(value.applicability, REQUIREMENT_APPLICABILITY, 'UNKNOWN', 'requirement.applicability'),
    requirementText: string(value.requirementText, 'requirement.requirementText', 65536, true),
    sourceEvidence: array(value.sourceEvidence, 'requirement.sourceEvidence', 1000).map((item, index) => reference(item, 'sourceEvidence[' + index + ']')),
    assessment: enumeration(value.assessment, REQUIREMENT_RESULTS, 'UNREVIEWED', 'requirement.assessment'),
    supplierEvidence: array(value.supplierEvidence, 'requirement.supplierEvidence', 1000).map((item, index) => reference(item, 'supplierEvidence[' + index + ']')),
    applicabilityBasis: string(value.applicabilityBasis, 'requirement.applicabilityBasis', 32768),
    reviewedBy: string(value.reviewedBy, 'requirement.reviewedBy', 1000),
    reviewedAt: dateValue(value.reviewedAt, 'requirement.reviewedAt'),
    owner: string(value.owner, 'requirement.owner', 1000),
    dueAt: dateValue(value.dueAt, 'requirement.dueAt', true),
    clarificationQuestion: string(value.clarificationQuestion, 'requirement.clarificationQuestion', 32768),
    notes: string(value.notes, 'requirement.notes', 65536)
  };
  if (['MET', 'NOT_MET', 'NOT_APPLICABLE'].includes(result.assessment) &&
      (!result.reviewedBy.trim() || !result.reviewedAt || result.sourceEvidence.length === 0)) {
    throw failure('REQUIREMENT_REVIEW_REQUIRED', 'A resolved requirement needs a human reviewer, review time and original clause evidence');
  }
  if (['MET', 'NOT_MET'].includes(result.assessment) && result.applicability !== 'APPLIES') {
    throw failure('REQUIREMENT_APPLICABILITY_REQUIRED', 'MET or NOT_MET applies only to a requirement explicitly assessed as APPLIES');
  }
  if (result.assessment === 'MET' && result.supplierEvidence.length === 0) {
    throw failure('SUPPLIER_EVIDENCE_REQUIRED', 'MET requires identified supplier evidence; capability keywords are not compliance evidence');
  }
  if (result.assessment === 'NOT_APPLICABLE' && (result.applicability !== 'DOES_NOT_APPLY' || !result.applicabilityBasis.trim())) {
    throw failure('APPLICABILITY_BASIS_REQUIRED', 'NOT_APPLICABLE requires a reviewed DOES_NOT_APPLY basis');
  }
  if (result.applicability === 'DOES_NOT_APPLY' && ['MET', 'NOT_MET'].includes(result.assessment)) {
    throw failure('CONFLICTING_REQUIREMENT_ASSESSMENT', 'A non-applicable requirement cannot be MET or NOT_MET');
  }
  return result;
}

function originalField(row, names, fallback, fallbackField) {
  for (const name of names) if (owns(row, name)) return { field: name, raw: copyJSON(row[name]), basis: 'original-row', present: true };
  return { field: fallbackField, raw: copyJSON(fallback === undefined ? '' : fallback), basis: 'saved-summary', present: false };
}
function cellList(value) {
  const source = Array.isArray(value) ? value : String(value === null || value === undefined ? '' : value).split(/\r\n|\r|\n/);
  const known = [], unknown = [];
  for (const item of source) {
    const raw = String(item);
    const parsed = raw.trim().replace(/^\*+/, '').trim();
    if (unknownCode(raw) || !parsed) unknown.push(raw);
    else if (!known.some(value => key(value) === key(parsed))) known.push(parsed);
  }
  if (source.length === 0) unknown.push('');
  return { values: known, unknown };
}
function codeObservation(entry, family) {
  const row = entry.row, summary = entry.summary;
  const descriptor = family === 'GSIN' ?
    originalField(row, ['gsin-nibs'], summary.commodityCodes, 'summary.commodityCodes') :
    family === 'UNSPSC' ? originalField(row, ['unspsc'], summary.unspsc, 'summary.unspsc') :
      originalField(row, ['commodity'], summary.arrangement?.commodity?.raw, 'summary.arrangement.commodity.raw');
  return { family, ...descriptor, ...cellList(descriptor.raw) };
}
function regionObservation(entry, dimension) {
  if (entry.kind === 'arrangement' || entry.summary.stream === 'supply-arrangements') {
    if (dimension === 'opportunity') return { family: 'SOSA', field: null, raw: '', otherLanguage: '', values: [], unknown: [''], basis: 'not-published-for-arrangement' };
    const descriptor = originalField(entry.row, ['delivery-point-code'], entry.summary.arrangement?.delivery?.code, 'summary.arrangement.delivery.code');
    return { family: 'SOSA', ...descriptor, ...cellList(descriptor.raw),
      description: { en: entry.row['delivery-point_en'] ?? entry.summary.arrangement?.delivery?.description?.en ?? '',
        fr: entry.row['delivery-point_fr'] ?? entry.summary.arrangement?.delivery?.description?.fr ?? '' } };
  }
  const prefix = dimension === 'delivery' ? 'regionsOfDelivery-regionsLivraison' : 'regionsOfOpportunity-regionAppelOffres';
  const en = originalField(entry.row, [prefix + '-eng'], entry.summary.regions?.[dimension]?.en, 'summary.regions.' + dimension + '.en');
  const fr = originalField(entry.row, [prefix + '-fra'], entry.summary.regions?.[dimension]?.fr, 'summary.regions.' + dimension + '.fr');
  const selected = cellList(en.raw).values.length ? en : fr;
  return { family: 'CANADABUYS', ...selected, ...cellList(selected.raw), language: selected === en ? 'en' : 'fr',
    otherLanguage: selected === en ? fr : en };
}
function validateEntry(input) {
  const entry = copyJSON(object(input, 'entry'), 'entry');
  object(entry.row, 'entry.row');
  object(entry.summary, 'entry.summary');
  const rowSha256 = sha256(canonical(entry.row));
  if (entry.rowSha256 !== undefined && digest(entry.rowSha256, 'entry.rowSha256', false) !== rowSha256) {
    throw failure('SOURCE_ROW_CHANGED', 'The saved entry row does not match its original rowSha256', 409);
  }
  return { entry, rowSha256 };
}
function evaluationTime(now) {
  const value = now === undefined ? Date.now() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) throw failure('INVALID_EVALUATION_TIME', 'now must identify a valid instant');
  return { milliseconds: value, iso: new Date(value).toISOString() };
}
function deadlineObservation(entry, at) {
  const raw = originalField(entry.row, ['tenderClosingDate-appelOffresDateCloture'],
    entry.summary.closing?.raw, 'summary.closing.raw');
  const en = originalField(entry.row, ['tenderStatus-appelOffresStatut-eng'], entry.summary.status?.en, 'summary.status.en');
  const fr = originalField(entry.row, ['tenderStatus-appelOffresStatut-fra'], entry.summary.status?.fr, 'summary.status.fr');
  const classified = [en.raw, fr.raw].map(item => {
    const normalized = key(item);
    for (const [status, values] of Object.entries(KNOWN_STATUSES)) if (values.has(normalized)) return status.toUpperCase();
    return null;
  }).filter(Boolean);
  const status = [...new Set(classified)].length > 1 ? 'CONFLICTING' : classified[0] || 'UNKNOWN';
  let closing = closingTime(String(raw.raw ?? ''), at);
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw.raw ?? '').trim());
  if (day && !calendarValid(Number(day[1]), Number(day[2]), Number(day[3]))) {
    closing = { ...closing, utc: null, valid: false, past: null, daysRemaining: null, error: 'INVALID_SOURCE_CLOSING_TIME' };
  }
  const kind = entry.kind || (entry.summary.stream === 'awards' ? 'award' :
    entry.summary.stream === 'supply-arrangements' ? 'arrangement' : 'tender');
  const availability = kind !== 'tender' ? 'NOT_APPLICABLE' :
    ['EXPIRED', 'CANCELLED'].includes(status) || closing.past === true ? 'CLOSED' :
      status === 'OPEN' && closing.valid && closing.past === false ? 'OPEN' : 'UNKNOWN';
  return { ...closing, source: raw, publisherStatus: { en, fr, classification: status }, availability,
    conflict: status === 'CONFLICTING' || (status === 'OPEN' && closing.past === true) ||
      (status === 'EXPIRED' && closing.valid && closing.past === false),
    timeBasis: 'Offset-free CanadaBuys closing timestamps use the publisher fixed UTC-05:00 offset.' };
}

/** Explain relevance from the exact entry/profile. This does not determine eligibility or choose a bid. */
export function assessCapabilityFit({ entry: input, profile: supplied, now } = {}) {
  const { entry, rowSha256 } = validateEntry(input);
  const profile = normalizeCapabilityProfile(object(supplied, 'profile'));
  const at = evaluationTime(now);
  const checks = [];
  const add = (code, dimension, status, reason, observed, declared) => {
    const result = { code, dimension, status, reason,
      observed: copyJSON(observed === undefined ? null : observed),
      declared: copyJSON(declared === undefined ? null : declared) };
    checks.push(result);
    return result;
  };
  const kind = entry.kind || (entry.summary.stream === 'awards' ? 'award' :
    entry.summary.stream === 'supply-arrangements' ? 'arrangement' : 'tender');
  const deadline = deadlineObservation(entry, at.milliseconds);
  if (kind !== 'tender') {
    add('HISTORICAL_OR_AGREEMENT_CONTEXT', 'availability', 'NOT_APPLICABLE',
      kind === 'award' ? 'This is an award/history record, not an open invitation. Its supplier or value is contextual evidence.' :
        'This is an existing standing offer or supply arrangement. Its listing does not establish a current invitation, eligibility or committed spend.',
      { kind, stream: entry.summary.stream, instrumentType: entry.summary.instrumentType ?? null,
        agreement: entry.summary.arrangement ?? null }, null);
  } else {
    add(deadline.availability === 'OPEN' ? 'OPEN_AT_EVALUATION' : deadline.availability === 'CLOSED' ?
      'CLOSED_AT_EVALUATION' : 'AVAILABILITY_UNRESOLVED', 'availability',
      deadline.availability === 'OPEN' ? 'MATCH' : deadline.availability === 'CLOSED' ? 'GAP' : 'UNKNOWN',
      deadline.availability === 'OPEN' ? 'The saved publisher status is Open and the parsed deadline is later than the evaluation instant. Current amendments and submission instructions still need review.' :
        deadline.availability === 'CLOSED' ? 'The saved status is closed or its deadline has elapsed. A historical Open value does not reopen an elapsed deadline.' :
          'The source status or deadline is missing, invalid or unresolved; current submission availability is not established.',
      deadline, { evaluatedAt: at.iso });
    if (deadline.conflict) add('STATUS_DEADLINE_CONFLICT', 'availability', 'UNKNOWN',
      'The saved publisher status and deadline do not agree. Retain both and check the original notice; no award or cancellation is inferred.',
      deadline, null);
  }

  const noticeType = originalField(entry.row, ['noticeType-avisType-eng'], entry.summary.noticeType?.en, 'summary.noticeType.en');
  const noticeTypeFr = originalField(entry.row, ['noticeType-avisType-fra'], entry.summary.noticeType?.fr, 'summary.noticeType.fr');
  const procedureText = key(String(noticeType.raw) + ' ' + String(noticeTypeFr.raw));
  if (/\bRFI\b|REQUEST FOR INFORMATION|DEMANDE DE RENSEIGNEMENTS/.test(procedureText)) {
    add('INFORMATION_REQUEST_SCOPE', 'procedure', 'UNKNOWN', 'An information request has its own response purpose; the listing does not establish a contract bid or contract award.',
      { en: noticeType, fr: noticeTypeFr }, null);
  } else if (/\bRFSO\b|\bRFSA\b|STANDING OFFER|SUPPLY ARRANGEMENT|OFFRE À COMMANDES|ARRANGEMENT EN MATIÈRE/.test(procedureText)) {
    add('OFFER_OR_ARRANGEMENT_SCOPE', 'procedure', 'UNKNOWN', 'Review the standing-offer or supply-arrangement qualification, scope and call-up terms. Entry into the instrument is not committed contract spend.',
      { en: noticeType, fr: noticeTypeFr }, null);
  }

  if (profile.commodityCodes.length === 0) add('COMMODITY_PROFILE_UNSET', 'classification', 'UNKNOWN',
    'No commodity code declarations were saved in this profile.', null, []);
  for (const family of CODE_FAMILIES) {
    const declarations = profile.commodityCodes.filter(item => item.family === family);
    if (!declarations.length) continue;
    const observation = codeObservation(entry, family);
    const knownDeclarations = declarations.filter(item => !unknownCode(item.code));
    const unknownDeclarations = declarations.filter(item => unknownCode(item.code));
    if (family === 'UNSPECIFIED') {
      add('COMMODITY_FAMILY_UNSPECIFIED', 'classification', 'UNKNOWN',
        'A generic code without an established family cannot be equated with GSIN or UNSPSC. The original SOSA commodity dictionary does not declare that family.',
        observation, declarations);
    } else if (!knownDeclarations.length || !observation.values.length) {
      add('COMMODITY_' + family + '_UNKNOWN', 'classification', 'UNKNOWN',
        'A blank or literal asterisk is unknown classification, not a failed code match. Both a declared code and a published code in the same family are needed.',
        observation, declarations);
    } else {
      const matches = observation.values.filter(item => knownDeclarations.some(declared => key(declared.code) === key(item)));
      add('COMMODITY_' + family + (matches.length ? '_MATCH' : '_GAP'), 'classification', matches.length ? 'MATCH' : 'GAP',
        matches.length ? 'At least one code matches exactly within ' + family + '; no prefix, hierarchy or cross-family equivalence was inferred.' :
          'The published ' + family + ' codes have no exact counterpart in the saved profile. This is a declared-capability gap, not a determination of procurement eligibility.',
        { ...observation, matchedCodes: matches }, declarations);
      if (observation.unknown.length || unknownDeclarations.length) add('COMMODITY_' + family + '_PARTIAL_UNKNOWN',
        'classification', 'UNKNOWN', 'Known codes were compared, while additional blank/asterisk values remain unresolved.',
        observation, unknownDeclarations);
    }
  }

  const categoryField = originalField(entry.row, ['procurementCategory-categorieApprovisionnement'], entry.summary.categories, 'summary.categories');
  const category = { ...categoryField, ...cellList(categoryField.raw) };
  const declaredCategories = profile.categories.filter(item => CATEGORY_CODES.has(key(item)));
  const observedCategories = category.values.filter(item => CATEGORY_CODES.has(key(item)));
  const invalidCategories = [...profile.categories, ...category.values].filter(item => !CATEGORY_CODES.has(key(item)));
  if (profile.categories.length) {
    const matches = observedCategories.filter(item => declaredCategories.some(declared => key(declared) === key(item)));
    add('PROCUREMENT_CATEGORY', 'classification', !declaredCategories.length || !observedCategories.length ? 'UNKNOWN' :
      matches.length ? 'MATCH' : 'GAP',
      !declaredCategories.length || !observedCategories.length ? 'A recognized category is missing. CNST, GD, SRV and SRVTGD are the supported publisher codes; unfamiliar values remain unresolved.' :
        matches.length ? 'The published procurement category matches an explicit profile category.' :
          'No published procurement category matches a declared category.',
      { ...category, matchedCodes: matches }, profile.categories);
    if (invalidCategories.length) add('PROCUREMENT_CATEGORY_UNRECOGNIZED', 'classification', 'UNKNOWN',
      'Unfamiliar category values are retained and have not been translated or treated as an automatic mismatch.',
      invalidCategories, null);
  }

  for (const dimension of ['delivery', 'opportunity']) {
    const declarations = profile[dimension === 'delivery' ? 'deliveryRegions' : 'opportunityRegions'];
    const observation = regionObservation(entry, dimension);
    if (kind === 'arrangement' && dimension === 'opportunity') {
      add('OPPORTUNITY_REGION_NOT_PUBLISHED', 'opportunity-region', 'NOT_APPLICABLE',
        'The SOSA row describes delivery coverage, not a separate tender opportunity-region field.', observation, declarations);
      continue;
    }
    const knownDeclarations = declarations.filter(item => !unknownCode(item.code));
    const comparable = knownDeclarations.filter(item => item.family === observation.family || item.family === 'TEXT');
    const matches = observation.values.filter(item => comparable.some(declared => key(declared.code) === key(item)));
    let status = 'UNKNOWN', reason;
    if (!knownDeclarations.length) reason = 'No usable ' + dimension + ' coverage was declared. Blank and literal asterisk region codes remain unknown.';
    else if (!observation.values.length) reason = 'The source does not establish this ' + dimension + ' region. Buyer, contact and supplier addresses are not substituted.';
    else if (!comparable.length) reason = 'The declared and published region families differ. No unverified geographic crosswalk or country inference was applied.';
    else if (matches.length === observation.values.length && observation.unknown.length === 0) {
      status = 'MATCH';
      reason = 'Every explicit published ' + dimension + ' value has an exact declared counterpart. Full qualifiers, including National Capital exclusions, remain part of that comparison.';
    } else if (matches.length === 0) {
      status = 'GAP';
      reason = 'No exact declared ' + dimension + ' value matches the published scope. This flags a coverage review, not a legal eligibility finding or an inferred geographic hierarchy.';
    } else reason = 'Only part of the published ' + dimension + ' scope matches. The data does not establish whether the listed regions are alternatives or cumulative delivery requirements.';
    add(dimension === 'delivery' ? 'DELIVERY_REGION' : 'OPPORTUNITY_REGION',
      dimension + '-region', status, reason, { ...observation, matchedValues: matches }, declarations);
    if (observation.family === 'SOSA') add('SOSA_REGION_CODE_MEANING', 'delivery-region', 'NOT_APPLICABLE',
      'SOSA NA means National–Canada, NC means National Capital, and FD means Foreign. These values are retained as geographic codes; agreement-specific delivery terms remain separate.',
      observation, null);
  }

  const textSources = [
    originalField(entry.row, ['title-titre-eng'], entry.summary.title?.en, 'summary.title.en'),
    originalField(entry.row, ['title-titre-fra'], entry.summary.title?.fr, 'summary.title.fr'),
    originalField(entry.row, ['tenderDescription-descriptionAppelOffres-eng', 'awardDescription-descriptionAttribution-eng', 'sosa-description_en'],
      entry.summary.description?.en, 'summary.description.en'),
    originalField(entry.row, ['tenderDescription-descriptionAppelOffres-fra', 'awardDescription-descriptionAttribution-fra', 'sosa-description_fr'],
      entry.summary.description?.fr, 'summary.description.fr')
  ];
  const keywordMatches = terms => terms.map(term => ({ term,
    fields: textSources.filter(source => key(source.raw).includes(key(term))).map(source => source.field) })).filter(item => item.fields.length);
  if (profile.keywords.length) {
    const matches = keywordMatches(profile.keywords);
    const hasText = textSources.some(item => String(item.raw).trim());
    add('CAPABILITY_TEXT', 'relevance', hasText ? matches.length ? 'MATCH' : 'GAP' : 'UNKNOWN',
      !hasText ? 'The saved source has no title or description to compare.' :
        matches.length ? 'These declared phrases occur in the saved bilingual title or description. A text match is relevance evidence only.' :
          'No declared capability phrase occurs in the saved bilingual title or description; this does not prove that the service is excluded.',
      { matches, fields: textSources.map(item => ({ field: item.field, basis: item.basis })) }, profile.keywords);
  }
  if (profile.excludedKeywords.length) {
    const matches = keywordMatches(profile.excludedKeywords);
    const hasText = textSources.some(item => String(item.raw).trim());
    add('EXCLUDED_TEXT', 'relevance', !hasText ? 'UNKNOWN' : matches.length ? 'GAP' : 'MATCH',
      !hasText ? 'The saved source has no description available for the declared exclusion review.' :
        matches.length ? 'A phrase explicitly excluded by the supplier appears in the original title or description.' :
          'No declared exclusion phrase appears in the available title or description; unseen solicitation documents remain outside this check.',
      matches, profile.excludedKeywords);
  }

  add('DECLARED_CAPACITY', 'capacity', profile.capacity.state === 'AVAILABLE' ? 'MATCH' :
    profile.capacity.state === 'UNAVAILABLE' ? 'GAP' : 'UNKNOWN',
    profile.capacity.state === 'AVAILABLE' ? 'The supplier has declared available capacity. Staffing, performance dates and bid effort require the specific solicitation review.' :
      profile.capacity.state === 'UNAVAILABLE' ? 'The saved supplier profile explicitly declares unavailable capacity.' :
        'Capacity is limited or unknown in the saved profile; a responsible owner should resolve the bid and delivery commitment.',
    { expectedStart: entry.summary.contractDates?.start ?? null, expectedEnd: entry.summary.contractDates?.end ?? null }, profile.capacity);
  if (kind === 'tender' && profile.capacity.minimumLeadDays !== null) {
    add('BID_LEAD_TIME', 'capacity', !deadline.valid ? 'UNKNOWN' :
      deadline.daysRemaining >= profile.capacity.minimumLeadDays ? 'MATCH' : 'GAP',
      !deadline.valid ? 'The deadline is not valid, so available bid preparation time cannot be compared.' :
        'Remaining time is compared with the supplier-declared minimum lead time at the recorded evaluation instant.',
      { daysRemaining: deadline.daysRemaining, deadlineUtc: deadline.utc, evaluatedAt: at.iso }, { minimumLeadDays: profile.capacity.minimumLeadDays });
  }
  if (kind === 'tender' && profile.capacity.availableFrom) {
    const start = originalField(entry.row, ['expectedContractStartDate-dateDebutContratPrevue'],
      entry.summary.contractDates?.start, 'summary.contractDates.start');
    let startDate = null;
    try { startDate = dateValue(String(start.raw ?? ''), 'expectedContractStartDate', true); } catch {}
    const availableAt = dateMillis(profile.capacity.availableFrom);
    add('DELIVERY_AVAILABILITY_DATE', 'capacity', startDate === null ? 'UNKNOWN' :
      availableAt > dateMillis(startDate) ? 'GAP' : 'MATCH',
      startDate === null ? 'Supplier availability is saved, but the source has no valid expected performance start to compare. Tender closing is not substituted for the delivery start.' :
        availableAt > dateMillis(startDate) ? 'Declared delivery availability begins after the published expected contract start.' :
          'Declared availability begins no later than the published expected contract start; duration, staffing and exact delivery terms still need review.',
      { expectedStart: start, parsedExpectedStart: startDate }, { availableFrom: profile.capacity.availableFrom,
        dateOnlyBasis: 'Date-only availability and expected-start values are compared at 00:00 UTC on their respective dates.' });
  }
  for (const claim of profile.qualificationClaims) {
    const expired = claim.expiresAt !== null && dateMillis(claim.expiresAt, true) < at.milliseconds;
    add('QUALIFICATION_CLAIM:' + claim.id, 'qualification', expired || claim.state === 'NOT_HELD' ? 'GAP' :
      claim.state === 'SUPPORTED' ? 'MATCH' : 'UNKNOWN',
      expired ? 'The declared qualification expiry precedes the evaluation instant; the earlier supporting documents remain in history.' :
        claim.state === 'NOT_HELD' ? 'The supplier explicitly records this qualification as not held. Its applicability still depends on the actual solicitation.' :
          claim.state === 'SUPPORTED' ? 'The supplier identified supporting evidence for this claim. Its exact document revisions and applicability require human review; this is not government certification.' :
            'This claim is declared or unknown and has not established requirement compliance.',
      { evaluatedAt: at.iso, dateOnlyExpiryBasis: 'A date-only expiry runs through 23:59:59.999 UTC on that date.' }, claim);
  }
  if (profile.commercial.minimumContractValue !== null || profile.commercial.maximumContractValue !== null ||
      profile.commercial.maximumBidCost !== null) {
    add('COMMERCIAL_REVIEW_REQUIRED', 'commercial', 'UNKNOWN',
      'These are supplier commercial preferences. No authoritative tender budget or bid-cost estimate is inferred from an award amount, cumulative contract history or a standing-offer listing.',
      { originalContractValue: entry.summary.contractValue ?? null, originalCumulativeValue: entry.summary.totalContractValue ?? null },
      profile.commercial);
  }
  const meaningful = checks.filter(item => ['classification', 'relevance', 'delivery-region', 'opportunity-region'].includes(item.dimension) && item.status !== 'NOT_APPLICABLE');
  const overall = kind !== 'tender' ? 'HISTORICAL_CONTEXT' : checks.some(item => item.status === 'GAP') ? 'GAPS' :
    meaningful.some(item => item.status === 'MATCH') ? 'POTENTIAL_FIT' : 'INSUFFICIENT_INFORMATION';
  return {
    schema: CAPABILITY_FIT_SCHEMA,
    evaluatedAt: at.iso,
    binding: { entryId: entry.id ?? null, noticeId: entry.noticeId ?? null, sourceId: entry.sourceId ?? null, rowSha256,
      sourceCapturedAt: entry.importedAt ?? null, profileId: profile.id ?? null, profileRevision: profile.revision ?? null,
      profileSha256: sha256(canonical(profile)) },
    overall,
    checks,
    matches: checks.filter(item => item.status === 'MATCH'),
    gaps: checks.filter(item => item.status === 'GAP'),
    unknowns: checks.filter(item => item.status === 'UNKNOWN'),
    mandatoryReview: {
      status: 'REQUIRED', eligibility: 'NOT_DETERMINED',
      reason: 'Review the actual solicitation, annexes, amendments and Q&A, then record each mandatory requirement with its original clause and supplier-document revisions. Fit does not attest that the requirement inventory is complete.',
      automaticDecision: null
    },
    deadline
  };
}

function context(value, name) {
  const result = copyJSON(object(value, name), name);
  validateEntry(result.entry);
  object(result.source, name + '.source');
  object(result.profile, name + '.profile');
  array(result.evidence, name + '.evidence', 20000);
  array(result.requirements, name + '.requirements', 10000);
  if (!Array.isArray(result.evidence) || !Array.isArray(result.requirements)) throw failure('INCOMPLETE_DECISION_CONTEXT', name + ' needs evidence and requirements arrays');
  if (result.source.id !== undefined && result.entry.sourceId !== undefined && result.source.id !== result.entry.sourceId) {
    throw failure('SOURCE_ID_MISMATCH', name + ' source and entry have different source IDs', 409);
  }
  if (result.source.sha256 !== undefined) digest(result.source.sha256, name + '.source.sha256', false);
  const identities = new Map();
  for (const [index, document] of result.evidence.entries()) {
    object(document, name + '.evidence[' + index + ']');
    if (document.id === undefined) throw failure('INCOMPLETE_EVIDENCE_IDENTITY', 'Frozen evidence must retain its saved ID');
    const identity = canonical([document.id, document.revision ?? null]);
    if (identities.has(identity) && identities.get(identity) !== canonical(document)) {
      throw failure('CONFLICTING_EVIDENCE_REVISION', 'A frozen evidence ID/revision identifies different documents', 409);
    }
    identities.set(identity, canonical(document));
  }
  return result;
}
function pathPart(value) { return String(value).replace(/~/g, '~0').replace(/\//g, '~1'); }
function categoryOf(path) {
  if (path.startsWith('/entry/row/')) {
    if (/ClosingDate|cloture/i.test(path)) return 'deadline';
    if (/Status|Statut/i.test(path)) return 'publisher-status';
    if (/amendment|Modification/i.test(path)) return 'amendment';
    if (/attachment|piecesJointes|noticeURL|Description/i.test(path)) return 'solicitation-content';
    if (/regionsOf|gsin|unspsc|categorieApprovisionnement/i.test(path)) return 'scope-and-classification';
    return 'original-row';
  }
  if (path.startsWith('/profile')) return 'supplier-profile';
  if (path.startsWith('/evidence')) return 'document-evidence';
  if (path.startsWith('/requirements')) return 'requirement-assessment';
  if (path.startsWith('/source')) return 'source-provenance';
  if (path.startsWith('/entry/summary')) return 'saved-source-summary';
  return 'selection-identity';
}
function materialPath(path) {
  if (/^\/entry\/(?:id|sourceId|rowNumber|importedAt|rowSha256)$/.test(path)) return false;
  if (/^\/entry\/summary\/closing\/(?:past|daysRemaining)$/.test(path)) return false;
  if (/^\/source\/(?:id|sha256|bytes|rowCount|label|url|retrievedAt|columns|response)(?:\/|$)/.test(path)) return false;
  if (/^\/profile\/(?:revision|createdAt|updatedAt|operator)(?:\/|$)/.test(path)) return false;
  return true;
}
function sortedItems(value) {
  return Array.isArray(value) ? value.map(item => canonical(item)).sort() : value;
}
function differences(before, after, path, result, beforePresent = true, afterPresent = true) {
  if (beforePresent && afterPresent && canonical(before) === canonical(after)) return;
  if (beforePresent && afterPresent && plain(before) && plain(after)) {
    for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      differences(before[field], after[field], path + '/' + pathPart(field), result, owns(before, field), owns(after, field));
    }
    return;
  }
  let material = materialPath(path);
  if (path === '/entry/summary/closing/past' && after === true && before !== true) material = true;
  if ((path === '/evidence' || path === '/requirements') && Array.isArray(before) && Array.isArray(after) &&
      canonical(sortedItems(before)) === canonical(sortedItems(after))) material = false;
  const category = categoryOf(path);
  result.push({
    path, component: path.split('/')[1] || 'context', category, material,
    beforePresent, afterPresent,
    before: beforePresent ? copyJSON(before) : null,
    after: afterPresent ? copyJSON(after) : null,
    reason: material ? 'The selected ' + category.replace(/-/g, ' ') + ' changed; assess whether the saved decision still applies.' :
      'Provenance, ordering or observation metadata changed while this field alone does not establish a changed procurement requirement.'
  });
}

/** Compare exact frozen contexts; never rewrite a saved choice or silently substitute a newer document. */
export function compareDecisionContext(before, after) {
  const newer = context(after, 'after');
  const older = before === null || before === undefined ? null : context(before, 'before');
  const changes = [];
  if (older !== null) differences(older, newer, '', changes);
  const components = ['entry', 'source', 'profile', 'evidence', 'requirements'].map(name => ({
    component: name,
    beforeSha256: older === null ? null : sha256(canonical(older[name])),
    afterSha256: sha256(canonical(newer[name])),
    changed: older === null || canonical(older[name]) !== canonical(newer[name])
  }));
  const materialChanges = changes.filter(item => item.material);
  return {
    schema: DECISION_CONTEXT_CHANGE_SCHEMA,
    initial: older === null,
    beforeSha256: older === null ? null : sha256(canonical(older)),
    afterSha256: sha256(canonical(newer)),
    changed: older === null || canonical(older) !== canonical(newer),
    requiresReassessment: materialChanges.length > 0,
    materialChangeCount: materialChanges.length,
    provenanceChangeCount: changes.length - materialChanges.length,
    components,
    reasons: [...new Set(materialChanges.map(item => item.category))].map(category => ({
      category,
      paths: materialChanges.filter(item => item.category === category).map(item => item.path),
      reason: 'Review changes in ' + category.replace(/-/g, ' ') + ' against the saved decision and its explicit conditions.'
    })),
    changes
  };
}
