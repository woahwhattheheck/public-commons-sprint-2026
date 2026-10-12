// MIT. Read the immutable declaration for the original Datasette managed application.
import { open, realpath, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const DATASETTE_BINDING_SCHEMA = 'stellar-forge.datasette-workspace-binding.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = raw => createHash('sha256').update(raw).digest('hex');
const fault = (code, message) => Object.assign(new Error(message), {code, status: 409});
async function originalFile(path, maximum = 16384) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum ||
        process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 ||
          process.getuid && stat.uid !== process.getuid()))
      throw fault('DATASETTE_APPLICATION_FILE_INVALID', 'Select the private original workspace declaration.');
    const raw = await handle.readFile();
    if (raw.length > maximum) throw fault('DATASETTE_APPLICATION_FILE_INVALID', 'The workspace declaration exceeds its supported size.');
    return {raw, value: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw))};
  } finally {await handle.close();}
}

/** Capture configuration identity without opening another publisher or freezing operational data. */
export async function inspectDatasetteBinding({directory} = {}) {
  if (typeof directory !== 'string' || !directory || directory !== resolve(directory))
    throw fault('DATASETTE_APPLICATION_DIRECTORY_REQUIRED', 'Select the absolute original Datasette workspace directory.');
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory ||
      process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 ||
        process.getuid && stat.uid !== process.getuid()))
    throw fault('DATASETTE_APPLICATION_DIRECTORY_INVALID', 'Select the original private workspace directory.');
  const path = join(directory, 'workspace.json'), {raw, value} = await originalFile(path);
  if (value?.schema !== 'stellar-forge.datasette-workspace.v1' || !UUID.test(value.workspaceId ?? ''))
    throw fault('DATASETTE_APPLICATION_WORKSPACE_INVALID', 'Use the workspace created by the Datasette command.');
  const binding = {schema: DATASETTE_BINDING_SCHEMA, directory, workspaceId: value.workspaceId,
    workspaceFile: {path, sha256: hash(raw), bytes: raw.length},
    publisherDirectory: join(directory, 'publisher'), targetDirectory: join(directory, 'dataset')};
  return Object.freeze({...binding, bindingSha256: hash(JSON.stringify(binding))});
}

export async function readDatasetteAnnouncement(file, expected) {
  if (typeof file !== 'string' || file !== resolve(file))
    throw fault('DATASETTE_APPLICATION_CONNECTION_INVALID', 'Select the original absolute connection file.');
  const {value} = await originalFile(file);
  for (const key of ['schema','directory','workspaceId','instanceId','url','pid'])
    if (value[key] !== expected[key])
      throw fault('DATASETTE_APPLICATION_CONNECTION_CHANGED', 'The saved connection differs from the original server announcement.');
  return value;
}
