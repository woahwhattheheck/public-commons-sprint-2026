#!/usr/bin/env node
// MIT. One foreground owner for the original merchant, worker and workspaces.
import { readFile, mkdir, mkdtemp, open, link, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const help = [
  'Starforge paid jobs', '',
  'All operations use the same private merchant state and original settlement outbox.', '',
  '  jobs serve --config FILE --state DIR [--seller-port N] [--customer-port N]',
  '       [--operator-port N] [--operations-port N] [--native-factory MODULE]',
  '       [--start-worker] [--delivery-config FILE] [--start-delivery]',
  '  jobs status --config FILE --state DIR',
  '  jobs show --config FILE --state DIR --id JOB',
  '  jobs create --config FILE --state DIR --function ID --input FILE',
  '       [--label TEXT] [--reference TEXT] [--out NEW_TICKET_FILE]',
  '  jobs renew-claim --config FILE --state DIR --id JOB --revision N --reason TEXT',
  '       [--out NEW_TICKET_FILE]',
  '  jobs reconcile --config FILE --state DIR',
  '  jobs work --config FILE --state DIR [--once]',
  '  jobs retry --config FILE --state DIR --id JOB --revision N --reason TEXT',
  '  jobs cancel --config FILE --state DIR --id JOB --revision N --reason TEXT',
  '  jobs result --config FILE --state DIR --id JOB --out NEW_RESULT_FILE',
  '  jobs delivery --help',
  '  jobs receiver --help', '',
  'The foreground serve command owns the original merchant, customer listener and',
  'private operator workspace. It prints the complete local operator address.',
  'Use that workspace while the service holds its original state lease.',
  '--delivery-config adds the private completed-result delivery workspace.',
  '--start-delivery starts its signed result dispatcher with the same merchant.',
  'The default service advertises the configured challenge. For native payments,',
  '--native-factory supplies the merchant’s existing compiled => SDK factory as',
  'the module’s default or nativeFactory export.', '',
  'work starts the durable worker in this foreground process; --once drains the',
  'currently available paid jobs. SIGINT/SIGTERM retain interrupted job state.',
  'create writes a private purchase ticket. Keep its retrieval capability with',
  'the buyer. An existing output file is never overwritten.',
  'renew-claim replaces a lost, unsubmitted purchase ticket for the same PREPARED',
  'job. Its earlier claim stops working; save the returned private ticket.', '',
].join('\n');
const problem = message => Object.assign(new Error(message), { code: 'JOBS_COMMAND_INVALID' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const allowed = {
  serve: ['--seller-port', '--customer-port', '--operator-port', '--operations-port', '--native-factory', '--start-worker', '--delivery-config', '--start-delivery'],
  status: [], show: ['--id'], create: ['--function', '--input', '--label', '--reference', '--out'],
  reconcile: [], work: ['--once'], retry: ['--id', '--revision', '--reason'],
  cancel: ['--id', '--revision', '--reason'], result: ['--id', '--out'],
  'renew-claim': ['--id', '--revision', '--reason', '--out'],
};
function options(argv) {
  const command = argv[0];
  if (!Object.hasOwn(allowed, command)) throw problem('Choose a command from --help.');
  const out = new Map(), keys = new Set(['--config', '--state', ...allowed[command]]);
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (!keys.has(flag) || out.has(flag)) throw problem('Unknown or repeated option: ' + flag);
    if (['--once', '--start-worker', '--start-delivery'].includes(flag)) { out.set(flag, true); continue; }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw problem('Supply a value for ' + flag + '.');
    out.set(flag, value);
  }
  for (const flag of ['--config', '--state']) if (!out.has(flag)) throw problem('Supply ' + flag + '.');
  return { command, out };
}
function integer(out, flag, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (!out.has(flag)) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(out.get(flag))) throw problem(flag + ' requires a nonnegative integer.');
  const value = Number(out.get(flag));
  if (!Number.isSafeInteger(value) || value > maximum) throw problem(flag + ' is outside its supported range.');
  return value;
}
function required(out, flag) {
  if (!out.has(flag)) throw problem('Supply ' + flag + '.'); return out.get(flag);
}
async function readJSON(path) {
  const value = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (!object(value)) throw problem('The input file must contain a JSON object.');
  return value;
}
async function publishNew(destination, bytes) {
  const path = resolve(destination), parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(parent, '.paid-job-'));
  try {
    const file = join(temporary, 'output'), fd = await open(file, 'wx', 0o600);
    try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
    await link(file, path);
    const directory = await open(parent, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
/** Maintained distribution entrypoint. */
export async function runJobCommand(argv = process.argv.slice(2), { print = value => console.log(value) } = {}) {
  if (!argv.length || argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) { print(help); return; }
  if (argv[0] === 'delivery') {
    const { runDeliveryCommand } = await import('./result-delivery/cli.mjs');
    return runDeliveryCommand(argv.slice(1), { print });
  }
  if (argv[0] === 'receiver') {
    const { main } = await import('./result-receiver/cli.mjs');
    return main(argv.slice(1), { stdout: { write(value) {
      print(String(value).replace(/\n$/, '')); return true;
    } } });
  }
  const { command, out } = options(argv);
  if (out.has('--start-delivery') && !out.has('--delivery-config')) throw problem('--start-delivery requires --delivery-config.');
  if (['retry', 'cancel', 'renew-claim'].includes(command)) required(out, '--revision');
  // Customer receiving uses only its selected original source and Node built-ins.
  const { openJobMerchant } = await import('./model.mjs');
  const model = await openJobMerchant({ configPath: resolve(out.get('--config')), directory: resolve(out.get('--state')) });
  const sessions = []; let stopped = false, shutdownPromise, delivery;
  const close = () => shutdownPromise ??= (async () => {
    stopped = true; const errors = [];
    try { await delivery?.close(); } catch (error) { errors.push(error); }
    for (const session of [...sessions].reverse()) {
      try { await session.close(); } catch (error) { errors.push(error); }
    }
    try { await model.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Job merchant shutdown did not fully complete.');
  })();
  const onSignal = () => { close().catch(error => { console.error(error.code || error.message); process.exitCode = 1; }); };
  function hold() {
    return new Promise(done => {
      const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); done(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    });
  }
  const emit = value => print(JSON.stringify(value, null, 2));
  try {
    if (command === 'serve') {
      const [{ startJobSeller }, { startCustomerServer }, { startJobsWorkspace },
        { readDeliveryConfig }, { openResultDelivery }] = await Promise.all([
        import('./merchant.mjs'), import('./customer.mjs'), import('./workspace/server.mjs'),
        import('./result-delivery/config.mjs'), import('./result-delivery/dispatcher.mjs'),
      ]);
      let nativeFactory = null;
      if (out.has('--native-factory')) {
        const configured = await import(pathToFileURL(resolve(out.get('--native-factory'))).href);
        nativeFactory = configured.nativeFactory ?? configured.default;
        if (typeof nativeFactory !== 'function') throw problem('The native factory module must export nativeFactory or default.');
      }
      const seller = await startJobSeller(model, { port: integer(out, '--seller-port', 0, 65535), nativeFactory,
        operationsPort: integer(out, '--operations-port', 0, 65535) });
      sessions.push(seller);
      const customer = await startCustomerServer({ model, port: integer(out, '--customer-port', 0, 65535) });
      sessions.push(customer);
      if (out.has('--delivery-config')) delivery = await openResultDelivery({
        model, config: await readDeliveryConfig(out.get('--delivery-config')) });
      const workspace = await startJobsWorkspace({ model, delivery, port: integer(out, '--operator-port', 0, 65535) });
      sessions.push(workspace);
      if (out.has('--start-worker')) await model.startWorker();
      if (out.has('--start-delivery')) delivery.start();
      process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
      emit({ service: 'starforge-paid-jobs', seller: seller.url ?? seller.seller?.url,
        customer: customer.url ?? customer.origin, operator: workspace.url,
        operations: seller.operations?.url, mode: (await model.snapshot()).mode,
        ...(delivery ? { deliveries: workspace.origin + '/deliveries#' + workspace.token } : {}) });
      await hold(); return;
    }
    if (command === 'status') return emit(await model.snapshot());
    if (command === 'show') return emit(await model.get(required(out, '--id')));
    if (command === 'create') {
      const ticket = await model.createJob({ functionId: required(out, '--function'),
        input: await readJSON(required(out, '--input')),
        ...(out.has('--label') ? { label: out.get('--label') } : {}),
        ...(out.has('--reference') ? { reference: out.get('--reference') } : {}) });
      if (out.has('--out')) return emit(await publishNew(out.get('--out'), Buffer.from(JSON.stringify(ticket, null, 2) + '\n')));
      return emit(ticket);
    }
    if (command === 'renew-claim') {
      const ticket = await model.renewClaim({ id: required(out, '--id'),
        expectedRevision: integer(out, '--revision', undefined), reason: required(out, '--reason') });
      if (out.has('--out')) return emit(await publishNew(out.get('--out'), Buffer.from(JSON.stringify(ticket, null, 2) + '\n')));
      return emit(ticket);
    }
    if (command === 'reconcile') return emit(await model.reconcile());
    if (['retry', 'cancel'].includes(command)) return emit(await model[command]({ id: required(out, '--id'),
      expectedRevision: integer(out, '--revision', undefined), reason: required(out, '--reason') }));
    if (command === 'result') {
      const result = await model.result(required(out, '--id'));
      const saved = await publishNew(required(out, '--out'), result.body);
      return emit({ ...saved, contentType: result.contentType, jobId: out.get('--id'), originalSha256: result.sha256 });
    }
    if (command === 'work') {
      process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
      await model.reconcile(); await model.startWorker();
      if (!out.has('--once')) { emit({ worker: 'running', directory: out.get('--state') }); await hold(); return; }
      while (!stopped) {
        const snapshot = await model.snapshot(), active = snapshot.worker?.active;
        const hasActive = Array.isArray(active) ? active.length > 0 : Number(active ?? 0) > 0;
        if (!hasActive && !(snapshot.jobs || []).some(job => ['QUEUED', 'RUNNING', 'CANCELLING'].includes(job.state ?? job.status))) break;
        await delay(250);
      }
      if (!stopped) emit(await model.snapshot());
    }
  } finally {
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    await close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runJobCommand().catch(error => { console.error(error.code ? error.code + ': ' + error.message : error.message); process.exitCode = 1; });
