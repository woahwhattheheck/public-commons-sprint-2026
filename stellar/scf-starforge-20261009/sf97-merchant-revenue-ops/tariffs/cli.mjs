#!/usr/bin/env node
/**
 * Local operator for the existing seller, pricing and tariff workspaces.
 * JSON inputs and request identities pass directly to their source-owned operations.
 */
import { readFile, mkdir, open, link, unlink, lstat } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openWorkspace } from '../workspace/model.mjs';
import { openTariffWorkspace } from './workspace.mjs';
import { startTariffServer } from './server.mjs';

export const HELP = [
  'Merchant tariff workspace',
  '',
  'Usage:',
  '  node tariffs/cli.mjs [command] --config SELLER_JSON --state PRICING_DIRECTORY [options]',
  '',
  'The default command is serve. The existing pricing directory also holds tariff plans.',
  '',
  'Source options (snapshot and/or history files, or one operations URL):',
  '  --snapshot FILE       Original seller snapshot',
  '  --history FILE        Original captured observation history',
  '  --ops-url URL         Existing loopback operations service',
  '',
  'Existing pricing integration options:',
  '  --native-outbox PATH  --source-package PATH  --release-store PATH',
  '  --release-runtime FILE  Original release runtime JSON object',
  '',
  'Commands:',
  '  serve                 Start the local merchant console; --port NUMBER defaults to 0',
  '  state                 Print current pricing and tariff state',
  '  source --version ID   Print the selected source version',
  '  preview --input FILE  Calculate a tariff review',
  '  save --input FILE     Save a review with its original requestId and review SHA',
  '  list                  List saved tariff plans',
  '  load --plan ID        Print one saved tariff plan',
  '  select --input FILE   Prepare a saved comparison for the original scenario/pricing flow',
  '  select --plan ID --comparison ID',
  '  commit --input FILE   Commit a complete selection plus two original request UUIDs',
  '  download --plan ID --name FILE --output PATH',
  '                        FILE is plan.json, tariffs.json or comparison.csv',
  '  export                Export the complete tariff bundle',
  '  receive --input FILE  Receive the original complete tariff bundle',
  '  repricing-source --version ID',
  '  repricing-download --decision ID --name FILE --output PATH',
  '  pricing-download --version ID --name FILE --output PATH',
  '                        Receive original pricing/repricing files by their exact names',
  '  repricing-preview --input FILE',
  '  repricing-save --input FILE',
  '  repricing-stage --input FILE',
  '                        Use the original pricing request and ledger bindings',
  '',
  'All non-serve JSON commands print complete JSON, or write --output PATH create-only.',
  '--input - reads one JSON object from stdin. Downloads always require --output.',
  'Use the same explicit request UUIDs when recovering an interrupted original operation.',
  'The serve launch URL includes its private token and is printed only to this console.',
  ''
].join('\n');

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.code = 'TARIFF_CLI_USAGE';
  }
}

const COMMON_FLAGS = new Set([
  'config', 'state', 'snapshot', 'history', 'ops-url',
  'native-outbox', 'source-package', 'release-store', 'release-runtime'
]);
const COMMAND_FLAGS = Object.freeze({
  serve: new Set(['port']),
  state: new Set(['output']),
  source: new Set(['version', 'output']),
  preview: new Set(['input', 'output']),
  save: new Set(['input', 'output']),
  list: new Set(['output']),
  load: new Set(['plan', 'output']),
  select: new Set(['input', 'plan', 'comparison', 'output']),
  commit: new Set(['input', 'output']),
  download: new Set(['plan', 'name', 'output']),
  export: new Set(['output']),
  receive: new Set(['input', 'output']),
  'repricing-source': new Set(['version', 'output']),
  'repricing-download': new Set(['decision', 'name', 'output']),
  'pricing-download': new Set(['version', 'name', 'output']),
  'repricing-preview': new Set(['input', 'output']),
  'repricing-save': new Set(['input', 'output']),
  'repricing-stage': new Set(['input', 'output'])
});
const INPUT_COMMANDS = new Set([
  'preview', 'save', 'commit', 'receive',
  'repricing-preview', 'repricing-save', 'repricing-stage'
]);
const DOWNLOAD_NAMES = new Set(['plan.json', 'tariffs.json', 'comparison.csv']);

function parseArguments(argv) {
  if (!Array.isArray(argv)) throw new UsageError('Arguments must be an array');
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    return { help: true };
  }
  const pending = argv.slice();
  let command = 'serve';
  if (pending.length && !pending[0].startsWith('-')) command = pending.shift();
  if (!Object.hasOwn(COMMAND_FLAGS, command)) throw new UsageError('Unknown command: ' + command);
  const flags = Object.create(null);
  while (pending.length) {
    const word = pending.shift();
    if (!word.startsWith('--') || word === '--') {
      throw new UsageError('Unexpected argument: ' + word);
    }
    const separator = word.indexOf('=');
    const name = word.slice(2, separator === -1 ? undefined : separator);
    if (!COMMON_FLAGS.has(name) && !COMMAND_FLAGS[command].has(name)) {
      throw new UsageError('Unsupported option for ' + command + ': --' + name);
    }
    if (Object.hasOwn(flags, name)) throw new UsageError('Option repeated: --' + name);
    const value = separator === -1 ? pending.shift() : word.slice(separator + 1);
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
      throw new UsageError('A value is required for --' + name);
    }
    flags[name] = value;
  }
  for (const name of ['config', 'state']) {
    if (!flags[name]) throw new UsageError('--' + name + ' is required');
  }
  if (!flags.snapshot && !flags.history && !flags['ops-url']) {
    throw new UsageError('Supply --snapshot and/or --history, or --ops-url');
  }
  if (flags['ops-url'] && (flags.snapshot || flags.history)) {
    throw new UsageError('--ops-url uses the live source; saved snapshot/history files are a separate source selection');
  }
  if (INPUT_COMMANDS.has(command) && !flags.input) throw new UsageError('--input is required for ' + command);
  if (['source', 'repricing-source', 'pricing-download'].includes(command) && !flags.version) {
    throw new UsageError('--version is required for ' + command);
  }
  if (command === 'repricing-download' && !flags.decision) {
    throw new UsageError('--decision is required for repricing-download');
  }
  if (['load', 'download'].includes(command) && !flags.plan) throw new UsageError('--plan is required for ' + command);
  if (command === 'select') {
    if (flags.input && (flags.plan || flags.comparison)) {
      throw new UsageError('Select uses --input or the --plan and --comparison pair');
    }
    if (!flags.input && (!flags.plan || !flags.comparison)) {
      throw new UsageError('Select requires --input or both --plan and --comparison');
    }
  }
  if (command === 'download') {
    if (!DOWNLOAD_NAMES.has(flags.name)) {
      throw new UsageError('--name must be plan.json, tariffs.json or comparison.csv');
    }
    if (!flags.output) throw new UsageError('--output is required for download');
  }
  if (['repricing-download', 'pricing-download'].includes(command) && (!flags.name || !flags.output)) {
    throw new UsageError('--name and --output are required for ' + command);
  }
  if (flags.port !== undefined && (!/^(0|[1-9][0-9]*)$/.test(flags.port)
      || Number(flags.port) > 65535)) {
    throw new UsageError('--port must be an integer from 0 through 65535');
  }
  return { command, flags, help: false };
}

async function readInput(filename) {
  let raw;
  if (filename === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    raw = Buffer.concat(chunks).toString('utf8');
  } else {
    raw = await readFile(resolve(filename), 'utf8');
  }
  let value;
  try { value = JSON.parse(raw); }
  catch (cause) { throw new UsageError('Input is not valid JSON: ' + cause.message); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UsageError('Input must be one JSON object');
  }
  return value;
}

/** Publish a complete file atomically; an existing output is always preserved. */
async function writeCreateOnly(filename, content) {
  const target = resolve(filename);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, '.' + basename(target) + '.tariff-' + randomUUID() + '.tmp');
  let created = false;
  let failure;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // A hard link creates the destination only when it does not already exist.
    await link(temporary, target);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (created) {
      try { await unlink(temporary); }
      catch (error) {
        if (error.code !== 'ENOENT' && !failure) throw error;
      }
    }
  }
}

function writeText(stream, text) {
  return new Promise(function (resolveWrite, rejectWrite) {
    stream.write(text, function (error) { if (error) rejectWrite(error); else resolveWrite(); });
  });
}

async function requireUnusedOutput(filename) {
  if (!filename) return;
  try { await lstat(resolve(filename)); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const error = new Error('Output already exists: ' + resolve(filename));
  error.code = 'EEXIST';
  throw error;
}

async function emitJson(value, output) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new Error('The workspace operation returned no JSON result');
  const text = serialized + '\n';
  if (output) {
    try { await writeCreateOnly(output, text); }
    catch (error) {
      // The original workspace operation already returned. Keep its full result
      // available even if the selected output volume or path cannot receive it.
      error.operationResult = value;
      throw error;
    }
  } else await writeText(process.stdout, text);
}

async function workspaceOptions(flags) {
  const result = {
    config: resolve(flags.config),
    directory: resolve(flags.state)
  };
  const paths = {
    snapshot: 'snapshot',
    history: 'history',
    'native-outbox': 'nativeOutbox',
    'source-package': 'sourcePackage',
    'release-store': 'releaseStore'
  };
  for (const [flag, property] of Object.entries(paths)) {
    if (flags[flag] !== undefined) result[property] = resolve(flags[flag]);
  }
  if (flags['ops-url'] !== undefined) result.opsUrl = flags['ops-url'];
  if (flags['release-runtime'] !== undefined) {
    result.releaseRuntime = await readInput(resolve(flags['release-runtime']));
  }
  return result;
}

async function serveUntilClosed(workspace, port) {
  const running = await startTariffServer({ workspace, port });
  let closing = false;
  let resolveFinished;
  let rejectFinished;
  const finished = new Promise(function (resolvePromise, rejectPromise) {
    resolveFinished = resolvePromise;
    rejectFinished = rejectPromise;
  });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const cleanup = function () {
    for (const signal of signals) process.removeListener(signal, stop);
    running.server.removeListener('close', onClosed);
    running.server.removeListener('error', onError);
  };
  const onClosed = function () { cleanup(); resolveFinished(); };
  const onError = function (error) {
    cleanup();
    Promise.resolve(running.close()).finally(function () { rejectFinished(error); }).catch(function () {});
  };
  const stop = function () {
    if (closing) return;
    closing = true;
    Promise.resolve().then(function () { return running.close(); }).then(function () {
      cleanup();
      resolveFinished();
    }, function (error) {
      cleanup();
      rejectFinished(error);
    });
  };
  running.server.once('close', onClosed);
  running.server.once('error', onError);
  for (const signal of signals) process.once(signal, stop);
  try {
    await writeText(process.stdout, running.url + '\n');
    await finished;
  } finally {
    cleanup();
    if (running.server.listening) await running.close();
  }
}

export async function runTariffCli(argv = process.argv.slice(2)) {
  const parsed = parseArguments(argv);
  if (parsed.help) { await writeText(process.stdout, HELP); return; }
  const { command, flags } = parsed;
  await requireUnusedOutput(flags.output);
  // Read user payloads before opening mutable workspace storage.
  const input = flags.input ? await readInput(flags.input) : undefined;
  const directory = resolve(flags.state);
  const model = await openWorkspace(await workspaceOptions(flags));
  // The tariff owner derives tariff-plans and scenario-plans inside this same state.
  const workspace = await openTariffWorkspace({ model, directory });
  if (command === 'serve') {
    await serveUntilClosed(workspace, flags.port === undefined ? 0 : Number(flags.port));
    return;
  }
  let result;
  switch (command) {
    case 'state': result = await workspace.state(); break;
    case 'source': result = await workspace.source(flags.version); break;
    case 'preview': result = await workspace.preview(input); break;
    case 'save': result = await workspace.save(input); break;
    case 'list': result = await workspace.list(); break;
    case 'load': result = await workspace.load(flags.plan); break;
    case 'select':
      result = await workspace.selection(input || { planId: flags.plan, comparisonId: flags.comparison });
      break;
    case 'commit': result = await workspace.commitSelection(input); break;
    case 'download': {
      const bytes = await workspace.download(flags.plan, flags.name);
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw new Error('The workspace download did not return bytes');
      }
      await writeCreateOnly(flags.output, bytes);
      return;
    }
    case 'repricing-source': result = await workspace.repricingSource(flags.version); break;
    case 'repricing-download':
    case 'pricing-download': {
      const bytes = command === 'repricing-download'
        ? await workspace.downloadRepricing(flags.decision, flags.name)
        : await workspace.downloadPricing(flags.version, flags.name);
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw new Error('The original pricing download did not return bytes');
      }
      await writeCreateOnly(flags.output, bytes);
      return;
    }
    case 'export': result = await workspace.bundle(); break;
    case 'receive': result = await workspace.receive(input); break;
    case 'repricing-preview': result = await workspace.previewRepricing(input); break;
    case 'repricing-save': result = await workspace.saveRepricing(input); break;
    case 'repricing-stage': result = await workspace.stageRepricing(input); break;
    default: throw new UsageError('Unknown command: ' + command);
  }
  await emitJson(result, flags.output);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runTariffCli().catch(async function (error) {
    const detail = {
      code: typeof error.code === 'string' ? error.code : 'TARIFF_CLI_FAILED',
      message: error.message || String(error)
    };
    if (Number.isInteger(error.status)) detail.status = error.status;
    if (error.details !== undefined) detail.details = error.details;
    const failure = { error: detail };
    if (Object.hasOwn(error, 'operationResult')) failure.operationResult = error.operationResult;
    try { await writeText(process.stderr, JSON.stringify(failure) + '\n'); }
    finally { process.exitCode = 1; }
  });
}
