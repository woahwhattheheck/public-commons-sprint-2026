#!/usr/bin/env node
// MIT. Host-declared recovery workspace over the original SF101 commands.
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELP = 'SF101 recovery workspace\n\n' +
  'starforge merchant-recovery-remote workspace serve --config ABS_HOST_CONFIG --directory ABS_PRIVATE_STATE [--port 8481]\n' +
  'starforge merchant-recovery-remote workspace show --config ABS_HOST_CONFIG --directory ABS_PRIVATE_STATE\n\n' +
  'serve  Open the retained operator workspace on 127.0.0.1. The printed browser\n' +
  '       URL grants this server session access to the host-selected recovery profiles.\n' +
  'show   Read the saved workspace and original operation status as JSON. This can\n' +
  '       run beside the server without acquiring its controller lease.\n\n' +
  'The private host configuration selects existing S3 config files, passphrase\n' +
  'environment names, bundle roots, the original journal and output parents.\n' +
  'The browser reviews exact selections before starting the original engines.\n' +
  'Stopping a transfer preserves its original operation ID and journal.\n' +
  'Use that operation again to continue; a local verification or restore stage\n' +
  'may finish after transfer stop was requested. See workspace/GUIDE.md.\n';

export function parseWorkspaceArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw Object.assign(new Error('Workspace arguments must be strings'), { code: 'WORKSPACE_ARGUMENTS_INVALID' });
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return { help: true };
  const [command, ...rest] = argv;
  if (!['serve', 'show'].includes(command))
    throw Object.assign(new Error('Choose workspace serve or show'), { code: 'WORKSPACE_COMMAND_INVALID' });
  const result = { command };
  const flags = { '--config': 'configFile', '--directory': 'directory', '--port': 'port' };
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--help' || flag === '-h') {
      if (rest.length !== 1) throw Object.assign(new Error('Use COMMAND --help on its own'), { code: 'WORKSPACE_ARGUMENTS_INVALID' });
      return { help: true };
    }
    const key = flags[flag];
    if (!key || key === 'port' && command !== 'serve' || result[key] !== undefined)
      throw Object.assign(new Error('Unknown, repeated or unsupported workspace option: ' + flag), { code: 'WORKSPACE_ARGUMENTS_INVALID' });
    const value = rest[++index];
    if (value === undefined || value.startsWith('--'))
      throw Object.assign(new Error('A value is required for ' + flag), { code: 'WORKSPACE_ARGUMENTS_INVALID' });
    result[key] = value;
  }
  for (const key of ['configFile', 'directory']) {
    const path = result[key];
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path)
      throw Object.assign(new Error(key + ' must be a normalized absolute path'), { code: 'WORKSPACE_PATH_INVALID' });
  }
  if (result.port !== undefined) {
    if (!/^\d{1,5}$/.test(result.port) || Number(result.port) > 65535)
      throw Object.assign(new Error('Port must be from 0 through 65535'), { code: 'WORKSPACE_PORT_INVALID' });
    result.port = Number(result.port);
  }
  return result;
}

export async function main(argv = process.argv.slice(2), { output = process.stdout } = {}) {
  const options = parseWorkspaceArguments(argv);
  if (options.help) { output.write(HELP); return { help: true }; }
  if (options.command === 'show') {
    const { openRecoveryWorkspace } = await import('./model.mjs');
    const workspace = await openRecoveryWorkspace({ ...options, readOnly: true });
    try { const result = await workspace.state(); output.write(JSON.stringify(result, null, 2) + '\n'); return result; }
    finally { await workspace.close(); }
  }
  const { serveRecoveryWorkspace } = await import('./server.mjs');
  const service = await serveRecoveryWorkspace(options);
  output.write('Merchant recovery workspace\n' + service.url + '\n');
  output.write('Host configuration: ' + options.configFile + '\nWorkspace: ' + options.directory + '\n');
  let shutdown;
  const stop = () => {
    if (!shutdown) shutdown = service.close({ cancelActive: true }).catch(error => {
      process.exitCode = 1; output.write(JSON.stringify({ error: { code: error.code ?? 'WORKSPACE_SHUTDOWN_FAILED', message: error.message } }) + '\n');
    });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { await service.closed; return { status: 'CLOSED', directory: options.directory }; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'RECOVERY_WORKSPACE_FAILED', message: error.message } }) + '\n');
    process.exitCode = 1;
  });
}
