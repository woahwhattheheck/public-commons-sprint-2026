#!/usr/bin/env node
// MIT. Private operator CLI for the original recovery host handoff.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { absolute, readJson } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';
import { prepareHostHandoffPlan, exportHostHandoff, restoreHostHandoff,
  inspectRestoredHostHandoff, adoptRestoredHostHandoff } from './host-handoff.mjs';

export const HELP = 'Recovery workspace host handoff\n\n' +
  'starforge merchant-recovery-remote workspace handoff plan --selection ABS_JSON --plan ABS_NEW_PLAN --quiesced\n' +
  'starforge merchant-recovery-remote workspace handoff export --plan ABS_PLAN --bundle ABS_BUNDLE --operation ABS_CAPTURE_STATE --pass-env NAME --expected-plan-sha256 HASH --quiesced\n' +
  'starforge merchant-recovery-remote workspace handoff restore --bundle ABS_BUNDLE --restore ABS_NEW_DIRECTORY --pass-env NAME --expected-manifest-sha256 HASH\n' +
  'starforge merchant-recovery-remote workspace handoff review --bundle ABS_BUNDLE --restore ABS_RESTORED_DIRECTORY --pass-env NAME --expected-manifest-sha256 HASH --target ABS_PRIVATE_TARGET\n' +
  'starforge merchant-recovery-remote workspace handoff adopt --bundle ABS_BUNDLE --restore ABS_RESTORED_DIRECTORY --pass-env NAME --expected-manifest-sha256 HASH --target ABS_PRIVATE_TARGET --expected-review-sha256 HASH --quiesced\n\n' +
  'Plan/export retain the exact original application edition, workspace identity,\n' +
  'requests, journals and encrypted bundles through the original recovery engine.\n' +
  'Restore authenticates before creating a new private staging directory.\n' +
  'Review prints every explicit receiving path and external private-file binding.\n' +
  'Adopt requires that review hash and reopens the same workspace for reading.\n' +
  'Original state/journal paths remain exact. Changed-root migration is not an\n' +
  'implicit rewrite: this version rejects a different receiving path.\n' +
  'Passphrase values and provider credentials stay in private host custody.\n' +
  'See HOST_HANDOFF.md for source closure, cold-host setup and interrupted output.\n';

const options = {
  plan: ['selectionFile', 'planFile', 'quiesced'],
  export: ['planFile', 'bundleDirectory', 'operationDirectory', 'passphraseEnv', 'expectedPlanSha256', 'quiesced'],
  restore: ['bundleDirectory', 'restoreDirectory', 'passphraseEnv', 'expectedManifestSha256'],
  review: ['bundleDirectory', 'restoreDirectory', 'passphraseEnv', 'expectedManifestSha256', 'targetFile'],
  adopt: ['bundleDirectory', 'restoreDirectory', 'passphraseEnv', 'expectedManifestSha256',
    'targetFile', 'expectedReviewSha256', 'quiesced']
};
const flags = { '--selection': 'selectionFile', '--plan': 'planFile', '--bundle': 'bundleDirectory',
  '--operation': 'operationDirectory', '--restore': 'restoreDirectory', '--pass-env': 'passphraseEnv',
  '--expected-plan-sha256': 'expectedPlanSha256', '--expected-manifest-sha256': 'expectedManifestSha256',
  '--target': 'targetFile', '--expected-review-sha256': 'expectedReviewSha256', '--quiesced': 'quiesced' };
const error = message => Object.assign(new Error(message), { code: 'HOST_HANDOFF_ARGUMENTS_INVALID' });
export function parseHostHandoffArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw error('Handoff arguments must be strings.');
  if (!argv.length || argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  const [command, ...rest] = argv;
  if (!Object.hasOwn(options, command)) throw error('Choose plan, export, restore, review or adopt.');
  if (rest.length === 1 && ['--help', '-h'].includes(rest[0])) return { help: true };
  const result = { command };
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index], key = flags[flag];
    if (!key || !options[command].includes(key) || result[key] !== undefined)
      throw error('Unknown, repeated or unsupported option: ' + flag);
    if (key === 'quiesced') { result.quiesced = true; continue; }
    const value = rest[++index];
    if (value === undefined || value.startsWith('--')) throw error('A value is required for ' + flag);
    result[key] = value;
  }
  for (const key of options[command])
    if (result[key] === undefined && !(command === 'export' && key === 'quiesced'))
      throw error('A value is required for ' + key);
  for (const key of ['selectionFile', 'planFile', 'bundleDirectory', 'operationDirectory', 'restoreDirectory', 'targetFile'])
    if (result[key] !== undefined) absolute(result[key], key);
  for (const key of ['expectedPlanSha256', 'expectedManifestSha256', 'expectedReviewSha256'])
    if (result[key] !== undefined && !/^[a-f0-9]{64}$/.test(result[key]))
      throw error('Use the complete original SHA-256 for ' + key);
  if (result.passphraseEnv !== undefined && !/^[A-Z][A-Z0-9_]{4,63}$/.test(result.passphraseEnv))
    throw error('Pass only the private uppercase environment variable name.');
  return result;
}
export async function main(argv = process.argv.slice(2), { output = process.stdout } = {}) {
  const parsed = parseHostHandoffArguments(argv);
  if (parsed.help) { output.write(HELP); return { help: true }; }
  const { command, selectionFile, ...input } = parsed;
  let result;
  if (command === 'plan') result = await prepareHostHandoffPlan({
    ...input, selection: await readJson(selectionFile, 256 * 1024)
  });
  else if (command === 'export') result = await exportHostHandoff(input);
  else if (command === 'restore') result = await restoreHostHandoff(input);
  else if (command === 'review') result = await inspectRestoredHostHandoff(input);
  else result = await adoptRestoredHostHandoff(input);
  output.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(issue => {
    process.stderr.write(JSON.stringify({ error: { code: issue.code ?? 'HOST_HANDOFF_FAILED',
      message: issue.message } }) + '\n');
    process.exitCode = 1;
  });
}
