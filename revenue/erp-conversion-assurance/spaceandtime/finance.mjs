#!/usr/bin/env node
// MIT. Retained acquisition composition over the original ERP service.
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, rename, link, unlink, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const SHA = /^[a-f0-9]{64}$/;
const FINAL = new Set(['COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
const SCHEMA = 'tjl.spaceandtime.prepared.v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = (code, message = code) => { const error = new Error(message); error.code = code; throw error; };
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) ||
      (process.getuid && stat.uid !== process.getuid())) fail('PRIVATE_DIRECTORY_REQUIRED', 'Use a private directory owned by this operating-system account.');
}

async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}

async function bytesAt(path, maximum = 8 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size > maximum) fail('INVALID_PRIVATE_FILE');
    const bytes = await file.readFile();
    if (bytes.length !== stat.size || bytes.length > maximum) fail('FILE_CHANGED_DURING_READ');
    return bytes;
  } finally { await file.close(); }
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      value.startsWith('/') || posix.normalize(value) !== value || value.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('INVALID_INVENTORY_PATH');
  }
  return value;
}

async function checkedPath(root, name) {
  const parts = relativePath(name).split('/');
  let path = root;
  for (const part of parts.slice(0, -1)) { path = join(path, part); await privateDirectory(path); }
  return join(root, ...parts);
}

async function atomic(path, bytes, createOnly = false) {
  const temporary = join(dirname(path), '.write-' + randomUUID());
  let file;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    if (createOnly) await link(temporary, path); else await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    if (file) await file.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function validPin(pin) {
  return pin && SHA.test(pin.sha256 ?? '') && Number.isSafeInteger(pin.bytes) && pin.bytes >= 0;
}

async function copyPinned(source, destination, pin) {
  if (!validPin(pin)) fail('INVALID_FILE_PIN');
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output;
  try {
    const before = await input.stat({ bigint: true });
    if (!before.isFile() || (before.mode & 0o077n) || before.size !== BigInt(pin.bytes)) fail('ACQUISITION_FILE_CHANGED');
    if (destination) {
      await privateDirectory(dirname(destination), true);
      output = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    }
    const digest = createHash('sha256'), buffer = Buffer.alloc(128 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > pin.bytes) fail('ACQUISITION_FILE_CHANGED');
      const chunk = buffer.subarray(0, bytesRead); digest.update(chunk);
      if (output) await output.writeFile(chunk);
    }
    const after = await input.stat({ bigint: true });
    if (total !== pin.bytes || digest.digest('hex') !== pin.sha256 || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail('ACQUISITION_FILE_CHANGED');
    if (output) { await output.sync(); await syncDirectory(dirname(destination)); }
  } finally { await input.close(); if (output) await output.close(); }
}

async function prepared(directory, copyTo = null) {
  directory = resolve(directory);
  await privateDirectory(directory);
  const raw = await bytesAt(join(directory, 'manifest.json'));
  let manifest;
  try { manifest = JSON.parse(raw); } catch { fail('INVALID_PREPARED_MANIFEST'); }
  if (manifest?.schema !== SCHEMA || !Array.isArray(manifest.files) || !manifest.capture_id ||
      !['acquisition_sha256', 'source_sha256', 'target_sha256', 'spec_sha256'].every(key => SHA.test(manifest[key] ?? ''))) {
    fail('INVALID_PREPARED_MANIFEST');
  }
  const inventory = new Map();
  for (const item of manifest.files) {
    const name = relativePath(item.path);
    if (inventory.has(name) || !validPin(item) ||
        (!['source.csv', 'target.csv', 'spec.json', 'acquisition.json'].includes(name) && !name.startsWith('originals/'))) {
      fail('INVALID_PREPARED_INVENTORY');
    }
    inventory.set(name, item);
  }
  for (const [name, field] of [['source.csv', 'source_sha256'], ['target.csv', 'target_sha256'],
    ['spec.json', 'spec_sha256'], ['acquisition.json', 'acquisition_sha256']]) {
    if (inventory.get(name)?.sha256 !== manifest[field]) fail('PREPARED_PIN_CONFLICT');
  }
  for (const [name, pin] of inventory) {
    await copyPinned(await checkedPath(directory, name), copyTo ? join(copyTo, name) : null, pin);
  }
  if (copyTo) { await atomic(join(copyTo, 'manifest.json'), raw, true); await syncDirectory(copyTo); }
  return { directory, manifest, manifestSha256: hash(raw), manifestBytes: raw.length };
}

async function retainPrepared(root, incoming) {
  const base = join(root, 'acquisitions'); await privateDirectory(base, true);
  const temporary = join(base, '.stage-' + randomUUID()); await privateDirectory(temporary, true);
  try {
    const value = await prepared(incoming, temporary);
    const destination = join(base, value.manifestSha256);
    try { await rename(temporary, destination); await syncDirectory(base); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    const retained = await prepared(destination);
    if (retained.manifestSha256 !== value.manifestSha256) fail('ACQUISITION_IDENTITY_CONFLICT');
    return retained;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function acquisitionLink(root, bundleId) {
  if (!SHA.test(bundleId ?? '')) fail('INVALID_BUNDLE_ID');
  const path = join(root, 'acquisition-links', bundleId + '.json');
  if (!await exists(path)) return null;
  const value = JSON.parse(await bytesAt(path, 32768));
  if (value.schema !== 'tjl.spaceandtime.bundle-acquisition.v1' || value.bundleId !== bundleId ||
      !SHA.test(value.manifestSha256 ?? '') || !SHA.test(value.acquisitionSha256 ?? '')) fail('ACQUISITION_LINK_CHANGED');
  return value;
}

async function stage(service, root, incoming) {
  const retained = await retainPrepared(root, incoming);
  const bundle = await service.stageBundle({ source: join(retained.directory, 'source.csv'),
    target: join(retained.directory, 'target.csv'), spec: join(retained.directory, 'spec.json') });
  for (const key of ['source', 'target', 'spec']) {
    if (bundle[key].sha256 !== retained.manifest[key + '_sha256']) fail('BUNDLE_ACQUISITION_CONFLICT');
  }
  const relation = { schema: 'tjl.spaceandtime.bundle-acquisition.v1', bundleId: bundle.bundleId,
    manifestSha256: retained.manifestSha256, acquisitionSha256: retained.manifest.acquisition_sha256,
    captureId: retained.manifest.capture_id };
  await privateDirectory(join(root, 'acquisition-links'), true);
  try { await atomic(join(root, 'acquisition-links', bundle.bundleId + '.json'), json(relation), true); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (JSON.stringify(await acquisitionLink(root, bundle.bundleId)) !== JSON.stringify(relation)) fail('ACQUISITION_LINK_CONFLICT');
  return { bundle, acquisition: relation };
}

function outcome(job) {
  if (job.state === 'COMPLETED') return job.result?.status === 'PASS' ? 0 : job.result?.status === 'FAIL' ? 2 : 1;
  return FINAL.has(job.state) ? 1 : 0;
}

async function waitFor(service, job, timeoutMs, pollMs) {
  const deadline = performance.now() + timeoutMs;
  while (!FINAL.has(job.state)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return { ...job, operatorWait: { timedOut: true } };
    await delay(Math.min(pollMs, remaining));
    job = await service.getJob(job.jobId);
  }
  return job;
}

async function report(service, jobId) {
  const job = await service.getJob(jobId), pin = job.result?.report;
  if (job.state !== 'COMPLETED' || !validPin(pin)) fail('REPORT_NOT_READY');
  let offset = 0; const parts = [];
  do {
    const page = await service.readReportChunk({ jobId, reportSha256: pin.sha256, offset, length: 8192 });
    const bytes = Buffer.from(page.data, 'base64');
    if (page.offset !== offset || page.bytes !== bytes.length || page.nextOffset !== offset + bytes.length ||
        page.totalBytes !== pin.bytes || (!page.done && bytes.length === 0)) fail('REPORT_RANGE_CHANGED');
    parts.push(bytes); offset = page.nextOffset;
  } while (offset < pin.bytes);
  const bytes = Buffer.concat(parts);
  if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256) fail('REPORT_CHANGED');
  return bytes;
}

const REPLAY = `#!/usr/bin/env node
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
async function read(name) {
  if (!name || name.includes('\\\\') || name.includes('\\0') || name.startsWith('/') || posix.normalize(name) !== name || name.split('/').some(p => p === '..' || p === '.')) fail('INVALID_DELIVERY_PATH');
  let path = root;
  for (const part of name.split('/').slice(0,-1)) { path = join(path,part); const s=await lstat(path); if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 63)) fail('PRIVATE_DIRECTORY_REQUIRED'); }
  const f = await open(join(root,name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s=await f.stat(); if (!s.isFile() || (s.mode & 63)) fail('INVALID_PRIVATE_FILE'); return await f.readFile(); } finally { await f.close(); }
}
try {
  let expected=null,out=null;
  for (let i=2;i<process.argv.length;i++) { const k=process.argv[i],v=process.argv[++i]; if (!v || !['--manifest-sha256','--out'].includes(k)) fail('INVALID_ARGUMENT'); if (k==='--manifest-sha256') { if(expected) fail('DUPLICATE_ARGUMENT'); expected=v; } else { if(out) fail('DUPLICATE_ARGUMENT'); out=v; } }
  const raw=await read('delivery.json'), m=JSON.parse(raw);
  if (expected && expected!==hash(raw)) fail('DELIVERY_MANIFEST_CHANGED');
  if (m.schema!=='tjl.spaceandtime.delivery.v1' || !Array.isArray(m.files)) fail('INVALID_DELIVERY_MANIFEST');
  const names=new Set();
  for (const p of m.files) { if (names.has(p.path)) fail('DUPLICATE_DELIVERY_PATH'); names.add(p.path); const b=await read(p.path); if(b.length!==p.bytes || hash(b)!==p.sha256) fail('DELIVERY_FILE_CHANGED'); }
  if (!names.has('comparison/export.json') || !names.has('comparison/replay.mjs') || !names.has('acquisition/manifest.json')) fail('INCOMPLETE_DELIVERY');
  if (hash(await read('comparison/export.json'))!==m.comparisonManifestSha256 || hash(await read('acquisition/manifest.json'))!==m.acquisitionManifestSha256) fail('DELIVERY_PIN_CONFLICT');
  const args=[join(root,'comparison','replay.mjs'),'--manifest-sha256',m.comparisonManifestSha256]; if(out) args.push('--out',out);
  const child=spawn(process.execPath,args,{stdio:'inherit',env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
  child.once('error',e=>{process.stderr.write(JSON.stringify({error:e.code||'REPLAY_FAILED'})+'\\n');process.exitCode=1});
  child.once('exit',(code,signal)=>{process.exitCode=signal?1:(code??1)});
} catch(error) { process.stderr.write(JSON.stringify({error:error.message})+'\\n');process.exitCode=1; }
`;

async function inventory(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...await inventory(directory, name));
    else if (entry.isFile()) {
      const bytes = await bytesAt(await checkedPath(directory, name), Number.MAX_SAFE_INTEGER);
      files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
    } else fail('INVALID_DELIVERY_FILE');
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function deliver(service, root, jobId, destination) {
  const job = await service.getJob(jobId);
  if (job.state !== 'COMPLETED') fail('REPORT_NOT_READY');
  const relation = await acquisitionLink(root, job.bundleId);
  if (!relation) fail('ACQUISITION_LINK_MISSING', 'This job has no retained acquisition. Export it with the original service operator.');
  const acquisition = join(root, 'acquisitions', relation.manifestSha256);
  const retained = await prepared(acquisition);
  if (retained.manifestSha256 !== relation.manifestSha256) fail('ACQUISITION_LINK_CHANGED');
  const { bundle } = await service.getBundle(job.bundleId);
  for (const key of ['source', 'target', 'spec']) {
    if (bundle[key].sha256 !== retained.manifest[key + '_sha256']) fail('BUNDLE_ACQUISITION_CONFLICT');
  }
  const output = resolve(destination); await privateDirectory(dirname(output));
  await mkdir(output, { mode: 0o700 });
  try {
    await privateDirectory(join(output, 'acquisition'), true);
    await prepared(acquisition, join(output, 'acquisition'));
    const comparison = await service.exportReplay({ jobId, destination: join(output, 'comparison') });
    await atomic(join(output, 'replay.mjs'), Buffer.from(REPLAY), true);
    await atomic(join(output, 'README.txt'), Buffer.from('PRIVATE STELLAR / FINANCE DELIVERY\n\n'
      + 'acquisition/ retains every original response, selected native query, source mapping and prepared CSV.\n'
      + 'comparison/ is the original finance service replay export, with exact report, engine and review records.\n'
      + 'The comparison package includes the private customer HMAC key; use the agreed private delivery route.\n\n'
      + 'Node.js 22+: node replay.mjs --manifest-sha256 SHA_FROM_DELIVERY_RECEIPT\n'
      + 'The runner validates every retained file and invokes the original comparison replay.\n'
      + 'It preserves the delivered report and creates comparison/replayed-report.json.\n'
      + 'For a later replay use --out another-report.json. Exit 0 is matching PASS, 2 is matching discrepancies, 1 is an operation error.\n'), true);
    const manifest = { schema: 'tjl.spaceandtime.delivery.v1', jobId, bundleId: job.bundleId,
      reportSha256: comparison.reportSha256, acquisitionManifestSha256: relation.manifestSha256,
      comparisonManifestSha256: comparison.manifest.sha256, createdAt: new Date().toISOString(),
      files: await inventory(output) };
    const raw = json(manifest); await atomic(join(output, 'delivery.json'), raw, true);
    await syncDirectory(output); await syncDirectory(dirname(output));
    return { ...manifest, files: manifest.files.length + 1, destination: output,
      manifest: { sha256: hash(raw), bytes: raw.length }, reviewCount: comparison.reviewCount,
      command: 'node replay.mjs --manifest-sha256 ' + hash(raw) };
  } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
}

const HELP = `Retained Stellar / finance operator — Node.js 22+, Linux, flock

node finance.mjs COMMAND --directory PRIVATE_CUSTOMER_ROOT [OPTIONS]
  init             [--max-input-bytes N] [--max-report-bytes N] [--timeout-ms N] [--max-heap-mib N]
  stage            --prepared PRIVATE_PREPARED_DIRECTORY
  run / operate    --job-id ID (--prepared DIRECTORY | --bundle-id SHA) [--wait-timeout-ms N] [--poll-ms N]
  status           --job-id ID [--wait] [--wait-timeout-ms N] [--poll-ms N]
  list             [--limit N] [--after ID]
  recover          --job-id ID [--wait]
  cancel           --job-id ID
  report           --job-id ID
  export           --job-id ID --destination NEW_REPORT_FILE
  review           --job-id ID --report-sha256 SHA --reviewer NAME --decision accepted|changes_requested [--note TEXT]
  reviews          --job-id ID
  deliver          --job-id ID --destination NEW_PRIVATE_DIRECTORY
  replay           --destination DELIVERY_DIRECTORY [--manifest-sha256 SHA] [--out NEW_FILENAME]

ERP_RECON_DIRECTORY may supply --directory. Only init creates a new customer root.
stage retains all original acquisition files and stages the original service bundle.
run and operate wait by default; the same job ID with the same acquisition reopens its
original bundle, including after a deployed engine update. A changed input needs a new ID.
operate may also include --destination NEW_PRIVATE_DIRECTORY to deliver the completed
PASS or discrepancy report with its original acquisition and original-service replay.
Exit 0: success/PASS. Exit 2: complete discrepancy report. Exit 1: operation failure.
All output and complete replay exports are private customer material.
`;
const FLAGS = {
  init: ['max-input-bytes', 'max-report-bytes', 'timeout-ms', 'max-heap-mib'],
  stage: ['prepared'], run: ['job-id', 'prepared', 'bundle-id', 'wait-timeout-ms', 'poll-ms'],
  operate: ['job-id', 'prepared', 'bundle-id', 'wait-timeout-ms', 'poll-ms', 'destination'],
  status: ['job-id', 'wait', 'wait-timeout-ms', 'poll-ms'], list: ['limit', 'after'],
  recover: ['job-id', 'wait', 'wait-timeout-ms', 'poll-ms'], cancel: ['job-id'], report: ['job-id'],
  export: ['job-id', 'destination'], review: ['job-id', 'report-sha256', 'reviewer', 'decision', 'note'],
  reviews: ['job-id'], deliver: ['job-id', 'destination'], replay: ['destination', 'manifest-sha256', 'out'],
};
function parse(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const [command, ...args] = argv;
  if (!Object.hasOwn(FLAGS, command ?? '')) fail('INVALID_ARGUMENT', 'Choose a command from --help.');
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i].slice(2);
    if (!args[i].startsWith('--') || !['directory', ...FLAGS[command]].includes(name) || Object.hasOwn(options, name)) fail('INVALID_ARGUMENT');
    if (name === 'wait') options[name] = true;
    else { const value = args[++i]; if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT'); options[name] = value; }
  }
  const require = name => { if (!options[name]) fail('INVALID_ARGUMENT', '--' + name + ' is required.'); };
  if (FLAGS[command].includes('job-id')) require('job-id');
  if (command === 'stage') require('prepared');
  if (['run', 'operate'].includes(command) && Boolean(options.prepared) === Boolean(options['bundle-id'])) fail('INVALID_ARGUMENT', 'Choose --prepared or --bundle-id.');
  if (['export', 'deliver', 'replay'].includes(command)) require('destination');
  if (command === 'review') for (const name of ['report-sha256', 'reviewer', 'decision']) require(name);
  const directory = options.directory ?? process.env.ERP_RECON_DIRECTORY;
  if (command !== 'replay' && !directory) fail('INVALID_ARGUMENT', '--directory or ERP_RECON_DIRECTORY is required.');
  const integer = (name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
    const raw = options[name] ?? String(fallback), value = Number(raw);
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_ARGUMENT', '--' + name + ' is outside its supported range.');
    return value;
  };
  const configuration = directory ? { directory: resolve(directory) } : {};
  for (const [name, key] of [['max-input-bytes', 'maxInputBytes'], ['max-report-bytes', 'maxReportBytes'], ['timeout-ms', 'timeoutMs'], ['max-heap-mib', 'maxHeapMiB']]) {
    if (options[name]) configuration[key] = integer(name, 1);
  }
  const waiting = ['run', 'operate'].includes(command) || options.wait;
  if (!waiting && (options['wait-timeout-ms'] || options['poll-ms'])) fail('INVALID_ARGUMENT', 'Wait options require run, operate or --wait.');
  return { command, options, configuration, waiting, timeout: integer('wait-timeout-ms', 600000, 1, 86400000),
    poll: integer('poll-ms', 500, 50, 60000), limit: integer('limit', 100, 1, 1000) };
}

export async function main(argv = process.argv.slice(2)) {
  const settings = parse(argv);
  if (settings.help) { process.stdout.write(HELP); return 0; }
  const { command, options, configuration } = settings, root = configuration.directory;
  if (command === 'replay') {
    const script = resolve(options.destination, 'replay.mjs');
    await bytesAt(script, 1024 * 1024);
    const args = [script];
    for (const name of ['manifest-sha256', 'out']) if (options[name]) args.push('--' + name, options[name]);
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    return await new Promise((yes, no) => { child.once('error', no); child.once('exit', (code, signal) => yes(signal ? 1 : (code ?? 1))); });
  }
  if (command !== 'init' && !await exists(join(root, 'service.json'))) fail('SERVICE_NOT_INITIALIZED', 'Initialize the intended private customer directory with init first.');
  const { openReconciliationService } = await import('../service/service.mjs');
  const service = await openReconciliationService(configuration);
  const jobId = options['job-id']; let result, job = null;
  if (command === 'init') result = { configuration: service.configuration, directory: root };
  else if (command === 'stage') result = await stage(service, root, options.prepared);
  else if (['run', 'operate'].includes(command)) {
    let existing = null;
    try { existing = await service.getJob(jobId); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let bundleId = options['bundle-id'];
    if (options.prepared && existing) {
      const candidate = await prepared(options.prepared), relation = await acquisitionLink(root, existing.bundleId);
      if (!relation || relation.manifestSha256 !== candidate.manifestSha256) fail('JOB_INPUT_CONFLICT');
      bundleId = existing.bundleId;
    } else if (options.prepared) bundleId = (await stage(service, root, options.prepared)).bundle.bundleId;
    job = await service.execute({ jobId, bundleId });
  } else if (command === 'status') job = await service.getJob(jobId);
  else if (command === 'recover') job = await service.recover(jobId);
  else if (command === 'cancel') result = await service.cancel(jobId);
  else if (command === 'list') result = await service.listJobs({ limit: settings.limit, ...(options.after ? { after: options.after } : {}) });
  else if (command === 'report') { process.stdout.write(await report(service, jobId)); return outcome(await service.getJob(jobId)); }
  else if (command === 'export') result = await service.exportReport({ jobId, destination: resolve(options.destination) });
  else if (command === 'review') result = await service.review({ jobId, reportSha256: options['report-sha256'].toLowerCase(),
    reviewer: options.reviewer, decision: options.decision, note: options.note ?? '' });
  else if (command === 'reviews') result = await service.getReviews(jobId);
  else if (command === 'deliver') result = await deliver(service, root, jobId, options.destination);
  if (job) {
    if (settings.waiting) job = await waitFor(service, job, settings.timeout, settings.poll);
    result = { job, acquisition: await acquisitionLink(root, job.bundleId) };
    if (command === 'operate' && options.destination && job.state === 'COMPLETED') result.delivery = await deliver(service, root, jobId, options.destination);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return job ? (job.operatorWait?.timedOut ? 1 : outcome(job)) : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'OPERATION_FAILED',
      message: error.code && !['ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ELOOP'].includes(error.code) ? error.message :
        'Check the selected private root, original input and new destination. Existing retained work is unchanged.' } }) + '\n');
    process.exitCode = 1;
  });
}
