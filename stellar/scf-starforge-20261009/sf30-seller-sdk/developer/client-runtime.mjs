// MIT. Customer request binding. Generated clients inline the original request builder.
import { buildUnpaidRequest } from './request.mjs';

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAX_ATOMIC = '170141183460469231731687303715884105727';
const requestKeys = new Set(['path', 'query', 'body', 'multipart', 'omitBody']);
const authorizationKeys = new Set(['intentId', 'maxAtomic', 'acceptIndex', 'paymentFlow', 'approve', 'sign', 'signal']);
const clientJsonMethods = new Set(['POST', 'PUT', 'PATCH']);

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

// JSON.stringify alone silently changes NaN/undefined and invokes custom toJSON.
// Accept JSON values only, then let the original request builder enforce byte size.
function encodeJsonBody(value) {
  const ancestors = new Set();
  let nodes = 0;
  const visit = (node, depth) => {
    if (++nodes > 200000 || depth > 64) throw new RangeError('JSON body is too complex');
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) throw new TypeError('JSON body numbers must be finite');
      return;
    }
    if (typeof node !== 'object') throw new TypeError('JSON body cannot contain undefined, functions, symbols or bigint');
    if (ancestors.has(node)) throw new TypeError('JSON body cannot contain cycles');
    const array = Array.isArray(node);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(node)))
      throw new TypeError('JSON body objects must be ordinary JSON records');
    if (Reflect.ownKeys(node).some(key => typeof key === 'symbol'))
      throw new TypeError('JSON body cannot contain symbol keys');
    ancestors.add(node);
    const descriptors = Object.getOwnPropertyDescriptors(node);
    if (array) {
      if (Object.keys(node).some(key => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= node.length))
        throw new TypeError('JSON arrays cannot carry extra properties');
      for (let index = 0; index < node.length; index++) {
        const descriptor = descriptors[index];
        if (!descriptor || !has(descriptor, 'value')) throw new TypeError('JSON arrays must contain explicit values');
        visit(descriptor.value, depth + 1);
      }
    } else {
      for (const descriptor of Object.values(descriptors)) {
        if (!descriptor.enumerable || !has(descriptor, 'value'))
          throw new TypeError('JSON body properties must be enumerable data values');
        visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(node);
  };
  visit(value, 0);
  return JSON.stringify(value);
}

function validateAuthorization(authorization) {
  if (!isRecord(authorization) || Object.keys(authorization).some(key => !authorizationKeys.has(key)))
    throw new TypeError('Use explicit intentId, maxAtomic, optional acceptIndex/paymentFlow and buyer callbacks/signal');
  const { intentId, maxAtomic } = authorization;
  if (typeof intentId !== 'string' || !intentId.trim() || intentId.length > 160 || /[\x00-\x1f\x7f]/.test(intentId))
    throw new TypeError('A stable printable intentId of 1–160 characters is required');
  if (typeof maxAtomic !== 'string' || maxAtomic.length > MAX_ATOMIC.length ||
      !/^(0|[1-9][0-9]*)$/.test(maxAtomic) ||
      (maxAtomic.length === MAX_ATOMIC.length && maxAtomic > MAX_ATOMIC))
    throw new TypeError('maxAtomic must be an explicit canonical Stellar i128 atomic-unit string');
  for (const key of ['approve', 'sign']) {
    if (has(authorization, key) && typeof authorization[key] !== 'function')
      throw new TypeError(`${key} must be an existing buyer callback`);
  }
  if (has(authorization,'paymentFlow') && !['authorization','upfront'].includes(authorization.paymentFlow))
    throw new TypeError('paymentFlow must be authorization or explicitly upfront');
  if (has(authorization, 'signal') && authorization.signal !== undefined &&
      (typeof authorization.signal?.aborted !== 'boolean' || typeof authorization.signal?.addEventListener !== 'function'))
    throw new TypeError('signal must be an AbortSignal');
}

/** Bind API calls to one immutable original seller snapshot; performs no network I/O. */
export function createClientRuntime(originalSnapshot) {
  const snapshot = freezeTree(structuredClone(originalSnapshot));
  const { schema, sourceSha256, mode, title, origin } = snapshot;
  if (schema !== 'stellar-forge.seller-client.v1' || !Array.isArray(snapshot.operations))
    throw new TypeError('A generated seller client snapshot is required');
  const source = Object.freeze({ schema, sourceSha256, mode, title, origin });
  const operations = snapshot.operations;
  const byId = new Map(operations.map(operation => [operation.id, operation]));

  function buildRequest(operationId, inputs, authorization) {
    const operation = byId.get(operationId);
    if (!operation) throw new TypeError('Unknown seller operation: ' + String(operationId));
    if (!isRecord(inputs) || Object.keys(inputs).some(key => !requestKeys.has(key)))
      throw new TypeError('Request inputs use path, query and the declared JSON or multipart body');
    validateAuthorization(authorization);
    const path = inputs.path ?? {};
    if (!isRecord(path) || Object.keys(path).some(key => !operation.pathNames.includes(key)))
      throw new TypeError('Path values must use only this operation’s declared parameter names');
    if (operation.pathNames.some(name => !has(path, name)))
      throw new TypeError('Every declared path parameter needs an explicit value');
    const bodyMethod = clientJsonMethods.has(operation.method);
    if (!bodyMethod && ['body','multipart','omitBody'].some(key=>has(inputs,key)))
      throw new TypeError('GET, HEAD and DELETE operations cannot contain a body');
    const form=operation.offer.extensions?.bazaar?.info?.input?.bodyType==='form-data';
    if (has(inputs,'omitBody')&&typeof inputs.omitBody!=='boolean') throw new TypeError('omitBody must be an explicit boolean');
    if (bodyMethod&&inputs.omitBody!==true&&!has(inputs,form?'multipart':'body')) throw new TypeError('Supply the declared request body or explicitly omit an optional body');
    if (form&&has(inputs,'body')||!form&&has(inputs,'multipart')||inputs.omitBody===true&&(has(inputs,'body')||has(inputs,'multipart')))
      throw new TypeError('Choose one declared body representation');
    const options = operation.offer.accepts;
    if (options.length > 1 && !has(authorization, 'acceptIndex'))
      throw new TypeError('Explicit acceptIndex required for a seller with multiple payment options');
    const index = has(authorization, 'acceptIndex') ? authorization.acceptIndex : 0;
    if (!Number.isSafeInteger(index) || index < 0 || index >= options.length)
      throw new TypeError('acceptIndex must select an original advertised payment option');
    const request = buildUnpaidRequest({
      'x-seller-route': { id: operation.id, method: operation.method, path: operation.path,maxRequestBytes:operation.maxRequestBytes },
      'x-x402-payment-required': operation.offer,
      requestBody:{required:operation.bodyRequired??true},
      parameters: (operation.requiredQuery ?? []).map(name => ({ name, in: 'query', required: true })),
    }, { path, query: inputs.query ?? {},
      ...(bodyMethod ? inputs.omitBody===true?{omitBody:true}:form?{multipart:inputs.multipart}:{body:encodeJsonBody(inputs.body)} : {}),
    }, origin);
    const terms = options[index];
    const paymentFlow = authorization.paymentFlow ?? 'authorization';
    if ((terms.extra?.paymentFlow ?? 'authorization') !== paymentFlow)
      throw new TypeError('Explicit buyer paymentFlow must match the selected original offer');
    const result = {
      intentId: authorization.intentId,
      url: request.publicUrl, method: operation.method,
      headers: Object.freeze({ ...request.init.headers }),
      ...(has(request.init, 'body') ? { body: request.init.body } : {}),
      expect: Object.freeze({ scheme: terms.scheme, network: terms.network,
        asset: terms.asset, payTo: terms.payTo, maxAtomic: authorization.maxAtomic,
        maxTimeoutSeconds: terms.maxTimeoutSeconds, paymentFlow }),
    };
    for (const key of ['approve', 'sign', 'signal']) if (has(authorization, key)) result[key] = authorization[key];
    return Object.freeze(result);
  }

  function createSellerClient({ buyer } = {}) {
    if (!buyer || typeof buyer.call !== 'function') throw new TypeError('An existing buyer with call() is required');
    return Object.freeze({ source, operations, request: buildRequest,
      call(operationId, inputs, authorization) {
        // Keep the original buyer's receiver, result, errors and retry policy intact.
        return buyer.call(buildRequest(operationId, inputs, authorization));
      },
    });
  }
  return Object.freeze({ source, operations, buildRequest, createSellerClient });
}
