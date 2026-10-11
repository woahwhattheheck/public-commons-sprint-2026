// MIT. Privileged local inspection; never exposes a free HTTP query endpoint.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPostgresQueryFile, describePostgresSourceFile, readPrivateFile } from './config.mjs';

export async function main(args = process.argv.slice(2)) {
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (flags.has(key) || !['--source', '--query', '--input', '--input-file', '--output', '--describe'].includes(key)) throw new TypeError('Invalid or duplicate option');
    if (key === '--describe') flags.set(key, true);
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError('Option value required'); flags.set(key, args[++i]); }
  }
  if (!flags.has('--source') || flags.has('--input') && flags.has('--input-file'))
    throw new TypeError('Use --source FILE and --describe, or --query NAME with --input-file FILE');
  let result, source;
  try {
    if (flags.has('--describe')) {
      if (flags.has('--query') || flags.has('--input') || flags.has('--input-file')) throw new TypeError('Describe does not accept query inputs');
      result = await describePostgresSourceFile(flags.get('--source'));
    } else {
      if (!flags.has('--query')) throw new TypeError('--query is required');
      const input = JSON.parse(flags.has('--input-file') ? await readPrivateFile(flags.get('--input-file')) : flags.get('--input') ?? '{}');
      source = await openPostgresQueryFile(flags.get('--source'));
      result = await source.query(flags.get('--query'), input);
    }
    const text = JSON.stringify(result, null, 2) + '\n';
    if (flags.has('--output')) await writeFile(resolve(flags.get('--output')), text, { flag: 'wx', mode: 0o600 });
    else process.stdout.write(text);
    return result;
  } finally { await source?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  process.stderr.write(JSON.stringify({ error: error?.code ?? 'POSTGRES_INSPECTION_FAILED' }) + '\n'); process.exitCode = 1;
});
