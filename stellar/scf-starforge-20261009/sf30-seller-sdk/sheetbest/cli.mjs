// MIT. Sheet Best private source intake plus the existing publisher command.
import { dirname, resolve } from 'node:path';
import { lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { bytes, createFile, privateDirectory, fault } from '../postgres/publisher/files.mjs';
import { readSheetBestSourceFile } from './declaration.mjs';
import { importSheetBestCapture, fetchSheetBestRecords, retainSheetBestCapture } from './capture.mjs';
import { inspectSheetBestSource } from './source.mjs';
import { main as publisherMain } from './publisher/cli.mjs';

const HELP = 'Sheet Best source and retained publisher\n\n' +
  '  inspect --source PRIVATE_SOURCE.json\n' +
  '  capture --source PRIVATE_REST_SOURCE.json --out NEW_PRIVATE_CAPTURE_DIRECTORY\n' +
  '  import --source PRIVATE_SOURCE.json --response PRIVATE_RECORDS.json --out NEW_PRIVATE_CAPTURE_DIRECTORY\n' +
  '  freeze --source PRIVATE_REST_SOURCE.json --capture PRIVATE_CAPTURE.json --out NEW_PRIVATE_SOURCE.json\n' +
  '  publisher --help\n\n' +
  'Capture makes one complete read-only GET from the selected existing connection and tab.\n' +
  'Import retains already obtained records bytes and identifies its transport as operator-import.\n' +
  'Freeze binds that exact saved response into a reviewed source. It performs no provider call.\n' +
  'The existing publisher supplies candidate review, native publication, scheduling, browser and buyer delivery.\n';
function parse(argv) {
  const [command, ...args] = argv, options = {};
  if (!['inspect', 'capture', 'import', 'freeze'].includes(command)) throw fault('COMMAND_REQUIRED', HELP);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--source', '--out', '--response', '--capture'].includes(key) || Object.hasOwn(options, key) ||
        !args[index + 1] || args[index + 1].startsWith('--')) throw fault('SHEETBEST_OPTION_INVALID');
    options[key] = resolve(args[++index]);
  }
  if (!options['--source']) throw fault('SHEETBEST_SOURCE_REQUIRED');
  if (command !== 'inspect' && !options['--out']) throw fault('SHEETBEST_OUTPUT_REQUIRED');
  if (command === 'import' && !options['--response'] || command === 'freeze' && !options['--capture']) throw fault('SHEETBEST_INPUT_REQUIRED');
  const allowed = command === 'inspect' ? ['--source'] : command === 'capture' ? ['--source', '--out'] :
    command === 'import' ? ['--source', '--response', '--out'] : ['--source', '--capture', '--out'];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw fault('SHEETBEST_OPTION_NOT_USED');
  return { command, options };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  if (argv[0] === 'publisher') return publisherMain(argv.slice(1));
  const { command, options } = parse(argv);
  const selected = await readSheetBestSourceFile(options['--source']);
  let result;
  if (command === 'inspect') result = await inspectSheetBestSource(options['--source']);
  if (command === 'capture') {
    await privateDirectory(dirname(options['--out']));
    try { await lstat(options['--out']); throw fault('SHEETBEST_CAPTURE_OUTPUT_EXISTS', 'Choose a new private capture directory.'); }
    catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    const { resourceBytes, ...metadata } = await fetchSheetBestRecords(selected.config);
    const capture = await retainSheetBestCapture(resourceBytes, options['--out'], metadata);
    result = { file: capture.manifestFile, sha256: capture.manifestSha256, ...capture.manifest };
  }
  if (command === 'import') {
    const capture = await importSheetBestCapture(options['--response'], options['--out'], selected.binding);
    result = { file: capture.manifestFile, sha256: capture.manifestSha256, ...capture.manifest };
  }
  if (command === 'freeze') {
    const { readSheetBestCapture, bindSheetBestCapture } = await import('./capture.mjs');
    const capture = await readSheetBestCapture(options['--capture']); bindSheetBestCapture(capture, selected.config);
    const config = { ...selected.config, connection: { kind: 'capture', file: capture.manifestFile, sha256: capture.manifestSha256 } };
    await createFile(options['--out'], bytes(config));
    result = { file: options['--out'], sourceSha256: (await readSheetBestSourceFile(options['--out'])).hash,
      captureSha256: capture.manifestSha256 };
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'SHEETBEST_SOURCE') + ': ' +
    (issue.code ? issue.message : 'Review the selected private inputs.') + '\n'); process.exitCode = 1; });
