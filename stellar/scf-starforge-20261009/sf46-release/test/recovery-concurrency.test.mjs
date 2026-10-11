// MIT. One focused local interruption/concurrency check; no seller or payment run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { HOME_SCHEMA, RELEASE_SCHEMA, MANIFEST, UPDATE_CLAIMS, atomicFile, atomicJson,
  canonical, sha256, withHomeLock } from '../release-core.mjs';
import { install } from '../product.mjs';

const SELF = fileURLToPath(import.meta.url), SOURCE = dirname(dirname(SELF));
const [mode, home] = process.argv.slice(2);
if (mode) {
  const start = new Promise(accept => process.once('message', accept));
  process.send({ ready: true }); await start;
  if (mode === 'dead-owner') {
    await withHomeLock(home, async () => {
      process.send({ entered: true });
      await delay(60000);
    });
  } else {
    let succeeded = false;
    for (let attempt = 0; attempt < 100 && !succeeded; attempt++) {
      try {
        await withHomeLock(home, async () => {
          // A second entrant causes a real create-exclusive failure here.
          const guardPath = join(home, 'critical-section'), guard = await open(guardPath, 'wx');
          try {
            const before = Number(await readFile(join(home, 'counter'), 'utf8'));
            await delay(25);
            await atomicFile(join(home, 'counter'), String(before + 1));
          } finally { await guard.close(); await unlink(guardPath); }
        });
        succeeded = true;
      } catch (error) {
        if (!/Another release update/.test(error.message)) throw error;
        await delay(5 + Math.floor(Math.random() * 10));
      }
    }
    assert.equal(succeeded, true, 'contender eventually acquired its turn');
  }
  process.disconnect();
} else {
  const scratch = await mkdtemp(join(tmpdir(), 'forge-recovery-')), children = [];
  const worker = (kind, directory) => {
    const child = spawn(process.execPath, [SELF, kind, directory], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    children.push(child);
    let output = '', readyResolve, enteredResolve;
    const ready = new Promise(accept => { readyResolve = accept; });
    const entered = new Promise(accept => { enteredResolve = accept; });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('message', message => { if (message.ready) readyResolve(); if (message.entered) enteredResolve(); });
    const done = new Promise((accept, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => accept({ code, signal, output }));
    });
    return { child, ready, entered, done };
  };
  const timeout = setTimeout(() => { for (const child of children) child.kill('SIGKILL');
    throw new Error('Recovery/concurrency check timed out'); }, 30000);
  try {
    const lockedHome = join(scratch, 'concurrent'); await mkdir(lockedHome);
    await writeFile(join(lockedHome, 'counter'), '0');
    const dead = worker('dead-owner', lockedHome);
    await dead.ready; dead.child.send({ start: true }); await dead.entered;
    assert.equal((await readdir(join(lockedHome, UPDATE_CLAIMS))).filter(name => name.endsWith('.json')).length, 1);
    dead.child.kill('SIGKILL'); assert.equal((await dead.done).signal, 'SIGKILL');
    const contenders = Array.from({ length: 8 }, () => worker('contender', lockedHome));
    await Promise.all(contenders.map(child => child.ready));
    for (const child of contenders) child.child.send({ start: true });
    for (const result of await Promise.all(contenders.map(child => child.done)))
      assert.equal(result.code, 0, result.output);
    assert.equal(await readFile(join(lockedHome, 'counter'), 'utf8'), '8');
    assert.equal((await readdir(join(lockedHome, UPDATE_CLAIMS))).filter(name => name.endsWith('.json')).length, 0);

    // A minimal digest-verified fixture carries the actual current manager bytes.
    // No source-release packaging, native seller flow or network is repeated.
    const bundle = join(scratch, 'bundle'); await mkdir(bundle);
    const bytes = new Map([
      ['forge.mjs', await readFile(join(SOURCE, 'product.mjs'))],
      ['release-core.mjs', await readFile(join(SOURCE, 'release-core.mjs'))],
      ['package.json', Buffer.from('{"type":"module","private":true}\n')],
    ]);
    const files = [];
    for (const [path, content] of bytes) {
      await writeFile(join(bundle, path), content);
      files.push({ path, bytes: content.length, sha256: sha256(content), mode: path === 'forge.mjs' ? 0o755 : 0o644 });
    }
    const body = { schema: RELEASE_SCHEMA, product: 'Stellar Forge', version: '0.0.0-recovery-fixture',
      source: { commit: '0'.repeat(40) }, runtime: { nativePackages: {} }, commands: {}, files };
    const manifest = { ...body, digest: sha256(canonical(body)) };
    await writeFile(join(bundle, MANIFEST), JSON.stringify(manifest));
    const interrupted = join(scratch, 'interrupted'); await mkdir(interrupted);
    for (const name of ['config', 'state']) {
      await mkdir(join(interrupted, name));
      await writeFile(join(interrupted, name, 'operator-data'), 'preserved-' + name);
    }
    await writeFile(join(interrupted, 'forge.mjs'), 'partial bootstrap');
    await writeFile(join(interrupted, 'release-core.mjs'), 'partial core');
    await writeFile(join(interrupted, 'forge.mjs.new-' + randomUUID()), 'interrupted temporary bytes');
    const pending = { schema: HOME_SCHEMA, createdAt: '2026-10-11T00:00:00Z', sourceDigest: 'f'.repeat(64) };
    await atomicJson(join(interrupted, 'initializing.json'), pending);
    await assert.rejects(install(bundle, interrupted), /same release bundle/);
    assert.equal(await readFile(join(interrupted, 'forge.mjs'), 'utf8'), 'partial bootstrap');
    pending.sourceDigest = manifest.digest;
    await atomicJson(join(interrupted, 'initializing.json'), pending);
    await install(bundle, interrupted);
    for (const name of ['forge.mjs', 'release-core.mjs'])
      assert.deepEqual(await readFile(join(interrupted, name)), bytes.get(name));
    for (const name of ['config', 'state'])
      assert.equal(await readFile(join(interrupted, name, 'operator-data'), 'utf8'), 'preserved-' + name);
    assert.equal((await readdir(interrupted)).some(name => name.includes('.new-') || name === 'initializing.json'), false);
    assert.equal(JSON.parse(await readFile(join(interrupted, 'installation.json'), 'utf8')).sourceDigest, manifest.digest);

    const beforeMarker = join(scratch, 'before-marker'); await mkdir(beforeMarker);
    await writeFile(join(beforeMarker, 'initializing.json.new-' + randomUUID()), 'partial initial marker');
    await install(bundle, beforeMarker);
    assert.equal((await readdir(beforeMarker)).some(name => name.includes('.new-')), false);
    console.log(JSON.stringify({ status: 'PASS', concurrentUpdates: 8, criticalSectionOverlap: 0,
      killedOwnerRecovered: true, wrongPendingDigestRejected: true, partialBootstrapRepaired: 2,
      interruptedInitialMarkerRecovered: true, operatorFilesPreserved: 2, nativeSellerRuns: 0 }));
  } finally {
    clearTimeout(timeout);
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(scratch, { recursive: true, force: true });
  }
}
