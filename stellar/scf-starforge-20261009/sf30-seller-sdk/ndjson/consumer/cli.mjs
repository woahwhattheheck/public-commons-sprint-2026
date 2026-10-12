// MIT. Installed launcher for original NDJSON customer receiving and restoration.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const python = process.env.SF30_PYTHON || 'python3';
const child = spawn(python, [fileURLToPath(new URL('./receive.py', import.meta.url)), ...process.argv.slice(2)],
  { shell: false, stdio: 'inherit', env: process.env });
const interrupt = () => child.kill('SIGINT');
const terminate = () => child.kill('SIGTERM');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
try {
  process.exitCode = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code, signal) => done(code ?? (signal ? 130 : 1)));
  });
} catch (error) {
  console.error('NDJSON customer: ' + error.message); process.exitCode = 1;
} finally {
  process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
}
