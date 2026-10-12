#!/usr/bin/env node
// MIT. Original SF101 encrypted recovery with a typed SF30 publisher profile.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectPublisherRecovery, preparePublisherRecoveryPlan, inspectPublisherRecoveryPlan,
  capturePublisherRecovery, inspectRestoredPublisher, prepareRestoredPublisher } from './dataset-publisher.mjs';

const HELP = `Dataset publisher recovery (Node 22+, Linux util-linux flock)

  inspect --state DIR [--workspace DIR] [--seller FILE] [source limits]
  plan --state DIR --out NEW_PLAN_FILE [--workspace DIR] [--seller FILE] [source limits]
  check --plan FILE
  capture --plan FILE --out NEW_BUNDLE_DIR --pass-env NAME --expect-plan SHA256
          [--capture-id SHA256]
  review --bundle DIR --restored DIR --pass-env NAME [--manifest-sha SHA256]
  prepare --bundle DIR --restored DIR --pass-env NAME --expect REVIEW_SHA256
          [--manifest-sha SHA256]

source limits:
  --max-drafts 32 --max-draft-bytes 268435456
  --max-cached-versions 2 --max-resident-rows 1000000

Choose the merchant's ACTUAL original capacity settings. Source operations only
inspect the selected publisher and generations; stop their original writers before
the existing quiesced SF101 capture. A plan is create-only and must be outside
the roots it selects.

capture holds the original source writer leases around native snapshot/verify.
verify / restore remain the original recover.mjs commands. This CLI
reviews their completed restored roots and explicitly prepares the exact
reviewed publisher binding. It starts no seller, publishes no candidate and
changes no expiry. Legacy v1 stores use the original native v2 schema upgrade.
The passphrase is read only by the original engine from the named environment.
prepare repeats the same retained operation after interruption; COMPLETE
returns its saved preparation receipt without replaying changes.

See DATASET_PUBLISHER.md for capture, cold restore and the original CLI reopen.`;

const SOURCE_OPTIONS = ['--state', '--workspace', '--seller', '--max-drafts', '--max-draft-bytes',
  '--max-cached-versions', '--max-resident-rows'];
const RECEIVING_OPTIONS = ['--bundle', '--restored', '--pass-env', '--manifest-sha'];
const COMMANDS = {
  inspect: SOURCE_OPTIONS,
  plan: [...SOURCE_OPTIONS, '--out'],
  check: ['--plan'],
  capture: ['--plan', '--out', '--pass-env', '--expect-plan', '--capture-id'],
  review: RECEIVING_OPTIONS,
  prepare: [...RECEIVING_OPTIONS, '--expect'],
};
function parse(args) {
  const [command, ...rest] = args;
  if (!Object.hasOwn(COMMANDS, command ?? '')) throw new TypeError('Choose inspect, plan, check, capture, review or prepare; use --help.');
  const options = Object.create(null);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!COMMANDS[command].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--'))
      throw new TypeError('Invalid, duplicate or valueless option: ' + key);
    options[key] = value;
  }
  return { command, options };
}
function required(options, key) {
  if (!options[key]) throw new TypeError(key + ' is required.');
  return options[key];
}
function number(options, key, destination, limits) {
  if (options[key] === undefined) return;
  if (!/^[1-9][0-9]*$/.test(options[key]) || !Number.isSafeInteger(Number(options[key])))
    throw new TypeError(key + ' must be a positive safe integer.');
  limits[destination] = Number(options[key]);
}
function selectedSource(options) {
  const limits = {};
  number(options, '--max-drafts', 'maxCandidates', limits);
  number(options, '--max-draft-bytes', 'maxSourceBytes', limits);
  number(options, '--max-cached-versions', 'maxCachedVersions', limits);
  number(options, '--max-resident-rows', 'maxResidentRows', limits);
  return { datasetDirectory: resolve(required(options, '--state')),
    ...(options['--workspace'] ? { publisherDirectory: resolve(options['--workspace']) } : {}),
    ...(options['--seller'] ? { sellerConfigFile: resolve(options['--seller']) } : {}),
    limits };
}
function selectedRestore(options) {
  return { bundleDirectory: resolve(required(options, '--bundle')),
    restoreDirectory: resolve(required(options, '--restored')),
    passphraseEnv: required(options, '--pass-env'),
    ...(options['--manifest-sha'] ? { expectedManifestSha256: options['--manifest-sha'] } : {}) };
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  const { command, options } = parse(args);
  let result;
  if (command === 'inspect') result = await inspectPublisherRecovery(selectedSource(options));
  else if (command === 'plan') result = await preparePublisherRecoveryPlan({
    ...selectedSource(options), planFile: resolve(required(options, '--out')) });
  else if (command === 'check') result = await inspectPublisherRecoveryPlan(resolve(required(options, '--plan')));
  else if (command === 'capture') result = await capturePublisherRecovery({
    planFile: resolve(required(options, '--plan')), bundleDirectory: resolve(required(options, '--out')),
    passphraseEnv: required(options, '--pass-env'), expectedPlanSha256: required(options, '--expect-plan'),
    ...(options['--capture-id'] ? { captureId: options['--capture-id'] } : {}) });
  else if (command === 'review') result = await inspectRestoredPublisher(selectedRestore(options));
  else result = await prepareRestoredPublisher({ ...selectedRestore(options),
    expectedReviewSha256: required(options, '--expect') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write((error.code ?? 'DATASET_PUBLISHER_RECOVERY') + ': ' + error.message + '\n');
    process.exitCode = 1;
  });
