#!/usr/bin/env node
// MIT. Native Huwise / Opendatasoft source, merchant and customer commands.
import { resolve } from 'node:path';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openOpendatasoftWorkbench } from './engine.mjs';
import { captureOpendatasoftDataset, readOpendatasoftCapture,
  importOpendatasoftResponses, searchOpendatasoft } from './capture.mjs';
import { startOpendatasoftServer } from './workspace/server.mjs';

export const usage = [
  'Huwise / Opendatasoft data workspace',
  '',
  'Setup and catalog',
  '  opendatasoft init --project DIR --origin https://public.opendatasoft.com [--auth-token-env NAME]',
  '  opendatasoft serve --project DIR [--port 0]',
  '  opendatasoft status --project DIR',
  '  opendatasoft search --project DIR [--input query.json]',
  '  opendatasoft search --origin URL [--input query.json] [--auth-token-env NAME]',
  '  opendatasoft dataset --project DIR --dataset DATASET_ID',
  '  opendatasoft records --project DIR --dataset DATASET_ID [--input query.json]',
  '',
  'Retain and receive complete provider exports',
  '  opendatasoft capture --project DIR --input selection.json',
  '  opendatasoft capture-source --selection selection.json --out DIR [--limits limits.json]',
  '  opendatasoft import-responses --input responses.json --out DIR [--limits limits.json]',
  '  opendatasoft inspect-capture --capture DIR/capture.json',
  '  opendatasoft import --project DIR --capture DIR/capture.json',
  '  opendatasoft resume --project DIR --id EDITION_ID [--input limits.json]',
  '',
  'Research and handoff',
  '  opendatasoft edition --project DIR --id EDITION_ID',
  '  opendatasoft rows --project DIR --id EDITION_ID [--offset 0] [--limit 100]',
  '  opendatasoft facets --project DIR --id EDITION_ID --field FIELD [--mode value|members] [--limit 50]',
  '  opendatasoft notes --project DIR --id EDITION_ID --input notes.json',
  '  opendatasoft compare --project DIR --before EDITION_ID --after EDITION_ID --key FIELD',
  '  opendatasoft export-edition --project DIR --id EDITION_ID --format json|csv|geojson|html --out FILE [--geometry-field FIELD]',
  '',
  'Original dataset publisher, merchant release and buyer',
  '  opendatasoft select --project DIR --id EDITION_ID --input source.json',
  '  opendatasoft prepare --project DIR --id SOURCE_ID [--input policy.json]',
  '  opendatasoft inspect --project DIR --id PUBLICATION_ID [--query QUERY_STRING]',
  '  opendatasoft review --project DIR --id PUBLICATION_ID --input review.json',
  '  opendatasoft recover --project DIR --id PUBLICATION_ID',
  '  opendatasoft publish --project DIR --id PUBLICATION_ID --review-id REVIEW_ID',
  '  opendatasoft export --project DIR --id PUBLICATION_ID --input merchant.json',
  '  opendatasoft stage --project DIR --id EXPORT_ID --input release.json',
  '  opendatasoft offer --project DIR --id EXPORT_ID --input offer.json',
  '  opendatasoft buyer --project DIR --id EXPORT_ID --input buyer.json',
  '',
  'Use --help with any command. huwise is an alias of opendatasoft.',
  'JSON inputs use the same fields as the browser workspace and the public engine.',
  'Complete captures use /exports/json. The records command is an interactive preview.',
  'Project mutations finish and persist their result before the command exits.',
  'export-edition creates a new file; choose another path for a revised handoff.',
].join('\n');

const commandOptions = {
  init: ['project', 'origin', 'auth-token-env'],
  serve: ['project', 'port'],
  status: ['project'],
  search: ['project', 'origin', 'auth-token-env', 'input'],
  dataset: ['project', 'dataset'],
  records: ['project', 'dataset', 'input'],
  capture: ['project', 'input'],
  'capture-source': ['selection', 'out', 'limits'],
  'import-responses': ['input', 'out', 'limits'],
  'inspect-capture': ['capture'],
  import: ['project', 'capture'],
  resume: ['project', 'id', 'input'],
  edition: ['project', 'id'],
  rows: ['project', 'id', 'offset', 'limit'],
  facets: ['project', 'id', 'field', 'mode', 'limit'],
  notes: ['project', 'id', 'input'],
  compare: ['project', 'before', 'after', 'key'],
  'export-edition': ['project', 'id', 'format', 'out', 'geometry-field'],
  select: ['project', 'id', 'input'],
  prepare: ['project', 'id', 'input'],
  inspect: ['project', 'id', 'query'],
  review: ['project', 'id', 'input'],
  recover: ['project', 'id'],
  publish: ['project', 'id', 'review-id'],
  export: ['project', 'id', 'input'],
  stage: ['project', 'id', 'input'],
  offer: ['project', 'id', 'input'],
  buyer: ['project', 'id', 'input'],
};

const output = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function parse(argv) {
  const [command, ...rest] = argv;
  if (!Object.hasOwn(commandOptions, command)) throw new Error('Unknown command: ' + command + '\n' + usage);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1];
    if (!/^--[a-z][a-z-]*$/.test(flag) || value === undefined || value.startsWith('--'))
      throw new Error('Use named --option value arguments.\n' + usage);
    const name = flag.slice(2);
    if (!commandOptions[command].includes(name)) throw new Error('Unknown option for ' + command + ': ' + flag);
    if (Object.hasOwn(options, name)) throw new Error('Duplicate option: ' + flag);
    options[name] = value;
  }
  return { command, options };
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0]) || argv.slice(1).includes('--help')) {
    process.stdout.write(usage + '\n'); return;
  }
  const { command, options } = parse([...argv]);
  const required = name => {
    if (!options[name]) throw new Error('Missing --' + name);
    return options[name];
  };
  const integer = (name, fallback, minimum = 0) => {
    const value = options[name] === undefined ? fallback : Number(options[name]);
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error('--' + name + ' must be an integer of at least ' + minimum);
    return value;
  };
  const input = async (name = 'input', optional = false) => {
    if (optional && options[name] === undefined) return {};
    const value = JSON.parse(await readFile(resolve(required(name)), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('--' + name + ' must contain a JSON object');
    return value;
  };
  if (command === 'search' && options.origin) {
    if (options.project) throw new Error('Choose --origin for a standalone catalog search, or --project for its saved portal');
    output(await searchOpendatasoft(options.origin, await input('input', true),
      { authTokenEnv: options['auth-token-env'] }));
    return;
  }
  if (command === 'capture-source') {
    const result = await captureOpendatasoftDataset(await input('selection'), resolve(required('out')), await input('limits', true));
    output(result.manifest ?? result); return;
  }
  if (command === 'import-responses') {
    const result = await importOpendatasoftResponses(await input(), resolve(required('out')), await input('limits', true));
    output(result.manifest ?? result); return;
  }
  if (command === 'inspect-capture') {
    const capture = await readOpendatasoftCapture(resolve(required('capture')));
    output({ manifest: capture.manifest, sha256: capture.manifestSha256,
      fields: capture.fields, sample: capture.rows.slice(0, 20) });
    return;
  }
  if (command === 'search' && options['auth-token-env'])
    throw new Error('The saved project owns its portal credential environment name; set it during init');
  const project = await openOpendatasoftWorkbench({
    directory: resolve(required('project')),
    create: command === 'init',
    ...(command === 'init' ? { origin: required('origin'), authTokenEnv: options['auth-token-env'] } : {}),
  });
  let served = false;
  try {
    if (command === 'serve') {
      const port = integer('port', 0);
      if (port > 65535) throw new Error('--port must be between 0 and 65535');
      const web = await startOpendatasoftServer({ workbench: project, port });
      let ending;
      const shutdown = () => ending ??= (async () => {
        try { await web.close(); } finally { await project.close(); }
      })();
      const onSignal = () => { shutdown().catch(error => {
        process.stderr.write('OPENDATASOFT_SHUTDOWN_FAILED: ' + error.message + '\n');
        process.exitCode = 1;
      }); };
      process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
      process.stdout.write('Huwise / Opendatasoft workspace: ' + web.url + '\n');
      served = true;
      return { project, ...web, shutdown };
    }
    let result;
    if (command === 'init' || command === 'status') result = await project.status();
    else if (command === 'search') result = await project.search(await input('input', true));
    else if (command === 'dataset') result = await project.dataset(required('dataset'));
    else if (command === 'records') result = await project.previewRecords(required('dataset'), await input('input', true));
    else if (command === 'capture') result = await project.startCapture(await input());
    else if (command === 'import') result = await project.importCapture(resolve(required('capture')));
    else if (command === 'resume') result = await project.resumeCapture(required('id'), await input('input', true));
    else if (command === 'edition') result = await project.edition(required('id'));
    else if (command === 'rows') result = await project.editionRows(required('id'),
      { offset: integer('offset', 0), limit: integer('limit', 100, 1) });
    else if (command === 'facets') result = await project.editionFacets(required('id'),
      { field: required('field'), mode: options.mode ?? 'value', limit: integer('limit', 50, 1) });
    else if (command === 'notes') result = await project.saveEditionNotes(required('id'), await input());
    else if (command === 'compare') result = await project.compare(required('before'), required('after'), required('key'));
    else if (command === 'export-edition') {
      const format = required('format');
      if (!['json', 'csv', 'geojson', 'html'].includes(format)) throw new Error('Choose json, csv, geojson or html for --format');
      const exported = await project.exportEdition(required('id'), format,
        options['geometry-field'] ? { geometryField: options['geometry-field'] } : {});
      const filename = resolve(required('out'));
      await writeFile(filename, exported.content, { flag: 'wx', mode: 0o600 });
      result = { file: filename, filename: exported.filename, contentType: exported.contentType,
        bytes: Buffer.byteLength(exported.content) };
    }
    else if (command === 'select') result = await project.saveSource(required('id'), await input());
    else if (command === 'prepare') result = await project.createPublication(required('id'), await input('input', true));
    else if (command === 'inspect') result = await project.publication(required('id'), options.query ?? '');
    else if (command === 'review') result = await project.reviewPublication(required('id'), await input());
    else if (command === 'recover') result = await project.recoverPublication(required('id'));
    else if (command === 'publish') result = await project.publishDataset(required('id'), required('review-id'));
    else if (command === 'export') result = await project.exportMerchant(required('id'), await input());
    else if (command === 'stage') result = await project.stageMerchant(required('id'), await input());
    else if (command === 'offer') result = await project.buyerOffer(required('id'), await input());
    else if (command === 'buyer') result = await project.prepareBuyer(required('id'), await input());
    else throw new Error('Unknown command: ' + command);
    if (result?.completion) {
      result = await result.completion;
      output(result);
      if (result.state !== 'COMPLETE') process.exitCode = 1;
    } else output(result);
  } finally { if (!served) await project.close(); }
}

const entry = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (entry && import.meta.url === pathToFileURL(entry).href)
  main().catch(error => {
    process.stderr.write((error.code ?? 'OPENDATASOFT_COMMAND_FAILED') + ': ' + error.message + '\n');
    process.exitCode = 1;
  });
