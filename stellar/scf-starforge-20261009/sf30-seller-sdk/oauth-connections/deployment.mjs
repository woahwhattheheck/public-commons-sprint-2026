// MIT. Explicit private OAuth stores for the existing merchant host, never packaged grants.
import { isAbsolute, resolve } from 'node:path';
import { oauthConnectionStatus } from './connection.mjs';
import { compileOAuthConnection, normalizeOAuthProfile, oauthProfileIdentity, envName } from './profile.mjs';
import { inspectOAuthHostDirectory } from './host.mjs';

const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const need = (yes, message) => { if (!yes) throw Object.assign(new Error(message), { code: 'OAUTH_HOST_DEPLOYMENT' }); };
const inside = (root, file) => file === root || file.startsWith(root + '/');
const overlaps = (a, b) => inside(a, b) || inside(b, a);
function path(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    value !== '/' && !/[\\\x00-\x1f\x7f]/.test(value),
  'Each OAuth host directory must be an absolute normalized private path.');
  return value;
}

/** Extract only public original upstream references, without resolving environment values. */
export function oauthUpstreamRequirements(configuration) {
  need(plain(configuration) && plain(configuration.bindings), 'Original upstream bindings are required.');
  return Object.entries(configuration.bindings).flatMap(([binding, raw]) => {
    if (!plain(raw) || raw.oauthConnection === undefined) return [];
    return [{ binding, origin: raw.origin, connection: structuredClone(raw.oauthConnection) }];
  });
}

/**
 * Pure deployment planning. The operator provisions these paths independently;
 * no directory is created and no grant, token or environment value is read.
 */
export function prepareOAuthHostDirectories(mappings = {}, requirements = [], {
  sourceRoot, stateRoot, inputs = [], environmentFile = null, allowLoopback = false,
} = {}) {
  need(plain(mappings) && Object.keys(mappings).length <= 64 &&
    Object.keys(mappings).every(envName), 'oauthDirectories must map selected environment names to private host paths.');
  need(Array.isArray(requirements) && requirements.length <= 64,
    'Use the original bounded OAuth upstream requirements.');
  const grouped = new Map();
  for (const item of requirements) {
    need(plain(item) && typeof item.binding === 'string' && item.binding.length <= 128,
      'The original OAuth binding name is required.');
    compileOAuthConnection(item.connection, { resourceOrigin: item.origin, allowLoopback });
    const key = item.connection.directoryEnv;
    const group = grouped.get(key) ?? [];
    const existing = group.find(value => value.binding === item.binding);
    need(!existing || JSON.stringify(existing) === JSON.stringify(item),
      'A host binding names different OAuth grants.');
    if (!existing) group.push(structuredClone(item));
    grouped.set(key, group);
  }
  const names = [...grouped.keys()].sort();
  need(JSON.stringify(Object.keys(mappings).sort()) === JSON.stringify(names),
    'Declare exactly the OAuth directory environment names used by the selected original upstreams.');
  need(!names.length || environmentFile,
    'OAuth deployments require the original private environmentFile with their directory references.');
  const excluded = [sourceRoot, stateRoot, environmentFile, ...inputs].filter(Boolean).map(path);
  const paths = [];
  return names.map(directoryEnv => {
    const directory = path(mappings[directoryEnv]);
    need(!excluded.some(other => overlaps(directory, other)) &&
      !paths.some(other => overlaps(directory, other)),
    'Keep each private OAuth store separate from source, merchant state, configuration and other OAuth stores.');
    paths.push(directory);
    const bindings = grouped.get(directoryEnv).sort((a, b) => a.binding.localeCompare(b.binding));
    const first = bindings[0].connection;
    need(bindings.every(item => item.connection.profileSha256 === first.profileSha256 &&
      item.connection.grantId === first.grantId &&
      (item.connection.clientSecretEnv ?? null) === (first.clientSecretEnv ?? null)),
    'One private OAuth directory must reference one exact profile and approved grant.');
    return { directoryEnv, directory, allowLoopback: allowLoopback === true, bindings };
  });
}

/** Validate the saved original host topology before mounting or launching any writer. */
export function validateOAuthHostDirectories(host, { bundle } = {}) {
  const entries = host.oauthConnections ?? [];
  need(Array.isArray(entries) && entries.length <= 64, 'Invalid retained OAuth host connections.');
  const mappings = Object.create(null), requirements = [];
  let allowLoopback = null;
  for (const entry of entries) {
    need(plain(entry) && Object.keys(entry).every(key =>
      ['directoryEnv', 'directory', 'allowLoopback', 'bindings'].includes(key)) &&
      envName(entry.directoryEnv) && typeof entry.allowLoopback === 'boolean' &&
      Array.isArray(entry.bindings) && entry.bindings.length > 0 &&
      !Object.prototype.hasOwnProperty.call(mappings, entry.directoryEnv),
    'Invalid retained private OAuth directory declaration.');
    allowLoopback ??= entry.allowLoopback;
    need(allowLoopback === entry.allowLoopback, 'OAuth host loopback selection differs across bindings.');
    mappings[entry.directoryEnv] = entry.directory;
    requirements.push(...entry.bindings);
  }
  const expected = prepareOAuthHostDirectories(mappings, requirements, {
    sourceRoot: host.sourceRoot, stateRoot: host.stateRoot, environmentFile: host.environmentFile,
    inputs: [host.planFile, ...(host.inputFiles ?? []).map(item => item.path)],
    allowLoopback: allowLoopback === true,
  });
  need(JSON.stringify(expected) === JSON.stringify(entries),
    'The retained OAuth host directories differ from their original public binding requirements.');
  if (bundle) need(!entries.some(entry => overlaps(path(bundle), entry.directory)),
    'Keep the deployment bundle separate from every private OAuth store.');
  return entries;
}

/**
 * Launch-time check, under the actual service account and environment.
 * Reads private state through its original public-status API. No token exchange,
 * authorization, grant refresh or revocation is dispatched by this operation.
 */
export async function checkOAuthHostConnections(host, {
  env = process.env, ownerUid = process.geteuid?.() ?? process.getuid?.(),
} = {}) {
  const entries = validateOAuthHostDirectories(host, { bundle: host.bundle });
  const checked = [];
  for (const entry of entries) {
    need(env?.[entry.directoryEnv] === entry.directory,
      'The runtime OAuth directory reference differs from its reviewed host declaration: ' + entry.directoryEnv + '.');
    await inspectOAuthHostDirectory(entry.directory, { directoryEnv: entry.directoryEnv, ownerUid });
    let current;
    try { current = await oauthConnectionStatus(entry.directory, { allowLoopback: entry.allowLoopback }); }
    catch { need(false, 'Read the original private OAuth connection status for ' + entry.directoryEnv + '.'); }
    const profile = normalizeOAuthProfile(current.profile, { allowLoopback: entry.allowLoopback });
    const identity = oauthProfileIdentity(profile);
    need(current.profileSha256 === identity && current.grant?.state === 'connected' &&
      current.grant.id && current.grant.review && Array.isArray(current.grant.scopes),
    'The selected OAuth connection needs a current explicitly reviewed grant: ' + entry.directoryEnv + '.');
    for (const item of entry.bindings) {
      const value = item.connection;
      need(value.profileSha256 === identity && value.grantId === current.grant.id &&
        (value.clientSecretEnv ?? null) === (profile.clientSecretEnv ?? null) &&
        profile.resourceOrigins.includes(item.origin) &&
        value.requiredScopes.every(scope => profile.scopes.includes(scope) && current.grant.scopes.includes(scope)),
      'The current OAuth profile, grant, origin or scopes changed. Save and select its reviewed merchant package.');
    }
    if (profile.clientSecretEnv) need(typeof env[profile.clientSecretEnv] === 'string' &&
      env[profile.clientSecretEnv].length > 0,
    'Provision the selected OAuth client-secret environment reference.');
    checked.push({ directoryEnv: entry.directoryEnv, bindings: entry.bindings.length,
      profileSha256: identity, grantId: current.grant.id, state: current.grant.state });
  }
  return { connections: checked, checked: checked.length, networkRequests: 0, credentialValuesReturned: false };
}
