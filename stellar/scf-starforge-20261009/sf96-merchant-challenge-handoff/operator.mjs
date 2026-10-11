// MIT — Direct merchant onboarding composed from the original capture, handoff and buyer.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { inspectBytes } from '../sf84-mpp-market-intake/inspect.mjs';
import { parseArgs as captureOptions, run as captureOriginal } from '../sf85-live-402-capture/capture.mjs';
import { create as createHandoff, derive, verify as verifyHandoff } from './handoff.mjs';
import { initializeQueue, openQueue, saveQueueReport } from '../sf88-operator-buyer-cli/queue.mjs';
import { renderQueueReport } from '../sf88-operator-buyer-cli/queue-report.mjs';
import { NETWORKS } from '../sf86-rpc-transfer-reconcile/terms.mjs';

const SCHEMA = 'scf.sf96.operator-pilot.v1';
const HASH = /^[a-f0-9]{64}$/;
const INTENT = /^[A-Za-z0-9._:-]{1,128}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const queueCli = fileURLToPath(new URL('../sf88-operator-buyer-cli/queue-cli.mjs', import.meta.url));
const buyerCli = fileURLToPath(new URL('../sf88-operator-buyer-cli/cli.mjs', import.meta.url));
const thisCli = fileURLToPath(new URL('./operator-cli.mjs', import.meta.url));
const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[c]));

export class PilotError extends Error {
  constructor(code) { super(code); this.name = 'PilotError'; this.code = code; }
}
function need(ok, code) { if (!ok) throw new PilotError(code); }
function path(value) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'), 'PILOT_ABSOLUTE_PATH_REQUIRED');
  return resolve(value);
}
function ownPrivate(info) {
  return (info.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid());
}
async function privateDirectory(directory) {
  const info = await lstat(directory);
  need(info.isDirectory() && !info.isSymbolicLink() && ownPrivate(info) &&
    await realpath(directory) === directory, 'PILOT_PRIVATE_REAL_DIRECTORY_REQUIRED');
  return info;
}
async function readBytes(filename, limit = 65536, privateOnly = true) {
  const handle = await open(path(filename), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size <= limit && (!privateOnly || ownPrivate(info)), 'PILOT_FILE_INVALID');
    const bytes = await handle.readFile();
    need(bytes.length > 0 && bytes.length <= limit, 'PILOT_FILE_SIZE_INVALID');
    return bytes;
  } finally { await handle.close(); }
}
async function jsonFile(filename) {
  const bytes = await readBytes(filename);
  try { return {bytes, value:JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes))}; }
  catch { throw new PilotError('PILOT_JSON_INVALID'); }
}
async function writeNew(filename, bytes) {
  const handle = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
function flags(args, allowed) {
  need(Array.isArray(args) && args.length % 2 === 0, 'PILOT_ARGUMENT_VALUE_REQUIRED');
  const result = new Map();
  for (let i = 0; i < args.length; i += 2) {
    need(allowed.includes(args[i]) && !result.has(args[i]) &&
      typeof args[i + 1] === 'string' && args[i + 1].length > 0,
      'PILOT_ARGUMENT_INVALID_OR_REPEATED');
    result.set(args[i], args[i + 1]);
  }
  return result;
}
function required(options, keys) {
  need(keys.every(key => options.has(key)), 'PILOT_REQUIRED_ARGUMENT_MISSING');
}
async function workspaceModule() {
  // The earlier SF88 workspace remains the sole initializer and custody loader.
  return import('../sf88-operator-buyer-cli/workspace.mjs');
}

/** One original unsigned acquisition. Its existing allow-origin and transport rules apply. */
export async function observe(args) {
  const options = captureOptions(args);
  const result = await captureOriginal(args);
  const bytes = await readBytes(options.out, 262144);
  const original = inspectBytes(bytes);
  return {...result, originalOffer:original.x402.offer ?? null,
    next:'Select an original exact Stellar offer index, inspect its network and choose an explicit atomic ceiling for prepare'};
}

/** Prepare a new private pilot; this performs no HTTP, approval, signing or payment. */
export async function prepare(args, {environment = process.env} = {}) {
  const workspaceFlags = ['--actor','--service','--payer','--python','--secret-env',
    '--total-atomic','--daily-atomic','--signer-provider','--rpc','--https-proxy','--https-proxy-env'];
  const opt = flags(args, ['--capture','--handoff','--offer-index','--intent-id','--max-atomic',
    '--headers-file','--dir','--max-response-bytes','--response-timeout-ms', ...workspaceFlags]);
  required(opt, ['--dir','--actor','--service','--payer','--python']);
  need(opt.has('--capture') !== opt.has('--handoff'), 'PILOT_ONE_SOURCE_REQUIRED');
  const directory = path(opt.get('--dir'));
  await privateDirectory(dirname(directory));
  let source, selection, headersSource;
  if (opt.has('--handoff')) {
    need(!['--offer-index','--intent-id','--max-atomic','--headers-file'].some(key => opt.has(key)),
      'PILOT_EXISTING_HANDOFF_SELECTION_IS_FIXED');
    const original = path(opt.get('--handoff'));
    const verified = await verifyHandoff(original);
    source = join(original, 'original-capture.json');
    if (verified.sourceAcquisition) headersSource = join(original, 'original-response.headers');
    selection = (await jsonFile(join(original, 'selection.json'))).value;
  } else {
    required(opt, ['--offer-index','--intent-id','--max-atomic']);
    const index = opt.get('--offer-index');
    need(/^(0|[1-9][0-9]*)$/.test(index) && Number.isSafeInteger(Number(index)),
      'PILOT_EXPLICIT_OFFER_INDEX_REQUIRED');
    source = path(opt.get('--capture'));
    if (opt.has('--headers-file')) headersSource = path(opt.get('--headers-file'));
    selection = {offerIndex:Number(index), intentId:opt.get('--intent-id'), maxAtomic:opt.get('--max-atomic')};
  }
  // Derive from the original bytes before creating any operator state.
  const raw = await readBytes(source, 262144, false);
  const originalHeaders = headersSource === undefined ? undefined : await readBytes(headersSource, 65536, false);
  const derived = derive(raw, {index:selection.offerIndex, intentId:selection.intentId,
    maxAtomic:selection.maxAtomic, originalHeaders});
  need(Object.hasOwn(NETWORKS, derived.config.operation.expect.network), 'PILOT_STELLAR_NETWORK_REQUIRED');
  const maximum = opt.has('--max-response-bytes') ? Number(opt.get('--max-response-bytes')) : 64 * 1024 * 1024;
  const timeout = opt.has('--response-timeout-ms') ? Number(opt.get('--response-timeout-ms')) : 30000;
  need(Number.isSafeInteger(maximum) && maximum >= 1 &&
    Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= 2147483647, 'PILOT_RESPONSE_LIMIT_INVALID');
  const {initializeWorkspace} = await workspaceModule();
  let created, published = false;
  try {
    await mkdir(directory, {mode:0o700});
    created = await privateDirectory(directory);
    // A private immutable source snapshot makes the result independent of the caller's path.
    const capturePath = join(directory, 'intake-capture.json');
    await writeNew(capturePath, raw);
    const headersPath = originalHeaders === undefined ? undefined : join(directory, 'intake-response.headers');
    if (headersPath) await writeNew(headersPath, originalHeaders);
    const handoff = await createHandoff({capturePath, outDir:join(directory, 'handoff'),
      index:selection.offerIndex, intentId:selection.intentId, maxAtomic:selection.maxAtomic, headersPath});
    await unlink(capturePath); // The original handoff now owns these exact bytes.
    if (headersPath) await unlink(headersPath);
    await mkdir(join(directory, 'delivery'), {mode:0o700});
    const review = {...derived.config, responseFile:{destination:join(directory, 'delivery', 'response.bin'),
      maxBytes:maximum, timeoutMs:timeout}};
    const reviewPath = join(directory, 'review-config.json');
    await writeNew(reviewPath, encode(review));
    const setupArgs = ['--config', reviewPath, '--dir', join(directory, 'operator')];
    for (const key of workspaceFlags) if (opt.has(key)) setupArgs.push(key, opt.get(key));
    const workspace = await initializeWorkspace(setupArgs, {environment});
    await initializeQueue(join(directory, 'inbox'));
    const queue = await openQueue(join(directory, 'inbox'));
    const queued = await queue.enqueue(workspace.config);
    const executionBytes = await readBytes(workspace.config);
    const manifest = {schema:SCHEMA, directory, createdAt:new Date().toISOString(),
      intentId:selection.intentId, payer:workspace.payer,
      originalCaptureSha256:handoff.originalCaptureSha256,
      selectedOfferSha256:handoff.selectedOfferSha256,
      operatorConfigSha256:sha(executionBytes), queueConfigSha256:queued.configSha256};
    // No second execution state: the existing queue owns every attempt and recovery.
    await writeNew(join(directory, 'pilot.json'), encode(manifest));
    published = true;
    await syncDirectory(directory);
    return await show(directory);
  } catch (error) {
    // Initialization cannot execute a buyer. Only remove our newly created partial tree.
    if (created && !published) {
      const current = await lstat(directory).catch(() => null);
      if (current?.dev === created.dev && current?.ino === created.ino)
        await rm(directory, {recursive:true, force:true}).catch(() => {});
    }
    throw error;
  }
}

async function openPilot(input) {
  const directory = path(input);
  await privateDirectory(directory);
  const {value:manifest} = await jsonFile(join(directory, 'pilot.json'));
  need(plain(manifest) && manifest.schema === SCHEMA && manifest.directory === directory &&
    typeof manifest.intentId === 'string' && INTENT.test(manifest.intentId) &&
    ['originalCaptureSha256','selectedOfferSha256','operatorConfigSha256','queueConfigSha256']
      .every(key => typeof manifest[key] === 'string' && HASH.test(manifest[key])), 'PILOT_MANIFEST_INVALID');
  const handoff = await verifyHandoff(join(directory, 'handoff'));
  need(handoff.intentId === manifest.intentId && handoff.sourceSha256 === manifest.originalCaptureSha256 &&
    handoff.selectedOfferSha256 === manifest.selectedOfferSha256, 'PILOT_ORIGINAL_HANDOFF_CHANGED');
  const selected = (await jsonFile(join(directory, 'handoff', 'selection.json'))).value;
  const handoffConfig = (await jsonFile(handoff.config)).value;
  const {openWorkspace} = await workspaceModule();
  const operator = await openWorkspace(['--dir', join(directory, 'operator')]);
  const configured = await readBytes(operator.configPath);
  need(sha(configured) === manifest.operatorConfigSha256 &&
    operator.config.trustedPayer === manifest.payer &&
    isDeepStrictEqual(operator.config.operation, handoffConfig.operation), 'PILOT_OPERATOR_SOURCE_CHANGED');
  const queue = await openQueue(join(directory, 'inbox'));
  const job = await queue.show(manifest.intentId);
  need(job.sourceConfigSha256 === manifest.operatorConfigSha256 &&
    job.configSha256 === manifest.queueConfigSha256 &&
    isDeepStrictEqual(job.operation, operator.config.operation), 'PILOT_QUEUE_SOURCE_CHANGED');
  return {directory, manifest, selected, operator, queue, job};
}
function view({directory, manifest, selected, operator, job}) {
  const command = verb => [process.execPath, thisCli, verb, '--dir', directory];
  return {schema:SCHEMA, directory, intentId:manifest.intentId,
    source:{captureSha256:manifest.originalCaptureSha256, selectedOfferSha256:manifest.selectedOfferSha256,
      capturedAt:selected.originalCaptureAtUtc, offerIndex:selected.offerIndex,
      captureSource:selected.sourceAcquisition?.method ?? 'original-sf85-https-capture',
      importedAt:selected.sourceAcquisition?.importedAtUtc ?? null,
      sourceHeaderSha256:selected.sourceAcquisition?.sourceHeaderSha256 ?? null,
      requestMethodSource:selected.sourceAcquisition?.requestMethodSource ?? 'original-request',
      network:selected.network, asset:selected.asset, recipient:selected.recipient,
      quotedAtomic:selected.quotedAtomic, maxAtomic:selected.maxAtomic,
      originalMethod:selected.originalMethod, originalResourceUrl:selected.originalResourceUrl},
    operator:{network:operator.manifest.network, payer:operator.manifest.payer,
      rpcOrigin:new URL(operator.manifest.signer.rpcUrl).origin,
      signerSource:operator.manifest.signerProvider === undefined ? 'ENVIRONMENT' : 'TRUSTED_SEP43_PROVIDER'},
    // The original result includes distinct HTTP, settlement, reconciliation and file outcomes.
    buyer:job,
    commands:{review:command('review'), diagnose:command('diagnose'), show:command('show'),
      ...(job.state === 'QUEUED' ? {execute:command('execute'), cancel:command('cancel')} : {}),
      ...(job.attempt?.kind === 'EXECUTE' ? {recover:command('recover'), finalize:command('finalize')} : {}),
      report:[...command('report'), '--out', join(directory, 'operator-report.html')]},
    retry:'NO_AUTOMATIC_RETRY'};
}

/** Reopen source and original queue after a restart. Does not read operator keys. */
export async function show(directory) { return view(await openPilot(directory)); }

function runChild(args, {environment = process.env, signal, quiet = false} = {}) {
  need(signal === undefined || signal instanceof AbortSignal, 'PILOT_ABORT_SIGNAL_INVALID');
  need(!signal?.aborted, 'PILOT_OPERATOR_ABORTED');
  return new Promise((accept, reject) => {
    let child;
    try { child = spawn(process.execPath, args, {shell:false, env:environment,
      stdio:['inherit', quiet ? 'ignore' : 'inherit', 'inherit']}); }
    catch { reject(new PilotError('PILOT_ORIGINAL_COMMAND_START_FAILED')); return; }
    const abort = () => child.kill(signal.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    signal?.addEventListener('abort', abort, {once:true});
    const cleanup = () => signal?.removeEventListener('abort', abort);
    child.once('error', () => {cleanup(); reject(new PilotError('PILOT_ORIGINAL_COMMAND_START_FAILED'));});
    child.once('close', (code, stopped) => {cleanup(); accept({exitCode:code, signal:stopped});});
    if (signal?.aborted) abort();
  });
}

/** Display the ORIGINAL current SF88 workspace review, preceded by original source context. */
export async function review(directory, options = {}) {
  const pilot = await openPilot(directory);
  return runChild([buyerCli, '--review-workspace', '--dir', join(pilot.directory, 'operator')], options);
}

/** Reuse the original setup diagnostics without opening a wallet or claiming an attempt. */
export async function diagnose(directory, {environment = process.env} = {}) {
  const pilot = await openPilot(directory);
  const {diagnoseWorkspace} = await workspaceModule();
  return {...view(pilot), diagnostics:await diagnoseWorkspace(
    ['--dir', join(pilot.directory, 'operator')], {environment})};
}

/** Execute through the existing queue in a fresh process with its native workspace prerequisite. */
export async function execute(directory, {environment = process.env, signal} = {}) {
  const pilot = await openPilot(directory);
  need(pilot.job.state === 'QUEUED', 'PILOT_ORIGINAL_ATTEMPT_ALREADY_RECORDED');
  // Original --workspace binds custody and checks prerequisites before attempt.json.
  // SF81 prompts through /dev/tty; the original queue persists its own stdout summary.
  // The parent never reads the workspace keys or mutates process.env.
  const command = await runChild([queueCli, 'execute', '--root', pilot.queue.root,
    '--intent', pilot.manifest.intentId, '--workspace', join(pilot.directory, 'operator')],
    {environment, signal, quiet:true});
  return {...await show(directory), originalCommand:command};
}

/** Finish the existing request's original accounting; the shared finalizer owns all effects. */
export async function finalize(directory, {environment = process.env, signal} = {}) {
  const pilot = await openPilot(directory);
  need(pilot.job.attempt?.kind === 'EXECUTE', 'PILOT_ORIGINAL_EXECUTION_REQUIRED');
  const command = await runChild([queueCli, 'finalize', '--root', pilot.queue.root,
    '--intent', pilot.manifest.intentId, '--workspace', join(pilot.directory, 'operator')],
    {environment, signal, quiet:true});
  return {...await show(directory), originalCommand:command};
}

export async function recover(directory) {
  const pilot = await openPilot(directory);
  await pilot.queue.recover(pilot.manifest.intentId);
  return show(directory);
}
export async function cancel(directory) {
  const pilot = await openPilot(directory);
  await pilot.queue.cancel(pilot.manifest.intentId);
  return show(directory);
}

/** Reuse the existing offline report and its outcome meanings; add the original handoff source. */
export async function report(directory, destination) {
  const pilot = await openPilot(directory);
  const original = renderQueueReport({jobs:[pilot.job], queueRoot:pilot.queue.root,
    accountingWorkspace:join(pilot.directory, 'operator'),
    commandFor:verb => `${shellQuote(process.execPath)} ${shellQuote(thisCli)} ${verb} --dir ${shellQuote(pilot.directory)}`});
  const source = view(pilot).source;
  const rows = Object.entries(source).map(([name, value]) =>
    `<div><dt>${escape(name)}</dt><dd><code>${escape(value ?? 'Not recorded')}</code></dd></div>`).join('');
  const introduction = `<section class="section"><h2>Direct merchant source</h2><dl>${rows}</dl>` +
    '<p class="note">The saved original challenge was re-derived and matched to the current workspace and queue. ' +
    'A local hash detects changes; it is not a merchant signature. Execution still requires fresh native terms and operator approval.</p></section>';
  return {...await saveQueueReport(path(destination), original.replace('</header>', '</header>\n' + introduction)),
    source, state:pilot.job.state};
}
