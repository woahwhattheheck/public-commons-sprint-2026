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
discovery TENANT
discovery-enrollment TENANT
discovery-review-enrollment TENANT SLOT INSTANCE_ID SELLER_ID [SOURCE_URL]
discovery-review-recovery TENANT SLOT INSTANCE_ID SELLER_ID INSPECTION_ID [SOURCE_URL]
discovery-enroll TENANT REVIEW_ID
discovery-start TENANT
discovery-stop TENANT INSTANCE_ID
discovery-source TENANT SLOT RELEASE_ID
discovery-review TENANT SLOT INSTANCE_ID
discovery-review-withdrawal TENANT SLOT INSTANCE_ID SOURCE_SLOT SOURCE_RELEASE ROUTE_ID REASON
discovery-apply TENANT REVIEW_ID
discovery-history TENANT CATALOG_KEY
discovery-consume TENANT [JSON_PAGE_OPTIONS]
client-list TENANT SLOT [AFTER [LIMIT]]
client-inspect TENANT SLOT EXPORT_ID
client-generate TENANT SLOT INSTANCE_ID EXPORT_ID
client-adopt TENANT SLOT EXPORT_ID FILES_SHA256
client-manifest TENANT SLOT EXPORT_ID
client-download TENANT SLOT EXPORT_ID MANIFEST_SHA256 DESTINATION
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
Tenant enrollment, reviewed signing and native buyer discovery use that same
foreground owner. See DISCOVERY.md for original-source and withdrawal commands.

Session commands:
${COMMANDS}`;
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function revision(value) {
  if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw new TypeError('A positive revision is required.');
  return Number(value);
}
export async function dispatchFleetCommand(operator, line) {
  const words = line.trim().split(/\s+/), action = words[0]; let args = words.slice(1);
  const download = /^client-download\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line.trim());
  if (download) {
    const destination = download[5];
    args = [...download.slice(1, 5), destination.startsWith('"') ? JSON.parse(destination) : destination];
  }
  const withdrawal = /^discovery-review-withdrawal\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line.trim());
  if (withdrawal) args = [...withdrawal.slice(1, 7),
    withdrawal[7].startsWith('"') ? JSON.parse(withdrawal[7]) : withdrawal[7]];
  const history = /^discovery-history\s+(\S+)\s+(.+)$/.exec(line.trim());
  if (history) args = [history[1], history[2].startsWith('"') ? JSON.parse(history[2]) : history[2]];
  const consume = /^discovery-consume\s+(\S+)(?:\s+(.+))?$/.exec(line.trim());
  if (consume) args = [consume[1], ...(consume[2] ? [consume[2]] : [])];
  const required = { status: 0, catalog: 2, operations: 3, stage: 4, review: 3, prepare: 1,
    activate: 2, 'review-rollback': 1, rollback: 1, retire: 4, help: 0,
    'client-list': [2, 3, 4], 'client-inspect': 3, 'client-generate': 4, 'client-adopt': 4,
    'client-manifest': 3, 'client-download': 5,
    discovery: 1, 'discovery-enrollment': 1, 'discovery-review-enrollment': [4, 5],
    'discovery-review-recovery': [5, 6],
    'discovery-enroll': 2, 'discovery-start': 1, 'discovery-stop': 2,
    'discovery-source': 3, 'discovery-review': 3, 'discovery-review-withdrawal': 7,
    'discovery-apply': 2, 'discovery-history': 2, 'discovery-consume': [1, 2] };
  const count = required[action];
  if (!Object.hasOwn(required, action) || (Array.isArray(count) ? !count.includes(args.length) : args.length !== count))
    throw new TypeError(COMMANDS);
  if (action === 'help') return { commands: COMMANDS };
  if (action === 'status') return operator.status();
  if (action === 'catalog') return operator.catalog({ tenant: args[0], slot: args[1] });
  if (action === 'operations') return operator.operations({ tenant: args[0], slot: args[1], instanceId: args[2] });
  if (action === 'discovery') return operator.discoveryStatus({ tenant: args[0] });
  if (action === 'discovery-enrollment') return operator.discoveryEnrollment({ tenant: args[0] });
  if (action === 'discovery-review-enrollment') return operator.discoveryReviewEnrollment({
    tenant: args[0], slot: args[1], instanceId: args[2], sellerId: args[3],
    ...(args[4] !== undefined ? { sourceURL: args[4] } : {}) });
  if (action === 'discovery-review-recovery') return operator.discoveryReviewEnrollment({
    tenant: args[0], slot: args[1], instanceId: args[2], sellerId: args[3], expectedIncompleteId: args[4],
    ...(args[5] !== undefined ? { sourceURL: args[5] } : {}) });
  if (action === 'discovery-enroll') return operator.discoveryCreateEnrollment({ tenant: args[0], reviewId: args[1] });
  if (action === 'discovery-start') return operator.discoveryStart({ tenant: args[0] });
  if (action === 'discovery-stop') return operator.discoveryStop({ tenant: args[0], instanceId: args[1] });
  if (action === 'discovery-source') return operator.discoverySource({ tenant: args[0], slot: args[1], releaseId: args[2] });
  if (action === 'discovery-review') return operator.discoveryReview({ tenant: args[0], slot: args[1],
    instanceId: args[2], action: 'publish' });
  if (action === 'discovery-review-withdrawal') return operator.discoveryReview({ tenant: args[0], slot: args[1],
    instanceId: args[2], sourceSlot: args[3], sourceReleaseId: args[4], routeId: args[5], reason: args[6], action: 'withdraw' });
  if (action === 'discovery-apply') return operator.discoveryApply({ tenant: args[0], reviewId: args[1] });
  if (action === 'discovery-history') return operator.discoveryHistory({ tenant: args[0], catalogKey: args[1] });
  if (action === 'discovery-consume') {
    const options = args[1] === undefined ? {} : JSON.parse(args[1]);
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.hasOwn(options, 'tenant'))
      throw new TypeError('Supply a JSON object of original discovery page options.');
    return operator.discoveryConsume({ tenant: args[0], ...options });
  }
  const scope = { tenant: args[0], slot: args[1] };
  if (action === 'client-list') return operator.clientList({ ...scope,
    ...(args[2] ? { after: args[2] } : {}), ...(args[3] ? { limit: revision(args[3]) } : {}) });
  if (action === 'client-inspect') return operator.clientInspect({ ...scope, exportId: args[2] });
  if (action === 'client-generate') return operator.clientGenerate({ ...scope, instanceId: args[2], id: args[3] });
  if (action === 'client-adopt') return operator.clientAdopt({ ...scope, exportId: args[2], expectedFilesSha256: args[3] });
  if (action === 'client-manifest') return operator.clientManifest({ ...scope, exportId: args[2] });
  if (action === 'client-download') return operator.downloadClient({ ...scope, exportId: args[2],
    expectedManifestSha256: args[3], directory: args[4] });
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
