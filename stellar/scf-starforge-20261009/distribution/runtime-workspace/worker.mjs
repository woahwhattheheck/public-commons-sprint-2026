#!/usr/bin/env node
// MIT. One retained workspace operation; the original installer owns npm and its lease.
import { executeRuntimeWorkspaceOperation } from './model.mjs';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--workspace' || args[2] !== '--operation') {
  process.stderr.write('Expected --workspace DIRECTORY --operation UUID\n');
  process.exitCode = 1;
} else {
  executeRuntimeWorkspaceOperation({ directory: args[1], operation: args[3] }).then(result => {
    process.exitCode = result.phase === 'SUCCEEDED' ? 0 : 1;
  }).catch(error => {
    process.stderr.write((error.code ?? 'RUNTIME_WORKSPACE_WORKER_ERROR') + ': ' + error.message + '\n');
    process.exitCode = error.code === 'RUNTIME_WORKSPACE_OPERATION_RUNNING' ? 75 : 1;
  });
}
