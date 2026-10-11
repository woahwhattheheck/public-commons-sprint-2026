#!/usr/bin/env node
// MIT. Original publisher commands, private browser and retained schedules.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as publisherMain } from '../../postgres/publisher/cli.mjs';
import { openSftpPublisher } from './model.mjs';

export function main(argv = process.argv.slice(2)) {
  return publisherMain(argv, { openPublisher: openSftpPublisher, sourceName: 'SFTP', defaultPort: 8454 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    process.stderr.write((issue.code ?? 'SFTP_PUBLISHER') + ': ' +
      (issue.code ? issue.message : 'Review the selected inputs.') + '\n');
    process.exitCode = 1;
  });
