#!/usr/bin/env node
// MIT. Receive a complete Worklogs preparation into the original conversion app.
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openReconciliationService } from '../../service/service.mjs';
import { createConversionWorkspace } from '../../scap-workspace/model.mjs';
import { draftFromSpec } from '../../scap-workspace/mapping.mjs';

const HELP = `Receive Worklogs invoice preparation - Node.js 22+ and Linux flock

node receive.mjs --prepared COMPLETE_PREPARATION_DIRECTORY \\
  --directory PRIVATE_CUSTOMER_DIRECTORY --job-id ORIGINAL_JOB_ID
  [--previous-job-id ORIGINAL_PRECEDING_JOB --correction-reason REASON]

The original service keeps the source, target, mapping, report and reviews.
Reusing an unchanged job reopens it. Corrections require a new job ID and retain
the preceding job. Keep the complete preparation directory with the customer
delivery; it contains the original workbook, invoice, contract and time lineage.
Completed comparison PASS exits 0, completed comparison FAIL exits 2.
A running job after 60 seconds remains available to the original operator.
`;
const SHA = /^[a-f0-9]{64}$/;
const JOB = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const hash = data => createHash('sha256').update(data).digest('hex');
const need = (yes, message) => { if (!yes) throw new Error(message); };

async function preparedDirectory(directory) {
  const path = resolve(directory);
  const manifestPath = join(path, 'preparation.json');
  const manifestStat = await lstat(manifestPath);
  need(manifestStat.isFile() && manifestStat.size <= 256 * 1024, 'Choose a complete preparation manifest.');
  const raw = await readFile(manifestPath), manifest = JSON.parse(raw);
  need(manifest.schema === 'worklogs-invoice-preparation.v1' && Array.isArray(manifest.files), 'Unsupported preparation manifest.');
  const files = new Map();
  let total = 0;
  for (const item of manifest.files) {
    need(typeof item.path === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(item.path)
      && !files.has(item.path) && Number.isSafeInteger(item.bytes) && item.bytes >= 0
      && item.bytes <= 32 * 1024 * 1024 && SHA.test(item.sha256), 'Invalid preparation inventory.');
    total += item.bytes;
    need(total <= 100 * 1024 * 1024, 'The preparation exceeds the complete intake limit.');
    const file = join(path, item.path), status = await lstat(file);
    need(status.isFile() && status.size === item.bytes, 'Prepared file identity changed: ' + item.path);
    const bytes = await readFile(file);
    need(bytes.length === item.bytes && hash(bytes) === item.sha256, 'Prepared file identity changed: ' + item.path);
    files.set(item.path, bytes);
  }
  for (const name of ['expected-invoice-lines.csv', 'actual-invoice-lines.csv', 'spec.json', 'workspace-profile.json',
    'contract.json', 'worklog-lineage.csv', 'worklog-coverage.csv', 'nonbillable-time.csv', 'prepare.py'])
    need(files.has(name), 'Missing prepared file: ' + name);
  need([...files.keys()].some(n => /^original-worklogs\.(csv|xlsx)$/.test(n))
    && [...files.keys()].some(n => /^original-invoices\.(csv|xlsx)$/.test(n)), 'Complete original exports are required.');
  return { path, manifest, manifestSha256: hash(raw), files,
    spec: JSON.parse(files.get('spec.json')), profile: JSON.parse(files.get('workspace-profile.json')) };
}

export async function receive({ prepared, directory, jobId, previousJobId, correctionReason = '' }) {
  need(JOB.test(jobId ?? ''), 'Choose an original job ID.');
  need(!previousJobId || (JOB.test(previousJobId) && previousJobId !== jobId), 'Choose a different preceding job ID.');
  need(Boolean(previousJobId) === Boolean(correctionReason.trim()), 'A correction needs both its preceding job and reason.');
  const input = await preparedDirectory(prepared);
  const service = await openReconciliationService({ directory: resolve(directory) });
  const pin = { schema: 'worklogs-invoice-receiving.v1', manifestSha256: input.manifestSha256,
    period: input.manifest.period, currency: input.manifest.currency, billing: input.manifest.billing,
    originalFiles: input.manifest.files.filter(f => f.path.startsWith('original-') || f.path === 'contract.json'),
    lineage: input.manifest.files.find(f => f.path === 'worklog-lineage.csv') };
  const workspace = createConversionWorkspace({ service, profile: input.profile,
    extension: { compileSpec: ({ spec }) => ({ ...spec, worklogsPreparation: pin }) } });
  let original;
  try { original = await service.getJob(jobId); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (original) {
    const old = await service.getBundle(original.bundleId);
    need(old.spec.worklogsPreparation?.manifestSha256 === input.manifestSha256
      && (old.spec.workspace?.previous?.jobId ?? '') === (previousJobId ?? '')
      && (old.spec.workspace?.correctionReason ?? '') === correctionReason,
      'The job already belongs to another preparation. Reopen it or choose a new correction job.');
  } else {
    let previous = null;
    if (previousJobId) {
      previous = await service.getJob(previousJobId);
      const old = await service.getBundle(previous.bundleId);
      need(old.spec.worklogsPreparation?.period === input.manifest.period
        && old.spec.worklogsPreparation?.currency === input.manifest.currency,
        'A correction must keep the original period and currency; receive a new period as a new run.');
    }
    const draft = draftFromSpec(input.spec, input.profile);
    draft.scope = { conversionOwner: input.manifest.billing_owner,
      period: input.manifest.period,
      sourceSystem: 'Original Worklogs export and approved rate contract',
      targetSystem: 'Original customer invoice export',
      coverage: 'Complete selected period; all worklogs retained in the preparation. Compare approved billable seconds and net invoice lines by customer, currency, period and service.',
      excludedHistory: 'Periods outside ' + input.manifest.period + ' use their own complete preparation.',
      resources: 'Original files, billing contract and physical row lineage retained with preparation manifest ' + input.manifestSha256,
      timeline: 'Review exceptions, receive a linked correction as required, then retain the named invoice owner decision and operator handover.' };
    draft.correctionReason = correctionReason;
    const staged = await workspace.stage({ draft,
      ...(previous ? { baseBundleId: previous.bundleId, previousJobId } : {}),
      source: { name: 'expected-invoice-lines.csv', bytes: input.files.get('expected-invoice-lines.csv') },
      target: { name: 'actual-invoice-lines.csv', bytes: input.files.get('actual-invoice-lines.csv') } });
    original = await workspace.execute({ jobId, bundleId: staged.bundle.bundleId });
  }
  const until = Date.now() + 60000;
  while (['QUEUED', 'RUNNING'].includes(original.state) && Date.now() < until) {
    await delay(150);
    original = await service.getJob(jobId);
  }
  const detail = await workspace.getJob(jobId);
  workspace.close();
  return { preparationDirectory: input.path, manifestSha256: input.manifestSha256,
    job: detail.job, mappingRevision: detail.workspace.revision,
    previous: detail.workspace.previous ?? null, comparison: detail.comparison,
    reviews: detail.reviews };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return 0; }
  const options = {}, names = new Map([['--prepared', 'prepared'], ['--directory', 'directory'], ['--job-id', 'jobId'],
    ['--previous-job-id', 'previousJobId'], ['--correction-reason', 'correctionReason']]);
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]), value = args[i + 1];
    need(name && typeof value === 'string' && value.length && !value.startsWith('--') && !Object.hasOwn(options, name), 'Invalid or repeated receiving argument.');
    options[name] = value;
  }
  need(options.prepared && options.directory && options.jobId, 'Supply --prepared, --directory and --job-id.');
  const result = await receive(options);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.job.state === 'COMPLETED') return result.comparison.status === 'PASS' ? 0 : 2;
  return ['QUEUED', 'RUNNING'].includes(result.job.state) ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'WORKLOGS_RECEIVING_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
