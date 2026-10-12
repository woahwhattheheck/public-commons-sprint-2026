#!/usr/bin/env node
// TJLabs. Retained web-data delivery on the original retained Python workspace.
import {createHash, randomBytes} from 'node:crypto';
import {readFile, open, mkdir, lstat, readdir, link, unlink, realpath} from 'node:fs/promises';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NATIVE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace';
const MiB = 1024 * 1024, SOURCE_LIMIT = 32 * MiB, FILE_LIMIT = 8 * MiB;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const HELP = [
  'Diffbot retained dataset on the original Python workspace (Node 22.13+)',
  '',
  'create [--source-root ROOT] --dir NEW_DIR --dataset WORKSPACE.json [--plan PLAN.json]',
  'import [--source-root ROOT] --dir NEW_DIR --bundle ORIGINAL_WORKSPACE.json',
  'reopen [--source-root ROOT] --dir NEW_DIR --bundle ORIGINAL_WORKSPACE.json',
  'status [--source-root ROOT] --dir DIR',
  'inspect [--source-root ROOT] --dir DIR [--revision REVISION]',
  'serve [--source-root ROOT] --dir DIR [--port 8431] [--operator-assets WEB_DIR_OR_MANIFEST]',
  'workspace [--source-root ROOT] --dir DIR -- ORIGINAL_COMMAND [OPTIONS]',
  'export [--source-root ROOT] --dir DIR --out NEW_BUNDLE.json',
  'handoff [--source-root ROOT] --dir DIR --preview BUILD_PREVIEW_ID --out NEW_DIR',
  '',
  'Source root defaults to the original repository or installed package/source root.',
  'Create copies the original prepared dataset and every referenced capture into',
  'one native Python workspace. Inspect reads saved source metadata; calculation',
  'uses the original preview command with inspect_dataset or build_dataset.',
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
    workspace: shared, export: [...shared, 'out'], handoff: [...shared, 'preview', 'out'],
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
  return {label, serviceName: 'Diffbot retained dataset', publicOrigin: 'https://diffbot-workspace.example',
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
  const fn = (path, description) => ({path, method: 'POST', description, payment: plan.payment,
    inputSchema, example: {}, timeoutMs: 30000, maxInputBytes: 65536,
    maxOutputBytes: MiB, output: {format: 'json'}});
  return {schema: 'stellar-forge.python-merchant.v1', application: 'application.py',
    publicOrigin: plan.publicOrigin, serviceName, tags: ['diffbot', 'retained-data', 'python'],
    workerCount: 1, maxPending: 2, startupTimeoutMs: 10000, shutdownTimeoutMs: 10000,
    functions: {
      inspect_dataset: fn('/diffbot-dataset/inspect', 'Inspect retained Extract/Bulk source editions, exact identities, coverage, comparison and operator reviews.'),
      build_dataset: fn('/diffbot-dataset/build', 'Build the agreed retained dataset with its source lineage, numeric tokens, reviewed outputs and customer files.'),
      customer_dataset: fn('/diffbot-dataset/customer', 'Build only mapped customer files and accepted recurring projections, without operator reports, review notes or workspace source.'),
    }};
}
async function capturedSource(base, name, expected) {
  if (typeof name !== 'string' || !/^captures\/[a-f0-9]{64}\.(json|csv)$/.test(name)) throw new Error('Capture paths must use captures/<sha256>.json or .csv.');
  const path = join(base, name), canonical = await realpath(path), inside = relative(base, canonical);
  if (inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new Error('Capture is outside the prepared dataset directory.');
  const bytes = await regular(path), digest = sha(bytes);
  if (name.split('/').at(-1).split('.')[0] !== digest) throw new Error('Capture filename does not match its original bytes: ' + name);
  if (expected && (expected.sha256 !== digest || expected.bytes !== bytes.length)) throw new Error('Capture manifest does not match its original bytes: ' + name);
  return bytes;
}
function safeCapture(bytes, format) {
  const credentials = new Set(['token', 'childtokens', 'apikey', 'accesstoken', 'authtoken',
    'authorization', 'proxyauth', 'password', 'secret', 'clientsecret', 'cookie', 'setcookie', 'customheaders']);
  const query = /[?&](?:token|api[_-]?key|access[_-]?token|auth[_-]?token|proxyauth|password|secret)=([^&#\s"'<>]*)/gi;
  const hasCredentialUrl = value => [...value.matchAll(query)].some(match => {
    try {return !['', '[REDACTED]'].includes(decodeURIComponent(match[1]));}
    catch {return true;}
  });
  const fail = () => {throw new Error('The selected capture contains credential fields or URL parameters. Export a safe capture through acquisition.py; keep original wire bytes in private transport custody.');};
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('Capture must contain original supported UTF-8 bytes.');
  if (format === 'diffbot-bulk-url-report-csv') {
    // CSV cells are never converted to JS numbers. The acquisition client can
    // retain and sanitize a complete URL report into a JSON capture envelope.
    if (hasCredentialUrl(text) || /(?:^|,)\s*"?(?:token|childTokens|api[_-]?key|authorization|password|secret)"?\s*(?:,|$)/i.test(text.split(/\r?\n/, 1)[0])) fail();
    return;
  }
  const value = JSON.parse(text), stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === 'string') {if (hasCredentialUrl(item)) fail();}
    else if (Array.isArray(item)) {for (const child of item) stack.push(child);}
    else if (object(item)) {
      for (const [key, child] of Object.entries(item)) {
        if (credentials.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) fail();
        stack.push(child);
      }
    }
  }
  // JSON parsing above only inspects credential fields. The original bytes,
  // including large numeric lexemes, are copied unchanged into the workspace.
  if (format === 'diffbot-safe-capture-v1' && (value?.schema !== 'tj.diffbot-safe-capture.v1'
      || !object(value.capture?.original) || !Array.isArray(value.redactions)))
    throw new Error('The selected safe capture does not carry its original source relation.');
}
async function preparedFiles(datasetPath, planPath) {
  const canonical = await realpath(resolve(datasetPath)), base = dirname(canonical);
  const datasetBytes = await regular(canonical), dataset = JSON.parse(datasetBytes);
  if (!object(dataset) || dataset.schema !== 'tj.diffbot-workspace.v1'
      || !Array.isArray(dataset.editions) || !dataset.editions.length
      || !dataset.editions.some(edition => edition.id === dataset.selectedEdition))
    throw new Error('Use the complete prepared Diffbot dataset with a selected edition.');
  const planBytes = planPath ? await regular(resolve(planPath), 65536)
    : jsonBytes(localPreviewPlan(typeof dataset.title === 'string' && dataset.title.trim() ? dataset.title : 'Diffbot retained dataset'));
  const plan = JSON.parse(planBytes), config = declaration(plan);
  const files = new Map([
    ['application.py', await regular(join(HERE, 'application.py'), 2 * MiB)],
    ['processor.py', await regular(join(HERE, 'processor.py'))],
    ['workspace.json', datasetBytes], ['merchant.json', jsonBytes(config)],
  ]);
  const recurringFiles = ['recurring/__init__.py', 'recurring/report.py'];
  const recurringPresent = await Promise.all(recurringFiles.map(name => present(join(HERE, name))));
  if (recurringPresent.some(Boolean)) {
    if (!recurringPresent.every(Boolean)) throw new Error('Keep the complete original recurring Python module closure.');
    for (const name of recurringFiles) files.set(name, await regular(join(HERE, name)));
  }
  const formats = new Set(['diffbot-extract-json', 'diffbot-bulk-data-json',
    'diffbot-bulk-status-json', 'diffbot-bulk-url-report-csv', 'diffbot-safe-capture-v1']);
  for (const edition of dataset.editions) {
    if (!object(edition) || !Array.isArray(edition.sources)) throw new Error('Each prepared edition needs its original source list.');
    for (const source of edition.sources) {
      if (!object(source) || !formats.has(source.format)) throw new Error('Source manifest row must use a supported retained Diffbot capture format.');
      const bytes = await capturedSource(base, source.path, source);
      safeCapture(bytes, source.format);
      const previous = files.get(source.path);
      if (previous && !previous.equals(bytes)) throw new Error('One source path has inconsistent original bytes.');
      files.set(source.path, bytes);
    }
  }
  const total = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if (files.size > 512 || total > SOURCE_LIMIT) throw new Error('Prepared source exceeds the original 512-file / 32 MiB workspace limit; select a complete agreed source partition.');
  return {files, label: plan.label, planBytes, datasetBytes, previewOnly: !planPath, total,
    recurring: recurringPresent.every(Boolean)};
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
    const candidate = join(HERE, 'web');
    if (!(await present(candidate))) return {};
    value = candidate;
  }
  const selected = await realpath(resolve(value)), info = await lstat(selected);
  if (info.isDirectory()) {
    const operatorPath = '/diffbot-dataset/';
    const operatorAssets = [
      {path: operatorPath, file: join(selected, 'index.html'), type: 'text/html; charset=utf-8'},
      {path: operatorPath + 'browser.mjs', file: join(selected, 'browser.mjs'), type: 'text/javascript; charset=utf-8'},
      {path: operatorPath + 'style.css', file: join(selected, 'style.css'), type: 'text/css; charset=utf-8'},
    ];
    // Installed source keeps recurring/ beside web/; a portable web bundle may
    // place the same two immutable assets beneath its own recurring/ directory.
    const embedded = join(selected, 'recurring'), sibling = join(dirname(selected), 'recurring');
    const recurringRoot = await present(join(embedded, 'recurring.mjs')) ? embedded : sibling;
    const recurring = join(recurringRoot, 'recurring.mjs'), recurringCss = join(recurringRoot, 'recurring.css');
    const hasRecurring = await present(recurring), hasRecurringCss = await present(recurringCss);
    if (hasRecurring || hasRecurringCss) {
      if (!hasRecurring || !hasRecurringCss) throw new Error('Keep both recurring.mjs and recurring.css in the original operator bundle.');
      operatorAssets.push({path: operatorPath + 'recurring/recurring.mjs', file: recurring,
        type: 'text/javascript; charset=utf-8'},
        {path: operatorPath + 'recurring/recurring.css', file: recurringCss, type: 'text/css; charset=utf-8'});
    }
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
    process.stdout.write(JSON.stringify({schema: 'tj.diffbot-workspace-console.v1',
      operatorUrl: server.operatorUrl, nativeOperatorUrl: server.nativeOperatorUrl ?? server.operatorUrl}, null, 2) + '\n');
    try {await server.closed;}
    finally {process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);}
  } finally {await server.close();}
}
async function handoff(model, id, output, bundleLimit) {
  const retained = await model.previewOutput(id), detail = await model.previewDetail(id);
  const report = JSON.parse(retained.bytes);
  if (detail.status !== 'COMPLETED' || detail.function !== 'build_dataset'
      || report.schema !== 'tj.diffbot-dataset-report.v1' || report.ready !== true || !Array.isArray(report.files))
    throw new Error('Select a completed, ready build_dataset preview.');
  const expected = new Set(['customer.ndjson', 'customer.csv', 'customer.html', 'review-decisions.json', 'source-index.json', 'number-tokens.json', 'dataset-report.json', 'DELIVERY.md']);
  const optional = new Set(['recurring-report.json', 'recurring-report.html']);
  const operatorOnly = new Set(['review-decisions.json', 'dataset-report.json']);
  const files = [];
  for (const file of report.files) {
    if ((!expected.delete(file.name) && !optional.delete(file.name)) || typeof file.body !== 'string') throw new Error('Unexpected or repeated original delivery file.');
    const bytes = Buffer.from(file.body);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error('Original delivery file digest differs: ' + file.name);
    files.push({name: file.name, audience: operatorOnly.has(file.name) ? 'operator' : 'customer', bytes, sha256: file.sha256});
  }
  if (expected.size || optional.size === 1) throw new Error('The original delivery is incomplete.');
  const previewSha256 = sha(retained.bytes);
  if (retained.sha256 !== previewSha256) throw new Error('The original preview digest differs.');
  const root = resolve(output);
  await ownedDirectory(root, {schema: 'tj.diffbot-handoff-operation.v2',
    workspace: model.metadata().id, preview: id, previewSha256});
  const directories = {customer: join(root, 'customer'), operator: join(root, 'operator')};
  for (const directory of Object.values(directories)) {
    await mkdir(directory, {recursive: true, mode: 0o700});
    if (!(await lstat(directory)).isDirectory()) throw new Error('Use real audience directories in the retained handoff.');
  }
  // Complete reports, private review notes and editable source belong only in
  // the operator directory. The customer directory is independently portable.
  files.push({name: 'preview-result.json', audience: 'operator', bytes: retained.bytes, sha256: previewSha256});
  for (const file of files) await exactFile(join(directories[file.audience], file.name), file.bytes);
  const bundleName = 'workspace.python-workspace.json', bundlePath = join(directories.operator, bundleName);
  let bundle;
  if (await present(bundlePath)) bundle = await regular(bundlePath, bundleLimit);
  else {
    const exported = await model.exportBundle();
    if (sha(exported.bytes) !== exported.sha256) throw new Error('The original workspace export digest differs.');
    await exactFile(bundlePath, exported.bytes); bundle = exported.bytes;
  }
  // On an interrupted handoff, keep the first original export; never generate a
  // later workspace in place of its already retained portable bytes.
  const portable = JSON.parse(bundle);
  if (portable.schema !== 'stellar-forge.python-workspace-export.v1' || portable.workspace?.metadata?.id !== model.metadata().id
      || !portable.workspace.previews.some(row => row.id === id && row.result?.sha256 === previewSha256))
    throw new Error('Retained portable workspace does not contain this original selected preview.');
  files.push({name: bundleName, audience: 'operator', bytes: bundle, sha256: sha(bundle)});
  const selection = {workspace: model.metadata().id, preview: id, revision: detail.revisionId,
    function: detail.function, previewStatus: detail.status};
  const audiences = {};
  for (const audience of ['customer', 'operator']) {
    const manifest = {schema: 'tj.diffbot-' + audience + '-handoff.v1', audience, ...selection,
      files: files.filter(file => file.audience === audience).map(file => ({
        name: file.name, bytes: file.bytes.length, sha256: file.sha256}))};
    await exactFile(join(directories[audience], 'manifest.json'), jsonBytes(manifest));
    audiences[audience] = {directory: audience, manifest: audience + '/manifest.json',
      files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0)};
  }
  const manifest = {schema: 'tj.diffbot-workspace-handoff.v1', audience: 'operator', ...selection, audiences,
    files: files.map(file => ({name: file.name, path: file.audience + '/' + file.name,
      audience: file.audience, bytes: file.bytes.length, sha256: file.sha256}))};
  await exactFile(join(root, 'manifest.json'), jsonBytes(manifest));
  return {directory: root, customerDirectory: directories.customer, operatorDirectory: directories.operator, ...manifest};
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
      await ownedDirectory(root, {schema: 'tj.diffbot-workbench.v1', mode: 'create',
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
        retainedFiles: prepared.files.size, retainedBytes: prepared.total, maxOutputBytes: MiB, recurring: prepared.recurring};
    } else if (command === 'import' || command === 'reopen') {
      const bytes = await regular(resolve(required(flags, 'bundle')), native.MAX_BUNDLE_BYTES);
      await ownedDirectory(root, {schema: 'tj.diffbot-workbench.v1', mode: 'import', bundleSha256: sha(bytes)});
      model = await present(workspace) ? await native.openWorkspace(workspace) : await native.importWorkspace(workspace, bytes);
    } else model = await native.openWorkspace(workspace);
    if (command === 'serve') return await serve(model, sourceRoot, flags);
    let result;
    if (command === 'handoff') result = await handoff(model, required(flags, 'preview'), required(flags, 'out'), native.MAX_BUNDLE_BYTES);
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
  process.stderr.write(JSON.stringify({error: error.code ?? 'DIFFBOT_WORKBENCH_ERROR', message: error.message}) + '\n');
  process.exitCode = 1;
});
