// MIT. Local operator inspection and setup; this command does not authorize a buyer payment.
import { constants } from 'node:fs';
import { readFile, open, mkdir, rm, link, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openS3ObjectFile } from './source.mjs';
import { compileHttpSellerOffer } from '../seller.mjs';

const HELP = `Usage:
  node cli.mjs describe --source PRIVATE_SOURCE.json
  node cli.mjs inspect --source PRIVATE_SOURCE.json --object ID --out NEW_FILE [--offset N --length N]
  node cli.mjs configure --source PRIVATE_SOURCE.json --payment PAYMENT.json --origin HTTPS_ORIGIN --directory NEW_DIR
  node cli.mjs workspace --state PRIVATE_DIRECTORY [--source SOURCE.json --payment PAYMENT.json --origin HTTPS_ORIGIN]

describe performs authorized private HEAD reads and prints public object contracts.
inspect retrieves one approved object/chunk directly as its local operator, without x402.
configure creates an original SF30 service.json and handlers.mjs for these exact objects.
Credentials stay with the source's configured AWS SDK credential provider.`;

function argsOf(args) {
  if (!args.length || args[0] === '--help') return null;
  const command = args[0], options = new Map();
  const allow = { describe: ['--source'], inspect: ['--source', '--object', '--out', '--offset', '--length'],
    configure: ['--source', '--payment', '--origin', '--directory'] }[command];
  if (!allow) throw new TypeError(HELP);
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!allow.includes(key) || options.has(key) || !value || value.startsWith('--')) throw new TypeError(HELP);
    options.set(key, value);
  }
  const required = { describe: ['--source'], inspect: ['--source', '--object', '--out'],
    configure: ['--source', '--payment', '--origin', '--directory'] }[command];
  if (required.some(key => !options.has(key))) throw new TypeError(HELP);
  return { command, options };
}

async function writeNew(path, data, resume) {
  const expected = Buffer.from(data), temporary = join(dirname(path), '.s3-write-' + randomUUID());
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(expected); await file.sync();
    try { await link(temporary, path); }
    catch (error) {
      if (!resume || error.code !== 'EEXIST') throw error;
      const existing = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await existing.stat({ bigint: true });
        const actual = Buffer.alloc(expected.length + 1); let used = 0;
        if (before.isFile() && before.size === BigInt(expected.length)) {
          while (used < actual.length) {
            const part = await existing.read(actual, used, actual.length - used, null);
            if (!part.bytesRead) break; used += part.bytesRead;
          }
        }
        const after = await existing.stat({ bigint: true });
        if (!before.isFile() || used !== expected.length || before.size !== after.size ||
            before.mtimeNs !== after.mtimeNs || !actual.subarray(0, used).equals(expected)) {
          const conflict = new Error('Existing S3 package file differs from this saved preparation: ' + basename(path));
          conflict.code = 'S3_PACKAGE_CONTENT_CONFLICT'; conflict.status = 409; throw conflict;
        }
      } finally { await existing.close(); }
    }
    const parent = await open(dirname(path), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await file.close(); await rm(temporary, { force: true }); }
}

/** Compile the same original S3 service from an operator-selected description. */
export function compileS3Seller({ payment, origin, description }) {
  const target = new URL(origin);
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || target.pathname !== '/')
    throw new TypeError('Choose one public HTTPS origin');
  const originText = target.origin;
  const perObject = payment?.schema === 'stellar-forge.s3-payments.v1' ? payment.objects : null;
  if (perObject && (typeof perObject !== 'object' || Array.isArray(perObject) ||
      Object.keys(perObject).some(id => !description.objects.some(item => item.id === id))))
    throw new TypeError('Payment map must match configured object IDs');
  const routes = description.objects.map((item, i) => {
    const terms = perObject ? perObject[item.id] : payment;
    const definition = { method: 'GET', description: `${item.description} Object snapshot: ${item.snapshot}.`,
      serviceName: 'Private object downloads', tags: ['data', 'download'], payment: terms,
      ...(item.mode === 'chunks' ? { queryParameters: [
        { name: 'offset', type: 'integer', description: 'Zero-based byte offset', example: 0 },
        { name: 'length', type: 'integer', description: `At most ${item.maxBytes} bytes; final chunk may be shorter`, example: item.maxBytes },
      ] } : {}) };
    const offer = compileHttpSellerOffer({ ...definition, url: originText + item.path });
    offer.resource.mimeType = item.contentType;
    // The original compiler's optional output example describes JSON. An opaque
    // file has no JSON output declaration; preserve its original input/schema.
    delete offer.extensions.bazaar.info.output;
    delete offer.extensions.bazaar.schema.properties.output;
    return { id: item.id, path: item.path, offer, handler: `object${i}`, admit: `admit${i}` };
  });
  return { schema: 'stellar-forge.seller-service.v1', publicOrigin: originText, routes };
}

/** Generate original seller config and native handler exports; does not start a seller. */
export async function configureS3Seller({ sourcePath, payment, origin, directory, source, resume = false }) {
  const description = source.describe();
  const service = compileS3Seller({ payment, origin, description });
  const out = resolve(directory);
  const sourceModule = new URL('./source.mjs', import.meta.url).href;
  const handlers = `// Generated for the ORIGINAL SF30 --handlers interface. Keep this file operator-private.\n` +
    `import { openS3ObjectFile } from ${JSON.stringify(sourceModule)};\n` +
    `const source = await openS3ObjectFile(${JSON.stringify(join(out, 'source.json'))});\n` +
    description.objects.map((item, i) => `const route${i} = source.route(${JSON.stringify(item.id)});\nexport const object${i} = route${i}.handler;\nexport const admit${i} = route${i}.admit;`).join('\n') +
    `\nexport const closeS3Source = source.close;\nexport const describeS3Source = source.describe;\n`;
  try { await mkdir(out, { mode: 0o700 }); }
  catch (error) {
    // Only a retained authoring operation requests replay. Original CLI setup
    // still requires a new directory; replay compares every published byte.
    if (!resume || error.code !== 'EEXIST' || !(await lstat(out)).isDirectory()) throw error;
  }
  await writeNew(join(out, 'source.json'), JSON.stringify(source.snapshotConfig(), null, 2) + '\n', resume);
  await writeNew(join(out, 'service.json'), JSON.stringify(service, null, 2) + '\n', resume);
  await writeNew(join(out, 'handlers.mjs'), handlers, resume);
  await writeNew(join(out, 'objects.json'), JSON.stringify(description, null, 2) + '\n', resume);
  return { schema: 'stellar-forge.s3-setup.v1', directory: out,
    source: join(out, 'source.json'), service: join(out, 'service.json'), handlers: join(out, 'handlers.mjs'), objects: description.objects.length,
    sellerCommand: [process.execPath, fileURLToPath(new URL('../serve.mjs', import.meta.url)),
      '--config', join(out, 'service.json'), '--handlers', join(out, 'handlers.mjs')],
    note: 'Start the original seller after inspection. Add its existing --facilitator option for native payments.' };
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'workspace') return (await import('./workspace/server.mjs')).main(args.slice(1));
  const parsed = argsOf(args);
  if (!parsed) { process.stdout.write(HELP + '\n'); return; }
  const { command, options } = parsed;
  const sourcePath = resolve(options.get('--source'));
  const source = await openS3ObjectFile(sourcePath);
  try {
    let result;
    if (command === 'describe') result = source.describe();
    if (command === 'inspect') {
      const query = Object.fromEntries(['offset', 'length'].filter(key => options.has(`--${key}`))
        .map(key => [key, options.get(`--${key}`)]));
      const route = source.route(options.get('--object'));
      const context = { method: 'GET', query, headers: {}, body: null };
      const admitted = route.admit(context);
      if (admitted !== true) throw new Error(admitted.body?.error ?? 'S3_INSPECTION_REJECTED');
      const output = resolve(options.get('--out'));
      // Reserve the destination before retrieving any object bytes.
      const file = await open(output, 'wx', 0o600); let complete = false;
      try {
        const response = await route.handler(context);
        if (![200, 206].includes(response.status)) throw new Error(response.body?.error ?? 'S3_INSPECTION_FAILED');
        await file.writeFile(response.body); await file.sync(); complete = true;
        result = { schema: 'stellar-forge.s3-inspection.v1', object: options.get('--object'),
          output, bytes: response.body.length, sha256: response.headers['x-content-sha256'],
          snapshot: response.headers['x-sf30-object-snapshot'],
          ...(response.headers['content-range'] ? { contentRange: response.headers['content-range'] } : {}) };
      } finally { await file.close(); if (!complete) await rm(output, { force: true }); }
    }
    if (command === 'configure') {
      const bytes = await readFile(resolve(options.get('--payment')));
      if (bytes.length > 65536) throw new TypeError('Payment file exceeds 64 KiB');
      const payment = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      result = await configureS3Seller({ sourcePath, source, payment, origin: options.get('--origin'),
        directory: options.get('--directory') });
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { source.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(String(error?.message ?? 'S3_OPERATOR_COMMAND_FAILED') + '\n'); process.exitCode = 1; });
}
