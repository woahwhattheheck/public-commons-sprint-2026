#!/usr/bin/env node
// MIT. Installed customer/operator CLI for the original economic-edition workspace.
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { open, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MerchantFredWorkspaces } from './fred-workspace.mjs';
import { fredFileSelection } from './catalog/fred-workspace.mjs';
import { FredWorkspaceClient, FredWorkspaceError, FRED_WORKSPACE_CONNECTION_SCHEMA, readFredWorkspaceConfiguration,
  readFredHostFile, canonicalFredJSON, saveFredFile, receiveFredWorkspaceFile } from './fred-workspace-client.mjs';

export const FRED_WORKSPACE_HELP = [
  'Starforge economic workspace customer',
  '',
  'Retain a connection to the ORIGINAL running fred serve / managed Application:',
  '  connection-init --out PRIVATE_CONNECTION.json --console-url-file ORIGINAL_STARTUP.json',
  '                  [--workspace macro] [--project-id ORIGINAL_UUID] [--binding-sha SHA256]',
  '                  [--inputs-file INPUT_ALIASES.json] [--profiles-file MERCHANT_PROFILES.json]',
  '                  [--payment-file ORIGINAL_PAYMENT.json --merchant-origin HTTPS --profile native]',
  '                  [--label "Economic editions"]',
  '',
  'Every remote command: --connection PRIVATE_CONNECTION.json [--workspace ALIAS]',
  'Use --args-file JSON for complete native tool inputs. Additional flags must agree.',
  '',
  'Inspect and review:',
  '  status | inputs | input-inspect --input ALIAS',
  '  records --kind captures|reviews|publications|operations [--offset 0 --limit 50 --revision N]',
  '  record --kind KIND --id ID [--revision N]',
  '  operation --id ORIGINAL_ID | wait --id ORIGINAL_ID [--wait-ms 60000]',
  '  observations --capture SHA [--series UNRATE --offset 0]',
  '  compare --before SHA --after SHA [--offset 0]',
  '',
  'Build the original product:',
  '  configure --id ID --revision N --selection-file SELECTION.json',
  '  capture --id ID --revision N',
  '  import --id ID --revision N --input ORIGINAL_SOURCE_ALIAS [--sha256 FILE_SHA]',
  '  combine --id ID --revision N --captures SHA,SHA,SHA',
  '  select --id ID --revision N --capture SHA',
  '  review --id ID --revision N --capture SHA [--policy-file JSON --note-file TEXT]',
  '  publish --id ID --revision N --review SHA --profile HOST_PROFILE',
  '  abandon --id ID --revision N --pending ORIGINAL_ID',
  '',
  'Run the configured merchant and original customer:',
  '  merchant-start --publication SHA | merchant-stop --publication SHA',
  '  publication --publication SHA',
  '  requests --publication SHA [--offset 0 --limit 50 --view-sha SHA]',
  '  preview --publication SHA [--query QUERY]',
  '  prepare --publication SHA --intent ORIGINAL_ID [--query QUERY --previous-file PAGE_METADATA.json]',
  '          [--file ADVERTISED_FILE_PATH] [--accept N]',
  '  buy --publication SHA --intent ORIGINAL_ID',
  '  recover --publication SHA --intent ORIGINAL_ID',
  '',
  'Complete retained downloads and local project receiving:',
  '  download --kind source --capture SHA --out NEW_FILE [--sha256 FILE_SHA]',
  '  download --kind comparison --before SHA --after SHA --out NEW_FILE',
  '  download --kind customer --publication SHA --intent ORIGINAL_ID --out NEW_FILE',
  '  download --kind project --out NEW_PROJECT_BUNDLE.json',
  '  receive --source ORIGINAL_PROJECT_BUNDLE.json --project EMPTY_PRIVATE_DIRECTORY [--sha256 FILE_SHA]',
  '  disconnect',
  '',
  'The original startup record stays private and is reread when the host restarts.',
  'After an interrupted mutation inspect its saved operation; recover the same buyer',
  'intent. Complete source and customer downloads retain their exact bytes and SHA.',
  'Receive uses the maintained FRED project receiver. Reopen that directory with',
  'starforge fred serve and retain its new startup record for the same project.',
  ''
].join('\n');

const fail = message => { throw new FredWorkspaceError('FRED_CLI_USAGE', message); };
const remote = new Set(['workspaces','status','inputs','input-inspect','records','record','operation','observations','compare',
  'configure','capture','import','combine','select','review','publish','abandon','merchant-start','merchant-stop',
  'publication','requests','preview','prepare','buy','recover','disconnect']);
const allowed = new Set(['connection','workspace','args-file','out','console-url-file','project-id','binding-sha','label',
  'inputs-file','profiles-file','payment-file','merchant-origin','merchant-path','kind','id','capture','series','offset','limit','revision','before','after','input','sha256',
  'captures','review','profile','pending','publication','intent','query','file','accept','view-sha','selection-file',
  'policy-file','note-file','previous-file','wait-ms','source','project','help']);
function parse(values) {
  const argv = [...values], command = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'help', flags = {};
  while (argv.length) {
    const flag = argv.shift();
    if (!flag.startsWith('--') || !allowed.has(flag.slice(2))) fail('Unknown economic-workspace option. Read --help.');
    const key = flag.slice(2);
    if (Object.hasOwn(flags, key)) fail('Supply --' + key + ' once.');
    if (key === 'help') flags.help = true;
    else { if (!argv.length || argv[0].startsWith('--')) fail('Supply a value for --' + key + '.'); flags[key] = argv.shift(); }
  }
  return { command, flags };
}
const required = (flags, key) => flags[key] ?? fail('Supply --' + key + '.');
function number(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    fail('Supply an integer --' + label + '.');
  return Number(value);
}
async function jsonFile(path, maximum = 16 * 1024 * 1024) {
  const bytes = await readFredHostFile(path, maximum);
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('Use complete JSON in the original input file.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Use a JSON object in the original input file.');
  return value;
}
function only(flags, names) {
  for (const key of Object.keys(flags)) if (!names.includes(key)) fail('--' + key + ' is not used by this command.');
}
async function connectionInit(flags) {
  only(flags, ['out','console-url-file','workspace','project-id','binding-sha','label','inputs-file','profiles-file','payment-file','merchant-origin','merchant-path','profile']);
  if (flags['profiles-file'] && flags['payment-file']) fail('Choose the original profiles file or original payment file.');
  if (Boolean(flags['payment-file']) !== Boolean(flags['merchant-origin'])) fail('Supply --payment-file and --merchant-origin together.');
  if (!flags['payment-file'] && (flags.profile || flags['merchant-path'])) fail('Use --profile and --merchant-path with the original payment file.');
  const destination = resolve(required(flags, 'out')), workspace = flags.workspace ?? 'macro';
  const entry = { label: flags.label ?? 'Economic editions', consoleUrlFile: resolve(required(flags, 'console-url-file')),
    ...(flags['project-id'] ? { projectId: flags['project-id'] } : {}),
    ...(flags['binding-sha'] ? { expectedBindingSha256: flags['binding-sha'] } : {}),
    inputs: flags['inputs-file'] ? await jsonFile(flags['inputs-file'], 1024 * 1024) : {},
    merchantProfiles: flags['profiles-file'] ? await jsonFile(flags['profiles-file'], 1024 * 1024) : {} };
  if (flags['payment-file']) entry.merchantProfiles[flags.profile ?? 'native'] = { label: 'Original configured merchant',
    origin: flags['merchant-origin'], path: flags['merchant-path'] ?? '/economic-data', payment: await jsonFile(flags['payment-file'], 65536) };
  const value = { schema: FRED_WORKSPACE_CONNECTION_SCHEMA, workspaces: { [workspace]: entry } };
  // Inputs in a generated definition use original absolute paths, regardless of
  // where the complete input-alias file and connection file are retained.
  if (flags['inputs-file']) for (const input of Object.values(entry.inputs)) {
    if (input && typeof input.path === 'string') input.path = resolve(dirname(resolve(flags['inputs-file'])), input.path);
  }
  const temporary = resolve(dirname(destination), '.fred-connection-' + randomUUID());
  let handle, client, reused = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = null;
    const configured = await readFredWorkspaceConfiguration(temporary);
    client = new FredWorkspaceClient(configured.workspaces[workspace]);
    const launch = await client.launch();
    try { await link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFredHostFile(destination, 1024 * 1024, { privateFile: true })));
      if (canonicalFredJSON(previous) !== canonicalFredJSON(value)) fail('The existing private connection belongs to another original definition.');
      reused = true;
    }
    return { schema: value.schema, connection: destination, workspace, projectId: launch.binding.projectId,
      bindingSha256: launch.binding.sha256, instanceId: launch.instanceId, reused };
  } finally { client?.close(); await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function toolArgs(flags, workspace) {
  const args = flags['args-file'] ? await jsonFile(flags['args-file']) : {};
  const put = (key, value) => {
    if (Object.hasOwn(args, key) && canonicalFredJSON(args[key]) !== canonicalFredJSON(value))
      fail('The complete request file disagrees with --' + key + '. Keep the original request.');
    args[key] = value;
  };
  if (workspace !== undefined) put('workspace', workspace);
  const strings = { kind:'kind', id:'id', capture:'captureId', series:'series', before:'before', after:'after',
    input:'input', sha256:'expectedSha256', review:'reviewId', profile:'profile', pending:'pendingId',
    publication:'publicationId', intent:'intentId', query:'query', file:'file', 'view-sha':'expectedViewSha256' };
  for (const [flag, key] of Object.entries(strings)) if (flags[flag] !== undefined) put(key, flags[flag]);
  for (const [flag, key] of Object.entries({ offset:'offset', limit:'limit', revision:'expectedRevision', accept:'acceptIndex' }))
    if (flags[flag] !== undefined) put(key, number(flags[flag], flag));
  if (flags.captures !== undefined) put('captureIds', flags.captures.split(','));
  for (const [flag, key] of Object.entries({ 'selection-file':'selection', 'policy-file':'policy', 'previous-file':'previous' }))
    if (flags[flag] !== undefined) put(key, await jsonFile(flags[flag]));
  if (flags['note-file'] !== undefined) put('note', (await readFredHostFile(flags['note-file'], 32768)).toString('utf8'));
  return args;
}
export async function runFredWorkspaceCLI(argv, { write = value => process.stdout.write(value) } = {}) {
  const { command, flags } = parse(argv);
  const done = value => { write(JSON.stringify(value, null, 2) + '\n'); return value; };
  if (command === 'help' || flags.help) { write(FRED_WORKSPACE_HELP); return { help: true }; }
  if (command === 'connection-init') return done(await connectionInit(flags));
  if (command === 'receive') {
    only(flags, ['source','project','sha256']);
    return done(await receiveFredWorkspaceFile(required(flags, 'source'), required(flags, 'project'), { expectedSha256: flags.sha256 }));
  }
  if (!remote.has(command) && !['download', 'wait'].includes(command)) fail('Choose an economic-workspace command from --help.');
  const config = await readFredWorkspaceConfiguration(required(flags, 'connection'));
  const aliases = Object.keys(config.workspaces);
  const workspace = flags.workspace ?? (aliases.length === 1 ? aliases[0] : undefined);
  if (command !== 'workspaces' && (!workspace || !config.workspaces[workspace])) fail('Choose --workspace from this original connection.');
  const args = await toolArgs(flags, command === 'workspaces' ? undefined : workspace);
  const setupFlags = ['out','console-url-file','project-id','binding-sha','label','inputs-file','profiles-file','payment-file','merchant-origin','merchant-path','source','project'];
  if (command !== 'download' && setupFlags.some(key => flags[key] !== undefined)) fail('A setup or download option was supplied to a remote operation.');
  if (flags['wait-ms'] !== undefined && command !== 'wait') fail('Use wait with the same original project operation ID.');
  if (command === 'download' || command === 'wait') {
    const client = new FredWorkspaceClient(config.workspaces[workspace]);
    try {
      if (command === 'wait') {
        if (Object.keys(args).some(key => !['workspace', 'id'].includes(key))) fail('Wait selects only the original operation ID.');
        return done(await client.wait(args.id, { timeoutMs: flags['wait-ms'] ? number(flags['wait-ms'], 'wait-ms') : 60000 }));
      }
      if (setupFlags.filter(key => key !== 'out').some(key => flags[key] !== undefined)) fail('Download uses only its original file selection and destination.');
      if (Object.keys(args).some(key => !['workspace','expectedSha256',...Object.keys(fredFileSelection)].includes(key)))
        fail('Download selects only the complete original file and optional expected SHA256.');
      const selection = Object.fromEntries(Object.keys(fredFileSelection).filter(key => args[key] !== undefined).map(key => [key, args[key]]));
      return done(await saveFredFile(client, selection, required(flags, 'out'), { expectedSha256: args.expectedSha256 }));
    } finally { client.close(); }
  }
  const adapter = new MerchantFredWorkspaces({ fredWorkspaces: config, exportsDirectory: dirname(config.path) });
  try { return done(await adapter.call('merchant_fred_' + command.replaceAll('-', '_'), args)); }
  finally { await adapter.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runFredWorkspaceCLI(process.argv.slice(2)).catch(error => {
    process.stderr.write(JSON.stringify({ code: error.code ?? 'FRED_WORKSPACE_FAILED', message: error.message,
      ...(error.status ? { status: error.status } : {}), ...(error.operationId ? { operationId: error.operationId } : {}),
      ...(error.ambiguous !== undefined ? { ambiguous: error.ambiguous } : {}),
      ...(error.retryAt ? { retryAt: error.retryAt } : {}) }) + '\n'); process.exitCode = 1;
  });
