// MIT. Complete source-folder receiving through original immutable ranges.
import { Sha256 } from '/source-sha256.mjs';

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const STAGING = '.soroban-transfer';
const encoder = new TextEncoder();
const digest = (bytes) => new Sha256().update(bytes).digest();
const jsonBytes = (value) => encoder.encode(JSON.stringify(value, null, 2) + '\n');
const failure = (code, message) => Object.assign(new Error(message), { code });
const need = (condition, code, message) => { if (!condition) throw failure(code, message); };
function aborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Source receiving was interrupted; its original downloaded chunks remain available.'), { name: 'AbortError' });
}
function relativePath(path) {
  need(typeof path === 'string' && path.length <= 1000 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..'),
    'SOROBAN_SOURCE_PATH_INVALID', 'The source manifest contains an invalid native path.');
  return path;
}
function selectedFiles(exported) {
  need(exported && /^[a-f0-9]{64}$/.test(exported.id) && /^[a-f0-9]{64}$/.test(exported.manifestSha256),
    'SOROBAN_SOURCE_SELECTION_REQUIRED', 'Select the complete original source export.');
  const manifest = exported.manifest;
  need(manifest && manifest.exportId === exported.id && Array.isArray(manifest.files) &&
    manifest.files.length > 0 && manifest.files.length <= 100000 && manifest.fileCount === manifest.files.length,
    'SOROBAN_SOURCE_MANIFEST_INVALID', 'The original source manifest is incomplete.');
  const bytes = jsonBytes(manifest);
  need(bytes.length <= MAX_MANIFEST_BYTES && digest(bytes) === exported.manifestSha256,
    'SOROBAN_SOURCE_MANIFEST_CHANGED', 'The selected manifest differs from its original native bytes.');
  const seen = new Set(['manifest.json']);
  let total = 0;
  const files = manifest.files.map((file) => {
    relativePath(file.path);
    need(!seen.has(file.path) && /^[a-f0-9]{64}$/.test(file.sha256) &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_FILE_BYTES,
      'SOROBAN_SOURCE_MANIFEST_INVALID', 'The source manifest contains a repeated or invalid file.');
    seen.add(file.path); total += file.bytes;
    need(Number.isSafeInteger(total), 'SOROBAN_SOURCE_SIZE_INVALID', 'The complete source byte count is outside the supported range.');
    return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
  });
  need(total === manifest.bytes, 'SOROBAN_SOURCE_MANIFEST_INVALID', 'The complete source byte count differs from its native manifest.');
  return { files: [{ path: 'manifest.json', bytes: bytes.length, sha256: exported.manifestSha256 }, ...files],
    sourceBytes: total, totalBytes: total + bytes.length };
}
async function existingFile(directory, name) {
  try { return await directory.getFileHandle(name); }
  catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}
async function directories(root, parts) {
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return directory;
}
async function fileHash(file, { signal, progress } = {}) {
  const hash = new Sha256(); let bytes = 0;
  const reader = file.stream().getReader();
  try {
    for (;;) {
      aborted(signal);
      const next = await reader.read();
      if (next.done) break;
      need(next.value instanceof Uint8Array, 'SOROBAN_SOURCE_READ_INVALID', 'The browser did not return original file bytes.');
      hash.update(next.value); bytes += next.value.length; progress?.(bytes);
    }
    need(bytes === file.size, 'SOROBAN_SOURCE_FILE_CHANGED', 'The selected saved file changed while it was being read.');
    return hash.digest();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function exactFile(handle, descriptor, options = {}) {
  const file = await handle.getFile();
  return file.size === descriptor.bytes && await fileHash(file, options) === descriptor.sha256;
}
async function stagedJSON(directory, name, value, allowEmpty = false) {
  const expected = jsonBytes(value), old = await existingFile(directory, name);
  if (old) {
    const file = await old.getFile();
    if (file.size || !allowEmpty) {
      need(file.size === expected.length && digest(new Uint8Array(await file.arrayBuffer())) === digest(expected),
        'SOROBAN_SOURCE_STAGING_CONFLICT', 'A source receiving record belongs to different original bytes.');
      return old;
    }
  }
  const handle = old ?? await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try { await writer.write(expected); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
  return handle;
}
async function stageFor(folder, exported, descriptor) {
  const parent = await folder.getDirectoryHandle(STAGING, { create: true });
  const name = digest(encoder.encode(descriptor.path));
  const directory = await parent.getDirectoryHandle(name, { create: true });
  const entries = [];
  for await (const [entryName, handle] of directory.entries()) entries.push([entryName, handle]);
  const intent = await existingFile(directory, 'intent.json');
  const emptyIntent = intent && (await intent.getFile()).size === 0;
  need(intent && !emptyIntent || entries.every(([entryName, handle]) => entryName === 'intent.json' && handle.kind === 'file'),
    'SOROBAN_SOURCE_STAGING_CONFLICT', 'The receiving folder contains an unrecognized partial source.');
  await stagedJSON(directory, 'intent.json', {
    schema: 'stellar-forge.soroban-events.folder-transfer.v1',
    exportId: exported.id, manifestSha256: exported.manifestSha256,
    path: descriptor.path, bytes: descriptor.bytes, sha256: descriptor.sha256, chunkBytes: CHUNK_BYTES,
  }, true);
  const chunks = new Map();
  for (const [entryName, handle] of entries) {
    if (entryName === 'intent.json' || entryName === 'destination.json') continue;
    const match = /^([0-9]{8})-([a-f0-9]{64})\.part$/.exec(entryName);
    need(match && handle.kind === 'file', 'SOROBAN_SOURCE_STAGING_CONFLICT', 'The receiving folder contains an unrecognized partial source.');
    const index = Number(match[1]);
    need(index < Math.ceil(descriptor.bytes / CHUNK_BYTES), 'SOROBAN_SOURCE_STAGING_CONFLICT', 'A partial source chunk is outside its original file.');
    const list = chunks.get(index) ?? []; list.push({ name: entryName, hash: match[2], handle }); chunks.set(index, list);
  }
  return { parent, name, directory, chunks };
}
async function retainedChunk(stage, index, expectedBytes, readRange, descriptor, signal) {
  for (const entry of stage.chunks.get(index) ?? []) {
    aborted(signal);
    const file = await entry.handle.getFile();
    if (file.size === expectedBytes) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === expectedBytes && digest(bytes) === entry.hash) return { ...entry, bytes };
    }
    await stage.directory.removeEntry(entry.name);
  }
  aborted(signal);
  const bytes = await readRange(descriptor.path, index * CHUNK_BYTES, expectedBytes);
  need(bytes instanceof Uint8Array && bytes.length === expectedBytes, 'SOROBAN_SOURCE_RANGE_CHANGED',
    'The original source returned a different byte range for ' + descriptor.path + '.');
  const hash = digest(bytes), name = String(index).padStart(8, '0') + '-' + hash + '.part';
  const handle = await stage.directory.getFileHandle(name, { create: true }), writer = await handle.createWritable();
  try { await writer.write(bytes); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
  const entry = { name, hash, handle };
  stage.chunks.set(index, [entry]);
  return { ...entry, bytes };
}
async function removeStage(stage) {
  const names = [];
  for await (const [name, handle] of stage.directory.entries()) {
    need(handle.kind === 'file' && (name === 'intent.json' || name === 'destination.json' ||
      /^[0-9]{8}-[a-f0-9]{64}\.part$/.test(name)),
      'SOROBAN_SOURCE_STAGING_CONFLICT', 'An unexpected file is present in the source receiving folder.');
    names.push(name);
  }
  for (const name of names.filter((value) => value.endsWith('.part'))) await stage.directory.removeEntry(name);
  if (names.includes('destination.json')) await stage.directory.removeEntry('destination.json');
  // Retain original receiving ownership until its partial files are gone.
  if (names.includes('intent.json')) await stage.directory.removeEntry('intent.json');
  await stage.parent.removeEntry(stage.name);
}
async function publishFile(target, name, stage, descriptor, entries, options) {
  const marker = {
    schema: 'stellar-forge.soroban-events.folder-destination.v1',
    path: descriptor.path, bytes: descriptor.bytes, sha256: descriptor.sha256, createdDestination: true,
  };
  const before = await existingFile(target, name);
  if (before) {
    if (await exactFile(before, descriptor, options)) return;
    const intent = await existingFile(stage.directory, 'destination.json');
    need(intent && (await before.getFile()).size === 0, 'SOROBAN_SOURCE_DESTINATION_CHANGED',
      'The selected folder contains different bytes at ' + descriptor.path + '.');
    await stagedJSON(stage.directory, 'destination.json', marker);
  } else await stagedJSON(stage.directory, 'destination.json', marker, true);
  const handle = before ?? await target.getFileHandle(name, { create: true });
  need((await handle.getFile()).size === 0, 'SOROBAN_SOURCE_DESTINATION_CHANGED',
    'The selected destination changed before original source publication.');
  const writer = await handle.createWritable(), hash = new Sha256(); let size = 0;
  try {
    for (const entry of entries) {
      aborted(options.signal);
      const bytes = new Uint8Array(await (await entry.handle.getFile()).arrayBuffer());
      need(bytes.length === entry.bytes && digest(bytes) === entry.hash, 'SOROBAN_SOURCE_PARTIAL_CHANGED',
        'A retained source chunk changed before its complete file was saved.');
      hash.update(bytes); size += bytes.length; await writer.write(bytes); options.progress?.(size);
    }
    need(size === descriptor.bytes && hash.digest() === descriptor.sha256, 'SOROBAN_SOURCE_FILE_CHANGED',
      'The complete received file differs from its original source.');
    await writer.close();
  } catch (error) { await writer.abort().catch(() => {}); throw error; }
}

/**
 * Receive the exact original source folder with bounded range reads.
 * readRange(path, offset, length) returns Uint8Array; length never exceeds 4 MiB.
 * progress receives phase/path/index/fileCount/bytes/totalBytes/fileBytes/fileTotalBytes.
 * bytes in the final result includes the unchanged original manifest file.
 */
export async function saveSourceFolder({ exported, readRange, progress, filenamePrefix = 'soroban-events', signal } = {}) {
  need(typeof readRange === 'function', 'SOROBAN_SOURCE_READER_REQUIRED', 'Use the original authenticated source reader.');
  need(typeof filenamePrefix === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(filenamePrefix),
    'SOROBAN_SOURCE_NAME_INVALID', 'Use a simple source folder name.');
  const selected = structuredClone(exported), selection = selectedFiles(selected);
  need(typeof window.showDirectoryPicker === 'function', 'SOROBAN_SOURCE_FOLDER_UNAVAILABLE',
    'Use the complete source-download client on this browser.');
  aborted(signal);
  const root = await window.showDirectoryPicker({ mode: 'readwrite' });
  const perform = async () => {
    const folder = await root.getDirectoryHandle(filenamePrefix + '-' + selected.id.slice(0, 16), { create: true });
    let completed = 0;
    for (let index = 0; index < selection.files.length; index += 1) {
      aborted(signal);
      const descriptor = selection.files[index], parts = descriptor.path.split('/'), startingBytes = completed;
      const target = await directories(folder, parts.slice(0, -1)), name = parts.at(-1);
      const report = (phase, fileBytes) => progress?.({ phase, path: descriptor.path, index: index + 1,
        fileCount: selection.files.length, bytes: startingBytes + fileBytes, totalBytes: selection.totalBytes,
        fileBytes, fileTotalBytes: descriptor.bytes });
      const existing = await existingFile(target, name);
      if (existing && await exactFile(existing, descriptor, { signal, progress: (bytes) => report('verifying', bytes) })) {
        const staging = await folder.getDirectoryHandle(STAGING).catch((error) => { if (error.name === 'NotFoundError') return null; throw error; });
        const stagedName = digest(encoder.encode(descriptor.path));
        const retained = staging && await staging.getDirectoryHandle(stagedName).catch((error) => { if (error.name === 'NotFoundError') return null; throw error; });
        if (retained) await removeStage(await stageFor(folder, selected, descriptor));
        completed += descriptor.bytes; report('retained', descriptor.bytes); continue;
      }
      const stage = await stageFor(folder, selected, descriptor);
      if (existing) {
        need((await existing.getFile()).size === 0 && await existingFile(stage.directory, 'destination.json'),
          'SOROBAN_SOURCE_DESTINATION_CHANGED', 'The selected folder contains different bytes at ' + descriptor.path + '.');
      }
      const hash = new Sha256(), entries = []; let received = 0;
      for (let chunkIndex = 0; received < descriptor.bytes; chunkIndex += 1) {
        const entry = await retainedChunk(stage, chunkIndex, Math.min(CHUNK_BYTES, descriptor.bytes - received), readRange, descriptor, signal);
        hash.update(entry.bytes); received += entry.bytes.length;
        entries.push({ name: entry.name, hash: entry.hash, handle: entry.handle, bytes: entry.bytes.length });
        report('receiving', received);
      }
      if (hash.digest() !== descriptor.sha256) {
        for (const entry of entries) await stage.directory.removeEntry(entry.name);
        throw failure('SOROBAN_SOURCE_FILE_CHANGED', 'The complete received file differs from its original source at ' + descriptor.path + '.');
      }
      await publishFile(target, name, stage, descriptor, entries, { signal, progress: (bytes) => report('saving', bytes) });
      completed += descriptor.bytes;
      await removeStage(stage); report('saved', descriptor.bytes);
    }
    const remaining = await folder.getDirectoryHandle(STAGING).catch((error) => { if (error.name === 'NotFoundError') return null; throw error; });
    if (remaining) {
      let empty = true; for await (const _ of remaining.keys()) { empty = false; break; }
      if (empty) await folder.removeEntry(STAGING);
    }
    return { directory: folder.name, exportId: selected.id, manifestSha256: selected.manifestSha256,
      fileCount: selection.files.length, bytes: selection.totalBytes, sourceBytes: selection.sourceBytes };
  };
  if (globalThis.navigator?.locks?.request) return navigator.locks.request('soroban-source-folder:' + selected.id, { mode: 'exclusive', ...(signal ? { signal } : {}) }, perform);
  return perform();
}
