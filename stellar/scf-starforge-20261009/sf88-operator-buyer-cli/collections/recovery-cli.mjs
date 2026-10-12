// MIT. The installed collections CLI over the original encrypted state engine.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { openCollections } from './model.mjs';
import { openCollectionRecovery } from './recovery-jobs.mjs';
import { initializationBytes } from '../initialization.mjs';

const HELP = [
  'Request Collections backup and receiving',
  '',
  '  starforge buyer-collections backup-review --directory ABS --state-root ABS',
  '  starforge buyer-collections backup-create --directory ABS --state-root ABS --out ABS',
  '    --review-sha256 SHA --quiesced [--request-id UUID] [--pass-env NAME]',
  '  starforge buyer-collections backup-verify --receiving-directory ABS --bundle ABS',
  '    [--record-sha256 SHA] [--request-id UUID] [--pass-env NAME] [--python ABS]',
  '  starforge buyer-collections backup-restore --receiving-directory ABS --bundle ABS',
  '    --record-sha256 SHA --state-root ORIGINAL_ABS [--request-id UUID] [--pass-env NAME] [--python ABS]',
  '  starforge buyer-collections backup-history --directory ABS [--offset N] [--limit N]',
  '  starforge buyer-collections backup-show --directory ABS --request-id UUID',
  '  starforge buyer-collections backup-resume --directory ABS --request-id UUID',
  '',
  'Use --receiving-directory instead of --directory for history/show/resume on a receiver.',
  'Start its browser with: starforge buyer-collections serve --receiving-directory ABS',
  '',
  'The passphrase is read only from the named host environment variable (at least 16 UTF-8 bytes).',
  'Store the encrypted output outside the selected state root. Retain the complete native',
  'manifest.json and objects/ directory. The separate wallet secret is never exported.',
  '--quiesced declares that the original buyer/inbox clients are stopped. The application',
  'drains its own collection writers; it does not stop a different owner’s process.',
  'Restore uses the original canonical root and refuses a populated target.',
  'An unfinished operation is recovered only with its same request ID. Recorded failures',
  'and cancellations remain final; review the source and create a new explicit operation.',
  'Backup, verification, restore and reopen never run queued requests.',
].join('\n') + '\n';
function need(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }
function parse(args) {
  const result = {};
  const names = new Set(['--directory','--receiving-directory','--state-root','--out','--review-sha256',
    '--request-id','--pass-env','--bundle','--record-sha256','--python','--offset','--limit','--quiesced']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    need(names.has(flag) && !Object.hasOwn(result, flag), 'COLLECTION_RECOVERY_ARGUMENT_INVALID');
    if (flag === '--quiesced') { result[flag] = true; continue; }
    const value = args[++i]; need(typeof value === 'string' && value.length && !value.startsWith('--'),
      'COLLECTION_RECOVERY_ARGUMENT_VALUE_REQUIRED'); result[flag] = value;
  }
  return result;
}
function count(value, fallback) {
  if (value === undefined) return fallback;
  need(/^[0-9]{1,8}$/.test(value), 'COLLECTION_RECOVERY_PAGE_INVALID'); return Number(value);
}
export async function main(args = process.argv.slice(2), { environment = process.env } = {}) {
  if (!args.length || args.includes('--help')) { process.stdout.write(HELP); return null; }
  const [command, ...rest] = args, v = parse(rest);
  const commands = new Set(['backup-review','backup-create','backup-verify','backup-restore',
    'backup-history','backup-show','backup-resume']);
  need(commands.has(command), 'COLLECTION_RECOVERY_COMMAND_INVALID');
  need(Boolean(v['--directory']) !== Boolean(v['--receiving-directory']), 'COLLECTION_ONE_WORKSPACE_SOURCE_REQUIRED');
  const allowed = {
    'backup-review': ['--directory','--state-root'],
    'backup-create': ['--directory','--state-root','--out','--review-sha256','--quiesced','--request-id','--pass-env'],
    'backup-verify': ['--directory','--receiving-directory','--bundle','--record-sha256','--request-id','--pass-env','--python'],
    'backup-restore': ['--receiving-directory','--bundle','--record-sha256','--state-root','--request-id','--pass-env','--python'],
    'backup-history': ['--directory','--receiving-directory','--offset','--limit'],
    'backup-show': ['--directory','--receiving-directory','--request-id'],
    'backup-resume': ['--directory','--receiving-directory','--request-id'],
  };
  need(Object.keys(v).every(key => allowed[command].includes(key)), 'COLLECTION_RECOVERY_ARGUMENT_INVALID');
  let collections, recovery, interrupted = null;
  const stop = code => { interrupted = code; void recovery?.close(); };
  const interrupt = () => stop(130), terminate = () => stop(143);
  try {
    if (v['--directory']) {
      await initializationBytes(join(v['--directory'], 'collections.json'), 65536);
      collections = await openCollections({ directory: v['--directory'], existingOnly: true });
    }
    recovery = await openCollectionRecovery({ directory: v['--receiving-directory']
      ?? join(collections.directory, 'recovery'), getCollections: () => collections, environment });
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    let result;
    if (command === 'backup-review') result = await recovery.review({ stateRoot: v['--state-root'] });
    else if (command === 'backup-history') result = await recovery.list({
      offset: count(v['--offset'], 0), limit: count(v['--limit'], 50) });
    else if (command === 'backup-show') result = await recovery.inspect(v['--request-id']);
    else {
      let started;
      if (command === 'backup-resume') started = await recovery.resume(v['--request-id']);
      else {
        const kind = command === 'backup-create' ? 'SNAPSHOT' : command === 'backup-verify' ? 'VERIFY' : 'RESTORE';
        const options = kind === 'SNAPSHOT' ? {
          stateRoot: v['--state-root'], output: v['--out'], expectedReviewSha256: v['--review-sha256'],
          quiesced: v['--quiesced'] === true,
        } : { bundle: v['--bundle'],
          ...(v['--record-sha256'] ? { expected: v['--record-sha256'] } : {}),
          ...(v['--state-root'] ? { expectedStateRoot: v['--state-root'] } : {}),
          ...(v['--python'] ? { python: v['--python'] } : {}) };
        if (v['--pass-env']) options.passEnv = v['--pass-env'];
        started = await recovery.start({ requestId: v['--request-id'] ?? randomUUID(), kind, options });
      }
      process.stderr.write(JSON.stringify({ requestId: started.requestId, state: started.state,
        recoveryDirectory: recovery.directory }) + '\n');
      result = await recovery.wait(started.requestId);
      if (result.state !== 'COMPLETED' || result.persistenceError || result.result?.reopenError
        || result.result?.nativeReopenErrors?.length) process.exitCode = 2;
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    await recovery?.close(); await collections?.close();
    if (interrupted !== null) process.exitCode = interrupted;
  }
}
