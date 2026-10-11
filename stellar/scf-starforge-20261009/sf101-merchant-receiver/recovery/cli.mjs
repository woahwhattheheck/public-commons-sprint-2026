#!/usr/bin/env node
// MIT. Installed command for the original SF101 database and paid-file snapshot.
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const driver = fileURLToPath(new URL('./cli.py', import.meta.url));
const HELP = [
  'Merchant order recovery',
  '',
  'Create a consistent original merchant snapshot:',
  '  starforge merchant-order-recovery snapshot --state /private/merchant --out /private/snapshots/order-001',
  'Inspect an existing snapshot:',
  '  starforge merchant-order-recovery inspect --snapshot /private/snapshots/order-001',
  'Restore its database, access, usage and paid files into a new state directory:',
  '  starforge merchant-order-recovery restore --snapshot /private/snapshots/order-001 --out /private/restored-merchant',
  '',
  'Use --python /absolute/path/to/python3 or STARFORGE_PYTHON to select Python 3.11+.',
  'The original Python receipt is written to stdout. Snapshot and restore outputs are create-only.',
  '',
  'Encrypt the completed snapshot with the existing starforge merchant-recovery command.',
  'See recovery/README.md for the complete encrypted backup and restore workflow.',
].join('\n');

function pythonOptions(args, env) {
  let python = env.STARFORGE_PYTHON || 'python3', selected = false;
  const forwarded = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--python') { forwarded.push(args[i]); continue; }
    if (selected || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new TypeError('Use --python once with an executable path or name.');
    selected = true;
    python = args[++i];
  }
  if (typeof python !== 'string' || !python || python.includes('\0'))
    throw new TypeError('A Python executable is required.');
  return {python, forwarded};
}

/** Run the maintained command and return its process exit code. */
export async function main(args = process.argv.slice(2)) {
  const env = process.env;
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string'))
    throw new TypeError('Command arguments must be strings.');
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  if (!['snapshot', 'inspect', 'restore'].includes(args[0]))
    throw new TypeError('Choose snapshot, inspect, or restore. Use --help for the complete workflow.');
  const {python, forwarded} = pythonOptions(args, env);
  const child = spawn(python, ['-B', driver, ...forwarded], {
    env, stdio: ['ignore', 'inherit', 'inherit'], shell: false, windowsHide: true,
  });
  const stop = signal => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    return await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) =>
        accept(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)));
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write('SF101_RECOVERY_COMMAND_ERROR ' + String(error.message || error) + '\n');
    process.exitCode = 2;
  });
