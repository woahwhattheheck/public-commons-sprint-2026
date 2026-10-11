// MIT. Public, source-bound authorization-code profile and upstream declaration.
import { isIP } from 'node:net';
import { identity, fault } from '../postgres/publisher/files.mjs';

export const PROFILE_SCHEMA = 'stellar-forge.oauth-authorization-profile.v1';
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const envName = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
export const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && /^[\x21-\x7e]+$/.test(value);
export const bearer = value => opaque(value) && value.length<=8000 && /^[A-Za-z0-9\-._~+/]+=*$/.test(value);
export const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const fail = message => { throw fault('OAUTH_CONNECTION_PROFILE_INVALID', message); };
export function exact(value, keys, label) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('Invalid ' + label + '.');
}
export function text(value, label, maximum = 2000, empty = false) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > maximum ||
      !empty && !value.trim() || /[\x00-\x1f\x7f]/.test(value)) fail('Invalid ' + label + '.');
  return value;
}
export function scopes(value, label = 'OAuth scopes') {
  if (!Array.isArray(value) || value.length > 128 || value.some(item => typeof item !== 'string' ||
      item.length > 512 || !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(item)) || new Set(value).size !== value.length)
    fail('Use distinct space-free values for ' + label + '.');
  return [...value].sort();
}
export function endpoint(value, { allowLoopback = false, origin = false, query = false } = {}) {
  text(value, 'OAuth URL', 2048);
  let url;
  try { url = new URL(value); } catch { fail('Use an absolute OAuth URL.'); }
  if (url.username || url.password || url.hash || !query && (url.search || value.includes('?')) ||
      value !== (origin ? url.origin : url.href)) fail('Use the exact canonical OAuth URL without credentials or a fragment.');
  if (allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port) return value;
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') ||
      host.length > 253 || host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
      ['localhost', 'local', 'localdomain', 'internal', 'home.arpa'].some(part => host === part || host.endsWith('.' + part)))
    fail('Use public HTTPS on port 443, or explicitly enabled literal local development.');
  return value;
}
const reserved = new Set(['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code',
  'code_challenge', 'code_challenge_method', 'code_verifier', 'grant_type', 'resource', 'request', 'request_uri']);
function authorizationParameters(value) {
  if (!plain(value) || Object.keys(value).length > 24) fail('Invalid additional authorization parameters.');
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key) || reserved.has(key.toLowerCase()) ||
        /secret|token|password|assertion|authorization/i.test(key)) fail('Additional parameters cannot replace protocol fields or contain secrets.');
    text(item, 'authorization parameter', 2048, true);
    if (key === 'response_mode' && item !== 'query') fail('This native callback requires response_mode=query.');
    output[key] = item;
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
}
export function normalizeOAuthProfile(raw, { allowLoopback = false } = {}) {
  exact(raw, ['schema', 'label', 'source', 'authorizationEndpoint', 'tokenEndpoint', 'revocationEndpoint',
    'issuer', 'clientId', 'clientSecretEnv', 'authMethod', 'scopes', 'resourceOrigins',
    'authorizationParameters', 'resourceParameters', 'pkceMethod'], 'OAuth profile');
  if (raw.schema !== PROFILE_SCHEMA || typeof allowLoopback !== 'boolean') fail('Use the authorization profile schema.');
  text(raw.label, 'provider label', 160);
  exact(raw.source, ['sha256', 'scheme'], 'original OpenAPI source');
  if (!hex(raw.source.sha256)) fail('Select the original OpenAPI byte hash.');
  text(raw.source.scheme, 'original security scheme', 160);
  const authorizationEndpoint = endpoint(raw.authorizationEndpoint, { allowLoopback, query: true });
  for (const key of new URL(authorizationEndpoint).searchParams.keys())
    if (reserved.has(key.toLowerCase()) || /secret|token|password|assertion|authorization/i.test(key))
      fail('The declared authorization URL contains a reserved protocol parameter.');
  const tokenEndpoint = endpoint(raw.tokenEndpoint, { allowLoopback });
  const authMethod = raw.authMethod ?? 'none';
  if (!['none', 'client_secret_basic', 'client_secret_post'].includes(authMethod)) fail('Choose a supported token endpoint authentication method.');
  text(raw.clientId, 'registered client ID', 4096);
  if (authMethod === 'none' ? raw.clientSecretEnv !== undefined : !envName(raw.clientSecretEnv))
    fail('Confidential clients require one client-secret environment reference; public clients omit it.');
  if (raw.pkceMethod !== undefined && raw.pkceMethod !== 'S256') fail('PKCE S256 is required.');
  if (!Array.isArray(raw.resourceOrigins) || raw.resourceOrigins.length < 1 || raw.resourceOrigins.length > 32 ||
      new Set(raw.resourceOrigins).size !== raw.resourceOrigins.length) fail('Select distinct approved upstream origins.');
  const resourceOrigins = raw.resourceOrigins.map(value => endpoint(value, { allowLoopback, origin: true })).sort();
  const resourceParameters = raw.resourceParameters ?? [];
  if (!Array.isArray(resourceParameters) || resourceParameters.length > 16 || new Set(resourceParameters).size !== resourceParameters.length)
    fail('Use distinct reviewed resource parameters.');
  for (const value of resourceParameters) {
    endpoint(value, { allowLoopback, query: true });
    if (!resourceOrigins.includes(new URL(value).origin)) fail('Each resource parameter must belong to an approved upstream origin.');
  }
  return {
    schema: PROFILE_SCHEMA, label: raw.label, source: { ...raw.source }, authorizationEndpoint, tokenEndpoint,
    ...(raw.revocationEndpoint === undefined ? {} : { revocationEndpoint: endpoint(raw.revocationEndpoint, { allowLoopback }) }),
    ...(raw.issuer === undefined ? {} : { issuer: endpoint(raw.issuer, { allowLoopback }) }),
    clientId: raw.clientId, authMethod, ...(raw.clientSecretEnv === undefined ? {} : { clientSecretEnv: raw.clientSecretEnv }),
    scopes: scopes(raw.scopes), resourceOrigins, authorizationParameters: authorizationParameters(raw.authorizationParameters ?? {}),
    resourceParameters: [...resourceParameters].sort(), pkceMethod: 'S256',
  };
}
export const oauthProfileIdentity = profile => identity(profile);
export function oauthCallbackPath(profileSha256) {
  if (!hex(profileSha256)) fail('Invalid connection profile identity.');
  return '/oauth/callback/' + profileSha256.slice(0, 24);
}
export function compileOAuthConnection(raw, { resourceOrigin, allowLoopback = false } = {}) {
  exact(raw, ['directoryEnv', 'profileSha256', 'grantId', 'requiredScopes', 'clientSecretEnv'], 'upstream OAuth connection');
  if (!envName(raw.directoryEnv) || !hex(raw.profileSha256) || !identifier(raw.grantId) ||
      raw.clientSecretEnv !== undefined && (!envName(raw.clientSecretEnv) || raw.clientSecretEnv === raw.directoryEnv))
    fail('Select the exact reviewed grant and private connection environment references.');
  if (resourceOrigin !== undefined) endpoint(resourceOrigin, { allowLoopback, origin: true });
  return Object.freeze({ directoryEnv: raw.directoryEnv, profileSha256: raw.profileSha256,
    grantId: raw.grantId, requiredScopes: Object.freeze(scopes(raw.requiredScopes, 'required operation scopes')),
    ...(raw.clientSecretEnv === undefined ? {} : { clientSecretEnv: raw.clientSecretEnv }) });
}
