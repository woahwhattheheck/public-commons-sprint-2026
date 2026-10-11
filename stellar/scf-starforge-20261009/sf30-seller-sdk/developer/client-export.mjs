// MIT. Create-only customer SDK export from a saved original SF30 OpenAPI document.
import { readFile, stat, mkdir, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSellerClient } from './client-generator.mjs';

const USAGE = 'Usage: node client-export.mjs --openapi SAVED_SELLER_OPENAPI.json --out NEW_DIRECTORY';

export async function exportSellerClient({ openapi, out } = {}) {
  if (typeof openapi !== 'string' || typeof out !== 'string' || !openapi || !out) throw new TypeError(USAGE);
  const sourcePath = resolve(openapi), directory = resolve(out);
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new TypeError('OpenAPI source must be a regular file up to 16 MiB');
  const bytes = await readFile(sourcePath);
  const generated = generateSellerClient(bytes);
  const parent = await stat(dirname(directory));
  if (!parent.isDirectory()) throw new TypeError('Output parent directory must already exist');
  // Exclusive mkdir is the publication reservation. Never reuse or overwrite output.
  await mkdir(directory, { mode: 0o700 });
  const files = [
    ['seller-client.mjs', generated.javascript],
    ['seller-client.d.mts', generated.declarations],
    ['seller-openapi.json', bytes],
    ['package.json', generated.packageJson],
    ['README.md', generated.readme],
  ];
  try {
    for (const [name, data] of files) {
      const file = await open(resolve(directory, name), 'wx', 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    }
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    throw new Error(`Client export is incomplete in ${directory}; no existing files were overwritten`, { cause: error });
  }
  return { schema: 'stellar-forge.seller-client-export.v1', directory,
    sourceSha256: generated.snapshot.sourceSha256, origin: generated.snapshot.origin,
    mode: generated.snapshot.mode, operations: generated.snapshot.operations.map(({ id, method, path }) => ({ id, method, path })),
    files: files.map(([name]) => name) };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--openapi', '--out'].includes(flag) || options.has(flag) || !value || value.startsWith('--')) throw new TypeError(USAGE);
    options.set(flag, value);
  }
  if (options.size !== 2) throw new TypeError(USAGE);
  const result = await exportSellerClient({ openapi: options.get('--openapi'), out: options.get('--out') });
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
}
