// MIT. Retained RPC authoring joins the original native commerce preparation and session.
import { access, lstat, mkdir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import { prepareProduct, plain } from '../config.mjs';
import { admitRequest } from '../stellar.mjs';
import { buildUnpaidRequest } from '../../developer/request.mjs';
import { absolute, readPrivateFile, parseJson } from '../../../sf103-native-buyer-signer/operator.mjs';
import { WorkspaceError, sha256, json, operationId } from './store.mjs';

const PROFILE = 'stellar-forge.rpc-commerce-profile.v1';
const HANDOFF = 'stellar-forge.rpc-commerce-handoff.v1';
const LIMIT = 1048576;
const originalSetup = () => import('../../../sf66-demo-launcher/commerce-setup.mjs');
const need = (ok, code, message, status = 409) => {
  if (!ok) throw new WorkspaceError(code, status, message ?? code);
};
function fields(value, allowed, code) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)), code, undefined, 422);
  return value;
}
function integer(value, fallback, min, max, code) {
  const number = value ?? fallback;
  need(Number.isSafeInteger(number) && number >= min && number <= max, code, undefined, 422);
  return number;
}
async function directory(path) {
  absolute(path);
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || info.uid === process.getuid() && !(info.mode & 0o077)),
  'RPC_COMMERCE_PRIVATE_DIRECTORY_REQUIRED');
}
async function put(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function digest(path) { return sha256(await readPrivateFile(path, LIMIT)); }
const headers = value => Object.fromEntries(Object.entries(value ?? {}).map(([key, item]) => [key.toLowerCase(), item]));
const publicBuyer = buyer => ({ buyerActionId: buyer.buyerActionId, intentId: buyer.intentId,
  method: buyer.method, url: buyer.url, httpMethod: buyer.httpMethod, acceptIndex: buyer.acceptIndex,
  terms: buyer.terms, bodySha256: buyer.bodySha256, bodyBytes: buyer.bodyBytes,
  buyerReviewSha256: buyer.buyerReviewSha256, buyerHeaders: headers(buyer.operation.headers),
  commerceHeaders: buyer.commerceHeaders });

/** Profile values are selected by the launching host and never accepted in browser actions. */
export async function readCommerceProfile(file, { navigationOrigin = null } = {}) {
  if (file === null || file === undefined) return null;
  absolute(file);
  const bytes = await readPrivateFile(file, 131072), input = fields(parseJson(bytes),
    ['schema', 'prepare', 'existing', 'consolePort', 'finalityNode'], 'RPC_COMMERCE_PROFILE_INVALID');
  need(input.schema === PROFILE, 'RPC_COMMERCE_PROFILE_SCHEMA_REQUIRED', undefined, 422);
  const consolePort = integer(input.consolePort, 0, 0, 65535, 'RPC_COMMERCE_CONSOLE_PORT_INVALID');
  const finalityNode = input.finalityNode ?? process.execPath;
  absolute(finalityNode); await access(finalityNode, constants.X_OK);
  let prepare = null;
  if (input.prepare !== undefined) {
    const value = fields(input.prepare, ['operator', 'facilitatorConfig', 'sellerPort', 'operationsPort',
      'requestTimeoutMs', 'responseMaxBytes', 'responseTimeoutMs'], 'RPC_COMMERCE_PREPARE_PROFILE_INVALID');
    absolute(value.facilitatorConfig);
    fields(value.operator, ['actor', 'service', 'python', 'payer', 'secretEnv', 'signerProvider',
      'httpsProxyEnv', 'totalAtomic', 'dailyAtomic'], 'RPC_COMMERCE_OPERATOR_PROFILE_INVALID');
    prepare = { ...structuredClone(value),
      sellerPort: integer(value.sellerPort, 0, 0, 65535, 'RPC_COMMERCE_SELLER_PORT_INVALID'),
      operationsPort: integer(value.operationsPort, 0, 0, 65535, 'RPC_COMMERCE_OPERATIONS_PORT_INVALID'),
      requestTimeoutMs: integer(value.requestTimeoutMs, 120000, 1, 300000, 'RPC_COMMERCE_REQUEST_TIMEOUT_INVALID'),
      responseMaxBytes: integer(value.responseMaxBytes, 8388608, 1, 1073741824, 'RPC_COMMERCE_RESPONSE_LIMIT_INVALID'),
      responseTimeoutMs: integer(value.responseTimeoutMs, 30000, 1, 300000, 'RPC_COMMERCE_RESPONSE_TIMEOUT_INVALID') };
  }
  const existing = input.existing ?? [];
  need(Array.isArray(existing) && existing.length <= 64, 'RPC_COMMERCE_EXISTING_PROFILE_INVALID', undefined, 422);
  const ids = new Set(), paths = new Set();
  for (const item of existing) {
    fields(item, ['id', 'label', 'directory'], 'RPC_COMMERCE_EXISTING_PROFILE_INVALID');
    operationId(item.id); absolute(item.directory);
    need(typeof item.label === 'string' && item.label.trim() && item.label.length <= 120 &&
      !/[\u0000-\u001f]/.test(item.label) && !ids.has(item.id) && !paths.has(item.directory),
    'RPC_COMMERCE_EXISTING_PROFILE_INVALID', undefined, 422);
    ids.add(item.id); paths.add(item.directory);
  }
  need(prepare || existing.length, 'RPC_COMMERCE_PROFILE_EMPTY', undefined, 422);
  const ports = [consolePort, prepare?.sellerPort, prepare?.operationsPort,
    navigationOrigin ? Number(new URL(navigationOrigin).port) : 0].filter(Boolean);
  need(new Set(ports).size === ports.length, 'RPC_COMMERCE_LISTENER_PORT_COLLISION', undefined, 422);
  return Object.freeze({ file, sha256: sha256(bytes), prepare, existing: structuredClone(existing), consolePort, finalityNode });
}
export function commerceProfileView(profile) {
  return profile ? { enabled: true, canPrepare: Boolean(profile.prepare), sha256: profile.sha256,
    ...(profile.prepare ? { operator: { actor: profile.prepare.operator.actor, service: profile.prepare.operator.service,
      payer: profile.prepare.operator.payer, totalAtomic: profile.prepare.operator.totalAtomic,
      dailyAtomic: profile.prepare.operator.dailyAtomic }, requestTimeoutMs: profile.prepare.requestTimeoutMs,
      responseMaxBytes: profile.prepare.responseMaxBytes, responseTimeoutMs: profile.prepare.responseTimeoutMs } : {}),
    existing: profile.existing.map(({ id, label }) => ({ id, label })) } : { enabled: false, canPrepare: false, existing: [] };
}

/** Re-read exact original buyer files, then bind them to the selected saved merchant package. */
export async function bindCommerceBuyers({ root, saved, review, record, folder, actions }) {
  need(Array.isArray(actions) && actions.length >= 1 && actions.length <= 64,
    'RPC_COMMERCE_BUYERS_REQUIRED', 'Select one to 64 completed buyer reviews from this package.', 422);
  const product = prepareProduct(saved.plan), seen = new Set(), bindings = [];
  for (const action of actions) {
    need(action?.kind === 'buyer' && action.state === 'COMPLETE' && action.revision === saved.revision &&
      action.request.reviewId === review.reviewId && action.request.packageId === record.id,
    'RPC_COMMERCE_BUYER_REVIEW_MISMATCH');
    const files = action.result.files, bodyFile = join(root, 'actions', action.id, 'request.json'),
      reviewFile = join(root, 'actions', action.id, 'buyer-review.json');
    const bytes = await readPrivateFile(bodyFile, 131072), reviewBytes = await readPrivateFile(reviewFile, LIMIT);
    for (const [name, content] of [['request.json', bytes], ['buyer-review.json', reviewBytes]]) {
      const expected = files?.find(item => item.name === name);
      need(expected && expected.bytes === content.length && expected.sha256 === sha256(content),
        'RPC_COMMERCE_BUYER_SOURCE_CHANGED');
    }
    need(bytes.equals(Buffer.from(action.request.bodyText)), 'RPC_COMMERCE_BUYER_SOURCE_CHANGED');
    const configured = parseJson(reviewBytes), op = configured.operation, method = action.request.method;
    const index = product.plan.operations.findIndex(item => item.method === method), offer = product.imported.offers[index]?.seller;
    need(offer && op && op.intentId === action.request.intentId && op.method === 'POST' &&
      op.url === offer.resource.url && op.bodyFile === bodyFile && !seen.has(op.intentId),
    'RPC_COMMERCE_BUYER_SELECTION_CHANGED');
    const terms = offer.accepts[0];
    need(offer.accepts.length === 1 && ['scheme', 'network', 'asset', 'payTo'].every(key => op.expect?.[key] === terms[key]) &&
      op.expect.maxAtomic === terms.amount && op.expect.maxTimeoutSeconds === terms.maxTimeoutSeconds &&
      (op.expect.paymentFlow ?? 'authorization') === (terms.extra?.paymentFlow ?? 'authorization'),
    'RPC_COMMERCE_BUYER_TERMS_CHANGED');
    need(admitRequest(method, { method: 'POST', body: parseJson(bytes), url: new URL(op.url), query: {} },
      product.plan.limits) === true, 'RPC_COMMERCE_BUYER_PARAMETERS_CHANGED');
    const request = buildUnpaidRequest(product.spec.paths[product.imported.offers[index].path].post,
      { body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }, product.plan.publicOrigin);
    const commerceHeaders = headers(request.init.headers), buyerHeaders = headers(op.headers);
    need(buyerHeaders['content-type'] === commerceHeaders['content-type'] &&
      Object.entries(buyerHeaders).every(([key, value]) => commerceHeaders[key] === value),
    'RPC_COMMERCE_BUYER_HEADERS_CHANGED');
    seen.add(op.intentId);
    bindings.push({ buyerActionId: action.id, intentId: op.intentId, method, httpMethod: op.method, url: op.url,
      acceptIndex: 0, terms, bodyFile, bodySha256: sha256(bytes), bodyBytes: bytes.length,
      buyerReviewSha256: sha256(reviewBytes), operation: op, commerceHeaders });
  }
  bindings.sort((a, b) => a.intentId.localeCompare(b.intentId));
  const planFile = join(folder, 'plan.json'), planBytes = await readPrivateFile(planFile, 131072);
  need(same(prepareProduct(parseJson(planBytes)).plan, product.plan), 'RPC_COMMERCE_PACKAGE_PLAN_CHANGED');
  return { planFile, buyers: bindings, source: { revision: saved.revision, reviewId: review.reviewId,
    planSha256: saved.planSha256, sourceSha256: saved.sourceSha256, packageId: record.id,
    packagePlanSha256: sha256(planBytes), packageFilesSha256: sha256(json(record.summary.files)) } };
}

async function inspectOriginal(directoryPath, bound, allowLoopbackUpstream) {
  const { inspectCommerceSetup } = await originalSetup();
  const original = await inspectCommerceSetup(directoryPath), bytes = await readPrivateFile(join(directoryPath, 'jsonrpc.json'), 131072);
  const expectedPlan = prepareProduct(parseJson(await readPrivateFile(bound.planFile, 131072))).plan;
  need(same(prepareProduct(parseJson(bytes)).plan, expectedPlan), 'RPC_COMMERCE_PREPARED_PLAN_MISMATCH');
  need(!original.jsonrpc?.allowLoopback || allowLoopbackUpstream, 'RPC_COMMERCE_LOOPBACK_OPT_IN_REQUIRED');
  need(original.selections.length === bound.buyers.length && original.session.buyers.length === bound.buyers.length,
    'RPC_COMMERCE_COMPLETE_BUYER_SET_REQUIRED');
  for (const buyer of bound.buyers) {
    const selected = original.selections.find(item => item.intentId === buyer.intentId),
      job = original.session.buyers.find(item => item.operation.intentId === buyer.intentId);
    need(selected && job && selected.routeId === buyer.method && selected.method === buyer.httpMethod &&
      selected.url === buyer.url && selected.acceptIndex === buyer.acceptIndex && same(selected.originalTerms, buyer.terms) &&
      selected.bodySha256 === buyer.bodySha256 && selected.bodyBytes === buyer.bodyBytes &&
      job.bodySha256 === buyer.bodySha256 && job.bodyBytes === buyer.bodyBytes &&
      job.operation.url === buyer.url && job.operation.method === buyer.httpMethod &&
      same(job.operation.expect, buyer.operation.expect) && same(headers(job.operation.headers), buyer.commerceHeaders),
    'RPC_COMMERCE_PREPARED_BUYER_MISMATCH');
  }
  return { original, preparedSha256: await digest(join(directoryPath, 'prepared.json')),
    sessionSha256: await digest(join(directoryPath, 'session', 'session.json')), planSha256: sha256(bytes) };
}
function projection(checked) {
  const { original } = checked;
  return { state: original.state, directory: original.directory, session: original.session.directory,
    workspace: original.workspace, publicOrigin: original.publicOrigin, network: original.network,
    jsonrpc: original.jsonrpc, payer: original.payer, asset: original.asset, recipient: original.recipient,
    sharedBudget: original.sharedBudget, selections: original.selections,
    buyers: original.session.buyers.map(job => ({ intentId: job.operation.intentId, state: job.state,
      outcome: job.outcome ?? null, attemptId: job.attempt?.id ?? null, attemptStartedAt: job.attempt?.startedAt ?? null })),
    preparedSha256: checked.preparedSha256, sessionSha256: checked.sessionSha256,
    originalPlanSha256: checked.planSha256 };
}

/** Offline review writes only a private handoff beside the original authoring action. */
export async function reviewRpcCommerce({ root, workspaceId, id, profile, bound, existingId = null, allowLoopbackUpstream }) {
  const { reviewCommerceSetup } = await originalSetup();
  need(profile, 'RPC_COMMERCE_PROFILE_REQUIRED', 'Reopen with the merchant’s private --commerce-profile.', 409);
  operationId(id);
  need(await digest(profile.file) === profile.sha256, 'RPC_COMMERCE_PROFILE_CHANGED', 'Reopen the launcher after changing its private profile.');
  const path = join(root, 'commerce', id);
  await mkdir(path, { mode: 0o700 }); await directory(path);
  const binding = { schema: HANDOFF, workspaceId, id, kind: existingId === null ? 'prepare' : 'attach',
    profileSha256: profile.sha256, source: bound.source, buyers: bound.buyers.map(publicBuyer) };
  let setupFile, setupSource, preparedDirectory, original, existingPins;
  if (existingId === null) {
    need(profile.prepare, 'RPC_COMMERCE_PREPARATION_NOT_CONFIGURED');
    preparedDirectory = join(path, 'prepared'); setupFile = join(path, 'setup.json');
    const selected = profile.prepare;
    await put(setupFile, json({ schema: 'stellar-forge.commerce-setup.v1',
      seller: { jsonrpc: bound.planFile, facilitatorConfig: selected.facilitatorConfig, port: selected.sellerPort,
        availabilityDirectory: join(path, 'availability'), ...(allowLoopbackUpstream ? { allowLoopbackUpstream: true } : {}) },
      operator: selected.operator, operationsPort: selected.operationsPort,
      purchases: bound.buyers.map(buyer => ({ routeId: buyer.method, acceptIndex: buyer.acceptIndex,
        intentId: buyer.intentId, method: buyer.httpMethod, bodyFile: buyer.bodyFile, saveResponse: true,
        requestTimeoutMs: selected.requestTimeoutMs, responseMaxBytes: selected.responseMaxBytes,
        responseTimeoutMs: selected.responseTimeoutMs })) }));
    const reviewed = await reviewCommerceSetup({ configFile: setupFile, directory: preparedDirectory });
    setupSource = reviewed.source; original = reviewed.summary;
  } else {
    const entry = profile.existing.find(item => item.id === existingId);
    need(entry, 'RPC_COMMERCE_EXISTING_SELECTION_INVALID');
    preparedDirectory = entry.directory;
    const checked = await inspectOriginal(preparedDirectory, bound, allowLoopbackUpstream);
    original = projection(checked);
    existingPins = { preparedSha256: checked.preparedSha256, sessionSha256: checked.sessionSha256,
      planSha256: checked.planSha256 };
    binding.existingId = existingId;
  }
  const retained = { binding, preparedDirectory, setupFile: setupFile ?? null,
    setupSource: setupSource ?? null, existingPins: existingPins ?? null, original };
  const manifest = Buffer.from(json(retained)); await put(join(path, 'handoff.json'), manifest);
  return { preparationId: id, kind: binding.kind, reviewSha256: sha256(manifest), binding, original };
}

export async function readRpcCommerceReview({ root, workspaceId, reviewAction, expectedReviewSha256, bound,
  profile, allowLoopbackUpstream }) {
  const { reviewCommerceSetup } = await originalSetup();
  need(reviewAction?.kind === 'commerce-review' && reviewAction.state === 'COMPLETE', 'RPC_COMMERCE_REVIEW_NOT_READY');
  const id = reviewAction.id, bytes = await readPrivateFile(join(root, 'commerce', id, 'handoff.json'), LIMIT),
    hash = sha256(bytes), retained = parseJson(bytes), binding = retained.binding;
  need(hash === reviewAction.result.reviewSha256 && hash === expectedReviewSha256 && binding.schema === HANDOFF &&
    binding.workspaceId === workspaceId && binding.id === id && same(binding, reviewAction.result.binding) &&
    same(binding.source, bound.source) && same(binding.buyers, bound.buyers.map(publicBuyer)),
  'RPC_COMMERCE_REVIEW_CHANGED', 'Reopen the exact saved commerce review before continuing.');
  const expectedPath = join(root, 'commerce', id);
  if (binding.kind === 'prepare') {
    need(profile?.prepare && retained.preparedDirectory === join(expectedPath, 'prepared') &&
      retained.setupFile === join(expectedPath, 'setup.json'), 'RPC_COMMERCE_PREPARATION_NOT_CONFIGURED');
    const fresh = await reviewCommerceSetup({ configFile: retained.setupFile, directory: retained.preparedDirectory });
    need(same(fresh.source, retained.setupSource) && same(fresh.summary, retained.original),
      'RPC_COMMERCE_SETUP_SOURCE_CHANGED', 'The reviewed facilitator, merchant or request changed. Review the original source again.');
  } else {
    need(binding.kind === 'attach' && profile?.existing.some(item => item.id === binding.existingId &&
      item.directory === retained.preparedDirectory), 'RPC_COMMERCE_EXISTING_SELECTION_INVALID');
    const current = await inspectOriginal(retained.preparedDirectory, bound, allowLoopbackUpstream);
    need(same(retained.existingPins, { preparedSha256: current.preparedSha256,
      sessionSha256: current.sessionSha256, planSha256: current.planSha256 }), 'RPC_COMMERCE_PREPARED_SOURCE_CHANGED');
  }
  return { ...retained, reviewSha256: hash };
}

/** Resume the original initialization, then match its complete reviewed authority. */
export async function prepareRpcCommerce({ retained, bound, allowLoopbackUpstream, environment }) {
  if (retained.binding.kind === 'prepare') {
    const { prepareCommerceSetup } = await originalSetup();
    await prepareCommerceSetup({ configFile: retained.setupFile, directory: retained.preparedDirectory },
      { environment, resume: true });
  } else {
    need(await lstat(retained.preparedDirectory).then(info => info.isDirectory(), cause => {
      if (cause.code === 'ENOENT') return false; throw cause;
    }), 'RPC_COMMERCE_EXISTING_PREPARATION_MISSING');
  }
  const checked = await inspectOriginal(retained.preparedDirectory, bound, allowLoopbackUpstream);
  if (retained.binding.kind === 'prepare') {
    const prepared = parseJson(await readPrivateFile(join(retained.preparedDirectory, 'prepared.json'), LIMIT));
    const { operatorKeySource, ...summary } = prepared.summary;
    need(same(prepared.source, retained.setupSource) && same(summary, { ...retained.original, state: 'PREPARED' }),
      'RPC_COMMERCE_PREPARED_AUTHORITY_MISMATCH', 'The retained preparation differs from the reviewed operator, budget or source.');
  }
  return projection(checked);
}
export async function inspectRpcCommerce({ root, workspaceId, record, bound, profile, allowLoopbackUpstream }) {
  need(record?.state === 'READY' && record.result, 'RPC_COMMERCE_PREPARATION_NOT_READY');
  const manifest = await readPrivateFile(join(root, 'commerce', record.id, 'handoff.json'), LIMIT);
  need(sha256(manifest) === record.reviewSha256 && same(parseJson(manifest).binding, record.binding) &&
    record.binding.workspaceId === workspaceId && same(record.binding.source, bound.source) &&
    same(record.binding.buyers, bound.buyers.map(publicBuyer)), 'RPC_COMMERCE_BINDING_CHANGED');
  if (record.binding.kind === 'attach') need(profile?.existing.some(item => item.id === record.binding.existingId &&
    item.directory === record.directory), 'RPC_COMMERCE_EXISTING_SELECTION_INVALID');
  const checked = await inspectOriginal(record.directory, bound, allowLoopbackUpstream);
  need(checked.preparedSha256 === record.result.preparedSha256 && checked.sessionSha256 === record.result.sessionSha256 &&
    checked.planSha256 === record.result.originalPlanSha256, 'RPC_COMMERCE_PREPARED_SOURCE_CHANGED');
  return projection(checked);
}

/** The original console owns purchase actions; this join owns its listener and original drain. */
export async function openRpcCommerce({ directory: preparedDirectory, profile, environment, onState }) {
  need(profile, 'RPC_COMMERCE_PROFILE_REQUIRED');
  const [{ openCommerce, completeCommerceShutdown }, { startCommerceConsole }] = await Promise.all([
    import('../../../sf66-demo-launcher/commerce.mjs'), import('../../../sf66-demo-launcher/commerce-console.mjs') ]);
  const original = await openCommerce(join(preparedDirectory, 'session'), { environment: { ...environment },
    finalityNode: profile.finalityNode });
  let console, closing, state = 'RUNNING';
  const change = (value, extra = {}) => { state = value; onState?.(value, extra); };
  const closeOriginal = () => closing ??= (async () => {
    change('STOPPING');
    try { const result = await completeCommerceShutdown(original, original.close()); change('STOPPED'); return result; }
    catch (cause) { change('FAILED', { error: /^[A-Z0-9_]+$/.test(cause?.code ?? '') ? cause.code : 'RPC_COMMERCE_CLOSE_FAILED' }); throw cause; }
  })();
  try { console = await startCommerceConsole({ ...original, close: closeOriginal }, { port: profile.consolePort }); }
  catch (cause) { await closeOriginal().catch(() => {}); throw cause; }
  return { session: original, console, get state() { return state; },
    snapshot() { return { state, console: console.operatorUrl, seller: original.seller.url,
      docs: original.seller.url + '/_seller/docs', operations: original.operations.url,
      availability: original.operations.availabilityControlUrl, snapshot: original.seller.upstreamSnapshot?.() }; },
    close: () => console.close() };
}
