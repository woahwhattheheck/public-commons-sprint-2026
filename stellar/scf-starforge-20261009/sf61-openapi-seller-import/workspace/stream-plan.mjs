// MIT. Merchant choices around the existing SF30 native stream policy.
import { compileUpstreamStreamPolicy } from '../../sf30-seller-sdk/upstream-stream.mjs';
import { DEFAULT_MAX_STREAM_BYTES } from '../../sf30-seller-sdk/stream-response.mjs';

const own = (value, key) => Object.hasOwn(value, key);
export const isMerchantStream = format => format === 'sse' || format === 'ndjson';

export function merchantPaymentRequirements(payment, amount) {
  const {paymentFlow, ...terms} = payment;
  if (own(payment, 'paymentFlow') && !['authorization', 'upfront'].includes(paymentFlow))
    throw new TypeError('Select authorization or upfront payment flow');
  return {scheme:'exact', ...terms, amount,
    ...(paymentFlow === undefined ? {} : {extra:{paymentFlow}})};
}

export function merchantStreamPolicy(row, method) {
  const format = row.responseMode ?? 'json';
  if (!['json', 'bytes', 'sse', 'ndjson'].includes(format))
    throw new TypeError('Select JSON, bytes, SSE or NDJSON response format');
  if (!isMerchantStream(format)) {
    if (own(row, 'stream')) throw new TypeError('Stream limits require SSE or NDJSON response format');
    return null;
  }
  if (method === 'HEAD') throw new TypeError('A HEAD response cannot carry a stream');
  if (own(row, 'cache') || own(row, 'idempotency'))
    throw new TypeError('Streaming uses one source per paid request; shared reads and durable POST responses require a complete response');
  if (row.responseValidation === 'declared' || row.enforceResponseContract === true)
    throw new TypeError('Streaming validates the declared media type and native framing; whole-response JSON validation requires JSON format');
  const policy = compileUpstreamStreamPolicy(row.stream, format);
  if (policy.maxBytes > DEFAULT_MAX_STREAM_BYTES)
    throw new TypeError('The compiled merchant stream limit is at most ' + DEFAULT_MAX_STREAM_BYTES + ' bytes');
  return policy;
}
