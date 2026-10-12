#!/usr/bin/env node
// MIT. Original merchant input receiving shares the model, storage and lease.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { need } from '../intake/protocol.mjs';

const HELP = [
  'Merchant original input files',
  '',
  'jobs inputs list --config ABS --state ABS [--reference JOB] [--function ID]',
  '                 [--offset N] [--limit N]',
  'jobs inputs show --config ABS --state ABS --upload ID',
  'jobs inputs preview --config ABS --state ABS --upload ID [--max-bytes N]',
  'jobs inputs download --config ABS --state ABS --upload ID --out ABS [--resume]',
  'jobs inputs discard --config ABS --state ABS --upload ID --revision N',
  '                    --reason TEXT [--release-orphan]',
  '',
  'The live merchant workspace includes Input receiving. These offline commands',
  'own the same merchant state lease as jobs serve; close that owner first.',
  'List shows exact reserved bytes, sealing and pins. Show includes the original',
  'plan, current policy and retained job. Preview verifies the whole sealed file',
  'and returns at most 256 KiB. Download creates a private file; --resume verifies',
  'every retained prefix byte before continuing the same original into it.',
  'Discard removes an upload that no original job or preparation uses.',
  '--release-orphan permits a pin left before a failed original job commit.',
  'Customer staging, resumable transfer and purchase use job-workspace request',
  'commands and the merchant customer listener.',
].join('\n') + '\n';
export async function runJobInputCommand(args = process.argv.slice(2), {
  print = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'),
} = {}) {
  if (!args.length || args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) return print(HELP);
  const [command, ...rest] = args;
  const options = { list: ['--reference', '--function', '--offset', '--limit'],
    show: ['--upload'], preview: ['--upload', '--max-bytes'], download: ['--upload', '--out', '--resume'],
    discard: ['--upload', '--revision', '--reason', '--release-orphan'] };
  need(Object.hasOwn(options, command), 'JOB_INPUT_COMMAND_INVALID');
  const booleans = new Set(['--release-orphan', '--resume']);
  const allowed = new Set(['--config', '--state', ...options[command]]), flags = new Map();
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index]; need(allowed.has(key) && !flags.has(key), 'JOB_INPUT_COMMAND_OPTION_INVALID');
    if (booleans.has(key)) { flags.set(key, true); continue; }
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
  const { openJobInputWorkspace } = await import('./workspace/model.mjs');
  const model = await openJobMerchant({ configPath: resolve(required('--config')), directory: resolve(required('--state')) });
  let desk, primary;
  const controller = new AbortController();
  const stop = () => controller.abort(Object.assign(new Error('JOB_INPUT_OPERATION_CANCELLED'), { code: 'JOB_INPUT_OPERATION_CANCELLED' }));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    need(model.inputs, 'JOB_INPUT_FUNCTION_FILES_NOT_CONFIGURED');
    desk = openJobInputWorkspace({ model });
    if (command === 'list') {
      // Preserve the original list output and filter contract for existing callers.
      const rows = model.inputs.list({ reference: flags.get('--reference'), functionId: flags.get('--function') });
      const offset = integer('--offset', 0, 0, 100000), limit = integer('--limit', 50, 1, 200);
      return print(JSON.stringify({ total: rows.length, offset, limit, capacity: model.inputs.capacity(),
        items: rows.slice(offset, offset + limit) }, null, 2));
    }
    const id = required('--upload');
    if (command === 'show') return print(JSON.stringify(await desk.get(id), null, 2));
    if (command === 'preview') return print(JSON.stringify(await desk.preview(id,
      { signal: controller.signal, maxBytes: integer('--max-bytes', 262144, 1, 262144) }), null, 2));
    if (command === 'download') return print(JSON.stringify(await desk.save(id, {
      path: resolve(required('--out')), resume: flags.has('--resume'), signal: controller.signal,
    }), null, 2));
    const reason = required('--reason');
    print(JSON.stringify(await desk.discard({ id,
      expectedRevision: integer('--revision', undefined, 1, Number.MAX_SAFE_INTEGER),
      releaseOrphan: flags.has('--release-orphan'), reason }), null, 2));
  } catch (error) { primary = error; throw error; }
  finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    const errors = [];
    for (const close of [() => desk?.close(), () => model.close()])
      try { await close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError([...(primary ? [primary] : []), ...errors], 'JOB_INPUT_COMMAND_CLOSE_FAILED');
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  runJobInputCommand().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
