// MIT. Publish complete receiving checkpoints before exposing their final names.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { open, readFile, link, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const encode = value => JSON.stringify(value, null, 2) + '\n';

async function syncDirectory(path) {
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
async function completeTemporary(path, bytes) {
  const temporary = join(dirname(path), '.' + basename(path) + '.' + randomUUID() + '.pending');
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await file.close();
  return temporary;
}
export async function writeNew(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let existing;
  try { existing = await readFile(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing !== undefined) {
    assert.deepEqual(existing, bytes, 'Retained receiving file changed: ' + path);
    return;
  }
  const temporary = await completeTemporary(path, bytes);
  try {
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.deepEqual(await readFile(path), bytes, 'Retained receiving file changed: ' + path);
    }
    await syncDirectory(path);
  } finally { await unlink(temporary); }
}
export async function retainJson(path, value) {
  return writeNew(path, encode(value));
}
export async function atomicJson(path, value) {
  const temporary = await completeTemporary(path, encode(value));
  try {
    await rename(temporary, path);
    await syncDirectory(path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
