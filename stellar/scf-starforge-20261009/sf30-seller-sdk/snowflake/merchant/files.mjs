// MIT. Complete Snowflake deliveries backed by the original immutable native files.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, readdir } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicFile, atomicJson, boundedFile, canonical } from '../../../sf46-release/release-core.mjs';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { RetainedSourceFileReads } from '../../../../../stellar-forge/mcp-merchant-operator/retained-source-files.mjs';
import { validateSnowflakeReceivingManifest } from '../transfer.mjs';
import { snowflakeCloudDeliveryManifest } from '../cloud-delivery.mjs';

export const SNOWFLAKE_EXPORT_SCHEMA = 'stellar-forge.snowflake-agent-export.v1';
export const SNOWFLAKE_EXPORT_MANIFEST = 'snowflake-export.json';
export const SNOWFLAKE_MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
export const SNOWFLAKE_MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const ID = /^[a-z][a-z0-9-]{0,63}$/, SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const fail = (code, detail = code) => Object.assign(new Error(detail), { code: 'SNOWFLAKE_' + code });
export function alias(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw fail('ALIAS_INVALID', 'Use a configured lower-case workspace or export alias.');
  return value;
}
export function safeName(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\0-\x1f\x7f\\]/.test(value) ||
      value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw fail('EXPORT_FILENAME_INVALID');
  return value;
}
export async function privateDirectory(path) {
  path = resolve(path); await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || await realpath(path) !== path)
    throw fail('PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
/** Hash the opened native descriptor with fixed memory; the receiver owns its handle. */
export async function verifiedHandle(path, expected) {
  path = resolve(path);
  if (await realpath(path) !== path) throw fail('EXPORT_FILE_CHANGED', 'Use the original regular file without symlink components.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(SNOWFLAKE_MAX_FILE_BYTES) ||
        Number(before.mode) & 0o077 || expected && before.size !== BigInt(expected.bytes))
      throw fail('EXPORT_FILE_CHANGED');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
    while (offset < Number(before.size)) {
      const part = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      if (!part.bytesRead) throw fail('EXPORT_FILE_CHANGED');
      hash.update(buffer.subarray(0, part.bytesRead)); offset += part.bytesRead;
    }
    const digest = hash.digest('hex');
    if (stamp(before) !== stamp(await handle.stat({ bigint: true })) || expected && digest !== expected.sha256)
      throw fail('EXPORT_FILE_CHANGED', 'The retained native file differs from its original descriptor.');
    return { handle, bytes: offset, sha256: digest };
  } catch (error) { await handle.close(); throw error; }
}
export function parseSnowflakeExport(bytes, exportId) {
  alias(exportId);
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > SNOWFLAKE_MAX_MANIFEST_BYTES)
    throw fail('EXPORT_INVALID', 'Read the complete original export manifest.');
  const value = decode(bytes);
  if (value?.schema !== SNOWFLAKE_EXPORT_SCHEMA || value.exportId !== exportId || !ID.test(value.workspace ?? '') ||
      !UUID.test(value.workspaceId ?? '') || !SHA.test(value.selectionSha256 ?? '') ||
      !SHA.test(value.source?.editionId ?? '') || !Number.isFinite(Date.parse(value.createdAt)) ||
      !Array.isArray(value.files) || value.files.length < 3 || value.files.length > 40032)
    throw fail('EXPORT_INVALID');
  const names = new Set(); let total = 0;
  for (const file of value.files) {
    safeName(file.name);
    if (file.name === SNOWFLAKE_EXPORT_MANIFEST || names.has(file.name) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > SNOWFLAKE_MAX_FILE_BYTES ||
        !SHA.test(file.sha256 ?? '') || typeof file.contentType !== 'string' || file.contentType.length > 160 ||
        (total += file.bytes) > 32 * 1024 * 1024 * 1024) throw fail('EXPORT_INVALID');
    names.add(file.name);
  }
  if (!names.has('receiving.json') || !names.has('edition.json') || !names.has('README.md'))
    throw fail('EXPORT_INVALID', 'The complete native receiving files are required.');
  return value;
}
const mime = name => name.endsWith('.json') ? 'application/json' : name.endsWith('.md') ? 'text/markdown' :
  name.endsWith('.sqlite') ? 'application/vnd.sqlite3' : 'application/octet-stream';
const manifestFile = bytes => ({ name: SNOWFLAKE_EXPORT_MANIFEST, bytes: bytes.length, sha256: sha256(bytes), contentType: 'application/json' });
async function immutable(path, bytes) {
  await privateDirectory(dirname(path));
  try { await atomicFile(path, bytes, 0o600, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const original = await boundedFile(dirname(path), path.slice(dirname(path).length + 1), bytes.length);
    if (!Buffer.from(original).equals(Buffer.from(bytes))) throw fail('EXPORT_CHANGED', 'The original retained metadata file differs.');
  }
}
export class SnowflakeRetainedExports {
  #root; #declared; #reads = new RetainedSourceFileReads({ errorPrefix: 'SNOWFLAKE' });
  constructor(exportsDirectory, declared) { this.#root = resolve(exportsDirectory, 'snowflake'); this.#declared = declared; }
  async retained(exportId) {
    const directory = join(this.#root, alias(exportId));
    const bytes = await boundedFile(directory, SNOWFLAKE_EXPORT_MANIFEST, SNOWFLAKE_MAX_MANIFEST_BYTES);
    const manifest = parseSnowflakeExport(bytes, exportId), manifestSha256 = sha256(bytes);
    const index = decode(await boundedFile(directory, 'native-files.json', SNOWFLAKE_MAX_MANIFEST_BYTES));
    if (index.schema !== 'stellar-forge.snowflake-native-files.v1' || index.exportId !== exportId ||
        index.workspace !== manifest.workspace || index.workspaceId !== manifest.workspaceId ||
        index.manifestSha256 !== manifestSha256 || index.selectionSha256 !== manifest.selectionSha256 ||
        !this.#declared[manifest.workspace] || this.#declared[manifest.workspace].workspaceId !== manifest.workspaceId)
      throw fail('EXPORT_CHANGED');
    return { directory, manifest, index, manifestSha256, manifestFile: manifestFile(bytes) };
  }
  async manifest(exportId) {
    const value = await this.retained(exportId);
    return { exportId, workspace: value.manifest.workspace, workspaceId: value.manifest.workspaceId,
      manifestSha256: value.manifestSha256, manifestFile: value.manifestFile,
      source: value.manifest.source, files: value.manifest.files.length,
      bytes: value.manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
  }
  async list({ workspace, offset = 0, limit = 50 } = {}) {
    if (workspace !== undefined) alias(workspace);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw fail('PAGE_INVALID');
    let entries;
    try { entries = await readdir(this.#root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return { items: [], nextOffset: null }; throw error; }
    const items = [];
    for (const entry of entries.filter(entry => entry.isDirectory() && ID.test(entry.name)).sort((a,b) => a.name.localeCompare(b.name))) {
      let item;
      try { item = await this.manifest(entry.name); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (workspace === undefined || item.workspace === workspace) items.push(item);
    }
    return { items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null, total: items.length };
  }
  async retain(workspace, native, { exportId, editionId, publicationId, cloudDelivery } = {}) {
    alias(workspace); alias(exportId);
    const state = await native.state(), selection = { workspace, workspaceId: state.id, editionId,
      publicationId: publicationId ?? null, cloudDelivery: cloudDelivery ?? null };
    const selectionSha256 = sha256(canonical(selection));
    try {
      const saved = await this.retained(exportId);
      if (saved.manifest.selectionSha256 !== selectionSha256) throw fail('EXPORT_ID_REUSED', 'Choose a new export ID for a different exact selection.');
      return this.manifest(exportId);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await privateDirectory(this.#root);
    const directory = await privateDirectory(join(this.#root, exportId));
    const lease = await acquireStateLease(directory);
    try {
      let pending;
      try { pending = decode(await boundedFile(directory, 'selection.json', SNOWFLAKE_MAX_MANIFEST_BYTES)); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const edition = native.store.edition(editionId), operation = native.store.operation(edition.operationId);
        const publication = publicationId ? native.store.getPublication(publicationId) : null;
        if (publicationId && (!publication || publication.editionId !== editionId || publication.status !== 'PREPARED'))
          throw fail('PUBLICATION_NOT_PREPARED', 'Select the prepared publication of this exact edition.');
        pending = { schema: 'stellar-forge.snowflake-export-selection.v1', selection, selectionSha256,
          createdAt: new Date().toISOString(), edition, operation,
          source: native.store.source(edition.sourceId).config, review: native.store.latestReview(editionId), publication };
        await atomicJson(join(directory, 'selection.json'), pending, { exclusive: true });
      }
      if (pending.schema !== 'stellar-forge.snowflake-export-selection.v1' || pending.selectionSha256 !== selectionSha256 ||
          sha256(canonical(pending.selection)) !== selectionSha256) throw fail('EXPORT_ID_REUSED');
      const { edition, operation } = pending;
      const partitions = edition.partitions.map(part => ({ path: 'partition-' + String(part.index).padStart(5, '0') + '.json',
        bytes: part.bytes, sha256: part.sha256, partition: part.index }));
      const receiving = { schema: 'stellar-forge.snowflake-receiving.v1',
        source: pending.source, sourceId: edition.sourceId, queryName: edition.queryName,
        arguments: operation.arguments, requestId: operation.requestId, origin: operation.origin, body: operation.body,
        statementHandle: edition.statementHandle, editionId, complete: true, capturedAt: edition.createdAt, partitions };
      validateSnowflakeReceivingManifest(receiving);
      const metadata = {
        'receiving.json': encode(receiving), 'edition.json': encode(edition), 'review.json': encode(pending.review),
        'README.md': Buffer.from('# Snowflake retained delivery\n\nReceive receiving.json and every named original partition through the Snowflake workspace. Original strings, exact decimal values, large integers and JSON nulls stay in the same immutable edition. snowflake-export.json identifies every delivered byte. The merchant/ files and snapshot, when selected, belong to the saved original publication. Continue an interrupted download in the same directory; use merchant-snowflake reopen for complete offline verification.\n')
      };
      if (cloudDelivery) metadata['cloud-delivery.json'] = encode(snowflakeCloudDeliveryManifest(edition, operation, partitions, cloudDelivery));
      if (pending.publication) {
        const publication = pending.publication;
        metadata['publication.json'] = encode({ id: publication.id, editionId: publication.editionId,
          createdAt: publication.createdAt, status: publication.status, request: publication.request,
          requestSha256: publication.requestSha256, releaseId: publication.releaseId, dataset: publication.dataset });
      }
      const descriptors = [], sources = Object.create(null);
      for (const [name, bytes] of Object.entries(metadata)) {
        lease.assertHeld(); await immutable(join(directory, 'files', name), bytes);
        descriptors.push({ name, bytes: bytes.length, sha256: sha256(bytes), contentType: mime(name) });
        sources[name] = { kind: 'retained', path: name };
      }
      const addNative = async (name, path, kind, expected) => {
        lease.assertHeld(); safeName(name);
        const checked = await verifiedHandle(path, expected);
        try { descriptors.push({ name, bytes: checked.bytes, sha256: checked.sha256, contentType: mime(name) }); }
        finally { await checked.handle.close(); }
        const sourcePath = relative(native.directory, path); safeName(sourcePath);
        sources[name] = { kind, path: sourcePath };
      };
      for (const part of partitions)
        await addNative(part.path, join(native.directory, 'objects', part.sha256), 'object', part);
      if (pending.publication) {
        const publication = pending.publication, merchantDirectory = resolve(publication.directory);
        const base = relative(native.directory, merchantDirectory); safeName(base);
        if (!base.startsWith('merchant/' + publication.id + '/')) throw fail('PUBLICATION_DIRECTORY_CHANGED');
        let count = 0;
        async function visit(path, prefix = '') {
          for (const entry of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
            const selected = prefix ? prefix + '/' + entry.name : entry.name; safeName(selected);
            if (entry.isDirectory()) await visit(join(path, entry.name), selected);
            else if (entry.isFile()) {
              if (++count > 10000) throw fail('EXPORT_TOO_MANY_FILES');
              await addNative('merchant/' + selected, join(path, entry.name), 'merchant');
            } else throw fail('EXPORT_FILE_CHANGED', 'The original merchant package contains a nonregular member.');
          }
        }
        await visit(merchantDirectory);
        await addNative('native-snapshot.sqlite',
          join(publication.releaseRoot, 'releases', publication.releaseId, 'sqlite', 'snapshot.sqlite'), 'snapshot');
      }
      const manifest = { schema: SNOWFLAKE_EXPORT_SCHEMA, exportId, workspace, workspaceId: state.id,
        createdAt: pending.createdAt, selectionSha256, source: { editionId, sourceId: edition.sourceId,
          queryName: edition.queryName, statementHandle: edition.statementHandle, rowCount: edition.rowCount,
          partitionCount: edition.partitionCount, publicationId: publicationId ?? null },
        files: descriptors.sort((a,b) => a.name.localeCompare(b.name)) };
      const manifestBytes = encode(manifest); parseSnowflakeExport(manifestBytes, exportId);
      await atomicJson(join(directory, 'native-files.json'), { schema: 'stellar-forge.snowflake-native-files.v1',
        exportId, workspace, workspaceId: state.id, selectionSha256, manifestSha256: sha256(manifestBytes), sources });
      lease.assertHeld(); await immutable(join(directory, SNOWFLAKE_EXPORT_MANIFEST), manifestBytes);
      return this.manifest(exportId);
    } finally { await lease.close(); }
  }
  async file(args) {
    const retained = await this.retained(args.exportId);
    if (args.expectedManifestSha256 !== retained.manifestSha256) throw fail('EXPORT_CHANGED', 'Use the inspected complete-file manifest SHA256.');
    const descriptor = args.file === SNOWFLAKE_EXPORT_MANIFEST ? retained.manifestFile :
      retained.manifest.files.find(file => file.name === args.file);
    if (!descriptor) throw fail('FILE_NOT_FOUND', 'Choose a filename from this original export manifest.');
    const definition = this.#declared[retained.manifest.workspace];
    let path;
    if (args.file === SNOWFLAKE_EXPORT_MANIFEST) path = join(retained.directory, args.file);
    else {
      const selected = retained.index.sources[args.file];
      if (!selected) throw fail('EXPORT_CHANGED');
      safeName(selected.path);
      if (selected.kind === 'retained') {
        if (selected.path !== args.file) throw fail('EXPORT_CHANGED');
        path = join(retained.directory, 'files', selected.path);
      } else {
        const publicationId = retained.manifest.source.publicationId;
        const valid = selected.kind === 'object' && selected.path === 'objects/' + descriptor.sha256 ||
          selected.kind === 'merchant' && UUID.test(publicationId ?? '') && selected.path.startsWith('merchant/' + publicationId + '/') ||
          selected.kind === 'snapshot' && UUID.test(publicationId ?? '') &&
            selected.path === 'release-store/releases/snowflake-' + publicationId + '/sqlite/snapshot.sqlite';
        if (!valid) throw fail('EXPORT_CHANGED');
        path = join(definition.directory, selected.path);
      }
    }
    return { exportId: args.exportId, manifestSha256: retained.manifestSha256,
      ...await this.#reads.read({ scope: args.exportId, key: args.file + ':' + retained.manifestSha256,
        readId: args.readId, expectedSha256: args.expectedSha256, offset: args.offset, limit: args.limit,
        load: async () => {
          const checked = await verifiedHandle(path, descriptor);
          return { handle: checked.handle, filename: descriptor.name, contentType: descriptor.contentType,
            size: descriptor.bytes, sha256: descriptor.sha256 };
        } }) };
  }
  async release(exportId, readId) {
    await this.retained(exportId);
    return { exportId, readId, released: await this.#reads.release(exportId, readId) };
  }
  close() { return this.#reads.close(); }
}
