// MIT. Product controls on the original private seller operations listener.
import { randomBytes, timingSafeEqual } from 'node:crypto';

const BASE = '/api/availability';
const MAX_BYTES = 32768;
const error = (code, status = 400) => Object.assign(new Error(code), { code, status });
const same = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

function readChange(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
    throw error('AVAILABILITY_JSON_REQUIRED', 415);
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
    throw error('AVAILABILITY_INPUT_TOO_LARGE', 413);
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks = [];
    const finish = (failure, value) => {
      if (done) return;
      done = true; clearTimeout(timer); chunks.length = 0;
      req.removeListener('data', data); req.removeListener('end', end);
      req.removeListener('aborted', interrupted); req.removeListener('error', interrupted);
      if (failure) { req.resume(); reject(failure); } else resolve(value);
    };
    const interrupted = () => finish(error('AVAILABILITY_INPUT_INTERRUPTED'));
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_BYTES) return finish(error('AVAILABILITY_INPUT_TOO_LARGE', 413));
      chunks.push(chunk);
    };
    const end = () => {
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { finish(error('AVAILABILITY_JSON_INVALID')); }
    };
    const timer = setTimeout(() => finish(error('AVAILABILITY_INPUT_TIMEOUT', 408)), 5000).unref();
    req.on('data', data); req.once('end', end);
    req.once('aborted', interrupted); req.once('error', interrupted);
  });
}

export function createAvailabilityDesk(control) {
  const available = Boolean(control && typeof control.snapshot === 'function' && typeof control.update === 'function');
  const token = available ? randomBytes(32).toString('hex') : null;
  const pending = new Set();
  let closing = false;
  const snapshot = () => available ? { ...control.snapshot(), controlsEnabled: true, maxChangeBytes: MAX_BYTES } : {
    schema: 'stellar-forge.seller-availability.v1', available: false, controlsEnabled: false,
    message: 'Start the original seller with --availability-dir and an absolute private directory.',
  };
  async function respond(req, origins) {
    if (closing) throw error('AVAILABILITY_CONSOLE_CLOSING', 503);
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.search) throw error('AVAILABILITY_QUERY_INVALID');
    if (url.pathname === BASE + '/change') {
      if (req.method !== 'POST') return { status: 405, body: { error: 'AVAILABILITY_POST_REQUIRED' }, headers: { allow: 'POST' } };
      if (!available) throw error('AVAILABILITY_NOT_CONFIGURED', 409);
      if (!origins.has(req.headers.origin) || !same(req.headers['x-merchant-availability-token'], token))
        throw error('AVAILABILITY_CONTROL_TOKEN_REQUIRED', 403);
      await control.update(await readChange(req));
      return { status: 200, body: snapshot() };
    }
    if (![BASE, BASE + '/export'].includes(url.pathname)) throw error('AVAILABILITY_ROUTE_NOT_FOUND', 404);
    if (!['GET', 'HEAD'].includes(req.method))
      return { status: 405, body: { error: 'AVAILABILITY_READ_ONLY' }, headers: { allow: 'GET, HEAD' } };
    return { status: 200, body: snapshot(), ...(url.pathname.endsWith('/export') ? {
      headers: { 'content-disposition': 'attachment; filename="merchant-product-availability.json"' },
    } : {}) };
  }
  return Object.freeze({
    controlFragment: token,
    accepts: url => typeof url === 'string' && (url === BASE || url.startsWith(BASE + '/') || url.startsWith(BASE + '?')),
    dispatch(req, origins) {
      const operation = respond(req, origins).catch(failure => ({
        status: Number.isInteger(failure.status) && failure.status >= 400 && failure.status <= 599 ? failure.status : 503,
        body: { error: /^AVAILABILITY_[A-Z_]+$/.test(failure.code ?? '') ? failure.code : 'AVAILABILITY_STATE_UNAVAILABLE' },
      }));
      pending.add(operation); operation.finally(() => pending.delete(operation));
      return operation;
    },
    async close() { closing = true; await Promise.allSettled([...pending]); },
  });
}
