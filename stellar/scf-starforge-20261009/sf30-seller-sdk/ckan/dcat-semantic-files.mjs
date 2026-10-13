// MIT. Complete local profile sources and streamed private semantic artifact export.
import { resolve, dirname } from 'node:path';
import { open, unlink, link } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { privateDirectory, syncDirectory, fault } from '../postgres/publisher/files.mjs';
async function sourceBytes(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
      throw fault('DCAT_SEMANTIC_PROFILE_INPUT_INVALID', 'Select a complete regular profile source within its size limit.');
    const output = Buffer.alloc(before.size + 1); let size = 0;
    while (size < output.length) {
      const { bytesRead } = await handle.read(output, size, output.length - size, null);
      if (!bytesRead) break; size += bytesRead;
    }
    const after = await handle.stat();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw fault('DCAT_SEMANTIC_PROFILE_INPUT_CHANGED');
    return output.subarray(0, size);
  } finally { await handle.close(); }
}
async function exportRetained(selected, out) {
  const parent = dirname(out); await privateDirectory(parent);
  const temporary = resolve(parent, '.semantic-export-' + randomUUID());
  let input, output, created = false;
  try {
    input = await open(selected.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await input.stat();
    if (!before.isFile() || before.nlink !== 1 || before.mode & 0o077 || before.size !== selected.bytes)
      throw fault('DCAT_SEMANTIC_FILE_CHANGED');
    output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024); let total = 0;
    while (true) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > selected.bytes) throw fault('DCAT_SEMANTIC_FILE_CHANGED');
      hash.update(buffer.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) {
        const wrote = await output.write(buffer, offset, bytesRead - offset, null);
        if (!wrote.bytesWritten) throw fault('DCAT_SEMANTIC_EXPORT_FAILED');
        offset += wrote.bytesWritten;
      }
    }
    const after = await input.stat();
    if (total !== selected.bytes || hash.digest('hex') !== selected.sha256 ||
        after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw fault('DCAT_SEMANTIC_FILE_CHANGED', 'The complete retained file changed before export.');
    await output.sync(); await output.close(); output = null;
    await link(temporary, out); // Create-only publication on the same filesystem.
    await unlink(temporary); created = false; await syncDirectory(parent);
  } finally {
    if (input) await input.close();
    if (output) await output.close();
    if (created) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export { sourceBytes, exportRetained };
