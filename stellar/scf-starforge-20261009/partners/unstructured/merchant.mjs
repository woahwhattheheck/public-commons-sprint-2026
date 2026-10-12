#!/usr/bin/env node
// MIT. Unstructured merchant preparation using the original SF30 compiler and client exporter.
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUnstructuredPartition } from '../../sf30-seller-sdk/unstructured-partition.mjs';
import { compileSellerRoutes } from '../../sf30-seller-sdk/resource-server.mjs';
import { compileSellerOpenApi } from '../../sf30-seller-sdk/developer-portal.mjs';
import { generateSellerClient } from '../../sf30-seller-sdk/developer/client-generator.mjs';
import { exportSellerClient, inspectSellerClientExport, adoptSellerClientExport } from '../../sf30-seller-sdk/developer/client-export.mjs';
import { inspectUpstreamConfiguration } from '../../sf82-seller-pilot/release-upstreams.mjs';
import { absolute, parseJson, readPrivateFile } from '../../sf103-native-buyer-signer/operator.mjs';
import {
  acquireInitialization, initializationDirectory, initializationJson,
  retainInitializationFile, retainInitializationRecord, verifyInitializationFile,
} from '../../sf88-operator-buyer-cli/initialization.mjs';
import { need, same, UNSTRUCTURED_SOURCE } from '../../sf88-operator-buyer-cli/node/unstructured/contract.mjs';

const SCHEMA = 'stellar-forge.prepared-unstructured-merchant.v1';
const INPUTS = ['configuration.json', 'seller.json', 'upstreams.json', 'partition-manifest.json', 'seller-openapi.json'];
const sha = value => createHash('sha256').update(value).digest('hex');
const descriptor = (name, bytes) => ({ name, bytes: bytes.length, sha256: sha(bytes) });
const cli = fileURLToPath(import.meta.url);
const compilationOnly = () => { throw new Error('UNSTRUCTURED_OFFLINE_COMPILATION_ONLY'); };

function compile(configurationBytes, allowLoopbackUpstream) {
  need(typeof allowLoopbackUpstream === 'boolean', 'UNSTRUCTURED_LOOPBACK_SELECTION_REQUIRED');
  const result = compileUnstructuredPartition(parseJson(configurationBytes));
  const upstreamReview = inspectUpstreamConfiguration(initializationJson(result.upstreams),
    result.service, allowLoopbackUpstream);
  const routes = compileSellerRoutes(result.service.routes.map(route => ({
    id: route.id, offer: route.offer, handler: compilationOnly,
    maxRequestBytes: route.maxRequestBytes,
    ...(route.validateInput ? { admit: compilationOnly } : {}),
  })));
  const specification = compileSellerOpenApi(routes, { mode: 'NATIVE_X402' });
  return {
    result, upstreamReview,
    payloads: [
      ['configuration.json', configurationBytes],
      ['seller.json', initializationJson(result.service)],
      ['upstreams.json', initializationJson(result.upstreams)],
      ['partition-manifest.json', initializationJson(result.manifest)],
      ['seller-openapi.json', initializationJson(specification)],
    ],
  };
}

async function originalClient(directory, specificationBytes, exportId, resume) {
  const out = join(directory, 'client');
  let current = await inspectSellerClientExport({ directory: out, exportId });
  if (current.state === 'NOT_FOUND') {
    await exportSellerClient({ openapi: join(directory, 'seller-openapi.json'), out,
      provenance: { exportId } });
    return inspectSellerClientExport({ directory: out, exportId });
  }
  need(resume, 'UNSTRUCTURED_CLIENT_ALREADY_EXISTS');
  if (current.state !== 'COMPLETE') {
    // Resume the original five derived files in place. The maintained generator
    // supplies every byte; its existing export/adoption contract owns completion.
    const generated = generateSellerClient(specificationBytes);
    const payloads = [
      ['seller-client.mjs', Buffer.from(generated.javascript)],
      ['seller-client.d.mts', Buffer.from(generated.declarations)],
      ['seller-openapi.json', specificationBytes],
      ['package.json', Buffer.from(generated.packageJson)],
      ['README.md', Buffer.from(generated.readme)],
    ];
    await initializationDirectory(out);
    for (const [name, bytes] of payloads) await verifyInitializationFile(join(out, name), bytes);
    for (const [name, bytes] of payloads)
      await retainInitializationFile(join(out, name), bytes, { resume: true });
    current = await inspectSellerClientExport({ directory: out, exportId });
    need(current.state === 'LEGACY_FILES_RETAINED' || current.state === 'COMPLETE',
      'UNSTRUCTURED_CLIENT_COMPLETION_REQUIRED');
    if (current.state === 'LEGACY_FILES_RETAINED')
      current = await adoptSellerClientExport({ directory: out,
        expectedFilesSha256: current.filesSha256, provenance: { exportId } });
  }
  need(current.sourceSha256 === sha(specificationBytes) && current.mode === 'NATIVE_X402',
    'UNSTRUCTURED_CLIENT_SOURCE_CHANGED');
  return current;
}

/** Prepare actual SF30 declarations, the public contract and the original generated customer SDK. */
export async function prepareUnstructuredMerchant({
  configurationFile, directory, python, allowLoopbackUpstream = false,
} = {}, { resume = false } = {}) {
  absolute(configurationFile); absolute(directory); absolute(python);
  const sourceBytes = await readPrivateFile(configurationFile, 1048576);
  const compiled = compile(sourceBytes, allowLoopbackUpstream);
  const files = compiled.payloads.map(([name, bytes]) => descriptor(name, bytes));
  const sourceSha256 = sha(sourceBytes), exportId = 'unstructured-' + sourceSha256.slice(0, 40);
  const identity = { schema: SCHEMA, source: UNSTRUCTURED_SOURCE, configurationSha256: sourceSha256,
    allowLoopbackUpstream, files, clientExportId: exportId };
  await initializationDirectory(dirname(directory));
  const lease = await acquireInitialization(directory, { python, resume });
  try {
    await retainInitializationRecord(join(directory, 'initializing.json'), identity, { resume });
    for (const [name, bytes] of compiled.payloads)
      await verifyInitializationFile(join(directory, name), bytes);
    for (const [name, bytes] of compiled.payloads)
      await retainInitializationFile(join(directory, name), bytes, { resume });
    const client = await originalClient(directory, compiled.payloads[4][1], exportId, resume);
    await retainInitializationRecord(join(directory, 'merchant.json'), {
      ...identity, completedAt: new Date().toISOString(),
      clientManifestSha256: client.manifestFile.sha256,
    }, { resume, ignore: ['completedAt'] });
    return inspectUnstructuredMerchant(directory);
  } finally { await lease.close(); }
}

/** Reopen retained source and customer files without the original input or provider credentials. */
export async function inspectUnstructuredMerchant(directory) {
  absolute(directory); await initializationDirectory(directory);
  const record = parseJson(await readPrivateFile(join(directory, 'merchant.json'), 1048576));
  need(record.schema === SCHEMA && same(record.source, UNSTRUCTURED_SOURCE) &&
    typeof record.allowLoopbackUpstream === 'boolean' &&
    Array.isArray(record.files) && record.files.length === INPUTS.length &&
    /^[a-f0-9]{64}$/.test(record.configurationSha256 ?? '') &&
    /^[a-f0-9]{64}$/.test(record.clientManifestSha256 ?? '') &&
    record.clientExportId === 'unstructured-' + record.configurationSha256.slice(0, 40),
  'UNSTRUCTURED_MERCHANT_PREPARATION_INVALID');
  const payloads = new Map();
  for (const [index, item] of record.files.entries()) {
    need(item.name === INPUTS[index] && Number.isSafeInteger(item.bytes) &&
      item.bytes > 0 && item.bytes <= 16777216 && /^[a-f0-9]{64}$/.test(item.sha256 ?? ''),
    'UNSTRUCTURED_MERCHANT_FILE_INVALID');
    const bytes = await readPrivateFile(join(directory, item.name), 16777216);
    need(bytes.length === item.bytes && sha(bytes) === item.sha256,
      'UNSTRUCTURED_MERCHANT_FILE_CHANGED');
    payloads.set(item.name, bytes);
  }
  need(sha(payloads.get('configuration.json')) === record.configurationSha256,
    'UNSTRUCTURED_CONFIGURATION_CHANGED');
  const configuration = parseJson(payloads.get('configuration.json'));
  const manifest = parseJson(payloads.get('partition-manifest.json'));
  const compiled = compile(payloads.get('configuration.json'), record.allowLoopbackUpstream);
  for (const [name, bytes] of compiled.payloads)
    need(payloads.get(name).equals(bytes), 'UNSTRUCTURED_MERCHANT_COMPILED_SOURCE_CHANGED');
  const client = await inspectSellerClientExport({ directory: join(directory, 'client'),
    exportId: record.clientExportId });
  need(client.state === 'COMPLETE' && client.sourceSha256 === sha(payloads.get('seller-openapi.json')) &&
    client.manifestFile.sha256 === record.clientManifestSha256,
  'UNSTRUCTURED_CUSTOMER_EXPORT_CHANGED');
  return {
    schema: SCHEMA, state: 'PREPARED', directory, completedAt: record.completedAt,
    source: record.source, configurationSha256: record.configurationSha256,
    publicOrigin: configuration.publicOrigin, allowLoopbackUpstream: record.allowLoopbackUpstream,
    sellerFile: join(directory, 'seller.json'), upstreamsFile: join(directory, 'upstreams.json'),
    manifestFile: join(directory, 'partition-manifest.json'), manifest,
    openapiFile: join(directory, 'seller-openapi.json'),
    client: { directory: client.directory, module: join(client.directory, 'seller-client.mjs'),
      filesSha256: client.filesSha256, manifestSha256: client.manifestFile.sha256 },
    upstreams: compiled.upstreamReview, files: record.files,
    commands: {
      inspect: [process.execPath, cli, 'inspect', '--directory', directory],
      client: [process.execPath, fileURLToPath(new URL('../../sf30-seller-sdk/developer/client-export.mjs', import.meta.url)),
        'status', '--dir', client.directory],
    },
  };
}

const HELP = 'Unstructured merchant preparation\n' +
  '  node merchant.mjs prepare|resume --config /private/partition.json --directory /private/merchant --python /absolute/python3 [--allow-loopback-upstream]\n' +
  '  node merchant.mjs inspect --directory /private/merchant\n' +
  'Prepare the original seller declarations and client export. Use commerce.mjs for the original native commerce session.\n';
function options(args, allowed) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    need(allowed.includes(flag) && !Object.hasOwn(result, flag), 'UNSTRUCTURED_MERCHANT_OPTION_INVALID');
    if (flag === '--allow-loopback-upstream') { result[flag] = true; continue; }
    need(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'),
      'UNSTRUCTURED_MERCHANT_OPTION_VALUE_REQUIRED');
    result[flag] = args[++i];
  }
  return result;
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', 'help'].includes(args[0])) {
    process.stdout.write(HELP); return;
  }
  const [command, ...rest] = args;
  need(['prepare', 'resume', 'inspect'].includes(command), 'UNSTRUCTURED_MERCHANT_COMMAND_REQUIRED');
  const opt = options(rest, command === 'inspect' ? ['--directory'] :
    ['--config', '--directory', '--python', '--allow-loopback-upstream']);
  const directory = opt['--directory']; absolute(directory);
  const result = command === 'inspect' ? await inspectUnstructuredMerchant(directory) :
    await prepareUnstructuredMerchant({ configurationFile: opt['--config'], directory,
      python: opt['--python'], allowLoopbackUpstream: opt['--allow-loopback-upstream'] === true },
    { resume: command === 'resume' });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^[A-Z0-9_]{1,120}$/.test(error.code ?? '') ? error.code : 'UNSTRUCTURED_MERCHANT_FAILED';
    process.stderr.write(JSON.stringify({ error: code }) + '\n'); process.exitCode = 1;
  });
}
