// MIT. Durable saved-export handoff; browser actions select retained IDs, not host paths.
import { mkdir, readdir, readFile, lstat, realpath, open, unlink, link } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readReleaseState } from '../../../sf82-seller-pilot/releases.mjs';
import { startReleaseConsole } from '../../../sf82-seller-pilot/release-console.mjs';
import { reviewPostgresSelection, stageReviewedPostgresRelease } from '../../../sf82-seller-pilot/release-postgres-control.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const error = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const filesAllowed = new Set(['source.json', 'service.json', 'query.sql', 'START.md', 'ca.pem']);
async function writeNew(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await link(temporary, path);
  } finally { await unlink(temporary).catch(cause => { if (cause.code !== 'ENOENT') throw cause; }); }
}
async function privateJson(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) throw error('EXPORT_RECEIPT_INVALID', 'A saved export receipt is unavailable or changed.');
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function createWorkspaceReleaseHandoff({ outputRoot, releaseStore }) {
  await mkdir(resolve(outputRoot), { recursive: true, mode: 0o700 });
  const root = await realpath(resolve(outputRoot));
  const directory = join(root, '.sf30-release-handoffs');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw error('EXPORT_RECEIPT_INVALID', 'Use a real export handoff directory.');
  const store = releaseStore === undefined ? null : resolve(releaseStore);
  if (store) await readReleaseState(store);
  const storeKey = store ? hash(store).slice(0, 24) : null;
  let consoleSession = null, opening = null, closed = false;

  async function receipt(exportId) {
    if (!/^[0-9a-f]{32}$/.test(exportId ?? '')) throw error('EXPORT_NOT_FOUND', 'Select a saved merchant export.', 404);
    const value = await privateJson(join(directory, 'export-' + exportId + '.json'));
    if (value.exportId !== exportId || value.schema !== 'stellar-forge.postgres-workspace-handoff.v1' ||
        dirname(value.directory) !== root || basename(value.directory).startsWith('.') ||
        !Array.isArray(value.files) || value.files.some(file => !filesAllowed.has(file.name)))
      throw error('EXPORT_RECEIPT_INVALID', 'The saved export receipt does not match this workspace.');
    return value;
  }
  async function verify(value) {
    if ((await lstat(value.directory)).isSymbolicLink() || await realpath(value.directory) !== value.directory)
      throw error('EXPORTED_PACKAGE_CHANGED', 'The saved package directory changed. Re-export the reviewed merchant choices.');
    for (const file of value.files) {
      const path = join(value.directory, file.name), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes || hash(await readFile(path)) !== file.sha256)
        throw error('EXPORTED_PACKAGE_CHANGED', 'Saved package bytes changed. Re-export the reviewed merchant choices.');
    }
    const actual = (await readdir(value.directory)).filter(name => filesAllowed.has(name)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(value.files.map(file => file.name).sort()))
      throw error('EXPORTED_PACKAGE_CHANGED', 'The saved package file selection changed. Re-export it.');
  }
  async function list({ after = '', limit = 50 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw error('EXPORT_PAGE_INVALID', 'Use 1–100 exports per page.', 422);
    const names = (await readdir(directory)).filter(name => /^export-[0-9a-f]{32}\.json$/.test(name)).sort();
    const page = names.filter(name => !after || name > after).slice(0, limit + 1), items = [], errors = [];
    for (const name of page.slice(0, limit)) {
      try {
        const item = await receipt(name.slice(7, -5));
        items.push(item);
      } catch (cause) { errors.push({ receipt: name, error: cause.code ?? 'EXPORT_RECEIPT_INVALID' }); }
    }
    const handoffs = [];
    if (storeKey) for (const name of (await readdir(directory)).filter(name => name.startsWith('stage-' + storeKey + '-') && name.endsWith('.json'))) {
      try { handoffs.push(await privateJson(join(directory, name))); }
      catch (cause) { errors.push({ receipt: name, error: cause.code ?? 'EXPORT_RECEIPT_INVALID' }); }
    }
    return { items, handoffs, errors, nextAfter: page.length > limit ? page[limit - 1] : null,
      total: names.length, releaseStore: store, enabled: Boolean(store) };
  }
  async function register(saved, publicOrigin) {
    const exportId = randomUUID().replaceAll('-', ''), metadata = [];
    if (dirname(saved.directory) !== root) throw error('EXPORT_DESTINATION_CHANGED', 'The saved export is outside this workspace.');
    for (const name of saved.files) {
      if (!filesAllowed.has(name)) throw error('EXPORT_RECEIPT_INVALID', 'Unexpected merchant package file.');
      const path = join(saved.directory, name), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
        throw error('EXPORT_RECEIPT_INVALID', 'Merchant package file is unavailable or exceeds its limit.');
      const bytes = await readFile(path); metadata.push({ name, bytes: bytes.length, sha256: hash(bytes) });
    }
    const value = { schema: 'stellar-forge.postgres-workspace-handoff.v1', exportId,
      directory: saved.directory, planId: saved.planId, files: metadata,
      publicOrigin: publicOrigin || null, createdAt: new Date().toISOString(), run: saved.run };
    await writeNew(join(directory, 'export-' + exportId + '.json'), value);
    return value;
  }
  async function review(exportId) {
    const saved = await receipt(exportId); await verify(saved);
    return { export: saved, review: await reviewPostgresSelection({ postgresPackage: saved.directory }) };
  }
  async function stage(input) {
    if (!store) throw error('RELEASE_STORE_NOT_CONFIGURED', 'Reopen the workspace with --release-store pointing to the existing release store.');
    if (!input || Object.keys(input).some(key => !['exportId', 'id', 'label', 'runtime', 'expectedInputManifestSha256'].includes(key)))
      throw error('POSTGRES_STAGE_INPUT_INVALID', 'Supply only the declared release handoff fields.', 422);
    const saved = await receipt(input.exportId);
    const { exportId, ...selection } = input;
    const result = await stageReviewedPostgresRelease(store, { ...selection, postgresPackage: saved.directory }, { beforeCapture: () => verify(saved) });
    const value = { schema: 'stellar-forge.postgres-workspace-stage.v1', exportId, releaseId: result.release.id,
      releaseDigest: result.release.digest, releaseStore: store,
      inputManifestSha256: result.release.postgres.inputManifestSha256, recordedAt: new Date().toISOString() };
    const path = join(directory, 'stage-' + storeKey + '-' + result.release.id + '.json');
    try { await writeNew(path, value); }
    catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
      const prior = await privateJson(path);
      if (prior.releaseDigest !== value.releaseDigest || prior.inputManifestSha256 !== value.inputManifestSha256)
        throw error('RELEASE_HANDOFF_CONFLICT', 'The retained handoff receipt has a different release identity. Inspect the release console.');
    }
    return { ...result, handoff: await privateJson(path) };
  }
  async function openConsole() {
    if (!store || closed) throw error('RELEASE_STORE_NOT_CONFIGURED', 'Open this workspace with its existing release store.');
    if (!opening && !consoleSession) opening = startReleaseConsole(store, { port: 0 }).then(session => {
      consoleSession = session;
      session.closed.finally(() => { if (consoleSession === session) consoleSession = null; }).catch(() => {});
      return session;
    }).finally(() => { opening = null; });
    const session = consoleSession ?? await opening;
    return { operatorUrl: session.operatorUrl, store, ownership: 'WORKSPACE_PROCESS',
      message: 'This workspace owns the release console and any seller it starts. Closing the workspace stops those processes.' };
  }
  return { enabled: Boolean(store), releaseStore: store, register, list, review, stage, openConsole,
    async close() { closed = true; await opening?.catch(() => {}); await consoleSession?.close(); } };
}
