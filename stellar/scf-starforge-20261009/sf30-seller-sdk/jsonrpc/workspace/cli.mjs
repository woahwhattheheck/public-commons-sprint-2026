#!/usr/bin/env node
// MIT. Saved RPC workspace; original merchant launch remains an explicit action.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRpcWorkspace } from './server.mjs';

const USAGE = `Stellar RPC merchant workspace

  --dir PRIVATE_DIRECTORY [--create] [--plan PUBLIC_PLAN.json] [--port 8447]
  [--challenge-only | --facilitator HTTPS_URL]
  [--seller-port 0] [--operations-port 0] [--history-days 90]
  [--max-in-flight 64] [--drain-grace-ms 60000]
  [--allow-loopback-upstream] [--allow-local-facilitator]
  [--commerce-profile /private/rpc-commerce-profile.json]

Create without --plan to save an editable starter. Reopen with --dir alone.
The browser saves/imports public plans, reviews exact product terms, prepares
the original merchant package and buyer request, and retains explicit provider
diagnosis. Runtime mode is selected here and started from a saved browser review.
Provider URLs and credentials come from the declared launch environment.
The private commerce profile enables reviewed native buyer preparation, named
existing-session attachment, and the original commerce console with retained intent ownership.
The original merchant owns native payment, operations, product pause and drain.`;
const values = new Set(['dir','plan','port','facilitator','seller-port','operations-port',
  'history-days','max-in-flight','drain-grace-ms','commerce-profile']);
const switches = new Set(['create','challenge-only','allow-loopback-upstream','allow-local-facilitator']);
function integer(value,fallback,min,max) {
  const raw = value ?? String(fallback);
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max)
    throw new TypeError('Invalid numeric workspace option');
  return Number(raw);
}
export async function main(args = process.argv.slice(2), { env = process.env, stdout = process.stdout,
  stderr = process.stderr } = {}) {
  if (!args.length || args.length === 1 && args[0] === '--help') { stdout.write(USAGE+'\n'); return; }
  const options = Object.create(null);
  for (let index=0;index<args.length;index++) {
    const key = args[index].startsWith('--') ? args[index].slice(2) : '';
    if (Object.hasOwn(options,key)) throw new TypeError('Duplicate workspace option');
    if (switches.has(key)) options[key]=true;
    else if (values.has(key) && args[index+1] && !args[index+1].startsWith('--')) options[key]=args[++index];
    else throw new TypeError('Invalid workspace option');
  }
  if (!options.dir || options.plan && !options.create) throw new TypeError('Use --dir and --create for initial plan import');
  if (options.facilitator && options['challenge-only'] || options['allow-local-facilitator'] && !options.facilitator)
    throw new TypeError('Choose one explicit merchant runtime mode');
  const port=integer(options.port,8447,0,65535), sellerPort=integer(options['seller-port'],0,0,65535),
    operationsPort=integer(options['operations-port'],0,0,65535);
  const occupied = [port,sellerPort,operationsPort].filter(Boolean);
  if (new Set(occupied).size !== occupied.length) throw new TypeError('Use distinct nonzero listener ports');
  const runtimeOptions = options.facilitator || options['challenge-only'] ? {
    ...(options.facilitator ? { facilitator:options.facilitator } : { 'challenge-only':true }),
    ...(options['allow-local-facilitator'] ? { 'allow-local-facilitator':true } : {}),
    port:String(sellerPort),'operations-port':String(operationsPort),
    'history-days':String(integer(options['history-days'],90,1,365)),
    'max-in-flight':String(integer(options['max-in-flight'],64,1,1024)),
    'drain-grace-ms':String(integer(options['drain-grace-ms'],60000,1000,300000)),
  } : null;
  const server = await startRpcWorkspace({ directory:resolve(options.dir), create:Boolean(options.create),
    ...(options.plan ? { planFile:resolve(options.plan) } : {}), port,env,runtimeOptions,
    ...(options['commerce-profile'] ? { commerceProfileFile:resolve(options['commerce-profile']) } : {}),
    allowLoopbackUpstream:Boolean(options['allow-loopback-upstream']) });
  let closing;
  const close = () => closing ??= server.close().finally(() => {
    process.off('SIGINT',onSignal); process.off('SIGTERM',onSignal);
  });
  function onSignal() { close().catch(() => { stderr.write('RPC_WORKSPACE_CLOSE_FAILED\n'); process.exitCode=1; }); }
  process.once('SIGINT',onSignal); process.once('SIGTERM',onSignal);
  stdout.write(JSON.stringify({ workspace:server.url, directory:server.model.directory,
    mode:server.model.runtime().launchMode, status:'RPC_WORKSPACE_READY' })+'\n');
  return { ...server,close };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { process.stderr.write('RPC_WORKSPACE_START_FAILED: review --help and the private workspace directory.\n'); process.exitCode=1; });

