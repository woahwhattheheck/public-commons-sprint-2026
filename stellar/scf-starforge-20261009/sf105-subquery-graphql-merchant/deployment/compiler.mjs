// MIT. Bind original SF105 packages to original SF61/SF82 releases and SF99 hosts.
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importOpenApi } from '../../sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../sf61-openapi-seller-import/service-config.mjs';
import { stageRelease } from '../../sf82-seller-pilot/releases.mjs';
import { generate as generateHost, ROOT, SCHEMA as HOST_SCHEMA } from '../../sf99-merchant-deploy/host.mjs';
import { compileUpstreamBindings } from '../../sf30-seller-sdk/upstream.mjs';
import { compileSubQueryMerchantPlan } from '../onboarding/prepare.mjs';
import { readSubQueryMerchantBundle } from '../onboarding/revisions.mjs';
import { digest, fail, fields, jsonBytes, own, parseJson, readBytes, record, text, writeBundle } from '../onboarding/files.mjs';

export const SCHEMA = 'stellar-forge.subquery-deployment.v1';
const ADAPTER = fileURLToPath(new URL('../adapter.mjs', import.meta.url));
const FILES = ['handlers.mjs', 'release-inputs/openapi.json', 'release-inputs/selections.json',
  'release-inputs/bindings.json', 'release-inputs/service.json', 'release-inputs/review.json', 'RUN.md'];
const HASH = /^[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : record(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const inside = (parent, child) => {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
};
const nativePaths = directory => ({ spec: join(directory, 'release-inputs/openapi.json'),
  config: join(directory, 'release-inputs/selections.json'), bindings: join(directory, 'release-inputs/bindings.json'),
  service: join(directory, 'release-inputs/service.json'), review: join(directory, 'release-inputs/review.json') });

async function destination(value, original) {
  text(value, 'New directory', 4096);
  const requested = resolve(value), parent = await realpath(dirname(requested));
  const target = join(parent, basename(requested));
  if (inside(original, target)) fail('DEPLOYMENT_DIRECTORY', 'Choose a new directory outside the retained merchant or deployment');
  return target;
}
async function finishFile(path, data) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

function verifyTransport(queries, allowLoopback) {
  if (typeof allowLoopback !== 'boolean') fail('LOOPBACK_OPTION', 'allowLoopbackUpstream must be a boolean');
  // The original compiler checks endpoint/limits without resolving a credential.
  compileUpstreamBindings({ schema: 'stellar-forge.seller-upstreams.v1', bindings: { graphql: {
    origin: queries.origin, path: queries.path, method: 'POST', query: [], responseMode: 'json',
    timeoutMs: queries.timeoutMs ?? 8000, maxResponseBytes: queries.maxResponseBytes ?? 262144,
    maxInFlight: queries.maxInFlight ?? 8,
  } } }, { allowLoopback, env: {} });
}

function handlerModule(queries, adapter, allowLoopbackUpstream) {
  const names = queries.operations.flatMap(operation => [operation.handler, operation.admission]);
  if (names.includes('then')) fail('HANDLER_EXPORT', 'Use a different approved handler/admission name: ESM imports reserve the callable export then');
  // String export names preserve legal original names including JS reserved words.
  // JSON.parse preserves JSON data semantics; no caller text becomes source code.
  return `// Generated from one verified original SF105 merchant. Retain this entry and its original source release.\n` +
    `import { readFile } from 'node:fs/promises';\nimport { createHash } from 'node:crypto';\n` +
    `const adapter = new URL(${JSON.stringify(new URL('../adapter.mjs', import.meta.url).href)});\n` +
    `if (createHash('sha256').update(await readFile(adapter)).digest('hex') !== ${JSON.stringify(adapter.sha256)})\n` +
    `  throw new Error('Original SF105 adapter changed; prepare a new deployment from the reviewed merchant');\n` +
    `const { createSubQueryMerchantHandlers } = await import(adapter.href);\n` +
    `const queries = JSON.parse(${JSON.stringify(JSON.stringify(queries))});\n` +
    `const original = createSubQueryMerchantHandlers(queries, { allowLoopback: ${allowLoopbackUpstream}, env: process.env });\n` +
    names.map((name, index) => `const handler${index} = original[${JSON.stringify(name)}];\nexport { handler${index} as ${JSON.stringify(name)} };\n`).join('');
}

function compileReleaseInputs(service) {
  const spec = { openapi: '3.1.0', info: { title: 'Prepared GraphQL merchant', version: '1.0.0' },
    servers: [{ url: service.publicOrigin + '/' }], paths: {} };
  const selections = [], bindings = [];
  for (const route of service.routes) {
    const input = route.offer.extensions.bazaar;
    spec.paths[route.path] = { post: { operationId: route.id, description: route.offer.resource.description,
      ...(route.offer.resource.tags === undefined ? {} : { tags: structuredClone(route.offer.resource.tags) }),
      requestBody: { required: true, content: { 'application/json': {
        schema: structuredClone(input.schema.properties.input.properties.body), example: structuredClone(input.info.input.body),
      } } }, responses: { '200': { description: 'Original approved GraphQL operation result' } } } };
    selections.push({ method: 'POST', path: route.path, serviceName: route.offer.resource.serviceName,
      accepts: structuredClone(route.offer.accepts) });
    bindings.push({ method: 'POST', path: route.path, id: route.id, handler: route.handler,
      admit: route.admit, validateInput: true });
  }
  const imported = importOpenApi(spec, selections), release = createSellerServiceConfig(imported, bindings);
  if (jsonBytes(release).length > 1048576) fail('RELEASE_SIZE', 'Imported service exceeds the original seller 1 MiB limit');
  if (release.publicOrigin !== service.publicOrigin || release.routes.length !== service.routes.length)
    fail('RELEASE_CONTRACT', 'Original importer changed the prepared merchant origin or route count');
  for (const [index, route] of service.routes.entries()) {
    const output = release.routes[index];
    for (const key of ['id', 'path', 'handler', 'admit', 'validateInput']) if (output[key] !== route[key])
      fail('RELEASE_CONTRACT', 'Original importer changed a route or trusted application binding');
    for (const key of ['url', 'serviceName', 'description', 'tags'])
      if (!same(output.offer.resource[key], route.offer.resource[key]))
        fail('RELEASE_CONTRACT', 'Original importer changed public route metadata');
    if (!same(output.offer.accepts, route.offer.accepts) ||
        !same(output.offer.extensions.bazaar.info.input, route.offer.extensions.bazaar.info.input))
      fail('RELEASE_CONTRACT', 'Original importer changed ordered payment terms or the public request example');
    const input = structuredClone(output.offer.extensions.bazaar.schema.properties.input);
    const body = input.properties.body, example = route.offer.extensions.bazaar.info.input.body;
    if (!same(body.examples, [example])) fail('RELEASE_CONTRACT', 'Original importer changed the declared body example');
    delete body.examples; // The original importer adds this annotation, not an input assertion.
    if (!same(input, route.offer.extensions.bazaar.schema.properties.input))
      fail('RELEASE_CONTRACT', 'Original importer changed the native input assertions');
  }
  const review = { schema: 'stellar-forge.subquery-release-review.v1', publicOrigin: service.publicOrigin,
    originalServiceSha256: digest(jsonBytes(service)), releaseServiceSha256: digest(jsonBytes(release)),
    routes: service.routes.map(route => ({ id: route.id, method: 'POST', url: route.offer.resource.url,
      handler: route.handler, admit: route.admit, accepts: route.offer.accepts })),
    representation: { compiler: 'sf61-openapi-seller-import',
      preserved: ['route identity', 'named application and admission', 'input assertions', 'public request example',
        'ordered complete payment options', 'description, service name and tags'],
      nativeAnnotations: ['SF61 payment-required error text', 'SF61 body examples annotation',
        'SF61 omits optional resource mimeType and Bazaar output metadata'],
      buyer: 'Use the original generated client with the selected live seller challenge.' } };
  return { spec, selections, bindings, service: release, review };
}

function runbook(credentialReferences, allowLoopbackUpstream) {
  return `# GraphQL release and host package\n\nThis directory retains the exact original merchant in merchant/. handlers.mjs exports the original SF105 application and admission functions, with the approved query data embedded. It imports the original adapter from its recorded installed-source path. Keep that source release and this private directory available.\n\nCredential environment names: ${credentialReferences.join(', ') || 'none'}. Set the actual value only in the launching process or the private systemd environment file. Explicit same-host GraphQL permission: ${allowLoopbackUpstream}.\n\n## Original release store\n\nUse the original SF82 release CLI to initialize your private store, then the deployment CLI stage command with this directory, an explicit release ID and the existing store. Select a native facilitator only when launching the native merchant. Inspect/diff, activate with the original expected-generation guard, and run or manage it through the same original release/fleet console. Staging retains the handler entry hash and exact original SF61 inputs; it does not import the application or start a listener.\n\n## Original Linux host\n\nUse the deployment CLI host command with this directory and your original merchant-host.v1 settings. The compiler supplies kind:api, the retained merchant/service.json and handlers.mjs. Set merchant, serviceUser, mode, privateRoot, environmentFile (when a credential is named), and the original ports/runtime/facilitator settings. Follow installation/RUNBOOK.md and original sf99-merchant-deploy/cli.mjs check --bundle INSTALLATION_DIRECTORY. The generated original Caddy/systemd plan keeps operations private and provides its existing recovery and lifecycle procedures.\n\nThe complete command examples and API contract are in the installed sf105-subquery-graphql-merchant/deployment/README.md. Outputs are create-only. Prepare a new directory when the reviewed merchant, source installation or explicit loopback permission changes. Release staging and host preparation are separate original operator destinations; each starts the same original handler and preserves the same ordered payment terms.\n`;
}

/** Verify/recompile the original bundle and write a new private native deployment. */
export async function prepareSubQueryDeployment({ merchantDirectory, directory, allowLoopbackUpstream = false }) {
  const merchant = await readSubQueryMerchantBundle(merchantDirectory);
  const compiled = compileSubQueryMerchantPlan(merchant);
  verifyTransport(compiled.queries, allowLoopbackUpstream);
  const target = await destination(directory, merchant.directory);
  const adapter = { path: ADAPTER, sha256: digest(await readBytes(ADAPTER)) };
  const release = compileReleaseInputs(compiled.service);
  const credentialReferences = compiled.queries.authorizationEnv ? [compiled.queries.authorizationEnv] : [];
  const files = [['handlers.mjs', handlerModule(compiled.queries, adapter, allowLoopbackUpstream)],
    ['release-inputs/openapi.json', jsonBytes(release.spec)], ['release-inputs/selections.json', jsonBytes(release.selections)],
    ['release-inputs/bindings.json', jsonBytes(release.bindings)], ['release-inputs/service.json', jsonBytes(release.service)],
    ['release-inputs/review.json', jsonBytes(release.review)], ['RUN.md', runbook(credentialReferences, allowLoopbackUpstream)]];
  for (const [, data] of files) if (Buffer.byteLength(data) > 4 * 1024 * 1024)
    fail('DEPLOYMENT_SIZE', 'Native deployment input exceeds the original 4 MiB limit');
  const manifest = { schema: SCHEMA, createdAt: new Date().toISOString(), merchant: merchant.identity,
    adapter, allowLoopbackUpstream, credentialReferences,
    files: files.map(([name, data]) => ({ name, bytes: Buffer.byteLength(data), sha256: digest(data) })) };
  const root = await writeBundle(target, files);
  await writeBundle(join(root, 'merchant'), [...merchant.files]);
  await finishFile(join(root, 'deployment.json'), jsonBytes(manifest));
  return describe(root, manifest, digest(jsonBytes(manifest)), compiled.service, digest(merchant.files.get('service.json')));
}

function describe(directory, manifest, sha256, service, serviceSha256) {
  return { schema: SCHEMA, directory, manifest: join(directory, 'deployment.json'),
    identity: { deploymentSha256: sha256, merchant: manifest.merchant },
    merchant: join(directory, 'merchant'), service: join(directory, 'merchant/service.json'),
    queries: join(directory, 'merchant/queries.json'), client: join(directory, 'merchant/buyer/seller-client.mjs'),
    handlers: join(directory, 'handlers.mjs'), releaseInputs: nativePaths(directory),
    hashes: { ...Object.fromEntries(manifest.files.map(file => [file.name, file.sha256])), 'merchant/service.json': serviceSha256 },
    adapter: manifest.adapter, allowLoopbackUpstream: manifest.allowLoopbackUpstream,
    credentialReferences: manifest.credentialReferences,
    routes: service.routes.map(route => ({ id: route.id, method: 'POST', url: route.offer.resource.url,
      handler: route.handler, admit: route.admit, accepts: route.offer.accepts })) };
}

/** Reopen exact files and regenerate native inputs before stage/host consumers. */
export async function inspectSubQueryDeployment(directory) {
  text(directory, 'Deployment directory', 4096);
  if (!(await lstat(resolve(directory))).isDirectory()) fail('DEPLOYMENT_DIRECTORY', 'Use a regular deployment directory');
  const root = await realpath(directory), bytes = await readBytes(join(root, 'deployment.json'), 65536);
  const manifest = parseJson(bytes);
  fields(manifest, ['schema', 'createdAt', 'merchant', 'adapter', 'allowLoopbackUpstream', 'credentialReferences', 'files'], 'Deployment manifest');
  if (manifest.schema !== SCHEMA || !Array.isArray(manifest.files) || manifest.files.length !== FILES.length)
    fail('DEPLOYMENT_MANIFEST', 'A complete original GraphQL deployment manifest is required');
  fields(manifest.adapter, ['path', 'sha256'], 'Original adapter');
  if (manifest.adapter.path !== ADAPTER || !HASH.test(manifest.adapter.sha256) ||
      digest(await readBytes(ADAPTER)) !== manifest.adapter.sha256)
    fail('DEPLOYMENT_SOURCE_CHANGED', 'Original adapter location or source changed; prepare from the retained merchant again');
  const entries = new Map();
  for (const entry of manifest.files) {
    fields(entry, ['name', 'bytes', 'sha256'], 'Deployment file');
    if (!FILES.includes(entry.name) || entries.has(entry.name) || !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 1 || entry.bytes > 4 * 1024 * 1024 || !HASH.test(entry.sha256))
      fail('DEPLOYMENT_MANIFEST', 'Invalid native deployment file entry');
    const path = join(root, entry.name);
    if (!(await lstat(dirname(path))).isDirectory() || !(await lstat(path)).isFile())
      fail('DEPLOYMENT_FILE', 'Native deployment inputs must be regular files in regular directories');
    const data = await readBytes(path, 4 * 1024 * 1024);
    if (data.length !== entry.bytes || digest(data) !== entry.sha256)
      fail('DEPLOYMENT_CHANGED', 'A retained native deployment input changed');
    entries.set(entry.name, data);
  }
  const merchant = await readSubQueryMerchantBundle(join(root, 'merchant'));
  if (!same(merchant.identity, manifest.merchant)) fail('DEPLOYMENT_MERCHANT_CHANGED', 'The retained original merchant identity changed');
  const compiled = compileSubQueryMerchantPlan(merchant);
  verifyTransport(compiled.queries, manifest.allowLoopbackUpstream);
  const credentialReferences = compiled.queries.authorizationEnv ? [compiled.queries.authorizationEnv] : [];
  if (!same(credentialReferences, manifest.credentialReferences) ||
      !entries.get('handlers.mjs').equals(Buffer.from(handlerModule(compiled.queries, manifest.adapter, manifest.allowLoopbackUpstream))))
    fail('DEPLOYMENT_BINDING', 'Named handlers or environment references do not match the retained approved queries');
  const release = compileReleaseInputs(compiled.service);
  for (const [name, value] of [['openapi', release.spec], ['selections', release.selections],
    ['bindings', release.bindings], ['service', release.service], ['review', release.review]])
    if (!entries.get('release-inputs/' + name + '.json').equals(jsonBytes(value)))
      fail('DEPLOYMENT_BINDING', 'Retained release inputs differ from the original current compiler');
  return describe(root, manifest, digest(bytes), compiled.service, digest(merchant.files.get('service.json')));
}

/** Stage once in the existing immutable SF82 store; activation stays with SF82. */
export async function stageSubQueryDeployment(options) {
  fields(options, ['directory', 'store', 'id', 'label', 'port', 'facilitator', 'allowLocalFacilitator'], 'Release stage');
  const deployment = await inspectSubQueryDeployment(options.directory);
  text(options.store, 'Original release store', 4096);
  const store = await realpath(options.store);
  if (inside(deployment.directory, store)) fail('DEPLOYMENT_DIRECTORY', 'Keep the original release store outside the immutable deployment');
  const runtime = { handlers: deployment.handlers };
  for (const key of ['port', 'facilitator', 'allowLocalFacilitator']) if (own(options, key)) runtime[key] = options[key];
  const release = await stageRelease(store, { id: options.id, ...(own(options, 'label') ? { label: options.label } : {}),
    spec: deployment.releaseInputs.spec, config: deployment.releaseInputs.config, bindings: deployment.releaseInputs.bindings, runtime });
  if (release.source.serviceConfigSha256 !== deployment.hashes['release-inputs/service.json'] ||
      release.source.specSha256 !== deployment.hashes['release-inputs/openapi.json'] ||
      release.source.selectionsSha256 !== deployment.hashes['release-inputs/selections.json'] ||
      release.source.serviceBindingsSha256 !== deployment.hashes['release-inputs/bindings.json'] ||
      release.handlerEntry.sha256 !== deployment.hashes['handlers.mjs'])
    fail('RELEASE_SOURCE_CHANGED', 'Staged original release differs from the verified deployment; inspect it before activation');
  return { directory: deployment.directory, identity: deployment.identity, store, release };
}

/** Generate the existing native SF99 plan/bundle using the exact original service. */
export async function prepareSubQueryHost({ directory, host, destination: output }) {
  const deployment = await inspectSubQueryDeployment(directory);
  if (!record(host)) fail('HOST_SETTINGS', 'Supply an original merchant-host settings object');
  if (['config', 'handlers', 'upstreams', 'allowLoopbackUpstream'].some(name => own(host, name)) ||
      own(host, 'schema') && host.schema !== HOST_SCHEMA || own(host, 'kind') && host.kind !== 'api')
    fail('HOST_BINDING', 'GraphQL deployment supplies the original API service and handler bindings');
  if (deployment.credentialReferences.length && !host.environmentFile)
    fail('HOST_ENVIRONMENT', 'Set the original private environmentFile path for the named GraphQL credential');
  const target = await destination(output, deployment.directory);
  const plan = { ...structuredClone(host), schema: HOST_SCHEMA, kind: 'api',
    config: deployment.service, handlers: deployment.handlers };
  await writeBundle(target, [['host-plan.json', jsonBytes(plan)]]);
  const planFile = join(target, 'host-plan.json');
  const prepared = await generateHost(planFile, join(target, 'installation'), { sourceRoot: ROOT });
  const native = parseJson(await readBytes(join(prepared.bundle, 'deployment.json')));
  if (native.inputFiles.find(file => file.path === deployment.service)?.sha256 !== deployment.hashes['merchant/service.json'] ||
      native.inputFiles.find(file => file.path === deployment.handlers)?.sha256 !== deployment.hashes['handlers.mjs'])
    fail('HOST_SOURCE_CHANGED', 'Original host inputs changed during preparation; inspect before installation');
  return { directory: target, identity: deployment.identity, deployment: deployment.directory,
    plan: planFile, bundle: prepared.bundle, prepared, credentialReferences: deployment.credentialReferences };
}
