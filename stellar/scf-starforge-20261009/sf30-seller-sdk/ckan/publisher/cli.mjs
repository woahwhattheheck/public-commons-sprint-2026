// MIT. Original publication, browser and SF88 buyer commands for CKAN.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openCkanPublisher } from './model.mjs';

export function main(argv = process.argv.slice(2)) {
  return publisherMain(argv, { openPublisher: openCkanPublisher, sourceName: 'CKAN DataStore', defaultPort: 8456 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write(`${issue.code ?? 'CKAN_PUBLISHER'}: ${issue.code ? issue.message : 'Review the selected inputs.'}\n`); process.exitCode = 1; });
