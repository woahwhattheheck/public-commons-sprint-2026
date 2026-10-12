// MIT. Run the saved original 360Giving workspace with the selected Python.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function main(args = process.argv.slice(2)) {
  args = [...args];
  const explicit = args[0] === '--python';
  if (explicit && (!args[1] || args[1].startsWith('--')))
    throw new Error('Supply the selected Python executable after --python');
  const executable = explicit ? args.splice(0, 2)[1]
    : process.env.SF30_NDJSON_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const example = args[0] === 'example';
  if (example) args.shift();
  const program = new URL(example ? './run_complete_workflow.py' : './cli.py', import.meta.url);
  const child = spawn(executable, [fileURLToPath(program), ...args], {
    stdio: 'inherit', shell: false,
    env: { ...process.env, SF30_XML_NODE: process.env.SF30_XML_NODE || process.execPath,
      PYTHONDONTWRITEBYTECODE: '1' },
  });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const code = await new Promise((yes, no) => {
      child.once('error', error => no(new Error(
        'Could not start the selected Python 3.11+ executable; use --python or SF30_NDJSON_PYTHON: ' + error.message)));
      child.once('exit', (code, signal) => yes(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)));
    });
    process.exitCode = code;
    return code;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('360Giving workspace: ' + error.message); process.exitCode = 1; });
