// MIT. Retain the original native command inside its selected output allocator.
import { lstat, realpath } from 'node:fs/promises';
import { dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { absolute, digest, need, object, parseJson, readBytes, safeCode,
  withFileReservation } from './store.mjs';
import { normalizeNativeFileReservation, createNativeFileReservation } from './file-reservation.mjs';

async function main() {
  need(process.argv.length === 4, 'RESERVED_ENTRY_ARGUMENTS_INVALID');
  const requestFile = absolute(process.argv[2]), expected = process.argv[3];
  need(/^[a-f0-9]{64}$/.test(expected), 'RESERVED_ENTRY_HASH_REQUIRED');
  const info = await lstat(requestFile);
  need(info.isFile() && !info.isSymbolicLink() && (process.platform === 'win32' ||
    (!(info.mode & 0o077) && (!process.getuid || info.uid === process.getuid()))),
    'RESERVED_ENTRY_PRIVATE_REQUEST_REQUIRED');
  const raw = await readBytes(requestFile, 2_097_152);
  need(digest(raw) === expected, 'RESERVED_ENTRY_REQUEST_CHANGED');
  const request = parseJson(raw);
  need(object(request) && request.schema === 'stellar-forge.sf88.reserved-entry.v1' &&
    Object.keys(request).every(key => ['schema', 'entryFile', 'entrySha256', 'args',
      'nativeFileReservation', 'nativeRuntimeSource'].includes(key)) &&
    /^[a-f0-9]{64}$/.test(request.entrySha256 ?? '') &&
    Array.isArray(request.args) && request.args.every(value =>
      typeof value === 'string' && !value.includes('\0')), 'RESERVED_ENTRY_REQUEST_INVALID');
  const entryFile = absolute(request.entryFile);
  const runtime = await realpath(dirname(dirname(fileURLToPath(import.meta.url))));
  const within = relative(runtime, entryFile);
  need(within && within !== '..' && !within.startsWith('../') && !isAbsolute(within) &&
    await realpath(entryFile) === entryFile, 'RESERVED_ENTRY_RUNTIME_MISMATCH');
  need(digest(await readBytes(entryFile, 16_777_216)) === request.entrySha256,
    'RESERVED_ENTRY_SOURCE_CHANGED');
  if (request.nativeRuntimeSource !== undefined) {
    const { verifySuccessorRuntimeSource } = await import('./runtime-source.mjs');
    const binding = await verifySuccessorRuntimeSource(request.nativeRuntimeSource);
    need(binding.directory === runtime, 'RESERVED_ENTRY_RUNTIME_MISMATCH');
  }
  const descriptor = normalizeNativeFileReservation(request.nativeFileReservation);
  const reserveFile = await createNativeFileReservation(descriptor);
  // Main-entry guards and original argument parsing see their original command.
  process.argv = [process.execPath, entryFile, ...request.args];
  await withFileReservation({ reserveFile }, () => import(pathToFileURL(entryFile).href));
}
main().catch(error => {
  process.stderr.write(JSON.stringify({error:safeCode(error?.code, 'RESERVED_ENTRY_FAILED'),
    retry:'NO_AUTOMATIC_RETRY'}) + '\n');
  process.exitCode = 1;
});
