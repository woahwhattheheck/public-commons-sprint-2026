#!/usr/bin/env node
// MIT. Installed front door to the retained Chainstack buyer and original SF88 runtime.
import { realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const actions = new Set(['review', 'execute', 'inspect', 'recover']);
const help = `Chainstack installed buyer

  starforge chainstack-buyer paths
  starforge chainstack-buyer node review --state DIR --request DIR --review-file NEW_FILE [--profile FILE]
  starforge chainstack-buyer python review --state DIR --request DIR --review-file NEW_FILE [--profile FILE]
  starforge chainstack-buyer node|python execute --state DIR --intent ID --review-file FILE [--output NEW_FILE]
  starforge chainstack-buyer node|python inspect --state DIR --intent ID
  starforge chainstack-buyer node|python recover --state DIR --intent ID [--output NEW_FILE]

Both languages use the original buyer runtime shipped in this installed package.
The selected request, private state and original approval remain caller inputs.
Python uses python3 from the operator's configured PATH.
`;

/** Resolve the original runtimes relative to this same source installation. */
export async function installedBuyerRuntime() {
  const sourceRoot = await realpath(fileURLToPath(new URL('../../../../', import.meta.url)));
  const nodeRuntime = await realpath(fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url)));
  const paths = {
    schema: 'stellar-forge.chainstack-installed-buyer.v1',
    sourceRoot,
    nodeRuntime,
    pythonCheckout: sourceRoot,
    nodeBuyer: fileURLToPath(new URL('./buyer.mjs', import.meta.url)),
    pythonBuyer: fileURLToPath(new URL('./buyer.py', import.meta.url)),
    installationExample: fileURLToPath(new URL('./example-installation.json', import.meta.url)),
    installedGuide: fileURLToPath(new URL('./INSTALLED.md', import.meta.url)),
    operatorGuide: fileURLToPath(new URL('./README.md', import.meta.url)),
    buyerGuide: fileURLToPath(new URL('./BUYER.md', import.meta.url)),
  };
  for (const filename of [paths.nodeBuyer, paths.pythonBuyer, paths.installationExample,
    paths.installedGuide, paths.operatorGuide, paths.buyerGuide,
    resolve(nodeRuntime, 'node/index.mjs'), resolve(nodeRuntime, 'python/stellar_forge_buyer/__init__.py')]) {
    if (!(await stat(filename)).isFile()) throw new TypeError('Original installed buyer source is incomplete');
  }
  return Object.freeze(paths);
}

/** Forward one operation to the frozen buyer wrapper with its own installed runtime. */
export async function runInstalledBuyer({ language, action, args = [], signal } = {}) {
  if (!['node', 'python'].includes(language) || !actions.has(action))
    throw new TypeError('Choose node or python and review, execute, inspect or recover');
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string'))
    throw new TypeError('Buyer arguments must be an array of strings');
  const runtimeOptions = ['--runtime', '--checkout'];
  if (args.some(value => value.startsWith('--') &&
      runtimeOptions.some(option => option.startsWith(value.split('=', 1)[0]))))
    throw new TypeError('The installed command selects its original packaged buyer runtime');
  const runtime = await installedBuyerRuntime();
  const executable = language === 'node' ? process.execPath : 'python3';
  const forwarded = language === 'node'
    ? [runtime.nodeBuyer, action, '--runtime', runtime.nodeRuntime, ...args]
    : [runtime.pythonBuyer, action, '--checkout', runtime.pythonCheckout, ...args];
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, forwarded, { stdio: 'inherit', shell: false, windowsHide: true, signal });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    const detach = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', error => { detach(); reject(error); });
    child.once('exit', (code, exitSignal) => {
      detach(); resolveRun({ code, signal: exitSignal });
    });
  });
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.some(value => ['--help', '-h'].includes(value))) {
    process.stdout.write(help); return;
  }
  if (args[0] === 'paths') {
    if (args.length !== 1) throw new TypeError('paths takes no arguments');
    process.stdout.write(JSON.stringify(await installedBuyerRuntime(), null, 2) + '\n'); return;
  }
  const [language, action, ...forwarded] = args;
  const result = await runInstalledBuyer({ language, action, args: forwarded });
  process.exitCode = result.code ?? 128 + (constants.signals[result.signal] ?? 1);
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  filename => pathToFileURL(filename).href === import.meta.url, () => false))
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
