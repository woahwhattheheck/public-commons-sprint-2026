// MIT. Original Unstructured Partition wire contract; no provider or payment client.
import { createHash } from 'node:crypto';

export const UNSTRUCTURED_SOURCE = Object.freeze({
  apiRepository: 'https://github.com/Unstructured-IO/unstructured-api',
  apiRevision: '448352104eefd2e5b8fa2dc32282fc1cd3db31ae',
  apiPath: '/general/v0/general',
  apiReference: 'https://docs.unstructured.io/api-reference/legacy-api/partition/post-requests',
  coreRepository: 'https://github.com/Unstructured-IO/unstructured',
  coreRevision: 'd29909504c7a19a13c19721f6907ac2fef0bb5ca',
  coreVersion: '0.22.18',
  inferenceVersion: '1.6.11',
  product: 'self-hosted-partition',
});
export const PARTITION_LIMITS = Object.freeze({
  requestBytes: 16 * 1024 * 1024,
  documentBytes: 16 * 1024 * 1024 - 65536,
  responseBytes: 1024 * 1024,
  parametersBytes: 32768,
});
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function need(value, code) {
  if (!value) throw Object.assign(new TypeError(code), { code });
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const canonicalBytes = value => Buffer.from(JSON.stringify(canonical(value)), 'utf8');
export const same = (left, right) => canonicalBytes(left).equals(canonicalBytes(right));
export const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const booleans = new Set([
  'xml_keep_tags', 'coordinates', 'include_page_breaks', 'pdf_infer_table_structure',
  'unique_element_ids', 'multipage_sections', 'overlap_all', 'include_orig_elements', 'include_slide_notes',
]);
const arrays = new Set(['languages', 'ocr_languages', 'skip_infer_table_types', 'extract_image_block_types']);
const integers = new Set(['combine_under_n_chars', 'max_characters', 'new_after_n_chars', 'overlap', 'starting_page_number']);
const strings = new Set(['gz_uncompressed_content_type', 'output_format', 'encoding', 'content_type', 'hi_res_model_name', 'strategy', 'chunking_strategy']);
const keys = new Set([...booleans, ...arrays, ...integers, ...strings]);

// Explicit merchant defaults. The wire carries each value below, including the
// native 500-character hard chunk limit. Omitted optional values use the pinned API.
export const PARTITION_DEFAULT_PARAMETERS = freeze({
  output_format: 'application/json',
  strategy: 'auto',
  coordinates: true,
  include_page_breaks: true,
  encoding: 'utf-8',
  xml_keep_tags: false,
  pdf_infer_table_structure: true,
  unique_element_ids: false,
  max_characters: 500,
  multipage_sections: true,
  overlap: 0,
  overlap_all: false,
  include_orig_elements: true,
  include_slide_notes: true,
});
function parameter(name, value) {
  need(keys.has(name), 'UNSTRUCTURED_PARAMETER_UNKNOWN');
  if (booleans.has(name)) need(typeof value === 'boolean', 'UNSTRUCTURED_BOOLEAN_PARAMETER_REQUIRED');
  if (arrays.has(name)) {
    need(Array.isArray(value) && value.length <= 32 && value.every(item =>
      typeof item === 'string' && item.length > 0 && item.length <= 128 && !/[\0\r\n]/.test(item)),
    'UNSTRUCTURED_STRING_LIST_PARAMETER_REQUIRED');
    return [...value];
  }
  if (integers.has(name)) need(Number.isSafeInteger(value) && value >=
    (['overlap', 'combine_under_n_chars'].includes(name) ? 0 : 1) && value <= 10000000,
  'UNSTRUCTURED_INTEGER_PARAMETER_INVALID');
  if (strings.has(name)) need(typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    !/[\0\r\n]/.test(value), 'UNSTRUCTURED_STRING_PARAMETER_REQUIRED');
  if (name === 'output_format') need(value === 'application/json', 'UNSTRUCTURED_JSON_OUTPUT_REQUIRED');
  if (name === 'strategy') need(['fast', 'hi_res', 'auto', 'ocr_only'].includes(value), 'UNSTRUCTURED_STRATEGY_INVALID');
  if (name === 'chunking_strategy') need(value === 'by_title', 'UNSTRUCTURED_CHUNKING_STRATEGY_INVALID');
  return value;
}
export function normalizePartitionParameters(input = {}) {
  need(object(input), 'UNSTRUCTURED_PARAMETERS_REQUIRED');
  const result = { ...PARTITION_DEFAULT_PARAMETERS };
  for (const [name, value] of Object.entries(input)) result[name] = parameter(name, value);
  // An empty repeated form field has no wire part. The pinned API also defaults
  // these lists to empty; expose one canonical representation of that selection.
  for (const name of arrays) if (result[name]?.length === 0) delete result[name];
  if (result.new_after_n_chars !== undefined)
    need(result.new_after_n_chars <= result.max_characters, 'UNSTRUCTURED_SOFT_CHUNK_LIMIT_EXCEEDS_HARD_LIMIT');
  if (result.combine_under_n_chars !== undefined)
    need(result.combine_under_n_chars <= result.max_characters, 'UNSTRUCTURED_COMBINE_LIMIT_EXCEEDS_HARD_LIMIT');
  need(result.overlap <= result.max_characters, 'UNSTRUCTURED_OVERLAP_EXCEEDS_CHUNK_LIMIT');
  need(canonicalBytes(result).length <= PARTITION_LIMITS.parametersBytes, 'UNSTRUCTURED_PARAMETERS_TOO_LARGE');
  return freeze(canonical(result));
}
export function partitionParametersFromFields(fields) {
  need(object(fields), 'UNSTRUCTURED_RETAINED_FIELDS_REQUIRED');
  for (const [name, value] of Object.entries(fields)) parameter(name, value);
  const normalized = normalizePartitionParameters(fields);
  need(same(fields, normalized), 'UNSTRUCTURED_RETAINED_PROFILE_INCOMPLETE');
  return normalized;
}
function fieldSchema(name) {
  if (booleans.has(name)) return { type: 'boolean' };
  if (arrays.has(name)) return { type: 'array', items: { type: 'string' }, maxItems: 32 };
  if (integers.has(name)) return { type: 'integer' };
  return { type: 'string' };
}
export function partitionBodySchema(parameters, maxDocumentBytes = PARTITION_LIMITS.documentBytes) {
  need(Number.isSafeInteger(maxDocumentBytes) && maxDocumentBytes > 0 &&
    maxDocumentBytes <= PARTITION_LIMITS.documentBytes, 'UNSTRUCTURED_DOCUMENT_LIMIT_INVALID');
  const properties = { files: { type: 'string', format: 'binary', minLength: 1, maxLength: maxDocumentBytes } };
  const required = ['files'];
  if (parameters !== undefined) {
    const normalized = normalizePartitionParameters(parameters);
    for (const [name, value] of Object.entries(normalized)) {
      properties[name] = { ...fieldSchema(name), const: structuredClone(value) };
      required.push(name);
    }
  } else {
    for (const name of keys) properties[name] = fieldSchema(name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}
export const PARTITION_RESPONSE_SCHEMA = freeze({
  type: 'array',
  items: {
    type: 'object',
    required: ['type', 'element_id', 'text', 'metadata'],
    properties: {
      type: { type: ['string', 'null'] },
      element_id: { type: 'string' },
      text: { type: 'string' },
      metadata: { type: 'object' },
    },
    additionalProperties: true,
  },
});
export function parsePartitionElements(value) {
  need(Array.isArray(value), 'UNSTRUCTURED_ELEMENT_ARRAY_REQUIRED');
  for (const item of value) {
    need(object(item) && (typeof item.type === 'string' || item.type === null) &&
      typeof item.element_id === 'string' && typeof item.text === 'string' && object(item.metadata),
    'UNSTRUCTURED_ELEMENT_INVALID');
  }
  return value;
}
export function partitionElementSummary(elements) {
  parsePartitionElements(elements);
  const types = Object.create(null), pages = new Set(), elementIds = new Map();
  let withCoordinates = 0, withTableHtml = 0, withOriginalElements = 0;
  for (const item of elements) {
    const type = item.type ?? 'Unspecified';
    types[type] = (types[type] ?? 0) + 1;
    const page = item.metadata.page_number;
    if (typeof page === 'string' || Number.isFinite(page)) pages.add(String(page));
    if (object(item.metadata.coordinates)) withCoordinates += 1;
    if (typeof item.metadata.text_as_html === 'string') withTableHtml += 1;
    if (typeof item.metadata.orig_elements === 'string') withOriginalElements += 1;
    elementIds.set(item.element_id, (elementIds.get(item.element_id) ?? 0) + 1);
  }
  return {
    elements: elements.length, types, pages: [...pages],
    withCoordinates, withTableHtml, withOriginalElements,
    repeatedElementIds: [...elementIds.values()].filter(count => count > 1).length,
  };
}
export function profileId(value) {
  need(typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value), 'UNSTRUCTURED_PROFILE_ID_INVALID');
  return value;
}
export function profileRoute(value) {
  return '/documents/unstructured/' + profileId(value);
}
export function validatePartitionManifest(value) {
  need(object(value) && value.schema === 'stellar-forge.unstructured-partition-manifest.v1' &&
    same(value.source, UNSTRUCTURED_SOURCE) && typeof value.publicOrigin === 'string' &&
    Array.isArray(value.profiles) && value.profiles.length > 0 && value.profiles.length <= 16,
  'UNSTRUCTURED_MERCHANT_MANIFEST_REQUIRED');
  const origin = new URL(value.publicOrigin);
  need(origin.origin === value.publicOrigin && origin.protocol === 'https:' &&
    !origin.username && !origin.password, 'UNSTRUCTURED_MERCHANT_ORIGIN_INVALID');
  need(Number.isSafeInteger(value.requestTimeoutMs) && value.requestTimeoutMs > 0 &&
    value.requestTimeoutMs <= 300000 && Number.isSafeInteger(value.handlerTimeoutMs) &&
    value.handlerTimeoutMs > 0 && value.handlerTimeoutMs <= 120000 &&
    value.requestTimeoutMs > value.handlerTimeoutMs, 'UNSTRUCTURED_MANIFEST_DEADLINE_INVALID');
  const ids = new Set();
  for (const profile of value.profiles) {
    need(object(profile) && !ids.has(profileId(profile.id)) &&
      profile.operationId === 'unstructured-' + profile.id && profile.path === profileRoute(profile.id) &&
      profile.url === value.publicOrigin + profile.path &&
      typeof profile.title === 'string' && profile.title.trim().length > 0,
    'UNSTRUCTURED_MERCHANT_PROFILE_INVALID');
    ids.add(profile.id);
    const parameters = normalizePartitionParameters(profile.parameters);
    need(same(parameters, profile.parameters) && profile.parametersSha256 === digest(canonicalBytes(parameters)),
      'UNSTRUCTURED_PROFILE_PARAMETERS_CHANGED');
    need(Number.isSafeInteger(profile.maxDocumentBytes) && profile.maxDocumentBytes >= 1 &&
      profile.maxDocumentBytes <= PARTITION_LIMITS.documentBytes &&
      profile.maxRequestBytes === profile.maxDocumentBytes + 65536 &&
      Number.isSafeInteger(profile.maxResponseBytes) && profile.maxResponseBytes >= 1 &&
      profile.maxResponseBytes <= PARTITION_LIMITS.responseBytes &&
      profile.paymentFlow === 'authorization', 'UNSTRUCTURED_PROFILE_LIMITS_INVALID');
    need(Array.isArray(profile.paymentOptions) && profile.paymentOptions.length > 0 &&
      profile.paymentOptions.length <= 16 && profile.paymentOptions.every(option =>
        object(option) && option.scheme === 'exact' && typeof option.network === 'string' &&
        option.network.startsWith('stellar:') && typeof option.asset === 'string' &&
        typeof option.payTo === 'string' && typeof option.amount === 'string' &&
        /^[1-9][0-9]{0,38}$/.test(option.amount) && option.extra?.paymentFlow === 'authorization'),
    'UNSTRUCTURED_MANIFEST_PAYMENT_OPTIONS_INVALID');
  }
  return value;
}
