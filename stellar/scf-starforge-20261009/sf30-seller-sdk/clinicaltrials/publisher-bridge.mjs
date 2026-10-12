// MIT. One original dataset/publisher child owned by the retained registry workspace.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error('Use the original retained regular file');
  return info;
}
async function writeOnce(path, value) {
  await writeFile(path, typeof value === 'string' ? value : json(value), { flag: 'wx', mode: 0o600 });
}
async function datasetOperation(action, payload) {
  const [{ loadDatasetConfig }, { buildDatasetSellerConfig }] = await Promise.all([
    import('../dataset-handler.mjs'), import('../dataset-cli.mjs'),
  ]);
  const directory = action === 'merchant.validate' ? null : resolve(payload.directory);
  const configPath = action === 'merchant.validate' ? resolve(payload.datasetConfig) : join(directory, 'dataset.json');
  await regular(configPath);
  const dataset = await loadDatasetConfig(configPath);
  const description = dataset.describe();
  if (payload.expectedSnapshot && description.snapshot !== payload.expectedSnapshot)
    throw new Error('Native snapshot differs from the original reviewed registry build');
  if (action === 'dataset.inspect') return description;
  const seller = await buildDatasetSellerConfig(dataset, {
    payment: payload.payment, origin: payload.origin, path: payload.path,
  });
  if (action === 'merchant.validate')
    return { payment: payload.payment, origin: seller.publicOrigin, path: seller.routes[0].path };
  const [{ compileSellerRoutes }, { compileSellerOpenApi }, { exportSellerClient }] = await Promise.all([
    import('../resource-server.mjs'), import('../developer-portal.mjs'), import('../developer/client-export.mjs'),
  ]);
  const compiled = compileSellerRoutes(seller.routes.map(route => ({
    id: route.id, definition: { ...route.definition, url: seller.publicOrigin + route.path },
    handler: dataset.handle, admit: dataset.admit,
  })));
  const openapi = compileSellerOpenApi(compiled);
  await writeOnce(join(directory, 'seller.json'), seller);
  await writeOnce(join(directory, 'openapi.json'), openapi);
  const customer = await exportSellerClient({ openapi: join(directory, 'openapi.json'), out: join(directory, 'customer') });
  return { ...description, seller: { origin: seller.publicOrigin, path: seller.routes[0].path },
    customer: { manifest: customer.manifest, filesSha256: customer.filesSha256 } };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--directory' || !args[1])
    throw new Error('Use publisher-bridge.mjs --directory ORIGINAL_PRIVATE_DIRECTORY');
  const directory = resolve(args[1]);
  let publisher;
  async function original() {
    if (!publisher) {
      const { openSocrataPublisher } = await import('../socrata/publisher.mjs');
      publisher = await openSocrataPublisher({ directory });
    }
    return publisher;
  }
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  try {
    for await (const line of input) {
      let request;
      try {
        if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error('Publisher request exceeds 4 MiB');
        request = JSON.parse(line);
        if (!object(request) || !Number.isSafeInteger(request.id) || typeof request.action !== 'string' || !object(request.payload))
          throw new Error('Invalid original publisher request');
        let result;
        if (['dataset.inspect', 'dataset.prepare', 'merchant.validate'].includes(request.action)) {
          result = await datasetOperation(request.action, request.payload);
        } else if (request.action === 'publisher.state') {
          result = await (await original()).state();
        } else if (request.action === 'publisher.export') {
          const exported = await (await original()).readExport(request.payload.kind, request.payload.id);
          if (!Buffer.isBuffer(exported.bytes) || basename(exported.filename) !== exported.filename)
            throw new Error('Original publisher export is not a declared file');
          const folder = join(directory, 'operator-downloads');
          await mkdir(folder, { mode: 0o700, recursive: true });
          const info = await lstat(folder);
          if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid original download directory');
          const digest = hash(exported.bytes), path = join(folder, digest + '.file');
          try {
            await writeFile(path, exported.bytes, { flag: 'wx', mode: 0o600 });
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            await regular(path);
            if (hash(await readFile(path)) !== digest) throw new Error('Retained publisher download changed');
          }
          result = { path, filename: exported.filename, contentType: exported.contentType,
            bytes: exported.bytes.length, sha256: digest };
        } else if (request.action.startsWith('publisher.')) {
          result = await (await original()).act(request.action, request.payload);
        } else {
          throw new Error('Unknown original publisher operation');
        }
        process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n');
      } catch (error) {
        process.stdout.write(JSON.stringify({ id: request?.id ?? null, ok: false,
          error: String(error?.message ?? error), code: error?.code }) + '\n');
      }
    }
  } finally {
    input.close();
    if (publisher) await publisher.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
