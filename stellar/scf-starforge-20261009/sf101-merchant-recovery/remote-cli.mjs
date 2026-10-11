#!/usr/bin/env node
// MIT. Explicit operator commands for the original SF101 encrypted recovery bundle.
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMANDS = Object.freeze({
  push: {
    required: ['config', 'bundle', 'operations', 'id', 'passEnv'],
    optional: [],
    usage: 'push --config ABS --bundle ABS --operations ABS --id ID --pass-env NAME',
  },
  list: {
    required: ['config'],
    optional: ['cursor', 'limit'],
    usage: 'list --config ABS [--cursor TOKEN] [--limit 1..100]',
  },
  pull: {
    required: ['config', 'snapshot', 'out', 'operations', 'id', 'passEnv'],
    optional: [],
    usage: 'pull --config ABS --snapshot SHA64 --out NEW_ABS --operations ABS --id ID --pass-env NAME',
  },
  restore: {
    required: ['config', 'snapshot', 'bundleOut', 'out', 'operations', 'id', 'passEnv'],
    optional: [],
    usage: 'restore --config ABS --snapshot SHA64 --bundle-out ABS --out NEW_ABS --operations ABS --id ID --pass-env NAME',
  },
  status: {
    required: ['operations', 'id'],
    optional: [],
    usage: 'status --operations ABS --id ID',
  },
});
const FLAGS = Object.freeze({
  '--config': 'config', '--bundle': 'bundle', '--operations': 'operations', '--id': 'id',
  '--pass-env': 'passEnv', '--snapshot': 'snapshot', '--out': 'out',
  '--bundle-out': 'bundleOut', '--cursor': 'cursor', '--limit': 'limit',
});
const PATHS = new Set(['config', 'bundle', 'operations', 'out', 'bundleOut']);
const label = key => Object.entries(FLAGS).find(([, value]) => value === key)?.[0] ?? key;

export const HELP = `SF101 encrypted merchant recovery

node remote-cli.mjs ${COMMANDS.push.usage}
node remote-cli.mjs ${COMMANDS.list.usage}
node remote-cli.mjs ${COMMANDS.pull.usage}
node remote-cli.mjs ${COMMANDS.restore.usage}
node remote-cli.mjs ${COMMANDS.status.usage}

push     Verify and transfer an existing original encrypted snapshot; publish its
         immutable completion descriptor after every object is available.
list     Return one page of completed snapshots and its continuation cursor.
pull     Retrieve the selected snapshot and verify it with the original engine.
restore  Retrieve, verify and restore the selected snapshot into a new directory.
status   Read the retained local operation without a bucket configuration.

Use the same operation ID and paths to resume an interrupted transfer. Select a
snapshot ID returned by list or a completed push. --pass-env names an existing
private environment variable; its value never belongs in the command.
Paths must be normalized absolute paths. list defaults to 20 entries (maximum 100).
See REMOTE.md for the original maintenance and cold-recovery workflow.
Use "node remote-cli.mjs COMMAND --help" for a command's arguments.`;

function fail(message) {
  const error = new Error(message);
  error.code = 'REMOTE_RECOVERY_ARGUMENT';
  throw error;
}

/** Parse the entire command before loading a provider or changing any state. */
export function parseRemoteArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) fail('Arguments must be strings');
  if (!argv.length || argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) return { help: HELP };
  let [command, ...rest] = argv;
  if (command === 'help' && rest.length === 1 && Object.hasOwn(COMMANDS, rest[0])) {
    command = rest[0]; rest = ['--help'];
  }
  if (!Object.hasOwn(COMMANDS, command)) fail('Unknown command. Use remote-cli.mjs --help');
  const definition = COMMANDS[command];
  if (rest.length === 1 && ['--help', '-h'].includes(rest[0])) {
    return { help: 'node remote-cli.mjs ' + definition.usage + '\n\n' + HELP };
  }
  const options = { command };
  const allowed = new Set([...definition.required, ...definition.optional]);
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index], key = FLAGS[flag];
    if (!key || !allowed.has(key)) fail('Unsupported option for ' + command + ': ' + flag);
    if (Object.hasOwn(options, key)) fail('Duplicate option: ' + flag);
    const value = rest[++index];
    if (value === undefined || value.length === 0 || key !== 'cursor' && value.startsWith('--')) fail('Value required for ' + flag);
    if (value.includes('\0')) fail('NUL is not allowed in ' + flag);
    options[key] = value;
  }
  for (const key of definition.required) if (!Object.hasOwn(options, key)) fail('Missing ' + label(key));
  for (const key of PATHS) if (Object.hasOwn(options, key)) {
    const value = options[key];
    if (!isAbsolute(value) || resolve(value) !== value || value === '/' || /[\\\x00-\x1f\x7f]/.test(value)) {
      fail(label(key) + ' requires a normalized absolute path');
    }
  }
  if (options.id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(options.id)) {
    fail('--id requires 1..80 letters, digits, dots, underscores or hyphens, beginning with a letter or digit');
  }
  if (options.passEnv !== undefined && !/^[A-Z][A-Z0-9_]{4,63}$/.test(options.passEnv)) {
    fail('--pass-env must name an existing uppercase environment variable (5..64 characters)');
  }
  if (options.snapshot !== undefined) {
    if (!/^[a-fA-F0-9]{64}$/.test(options.snapshot)) fail('--snapshot requires the exact 64-character snapshot SHA-256');
    options.snapshot = options.snapshot.toLowerCase();
  }
  if (options.limit !== undefined) {
    if (!/^[1-9][0-9]{0,2}$/.test(options.limit) || Number(options.limit) > 100) fail('--limit must be an integer from 1 to 100');
    options.limit = Number(options.limit);
  } else if (command === 'list') options.limit = 20;
  // Cursor bytes are provider-owned; preserve their original value verbatim.
  if (options.cursor !== undefined && (options.cursor.length > 8192 || /[\x00-\x1f\x7f]/.test(options.cursor))) {
    fail('--cursor requires an unchanged provider continuation token (maximum 8192 characters, without control characters)');
  }
  return options;
}

/** Returns an exit status; the facade owns journals, provider calls and recovery. */
export async function main(argv = process.argv.slice(2), { run, output = process.stdout } = {}) {
  const options = parseRemoteArguments(argv);
  if (options.help) { output.write(options.help + '\n'); return 0; }
  const operation = run ?? (await import('./remote.mjs')).runRemote;
  const result = await operation(options);
  output.write(JSON.stringify(result, null, 2) + '\n');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    const detail = {
      error: 'REMOTE_RECOVERY_ERROR',
      message: typeof error?.message === 'string' ? error.message : String(error),
      ...Object.fromEntries(['code', 'status', 'httpStatusCode', 'providerCode', 'originalCode',
        'requestId', 'putRequestId', 'retryAfter', 'retryable', 'mayHaveCommitted',
        'reconciliationCode', 'reconciliationStatus'].filter(key =>
        ['string', 'boolean'].includes(typeof error?.[key]) ||
        typeof error?.[key] === 'number' && Number.isFinite(error[key])).map(key => [key, error[key]])),
      ...(error?.operation && typeof error.operation === 'object' ? { operation: error.operation } : {}),
    };
    process.stderr.write(JSON.stringify(detail) + '\n');
    process.exitCode = 1;
  });
}

