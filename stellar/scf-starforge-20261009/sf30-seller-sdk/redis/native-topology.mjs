// MIT. Ephemeral native Redis 7 topology fixtures for the original merchant journey.
// All processes and keys belong to this fixture; customer credentials are generated
// locally and the retained merchant declarations contain environment references.
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, createCluster, createSentinel } from '@redis/client';
import { createRedisConnectionFactory } from './connection.mjs';
import { createRedisQuerySource } from './source.mjs';

const HOST = '127.0.0.1';
const NAME = 'sf30-merchant';
const READ_COMMANDS = ['+ping', '+eval_ro', '+strlen', '+get', '+hstrlen', '+hmget', '+zrange', '+xrange', '+select'];
const commandTimeout = 5000;
const pairs = values => Object.fromEntries(Array.from({ length: values.length / 2 }, (_, i) => [String(values[i * 2]), values[i * 2 + 1]]));
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (issue) { last = issue; }
    await delay(50);
  }
  throw new Error(message + (last ? ': ' + last.message : ''));
}
async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, HOST, resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function nodeOptions(port, password, database = 0, ca) {
  return { RESP: 2, username: 'default', password, database, disableClientInfo: true,
    disableOfflineQueue: true, commandOptions: { timeout: commandTimeout }, pingInterval: 1000,
    socket: { host: HOST, port, connectTimeout: 1000, socketTimeout: commandTimeout, reconnectStrategy: false,
      ...(ca ? { tls: true, rejectUnauthorized: true, ca } : {}) } };
}
function adminFacade(native, topology) {
  const send = args => topology === 'cluster'
    ? native.sendCommand(['INFO', 'WAIT'].includes(args[0]) ? undefined : args[1], false, args)
    : native.sendCommand(false, args);
  return { get isOpen() { return native.isOpen; }, destroy: () => native.destroy(),
    sendCommand: send, info: section => send(['INFO', section]),
    set: (key, value) => send(['SET', key, value]),
    hSet: (key, value) => send(['HSET', key, ...Object.entries(value).flat()]),
    zAdd: (key, rows) => send(['ZADD', key, ...rows.flatMap(row => [String(row.score), row.value])]),
  };
}


async function runOpenSsl(binary, args) {
  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = '';
  child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-4096); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000); timer.unref();
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('REDIS_TLS_CERTIFICATE_GENERATION_FAILED:' + (signal ?? code) + ':' + diagnostic));
    });
  });
}
async function createTlsAuthorities(directory) {
  const root = join(directory, 'certificates'), sourceDirectory = join(root, 'merchant-source');
  await mkdir(root); await mkdir(sourceDirectory);
  const binary = process.env.OPENSSL ?? 'openssl';
  const output = {};
  for (const plane of ['data', 'monitor']) {
    const caFile = join(root, plane + '-ca.pem'), caKey = join(root, plane + '-ca.key');
    const certificateFile = join(root, plane + '-server.pem'), keyFile = join(root, plane + '-server.key');
    const requestFile = join(root, plane + '.csr'), extensionFile = join(root, plane + '.ext');
    await runOpenSsl(binary, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
      '-subj', '/CN=SF30-' + plane + '-authority', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', caKey, '-out', caFile]);
    await runOpenSsl(binary, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-subj', '/CN=localhost', '-keyout', keyFile, '-out', requestFile]);
    await writeFile(extensionFile, 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n' +
      'extendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n', { mode: 0o600 });
    await runOpenSsl(binary, ['x509', '-req', '-sha256', '-days', '2', '-in', requestFile,
      '-CA', caFile, '-CAkey', caKey, '-CAcreateserial', '-extfile', extensionFile, '-out', certificateFile]);
    for (const path of [caFile, caKey, certificateFile, keyFile, requestFile]) await chmod(path, 0o600);
    const ca = await readFile(caFile), sourceName = plane === 'data' ? 'database-ca.pem' : 'sentinel-ca.pem';
    const sourceFile = join(sourceDirectory, sourceName);
    await writeFile(sourceFile, ca, { mode: 0o600 });
    output[plane] = { ca, caFile, certificateFile, keyFile, sourceFile, sourceName,
      sha256: createHash('sha256').update(ca).digest('hex') };
  }
  assert.notEqual(output.data.sha256, output.monitor.sha256);
  // Sentinel connects to both the data plane and its peer monitors. Its server
  // process trusts both authorities; each merchant client trusts only its plane.
  const monitorTrustFile = join(root, 'monitor-trust.pem');
  await writeFile(monitorTrustFile, Buffer.concat([output.data.ca, output.monitor.ca]), { mode: 0o600 });
  return { ...output, monitorTrustFile, sourceDirectory };
}

// Whichever seed the native driver chooses first accepts TCP and never replies.
// The second endpoint forwards bytes unchanged to the actual Redis/Sentinel
// process, making failed-first-seed fallback deterministic without patching RNG.
async function seedTransport(target, { fallback = true } = {}) {
  const sockets = new Set(), listeners = [];
  let accepted = 0, silentBytes = 0, silentClosed = 0, closing = false;
  const start = async () => {
    const server = createServer(socket => {
      sockets.add(socket); const silent = ++accepted === 1 || !fallback;
      socket.on('error', () => {});
      socket.once('close', () => { sockets.delete(socket); if (silent) silentClosed++; });
      if (silent) { socket.on('data', bytes => { silentBytes += bytes.length; }); return; }
      const upstream = createConnection({ host: HOST, port: target });
      sockets.add(upstream); upstream.on('error', () => socket.destroy());
      upstream.once('close', () => { sockets.delete(upstream); socket.destroy(); });
      socket.once('close', () => upstream.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, HOST, resolve); });
    listeners.push(server); return { host: HOST, port: server.address().port };
  };
  const roots = [await start()];
  if (fallback) roots.push(await start());
  return { roots, status: () => ({ accepted, silentBytes, silentClosed, openSockets: sockets.size }),
    async close() {
      if (closing) return; closing = true;
      for (const socket of sockets) socket.destroy();
      await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))));
    } };
}

export async function startNativeRedisTopology({ topology, directory, password, passwordEnv, binary = process.env.REDIS_SERVER ?? 'redis-server' }) {
  if (!['cluster', 'sentinel'].includes(topology)) throw new Error('REDIS_TOPOLOGY_FIXTURE_INVALID');
  const tlsEnabled = process.env.SF30_REDIS_JOURNEY_TLS === '1';
  if (tlsEnabled && topology !== 'sentinel') throw new Error('REDIS_TLS_FIXTURE_REQUIRES_SENTINEL');
  const engines = [], clients = new Set(), transports = new Set(), stages = [];
  const adminPassword = randomBytes(24).toString('hex'), monitorAdminPassword = randomBytes(24).toString('hex');
  const monitorPassword = randomBytes(24).toString('hex');
  const sentinelPasswordEnv = 'SF30_REDIS_JOURNEY_SENTINEL_PASSWORD';
  const priorMonitor = process.env[sentinelPasswordEnv];
  let database, closing, certificates, authoritiesRemoved = false;
  if (topology === 'sentinel') process.env[sentinelPasswordEnv] = monitorPassword;
  await mkdir(directory, { recursive: true });
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      for (const transport of transports) await transport.close();
      if (database?.isOpen) await Promise.resolve().then(() => database.destroy()).catch(() => {});
      await Promise.allSettled([...clients].map(async client => { if (client.isOpen) await client.destroy(); }));
      await Promise.all(engines.map(async record => {
        if (record.child.exitCode !== null || record.child.signalCode !== null) return;
        record.child.kill('SIGTERM');
        const timer = setTimeout(() => { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill('SIGKILL'); }, 3000);
        timer.unref();
        await record.exited; clearTimeout(timer);
      }));
      if (topology === 'sentinel') {
        if (priorMonitor === undefined) delete process.env[sentinelPasswordEnv];
        else process.env[sentinelPasswordEnv] = priorMonitor;
      }
    })();
    return closing;
  }
  async function startNode(label, { sentinel = false, replicaOf } = {}) {
    const port = await reservePort(), busPort = topology === 'cluster' ? await reservePort() : undefined;
    const root = join(directory, label); await mkdir(root);
    const settings = [
      'bind ' + HOST, 'protected-mode yes', 'port ' + (certificates ? 0 : port), 'daemonize no',
      'dir ' + JSON.stringify(root), 'logfile ""', 'save ""', 'appendonly no',
      'requirepass ' + (sentinel ? monitorAdminPassword : adminPassword),
    ];
    if (certificates) {
      const identity = sentinel ? certificates.monitor : certificates.data;
      settings.push('tls-port ' + port, 'tls-cert-file ' + JSON.stringify(identity.certificateFile),
        'tls-key-file ' + JSON.stringify(identity.keyFile),
        'tls-ca-cert-file ' + JSON.stringify(sentinel ? certificates.monitorTrustFile : certificates.data.caFile),
        'tls-auth-clients no', 'tls-replication yes');
    }
    if (!sentinel) {
      settings.push('masteruser default', 'masterauth ' + adminPassword);
      if (replicaOf) settings.push('replicaof ' + HOST + ' ' + replicaOf.port);
      if (topology === 'cluster') settings.push(
        'cluster-enabled yes', 'cluster-config-file nodes.conf', 'cluster-node-timeout 1000',
        'cluster-port ' + busPort, 'cluster-announce-ip ' + HOST,
        'cluster-announce-port ' + port, 'cluster-announce-bus-port ' + busPort);
    } else settings.push(
      'sentinel monitor ' + NAME + ' ' + HOST + ' ' + replicaOf.port + ' 2',
      'sentinel down-after-milliseconds ' + NAME + ' 1500',
      'sentinel failover-timeout ' + NAME + ' 10000',
      'sentinel parallel-syncs ' + NAME + ' 1',
      'sentinel auth-user ' + NAME + ' default',
      'sentinel auth-pass ' + NAME + ' ' + adminPassword,
      'sentinel sentinel-user default', 'sentinel sentinel-pass ' + monitorAdminPassword,
      'sentinel announce-ip ' + HOST, 'sentinel announce-port ' + port);
    const config = join(root, 'redis.conf');
    await writeFile(config, settings.join('\n') + '\n', { mode: 0o600 });
    const child = spawn(binary, sentinel ? [config, '--sentinel'] : [config], { stdio: ['ignore', 'pipe', 'pipe'] });
    const record = { label, child, port, busPort, log: '', error: null };
    record.exited = new Promise(resolve => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', error => { record.error = error; resolve({ error }); });
    });
    child.stdout.on('data', bytes => { record.log = (record.log + bytes).slice(-8192); });
    child.stderr.on('data', bytes => { record.log = (record.log + bytes).slice(-8192); });
    engines.push(record);
    record.client = await until(async () => {
      if (record.error) throw record.error;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('REDIS_NODE_EXIT:' + label + ':' + record.log);
      const client = createClient(nodeOptions(port, sentinel ? monitorAdminPassword : adminPassword, 0,
        certificates ? (sentinel ? certificates.monitor.ca : certificates.data.ca) : undefined));
      client.on('error', () => {});
      try { await client.connect(); await client.ping(); clients.add(client); return client; }
      catch { if (client.isOpen) client.destroy(); return false; }
    }, 'REDIS_NODE_START_FAILED:' + label, 10000);
    return record;
  }
  try {
    if (tlsEnabled) certificates = await createTlsAuthorities(directory);
    const nodes = [await startNode('data-0')];
    if (topology === 'cluster') {
      nodes.push(await startNode('data-1'), await startNode('data-2'));
      const ranges = [[0, 5460], [5461, 10922], [10923, 16383]];
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].range = ranges[i];
        nodes[i].id = await nodes[i].client.sendCommand(['CLUSTER', 'MYID']);
        await nodes[i].client.sendCommand(['CLUSTER', 'SET-CONFIG-EPOCH', String(i + 1)]);
        await nodes[i].client.sendCommand(['CLUSTER', 'ADDSLOTSRANGE', ...ranges[i].map(String)]);
      }
      for (const node of nodes.slice(1)) await nodes[0].client.sendCommand(['CLUSTER', 'MEET', HOST, String(node.port), String(node.busPort)]);
      await until(async () => (await Promise.all(nodes.map(node => node.client.sendCommand(['CLUSTER', 'INFO']))))
        .every(info => /cluster_state:ok/.test(info)), 'REDIS_CLUSTER_QUORUM_FAILED');
    } else nodes.push(await startNode('data-1', { replicaOf: nodes[0] }));
    for (const node of nodes) await node.client.sendCommand(['ACL', 'SETUSER', 'merchant', 'reset', 'on', '>' + password,
      '~merchant:*', ...READ_COMMANDS, ...(topology === 'cluster' ? ['+cluster|slots', '+asking'] : [])]);

    const monitors = [];
    if (topology === 'sentinel') {
      await until(async () => /master_link_status:up/.test(await nodes[1].client.info('replication')), 'REDIS_REPLICA_LINK_FAILED');
      for (let i = 0; i < 3; i++) {
        const monitor = await startNode('sentinel-' + i, { sentinel: true, replicaOf: nodes[0] });
        await monitor.client.sendCommand(['ACL', 'SETUSER', 'sentinel_reader', 'reset', 'on', '>' + monitorPassword,
          '+ping', '+sentinel|master', '+sentinel|replicas', '+sentinel|sentinels', '+psubscribe', '+punsubscribe', '&*']);
        monitors.push(monitor);
      }
      await until(async () => {
        const observed = await Promise.all(monitors.map(async monitor => {
          const peers = await monitor.client.sendCommand(['SENTINEL', 'SENTINELS', NAME]);
          const replicas = await monitor.client.sendCommand(['SENTINEL', 'REPLICAS', NAME]);
          const quorum = await monitor.client.sendCommand(['SENTINEL', 'CKQUORUM', NAME]);
          return peers.length === 2 && replicas.length === 1 && String(quorum).startsWith('OK');
        }));
        return observed.every(Boolean);
      }, 'REDIS_SENTINEL_QUORUM_FAILED', 30000);
    }
    let connection, profile;
    const roots = nodes.map(node => ({ host: HOST, port: node.port }));
    if (topology === 'cluster') {
      connection = { topology, rootNodes: roots.map(socket => ({ socket })),
        defaults: { username: 'merchant', password, socket: {} } };
      profile = { topology, rootNodes: roots, database: 0, username: 'merchant', passwordEnv, tls: 'local-plaintext' };
      const native = createCluster({ RESP: 2, rootNodes: roots.map(node => nodeOptions(node.port, adminPassword)),
        defaults: nodeOptions(roots[0].port, adminPassword), useReplicas: false, minimizeConnections: true,
        commandOptions: { timeout: commandTimeout } });
      native.on('error', () => {}); await native.connect(); database = adminFacade(native, topology);
    } else {
      const sentinelRootNodes = monitors.map(monitor => ({ host: HOST, port: monitor.port }));
      connection = { topology, name: NAME, sentinelRootNodes,
        nodeClientOptions: { username: 'merchant', password, database: 2,
          socket: certificates ? { tls: true, rejectUnauthorized: true, ca: certificates.data.ca } : {} },
        sentinelClientOptions: { username: 'sentinel_reader', password: monitorPassword,
          socket: certificates ? { tls: true, rejectUnauthorized: true, ca: certificates.monitor.ca } : {} } };
      profile = { topology, name: NAME, sentinelRootNodes, database: 2, username: 'merchant', passwordEnv,
        tls: certificates ? 'verify-full' : 'local-plaintext', sentinelUsername: 'sentinel_reader', sentinelPasswordEnv,
        sentinelTls: certificates ? 'verify-full' : 'local-plaintext',
        ...(certificates ? { caFile: certificates.data.sourceFile, sentinelCaFile: certificates.monitor.sourceFile } : {}) };
      const native = createSentinel({ RESP: 2, name: NAME, sentinelRootNodes,
        nodeClientOptions: nodeOptions(nodes[0].port, adminPassword, 2, certificates?.data.ca),
        sentinelClientOptions: nodeOptions(monitors[0].port, monitorAdminPassword, 0, certificates?.monitor.ca),
        commandOptions: { timeout: commandTimeout }, masterPoolSize: 1, replicaPoolSize: 0, scanInterval: 500 });
      native.on('error', () => {}); await native.connect(); database = adminFacade(native, topology);
    }
    const tags = [];
    if (topology === 'cluster') {
      for (let number = 0; tags.filter(Boolean).length < nodes.length && number < 100; number++) {
        const tag = 'sf30-' + number, slot = Number(await nodes[0].client.sendCommand(['CLUSTER', 'KEYSLOT', 'merchant:{' + tag + '}:probe']));
        const index = nodes.findIndex(node => node.range[0] <= slot && slot <= node.range[1]);
        if (!tags[index]) tags[index] = tag;
      }
      assert.equal(tags.filter(Boolean).length, 3);
    }
    const key = value => {
      if (topology !== 'cluster') return value;
      const index = value.startsWith('merchant:catalog:') || value === 'merchant:large' ? 1
        : value.startsWith('merchant:rankings:') || value === 'merchant:binary-large' ? 2 : 0;
      return value.replace(/^merchant:/, 'merchant:{' + tags[index] + '}:');
    };
    async function readerAcl() {
      const factory = await createRedisConnectionFactory(connection, { connectTimeoutMs: 1000 });
      const reader = factory.create(); await reader.connect();
      try {
        await assert.rejects(reader.sendCommand(['SET', key('merchant:forbidden'), 'x'], { key: key('merchant:forbidden') }), /NOPERM/);
        await assert.rejects(reader.sendCommand(['GET', 'other:key'], { key: 'other:key' }), /NOPERM/);
      } finally { await reader.destroy(); }
      return { mutationDenied: true, otherPrefixDenied: true };
    }
    async function seedLifecycle(queries) {
      const target = topology === 'cluster' ? nodes[0].port : monitors[0].port;
      const withRoots = roots => topology === 'cluster'
        ? { ...connection, rootNodes: roots.map(socket => ({ socket })) }
        : { ...connection, sentinelRootNodes: roots };
      const transport = await seedTransport(target); transports.add(transport);
      let probe;
      try {
        probe = await createRedisQuerySource({ connection: withRoots(transport.roots), queries,
          maxConnections: 1, maxPending: 1, connectTimeoutMs: 300, startupTimeoutMs: 5000 });
        const row = await probe.query('availability', {});
        assert.equal(row.rowCount, 1);
        assert.ok(transport.status().accepted >= 2);
        assert.ok(transport.status().silentBytes > 0);
        await probe.close(); probe = null;
        await until(() => transport.status().openSockets === 0, 'REDIS_FALLBACK_SOCKET_RETAINED', 5000);
        stages.push({ stage: 'silent-first-seed-fallback', ...transport.status() });
      } finally { await probe?.close(); await transport.close(); transports.delete(transport); }
      const terminal = await seedTransport(target, { fallback: false }); transports.add(terminal);
      try {
        const start = Date.now();
        await assert.rejects(createRedisQuerySource({ connection: withRoots(terminal.roots), queries,
          maxConnections: 1, maxPending: 1, connectTimeoutMs: 300, startupTimeoutMs: 100 }),
          issue => issue.code === 'SOURCE_START_TIMEOUT');
        await until(() => terminal.status().openSockets === 0, 'REDIS_STARTUP_SOCKET_RETAINED', 5000);
        assert.ok(terminal.status().accepted >= 1);
        assert.ok(terminal.status().silentBytes > 0);
        const elapsedMs = Date.now() - start; assert.ok(elapsedMs < 5000, 'Startup cleanup exceeded its finite socket/discovery deadline');
        stages.push({ stage: 'silent-startup-terminal-cleanup', elapsedMs, ...terminal.status() });
      } finally { await terminal.close(); transports.delete(terminal); }
    }
    async function userClients(node, user) {
      const listing = await node.client.sendCommand(['CLIENT', 'LIST']);
      return String(listing).split('\n').filter(line => line.split(' ').includes('user=' + user)).length;
    }
    async function exercise({ source, queries, connectTimeoutMs }) {
      const availability = await source.query('availability', {});
      let pauseNode;
      if (topology === 'cluster') {
        const routes = [];
        for (const [query, name] of [['availability', 'merchant:availability:catalog'], ['catalog', 'merchant:catalog:north'],
          ['leaderboard', 'merchant:rankings:daily'], ['events', 'merchant:events']]) {
          const slot = Number(await nodes[0].client.sendCommand(['CLUSTER', 'KEYSLOT', key(name)]));
          const owner = nodes.find(node => node.range[0] <= slot && slot <= node.range[1]);
          assert.equal(await owner.client.sendCommand(['EXISTS', key(name)]), 1);
          assert.ok((await source.query(query, {})).rowCount > 0);
          routes.push({ query, slot, primary: owner.id });
        }
        assert.equal(new Set(routes.map(route => route.primary)).size, 3);
        stages.push({ stage: 'three-primary-key-routing', routes });
        const slot = routes[0].slot, from = nodes.find(node => node.id === routes[0].primary), target = nodes.find(node => node !== from);
        await target.client.sendCommand(['CLUSTER', 'SETSLOT', String(slot), 'IMPORTING', from.id]);
        await from.client.sendCommand(['CLUSTER', 'SETSLOT', String(slot), 'MIGRATING', target.id]);
        let movedKeys = 0;
        for (;;) {
          const keys = await from.client.sendCommand(['CLUSTER', 'GETKEYSINSLOT', String(slot), '100']);
          if (!keys.length) break;
          await from.client.sendCommand(['MIGRATE', HOST, String(target.port), '', '0', '5000', 'AUTH2', 'default', adminPassword, 'KEYS', ...keys]);
          movedKeys += keys.length;
        }
        assert.ok(movedKeys > 0);
        await assert.rejects(from.client.sendCommand(['GET', key('merchant:availability:catalog')]), issue => issue.message.startsWith('ASK ' + slot + ' '));
        assert.deepEqual((await source.query('availability', {})).rows, availability.rows);
        for (const node of [target, from, ...nodes.filter(node => node !== target && node !== from)])
          await node.client.sendCommand(['CLUSTER', 'SETSLOT', String(slot), 'NODE', target.id]);
        await assert.rejects(from.client.sendCommand(['GET', key('merchant:availability:catalog')]), issue => issue.message.startsWith('MOVED ' + slot + ' '));
        assert.deepEqual((await source.query('availability', {})).rows, availability.rows);
        assert.equal(await target.client.sendCommand(['EXISTS', key('merchant:availability:catalog')]), 1);
        stages.push({ stage: 'occupied-slot-move', slot, from: from.id, to: target.id, movedKeys, ask: true, moved: true });
        pauseNode = target;
      } else {
        assert.ok(Number(await database.sendCommand(['WAIT', '1', '5000'])) >= 1);
        const before = pairs(await monitors[0].client.sendCommand(['SENTINEL', 'MASTER', NAME]));
        assert.equal(Number(before.port), nodes[0].port);
        await monitors[0].client.sendCommand(['SENTINEL', 'FAILOVER', NAME]);
        await until(async () => {
          const masters = await Promise.all(monitors.map(monitor => monitor.client.sendCommand(['SENTINEL', 'MASTER', NAME])));
          return masters.every(master => Number(pairs(master).port) === nodes[1].port);
        }, 'REDIS_SENTINEL_PROMOTION_FAILED', 30000);
        await until(async () => {
          const roles = await Promise.all(nodes.map(node => node.client.sendCommand(['ROLE'])));
          return roles[0][0] === 'slave' && roles[1][0] === 'master';
        }, 'REDIS_SENTINEL_ROLE_TRANSITION_FAILED', 20000);
        const calls = async () => Number((await nodes[1].client.info('commandstats')).match(/^cmdstat_eval_ro:calls=(\d+)/m)?.[1] ?? '0');
        const beforeCalls = await calls();
        await until(async () => {
          assert.deepEqual((await source.query('availability', {})).rows, availability.rows);
          return await calls() > beforeCalls;
        }, 'REDIS_SENTINEL_CURRENT_PRIMARY_READ_FAILED', 10000);
        stages.push({ stage: 'sentinel-primary-promotion', quorum: monitors.length, priorRole: 'master', oldNodeRole: 'slave',
          promotedNodeRole: 'master', promotedPrimaryReadCalls: await calls() - beforeCalls, oldPrimaryStillRunning: nodes[0].child.exitCode === null });
        pauseNode = nodes[1];
      }
      await seedLifecycle(queries);
      // A native server pause outlasts TCP connectTimeout while remaining inside
      // the declared read budget. This exercises the distinct deadline contract.
      await pauseNode.client.sendCommand(['CLIENT', 'PAUSE', '650', 'ALL']);
      const slowStart = Date.now();
      assert.deepEqual((await source.query('availability', {})).rows, availability.rows);
      const slowElapsed = Date.now() - slowStart;
      assert.ok(slowElapsed > connectTimeoutMs);
      stages.push({ stage: 'read-outlasts-connect-deadline', connectTimeoutMs, elapsedMs: slowElapsed,
        queryTimeoutMs: queries.availability.timeoutMs });
      if (topology === 'cluster') {
        // Keep the active read on its healthy owner while another already-open
        // shard disconnects. Native Cluster.destroy must still close siblings.
        let disconnected;
        for (const node of nodes.filter(node => node !== pauseNode)) {
          if (await userClients(node, 'merchant') === 0) continue;
          const killed = Number(await node.client.sendCommand(['CLIENT', 'KILL', 'USER', 'merchant', 'SKIPME', 'yes']));
          if (killed) { disconnected = { node: node.label, closedMerchantConnections: killed }; break; }
        }
        assert.ok(disconnected, 'The native reader must have an already-open second shard');
        stages.push({ stage: 'one-shard-disconnected-before-close', ...disconnected });
      }
      await pauseNode.client.sendCommand(['CLIENT', 'PAUSE', '250', 'ALL']);
      const controller = new AbortController(), aborted = setTimeout(() => controller.abort(), 25), start = Date.now();
      try { await assert.rejects(source.query('availability', {}, { signal: controller.signal }), issue => issue.code === 'QUERY_ABORTED'); }
      finally { clearTimeout(aborted); }
      await source.close();
      const closed = source.status();
      assert.equal(closed.state, 'CLOSED'); assert.equal(closed.active, 0); assert.equal(closed.connections, 0); assert.equal(closed.retiring, 0);
      const physicalConnections = await until(async () => {
        const data = await Promise.all(nodes.map(async node => ({ node: node.label, readers: await userClients(node, 'merchant') })));
        const control = await Promise.all(monitors.map(async node => ({ node: node.label, readers: await userClients(node, 'sentinel_reader') })));
        return [...data, ...control].every(node => node.readers === 0) ? { data, control } : false;
      }, 'REDIS_MERCHANT_CONNECTION_RETAINED_AFTER_CLOSE', 5000);
      stages.push({ stage: 'active-read-cancel-and-close', elapsedMs: Date.now() - start, status: closed, physicalConnections });
      return { result: 'PASS', topology, dataProcesses: nodes.length, monitorProcesses: monitors.length,
        ...(certificates ? { tls: { mode: 'verify-full', dataCaSha256: certificates.data.sha256,
          sentinelCaSha256: certificates.monitor.sha256, independentAuthorities: true, subjectAltNames: ['localhost', '127.0.0.1'] } } : {}),
        dataAuthentication: 'generated-reader-and-admin', ...(monitors.length ? { monitorAuthentication: 'independent-generated-reader-and-admin' } : {}), stages };
    }
    stages.push({ stage: 'native-topology-ready', topology, dataProcesses: nodes.length, monitorProcesses: monitors.length });
    const authorityFiles = certificates ? Object.fromEntries([certificates.data, certificates.monitor]
      .map(certificate => [certificate.sourceName, certificate.sha256])) : {};
    async function removeOriginalAuthorities() {
      if (!certificates) return [];
      if (!authoritiesRemoved) { await rm(certificates.sourceDirectory, { recursive: true }); authoritiesRemoved = true; }
      return Object.entries(authorityFiles).map(([name, sha256]) => ({ name, sha256, originalRemoved: true }));
    }
    return { topology, database, databaseIndex: topology === 'cluster' ? 0 : 2, connection, profile, key, close, exercise, readerAcl,
      authorityFiles, removeOriginalAuthorities,
      requiredEnvironment: topology === 'sentinel' ? [passwordEnv, sentinelPasswordEnv].sort() : [passwordEnv],
      badConnection: () => topology === 'cluster'
        ? { ...connection, defaults: { ...connection.defaults, password: 'wrong' } }
        : { ...connection, sentinelClientOptions: { ...connection.sentinelClientOptions, password: 'wrong' } } };
  } catch (issue) { await close(); throw issue; }
}
