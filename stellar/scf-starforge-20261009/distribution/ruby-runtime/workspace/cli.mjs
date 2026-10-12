#!/usr/bin/env node
// MIT. Foreground launcher for the complete original managed Ruby workspace.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRubyRuntime } from '../model.mjs';
import { serveRubyRuntimeWorkspace } from './server.mjs';
import { inspectRubyRuntimeLaunch, rubyRuntimeWorkspaceStartup } from './launch.mjs';

const HELP = `Managed Ruby workspace

  node distribution/ruby-runtime/cli.mjs serve --directory DIR [--create] [--port 8474] [--startup-json]
  node distribution/ruby-runtime/workspace/cli.mjs --directory DIR [--create] [--port 8474] [--startup-json]

--directory     Original private runtime directory, resolved from the current directory.
--create        Initialize that selected directory if needed; its parent must already exist.
--port          Loopback browser port, 0–65535; 0 chooses an available port.
--startup-json  Emit one compact Applications startup record with the private browser URL.
--help          Show this help.

The desk binds to 127.0.0.1. Open the complete URL, including its session fragment.
SIGINT or SIGTERM closes this browser service and drains its admitted file operations.
Use the selected operation's Cancel action to stop an independently owned native worker.
`;

function options(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw Object.assign(new Error('Use a list of original command arguments.'), { code: 'RUBY_DESK_ARGUMENTS' });
  const words = [...argv];
  if (words[0] === 'serve') words.shift();
  const result = { create: false, port: 8474, startupJson: false, help: false }, seen = new Set();
  while (words.length) {
    const key = words.shift();
    if (seen.has(key)) throw Object.assign(new Error('Select ' + key + ' once.'), { code: 'RUBY_DESK_ARGUMENTS' });
    seen.add(key);
    if (key === '--help' || key === '-h') result.help = true;
    else if (key === '--create') result.create = true;
    else if (key === '--startup-json') result.startupJson = true;
    else if (key === '--directory' || key === '--port') {
      const value = words.shift();
      if (value === undefined || value.startsWith('--'))
        throw Object.assign(new Error('Supply a value for ' + key + '.'), { code: 'RUBY_DESK_ARGUMENTS' });
      if (key === '--directory') result.directory = resolve(value);
      else {
        if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 65535)
          throw Object.assign(new Error('Choose a browser port from 0 to 65535.'), { code: 'RUBY_DESK_PORT' });
        result.port = Number(value);
      }
    } else throw Object.assign(new Error('Unknown Ruby workspace option: ' + key), { code: 'RUBY_DESK_ARGUMENTS' });
  }
  if (!result.help && !result.directory)
    throw Object.assign(new Error('Select --directory for the original private runtime workspace.'), { code: 'RUBY_DESK_DIRECTORY' });
  return result;
}
export async function main(argv = process.argv.slice(2), { stdout = process.stdout } = {}) {
  const selected = options(argv);
  if (selected.help) { stdout.write(HELP); return null; }
  let workspace, service, stopRequested = false, finish, fail, startup;
  const ended = new Promise((accept,reject) => { finish=accept; fail=reject; });
  ended.catch(() => {}); // Retain a launch-time server error until the awaited foreground boundary.
  // Register before opening so a shutdown during initial source reading is retained.
  const stop = () => { stopRequested = true; finish(); };
  const failed = error => fail(error);
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    workspace = await openRubyRuntime({ directory: selected.directory, create: selected.create });
    if (stopRequested) return null;
    const launch = await inspectRubyRuntimeLaunch({ directory: selected.directory });
    if (stopRequested) return null;
    service = await serveRubyRuntimeWorkspace({ workspace, port: selected.port });
    service.server.on('error', failed);
    if (stopRequested) return null;
    startup = await rubyRuntimeWorkspaceStartup({ launch, workspace, service });
    if (stopRequested) return null;
    stdout.write(selected.startupJson ? JSON.stringify(startup) + '\n' :
      'Ruby runtime desk\n' + startup.url + '\nDirectory: ' + startup.directory + '\n');
    await ended;
    return startup;
  } finally {
    try {
      if (service) {
        try { await service.close(); } finally { service.server.off('error', failed); }
      } else if (workspace) await workspace.close();
    } finally {
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'RUBY_DESK_FAILED', message: error.message } }) + '\n');
    process.exitCode = 1;
  });
}
