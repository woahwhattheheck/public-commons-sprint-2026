// MIT. Receive a native capsule at a selected physical root through the original source-binding engine.
import { constants } from 'node:fs';
import { open, lstat, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, digest, HASH, plain, jobError } from './config.mjs';
import { acquireJobRecoveryLeases, inspectJobRecoveryState } from './recovery-state.mjs';
import { adoptRestoredJobSource, readJobMerchantSource } from './source-binding.mjs';
import { privateDirectory, readBytes, readJson, writeJson } from '../../sf88-operator-buyer-cli/node/store.mjs';

export const NATIVE_PLACEMENT_SCHEMA = 'stellar-forge.paid-job-native-placement.v1';
const REVIEW_SCHEMA = 'stellar-forge.paid-job-native-placement-review.v1';
const RESULT_SCHEMA = 'stellar-forge.paid-job-native-placement-result.v1';
const OPERATION = 'SCF-DURABLE-PAID-JOBS-0B8D-20261011';
const fail = code => { throw jobError(code, 409); };
const same = (a, b) => canonical(a) === canonical(b);
const within = (path, root) => path === root || path.startsWith(root + sep);
function absolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path ||
      path === '/' || /[\x00-\x1f\x7f]/.test(path)) fail('JOB_NATIVE_PLACEMENT_PATH_INVALID');
  return path;
}
const hash = value => typeof value === 'string' && HASH.test(value);
function validateProfile(value) {
  if (!plain(value) || value.schema !== NATIVE_PLACEMENT_SCHEMA || value.operation !== OPERATION ||
      !hash(value.archiveSha256) || !hash(value.bundleManifestSha256) ||
      !plain(value.source) || !Array.isArray(value.jobs) || value.jobs.length !== 2 ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 50000)
    fail('JOB_NATIVE_PLACEMENT_PROFILE_INVALID');
  for (const key of ['originalRetainedDirectory', 'originalCoreDirectory', 'retainedDirectory',
    'directory', 'configPath', 'applicationPath']) absolute(value[key]);
  if (value.directory !== join(value.retainedDirectory, 'merchant-state') ||
      value.configPath !== join(value.retainedDirectory, 'merchant.json') ||
      !within(value.applicationPath, value.retainedDirectory) ||
      !value.applicationPath.endsWith('.mjs') ||
      within(value.retainedDirectory, value.originalRetainedDirectory) ||
      within(value.originalRetainedDirectory, value.retainedDirectory))
    fail('JOB_NATIVE_PLACEMENT_PROFILE_INVALID');
  const names = new Set(); let bytes = 0;
  for (const item of value.files) {
    if (!plain(item) || typeof item.path !== 'string' || !item.path || isAbsolute(item.path) ||
        item.path.split('/').some(part => !part || part === '.' || part === '..') ||
        /[\\\x00-\x1f\x7f]/.test(item.path) || !hash(item.sha256) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 0 || names.has(item.path))
      fail('JOB_NATIVE_PLACEMENT_FILE_INVALID');
    names.add(item.path); bytes += item.bytes;
    if (!Number.isSafeInteger(bytes) || bytes > 256 * 1024 ** 2) fail('JOB_NATIVE_PLACEMENT_FILE_LIMIT');
  }
  if (!names.has('merchant.json') || !names.has('merchant-state/source.json') ||
      !names.has(relative(value.retainedDirectory, value.applicationPath)))
    fail('JOB_NATIVE_PLACEMENT_SOURCE_REQUIRED');
  return value;
}
function stamp(info) {
  return [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs, info.nlink]
    .map(String).join(':');
}
async function fileIdentity(path, limit) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.mode & 0o077n ||
        before.uid !== BigInt(process.getuid()) || before.size > BigInt(limit))
      fail('JOB_NATIVE_PLACEMENT_PRIVATE_FILE_REQUIRED');
    const h = createHash('sha256'), buffer = Buffer.alloc(65536); let bytes = 0;
    while (true) {
      const read = await file.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > limit) fail('JOB_NATIVE_PLACEMENT_FILE_CHANGED');
      h.update(buffer.subarray(0, read.bytesRead));
    }
    if (stamp(before) !== stamp(await file.stat({ bigint: true })) ||
        stamp(before) !== stamp(await lstat(path, { bigint: true })) || BigInt(bytes) !== before.size)
      fail('JOB_NATIVE_PLACEMENT_FILE_CHANGED');
    return { bytes, sha256: h.digest('hex') };
  } finally { await file.close(); }
}
async function verifyReceivedFiles(profile) {
  const wanted = new Map(profile.files.map(item => [item.path, item])), found = new Set();
  // These are exactly the original active writers' lease files. Their contents
  // can change while their own recovery lease is acquired; application data cannot.
  const leaseNames = new Set(['merchant-state/lease.lock', 'merchant-state/outbox/.sf98-delivery.lock',
    'merchant-state/result-delivery/lease.lock']);
  async function walk(path, depth = 0) {
    if (depth > 32) fail('JOB_NATIVE_PLACEMENT_DEPTH_LIMIT');
    await privateDirectory(path, { create: false });
    for (const name of await readdir(path)) {
      const child = join(path, name), info = await lstat(child);
      if (info.isSymbolicLink()) fail('JOB_NATIVE_PLACEMENT_FILE_CHANGED');
      if (info.isDirectory()) { await walk(child, depth + 1); continue; }
      const key = relative(profile.retainedDirectory, child), selected = wanted.get(key);
      if (leaseNames.has(key)) {
        // The original lease owner may create its lock on first receiving.
        // Inspect its private regular-file identity; its bytes are lease data.
        await fileIdentity(child, 1048576);
        if (selected) found.add(key);
        continue;
      }
      if (!selected) fail('JOB_NATIVE_PLACEMENT_UNEXPECTED_FILE');
      found.add(key);
      const value = await fileIdentity(child, selected.bytes);
      if (value.bytes !== selected.bytes || value.sha256 !== selected.sha256)
        fail('JOB_NATIVE_PLACEMENT_FILE_CHANGED');
    }
  }
  await walk(profile.retainedDirectory);
  if (found.size !== wanted.size) fail('JOB_NATIVE_PLACEMENT_FILE_MISSING');
}
function verifyReview(review, profile, profileSha256) {
  if (!plain(review) || review.schema !== REVIEW_SCHEMA || review.profileSha256 !== profileSha256 ||
      review.archiveSha256 !== profile.archiveSha256 ||
      review.bundleManifestSha256 !== profile.bundleManifestSha256 ||
      !same(review.source, profile.source) || review.directory !== profile.directory ||
      review.configPath !== profile.configPath || review.applicationPath !== profile.applicationPath ||
      !hash(review.expectedStateSha256) ||
      review.expectedBindingSha256 !== null && !hash(review.expectedBindingSha256))
    fail('JOB_NATIVE_PLACEMENT_REVIEW_CHANGED');
  return review;
}
/** Operator receiving only. No purchase, job execution, or replacement state writer. */
export async function adoptNativeJobPlacement({ profileFile, reviewFile, resultFile } = {}) {
  if (process.platform !== 'linux') fail('JOB_NATIVE_PLACEMENT_REQUIRES_LINUX');
  absolute(profileFile); absolute(reviewFile);
  if (resultFile !== undefined) absolute(resultFile);
  const profileBytes = await readBytes(profileFile, 16 * 1024 ** 2);
  const profile = validateProfile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(profileBytes)));
  const profileSha256 = digest(profileBytes);
  if (within(reviewFile, profile.retainedDirectory) || resultFile && within(resultFile, profile.retainedDirectory) ||
      reviewFile === profileFile || resultFile === profileFile || resultFile === reviewFile)
    fail('JOB_NATIVE_PLACEMENT_REVIEW_LOCATION_INVALID');
  await privateDirectory(dirname(reviewFile));
  if (resultFile) await privateDirectory(dirname(resultFile));
  for (const path of [profile.retainedDirectory, profile.directory]) await privateDirectory(path, { create: false });
  if (await realpath(profile.configPath) !== profile.configPath ||
      await realpath(profile.applicationPath) !== profile.applicationPath)
    fail('JOB_NATIVE_PLACEMENT_FILE_CHANGED');
  const [configuration, application] = await Promise.all([
    fileIdentity(profile.configPath, 1048576), fileIdentity(profile.applicationPath, 4194304),
  ]);
  if (configuration.sha256 !== profile.source.configSha256 ||
      application.sha256 !== profile.source.applicationSha256)
    fail('JOB_NATIVE_PLACEMENT_SOURCE_CHANGED');
  let review;
  try { review = verifyReview(await readJson(reviewFile, 1048576), profile, profileSha256); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!review) {
    const lease = await acquireJobRecoveryLeases({ directory: profile.directory });
    try {
      await lease.assertHeld();
      // A peer may have completed the same reviewed receive while this caller
      // waited for its original merchant lease.
      try { review = verifyReview(await readJson(reviewFile, 1048576), profile, profileSha256); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!review) {
        await verifyReceivedFiles(profile);
        const state = await inspectJobRecoveryState({ directory: profile.directory });
        await lease.assertHeld();
        review = { schema: REVIEW_SCHEMA, profileSha256, archiveSha256: profile.archiveSha256,
          bundleManifestSha256: profile.bundleManifestSha256, source: profile.source,
          directory: profile.directory, configPath: profile.configPath, applicationPath: profile.applicationPath,
          expectedStateSha256: state.sha256, expectedBindingSha256: state.bindingSha256,
          originalState: { files: state.files, directories: state.directories, bytes: state.bytes } };
        await writeJson(reviewFile, review);
      }
    } finally { await lease.close(); }
  }
  const reviewSha256 = digest(await readBytes(reviewFile, 1048576));
  const adoption = await adoptRestoredJobSource({
    configPath: profile.configPath, directory: profile.directory, applicationPath: profile.applicationPath,
    originalSource: profile.source, bundleManifestSha256: profile.bundleManifestSha256,
    profileSha256, reviewSha256, expectedStateSha256: review.expectedStateSha256,
    expectedBindingSha256: review.expectedBindingSha256,
  });
  const reopened = await readJobMerchantSource({ configPath: profile.configPath, directory: profile.directory });
  if (!same(reopened.identity, profile.source) || reopened.applicationPath !== profile.applicationPath ||
      reopened.sourceBinding?.sha256 !== adoption.bindingSha256)
    fail('JOB_NATIVE_PLACEMENT_REOPEN_CHANGED');
  const result = { schema: RESULT_SCHEMA, operation: OPERATION,
    originalRetainedDirectory: profile.originalRetainedDirectory,
    originalCoreDirectory: profile.originalCoreDirectory, retainedDirectory: profile.retainedDirectory,
    profileSha256, reviewSha256, adoption };
  if (resultFile) await writeJson(resultFile, result);
  return result;
}
async function main(argv) {
  const options = {};
  for (let n = 0; n < argv.length; n += 2) {
    const key = { '--profile': 'profileFile', '--review': 'reviewFile', '--out': 'resultFile' }[argv[n]];
    if (!key || !argv[n + 1] || Object.hasOwn(options, key)) fail('JOB_NATIVE_PLACEMENT_OPTIONS_REQUIRED');
    options[key] = argv[n + 1];
  }
  const result = await adoptNativeJobPlacement(options);
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'JOB_NATIVE_PLACEMENT_FAILED',
      message: error.message }) + '\n'); process.exitCode = 1;
  });
