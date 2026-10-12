// MIT. Original-command continuation inside the runtime workspace's existing worker lease.
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareApplicationCommand, observeApplicationOutput } from './application-command.mjs';
import { assertPythonManagedLaunch, pythonManagedStopSignal } from '../python-runtime/application-lifecycle.mjs';
import { plain, absolute, privateDirectory, readJSON, saveJSON, canonical, json, digest,
  need, now, processIdentity } from './storage.mjs';

async function run(directory) {
  await privateDirectory(absolute(directory));
  const lease = await open('/proc/self/fd/3', constants.O_RDONLY).catch(() => null);
  // fd 3 is inherited from the original worker's already-held flock description.
  // fstat through the inherited descriptor also works when /proc is unavailable.
  const { fstatSync } = await import('node:fs');
  const inherited = fstatSync(3), expected = await lstat(join(directory, 'worker.lock'));
  need(inherited.dev === expected.dev && inherited.ino === expected.ino && inherited.isFile(),
    'MANAGED_COMMAND_WORKER_LEASE_REQUIRED');
  if (lease) await lease.close();
  const request = await readJSON(join(directory, 'request.json'));
  const { requestHash, createdAt, ...body } = request;
  need(digest(json(canonical(body))) === requestHash && request.operation === 'managed-run',
    'MANAGED_COMMAND_REQUEST_CHANGED');
  const launch = await readJSON(join(directory, 'command-launch.json'));
  const argv = [join(request.releaseDirectory, 'forge.mjs'), 'run', request.command, '--', ...request.args];
  if (request.pythonCommand) assertPythonManagedLaunch(request, launch);
  else need(launch.releaseId === request.releaseId && launch.digest === request.releaseDigest &&
    launch.cwd === request.homeDirectory && JSON.stringify(launch.args) === JSON.stringify(argv),
  'MANAGED_COMMAND_LAUNCH_CHANGED');
  let child, timer, outcome, observing, stopping = false;
  const stopped = async () => Boolean(await readJSON(join(directory, 'stop.json'), true));
  const stop = () => { stopping = true; if (child) child.kill(pythonManagedStopSignal(request)); };
  let result;
  try {
    if (await stopped()) {
      result = { exitCode: null, signal: null, state: 'STOPPED', stopped: true, launched: false };
    } else {
      const launchCommand = await prepareApplicationCommand(request, directory, argv);
      // Both ordinary and terminal commands inherit the original held worker
      // lease. The optional PTY is only an input/output adapter for this child.
      child = spawn(launchCommand.executable, launchCommand.args, launchCommand.options);
      observing = observeApplicationOutput(request, directory, { pid: child.pid });
      if (child.stdout) child.stdout.on('data', bytes => { process.stdout.write(bytes); observing.write(bytes); });
      if (child.stderr) child.stderr.on('data', bytes => process.stderr.write(bytes));
      outcome = new Promise((accept, reject) => {
        child.once('error', reject); child.once('close', (exitCode, signal) => accept({ exitCode, signal }));
      });
      outcome.catch(() => {});
      await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
      await saveJSON(join(directory, 'command-process.json'), {
        startedAt: now(), runner: { pid: process.pid, processStart: await processIdentity() },
        original: { pid: child.pid, processStart: await processIdentity(child.pid), executable: launchCommand.executable,
          args: launchCommand.args, cwd: launchCommand.options.cwd, role: request.terminal ? 'original-command-terminal' : 'original-command' },
      });
      let reading = false;
      timer = setInterval(async () => {
        if (reading || stopping) return;
        reading = true;
        try { if (await stopped()) stop(); }
        catch (error) { process.stderr.write('Stop request: ' + error.message + '\n'); }
        finally { reading = false; }
      }, 250);
      process.on('SIGTERM', stop); process.on('SIGINT', stop);
      const completed = await outcome;
      await observing.close();
      if (request.terminal) {
        const terminal = await readJSON(join(directory, 'terminal-exit.json'), true);
        if (Number.isInteger(terminal?.exitCode)) {
          completed.exitCode = terminal.exitCode >= 0 ? terminal.exitCode : null;
          completed.signal = terminal.exitCode < 0 ? 'SIGNAL_' + (-terminal.exitCode) : null;
        }
      }
      stopping ||= await stopped();
      result = { ...completed, state: stopping ? 'STOPPED' : completed.exitCode === 0 ? 'COMPLETED' : 'EXITED',
        stopped: stopping, launched: true };
    }
  } catch (error) {
    if (child) child.kill(pythonManagedStopSignal(request));
    if (outcome) await outcome.catch(() => {});
    if (observing) await observing.close().catch(() => {});
    result = { exitCode: null, signal: null, state: 'LAUNCH_FAILED', stopped: stopping,
      error: { code: error.code ?? 'MANAGED_COMMAND_ERROR', message: String(error.message).slice(0, 2000) } };
  } finally {
    clearInterval(timer); process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }
  const recorded = { operation: 'original-command', releaseId: request.releaseId, digest: request.releaseDigest,
    command: request.command, args: request.args, cwd: launch.cwd, completedAt: now(),
    ...(request.pythonCommand ? { pythonInstallation: request.pythonCommand.installationId,
      pythonBindingFingerprint: request.pythonCommand.fingerprint } : {}), ...result };
  await saveJSON(join(directory, 'command-result.json'), recorded);
  process.exitCode = result.state === 'LAUNCH_FAILED' ? 1 : 0;
}
if (process.argv.length !== 4 || process.argv[2] !== '--operation') throw new Error('Use the original managed operation worker');
await run(resolve(process.argv[3]));
