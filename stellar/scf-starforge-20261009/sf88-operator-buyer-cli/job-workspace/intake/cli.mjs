// MIT. Installed self-service commands share the original job-workspace lifecycle.
import { dirname } from 'node:path';
import { lstat } from 'node:fs/promises';
import { readBytes, parseJson, absolute, privateDirectory, writeBytes, digest } from '../../node/store.mjs';
import { need, MAX_CATALOG_BYTES } from '../../../sf30-seller-sdk/jobs/intake/protocol.mjs';

export const INTAKE_COMMAND_OPTIONS = Object.freeze({
  'request-catalog': ['--origin', '--out'],
  'request-draft': ['--catalog-file', '--origin', '--function', '--input', '--label', '--reference', '--intake-key-file'],
  'request-list': ['--query', '--phase', '--offset', '--limit'],
  'request-show': ['--request'],
  'request-prepare': ['--request', '--expected-revision', '--operator-workspace', '--operator-profile', '--runtime'],
  'request-import': ['--request', '--expected-revision', '--operator-workspace', '--operator-profile', '--runtime'],
  'request-withdraw': ['--request', '--expected-revision', '--reason'],
  'request-access': ['--request', '--expected-revision', '--intake-key-file'],
  'request-ticket': ['--request', '--out'],
});
export const INTAKE_HELP = [
  'request-catalog  --origin HTTPS_ORIGIN [--out ABS]',
  'request-draft    --catalog-file ABS or --origin HTTPS_ORIGIN',
  '                 --function ID --input ABS [--label TEXT] [--reference TEXT]',
  '                 [--intake-key-file ABS]',
  'request-list     [--query TEXT] [--phase PHASE] [--offset N] [--limit N]',
  'request-show     --request ID',
  'request-prepare  --request ID --expected-revision N',
  'request-import   --request ID --expected-revision N',
  'request-withdraw --request ID --expected-revision N --reason TEXT',
  'request-access   --request ID --expected-revision N --intake-key-file ABS',
  'request-ticket   --request ID --out NEW_PRIVATE_FILE',
  '',
  'Every request command uses --state ABS. Prepare/import can select the',
  'existing --operator-workspace ABS or --operator-profile ABS and --runtime ABS.',
  'The request and claim are saved before its inputs are sent. Prepare resumes',
  'that same reference and imports the merchant ticket into original Checkout.',
  '',
].join('\n');

async function accessToken(path) {
  path = absolute(path);
  const stat = await lstat(path);
  need(stat.isFile() && !stat.isSymbolicLink() &&
    (process.platform === 'win32' || !(stat.mode & 0o077) && (!process.getuid || stat.uid === process.getuid())),
    'JOB_INTAKE_PRIVATE_ACCESS_FILE_REQUIRED');
  return (await readBytes(path, 2048)).toString('utf8').trim();
}
async function saveNew(path, bytes) {
  path = absolute(path); await privateDirectory(dirname(path));
  await writeBytes(path, bytes, { exclusive: true });
  return { path, bytes: bytes.length, sha256: digest(bytes) };
}
export async function runIntakeCommand({ model, command, flags, signal, print }) {
  const required = flag => { need(flags.has(flag), 'JOB_INTAKE_COMMAND_OPTION_REQUIRED'); return flags.get(flag); };
  const number = (flag, fallback) => flags.has(flag) ? Number(flags.get(flag)) : fallback;
  const intake = model.intake;
  if (command === 'request-catalog') {
    const catalog = await intake.discover({ origin: required('--origin'), signal });
    return print(flags.has('--out') ? await saveNew(flags.get('--out'), Buffer.from(JSON.stringify(catalog, null, 2) + '\n')) : catalog);
  }
  if (command === 'request-draft') {
    need(flags.has('--catalog-file') !== flags.has('--origin'), 'JOB_INTAKE_CATALOG_SOURCE_REQUIRED');
    const catalog = flags.has('--catalog-file') ?
      parseJson(await readBytes(absolute(flags.get('--catalog-file')), MAX_CATALOG_BYTES)) :
      await intake.discover({ origin: flags.get('--origin'), signal });
    const result = await intake.draft({ catalog, functionId: required('--function'),
      input: parseJson(await readBytes(absolute(required('--input')), 2097152)),
      ...(flags.has('--label') ? { label: flags.get('--label') } : {}),
      ...(flags.has('--reference') ? { reference: flags.get('--reference') } : {}),
      accessToken: flags.has('--intake-key-file') ? await accessToken(flags.get('--intake-key-file')) : null });
    return print(result);
  }
  if (command === 'request-list') return print(intake.list({ q: flags.get('--query') ?? '',
    phase: flags.get('--phase') ?? '', offset: number('--offset', 0), limit: number('--limit', 50) }));
  const id = required('--request');
  if (command === 'request-show') return print(await intake.get(id));
  if (command === 'request-ticket') return print(await saveNew(required('--out'), await intake.ticket(id)));
  if (command === 'request-access') return print(await intake.setAccess(id, {
    expectedRevision: number('--expected-revision'), accessToken: await accessToken(required('--intake-key-file')) }));
  const kind = { 'request-prepare': 'prepare', 'request-import': 'import', 'request-withdraw': 'withdraw' }[command];
  need(kind, 'JOB_INTAKE_COMMAND_INVALID');
  const stop = () => { void intake.cancel(id).catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    signal?.throwIfAborted();
    await intake.start(id, { kind, expectedRevision: number('--expected-revision'),
      ...(kind === 'withdraw' ? { reason: required('--reason') } : {}) });
    if (signal?.aborted) stop();
    const result = await intake.wait(id); print(result);
    need(result.task?.state === 'COMPLETE', result.task?.error ?? 'JOB_INTAKE_OPERATION_FAILED');
  } finally { signal?.removeEventListener('abort', stop); }
}
