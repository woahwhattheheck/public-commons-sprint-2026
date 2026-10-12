// MIT. Retained feed operator and original merchant/buyer entry points.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, isAbsolute } from 'node:path';

export async function main(input = process.argv.slice(2)) {
  let python = process.env.SF30_FEED_PYTHON || process.env.SF30_XML_PYTHON || 'python3';
  if (input[0] === '--python') {
    if (typeof input[1] !== 'string' || !isAbsolute(input[1]) || input[1].includes('\0'))
      throw new TypeError('Choose an absolute existing Python executable');
    python = input[1]; input = input.slice(2);
  }
  if (input[0] === 'merchant' || input[0] === 'buyer')
    return (await import('./merchant.mjs')).main(input);
  if (!input.length || input.length === 1 && input[0] === '--help') {
    process.stdout.write('RSS 2.0 / Atom 1.0 retained feeds\n\n' +
      '  feeds [--python EXECUTABLE] --workspace DIR init|serve|binding|subscriptions|register|capture|review|apply|records|edition|query|compare|export|project|receive\n' +
      '  feeds merchant --help     Prepare the original SF82 dataset release\n' +
      '  feeds buyer --help        Review the live original offer and prepare SF88 acquisition\n\n' +
      'Python 3.11+ and Node 22+; feed capture and native datasets use the standard library.\n\n');
    input = ['--help'];
  }
  const child = spawn(python,
    [fileURLToPath(new URL('./cli.py', import.meta.url)), ...input], {
      stdio: 'inherit', env: { ...process.env, SF30_XML_NODE: process.execPath },
    });
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    const code = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', (status, signal) => done(status ?? (signal === 'SIGINT' ? 130 : 1)));
    });
    if (code) process.exitCode = code;
    return code;
  } finally { for (const [signal, handler] of handlers) process.removeListener(signal, handler); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write('Feeds: ' + error.message + '\n'); process.exitCode = 1; });
