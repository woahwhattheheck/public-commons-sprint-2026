// MIT. Portable migration closure composed from the original project and runtime exports.
import { constants } from 'node:fs';
import { open, mkdir, lstat, readdir, rename, rm, realpath } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readPackage, privateParent } from '../workspace/model.mjs';
import { readReleaseState, inspectRelease } from '../../sf82-seller-pilot/releases.mjs';
import { openMigrationProjects, canonical, sha256 } from './project-store.mjs';
import { openAcquisitions } from './acquisition.mjs';

export const HANDOVER_SCHEMA = 'stellar-forge.blockworks-migration-handover.v1';
const encode = promisify(gzip), decode = promisify(gunzip);
const MAX_FILE = 32 * 1024 * 1024, MAX_TOTAL = 96 * 1024 * 1024;
export const HANDOVER_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE = HANDOVER_MAX_ARCHIVE_BYTES, MAX_ENVELOPE = 136 * 1024 * 1024, MAX_FILES = 3000;
const HASH = /^[a-f0-9]{64}$/, ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const jsonBytes = value => Buffer.from(canonical(value) + '\n');
function need(value, message) { if (!value) throw new TypeError(message); }
function id(value) { need(typeof value === 'string' && ID.test(value), 'Use a stable lowercase handover or workspace name.'); return value; }
function pathname(value) {
  need(typeof value === 'string' && value.length <= 600 && !value.includes('\\') &&
    value.split('/').every(part => part.length && part !== '.' && part !== '..' &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part)), 'Unexpected handover file path.');
  return value;
}
async function bytes(path, maximum = MAX_FILE) {
  const f = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await f.stat(); need(stat.isFile() && stat.size <= maximum, 'Handover input exceeds its regular-file limit.');
    const value = await f.readFile(); need(value.length <= maximum, 'Handover input grew beyond its limit.'); return value;
  } finally { await f.close(); }
}
async function directory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && (process.platform === 'win32' || !(stat.mode & 0o077)),
    'Use a private handover directory without symbolic links.');
  return path;
}
async function write(path, body) {
  const f = await open(path, 'wx', 0o600);
  try { await f.writeFile(body); await f.sync(); } finally { await f.close(); }
}
async function sync(path) { const f = await open(path, constants.O_RDONLY); try { await f.sync(); } finally { await f.close(); } }
const optionalBytes = async path => { try { return await bytes(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

function manifestIdentity(manifest) {
  const { digest, archive, ...bound } = manifest;
  return sha256(canonical(bound));
}
function fileSet() {
  const files = new Map(), blobs = new Map(); let total = 0;
  return {
    add(path, body) {
      pathname(path); need(Buffer.isBuffer(body) && body.length <= MAX_FILE, 'A handover file exceeds 32 MiB.');
      const hash = sha256(body), before = files.get(path);
      if (before) { need(before.sha256 === hash && before.bytes === body.length, 'Two native exports disagree about ' + path); return; }
      total += body.length;
      need(total <= MAX_TOTAL && files.size < MAX_FILES, 'Migration handover exceeds its file or total-byte limit.');
      files.set(path, { path, sha256: hash, bytes: body.length }); blobs.set(hash, body.toString('base64'));
    },
    finish() {
      return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
        blobs: Object.fromEntries([...blobs].sort(([a], [b]) => a.localeCompare(b))), totalBytes: total };
    }
  };
}
function guide(manifest) {
  return [
    '# Migration handover', '', manifest.title,
    '', 'Project: ' + manifest.projectId, 'Project edition: ' + manifest.projectRevision,
    'Prepared by: ' + manifest.actor, 'Prepared at: ' + manifest.createdAt,
    'Receiving team: ' + manifest.receiver, '', manifest.note,
    '', '## Reopen', '',
    'Open the original API merchant workspace, choose Migrations, then import this handover under a new workspace name.',
    'The import creates a separate private workspace and verifies every file before making it available.',
    'Open the received workspace to inspect the original sources, full project history, acquisitions, mappings and saved comparisons.',
    'Saved merchant packages and SF82 release selections use their original readers. No provider request or seller startup is made by import.',
    '', '## Operate', '',
    'Review the selected release and its environment variable references before starting it. Set the actual values in the launcher environment.',
    'Open the original customer receiving workspace to review an incoming request, its selected offer and budget, then prepare its runbook.',
    'Execute or recover that original runbook from the customer workspace. The migration view can compare its verified retained response.',
    'Acquisition resume uses the original retained request, captured pages and provider retry time.',
    '', '## Contents', '',
    'The package includes the recorded migration project, exact retained sources and responses, original acquisition export records,',
    'selected merchant packages, immutable release files and the saved release-selection history.',
    'Customer receiving reports may be included when explicitly exported; private receiving configuration remains with its operator.',
    'Previous handover archive files are not nested recursively. Their recorded project-history entries remain intact.',
    '', 'Recorded mapping results describe the selected source editions. Re-run a review after changing those sources or mapping decisions.',
    '', 'Files: ' + manifest.files.length, 'Retained file bytes: ' + manifest.totalBytes,
    'Manifest SHA-256: ' + manifest.digest, ''
  ].join('\n');
}

/** Both exporters and importers call the maintained readers; this module does not start a seller or buyer. */
export async function openMigrationHandovers({ projects, releases, acquisition, python } = {}) {
  const root = projectId => join(projects.projectDirectory(projectId), 'handovers');
  async function get(projectId, name) {
    await projects.get(projectId); id(name);
    const folder = join(root(projectId), name), manifest = JSON.parse(await bytes(join(folder, 'manifest.json')));
    need(manifest.schema === HANDOVER_SCHEMA && manifest.id === name && manifest.projectId === projectId &&
      manifestIdentity(manifest) === manifest.digest, 'Handover manifest changed.');
    return { folder, manifest, filename: name + '.migration.json.gz' };
  }
  async function list(projectId) {
    await projects.get(projectId); const folder = await directory(root(projectId)); const result = [];
    for (const name of (await readdir(folder)).filter(value => ID.test(value)).sort()) {
      try { const value = await get(projectId, name); result.push({ ...value.manifest, files: undefined, filename: value.filename }); }
      catch (error) { result.push({ id: name, problem: error.message }); }
    }
    return result;
  }
  async function download(projectId, name) {
    const value = await get(projectId, name), body = await bytes(join(value.folder, 'handover.json.gz'), MAX_ARCHIVE);
    need(body.length === value.manifest.archive.bytes && sha256(body) === value.manifest.archive.sha256, 'Handover archive changed.');
    return { ...value, body };
  }
  async function create({ projectId, name, expectedRevision, actor, requestId, receiver = '', note = '', customerExports = [] }) {
    id(name); id(requestId); need(typeof actor === 'string' && actor.trim() && actor.length <= 180, 'Enter the operator preparing this handover.');
    need(typeof receiver === 'string' && receiver.length <= 240 && typeof note === 'string' && note.length <= 8000,
      'Receiving team and handover note exceed their text limits.');
    const project = await projects.get(projectId);
    const existing = await optionalBytes(join(root(projectId), name, 'manifest.json'));
    if (existing) {
      const value = await get(projectId, name);
      need(value.manifest.projectRevision === expectedRevision && value.manifest.requestId === requestId &&
        value.manifest.actor === actor, 'That handover name already identifies another snapshot.');
      return { ...value, reused: true };
    }
    need(project.revision === expectedRevision, 'The migration changed. Reload its current edition before preparing the handover.');
    need(Array.isArray(customerExports) && customerExports.length <= 100, 'Choose at most 100 original customer report exports.');
    const handovers = await directory(root(projectId)), temporary = await directory(join(handovers, '.build-' + randomUUID()));
    const files = fileSet(), prefix = 'migrations/' + projectId, native = { acquisitions: [], packages: [], releases: [], customerExports: [] };
    try {
      files.add(prefix + '/project.json', await bytes(join(project.directory, 'project.json')));
      const history = await projects.history(projectId);
      for (const row of history.editions) {
        const file = String(row.sequence).padStart(10, '0') + '.json';
        const body = await bytes(join(project.directory, 'editions', file));
        need(sha256(body) === row.revision, 'A project edition changed while preparing the handover.');
        files.add(prefix + '/editions/' + file, body);
      }
      for (const file of (await readdir(join(project.directory, 'sources'))).sort()) {
        if (!/^[a-f0-9]{64}\.[a-z0-9.]+$/.test(file)) continue;
        files.add(prefix + '/sources/' + file, await bytes(join(project.directory, 'sources', file)));
      }
      const exportParent = await directory(join(temporary, 'native-acquisitions'));
      for (const entry of project.state.acquisitions) {
        const selected = await acquisition(projectId, entry.id);
        const exported = await selected.service.exportRun(entry.id, { directory: join(exportParent, entry.id) });
        const manifestFiles = exported.files.filter(file => /^runs\/[^/]+\/manifest\.json$/.test(file.path));
        need(manifestFiles.length === 1 && manifestFiles[0].sha256 === exported.manifestSha256,
          'The original acquisition export must retain its exact manifest file.');
        const manifestPath = manifestFiles[0].path, runPrefix = manifestPath.slice(0, -'manifest.json'.length);
        for (const file of exported.files) {
          need(file.path.startsWith(runPrefix) || file.path.startsWith('sources/'), 'Unexpected native acquisition export path.');
          const body = await bytes(join(exported.directory, pathname(file.path)));
          need(body.length === file.bytes && sha256(body) === file.sha256, 'Native acquisition export changed.');
          files.add(prefix + '/acquisitions/' + file.path, body);
        }
        files.add(prefix + '/acquisitions/export-records/' + entry.id + '.json',
          await bytes(join(exported.directory, 'export.json')));
        native.acquisitions.push({ id: entry.id, fingerprint: exported.fingerprint,
          manifestSha256: exported.manifestSha256, manifestPath, sourceRef: entry.sourceRef, status: exported.manifest.status ?? exported.manifest.state ?? null });
      }
      const packageNames = [...new Set([project.state.merchant?.baseline, project.state.merchant?.package?.name].filter(Boolean))];
      for (const name of packageNames) {
        const merchant = await readPackage(projects.merchantParent, name);
        files.add(name + '/merchant-package.json', await bytes(join(merchant.folder, 'merchant-package.json')));
        for (const file of Object.keys(merchant.manifest.files)) files.add(name + '/' + pathname(file), await bytes(join(merchant.folder, file)));
        const compiled = JSON.parse(await bytes(join(merchant.folder, 'compiled', 'manifest.json')));
        for (const file of ['manifest.json', 'offers.json', 'seller-service.json', ...(compiled.responseFiles ?? []).map(row => row.file)])
          files.add(name + '/compiled/' + pathname(file), await bytes(join(merchant.folder, 'compiled', file)));
        for (const file of ['README.md', 'source-refresh.json']) {
          const body = await optionalBytes(join(merchant.folder, file)); if (body) files.add(name + '/' + file, body);
        }
        native.packages.push({ name, id: merchant.manifest.id, files: merchant.manifest.files });
      }
      const releaseStatus = await releases.status(projectId);
      if (releaseStatus.initialized) {
        const releaseRoot = releases.root(projectId), stateBytes = await bytes(join(releaseRoot, 'state.json'));
        native.releaseState = JSON.parse(stateBytes); files.add(prefix + '/releases/state.json', stateBytes);
        for (const row of releaseStatus.releases) {
          await releases.inspect(projectId, row.id);
          const folder = join(releaseRoot, 'releases', row.id), body = await bytes(join(folder, 'release.json')), record = JSON.parse(body);
          need(!record.handlerEntry, 'This handover supports the original generated upstream merchant releases.');
          files.add(prefix + '/releases/releases/' + row.id + '/release.json', body);
          for (const file of record.files) {
            const data = await bytes(join(folder, pathname(file.file)));
            need(data.length === file.bytes && sha256(data) === file.sha256, 'An original release file changed.');
            files.add(prefix + '/releases/releases/' + row.id + '/' + file.file, data);
          }
          native.releases.push({ id: row.id, digest: record.digest });
        }
        need((await bytes(join(releaseRoot, 'state.json'))).equals(stateBytes), 'Release selection changed while preparing the handover.');
      }
      for (const item of customerExports) {
        id(item.id); const folder = join(project.directory, 'customer-exports');
        const path = join(folder, pathname(item.file));
        need((await realpath(path)).startsWith((await realpath(folder)) + sep), 'Choose an original export from this project.');
        const body = await bytes(path);
        need(HASH.test(item.sha256) && sha256(body) === item.sha256, 'The selected customer report export changed.');
        files.add(prefix + '/customer-exports/' + item.file, body);
        native.customerExports.push({ id: item.id, file: item.file, sha256: item.sha256, bytes: body.length });
      }
      need((await projects.get(projectId)).revision === expectedRevision, 'The migration changed during handover preparation.');
      const collected = files.finish();
      const manifest = { schema: HANDOVER_SCHEMA, id: name, requestId, projectId, title: project.title,
        customer: project.customer, projectRevision: project.revision, actor, receiver, note, createdAt: new Date().toISOString(),
        files: collected.files, totalBytes: collected.totalBytes, native };
      manifest.digest = manifestIdentity(manifest);
      const envelope = jsonBytes({ manifest, blobs: collected.blobs });
      need(envelope.length <= MAX_ENVELOPE, 'Handover envelope exceeds its limit.');
      const archive = await encode(envelope, { level: 6 });
      need(archive.length <= MAX_ARCHIVE, 'Compressed handover exceeds 32 MiB.');
      manifest.archive = { bytes: archive.length, sha256: sha256(archive), encoding: 'gzip-json-base64' };
      await write(join(temporary, 'handover.json.gz'), archive);
      await write(join(temporary, 'manifest.json'), jsonBytes(manifest));
      await write(join(temporary, 'README.md'), guide(manifest));
      await rm(exportParent, { recursive: true });
      await sync(temporary);
      const destination = join(handovers, name);
      try { await lstat(destination); throw new Error('That handover name was created in another view. Reopen it.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rename(temporary, destination); await sync(handovers);
      return { folder: destination, manifest, filename: name + '.migration.json.gz', reused: false };
    } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  }
  return { root, create, get, list, download, restore: options => restoreMigrationHandover({ ...options, parent: projects.merchantParent, python }) };
}

/** An imported archive always creates a new received workspace under the current private parent. */
export async function restoreMigrationHandover({ body, name, parent, expectedSha256, python } = {}) {
  id(name); need(Buffer.isBuffer(body) && body.length > 0 && body.length <= MAX_ARCHIVE, 'Choose a handover archive up to 32 MiB.');
  if (expectedSha256 !== undefined) need(HASH.test(expectedSha256) && sha256(body) === expectedSha256, 'The selected handover archive identity changed.');
  const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await decode(body, { maxOutputLength: MAX_ENVELOPE })));
  const { manifest, blobs } = envelope;
  need(manifest?.schema === HANDOVER_SCHEMA && manifestIdentity(manifest) === manifest.digest &&
    ID.test(manifest.projectId) && Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= MAX_FILES &&
    blobs && typeof blobs === 'object' && !Array.isArray(blobs), 'Use an original complete migration handover.');
  const seen = new Set(), decoded = new Map(); let total = 0;
  for (const file of manifest.files) {
    pathname(file.path); need(!seen.has(file.path) && HASH.test(file.sha256) && Number.isSafeInteger(file.bytes) &&
      file.bytes >= 0 && file.bytes <= MAX_FILE, 'Invalid or duplicate handover file descriptor.');
    seen.add(file.path); total += file.bytes; need(total <= MAX_TOTAL, 'Handover retained bytes exceed 96 MiB.');
    if (!decoded.has(file.sha256)) {
      const value = blobs[file.sha256];
      need(typeof value === 'string' && value.length <= Math.ceil(MAX_FILE / 3) * 4, 'Missing handover file bytes.');
      const data = Buffer.from(value, 'base64');
      need(data.toString('base64') === value && sha256(data) === file.sha256, 'A handover file failed its content identity.');
      decoded.set(file.sha256, data);
    }
    need(decoded.get(file.sha256).length === file.bytes, 'A handover file length changed.');
  }
  need(total === manifest.totalBytes && Object.keys(blobs).length === decoded.size, 'Handover file closure differs from its manifest.');
  const base = await privateParent(parent), received = await directory(join(base, 'received-migrations'));
  const destination = join(received, name);
  try { await lstat(destination); throw new Error('That received workspace already exists. Reopen it or choose a new name.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = await directory(join(received, '.receive-' + randomUUID()));
  try {
    for (const file of manifest.files) {
      const target = join(temporary, file.path), parts = relative(temporary, dirname(target)).split(sep).filter(Boolean);
      let folder = temporary; for (const part of parts) folder = await directory(join(folder, part));
      await write(target, decoded.get(file.sha256));
    }
    const projects = await openMigrationProjects({ parent: temporary }), project = await projects.get(manifest.projectId);
    need(project.revision === manifest.projectRevision, 'The received project does not match its recorded edition.');
    for (const source of project.state.sources) await projects.readSource(project.id, source.ref);
    for (const merchant of manifest.native.packages) {
      const reopened = await readPackage(temporary, merchant.name);
      need(reopened.manifest.id === merchant.id && canonical(reopened.manifest.files) === canonical(merchant.files), 'The original merchant package identity changed.');
    }
    for (const entry of project.state.acquisitions) {
      const source = await projects.readSource(project.id, entry.sourceRef);
      const service = await openAcquisitions({ directory: join(project.directory, 'acquisitions'),
        source: { file: source.file, url: source.metadata.provenance.url, sha256: source.metadata.sha256 }, ...(python ? { python } : {}) });
      const observed = await service.get(entry.id), exported = manifest.native.acquisitions.find(row => row.id === entry.id);
      need(exported && typeof exported.manifestPath === 'string', 'The original acquisition manifest path is missing.');
      const manifestBytes = await bytes(join(service.directory, pathname(exported.manifestPath)));
      need(sha256(manifestBytes) === exported.manifestSha256 &&
        canonical(JSON.parse(manifestBytes.toString('utf8'))) === canonical(observed),
        'The original received acquisition manifest changed.');
      for (const capture of observed.captures) await service.readCapture(entry.id, capture.id);
    }
    if (manifest.native.releaseState) {
      const releaseRoot = join(project.directory, 'releases'), state = await readReleaseState(releaseRoot);
      need(canonical(state) === canonical(manifest.native.releaseState), 'The original release selection changed.');
      for (const record of manifest.native.releases) {
        const inspected = await inspectRelease(releaseRoot, record.id);
        need(inspected.digest === record.digest, 'The original release identity changed.');
      }
    }
    await write(join(temporary, 'received-handover.json'), jsonBytes({ schema: HANDOVER_SCHEMA,
      id: manifest.id, digest: manifest.digest, projectId: manifest.projectId, projectRevision: manifest.projectRevision,
      archiveSha256: sha256(body), importedAt: new Date().toISOString() }));
    await sync(temporary);
    await rename(temporary, destination); await sync(received);
    return { workspace: name, directory: destination, projectId: manifest.projectId,
      projectRevision: manifest.projectRevision, handoverId: manifest.id, handoverDigest: manifest.digest,
      files: manifest.files.length, providerRequests: 0, runtimeStarted: false };
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}
