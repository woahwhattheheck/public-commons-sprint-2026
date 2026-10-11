// Invoke the actual published AGX CLI and retrieve the exact encrypted report.
import { spawn } from 'node:child_process';
import { open, rm } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { JOB_SCHEMA, PART_SCHEMA, ERROR_SCHEMA, AdapterError, need, privateDirectory, atomic, SHA, JOB } from './custody.mjs';

const cli = join(dirname(fileURLToPath(import.meta.resolve('@nostr-agx/cli/package.json'))), 'dist/agx.js');
export async function request({ peer, profile, agxHome, timeoutMs = 30000 }, capability, payload) {
  need(typeof peer === 'string' && /^(?:[0-9a-f]{64}|npub1[023456789acdefghjklmnpqrstuvwxyz]{58})$/.test(peer), 'INVALID_PEER');
  need(typeof profile === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(profile), 'INVALID_PROFILE');
  need(isAbsolute(agxHome) && Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'INVALID_CLIENT_CONFIG');
  await privateDirectory(agxHome);
  return new Promise((accept, reject) => {
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), overflow = false;
    const child = spawn(process.execPath, [cli, 'request', peer, capability, '--payload', JSON.stringify(payload), '--profile', profile, '--json', '--timeout', String(timeoutMs)], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', AGX_HOME: agxHome },
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new AdapterError('TRANSPORT_TIMEOUT')); }, timeoutMs + 10000);
    child.stdout.on('data', bytes => { if (stdout.length + bytes.length > 65536) { overflow = true; child.kill('SIGKILL'); } else stdout = Buffer.concat([stdout, bytes]); });
    child.stderr.on('data', bytes => { if (stderr.length < 8192) stderr = Buffer.concat([stderr, bytes]).subarray(0, 8192); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (overflow || code !== 0) return reject(new AdapterError(overflow ? 'TRANSPORT_RESULT_TOO_LARGE' : 'TRANSPORT_REQUEST_FAILED'));
      try {
        const raw = JSON.parse(stdout.toString());
        // Published CLI 0.3.0 emits { ok, capability, result }; its core correlates
        // the authenticated sender and task before resolving this exact output.
        need(raw.ok === true && raw.capability === capability, 'INVALID_TASK_RESULT');
        const value = raw.result;
        need([JOB_SCHEMA, PART_SCHEMA, ERROR_SCHEMA].includes(value?.schema), 'INVALID_TASK_RESULT');
        accept(value);
      } catch (error) { reject(error instanceof AdapterError ? error : new AdapterError('INVALID_TASK_RESULT')); }
    });
  });
}

export async function receive(options, payload, destination, execute = false, waitMs = 180000) {
  need(payload && Object.keys(payload).length === 2 && typeof payload.jobId === 'string' && JOB.test(payload.jobId) && SHA.test(payload.bundleId), 'INVALID_REQUEST');
  need(Number.isSafeInteger(waitMs) && waitMs >= 0 && waitMs <= 86400000, 'INVALID_WAIT_LIMIT');
  const started = performance.now();
  const check = job => {
    need(job.schema === JOB_SCHEMA && job.jobId === payload.jobId && job.bundleId === payload.bundleId, job.error?.code ?? 'RESULT_INPUT_CONFLICT');
    need(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(job.state), 'INVALID_JOB_STATE');
    return job;
  };
  let result = check(await request(options, execute ? 'finance.reconcile' : 'finance.reconcile.status', payload));
  while (['QUEUED', 'RUNNING'].includes(result.state)) {
    if (performance.now() - started >= waitMs) return { ...result, clientWait: { timedOut: true } };
    await delay(Math.min(1000, Math.max(0, waitMs - (performance.now() - started))));
    result = check(await request(options, 'finance.reconcile.status', payload));
  }
  if (result.state !== 'COMPLETED') return result;
  const report = result.result?.report;
  need(['PASS', 'FAIL'].includes(result.result?.status) && SHA.test(report?.sha256) && Number.isSafeInteger(report.bytes) && report.bytes > 0 && report.bytes <= 128 * 1024 * 1024, 'INVALID_REPORT_DESCRIPTOR');
  await privateDirectory(destination, true);
  const partial = join(destination, 'report.partial');
  let file;
  try {
    file = await open(partial, 'wx', 0o600);
    let offset = 0;
    const hash = createHash('sha256');
    while (offset < report.bytes) {
      const part = await request(options, 'finance.report', { ...payload, reportSha256: report.sha256, offset, length: 8192 });
      need(part.schema === PART_SCHEMA && part.jobId === payload.jobId && part.bundleId === payload.bundleId && part.reportSha256 === report.sha256 && part.offset === offset && part.totalBytes === report.bytes && part.encoding === 'base64', part.error?.code ?? 'REPORT_PART_CONFLICT');
      need(typeof part.data === 'string' && part.data.length <= 11000, 'INVALID_REPORT_PART');
      const data = Buffer.from(part.data, 'base64');
      const next = offset + data.length;
      need(data.toString('base64') === part.data && data.length > 0 && data.length === part.bytes && data.length <= 8192 && next <= report.bytes && part.done === (next === report.bytes) && part.nextOffset === next, 'INVALID_REPORT_PART');
      await file.writeFile(data); hash.update(data); offset = next;
    }
    need(hash.digest('hex') === report.sha256, 'REPORT_HASH_MISMATCH');
    await file.sync(); await file.close(); file = null;
    const { rename } = await import('node:fs/promises');
    await rename(partial, join(destination, 'report.json'));
    await atomic(join(destination, 'result.json'), result, true);
    await atomic(join(destination, 'request.json'), payload, true);
    await atomic(join(destination, 'delivery.json'), { schema: 'erp-reconciliation.agx-delivery.v1', peer: options.peer, jobId: payload.jobId, bundleId: payload.bundleId, reportSha256: report.sha256, bytes: report.bytes, receivedAt: new Date().toISOString(), protocol: '@nostr-agx/cli@0.3.0' }, true);
    return { ...result, delivery: { directory: destination, bytes: report.bytes, sha256: report.sha256 } };
  } catch (error) { await file?.close(); await rm(destination, { recursive: true, force: true }); throw error; }
}
