// MIT. Original multipart preparation and saved Node Buyer document consumption.
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Buyer } from '../client.mjs';
import { readBytes, readJson, parseJson, intent as nativeIntent } from '../store.mjs';
import {
  UNSTRUCTURED_SOURCE, PARTITION_LIMITS, validatePartitionManifest,
  normalizePartitionParameters, partitionParametersFromFields, partitionBodySchema,
  parsePartitionElements, partitionElementSummary, profileId, profileRoute,
  canonicalBytes, digest, same, need, object,
} from './contract.mjs';

export const PARTITION_PURCHASE_SCHEMA = 'sf88-unstructured-saved-purchase-v1';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const encoded = value => {
  const bytes = Buffer.from(value);
  return { bytes: bytes.length, sha256: digest(bytes), bodyBase64: bytes.toString('base64') };
};
export function decodePartitionBytes(record, limit) {
  need(object(record) && Number.isSafeInteger(record.bytes) && record.bytes >= 0 &&
    record.bytes <= limit && hex(record.sha256) && typeof record.bodyBase64 === 'string' &&
    record.bodyBase64.length <= 4 * Math.ceil(limit / 3), 'UNSTRUCTURED_BYTE_RECORD_INVALID');
  const bytes = Buffer.from(record.bodyBase64, 'base64');
  need(bytes.length === record.bytes && digest(bytes) === record.sha256 &&
    bytes.toString('base64') === record.bodyBase64, 'UNSTRUCTURED_RETAINED_BYTES_CHANGED');
  return bytes;
}
function contentType(headers) {
  need(object(headers), 'UNSTRUCTURED_ORIGINAL_HEADERS_REQUIRED');
  const values = Object.entries(headers).filter(([name]) => name.toLowerCase() === 'content-type');
  need(values.length === 1 && typeof values[0][1] === 'string' &&
    /^multipart\/form-data\s*;/i.test(values[0][1]), 'UNSTRUCTURED_ORIGINAL_CONTENT_TYPE_REQUIRED');
  return values[0][1];
}
async function requestRuntime(directory) {
  need(typeof directory === 'string' && resolve(directory) === directory, 'UNSTRUCTURED_NATIVE_RUNTIME_REQUIRED');
  const source = await import(pathToFileURL(join(directory, 'request-body.mjs')).href);
  need(typeof source.prepareMultipartFile === 'function' && typeof source.requestBodyReview === 'function' &&
    typeof source.readRequestFile === 'function' && source.MAX_REQUEST_BODY_BYTES === PARTITION_LIMITS.requestBytes,
  'UNSTRUCTURED_ORIGINAL_MULTIPART_RUNTIME_REQUIRED');
  return source;
}
function routeSelection(operation) {
  need(object(operation) && operation.method === 'POST' && typeof operation.url === 'string' &&
    operation.expect?.paymentFlow === 'authorization', 'UNSTRUCTURED_ORIGINAL_OPERATION_REQUIRED');
  const url = new URL(operation.url);
  const match = /^\/documents\/unstructured\/([a-z][a-z0-9-]{0,39})$/.exec(url.pathname);
  need(match && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
    !url.search && !url.hash, 'UNSTRUCTURED_ORIGINAL_ROUTE_MISMATCH');
  return { method: 'POST', url: operation.url, profileId: profileId(match[1]), paymentFlow: 'authorization' };
}
export async function readPartitionManifest(file) {
  return validatePartitionManifest(parseJson(await readBytes(resolve(file), 1024 * 1024)));
}

/** Prepare or reopen the exact original wire for an SF66 customer selection. */
export async function preparePartitionRequest({
  runtimeDirectory, manifest, profile: selectedId, file, filename,
  mediaType = 'application/octet-stream', bodyFile, intentId, maxAtomic, acceptIndex,
} = {}) {
  manifest = structuredClone(validatePartitionManifest(manifest));
  const profile = manifest.profiles.find(value => value.id === profileId(selectedId));
  need(profile, 'UNSTRUCTURED_MERCHANT_PROFILE_NOT_FOUND');
  need(typeof file === 'string' && resolve(file) === file &&
    typeof bodyFile === 'string' && resolve(bodyFile) === bodyFile && bodyFile !== file,
  'UNSTRUCTURED_DISTINCT_ABSOLUTE_DOCUMENT_PATHS_REQUIRED');
  nativeIntent(intentId);
  need(typeof maxAtomic === 'string' && /^[1-9][0-9]{0,38}$/.test(maxAtomic) &&
    BigInt(maxAtomic) <= (1n << 127n) - 1n &&
    Number.isSafeInteger(acceptIndex) && acceptIndex >= 0 && acceptIndex < profile.paymentOptions.length,
  'UNSTRUCTURED_EXPLICIT_PAYMENT_SELECTION_REQUIRED');
  const terms = profile.paymentOptions[acceptIndex];
  need(BigInt(terms.amount) <= BigInt(maxAtomic), 'UNSTRUCTURED_PURCHASE_EXCEEDS_BUYER_CEILING');
  need(typeof mediaType === 'string' && mediaType === mediaType.toLowerCase() &&
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mediaType),
  'UNSTRUCTURED_CANONICAL_DOCUMENT_MEDIA_TYPE_REQUIRED');
  const source = await requestRuntime(runtimeDirectory);
  const documentBytes = await source.readRequestFile(file);
  need(documentBytes.length > 0 && documentBytes.length <= profile.maxDocumentBytes,
    'UNSTRUCTURED_DOCUMENT_LIMIT_EXCEEDED');
  let raw, type, reused = false;
  try { raw = await source.readRequestFile(bodyFile); reused = true; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      const prepared = await source.prepareMultipartFile({
        fields: profile.parameters,
        files: [{ field: 'files', path: file, filename: filename ?? basename(file), contentType: mediaType }],
      }, bodyFile);
      type = contentType(prepared.headers);
    } catch (problem) {
      if (problem.code !== 'EEXIST') throw problem;
      reused = true;
    }
    raw = await source.readRequestFile(bodyFile);
  }
  if (type === undefined) {
    // The maintained writer's first delimiter preserves its random boundary even
    // if publication of a caller's receipt was interrupted after writing the body.
    // Every part and field is then decoded by the original native reviewer below.
    const boundary = /^--(starforge-[a-f0-9]{48})\r\n/.exec(raw.subarray(0,80).toString('ascii'))?.[1];
    need(boundary, 'UNSTRUCTURED_ORIGINAL_MULTIPART_BOUNDARY_REQUIRED');
    type = 'multipart/form-data; boundary=' + boundary;
  }
  need(raw.length <= profile.maxRequestBytes, 'UNSTRUCTURED_REQUEST_LIMIT_EXCEEDED');
  const reviewed = await reviewedDocument(runtimeDirectory, raw, type);
  need(reviewed.document.filename === (filename ?? basename(file)) &&
    reviewed.document.contentType === mediaType && reviewed.document.sha256 === digest(documentBytes) &&
    reviewed.document.bytes === documentBytes.length &&
    same(reviewed.parameters, profile.parameters) &&
    reviewed.parametersSha256 === profile.parametersSha256,
  'UNSTRUCTURED_PREPARED_DOCUMENT_PROFILE_CHANGED');
  const { bodyBase64: _retainedDocument, ...document } = reviewed.document;
  const headers = { 'Content-Type': type };
  return {
    reused, bodyFile, bodyBytes: raw.length, bodySha256: digest(raw), headers, document,
    parametersSha256: reviewed.parametersSha256, maximumAtomic: maxAtomic,
    originalTerms: structuredClone(terms),
    purchase: {
      routeId: profile.operationId, method: 'POST', intentId, acceptIndex,
      paymentFlow: 'authorization', bodyFile, headers, saveResponse: true,
      responseMaxBytes: profile.maxResponseBytes, responseTimeoutMs: manifest.requestTimeoutMs,
      requestTimeoutMs: manifest.requestTimeoutMs,
    },
  };
}

/** Copies a selected document through the original SF88 multipart writer and client. */
export async function preparePartitionPurchase(buyer, {
  manifest, profile: selectedId, file, filename, mediaType = 'application/octet-stream',
  client, intentId, maxAtomic, acceptIndex, workspace, signal,
} = {}) {
  need(buyer instanceof Buyer, 'ORIGINAL_DOCUMENT_BUYER_REQUIRED');
  manifest = structuredClone(validatePartitionManifest(manifest));
  const selected = manifest.profiles.find(value => value.id === profileId(selectedId));
  need(selected, 'UNSTRUCTURED_MERCHANT_PROFILE_NOT_FOUND');
  need(typeof file === 'string' && resolve(file) === file, 'UNSTRUCTURED_DOCUMENT_ABSOLUTE_PATH_REQUIRED');
  need(typeof client === 'string' && resolve(client) === client, 'UNSTRUCTURED_ORIGINAL_CLIENT_REQUIRED');
  need(typeof intentId === 'string' && intentId.length > 0 && intentId.length <= 512,
    'UNSTRUCTURED_STABLE_INTENT_REQUIRED');
  need(typeof maxAtomic === 'string' && /^(?:0|[1-9][0-9]{0,99})$/.test(maxAtomic) &&
    Number.isSafeInteger(acceptIndex) && acceptIndex >= 0 && acceptIndex < 16,
  'UNSTRUCTURED_EXPLICIT_PAYMENT_SELECTION_REQUIRED');
  need(!signal?.aborted, 'UNSTRUCTURED_PREPARATION_ABORTED');
  await buyer.ready();
  const source = await requestRuntime(buyer.runtime.directory);
  const temporary = await mkdtemp(join(buyer.stateDirectory, '.unstructured-prepare-'));
  try {
    const prepared = await source.prepareMultipartFile({
      fields: selected.parameters,
      files: [{ field: 'files', path: file, filename: filename ?? basename(file), contentType: mediaType }],
    }, join(temporary, 'request.body'));
    need(prepared.review.files.length === 1 && prepared.review.files[0].bytes > 0 &&
      prepared.review.files[0].bytes <= selected.maxDocumentBytes &&
      prepared.bodyBytes <= selected.maxRequestBytes, 'UNSTRUCTURED_DOCUMENT_LIMIT_EXCEEDED');
    const body = await source.readRequestFile(prepared.bodyFile);
    const module = await import(pathToFileURL(client).href);
    need(typeof module.createSellerClient === 'function', 'UNSTRUCTURED_ORIGINAL_CLIENT_REQUIRED');
    const api = module.createSellerClient({ buyer });
    const request = api.request(selected.operationId, {
      multipart: { body, contentType: contentType(prepared.headers) },
    }, { intentId, maxAtomic, acceptIndex, paymentFlow: 'authorization', signal });
    need(object(request) && request.method === 'POST' && request.url === selected.url &&
      request.expect?.paymentFlow === 'authorization' &&
      request.body instanceof Uint8Array && Buffer.from(request.body).equals(body) &&
      contentType(request.headers) === contentType(prepared.headers),
    'UNSTRUCTURED_GENERATED_REQUEST_MISMATCH');
    const terms = selected.paymentOptions?.[acceptIndex];
    need(object(terms) && request.expect.network === terms.network &&
      request.expect.asset === terms.asset && request.expect.payTo === terms.payTo &&
      terms.extra?.paymentFlow === 'authorization' && BigInt(terms.amount) <= BigInt(maxAtomic),
    'UNSTRUCTURED_REVIEWED_PAYMENT_OPTION_MISMATCH');
    const options = {
      requestTimeoutMs: manifest.requestTimeoutMs,
      responseFile: {
        maxBytes: selected.maxResponseBytes,
        timeoutMs: manifest.requestTimeoutMs,
        expectedContentType: 'application/json',
      },
    };
    let operation;
    if (workspace !== undefined) {
      const { body: originalBody, signal: originalSignal, ...configuration } = request;
      operation = await buyer.fromWorkspace(resolve(workspace), {
        ...options, configuration: { operation: configuration },
        body: originalBody, signal: originalSignal,
      });
    } else operation = await buyer.fromRequest(request, options);
    return operation;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Uses the same native request reviewer that reviewed the prepared purchase. */
async function reviewedDocument(runtimeDirectory, raw, type) {
  const source = await requestRuntime(runtimeDirectory);
  const review = await source.requestBodyReview({ headers: { 'content-type': type } }, raw, {
    extensions: { bazaar: { schema: { properties: { input: { properties: {
      body: partitionBodySchema(),
    } } } } } },
  });
  need(review && review.files.length === 1 && review.files[0].field === 'files' &&
    review.files[0].bytes > 0 && review.files[0].bytes <= PARTITION_LIMITS.documentBytes,
  'UNSTRUCTURED_ORIGINAL_DOCUMENT_REQUIRED');
  const parameters = partitionParametersFromFields(review.fields);
  // Extraction uses the same maintained Fetch FormData implementation as SF30.
  // Scalar interpretation and validation above remain the original native review.
  const form = await new Response(raw, { headers: { 'content-type': type } }).formData();
  const files = form.getAll('files');
  need(files.length === 1 && typeof files[0] !== 'string', 'UNSTRUCTURED_ORIGINAL_FILE_REQUIRED');
  const bytes = Buffer.from(await files[0].arrayBuffer());
  const document = review.files[0];
  need(bytes.length === document.bytes && digest(bytes) === document.sha256 &&
    files[0].name === document.filename, 'UNSTRUCTURED_ORIGINAL_DOCUMENT_CHANGED');
  return { parameters, parametersSha256: digest(canonicalBytes(parameters)),
    document: { ...document, ...encoded(bytes) } };
}

/** Read-only recovery; this method never executes or retries a purchase. */
export async function readPartitionPurchase(buyer, intentId, { workspaceId, signal } = {}) {
  need(buyer instanceof Buyer, 'ORIGINAL_DOCUMENT_BUYER_REQUIRED');
  need(typeof workspaceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(workspaceId),
    'UNSTRUCTURED_WORKSPACE_ID_REQUIRED');
  need(!signal?.aborted, 'UNSTRUCTURED_READ_ABORTED');
  const operation = buyer.operation(intentId), result = await operation.recover();
  need(result && result.native.httpStatus === 200 && result.delivery.status === 'SAVED',
    'UNSTRUCTURED_RESPONSE_NOT_SAVED');
  const configBytes = await readBytes(operation.configPath, 65536);
  const meta = await readJson(join(operation.directory, 'operation.json'), 65536);
  need(meta.intentId === intentId && result.record.intentId === intentId &&
    hex(meta.configSha256) && meta.configSha256 === result.record.configSha256 &&
    digest(configBytes) === meta.configSha256, 'UNSTRUCTURED_ORIGINAL_CONFIGURATION_CHANGED');
  const config = parseJson(configBytes), selection = routeSelection(config.operation);
  need(config.operation.intentId === intentId && typeof config.operation.bodyFile === 'string' &&
    resolve(config.operation.bodyFile) === resolve(join(operation.directory, 'request.body')),
  'UNSTRUCTURED_ORIGINAL_REQUEST_PATH_CHANGED');
  const source = await requestRuntime(buyer.runtime.directory);
  const raw = await source.readRequestFile(config.operation.bodyFile);
  need(hex(meta.bodySha256) && digest(raw) === meta.bodySha256, 'UNSTRUCTURED_ORIGINAL_REQUEST_CHANGED');
  const type = contentType(config.operation.headers);
  const reviewed = await reviewedDocument(buyer.runtime.directory, raw, type);
  const response = await result.bytes({ limit: PARTITION_LIMITS.responseBytes, signal });
  need(response.length === result.delivery.bytes && digest(response) === result.delivery.sha256,
    'UNSTRUCTURED_ORIGINAL_RESPONSE_CHANGED');
  const elements = parsePartitionElements(parseJson(response));
  return {
    schema: PARTITION_PURCHASE_SCHEMA, source: UNSTRUCTURED_SOURCE,
    workspaceId, intentId, configurationSha256: meta.configSha256,
    selection: { ...selection, contentType: type, parameters: reviewed.parameters,
      parametersSha256: reviewed.parametersSha256 },
    request: encoded(raw), document: reviewed.document, response: encoded(response),
    summary: partitionElementSummary(elements),
    native: {
      status: result.status, httpStatus: result.native.httpStatus,
      sellerReportedSettlement: result.native.sellerReportedSettlement,
      responseStatus: result.delivery.status,
    },
  };
}

/** Read an existing SF66/SF88 inbox result through the original Node Inbox reader. */
export async function readPartitionInboxPurchase(buyer, inboxDirectory, intentId, {
  workspaceId, signal,
} = {}) {
  need(buyer instanceof Buyer, 'ORIGINAL_DOCUMENT_BUYER_REQUIRED');
  need(typeof workspaceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(workspaceId),
    'UNSTRUCTURED_WORKSPACE_ID_REQUIRED');
  need(typeof inboxDirectory === 'string' && resolve(inboxDirectory) === inboxDirectory,
    'UNSTRUCTURED_ORIGINAL_INBOX_REQUIRED');
  need(!signal?.aborted, 'UNSTRUCTURED_READ_ABORTED');
  const result = await buyer.inbox(inboxDirectory).response(intentId, { signal });
  need(result && result.native.httpStatus === 200 && result.delivery.status === 'SAVED',
    'UNSTRUCTURED_RESPONSE_NOT_SAVED');
  const job = result.job, directory = join(inboxDirectory, 'jobs', digest(intentId));
  need(job.id === digest(intentId) && job.operation?.intentId === intentId &&
    hex(job.configSha256) && hex(job.bodySha256), 'UNSTRUCTURED_ORIGINAL_INBOX_CHANGED');
  const configBytes = await readBytes(join(directory, 'execution.json'), 65536);
  need(digest(configBytes) === job.configSha256, 'UNSTRUCTURED_ORIGINAL_CONFIGURATION_CHANGED');
  const config = parseJson(configBytes), selection = routeSelection(config.operation);
  need(same(config.operation, job.operation) && config.operation.intentId === intentId &&
    typeof config.operation.bodyFile === 'string' &&
    resolve(config.operation.bodyFile) === resolve(join(directory, 'request-body.bin')),
  'UNSTRUCTURED_ORIGINAL_REQUEST_PATH_CHANGED');
  const source = await requestRuntime(buyer.runtime.directory);
  const raw = await source.readRequestFile(config.operation.bodyFile);
  need(raw.length === job.bodyBytes && digest(raw) === job.bodySha256,
    'UNSTRUCTURED_ORIGINAL_REQUEST_CHANGED');
  const type = contentType(config.operation.headers);
  const reviewed = await reviewedDocument(buyer.runtime.directory, raw, type);
  const response = await result.bytes({ limit: PARTITION_LIMITS.responseBytes, signal });
  need(response.length === result.delivery.bytes && digest(response) === result.delivery.sha256,
    'UNSTRUCTURED_ORIGINAL_RESPONSE_CHANGED');
  const elements = parsePartitionElements(parseJson(response));
  return {
    schema: PARTITION_PURCHASE_SCHEMA, source: UNSTRUCTURED_SOURCE,
    workspaceId, intentId, configurationSha256: job.configSha256,
    selection: { ...selection, contentType: type, parameters: reviewed.parameters,
      parametersSha256: reviewed.parametersSha256 },
    request: encoded(raw), document: reviewed.document, response: encoded(response),
    summary: partitionElementSummary(elements),
    native: {
      status: result.status, httpStatus: result.native.httpStatus,
      sellerReportedSettlement: result.native.sellerReportedSettlement,
      responseStatus: result.delivery.status,
    },
  };
}

/** Validate a retained purchase through the installed original request reader. */
export async function verifyPartitionPurchase(value, { runtimeDirectory } = {}) {
  need(object(value) && value.schema === PARTITION_PURCHASE_SCHEMA && same(value.source, UNSTRUCTURED_SOURCE) &&
    typeof value.workspaceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.workspaceId) &&
    typeof value.intentId === 'string' && value.intentId.length > 0 && value.intentId.length <= 512 &&
    hex(value.configurationSha256) && object(value.selection) && object(value.native),
  'UNSTRUCTURED_SAVED_PURCHASE_REQUIRED');
  const chosen = routeSelection({ ...value.selection, expect: { paymentFlow: value.selection.paymentFlow } });
  need(chosen.profileId === value.selection.profileId &&
    value.native.httpStatus === 200 && value.native.responseStatus === 'SAVED' &&
    typeof value.native.status === 'string', 'UNSTRUCTURED_SAVED_SELECTION_INVALID');
  const raw = decodePartitionBytes(value.request, PARTITION_LIMITS.requestBytes);
  const reviewed = await reviewedDocument(runtimeDirectory, raw, value.selection.contentType);
  need(same(value.selection.parameters, reviewed.parameters) &&
    value.selection.parametersSha256 === reviewed.parametersSha256 &&
    same(value.document, reviewed.document), 'UNSTRUCTURED_SAVED_DOCUMENT_PROFILE_CHANGED');
  const response = decodePartitionBytes(value.response, PARTITION_LIMITS.responseBytes);
  const elements = parsePartitionElements(parseJson(response));
  need(same(value.summary, partitionElementSummary(elements)), 'UNSTRUCTURED_SAVED_SUMMARY_CHANGED');
  return { purchase: value, elements, document: decodePartitionBytes(value.document, PARTITION_LIMITS.documentBytes) };
}
export function partitionPurchaseBinding(purchase) {
  return {
    schema: PARTITION_PURCHASE_SCHEMA, workspaceId: purchase.workspaceId, intentId: purchase.intentId,
    configurationSha256: purchase.configurationSha256,
    method: purchase.selection.method, url: purchase.selection.url,
    profileId: purchase.selection.profileId, paymentFlow: purchase.selection.paymentFlow,
    parametersSha256: purchase.selection.parametersSha256,
    document: {
      filename: purchase.document.filename, contentType: purchase.document.contentType,
      bytes: purchase.document.bytes, sha256: purchase.document.sha256,
    },
    requestSha256: purchase.request.sha256, requestBytes: purchase.request.bytes,
    responseSha256: purchase.response.sha256, responseBytes: purchase.response.bytes,
    native: structuredClone(purchase.native),
  };
}
