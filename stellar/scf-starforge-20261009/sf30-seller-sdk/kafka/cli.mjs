// MIT. Run the original Kafka workspace with its explicitly selected Python.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function main(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 22 ||
      Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) < 16)
    throw new Error('The original Kafka command requires Node 22.16 or newer');
  args = [...args];
  const explicit = args[0] === '--python';
  if (explicit && (!args[1] || args[1].startsWith('--'))) throw new Error('Supply the selected Python executable after --python');
  const executable = explicit ? args.splice(0, 2)[1]
    : process.env.SF30_KAFKA_PYTHON || process.env.SF30_XML_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(executable, [fileURLToPath(new URL('./cli.py', import.meta.url)), ...args], {
    stdio: 'inherit', shell: false, env: { ...process.env, SF30_XML_NODE: process.execPath },
  });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise((resolveCode, reject) => {
      child.once('error', () => reject(new Error('Python 3.11+ is required; use --python or SF30_KAFKA_PYTHON')));
      child.once('close', (code, signal) => resolveCode(code ?? (signal === 'SIGTERM' ? 143 : signal ? 130 : 1)));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('Kafka dataset: ' + error.message); process.exitCode = 1; });
