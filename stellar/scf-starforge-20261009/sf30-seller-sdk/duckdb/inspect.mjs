#!/usr/bin/env node
// MIT. Explicit local operator inspection and create-only query export.
import { writeFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDuckdbSourceFile, describeDuckdbSource } from './config.mjs';
import { openDuckdbSourceFile } from './source.mjs';
import { safeCode } from './start.mjs';
const HELP = `Usage: node duckdb/inspect.mjs --source SOURCE.json
  --describe | --preflight | --query NAME --input INPUT.json [--output NEW_FILE]
  [--python /private/venv/bin/python]
--describe validates local declarations and metadata without opening DuckDB.
--query executes the operator-approved read locally; it is not a public HTTP route.`;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (flags.has(key)) throw new TypeError('DUCKDB_DUPLICATE_OPTION');
    if (['--describe', '--preflight'].includes(key)) { flags.set(key, true); continue; }
    if (!['--source', '--query', '--input', '--output', '--python'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(HELP);
    flags.set(key, args[++i]);
  }
  if (!flags.has('--source') || ['--describe', '--preflight', '--query'].filter(key => flags.has(key)).length !== 1 ||
      flags.has('--query') !== flags.has('--input') || flags.has('--output') && !flags.has('--query')) throw new TypeError(HELP);
  const filename = resolve(flags.get('--source'));
  if (flags.has('--describe')) { console.log(JSON.stringify(describeDuckdbSource(await readDuckdbSourceFile(filename)), null, 2)); return; }
  const { source } = await openDuckdbSourceFile(filename, { python: flags.get('--python') ?? 'python3' });
  try {
    if (flags.has('--preflight')) { console.log(JSON.stringify(source.inspect(), null, 2)); return; }
    const handle = await open(resolve(flags.get('--input')), 'r');
    let input;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 262144) throw new TypeError('DUCKDB_INPUT_TOO_LARGE');
      const bytes = Buffer.alloc(262145); let total = 0;
      while (total < bytes.length) {
        const next = await handle.read(bytes, total, bytes.length - total, null);
        if (!next.bytesRead) break;
        total += next.bytesRead;
      }
      if (total > 262144) throw new TypeError('DUCKDB_INPUT_TOO_LARGE');
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)));
    } finally { await handle.close(); }
    const result = await source.query(flags.get('--query'), input);
    const content = JSON.stringify(result, null, 2) + '\n';
    if (flags.has('--output')) {
      await writeFile(resolve(flags.get('--output')), content, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ query: result.query, rowCount: result.rowCount, truncated: result.truncated, saved: true }));
    } else process.stdout.write(content);
  } finally { await source.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(issue => { process.stderr.write(JSON.stringify({ error: safeCode(issue) }) + '\n'); process.exitCode = 1; });
