#!/usr/bin/env node
// MIT. Explicit operator commands for the original merchant host lifecycle.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMaintenance } from './maintenance.mjs';
import { MAINTENANCE_SCHEMA } from './maintenance-system.mjs';

const HELP = `node cli.mjs maintenance template
node cli.mjs maintenance inspect --plan PRIVATE_MAINTENANCE.json
node cli.mjs maintenance backup --plan PRIVATE_MAINTENANCE.json --id STABLE_ID
node cli.mjs maintenance migrate --plan PRIVATE_MAINTENANCE.json --id STABLE_ID
     --destination NEW_ABSOLUTE_DIRECTORY [--source-root IMMUTABLE_RELEASE]
node cli.mjs maintenance status|resume|rollback --plan PRIVATE_MAINTENANCE.json --id STABLE_ID

backup and migrate operate the selected existing Linux/systemd/Caddy merchant.
They pause its public ingress, stop its declared writers, use original encrypted
SF101 recovery, and resume service. migrate stages original state in a new path.
Precommit errors roll back to the original host; committed operations resume
against the chosen state. No command signs a payment or creates a purchase.`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { console.log(HELP); return 0; }
  const [command, ...rest] = args;
  if (command === 'template' && !rest.length) {
    console.log(JSON.stringify({ schema: MAINTENANCE_SCHEMA, bundle: '/private/deployments/merchant-release-001',
      operationsRoot: '/var/lib/stellar-maintenance/merchant', systemdDirectory: '/etc/systemd/system',
      caddy: { fragment: '/etc/caddy/merchants/merchant.caddy', config: '/etc/caddy/Caddyfile', unit: 'caddy.service', binary: '/usr/bin/caddy' },
      extraWriterUnits: [], writerTemplates: [], passphraseEnv: 'SF101_RECOVERY_PASSPHRASE' }, null, 2)); return 0;
  }
  const allowed = { inspect: ['--plan'], backup: ['--plan','--id'],
    migrate: ['--plan','--id','--destination','--source-root'],
    status: ['--plan','--id'], resume: ['--plan','--id'], rollback: ['--plan','--id'] }[command];
  if (!allowed) throw new Error(HELP);
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!allowed.includes(key) || Object.hasOwn(values, key) || !value || value.startsWith('--')) throw new Error(HELP);
    values[key] = value;
  }
  if (!values['--plan'] || command !== 'inspect' && !values['--id'] || command === 'migrate' && !values['--destination']) throw new Error(HELP);
  const result = await runMaintenance(values['--plan'], { command, id: values['--id'],
    destination: values['--destination'], sourceRoot: values['--source-root'] });
  console.log(JSON.stringify(result, null, 2)); return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ error: error.message, ...(error.operation ? { operation: error.operation } : {}) }, null, 2));
    process.exitCode = 1;
  });
