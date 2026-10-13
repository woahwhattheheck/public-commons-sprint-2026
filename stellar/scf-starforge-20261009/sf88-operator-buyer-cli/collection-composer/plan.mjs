// MIT — Explicit reusable plans for the original SF88 request collections.
export const COLLECTION_PLAN_SCHEMA = 'stellar-forge.sf88.collection-plan.v1';
export const COLLECTION_EDITION_SCHEMA = 'stellar-forge.sf88.collection-edition.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const PARAM = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PATHS = ['discoveryFile', 'bodyFile', 'ticketFile', 'responseOut'];
export const need = (ok, code) => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function fields(value, allowed, code = 'COLLECTION_PLAN_FIELDS_INVALID') {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)), code);
  return value;
}
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  const encoded = JSON.stringify(value);
  need(encoded !== undefined, 'COLLECTION_PLAN_VALUE_INVALID');
  return encoded;
}
function text(value, maximum, code, empty = false) {
  need(typeof value === 'string' && value.length <= maximum
    && (empty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value), code);
  return value;
}
function id(value, key = false) {
  need((key ? KEY : ID).test(value ?? ''), 'COLLECTION_PLAN_ID_INVALID');
  return value;
}
function template(value, names, code) {
  text(value, 8192, code);
  const residue = value.replace(TOKEN, (_, name) => {
    need(names.has(name), 'COLLECTION_PLAN_PARAMETER_UNKNOWN');
    return '';
  });
  need(!residue.includes('{{') && !residue.includes('}}'), 'COLLECTION_PLAN_TEMPLATE_INVALID');
  return value;
}
function fixedPath(value) {
  text(value, 8192, 'COLLECTION_PLAN_OPERATOR_PATH_REQUIRED');
  need(value.startsWith('/') && value !== '/' && !value.includes('{{')
    && !value.includes('}}'), 'COLLECTION_PLAN_OPERATOR_PATH_REQUIRED');
  return value;
}
export function validateCollectionPlan(input) {
  fields(input, ['schema', 'id', 'name', 'description', 'parameters', 'requests']);
  need(input.schema === COLLECTION_PLAN_SCHEMA, 'COLLECTION_PLAN_SCHEMA_INVALID');
  id(input.id); text(input.name, 160, 'COLLECTION_PLAN_NAME_REQUIRED');
  if (input.description !== undefined) text(input.description, 2000, 'COLLECTION_PLAN_DESCRIPTION_INVALID', true);
  const parameters = input.parameters ?? [];
  need(Array.isArray(parameters) && parameters.length <= 32, 'COLLECTION_PLAN_PARAMETERS_INVALID');
  const names = new Set();
  for (const parameter of parameters) {
    fields(parameter, ['name', 'label', 'default']);
    need(PARAM.test(parameter.name ?? '') && !names.has(parameter.name), 'COLLECTION_PLAN_PARAMETER_INVALID');
    names.add(parameter.name);
    if (parameter.label !== undefined) text(parameter.label, 160, 'COLLECTION_PLAN_PARAMETER_LABEL_INVALID');
    if (parameter.default !== undefined) text(parameter.default, 2048, 'COLLECTION_PLAN_PARAMETER_VALUE_INVALID', true);
  }
  need(Array.isArray(input.requests) && input.requests.length >= 1 && input.requests.length <= 500,
    'COLLECTION_PLAN_REQUESTS_REQUIRED');
  const keys = new Set();
  for (const request of input.requests) {
    fields(request, ['key', 'name', 'discoveryFile', 'rowIndex', 'acceptIndex', 'url', 'method',
      'operatorWorkspace', 'operatorConfigFile', 'bodyFile', 'headers', 'ticketFile', 'ticketHeader', 'responseOut']);
    id(request.key, true);
    need(!keys.has(request.key), 'COLLECTION_PLAN_DUPLICATE_REQUEST'); keys.add(request.key);
    text(request.name, 160, 'COLLECTION_PLAN_REQUEST_NAME_REQUIRED');
    for (const key of ['rowIndex', 'acceptIndex'])
      need(Number.isSafeInteger(request[key]) && request[key] >= 0, 'COLLECTION_PLAN_SELECTION_REQUIRED');
    need(METHODS.has(request.method), 'COLLECTION_PLAN_METHOD_INVALID');
    template(request.url, names, 'COLLECTION_PLAN_URL_REQUIRED');
    // Parameters change query values. Merchant identity and path stay explicit.
    const question = request.url.indexOf('?');
    const beforeQuery = question === -1 ? request.url : request.url.slice(0, question);
    need(!beforeQuery.includes('{{') && !request.url.includes('#'), 'COLLECTION_PLAN_QUERY_PARAMETERS_ONLY');
    let url;
    try { url = new URL(request.url.replace(TOKEN, 'value')); } catch {}
    need(url?.protocol === 'https:' && !url.username && !url.password, 'COLLECTION_PLAN_HTTPS_REQUIRED');
    need(request.discoveryFile !== undefined, 'COLLECTION_PLAN_DISCOVERY_REQUIRED');
    for (const key of PATHS) if (request[key] !== undefined) {
      template(request[key], names, 'COLLECTION_PLAN_PATH_INVALID');
      need(request[key].startsWith('/') && request[key] !== '/', 'COLLECTION_PLAN_PATH_INVALID');
    }
    need((request.operatorWorkspace !== undefined) !== (request.operatorConfigFile !== undefined),
      'COLLECTION_PLAN_ONE_OPERATOR_REQUIRED');
    if (request.operatorWorkspace !== undefined) fixedPath(request.operatorWorkspace);
    if (request.operatorConfigFile !== undefined) fixedPath(request.operatorConfigFile);
    if (request.headers !== undefined) {
      need(plain(request.headers) && Object.keys(request.headers).length <= 64, 'COLLECTION_PLAN_HEADERS_INVALID');
      for (const [name, value] of Object.entries(request.headers)) {
        text(name, 256, 'COLLECTION_PLAN_HEADERS_INVALID');
        text(value, 8192, 'COLLECTION_PLAN_HEADERS_INVALID', true);
        need(!value.includes('{{') && !value.includes('}}'), 'COLLECTION_PLAN_HEADERS_ARE_LITERAL');
      }
    }
    if (request.ticketHeader !== undefined) {
      text(request.ticketHeader, 256, 'COLLECTION_PLAN_TICKET_HEADER_INVALID');
      need(request.ticketFile !== undefined, 'COLLECTION_PLAN_TICKET_FILE_REQUIRED');
    }
    need(!['GET', 'HEAD'].includes(request.method) || request.bodyFile === undefined,
      'COLLECTION_PLAN_BODY_DISALLOWED');
  }
  const result = JSON.parse(JSON.stringify({ ...input, parameters }));
  need(new TextEncoder().encode(stableJson(result)).length < 1024 * 1024, 'COLLECTION_PLAN_TOO_LARGE');
  return result;
}
function substitute(value, values, kind) {
  return value.replace(TOKEN, (_, name) => {
    const selected = values[name];
    if (kind === 'query') return encodeURIComponent(selected);
    need(selected.length > 0 && selected !== '.' && selected !== '..'
      && !/[\/\\]/.test(selected), 'COLLECTION_PLAN_PATH_PARAMETER_INVALID');
    return selected;
  });
}
/** Select a later period explicitly. The same collection/key retains its intent. */
export function resolveCollectionEdition(planInput, input) {
  const plan = validateCollectionPlan(planInput);
  fields(input, ['planId', 'planSha256', 'collectionId', 'name', 'values'], 'COLLECTION_EDITION_INPUT_INVALID');
  need(input.planId === plan.id && HASH.test(input.planSha256 ?? ''), 'COLLECTION_EDITION_PLAN_REQUIRED');
  id(input.collectionId);
  text(input.name, 160, 'COLLECTION_EDITION_NAME_REQUIRED');
  const supplied = input.values ?? {}, allowed = new Set(plan.parameters.map(item => item.name));
  need(plain(supplied) && Object.keys(supplied).every(key => allowed.has(key)),
    'COLLECTION_PLAN_PARAMETER_UNKNOWN');
  const values = {};
  for (const parameter of plan.parameters) {
    const value = Object.hasOwn(supplied, parameter.name) ? supplied[parameter.name] : parameter.default;
    text(value, 2048, 'COLLECTION_PLAN_PARAMETER_VALUE_REQUIRED', true);
    values[parameter.name] = value;
  }
  const requests = plan.requests.map(request => {
    const resolved = { ...request, intentId: input.collectionId + ':' + request.key,
      url: substitute(request.url, values, 'query') };
    for (const key of PATHS)
      if (request[key] !== undefined) resolved[key] = substitute(request[key], values, 'path');
    return resolved;
  });
  return { schema: 'stellar-forge.sf88.collection-edition-request.v1',
    collectionId: input.collectionId, name: input.name, planId: plan.id,
    planSha256: input.planSha256, values, requests };
}
