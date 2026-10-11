// MIT. Live request admission for actual SF30/SF61 imported seller offers.
// Reuses the exact original SF25 Draft 2020-12 validator; never touches payment.
import { validateBazaarExtension } from '../../../stellar-forge/payment-auto-catalog/schema-validation.mjs';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const decimalInteger = /^-?(?:0|[1-9][0-9]*)$/;
const decimalNumber = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

const rejected = (code = 'LIVE_REQUEST_SCHEMA_REJECTED', issues = []) => ({
  status: 422,
  body: { error: code, ...(issues.length ? { issues: issues.slice(0, 5) } : {}) },
});

/** OpenAPI simple-form scalar query parameters arrive from Node HTTP as strings.
 * Convert ONLY the explicitly declared scalar types for schema evaluation. */
function queryValue(value, property) {
  if (typeof value !== 'string' || !object(property) || Array.isArray(property.type)) {
    return { ok: false };
  }
  const type = property.type;
  if (type === 'string') return { ok: true, value };
  if (type === 'boolean') {
    if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' };
    return { ok: false };
  }
  if (type === 'integer' && decimalInteger.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? { ok: true, value: number } : { ok: false };
  }
  if (type === 'number' && decimalNumber.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) ? { ok: true, value: number } : { ok: false };
  }
  // The original SF61 OpenAPI importer does not support object/array or custom
  // query serialization; do not invent implicit coercions here.
  return { ok: false };
}

function normalizeQuery(query, schema) {
  if (!object(query)) return { ok: false };
  if (!schema) return Object.keys(query).length ? { ok: false } : { ok: true };
  if (!object(schema) || schema.type !== 'object' || !object(schema.properties)) return { ok: false };
  const result = Object.create(null);
  for (const [key, value] of Object.entries(query)) {
    if (!own(schema.properties, key)) return { ok: false };
    const parsed = queryValue(value, schema.properties[key]);
    if (!parsed.ok) return { ok: false };
    result[key] = parsed.value;
  }
  return { ok: true, value: result };
}

/** Construct one trusted admission callback per ORIGINAL imported offer.
 *
 * At runtime the SF30 resource router has already selected method/path and
 * decoded pathParams. It invokes this callback only in NATIVE_X402 mode before
 * processHTTPRequest, never during challenge-only metadata display.
 */
export function createLiveRequestAdmission(offer) {
  const extension = offer?.extensions?.bazaar;
  const verification = validateBazaarExtension(extension);
  if (!verification.ok) throw new TypeError('Original imported Bazaar schema is invalid: ' + verification.reason);
  const reference = extension.info?.input;
  const schemaInput = extension.schema?.properties?.input;
  if (!object(reference) || reference.type !== 'http' ||
      !supportsSellerMethod(reference.method) ||
      !object(schemaInput) || !object(schemaInput.properties)) {
    throw new TypeError('A supported SF30 HTTP Bazaar offer is required');
  }
  const properties = schemaInput.properties;
  const querySchema = properties.queryParams;
  const pathSchema = properties.pathParams;
  const bodySchema = properties.body;
  // A genuine imported schema, not an advertiser-supplied "required" guess.
  const method = reference.method;
  const originalInfo = structuredClone(extension.info);
  const originalSchema = structuredClone(extension.schema);

  return function admitLiveRequest(context) {
    if (!object(context) || context.method !== method || context.signal?.aborted) {
      return rejected('LIVE_REQUEST_METHOD_REJECTED');
    }
    const query = normalizeQuery(context.query ?? {}, querySchema);
    if (!query.ok) return rejected('LIVE_QUERY_PARAMETERS_REJECTED');
    const input = structuredClone(originalInfo.input);
    // Strip the seller's examples; they MUST NOT satisfy actual request fields.
    delete input.queryParams;
    delete input.pathParams;
    delete input.body;
    if (querySchema) input.queryParams = query.value;
    if (pathSchema) {
      if (!object(context.pathParams)) return rejected('LIVE_PATH_PARAMETERS_REJECTED');
      input.pathParams = { ...context.pathParams };
    } else if (context.pathParams && Object.keys(context.pathParams).length) {
      return rejected('LIVE_PATH_PARAMETERS_REJECTED');
    }
    if (bodySchema) {
      const absent=context.bodyPresent===false||context.bodyPresent===undefined&&context.body===undefined;
      if (!absent || schemaInput.required?.includes('body')) input.body = context.body === undefined ? null : context.body;
    } else if (context.body !== undefined && context.body !== null) {
      return rejected('LIVE_BODY_NOT_DECLARED');
    }
    const check = validateBazaarExtension({
      info: { ...originalInfo, input },
      schema: originalSchema,
    });
    if (!check.ok) {
      // Exact original schema failures, but never echo input values or payload.
      const issues = (check.errors ?? []).filter(x => typeof x === 'string')
        .map(x => x.slice(0, 160));
      return rejected('LIVE_REQUEST_SCHEMA_REJECTED', issues);
    }
    return true;
  };
}

/** Convenience adapter for the exact operator-created seller-service config.
 * Export the returned function under a route's existing admit binding name.
 */
export function admissionForServiceRoute(config, id) {
  if (config?.schema !== 'stellar-forge.seller-service.v1' || !Array.isArray(config.routes)) {
    throw new TypeError('Original SF30 seller-service config required');
  }
  const routes = config.routes.filter(route => route?.id === id);
  if (routes.length !== 1 || !object(routes[0].offer)) {
    throw new TypeError('Expected exactly one original imported offer with route id ' + id);
  }
  return createLiveRequestAdmission(routes[0].offer);
}
