#!/usr/bin/env node
// MIT. Complete policy workflow recipes and original Console/customer receiving.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { OpenApiWorkflowClient, writeOpenApiWorkflowFile } from './openapi-workflow-client.mjs';
import { fail } from './records.mjs';

const HELP = `starforge merchant-openapi-workflows COMMAND --url http://127.0.0.1:PORT/operator/ [options]

Original profiles: host, profiles, profile, profile-save, bind, profile-export, profile-import
Recipe authoring: recipe, prepare, install, installation, export-recipe, workflow-save
Original execution: run-prepare, run, status, continue, resume, pause, resolve, handover
Complete receiving: customer, customer-status, archive, download

--input FILE             Complete original JSON request/preparation/profile
--output FILE            New private output filename; identical completed retries reopen
--id ID                  Original profile, installation, run or delivery ID
--profile ID             Original profile for customer-status/archive
--token-env NAME         Existing Console bearer token variable (default MCP_ACCESS_TOKEN)
--wait                   Wait for the current native step/customer transfer to settle
--timeout-ms N           Receiving wait, default 120000
--mcp-url URL            Original MCP endpoint for the complete resumable download
--mcp-token-env NAME      MCP token variable, defaults to --token-env
--directory DIRECTORY    Original empty/private resumable package destination

prepare saves the full recipe, exact target review and frozen install request.
install reads that same file; run-prepare saves the complete original run request.
run starts or reopens it. continue requires id, expectedRevision and the exact
expectedReviewSha256 from its paused native policy review. The original browser
can inspect and continue the same profile, run and customer files.
`;
const COMMANDS = new Set(['host','profiles','profile','profile-save','bind','profile-export','profile-import',
  'recipe','prepare','install','installation','export-recipe','workflow-save','run-prepare','run','status',
  'continue','resume','pause','resolve','handover','customer','customer-status','archive','download']);
async function readInput(path, maximum = 32 * 1024 * 1024) {
  if (typeof path !== 'string' || !path) throw fail('OPENAPI_WORKFLOW_INPUT', 'Select the complete original JSON file with --input.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw fail('OPENAPI_WORKFLOW_INPUT', 'Select a regular complete JSON file within its original byte capacity.');
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size || bytes.length > maximum) throw fail('OPENAPI_WORKFLOW_INPUT', 'The selected original input changed while reading.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    url: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' },
    id: { type: 'string' }, profile: { type: 'string' }, 'token-env': { type: 'string' },
    wait: { type: 'boolean', default: false }, 'timeout-ms': { type: 'string' },
    'mcp-url': { type: 'string' }, 'mcp-token-env': { type: 'string' }, directory: { type: 'string' },
    help: { type: 'boolean', default: false }
  } });
  const command = positionals[0];
  if (values.help) { process.stdout.write(HELP); return; }
  if (positionals.length !== 1 || !COMMANDS.has(command))
    throw fail('OPENAPI_WORKFLOW_COMMAND', 'Choose one original command; use --help for the complete workflow.');
  if (['recipe','prepare','run-prepare','profile-export','archive'].includes(command) && !values.output)
    throw fail('OPENAPI_WORKFLOW_OUTPUT', 'Retain this complete preparation or artifact with --output before continuing.');
  const client = new OpenApiWorkflowClient({ url: values.url, tokenEnv: values['token-env'] ?? 'MCP_ACCESS_TOKEN' });
  const waiting = { timeoutMs: Number(values['timeout-ms'] ?? 120000) };
  let result, retained;
  try {
    switch (command) {
      case 'host': result = await client.host(); break;
      case 'profiles': result = await client.profiles(); break;
      case 'profile': result = await client.profile(values.id); break;
      case 'profile-save': result = await client.createProfile(await readInput(values.input)); break;
      case 'bind': result = await client.bindProfile(await readInput(values.input)); break;
      case 'recipe': result = await client.createRecipe(await readInput(values.input)); break;
      case 'prepare': result = await client.prepare(await readInput(values.input)); break;
      case 'install': result = await client.install(await readInput(values.input)); break;
      case 'installation': result = await client.installation(values.id); break;
      case 'export-recipe': result = await client.exportRecipe(await readInput(values.input)); break;
      case 'workflow-save': result = await client.saveWorkflow(await readInput(values.input)); break;
      case 'run-prepare': result = await client.prepareRun(await readInput(values.input)); break;
      case 'run': {
        const request = await readInput(values.input); result = await client.start(request);
        if (values.wait) result = await client.waitRun(request.request.id, waiting);
        break;
      }
      case 'status': result = values.wait ? await client.waitRun(values.id, waiting) : await client.run(values.id); break;
      case 'continue': {
        const input = await readInput(values.input); result = await client.continueReviewed(input);
        if (values.wait) result = await client.waitRun(input.id, waiting);
        break;
      }
      case 'resume': case 'pause': case 'resolve': case 'handover':
        result = await client[command](await readInput(values.input)); break;
      case 'customer': {
        result = await client.receiveCustomer(values.id);
        if (values.wait) result = await client.waitCustomer(result.delivery.profileId, result.delivery.id, waiting);
        break;
      }
      case 'customer-status': result = await client.waitCustomer(values.profile, values.id, {
        ...waiting, ...(values.wait ? {} : { timeoutMs: 1 })
      }); break;
      case 'archive':
        result = await client.downloadCustomerArchive({ profileId: values.profile, deliveryId: values.id, output: values.output }); break;
      case 'download': {
        if (!values['mcp-url'] || !values.directory)
          throw fail('OPENAPI_WORKFLOW_DOWNLOAD', 'Select the original --mcp-url and private --directory for full resumable receiving.');
        result = await client.downloadPackage(values.id, { url: values['mcp-url'], directory: values.directory,
          tokenEnv: values['mcp-token-env'] ?? values['token-env'] ?? 'MCP_ACCESS_TOKEN' });
        break;
      }
      case 'profile-export': {
        const packet = await client.exportProfile(values.id);
        retained = await writeOpenApiWorkflowFile(values.output, packet.bytes);
        result = { profileId: packet.archive.profile.id, contentSha256: packet.archive.contentSha256, file: retained };
        break;
      }
      case 'profile-import': result = await client.importProfile(await readInput(values.input, 128 * 1024 * 1024)); break;
    }
    if (values.output && !['archive','profile-export'].includes(command)) {
      retained = await writeOpenApiWorkflowFile(values.output, result);
      process.stdout.write(JSON.stringify({ file: retained }, null, 2) + '\n');
    } else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ code: error.code ?? 'OPENAPI_WORKFLOW_ERROR', reason: error.message,
      ...(error.outcomeUnknown ? { outcomeUnknown: true } : {}) }) + '\n');
    process.exitCode = 1;
  });
