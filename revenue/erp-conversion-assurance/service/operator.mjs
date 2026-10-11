#!/usr/bin/env node
import { resolve, join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

const HELP = `ERP reconciliation operator — Node.js 22+

Usage:
  node operator.mjs COMMAND --directory PRIVATE_CUSTOMER_ROOT [OPTIONS]
  node operator.mjs --help

Set ERP_RECON_DIRECTORY instead of repeating --directory.

Commands:
  init      [--max-input-bytes N] [--max-report-bytes N]
            [--timeout-ms N] [--max-heap-mib N]
  config
  stage     --source FILE --target FILE --spec FILE
  submit    --job-id ID --bundle-id ID [--wait]
  run       --job-id ID (--bundle-id ID | --source FILE --target FILE --spec FILE)
  list      [--limit N] [--after CURSOR]
  status    --job-id ID [--wait]
  cancel    --job-id ID
  recover   --job-id ID [--wait]
  export    --job-id ID --destination PRIVATE_REPORT_FILE
  export-replay --job-id ID --destination NEW_PRIVATE_DIRECTORY
  review    --job-id ID --report-sha256 SHA256 --reviewer NAME
            --decision accepted|changes_requested [--note TEXT]
  reviews   --job-id ID

Waiting:
  run waits by default. submit, status and recover wait with --wait.
  --wait-timeout-ms N  Operator wait limit; default 600000 ms.
  --poll-ms N          Poll interval; default 500 ms, minimum 50 ms.
  Reaching the wait limit leaves the retained job available to status.

Output is private JSON. Completed PASS exits 0; completed comparison FAIL exits
2; malformed input, failed/interrupted/cancelled jobs and wait timeout exit 1.
Accepted pending submissions and successful management commands exit 0.
Export creates a new report file. Review decisions bind to its exact SHA-256.
export-replay creates a complete private package with inputs, engine and HMAC key.
`;

const COMMON = ['directory'];
const WAIT = ['wait-timeout-ms', 'poll-ms'];
const OPTIONS = {
  init: ['max-input-bytes', 'max-report-bytes', 'timeout-ms', 'max-heap-mib'],
  config: [],
  stage: ['source', 'target', 'spec'],
  submit: ['job-id', 'bundle-id', 'wait', ...WAIT],
  run: ['job-id', 'bundle-id', 'source', 'target', 'spec', ...WAIT],
  list: ['limit', 'after'],
  status: ['job-id', 'wait', ...WAIT],
  cancel: ['job-id'],
  recover: ['job-id', 'wait', ...WAIT],
  export: ['job-id', 'destination'],
  'export-replay': ['job-id', 'destination'],
  review: ['job-id', 'report-sha256', 'reviewer', 'decision', 'note'],
  reviews: ['job-id'],
};
const FINAL = new Set(['COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
const ACTIVE = new Set(['QUEUED', 'RUNNING']);

class OperatorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function usage(message) {
  throw new OperatorError('INVALID_ARGUMENT', `${message} Use --help for commands.`);
}

function positiveInteger(raw, flag, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^[1-9][0-9]*$/.test(raw ?? '')) usage(`--${flag} must be a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    usage(`--${flag} must be between ${min} and ${max}.`);
  }
  return value;
}

function parse(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const [command, ...args] = argv;
  if (!Object.hasOwn(OPTIONS, command ?? '')) usage('Choose a supported command.');
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const allowed = new Set([...COMMON, ...OPTIONS[command]]);
  const options = Object.create(null);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--') || arg.length < 3) usage(`Unexpected argument ${arg}.`);
    const key = arg.slice(2);
    if (!allowed.has(key)) usage(`Unknown option --${key} for ${command}.`);
    if (Object.hasOwn(options, key)) usage(`Duplicate option --${key}.`);
    if (key === 'wait') {
      options[key] = true;
    } else {
      const value = args[++index];
      if (value === undefined || value.startsWith('--') || value.length === 0) {
        usage(`--${key} requires a value.`);
      }
      options[key] = value;
    }
  }
  const required = (key) => {
    if (typeof options[key] !== 'string' || !options[key].trim()) usage(`--${key} is required.`);
    return options[key];
  };
  const directory = options.directory ?? process.env.ERP_RECON_DIRECTORY;
  if (typeof directory !== 'string' || !directory.trim()) {
    usage('--directory or ERP_RECON_DIRECTORY is required.');
  }
  if (['submit', 'run', 'status', 'cancel', 'recover', 'export', 'export-replay', 'review', 'reviews'].includes(command)) {
    required('job-id');
  }
  if (command === 'submit') required('bundle-id');
  if (command === 'stage' || (command === 'run' && !options['bundle-id'])) {
    required('source'); required('target'); required('spec');
  }
  if (command === 'run' && options['bundle-id'] && ['source', 'target', 'spec'].some(key => options[key])) {
    usage('run accepts either --bundle-id or the three input files.');
  }
  if (command === 'export' || command === 'export-replay') required('destination');
  if (command === 'review') {
    required('reviewer'); required('decision'); required('report-sha256');
    if (!['accepted', 'changes_requested'].includes(options.decision)) {
      usage('--decision must be accepted or changes_requested.');
    }
    if (!/^[a-fA-F0-9]{64}$/.test(options['report-sha256'])) {
      usage('--report-sha256 must be a complete SHA-256 digest.');
    }
  }
  const waiting = command === 'run' || options.wait === true;
  if (!waiting && WAIT.some(key => Object.hasOwn(options, key))) {
    usage('Wait options require run or --wait.');
  }
  const waitTimeoutMs = positiveInteger(options['wait-timeout-ms'] ?? '600000', 'wait-timeout-ms', { max: 86400000 });
  const pollMs = positiveInteger(options['poll-ms'] ?? '500', 'poll-ms', { min: 50, max: 60000 });
  const configuration = { directory: resolve(directory) };
  for (const [flag, key] of [
    ['max-input-bytes', 'maxInputBytes'], ['max-report-bytes', 'maxReportBytes'],
    ['timeout-ms', 'timeoutMs'], ['max-heap-mib', 'maxHeapMiB'],
  ]) {
    if (options[flag] !== undefined) configuration[key] = positiveInteger(options[flag], flag);
  }
  const limit = options.limit === undefined ? 100 : positiveInteger(options.limit, 'limit', { max: 1000 });
  return { command, options, configuration, waiting, waitTimeoutMs, pollMs, limit };
}

function outcome(job) {
  if (job?.state === 'COMPLETED') {
    if (job.result?.status === 'PASS') return 0;
    if (job.result?.status === 'FAIL') return 2;
    throw new OperatorError('INVALID_JOB_RESULT', 'Completed job has no recognized comparison result.');
  }
  if (['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(job?.state)) return 1;
  if (ACTIVE.has(job?.state)) return 0;
  throw new OperatorError('INVALID_JOB_STATE', 'Service returned an unrecognized job state.');
}

async function waitForJob(service, initial, settings) {
  let job = initial;
  const started = performance.now();
  while (!FINAL.has(job?.state)) {
    outcome(job);
    const remaining = settings.waitTimeoutMs - (performance.now() - started);
    if (remaining <= 0) {
      return { ...job, operatorWait: { timedOut: true, elapsedMs: Math.round(performance.now() - started) } };
    }
    await delay(Math.min(settings.pollMs, remaining));
    job = await service.getJob(job.jobId);
  }
  return job;
}

async function stage(service, options) {
  return service.stageBundle({
    source: resolve(options.source),
    target: resolve(options.target),
    spec: resolve(options.spec),
  });
}

async function run(argv) {
  const settings = parse(argv);
  if (settings.help) { process.stdout.write(HELP); return 0; }
  if (settings.command !== 'init') {
    try {
      const config = await lstat(join(settings.configuration.directory, 'service.json'));
      if (!config.isFile() || config.isSymbolicLink()) {
        throw new OperatorError('INVALID_SERVICE_CONFIGURATION', 'Customer configuration must be a regular private file.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new OperatorError('SERVICE_NOT_INITIALIZED', 'Initialize this private customer root with init before using it.');
    }
  }
  const { openReconciliationService } = await import('./service.mjs');
  const service = await openReconciliationService(settings.configuration);
  const { command, options } = settings;
  const jobId = options['job-id'];
  let result;
  let isJob = false;
  switch (command) {
    case 'init':
    case 'config': result = { ...service.configuration, directory: settings.configuration.directory }; break;
    case 'stage': result = await stage(service, options); break;
    case 'submit':
    case 'run': {
      const bundleId = options['bundle-id'] ?? (await stage(service, options)).bundleId;
      result = await service.execute({ jobId, bundleId });
      isJob = true;
      break;
    }
    case 'list': result = await service.listJobs({ limit: settings.limit, ...(options.after ? { after: options.after } : {}) }); break;
    case 'status': result = await service.getJob(jobId); isJob = true; break;
    case 'recover': result = await service.recover(jobId); isJob = true; break;
    case 'cancel': result = await service.cancel(jobId); break;
    case 'export': result = await service.exportReport({ jobId, destination: resolve(options.destination) }); break;
    case 'export-replay': result = await service.exportReplay({ jobId, destination: resolve(options.destination) }); break;
    case 'review': result = await service.review({
      jobId,
      reportSha256: options['report-sha256'].toLowerCase(),
      reviewer: options.reviewer,
      decision: options.decision,
      note: options.note ?? '',
    }); break;
    case 'reviews': result = await service.getReviews(jobId); break;
  }
  if (isJob && settings.waiting) result = await waitForJob(service, result, settings);
  const exitCode = isJob ? (result.operatorWait?.timedOut ? 1 : outcome(result)) : 0;
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return exitCode;
}

const ERROR_MESSAGES = {
  ENOENT: 'A required input, job or destination directory was not found. Check the selected customer root and command arguments.',
  EEXIST: 'The destination already exists. Choose a new export destination.',
  EACCES: 'The operating-system account cannot access a required private file or directory.',
  EPERM: 'The operating-system account does not permit this filesystem operation.',
  ELOOP: 'A filesystem input uses a symbolic link where a regular private file is required.',
  ENOSPC: 'The customer storage filesystem has no space for the complete operation.',
  PRIVATE_DIRECTORY_REQUIRED: 'Use a directory owned by this operating-system account with permissions 0700.',
  INVALID_PRIVATE_FILE: 'A retained file is unreadable, has unsafe permissions, or exceeds the configured size limit.',
  INVALID_LIMIT: 'Limits must be positive whole numbers; the Node heap limit must be at least 64 MiB.',
  SERVICE_CONFIGURATION_MISMATCH: 'This customer root has different saved limits. Use config to read them or initialize a separate root with the desired limits.',
  INVALID_JOB_ID: 'Job IDs must start with a letter or digit and use at most 96 letters, digits, dots, underscores or hyphens.',
  INVALID_BUNDLE_ID: 'Bundle IDs must be the complete lowercase SHA-256 digest returned by stage.',
  INPUT_LIMIT_EXCEEDED: 'An input is not a regular file or exceeds the complete-file limit. The input was not truncated.',
  INPUT_CHANGED_DURING_IMPORT: 'An input changed while staging. Finish writing the export, then stage it again.',
  BUNDLE_CHANGED: 'Retained inputs no longer match the staged bundle hashes.',
  JOB_INPUT_CONFLICT: 'This job ID is already bound to another bundle. Use the retained bundle or a new job ID.',
  REPORT_NOT_READY: 'The job has no completed report to export or review. Read status first.',
  REPORT_CHANGED: 'The retained report no longer matches its recorded hash and byte count.',
  REVIEW_REPORT_CONFLICT: 'The reviewer digest differs from this job’s exact completed report.',
  INVALID_REVIEW: 'Provide a reviewer of at most 200 characters, an accepted or changes_requested decision, and a note of at most 4000 characters.',
  RECOVERY_NOT_REQUIRED: 'The retained job does not currently require recovery. Read status or resubmit its existing job and bundle IDs.',
  ENGINE_CHANGED: 'The job request and retained engine snapshot disagree. Preserve the customer root and inspect the retained bundle.',
  HMAC_KEY_CHANGED: 'The private customer HMAC key differs from its saved configuration digest.',
  FLEET_STATE_ALREADY_OWNED: 'This customer root has a live worker. Read status and recover after that worker exits.',
  FLEET_LINUX_FLOCK_REQUIRED: 'Run the service on Linux with the util-linux flock command available in PATH.',
  FLEET_STATE_LEASE_FAILED: 'The host could not acquire the customer worker lease. Check Linux flock availability and private directory access.',
};

run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  const code = typeof error?.code === 'string' ? error.code :
    (typeof error?.message === 'string' && Object.hasOwn(ERROR_MESSAGES, error.message) ? error.message : 'OPERATION_FAILED');
  const message = error instanceof OperatorError ? error.message :
    ERROR_MESSAGES[code] ?? 'The service could not complete the operation. The error code identifies the failed step.';
  process.stderr.write(JSON.stringify({ schema: 'erp-reconciliation.operator-error.v1', error: { code, message } }, null, 2) + '\n');
  process.exitCode = 1;
});
