#!/usr/bin/env node
// MIT. Original-source merchant pricing workspace.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startWorkspace } from './server.mjs';
import { inspectCostWorkspaceRestore, restoreCostWorkspace } from '../economics/archive.mjs';
export { inspectCostWorkspaceRestore };
import { readJson, merchantRoutes } from '../analyze.mjs';

export const PRICING_WORKSPACE_LAUNCH_SCHEMA = 'stellar-forge.merchant-pricing-workspace-launch.v1';

export async function main(argv = process.argv.slice(2)) {
  const usage = 'node workspace/cli.mjs --config SELLER_JSON --state PRIVATE_DIRECTORY (--snapshot ORIGINAL_TRAFFIC_JSON [--history ORIGINAL_HISTORY_JSON] | --history ORIGINAL_HISTORY_JSON | --ops-url ORIGINAL_LOOPBACK_OPERATIONS_URL) [--native-outbox PRIVATE_SF98_DIRECTORY] [--source-package ORIGINAL_API_MERCHANT_PACKAGE] [--release-store ORIGINAL_SELLER_RELEASE_STORE] [--release-runtime HOST_RUNTIME_JSON] [--supplier-usage ORIGINAL_USAGE_JSON] [--accounting-report ORIGINAL_ACCOUNTING_JSON] [--restore-cost-workspace PRIVATE_BACKUP_TAR [--expected-cost-backup-sha256 SHA256]] [--expected-config-sha256 SHA256] [--port 8457]; inspect a complete backup without opening: --inspect-cost-workspace PRIVATE_BACKUP_TAR --state PRIVATE_DIRECTORY';
  if (argv.length === 1 && ['--help','-h'].includes(argv[0])) { console.log(usage); return; }
  const allowed = new Set(['--config','--state','--snapshot','--history','--ops-url','--native-outbox','--port',
    '--source-package','--release-store','--release-runtime','--supplier-usage','--accounting-report','--restore-cost-workspace',
    '--inspect-cost-workspace','--expected-cost-backup-sha256','--expected-config-sha256']), args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i+1] || Object.hasOwn(args,argv[i])) throw new TypeError(usage);
    args[argv[i]] = argv[i+1];
  }
  if(args['--inspect-cost-workspace']) {
    if(!args['--state']||Object.keys(args).some(key=>!['--inspect-cost-workspace','--state'].includes(key)))
      throw new TypeError(usage);
    const review=await inspectCostWorkspaceRestore({
      archive:resolve(args['--inspect-cost-workspace']),directory:resolve(args['--state']),
    });
    console.log(JSON.stringify(review,null,2));
    return review;
  }
  if(args['--expected-cost-backup-sha256']&&(!args['--restore-cost-workspace']||
      !/^[a-f0-9]{64}$/.test(args['--expected-cost-backup-sha256'])))
    throw new TypeError('A reviewed backup SHA-256 requires its original --restore-cost-workspace archive.');
  if (!args['--config'] || !args['--state'] || !(args['--snapshot'] || args['--history'] || args['--ops-url']) ||
      (args['--ops-url'] && (args['--snapshot'] || args['--history']))) throw new TypeError(usage);
  if (args['--port'] !== undefined && (!/^\d{1,5}$/.test(args['--port']) || Number(args['--port'])>65535))
    throw new TypeError('Port must be 0–65535.');
  if ((args['--release-store'] && !args['--source-package']) || (args['--release-runtime'] && !args['--release-store']))
    throw new TypeError('A release store requires --source-package; --release-runtime also requires --release-store.');
  const releaseRuntime = args['--release-runtime']
    ? (await readJson(resolve(args['--release-runtime']),'original release runtime',262144)).value : {};
  let costRestore;
  if(args['--restore-cost-workspace']) {
    // Validate the original selected seller before receiving any workspace files.
    // The normal model checks the same seller again before opening its listener.
    const seller=await readJson(resolve(args['--config']),'seller config');
    merchantRoutes(seller.value);
    if(args['--expected-config-sha256']!==undefined&&seller.hash!==args['--expected-config-sha256'])
      throw Object.assign(new Error('Seller configuration changed after application review.'),{code:'SELLER_CHANGED'});
    costRestore=await restoreCostWorkspace({
      archive:resolve(args['--restore-cost-workspace']),directory:resolve(args['--state']),
      expectedArchiveSha256:args['--expected-cost-backup-sha256'],
    });
  }
  const workspace = await startWorkspace({config:args['--config'],directory:args['--state'],snapshot:args['--snapshot'],
    history:args['--history'],opsUrl:args['--ops-url'],nativeOutbox:args['--native-outbox'],
    sourcePackage:args['--source-package'],releaseStore:args['--release-store'],releaseRuntime,
    supplierUsage:args['--supplier-usage'],accountingReport:args['--accounting-report'],
    expectedConfigSha256:args['--expected-config-sha256'],
    port:args['--port'] === undefined ? 8457 : Number(args['--port'])});
  console.log(JSON.stringify({schema:PRICING_WORKSPACE_LAUNCH_SCHEMA,
    status:'MERCHANT_PRICING_WORKSPACE_READY',...workspace.model.launch,
    pid:process.pid,url:workspace.url,planningUrl:workspace.planningUrl,costsUrl:workspace.url+'/economics',
    ...(costRestore?{costRestore:{...costRestore,archive:resolve(args['--restore-cost-workspace'])}}:{})}));
  const stop = () => workspace.close().catch(() => { process.exitCode = 1; });
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  return workspace;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('SF97 workspace:',error.message); process.exitCode = 1; });
