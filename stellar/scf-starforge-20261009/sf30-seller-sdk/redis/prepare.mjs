// MIT. Original seller contracts and clients around a private Redis declaration.
import { createHash } from 'node:crypto';
import { mkdir, open, lstat, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { compileQueryMerchantPlan } from '../postgres/prepare.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { exportSellerClient, CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST } from '../developer/client-export.mjs';
import { compileRedisQueries, bindRedisParameters } from './declaration.mjs';
import { readRedisSourceFile } from './config.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const normalized = value => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
const stable = value => JSON.stringify(normalized(value));
const SOURCE_SEMANTICS = 'live-named-read-commands';
const requiredEnvironmentOf = connection => connection.transport === 'upstash-rest'
  ? [connection.tokenEnv] : connection.passwordEnv ? [connection.passwordEnv] : [];

async function readLimited(path, maximum = 262144) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new TypeError('REDIS_PREPARE_INPUT_INVALID');
    const bytes = Buffer.alloc(stat.size + 1); let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new TypeError('REDIS_PREPARE_INPUT_CHANGED');
    return bytes.subarray(0, total);
  } finally { await handle.close(); }
}

export function compileRedisMerchantPlan(queries, plan) {
  const compiled = compileRedisQueries(queries);
  if (plan?.schema !== 'stellar-forge.redis-merchant-plan.v1') throw new TypeError('REDIS_MERCHANT_PLAN_INVALID');
  const result = compileQueryMerchantPlan(compiled, plan, {
    schema: 'stellar-forge.redis-merchant-plan.v1', handlerPrefix: 'redisQuery', admitPrefix: 'redisAdmit',
    bindParameters: bindRedisParameters,
  });
  for (const route of result.service.routes) {
    const input = route.offer.extensions.bazaar.schema.properties.input;
    for (const shape of Object.values(input.properties)) {
      if (!shape?.properties) continue;
      for (const field of Object.values(shape.properties)) if (typeof field.description === 'string')
        field.description = field.description.replaceAll('PostgreSQL NUL text', 'NUL text').replaceAll('SQL null', 'null');
    }
  }
  return result;
}

/** Prepare private source and public customer artifacts without opening Redis. */
export async function prepareRedisSeller({ sourceFile, planFile, directory } = {}) {
  if (![sourceFile, planFile, directory].every(value => typeof value === 'string' && value.length && value.length <= 4096))
    throw new TypeError('REDIS_PREPARE_PATHS_REQUIRED');
  const original = await readRedisSourceFile(sourceFile);
  const planBytes = await readLimited(planFile);
  const plan = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(planBytes));
  const { service, bindings } = compileRedisMerchantPlan(original.config.queries, plan);
  const source = { ...structuredClone(original.config), bindings };
  let ca;
  if (source.connection.caFile) {
    ca = await readLimited(resolve(dirname(original.path), source.connection.caFile), 1048576);
    source.connection.caFile = 'database-ca.pem';
  }
  const compiled = compileSellerRoutes(service.routes.map(route => ({ id: route.id, offer: route.offer,
    handler() { throw new Error('Preparation only'); }, admit() { return true; } })));
  const openapi = compileSellerOpenApi(compiled, { mode: 'CHALLENGE_ONLY' });
  const sourceBytes = encode(source), serviceBytes = encode(service);
  if (sourceBytes.length > 262144 || serviceBytes.length > 1048576)
    throw new RangeError('REDIS_PREPARED_CONFIGURATION_TOO_LARGE');
  const target = resolve(directory);
  await mkdir(target, { mode: 0o700 });
  const files = {};
  async function put(name, bytes) {
    if (bytes.length > 16777216) throw new RangeError('REDIS_PREPARED_FILE_TOO_LARGE');
    const handle = await open(resolve(target, name), 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    files[name] = { sha256: sha(bytes), bytes: bytes.length };
  }
  try {
    await put('source.json', sourceBytes); await put('service.json', serviceBytes);
    await put('merchant-plan.json', planBytes); await put('openapi.json', encode(openapi));
    if (ca) await put('database-ca.pem', ca);
    const client = await exportSellerClient({ openapi: resolve(target, 'openapi.json'), out: resolve(target, 'client') });
    for (const name of [...client.files, client.manifestFile.name]) {
      const relative = 'client/' + name, bytes = await readLimited(resolve(target, relative), 16777216);
      files[relative] = { sha256: sha(bytes), bytes: bytes.length };
    }
    await readRedisSourceFile(resolve(target, 'source.json'));
    const manifest = { schema: 'stellar-forge.redis-prepared.v1', createdAt: new Date().toISOString(), files,
      routes: service.routes.map(route => ({ id: route.id, method: route.offer.extensions.bazaar.info.input.method,
        url: route.offer.resource.url, paymentOptions: route.offer.accepts.length })),
      requiredEnvironment: requiredEnvironmentOf(source.connection),
      sourceSemantics: SOURCE_SEMANTICS, client: 'original-sf30' };
    const bytes = encode(manifest), handle = await open(resolve(target, 'manifest.json'), 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (process.platform !== 'win32') {
      const dir = await open(target, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    }
    return { directory: target, ...manifest, manifestSha256: sha(bytes) };
  } catch (issue) { await rm(target, { recursive: true, force: true }); throw issue; }
}

/** Reopen the retained bytes and regenerate their public contract from the plan. */
export async function verifyPreparedRedisSeller(directory) {
  const root = resolve(directory), info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('REDIS_PREPARED_DIRECTORY_INVALID');
  const manifestInfo = await lstat(resolve(root, 'manifest.json'));
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new TypeError('REDIS_PREPARED_MANIFEST_INVALID');
  const bytes = await readLimited(resolve(root, 'manifest.json'));
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const allowed = new Set(['source.json', 'service.json', 'merchant-plan.json', 'openapi.json', 'database-ca.pem',
    ...[...CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST].map(name => 'client/' + name)]);
  const required = [...allowed].filter(name => name !== 'database-ca.pem');
  if (manifest?.schema !== 'stellar-forge.redis-prepared.v1' || !manifest.files ||
      typeof manifest.files !== 'object' || Array.isArray(manifest.files) ||
      required.some(name => !Object.hasOwn(manifest.files, name)) || Object.keys(manifest.files).some(name => !allowed.has(name)))
    throw new TypeError('REDIS_PREPARED_MANIFEST_INVALID');
  const clientDirectory = await lstat(resolve(root, 'client'));
  if (!clientDirectory.isDirectory() || clientDirectory.isSymbolicLink()) throw new TypeError('REDIS_PREPARED_CLIENT_INVALID');
  for (const [name, expected] of Object.entries(manifest.files)) {
    const path = resolve(root, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(expected?.bytes) || expected.bytes < 0 ||
        stat.size !== expected.bytes || sha(await readLimited(path, 16777216)) !== expected.sha256)
      throw new TypeError('REDIS_PREPARED_FILE_CHANGED:' + name);
  }
  const declaration = await readRedisSourceFile(resolve(root, 'source.json'));
  const plan = JSON.parse(await readLimited(resolve(root, 'merchant-plan.json')));
  const { service, bindings } = compileRedisMerchantPlan(declaration.config.queries, plan);
  if (sha(encode(service)) !== manifest.files['service.json'].sha256 || stable(bindings) !== stable(declaration.config.bindings))
    throw new TypeError('REDIS_PREPARED_CONTRACT_CHANGED');
  const hasCa = Object.hasOwn(manifest.files, 'database-ca.pem');
  if (hasCa !== Boolean(declaration.config.connection.caFile) || hasCa && declaration.config.connection.caFile !== 'database-ca.pem')
    throw new TypeError('REDIS_PREPARED_CA_CHANGED');
  const routes = service.routes.map(route => ({ id: route.id, method: route.offer.extensions.bazaar.info.input.method,
    url: route.offer.resource.url, paymentOptions: route.offer.accepts.length }));
  const requiredEnvironment = requiredEnvironmentOf(declaration.config.connection);
  if (manifest.sourceSemantics !== SOURCE_SEMANTICS || manifest.client !== 'original-sf30' ||
      stable(manifest.routes) !== stable(routes) || stable(manifest.requiredEnvironment) !== stable(requiredEnvironment))
    throw new TypeError('REDIS_PREPARED_MANIFEST_CONTRACT_CHANGED');
  return { directory: root, ...manifest, manifestSha256: sha(bytes) };
}
