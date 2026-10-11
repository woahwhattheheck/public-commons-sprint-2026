// MIT. Image operations compose the original image engine and runtime worker.
import { constants } from 'node:fs';
import { open, mkdir, readdir, lstat, link, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { PLAN_SCHEMA, CONTEXT_SCHEMA, RECEIPT_SCHEMA, PORTABLE_SCHEMA, inspectPlan,
  prepareImage, checkContext, contextIdentity } from '../../sf99-merchant-deploy/container-image/image.mjs';
import { lockImage, buildImage, imageStatus, exportImage, importImage } from '../../sf99-merchant-deploy/container-image/engine.mjs';
import { inspectRuntimeInstall } from '../runtime-install.mjs';
import { verifyRuntimeSource } from '../runtime-profile.mjs';
import { plain, need, now, digest, canonical, json, recordId, operationId, absolute,
  privateDirectory, makePrivate, regular, readJSON, saveJSON, operationLease, workerAlive } from './storage.mjs';

export const IMAGE_WORKSPACE_SCHEMA = 'stellar-forge.runtime-workspace.images.v1';
export const IMAGE_TRANSFER_MAX_BYTES = 16 * 1024 * 1024 * 1024;
export const IMAGE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const imageOperationFields = Object.freeze({
  image_prepare: ['reviewId'],
  image_lock: ['imageId', 'lockFile', 'npm'],
  image_check: ['imageId', 'requireLock'],
  image_build: ['imageId', 'engine'],
  image_status: ['imageId', 'engine'],
  image_export: ['imageId', 'engine'],
  image_import: ['transferId', 'engine'],
  image_container: ['deploymentReviewId', 'engine'],
});
const HASH = /^[a-f0-9]{64}$/, IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const errorView = e => ({ code: e.code ?? 'RUNTIME_IMAGE_ERROR', message: String(e.message ?? e).slice(0, 2000) });
const identity = value => digest(json(canonical(value)));
const directories = ['entries', 'reviews', 'plans', 'contexts', 'observations',
  'transfers', 'transfer-records', 'leases', 'deployments', 'deployment-reviews'];
const fileAt = (base, area, id) => join(base, area, recordId(id) + '.json');
const reviewAt = (base, area, id) => {
  need(HASH.test(id ?? ''), 'RUNTIME_IMAGE_REVIEW_REQUIRED');
  return join(base, area, id + '.json');
};
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function ensureDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(path);
}
async function rootFor(root) {
  await privateDirectory(root);
  const base = await ensureDirectory(join(root, 'images'));
  for (const name of directories) await ensureDirectory(join(base, name));
  return base;
}
async function immutable(path, value) {
  try { await saveJSON(path, value); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(identity(await readJSON(path)) === identity(value), 'RUNTIME_IMAGE_RECORD_CHANGED');
  }
  return value;
}
async function records(base, area) {
  const names = (await readdir(join(base, area))).filter(x => /^[a-f0-9]{24}\.json$/.test(x));
  return Promise.all(names.map(name => readJSON(join(base, area, name))));
}
function label(value, fallback) {
  value = value ?? fallback;
  need(typeof value === 'string' && value.trim() && value.length <= 120, 'RUNTIME_IMAGE_LABEL_INVALID');
  return value.trim();
}
function program(value, fallback) {
  value = value ?? fallback;
  need(typeof value === 'string' && value && !value.startsWith('-') &&
    !/[\x00-\x1f\x7f]/.test(value), 'RUNTIME_IMAGE_EXECUTABLE_INVALID');
  return value;
}
function receipt(value) {
  need(plain(value) && value.schema === RECEIPT_SCHEMA && IMAGE_ID.test(value.imageId ?? '') &&
    HASH.test(value.contextSha256 ?? '') && HASH.test(value.lockSha256 ?? '') &&
    HASH.test(value.release?.archiveSha256 ?? '') && typeof value.release?.sourceCommit === 'string' &&
    Array.isArray(value.sourceModes) && value.sourceModes.every(x => ['bind', 'image'].includes(x)) &&
    typeof value.runtimeProfileId === 'string' && plain(value.runtime) &&
    Number.isSafeInteger(value.uid) && Number.isSafeInteger(value.gid), 'RUNTIME_IMAGE_RECEIPT_REQUIRED');
  return value;
}
function portable(value) {
  need(plain(value) && value.schema === PORTABLE_SCHEMA && value.archive?.file === 'image.tar' &&
    HASH.test(value.archive.sha256 ?? '') && Number.isSafeInteger(value.archive.bytes) &&
    value.archive.bytes > 0 && value.archive.bytes <= IMAGE_TRANSFER_MAX_BYTES,
  'RUNTIME_IMAGE_PORTABLE_REQUIRED', 'Select the original image-bundle.json and an image archive up to 16 GiB');
  receipt(value.image);
  return value;
}
async function retainImage(base, directory, name, extra = {}) {
  absolute(directory);
  const id = digest(directory).slice(0, 24), path = fileAt(base, 'entries', id);
  const previous = await readJSON(path, true);
  if (previous) {
    need(previous.directory === directory, 'RUNTIME_IMAGE_RECORD_CHANGED');
    if (extra.reviewId) need(previous.reviewId === extra.reviewId, 'RUNTIME_IMAGE_REVIEW_CHANGED');
    return previous;
  }
  const value = { id, directory, label: label(name, directory.split('/').at(-1)), createdAt: now(), ...extra };
  try { await saveJSON(path, value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(path);
}
async function imageEntry(base, id) {
  const value = await readJSON(fileAt(base, 'entries', id));
  need(value.id === id && digest(value.directory).slice(0, 24) === id, 'RUNTIME_IMAGE_RECORD_CHANGED');
  absolute(value.directory);
  return value;
}
async function transferEntry(base, id) {
  const value = await readJSON(fileAt(base, 'transfer-records', id));
  need(value.id === id && digest(value.directory).slice(0, 24) === id, 'RUNTIME_IMAGE_TRANSFER_CHANGED');
  await privateDirectory(absolute(value.directory));
  return value;
}
async function retainTransfer(base, directory, name, extra = {}) {
  const id = digest(absolute(directory)).slice(0, 24), path = fileAt(base, 'transfer-records', id);
  const previous = await readJSON(path, true);
  if (previous) {
    need(previous.directory === directory, 'RUNTIME_IMAGE_TRANSFER_CHANGED');
    return previous;
  }
  const value = { id, directory, label: label(name, directory.split('/').at(-1)), createdAt: now(), ...extra };
  try { await saveJSON(path, value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(path);
}
function contextPin(value) {
  const { status, lockSha256, lockedPackages, ...selection } = value;
  return identity(selection);
}
function imageView(record, context, built, build, observed) {
  return { ...record, phase: built ? 'BUILT' : build?.status ?? context?.status ?? 'PLANNED',
    imageId: built?.imageId ?? null, contextSha256: context?.lockSha256 ? contextIdentity(context) : null,
    release: context?.release ?? null, profileId: context?.profile?.profileId ?? null,
    baseImage: context?.baseImage ?? null, platform: context?.platform ?? null,
    sourceRoot: context?.sourceRoot ?? null, selectedSourceRoot: context?.selectedSourceRoot ?? null,
    runtime: context?.runtime ?? null, uid: context?.uid ?? null, gid: context?.gid ?? null,
    lockSha256: context?.lockSha256 ?? null, dependencies: context?.dependencies ?? {},
    sourceModes: context?.sourceModes ?? [], build: build ?? null, receipt: built ?? null, observation: observed };
}
async function retainedImage(base, record) {
  try {
    if (!await exists(record.directory)) return imageView(record, null, null, null, null);
    await privateDirectory(record.directory);
    const [context, built, build, observation] = await Promise.all([
      readJSON(join(record.directory, 'context.json'), true),
      readJSON(join(record.directory, 'image-receipt.json'), true),
      readJSON(join(record.directory, 'image-build.json'), true),
      readJSON(fileAt(base, 'observations', record.id), true),
    ]);
    need(context?.schema === CONTEXT_SCHEMA && context.directory === record.directory, 'RUNTIME_IMAGE_CONTEXT_REQUIRED');
    return imageView(record, context, built, build, observation);
  } catch (error) { return { ...record, phase: 'UNAVAILABLE', error: errorView(error) }; }
}
async function transferView(base, record) {
  try {
    const manifest = await readJSON(join(record.directory, 'image-bundle.json'), true);
    if (!manifest) return { ...record, phase: 'EXPORT_PENDING', receivedBytes: 0 };
    portable(manifest);
    const complete = await exists(join(record.directory, 'image.tar'));
    const path = join(record.directory, complete ? 'image.tar' : 'image.tar.partial');
    const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat) need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= manifest.archive.bytes,
      'RUNTIME_IMAGE_TRANSFER_FILE_CHANGED');
    const [observed, verification] = await Promise.all([
      readJSON(join(record.directory, 'workspace-import.json'), true),
      readJSON(join(record.directory, 'workspace-receive.json'), true),
    ]);
    return { ...record, phase: verification?.error ? 'VERIFICATION_FAILED' :
      observed?.result?.status ?? (complete ? 'READY' : 'RECEIVING'),
      receivedBytes: stat?.size ?? 0, bytes: manifest.archive.bytes, sha256: manifest.archive.sha256,
      imageId: manifest.image.imageId, contextSha256: manifest.image.contextSha256,
      release: manifest.image.release, sourceModes: manifest.image.sourceModes,
      manifest, observation: observed, verification, error: verification?.error ?? null,
      complete: complete && stat?.size === manifest.archive.bytes && !verification?.error };
  } catch (error) { return { ...record, phase: 'UNAVAILABLE', error: errorView(error) }; }
}
export async function imageWorkspaceState(root) {
  const base = await rootFor(root);
  const [images, transfers, reviewNames, deploymentNames] = await Promise.all([
    records(base, 'entries'), records(base, 'transfer-records'),
    readdir(join(base, 'reviews')), readdir(join(base, 'deployment-reviews')),
  ]);
  const readReviews = (names, area) => Promise.all(names.filter(x => /^[a-f0-9]{64}\.json$/.test(x))
    .map(name => readJSON(join(base, area, name))));
  return { schema: IMAGE_WORKSPACE_SCHEMA, directory: base, uploadChunkBytes: IMAGE_UPLOAD_CHUNK_BYTES,
    maxTransferBytes: IMAGE_TRANSFER_MAX_BYTES,
    images: await Promise.all(images.map(value => retainedImage(base, value))),
    transfers: await Promise.all(transfers.map(value => transferView(base, value))),
    reviews: await readReviews(reviewNames, 'reviews'),
    deploymentReviews: await readReviews(deploymentNames, 'deployment-reviews') };
}
export async function reviewWorkspaceImage(root, input) {
  const base = await rootFor(root);
  need(plain(input) && Object.keys(input).every(x => ['runtimeId', 'runtimeDirectory', 'id', 'baseImage', 'platform',
    'sourceRoot', 'runtime', 'uid', 'gid', 'pythonModules', 'nodeHeaders'].includes(x)), 'RUNTIME_IMAGE_REVIEW_FIELDS_INVALID');
  const runtimeDirectory = await privateDirectory(absolute(input.runtimeDirectory));
  const original = await readJSON(join(runtimeDirectory, 'runtime-install.json'));
  const raw = { schema: PLAN_SCHEMA, id: input.id, archive: original.archivePath,
    archiveSha256: original.archiveSha256, runtimeProfile: join(runtimeDirectory, 'runtime-profile.json'),
    selectedSourceRoot: original.sourceRoot, baseImage: input.baseImage, platform: input.platform,
    sourceRoot: input.sourceRoot, runtime: input.runtime, uid: input.uid ?? 65532, gid: input.gid ?? 65532,
    pythonModules: input.pythonModules ?? [], ...(input.nodeHeaders ? { nodeHeaders: absolute(input.nodeHeaders) } : {}) };
  const planFile = reviewAt(base, 'plans', identity(raw));
  await immutable(planFile, raw);
  const checked = await inspectPlan(planFile);
  need(checked.profile.profileId === original.profileId && checked.release.sourceCommit === original.source.sourceCommit,
    'RUNTIME_IMAGE_RUNTIME_PROFILE_CHANGED');
  const selection = { planFile, planSha256: checked.planSha256, profileSha256: checked.profileSha256,
    runtimeId: input.runtimeId, runtimeDirectory, archiveSha256: checked.release.archiveSha256,
    manifestSha256: checked.release.manifestSha256, profileId: checked.profile.profileId };
  const reviewId = identity(selection), file = reviewAt(base, 'reviews', reviewId);
  const existing = await readJSON(file, true);
  if (existing) return existing;
  const value = { schema: IMAGE_WORKSPACE_SCHEMA, reviewId, reviewedAt: now(), ...selection,
    id: checked.id, baseImage: checked.baseImage, platform: checked.platform, sourceRoot: checked.sourceRoot,
    runtime: checked.runtime, uid: checked.uid, gid: checked.gid, pythonModules: checked.pythonModules,
    dependencies: checked.dependencies, features: checked.features, release: checked.release,
    sourceModes: checked.sourceModes, dependencyRoot: checked.dependencyRoot,
    installation: checked.installation ?? null, nodeHeaders: input.nodeHeaders ?? null };
  try { await saveJSON(file, value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(file);
}
async function checkReview(base, reviewId) {
  const value = await readJSON(reviewAt(base, 'reviews', reviewId));
  const checked = await inspectPlan(value.planFile);
  need(value.reviewId === reviewId && checked.planSha256 === value.planSha256 &&
    checked.profileSha256 === value.profileSha256 && checked.profile.profileId === value.profileId &&
    checked.release.archiveSha256 === value.archiveSha256 && checked.release.manifestSha256 === value.manifestSha256,
  'RUNTIME_IMAGE_REVIEW_CHANGED', 'The selected original source or profile changed. Review its current image plan.');
  return value;
}
export async function attachWorkspaceImage(root, { directory, label: name } = {}) {
  const base = await rootFor(root), selected = await privateDirectory(absolute(directory));
  const context = await checkContext(selected, { requireLock: false });
  const record = await retainImage(base, selected, name ?? context.id);
  return { imageId: record.id, context: await retainedImage(base, record) };
}
export async function attachWorkspaceImageTransfer(root, { directory, label: name } = {}) {
  const base = await rootFor(root), target = await privateDirectory(absolute(directory));
  const manifest = portable(await readJSON(join(target, 'image-bundle.json')));
  const record = await retainTransfer(base, target, name ?? manifest.image.localTag);
  return { transferId: record.id, transfer: await transferView(base, record) };
}
export async function prepareWorkspaceImageTransfer(root, { manifest, requestId, label: name } = {}) {
  const base = await rootFor(root); operationId(requestId); portable(manifest);
  need(Buffer.byteLength(json(manifest)) <= 32768, 'RUNTIME_IMAGE_MANIFEST_TOO_LARGE');
  const directory = join(base, 'transfers', requestId);
  await ensureDirectory(directory);
  await immutable(join(directory, 'image-bundle.json'), manifest);
  const record = await retainTransfer(base, directory, name ?? manifest.image.localTag, { receiving: true });
  return { transferId: record.id, transfer: await transferView(base, record) };
}
async function fileDigest(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.size <= maximum, 'RUNTIME_IMAGE_TRANSFER_FILE_REQUIRED');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; hash.update(chunk); }
    const last = await handle.stat();
    need(bytes === first.size && first.size === last.size && first.mtimeMs === last.mtimeMs && first.ctimeMs === last.ctimeMs,
      'RUNTIME_IMAGE_TRANSFER_FILE_CHANGED');
    return { bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function verifyReceivedArchive(directory, path, manifest) {
  const actual = await fileDigest(path, manifest.archive.bytes);
  const matches = actual.bytes === manifest.archive.bytes && actual.sha256 === manifest.archive.sha256;
  const error = matches ? null : { code: 'RUNTIME_IMAGE_TRANSFER_HASH_MISMATCH',
    message: 'The received archive does not match its original SHA-256. Select the correct original files and choose Start a new receiving transfer. This failed transfer remains retained.' };
  await saveJSON(join(directory, 'workspace-receive.json'), {
    schema: 'stellar-forge.runtime-image-receive-verification.v1', checkedAt: now(),
    expected: manifest.archive, actual, error,
  }, true);
  need(matches, error?.code, error?.message, 409);
  return actual;
}
/** Each acknowledged chunk is fsynced. Reopen reads the retained offset; no base64 or whole-image buffer. */
export async function receiveWorkspaceImageChunk(root, { transferId, offset, body }) {
  const base = await rootFor(root), record = await transferEntry(base, transferId);
  need(record.receiving === true, 'RUNTIME_IMAGE_RECEIVING_TRANSFER_REQUIRED');
  const lease = await operationLease(join(base, 'leases', record.id + '.lock'));
  let handle;
  try {
    const manifest = portable(await readJSON(join(record.directory, 'image-bundle.json')));
    const verification = await readJSON(join(record.directory, 'workspace-receive.json'), true);
    need(!verification?.error, verification?.error?.code, verification?.error?.message, 409);
    const target = join(record.directory, 'image.tar'), partial = target + '.partial';
    need(Number.isSafeInteger(offset) && offset >= 0 && offset <= manifest.archive.bytes, 'RUNTIME_IMAGE_UPLOAD_OFFSET_INVALID');
    if (await exists(target)) {
      const actual = await verifyReceivedArchive(record.directory, target, manifest);
      return { transferId, receivedBytes: actual.bytes, complete: true };
    }
    handle = await open(partial, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const first = await handle.stat();
    need(first.isFile() && first.nlink === 1 && !(first.mode & 0o077), 'RUNTIME_IMAGE_PRIVATE_TRANSFER_REQUIRED');
    need(first.size === offset, 'RUNTIME_IMAGE_UPLOAD_OFFSET_CHANGED', 'Reopen the transfer to resume at its retained byte offset', 409);
    let received = offset, chunkBytes = 0;
    try {
      for await (const chunk of body) {
        chunkBytes += chunk.length;
        need(chunkBytes <= IMAGE_UPLOAD_CHUNK_BYTES && received + chunk.length <= manifest.archive.bytes,
          'RUNTIME_IMAGE_UPLOAD_CHUNK_TOO_LARGE', 'Send the next declared image chunk', 413);
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(chunk, written, chunk.length - written, received);
          need(result.bytesWritten > 0, 'RUNTIME_IMAGE_UPLOAD_WRITE_FAILED');
          written += result.bytesWritten; received += result.bytesWritten;
        }
      }
      need(chunkBytes > 0 || received === manifest.archive.bytes, 'RUNTIME_IMAGE_UPLOAD_EMPTY');
    } finally { await handle.sync(); await handle.close(); handle = null; }
    if (received === manifest.archive.bytes) {
      await verifyReceivedArchive(record.directory, partial, manifest);
      await link(partial, target); await unlink(partial);
      const directory = await open(record.directory, constants.O_RDONLY | constants.O_DIRECTORY);
      try { await directory.sync(); } finally { await directory.close(); }
    }
    return { transferId, receivedBytes: received, complete: received === manifest.archive.bytes };
  } finally { await handle?.close(); await lease.close(); }
}
export async function openWorkspaceImageDownload(root, { transferId, file }) {
  const base = await rootFor(root), record = await transferEntry(base, transferId);
  const manifest = portable(await readJSON(join(record.directory, 'image-bundle.json')));
  need(['image-bundle.json', 'image.tar'].includes(file), 'RUNTIME_IMAGE_DOWNLOAD_FILE_INVALID');
  const handle = await open(join(record.directory, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    need(stat.isFile() && (file !== 'image.tar' || stat.size === manifest.archive.bytes), 'RUNTIME_IMAGE_TRANSFER_INCOMPLETE');
    return { handle, bytes: stat.size, file, type: file === 'image.tar' ? 'application/x-tar' : 'application/json; charset=utf-8',
      sha256: file === 'image.tar' ? manifest.archive.sha256 : null };
  } catch (error) { await handle.close(); throw error; }
}
async function selectedReceipt(base, input) {
  need(Boolean(input.imageId) !== Boolean(input.transferId), 'RUNTIME_IMAGE_SELECTION_REQUIRED');
  if (input.imageId) {
    const selected = await imageEntry(base, recordId(input.imageId));
    return { imageId: selected.id, contextDirectory: selected.directory,
      receipt: receipt(await readJSON(join(selected.directory, 'image-receipt.json'))) };
  }
  const selected = await transferEntry(base, recordId(input.transferId));
  return { transferId: selected.id, transferDirectory: selected.directory,
    receipt: portable(await readJSON(join(selected.directory, 'image-bundle.json'))).image };
}
export async function reviewWorkspaceImageContainer(root, input) {
  const { CONTAINER_SCHEMA, validateContainerSpec, prepareContainer } = await import('../../sf99-merchant-deploy/container.mjs');
  const base = await rootFor(root), selected = await selectedReceipt(base, input), image = selected.receipt;
  const runtime = await inspectRuntimeInstall({ directory: absolute(input.runtimeDirectory), load: false, source: true });
  need(runtime.profileId === image.runtimeProfileId && runtime.sourceCommit === image.release.sourceCommit,
    'RUNTIME_IMAGE_CONTAINER_SOURCE_CHANGED', 'Select the runtime profile and source release used by this image');
  const sourceRoot = input.selectedSourceRoot === undefined ? runtime.sourceRoot : absolute(input.selectedSourceRoot);
  const profile = await readJSON(join(runtime.directory, 'runtime-profile.json'));
  await verifyRuntimeSource(profile, { sourceRoot });
  need(Boolean(input.containerPlan) !== Boolean(input.hostPlan), 'RUNTIME_IMAGE_MERCHANT_PLAN_REQUIRED');
  need(input.useImageRuntime === undefined || typeof input.useImageRuntime === 'boolean', 'RUNTIME_IMAGE_RUNTIME_SELECTION_INVALID');
  const originalPlan = absolute(input.containerPlan ?? input.hostPlan), originalBytes = await regular(originalPlan);
  const originalValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originalBytes));
  let original = input.containerPlan ? validateContainerSpec(originalValue) :
    validateContainerSpec({ schema: CONTAINER_SCHEMA, hostPlan: originalPlan, image: image.imageId,
      uid: image.uid, gid: image.gid, sourceMode: input.sourceMode ?? 'bind', readOnlyRoots: [] });
  if (original.sourceMode === 'bind' && Object.keys(image.dependencies ?? {}).length)
    need(runtime.ready === true, 'RUNTIME_IMAGE_CONTAINER_RUNTIME_NOT_READY', 'Use the original Ready runtime for bound dependencies');
  const originalHostPlan = original.hostPlan, originalHostBytes = await regular(originalHostPlan);
  const originalHost = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originalHostBytes));
  if (input.useImageRuntime === true) {
    const hostCopy = { ...originalHost, runtime: { ...originalHost.runtime, node: image.runtime.node, python: image.runtime.python } };
    const hostPlan = reviewAt(base, 'plans', identity(hostCopy));
    await immutable(hostPlan, hostCopy); original = { ...original, hostPlan };
  }
  const readOnlyRoots = [...(original.readOnlyRoots ?? [])];
  if ((original.sourceMode ?? 'bind') === 'bind' && Object.keys(image.dependencies ?? {}).length &&
    !readOnlyRoots.some(path => path === runtime.dependencyRoot || runtime.dependencyRoot.startsWith(path + '/')))
    readOnlyRoots.push(runtime.dependencyRoot);
  const spec = validateContainerSpec({ ...original, image: image.imageId, uid: image.uid, gid: image.gid, readOnlyRoots });
  need(image.sourceModes.includes(spec.sourceMode), 'RUNTIME_IMAGE_SOURCE_MODE_UNAVAILABLE');
  if (spec.sourceMode === 'image') need(sourceRoot === image.sourceRoot, 'RUNTIME_IMAGE_CONTAINER_PATH_MISMATCH',
    'Image mode requires the retained source at the image source path. The original bind mode can use the selected local runtime.');
  const planFile = reviewAt(base, 'plans', identity(spec));
  await immutable(planFile, spec);
  const prepared = await prepareContainer(planFile, { sourceRoot });
  need(prepared.host.node === image.runtime.node && prepared.host.python === image.runtime.python,
    'RUNTIME_IMAGE_CONTAINER_RUNTIME_MISMATCH', 'Review the original host plan with this image’s exact Node and Python executable paths');
  const selection = { ...selected, receiptSha256: identity(image), runtimeId: input.runtimeId,
    runtimeDirectory: runtime.directory, sourceRoot, originalPlan, originalPlanSha256: digest(originalBytes),
    originalHostPlan, originalHostPlanSha256: digest(originalHostBytes), originalHostRuntime: originalHost.runtime ?? null,
    useImageRuntime: input.useImageRuntime ?? false,
    planFile, planSha256: prepared.specSha256, preparedSha256: identity(prepared), spec,
    sourceCommit: image.release.sourceCommit, archiveSha256: image.release.archiveSha256 };
  const deploymentReviewId = identity(selection), file = reviewAt(base, 'deployment-reviews', deploymentReviewId);
  const existing = await readJSON(file, true);
  if (existing) return existing;
  const value = { schema: IMAGE_WORKSPACE_SCHEMA, deploymentReviewId, reviewedAt: now(), ...selection,
    merchant: prepared.host.merchant, publicOrigin: prepared.host.publicOrigin, privateStateRoot: prepared.host.stateRoot,
    originalImage: input.containerPlan ? originalValue.image : null, dependencyRoot: runtime.dependencyRoot };
  try { await saveJSON(file, value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(file);
}
async function imageBusy(root, key, id) {
  for (const name of (await readdir(join(root, 'operations'))).filter(x => /^[a-f0-9-]{36}$/.test(x) && x !== id)) {
    const request = await readJSON(join(root, 'operations', name, 'request.json'), true);
    if (!request || ![request.imageId, request.transferId].includes(key)) continue;
    const state = await readJSON(join(root, 'operations', name, 'state.json'), true);
    need(!(state?.phase === 'QUEUED' || state?.phase === 'RUNNING' && await workerAlive(state)),
      'RUNTIME_IMAGE_OPERATION_RUNNING', 'Open the existing image operation and its retained worker log', 409);
  }
}
/** Normalization retains source identities in the original worker request hash.
 * Repeated delivery of the same request ID reuses the first normalized request. */
export async function normalizeImageOperation(root, request, id) {
  const base = await rootFor(root); operationId(id);
  const input = Object.fromEntries(['operation', ...imageOperationFields[request.operation]]
    .filter(key => Object.hasOwn(request, key)).map(key => [key, request[key]]));
  const imageInputHash = identity(input);
  const prior = await readJSON(join(root, 'operations', id, 'request.json'), true);
  if (prior) {
    need(prior.imageInputHash === imageInputHash, 'RUNTIME_WORKSPACE_REQUEST_ID_REUSED');
    const { requestHash, createdAt, ...retained } = prior;
    return retained;
  }
  const value = { ...request, imageInputHash };
  if (['image_build', 'image_status', 'image_export', 'image_import', 'image_container'].includes(value.operation))
    value.engine = program(value.engine, 'docker');
  if (value.operation === 'image_prepare') {
    const review = await readJSON(reviewAt(base, 'reviews', value.reviewId));
    need(review.reviewId === value.reviewId, 'RUNTIME_IMAGE_REVIEW_REQUIRED');
    value.contextDirectory = join(base, 'contexts', id);
    value.imageId = (await retainImage(base, value.contextDirectory, review.id,
      { reviewId: review.reviewId, runtimeId: review.runtimeId, runtimeDirectory: review.runtimeDirectory })).id;
  } else if (value.operation === 'image_container') {
    const review = await readJSON(reviewAt(base, 'deployment-reviews', value.deploymentReviewId));
    need(review.deploymentReviewId === value.deploymentReviewId, 'RUNTIME_IMAGE_REVIEW_REQUIRED');
    value.imageId = review.imageId; value.transferId = review.transferId;
    value.containerDirectory = join(base, 'deployments', id);
  } else if (value.imageId) {
    const selected = await imageEntry(base, recordId(value.imageId));
    const context = await readJSON(join(selected.directory, 'context.json'));
    need(context.schema === CONTEXT_SCHEMA && context.directory === selected.directory, 'RUNTIME_IMAGE_CONTEXT_REQUIRED');
    value.contextDirectory = selected.directory; value.contextPin = contextPin(context);
    if (value.operation === 'image_lock') {
      value.npm = program(value.npm, 'npm');
      if (value.lockFile) {
        absolute(value.lockFile); value.lockFileSha256 = digest(await regular(value.lockFile, 16 * 1024 * 1024));
      }
    } else if (value.operation === 'image_check') {
      need(value.requireLock === undefined || typeof value.requireLock === 'boolean', 'RUNTIME_IMAGE_LOCK_BOOLEAN_REQUIRED');
      value.requireLock ??= true;
    }
    if (['image_build', 'image_status', 'image_export'].includes(value.operation)) {
      need(HASH.test(context.lockSha256 ?? ''), 'RUNTIME_IMAGE_LOCK_REQUIRED');
      value.contextSha256 = contextIdentity(context);
    }
    if (value.operation === 'image_export') {
      value.transferDirectory = join(base, 'transfers', id);
      value.transferId = (await retainTransfer(base, value.transferDirectory, selected.label + ' image',
        { imageId: selected.id })).id;
    }
  }
  if (value.operation === 'image_import') {
    const selected = await transferEntry(base, recordId(value.transferId));
    const manifest = portable(await readJSON(join(selected.directory, 'image-bundle.json')));
    value.transferDirectory = selected.directory; value.portableSha256 = identity(manifest);
    need(await exists(join(selected.directory, 'image.tar')), 'RUNTIME_IMAGE_TRANSFER_INCOMPLETE');
  }
  need(value.imageId || value.transferId, 'RUNTIME_IMAGE_SELECTION_REQUIRED');
  await imageBusy(root, value.imageId ?? value.transferId, id);
  return value;
}
export async function executeImageOperation(root, request, id) {
  const base = await rootFor(root), lease = await operationLease(join(base, 'leases',
    recordId(request.imageId ?? request.transferId) + '.lock'));
  try {
    let result;
    if (request.operation === 'image_prepare') {
      const review = await checkReview(base, request.reviewId);
      result = await prepareImage(review.planFile, request.contextDirectory);
    } else if (request.operation === 'image_import') {
      const manifest = portable(await readJSON(join(request.transferDirectory, 'image-bundle.json')));
      need(identity(manifest) === request.portableSha256, 'RUNTIME_IMAGE_TRANSFER_CHANGED');
      result = await importImage(request.transferDirectory, { engine: request.engine, stream: true });
      await saveJSON(join(request.transferDirectory, 'workspace-import.json'), { operationId: id, observedAt: now(), result }, true);
    } else if (request.operation === 'image_container') {
      const { prepareContainer, generateContainer, checkContainer } = await import('../../sf99-merchant-deploy/container.mjs');
      const review = await readJSON(reviewAt(base, 'deployment-reviews', request.deploymentReviewId));
      need(digest(await regular(review.originalPlan)) === review.originalPlanSha256 &&
        digest(await regular(review.originalHostPlan)) === review.originalHostPlanSha256, 'RUNTIME_IMAGE_CONTAINER_PLAN_CHANGED');
      const selected = await selectedReceipt(base, review);
      need(identity(selected.receipt) === review.receiptSha256, 'RUNTIME_IMAGE_RECEIPT_CHANGED');
      const current = await prepareContainer(review.planFile, { sourceRoot: review.sourceRoot });
      need(identity(current) === review.preparedSha256, 'RUNTIME_IMAGE_CONTAINER_REVIEW_CHANGED');
      if (review.imageId) await imageStatus(review.contextDirectory, { engine: request.engine });
      else await importImage(review.transferDirectory, { engine: request.engine, stream: true });
      result = await generateContainer(review.planFile, request.containerDirectory, { sourceRoot: review.sourceRoot });
      await checkContainer(result.bundle);
      result = { ...result, status: 'IMAGE_CONTAINER_PREPARED', deploymentReviewId: review.deploymentReviewId,
        originalPlan: review.originalPlan, retainedPlan: review.planFile, receipt: selected.receipt };
    } else {
      const context = await checkContext(request.contextDirectory, {
        requireLock: !['image_lock', 'image_check'].includes(request.operation) || request.requireLock === true });
      need(contextPin(context) === request.contextPin, 'RUNTIME_IMAGE_CONTEXT_CHANGED');
      if (request.contextSha256) need(contextIdentity(context) === request.contextSha256, 'RUNTIME_IMAGE_LOCK_CHANGED');
      if (request.operation === 'image_lock') {
        if (request.lockFile) need(digest(await regular(request.lockFile, 16 * 1024 * 1024)) === request.lockFileSha256,
          'RUNTIME_IMAGE_LOCK_FILE_CHANGED');
        result = await lockImage(request.contextDirectory, { npm: request.npm, lockFile: request.lockFile ?? null, stream: true });
      } else if (request.operation === 'image_check') {
        result = { status: 'IMAGE_CONTEXT_CHECKED', directory: context.directory,
          lockChecked: request.requireLock, contextSha256: context.lockSha256 ? contextIdentity(context) : null,
          release: context.release, profileId: context.profile.profileId };
      } else if (request.operation === 'image_build') result = await buildImage(request.contextDirectory, { engine: request.engine, stream: true });
      else if (request.operation === 'image_status') result = await imageStatus(request.contextDirectory, { engine: request.engine });
      else if (request.operation === 'image_export') result = await exportImage(request.contextDirectory,
        request.transferDirectory, { engine: request.engine, stream: true });
      else need(false, 'RUNTIME_IMAGE_ACTION_INVALID');
    }
    if (request.imageId) await saveJSON(fileAt(base, 'observations', request.imageId),
      { operationId: id, observedAt: now(), result }, true);
    return { ...result, workspaceImageId: request.imageId ?? null, transferId: request.transferId ?? null };
  } finally { await lease.close(); }
}
