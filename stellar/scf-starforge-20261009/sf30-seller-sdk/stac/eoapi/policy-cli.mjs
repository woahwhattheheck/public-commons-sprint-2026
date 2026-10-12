#!/usr/bin/env node
// MIT. Native operator CLI for the original eoAPI deployment policy workflow.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { openDeploymentPolicyWorkspace, validateDeploymentPolicyPackage } from './policy-workspace.mjs';
import { compileDeploymentPolicy } from './deployment-policy.mjs';

export async function runDeploymentPolicyCLI(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv, options = {};
  if (!command || command === 'help' || command === '--help') {
    return { commands: {
      init: '--workspace ABSOLUTE_DIR [--title TITLE]',
      save: '--workspace ABSOLUTE_DIR --input POLICY_JSON [--expected-revision N]',
      review: '--workspace ABSOLUTE_DIR [--expected-revision N]',
      approve: '--workspace ABSOLUTE_DIR --review REVIEW_ID --reviewer NAME [--expected-revision N]',
      status: '--workspace ABSOLUTE_DIR',
      export: '--workspace ABSOLUTE_DIR --output ABSOLUTE_PACKAGE_DIR [--approval APPROVAL_ID]',
      receive: '--workspace ABSOLUTE_RECEIVING_DIR --input PACKAGE_JSON',
      inspect: '--input POLICY_JSON', verify: '--input PACKAGE_JSON'
    }};
  }
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    if (!/^--[a-z-]+$/.test(key ?? '') || rest[index + 1] === undefined || key in options) throw new Error('EOAPI_CLI_ARGUMENT_INVALID');
    options[key] = rest[index + 1];
  }
  const required = key => { if (!options[key]) throw new Error('EOAPI_CLI_ARGUMENT_REQUIRED: ' + key); return options[key]; };
  const expectedRevision = options['--expected-revision'] === undefined ? undefined : Number(options['--expected-revision']);
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error('EOAPI_CLI_REVISION_INVALID');
  if (command === 'inspect') return compileDeploymentPolicy(await readJson(resolve(required('--input')), 2 * 1024 ** 2));
  if (command === 'verify') {
    const result = validateDeploymentPolicyPackage(await readJson(resolve(required('--input')), 16 * 1024 ** 2));
    return { digest: result.digest, policyDigest: result.compilation.digest, files: result.files, bytes: result.bytes };
  }
  const workspace = await openDeploymentPolicyWorkspace({ directory: resolve(required('--workspace')), create: ['init', 'receive'].includes(command), title: options['--title'] });
  try {
    if (command === 'init' || command === 'status') return workspace.getState();
    if (command === 'save') return workspace.saveDraft({ policy: await readJson(resolve(required('--input')), 2 * 1024 ** 2), expectedRevision });
    if (command === 'review') return workspace.review({ expectedRevision });
    if (command === 'approve') return workspace.approve({ reviewId: required('--review'), reviewer: required('--reviewer'), expectedRevision });
    if (command === 'export') {
      const result = await workspace.exportPackage({ approvalId: options['--approval'], directory: resolve(required('--output')) });
      return { directory: result.directory, digest: result.package.digest, policyDigest: result.package.policyDigest, files: result.package.files.length };
    }
    if (command === 'receive') return workspace.importPackage({ package: await readJson(resolve(required('--input')), 16 * 1024 ** 2), expectedRevision });
    throw new Error('EOAPI_CLI_COMMAND_UNKNOWN');
  } finally { await workspace.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runDeploymentPolicyCLI(), null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: error.code ?? error.message, path: error.path ?? null })); process.exitCode = 1; }
}
