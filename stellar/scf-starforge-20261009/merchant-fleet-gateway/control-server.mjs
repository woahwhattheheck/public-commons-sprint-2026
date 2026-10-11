// MIT. Capability-protected operations on the gateway's EXISTING admin listener.
import { timingSafeEqual } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const singleHeader = (req, name) => {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i].toLowerCase() === name) count++;
  return count === 1 ? req.headers[name] : undefined;
};
const equal = (left, right) => typeof left === 'string' &&
  Buffer.byteLength(left) === Buffer.byteLength(right) &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));
const send = (res, status, value) => {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};
async function input(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(singleHeader(req, 'content-type') ?? ''))
    throw fail('FLEET_JSON_REQUIRED', 415);
  const chunks = []; let length = 0;
  const timer = setTimeout(() => req.destroy(), 5000);
  try {
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 16 * 1024) throw fail('FLEET_CONTROL_BODY_LIMIT', 413);
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw fail('FLEET_JSON_INVALID'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('FLEET_OBJECT_REQUIRED');
    return body;
  } finally { clearTimeout(timer); }
}

export function createFleetControl({ rollout, store, url }) {
  return async (req, res) => {
    try {
      if (!store) {
        if (req.method !== 'GET' || req.url !== '/_fleet/health')
          return send(res, 404, { error: 'ADMIN_ROUTE_NOT_FOUND' });
        return send(res, 200, rollout.status());
      }
      const origin = url();
      if (singleHeader(req, 'host') !== new URL(origin).host ||
          req.headers.origin !== undefined && singleHeader(req, 'origin') !== origin ||
          req.headers['sec-fetch-site'] !== undefined &&
          !['same-origin', 'none'].includes(singleHeader(req, 'sec-fetch-site')))
        throw fail('FLEET_CONTROL_ORIGIN_REJECTED', 403);
      if (!equal(singleHeader(req, 'authorization'), 'Bearer ' + store.token) ||
          !equal(singleHeader(req, 'x-fleet-instance'), store.instance))
        throw fail('FLEET_CONTROL_CAPABILITY_REQUIRED', 401);
      if (req.method === 'GET' && req.url === '/_fleet/health') return send(res, 200, rollout.status());
      if (req.method !== 'POST' || !['/_fleet/prepare', '/_fleet/activate', '/_fleet/rollback'].includes(req.url))
        throw fail('ADMIN_ROUTE_NOT_FOUND', 404);
      const body = await input(req);
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)
        throw fail('FLEET_EXPECTED_REVISION_REQUIRED');
      let result;
      if (req.url === '/_fleet/prepare') {
        if (typeof body.manifestPath !== 'string' || body.manifestPath.length > 4096 ||
            !isAbsolute(body.manifestPath) || resolve(body.manifestPath) !== body.manifestPath)
          throw fail('FLEET_ABSOLUTE_MANIFEST_REQUIRED');
        result = await rollout.prepare(body.manifestPath, body.expectedRevision);
      } else if (req.url === '/_fleet/activate') {
        if (typeof body.candidateId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.candidateId))
          throw fail('FLEET_CANDIDATE_REQUIRED');
        result = await rollout.activate(body.candidateId, body.expectedRevision);
      } else {
        if (body.targetRevision !== undefined && (!Number.isSafeInteger(body.targetRevision) || body.targetRevision < 1))
          throw fail('FLEET_ROLLBACK_REVISION_INVALID');
        result = await rollout.rollback(body.expectedRevision, body.targetRevision);
      }
      send(res, 200, result);
    } catch (error) {
      send(res, error.status ?? 422, {
        error: error instanceof SyntaxError ? 'FLEET_JSON_INVALID' : String(error.message).slice(0, 512),
      });
    }
  };
}
