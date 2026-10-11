// MIT. Prepare one actual merchant session with the original operator workspace.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { readSellerConfig } from '../sf30-seller-sdk/serve.mjs';
import { validateAvailabilityDirectory } from '../sf30-seller-sdk/availability/store.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { compileHttpSellerOffer } from '../sf30-seller-sdk/seller.mjs';
import { compileAssetRouteOffer } from '../sf30-seller-sdk/response-asset.mjs';
import { compileSellerOpenApi } from '../sf30-seller-sdk/developer-portal.mjs';
import { readConfig as readFacilitator, reviewConfig } from '../native-facilitator/config.mjs';
import { initializeWorkspace, openWorkspace } from '../sf88-operator-buyer-cli/workspace.mjs';
import { acquireInitialization, initializationDirectory, optionalInitializationBytes,
  retainInitializationFile, retainInitializationRecord, verifyInitializationFile } from '../sf88-operator-buyer-cli/initialization.mjs';
import { config as readBuyer, execution, responseFile, requestTimeoutMs, buyerTransport } from '../sf88-operator-buyer-cli/config.mjs';
import { validateNativeSignerConfiguration } from '../sf88-operator-buyer-cli/native-signer.mjs';
import { absolute, parseJson, readPrivateFile } from '../sf103-native-buyer-signer/operator.mjs';
import { readUpstreamCommerce, describeUpstreamCommerce,
  upstreamPurchaseTicketView } from './commerce-upstream.mjs';
import { preparePythonCommerce, describePythonCommerce } from './commerce-python.mjs';
import { readJsonrpcCommerce, describeJsonrpcCommerce, validateJsonrpcCommerceRequest } from './commerce-jsonrpc.mjs';
import { prepareCommerceRequest, COMMERCE_REQUEST_TOTAL_BYTES } from './commerce-request.mjs';
import { MAX_REQUEST_BODY_BYTES } from '../sf88-operator-buyer-cli/request-body.mjs';
import { OPERATION_HANDOFF_MAX_BYTES } from '../sf88-operator-buyer-cli/operation-handoff.mjs';

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
// The original compiler requires application callbacks. This offline projection
// never imports or invokes an application's handler, admission or response source.
const compilationOnly = () => { throw new Error('COMMERCE_SETUP_COMPILATION_ONLY'); };
function compileMerchant(config, upstream) {
  const origin = config.publicOrigin;
  need(typeof origin === 'string', 'COMMERCE_SETUP_PUBLIC_ORIGIN_REQUIRED');
  return compileSellerRoutes(config.routes.map(route => ({
    id:route.id, handler:compilationOnly,
    maxRequestBytes:upstream?.configuration.bindings[route.handler]?.maxRequestBytes ?? route.maxRequestBytes ?? config.maxRequestBytes ?? 1048576,
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
  const compiled = compileMerchant(merchant, upstream);
  for (const route of compiled.routes) for (const terms of route.offer.accepts) {
    need(terms.scheme === 'exact' && terms.network === facilitator.network &&
      facilitator.payments.assets.includes(terms.asset) &&
      facilitator.payments.recipients.includes(terms.payTo) &&
      /^[1-9][0-9]{0,38}$/.test(terms.amount) &&
      BigInt(terms.amount) <= BigInt(facilitator.payments.maxAtomic),
    'COMMERCE_SETUP_ADVERTISED_TERMS_OUTSIDE_FACILITATOR');
    need(facilitator.payments.paymentFlows.includes(terms.extra?.paymentFlow ?? 'authorization'),
      'COMMERCE_SETUP_PAYMENT_FLOW_OUTSIDE_FACILITATOR');
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
  let requestBytes=0;
  for (const [index, value] of input.purchases.entries()) {
    const selected = fields(value, ['routeId','acceptIndex','intentId','method','path','query',
      'bodyFile','ticketFile','ticketHeader','saveResponse','responseMaxBytes','responseTimeoutMs',
      'requestTimeoutMs','requestFile','headers','paymentFlow','responseStream'], 'COMMERCE_SETUP_SELECTION_INVALID');
    const key = String(index + 1).padStart(2, '0');
    const requestInput = await prepareCommerceRequest({selected,compiled,merchant,operations,directory,key,upstream});
    const {route,terms,op,body,ticket,context}=requestInput;
    need(!intents.has(op.intentId), 'COMMERCE_SETUP_DUPLICATE_INTENT');
    atomic(terms.amount, 'COMMERCE_SETUP_AMOUNT_EXCEEDS_ORIGINAL_LEDGER');
    requestBytes+=body?.length ?? 0;
    need(requestBytes<=COMMERCE_REQUEST_TOTAL_BYTES,'COMMERCE_SETUP_TOTAL_REQUEST_BYTES_EXCEEDED');
    if (jsonrpc) validateJsonrpcCommerceRequest(jsonrpc,route.id,context);
    const saveResponse = selected.saveResponse ?? route.method !== 'HEAD';
    need(typeof saveResponse === 'boolean' && !(route.method === 'HEAD' && saveResponse),
      'COMMERCE_SETUP_HEAD_HAS_NO_RESPONSE_BODY');
    need(saveResponse || selected.responseMaxBytes === undefined && selected.responseTimeoutMs === undefined &&
      selected.responseStream === undefined,
      'COMMERCE_SETUP_RESPONSE_LIMIT_WITHOUT_DESTINATION');
    intents.add(op.intentId);
    const draft = {operation:op, captureBody:false,
      ...(requestInput.preparedFrom ? {preparedFrom:requestInput.preparedFrom} : {}),
      ...(selected.requestTimeoutMs === undefined ? {} : {requestTimeoutMs:selected.requestTimeoutMs}),
      ...(saveResponse ? {
      responseFile:{destination:join(directory, 'responses', key + '.bin'),
        ...(selected.responseMaxBytes === undefined ? {} : {maxBytes:selected.responseMaxBytes}),
        ...(selected.responseTimeoutMs === undefined ? {} : {timeoutMs:selected.responseTimeoutMs}),
        ...(selected.responseStream === undefined ? {} : {stream:selected.responseStream})},
    } : {})};
    const capture = responseFile(draft);
    if (capture) draft.responseFile = capture;
    requestTimeoutMs(draft);
    selections.push({key, routeId:route.id, acceptIndex:selected.acceptIndex,
      originalOffer:structuredClone(route.offer), draft, body, ticket,
      packet:requestInput.packet, input:requestInput.input,
      bodySha256:body === null ? null : sha(body), bodyBytes:body?.length ?? 0});
  }
  const first = selections[0].draft.operation.expect;
  need(selections.every(({draft}) => ['network','asset','payTo','paymentFlow'].every(key =>
    draft.operation.expect[key] === first[key])), 'COMMERCE_SETUP_ONE_WORKSPACE_ASSET_RECIPIENT_REQUIRED');
  const maximum = selections.reduce((best, item) =>
    BigInt(item.draft.operation.expect.maxAtomic) > BigInt(best.draft.operation.expect.maxAtomic) ? item : best);
  const single = BigInt(maximum.draft.operation.expect.maxAtomic);
  need(single <= daily, 'COMMERCE_SETUP_PURCHASE_EXCEEDS_DAILY_BUDGET');
  validateNativeSignerConfiguration({network:first.network, asset:first.asset, payTo:first.payTo,
    expectedPayer:operator.payer, maxAtomic:String(single), rpcUrl:facilitator.rpcUrl, paymentFlow:first.paymentFlow});
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
      originalTerms:item.originalOffer.accepts[item.acceptIndex], paymentFlow:item.draft.operation.expect.paymentFlow,
      bodyBytes:item.bodyBytes,
      bodySha256:item.bodySha256, bodyPresent:item.body!==null,
      requestInput:{bodyType:item.input.bodyType,contentType:item.input.contentType,fileCount:item.input.files.length,
        source:item.input.source ?? null},
      operationTicket:upstreamPurchaseTicketView(item.ticket),
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
export async function prepareCommerceSetup({configFile, directory}, {environment = process.env, resume = false} = {}) {
  const reviewed = await reviewCommerceSetup({configFile, directory});
  await privateDirectory(dirname(directory));
  const {initializeCommerce, bindMerchantPurchase} = await import('./commerce.mjs');
  const {summary, merchant, facilitator, operator, selections, maximum, handlers, python, upstream, jsonrpc} = reviewed;
  const compiled = compileMerchant(merchant, upstream);
  // Reuse the session's own offer selection rules before creating any workspace.
  for (const item of selections) need(bindMerchantPurchase(compiled, item.draft).acceptIndex === item.acceptIndex,
    'COMMERCE_SETUP_PAYMENT_OPTION_NOT_UNIQUE');
  const lease = await acquireInitialization(directory, { python: operator.python, resume });
  try {
    const checkpoint = { schema: 'stellar-forge.commerce-setup-initialization.v1',
      source: reviewed.source, summary, directory, handlers };
    const completed = await optionalInitializationBytes(join(directory, 'prepared.json'), 1048576);
    if (completed) {
      const record = parseJson(completed);
      const { operatorKeySource, ...originalSummary } = record.summary ?? {};
      need(record.summary?.state === 'PREPARED' && same(record.source, reviewed.source) &&
        same({...originalSummary, state: summary.state}, JSON.parse(json(summary))),
      'COMMERCE_SETUP_RESUME_SOURCE_CHANGED');
      return await inspectCommerceSetup(directory);
    }
    const priorCheckpoint = await optionalInitializationBytes(join(directory, 'initializing.json'));
    if (lease.created || priorCheckpoint)
      await retainInitializationRecord(join(directory, 'initializing.json'), checkpoint, { resume });
    for (const name of ['bodies','responses','buyers','tickets','requests']) await initializationDirectory(join(directory, name), { create: true });
    const captured = [];
    const retain = async (path, value) => {
      const bytes = Buffer.isBuffer(value) ? value : json(value);
      await retainInitializationFile(path, bytes, { resume });
      captured.push({path, bytes:bytes.length, sha256:sha(bytes)});
    };
    const staged = [];
    for (const item of selections) {
      if (item.packet) staged.push([item.packet.path, item.packet.bytes]);
      if (item.body !== null) staged.push([item.draft.operation.bodyFile, item.body]);
      if (item.ticket) staged.push([item.draft.operation.ticketFile, item.ticket.sourceBytes]);
      staged.push([join(directory, 'buyers', item.key + '-review.json'), item.draft]);
    }
    staged.push([join(directory, 'seller.json'), merchant]);
    if (python) staged.push([join(directory, 'python.json'), python.declaration]);
    if (upstream) staged.push([join(directory, 'upstreams.json'), upstream.sourceBytes]);
    if (jsonrpc) staged.push([join(directory, 'jsonrpc.json'), jsonrpc.sourceBytes]);
    staged.push([join(directory, 'facilitator.json'), facilitator]);
    const workspace = join(directory, 'operator');
    const operatorPresent = await lstat(workspace).then(() => true).catch(error => {
      if (error.code === 'ENOENT') return false; throw error;
    });
    if (resume) for (const [path, value] of staged) {
      const present = await verifyInitializationFile(path, Buffer.isBuffer(value) ? value : json(value));
      need(!operatorPresent || present, 'COMMERCE_SETUP_RESTORE_ORIGINAL_INPUTS');
    }
    for (const [path, value] of staged) await retain(path, value);
    const args = ['--config', join(directory, 'buyers', maximum.key + '-review.json'), '--dir', workspace,
      '--actor', operator.actor, '--service', operator.service, '--python', operator.python,
      '--payer', operator.payer, '--total-atomic', operator.totalAtomic, '--daily-atomic', operator.dailyAtomic,
      '--rpc', facilitator.rpcUrl, ...(operator.httpsProxyEnv === undefined ? [] :
        ['--https-proxy-env', operator.httpsProxyEnv]), ...(operator.secretEnv !== undefined ?
        ['--secret-env', operator.secretEnv] : ['--signer-provider', operator.signerProvider])];
    const initialized = await initializeWorkspace(args, {environment, resume});
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
    const initializedSession = await initializeCommerce({planFile, directory:session}, {resume});
    need(!python || initializedSession.python?.applicationSha256 === python.applicationSha256,
      'COMMERCE_SETUP_PYTHON_SOURCE_CHANGED');
    need(!upstream || initializedSession.upstreams?.sha256 === upstream.sha256,
      'COMMERCE_UPSTREAM_CONFIG_CHANGED');
    need(!jsonrpc || initializedSession.jsonrpc?.sha256 === jsonrpc.sha256,
      'COMMERCE_JSONRPC_PLAN_CHANGED');
    if (!lease.created && !priorCheckpoint)
      await retainInitializationRecord(join(directory, 'initializing.json'), checkpoint, { resume });
    await retain(join(directory, 'prepared.json'), {
      schema:SNAPSHOT, createdAt:new Date().toISOString(), directory, session, workspace,
      planFile, source:reviewed.source, files:captured, handlers,
      summary:{...summary, state:'PREPARED', operatorKeySource:initialized.operatorKeySource},
    });
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    return await inspectCommerceSetup(directory);
  } catch (error) {
    if (lease.created && !resume) {
      const current = await lstat(directory).catch(() => null);
      if (current?.dev === lease.identity.dev && current?.ino === lease.identity.ino)
        await rm(directory, {recursive:true, force:true}).catch(() => {});
    }
    throw error;
  } finally { await lease.close(); }
}

/** Reopen original retained setup and inbox without opening wallet or operator keys. */
export async function inspectCommerceSetup(directory) {
  await privateDirectory(directory);
  const record = parseJson(await readPrivateFile(join(directory, 'prepared.json'), 1048576));
  need(record.schema === SNAPSHOT && record.directory === directory &&
    record.session === join(directory, 'session') && record.workspace === join(directory, 'operator') &&
    record.planFile === join(directory, 'commerce-plan.json') && Array.isArray(record.files) &&
    record.files.length <= 64 * 5 + 16, 'COMMERCE_SETUP_SNAPSHOT_INVALID');
  for (const item of record.files) {
    need(typeof item.path === 'string' && item.path.startsWith(directory + '/') &&
      resolve(item.path) === item.path && item.path !== join(directory, 'prepared.json'),
    'COMMERCE_SETUP_SNAPSHOT_PATH_INVALID');
    const maximum = dirname(item.path) === join(directory, 'requests') ? OPERATION_HANDOFF_MAX_BYTES :
      dirname(item.path) === join(directory, 'bodies') ? MAX_REQUEST_BODY_BYTES : 1048576;
    need(Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= maximum &&
      /^[a-f0-9]{64}$/.test(item.sha256), 'COMMERCE_SETUP_SNAPSHOT_FILE_INVALID');
    const bytes = await readPrivateFile(item.path, maximum);
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
    process.stdout.write('Usage: commerce-setup.mjs review|prepare|resume --config /private/setup.json --directory /private/commerce\n' +
      '       commerce-setup.mjs inspect --directory /private/prepared-commerce\n' +
      'Preparation creates one original testnet operator workspace and commerce session. Use commerce-cli.mjs for the actual native purchase.\n' +
      'Resume completes the same interrupted preparation, preserving its original keys, ledger, source bytes and queue intents. See RESUMABLE_SETUP.md.\n' +
      'For a retained Stellar JSON-RPC product, set seller.jsonrpc and follow JSONRPC_COMMERCE.md.\n');
    return;
  }
  const [command, ...rest] = args, opt = options(rest);
  const input = {configFile:opt['--config'], directory:opt['--directory']};
  let result;
  if (command === 'review') result = (await reviewCommerceSetup(input)).summary;
  else if (command === 'prepare') result = await prepareCommerceSetup(input);
  else if (command === 'resume') result = await prepareCommerceSetup(input, {resume:true});
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

