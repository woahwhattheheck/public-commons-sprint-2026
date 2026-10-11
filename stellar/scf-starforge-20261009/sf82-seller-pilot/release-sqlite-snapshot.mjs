// MIT. One owned native SQLite backup process; original query workers stay separate.
import { DatabaseSync, backup } from 'node:sqlite';
import { lstat, realpath, open } from 'node:fs/promises';
import { resolve } from 'node:path';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
let finished = false;
process.once('disconnect', () => { if (!finished) process.exit(1); });
process.once('message', async input => {
  let database;
  try {
    if (input?.type !== 'sqlite-release-snapshot' || typeof input.database !== 'string' ||
        typeof input.target !== 'string' || !integer(input.maxBytes, 4096, 1099511627776))
      fail('SQLITE_SNAPSHOT_INPUT', 'Invalid native snapshot request.');
    const path = resolve(input.database), target = resolve(input.target);
    if (await realpath(path) !== path || await realpath(target) !== target || path === target)
      fail('SQLITE_SNAPSHOT_INPUT', 'Use distinct canonical source and snapshot files.');
    const before = await lstat(path, { bigint: true }), destination = await lstat(target, { bigint: true });
    if (!before.isFile() || !destination.isFile() || destination.size !== 0n ||
        String(before.dev) !== input.sourceIdentity?.device || String(before.ino) !== input.sourceIdentity?.inode)
      fail('SQLITE_SNAPSHOT_SOURCE_CHANGED', 'SQLite source or private destination changed before capture.');
    database = new DatabaseSync(path, { readOnly: true, allowExtension: false, timeout: 5000 });
    database.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA read_uncommitted=OFF; BEGIN');
    const scalar = sql => Object.values(database.prepare(sql).get())[0];
    // The first read pins one committed database view, including committed WAL.
    // Keep that same read transaction through the native online backup.
    const schemaVersion = scalar('PRAGMA schema_version'), pageCount = scalar('PRAGMA page_count');
    const pageSize = scalar('PRAGMA page_size'), userVersion = scalar('PRAGMA user_version');
    if (!integer(pageCount, 1, Number.MAX_SAFE_INTEGER) || !integer(pageSize, 512, 65536) ||
        BigInt(pageCount) * BigInt(pageSize) > BigInt(input.maxBytes))
      fail('SQLITE_SNAPSHOT_SIZE', 'The native SQLite snapshot exceeds the selected byte limit.');
    const snapshot = { schema: 'stellar-forge.sqlite-release-capture.v1',
      startedAt: new Date().toISOString(), method: 'sqlite-online-backup',
      readOnly: true, isolation: 'single-connection-read-transaction',
      queryOnly: scalar('PRAGMA query_only'), readUncommitted: scalar('PRAGMA read_uncommitted'),
      journalMode: scalar('PRAGMA journal_mode'), sqliteVersion: scalar('SELECT sqlite_version()'),
      pageCount, pageSize, schemaVersion, userVersion, sourceIdentity: input.sourceIdentity };
    if (snapshot.queryOnly !== 1 || snapshot.readUncommitted !== 0)
      fail('SQLITE_SNAPSHOT_POLICY', 'The native source did not retain its read-only snapshot settings.');
    await backup(database, target, { rate: 128 });
    database.exec('COMMIT'); database.close(); database = null;
    const after = await lstat(path, { bigint: true }), captured = await lstat(target, { bigint: true });
    if (await realpath(path) !== path || after.dev !== before.dev || after.ino !== before.ino)
      fail('SQLITE_SNAPSHOT_SOURCE_CHANGED', 'SQLite source identity changed during capture.');
    if (!captured.isFile() || captured.size > BigInt(input.maxBytes) || captured.size < 512n)
      fail('SQLITE_SNAPSHOT_SIZE', 'The completed native snapshot has an invalid size.');
    const handle = await open(target, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    snapshot.completedAt = new Date().toISOString();
    finished = true;
    process.send({ type: 'complete', snapshot }, () => process.disconnect());
  } catch (error) {
    try { database?.close(); } catch { /* The owned process is closing. */ }
    process.exitCode = 1; finished = true;
    process.send?.({ type: 'failed', code: error.code ?? 'SQLITE_SNAPSHOT_FAILED',
      message: String(error.message ?? error).slice(0, 500) }, () => process.disconnect());
  }
});
