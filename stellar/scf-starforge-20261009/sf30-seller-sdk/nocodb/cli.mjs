// MIT. Discover, capture, import and freeze the original NocoDB source.
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bytes, createFile, privateDirectory, fault } from '../postgres/publisher/files.mjs';
import { readNocoDBSourceFile } from './declaration.mjs';
import { captureNocoDBSource, importNocoDBCapture, readNocoDBCapture, bindNocoDBCapture } from './capture.mjs';
import { discoverNocoDBTable } from './http.mjs';
import { inspectNocoDBSource } from './source.mjs';
import { main as publisherMain } from './publisher/cli.mjs';

const HELP = 'NocoDB source and retained dataset publisher\n\n' +
  '  discover --source PRIVATE_REST_SOURCE.json\n' +
  '  inspect --source PRIVATE_SOURCE.json\n' +
  '  capture --source PRIVATE_REST_SOURCE.json --out NEW_PRIVATE_CAPTURE_DIRECTORY\n' +
  '  import --source PRIVATE_SOURCE.json --capture ORIGINAL_CAPTURE.json --out NEW_PRIVATE_CAPTURE_DIRECTORY\n' +
  '  freeze --source PRIVATE_SOURCE.json --capture ORIGINAL_CAPTURE.json --out NEW_PRIVATE_SOURCE.json\n' +
  '  publisher --help\n' +
  '  deployment --help\n\n' +
  'Discover reads only table metadata; queries may be empty while selecting actual field IDs.\n' +
  'Capture retains the table schema, every original response page, then the schema again.\n' +
  'Import copies one complete original capture without changing its provider history.\n' +
  'Freeze binds that exact capture into a private source; it makes no provider call.\n' +
  'The existing publisher supplies browser/CLI review, versions, schedules and buyer delivery.\n';
function parse(argv) {
  const [command, ...args] = argv, options = {};
  if (!['discover', 'inspect', 'capture', 'import', 'freeze'].includes(command)) throw fault('COMMAND_REQUIRED', HELP);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--source', '--out', '--capture'].includes(key) || Object.hasOwn(options, key) ||
        !args[index + 1] || args[index + 1].startsWith('--')) throw fault('NOCODB_OPTION_INVALID');
    options[key] = resolve(args[++index]);
  }
  const allowed = ['discover', 'inspect'].includes(command) ? ['--source'] : command === 'capture' ?
    ['--source', '--out'] : ['--source', '--capture', '--out'];
  if (!options['--source'] || allowed.includes('--out') && !options['--out'] ||
      allowed.includes('--capture') && !options['--capture'] || Object.keys(options).some(key => !allowed.includes(key)))
    throw fault('NOCODB_REQUIRED_OPTIONS', HELP);
  return { command, options };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  if (argv[0] === 'publisher') return publisherMain(argv.slice(1));
  if (argv[0] === 'deployment') return (await import('./deployment-cli.mjs')).main(argv.slice(1));
  const { command, options } = parse(argv);
  const selected = await readNocoDBSourceFile(options['--source'], { allowUnprojected: command === 'discover' });
  let result;
  if (command === 'discover') result = await discoverNocoDBTable(selected.config);
  if (command === 'inspect') result = await inspectNocoDBSource(options['--source']);
  if (command === 'capture' || command === 'import') {
    await privateDirectory(dirname(options['--out']));
    const capture = command === 'capture' ? await captureNocoDBSource(selected.config, options['--out']) :
      await importNocoDBCapture(options['--capture'], options['--out'], selected.config);
    result = { file: capture.manifestFile, sha256: capture.manifestSha256, ...capture.manifest };
  }
  if (command === 'freeze') {
    const capture = await readNocoDBCapture(options['--capture']); bindNocoDBCapture(capture, selected.config);
    const config = { ...selected.config, connection: { kind: 'capture', file: capture.manifestFile, sha256: capture.manifestSha256 } };
    await privateDirectory(dirname(options['--out'])); await createFile(options['--out'], bytes(config));
    result = { file: options['--out'], sourceSha256: (await readNocoDBSourceFile(options['--out'])).hash,
      captureSha256: capture.manifestSha256 };
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'NOCODB_SOURCE') + ': ' +
    (issue.code ? issue.message : 'Review the selected private inputs.') + '\n'); process.exitCode = 1; });
