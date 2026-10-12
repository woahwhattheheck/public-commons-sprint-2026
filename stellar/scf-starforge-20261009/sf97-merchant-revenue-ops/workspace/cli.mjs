#!/usr/bin/env node
// MIT. Original-source merchant pricing workspace.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startWorkspace } from './server.mjs';
import { restoreCostWorkspace } from '../economics/archive.mjs';
import { readJson } from '../analyze.mjs';

export const PRICING_WORKSPACE_LAUNCH_SCHEMA = 'stellar-forge.merchant-pricing-workspace-launch.v1';

export async function main(argv = process.argv.slice(2)) {
  const usage = 'node workspace/cli.mjs --config SELLER_JSON --state PRIVATE_DIRECTORY (--snapshot ORIGINAL_TRAFFIC_JSON [--history ORIGINAL_HISTORY_JSON] | --history ORIGINAL_HISTORY_JSON | --ops-url ORIGINAL_LOOPBACK_OPERATIONS_URL) [--native-outbox PRIVATE_SF98_DIRECTORY] [--source-package ORIGINAL_API_MERCHANT_PACKAGE] [--release-store ORIGINAL_SELLER_RELEASE_STORE] [--release-runtime HOST_RUNTIME_JSON] [--supplier-usage ORIGINAL_USAGE_JSON] [--accounting-report ORIGINAL_ACCOUNTING_JSON] [--restore-cost-workspace PRIVATE_BACKUP_TAR] [--expected-config-sha256 SHA256] [--port 8457]';
  if (argv.length === 1 && ['--help','-h'].includes(argv[0])) { console.log(usage); return; }
  const allowed = new Set(['--config','--state','--snapshot','--history','--ops-url','--native-outbox','--port',
    '--source-package','--release-store','--release-runtime','--supplier-usage','--accounting-report','--restore-cost-workspace','--expected-config-sha256']), args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i+1] || Object.hasOwn(args,argv[i])) throw new TypeError(usage);
    args[argv[i]] = argv[i+1];
  }
  if (!args['--config'] || !args['--state'] || !(args['--snapshot'] || args['--history'] || args['--ops-url']) ||
      (args['--ops-url'] && (args['--snapshot'] || args['--history']))) throw new TypeError(usage);
  if (args['--port'] !== undefined && !/^\d{1,5}$/.test(args['--port'])) throw new TypeError('Port must be 0–65535.');
  if ((args['--release-store'] && !args['--source-package']) || (args['--release-runtime'] && !args['--release-store']))
    throw new TypeError('A release store requires --source-package; --release-runtime also requires --release-store.');
  const releaseRuntime = args['--release-runtime']
    ? (await readJson(resolve(args['--release-runtime']),'original release runtime',262144)).value : {};
  if(args['--restore-cost-workspace'])await restoreCostWorkspace({archive:resolve(args['--restore-cost-workspace']),directory:resolve(args['--state'])});
  const workspace = await startWorkspace({config:args['--config'],directory:args['--state'],snapshot:args['--snapshot'],
    history:args['--history'],opsUrl:args['--ops-url'],nativeOutbox:args['--native-outbox'],
    sourcePackage:args['--source-package'],releaseStore:args['--release-store'],releaseRuntime,
    supplierUsage:args['--supplier-usage'],accountingReport:args['--accounting-report'],
    expectedConfigSha256:args['--expected-config-sha256'],
    port:args['--port'] === undefined ? 8457 : Number(args['--port'])});
  console.log(JSON.stringify({schema:PRICING_WORKSPACE_LAUNCH_SCHEMA,
    status:'MERCHANT_PRICING_WORKSPACE_READY',...workspace.model.launch,
    pid:process.pid,url:workspace.url,planningUrl:workspace.planningUrl,costsUrl:workspace.url+'/economics'}));
  const stop = () => workspace.close().catch(() => { process.exitCode = 1; });
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  return workspace;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('SF97 workspace:',error.message); process.exitCode = 1; });
