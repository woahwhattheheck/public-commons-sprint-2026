// SPDX-License-Identifier: MIT
import { posix } from 'node:path';
import { object, copy, hashJSON, sha256, requireValue, text } from './contract.mjs';

const HTTP_METHODS = ['get','put','post','delete','options','head','patch','trace'];
const MIME = value => /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/.test(value);
export function sourcePath(value) {
  text(value, 'source path', 2048);
  requireValue(!value.startsWith('/') && !value.includes('\\') && !value.split('/').some(p => p === '..' || p === '.' || !p), 'SOURCE_PATH_INVALID');
  return value;
}
export function normalizeSourceFiles(input) {
  requireValue(Array.isArray(input) && input.length > 0 && input.length <= 10000, 'SOURCE_FILES_REQUIRED');
  const seen = new Set(); let total = 0;
  return input.map(file => {
    const path = sourcePath(file.path);
    requireValue(!seen.has(path), 'DUPLICATE_SOURCE_PATH'); seen.add(path);
    requireValue(typeof file.content === 'string' || typeof file.base64 === 'string', 'SOURCE_CONTENT_REQUIRED');
    const bytes = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : Buffer.from(file.base64, 'base64');
    total += bytes.length; requireValue(total <= 128 * 1024 * 1024, 'SOURCE_BUNDLE_TOO_LARGE');
    const digest = sha256(bytes);
    if (file.sha256) requireValue(file.sha256 === digest, 'SOURCE_DIGEST_MISMATCH');
    return { path, mediaType: file.mediaType ?? 'application/octet-stream', bytes: bytes.length, sha256: digest,
      base64: bytes.toString('base64'), text: typeof file.content === 'string' ? file.content : null };
  });
}
async function parseStructured(value, path, originals, stack = []) {
  requireValue(Buffer.byteLength(value,'utf8')<=4*1024*1024,'SOURCE_DOCUMENT_TOO_LARGE','Each parsed source document must fit within 4 MiB; the complete original bundle can include larger media and source assets.');
  requireValue(stack.length < 64 && !stack.includes(path), 'SOURCE_INCLUDE_CYCLE', 'Source includes contain a cycle at ' + path);
  try { return JSON.parse(value); } catch {}
  const { parseDocument } = await import('yaml');
  const document = parseDocument(value, { uniqueKeys: true, strict: true,
    customTags: [{ tag: '!include', resolve: value => ({ $ramlInclude: String(value) }) }] });
  requireValue(document.errors.length === 0 && document.warnings.length === 0, 'SOURCE_YAML_INVALID', [...document.errors,...document.warnings].map(x => x.message).join('\n'));
  const data = document.toJS({ maxAliasCount: 100 });
  async function include(node) {
    if (Array.isArray(node)) return Promise.all(node.map(include));
    if (!object(node)) return node;
    if (typeof node.$ramlInclude === 'string') {
      requireValue(!/^[a-z][a-z0-9+.-]*:/i.test(node.$ramlInclude) && !node.$ramlInclude.startsWith('/'), 'LOCAL_INCLUDE_REQUIRED', 'Package this source include with the original files: ' + node.$ramlInclude);
      const relative = posix.normalize(posix.join(posix.dirname(path), node.$ramlInclude));
      sourcePath(relative);
      const original = originals.get(relative);
      requireValue(original, 'SOURCE_INCLUDE_MISSING', 'The source bundle is missing ' + relative);
      const source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(original.base64, 'base64'));
      if (/\.(?:raml|yaml|yml|json)$/i.test(relative)) return parseStructured(source, relative, originals, [...stack, path]);
      return source;
    }
    const result = Object.create(null);
    for (const [key, item] of Object.entries(node)) result[key] = await include(item);
    return result;
  }
  return include(data);
}
function ramlSchema(value, knownTypes, findings, location) {
  if (typeof value === 'string') {
    if (value.endsWith('[]')) return { type: 'array', items: ramlSchema(value.slice(0, -2), knownTypes, findings, location) };
    if (value.includes('|')) return { oneOf: value.split('|').map(x => ramlSchema(x.trim(), knownTypes, findings, location)) };
    if (['string','number','integer','boolean','object','array'].includes(value)) return { type: value };
    if (value === 'nil') return { nullable: true };
    if (value === 'date-only') return { type: 'string', format: 'date' };
    if (['datetime','datetime-only','time-only'].includes(value)) return { type: 'string', ...(value === 'datetime' ? { format: 'date-time' } : {}) };
    if (value === 'file') return { type: 'string', format: 'binary' };
    if (knownTypes.has(value)) return { $ref: '#/components/schemas/' + value.replaceAll('~','~0').replaceAll('/','~1') };
    findings.push({ code: 'RAML_TYPE_REQUIRES_MAPPING', location, detail: value }); return { 'x-raml-type': value };
  }
  if (Array.isArray(value)) return { allOf: value.map(v => ramlSchema(v, knownTypes, findings, location)) };
  if (!object(value)) return { type: 'string' };
  let result = ramlSchema(value.type ?? (value.properties ? 'object' : 'string'), knownTypes, findings, location);
  if (value.items) result.items = ramlSchema(value.items, knownTypes, findings, location + '/items');
  if (value.properties) {
    const properties = Object.create(null), required = [];
    for (const [name, definition] of Object.entries(value.properties)) {
      const key = name.endsWith('?') ? name.slice(0, -1) : name;
      properties[key] = ramlSchema(definition, knownTypes, findings, location + '/properties/' + key);
      if (!name.endsWith('?') && definition?.required !== false) required.push(key);
    }
    result = { ...result, type: 'object', properties }; if (required.length) result.required = required;
  }
  for (const key of ['description','enum','default','minimum','maximum','minLength','maxLength','pattern','minItems','maxItems','uniqueItems','additionalProperties']) if (value[key] !== undefined) result[key] = copy(value[key]);
  if (value.example !== undefined) result.example = copy(value.example?.value ?? value.example);
  if (value.examples !== undefined) result['x-raml-examples'] = copy(value.examples);
  if (value.discriminator !== undefined) result.discriminator = { propertyName: value.discriminator };
  for (const key of ['facets','discriminatorValue','xml','format']) if (value[key] !== undefined) findings.push({ code:'RAML_FACET_REQUIRES_MAPPING', location, detail:key });
  return result;
}
function ramlToOpenAPI(document, findings) {
  const types = object(document.types) ? document.types : {}, known = new Set(Object.keys(types));
  const api = { openapi:'3.0.3', info:{ title:document.title ?? 'Imported RAML API', version:String(document.version ?? '1.0'), ...(document.description ? { description:document.description } : {}) },
    paths:{}, components:{ schemas:{} }, 'x-original-dialect':'RAML 1.0' };
  for (const [name, definition] of Object.entries(types)) api.components.schemas[name] = ramlSchema(definition, known, findings, 'types/' + name);
  if (document.baseUri) {
    const variables = {};
    for (const [name, value] of Object.entries(document.baseUriParameters ?? {})) variables[name] = { default:String(value.default ?? value.example ?? ''), ...(value.enum ? { enum:value.enum.map(String) } : {}) };
    if (String(document.baseUri).includes('{version}')) variables.version = { default:api.info.version };
    api.servers = [{ url:String(document.baseUri), ...(Object.keys(variables).length ? { variables } : {}) }];
  }
  const unsupported = ['traits','resourceTypes','uses','securitySchemes','securedBy','annotationTypes','schemas'];
  for (const key of unsupported) if (document[key] !== undefined) findings.push({ code:'RAML_BEHAVIOR_REQUIRES_MAPPING', location:key, detail:'The original '+key+' is preserved and needs an explicit Gravitee policy or source transformation mapping.' });
  function parameters(input, location, inherited = []) {
    const result = inherited.map(copy);
    for (const [inType, field] of [['path','uriParameters'],['query','queryParameters'],['header','headers']]) for (const [name, definition] of Object.entries(input[field] ?? {})) {
      const key = name.endsWith('?') ? name.slice(0,-1) : name;
      const entry = { name:key, in:inType, required:inType === 'path' || (!name.endsWith('?') && definition?.required !== false),
        schema:ramlSchema(definition, known, findings, location+'/'+field+'/'+key) };
      if (definition?.description) entry.description = definition.description;
      const prior = result.findIndex(x => x.name === key && x.in === inType); if (prior >= 0) result[prior] = entry; else result.push(entry);
    }
    return result;
  }
  function content(body, location) {
    if (!object(body)) return undefined;
    const output = Object.create(null);
    for (const [mime, definition] of Object.entries(body)) {
      if (!MIME(mime)) { findings.push({ code:'RAML_BODY_REQUIRES_MAPPING', location, detail:mime }); continue; }
      output[mime] = { schema:ramlSchema(definition, known, findings, location+'/'+mime) };
      if (definition?.example !== undefined) output[mime].example = copy(definition.example?.value ?? definition.example);
    }
    return Object.keys(output).length ? output : undefined;
  }
  function resource(node, path, inherited = []) {
    const common = parameters(node, path, inherited);
    for (const key of ['is','type','securedBy']) if (node[key] !== undefined) findings.push({ code:'RAML_RESOURCE_BEHAVIOR', location:path, detail:key });
    for (const method of HTTP_METHODS) if (object(node[method])) {
      const original = node[method], operation = { responses:{} };
      if (original.displayName) operation.summary = original.displayName;
      if (original.description) operation.description = original.description;
      operation.operationId = method + '_' + path.replace(/[^A-Za-z0-9]+/g,'_');
      operation.parameters = parameters(original, path+'/'+method, common);
      for (const match of path.matchAll(/\{([^}]+)\}/g)) if (!operation.parameters.some(p => p.in === 'path' && p.name === match[1])) operation.parameters.push({ name:match[1], in:'path', required:true, schema:{ type:'string' } });
      const body = content(original.body, path+'/'+method+'/body'); if (body) operation.requestBody = { content:body };
      for (const [status, response] of Object.entries(original.responses ?? {})) {
        const code = /^\d{3}$/.test(status) ? status : 'default';
        const value = { description:response?.description ?? 'RAML response ' + status };
        const body = content(response?.body, path+'/'+method+'/responses/'+status); if (body) value.content = body;
        const headers = parameters({ headers:response?.headers }, path).filter(x => x.in === 'header');
        if (headers.length) value.headers = Object.fromEntries(headers.map(h => [h.name,{ schema:h.schema, ...(h.description ? { description:h.description } : {}) }]));
        operation.responses[code] = value;
      }
      if (!Object.keys(operation.responses).length) operation.responses.default = { description:'Response unspecified in the original RAML source' };
      for (const key of ['is','securedBy','protocols']) if (original[key] !== undefined) findings.push({ code:'RAML_OPERATION_BEHAVIOR', location:path+'/'+method, detail:key });
      (api.paths[path] ??= {})[method] = operation;
    }
    for (const [key, child] of Object.entries(node)) if (key.startsWith('/') && object(child)) resource(child, path+key, common);
  }
  for (const [path, resourceBody] of Object.entries(document)) if (path.startsWith('/') && object(resourceBody)) resource(resourceBody, path);
  return api;
}
function inspectOpenAPI(document, findings) {
  requireValue(object(document.paths), 'SOURCE_PATHS_REQUIRED');
  const routes = [];
  for (const [path, resource] of Object.entries(document.paths)) for (const method of HTTP_METHODS) if (object(resource?.[method])) {
    const value = resource[method]; routes.push({ method:method.toUpperCase(), path, operationId:value.operationId ?? null,
      summary:value.summary ?? value.description ?? '', security:value.security ?? document.security ?? [],
      responses:Object.keys(value.responses ?? {}) });
  }
  function refs(value, path = '') {
    if (Array.isArray(value)) return value.forEach((item,i) => refs(item,path+'/'+i));
    if (!object(value)) return;
    if (typeof value.$ref === 'string' && !value.$ref.startsWith('#/')) findings.push({ code:'EXTERNAL_OPENAPI_REFERENCE', location:path, detail:value.$ref });
    for (const [key,item] of Object.entries(value)) if (key !== '$ref') refs(item,path+'/'+key);
  }
  refs(document);
  if (document.security || document.components?.securitySchemes || document.securityDefinitions) findings.push({ code:'SOURCE_AUTHENTICATION_MAPPING', location:'security', detail:'Choose the corresponding native plan and gateway policy configuration; the source authentication declaration is retained.' });
  return routes;
}
export async function inspectSourceBundle({ files: input, entry, label }) {
  const files = normalizeSourceFiles(input), originals = new Map(files.map(file => [file.path,file]));
  sourcePath(entry); const original = originals.get(entry); requireValue(original, 'ENTRY_SOURCE_MISSING');
  const value = new TextDecoder('utf-8', { fatal:true }).decode(Buffer.from(original.base64,'base64'));
  const findings = []; const document = await parseStructured(value, entry, originals);
  let dialect, api, nativeDefinition = null;
  if (/^\s*#%RAML\s+1\.0\b/m.test(value)) { dialect = 'RAML 1.0'; api = ramlToOpenAPI(document, findings); }
  else if (object(document) && (document.openapi?.startsWith('3.') || document.swagger === '2.0')) { dialect = document.openapi ? 'OpenAPI ' + document.openapi : 'Swagger 2.0'; api = document; }
  else if (document?.api?.definitionVersion === 'V4' || document?.definitionVersion === 'V4') {
    dialect = 'Gravitee V4'; nativeDefinition = copy(document); api = null;
    requireValue((document.api ?? document).type === 'PROXY', 'SOURCE_HTTP_PROXY_REQUIRED');
  } else requireValue(false, 'SOURCE_DIALECT_UNSUPPORTED', 'Use the original OpenAPI, Swagger, RAML 1.0 contract or native Gravitee v4 definition as the entry file; include the remaining Mule application and policy files in the same bundle.');
  const routes = api ? inspectOpenAPI(api, findings) : [];
  for (const file of files) if (file.path !== entry && /\.(?:xml|dwl)$/i.test(file.path)) findings.push({
    code:'MULE_APPLICATION_COMPONENT', location:file.path, detail:'The original Mule application component is retained. Record its proxy, policy or transformation disposition in the draft mappings.' });
  return { schema:'gravitee.source-bundle.v1', label:label ?? original.path, entry, dialect, files,
    originalDocument:document, normalizedOpenAPI:api, nativeDefinition, routes, findings:findings.map((f,i) => ({ id:hashJSON({ entry, ...f }).slice(0,24), ...f })),
    sourceSha256:hashJSON(files.map(({ path,sha256,bytes }) => ({ path,sha256,bytes }))) };
}
export function createProxyDraft(source, mapping) {
  requireValue(object(mapping), 'MAPPING_REQUIRED');
  if (mapping.nativeDefinition) {
    const definition = copy(mapping.nativeDefinition);
    requireValue((definition.api ?? definition).definitionVersion === 'V4', 'V4_DRAFT_REQUIRED');
    return { schema:'gravitee.proxy-draft.v1', sourceSha256:source.sourceSha256, label:mapping.name ?? (definition.api ?? definition).name,
      operationId:definition.api ? 'createApiWithImportDefinition' : 'createApi', body:definition,
      plans:mapping.plans ?? [], mapping:copy(mapping), routes:source.routes, findings:source.findings, resolutions:mapping.resolutions ?? {} };
  }
  const name = text(mapping.name ?? source.normalizedOpenAPI?.info?.title, 'name', 256);
  const version = text(String(mapping.apiVersion ?? source.normalizedOpenAPI?.info?.version ?? '1.0'), 'apiVersion', 256);
  const path = text(mapping.contextPath, 'contextPath', 4096);
  requireValue(path.startsWith('/') && !path.includes('?') && !path.includes('#'), 'CONTEXT_PATH_INVALID');
  const upstream = new URL(text(mapping.upstream, 'upstream'));
  requireValue(['https:','http:'].includes(upstream.protocol) && !upstream.username && !upstream.password && !upstream.hash, 'UPSTREAM_URL_INVALID');
  const security = mapping.security ?? { type:'API_KEY' };
  requireValue(['KEY_LESS','API_KEY','OAUTH2','JWT','MTLS'].includes(security.type), 'PLAN_SECURITY_INVALID');
  const body = { name, apiVersion:version, definitionVersion:'V4', type:'PROXY',
    description:mapping.description ?? source.normalizedOpenAPI?.info?.description ?? '',
    visibility:mapping.visibility ?? 'PRIVATE',
    listeners:[{ type:'HTTP', paths:[{ path, ...(mapping.host ? { host:mapping.host } : {}) }], entrypoints:[{ type:'http-proxy' }] }],
    endpointGroups:[{ name:'default-group', type:'http-proxy', endpoints:[{ name:'default', type:'http-proxy', weight:1,
      inheritConfiguration:false, configuration:{ target:upstream.href } }] }],
    ...(mapping.flows ? { flows:copy(mapping.flows) } : {}),
    ...(mapping.tags ? { tags:copy(mapping.tags) } : {}) };
  const plans = mapping.plans ?? [{ definitionVersion:'V4', name:mapping.planName ?? name + ' access',
    description:mapping.planDescription ?? 'Access plan for ' + name, characteristics:[], security:copy(security), mode:'STANDARD' }];
  return { schema:'gravitee.proxy-draft.v1', label:name, sourceSha256:source.sourceSha256, operationId:'createApi', body, plans,
    mapping:copy(mapping), routes:source.routes, findings:source.findings, resolutions:mapping.resolutions ?? {} };
}
export function draftReadiness(draft) {
  const unresolved = (draft.findings ?? []).filter(f => !textResolution(draft.resolutions?.[f.id]));
  return { sourceFindings:(draft.findings ?? []).length, addressed:(draft.findings ?? []).length-unresolved.length,
    unresolved, sourceSha256:draft.sourceSha256, nativeBodySha256:hashJSON(draft.body) };
}
const textResolution = value => typeof value === 'string' && value.trim().length > 0;
