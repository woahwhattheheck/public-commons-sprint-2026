// MIT. Load an operator-selected JSON dataset once, before serving or export.
import { open, stat } from 'node:fs/promises';

const MAX_BYTES = 1024 * 1024;

export function validateResponseFile(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    throw new TypeError('responseFile must name a local JSON file');
  return value;
}

/** Preserve source bytes for export; provide valid JSON bytes for every value type. */
export async function readJsonResponseFile(path) {
  validateResponseFile(path);
  const selected = await stat(path);
  if (!selected.isFile() || selected.size > MAX_BYTES)
    throw new RangeError('responseFile must be a regular JSON file up to 1 MiB');
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES)
      throw new RangeError('responseFile must be a regular JSON file up to 1 MiB');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new RangeError('responseFile exceeds 1 MiB');
    const source = buffer.subarray(0, length);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
    JSON.parse(text);
    const body = Buffer.from(text);
    if (body.length > MAX_BYTES) throw new RangeError('Encoded responseFile exceeds 1 MiB');
    return { source, body };
  } finally {
    await file.close();
  }
}
