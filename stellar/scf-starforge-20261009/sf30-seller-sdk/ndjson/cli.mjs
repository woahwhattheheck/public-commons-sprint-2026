// MIT. Forward the installed source command to its dependency-free Python operator.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export async function main(args = process.argv.slice(2)) {
  const executable = process.env.SF30_NDJSON_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(executable, [fileURLToPath(new URL('./cli.py', import.meta.url)), ...args], {
    stdio: 'inherit', shell: false, env: { ...process.env, SF30_XML_NODE: process.execPath },
  });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const code = await new Promise((yes, no) => {
      child.once('error', () => no(new Error('Python 3.11+ is required; set SF30_NDJSON_PYTHON to its executable')));
      child.once('exit', (code, signal) => yes(code ?? (signal ? 130 : 1)));
    });
    process.exitCode = code;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(`NDJSON dataset: ${error.message}`); process.exitCode = 1; });
