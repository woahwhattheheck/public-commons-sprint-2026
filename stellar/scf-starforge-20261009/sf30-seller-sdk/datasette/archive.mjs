// MIT. Complete Datasette workspace transfer using the original shared archive engine.
import { spawn } from 'node:child_process';
import { mkdir, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolute, privateDirectory, acquireWorkspace, fault } from '../postgres/publisher/files.mjs';

export const DATASETTE_WORKSPACE_ARCHIVE_SCHEMA = 'stellar-forge.datasette-workspace-archive.v1';
const NATIVE = fileURLToPath(new URL('./archive.py', import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const MAX_OUTPUT = 64 * 1024 * 1024;

async function parentDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw fault('DATASETTE_ARCHIVE_PRIVATE_DIRECTORY_REQUIRED');
}
function native(request) {
  return new Promise((resolve, reject) => {
    const input = Buffer.from(JSON.stringify(request));
    if (input.length > 65536) {
      reject(fault('DATASETTE_ARCHIVE_REQUEST_LIMIT')); return;
    }
    const child = spawn('python3', ['-I', '-B', NATIVE], {
      stdio: ['pipe', 'pipe', 'pipe'], shell: false,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    const output = [], errors = [];
    let outputBytes = 0, errorBytes = 0, failure;
    const stop = issue => {
      failure ??= issue;
      child.kill('SIGTERM');
    };
    child.on('error', issue => { failure ??= issue; });
    child.stdin.on('error', issue => { failure ??= issue; });
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT) stop(fault('DATASETTE_ARCHIVE_RESULT_LIMIT', 'The original archive result exceeded its complete manifest limit.', 502));
      else output.push(chunk);
    });
    child.stderr.on('data', chunk => {
      errorBytes += chunk.length;
      if (errorBytes <= 65536) errors.push(chunk);
    });
    child.on('close', (code, signal) => {
      if (failure) {
        const issue = fault(failure.code?.startsWith('DATASETTE_') ? failure.code : 'DATASETTE_ARCHIVE_NATIVE_FAILED',
          failure.message ?? 'The native archive worker could not finish.', 502);
        issue.uncertain = true; issue.directory = request.directory;
        reject(issue); return;
      }
      let result;
      try { result = JSON.parse(Buffer.concat(output).toString('utf8')); }
      catch {
        const issue = fault('DATASETTE_ARCHIVE_NATIVE_FAILED',
          'The native archive worker ended without its complete result' + (signal ? ' (' + signal + ')' : '') + '.', 502);
        issue.uncertain = true; issue.directory = request.directory;
        reject(issue); return;
      }
      if (!result || typeof result !== 'object' || result.ok !== true || code !== 0) {
        reject(fault(typeof result?.error === 'string' ? result.error : 'DATASETTE_ARCHIVE_NATIVE_FAILED',
          typeof result?.message === 'string' ? result.message : 'The native archive operation failed.', 409));
        return;
      }
      if (!result.result || typeof result.result !== 'object' ||
          !HASH.test(result.result.sha256 ?? '') || typeof result.result.archiveFile !== 'string') {
        reject(fault('DATASETTE_ARCHIVE_RESULT_INVALID', 'The native archive result is incomplete.', 502));
        return;
      }
      resolve(result.result);
    });
    child.stdin.end(input);
  });
}

/** Export under the supplied live workspace's idle operation gate, or acquire the
 * original workspace lease for an offline export. All saved file bytes are included. */
export async function exportDatasetteWorkspace({ workspace, directory, outputFile } = {}) {
  directory = absolute(directory ?? workspace?.directory, 'Datasette workspace directory');
  outputFile = absolute(outputFile, 'Datasette workspace archive');
  if (workspace && (absolute(workspace.directory, 'Datasette workspace directory') !== directory ||
      typeof workspace.workspaceId !== 'string' || !workspace.workspaceId))
    throw fault('DATASETTE_ARCHIVE_WORKSPACE_CHANGED');
  await privateDirectory(directory);
  await parentDirectory(dirname(outputFile));
  let release;
  try {
    if (!workspace) release = await acquireWorkspace(directory);
    return await native({operation: 'export', directory, outputFile,
      ...(workspace ? {workspaceId: workspace.workspaceId} : {})});
  } finally { await release?.(); }
}

/** Receive into a separate new directory. The incoming archive and all execution
 * preimages remain under receiving/SHA256, with explicit relocation history.
 * Repeating a completed receive never rewrites subsequent workspace edits. */
export async function receiveDatasetteWorkspace({ archiveFile, directory, sha256 } = {}) {
  archiveFile = absolute(archiveFile, 'Datasette workspace archive');
  directory = absolute(directory, 'Datasette receiving directory');
  if (!HASH.test(sha256 ?? ''))
    throw fault('DATASETTE_ARCHIVE_HASH_REQUIRED', 'Supply the complete SHA256 of the original workspace archive.');
  await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    return await native({operation: 'receive', archiveFile, directory, sha256});
  } finally { await release(); }
}
