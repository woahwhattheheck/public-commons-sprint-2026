// MIT. Reviewed configuration for the maintained Development Seed STAC Auth Proxy.
import { createHash } from 'node:crypto';

export const POLICY_SCHEMA = 'scf-eoapi-deployment-policy/v1';
export const POLICY_PACKAGE_SCHEMA = 'scf-eoapi-policy-package/v1';
export const POLICY_SOURCES = Object.freeze([
  'https://developmentseed.org/projects/eoapi/',
  'https://developmentseed.org/stac-auth-proxy/user-guide/configuration/',
  'https://developmentseed.org/stac-auth-proxy/user-guide/route-level-auth/',
  'https://developmentseed.org/stac-auth-proxy/user-guide/record-level-auth/',
  'https://developmentseed.org/stac-auth-proxy/user-guide/deployment/',
  'https://developmentseed.org/stac-auth-proxy/reference/stac_auth_proxy/config/',
  'https://developmentseed.org/stac-auth-proxy/reference/stac_auth_proxy/filters/opa/',
  'https://developmentseed.org/stac-auth-proxy/reference/stac_auth_proxy/filters/template/',
  'https://github.com/developmentseed/stac-auth-proxy/blob/main/src/stac_auth_proxy/utils/requests.py',
  'https://github.com/developmentseed/stac-auth-proxy/blob/main/src/stac_auth_proxy/middleware/Cql2BuildFilterMiddleware.py'
]);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ROUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const IDENT = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SCOPES = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
const SECRET_KEY = /^(?:authorization|cookie|password|secret|token|credential|credentials|client_?secret|access_?token|refresh_?token|id_?token|private_?key|api_?key)$/i;
const COMMON_CONFORMANCE = ['basic-cql2', 'cql2-text', 'cql2-json'].map(name => 'http://www.opengis.net/spec/cql2/1.0/conf/' + name);
const ITEMS_CONFORMANCE = ['filter', 'features-filter'].map(name => 'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/' + name);
const COLLECTIONS_CONFORMANCE = ['https://api.stacspec.org/v1.0.0/core', 'http://www.opengis.net/spec/ogcapi-common-2/1.0/conf/simple-query'];
const STAC_CONFORMANCE_VERSION = 'v1\\.0\\.0(?:-[\\w\\.]+)?';
export class DeploymentPolicyError extends Error {
  constructor(code, path, detail = '') { super(code + (path ? ': ' + path : '') + (detail ? ' — ' + detail : '')); this.name = 'DeploymentPolicyError'; this.code = code; this.path = path; }
}
const need = (ok, code, path, detail) => { if (!ok) throw new DeploymentPolicyError(code, path, detail); };
export function canonicalPolicyJSON(value, ordered = false) {
  if (Array.isArray(value)) return '[' + value.map(item => canonicalPolicyJSON(item)).join(',') + ']';
  // Native route selection uses the first matching rule. Keep these map orders
  // in stored policies, review identity and every containing package digest.
  if (value !== null && typeof value === 'object') return '{' + (ordered ? Object.keys(value) : Object.keys(value).sort()).map(key => JSON.stringify(key) + ':' + canonicalPolicyJSON(value[key], key === 'publicEndpoints' || key === 'privateEndpoints')).join(',') + '}';
  need(value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value), 'EOAPI_JSON_VALUE_INVALID', '');
  return JSON.stringify(value);
}
export const policyDigest = value => createHash('sha256').update(canonicalPolicyJSON(value)).digest('hex');
const clone = value => JSON.parse(canonicalPolicyJSON(value));
function object(value, path) { need(value && typeof value === 'object' && !Array.isArray(value), 'EOAPI_OBJECT_REQUIRED', path); return value; }
function string(value, path, max = 4000, empty = false) { need(typeof value === 'string' && value.length <= max && (empty || value.trim()) && !/[\x00\r\n]/.test(value), 'EOAPI_TEXT_INVALID', path); return value.trim(); }
function list(value, path, maximum = 1000) { need(Array.isArray(value) && value.length <= maximum, 'EOAPI_LIST_INVALID', path); return value; }
function unique(values) { return [...new Set(values)].sort(); }
function url(value, path, { query = false } = {}) {
  let parsed; try { parsed = new URL(string(value, path)); } catch { throw new DeploymentPolicyError('EOAPI_URL_INVALID', path); }
  need(['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash && (query || !parsed.search), 'EOAPI_URL_INVALID', path);
  need(!/%(?:00|0a|0d)/i.test(parsed.href), 'EOAPI_URL_INVALID', path);
  return parsed.href.replace(/\/$/, '');
}
function noSecrets(value, path = '$', depth = 0) {
  need(depth < 60, 'EOAPI_POLICY_DEPTH_EXCEEDED', path);
  if (typeof value === 'string') {
    need(!/^Bearer\s+\S+/i.test(value) && !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value), 'EOAPI_PRIVATE_BINDING_REQUIRED', path);
    need(!/^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(value), 'EOAPI_PRIVATE_BINDING_REQUIRED', path);
  } else if (Array.isArray(value)) value.forEach((item, index) => noSecrets(item, path + '[' + index + ']', depth + 1));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    const corsFlag = path === '$.cors' && key === 'credentials' && typeof item === 'boolean';
    need(corsFlag || !SECRET_KEY.test(key), 'EOAPI_PRIVATE_BINDING_REQUIRED', path + '.' + key);
    noSecrets(item, path + '.' + key, depth + 1);
  }
}
function exactKeys(value, allowed, path) {
  object(value, path); need(Object.keys(value).every(key => allowed.includes(key)), 'EOAPI_UNKNOWN_FIELD', path);
}
function checkedMethods(value, path, allowed = METHODS) {
  return unique(list(value, path, 7).map(method => { need(allowed.has(method), 'EOAPI_HTTP_METHOD_INVALID', path); return method; }));
}
function checkedPattern(value, path) {
  const pattern = string(value, path, 500);
  need(pattern === value, 'EOAPI_ROUTE_PATTERN_WHITESPACE', path);
  need(pattern.startsWith('^/'), 'EOAPI_ANCHORED_ROUTE_REQUIRED', path);
  // Shared Python/ECMAScript expression subset, preserving the supplied expression.
  need(!/\(\?<|\(\?[a-z-]|\\[pPkKgG]|\(\?#/.test(pattern), 'EOAPI_ROUTE_PATTERN_UNSUPPORTED', path, 'Use explicit anchored paths and ordinary groups.');
  try { new RegExp(pattern); } catch { throw new DeploymentPolicyError('EOAPI_ROUTE_PATTERN_INVALID', path); }
  return pattern;
}
function publicRules(value) {
  object(value, 'routing.publicEndpoints'); const out = {};
  for (const [pattern, methods] of Object.entries(value)) {
    out[checkedPattern(pattern, 'routing.publicEndpoints')] = checkedMethods(methods, 'routing.publicEndpoints.' + pattern, ROUTE_METHODS);
    need(out[pattern].length, 'EOAPI_EMPTY_ROUTE_METHODS', pattern);
  }
  return out;
}
function privateRules(value) {
  object(value, 'routing.privateEndpoints'); const out = {};
  for (const [pattern, entries] of Object.entries(value)) {
    checkedPattern(pattern, 'routing.privateEndpoints'); const seen = new Set();
    out[pattern] = list(entries, 'routing.privateEndpoints.' + pattern, 7).map(entry => {
      const method = Array.isArray(entry) ? entry[0] : entry;
      need(ROUTE_METHODS.has(method) && !seen.has(method), 'EOAPI_ROUTE_METHOD_DUPLICATE_OR_INVALID', pattern); seen.add(method);
      if (typeof entry === 'string') return method;
      need(entry.length === 2 && typeof entry[1] === 'string', 'EOAPI_ROUTE_SCOPE_INVALID', pattern);
      const scopes = unique(entry[1].split(' ').filter(Boolean));
      need(scopes.length && scopes.every(scope => SCOPES.test(scope)), 'EOAPI_ROUTE_SCOPE_INVALID', pattern);
      return [method, scopes.join(' ')];
    }).sort((a, b) => String(Array.isArray(a) ? a[0] : a).localeCompare(String(Array.isArray(b) ? b[0] : b)));
    need(out[pattern].length, 'EOAPI_EMPTY_ROUTE_METHODS', pattern);
  }
  return out;
}
function filter(value, path) {
  if (value === null || value === undefined) return null;
  exactKeys(value, ['factory', 'classPath', 'args', 'kwargs'], path);
  need(['template', 'opa', 'custom'].includes(value.factory), 'EOAPI_FILTER_FACTORY_INVALID', path);
  const classPath = value.factory === 'template' ? 'stac_auth_proxy.filters:Template' : value.factory === 'opa' ? 'stac_auth_proxy.filters:Opa' : string(value.classPath, path + '.classPath', 300);
  need(/^[A-Za-z_][A-Za-z0-9_.]*:[A-Za-z_][A-Za-z0-9_]*$/.test(classPath), 'EOAPI_FILTER_CLASS_INVALID', path);
  let args = clone(list(value.args ?? [], path + '.args', 30)), kwargs = clone(object(value.kwargs ?? {}, path + '.kwargs'));
  need(canonicalPolicyJSON({ args, kwargs }).length <= 256 * 1024, 'EOAPI_FILTER_ARGUMENTS_TOO_LARGE', path);
  if (value.factory !== 'custom') {
    const names = value.factory === 'template' ? ['template_str'] : ['host', 'decision'];
    need(args.length <= names.length && Object.keys(kwargs).every(key => names.includes(key)), 'EOAPI_FILTER_ARGUMENTS_INVALID', path);
    args = names.map((name, index) => {
      const positional = index < args.length, keyword = Object.hasOwn(kwargs, name);
      need(positional !== keyword, 'EOAPI_FILTER_ARGUMENT_MISSING_OR_DUPLICATE', path + '.' + name);
      return positional ? args[index] : kwargs[name];
    });
    kwargs = {};
  }
  if (value.factory === 'template') need(typeof args[0] === 'string' && args[0].length > 0, 'EOAPI_TEMPLATE_ARGUMENT_REQUIRED', path);
  if (value.factory === 'opa') { need(typeof args[1] === 'string' && args[1].length > 0, 'EOAPI_OPA_ARGUMENTS_REQUIRED', path); args[0] = url(args[0], path + '.opaUrl'); }
  return { factory: value.factory, classPath, args, kwargs };
}
export function normalizeDeploymentPolicy(input) {
  noSecrets(input); exactKeys(input, ['schema', 'title', 'deployment', 'upstream', 'identity', 'routing', 'filtering', 'cors', 'collectionRights', 'operator'], '$');
  need(input.schema === undefined || input.schema === POLICY_SCHEMA, 'EOAPI_POLICY_SCHEMA_UNSUPPORTED', 'schema');
  const deployment = object(input.deployment, 'deployment'), upstream = object(input.upstream, 'upstream'), identity = object(input.identity, 'identity');
  exactKeys(deployment, ['id', 'eoapiVersion', 'authProxyVersion', 'sourceRef', 'publicUrl', 'rootPath', 'rootPathSkipPrefixes'], 'deployment');
  exactKeys(upstream, ['url', 'conformsTo', 'networkBoundary'], 'upstream');
  exactKeys(identity, ['discoveryUrl', 'internalDiscoveryUrl', 'audiences', 'policyOwner'], 'identity');
  const id = string(deployment.id, 'deployment.id', 160); need(IDENT.test(id), 'EOAPI_DEPLOYMENT_ID_INVALID', 'deployment.id');
  const publicUrl = url(deployment.publicUrl, 'deployment.publicUrl');
  const rootPath = deployment.rootPath ?? new URL(publicUrl).pathname.replace(/\/$/, '');
  need(typeof rootPath === 'string' && (rootPath === '' || /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/.test(rootPath)) && !rootPath.split('/').some(v => v === '.' || v === '..'), 'EOAPI_ROOT_PATH_INVALID', 'deployment.rootPath');
  const skip = unique(list(deployment.rootPathSkipPrefixes ?? [], 'deployment.rootPathSkipPrefixes', 100).map(value => {
    need(typeof value === 'string' && /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/.test(value) && !value.split('/').some(v => v === '.' || v === '..'), 'EOAPI_SKIP_PREFIX_INVALID', 'deployment.rootPathSkipPrefixes'); return value;
  }));
  const routing = object(input.routing, 'routing'); exactKeys(routing, ['defaultPublic', 'publicEndpoints', 'privateEndpoints'], 'routing');
  need(typeof routing.defaultPublic === 'boolean', 'EOAPI_EXPLICIT_DEFAULT_REQUIRED', 'routing.defaultPublic');
  const publicEndpoints = publicRules(routing.publicEndpoints ?? {}), privateEndpoints = privateRules(routing.privateEndpoints ?? {});
  const filtering = input.filtering ?? {}; exactKeys(filtering, ['items', 'collections'], 'filtering');
  const filters = { items: filter(filtering.items, 'filtering.items'), collections: filter(filtering.collections, 'filtering.collections') };
  const conformsTo = unique(list(upstream.conformsTo ?? [], 'upstream.conformsTo').map(value => string(value, 'upstream.conformsTo', 2000)));
  const audiences = unique(list(identity.audiences, 'identity.audiences', 100).map(value => string(value, 'identity.audiences', 2000)));
  need(audiences.length, 'EOAPI_EXPLICIT_AUDIENCE_REQUIRED', 'identity.audiences');
  const operator = object(input.operator, 'operator'); exactKeys(operator, ['name', 'retentionDays', 'sourceVersionNotes'], 'operator');
  need(Number.isSafeInteger(operator.retentionDays) && operator.retentionDays >= 0 && operator.retentionDays <= 36500, 'EOAPI_RETENTION_INVALID', 'operator.retentionDays');
  const rights = list(input.collectionRights, 'collectionRights', 1000).map((value, index) => {
    const path = 'collectionRights[' + index + ']'; exactKeys(value, ['id', 'license', 'licenseUrls', 'attribution', 'assetAccess'], path);
    need(['public-https', 'authenticated-source', 'requester-pays', 'retained-files'].includes(value.assetAccess), 'EOAPI_ASSET_ACCESS_REQUIRED', path);
    return { id: string(value.id, path + '.id', 300), license: string(value.license, path + '.license', 2000),
      licenseUrls: unique(list(value.licenseUrls ?? [], path + '.licenseUrls', 50).map(value => url(value, path + '.licenseUrl', { query: true }))),
      attribution: string(value.attribution ?? '', path + '.attribution', 10000, true), assetAccess: value.assetAccess };
  }).sort((a, b) => a.id.localeCompare(b.id));
  need(rights.length && new Set(rights.map(value => value.id)).size === rights.length, 'EOAPI_COLLECTION_RIGHTS_REQUIRED', 'collectionRights');
  const cors = input.cors ?? {}; exactKeys(cors, ['origins', 'methods', 'headers', 'credentials', 'exposeHeaders', 'maxAge'], 'cors');
  const origins = unique(list(cors.origins ?? [], 'cors.origins', 100).map(value => { const origin = url(value, 'cors.origins'); need(new URL(origin).origin === origin, 'EOAPI_CORS_ORIGIN_REQUIRED', 'cors.origins'); return origin; }));
  const headerNames = (values, path) => unique(list(values, path, 100).map(value => { need(typeof value === 'string' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value), 'EOAPI_HEADER_NAME_INVALID', path); return value; }));
  need(cors.credentials === undefined || typeof cors.credentials === 'boolean', 'EOAPI_CORS_CREDENTIALS_INVALID', 'cors.credentials');
  need(cors.maxAge === undefined || Number.isSafeInteger(cors.maxAge) && cors.maxAge >= 0 && cors.maxAge <= 86400, 'EOAPI_CORS_AGE_INVALID', 'cors.maxAge');
  return {
    schema: POLICY_SCHEMA, title: string(input.title, 'title', 300),
    deployment: { id, eoapiVersion: string(deployment.eoapiVersion, 'deployment.eoapiVersion', 200), authProxyVersion: string(deployment.authProxyVersion, 'deployment.authProxyVersion', 200), sourceRef: string(deployment.sourceRef, 'deployment.sourceRef', 300), publicUrl, rootPath, rootPathSkipPrefixes: skip },
    upstream: { url: url(upstream.url, 'upstream.url'), conformsTo, networkBoundary: string(upstream.networkBoundary, 'upstream.networkBoundary', 2000) },
    identity: { discoveryUrl: url(identity.discoveryUrl, 'identity.discoveryUrl'), ...(identity.internalDiscoveryUrl ? { internalDiscoveryUrl: url(identity.internalDiscoveryUrl, 'identity.internalDiscoveryUrl') } : {}), audiences, policyOwner: string(identity.policyOwner, 'identity.policyOwner', 300) },
    routing: { defaultPublic: routing.defaultPublic, publicEndpoints, privateEndpoints }, filtering: filters,
    cors: { origins, methods: checkedMethods(cors.methods ?? ['GET', 'POST', 'OPTIONS'], 'cors.methods'), headers: headerNames(cors.headers ?? ['Authorization', 'Content-Type'], 'cors.headers'), credentials: cors.credentials ?? true, exposeHeaders: headerNames(cors.exposeHeaders ?? [], 'cors.exposeHeaders'), maxAge: cors.maxAge ?? 600 },
    collectionRights: rights, operator: { name: string(operator.name, 'operator.name', 300), retentionDays: operator.retentionDays, sourceVersionNotes: string(operator.sourceVersionNotes ?? '', 'operator.sourceVersionNotes', 4000, true) }
  };
}
const json = value => JSON.stringify(value);
export function compileDeploymentPolicy(input) {
  const policy = normalizeDeploymentPolicy(input), environment = {
    UPSTREAM_URL: policy.upstream.url, OIDC_DISCOVERY_URL: policy.identity.discoveryUrl,
    ALLOWED_JWT_AUDIENCES: json(policy.identity.audiences), DEFAULT_PUBLIC: String(policy.routing.defaultPublic),
    PUBLIC_ENDPOINTS: json(policy.routing.publicEndpoints), PRIVATE_ENDPOINTS: json(policy.routing.privateEndpoints),
    ROOT_PATH: policy.deployment.rootPath, ROOT_PATH_SKIP_PREFIXES: policy.deployment.rootPathSkipPrefixes.join(','),
    CHECK_CONFORMANCE: 'true', WAIT_FOR_UPSTREAM: 'true', ENABLE_AUTHENTICATION_EXTENSION: 'true',
    CORS_ALLOW_ORIGINS: policy.cors.origins.join(','), CORS_ALLOW_METHODS: policy.cors.methods.join(','),
    CORS_ALLOW_HEADERS: policy.cors.headers.join(','), CORS_ALLOW_CREDENTIALS: String(policy.cors.credentials),
    CORS_EXPOSE_HEADERS: policy.cors.exposeHeaders.join(','), CORS_MAX_AGE: String(policy.cors.maxAge)
  };
  if (policy.identity.internalDiscoveryUrl) environment.OIDC_DISCOVERY_INTERNAL_URL = policy.identity.internalDiscoveryUrl;
  const unset = ['PROXY_OPTIONS', 'ITEMS_FILTER', 'COLLECTIONS_FILTER', 'ITEMS_FILTER_PATH', 'COLLECTIONS_FILTER_PATH'];
  if (!policy.identity.internalDiscoveryUrl) unset.push('OIDC_DISCOVERY_INTERNAL_URL');
  for (const [kind, value] of Object.entries(policy.filtering)) {
    const prefix = kind.toUpperCase() + '_FILTER_';
    if (value) { environment[prefix + 'CLS'] = value.classPath; environment[prefix + 'ARGS'] = json(value.args); environment[prefix + 'KWARGS'] = json(value.kwargs); }
    else unset.push(prefix + 'CLS', prefix + 'ARGS', prefix + 'KWARGS');
  }
  const requirements = [];
  const requireConformance = (conformance, purpose, pattern) => {
    const match = pattern ? new RegExp('^' + pattern) : new RegExp('^' + conformance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const matched = policy.upstream.conformsTo.find(value => match.test(value));
    requirements.push({ conformance, ...(pattern ? { pattern } : {}), declared: matched !== undefined, matched: matched ?? null, purpose });
  };
  if (policy.filtering.items || policy.filtering.collections) {
    for (const value of COMMON_CONFORMANCE) requireConformance(value, 'CQL2 record filtering');
  }
  if (policy.filtering.items) {
    for (const value of ITEMS_CONFORMANCE) requireConformance(value, 'Features record filtering');
    requireConformance('https://api.stacspec.org/v1.0.0/item-search#filter', 'STAC item search filtering', 'https://api.stacspec.org/' + STAC_CONFORMANCE_VERSION + '/item-search#filter');
  }
  if (policy.filtering.collections) {
    for (const value of COLLECTIONS_CONFORMANCE) requireConformance(value, 'STAC collection filtering');
    for (const suffix of ['collection-search', 'collection-search#filter']) requireConformance('https://api.stacspec.org/v1.0.0/' + suffix, 'STAC collection filtering', 'https://api.stacspec.org/' + STAC_CONFORMANCE_VERSION + '/' + suffix);
  }
  const findings = requirements.filter(value => !value.declared).map(value => ({ code: 'EOAPI_REQUIRED_CONFORMANCE_MISSING', field: 'upstream.conformsTo', detail: value.conformance }));
  const review = {
    sourceRef: policy.deployment.sourceRef, authProxyVersion: policy.deployment.authProxyVersion, policyOwner: policy.identity.policyOwner,
    defaultAccess: policy.routing.defaultPublic ? 'public' : 'authenticated',
    routePrecedence: { public: 'When defaultPublic is false, public rules are checked before private rules.', private: 'The first matching private rule in the recorded order selects its required scopes.' },
    routes: [...Object.entries(policy.routing.publicEndpoints).flatMap(([pattern, methods], index) => methods.map(method => ({ pattern, order: index + 1, method, access: 'public', scopes: [], active: !policy.routing.defaultPublic, matching: 'case-sensitive, as written' }))),
      ...Object.entries(policy.routing.privateEndpoints).flatMap(([pattern, entries], index) => entries.map(value => ({ pattern, order: index + 1, method: Array.isArray(value) ? value[0] : value, access: 'authenticated', scopes: Array.isArray(value) ? value[1].split(' ') : [], active: true, matching: 'case-insensitive; proxy normalizes one trailing slash' })))],
    recordFilters: clone(policy.filtering), requirements, collectionRights: clone(policy.collectionRights),
    upstreamBoundary: policy.upstream.networkBoundary, retentionDays: policy.operator.retentionDays,
    sourceReferences: [...POLICY_SOURCES], findings
  };
  const digest = policyDigest(policy);
  return { schema: 'scf-eoapi-policy-compilation/v1', id: 'eoapi-policy-' + digest.slice(0, 24), digest, policy, environment, unset, review, ready: !findings.length };
}
export function compareDeploymentPolicies(before, after) {
  const oldValue = before ? normalizeDeploymentPolicy(before) : null, nextValue = normalizeDeploymentPolicy(after), changes = [];
  function walk(left, right, path) {
    const routes = /(?:^|\.)routing\.(?:publicEndpoints|privateEndpoints)$/.test(path);
    if (canonicalPolicyJSON(left ?? null, routes) === canonicalPolicyJSON(right ?? null, routes)) return;
    if (routes && left && right && canonicalPolicyJSON(Object.keys(left)) !== canonicalPolicyJSON(Object.keys(right))) changes.push({ field: path + '.order', before: Object.keys(left), after: Object.keys(right) });
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      for (const key of unique([...Object.keys(left), ...Object.keys(right)])) walk(left[key], right[key], path ? path + '.' + key : key);
    } else changes.push({ field: path, before: left ?? null, after: right ?? null });
  }
  walk(oldValue, nextValue, '');
  return { beforeDigest: oldValue ? policyDigest(oldValue) : null, afterDigest: policyDigest(nextValue), changes };
}
export function deploymentEnvironmentText(environment) {
  // Docker --env-file data: values are literal; quotes would become part of the value.
  return Object.keys(environment).sort().map(key => { need(/^[A-Z][A-Z0-9_]*$/.test(key) && typeof environment[key] === 'string' && !/[\r\n\0]/.test(environment[key]), 'EOAPI_ENVIRONMENT_INVALID', key); return key + '=' + environment[key]; }).join('\n') + '\n';
}
export function applyDeploymentEnvironment(existing, compilation) {
  const result = { ...existing };
  for (const key of compilation.unset) delete result[key];
  return Object.assign(result, compilation.environment);
}
export function deploymentPolicyMarkdown(compilation) {
  const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = ['# ' + compilation.policy.title, '', 'Policy version: `' + compilation.id + '`', '',
    'The selected upstream STAC Auth Proxy applies authentication and record access. This package records the reviewed deployment configuration and the original collection access terms.', '',
    '| Setting | Selected value |', '| --- | --- |',
    ...[['eoAPI version', compilation.policy.deployment.eoapiVersion], ['Auth Proxy version', compilation.policy.deployment.authProxyVersion], ['Source revision', compilation.policy.deployment.sourceRef], ['Public URL', compilation.policy.deployment.publicUrl], ['Policy owner', compilation.review.policyOwner], ['Default access', compilation.review.defaultAccess], ['Upstream boundary', compilation.review.upstreamBoundary], ['Receiving retention days', compilation.review.retentionDays]].map(([key, value]) => '| ' + key + ' | ' + escape(value) + ' |'), '',
    '## Routes', '', compilation.review.routePrecedence.public + ' ' + compilation.review.routePrecedence.private, '', '| Order within access class | Pattern | Method | Access | Required scopes, all | Active |', '| --- | --- | --- | --- | --- | --- |',
    ...compilation.review.routes.map(row => '| ' + row.order + ' | `' + escape(row.pattern) + '` | ' + row.method + ' | ' + row.access + ' | ' + escape(row.scopes.join(' ')) + ' | ' + row.active + ' |'), '',
    '## Collection rights and files', '', '| Collection | License | File access | Attribution |', '| --- | --- | --- | --- |',
    ...compilation.review.collectionRights.map(row => '| ' + escape(row.id) + ' | ' + escape(row.license) + ' | ' + row.assetAccess + ' | ' + escape(row.attribution) + ' |'), '',
    '## Receiving', '', 'Open policy.json and review.json, verify the manifest, and import the package into the original onboarding workspace. environment.json is the exact environment map; auth-proxy.docker.env carries the same literal values for Docker --env-file. Remove variables listed in unset-environment.json when replacing an existing configuration. Resolve operator credentials in the receiving connection configuration. Preserve the catalog edition and selected-file manifest beside this configuration version.', '',
    '## Sources', '', ...compilation.review.sourceReferences.map(value => '- ' + value), ''];
  return lines.join('\n');
}
