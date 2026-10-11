// MIT. Retain a Postman collection as source for the original merchant compiler.
// This module reads no environment, executes no scripts and performs no requests.
import { createHash } from 'node:crypto';

export const POSTMAN_SOURCE_SCHEMA = 'stellar-forge.postman-source.v1';
const LIMIT = 4 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const methodNames = new Set(['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH']);
const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = message => { throw new TypeError(message); };
const label = value => String(value ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 240);
const tokens = value => typeof value === 'string' ? [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]) : [];

function bounded(value) {
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 60000 || depth > 32) fail('Collection data exceeds the 60,000-value / 32-level source limit');
    if (typeof item === 'number' && (!Number.isFinite(item) || Number.isInteger(item) && !Number.isSafeInteger(item)))
      fail('Use strings for integers outside the exact JavaScript integer range');
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key)) fail('Source contains an unsupported object key');
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
  return value;
}
function parse(text, name) {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > LIMIT)
    fail(name + ' must be a JSON file of at most 4 MiB');
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { fail(name + ' must contain valid JSON'); }
  return bounded(value);
}
function exact(value, keys, name) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('Unexpected ' + name + ' fields');
}
function scalar(value, name) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) fail(name + ' must be a string, number or boolean');
  if (String(value).length > 16384) fail(name + ' exceeds 16 KiB');
  return String(value);
}
function rows(values, name) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 2000 || values.some(value => !plain(value))) fail(name + ' must be a list');
  return values.filter(value => value.disabled !== true && value.enabled !== false);
}
function variableMap(values, name) {
  const result = Object.create(null);
  for (const entry of rows(values, name)) {
    const key = entry.key ?? entry.id;
    if (typeof key !== 'string' || !key || key.length > 200 || forbidden.has(key) || /[{}\u0000-\u001f]/.test(key))
      fail(name + ' needs distinct variable names');
    if (own(result, key)) fail(name + ' contains a repeated variable name: ' + key);
    if (entry.value !== undefined && entry.value !== null) result[key] = scalar(entry.value, 'Variable');
  }
  return result;
}
function objectVariables(value, name) {
  if (!plain(value)) fail(name + ' must map names to sample values');
  return variableMap(Object.entries(value).map(([key, item]) => ({key, value:item})), name);
}
function scriptEvents(value, pointer) {
  rows(value, 'Collection events');
  return (value ?? []).flatMap((event, index) => {
      if (event.disabled === true || event.enabled === false || event.listen !== 'prerequest' || event.script?.disabled === true) return [];
      const code = event.script?.exec;
      if (code !== undefined && typeof code !== 'string' && (!Array.isArray(code) || code.some(line => typeof line !== 'string')))
        fail('Pre-request script source must be text');
      const source = Array.isArray(code) ? code.join('\n') : code ?? '';
      return [{pointer:pointer + '/event/' + index, sha256:sha(source), lines:source ? source.split('\n').length : 0,
        externalSource:Boolean(event.script?.src)}];
    }).filter(event => event.lines || event.externalSource);
}
function normalizeDecisions(value = {}) {
  exact(value, ['publicVariables', 'requests'], 'Postman decision');
  const publicVariables = objectVariables(value.publicVariables ?? {}, 'Public variables');
  const requests = value.requests ?? [];
  if (!Array.isArray(requests) || requests.length > 64) fail('Select at most 64 collection requests');
  const seen = new Set();
  for (const request of requests) {
    exact(request, ['pointer', 'urlSource', 'pathVariables', 'body', 'bodySchema', 'useResolvedValues', 'responseMode'], 'request decision');
    if (typeof request.pointer !== 'string' || seen.has(request.pointer)) fail('Select distinct original request pointers');
    seen.add(request.pointer);
    if (request.urlSource !== undefined && !['structured', 'raw'].includes(request.urlSource)) fail('URL source must be structured or raw');
    if (request.useResolvedValues !== undefined && typeof request.useResolvedValues !== 'boolean') fail('Resolved-values decision must be boolean');
    if (request.responseMode !== undefined && !['json', 'bytes'].includes(request.responseMode)) fail('Response mode must be json or bytes');
    if (request.pathVariables !== undefined) objectVariables(request.pathVariables, 'Path variables');
    if (request.bodySchema !== undefined && !plain(request.bodySchema)) fail('An explicit request schema must be a JSON object');
  }
  bounded(value);
  return {publicVariables, requests:structuredClone(requests)};
}
function source(input) {
  exact(input, ['collectionText', 'environmentText', 'decisions'], 'Postman input');
  const collection = parse(input.collectionText, 'Collection');
  if (!plain(collection) || !plain(collection.info) || !Array.isArray(collection.item) ||
      !/^https?:\/\/schema\.(?:getpostman|postman)\.com\/json\/collection\/v2\.1\.0\/collection\.json$/.test(collection.info.schema ?? ''))
    fail('Export a Postman Collection v2.1 with its original info.schema and item list');
  let environment = null;
  if (input.environmentText !== undefined && input.environmentText !== null && input.environmentText !== '') {
    environment = parse(input.environmentText, 'Environment');
    if (!plain(environment) || !Array.isArray(environment.values)) fail('Select a Postman environment export with a values list');
  }
  const decisions = normalizeDecisions(input.decisions);
  const sourceVariables = {...variableMap(collection.variable, 'Collection variables'),
    ...variableMap(environment?.values, 'Environment variables')};
  const variables = {...sourceVariables, ...decisions.publicVariables};
  const secretVariables = new Set([...rows(collection.variable, 'Collection variables'),
    ...rows(environment?.values, 'Environment variables')].filter(row => row.type === 'secret').map(row => row.key ?? row.id));
  const items = [];
  function visit(group, pointer, parents, inheritedAuth, inheritedScripts) {
    const auth = group.auth ?? inheritedAuth;
    const scripts = [...inheritedScripts, ...scriptEvents(group.event, pointer)];
    for (const [index, item] of group.item.entries()) {
      if (!plain(item)) fail('Each collection item must be an object');
      const next = pointer + '/item/' + index, names = [...parents, label(item.name) || 'Unnamed request'];
      if (Array.isArray(item.item)) visit(item, next, names, auth, scripts);
      else {
        if (items.length >= 2000) fail('Workspace supports at most 2,000 described requests');
        const request = typeof item.request === 'string' ? {method:'GET', url:item.request} : item.request;
        if (!plain(request)) fail('A collection request must be an object or URL string');
        items.push({pointer:next, name:names.join(' / '), item, request,
          auth:request.auth ?? auth, scripts:[...scripts, ...scriptEvents(item.event, next)]});
      }
    }
  }
  visit(collection, '', [], null, []);
  return {collection, environment, decisions, variables, sourceVariables, secretVariables, items};
}
function authAttributes(auth) {
  if (!auth || auth.type === 'noauth') return {};
  if (!plain(auth) || typeof auth.type !== 'string') fail('Authentication must declare a Postman auth type');
  const result = Object.create(null);
  for (const row of rows(auth[auth.type], 'Authentication attributes')) {
    if (typeof row.key !== 'string' || forbidden.has(row.key) || own(result, row.key)) fail('Authentication attributes need distinct names');
    result[row.key] = row.value;
  }
  return result;
}
function headersOf(request) {
  if (typeof request.header === 'string') fail('Export request headers as the standard collection header list');
  return rows(request.header, 'Request headers');
}
function resolver(context, item) {
  const credentials = new Set(context.secretVariables);
  const attributes = authAttributes(item.auth);
  for (const value of Object.values(attributes)) for (const name of tokens(value)) credentials.add(name);
  for (const header of headersOf(item.request)) for (const name of tokens(header.value)) credentials.add(name);
  // Follow the original aliases before applying any public overrides. A nested
  // credential variable cannot become public through a different alias.
  for (const name of credentials) for (const child of tokens(context.sourceVariables[name])) credentials.add(child);
  function expand(value, publicValue = true, stack = []) {
    let text = scalar(value, 'Request value');
    text = text.replace(/\{\{([^{}]+)\}\}/g, (_match, name) => {
      if (stack.includes(name) || stack.length >= 16) fail('Variable expansion contains a cycle or exceeds 16 substitutions');
      if (publicValue && credentials.has(name) && !own(context.decisions.publicVariables, name))
        fail('Variable ' + name + ' is also used in backend credentials or headers; supply a separate public sample override');
      if (!own(context.variables, name)) fail('Supply a public sample for unresolved variable: ' + name);
      return expand(context.variables[name], publicValue, [...stack, name]);
    });
    // Consecutive closing braces are ordinary nested JSON; an opening token
    // remaining after expansion still identifies an unresolved variable.
    if (/\{\{/.test(text)) fail('Request has an unresolved or malformed variable');
    if (text.length > 16384) fail('Resolved request value exceeds 16 KiB');
    return text;
  }
  return {expand, attributes};
}
function queryPairs(values, expand) {
  const entries = rows(values, 'URL query parameters'), seen = new Set();
  return entries.map(entry => {
    const name = expand(entry.key);
    if (!name || forbidden.has(name) || seen.has(name)) fail('Select a request with distinct, nonempty query parameter names');
    seen.add(name);
    if (entry.value === null || entry.value === undefined) fail('A query parameter without an equals value requires explicit source adaptation');
    return [name, expand(entry.value)];
  });
}
function requestUrl(item, decision, expand) {
  const source = item.request.url;
  let raw, query, pathVariables = {};
  const mode = typeof source === 'string' ? 'raw' : decision.urlSource ?? 'structured';
  if (typeof source === 'string') raw = expand(source);
  else if (!plain(source)) fail('Request URL must be a string or a collection URL object');
  else {
    pathVariables = variableMap(source.variable, 'URL path variables');
    if (mode === 'raw') {
      if (typeof source.raw !== 'string') fail('This request has no raw URL to select');
      raw = expand(source.raw);
    } else {
      if (source.auth || source.hash) fail('Remove URL credentials or fragments from the reviewed source request');
      const host = Array.isArray(source.host) ? source.host.join('.') : source.host;
      if (typeof host !== 'string' || !host) fail('URL object has no structured host; choose its raw URL explicitly or repair the collection');
      const protocol = source.protocol ? expand(source.protocol).replace(/:\/\/$/, '') + '://' : '';
      let path = source.path;
      if (Array.isArray(path)) {
        if (path.some(part => typeof part !== 'string')) fail('Structured URL path segments must be strings');
        path = '/' + path.join('/');
      } else if (path !== undefined && typeof path !== 'string') fail('Structured URL path must be a string or list');
      else if (path && !path.startsWith('/')) path = '/' + path;
      raw = protocol + expand(host) + (source.port ? ':' + expand(source.port) : '') + expand(path ?? '');
      query = queryPairs(source.query, expand);
    }
  }
  if (raw.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(raw)) fail('Use an absolute URL with explicitly encoded spaces and no control characters');
  let url;
  try { url = new URL(raw); } catch { fail('Resolved URL must be absolute HTTP or HTTPS'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
    fail('Resolved URL must use HTTP or HTTPS without credentials or fragments');
  // URL construction must not silently collapse a source path or encode it.
  const match = raw.match(/^https?:\/\/[^/?#]+([^?#]*)/i);
  if (!match || (match[1] || '/') !== url.pathname) fail('Resolved URL path normalizes or needs explicit encoding; repair the source before import');
  if (mode === 'structured' && url.search) fail('Structured host/path contains a query; put it in the collection query list');
  if (!query) {
    const values = [...url.searchParams].map(([key, value]) => ({key, value}));
    if (url.search && url.search.slice(1).split('&').some(part => !part.includes('=')))
      fail('A query parameter without an equals value requires explicit source adaptation');
    query = queryPairs(values, value => value);
  }
  const samples = {...pathVariables, ...objectVariables(decision.pathVariables ?? {}, 'Path samples')};
  const parameters = [], requestExample = {pathParams:{}, query:Object.fromEntries(query)};
  const path = url.pathname.split('/').map(segment => {
    if (!segment.startsWith(':')) return segment;
    const name = segment.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || forbidden.has(name) || own(requestExample.pathParams, name))
      fail('Use distinct identifier names for colon path variables');
    const value = own(samples, name) ? expand(samples[name]) : undefined;
    if (value === undefined || !value || value === '.' || value === '..') fail('Supply a nonempty path sample for: ' + name);
    requestExample.pathParams[name] = value;
    parameters.push({name, in:'path', required:true, schema:{type:'string'}, example:value});
    return '{' + name + '}';
  }).join('/');
  if (/[{}]/.test(path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''))) fail('Literal braces in a URL need explicit source adaptation');
  for (const [name, value] of query) parameters.push({name, in:'query', required:false, schema:{type:'string'}, example:value});
  let concrete = path;
  for (const [name, value] of Object.entries(requestExample.pathParams)) concrete = concrete.replace('{' + name + '}', encodeURIComponent(value));
  const resolved = url.origin + concrete + (query.length ? '?' + new URLSearchParams(query).toString() : '');
  return {origin:url.origin + '/', path, resolved, parameters, requestExample, urlSource:mode};
}
function infer(value) {
  if (value === null) return {type:'null'};
  if (Array.isArray(value)) {
    if (!value.length) return {type:'array', items:{}};
    const first = infer(value[0]);
    return {type:'array', items:value.every(item => JSON.stringify(infer(item)) === JSON.stringify(first)) ? first : {}};
  }
  if (plain(value)) return {type:'object', properties:Object.fromEntries(Object.entries(value).map(([key, item]) => [key, infer(item)])), additionalProperties:true};
  return {type:typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value};
}
function bodyOf(item, decision, expand, method) {
  const body = item.request.body;
  const present = body && body.disabled !== true;
  if (!['POST', 'PUT', 'PATCH'].includes(method)) {
    if (present) fail('The original seller does not represent bodies on ' + method + ' requests');
    if (own(decision, 'body') || own(decision, 'bodySchema')) fail('This request has no body to adapt');
    return null;
  }
  if (!present) fail('The original seller requires a declared JSON or multipart body for ' + method);
  let example, schema, mediaType = 'application/json', adaptation = null;
  if (own(decision, 'body')) {
    example = bounded(decision.body);
    adaptation = 'Explicit public JSON body replaces the collection body';
  } else if (body.mode === 'raw') {
    if (body.options?.raw?.language && body.options.raw.language !== 'json')
      fail('A non-JSON raw body requires an explicit reviewed JSON body adaptation');
    const raw = expand(body.raw ?? '');
    try { example = bounded(JSON.parse(raw)); } catch { fail('Raw request body must resolve to exact JSON; supply an explicit public object if it needs adaptation'); }
    adaptation = 'Resolved raw JSON is represented as application/json';
  } else if (body.mode === 'graphql') {
    if (!plain(body.graphql) || typeof body.graphql.query !== 'string') fail('GraphQL body requires query text');
    let variables = body.graphql.variables ?? '{}';
    try { variables = bounded(JSON.parse(expand(typeof variables === 'string' ? variables : JSON.stringify(variables)))); }
    catch { fail('GraphQL variables must resolve to a JSON object'); }
    if (!plain(variables)) fail('GraphQL variables must be an object');
    example = {query:expand(body.graphql.query), variables};
    adaptation = 'GraphQL query and variables are represented as the original JSON HTTP body';
  } else if (body.mode === 'formdata') {
    mediaType = 'multipart/form-data'; example = {}; const properties = {};
    for (const field of rows(body.formdata, 'Multipart fields')) {
      const name = expand(field.key);
      if (!name || forbidden.has(name) || own(properties, name)) fail('Multipart fields need distinct names');
      if (field.contentType) fail('Custom multipart part media types require an explicit JSON adaptation or a dedicated integration');
      if (field.type === 'file') {
        const multiple = Array.isArray(field.src);
        properties[name] = multiple ? {type:'array', items:{type:'string', format:'binary'}} : {type:'string', format:'binary'};
        example[name] = multiple ? field.src.map(() => 'example-file') : 'example-file';
      } else if (!field.type || field.type === 'text') {
        properties[name] = {type:'string'}; example[name] = expand(field.value ?? '');
      } else fail('Multipart fields must use text or file');
    }
    schema = {type:'object', properties, additionalProperties:false};
    adaptation = 'Select actual files later in the original private file-input form; source file paths are never read';
  } else fail('Body mode ' + label(body.mode) + ' needs an explicit reviewed JSON body adaptation');
  if (!plain(example)) fail('The original merchant request body must be a JSON object');
  if (Buffer.byteLength(JSON.stringify(example)) > 8192) fail('Keep the public body sample within 8 KiB');
  schema = decision.bodySchema ?? schema ?? infer(example);
  if (schema.type !== 'object' || !plain(schema.properties)) fail('The reviewed body schema must declare object properties');
  return {requestBody:{required:true, content:{[mediaType]:{schema, example}}}, example, mediaType,
    schemaOrigin:decision.bodySchema ? 'operator-declared' : 'sample-derived', adaptation};
}
function authOf(item, expand, attributes) {
  const type = item.auth?.type ?? 'noauth';
  if (type === 'noauth') return {type, definition:null, header:null};
  if (['bearer', 'basic'].includes(type)) return {type, definition:{type:'http', scheme:type}, header:'authorization'};
  if (type === 'apikey') {
    const location = expand(attributes.in ?? 'header', false);
    if (location !== 'header') fail('Backend API keys in query parameters need a dedicated private transport; choose a header-authenticated request');
    const name = expand(attributes.key, false).toLowerCase();
    if (!headerName.test(name) || name.length > 200) fail('Backend API key header name is invalid');
    return {type, definition:{type:'apiKey', in:'header', name}, header:name};
  }
  if (type === 'oauth2') {
    if (attributes.grant_type !== 'client_credentials') fail('Select an OAuth client-credentials request with a declared token endpoint');
    const tokenUrl = expand(attributes.accessTokenUrl, false), scope = attributes.scope ? expand(attributes.scope, false) : '';
    const url = new URL(tokenUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) fail('OAuth token endpoint must be HTTPS without URL credentials, query or fragment');
    const scopes = scope ? scope.split(' ') : [];
    if (new Set(scopes).size !== scopes.length || scopes.some(value => !value)) fail('OAuth scopes must be distinct space-separated values');
    return {type, definition:{type:'oauth2', flows:{clientCredentials:{tokenUrl:url.href, scopes:Object.fromEntries(scopes.map(value => [value, 'Declared collection scope']))}}}, header:'authorization', scopes};
  }
  fail('Authentication type ' + label(type) + ' requires a dedicated original backend integration');
}
function convert(context, item, decision, requireAcknowledgement) {
  const method = String(item.request.method ?? 'GET').toUpperCase();
  if (!methodNames.has(method)) fail('The original seller does not support method ' + label(method));
  if (requireAcknowledgement && item.scripts.length && decision.useResolvedValues !== true)
    fail('Acknowledge the selected resolved request values for pre-request scripts in ' + item.pointer);
  const {expand, attributes} = resolver(context, item), url = requestUrl(item, decision, expand);
  const body = bodyOf(item, decision, expand, method), auth = authOf(item, expand, attributes);
  const requiredHeaders = new Set(), observed = new Set();
  for (const row of headersOf(item.request)) {
    const name = expand(row.key, false).toLowerCase();
    if (!headerName.test(name) || name.length > 200 || observed.has(name)) fail('Request headers need distinct valid names');
    observed.add(name);
    if (name === 'content-type') {
      const type = expand(row.value, false).split(';')[0].trim().toLowerCase();
      if (!body || type !== body.mediaType) fail('Declared Content-Type differs from the reviewed native body representation');
    } else requiredHeaders.add(name);
  }
  if (auth.header && auth.type !== 'oauth2') requiredHeaders.add(auth.header);
  if (auth.type === 'oauth2' && requiredHeaders.has('authorization')) fail('Remove the static authorization header when selecting original OAuth client credentials');
  const id = 'postman_' + sha(item.pointer).slice(0, 12), scheme = id + '_auth';
  const headerEnv = Object.fromEntries([...requiredHeaders].sort().map(name => [name, ('POSTMAN_' + id.slice(-6) + '_' + name.replace(/[^A-Za-z0-9_]/g, '_')).toUpperCase()]));
  const operation = {operationId:id, summary:label(item.item.name) || 'Imported API request', servers:[{url:url.origin}],
    parameters:url.parameters, security:auth.definition ? [{[scheme]:auth.scopes ?? []}] : [],
    responses:{default:{description:'Upstream response; collection examples are not a complete response contract'}},
    'x-stellar-postman':{pointer:item.pointer, requiredBackendHeaders:[...requiredHeaders].sort(),
      requestSchemaOrigin:body?.schemaOrigin ?? null, responseSchemaOrigin:'not-declared'},
    ...(body ? {requestBody:body.requestBody} : {})};
  const requestExample = {...url.requestExample, ...(body ? {body:body.example} : {})};
  const plan = {method, path:url.path, id, serverIndex:0, headerEnv, responseMode:decision.responseMode ?? 'json',
    responseValidation:'none', requestExample,
    ...(auth.type === 'oauth2' ? {oauth2:{clientIdEnv:(id + '_CLIENT_ID').toUpperCase(), clientSecretEnv:(id + '_CLIENT_SECRET').toUpperCase(),
      ...(auth.scopes.length ? {scope:auth.scopes.join(' ')} : {})}} : {})};
  const responseExamples = rows(item.item.response, 'Saved responses').map(value => ({status:value.code ?? null,
    bytes:typeof value.body === 'string' ? Buffer.byteLength(value.body) : 0}));
  return {method, path:url.path, operation, scheme, definition:auth.definition, plan,
    review:{pointer:item.pointer, name:item.name, method, resolvedUrl:url.resolved, backend:url.origin,
      path:url.path, urlSource:url.urlSource, auth:auth.type, backendHeaders:[...requiredHeaders].sort(),
      requestExample, bodyMediaType:body?.mediaType ?? null, requestSchema:body?.requestBody.content[body.mediaType].schema ?? null,
      requestSchemaOrigin:body?.schemaOrigin ?? null, bodyAdaptation:body?.adaptation ?? null,
      responseMode:plan.responseMode, responseValidation:'none', responseExamples,
      preRequestScripts:item.scripts, scriptsAccepted:decision.useResolvedValues === true}};
}

/** List actual source requests and their concrete import decisions, without IO. */
export function inspectPostman(input) {
  const context = source(input), selections = new Map(context.decisions.requests.map(value => [value.pointer, value]));
  const requests = context.items.map(item => {
    const decision = selections.get(item.pointer) ?? {pointer:item.pointer};
    try { return {...convert(context, item, decision, false).review, supported:true}; }
    catch (error) { return {pointer:item.pointer, name:item.name, method:label(item.request.method ?? 'GET'),
      preRequestScripts:item.scripts, supported:false, error:error.message}; }
  });
  return {title:label(context.collection.info.name), collectionSha256:sha(input.collectionText),
    environment:context.environment ? label(context.environment.name) : null,
    environmentSha256:context.environment ? sha(input.environmentText) : null,
    variableNames:Object.keys(context.variables).sort(), requests};
}
function generated(input) {
  const context = source(input);
  if (!context.decisions.requests.length) fail('Select at least one original collection request');
  const items = new Map(context.items.map(value => [value.pointer, value])), selected = [], paths = {}, securitySchemes = {};
  for (const decision of context.decisions.requests) {
    const item = items.get(decision.pointer);
    if (!item) fail('Selected request is absent from the retained collection: ' + decision.pointer);
    const value = convert(context, item, decision, true);
    paths[value.path] ??= {};
    if (own(paths[value.path], value.method.toLowerCase())) fail('Select one source request for ' + value.method + ' ' + value.path + '; separate examples cannot silently overwrite a merchant route');
    paths[value.path][value.method.toLowerCase()] = value.operation;
    if (value.definition) securitySchemes[value.scheme] = value.definition;
    selected.push(value);
  }
  const document = {openapi:'3.1.0', info:{title:label(context.collection.info.name) || 'Collection merchant', version:'1'},
    paths, ...(Object.keys(securitySchemes).length ? {components:{securitySchemes}} : {})};
  return {context, document, selected};
}
/** This exact packet is accepted by existing savePackage/readPackage and refresh. */
export function preparePostmanSource(input) {
  const {context, document, selected} = generated(input);
  const packet = {schema:POSTMAN_SOURCE_SCHEMA, collectionText:input.collectionText,
    environmentText:context.environment ? input.environmentText : null, decisions:context.decisions,
    hashes:{collection:sha(input.collectionText), environment:context.environment ? sha(input.environmentText) : null,
      decisions:sha(json(context.decisions)), document:sha(json(document))}};
  const specText = json(packet);
  if (Buffer.byteLength(specText) > LIMIT) fail('The retained collection, environment and decisions exceed the original 4 MiB source limit');
  return {specText, review:{title:document.info.title, ...packet.hashes, requests:selected.map(value => value.review)},
    operations:selected.map(value => value.plan)};
}
export function openPostmanSource(packet) {
  exact(packet, ['schema', 'collectionText', 'environmentText', 'decisions', 'hashes'], 'retained Postman source');
  if (packet.schema !== POSTMAN_SOURCE_SCHEMA) fail('Not a retained Postman source');
  const input = {collectionText:packet.collectionText, environmentText:packet.environmentText, decisions:packet.decisions};
  const prepared = preparePostmanSource(input), expected = JSON.parse(prepared.specText);
  exact(packet.hashes, ['collection', 'environment', 'decisions', 'document'], 'Postman source hashes');
  if (Object.entries(expected.hashes).some(([key, value]) => packet.hashes[key] !== value))
    fail('Retained Postman source or decisions changed; prepare a new reviewed source packet');
  const {document} = generated(input);
  return {document, summary:prepared.review, operations:prepared.operations};
}

/** The original transport still validates header names, values and auth policy. */
export function requirePostmanHeaderReferences(operation, headers) {
  const metadata = operation['x-stellar-postman'];
  if (metadata === undefined) return;
  if (!plain(metadata) || !Array.isArray(metadata.requiredBackendHeaders) ||
      metadata.requiredBackendHeaders.some(name => typeof name !== 'string' || !headerName.test(name)))
    fail('Invalid retained Postman backend-header declaration');
  const mapped = new Set(Object.keys(headers).map(name => name.toLowerCase()));
  for (const name of metadata.requiredBackendHeaders) if (!mapped.has(name.toLowerCase()))
    fail('Map the imported ' + name + ' backend header to an environment-variable reference before preparing the merchant');
}
