#!/usr/bin/env node
// MIT. Operator storage maintenance borrows the original merchant model and lease.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { need } from '../intake/protocol.mjs';

const HELP = [
  'Merchant original input files',
  '',
  'jobs inputs list --config ABS --state ABS [--reference JOB] [--function ID]',
  '                 [--offset N] [--limit N]',
  'jobs inputs show --config ABS --state ABS --upload ID',
  'jobs inputs discard --config ABS --state ABS --upload ID --revision N',
  '                    --reason TEXT [--release-orphan]',
  '',
  'These commands own the same merchant state lease as jobs serve. Use them',
  'after that owner closes. List shows exact reserved bytes, sealing and pins.',
  'Discard removes an upload that no original job uses. --release-orphan',
  'permits a pin left before a failed original job commit; it never removes',
  'files belonging to a retained job or a job being prepared.',
  'Customer staging, resumable transfer and purchase use job-workspace request',
  'commands and the merchant customer listener.',
].join('\n') + '\n';
export async function runJobInputCommand(args = process.argv.slice(2), {
  print = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'),
} = {}) {
  if (!args.length || args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) return print(HELP);
  const [command, ...rest] = args;
  const options = { list: ['--reference', '--function', '--offset', '--limit'],
    show: ['--upload'], discard: ['--upload', '--revision', '--reason', '--release-orphan'] };
  need(Object.hasOwn(options, command), 'JOB_INPUT_COMMAND_INVALID');
  const allowed = new Set(['--config', '--state', ...options[command]]), flags = new Map();
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index]; need(allowed.has(key) && !flags.has(key), 'JOB_INPUT_COMMAND_OPTION_INVALID');
    if (key === '--release-orphan') { flags.set(key, true); continue; }
    const value = rest[++index];
    need(typeof value === 'string' && value && !value.startsWith('--'), 'JOB_INPUT_COMMAND_VALUE_REQUIRED');
    flags.set(key, value);
  }
  const required = key => { need(flags.has(key), 'JOB_INPUT_COMMAND_OPTION_REQUIRED'); return flags.get(key); };
  const integer = (key, fallback, min, max) => {
    const value = flags.has(key) ? Number(flags.get(key)) : fallback;
    need(Number.isSafeInteger(value) && value >= min && value <= max, 'JOB_INPUT_COMMAND_NUMBER_INVALID');
    return value;
  };
  const { openJobMerchant } = await import('../model.mjs');
  const model = await openJobMerchant({ configPath: resolve(required('--config')), directory: resolve(required('--state')) });
  try {
    need(model.inputs, 'JOB_INPUT_FUNCTION_FILES_NOT_CONFIGURED');
    if (command === 'list') {
      const rows = model.inputs.list({ reference: flags.get('--reference'), functionId: flags.get('--function') });
      const offset = integer('--offset', 0, 0, 100000), limit = integer('--limit', 50, 1, 200);
      return print(JSON.stringify({ total: rows.length, offset, limit, capacity: model.inputs.capacity(),
        items: rows.slice(offset, offset + limit) }, null, 2));
    }
    const id = required('--upload');
    if (command === 'show') return print(JSON.stringify({ upload: model.inputs.status(id),
      original: model.inputs.plan(id) }, null, 2));
    const reason = required('--reason');
    need(reason.trim() && reason.length <= 500 && !/[\x00-\x1f\x7f]/.test(reason), 'JOB_INPUT_REASON_REQUIRED');
    print(JSON.stringify(await model.inputs.discard({ id,
      expectedRevision: integer('--revision', undefined, 1, Number.MAX_SAFE_INTEGER),
      releaseOrphan: flags.has('--release-orphan'), reason }), null, 2));
  } finally { await model.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  runJobInputCommand().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
