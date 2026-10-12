// MIT. The original worker receives the exact sealed originals named in its paid input.
import { join } from 'node:path';
import { canonical, need } from '../intake/protocol.mjs';
import { inputManifest, fileUploadIdentity, CHUNK_BYTES, uploadIdentity, hash } from './protocol.mjs';
import { readPrivateJson, openVerifiedFile, readChunk, sameFile } from './files.mjs';

export async function openWorkerFiles({ directory, origin, reference, functionId, policy, input, inputSha256, signal }) {
  const manifest = inputManifest(policy, input), opened = new Map(), pending = new Set();
  let closed = false, closePromise;
  const active = () => { signal?.throwIfAborted(); need(!closed, 'JOB_INPUT_FILES_CLOSED', 409); };
  const read = async (entry, length, position) => {
    active();
    const work = readChunk(entry.file, length, position, signal);
    pending.add(work);
    try { return await work; } finally { pending.delete(work); }
  };
  async function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      const errors = [];
      await Promise.allSettled([...pending]);
      for (const entry of opened.values()) {
        try { need(sameFile(entry.info, await entry.file.stat()), 'JOB_INPUT_FILE_CHANGED', 409); }
        catch (error) { errors.push(error); }
        try { await entry.file.close(); } catch (error) { errors.push(error); }
      }
      opened.clear();
      if (errors.length) throw errors[0];
    })();
    return closePromise;
  }
  try {
    for (const [slot, descriptor] of Object.entries(manifest)) {
      active();
      const id = fileUploadIdentity({ origin, reference, functionId, slot, file: descriptor });
      const source = await readPrivateJson(join(directory, id, 'source.json'));
      const progress = await readPrivateJson(join(directory, id, 'progress.json'));
      need(source.schema === 'stellar-forge.job-input-original.v1' && source.id === id &&
        uploadIdentity(source.plan) === id && source.planSha256 === hash(canonical(source.plan)) &&
        canonical(source.plan.file) === canonical(descriptor) &&
        progress.schema === 'stellar-forge.job-input-progress.v1' && progress.id === id &&
        progress.state === 'SEALED' && progress.pin?.reference === reference &&
        progress.pin?.functionId === functionId && progress.pin?.inputSha256 === inputSha256,
        'JOB_INPUT_ORIGINAL_BINDING_CHANGED', 409);
      opened.set(slot, { ...(await openVerifiedFile(join(directory, id, 'file.bin'), descriptor, { signal })),
        descriptor });
    }
  } catch (error) { await close().catch(() => {}); throw error; }
  const entryFor = slot => { active(); const entry = opened.get(slot); need(entry, 'JOB_INPUT_SLOT_NOT_FOUND', 404); return entry; };
  const api = {
    list() { active(); return Object.entries(manifest).map(([slot, file]) => ({ slot, ...structuredClone(file) })); },
    metadata(slot) { return structuredClone(entryFor(slot).descriptor); },
    async read(slot, { maxBytes = 8388608 } = {}) {
      const entry = entryFor(slot);
      need(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= 67108864 &&
        entry.descriptor.bytes <= maxBytes, 'JOB_INPUT_READ_LIMIT_EXCEEDED', 413);
      const body = Buffer.alloc(entry.descriptor.bytes);
      for (let position = 0; position < body.length; position += CHUNK_BYTES)
        (await read(entry, Math.min(CHUNK_BYTES, body.length - position), position)).copy(body, position);
      need(sameFile(entry.info, await entry.file.stat()), 'JOB_INPUT_FILE_CHANGED', 409);
      return body;
    },
    stream(slot) {
      const entry = entryFor(slot);
      return (async function* () {
        for (let position = 0; position < entry.descriptor.bytes; position += CHUNK_BYTES)
          yield await read(entry, Math.min(CHUNK_BYTES, entry.descriptor.bytes - position), position);
        active(); need(sameFile(entry.info, await entry.file.stat()), 'JOB_INPUT_FILE_CHANGED', 409);
      })();
    },
  };
  return Object.freeze({ files: Object.freeze(api), close });
}
