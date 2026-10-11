// MIT. Original GraphQL package -> original release or host operator destination.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectSubQueryDeployment, prepareSubQueryDeployment, prepareSubQueryHost, stageSubQueryDeployment } from './compiler.mjs';
import { parseJson, readBytes } from '../onboarding/files.mjs';

const HELP = `Usage: node deployment/cli.mjs COMMAND [options]
  prepare --merchant MERCHANT_DIRECTORY --directory NEW_DIRECTORY [--allow-loopback-upstream]
  inspect --directory DEPLOYMENT_DIRECTORY
  stage --directory DEPLOYMENT_DIRECTORY --store ORIGINAL_RELEASE_STORE --id RELEASE_ID
    [--label LABEL] [--port PORT] [--facilitator URL] [--allow-local-facilitator]
  host --directory DEPLOYMENT_DIRECTORY --plan ORIGINAL_HOST_SETTINGS.json --destination NEW_HOST_DIRECTORY
These commands prepare files or stage one original immutable release. Use the
original release/fleet and host commands for activation, running and installation.
`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return null; }
  const [command, ...rest] = args;
  const contract = {
    prepare: { required: ['--merchant', '--directory'], optional: ['--allow-loopback-upstream'] },
    inspect: { required: ['--directory'], optional: [] },
    stage: { required: ['--directory', '--store', '--id'], optional: ['--label', '--port', '--facilitator', '--allow-local-facilitator'] },
    host: { required: ['--directory', '--plan', '--destination'], optional: [] },
  }[command];
  if (!contract) throw new TypeError(HELP);
  const flags = new Map(), booleans = new Set(['--allow-loopback-upstream', '--allow-local-facilitator']);
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (![...contract.required, ...contract.optional].includes(key) || flags.has(key)) throw new TypeError(HELP);
    if (booleans.has(key)) { flags.set(key, true); continue; }
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new TypeError(HELP);
    flags.set(key, value);
  }
  if (contract.required.some(key => !flags.has(key))) throw new TypeError(HELP);
  const directory = flags.get('--directory');
  let result;
  if (command === 'prepare') result = await prepareSubQueryDeployment({ merchantDirectory: flags.get('--merchant'),
    directory, allowLoopbackUpstream: flags.has('--allow-loopback-upstream') });
  else if (command === 'inspect') result = await inspectSubQueryDeployment(directory);
  else if (command === 'stage') {
    const options = { directory, store: flags.get('--store'), id: flags.get('--id') };
    for (const key of ['label', 'facilitator']) if (flags.has('--' + key)) options[key] = flags.get('--' + key);
    if (flags.has('--port')) {
      const raw = flags.get('--port');
      if (!/^(0|[1-9][0-9]{0,4})$/.test(raw) || Number(raw) > 65535) throw new TypeError('Port must be 0–65535');
      options.port = Number(raw);
    }
    if (flags.has('--allow-local-facilitator')) options.allowLocalFacilitator = true;
    result = await stageSubQueryDeployment(options);
  } else result = await prepareSubQueryHost({ directory, host: parseJson(await readBytes(flags.get('--plan'))),
    destination: flags.get('--destination') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'SUBQUERY_DEPLOYMENT_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
