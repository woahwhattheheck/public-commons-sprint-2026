// MIT. Profile-priced document partitioning on the original SF30 native merchant.
import { compileHttpSellerOffer } from './seller.mjs';
import { createUpstreamApplication } from './upstream.mjs';
import { startSellerService } from './serve.mjs';
import {
  UNSTRUCTURED_SOURCE, PARTITION_LIMITS, PARTITION_RESPONSE_SCHEMA,
  normalizePartitionParameters, partitionBodySchema, profileId, profileRoute,
  validatePartitionManifest, canonicalBytes, digest, need, object, freeze,
} from '../sf88-operator-buyer-cli/node/unstructured/contract.mjs';

export { UNSTRUCTURED_SOURCE, PARTITION_RESPONSE_SCHEMA };
const integer = (value, fallback, min, max, code) => {
  value ??= fallback;
  need(Number.isSafeInteger(value) && value >= min && value <= max, code);
  return value;
};
const only = (value, keys, code) => need(object(value) &&
  Object.keys(value).every(key => keys.includes(key)), code);
const handlerName = id => 'partition_' + id.replaceAll('-', '_');

/** Data-only compilation. Each exact profile retains its own declared payment options. */
export function compileUnstructuredPartition(configuration) {
  only(configuration, ['schema', 'publicOrigin', 'upstream', 'profiles', 'requestTimeoutMs',
    'handlerTimeoutMs', 'admissionTimeoutMs'], 'UNSTRUCTURED_CONFIGURATION_INVALID');
  need(configuration.schema === 'stellar-forge.unstructured-partition.v1' &&
    Array.isArray(configuration.profiles) && configuration.profiles.length > 0 &&
    configuration.profiles.length <= 16, 'UNSTRUCTURED_PROFILES_REQUIRED');
  const origin = new URL(configuration.publicOrigin);
  need(origin.origin === configuration.publicOrigin && origin.protocol === 'https:' &&
    !origin.username && !origin.password, 'UNSTRUCTURED_PUBLIC_HTTPS_ORIGIN_REQUIRED');
  const upstream = configuration.upstream;
  only(upstream, ['origin', 'apiKeyEnv', 'timeoutMs', 'maxInFlight'], 'UNSTRUCTURED_UPSTREAM_INVALID');
  need(typeof upstream.origin === 'string', 'UNSTRUCTURED_UPSTREAM_ORIGIN_REQUIRED');
  if (upstream.apiKeyEnv !== undefined)
    need(typeof upstream.apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(upstream.apiKeyEnv),
      'UNSTRUCTURED_API_KEY_REFERENCE_INVALID');
  const timeoutMs = integer(upstream.timeoutMs, 110000, 1, 119999, 'UNSTRUCTURED_UPSTREAM_TIMEOUT_INVALID');
  const handlerTimeoutMs = integer(configuration.handlerTimeoutMs, Math.min(timeoutMs + 5000, 120000),
    1, 120000, 'UNSTRUCTURED_HANDLER_TIMEOUT_INVALID');
  need(handlerTimeoutMs > timeoutMs, 'UNSTRUCTURED_HANDLER_DEADLINE_MUST_EXCEED_UPSTREAM');
  const requestTimeoutMs = integer(configuration.requestTimeoutMs, 180000,
    1, 300000, 'UNSTRUCTURED_REQUEST_TIMEOUT_INVALID');
  need(requestTimeoutMs > handlerTimeoutMs, 'UNSTRUCTURED_REQUEST_DEADLINE_MUST_EXCEED_HANDLER');
  const maxInFlight = integer(upstream.maxInFlight, 2, 1, 256, 'UNSTRUCTURED_CONCURRENCY_INVALID');
  const routes = [], profiles = [], bindings = {}, ids = new Set();
  for (const raw of configuration.profiles) {
    only(raw, ['id', 'title', 'description', 'parameters', 'payment', 'paymentOptions',
      'maxDocumentBytes', 'maxResponseBytes'], 'UNSTRUCTURED_PROFILE_INVALID');
    const id = profileId(raw.id);
    need(!ids.has(id), 'UNSTRUCTURED_PROFILE_DUPLICATE');
    ids.add(id);
    need(typeof raw.title === 'string' && raw.title.trim().length > 0 && raw.title.length <= 120 &&
      typeof raw.description === 'string' && raw.description.trim().length > 0 &&
      raw.description.length <= 1600, 'UNSTRUCTURED_PROFILE_DESCRIPTION_REQUIRED');
    const parameters = normalizePartitionParameters(raw.parameters);
    const maxDocumentBytes = integer(raw.maxDocumentBytes, 8 * 1024 * 1024,
      1, PARTITION_LIMITS.documentBytes, 'UNSTRUCTURED_DOCUMENT_LIMIT_INVALID');
    const maxRequestBytes = maxDocumentBytes + 65536;
    const maxResponseBytes = integer(raw.maxResponseBytes, PARTITION_LIMITS.responseBytes,
      1, PARTITION_LIMITS.responseBytes, 'UNSTRUCTURED_RESPONSE_LIMIT_INVALID');
    const operationId = 'unstructured-' + id, path = profileRoute(id), handler = handlerName(id);
    const definition = {
      method: 'POST', url: configuration.publicOrigin + path, responseFormat: 'json',
      serviceName: raw.title, description: raw.description, tags: ['documents', 'partition', id],
      bodyType: 'form-data', body: { files: 'x', ...parameters },
      outputExample: [{ type: 'NarrativeText', element_id: 'example-element',
        text: 'Extracted document text', metadata: { filename: 'document.txt' } }],
      ...(Object.hasOwn(raw, 'payment') ? { payment: raw.payment } : {}),
      ...(Object.hasOwn(raw, 'paymentOptions') ? { paymentOptions: raw.paymentOptions } : {}),
    };
    const offer = compileHttpSellerOffer(definition);
    need(offer.accepts.every(option => option.network.startsWith('stellar:') &&
      option.extra?.paymentFlow === 'authorization'),
    'UNSTRUCTURED_NATIVE_STELLAR_AUTHORIZATION_REQUIRED');
    offer.extensions.bazaar.schema.properties.input.properties.body =
      partitionBodySchema(parameters, maxDocumentBytes);
    // The whole ordinary Bazaar schema and original multipart request are checked
    // by SF30 before native verification. The provider receives the same bytes.
    routes.push({ id: operationId, path, offer, handler, validateInput: true, maxRequestBytes });
    bindings[handler] = {
      origin: upstream.origin, path: UNSTRUCTURED_SOURCE.apiPath,
      method: 'POST', bodyType: 'form-data', responseMode: 'json',
      query: [], requestHeaders: [], responseHeaders: ['content-type'],
      headerEnv: upstream.apiKeyEnv === undefined ? {} : { 'unstructured-api-key': upstream.apiKeyEnv },
      timeoutMs, maxRequestBytes, maxResponseBytes, maxInFlight,
      responseContract: {
        schema: 'stellar-forge.upstream-response-contract.v1', method: 'POST',
        responses: { '200': { content: { 'application/json': PARTITION_RESPONSE_SCHEMA } } },
      },
    };
    profiles.push({
      id, operationId, handler, title: raw.title, description: raw.description,
      path, url: definition.url, parameters,
      parametersSha256: digest(canonicalBytes(parameters)), maxDocumentBytes,
      maxRequestBytes, maxResponseBytes, paymentFlow: 'authorization',
      paymentOptions: structuredClone(offer.accepts),
    });
  }
  const manifest = validatePartitionManifest({
    schema: 'stellar-forge.unstructured-partition-manifest.v1',
    source: UNSTRUCTURED_SOURCE, publicOrigin: configuration.publicOrigin,
    requestTimeoutMs, handlerTimeoutMs, profiles,
  });
  return freeze({
    service: {
      schema: 'stellar-forge.seller-service.v1', publicOrigin: configuration.publicOrigin,
      maxRequestBytes: Math.max(...profiles.map(profile => profile.maxRequestBytes)),
      maxResponseBytes: Math.max(...profiles.map(profile => profile.maxResponseBytes)),
      requestTimeoutMs, handlerTimeoutMs,
      admissionTimeoutMs: integer(configuration.admissionTimeoutMs, 2000, 1, 10000,
        'UNSTRUCTURED_ADMISSION_TIMEOUT_INVALID'),
      routes,
    },
    upstreams: { schema: 'stellar-forge.seller-upstreams.v1', bindings },
    manifest,
  });
}

/** The original configured application owns schema admission, sockets and deadlines. */
export function createUnstructuredPartitionHandlers(configuration, options = {}) {
  const compiled = compileUnstructuredPartition(configuration);
  const application = createUpstreamApplication(compiled.service, compiled.upstreams, options);
  return Object.freeze({
    ...compiled, service: application.config, handlers: application.handlers,
    close: application.close,
    snapshot: () => ({
      schema: 'stellar-forge.unstructured-partition-status.v1',
      capturedAt: new Date().toISOString(), source: UNSTRUCTURED_SOURCE,
      profiles: compiled.manifest.profiles.map(profile => ({
        id: profile.id, parametersSha256: profile.parametersSha256,
      })),
      upstreams: application.snapshot(),
    }),
  });
}

/** Original service lifecycle: finish native work, then release the provider transport. */
export async function startUnstructuredPartitionService({
  configuration, upstreamOptions = {}, ...options
} = {}) {
  const application = createUnstructuredPartitionHandlers(configuration, upstreamOptions);
  let service;
  try { service = await startSellerService({ ...options, config: application.service, handlers: application.handlers }); }
  catch (error) { await application.close(); throw error; }
  let closing;
  return Object.freeze({
    ...service, manifest: application.manifest, snapshot: application.snapshot,
    close: () => closing ??= (async () => {
      try { await service.close(); } finally { await application.close(); }
    })(),
  });
}
