// MIT. Original publication, schedule, browser and buyer commands for Sheets.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openSheetsPublisher } from './model.mjs';

export function main(argv = process.argv.slice(2)) {
  return publisherMain(argv, { openPublisher: openSheetsPublisher, sourceName: 'Google Sheets', defaultPort: 8452 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write(`${issue.code ?? 'SHEETS_PUBLISHER'}: ${issue.code ? issue.message : 'Review the selected inputs.'}\n`); process.exitCode = 1; });
