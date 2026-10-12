// MIT. Installed command for the original Python ClinicalTrials operator.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function main(args = process.argv.slice(2)) {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), 'cli.py');
  const python = process.env.SF30_XML_PYTHON || 'python3';
  const child = spawn(python, [source, ...args], {
    stdio: 'inherit', env: { ...process.env, SF30_XML_NODE: process.execPath },
  });
  const forward = signal => { if (!child.killed) child.kill(signal); };
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    const result = await new Promise((accept, reject) => {
      child.once('error', reject); child.once('exit', (code, signal) => accept(code ?? (signal ? 128 : 1)));
    });
    if (result) process.exitCode = result;
    return result;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
