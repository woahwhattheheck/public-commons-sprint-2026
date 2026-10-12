#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// The installed command invokes the original Python operator and retains its child through Stop.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function runQwcOperator(input = process.argv.slice(2), options = {}) {
  const args = [...input];
  let python = options.python ?? process.env.STARFORGE_QWC_PYTHON ?? 'python3';
  const positions = args.map((arg, index) => arg === '--python' ? index : -1).filter(index => index >= 0);
  if (positions.length > 1 || positions.length === 1 && !args[positions[0] + 1]) {
    throw new Error('Select the original operator Python once with --python ABSOLUTE_EXECUTABLE.');
  }
  if (positions.length) {
    python = args[positions[0] + 1];
    args.splice(positions[0], 2);
  }
  if (typeof python !== 'string' || !python || python.includes('\0')) throw new Error('Select the existing operator Python.');
  const script = fileURLToPath(new URL('./cli.py', import.meta.url));
  let child = null;
  let firstSignal = null;
  let delivered = false;
  const signalCodes = { SIGINT: 130, SIGTERM: 143 };
  const forward = () => {
    if (child && firstSignal && !delivered) {
      delivered = true;
      if (child.exitCode === null && child.signalCode === null) child.kill(firstSignal);
    }
  };
  const handlers = Object.fromEntries(Object.keys(signalCodes).map(name => [name, () => {
    firstSignal ??= name;
    forward();
  }]));
  for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
  try {
    child = spawn(python, ['-B', script, ...args], {
      stdio: 'inherit', windowsHide: true, env: options.environment ?? process.env,
    });
    forward();
    const result = await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => accept({ code, signal }));
    });
    return firstSignal ? signalCodes[firstSignal] : result.code ?? signalCodes[result.signal] ?? 1;
  } finally {
    // All terminal signal handlers remain attached through the actual native close.
    if (child && child.exitCode === null && child.signalCode === null && child.pid) {
      firstSignal ??= 'SIGTERM';
      forward();
      await new Promise(accept => child.once('close', accept));
    }
    for (const [name, handler] of Object.entries(handlers)) process.removeListener(name, handler);
  }
}

const main = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (main) {
  try { process.exitCode = await runQwcOperator(); }
  catch (error) { process.stderr.write(String(error.message ?? error) + '\n'); process.exitCode = 2; }
}
