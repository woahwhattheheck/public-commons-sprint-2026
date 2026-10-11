// MIT. Explicit native schema capture, offline inspection and merchant preparation.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureSchema, inspectSchema, readSchemaSource, validateApprovedQueries } from './schema.mjs';
import { prepareSubQuerySeller } from './prepare.mjs';
import { prepareSubQueryRevision, reviewSubQueryRevision } from './revisions.mjs';
import { parseJson, readBytes } from './files.mjs';

const HELP = `Usage: node onboarding/cli.mjs COMMAND [options]
  capture --endpoint PRIVATE_ENDPOINT.json --directory NEW_DIRECTORY [--allow-loopback-upstream]
  inspect --schema SERVED_SCHEMA [--type TYPE_NAME]
  validate --schema SERVED_SCHEMA --queries PRIVATE_QUERIES.json
  prepare --schema SERVED_SCHEMA --queries PRIVATE_QUERIES.json --plan MERCHANT_PLAN.json --directory NEW_DIRECTORY
  compare --previous MERCHANT_DIRECTORY --schema NEW_SERVED_SCHEMA [--queries REVISED_QUERIES.json] [--plan REVISED_PLAN.json]
  revise --previous MERCHANT_DIRECTORY --schema NEW_SERVED_SCHEMA --directory NEW_REVISION_DIRECTORY [--queries REVISED_QUERIES.json] [--plan REVISED_PLAN.json]
Only capture makes a network request. It sends one original introspection POST.
`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return null; }
  const [command, ...rest] = args;
  const contracts = {
    capture: { required: ['--endpoint', '--directory'], optional: ['--allow-loopback-upstream'] },
    inspect: { required: ['--schema'], optional: ['--type'] },
    validate: { required: ['--schema', '--queries'], optional: [] },
    prepare: { required: ['--schema', '--queries', '--plan', '--directory'], optional: [] },
    compare: { required: ['--previous', '--schema'], optional: ['--queries', '--plan'] },
    revise: { required: ['--previous', '--schema', '--directory'], optional: ['--queries', '--plan'] },
  };
  const contract = contracts[command], flags = new Map();
  if (!contract) throw new TypeError(HELP);
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (![...contract.required, ...contract.optional].includes(key) || flags.has(key)) throw new TypeError(HELP);
    if (key === '--allow-loopback-upstream') { flags.set(key, true); continue; }
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new TypeError(HELP);
    flags.set(key, value);
  }
  if (contract.required.some(key => !flags.has(key))) throw new TypeError(HELP);
  let result;
  if (command === 'capture') result = await captureSchema({ endpointFile: flags.get('--endpoint'),
    directory: flags.get('--directory'), allowLoopback: flags.has('--allow-loopback-upstream') });
  else if (command === 'prepare') result = await prepareSubQuerySeller({ schemaFile: flags.get('--schema'),
    queriesFile: flags.get('--queries'), planFile: flags.get('--plan'), directory: flags.get('--directory') });
  else if (['compare', 'revise'].includes(command)) {
    const revision = { previousDirectory: flags.get('--previous'), schemaFile: flags.get('--schema'),
      ...(flags.has('--queries') ? { queriesFile: flags.get('--queries') } : {}),
      ...(flags.has('--plan') ? { planFile: flags.get('--plan') } : {}) };
    result = command === 'compare' ? await reviewSubQueryRevision(revision) :
      await prepareSubQueryRevision({ ...revision, directory: flags.get('--directory') });
  }
  else {
    const schema = await readSchemaSource(flags.get('--schema'));
    if (command === 'inspect') {
      result = inspectSchema(schema);
      if (flags.has('--type')) {
        const selected = result.types.find(type => type.name === flags.get('--type'));
        if (!selected) throw new TypeError('Type is absent from the supplied served schema');
        result = { sourceSha256: result.sourceSha256, type: selected };
      }
    } else {
      const validated = validateApprovedQueries(schema, parseJson(await readBytes(flags.get('--queries'))));
      result = { sourceSha256: schema.sourceSha256, operations: validated.operations, status: 'SCHEMA_VALID' };
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'SUBQUERY_ONBOARDING_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
