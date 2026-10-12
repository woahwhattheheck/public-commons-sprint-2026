// MIT. Python merchant declarations compile into the ORIGINAL SF30 service.
import { readFile, stat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateHeaderValue } from 'node:http';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../seller.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { createLiveRequestAdmission } from '../../sf89-live-request-admission/index.mjs';
import { validateBazaarExtension } from '../../../../stellar-forge/payment-auto-catalog/schema-validation.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const scalarTypes = new Set(['string', 'number', 'integer', 'boolean']);
export class PythonInputError extends Error {
  constructor(code = 'PYTHON_INPUT_INVALID') { super(code); this.code = code; }
}
function bound(value, low, high, label) {
  if (!Number.isInteger(value) || value < low || value > high) throw new TypeError(`Invalid ${label}`);
  return value;
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}

/** No function is imported or executed during declaration compilation. */
export function compilePythonMerchant(input, { baseDir = process.cwd() } = {}) {
  if (!object(input) || input.schema !== 'stellar-forge.python-merchant.v1' ||
      !object(input.functions) || Object.keys(input.functions).length < 1 || Object.keys(input.functions).length > 64)
    throw new TypeError('Expected python-merchant.v1 with 1–64 functions');
  if (typeof input.application !== 'string' || !input.application.endsWith('.py') || input.application.includes('\0'))
    throw new TypeError('application must name a trusted local Python module');
  const executable = input.python ?? 'python3';
  if (typeof executable !== 'string' || !executable || executable.startsWith('-') || /[\x00-\x1f]/.test(executable))
    throw new TypeError('python must name an executable, without command arguments');
  const origin = new URL(input.publicOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new TypeError('publicOrigin requires an HTTPS origin');
  const environment = input.environment ?? [];
  if (!Array.isArray(environment) || environment.length > 64 || new Set(environment).size !== environment.length ||
      environment.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)))
    throw new TypeError('environment must list unique environment variable names');
  const lifecycle = input.lifecycle ?? {};
  if (!object(lifecycle) || Object.keys(lifecycle).some(key => !['startup', 'shutdown'].includes(key)) ||
      Object.values(lifecycle).some(value => typeof value !== 'string' || !name.test(value) || reserved.has(value)) ||
      Object.values(lifecycle).some(value => Object.hasOwn(input.functions, value)))
    throw new TypeError('lifecycle names startup/shutdown hooks separately from public functions');
  const options = {
    application: resolve(baseDir, input.application), executable,
    environment: [...environment],
    workerCount: bound(input.workerCount ?? 1, 1, 8, 'workerCount (1–8)'),
    maxPending: bound(input.maxPending ?? 32, 1, 256, 'maxPending (1–256)'),
    startupTimeoutMs: bound(input.startupTimeoutMs ?? 10000, 100, 30000, 'startupTimeoutMs'),
    shutdownTimeoutMs: bound(input.shutdownTimeoutMs ?? 5000, 100, 30000, 'shutdownTimeoutMs'),
    lifecycle: { ...lifecycle },
  };
  const functions = Object.create(null), routes = [];
  for (const [id, raw] of Object.entries(input.functions)) {
    if (!name.test(id) || reserved.has(id) || !object(raw) || !['GET', 'HEAD', 'POST'].includes(raw.method))
      throw new TypeError('Every function needs a public Python name and GET, HEAD or POST method');
    if (typeof raw.path !== 'string' || !/^\/[A-Za-z0-9_.~/-]+$/.test(raw.path) || raw.path.includes('//') ||
        raw.path.startsWith('/_seller/') || new URL(raw.path, origin).pathname !== raw.path)
      throw new TypeError('Every function requires a fixed canonical resource path');
    const schema = structuredClone(raw.inputSchema);
    if (!object(schema) || schema.type !== 'object' || !object(schema.properties) || schema.additionalProperties !== false ||
        Object.keys(schema.properties).length > 32 || !object(raw.example))
      throw new TypeError('inputSchema requires an explicit object, properties, additionalProperties:false and example');
    if (Object.keys(schema.properties).some(key => !name.test(key) || reserved.has(key)))
      throw new TypeError('Unsupported input field name');
    if (raw.method !== 'POST' && Object.values(schema.properties).some(spec => !object(spec) || !scalarTypes.has(spec.type)))
      throw new TypeError('Query inputs require scalar string, number, integer or boolean types');
    const output = raw.output ?? { format: 'json' };
    if (!object(output) || !['json', 'bytes'].includes(output.format)) throw new TypeError('output.format must be json or bytes');
    const contentType = output.contentType ?? (output.format === 'json' ? 'application/json; charset=utf-8' : 'application/octet-stream');
    if (typeof contentType !== 'string' || contentType.length > 160 || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?$/.test(contentType))
      throw new TypeError('Invalid output contentType');
    validateHeaderValue('content-type', contentType);
    if (output.format === 'json' && !/^application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json(?:;|$)/.test(contentType))
      throw new TypeError('JSON outputs require a JSON media type');
    const offer = compileHttpSellerOffer({
      url: origin.origin + raw.path, method: raw.method,
      description: raw.description, serviceName: input.serviceName ?? 'Python Merchant',
      ...(input.tags ? { tags: input.tags } : {}), payment: raw.payment,
      ...(raw.method === 'POST' ? { bodyType: 'json', body: raw.example } : {}),
    });
    const extension = offer.extensions.bazaar, field = raw.method === 'POST' ? 'body' : 'queryParams';
    extension.info.input[field] = structuredClone(raw.example);
    extension.schema.properties.input.properties[field] = schema;
    if (!extension.schema.properties.input.required.includes(field)) extension.schema.properties.input.required.push(field);
    extension.info.output = { type: output.format === 'json' ? 'json' : contentType.startsWith('text/') ? 'text' : 'binary' };
    extension.schema.properties.output = { type: 'object', properties: { type: { const: extension.info.output.type } }, required: ['type'], additionalProperties: false };
    offer.resource.mimeType = contentType;
    const checked = validateBazaarExtension(extension);
    if (!checked.ok) throw new TypeError(`Input example/schema rejected for ${id}: ${checked.reason}`);
    paymentRequiredResponse(offer);
    functions[id] = {
      id, method: raw.method, inputSchema: schema, example: structuredClone(raw.example), offer,
      output: { format: output.format, contentType },
      maxInputBytes: bound(raw.maxInputBytes ?? 262144, 1, 524288, 'maxInputBytes'),
      maxOutputBytes: bound(raw.maxOutputBytes ?? 524288, 1, 1048576, 'maxOutputBytes'),
      timeoutMs: bound(raw.timeoutMs ?? 10000, 50, 120000, 'timeoutMs'),
    };
    routes.push({ id, path: raw.path, offer, handler: id, admit: id + 'Admission', validateInput: true });
  }
  const service = { schema: 'stellar-forge.seller-service.v1', publicOrigin: origin.origin, routes };
  compileSellerRoutes(routes.map(route => ({ id: route.id, offer: route.offer, handler: () => {} })));
  return deepFreeze({ options, functions, service });
}

export async function readPythonMerchant(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 1048576) throw new TypeError('Merchant config must be a JSON file up to 1 MiB');
  const bytes = await readFile(path);
  if (bytes.length > 1048576) throw new TypeError('Merchant config exceeds 1 MiB');
  const compiled = compilePythonMerchant(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), { baseDir: dirname(resolve(path)) });
  const application = await realpath(compiled.options.application);
  if (!(await stat(application)).isFile()) throw new TypeError('application must be a regular file');
  return compiled;
}

/** Use original SF89/SF25 validation and preserve declared JSON types to Python. */
export function inputBinder(definition) {
  const admit = createLiveRequestAdmission(definition.offer);
  return context => {
    if (admit(context) !== true) throw new PythonInputError();
    const source = definition.method === 'POST' ? context.body : context.query;
    let values;
    if (definition.method === 'POST') values = structuredClone(source);
    else values = Object.fromEntries(Object.entries(source).map(([key, value]) => {
      const type = definition.inputSchema.properties[key].type;
      return [key, type === 'boolean' ? value === 'true' : type === 'number' || type === 'integer' ? Number(value) : value];
    }));
    if (Buffer.byteLength(JSON.stringify(values)) > definition.maxInputBytes) throw new PythonInputError('PYTHON_INPUT_TOO_LARGE');
    return values;
  };
}
