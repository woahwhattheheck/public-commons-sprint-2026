#!/usr/bin/env node
// MIT. Source-package operations and the original local publisher in one command.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../postgres/publisher/cli.mjs';
import { bytes, createFile, readJson, fault } from '../postgres/publisher/files.mjs';
import { openFrictionlessPublisher } from './model.mjs';
import { inspectFrictionlessSource, runFrictionlessCommand } from './source.mjs';

const SOURCE_COMMANDS = new Set(['capture', 'inspect-capture', 'suggest-source', 'source-export', 'source-receive', 'compare', 'review-source']);
const HELP = `Frictionless Data Package merchant publisher

Source edition:
  capture --descriptor PATH_OR_HTTPS_URL --output NEW_DIR [--resource NAME ...]
          [--reference PATH_OR_HTTPS_URL ...]
  inspect-capture --capture CAPTURE.json [--sha256 HASH]
  suggest-source --capture CAPTURE.json --output SOURCE.json
  review-source --source REVIEWED_SOURCE.json
  plan --source REVIEWED_SOURCE.json --query NAME --out PLAN.json
  source-export --source SOURCE.json --output PACKAGE.tar.gz
  source-receive --archive PACKAGE.tar.gz --sha256 HASH --output NEW_DIR
  compare --before OLD_CAPTURE.json --after NEW_CAPTURE.json

Original SF82 release:
  release-prepare --workspace DIR --run UUID --output NEW_PACKAGE_DIR
                  --payment PAYMENT.json --origin HTTPS_ORIGIN [--path /data]
  release-stage --package PACKAGE_DIR --releases RELEASE_STORE --id ID
                [--label TEXT] [--runtime RUNTIME.json]
  Activate, compare, roll back and run with sf82-seller-pilot/release-cli.mjs.

Publisher (same maintained source publisher and browser):
  init --workspace NEW_DIR --source REVIEWED_SOURCE.json --state DATASET_DIR
  save --workspace DIR --input REVIEWED_PLAN.json
  extract --workspace DIR --plan NUMBER
  inspect --workspace DIR --run UUID [--query 'limit=20']
  review --workspace DIR --run UUID --reviewer NAME --note TEXT --initialize
  publish --workspace DIR --run UUID --review REVIEW_ID
  serve --workspace DIR [--port 8487]
  status --workspace DIR
  buyer --workspace DIR --run UUID --seller LOCAL_ORIGIN --resource HTTPS_RESOURCE
  schedule, schedule-save, schedule-enable, schedule-pause, schedule-run,
  schedule-continue, recover: use the maintained publisher arguments.

Python 3.10+, Node 22.16+, util-linux flock. SF_FRICTIONLESS_PYTHON selects an
installed Python executable. No additional Python dependencies are required.
Source suggestions retain physical strings and literal missing markers. Review
the source projection, then use plan to carry its exact types into the original
native CSV schema. The saved plan keeps the full original package capture.
See README.md for refresh, original SF82 release and SF88/SF100 receiving.
`;

function options(args, keys, required = keys) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (!keys.includes(args[i]) || Object.hasOwn(result, args[i]) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw fault('PACKAGE_OPTION_INVALID', args[i]);
    result[args[i]] = args[++i];
  }
  if (required.some(key => !result[key])) throw fault('PACKAGE_OPTION_REQUIRED', required.join(', '));
  return result;
}

export async function makeFrictionlessPlan(sourceFile, queryName, output) {
  const source = await inspectFrictionlessSource(resolve(sourceFile)), query = source.queries[queryName];
  if (!query) throw fault('QUERY_NOT_FOUND');
  const columns = Object.fromEntries(Object.entries(query.projection).map(([alias, spec]) =>
    [alias, { type: spec.type, nullable: spec.missing === 'null' }]));
  const plan = { title: queryName + ' retained package edition', query: queryName, input: {}, sourceHash: source.hash,
    dataset: { name: queryName, columns, filters: [], ranges: [], sorts: [], defaultLimit: 50, maxLimit: 250,
      maxCellChars: 65536, maxPageBytes: 921600 },
    extraction: { order: [{ column: query.columns[0], direction: 'asc' }], maxRows: 250000,
      maxBytes: 67108864, maxRowBytes: 1048576, timeoutMs: 300000 } };
  await createFile(resolve(output), bytes(plan));
  return { created: resolve(output), sourceHash: source.hash, resource: query.resource, columns,
    captureSha256: source.captureSha256 };
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--help') { process.stdout.write(HELP); return; }
  if (SOURCE_COMMANDS.has(argv[0])) return runFrictionlessCommand(argv);
  if (argv[0] === 'plan') {
    const input = options(argv.slice(1), ['--source', '--query', '--out']);
    const result = await makeFrictionlessPlan(input['--source'], input['--query'], input['--out']);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  if (argv[0] === 'release-prepare') {
    const required = ['--workspace', '--run', '--output', '--payment', '--origin'];
    const input = options(argv.slice(1), [...required, '--path'], required);
    const payment = await readJson(resolve(input['--payment']), 16384);
    const { prepareFrictionlessRelease } = await import('./release.mjs');
    const publisher = await openFrictionlessPublisher({ directory: resolve(input['--workspace']) });
    try {
      const result = await prepareFrictionlessRelease({ publisher, runId: input['--run'],
        outputDirectory: resolve(input['--output']), payment, origin: input['--origin'],
        path: input['--path'] ?? '/data' });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
    } finally { await publisher.close(); }
  }
  if (argv[0] === 'release-stage') {
    const required = ['--package', '--releases', '--id'];
    const input = options(argv.slice(1), [...required, '--label', '--runtime'], required);
    const runtime = input['--runtime'] ? await readJson(resolve(input['--runtime']), 16384) : { port: 0 };
    const { stageFrictionlessRelease } = await import('./release.mjs');
    const result = await stageFrictionlessRelease({ packageDirectory: resolve(input['--package']),
      releaseDirectory: resolve(input['--releases']), id: input['--id'],
      label: input['--label'] ?? input['--id'], runtime });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  return publisherMain(argv, { openPublisher: openFrictionlessPublisher, sourceName: 'Frictionless Data Package', defaultPort: 8487 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    process.stderr.write((issue.code ?? 'PACKAGE') + ': ' + (issue.code ? issue.message : 'Inspect the source and selected operator inputs.') + '\n');
    process.exitCode = 1;
  });
