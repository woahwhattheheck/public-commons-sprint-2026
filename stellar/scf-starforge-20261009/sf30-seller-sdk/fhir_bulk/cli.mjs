#!/usr/bin/env node
// MIT. One installed dispatcher for the original FHIR workspace, seller and SF88 buyer.
import {spawn} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export async function main(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Use Node 22 or newer for the original SF30 runtime.');
  if (args[0] === 'merchant') return (await import('./merchant.mjs')).main(args.slice(1));
  if (args[0] === 'customer') return (await import('./customer.mjs')).main(args.slice(1));
  const python = process.env.SF30_FHIR_PYTHON || process.env.SF30_XML_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  const child = spawn(python, ['-B', resolve(dirname(fileURLToPath(import.meta.url)), 'cli.py'), ...args], {
    stdio: 'inherit', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1',
      SF30_XML_NODE: process.env.SF30_XML_NODE || process.execPath,
      SF30_FHIR_NODE: process.env.SF30_FHIR_NODE || process.execPath}
  });
  const signals = ['SIGINT', 'SIGTERM'];
  const forward = signal => {if (child.exitCode === null && child.signalCode === null) child.kill(signal);};
  const handlers = new Map(signals.map(signal => [signal, () => forward(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    return await new Promise((resolvePromise, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        const result = code ?? (signal === 'SIGINT' ? 130 : 143);
        process.exitCode = result;
        resolvePromise(result);
      });
    });
  } finally {for (const [signal, handler] of handlers) process.off(signal, handler);}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {process.stderr.write(error.message + '\n'); process.exitCode = 1;});
}
