// MIT. Import response promises into the existing SF30 upstream binding format.
import { createOpenApiResolver } from './importer.mjs';
import { compileResponseContract, RESPONSE_CONTRACT_SCHEMA } from '../sf30-seller-sdk/response-contract.mjs';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The original importer has already validated the selected operation and refs.
 * Capture all success declarations plus default, preserving status precedence.
 * Header assertions/links are outside this body contract, as documented.
 */
export function compileOpenApiResponseContract(document, offer, { specSha256 } = {}) {
  if (!plain(document) || !/^3\.[01]\.\d+$/.test(document.openapi ?? '') ||
      !plain(document.paths) || !plain(offer) || !supportsSellerMethod(offer.method) ||
      !own(document.paths, offer.path)) fail('Original selected OpenAPI operation required');
  if (document.jsonSchemaDialect !== undefined &&
      !['https://json-schema.org/draft/2020-12/schema', 'https://spec.openapis.org/oas/3.1/dialect/base'].includes(document.jsonSchemaDialect))
    fail('Unsupported OpenAPI response schema dialect');
  const refs = createOpenApiResolver(document, { direction: 'response' }), item = refs.reference(document.paths[offer.path]);
  const operation = item[offer.method.toLowerCase()];
  if (!plain(operation) || !plain(operation.responses)) fail('Selected operation must declare responses');
  const responses = Object.create(null);
  for (const [status, raw] of Object.entries(operation.responses)) {
    if (status.startsWith('x-')) continue;
    if (!/^(?:[1-5]\d\d|[1-5]XX|default)$/.test(status)) fail('Invalid OpenAPI response status: ' + status);
    if (!/^(?:2\d\d|2XX|default)$/.test(status)) continue;
    const response = refs.reference(raw);
    if (typeof response.description !== 'string') fail('OpenAPI response description is required');
    if (response.content !== undefined && !plain(response.content)) fail('OpenAPI response content must be an object');
    const content = Object.create(null);
    for (const [media, rawMedia] of Object.entries(response.content ?? {})) {
      if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(media))
        fail('Response contract supports exact JSON media types only: ' + media);
      if (!plain(rawMedia) || !own(rawMedia, 'schema')) fail('Each response media type requires an explicit schema');
      if (rawMedia.encoding !== undefined) fail('Response encoding requires manual integration');
      // Preserve original schema assertions. The shared resolver handles OAS
      // annotations; original SF25 rejects unsupported assertion keywords.
      content[media] = typeof rawMedia.schema === 'boolean' && /^3\.1\./.test(document.openapi)
        ? rawMedia.schema : refs.schema(rawMedia.schema);
    }
    if (!Object.keys(content).length && offer.method !== 'HEAD' && !['204', '205'].includes(status))
      fail('Bodyless response contracts require HEAD or an explicit 204/205 status');
    responses[status] = { content };
  }
  const operationPointer = '#/paths/' + offer.path.replace(/~/g, '~0').replace(/\//g, '~1') + '/' + offer.method.toLowerCase();
  return compileResponseContract({ schema: RESPONSE_CONTRACT_SCHEMA, method: offer.method, responses,
    source: { openapiVersion: document.openapi, operationPointer,
      ...(specSha256 === undefined ? {} : { specSha256 }) } }).contract;
}

/** Attach contracts only to explicitly bound original imported handlers. This
 * stage reads no environment credentials and makes no backend/facilitator call.
 * Native upstream-serve --check performs the original transport/env preflight.
 */
export function createContractUpstreamBindings(document, imported, serviceBindings, upstreams, options = {}) {
  if (imported?.schema !== 'stellar.open-api-seller-import.v1' || !Array.isArray(imported.offers) ||
      !Array.isArray(serviceBindings) || !plain(upstreams) || upstreams.schema !== 'stellar-forge.seller-upstreams.v1' ||
      Object.keys(upstreams).some(key => !['schema', 'bindings'].includes(key)) || !plain(upstreams.bindings))
    fail('Original imported offers, service bindings and seller-upstreams.v1 required');
  const result = structuredClone(upstreams), used = new Map();
  for (const offer of imported.offers) {
    const binding = serviceBindings.find(candidate => candidate?.method?.toUpperCase() === offer.method && candidate.path === offer.path);
    if (!binding) fail('Missing original service binding for ' + offer.method + ' ' + offer.path);
    if (!own(binding, 'handler')) continue;
    const raw = own(result.bindings, binding.handler) ? result.bindings[binding.handler] : undefined;
    if (!plain(raw)) fail('Upstream binding missing for handler: ' + binding.handler);
    if ((raw.method ?? 'GET') !== offer.method || (raw.responseMode ?? 'json') !== 'json')
      fail('Contract upstream must retain the original method and JSON responseMode');
    const contract = compileOpenApiResponseContract(document, offer, options);
    if (used.has(binding.handler)) {
      if (!same(used.get(binding.handler), contract)) fail('Different OpenAPI operations require distinct upstream handler names');
      continue;
    }
    if (own(raw, 'responseContract')) fail('Contract export does not overwrite an existing responseContract');
    raw.responseContract = contract;
    used.set(binding.handler, contract);
  }
  if (!used.size || Object.keys(result.bindings).some(name => !used.has(name)))
    fail('Every upstream binding must match a selected seller handler');
  return result;
}
