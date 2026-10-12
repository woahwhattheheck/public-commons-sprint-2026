#!/usr/bin/env node
// MIT. Original direct-store delivery controls, retained download and receiving.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJSON } from '../sf98-merchant-delivery/destinations/storage.mjs';
import { createReleaseDeliveryConsole } from './release-delivery-console.mjs';
import { createReleaseDeliveryFileClient, downloadDeliveryExchange, reopenDeliveryDownload, receiveDeliveryDownload }
  from '../../../stellar-forge/mcp-merchant-operator/delivery-download.mjs';

const USAGE = 'Single-merchant settlement delivery\n\n' +
  '  status --store DIR\n' +
  '  control --store DIR --action enroll|pause|sync|drain|stop|requeue --input PRIVATE_JSON\n' +
  '  run --store DIR [--input PRIVATE_WORKER_OPTIONS_JSON]\n' +
  '  events --store DIR --id DESTINATION [--state ALL --offset 0 --limit 50]\n' +
  '  handoff --store DIR\n' +
  '  transfers --store DIR [--after TRANSFER_ID --limit 25]\n' +
  '  transfer --store DIR --id TRANSFER_ID --source-fingerprint SHA256\n' +
  '  manifest --store DIR --id TRANSFER_ID [--fingerprint SHA256]\n' +
  '  download (--store DIR | --url MCP_URL) --id TRANSFER_ID --fingerprint SHA256 --directory PRIVATE_DIRECTORY\n' +
  '           [--token-env MCP_ACCESS_TOKEN --chunk-size 196608]\n' +
  '  reopen --directory DOWNLOAD_DIRECTORY --id TRANSFER_ID --fingerprint SHA256\n' +
  '  receive --directory DOWNLOAD_DIRECTORY --id TRANSFER_ID --fingerprint SHA256 --workspace NEW_PRIVATE_DIRECTORY\n\n' +
  'Use starforge release-delivery, or node release-cli.mjs delivery COMMAND OPTIONS.\n' +
  'The existing seller initializes its original settlement source on first run.\n' +
  'Control input uses the original SF98 fields and environment references. Run owns\n' +
  'the original worker in this foreground process; Ctrl-C closes it and its reads.\n' +
  'Downloads resume the same transfer, endpoint and private directory. exchange/\n' +
  'keeps the original receiver layout; receive uses its reviewed fingerprint.\n';
const allowed = {
  status: ['store'], control: ['store', 'action', 'input'], run: ['store', 'input'],
  events: ['store', 'id', 'state', 'offset', 'limit'], handoff: ['store'],
  transfers: ['store', 'after', 'limit'], transfer: ['store', 'id', 'source-fingerprint'],
  manifest: ['store', 'id', 'fingerprint'],
  download: ['store', 'url', 'id', 'fingerprint', 'directory', 'token-env', 'chunk-size'],
  reopen: ['directory', 'id', 'fingerprint'], receive: ['directory', 'id', 'fingerprint', 'workspace'],
};
const failure = message => Object.assign(new Error(message), { code: 'RELEASE_DELIVERY_CLI_ARGUMENT' });
function parse(argv) {
  const [command, ...rest] = argv;
  if (!command || ['help', '-h', '--help'].includes(command)) return null;
  if (!Object.hasOwn(allowed, command) || rest.length % 2) throw failure(USAGE);
  const input = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index].startsWith('--') ? rest[index].slice(2) : '';
    if (!allowed[command].includes(name) || Object.hasOwn(input, name) || !rest[index + 1])
      throw failure('Unknown, duplicate or empty option: ' + rest[index]);
    input[name] = rest[index + 1];
  }
  for (const name of ['offset', 'limit', 'chunk-size']) if (input[name] !== undefined) {
    if (!/^(0|[1-9]\d*)$/.test(input[name]) || !Number.isSafeInteger(Number(input[name])))
      throw failure('--' + name + ' must be a nonnegative integer.');
    input[name] = Number(input[name]);
  }
  if (command === 'download') {
    if (Boolean(input.store) === Boolean(input.url)) throw failure('Download selects exactly one --store or --url.');
    if (input.store && input['token-env']) throw failure('--token-env belongs to the selected MCP URL.');
  } else if (!['reopen', 'receive'].includes(command) && !input.store) throw failure('Supply --store DIRECTORY.');
  const required = { control: ['action', 'input'], events: ['id'], transfer: ['id', 'source-fingerprint'],
    manifest: ['id'], download: ['id', 'fingerprint', 'directory'],
    reopen: ['id', 'fingerprint', 'directory'], receive: ['id', 'fingerprint', 'directory', 'workspace'] }[command] ?? [];
  for (const key of required) if (!input[key]) throw failure('Supply --' + key + '.');
  if (command === 'control' && input.action === 'start') throw failure('Use run for a foreground delivery worker.');
  return { command, input };
}
export async function main(argv = process.argv.slice(2)) {
  const parsed = parse(argv);
  if (!parsed) { process.stdout.write(USAGE); return { help: true }; }
  const { command, input } = parsed, controller = new AbortController();
  const desk = input.store ? createReleaseDeliveryConsole(resolve(input.store)) : null;
  let stopping;
  const stop = () => {
    controller.abort(new Error('RELEASE_DELIVERY_INTERRUPTED'));
    if (desk && !stopping) { stopping = desk.close(); stopping.catch(() => {}); }
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let result;
  try {
    const downloadOptions = { id: input.id, expectedFingerprint: input.fingerprint,
      directory: input.directory && resolve(input.directory), signal: controller.signal };
    if (command === 'status') result = await desk.status();
    else if (command === 'control') result = await desk.control({ action: input.action,
      input: await readJSON(resolve(input.input), { maxBytes: 32768 }) });
    else if (command === 'run') {
      const settings = input.input ? await readJSON(resolve(input.input), { maxBytes: 32768 }) : {};
      const started = await desk.control({ action: 'start', input: settings });
      process.stdout.write(JSON.stringify(started, null, 2) + '\n');
      result = await desk.waitForWorker();
    } else if (command === 'events') result = await desk.events({ id: input.id,
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}) });
    else if (command === 'handoff') result = await desk.handoff();
    else if (command === 'transfers') result = await desk.transfers({
      ...(input.after !== undefined ? { after: input.after } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}) });
    else if (command === 'transfer') result = await desk.transfer({ id: input.id, expectedSourceFingerprint: input['source-fingerprint'] });
    else if (command === 'manifest') result = await desk.transferManifest({ id: input.id,
      ...(input.fingerprint ? { expectedFingerprint: input.fingerprint } : {}) });
    else if (command === 'download') result = await downloadDeliveryExchange({ ...downloadOptions,
      ...(desk ? { client: createReleaseDeliveryFileClient(desk) } : { url: input.url, tokenEnv: input['token-env'] }),
      ...(input['chunk-size'] !== undefined ? { chunkSize: input['chunk-size'] } : {}) });
    else if (command === 'reopen') result = await reopenDeliveryDownload(downloadOptions);
    else if (command === 'receive') result = await receiveDeliveryDownload({ ...downloadOptions, workspace: resolve(input.workspace) });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    const native = result?.result ?? result;
    if (Array.isArray(native?.results) && native.results.some(item => !item.ok)) process.exitCode = 1;
    return result;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    await desk?.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'RELEASE_DELIVERY_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
