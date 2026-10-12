// MIT. Own the published merchant host and a real inherited native process tree.
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const self = fileURLToPath(import.meta.url);
const role = process.argv[2];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (value, message) => { if (!value) throw new Error(message); };
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
async function identity(pid = process.pid) {
  const text = await readFile('/proc/' + pid + '/stat', 'utf8');
  const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
  return { pid, parent: Number(fields[1]), group: Number(fields[2]),
    session: Number(fields[3]), startTicks: fields[19], state: fields[0] };
}
async function save(path, value) {
  await writeFile(path + '.next', JSON.stringify(value, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  await rename(path + '.next', path);
}
async function readWhenReady(path) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(25);
  }
  throw new Error('The original native process did not retain its readiness: ' + path);
}
function stayAlive() {
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
  setInterval(() => {}, 1000);
}
async function nativeTree() {
  const directory = process.argv[3], mode = process.argv[4];
  if (role === 'grandchild') {
    stayAlive();
    await save(join(directory, 'grandchild.json'), await identity());
    return;
  }
  need(role === 'child', 'Unknown native process role');
  if (mode !== 'merchant-kill-idle') stayAlive();
  const child = await identity();
  const descendant = spawn(process.execPath, [self, 'grandchild', directory, mode],
    { cwd: directory, env: process.env, stdio: 'ignore', shell: false });
  let failure;
  descendant.once('error', error => { failure = error; });
  const grandchild = await readWhenReady(join(directory, 'grandchild.json'));
  if (failure) throw failure;
  need(grandchild.pid === descendant.pid && grandchild.parent === child.pid &&
    grandchild.group === child.group, 'The real grandchild changed its inherited process group');
  await save(join(directory, 'tree.json'), { child, grandchild });
  if (mode === 'merchant-kill-idle') process.exit(0);
}
function nativeResult(value) {
  return { ok: true, exitCode: value.exitCode, signal: value.signal,
    stdoutBytes: value.stdout.length, stdoutSha256: hash(value.stdout),
    stderrBytes: value.stderr.length, stderrSha256: hash(value.stderr) };
}
async function merchantOwner() {
  const [sourceRoot, temporaryDirectory, mode] = process.argv.slice(3);
  need(['host-close', 'merchant-kill-active', 'merchant-kill-idle'].includes(mode),
    'Select the original lifecycle phase');
  const { createNativeProcessHost } = await import(pathToFileURL(join(sourceRoot,
    'stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/processes-host.mjs')));
  const host = createNativeProcessHost({ temporaryDirectory,
    env: { PATH: process.env.PATH ?? dirname(process.execPath), LANG: 'C.UTF-8' } });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let resolveAction;
  const action = new Promise(resolve => { resolveAction = resolve; });
  input.on('line', line => {
    try { resolveAction(JSON.parse(line)); }
    catch { resolveAction({ action: 'invalid' }); }
  });
  input.once('close', () => resolveAction({ action: 'owner-input-closed' }));
  let native;
  try {
    const directory = await host.directory();
    const state = Buffer.from(JSON.stringify({ schema: 'starforge.native-owner-fixture.v1', mode }) + '\n');
    await writeFile(join(directory, 'owned-state.json'), state, { flag: 'wx', mode: 0o600 });
    native = host.run({
      command: [process.execPath, self, 'child', directory, mode],
      cwd: directory, input: new Uint8Array(),
      maxStdoutBytes: 4096, maxStderrBytes: 65536,
    }).then(nativeResult, error => ({ ok: false,
      error: { code: error.code ?? null, message: String(error.message) } }));
    const tree = await readWhenReady(join(directory, 'tree.json'));
    const completed = mode === 'merchant-kill-idle' ? await native : null;
    if (completed) need(completed.ok && completed.exitCode === 0,
      'The original native child did not complete: ' + JSON.stringify(completed));
    const guardian = await identity(tree.child.parent);
    send({ type: 'ready', mode, directory, merchant: await identity(),
      guardian, child: tree.child, grandchild: tree.grandchild,
      directoryMode: (await lstat(directory)).mode & 0o777,
      ownedStateSha256: hash(state), run: completed });
    const selected = await action;
    need(['close', 'owner-input-closed'].includes(selected.action),
      'The lifecycle observer returned an invalid owner command');
    await host.close();
    send({ type: 'closed', mode, directory, run: await native });
  } finally {
    await host.close();
    input.close();
    process.stdin.destroy();
  }
}
try {
  if (role === 'owner') await merchantOwner();
  else await nativeTree();
} catch (error) {
  if (role === 'owner') send({ type: 'failure',
    error: { code: error.code ?? null, message: String(error.message) } });
  else process.stderr.write(String(error.stack ?? error) + '\n');
  process.exitCode = 1;
}
