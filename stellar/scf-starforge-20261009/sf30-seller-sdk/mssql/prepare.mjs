// MIT. One original public contract compiler and one private prepared artifact.
import { createHash } from 'node:crypto';
import { mkdir, open, lstat, readFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { compileQueryMerchantPlan } from '../postgres/prepare.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { exportSellerClient } from '../developer/client-export.mjs';
import { compileMssqlQueries, bindMssqlParameters } from './declaration.mjs';
import { readMssqlSourceFile } from './config.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
async function readLimited(path, maximum = 262144) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new TypeError('MSSQL_PREPARE_INPUT_INVALID');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw new TypeError('MSSQL_PREPARE_INPUT_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}

export function compileMssqlMerchantPlan(queries, plan) {
  const result=compileQueryMerchantPlan(compileMssqlQueries(queries),plan,{
    schema:'stellar-forge.mssql-merchant-plan.v1',handlerPrefix:'mssqlQuery',
    admitPrefix:'mssqlAdmit',bindParameters:bindMssqlParameters});
  for(const route of result.service.routes){
    const input=route.offer.extensions.bazaar.schema.properties.input;
    for(const shape of Object.values(input.properties)){
      if(!shape?.properties)continue;
      for(const field of Object.values(shape.properties))
        if(typeof field.description==='string')field.description=field.description.replace('PostgreSQL NUL text','NUL text');
    }
  }
  return result;
}

export async function prepareMssqlSeller({ sourceFile, planFile, directory } = {}) {
  if (![sourceFile, planFile, directory].every(value => typeof value === 'string' && value.length))
    throw new TypeError('MSSQL_PREPARE_PATHS_REQUIRED');
  const original = await readMssqlSourceFile(sourceFile);
  const planBytes = await readLimited(planFile);
  const plan = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(planBytes));
  const { service, bindings } = compileMssqlMerchantPlan(original.config.queries, plan);
  const source = { ...structuredClone(original.config), bindings };
  let ca;
  if (source.connection.caFile) {
    ca = await readLimited(resolve(dirname(original.path), source.connection.caFile), 1048576);
    source.connection.caFile = 'database-ca.pem';
  }
  const compiled = compileSellerRoutes(service.routes.map(route => ({ id: route.id, offer: route.offer,
    handler() { throw new Error('Preparation only'); }, admit() { return true; } })));
  const openapi = compileSellerOpenApi(compiled, { mode: 'CHALLENGE_ONLY' });
  const target = resolve(directory);
  await mkdir(target, { mode: 0o700 });
  const files = {};
  async function put(name, bytes) {
    const handle = await open(resolve(target, name), 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    files[name] = { sha256: sha(bytes), bytes: bytes.length };
  }
  try {
    await put('source.json', encode(source)); await put('service.json', encode(service));
    await put('merchant-plan.json', planBytes); await put('openapi.json', encode(openapi));
    if (ca) await put('database-ca.pem', ca);
    const client = await exportSellerClient({ openapi: resolve(target, 'openapi.json'), out: resolve(target, 'client') });
    for (const name of client.files) {
      const relative = 'client/' + name, bytes = await readLimited(resolve(target, relative), 16777216);
      files[relative] = { sha256: sha(bytes), bytes: bytes.length };
    }
    await readMssqlSourceFile(resolve(target, 'source.json'));
    const manifest = { schema: 'stellar-forge.mssql-prepared.v1', createdAt: new Date().toISOString(),
      files, routes: service.routes.map(route => ({ id: route.id, method: route.offer.extensions.bazaar.info.input.method,
        url: route.offer.resource.url, paymentOptions: route.offer.accepts.length })),
      sourceSemantics: 'live-named-read-queries', client: 'original-sf30' };
    const handle = await open(resolve(target, 'manifest.json'), 'wx', 0o600);
    try { await handle.writeFile(encode(manifest)); await handle.sync(); } finally { await handle.close(); }
    const dir = await open(target, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    return { directory: target, ...manifest, manifestSha256: sha(encode(manifest)) };
  } catch (issue) { await rm(target, { recursive: true, force: true }); throw issue; }
}

export async function verifyPreparedMssqlSeller(directory) {
  const root = resolve(directory), info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('MSSQL_PREPARED_DIRECTORY_INVALID');
  const bytes = await readLimited(resolve(root, 'manifest.json'));
  const manifest = JSON.parse(bytes);
  const allowed = new Set(['source.json', 'service.json', 'merchant-plan.json', 'openapi.json', 'database-ca.pem',
    'client/seller-client.mjs', 'client/seller-client.d.mts', 'client/seller-openapi.json', 'client/package.json', 'client/README.md']);
  const required = [...allowed].filter(name => name !== 'database-ca.pem');
  if (manifest?.schema !== 'stellar-forge.mssql-prepared.v1' || !manifest.files ||
      required.some(name => !Object.hasOwn(manifest.files, name)) || Object.keys(manifest.files).some(name => !allowed.has(name)))
    throw new TypeError('MSSQL_PREPARED_MANIFEST_INVALID');
  const clientDirectory = await lstat(resolve(root, 'client'));
  if (!clientDirectory.isDirectory() || clientDirectory.isSymbolicLink()) throw new TypeError('MSSQL_PREPARED_CLIENT_INVALID');
  for (const [name, expected] of Object.entries(manifest.files)) {
    const path = resolve(root, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !Number.isInteger(expected?.bytes) || expected.bytes < 0 ||
        stat.size !== expected.bytes || sha(await readLimited(path, 16777216)) !== expected.sha256)
      throw new TypeError('MSSQL_PREPARED_FILE_CHANGED:' + name);
  }
  await readMssqlSourceFile(resolve(root, 'source.json'));
  return { directory: root, ...manifest, manifestSha256: sha(bytes) };
}
