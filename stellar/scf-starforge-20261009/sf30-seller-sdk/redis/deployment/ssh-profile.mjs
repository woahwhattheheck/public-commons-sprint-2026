// MIT. SSH node inventory compiled into the original Redis connection profile.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { validateRedisConnectionProfile, requiredRedisEnvironment } from '../connection-profile.mjs';
import { normalizeRedisCommissioning } from '../workspace/commission.mjs';

export const REDIS_SSH_DEPLOYMENT_SCHEMA = 'stellar-forge.redis-ssh-deployment.v1';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ordered = v => Array.isArray(v) ? v.map(ordered) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
export const redisSshDeploymentDigest = value =>
  createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const envName = /^[A-Z_][A-Z0-9_]{0,127}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const own = (value, name) => Object.hasOwn(value, name);
function issue(code, message, details) {
  return Object.assign(new Error(message), {code, ...(details ? {details} : {})});
}
function fields(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k)))
    throw issue('REDIS_SSH_FIELDS_INVALID', 'Use the supported ' + label + ' fields.');
}
function identifier(value, label) {
  if (typeof value !== 'string' || !idPattern.test(value))
    throw issue('REDIS_SSH_ID_INVALID', label + ' needs 1–80 letters, digits, underscores or hyphens.');
}
function host(value, label) {
  if (typeof value !== 'string' || value.length > 253 ||
      !(isIP(value) || /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.?$/.test(value)))
    throw issue('REDIS_SSH_HOST_INVALID', label + ' must be an IP address or DNS hostname.');
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw issue('REDIS_SSH_LIMIT_INVALID', label + ' must be an integer from ' + min + ' to ' + max + '.');
}
function environmentReference(value, label, optional = false) {
  if (value === undefined && optional) return;
  if (typeof value !== 'string' || !envName.test(value))
    throw issue('REDIS_SSH_ENVIRONMENT_INVALID', label + ' needs an environment variable name.');
}
function endpoint(value) {
  fields(value, ['host','port'], 'announced endpoint');
  host(value.host, 'Announced host'); integer(value.port, 1, 65535, 'Announced port');
  return {host:value.host,port:value.port};
}

/**
 * The remote end of every forward is loopback on the SSH server itself. A
 * bastion-to-remote-plaintext hop is deliberately a different deployment.
 * Existing native Cluster/Sentinel discovery consumes the resulting address map.
 */
export function compileRedisSshDeployment(input) {
  fields(input, ['schema','id','connection','nodes','seeds','connectTimeoutMs',
    'startupTimeoutMs','closeTimeoutMs','keepAliveSeconds','maxMissedKeepAlives'], 'deployment');
  if (input.schema !== REDIS_SSH_DEPLOYMENT_SCHEMA)
    throw issue('REDIS_SSH_SCHEMA_INVALID', 'Use the Redis SSH deployment schema.');
  identifier(input.id, 'Deployment id');
  fields(input.connection, ['topology','database','username','passwordEnv','name',
    'sentinelUsername','sentinelPasswordEnv'], 'logical Redis connection');
  const topology = input.connection.topology;
  if (!['standalone','cluster','sentinel'].includes(topology))
    throw issue('REDIS_SSH_TOPOLOGY_INVALID', 'Select standalone, cluster or sentinel.');
  if (topology !== 'sentinel' && ['name','sentinelUsername','sentinelPasswordEnv'].some(k => own(input.connection,k)))
    throw issue('REDIS_SSH_TOPOLOGY_FIELDS_INVALID', 'Sentinel credentials and group name belong to a Sentinel deployment.');
  if (!Array.isArray(input.nodes) || !input.nodes.length || input.nodes.length > 64)
    throw issue('REDIS_SSH_NODES_INVALID', 'Declare 1–64 complete database or Sentinel nodes.');
  const nodes = [], identifiers = new Set(), localPorts = new Set(), aliases = new Map();
  const required = new Set();
  for (const supplied of input.nodes) {
    fields(supplied, ['id','role','aliases','localPort','remoteHost','remotePort','ssh'], 'node');
    identifier(supplied.id, 'Node id');
    if (identifiers.has(supplied.id)) throw issue('REDIS_SSH_NODE_DUPLICATED', 'Each node id must be unique.');
    identifiers.add(supplied.id);
    if (!['data','sentinel'].includes(supplied.role) ||
        topology !== 'sentinel' && supplied.role !== 'data')
      throw issue('REDIS_SSH_NODE_ROLE_INVALID', 'Use the node role from the selected deployment.');
    integer(supplied.localPort, 1, 65535, 'Local forwarded port');
    integer(supplied.remotePort, 1, 65535, 'Remote database port');
    if (localPorts.has(supplied.localPort))
      throw issue('REDIS_SSH_LOCAL_PORT_DUPLICATED', 'Give every forward its own local port.');
    localPorts.add(supplied.localPort);
    const remoteHost = supplied.remoteHost ?? '127.0.0.1';
    if (!['127.0.0.1','::1'].includes(remoteHost))
      throw issue('REDIS_SSH_REMOTE_LOOPBACK_REQUIRED',
        'The database must be on loopback of this SSH host. Select a direct TLS profile for a separate remote hop.');
    fields(supplied.ssh, ['host','port','user','identityFileEnv','agentSocketEnv','knownHostsFileEnv'], 'SSH connection');
    host(supplied.ssh.host, 'SSH host');
    integer(supplied.ssh.port ?? 22, 1, 65535, 'SSH port');
    if (typeof supplied.ssh.user !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(supplied.ssh.user))
      throw issue('REDIS_SSH_USER_INVALID', 'Set the provider-issued SSH login name.');
    environmentReference(supplied.ssh.knownHostsFileEnv, 'Known-hosts file');
    environmentReference(supplied.ssh.identityFileEnv, 'SSH identity file', true);
    environmentReference(supplied.ssh.agentSocketEnv, 'SSH agent socket', true);
    if (!supplied.ssh.identityFileEnv && !supplied.ssh.agentSocketEnv)
      throw issue('REDIS_SSH_AUTHENTICATION_REQUIRED', 'Reference an SSH identity file or an explicitly selected agent socket.');
    for (const name of ['knownHostsFileEnv','identityFileEnv','agentSocketEnv'])
      if (supplied.ssh[name]) required.add(supplied.ssh[name]);
    if (!Array.isArray(supplied.aliases) || !supplied.aliases.length || supplied.aliases.length > 16)
      throw issue('REDIS_SSH_ALIASES_INVALID', 'List every address this node can announce during discovery.');
    const addresses = supplied.aliases.map(endpoint);
    for (const address of addresses) {
      const key = address.host + ':' + address.port;
      if (aliases.has(key))
        throw issue('REDIS_SSH_ALIAS_DUPLICATED', 'An announced endpoint must identify exactly one owned forward.', {address:key});
      aliases.set(key, {host:'127.0.0.1',port:supplied.localPort});
    }
    nodes.push({...supplied,remoteHost,aliases:addresses,ssh:{...supplied.ssh,port:supplied.ssh.port??22}});
  }
  if (aliases.size > 256)
    throw issue('REDIS_SSH_ALIAS_LIMIT', 'The original Redis profile supports at most 256 announced endpoints.');
  const data = nodes.filter(n => n.role === 'data'), monitors = nodes.filter(n => n.role === 'sentinel');
  if (!data.length || topology === 'sentinel' && !monitors.length ||
      topology === 'standalone' && nodes.length !== 1)
    throw issue('REDIS_SSH_TOPOLOGY_NODES_INVALID', 'Declare all data nodes and the selected topology’s monitor nodes.');
  if (!Array.isArray(input.seeds) || !input.seeds.length || input.seeds.length > 16 ||
      new Set(input.seeds).size !== input.seeds.length)
    throw issue('REDIS_SSH_SEEDS_INVALID', 'Select 1–16 distinct declared seed node ids.');
  const selected = input.seeds.map(id => {
    const node = nodes.find(n => n.id === id);
    if (!node || node.role !== (topology === 'sentinel' ? 'sentinel' : 'data'))
      throw issue('REDIS_SSH_SEED_ROLE_INVALID', 'Seeds must reference the declared discovery nodes.');
    return {host:'127.0.0.1',port:node.localPort};
  });
  const connection = {...input.connection,tls:'local-plaintext'};
  if (topology === 'standalone') {
    if (selected.length !== 1) throw issue('REDIS_SSH_STANDALONE_SEED_INVALID', 'Select the one standalone node.');
    Object.assign(connection,selected[0]);
  } else {
    const mapping = new Map(aliases);
    // Native clients may revisit an already translated endpoint. Retain those
    // exact local destinations too, while rejecting all unreviewed discovery.
    for (const node of nodes) {
      const address = '127.0.0.1:' + node.localPort;
      const retained = mapping.get(address);
      if (retained && (retained.host !== '127.0.0.1' || retained.port !== node.localPort))
        throw issue('REDIS_SSH_LOCAL_ALIAS_AMBIGUOUS',
          'A forwarded endpoint conflicts with a different announced node. Select another local port.');
      mapping.set(address, {host:'127.0.0.1',port:node.localPort});
    }
    if (mapping.size > 256)
      throw issue('REDIS_SSH_ALIAS_LIMIT', 'Declared and forwarded endpoints together must fit the 256-entry address map.');
    connection.nodeAddressMap = Object.fromEntries(mapping);
    connection.nodeAddressPolicy = 'mapped-only';
    if (topology === 'cluster') connection.rootNodes = selected;
    else Object.assign(connection,{sentinelRootNodes:selected,sentinelTls:'local-plaintext'});
  }
  validateRedisConnectionProfile(connection);
  for (const name of requiredRedisEnvironment(connection)) required.add(name);
  const limits = {
    connectTimeoutMs:input.connectTimeoutMs??10000,
    startupTimeoutMs:input.startupTimeoutMs??60000,
    closeTimeoutMs:input.closeTimeoutMs??5000,
    keepAliveSeconds:input.keepAliveSeconds??10,
    maxMissedKeepAlives:input.maxMissedKeepAlives??3,
  };
  integer(limits.connectTimeoutMs, 1000, 120000, 'SSH connection timeout');
  integer(limits.startupTimeoutMs, 1000, 300000, 'Deployment startup timeout');
  integer(limits.closeTimeoutMs, 100, 30000, 'Shutdown timeout');
  integer(limits.keepAliveSeconds, 1, 60, 'SSH keepalive interval');
  integer(limits.maxMissedKeepAlives, 1, 10, 'Unanswered keepalive limit');
  if (limits.startupTimeoutMs < limits.connectTimeoutMs)
    throw issue('REDIS_SSH_STARTUP_TIMEOUT_INVALID', 'Startup timeout must cover one complete SSH authentication.');
  const digest = redisSshDeploymentDigest(input);
  return {
    schema:'stellar-forge.redis-ssh-deployment-review.v1',id:input.id,deploymentSha256:digest,
    connection,nodes,limits,requiredEnvironment:[...required].sort(),
    review:{topology,dataNodes:data.length,sentinelNodes:monitors.length,seedCount:selected.length,
      forwardedPorts:nodes.length,announcedEndpoints:aliases.size,localAddress:'127.0.0.1',
      hostAuthentication:'pinned-known-hosts',remoteDatabaseHop:'ssh-host-loopback'},
  };
}

export function prepareRedisSshCommissioning({input,deployment,environment=process.env}={}) {
  const compiled = compileRedisSshDeployment(deployment);
  if (!object(input) || !object(input.setup) || !object(input.setup.source))
    throw issue('REDIS_SSH_COMMISSIONING_INPUT_REQUIRED', 'Select the original complete Redis commissioning input.');
  const selected = structuredClone(input);
  selected.setup.source.connection = structuredClone(compiled.connection);
  const replacedCertificateKeys = Object.keys(selected.setup.certificates??{});
  selected.setup.certificates = {};
  const normalized = normalizeRedisCommissioning(selected,environment);
  return {input:selected,deploymentSha256:compiled.deploymentSha256,
    review:{...compiled.review,commissioning:normalized.review,replacedCertificateKeys},
    requiredEnvironment:compiled.requiredEnvironment};
}
