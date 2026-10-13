// SPDX-License-Identifier: MIT
// Published HTTP path inputs share the original Bazaar route identity checks.
import { inspectResourceURL, inspectRouteTemplate, resolveCatalogIdentity } from './identity.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const PARAMETER = /^:([A-Za-z_][A-Za-z0-9_]*)$/;
export const HTTP_PATH_LIMITS = Object.freeze({
  maxKeys:30, maxKeyLength:100, maxValueLength:1024, maxEncodedPathBytes:2048,
});
const fail = (code, message, details) => {
  throw Object.assign(new Error(message), {code, ...(details ? {details} : {})});
};
const text = (value, limit) => typeof value === 'string' && value.length > 0 &&
  value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
const type = value => typeof value === 'string' ? value :
  Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] : null;

function resourceURL(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value) || value.includes('#'))
    fail('PATH_TEMPLATE_MISMATCH', 'The selected resource must have an unambiguous HTTP URL.');
  // The original query codec owns its 8 KiB limit. Inspect the original path
  // before URL normalization without imposing a second query-size limit.
  const inspected = inspectResourceURL(value.split('?', 1)[0]);
  if (!inspected.ok) fail('PATH_TEMPLATE_MISMATCH', 'The selected resource path is invalid.',
    {reason:inspected.reason});
  let url;
  try { url = new URL(value); } catch {
    fail('PATH_TEMPLATE_MISMATCH', 'The selected resource URL is invalid.');
  }
  return url;
}
function schemaFor(record) {
  let value = record.bazaar?.schema;
  for (const key of ['properties','input','properties','pathParams']) {
    if (!object(value) || !own(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function template(value) {
  const inspected = inspectRouteTemplate(value);
  if (!inspected.ok) fail('PATH_SCHEMA_UNSUPPORTED', 'The published route template is invalid.',
    {reason:inspected.reason});
  if (inspected.paramNames.length > HTTP_PATH_LIMITS.maxKeys ||
      inspected.paramNames.some(name => name.length > HTTP_PATH_LIMITS.maxKeyLength))
    fail('PATH_SCHEMA_UNSUPPORTED', 'Path templates support at most 30 parameter names of at most 100 characters.');
  return inspected;
}
function identity(url, method, routeTemplate, pathParams) {
  return resolveCatalogIdentity({resourceURL:url.origin + url.pathname,
    input:{type:'http', method:method ?? 'GET', ...(pathParams === undefined ? {} : {pathParams})},
    routeTemplate});
}
function decodedPath(pathname) {
  try { return pathname.split('/').map(part => decodeURIComponent(part)).join('/'); }
  catch { fail('PATH_TEMPLATE_MISMATCH', 'The resource path has invalid percent encoding.'); }
}

/** Explicit caller values; never infer values from the seller's examples. */
export function normalizeHttpPathInput(value = {}) {
  if (!object(value) || Object.keys(value).length > HTTP_PATH_LIMITS.maxKeys)
    fail('PATH_INPUT_INVALID', 'Path values must be an object with at most 30 fields.');
  return Object.fromEntries(Object.keys(value).sort().map(name => {
    const selected = value[name];
    if (!text(name, HTTP_PATH_LIMITS.maxKeyLength) || !text(selected, HTTP_PATH_LIMITS.maxValueLength))
      fail('PATH_INPUT_INVALID', 'Each path value must be a nonempty, control-free string.',
        {key:name, maxValueLength:HTTP_PATH_LIMITS.maxValueLength});
    // encodeURIComponent rejects incomplete UTF-16 instead of changing a value.
    try { encodeURIComponent(selected); } catch {
      fail('PATH_INPUT_INVALID', 'A path value contains an incomplete Unicode character.', {key:name});
    }
    return [name, selected];
  }));
}

/** Direct published path schema plus bindings present in an actual concrete URL. */
export function describeHttpPath(record) {
  const advertisedUrl = resourceURL(typeof record.resource === 'string' ? record.resource : record.resource?.url);
  const schema = schemaFor(record), examples = object(record.input?.pathParams) ? record.input.pathParams : {};
  if (schema !== undefined && schema !== true && !object(schema))
    fail('PATH_SCHEMA_UNSUPPORTED', 'The published path schema must describe an object.');
  if (object(schema) && schema.type !== undefined && schema.type !== 'object' &&
      !(Array.isArray(schema.type) && schema.type.includes('object')))
    fail('PATH_SCHEMA_UNSUPPORTED', 'The published path schema must allow an object.');
  if (object(schema) && own(schema, 'properties') && !object(schema.properties))
    fail('PATH_SCHEMA_UNSUPPORTED', 'Published path properties must be an object.');
  const properties = object(schema?.properties) ? schema.properties : null;
  const declared = Object.keys(properties ?? examples);
  if (declared.length > 256 || declared.some(name => !text(name, HTTP_PATH_LIMITS.maxKeyLength)))
    fail('PATH_SCHEMA_UNSUPPORTED', 'Path declarations support at most 256 names of at most 100 characters.');
  const required = object(schema) && own(schema, 'required') ? schema.required : [];
  if (!Array.isArray(required) || required.length > HTTP_PATH_LIMITS.maxKeys ||
      new Set(required).size !== required.length ||
      required.some(name => !text(name, HTTP_PATH_LIMITS.maxKeyLength)))
    fail('PATH_SCHEMA_UNSUPPORTED', 'Required path names must be a direct list of unique parameter names.');
  const rawTemplate = record.bazaar?.routeTemplate;
  if (rawTemplate === undefined || rawTemplate === null) {
    if (advertisedUrl.pathname.split('/').some(part => PARAMETER.test(decodeURIComponent(part))))
      fail('PATH_SCHEMA_UNSUPPORTED', 'Published path inputs require a matching routeTemplate.');
    return {routeTemplate:null, advertisedKeys:[], requiredKeys:[], fixedValues:{},
      parameters:[], keysSource:null, valueType:'string', ...HTTP_PATH_LIMITS};
  }
  const selected = template(rawTemplate), keys = selected.paramNames;
  if (declared.some(name => !keys.includes(name)))
    fail('PATH_SCHEMA_UNSUPPORTED', 'Path schema names must belong to the published route template.',
      {keys:declared.filter(name => !keys.includes(name)), advertisedKeys:keys});
  if (required.some(name => !keys.includes(name)))
    fail('PATH_SCHEMA_UNSUPPORTED', 'Required path names must belong to the published route template.');
  const bound = identity(advertisedUrl, record.input?.method, selected.canonicalPath);
  if (bound.status !== 'accepted' || bound.canonicalRouteTemplate !== selected.canonicalPath)
    fail('PATH_TEMPLATE_MISMATCH', 'The advertised resource does not belong to its published route template.',
      {reason:bound.reason ?? 'TEMPLATE_PATH_MISMATCH'});
  // A partially concrete advertisement can fix one segment while retaining
  // another declared placeholder. Only actual values become fixed bindings.
  const fixedValues = Object.fromEntries(Object.entries(bound.pathParams)
    .filter(([name, value]) => value !== ':' + name));
  const keysSource = properties ? 'bazaar.schema.properties.input.properties.pathParams.properties'
    : Object.keys(examples).length ? 'bazaar.info.input.pathParams' : 'bazaar.routeTemplate';
  return {routeTemplate:selected.canonicalPath, advertisedKeys:[...keys],
    requiredKeys:keys.filter(name => !own(fixedValues, name)), fixedValues,
    parameters:keys.map(name => {
      const property = object(properties?.[name]) ? properties[name] : {};
      return {name, required:!own(fixedValues, name), type:type(property.type),
        title:typeof property.title === 'string' ? property.title.slice(0, 256) : null,
        description:typeof property.description === 'string' ? property.description.slice(0, 2048) : null,
        source:properties && own(properties, name) ? keysSource :
          own(examples, name) ? 'bazaar.info.input.pathParams' : 'bazaar.routeTemplate'};
    }), keysSource, valueType:'string', ...HTTP_PATH_LIMITS};
}

/** Bind the explicit concrete URL to the complete original catalog listing. */
export function bindHttpPath(record, requestedURL, claimedValues) {
  const declaration = describeHttpPath(record);
  const advertised = resourceURL(typeof record.resource === 'string' ? record.resource : record.resource?.url);
  const requested = resourceURL(requestedURL);
  if (requested.origin !== advertised.origin)
    fail('PATH_TEMPLATE_MISMATCH', 'The request must retain the selected merchant origin.');
  if (declaration.routeTemplate === null) {
    if (requested.pathname !== advertised.pathname || claimedValues && Object.keys(claimedValues).length)
      fail('PATH_TEMPLATE_MISMATCH', 'The request must retain the selected resource path.');
    return {routeTemplate:null, values:{}, advertisedUrl:advertised.href, requestUrl:requested.href};
  }
  const pattern = declaration.routeTemplate.split('/'), actual = requested.pathname.split('/');
  if (pattern.some((part, index) => PARAMETER.test(part) && actual[index] === part))
    fail('PATH_INPUT_REQUIRED', 'Supply concrete values for the published path parameters.',
      {keys:declaration.advertisedKeys});
  const bound = identity(requested, record.input?.method, declaration.routeTemplate, claimedValues);
  if (bound.status !== 'accepted' || bound.canonicalRouteTemplate !== declaration.routeTemplate)
    fail('PATH_TEMPLATE_MISMATCH', 'The concrete path must match the selected published route template.',
      {reason:bound.reason ?? 'TEMPLATE_PATH_MISMATCH'});
  const conflicting = Object.keys(declaration.fixedValues).filter(name =>
    bound.pathParams[name] !== declaration.fixedValues[name]);
  if (conflicting.length) fail('PATH_TEMPLATE_MISMATCH', 'The request must preserve concrete values in the advertised URL.',
    {keys:conflicting, fixedValues:declaration.fixedValues});
  if (requested.pathname.length > HTTP_PATH_LIMITS.maxEncodedPathBytes)
    fail('PATH_INPUT_INVALID', 'The complete encoded path exceeds 2 KiB.');
  return {routeTemplate:declaration.routeTemplate, values:Object.fromEntries(Object.entries(bound.pathParams)),
    advertisedUrl:advertised.href, requestUrl:requested.href};
}

/** Encode a declared segment for each explicitly selected value. */
export function expandHttpPathTemplate(routeTemplate, input) {
  const selected = template(routeTemplate), values = normalizeHttpPathInput(input);
  const unknown = Object.keys(values).filter(name => !selected.paramNames.includes(name));
  if (unknown.length) fail('PATH_INPUT_NOT_ADVERTISED', 'Path names must belong to the selected route template.',
    {keys:unknown, advertisedKeys:selected.paramNames});
  const missing = selected.paramNames.filter(name => !own(values, name));
  if (missing.length) fail('PATH_INPUT_REQUIRED', 'Supply the required path inputs.', {keys:missing});
  const pathname = selected.canonicalPath.split('/').map(part => {
    const match = PARAMETER.exec(part);
    return match ? encodeURIComponent(values[match[1]]) : part;
  }).join('/');
  if (pathname.length > HTTP_PATH_LIMITS.maxEncodedPathBytes)
    fail('PATH_INPUT_INVALID', 'The complete encoded path exceeds 2 KiB.');
  return pathname;
}

/** Expand one path segment per explicit value, retaining the original query. */
export function prepareHttpPath(record, input = {}) {
  const path = normalizeHttpPathInput(input), declaration = describeHttpPath(record);
  const unknown = Object.keys(path).filter(name => !declaration.advertisedKeys.includes(name));
  if (unknown.length) fail('PATH_INPUT_NOT_ADVERTISED', 'Path names must belong to the selected seller declaration.',
    {keys:unknown, advertisedKeys:declaration.advertisedKeys, keysSource:declaration.keysSource});
  const conflicting = Object.keys(path).filter(name => own(declaration.fixedValues, name) &&
    path[name] !== declaration.fixedValues[name]);
  if (conflicting.length) fail('PATH_TEMPLATE_MISMATCH', 'Path inputs must preserve concrete values in the advertised URL.',
    {keys:conflicting, fixedValues:declaration.fixedValues});
  const values = {...declaration.fixedValues, ...path};
  const missing = declaration.advertisedKeys.filter(name => !own(values, name));
  if (missing.length) fail('PATH_INPUT_REQUIRED', 'Supply the required path inputs.',
    {keys:missing, keysSource:'bazaar.routeTemplate'});
  const url = resourceURL(typeof record.resource === 'string' ? record.resource : record.resource?.url);
  if (declaration.routeTemplate !== null) {
    const pathname = expandHttpPathTemplate(declaration.routeTemplate, values);
    resourceURL(url.origin + pathname); // Inspect before URL can remove dot segments.
    url.pathname = pathname;
    bindHttpPath(record, url.href, values);
  }
  return url;
}

/** Host-owned admission. An omitted template retains exact-path authorization. */
export function matchesHttpRoute(requestedURL, method, route) {
  const requested = resourceURL(requestedURL);
  if (!object(route) || requested.origin !== route.origin || method !== route.method) return false;
  if (route.routeTemplate === undefined || route.routeTemplate === null) return requested.pathname === route.pathname;
  const selected = template(route.routeTemplate), bound = identity(requested, method, selected.canonicalPath);
  return bound.status === 'accepted' && bound.canonicalRouteTemplate === selected.canonicalPath &&
    !selected.canonicalPath.split('/').some((part, index) =>
      PARAMETER.test(part) && requested.pathname.split('/')[index] === part);
}

/** Read-only candidate hint; preparation still binds the actual selected URL. */
export function canUseHttpRoute(record, route) {
  const advertised = resourceURL(typeof record.resource === 'string' ? record.resource : record.resource?.url);
  if (!object(route) || advertised.origin !== route.origin || record.input?.method !== route.method) return false;
  const declaration = describeHttpPath(record);
  if (!declaration.routeTemplate) return matchesHttpRoute(advertised.href, record.input?.method, route);
  const dynamicRoute = route.routeTemplate !== undefined && route.routeTemplate !== null;
  const permitted = dynamicRoute ? template(route.routeTemplate).canonicalPath
    : decodedPath(resourceURL(route.origin + route.pathname).pathname);
  const left = declaration.routeTemplate.split('/'), right = permitted.split('/');
  return left.length === right.length && left.every((part, index) => {
    const parameter = PARAMETER.exec(part);
    const fixed = parameter && own(declaration.fixedValues, parameter[1]);
    const value = fixed ? declaration.fixedValues[parameter[1]] : part;
    return parameter && !fixed || dynamicRoute && PARAMETER.test(right[index]) || value === right[index];
  });
}
