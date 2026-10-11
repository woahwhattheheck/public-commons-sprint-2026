// MIT. One original SF60 writer, live discovery and local signed seller operations.
import { createServer, request as httpRequest } from 'node:http';
import { createHash, createPublicKey, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as FS } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DurableCatalogTransaction, MAX_BATCH_OPERATIONS } from './journal.mjs';
import { serveDiscovery } from './service.mjs';
import { admitPinnedSeller, verifyPinnedSellerAdmission } from '../sf73-pinned-seller-admission/admit.mjs';
import { prepareWithdrawal, applyWithdrawal } from '../sf95-signed-seller-withdrawal/withdrawal.mjs';

export const POLICY_SCHEMA = 'stellar-forge.catalog-operator-policy/v1';
export const CONTROL_SCHEMA = 'stellar-forge.catalog-operator-command/v1';
export const SOCKET_NAME = '.catalog-operator.sock';
export const CONTROL_DESCRIPTOR_NAME = '.catalog-control.json';
export const CONTROL_DESCRIPTOR_SCHEMA = 'stellar-forge.catalog-control/v1';
export const SIGNED_BATCH_SCHEMA = 'stellar-forge.catalog-signed-batch/v1';
export const SIGNED_BATCH_PLAN_SCHEMA = 'stellar-forge.catalog-signed-batch-plan/v1';
const MAX_COMMAND = 8 * 1024 * 1024;
const MAX_RESPONSE = 32 * 1024 * 1024;
const MAX_QUEUED_BYTES = 32 * 1024 * 1024;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new Error(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function fields(value, required, optional = []) {
  if (!plain(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    fail('COMMAND_FIELDS_INVALID');
  }
}

async function localFile(filename, limit) {
  const handle = await open(filename, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    const meta = await handle.stat();
    if (!meta.isFile() || meta.size < 1 || meta.size > limit) fail('LOCAL_INPUT_SIZE_INVALID');
    const bytes = await handle.readFile();
    if (bytes.length !== meta.size) fail('LOCAL_INPUT_CHANGED_DURING_READ');
    return bytes;
  } finally { await handle.close(); }
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function readControlDescriptor(filename) {
  const handle = await open(filename, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    const meta = await handle.stat();
    if (!meta.isFile() || meta.nlink !== 1 || (meta.mode & 0o777) !== 0o600 ||
        (process.getuid && meta.uid !== process.getuid()) || meta.size < 1 || meta.size > 4096)
      fail('OWNED_PRIVATE_CONTROL_DESCRIPTOR_REQUIRED');
    // Fixed-size reads cannot follow a file that grows without bound.
    const buffer = Buffer.alloc(4097);
    let size = 0, descriptor;
    try {
      while (size < buffer.length) {
        const result = await handle.read(buffer, size, buffer.length - size, null);
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size !== meta.size || size > 4096) fail('CONTROL_DESCRIPTOR_CHANGED');
      try { descriptor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
      catch { fail('CONTROL_DESCRIPTOR_INVALID'); } // Parser snippets must never expose the local bearer token.
    } finally { buffer.fill(0); }
    fields(descriptor, ['schema', 'transport', 'origin', 'token', 'processId', 'createdAt']);
    if (descriptor.schema !== CONTROL_DESCRIPTOR_SCHEMA || descriptor.transport !== 'loopback' ||
        typeof descriptor.origin !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(descriptor.origin) ||
        typeof descriptor.token !== 'string' || !/^[0-9a-f]{64}$/.test(descriptor.token) ||
        !Number.isSafeInteger(descriptor.processId) || descriptor.processId < 1 ||
        typeof descriptor.createdAt !== 'string' || !Number.isFinite(Date.parse(descriptor.createdAt)) ||
        new Date(descriptor.createdAt).toISOString() !== descriptor.createdAt)
      fail('CONTROL_DESCRIPTOR_INVALID');
    const origin = new URL(descriptor.origin);
    if (origin.origin !== descriptor.origin || origin.hostname !== '127.0.0.1' ||
        !origin.port || Number(origin.port) > 65535) fail('CONTROL_DESCRIPTOR_ORIGIN_INVALID');
    return descriptor;
  } finally { await handle.close(); }
}

function authenticatedLoopback(req, origin, secret) {
  if (!origin || !secret || req.socket.localAddress !== '127.0.0.1' ||
      req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== origin.slice('http://'.length) ||
      Object.keys(req.headers).some(name => name === 'origin' || name.startsWith('sec-fetch-')) ||
      typeof req.headers.authorization !== 'string') return false;
  let authorizationCount = 0, hostCount = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === 'authorization') authorizationCount++;
    if (req.rawHeaders[i].toLowerCase() === 'host') hostCount++;
  }
  if (authorizationCount !== 1 || hostCount !== 1) return false;
  const received = Buffer.from(req.headers.authorization);
  const expected = Buffer.from('Bearer ' + secret.toString('hex'));
  try { return received.length === expected.length && timingSafeEqual(received, expected); }
  finally { received.fill(0); expected.fill(0); }
}

/** Policy is trusted startup configuration, never supplied by a socket caller
 * or inferred from a received listing. Only independent public Ed25519 pins
 * are needed here; the operator process does not load seller private keys.
 */
export async function readOperatorPolicy(filename) {
  if (typeof filename !== 'string' || !filename.length) fail('OPERATOR_POLICY_FILE_REQUIRED');
  const bytes = await localFile(filename, 256 * 1024);
  const document = JSON.parse(bytes.toString('utf8'));
  fields(document, ['schema', 'sellers']);
  if (document.schema !== POLICY_SCHEMA || !Array.isArray(document.sellers) ||
      document.sellers.length < 1 || document.sellers.length > 128) fail('OPERATOR_POLICY_INVALID');
  const sellers = new Map();
  for (const seller of document.sellers) {
    fields(seller, ['sellerId', 'pinnedPublicKey', 'allowedOrigins', 'allowedRecipients',
      'allowedNetworks', 'allowedSchemes']);
    if (!id(seller.sellerId) || sellers.has(seller.sellerId) ||
        typeof seller.pinnedPublicKey !== 'string' || seller.pinnedPublicKey.length > 4096 ||
        !seller.pinnedPublicKey.startsWith('-----BEGIN PUBLIC KEY-----')) fail('SELLER_POLICY_INVALID');
    const key = createPublicKey(seller.pinnedPublicKey);
    if (key.asymmetricKeyType !== 'ed25519') fail('ED25519_PUBLIC_PIN_REQUIRED');
    const der = key.export({ format: 'der', type: 'spki' });
    const authority = { sellerId: seller.sellerId, signer: der.toString('base64url') };
    for (const name of ['allowedOrigins', 'allowedRecipients', 'allowedNetworks', 'allowedSchemes']) {
      const values = seller[name];
      if (!Array.isArray(values) || values.length < 1 || values.length > 64 ||
          values.some(value => typeof value !== 'string' || !value || value.length > 256) ||
          new Set(values).size !== values.length) fail('SELLER_POLICY_' + name + '_INVALID');
      authority[name] = new Set(values);
    }
    for (const origin of authority.allowedOrigins) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
        fail('CANONICAL_HTTPS_SELLER_ORIGIN_REQUIRED');
      }
    }
    sellers.set(seller.sellerId, { authority, pinnedPublicKey: seller.pinnedPublicKey,
      publicKeySha256: sha(der) });
  }
  return { sellers, sourceSha256: sha(bytes) };
}

function queryParams(value) {
  if (!plain(value) || Object.keys(value).length > 16 ||
      Object.entries(value).some(([key, item]) => key.length > 128 ||
        typeof item !== 'string' || item.length > 4096)) fail('QUERY_PARAMETERS_INVALID');
  return new URLSearchParams(value);
}

/** All mutations delegate to the existing verified admission / withdrawal APIs.
 * No route accepts caller-provided authority, pins or unauthenticated retirement.
 */
export async function openCatalogOperator({ directory, policyFile, port = 0, createEmpty = false,
  controlTransport = 'unix' } = {}) {
  if (!['unix', 'loopback'].includes(controlTransport)) fail('CONTROL_TRANSPORT_INVALID');
  // Loopback changes transport, not the private POSIX filesystem permission model.
  if (process.platform === 'win32') fail('POSIX_PRIVATE_PERMISSIONS_REQUIRED');
  if (typeof directory !== 'string' || !directory.trim()) fail('CATALOG_DIRECTORY_REQUIRED');
  if (typeof createEmpty !== 'boolean') fail('CREATE_EMPTY_BOOLEAN_REQUIRED');
  const target = resolve(directory), socketPath = join(target, SOCKET_NAME);
  const descriptorPath = join(target, CONTROL_DESCRIPTOR_NAME);
  if (controlTransport === 'unix' && Buffer.byteLength(socketPath) > 100) fail('CATALOG_SOCKET_PATH_TOO_LONG');
  const policy = await readOperatorPolicy(policyFile);
  if (createEmpty) await mkdir(target, { recursive: true, mode: 0o700 });
  const meta = await lstat(target);
  if (!meta.isDirectory() || meta.isSymbolicLink() || await realpath(target) !== target ||
      (meta.mode & 0o077) !== 0 || (process.getuid && meta.uid !== process.getuid())) {
    fail('OWNED_PRIVATE_REAL_DIRECTORY_REQUIRED');
  }
  try {
    const journalMeta = await lstat(join(target, 'catalog-commits.json'));
    if (!journalMeta.isFile() || journalMeta.isSymbolicLink() || journalMeta.nlink !== 1) {
      fail('REGULAR_PRIVATE_JOURNAL_REQUIRED');
    }
  } catch (error) {
    if (error.code !== 'ENOENT' || !createEmpty) throw error;
  }
  // An existing path is never unlinked or replaced by startup.
  try { await lstat(socketPath); fail('CONTROL_SOCKET_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await lstat(descriptorPath); fail('CONTROL_DESCRIPTOR_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const catalog = await DurableCatalogTransaction.open(target);
  let discovery, control, closePromise, closing = false, inFlight = 0, reservedBytes = 0;
  let controlOrigin, descriptorIdentity;
  const controlSecret = controlTransport === 'loopback' ? randomBytes(32) : null;
  const connections = new Set();
  const pending = new Set();
  let queue = Promise.resolve();

  const removeOwnDescriptor = async () => {
    if (!descriptorIdentity) return;
    let meta;
    try { meta = await lstat(descriptorPath); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!meta.isFile() || meta.isSymbolicLink() || meta.dev !== descriptorIdentity.dev ||
        meta.ino !== descriptorIdentity.ino) fail('REPLACED_CONTROL_DESCRIPTOR_PRESERVED');
    // Never remove a successor's descriptor, even if the inode was reused.
    if (descriptorIdentity.complete) {
      const bytes = await localFile(descriptorPath, 4096);
      const matches = sha(bytes) === descriptorIdentity.sha256;
      bytes.fill(0);
      if (!matches) fail('REPLACED_CONTROL_DESCRIPTOR_PRESERVED');
    }
    await unlink(descriptorPath);
    await syncDirectory(target);
    descriptorIdentity = null;
  };

  const sellerPolicy = sellerId => {
    const selected = policy.sellers.get(sellerId);
    if (!selected) fail('SELLER_NOT_IN_STARTUP_POLICY');
    return selected;
  };
  const execute = async command => {
    fields(command, ['schema', 'requestId', 'operation', 'input']);
    if (command.schema !== CONTROL_SCHEMA || !id(command.requestId)) fail('CONTROL_ENVELOPE_INVALID');
    const input = command.input;
    if (command.operation === 'status') {
      fields(input, []);
      const page = catalog.list(new URLSearchParams({ limit: '1' }));
      return { state: 'ready', journalHead: catalog.head, committedOperations: catalog.count,
        activeResources: page.pagination.total, discoveryOrigin: discovery.origin,
        policySha256: policy.sourceSha256,
        sellers: [...policy.sellers].map(([sellerId, item]) =>
          ({ sellerId, publicKeySha256: item.publicKeySha256 })) };
    }
    if (command.operation === 'list' || command.operation === 'search') {
      fields(input, ['params']);
      return catalog[command.operation](queryParams(input.params));
    }
    if (command.operation === 'lookup') {
      fields(input, ['catalogKey']);
      if (typeof input.catalogKey !== 'string' || !input.catalogKey.length ||
          input.catalogKey.length > 4096) fail('CATALOG_KEY_INVALID');
      return { journalHead: catalog.head, current: catalog.lookupCatalogKey(input.catalogKey) };
    }
    if (command.operation === 'history') {
      fields(input, ['lifecycleId']);
      if (typeof input.lifecycleId !== 'string' || !input.lifecycleId.length ||
          input.lifecycleId.length > 4096) fail('LIFECYCLE_ID_INVALID');
      return { journalHead: catalog.head, history: catalog.history(input.lifecycleId) };
    }
    if (command.operation === 'admit') {
      fields(input, ['sellerId', 'sequence', 'sourceURL', 'observedAt', 'sourceBase64', 'proofs']);
      const selected = sellerPolicy(input.sellerId);
      if (typeof input.sourceBase64 !== 'string' || input.sourceBase64.length > 87384) {
        fail('ORIGINAL_SOURCE_BYTES_REQUIRED');
      }
      const sourceBytes = Buffer.from(input.sourceBase64, 'base64');
      if (sourceBytes.toString('base64') !== input.sourceBase64) fail('SOURCE_BASE64_NOT_CANONICAL');
      return admitPinnedSeller({ journal: catalog, sourceBytes,
        sellerId: input.sellerId, sequence: input.sequence,
        sourceURL: input.sourceURL, observedAt: input.observedAt, proofs: input.proofs,
        authority: selected.authority, pinnedPublicKey: selected.pinnedPublicKey });
    }
    if (command.operation === 'preview-batch' || command.operation === 'apply-batch') {
      const apply = command.operation === 'apply-batch';
      fields(input, apply ? ['batch','expectedHead','expectedPlan','expectedBatch','expectedPolicy'] : ['batch']);
      fields(input.batch, ['schema','admissions']);
      if (input.batch.schema !== SIGNED_BATCH_SCHEMA || !Array.isArray(input.batch.admissions) ||
          !input.batch.admissions.length || input.batch.admissions.length > MAX_BATCH_OPERATIONS)
        fail('SIGNED_BATCH_SCHEMA_INVALID');
      const batchSha256 = sha(JSON.stringify(input.batch));
      if (apply && (input.expectedBatch !== batchSha256 || input.expectedPolicy !== policy.sourceSha256))
        fail('SIGNED_BATCH_SOURCE_OR_POLICY_CHANGED');
      if (apply && (typeof input.expectedHead !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedHead) ||
          typeof input.expectedPlan !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedPlan)))
        fail('SIGNED_BATCH_REVIEW_REQUIRED');
      const now = Date.now();
      let expiresAt = Infinity, verifiedPaymentOptions = 0;
      const operations = input.batch.admissions.map((row,index)=>{
        try {
          fields(row, ['sellerId','sequence','sourceURL','observedAt','sourceBase64','proofs']);
          const selected = sellerPolicy(row.sellerId);
          if (typeof row.sourceBase64 !== 'string' || row.sourceBase64.length > 87384)
            fail('ORIGINAL_SOURCE_BYTES_REQUIRED');
          const sourceBytes = Buffer.from(row.sourceBase64,'base64');
          if (sourceBytes.toString('base64') !== row.sourceBase64) fail('SOURCE_BASE64_NOT_CANONICAL');
          const prepared = verifyPinnedSellerAdmission({...row, sourceBytes,
            authority:selected.authority,pinnedPublicKey:selected.pinnedPublicKey,now});
          expiresAt = Math.min(expiresAt,prepared.verification.expiresAt);
          verifiedPaymentOptions += prepared.verification.verifiedPaymentOptions;
          return prepared.operation;
        } catch(error) {
          const code = /^[A-Z0-9_]{1,70}$/.test(error?.message ?? '') ? error.message : 'SELLER_PROOF_REJECTED';
          fail(`SIGNED_BATCH_ITEM_${index}_${code}`);
        }
      });
      if (!apply) return {schema:SIGNED_BATCH_PLAN_SCHEMA,batchSha256,
        policySha256:policy.sourceSha256,expiresAt:new Date(expiresAt).toISOString(),
        verifiedPaymentOptions,review:await catalog.previewBatch(operations)};
      // Proofs are freshly checked above on EVERY apply, not trusted from a saved review.
      const result = await catalog.commitBatch(operations,{expectedHead:input.expectedHead,expectedPlan:input.expectedPlan});
      return {schema:'stellar-forge.catalog-signed-batch-receipt/v1',decision:result.decision,
        head:result.head,operations:result.operationsAfter,changes:result.applied,replays:result.replayed,
        batchSha256,policySha256:policy.sourceSha256,verifiedPaymentOptions,paymentCalls:0,signaturesIssued:0};
    }
    if (command.operation === 'prepare-withdrawal') {
      fields(input, ['sellerId', 'catalogKey', 'sourceURL', 'reason']);
      const selected = sellerPolicy(input.sellerId);
      const current = catalog.lookupCatalogKey(input.catalogKey);
      if (!current || current.signer !== selected.authority.signer) fail('CURRENT_SELLER_PIN_MISMATCH');
      return prepareWithdrawal({ journal: catalog, ...input });
    }
    if (command.operation === 'apply-withdrawal') {
      fields(input, ['envelope']);
      const selected = sellerPolicy(input.envelope?.request?.sellerId);
      return applyWithdrawal({ journal: catalog, envelope: input.envelope,
        pinnedPublicKey: selected.pinnedPublicKey });
    }
    fail('UNKNOWN_OPERATOR_COMMAND');
  };
  const serialize = command => {
    const task = queue.then(() => execute(command));
    queue = task.catch(() => {});
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => {});
    return task;
  };
  const send = (res, status, payload) => {
    if (res.destroyed || res.writableEnded) return;
    let body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX_RESPONSE) {
      status = 413; body = JSON.stringify({ ok: false, error: 'RESPONSE_TOO_LARGE_USE_PAGINATION' });
    }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body), 'cache-control': 'no-store',
      'connection': 'close', 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  try {
    discovery = await serveDiscovery({ catalog, port });
    control = createServer({ maxHeaderSize: 8192, requestTimeout: 10000,
      headersTimeout: 5000, keepAliveTimeout: 1 }, (req, res) => {
      if (controlTransport === 'loopback' && !authenticatedLoopback(req, controlOrigin, controlSecret))
        return send(res, 403, { ok: false, error: 'PRIVATE_CONTROL_AUTH_REQUIRED' });
      if (closing) return send(res, 503, { ok: false, error: 'OPERATOR_CLOSING' });
      if (req.method !== 'POST' || req.url !== '/v1/command') {
        return send(res, 404, { ok: false, error: 'COMMAND_ENDPOINT_REQUIRED' });
      }
      if (req.headers['content-type'] !== 'application/json' || req.headers['transfer-encoding'] ||
          !/^[1-9][0-9]{0,6}$/.test(req.headers['content-length'] ?? '') ||
          Number(req.headers['content-length']) > MAX_COMMAND) {
        return send(res, 413, { ok: false, error: 'BOUNDED_JSON_COMMAND_REQUIRED' });
      }
      const commandBytes = Number(req.headers['content-length']);
      if (inFlight >= 16 || reservedBytes + commandBytes > MAX_QUEUED_BYTES)
        return send(res, 429, { ok: false, error: 'LOCAL_COMMAND_CAPACITY' });
      inFlight++; reservedBytes += commandBytes;
      let released = false;
      const release = () => { if (!released) { released = true; inFlight--; reservedBytes -= commandBytes; } };
      const chunks = [];
      let size = 0, complete = false;
      req.on('error', release);
      req.on('aborted', release);
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_COMMAND) { release(); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (complete) return;
        complete = true;
        if (closing) {
          release(); send(res, 503, { ok: false, error: 'OPERATOR_CLOSING' }); return;
        }
        let command;
        try {
          if (size !== Number(req.headers['content-length'])) fail('COMMAND_LENGTH_MISMATCH');
          command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          release(); send(res, 400, { ok: false, error: 'INVALID_COMMAND_JSON' }); return;
        }
        void serialize(command).then(result => {
          send(res, 200, { ok: true, requestId: command.requestId, result });
        }, error => {
          const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message ?? '') ?
            error.message : 'OPERATOR_COMMAND_REJECTED';
          send(res, 422, { ok: false, requestId: id(command?.requestId) ? command.requestId : null,
            error: code });
        }).finally(release);
      });
    });
    control.maxRequestsPerSocket = 1;
    control.on('connection', socket => {
      connections.add(socket); socket.on('close', () => connections.delete(socket));
    });
    control.on('clientError', (_error, socket) => socket.destroy());
    await new Promise((done, reject) => {
      control.once('error', reject);
      const listening = () => { control.off('error', reject); done(); };
      if (controlTransport === 'loopback') control.listen(0, '127.0.0.1', listening);
      else control.listen(socketPath, listening);
    });
    if (controlTransport === 'unix') await chmod(socketPath, 0o600);
    else {
      controlOrigin = `http://127.0.0.1:${control.address().port}`;
      const bytes = Buffer.from(JSON.stringify({ schema: CONTROL_DESCRIPTOR_SCHEMA,
        transport: 'loopback', origin: controlOrigin, token: controlSecret.toString('hex'),
        processId: process.pid, createdAt: new Date().toISOString() }) + '\n');
      let descriptor;
      try {
        descriptor = await open(descriptorPath, 'wx', 0o600);
        const meta = await descriptor.stat();
        descriptorIdentity = { dev: meta.dev, ino: meta.ino, sha256: sha(bytes), complete: false };
        await descriptor.writeFile(bytes); await descriptor.sync();
        descriptorIdentity.complete = true;
      } finally { bytes.fill(0); await descriptor?.close(); }
      await syncDirectory(target);
    }
  } catch (error) {
    closing = true;
    try {
      if (control?.listening) {
        const stopped = new Promise(done => control.close(done));
        await Promise.allSettled([...pending]);
        for (const connection of connections) connection.destroy();
        await stopped;
      }
    } finally {
      controlSecret?.fill(0);
      try { await removeOwnDescriptor(); }
      finally {
        if (discovery) await discovery.close().catch(() => {});
        await catalog.close();
      }
    }
    throw error;
  }
  return {
    origin: discovery.origin, controlTransport,
    ...(controlTransport === 'unix' ? { socketPath } : { controlOrigin, descriptorPath }),
    policySha256: policy.sourceSha256,
    close() {
      if (!closePromise) closePromise = (async () => {
        closing = true;
        const stopped = new Promise((done, reject) =>
          control.close(error => error ? reject(error) : done()));
        control.closeIdleConnections();
        let socketDeadline;
        try {
          // Accepted writes complete before any control connection is forced
          // closed. Incomplete request bodies are never admitted during drain.
          await Promise.allSettled([...pending]);
          for (const connection of connections) connection.end();
          socketDeadline = setTimeout(() => {
            for (const connection of connections) connection.destroy();
          }, 2000);
          await stopped;
        } finally {
          clearTimeout(socketDeadline);
          controlSecret?.fill(0);
          try { await removeOwnDescriptor(); }
          finally {
            try { await discovery.close(); }
            finally { await catalog.close(); }
          }
        }
      })();
      return closePromise;
    },
  };
}

/** Single attempt, exact source bytes. A transport failure after a write leaves
 * its outcome unknown; inspect status/lookup/history instead of blind retries.
 */
export async function requestCatalogOperator({ directory, operation, input = {},
  requestId = randomUUID(), timeoutMs = 30000 } = {}) {
  const target = resolve(directory), socketPath = join(target, SOCKET_NAME);
  const meta = await lstat(target);
  if (!meta.isDirectory() || meta.isSymbolicLink() || await realpath(target) !== target ||
      (meta.mode & 0o077) !== 0 || (process.getuid && meta.uid !== process.getuid())) {
    fail('OWNED_PRIVATE_OPERATOR_SOCKET_REQUIRED');
  }
  let descriptor;
  try { descriptor = await readControlDescriptor(join(target, CONTROL_DESCRIPTOR_NAME)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let destination, authorization;
  if (descriptor) {
    try { await lstat(socketPath); fail('CONTROL_TRANSPORT_MARKERS_CONFLICT'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const origin = new URL(descriptor.origin);
    destination = { hostname: '127.0.0.1', port: Number(origin.port), protocol: 'http:' };
    authorization = 'Bearer ' + descriptor.token;
    descriptor.token = null;
  } else {
    const socketMeta = await lstat(socketPath);
    if (!socketMeta.isSocket() || (socketMeta.mode & 0o077) !== 0 ||
        (process.getuid && socketMeta.uid !== process.getuid())) fail('OWNED_PRIVATE_OPERATOR_SOCKET_REQUIRED');
    destination = { socketPath };
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) fail('TIMEOUT_INVALID');
  const body = JSON.stringify({ schema: CONTROL_SCHEMA, requestId, operation, input });
  if (Buffer.byteLength(body) > MAX_COMMAND) fail('COMMAND_TOO_LARGE');
  return new Promise((done, reject) => {
    let sent = false, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) {
        error.commandSent = sent;
        error.requestId = requestId;
        reject(error);
      } else done(value);
    };
    const req = httpRequest({ ...destination, method: 'POST', path: '/v1/command', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
        'connection': 'close', ...(authorization ? { authorization } : {}) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE) { req.destroy(new Error('CONTROL_RESPONSE_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      res.on('error', error => finish(error));
      res.on('end', () => {
        try {
          const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200 || reply.ok !== true) {
            const error = new Error(reply.error ?? 'OPERATOR_REQUEST_REJECTED');
            error.statusCode = res.statusCode;
            finish(error); return;
          }
          if (reply.requestId !== requestId) fail('CONTROL_RESPONSE_ID_MISMATCH');
          finish(null, reply.result);
        } catch (error) { finish(error); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('LOCAL_OPERATOR_TIMEOUT')), timeoutMs);
    req.on('finish', () => { sent = true; });
    req.on('error', error => finish(error));
    req.end(body);
  });
}

const USAGE = 'node operator.mjs --directory PRIVATE_DIR --policy TRUSTED_POLICY.json [--port 8787] [--control unix|loopback] [--create-empty]';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {}, seen = new Set();
    if (args.length === 1 && args[0] === '--help') console.log(USAGE);
    else {
      for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (seen.has(key) || !['--directory', '--policy', '--port', '--control', '--create-empty'].includes(key)) fail(USAGE);
        seen.add(key);
        if (key === '--create-empty') { options.createEmpty = true; continue; }
        const value = args[++i];
        if (!value || value.startsWith('--')) fail(USAGE);
        if (key === '--directory') options.directory = value;
        if (key === '--policy') options.policyFile = value;
        if (key === '--control') options.controlTransport = value;
        if (key === '--port') {
          if (!/^[0-9]{1,5}$/.test(value)) fail(USAGE);
          options.port = Number(value);
        }
      }
      const service = await openCatalogOperator(options);
      console.log(JSON.stringify({ state: 'LISTENING', origin: service.origin,
        controlTransport: service.controlTransport, socketPath: service.socketPath,
        controlOrigin: service.controlOrigin, descriptorPath: service.descriptorPath,
        policySha256: service.policySha256 }));
      const stop = () => { service.close().catch(error => {
        console.error(error?.message ?? String(error)); process.exitCode = 1;
      }); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    }
  } catch (error) { console.error(error?.message ?? String(error)); process.exitCode = 1; }
}
