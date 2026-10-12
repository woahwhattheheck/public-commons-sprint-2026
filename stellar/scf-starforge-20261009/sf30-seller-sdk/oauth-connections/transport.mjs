// MIT. One source-selected OAuth POST with the original public-address policy.
import { createHash } from 'node:crypto';
import { lookup as systemLookup } from 'node:dns/promises';
import { request as httpRequest, Agent as HttpAgent } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isPublicAddress } from '../../sf31-buyer-client/public-transport.mjs';
import { fault } from '../postgres/publisher/files.mjs';
import { plain, endpoint, intuitQboProfile } from './profile.mjs';

export function oauthFailure(code, message, outcome = 'unknown', status = 502) {
  return Object.assign(fault(code, message, status), { outcome });
}
function credential(profile, env) {
  if (profile.authMethod === 'none') return { secret: null, identity: 'public' };
  const value = Object.hasOwn(env, profile.clientSecretEnv) ? env[profile.clientSecretEnv] : null;
  if (typeof value !== 'string' || !value || value.length > 16384 || !value.isWellFormed() || /[\x00-\x1f\x7f]/.test(value))
    throw oauthFailure('OAUTH_CONNECTION_CLIENT_SECRET_REQUIRED', 'The registered client secret is unavailable in its private host environment.', 'not_sent', 503);
  return { secret: value, identity: createHash('sha256').update(value).digest('hex') };
}
const formPart = value => new URLSearchParams({ x: value }).toString().slice(2);
function publicLookup(expectedHost, lookup) {
  return (host, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    Promise.resolve().then(async () => {
      if (host !== expectedHost) throw Error();
      const records = await lookup(host, { all: true, verbatim: true });
      if (!Array.isArray(records) || !records.length || records.length > 64 || records.some(item =>
        !item || ![4, 6].includes(item.family) || isIP(item.address) !== item.family || !isPublicAddress(item.address))) throw Error();
      const { address, family } = records[0];
      if (options?.all) callback(null, [{ address, family }]); else callback(null, address, family);
    }).catch(() => callback(oauthFailure('OAUTH_CONNECTION_DNS_REJECTED', 'The provider endpoint did not resolve to its approved public address.', 'not_sent')));
  };
}
const knownErrors = new Set(['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client',
  'unsupported_grant_type', 'invalid_scope', 'access_denied', 'temporarily_unavailable', 'server_error', 'unsupported_token_type']);
export async function oauthRequest(profile, mode, fields, {
  env = process.env, lookup = systemLookup, allowLoopback = false, signal, agent,
} = {}) {
  if (!['token', 'revoke'].includes(mode) || !plain(fields) || typeof lookup !== 'function')
    throw oauthFailure('OAUTH_CONNECTION_REQUEST_INVALID', 'Invalid private connection request.', 'not_sent', 400);
  const target = mode === 'token' ? profile.tokenEndpoint : profile.revocationEndpoint;
  if (!target) throw oauthFailure('OAUTH_CONNECTION_REVOCATION_UNAVAILABLE', 'This profile has no declared revocation endpoint.', 'not_sent', 400);
  endpoint(target, { allowLoopback });
  if (agent !== undefined && (!(agent instanceof HttpAgent) || agent.protocol !== new URL(target).protocol))
    throw oauthFailure('OAUTH_CONNECTION_REQUEST_INVALID', 'Use a trusted Node Agent for the selected provider protocol.', 'not_sent', 400);
  const selected = credential(profile, env), form = new URLSearchParams(), intuit = intuitQboProfile(profile);
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) form.append(key, item);
    else if (value !== undefined) form.set(key, value);
  }
  const headers = { accept: 'application/json', 'accept-encoding': 'identity', 'content-type': 'application/x-www-form-urlencoded' };
  if (profile.authMethod === 'client_secret_basic')
    headers.authorization = 'Basic ' + Buffer.from(intuit ? profile.clientId + ':' + selected.secret :
      formPart(profile.clientId) + ':' + formPart(selected.secret)).toString('base64');
  else {
    form.set('client_id', profile.clientId);
    if (profile.authMethod === 'client_secret_post') form.set('client_secret', selected.secret);
  }
  if (intuit && mode === 'token') headers['x-include-refresh-token-hard-expires-in'] = 'true';
  if (intuit && mode === 'revoke') headers['content-type'] = 'application/json';
  const body = Buffer.from(intuit && mode === 'revoke' ? JSON.stringify({ token: fields.token }) : form.toString());
  if (body.length > 65536) throw oauthFailure('OAUTH_CONNECTION_REQUEST_TOO_LARGE', 'The private authorization request exceeds its size limit.', 'not_sent', 400);
  headers['content-length'] = String(body.length);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    return await new Promise((resolve, reject) => {
      const url = new URL(target), chunks = [], startedAt=Date.now();
      let request, response, timer, done = false, size = 0, dispatched = false;
      const finish = (error, result) => {
        if (done) return;
        done = true; clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
        response?.destroy(); request?.destroy();
        if (error) reject(error); else resolve(result);
      };
      const fail = (code, message, outcome = dispatched ? 'unknown' : 'not_sent', status = 502) =>
        finish(oauthFailure(code, message, outcome, status));
      const abort = () => fail('OAUTH_CONNECTION_CANCELLED', 'The connection request was cancelled.');
      if (controller.signal.aborted) return abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => fail('OAUTH_CONNECTION_TIMEOUT', 'The provider did not complete the connection request in time.'), 30000);
      try {
        request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
          method: 'POST', headers, agent: agent ?? false, maxHeaderSize: 16384,
          ...(url.protocol === 'https:' ? {
            ...(agent === undefined ? {lookup:publicLookup(url.hostname,lookup)} : {}),
            rejectUnauthorized: true, minVersion: 'TLSv1.2' } : {}),
        }, res => {
          response = res; dispatched = true;
          res.once('error', () => fail('OAUTH_CONNECTION_RESPONSE_INCOMPLETE', 'The provider response ended before it was complete.'));
          res.once('aborted', () => fail('OAUTH_CONNECTION_RESPONSE_INCOMPLETE', 'The provider response was interrupted.'));
          if (res.statusCode >= 300 && res.statusCode < 400)
            return fail('OAUTH_CONNECTION_REDIRECT_REFUSED', 'The declared provider endpoint returned a redirect.', 'unknown');
          if (!['identity', undefined].includes(res.headers['content-encoding']))
            return fail('OAUTH_CONNECTION_RESPONSE_INVALID', 'The provider returned an unsupported response encoding.');
          const length = res.headers['content-length'];
          if (length !== undefined && (!/^\d+$/.test(length) || BigInt(length) > 65536n))
            return fail('OAUTH_CONNECTION_RESPONSE_TOO_LARGE', 'The provider response exceeds the connection limit.');
          res.on('data', part => {
            size += part.length;
            if (size > 65536) return fail('OAUTH_CONNECTION_RESPONSE_TOO_LARGE', 'The provider response exceeds the connection limit.');
            chunks.push(part);
          });
          res.once('end', () => {
            if (done) return;
            if (!res.complete) return fail('OAUTH_CONNECTION_RESPONSE_INCOMPLETE', 'The provider response was incomplete.');
            if (mode === 'revoke' && res.statusCode === 200) return finish(null, { startedAt, receivedAt: Date.now(), value: {} });
            let value;
            try {
              if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(res.headers['content-type'] ?? '')) throw Error();
              value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
              if (!plain(value)) throw Error();
            } catch {
              if (res.statusCode !== 429) return fail('OAUTH_CONNECTION_RESPONSE_INVALID', 'The provider returned an invalid connection response.');
              value = {};
            }
            if (res.statusCode !== 200 || value.error !== undefined) {
              const code = typeof value.error === 'string' && knownErrors.has(value.error) ? value.error : null;
              const permanent = ['invalid_client', 'invalid_grant', 'unauthorized_client', 'access_denied', 'invalid_scope', 'unsupported_grant_type'].includes(code);
              const error = oauthFailure(permanent ? 'OAUTH_CONNECTION_RECONNECT_REQUIRED' : res.statusCode === 429 ?
                'OAUTH_CONNECTION_RATE_LIMITED' : 'OAUTH_CONNECTION_PROVIDER_FAILED',
                permanent ? 'The provider requires a new reviewed authorization or corrected registered client.' : 'The provider did not complete this connection action.',
                code || res.statusCode === 429 ? 'rejected' : 'unknown', res.statusCode === 429 ? 429 : 502);
              error.providerCode = code;
              const retry = res.headers['retry-after'];
              error.retryAfterMs = typeof retry === 'string' && /^\d{1,9}$/.test(retry) ? Math.min(Number(retry) * 1000, 3600000) : 30000;
              return finish(error);
            }
            try {
              if (credential(profile, env).identity !== selected.identity)
                return fail('OAUTH_CONNECTION_CLIENT_CHANGED', 'The registered client credential changed during authorization.', 'unknown', 409);
            } catch { return fail('OAUTH_CONNECTION_CLIENT_CHANGED', 'The registered client credential changed during authorization.', 'unknown', 409); }
            finish(null, { startedAt, receivedAt: Date.now(), value });
          });
        });
        request.once('finish', () => { dispatched = true; });
        request.once('error', error => {
          if (error?.code === 'OAUTH_CONNECTION_DNS_REJECTED') finish(error);
          else fail('OAUTH_CONNECTION_UNAVAILABLE', 'The provider connection did not complete.');
        });
        request.once('upgrade', (_response, socket) => { socket.destroy(); fail('OAUTH_CONNECTION_RESPONSE_INVALID', 'The provider returned an unsupported protocol.'); });
        request.end(body);
      } catch { fail('OAUTH_CONNECTION_UNAVAILABLE', 'The provider connection could not be opened.'); }
    });
  } finally { signal?.removeEventListener('abort', cancel); }
}
