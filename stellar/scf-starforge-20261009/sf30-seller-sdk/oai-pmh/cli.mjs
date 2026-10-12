#!/usr/bin/env node
// MIT. Installed launcher for the original retained OAI repository workspace.
import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function main(args = process.argv.slice(2)) {
  let input = [...args];
  let python = process.env.SF30_OAI_PYTHON || process.env.SF30_XML_PYTHON || 'python3';
  if (input[0] === '--python') {
    if (typeof input[1] !== 'string' || !isAbsolute(input[1]) || input[1].includes('\0'))
      throw new TypeError('Choose an absolute Python executable after --python.');
    python = input[1];
    input = input.slice(2);
  }
  if (!input.length) input = ['--help'];
  const child = spawn(python,
    [fileURLToPath(new URL('./cli.py', import.meta.url)), ...input], {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, SF30_XML_NODE: process.execPath },
    });
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    const code = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', (status, signal) =>
        done(status ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)));
    });
    if (code) process.exitCode = code;
    return code;
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write('OAI: ' + error.message + '\n');
    process.exitCode = 1;
  });
