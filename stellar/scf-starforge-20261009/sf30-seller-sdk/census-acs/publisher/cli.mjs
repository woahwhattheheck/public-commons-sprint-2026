// MIT. Original publisher CLI with a typed Census plan template.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { bytes, createFile, fault } from '../../postgres/publisher/files.mjs';
import { openCensusPublisher } from './model.mjs';
import { censusPlanTemplate } from './plan.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    await publisherMain(argv, { openPublisher: openCensusPublisher, sourceName: 'Census ACS', defaultPort: 8467 });
    process.stdout.write('\nCensus additions:\n  template --workspace DIR --query observations|source_files --out FILE [--name NAME]\n  release-package --workspace DIR --run RUN_ID --seller FILE --out DIR\n');
    return;
  }
  if (argv[0] === 'release-package') {
    const options = {};
    for (let index = 1; index < argv.length; index += 2) {
      const key = argv[index], value = argv[index + 1];
      if (!['--workspace', '--run', '--seller', '--out'].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--'))
        throw fault('CENSUS_RELEASE_OPTIONS_INVALID');
      options[key] = value;
    }
    if (Object.keys(options).length !== 4) throw fault('CENSUS_RELEASE_ARGUMENT_REQUIRED');
    const publisher = await openCensusPublisher({ directory: resolve(options['--workspace']) });
    try {
      const { prepareCensusRelease } = await import('../release.mjs');
      const result = await prepareCensusRelease({ publisher, runId: options['--run'],
        sellerFile: resolve(options['--seller']), outputDirectory: resolve(options['--out']) });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
    } finally { await publisher.close(); }
  }
  if (argv[0] !== 'template') return publisherMain(argv, {
    openPublisher: openCensusPublisher, sourceName: 'Census ACS', defaultPort: 8467,
  });
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--workspace', '--query', '--out', '--name'].includes(key) || Object.hasOwn(options, key) ||
        !value || value.startsWith('--')) throw fault('CENSUS_TEMPLATE_OPTIONS_INVALID');
    options[key] = value;
  }
  if (!options['--workspace'] || !options['--query'] || !options['--out']) throw fault('CENSUS_TEMPLATE_ARGUMENT_REQUIRED');
  const publisher = await openCensusPublisher({ directory: resolve(options['--workspace']) });
  try {
    const value = await censusPlanTemplate(publisher.settings.sourceFile, options['--query'],
      options['--name'] ?? (options['--query'] === 'source_files' ? 'ACS original source files' : 'ACS observations'));
    const out = resolve(options['--out']); await createFile(out, bytes(value));
    const result = { created: out, query: value.query, sourceHash: value.sourceHash };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } finally { await publisher.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'CENSUS_PUBLISHER') + ': ' + issue.message + '\n'); process.exitCode = 1; });
