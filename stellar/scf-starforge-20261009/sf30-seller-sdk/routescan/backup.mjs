// MIT. Portable snapshots of the original provider project; no buyer state.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openProject } from './project.mjs';
import { privateDirectory, withPrivateLock } from './quota.mjs';
import { fail, compileRoutescanMerchant } from './config.mjs';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('./backup-worker.py', import.meta.url));
async function invoke(args, python) {
  try {
    const result = await execute(python, [worker, ...args], {
      encoding: 'utf8', maxBuffer: 65536, timeout: 120000,
    });
    return JSON.parse(result.stdout);
  } catch (error) {
    let message = 'The workspace archive could not be completed.';
    try { message = JSON.parse(error.stderr).error || message; } catch {}
    fail(message, 409, 'ROUTESCAN_ARCHIVE_FAILED');
  }
}
export async function verifyProject(project) {
  const saved = await project.read();
  if (!saved) fail('The archive has no saved merchant configuration.');
  const [revisions, previews, exports] = await Promise.all([
    project.history(), project.listPreviews(), project.listExports(),
  ]);
  for (const row of revisions) {
    const original = await project.readRevision(row.revision);
    if (original.schema !== 'stellar-forge.routescan-project.v1' || original.revision !== row.revision ||
        compileRoutescanMerchant(original.input).inputSha256 !== original.inputSha256)
      fail('A retained configuration revision changed.', 409);
  }
  return { revision: saved.revision, inputSha256: saved.inputSha256,
    revisions: revisions.length, previews: previews.length, exports: exports.length };
}
export async function createRoutescanBackup(project, { output, python = 'python3' } = {}) {
  if (!output) fail('Choose a new backup output file.');
  if (project.quotaDirectory !== join(project.root, 'quota'))
    fail('The project uses an external shared quota directory. Back up that account through its host owner before exporting this project.', 409);
  return withPrivateLock(project.root, 'project.lock', () =>
    withPrivateLock(project.quotaDirectory, 'quota.lock', async () => {
      const before = await verifyProject(project);
      const archive = await invoke(['create', '--kind', 'project', '--root', project.root, '--output', resolve(output)], python);
      return { ...archive, project: before };
    }));
}
export async function createRoutescanCustomerArchive(record, { output, python = 'python3' } = {}) {
  return invoke(['create', '--kind', 'customer', '--root', record.directory, '--output', resolve(output)], python);
}
export async function restoreRoutescanBackup(archive, { directory, python = 'python3', env = process.env } = {}) {
  if (!directory) fail('Choose a new destination directory.');
  const restored = await invoke(['restore', '--archive', resolve(archive), '--destination', resolve(directory)], python);
  let project;
  try {
    project = await openProject(restored.directory, { env });
    return { ...restored, project: await verifyProject(project) };
  } finally { await project?.close(); }
}
export async function workspaceTransferDirectory(root) {
  return privateDirectory(join(dirname(root), 'routescan-transfers'));
}
export const newTransferId = () => 'routescan-' + new Date().toISOString().slice(0, 10) + '-' + randomUUID();
