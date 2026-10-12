#!/usr/bin/env node
// MIT. Original captured contracts, merchant preparation and retained operator calls.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureProtoSource, compileProtoSource } from './proto.mjs';
import { inspectGrpcReflection, captureGrpcReflection } from './reflection.mjs';
import { grpcMethodSchema } from './values.mjs';
import { prepareGrpcInput, grpcOperationSchema } from './request-series.mjs';
import { validateGrpcConfig } from './config.mjs';
import { prepareGrpcSeller, readGrpcPrepared } from './prepare.mjs';
import { readJson, jsonBytes, assertProtoArchiveFits } from './common.mjs';
import { createGrpcWorkspace } from './workspace/model.mjs';
import { exportGrpcStream } from './stream-capture.mjs';
import { atomicJson } from '../../sf46-release/release-core.mjs';
const help = [
  'node grpc/cli.mjs upgrade --help',
  'node grpc/cli.mjs capture --directory PRIVATE_PROTO_DIRECTORY --entry service.proto [--entry other.proto] --out NEW_PROTO_SOURCE_JSON',
  'node grpc/cli.mjs reflect --source PRIVATE_SOURCE_JSON [--protocol auto|v1|v1alpha]',
  'node grpc/cli.mjs reflect-capture --source PRIVATE_SOURCE_JSON --service package.Service [--service other.Service] --expected-inventory-sha SHA256 [--protocol auto|v1|v1alpha] --out NEW_PROTO_SOURCE_JSON',
  'node grpc/cli.mjs inspect --proto PRIVATE_PROTO_SOURCE_JSON [--method /package.Service/Method] [--source PRIVATE_SOURCE_JSON]',
  'node grpc/cli.mjs validate-request --proto PRIVATE_PROTO_SOURCE_JSON --source PRIVATE_SOURCE_JSON --method /package.Service/Method --input REQUEST_JSON',
  'node grpc/cli.mjs prepare --source PRIVATE_SOURCE_JSON --proto PRIVATE_PROTO_SOURCE_JSON --plan PRIVATE_PLAN_JSON --out NEW_PRIVATE_DIRECTORY',
  'node grpc/cli.mjs verify --directory PRIVATE_PREPARED_DIRECTORY',
  'node grpc/cli.mjs call --state PRIVATE_WORKSPACE --revision SAVED_SHA --method /package.Service/Method --input REQUEST_JSON --id NEW_UUID',
  'node grpc/cli.mjs attempt --state PRIVATE_WORKSPACE --id ORIGINAL_UUID',
  'node grpc/cli.mjs export-stream --state PRIVATE_WORKSPACE --id ORIGINAL_UUID --out NEW_NDJSON_FILE',
].join('\n');
export async function main(args = process.argv.slice(2), { stdout = process.stdout } = {}) {
  if (args[0] === 'upgrade') return (await import('./upgrade-cli.mjs')).upgradeMain(args.slice(1), { stdout });
  if (!args.length || args[0] === '--help') { stdout.write(help + '\n'); return; }
  const [action, ...rest] = args, flags = new Map(), entries = [], services = [];
  const allowed = {
    capture: ['--directory', '--entry', '--out'], inspect: ['--proto', '--method', '--source'],
    'validate-request': ['--proto', '--source', '--method', '--input'],
    reflect: ['--source', '--protocol'],
    'reflect-capture': ['--source', '--service', '--expected-inventory-sha', '--protocol', '--out'],
    prepare: ['--source', '--proto', '--plan', '--out'], verify: ['--directory'],
    call: ['--state', '--revision', '--method', '--input', '--id'],
    attempt: ['--state', '--id'], 'export-stream': ['--state', '--id', '--out'],
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
  if (['call', 'attempt', 'export-stream'].includes(action)) {
    const workspace = await createGrpcWorkspace({ stateDirectory: need('--state') });
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      if (action === 'call') {
        if (!flags.has('--revision') || !flags.has('--method') || !flags.has('--id')) throw new TypeError(help);
        result = await workspace.call({ revision: flags.get('--revision'), method: flags.get('--method'),
          input: await readJson(need('--input'), 17825792), id: flags.get('--id') }, { signal: controller.signal });
      } else if (action === 'attempt') result = await workspace.readAttempt({ id: flags.get('--id') });
      else {
        const download = await workspace.streamDownload({ id: flags.get('--id') }, { signal: controller.signal });
        try { result = await exportGrpcStream(download, need('--out'), { signal: controller.signal }); }
        finally { await download.close(); }
      }
    } finally {
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      await workspace.close();
    }
  } else if (action === 'reflect') {
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
    const source = flags.has('--source') ? validateGrpcConfig(await readJson(need('--source'), 65536)) : null;
    result = flags.has('--method') ? source ? grpcOperationSchema(contract, flags.get('--method'), { limits: source.limits })
      : grpcMethodSchema(contract, flags.get('--method')) : contract.inventory;
  } else if (action === 'validate-request') {
    if (!flags.has('--method')) throw new TypeError(help);
    const contract = compileProtoSource(await readJson(need('--proto'), 8388608));
    const source = validateGrpcConfig(await readJson(need('--source'), 65536));
    const value = prepareGrpcInput(contract, flags.get('--method'), await readJson(need('--input'), 17825792), { limits: source.limits });
    result = { schema: 'stellar-forge.grpc-request-preview.v1', protoSha256: contract.source.sha256,
      method: flags.get('--method'), input: value.value, requestStream: value.requestStream,
      messages: value.messages.length, requestBytes: value.requestBytes, requestJsonBytes: value.requestJsonBytes };
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
  main().then(result => {
    if (result?.phase && result.phase !== 'COMPLETED' || result?.complete === false) process.exitCode = 2;
  }).catch(error => { console.error(JSON.stringify({ error: error.code ?? error.message,
    ...(error.field_path ? { field: error.field_path } : {}) })); process.exitCode = 1; });
