#!/usr/bin/env node
// MIT. Installed command forwards to the original Python portfolio operator.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function main(input = process.argv.slice(2)) {
  const args = [...input], explicit = args[0] === '--python';
  if (explicit && (!args[1] || args[1].startsWith('--')))
    throw new Error('Supply the selected Python executable after --python.');
  const executable = explicit ? args.splice(0, 2)[1] :
    process.env.SF30_GRANT_PORTFOLIO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(executable, [fileURLToPath(new URL('./cli.py', import.meta.url)), ...args], {
    stdio:'inherit', shell:false,
    env:{...process.env, SF30_XML_NODE:process.execPath, SF30_NDJSON_NODE:process.execPath,
      SF30_GRANT_PORTFOLIO_NODE:process.execPath},
  });
  const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    const code = await new Promise((yes, no) => {
      child.once('error', error => no(Object.assign(new Error(
        'The selected Python could not start the original portfolio operator: ' + error.message),
      {code:'GRANT_PORTFOLIO_PYTHON_UNAVAILABLE'})));
      child.once('exit', (status, signal) => yes(status ?? (signal === 'SIGTERM' ? 143 : signal ? 130 : 1)));
    });
    process.exitCode = code; return code;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error((error.code ? error.code + ': ' : '') + error.message); process.exitCode = 1; });
