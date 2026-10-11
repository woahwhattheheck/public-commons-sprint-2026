// MIT. Google Desktop OAuth PKCE, reviewed account binding and renewable read access.
// Fixed Google endpoints; a trusted caller may inject fetch for a native transport exercise.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fault, stamp } from '../../postgres/publisher/files.mjs';
import {
  withConnectionLock, loadConnection, saveConnection, connectionStatus, validToken,
} from './store.mjs';

export { initializeGoogleConnection, googleConnectionStatus } from './store.mjs';
export const SHEETS_READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const GOOGLE_SCOPES = Object.freeze(['openid', 'email', SHEETS_READ_SCOPE]);
export const GOOGLE_ENDPOINTS = Object.freeze({
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  revoke: 'https://oauth2.googleapis.com/revoke',
});
const allowedScopes = new Set([...GOOGLE_SCOPES, 'profile',
  'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile']);
const accountEmail = value => typeof value === 'string' && value.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const safeEqual = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const until = (seconds, now = Date.now()) => new Date(now + seconds * 1000).toISOString();
const expirySeconds = value => Number.isSafeInteger(value) && value > 0 && value <= 31536000;
function scopesFrom(value, fallback) {
  const scopes = value === undefined ? fallback : typeof value === 'string' ? [...new Set(value.split(' ').filter(Boolean))] : null;
  if (!Array.isArray(scopes) || !scopes.includes(SHEETS_READ_SCOPE) || !scopes.includes('openid') ||
      !scopes.some(scope => ['email', 'https://www.googleapis.com/auth/userinfo.email'].includes(scope)) ||
      scopes.some(scope => !allowedScopes.has(scope)))
    throw fault('SHEETS_OAUTH_SCOPE_REVIEW_REQUIRED', 'Google must grant the displayed read-only Sheets and account identity scopes. Reconnect and review the requested permissions.');
  return scopes;
}
function tokenFields(value, previous, now) {
  if (!value || value.token_type?.toLowerCase() !== 'bearer' || !validToken(value.access_token) ||
      !expirySeconds(value.expires_in) || value.refresh_token !== undefined && !validToken(value.refresh_token) ||
      value.refresh_token_expires_in !== undefined && !expirySeconds(value.refresh_token_expires_in))
    throw fault('SHEETS_OAUTH_TOKEN_RESPONSE_INVALID');
  const refreshToken = value.refresh_token ?? previous?.refreshToken;
  if (!validToken(refreshToken)) throw fault('SHEETS_OAUTH_OFFLINE_ACCESS_REQUIRED', 'Reconnect with consent to obtain renewable offline access.');
  return {
    accessToken: value.access_token, refreshToken, expiresAt: until(value.expires_in, now),
    refreshExpiresAt: value.refresh_token_expires_in === undefined ? previous?.refreshExpiresAt ?? null : until(value.refresh_token_expires_in, now),
    scopes: scopesFrom(value.scope, previous?.scopes),
  };
}
async function responseJson(response) {
  const parts = []; let size = 0;
  try {
    if (!response.body || Number(response.headers.get('content-length') ?? 0) > 65536) throw Error();
    for await (const part of response.body) {
      size += part.byteLength; if (size > 65536) throw Error(); parts.push(part);
    }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result;
  } catch { await response.body?.cancel().catch(() => {}); throw fault('SHEETS_OAUTH_RESPONSE_INVALID'); }
}
async function request(endpoint, { form, accessToken, signal, fetchImpl = globalThis.fetch, expectEmpty = false } = {}) {
  const timeout = AbortSignal.timeout(30000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: form ? 'POST' : 'GET', redirect: 'error', signal: abort,
      headers: { accept: 'application/json', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(accessToken ? { authorization: 'Bearer ' + accessToken } : {}) },
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    });
  } catch {
    throw fault(signal?.aborted ? 'SHEETS_OAUTH_CANCELLED' : timeout.aborted ? 'SHEETS_OAUTH_TIMEOUT' : 'SHEETS_OAUTH_UNREACHABLE',
      'The Google connection request did not complete. Its credentials remain private.');
  }
  if (expectEmpty && response.ok) { await response.body?.cancel(); return {}; }
  let body;
  try { body = await responseJson(response); }
  catch (issue) {
    if (signal?.aborted) throw fault('SHEETS_OAUTH_CANCELLED', 'The connection request was cancelled.');
    if (timeout.aborted) throw fault('SHEETS_OAUTH_TIMEOUT', 'The connection response timed out.');
    throw issue;
  }
  if (!response.ok) {
    const code = body.error;
    const permanent = ['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied'].includes(code);
    const issue = fault(permanent ? 'SHEETS_OAUTH_RECONNECT_REQUIRED' : response.status === 429 ?
      'SHEETS_OAUTH_RATE_LIMITED' : 'SHEETS_OAUTH_PROVIDER_FAILED',
      permanent ? 'Reconnect this Google account using the registered desktop client.' : 'Google did not complete this connection request.');
    issue.providerCode = permanent ? code : null;
    const retry = Number(response.headers.get('retry-after'));
    issue.retrySeconds = Number.isFinite(retry) && retry > 0 ? Math.min(3600, Math.ceil(retry)) : 30;
    throw issue;
  }
  return body;
}
const clientFields = client => ({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) });
const reusable = (grant, rejectedAccessToken, force, now) =>
  grant.state === 'connected' && Date.parse(grant.expiresAt) > now + 60000 &&
  (!force || rejectedAccessToken && grant.accessToken !== rejectedAccessToken);
export async function getGoogleAccessToken(directory, {
  signal, rejectedAccessToken, force = false, fetchImpl = globalThis.fetch,
} = {}) {
  let current = await loadConnection(directory);
  if (reusable(current.grant, rejectedAccessToken, force, Date.now())) return current.grant.accessToken;
  return withConnectionLock(directory, async () => {
    current = await loadConnection(directory);
    let { client, grant } = current;
    const now = Date.now();
    if (grant.state !== 'connected') throw fault('SHEETS_OAUTH_RECONNECT_REQUIRED', 'Connect and approve this Google account before extracting a new range.');
    if (reusable(grant, rejectedAccessToken, force, now)) return grant.accessToken;
    if (grant.refreshExpiresAt && Date.parse(grant.refreshExpiresAt) <= now) {
      await saveConnection(directory, grant, { state: 'reconnect_required', lastFailure: { code: 'REFRESH_ACCESS_EXPIRED', at: stamp() } }, 'refresh_access_expired');
      throw fault('SHEETS_OAUTH_RECONNECT_REQUIRED', 'The time-limited Google grant expired. Reconnect to continue publication.');
    }
    if (grant.retryAfter && Date.parse(grant.retryAfter) > now)
      throw fault('SHEETS_OAUTH_RETRY_LATER', 'Google connection retry is available after ' + grant.retryAfter + '.', 429);
    grant = await saveConnection(directory, grant, {
      refreshPending: { id: randomUUID(), startedAt: stamp(), interruptedPredecessor: Boolean(grant.refreshPending) },
    }, 'refresh_requested');
    let next;
    try {
      const value = await request(GOOGLE_ENDPOINTS.token, {
        form: { ...clientFields(client), grant_type: 'refresh_token', refresh_token: grant.refreshToken },
        fetchImpl, signal,
      });
      next = tokenFields(value, grant, Date.now());
    } catch (issue) {
      await saveConnection(directory, grant, {
        state: issue.code === 'SHEETS_OAUTH_RECONNECT_REQUIRED' ? 'reconnect_required' : 'connected',
        refreshPending: null,
        lastFailure: { code: issue.code?.startsWith('SHEETS_OAUTH_') ? issue.code : 'SHEETS_OAUTH_FAILED', at: stamp() },
        retryAfter: issue.code === 'SHEETS_OAUTH_RECONNECT_REQUIRED' ? null : until(issue.retrySeconds ?? 30),
      }, 'refresh_failed');
      throw issue;
    }
    await saveConnection(directory, grant, { ...next, refreshPending: null, lastFailure: null, retryAfter: null }, 'refresh_completed');
    return next.accessToken;
  }, { signal });
}
export async function refreshGoogleConnection(directory, options = {}) {
  await getGoogleAccessToken(directory, { ...options, force: true });
  return connectionStatus(await loadConnection(directory), directory);
}
export async function beginGoogleAuthorization(directory, { redirectUri, expectedEmail, fetchImpl = globalThis.fetch, signal } = {}) {
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port ||
      redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/oauth2callback')
    throw fault('SHEETS_OAUTH_LOOPBACK_REQUIRED', 'Use the native listener on 127.0.0.1 with its selected port.');
  if (expectedEmail !== undefined && !accountEmail(expectedEmail)) throw fault('SHEETS_OAUTH_EMAIL_INVALID');
  const initial = await loadConnection(directory);
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const expiresAt = Date.now() + 600000;
  let phase = 'awaiting_google', pending = null, failure = null, generation = 0;
  const lifetime = new AbortController();
  const flowSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const requireCurrent = selectedGeneration => {
    if (flowSignal.aborted || generation !== selectedGeneration || phase === 'discarded')
      throw fault('SHEETS_OAUTH_AUTHORIZATION_CANCELLED', 'This account review was cancelled. Start a new connection review.');
    if (Date.now() >= expiresAt) throw fault('SHEETS_OAUTH_AUTHORIZATION_EXPIRED');
  };
  const url = new URL(GOOGLE_ENDPOINTS.authorization);
  const parameters = {
    client_id: initial.client.clientId, redirect_uri: redirect.href, response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account',
    code_challenge: challenge, code_challenge_method: 'S256', state,
    ...(expectedEmail ? { login_hint: expectedEmail } : {}),
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const view = () => ({ phase, expiresAt: new Date(expiresAt).toISOString(),
    account: pending?.account ?? null, scopes: pending?.scopes ?? [...GOOGLE_SCOPES], failure });
  return {
    authorizationUrl: url.href, view,
    async complete(parameters) {
      requireCurrent(generation);
      if (phase !== 'awaiting_google') throw fault('SHEETS_OAUTH_CALLBACK_ALREADY_USED', 'This authorization response has already been handled.');
      if (Date.now() >= expiresAt) { phase = 'expired'; throw fault('SHEETS_OAUTH_AUTHORIZATION_EXPIRED'); }
      if (!safeEqual(parameters.get('state'), state) || parameters.getAll('state').length !== 1)
        throw fault('SHEETS_OAUTH_STATE_MISMATCH');
      if (parameters.has('error')) {
        phase = 'declined'; failure = parameters.get('error') === 'access_denied' ? 'Access was declined in Google.' : 'Google did not authorize this connection.';
        return view();
      }
      const code = parameters.get('code');
      if (!validToken(code) || parameters.getAll('code').length !== 1) throw fault('SHEETS_OAUTH_CODE_REQUIRED');
      const selectedGeneration = generation;
      phase = 'exchanging';
      try {
        const token = await request(GOOGLE_ENDPOINTS.token, { form: {
          ...clientFields(initial.client), grant_type: 'authorization_code', code,
          code_verifier: verifier, redirect_uri: redirect.href,
        }, fetchImpl, signal: flowSignal });
        requireCurrent(selectedGeneration);
        const fields = tokenFields(token, null, Date.now());
        const account = await request(GOOGLE_ENDPOINTS.userinfo, { accessToken: fields.accessToken, fetchImpl, signal: flowSignal });
        requireCurrent(selectedGeneration);
        if (typeof account.sub !== 'string' || !account.sub.length || account.sub.length > 255 ||
            !accountEmail(account.email) || account.email_verified !== true)
          throw fault('SHEETS_OAUTH_ACCOUNT_UNVERIFIED', 'Google must return a verified email for the account review.');
        if (expectedEmail && account.email.toLowerCase() !== expectedEmail.toLowerCase())
          throw fault('SHEETS_OAUTH_ACCOUNT_MISMATCH', 'Google returned a different account. Start again and choose the requested account.');
        pending = { ...fields, account: { subject: account.sub, email: account.email, emailVerified: true } };
        phase = 'review_account'; return view();
      } catch (issue) {
        if (generation === selectedGeneration && phase !== 'discarded') {
          phase = 'failed'; pending = null;
          failure = issue.code?.startsWith('SHEETS_OAUTH_') ? issue.message : 'Google authorization did not complete.';
        }
        throw issue;
      }
    },
    async approve() {
      requireCurrent(generation);
      if (phase !== 'review_account' || !pending) throw fault('SHEETS_OAUTH_ACCOUNT_REVIEW_REQUIRED');
      const selected = pending, selectedGeneration = generation;
      phase = 'approving';
      try {
        const result = await withConnectionLock(directory, async () => {
          requireCurrent(selectedGeneration);
          const current = await loadConnection(directory);
          requireCurrent(selectedGeneration);
          if (current.grant.connectionId !== initial.grant.connectionId || current.grant.clientHash !== initial.grant.clientHash)
            throw fault('SHEETS_OAUTH_CONNECTION_CHANGED', 'The connection changed during review. Start again with its current account.');
          // Approval owns the atomic write from this point. Discard cannot
          // promise to preserve the prior grant after that write has begun.
          requireCurrent(selectedGeneration); phase = 'committing';
          const grant = await saveConnection(directory, current.grant, {
            ...selected, connectionId: randomUUID(), state: 'connected', connectedAt: stamp(),
            refreshPending: null, lastFailure: null, retryAfter: null, remoteRevocation: null,
          }, 'account_approved');
          return connectionStatus({ client: current.client, grant }, directory);
        }, { signal: flowSignal });
        pending = null; phase = 'connected'; return result;
      } catch (issue) {
        if (generation === selectedGeneration && phase !== 'discarded') {
          pending = null; phase = 'failed';
          failure = issue.code?.startsWith('SHEETS_OAUTH_') ? issue.message :
            'Account saving did not complete. Read the current connection status before reconnecting.';
        }
        throw issue;
      }
    },
    discard() {
      if (phase === 'committing') throw fault('SHEETS_OAUTH_APPROVAL_IN_PROGRESS',
        'Account saving has begun. Read the current connection status before disconnecting or reconnecting.', 409);
      generation++; lifetime.abort(); pending = null; phase = 'discarded'; return view();
    },
  };
}
export async function disconnectGoogleConnection(directory, { revoke = false, fetchImpl = globalThis.fetch, signal } = {}) {
  return withConnectionLock(directory, async () => {
    const { client, grant } = await loadConnection(directory);
    const token = grant.refreshToken ?? grant.accessToken;
    // Local disconnection is durable even if Google's revocation request fails.
    let cleared = await saveConnection(directory, grant, {
      connectionId: randomUUID(), state: 'disconnected', accessToken: null, refreshToken: null,
      expiresAt: null, refreshExpiresAt: null, refreshPending: null, retryAfter: null, lastFailure: null,
      remoteRevocation: revoke && token ? 'requested' : 'not_requested',
    }, 'disconnected');
    if (revoke && token) {
      let result = 'confirmed', failure = null;
      try { await request(GOOGLE_ENDPOINTS.revoke, { form: { token }, expectEmpty: true, fetchImpl, signal }); }
      catch (issue) { result = 'unconfirmed'; failure = { code: issue.code ?? 'SHEETS_OAUTH_REVOCATION_FAILED', at: stamp() }; }
      cleared = await saveConnection(directory, cleared, { remoteRevocation: result, lastFailure: failure }, 'revocation_' + result);
    }
    return connectionStatus({ client, grant: cleared }, directory);
  }, { signal });
}
