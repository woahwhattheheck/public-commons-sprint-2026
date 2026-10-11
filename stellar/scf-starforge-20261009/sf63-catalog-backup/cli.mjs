#!/usr/bin/env node
/** Operator-invoked CLI; never starts a writer or submits payments. */
import { createSnapshot, verifySnapshot, restoreSnapshot } from './backup.mjs';
const [action, first, second, ...extra] = process.argv.slice(2);
const usage='Usage: node cli.mjs backup SOURCE_DIRECTORY NEW_BACKUP_DIRECTORY | verify BACKUP_DIRECTORY | restore BACKUP_DIRECTORY NEW_EMPTY_DIRECTORY [--expected-head 64_HEX_CURRENT_JOURNAL_HEAD]';
try {
  let result;
  const guardedRestore = action === 'restore' && extra.length === 2 && extra[0] === '--expected-head';
  if ((extra.length && !guardedRestore) || action === 'verify' && (!first || second)) throw new Error(usage);
  if (action === 'backup' && first && second) result=await createSnapshot(first,second);
  else if (action === 'verify' && first) result=await verifySnapshot(first);
  else if (action === 'restore' && first && second) result=await restoreSnapshot(first,second,undefined,guardedRestore ? extra[1] : null);
  else throw new Error(usage);
  console.log(JSON.stringify(result,null,2));
} catch(error) {
  console.error(JSON.stringify({decision:'REJECTED',error:String(error?.message ?? error)},null,2));
  process.exitCode=1;
}
