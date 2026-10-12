// MIT. Resumable originals borrow their owning merchant/customer lease.
import { constants } from 'node:fs';
import { open, readdir, lstat, rename, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { canonical, need, object, HASH } from '../intake/protocol.mjs';
import { validateUploadPlan, uploadIdentity, hash, fileTokenHash, chunkLength, inputManifest,
  fileUploadIdentity, storageLimits, CHUNK_BYTES, STATUS_SCHEMA } from './protocol.mjs';
import { privateDirectory, syncDirectory, readPrivateJson, writePrivateJson, checkPrivateFile,
  inspectHandle, openVerifiedFile } from './files.mjs';

const SOURCE_SCHEMA = 'stellar-forge.job-input-original.v1';
const PROGRESS_SCHEMA = 'stellar-forge.job-input-progress.v1';
const now = () => new Date().toISOString();
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const marked = (bitmap, index) => Boolean(bitmap[index >> 3] & 1 << (index & 7));
function bitset(plan, value) {
  need(typeof value === 'string', 'JOB_INPUT_PROGRESS_INVALID', 409);
  const bytes = Buffer.from(value, 'base64');
  need(bytes.length === Math.ceil(plan.chunks.length / 8) && bytes.toString('base64') === value,
    'JOB_INPUT_PROGRESS_INVALID', 409);
  if (plan.chunks.length % 8 && bytes.length)
    need((bytes.at(-1) >> (plan.chunks.length % 8)) === 0, 'JOB_INPUT_PROGRESS_INVALID', 409);
  return bytes;
}
function validateProgress(value, source) {
  need(object(value) && value.schema === PROGRESS_SCHEMA && value.id === source.id &&
    Number.isSafeInteger(value.revision) && value.revision >= 1 &&
    ['UPLOADING', 'SEALED'].includes(value.state) && instant(value.updatedAt) &&
    (value.sealedAt === null || instant(value.sealedAt)), 'JOB_INPUT_PROGRESS_INVALID', 409);
  const bits = bitset(source.plan, value.received);
  if (value.state === 'SEALED') need(value.sealedAt &&
    source.plan.chunks.every((_, index) => marked(bits, index)), 'JOB_INPUT_PROGRESS_INVALID', 409);
  need(value.pin === null || object(value.pin) && HASH.test(value.pin.inputSha256 ?? '') &&
    value.pin.reference === source.plan.reference && value.pin.functionId === source.plan.functionId &&
    instant(value.pin.at), 'JOB_INPUT_PIN_INVALID', 409);
  return value;
}
function publicRow(row, includeMissing = true) {
  const bits = bitset(row.source.plan, row.progress.received), missing = [];
  let receivedBytes = 0, receivedChunks = 0;
  for (let index = 0; index < row.source.plan.chunks.length; index++) {
    if (marked(bits, index)) { receivedChunks++; receivedBytes += chunkLength(row.source.plan, index); }
    else if (includeMissing) missing.push(index);
  }
  return { schema: STATUS_SCHEMA, id: row.source.id, planSha256: row.source.planSha256,
    state: row.progress.state, revision: row.progress.revision, file: structuredClone(row.source.plan.file),
    createdAt: row.source.createdAt, updatedAt: row.progress.updatedAt, sealedAt: row.progress.sealedAt,
    receivedChunks, totalChunks: row.source.plan.chunks.length, receivedBytes, ...(includeMissing ? { missing } : {}),
    pinned: row.progress.pin !== null };
}
export async function openInputStore({ directory, lease, limits, canDiscard = () => true } = {}) {
  need(lease && typeof lease.assertHeld === 'function', 'JOB_INPUT_OWNER_LEASE_REQUIRED', 503);
  limits = storageLimits(limits);
  lease.assertHeld(); await privateDirectory(directory);
  const rows = new Map();
  let tail = Promise.resolve(), closing = false, closePromise = null;
  const assertHeld = () => { need(!closing, 'JOB_INPUT_STORE_CLOSED', 503); lease.assertHeld(); };
  const heldWhileDraining = () => lease.assertHeld();
  const serial = operation => {
    assertHeld();
    const pending = tail.then(async () => { lease.assertHeld(); return operation(); });
    tail = pending.catch(() => {}); return pending;
  };
  const paths = id => ({ root: join(directory, id), source: join(directory, id, 'source.json'),
    progress: join(directory, id, 'progress.json'), part: join(directory, id, 'part.bin'),
    file: join(directory, id, 'file.bin') });
  function rowFor(id, token) {
    need(typeof id === 'string' && HASH.test(id), 'JOB_INPUT_UPLOAD_NOT_FOUND', 404);
    const row = rows.get(id); need(row, 'JOB_INPUT_UPLOAD_NOT_FOUND', 404);
    if (token !== undefined) {
      const actual = fileTokenHash(token);
      need(timingSafeEqual(Buffer.from(row.source.claimTokenHash, 'hex'), Buffer.from(actual, 'hex')),
        'JOB_INPUT_UPLOAD_NOT_FOUND', 404);
    }
    return row;
  }
  async function save(row, progress) {
    validateProgress(progress, row.source);
    try {
      await writePrivateJson(paths(row.source.id).progress, progress, heldWhileDraining); row.progress = progress;
    } catch (error) {
      try { row.progress = validateProgress(await readPrivateJson(paths(row.source.id).progress), row.source); }
      catch { /* Keep the last original progress observation. */ }
      throw error;
    }
  }
  async function hasFile(path) {
    try { const info = await lstat(path); need(!info.isSymbolicLink(), 'JOB_INPUT_PRIVATE_FILE_INVALID', 409); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function ensurePart(row) {
    const path = paths(row.source.id);
    if (await hasFile(path.file)) return;
    if (await hasFile(path.part)) return;
    need(row.progress.state === 'UPLOADING' &&
      !row.source.plan.chunks.some((_, index) => marked(bitset(row.source.plan, row.progress.received), index)),
      'JOB_INPUT_ORIGINAL_BYTES_MISSING', 409);
    const file = await open(path.part, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try { await file.truncate(row.source.plan.file.bytes); await file.sync(); }
    finally { await file.close(); }
    await syncDirectory(path.root);
  }
  async function cleanupDiscarded(root) {
    await privateDirectory(root);
    for (const name of await readdir(root)) {
      need(['source.json', 'progress.json', 'part.bin', 'file.bin'].includes(name),
        'JOB_INPUT_DIRECTORY_ENTRY_INVALID', 409);
      const file = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { checkPrivateFile(await file.stat(), name.endsWith('.bin') ? 2147483648 : 1048576); }
      finally { await file.close(); }
      await unlink(join(root, name));
    }
    await rmdir(root); await syncDirectory(directory);
  }
  async function ensureProgress(row) {
    try { row.progress = validateProgress(await readPrivateJson(paths(row.source.id).progress), row.source); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      need(row.progress.revision === 1 && row.progress.pin === null &&
        publicRow(row).receivedChunks === 0, 'JOB_INPUT_ORIGINAL_PROGRESS_MISSING', 409);
      await save(row, row.progress);
    }
  }
  const reserved = () => [...rows.values()].reduce((total, row) => total + row.source.plan.file.bytes, 0);
  for (const id of await readdir(directory)) {
    if (/^\.discard-[a-f0-9]{64}-[a-f0-9-]{36}$/.test(id)) { await cleanupDiscarded(join(directory, id)); continue; }
    need(HASH.test(id), 'JOB_INPUT_DIRECTORY_ENTRY_INVALID', 409);
    const path = paths(id); await privateDirectory(path.root);
    // Only this module's known uncommitted atomic temporaries are disposable.
    for (const name of await readdir(path.root)) {
      if (/^\.input-[a-f0-9-]{36}\.tmp$/.test(name)) {
        const file = await open(join(path.root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try { checkPrivateFile(await file.stat(), 1048576); } finally { await file.close(); }
        await unlink(join(path.root, name));
      } else need(['source.json', 'progress.json', 'part.bin', 'file.bin'].includes(name),
        'JOB_INPUT_DIRECTORY_ENTRY_INVALID', 409);
    }
    let source;
    try { source = await readPrivateJson(path.source); }
    catch (error) {
      if (error.code !== 'ENOENT' || (await readdir(path.root)).length) throw error;
      await rmdir(path.root); continue;
    }
    need(object(source) && source.schema === SOURCE_SCHEMA && source.id === id &&
      HASH.test(source.claimTokenHash ?? '') && instant(source.createdAt), 'JOB_INPUT_SOURCE_INVALID', 409);
    validateUploadPlan(source.plan);
    need(uploadIdentity(source.plan) === id && source.planSha256 === hash(canonical(source.plan)),
      'JOB_INPUT_SOURCE_CHANGED', 409);
    let progress;
    try { progress = validateProgress(await readPrivateJson(path.progress), source); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      need(!await hasFile(path.file) && !await hasFile(path.part), 'JOB_INPUT_ORIGINAL_PROGRESS_MISSING', 409);
      progress = { schema: PROGRESS_SCHEMA, id, revision: 1, state: 'UPLOADING',
        received: Buffer.alloc(Math.ceil(source.plan.chunks.length / 8)).toString('base64'),
        updatedAt: source.createdAt, sealedAt: null, pin: null };
      await writePrivateJson(path.progress, progress, heldWhileDraining);
    }
    rows.set(id, { source, progress });
    if (progress.state === 'SEALED') need(await hasFile(path.file), 'JOB_INPUT_ORIGINAL_BYTES_MISSING', 409);
    else await ensurePart(rows.get(id));
  }
  need(rows.size <= limits.maxUploads && reserved() <= limits.maxBytes, 'JOB_INPUT_RETAINED_STORAGE_LIMIT', 409);
  await syncDirectory(directory);
  const api = {
    directory,
    async begin({ plan, token } = {}) {
      plan = validateUploadPlan(plan); const id = uploadIdentity(plan), claimTokenHash = fileTokenHash(token);
      return serial(async () => {
        let row = rows.get(id);
        if (row) {
          rowFor(id, token);
          need(row.source.planSha256 === hash(canonical(plan)), 'JOB_INPUT_UPLOAD_PLAN_CHANGED', 409);
          await ensureProgress(row); await ensurePart(row); return publicRow(row);
        }
        need(rows.size < limits.maxUploads && reserved() + plan.file.bytes <= limits.maxBytes,
          'JOB_INPUT_STORAGE_FULL', 507);
        const path = paths(id); await privateDirectory(path.root);
        let retained;
        try { retained = await readPrivateJson(path.source); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (retained) {
          need(retained.schema === SOURCE_SCHEMA && retained.id === id && instant(retained.createdAt) &&
            retained.planSha256 === hash(canonical(plan)) && canonical(retained.plan) === canonical(plan) &&
            retained.claimTokenHash === claimTokenHash, 'JOB_INPUT_UPLOAD_PLAN_CHANGED', 409);
          const progress = { schema: PROGRESS_SCHEMA, id, revision: 1, state: 'UPLOADING',
            received: Buffer.alloc(Math.ceil(plan.chunks.length / 8)).toString('base64'),
            updatedAt: retained.createdAt, sealedAt: null, pin: null };
          row = { source: retained, progress }; rows.set(id, row);
          await ensureProgress(row); await ensurePart(row); return publicRow(row);
        }
        const at = now(), source = { schema: SOURCE_SCHEMA, id, plan, planSha256: hash(canonical(plan)),
          claimTokenHash, createdAt: at };
        const progress = { schema: PROGRESS_SCHEMA, id, revision: 1, state: 'UPLOADING',
          received: Buffer.alloc(Math.ceil(plan.chunks.length / 8)).toString('base64'),
          updatedAt: at, sealedAt: null, pin: null };
        row = { source, progress };
        try { await writePrivateJson(path.source, source, heldWhileDraining); }
        catch (error) {
          // A source rename can complete before its directory flush fails.
          // Retain those exact named bytes so another claim cannot replace it.
          try {
            const actual = await readPrivateJson(path.source);
            need(canonical(actual) === canonical(source), 'JOB_INPUT_SOURCE_CHANGED', 409);
            rows.set(id, { source: actual, progress });
          } catch { /* The original failing create remains the returned error. */ }
          throw error;
        }
        rows.set(id, row);
        await save(row, progress); await ensurePart(row); await syncDirectory(directory);
        return publicRow(row);
      });
    },
    status(id, token) { assertHeld(); return publicRow(rowFor(id, token)); },
    plan(id, token) { assertHeld(); return structuredClone(rowFor(id, token).source.plan); },
    list({ origin, reference, functionId } = {}) {
      assertHeld(); return [...rows.values()].filter(row => {
        const plan = row.source.plan;
        return (origin === undefined || plan.origin === origin) &&
          (reference === undefined || plan.reference === reference) &&
          (functionId === undefined || plan.functionId === functionId);
      }).map(row => ({
        ...publicRow(row, false), reference: row.source.plan.reference, functionId: row.source.plan.functionId,
        slot: row.source.plan.slot, origin: row.source.plan.origin }));
    },
    capacity() { assertHeld(); return { ...limits, uploads: rows.size, reservedBytes: reserved() }; },
    async writeChunk({ id, token, index, body, signal } = {}) {
      need(body instanceof Uint8Array, 'JOB_INPUT_CHUNK_BYTES_REQUIRED');
      return serial(async () => {
        signal?.throwIfAborted(); const row = rowFor(id, token), plan = row.source.plan;
        need(body.byteLength === chunkLength(plan, index) && hash(body) === plan.chunks[index],
          'JOB_INPUT_CHUNK_DIGEST_MISMATCH', 409);
        if (row.progress.state === 'SEALED') return publicRow(row);
        await ensurePart(row);
        need(!await hasFile(paths(id).file), 'JOB_INPUT_SEAL_RECOVERY_REQUIRED', 409);
        const file = await open(paths(id).part, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await file.stat(); checkPrivateFile(info, plan.file.bytes);
          need(info.size === plan.file.bytes, 'JOB_INPUT_FILE_SIZE_CHANGED', 409);
          let offset = 0;
          while (offset < body.byteLength) {
            signal?.throwIfAborted();
            const written = await file.write(body, offset, body.byteLength - offset, index * CHUNK_BYTES + offset);
            need(written.bytesWritten > 0, 'JOB_INPUT_CHUNK_WRITE_FAILED', 503); offset += written.bytesWritten;
          }
          await file.sync();
        } finally { await file.close(); }
        const bits = bitset(plan, row.progress.received), prior = marked(bits, index);
        bits[index >> 3] |= 1 << (index & 7);
        if (!prior) await save(row, { ...row.progress, received: bits.toString('base64'),
          revision: row.progress.revision + 1, updatedAt: now() });
        return publicRow(row);
      });
    },
    async finish({ id, token, signal } = {}) {
      return serial(async () => {
        signal?.throwIfAborted(); const row = rowFor(id, token), plan = row.source.plan, path = paths(id);
        need(publicRow(row).missing.length === 0, 'JOB_INPUT_CHUNKS_MISSING', 409);
        const sealed = await hasFile(path.file);
        const file = await open(sealed ? path.file : path.part, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let checked;
        try { checked = await inspectHandle(file, plan.file, { signal, chunks: plan.chunks }); }
        finally { await file.close(); }
        if (checked.missing.length) {
          need(!sealed && row.progress.pin === null, 'JOB_INPUT_ORIGINAL_BYTES_CHANGED', 409);
          const bits = bitset(plan, row.progress.received);
          for (const index of checked.missing) bits[index >> 3] &= ~(1 << (index & 7));
          await save(row, { ...row.progress, received: bits.toString('base64'),
            revision: row.progress.revision + 1, updatedAt: now() });
          throw Object.assign(new Error('JOB_INPUT_CHUNKS_CHANGED'), { code: 'JOB_INPUT_CHUNKS_CHANGED',
            status: 409, details: { missing: checked.missing } });
        }
        need(checked.sha256 === plan.file.sha256, 'JOB_INPUT_WHOLE_DIGEST_MISMATCH', 409);
        if (!sealed) {
          signal?.throwIfAborted(); await rename(path.part, path.file); await syncDirectory(path.root);
        }
        if (row.progress.state !== 'SEALED') await save(row, { ...row.progress, state: 'SEALED',
          sealedAt: now(), revision: row.progress.revision + 1, updatedAt: now() });
        return publicRow(row);
      });
    },
    async openFile(id, token, { signal } = {}) {
      // The caller owns the returned descriptor and closes it before its owner lease.
      return serial(async () => {
        const row = rowFor(id, token);
        need(row.progress.state === 'SEALED', 'JOB_INPUT_FILE_NOT_SEALED', 409);
        return openVerifiedFile(paths(id).file, row.source.plan.file, { signal });
      });
    },
    async pinJob({ origin, reference, functionId, input, policy, inputSha256, token, signal } = {}) {
      const manifest = inputManifest(policy, input);
      return serial(async () => {
        for (const [slot, descriptor] of Object.entries(manifest)) {
          signal?.throwIfAborted();
          const id = fileUploadIdentity({ origin, reference, functionId, slot, file: descriptor });
          const row = rowFor(id, token);
          need(row.progress.state === 'SEALED', 'JOB_INPUT_FILE_NOT_SEALED', 409);
          need(!row.progress.pin || row.progress.pin.inputSha256 === inputSha256, 'JOB_INPUT_PIN_CHANGED', 409);
          const opened = await openVerifiedFile(paths(id).file, descriptor, { signal }); await opened.file.close();
          if (!row.progress.pin) await save(row, { ...row.progress, pin: { reference, functionId, inputSha256, at: now() },
            revision: row.progress.revision + 1, updatedAt: now() });
        }
        return structuredClone(manifest);
      });
    },
    async discard({ id, token, expectedRevision, releaseOrphan = false, reason } = {}) {
      return serial(async () => {
        const row = rowFor(id, token);
        need(expectedRevision === row.progress.revision, 'JOB_INPUT_REVISION_CHANGED', 409);
        need(!row.progress.pin || releaseOrphan && typeof reason === 'string' && reason.trim() &&
          reason.length <= 500, 'JOB_INPUT_FILE_PINNED', 409);
        need(await canDiscard(structuredClone(row.source.plan), structuredClone(row.progress)),
          'JOB_INPUT_FILE_IN_USE', 409);
        const path = paths(id);
        for (const name of await readdir(path.root))
          need(['source.json', 'progress.json', 'part.bin', 'file.bin'].includes(name),
            'JOB_INPUT_DIRECTORY_ENTRY_INVALID', 409);
        // Retire the whole owned directory atomically; a interrupted deletion
        // leaves one recognized cleanup directory, never a broken live upload.
        const retired = join(directory, '.discard-' + id + '-' + randomUUID());
        await rename(path.root, retired); rows.delete(id);
        await syncDirectory(directory); await cleanupDiscarded(retired);
        return { id, discarded: true, bytes: row.source.plan.file.bytes };
      });
    },
    close() {
      if (!closePromise) { closing = true; closePromise = tail.then(() => ({ closed: true })); }
      return closePromise;
    },
  };
  return Object.freeze(api);
}
