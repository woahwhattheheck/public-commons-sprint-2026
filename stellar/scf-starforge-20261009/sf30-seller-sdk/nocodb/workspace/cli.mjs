// MIT. The same retained NocoDB source workflow for operators and managed launch.
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, bytes, createFile, privateDirectory, fault } from '../../postgres/publisher/files.mjs';
import { openNocoDBAuthoring } from './model.mjs';
import { serveNocoDBAuthoring } from './server.mjs';
import { makeNocoDBSourcePacket, MAX_PACKET_BYTES } from './packet.mjs';
import { readNocoDBLaunchConnections, inspectNocoDBAuthoring, inspectNocoDBLaunchSource,
  prepareNocoDBManagedLaunch, nocodbManagedStartup } from './launch.mjs';

const HELP = [
  'NocoDB source-authoring workspace',
  '',
  '  init --directory PRIVATE_DIR [--target DATASET_DIR] [--connections PRIVATE_CONNECTIONS.json]',
  '  serve --directory PRIVATE_DIR [--create] [--port 8461] [--connections PRIVATE_CONNECTIONS.json]',
  '  status --directory PRIVATE_DIR',
  '  discover --directory PRIVATE_DIR --connections FILE --connection ALIAS --base ID --table ID [--view ID] [--where FILTER]',
  '  capture --directory PRIVATE_DIR --connections FILE --selection PRIVATE_SELECTION.json --title TITLE --expected-revision N',
  '  import-source --directory PRIVATE_DIR --source FROZEN_SOURCE.json --title TITLE --expected-revision N',
  '  import --directory PRIVATE_DIR --packet SOURCE_PACKET.json --title TITLE --expected-revision N',
  '  inspect-capture --directory PRIVATE_DIR --capture UUID',
  '  attempt --directory PRIVATE_DIR --request UUID',
  '  draft --directory PRIVATE_DIR --draft PRIVATE_DRAFT.json --expected-revision N',
  '  preview --directory PRIVATE_DIR --draft-revision N',
  '  save --directory PRIVATE_DIR --draft-revision N --preview UUID --reviewer NAME --note TEXT --expected-selected-version N|null',
  '  select --directory PRIVATE_DIR --version N --expected-selected-version N|null',
  '  compare --directory PRIVATE_DIR --left N --right N',
  '  export --directory PRIVATE_DIR --version N --out NEW_PACKET.json',
  '  export-capture --directory PRIVATE_DIR --capture UUID --out NEW_PACKET.json',
  '  packet --source FROZEN_SOURCE.json --out NEW_PACKET.json',
  '  operation --directory PRIVATE_DIR --request UUID',
  '  resume --directory PRIVATE_DIR --request UUID',
  '  publisher --directory PRIVATE_DIR --version N',
  '  deployment-status --directory PRIVATE_DIR',
  '  deployment-review --directory PRIVATE_DIR --input PRIVATE_REVIEW.json',
  '  deployment-prepare --directory PRIVATE_DIR --input PRIVATE_PACKAGE_REQUEST.json',
  '  deployment-stage --directory PRIVATE_DIR --input PRIVATE_STAGE.json',
  '  deployment-package --directory PRIVATE_DIR --request PACKAGE_UUID',
  '  deployment-console --directory PRIVATE_DIR',
  '  deployment-compare --directory PRIVATE_DIR --from RELEASE_ID --to RELEASE_ID',
  '  deployment-file --directory PRIVATE_DIR --request PACKAGE_UUID --file NAME --out NEW_FILE',
  '  identity --directory PRIVATE_DIR',
  '  source-identity [--source-directory INSTALLED_WORKSPACE_SOURCE_DIR]',
  '',
  'Writes accept --request UUID. Save the printed UUID and use operation/resume after an interrupted response.',
  'Resume never repeats a provider metadata or page request. A new observation requires an explicit new request.',
  'Capture and source packets retain every original page and its count/schema receipts, without token values.',
  'The browser supplies version review, original publisher and complete original SF82 deployment controls.',
  '',
  'Managed serve additionally accepts --source-directory DIR --source-sha256 SHA --workspace-identity SHA',
  '  [--connections-sha256 SHA] --startup-json. These bind original immutable settings and installed source.',
].join('\n') + '\n';
const FLAGS = new Set(['--create','--startup-json']);
const VALUES = new Set(['--directory','--target','--connections','--port','--connection','--base','--table','--view','--where',
  '--selection','--title','--expected-revision','--source','--packet','--capture','--draft','--draft-revision','--preview',
  '--reviewer','--note','--expected-selected-version','--version','--left','--right','--out','--request','--input',
  '--from','--to','--file','--source-directory','--source-sha256','--workspace-identity','--connections-sha256']);
const COMMANDS = new Set(['init','serve','status','discover','capture','import-source','import','inspect-capture','attempt',
  'draft','preview','save','select','compare','export','export-capture','packet','operation','resume','publisher',
  'deployment-status','deployment-review','deployment-prepare','deployment-stage','deployment-package',
  'deployment-console','deployment-compare','deployment-file','identity','source-identity']);
const PATHS = new Set(['--directory','--target','--connections','--selection','--source','--packet','--draft','--out','--input','--source-directory']);
function parse(argv) {
  const [command, ...args] = argv, options = {};
  if (!COMMANDS.has(command)) throw fault('COMMAND_REQUIRED', HELP);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (Object.hasOwn(options, key) || !FLAGS.has(key) && !VALUES.has(key)) throw fault('NOCODB_OPTION_INVALID', 'Unknown or repeated option: ' + key);
    if (FLAGS.has(key)) options[key] = true;
    else {
      if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw fault('NOCODB_OPTION_VALUE_REQUIRED', key);
      const value = args[++i]; options[key] = PATHS.has(key) ? resolve(value) : value;
    }
  }
  return { command, options };
}
const number = (value, label) => {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw fault('NOCODB_INTEGER_REQUIRED', 'Supply ' + label + ' as the current nonnegative integer.');
  return Number(value);
};
const required = (o, key) => { if (o[key] === undefined || o[key] === '') throw fault('NOCODB_OPTION_REQUIRED', key); return o[key]; };
const selected = o => required(o, '--expected-selected-version') === 'null' ? null : number(o['--expected-selected-version'], '--expected-selected-version');
const output = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
async function saveFile(file, content) {
  await privateDirectory(dirname(file)); await createFile(file, content);
  return { file, bytes: content.length };
}
async function lifetime(service, ready, { compact = false } = {}) {
  let stopping = null, stop;
  const close = () => stopping ??= service.close();
  const done = new Promise((resolve, reject) => {
    stop = () => close().then(resolve, reject);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  });
  try { if (compact) process.stdout.write(JSON.stringify(ready) + '\n'); else output(ready); await done; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await close(); }
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help')) { process.stdout.write(HELP); return; }
  const { command, options: o } = parse(argv);
  if (command === 'packet') {
    const packet = await makeNocoDBSourcePacket(required(o, '--source'));
    const result = await saveFile(required(o, '--out'), bytes(packet)); output(result); return result;
  }
  if (command === 'source-identity') { const result = await inspectNocoDBLaunchSource(o['--source-directory'] ?? dirname(new URL(import.meta.url).pathname)); output(result); return result; }
  const directory = required(o, '--directory');
  if (o['--create'] && !['init','serve'].includes(command)) throw fault('NOCODB_OPTION_INVALID', '--create is available only for initialization or serve.');
  if (command === 'identity') { const result = await inspectNocoDBAuthoring(directory); output(result); return result; }
  const managed = command === 'serve' && o['--source-sha256'] !== undefined;
  const launch = managed ? await prepareNocoDBManagedLaunch({ directory, sourceDirectory: required(o, '--source-directory'),
    expectedSourceSha256: o['--source-sha256'], expectedWorkspaceIdentity: required(o, '--workspace-identity'),
    connectionsFile: o['--connections'], expectedConnectionsSha256: o['--connections-sha256'] }) : null;
  if (!managed && ['--source-directory','--workspace-identity','--connections-sha256','--startup-json'].some(key => o[key] !== undefined))
    throw fault('NOCODB_MANAGED_REVIEW_REQUIRED');
  const connection = launch?.connection ?? await readNocoDBLaunchConnections(o['--connections']);
  const workspace = await openNocoDBAuthoring({ directory, create: command === 'init' || o['--create'] === true,
    targetDirectory: o['--target'], connections: connection.connections,
    ...(launch ? { expectedIdentity: launch.expectedWorkspaceIdentity } : {}) });
  let handed = false;
  const requestId = () => {
    o['--request'] ??= randomUUID();
    process.stderr.write('requestId=' + o['--request'] + '\n');
    return o['--request'];
  };
  try {
    let result;
    if (command === 'serve') {
      const service = await serveNocoDBAuthoring({ workspace, port: o['--port'] === undefined ? 8461 : number(o['--port'], '--port') });
      let ready;
      try { ready = launch ? await nocodbManagedStartup({ launch, workspace, service }) :
        { schema: 'stellar-forge.nocodb-authoring-startup.v1', status: 'NOCODB_AUTHORING_READY', directory, url: service.url }; }
      catch (issue) { await service.close(); throw issue; }
      handed = true; await lifetime(service, ready, { compact: o['--startup-json'] === true }); return ready;
    }
    if (command === 'init' || command === 'status') result = await workspace.status();
    else if (command === 'discover') result = await workspace.discover({ connectionAlias: required(o, '--connection'),
      baseId: required(o, '--base'), tableId: required(o, '--table'), viewId: o['--view'] ?? null, where: o['--where'] ?? null, requestId: requestId() });
    else if (command === 'capture') result = await workspace.readLive({ ...await readJson(required(o, '--selection')),
      title: required(o, '--title'), expectedDraftRevision: number(required(o, '--expected-revision'), '--expected-revision'), requestId: requestId() });
    else if (command === 'import-source') result = await workspace.importSource({ sourceFile: required(o, '--source'),
      title: required(o, '--title'), expectedDraftRevision: number(required(o, '--expected-revision'), '--expected-revision'), requestId: requestId() });
    else if (command === 'import') result = await workspace.importPacket({ packet: await readJson(required(o, '--packet'), MAX_PACKET_BYTES),
      title: required(o, '--title'), expectedDraftRevision: number(required(o, '--expected-revision'), '--expected-revision'), requestId: requestId() });
    else if (command === 'inspect-capture') result = await workspace.inspectCapture(required(o, '--capture'));
    else if (command === 'attempt') result = await workspace.captureAttempt(required(o, '--request'));
    else if (command === 'draft') result = await workspace.saveDraft({ draft: await readJson(required(o, '--draft')),
      expectedRevision: number(required(o, '--expected-revision'), '--expected-revision'), requestId: requestId() });
    else if (command === 'preview') result = await workspace.preview({ draftRevision: number(required(o, '--draft-revision'), '--draft-revision'), requestId: requestId() });
    else if (command === 'save') result = await workspace.saveVersion({ draftRevision: number(required(o, '--draft-revision'), '--draft-revision'),
      previewId: required(o, '--preview'), reviewer: required(o, '--reviewer'), note: required(o, '--note'),
      expectedSelectedVersion: selected(o), requestId: requestId() });
    else if (command === 'select') result = await workspace.selectVersion({ versionId: number(required(o, '--version'), '--version'),
      expectedSelectedVersion: selected(o), requestId: requestId() });
    else if (command === 'compare') result = await workspace.compareVersions(number(required(o, '--left'), '--left'), number(required(o, '--right'), '--right'));
    else if (command === 'export' || command === 'export-capture') {
      const artifact = command === 'export' ? await workspace.exportVersion(number(required(o, '--version'), '--version')) :
        await workspace.exportCapture(required(o, '--capture'));
      result = await saveFile(required(o, '--out'), artifact.bytes);
    } else if (command === 'operation') result = workspace.operation(required(o, '--request'));
    else if (command === 'resume') result = await workspace.resume(required(o, '--request'));
    else if (command === 'publisher') {
      const opened = await workspace.openPublisher({ expectedSelectedVersion: number(required(o, '--version'), '--version'), requestId: requestId() });
      handed = true; await lifetime(workspace, opened); return opened;
    } else if (command === 'deployment-status') result = await workspace.deploymentStatus();
    else if (command === 'deployment-review') result = await workspace.reviewDeployment({ ...await readJson(required(o, '--input')), requestId: requestId() });
    else if (command === 'deployment-prepare') result = await workspace.prepareDeployment({ ...await readJson(required(o, '--input')), requestId: requestId() });
    else if (command === 'deployment-stage') result = await workspace.stageDeployment({ ...await readJson(required(o, '--input')), requestId: requestId() });
    else if (command === 'deployment-package') result = await workspace.inspectDeploymentPackage(required(o, '--request'));
    else if (command === 'deployment-compare') result = await workspace.compareDeployment({ from: o['--from'], to: required(o, '--to') });
    else if (command === 'deployment-console') {
      const opened = await workspace.openDeploymentConsole({ requestId: requestId() });
      handed = true; await lifetime(workspace, opened); return opened;
    } else if (command === 'deployment-file') {
      const artifact = await workspace.deploymentFile(required(o, '--request'), required(o, '--file'));
      result = await saveFile(required(o, '--out'), artifact.bytes);
    } else throw fault('COMMAND_REQUIRED', HELP);
    output({ ...(result && typeof result === 'object' ? result : { result }),
      ...(o['--request'] && !['operation','resume','attempt','deployment-package','deployment-file'].includes(command) ? { requestId: o['--request'] } : {}) });
    return result;
  } finally { if (!handed) await workspace.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'NOCODB_WORKSPACE') + ': ' +
    (issue.code ? issue.message : 'Inspect the private source workspace and retained request.') + '\n'); process.exitCode = 1; });

