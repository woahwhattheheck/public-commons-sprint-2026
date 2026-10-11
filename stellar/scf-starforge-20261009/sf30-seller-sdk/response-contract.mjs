// MIT. Original SF25 schema acceptance applied to a merchant's response contract.
import { validateBazaarExtension } from '../../../stellar-forge/payment-auto-catalog/schema-validation.mjs';
import { supportsSellerMethod } from './http-methods.mjs';

export const RESPONSE_CONTRACT_SCHEMA = 'stellar-forge.upstream-response-contract.v1';
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const jsonMedia = value => typeof value === 'string' &&
  /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(value);
const fail = message => { throw new TypeError(message); };

// References are expanded by the original OpenAPI resolver before this boundary.
// A relative reference inside a transplanted schema would otherwise change root.
function inspectReferences(schema, depth = 0, state = { nodes: 0 }) {
  if (++state.nodes > 512 || depth > 16) fail('Response schema exceeds supported complexity');
  if (typeof schema === 'boolean') return;
  if (!plain(schema)) fail('Response schema must be an object or boolean');
  if (['$ref', '$id', '$dynamicRef', '$dynamicAnchor', '$anchor'].some(key => own(schema, key)))
    fail('Response schema references must be resolved before use');
  if (own(schema, '$schema') && schema.$schema !== DRAFT)
    fail('Response schema must use JSON Schema 2020-12');
  for (const key of ['properties', '$defs', 'definitions']) {
    if (!own(schema, key)) continue;
    if (!plain(schema[key])) fail('Invalid response schema dictionary');
    for (const child of Object.values(schema[key])) inspectReferences(child, depth + 1, state);
  }
  for (const key of ['items', 'additionalProperties'])
    if (own(schema, key)) inspectReferences(schema[key], depth + 1, state);
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (!own(schema, key)) continue;
    if (!Array.isArray(schema[key])) fail('Invalid response schema composition');
    for (const child of schema[key]) inspectReferences(child, depth + 1, state);
  }
}
function envelope(schema) {
  return { $schema: DRAFT, type: 'object', properties: { response: schema },
    required: ['response'], additionalProperties: false };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Compile trusted operator JSON once. Returns only sanitized failure codes at runtime.
 * Exact status wins over 2XX and default. Only JSON and bodyless success contracts
 * are supported. Native verification, cancellation and settlement remain in SF30.
 */
export function compileResponseContract(input, { method } = {}) {
  if (!plain(input) || input.schema !== RESPONSE_CONTRACT_SCHEMA ||
      !supportsSellerMethod(input.method) || method !== undefined && input.method !== method ||
      Object.keys(input).some(key => !['schema', 'method', 'responses', 'source'].includes(key)) ||
      !plain(input.responses)) fail('Invalid upstream response contract or method');
  let text;
  try { text = JSON.stringify(input); } catch { fail('Response contract must be serializable JSON'); }
  if (Buffer.byteLength(text) > 131072) fail('Response contract exceeds 128 KiB');
  let contract;
  try { contract = structuredClone(input); } catch { fail('Response contract must be plain JSON data'); }
  const responses = Object.entries(contract.responses);
  if (!responses.length || responses.length > 102) fail('Response contract needs success status definitions');
  if (own(contract, 'source')) {
    const source = contract.source;
    if (!plain(source) || Object.keys(source).some(key => !['openapiVersion', 'operationPointer', 'specSha256'].includes(key)) ||
        !/^3\.[01]\.\d+$/.test(source.openapiVersion ?? '') ||
        typeof source.operationPointer !== 'string' || !source.operationPointer.startsWith('#/paths/') ||
        source.operationPointer.length > 2048 ||
        own(source, 'specSha256') && !/^[a-f0-9]{64}$/.test(source.specSha256))
      fail('Invalid response contract source identity');
  }
  const schemas = new Map();
  for (const [status, response] of responses) {
    if (!/^(?:2\d\d|2XX|default)$/.test(status) || !plain(response) ||
        Object.keys(response).some(key => key !== 'content') || !plain(response.content) ||
        Object.keys(response.content).length > 8) fail('Invalid response status or content map');
    const content = new Map();
    for (const [media, schema] of Object.entries(response.content)) {
      if (!jsonMedia(media)) fail('Response contracts require exact application/json or application/*+json media types');
      inspectReferences(schema);
      const wrapped = envelope(schema);
      const checked = validateBazaarExtension({ info: {}, schema: wrapped });
      // Missing response data is expected here. Every schema assertion is inspected
      // by the original validator before it validates that deliberately empty info.
      if (!checked.ok && checked.reason !== 'INFO_SCHEMA_MISMATCH')
        fail('Unsupported response schema: ' + checked.reason);
      content.set(media, wrapped);
    }
    schemas.set(status, content);
  }
  freeze(contract);
  return Object.freeze({ contract,
    validate({ status, contentType, body, value }) {
      if (!Number.isInteger(status) || status < 200 || status > 299)
        return 'UPSTREAM_RESPONSE_CONTRACT_STATUS';
      const selected = schemas.get(String(status)) ?? schemas.get('2XX') ?? schemas.get('default');
      if (!selected) return 'UPSTREAM_RESPONSE_CONTRACT_STATUS';
      if (!Buffer.isBuffer(body)) return 'UPSTREAM_RESPONSE_CONTRACT_BODY';
      // HTTP HEAD/204/205 carry no body. A documented representation schema does
      // not create bytes on those responses or require an absent Content-Type.
      if (contract.method === 'HEAD' || status === 204 || status === 205)
        return body.length === 0 ? null : 'UPSTREAM_RESPONSE_CONTRACT_BODY';
      if (!selected.size) return body.length === 0 ? null : 'UPSTREAM_RESPONSE_CONTRACT_BODY';
      const media = typeof contentType === 'string' ? contentType.split(';', 1)[0].trim().toLowerCase() : '';
      const schema = selected.get(media);
      if (!schema) return 'UPSTREAM_RESPONSE_CONTRACT_MEDIA_TYPE';
      if (!body.length || value === undefined) return 'UPSTREAM_RESPONSE_CONTRACT_BODY';
      try {
        return validateBazaarExtension({ info: { response: value }, schema }).ok
          ? null : 'UPSTREAM_RESPONSE_CONTRACT_SCHEMA';
      } catch { return 'UPSTREAM_RESPONSE_CONTRACT_SCHEMA'; }
    },
  });
}
