#!/usr/bin/env node
// MIT. Delegate to the original complete ZIP/Python/JavaScript source collector.
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import original from './toolkit/host/application_archive_source.cjs';

export async function main(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw new TypeError('Supply the original source command argument strings.');
  return original.main(argv.length === 1 && argv[0] === '-h' ? ['help'] : argv);
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  path => pathToFileURL(path).href === import.meta.url, () => false))
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({status:'ERROR',code:error.code ?? error.name,message:error.message}) + '\n');
    process.exitCode = 1;
  });
