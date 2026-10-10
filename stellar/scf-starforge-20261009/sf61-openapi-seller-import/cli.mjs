#!/usr/bin/env node
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importOpenApi } from './importer.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');

export async function run(args = process.argv.slice(2)) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--spec', '--config', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options.has(args[i]))
      throw new Error('Usage: node cli.mjs --spec openapi.json --config selections.json --out NEW_DIRECTORY');
    options.set(args[i], args[i + 1]);
  }
  if (options.size !== 3) throw new Error('Supply --spec, --config and --out');
  const input = async name => {
    const path = options.get(name), stat = await lstat(path);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error(name + ' requires a regular JSON file up to 4 MiB');
    const bytes = await readFile(path);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Input grew beyond size limit');
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  };
  const spec = await input('--spec'), config = await input('--config');
  const compiled = importOpenApi(spec.value, config.value);
  const bytes = Buffer.from(JSON.stringify(compiled, null, 2) + '\n');
  const native = await readFile(new URL('../sf30-seller-discovery/index.mjs', import.meta.url));
  const adapter = await readFile(new URL('./importer.mjs', import.meta.url));
  const validator = await readFile(new URL('../../../stellar-forge/payment-auto-catalog/auto-catalog.mjs', import.meta.url));
  const manifest = { schema: 'stellar.open-api-seller-manifest.v1',
    specSha256: sha(spec.bytes), selectionsSha256: sha(config.bytes),
    sellerCompilerSha256: sha(native), validatorSha256: sha(validator), importerSha256: sha(adapter), offersSha256: sha(bytes),
    operations: compiled.offers.map(({ method, path, sourcePointer, serverIndex }) => ({ method, path, sourcePointer, serverIndex })) };
  const output = resolve(options.get('--out'));
  await mkdir(output, { mode: 0o700 });
  await writeFile(resolve(output, 'offers.json'), bytes, { flag: 'wx', mode: 0o600 });
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ output, operations: compiled.offers.length, paymentsInitiated: 0 }) + '\n');
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  run().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
