// MIT. Installed and source CLI for private Google Sheets connection onboarding.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fault } from '../../postgres/publisher/files.mjs';
import { initializeGoogleConnection, googleConnectionStatus, refreshGoogleConnection, disconnectGoogleConnection } from './oauth.mjs';
import { serveGoogleConnection } from './server.mjs';

const HELP = [
  'Google Sheets renewable connection (Node 22.16+; Linux util-linux flock)',
  '',
  '  connect --directory PRIVATE_CONNECTION [--client PRIVATE_DESKTOP_CLIENT.json] [--port PORT]',
  '  status --directory PRIVATE_CONNECTION',
  '  refresh --directory PRIVATE_CONNECTION',
  '  disconnect --directory PRIVATE_CONNECTION [--revoke]',
  '',
  'Connect imports an existing registered Google Desktop app client when --client is',
  'supplied, then prints a private local account/scope-review URL. Open it in the',
  'system browser on this same host. Google handles account sign-in and consent;',
  'approve the returned account in the local window to save renewable access.',
  'Keep this process running until the connection window is closed.',
  '',
  'The existing publisher source may use:',
  '  "connection": {"kind":"google","oauthDirectory":"/absolute/private/connection"}',
  '',
  'Existing accessTokenEnv and retained capture sources remain supported.',
  'Status/refresh print account and expiry metadata, never token values.',
  'Disconnect removes local tokens. --revoke ALSO requests Google project-grant',
  'revocation, which may affect other connections for that project/account.',
  'See sheets/auth/README.md for setup, restart, scheduler and recovery operations.',
].join('\n');
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  const [command, ...args] = argv;
  if (!['connect', 'status', 'refresh', 'disconnect'].includes(command)) throw fault('SHEETS_OAUTH_COMMAND_REQUIRED', HELP);
  const allowed = command === 'connect' ? ['--directory', '--client', '--port'] :
    command === 'disconnect' ? ['--directory', '--revoke'] : ['--directory'];
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!allowed.includes(key) || Object.hasOwn(options, key)) throw fault('SHEETS_OAUTH_OPTION_INVALID', key);
    if (key === '--revoke') { options[key] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw fault('SHEETS_OAUTH_OPTION_REQUIRED', key);
    options[key] = value;
  }
  if (!options['--directory']) throw fault('SHEETS_OAUTH_DIRECTORY_REQUIRED');
  const directory = resolve(options['--directory']);
  let result;
  if (command === 'connect') {
    if (options['--client']) await initializeGoogleConnection(directory, resolve(options['--client']));
    const port = options['--port'] === undefined ? 0 : Number(options['--port']);
    const controller = new AbortController(), stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const window = await serveGoogleConnection({ directory, port, signal: controller.signal });
      process.stdout.write(JSON.stringify({ action: 'open_connection_window', url: window.url, ...await window.status() }, null, 2) + '\n');
      await window.done;
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return;
  }
  if (command === 'status') result = await googleConnectionStatus(directory);
  if (command === 'refresh') result = await refreshGoogleConnection(directory);
  if (command === 'disconnect') result = await disconnectGoogleConnection(directory, { revoke: Boolean(options['--revoke']) });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    process.stderr.write((issue.code?.startsWith('SHEETS_OAUTH_') ? issue.code + ': ' + issue.message :
      'SHEETS_OAUTH_FAILED: The private connection operation could not complete.') + '\n'); process.exitCode = 1;
  });
