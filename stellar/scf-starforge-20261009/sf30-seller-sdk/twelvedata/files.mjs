// MIT. Reuse the original Node buyer's private, atomic, no-follow file primitives.
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, jsonBytes,
  digest, exists, syncDirectory } from '../../sf88-operator-buyer-cli/node/store.mjs';
export { privateDirectory, readBytes, readJson, writeBytes, writeJson, jsonBytes,
  digest, exists, syncDirectory };
export function relativeFile(name) {
  if (typeof name !== 'string' || !name || name.length > 512 ||
      name.split('/').some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)))
    throw new TypeError('Portable relative file name required');
  return name;
}
export async function putOnce(path, data) {
  data = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (await exists(path)) {
    const saved = await readBytes(path, data.length);
    if (digest(saved) !== digest(data)) throw new TypeError('Retained file identity changed');
    return;
  }
  await writeBytes(path, data, { exclusive: true });
}
export async function readBundle(directory, { schema, limit = 33554432 } = {}) {
  directory = await privateDirectory(resolve(directory), { create: false });
  const bytes = await readBytes(join(directory, 'manifest.json'), 1048576);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!manifest || manifest.schema !== schema || !Array.isArray(manifest.files) ||
      manifest.files.length > 128) throw new TypeError('Invalid retained bundle manifest');
  const files = new Map(); let total = 0;
  for (const file of manifest.files) {
    relativeFile(file.name);
    if (files.has(file.name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || (total += file.bytes) > limit)
      throw new TypeError('Invalid retained bundle inventory');
    const body = await readBytes(join(directory, file.name), file.bytes);
    if (body.length !== file.bytes || digest(body) !== file.sha256)
      throw new TypeError('Retained bundle file changed');
    files.set(file.name, body);
  }
  return { directory, manifest, manifestSha256: digest(bytes), files };
}
export async function publishBundle(directory, schema, identity, entries, details = {}) {
  directory = resolve(directory);
  if (entries.length>128 || entries.reduce((total,[,value])=>total+Buffer.byteLength(value),0)>33554432)
    throw new TypeError('Bundle exceeds the retained 32 MiB aggregate limit');
  if (await exists(directory)) {
    const prior = await readBundle(directory, { schema });
    if (prior.manifest.identity !== identity) throw new TypeError('Destination belongs to another retained bundle');
    return { directory, manifestSha256: prior.manifestSha256, reused: true, manifest: prior.manifest };
  }
  await privateDirectory(dirname(directory));
  const temporary = join(dirname(directory), '.market-export-' + randomUUID());
  await mkdir(temporary, { mode: 0o700 });
  try {
    const files = [], names = new Set();
    for (const [name, value] of entries) {
      relativeFile(name);
      if (names.has(name) || name === 'manifest.json') throw new TypeError('Duplicate bundle file');
      names.add(name);
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      await mkdir(dirname(join(temporary,name)), { recursive: true, mode: 0o700 });
      await writeBytes(join(temporary,name), bytes, { exclusive: true });
      files.push({ name, bytes: bytes.length, sha256: digest(bytes) });
    }
    const manifest = { schema, identity, ...details, files };
    const bytes = jsonBytes(manifest);
    await writeBytes(join(temporary,'manifest.json'), bytes, { exclusive: true });
    await syncDirectory(temporary);
    await rename(temporary, directory);
    await syncDirectory(dirname(directory));
    return { directory, manifestSha256: digest(bytes), reused: false, manifest };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
