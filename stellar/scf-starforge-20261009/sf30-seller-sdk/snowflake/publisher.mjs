// MIT. Compose the existing SQLite workbench, SF82 release and receiving console.
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { materializeSnowflakeEdition } from './edition.mjs';
import { canonical, sha256 } from './store.mjs';
import { fault } from './declaration.mjs';

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || await realpath(path) !== path)
    throw fault('SNOWFLAKE_PRIVATE_DIRECTORY_REQUIRED');
}

/** The operator supplies real public origin/payment terms and deliberately
 * public example inputs. Every paid read runs on this reviewed retained edition. */
export async function prepareSnowflakeMerchant(store, { editionId, draft, publicationId = randomUUID(),
  runtime = { port: 0 }, label } = {}) {
  const edition = store.edition(editionId), review = store.latestReview(editionId);
  if (review?.decision !== 'ACCEPTED')
    throw fault('SNOWFLAKE_EDITION_REVIEW_REQUIRED', 'Accept this exact retained edition before publishing it.');
  const [{ openWorkbench, compileDraft }, { prepareSqliteRelease }, releases] = await Promise.all([
    import('../sqlite/workbench/model.mjs'), import('../../sf82-seller-pilot/release-sqlite.mjs'),
    import('../../sf82-seller-pilot/releases.mjs'),
  ]);
  const { path: database } = await materializeSnowflakeEdition(store, editionId);
  const normalizedRuntime = releases.normalizeReleaseRuntime(runtime);
  if (normalizedRuntime.handlers || normalizedRuntime.upstreams || normalizedRuntime.allowLoopbackUpstream)
    throw fault('SNOWFLAKE_RELEASE_RUNTIME_INVALID', 'The original SQLite merchant owns its query handlers.');
  compileDraft(draft, database);
  const request = { editionId, draft, runtime: normalizedRuntime, label: label ?? edition.queryName + ' · ' + edition.createdAt,
    reviewSequence: review.sequence }, requestSha256 = sha256(canonical(request));
  let operation = store.getPublication(publicationId);
  if (operation && (operation.editionId !== editionId || operation.requestSha256 !== requestSha256))
    throw fault('SNOWFLAKE_PUBLICATION_CHANGED', 'This publication ID already belongs to its saved edition, review and merchant terms.', 409);
  if (!operation) operation = store.publication(editionId, { request, requestSha256, status: 'PREPARING' }, publicationId);
  publicationId = operation.id;
  const root = join(store.directory, 'merchant'), workspace = join(root, publicationId);
  const releaseRoot = join(store.directory, 'release-store'), releaseId = 'snowflake-' + publicationId;
  await privateDirectory(root); await privateDirectory(workspace);
  let workbench;
  try {
    workbench = await openWorkbench({ database, workspace });
    let current = await workbench.state();
    if (canonical(current.draft) !== canonical(draft)) current = await workbench.save(draft, current.revision);
    const existing = current.exports.find(item => item.name === 'merchant');
    const prepared = existing ?? await workbench.exportPack('merchant', current.revision);
    const checked = await prepareSqliteRelease(prepared.directory);
    if (canonical(checked.source.queries) !== canonical(compileDraft(draft, database).source.queries))
      throw fault('SNOWFLAKE_PREPARED_SOURCE_CHANGED');
    store.updatePublication(publicationId, { status: 'STAGING', directory: prepared.directory, releaseRoot, releaseId });
    try { await releases.readReleaseState(releaseRoot); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await releases.initReleaseStore(releaseRoot); }
    try { await releases.inspectRelease(releaseRoot, releaseId); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await releases.stageRelease(releaseRoot, { id: releaseId, label: request.label,
        sqlitePackage: prepared.directory, runtime: normalizedRuntime });
    }
    // The original inspector traverses and hashes the retained native snapshot,
    // query configuration, service, offers and workbench files.
    const verified = await releases.inspectRelease(releaseRoot, releaseId);
    return store.updatePublication(publicationId, { status: 'PREPARED', directory: prepared.directory,
      releaseRoot, releaseId, release: verified, dataset: { editionId, rowCount: edition.rowCount,
        statementHandle: edition.statementHandle, nativePartitions: edition.partitionCount },
      links: { releaseCommand: ['starforge', 'releases', 'status', '--store', releaseRoot],
        consoleCommand: ['starforge', 'releases', 'console', '--store', releaseRoot] } });
  } catch (error) {
    store.updatePublication(publicationId, { status: 'INTERRUPTED',
      lastError: { code: error.code ?? 'SNOWFLAKE_MERCHANT_PREPARATION_INTERRUPTED', message: error.message } });
    throw error;
  } finally { await workbench?.close(); }
}

/** Existing SF82 console owns activation, rollback, seller/facilitator, customer
 * exports and original receiving configuration. This workspace owns its lifetime. */
export async function openSnowflakeReleaseConsole(store, { port = 0, env = process.env, ...options } = {}) {
  const root = join(store.directory, 'release-store');
  const { startReleaseConsole } = await import('../../sf82-seller-pilot/release-console.mjs');
  return startReleaseConsole(root, { port, env, ...options });
}
