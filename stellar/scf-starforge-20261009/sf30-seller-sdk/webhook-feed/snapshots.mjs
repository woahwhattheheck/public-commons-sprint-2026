// MIT. Private portable snapshots preserve the original store and cursor identities.
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, writeFile, chmod, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FeedError, SCHEMA } from './model.mjs';

export async function fileIdentity(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new FeedError('REGULAR_FILE_REQUIRED', 422);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return { bytes: info.size, sha256: hash.digest('hex') };
}
export async function createSnapshot({ store, directory }) {
  const target = resolve(directory); await mkdir(target, { mode: 0o700 });
  try {
    const database = resolve(target, 'events.sqlite'); await store.backupTo(database);
    const inspection = new DatabaseSync(database, { readOnly: true });
    let captured;
    try {
      captured = { storeId: inspection.prepare("SELECT value FROM metadata WHERE key='storeId'").get().value,
        highWatermark: inspection.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM identities').get().n,
        acceptedEvents: inspection.prepare('SELECT COUNT(*) AS n FROM identities').get().n,
        retainedEvents: inspection.prepare('SELECT COUNT(*) AS n FROM events').get().n,
        purgedThroughSequence: Number(inspection.prepare("SELECT value FROM metadata WHERE key='purgedThrough'").get().value) };
    } finally { inspection.close(); }
    const manifest = { schema: 'stellar-forge.webhook-feed-backup.v1', createdAt: new Date().toISOString(),
      ...captured, database: { name: 'events.sqlite', ...await fileIdentity(database) } };
    await writeFile(resolve(target, 'snapshot.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { directory: target, ...manifest };
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}
export async function restoreSnapshot({ directory, destination }) {
  const source = resolve(directory), target = resolve(destination);
  const manifest = JSON.parse(await readFile(resolve(source, 'snapshot.json'), 'utf8'));
  if (manifest.schema !== 'stellar-forge.webhook-feed-backup.v1' || manifest.database?.name !== 'events.sqlite' || !/^[a-f0-9]{64}$/.test(manifest.database.sha256 ?? '')) throw new FeedError('INVALID_SNAPSHOT', 422);
  const database = resolve(source, 'events.sqlite'), actual = await fileIdentity(database);
  if (actual.sha256 !== manifest.database.sha256 || actual.bytes !== manifest.database.bytes) throw new FeedError('SNAPSHOT_DIGEST_MISMATCH', 409);
  const inspection = new DatabaseSync(database, { readOnly: true });
  try {
    if (inspection.prepare('PRAGMA user_version').get().user_version !== 1 ||
        inspection.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value !== SCHEMA ||
        inspection.prepare("SELECT value FROM metadata WHERE key='storeId'").get()?.value !== manifest.storeId)
      throw new FeedError('SNAPSHOT_IDENTITY_MISMATCH', 409);
    const captured = {
      highWatermark: inspection.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM identities').get().n,
      acceptedEvents: inspection.prepare('SELECT COUNT(*) AS n FROM identities').get().n,
      retainedEvents: inspection.prepare('SELECT COUNT(*) AS n FROM events').get().n,
      purgedThroughSequence: Number(inspection.prepare("SELECT value FROM metadata WHERE key='purgedThrough'").get()?.value),
    };
    if (Object.entries(captured).some(([key, value]) => !Number.isSafeInteger(value) || value < 0 || manifest[key] !== value))
      throw new FeedError('SNAPSHOT_METADATA_MISMATCH', 409);
  } finally { inspection.close(); }
  await mkdir(target, { mode: 0o700 });
  try {
    await copyFile(database, resolve(target, 'events.sqlite'), constants.COPYFILE_EXCL);
    await chmod(resolve(target, 'events.sqlite'), 0o600);
    const copied = await fileIdentity(resolve(target, 'events.sqlite'));
    if (copied.sha256 !== actual.sha256 || copied.bytes !== actual.bytes) throw new FeedError('SNAPSHOT_CHANGED_DURING_RESTORE', 409);
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
  return { directory: target, storeId: manifest.storeId, highWatermark: manifest.highWatermark, sha256: actual.sha256 };
}
export async function listSnapshots(directory) {
  let names; try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const name of names.sort()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) continue;
    try {
      const manifest = JSON.parse(await readFile(resolve(directory, name, 'snapshot.json'), 'utf8'));
      if (manifest.schema === 'stellar-forge.webhook-feed-backup.v1') result.push({ name, ...manifest });
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  return result;
}
