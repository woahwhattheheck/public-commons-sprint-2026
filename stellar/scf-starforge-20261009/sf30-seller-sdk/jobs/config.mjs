// MIT. Durable application jobs compile into the original SF30 seller and SF89 admission.
import { createHash } from 'node:crypto';
import { compileJobIntake } from './intake/config.mjs';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../seller.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { createLiveRequestAdmission } from '../../sf89-live-request-admission/index.mjs';
import { validateBazaarExtension } from '../../../../stellar-forge/payment-auto-catalog/schema-validation.mjs';

export const CONFIG_SCHEMA = 'stellar-forge.paid-jobs.v1';
export const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const jobError = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (code, status) => { throw jobError(code, status); };
const name = /^[A-Za-z][A-Za-z0-9_]{0,55}$/;
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
function integer(value, fallback, min, max, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) fail('JOB_CONFIG_' + label);
  return result;
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export function canonical(value) {
  let nodes = 0;
  function visit(input, depth) {
    if (++nodes > 100000 || depth > 48) fail('JOB_JSON_TOO_COMPLEX');
    if (input === null || ['string', 'boolean'].includes(typeof input)) return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) {
      if (Object.keys(input).length !== input.length) fail('JOB_JSON_REQUIRED');
      return input.map(item => visit(item, depth + 1));
    }
    if (!plain(input)) fail('JOB_JSON_REQUIRED');
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, visit(input[key], depth + 1)]));
  }
  return JSON.stringify(visit(value, 0));
}
function setBodySchema(offer, schema, example) {
  offer.extensions.bazaar.info.input.body = structuredClone(example);
  offer.extensions.bazaar.schema.properties.input.properties.body = structuredClone(schema);
  const checked = validateBazaarExtension(offer.extensions.bazaar);
  if (!checked.ok) {
    const reason = typeof checked.reason === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(checked.reason) ?
      checked.reason : 'SCHEMA_VALIDATION_FAILED';
    throw Object.assign(jobError('JOB_INPUT_SCHEMA_INVALID'), {
      message: 'Job input schema validation failed: ' + reason, details: { reason },
    });
  }
  paymentRequiredResponse(offer);
  return offer;
}

/** Configuration-only compilation; it never imports the trusted application. */
export function compileJobMerchant(input, { baseDir = process.cwd() } = {}) {
  if (!plain(input) || input.schema !== CONFIG_SCHEMA || !plain(input.functions) ||
      Object.keys(input.functions).length < 1 || Object.keys(input.functions).length > 64)
    fail('JOB_CONFIG_REQUIRED');
  if (typeof input.application !== 'string' || !input.application.endsWith('.mjs') || /[\x00-\x1f]/.test(input.application))
    fail('JOB_APPLICATION_MODULE_REQUIRED');
  let origin;
  try { origin = new URL(input.publicOrigin); } catch { fail('JOB_PUBLIC_ORIGIN_REQUIRED'); }
  if (origin.protocol !== 'https:' || origin.origin !== input.publicOrigin || origin.username || origin.password)
    fail('JOB_PUBLIC_ORIGIN_REQUIRED');
  const environment = input.environment ?? [];
  if (!Array.isArray(environment) || environment.length > 64 || new Set(environment).size !== environment.length ||
      environment.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)))
    fail('JOB_ENVIRONMENT_REFERENCES_REQUIRED');
  const functions = Object.create(null), routes = [], paths = new Set();
  for (const [id, raw] of Object.entries(input.functions)) {
    if (!name.test(id) || reserved.has(id) || !plain(raw)) fail('JOB_FUNCTION_INVALID');
    if (typeof raw.path !== 'string' || !/^\/[A-Za-z0-9_.~/-]+$/.test(raw.path) || raw.path.includes('//') ||
        raw.path.startsWith('/_seller/') || raw.path === '/jobs' || raw.path.startsWith('/jobs/') ||
        new URL(raw.path, origin).pathname !== raw.path || paths.has(raw.path)) fail('JOB_FUNCTION_PATH_INVALID');
    paths.add(raw.path);
    const schema = structuredClone(raw.inputSchema);
    if (!plain(schema) || schema.type !== 'object' || !plain(schema.properties) || schema.additionalProperties !== false ||
        Object.keys(schema.properties).length > 64 || !plain(raw.example) || Buffer.byteLength(canonical(schema)) > 24000)
      fail('JOB_INPUT_SCHEMA_REQUIRED');
    const output = raw.output ?? { format: 'json' };
    if (!plain(output) || !['json', 'bytes'].includes(output.format)) fail('JOB_OUTPUT_FORMAT_INVALID');
    const contentType = output.contentType ?? (output.format === 'json' ? 'application/json; charset=utf-8' : 'application/octet-stream');
    if (typeof contentType !== 'string' || contentType.length > 160 ||
        !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?$/.test(contentType) ||
        output.format === 'json' && !/^application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json(?:;|$)/.test(contentType))
      fail('JOB_OUTPUT_CONTENT_TYPE_INVALID');
    const filename = output.filename ?? (output.format === 'json' ? 'result.json' : 'result.bin');
    if (typeof filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(filename)) fail('JOB_OUTPUT_FILENAME_INVALID');
    // One complete selected payment option per function keeps each prepared job's
    // identity unambiguous before the native verifier receives a purchase.
    const definition = { url: origin.origin + raw.path, method: 'POST', description: raw.description,
      serviceName: input.serviceName ?? 'Application Jobs', ...(input.tags ? { tags: input.tags } : {}),
      payment: raw.payment, bodyType: 'json', body: { jobId: 'example-job' } };
    const purchaseOffer = compileHttpSellerOffer({ ...definition, queryParameters: [{
      name: 'sf98_order', type: 'string', description: 'Prepared job identifier', example: 'example-job', required: true,
    }] });
    const purchaseInput = purchaseOffer.extensions.bazaar.schema.properties.input;
    purchaseInput.properties.queryParams.properties.sf98_order = {
      type: 'string', pattern: JOB_ID.source, maxLength: 80,
    };
    if (!purchaseInput.required.includes('queryParams')) purchaseInput.required.push('queryParams');
    const offer = setBodySchema(purchaseOffer, {
      type: 'object', properties: { jobId: { type: 'string', pattern: JOB_ID.source, maxLength: 80 } },
      required: ['jobId'], additionalProperties: false,
    }, { jobId: 'example-job' });
    const inputOffer = setBodySchema(compileHttpSellerOffer({ ...definition, body: raw.example }), schema, raw.example);
    functions[id] = { id, path: raw.path, description: raw.description, inputSchema: schema,
      example: structuredClone(raw.example), offer, inputOffer, payment: structuredClone(offer.accepts[0]),
      timeoutMs: integer(raw.timeoutMs, 300000, 100, 3600000, 'TIMEOUT'),
      maxInputBytes: integer(raw.maxInputBytes, 262144, 1, 1048576, 'INPUT_LIMIT'),
      maxOutputBytes: integer(raw.maxOutputBytes, 8388608, 1, 67108864, 'OUTPUT_LIMIT'),
      output: { format: output.format, contentType, filename } };
    routes.push({ id, path: raw.path, offer, handler: id + 'Submit', admit: id + 'Admission', validateInput: true });
  }
  compileSellerRoutes(routes.map(route => ({ id: route.id, offer: route.offer, handler: () => {} })));
  const service = { schema: 'stellar-forge.seller-service.v1', publicOrigin: origin.origin, routes };
  return freeze({ schema: CONFIG_SCHEMA, application: resolve(baseDir, input.application),
    publicOrigin: origin.origin, serviceName: input.serviceName ?? 'Application Jobs', environment: [...environment],
    workerCount: integer(input.workerCount, 2, 1, 16, 'WORKER_COUNT'),
    maxPending: integer(input.maxPending, 128, 1, 10000, 'QUEUE_LIMIT'),
    maxJobs: integer(input.maxJobs, 10000, 1, 100000, 'JOB_LIMIT'),
    memoryLimitMb: integer(input.memoryLimitMb, 256, 32, 4096, 'WORKER_MEMORY'),
    intake: compileJobIntake(input.intake, functions), functions, service });
}

export async function readJobMerchant(configPath) {
  configPath = resolve(configPath);
  const info = await lstat(configPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) fail('JOB_CONFIG_FILE_REQUIRED');
  const bytes = await readFile(configPath);
  if (bytes.length > 1048576) fail('JOB_CONFIG_TOO_LARGE');
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const compiled = compileJobMerchant(raw, { baseDir: dirname(configPath) });
  const application = await realpath(compiled.application), appInfo = await lstat(application);
  if (!appInfo.isFile() || appInfo.size > 4194304) fail('JOB_APPLICATION_FILE_REQUIRED');
  const applicationBytes = await readFile(application);
  if (applicationBytes.length > 4194304) fail('JOB_APPLICATION_TOO_LARGE');
  const identity = { schema: 'stellar-forge.job-source.v1', configSha256: digest(bytes),
    applicationSha256: digest(applicationBytes), application, publicOrigin: compiled.publicOrigin };
  return { configPath, raw, compiled, identity, configSource: bytes.toString('utf8'), applicationSource: new TextDecoder('utf-8', { fatal: true }).decode(applicationBytes) };
}

export function validateJobInput(definition, input) {
  if (!plain(input)) fail('JOB_INPUT_REQUIRED');
  const bytes = Buffer.from(canonical(input));
  if (bytes.length > definition.maxInputBytes) fail('JOB_INPUT_TOO_LARGE', 413);
  const decision = createLiveRequestAdmission(definition.inputOffer)({ method: 'POST', query: {}, pathParams: {}, body: input });
  if (decision !== true) fail('JOB_INPUT_INVALID', 422);
  return { input: JSON.parse(bytes), inputSha256: digest(bytes) };
}
