#!/usr/bin/env node
// MIT. Complete Snowflake merchant operations through the maintained original host.
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedFile } from '../../../sf46-release/release-core.mjs';
import { snowflakeActions, openSnowflakeClient, uploadSnowflakeOriginals,
  downloadSnowflakeExport, inspectSnowflakeExport, reopenSnowflakeExport } from './client.mjs';
import { fail } from './files.mjs';

const HELP = 'Snowflake merchant\n\n' +
  '  merchant-snowflake tools\n' +
  '  merchant-snowflake init --directory HOST --connection CONNECTION_JSON [--workspace ALIAS] [--name NAME]\n' +
  '  merchant-snowflake call ACTION --url MCP_URL [--token-env NAME] --args ORIGINAL_ARGUMENTS_JSON\n' +
  '  merchant-snowflake upload --url MCP_URL --workspace ALIAS --manifest ORIGINAL_RECEIVING_JSON [--workspace-id UUID] [--chunk-size BYTES] [--no-repair]\n' +
  '  merchant-snowflake inspect --url MCP_URL --export-id ID [--manifest-sha256 SHA]\n' +
  '  merchant-snowflake download --url MCP_URL --export-id ID --directory OUTPUT [--manifest-sha256 SHA] [--chunk-size BYTES]\n' +
  '  merchant-snowflake reopen --export-id ID --directory OUTPUT [--manifest-sha256 SHA]\n\n' +
  'Network commands also accept --token-env NAME. Tokens stay in the host environment.\n' +
  'Start the original host with starforge merchant serve --config HOST/merchant-mcp.json.\n' +
  'Uploads retain the original server receiving ID; downloads retain the original private directory across process restarts.\n';
function options(args, allowed) {
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!allowed.includes(key) || Object.hasOwn(values, key)) throw fail('CLI_ARGUMENTS', 'Unknown or repeated option: ' + key);
    if (key === '--no-repair') values[key] = true;
    else {
      const value = args[++index];
      if (typeof value !== 'string' || !value || value.startsWith('--')) throw fail('CLI_ARGUMENTS', 'Supply a value for ' + key + '.');
      values[key] = value;
    }
  }
  return values;
}
function required(values, keys) {
  for (const key of keys) if (values[key] === undefined) throw fail('CLI_ARGUMENTS', 'Supply ' + key + '.');
}
function count(value) {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw fail('CLI_ARGUMENTS', 'Use a positive integer byte count.');
  return Number(value);
}
const network = ['--url','--token-env'], selectedExport = ['--export-id','--manifest-sha256'];
async function jsonFile(value) {
  const path = resolve(value);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(dirname(path), basename(path), 2097152)));
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && ['--help','help'].includes(argv[0])) { process.stdout.write(HELP); return; }
  const [command, ...rest] = argv;
  let result;
  if (command === 'tools' && !rest.length) result = { tools: Object.values(snowflakeActions) };
  else if (command === 'init') {
    const o = options(rest, ['--directory','--connection','--workspace','--name']);
    required(o, ['--directory','--connection']);
    result = await (await import('./setup.mjs')).initializeSnowflakeWorkspaceMerchant({
      directory: o['--directory'], connection: o['--connection'], workspace: o['--workspace'], name: o['--name'] });
  } else if (command === 'call') {
    const [action, ...tail] = rest, o = options(tail, [...network,'--args']);
    required(o, ['--url','--args']);
    const client = await openSnowflakeClient({ url: o['--url'], tokenEnv: o['--token-env'] });
    result = await client.call(action, await jsonFile(o['--args']));
  } else if (command === 'upload') {
    const o = options(rest, [...network,'--workspace','--manifest','--workspace-id','--chunk-size','--no-repair']);
    required(o, ['--url','--workspace','--manifest']);
    result = await uploadSnowflakeOriginals({ url: o['--url'], tokenEnv: o['--token-env'], workspace: o['--workspace'],
      manifestFile: o['--manifest'], expectedWorkspaceId: o['--workspace-id'], chunkSize: count(o['--chunk-size']),
      repairIncomplete: !o['--no-repair'] });
  } else if (['download','inspect','reopen'].includes(command)) {
    const allowed = [...selectedExport, ...(command === 'reopen' ? [] : network),
      ...(command === 'inspect' ? [] : ['--directory']), ...(command === 'download' ? ['--chunk-size'] : [])];
    const o = options(rest, allowed);
    required(o, ['--export-id', ...(command === 'reopen' ? [] : ['--url']), ...(command === 'inspect' ? [] : ['--directory'])]);
    const selection = { exportId: o['--export-id'], expectedManifestSha256: o['--manifest-sha256'] };
    if (command === 'reopen') result = await reopenSnowflakeExport({ ...selection, directory: o['--directory'] });
    else {
      const connected = { ...selection, url: o['--url'], tokenEnv: o['--token-env'] };
      result = command === 'inspect' ? await inspectSnowflakeExport(connected) :
        await downloadSnowflakeExport({ ...connected, directory: o['--directory'], chunkSize: count(o['--chunk-size']) });
    }
  } else throw fail('CLI_ARGUMENTS', 'Choose an advertised merchant-snowflake command.');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error((error.code ? error.code + ': ' : '') + error.message); process.exitCode = 1; });
