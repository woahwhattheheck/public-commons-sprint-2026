// MIT. Serialized Redis deployment profiles; private values stay in the host.
import { record } from '../sqlite/parameters.mjs';

export const REDIS_CERTIFICATE_FILES = Object.freeze([
  Object.freeze({profile:'caFile', file:'database-ca.pem', fingerprint:'caSha256'}),
  Object.freeze({profile:'sentinelCaFile', file:'sentinel-ca.pem', fingerprint:'sentinelCaSha256'}),
]);
export function requiredRedisEnvironment(connection) {
  return connection.transport === 'upstash-rest' ? [connection.tokenEnv] :
    [...new Set([connection.passwordEnv, connection.sentinelPasswordEnv].filter(value => value !== undefined))];
}
const ENV = /^[A-Z_][A-Z0-9_]{0,127}$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const COMMON = ['database', 'username', 'passwordEnv', 'tls', 'caFile'];
const validText = value => typeof value === 'string' && value.isWellFormed() &&
  value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
const validHost = value => validText(value) && !/[\s/\\]/.test(value);
const validPort = value => Number.isInteger(value) && value >= 1 && value <= 65535;
const fail = code => { throw new TypeError(code); };
const localOnly = c => c.tls === 'local-plaintext' ||
  c.topology === 'sentinel' && c.sentinelTls === 'local-plaintext';

function credentials(username, passwordEnv) {
  if (username !== undefined && !validText(username) ||
      passwordEnv !== undefined && !ENV.test(passwordEnv)) fail('REDIS_CONNECTION_CREDENTIALS_INVALID');
}
function tlsProfile(mode, caFile) {
  if (!['verify-full', 'local-plaintext'].includes(mode ?? 'verify-full')) fail('REDIS_TLS_MODE_INVALID');
  if (caFile !== undefined && (!validText(caFile) || mode === 'local-plaintext')) fail('REDIS_CA_FILE_INVALID');
}
function endpoint(node, defaultPort) {
  if (!record(node) || Object.keys(node).some(key => !['host', 'port'].includes(key)) ||
      !validHost(node.host) || !validPort(node.port ?? defaultPort)) fail('REDIS_NODE_PROFILE_INVALID');
  return { host: node.host, port: node.port ?? defaultPort };
}
function roots(nodes, defaultPort) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > 16) fail('REDIS_ROOT_NODES_INVALID');
  const output = nodes.map(node => endpoint(node, defaultPort));
  if (new Set(output.map(node => node.host + ':' + node.port)).size !== output.length)
    fail('REDIS_ROOT_NODES_DUPLICATED');
  return output;
}
function advertisedEndpoint(address) {
  if (typeof address !== 'string') fail('REDIS_NODE_ADDRESS_INVALID');
  const colon = address.lastIndexOf(':');
  const host = address.slice(0, colon), port = address.slice(colon + 1);
  if (colon < 1 || !validHost(host) || !/^[0-9]{1,5}$/.test(port) || !validPort(Number(port)))
    fail('REDIS_NODE_ADDRESS_INVALID');
  return { host, port: Number(port) };
}
function addressMap(c) {
  if (c.nodeAddressMap === undefined) return undefined;
  if (!record(c.nodeAddressMap) || Object.keys(c.nodeAddressMap).length > 256)
    fail('REDIS_NODE_ADDRESS_MAP_INVALID');
  const entries = Object.entries(c.nodeAddressMap).map(([address, target]) => {
    advertisedEndpoint(address);
    // A translated address is explicit; it never inherits a seed port.
    if (!record(target) || !validPort(target.port)) fail('REDIS_NODE_ADDRESS_MAP_INVALID');
    return [address, endpoint(target, target.port)];
  });
  return Object.fromEntries(entries);
}
export function validateRedisConnectionProfile(c) {
  if (!record(c)) fail('REDIS_CONNECTION_PROFILE_INVALID');
  const topology = c.topology ?? 'standalone';
  const extra = topology === 'standalone' ? ['host', 'port'] :
    topology === 'cluster' ? ['rootNodes', 'nodeAddressMap'] :
    topology === 'sentinel' ? ['name', 'sentinelRootNodes', 'nodeAddressMap',
      'sentinelUsername', 'sentinelPasswordEnv', 'sentinelTls', 'sentinelCaFile'] : null;
  if (!extra || Object.keys(c).some(key => !['topology', ...COMMON, ...extra].includes(key)))
    fail('REDIS_CONNECTION_PROFILE_INVALID');
  if (c.database !== undefined && (!Number.isInteger(c.database) || c.database < 0 || c.database > 65535))
    fail('REDIS_DATABASE_INVALID');
  credentials(c.username, c.passwordEnv);
  tlsProfile(c.tls, c.caFile);
  let nodes;
  if (topology === 'standalone') {
    nodes = [endpoint({host:c.host, ...(c.port === undefined ? {} : {port:c.port})}, 6379)];
  } else if (topology === 'cluster') {
    if ((c.database ?? 0) !== 0) fail('REDIS_CLUSTER_REQUIRES_DATABASE_ZERO');
    nodes = roots(c.rootNodes, 6379);
  } else {
    if (!validText(c.name) || c.name.length > 128 || /\s/.test(c.name)) fail('REDIS_SENTINEL_NAME_INVALID');
    nodes = roots(c.sentinelRootNodes, 26379);
    credentials(c.sentinelUsername, c.sentinelPasswordEnv);
    tlsProfile(c.sentinelTls, c.sentinelCaFile);
  }
  const mapping = topology === 'standalone' ? undefined : addressMap(c);
  if (localOnly(c)) {
    // Plaintext is a local receiving mode. Apply it to discovery and mapped
    // destinations as well as the initial seed so promotion cannot leave it.
    for (const node of [...nodes, ...Object.values(mapping ?? {})])
      if (!LOOPBACK.has(node.host)) fail('REDIS_PLAINTEXT_REQUIRES_LOOPBACK');
  }
  return c;
}
function resolvedMap(c) {
  const mapping = addressMap(c);
  if (!localOnly(c)) return mapping;
  return address => {
    const target = Object.hasOwn(mapping ?? {}, address) ? mapping[address] : advertisedEndpoint(address);
    if (!LOOPBACK.has(target.host)) fail('REDIS_PLAINTEXT_REQUIRES_LOOPBACK');
    return target;
  };
}
function secret(environment, name) {
  if (name === undefined) return undefined;
  const value = environment[name];
  if (typeof value !== 'string' || !value.length || value.length > 16384 || value.includes('\0'))
    fail('REDIS_PASSWORD_ENV_UNAVAILABLE');
  return value;
}
async function socket(mode, caFile, readCertificate) {
  if (mode === 'local-plaintext') return {};
  const ca = caFile === undefined ? undefined : await readCertificate(caFile);
  return {tls:true, rejectUnauthorized:true, ...(ca === undefined ? {} : {ca})};
}
export async function resolveRedisConnectionProfile(connection, { environment = process.env, readCertificate } = {}) {
  const c = validateRedisConnectionProfile(connection);
  const topology = c.topology ?? 'standalone';
  const password = secret(environment, c.passwordEnv);
  const auth = {...(c.username ? {username:c.username} : {}), ...(password === undefined ? {} : {password})};
  const dataSocket = await socket(c.tls, c.caFile, readCertificate);
  if (topology === 'standalone') return {
    ...(c.topology === undefined ? {} : {topology}),
    socket:{host:c.host, port:c.port ?? 6379, ...dataSocket}, database:c.database ?? 0, ...auth
  };
  const mapping = resolvedMap(c);
  if (topology === 'cluster') return {
    topology, rootNodes:roots(c.rootNodes, 6379).map(node => ({socket:node})),
    defaults:{...auth, socket:dataSocket}, ...(mapping === undefined ? {} : {nodeAddressMap:mapping})
  };
  const sentinelPassword = secret(environment, c.sentinelPasswordEnv);
  return {
    topology, name:c.name, sentinelRootNodes:roots(c.sentinelRootNodes, 26379),
    nodeClientOptions:{...auth, database:c.database ?? 0, socket:dataSocket},
    sentinelClientOptions:{
      ...(c.sentinelUsername ? {username:c.sentinelUsername} : {}),
      ...(sentinelPassword === undefined ? {} : {password:sentinelPassword}),
      socket:await socket(c.sentinelTls, c.sentinelCaFile, readCertificate)
    },
    ...(mapping === undefined ? {} : {nodeAddressMap:mapping})
  };
}
export function describeRedisConnectionProfile(connection) {
  const c = validateRedisConnectionProfile(connection), topology = c.topology ?? 'standalone';
  return {transport:'resp', topology, ...(topology === 'cluster' ? {seedCount:c.rootNodes.length} :
    topology === 'sentinel' ? {seedCount:c.sentinelRootNodes.length} : {})};
}
