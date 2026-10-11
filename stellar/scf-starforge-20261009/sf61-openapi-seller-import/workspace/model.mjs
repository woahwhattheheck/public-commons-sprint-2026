// MIT. Merchant configuration around the original OpenAPI compiler and SF30 upstreams.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, lstat, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importOpenApi, createOpenApiResolver } from '../importer.mjs';
import { createSellerServiceConfig } from '../service-config.mjs';
import { run as compileSeller } from '../cli.mjs';
import { compileUpstreamBindings, validateUpstreamService } from '../../sf30-seller-sdk/upstream.mjs';
import { supportsSellerMethod } from '../../sf30-seller-sdk/http-methods.mjs';
import { compileOpenApiResponseContract } from '../response-contracts.mjs';
import { preparePublicOperation, createMerchantCases } from './requests.mjs';

const LIMIT = 4 * 1024 * 1024;
const MANIFEST_LIMIT = 1024 * 1024;
const titleOf = spec => typeof spec.info?.title === 'string' ? spec.info.title.slice(0,240) : 'API merchant';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.hasOwn(o, k);
const sha = v => createHash('sha256').update(v).digest('hex');
const json = v => JSON.stringify(v, null, 2) + '\n';
const fail = m => { throw new TypeError(m); };
const methods = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'];
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const shell = s => "'" + String(s).replaceAll("'", "'\\''") + "'";
export const PACKAGE_SCHEMA = 'stellar-forge.api-merchant-package.v1';

function parse(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMIT) fail('OpenAPI JSON must be at most 4 MiB');
  const value = JSON.parse(text);
  if (!plain(value) || !/^3\.[01]\.\d+$/.test(value.openapi) || !plain(value.paths))
    fail('Load an OpenAPI 3.0 or 3.1 JSON document');
  return value;
}
// Use the current original compiler's reference semantics for source inspection too.
const reference = (spec, value) => createOpenApiResolver(spec).reference(value);
function operationAt(spec, method, path) {
  if (!own(spec.paths, path)) fail('Selected path is absent: ' + path);
  const item = reference(spec, spec.paths[path]);
  const op = item[String(method).toLowerCase()];
  if (!plain(op)) fail('Selected operation is absent: ' + method + ' ' + path);
  return { item, op, servers: op.servers ?? item.servers ?? spec.servers };
}
function authFor(spec, op, headers, choice = 0) {
  const requirements = op.security ?? spec.security ?? [];
  if (!Array.isArray(requirements) || requirements.some(v => !plain(v))) fail('Invalid OpenAPI security requirements');
  if (!requirements.length) return [];
  if (!Number.isSafeInteger(choice) || choice < 0 || !requirements[choice]) fail('Choose a declared security alternative');
  const mapped = new Map(Object.entries(headers).map(([k,v]) => [k.toLowerCase(), v])), usedHeaders = new Set();
  return Object.keys(requirements[choice]).map(name => {
    if (!Array.isArray(requirements[choice][name]) || requirements[choice][name].length)
      fail('Header authentication schemes require an empty scope list');
    const scheme = reference(spec, spec.components?.securitySchemes?.[name]);
    let header;
    if (scheme.type === 'apiKey' && scheme.in === 'header') header = scheme.name;
    else if (scheme.type === 'http' && ['bearer','basic'].includes(String(scheme.scheme).toLowerCase())) header = 'authorization';
    else fail('Security scheme ' + name + ' needs trusted handler integration; use header API keys or HTTP bearer/basic here');
    if (typeof header !== 'string' || !mapped.has(header.toLowerCase()))
      fail('Map the ' + header + ' header to an environment variable for security scheme ' + name);
    if (usedHeaders.has(header.toLowerCase())) fail('Security alternatives sharing one credential header require a trusted handler');
    usedHeaders.add(header.toLowerCase());
    return { scheme: name, type: scheme.type, header: header.toLowerCase(), environment: mapped.get(header.toLowerCase()) };
  });
}

/** Inspection reads no network or environment and never imports document code. */
export function inspectOpenApi(specText) {
  const spec = parse(specText), operations = [];
  for (const [path, raw] of Object.entries(spec.paths)) {
    let item;
    try { item = reference(spec, raw); } catch (e) { operations.push({ path, error:e.message, supported:false }); continue; }
    for (const method of methods) if (plain(item[method])) {
      const op = item[method], servers = op.servers ?? item.servers ?? spec.servers ?? [];
      const security = op.security ?? spec.security ?? [];
      operations.push({ method:method.toUpperCase(), path, summary:op.summary ?? op.operationId ?? '',
        supported:supportsSellerMethod(method.toUpperCase()),
        publicDescription:String(op.summary ?? op.description ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim(),
        servers:Array.isArray(servers) ? servers.map((s,i) => ({index:i, url:s?.url ?? '', variables:Boolean(s?.variables)})) : [],
        security:Array.isArray(security) ? security.map(s => plain(s) ? Object.keys(s) : []) : [],
        error:supportsSellerMethod(method.toUpperCase()) ? null : 'This HTTP method is not supported by the original seller' });
    }
  }
  if (operations.length > 2000) fail('Workspace supports at most 2,000 described operations');
  return {title:titleOf(spec), version:spec.openapi, sourceSha256:sha(specText), operations};
}
function exactKeys(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('Unexpected ' + label + ' fields');
}
function backendURL(servers, index) {
  if (!Array.isArray(servers) || !Number.isSafeInteger(index) || index < 0 || !servers[index]) fail('Select a declared upstream server');
  const s = servers[index];
  if (!plain(s) || typeof s.url !== 'string' || /[{}]/.test(s.url)) fail('Expand upstream server variables in your source first');
  const url = new URL(s.url);
  if ((url.href !== s.url && s.url !== url.origin) || url.username || url.password || url.search || url.hash) fail('Upstream server must be canonical without credentials or query');
  return url;
}

/** Build an explicit paid facade and preserve the source and backend auth mapping. */
export function prepareMerchant(specText, plan) {
  const spec = parse(specText);
  exactKeys(plan, ['schema','sellerServer','serviceName','payment','operations','allowLoopbackUpstream'], 'plan');
  if (plan.schema !== 'stellar-forge.api-merchant-plan.v1' || typeof plan.sellerServer !== 'string' ||
      !Array.isArray(plan.operations) || !plan.operations.length || plan.operations.length > 64) fail('Select 1–64 operations in an API merchant plan');
  if (plan.allowLoopbackUpstream !== undefined && typeof plan.allowLoopbackUpstream !== 'boolean') fail('Loopback upstream choice must be boolean');
  const sellerServer = new URL(plan.sellerServer);
  if ((sellerServer.href !== plan.sellerServer && plan.sellerServer !== sellerServer.origin) || sellerServer.protocol !== 'https:' ||
      sellerServer.username || sellerServer.password || sellerServer.search || sellerServer.hash)
    fail('Public seller server must be a canonical HTTPS URL, including its path prefix');
  exactKeys(plan.payment, ['network','asset','payTo','maxTimeoutSeconds'], 'payment');
  const facade = structuredClone(spec), selections = [], bindings = [], upstreams = {schema:'stellar-forge.seller-upstreams.v1', bindings:{}};
  const transformations = [], ids = new Set(), routes = [], envNames = new Set(), seen = new Set(), materialized = new Set();
  for (const row of plan.operations) {
    exactKeys(row, ['method','path','id','serverIndex','amountAtomic','headerEnv','securityAlternative','responseMode','responseValidation','publicDescription','requestExample','timeoutMs','maxResponseBytes','maxInFlight','requestHeaders','cache','availability','enforceResponseContract'], 'operation');
    const method = String(row.method).toUpperCase(), key = method + ' ' + row.path;
    if (!supportsSellerMethod(method)) fail(key + ': choose a method supported by the original seller');
    if (seen.has(key)) fail('Duplicate selected operation: ' + key);
    seen.add(key);
    const id = row.id ?? 'route_' + sha(key).slice(0,12);
    if (!/^[A-Za-z_][\w]{0,63}$/.test(id) || forbidden.has(id) || ids.has(id)) fail('Use a distinct handler-safe route ID');
    ids.add(id);
    const {item, op, servers} = operationAt(spec, method, row.path), backend = backendURL(servers, row.serverIndex ?? 0);
    const headers = row.headerEnv ?? {};
    if (!plain(headers)) fail(key + ': headerEnv maps header names to environment-variable names');
    for (const name of Object.values(headers)) {
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(key + ': use environment names, never credential values');
      envNames.add(name);
    }
    let auth;
    try { auth = authFor(spec, op, headers, row.securityAlternative ?? 0); }
    catch(e) { fail(key + ': ' + e.message); }
    if (!materialized.has(row.path)) {
      facade.paths[row.path] = structuredClone(item);
      materialized.add(row.path);
    }
    const publicOperation = preparePublicOperation(spec, item, op, row, method);
    facade.paths[row.path][method.toLowerCase()] = {...publicOperation, servers:[{url:sellerServer.href}], security:[]};
    selections.push({method, path:row.path, serverIndex:0,
      ...(plan.serviceName ? {serviceName:plan.serviceName} : {}),
      accepts:[{scheme:'exact', ...plan.payment, amount:row.amountAtomic}]});
    bindings.push({method, path:row.path, id, handler:id, validateInput:true});
    upstreams.bindings[id] = {origin:backend.origin,
      path:backend.pathname.replace(/\/$/, '') + row.path.replace(/\{([^{}]+)\}/g, ':$1'), method,
      headerEnv:headers, responseMode:row.responseMode ?? 'json',
      ...(row.timeoutMs !== undefined ? {timeoutMs:row.timeoutMs} : {}),
      ...(row.maxResponseBytes !== undefined ? {maxResponseBytes:row.maxResponseBytes} : {}),
      ...(row.maxInFlight !== undefined ? {maxInFlight:row.maxInFlight} : {}),
      ...(row.requestHeaders !== undefined ? {requestHeaders:structuredClone(row.requestHeaders)} : {}),
      ...(row.cache !== undefined ? {cache:structuredClone(row.cache)} : {}),
      ...(row.availability !== undefined ? {availability:structuredClone(row.availability)} : {})};
    transformations.push({method, path:row.path, originalServer:backend.href, publicServer:sellerServer.href,
      publicDescription:publicOperation.description ?? null, requestExampleSupplied:row.requestExample !== undefined,
      backendAuthentication:auth, publicAuthentication:'native x402', securityAlternative:row.securityAlternative ?? 0});
  }
  const imported = importOpenApi(facade, selections), service = createSellerServiceConfig(imported, bindings);
  for (let i=0; i<imported.offers.length; i++) {
    const offer = imported.offers[i], binding = upstreams.bindings[bindings[i].id], row = plan.operations[i];
    // Existing v1 plans retain their original transport-only response policy.
    // The workspace explicitly selects declared validation for new JSON routes.
    if (row.enforceResponseContract !== undefined && typeof row.enforceResponseContract !== 'boolean') fail('Legacy response contract choice must be boolean');
    const validation = row.responseValidation ?? (row.enforceResponseContract === true ? 'declared' : 'none');
    if (row.responseValidation !== undefined && row.enforceResponseContract !== undefined &&
        (validation === 'declared') !== row.enforceResponseContract) fail('Conflicting response validation choices');
    if (!['declared','none'].includes(validation)) fail('Response validation must be declared or none');
    if (validation === 'declared') {
      if (binding.responseMode !== 'json') fail('Declared response validation requires JSON response format');
      binding.responseContract = compileOpenApiResponseContract(spec, offer, { specSha256:sha(specText) });
    }
    binding.query = Object.keys(offer.seller.extensions.bazaar.schema.properties.input.properties.queryParams?.properties ?? {});
    routes.push({id:bindings[i].id, method:offer.method, path:offer.path, publicUrl:offer.seller.resource.url,
      publicPath:service.routes[i].path, upstream:binding.origin + binding.path, amountAtomic:selections[i].accepts[0].amount,
      network:plan.payment.network, query:binding.query, environment:Object.values(binding.headerEnv),
      publicDescription:facade.paths[offer.path][offer.method.toLowerCase()].description ?? '',
      responseValidation:validation, responseStatuses:Object.keys(binding.responseContract?.responses ?? {}), validateInput:true, responseContract:Boolean(binding.responseContract), sharedRead:binding.cache?.shareAcrossBuyers === true});
  }
  const {cases, review} = createMerchantCases(imported, service, plan);
  // Validate environment REFERENCES only. The original launcher reads actual values.
  const compiled = compileUpstreamBindings(upstreams, {allowLoopback:plan.allowLoopbackUpstream === true,
    env:Object.fromEntries([...envNames].map(name => [name, 'SET_IN_LAUNCH_ENVIRONMENT']))});
  validateUpstreamService(service, compiled);
  for (const route of routes) {
    route.cache = compiled[route.id].cache;
    route.availability = compiled[route.id].availability;
    route.requestHeaders = [...compiled[route.id].requestHeaders];
  }
  return {facade, selections, bindings, upstreams, imported, service, transformations, cases,
    preview:{title:titleOf(spec), sourceSha256:sha(specText), routes,
      routeChecks:review,
      environment:[...envNames].sort(), credentialValuesChecked:false, allowLoopbackUpstream:plan.allowLoopbackUpstream === true}};
}
async function regular(path, limit=LIMIT) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > limit) fail('Expected a regular local file within its size limit');
  const bytes = await readFile(path);
  if (bytes.length > limit) fail('Local file grew beyond its limit');
  return bytes;
}
export function packageName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) fail('Package name: 1–64 letters, numbers, underscores or hyphens');
  return name;
}
export async function privateParent(path) {
  const full = resolve(path), info = await lstat(full);
  if (!info.isDirectory() || process.platform !== 'win32' && (info.mode & 0o077) !== 0) fail('Use an existing private output directory (mode 0700)');
  return full;
}
export async function readPackage(parent, name) {
  const folder = join(await privateParent(parent), packageName(name)), entry = await lstat(folder);
  if (!entry.isDirectory()) fail('Package must be a regular directory');
  const manifest = JSON.parse(await regular(join(folder,'merchant-package.json'), MANIFEST_LIMIT));
  if (manifest.schema !== PACKAGE_SCHEMA || !plain(manifest.files)) fail('Not an API merchant package');
  for (const file of ['original-openapi.json','merchant-plan.json','facade-openapi.json','selections.json','route-bindings.json','upstreams.json']) {
    if (sha(await regular(join(folder,file))) !== manifest.files[file]) fail('Saved package changed: ' + file + '. Save changes under a new name.');
  }
  if (own(manifest.files,'operator-cases.json') && sha(await regular(join(folder,'operator-cases.json'),65536)) !== manifest.files['operator-cases.json'])
    fail('Saved route cases changed. Save changes under a new package name.');
  return {folder, name, manifest, specText:(await regular(join(folder,'original-openapi.json'))).toString('utf8'),
    plan:JSON.parse(await regular(join(folder,'merchant-plan.json')))};
}

/** Create a portable private package and the actual original compiler output. */
export async function savePackage({specText, plan, parent, name}) {
  const prepared = prepareMerchant(specText, plan), base = await privateParent(parent);
  const folder = join(base, packageName(name));
  const files = {
    'original-openapi.json':specText, 'merchant-plan.json':json(plan),
    'facade-openapi.json':json(prepared.facade), 'selections.json':json(prepared.selections),
    'route-bindings.json':json(prepared.bindings), 'upstreams.json':json(prepared.upstreams),
    'operator-cases.json':json(prepared.cases),
  };
  for (const [file,content] of Object.entries(files)) {
    if (Buffer.byteLength(content) > (file==='upstreams.json' ? 1024*1024 : LIMIT))
      fail('Prepared file exceeds the original compiler limit: ' + file + '. Select fewer routes.');
  }
  if (Buffer.byteLength(json(prepared.service))>1024*1024) fail('Compiled service exceeds the original 1 MiB limit. Select fewer routes.');
  const manifest = {schema:PACKAGE_SCHEMA, id:randomUUID(), createdAt:new Date().toISOString(),
    files:Object.fromEntries(Object.entries(files).map(([file,content])=>[file,sha(content)])),
    transformations:prepared.transformations, preview:prepared.preview};
  const manifestBytes=json(manifest);
  if (Buffer.byteLength(manifestBytes)>MANIFEST_LIMIT) fail('Package manifest exceeds 1 MiB. Select fewer routes.');
  await mkdir(folder, {mode:0o700});
  for (const [file,content] of Object.entries(files)) await writeFile(join(folder,file), content, {flag:'wx',mode:0o600});
  await compileSeller(['--spec',join(folder,'facade-openapi.json'),'--config',join(folder,'selections.json'),
    '--service-bindings',join(folder,'route-bindings.json'),'--out',join(folder,'compiled')]);
  await mkdir(join(folder,'support'), {mode:0o700});
  await writeFile(join(folder,'merchant-package.json'), manifestBytes, {flag:'wx',mode:0o600});
  const args = ['node',join(sourceRoot,'sf96-seller-pilot-ops/pilot-ops.mjs'),'start','--ops-port','0','--support-parent',join(folder,'support'),'--',
    '--resume',join(folder,'compiled'),'--upstreams',join(folder,'upstreams.json'),'--port','0','--challenge-only'];
  if (plan.allowLoopbackUpstream) args.push('--allow-loopback-upstream');
  const command = args.map(shell).join(' ');
  const guide = [
    '# API merchant package', '', 'Created from the original API description with an explicit public paid facade.',
    'Source and transformation hashes are in merchant-package.json. Prices are atomic-unit strings.',
    '', '## Start the original seller and operations dashboard', '', 'Node 22+ and the full current source checkout are required.',
    '', '~~~sh', command, '~~~', '',
    'For native facilitator mode, replace --challenge-only with --facilitator YOUR_AUTHORIZED_HTTPS_FACILITATOR.',
    'Supply environment variables in the launcher process: ' + (prepared.preview.environment.join(', ') || '(none)') + '.',
    'Authorization variables contain the complete header value, including Bearer or Basic when required.',
    'Environment values are never stored in this package. After moving the package, adjust command paths.',
    '', 'The seller listens on loopback. Route your HTTPS gateway to it while preserving the public paths.',
    'Challenge-only mode returns native payment challenges but does not verify or settle payments.',
    'Inspect the operations URL printed at startup. Stop with Ctrl-C. Resume the same compiled directory.',
    '', '## Check the saved request examples', '',
    'In the workspace, start challenge preview and select Check unpaid routes. It uses the original SF96 reviewer and this package\'s operator-cases.json.',
    'For shell use, pass the printed seller URL and a new private output directory:', '', '~~~sh',
    ['node',join(sourceRoot,'sf96-seller-acceptance/audit.mjs'),'--seller','http://127.0.0.1:SELLER_PORT','--cases',join(folder,'operator-cases.json'),'--out',join(folder,'support','route-review-001')].map(shell).join(' '),
    '~~~', '', 'Request examples are public offer examples. Keep reusable demonstration values in them. Original request schemas validate inputs before native payment verification.',
    'Selected declared response contracts retain original successful status, media and JSON schema assertions. Bytes routes or an explicit none selection do not carry JSON response validation.',
    'Optional shared read policies are retained in upstreams.json. Each delivery still uses the original native payment lifecycle.',
    'The API workspace shows live cache counts and can invalidate a selected binding for the exact managed runtime.',
    'Cached bodies stay in process memory. Restart starts empty; backend credentials and response policy are checked by the original transport.',
    '', '## Explicit facade adaptation', '',
    'Original server URLs remain in original-openapi.json. Selected facade operations use your declared public seller server.',
    'Supported backend security is satisfied by operator header environment references and removed only from the generated public facade.',
    'The original API description remains unchanged. No endpoint was probed during preparation.',
    '', '## Routes', '', ...prepared.preview.routes.map(r => '- ' + r.method + ' ' + r.publicUrl + ' -> ' + r.upstream + ' (' + r.amountAtomic + ' atomic units)'), ''
  ].join('\n');
  await writeFile(join(folder,'RUN.md'), guide, {flag:'wx',mode:0o600});
  return {name, folder, manifest, command, preview:prepared.preview};
}

