#!/usr/bin/env node
// Maintained starforge launcher bridge to the original stdlib Python operator.
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const forwarded = process.argv.slice(2);
let executable = process.env.SF47_PYTHON || 'python3';
if (forwarded[0] === '--python') {
  if (typeof forwarded[1] !== 'string' || !isAbsolute(forwarded[1]) || forwarded[1].includes('\0')) {
    process.stderr.write('SF47 --python requires an absolute executable path before the command.\n');
    process.exitCode = 2;
  } else executable = forwarded.splice(0, 2)[1];
}
if (process.exitCode === undefined) {
  const entry = fileURLToPath(new URL('./cli.py', import.meta.url));
  const child = spawn(executable, ['-B', entry, ...forwarded], { stdio:'inherit', shell:false });
  const forward = signal => { if (!child.killed) child.kill(signal); };
  const sigint = () => forward('SIGINT');
  const sigterm = () => forward('SIGTERM');
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);
  child.once('error', error => {
    process.stderr.write('SF47 Python operator could not start: ' + error.message +
      '\nInstall Python 3, or select --python /absolute/executable or SF47_PYTHON.\n');
    process.exitCode = 127;
  });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
}
