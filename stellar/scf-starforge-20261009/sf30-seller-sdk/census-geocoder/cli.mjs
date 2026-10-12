#!/usr/bin/env node
// MIT. One operator command over the retained Census workspace.
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openGeocoderWorkspace } from './workspace.mjs';
import { startGeocoderServer } from './server.mjs';
import { reopenEdition } from './edition.mjs';
import { createFile, fault, object } from '../postgres/publisher/files.mjs';
import { MAX_INPUT_BYTES } from './source.mjs';

const USAGE = "Census address operations\n  starforge dataset geocoder --workspace DIRECTORY init\n  starforge dataset geocoder --workspace DIRECTORY serve [--port 0]\n  starforge dataset geocoder --workspace DIRECTORY status\n  starforge dataset geocoder --workspace DIRECTORY discovery.benchmarks\n  starforge dataset geocoder --workspace DIRECTORY ACTION --input action.json\n  starforge dataset geocoder --workspace DIRECTORY batch.create --input selection.json --csv addresses.csv\n  starforge dataset geocoder --workspace DIRECTORY capture.import --directory CAPTURE_DIRECTORY\n  starforge dataset geocoder --workspace DIRECTORY batch --id BATCH_ID [--category all] [--offset 0] [--limit 100]\n  starforge dataset geocoder --workspace DIRECTORY download --kind input|response|dataset|provenance|manifest --id ID --out FILE\n  starforge dataset geocoder reopen --directory EXPORTED_EDITION\n\nThe same commands are available through node census-geocoder/cli.mjs.\nACTION is an original workspace action from README.md. JSON files contain the\nexact visible review, original IDs and public merchant terms; no signing secrets.\nThe serve command owns its publisher and seller until Ctrl-C. A CLI\npublisher.release.start also stays in the foreground until Ctrl-C, then drains\nthe original seller. Other CLI actions close their workspace after completion.\n";
const FLAGS = new Set(['--workspace', '--input', '--csv', '--directory', '--port', '--id', '--attempt',
  '--category', '--offset', '--limit', '--kind', '--out']);
function parse(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const result = { command: null, options: {} };
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value.startsWith('--')) {
      if (!FLAGS.has(value) || Object.hasOwn(result.options, value) || i + 1 >= args.length || args[i + 1].startsWith('--'))
        throw fault('GEOCODER_CLI_OPTIONS', 'Choose a known option with one value; use --help.');
      result.options[value] = args[++i];
    } else if (result.command) throw fault('GEOCODER_CLI_COMMAND', 'Choose one command; use --help.');
    else result.command = value;
  }
  if (!result.command) throw fault('GEOCODER_CLI_COMMAND', 'Choose a command; use --help.');
  return result;
}
async function inputBytes(path, maximum) {
  const selected = resolve(path), handle = await open(selected, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) throw fault('GEOCODER_CLI_FILE_SIZE');
    const bytes = await handle.readFile(), after = await handle.stat(), current = await lstat(selected);
    if (bytes.length > maximum || before.dev !== current.dev || before.ino !== current.ino ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw fault('GEOCODER_CLI_FILE_CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
export async function main(args = process.argv.slice(2)) {
  const parsed = parse(args); if (parsed.help) { process.stdout.write(USAGE); return; }
  const { command, options } = parsed;
  const allow = extra => {
    const permitted = new Set(['--workspace', ...extra]);
    if (Object.keys(options).some(key => !permitted.has(key))) throw fault('GEOCODER_CLI_OPTIONS', 'An option does not belong to this command.');
  };
  if (command === 'reopen') {
    if (!options['--directory'] || Object.keys(options).some(key => key !== '--directory'))
      throw fault('GEOCODER_CLI_DIRECTORY', 'Use reopen --directory EXPORTED_EDITION.');
    print(await reopenEdition(options['--directory'])); return;
  }
  if (!options['--workspace']) throw fault('GEOCODER_CLI_WORKSPACE', 'Supply --workspace DIRECTORY.');
  if (['init', 'status'].includes(command)) allow([]);
  else if (command === 'serve') allow(['--port']);
  else if (command === 'batch') allow(['--id', '--attempt', '--category', '--offset', '--limit']);
  else if (command === 'download') allow(['--kind', '--id', '--out']);
  else if (command === 'capture.import') allow(['--directory']);
  else allow(['--input', ...(command === 'batch.create' ? ['--csv'] : [])]);
  const workspace = await openGeocoderWorkspace({ directory: options['--workspace'], create: command === 'init' });
  let resource = workspace, resolveStop, stopTask = null;
  const stopped = new Promise(done => { resolveStop = done; });
  const onInterrupt = () => {
    stopTask ??= Promise.resolve().then(() => resource.close());
    void stopTask.catch(() => {}); resolveStop();
  };
  process.once('SIGINT', onInterrupt); process.once('SIGTERM', onInterrupt);
  try {
    if (command === 'serve') {
      const server = await startGeocoderServer({ workspace, port: options['--port'] === undefined ? 0 : Number(options['--port']) });
      resource = server;
      if (!stopTask) print({ directory: workspace.directory, operatorUrl: server.operatorUrl, state: 'RUNNING' });
      await stopped; return;
    }
    if (['init', 'status'].includes(command)) { print(await workspace.status()); return; }
    if (command === 'batch') {
      print(await workspace.inspectBatch(options['--id'], { attemptId: options['--attempt'],
        status: options['--category'] ?? 'all', offset: Number(options['--offset'] ?? 0), limit: Number(options['--limit'] ?? 100) })); return;
    }
    if (command === 'download') {
      if (!options['--out'] || !options['--kind'] || !options['--id']) throw fault('GEOCODER_CLI_DOWNLOAD');
      const file = await workspace.download(options['--kind'], options['--id']);
      await createFile(resolve(options['--out']), file.bytes);
      print({ file: resolve(options['--out']), bytes: file.bytes.length, contentType: file.contentType }); return;
    }
    let payload = options['--input'] ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await inputBytes(options['--input'], 8 * 1024 * 1024))) : {};
    if (!object(payload)) throw fault('GEOCODER_CLI_INPUT', 'The action input must be a JSON object.');
    if (command === 'capture.import') payload = { directory: options['--directory'] };
    if (options['--csv']) {
      if (Object.hasOwn(payload, 'inputText')) throw fault('GEOCODER_CLI_CSV', 'Use --csv or inputText, not both.');
      payload.inputText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await inputBytes(options['--csv'], MAX_INPUT_BYTES));
    }
    const result = await workspace.act(command, payload); print(result);
    if (command === 'publisher.release.start') await stopped;
  } finally {
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onInterrupt);
    const closing = await Promise.allSettled([resource.close(), ...(stopTask ? [stopTask] : [])]);
    const failure = closing.find(item => item.status === 'rejected'); if (failure) throw failure.reason;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('Census geocoder: ' + (error.code ? error.code + ': ' : '') + error.message); process.exitCode = 1; });
