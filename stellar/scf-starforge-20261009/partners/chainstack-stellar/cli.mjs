#!/usr/bin/env node
// MIT. Operator commands delegate to the original installed merchant components.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as installation from './installation.mjs';

const definitions = {
  create: [['file', 'root', 'release'], []], stage: [['file', 'root', 'release'], []],
  status: [['root'], []], activate: [['root', 'release', 'generation'], []],
  rollback: [['root', 'generation'], []], diff: [['root', 'before', 'after'], []],
  run: [['root', 'generation'], []], console: [['root'], ['port']],
  observe: [['root', 'id', 'file'], ['release']], reopen: [['root', 'id'], []],
  request: [['root', 'intent'], ['release', 'method', 'body', 'observation', 'entry']],
  'client-check': [['root', 'release'], []],
  handoff: [['root', 'requests', 'out'], []],
  host: [['root', 'user', 'environment', 'out'], ['group', 'source-root']],
};
const HELP = `Chainstack Stellar installation

create --file INSTALLATION.json --root PRIVATE_DIRECTORY --release VERSION
stage --file INSTALLATION.json --root PRIVATE_DIRECTORY --release NEW_VERSION
status --root PRIVATE_DIRECTORY
diff --root PRIVATE_DIRECTORY --before VERSION --after NEW_VERSION
activate --root PRIVATE_DIRECTORY --release VERSION --generation CURRENT_NUMBER
rollback --root PRIVATE_DIRECTORY --generation CURRENT_NUMBER
run --root PRIVATE_DIRECTORY --generation CURRENT_NUMBER
console --root PRIVATE_DIRECTORY [--port 8425]
observe --root PRIVATE_DIRECTORY --id OBSERVATION --file REQUEST_SET.json [--release VERSION]
reopen --root PRIVATE_DIRECTORY --id OBSERVATION
request --root PRIVATE_DIRECTORY --intent PURCHASE_ID --method METHOD --body REQUEST.json [--release VERSION]
request --root PRIVATE_DIRECTORY --intent PURCHASE_ID --observation OBSERVATION --entry ENTRY
client-check --root PRIVATE_DIRECTORY --release VERSION
handoff --root PRIVATE_DIRECTORY --requests INTENT_ID,INTENT_ID --out NEW_PRIVATE_DIRECTORY
host --root PRIVATE_DIRECTORY --user SERVICE_USER --environment PRIVATE_ENV_FILE --out HOST_BUNDLE [--group GROUP] [--source-root CHECKOUT]

Observe explicitly reads the private configured provider through the original SF30 application.
Run/console use the original SF82 release process. Console prints its private operator capability.
Request prepares the original SF88 review. See buyer.mjs/buyer.py for review, execution and recovery.
`;
function parse(args) {
  const [command, ...tail] = args, definition = definitions[command];
  if (!definition || tail.length % 2) throw new Error('CHAINSTACK_COMMAND_INVALID');
  const [required, optional] = definition, options = {};
  for (let i = 0; i < tail.length; i += 2) {
    const key = tail[i].replace(/^--/, '');
    if (!tail[i].startsWith('--') || ![...required, ...optional].includes(key) || Object.hasOwn(options, key) ||
      !tail[i + 1] || tail[i + 1].startsWith('--')) throw new Error('CHAINSTACK_OPTIONS_INVALID');
    options[key] = tail[i + 1];
  }
  if (required.some(key => !options[key])) throw new Error('CHAINSTACK_OPTION_REQUIRED');
  return { command, options };
}
function integer(raw) {
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('CHAINSTACK_NUMBER_INVALID');
  return Number(raw);
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { process.stdout.write(HELP); return; }
  const { command, options: o } = parse(args), root = resolve(o.root);
  let result;
  if (command === 'create' || command === 'stage') result = await installation[command === 'create' ? 'createInstallation' : 'stageInstallation'](
    ...(command === 'create' ? [await installation.readJSON(resolve(o.file)), root, o.release] : [root, await installation.readJSON(resolve(o.file)), o.release]));
  else if (command === 'status') result = await installation.status(root);
  else if (command === 'activate') result = await installation.activate(root, o.release, integer(o.generation));
  else if (command === 'rollback') result = await installation.rollback(root, integer(o.generation));
  else if (command === 'diff') result = await installation.compare(root, o.before, o.after);
  else if (command === 'reopen') result = await installation.reopenObservation(root, o.id);
  else if (command === 'client-check') result = await installation.inspectClient(root, o.release);
  else if (command === 'handoff') result = await installation.exportHandoff(root, o.requests.split(','), resolve(o.out));
  else if (command === 'observe') {
    const source = await installation.readJSON(resolve(o.file));
    if (Object.keys(source).some(key => !['provider', 'requests'].includes(key))) throw new Error('CHAINSTACK_REQUEST_SET_INVALID');
    result = await installation.observeProvider(root, { ...source, observationId: o.id, releaseId: o.release });
  } else if (command === 'request') {
    if (o.observation) {
      if (!o.entry || o.release || o.method || o.body) throw new Error('CHAINSTACK_OBSERVATION_SELECTION_INVALID');
      result = await installation.requestFromObservation(root, { observationId: o.observation, entryId: o.entry, intentId: o.intent });
    } else {
      if (!o.method || !o.body || o.entry) throw new Error('CHAINSTACK_REQUEST_SELECTION_INVALID');
      result = await installation.prepareRequest(root, { releaseId: o.release, method: o.method, bodyFile: resolve(o.body), intentId: o.intent });
    }
  } else if (command === 'host') result = await installation.exportHost(root, { serviceUser: o.user, serviceGroup: o.group,
    environmentFile: resolve(o.environment), out: resolve(o.out), ...(o['source-root'] ? { sourceRoot: resolve(o['source-root']) } : {}) });
  else if (command === 'run') {
    const session = await installation.run(root, integer(o.generation));
    process.stdout.write(JSON.stringify({ status: 'CHAINSTACK_ORIGINAL_RELEASE_RUNNING', url: session.url,
      mode: session.mode, releaseId: session.release.id, releaseDigest: session.release.digest }) + '\n');
    return session.completion;
  } else if (command === 'console') {
    const session = await installation.consoleSession(root, o.port ? integer(o.port) : 8425);
    const stop = () => session.close().catch(() => { process.exitCode = 1; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    process.stdout.write(JSON.stringify({ status: 'CHAINSTACK_ORIGINAL_RELEASE_CONSOLE', operatorUrl: session.operatorUrl }) + '\n');
    try { return await session.closed; } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result?.state === 'REQUIRES_OPERATOR_REVIEW') process.exitCode = 1;
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  const code = error.code ?? error.message;
  process.stderr.write((typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(code) ? code : 'CHAINSTACK_COMMAND_FAILED') + '\n');
  process.exitCode = 1;
});
