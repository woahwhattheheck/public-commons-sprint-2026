#!/usr/bin/env node
// MIT. Installed checkout, retained paid jobs and their original resource library.
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJobWorkspace } from './model.mjs';
import { startJobCustomerWorkspace } from './server.mjs';
import { absolute, readBytes, parseJson } from '../node/store.mjs';
import { requireValue, failure } from './state.mjs';

const HELP = [
  'Paid job customer workspace — original checkout, jobs, results and library',
  '',
  'job-workspace COMMAND --state ABS [OPTIONS]',
  '',
  'serve       Open Checkout, Jobs, Resource library and Collections',
  'status      Show customer operations, retained checkout and library state',
  'list        Search jobs: --query TEXT --state-filter STATE --view active|archived|all',
  'show        Reopen a saved receipt: --entry ID',
  'register    Add an original job buyer: --buyer-directory ABS [--label TEXT]',
  'retain      Import exact accepted JSON: --acceptance-file ABS and either',
  '            --handoff-file ABS or --claim-token-file ABS [--label TEXT]',
  'refresh     Read current customer status: --entry ID',
  'watch       Wait for a completed result: --entry ID',
  'fetch       Retrieve the verified result into the library: --entry ID',
  'label       --entry ID --label TEXT --expected-revision N',
  'archive     --entry ID --archived true|false --expected-revision N',
  'scan        Reconcile the library with original delivered-job receipts',
  '',
  'checkout-import   --handoff-file ABS [--label TEXT]',
  'checkout-list     --query TEXT --phase IMPORTED|REVIEWED|RECOVERABLE|ACCEPTED|FINISHED',
  'checkout-show     --checkout ID',
  'checkout-review   --checkout ID --expected-revision N',
  'checkout-execute  --checkout ID --expected-revision N',
  'checkout-recover  --checkout ID --expected-revision N',
  'checkout-replace  --checkout ID --expected-revision N --handoff-file ABS --reason TEXT',
  '',
  'serve / checkout-import: select --operator-workspace ABS or --operator-profile ABS.',
  'The installed original SF88 runtime is the default; --runtime ABS selects',
  'an explicit source runtime. Each imported checkout keeps that selection.',
  'checkout-execute uses original terminal approval. Existing attempts recover',
  'from their saved original operation. Renewed tickets retain the same job/intent',
  'and require a newer merchant revision before any original attempt.',
  '',
  'First open: repeat --buyer-root ABS and --file-root ABS for existing external',
  'buyers/results. Owned buyers/artifacts are included. Reopen without roots.',
  'serve: --port N. watch/fetch: --deadline-ms N --poll-ms N.',
  'The running workspace owns its original lease; use the browser while it runs.',
  'Ctrl-C stops the current local operation and retains its original state.',
].join('\n') + '\n';

async function privateFile(path) {
  path = absolute(path); const stat = await lstat(path);
  requireValue(stat.isFile() && !stat.isSymbolicLink() &&
    (process.platform === 'win32' || !(stat.mode & 0o077) && (!process.getuid || stat.uid === process.getuid())),
    'PRIVATE_CLAIM_FILE_REQUIRED');
  return readBytes(path, 65536);
}
export async function runJobWorkspaceCommand(args = process.argv.slice(2), {
  print = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'),
} = {}) {
  if (!args.length || args.includes('--help')) { print(HELP); return; }
  const [command, ...rest] = args;
  const selection = ['--operator-workspace','--operator-profile','--runtime','--native-timeout-ms'];
  const specific = { serve: ['--port', ...selection], status: [],
    list: ['--query','--state-filter','--view','--offset','--limit'],
    show: ['--entry'], register: ['--buyer-directory','--label'],
    retain: ['--acceptance-file','--handoff-file','--claim-token-file','--label'],
    refresh: ['--entry','--deadline-ms'], watch: ['--entry','--deadline-ms','--poll-ms'],
    fetch: ['--entry','--deadline-ms','--poll-ms'],
    label: ['--entry','--label','--expected-revision'], archive: ['--entry','--archived','--expected-revision'], scan: [],
    'checkout-import': ['--handoff-file','--label', ...selection],
    'checkout-list': ['--query','--phase','--offset','--limit'], 'checkout-show': ['--checkout'],
    'checkout-review': ['--checkout','--expected-revision','--native-timeout-ms'],
    'checkout-execute': ['--checkout','--expected-revision','--native-timeout-ms'],
    'checkout-recover': ['--checkout','--expected-revision','--native-timeout-ms'],
    'checkout-replace': ['--checkout','--expected-revision','--handoff-file','--reason'],
  };
  requireValue(Object.hasOwn(specific, command), 'JOB_WORKSPACE_COMMAND_INVALID');
  requireValue(rest.length % 2 === 0, 'OPTION_VALUE_REQUIRED');
  const allowed = ['--state','--buyer-root','--file-root', ...specific[command]], flags = new Map(), buyerRoots = [], fileRoots = [];
  for (let index = 0; index < rest.length; index += 2) {
    const [key, value] = rest.slice(index, index + 2);
    requireValue(allowed.includes(key) && typeof value === 'string' &&
      (!flags.has(key) || ['--buyer-root','--file-root'].includes(key)), 'OPTION_INVALID');
    flags.set(key, value);
    if (key === '--buyer-root') buyerRoots.push(value);
    if (key === '--file-root') fileRoots.push(value);
  }
  const number = flag => flags.has(flag) ? Number(flags.get(flag)) : undefined;
  const checkout = {};
  for (const [flag, key] of [['--operator-workspace','operatorWorkspace'],
    ['--operator-profile','operatorProfile'],['--runtime','runtimeDirectory']])
    if (flags.has(flag)) checkout[key] = flags.get(flag);
  if (flags.has('--native-timeout-ms')) checkout.timeoutMs = number('--native-timeout-ms');
  const model = await openJobWorkspace({ directory: flags.get('--state'), checkout,
    ...(buyerRoots.length ? { buyerRoots } : {}), ...(fileRoots.length ? { fileRoots } : {}) });
  let host, selected = null, checkoutId = null;
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    if (selected) void model.cancel(selected).catch(() => {});
    if (checkoutId) void model.checkout.cancel(checkoutId).catch(() => {});
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'serve') {
      host = await startJobCustomerWorkspace({ model, port: number('--port') ?? 0 });
      // One startup record fits the original Applications stdout observer. The
      // private launch file binds that URL to this PID, state and installed source.
      print(JSON.stringify(host.launch) + '\n');
      if (!controller.signal.aborted) await new Promise(done => controller.signal.addEventListener('abort', done, { once: true }));
    } else if (command === 'status') print(model.status());
    else if (command === 'list') print(model.list({ q: flags.get('--query') ?? '', state: flags.get('--state-filter') ?? '',
      view: flags.get('--view') ?? 'active', offset: number('--offset') ?? 0, limit: number('--limit') ?? 50 }));
    else if (command === 'show') print(await model.reconcile(flags.get('--entry')));
    else if (command === 'register') print(await model.register({ buyerDirectory: flags.get('--buyer-directory'), label: flags.get('--label') ?? '' }));
    else if (command === 'retain') {
      requireValue(flags.has('--handoff-file') !== flags.has('--claim-token-file'), 'JOB_CLAIM_SOURCE_REQUIRED');
      const credentials = flags.has('--handoff-file') ? { handoff: parseJson(await privateFile(flags.get('--handoff-file'))) } :
        { claimToken: (await privateFile(flags.get('--claim-token-file'))).toString('utf8').trim() };
      print(await model.retain({ acceptanceBytes: await readBytes(absolute(flags.get('--acceptance-file'))),
        label: flags.get('--label') ?? '', ...credentials }));
    } else if (['refresh','watch','fetch'].includes(command)) {
      selected = flags.get('--entry');
      await model.start(selected, { kind: command, deadlineMs: number('--deadline-ms') ?? 300000, pollMs: number('--poll-ms') ?? 1500 });
      if (controller.signal.aborted) await model.cancel(selected);
      const result = await model.wait(selected); print(result);
      requireValue(result.task?.state === 'COMPLETE', result.task?.error ?? 'JOB_CUSTOMER_OPERATION_FAILED');
    } else if (command === 'label') print(await model.update(flags.get('--entry'),
      { expectedRevision: number('--expected-revision'), label: flags.get('--label') }));
    else if (command === 'archive') {
      requireValue(['true','false'].includes(flags.get('--archived')), 'JOB_ARCHIVE_INVALID');
      print(await model.update(flags.get('--entry'), { expectedRevision: number('--expected-revision'), archived: flags.get('--archived') === 'true' }));
    } else if (command === 'scan') print(await model.scan({ signal: controller.signal }));
    else if (command === 'checkout-import') print(await model.checkout.import({
      handoffBytes: await privateFile(flags.get('--handoff-file')), ...(flags.has('--label') ? { label: flags.get('--label') } : {}) }));
    else if (command === 'checkout-list') print(model.checkout.list({ q: flags.get('--query') ?? '', phase: flags.get('--phase') ?? '',
      offset: number('--offset') ?? 0, limit: number('--limit') ?? 50 }));
    else if (command === 'checkout-show') print(model.checkout.get(flags.get('--checkout')));
    else if (command === 'checkout-replace') print(await model.checkout.replace(flags.get('--checkout'), {
      handoffBytes: await privateFile(flags.get('--handoff-file')), expectedRevision: number('--expected-revision'),
      reason: flags.get('--reason') }));
    else if (['checkout-review','checkout-execute','checkout-recover'].includes(command)) {
      checkoutId = flags.get('--checkout');
      await model.checkout.start(checkoutId, { kind: command.slice('checkout-'.length), expectedRevision: number('--expected-revision') });
      if (controller.signal.aborted) await model.checkout.cancel(checkoutId);
      const result = await model.checkout.wait(checkoutId); print(result);
      requireValue(result.task?.state === 'COMPLETE', result.task?.error ?? 'JOB_CHECKOUT_OPERATION_FAILED');
    }
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    const results = await Promise.allSettled([host?.close()]);
    try { await model.close(); }
    finally {
      const failed = results.filter(value => value.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map(value => value.reason), 'JOB_WORKSPACE_SERVER_CLOSE_FAILED');
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runJobWorkspaceCommand().catch(error => { process.stderr.write(JSON.stringify({ error: failure(error) }) + '\n'); process.exitCode = 1; });
