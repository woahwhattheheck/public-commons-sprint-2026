// MIT. Discover, capture, import and freeze the original Baserow source.
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bytes, createFile, privateDirectory, fault } from '../postgres/publisher/files.mjs';
import { readBaserowSourceFile } from './declaration.mjs';
import { captureBaserowSource, importBaserowCapture, readBaserowCapture, bindBaserowCapture, exportBaserowAttachments } from './capture.mjs';
import { discoverBaserowTable } from './http.mjs';
import { inspectBaserowSource } from './source.mjs';
import { main as publisherMain } from './publisher/cli.mjs';

const HELP = 'Baserow source and retained dataset publisher\n\n' +
  '  discover --source PRIVATE_REST_SOURCE.json\n' +
  '  inspect --source PRIVATE_SOURCE.json\n' +
  '  capture --source PRIVATE_REST_SOURCE.json --out NEW_PRIVATE_CAPTURE_DIRECTORY\n' +
  '  import --source PRIVATE_SOURCE.json --capture ORIGINAL_CAPTURE.json --out NEW_PRIVATE_CAPTURE_DIRECTORY\n' +
  '  freeze --source PRIVATE_SOURCE.json --capture ORIGINAL_CAPTURE.json --out NEW_PRIVATE_SOURCE.json\n' +
  '  attachments --capture ORIGINAL_CAPTURE.json --out NEW_PRIVATE_DELIVERY_DIRECTORY\n' +
  '  publisher --help\n' +
  '  deployment --help\n\n' +
  'Discover reads the original public-view or authorized table field metadata; queries may be empty while selecting actual field IDs.\n' +
  'Capture retains original metadata, all original pages, the closing observation and selected files.\n' +
  'Import copies one complete original capture without changing its provider history.\n' +
  'Freeze binds that exact capture into a private source; it makes no provider call.\n' +
  'The existing publisher supplies browser/CLI review, versions, schedules and buyer delivery.\n';
function parse(argv) {
  const [command, ...args] = argv, options = {};
  if (!['discover', 'inspect', 'capture', 'import', 'freeze', 'attachments'].includes(command)) throw fault('COMMAND_REQUIRED', HELP);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--source', '--out', '--capture'].includes(key) || Object.hasOwn(options, key) ||
        !args[index + 1] || args[index + 1].startsWith('--')) throw fault('BASEROW_OPTION_INVALID');
    options[key] = resolve(args[++index]);
  }
  const allowed = command === 'attachments' ? ['--capture', '--out'] : ['discover', 'inspect'].includes(command) ? ['--source'] : command === 'capture' ?
    ['--source', '--out'] : ['--source', '--capture', '--out'];
  if (allowed.includes('--source') && !options['--source'] || allowed.includes('--out') && !options['--out'] ||
      allowed.includes('--capture') && !options['--capture'] || Object.keys(options).some(key => !allowed.includes(key)))
    throw fault('BASEROW_REQUIRED_OPTIONS', HELP);
  return { command, options };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  if (argv[0] === 'publisher') return publisherMain(argv.slice(1));
  if (argv[0] === 'deployment') return (await import('./deployment-cli.mjs')).main(argv.slice(1));
  const { command, options } = parse(argv);
  if (command === 'attachments') {
    const result = await exportBaserowAttachments(options['--capture'], options['--out']);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  const selected = await readBaserowSourceFile(options['--source'], { allowUnprojected: command === 'discover' });
  let result;
  if (command === 'discover') result = await discoverBaserowTable(selected.config);
  if (command === 'inspect') result = await inspectBaserowSource(options['--source']);
  if (command === 'capture' || command === 'import') {
    await privateDirectory(dirname(options['--out']));
    const capture = command === 'capture' ? await captureBaserowSource(selected.config, options['--out']) :
      await importBaserowCapture(options['--capture'], options['--out'], selected.config);
    result = { file: capture.manifestFile, sha256: capture.manifestSha256, ...capture.manifest };
  }
  if (command === 'freeze') {
    const capture = await readBaserowCapture(options['--capture']); bindBaserowCapture(capture, selected.config);
    const config = { ...selected.config, connection: { kind: 'capture', file: capture.manifestFile, sha256: capture.manifestSha256 } };
    await privateDirectory(dirname(options['--out'])); await createFile(options['--out'], bytes(config));
    result = { file: options['--out'], sourceSha256: (await readBaserowSourceFile(options['--out'])).hash,
      captureSha256: capture.manifestSha256 };
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'BASEROW_SOURCE') + ': ' +
    (issue.code ? issue.message : 'Review the selected private inputs.') + '\n'); process.exitCode = 1; });
