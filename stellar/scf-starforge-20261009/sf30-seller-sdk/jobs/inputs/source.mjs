// MIT. Read selected originals through their declared roots and the same open descriptor.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { relative, isAbsolute, sep, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { absolute, directory as sourceDirectory } from '../../../sf88-operator-buyer-cli/resource-library/files.mjs';
import { need } from '../intake/protocol.mjs';
import { PLAN_SCHEMA, FILE_SCHEMA, CHUNK_BYTES, validateFilePolicy, validateFile, validateUploadPlan, hash } from './protocol.mjs';
import { readChunk, sameFile } from './files.mjs';

const within = (path, root) => {
  const name = relative(root, path);
  return name !== '' && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name);
};
export async function openAllowedInput(path, roots) {
  path = absolute(path);
  need(Array.isArray(roots) && roots.some(root => within(path, root)), 'JOB_INPUT_FILE_OUTSIDE_ROOTS', 403);
  for (const root of roots.filter(root => within(path, root))) await sourceDirectory(root);
  need(await realpath(path) === path, 'JOB_INPUT_SYMLINK_SOURCE_REJECTED', 409);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat(); need(info.isFile(), 'JOB_INPUT_ORIGINAL_FILE_REQUIRED', 409);
    return { file, info, path, filename: basename(path), close: () => file.close() };
  } catch (error) { await file.close(); throw error; }
}
export async function planFromHandle({ file, origin, reference, functionId, slot, policy,
  filename, contentType, signal, onProgress = () => {} }) {
  policy = validateFilePolicy(policy);
  const before = await file.stat();
  need(before.isFile() && Object.hasOwn(policy.slots, slot), 'JOB_INPUT_ORIGINAL_FILE_REQUIRED', 409);
  // Metadata is checked before reading; all bytes stay bounded by the selected slot.
  validateFile({ schema: FILE_SCHEMA, filename, contentType, bytes: before.size,
    sha256: '0'.repeat(64), policySha256: policy.policySha256 }, policy, slot);
  const whole = createHash('sha256'), chunks = [];
  for (let position = 0; position < before.size; position += CHUNK_BYTES) {
    const body = await readChunk(file, Math.min(CHUNK_BYTES, before.size - position), position, signal);
    whole.update(body); chunks.push(hash(body));
    onProgress({ phase: 'HASHING', bytes: position + body.length, totalBytes: before.size });
  }
  signal?.throwIfAborted();
  need(sameFile(before, await file.stat()), 'JOB_INPUT_SOURCE_CHANGED', 409);
  const descriptor = { schema: FILE_SCHEMA, filename, contentType, bytes: before.size,
    sha256: whole.digest('hex'), policySha256: policy.policySha256 };
  return { plan: validateUploadPlan({ schema: PLAN_SCHEMA, origin, reference, functionId, slot,
    file: descriptor, chunkBytes: CHUNK_BYTES, chunks }), info: before };
}
