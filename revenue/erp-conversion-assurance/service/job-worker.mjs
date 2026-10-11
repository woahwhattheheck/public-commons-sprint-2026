#!/usr/bin/env node
// MIT. Child of the configured service; retains the original kernel lease.
import { runReconciliationWorker } from './service.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--directory' || !args[1]) {
  process.stderr.write('Usage: node job-worker.mjs --directory PRIVATE_DIRECTORY\n');
  process.exitCode = 1;
} else {
  runReconciliationWorker(args[1]).catch(error => {
    process.stderr.write((error.code ?? 'WORKER_FAILED') + '\n');
    process.exitCode = 1;
  });
}
