#!/usr/bin/env node
// MIT. Receive a complete retained Kafka export and reopen the same download.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openKafkaMerchantDownloader, inspectKafkaMerchantDownload } from './merchant-download.mjs';

const HELP = [
  'Kafka merchant downloads',
  '',
  '  starforge kafka-merchant-download inspect --url MCP_URL --workspace ALIAS --artifact SHA',
  '  starforge kafka-merchant-download download --url MCP_URL --workspace ALIAS --artifact SHA',
  '      --directory PRIVATE_DIRECTORY [--manifest-sha256 SHA] [--chunk-size 196608] [--quiet]',
  '  starforge kafka-merchant-download verify --directory PRIVATE_DIRECTORY',
  '      --workspace ALIAS --artifact SHA [--manifest-sha256 SHA]',
  '',
  'Connection: --token-env MCP_ACCESS_TOKEN (the token remains in the host environment).',
  'Selection: --workspace-id UUID and --binding-sha256 SHA pin the original source.',
  'Repeat download with the same endpoint, selection and directory to resume its saved bytes.',
  'verify reads only the completed local manifest, checkpoint and native file.',
  'JSON results go to stdout; transfer progress and errors go to stderr.',
  'Ctrl-C or SIGTERM drains the accepted transfer and retains its durable checkpoint.',
  '',
  'Source entrypoint: node stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/merchant-download-cli.mjs COMMAND ...',
  ''
].join('\n');
const fail = message => Object.assign(new Error(message), { code: 'KAFKA_DOWNLOAD_ARGUMENTS' });
async function emit(stream, value) {
  await new Promise((resolveWrite, reject) => {
    try { stream.write(value, error => error ? reject(error) : resolveWrite()); }
    catch (error) { reject(error); }
  });
}
function argumentsFor(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string'))
    throw fail('Supply an array of command arguments.');
  if (!args.length || args.length === 1 && ['help','--help','-h'].includes(args[0])) return { help: true };
  const [command, ...rest] = args;
  if (!['inspect','download','verify'].includes(command)) throw fail('Choose inspect, download or verify; use --help for complete usage.');
  const common = ['workspace','artifact','manifest-sha256','workspace-id','binding-sha256'];
  const accepted = new Set([...common, ...(command === 'verify' ? ['directory'] : ['url','token-env']),
    ...(command === 'download' ? ['directory','chunk-size','quiet'] : [])]);
  const flags = new Map();
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith('--') || token.length < 3) throw fail('Use a declared --option followed by its value.');
    const name = token.slice(2);
    if (!accepted.has(name) || flags.has(name)) throw fail('Unknown or repeated option: ' + token);
    if (name === 'quiet') { flags.set(name, true); continue; }
    const value = rest[++index];
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw fail('Supply a value for ' + token + '.');
    flags.set(name, value);
  }
  for (const name of ['workspace','artifact', ...(command === 'verify' ? ['directory'] : ['url']),
    ...(command === 'download' ? ['directory'] : [])])
    if (!flags.has(name)) throw fail('Supply --' + name + '.');
  const selection = { workspace: flags.get('workspace'), artifact: flags.get('artifact') };
  if (flags.has('workspace-id')) selection.expectedWorkspaceId = flags.get('workspace-id');
  if (flags.has('binding-sha256')) selection.expectedBindingSha256 = flags.get('binding-sha256');
  const operation = {};
  if (flags.has('manifest-sha256')) operation.expectedManifestSha256 = flags.get('manifest-sha256');
  if (flags.has('directory')) operation.directory = flags.get('directory');
  if (flags.has('chunk-size')) {
    const value = flags.get('chunk-size');
    if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 196608)
      throw fail('Chunk size must be an integer from 1 to 196608.');
    operation.chunkSize = Number(value);
  }
  const connection = { ...selection };
  if (command !== 'verify') connection.url = flags.get('url');
  if (flags.has('token-env')) connection.tokenEnv = flags.get('token-env');
  return { command, selection, connection, operation, quiet: flags.has('quiet') };
}
/** Importable CLI; every signal listener stays until the original IO has drained. */
export async function runKafkaMerchantDownloadCli(args = process.argv.slice(2),
  { stdout = process.stdout, stderr = process.stderr, environment = process.env, signal } = {}) {
  const controller = new AbortController();
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw fail('Use an AbortSignal for CLI cancellation.');
  const lifetime = signal ? AbortSignal.any([signal,controller.signal]) : controller.signal;
  let exit = 0, client, result;
  const interrupt = () => { exit ||= 130; controller.abort(); };
  const terminate = () => { exit ||= 143; controller.abort(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    const parsed = argumentsFor(args);
    if (parsed.help) { await emit(stdout, HELP); return 0; }
    lifetime.throwIfAborted();
    if (parsed.command === 'verify') {
      result = await inspectKafkaMerchantDownload({ ...parsed.selection, ...parsed.operation, signal: lifetime });
    } else {
      client = await openKafkaMerchantDownloader({ ...parsed.connection, environment, signal: lifetime });
      if (parsed.command === 'inspect') {
        const { manifestBytes: _originalBytes, ...view } = await client.inspect({ ...parsed.operation, signal: lifetime });
        result = view;
      } else {
        let lastProgress = 0;
        result = await client.download({ ...parsed.operation, signal: lifetime,
          onProgress: parsed.quiet ? undefined : async progress => {
            const now = Date.now();
            if (lastProgress && progress.bytes < progress.total && now - lastProgress < 1000) return;
            lastProgress = now;
            await emit(stderr, JSON.stringify({ event: 'progress', ...progress }) + '\n');
          } });
      }
    }
    await emit(stdout, JSON.stringify(result, null, 2) + '\n');
    return exit;
  } catch (error) {
    const cancelled = lifetime.aborted;
    const value = { code: cancelled ? 'KAFKA_DOWNLOAD_ABORTED' : error.code ?? 'KAFKA_DOWNLOAD_FAILED',
      message: cancelled ? 'The transfer stopped after retaining its last complete checkpoint. Repeat the same download to continue.'
        : typeof error.message === 'string' ? error.message : 'The selected download could not complete.' };
    await emit(stderr, JSON.stringify(value) + '\n').catch(() => {});
    return exit || (cancelled ? 130 : 1);
  } finally {
    try { await client?.close(); }
    finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await runKafkaMerchantDownloadCli();
