#!/usr/bin/env node
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importOpenApi } from './importer.mjs';
import { parseOpenApiSource } from './source-document.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');

export async function run(args = process.argv.slice(2), {report = true} = {}) {
  if (args[0] === 'har') return (await import('./har/cli.mjs')).runHarCLI(args.slice(1));
  if (args[0] === 'postman') return (await import('./postman/cli.mjs')).runPostmanCLI(args.slice(1));
  if (args[0] === 'weather') return (await import('./openweather/cli.mjs')).main(args.slice(1));
  if (args[0] === 'refresh') return (await import('./refresh-cli.mjs')).run(args.slice(1));
  if (args[0] === 'source')
    return (await import('./source-bundle-cli.mjs')).runSourceBundleCLI(args.slice(1));
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--spec', '--config', '--out', '--service-bindings', '--upstream-bindings'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options.has(args[i]))
      throw new Error('Usage: node cli.mjs --spec openapi.json --config selections.json --out NEW_DIRECTORY [--service-bindings bindings.json] [--upstream-bindings upstreams.json]');
    options.set(args[i], args[i + 1]);
  }
  if (!['--spec', '--config', '--out'].every(key => options.has(key))) throw new Error('Supply --spec, --config and --out');
  if (options.has('--upstream-bindings') && !options.has('--service-bindings'))
    throw new Error('--upstream-bindings requires --service-bindings');
  const input = async name => {
    const path = options.get(name), stat = await lstat(path);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error(name + ' requires a regular source file up to 4 MiB');
    const bytes = await readFile(path);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Input grew beyond size limit');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:name==='--spec'}).decode(bytes);
    return { bytes, value:name==='--spec'?parseOpenApiSource(text).document:JSON.parse(text) };
  };
  const spec = await input('--spec'), config = await input('--config');
  const compiled = importOpenApi(spec.value, config.value);
  const bytes = Buffer.from(JSON.stringify(compiled, null, 2) + '\n');
  const bindings = options.has('--service-bindings') ? await input('--service-bindings') : null;
  // Metadata-only import need not load a network resource-server module.
  const createSellerServiceConfig = bindings
    ? (await import('./service-config.mjs')).createSellerServiceConfig : null;
  const serviceConfig = bindings ? createSellerServiceConfig(compiled, bindings.value) : null;
  const upstreamInput = options.has('--upstream-bindings') ? await input('--upstream-bindings') : null;
  let upstreamBytes = null;
  if (upstreamInput) {
    const { createContractUpstreamBindings } = await import('./response-contracts.mjs');
    const upstreams = createContractUpstreamBindings(spec.value, compiled, bindings.value, upstreamInput.value,
      { specSha256: sha(spec.bytes) });
    upstreamBytes = Buffer.from(JSON.stringify(upstreams, null, 2) + '\n');
    if (upstreamBytes.length > 1048576) throw new RangeError('Upstream config exceeds the SF30 1 MiB limit');
  }
  const responseFiles = [];
  if (serviceConfig?.routes.some(route => Object.hasOwn(route, 'responseFile'))) {
    const { readJsonResponseFile } = await import('../sf30-seller-sdk/response-file.mjs');
    for (const route of serviceConfig.routes) {
      if (!Object.hasOwn(route, 'responseFile')) continue;
      let snapshot;
      try {
        snapshot = await readJsonResponseFile(resolve(dirname(resolve(options.get('--service-bindings'))), route.responseFile));
      } catch (error) {
        throw new Error(`Route ${route.id} responseFile: ${error.message}`, { cause: error });
      }
      route.responseFile = 'responses/' + route.id + '.json';
      responseFiles.push({ routeId: route.id, file: route.responseFile, bytes: snapshot.source });
    }
  }
  const serviceBytes = serviceConfig ? Buffer.from(JSON.stringify(serviceConfig, null, 2) + '\n') : null;
  if (serviceBytes && serviceBytes.length > 1024 * 1024) throw new RangeError('Service config exceeds the SF30 1 MiB limit');
  const native = await readFile(new URL('../sf30-seller-discovery/index.mjs', import.meta.url));
  const adapter = await readFile(new URL('./importer.mjs', import.meta.url));
  const validator = await readFile(new URL('../../../stellar-forge/payment-auto-catalog/schema-validation.mjs', import.meta.url));
  const compatibility = await readFile(new URL('./schema-compat.mjs', import.meta.url));
  const manifest = { schema: 'stellar.open-api-seller-manifest.v1',
    specSha256: sha(spec.bytes), selectionsSha256: sha(config.bytes),
    sellerCompilerSha256: sha(native), validatorSha256: sha(validator), importerSha256: sha(adapter), offersSha256: sha(bytes),
    schemaCompatibilitySha256: sha(compatibility),
    operations: compiled.offers.map(({ method, path, sourcePointer, serverIndex }) => ({ method, path, sourcePointer, serverIndex })) };
  if (serviceBytes) {
    manifest.serviceBindingsSha256 = sha(bindings.bytes);
    manifest.serviceConfigSha256 = sha(serviceBytes);
    manifest.serviceAdapterSha256 = sha(await readFile(new URL('./service-config.mjs', import.meta.url)));
  }
  if (responseFiles.length) {
    manifest.responseFiles = responseFiles.map(({ routeId, file, bytes }) => ({ routeId, file, sha256: sha(bytes) }));
    manifest.responseFileLoaderSha256 = sha(await readFile(new URL('../sf30-seller-sdk/response-file.mjs', import.meta.url)));
  }
  if (upstreamBytes) {
    manifest.upstreamBindingsSha256 = sha(upstreamInput.bytes);
    manifest.upstreamConfigSha256 = sha(upstreamBytes);
    manifest.responseContractCompilerSha256 = sha(await readFile(new URL('./response-contracts.mjs', import.meta.url)));
    manifest.responseContractRuntimeSha256 = sha(await readFile(new URL('../sf30-seller-sdk/response-contract.mjs', import.meta.url)));
  }
  const output = resolve(options.get('--out'));
  await mkdir(output, { mode: 0o700 });
  if (responseFiles.length) {
    await mkdir(resolve(output, 'responses'), { mode: 0o700 });
    for (const { file, bytes } of responseFiles) await writeFile(resolve(output, file), bytes, { flag: 'wx', mode: 0o600 });
  }
  await writeFile(resolve(output, 'offers.json'), bytes, { flag: 'wx', mode: 0o600 });
  if (serviceBytes) await writeFile(resolve(output, 'seller-service.json'), serviceBytes, { flag: 'wx', mode: 0o600 });
  if (upstreamBytes) await writeFile(resolve(output, 'upstreams.json'), upstreamBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (report) process.stdout.write(JSON.stringify({ output, operations: compiled.offers.length, paymentsInitiated: 0 }) + '\n');
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  run().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });


