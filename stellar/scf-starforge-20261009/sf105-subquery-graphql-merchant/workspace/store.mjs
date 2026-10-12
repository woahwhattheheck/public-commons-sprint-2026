// MIT. Private revisioned drafts for the original SF105 merchant onboarding.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile, readdir, rename, rm, realpath, link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const SCHEMA = 'stellar-forge.graphql-workspace-draft.v1';
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TEXT_FIELDS = ['schemaText', 'queriesText', 'planText'];
const LIMITS = { schemaText: 1024 * 1024, queriesText: 1024 * 1024,
  planText: 262144 };
const json = value => JSON.stringify(value, null, 2) + '\n';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function projectName(value) {
  if (typeof value !== 'string' || !NAME.test(value)) fail('Project name: 1–64 letters, numbers, underscores or hyphens.');
  return value;
}
export function draftInput(input) {
  if (!plain(input)) fail('Expected a project draft.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 || /[\u0000-\u001f\u007f]/.test(input.title))
    fail('Give the project a title of at most 160 characters.');
  const draft = { title: input.title.trim() };
  for (const field of TEXT_FIELDS) {
    if (typeof input[field] !== 'string' || Buffer.byteLength(input[field]) > LIMITS[field])
      fail(field + ' exceeds its input limit.');
    draft[field] = input[field];
  }
  return draft;
}
export function inputDigest(input) {
  const draft = draftInput(input);
  return digest(json(Object.fromEntries(TEXT_FIELDS.map(field => [field, draft[field]]))));
}
async function privateDir(path, create = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || process.platform !== 'win32' && (info.mode & 0o077))
    fail('Use a private regular workspace directory (mode 0700).');
  return realpath(path);
}
async function regular(path, limit = 8 * 1024 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit || process.platform !== 'win32' && (info.mode & 0o077))
    fail('Workspace file must be a private regular file within its size limit.');
  const bytes = await readFile(path);
  if (bytes.length > limit) fail('Workspace file exceeds its input limit.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function writePrivate(path, text) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
async function createPrivate(path, text) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writePrivate(temporary, text);
    // A no-replace hard link publishes only complete bytes. A failed write can
    // leave a private temporary file, never a poisoned immutable revision.
    await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally { await rm(temporary, { force: true }); }
}
async function replacePrivate(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writePrivate(temporary, json(value)); await rename(temporary, path);
    await syncDirectory(dirname(path));
  }
  finally { await rm(temporary, { force: true }); }
}
function validateVersion(value, id) {
  if (!plain(value) || value.schema !== SCHEMA || value.id !== id || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      value.inputDigest !== inputDigest(value.input) || !Array.isArray(value.exports) ||
      value.deployments !== undefined && !Array.isArray(value.deployments) ||
      value.previews !== undefined && !Array.isArray(value.previews)) fail('Saved project content is inconsistent.');
  return value;
}
const summary = value => ({ id: value.id, title: value.input.title, revision: value.revision,
  updatedAt: value.updatedAt, inputDigest: value.inputDigest, exports: value.exports.length,
  deployments: value.deployments?.length ?? 0, previews: value.previews?.length ?? 0 });

async function acquireWriter(root) {
  if (process.platform !== 'linux') fail('This workspace requires Linux with util-linux flock.', 501);
  const file = await open(join(root, 'writer.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077)) fail('The workspace writer lock must be a private regular file.');
    await new Promise((done, reject) => {
      // fd 3 duplicates this process's open file description. The kernel lock
      // remains on our retained descriptor after flock exits, and dies with it.
      const child = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
        { stdio: ['ignore', 'ignore', 'ignore', file.fd] });
      child.once('error', () => reject(new Error('Install util-linux flock to open this Linux workspace.')));
      child.once('close', code => code === 0 ? done() : reject(Object.assign(new Error(code === 73 ?
        'This workspace is already open in another process.' : 'Could not acquire the workspace writer lock.'),
      { status: code === 73 ? 409 : 500 })));
    });
    return file;
  } catch (error) { await file.close(); throw error; }
}

/** Read an original immutable revision without acquiring a writer or starting a runtime. */
export async function readWorkspaceRevision(directory, id, revision) {
const root = await privateDir(resolve(directory)), projects = join(root, 'projects');
  projectName(id);
  const folder = await privateDir(join(projects, id));
  const head = await regular(join(folder, 'head.json'), 4096);
  if (head.id !== id || !Number.isSafeInteger(head.revision) || head.revision < 1) fail('Saved project head is invalid.');
  const selected = revision ?? head.revision;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > head.revision) fail('Unknown project revision.', 404);
  const text = await regular(join(folder, selected + '.json'));
  const value = validateVersion(text, id);
  if (value.revision !== selected || selected === head.revision && head.inputDigest !== value.inputDigest)
    fail('Saved project revision is inconsistent.');
  return { ...value, currentRevision: head.revision };
}

/** One process owns the local writer; readers never load partial version files. */
export async function openWorkspaceStore(directory) {
  if (typeof directory !== 'string' || !directory) fail('Choose --workspace PRIVATE_DIRECTORY.');
  const root = await privateDir(resolve(directory), true);
  const projects = await privateDir(join(root, 'projects'), true);
  const packages = await privateDir(join(root, 'packages'), true);
  const deployments = await privateDir(join(root, 'deployments'), true);
  const releaseStores = await privateDir(join(root, 'release-stores'), true);
  const previews = await privateDir(join(root, 'previews'), true);
  const writer = await acquireWriter(root);
  let busy = false, closed = false;
  const read = (id, revision) => readWorkspaceRevision(root, id, revision);
  async function list() {
    const entries = await readdir(projects, { withFileTypes: true }), items = [];
    for (const entry of entries.filter(value => value.isDirectory() && NAME.test(value.name))) {
      try { items.push(summary(await read(entry.name))); }
      catch (error) { items.push({ id: entry.name, unreadable: true, error: error.message }); }
    }
    return items.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }
  async function history(id) {
    const head = await read(id), items = [];
    for (let revision = head.revision; revision >= 1 && items.length < 100; revision--) items.push(summary(await read(id, revision)));
    return { id, currentRevision: head.revision, items, more: head.revision > 100 };
  }
  async function mutate(operation) {
    if (closed) fail('The workspace is closing.', 503);
    if (busy) fail('Another project operation is in progress. Try again when it finishes.', 409);
    busy = true;
    try { return await operation(); } finally { busy = false; }
  }
  async function save({ id, input, expectedRevision = 0, exportRecord, deploymentRecord, previewRecord } = {}) {
    return mutate(async () => {
      projectName(id);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('A current project revision is required.');
      const draft = draftInput(input), folder = join(projects, id);
      let previous;
      try { previous = await read(id); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if ((previous?.revision ?? 0) !== expectedRevision) fail('Project changed. Reopen the latest revision before saving.', 409);
      if (!previous) {
        try { await mkdir(folder, { mode: 0o700 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; await privateDir(folder); }
      }
      const now = new Date().toISOString(), revision = expectedRevision + 1;
      let value = { schema: SCHEMA, id, revision, createdAt: previous?.createdAt ?? now,
        updatedAt: now, inputDigest: inputDigest(draft), input: draft, exports: previous?.exports ?? [],
        deployments: previous?.deployments ?? [], previews: previous?.previews ?? [] };
      if (exportRecord) value.exports = [...value.exports, exportRecord];
      if (deploymentRecord) {
        const prior = value.deployments.find(item => item.id === deploymentRecord.id);
        if (deploymentRecord.generation !== (prior?.generation ?? 0) + 1 ||
            !value.exports.some(item => item.id === deploymentRecord.exportId) ||
            prior && (prior.exportId !== deploymentRecord.exportId || prior.directory !== deploymentRecord.directory))
          fail('Deployment does not continue this project\'s retained package.', 409);
        value.deployments = [...value.deployments.filter(item => item.id !== deploymentRecord.id), deploymentRecord];
      }
      if (previewRecord) {
        if (previewRecord.project !== id || previewRecord.state !== 'COMPLETED')
          fail('The completed preview belongs to another project.', 409);
        const prior = value.previews.find(item => item.id === previewRecord.id);
        if (prior && json(prior) !== json(previewRecord)) fail('The retained preview changed.', 409);
        if (!prior) value.previews = [...value.previews, previewRecord];
      }
      const path = join(folder, revision + '.json');
      // A process crash after a version write leaves an unreferenced immutable file.
      // Its exact bytes may be adopted; divergent content is never overwritten.
      try { await createPrivate(path, json(value)); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const orphan = validateVersion(await regular(path), id);
        if (orphan.revision !== revision || json(draftInput(orphan.input)) !== json(draft) ||
            json(orphan.exports) !== json(value.exports) || json(orphan.deployments ?? []) !== json(value.deployments) ||
            json(orphan.previews ?? []) !== json(value.previews))
          fail('An interrupted save retained a different next revision; save this draft as a new project.', 409);
        value = orphan;
      }
      await replacePrivate(join(folder, 'head.json'), { id, revision, inputDigest: value.inputDigest });
      return { ...value, currentRevision: revision };
    });
  }
  async function close() {
    if (closed) return;
    closed = true;
    // Keep the lock inode: unlinking it would let another opener lock a
    // different inode while an existing writer still owns the previous one.
    await writer.close();
  }
  return { root, packages, deployments, releaseStores, previews, read, list, history, save, close };
}
