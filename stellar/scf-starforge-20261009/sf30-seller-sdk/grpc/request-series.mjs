// MIT. Finite client request sequences retain the original native protobuf values.
import { normalizeGrpcRequest, serializeGrpcRequest, grpcMethodSchema } from './values.mjs';
import { validateGrpcLimits } from './config.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const seriesPath = 'request["messages"]';
const emptySeriesJsonBytes = Buffer.byteLength('{"messages":[]}');

function invalid(path, message, code = 'grpc_request_invalid') {
  const error = new Error(path + ': ' + message);
  error.code = code;
  error.field_path = path;
  if (code !== 'grpc_request_invalid') error.status = 413;
  throw error;
}
function requireValue(ok, path, message) {
  if (!ok) invalid(path, message);
}
function requireSize(value, maximum, path, description, code) {
  if (value > maximum) invalid(path, description + ' exceeds ' + maximum + ' bytes', code);
}
function methodFor(contract, methodPath) {
  const method = contract?.methods?.[methodPath];
  if (!method) {
    const error = new Error('Choose an original method from the captured gRPC service inventory.');
    error.code = 'grpc_method_unknown';
    throw error;
  }
  return method;
}
function streamLimits(limits) {
  if (limits.requestStream === undefined) {
    const error = new Error('Configure the finite request stream limits for this original method.');
    error.code = 'GRPC_REQUEST_STREAM_LIMITS_REQUIRED';
    throw error;
  }
  return limits.requestStream;
}
function indexed(error, prefix) {
  if (typeof error?.field_path === 'string' &&
      (error.field_path === 'request' || error.field_path.startsWith('request['))) {
    const previous = error.field_path;
    error.field_path = prefix + previous.slice('request'.length);
    if (typeof error.message === 'string' && error.message.startsWith(previous))
      error.message = error.field_path + error.message.slice(previous.length);
  }
  throw error;
}
function normalizeMessage(contract, methodPath, input, prefix = null) {
  try { return normalizeGrpcRequest(contract, methodPath, input); }
  catch (error) { if (prefix) indexed(error, prefix); throw error; }
}
function serializeMessage(contract, methodPath, value, prefix = null) {
  try { return serializeGrpcRequest(contract, methodPath, value); }
  catch (error) { if (prefix) indexed(error, prefix); throw error; }
}
function selectedMessages(input, maximum) {
  requireValue(plain(input), 'request', 'expected the closed messages object');
  const keys = Reflect.ownKeys(input);
  requireValue(keys.length === 1 && keys[0] === 'messages', 'request',
    'a request stream accepts only the messages field');
  const field = Object.getOwnPropertyDescriptor(input, 'messages');
  requireValue(field && own(field, 'value') && field.enumerable, seriesPath,
    'messages must be an ordinary JSON field');
  const messages = field.value;
  requireValue(Array.isArray(messages), seriesPath, 'expected an array');
  if (messages.length > maximum)
    invalid(seriesPath, 'the request sequence exceeds ' + maximum + ' messages', 'GRPC_REQUEST_STREAM_MESSAGE_LIMIT_EXCEEDED');
  // Read data properties by index: a getter, sparse slot, symbol, or extra
  // array property cannot silently become a different sequence on the wire.
  for (const key of Reflect.ownKeys(messages)) {
    if (key === 'length') continue;
    requireValue(typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key) &&
      Number(key) < messages.length && Number.isSafeInteger(Number(key)),
      seriesPath, 'the messages array contains a non-index field');
    const descriptor = Object.getOwnPropertyDescriptor(messages, key);
    requireValue(own(descriptor, 'value') && descriptor.enumerable,
      seriesPath + '[' + key + ']', 'a message must be an ordinary array value');
  }
  for (let index = 0; index < messages.length; index++)
    requireValue(own(messages, index), seriesPath + '[' + index + ']',
      'a request sequence cannot contain an empty array slot');
  return messages;
}

/** Normalize and size one complete operation; application transport remains the native owner's. */
export function prepareGrpcInput(contract, methodPath, input, { limits: configuredLimits } = {}) {
  const method = methodFor(contract, methodPath);
  const limits = validateGrpcLimits(configuredLimits);
  if (!method.requestStream) {
    const value = normalizeMessage(contract, methodPath, input);
    const requestJsonBytes = Buffer.byteLength(JSON.stringify(value));
    requireSize(requestJsonBytes, limits.maxJsonRequestBytes, 'request', 'the JSON request', 'GRPC_JSON_REQUEST_TOO_LARGE');
    const requestBytes = serializeMessage(contract, methodPath, value).length;
    requireSize(requestBytes, limits.maxRequestBytes, 'request', 'the protobuf request', 'GRPC_REQUEST_TOO_LARGE');
    return { value, messages: [value], requestBytes, requestJsonBytes, requestStream: false };
  }

  const stream = streamLimits(limits);
  const selected = selectedMessages(input, stream.maxMessages);
  // An empty sequence still requires an actual compiled native method. No
  // required message field is fabricated just to close a client stream.
  if (!selected.length) grpcMethodSchema(contract, methodPath);
  const messages = [];
  let requestBytes = 0, requestJsonBytes = emptySeriesJsonBytes;
  requireSize(requestJsonBytes, limits.maxJsonRequestBytes, 'request', 'the complete JSON request', 'GRPC_JSON_REQUEST_TOO_LARGE');
  for (let index = 0; index < selected.length; index++) {
    const prefix = seriesPath + '[' + index + ']';
    const value = normalizeMessage(contract, methodPath,
      Object.getOwnPropertyDescriptor(selected, String(index)).value, prefix);
    requestJsonBytes += Buffer.byteLength(JSON.stringify(value)) + (index ? 1 : 0);
    requireSize(requestJsonBytes, limits.maxJsonRequestBytes, prefix, 'the complete JSON request', 'GRPC_JSON_REQUEST_TOO_LARGE');
    const size = serializeMessage(contract, methodPath, value, prefix).length;
    requireSize(size, limits.maxRequestBytes, prefix, 'the protobuf message', 'GRPC_REQUEST_TOO_LARGE');
    requestBytes += size;
    requireSize(requestBytes, stream.maxBytes, prefix, 'the summed protobuf request payloads', 'GRPC_REQUEST_STREAM_BYTE_LIMIT_EXCEEDED');
    messages.push(value);
  }
  return { value: { messages }, messages, requestBytes, requestJsonBytes, requestStream: true };
}

/** Describe the original message and a finite ordered operation without changing its codec. */
export function grpcOperationSchema(contract, methodPath, { limits: configuredLimits } = {}) {
  const native = grpcMethodSchema(contract, methodPath);
  if (!native.method.request_stream) return native;
  const limits = validateGrpcLimits(configuredLimits), stream = streamLimits(limits);
  const requestMessage = native.request;
  const items = { ...requestMessage };
  // Native local references address the message's root $defs. Hoisting that
  // same map keeps recursive messages, enums and precise scalar/map constraints
  // valid from messages.items; the full original schema is retained separately.
  delete items.$defs;
  delete items.$schema;
  delete items.$id;
  const request = {
    ...(requestMessage.$schema ? { $schema: requestMessage.$schema } : {}),
    type: 'object',
    properties: {
      messages: {
        type: 'array', items, minItems: 0, maxItems: stream.maxMessages,
        description: 'Original protobuf messages in send order. An empty array half-closes without sending a message.',
      },
    },
    required: ['messages'], additionalProperties: false,
    ...(requestMessage.$defs ? { $defs: requestMessage.$defs } : {}),
  };
  return {
    ...native, request, requestMessage,
    requestSeries: {
      schema: 'stellar-forge.grpc-request-series.v1',
      field: 'messages', ordered: true, emptyAllowed: true,
      completion: 'client-half-close-after-last-message',
      maxMessages: stream.maxMessages,
      maxBytes: stream.maxBytes,
      maxMessageBytes: limits.maxRequestBytes,
      maxJsonRequestBytes: limits.maxJsonRequestBytes,
      byteMeaning: 'Sum of original serialized protobuf message payloads; transport framing is excluded.',
      jsonByteMeaning: 'UTF-8 JSON bytes of the complete normalized messages operation.',
    },
  };
}
