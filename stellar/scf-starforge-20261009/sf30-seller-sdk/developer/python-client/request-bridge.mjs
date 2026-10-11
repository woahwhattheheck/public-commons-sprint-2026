// MIT. Offline bridge to the ORIGINAL generated SF30 request implementation.
import { createHash } from 'node:crypto';
import { buildRequest, source, operations } from './seller-client.mjs';

const MAX_INPUT = 64 * 1024 * 1024;
const MAX_BODY = 16 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, name) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError(`Invalid ${name}`);
}

async function main() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT) throw new RangeError('Request input exceeds 64 MiB');
    chunks.push(chunk);
  }
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  keys(input, ['sourceSha256', 'operationId', 'inputs', 'authorization'], 'request envelope');
  if (input.sourceSha256 !== source.sourceSha256) throw new TypeError('Original seller source changed');
  keys(input.authorization, ['intentId', 'maxAtomic', 'acceptIndex', 'paymentFlow'], 'authorization');
  keys(input.inputs, ['path', 'query', 'body', 'multipart', 'omitBody'], 'inputs');
  if (Object.hasOwn(input.inputs, 'multipart')) {
    const part = input.inputs.multipart;
    keys(part, ['bodyBase64', 'contentType'], 'retained multipart body');
    if (typeof part.bodyBase64 !== 'string' || part.bodyBase64.length > Math.ceil(MAX_BODY / 3) * 4)
      throw new TypeError('Retain a complete multipart body up to 16 MiB');
    const body = Buffer.from(part.bodyBase64, 'base64');
    if (body.toString('base64') !== part.bodyBase64 || body.length > MAX_BODY)
      throw new TypeError('Multipart body must use canonical complete base64');
    input.inputs.multipart = { body, contentType: part.contentType };
  }
  const request = buildRequest(input.operationId, input.inputs, input.authorization);
  const operation = operations.find(value => value.id === input.operationId);
  const { body, ...configuration } = request;
  const bytes = body === undefined ? null : typeof body === 'string' ? Buffer.from(body, 'utf8')
    : body instanceof Uint8Array ? Buffer.from(body) : (() => { throw new TypeError('Unknown original body representation'); })();
  if (bytes !== null && bytes.length > MAX_BODY) throw new RangeError('Original body exceeds 16 MiB');
  process.stdout.write(JSON.stringify({ schema: 'stellar-forge.python-seller-request.v1',
    sourceSha256: source.sourceSha256, operationId: operation.id,
    acceptIndex: input.authorization.acceptIndex ?? 0, request: configuration,
    body: bytes === null ? null : { bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') } }) + '\n');
}
main().catch(error => {
  // Inputs, credentials, request bodies and stack traces are never echoed.
  process.stderr.write(JSON.stringify({ code: 'SELLER_REQUEST_INVALID', message: String(error.message) }) + '\n');
  process.exitCode = 1;
});
