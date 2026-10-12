// MIT. Whole archive download from the retained export over the original private listener.
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { need } from './manifest.mjs';

export async function streamEdgarOperatorArchive(req, res, selected, extra = {}) {
  const handle = await open(selected.archivePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    need(before.isFile() && String(before.size) === selected.archive.bytes,
      'EDGAR_PORTABLE_ARCHIVE_CHANGED');
    let count = 0;
    const hash = createHash('sha256');
    const verify = new Transform({
      transform(chunk, _encoding, done) {
        count += chunk.length;
        if (count > before.size) return done(Object.assign(new Error('The retained archive changed.'), { code: 'EDGAR_PORTABLE_ARCHIVE_CHANGED' }));
        hash.update(chunk); done(null, chunk);
      },
      flush(done) {
        (async () => {
          const after = await handle.stat(), current = await lstat(selected.archivePath);
          need(count === before.size && hash.digest('hex') === selected.archive.sha256 &&
            current.isFile() && !current.isSymbolicLink() &&
            before.dev === current.dev && before.ino === current.ino &&
            ['size', 'mtimeMs', 'ctimeMs'].every(name => before[name] === after[name]),
          'EDGAR_PORTABLE_ARCHIVE_CHANGED');
        })().then(() => done(), done);
      },
    });
    res.writeHead(200, {
      'content-type': 'application/zip', 'content-length': selected.archive.bytes,
      'content-disposition': 'attachment; filename="sec-edgar-workspace.zip"',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
      'x-content-sha256': selected.archive.sha256, ...extra,
    });
    await pipeline(handle.createReadStream({ autoClose: false }), verify, res);
  } finally { await handle.close(); }
}
