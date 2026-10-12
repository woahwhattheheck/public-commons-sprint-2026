// MIT. Reviewed OAuth authorization grants and durable renewal/revocation.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { identity, fault, stamp } from '../postgres/publisher/files.mjs';
import { initializeOAuthConnection, oauthConnectionStatus, loadOAuthConnection, publicOAuthStatus,
  saveOAuthConnection, withOAuthConnectionLock, checkRevision, commandIdentity, existingCommand, recordCommand } from './store.mjs';
import { oauthCallbackPath, identifier, opaque, bearer, scopes, text, plain, intuitQboProfile, qboRealm } from './profile.mjs';
import { oauthRequest, oauthFailure } from './transport.mjs';

export { initializeOAuthConnection, oauthConnectionStatus } from './store.mjs';
const until = (milliseconds, now = Date.now()) => new Date(now + milliseconds).toISOString();
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const errorCode = error => /^OAUTH_CONNECTION_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'OAUTH_CONNECTION_FAILED';
const safeError = error => ({ code: errorCode(error), message: error?.code?.startsWith('OAUTH_CONNECTION_') ?
  error.message : 'The private connection operation could not be completed.' });
function seconds(value, label, allowZero = false) {
  if (value === undefined) return null;
  const result = typeof value === 'string' && /^[0-9]{1,10}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1) || result > 2147483647)
    throw oauthFailure('OAUTH_CONNECTION_TOKEN_INVALID', 'The provider returned an invalid ' + label + '.');
  return result;
}
function tokenFields(profile, response, previous = null) {
  const value = response.value, intuit = intuitQboProfile(profile), now = intuit ? response.receivedAt : response.startedAt;
  if (!plain(value) || typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer' ||
      !bearer(value.access_token) || value.refresh_token !== undefined && !opaque(value.refresh_token))
    throw oauthFailure('OAUTH_CONNECTION_TOKEN_INVALID', 'The provider did not return a usable bearer authorization.');
  const returnedScopes = value.scope === undefined ? [...(previous?.scopes ?? profile.scopes)] :
    typeof value.scope === 'string' ? scopes(value.scope === '' ? [] : value.scope.split(' ')) : null;
  if (!returnedScopes || returnedScopes.some(scope => !profile.scopes.includes(scope)) ||
      profile.scopes.some(scope => !returnedScopes.includes(scope)))
    throw oauthFailure('OAUTH_CONNECTION_SCOPE_CHANGED', 'The granted scopes differ from the reviewed source profile. Review the profile and authorize again.');
  const lifetime = seconds(value.expires_in, 'access-token lifetime');
  const refreshLifetime = seconds(intuit ? value.x_refresh_token_expires_in : value.refresh_token_expires_in, 'refresh-token lifetime', intuit);
  const hardLifetime = intuit ? seconds(value.x_refresh_token_hard_expires_in, 'refresh-token hard lifetime', true) : null;
  const earlier = (a, b) => a === null ? b : b === null ? a : Date.parse(a) <= Date.parse(b) ? a : b;
  const refreshHardExpiresAt = intuit ? earlier(previous?.refreshHardExpiresAt ?? null,
    hardLifetime === null ? null : until(hardLifetime * 1000, now)) : null;
  const refreshExpiresAt = refreshLifetime === null ?
    (intuit || value.refresh_token === undefined || value.refresh_token === previous?.refreshToken ?
      previous?.refreshExpiresAt ?? null : null) : until(refreshLifetime * 1000, now);
  const expiresAt=lifetime===null?null:until(lifetime*1000,now);
  if(expiresAt && Date.parse(expiresAt)<=Date.now())
    throw oauthFailure('OAUTH_CONNECTION_TOKEN_TOO_OLD','The returned access token expired during the provider exchange.');
  return { accessToken: value.access_token, refreshToken: value.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt,
    refreshExpiresAt: intuit ? earlier(refreshExpiresAt, refreshHardExpiresAt) : refreshExpiresAt,
    ...(intuit ? { refreshHardExpiresAt, realmId: previous?.realmId ?? null } : {}),
    scopes: returnedScopes, issuedAt: new Date(now).toISOString() };
}
function reviewFields(review) {
  if (!plain(review) || Object.keys(review).some(key => !['actor', 'reference'].includes(key)))
    throw fault('OAUTH_CONNECTION_REVIEW_REQUIRED', 'Enter the person approving this exact grant and its review reference.');
  text(review.actor, 'reviewing operator', 160);
  text(review.reference ?? '', 'review reference', 2000, true);
  return { actor: review.actor, reference: review.reference ?? '', at: stamp() };
}
function assertBinding(state, options) {
  if (options.expectedProfileSha256 !== undefined && state.profileSha256 !== options.expectedProfileSha256 ||
      options.expectedGrantId !== undefined && state.grant.id !== options.expectedGrantId ||
      options.clientSecretEnv !== state.profile.clientSecretEnv ||
      options.resourceOrigin !== undefined && !state.profile.resourceOrigins.includes(options.resourceOrigin) ||
      (options.requiredScopes ?? []).some(scope => !state.grant.scopes.includes(scope)))
    throw fault('OAUTH_CONNECTION_BINDING_CHANGED', 'The current source, grant or resource differs from the approved application. Review and save the application binding again.', 409);
}
const usable = (grant, { force = false, rejectedAccessToken } = {}) => {
  const expiry=grant.expiresAt===null?null:Date.parse(grant.expiresAt);
  const lifetime=expiry===null?null:Math.max(0,expiry-Date.parse(grant.issuedAt));
  const skew=grant.refreshToken&&lifetime!==null?Math.min(30000,lifetime*0.1):0;
  return grant.state==='connected' && grant.accessToken && !grant.refreshPending &&
    (expiry===null || expiry>Date.now()+skew) &&
    (!force || rejectedAccessToken && grant.accessToken!==rejectedAccessToken);
};
function clearUncertainGrant(state, code) {
  state.grant = { ...state.grant, state: 'reconnect_required', accessToken: null, refreshToken: null,
    refreshPending: null, retryAfter: null, lastError: { code, at: stamp() } };
}
async function finish(directory, state, operation, command, options, { state: commandState, code } = {}) {
  const saved = await saveOAuthConnection(directory, state, operation, { ...options,
    ...(command ? { completeCommand: command } : {}), commandState, commandCode: code });
  return { saved, result: command ? saved.commands[command.requestId].result : publicOAuthStatus(saved) };
}
async function refreshUnderLock(directory, state, options, command) {
  if (state.grant.refreshPending) {
    const interruptedId = state.grant.refreshPending.requestId;
    clearUncertainGrant(state, 'OAUTH_CONNECTION_REFRESH_INTERRUPTED');
    const original = interruptedId && Object.hasOwn(state.commands,interruptedId) && state.commands[interruptedId];
    const interrupted = original ? { requestId: interruptedId, kind: original.kind, inputHash: original.inputHash } : null;
    const extra=interrupted && command && interrupted.requestId!==command.requestId?[interrupted]:[];
    return finish(directory, state, 'refresh_interrupted', command??interrupted,
      {...options,alsoCompleteCommands:extra},
      { state: 'reconnect_required', code: 'OAUTH_CONNECTION_REFRESH_INTERRUPTED' });
  }
  if (state.grant.state !== 'connected')
    throw fault('OAUTH_CONNECTION_RECONNECT_REQUIRED', 'Connect and approve this provider authorization before using the application.', 409);
  if (!state.grant.refreshToken || state.grant.refreshExpiresAt && Date.parse(state.grant.refreshExpiresAt) <= Date.now()) {
    clearUncertainGrant(state, 'OAUTH_CONNECTION_REFRESH_UNAVAILABLE');
    return finish(directory, state, 'refresh_unavailable', command, options,
      { state: 'reconnect_required', code: 'OAUTH_CONNECTION_REFRESH_UNAVAILABLE' });
  }
  if (state.grant.retryAfter && Date.parse(state.grant.retryAfter) > Date.now())
    throw fault('OAUTH_CONNECTION_RETRY_LATER', 'The provider connection can retry after ' + state.grant.retryAfter + '.', 429);
  const selected = { ...state.grant };
  state.grant.state = 'refreshing';
  state.grant.refreshPending = { id: randomUUID(), requestId: command?.requestId ?? null, startedAt: stamp() };
  if (command) recordCommand(state, command, 'pending');
  state = await saveOAuthConnection(directory, state, 'refresh_requested', options);
  let returned;
  try {
    const response = await oauthRequest(state.profile, 'token', {
      grant_type: 'refresh_token', refresh_token: selected.refreshToken,
      ...(state.profile.resourceParameters.length ? { resource: state.profile.resourceParameters } : {}),
    }, options);
    returned = tokenFields(state.profile, response, selected);
  } catch (error) {
    const code = errorCode(error);
    if (error.outcome === 'not_sent' || error.outcome === 'rejected' && code !== 'OAUTH_CONNECTION_RECONNECT_REQUIRED') {
      state.grant = { ...selected, state: 'connected', refreshPending: null,
        lastError: { code, at: stamp() }, retryAfter: until(error.retryAfterMs ?? 30000) };
    } else clearUncertainGrant(state, code);
    return finish(directory, state, 'refresh_failed', command, options,
      { state: state.grant.state === 'connected' ? 'failed' : 'reconnect_required', code });
  }
  state.grant = { ...selected, ...returned, state: 'connected', refreshPending: null,
    generation: selected.generation + 1, lastError: null, retryAfter: null };
  return finish(directory, state, 'refresh_completed', command, options);
}

/** Private runtime function; bearer output must never be served by the workspace. */
export async function getOAuthAccessToken(directory, options = {}) {
  options.signal?.throwIfAborted();
  let state = await loadOAuthConnection(directory, options);
  assertBinding(state, options);
  if (usable(state.grant, options)) return { token: state.grant.accessToken,
    generation: state.grant.generation, expiresAt: state.grant.expiresAt, refreshed: false };
  return withOAuthConnectionLock(directory, async () => {
    state = await loadOAuthConnection(directory, options); assertBinding(state, options);
    options.signal?.throwIfAborted();
    if (usable(state.grant, options)) return { token: state.grant.accessToken,
      generation: state.grant.generation, expiresAt: state.grant.expiresAt, refreshed: false };
    const output = await refreshUnderLock(directory, state, options, null);
    assertBinding(output.saved, options);
    if (output.saved.grant.state !== 'connected' || output.result.operation?.state === 'failed' ||
        output.saved.grant.lastError || !output.saved.grant.accessToken) {
      const error=fault(output.saved.grant.lastError?.code ?? 'OAUTH_CONNECTION_RECONNECT_REQUIRED',
        output.saved.grant.state === 'reconnect_required' ? 'The provider authorization must be connected and reviewed again.' :
          'The provider did not renew this authorization. Read its current connection status.', 503);
      error.connectionState=output.saved.grant.state;throw error;
    }
    return { token: output.saved.grant.accessToken, generation: output.saved.grant.generation,
      expiresAt: output.saved.grant.expiresAt, refreshed: true };
  }, { signal: options.signal });
}

export async function openOAuthConnection(directory, options = {}) {
  await loadOAuthConnection(directory, options);
  const flows = new Map(), beginRequests = new Map(), lifetime = new AbortController(), owned=new Set();
  let closed = false, closing=null;
  const active = () => { if (closed) throw fault('OAUTH_CONNECTION_CLOSED', 'This authorization connection is closed.', 409); };
  const flowView = flow => ({ flowId: flow.id, phase: flow.phase, requestedScopes: [...flow.profile.scopes],
    expiresAt: new Date(flow.expiresAt).toISOString(), profileSha256: flow.profileSha256,
    ...(flow.reviewId ? { reviewId: flow.reviewId } : {}),
    ...(flow.pending ? { scopes: [...flow.pending.scopes], refreshable: Boolean(flow.pending.refreshToken),
      tokenExpiresAt: flow.pending.expiresAt,
      ...(intuitQboProfile(flow.profile) ? { realmId: flow.pending.realmId, refreshExpiresAt: flow.pending.refreshExpiresAt,
        refreshHardExpiresAt: flow.pending.refreshHardExpiresAt } : {}) } : {}), ...(flow.lastError ? { lastError: { ...flow.lastError } } : {}) });
  function selectedFlow(id) {
    active();
    const flow = flows.get(id);
    if (!flow) throw fault('OAUTH_CONNECTION_FLOW_UNKNOWN', 'Start a current authorization flow in this running workspace.', 409);
    return flow;
  }
  function currentFlow(flow, generation) {
    active();
    if (flow.generation !== generation || flow.controller.signal.aborted || flow.phase === 'discarded')
      throw fault('OAUTH_CONNECTION_FLOW_CANCELLED', 'This authorization review was cancelled.', 409);
    if (Date.now() >= flow.expiresAt) {
      flow.phase = 'expired'; flow.pending = null;
      throw fault('OAUTH_CONNECTION_FLOW_EXPIRED', 'Start a new provider authorization; this review has expired.', 409);
    }
  }
  async function durableAction(kind, args, action) {
    active();
    const command = commandIdentity(args.requestId, kind, args);
    return withOAuthConnectionLock(directory, async () => {
      active();
      let state = await loadOAuthConnection(directory, options);
      const prior = existingCommand(state, command);
      if (prior?.phase === 'completed') return structuredClone(prior.result);
      if (!prior) checkRevision(state, args.expectedRevision);
      return action(state, command, prior);
    }, { signal: lifetime.signal });
  }
  async function revokeUnderLock(state, command, grantId) {
    if(state.grant.state!=='disconnected')
      throw fault('OAUTH_CONNECTION_DISCONNECT_REQUIRED','Disconnect local use before retrying remote revocation; a provider may revoke the same token family.',409);
    let pending=state.revocations.find(item=>item.grantId===grantId);
    if(!pending || pending.state==='confirmed')
      return (await finish(directory,state,'revocation_not_pending',command,options)).result;
    pending.state='requested';pending.lastAttemptAt=stamp();pending.lastError=null;
    if(grantId===state.lastDisconnectedGrantId)state.grant.remoteRevocation='requested';
    recordCommand(state,command,'pending');
    state=await saveOAuthConnection(directory,state,'revocation_requested',options);
    pending=state.revocations.find(item=>item.grantId===grantId);
    let providerError=null;
    try {
      await oauthRequest(state.profile,'revoke',{token:pending.token,token_type_hint:pending.type},
        {...options,signal:lifetime.signal});
    } catch(error) {providerError=error;}
    if(providerError){
      pending.state=providerError.outcome==='unknown'?'unknown':'failed';pending.lastError={code:errorCode(providerError),at:stamp()};
      if(grantId===state.lastDisconnectedGrantId){state.grant.remoteRevocation=pending.state;state.grant.lastError={...pending.lastError};}
      return (await finish(directory,state,'revocation_failed',command,options,
        {state:'failed',code:errorCode(providerError)})).result;
    }
    pending.token=null;pending.state='confirmed';pending.lastError=null;
    if(grantId===state.lastDisconnectedGrantId){state.grant.remoteRevocation='confirmed';state.grant.lastError=null;}
    // Persistence has its own SAVE_UNKNOWN outcome. A successful provider
    // response must never be rewritten as a failed cleanup with an erased token.
    return (await finish(directory,state,'revocation_completed',command,options)).result;
  }
  const api={
    async status({ flowId } = {}) {
      active();
      const state = await loadOAuthConnection(directory, options);
      const flow = flowId ? flows.get(flowId) : null;
      if (flow && Date.now() >= flow.expiresAt && !['connected', 'discarded', 'declined', 'failed'].includes(flow.phase)) {
        flow.generation++; flow.controller.abort(); flow.pending = null; flow.phase = 'expired';
      }
      return { ...publicOAuthStatus(state), flow: flow ? flowView(flow) : null };
    },
    async begin(args) {
      active();
      const command = commandIdentity(args.requestId, 'begin', args), previous = beginRequests.get(command.requestId);
      if (previous) {
        if (previous.inputHash !== command.inputHash) throw fault('OAUTH_CONNECTION_REQUEST_CHANGED', 'The authorization request ID already belongs to different input.', 409);
        return structuredClone(previous.result);
      }
      const state = await loadOAuthConnection(directory, options); checkRevision(state, args.expectedRevision);
      let redirect;
      try { redirect = new URL(args.redirectUri); } catch { throw fault('OAUTH_CONNECTION_CALLBACK_INVALID'); }
      const callbackPath = oauthCallbackPath(state.profileSha256);
      const validOrigin = state.profile.callbackOrigin ? redirect.origin === state.profile.callbackOrigin :
        redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1' && Boolean(redirect.port);
      if (!validOrigin || redirect.search || redirect.hash || redirect.username || redirect.password ||
          redirect.pathname !== callbackPath || args.redirectUri !== redirect.href)
        throw fault('OAUTH_CONNECTION_CALLBACK_INVALID', 'Use the configured callback origin and this source-specific registered path.');
      for (const [id, flow] of flows) if (Date.now() >= flow.expiresAt || ['discarded', 'failed', 'declined', 'connected'].includes(flow.phase)) {
        flow.controller.abort(); flow.pending = null; flows.delete(id);
      }
      if (flows.size >= 8) throw fault('OAUTH_CONNECTION_FLOW_CAPACITY', 'Finish or discard an existing authorization review first.', 409);
      const verifier = randomBytes(48).toString('base64url'), stateToken = randomBytes(32).toString('base64url');
      const flow = { id: randomUUID(), profile: state.profile, profileSha256: state.profileSha256,
        baseGrantId: state.grant.id, redirectUri: redirect.href, stateToken, verifier,
        expiresAt: Date.now() + 600000, phase: 'awaiting_authorization', pending: null,
        generation: 0, controller: new AbortController(), lastError: null, reviewId: null };
      const url = new URL(state.profile.authorizationEndpoint);
      for (const [key, value] of Object.entries(state.profile.authorizationParameters)) {
        if (url.searchParams.has(key) && url.searchParams.get(key) !== value)
          throw fault('OAUTH_CONNECTION_PARAMETER_CONFLICT', 'The source URL and reviewed authorization parameter disagree.');
        url.searchParams.set(key, value);
      }
      for (const [key, value] of Object.entries({ response_type: 'code', client_id: state.profile.clientId,
        redirect_uri: redirect.href, ...(state.profile.scopes.length?{scope:state.profile.scopes.join(' ')}:{}), state: stateToken,
        ...(state.profile.pkceMethod === 'S256' ? { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' } : {}) }))
        url.searchParams.set(key, value);
      for (const resource of state.profile.resourceParameters) url.searchParams.append('resource', resource);
      if(url.href.length>16384)throw fault('OAUTH_CONNECTION_AUTHORIZATION_URL_TOO_LARGE','The selected registration and scope parameters exceed the supported browser authorization URL size.');
      flows.set(flow.id, flow);
      const result = { ...flowView(flow), authorizationUrl: url.href, callbackPath };
      beginRequests.set(command.requestId, { inputHash: command.inputHash, result });
      while (beginRequests.size > 64) beginRequests.delete(beginRequests.keys().next().value);
      return structuredClone(result);
    },
    async complete({ flowId, parameters }) {
      const flow = selectedFlow(flowId), generation = flow.generation;
      currentFlow(flow, generation);
      if (!(parameters instanceof URLSearchParams) || parameters.getAll('state').length !== 1 || !equal(parameters.get('state'), flow.stateToken))
        throw fault('OAUTH_CONNECTION_STATE_MISMATCH', 'The provider callback does not match the current authorization.');
      if (parameters.has('iss') && (parameters.getAll('iss').length !== 1 || !flow.profile.issuer || parameters.get('iss') !== flow.profile.issuer))
        throw fault('OAUTH_CONNECTION_ISSUER_MISMATCH', 'The callback issuer differs from the reviewed provider.');
      let realmId = null;
      if (intuitQboProfile(flow.profile) && !parameters.has('error')) {
        realmId = parameters.get('realmId');
        if (parameters.getAll('realmId').length !== 1 || !qboRealm(realmId))
          throw fault('OAUTH_CONNECTION_REALM_REQUIRED', 'The state-matched QuickBooks callback must identify one company.');
        if (flow.pending?.realmId && flow.pending.realmId !== realmId)
          throw fault('OAUTH_CONNECTION_REALM_CHANGED', 'This authorization callback belongs to a different QuickBooks company.', 409);
      }
      if (['review_grant', 'connected'].includes(flow.phase)) return flowView(flow);
      if (flow.phase !== 'awaiting_authorization') throw fault('OAUTH_CONNECTION_CALLBACK_USED', 'This callback has already been handled.', 409);
      if (parameters.has('error')) {
        if (parameters.getAll('error').length !== 1 || parameters.has('code')) throw fault('OAUTH_CONNECTION_CALLBACK_INVALID');
        flow.phase = 'declined'; flow.lastError = { code: 'OAUTH_CONNECTION_AUTHORIZATION_DECLINED', message: 'The provider did not authorize this connection.' };
        return flowView(flow);
      }
      const code = parameters.get('code');
      if (!opaque(code) || code.length>4096 || parameters.getAll('code').length !== 1) throw fault('OAUTH_CONNECTION_CODE_REQUIRED', 'The callback requires one authorization code.');
      flow.phase = 'exchanging';
      try {
        const response = await oauthRequest(flow.profile, 'token', { grant_type: 'authorization_code', code,
          ...(flow.profile.pkceMethod === 'S256' ? { code_verifier: flow.verifier } : {}), redirect_uri: flow.redirectUri,
          ...(flow.profile.resourceParameters.length ? { resource: flow.profile.resourceParameters } : {}) },
        { ...options, signal: AbortSignal.any([flow.controller.signal, lifetime.signal]) });
        currentFlow(flow, generation);
        const fields = tokenFields(flow.profile, response);
        if (intuitQboProfile(flow.profile)) fields.realmId = realmId;
        flow.pending = fields; flow.phase = 'review_grant';
        flow.reviewId = identity({ flowId, profileSha256: flow.profileSha256, grant: {
          scopes: fields.scopes, expiresAt: fields.expiresAt, refreshable: Boolean(fields.refreshToken),
          ...(intuitQboProfile(flow.profile) ? { realmId: fields.realmId, refreshExpiresAt: fields.refreshExpiresAt,
            refreshHardExpiresAt: fields.refreshHardExpiresAt } : {}),
        }, salt: randomBytes(32).toString('base64url') });
        flow.verifier = null;
        return flowView(flow);
      } catch (error) {
        if (flow.generation === generation && flow.phase !== 'discarded') {
          flow.pending = null; flow.verifier = null; flow.phase = 'failed'; flow.lastError = safeError(error);
        }
        throw fault(errorCode(error), safeError(error).message, error.status ?? 502);
      }
    },
    async approve(args) {
      return durableAction('approve', args, async (state, command) => {
        const flow = selectedFlow(args.flowId), generation = flow.generation;
        currentFlow(flow, generation);
        if (flow.phase !== 'review_grant' || !flow.pending || flow.reviewId !== args.reviewId)
          throw fault('OAUTH_CONNECTION_GRANT_REVIEW_REQUIRED', 'Review the current provider grant before approving it.', 409);
        if (state.profileSha256 !== flow.profileSha256 || state.grant.id !== flow.baseGrantId)
          throw fault('OAUTH_CONNECTION_BINDING_CHANGED', 'The connection changed during authorization. Begin a new source review.', 409);
        const review = reviewFields(args.review);
        if (flow.pending.expiresAt && Date.parse(flow.pending.expiresAt) <= Date.now())
          throw fault('OAUTH_CONNECTION_GRANT_EXPIRED', 'The returned access token expired before approval. Authorize again.', 409);
        flow.phase = 'committing';
        state.grant = { ...state.grant, ...flow.pending, id: 'grant_' + randomUUID(), state: 'connected', review,
          generation: state.grant.generation + 1, refreshPending: null, lastError: null, retryAfter: null,
          remoteRevocation: 'not_requested' };
        try {
          const result = (await finish(directory, state, 'grant_approved', command, options)).result;
          flow.pending = null; flow.phase = 'connected'; return result;
        } catch (error) {
          flow.phase = 'review_grant';
          throw fault('OAUTH_CONNECTION_SAVE_UNKNOWN', 'Read the current connection and retry this same approval request before starting another action.', 503);
        }
      });
    },
    discard({ flowId }) {
      const flow = selectedFlow(flowId);
      if (flow.phase === 'committing') throw fault('OAUTH_CONNECTION_APPROVAL_IN_PROGRESS', 'Grant saving has begun. Read its current result before disconnecting.', 409);
      flow.generation++; flow.controller.abort(); flow.pending = null; flow.verifier = null; flow.phase = 'discarded';
      return flowView(flow);
    },
    async refresh(args) {
      return durableAction('refresh', args, async (state, command, prior) => {
        if (state.grant.id !== args.expectedGrantId) {
          if(prior)return (await finish(directory,state,'refresh_superseded',command,options,
            {state:'superseded',code:'OAUTH_CONNECTION_BINDING_CHANGED'})).result;
          throw fault('OAUTH_CONNECTION_BINDING_CHANGED', 'Refresh the exact currently reviewed grant.', 409);
        }
        return (await refreshUnderLock(directory, state, { ...options, signal: lifetime.signal }, command)).result;
      });
    },
    async disconnect(args) {
      if (typeof args.revoke !== 'boolean') throw fault('OAUTH_CONNECTION_REVOCATION_CHOICE_REQUIRED');
      return durableAction('disconnect', args, async (state, command, prior) => {
        if (prior) return revokeUnderLock(state,command,args.expectedGrantId);
        if (state.grant.id !== args.expectedGrantId) throw fault('OAUTH_CONNECTION_BINDING_CHANGED', 'Disconnect the exact currently reviewed grant.', 409);
        const token = state.grant.refreshToken ?? state.grant.accessToken;
        if (args.revoke && token && !state.profile.revocationEndpoint)
          throw fault('OAUTH_CONNECTION_REVOCATION_UNAVAILABLE', 'This profile has no declared revocation endpoint. Choose local disconnect or configure a new reviewed profile.');
        if(args.revoke && token){
          if(state.revocations.filter(item=>item.state!=='confirmed').length>=16)
            throw fault('OAUTH_CONNECTION_REVOCATION_CAPACITY','Finish an existing remote cleanup or choose local disconnect without adding another remote request.',409);
          while(state.revocations.length>=64){const index=state.revocations.findIndex(item=>item.state==='confirmed');if(index<0)break;state.revocations.splice(index,1);}
          state.revocations.push({grantId:state.grant.id,token,type:state.grant.refreshToken?'refresh_token':'access_token',
            state:'requested',requestedAt:stamp(),lastAttemptAt:null,lastError:null,requestId:command.requestId});
        }
        state.lastDisconnectedGrantId=state.grant.id??state.lastDisconnectedGrantId;
        state.grant = { ...state.grant, id: null, state: 'disconnected', accessToken: null, refreshToken: null,
          expiresAt: null, refreshExpiresAt: null, refreshPending: null, retryAfter: null, lastError: null,
          ...(intuitQboProfile(state.profile) ? { realmId: null, refreshHardExpiresAt: null } : {}),
          generation: state.grant.generation + 1, remoteRevocation: args.revoke && token ? 'requested' : 'not_requested' };
        if (!args.revoke || !token) return (await finish(directory, state, 'disconnected', command, options)).result;
        recordCommand(state, command, 'pending');
        state = await saveOAuthConnection(directory, state, 'disconnected', options);
        return revokeUnderLock(state,command,args.expectedGrantId);
      });
    },
    async revoke(args) {
      return durableAction('revoke', args, async (state, command) => {
        if (state.grant.state !== 'disconnected')
          throw fault('OAUTH_CONNECTION_DISCONNECT_REQUIRED', 'Disconnect local use before retrying remote revocation.', 409);
        const target=args.expectedRevocationGrantId??state.lastDisconnectedGrantId;
        if(args.expectedRevocationGrantId!==undefined && (!identifier(target)||!state.revocations.some(item=>item.grantId===target)))
          throw fault('OAUTH_CONNECTION_REVOCATION_UNKNOWN','Select the exact retained remote-cleanup grant.',409);
        if(!target && state.revocations.some(item=>item.state!=='confirmed'))
          throw fault('OAUTH_CONNECTION_REVOCATION_SELECTION_REQUIRED','Select the exact retained grant whose remote cleanup should be retried.',409);
        return revokeUnderLock(state,command,target);
      });
    },
    close() {
      if(closing)return closing;
      closed=true;lifetime.abort();
      for(const flow of flows.values()){flow.generation++;flow.controller.abort();flow.pending=null;flow.verifier=null;}
      closing=Promise.allSettled([...owned]).then(()=>undefined);
      return closing;
    },
  };
  // Keep begin's request lookup and flow insertion together even when two
  // callers retry the same authorization request before its source read ends.
  const originalBegin=api.begin;let beginTail=Promise.resolve();
  api.begin=(...args)=>{const next=beginTail.then(()=>originalBegin(...args));beginTail=next.catch(()=>{});return next;};
  // The owner drains exchanges and atomic saves before releasing its directory.
  for(const name of ['status','begin','complete','approve','refresh','disconnect','revoke']){
    const method=api[name];
    api[name]=(...args)=>{
      active();const promise=method(...args);owned.add(promise);
      promise.then(()=>owned.delete(promise),()=>owned.delete(promise));return promise;
    };
  }
  return Object.freeze(api);
}
