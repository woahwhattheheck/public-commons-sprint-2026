#!/usr/bin/env node
// MIT. Customer CLI for the existing STAC analyst host and merchant MCP adapter.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, open } from 'node:fs/promises';
import { MerchantStacWorkspaces } from './stac-workspace.mjs';
import { STAC_WORKSPACE_CONNECTION_SCHEMA, StacWorkspaceClient, StacWorkspaceError,
  readStacWorkspaceConfiguration, readStacHostFile, saveStacFile } from './stac-workspace-client.mjs';

export const STAC_WORKSPACE_HELP = `Starforge STAC workspace customer
Connect to the ORIGINAL running imagery/processing host:
  connection-init --out CONNECTION.json --console-url-file ORIGINAL_SERVE.json
                  [--workspace imagery] [--workspace-id SAVED_ID]
                  [--label "Imagery workspace"]
  Every command below: --connection CONNECTION.json [--workspace ALIAS]
  The original serve JSON/private URL remains private. A plain URL needs workspaceId.

Read and review:
  status
  records --kind queries|reviews|editions|assets|decisions|operations|...
          [--offset 0 --limit 50 --revision N]
  record --kind KIND [--id ID] [--revision N]
  edition --edition-id ID
  items --edition-id ID [--offset 0 --limit 50 --view-sha SHA256]
  item --edition-id ID --item-id COLLECTION_QUALIFIED_ID
  compare --left-edition-id ID --right-edition-id ID
          --kind added|removed|changed|unchanged [--offset 0 --view-sha SHA256]
  operation --operation-id ID
  wait --operation-id ID [--wait-ms 60000]

Imagery:
  discover --operation-id ID --revision N [--wait-ms 60000]
  query-save --query-file QUERY.json --revision N
  search-review --query-id ID
  search-acquire --review-id ID --operation-id ID [--wait-ms 60000]
  search-resume --edition-id ID --operation-id ID [--wait-ms 60000]
  search-cancel --edition-id ID
  asset-review --edition-id ID --item-id ID --asset-key KEY --max-bytes N
  asset-acquire --review-id ID --operation-id ID [--wait-ms 60000]
  asset-range --asset-id ID [--offset 0 --limit 65536 --sha256 SHA256]
  decision-save --args-file DECISION.json
    DECISION contains editionId,itemId,status,actor,note,assetKeys,expectedRevision.

Processing and receiving:
  inputs
  input-inspect --input HOST_ALIAS
  input-import --input HOST_ALIAS --sha256 SHA256 [--operation-id ID]
    For processing pages also --edition-id ID --task-id ID --metadata-file JSON.
  processing-status
  processing-read --name inventory|statistics|edition|runs|run|associations
                  --query-file QUERY.json [--path runs --offset 0 --limit 50]
  processing-configure --profile HOST_ALIAS --sha256 SOURCE_SHA256
                       --revision N --operation-id ID
  processing-action --name ACTION --input-file INPUT.json --operation-id ID
                    [--wait-ms 60000]
    ACTION is enabled by the original host. Full imports/configuration use aliases.

Prescient customer operation on the same original host:
  prescient-status
  prescient-records --kind profiles|reviews|approvals|deliveryReviews|deliveries|operations
                   [--offset 0 --limit 50 --revision CONFIGURATION_REVISION]
  prescient-record --kind KIND --id ID [--revision CONFIGURATION_REVISION]
  prescient-profile --profile-sha SAVED_PROFILE_SHA256
  prescient-action --name ACTION --input-file INPUT.json --actor REVIEWER
                   --operation-id SAVED_ID --revision CONFIGURATION_REVISION
                   [--delivery HOST_DELIVERY_ALIAS]
    ACTION: profile-save, profile-import, profile-review, profile-approve,
            connect, session, delivery-review, delivery-export, delivery-open.
    Use --args-file for a retained complete action. Retry the same original ID,
    actor, input and revision only after operation inspection. See PRESCIENT.md.
    Credentials and source/receiving directories remain host-configured.

Complete original downloads:
  download --kind asset --asset-id ID --out NEW_FILE [--sha256 SHA256]
  download --kind report --edition-id ID --format json|csv|html --out NEW_FILE
  download --kind handover [--edition-ids ID,ID] [--include-assets true|false]
           --out NEW_FILE
  download --kind processing-handover --export-id ID --out NEW_FILE
  download --kind processing-source --deployment-key ID --out NEW_FILE
  download --kind prescient-profile --profile-sha SAVED_PROFILE_SHA256 --out NEW_FILE
  download --kind state|edition|comparison|processing-state|processing-read|prescient-state
           [native selection flags] --out NEW_FILE

Use --args-file JSON for complete native tool inputs instead of many flags.
Results are JSON. Downloads publish complete verified bytes without overwriting a
file. A failed/aborted wait leaves the same native operation running; inspect it
or explicitly cancel its saved edition. Host restart requires its new serve JSON.
Reopening reads the same saved workspace and never replays acquisition.
`;
const fail = message => { throw new StacWorkspaceError('STAC_CLI_USAGE', message); };
const commands = new Set(['status','records','record','edition','items','item','compare','operation','discover','query-save',
  'search-review','search-acquire','search-resume','search-cancel','asset-review','asset-acquire','asset-range','decision-save','inputs',
  'input-inspect','input-import','processing-status','processing-read','processing-configure','processing-action','disconnect',
  'prescient-status','prescient-records','prescient-record','prescient-profile','prescient-action']);
const flagsAllowed = new Set(['connection','workspace','args-file','query-file','input-file','metadata-file','console-url-file','out',
  'workspace-id','label','kind','id','edition-id','item-id','asset-id','query-id','review-id','operation-id','left-edition-id','right-edition-id',
  'asset-key','max-bytes','offset','limit','revision','expected-revision','view-sha','sha256','input','task-id','name','profile','path','format',
  'edition-ids','include-assets','deployment-key','export-id','wait-ms','help','actor','delivery','profile-sha']);
function parse(argv) {
  const command = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'help', flags = {};
  while (argv.length) {
    const key = argv.shift();
    if (!key.startsWith('--') || !flagsAllowed.has(key.slice(2))) fail('Unknown STAC flag. Read --help.');
    const name = key.slice(2);
    if (Object.hasOwn(flags, name)) fail('Supply each STAC flag once.');
    if (name === 'help') flags.help = true;
    else { if (!argv.length || argv[0].startsWith('--')) fail('Supply a value for --' + name + '.'); flags[name] = argv.shift(); }
  }
  return { command, flags };
}
const required = (flags, name) => flags[name] ?? fail('Supply --' + name + '.');
async function jsonFile(path, maximum = 16 * 1024 * 1024) {
  const bytes = await readStacHostFile(path, maximum);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail('Use a complete JSON object in the selected input file.'); }
}
function integer(value, name) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail('Supply a nonnegative integer --' + name + '.');
  return Number(value);
}
async function inputArgs(flags, workspace, command) {
  const args = flags['args-file'] ? await jsonFile(flags['args-file']) : {};
  if (args.workspace !== undefined && args.workspace !== workspace) fail('The selected args file belongs to another workspace alias.');
  args.workspace = workspace;
  const simple = { kind:'kind', id:'id', 'edition-id':'editionId', 'item-id':'itemId', 'asset-id':'assetId', 'query-id':'queryId',
    'review-id':'reviewId', 'operation-id':'operationId', 'left-edition-id':'leftEditionId', 'right-edition-id':'rightEditionId',
    'asset-key':'assetKey', input:'input', 'task-id':'taskId', name:'name', profile:'profile', format:'format',
    'view-sha':'expectedViewSha256', sha256:'expectedSha256', 'deployment-key':'deploymentKey', 'export-id':'exportId',
    actor:'actor', delivery:'delivery', 'profile-sha':'profileSha256' };
  for (const [flag,key] of Object.entries(simple)) if (flags[flag] !== undefined) args[key] = flags[flag];
  for (const [flag,key] of Object.entries({'max-bytes':'maxBytes',offset:'offset',limit:'limit',revision:'expectedRevision','expected-revision':'expectedRevision'}))
    if (flags[flag] !== undefined) args[key] = integer(flags[flag],flag);
  if (flags['edition-ids']) args.editionIds = flags['edition-ids'].split(',');
  if (flags['include-assets'] !== undefined) {
    if (!['true','false'].includes(flags['include-assets'])) fail('Choose --include-assets true or false.');
    args.includeAssets = flags['include-assets'] === 'true';
  }
  if (flags.path !== undefined) args.path = flags.path === '' ? [] : flags.path.split('.');
  if (flags['query-file']) args.query = await jsonFile(flags['query-file']);
  if (flags['input-file']) args.input = await jsonFile(flags['input-file']);
  if (flags['metadata-file']) args.metadata = await jsonFile(flags['metadata-file']);
  return args;
}
async function initialize(flags) {
  const destination = resolve(required(flags,'out')), parent = await lstat(dirname(destination));
  if (!parent.isDirectory() || parent.isSymbolicLink() || process.platform !== 'win32' && parent.mode & 0o077)
    fail('Choose an existing private output directory (0700) for the connection file.');
  const workspace = flags.workspace ?? 'imagery';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace)) fail('Use a lowercase workspace alias.');
  const entry = { label: flags.label ?? 'STAC imagery workspace', consoleUrlFile: resolve(required(flags,'console-url-file')),
    ...(flags['workspace-id'] ? { workspaceId: flags['workspace-id'] } : {}), inputs: {}, processingProfiles: {}, prescientDeliveries: {} };
  const value = { schema: STAC_WORKSPACE_CONNECTION_SCHEMA, workspaces: { [workspace]: entry } };
  const file = await open(destination,'wx',0o600);
  try { await file.writeFile(JSON.stringify(value,null,2)+'\n'); await file.sync(); }
  finally { await file.close(); }
  const directory = await open(dirname(destination),'r'); try { await directory.sync(); } finally { await directory.close(); }
  return { schema:value.schema, connection:destination, workspace, state:'CONFIGURED', hostOwnership:'ORIGINAL_STAC_HOST' };
}
export async function runStacWorkspaceCLI(argv = process.argv.slice(2), { stdout = value => process.stdout.write(value),
  stderr = value => process.stderr.write(value), environment = process.env } = {}) {
  let adapter, client; const lifetime = new AbortController();
  const stop = () => { lifetime.abort(new Error('STAC client interrupted')); client?.close(); void adapter?.close().catch(() => {}); };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  try {
    const {command,flags} = parse([...argv]);
    if (command === 'help' || flags.help) { stdout(STAC_WORKSPACE_HELP); return 0; }
    if (command === 'connection-init') { stdout(JSON.stringify(await initialize(flags))+'\n'); return 0; }
    const connectionPath = flags.connection ?? environment.STAC_WORKSPACE_CONNECTION;
    if (!connectionPath) fail('Supply --connection or STAC_WORKSPACE_CONNECTION.');
    const configuration = await readStacWorkspaceConfiguration(connectionPath), aliases = Object.keys(configuration.workspaces);
    const selected = flags.workspace ?? (aliases.length === 1 ? aliases[0] : fail('Choose --workspace from the configured aliases.'));
    const entry = configuration.workspaces[selected];
    if (!entry) fail('This alias is not configured in the original host connection.');
    const args = await inputArgs(flags,selected,command);
    client = new StacWorkspaceClient(entry,{environment});
    let result;
    if (command === 'wait') result = await client.wait(required(flags,'operation-id'),
      { signal:lifetime.signal, timeoutMs:flags['wait-ms'] ? integer(flags['wait-ms'],'wait-ms') : 60000 });
    else if (command === 'download') {
      const {workspace:_workspace, expectedSha256, ...selection} = args;
      result = await saveStacFile(client,selection,required(flags,'out'),{expectedSha256,signal:lifetime.signal});
    } else {
      if (!commands.has(command)) fail('Unknown STAC command. Read --help.');
      adapter = new MerchantStacWorkspaces({stacWorkspaces:configuration,exportsDirectory:dirname(resolve(connectionPath))},{environment});
      result = await adapter.call('merchant_stac_'+command.replaceAll('-','_'),args);
      if (flags['wait-ms'] && result?.status === 'RUNNING' && result?.id)
        result = await client.wait(result.id,{signal:lifetime.signal,timeoutMs:integer(flags['wait-ms'],'wait-ms')});
    }
    stdout(JSON.stringify(result)+'\n');
    return result?.status === 'FAILED' || result?.error ? 2 : 0;
  } catch(error) {
    stderr(JSON.stringify({error:{code:error.code ?? 'STAC_CLI_ERROR',message:error.message,
      ...(error.status ? {status:error.status} : {}), ...(error.ambiguous !== undefined ? {ambiguous:error.ambiguous} : {}),
      ...(error.operationId ? {operationId:error.operationId} : {}), ...(error.published ? {published:true,filename:error.filename,sha256:error.sha256} : {})}})+'\n');
    return 2;
  } finally {
    process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
    client?.close(); await adapter?.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runStacWorkspaceCLI();
