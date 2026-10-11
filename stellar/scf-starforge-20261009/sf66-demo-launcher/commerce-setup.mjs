// MIT. Prepare one actual merchant session with the original operator workspace.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';
import { validateAvailabilityDirectory } from '../sf30-seller-sdk/availability/store.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { compileHttpSellerOffer } from '../sf30-seller-sdk/seller.mjs';
import { compileAssetRouteOffer } from '../sf30-seller-sdk/response-asset.mjs';
import { compileSellerOpenApi } from '../sf30-seller-sdk/developer-portal.mjs';
import { buildUnpaidRequest } from '../sf30-seller-sdk/developer/request.mjs';
import { requiresJsonBody } from '../sf30-seller-sdk/http-methods.mjs';
import { selectServiceRoute } from '../sf30-seller-sdk/route-path.mjs';
import { createLiveRequestAdmission } from '../sf89-live-request-admission/index.mjs';
import { readConfig as readFacilitator, reviewConfig } from '../native-facilitator/config.mjs';
import { initializeWorkspace, openWorkspace } from '../sf88-operator-buyer-cli/workspace.mjs';
import { config as readBuyer, operation, execution, responseFile, requestTimeoutMs, buyerTransport } from '../sf88-operator-buyer-cli/config.mjs';
import { validateNativeSignerConfiguration } from '../sf88-operator-buyer-cli/native-signer.mjs';
import { absolute, parseJson, readPrivateFile } from '../sf103-native-buyer-signer/operator.mjs';
import { readUpstreamCommerce, describeUpstreamCommerce, readUpstreamPurchaseTicket,
  upstreamPurchaseTicketView } from './commerce-upstream.mjs';
import { preparePythonCommerce, describePythonCommerce } from './commerce-python.mjs';
import { readJsonrpcCommerce, describeJsonrpcCommerce, validateJsonrpcCommerceRequest } from './commerce-jsonrpc.mjs';

const SCHEMA = 'stellar-forge.commerce-setup.v1';
const SNAPSHOT = 'stellar-forge.prepared-commerce.v1';
const I64 = 9223372036854775807n;
const own = (value, key) => Object.hasOwn(value, key);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const commerceCli = fileURLToPath(new URL('./commerce-cli.mjs', import.meta.url));
const commerceConsole = fileURLToPath(new URL('./commerce-console.mjs', import.meta.url));
const pythonMerchantCli = fileURLToPath(new URL('../sf30-seller-sdk/python/merchant.mjs', import.meta.url));
const jsonrpcMerchantCli = fileURLToPath(new URL('../sf30-seller-sdk/jsonrpc/cli.mjs', import.meta.url));
const buyerCli = fileURLToPath(new URL('../sf88-operator-buyer-cli/cli.mjs', import.meta.url));
const thisCli = fileURLToPath(import.meta.url);
function need(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
function fields(value, names, code) {
  need(object(value) && Object.keys(value).every(key => names.includes(key)), code);
  return value;
}
function atomic(value, code) {
  need(typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= I64, code);
  return BigInt(value);
}
function port(value, fallback) {
  value ??= fallback;
  need(Number.isInteger(value) && value >= 0 && value <= 65535, 'COMMERCE_SETUP_PORT_INVALID');
  return value;
}
async function privateDirectory(path) {
  absolute(path);
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || info.uid === process.getuid() && (info.mode & 0o077) === 0),
  'COMMERCE_SETUP_PRIVATE_DIRECTORY_REQUIRED');
  return info;
}
async function writeNew(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function regularSource(path) {
  absolute(path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.size <= 1048576 && (info.mode & 0o022) === 0,
      'COMMERCE_SETUP_HANDLER_FILE_INVALID');
    return { path, sha256:sha(await file.readFile()) };
  } finally { await file.close(); }
}
function queryObject(url) {
  const result = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!own(result, key)) result[key] = value;
    else result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
  }
  return result;
}

// The original compiler requires application callbacks. This offline projection
// never imports or invokes an application's handler, admission or response source.
const compilationOnly = () => { throw new Error('COMMERCE_SETUP_COMPILATION_ONLY'); };
function compileMerchant(config) {
  const origin = config.publicOrigin;
  need(typeof origin === 'string', 'COMMERCE_SETUP_PUBLIC_ORIGIN_REQUIRED');
  return compileSellerRoutes(config.routes.map(route => ({
    id:route.id, handler:compilationOnly,
    ...(route.admit || route.validateInput ? {admit:compilationOnly} : {}),
    ...(route.responseAsset ? {
      offer:compileAssetRouteOffer(route, origin, compileHttpSellerOffer),
    } : route.offer ? {offer:route.offer} : {
      definition:{...route.definition, url:origin + route.path},
    }),
  })));
}

/** Source-native configuration preview. No listener, keys, ledger or payment. */
export async function reviewCommerceSetup({ configFile, directory }) {
  absolute(configFile); absolute(directory);
  const source = await readPrivateFile(configFile);
  const input = fields(parseJson(source),
    ['schema','seller','operator','purchases','operationsPort','operationControls'], 'COMMERCE_SETUP_FIELDS_INVALID');
  need(input.schema === SCHEMA, 'COMMERCE_SETUP_SCHEMA_INVALID');
  const seller = fields(input.seller, ['config','python','jsonrpc','handlers','upstreams','allowLoopbackUpstream',
    'availabilityDirectory','facilitatorConfig','port'],
    'COMMERCE_SETUP_SELLER_INVALID');
  need([seller.config, seller.python, seller.jsonrpc].filter(Boolean).length === 1,
    'COMMERCE_SETUP_ONE_MERCHANT_CONFIGURATION_REQUIRED');
  need(!seller.python || seller.handlers === undefined, 'COMMERCE_SETUP_PYTHON_USES_ORIGINAL_HANDLERS');
  need(!seller.jsonrpc || seller.handlers === undefined, 'COMMERCE_SETUP_JSONRPC_USES_ORIGINAL_HANDLERS');
  need(seller.upstreams === undefined || seller.config && seller.handlers === undefined,
    'COMMERCE_UPSTREAM_USES_CONFIGURED_APPLICATION');
  need(seller.allowLoopbackUpstream === undefined || (seller.upstreams !== undefined || seller.jsonrpc !== undefined) &&
    typeof seller.allowLoopbackUpstream === 'boolean', 'COMMERCE_UPSTREAM_LOOPBACK_INVALID');
  need(input.operationControls === undefined || typeof input.operationControls === 'boolean',
    'COMMERCE_OPERATION_CONTROLS_INVALID');
  const availabilityDirectory = seller.availabilityDirectory === undefined ? null :
    validateAvailabilityDirectory(seller.availabilityDirectory);
  const sellerPath = seller.python ?? seller.jsonrpc ?? seller.config;
  absolute(sellerPath); absolute(seller.facilitatorConfig);
  // Validate the original private bytes before its readers resolve response paths.
  const sellerBytes = await readPrivateFile(sellerPath, 1048576);
  const facilitatorBytes = await readPrivateFile(seller.facilitatorConfig);
  const python = seller.python ? await preparePythonCommerce(seller.python) : null;
  const jsonrpc = seller.jsonrpc ? await readJsonrpcCommerce(seller.jsonrpc,
    { allowLoopback: seller.allowLoopbackUpstream === true, expectedSha256: sha(sellerBytes) }) : null;
  const merchant = python?.compiled.service ?? jsonrpc?.service ?? await readSellerConfig(seller.config);
  const upstream = seller.upstreams === undefined ? null : await readUpstreamCommerce(seller.upstreams, merchant,
    {allowLoopback:seller.allowLoopbackUpstream === true});
  need(!input.operationControls || upstream &&
    Object.values(upstream.review.bindings).some(binding => binding.idempotency),
  'COMMERCE_OPERATION_CONTROLS_REQUIRE_IDEMPOTENT_UPSTREAM');
  const facilitator = await readFacilitator(seller.facilitatorConfig);
  need(sha(await readPrivateFile(sellerPath, 1048576)) === sha(sellerBytes) &&
    sha(await readPrivateFile(seller.facilitatorConfig)) === sha(facilitatorBytes),
  'COMMERCE_SETUP_SOURCE_CHANGED_DURING_REVIEW');
  need(facilitator.network === 'stellar:testnet', 'COMMERCE_SETUP_TESTNET_REQUIRED');
  const compiled = compileMerchant(merchant);
  for (const route of compiled.routes) for (const terms of route.offer.accepts) {
    need(terms.scheme === 'exact' && terms.network === facilitator.network &&
      facilitator.payments.assets.includes(terms.asset) &&
      facilitator.payments.recipients.includes(terms.payTo) &&
      /^[1-9][0-9]{0,38}$/.test(terms.amount) &&
      BigInt(terms.amount) <= BigInt(facilitator.payments.maxAtomic),
    'COMMERCE_SETUP_ADVERTISED_TERMS_OUTSIDE_FACILITATOR');
  }
  const handlers = seller.handlers === undefined ? null : await regularSource(seller.handlers);
  need(python || upstream || jsonrpc || handlers || !merchant.routes.some(route => route.handler || route.admit),
    'COMMERCE_SETUP_HANDLER_MODULE_REQUIRED');
  const operator = fields(input.operator,
    ['actor','service','python','payer','secretEnv','signerProvider','httpsProxyEnv','totalAtomic','dailyAtomic'],
    'COMMERCE_SETUP_OPERATOR_INVALID');
  need(typeof operator.payer === 'string' && /^G[A-Z2-7]{55}$/.test(operator.payer),
    'COMMERCE_SETUP_PUBLIC_PAYER_REQUIRED');
  need((operator.secretEnv !== undefined) !== (operator.signerProvider !== undefined),
    'COMMERCE_SETUP_ONE_SIGNER_SOURCE_REQUIRED');
  need(operator.secretEnv === undefined || /^[A-Z][A-Z0-9_]{0,127}$/.test(operator.secretEnv),
    'COMMERCE_SETUP_SIGNER_ENV_INVALID');
  if (operator.signerProvider !== undefined) absolute(operator.signerProvider);
  absolute(operator.python);
  for (const name of ['actor','service']) need(typeof operator[name] === 'string' &&
    /^[A-Za-z0-9._:-]{1,160}$/.test(operator[name]), 'COMMERCE_SETUP_OPERATOR_ID_REQUIRED');
  const total = atomic(operator.totalAtomic, 'COMMERCE_SETUP_TOTAL_REQUIRED');
  const daily = atomic(operator.dailyAtomic, 'COMMERCE_SETUP_DAILY_REQUIRED');
  need(daily <= total, 'COMMERCE_SETUP_DAILY_EXCEEDS_TOTAL');
  need(Array.isArray(input.purchases) && input.purchases.length >= 1 && input.purchases.length <= 64,
    'COMMERCE_SETUP_PURCHASES_REQUIRED');
  const specification = compileSellerOpenApi(compiled);
  const operations = Object.values(specification.paths).flatMap(path => Object.values(path));
  const selections = [], intents = new Set();
  for (const [index, value] of input.purchases.entries()) {
    const selected = fields(value, ['routeId','acceptIndex','intentId','method','path','query',
      'bodyFile','ticketFile','ticketHeader','saveResponse','responseMaxBytes','responseTimeoutMs',
      'requestTimeoutMs'], 'COMMERCE_SETUP_SELECTION_INVALID');
    const route = compiled.routes.find(route => route.id === selected.routeId);
    need(route && selected.method === route.method, 'COMMERCE_SETUP_EXPLICIT_ROUTE_METHOD_REQUIRED');
    need(Number.isInteger(selected.acceptIndex) && selected.acceptIndex >= 0 &&
      selected.acceptIndex < route.offer.accepts.length, 'COMMERCE_SETUP_EXPLICIT_PAYMENT_OPTION_REQUIRED');
    need(!intents.has(selected.intentId), 'COMMERCE_SETUP_DUPLICATE_INTENT');
    const terms = route.offer.accepts[selected.acceptIndex];
    atomic(terms.amount, 'COMMERCE_SETUP_AMOUNT_EXCEEDS_ORIGINAL_LEDGER');
    need(requiresJsonBody(route.method) === (selected.bodyFile !== undefined),
      'COMMERCE_SETUP_EXPLICIT_BODY_FILE_REQUIRED');
    const body = selected.bodyFile === undefined ? null : await readPrivateFile(selected.bodyFile, 1048576);
    const bodyText = body === null ? undefined :
      new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(body);
    const apiOperation = operations.find(operation => operation.operationId === route.id);
    const request = buildUnpaidRequest(apiOperation, {path:selected.path, query:selected.query,
      ...(body === null ? {} : {body:bodyText})}, merchant.publicOrigin);
    const target = new URL(request.publicUrl);
    const matched = selectServiceRoute(compiled.routes, target.pathname, route.method);
    need(matched?.route?.id === route.id, 'COMMERCE_SETUP_REQUEST_SELECTS_ANOTHER_ROUTE');
    const originalRoute = merchant.routes.find(item => item.id === route.id);
    if (originalRoute.validateInput) {
      const valid = createLiveRequestAdmission(route.offer)({method:route.method,
        query:queryObject(target), pathParams:matched.pathParams,
        ...(body === null ? {} : {body:JSON.parse(bodyText)})});
      need(valid === true, valid?.body?.error ?? 'COMMERCE_SETUP_REQUEST_SCHEMA_REJECTED');
    }
    if (jsonrpc) validateJsonrpcCommerceRequest(jsonrpc, route.id, { method: route.method,
      url: target, query: queryObject(target), body: JSON.parse(bodyText) });
    const saveResponse = selected.saveResponse ?? route.method !== 'HEAD';
    need(typeof saveResponse === 'boolean' && !(route.method === 'HEAD' && saveResponse),
      'COMMERCE_SETUP_HEAD_HAS_NO_RESPONSE_BODY');
    need(saveResponse || selected.responseMaxBytes === undefined && selected.responseTimeoutMs === undefined,
      'COMMERCE_SETUP_RESPONSE_LIMIT_WITHOUT_DESTINATION');
    const key = String(index + 1).padStart(2, '0');
    const op = operation({intentId:selected.intentId, url:request.publicUrl, method:route.method,
      expect:{scheme:terms.scheme, network:terms.network, asset:terms.asset, payTo:terms.payTo,
        maxAtomic:terms.amount, maxTimeoutSeconds:terms.maxTimeoutSeconds,
        ...(terms.extra?.paymentFlow ? {paymentFlow:terms.extra.paymentFlow} : {})},
      headers:{Accept:request.init.headers.accept,
        ...(body === null ? {} : {'Content-Type':request.init.headers['content-type']})},
      ...(selected.ticketFile === undefined ? {} : {ticketFile:join(directory, 'tickets', key + '.json')}),
      ...(selected.ticketHeader === undefined ? {} : {ticketHeader:selected.ticketHeader}),
      ...(body === null ? {} : {bodyFile:join(directory, 'bodies', key + '.json')})});
    const ticket = await readUpstreamPurchaseTicket(selected, op, upstream, originalRoute);
    intents.add(op.intentId);
    const draft = {operation:op, captureBody:false,
      ...(selected.requestTimeoutMs === undefined ? {} : {requestTimeoutMs:selected.requestTimeoutMs}),
      ...(saveResponse ? {
      responseFile:{destination:join(directory, 'responses', key + '.bin'),
        ...(selected.responseMaxBytes === undefined ? {} : {maxBytes:selected.responseMaxBytes}),
        ...(selected.responseTimeoutMs === undefined ? {} : {timeoutMs:selected.responseTimeoutMs})},
    } : {})};
    responseFile(draft);
    requestTimeoutMs(draft);
    selections.push({key, routeId:route.id, acceptIndex:selected.acceptIndex,
      originalOffer:structuredClone(route.offer), draft, body, ticket,
      bodySha256:body === null ? null : sha(body), bodyBytes:body?.length ?? 0});
  }
  const first = selections[0].draft.operation.expect;
  need(selections.every(({draft}) => ['network','asset','payTo'].every(key =>
    draft.operation.expect[key] === first[key])), 'COMMERCE_SETUP_ONE_WORKSPACE_ASSET_RECIPIENT_REQUIRED');
  const maximum = selections.reduce((best, item) =>
    BigInt(item.draft.operation.expect.maxAtomic) > BigInt(best.draft.operation.expect.maxAtomic) ? item : best);
  const single = BigInt(maximum.draft.operation.expect.maxAtomic);
  need(single <= daily, 'COMMERCE_SETUP_PURCHASE_EXCEEDS_DAILY_BUDGET');
  validateNativeSignerConfiguration({network:first.network, asset:first.asset, payTo:first.payTo,
    expectedPayer:operator.payer, maxAtomic:String(single), rpcUrl:facilitator.rpcUrl});
  const transport = operator.httpsProxyEnv === undefined ? null : buyerTransport({
    operation:maximum.draft.operation, buyerTransport:{mode:'explicit-connect',
      origin:new URL(maximum.draft.operation.url).origin, proxyEnv:operator.httpsProxyEnv},
  });
  const planned = selections.reduce((sum, item) => sum + BigInt(item.draft.operation.expect.maxAtomic), 0n);
  const summary = {schema:SCHEMA, state:'CONFIGURATION_REVIEWED', directory,
    publicOrigin:merchant.publicOrigin, network:facilitator.network,
    ...(python ? {python:describePythonCommerce(python)} : {}),
    ...(upstream ? {upstreams:describeUpstreamCommerce(upstream)} : {}),
    ...(jsonrpc ? {jsonrpc:describeJsonrpcCommerce(jsonrpc)} : {}),
    operationControls:input.operationControls === true,
    availabilityDirectory,
    payer:operator.payer, asset:first.asset, recipient:first.payTo, buyerTransport:transport,
    sharedBudget:{maxSingleAtomic:String(single), totalAtomic:String(total), dailyAtomic:String(daily),
      selectedTotalAtomic:String(planned), allSelectionsFitTotal:planned <= total},
    facilitator:reviewConfig(facilitator),
    selections:selections.map(item => ({intentId:item.draft.operation.intentId, routeId:item.routeId,
      method:item.draft.operation.method, url:item.draft.operation.url, acceptIndex:item.acceptIndex,
      originalTerms:item.originalOffer.accepts[item.acceptIndex], bodyBytes:item.bodyBytes,
      bodySha256:item.bodySha256, operationTicket:upstreamPurchaseTicketView(item.ticket),
      responseFile:item.draft.responseFile ?? null, requestTimeoutMs:requestTimeoutMs(item.draft)})),
    signingMaterialLoaded:false, paymentAttempts:0};
  return {summary, merchant, facilitator, operator, selections, maximum, handlers, python, upstream, jsonrpc,
    operationControls:input.operationControls === true,
    availabilityDirectory,
    sellerPort:port(seller.port, 8423), operationsPort:port(input.operationsPort, 0),
    source:{configFile, configSha256:sha(source), sellerFile:sellerPath,
      sellerSha256:sha(sellerBytes), facilitatorFile:seller.facilitatorConfig,
      ...(python ? {pythonApplication:python.compiled.options.application,
        pythonApplicationSha256:python.applicationSha256} : {}),
      ...(upstream ? {upstreamsFile:upstream.file, upstreamsSha256:upstream.sha256} : {}),
      ...(jsonrpc ? {jsonrpcFile:jsonrpc.file, jsonrpcSha256:jsonrpc.sha256} : {}),
      facilitatorSha256:sha(facilitatorBytes)}};
}

/** Create the original SF88 workspace once, then reuse its ledger for every intent. */
export async function prepareCommerceSetup({configFile, directory}, {environment = process.env} = {}) {
  const reviewed = await reviewCommerceSetup({configFile, directory});
  await privateDirectory(dirname(directory));
  const {initializeCommerce, bindMerchantPurchase} = await import('./commerce.mjs');
  const {summary, merchant, facilitator, operator, selections, maximum, handlers, python, upstream, jsonrpc} = reviewed;
  const compiled = compileMerchant(merchant);
  // Reuse the session's own offer selection rules before creating any workspace.
  for (const item of selections) need(bindMerchantPurchase(compiled, item.draft).acceptIndex === item.acceptIndex,
    'COMMERCE_SETUP_PAYMENT_OPTION_NOT_UNIQUE');
  let created;
  try {
    await mkdir(directory, {mode:0o700});
    created = await privateDirectory(directory);
    for (const name of ['bodies','responses','buyers','tickets']) await mkdir(join(directory, name), {mode:0o700});
    const captured = [];
    const retain = async (path, value) => {
      const bytes = Buffer.isBuffer(value) ? value : json(value);
      await writeNew(path, bytes);
      captured.push({path, bytes:bytes.length, sha256:sha(bytes)});
    };
    for (const item of selections) {
      if (item.body !== null) await retain(item.draft.operation.bodyFile, item.body);
      if (item.ticket) await retain(item.draft.operation.ticketFile, item.ticket.sourceBytes);
      await retain(join(directory, 'buyers', item.key + '-review.json'), item.draft);
    }
    await retain(join(directory, 'seller.json'), merchant);
    if (python) await retain(join(directory, 'python.json'), python.declaration);
    if (upstream) await retain(join(directory, 'upstreams.json'), upstream.sourceBytes);
    if (jsonrpc) await retain(join(directory, 'jsonrpc.json'), jsonrpc.sourceBytes);
    await retain(join(directory, 'facilitator.json'), facilitator);
    const workspace = join(directory, 'operator');
    const args = ['--config', join(directory, 'buyers', maximum.key + '-review.json'), '--dir', workspace,
      '--actor', operator.actor, '--service', operator.service, '--python', operator.python,
      '--payer', operator.payer, '--total-atomic', operator.totalAtomic, '--daily-atomic', operator.dailyAtomic,
      '--rpc', facilitator.rpcUrl, ...(operator.httpsProxyEnv === undefined ? [] :
        ['--https-proxy-env', operator.httpsProxyEnv]), ...(operator.secretEnv !== undefined ?
        ['--secret-env', operator.secretEnv] : ['--signer-provider', operator.signerProvider])];
    const initialized = await initializeWorkspace(args, {environment});
    const base = await readBuyer(initialized.config);
    const buyers = [];
    for (const item of selections) {
      const configured = {...base, ...item.draft};
      if (!item.draft.responseFile) delete configured.responseFile;
      if (item.draft.requestTimeoutMs === undefined) delete configured.requestTimeoutMs;
      execution(configured);
      const path = join(directory, 'buyers', item.key + '.json');
      await retain(path, configured);
      buyers.push({config:path, workspace});
    }
    const planFile = join(directory, 'commerce-plan.json');
    await retain(planFile, {schema:'stellar-forge.commerce-plan.v1',
      seller:{...(python ? {python:join(directory, 'python.json')} : jsonrpc ? {jsonrpc:join(directory, 'jsonrpc.json')} :
        {config:join(directory, 'seller.json')}),
        ...(reviewed.availabilityDirectory ? {availabilityDirectory:reviewed.availabilityDirectory} : {}),
        ...(upstream ? {upstreams:join(directory, 'upstreams.json'), allowLoopbackUpstream:upstream.allowLoopback} : {}),
        ...(jsonrpc ? {allowLoopbackUpstream:jsonrpc.allowLoopback} : {}),
        facilitatorConfig:join(directory, 'facilitator.json'),
        port:reviewed.sellerPort, ...(handlers ? {handlers:handlers.path} : {})},
      operationsPort:reviewed.operationsPort, operationControls:reviewed.operationControls, buyers});
    const session = join(directory, 'session');
    const initializedSession = await initializeCommerce({planFile, directory:session});
    need(!python || initializedSession.python?.applicationSha256 === python.applicationSha256,
      'COMMERCE_SETUP_PYTHON_SOURCE_CHANGED');
    need(!upstream || initializedSession.upstreams?.sha256 === upstream.sha256,
      'COMMERCE_UPSTREAM_CONFIG_CHANGED');
    need(!jsonrpc || initializedSession.jsonrpc?.sha256 === jsonrpc.sha256,
      'COMMERCE_JSONRPC_PLAN_CHANGED');
    await retain(join(directory, 'prepared.json'), {
      schema:SNAPSHOT, createdAt:new Date().toISOString(), directory, session, workspace,
      planFile, source:reviewed.source, files:captured, handlers,
      summary:{...summary, state:'PREPARED', operatorKeySource:initialized.operatorKeySource},
    });
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    return inspectCommerceSetup(directory);
  } catch (error) {
    if (created) {
      const current = await lstat(directory).catch(() => null);
      if (current?.dev === created.dev && current?.ino === created.ino)
        await rm(directory, {recursive:true, force:true}).catch(() => {});
    }
    throw error;
  }
}

/** Reopen original retained setup and inbox without opening wallet or operator keys. */
export async function inspectCommerceSetup(directory) {
  await privateDirectory(directory);
  const record = parseJson(await readPrivateFile(join(directory, 'prepared.json'), 1048576));
  need(record.schema === SNAPSHOT && record.directory === directory &&
    record.session === join(directory, 'session') && record.workspace === join(directory, 'operator') &&
    record.planFile === join(directory, 'commerce-plan.json') && Array.isArray(record.files) &&
    record.files.length <= 64 * 4 + 16, 'COMMERCE_SETUP_SNAPSHOT_INVALID');
  for (const item of record.files) {
    need(typeof item.path === 'string' && item.path.startsWith(directory + '/') &&
      resolve(item.path) === item.path && item.path !== join(directory, 'prepared.json'),
    'COMMERCE_SETUP_SNAPSHOT_PATH_INVALID');
    const bytes = await readPrivateFile(item.path, 1048576);
    need(bytes.length === item.bytes && sha(bytes) === item.sha256, 'COMMERCE_SETUP_INPUT_CHANGED');
  }
  await openWorkspace(['--dir', record.workspace]);
  const {inspectCommerce} = await import('./commerce.mjs');
  const session = await inspectCommerce(record.session);
  return {...record.summary, session, workspace:record.workspace, planFile:record.planFile,
    commands:{
      inspect:[process.execPath, thisCli, 'inspect', '--directory', directory],
      diagnose:[process.execPath, buyerCli, '--diagnose-workspace', '--dir', record.workspace],
      start:[process.execPath, commerceCli, 'start', '--directory', record.session],
      console:[process.execPath, commerceConsole, 'start', '--directory', record.session],
      ...(record.summary.python ? {diagnosePython:[process.execPath, pythonMerchantCli,
        'diagnose', '--config', join(record.session, 'python.json')]} : {}),
      ...(record.summary.jsonrpc ? {diagnoseJsonrpc:[process.execPath, jsonrpcMerchantCli,
        'diagnose', '--plan', join(record.session, 'jsonrpc.json'),
        ...(record.summary.jsonrpc.allowLoopback ? ['--allow-loopback-upstream'] : [])]} : {}),
    }};
}

function options(args) {
  need(args.length % 2 === 0, 'COMMERCE_SETUP_OPTION_VALUE_REQUIRED');
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    need(['--config','--directory'].includes(args[i]) && !own(result, args[i]) &&
      typeof args[i + 1] === 'string', 'COMMERCE_SETUP_OPTION_INVALID');
    result[args[i]] = args[i + 1];
  }
  return result;
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: commerce-setup.mjs review|prepare --config /private/setup.json --directory /private/new-commerce\n' +
      '       commerce-setup.mjs inspect --directory /private/prepared-commerce\n' +
      'Preparation creates one original testnet operator workspace and commerce session. Use commerce-cli.mjs for the actual native purchase.\n' +
      'For a retained Stellar JSON-RPC product, set seller.jsonrpc and follow JSONRPC_COMMERCE.md.\n');
    return;
  }
  const [command, ...rest] = args, opt = options(rest);
  const input = {configFile:opt['--config'], directory:opt['--directory']};
  let result;
  if (command === 'review') result = (await reviewCommerceSetup(input)).summary;
  else if (command === 'prepare') result = await prepareCommerceSetup(input);
  else if (command === 'inspect' && opt['--config'] === undefined) result = await inspectCommerceSetup(input.directory);
  else need(false, 'COMMERCE_SETUP_COMMAND_REQUIRED');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => {
    const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'COMMERCE_SETUP_FAILED';
    process.stderr.write(JSON.stringify({error:code}) + '\n');
    process.exitCode = 1;
  });
