// MIT. Installed Macrobond CLI through the retained Python catalog and original operator.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function main(args = process.argv.slice(2)) {
  const executable = process.env.SF30_SDMX_PYTHON || process.env.SF30_XML_PYTHON ||
    (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(executable, ['-B', fileURLToPath(new URL('./cli.py', import.meta.url)), ...args], {
    stdio: 'inherit', shell: false,
    env: { ...process.env,
      SF30_SDMX_NODE: process.env.SF30_SDMX_NODE || process.execPath,
      SF30_XML_NODE: process.env.SF30_XML_NODE || process.execPath },
  });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    const code = await new Promise((accept, reject) => {
      child.once('error', () => reject(new Error('Python 3.11+ is required; set SF30_SDMX_PYTHON to its executable.')));
      child.once('close', (code, signal) => accept(code ?? (signal === 'SIGTERM' ? 143 : 130)));
    });
    process.exitCode = code;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'MACROBOND', message: error.message }) + '\n');
    process.exitCode = 1;
  });
