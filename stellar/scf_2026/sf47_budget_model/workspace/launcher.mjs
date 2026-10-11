#!/usr/bin/env node
// Maintained starforge launcher bridge to the original stdlib Python operator.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const executable = process.env.SF47_PYTHON || 'python3';
const entry = fileURLToPath(new URL('./cli.py', import.meta.url));
const child = spawn(executable, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
const forward = signal => { if (!child.killed) child.kill(signal); };
const sigint = () => forward('SIGINT');
const sigterm = () => forward('SIGTERM');
process.on('SIGINT', sigint);
process.on('SIGTERM', sigterm);
child.once('error', error => {
  process.stderr.write(`SF47 Python operator could not start: ${error.message}\nInstall Python 3, or set SF47_PYTHON to its executable path.\n`);
  process.exitCode = 127;
});
child.once('exit', (code, signal) => {
  process.removeListener('SIGINT', sigint);
  process.removeListener('SIGTERM', sigterm);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
