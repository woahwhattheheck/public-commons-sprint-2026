#!/usr/bin/env node
// MIT. Forward the maintained merchant commands to their Python implementation.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn(process.env.STARFORGE_PYTHON || 'python3',
  [fileURLToPath(new URL('./cli.py', import.meta.url)), ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env, shell: false, windowsHide: true });
const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]));
for (const [signal, handler] of handlers) process.on(signal, handler);
child.once('error', () => { console.error('API_PASS_PYTHON_UNAVAILABLE'); process.exitCode = 1; });
child.once('exit', code => {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  process.exitCode = code ?? 1;
});
