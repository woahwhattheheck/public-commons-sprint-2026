// MIT. Publish an operator export without replacing an existing file.
import { randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export async function saveExport(filename, result) {
  const destination = resolve(filename);
  const temporary = join(dirname(destination), '.' + basename(destination) + '.' + randomUUID() + '.tmp');
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(result, null, 2) + '\n', 'utf8');
    await file.sync(); await file.close(); file = undefined;
    await link(temporary, destination);
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
