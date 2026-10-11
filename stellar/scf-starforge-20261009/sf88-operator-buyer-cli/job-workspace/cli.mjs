#!/usr/bin/env node
// MIT. Installed customer workspace over retained original paid jobs.
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJobWorkspace } from './model.mjs';
import { startJobCustomerWorkspace } from './server.mjs';
import { absolute, readBytes, parseJson } from '../node/store.mjs';
import { requireValue, failure } from './state.mjs';

const HELP = [
  'Paid job customer workspace — original retained buyer, results and library',
  '',
  'job-workspace COMMAND --state ABS [OPTIONS]',
  '',
  'serve       Start the jobs, resource library and collection browser',
  'status      Show registered jobs, local tasks and library state',
  'list        Search retained jobs: --query TEXT --state-filter STATE --view active|archived|all',
  'show        Reopen an original local receipt: --entry ID',
  'register    Add an existing original buyer: --buyer-directory ABS [--label TEXT]',
  'retain      Import exact accepted JSON: --acceptance-file ABS and either',
  '            --handoff-file ABS or --claim-token-file ABS [--label TEXT]',
  'refresh     Read current customer status: --entry ID',
  'watch       Wait for a completed result: --entry ID',
  'fetch       Wait and retrieve the verified result into the library: --entry ID',
  'label       --entry ID --label TEXT --expected-revision N',
  'archive     --entry ID --archived true|false --expected-revision N',
  'scan        Rebuild the library from original delivered job receipts',
  '',
  'First open: repeat --buyer-root ABS for retained buyer directories and',
  '--file-root ABS for their already delivered files. Owned buyers/artifacts',
  'inside --state are included automatically. Reopen without repeating roots.',
  'serve: --port N. watch/fetch: --deadline-ms N --poll-ms N.',
  'Use the browser while serve owns the state; standalone commands acquire',
  'the same original kernel lease. Ctrl-C stops local work and closes cleanly.',
].join('\n') + '\n';

export async function runJobWorkspaceCommand(args = process.argv.slice(2), {
  print = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'),
} = {}) {
  if (!args.length || args.includes('--help')) { print(HELP); return; }
  const [command, ...rest] = args;
  const specific = { serve: ['--port'], status: [], list: ['--query','--state-filter','--view','--offset','--limit'],
    show: ['--entry'], register: ['--buyer-directory','--label'],
    retain: ['--acceptance-file','--handoff-file','--claim-token-file','--label'],
    refresh: ['--entry','--deadline-ms'], watch: ['--entry','--deadline-ms','--poll-ms'],
    fetch: ['--entry','--deadline-ms','--poll-ms'],
    label: ['--entry','--label','--expected-revision'], archive: ['--entry','--archived','--expected-revision'], scan: [] };
  requireValue(Object.hasOwn(specific, command), 'JOB_WORKSPACE_COMMAND_INVALID');
  requireValue(rest.length % 2 === 0, 'OPTION_VALUE_REQUIRED');
  const allowed = ['--state','--buyer-root','--file-root', ...specific[command]], flags = new Map(), buyerRoots = [], fileRoots = [];
  for (let index = 0; index < rest.length; index += 2) {
    const [key, value] = rest.slice(index, index + 2);
    requireValue(allowed.includes(key) && (!flags.has(key) || ['--buyer-root','--file-root'].includes(key)), 'OPTION_INVALID');
    flags.set(key, value);
    if (key === '--buyer-root') buyerRoots.push(value);
    if (key === '--file-root') fileRoots.push(value);
  }
  const number = flag => flags.has(flag) ? Number(flags.get(flag)) : undefined;
  const model = await openJobWorkspace({ directory: flags.get('--state'),
    ...(buyerRoots.length ? { buyerRoots } : {}), ...(fileRoots.length ? { fileRoots } : {}) });
  let host, selected = null;
  const controller = new AbortController();
  const stop = () => { controller.abort(); if (selected) void model.cancel(selected).catch(() => {}); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'serve') {
      host = await startJobCustomerWorkspace({ model, port: number('--port') ?? 0 });
      print({ url: host.url, libraryUrl: host.libraryUrl, collectionsUrl: host.collectionsUrl, state: model.directory });
      if (!controller.signal.aborted) await new Promise(done => controller.signal.addEventListener('abort', done, { once: true }));
    } else if (command === 'status') print(model.status());
    else if (command === 'list') print(model.list({ q: flags.get('--query') ?? '', state: flags.get('--state-filter') ?? '',
      view: flags.get('--view') ?? 'active', offset: number('--offset') ?? 0, limit: number('--limit') ?? 50 }));
    else if (command === 'show') print(await model.reconcile(flags.get('--entry')));
    else if (command === 'register') print(await model.register({ buyerDirectory: flags.get('--buyer-directory'), label: flags.get('--label') ?? '' }));
    else if (command === 'retain') {
      requireValue(flags.has('--handoff-file') !== flags.has('--claim-token-file'), 'JOB_CLAIM_SOURCE_REQUIRED');
      const privateFile = async path => {
        path = absolute(path); const stat = await lstat(path);
        requireValue(stat.isFile() && !stat.isSymbolicLink() &&
          (process.platform === 'win32' || !(stat.mode & 0o077) && (!process.getuid || stat.uid === process.getuid())),
          'PRIVATE_CLAIM_FILE_REQUIRED');
        return readBytes(path, 1048576);
      };
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
