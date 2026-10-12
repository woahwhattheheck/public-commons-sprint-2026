// MIT. Durable customer custody for the original completed paid-job result.
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { HASH, DESTINATION_ID, MAX_RESULT_BYTES, parseManifestHeader, validateManifest,
  createSignatureHmac, parseSignature, acknowledgmentFor, validateAcknowledgment, signManifest,
} from '../result-delivery/wire.mjs';
import { assertDeliveryLease, withDeliveryLease } from '../../../sf98-merchant-delivery/delivery-lock.mjs';

const CONFIG_SCHEMA = 'stellar-forge.job-result-receiver.v1';
const NOW = () => Date.now();
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const error = (code, status = 400) => Object.assign(new Error(code), { code, status });
const canonical = value => JSON.stringify(value, (_key, item) => item &&
  typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function privateDirectory(path, { create = false } = {}) {
  if (create) await mkdir(path, { mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      process.getuid && info.uid !== process.getuid()) throw error('JRR_PRIVATE_DIRECTORY_REQUIRED');
  return info;
}
async function file(path, maxBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes || (stat.mode & 0o077) !== 0 ||
        process.getuid && stat.uid !== process.getuid()) throw error('JRR_STORED_FILE_INVALID', 409);
    return { handle, stat };
  } catch (failure) { await handle.close(); throw failure; }
}
async function readJson(path, maxBytes = 32768) {
  const opened = await file(path, maxBytes);
  try { return JSON.parse(await opened.handle.readFile('utf8')); }
  finally { await opened.handle.close(); }
}
async function writeBytes(path, bytes) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

export function validateReceiverConfig(value) {
  if (!value || value.schema !== CONFIG_SCHEMA || !DESTINATION_ID.test(value.destination?.id ?? ''))
    throw error('JRR_CONFIG_INVALID');
  let endpoint;
  try { endpoint = new URL(value.destination.url); } catch { throw error('JRR_DESTINATION_INVALID'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search ||
      endpoint.hash || endpoint.pathname === '/' || endpoint.href !== value.destination.url)
    throw error('JRR_DESTINATION_INVALID');
  if (!Array.isArray(value.merchants) || value.merchants.length < 1 || value.merchants.length > 100)
    throw error('JRR_MERCHANT_SELECTION_REQUIRED');
  const merchants = value.merchants.map(merchant => {
    let origin;
    try { origin = new URL(merchant.publicOrigin); } catch { throw error('JRR_MERCHANT_INVALID'); }
    if (merchant.publicOrigin !== origin.origin ||
        !(origin.protocol === 'https:' || origin.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) ||
        merchant.configSha256 != null && !HASH.test(merchant.configSha256) ||
        merchant.applicationSha256 != null && !HASH.test(merchant.applicationSha256))
      throw error('JRR_MERCHANT_INVALID');
    return { publicOrigin: merchant.publicOrigin,
      ...(merchant.configSha256 == null ? {} : { configSha256: merchant.configSha256 }),
      ...(merchant.applicationSha256 == null ? {} : { applicationSha256: merchant.applicationSha256 }) };
  });
  if (!Number.isSafeInteger(value.maxResultBytes) || value.maxResultBytes < 0 ||
      value.maxResultBytes > MAX_RESULT_BYTES || typeof value.secretEnv !== 'string' ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.secretEnv)) throw error('JRR_CONFIG_INVALID');
  return { schema: CONFIG_SCHEMA, destination: { id: value.destination.id, url: endpoint.href },
    merchants, maxResultBytes: value.maxResultBytes, secretEnv: value.secretEnv };
}

export async function initializeReceiver(root, options) {
  if (!isAbsolute(root)) throw error('JRR_ABSOLUTE_ROOT_REQUIRED');
  const config = validateReceiverConfig({ schema: CONFIG_SCHEMA, ...options,
    maxResultBytes: options.maxResultBytes ?? MAX_RESULT_BYTES,
    secretEnv: options.secretEnv ?? 'STARFORGE_JOB_DELIVERY_SECRET' });
  const destination = resolve(root);
  const parent = await realpath(dirname(destination));
  if (parent !== dirname(destination)) throw error('JRR_CANONICAL_PARENT_REQUIRED');
  await mkdir(destination, { mode: 0o700 });
  await privateDirectory(join(destination, 'results'), { create: true });
  await privateDirectory(join(destination, 'incoming'), { create: true });
  await writeBytes(join(destination, 'receiver.json'), jsonBytes(config));
  await syncDirectory(destination);
  await syncDirectory(parent);
  return { schema: 'stellar-forge.job-result-receiver-initialized.v1', root: destination, config };
}

export async function openResultReceiver(root, { clock = NOW } = {}) {
  if (!isAbsolute(root)) throw error('JRR_ABSOLUTE_ROOT_REQUIRED');
  root = resolve(root);
  if (await realpath(root) !== root) throw error('JRR_CANONICAL_ROOT_REQUIRED');
  await privateDirectory(root);
  await privateDirectory(join(root, 'results'));
  await privateDirectory(join(root, 'incoming'));
  const config = validateReceiverConfig(await readJson(join(root, 'receiver.json')));
  const resultDirectory = id => {
    if (typeof id !== 'string' || !HASH.test(id)) throw error('JRR_DELIVERY_ID_INVALID');
    return join(root, 'results', id);
  };
  function select(manifest) {
    if (manifest.destination.id !== config.destination.id || manifest.destination.url !== config.destination.url)
      throw error('JRR_DESTINATION_MISMATCH', 403);
    const accepted = config.merchants.some(merchant =>
      merchant.publicOrigin === manifest.merchant.publicOrigin &&
      (merchant.configSha256 == null || merchant.configSha256 === manifest.merchant.configSha256) &&
      (merchant.applicationSha256 == null || merchant.applicationSha256 === manifest.merchant.applicationSha256));
    if (!accepted) throw error('JRR_MERCHANT_MISMATCH', 403);
    if (manifest.result.bytes > config.maxResultBytes) throw error('JRR_RESULT_TOO_LARGE', 413);
  }
  async function metadata(id) {
    const directory = resultDirectory(id);
    await privateDirectory(directory);
    const manifest = validateManifest(await readJson(join(directory, 'manifest.json')));
    if (manifest.deliveryId !== id) throw error('JRR_STORED_ID_MISMATCH', 409);
    select(manifest);
    const receipt = await readJson(join(directory, 'receipt.json'));
    validateAcknowledgment(receipt, manifest);
    if (typeof receipt.receivedAt !== 'string' || !Number.isFinite(Date.parse(receipt.receivedAt)))
      throw error('JRR_STORED_RECEIPT_INVALID', 409);
    return { manifest, receipt };
  }
  async function openVerifiedResult(id) {
    const value = await metadata(id);
    const opened = await file(join(resultDirectory(id), 'body'), config.maxResultBytes);
    try {
      if (opened.stat.size !== value.manifest.result.bytes) throw error('JRR_STORED_RESULT_CHANGED', 409);
      const hash = createHash('sha256');
      for await (const chunk of opened.handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
      const after = await opened.handle.stat();
      if (hash.digest('hex') !== value.manifest.result.sha256 || after.size !== opened.stat.size ||
          after.mtimeMs !== opened.stat.mtimeMs || after.ctimeMs !== opened.stat.ctimeMs)
        throw error('JRR_STORED_RESULT_CHANGED', 409);
      return { ...value, handle: opened.handle, bytes: after.size,
        stream: () => opened.handle.createReadStream({ autoClose: false, start: 0 }),
        close: () => opened.handle.close() };
    } catch (failure) { await opened.handle.close(); throw failure; }
  }
  async function verify(id) {
    const result = await openVerifiedResult(id);
    try { return { ...result.receipt, verifiedAt: new Date(clock()).toISOString(), manifest: result.manifest }; }
    finally { await result.close(); }
  }
  async function receive({ headers, body, secret, lease }) {
    if (!lease) return withDeliveryLease(root, async held => {
      await recoverIncoming({ lease: held });
      return receive({ headers, body, secret, lease: held });
    }, { purpose: 'worker' });
    await assertDeliveryLease(lease, root);
    const header = name => {
      const value = typeof headers?.get === 'function' ? headers.get(name) : headers?.[name];
      if (typeof value !== 'string') throw error('JRR_HEADER_REQUIRED');
      return value;
    };
    const manifestHeader = header('x-sfjobs-manifest');
    const manifest = parseManifestHeader(manifestHeader);
    select(manifest);
    const timestamp = header('x-sfjobs-timestamp');
    const signature = parseSignature(header('x-sfjobs-signature'));
    const hmac = createSignatureHmac(secret, timestamp, manifestHeader);
    if (Math.abs(Math.floor(clock() / 1000) - Number(timestamp)) > 300)
      throw error('JRR_SIGNATURE_EXPIRED', 401);
    const manifestSignature = parseSignature(header('x-sfjobs-manifest-signature'));
    if (!timingSafeEqual(manifestSignature, parseSignature(signManifest(secret, timestamp, manifestHeader))))
      throw error('JRR_SIGNATURE_MISMATCH', 401);
    if (header('idempotency-key') !== manifest.deliveryId ||
        header('x-content-sha256') !== manifest.result.sha256 ||
        header('content-length') !== String(manifest.result.bytes) ||
        header('content-type') !== manifest.result.contentType)
      throw error('JRR_CONTENT_HEADERS_MISMATCH');
    const encoding = typeof headers?.get === 'function' ? headers.get('content-encoding') : headers?.['content-encoding'];
    if (encoding && encoding !== 'identity') throw error('JRR_CONTENT_ENCODING_UNSUPPORTED');

    const staging = join(root, 'incoming', manifest.deliveryId + '-' + randomUUID());
    await mkdir(staging, { mode: 0o700 });
    let handle = null;
    let published = false;
    try {
      handle = await open(join(staging, 'body'), constants.O_WRONLY | constants.O_CREAT |
        constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const incoming of body) {
        const chunk = Buffer.isBuffer(incoming) ? incoming : Buffer.from(incoming);
        bytes += chunk.length;
        if (bytes > manifest.result.bytes || bytes > config.maxResultBytes)
          throw error('JRR_RESULT_TOO_LARGE', 413);
        hash.update(chunk);
        hmac.update(chunk);
        await handle.writeFile(chunk);
      }
      if (bytes !== manifest.result.bytes || hash.digest('hex') !== manifest.result.sha256)
        throw error('JRR_RESULT_DIGEST_MISMATCH', 422);
      if (!timingSafeEqual(hmac.digest(), signature)) throw error('JRR_SIGNATURE_MISMATCH', 401);
      await handle.sync();
      await handle.close(); handle = null;
      const receipt = { ...acknowledgmentFor(manifest), receivedAt: new Date(clock()).toISOString() };
      await writeBytes(join(staging, 'manifest.json'), jsonBytes(manifest));
      await writeBytes(join(staging, 'receipt.json'), jsonBytes(receipt));
      await syncDirectory(staging);
      await assertDeliveryLease(lease, root);
      try {
        await rename(staging, resultDirectory(manifest.deliveryId));
        published = true;
      } catch (failure) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(failure.code)) throw failure;
        const prior = await openVerifiedResult(manifest.deliveryId);
        try {
          if (canonical(prior.manifest) !== canonical(manifest)) throw error('JRR_DELIVERY_ID_CONFLICT', 409);
          await syncDirectory(join(root, 'results'));
          return { receipt: prior.receipt, duplicate: true };
        } finally { await prior.close(); }
      }
      await syncDirectory(join(root, 'results'));
      await syncDirectory(join(root, 'incoming'));
      return { receipt, duplicate: false };
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (!published) await rm(staging, { recursive: true, force: true });
    }
  }
  async function recoverIncoming({ lease } = {}) {
    if (!lease) return withDeliveryLease(root, held => recoverIncoming({ lease: held }), { purpose: 'worker' });
    await assertDeliveryLease(lease, root);
    const recovered = []; const cleared = []; const retained = [];
    const incoming = join(root, 'incoming');
    for (const name of (await readdir(incoming)).sort()) {
      if (!/^[a-f0-9]{64}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name)) {
        retained.push({ name, reason: 'UNRECOGNIZED_ENTRY' }); continue;
      }
      const stage = join(incoming, name);
      try { await privateDirectory(stage); }
      catch { retained.push({ name, reason: 'UNRECOGNIZED_ENTRY' }); continue; }
      const names = await readdir(stage);
      let bytes = 0; let recognized = true;
      for (const member of names) {
        const info = await lstat(join(stage, member));
        if (!['body', 'manifest.json', 'receipt.json'].includes(member) || !info.isFile() ||
            info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0) recognized = false;
        bytes += info.size;
      }
      if (!recognized) { retained.push({ name, reason: 'UNRECOGNIZED_ENTRY' }); continue; }
      if (!names.includes('manifest.json') || !names.includes('receipt.json')) {
        await rm(stage, { recursive: true }); cleared.push({ name, bytes }); continue;
      }
      try {
        const manifest = validateManifest(await readJson(join(stage, 'manifest.json')));
        const receipt = await readJson(join(stage, 'receipt.json'));
        validateAcknowledgment(receipt, manifest); select(manifest);
        if (manifest.deliveryId !== name.slice(0, 64) ||
            typeof receipt.receivedAt !== 'string' || !Number.isFinite(Date.parse(receipt.receivedAt)))
          throw error('JRR_STORED_ID_MISMATCH');
        const opened = await file(join(stage, 'body'), config.maxResultBytes);
        try {
          const digest = createHash('sha256');
          for await (const chunk of opened.handle.createReadStream({ autoClose: false, start: 0 })) digest.update(chunk);
          if (opened.stat.size !== manifest.result.bytes || digest.digest('hex') !== manifest.result.sha256)
            throw error('JRR_STORED_RESULT_CHANGED');
          await opened.handle.sync();
        } finally { await opened.handle.close(); }
        await syncDirectory(stage);
        await assertDeliveryLease(lease, root);
        try { await rename(stage, resultDirectory(manifest.deliveryId)); }
        catch (failure) {
          if (!['EEXIST', 'ENOTEMPTY'].includes(failure.code)) throw failure;
          const prior = await openVerifiedResult(manifest.deliveryId);
          try {
            if (canonical(prior.manifest) !== canonical(manifest)) throw error('JRR_DELIVERY_ID_CONFLICT');
          } finally { await prior.close(); }
          await rm(stage, { recursive: true });
        }
        await syncDirectory(join(root, 'results'));
        recovered.push({ deliveryId: manifest.deliveryId, bytes: manifest.result.bytes });
      } catch (failure) {
        if (failure instanceof SyntaxError) {
          await rm(stage, { recursive: true }); cleared.push({ name, bytes });
        } else retained.push({ name, reason: failure.code ?? 'JRR_INCOMPLETE_METADATA' });
      }
    }
    await syncDirectory(incoming);
    return { schema: 'stellar-forge.job-result-incoming-recovery.v1', recovered, cleared, retained };
  }
  async function list({ after = '', limit = 50 } = {}) {
    if (after !== '' && !HASH.test(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw error('JRR_PAGE_INVALID');
    const ids = (await readdir(join(root, 'results'))).filter(id => HASH.test(id)).sort();
    const selected = ids.filter(id => id > after).slice(0, limit + 1);
    const rows = [];
    for (const id of selected.slice(0, limit)) {
      try { rows.push({ deliveryId: id, ...(await metadata(id)), state: 'STORED' }); }
      catch (failure) { rows.push({ deliveryId: id, state: 'UNREADABLE', error: failure.code ?? 'JRR_STORED_RESULT_INVALID' }); }
    }
    return { schema: 'stellar-forge.job-result-receiver-page.v1', total: ids.length, rows,
      next: selected.length > limit ? selected[limit - 1] : null };
  }
  async function exportResult(id, target) {
    if (!isAbsolute(target)) throw error('JRR_ABSOLUTE_EXPORT_REQUIRED');
    target = resolve(target);
    const parent = await realpath(dirname(target));
    if (parent !== dirname(target) || target === root || target.startsWith(root + '/'))
      throw error('JRR_EXPORT_DESTINATION_INVALID');
    const source = await openVerifiedResult(id);
    const staging = join(parent, '.job-result-' + randomUUID());
    let created = false;
    try {
      await mkdir(staging, { mode: 0o700 }); created = true;
      await mkdir(join(staging, 'result'), { mode: 0o700 });
      const output = await open(join(staging, 'result', source.manifest.result.filename),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const hash = createHash('sha256'); let size = 0;
      try {
        for await (const chunk of source.stream()) {
          hash.update(chunk); size += chunk.length; await output.writeFile(chunk);
        }
        if (size !== source.bytes || hash.digest('hex') !== source.manifest.result.sha256)
          throw error('JRR_STORED_RESULT_CHANGED', 409);
        await output.sync();
      } finally { await output.close(); }
      await writeBytes(join(staging, 'delivery-manifest.json'), jsonBytes(source.manifest));
      await writeBytes(join(staging, 'receiver-receipt.json'), jsonBytes(source.receipt));
      await syncDirectory(join(staging, 'result'));
      await syncDirectory(staging);
      await mkdir(target, { mode: 0o700 });
      for (const name of await readdir(staging)) await rename(join(staging, name), join(target, name));
      await writeBytes(join(target, 'export.json'), jsonBytes({
        schema: 'stellar-forge.job-result-export.v1', state: 'COMPLETE',
        deliveryId: id, resultSha256: source.manifest.result.sha256, bytes: source.bytes,
        resultFile: 'result/' + source.manifest.result.filename,
      }));
      await syncDirectory(target); await syncDirectory(parent);
      return { schema: 'stellar-forge.job-result-export.v1', directory: target,
        deliveryId: id, resultSha256: source.manifest.result.sha256, bytes: source.bytes };
    } finally {
      await source.close();
      if (created) await rm(staging, { recursive: true, force: true });
    }
  }
  return { root, config: structuredClone(config), receive, recoverIncoming, list, metadata, verify, openVerifiedResult, exportResult };
}
