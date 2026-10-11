#!/usr/bin/env node
// MIT. Offline create-only SF98 merchant outbox backup/verify/restore/compare.
import { backupOutbox, verifyBackup, restoreOutbox, compareOutbox } from './continuity.mjs';
const HELP = 'Usage: cli.mjs backup <original-private-outbox> <new-backup-directory> | verify <backup-directory> | compare <backup-directory> <original-live-outbox> | restore <backup-directory> <new-empty-directory> --expected-fingerprint <64-hex-sha256>';
export async function main(args = process.argv.slice(2)) {
  const [verb, ...params] = args;
  let result;
  if (verb === 'backup' && params.length === 2) result = await backupOutbox(...params);
  else if (verb === 'verify' && params.length === 1) {
    const checked = await verifyBackup(params[0]);
    result = { operation: checked.operation, sourceFingerprint: checked.sourceFingerprint, summary: checked.summary };
  } else if (verb === 'compare' && params.length === 2) result = await compareOutbox(...params);
  else if (verb === 'restore' && params.length === 4 && params[2] === '--expected-fingerprint')
    result = await restoreOutbox(params[0], params[1], params[3]);
  else throw new Error(HELP);
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href)
  main().catch(e => { process.stderr.write(String(e?.message || e) + '\n'); process.exitCode = 1; });
