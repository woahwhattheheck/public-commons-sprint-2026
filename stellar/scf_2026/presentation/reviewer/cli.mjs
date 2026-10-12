#!/usr/bin/env node
/** MIT. Installed reviewer receiving commands for the original SCF purchase. */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectGrantDemo, receiveGrantDemo, inspectGrantDemoWorkspace, exportGrantDemo, startGrantDemo} from './workspace.mjs';

export const help = `Stellar Forge · original grant demonstration

  starforge grant-demo workbench --dir ABSOLUTE_DIRECTORY [--packet FILE --sha256 SHA256] [--port 0]
  starforge grant-demo inspect [--packet FILE] [--sha256 SHA256]
  starforge grant-demo receive --dir ABSOLUTE_DIRECTORY [--packet FILE --sha256 SHA256]
  starforge grant-demo inspect-workspace --dir ABSOLUTE_DIRECTORY
  starforge grant-demo open --dir ABSOLUTE_DIRECTORY [--port 0] [--token-env NAME]
  starforge grant-demo export --dir ABSOLUTE_DIRECTORY --out ABSOLUTE_FILE

Workbench provides packet review, original Buyer result reads, controlled export
and receiving-copy handoff in the browser. Open it from Applications to receive
its private local connection, or use workbench-connection.json on this host.
Receive defaults to the complete public MySQL purchase included in this release.
Selected export packets require their exact SHA-256 from inspect/export.
Open starts the original private Buyer console without a signing or observation
adapter. The terminal displays a fresh access code when attached to a TTY;
otherwise read the private connection.json file in the receiving directory.
Stop open with Ctrl-C before exporting. Repeating receive preserves the same
original quote IDs, attempt counts, result bytes and completed local state.
--source-root ABSOLUTE_DIRECTORY selects an existing trusted complete source
installation for maintainers; ordinary installed use requires no override.
Guide: stellar/scf_2026/presentation/reviewer/RECEIVING.md
`;

export async function main(argv = process.argv.slice(2), environment = process.env) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(help); return;
  }
  const command = argv[0], options = {}, seen = new Set();
  const flags = {'--dir':'directory', '--packet':'packetFile', '--sha256':'expectedSha256',
    '--source-root':'sourceRoot', '--out':'output', '--port':'port', '--token-env':'tokenEnv'};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index], key = flags[flag], value = argv[index + 1];
    if (!key || seen.has(flag) || !value || value.startsWith('--'))
      throw Object.assign(new Error('Unknown, repeated or incomplete option: ' + flag), {code:'REVIEWER_ARGUMENTS'});
    seen.add(flag); options[key] = value;
  }
  const allowed = {
    workbench:['directory','packetFile','expectedSha256','sourceRoot','port'],
    inspect:['packetFile','expectedSha256','sourceRoot'],
    receive:['directory','packetFile','expectedSha256','sourceRoot'],
    'inspect-workspace':['directory','sourceRoot'],
    open:['directory','port','tokenEnv','sourceRoot'],
    export:['directory','output','sourceRoot']
  };
  if (!allowed[command] || Object.keys(options).some(key => !allowed[command].includes(key)))
    throw Object.assign(new Error('Unknown command or option for this command.'), {code:'REVIEWER_ARGUMENTS'});
  for (const key of ['directory','packetFile','sourceRoot','output']) if (options[key]) options[key] = resolve(options[key]);
  if (command === 'workbench') {
    if (options.port !== undefined) options.port = Number(options.port);
    const {startReviewerWorkbench} = await import('./workbench.mjs');
    let application, stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      try { await application?.close(); }
      catch (error) { process.stderr.write((error.code ?? 'REVIEWER_CLOSE_FAILED') + ': ' + error.message + '\n'); process.exitCode = 2; }
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      application = await startReviewerWorkbench(options);
      if (stopping) { await application.close(); return; }
      process.stdout.write(JSON.stringify(application.startup) + '\n');
      if (process.stdout.isTTY) process.stdout.write('Workbench access code: ' + application.accessToken + '\n');
      return application;
    } catch (error) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); throw error; }
  }
  if (command === 'open') {
    if (options.port !== undefined) options.port = Number(options.port);
    if (options.tokenEnv !== undefined) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.tokenEnv) || !environment[options.tokenEnv])
        throw Object.assign(new Error('The selected token environment variable is absent or invalid.'), {code:'REVIEWER_ACCESS_TOKEN_REQUIRED'});
      options.accessToken = environment[options.tokenEnv]; delete options.tokenEnv;
    }
    const application = await startGrantDemo(options);
    process.stdout.write(JSON.stringify({status:'LISTENING', consoleUrl:application.consoleUrl,
      reviewFile:application.reviewFile, connectionFile:application.connectionFile,
      packetId:application.packetId, paymentAdapterConnected:false}) + '\n');
    if (process.stdout.isTTY) process.stdout.write('Access code: ' + application.accessToken + '\n');
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      try { await application.close(); }
      catch (error) { process.stderr.write((error.code ?? 'REVIEWER_CLOSE_FAILED') + ': ' + error.message + '\n'); process.exitCode = 2; }
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return application;
  }
  const fn = {inspect:inspectGrantDemo, receive:receiveGrantDemo,
    'inspect-workspace':inspectGrantDemoWorkspace, export:exportGrantDemo}[command];
  const result = await fn(options);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write((error.code ?? 'REVIEWER_FAILED') + ': ' + error.message + '\n'); process.exitCode = 2; });
