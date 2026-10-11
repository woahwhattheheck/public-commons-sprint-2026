#!/usr/bin/env node
// MIT. One operator entrypoint for the original merchant preparation lifecycle.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDuckdbMerchantPlan, prepareDuckdbSeller, verifyPreparedDuckdbSeller, runPreparedDuckdbSeller } from './prepare.mjs';
import { safeCode } from './start.mjs';

const HELP = `DuckDB merchant preparation — original SF30 seller and data source

node duckdb/prepare-cli.mjs inspect --source SOURCE.json --plan PLAN.json
node duckdb/prepare-cli.mjs prepare --source SOURCE.json --plan PLAN.json
  --directory NEW_DIRECTORY [--python /private/venv/bin/python]
node duckdb/prepare-cli.mjs verify --directory DIRECTORY
node duckdb/prepare-cli.mjs run --directory DIRECTORY -- [original duckdb/start.mjs flags]

inspect compiles the plan and reports the exact data-copy size without native SQL.
prepare copies the individually declared data and performs native DuckDB preflight.
verify reads all package files and dataset bytes; it makes no SQL or payment call.
run verifies the package and uses the original seller/facilitator/shutdown path.
An existing output directory is never reused. See duckdb/PREPARE.md.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', 'help'].includes(args[0])) { console.log(HELP); return; }
  const [command, ...rest] = args;
  if (!['inspect', 'prepare', 'verify', 'run'].includes(command)) throw new TypeError('DUCKDB_PREPARE_COMMAND_INVALID');
  const divider = rest.indexOf('--');
  const flags = divider < 0 ? rest : rest.slice(0, divider), runtime = divider < 0 ? [] : rest.slice(divider + 1);
  if (divider >= 0 && command !== 'run') throw new TypeError('DUCKDB_PREPARE_OPTION_INVALID');
  const allowed = command === 'inspect' ? ['--source', '--plan'] : command === 'prepare' ?
    ['--source', '--plan', '--directory', '--python'] : ['--directory'];
  const options = new Map();
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index], value = flags[index + 1];
    if (!allowed.includes(key) || options.has(key) || !value || value.startsWith('--'))
      throw new TypeError('DUCKDB_PREPARE_OPTION_INVALID');
    options.set(key, value);
  }
  if (allowed.filter(key => key !== '--python').some(key => !options.has(key)))
    throw new TypeError('DUCKDB_PREPARE_OPTION_REQUIRED');
  if (command === 'run') return runPreparedDuckdbSeller({ directory: options.get('--directory'), args: runtime });
  let result;
  if (command === 'inspect') result = await inspectDuckdbMerchantPlan({ sourceFile: options.get('--source'), planFile: options.get('--plan') });
  else if (command === 'prepare') result = await prepareDuckdbSeller({ sourceFile: options.get('--source'), planFile: options.get('--plan'),
    directory: options.get('--directory'), python: options.get('--python') ?? 'python3' });
  else {
    const bundle = await verifyPreparedDuckdbSeller({ directory: options.get('--directory') });
    result = { schema: bundle.schema, directory: bundle.directory, verified: true, sourceSha256: bundle.sourceSha256,
      datasetBytes: bundle.manifest.datasetBytes, routes: bundle.manifest.routes };
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(issue => {
    // Native compiler messages name the failed declaration rule. JSON parser
    // excerpts, filesystem details, query results and stack traces stay private.
    console.error(JSON.stringify({ error: safeCode(issue),
      ...(issue instanceof TypeError || issue instanceof RangeError ? { message: issue.message } : {}) }));
    process.exitCode = 1;
  });
