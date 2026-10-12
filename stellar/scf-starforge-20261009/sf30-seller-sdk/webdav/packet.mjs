// MIT. Same source packet entrypoint for CLI and the original source workspace.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { readPrivate } from '../postgres/publisher/files.mjs';
import { fail, WebDavError, sha256 } from './config.mjs';

function absolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value === '/')
    fail('WEBDAV_PACKET_PATH', 'Use a normalized absolute source packet path.');
  return value;
}
async function run(command, args, { python = 'python3', signal, input } = {}) {
  if (typeof python !== 'string' || !python || python.includes('\0')) fail('WEBDAV_PYTHON', 'Select the native Python runtime.');
  return new Promise((done, reject) => {
    const child = spawn(python, [fileURLToPath(new URL('./packet.py', import.meta.url)), command, ...args],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let count = 0, failure = null;
    const cancel = () => { failure ??= new WebDavError('WEBDAV_CANCELLED', 'The source packet operation was cancelled; original and partial files are retained.', 409); child.kill('SIGTERM'); };
    const timer = setTimeout(() => { failure ??= new WebDavError('WEBDAV_PACKET_TIMEOUT', 'The source packet operation exceeded its one-hour limit.', 504); child.kill('SIGKILL'); }, 3600000);
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.once('error', () => { failure ??= new WebDavError('WEBDAV_PYTHON_UNAVAILABLE', 'Start with the maintained Python runtime installed.'); });
    child.stdout.on('data', part => {
      count += part.length;
      if (count > 8388608) { failure ??= new WebDavError('WEBDAV_PACKET_OUTPUT', 'The native source packet result exceeds its limit.'); child.kill('SIGKILL'); }
      else chunks.push(part);
    });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (failure) return reject(failure);
      let result;
      try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, count))); }
      catch { return reject(new WebDavError('WEBDAV_PACKET_RESULT', 'The native source packet result could not be read.')); }
      if (code !== 0 || result.error) return reject(new WebDavError(result.error?.code ?? 'WEBDAV_PACKET_FAILED', result.error?.message ?? 'The native source packet did not complete.'));
      done(result);
    });
    child.stdin.end(input ? JSON.stringify(input) : '');
  });
}
/** Caller holds the original workspace lease and serializes source mutations. */
export async function exportSourcePacket({ directory, output, python, signal }) {
  directory = absolute(directory); output = absolute(output);
  const raw = await readPrivate(directory + '/workspace.json', 16777216), state = JSON.parse(raw);
  return run('pack', ['--root', directory, '--out', output], { python, signal,
    input: { workspaceId: state.id, revision: state.revision, expectedWorkspaceSha256: sha256(raw) } });
}
export function inspectSourcePacket({ input, python, signal }) {
  return run('inspect', ['--input', absolute(input)], { python, signal });
}
export function importSourcePacket({ input, directory, python, signal }) {
  return run('restore', ['--input', absolute(input), '--directory', absolute(directory)], { python, signal });
}
