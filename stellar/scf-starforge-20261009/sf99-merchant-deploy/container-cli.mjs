#!/usr/bin/env node
// MIT. Original merchant container preparation and operation entrypoint.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareContainer, generateContainer, checkContainer } from './container.mjs';

const HELP = `node cli.mjs container inspect --plan PRIVATE_CONTAINER.json
node cli.mjs container generate --plan PRIVATE_CONTAINER.json --out NEW_PRIVATE_DIRECTORY
node cli.mjs container check --bundle PRIVATE_CONTAINER_DIRECTORY
node cli.mjs container pull|up|status|stop|logs|smoke --bundle PRIVATE_CONTAINER_DIRECTORY
node cli.mjs container maintenance --help

Prepare the original API, retained-release or paid-file merchant for Linux
Compose. The image, numeric runtime identity, source and private roots are explicit.
Generation writes a new private bundle with original Caddy and recovery artifacts.
The included runbook carries installation, original runtime, backup and recovery.`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { console.log(HELP); return 0; }
  if (args[0] === 'maintenance') return (await import('./compose-maintenance.mjs')).main(args.slice(1));
  if (['pull', 'up', 'status', 'stop', 'logs', 'smoke'].includes(args[0]))
    return (await import('./container-operations.mjs')).main(args);
  const [command, ...rest] = args;
  const allowed = { inspect: ['--plan'], generate: ['--plan', '--out'], check: ['--bundle'] }[command];
  if (!allowed) throw new Error(HELP);
  const values = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (!allowed.includes(key) || values[key] !== undefined || !rest[index + 1] || rest[index + 1].startsWith('--'))
      throw new Error(HELP);
    values[key] = rest[++index];
  }
  let result;
  if (command === 'inspect' && values['--plan']) {
    const { spec, host } = await prepareContainer(values['--plan']);
    result = { merchant: host.merchant, kind: host.kind, mode: host.mode, publicOrigin: host.publicOrigin,
      image: spec.image, uid: spec.uid, gid: spec.gid, sourceMode: spec.sourceMode,
      sourceRoot: host.sourceRoot, stateRoot: host.stateRoot, readOnlyRoots: spec.readOnlyRoots,
      components: host.services.map(service => service.role),
      stopGraceSeconds: host.services.reduce((sum, service) => sum + service.stopSeconds, 0) + 15 };
  } else if (command === 'generate' && values['--plan'] && values['--out'])
    result = await generateContainer(values['--plan'], values['--out']);
  else if (command === 'check' && values['--bundle']) {
    const { host, container, bundle } = await checkContainer(values['--bundle']);
    result = { bundle, merchant: host.merchant, image: container.image,
      status: 'ORIGINAL_MERCHANT_AND_CONTAINER_CONFIGURATION_MATCH',
      composeFile: container.composeFile, project: container.project, service: container.service };
  } else throw new Error(HELP);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
