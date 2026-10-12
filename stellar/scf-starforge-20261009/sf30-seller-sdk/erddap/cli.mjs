// MIT. Installed Node entry point for the original ERDDAP/SF30 and SF88 workflows.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'merchant') return (await import('./merchant.mjs')).main(args.slice(1));
  if (args[0] === 'buyer') return (await import('./customer.mjs')).main(args.slice(1));
  const provider = args[0] === 'provider-handoff';
  const python = process.env.SF30_ERDDAP_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  const script = provider ? './provider_handoff_cli.py' : './cli.py';
  const child = spawn(python, ['-B', fileURLToPath(new URL(script, import.meta.url)), ...(provider ? args.slice(1) : args)], {
    stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', SF30_XML_NODE: process.execPath }
  });
  const onInt = () => child.kill('SIGINT'), onTerm = () => child.kill('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  try {
    const code = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
    });
    if (code) process.exitCode = code;
  } finally {
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({error:'ERDDAP_CLI',message:error.message})+'\n');process.exitCode=1; });
