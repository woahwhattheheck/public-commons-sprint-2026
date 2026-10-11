// MIT. ArcGIS capture + original retained source publisher commands.
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createArcgisCapture, importArcgisCapture, continueArcgisCapture, captureStatus } from './capture.mjs';
import { openArcgisPublisher, createArcgisSource } from './publisher.mjs';
import { prepareArcgisReceiving, receiveArcgisDelivery } from './receiving.mjs';
import { main as publisherMain } from '../postgres/publisher/cli.mjs';
import { bytes, readJson, createFile, fault } from '../postgres/publisher/files.mjs';

const HELP = `ArcGIS retained dataset publisher (Linux, Node 22.16+, util-linux flock)

  capture --capture NEW_DIR --input CONNECTION.json [--prepare-only]
  capture-import --capture NEW_DIR --input RETAINED_FILES.json [--prepare-only]
  capture-continue --capture DIR [--max-pages NUMBER]
  capture-status --capture DIR
  source-create --capture DIR --out NEW_SOURCE.json [--query records] [--columns COLUMNS.json]
  template --workspace DIR --query NAME --out NEW_PLAN.json
  receiving-plan --workspace DIR --run ID --out NEW_RECEIVING_PLAN.json
  receive --delivery SF100_DIR --plan RECEIVING_PLAN.json --out NEW_FEATURE_SET.json

Then use the original publisher commands:
  serve --workspace DIR --create --source SOURCE.json --state DATASET_DIR [--port 8457]
  init --workspace NEW_DIR --source SOURCE.json --state DATASET_DIR
  save --workspace DIR --input REVIEWED_PLAN.json
  extract --workspace DIR --plan NUMBER
  inspect --workspace DIR --run ID [--query 'limit=20']
  review --workspace DIR --run ID --reviewer NAME --note TEXT --initialize
  publish --workspace DIR --run ID --review REVIEW_ID
  status, source, recover, buyer and all original schedule commands.

Capture settings and original responses are retained under one capture identity.
Continue resumes that selection and reads only pending pages. Live values across
responses are an observation, not a database transaction. File imports retain their
exact representation and cover the supplied files. Use the local publisher UI for
typed field selection, candidate review, original publication and buyer preparation.
Source configuration pins the complete capture digest; refreshes create a new source
capture and reviewed source plan. See README.md for the complete receiving workflow.`;
const CUSTOM = new Set(['capture', 'capture-import', 'capture-continue', 'capture-status', 'source-create', 'template', 'receiving-plan', 'receive']);
function parse(args) {
  const options = {}, allowed = new Set(['--capture', '--input', '--prepare-only', '--max-pages', '--out', '--query', '--columns', '--workspace', '--run', '--delivery', '--plan']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || Object.hasOwn(options, key)) throw fault('INVALID_OPTION', key);
    if (key === '--prepare-only') { options[key] = true; continue; }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw fault('OPTION_VALUE_REQUIRED', key);
    options[key] = args[++i];
  }
  return options;
}
function required(options, key) { if (!options[key]) throw fault('OPTION_REQUIRED', key); return options[key]; }
const print = result => process.stdout.write(JSON.stringify(result, null, 2) + '\n');
async function template(options) {
  const publisher = await openArcgisPublisher({ directory: resolve(required(options, '--workspace')) });
  try {
    const source = await publisher.source(), name = required(options, '--query'), query = source.queries[name];
    if (!query) throw fault('QUERY_NOT_FOUND');
    const value = { title: name + ' source edition', query: name, input: {}, sourceHash: source.hash,
      dataset: { name, columns: Object.fromEntries(query.columnTypes.map(item => [item.name, { type: item.type, nullable: item.nullable }])),
        filters: [], ranges: [], sorts: [], maxCellChars: 1048576, defaultLimit: 20, maxLimit: 250 },
      extraction: { order: [{ column: query.columns[0], direction: 'asc' }], maxRows: 250000,
        maxBytes: 67108864, maxRowBytes: 8388608, timeoutMs: 120000 } };
    const path = resolve(required(options, '--out')); await createFile(path, bytes(value));
    return { created: path, sourceHash: source.hash };
  } finally { await publisher.close(); }
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  const [command, ...args] = argv;
  if (!CUSTOM.has(command)) return publisherMain(argv, { openPublisher: openArcgisPublisher, sourceName: 'ArcGIS', defaultPort: 8457 });
  const options = parse(args);
  let result;
  if (command === 'template') result = await template(options);
  else if (command === 'receiving-plan') {
    const publisher = await openArcgisPublisher({ directory: resolve(required(options, '--workspace')) });
    try { result = await prepareArcgisReceiving({ publisher, run: required(options, '--run'), output: resolve(required(options, '--out')) }); }
    finally { await publisher.close(); }
  }
  else if (command === 'receive') result = await receiveArcgisDelivery({
    deliveryDirectory: resolve(required(options, '--delivery')), planFile: resolve(required(options, '--plan')),
    output: resolve(required(options, '--out')) });
  else {
    const directory = resolve(required(options, '--capture'));
    if (command === 'capture' || command === 'capture-import') {
      const input = resolve(required(options, '--input')), settings = await readJson(input), base = dirname(input);
      if (command === 'capture') result = await createArcgisCapture({ ...settings, directory });
      else {
        if (typeof settings.metadataFile !== 'string' || !Array.isArray(settings.pageFiles)) throw fault('ARCGIS_IMPORT_FILES_REQUIRED');
        const geometryJoin = settings.geometryJoin ? { ...settings.geometryJoin,
          pageFiles: settings.geometryJoin.pageFiles.map(file => resolve(base, file)) } : null;
        result = await importArcgisCapture({ ...settings, directory, metadataFile: resolve(base, settings.metadataFile),
          pageFiles: settings.pageFiles.map(file => resolve(base, file)), geometryJoin });
      }
      if (!options['--prepare-only']) result = await continueArcgisCapture(directory);
    }
    if (command === 'capture-continue') {
      const supplied = options['--max-pages'];
      if (supplied !== undefined && !/^[1-9][0-9]*$/.test(supplied)) throw fault('ARCGIS_CONTINUE_LIMIT_INVALID');
      result = await continueArcgisCapture(directory, { maxPages: supplied === undefined ? Infinity : Number(supplied) });
    }
    if (command === 'capture-status') result = await captureStatus(directory);
    if (command === 'source-create') result = await createArcgisSource({ captureDirectory: directory,
      output: resolve(required(options, '--out')), query: options['--query'] ?? 'records',
      columns: options['--columns'] ? await readJson(resolve(options['--columns'])) : undefined });
  }
  print(result); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    process.stderr.write((issue.code ?? 'ARCGIS_OPERATION_FAILED') + ': ' +
      (issue.code ? issue.message : 'Review the selected source configuration and retained capture.') + '\n');
    process.exitCode = 1;
  });

