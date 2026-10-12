#!/usr/bin/env node
// MIT. CLI over the same retained water project and original merchant/buyer.
import { constants } from 'node:fs';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openWaterProject } from './project.mjs';
import { startWaterWorkspace } from './workspace.mjs';
import { prepareWaterPurchase, purchaseWaterEdition, reopenWaterPurchase, waterMerchantStatus } from './merchant.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';

const HELP = [
  'Stellar Forge / USGS water operations', '',
  'node usgs-water/cli.mjs COMMAND --project /private/water-project [options]', '',
  'serve          Open the private operator workspace (--port 0, --buyer-config buyer.json).',
  'init           Save title and native selection (--title NAME --selection selection.json).',
  'config         Read the saved project or save --selection FILE --expected-revision N.',
  'capture        Acquire/resume --id ID against --expected-revision N.',
  'captures       List retained acquisition status and original revisions.',
  'analyze        Inspect --capture ID with --options analysis-options.json.',
  'review         Save --capture ID --id REVIEW [--options FILE --note-file FILE --compare ID].',
  'reviews        List saved reviews, or read --id REVIEW.',
  'export         Export --review ID --format html|json|csv|geojson --out FILE.',
  'edition        Prepare --review ID --id EDITION.',
  'editions       List editions, or read --id EDITION.',
  'dss-runtime    Check official HEC-DSS7 Python binding (USGS_HECDSS_PYTHON).',
  'dss-source     Inspect original --edition ID series for a DSS mapping.',
  'dss-preview    Review --edition ID --mapping FILE [--previous EXPORT].',
  'dss-export     Create/reopen --edition ID --mapping FILE --id EXPORT --plan-sha SHA.',
  'dss-exports    List native handovers, or reopen --id EXPORT.',
  'dss-verify     Reopen native --id EXPORT and compare every original mapped value.',
  'dss-handover   Save complete --id EXPORT --out HANDOVER.zip.',
  'dss-receive    Receive --file HANDOVER.zip into this private project.',
  'stage          Prepare --edition ID --origin HTTPS_ORIGIN --payment terms.json [--path /water].',
  'merchant       Run --edition ID [--port 0 --facilitator HTTPS_URL].',
  'status         Read original merchant --edition ID status.',
  'buy-prepare    Prepare --edition ID --intent ID [--kind observations|source|edition].',
  'buy            Execute that original plan with --buyer-config buyer.json.',
  'buy-reopen     Reopen --edition ID --intent ID with the same --buyer-config.',
  '',
  'Dataset purchases use --query query.json; every query value is a string.',
  'Continue with --previous page.json and the same query plus the returned cursor.',
  'page.json may contain the original metadata or a saved buy/buy-reopen result.',
  'Each next page requires a new --intent. Reopen an existing intent with buy-reopen.',
  'Source purchases use --kind source --file retained/member; edition uses --kind edition.',
  'Pass the same --kind, --query, --file, --previous and --accept options to buy as to buy-prepare.',
  '',
  'Use --out FILE for JSON output. Existing output files are preserved.',
  'A capture ID belongs to its original selection; resuming it uses that saved revision.',
  'Daily observation dates are local calendar dates. Values and quality fields stay exact.',
  '',
].join('\n');
function args(argv) {
  const command = argv[0] ?? 'help', options = {};
  for (let i = 1; i < argv.length; i++) {
    const name = argv[i];
    if (!/^--[a-z][a-z0-9-]*$/.test(name)) throw new Error('Expected a named option, received ' + name);
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('Provide a value for ' + name);
    if (Object.hasOwn(options, name.slice(2))) throw new Error('Repeated option ' + name);
    options[name.slice(2)] = argv[++i];
  }
  return { command, options };
}
function required(options, name) {
  if (!options[name]) throw new Error('Provide --' + name);
  return options[name];
}
function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Use a nonnegative integer.');
  return Number(value);
}
async function jsonFile(path) { return JSON.parse(await readFile(resolve(path), 'utf8')); }
async function previousPage(path) {
  if (path === undefined) return null;
  const saved = await jsonFile(path);
  return saved?.metadata ?? saved?.result?.metadata ?? saved;
}
async function output(value, path) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  if (path) { await writeFile(resolve(path), bytes, { mode: 0o600, flag: 'wx' }); process.stdout.write(JSON.stringify({ output: resolve(path), bytes: bytes.length }) + '\n'); }
  else process.stdout.write(bytes);
}
function publicPurchase(value) {
  const { result, ...metadata } = value;
  return { ...metadata, ...(result ? { nativeResult: { status: result.status, ok: result.ok, delivery: result.delivery } } : {}) };
}
async function openBuyer(options) {
  const file = required(options, 'buyer-config'), config = await jsonFile(file);
  return new Buyer(config).ready();
}
async function retainProcess(resource, ready) {
  await output(ready);
  await new Promise((done, reject) => {
    let stopping = false;
    const close = () => { if (stopping) return; stopping = true; resource.close().then(done, reject); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  });
}
export async function main(argv = process.argv.slice(2)) {
  const { command, options } = args(argv);
  if (['help', '--help', '-h'].includes(command)) return output(HELP);
  const directory = resolve(required(options, 'project'));
  if (command === 'serve') {
    const buyer = options['buyer-config'] ? await openBuyer(options) : null;
    const workspace = await startWaterWorkspace({ directory, port: integer(options.port, 0), merchantPort: integer(options['merchant-port'], 0),
      facilitator: options.facilitator, buyer });
    return retainProcess(workspace, { url: workspace.url, project: directory });
  }
  const project = await openWaterProject(directory);
  try {
    if (command === 'init' || command === 'config') {
      if (command === 'config' && !options.selection) return output(await project.read(), options.out);
      return output(await project.save({ title: options.title ?? (await project.read())?.title ?? 'Water monitoring review',
        selection: await jsonFile(required(options, 'selection')), expectedRevision: integer(options['expected-revision'], 0) }), options.out);
    }
    if (command === 'capture') {
      const saved = await project.read(), id = options.id ?? randomUUID();
      const previous = (await project.listCaptures()).find(row => row.operationId === id);
      return output(await project.acquire({ operationId: id,
        expectedRevision: integer(options['expected-revision'], previous?.revision ?? saved?.revision) }), options.out);
    }
    if (command === 'captures') return output(await project.listCaptures(), options.out);
    if (command === 'analyze' || command === 'review') {
      const captureId = required(options, 'capture'), analysisOptions = options.options ? await jsonFile(options.options) : {};
      if (command === 'analyze') return output(await project.analyze({ captureId, options: analysisOptions, comparisonCaptureId: options.compare }), options.out);
      const note = options['note-file'] ? await readFile(resolve(options['note-file']), 'utf8') : options.note ?? '';
      return output(await project.saveReview({ reviewId: options.id ?? randomUUID(), captureId, options: analysisOptions,
        comparisonCaptureId: options.compare, note, expectedCaptureSha256: options['capture-sha256'] }), options.out);
    }
    if (command === 'reviews') return output(options.id ? await project.readReview(options.id) : await project.listReviews(), options.out);
    if (command === 'export') {
      const result = await project.exportReview({ reviewId: required(options, 'review'), format: options.format ?? 'html' });
      return output(result.bytes, required(options, 'out'));
    }
    if (command === 'edition') return output(await project.prepareEdition({ editionId: required(options, 'id'), reviewId: required(options, 'review') }), options.out);
    if (command === 'editions') return output(options.id ? await project.readEdition(options.id) : await project.listEditions(), options.out);
    if (command === 'dss-runtime') return output(await project.probeDssRuntime(), options.out);
    if (command === 'dss-source') return output(await project.inspectDssEdition(required(options, 'edition')), options.out);
    if (command === 'dss-preview' || command === 'dss-export') {
      const input = { editionId: required(options, 'edition'), mapping: await jsonFile(required(options, 'mapping')),
        previousExportId: options.previous };
      return output(command === 'dss-preview' ? await project.previewDssExport(input) : await project.createDssExport({
        ...input, exportId: required(options, 'id'), expectedPlanSha256: required(options, 'plan-sha') }), options.out);
    }
    if (command === 'dss-exports') return output(options.id ? await project.readDssOperation(options.id) : await project.listDssExports(), options.out);
    if (command === 'dss-verify') return output(await project.verifyDssExport(required(options, 'id')), options.out);
    if (command === 'dss-handover') {
      const result = await project.exportDssHandover(required(options, 'id')), destination = resolve(required(options, 'out'));
      await copyFile(result.path, destination, constants.COPYFILE_EXCL);
      return output({ ...result, path: destination });
    }
    if (command === 'dss-receive') return output(await project.receiveDssHandover(resolve(required(options, 'file'))), options.out);
    if (command === 'stage') return output(await project.stageEdition({ editionId: required(options, 'edition'), origin: required(options, 'origin'),
      path: options.path ?? '/water', payment: await jsonFile(required(options, 'payment')) }), options.out);
    if (command === 'merchant') {
      const merchant = await project.startEdition({ editionId: required(options, 'edition'), port: integer(options.port, 0), facilitator: options.facilitator });
      return retainProcess(merchant, { merchantUrl: merchant.merchantUrl ?? merchant.url, editionId: merchant.editionId, paths: merchant.paths });
    }
    if (command === 'status') return output(await waterMerchantStatus(join(directory, 'editions', required(options, 'edition'))), options.out);
    if (['buy-prepare', 'buy', 'buy-reopen'].includes(command)) {
      const edition = await project.readEdition(required(options, 'edition')), intentId = required(options, 'intent');
      if (command === 'buy-reopen') return output(publicPurchase(await reopenWaterPurchase({ buyer: await openBuyer(options),
        intentId, editionDirectory: edition.directory })), options.out);
      const prepared = await prepareWaterPurchase({ editionDirectory: edition.directory, intentId,
        query: options.query ? await jsonFile(options.query) : {}, file: options.file, kind: options.kind,
        previous: await previousPage(options.previous), acceptIndex: integer(options.accept, 0) });
      if (command === 'buy-prepare') return output(prepared, options.out);
      return output(publicPurchase(await purchaseWaterEdition({ buyer: await openBuyer(options), prepared })), options.out);
    }
    throw new Error('Unknown command ' + command + '. Run help for available operations.');
  } finally { await project.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'WATER_COMMAND_FAILED', message: error.message, retryAt: error.retryAt ?? null }) + '\n'); process.exitCode = 1; });
}
