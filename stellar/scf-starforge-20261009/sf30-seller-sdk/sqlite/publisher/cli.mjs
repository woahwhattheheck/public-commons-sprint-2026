// MIT. All operator actions use the original publisher command and workspace.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openSqlitePublisher } from './model.mjs';

export function main(argv = process.argv.slice(2)) {
  return publisherMain(argv, { openPublisher: openSqlitePublisher, sourceName: 'SQLite', defaultPort: 8446 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write(`${issue.code ?? 'SQLITE_PUBLISHER'}: ${issue.code ? issue.message : 'Review the selected inputs.'}\n`); process.exitCode = 1; });
