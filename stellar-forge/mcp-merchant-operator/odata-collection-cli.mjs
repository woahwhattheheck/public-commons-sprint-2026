#!/usr/bin/env node
// MIT. Customer operation over the original retained OData collection.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  listMerchantODataCollections, inspectMerchantODataCollection, downloadMerchantODataCollection,
  inspectODataCollectionDownload, receiveODataCollectionDownload, fetchODataCollection,
  inspectReceivedODataCollection, readReceivedODataCollectionRows, receivedODataCollectionAnalysisMapping
} from './odata-collection-client.mjs';

const HELP = [
  'OData collection customer',
  '',
  'list --url URL --workspace ALIAS --service ID [--offset 0 --limit 50]',
  'inspect --url URL --workspace ALIAS --service ID --collection ID [--sha256 SHA256]',
  'download --url URL --workspace ALIAS --service ID --collection ID --sha256 SHA256 --out PRIVATE_DIRECTORY',
  'fetch --url URL --workspace ALIAS --service ID --collection ID --sha256 SHA256 --download PRIVATE_DIRECTORY --out COLLECTION_DIRECTORY',
  'verify-download --directory PRIVATE_DIRECTORY [--sha256 SHA256]',
  'receive --download PRIVATE_DIRECTORY --out COLLECTION_DIRECTORY --sha256 SHA256',
  'inspect-received --directory COLLECTION_DIRECTORY',
  'rows --directory COLLECTION_DIRECTORY [--offset 0 --limit 100]',
  'analysis-mapping --directory COLLECTION_DIRECTORY --source REGISTERED_NAME --revision NUMBER',
  '',
  'Remote operations use --token-env MCP_ACCESS_TOKEN (default); keep the bearer in that environment variable.',
  'download and fetch also accept --chunk-size 196608 and --progress true.',
  'Use the sourceSha256 returned by inspect. Repeat the same command and directories to resume.',
  'download and receiving directories must be separate. source.json appears only after every source file is synced.',
  'fetch downloads, then invokes the original native collection restore. It retains the original source document.',
  'analysis-mapping uses the actual source alias and positive revision returned by the original Analysis registration.',
  ''
].join('\n');

function parse(args) {
  const [command, ...values] = args, options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index], value = values[index + 1];
    if (typeof name !== 'string' || !/^--[a-z][a-z-]*$/.test(name) ||
      Object.hasOwn(options, name.slice(2)) || typeof value !== 'string' || !value || value.startsWith('--'))
      throw new TypeError('Each named option requires one value and may appear once. Use --help.');
    options[name.slice(2)] = value;
  }
  return { command, options };
}
function only(options, names) {
  if (Object.keys(options).some(key => !names.includes(key))) throw new TypeError('Unknown option for this command. Use --help.');
}
function required(options, name) {
  if (!options[name]) throw new TypeError('--' + name + ' is required.');
  return options[name];
}
function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new TypeError('Use an explicit nonnegative integer.');
  return Number(value);
}
function remote(options, collection = true) {
  return { url: required(options, 'url'), workspace: required(options, 'workspace'),
    liveServiceId: required(options, 'service'), ...(collection ? { collectionId: required(options, 'collection') } : {}),
    tokenEnv: options['token-env'] ?? 'MCP_ACCESS_TOKEN' };
}
const REMOTE = ['url', 'workspace', 'service', 'collection', 'token-env'];
const write = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { process.stdout.write(HELP); return; }
  const { command, options: input } = parse(args), controller = new AbortController();
  const abort = () => controller.abort(new Error('Customer transfer interrupted; repeat the same command to resume.'));
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    let result;
    if (command === 'list') {
      only(input, ['url', 'workspace', 'service', 'token-env', 'offset', 'limit']);
      result = await listMerchantODataCollections({ ...remote(input, false), signal: controller.signal,
        offset: integer(input.offset, 0), limit: integer(input.limit, 50) });
    } else if (command === 'inspect') {
      only(input, [...REMOTE, 'sha256']);
      result = await inspectMerchantODataCollection({ ...remote(input), signal: controller.signal,
        expectedSha256: input.sha256 });
    } else if (command === 'download' || command === 'fetch') {
      only(input, [...REMOTE, 'sha256', 'out', 'chunk-size', 'progress', ...(command === 'fetch' ? ['download'] : [])]);
      if (input.progress !== undefined && !['true', 'false'].includes(input.progress))
        throw new TypeError('--progress requires true or false.');
      const options = { ...remote(input), expectedSha256: required(input, 'sha256'),
        directory: resolve(required(input, command === 'fetch' ? 'download' : 'out')),
        ...(command === 'fetch' ? { collectionDirectory: resolve(required(input, 'out')) } : {}),
        chunkSize: integer(input['chunk-size'], 196608), signal: controller.signal,
        ...(input.progress === 'true' ? { onProgress: event => {
          process.stderr.write(JSON.stringify({ schema: 'stellar-forge.odata-collection-progress.v1', ...event }) + '\n');
        } } : {}) };
      result = await (command === 'fetch' ? fetchODataCollection(options) : downloadMerchantODataCollection(options));
    } else if (command === 'verify-download') {
      only(input, ['directory', 'sha256']);
      result = await inspectODataCollectionDownload({ directory: resolve(required(input, 'directory')),
        expectedSha256: input.sha256, signal: controller.signal });
    } else if (command === 'receive') {
      only(input, ['download', 'out', 'sha256']);
      result = await receiveODataCollectionDownload({ directory: resolve(required(input, 'download')),
        collectionDirectory: resolve(required(input, 'out')), expectedSha256: required(input, 'sha256'),
        signal: controller.signal });
    } else if (command === 'inspect-received') {
      only(input, ['directory']);
      result = await inspectReceivedODataCollection({ directory: resolve(required(input, 'directory')) });
    } else if (command === 'rows') {
      only(input, ['directory', 'offset', 'limit']);
      result = await readReceivedODataCollectionRows({ directory: resolve(required(input, 'directory')),
        offset: integer(input.offset, 0), limit: integer(input.limit, 100) });
    } else if (command === 'analysis-mapping') {
      only(input, ['directory', 'source', 'revision']);
      result = await receivedODataCollectionAnalysisMapping({ directory: resolve(required(input, 'directory')),
        source: required(input, 'source'), sourceRevision: integer(required(input, 'revision')) });
    } else throw new TypeError('Unknown OData collection customer command. Use --help.');
    write(result); return result;
  } finally {
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: typeof error.code === 'string' ? error.code : 'ODATA_COLLECTION_CUSTOMER_FAILED',
      message: error.message }) + '\n'); process.exitCode = 1;
  });
