#!/usr/bin/env node
// MIT. Real grpc-js server-stream fixture for the original retained merchant.
import * as grpc from '@grpc/grpc-js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { captureProtoSource, compileProtoSource } from '../proto.mjs';

export async function startStreamExample({ port = 0,
  authorization = process.env.GRPC_STREAM_DEMO_AUTHORIZATION } = {}) {
  if (typeof authorization !== 'string' || !authorization)
    throw new Error('Set GRPC_STREAM_DEMO_AUTHORIZATION in the server and merchant environments.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local example port.');
  const captured = await captureProtoSource({ directory: fileURLToPath(new URL('./proto/', import.meta.url)),
    entrypoints: ['streams.proto'] });
  const contract = compileProtoSource(captured);
  const server = new grpc.Server(), active = new Set();
  let calls = 0, cancellations = 0, closePromise;
  server.addService(contract.definition['forge.streams.AccountEvents'], {
    Watch(call) {
      const controller = new AbortController();
      const cancel = () => { cancellations++; controller.abort(); };
      call.once('cancelled', cancel);
      const task = (async () => {
        if (call.metadata.get('authorization')[0] !== authorization)
          throw Object.assign(new Error('Example authorization required'), { code: grpc.status.UNAUTHENTICATED });
        calls++;
        const request = call.request;
        if (!request.account_id || request.count > 512 || request.delay_ms > 1000 || request.fail_after > 512)
          throw Object.assign(new Error('Choose account_id, count <= 512 and delay_ms <= 1000'), { code: grpc.status.INVALID_ARGUMENT });
        for (let index = 0; index < (request.count ?? 0); index++) {
          controller.signal.throwIfAborted();
          if (request.delay_ms) await pause(request.delay_ms, undefined, { signal: controller.signal });
          if (request.fail_after && index === request.fail_after)
            throw Object.assign(new Error('Deliberate local incomplete stream'), { code: grpc.status.UNAVAILABLE });
          const event = { sequence: String(18446744073709551000n + BigInt(index)),
            account_id: request.account_id, payload: Buffer.from('event-' + index),
            ...(index % 2 === 0 ? { note: index === 0 ? '' : 'even record' } : {}) };
          if (!call.write(event)) await new Promise((done, reject) => {
            const finish = issue => {
              call.off('drain', drained); call.off('error', failed);
              controller.signal.removeEventListener('abort', stopped);
              if (issue) reject(issue); else done();
            };
            const drained = () => finish(), failed = issue => finish(issue);
            const stopped = () => finish(Object.assign(new Error('Example stream cancelled'), { code: grpc.status.CANCELLED }));
            call.once('drain', drained); call.once('error', failed);
            controller.signal.addEventListener('abort', stopped, { once: true });
            if (controller.signal.aborted) stopped();
          });
        }
        if (request.keep_open) await pause(300000, undefined, { signal: controller.signal });
        controller.signal.throwIfAborted(); call.end();
      })().catch(issue => {
        if (!controller.signal.aborted) call.emit('error', {
          code: typeof issue.code === 'number' ? issue.code : grpc.status.INTERNAL,
          details: issue.message,
        });
      }).finally(() => { call.off('cancelled', cancel); active.delete(task); });
      active.add(task);
    },
  });
  const bound = await new Promise((done, reject) =>
    server.bindAsync('127.0.0.1:' + port, grpc.ServerCredentials.createInsecure(), (issue, selected) =>
      issue ? reject(issue) : done(selected)));
  return { target: '127.0.0.1:' + bound, protoSource: captured,
    counts: () => ({ calls, cancellations, active: active.size }),
    close() {
      if (!closePromise) closePromise = (async () => {
        server.forceShutdown();
        await Promise.all([...active]);
      })();
      return closePromise;
    } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.env.GRPC_STREAM_DEMO_PORT === undefined ? 50053 : Number(process.env.GRPC_STREAM_DEMO_PORT);
  const server = await startStreamExample({ port });
  console.log(JSON.stringify({ target: server.target, method: '/forge.streams.AccountEvents/Watch' }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close().catch(() => { process.exitCode = 1; }));
}
