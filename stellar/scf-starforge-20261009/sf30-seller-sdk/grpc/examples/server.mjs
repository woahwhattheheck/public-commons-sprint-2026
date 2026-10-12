#!/usr/bin/env node
// MIT. Real local gRPC example with explicit demonstration rows; no external data.
import grpc from '@grpc/grpc-js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureProtoSource, compileProtoSource } from '../proto.mjs';
export async function startExample({ port = 50051, authorization = process.env.GRPC_DEMO_AUTHORIZATION } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('GRPC_EXAMPLE_PORT_INVALID');
  if (!authorization) throw new TypeError('Set GRPC_DEMO_AUTHORIZATION for both the example server and merchant.');
  const source = await captureProtoSource({ directory: fileURLToPath(new URL('./proto/', import.meta.url)), entrypoints: ['analytics.proto'] });
  const contract = compileProtoSource(source);
  const server = new grpc.Server({ 'grpc.max_receive_message_length': 1048576, 'grpc.max_send_message_length': 1048576 });
  const service = grpc.loadPackageDefinition(contract.definition).stellarforge.analytics.v1.Analytics.service;
  const calls = [];
  const rows = Object.freeze([
    { id: '18446744073709551615', amount: '123456789012345678901234567890.1234567', state: 'posted' },
    { id: '9007199254740993', amount: '42.0000001', state: 'posted' },
    { id: '3', amount: '0.1000000', state: 'voided' },
  ]);
  const response = call => ({
    record_id: String(call.request.account_id ?? '0'), amount: rows[0].amount,
    evidence: Buffer.from('original-native-grpc-example', 'utf8').toString('base64'),
    observed_sequence: '-9223372036854775808',
    attributes: { source: 'included-demonstration-rows', day: call.request.day ?? '' },
    items: rows.filter(row => call.request.include_voided || row.state !== 'voided'),
  });
  server.addService(service, {
    summary(call, done) {
      if (call.metadata.get('authorization')[0] !== authorization) return done({ code: grpc.status.UNAUTHENTICATED, details: 'Example authorization mismatch.' });
      calls.push({ method: 'Summary', at: new Date().toISOString(), input: structuredClone(call.request) });
      done(null, response(call));
    },
    watch(call) {
      if (call.metadata.get('authorization')[0] !== authorization) return call.destroy(Object.assign(new Error('Example authorization mismatch.'), { code: grpc.status.UNAUTHENTICATED }));
      call.write(response(call)); call.end();
    },
  });
  const selected = await new Promise((done, reject) => server.bindAsync('127.0.0.1:' + port,
    grpc.ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : done(port)));
  let closed;
  return { target: '127.0.0.1:' + selected, calls, source,
    close() { return closed ??= new Promise(done => server.tryShutdown(done)); } };
}
async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('GRPC_DEMO_AUTHORIZATION=YOUR_LOCAL_VALUE node grpc/examples/server.mjs [--port 50051]'); return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^(0|[1-9][0-9]*)$/.test(args[1]))) throw new TypeError('GRPC_EXAMPLE_ARGUMENTS_INVALID');
  const session = await startExample({ port: args.length ? Number(args[1]) : 50051 });
  console.log(JSON.stringify({ target: session.target, source: 'included demonstration rows', authorizationEnv: 'GRPC_DEMO_AUTHORIZATION' }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => session.close().catch(() => { process.exitCode = 1; }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
