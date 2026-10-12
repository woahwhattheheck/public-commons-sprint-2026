#!/usr/bin/env node
// MIT. Standalone and shared CLI for original paid-job export receiving.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  inspectPaidJobExport, downloadPaidJobExport, reopenPaidJobExport
} from './paid-jobs-client.mjs';

const COMMANDS = new Set(['inspect', 'download', 'reopen']);
const VALUE_FLAGS = new Set(['url', 'workspace', 'export-id', 'out', 'dir', 'manifest-sha256', 'token-env']);
export const PAID_JOB_CLIENT_HELP = [
  'Receive original paid-job exports',
  '',
  'merchant-paid-jobs inspect --url URL --workspace ALIAS --export-id SHA [--manifest-sha256 SHA]',
  'merchant-paid-jobs download --url URL --workspace ALIAS --export-id SHA --out DIRECTORY [--manifest-sha256 SHA]',
  'merchant-paid-jobs reopen --dir DIRECTORY [--workspace ALIAS] [--export-id SHA] [--manifest-sha256 SHA]',
  '',
  'The same commands are available as merchant-mcp jobs inspect|download|reopen.',
  '--out and --dir select the same private download directory; use either once.',
  '--token-env NAME selects the MCP bearer token environment variable (default MCP_ACCESS_TOKEN).',
  'Repeat download with the same endpoint, alias, export and directory to resume.',
  'Keep download-state with the received files for an offline reopen.'
].join('\n');
function usage(message) {
  return Object.assign(new Error(message), { code: 'JOB_AGENT_CLI_ARGUMENTS' });
}
function parse(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (typeof flag !== 'string' || !flag.startsWith('--') || !VALUE_FLAGS.has(flag.slice(2)))
      throw usage('Use the documented paid-job receiving options.');
    const name = flag.slice(2), value = argv[++index];
    if (Object.hasOwn(flags, name) || typeof value !== 'string' || !value || value.startsWith('--') || value.includes('\0'))
      throw usage('Supply each selected option exactly once with its value.');
    flags[name] = value;
  }
  if (flags.out !== undefined && flags.dir !== undefined)
    throw usage('Choose one directory with --out or --dir.');
  return flags;
}
function required(flags, names) {
  for (const name of names) if (!flags[name]) throw usage('Supply --' + name + '.');
}
function allowed(flags, names) {
  for (const name of Object.keys(flags)) if (!names.includes(name))
    throw usage('--' + name + ' does not apply to this command.');
}

/**
 * Accept ['jobs', command, ...options] or [command, ...options].
 * Return false for an unrecognized unprefixed command so the shared CLI can
 * continue its existing dispatch. A selected jobs command reports its errors.
 */
export async function runPaidJobClientCommand(argv, {
  print = value => process.stdout.write(typeof value === 'string' ? value + '\n' : JSON.stringify(value, null, 2) + '\n'),
  environment = process.env,
  signal
} = {}) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw usage('Supply the original CLI argument array.');
  const prefixed = argv[0] === 'jobs', args = prefixed ? argv.slice(1) : argv.slice();
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) {
    if (!prefixed && !args.length) return false;
    if (args.length > 1) throw usage('Use help without additional options.');
    await print(PAID_JOB_CLIENT_HELP); return true;
  }
  const command = args.shift();
  if (!COMMANDS.has(command)) {
    if (!prefixed) return false;
    throw usage('Choose jobs inspect, download or reopen.');
  }
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    await print(PAID_JOB_CLIENT_HELP); return true;
  }
  const flags = parse(args), expectedManifestSha256 = flags['manifest-sha256'];
  signal?.throwIfAborted();
  let result;
  if (command === 'reopen') {
    allowed(flags, ['out', 'dir', 'workspace', 'export-id', 'manifest-sha256']);
    const directory = flags.out ?? flags.dir;
    if (!directory) throw usage('Supply the retained directory with --dir.');
    result = await reopenPaidJobExport({
      directory, workspace: flags.workspace, exportId: flags['export-id'],
      expectedManifestSha256, signal
    });
  } else {
    required(flags, ['url', 'workspace', 'export-id']);
    allowed(flags, ['url', 'workspace', 'export-id', 'manifest-sha256', 'token-env',
      ...(command === 'download' ? ['out', 'dir'] : [])]);
    const connection = {
      url: flags.url, workspace: flags.workspace, exportId: flags['export-id'],
      tokenEnv: flags['token-env'], environment, expectedManifestSha256, signal
    };
    if (command === 'inspect') result = await inspectPaidJobExport(connection);
    else {
      const directory = flags.out ?? flags.dir;
      if (!directory) throw usage('Supply a private receiving directory with --out.');
      result = await downloadPaidJobExport({ ...connection, directory });
    }
  }
  await print(result); return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const control = new AbortController();
  const stop = () => control.abort(Object.assign(new Error('The receiving command was interrupted.'), { code: 'ABORT_ERR' }));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    await runPaidJobClientCommand(['jobs', ...process.argv.slice(2)], { signal: control.signal });
  } catch (error) {
    process.stderr.write(JSON.stringify({
      code: error?.code ?? 'JOB_AGENT_CLI_FAILED',
      message: typeof error?.message === 'string' ? error.message : 'The original receiving operation failed.'
    }) + '\n');
    process.exitCode = control.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
