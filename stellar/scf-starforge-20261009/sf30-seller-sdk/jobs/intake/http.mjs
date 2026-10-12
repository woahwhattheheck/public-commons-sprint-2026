// MIT. Routes mounted inside the existing merchant customer listener.
import { CATALOG_PATH, REQUEST_PATH, WITHDRAW_PATH, MAX_REQUEST_BYTES, need, problem } from './protocol.mjs';

export function isIntakeRoute(url) {
  return [CATALOG_PATH, REQUEST_PATH, WITHDRAW_PATH].includes(url);
}
function accessToken(request) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index].toLowerCase() === 'x-sfjobs-intake-token') count++;
  need(count <= 1, 'JOB_INTAKE_ACCESS_DENIED', 401);
  return request.headers['x-sfjobs-intake-token'];
}
async function body(request, maximum) {
  need(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''),
    'JOB_INTAKE_CONTENT_TYPE_REQUIRED', 415);
  need(!request.headers['content-encoding'], 'JOB_INTAKE_CONTENT_ENCODING_REJECTED', 415);
  const declared = request.headers['content-length'];
  need(declared === undefined || /^[0-9]+$/.test(declared) && Number(declared) <= maximum,
    'JOB_INTAKE_BODY_TOO_LARGE', 413);
  let total = 0; const chunks = [];
  for await (const chunk of request) {
    total += chunk.length; need(total <= maximum, 'JOB_INTAKE_BODY_TOO_LARGE', 413); chunks.push(chunk);
  }
  need(declared === undefined || Number(declared) === total, 'JOB_INTAKE_BODY_LENGTH_CHANGED');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))); }
  catch { throw problem('JOB_INTAKE_JSON_INVALID'); }
}
/** Caller owns host/origin checks, inflight capacity, no-store JSON and shutdown. */
export async function handleJobIntake({ intake, request, respond }) {
  if (!intake || !isIntakeRoute(request.url)) return false;
  if (request.url === CATALOG_PATH) {
    need(['GET', 'HEAD'].includes(request.method), 'JOB_INTAKE_METHOD_REJECTED', 405);
    need(!request.headers['transfer-encoding'] && Number(request.headers['content-length'] ?? 0) === 0,
      'JOB_INTAKE_BODY_REJECTED');
    respond(200, intake.catalog()); return true;
  }
  need(request.method === 'POST', 'JOB_INTAKE_METHOD_REJECTED', 405);
  if (request.url === REQUEST_PATH) {
    const input = await body(request, MAX_REQUEST_BYTES);
    const result = await intake.prepare(input, { accessToken: accessToken(request) });
    respond(result.handoff.created ? 201 : 200, result); return true;
  }
  respond(200, await intake.withdraw(await body(request, 4096))); return true;
}
