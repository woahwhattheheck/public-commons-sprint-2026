// MIT. Receive the already verified original result, preserving one resumable selection.
import { constants } from 'node:fs';
import { open, link, unlink, lstat, readdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { absolute, privateDirectory, readBytes, exists, syncDirectory } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { canonical, digest, jobError } from '../config.mjs';
import { RESULT_PACKAGE_TYPE, RESULT_PACKAGE_MAX_BYTES, RESULT_PACKAGE_MANIFEST,
  packageBytes } from './contract.mjs';
import { readResultPackage } from './archive.mjs';

export const RESULT_RECEIVING_SCHEMA = 'stellar-forge.job-result-receiving.v1';
const INTENT = 'receive-intent.json', RECEIPT = 'received.json', ARCHIVE = 'package.zip';
const fail = (code, status = 409) => { throw jobError(code, status); };
const check = signal => signal?.throwIfAborted();
const same = (left, right) => canonical(left) === canonical(right);
function expectedFile(value) {
  if (!value || !Number.isSafeInteger(value.bytes) || value.bytes < 1 ||
      value.bytes > RESULT_PACKAGE_MAX_BYTES || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') ||
      value.contentType !== RESULT_PACKAGE_TYPE || typeof value.filename !== 'string')
    fail('JOB_OUTPUT_SOURCE_REQUIRED', 400);
  return { bytes: value.bytes, sha256: value.sha256, contentType: value.contentType, filename: value.filename };
}
async function verify(path, expected, signal) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expected.bytes) fail('JOB_OUTPUT_RECEIVED_FILE_CHANGED');
    let size = 0; const hash = createHash('sha256'), block = Buffer.alloc(65536);
    for (;;) {
      check(signal); const { bytesRead } = await handle.read(block, 0, block.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > expected.bytes) fail('JOB_OUTPUT_RECEIVED_FILE_CHANGED');
      hash.update(block.subarray(0, bytesRead));
    }
    const after = await handle.stat(); check(signal);
    if (size !== expected.bytes || hash.digest('hex') !== expected.sha256 ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      fail('JOB_OUTPUT_RECEIVED_FILE_CHANGED');
  } finally { await handle.close(); }
}
async function publish(target, bytes, { staging, signal, lease } = {}) {
  const expected = { bytes: bytes.length, sha256: digest(bytes) };
  lease.assertHeld(); check(signal);
  if (await exists(target)) { await verify(target, expected, signal); return true; }
  const partial = join(staging, expected.sha256 + '.part');
  let file;
  try {
    if (await exists(partial)) {
      const state = await lstat(partial);
      if (!state.isFile() || state.isSymbolicLink() || state.size > expected.bytes)
        fail('JOB_OUTPUT_STAGING_CHANGED');
      if (state.size === expected.bytes) await verify(partial, expected, signal);
      else await unlink(partial); // Only this selection's unfinished owned staging member.
    }
    if (!await exists(partial)) {
      file = await open(partial, 'wx', 0o600);
      for (let offset = 0; offset < bytes.length;) {
        lease.assertHeld(); check(signal);
        const count = Math.min(65536, bytes.length - offset);
        const { bytesWritten } = await file.write(bytes, offset, count, null);
        if (bytesWritten < 1) fail('JOB_OUTPUT_WRITE_FAILED', 503);
        offset += bytesWritten;
      }
      await file.sync(); await file.close(); file = null;
    }
    lease.assertHeld(); check(signal);
    try { await link(partial, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await verify(target, expected, signal);
    }
    await syncDirectory(dirname(target));
    await unlink(partial); await syncDirectory(staging);
    return false;
  } finally { await file?.close().catch(() => {}); }
}
function selection(packet) {
  return { schema: RESULT_RECEIVING_SCHEMA, package: expectedFile(packet.package),
    manifestSha256: packet.manifestSha256, job: packet.manifest.job,
    policySha256: packet.manifest.policy.policySha256 };
}
function receipt(packet) {
  const intent = selection(packet);
  return { ...intent, selectionSha256: digest(packageBytes(intent)), archive: ARCHIVE,
    manifest: RESULT_PACKAGE_MANIFEST,
    files: packet.manifest.files.map(file => ({ ...file, path: 'files/' + file.filename })) };
}
function publicReceipt(directory, value) {
  return { ...value, directory, archivePath: join(directory, ARCHIVE),
    manifestPath: join(directory, RESULT_PACKAGE_MANIFEST),
    files: value.files.map(file => ({ ...file, path: join(directory, 'files', file.filename) })) };
}

/** Consume one downloaded original result. No merchant request or payment is made. */
export async function receiveResultPackage({ source, directory, expected, job = {}, signal } = {}) {
  source = absolute(source); directory = absolute(directory);
  expected = expectedFile(expected); check(signal);
  const packet = await readResultPackage(source, { expected, job, signal });
  await privateDirectory(directory);
  if (await realpath(directory) !== directory) fail('JOB_OUTPUT_CANONICAL_DIRECTORY_REQUIRED', 400);
  const lease = await acquireStateLease(directory);
  try {
    const intentPath = join(directory, INTENT), next = selection(packet);
    if (await exists(intentPath)) {
      const prior = JSON.parse((await readBytes(intentPath, 65536)).toString('utf8'));
      if (!same(prior, next)) fail('JOB_OUTPUT_RECEIVING_SELECTION_CHANGED');
    } else {
      // Publish the selection before creating any member/staging directory.
      for (const name of [RECEIPT, ARCHIVE, RESULT_PACKAGE_MANIFEST, 'files', 'staging'])
        if (await exists(join(directory, name))) fail('JOB_OUTPUT_RECEIVING_SELECTION_REQUIRED');
      const initial = await mkdtemp(join(dirname(directory), '.job-output-intent-'));
      try { await publish(intentPath, packageBytes(next), { staging: initial, signal, lease }); }
      finally { await rm(initial, { recursive: true, force: true }); }
    }
    const staging = join(directory, 'staging');
    await privateDirectory(staging);
    const options = { staging, signal, lease };
    const filesDirectory = join(directory, 'files'); await privateDirectory(filesDirectory);
    const expectedNames = new Set(packet.manifest.files.map(file => file.filename));
    for (const name of await readdir(filesDirectory))
      if (!expectedNames.has(name)) fail('JOB_OUTPUT_RECEIVING_EXTRA_FILE');
    await publish(join(directory, ARCHIVE), packet.body, options);
    await publish(join(directory, RESULT_PACKAGE_MANIFEST), packet.manifestBytes, options);
    let reused = 0;
    for (const file of packet.manifest.files) {
      check(signal);
      reused += Number(await publish(join(filesDirectory, file.filename), packet.file(file.slot), options));
    }
    const complete = receipt(packet);
    await publish(join(directory, RECEIPT), packageBytes(complete), options);
    return { ...publicReceipt(directory, complete), complete: true, reusedFiles: reused };
  } finally { await lease.close(); }
}

/** Reopen the complete portable directory and verify every original member locally. */
export async function reopenResultPackage({ directory, expected, job = {}, signal } = {}) {
  directory = absolute(directory); await privateDirectory(directory, { create: false }); check(signal);
  if (await realpath(directory) !== directory) fail('JOB_OUTPUT_CANONICAL_DIRECTORY_REQUIRED', 400);
  const intent = JSON.parse((await readBytes(join(directory, INTENT), 65536)).toString('utf8'));
  const selected = expected === undefined ? expectedFile(intent.package) : expectedFile(expected);
  if (!same(intent.package, selected)) fail('JOB_OUTPUT_RECEIVING_SELECTION_CHANGED');
  const packet = await readResultPackage(join(directory, ARCHIVE), { expected: selected, job, signal });
  if (!same(intent, selection(packet))) fail('JOB_OUTPUT_RECEIVING_SELECTION_CHANGED');
  const complete = receipt(packet);
  const stored = await readBytes(join(directory, RECEIPT), 65536);
  if (!stored.equals(packageBytes(complete))) fail('JOB_OUTPUT_RECEIVING_INCOMPLETE');
  const manifest = await readBytes(join(directory, RESULT_PACKAGE_MANIFEST), 65000);
  if (!manifest.equals(packet.manifestBytes)) fail('JOB_OUTPUT_MANIFEST_CHANGED');
  const names = new Set(complete.files.map(file => file.filename));
  const filesDirectory = join(directory, 'files');
  await privateDirectory(filesDirectory, { create: false });
  for (const name of await readdir(filesDirectory))
    if (!names.has(name)) fail('JOB_OUTPUT_RECEIVING_EXTRA_FILE');
  for (const file of complete.files) await verify(join(filesDirectory, file.filename), file, signal);
  return { ...publicReceipt(directory, complete), complete: true, reusedFiles: complete.files.length };
}
