// MIT. Install an unchanged trusted handler inside a relocated original SF82 store.
import { join, posix, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { absolute, object, readJson, readPrivate, digest, bytes, identity,
  atomicJson, createFile, privateDirectory, syncDirectory, fault } from '../sf30-seller-sdk/postgres/publisher/files.mjs';

export const RELEASE_INSTALLATION_SCHEMA = 'stellar-forge.seller-release-installation.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export function installedReleaseMember(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(value) || posix.isAbsolute(value) || posix.normalize(value) !== value ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    throw fault('RELEASE_INSTALLATION_PATH_INVALID');
  return value;
}
async function installedFile(root, member, maximum) {
  absolute(root); installedReleaseMember(member); await privateDirectory(root);
  const file = join(root, member);
  let parent = root;
  for (const name of member.split('/').slice(0, -1)) {
    parent = join(parent, name); await privateDirectory(parent);
  }
  if (await realpath(file) !== file) throw fault('RELEASE_INSTALLATION_PATH_INVALID');
  const raw = await readPrivate(file, maximum);
  return { file, raw, bytes: raw.length, sha256: digest(raw) };
}
function originalHandler(record) {
  const value = record?.handlerEntry;
  if (!ID.test(record?.id ?? '') || !HASH.test(record?.digest ?? '') ||
      !object(value) || typeof value.path !== 'string' || !HASH.test(value.sha256 ?? '') ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > 4194304 ||
      value.scope !== 'ENTRY_MODULE_ONLY' || record.runtime?.handlers !== value.path)
    throw fault('RELEASE_INSTALLATION_SOURCE_INVALID');
  return { path: value.path, sha256: value.sha256, bytes: value.bytes, scope: value.scope };
}
function checkBinding(record, binding) {
  const original = originalHandler(record);
  if (!object(binding) || binding.schema !== RELEASE_INSTALLATION_SCHEMA ||
      binding.releaseId !== record.id || binding.releaseDigest !== record.digest ||
      identity(binding.originalHandler) !== identity(original) || !object(binding.installedHandler) ||
      binding.installedHandler.sha256 !== original.sha256 || binding.installedHandler.bytes !== original.bytes ||
      !object(binding.source) || typeof binding.source.schema !== 'string' ||
      !HASH.test(binding.source.manifestSha256 ?? ''))
    throw fault('RELEASE_INSTALLATION_BINDING_CHANGED');
  installedReleaseMember(binding.installedHandler.file); installedReleaseMember(binding.source.manifestFile);
  return original;
}
/** Resolve an explicit installation; saved record/runtime/digest remain provenance. */
export async function resolveReleaseInstallation(root, record, { directory = join(root, 'releases', record.id) } = {}) {
  root = absolute(resolve(root));
  let installation;
  try { installation = await readJson(join(directory, 'installation.json'), 32768); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const original = checkBinding(record, installation);
  const selected = await installedFile(root, installation.installedHandler.file, original.bytes);
  if (selected.bytes !== original.bytes || selected.sha256 !== original.sha256)
    throw fault('RELEASE_INSTALLED_HANDLER_CHANGED');
  const manifest = await installedFile(root, installation.source.manifestFile, 4194304);
  if (manifest.sha256 !== installation.source.manifestSha256)
    throw fault('RELEASE_INSTALLED_MANIFEST_CHANGED');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest.raw)); }
  catch { throw fault('RELEASE_INSTALLED_MANIFEST_INVALID'); }
  if (value.schema !== installation.source.schema) throw fault('RELEASE_INSTALLED_MANIFEST_CHANGED');
  return { installation, runtime: { ...record.runtime, handlers: selected.file } };
}
/** The original release mutation owner calls this only after its source-specific
 * package inspector has checked every package member. No handler is imported. */
export async function writeReleaseInstallation(root, record, input, {
  directory = join(root, 'releases', record.id), replace = false,
} = {}) {
  root = absolute(resolve(root)); await privateDirectory(directory);
  const original = originalHandler(record);
  if (!object(input) || !HASH.test(input.expectedDigest ?? '') || input.expectedDigest !== record.digest ||
      !object(input.source) || !HASH.test(input.source.manifestSha256 ?? '') ||
      typeof input.source.schema !== 'string')
    throw fault('RELEASE_INSTALLATION_REVIEW_CHANGED');
  const selected = await installedFile(root, input.handler, original.bytes);
  if (selected.bytes !== original.bytes || selected.sha256 !== original.sha256)
    throw fault('RELEASE_INSTALLED_HANDLER_CHANGED');
  const manifest = await installedFile(root, input.source.manifestFile, 4194304);
  if (manifest.sha256 !== input.source.manifestSha256)
    throw fault('RELEASE_INSTALLED_MANIFEST_CHANGED');
  let decoded;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest.raw)); }
  catch { throw fault('RELEASE_INSTALLED_MANIFEST_INVALID'); }
  if (decoded.schema !== input.source.schema) throw fault('RELEASE_INSTALLED_MANIFEST_CHANGED');
  const recordValue = { schema: RELEASE_INSTALLATION_SCHEMA, releaseId: record.id,
    releaseDigest: record.digest, originalHandler: original,
    installedHandler: { file: input.handler, sha256: original.sha256, bytes: original.bytes },
    source: { schema: input.source.schema, manifestFile: input.source.manifestFile,
      manifestSha256: input.source.manifestSha256 } };
  let existing;
  try { existing = await readJson(join(directory, 'installation.json'), 32768); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    checkBinding(record, existing);
    if (identity(existing) !== identity(recordValue)) {
      if (!replace) throw fault('RELEASE_INSTALLATION_ALREADY_BOUND');
      await atomicJson(directory, 'installation.json', recordValue);
    }
  } else await createFile(join(directory, 'installation.json'), bytes(recordValue));
  await syncDirectory(directory);
  return resolveReleaseInstallation(root, record, { directory });
}
