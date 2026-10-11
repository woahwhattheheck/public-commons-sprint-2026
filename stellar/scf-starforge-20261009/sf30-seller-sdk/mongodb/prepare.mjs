// MIT. Original SF30 offer, OpenAPI and buyer client compilation with Mongo admission.
import { mkdir, lstat, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { compilePostgresMerchantPlan } from '../postgres/prepare.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { exportSellerClient } from '../developer/client-export.mjs';
import { compileMongoQueries, mongoPublicQueries, bindMongoParameters } from './declaration.mjs';
import { readMongoSourceFile } from './config.mjs';
import { encode, digest, limited, readJson, writeNew, syncDirectory, fail } from './common.mjs';

export function compileMongoMerchantPlan(queries, plan) {
  const declarations = compileMongoQueries(queries);
  if (plan?.schema !== 'stellar-forge.mongodb-merchant-plan.v1') fail('MONGODB_MERCHANT_PLAN_INVALID');
  const result = compilePostgresMerchantPlan(mongoPublicQueries(queries), { ...plan, schema: 'stellar-forge.postgres-merchant-plan.v1' });
  for (let index = 0; index < result.service.routes.length; index++) {
    const route = result.service.routes[index], original = plan.routes[index], query = declarations[original.query];
    const publicInput = route.offer.extensions.bazaar.info.input;
    const key = result.bindings[route.id].input === 'query' ? 'queryParams' : 'body';
    bindMongoParameters(query, publicInput[key]);
    route.handler = 'mongodbQuery' + index; route.admit = 'mongodbAdmit' + index;
    const properties = route.offer.extensions.bazaar.schema.properties.input.properties[key].properties;
    for (const [name, spec] of Object.entries(query.parameters)) {
      let description = properties[name].description.replaceAll('PostgreSQL NUL text', 'NUL text').replaceAll('SQL null', 'null');
      if (spec.type === 'objectId') description += ' Exactly 24 hexadecimal characters; bound as BSON ObjectId.';
      if (spec.type === 'date') description += ' Canonical UTC ISO instant YYYY-MM-DDTHH:mm:ss.sssZ; bound as BSON Date.';
      if (spec.type === 'decimal') description += ' Must be exactly representable in MongoDB Decimal128; rounding is rejected.';
      properties[name].description = description;
    }
  }
  return result;
}

export async function prepareMongoSeller({ sourceFile, planFile, directory } = {}) {
  if (![sourceFile, planFile, directory].every(value => typeof value === 'string' && value.length)) fail('MONGODB_PREPARE_PATHS_REQUIRED');
  const declaration = await readMongoSourceFile(sourceFile), planBytes = await limited(planFile), plan = JSON.parse(planBytes);
  const { service, bindings } = compileMongoMerchantPlan(declaration.config.queries, plan);
  const source = { ...structuredClone(declaration.config), bindings };
  let ca;
  if (source.connection.caFile) {
    ca = await limited(resolve(dirname(declaration.path), source.connection.caFile), 1048576);
    source.connection.caFile = 'database-ca.pem';
  }
  const compiled = compileSellerRoutes(service.routes.map(route => ({ id: route.id, offer: route.offer,
    handler() { throw new Error('Preparation only'); }, admit() { return true; } })));
  const openapi = compileSellerOpenApi(compiled, { mode: 'CHALLENGE_ONLY' });
  const target = resolve(directory); await mkdir(target, { mode: 0o700 });
  const files = {};
  async function put(name, bytes) {
    await writeNew(resolve(target, name), bytes);
    files[name] = { sha256: digest(bytes), bytes: bytes.length };
  }
  try {
    await put('source.json', encode(source)); await put('service.json', encode(service));
    await put('merchant-plan.json', planBytes); await put('openapi.json', encode(openapi));
    if (ca) await put('database-ca.pem', ca);
    const client = await exportSellerClient({ openapi: resolve(target, 'openapi.json'), out: resolve(target, 'client') });
    for (const name of client.files) {
      const relative = 'client/' + name, bytes = await limited(resolve(target, relative), 16777216);
      files[relative] = { sha256: digest(bytes), bytes: bytes.length };
    }
    await readMongoSourceFile(resolve(target, 'source.json'));
    const manifest = { schema: 'stellar-forge.mongodb-prepared.v1', createdAt: new Date().toISOString(), files,
      routes: service.routes.map(route => ({ id: route.id, method: route.offer.extensions.bazaar.info.input.method,
        url: route.offer.resource.url, paymentOptions: route.offer.accepts.length })),
      requiredEnvironment: [source.connection.uriEnv], sourceSemantics: 'live-fixed-read-aggregations',
      valueEncoding: 'mongodb-canonical-extended-json-v2', client: 'original-sf30',
      runtime: { node: '>=22.16.0', mongodbDriver: '7.7.0', mongodbServer: '>=5.0',
        snapshotRequires: 'replica-set-or-sharded-server' } };
    const bytes = encode(manifest); await writeNew(resolve(target, 'manifest.json'), bytes); await syncDirectory(target);
    return { directory: target, ...manifest, manifestSha256: digest(bytes) };
  } catch (issue) { await rm(target, { recursive: true, force: true }); throw issue; }
}

export async function verifyPreparedMongoSeller(directory) {
  const root = resolve(directory), stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('MONGODB_PREPARED_DIRECTORY_INVALID');
  const bytes = await limited(resolve(root, 'manifest.json')), manifest = JSON.parse(bytes);
  const allowed = new Set(['source.json', 'service.json', 'merchant-plan.json', 'openapi.json', 'database-ca.pem',
    'client/seller-client.mjs', 'client/seller-client.d.mts', 'client/seller-openapi.json', 'client/package.json', 'client/README.md']);
  const required = [...allowed].filter(name => name !== 'database-ca.pem');
  if (manifest?.schema !== 'stellar-forge.mongodb-prepared.v1' || !manifest.files ||
      required.some(name => !Object.hasOwn(manifest.files, name)) || Object.keys(manifest.files).some(name => !allowed.has(name)))
    fail('MONGODB_PREPARED_MANIFEST_INVALID');
  const client = await lstat(resolve(root, 'client'));
  if (!client.isDirectory() || client.isSymbolicLink()) fail('MONGODB_PREPARED_CLIENT_INVALID');
  for (const [name, expected] of Object.entries(manifest.files)) {
    const data = await limited(resolve(root, name), 16777216);
    if (!Number.isSafeInteger(expected?.bytes) || expected.bytes !== data.length || digest(data) !== expected.sha256)
      fail('MONGODB_PREPARED_FILE_CHANGED:' + name, 409);
  }
  const declaration = await readMongoSourceFile(resolve(root, 'source.json'));
  const { service, bindings } = compileMongoMerchantPlan(declaration.config.queries, await readJson(resolve(root, 'merchant-plan.json')));
  if (digest(encode(service)) !== digest(await limited(resolve(root, 'service.json'), 1048576)) ||
      JSON.stringify(bindings) !== JSON.stringify(declaration.config.bindings)) fail('MONGODB_PREPARED_CONTRACT_CHANGED', 409);
  return { directory: root, ...manifest, manifestSha256: digest(bytes) };
}
