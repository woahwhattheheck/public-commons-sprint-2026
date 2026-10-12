// MIT. Native detached worker for one original retained Ruby operation.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { executeRubyOperation } from './model.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv[0] !== '--directory' || argv[2] !== '--operation-id')
    throw Object.assign(new Error('Use --directory DIR --operation-id UUID.'), { code: 'RUBY_WORKER_ARGUMENTS' });
  return executeRubyOperation({ directory: argv[1], operationId: argv[3] });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'RUBY_WORKER_FAILED', message: error.message } }) + '\n');
    process.exitCode = 1;
  });
