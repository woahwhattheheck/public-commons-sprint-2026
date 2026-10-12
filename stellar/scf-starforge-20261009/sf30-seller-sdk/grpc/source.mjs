// MIT. Official grpc-js unary calls behind the ORIGINAL SF30 admission/lifecycle.
import * as grpc from '@grpc/grpc-js';
import { createGrpcConnection } from './connection.mjs';
import { compileProtoSource } from './proto.mjs';
import { normalizeGrpcRequest, normalizeGrpcResponse, serializeGrpcRequest } from './values.mjs';
import { fail, readJson } from './common.mjs';

export class GrpcSourceError extends Error {
  constructor(code, grpcCode, status = 503) {
    super(code); this.code = code; this.grpcCode = grpcCode; this.status = status;
  }
}
const statusName = code => typeof code === 'number' && typeof grpc.status[code] === 'string' ? grpc.status[code] : 'UNKNOWN';
function callError(issue) {
  const name = statusName(issue?.code);
  const status = ({ INVALID_ARGUMENT: 422, NOT_FOUND: 404, ALREADY_EXISTS: 409, RESOURCE_EXHAUSTED: 429,
    DEADLINE_EXCEEDED: 504, UNAVAILABLE: 503, FAILED_PRECONDITION: 409, ABORTED: 409, OUT_OF_RANGE: 422 })[name] ?? 502;
  return new GrpcSourceError('GRPC_UPSTREAM_' + name, name, status);
}
export async function createGrpcSource(configInput, protoSource, { env = process.env, contract: existingContract } = {}) {
  const contract = existingContract ?? compileProtoSource(protoSource);
  const { config, client, metadata } = createGrpcConnection(configInput, { env });
  const transport = config.transport;
  let closing = false, closePromise, completed = 0, failures = 0;
  const active = new Set();
  function method(path) {
    const selected = contract.methods[path];
    if (!selected) fail('GRPC_METHOD_NOT_FOUND');
    if (selected.requestStream || selected.responseStream) fail('GRPC_UNARY_METHOD_REQUIRED');
    return selected;
  }
  function request(path, input) {
    const selected = method(path);
    const value = normalizeGrpcRequest(contract, path, input);
    if (Buffer.byteLength(JSON.stringify(value)) > config.limits.maxJsonRequestBytes) fail('GRPC_JSON_REQUEST_TOO_LARGE', 413);
    const bytes = serializeGrpcRequest(contract, path, value);
    if (bytes.length > config.limits.maxRequestBytes) fail('GRPC_REQUEST_TOO_LARGE', 413);
    return { selected, value };
  }
  async function ready({ signal } = {}) {
    if (closing || signal?.aborted) throw new GrpcSourceError('GRPC_SOURCE_CLOSED', 'CANCELLED');
    await new Promise((done, reject) => {
      const abort = () => reject(new GrpcSourceError('GRPC_READY_CANCELLED', 'CANCELLED'));
      signal?.addEventListener('abort', abort, { once: true });
      client.waitForReady(Date.now() + config.limits.readyTimeoutMs, issue => {
        signal?.removeEventListener('abort', abort);
        if (issue) reject(callError(issue)); else done();
      });
      if (signal?.aborted) abort();
    });
    return inspect();
  }
  function call(path, input, { signal } = {}) {
    let prepared;
    try {
      prepared = request(path, input);
      if (closing || signal?.aborted) throw new GrpcSourceError('GRPC_SOURCE_CLOSED', 'CANCELLED');
      if (active.size >= config.limits.maxInFlight) throw new GrpcSourceError('GRPC_SOURCE_BUSY', 'RESOURCE_EXHAUSTED', 429);
    } catch (issue) { return Promise.reject(issue); }
    let nativeCall, settle;
    const job = { cancel: () => nativeCall?.cancel(), promise: new Promise(done => { settle = done; }) };
    active.add(job);
    return new Promise((done, reject) => {
      const abort = () => nativeCall?.cancel();
      const finish = (issue, response) => {
        signal?.removeEventListener('abort', abort);
        active.delete(job); settle();
        if (issue) { failures++; reject(callError(issue)); return; }
        try {
          const value = normalizeGrpcResponse(contract, path, response);
          if (Buffer.byteLength(JSON.stringify(value)) > config.limits.maxJsonResponseBytes)
            throw new GrpcSourceError('GRPC_JSON_RESPONSE_TOO_LARGE', 'RESOURCE_EXHAUSTED', 502);
          completed++; done(value);
        } catch (error) { failures++; reject(error); }
      };
      try {
        nativeCall = client.makeUnaryRequest(path, value => serializeGrpcRequest(contract, path, value),
          prepared.selected.definition.responseDeserialize, prepared.value, metadata.clone(),
          { deadline: Date.now() + config.limits.timeoutMs }, finish);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      } catch (issue) {
        active.delete(job); settle(); failures++; reject(issue);
      }
    });
  }
  function inspect() {
    return { schema: 'stellar-forge.grpc-inspection.v1', protoSha256: contract.source.sha256,
      transport: transport.mode, inventory: structuredClone(contract.inventory), limits: { ...config.limits } };
  }
  function route(path) {
    method(path);
    return Object.freeze({
      admit(context) {
        try {
          if (!['POST', 'PUT', 'PATCH'].includes(context?.method)) fail('GRPC_JSON_BODY_METHOD_REQUIRED');
          request(path, context.body);
          if (closing) return { status: 503, body: { error: 'GRPC_SOURCE_CLOSED' } };
          if (active.size >= config.limits.maxInFlight) return { status: 429,
            headers: { 'retry-after': '1' }, body: { error: 'GRPC_SOURCE_BUSY' } };
          return true;
        } catch (issue) {
          return { status: issue.status ?? 422, body: { error: 'GRPC_INPUT_INVALID',
            ...(typeof issue.field_path === 'string' ? { field: issue.field_path } : {}) } };
        }
      },
      async handler(context) {
        try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
          body: await call(path, context.body, { signal: context.signal }) }; }
        catch (issue) { return { status: issue.status ?? 502, body: {
          error: issue instanceof GrpcSourceError ? issue.code : 'GRPC_RESPONSE_UNAVAILABLE',
          ...(issue.grpcCode ? { grpcCode: issue.grpcCode } : {}) } }; }
      },
    });
  }
  function close() {
    if (!closePromise) {
      closing = true;
      const jobs = [...active];
      for (const job of jobs) job.cancel();
      client.close();
      // Capacity and close remain attached to each native callback, including
      // cancellation. Merely abandoning the HTTP response is not completion.
      closePromise = Promise.all(jobs.map(job => job.promise)).then(() => {});
    }
    return closePromise;
  }
  return Object.freeze({ call, ready, route, inspect, close, contract,
    status: () => ({ state: closing ? 'CLOSED' : 'READY', active: active.size,
      maxInFlight: config.limits.maxInFlight, completed, failures }) });
}
export async function openGrpcSourceFile(sourceFile, protoFile, options) {
  const [config, protoSource] = await Promise.all([readJson(sourceFile, 65536), readJson(protoFile, 8388608)]);
  return createGrpcSource(config, protoSource, options);
}
