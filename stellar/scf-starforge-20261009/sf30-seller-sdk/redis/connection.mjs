// MIT. Redis 6.2.1 transports behind one exclusively owned query connection.
export class RedisConnectionError extends Error {
  constructor(code) { super(code); this.name = 'RedisConnectionError'; this.code = code; }
}
const invalid = () => { throw new TypeError('REDIS_CONNECTION_INVALID'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// A logical connection owns all native sockets used by its topology. Destruction
// is terminal, idempotent and includes an in-flight discovery/connect operation.
function ownedConnection(native, topology, socketAbort) {
  let disposed = false, opening, destruction;
  const commands = new Set();
  // A failed Cluster/Sentinel seed emits an error before the driver tries the
  // next seed. The awaited connect/command result decides whether a read failed.
  native.on('error', () => {});
  async function destroyNative() {
    // 6.2.1 Cluster.destroy() can stop at an already-closed node because the
    // underlying RedisClient.destroy() throws. Snapshot public existing nodes;
    // never call nodeClient(), which could open a connection during shutdown.
    const nodes = topology === 'cluster'
      ? new Set([...native.nodeByAddress.values()].flatMap(node => [node.client, node.pubSub?.client])
        .concat(native.pubSubNode?.client).filter(Boolean)) : undefined;
    try { await native.destroy(); } catch { /* Native socket already closed. */ }
    if (nodes) for (const client of nodes) {
      if (client.isOpen) {
        try { await client.destroy(); } catch { /* Another native close won. */ }
      }
    }
  }
  const connection = {
    get isOpen() { return !disposed && native.isOpen; },
    get isReady() { return !disposed && native.isReady; },
    connect() {
      if (disposed) return Promise.reject(new RedisConnectionError('SOURCE_CLOSED'));
      if (!opening) {
        opening = (async () => {
          if (!native.isOpen) await native.connect();
          if (disposed) throw new RedisConnectionError('SOURCE_CLOSED');
          return connection;
        })();
      }
      return opening;
    },
    sendCommand(args, { key, ...options } = {}) {
      if (disposed) return Promise.reject(new RedisConnectionError('SOURCE_CLOSED'));
      // The public signatures differ in @redis/client 6.2.1. Every application
      // script has one bound key; the startup capability probe is keyless.
      let command;
      try {
        command = Promise.resolve(topology === 'cluster'
          ? native.sendCommand(key, true, args, options)
          : topology === 'sentinel' ? native.sendCommand(true, args, options)
          : native.sendCommand(args, options));
      } catch (issue) { return Promise.reject(issue); }
      commands.add(command);
      command.then(() => commands.delete(command), () => commands.delete(command));
      return command;
    },
    destroy() {
      disposed = true;
      if (!destruction) destruction = (async () => {
        // Set the native terminal latch before aborting its current and future
        // sockets. Sentinel otherwise keeps observing each remaining seed while
        // destroy() waits for that discovery promise to finish.
        const stopping = destroyNative();
        socketAbort?.abort();
        await stopping;
        // Cluster discovery and Sentinel destruction can finish asynchronously.
        // Do not make connect() await this promise: that would form a cycle.
        if (opening) await opening.catch(() => {});
        // An active command may have started a Cluster rediscovery or a
        // Sentinel reset after opening finished. Join it before the final sweep.
        while (commands.size) await Promise.allSettled([...commands]);
        // Discovery may populate node records even after isOpen became false.
        await destroyNative();
      })();
      return destruction;
    },
  };
  return Object.freeze(connection);
}

/**
 * Consume the resolved private connection object, never a serialized merchant
 * profile. Address/secret validation belongs to connection-profile.mjs.
 */
export async function createRedisConnectionFactory(connection, { connectTimeoutMs = 5000, maxQueryTimeoutMs = 0 } = {}) {
  if (!object(connection) || !Number.isInteger(connectTimeoutMs) || connectTimeoutMs < 100 || connectTimeoutMs > 30000 ||
      !Number.isInteger(maxQueryTimeoutMs) || maxQueryTimeoutMs < 0 || maxQueryTimeoutMs > 30000)
    invalid();
  const topology = connection.topology ?? 'standalone';
  if (!['standalone', 'cluster', 'sentinel'].includes(topology)) invalid();
  if (topology === 'standalone' && !object(connection.socket)) invalid();
  if (topology === 'cluster') {
    if (!Array.isArray(connection.rootNodes) || !connection.rootNodes.length ||
        connection.rootNodes.some(node => !object(node) || !object(node.socket)) ||
        connection.database !== undefined && connection.database !== 0 ||
        connection.defaults?.database !== undefined && connection.defaults.database !== 0) invalid();
  }
  if (topology === 'sentinel' && (typeof connection.name !== 'string' || !connection.name ||
      !Array.isArray(connection.sentinelRootNodes) || !connection.sentinelRootNodes.length ||
      connection.sentinelRootNodes.some(node => !object(node)))) invalid();

  let createClient, createCluster, createSentinel, RESP_TYPES;
  try { ({ createClient, createCluster, createSentinel, RESP_TYPES } = await import('@redis/client')); }
  catch { throw new RedisConnectionError('REDIS_DRIVER_UNAVAILABLE'); }
  if (typeof createClient !== 'function' || typeof createCluster !== 'function' ||
      typeof createSentinel !== 'function' || !RESP_TYPES)
    throw new RedisConnectionError('REDIS_DRIVER_UNAVAILABLE');

  const commandOptions = { timeout: 0, typeMapping: { [RESP_TYPES.BLOB_STRING]: Buffer } };
  // Keep the application query deadline authoritative after connection. The
  // socket deadline bounds stalled native cleanup and leaves the query 100ms
  // to report its own timeout before socket inactivity can preempt it.
  const dataInactivityMs = Math.max(connectTimeoutMs, maxQueryTimeoutMs + 100);
  const optionsFor = (options = {}, { control = false, discovery = false, signal } = {}) => ({
    ...options,
    RESP: 2,
    disableClientInfo: true,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 16,
    commandOptions: control ? { timeout: connectTimeoutMs } : commandOptions,
    // Native AUTH/HELLO handshakes bypass commandOptions.timeout. A finite
    // inactivity deadline also covers a seed that accepts TCP and stays silent.
    // Native pings start only after readiness and wait for each PING response.
    ...(discovery ? { pingInterval: Math.max(50, Math.floor((control ? connectTimeoutMs : dataInactivityMs) / 2)) } : {}),
    socket: {
      ...options.socket,
      connectTimeout: connectTimeoutMs,
      reconnectStrategy: false,
      ...(signal ? { signal } : {}),
      ...(discovery ? { socketTimeout: control ? connectTimeoutMs : dataInactivityMs } : {}),
    },
  });

  const create = () => {
    // Node's public TCP/TLS socket signal also reaches transient discovery
    // clients and future rediscovery sockets created from these same options.
    const socketAbort = topology === 'standalone' ? undefined : new AbortController();
    const signal = socketAbort?.signal;
    let native;
    if (topology === 'standalone') {
      const { topology: _topology, ...options } = connection;
      native = createClient(optionsFor(options));
    } else if (topology === 'cluster') {
      const defaults = optionsFor({ ...connection.defaults, database: 0 }, { discovery: true, signal });
      // Explicit seed options share the same authentication and TLS as every
      // discovered node. The only per-seed settings are its socket endpoint.
      const rootNodes = connection.rootNodes.map(node => optionsFor({
        ...defaults, socket: { ...defaults.socket, ...node.socket },
      }, { control: true, discovery: true, signal }));
      native = createCluster({
        RESP: 2, rootNodes, defaults, commandOptions,
        useReplicas: false, minimizeConnections: true,
        ...(connection.nodeAddressMap !== undefined ? { nodeAddressMap: connection.nodeAddressMap } : {}),
      });
    } else {
      native = createSentinel({
        RESP: 2, name: connection.name,
        sentinelRootNodes: connection.sentinelRootNodes.map(node => ({ ...node })),
        nodeClientOptions: optionsFor(connection.nodeClientOptions, { discovery: true, signal }),
        sentinelClientOptions: optionsFor(connection.sentinelClientOptions, { control: true, discovery: true, signal }),
        commandOptions,
        masterPoolSize: 1, replicaPoolSize: 0, reserveClient: false,
        // 6.2.1 defaults this to zero. Poll as well as listening to the native
        // Sentinel topology events so a missed notification is recoverable.
        scanInterval: 1000,
        ...(connection.nodeAddressMap !== undefined ? { nodeAddressMap: connection.nodeAddressMap } : {}),
      });
    }
    return ownedConnection(native, topology, socketAbort);
  };
  return Object.freeze({ create, topology, transport: 'resp', driver: '@redis/client@6.2.1' });
}
