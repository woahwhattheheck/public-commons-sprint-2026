#!/usr/bin/env node
// MIT. Continue the original Boston job using the installed geographic application.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const original = JSON.parse(await readFile(process.argv[2], 'utf8'));
const gisProduct = resolve(original.reportingProduct, '../gis');
const operation = resolve(gisProduct, '../../../../../operations/open311-gis-8e5f-20261012');
const { runGISCommissioning } = await import(pathToFileURL(join(operation, 'commission-gis.mjs')));
const sourceFiles = [...new Map([...(original.sourceFiles ?? []), ...(original.reportingSourceFiles ?? [])]
  .map(file => [file.path, file])).values()];
const result = await runGISCommissioning({
  ...original,
  gisProduct,
  collectionOutput: original.collectionOutput,
  reportingOutput: join(original.collectionOutput, 'reporting'),
  edition: original.options?.gisEdition ?? '3cb7d7ab61321c1ca4d73dfc2d52a8661a6d910f',
  sourceFiles
});
if (result.state !== 'passed') process.exitCode = 1;
