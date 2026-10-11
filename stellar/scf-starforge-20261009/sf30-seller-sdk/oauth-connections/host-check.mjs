#!/usr/bin/env node
// MIT. Original host preflight in the actual service environment; never an OAuth writer.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkBundle } from '../../sf99-merchant-deploy/host.mjs';
import { checkOAuthHostConnections } from './deployment.mjs';

export async function checkOAuthDeployment(bundle, options = {}) {
  const host = await checkBundle(resolve(bundle));
  return checkOAuthHostConnections(host, options);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('Usage: node host-check.mjs --bundle ABSOLUTE_ORIGINAL_HOST_BUNDLE\n' +
      'Run as the configured service account with its actual private environment.\n' +
      'Checks declared directories and the approved grant without network requests.\n');
    return;
  }
  if (argv.length !== 2 || argv[0] !== '--bundle' || !argv[1])
    throw new Error('Use --bundle with the original generated host bundle.');
  const result = await checkOAuthDeployment(argv[1]);
  process.stdout.write(JSON.stringify({ status: 'READY', ...result }) + '\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    process.stderr.write('OAUTH_HOST_PREFLIGHT_FAILED: inspect the configured private connection, environment references and selected grant.\n');
    process.exitCode = 1;
  });
}
