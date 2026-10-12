// MIT. Native source authoring command, nested under the maintained Sheets CLI.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPrivate, readJson, createFile, fault } from '../../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES } from '../declaration.mjs';
import { openSheetsAuthoring } from './model.mjs';
import { serveSheetsAuthoring } from './server.mjs';

const HELP = `Google Sheets source workspace (Linux, Node 22.16+, util-linux flock)

  serve --directory DIR [--create] [--port 8453] [--connections PRIVATE_CONNECTIONS.json]
        [--state DATASET_DIR] [--seller http://127.0.0.1:PORT --resource https://merchant.example/data]
  init --directory NEW_DIR [--state DATASET_DIR]
  status --directory DIR [--limit 25 --captures-offset N --versions-offset N]
  import --directory DIR --resource FILE.json --range "'Tab'!A1:H500" --title TITLE --request UUID
  capture --directory DIR --connections FILE.json --connection ALIAS --spreadsheet ID_OR_URL
          --sheet-id NUMBER --sheet-title TITLE --range A1:H500 --title TITLE --request UUID
  headers --directory DIR --capture UUID [--range A1:H500]
  draft --directory DIR --input REVIEWED_DRAFT.json --revision N --request UUID
  preview --directory DIR --revision N --request UUID
  save --directory DIR --revision N --preview UUID --reviewer NAME --note TEXT --selected N_OR_none --request UUID
  select --directory DIR --version N --selected N_OR_none --request UUID
  compare --directory DIR --left N --right N
  export --directory DIR --version N --out NEW_PRIVATE_PACKET.json
  import-package --directory DIR --input PACKET.json --title TITLE --revision N --request UUID
  operation|resume --directory DIR --request UUID
  deployment-status --directory DIR [--limit 25 --runs-offset N --operations-offset N]
  deployment-review --directory DIR --input REVIEW.json --request UUID
  deployment-prepare --directory DIR --review UUID --sha256 REVIEW_SHA --request UUID
  deployment-package --directory DIR --package UUID
  deployment-stage --directory DIR --package UUID --sha256 PACKAGE_SOURCE_SHA --input RELEASE.json --request UUID
  deployment-export --directory DIR --package UUID --file FILENAME --out NEW_PRIVATE_FILE
  deployment-console --directory DIR --request UUID

REVIEW.json contains {versionId,runId,terms:{origin,path,payment}}. RELEASE.json
contains {id,label,runtime:{port,facilitator?,allowLocalFacilitator?}}. Reviewed
public data and merchant terms use the original SF82 dataset release lifecycle.
Deployment-console keeps that original console and its owned merchant alive until
SIGINT/SIGTERM. Its complete private URL exposes native compare, select, run,
restart, drain, rollback and receiving. DEPLOYMENT.md describes the same-store
binding, required public terms and recovery. Reopening never starts a merchant.

The browser creates the draft; no hand-written projection is required. Original
CellData stays private. Preview calls the original typed Sheets projector. Save
retains a reviewed source version; publication remains in the original publisher.
Use one UUID for an action and its recovery. Reopen never makes a Google request.
Stop this browser before opening its workspace with a second CLI. WORKSPACE.md
documents connections, complete source/customer handoff and exact recovery.`;
const COMMON = ['--directory', '--connections', '--state', '--seller', '--resource'];
const OPTIONS = {
  serve: [...COMMON, '--create', '--port'], init: ['--directory', '--state'],
  status: ['--directory', '--connections', '--limit', '--captures-offset', '--versions-offset'],
  import: ['--directory', '--resource', '--range', '--title', '--request'],
  capture: ['--directory', '--connections', '--connection', '--spreadsheet', '--sheet-id', '--sheet-title', '--range', '--title', '--request'],
  headers: ['--directory', '--capture', '--range'],
  draft: ['--directory', '--connections', '--input', '--revision', '--request'],
  preview: ['--directory', '--connections', '--revision', '--request'],
  save: ['--directory', '--connections', '--revision', '--preview', '--reviewer', '--note', '--selected', '--request'],
  select: ['--directory', '--version', '--selected', '--request'],
  compare: ['--directory', '--left', '--right'], export: ['--directory', '--version', '--out'],
  'import-package': ['--directory', '--input', '--title', '--revision', '--request'],
  'deployment-status': ['--directory', '--connections', '--limit', '--runs-offset', '--operations-offset'],
  'deployment-review': ['--directory', '--connections', '--input', '--request'],
  'deployment-prepare': ['--directory', '--connections', '--review', '--sha256', '--request'],
  'deployment-package': ['--directory', '--package'],
  'deployment-stage': ['--directory', '--package', '--sha256', '--input', '--request'],
  'deployment-export': ['--directory', '--package', '--file', '--out'],
  'deployment-console': ['--directory', '--connections', '--request'],
  operation: ['--directory', '--request'], resume: ['--directory', '--connections', '--request'],
};
const required = (options, key) => { if (!options[key]) throw fault('OPTION_REQUIRED', key); return options[key]; };
const number = value => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
  throw fault('INTEGER_OPTION_REQUIRED'); return Number(value); };
const selected = value => value === 'none' ? null : number(value);
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP + '\n'); return; }
  const [command, ...args] = argv, options = {};
  if (!OPTIONS[command]) throw fault('COMMAND_REQUIRED', HELP);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!OPTIONS[command].includes(key) || Object.hasOwn(options, key)) throw fault('INVALID_OPTION', key);
    if (key === '--create') { options[key] = true; continue; }
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw fault('OPTION_VALUE_REQUIRED', key);
    options[key] = args[++index];
  }
  const workspace = await openSheetsAuthoring({ directory: resolve(required(options, '--directory')),
    create: command === 'init' || options['--create'] === true,
    connections: options['--connections'] ? await readJson(resolve(options['--connections'])) : {},
    targetDirectory: options['--state'] ? resolve(options['--state']) : undefined,
    seller: ['serve'].includes(command) ? options['--seller'] ?? null : null,
    resource: ['serve'].includes(command) ? options['--resource'] ?? null : null });
  if (command === 'serve') {
    try {
      const service = await serveSheetsAuthoring({ workspace, port: options['--port'] ? number(options['--port']) : 8453 });
      print({ url: service.url, directory: workspace.directory, sourceFile: workspace.settings.sourceFile,
        publisherDirectory: workspace.settings.publisherDirectory, targetDirectory: workspace.settings.targetDirectory });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().catch(() => { process.exitCode = 1; }));
      return service;
    } catch (issue) { await workspace.close(); throw issue; }
  }
  if (command === 'deployment-console') {
    try {
      const receipt = await workspace.openDeploymentConsole({ requestId: required(options, '--request') });
      const current = (await workspace.status()).deployment;
      print({ receipt, current });
      if (!current.running) { await workspace.close(); return { receipt, current }; }
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => workspace.close().catch(() => { process.exitCode = 1; }));
      return { workspace, ...current, close: () => workspace.close() };
    } catch (issue) { await workspace.close(); throw issue; }
  }
  try {
    let result;
    const request = () => required(options, '--request');
    if (command === 'init' || command === 'status') result = await workspace.status({
      ...(options['--limit'] ? { limit: number(options['--limit']) } : {}),
      ...(options['--captures-offset'] ? { capturesOffset: number(options['--captures-offset']) } : {}),
      ...(options['--versions-offset'] ? { versionsOffset: number(options['--versions-offset']) } : {}),
    });
    if (command === 'import') result = await workspace.importObservation({
      resourceBytes: await readPrivate(resolve(required(options, '--resource')), MAX_CAPTURE_BYTES),
      range: required(options, '--range'), title: required(options, '--title'), requestId: request() });
    if (command === 'capture') result = await workspace.readLive({ connectionAlias: required(options, '--connection'),
      spreadsheet: required(options, '--spreadsheet'), sheetId: number(required(options, '--sheet-id')),
      sheetTitle: required(options, '--sheet-title'), range: required(options, '--range'), title: required(options, '--title'), requestId: request() });
    if (command === 'headers') result = await workspace.inspectCapture(required(options, '--capture'), options['--range']);
    if (command === 'draft') result = await workspace.saveDraft({ draft: await readJson(resolve(required(options, '--input'))),
      expectedRevision: number(required(options, '--revision')), requestId: request() });
    if (command === 'preview') result = await workspace.preview({ draftRevision: number(required(options, '--revision')), requestId: request() });
    if (command === 'save') result = await workspace.saveVersion({ draftRevision: number(required(options, '--revision')),
      previewId: required(options, '--preview'), reviewer: required(options, '--reviewer'), note: required(options, '--note'),
      expectedSelectedVersion: selected(required(options, '--selected')), requestId: request() });
    if (command === 'select') result = await workspace.selectVersion({ versionId: number(required(options, '--version')),
      expectedSelectedVersion: selected(required(options, '--selected')), requestId: request() });
    if (command === 'compare') result = await workspace.compareVersions(number(required(options, '--left')), number(required(options, '--right')));
    if (command === 'export') { const file = await workspace.exportVersion(number(required(options, '--version')));
      const output = resolve(required(options, '--out')); await createFile(output, file.bytes); result = { file: output, bytes: file.bytes.length }; }
    if (command === 'import-package') result = await workspace.importPacket({ packet: await readJson(resolve(required(options, '--input')), MAX_CAPTURE_BYTES * 2),
      title: required(options, '--title'), expectedDraftRevision: number(required(options, '--revision')), requestId: request() });
    if (command === 'deployment-status') result = await workspace.deploymentStatus({
      ...(options['--limit'] ? { limit: number(options['--limit']) } : {}),
      ...(options['--runs-offset'] ? { runsOffset: number(options['--runs-offset']) } : {}),
      ...(options['--operations-offset'] ? { operationsOffset: number(options['--operations-offset']) } : {}),
    });
    if (command === 'deployment-review') result = await workspace.reviewDeployment({
      ...await readJson(resolve(required(options, '--input'))), requestId: request() });
    if (command === 'deployment-prepare') result = await workspace.prepareDeployment({
      reviewRequestId: required(options, '--review'), expectedReviewSha256: required(options, '--sha256'), requestId: request() });
    if (command === 'deployment-package') result = await workspace.inspectDeploymentPackage(required(options, '--package'));
    if (command === 'deployment-stage') result = await workspace.stageDeployment({
      ...await readJson(resolve(required(options, '--input'))), packageRequestId: required(options, '--package'),
      expectedSourceSha256: required(options, '--sha256'), requestId: request() });
    if (command === 'deployment-export') {
      const file = await workspace.deploymentFile(required(options, '--package'), required(options, '--file'));
      const output = resolve(required(options, '--out')); await createFile(output, file.bytes);
      result = { file: output, bytes: file.bytes.length, sha256: file.sha256 };
    }
    if (command === 'operation') result = workspace.operation(request());
    if (command === 'resume') result = await workspace.resume(request());
    print(result); return result;
  } finally { await workspace.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write(`${issue.code ?? 'SHEETS_AUTHORING'}: ${issue.code ? issue.message : 'Inspect the selected source and retained operation.'}\n`); process.exitCode = 1; });
