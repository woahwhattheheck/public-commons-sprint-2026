// MIT. S3 authoring composes the original source, compiler and release lifecycle.
import { constants } from 'node:fs';
import { mkdir, realpath, lstat, open } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { validateS3Config } from '../config.mjs';
import { createS3ObjectSource } from '../source.mjs';
import { compileS3Seller, configureS3Seller } from '../cli.mjs';
import { compileHttpSellerOffer } from '../../seller.mjs';
import { prepareS3Release, inspectS3Release } from '../../../sf82-seller-pilot/release-s3.mjs';
import { initReleaseStore, readReleaseState, releaseStatus, inspectRelease, stageRelease } from '../../../sf82-seller-pilot/releases.mjs';
import { startReleaseConsole } from '../../../sf82-seller-pilot/release-console.mjs';
import { openS3WorkspaceStore, S3WorkspaceError, operationId, revisionNumber, encode, sha256, fingerprint } from './store.mjs';

const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const publicReview = value => { const { selectedSource, ...result } = value; return result; };
const releaseId = value => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) throw new S3WorkspaceError('INVALID_RELEASE_ID');
  return value;
};
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function readPrivate(path, maximum = 2 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) throw new S3WorkspaceError('WORKSPACE_FILE_INVALID');
    const bytes = Buffer.alloc(Number(before.size) + 1); let used = 0;
    while (used < bytes.length) { const part = await file.read(bytes, used, bytes.length - used, null); if (!part.bytesRead) break; used += part.bytesRead; }
    const after = await file.stat({ bigint: true });
    if (BigInt(used) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      throw new S3WorkspaceError('WORKSPACE_FILE_CHANGED', 409);
    return bytes.subarray(0, used);
  } finally { await file.close(); }
}
export function validateS3MerchantDraft({ source: input, payment, origin } = {}) {
  const source = validateS3Config(input);
  if (Buffer.byteLength(encode(source)) > 1048576 || !plain(payment) || Buffer.byteLength(encode(payment)) > 65536)
    throw new S3WorkspaceError('MERCHANT_INPUT_TOO_LARGE');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new S3WorkspaceError('PUBLIC_HTTPS_ORIGIN_REQUIRED');
  const mapped = payment.schema === 'stellar-forge.s3-payments.v1' ? payment.objects : null;
  if (mapped && (!plain(mapped) || Object.keys(mapped).some(id => !source.objects.some(item => item.id === id))))
    throw new S3WorkspaceError('PAYMENT_OBJECT_SELECTION_INVALID');
  // The original compiler validates each payment; object snapshots are selected
  // only by review's actual HEAD reads, not by draft validation.
  for (const item of source.objects) compileHttpSellerOffer({ url: url.origin + item.path,
    method: 'GET', description: item.description, payment: mapped ? mapped[item.id] : payment });
  return { source: JSON.parse(encode(source)), payment: JSON.parse(encode(payment)), origin: url.origin };
}
function runtimeOptions(runtime = {}) {
  if (!plain(runtime) || Object.keys(runtime).some(key => !['port', 'facilitator', 'allowLocalFacilitator'].includes(key)))
    throw new S3WorkspaceError('INVALID_S3_RUNTIME');
  const result = { port: runtime.port ?? 0 };
  if (!Number.isInteger(result.port) || result.port < 0 || result.port > 65535) throw new S3WorkspaceError('INVALID_SELLER_PORT');
  if (runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean') throw new S3WorkspaceError('INVALID_S3_RUNTIME');
  if (runtime.facilitator !== undefined) {
    const url = new URL(runtime.facilitator), local = runtime.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' && !local)
      throw new S3WorkspaceError('INVALID_FACILITATOR_URL');
    result.facilitator = url.href.replace(/\/$/, '');
  }
  if (runtime.allowLocalFacilitator) {
    if (!result.facilitator) throw new S3WorkspaceError('FACILITATOR_REQUIRED');
    result.allowLocalFacilitator = true;
  }
  return result;
}

export async function openS3MerchantWorkspace({ directory, releaseStore, initial, sourceOptions, expectedWorkspaceId } = {}) {
  if (typeof directory !== 'string' || !directory) throw new S3WorkspaceError('WORKSPACE_DIRECTORY_REQUIRED');
  const store = await openS3WorkspaceStore(directory, { expectedWorkspaceId }), root = store.directory;
  let releases, consoleSession, closing = null, stopped = false;
  const active = new Map();
  try {
    const selected = resolve(releaseStore ?? store.metadata('releaseStore') ?? join(root, 'releases'));
    releases = await exists(selected) ? await realpath(selected) : join(await realpath(dirname(selected)), basename(selected));
    store.metadata('releaseStore', releases);
    await store.lockOperation(async () => {
      if (!await exists(releases)) await initReleaseStore(releases);
      else await readReleaseState(releases);
      await mkdir(join(root, 'packages'), { recursive: true, mode: 0o700 });
    });
    if (initial && !store.latest()) store.save({ expectedRevision: 0, operationId: 'initial-' + store.workspaceId,
      ...validateS3MerchantDraft(initial) });
  } catch (error) { store.close(); throw error; }

  const openGuard = () => { if (stopped) throw new S3WorkspaceError('WORKSPACE_CLOSING', 409); };
  const action = (id, kind, input, task) => {
    openGuard(); operationId(id); const digest = fingerprint({ kind, input });
    if (active.has(id)) {
      if (active.get(id).digest !== digest) return Promise.reject(new S3WorkspaceError('OPERATION_CONTENT_CONFLICT', 409));
      return active.get(id).promise;
    }
    let acquired = false;
    const promise = Promise.resolve().then(() => store.lockOperation(() => { acquired = true; return task(); })).catch(error => {
      if (acquired && error.code !== 'OPERATION_CONTENT_CONFLICT') store.failOperation(id, error);
      throw error;
    }).finally(() => active.delete(id));
    active.set(id, { digest, promise }); return promise;
  };
  async function packageDescription(id, review) {
    const directory = join(root, 'packages', operationId(id));
    const prepared = await prepareS3Release(directory);
    if (prepared.s3.sourceConfigSha256 !== review.selectionSha256 ||
        sha256(prepared.serviceBytes) !== sha256(encode(review.service)))
      throw new S3WorkspaceError('PACKAGE_REVIEW_MISMATCH', 409, 'This package differs from the selected original object review.');
    const files = [];
    for (const file of ['source.json', 'service.json', 'handlers.mjs', 'objects.json']) {
      const bytes = await readPrivate(join(directory, file)); files.push({ file, bytes: bytes.length, sha256: sha256(bytes) });
    }
    return { packageId: id, revision: review.revision, reviewId: review.reviewId, state: 'COMPLETE', directory, files,
      sourceConfigSha256: prepared.s3.sourceConfigSha256, objectsSha256: prepared.s3.objectsSha256,
      offersSha256: sha256(prepared.offersBytes), serviceConfigSha256: sha256(prepared.serviceBytes) };
  }
  const getPackage = async ({ packageId }) => {
    const operation = store.getOperation(packageId);
    if (!operation || operation.kind !== 'PREPARE') throw new S3WorkspaceError('PACKAGE_NOT_FOUND', 404);
    if (operation.state !== 'COMPLETE') throw new S3WorkspaceError('PACKAGE_INCOMPLETE', 409, 'Resume this same preparation operation to inspect and finish its original files.');
    const description = await packageDescription(packageId, store.review(operation.input.reviewId));
    if (fingerprint(description) !== fingerprint(operation.result)) throw new S3WorkspaceError('PACKAGE_CHANGED', 409);
    return description;
  };
  async function customerRelease(id) {
    releaseId(id);
    const release = await inspectRelease(releases, id);
    const directory = join(releases, 'releases', id);
    const snapshot = await inspectS3Release(directory);
    const files = [
      { file: 'objects.json', path: join(directory, 's3', 'objects.json'), sha256: snapshot.s3.objectsSha256 },
      { file: 'offers.json', path: join(directory, 'offers.json'), sha256: snapshot.manifest.offersSha256 },
    ];
    for (const item of files) {
      item.data = await readPrivate(item.path);
      if (sha256(item.data) !== item.sha256) throw new S3WorkspaceError('CUSTOMER_FILE_CHANGED', 409);
      item.bytes = item.data.length;
    }
    return { releaseId: id, releaseDigest: release.digest, files };
  }
  const controller = {
    directory: root, releaseStore: releases, workspaceId: store.workspaceId,
    authoringPort: store.authoringPort(),
    retainAuthoringPort(value) { openGuard(); return store.retainAuthoringPort(value); },
    async status() {
      openGuard(); const operations = store.operations();
      return { workspaceId: store.workspaceId, draft: store.latest(), history: store.history(), reviews: store.reviews(),
        packages: operations.filter(item => item.kind === 'PREPARE').map(item => item.result ?? {
          packageId: item.operationId, state: item.state, error: item.error, createdAt: item.createdAt }),
        operations, releases: await releaseStatus(releases), busy: [...active.keys()] };
    },
    history(options) { openGuard(); return store.history(options); },
    revision({ revision }) { openGuard(); return store.revision(revision); },
    save({ expectedRevision, operationId: id, source, payment, origin }) {
      openGuard(); return store.save({ expectedRevision, operationId: id, ...validateS3MerchantDraft({ source, payment, origin }) });
    },
    getReview({ reviewId }) { openGuard(); return publicReview(store.review(reviewId)); },
    review({ revision, operationId: id }) {
      revisionNumber(revision); const input = { revision };
      return action(id, 'REVIEW', input, async () => {
        const operation = store.beginOperation(id, 'REVIEW', input);
        if (operation.state === 'COMPLETE') return publicReview(store.review(operation.result.reviewId));
        const draft = store.revision(revision), source = await createS3ObjectSource(draft.source, sourceOptions);
        try {
          const description = source.describe(), selectedSource = source.snapshotConfig();
          const service = compileS3Seller({ description, payment: draft.payment, origin: draft.origin });
          const review = store.saveReview({ revision, selectedSource, description, service,
            sourceSha256: draft.sourceSha256, operationId: id });
          return publicReview(review);
        } finally { source.close(); }
      });
    },
    prepare({ revision, reviewId, operationId: id }) {
      revisionNumber(revision); const input = { revision, reviewId };
      return action(id, 'PREPARE', input, async () => {
        const operation = store.beginOperation(id, 'PREPARE', input), review = store.review(reviewId);
        if (review.revision !== revision) throw new S3WorkspaceError('REVIEW_REVISION_CONFLICT', 409);
        if (operation.state === 'COMPLETE') return getPackage({ packageId: id });
        const draft = store.revision(revision), target = join(root, 'packages', id);
        await configureS3Seller({ directory: target, payment: draft.payment, origin: draft.origin, resume: true,
          source: { describe: () => structuredClone(review.description), snapshotConfig: () => structuredClone(review.selectedSource) } });
        const description = await packageDescription(id, review);
        return store.finishOperation(id, description);
      });
    },
    getPackage(options) { openGuard(); return getPackage(options); },
    stage({ packageId, releaseId: selectedId, operationId: id, runtime }) {
      operationId(packageId); releaseId(selectedId);
      const options = runtimeOptions(runtime), input = { packageId, releaseId: selectedId, runtime: options };
      return action(id, 'STAGE', input, async () => {
        const prior = store.getOperation(id);
        if (prior) {
          if (prior.kind !== 'STAGE' || prior.inputSha256 !== fingerprint(input)) throw new S3WorkspaceError('OPERATION_CONTENT_CONFLICT', 409);
          if (prior.state === 'COMPLETE') {
            const current = await inspectRelease(releases, selectedId);
            if (current.digest !== prior.result.release.digest) throw new S3WorkspaceError('RELEASE_CHANGED', 409);
            return { ...prior.result, release: current };
          }
        }
        const original = prior?.context ?? await getPackage({ packageId });
        const operation = store.beginOperation(id, 'STAGE', input, original);
        let release;
        if (await exists(join(releases, 'releases', selectedId))) release = await inspectRelease(releases, selectedId);
        else release = await stageRelease(releases, { id: selectedId, s3Package: original.directory, runtime: options });
        if (release.source.sourceConfigSha256 !== original.sourceConfigSha256 || release.source.objectsSha256 !== original.objectsSha256 ||
            release.source.offersSha256 !== original.offersSha256 || release.source.serviceConfigSha256 !== original.serviceConfigSha256 ||
            fingerprint(release.runtime) !== fingerprint(options))
          throw new S3WorkspaceError('RELEASE_CONTENT_CONFLICT', 409, 'This release ID belongs to different products, prices or runtime settings.');
        return store.finishOperation(operation.operationId, { operationId: id, packageId, release });
      });
    },
    async exportCustomer({ releaseId: id }) {
      openGuard(); const result = await customerRelease(id);
      return { releaseId: result.releaseId, releaseDigest: result.releaseDigest,
        files: result.files.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 })) };
    },
    async readCustomerFile({ releaseId: id, file, offset = 0, limit = 49152, expectedSha256 }) {
      openGuard();
      if (!['objects.json', 'offers.json'].includes(file) || !Number.isSafeInteger(offset) || offset < 0 ||
          !Number.isInteger(limit) || limit < 1 || limit > 65536) throw new S3WorkspaceError('INVALID_CUSTOMER_READ');
      const result = await customerRelease(id), selected = result.files.find(item => item.file === file);
      if (expectedSha256 !== undefined && expectedSha256 !== selected.sha256) throw new S3WorkspaceError('CUSTOMER_FILE_CHANGED', 409);
      if (offset > selected.bytes) throw new S3WorkspaceError('OFFSET_OUTSIDE_FILE', 416);
      const end = Math.min(selected.bytes, offset + limit);
      return { releaseId: result.releaseId, releaseDigest: result.releaseDigest, file, sha256: selected.sha256,
        totalBytes: selected.bytes, offset, nextOffset: end, eof: end === selected.bytes,
        dataBase64: selected.data.subarray(offset, end).toString('base64') };
    },
    async openReleaseConsole({ port = 0 } = {}) {
      openGuard();
      if (!consoleSession) consoleSession = startReleaseConsole(releases, { port });
      let session;
      try { session = await consoleSession; } catch (error) { consoleSession = null; throw error; }
      return { url: session.url, operatorUrl: session.operatorUrl };
    },
    close() {
      if (closing) return closing; stopped = true;
      closing = (async () => {
        await Promise.allSettled([...active.values()].map(item => item.promise));
        try { if (consoleSession) await (await consoleSession).close(); }
        finally { store.close(); }
      })(); return closing;
    },
  };
  return controller;
}

export { inspectS3WorkspaceStore } from './store.mjs';
