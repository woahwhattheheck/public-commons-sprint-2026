// MIT. Retained GraphQL files over the original shared MCP snapshot reader.
import { constants } from 'node:fs';
import { open, mkdir, realpath, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exact, failure, identifier, privateSupportDirectory, writePrivate } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { GRAPHQL_EXPORT_SCHEMA, GRAPHQL_EXPORT_MANIFEST, graphqlExportBytes, graphqlExportSha,
  readGraphqlFileManifest } from './graphql-export-manifest.mjs';

const ORIGINAL = '../../stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant/workspace/files.mjs';
const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuidSchema = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };
const shaSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const selectionKeys = ['workspace', 'exportId', 'project', 'revision', 'kind', 'merchantExportId', 'deploymentId', 'hostId', 'previewId'];
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function graphqlFileTools(tool) {
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_graphql_export_prepare', 'Retain one exact original project/file-set identity for transfer. Use a caller-chosen exportId and the native saved IDs. Keeps original files in place; the same intent/id reuses its immutable descriptor.',
      { workspace: aliasSchema, exportId: aliasSchema, project: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' },
        revision: { type: 'integer', minimum: 1 }, kind: { enum: ['draft', 'preview', 'merchant', 'evolution', 'deployment', 'host'] },
        merchantExportId: uuidSchema, deploymentId: uuidSchema, previewId: uuidSchema,
        hostId: { type: 'string', pattern: '^host-[1-9][0-9]*-[a-f0-9]{8}$' } },
      ['workspace', 'exportId', 'project', 'revision', 'kind'], { idempotent: true }),
    tool('merchant_graphql_export_manifest', 'Inspect the pinned transfer manifest of an already retained native GraphQL file set, including after its writer or MCP process has reopened.',
      { exportId: aliasSchema }, ['exportId'], read),
    tool('merchant_graphql_export_file', 'Read exact original source, response, merchant/buyer, evolution, deployment or host bytes using the same bounded retained snapshot reader. Select file names from the manifest; preserve its hash and returned readId when continuing.',
      { exportId: aliasSchema, file: { type: 'string', minLength: 1, maxLength: 4096 },
        expectedManifestSha256: shaSchema, expectedSha256: shaSchema, readId: uuidSchema,
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
      ['exportId', 'file', 'expectedManifestSha256'], read),
    tool('merchant_graphql_export_file_release', 'Release one original read snapshot early. Completed or already released read IDs are harmless to repeat.',
      { exportId: aliasSchema, readId: uuidSchema }, ['exportId', 'readId'], { idempotent: true }),
  ];
}

export class MerchantGraphqlFiles {
  #config; #reads = new RetainedFileReads({ errorPrefix: 'GRAPHQL' }); #root; #opening; #closing = false;
  constructor(config) { this.#config = config; }
  get summary() { return this.#reads.summary; }
  #workspace(alias) {
    identifier(alias, 'GraphQL workspace alias');
    const value = this.#config.graphqlWorkspaces?.workspaces[alias];
    if (!value) throw failure('GRAPHQL_WORKSPACE_NOT_CONFIGURED', 'Choose a host-declared original GraphQL workspace.');
    return value;
  }
  async #directory() {
    if (this.#root) return this.#root;
    if (!this.#opening) this.#opening = (async () => {
      await privateSupportDirectory(this.#config.exportsDirectory);
      const root = join(await realpath(this.#config.exportsDirectory), 'graphql-workspaces');
      try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await privateSupportDirectory(root);
      if (await realpath(root) !== root) throw failure('GRAPHQL_EXPORT_DIRECTORY', 'The native descriptor directory changed identity.');
      this.#root = root; return root;
    })();
    return this.#opening;
  }
  async #record(exportId) {
    identifier(exportId, 'Export ID');
    const file = await open(join(await this.#directory(), exportId + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 131072 || process.platform !== 'win32' && (stat.mode & 0o077))
        throw failure('GRAPHQL_EXPORT_CHANGED', 'The retained transfer descriptor must remain private and regular.');
      const bytes = await file.readFile();
      if (bytes.length !== stat.size) throw failure('GRAPHQL_EXPORT_CHANGED', 'The original transfer descriptor changed during this read.');
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw failure('GRAPHQL_EXPORT_CHANGED', 'The retained transfer descriptor is invalid.'); }
      if (value?.schema !== 'stellar-forge.graphql-mcp-export-record.v1' || !value.manifest || !sha(value.intentSha256))
        throw failure('GRAPHQL_EXPORT_CHANGED', 'The original transfer descriptor is incomplete.');
      const manifestBytes = graphqlExportBytes(value.manifest);
      readGraphqlFileManifest(manifestBytes, exportId);
      this.#workspace(value.manifest.workspace);
      const intent = { workspace: value.manifest.workspace, selection: value.manifest.selection };
      if (graphqlExportSha(graphqlExportBytes(intent)) !== value.intentSha256)
        throw failure('GRAPHQL_EXPORT_CHANGED', 'The retained original selection differs from its saved request.');
      return { ...value, manifestBytes, manifestSha256: graphqlExportSha(manifestBytes) };
    } finally { await file.close(); }
  }
  #view(record, reused = false) {
    return { state: 'MANIFEST_RETAINED', exportId: record.manifest.exportId, workspace: record.manifest.workspace,
      selection: record.manifest.selection, source: record.manifest.source, reused,
      files: record.manifest.files.length, bytes: record.manifest.files.reduce((sum, value) => sum + value.bytes, 0),
      manifestFile: { name: GRAPHQL_EXPORT_MANIFEST, bytes: record.manifestBytes.length,
        sha256: record.manifestSha256, contentType: 'application/json' } };
  }
  async #prepare(args) {
    exact(args, selectionKeys, ['workspace', 'exportId', 'project', 'revision', 'kind']);
    identifier(args.exportId, 'Export ID');
    const definition = this.#workspace(args.workspace), selection = { project: args.project, revision: args.revision, kind: args.kind };
    for (const [key, target] of [['merchantExportId', 'exportId'], ['deploymentId', 'deploymentId'], ['hostId', 'hostId'], ['previewId', 'previewId']])
      if (args[key] !== undefined) selection[target] = args[key];
    const intentSha256 = graphqlExportSha(graphqlExportBytes({ workspace: args.workspace, selection }));
    try {
      const old = await this.#record(args.exportId);
      if (old.intentSha256 !== intentSha256) throw failure('GRAPHQL_EXPORT_ID_CONFLICT', 'This exportId already belongs to another original selection.');
      return this.#view(old, true);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const { openWorkspaceFiles } = await import(ORIGINAL), native = await openWorkspaceFiles(definition.directory);
    const original = await native.manifest(selection);
    const manifest = { schema: GRAPHQL_EXPORT_SCHEMA, exportId: args.exportId, workspace: args.workspace,
      createdAt: new Date().toISOString(), selection: original.manifest.selection, source: original.manifest.source,
      nativeManifestSha256: original.manifestFile.sha256,
      files: [...original.manifest.files, original.manifestFile].sort((a, b) => a.name.localeCompare(b.name)) };
    readGraphqlFileManifest(graphqlExportBytes(manifest), args.exportId);
    const record = { schema: 'stellar-forge.graphql-mcp-export-record.v1', intentSha256, manifest };
    const root = await this.#directory(), temporary = join(root, '.' + args.exportId + '.' + randomUUID() + '.next');
    try {
      await writePrivate(temporary, record);
      try { await link(temporary, join(root, args.exportId + '.json')); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const directory = await open(root, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    const retained = await this.#record(args.exportId);
    if (retained.intentSha256 !== intentSha256)
      throw failure('GRAPHQL_EXPORT_ID_CONFLICT', 'Another request retained this exportId for a different original selection.');
    return this.#view(retained);
  }
  async call(name, args) {
    if (this.#closing) throw failure('GRAPHQL_CLOSING', 'Retained GraphQL file reads are closing.');
    if (name === 'merchant_graphql_export_prepare') return this.#prepare(args);
    if (name === 'merchant_graphql_export_manifest') {
      exact(args, ['exportId'], ['exportId']); return this.#view(await this.#record(args.exportId), true);
    }
    if (name === 'merchant_graphql_export_file_release') {
      exact(args, ['exportId', 'readId'], ['exportId', 'readId']); identifier(args.exportId, 'Export ID');
      if (!new RegExp(uuidSchema.pattern).test(args.readId ?? '')) throw failure('INVALID_PARAMS', 'Use an original read UUID.');
      await this.#reads.release(args.exportId, args.readId); return { exportId: args.exportId, readId: args.readId, state: 'RELEASED' };
    }
    if (name !== 'merchant_graphql_export_file') throw failure('TOOL_NOT_FOUND', 'Unknown original GraphQL retained-file operation.');
    exact(args, ['exportId', 'file', 'expectedManifestSha256', 'expectedSha256', 'readId', 'offset', 'limit'],
      ['exportId', 'file', 'expectedManifestSha256']);
    const record = await this.#record(args.exportId);
    if (args.expectedManifestSha256 !== record.manifestSha256)
      throw failure('GRAPHQL_EXPORT_CHANGED', 'The transfer manifest differs from the original reviewed identity.');
    const info = args.file === GRAPHQL_EXPORT_MANIFEST ? { name: GRAPHQL_EXPORT_MANIFEST,
      sha256: record.manifestSha256, bytes: record.manifestBytes.length }
      : record.manifest.files.find(item => item.name === args.file);
    if (!info) throw failure('GRAPHQL_FILE_NOT_FOUND', 'Choose an exact file name from the original transfer manifest.');
    if (args.expectedSha256 !== undefined && args.expectedSha256 !== info.sha256)
      throw failure('GRAPHQL_FILE_CHANGED', 'The requested file differs from the retained transfer manifest.');
    const load = async () => {
      if (args.file === GRAPHQL_EXPORT_MANIFEST)
        return { name: GRAPHQL_EXPORT_MANIFEST, bytes: record.manifestBytes, type: 'application/json' };
      const { openWorkspaceFiles } = await import(ORIGINAL);
      const native = await openWorkspaceFiles(this.#workspace(record.manifest.workspace).directory);
      return native.read(record.manifest.selection, args.file, record.manifest.nativeManifestSha256);
    };
    const value = await this.#reads.read({ scope: args.exportId, key: args.file, kind: 'GRAPHQL_WORKSPACE_FILE',
      directory: await this.#directory(), load, expectedSha256: info.sha256, readId: args.readId,
      offset: args.offset ?? 0, limit: args.limit ?? 65536 });
    return { exportId: args.exportId, manifestSha256: record.manifestSha256, ...value };
  }
  close() { this.#closing = true; return this.#reads.close(); }
}
