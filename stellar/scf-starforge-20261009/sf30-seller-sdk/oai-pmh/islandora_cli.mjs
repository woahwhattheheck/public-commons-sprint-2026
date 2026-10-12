#!/usr/bin/env node
// MIT. Installed Islandora commands through the original Python/Node launcher.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as launch } from './cli.mjs';

export function main(args = process.argv.slice(2)) {
  return launch(args, { entrypoint: 'islandora_cli.py' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write('Islandora: ' + error.message + '\n');
    process.exitCode = 1;
  });
