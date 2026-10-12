// MIT. Private generic grants on the original atomic files and connection lock.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { absolute, privateDirectory, readJson, atomicJson, identity, fault, stamp } from '../postgres/publisher/files.mjs';
import { withConnectionLock as originalConnectionLock } from '../sheets/auth/store.mjs';
import { normalizeOAuthProfile, oauthProfileIdentity, oauthCallbackPath, plain, hex, opaque, bearer, identifier, intuitQboProfile, qboRealm } from './profile.mjs';

export const STATE_SCHEMA = 'stellar-forge.oauth-authorization-connection.v1';
export const MAX_STATE_BYTES = 2 * 1024 * 1024;
const date = value => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
const moment = value => value !== null && date(value);
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key=>allowed.includes(key));
const safeCode = value => typeof value === 'string' && /^OAUTH_CONNECTION_[A-Z_]{1,100}$/.test(value);
const shortText = (value, maximum, empty=false) => typeof value==='string' && value.isWellFormed() &&
  value.length<=maximum && (empty || value.trim()) && !/[\x00-\x1f\x7f]/.test(value);
const review = value => value===null || keys(value,['actor','reference','at']) &&
  shortText(value.actor,160) && shortText(value.reference,2000,true) && moment(value.at);
const lastError = value => value===null || keys(value,['code','at']) && safeCode(value.code) && moment(value.at);
const remoteStates = ['not_requested','requested','confirmed','unknown','failed'];
const history = value => Array.isArray(value) && value.length<=32 && value.every(item=>
  keys(item,['at','operation']) && moment(item.at) && typeof item.operation==='string' && /^[a-z_]{1,80}$/.test(item.operation));
const revocationMetadata = value => keys(value,['grantId','state','requestedAt','lastAttemptAt','lastError','requestId']) &&
  identifier(value.grantId) && identifier(value.requestId) && ['requested','confirmed','unknown','failed'].includes(value.state) &&
  moment(value.requestedAt) && date(value.lastAttemptAt) && lastError(value.lastError);
const grantMetadata = grant => keys(grant,['id','state','scopes','issuedAt','expiresAt','refreshExpiresAt',
  'hasRefreshToken','generation','review','lastError','retryAfter','remoteRevocation','realmId','refreshHardExpiresAt']) &&
  (grant.realmId === undefined || grant.realmId === null || qboRealm(grant.realmId)) &&
  (grant.refreshHardExpiresAt === undefined || date(grant.refreshHardExpiresAt)) &&
  (grant.id===null || identifier(grant.id)) && ['disconnected','connected','refreshing','reconnect_required'].includes(grant.state) &&
  Array.isArray(grant.scopes) && grant.scopes.every(item=>typeof item==='string') &&
  [grant.issuedAt,grant.expiresAt,grant.refreshExpiresAt,grant.retryAfter].every(date) &&
  typeof grant.hasRefreshToken==='boolean' && Number.isSafeInteger(grant.generation) && grant.generation>=0 &&
  review(grant.review) && lastError(grant.lastError) && remoteStates.includes(grant.remoteRevocation);
function validReceipt(result, state, requestId, kind) {
  return keys(result,['schema','revision','profileSha256','profile','callbackPath','updatedAt','grant','history','revocations','operation']) &&
    result.schema==='stellar-forge.oauth-connection-status.v1' && Number.isSafeInteger(result.revision) && result.revision>=0 &&
    result.revision<=state.revision && result.profileSha256===state.profileSha256 && plain(result.profile) && identity(result.profile)===state.profileSha256 &&
    result.callbackPath===oauthCallbackPath(state.profileSha256) && moment(result.updatedAt) && grantMetadata(result.grant) &&
    history(result.history) && Array.isArray(result.revocations) && result.revocations.length<=64 && result.revocations.every(revocationMetadata) &&
    keys(result.operation,['requestId','kind','state','code']) && result.operation.requestId===requestId && result.operation.kind===kind &&
    ['completed','failed','reconnect_required','superseded'].includes(result.operation.state) &&
    (result.operation.code===undefined || safeCode(result.operation.code));
}
export async function withOAuthConnectionLock(directory, action, { signal } = {}) {
  try { return await originalConnectionLock(directory, action, { signal, name: 'oauth-authorization.lock' }); }
  catch (error) {
    if (error.code?.startsWith('SHEETS_OAUTH_')) throw fault(error.code.replace('SHEETS_OAUTH_', 'OAUTH_CONNECTION_'),
      'The private authorization connection is busy, unavailable or cancelled.', error.status ?? 409);
    throw error;
  }
}
function validState(state, { allowLoopback = false } = {}) {
  if (!plain(state) || state.schema !== STATE_SCHEMA || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !plain(state.profile) || !hex(state.profileSha256) || !plain(state.grant) || !history(state.history) ||
      !identifier(state.id) || !moment(state.createdAt) || !moment(state.updatedAt) ||
      !plain(state.commands) || Object.keys(state.commands).length > 32 || !Array.isArray(state.revocations) ||
      state.revocations.length>64 || state.lastDisconnectedGrantId!==null && !identifier(state.lastDisconnectedGrantId))
    throw fault('OAUTH_CONNECTION_STATE_INVALID');
  const profile = normalizeOAuthProfile(state.profile, { allowLoopback });
  if (state.profileSha256 !== oauthProfileIdentity(profile) || identity(profile) !== identity(state.profile))
    throw fault('OAUTH_CONNECTION_PROFILE_CHANGED');
  const grant = state.grant;
  if (!['disconnected', 'connected', 'refreshing', 'reconnect_required'].includes(grant.state) ||
      grant.id !== null && !identifier(grant.id) || !Number.isSafeInteger(grant.generation) || grant.generation < 0 ||
      !Array.isArray(grant.scopes) || grant.scopes.some(value => !profile.scopes.includes(value)) ||
      new Set(grant.scopes).size !== grant.scopes.length ||
      ![grant.issuedAt, grant.expiresAt, grant.refreshExpiresAt, grant.retryAfter].every(date) ||
      grant.accessToken !== null && !bearer(grant.accessToken) || grant.refreshToken !== null && !opaque(grant.refreshToken) ||
      ['connected', 'refreshing'].includes(grant.state) && (!grant.id || !grant.accessToken) ||
      grant.state === 'disconnected' && (grant.accessToken !== null || grant.refreshToken !== null) ||
      grant.state === 'reconnect_required' && (grant.accessToken !== null || grant.refreshToken !== null) ||
      !review(grant.review) || !lastError(grant.lastError) || !remoteStates.includes(grant.remoteRevocation) ||
      ['connected','refreshing'].includes(grant.state) && (!grant.review || grant.scopes.length!==profile.scopes.length) ||
      grant.refreshPending !== null && (!keys(grant.refreshPending,['id','requestId','startedAt']) ||
        !identifier(grant.refreshPending.id) || !moment(grant.refreshPending.startedAt) ||
        grant.refreshPending.requestId!==null && !identifier(grant.refreshPending.requestId)) ||
      (grant.state==='refreshing') !== (grant.refreshPending!==null))
    throw fault('OAUTH_CONNECTION_STATE_INVALID');
  if (intuitQboProfile(profile) ?
      !Object.hasOwn(grant, 'realmId') || !Object.hasOwn(grant, 'refreshHardExpiresAt') ||
      !(grant.realmId === null || qboRealm(grant.realmId)) || !date(grant.refreshHardExpiresAt) ||
      ['connected', 'refreshing'].includes(grant.state) && !qboRealm(grant.realmId) ||
      grant.refreshHardExpiresAt !== null && grant.refreshExpiresAt !== null &&
        Date.parse(grant.refreshExpiresAt) > Date.parse(grant.refreshHardExpiresAt) :
      grant.realmId !== undefined || grant.refreshHardExpiresAt !== undefined)
    throw fault('OAUTH_CONNECTION_STATE_INVALID');
  const grants=new Set();
  for(const item of state.revocations){
    const {token,type,...metadata}=item;
    if(!revocationMetadata(metadata) || grants.has(item.grantId) || !['refresh_token','access_token'].includes(type) ||
        (item.state==='confirmed' ? token!==null : !opaque(token)))throw fault('OAUTH_CONNECTION_REVOCATION_INVALID');
    grants.add(item.grantId);
  }
  for (const [id, command] of Object.entries(state.commands))
    if (!identifier(id) || !keys(command,['inputHash','kind','phase','result']) || !hex(command.inputHash) ||
        !['approve','refresh','disconnect','revoke'].includes(command.kind) || !['pending', 'completed'].includes(command.phase) ||
        (command.phase==='completed' ? !validReceipt(command.result,state,id,command.kind) : command.result!==null))
      throw fault('OAUTH_CONNECTION_COMMAND_INVALID');
  return state;
}
export async function loadOAuthConnection(directory, options = {}) {
  absolute(directory); await privateDirectory(directory);
  return validState(await readJson(join(directory, 'connection.json'), MAX_STATE_BYTES), options);
}
export function publicOAuthStatus(state) {
  const grant = state.grant;
  return {
    schema: 'stellar-forge.oauth-connection-status.v1', revision: state.revision,
    profileSha256: state.profileSha256, profile: structuredClone(state.profile),
    callbackPath: oauthCallbackPath(state.profileSha256), updatedAt: state.updatedAt,
    grant: { id: grant.id, state: grant.state, scopes: [...grant.scopes],
      issuedAt: grant.issuedAt, expiresAt: grant.expiresAt, refreshExpiresAt: grant.refreshExpiresAt,
      ...(intuitQboProfile(state.profile) ? { realmId: grant.realmId, refreshHardExpiresAt: grant.refreshHardExpiresAt } : {}),
      hasRefreshToken: Boolean(grant.refreshToken), generation: grant.generation,
      review: grant.review ? { actor: grant.review.actor, reference: grant.review.reference, at: grant.review.at } : null,
      lastError: grant.lastError ? { code: grant.lastError.code, at: grant.lastError.at } : null,
      retryAfter: grant.retryAfter, remoteRevocation: grant.remoteRevocation },
    history: state.history.map(value => ({ at: value.at, operation: value.operation })),
    revocations: state.revocations.map(value=>({grantId:value.grantId,state:value.state,requestedAt:value.requestedAt,
      lastAttemptAt:value.lastAttemptAt,lastError:value.lastError?{...value.lastError}:null,requestId:value.requestId})),
  };
}
export async function oauthConnectionStatus(directory, options = {}) {
  return publicOAuthStatus(await loadOAuthConnection(directory, options));
}
export async function saveOAuthConnection(directory, state, operation, options = {}) {
  const next = structuredClone(state);
  next.revision++; next.updatedAt = stamp();
  next.history = [...next.history, { at: next.updatedAt, operation }].slice(-32);
  const completions=[...(options.alsoCompleteCommands??[]),...(options.completeCommand?[options.completeCommand]:[])];
  for(const completion of completions) {
    const result = { ...publicOAuthStatus(next), operation: {
      requestId: completion.requestId, kind: completion.kind,
      state: options.commandState ?? 'completed', ...(options.commandCode ? { code: options.commandCode } : {}),
    } };
    recordCommand(next, completion, 'completed', result);
  }
  // Retain bounded exact results without allowing a large public source profile
  // to crowd the actual private grant out of its atomic state file.
  const protectedCommands=new Set(completions.map(command=>command.requestId));
  while(Buffer.byteLength(JSON.stringify(next))>MAX_STATE_BYTES-1024){
    const evict=Object.entries(next.commands).find(([id,command])=>command.phase==='completed'&&!protectedCommands.has(id));
    if(!evict)break;delete next.commands[evict[0]];
  }
  validState(next, options);
  if (Buffer.byteLength(JSON.stringify(next)) > MAX_STATE_BYTES - 1024)
    throw fault('OAUTH_CONNECTION_STATE_TOO_LARGE');
  try {await atomicJson(directory,'connection.json',next);}
  catch {
    const error=fault('OAUTH_CONNECTION_SAVE_UNKNOWN','Read the current connection and retry the exact retained request; its atomic save result is uncertain.',503);
    error.outcomeUnknown=true;throw error;
  }
  return next;
}
export async function initializeOAuthConnection(directory, { profile, allowLoopback = false } = {}) {
  const normalized = normalizeOAuthProfile(profile, { allowLoopback });
  absolute(directory); await privateDirectory(directory, true);
  return withOAuthConnectionLock(directory, async () => {
    try {
      const existing = await loadOAuthConnection(directory, { allowLoopback });
      if (existing.profileSha256 !== oauthProfileIdentity(normalized))
        throw fault('OAUTH_CONNECTION_PROFILE_CHANGED', 'Use a new private connection directory for a changed source or registered client.', 409);
      return publicOAuthStatus(existing);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const now = stamp();
    const state = { schema: STATE_SCHEMA, id: randomUUID(), revision: 0, createdAt: now, updatedAt: now,
      profile: normalized, profileSha256: oauthProfileIdentity(normalized),
      grant: { id: null, state: 'disconnected', accessToken: null, refreshToken: null, scopes: [],
        issuedAt: null, expiresAt: null, refreshExpiresAt: null, generation: 0, review: null,
        ...(intuitQboProfile(normalized) ? { realmId: null, refreshHardExpiresAt: null } : {}),
        refreshPending: null, lastError: null, retryAfter: null, remoteRevocation: 'not_requested' },
      commands: {}, history: [{ at: now, operation: 'initialized' }], revocations: [], lastDisconnectedGrantId: null };
    await atomicJson(directory, 'connection.json', validState(state, { allowLoopback }));
    return publicOAuthStatus(state);
  });
}
export function checkRevision(state, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || state.revision !== expectedRevision)
    throw fault('OAUTH_CONNECTION_REVISION_CHANGED', 'The connection changed. Read its current review before preparing another action.', 409);
}
export function commandIdentity(requestId, kind, input) {
  if (!identifier(requestId)) throw fault('OAUTH_CONNECTION_REQUEST_ID_REQUIRED', 'Retain a unique request ID for this connection action.');
  return { requestId, inputHash: identity({ kind, input }), kind };
}
export function existingCommand(state, command) {
  const prior = Object.hasOwn(state.commands,command.requestId) ? state.commands[command.requestId] : null;
  if (!prior) return null;
  if (prior.inputHash !== command.inputHash || prior.kind !== command.kind)
    throw fault('OAUTH_CONNECTION_REQUEST_CHANGED', 'This request ID belongs to a different connection action.', 409);
  return prior;
}
export function recordCommand(state, command, phase, result = null) {
  const entries = Object.entries(state.commands).filter(([key]) => key !== command.requestId);
  state.commands = Object.fromEntries([...entries.slice(-31), [command.requestId, {
    inputHash: command.inputHash, kind: command.kind, phase, result,
  }]]);
}
