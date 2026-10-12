#!/usr/bin/env node
// MIT. Installed command for the same original Study Python CLI and HTTP operator.
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
let python = process.env.STUDY_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
if (args[0] === '--python') {
  if (typeof args[1] !== 'string' || !isAbsolute(args[1]) || args[1].includes('\0')) {
    process.stderr.write('study-source-refresh --python requires an absolute executable path before --workspace or the command.\n');
    process.exitCode = 2;
  } else python = args.splice(0, 2)[1];
}
if (process.exitCode === undefined) {
  const child = spawn(python, ['-B', fileURLToPath(new URL('./cli.py', import.meta.url)), ...args],
    {stdio:'inherit', shell:false, env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'}});
  const signal = name => { if (child.exitCode === null && child.signalCode === null) child.kill(name); };
  const interrupt = () => signal('SIGINT'), terminate = () => signal('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  child.once('error', error => {
    process.stderr.write('Study Python operator could not start: ' + error.message +
      '\nSelect --python /absolute/executable or STUDY_PYTHON.\n');
    process.exitCode = 127;
  });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
}
