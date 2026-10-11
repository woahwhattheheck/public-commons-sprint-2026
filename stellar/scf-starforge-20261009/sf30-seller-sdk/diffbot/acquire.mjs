#!/usr/bin/env node
// MIT. Forward to the original Diffbot Python acquisition client.
import {spawn} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {constants} from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function main(args = process.argv.slice(2), {
  python = process.env.DIFFBOT_PYTHON_EXECUTABLE || 'python3',
} = {}) {
  if (typeof python !== 'string' || !python || !Array.isArray(args) ||
      !args.every(value => typeof value === 'string')) {
    throw new TypeError('Use a Python executable and unchanged string arguments.');
  }
  return new Promise((resolveRun, reject) => {
    const child = spawn(python, [join(HERE, 'acquisition.py'), ...args], {
      stdio: 'inherit', shell: false, windowsHide: true,
    });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    const detach = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.once('error', error => {detach(); reject(error);});
    child.once('close', (code, signal) => {
      detach();
      process.exitCode = code ?? 128 + (constants.signals[signal] ?? 1);
      resolveRun({code: process.exitCode, signal});
    });
  });
}

if (process.argv[1] && await realpath(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('Diffbot acquisition: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
