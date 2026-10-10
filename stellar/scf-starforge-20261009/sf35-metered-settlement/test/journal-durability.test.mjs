// MIT. Focused original journal directory-durability acceptance on Linux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { syncParentDirectory, syncCreatedDirectoryChain } from '../journal-durability.mjs';

test('persists recursive mkdir, one-use reservation and rename parent; fails closed on sync EIO', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf35-dentry-'));
  const directory = join(root, 'a', 'b');
  const file = join(directory, 'authorization.json');
  try {
    const created = await mkdir(directory, { recursive: true, mode: 0o700 });
    await syncCreatedDirectoryChain(directory, created); // Actual POSIX fsync on every new directory + parent.
    await writeFile(file, '{"status":"RESERVED"}\n');
    await syncParentDirectory(file); // Actual POSIX fsync of reservation entry.
    const order = [];
    await syncCreatedDirectoryChain(directory, created, async (path, mode) => {
      assert.equal(mode, 'r');
      return { async sync() { order.push(path); }, async close() { order.push('closed'); } };
    });
    assert.deepEqual(order, [directory, 'closed', dirname(directory), 'closed', root, 'closed']);
    await assert.rejects(syncParentDirectory(file, async () => ({
      async sync() { throw new Error('injected EIO'); },
      async close() { order.push('closed-on-error'); },
    })), /injected EIO/);
    assert.equal(order.at(-1), 'closed-on-error');
    await assert.rejects(syncCreatedDirectoryChain(root, join(tmpdir(), 'wrong-parent')), /JOURNAL_DIRECTORY_TREE_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
