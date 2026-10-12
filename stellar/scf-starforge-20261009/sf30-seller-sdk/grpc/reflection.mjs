// MIT. Official native server reflection over one retained bidirectional stream.
import * as grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { createGrpcConnection } from './connection.mjs';
import { validateGrpcConfig } from './config.mjs';
import { descriptorFile, createDescriptorSource } from './descriptor.mjs';
import { canonical, sha256, fail } from './common.mjs';

export const GRPC_REFLECTION_LIMITS = Object.freeze({ services: 8192, selectedServices: 256,
  requests: 2048, files: 512, descriptorBytes: 4194304, sourceBytes: 33554432,
  responseBytes: 8388608, transferBytes: 67108864 });
const SHA = /^[0-9a-f]{64}$/;
const SERVICE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const protocolFiles = Object.freeze({
  v1: new URL('./reflection/v1/reflection.proto', import.meta.url),
  v1alpha: new URL('./reflection/v1alpha/reflection.proto', import.meta.url),
});
const definitions = new Map();
function protocolMethod(protocol) {
  if (!protocolFiles[protocol]) fail('GRPC_REFLECTION_PROTOCOL_INVALID');
  if (!definitions.has(protocol)) {
    const loaded = protoLoader.loadSync(fileURLToPath(protocolFiles[protocol]),
      { keepCase: true, longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true });
    definitions.set(protocol, loaded['grpc.reflection.' + protocol + '.ServerReflection'].ServerReflectionInfo);
  }
  return definitions.get(protocol);
}
export class GrpcReflectionError extends Error {
  constructor(code, grpcCode, status = 502) {
    super(code); this.code = code; this.grpcCode = grpcCode; this.status = status;
  }
}
function nativeError(issue) {
  if (issue instanceof GrpcReflectionError) return issue;
  const code = Number.isInteger(issue?.code) && typeof grpc.status[issue.code] === 'string' ? issue.code : grpc.status.UNKNOWN;
  const name = grpc.status[code];
  return new GrpcReflectionError('GRPC_REFLECTION_' + name, name,
    ({ CANCELLED: 499, INVALID_ARGUMENT: 422, NOT_FOUND: 404, RESOURCE_EXHAUSTED: 429,
      UNAUTHENTICATED: 401, PERMISSION_DENIED: 403, DEADLINE_EXCEEDED: 504, UNAVAILABLE: 503,
      UNIMPLEMENTED: 422 })[name] ?? 502);
}
function problem(code, status = 502) { return new GrpcReflectionError(code, 'UNKNOWN', status); }
function serviceNames(values, selected = false) {
  if (!Array.isArray(values) || selected && !values.length ||
      values.length > (selected ? GRPC_REFLECTION_LIMITS.selectedServices : GRPC_REFLECTION_LIMITS.services) ||
      values.some(value => typeof value !== 'string' || value.length > 512 || !SERVICE.test(value)) ||
      new Set(values).size !== values.length) fail('GRPC_REFLECTION_SERVICES_INVALID');
  return [...values].sort();
}
function inventoryIdentity(value) {
  return sha256(canonical({ schema: value.schema, sourceSha256: value.sourceSha256,
    protocol: value.protocol, authority: value.authority, services: value.services }));
}

async function openStream(configInput, protocol, { env, signal } = {}) {
  if (signal?.aborted) throw nativeError({ code: grpc.status.CANCELLED });
  const { config, client, metadata } = createGrpcConnection(configInput,
    { env, maxReceiveBytes: GRPC_REFLECTION_LIMITS.responseBytes });
  let stream, pending = null, terminal = null, closed = false, ended = false, requests = 0, authority;
  let doneStatus = false, finishStatus;
  const statusFinished = new Promise(done => { finishStatus = done; });
  const abort = () => {
    terminal ??= nativeError({ code: grpc.status.CANCELLED });
    const current = pending; pending = null; current?.reject(terminal);
    stream?.cancel(); client.close();
  };
  signal?.addEventListener('abort', abort, { once: true });
  function reject(issue) {
    terminal ??= issue instanceof GrpcReflectionError ? issue : nativeError(issue);
    const current = pending; pending = null; current?.reject(terminal);
  }
  try {
    await new Promise((done, rejectReady) => {
      const cancel = () => rejectReady(nativeError({ code: grpc.status.CANCELLED }));
      signal?.addEventListener('abort', cancel, { once: true });
      client.waitForReady(Date.now() + config.limits.readyTimeoutMs, issue => {
        signal?.removeEventListener('abort', cancel);
        if (issue) rejectReady(nativeError({ code: signal?.aborted ? grpc.status.CANCELLED : grpc.status.UNAVAILABLE }));
        else done();
      });
      if (signal?.aborted) cancel();
    });
    if (signal?.aborted) throw nativeError({ code: grpc.status.CANCELLED });
    const wire = protocolMethod(protocol);
    stream = client.makeBidiStreamRequest(wire.path, wire.requestSerialize, wire.responseDeserialize,
      metadata.clone(), { deadline: Date.now() + config.limits.timeoutMs });
    stream.on('error', reject);
    stream.on('status', status => {
      doneStatus = true; finishStatus();
      if (!closed) reject(status.code === grpc.status.OK ? problem('GRPC_REFLECTION_STREAM_ENDED') : nativeError(status));
    });
    stream.on('end', () => {
      ended = true;
      if (pending && doneStatus && !closed) reject(problem('GRPC_REFLECTION_ENDED_BEFORE_REPLY'));
    });
    stream.on('data', value => {
      if (closed) return;
      const current = pending;
      if (!current) { reject(problem('GRPC_REFLECTION_UNEXPECTED_REPLY')); stream.cancel(); return; }
      try {
        const original = value?.original_request;
        if (!original || !Object.hasOwn(original, current.key) || original[current.key] !== current.value ||
            (original.host ?? '') !== '') throw problem('GRPC_REFLECTION_REPLY_MISMATCH');
        const host = value.valid_host ?? '';
        if (typeof host !== 'string' || host.length > 512 || /[\x00-\x1f\x7f]/.test(host))
          throw problem('GRPC_REFLECTION_AUTHORITY_INVALID');
        if (authority !== undefined && authority !== host) throw problem('GRPC_REFLECTION_AUTHORITY_CHANGED', 409);
        authority = host;
        if (value.error_response) throw nativeError({ code: value.error_response.error_code });
        const expected = current.key === 'list_services' ? 'list_services_response' : 'file_descriptor_response';
        if (!Object.hasOwn(value, expected) || !value[expected] || typeof value[expected] !== 'object')
          throw problem('GRPC_REFLECTION_RESPONSE_INVALID');
        pending = null; current.resolve(value[expected]);
      } catch (issue) { reject(issue); stream.cancel(); }
    });
    return {
      config, protocol, get authority() { return authority ?? ''; },
      request(key, value) {
        if (closed || signal?.aborted) return Promise.reject(nativeError({ code: grpc.status.CANCELLED }));
        if (terminal) return Promise.reject(terminal);
        if (ended) return Promise.reject(problem('GRPC_REFLECTION_STREAM_ENDED'));
        if (pending) return Promise.reject(problem('GRPC_REFLECTION_REQUEST_PENDING'));
        if (++requests > GRPC_REFLECTION_LIMITS.requests) return Promise.reject(problem('GRPC_REFLECTION_REQUEST_LIMIT', 413));
        return new Promise((resolveRequest, rejectRequest) => {
          pending = { key, value, resolve: resolveRequest, reject: rejectRequest };
          try { stream.write({ [key]: value }); } catch (issue) { reject(issue); }
        });
      },
      async close() {
        if (closed) return statusFinished;
        closed = true; signal?.removeEventListener('abort', abort);
        const current = pending; pending = null;
        current?.reject(nativeError({ code: grpc.status.CANCELLED }));
        stream.cancel(); client.close();
        if (!doneStatus) await statusFinished;
      },
    };
  } catch (issue) {
    closed = true; signal?.removeEventListener('abort', abort);
    stream?.cancel(); client.close();
    throw issue instanceof GrpcReflectionError ? issue : nativeError(issue);
  }
}

async function selectedStream(source, options) {
  const protocol = options.protocol ?? 'auto';
  if (!['auto', 'v1', 'v1alpha'].includes(protocol)) fail('GRPC_REFLECTION_PROTOCOL_INVALID');
  const config = validateGrpcConfig(source);
  for (const selected of protocol === 'auto' ? ['v1', 'v1alpha'] : [protocol]) {
    let session;
    try {
      session = await openStream(config, selected, options);
      const response = await session.request('list_services', '');
      const services = serviceNames((response.service ?? []).map(item => item?.name));
      const inventory = { schema: 'stellar-forge.grpc-reflection-inventory.v1',
        source: session.config, sourceSha256: sha256(canonical(session.config)), protocol: selected,
        authority: session.authority, services };
      inventory.sha256 = inventoryIdentity(inventory);
      return { session, inventory };
    } catch (issue) {
      await session?.close();
      if (protocol === 'auto' && selected === 'v1' && issue.grpcCode === 'UNIMPLEMENTED') continue;
      throw issue;
    }
  }
  throw problem('GRPC_REFLECTION_UNIMPLEMENTED', 422);
}

/** Inventory is a native reflection read; it does not call an application method. */
export async function inspectGrpcReflection(source, options = {}) {
  const { session, inventory } = await selectedStream(source, options);
  try { return inventory; } finally { await session.close(); }
}

/** Acquire one service selection and every imported descriptor in that same stream. */
export async function captureGrpcReflection(source, options = {}) {
  const services = serviceNames(options.services, true);
  if (typeof options.expectedInventorySha256 !== 'string' || !SHA.test(options.expectedInventorySha256))
    fail('GRPC_REFLECTION_REVIEWED_INVENTORY_REQUIRED');
  const { session, inventory } = await selectedStream(source, options);
  try {
    if (inventory.sha256 !== options.expectedInventorySha256)
      throw problem('GRPC_REFLECTION_INVENTORY_CHANGED', 409);
    if (services.some(name => !inventory.services.includes(name))) fail('GRPC_REFLECTION_SERVICE_NOT_LISTED');
    const files = new Map();
    let sourceBytes = 0, transferBytes = 0, descriptorRequests = 0;
    async function receive(key, value) {
      descriptorRequests++;
      const response = await session.request(key, value);
      const bytes = response.file_descriptor_proto ?? [];
      if (!Array.isArray(bytes) || bytes.length > GRPC_REFLECTION_LIMITS.files)
        throw problem('GRPC_REFLECTION_DESCRIPTOR_INVENTORY_INVALID');
      for (const raw of bytes) {
        if (!(raw instanceof Uint8Array) || !raw.length || raw.length > GRPC_REFLECTION_LIMITS.descriptorBytes)
          throw problem('GRPC_REFLECTION_DESCRIPTOR_SIZE_INVALID', 413);
        transferBytes += raw.length;
        if (transferBytes > GRPC_REFLECTION_LIMITS.transferBytes) throw problem('GRPC_REFLECTION_TRANSFER_LIMIT', 413);
        const file = descriptorFile(raw), existing = files.get(file.path);
        if (existing) {
          if (existing.sha256 !== file.sha256 || existing.descriptorBase64 !== file.descriptorBase64)
            throw problem('GRPC_REFLECTION_DESCRIPTOR_CHANGED', 409);
        } else {
          files.set(file.path, file); sourceBytes += file.bytes;
          if (files.size > GRPC_REFLECTION_LIMITS.files || sourceBytes > GRPC_REFLECTION_LIMITS.sourceBytes)
            throw problem('GRPC_REFLECTION_SOURCE_LIMIT', 413);
        }
      }
    }
    const entries = new Set();
    for (const service of services) {
      await receive('file_containing_symbol', service);
      const found = [...files.values()].filter(file => file.services.includes(service));
      if (found.length !== 1) throw problem('GRPC_REFLECTION_SERVICE_DESCRIPTOR_MISSING');
      entries.add(found[0].path);
    }
    const closure = new Set(), queue = [...entries];
    for (let at = 0; at < queue.length; at++) {
      const name = queue[at];
      if (closure.has(name)) continue;
      if (!files.has(name)) await receive('file_by_filename', name);
      const file = files.get(name);
      if (!file) throw problem('GRPC_REFLECTION_IMPORT_MISSING');
      closure.add(name);
      for (const dependency of file.dependencies) if (!closure.has(dependency) && !queue.includes(dependency)) queue.push(dependency);
    }
    const protoSource = createDescriptorSource({ files: [...closure].map(name => files.get(name)),
      entrypoints: [...entries], services, reflection: { protocol: inventory.protocol,
        target: inventory.source.target, authority: inventory.authority, inventorySha256: inventory.sha256 } });
    return { inventory, protoSource, transferBytes, descriptorRequests };
  } finally { await session.close(); }
}
