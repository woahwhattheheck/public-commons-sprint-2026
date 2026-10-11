// MIT. Persistent project editions for the original API merchant workspace.
import { constants } from 'node:fs';
import { open, mkdir, lstat, readdir, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { privateParent } from '../workspace/model.mjs';

export const PROJECT_SCHEMA = 'stellar-forge.blockworks-migration-project.v1';
export const SOURCE_SCHEMA = 'stellar-forge.blockworks-migration-source.v1';
const MAX_SOURCE = 8 * 1024 * 1024;
const MAX_RECORD = 4 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  throw new TypeError('Project values must be finite JSON values.');
}
const clone = value => JSON.parse(canonical(value));
function identifier(value, label = 'Project ID') {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(label + ' must use 1–80 lowercase letters, digits, underscores or hyphens.');
  return value;
}
function shortText(value, label, limit = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw new TypeError(label + ' is required and must be at most ' + limit + ' characters.');
  return value.trim();
}
function conflict(message) { const e = new Error(message); e.status = 409; return e; }
async function privateDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077)))
    throw new TypeError('Use a private directory without symbolic links: ' + path);
  return path;
}
async function readBytes(path, maximum = MAX_RECORD) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new TypeError('Project file is not a supported regular file.');
    return await file.readFile();
  } finally { await file.close(); }
}
async function json(path, maximum) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(path, maximum)));
}
async function sync(path) { const fd = await open(path, constants.O_RDONLY); try { await fd.sync(); } finally { await fd.close(); } }
// Publish complete bytes exclusively. A crash cannot leave a partial edition.
async function publish(directory, name, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const temporary = join(directory, '.write-' + randomUUID());
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
  try { await link(temporary, join(directory, name)); await sync(directory); }
  finally { await unlink(temporary).catch(() => {}); }
}
const recordBytes = value => Buffer.from(canonical(value) + '\n');
const editionName = sequence => String(sequence).padStart(10, '0') + '.json';

/** One store below the merchant workspace's original private output parent. */
export async function openMigrationProjects({ parent }) {
  const merchantParent = await privateParent(parent);
  const directory = await privateDirectory(join(merchantParent, 'migrations'));
  const projectDirectory = id => join(directory, identifier(id));
  async function sourceDirectory(id) { return privateDirectory(join(await privateDirectory(projectDirectory(id)), 'sources')); }
  async function history(id) {
    const root = projectDirectory(id);
    const project = await json(join(root, 'project.json'));
    if (project.schema !== PROJECT_SCHEMA || project.id !== id) throw new TypeError('Migration project identity changed.');
    const editions = join(root, 'editions');
    const names = (await readdir(editions)).filter(name => /^\d{10}\.json$/.test(name)).sort();
    if (!names.length || names.length > 10000) throw new TypeError('Migration edition history is missing or too large.');
    const result = []; let previous = null;
    for (const [index, name] of names.entries()) {
      if (name !== editionName(index + 1)) throw new TypeError('Migration edition history is not contiguous.');
      const bytes = await readBytes(join(editions, name)); const value = JSON.parse(bytes.toString('utf8'));
      if (value.schema !== PROJECT_SCHEMA || value.projectId !== id || value.sequence !== index + 1 || value.previous !== previous)
        throw new TypeError('Migration edition identity or predecessor changed.');
      const digest = sha256(bytes); result.push({ ...value, revision: digest }); previous = digest;
    }
    return { project, editions: result };
  }
  async function get(id) {
    const found = await history(identifier(id));
    return { ...found.project, ...found.editions.at(-1), directory: projectDirectory(id), editionCount: found.editions.length };
  }
  async function list() {
    const names = (await readdir(directory, { withFileTypes: true })).filter(e => e.isDirectory() && ID.test(e.name)).map(e => e.name).sort();
    const rows = [];
    for (const id of names) {
      try { const p = await get(id); rows.push({ id, title: p.title, customer: p.customer, sequence: p.sequence, revision: p.revision, createdAt: p.createdAt, updatedAt: p.at, state: p.state }); }
      catch (error) { rows.push({ id, error: error.message }); }
    }
    return rows;
  }
  async function create({ id, title, customer = '', actor }) {
    identifier(id); title = shortText(title, 'Project title', 180); actor = shortText(actor, 'Operator', 180);
    if (typeof customer !== 'string' || customer.length > 240) throw new TypeError('Customer must be at most 240 characters.');
    const root = projectDirectory(id);
    try { await mkdir(root, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') throw conflict('That migration project already exists. Reopen it.'); throw e; }
    await privateDirectory(join(root, 'editions')); await privateDirectory(join(root, 'sources'));
    const at = new Date().toISOString();
    const project = { schema: PROJECT_SCHEMA, id, title, customer, createdAt: at, createdBy: actor };
    await publish(root, 'project.json', recordBytes(project));
    await publish(join(root, 'editions'), editionName(1), recordBytes({ schema: PROJECT_SCHEMA, projectId: id, sequence: 1, previous: null,
      at, actor, action: 'Create migration', requestId: 'create-' + id, requestDigest: sha256(canonical(project)),
      state: { sources: [], currentSource: null, inventories: [], acquisitions: [], mappings: {}, mappingReviews: {}, comparisons: {},
        merchant: { baseline: null, sourceReview: null, package: null }, handovers: [] } }));
    return get(id);
  }
  async function commit({ id, expectedRevision, actor, action, requestId, state }) {
    identifier(id); actor = shortText(actor, 'Operator', 180); action = shortText(action, 'Action', 240); identifier(requestId, 'Action identity');
    if (!HASH.test(expectedRevision ?? '')) throw new TypeError('An observed project revision is required.');
    const nextState = clone(state);
    const digest = sha256(canonical({ expectedRevision, actor, action, state: nextState }));
    const found = await history(id);
    const priorAction = found.editions.find(row => row.requestId === requestId);
    if (priorAction) {
      if (priorAction.requestDigest !== digest) throw conflict('That action identity already names a different change.');
      return { ...found.project, ...priorAction, directory: projectDirectory(id), reused: true };
    }
    const current = found.editions.at(-1);
    if (current.revision !== expectedRevision) throw conflict('This migration changed in another view. Reload its current edition before applying your change.');
    const next = { schema: PROJECT_SCHEMA, projectId: id, sequence: current.sequence + 1, previous: current.revision,
      at: new Date().toISOString(), actor, action, requestId, requestDigest: digest, state: nextState };
    const bytes = recordBytes(next);
    if (bytes.length > MAX_RECORD) throw new TypeError('Migration edition exceeds 4 MiB. Retain large sources as source files.');
    try { await publish(join(projectDirectory(id), 'editions'), editionName(next.sequence), bytes); }
    catch (e) { if (e.code === 'EEXIST') throw conflict('Another operator saved an edition first. Reload this migration.'); throw e; }
    return { ...found.project, ...next, revision: sha256(bytes), directory: projectDirectory(id), editionCount: next.sequence };
  }
  async function retainSource(id, { kind, name, content, provenance = {} }) {
    await get(identifier(id));
    if (!['openapi', 'legacy-openapi', 'inventory', 'legacy-response', 'catalog', 'mapping', 'review', 'comparison'].includes(kind)) throw new TypeError('Unsupported source purpose.');
    name = shortText(name, 'Source filename', 240);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (!bytes.length || bytes.length > MAX_SOURCE) throw new TypeError('Source files must contain 1 byte through 8 MiB.');
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const sourceSha = sha256(bytes); const root = await sourceDirectory(id);
    const metadata = { schema: SOURCE_SCHEMA, kind, name, sha256: sourceSha, bytes: bytes.length, provenance: clone(provenance) };
    const ref = sha256(canonical(metadata));
    for (const [file, body] of [[sourceSha + '.raw', bytes], [ref + '.json', recordBytes(metadata)]]) {
      try { await publish(root, file, body); }
      catch (e) { if (e.code !== 'EEXIST') throw e; if (!(await readBytes(join(root, file), MAX_SOURCE)).equals(body)) throw new TypeError('A retained source file changed.'); }
    }
    return { ref, ...metadata };
  }
  async function readSource(id, ref) {
    identifier(id); if (!HASH.test(ref ?? '')) throw new TypeError('A retained source identity is required.');
    const root = join(projectDirectory(id), 'sources'); const metadata = await json(join(root, ref + '.json'));
    if (metadata.schema !== SOURCE_SCHEMA || sha256(canonical(metadata)) !== ref || !HASH.test(metadata.sha256)) throw new TypeError('Source metadata changed.');
    const body = await readBytes(join(root, metadata.sha256 + '.raw'), MAX_SOURCE);
    if (body.length !== metadata.bytes || sha256(body) !== metadata.sha256) throw new TypeError('Retained source bytes changed.');
    return { ref, metadata, body, file: join(root, metadata.sha256 + '.raw') };
  }
  async function readJson(id, ref) { const source = await readSource(id, ref); return { ...source, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.body)) }; }
  return { directory, merchantParent, projectDirectory, list, get, create, history, commit, retainSource, readSource, readJson };
}
