// MIT. A merchant-owned native process group and private job directory.
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = process.argv[2];
let active = null, closing = false, retirement = null;
function send(message) {
  return new Promise(resolve => {
    if (!process.connected) return resolve(false);
    try { process.send(message, error => resolve(!error)); }
    catch { resolve(false); }
  });
}
function groupSignal(slot, signal) {
  if (!slot.child?.pid) return;
  try { process.kill(-slot.child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function retire(slot) {
  if (slot.retirement) return slot.retirement;
  slot.retirement = (async () => {
    if (slot.child?.pid) {
      groupSignal(slot, 'SIGTERM');
      await delay(250);
      groupSignal(slot, 'SIGKILL');
    }
    await slot.exited;
    await slot.closed;
  })();
  return slot.retirement;
}
async function shutdown() {
  if (retirement) return retirement;
  closing = true;
  retirement = (async () => {
    try {
      if (active) await retire(active);
      if (directory && isAbsolute(directory)) await rm(directory, { recursive: true, force: true });
      process.exitCode = 0;
    } catch { process.exitCode = 73; }
    if (process.connected) process.disconnect();
  })();
  return retirement;
}
process.on('disconnect', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('message', async request => {
  if (closing) return;
  if (active || request?.type !== 'run' || !Number.isSafeInteger(request.id) ||
      !Array.isArray(request.command) || !request.command.length) {
    await send({ type: 'failure', code: 'JOB_NATIVE_PROTOCOL_INVALID' });
    await shutdown(); return;
  }
  let ended, closed;
  const slot = { id: request.id, child: null, retirement: null, result: null, failure: null,
    exited: new Promise(resolve => { ended = resolve; }),
    closed: new Promise(resolve => { closed = resolve; }) };
  active = slot;
  try {
    slot.child = spawn(request.command[0], request.command.slice(1), {
      cwd: request.cwd, env: process.env, detached: true, shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const child = slot.child;
    child.once('error', () => {
      slot.result = { code: null, signal: null, error: 'JOB_NATIVE_START_FAILED' };
      ended();
    });
    child.once('exit', (code, signal) => { slot.result ??= { code, signal }; ended(); });
    child.once('close', closed);
    for (const channel of ['stdout', 'stderr']) {
      let count = 0;
      child[channel].on('data', bytes => {
        child[channel].pause();
        count += bytes.length;
        if (count > request.limits[channel]) {
          slot.failure ??= 'JOB_NATIVE_OUTPUT_TOO_LARGE';
          child[channel].resume();
          retire(slot).catch(shutdown);
          return;
        }
        // Output and the eventual result share one ordered IPC channel.
        send({ type: 'output', id: slot.id, channel, bytes }).then(sent => {
          child[channel].resume();
          if (!sent) shutdown();
        });
      });
    }
    child.stdin.on('error', () => {});
    child.stdin.end(request.input);
    await slot.exited;
    await retire(slot);
    active = null;
    if (!closing) await send({ type: 'result', id: slot.id, ...slot.result,
      ...(slot.failure ? { error: slot.failure } : {}) });
  } catch {
    try {
      if (!slot.child) { ended(); closed(); }
      await retire(slot);
    } catch {}
    active = null;
    if (!closing) {
      await send({ type: 'failure', code: 'JOB_NATIVE_SUPERVISOR_FAILED' });
      await shutdown();
    }
  }
});
if (process.platform === 'win32' || !directory || !isAbsolute(directory) || !process.connected) {
  await shutdown();
} else if (!await send({ type: 'ready' })) await shutdown();
