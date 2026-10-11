// MIT. Receive original Linkup purchases in the existing SF88 research dossier.
import { join } from 'node:path';
import { Buyer } from '../index.mjs';
import { readBytes, readJson, parseJson, digest, need, object } from '../store.mjs';
import { parseLinkupPayload } from './linkup-search.mjs';

const PURCHASE = 'sf88-linkup-saved-purchase-v1';
const RESEARCH = 'sf88-research-results-v1';
const TERMS = 'Original saved Linkup response and citation records, attached by its purchasing customer.';
const RESPONSE_LIMIT = 1048576;
const REQUEST_LIMIT = 65536;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const routes = { search: '/research/linkup/search', answer: '/research/linkup/answer' };
const copy = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const utf8 = value => Buffer.from(JSON.stringify(value) + '\n', 'utf8');

function selection(config) {
  const request = config.operation;
  need(object(request) && request.method === 'POST' && typeof request.url === 'string',
    'LINKUP_ORIGINAL_ROUTE_REQUIRED');
  const url = new URL(request.url);
  const view = Object.keys(routes).find(key => routes[key] === url.pathname);
  need(view && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
    !url.search && !url.hash && request.expect?.paymentFlow === 'authorization',
  'LINKUP_ORIGINAL_ROUTE_MISMATCH');
  return { method: 'POST', url: request.url, view,
    outputType: view === 'search' ? 'searchResults' : 'sourcedAnswer', paymentFlow: 'authorization' };
}
function encoded(bytes) {
  bytes = Buffer.from(bytes);
  return { sha256: digest(bytes), bytes: bytes.length, bodyBase64: bytes.toString('base64') };
}
function decoded(record, limit) {
  need(object(record) && hex(record.sha256) && Number.isSafeInteger(record.bytes) &&
    record.bytes >= 0 && record.bytes <= limit && typeof record.bodyBase64 === 'string' &&
    record.bodyBase64.length <= 4 * Math.ceil(limit / 3), 'LINKUP_ORIGINAL_BYTES_INVALID');
  const bytes = Buffer.from(record.bodyBase64, 'base64');
  need(bytes.length === record.bytes && digest(bytes) === record.sha256 &&
    bytes.toString('base64') === record.bodyBase64, 'LINKUP_ORIGINAL_BYTES_CHANGED');
  return bytes;
}
function binding(purchase) {
  return { schema: PURCHASE, workspaceId: purchase.workspaceId, intentId: purchase.intentId,
    configurationSha256: purchase.configurationSha256, requestSha256: purchase.request.sha256,
    requestBytes: purchase.request.bytes, responseSha256: purchase.response.sha256,
    responseBytes: purchase.response.bytes, ...purchase.selection, native: copy(purchase.native) };
}
function reference(purchase) {
  const value = binding(purchase);
  return {
    id: ['linkup-v1', value.view, value.configurationSha256, value.requestSha256,
      value.responseSha256, value.responseBytes].join(':'),
    workspaceId: value.workspaceId,
    operationId: value.intentId,
  };
}
function checkReference(value, workspaceId) {
  need(object(value) && Object.keys(value).length === 3 &&
    typeof value.id === 'string' && /^linkup-v1:(search|answer):[a-f0-9]{64}:[a-f0-9]{64}:[a-f0-9]{64}:[0-9]{1,7}$/.test(value.id) &&
    value.workspaceId === workspaceId && typeof value.operationId === 'string' &&
    value.operationId.length > 0 && value.operationId.length <= 512, 'LINKUP_EDITION_REFERENCE_INVALID');
}
function query(body) {
  need(object(body) && typeof body.query === 'string' && body.query.trim().length > 0 &&
    Buffer.byteLength(body.query, 'utf8') <= 8000, 'LINKUP_ORIGINAL_QUERY_INVALID');
  return body.query;
}

function projection(purchase) {
  const request = parseJson(decoded(purchase.request, REQUEST_LIMIT));
  const response = parseLinkupPayload(parseJson(decoded(purchase.response, RESPONSE_LIMIT)),
    { view: purchase.selection.view });
  const bound = binding(purchase);
  const rows = response.view === 'search' ? response.payload.results : response.payload.sources;
  const sources = rows.map((row, index) => ({
    key: 'source-' + String(index + 1).padStart(6, '0'),
    id: 'linkup-source:' + bound.responseSha256 + ':' + (index + 1),
    title: row.name, url: row.url, content: response.view === 'search' ? row.content : row.snippet,
    citation: { kind: 'LINKUP_RETURNED_SOURCE', position: index + 1, outputType: response.outputType },
    metadata: { kind: 'provider_source', position: index + 1, originalPurchase: bound },
    providerRecord: copy(row),
  }));
  const items = [];
  if (response.view === 'answer') items.push({
    key: 'provider-answer', id: 'linkup-answer:' + bound.requestSha256 + ':' + bound.responseSha256,
    title: 'Linkup provider answer — original generated text', url: '', content: response.payload.answer,
    citation: { kind: 'LINKUP_GENERATED_ANSWER', outputType: response.outputType },
    references: rows.map((row, index) => ({ position: index + 1, ...copy(row) })),
    metadata: { kind: 'provider_answer', originalPurchase: bound,
      citationPolicy: 'Original inline citation text and returned source order are unchanged.' },
    providerRecord: { answer: response.payload.answer },
  });
  items.push(...sources);
  return {
    query: query(request), items,
    usage: { sourceCount: rows.length, providerAnswer: response.view === 'answer',
      originalPurchase: bound, request: copy(request) },
    warnings: response.view === 'answer' ?
      ['The provider answer is generated text. Its inline citation numbers retain the provider’s original ordering.'] : [],
    payload: response.payload,
  };
}

/** Reads only a completed original Buyer operation; it never executes a purchase. */
async function capture(buyer, workspaceId, intentId, signal) {
  need(typeof intentId === 'string' && intentId.length > 0 && intentId.length <= 512,
    'LINKUP_ORIGINAL_INTENT_REQUIRED');
  need(!signal?.aborted, 'LINKUP_RECEIVING_ABORTED');
  const operation = buyer.operation(intentId);
  const result = await operation.recover();
  need(result && result.native.httpStatus === 200 && result.delivery.status === 'SAVED',
    'LINKUP_RESPONSE_NOT_SAVED');
  const configBytes = await readBytes(operation.configPath, REQUEST_LIMIT);
  const meta = await readJson(join(operation.directory, 'operation.json'), REQUEST_LIMIT);
  need(meta.intentId === intentId && result.record.intentId === intentId &&
    hex(meta.configSha256) && meta.configSha256 === result.record.configSha256 &&
    digest(configBytes) === meta.configSha256, 'LINKUP_ORIGINAL_CONFIGURATION_CHANGED');
  const config = parseJson(configBytes), chosen = selection(config);
  need(config.operation.intentId === intentId &&
    config.operation.bodyFile === join(operation.directory, 'request.body'), 'LINKUP_ORIGINAL_REQUEST_PATH_CHANGED');
  const request = await readBytes(config.operation.bodyFile, REQUEST_LIMIT);
  need(hex(meta.bodySha256) && digest(request) === meta.bodySha256, 'LINKUP_ORIGINAL_REQUEST_CHANGED');
  const response = await result.bytes({ limit: RESPONSE_LIMIT, signal });
  need(response.length === result.delivery.bytes && digest(response) === result.delivery.sha256,
    'LINKUP_ORIGINAL_RESPONSE_CHANGED');
  parseLinkupPayload(parseJson(response), { view: chosen.view });
  query(parseJson(request));
  return {
    schema: PURCHASE, workspaceId, intentId, configurationSha256: meta.configSha256,
    selection: chosen, request: encoded(request), response: encoded(response),
    native: { status: result.status, httpStatus: result.native.httpStatus,
      sellerReportedSettlement: result.native.sellerReportedSettlement,
      responseStatus: result.delivery.status },
  };
}

/** Opaque references bind a customer's original workspace, request and exact output. */
export function createLinkupEditionProvider(buyer, { workspaceId } = {}) {
  need(buyer instanceof Buyer, 'ORIGINAL_LINKUP_BUYER_REQUIRED');
  need(typeof workspaceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(workspaceId),
    'LINKUP_WORKSPACE_ID_REQUIRED');
  async function describe(intentId, { signal } = {}) {
    const purchase = await capture(buyer, workspaceId, intentId, signal);
    const view = projection(purchase);
    return { reference: reference(purchase), binding: binding(purchase), query: view.query,
      sourceCount: view.usage.sourceCount, providerAnswer: view.usage.providerAnswer };
  }
  async function read(value) {
    checkReference(value, workspaceId);
    const purchase = await capture(buyer, workspaceId, value.operationId);
    need(same(reference(purchase), value), 'LINKUP_ORIGINAL_PURCHASE_CHANGED');
    const view = projection(purchase);
    return { status: 'AVAILABLE', items: view.items.map(row => ({ ...row,
      original: row.providerRecord })), usage: view.usage, warnings: view.warnings,
      retention: 'ORIGINAL_SAVED_BUYER_RESULT' };
  }
  async function envelope(intentId, { signal } = {}) {
    const purchase = await capture(buyer, workspaceId, intentId, signal);
    const view = projection(purchase);
    return {
      schema: RESEARCH, provider: 'linkup', query: view.query, success: true, status: 'AVAILABLE',
      sourceTerms: TERMS, results: view.items, usage: view.usage, warnings: view.warnings,
      originalPurchase: purchase,
    };
  }
  return Object.freeze({ describe, read, envelope });
}

/** Verifies both inner byte records and every derived row in an exported envelope. */
export function verifyLinkupResearchEnvelope(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) value = parseJson(value);
  need(object(value) && value.schema === RESEARCH && value.provider === 'linkup' &&
    object(value.originalPurchase), 'LINKUP_RESEARCH_ENVELOPE_REQUIRED');
  const purchase = value.originalPurchase;
  need(purchase.schema === PURCHASE && typeof purchase.workspaceId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(purchase.workspaceId) &&
    typeof purchase.intentId === 'string' && purchase.intentId.length > 0 &&
    purchase.intentId.length <= 512 && hex(purchase.configurationSha256) &&
    object(purchase.selection) && object(purchase.native), 'LINKUP_ORIGINAL_BINDING_INVALID');
  const chosen = selection({ operation: { ...purchase.selection,
    expect: { paymentFlow: purchase.selection.paymentFlow } } });
  need(same(chosen, purchase.selection) && purchase.native.httpStatus === 200 &&
    purchase.native.responseStatus === 'SAVED' && typeof purchase.native.status === 'string',
    'LINKUP_ORIGINAL_BINDING_INVALID');
  const view = projection(purchase);
  need(value.success === true && value.status === 'AVAILABLE' && value.sourceTerms === TERMS &&
    value.query === view.query && same(value.results, view.items) && same(value.usage, view.usage) &&
    same(value.warnings, view.warnings), 'LINKUP_RESEARCH_PROJECTION_CHANGED');
  return { binding: binding(purchase), reference: reference(purchase), query: view.query,
    sourceCount: view.usage.sourceCount, providerAnswer: view.usage.providerAnswer };
}

/** Complete retained receiving uses the existing blob/history/report/portable engine. */
export async function receiveLinkupEdition(store, dossierId, {
  provider, intentId, questionId, label, expectedRevision, mode = 'retained', signal,
} = {}) {
  need(store && typeof store.get === 'function' && typeof store.receive === 'function' &&
    typeof store.receiveReference === 'function', 'ORIGINAL_DOSSIER_STORE_REQUIRED');
  need(provider && typeof provider.envelope === 'function' && typeof provider.describe === 'function',
    'ORIGINAL_LINKUP_EDITION_PROVIDER_REQUIRED');
  need(['retained', 'reference'].includes(mode), 'LINKUP_RECEIVING_MODE_INVALID');
  need(typeof label === 'string' && label.trim().length > 0 && label.length <= 240,
    'LINKUP_EDITION_LABEL_REQUIRED');
  const envelope = await provider.envelope(intentId, { signal });
  const receipt = verifyLinkupResearchEnvelope(envelope);
  const bytes = utf8(envelope), sha256 = digest(bytes);
  const origin = { mode: 'ORIGINAL_LINKUP_SAVED_BUYER_RESULT', ...receipt.binding,
    projectionSha256: sha256 };
  const current = await store.get(dossierId);
  const previous = current.editions.find(edition => edition.questionId === questionId &&
    (mode === 'reference' ? edition.mode === 'reference' && edition.provider === 'linkup' &&
      same(edition.reference, receipt.reference) :
      edition.mode === 'retained' && edition.raw?.sha256 === sha256 &&
      edition.origin?.intentId === intentId));
  // A lost response may have committed the same exact edition. Recover that write first.
  if (previous) {
    need(previous.label === label, 'LINKUP_RECEIVING_LABEL_CONFLICT');
    return { dossier: current, receipt, reused: true, editionId: previous.id };
  }
  need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 1, 'EXPECTED_REVISION_REQUIRED');
  need(!signal?.aborted, 'LINKUP_RECEIVING_ABORTED');
  const dossier = mode === 'reference' ?
    await store.receiveReference(dossierId, { questionId, label, provider: 'linkup',
      reference: receipt.reference, expectedRevision }) :
    await store.receive(dossierId, { questionId, label, provider: 'research', rawBytes: bytes,
      sourceReference: 'Original Linkup intent ' + intentId, origin, expectedRevision });
  const edition = dossier.editions.find(row => row.questionId === questionId &&
    (mode === 'reference' ? same(row.reference, receipt.reference) : row.raw?.sha256 === sha256));
  need(edition, 'LINKUP_EDITION_RECEIVING_INCOMPLETE');
  return { dossier, receipt, reused: false, editionId: edition.id };
}
