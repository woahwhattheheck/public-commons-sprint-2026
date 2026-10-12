#!/usr/bin/env node
// MIT. Complete paid-job recovery through the original SF101 engine and merchant.
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as recover } from './recover.mjs';
import { inspectPaidJobRecovery, preparePaidJobRecoveryPlan, inspectPaidJobRecoveryPlan,
  capturePaidJobRecovery, inspectRestoredPaidJobs, prepareRestoredPaidJobs } from './paid-jobs.mjs';
import { readPrivate, digest, fault } from '../sf30-seller-sdk/postgres/publisher/files.mjs';

const help = [
  'Starforge paid-job recovery', '',
  '  jobs recovery inspect --config MERCHANT_JSON --state MERCHANT_STATE',
  '       --application-directory APPLICATION_DIRECTORY',
  '       [--delivery-state DIRECTORY] [--destinations DESTINATIONS_JSON] [--root NAME=PATH]',
  '  jobs recovery plan --plan NEW_PLAN_JSON --config MERCHANT_JSON --state MERCHANT_STATE',
  '       --application-directory APPLICATION_DIRECTORY',
  '       [--delivery-state DIRECTORY] [--destinations DESTINATIONS_JSON] [--root NAME=PATH]',
  '  jobs recovery inspect-plan --plan PLAN_JSON',
  '  jobs recovery capture --plan PLAN_JSON --bundle NEW_BUNDLE --pass-env ENV_NAME',
  '       [--plan-sha256 SHA256] [--capture-id SHA256]',
  '  jobs recovery restore --bundle BUNDLE --out NEW_RESTORE --pass-env ENV_NAME',
  '       [--manifest-sha256 SHA256]',
  '  jobs recovery inspect-restored --bundle BUNDLE --restore RESTORE --pass-env ENV_NAME',
  '       [--manifest-sha256 SHA256]',
  '  jobs recovery receive --bundle BUNDLE --restore RESTORE --pass-env ENV_NAME',
  '       --review-sha256 SHA256 [--manifest-sha256 SHA256]', '',
  'Select the original configuration, saved merchant and complete application directory.',
  'The original default result-delivery directory is included when present. Repeat',
  '--delivery-state for custom queues and --root for additional original configuration',
  'or dependency roots. Include --destinations to retain the exact sender configuration.',
  'The plan merges overlapping role paths into non-overlapping original SF101 roots.',
  'Save the new plan and encrypted bundle outside those selected source roots.', '',
  'Stop the original service, result dispatchers and settlement-delivery workers before',
  'inspection/capture. Their actual writer leases are held across review, snapshot and',
  'verification. The passphrase stays in its named environment variable (16+ UTF-8 bytes).',
  'Transfer the complete encrypted bundle and restore into a new private directory.',
  'Inspect the restored selection, then receive its exact review SHA-256.', '',
  'Receiving preserves original paid rows, settlement journals, result bytes and frozen',
  'delivery records. It installs the verified physical source binding used by the same',
  'merchant. The returned launch arguments reopen those original paths and custom queue.',
  'Repeated receive returns the retained operation after later legitimate merchant work.',
  'See sf101-merchant-recovery/PAID_JOBS.md for the complete installed workflow.', '',
].join('\n');
const selectionFlags = ['--config', '--state', '--application-directory'];
const selectionOptional = ['--delivery-state', '--destinations', '--root'];
const receivingFlags = ['--bundle', '--restore', '--pass-env'];
const commands = {
  inspect: { required: selectionFlags, optional: selectionOptional },
  plan: { required: ['--plan', ...selectionFlags], optional: selectionOptional },
  'inspect-plan': { required: ['--plan'], optional: [] },
  capture: { required: ['--plan', '--bundle', '--pass-env'], optional: ['--plan-sha256', '--capture-id'] },
  restore: { required: ['--bundle', '--out', '--pass-env'], optional: ['--manifest-sha256'] },
  'inspect-restored': { required: receivingFlags, optional: ['--manifest-sha256'] },
  receive: { required: [...receivingFlags, '--review-sha256'], optional: ['--manifest-sha256'] },
};
const invalid = message => fault('PAID_JOB_RECOVERY_COMMAND_INVALID', message, 400);
function argumentsOf(argv) {
  const command = argv[0], spec = commands[command];
  if (!spec) throw invalid('Choose a paid-job recovery command from --help.');
  const allowed = new Set([...spec.required, ...spec.optional]), values = new Map();
  for (let index = 1; index < argv.length; index++) {
    const name = argv[index], value = argv[++index];
    if (!allowed.has(name) || !value || value.startsWith('--'))
      throw invalid('Supply a supported option and value: ' + name);
    if (values.has(name) && !['--delivery-state', '--root'].includes(name))
      throw invalid('Do not repeat ' + name + '.');
    if (!values.has(name)) values.set(name, []);
    values.get(name).push(value);
  }
  for (const name of spec.required) if (!values.has(name)) throw invalid('Supply ' + name + '.');
  for (const name of ['--plan-sha256', '--manifest-sha256', '--review-sha256', '--capture-id'])
    if (values.has(name) && !/^[a-f0-9]{64}$/.test(values.get(name)[0]))
      throw invalid('Supply a lowercase SHA-256 for ' + name + '.');
  return { command, get: name => values.get(name)?.[0], all: name => values.get(name) ?? [] };
}
function selected(args) {
  return { configPath: resolve(args.get('--config')), directory: resolve(args.get('--state')),
    applicationDirectory: resolve(args.get('--application-directory')),
    deliveryDirectories: args.all('--delivery-state').map(value => resolve(value)),
    destinationsFile: args.get('--destinations') ? resolve(args.get('--destinations')) : undefined,
    roots: args.all('--root').map(value => {
      const at = value.indexOf('=');
      if (at < 1 || at === value.length - 1) throw invalid('Use --root NAME=PATH.');
      return { name: value.slice(0, at), path: resolve(value.slice(at + 1)) };
    }) };
}
function receiving(args) {
  return { bundleDirectory: resolve(args.get('--bundle')), restoreDirectory: resolve(args.get('--restore')),
    passphraseEnv: args.get('--pass-env'), expectedManifestSha256: args.get('--manifest-sha256') };
}
export async function runPaidJobRecoveryCommand(argv = process.argv.slice(2),
  { print = value => console.log(value) } = {}) {
  if (!argv.length || argv.some(value => ['--help', '-h'].includes(value)) ||
      argv.length === 1 && argv[0] === 'help') { print(help); return; }
  const args = argumentsOf(argv);
  let result;
  if (args.command === 'inspect') result = await inspectPaidJobRecovery(selected(args));
  else if (args.command === 'plan') result = await preparePaidJobRecoveryPlan({
    ...selected(args), planFile: resolve(args.get('--plan')) });
  else if (args.command === 'inspect-plan')
    result = await inspectPaidJobRecoveryPlan(resolve(args.get('--plan')));
  else if (args.command === 'capture') result = await capturePaidJobRecovery({
    planFile: resolve(args.get('--plan')), bundleDirectory: resolve(args.get('--bundle')),
    passphraseEnv: args.get('--pass-env'), expectedPlanSha256: args.get('--plan-sha256'),
    captureId: args.get('--capture-id') });
  else if (args.command === 'restore') {
    const bundleDirectory = resolve(args.get('--bundle')), file = join(bundleDirectory, 'manifest.json');
    const before = digest(await readPrivate(file, 12 * 1024 ** 2));
    if (args.get('--manifest-sha256') && before !== args.get('--manifest-sha256'))
      throw fault('PAID_JOB_RECOVERY_BUNDLE_CHANGED', 'The encrypted manifest differs from the selected capture.', 409);
    result = await recover(['restore', '--bundle', bundleDirectory, '--out', resolve(args.get('--out')),
      '--pass-env', args.get('--pass-env')]);
    if (digest(await readPrivate(file, 12 * 1024 ** 2)) !== before)
      throw fault('PAID_JOB_RECOVERY_BUNDLE_CHANGED', 'The encrypted manifest changed during the original restore.', 409);
    result = { ...result, manifestSha256: before };
  } else if (args.command === 'inspect-restored') result = await inspectRestoredPaidJobs(receiving(args));
  else result = await prepareRestoredPaidJobs({ ...receiving(args),
    expectedReviewSha256: args.get('--review-sha256') });
  print(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runPaidJobRecoveryCommand().catch(error => {
    console.error(error.code ? error.code + ': ' + error.message : error.message);
    process.exitCode = 1;
  });
