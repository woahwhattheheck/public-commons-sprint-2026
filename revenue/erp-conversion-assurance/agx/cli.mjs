#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { need, readPrivate, ERROR_SCHEMA } from './custody.mjs';

const HELP = `ERP reconciliation AGX transport — published CLI 0.3.0\n
  init --root PRIVATE_ROOT --peer CALLER_HEX [--max-input-bytes N]
       [--max-report-bytes N] [--timeout-ms N] [--max-heap-mib N]
  stage --root ROOT --peer CALLER_HEX --job ID --source FILE --target FILE
        --spec FILE --request-out NEW_PRIVATE_REQUEST_JSON
  directory --root ROOT --peer CALLER_HEX
  operate --root ROOT --peer CALLER_HEX -- ORIGINAL_OPERATOR_COMMAND [OPTIONS]
  fetch --peer PROVIDER_NPUB_OR_HEX --profile NAME --agx-home PRIVATE_DIRECTORY
        --request PRIVATE_REQUEST_JSON --out NEW_PRIVATE_DIRECTORY
        [--execute] [--timeout-ms N] [--wait-ms N]

init creates the peer's private original service. stage copies through that service
and binds this authenticated caller, job and bundle. operate forwards to the one
original service/operator.mjs (status, review, export, recover and other commands).

Serve with the published CLI:
  ERP_AGX_ROOT=/private/root AGX_HOME=/private/agx-home \\
    ./node_modules/.bin/agx serve --profile provider --handler ./handler.mjs

fetch --execute submits the queued job, follows finance.reconcile.status and
downloads every finance.report part. Per-request timeout defaults to 30000 ms;
the job wait defaults to 180000 ms. A wait timeout leaves the retained job running.
Exit 0: PASS or successful setup; 2: completed differences; 1: error or unfinished.
The original operator retains its own documented exit behavior.
`;
const FIELDS = {
  init: ['root', 'peer', 'max-input-bytes', 'max-report-bytes', 'timeout-ms', 'max-heap-mib'],
  stage: ['root', 'peer', 'job', 'spec', 'source', 'target', 'request-out'],
  directory: ['root', 'peer'], operate: ['root', 'peer'],
  fetch: ['peer', 'profile', 'agx-home', 'request', 'out', 'execute', 'timeout-ms', 'wait-ms'],
};
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') { process.stdout.write(HELP); return; }
  need(Object.hasOwn(FIELDS, command), 'UNKNOWN_COMMAND');
  const options = Object.create(null);
  let forwarded = [];
  for (let i = 0; i < args.length; i++) {
    if (command === 'operate' && args[i] === '--') { forwarded = args.slice(i + 1); break; }
    const key = args[i].startsWith('--') ? args[i].slice(2) : '';
    need(FIELDS[command].includes(key) && !Object.hasOwn(options, key), 'INVALID_ARGUMENT');
    if (key === 'execute') options[key] = true;
    else { need(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'ARGUMENT_VALUE_REQUIRED'); options[key] = args[++i]; }
  }
  const get = name => { need(typeof options[name] === 'string' && options[name].length > 0, 'MISSING_' + name.toUpperCase().replaceAll('-', '_')); return options[name]; };
  let result;
  if (command === 'fetch') {
    const { receive } = await import('./client.mjs');
    const payload = JSON.parse(await readPrivate(get('request'), 4096));
    result = await receive({ peer: get('peer'), profile: get('profile'), agxHome: get('agx-home'), ...(options['timeout-ms'] ? { timeoutMs: Number(options['timeout-ms']) } : {}) }, payload, get('out'), options.execute === true, options['wait-ms'] === undefined ? 180000 : Number(options['wait-ms']));
  } else {
    const { initializePeer, stageForPeer, openPeer, peerDirectory } = await import('./provider.mjs');
    const root = get('root'), peer = get('peer');
    if (command === 'init') {
      const limits = {};
      for (const [flag, field] of [['max-input-bytes', 'maxInputBytes'], ['max-report-bytes', 'maxReportBytes'], ['timeout-ms', 'timeoutMs'], ['max-heap-mib', 'maxHeapMiB']]) if (options[flag] !== undefined) limits[field] = Number(options[flag]);
      result = await initializePeer(root, peer, limits);
    }
    if (command === 'stage') result = await stageForPeer(root, peer, { jobId: get('job'), spec: resolve(get('spec')), source: resolve(get('source')), target: resolve(get('target')), requestOut: get('request-out') });
    if (command === 'directory') { await openPeer(root, peer); result = { peer, directory: peerDirectory(root, peer) }; }
    if (command === 'operate') {
      await openPeer(root, peer); need(forwarded.length > 0, 'OPERATOR_COMMAND_REQUIRED');
      // Arguments go directly to the maintained operator parser, never a shell.
      const operator = fileURLToPath(new URL('../service/operator.mjs', import.meta.url));
      const code = await new Promise((accept, reject) => {
        const args = forwarded.length === 1 && forwarded[0] === '--help' ? [operator, '--help'] : [operator, ...forwarded, '--directory', peerDirectory(root, peer)];
        const child = spawn(process.execPath, args, { stdio: 'inherit', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
        child.once('error', reject); child.once('close', value => accept(value ?? 1));
      });
      process.exitCode = code; return;
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (command === 'fetch') {
    if (result.state !== 'COMPLETED' || result.clientWait?.timedOut) process.exitCode = 1;
    else if (result.result?.status === 'FAIL') process.exitCode = 2;
  }
}
await main().catch(error => { process.stderr.write(JSON.stringify({ schema: ERROR_SCHEMA, state: 'ERROR', error: { code: error.code ?? 'OPERATOR_COMMAND_FAILED' } }) + '\n'); process.exitCode = 1; });
