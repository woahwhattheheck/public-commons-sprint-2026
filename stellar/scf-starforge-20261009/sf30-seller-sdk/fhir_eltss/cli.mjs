#!/usr/bin/env node
// MIT. eLTSS operator through the maintained native Python and merchant engines.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function main(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error('Use Node 22 or newer for the original eLTSS runtime.');
  if (args[0] === 'merchant') return (await import('./merchant.mjs')).main(args.slice(1));
  if (args[0] === 'customer') return (await import('./customer.mjs')).main(args.slice(1));
  const python = process.env.SF30_ELTSS_PYTHON || process.env.SF30_FHIR_PYTHON ||
    process.env.SF30_XML_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  const child = spawn(python, ['-B', resolve(dirname(fileURLToPath(import.meta.url)), 'cli.py'), ...args], {
    stdio: 'inherit',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
      SF30_XML_NODE: process.env.SF30_XML_NODE || process.execPath,
      SF30_FHIR_NODE: process.env.SF30_FHIR_NODE || process.execPath,
      SF30_ELTSS_NODE: process.env.SF30_ELTSS_NODE || process.execPath },
  });
  const forwardInt = () => child.kill('SIGINT'), forwardTerm = () => child.kill('SIGTERM');
  process.on('SIGINT', forwardInt); process.on('SIGTERM', forwardTerm);
  try {
    return await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolveExit(code ?? (signal === 'SIGINT' ? 130 : 143)));
    });
  } finally {
    process.removeListener('SIGINT', forwardInt); process.removeListener('SIGTERM', forwardTerm);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => { if (Number.isInteger(result)) process.exitCode = result; }).catch(error => {
    process.stderr.write((error?.stack ?? String(error)) + '\n'); process.exitCode = 1;
  });
}
