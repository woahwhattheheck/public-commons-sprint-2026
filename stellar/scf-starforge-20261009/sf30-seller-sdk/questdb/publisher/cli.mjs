#!/usr/bin/env node
// MIT. Original publisher operations with a native QuestDB plan template.
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openQuestDbPublisher } from './model.mjs';
import { bytes, createFile, fault } from '../../postgres/publisher/files.mjs';
import { bindQuestDbParameters, compileQuestDbQueries } from '../declaration.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function main(args = process.argv.slice(2)) {
  if (args[0] !== 'template')
    return publisherMain(args, { openPublisher: openQuestDbPublisher, sourceName: 'QuestDB', defaultPort: 0 });
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!['--workspace', '--query', '--out'].includes(name) || Object.hasOwn(options, name))
      throw fault('INVALID_OPTION', name);
    if (!value || value.startsWith('--')) throw fault('OPTION_VALUE_REQUIRED', name);
    options[name] = value;
  }
  for (const name of ['--workspace', '--query', '--out'])
    if (!options[name]) throw fault('OPTION_REQUIRED', name);
  const publisher = await openQuestDbPublisher({ directory: resolve(options['--workspace']) });
  try {
    const source = await publisher.source(), query = options['--query'], item = source.queries[query];
    if (!item) throw fault('QUERY_NOT_FOUND');
    const declaration = compileQuestDbQueries({ [query]: item })[query];
    const input = bindQuestDbParameters(declaration, declaration.probe);
    const value = {
      title: query + ' snapshot', query, input, sourceHash: source.hash,
      dataset: {
        name: query,
        columns: Object.fromEntries(item.columns.map(name => [name, { type: 'string', nullable: true }])),
        filters: [], ranges: [], sorts: [], defaultLimit: 50, maxLimit: 250
      },
      extraction: {
        maxRows: 1000000, maxBytes: 67108864, maxRowBytes: 1048576,
        timeoutMs: Math.max(120000, item.timeoutMs ?? 30000), includeNativeCsv: false
      }
    };
    const path = resolve(options['--out']);
    await createFile(path, bytes(value));
    const output = { created: path, sourceHash: source.hash, query };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return output;
  } finally { await publisher.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write((error.code ?? 'QUESTDB_PUBLISHER') + ': ' + error.message + '\n');
    process.exitCode = 1;
  });
