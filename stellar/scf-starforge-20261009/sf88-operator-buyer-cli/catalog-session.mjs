// SPDX-License-Identifier: MIT
// Local, single-writer, restartable acquisition of ORIGINAL unsigned catalog pages.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, rename, unlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { lockPrivateDirectory } from './private-directory-lock.mjs';
import { isDeepStrictEqual } from 'node:util';
import { need, InputError } from './config.mjs';
import { catalogPageView, catalogIndexView } from './catalog-view.mjs';

const schema = 'stellar-forge.sf88.catalog-acquisition.v1';
const json = value => Buffer.from(JSON.stringify(value) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pageName = index => `page-${String(index).padStart(6, '0')}.json`;
const safeCode = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'CATALOG_ACQUISITION_FAILED';

async function readJSON(path, optional = false, maxBytes = 1048576) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    need(info.isFile() && info.size <= maxBytes, 'CATALOG_FILE_INVALID');
    const bytes = await handle.readFile();
    need(bytes.length <= maxBytes, 'CATALOG_FILE_TOO_LARGE');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return { value, sha256: hash(bytes) };
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError || error instanceof TypeError) throw new InputError('CATALOG_FILE_JSON_INVALID');
    throw error;
  } finally { await handle?.close(); }
}
async function syncDirectory(dir) {
  if (process.platform === 'win32') return;
  const handle = await open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomic(dir, name, data, exclusive = false) {
  const temporary = join(dir, `.write-${randomUUID()}`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data); await handle.sync(); await handle.close();
    if (exclusive) await link(temporary, join(dir, name));
    else await rename(temporary, join(dir, name));
    await syncDirectory(dir);
  } finally {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
function identity(options) {
  const request = { origin: options.request.origin, query: options.request.query ?? '',
    filters: Object.fromEntries(Object.entries(options.request.filters ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    limit: options.request.limit ?? 20, offset: options.request.offset ?? 0 };
  return { schema, request, allPages: options.allPages };
}
function describe(page, file, digest, state, requestSha256) {
  const p = page?.pagination, n = page?.originalListings?.length;
  need(page?.mode === 'ORIGINAL_UNSIGNED_CATALOG' && typeof page.source === 'string' &&
    ['resources', 'items'].includes(page.sourceEnvelope) && Array.isArray(page.originalListings),
  'CATALOG_PAGE_SHAPE_INVALID');
  need(p && Number.isSafeInteger(p.offset) && p.offset === state.nextOffset &&
    Number.isSafeInteger(p.limit) && p.limit >= 1 && p.limit <= state.request.limit &&
    Number.isSafeInteger(p.total) && p.total >= 0 && n <= p.limit &&
    Number.isSafeInteger(p.offset + n) && (n === 0 || p.offset + n <= p.total),
  'CATALOG_PAGINATION_INVALID');
  need(n > 0 || p.offset >= p.total, 'CATALOG_PAGINATION_NOT_PROGRESSING');
  const first = state.pages[0];
  if (first) {
    need(p.total === state.total && page.sourceEnvelope === state.sourceEnvelope,
      'CATALOG_PAGINATION_CHANGED_START_NEW_CAPTURE');
    const currentURL = new URL(page.source), previousURL = new URL(first.source);
    currentURL.searchParams.delete('offset'); previousURL.searchParams.delete('offset');
    need(currentURL.href === previousURL.href, 'CATALOG_PAGE_SOURCE_CHANGED');
  }
  const capture = page.capture;
  need(capture?.schema === schema && capture.requestSha256 === requestSha256 &&
    capture.previousSha256 === (state.pages.at(-1)?.sha256 ?? null) &&
    typeof capture.capturedAt === 'string' && Number.isFinite(Date.parse(capture.capturedAt)) &&
    ['DIRECT_HTTPS', 'EXPLICIT_HTTP_CONNECT'].includes(capture.transport), 'CATALOG_PAGE_CHAIN_INVALID');
  return { file, sha256: digest, source: page.source, offset: p.offset, rows: n,
    capturedAt: capture.capturedAt, transport: capture.transport };
}

export async function acquireCatalog(options, readPage) {
  await mkdir(options.captureDir, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(options.captureDir);
  need(info.isDirectory() && !info.isSymbolicLink() &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0 && info.uid === process.getuid()),
  'CATALOG_DIRECTORY_MUST_BE_PRIVATE_AND_OWNED');
  const dir = await realpath(options.captureDir);
  const release = await lockPrivateDirectory({ directory: dir, filename: '.catalog-writer.lock',
    namespace: 'sf88-catalog', busyCode: 'CATALOG_WRITER_ACTIVE_OR_STALE_SOCKET',
    unavailableCode: 'CATALOG_LOCK_UNAVAILABLE' });
  let state, initialized = false;
  try {
    const requestIdentity = identity(options), requestSha256 = hash(json(requestIdentity));
    const priorSession = await readJSON(join(dir, 'session.json'), true);
    if (priorSession) need(isDeepStrictEqual(priorSession.value, requestIdentity), 'CATALOG_SESSION_REQUEST_CHANGED');
    else {
      const files = await readdir(dir);
      need(files.every(name => name === '.catalog-writer.sock' || name === '.catalog-writer.lock' || name.startsWith('.write-')),
        'CATALOG_DIRECTORY_NOT_EMPTY');
      await atomic(dir, 'session.json', json(requestIdentity), true);
    }
    const previousManifest = await readJSON(join(dir, 'manifest.json'), true, 8 * 1048576);
    if (previousManifest) need(previousManifest.value.schema === schema &&
      previousManifest.value.requestSha256 === requestSha256 && Array.isArray(previousManifest.value.pages),
    'CATALOG_MANIFEST_INVALID');
    state = { schema, request: requestIdentity.request, requestSha256,
      observation: 'PARSED_PAGES_NOT_ATOMIC_PROVIDER_SNAPSHOT', status: 'ACQUIRING',
      pages: [], rows: 0, total: null, sourceEnvelope: null,
      nextOffset: requestIdentity.request.offset, error: null };
    // Rebuild from immutable complete pages. A page committed just before a crash
    // is recovered even when the manifest checkpoint was not yet replaced.
    const names = (await readdir(dir)).filter(name => /^page-[0-9]{6}\.json$/.test(name)).sort();
    need(names.length <= 10000, 'CATALOG_TOO_MANY_SAVED_PAGES');
    const apply = (page, file, digest) => {
      const entry = describe(page, file, digest, state, requestSha256);
      state.pages.push(entry); state.rows += entry.rows;
      state.total = page.pagination.total; state.sourceEnvelope = page.sourceEnvelope;
      state.nextOffset = entry.offset + entry.rows;
      state.status = !options.allPages || state.nextOffset >= state.total ? 'COMPLETE' : 'ACQUIRING';
    };
    const checkpoint = async () => {
      state.updatedAt = new Date().toISOString();
      await atomic(dir, 'manifest.json', json(state));
      await atomic(dir, 'index.html', catalogIndexView(state));
    };
    for (const [i, file] of names.entries()) {
      need(file === pageName(i) && state.status !== 'COMPLETE', 'CATALOG_PAGE_SEQUENCE_INVALID');
      const saved = await readJSON(join(dir, file));
      const recorded = previousManifest?.value.pages[i];
      if (recorded) need(recorded.file === file && recorded.sha256 === saved.sha256,
        'CATALOG_SAVED_PAGE_HASH_MISMATCH');
      apply(saved.value, file, saved.sha256);
      await atomic(dir, file.replace('.json', '.html'), catalogPageView(saved.value, file));
    }
    need((previousManifest?.value.pages.length ?? 0) <= state.pages.length, 'CATALOG_SAVED_PAGE_MISSING');
    initialized = true;
    while (state.status !== 'COMPLETE') {
      if (state.pages.length >= options.maxPages) { state.status = 'PAGE_LIMIT_REACHED'; break; }
      const page = await readPage({ ...requestIdentity.request, offset: state.nextOffset });
      page.capture = { schema, requestSha256, capturedAt: new Date().toISOString(),
        transport: options.proxy ? 'EXPLICIT_HTTP_CONNECT' : 'DIRECT_HTTPS',
        previousSha256: state.pages.at(-1)?.sha256 ?? null };
      const bytes = json(page), file = pageName(state.pages.length), digest = hash(bytes);
      need(bytes.length <= 1048576, 'CATALOG_SAVED_PAGE_TOO_LARGE');
      describe(page, file, digest, state, requestSha256);
      await atomic(dir, file, bytes, true);
      apply(page, file, digest);
      await atomic(dir, file.replace('.json', '.html'), catalogPageView(page, file));
      await checkpoint();
    }
    await checkpoint();
    return { mode: 'ORIGINAL_CATALOG_ACQUISITION', status: state.status, captureDir: dir,
      pages: state.pages.length, observedRows: state.rows, reportedTotal: state.total,
      nextOffset: state.nextOffset, manifest: join(dir, 'manifest.json'), review: join(dir, 'index.html'),
      observation: state.observation, paymentsInitiated: 0 };
  } catch (error) {
    // Do not rewrite evidence when an existing session or its hashes failed validation.
    if (initialized) {
      state.status = 'PARTIAL'; state.error = safeCode(error); state.updatedAt = new Date().toISOString();
      await atomic(dir, 'manifest.json', json(state)).catch(() => {});
      await atomic(dir, 'index.html', catalogIndexView(state)).catch(() => {});
    }
    throw error;
  } finally { await release(); }
}
