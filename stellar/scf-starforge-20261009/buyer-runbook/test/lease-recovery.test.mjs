// MIT. Reproduce delayed old unlocks while a newer execution owns its lease.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireExecutionLease, unlockRunbook, recoverRunbook } from '../runbook.mjs';

const SELF = fileURLToPath(import.meta.url), [mode, directory, deadPid, resumePath] = process.argv.slice(2);
if (mode) {
  const start = new Promise(accept => process.once('message', accept));
  process.send({ ready:true }); await start;
  if (mode === 'unlock') {
    // Pause after unlock captured its exact owner, at the real liveness probe.
    // A parent-written file resumes the actual probe and recovery function.
    // This also works when the host's /proc uses another PID namespace.
    const kill = process.kill.bind(process); let paused = false;
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    process.kill = (pid, signal) => {
      if (!paused && pid === Number(deadPid) && signal === 0) {
        paused = true; process.send({ paused:true });
        while (!existsSync(resumePath)) Atomics.wait(barrier, 0, 0, 10);
      }
      return kill(pid, signal);
    };
    try { process.send({ outcome:await unlockRunbook(directory, Number(deadPid)) }); }
    finally { process.kill = kill; }
  } else {
    try {
      const release = await acquireExecutionLease(directory);
      const finish = new Promise(accept => process.once('message', accept));
      process.send({ outcome:{ acquired:true } }); await finish; await release();
    } catch (error) {
      if (error.code !== 'RUNBOOK_EXECUTION_LOCK_EXISTS') throw error;
      process.send({ outcome:{ acquired:false, code:error.code } });
    }
  }
  process.disconnect();
} else {
  const scratch = await mkdtemp(join(tmpdir(), 'buyer-lease-recovery-')), children = [];
  const worker = (kind, run, pid = '') => {
    const resume = join(run, '.test-resume-' + children.length);
    const child = spawn(process.execPath, [SELF, kind, run, String(pid), resume], {stdio:['ignore','pipe','pipe','ipc']});
    children.push(child); let output = '', readyResolve, pausedResolve, outcomeResolve;
    const ready = new Promise(accept => { readyResolve = accept; });
    const paused = new Promise(accept => { pausedResolve = accept; });
    const outcome = new Promise(accept => { outcomeResolve = accept; });
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('message', message => {
      if (message.ready) readyResolve(); if (message.paused) pausedResolve(); if (message.outcome) outcomeResolve(message.outcome);
    });
    const done = new Promise((accept, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => { outcomeResolve({error:output, code}); accept({code, signal, output}); });
    });
    return {child, ready, paused, outcome, done, resume};
  };
  const planAt = async run => {
    await mkdir(run, {mode:0o700}); await mkdir(join(run, 'attempts'), {mode:0o700});
    await writeFile(join(run, 'plan.json'), JSON.stringify({schema:'stellar-forge.buyer-runbook-plan.v1',
      id:'lease-check', directory:run, operations:[{id:'resource', intentId:'stable-intent', config:{sha256:'0'.repeat(64)}}]}));
  };
  const timeout = setTimeout(() => { for (const child of children) child.kill('SIGKILL');
    throw new Error('Lease recovery check timed out'); }, 30000);
  try {
    const run = join(scratch, 'run'); await planAt(run);
    const attemptPath = join(run, 'attempts', 'resource.started.json');
    const attempted = '{"id":"resource","intentId":"stable-intent","at":"2026-10-11T00:00:00Z"}\n';
    await writeFile(attemptPath, attempted);
    const owner = worker('owner', run); await owner.ready; owner.child.send({start:true});
    assert.deepEqual(await owner.outcome, {acquired:true});
    const oldRecord = JSON.parse(await readFile(join(run, '.execution-leases', '1.json'), 'utf8'));
    owner.child.kill('SIGKILL'); assert.equal((await owner.done).signal, 'SIGKILL');
    const stale = [worker('unlock', run, owner.child.pid), worker('unlock', run, owner.child.pid)];
    await Promise.all(stale.map(child => child.ready)); for (const child of stale) child.child.send({start:true});
    await Promise.all(stale.map(child => child.paused));
    assert.equal((await unlockRunbook(run, owner.child.pid)).generation, '1');
    const releaseNew = await acquireExecutionLease(run);
    const freshPath = join(run, '.execution-leases', '2.json'), freshBytes = await readFile(freshPath);
    for (const child of stale) await writeFile(child.resume, 'resume');
    for (const child of stale) {
      const result = await child.outcome; assert.equal(result.generation, '1'); assert.equal(result.alreadyReleased, true);
      assert.equal((await child.done).code, 0);
    }
    await assert.rejects(acquireExecutionLease(run), {code:'RUNBOOK_EXECUTION_LOCK_EXISTS'});
    assert.deepEqual(await readFile(freshPath), freshBytes); await releaseNew();

    const contenders = Array.from({length:6}, () => worker('contender', run));
    await Promise.all(contenders.map(child => child.ready)); for (const child of contenders) child.child.send({start:true});
    const outcomes = await Promise.all(contenders.map(child => child.outcome));
    assert.equal(outcomes.filter(value => value.acquired).length, 1);
    contenders[outcomes.findIndex(value => value.acquired)].child.send({finish:true});
    for (const child of contenders) { const result = await child.done; assert.equal(result.code, 0, result.output); }
    const recovered = await recoverRunbook(run);
    assert.equal(recovered.recovered[0].state, 'NO_COMPLETE_NATIVE_RESULT');
    assert.equal(await readFile(attemptPath, 'utf8'), attempted);
    assert.equal((await readdir(join(run, '.execution-leases'))).filter(name => /^\d+\.json$/.test(name)).length, 4);
    await assert.rejects(open(join(run, '.execution-lock.json'), 'wx'), {code:'EEXIST'});

    const legacy = join(scratch, 'legacy'); await planAt(legacy);
    const {generation, ...oldFields} = oldRecord;
    const legacyBytes = JSON.stringify({...oldFields, schema:'stellar-forge.buyer-runbook-lock.v1'});
    await writeFile(join(legacy, '.execution-lock.json'), legacyBytes);
    await assert.rejects(acquireExecutionLease(legacy), {code:'RUNBOOK_EXECUTION_LOCK_EXISTS'});
    assert.equal((await unlockRunbook(legacy, owner.child.pid)).generation, '0');
    const releaseLegacy = await acquireExecutionLease(legacy); await releaseLegacy();
    assert.equal(await readFile(join(legacy, '.execution-lock.json'), 'utf8'), legacyBytes);
    console.log(JSON.stringify({status:'PASS', delayedUnlockers:2, newLeasePreserved:true,
      concurrentAcquirers:6, concurrentLeasesGranted:1, legacyGenerationRecovered:'0',
      originalAttemptPreserved:true, originalRecoverState:recovered.recovered[0].state, nativeBuyerRuns:0}));
  } finally {
    clearTimeout(timeout);
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(scratch, {recursive:true, force:true});
  }
}
