// MIT. Read-only launch bindings over the original WebDAV workspace and source.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { privateDirectory, readJson } from '../postgres/publisher/files.mjs';
import { fail, ID, identity, sha256 } from './config.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.webdav-workspace.v1';
export const WEBDAV_STARTUP_SCHEMA = 'stellar-forge.webdav-startup.v1';
export const WEBDAV_SOURCE_FILES = Object.freeze([
  'capture.mjs', 'cli.mjs', 'config.mjs', 'http.mjs', 'managed.mjs',
  'multistatus.py', 'packet.mjs', 'packet.py', 'public/app.mjs',
  'public/index.html', 'public/style.css', 'server.mjs', 'source.mjs', 'workspace.mjs',
]);
const HASH = /^[a-f0-9]{64}$/;
function absolute(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) ||
      resolve(directory) !== directory || directory === '/')
    fail('WEBDAV_WORKSPACE_DIRECTORY', 'Use a normalized absolute original directory.');
  return directory;
}
export async function readWebDavWorkspaceState(directory) {
  const value = await readJson(join(absolute(directory), 'workspace.json'), 16777216);
  if (value.schema !== WORKSPACE_SCHEMA || !ID.test(value.id) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      ['sources', 'mappings', 'editions', 'exports', 'merchants', 'products', 'operations']
        .some(key => !Array.isArray(value[key])))
    fail('WEBDAV_WORKSPACE_STATE', 'The saved source workspace is invalid.', 409);
  return value;
}
export async function inspectWebDavWorkspaceBinding(directory, {
  expectedWorkspaceId, expectedWorkspaceIdentity,
} = {}) {
  absolute(directory);
  if (await realpath(directory) !== directory)
    fail('WEBDAV_WORKSPACE_DIRECTORY', 'Select the original directory without symbolic-link aliases.');
  await privateDirectory(directory);
  const value = await readWebDavWorkspaceState(directory);
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)))
    fail('WEBDAV_WORKSPACE_STATE', 'The original workspace creation identity is invalid.', 409);
  const binding = {
    schema: 'stellar-forge.webdav-workspace-binding.v1', directory,
    workspaceId: value.id, createdAt: value.createdAt,
    sha256: identity({ schema: WORKSPACE_SCHEMA, id: value.id, createdAt: value.createdAt }),
  };
  if (expectedWorkspaceId !== undefined &&
      (!ID.test(expectedWorkspaceId) || binding.workspaceId !== expectedWorkspaceId) ||
      expectedWorkspaceIdentity !== undefined &&
      (!HASH.test(expectedWorkspaceIdentity) || binding.sha256 !== expectedWorkspaceIdentity))
    fail('WEBDAV_WORKSPACE_BINDING_CHANGED', 'Review the selected original workspace again before starting it.', 409);
  return binding;
}
export async function inspectWebDavLaunchSource(directory, { expectedSha256 } = {}) {
  absolute(directory);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory)
    fail('WEBDAV_MANAGED_SOURCE', 'Select the actual installed WebDAV source directory.');
  const files = [];
  for (const name of WEBDAV_SOURCE_FILES) {
    const path = join(directory, name);
    if (await realpath(path) !== path)
      fail('WEBDAV_MANAGED_SOURCE', 'The reviewed source must contain original regular files.');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 2097152)
        fail('WEBDAV_MANAGED_SOURCE', 'The reviewed WebDAV source file is invalid.');
      const bytes = await handle.readFile(), after = await handle.stat();
      if (bytes.length !== before.size || after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        fail('WEBDAV_MANAGED_SOURCE_CHANGED', 'The original source changed while it was being reviewed.', 409);
      files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    } finally { await handle.close(); }
  }
  const result = {
    schema: 'stellar-forge.webdav-launch-source.v1', directory, files,
    sha256: identity({ schema: 'stellar-forge.webdav-launch-source.v1', files }),
  };
  if (expectedSha256 !== undefined && (!HASH.test(expectedSha256) || result.sha256 !== expectedSha256))
    fail('WEBDAV_MANAGED_SOURCE_CHANGED', 'The current WebDAV code differs from the reviewed source.', 409);
  return result;
}
