// MIT — Use the official SQLite saver and a private local checkpoint file.
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { createBuyerGraph } from './langgraph.mjs';
import { absolute, privateDirectory, need, syncDirectory } from '../store.mjs';

export async function createSqliteBuyerGraph({ databasePath, ...options }) {
  const path = absolute(databasePath);
  await privateDirectory(dirname(path));
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.sync();
    await syncDirectory(dirname(path));
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { if (handle) await handle.close(); }
  const stat = await lstat(path);
  need(stat.isFile() && !stat.isSymbolicLink(), 'PRIVATE_CHECKPOINT_FILE_REQUIRED');
  if (process.platform !== 'win32') {
    need((stat.mode & 0o077) === 0, 'PRIVATE_CHECKPOINT_FILE_REQUIRED');
    if (process.getuid) need(stat.uid === process.getuid(), 'CHECKPOINT_FILE_OWNER_MISMATCH');
  }
  const checkpointer = SqliteSaver.fromConnString(path);
  try {
    checkpointer.db.pragma('busy_timeout = 5000');
    const graph = createBuyerGraph({ ...options, checkpointer });
    let closed = false;
    return { graph, checkpointer, databasePath: path,
      close() { if (!closed) { checkpointer.db.close(); closed = true; } } };
  } catch (error) { checkpointer.db.close(); throw error; }
}
