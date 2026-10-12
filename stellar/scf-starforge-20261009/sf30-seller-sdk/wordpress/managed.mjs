// MIT. Read-only launch bindings over the original WordPress workspace and source.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { privateDirectory, readJson } from '../postgres/publisher/files.mjs';
import { fail, UUID, identity, sha256 } from './config.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.wordpress-workspace.v1';
export const WORDPRESS_STARTUP_SCHEMA = 'stellar-forge.wordpress-workspace-startup.v1';
export const WORDPRESS_SOURCE_FILES = Object.freeze([
  '__init__.py', 'application-provider.mjs', 'capture.mjs', 'cli.mjs', 'config.mjs',
  'edition.mjs', 'files.mjs', 'managed.mjs', 'packet.mjs', 'packet.py',
  'public/app.mjs', 'public/index.html', 'public/style.css', 'server.mjs',
  'source_files.py', 'transport.mjs', 'workspace.mjs',
]);
const HASH = /^[a-f0-9]{64}$/;
function absolute(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) ||
      resolve(directory) !== directory || directory === '/')
    fail('WORDPRESS_WORKSPACE_DIRECTORY', 'Use a normalized absolute original directory.');
  return directory;
}
export async function readWordPressWorkspaceState(directory) {
  const value = await readJson(join(absolute(directory), 'workspace.json'), 16777216);
  if (value.schema !== WORKSPACE_SCHEMA || !UUID.test(value.id) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      ['sources', 'mappings', 'editions', 'exports', 'merchants', 'products', 'operations', 'packets']
        .some(key => !Array.isArray(value[key])))
    fail('WORDPRESS_WORKSPACE_STATE', 'The saved source workspace is invalid.', 409);
  return value;
}
export async function inspectWordPressWorkspaceBinding(directory, {
  expectedWorkspaceId, expectedWorkspaceIdentity,
} = {}) {
  absolute(directory);
  if (await realpath(directory) !== directory)
    fail('WORDPRESS_WORKSPACE_DIRECTORY', 'Select the original directory without symbolic-link aliases.');
  await privateDirectory(directory);
  const value = await readWordPressWorkspaceState(directory);
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)))
    fail('WORDPRESS_WORKSPACE_STATE', 'The original workspace creation identity is invalid.', 409);
  const binding = {
    schema: 'stellar-forge.wordpress-workspace-binding.v1', directory,
    workspaceId: value.id, createdAt: value.createdAt,
    sha256: identity({ schema: WORKSPACE_SCHEMA, id: value.id, createdAt: value.createdAt }),
  };
  if (expectedWorkspaceId !== undefined &&
      (!UUID.test(expectedWorkspaceId) || binding.workspaceId !== expectedWorkspaceId) ||
      expectedWorkspaceIdentity !== undefined &&
      (!HASH.test(expectedWorkspaceIdentity) || binding.sha256 !== expectedWorkspaceIdentity))
    fail('WORDPRESS_WORKSPACE_BINDING_CHANGED', 'Review the selected original workspace again before starting it.', 409);
  return binding;
}
export async function inspectWordPressLaunchSource(directory, { expectedSha256 } = {}) {
  absolute(directory);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory)
    fail('WORDPRESS_MANAGED_SOURCE', 'Select the actual installed WordPress source directory.');
  const files = [];
  for (const name of WORDPRESS_SOURCE_FILES) {
    const path = join(directory, name);
    if (await realpath(path) !== path)
      fail('WORDPRESS_MANAGED_SOURCE', 'The reviewed source must contain original regular files.');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 2097152)
        fail('WORDPRESS_MANAGED_SOURCE', 'The reviewed WordPress source file is invalid.');
      const bytes = await handle.readFile(), after = await handle.stat();
      if (bytes.length !== before.size || after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        fail('WORDPRESS_MANAGED_SOURCE_CHANGED', 'The original source changed while it was being reviewed.', 409);
      files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    } finally { await handle.close(); }
  }
  const result = {
    schema: 'stellar-forge.wordpress-launch-source.v1', directory, files,
    sha256: identity({ schema: 'stellar-forge.wordpress-launch-source.v1', files }),
  };
  if (expectedSha256 !== undefined && (!HASH.test(expectedSha256) || result.sha256 !== expectedSha256))
    fail('WORDPRESS_MANAGED_SOURCE_CHANGED', 'The current WordPress code differs from the reviewed source.', 409);
  return result;
}
