#!/usr/bin/env node
// MIT. Start the original Routescan operator project and private browser workspace.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startRoutescanWorkspace } from './workspace.mjs';
import { routescanNativeFactory } from './merchant.mjs';
import { restoreRoutescanBackup } from './backup.mjs';

const HELP = [
  'Routescan operator workspace', '',
  'node workspace-cli.mjs --project /private/routescan --config /private/merchant.json --port 0',
  'node workspace-cli.mjs --project /private/routescan --port 0', '',
  '--merchant-port PORT         Original SF30 listener; default 0 selects an available port.',
  '--operations-port PORT       Original merchant Operations listener; default 0.',
  '--facilitator HTTPS_URL      Existing native facilitator transport.',
  '--allow-local-facilitator    Permit the explicit original 127.0.0.1 HTTP facilitator.',
  '--runtime ABS_SF88           Display the customer runtime path.',
  '--state ABS_BUYER_STATE      Display the customer private state path.',
  '--profile ABS_PROFILE       Original customer operator-profile reference.',
  '--python PATH               Python 3.11+ archive worker; default python3.',
  '--restore ARCHIVE           Restore into a NEW --project directory and open it.', '',
  'First startup requires an operator-selected merchant configuration. --config does not overwrite an existing project.',
  'The facilitator and provider key environment stay on the host. Source queries use the same provider quota.',
  'The browser prepares customers; original SF88 terminal approval remains the purchase entry point.',
].join('\n');
function port(value, name) {
  if (value === undefined) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) > 65535) throw new Error('Invalid ' + name + '.');
  return Number(value);
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { console.log(HELP); return; }
  const flags = {}, allowed = new Set(['project','config','port','merchant-port','operations-port','facilitator','runtime','state','profile','python','restore']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow-local-facilitator') { flags.local = true; continue; }
    const name = args[i]?.slice(2), value = args[++i];
    if (!allowed.has(name) || value === undefined || flags[name] !== undefined) throw new Error('Use the documented workspace flags.');
    flags[name] = value;
  }
  if (!flags.project) throw new Error('Supply --project with an absolute private directory.');
  const directory = resolve(flags.project);
  if (directory !== flags.project) throw new Error('Use an absolute project directory.');
  if (flags.restore && flags.config) throw new Error('Restore the saved configuration without --config.');
  if (flags.restore) await restoreRoutescanBackup(resolve(flags.restore), { directory, python: flags.python || 'python3' });
  const nativeFactory = await routescanNativeFactory(flags.facilitator, { allowLocalFacilitator: Boolean(flags.local) });
  const session = await startRoutescanWorkspace({ directory, configFile: flags.config && resolve(flags.config),
    port: port(flags.port, 'workspace port'), merchantPort: port(flags['merchant-port'], 'merchant port'),
    operationsPort: port(flags['operations-port'], 'operations port'), nativeFactory, python: flags.python || 'python3',
    customer: { runtimeDirectory: flags.runtime, stateDirectory: flags.state, operatorProfile: flags.profile } });
  console.log(JSON.stringify({ schema: 'stellar-forge.routescan-workspace.v1', url: session.url,
    directory: session.project.root, nativeFacilitatorConfigured: Boolean(nativeFactory) }));
  let exiting = false;
  const stop = async () => { if (exiting) return; exiting = true; try { await session.close(); } catch { process.exitCode = 2; } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return session;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(JSON.stringify({ error: error.code || 'ROUTESCAN_WORKSPACE_START_FAILED', message: error.message })); process.exitCode = 1; });
}
