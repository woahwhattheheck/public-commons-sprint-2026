// MIT. Original host-owned gRPC channel and metadata shared by calls and reflection.
import * as grpc from '@grpc/grpc-js';
import { validateGrpcConfig, captureGrpcEnvironment } from './config.mjs';
import { fail } from './common.mjs';

function metadataFor(config, environment) {
  const metadata = new grpc.Metadata();
  for (const item of config.metadata) {
    const value = environment[item.valueEnv];
    if (item.name.endsWith('-bin')) {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
        fail('GRPC_BINARY_METADATA_BASE64_INVALID');
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length > 8192 || bytes.toString('base64') !== value) fail('GRPC_METADATA_TOO_LARGE');
      metadata.set(item.name, bytes);
    } else {
      if (!/^[\x20-\x7e]*$/.test(value) || Buffer.byteLength(value) > 8192) fail('GRPC_METADATA_VALUE_INVALID');
      metadata.set(item.name, value);
    }
  }
  return metadata;
}

/** Credentials are captured in memory from the same original source references. */
export function createGrpcConnection(configInput, { env = process.env, maxReceiveBytes } = {}) {
  const config = validateGrpcConfig(configInput), environment = captureGrpcEnvironment(config, env);
  if (maxReceiveBytes !== undefined && (!Number.isSafeInteger(maxReceiveBytes) ||
      maxReceiveBytes < 1 || maxReceiveBytes > 8388608)) fail('GRPC_CHANNEL_RECEIVE_LIMIT_INVALID');
  const transport = config.transport;
  const pem = key => transport[key] ? Buffer.from(environment[transport[key]], 'utf8') : null;
  const credentials = transport.mode === 'plaintext' ? grpc.credentials.createInsecure() :
    grpc.credentials.createSsl(pem('caEnv'), pem('privateKeyEnv'), pem('certificateEnv'));
  const options = { 'grpc.enable_retries': 0, 'grpc.max_send_message_length': config.limits.maxRequestBytes,
    'grpc.max_receive_message_length': maxReceiveBytes ?? config.limits.maxResponseBytes,
    ...(transport.serverName ? { 'grpc.ssl_target_name_override': transport.serverName,
      'grpc.default_authority': transport.serverName } : {}) };
  const metadata = metadataFor(config, environment);
  return { config, client: new grpc.Client(config.target, credentials, options), metadata };
}
