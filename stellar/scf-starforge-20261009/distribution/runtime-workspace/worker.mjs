#!/usr/bin/env node
// MIT. One retained workspace operation; the original installer owns npm and its lease.
import { executeRuntimeWorkspaceOperation } from './model.mjs';
import { json, runtimeWorkspaceError } from './storage.mjs';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--workspace' || args[2] !== '--operation') {
  process.stderr.write('Expected --workspace DIRECTORY --operation UUID\n');
  process.exitCode = 1;
} else {
  executeRuntimeWorkspaceOperation({ directory: args[1], operation: args[3] }).then(result => {
    process.exitCode = result.phase === 'SUCCEEDED' ? 0 : 1;
  }).catch(error => {
    const diagnostic = runtimeWorkspaceError(error, 'RUNTIME_WORKSPACE_WORKER_ERROR', Infinity);
    process.stderr.write(diagnostic.code + ': ' + diagnostic.message + '\n');
    if (diagnostic.flock) process.stderr.write(json({ error: diagnostic.code, flock: diagnostic.flock }));
    process.exitCode = error.code === 'RUNTIME_WORKSPACE_OPERATION_RUNNING' ? 75 : 1;
  });
}
