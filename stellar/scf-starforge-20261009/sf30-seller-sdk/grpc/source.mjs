// MIT. Official grpc-js calls behind the ORIGINAL SF30 admission/lifecycle.
import * as grpc from '@grpc/grpc-js';
import { createGrpcConnection } from './connection.mjs';
import { compileProtoSource } from './proto.mjs';
import { normalizeGrpcResponse, serializeGrpcRequest } from './values.mjs';
import { fail, readJson } from './common.mjs';
import { grpcServerStream } from './stream.mjs';
import { prepareGrpcInput } from './request-series.mjs';
import { writeGrpcRequestSeries } from './client-stream.mjs';

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
    if (selected.requestStream && !config.limits.requestStream) fail('GRPC_REQUEST_STREAM_LIMITS_REQUIRED');
    if (selected.responseStream && !config.limits.stream) fail('GRPC_STREAM_LIMITS_REQUIRED');
    return selected;
  }
  function request(path, input) {
    const selected = method(path);
    return { selected, ...prepareGrpcInput(contract, path, input, { limits: config.limits }) };
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
  function call(path, input, { signal, onRequestStream } = {}) {
    let prepared;
    try {
      prepared = request(path, input);
      if (prepared.selected.responseStream) fail('GRPC_UNARY_METHOD_REQUIRED');
      if (closing || signal?.aborted) throw new GrpcSourceError('GRPC_SOURCE_CLOSED', 'CANCELLED');
      if (active.size >= config.limits.maxInFlight) throw new GrpcSourceError('GRPC_SOURCE_BUSY', 'RESOURCE_EXHAUSTED', 429);
    } catch (issue) { return Promise.reject(issue); }
    if (prepared.selected.requestStream) return callRequestSeries(path, prepared, { signal, onRequestStream });
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
  function callRequestSeries(path, prepared, { signal, onRequestStream } = {}) {
    let nativeCall, writer, settle, finalized = false;
    const job = { cancel: () => writer ? writer.cancel() : nativeCall?.cancel(),
      promise: new Promise(done => { settle = done; }) };
    active.add(job);
    return new Promise((done, reject) => {
      const finish = (issue, response) => { void Promise.resolve().then(async () => {
        if (finalized) return;
        finalized = true;
        let value, problem, inputState;
        try {
          if (issue) throw callError(issue);
          await writer.finished;
          value = normalizeGrpcResponse(contract, path, response);
          if (Buffer.byteLength(JSON.stringify(value)) > config.limits.maxJsonResponseBytes)
            throw new GrpcSourceError('GRPC_JSON_RESPONSE_TOO_LARGE', 'RESOURCE_EXHAUSTED', 502);
        } catch (error) { problem = error; }
        try {
          inputState = await writer.close();
          if (onRequestStream) onRequestStream(inputState);
        } catch (error) { problem ??= error; }
        nativeCall.destroy();
        active.delete(job); settle();
        if (problem) { failures++; if (inputState) problem.requestStream = inputState; reject(problem); }
        else { completed++; done(value); }
      }); };
      try {
        nativeCall = client.makeClientStreamRequest(path, value => serializeGrpcRequest(contract, path, value),
          prepared.selected.definition.responseDeserialize, metadata.clone(),
          { deadline: Date.now() + config.limits.timeoutMs }, finish);
        writer = writeGrpcRequestSeries({ nativeCall, messages: prepared.messages, signal, mapError: callError });
      } catch (issue) {
        finalized = true;
        nativeCall?.on('error', () => {}); nativeCall?.cancel(); nativeCall?.destroy();
        active.delete(job); settle(); failures++; reject(issue);
      }
    });
  }
  function stream(path, input, { signal } = {}) {
    const prepared = request(path, input);
    if (!prepared.selected.responseStream) fail('GRPC_SERVER_STREAM_METHOD_REQUIRED');
    if (closing || signal?.aborted) throw new GrpcSourceError('GRPC_SOURCE_CLOSED', 'CANCELLED');
    if (active.size >= config.limits.maxInFlight)
      throw new GrpcSourceError('GRPC_SOURCE_BUSY', 'RESOURCE_EXHAUSTED', 429);
    let opened, nativeCall, writer, settle;
    const job = { cancel: () => opened?.close(), promise: new Promise(done => { settle = done; }) };
    active.add(job);
    try {
      nativeCall = prepared.selected.requestStream
        ? client.makeBidiStreamRequest(path, value => serializeGrpcRequest(contract, path, value),
          prepared.selected.definition.responseDeserialize, metadata.clone(),
          { deadline: Date.now() + config.limits.timeoutMs })
        : client.makeServerStreamRequest(path, value => serializeGrpcRequest(contract, path, value),
          prepared.selected.definition.responseDeserialize, prepared.value, metadata.clone(),
          { deadline: Date.now() + config.limits.timeoutMs });
      if (prepared.selected.requestStream)
        writer = writeGrpcRequestSeries({ nativeCall, messages: prepared.messages, signal, mapError: callError });
      opened = grpcServerStream({ nativeCall,
        normalize: value => normalizeGrpcResponse(contract, path, value),
        limits: config.limits, signal, mapError: callError,
        ...(writer ? { beforeComplete: () => writer.finished } : {}),
        async onClose(outcome) {
          if (writer) await writer.close();
          active.delete(job); settle(); if (outcome.complete) completed++; else failures++;
        },
      });
      return writer ? Object.freeze({ ...opened, snapshot: () => ({ ...opened.snapshot(), requestStream: writer.snapshot() }) }) : opened;
    } catch (issue) {
      // If adapter construction fails, this owner still cancels the created RPC.
      nativeCall?.on('error', () => {}); nativeCall?.cancel(); nativeCall?.destroy();
      if (writer) void writer.close().finally(() => { active.delete(job); settle(); });
      else { active.delete(job); settle(); }
      failures++; throw issue;
    }
  }
  function inspect() {
    return { schema: 'stellar-forge.grpc-inspection.v1', protoSha256: contract.source.sha256,
      transport: transport.mode, inventory: structuredClone(contract.inventory), limits: { ...config.limits } };
  }
  function route(path) {
    const selected = method(path);
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
        try {
          if (selected.responseStream) return stream(path, context.body, { signal: context.signal }).response;
          return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
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
  return Object.freeze({ call, stream, ready, route, inspect, close, contract,
    status: () => ({ state: closing ? 'CLOSED' : 'READY', active: active.size,
      maxInFlight: config.limits.maxInFlight, completed, failures }) });
}
export async function openGrpcSourceFile(sourceFile, protoFile, options) {
  const [config, protoSource] = await Promise.all([readJson(sourceFile, 65536), readJson(protoFile, 8388608)]);
  return createGrpcSource(config, protoSource, options);
}
