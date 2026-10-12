// MIT. Reviewed receiving boundary for the original OpenAPI authoring host.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readOAuthHostConnections, inspectOAuthHostDirectory } from '../../sf30-seller-sdk/oauth-connections/host.mjs';
import { oauthConnectionStatus } from '../../sf30-seller-sdk/oauth-connections/connection.mjs';
import { oauthRedirectOrigin, plain, hex, envName } from '../../sf30-seller-sdk/oauth-connections/profile.mjs';

export const OPENAPI_BINDING_SCHEMA = 'stellar-forge.openapi-managed-binding.v1';
export const OPENAPI_STARTUP_SCHEMA = 'stellar-forge.openapi-workspace-startup.v1';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ?
  value : JSON.stringify(canonical(value))).digest('hex');
const failure = (code, message) => Object.assign(new Error(message), { code, status: 409 });
const need = (condition, code, message) => { if (!condition) throw failure(code, message); };
const absolute = value => {
  need(typeof value === 'string' && isAbsolute(value) && value !== '/' && resolve(value) === value &&
    !/[\\\x00-\x1f\x7f]/.test(value), 'OPENAPI_MANAGED_PATH',
  'Select an absolute canonical local path without control characters.');
  return value;
};
const sourceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const within = (root, value) => { const part = relative(root, value); return part === '' || !part.startsWith('..' + sep) && part !== '..' && !isAbsolute(part); };
const ownerUid = () => process.geteuid?.() ?? process.getuid?.();
const inode = info => ({ device: String(info.dev), inode: String(info.ino), uid: info.uid });

async function outputDirectory(value, allowMissing) {
  const directory = absolute(value);
  need(await realpath(dirname(directory)) === dirname(directory), 'OPENAPI_MANAGED_PATH',
    'Select a projects directory beneath its real parent.');
  try {
    const info = await lstat(directory);
    need(info.isDirectory() && !info.isSymbolicLink() && await realpath(directory) === directory &&
      !(info.mode & 0o077) && (ownerUid() === undefined || info.uid === ownerUid()),
    'OPENAPI_MANAGED_DIRECTORY', 'Use a private projects directory owned by the operator.');
    return { directory, exists: true, ...inode(info) };
  } catch (error) {
    if (error.code !== 'ENOENT' || !allowMissing) throw error;
    const parent = await lstat(dirname(directory));
    need(parent.isDirectory() && !(parent.mode & 0o077) &&
      (ownerUid() === undefined || parent.uid === ownerUid()),
    'OPENAPI_MANAGED_DIRECTORY', 'Create a new projects directory in an existing private parent.');
    return { directory, exists: false, parent: { directory: dirname(directory), ...inode(parent) } };
  }
}

async function registryFile(value) {
  const path = absolute(value);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= 65536 && !(before.mode & 0o022) &&
      await realpath(path) === path, 'OPENAPI_MANAGED_REGISTRY',
    'Select the original regular OAuth host configuration without group or world write access.');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    need(bytes.length === before.size && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'OPENAPI_MANAGED_REGISTRY_CHANGED', 'The host configuration changed during review.');
    // The original host reader is the authority for its schema and aliases.
    const definitions = await readOAuthHostConnections(path);
    const current = await lstat(path);
    need(current.dev === before.dev && current.ino === before.ino &&
      current.size === before.size && current.mtimeMs === before.mtimeMs &&
      current.ctimeMs === before.ctimeMs, 'OPENAPI_MANAGED_REGISTRY_CHANGED',
    'The host configuration changed during review.');
    return { definitions, identity: { path, bytes: bytes.length, sha256: hash(bytes), ...inode(before) } };
  } finally { await handle.close(); }
}

function projection(alias, status, directory, identity, localOrigin) {
  need(status.schema === 'stellar-forge.oauth-connection-status.v1' && hex(status.profileSha256) &&
    plain(status.profile) && plain(status.profile.source), 'OPENAPI_MANAGED_PROFILE',
  'Select a private store initialized by the original OAuth connection command.');
  const profile = status.profile;
  const callbackUri = oauthRedirectOrigin(profile, localOrigin) + status.callbackPath;
  return {
    alias: alias.alias, directoryEnv: alias.directoryEnv,
    directory: { directory, ...identity }, profileSha256: status.profileSha256,
    source: { ...profile.source }, label: profile.label,
    authorizationOrigin: new URL(profile.authorizationEndpoint).origin,
    tokenOrigin: new URL(profile.tokenEndpoint).origin,
    resourceOrigins: [...profile.resourceOrigins], scopeCount: profile.scopes.length,
    clientSecretEnv: profile.clientSecretEnv ?? null,
    callbackPath: status.callbackPath, callbackUri,
  };
}

/**
 * Read only the original public profile projection and private directory identity.
 * The connection's mutable grant, token, command journal and revision are never
 * copied into a managed application or its launch fingerprint.
 */
export async function inspectOpenApiLaunch({
  outputParent, port = 0, oauthConnectionsFile = null, allowLoopbackOAuth = false,
} = {}, { env = process.env, allowMissingOutput = false } = {}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'OPENAPI_MANAGED_PORT',
    'Select an original local listener port from 0 through 65535.');
  need(typeof allowLoopbackOAuth === 'boolean' && env !== null && typeof env === 'object' && !Array.isArray(env), 'OPENAPI_MANAGED_OPTIONS',
    'Use an explicit host environment and local-development selection.');
  const environment = { ...env };
  const output = await outputDirectory(outputParent, allowMissingOutput);
  const selected = oauthConnectionsFile ? await registryFile(oauthConnectionsFile) :
    { definitions: [], identity: null };
  need(!allowLoopbackOAuth || oauthConnectionsFile, 'OPENAPI_MANAGED_OPTIONS',
    'Select the original host configuration before enabling a local development provider.');
  need(!selected.definitions.length || port > 0 && port !== 80, 'OPENAPI_MANAGED_CALLBACK_PORT',
    'OAuth connections need their fixed registered listener port. Use a nonzero port other than 80.');
  const localOrigin = selected.definitions.length ? 'http://127.0.0.1:' + port : null;
  const profiles = [], directories = new Set();
  for (const alias of selected.definitions) {
    need(envName(alias.directoryEnv) && own(environment, alias.directoryEnv),
      'OPENAPI_MANAGED_DIRECTORY_ENV', 'Provide the private directory reference named ' + alias.directoryEnv + '.');
    const directory = absolute(environment[alias.directoryEnv]);
    need(!within(output.directory, directory) && !within(directory, output.directory) &&
      !within(sourceRoot, directory) && !within(directory, sourceRoot),
    'OPENAPI_MANAGED_DIRECTORY_SEPARATION',
    'Keep each private OAuth store separate from merchant projects and installed source.');
    need(!directories.has(directory), 'OPENAPI_MANAGED_DIRECTORY_ALIAS',
      'Keep each original private connection store under one host alias.');
    directories.add(directory);
    const identity = await inspectOAuthHostDirectory(directory, { directoryEnv: alias.directoryEnv, ownerUid: ownerUid() });
    const status = await oauthConnectionStatus(directory, { allowLoopback: allowLoopbackOAuth });
    const after = await inspectOAuthHostDirectory(directory, { directoryEnv: alias.directoryEnv, ownerUid: ownerUid() });
    need(identity.device === after.device && identity.inode === after.inode && identity.uid === after.uid,
      'OPENAPI_MANAGED_DIRECTORY_CHANGED', 'A private connection directory changed during review.');
    profiles.push(projection(alias, status, directory, identity, localOrigin));
  }
  const binding = {
    schema: OPENAPI_BINDING_SCHEMA, output, port, allowLoopbackOAuth,
    registry: selected.identity, profiles,
  };
  const bindingSha256 = hash(binding);
  return {
    binding, bindingSha256, connections: selected.definitions,
    review: {
      schema: OPENAPI_BINDING_SCHEMA, bindingSha256, outputParent: output.directory,
      port, allowLoopbackOAuth, connectionsFile: selected.identity?.path ?? null,
      connectionsSha256: selected.identity?.sha256 ?? null,
      profiles: profiles.map(({ directory, ...profile }) => ({ ...profile, directory: directory.directory })),
    },
  };
}

function parseManagedArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length;) {
    const name = args[index++];
    if (name === '--allow-loopback-oauth' && !values.has(name)) { values.set(name, true); continue; }
    need(['--out-parent', '--port', '--oauth-connections', '--managed-launch-sha256'].includes(name) &&
      !values.has(name) && typeof args[index] === 'string' && args[index] &&
      !args[index].startsWith('--'), 'OPENAPI_MANAGED_ARGUMENTS',
    'Use the exact reviewed OpenAPI application command.');
    values.set(name, args[index++]);
  }
  need(values.has('--out-parent') && hex(values.get('--managed-launch-sha256')) &&
    /^(?:0|[1-9]\d{0,4})$/.test(values.get('--port') ?? '0'), 'OPENAPI_MANAGED_ARGUMENTS',
  'The managed command needs its exact projects directory, listener and reviewed launch SHA-256.');
  return {
    settings: {
      outputParent: absolute(values.get('--out-parent')),
      port: Number(values.get('--port') ?? 0),
      oauthConnectionsFile: values.has('--oauth-connections') ? absolute(values.get('--oauth-connections')) : null,
      allowLoopbackOAuth: values.has('--allow-loopback-oauth'),
    },
    expected: values.get('--managed-launch-sha256'),
  };
}

function activeProfiles(rows, binding) {
  need(Array.isArray(rows) && rows.length === binding.profiles.length,
    'OPENAPI_MANAGED_PROFILE_CHANGED', 'The running host must open every reviewed source registration.');
  for (const expected of binding.profiles) {
    const actual = rows.find(row => row.alias === expected.alias);
    need(actual && actual.directoryEnv === expected.directoryEnv &&
      actual.profileSha256 === expected.profileSha256 && actual.callbackPath === expected.callbackPath &&
      actual.profile?.source?.sha256 === expected.source.sha256 &&
      actual.profile?.source?.scheme === expected.source.scheme,
    'OPENAPI_MANAGED_PROFILE_CHANGED', 'The running host opened a different source registration.');
  }
}

/** Start and drain the original server; this module supplies no provider or grant engine. */
export async function startManagedOpenApiWorkspace(args, {
  startWorkspace, env = process.env, announce = value => process.stdout.write(JSON.stringify(value) + '\n'),
} = {}) {
  need(typeof startWorkspace === 'function' && typeof announce === 'function',
    'OPENAPI_MANAGED_HOST', 'Use the original OpenAPI workspace host.');
  const { settings, expected } = parseManagedArgs(args), environment = { ...env };
  const selected = await inspectOpenApiLaunch(settings, { env: environment });
  need(selected.bindingSha256 === expected, 'OPENAPI_MANAGED_INPUTS_CHANGED',
    'The registered source, callback, projects directory or private connection location changed. Review a new start.');
  let session;
  try {
    session = await startWorkspace({
      parent: settings.outputParent, port: settings.port,
      oauthConnections: selected.connections, env: environment,
      allowLoopbackOAuth: settings.allowLoopbackOAuth,
    });
    need(typeof session.connectionStatus === 'function', 'OPENAPI_MANAGED_HOST',
      'Use an installed OpenAPI host with its original public connection status reader.');
    activeProfiles(await session.connectionStatus(), selected.binding);
    // Reconcile configuration and directory identity once more before publishing
    // the private URL. No authorization has been initiated by opening this host.
    const current = await inspectOpenApiLaunch(settings, { env: environment });
    need(current.bindingSha256 === expected, 'OPENAPI_MANAGED_INPUTS_CHANGED',
      'The selected application inputs changed while the original host was opening.');
    const url = new URL(session.url), actualPort = Number(url.port || 80);
    need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
      !url.search && url.pathname === '/' && /^[a-f0-9]{64}$/.test(url.hash.slice(1)) &&
      (settings.port === 0 || settings.port === actualPort) && session.output === settings.outputParent,
    'OPENAPI_MANAGED_STARTUP', 'The original host must return its actual reviewed local workspace.');
    const startup = {
      schema: OPENAPI_STARTUP_SCHEMA, status: 'OPENAPI_WORKSPACE_READY',
      instanceId: randomUUID(), pid: process.pid, startedAt: new Date().toISOString(),
      outputParent: settings.outputParent, requestedPort: settings.port, port: actualPort,
      bindingSha256: expected, connectionsFile: settings.oauthConnectionsFile,
      connectionsSha256: selected.binding.registry?.sha256 ?? null,
      profileCount: selected.binding.profiles.length, allowLoopbackOAuth: settings.allowLoopbackOAuth,
      url: session.url,
    };
    await announce(startup);
    return { ...session, managed: startup };
  } catch (error) {
    if (session) {
      try { await session.close(); }
      catch (closeError) { throw new AggregateError([error, closeError], 'The original OpenAPI host failed and did not close cleanly.'); }
    }
    throw error;
  }
}
