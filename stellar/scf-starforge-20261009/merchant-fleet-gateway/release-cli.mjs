#!/usr/bin/env node
// MIT. Foreground terminal over the same original fleet release lifecycle object.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFleetReleaseOperator } from './release-operator.mjs';
import { bootstrapFleet, readFleetBootstrapStatus } from './release-bootstrap.mjs';

const COMMANDS = `status
catalog TENANT SLOT
operations TENANT SLOT INSTANCE_ID
stage TENANT SLOT PACKAGE RELEASE
review TENANT SLOT RELEASE
prepare REVIEW_ID
activate CANDIDATE_ID REVISION
review-rollback REVISION
rollback REVIEW_ID
retire TENANT SLOT INSTANCE_ID REVISION
quit`;
const USAGE = `Usage: node release-cli.mjs setup --declaration FILE --directory PRIVATE_DIRECTORY
  [--plan OUTPUT_FILE]
  node release-cli.mjs setup-status --directory PRIVATE_DIRECTORY
  node release-cli.mjs start --plan FILE --directory PRIVATE_DIRECTORY
  [--state PRIVATE_GATEWAY_DIRECTORY]

Runs the existing SF82 seller sessions and original fleet in this foreground process.
Setup initializes the original stores and initial releases, then writes the original
plan. Repeating setup resumes its retained progress. See BOOTSTRAP.md.
The plan declares stores, ports and package aliases. See RELEASE_OPERATOR.md.

Session commands:
${COMMANDS}`;
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function revision(value) {
  if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw new TypeError('A positive revision is required.');
  return Number(value);
}
export async function dispatchFleetCommand(operator, line) {
  const words = line.trim().split(/\s+/), [action, ...args] = words;
  const required = { status: 0, catalog: 2, operations: 3, stage: 4, review: 3, prepare: 1,
    activate: 2, 'review-rollback': 1, rollback: 1, retire: 4, help: 0 };
  if (!(action in required) || args.length !== required[action]) throw new TypeError(COMMANDS);
  if (action === 'help') return { commands: COMMANDS };
  if (action === 'status') return operator.status();
  if (action === 'catalog') return operator.catalog({ tenant: args[0], slot: args[1] });
  if (action === 'operations') return operator.operations({ tenant: args[0], slot: args[1], instanceId: args[2] });
  if (action === 'stage') return operator.stage({ tenant: args[0], slot: args[1], package: args[2], releaseId: args[3] });
  if (action === 'review') return operator.review({ tenant: args[0], slot: args[1], releaseId: args[2] });
  if (action === 'prepare') return operator.prepare({ reviewId: args[0] });
  if (action === 'activate') return operator.activate({ candidateId: args[0], expectedRevision: revision(args[1]) });
  if (action === 'review-rollback') return operator.reviewRollback({ targetRevision: revision(args[0]) });
  if (action === 'rollback') return operator.rollback({ reviewId: args[0] });
  return operator.retire({ tenant: args[0], slot: args[1], instanceId: args[2], expectedRevision: revision(args[3]) });
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return; }
  const action = args[0];
  if (!['setup', 'setup-status', 'start'].includes(action)) throw new TypeError(USAGE);
  const allowed = action === 'setup' ? ['--declaration', '--directory', '--plan'] :
    action === 'setup-status' ? ['--directory'] : ['--plan', '--directory', '--state'];
  const flags = new Map();
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!allowed.includes(name) || flags.has(name) || !value || value.startsWith('--'))
      throw new TypeError(USAGE);
    flags.set(name, value);
  }
  if (!flags.has('--directory')) throw new TypeError(USAGE);
  if (action === 'setup-status') { print(await readFleetBootstrapStatus({ directory: flags.get('--directory') })); return; }
  if (action === 'setup') {
    if (!flags.has('--declaration')) throw new TypeError(USAGE);
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('Fleet setup interrupted; repeat the same setup command to resume.'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      print(await bootstrapFleet({ declarationFile: flags.get('--declaration'), directory: flags.get('--directory'),
        planFile: flags.get('--plan'), signal: controller.signal,
        onProgress: event => process.stdout.write(JSON.stringify(event) + '\n') }));
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    return;
  }
  if (!flags.has('--plan')) throw new TypeError(USAGE);
  let operator, lines, requestedClose = false;
  const requestClose = () => {
    requestedClose = true;
    if (operator) void operator.close().then(() => lines?.close(), error => {
      process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; lines?.close();
    });
  };
  // Install before the first native child can start. SF82 signal handling is
  // explicitly delegated to this owner; gateway admission/drain closes first.
  process.on('SIGINT', requestClose); process.on('SIGTERM', requestClose);
  try {
    operator = await openFleetReleaseOperator({ planFile: flags.get('--plan'), directory: flags.get('--directory'),
      gatewayStateDirectory: flags.get('--state') });
    if (requestedClose) return;
    print({ fleet: operator.publicURL, status: await operator.status(), commands: COMMANDS });
    lines = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    lines.on('SIGINT', requestClose);
    if (process.stdin.isTTY) lines.setPrompt('fleet> ');
    lines.prompt();
    for await (const line of lines) {
      if (requestedClose || line.trim() === 'quit') break;
      if (line.trim()) {
        try { print(await dispatchFleetCommand(operator, line)); }
        catch (error) { print({ error: error.message, status: error.status ?? null }); }
      }
      if (!requestedClose) lines.prompt();
    }
  } finally {
    await operator?.close(); lines?.close();
    process.removeListener('SIGINT', requestClose); process.removeListener('SIGTERM', requestClose);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
