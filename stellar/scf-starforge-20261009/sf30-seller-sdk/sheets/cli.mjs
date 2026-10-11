// MIT. Prepare private Sheets sources for the original typed publisher.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bytes, createFile, readJson, fault } from '../postgres/publisher/files.mjs';
import { compileQueries, only, readSheetsSourceFile } from './declaration.mjs';
import { importSheetsCapture, readSheetsCapture, fetchSheetsResource, retainSheetsCapture } from './capture.mjs';
import { inspectSheetsSource } from './source.mjs';

const HELP = `Google Sheets merchant source (Node 22.16+; publisher also requires Linux flock)

  workspace serve --directory PRIVATE_SOURCE_WORKSPACE [--create] [--connections PRIVATE_CONNECTIONS.json]
  workspace --help
  auth connect|status|refresh|disconnect --directory PRIVATE_CONNECTION [AUTH_OPTIONS]
  use-connection --source REVIEWED_SOURCE.json --connection PRIVATE_CONNECTION --out NEW_LIVE_SOURCE.json
  import --resource PRIVATE_SPREADSHEET_RESOURCE.json --range "'Catalog'!A1:G500" --directory NEW_CAPTURE_DIR
  headers --capture CAPTURE_DIR/capture.json
  prepare --capture CAPTURE_DIR/capture.json --projection REVIEWED_PROJECTION.json --query NAME --out NEW_SOURCE.json
  describe --source SOURCE.json
  capture --source LIVE_SOURCE.json --query NAME --directory NEW_CAPTURE_DIR
  plan --source SOURCE.json --query NAME --out NEW_PLAN.json [--name DATASET_NAME]

Import accepts the original JSON Spreadsheet resource from one connected
spreadsheets.get CellData read, not a values-only array or formatted CSV.
The declared range must be the exact range requested from that provider read.
Capture reads Google with the selected environment token or renewable private connection.
Prepare binds the reviewed letter/header/type/formula projection to exact capture bytes.
Plan writes a correctly typed input template for the original publisher save command.
All files must be private (0600) inside operator-owned private directories (0700).
Existing files and capture directories are never replaced. See sheets/README.md.`;
const OPTIONS = {
  'use-connection': ['--source', '--connection', '--out'],
  import: ['--resource', '--range', '--directory'], headers: ['--capture'],
  prepare: ['--capture', '--projection', '--query', '--out'], describe: ['--source'],
  capture: ['--source', '--query', '--directory'], plan: ['--source', '--query', '--out', '--name'],
};
const required = (options, key) => { if (!options[key]) throw fault('OPTION_REQUIRED', key); return options[key]; };
const path = (options, key) => resolve(required(options, key));
const receipt = capture => ({ ...capture.manifest, manifestFile: capture.manifestFile, manifestSha256: capture.manifestSha256 });
function letters(index) {
  let text = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text;
  return text;
}
export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'workspace') return (await import('./workspace/cli.mjs')).main(argv.slice(1));
  if (argv[0] === 'auth') return (await import('./auth/cli.mjs')).main(argv.slice(1));
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  const [command, ...args] = argv, options = {};
  if (!OPTIONS[command]) throw fault('COMMAND_REQUIRED', HELP);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!OPTIONS[command].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--')) throw fault('INVALID_OPTION', key);
    options[key] = value;
  }
  let result;
  if (command === 'use-connection') {
    const selected = await readSheetsSourceFile(path(options, '--source'));
    const directory = path(options, '--connection');
    const { googleConnectionStatus } = await import('./auth/oauth.mjs');
    const status = await googleConnectionStatus(directory);
    if (status.state !== 'connected') throw fault('SHEETS_OAUTH_RECONNECT_REQUIRED', 'Connect and approve an account before binding it to this reviewed source.');
    const config = structuredClone(selected.config);
    config.connection = { kind: 'google', oauthDirectory: directory,
      ...(selected.config.connection.maxResponseBytes ? { maxResponseBytes: selected.config.connection.maxResponseBytes } : {}),
      ...(selected.config.connection.timeoutMs ? { timeoutMs: selected.config.connection.timeoutMs } : {}) };
    const output = path(options, '--out'); await createFile(output, bytes(config));
    result = { sourceFile: output, account: status.account, ...await inspectSheetsSource(output) };
  }
  if (command === 'import') result = receipt(await importSheetsCapture(path(options, '--resource'), path(options, '--directory'), { range: required(options, '--range') }));
  if (command === 'headers') {
    const capture = await readSheetsCapture(path(options, '--capture')), { bounds, cell } = capture.grid;
    const columns = [];
    for (let column = bounds.startColumn; column < bounds.endColumn; column++) {
      const observed = { string: 0, number: 0, boolean: 0, blank: 0, error: 0, formula: 0, unsafeInteger: 0 };
      for (let row = bounds.startRow + 1; row < bounds.endRow; row++) {
        const data = cell(row, column), value = data.effectiveValue;
        if (data.userEnteredValue?.formulaValue !== undefined) observed.formula++;
        if (value?.errorValue !== undefined) observed.error++;
        else if (value?.stringValue !== undefined) observed.string++;
        else if (value?.boolValue !== undefined) observed.boolean++;
        else if (value?.numberValue !== undefined) {
          observed.number++;
          if (Number.isInteger(value.numberValue) && !Number.isSafeInteger(value.numberValue)) observed.unsafeInteger++;
        } else observed.blank++;
      }
      columns.push({ column: letters(column), header: cell(bounds.startRow, column).effectiveValue?.stringValue ?? null, observed });
    }
    result = { capture: receipt(capture), columns };
  }
  if (command === 'prepare') {
    const capture = await readSheetsCapture(path(options, '--capture'));
    const projection = await readJson(path(options, '--projection'));
    only(projection, ['columns', 'range', 'emptyRows'], 'SHEETS_PROJECTION_INVALID');
    const name = required(options, '--query');
    const config = { schema: 'stellar-forge.sheets-source.v1', spreadsheetId: capture.manifest.spreadsheetId,
      connection: { kind: 'capture', file: capture.manifestFile, sha256: capture.manifestSha256 },
      queries: { [name]: { sheetId: capture.manifest.sheetId, sheetTitle: capture.grid.bounds.title,
        range: projection.range ?? capture.grid.bounds.a1, columns: projection.columns, emptyRows: projection.emptyRows ?? 'reject' } } };
    const queries = compileQueries(config.queries);
    const { bindSheetsCapture } = await import('./capture.mjs'); bindSheetsCapture(capture, config, queries[name]);
    const output = path(options, '--out'); await createFile(output, bytes(config)); result = { sourceFile: output, ...await inspectSheetsSource(output) };
  }
  if (command === 'describe') result = await inspectSheetsSource(path(options, '--source'));
  if (command === 'capture') {
    const source = await readSheetsSourceFile(path(options, '--source'));
    const query = source.queries[required(options, '--query')]; if (!query) throw fault('QUERY_NOT_FOUND');
    const fetched = await fetchSheetsResource(source.config, query);
    result = receipt(await retainSheetsCapture(fetched.resourceBytes, path(options, '--directory'),
      { range: query.qualifiedRange, transport: 'google-rest', receivedAt: fetched.receivedAt }));
  }
  if (command === 'plan') {
    const source = await readSheetsSourceFile(path(options, '--source')), name = required(options, '--query'), query = source.queries[name];
    if (!query) throw fault('QUERY_NOT_FOUND');
    const value = { title: name + ' reviewed Sheets projection', query: name, input: {}, sourceHash: source.hash,
      dataset: { name: options['--name'] ?? name,
        columns: Object.fromEntries(Object.entries(query.projection).map(([name, spec]) => [name, { type: spec.type, nullable: spec.nullable }])),
        filters: [], ranges: [], sorts: [], defaultLimit: 50, maxLimit: 250 },
      extraction: { order: [{ column: query.columns[0], direction: 'asc' }], maxRows: 250000,
        maxBytes: 67108864, maxRowBytes: 1048576, timeoutMs: 30000 } };
    const output = path(options, '--out'); await createFile(output, bytes(value)); result = { created: output, sourceHash: source.hash };
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write(`${issue.code ?? 'SHEETS_SOURCE'}: ${issue.code ? issue.message : 'Review the selected source.'}\n`); process.exitCode = 1; });
