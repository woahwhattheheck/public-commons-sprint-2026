#!/usr/bin/env node
// MIT. Complete receiving for the original SEC export over the retained MCP client.
import { constants } from 'node:fs';
import { open, mkdir, realpath, link, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { EDGAR_TRANSFER_MANIFEST, EDGAR_MAX_FILE_BYTES, parseEdgarTransfer } from './sec-edgar-transfer.mjs';
import { writeBytes } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code: 'EDGAR_' + code });
const requireThat = (value, code, message) => { if (!value) throw fail(code, message); };
const HASH = /^[a-f0-9]{64}$/, ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function identity(workspace, exportId) {
  requireThat(ALIAS.test(workspace ?? '') && ALIAS.test(exportId ?? ''), 'DOWNLOAD_CONFIGURATION',
    'Choose the configured original workspace alias and retained export ID.');
}
async function privateDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    requireThat(info.isDirectory() && (process.platform === 'win32' || !(info.mode & 0o077)) &&
      await realpath(path) === path, 'DOWNLOAD_PRIVATE_DIRECTORY_REQUIRED', 'Use the canonical private receiving directory.');
  } finally { await file.close(); }
}
async function bytes(path, maximum = EDGAR_MAX_FILE_BYTES) {
  requireThat(await realpath(path) === resolve(path), 'DOWNLOAD_FILE_CHANGED', 'The original receiving file path changed.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    requireThat(info.isFile() && info.size <= maximum &&
      (process.platform === 'win32' || !(info.mode & 0o077)), 'DOWNLOAD_FILE_CHANGED', 'Use a private original regular file.');
    const result = await file.readFile();
    requireThat(result.length <= maximum, 'DOWNLOAD_FILE_CHANGED', 'The original receiving file grew.');
    return result;
  } finally { await file.close(); }
}
async function verified(path, file) {
  const raw = await bytes(path, file.bytes);
  requireThat(raw.length === file.bytes && hash(raw) === file.sha256, 'DOWNLOAD_FILE_CHANGED',
    'A complete receiving file differs from its original source: ' + file.name + '.');
  return raw;
}

/** The existing client owns authentication, MCP initialization, leases and byte resume. */
function transport(workspace, suppliedClient) {
  requireThat(ALIAS.test(workspace ?? ''), 'DOWNLOAD_CONFIGURATION', 'Choose the original SEC workspace alias.');
  return createRetainedDownload({
    manifestName: EDGAR_TRANSFER_MANIFEST, parseManifest: parseEdgarTransfer,
    maximumBytes: EDGAR_MAX_FILE_BYTES,
    stateSchema: 'stellar-forge.sec-edgar-download-state.v1',
    resultSchema: 'stellar-forge.sec-edgar-download.v1',
    toolPrefix: 'merchant_edgar_export', errorPrefix: 'EDGAR', clientName: 'starforge-sec-edgar-receiver',
    describe: manifest => ({ workspaceId: manifest.workspaceId, revision: manifest.revision,
      nativeManifestSha256: manifest.nativeManifestSha256, sourceEditions: manifest.editions.length }),
    connect: async options => {
      const client = suppliedClient ?? await openMerchantFileClient(options);
      requireThat(typeof client.call === 'function' && typeof client.endpoint === 'string',
        'DOWNLOAD_CONFIGURATION', 'Use the original authenticated merchant MCP client.');
      return { endpoint: client.endpoint, call: (name, args, options) => client.call(name, { ...args, workspace }, options) };
    },
  });
}
export async function inspectEdgarExport({ workspace, exportId, client, ...options } = {}) {
  identity(workspace, exportId);
  return transport(workspace, client).inspect({ ...options, exportId });
}

/** Restore exact native paths; file bytes and the original export manifest are unchanged. */
async function materializeNative(root, transportDirectory, manifest, manifestBytes) {
  const destination = join(root, 'merchant');
  await privateDirectory(destination);
  const allowed = new Set(['client', 'source-store', EDGAR_TRANSFER_MANIFEST,
    ...manifest.files.filter(file => !file.path.includes('/')).map(file => file.path)]);
  requireThat((await readdir(destination)).every(name => allowed.has(name)), 'DOWNLOAD_DIRECTORY_IN_USE',
    'The native receiving directory contains another application.');
  for (const part of ['client', 'source-store', 'source-store/editions', 'source-store/blobs'])
    await privateDirectory(join(destination, part));
  for (const file of manifest.files) {
    const source = join(transportDirectory, file.name), target = join(destination, file.path);
    await verified(source, file);
    try { await link(source, target); }
    catch (error) {
      if (error.code === 'EEXIST') await verified(target, file);
      else if (error.code === 'EXDEV') {
        try { await writeBytes(target, await bytes(source, file.bytes), { exclusive: true }); }
        catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; await verified(target, file); }
      } else throw error;
    }
  }
  try { await writeBytes(join(destination, EDGAR_TRANSFER_MANIFEST), manifestBytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    requireThat((await bytes(join(destination, EDGAR_TRANSFER_MANIFEST), 65000)).equals(manifestBytes),
      'DOWNLOAD_EXPORT_CHANGED', 'This native directory belongs to another source export.');
  }
  return destination;
}
async function originalMerchant(directory, manifest) {
  const [{ readEdgarMerchant }, { openEdgarStore }] = await Promise.all([
    import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/config.mjs'),
    import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/source.mjs'),
  ]);
  const compiled = await readEdgarMerchant(join(directory, 'merchant.json'));
  requireThat(compiled.inputSha256 === manifest.inputSha256 &&
    hash(JSON.stringify(compiled.config)) === manifest.configSha256, 'DOWNLOAD_EXPORT_CHANGED',
    'The original received merchant configuration differs from the saved revision.');
  const nativeBytes = await bytes(join(directory, 'manifest.json'), 1048576);
  requireThat(hash(nativeBytes) === manifest.nativeManifestSha256, 'DOWNLOAD_EXPORT_CHANGED',
    'The native merchant export manifest changed.');
  const original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(nativeBytes));
  requireThat(original.schema === 'stellar-forge.sec-edgar-merchant-export.v1' &&
    original.inputSha256 === compiled.inputSha256 && original.sourceStore === 'source-store',
    'DOWNLOAD_EXPORT_CHANGED', 'The original merchant manifest does not match its saved configuration.');
  const source = await openEdgarStore(join(directory, 'source-store'));
  try {
    const products = [];
    for (const product of compiled.products) {
      const result = await source.query(product.editionId, product, product.example);
      products.push({ id: product.id, editionId: product.editionId, sourceSha256: product.sourceSha256,
        totalMatched: result.body.totalMatched, firstPageRows: result.body.totalReturned });
    }
    return { merchant: join(directory, 'merchant.json'), sourceStore: join(directory, 'source-store'),
      client: join(directory, 'client/seller-client.mjs'), inputSha256: compiled.inputSha256, products };
  } finally { await source.close(); }
}

/** Resume the original byte download, then reopen the exact native export. */
export async function downloadEdgarExport({ workspace, exportId, directory, expectedManifestSha256, client, ...options } = {}) {
  identity(workspace, exportId);
  requireThat(typeof directory === 'string' && directory && resolve(directory) !== '/' &&
    HASH.test(expectedManifestSha256 ?? ''), 'DOWNLOAD_CONFIGURATION',
    'Choose a private output directory and the reviewed complete transfer manifest SHA256.');
  const root = resolve(directory), nativeTransport = transport(workspace, client);
  await privateDirectory(root);
  requireThat((await readdir(root)).every(name => ['transport', 'merchant'].includes(name)),
    'DOWNLOAD_DIRECTORY_IN_USE', 'Choose an empty receiving directory or this same existing download.');
  const transportDirectory = join(root, 'transport');
  const result = await nativeTransport.download({ ...options, exportId, directory: transportDirectory, expectedManifestSha256 });
  return nativeTransport.lockedDownload(transportDirectory, async () => {
    const manifestBytes = await bytes(join(transportDirectory, EDGAR_TRANSFER_MANIFEST), 65000);
    requireThat(hash(manifestBytes) === expectedManifestSha256, 'DOWNLOAD_EXPORT_CHANGED', 'The reviewed transfer manifest changed.');
    const manifest = parseEdgarTransfer(manifestBytes, exportId);
    const merchantDirectory = await materializeNative(root, transportDirectory, manifest, manifestBytes);
    return { ...result, workspace, directory: root, merchantDirectory, ...await originalMerchant(merchantDirectory, manifest) };
  });
}

/** Offline reopening uses the original native compiler and exact source queries. */
export async function reopenEdgarExport({ directory } = {}) {
  requireThat(typeof directory === 'string' && directory && resolve(directory) !== '/',
    'DOWNLOAD_CONFIGURATION', 'Choose this same private receiving directory.');
  const root = resolve(directory), merchantDirectory = join(root, 'merchant');
  const manifestBytes = await bytes(join(merchantDirectory, EDGAR_TRANSFER_MANIFEST), 65000);
  const manifest = parseEdgarTransfer(manifestBytes);
  for (const file of manifest.files) await verified(join(merchantDirectory, file.path), file);
  return { schema: 'stellar-forge.sec-edgar-reopened-export.v1', state: 'COMPLETE', directory: root,
    merchantDirectory, exportId: manifest.exportId, workspaceId: manifest.workspaceId, revision: manifest.revision,
    manifestSha256: hash(manifestBytes), nativeManifestSha256: manifest.nativeManifestSha256,
    files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    ...await originalMerchant(merchantDirectory, manifest) };
}
const HELP = 'SEC EDGAR complete merchant receiving\n\n' +
  '  inspect --url MCP_URL --workspace ALIAS --export ID [--token-env NAME]\n' +
  '  download --url MCP_URL --workspace ALIAS --export ID --manifest-sha256 SHA --out PRIVATE_DIRECTORY [--token-env NAME --chunk-size BYTES]\n' +
  '  reopen --out EXISTING_RECEIVING_DIRECTORY\n\n' +
  'Use the original merchant MCP bearer token environment variable. Repeating download\n' +
  'continues its verified saved prefix and reopens the same original merchant package.\n' +
  'reopen operates the original received compiler and source store entirely offline.\n';
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help')) { process.stdout.write(HELP); return; }
  const [command, ...rest] = argv, values = {};
  requireThat(['inspect', 'download', 'reopen'].includes(command), 'DOWNLOAD_CONFIGURATION', HELP);
  const allowed = new Set(command === 'reopen' ? ['--out'] :
    ['--url', '--workspace', '--export', '--token-env', ...(command === 'download' ? ['--manifest-sha256', '--out', '--chunk-size'] : [])]);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    requireThat(allowed.has(key) && typeof value === 'string' && value.length > 0 && !value.startsWith('--') &&
      !Object.hasOwn(values, key), 'DOWNLOAD_CONFIGURATION', 'Supply each declared command option once with its value.');
    values[key] = value;
  }
  const options = { url: values['--url'], workspace: values['--workspace'], exportId: values['--export'],
    tokenEnv: values['--token-env'], directory: values['--out'], expectedManifestSha256: values['--manifest-sha256'] };
  if (values['--chunk-size'] !== undefined) {
    requireThat(/^[1-9]\d*$/.test(values['--chunk-size']), 'DOWNLOAD_CONFIGURATION', 'Use an integer chunk size.');
    options.chunkSize = Number(values['--chunk-size']);
  }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = command === 'inspect' ? await inspectEdgarExport({ ...options, signal: controller.signal }) :
      command === 'download' ? await downloadEdgarExport({ ...options, signal: controller.signal }) :
        await reopenEdgarExport(options);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'EDGAR_DOWNLOAD_FAILED', message: error.message }) + '\n'); process.exitCode = 1; });
