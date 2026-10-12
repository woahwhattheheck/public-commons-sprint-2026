import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, link, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

export function digest(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(text).digest('hex');
}
export class CaseError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
const KEY = /^[a-z0-9][a-z0-9-]{0,95}$/;
const SHA = /^[a-f0-9]{64}$/;
const KINDS = new Set(['cases', 'operations', 'portfolio']);
function key(value) {
  if (typeof value !== 'string' || !KEY.test(value)) throw new CaseError('invalid_key', 'Invalid record identifier');
  return value;
}
async function syncDirectory(path) {
  const file = await open(path, 'r');
  try { await file.sync(); }
  finally { await file.close(); }
}
async function durableDirectory(path, stopAt = null) {
  path=resolve(path);stopAt=stopAt?resolve(stopAt):null;
  await mkdir(path,{recursive:true,mode:0o700});
  // The first retained scope can create several ancestors at once. Sync their
  // directory entries too; syncing the new leaf alone does not persist its name.
  let current=path;
  for (;;) {
    await syncDirectory(current);
    if(current===stopAt || dirname(current)===current)break;
    current=dirname(current);
  }
}
// Immutable objects are fully written and synced before their names become visible.
// A journal ordinal is published with link(), which atomically refuses replacement.
// Concurrent writers of the same case revision therefore have exactly one winner.
export class CaseStore {
  constructor(root, scope) {
    this.root = resolve(root, key(scope.id)); this.scope = structuredClone(scope);
    this.ready = this.initialize();
  }
  async initialize() {
    await durableDirectory(join(this.root, 'objects'));
    await durableDirectory(join(this.root, 'journals'), this.root);
    for(const kind of KINDS)await durableDirectory(join(this.root,'journals',kind),this.root);
    const scopeSha = await this.put(this.scope, true);
    try {
      await link(this.objectPath(scopeSha), join(this.root, 'scope.json'));
      await syncDirectory(this.root);
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const existing = JSON.parse(await readFile(join(this.root, 'scope.json'), 'utf8'));
    if (digest(existing) !== digest(this.scope))
      throw new CaseError('scope_changed', 'The retained directory belongs to another source scope', 409);
  }
  objectPath(sha) {
    if (!SHA.test(sha)) throw new CaseError('invalid_hash', 'Invalid document hash');
    return join(this.root, 'objects', sha + '.json');
  }
  async put(value, initializing = false) {
    if (!initializing) await this.ready;
    const bytes = Buffer.from(JSON.stringify(value), 'utf8'), sha = digest(bytes.toString('utf8'));
    const destination = this.objectPath(sha);
    try {
      const existing = await readFile(destination);
      if (!existing.equals(bytes)) throw new CaseError('object_mismatch', 'Retained immutable document is inconsistent', 500);
      return sha;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = join(this.root, 'objects', '.write-' + randomUUID());
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync();
      await handle.close(); handle = undefined;
      try { await link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!(await readFile(destination)).equals(bytes))
          throw new CaseError('object_mismatch', 'Retained immutable document is inconsistent', 500);
      }
      await syncDirectory(join(this.root, 'objects'));
      return sha;
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async get(sha) {
    await this.ready;
    const bytes = await readFile(this.objectPath(sha), 'utf8');
    if (digest(bytes) !== sha) throw new CaseError('object_mismatch', 'Retained document checksum changed', 500);
    return JSON.parse(bytes);
  }
  journalPath(kind, id) {
    if (!KINDS.has(kind)) throw new CaseError('invalid_kind', 'Invalid journal kind');
    return join(this.root, 'journals', kind, key(id));
  }
  async versions(kind, id) {
    await this.ready;
    try {
      return (await readdir(this.journalPath(kind, id)))
        .filter(name => /^[0-9]{12}\.json$/.test(name)).sort();
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async readVersion(kind, id, version) {
    await this.ready;
    if (!Number.isSafeInteger(version) || version < 1 || version > 999999999999)
      throw new CaseError('invalid_revision', 'Invalid retained revision');
    const name = String(version).padStart(12, '0') + '.json';
    const bytes = await readFile(join(this.journalPath(kind, id), name), 'utf8');
    const entry = JSON.parse(bytes);
    const objectBytes = await readFile(this.objectPath(digest(bytes)), 'utf8');
    if (objectBytes !== bytes) throw new CaseError('journal_mismatch', 'Retained journal object changed', 500);
    if (entry.schema !== 'renewalguard-journal-v1' || entry.kind !== kind ||
        entry.id !== id || entry.version !== version || entry.scope_id !== this.scope.id)
      throw new CaseError('journal_mismatch', 'Retained journal identity changed', 500);
    return {version, sha:digest(bytes), entry, value:entry.value};
  }
  async head(kind, id) {
    const versions = await this.versions(kind, id);
    if (!versions.length) return null;
    return this.readVersion(kind, id, Number(versions.at(-1).slice(0, 12)));
  }
  async append(kind, id, {expectedVersion, expectedSha, operationId, value, at}) {
    await this.ready; key(operationId);
    const current = await this.head(kind, id), currentVersion = current?.version || 0;
    if (currentVersion !== expectedVersion || (current?.sha || null) !== expectedSha)
      throw new CaseError('revision_changed', 'A newer revision is already saved. Reopen it before applying these changes.',
        409, {current_revision:currentVersion});
    const version = expectedVersion + 1;
    if (!Number.isSafeInteger(version) || version > 999999999999)
      throw new CaseError('revision_limit', 'Journal revision range is exhausted', 409);
    const entry = {
      schema:'renewalguard-journal-v1', scope_id:this.scope.id, kind, id, version,
      previous_sha:expectedSha, operation_id:operationId, at, value,
    };
    const sha = await this.put(entry), path = this.journalPath(kind, id);
    if (!current) await durableDirectory(path, this.root);
    try {
      await link(this.objectPath(sha), join(path, String(version).padStart(12, '0') + '.json'));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const winner = await this.readVersion(kind, id, version);
      if (winner.sha === sha) return winner;
      throw new CaseError('revision_changed', 'Another operator saved this revision first. Reopen the current record.',
        409, {current_revision:(await this.head(kind, id)).version});
    }
    await syncDirectory(path);
    return {version, sha, entry, value};
  }
  async findOperation(kind, id, operationId) {
    const names = await this.versions(kind, id);
    for (let i = names.length - 1; i >= 0; i--) {
      const value = await this.readVersion(kind, id, Number(names[i].slice(0,12)));
      if (value.entry.operation_id === operationId) return value;
    }
    return null;
  }
  async list(kind) {
    await this.ready;
    if (!KINDS.has(kind)) throw new CaseError('invalid_kind', 'Invalid journal kind');
    let names;
    try { names = await readdir(join(this.root, 'journals', kind), {withFileTypes:true}); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const name of names.filter(x => x.isDirectory() && KEY.test(x.name)).sort((a,b) => a.name.localeCompare(b.name))) {
      const record = await this.head(kind, name.name);
      if (record) result.push(record);
    }
    return result;
  }
}
