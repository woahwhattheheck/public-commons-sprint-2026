// MIT. Resume exact original gRPC exports and restore the usable native customer layout.
import { constants } from 'node:fs';
import { open, lstat, mkdir, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRetainedDownload } from './retained-download.mjs';
import { GRPC_EXPORT_MANIFEST, GRPC_EXPORT_MAX_BYTES, parseGrpcExportManifest } from './grpc-workspace-export.mjs';

const transport = createRetainedDownload({
  manifestName: GRPC_EXPORT_MANIFEST, parseManifest: parseGrpcExportManifest, maximumBytes: GRPC_EXPORT_MAX_BYTES,
  stateSchema: 'stellar-forge.grpc-workspace-download.v1', resultSchema: 'stellar-forge.grpc-workspace-received.v1',
  toolPrefix: 'merchant_grpc_export', errorPrefix: 'GRPC_EXPORT', clientName: 'starforge-grpc-workspace-receiver',
  describe: manifest => ({ workspace: manifest.workspace, kind: manifest.kind, original: manifest.original }),
});
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function materialize(directory, exportId) {
  const root = resolve(directory), bytes = await transport.bytesAt(join(root, GRPC_EXPORT_MANIFEST), 65000);
  const manifest = parseGrpcExportManifest(bytes, exportId);
  if (manifest.kind !== 'customer') return { nativeFiles: manifest.files.map(file => file.path) };
  const client = join(root, 'client');
  await mkdir(client, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(client);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && info.mode & 0o077)
    throw Object.assign(new Error('The native client directory must be a private directory owned by this receiving operation.'), { code: 'GRPC_EXPORT_DOWNLOAD_PRIVATE_FILE_REQUIRED' });
  for (const file of manifest.files) {
    await transport.verifiedFile(join(root, file.name), file);
    if (file.name === file.path) continue;
    const destination = join(root, file.path);
    await link(join(root, file.name), destination).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      await transport.verifiedFile(destination, file);
    });
  }
  await syncDirectory(client); await syncDirectory(root);
  return { nativeFiles: manifest.files.map(file => file.path), customerDirectory: client };
}
/** Rerunning the same directory reuses the original checkpoint and verifies completed files. */
export async function downloadGrpcExport(options) {
  const result = await transport.download(options);
  return { ...result, ...await materialize(result.directory, result.exportId) };
}
export const inspectGrpcExport = options => transport.inspect(options);
