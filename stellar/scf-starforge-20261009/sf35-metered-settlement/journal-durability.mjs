// MIT. Persistence boundary for one-use payment authorization journals.
// fsync(file) does not persist directory entries made by O_EXCL, mkdir or rename.
import { open } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

async function syncDirectory(path, openDirectory) {
  const directory = await openDirectory(path, 'r');
  try { await directory.sync(); }
  finally { await directory.close(); }
}

export async function syncParentDirectory(file, openDirectory = open) {
  await syncDirectory(dirname(file), openDirectory);
}

// Recursive mkdir can create multiple ancestors. Persist each new child in its
// parent, innermost-first, before reserving a one-use signed authorization.
export async function syncCreatedDirectoryChain(journalDir, firstCreated, openDirectory = open) {
  if (!firstCreated) return;
  const deepest = resolve(journalDir), first = resolve(firstCreated);
  if (deepest !== first && !deepest.startsWith(first + sep))
    throw new Error('JOURNAL_DIRECTORY_TREE_MISMATCH');
  const existingParent = dirname(first);
  for (let dir = deepest;; dir = dirname(dir)) {
    await syncDirectory(dir, openDirectory);
    if (dir === existingParent) break;
  }
}
