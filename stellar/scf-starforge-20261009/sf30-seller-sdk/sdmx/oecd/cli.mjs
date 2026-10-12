#!/usr/bin/env node
/** MIT. Installed OECD CLI, native receiver and MCP launch. */
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runOecdMcp } from './mcp.mjs';

export async function runOecdCli(argv = process.argv.slice(2)) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) {
    process.stdout.write('OECD analyst and customer workspace\n\n' +
      'oecd init|status|seed|capture|refresh|preview|save|briefing|compare|activate|export-dataset|export-customer|export-project|import|serve --project DIR [options]\n' +
      'oecd mcp --project DIR [--create] [--python COMMAND] [--connection-file FILE]\n' +
      'oecd receive --project DIR --config FILE\n\n' +
      'Use --request FILE (or - for stdin), --manifest FILE, --id ID and --packet FILE for complete original operations.\n' +
      'Python command defaults to SF30_OECD_PYTHON or python3. Native Node source engine uses the same current Node executable.\n');
    return 0;
  }
  let python = process.env.SF30_OECD_PYTHON || 'python3';
  const args = [...argv];
  const pythonAt = args.indexOf('--python');
  if (pythonAt !== -1) {
    if (!args[pythonAt + 1]) throw new Error('--python requires the original interpreter command');
    python = args[pythonAt + 1]; args.splice(pythonAt, 2);
  }
  if (args[0] === 'mcp') {
    const opts = { pythonCommand: python, env: { ...process.env, SF30_XML_NODE: process.execPath } };
    const names = { '--project': 'projectDirectory', '--connection-file': 'connectionFile',
      '--provider-username-env': 'providerUsernameEnv', '--provider-password-env': 'providerPasswordEnv' };
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--create') opts.create = true;
      else if (names[args[i]] && args[i + 1]) opts[names[args[i]]] = args[++i];
      else throw new Error('Unknown MCP option: ' + args[i]);
    }
    if (!opts.projectDirectory && !opts.connectionFile) throw new Error('MCP requires --project or --connection-file');
    await runOecdMcp(opts); return 0;
  }
  if (args[0] === 'receive') {
    const { runOecdReceivingCli } = await import('./receiving.mjs');
    return runOecdReceivingCli(args.slice(1), { pythonCommand: python });
  }
  const script = fileURLToPath(new URL('./cli.py', import.meta.url));
  const child = spawn(python, [script, ...args], {
    env: { ...process.env, SF30_XML_NODE: process.execPath }, stdio: 'inherit', windowsHide: true,
  });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    return await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
    });
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runOecdCli().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(error.message + '\n'); process.exitCode = 1;
  });
}
