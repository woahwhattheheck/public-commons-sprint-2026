// MIT. Trusted operator aliases over the original private OAuth connection core.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { openOAuthConnection } from './connection.mjs';
import { compileOAuthConnection, normalizeOAuthProfile, oauthProfileIdentity, envName, scopes as normalizeScopes } from './profile.mjs';

export const HOST_CONNECTIONS_SCHEMA = 'stellar-forge.oauth-host-connections.v1';
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const problem = (code, message) => Object.assign(new Error(message), { code });
const need = (yes, code, message) => { if (!yes) throw problem(code, message); };
const fields = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const aliasName = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function normalizeOAuthHostConnections(connections) {
  need(Array.isArray(connections) && connections.length <= 64,
    'OAUTH_HOST_CONFIGURATION', 'Configure at most 64 trusted OAuth connection aliases.');
  const aliases = new Set(), references = new Set();
  return connections.map(value => {
    need(fields(value, ['alias', 'directoryEnv']) && aliasName(value.alias) && envName(value.directoryEnv),
      'OAUTH_HOST_CONFIGURATION', 'Each OAuth connection needs an alias and a directory environment name.');
    need(!aliases.has(value.alias) && !references.has(value.directoryEnv),
      'OAUTH_HOST_CONFIGURATION', 'OAuth aliases and directory environment names must be unique.');
    aliases.add(value.alias); references.add(value.directoryEnv);
    return Object.freeze({ alias: value.alias, directoryEnv: value.directoryEnv });
  });
}

/** Read host-supplied public references only; request bodies never select this file. */
export async function readOAuthHostConnections(file) {
  need(typeof file === 'string' && isAbsolute(file) && resolve(file) === file,
    'OAUTH_HOST_CONFIGURATION', 'Use an absolute normalized host connection configuration path.');
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    need(before.isFile() && before.size <= 65536 && !(before.mode & 0o022) &&
      await realpath(file) === file,
    'OAUTH_HOST_CONFIGURATION', 'Use a regular host configuration without symlinks or group/world write access.');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    need(bytes.length <= 65536 && before.size === after.size && before.mtimeMs === after.mtimeMs,
      'OAUTH_HOST_CONFIGURATION', 'The host connection configuration changed while reading.');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    need(fields(value, ['schema', 'connections']) && value.schema === HOST_CONNECTIONS_SCHEMA,
      'OAUTH_HOST_CONFIGURATION', 'The original OAuth host connection configuration schema is required.');
    return normalizeOAuthHostConnections(value.connections);
  } catch (error) {
    if (error?.code === 'OAUTH_HOST_CONFIGURATION') throw error;
    throw problem('OAUTH_HOST_CONFIGURATION', 'Cannot read the selected OAuth host connection configuration.');
  } finally { await handle?.close(); }
}

/** Public name in errors; never include the resolved private path or its value. */
export async function inspectOAuthHostDirectory(directory, { directoryEnv, ownerUid } = {}) {
  need(typeof directory === 'string' && isAbsolute(directory) && directory !== '/' &&
    resolve(directory) === directory && !/[\\\x00-\x1f\x7f]/.test(directory),
  'OAUTH_HOST_DIRECTORY', 'Provision the selected OAuth directory as a private absolute canonical path.');
  try {
    const info = await lstat(directory);
    need(info.isDirectory() && !info.isSymbolicLink() && await realpath(directory) === directory &&
      (info.mode & 0o777) === 0o700 && (ownerUid === undefined || info.uid === ownerUid),
    'OAUTH_HOST_DIRECTORY', 'The selected OAuth directory must be a real private 0700 directory owned by its operator.');
    return { device: String(info.dev), inode: String(info.ino), uid: info.uid };
  } catch {
    throw problem('OAUTH_HOST_DIRECTORY', 'Provision the private OAuth store for ' +
      (envName(directoryEnv) ? directoryEnv : 'the selected connection') + '.');
  }
}

function requestedScopes(values) {
  try { return normalizeScopes(values, 'required operation scopes'); }
  catch { throw problem('OAUTH_HOST_BINDING', 'Select the exact unique scopes required by the source operation.'); }
}

/**
 * One original core per trusted alias. Public methods expose no path, token,
 * token hash, secret value, authorization verifier or provider response body.
 */
export async function openOAuthConnectionRegistry({
  connections = [], env = process.env, allowLoopback = false, lookup, agent,
} = {}) {
  const definitions = normalizeOAuthHostConnections(connections);
  need(env !== null && typeof env === 'object', 'OAUTH_HOST_CONFIGURATION', 'Host environment references are required.');
  const environment = { ...env }, entries = new Map(), directories = new Set();
  const ownerUid = process.geteuid?.() ?? process.getuid?.();
  let closed = false, closing = null;
  async function inspect(entry) {
    need(!closed, 'OAUTH_HOST_CLOSED', 'The OAuth connection registry is closed.');
    const current = await inspectOAuthHostDirectory(entry.directory, { directoryEnv: entry.directoryEnv, ownerUid });
    need(current.device === entry.identity.device && current.inode === entry.identity.inode,
      'OAUTH_HOST_DIRECTORY_CHANGED', 'The OAuth host directory changed; reopen the operator workspace.');
  }
  async function selected(alias) {
    need(aliasName(alias) && entries.has(alias), 'OAUTH_HOST_ALIAS', 'Choose a configured OAuth connection alias.');
    const entry = entries.get(alias); await inspect(entry); return entry;
  }
  const publicStatus = (entry, value) => ({ alias: entry.alias, directoryEnv: entry.directoryEnv, ...value });
  try {
    for (const item of definitions) {
      need(own(environment, item.directoryEnv), 'OAUTH_HOST_DIRECTORY',
        'Provision the directory environment reference for ' + item.directoryEnv + '.');
      const directory = environment[item.directoryEnv];
      const identity = await inspectOAuthHostDirectory(directory, { directoryEnv: item.directoryEnv, ownerUid });
      need(!directories.has(directory), 'OAUTH_HOST_CONFIGURATION', 'Configure each private OAuth store under one alias.');
      directories.add(directory);
      const core = await openOAuthConnection(directory, { env: environment, allowLoopback, lookup, agent });
      entries.set(item.alias, { ...item, directory, identity, core });
    }
  } catch (error) {
    await Promise.allSettled([...entries.values()].map(entry => entry.core.close()));
    throw error;
  }
  const registry = {
    async list() {
      need(!closed, 'OAUTH_HOST_CLOSED', 'The OAuth connection registry is closed.');
      return Promise.all([...entries.values()].map(async entry => {
        await inspect(entry); return publicStatus(entry, await entry.core.status());
      }));
    },
    async status(alias, options = {}) {
      const entry = await selected(alias);
      return publicStatus(entry, await entry.core.status(options));
    },
    async binding(alias, { requiredScopes, resourceOrigin, sourceSha256, scheme } = {}) {
      const entry = await selected(alias), current = await entry.core.status();
      const profile = normalizeOAuthProfile(current.profile, { allowLoopback });
      const profileSha256 = oauthProfileIdentity(profile);
      need(hex(sourceSha256) && typeof scheme === 'string' &&
        profile.source.sha256 === sourceSha256 && profile.source.scheme === scheme &&
        current.profileSha256 === profileSha256,
      'OAUTH_HOST_SOURCE_CHANGED', 'Choose a connection registered for this exact OpenAPI source and security scheme.');
      const scopes = requestedScopes(requiredScopes);
      need(profile.resourceOrigins.includes(resourceOrigin) &&
        scopes.every(value => profile.scopes.includes(value)),
      'OAUTH_HOST_BINDING', 'The selected source origin or requested scopes do not match this connection profile.');
      need(current.grant?.state === 'connected' && current.grant.id && current.grant.review &&
        Array.isArray(current.grant.scopes) && scopes.every(value => current.grant.scopes.includes(value)),
      'OAUTH_HOST_GRANT_REQUIRED', 'Approve a current authorization grant covering every selected operation scope.');
      const binding = {
        directoryEnv: entry.directoryEnv, profileSha256, grantId: current.grant.id, requiredScopes: scopes,
        ...(profile.clientSecretEnv ? { clientSecretEnv: profile.clientSecretEnv } : {}),
      };
      compileOAuthConnection(binding, { resourceOrigin, allowLoopback });
      return binding;
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        const results = await Promise.allSettled([...entries.values()].map(entry => entry.core.close()));
        entries.clear();
        if (results.some(result => result.status === 'rejected'))
          throw problem('OAUTH_HOST_CLOSE_FAILED', 'An OAuth connection did not close cleanly.');
      })();
      return closing;
    },
  };
  for (const method of ['begin', 'complete', 'approve', 'discard', 'refresh', 'disconnect', 'revoke']) {
    registry[method] = async (alias, args) => {
      const entry = await selected(alias);
      return entry.core[method](args);
    };
  }
  return Object.freeze(registry);
}
