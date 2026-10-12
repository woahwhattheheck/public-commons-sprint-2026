#!/usr/bin/env node
// MIT. Customer commands for original paid-job result receiving.
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initializeReceiver, openResultReceiver } from './store.mjs';

const HELP = [
  'Paid-job result receiver', '',
  '  init   --root NEW_ABSOLUTE_DIRECTORY --config RECEIVER_CONFIG_JSON',
  '  serve  --root DIRECTORY [--host 127.0.0.1] [--port 0] [--operator-port 0]',
  '         [--operator-token-env ENV_NAME] [--max-concurrent 4]',
  '  list   --root DIRECTORY [--after DELIVERY_ID] [--limit 50]',
  '  show   --root DIRECTORY --id DELIVERY_ID',
  '  verify --root DIRECTORY --id DELIVERY_ID',
  '  recover-incoming --root DIRECTORY',
  '  export --root DIRECTORY --id DELIVERY_ID --out NEW_ABSOLUTE_DIRECTORY', '',
  'The config selects the destination, accepted merchant origins and optional',
  'source hashes, maximum result size and HMAC secret environment variable.',
  'The receiving endpoint accepts signed completed bytes. The operator desk',
  'opens separately on loopback. Export preserves the original result file,',
  'complete delivery manifest and receiver receipt.', '',
].join('\n');
const OPTIONS = {
  init: ['--root', '--config'],
  serve: ['--root', '--host', '--port', '--operator-port', '--operator-token-env', '--max-concurrent'],
  list: ['--root', '--after', '--limit'], show: ['--root', '--id'], verify: ['--root', '--id'],
  export: ['--root', '--id', '--out'], 'recover-incoming': ['--root'],
};
function parse(args) {
  const [command, ...rest] = args;
  if (!Object.hasOwn(OPTIONS, command) || rest.length % 2) throw new Error('JRR_COMMAND_INVALID');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!OPTIONS[command].includes(rest[i]) || Object.hasOwn(options, rest[i])) throw new Error('JRR_OPTION_INVALID');
    options[rest[i]] = rest[i + 1];
  }
  if (!options['--root']) throw new Error('JRR_ROOT_REQUIRED');
  return { command, options };
}
const integer = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('JRR_INTEGER_REQUIRED');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('JRR_INTEGER_REQUIRED');
  return parsed;
};

export async function main(args = process.argv.slice(2), { stdout = process.stdout, env = process.env } = {}) {
  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') { stdout.write(HELP); return; }
  const { command, options } = parse(args);
  const root = options['--root'];
  let result;
  if (command === 'init') {
    if (!options['--config']) throw new Error('JRR_CONFIG_FILE_REQUIRED');
    const bytes = await readFile(options['--config']);
    if (bytes.length > 32768) throw new Error('JRR_CONFIG_TOO_LARGE');
    result = await initializeReceiver(root, JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)));
  } else if (command === 'serve') {
    const store = await openResultReceiver(root);
    const tokenEnv = options['--operator-token-env'];
    if (tokenEnv && !/^[A-Z][A-Z0-9_]{1,63}$/.test(tokenEnv)) throw new Error('JRR_OPERATOR_ENV_INVALID');
    if (tokenEnv && !env[tokenEnv]) throw new Error('JRR_OPERATOR_TOKEN_REQUIRED');
    const { startResultReceiver } = await import('./server.mjs');
    const service = await startResultReceiver({ root, secret: env[store.config.secretEnv],
      host: options['--host'] ?? '127.0.0.1', port: integer(options['--port'], 0),
      operatorPort: integer(options['--operator-port'], 0), maxConcurrent: integer(options['--max-concurrent'], 4),
      ...(tokenEnv ? { operatorToken: env[tokenEnv] } : {}) });
    stdout.write(JSON.stringify({ schema: 'stellar-forge.job-result-receiver-ready.v1',
      root: service.store.root,
      configSha256: createHash('sha256').update(JSON.stringify(service.store.config)).digest('hex'),
      pid: process.pid, receiverUrl: service.receiverUrl, destination: service.store.config.destination,
      operatorUrl: service.operatorUrl }) + '\n');
    return await new Promise((resolve, reject) => {
      let stopping = false;
      const stop = () => {
        if (stopping) return; stopping = true;
        service.close().then(() => resolve({ state: 'STOPPED' }), reject).finally(() => {
          process.off('SIGINT', stop); process.off('SIGTERM', stop);
        });
      };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
    });
  } else {
    const store = await openResultReceiver(root);
    if (command === 'list') result = await store.list({ after: options['--after'] ?? '', limit: integer(options['--limit'], 50) });
    if (command === 'show') result = await store.metadata(options['--id']);
    if (command === 'verify') result = await store.verify(options['--id']);
    if (command === 'recover-incoming') result = await store.recoverIncoming();
    if (command === 'export') {
      if (!options['--out']) throw new Error('JRR_EXPORT_PATH_REQUIRED');
      result = await store.exportResult(options['--id'], options['--out']);
    }
  }
  stdout.write(JSON.stringify(result) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(failure => {
    process.stderr.write((/^JRR_|^JRD_/.test(failure.code ?? failure.message ?? '')
      ? failure.code ?? failure.message : failure.code ?? 'JRR_COMMAND_FAILED') + '\n');
    process.exitCode = 1;
  });
}
