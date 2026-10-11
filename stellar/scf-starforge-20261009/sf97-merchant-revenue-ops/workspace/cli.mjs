#!/usr/bin/env node
// MIT. Original-source merchant pricing workspace.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startWorkspace } from './server.mjs';

export async function main(argv = process.argv.slice(2)) {
  const usage = 'node workspace/cli.mjs --config SELLER_JSON --state PRIVATE_DIRECTORY (--snapshot ORIGINAL_TRAFFIC_JSON | --ops-url http://127.0.0.1:8424) [--native-outbox PRIVATE_SF98_DIRECTORY] [--port 8457]';
  if (argv.length === 1 && ['--help','-h'].includes(argv[0])) { console.log(usage); return; }
  const allowed = new Set(['--config','--state','--snapshot','--ops-url','--native-outbox','--port']), args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i+1] || Object.hasOwn(args,argv[i])) throw new TypeError(usage);
    args[argv[i]] = argv[i+1];
  }
  if (!args['--config'] || !args['--state'] || Boolean(args['--snapshot']) === Boolean(args['--ops-url'])) throw new TypeError(usage);
  if (args['--port'] !== undefined && !/^\d{1,5}$/.test(args['--port'])) throw new TypeError('Port must be 0–65535.');
  const workspace = await startWorkspace({config:args['--config'],directory:args['--state'],snapshot:args['--snapshot'],
    opsUrl:args['--ops-url'],nativeOutbox:args['--native-outbox'],port:args['--port'] === undefined ? 8457 : Number(args['--port'])});
  console.log(JSON.stringify({status:'MERCHANT_PRICING_WORKSPACE_READY',url:workspace.url,state:args['--state']}));
  const stop = () => workspace.close().catch(() => { process.exitCode = 1; });
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  return workspace;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('SF97 workspace:',error.message); process.exitCode = 1; });
