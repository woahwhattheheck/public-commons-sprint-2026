// MIT. Original CLI and browser publisher with the Sheet Best source driver.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openSheetBestPublisher } from './model.mjs';

export function main(argv = process.argv.slice(2)) {
  return publisherMain(argv, { openPublisher: openSheetBestPublisher, sourceName: 'Sheet Best', defaultPort: 8458 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'SHEETBEST_PUBLISHER') + ': ' +
    (issue.code ? issue.message : 'Review the selected private inputs.') + '\n'); process.exitCode = 1; });
