#!/usr/bin/env node
// MIT. Explicit local operator inspection. --describe does not connect or load keys.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPostgresSourceFile, readPostgresSourceFile } from './config.mjs';
const HELP = `Usage: node postgres/inspect.mjs --source FILE --describe
       node postgres/inspect.mjs --source FILE --preflight
       node postgres/inspect.mjs --source FILE --query NAME --input '{"region":"north"}' [--output NEW_FILE]
--describe is offline. --preflight connects and checks query projections with LIMIT 0.
--query explicitly reads configured operator data; it is not a public paid endpoint.`;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new TypeError('POSTGRES_DUPLICATE_OPTION');
    if (['--describe', '--preflight'].includes(key)) { options.set(key, true); continue; }
    if (!['--source', '--query', '--input', '--output'].includes(key) || args[i + 1] === undefined ||
        args[i + 1].startsWith('--')) throw new TypeError(HELP);
    options.set(key, args[++i]);
  }
  const modes = ['--describe', '--preflight', '--query'].filter(key => options.has(key));
  if (!options.has('--source') || modes.length !== 1 ||
      (options.has('--query') !== options.has('--input'))) throw new TypeError(HELP);
  let source, result;
  try {
    if (options.has('--describe')) {
      const declaration = await readPostgresSourceFile(options.get('--source'));
      result = { schema: 'stellar-forge.postgres-declaration.v1', queries: declaration.description };
    } else {
      ({ source } = await openPostgresSourceFile(options.get('--source')));
      let input;
      if (options.has('--query')) {
        try { input = JSON.parse(options.get('--input')); } catch { throw new TypeError('POSTGRES_INPUT_JSON_INVALID'); }
      }
      result = options.has('--preflight') ? source.inspect() : await source.query(options.get('--query'), input);
    }
    const output = JSON.stringify(result, null, 2) + '\n';
    if (options.has('--output')) await writeFile(options.get('--output'), output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    else process.stdout.write(output);
    return result;
  } finally { await source?.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(issue => { process.stderr.write(JSON.stringify({ error: issue.code ?? issue.message ?? 'POSTGRES_INSPECTION_FAILED',
    ...(issue.query ? { query: issue.query } : {}), ...(issue.sqlState ? { sqlState: issue.sqlState } : {}) }) + '\n'); process.exitCode = 1; });
}
