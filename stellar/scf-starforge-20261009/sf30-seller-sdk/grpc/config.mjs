// MIT. Host-owned gRPC connection settings. No buyer header forwarding.
import { fields, text, integer, readJson, fail } from './common.mjs';

const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const DEFAULTS = Object.freeze({ timeoutMs: 30000, readyTimeoutMs: 10000, maxInFlight: 64,
  maxRequestBytes: 1048576, maxResponseBytes: 1048576, maxJsonRequestBytes: 2097152, maxJsonResponseBytes: 2097152 });
export function validateGrpcConfig(value) {
  fields(value, ['schema', 'target', 'transport', 'metadata', 'limits'], 'GRPC_SOURCE_FIELDS_INVALID');
  if (value.schema !== 'stellar-forge.grpc-source.v1') fail('GRPC_SOURCE_SCHEMA_INVALID');
  text(value.target, 'GRPC_TARGET_REQUIRED', 512);
  // An explicit host:port is one reviewed upstream. Resolver URLs, credentials,
  // paths and dynamically supplied buyer targets are not connection settings.
  const endpoint = /^\[([0-9a-fA-F:]+)\]:([0-9]+)$/.exec(value.target) ??
    /^([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):([0-9]+)$/.exec(value.target);
  if (!endpoint || Number(endpoint[2]) < 1 || Number(endpoint[2]) > 65535 ||
      !/^[1-9][0-9]*$/.test(endpoint[2])) fail('GRPC_TARGET_HOST_PORT_REQUIRED');
  fields(value.transport, ['mode', 'caEnv', 'certificateEnv', 'privateKeyEnv', 'serverName'], 'GRPC_TRANSPORT_INVALID');
  if (!['tls', 'plaintext'].includes(value.transport.mode)) fail('GRPC_TRANSPORT_MODE_REQUIRED');
  for (const key of ['caEnv', 'certificateEnv', 'privateKeyEnv']) {
    if (value.transport[key] !== undefined && !ENV.test(value.transport[key])) fail('GRPC_TLS_ENV_NAME_INVALID');
  }
  if (Boolean(value.transport.certificateEnv) !== Boolean(value.transport.privateKeyEnv)) fail('GRPC_MTLS_PAIR_REQUIRED');
  if (value.transport.mode === 'plaintext' && Object.keys(value.transport).some(key => key !== 'mode'))
    fail('GRPC_PLAINTEXT_TLS_FIELDS_INVALID');
  if (value.transport.serverName !== undefined &&
      !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(value.transport.serverName)) fail('GRPC_TLS_SERVER_NAME_INVALID');
  const metadata = value.metadata ?? [];
  if (!Array.isArray(metadata) || metadata.length > 32) fail('GRPC_METADATA_INVALID');
  const names = new Set();
  for (const item of metadata) {
    fields(item, ['name', 'valueEnv'], 'GRPC_METADATA_FIELDS_INVALID');
    if (typeof item.name !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(item.name) ||
        item.name.startsWith('grpc-') || ['content-type', 'te', 'host'].includes(item.name) ||
        names.has(item.name) || !ENV.test(item.valueEnv)) fail('GRPC_METADATA_NAME_INVALID');
    names.add(item.name);
  }
  const normalized = validateGrpcLimits(value.limits ?? {});
  return { schema: value.schema, target: value.target, transport: structuredClone(value.transport),
    metadata: structuredClone(metadata), limits: normalized };
}
export function validateGrpcLimits(limits = {}) {
  fields(limits, Object.keys(DEFAULTS), 'GRPC_LIMIT_FIELDS_INVALID');
  return {
    timeoutMs: integer(limits.timeoutMs, 'GRPC_TIMEOUT_INVALID', DEFAULTS.timeoutMs, 1, 300000),
    readyTimeoutMs: integer(limits.readyTimeoutMs, 'GRPC_READY_TIMEOUT_INVALID', DEFAULTS.readyTimeoutMs, 1, 60000),
    maxInFlight: integer(limits.maxInFlight, 'GRPC_CAPACITY_INVALID', DEFAULTS.maxInFlight, 1, 1024),
    maxRequestBytes: integer(limits.maxRequestBytes, 'GRPC_REQUEST_LIMIT_INVALID', DEFAULTS.maxRequestBytes, 1, 8388608),
    maxResponseBytes: integer(limits.maxResponseBytes, 'GRPC_RESPONSE_LIMIT_INVALID', DEFAULTS.maxResponseBytes, 1, 8388608),
    maxJsonRequestBytes: integer(limits.maxJsonRequestBytes, 'GRPC_JSON_REQUEST_LIMIT_INVALID', DEFAULTS.maxJsonRequestBytes, 1, 16777216),
    maxJsonResponseBytes: integer(limits.maxJsonResponseBytes, 'GRPC_JSON_LIMIT_INVALID', DEFAULTS.maxJsonResponseBytes, 1, 16777216),
  };
}
export async function readGrpcSourceFile(path) {
  return { config: validateGrpcConfig(await readJson(path, 65536)) };
}
export function grpcEnvironmentNames(config) {
  const value = validateGrpcConfig(config);
  return [...new Set([value.transport.caEnv, value.transport.certificateEnv, value.transport.privateKeyEnv,
    ...value.metadata.map(item => item.valueEnv)].filter(Boolean))].sort();
}
export function captureGrpcEnvironment(config, env = process.env) {
  const names = grpcEnvironmentNames(config), captured = Object.create(null);
  for (const name of names) {
    if (typeof env[name] !== 'string' || !env[name].length || Buffer.byteLength(env[name]) > 1048576)
      fail('GRPC_ENVIRONMENT_VALUE_MISSING_OR_TOO_LARGE');
    captured[name] = env[name];
  }
  return captured;
}
