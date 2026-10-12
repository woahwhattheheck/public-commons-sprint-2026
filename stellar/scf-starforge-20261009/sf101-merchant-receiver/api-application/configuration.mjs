// MIT. Purchased application access composes the original API gateway and job compiler.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, writeFile, chmod } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readJobMerchant, compileJobMerchant, canonical, digest, jobError } from '../../sf30-seller-sdk/jobs/config.mjs';

export const PROFILE_SCHEMA = 'stellar-forge.sf101.api-application.v1';
export const GATEWAY_SCHEMA = 'stellar-forge.sf101.api-gateway.v1';
export const MAX_RESULT = 4 * 1024 * 1024;
export const KEY_HEADER = 'X-SF101-Application-Key';
export const KEY_ENV = 'SF101_APPLICATION_KEY';
export const OPERATION = /^sf101-[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fail = (code, status = 400) => { throw jobError(code, status); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const jsonBytes = value => Buffer.from(canonical(value) + '\n');
export async function readPrivateFile(path, max = 1048576) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > max) fail('APP_FILE_REQUIRED');
    const data = await handle.readFile();
    if (data.length > max) fail('APP_FILE_TOO_LARGE');
    return data;
  } finally { await handle.close(); }
}
function routesFor(source, gateway, pairs, origin) {
  if (!object(gateway) || gateway.schema !== GATEWAY_SCHEMA || !Array.isArray(gateway.routes) ||
      !isAbsolute(gateway.state || '') || !Array.isArray(pairs) || !pairs.length || pairs.length > 64)
    fail('APP_GATEWAY_CONFIG_REQUIRED');
  const ids = new Set(), functions = new Set(), result = [];
  for (const pair of pairs) {
    if (!object(pair) || !ID.test(pair.id || '') || typeof pair.functionId !== 'string' || ids.has(pair.id))
      fail('APP_ROUTE_MAPPING_REQUIRED');
    const original = gateway.routes.find(route => route.id === pair.id);
    const definition = source.compiled.functions[pair.functionId];
    if (!original || !definition || original.method !== 'POST' || original.path !== definition.path ||
        definition.path.startsWith('/_sf101-application'))
      fail('APP_ROUTE_MUST_MATCH_ORIGINAL_FUNCTION');
    if (functions.has(pair.functionId)) fail('APP_FUNCTION_MAPPING_DUPLICATE');
    if (definition.maxOutputBytes > MAX_RESULT) fail('APP_FUNCTION_OUTPUT_EXCEEDS_PASS_LIMIT');
    if (!Number.isSafeInteger(original.timeoutSeconds) || original.timeoutSeconds < 1 || original.timeoutSeconds > 120)
      fail('APP_GATEWAY_TIMEOUT_REQUIRED');
    const requestLimit = original.maxRequestBytes ?? 1048576;
    const responseLimit = original.maxResponseBytes ?? MAX_RESULT;
    if (!Number.isSafeInteger(requestLimit) || requestLimit < 1 || requestLimit > 1048576 ||
        !Number.isSafeInteger(responseLimit) || responseLimit < 1 || responseLimit > MAX_RESULT)
      fail('APP_GATEWAY_LIMIT_REQUIRED');
    if (definition.maxOutputBytes > responseLimit) fail('APP_FUNCTION_OUTPUT_EXCEEDS_ROUTE_LIMIT');
    ids.add(pair.id); functions.add(pair.functionId);
    result.push({ id: pair.id, functionId: pair.functionId, path: definition.path, origin,
      timeoutSeconds: original.timeoutSeconds, maxInputBytes: Math.min(requestLimit, definition.maxInputBytes),
      maxOutputBytes: definition.maxOutputBytes });
  }
  return result;
}
export async function configureApplication({ merchant, gateway: gatewayPath, directory, port, mappings, bindRoutes = false }) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail('APP_PRIVATE_PORT_REQUIRED');
  merchant = resolve(merchant); gatewayPath = resolve(gatewayPath); directory = resolve(directory);
  let source = await readJobMerchant(merchant);
  const originalSource = source.identity;
  let derivedBytes = null;
  const gateway = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPrivateFile(gatewayPath)));
  if (bindRoutes) {
    if (!Array.isArray(mappings) || !mappings.length || mappings.length > 64 || !Array.isArray(gateway.routes))
      fail('APP_ROUTE_MAPPING_REQUIRED');
    const raw = structuredClone(source.raw);
    raw.application = source.identity.application;
    for (const pair of mappings) {
      const route = gateway.routes.find(item => item.id === pair.id);
      const definition = source.compiled.functions[pair.functionId];
      if (!route || route.method !== 'POST' || !definition) fail('APP_ROUTE_MAPPING_REQUIRED');
      raw.functions[pair.functionId].path = route.path;
      raw.functions[pair.functionId].maxOutputBytes = Math.min(definition.maxOutputBytes,
        route.maxResponseBytes ?? MAX_RESULT, MAX_RESULT);
    }
    derivedBytes = jsonBytes(raw);
    merchant = join(directory, 'merchant.json');
    const compiled = compileJobMerchant(raw, { baseDir: directory });
    source = { ...source, configPath: merchant, raw, compiled, configSource: derivedBytes.toString('utf8'),
      identity: { ...source.identity, configSha256: digest(derivedBytes) } };
  }
  const origin = 'http://127.0.0.1:' + port;
  const routes = routesFor(source, gateway, mappings, origin);
  const selected = new Map(routes.map(route => [route.id, route]));
  const nextGateway = { ...gateway, routes: gateway.routes.map(route => {
    const selectedRoute = selected.get(route.id);
    return selectedRoute ? { ...route, upstream: origin, query: [], headerEnv: { [KEY_HEADER]: KEY_ENV },
      maxRequestBytes: selectedRoute.maxInputBytes, maxResponseBytes: selectedRoute.maxOutputBytes } : route;
  }) };
  const profilePath = join(directory, 'application.json'), nextGatewayPath = join(directory, 'gateway.json');
  const keyPath = join(directory, 'application.key'), storePath = join(directory, 'executions');
  const gatewayBytes = jsonBytes(nextGateway);
  const capability = randomBytes(32).toString('hex');
  const profile = { schema: PROFILE_SCHEMA, merchant, gateway: nextGatewayPath,
    gatewaySha256: digest(gatewayBytes), capabilitySha256: digest(capability), source: source.identity, store: storePath, key: keyPath,
    origin, port, originalSource, routes: mappings.map(value => ({ id: value.id, functionId: value.functionId })) };
  // A new directory is an explicit reviewed version; existing service files are never overwritten.
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  if (await realpath(directory) !== directory) fail('APP_CANONICAL_PRIVATE_DIRECTORY_REQUIRED');
  if (derivedBytes) await writeFile(merchant, derivedBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(keyPath, capability + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(nextGatewayPath, gatewayBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(profilePath, jsonBytes(profile), { flag: 'wx', mode: 0o600 });
  return { schema: PROFILE_SCHEMA, profile: profilePath, gateway: nextGatewayPath, store: storePath,
    merchantState: gateway.state, origin, routes, source: source.identity };
}
export async function readApplication(profilePath) {
  profilePath = resolve(profilePath);
  const profileBytes = await readPrivateFile(profilePath);
  const profile = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(profileBytes));
  if (!object(profile) || profile.schema !== PROFILE_SCHEMA ||
      !['merchant', 'gateway', 'store', 'key'].every(key => typeof profile[key] === 'string' && isAbsolute(profile[key])) ||
      !Number.isSafeInteger(profile.port) || profile.port < 1 || profile.port > 65535 ||
      profile.origin !== 'http://127.0.0.1:' + profile.port) fail('APP_PROFILE_REQUIRED');
  const source = await readJobMerchant(profile.merchant);
  if (canonical(source.identity) !== canonical(profile.source)) fail('APP_ORIGINAL_SOURCE_CHANGED', 409);
  const gatewayBytes = await readPrivateFile(profile.gateway);
  if (digest(gatewayBytes) !== profile.gatewaySha256) fail('APP_GATEWAY_SOURCE_CHANGED', 409);
  const gateway = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(gatewayBytes));
  const routes = routesFor(source, gateway, profile.routes, profile.origin);
  for (const route of routes) {
    const actual = gateway.routes.find(value => value.id === route.id);
    if (actual.upstream !== profile.origin || canonical(actual.query || []) !== '[]' ||
        canonical(actual.headerEnv || {}) !== canonical({ [KEY_HEADER]: KEY_ENV }) ||
        actual.maxRequestBytes !== route.maxInputBytes || actual.maxResponseBytes !== route.maxOutputBytes)
      fail('APP_GATEWAY_ROUTE_CHANGED', 409);
  }
  const keyInfo = await lstat(profile.key);
  if (keyInfo.mode & 0o077) fail('APP_CAPABILITY_FILE_MUST_BE_PRIVATE', 403);
  const capability = (await readPrivateFile(profile.key, 256)).toString('ascii').trim();
  if (!/^[a-f0-9]{64}$/.test(capability) || digest(capability) !== profile.capabilitySha256)
    fail('APP_CAPABILITY_FILE_INVALID');
  const upstreamHeadersSha256 = digest(canonical({ [KEY_HEADER]: capability }));
  return { profilePath, profileSha256: digest(profileBytes), profile, source, gateway, routes, capability, upstreamHeadersSha256 };
}
export function requestIdentity(runtime, route, body, contentType, accept) {
  return { route: route.id, method: 'POST', path: route.path, origin: runtime.profile.origin,
    query: [], contentType, accept, bodySha256: digest(body), upstreamHeadersSha256: runtime.upstreamHeadersSha256 };
}
