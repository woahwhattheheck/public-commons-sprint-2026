// MIT. One selected supplier render runs inside the existing paid-job Worker.
import {createHash} from 'node:crypto';
import {
  DOCUMENT_RENDER_SCHEMA, SOURCE_CHECKED_ON, buildDocumentRequest, documentProvider,
  normalizeDocumentProvider, documentError, requireDocument
} from './contracts.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
const mediaType = value => String(value ?? '').split(';', 1)[0].trim().toLowerCase();
function safeNumber(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function retainedHeaders(response, provider) {
  const selected = {};
  for (const name of ['content-type', 'content-length', 'date', ...provider.responseHeaders]) {
    const value = response.headers.get(name);
    if (value !== null) selected[name] = value;
  }
  requireDocument(Buffer.byteLength(JSON.stringify(selected)) <= 32768,
    'DOCUMENT_PROVIDER_HEADERS_TOO_LARGE', 'The provider metadata exceeds its retained header allowance.');
  return selected;
}
function authorization(config, environment) {
  if (config.authentication === 'anonymous') return {};
  const value = environment[config.keyEnvironment];
  requireDocument(typeof value === 'string' && value.length >= 1 && value.length <= 4096 &&
    !/[\x00-\x20\x7f]/.test(value), 'DOCUMENT_PROVIDER_KEY_REQUIRED',
    'Supply the selected provider key through ' + config.keyEnvironment + '.');
  return {Authorization: 'Bearer ' + value};
}
async function readBody(response, limit, signal) {
  const stated = safeNumber(response.headers.get('content-length'));
  requireDocument(stated === null || stated <= limit, 'DOCUMENT_PROVIDER_OUTPUT_TOO_LARGE',
    'The provider response exceeds the configured complete-file limit.');
  requireDocument(response.body, 'DOCUMENT_PROVIDER_EMPTY_RESPONSE', 'The provider returned no response body.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0, completed = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const value = await reader.read();
      if (value.done) {completed = true; break;}
      const chunk = value.value;
      requireDocument(chunk instanceof Uint8Array, 'DOCUMENT_PROVIDER_RESPONSE_INVALID');
      size += chunk.byteLength;
      requireDocument(size <= limit, 'DOCUMENT_PROVIDER_OUTPUT_TOO_LARGE',
        'The provider response exceeds the configured complete-file limit.');
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks, size);
    // Content-Length describes encoded bytes if the provider used HTTP compression.
    // Native fetch already checks truncated wire bodies; compare only identity encoding.
    const encoding = response.headers.get('content-encoding');
    requireDocument(stated === null || encoding && encoding.toLowerCase() !== 'identity' || stated === size,
      'DOCUMENT_PROVIDER_RESPONSE_INCOMPLETE', 'The complete provider body differs from its declared length.');
    return bytes;
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function responseFailure(response, provider, body) {
  let data;
  try {data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));} catch {}
  const supplied = data?.error?.code ?? data?.code;
  const providerCode = typeof supplied === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(supplied) ? supplied : null;
  const retryAfter = response.headers.get('retry-after');
  const requestId = response.headers.get('x-request-id');
  const status = response.status;
  const kind = status === 401 || status === 403 ? 'AUTHENTICATION' :
    status === 402 ? 'SUBSCRIPTION' : status === 429 ? 'RATE_OR_QUOTA' :
    status === 400 || status === 413 || status === 422 ? 'INPUT' : status === 503 ? 'CAPACITY' : 'HTTP';
  const suffix = [providerCode, requestId && /^[A-Za-z0-9_.:-]{1,160}$/.test(requestId) ? 'request ' + requestId : null,
    retryAfter && /^[A-Za-z0-9,: .+-]{1,100}$/.test(retryAfter) ? 'Retry-After ' + retryAfter : null].filter(Boolean).join('; ');
  return documentError('DOCUMENT_PROVIDER_' + kind + '_' + status,
    provider.name + ' returned HTTP ' + status + (suffix ? ' (' + suffix + ')' : '') + '.',
    {status, provider: provider.id, providerCode, retryAfter, providerRequestId: requestId});
}
function usageFromHeaders(provider, headers) {
  if (provider.id === 'snaplab') {
    const cache = headers['x-snaplab-cache'] ?? null;
    return {
      unit: provider.unit, requests: 1, completedDocuments: 1, cache,
      unitsFromResponse: cache === 'HIT' ? 0 : cache === 'MISS' ? 1 : null,
      remainingFromResponse: safeNumber(headers['x-snaplab-quota-remaining']),
      durationMsFromResponse: safeNumber(headers['x-snaplab-duration-ms']),
      basis: 'The original response cache header determines whether this successful call consumed a render.'
    };
  }
  if (provider.id === 'pdfmint') return {
    unit: provider.unit, requests: 1, completedDocuments: 1, documentedUnitsForSuccess: 1,
    remainingFromResponse: safeNumber(headers['x-pdfmint-credits-remaining']),
    limitFromResponse: safeNumber(headers['x-pdfmint-credits-limit']),
    pagesFromResponse: safeNumber(headers['x-pdfmint-pages']),
    durationMsFromResponse: safeNumber(headers['x-pdfmint-duration-ms']),
    basis: 'One successful document call is one published credit; returned counters retain their actual values.'
  };
  return {
    unit: provider.unit, requests: 1, completedDocuments: 1, documentedUnitsForSuccess: 1,
    remainingFromResponse: null,
    basis: 'The published plan counts renders. This response supplies no documented account counter.'
  };
}
function lifetime(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(
    documentError('DOCUMENT_PROVIDER_TIMEOUT', 'The selected provider request timed out.')), timeoutMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  return {signal, close: () => clearTimeout(timer)};
}

/** A direct supplier operation. Caller retains its source and native job before invoking. */
export async function renderDocumentBytes(configuration, format, input, sourceBytes, {
  signal: parentSignal, jobId = null, attemptId = null, sourceDescriptor = null,
  environment = process.env, fetchImplementation = globalThis.fetch
} = {}) {
  requireDocument(sourceBytes instanceof Uint8Array, 'DOCUMENT_SOURCE_BYTES_REQUIRED');
  const config = normalizeDocumentProvider(configuration);
  requireDocument(sourceBytes.byteLength > 0 && sourceBytes.byteLength <= config.maxSourceBytes,
    'DOCUMENT_SOURCE_SIZE_INVALID');
  let sourceText;
  try {sourceText = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(sourceBytes);}
  catch {throw documentError('DOCUMENT_SOURCE_UTF8_REQUIRED', 'The complete source must be valid UTF-8.');}
  const request = buildDocumentRequest(config, format, input, sourceText);
  const provider = documentProvider(config.provider);
  if(format==='pdf-set')for(const file of request.source.files){
    const bytes=Buffer.from(file.base64,'base64');
    requireDocument(bytes.toString('base64')===file.base64&&bytes.length===file.bytes&&
      digest(bytes)===file.sha256&&bytes.subarray(0,5).toString('ascii')==='%PDF-',
      'DOCUMENT_ASSEMBLY_FILE_CHANGED','The complete original PDF differs from its saved source.');
  }
  const headers = {Accept: 'application/pdf', 'Content-Type': 'application/json',
    ...authorization(config, environment)};
  requireDocument(typeof fetchImplementation === 'function', 'DOCUMENT_FETCH_REQUIRED');
  const owner = lifetime(parentSignal, config.timeoutMs);
  let response, pdf, responseHeaders;
  const startedAt = new Date().toISOString();
  try {
    owner.signal.throwIfAborted();
    try {
      response = await fetchImplementation(request.url, {method: 'POST', headers,
        body: request.bodyText, redirect: 'error', signal: owner.signal});
    } catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason ?? error;
      throw documentError('DOCUMENT_PROVIDER_RESPONSE_UNCERTAIN',
        provider.name + ' did not return a complete request response. Reconcile the original job and supplier usage before an explicit retry.');
    }
    responseHeaders = retainedHeaders(response, provider);
    if (!response.ok) {
      const errorBody = await readBody(response, 65536, owner.signal);
      throw responseFailure(response, provider, errorBody);
    }
    if (response.status !== 200 || mediaType(response.headers.get('content-type')) !== 'application/pdf') {
      await response.body?.cancel().catch(() => {});
      throw documentError('DOCUMENT_PROVIDER_PDF_RESPONSE_REQUIRED',
        provider.name + ' returned HTTP ' + response.status + ' without its requested binary PDF.',
        {status: response.status, provider: provider.id,
         providerRequestId: responseHeaders['x-request-id'] ?? null});
    }
    try {pdf = await readBody(response, config.maxPdfBytes, owner.signal);}
    catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason ?? error;
      if (String(error.code ?? '').startsWith('DOCUMENT_')) throw error;
      throw documentError('DOCUMENT_PROVIDER_PDF_RECEIVING_INTERRUPTED',
        'The provider accepted the render, but its full PDF body was not received. Preserve this original job before deciding whether to render again.');
    }
    requireDocument(pdf.length >= 8 && pdf.subarray(0, 5).toString('ascii') === '%PDF-',
      'DOCUMENT_PROVIDER_PDF_BYTES_REQUIRED', 'The received body is not a PDF document.');
  } finally {
    if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
    owner.close();
  }
  const receivedAt = new Date().toISOString();
  const record = {
    schema: DOCUMENT_RENDER_SCHEMA, provider: provider.id, providerName: provider.name,
    providerEndpoint: request.url, httpStatus: response.status, sourceCheckedOn: request.sourceCheckedOn??SOURCE_CHECKED_ON,
    taskReference: request.input.taskReference, title: request.input.title,
    nativeJob: {jobId, attemptId}, requestedAt: startedAt, receivedAt,
    request: {method: request.method, contentType: request.contentType,
      bytes: Buffer.byteLength(request.bodyText), sha256: digest(request.bodyText)},
    source: {format, bytes: sourceBytes.byteLength, sha256: digest(sourceBytes),
      descriptor: sourceDescriptor,
      ...(format==='pdf-set'?{files:request.source.files.map(({base64,...file})=>file)}:{})},
    pdf: {filename: 'document.pdf', contentType: 'application/pdf', bytes: pdf.length, sha256: digest(pdf)},
    supplier: {selectedPlan: config.plan, authentication: config.authentication,
      headers: responseHeaders, usage: usageFromHeaders(provider, responseHeaders),
      sources: provider.sources},
    completion: {documents: 1, sourceFiles: format==='pdf-set'?request.source.files.length:1,
      meaning: 'Complete supplier PDF and original editable source received for this customer task. The original paid-job and buyer records retain settlement and customer acceptance.'}
  };
  const requestFile = {
    schema: 'stellar-forge.document-request.v1', sourceFormat: format, provider: provider.id,
    originalInput: input, effectiveInput: request.input, providerConfiguration: config
  };
  const renderBytes = jsonBytes(record), requestBytes = jsonBytes(requestFile);
  requireDocument(renderBytes.length <= 65536 && requestBytes.length <= 1048576,
    'DOCUMENT_RESULT_METADATA_TOO_LARGE', 'Complete request metadata exceeds its declared output allowance.');
  return {pdf, source: Buffer.from(sourceBytes), request: requestBytes, render: renderBytes};
}

// SF30's original Worker retains JOB_INPUT_*, JOB_NATIVE_* and JOB_OUTPUT_*
// application categories. Keep supplier detail on the cause for direct callers;
// the native journal receives only the supported category.
function paidDocumentFailure(error) {
  const sourceCode = typeof error?.code === 'string' ? error.code : '';
  if (!sourceCode.startsWith('DOCUMENT_')) return error;
  const http = /^DOCUMENT_PROVIDER_(AUTHENTICATION|SUBSCRIPTION|RATE_OR_QUOTA|INPUT|CAPACITY|HTTP)_[0-9]{3}$/.exec(sourceCode);
  const categories = {
    DOCUMENT_PROVIDER_KEY_REQUIRED: 'JOB_NATIVE_DOCUMENT_AUTHENTICATION',
    DOCUMENT_PROVIDER_RESPONSE_UNCERTAIN: 'JOB_NATIVE_DOCUMENT_RESPONSE_UNCERTAIN',
    DOCUMENT_PROVIDER_TIMEOUT: 'JOB_NATIVE_DOCUMENT_TIMEOUT',
    DOCUMENT_PROVIDER_PDF_RECEIVING_INTERRUPTED: 'JOB_OUTPUT_DOCUMENT_INTERRUPTED',
    DOCUMENT_PROVIDER_OUTPUT_TOO_LARGE: 'JOB_OUTPUT_DOCUMENT_TOO_LARGE',
    DOCUMENT_PROVIDER_RESPONSE_INCOMPLETE: 'JOB_OUTPUT_DOCUMENT_INCOMPLETE',
    DOCUMENT_PROVIDER_EMPTY_RESPONSE: 'JOB_OUTPUT_DOCUMENT_PDF_INVALID',
    DOCUMENT_PROVIDER_RESPONSE_INVALID: 'JOB_OUTPUT_DOCUMENT_PDF_INVALID',
    DOCUMENT_PROVIDER_PDF_RESPONSE_REQUIRED: 'JOB_OUTPUT_DOCUMENT_PDF_INVALID',
    DOCUMENT_PROVIDER_PDF_BYTES_REQUIRED: 'JOB_OUTPUT_DOCUMENT_PDF_INVALID',
    DOCUMENT_PROVIDER_HEADERS_TOO_LARGE: 'JOB_OUTPUT_DOCUMENT_METADATA_LIMIT',
    DOCUMENT_RESULT_METADATA_TOO_LARGE: 'JOB_OUTPUT_DOCUMENT_METADATA_LIMIT',
    DOCUMENT_ORIGINAL_FILE_HANDLE_REQUIRED: 'JOB_INPUT_DOCUMENT_HANDLE_REQUIRED',
    DOCUMENT_ORIGINAL_SOURCE_CHANGED: 'JOB_INPUT_DOCUMENT_SOURCE_CHANGED',
    DOCUMENT_SOURCE_MEDIA_MISMATCH: 'JOB_INPUT_DOCUMENT_MEDIA_MISMATCH',
    DOCUMENT_SOURCE_BYTES_REQUIRED: 'JOB_INPUT_DOCUMENT_SOURCE_REQUIRED',
    DOCUMENT_SOURCE_UTF8_REQUIRED: 'JOB_INPUT_DOCUMENT_ENCODING_REQUIRED',
    DOCUMENT_SOURCE_SIZE_INVALID: 'JOB_INPUT_DOCUMENT_SOURCE_SIZE',
    DOCUMENT_SOURCE_FORMAT_UNSUPPORTED: 'JOB_INPUT_DOCUMENT_FORMAT_UNSUPPORTED',
    DOCUMENT_PROVIDER_BODY_TOO_LARGE: 'JOB_INPUT_DOCUMENT_PROVIDER_BODY_LIMIT',
    DOCUMENT_INPUT_INVALID: 'JOB_INPUT_DOCUMENT_INVALID',
    DOCUMENT_SETTINGS_INVALID: 'JOB_INPUT_DOCUMENT_SETTINGS',
    DOCUMENT_PAGE_DIMENSIONS_REQUIRED: 'JOB_INPUT_DOCUMENT_PAGE_DIMENSIONS'
  };
  if(sourceCode.startsWith('DOCUMENT_ASSEMBLY_'))return Object.assign(
    new Error('JOB_INPUT_DOCUMENT_ASSEMBLY',{cause:error}),{code:'JOB_INPUT_DOCUMENT_ASSEMBLY'});
  const code = http ? http[1] === 'INPUT' ? 'JOB_INPUT_DOCUMENT_PROVIDER_REJECTED' :
    'JOB_NATIVE_DOCUMENT_' + (http[1] === 'HTTP' ? 'HTTP_FAILURE' : http[1]) :
    categories[sourceCode] ?? 'JOB_NATIVE_DOCUMENT_CONFIGURATION';
  return Object.assign(new Error(code, {cause: error}), {code});
}

/** Uses original sealed file handles supplied by SF30's paid application Worker. */
export async function renderPaidDocument(configuration, format, input, context) {
  try {
    const config = normalizeDocumentProvider(configuration);
    requireDocument(context?.files && typeof context.files.read === 'function' &&
      typeof context.files.metadata === 'function', 'DOCUMENT_ORIGINAL_FILE_HANDLE_REQUIRED');
    context.signal?.throwIfAborted();
    const descriptor = context.files.metadata('source');
    const expectedType = format==='pdf-set'?'application/json':format === 'html' ? 'text/html' : 'text/markdown';
    requireDocument(descriptor?.contentType === expectedType, 'DOCUMENT_SOURCE_MEDIA_MISMATCH',
      'Select the complete ' + expectedType + ' source file for this function.');
    const source = await context.files.read('source', {maxBytes: config.maxSourceBytes});
    requireDocument(source.byteLength === descriptor.bytes && digest(source) === descriptor.sha256,
      'DOCUMENT_ORIGINAL_SOURCE_CHANGED');
    return await renderDocumentBytes(config, format, input, source, {
      signal: context.signal, jobId: context.jobId, attemptId: context.attemptId,
      sourceDescriptor: descriptor
    });
  } catch (error) {throw paidDocumentFailure(error);}
}

/** The provider's documented read-only account operation; never consumes a render. */
export async function readDocumentSupplierUsage(configuration, {
  signal: parentSignal, environment = process.env, fetchImplementation = globalThis.fetch
} = {}) {
  const config = normalizeDocumentProvider(configuration), provider = documentProvider(config.provider);
  requireDocument(config.authentication === 'bearer', 'DOCUMENT_USAGE_REQUIRES_KEY',
    'The provider account usage endpoint requires its original bearer key.');
  const owner = lifetime(parentSignal, Math.min(config.timeoutMs, 30000));
  const url = provider.origin + provider.usagePath;
  try {
    const response = await fetchImplementation(url, {method: 'GET', redirect: 'error',
      headers: {Accept: 'application/json', ...authorization(config, environment)}, signal: owner.signal});
    const bytes = await readBody(response, 1048576, owner.signal);
    if (!response.ok) throw responseFailure(response, provider, bytes);
    let account;
    try {account = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));}
    catch {throw documentError('DOCUMENT_USAGE_JSON_REQUIRED');}
    return {schema: 'stellar-forge.document-supplier-usage.v1', provider: provider.id,
      observedAt: new Date().toISOString(), url, status: response.status,
      bytes: bytes.length, sha256: digest(bytes), account};
  } finally {owner.close();}
}
