#!/usr/bin/env node
// MIT. Original publisher CLI, browser and scheduling for the MySQL source.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openMysqlPublisher } from './model.mjs';

export function main(argv = process.argv.slice(2)) {
  return publisherMain(argv, { openPublisher: openMysqlPublisher, sourceName: 'MySQL', defaultPort: 8447 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    process.stderr.write(`${issue.code ?? 'MYSQL_PUBLISHER'}: ${issue.code ? issue.message : 'Review the selected inputs.'}\n`);
    process.exitCode = 1;
  });
