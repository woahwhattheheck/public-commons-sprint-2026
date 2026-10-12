// MIT. Reuse the original publisher CLI and browser.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openNocoDBPublisher } from './model.mjs';
export function main(argv = process.argv.slice(2)) {
  return publisherMain(argv, { openPublisher: openNocoDBPublisher, sourceName: 'NocoDB', defaultPort: 8462 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'NOCODB_PUBLISHER') + ': ' +
    (issue.code ? issue.message : 'Review the selected private inputs.') + '\n'); process.exitCode = 1; });
