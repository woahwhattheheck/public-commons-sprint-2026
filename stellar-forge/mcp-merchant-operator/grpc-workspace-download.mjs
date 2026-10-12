// MIT. Resume exact original gRPC exports and restore the usable native customer layout.
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRetainedDownload } from './retained-download.mjs';
import { GRPC_EXPORT_MANIFEST, GRPC_EXPORT_MAX_BYTES, grpcHash, parseGrpcExportManifest } from './grpc-workspace-export.mjs';

const transport = createRetainedDownload({
  manifestName: GRPC_EXPORT_MANIFEST, parseManifest: parseGrpcExportManifest, maximumBytes: GRPC_EXPORT_MAX_BYTES,
  stateSchema: 'stellar-forge.grpc-workspace-download.v1', resultSchema: 'stellar-forge.grpc-workspace-received.v1',
  toolPrefix: 'merchant_grpc_export', errorPrefix: 'GRPC_EXPORT', clientName: 'starforge-grpc-workspace-receiver',
  describe: manifest => ({ workspace: manifest.workspace, kind: manifest.kind, original: manifest.original }),
});
const failure = (code, message) => Object.assign(new Error(message), { code: 'GRPC_EXPORT_DOWNLOAD_' + code });
async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && info.mode & 0o077)
    throw failure('PRIVATE_FILE_REQUIRED', 'The original receiving directory must be a private real directory.');
  return path;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function requireEntries(path, allowed) {
  if ((await readdir(path)).some(name => !allowed.has(name)))
    throw failure('DIRECTORY_IN_USE', 'Use this export’s existing receiving directory or a new empty private directory.');
}
async function materialize(root, transfer, exportId) {
  const bytes = await transport.bytesAt(join(transfer, GRPC_EXPORT_MANIFEST), 65000);
  const manifest = parseGrpcExportManifest(bytes, exportId);
  await requireEntries(root, new Set(['transfer', GRPC_EXPORT_MANIFEST, ...manifest.files.map(file => file.path.split('/')[0])]));
  let client;
  if (manifest.kind === 'customer') {
    client = await privateDirectory(join(root, 'client'));
    await requireEntries(client, new Set(manifest.files.filter(file => file.path.startsWith('client/')).map(file => file.path.slice(7))));
  }
  const files = [...manifest.files, { name: GRPC_EXPORT_MANIFEST, path: GRPC_EXPORT_MANIFEST, bytes: bytes.length, sha256: grpcHash(bytes) }];
  for (const file of files) {
    const source = join(transfer, file.name), destination = join(root, file.path);
    await transport.verifiedFile(source, file);
    await link(source, destination).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      await transport.verifiedFile(destination, file);
    });
  }
  if (client) await syncDirectory(client);
  await syncDirectory(root);
  return { nativeFiles: manifest.files.map(file => file.path), ...(client ? { customerDirectory: client } : {}) };
}
/** The original transport owns only transfer/; native customer paths never enter its checkpoint root. */
export async function downloadGrpcExport(options) {
  if (typeof options?.directory !== 'string' || !options.directory || options.directory.includes('\0'))
    throw failure('CONFIGURATION', 'Choose a private receiving directory.');
  const root = await privateDirectory(resolve(options.directory));
  await requireEntries(root, new Set(['transfer', GRPC_EXPORT_MANIFEST, 'methods.json', 'openapi.json', 'client',
    'grpc-revision.json', 'grpc-attempt.json', 'grpc-result.json', 'grpc-stream.ndjson', 'grpc-health.json',
    'grpc-upgrade-review.json', 'grpc-upgrade-base.json', 'grpc-upgrade-candidate.json', 'grpc-upgrade-plan.json',
    'grpc-operations.json', 'calls.csv', 'health.csv', 'actions.csv', 'report.html']));
  const result = await transport.download({ ...options, directory: join(root, 'transfer') });
  return { ...result, directory: root, transferDirectory: result.directory, ...await materialize(root, result.directory, result.exportId) };
}
export const inspectGrpcExport = options => transport.inspect(options);
