// MIT. Bounded chunks extend the original merchant customer listener.
import { UPLOAD_PATH, CHUNK_BYTES, MAX_PLAN_BYTES, fileTokenHash } from './protocol.mjs';
import { need, problem } from '../intake/protocol.mjs';

const route = new RegExp('^' + UPLOAD_PATH + '(?:/([a-f0-9]{64})(?:/(seal|chunks/([0-9]+)))?)?$');
export const isInputRoute = path => typeof path === 'string' && route.test(path);
function claim(request) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index].toLowerCase() === 'x-sfjobs-token') count++;
  need(count === 1, 'JOB_INPUT_CLAIM_REQUIRED', 404);
  const token = request.headers['x-sfjobs-token']; fileTokenHash(token); return token;
}
export async function readInputChunk(request) {
  need(/^application\/octet-stream$/i.test(request.headers['content-type'] ?? ''),
    'JOB_INPUT_CHUNK_CONTENT_TYPE_REQUIRED', 415);
  need(!request.headers['content-encoding'], 'JOB_INPUT_CONTENT_ENCODING_REJECTED', 415);
  const declared = request.headers['content-length'];
  need(declared === undefined || /^[0-9]+$/.test(declared) && Number(declared) <= CHUNK_BYTES,
    'JOB_INPUT_CHUNK_TOO_LARGE', 413);
  const chunks = []; let total = 0;
  for await (const chunk of request) {
    total += chunk.length; need(total <= CHUNK_BYTES, 'JOB_INPUT_CHUNK_TOO_LARGE', 413); chunks.push(chunk);
  }
  need(declared === undefined || Number(declared) === total, 'JOB_INPUT_CHUNK_LENGTH_CHANGED');
  return Buffer.concat(chunks, total);
}
export async function handleInputRoute({ inputs, request, respond, jsonBody, accessToken, signal }) {
  need(inputs, 'JOB_INPUT_FUNCTION_FILES_NOT_CONFIGURED', 404);
  const match = route.exec(request.url ?? ''); need(match, 'JOB_INPUT_ROUTE_NOT_FOUND', 404);
  const [, id, action, rawIndex] = match, token = claim(request);
  if (!id) {
    need(request.method === 'POST', 'JOB_INPUT_METHOD_REJECTED', 405);
    respond(200, await inputs.begin(await jsonBody(request, MAX_PLAN_BYTES + 512), { token, accessToken }));
  } else if (!action && ['GET', 'HEAD'].includes(request.method)) {
    need(!request.headers['transfer-encoding'] && Number(request.headers['content-length'] ?? 0) === 0,
      'JOB_INPUT_BODY_REJECTED');
    respond(200, inputs.status(id, token));
  } else if (!action && request.method === 'DELETE') {
    const value = await jsonBody(request, 4096);
    respond(200, await inputs.discard({ id, token, expectedRevision: value.expectedRevision }));
  } else if (action === 'seal' && request.method === 'POST') {
    const value = await jsonBody(request, 4096);
    need(value && Object.keys(value).length === 0, 'JOB_INPUT_SEAL_BODY_INVALID');
    respond(200, await inputs.finish({ id, token, signal }));
  } else if (rawIndex !== undefined && request.method === 'PUT') {
    need(/^(0|[1-9][0-9]{0,4})$/.test(rawIndex), 'JOB_INPUT_CHUNK_INDEX_INVALID');
    respond(200, await inputs.writeChunk({ id, token, index: Number(rawIndex), body: await readInputChunk(request), signal }));
  } else throw problem('JOB_INPUT_METHOD_REJECTED', 405);
  return true;
}
