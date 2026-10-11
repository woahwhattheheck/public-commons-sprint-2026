#!/usr/bin/env node
// MIT. Open the original customer runtime workflow in a private operator browser.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntimeWorkspace, openRuntimeWorkspace } from './model.mjs';
import { startRuntimeWorkspace } from './server.mjs';
import { fail, json } from './storage.mjs';

const HELP = `Starforge customer runtime workspace

  runtime-workspace init --workspace NEW_DIRECTORY [--runtime-home PRIVATE_DIRECTORY]
  runtime-workspace attach --workspace DIRECTORY --runtime EXISTING_RUNTIME [--label NAME]
  runtime-workspace serve --workspace DIRECTORY [--port 8465]
  runtime-workspace status --workspace DIRECTORY [--runtime-id ID]
  runtime-workspace handoff --workspace DIRECTORY --runtime-id ID

The private browser receives an original archive or reuses an existing runtime,
reviews exact dependency profiles, prepares and resumes original installations,
compares upgrades, recovers into a new directory and exports the original
source/dependency roots for the existing host and SF46 release controls.
Install workers retain progress and continue across browser/server restarts.
Linux, Node22.16+, Python3.11+, npm and flock are the original installer requirements.
`;
const allowed = {
  init: ['--workspace', '--runtime-home'], attach: ['--workspace', '--runtime', '--label'],
  serve: ['--workspace', '--port'], status: ['--workspace', '--runtime-id'], handoff: ['--workspace', '--runtime-id'],
};
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  const [command, ...rest] = argv, options = {};
  if (!allowed[command] || rest.length % 2) fail('RUNTIME_WORKSPACE_ARGUMENTS_INVALID');
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!allowed[command].includes(key) || Object.hasOwn(options, key) || !rest[i + 1] || rest[i + 1].startsWith('--'))
      fail('RUNTIME_WORKSPACE_ARGUMENTS_INVALID');
    options[key] = rest[i + 1];
  }
  if (!options['--workspace']) fail('RUNTIME_WORKSPACE_DIRECTORY_REQUIRED');
  const directory = resolve(options['--workspace']);
  if (command === 'init') {
    process.stdout.write(json(await createRuntimeWorkspace({ directory,
      ...(options['--runtime-home'] ? { runtimeHome: resolve(options['--runtime-home']) } : {}) })));
    return;
  }
  if (command === 'serve') {
    if (options['--port'] !== undefined && !/^(0|[1-9][0-9]{0,4})$/.test(options['--port'])) fail('RUNTIME_WORKSPACE_PORT_INVALID');
    const server = await startRuntimeWorkspace({ directory, port: options['--port'] === undefined ? 8465 : Number(options['--port']) });
    process.stdout.write('Runtime workspace: ' + server.url + '\nOriginal install workers retain their progress when this browser server closes.\n');
    let closing = false;
    const stop = async () => {
      if (closing) return; closing = true;
      try { await server.close(); }
      catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
      finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return;
  }
  const model = await openRuntimeWorkspace({ directory });
  let result;
  if (command === 'attach') {
    if (!options['--runtime']) fail('RUNTIME_WORKSPACE_RUNTIME_REQUIRED');
    result = await model.attach({ directory: resolve(options['--runtime']), label: options['--label'] });
  } else if (command === 'handoff') {
    if (!options['--runtime-id']) fail('RUNTIME_WORKSPACE_RUNTIME_ID_REQUIRED');
    result = await model.handoff(options['--runtime-id']);
  } else result = await model.state({ runtimeId: options['--runtime-id'] ?? null });
  process.stdout.write(json(result));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write(json({ error: error.code ?? 'RUNTIME_WORKSPACE_ERROR', message: error.message })); process.exitCode = 1; });
