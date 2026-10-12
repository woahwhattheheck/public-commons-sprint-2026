#!/usr/bin/env node
// TJLabs. Retained records delivery on the original retained Python workspace.
import {createHash, randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {readFile, open, mkdir, lstat, readdir, link, unlink, realpath, rename, rm} from 'node:fs/promises';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NATIVE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace';
const MiB = 1024 * 1024, SOURCE_LIMIT = 32 * MiB, FILE_LIMIT = 8 * MiB;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const HELP = [
  'Records operator workspace on the original Python workspace (Node 22.13+)',
  '',
  'create [--source-root ROOT] --dir NEW_DIR --dataset WORKSPACE.json [--plan PLAN.json]',
  'import [--source-root ROOT] --dir NEW_DIR --bundle ORIGINAL_WORKSPACE.json',
  'reopen [--source-root ROOT] --dir NEW_DIR --bundle ORIGINAL_WORKSPACE.json',
  'status [--source-root ROOT] --dir DIR',
  'binding [--source-root ROOT] --dir DIR',
  'managed --source-root ROOT --dir DIR --expected-workspace-identity SHA --expected-source-sha256 SHA [--port 0]',
  'inspect [--source-root ROOT] --dir DIR [--revision REVISION]',
  'serve [--source-root ROOT] --dir DIR [--port 8431] [--operator-assets WEB_DIR_OR_MANIFEST]',
  'workspace [--source-root ROOT] --dir DIR -- ORIGINAL_COMMAND [OPTIONS]',
  'export [--source-root ROOT] --dir DIR --out NEW_BUNDLE.json',
  'handoff [--source-root ROOT] --dir DIR --preview BUILD_PREVIEW_ID --out NEW_DIR [--audience operator|customer] [--python EXECUTABLE]',
  '',
  'Source root defaults to the original repository or installed package/source root.',
  'Create copies the original prepared dataset and every referenced capture into',
  'one native Python workspace. Inspect reads saved source metadata; calculation',
  'uses the original preview command with inspect_records or build_records.',
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
    status: shared, binding: shared,
    managed: [...shared, 'port', 'expected-workspace-identity', 'expected-source-sha256'],
    inspect: [...shared, 'revision'], serve: [...shared, 'port', 'operator-assets'],
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
  return {label, serviceName: 'Records operator', publicOrigin: 'https://records-workspace.example',
    payment: {scheme: 'exact', network: 'stellar:testnet', asset: 'UNVERIFIED_DEMO_ASSET',
      payTo: 'UNVERIFIED_DEMO_RECIPIENT', maxTimeoutSeconds: 60, amount: '10000'}};
}
function declaration(plan) {
  if (!object(plan) || Object.keys(plan).some(key => !['label', 'serviceName', 'publicOrigin', 'payment'].includes(key))
      || typeof plan.label !== 'string' || !plan.label.trim() || !plan.publicOrigin || !object(plan.payment))
    throw new Error('Plan requires label, publicOrigin and the original payment tuple.');
  const serviceName = plan.serviceName ?? plan.label;
  if (typeof serviceName !== 'string' || !/^[\x20-\x7e]{1,32}$/.test(serviceName))
    throw new Error('Supply a 1–32 character ASCII serviceName; label retains the complete operator title.');
  const selection = {periodId: {type: 'string', minLength: 1, maxLength: 160}, editionId: {type: 'string', minLength: 1, maxLength: 160}};
  const inputSchema = {type: 'object', properties: selection, additionalProperties: false};
  const inspectSchema = {type: 'object', properties: {...selection,
    view: {type: 'string', enum: ['sources','sites','rates','cartons','events','invoices','findings','transition','changes',
      'requirements','catalog','reviews','checks','cooperative','cooperative-basis','input-errors','customer-invoices']},
    offset: {type: 'integer', minimum: 0}, limit: {type: 'integer', minimum: 1, maximum: 500},
    query: {type: 'string', maxLength: 300}, id: {type: 'string', minLength: 1, maxLength: 160},
  }, additionalProperties: false};
  const fn = (path, description, schema = inputSchema) => ({path, method: 'POST', description, payment: plan.payment,
    inputSchema: schema, example: {}, timeoutMs: 120000, maxInputBytes: 65536, maxOutputBytes: MiB, output: {format: 'json'}});
  return {schema: 'stellar-forge.python-merchant.v1', application: 'application.py', publicOrigin: plan.publicOrigin,
    serviceName, tags: ['records', 'invoice-reconciliation', 'python'], workerCount: 1, maxPending: 2,
    startupTimeoutMs: 10000, shutdownTimeoutMs: 10000,
    functions: {
      inspect_records: fn('/records-operator/inspect', 'Reconcile all four retained ledgers using the original engine and inspect exact paged source, calculation, review, inventory or monthly report records.', inspectSchema),
      build_records: fn('/records-operator/build', 'Build complete selected-period reconciliation, transition and operator reports; complete row exports use the same saved-source processor.'),
      customer_records: fn('/records-operator/customer', 'Build the customer report and explicitly selected handoff fields from the same retained calculation.'),
    }};
}
async function capturedSource(base, descriptor, reference = false) {
  if (!object(descriptor) || typeof descriptor.path !== 'string' || isAbsolute(descriptor.path)
      || descriptor.path.includes('\\') || descriptor.path.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('Retained source paths must remain inside the prepared input directory.');
  if (!reference && !/^captures\/[a-f0-9]{64}\.(json|csv)$/.test(descriptor.path))
    throw new Error('Use an exact content-addressed original CSV/JSON capture.');
  const path = join(base, descriptor.path), canonical = await realpath(path), inside = relative(base, canonical);
  if (inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new Error('Source is outside the prepared input directory.');
  const bytes = await regular(path), digest = sha(bytes);
  if ((!reference || descriptor.sha256 !== undefined) && descriptor.sha256 !== digest
      || (!reference || descriptor.bytes !== undefined) && descriptor.bytes !== bytes.length)
    throw new Error('Retained source bytes or SHA256 differ: ' + descriptor.path);
  if (!reference && descriptor.path.split('/').at(-1).split('.')[0] !== digest)
    throw new Error('Capture filename does not match the original bytes.');
  return bytes;
}
async function preparedFiles(datasetPath, planPath) {
  const canonical = await realpath(resolve(datasetPath)), base = dirname(canonical);
  const datasetBytes = await regular(canonical), dataset = JSON.parse(datasetBytes);
  if (!object(dataset) || dataset.schema !== 'tj.records-operator-workspace.v1'
      || !Array.isArray(dataset.periods) || !dataset.periods.length
      || !dataset.periods.some(period => period.id === dataset.selectedPeriod))
    throw new Error('Use the complete prepared records workspace with a selected named period.');
  const planBytes = planPath ? await regular(resolve(planPath), 65536)
    : jsonBytes(localPreviewPlan(typeof dataset.title === 'string' && dataset.title.trim() ? dataset.title : 'Records operator workspace'));
  const plan = JSON.parse(planBytes), config = declaration(plan);
  const files = new Map([
    ['application.py', await regular(join(HERE, 'application.py'))],
    ['processor.py', await regular(join(HERE, 'processor.py'))],
    ['workspace.json', datasetBytes], ['merchant.json', jsonBytes(config)],
  ]);
  for (const name of ['__init__.py','engine.py','_output_custody.py']) {
    const relative = 'offsite_records_storage_invoice_reconciliation/' + name;
    files.set(relative, await regular(join(HERE, relative)));
  }
  let editions = 0;
  for (const period of dataset.periods) {
    if (!object(period) || !Array.isArray(period.editions) || !period.editions.length
        || !period.editions.some(edition => edition.id === period.selectedEdition))
      throw new Error('Every named period needs its selected retained edition.');
    editions += period.editions.length;
    for (const edition of period.editions) {
      if (!object(edition) || !Array.isArray(edition.sources))
        throw new Error('Every edition needs its complete original source list.');
      const selections = [...edition.sources];
      if (edition.requestSource) selections.push(edition.requestSource);
      for (const source of selections) {
        const bytes = await capturedSource(base, source);
        const previous = files.get(source.path);
        if (previous && !previous.equals(bytes)) throw new Error('One source path has inconsistent original bytes.');
        files.set(source.path, bytes);
      }
    }
  }
  for (const reference of [dataset.requirements, dataset.catalog]) {
    if (!reference?.path) continue;
    const bytes = await capturedSource(base, reference, true);
    const previous = files.get(reference.path);
    if (previous && !previous.equals(bytes)) throw new Error('One reference path has inconsistent original bytes.');
    files.set(reference.path, bytes);
  }
  const total = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if (files.size > 512 || total > SOURCE_LIMIT) throw new Error('Prepared source exceeds the original 512-file / 32 MiB workspace limit.');
  return {files, label: plan.label, planBytes, datasetBytes, previewOnly: !planPath, total,
    periods: dataset.periods.length, editions};
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
async function operatorOptions(value, sourceRoot) {
  const {readBrowserAssets} = await import(pathToFileURL(join(sourceRoot, 'stellar/scf-starforge-20261009/distribution/browser-assets.mjs')).href);
  if (!value) {
    if (!(await present(join(HERE, 'web')))) return {};
    const operatorPath = '/records-operator/';
    const routes = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
    // The original native server owns the shared draft store route. The same
    // canonical manifest retains that dependency for the maintained browser graph.
    const operatorAssets = [...routes].filter(([path]) => path.startsWith(operatorPath))
      .map(([path, {url, type}]) => ({path, file: url, type}));
    return {operatorPath, operatorAssets};
  }
  const selected = await realpath(resolve(value)), info = await lstat(selected);
  if (info.isDirectory()) {
    const operatorPath = '/records-operator/';
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
async function serve(model, sourceRoot, flags, launch = null) {
  const options = await operatorOptions(flags['operator-assets'], sourceRoot);
  const {startPythonWorkspace} = await import(pathToFileURL(join(sourceRoot, NATIVE, 'server.mjs')).href);
  const server = await startPythonWorkspace(model, {port: port(flags.port), ...options});
  try {
    if (options.operatorPath && (!server.nativeOperatorUrl || new URL(server.operatorUrl).pathname !== options.operatorPath))
      throw new Error('Use the original Python workspace server version that supports operatorAssets and operatorPath.');
    const onSignal = () => {void server.close().catch(error => {process.stderr.write(error.message + '\n'); process.exitCode = 1;});};
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    const announcement = launch
      ? await (await import('./managed.mjs')).recordsManagedStartup({launch, workspace: model, service: server})
      : {schema: 'tj.records-workspace-console.v1', operatorUrl: server.operatorUrl,
        nativeOperatorUrl: server.nativeOperatorUrl ?? server.operatorUrl};
    process.stdout.write(JSON.stringify(announcement, null, launch ? undefined : 2) + '\n');
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
  if (!object(manifest) || manifest.schema !== 'tj.records-operator-delivery.v1'
      || typeof manifest.completeRowExport !== 'boolean' || !Array.isArray(manifest.files))
    throw new Error('The original complete export has no retained manifest.');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!object(file) || seen.has(file.path)) throw new Error('The export repeats a file.');
    seen.add(file.path);
    const actual = await fileIdentity(deliveryPath(root, file.path));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error('Complete export bytes differ: ' + file.path);
    if (manifest.audience === 'customer' && !file.path.startsWith('customer/')) throw new Error('Customer output contains an operator file.');
  }
  for (const name of ['customer.csv','customer.ndjson','ap-reconciliation.csv','inventory.csv','transition-manifest.csv',
      'transition-checks.csv','cooperative-monthly.csv','requirements-response.csv','original-cost-catalog.csv',
      'record-changes.csv','summary.json','report.html','customer-field-mapping.json','README.md'])
    if (!seen.has('customer/' + name)) throw new Error('A complete customer file is missing: ' + name);
}
async function runExport(python, source, destination, period, edition, audience) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(python, [join(source, 'processor.py'), 'export', '--workspace',
      join(source, 'workspace.json'), '--out', destination, '--period', period, '--edition', edition, '--audience', audience],
      {cwd: source, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}, stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stdout.on('data', () => {}); // The retained original manifest is authoritative.
    child.stderr.on('data', chunk => {stderr = (stderr + chunk.toString()).slice(-16000);});
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => code === 0 ? resolveRun()
      : rejectRun(new Error('Original full data export exited ' + (signal ?? code) + ': ' + stderr)));
  });
}
async function packageOperatorApplication(delivery, savedSource, files) {
  const packaged = [];
  const saved = ['application.py', 'processor.py',
    'offsite_records_storage_invoice_reconciliation/__init__.py',
    'offsite_records_storage_invoice_reconciliation/engine.py',
    'offsite_records_storage_invoice_reconciliation/_output_custody.py'];
  const product = ['workbench.mjs', 'browser-assets.json', 'web/index.html', 'web/browser.mjs', 'web/style.css',
    'README.md', 'OPERATIONS.md', 'CORE_CONTRACT.md', 'INPUT_HANDOFF.md', 'PRICING_V2.md', 'UI.md',
    'managed.mjs', 'application-provider.mjs', 'INSTALL.md'];
  for (const [basis, base, paths] of [['saved-native-revision', savedSource, saved], ['operator-application', HERE, product]]) {
    for (const path of paths) {
      const bytes = await regular(join(base, path), FILE_LIMIT);
      const relativePath = 'operator/application/' + path;
      const target = deliveryPath(delivery, relativePath);
      await mkdir(dirname(target), {recursive: true, mode: 0o700});
      await exactFile(target, bytes);
      const identity = {path: relativePath, bytes: bytes.length, sha256: sha(bytes), basis};
      packaged.push(identity); files.push(identity);
    }
  }
  const contributionPath = 'operator/install/records-operator.json';
  const contributionBytes = await regular(join(HERE, 'contribution.json'), 65536);
  await mkdir(dirname(deliveryPath(delivery, contributionPath)), {recursive: true, mode: 0o700});
  await exactFile(deliveryPath(delivery, contributionPath), contributionBytes);
  files.push({path: contributionPath, bytes: contributionBytes.length, sha256: sha(contributionBytes),
    basis: 'operator-application-installation'});
  const instructions = [
    '# Reopen the complete records operator', '',
    'This package includes the actual operator wrapper, browser, processor and original engine source.',
    'The processor and engine are from the selected build revision. The browser and wrapper are the packaged product implementation.',
    'Their exact file identities are in handoff.json; the original portable retains every saved source and preview.', '',
    'Use the existing maintained Python workspace runtime from woahwhattheheck/public-commons-sprint-2026',
    'or the source directory of its original installed merchant package. Required runtime: Node 22.13+ and Python 3.11+.',
    'The runtime entrypoint is ' + NATIVE + '/model.mjs. No extra database, hosted account or provider call is required.', '',
    'From this handoff directory:', '',
    '    node operator/application/workbench.mjs reopen --source-root RUNTIME_SOURCE --dir NEW_OPERATION --bundle operator/workspace.python-workspace.json',
    '    node operator/application/workbench.mjs serve --source-root RUNTIME_SOURCE --dir NEW_OPERATION --port 8431', '',
    'Open the original private operator URL printed by serve. Inspect the period/edition and retained build ID in handoff.json.',
    'The customer/ directory contains the selected complete data/report exports. Keep operator/ with the authorized operator.', '',
    'For subsequent actual source editions, use the same saved workspace and explicit source mapping/correction workflow.',
    'OPERATIONS.md, CORE_CONTRACT.md, UI.md and INSTALL.md are included beside the wrapper.',
    'Managed Applications uses the original installed source layout; INSTALL.md describes review, save, start, Open, Stop and reopen.',
    'The separate operator/install/records-operator.json retains its source-owned distribution declaration.', ''
  ].join('\n');
  const path = 'operator/REOPEN.md', bytes = Buffer.from(instructions);
  await exactFile(deliveryPath(delivery, path), bytes);
  files.push({path, bytes: bytes.length, sha256: sha(bytes)});
  return {directory: 'operator/application', files: packaged,
    installation: {contribution: contributionPath,
      canonicalDestination: 'stellar/scf-starforge-20261009/distribution/contributions/records-operator.json'},
    runtime: {repository: 'woahwhattheheck/public-commons-sprint-2026', entrypoint: NATIVE + '/model.mjs',
      node: '22.13+', python: '3.11+', dependencyIncluded: false},
    instructions: path};
}

async function handoff(model, id, output, flags, bundleLimit) {
  const audience = flags.audience ?? 'operator';
  if (!['customer', 'operator'].includes(audience)) throw new Error('--audience must be customer or operator.');
  const retained = await model.previewOutput(id), detail = await model.previewDetail(id);
  const report = JSON.parse(retained.bytes), revision = model.revision(detail.revisionId);
  if (detail.status !== 'COMPLETED' || detail.function !== 'build_records'
      || report.schema !== 'tj.records-operator-build.v1' || !Array.isArray(report.files))
    throw new Error('Select the completed original build_records preview.');
  const expected = new Set(['operator-summary.json','operator-report.html','customer-field-mapping.json','HANDOFF.md']);
  for (const file of report.files) {
    if (!expected.delete(file.name) || typeof file.body !== 'string') throw new Error('Unexpected or repeated native report file.');
    const bytes = Buffer.from(file.body);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error('The original native report file differs: ' + file.name);
  }
  if (expected.size) throw new Error('The selected native report is incomplete.');
  const previewSha256 = sha(retained.bytes);
  if (previewSha256 !== retained.sha256) throw new Error('The retained native preview differs.');
  const edition = report.report?.edition?.id, period = report.report?.period?.id;
  if (typeof edition !== 'string' || !edition || typeof period !== 'string' || !period) throw new Error('The original build has no selected named period/edition.');
  const selection = {workspace: model.metadata().id, preview: id, revision: detail.revisionId, period, edition, audience, previewSha256};
  const root = resolve(output), work = root + '.records-handoff-work';
  if (await present(root)) {
    const saved = JSON.parse(await regular(join(root, 'handoff.json'), 8 * MiB));
    if (saved.schema !== 'tj.records-workspace-handoff.v1' || Object.entries(selection).some(([key, value]) => saved[key] !== value))
      throw new Error('The existing output belongs to another selection. Choose a new handoff directory.');
    if (audience === 'operator' && !saved.operatorApplication?.files?.length)
      throw new Error('This earlier data handoff lacks the operator application source. Keep it and select a new complete handoff directory.');
    await verifyDelivery(root, JSON.parse(await regular(join(root, 'manifest.json'), 8 * MiB)));
    for (const file of saved.files) {
      const actual = await fileIdentity(deliveryPath(root, file.path));
      if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) throw new Error('The completed retained handoff differs: ' + file.path);
    }
    return {directory: root, customerDirectory: join(root, 'customer'),
      operatorDirectory: audience === 'operator' ? join(root, 'operator') : null, ...saved};
  }
  await ownedDirectory(work, {schema: 'tj.records-handoff-operation.v1', ...selection});
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
  if (!dataset.periods?.find(item => item.id === period)?.editions?.some(item => item.id === edition)) throw new Error('The build edition is absent from its saved source.');
  const declaration = JSON.parse(revision.declarationText);
  const python = flags.python ?? declaration.interpreter ?? 'python3';
  if (typeof python !== 'string' || !python.trim() || python.includes('\0')) throw new Error('Select the original Python executable.');
  // An already completed original CLI export is reopened. An interrupted
  // incomplete export can be regenerated from these same immutable sources;
  // it never invokes another native preview, provider request or paid job.
  if (!(await present(delivery))) await runExport(python, source, delivery, period, edition, audience);
  const originalManifestBytes = await regular(join(delivery, 'manifest.json'), 8 * MiB);
  const originalManifest = JSON.parse(originalManifestBytes);
  if (originalManifest.periodId !== period || originalManifest.editionId !== edition || originalManifest.audience !== audience
      || originalManifest.workspaceSha256 !== sha(workspaceBytes)
      || originalManifest.requestSha256 !== report.report.reconciliation.requestSha256)
    throw new Error('The completed data export belongs to another original edition, audience or source revision.');
  await verifyDelivery(delivery, originalManifest);
  const files = originalManifest.files.map(file => ({...file}));
  let operatorApplication = null;
  files.push({path: 'manifest.json', bytes: originalManifestBytes.length, sha256: sha(originalManifestBytes)});
  if (audience === 'operator') {
    const operator = join(delivery, 'operator');
    await mkdir(operator, {recursive: true, mode: 0o700});
    await exactFile(join(operator, 'native-preview.json'), retained.bytes);
    files.push({path: 'operator/native-preview.json', bytes: retained.bytes.length, sha256: previewSha256});
    operatorApplication = await packageOperatorApplication(delivery, source, files);
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
  const manifest = {schema: 'tj.records-workspace-handoff.v1', ...selection,
    sourceSha256: sha(workspaceBytes), originalExportSha256: sha(originalManifestBytes),
    counts: originalManifest.counts, completeRowExport: originalManifest.completeRowExport,
    calculationStatus: originalManifest.calculationStatus, inputErrorCount: originalManifest.inputErrorCount,
    operatorApplication, files};
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
async function findSourceRoot(explicit) {
  if (explicit) {
    const root = await realpath(resolve(explicit));
    if (!(await present(join(root, NATIVE, 'model.mjs')))) throw new Error('Selected source root does not contain the original maintained Python workspace.');
    return root;
  }
  let root = HERE;
  for (let count = 0; count < 12; count++) {
    if (await present(join(root, NATIVE, 'model.mjs'))) return await realpath(root);
    const parent = dirname(root); if (parent === root) break; root = parent;
  }
  throw new Error('Supply --source-root for the existing maintained repository or installed package/source directory.');
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) {process.stdout.write(HELP); return;}
  const {command, flags, forward} = parse(argv);
  const sourceRoot = await findSourceRoot(flags['source-root']);
  const root = resolve(required(flags, 'dir')), workspace = join(root, 'workspace');
  let launch = null;
  if (command === 'binding' || command === 'managed') {
    const managed = await import('./managed.mjs');
    if (command === 'binding') {
      const result = {schema: 'stellar-forge.records-workbench-review.v1',
        workspace: await managed.inspectRecordsWorkspace(root),
        source: await managed.inspectRecordsLaunchSource(sourceRoot)};
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return result;
    }
    launch = await managed.prepareRecordsManagedLaunch({directory: root, sourceRoot,
      expectedWorkspaceIdentity: required(flags, 'expected-workspace-identity'),
      expectedSourceSha256: required(flags, 'expected-source-sha256')});
  }
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
      await ownedDirectory(root, {schema: 'tj.records-workbench.v1', mode: 'create',
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
        retainedFiles: prepared.files.size, retainedBytes: prepared.total, maxOutputBytes: MiB, maxTimeoutMs: 120000, periods: prepared.periods, editions: prepared.editions};
    } else if (command === 'import' || command === 'reopen') {
      const bytes = await regular(resolve(required(flags, 'bundle')), native.MAX_BUNDLE_BYTES);
      await ownedDirectory(root, {schema: 'tj.records-workbench.v1', mode: 'import', bundleSha256: sha(bytes)});
      model = await present(workspace) ? await native.openWorkspace(workspace) : await native.importWorkspace(workspace, bytes);
    } else model = await native.openWorkspace(workspace);
    if (command === 'serve' || command === 'managed') return await serve(model, sourceRoot, flags, launch);
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
  process.stderr.write(JSON.stringify({error: error.code ?? 'RECORDS_WORKBENCH_ERROR', message: error.message}) + '\n');
  process.exitCode = 1;
});
