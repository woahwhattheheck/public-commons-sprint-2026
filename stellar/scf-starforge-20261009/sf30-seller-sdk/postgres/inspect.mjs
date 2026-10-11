#!/usr/bin/env node
// MIT. Explicit operator read; no seller, facilitator, wallet or payment call.
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readPrivateJson, readPostgresSourceFile, describePostgresFile, openPostgresQueryFile } from './config.mjs';
import { bindPostgresParameters } from './declaration.mjs';

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (command === '--help') { console.log('Usage: node postgres/inspect.mjs describe|validate|query --source FILE [--query NAME --input-file FILE] [--output NEW_FILE]'); return; }
  if (!['describe', 'validate', 'query'].includes(command)) throw new TypeError('Choose describe, validate or query');
  const options = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!['--source', '--query', '--input-file', '--output'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new TypeError('Invalid inspect option');
    options.set(key, value);
  }
  if (!options.has('--source')) throw new TypeError('Source file required');
  const loaded = await readPostgresSourceFile(options.get('--source')); let result;
  if (command === 'describe') result = describePostgresFile(loaded);
  else {
    const name = options.get('--query');
    if (!Object.hasOwn(loaded.compiled, name) || !options.has('--input-file')) throw new TypeError('Existing query and input file required');
    const input = await readPrivateJson(options.get('--input-file'));
    bindPostgresParameters(loaded.compiled[name], input);
    if (command === 'validate') result = { query: name, valid: true, networkRequests: 0 };
    else {
      const { source } = await openPostgresQueryFile(options.get('--source'));
      try { result = await source.query(name, input); } finally { await source.close(); }
    }
  }
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  if (options.has('--output')) {
    const file = await open(options.get('--output'), 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    console.log(JSON.stringify({ written: true, bytes: bytes.length }));
  } else process.stdout.write(bytes);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error?.code && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'POSTGRES_INSPECTION_FAILED'); process.exitCode = 1; });
