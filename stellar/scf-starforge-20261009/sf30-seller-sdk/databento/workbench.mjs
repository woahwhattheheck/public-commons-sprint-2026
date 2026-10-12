#!/usr/bin/env node
// TJLabs. Historical migration delivery on the original retained Python workspace.
import {createHash, randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {readFile, open, mkdir, lstat, readdir, link, unlink, realpath, rename, rm} from 'node:fs/promises';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NATIVE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace';
const MiB = 1024 * 1024, SOURCE_LIMIT = 32 * MiB, FILE_LIMIT = 8 * MiB;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const HELP = [
  'Databento migration workspace on the original Python workspace (Node 22.13+)',
  '',
  'create [--source-root ROOT] --dir NEW_DIR --dataset WORKSPACE.json [--plan PLAN.json]',
  'import [--source-root ROOT] --dir NEW_DIR --bundle ORIGINAL_WORKSPACE.json',
  'reopen [--source-root ROOT] --dir NEW_DIR --bundle ORIGINAL_WORKSPACE.json',
  'status [--source-root ROOT] --dir DIR',
  'inspect [--source-root ROOT] --dir DIR [--revision REVISION]',
  'serve [--source-root ROOT] --dir DIR [--port 8431] [--operator-assets WEB_DIR_OR_MANIFEST]',
  'workspace [--source-root ROOT] --dir DIR -- ORIGINAL_COMMAND [OPTIONS]',
  'export [--source-root ROOT] --dir DIR --out NEW_BUNDLE.json',
  'handoff [--source-root ROOT] --dir DIR --preview BUILD_PREVIEW_ID --out NEW_DIR [--audience operator|customer] [--python EXECUTABLE]',
  '',
  'Source root defaults to the original repository or installed package/source root.',
  'Create copies the original prepared dataset and every referenced capture into',
  'one native Python workspace. Inspect reads saved source metadata; calculation',
  'uses the original preview command with inspect_migration or build_migration.',
  'Serve opens the dataset interface through the original authenticated server.',
  'Without --plan, the declaration is explicitly unconfigured for deployment.',
  'Private previews do not use a signer, payment, provider account or network call.',
].join('\n') + '\n';

async function present(path) {
  try {await lstat(path); return true;}
  catch (error) {if (error.code === 'ENOENT') return false; throw error;}
}
async function regular(path, limit = FILE_LIMIT) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new Error('Expected a regular file within the native limit: ' + path);
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('File exceeded the native limit while reading: ' + path);
  return bytes;
}
async function exactFile(path, bytes) {
  if (await present(path)) {
    if (!(await regular(path, bytes.length + 1)).equals(bytes)) throw new Error('Existing retained file differs: ' + path);
    return;
  }
  const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  const fd = await open(temporary, 'wx', 0o600);
  try {
    try {await fd.writeFile(bytes); await fd.sync();} finally {await fd.close();}
    try {await link(temporary, path);}
    catch (error) {
      if (error.code !== 'EEXIST' || !(await regular(path, bytes.length + 1)).equals(bytes)) throw error;
    }
    const directory = await open(dirname(path), 'r');
    try {await directory.sync();} finally {await directory.close();}
  } finally {await unlink(temporary);}
}
async function ownedDirectory(root, marker) {
  try {await mkdir(root, {mode: 0o700});}
  catch (error) {if (error.code !== 'EEXIST') throw error;}
  if (!(await lstat(root)).isDirectory()) throw new Error('Use a real private directory.');
  const path = join(root, 'operation.json');
  if (!(await present(path)) && (await readdir(root)).length) throw new Error('The selected directory already contains other work.');
  await exactFile(path, jsonBytes(marker));
}
function parse(argv) {
  const split = argv.indexOf('--'), own = split < 0 ? argv : argv.slice(0, split);
  const forward = split < 0 ? [] : argv.slice(split + 1), command = own[0] ?? 'help', flags = {};
  for (let i = 1; i < own.length; i++) {
    if (!own[i].startsWith('--') || !own[i + 1] || own[i + 1].startsWith('--') || Object.hasOwn(flags, own[i].slice(2))) throw new Error(HELP);
    flags[own[i].slice(2)] = own[++i];
  }
  const shared = ['source-root', 'dir'];
  const allowed = {
    create: [...shared, 'dataset', 'plan'], import: [...shared, 'bundle'], reopen: [...shared, 'bundle'],
    status: shared, inspect: [...shared, 'revision'], serve: [...shared, 'port', 'operator-assets'],
    workspace: shared, export: [...shared, 'out'], handoff: [...shared, 'preview', 'out', 'audience', 'python'],
  }[command];
  if (!allowed || Object.keys(flags).some(key => !allowed.includes(key)) || (forward.length && command !== 'workspace')) throw new Error(HELP);
  return {command, flags, forward};
}
function required(flags, key) {
  if (!flags[key]) throw new Error('--' + key + ' is required.');
  return flags[key];
}
function object(value) {return value !== null && typeof value === 'object' && !Array.isArray(value);}
function localPreviewPlan(label) {
  return {label, serviceName: 'Databento migration', publicOrigin: 'https://databento-workspace.example',
    payment: {scheme: 'exact', network: 'stellar:testnet', asset: 'UNVERIFIED_DEMO_ASSET',
      payTo: 'UNVERIFIED_DEMO_RECIPIENT', maxTimeoutSeconds: 60, amount: '10000'}};
}
function declaration(plan) {
  if (!object(plan) || Object.keys(plan).some(key => !['label', 'serviceName', 'publicOrigin', 'payment'].includes(key))
      || typeof plan.label !== 'string' || !plan.label.trim() || !plan.publicOrigin || !object(plan.payment))
    throw new Error('Plan requires label, publicOrigin and the original payment tuple.');
  const serviceName = plan.serviceName ?? plan.label;
  if (typeof serviceName !== 'string' || !serviceName.trim() || !/^[\x20-\x7e]{1,32}$/.test(serviceName))
    throw new Error('The original public service name requires 1–32 printable ASCII characters. Supply plan.serviceName as a short name; plan.label keeps the complete workspace title.');
  const inputSchema = {type: 'object', properties: {
    editionId: {type: 'string', minLength: 1, maxLength: 160},
  }, additionalProperties: false};
  const inspectSchema = {type: 'object', properties: {...inputSchema.properties,
    view: {type: 'string', enum: ['records', 'findings', 'instruments', 'sessions', 'changes', 'sources']},
    offset: {type: 'integer', minimum: 0}, limit: {type: 'integer', minimum: 1, maximum: 250},
  }, additionalProperties: false};
  const fn = (path, description, schema = inputSchema) => ({path, method: 'POST', description, payment: plan.payment,
    inputSchema: schema, example: {}, timeoutMs: 120000, maxInputBytes: 65536,
    maxOutputBytes: MiB, output: {format: 'json'}});
  return {schema: 'stellar-forge.python-merchant.v1', application: 'application.py',
    publicOrigin: plan.publicOrigin, serviceName, tags: ['databento', 'historical-data', 'python'],
    workerCount: 1, maxPending: 2, startupTimeoutMs: 10000, shutdownTimeoutMs: 10000,
    functions: {
      inspect_migration: fn('/databento-migration/inspect', 'Assess every selected source record and inspect a paged view of original records, sources, identities, sessions or findings.', inspectSchema),
      build_migration: fn('/databento-migration/build', 'Build complete migration aggregates and retained operator reports; full mapped rows stream through the same core export command.'),
      customer_migration: fn('/databento-migration/customer', 'Build customer migration reports and exact safe source lineage, without private review notes or raw operator pages.'),
    }};
}
async function capturedSource(base, name, expected) {
  if (typeof name !== 'string' || !/^captures\/[a-f0-9]{64}\.(json|csv|ndjson|jsonl)(\.gz)?$/.test(name)) throw new Error('Capture paths must be content-addressed JSON, CSV or JSONL, optionally original gzip.');
  const path = join(base, name), canonical = await realpath(path), inside = relative(base, canonical);
  if (inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new Error('Capture is outside the prepared dataset directory.');
  const bytes = await regular(path), digest = sha(bytes);
  if (name.split('/').at(-1).split('.')[0] !== digest) throw new Error('Capture filename does not match its original bytes: ' + name);
  if (expected && (expected.sha256 !== digest || expected.bytes !== bytes.length)) throw new Error('Capture manifest does not match its original bytes: ' + name);
  return bytes;
}
async function preparedFiles(datasetPath, planPath) {
  const canonical = await realpath(resolve(datasetPath)), base = dirname(canonical);
  const datasetBytes = await regular(canonical), dataset = JSON.parse(datasetBytes);
  if (!object(dataset) || dataset.schema !== 'tj.databento-migration-workspace.v1'
      || !Array.isArray(dataset.editions) || !dataset.editions.length
      || !dataset.editions.some(edition => edition.id === dataset.selectedEdition))
    throw new Error('Use the complete prepared Databento dataset with a selected edition.');
  const planBytes = planPath ? await regular(resolve(planPath), 65536)
    : jsonBytes(localPreviewPlan(typeof dataset.title === 'string' && dataset.title.trim() ? dataset.title : 'Databento migration workspace'));
  const plan = JSON.parse(planBytes), config = declaration(plan);
  const files = new Map([
    ['application.py', await regular(join(HERE, 'application.py'), 2 * MiB)],
    ['processor.py', await regular(join(HERE, 'processor.py'))],
    ['workspace.json', datasetBytes], ['merchant.json', jsonBytes(config)],
  ]);
  const formats = new Set(['csv', 'dbn-jsonl', 'json']);
  for (const edition of dataset.editions) {
    if (!object(edition) || !Array.isArray(edition.sources)) throw new Error('Each prepared edition needs its complete original source list.');
    for (const source of edition.sources) {
      if (!object(source) || !formats.has(source.format) || ![undefined, 'gzip'].includes(source.compression))
        throw new Error('Use the original core source formats csv/dbn-jsonl/json and optional gzip compression.');
      // The original corpus indexes are part of the source closure too. Their
      // bytes are never inferred from the selected partition or omitted silently.
      for (const selected of [source, source.corpus?.index].filter(Boolean)) {
        const bytes = await capturedSource(base, selected.path, selected);
        const previous = files.get(selected.path);
        if (previous && !previous.equals(bytes)) throw new Error('One source path has inconsistent original bytes.');
        files.set(selected.path, bytes);
      }
    }
  }
  const total = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if (files.size > 512 || total > SOURCE_LIMIT) throw new Error('Prepared source exceeds the original 512-file / 32 MiB workspace limit; select a complete agreed source partition.');
  return {files, label: plan.label, planBytes, datasetBytes, previewOnly: !planPath, total,
    editions: dataset.editions.length};
}
function summary(state) {
  return {workspace: state.workspace.id, head: state.workspace.head,
    revisions: state.revisions.length, previews: state.previews.length,
    releases: state.staged.length, customers: state.customerExports.length,
    generation: state.release.state.generation, active: state.release.state.active,
    runtime: state.release.runtime.state};
}
function port(value) {
  if (value === undefined) return 8431;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 65535) throw new Error('Port must be 0–65535.');
  return Number(value);
}
async function operatorOptions(value) {
  if (!value) {
    if (!(await present(join(HERE, 'web')))) return {};
    const operatorPath = '/databento-migration/';
    const routes = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
    // The original native server owns the shared draft store route. The same
    // canonical manifest retains that dependency for the maintained browser graph.
    const operatorAssets = [...routes].filter(([path]) => path.startsWith(operatorPath))
      .map(([path, {url, type}]) => ({path, file: url, type}));
    return {operatorPath, operatorAssets};
  }
  const selected = await realpath(resolve(value)), info = await lstat(selected);
  if (info.isDirectory()) {
    const operatorPath = '/databento-migration/';
    const operatorAssets = [
      {path: operatorPath, file: join(selected, 'index.html'), type: 'text/html; charset=utf-8'},
      {path: operatorPath + 'browser.mjs', file: join(selected, 'browser.mjs'), type: 'text/javascript; charset=utf-8'},
      {path: operatorPath + 'style.css', file: join(selected, 'style.css'), type: 'text/css; charset=utf-8'},
    ];
    return {operatorPath, operatorAssets};
  }
  const manifest = JSON.parse(await regular(selected, 65536)), base = dirname(selected);
  if (!object(manifest) || typeof manifest.operatorPath !== 'string' || !Array.isArray(manifest.assets))
    throw new Error('Operator assets manifest requires operatorPath and assets[{path,file,type}].');
  const operatorAssets = [];
  for (const asset of manifest.assets) {
    if (!object(asset) || typeof asset.file !== 'string' || isAbsolute(asset.file)
        || typeof asset.path !== 'string' || typeof asset.type !== 'string')
      throw new Error('Operator assets use explicit routes and local relative file paths.');
    const file = await realpath(resolve(base, asset.file)), inside = relative(base, file);
    if (inside === '..' || inside.startsWith('../') || isAbsolute(inside))
      throw new Error('An operator asset points outside its declared bundle.');
    operatorAssets.push({path: asset.path, file, type: asset.type});
  }
  return {operatorPath: manifest.operatorPath, operatorAssets};
}
async function serve(model, sourceRoot, flags) {
  const options = await operatorOptions(flags['operator-assets']);
  const {startPythonWorkspace} = await import(pathToFileURL(join(sourceRoot, NATIVE, 'server.mjs')).href);
  const server = await startPythonWorkspace(model, {port: port(flags.port), ...options});
  try {
    if (options.operatorPath && (!server.nativeOperatorUrl || new URL(server.operatorUrl).pathname !== options.operatorPath))
      throw new Error('Use the original Python workspace server version that supports operatorAssets and operatorPath.');
    const onSignal = () => {void server.close().catch(error => {process.stderr.write(error.message + '\n'); process.exitCode = 1;});};
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    process.stdout.write(JSON.stringify({schema: 'tj.databento-workspace-console.v1',
      operatorUrl: server.operatorUrl, nativeOperatorUrl: server.nativeOperatorUrl ?? server.operatorUrl}, null, 2) + '\n');
    try {await server.closed;}
    finally {process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);}
  } finally {await server.close();}
}
async function fileIdentity(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The retained export must be a regular file: ' + path);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) {hash.update(chunk); bytes += chunk.length;}
  return {bytes, sha256: hash.digest('hex')};
}
function deliveryPath(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || isAbsolute(name)
      || name.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('A complete delivery file has an unsafe relative path.');
  return join(root, name);
}
async function verifyDelivery(root, manifest) {
  if (!object(manifest) || manifest.schema !== 'tj.databento-migration-delivery.v1'
      || manifest.allSelectedRecordsProcessed !== true || !Array.isArray(manifest.files))
    throw new Error('The original complete streaming export has no completed manifest.');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!object(file) || seen.has(file.path)) throw new Error('The original export repeats a file.');
    seen.add(file.path);
    const actual = await fileIdentity(deliveryPath(root, file.path));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error('Original complete export bytes differ: ' + file.path);
    if (manifest.audience === 'customer' && !file.path.startsWith('customer/')) throw new Error('Customer output contains an operator file.');
  }
  for (const name of ['mapped-records.csv', 'mapped-records.ndjson', 'migration-summary.json',
      'migration-summary.html', 'source-index.json', 'output-columns.json', 'DELIVERY.md'])
    if (!seen.has('customer/' + name)) throw new Error('A complete customer delivery file is missing: ' + name);
}
async function runExport(python, source, destination, edition, audience) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(python, [join(source, 'processor.py'), 'export', '--workspace',
      join(source, 'workspace.json'), '--out', destination, '--edition-id', edition, '--audience', audience],
      {cwd: source, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}, stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stdout.on('data', () => {}); // The retained original manifest is authoritative.
    child.stderr.on('data', chunk => {stderr = (stderr + chunk.toString()).slice(-16000);});
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => code === 0 ? resolveRun()
      : rejectRun(new Error('Original full data export exited ' + (signal ?? code) + ': ' + stderr)));
  });
}
async function handoff(model, id, output, flags, bundleLimit) {
  const audience = flags.audience ?? 'operator';
  if (!['customer', 'operator'].includes(audience)) throw new Error('--audience must be customer or operator.');
  const retained = await model.previewOutput(id), detail = await model.previewDetail(id);
  const report = JSON.parse(retained.bytes), revision = model.revision(detail.revisionId);
  if (detail.status !== 'COMPLETED' || detail.function !== 'build_migration'
      || report.schema !== 'tj.databento-migration-build.v1' || !Array.isArray(report.files))
    throw new Error('Select the completed original build_migration preview.');
  const expected = new Set(['migration-summary.json', 'migration-summary.html', 'source-index.json',
    'output-columns.json', 'DELIVERY.md', 'migration-report.json', 'review-decisions.json']);
  for (const file of report.files) {
    if (!expected.delete(file.name) || typeof file.body !== 'string') throw new Error('Unexpected or repeated native report file.');
    const bytes = Buffer.from(file.body);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error('The original native report file differs: ' + file.name);
  }
  if (expected.size) throw new Error('The selected native report is incomplete.');
  const previewSha256 = sha(retained.bytes);
  if (previewSha256 !== retained.sha256) throw new Error('The retained native preview differs.');
  const edition = report.report?.edition?.id;
  if (typeof edition !== 'string' || !edition) throw new Error('The original build has no selected edition.');
  const selection = {workspace: model.metadata().id, preview: id, revision: detail.revisionId, edition, audience, previewSha256};
  const root = resolve(output), work = root + '.databento-handoff-work';
  if (await present(root)) {
    const saved = JSON.parse(await regular(join(root, 'handoff.json'), 8 * MiB));
    if (saved.schema !== 'tj.databento-workspace-handoff.v1' || Object.entries(selection).some(([key, value]) => saved[key] !== value))
      throw new Error('The existing output belongs to another selection. Choose a new handoff directory.');
    await verifyDelivery(root, JSON.parse(await regular(join(root, 'manifest.json'), 8 * MiB)));
    for (const file of saved.files) {
      const actual = await fileIdentity(deliveryPath(root, file.path));
      if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) throw new Error('The completed retained handoff differs: ' + file.path);
    }
    return {directory: root, customerDirectory: join(root, 'customer'),
      operatorDirectory: audience === 'operator' ? join(root, 'operator') : null, ...saved};
  }
  await ownedDirectory(work, {schema: 'tj.databento-handoff-operation.v1', ...selection});
  const source = join(work, 'source'), delivery = join(work, 'delivery');
  await mkdir(source, {recursive: true, mode: 0o700});
  let workspaceBytes;
  for (const entry of revision.files) {
    const original = await model.file(detail.revisionId, entry.path);
    const bytes = original.encoding === 'utf8' ? Buffer.from(original.text) : Buffer.from(original.base64, 'base64');
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error('Saved source identity differs: ' + entry.path);
    const file = deliveryPath(source, entry.path);
    await mkdir(dirname(file), {recursive: true, mode: 0o700}); await exactFile(file, bytes);
    if (entry.path === 'workspace.json') workspaceBytes = bytes;
  }
  if (!workspaceBytes) throw new Error('The selected saved source lacks workspace.json.');
  const dataset = JSON.parse(workspaceBytes);
  if (!dataset.editions?.some(item => item.id === edition)) throw new Error('The build edition is absent from its saved source.');
  const declaration = JSON.parse(revision.declarationText);
  const python = flags.python ?? declaration.interpreter ?? 'python3';
  if (typeof python !== 'string' || !python.trim() || python.includes('\0')) throw new Error('Select the original Python executable.');
  // An already completed original CLI export is reopened. An interrupted
  // incomplete export can be regenerated from these same immutable sources;
  // it never invokes another native preview, provider request or paid job.
  if (!(await present(delivery))) await runExport(python, source, delivery, edition, audience);
  const originalManifestBytes = await regular(join(delivery, 'manifest.json'), 8 * MiB);
  const originalManifest = JSON.parse(originalManifestBytes);
  if (originalManifest.editionId !== edition || originalManifest.audience !== audience
      || originalManifest.workspaceSha256 !== sha(workspaceBytes))
    throw new Error('The completed data export belongs to another original edition, audience or source revision.');
  await verifyDelivery(delivery, originalManifest);
  const files = originalManifest.files.map(file => ({...file}));
  files.push({path: 'manifest.json', bytes: originalManifestBytes.length, sha256: sha(originalManifestBytes)});
  if (audience === 'operator') {
    const operator = join(delivery, 'operator');
    await mkdir(operator, {recursive: true, mode: 0o700});
    await exactFile(join(operator, 'native-preview.json'), retained.bytes);
    files.push({path: 'operator/native-preview.json', bytes: retained.bytes.length, sha256: previewSha256});
    const bundlePath = join(operator, 'workspace.python-workspace.json');
    let bundle;
    if (await present(bundlePath)) bundle = await regular(bundlePath, bundleLimit);
    else {
      const exported = await model.exportBundle();
      if (sha(exported.bytes) !== exported.sha256) throw new Error('The original portable digest differs.');
      await exactFile(bundlePath, exported.bytes); bundle = exported.bytes;
    }
    const portable = JSON.parse(bundle);
    if (portable.schema !== 'stellar-forge.python-workspace-export.v1'
        || portable.workspace?.metadata?.id !== model.metadata().id
        || !portable.workspace.previews.some(row => row.id === id && row.result?.sha256 === previewSha256))
      throw new Error('The retained portable does not contain the selected original build.');
    files.push({path: 'operator/workspace.python-workspace.json', bytes: bundle.length, sha256: sha(bundle)});
  }
  const manifest = {schema: 'tj.databento-workspace-handoff.v1', ...selection,
    sourceSha256: sha(workspaceBytes), originalExportSha256: sha(originalManifestBytes),
    processedRecords: originalManifest.processedRecords, primaryRecords: originalManifest.primaryRecords,
    customerRecords: originalManifest.customerRecords, excludedRecords: originalManifest.excludedRecords,
    allSelectedRecordsProcessed: originalManifest.allSelectedRecordsProcessed,
    assessmentReady: originalManifest.assessmentReady, sourceCoverage: originalManifest.sourceCoverage,
    files};
  await exactFile(join(delivery, 'handoff.json'), jsonBytes(manifest));
  if (await present(root)) throw new Error('The new handoff destination was created by another operation.');
  await rename(delivery, root);
  const parent = await open(dirname(root), 'r'); try {await parent.sync();} finally {await parent.close();}
  // Only this byte-verified reconstructed source copy is retired; the original
  // saved revision and portable history remain untouched.
  await rm(work, {recursive: true});
  return {directory: root, customerDirectory: join(root, 'customer'),
    operatorDirectory: audience === 'operator' ? join(root, 'operator') : null, ...manifest};
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) {process.stdout.write(HELP); return;}
  const {command, flags, forward} = parse(argv);
  const sourceRoot = await realpath(resolve(flags['source-root'] ?? resolve(HERE, '../../../..')));
  const root = resolve(required(flags, 'dir')), workspace = join(root, 'workspace');
  const native = await import(pathToFileURL(join(sourceRoot, NATIVE, 'model.mjs')).href);
  if (command === 'workspace') {
    if (!forward.length) throw new Error('An original workspace command is required after --.');
    const original = await import(pathToFileURL(join(sourceRoot, NATIVE, 'cli.mjs')).href);
    return original.main([forward[0], '--workspace', workspace, ...forward.slice(1)]);
  }
  let model;
  try {
    let created;
    if (command === 'create') {
      const prepared = await preparedFiles(required(flags, 'dataset'), flags.plan);
      await ownedDirectory(root, {schema: 'tj.databento-workbench.v1', mode: 'create',
        configuration: prepared.previewOnly ? 'LOCAL_PREVIEW_UNCONFIGURED' : 'EXPLICIT_PLAN',
        planSha256: sha(prepared.planBytes), datasetSha256: sha(prepared.datasetBytes),
        files: Object.fromEntries([...prepared.files].map(([name, bytes]) => [name, sha(bytes)]))});
      const application = join(root, 'application');
      await mkdir(application, {recursive: true, mode: 0o700});
      for (const [name, bytes] of prepared.files) {
        await mkdir(dirname(join(application, name)), {recursive: true, mode: 0o700});
        await exactFile(join(application, name), bytes);
      }
      await exactFile(join(root, 'preview-input.json'), jsonBytes({}));
      model = await present(workspace) ? await native.openWorkspace(workspace)
        : await native.createWorkspace(workspace, {config: join(application, 'merchant.json'), pythonRoot: application, label: prepared.label});
      created = {configuration: prepared.previewOnly ? 'LOCAL_PREVIEW_UNCONFIGURED' : 'EXPLICIT_PLAN',
        retainedFiles: prepared.files.size, retainedBytes: prepared.total, maxOutputBytes: MiB, maxTimeoutMs: 120000, editions: prepared.editions};
    } else if (command === 'import' || command === 'reopen') {
      const bytes = await regular(resolve(required(flags, 'bundle')), native.MAX_BUNDLE_BYTES);
      await ownedDirectory(root, {schema: 'tj.databento-workbench.v1', mode: 'import', bundleSha256: sha(bytes)});
      model = await present(workspace) ? await native.openWorkspace(workspace) : await native.importWorkspace(workspace, bytes);
    } else model = await native.openWorkspace(workspace);
    if (command === 'serve') return await serve(model, sourceRoot, flags);
    let result;
    if (command === 'handoff') result = await handoff(model, required(flags, 'preview'), required(flags, 'out'), flags, native.MAX_BUNDLE_BYTES);
    else if (command === 'export') {
      const exported = await model.exportBundle(), output = resolve(required(flags, 'out'));
      if (sha(exported.bytes) !== exported.sha256) throw new Error('Original workspace export digest differs.');
      if (await present(output)) throw new Error('Export target already exists; choose a new original export path.');
      await exactFile(output, exported.bytes);
      result = {path: output, bytes: exported.bytes.length, sha256: exported.sha256};
    } else if (command === 'inspect') result = {workspace: model.metadata().id, revision: model.revision(flags.revision ?? model.metadata().head)};
    else result = {...summary(await model.state()), ...(created ?? {})};
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {if (model) await model.close();}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(JSON.stringify({error: error.code ?? 'DATABENTO_WORKBENCH_ERROR', message: error.message}) + '\n');
  process.exitCode = 1;
});
