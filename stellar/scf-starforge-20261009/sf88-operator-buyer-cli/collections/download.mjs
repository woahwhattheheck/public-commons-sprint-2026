// MIT. Stream one already-saved, pinned collection file through its held handle.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';

function need(value, code) {
  if (!value) throw Object.assign(new Error(code), { code, status: 409 });
}
export async function sendCollectionFile(response, file, { signal } = {}) {
  need(file && typeof file.path === 'string' && isAbsolute(file.path)
    && !file.path.includes('\0') && /^[A-Za-z0-9._-]{1,150}$/.test(file.name)
    && !['.', '..'].includes(file.name) && Number.isSafeInteger(file.bytes)
    && file.bytes >= 0 && /^[a-f0-9]{64}$/.test(file.sha256),
    'COLLECTION_DOWNLOAD_INVALID');
  const check = () => {
    if (signal?.aborted) throw signal.reason;
    need(!response.destroyed, 'COLLECTION_DOWNLOAD_CANCELLED');
  };
  const handle = await open(file.path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    check();
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.size === BigInt(file.bytes), 'COLLECTION_DOWNLOAD_CHANGED');
    const hash = createHash('sha256'), buffer = Buffer.alloc(256 * 1024);
    let position = 0;
    while (position < file.bytes) {
      check();
      const { bytesRead } = await handle.read(buffer, 0,
        Math.min(buffer.length, file.bytes - position), position);
      need(bytesRead > 0, 'COLLECTION_DOWNLOAD_CHANGED');
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    need(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key])
      && hash.digest('hex') === file.sha256, 'COLLECTION_DOWNLOAD_CHANGED');
    check();
    response.writeHead(200, { 'Content-Type': 'application/octet-stream',
      'Content-Length': file.bytes, 'X-Content-SHA256': file.sha256,
      'Content-Disposition': 'attachment; filename="' + file.name + '"' });
    if (file.bytes === 0) response.end();
    else await pipeline(handle.createReadStream({
      start: 0, end: file.bytes - 1, autoClose: false,
    }), response, { signal });
  } finally { await handle.close(); }
}
