#!/usr/bin/env node
// MIT. Capture, inspect and prepare original native gRPC merchant contracts.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureProtoSource, compileProtoSource } from './proto.mjs';
import { inspectGrpcReflection, captureGrpcReflection } from './reflection.mjs';
import { grpcMethodSchema } from './values.mjs';
import { prepareGrpcSeller, readGrpcPrepared } from './prepare.mjs';
import { readJson, jsonBytes, assertProtoArchiveFits } from './common.mjs';
import { atomicJson } from '../../sf46-release/release-core.mjs';
const help = [
  'node grpc/cli.mjs capture --directory PRIVATE_PROTO_DIRECTORY --entry service.proto [--entry other.proto] --out NEW_PROTO_SOURCE_JSON',
  'node grpc/cli.mjs reflect --source PRIVATE_SOURCE_JSON [--protocol auto|v1|v1alpha]',
  'node grpc/cli.mjs reflect-capture --source PRIVATE_SOURCE_JSON --service package.Service [--service other.Service] --expected-inventory-sha SHA256 [--protocol auto|v1|v1alpha] --out NEW_PROTO_SOURCE_JSON',
  'node grpc/cli.mjs inspect --proto PRIVATE_PROTO_SOURCE_JSON [--method /package.Service/Method]',
  'node grpc/cli.mjs prepare --source PRIVATE_SOURCE_JSON --proto PRIVATE_PROTO_SOURCE_JSON --plan PRIVATE_PLAN_JSON --out NEW_PRIVATE_DIRECTORY',
  'node grpc/cli.mjs verify --directory PRIVATE_PREPARED_DIRECTORY',
].join('\n');
export async function main(args = process.argv.slice(2), { stdout = process.stdout } = {}) {
  if (!args.length || args[0] === '--help') { stdout.write(help + '\n'); return; }
  const [action, ...rest] = args, flags = new Map(), entries = [], services = [];
  const allowed = {
    capture: ['--directory', '--entry', '--out'], inspect: ['--proto', '--method'],
    reflect: ['--source', '--protocol'],
    'reflect-capture': ['--source', '--service', '--expected-inventory-sha', '--protocol', '--out'],
    prepare: ['--source', '--proto', '--plan', '--out'], verify: ['--directory'],
  };
  if (!allowed[action]) throw new TypeError(help);
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!allowed[action].includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new TypeError(help);
    const value = rest[++i];
    if (key === '--entry') entries.push(value);
    else if (key === '--service') services.push(value);
    else { if (flags.has(key)) throw new TypeError('GRPC_DUPLICATE_OPTION'); flags.set(key, value); }
  }
  const need = key => { if (!flags.has(key)) throw new TypeError(help); return resolve(flags.get(key)); };
  let result;
  if (action === 'reflect') {
    result = await inspectGrpcReflection(await readJson(need('--source'), 65536), { protocol: flags.get('--protocol') });
  } else if (action === 'reflect-capture') {
    const captured = await captureGrpcReflection(await readJson(need('--source'), 65536), {
      protocol: flags.get('--protocol'), services, expectedInventorySha256: flags.get('--expected-inventory-sha') });
    assertProtoArchiveFits(captured.protoSource); compileProtoSource(captured.protoSource);
    await atomicJson(need('--out'), captured.protoSource, { exclusive: true });
    result = { captured: need('--out'), protoSha256: captured.protoSource.sha256,
      services: captured.protoSource.services, files: captured.protoSource.files.length,
      protocol: captured.inventory.protocol, inventorySha256: captured.inventory.sha256,
      bytes: jsonBytes(captured.protoSource, 8388608).length, transferBytes: captured.transferBytes };
  } else if (action === 'capture') {
    if (!entries.length) throw new TypeError(help);
    const captured = assertProtoArchiveFits(await captureProtoSource({ directory: need('--directory'), entrypoints: entries }));
    compileProtoSource(captured); await atomicJson(need('--out'), captured, { exclusive: true });
    result = { captured: need('--out'), protoSha256: captured.sha256, files: captured.files.length,
      builtins: captured.builtins.length, bytes: jsonBytes(captured, 8388608).length };
  } else if (action === 'inspect') {
    const contract = compileProtoSource(await readJson(need('--proto'), 8388608));
    result = flags.has('--method') ? grpcMethodSchema(contract, flags.get('--method')) : contract.inventory;
  } else if (action === 'prepare') {
    result = await prepareGrpcSeller({ sourceFile: need('--source'), protoFile: need('--proto'),
      planFile: need('--plan'), directory: need('--out') });
  } else {
    const prepared = await readGrpcPrepared(need('--directory'));
    result = { directory: prepared.directory, schema: prepared.manifest.schema, protoSha256: prepared.protoSource.sha256,
      routes: prepared.service.routes.map(route => ({ id: route.id, url: route.offer.resource.url,
        paymentOptions: route.offer.accepts })), files: prepared.manifest.files };
  }
  stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ error: error.code ?? error.message,
    ...(error.field_path ? { field: error.field_path } : {}) })); process.exitCode = 1; });
