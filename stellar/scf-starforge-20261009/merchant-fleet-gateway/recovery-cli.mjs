#!/usr/bin/env node
// MIT. Complete original merchant-fleet capture and receiving.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFleetRecovery, prepareFleetRecoveryPlan, inspectFleetRecoveryPlan,
  captureFleetRecovery, restoreFleetRecovery, inspectRestoredFleet, prepareRestoredFleet } from './recovery.mjs';

export const HELP = `starforge merchant-fleet-recovery inspect-source --bundle ORIGINAL_HOST_BUNDLE
starforge merchant-fleet-recovery prepare-plan --bundle ORIGINAL_HOST_BUNDLE --plan NEW_PRIVATE_PLAN --quiesced
starforge merchant-fleet-recovery inspect-plan --plan ORIGINAL_PRIVATE_PLAN
starforge merchant-fleet-recovery capture --plan ORIGINAL_PRIVATE_PLAN --bundle NEW_ENCRYPTED_BUNDLE --operation PRIVATE_CAPTURE_OPERATION --pass-env SECRET_ENV_NAME --expected-plan-sha SHA256 --quiesced
starforge merchant-fleet-recovery restore --bundle ENCRYPTED_BUNDLE --out NEW_PRIVATE_RESTORE --pass-env SECRET_ENV_NAME [--expected-manifest-sha SHA256]
starforge merchant-fleet-recovery inspect-restore --bundle ENCRYPTED_BUNDLE --restore ORIGINAL_RESTORE --pass-env SECRET_ENV_NAME [--targets PRIVATE_TARGETS_JSON --operation PRIVATE_RECEIVING_OPERATION] [--expected-manifest-sha SHA256]
starforge merchant-fleet-recovery receive --bundle ENCRYPTED_BUNDLE --restore ORIGINAL_RESTORE --targets PRIVATE_TARGETS_JSON --operation PRIVATE_RECEIVING_OPERATION --pass-env SECRET_ENV_NAME --expected-review-sha SHA256 --quiesced

Run capture and receiving as the original Linux service UID/GID. Keep source writers
stopped through capture and the receiving fleet stopped through placement. All state
keeps its original absolute paths, native plan digest and release identities.
Use RECOVERY.md for complete source custody, receiving and interruption handling.
The passphrase is read by original SF101 from the selected environment variable.`;

const SPECS = {
  'inspect-source': { required: ['bundle'] },
  'prepare-plan': { required: ['bundle', 'plan', 'quiesced'] },
  'inspect-plan': { required: ['plan'] },
  capture: { required: ['plan', 'bundle', 'operation', 'pass-env', 'expected-plan-sha'], optional: ['quiesced'] },
  restore: { required: ['bundle', 'out', 'pass-env'], optional: ['expected-manifest-sha'] },
  'inspect-restore': { required: ['bundle', 'restore', 'pass-env'],
    optional: ['targets', 'operation', 'expected-manifest-sha'] },
  receive: { required: ['bundle', 'restore', 'targets', 'operation', 'pass-env', 'expected-review-sha', 'quiesced'],
    optional: ['expected-manifest-sha'] },
};
function options(command, rest) {
  const spec = SPECS[command];
  if (!spec) throw new Error(HELP);
  const allowed = new Set([...spec.required, ...(spec.optional ?? [])]), selected = {};
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index], key = token?.startsWith('--') ? token.slice(2) : '';
    if (!allowed.has(key) || Object.hasOwn(selected, key)) throw new Error('Unknown or repeated option.\n' + HELP);
    if (key === 'quiesced') { selected[key] = true; continue; }
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new Error('Every selected option requires its original value.\n' + HELP);
    selected[key] = value;
  }
  if (spec.required.some(key => !Object.hasOwn(selected, key))) throw new Error('Missing required selection.\n' + HELP);
  if (command === 'inspect-restore' && Boolean(selected.targets) !== Boolean(selected.operation))
    throw new Error('Select --targets and --operation together.');
  return selected;
}
export async function run(args = []) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw new TypeError('CLI arguments required.');
  if (!args.length || (args.length === 1 && ['--help', 'help'].includes(args[0]))) return { help: HELP };
  const command = args[0], value = options(command, args.slice(1));
  const input = { deploymentBundle: value.bundle, planFile: value.plan,
    bundleDirectory: value.bundle, operationDirectory: value.operation, passphraseEnv: value['pass-env'],
    expectedPlanSha256: value['expected-plan-sha'], expectedManifestSha256: value['expected-manifest-sha'],
    restoreDirectory: value.restore ?? value.out, targetFile: value.targets,
    expectedReviewSha256: value['expected-review-sha'], quiesced: value.quiesced === true };
  if (command === 'inspect-source') return inspectFleetRecovery(input);
  if (command === 'prepare-plan') return prepareFleetRecoveryPlan(input);
  if (command === 'inspect-plan') return inspectFleetRecoveryPlan(value.plan);
  if (command === 'capture') return captureFleetRecovery(input);
  if (command === 'restore') return restoreFleetRecovery(input);
  if (command === 'inspect-restore') return inspectRestoredFleet(input);
  return prepareRestoredFleet(input);
}
export async function main(args = process.argv.slice(2)) {
  const result = await run(args);
  console.log(result.help ?? JSON.stringify(result, null, 2)); return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ error: error.code ?? 'FLEET_RECOVERY_FAILED', message: error.message }));
    process.exitCode = 1;
  });
