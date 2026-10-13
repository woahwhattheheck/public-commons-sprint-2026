#!/usr/bin/env node
// MIT. Installed command for the unchanged Runtime Companion archive consumer.
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import original from './toolkit/host/runtime_companion_archive.cjs';

const HELP = `Runtime Companion archive receiving

starforge runtime-companion-archive receive --input PACKET --sha256 SHA --directory PRIVATE_RECEIVING --workspace EXISTING_WORKSPACE --workspace-id UUID --name SET_NAME --python ABSOLUTE_PYTHON [--node ABSOLUTE_NODE]
starforge runtime-companion-archive review --directory SAME_RECEIVING --workspace SAME_WORKSPACE --workspace-id SAME_UUID
starforge runtime-companion-archive prepare --directory SAME_RECEIVING --workspace SAME_WORKSPACE --workspace-id SAME_UUID --request-id ORIGINAL_UUID --kind APPLICATION_KIND --field PATH_SETTING [--member ORIGINAL_MEMBER]
starforge runtime-companion-archive export --directory SAME_RECEIVING --workspace SAME_WORKSPACE --workspace-id SAME_UUID --output INDEPENDENT_PRIVATE_DIRECTORY

The trusted Runtime source is the adjacent installed runtime-workspace. Do not
supply --runtime-source to this installed command. Use the unchanged toolkit
entry directly when explicitly selecting a different trusted source installation.
Receive into the existing workspace UUID. No workspace is created and no
application is saved or started. Original input/set limits and recovery apply.
Use starforge runtime-companion-source --help to create the original input packet.
`;

/** Add only the installed source location; the original parser owns all options. */
export function installedArguments(argv, runtimeSource) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw new TypeError('Supply the original command argument strings.');
  if (argv.some(value => value === '--runtime-source' || value.startsWith('--runtime-source=')))
    throw new TypeError('This installed command uses its adjacent trusted Runtime source; omit --runtime-source.');
  const command = argv[0];
  if (!command || ['help', '--help', '-h'].includes(command)) {
    if (argv.length > 1) throw new TypeError('Help takes no other arguments.');
    return ['help'];
  }
  if (!['receive', 'review', 'prepare', 'export'].includes(command))
    throw new TypeError('Choose receive, review, prepare or export.');
  if (typeof runtimeSource !== 'string' || !runtimeSource)
    throw new TypeError('The installed Runtime source is required.');
  const forwarded = [...argv, '--runtime-source', runtimeSource];
  original.argumentsFor([...forwarded]);
  return forwarded;
}
export async function main(argv = process.argv.slice(2)) {
  // Help and option validation do not open or mutate a workspace.
  const location = fileURLToPath(new URL('../runtime-workspace/', import.meta.url));
  const args = installedArguments(argv, location);
  if (args[0] === 'help') { process.stdout.write(HELP); return 0; }
  const trusted = await realpath(location);
  return original.main(installedArguments(argv, trusted));
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  path => pathToFileURL(path).href === import.meta.url, () => false))
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({state:'ERROR',code:error.code ?? error.name,message:error.message}) + '\n');
    process.exitCode = 1;
  });
