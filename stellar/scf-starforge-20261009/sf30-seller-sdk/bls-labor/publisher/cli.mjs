// MIT. Original publisher CLI with a typed Bls plan template.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { bytes, createFile, fault } from '../../postgres/publisher/files.mjs';
import { openBlsPublisher } from './model.mjs';
import { blsPlanTemplate } from './plan.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    await publisherMain(argv, { openPublisher: openBlsPublisher, sourceName: 'BLS labor', defaultPort: 8469 });
    process.stdout.write('\nBLS additions:\n  template --workspace DIR --query laus|qcew|source_files --out FILE [--name NAME]\n  release-package --workspace DIR --run RUN_ID --seller FILE --out DIR\n');
    return;
  }
  if (argv[0] === 'release-package') {
    const options = {};
    for (let index = 1; index < argv.length; index += 2) {
      const key = argv[index], value = argv[index + 1];
      if (!['--workspace', '--run', '--seller', '--out'].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--'))
        throw fault('BLS_RELEASE_OPTIONS_INVALID');
      options[key] = value;
    }
    if (Object.keys(options).length !== 4) throw fault('BLS_RELEASE_ARGUMENT_REQUIRED');
    const publisher = await openBlsPublisher({ directory: resolve(options['--workspace']) });
    try {
      const { prepareBlsRelease } = await import('../release.mjs');
      const result = await prepareBlsRelease({ publisher, runId: options['--run'],
        sellerFile: resolve(options['--seller']), outputDirectory: resolve(options['--out']) });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
    } finally { await publisher.close(); }
  }
  if (argv[0] !== 'template') return publisherMain(argv, {
    openPublisher: openBlsPublisher, sourceName: 'BLS labor', defaultPort: 8469,
  });
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--workspace', '--query', '--out', '--name'].includes(key) || Object.hasOwn(options, key) ||
        !value || value.startsWith('--')) throw fault('BLS_TEMPLATE_OPTIONS_INVALID');
    options[key] = value;
  }
  if (!options['--workspace'] || !options['--query'] || !options['--out']) throw fault('BLS_TEMPLATE_ARGUMENT_REQUIRED');
  const publisher = await openBlsPublisher({ directory: resolve(options['--workspace']) });
  try {
    const value = await blsPlanTemplate(publisher.settings.sourceFile, options['--query'],
      options['--name'] ?? (options['--query'] === 'source_files' ? 'BLS original source files' : 'BLS labor observations'));
    const out = resolve(options['--out']); await createFile(out, bytes(value));
    const result = { created: out, query: value.query, sourceHash: value.sourceHash };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } finally { await publisher.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'BLS_PUBLISHER') + ': ' + issue.message + '\n'); process.exitCode = 1; });
