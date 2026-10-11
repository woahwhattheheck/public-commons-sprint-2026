#!/usr/bin/env node
// MIT. Explicit local operator inspection; not a public HTTP or payment bypass.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqliteQueryFile } from './config.mjs';
const HELP = `Usage: node sqlite/inspect.mjs --source FILE --describe [--stats]
       node sqlite/inspect.mjs --source FILE --stats
       node sqlite/inspect.mjs --source FILE --query NAME --input '{"region":"north"}' [--stats] [--output NEW_FILE]
Opens only the configured read-only SQLite source. No payment, server or network.`;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new TypeError('Duplicate option');
    if (['--describe', '--stats'].includes(key)) { options.set(key, true); continue; }
    if (!['--source', '--query', '--input', '--output'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(HELP);
    options.set(key, args[++i]);
  }
  const describe = options.has('--describe'), query = options.has('--query'), input = options.has('--input');
  if (!options.has('--source') || query !== input || describe && query || !describe && !query && !options.has('--stats'))
    throw new TypeError(HELP);
  const source = await openSqliteQueryFile(options.get('--source'));
  try {
    const value = describe ? source.describe() : query ? await source.query(options.get('--query'), JSON.parse(options.get('--input'))) : undefined;
    const result = options.has('--stats') ? value === undefined ? source.stats() : { result: value, pool: source.stats() } : value;
    const text = JSON.stringify(result, null, 2) + '\n';
    if (options.has('--output')) await writeFile(options.get('--output'), text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    else process.stdout.write(text);
  } finally { await source.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write((error.code ?? error.message ?? 'SQLITE_INSPECTION_FAILED') + '\n'); process.exitCode = 1; });
}
