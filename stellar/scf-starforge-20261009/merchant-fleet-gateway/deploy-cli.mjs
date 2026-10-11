#!/usr/bin/env node
// MIT. Generate and inspect the original managed fleet's host deployment.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFleetDeployment, generateFleetDeployment, checkFleetBundle } from './deploy.mjs';

const HELP = `node deploy-cli.mjs inspect --declaration PRIVATE_FLEET_HOST.json
node deploy-cli.mjs generate --declaration PRIVATE_FLEET_HOST.json --out NEW_PRIVATE_BUNDLE
node deploy-cli.mjs check --bundle PRIVATE_BUNDLE
node deploy-cli.mjs health --bundle PRIVATE_BUNDLE
node deploy-cli.mjs run --bundle PRIVATE_BUNDLE

Uses the original retained fleet plan, managed release operator and private workspace.
Generate systemd/Caddy and optional Docker Compose with exact source/state bindings.
See DEPLOYMENT.md and the generated RUNBOOK.md for installation, operation and recovery.`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || (args.length === 1 && args[0] === '--help')) { console.log(HELP); return 0; }
  const [command, ...rest] = args;
  const required = { inspect: ['--declaration'], generate: ['--declaration', '--out'],
    check: ['--bundle'], health: ['--bundle'], run: ['--bundle'] }[command];
  if (!required) throw new Error(HELP);
  const values = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!required.includes(key) || values.has(key) || !value || value.startsWith('--')) throw new Error(HELP);
    values.set(key, value);
  }
  if (values.size !== required.length) throw new Error(HELP);
  let result;
  if (command === 'generate') result = await generateFleetDeployment(values.get('--declaration'), values.get('--out'));
  else if (command === 'inspect') {
    const p = await prepareFleetDeployment(values.get('--declaration'));
    result = { fleet: p.fleet, hosts: p.hosts, gateway: p.gateway, workspacePort: p.workspacePort,
      planDigest: p.planDigest, planFile: p.planFile, sourceRoot: p.sourceRoot, stateRoot: p.stateRoot,
      serviceUser: p.serviceUser, serviceUid: p.serviceUid, serviceGid: p.serviceGid,
      readOnlyRoots: p.readOnlyRoots, recoveryRoots: p.recoveryRoots, container: p.container,
      environmentFile: p.environmentFile, environmentValuesRead: false };
  } else if (command === 'check') {
    const p = await checkFleetBundle(values.get('--bundle'));
    result = { fleet: p.fleet, status: 'SOURCE_PLAN_AND_BUNDLE_MATCH', planDigest: p.planDigest,
      hosts: p.hosts, unit: p.unit, container: Boolean(p.container) };
  } else {
    const runtime = await import('./deploy-runtime.mjs');
    if (command === 'health') result = await runtime.fleetDeploymentHealth(values.get('--bundle'));
    else {
      const service = await runtime.runFleetDeployment({ bundle: values.get('--bundle') });
      console.log(JSON.stringify(service.ready, null, 2));
      await service.completion;
      return 0;
    }
  }
  console.log(JSON.stringify(result, null, 2));
  return result?.passed === false ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
