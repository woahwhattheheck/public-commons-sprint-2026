#!/usr/bin/env node
// MIT. An actual client-streaming/bidirectional endpoint for the retained merchant.
import * as grpc from '@grpc/grpc-js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { captureProtoSource, compileProtoSource } from '../proto.mjs';

export async function startRequestStreamExample({ port = 0,
  authorization = process.env.GRPC_REQUEST_STREAM_DEMO_AUTHORIZATION, observeCall } = {}) {
  if (typeof authorization !== 'string' || !authorization)
    throw new Error('Set GRPC_REQUEST_STREAM_DEMO_AUTHORIZATION in the server and merchant environments.');
  if (observeCall !== undefined && typeof observeCall !== 'function') throw new TypeError('observeCall must be a function.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local example port.');
  const protoSource = await captureProtoSource({ directory: fileURLToPath(new URL('./proto/', import.meta.url)),
    entrypoints: ['request-streams.proto'] });
  const contract = compileProtoSource(protoSource), server = new grpc.Server(), active = new Set();
  let calls = 0, receivedMessages = 0, completed = 0, cancelled = 0, closePromise;
  const error = (code, details) => Object.assign(new Error(details), { code });
  function serve(call, callback) {
    const controller = new AbortController(); let terminal = false;
    const cancel = () => { if (!terminal) { cancelled++; controller.abort(); } };
    call.once('cancelled', cancel);
    const task = (async () => {
      if (call.metadata.get('authorization')[0] !== authorization)
        throw error(grpc.status.UNAUTHENTICATED, 'Example authorization required.');
      calls++;
      if (observeCall) await observeCall({ number: calls, method: callback
        ? '/forge.requeststreams.RecordBatch/Upload' : '/forge.requeststreams.RecordBatch/Exchange' });
      const records = []; let bytes = 0, count = 0;
      for await (const record of call) {
        controller.signal.throwIfAborted();
        if (++count > 512 || (record.delay_ms ?? 0) > 1000)
          throw error(grpc.status.INVALID_ARGUMENT, 'Choose at most 512 demo records with delay_ms <= 1000.');
        receivedMessages++;
        if (record.delay_ms) await pause(record.delay_ms, undefined, { signal: controller.signal });
        if (record.reject) throw error(grpc.status.UNAVAILABLE, 'Deliberate local request-stream failure.');
        bytes += record.payload === undefined ? 0 : Buffer.from(record.payload, 'base64').length;
        if (callback) records.push(record);
        else if (!call.write(record)) await new Promise((done, reject) => {
          const finish = issue => {
            call.off('drain', drained); call.off('error', failed); controller.signal.removeEventListener('abort', stopped);
            if (issue) reject(issue); else done();
          };
          const drained = () => finish(), failed = issue => finish(issue);
          const stopped = () => finish(error(grpc.status.CANCELLED, 'Example cancelled.'));
          call.once('drain', drained); call.once('error', failed);
          controller.signal.addEventListener('abort', stopped, { once: true });
          if (controller.signal.aborted) stopped();
        });
      }
      controller.signal.throwIfAborted(); terminal = true; completed++;
      if (callback) callback(null, { messages: String(count), payload_bytes: String(bytes), records });
      else call.end();
    })().catch(issue => {
      if (!controller.signal.aborted) {
        terminal = true;
        const value = { code: typeof issue.code === 'number' ? issue.code : grpc.status.INTERNAL,
          details: issue.message };
        if (callback) callback(value); else call.emit('error', value);
      }
    }).finally(() => { call.off('cancelled', cancel); active.delete(task); });
    active.add(task);
  }
  server.addService(contract.definition['forge.requeststreams.RecordBatch'], {
    Upload: (call, callback) => serve(call, callback), Exchange: call => serve(call),
  });
  const selected = await new Promise((done, reject) =>
    server.bindAsync('127.0.0.1:' + port, grpc.ServerCredentials.createInsecure(),
      (issue, selected) => issue ? reject(issue) : done(selected)));
  return { target: '127.0.0.1:' + selected, protoSource,
    counts: () => ({ calls, receivedMessages, completed, cancelled, active: active.size }),
    close() {
      if (!closePromise) closePromise = (async () => { server.forceShutdown(); await Promise.all([...active]); })();
      return closePromise;
    } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startRequestStreamExample({ port: Number(process.env.GRPC_REQUEST_STREAM_DEMO_PORT ?? 50054) });
  console.log(JSON.stringify({ target: server.target, methods: [
    '/forge.requeststreams.RecordBatch/Upload', '/forge.requeststreams.RecordBatch/Exchange'] }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close().catch(() => { process.exitCode = 1; }));
}
