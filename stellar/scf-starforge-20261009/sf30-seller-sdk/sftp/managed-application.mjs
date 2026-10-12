// MIT. Managed Applications binding for the original private SFTP workbench.
import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, canonical, digest, json, need, plain, privateDirectory, readJSON,
  recordId, operationId, regular } from '../../distribution/runtime-workspace/storage.mjs';
import { readPrivate, bytes as nativeBytes } from '../postgres/publisher/files.mjs';
import { validateSftpSource } from './config.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/sftp';
const WORKSPACE = 'stellar-forge.sftp-authoring-workspace.v1';
const BINDING = 'stellar-forge.sftp-application-binding.v1';
const PREPARATION = 'stellar-forge.sftp-application-preparation.v1';
const STARTUP = 'stellar-forge.sftp-application-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const ITEM = /^[a-z][a-z0-9-]{0,100}$/;
const same = (a, b) => json(canonical(a)) === json(canonical(b));
const hash = value => digest(json(canonical(value)));
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export const SFTP_APPLICATION_SOURCE_FILES = Object.freeze([
  'application-provider.mjs', 'managed-application.mjs',
  'workspace/server.mjs', 'workspace/model.mjs',
  'workspace/public/index.html', 'workspace/public/app.mjs', 'workspace/public/style.css',
]);

export function sftpApplication(common = []) {
  return {
    id: 'sftp-publisher', command: 'sftp-workspace', title: 'SFTP source and dataset publishers',
    terminal: false, requiredSource: SOURCE + '/managed-application.mjs',
    description: 'Open the saved private SFTP source, complete file captures, typed reports, exact merchant choices, retained publications, recurring refresh and customer handoffs.',
    fields: [
      field('workspaceDirectory', 'Original SFTP workbench', 'path', true,
        'Select the initialized private directory containing workspace.json. Saved revisions, products, seller intent and buyer files stay in this workbench.'),
      field('datasetFacilitator', 'Dataset facilitator URL', 'text', false,
        'Optional original x402 facilitator for the native dataset sellers. Use the same intended service when reopening those sellers.'),
      field('allowLocalDatasetFacilitator', 'Allow local development facilitator', 'boolean', false,
        'Select only with an explicitly chosen http://127.0.0.1 facilitator.'),
      ...common,
    ],
  };
}

export function validateSftpApplicationSettings(_type, settings) {
  need(plain(settings), 'APPLICATION_SFTP_SETTINGS_REQUIRED');
  if (!settings.datasetFacilitator) {
    need(!settings.allowLocalDatasetFacilitator, 'APPLICATION_SFTP_FACILITATOR_REQUIRED',
      'Select the original local facilitator URL with its explicit local option.');
    return;
  }
  let url;
  try { url = new URL(settings.datasetFacilitator); }
  catch { need(false, 'APPLICATION_SFTP_FACILITATOR_INVALID'); }
  const local = settings.allowLocalDatasetFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  need((local || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash,
    'APPLICATION_SFTP_FACILITATOR_INVALID', 'Use the original HTTPS facilitator or an explicitly selected local development URL.');
}

async function nativeJSON(path, maximum = 2 * 1024 * 1024, optional = false) {
  try {
    const raw = await readPrivate(path, maximum);
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), raw };
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}

function descriptor(value) {
  need(plain(value) && ITEM.test(value.id ?? '') && Number.isSafeInteger(value.revision) &&
    value.revision > 0 && HASH.test(value.sourceHash ?? '') && HASH.test(value.merchantHash ?? ''),
    'APPLICATION_SFTP_REVISION_INVALID', 'Restore the original retained SFTP revision.');
  return value;
}

/** Read original retained identities without opening a writer, source connection or service. */
export async function inspectSftpApplicationWorkspace(value, { expectedIdentity } = {}) {
  const directory = absolute(value);
  await privateDirectory(directory);
  const first = await lstat(directory);
  const { value: state } = await nativeJSON(join(directory, 'workspace.json'));
  need(plain(state) && state.schema === WORKSPACE && typeof state.createdAt === 'string' &&
    Number.isFinite(Date.parse(state.createdAt)) && Array.isArray(state.revisions) &&
    Array.isArray(state.publications), 'APPLICATION_SFTP_WORKSPACE_REQUIRED',
  'Select the original initialized SFTP workbench containing workspace.json.');
  const identity = { schema: BINDING, directory, dev: String(first.dev), ino: String(first.ino),
    createdAt: state.createdAt };
  const sha256 = hash(identity);
  need(expectedIdentity === undefined || expectedIdentity === sha256,
    'APPLICATION_SFTP_WORKSPACE_CHANGED', 'Review the selected original workbench after replacing its directory or creation identity.');
  const revisions = new Map(), ids = new Set();
  for (const entry of state.revisions) {
    descriptor(entry);
    need(!revisions.has(entry.revision) && !ids.has(entry.id),
      'APPLICATION_SFTP_REVISION_INVALID');
    revisions.set(entry.revision, entry); ids.add(entry.id);
  }
  const opened = new Map();
  async function savedRevision(number) {
    if (opened.has(number)) return opened.get(number);
    const item = revisions.get(number);
    need(item, 'APPLICATION_SFTP_REVISION_INVALID');
    const home = join(directory, 'revisions', item.id);
    await privateDirectory(home);
    const source = await nativeJSON(join(home, 'source.json'), 1024 * 1024);
    const merchant = await nativeJSON(join(home, 'merchant.json'), 1024 * 1024);
    need(digest(source.raw) === item.sourceHash && digest(merchant.raw) === item.merchantHash,
      'APPLICATION_SFTP_REVISION_CHANGED', 'Restore the exact original saved source and merchant bytes.');
    validateSftpSource(source.value);
    const record = { item, source: source.value, merchant: merchant.value };
    opened.set(number, record); return record;
  }
  const latest = state.revisions.at(-1);
  const saved = latest ? await savedRevision(latest.revision) : null;
  const publications = [], selectedIds = new Set();
  for (const id of state.publications) {
    need(typeof id === 'string' && ITEM.test(id) && !selectedIds.has(id),
      'APPLICATION_SFTP_PUBLICATION_INVALID');
    selectedIds.add(id);
    const home = join(directory, 'publications', id);
    await privateDirectory(home);
    const { value: link } = await nativeJSON(join(home, 'publication.json'), 1024 * 1024);
    need(plain(link) && link.schema === 'stellar-forge.sftp-browser-publication.v1' && link.id === id,
      'APPLICATION_SFTP_PUBLICATION_INVALID');
    const original = await savedRevision(link.revision);
    need(original.item.id === link.sourceRevisionId && original.item.sourceHash === link.sourceHash &&
      original.item.merchantHash === link.merchantHash &&
      Object.hasOwn(original.source.queries, link.query) && same(original.merchant, link.merchant),
    'APPLICATION_SFTP_PUBLICATION_CHANGED', 'Use the original selected report and merchant choices for this product.');
    const bound = await readPrivate(join(home, 'source.json'), 1024 * 1024);
    need(digest(bound) === link.publicationSourceHash &&
      digest(nativeBytes({ ...original.source, queries: { [link.query]: original.source.queries[link.query] } })) ===
        link.publicationSourceHash, 'APPLICATION_SFTP_PUBLICATION_CHANGED');
    const intent = await nativeJSON(join(home, 'service-intent.json'), 4096, true);
    need(!intent || plain(intent.value) &&
      intent.value.schema === 'stellar-forge.sftp-dataset-service-intent.v1' &&
      typeof intent.value.running === 'boolean', 'APPLICATION_SFTP_SERVICE_INTENT_INVALID');
    const buyers = [];
    const names = (await readdir(join(home, 'buyers'))).filter(name => name.endsWith('.manifest.json')).sort();
    for (const name of names) {
      need(ITEM.test(name.slice(0, -'.manifest.json'.length)), 'APPLICATION_SFTP_BUYER_INVALID');
      const record = (await nativeJSON(join(home, 'buyers', name), 16384)).value;
      need(plain(record) && record.id === name.slice(0, -'.manifest.json'.length) &&
        HASH.test(record.configSha256 ?? '') && HASH.test(record.offerSha256 ?? '') &&
        typeof record.runId === 'string' && HASH.test(record.snapshot ?? ''),
      'APPLICATION_SFTP_BUYER_INVALID');
      const config = await readPrivate(join(home, 'buyers', record.id + '.json'), 1024 * 1024);
      need(digest(config) === record.configSha256, 'APPLICATION_SFTP_BUYER_CHANGED');
      buyers.push(record);
    }
    publications.push({
      id, query: link.query, path: link.path, revision: link.revision,
      sourceRevisionId: link.sourceRevisionId, sourceHash: link.sourceHash,
      merchantHash: link.merchantHash, publicationSourceHash: link.publicationSourceHash,
      publisherDirectory: join(home, 'publisher'), datasetDirectory: join(home, 'dataset'),
      sellerRunningIntent: intent?.value.running ?? false, buyerCount: buyers.length,
      buyerManifestSha256: hash(buyers), buyers: buyers.slice(-20),
    });
  }
  const afterState = (await nativeJSON(join(directory, 'workspace.json'))).value;
  const last = await lstat(directory);
  need(String(first.dev) === String(last.dev) && String(first.ino) === String(last.ino) &&
    same(state, afterState), 'APPLICATION_SFTP_WORKSPACE_BUSY',
  'The workbench changed during review. Reopen its current state and review again.');
  const current = {
    revision: latest?.revision ?? 0, sourceHash: latest?.sourceHash ?? null,
    merchantHash: latest?.merchantHash ?? null, sourceRevisionId: latest?.id ?? null,
    reports: Object.keys(saved?.source.queries ?? {}),
    connection: saved ? { host: saved.source.connection.host, port: saved.source.connection.port ?? 22,
      username: saved.source.connection.username,
      hostKeyFingerprints: [...saved.source.connection.hostKeyFingerprints] } : null,
    requiredEnvironment: [...new Set(Object.values(saved?.source.connection.auth ?? {})
      .filter(name => typeof name === 'string'))].sort(),
    publications,
  };
  return { ...identity, sha256, current, currentSha256: hash(current) };
}

export async function inspectSftpApplicationSource(sourceRoot, { expectedSha256 } = {}) {
  const root = absolute(sourceRoot), files = [];
  for (const name of SFTP_APPLICATION_SOURCE_FILES) {
    const raw = await regular(join(root, SOURCE, name), 4 * 1024 * 1024);
    files.push({ path: SOURCE + '/' + name, bytes: raw.length, sha256: digest(raw) });
  }
  const sha256 = hash(files);
  need(expectedSha256 === undefined || sha256 === expectedSha256,
    'APPLICATION_SFTP_SOURCE_CHANGED', 'Select the complete original SFTP Applications release.');
  return { sourceRoot: root, sha256, files };
}

/** Require the actual installed peers used by the complete file and native seller workflow. */
export function checkSftpApplicationRuntime(runtime) {
  const required = ['ssh2', '@x402/core', '@x402/stellar', '@x402/extensions'];
  const selected = new Map((runtime?.dependencies ?? []).map(value => [value.name, value]));
  const missing = required.filter(name => !selected.has(name));
  need(missing.length === 0, 'APPLICATION_SFTP_RUNTIME_REQUIRED',
    'Select the original READY runtime with native payment support and the sftp feature. Missing installed profile dependencies: ' +
      missing.join(', ') + '.');
  return required.map(name => ({ name, version: selected.get(name).version }));
}

export async function prepareSftpApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_SFTP_INPUT_READER_REQUIRED');
  validateSftpApplicationSettings(null, settings);
  const directory = absolute(settings.workspaceDirectory);
  const inputs = [await inputPath(directory, 'directory', false, true)];
  const binding = await inspectSftpApplicationWorkspace(directory);
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  checkSftpApplicationRuntime(runtime);
  const source = await inspectSftpApplicationSource(runtime.sourceRoot);
  for (const file of source.files) {
    const selected = await inputPath(join(runtime.sourceRoot, file.path), 'file');
    need(selected.sha256 === file.sha256 && selected.bytes === file.bytes,
      'APPLICATION_SFTP_SOURCE_CHANGED');
    inputs.push(selected);
  }
  const args = ['--state', directory];
  if (settings.datasetFacilitator) args.push('--dataset-facilitator', settings.datasetFacilitator);
  if (settings.allowLocalDatasetFacilitator) args.push('--allow-local-dataset-facilitator');
  return {
    args, inputs, createDirectories: [],
    resourceKey: hash({ family: 'sftp-workbench', directory, identity: binding.sha256 }),
    sftp: { schema: PREPARATION, binding, source },
  };
}

/** Use the original saved start review; never create another application intent or request. */
export async function reviewedSftpApplication(request, directory) {
  need(plain(request) && request.command === 'sftp-workspace' && !request.pythonCommand &&
    Array.isArray(request.args), 'APPLICATION_SFTP_REQUEST_REQUIRED');
  const operationDirectory = absolute(directory), operation = operationId(basename(operationDirectory));
  need(basename(dirname(operationDirectory)) === 'operations', 'APPLICATION_SFTP_OPERATION_DIRECTORY_INVALID');
  const root = dirname(dirname(operationDirectory)), application = recordId(request.applicationId);
  const run = await readJSON(join(root, 'applications', application, 'runs', operation + '.json'));
  need(run.schema === 'stellar-forge.application-run.v1' && run.applicationId === application &&
    run.id === operation && run.request?.command === request.command &&
    same(run.request.args, request.args), 'APPLICATION_SFTP_REVIEW_CHANGED');
  const review = await readJSON(join(root, 'application-reviews', recordId(run.reviewId) + '.json'));
  const selected = review.command?.sftp;
  need(review.schema === 'stellar-forge.application-start-review.v1' &&
    review.applicationId === application && review.applicationRevision === run.revision &&
    review.releaseId === request.releaseId && review.releaseDigest === request.releaseDigest &&
    review.command?.command === request.command && same(review.command.args, request.args) &&
    same(review.command.environmentSha256 ?? null, request.environmentSha256 ?? null) &&
    plain(selected) && selected.schema === PREPARATION &&
    plain(selected.binding) && HASH.test(selected.binding.sha256 ?? '') &&
    plain(selected.source) && HASH.test(selected.source.sha256 ?? ''),
  'APPLICATION_SFTP_REVIEW_CHANGED', 'Reconcile the original saved application start review.');
  const args = request.args, positions = args.flatMap((value, index) => value === '--state' ? [index] : []);
  need(positions.length === 1 && args[positions[0] + 1] === selected.binding.directory,
    'APPLICATION_SFTP_REVIEW_CHANGED');
  return { operation, application, review, selected };
}

export async function verifySftpApplicationLaunch(request, directory) {
  const reviewed = await reviewedSftpApplication(request, directory), { selected } = reviewed;
  const binding = await inspectSftpApplicationWorkspace(selected.binding.directory,
    { expectedIdentity: selected.binding.sha256 });
  need(binding.currentSha256 === selected.binding.currentSha256,
    'APPLICATION_SFTP_INPUTS_CHANGED', 'Review the current saved source, products and customer files before starting.');
  await inspectSftpApplicationSource(selected.source.sourceRoot, { expectedSha256: selected.source.sha256 });
  await inspectSftpApplicationSource(join(absolute(request.releaseDirectory), 'source'),
    { expectedSha256: selected.source.sha256 });
  return { ...reviewed, binding };
}

async function liveState(url) {
  const response = await fetch(new URL('/api/state', url), {
    redirect: 'error', headers: { authorization: 'Bearer ' + url.hash.slice(1) },
    signal: AbortSignal.timeout(10000),
  });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
    'APPLICATION_SFTP_STARTUP_UNAVAILABLE', 'The original authenticated SFTP listener is unavailable.');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    need(length <= 8 * 1024 * 1024, 'APPLICATION_SFTP_STARTUP_INVALID');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { need(false, 'APPLICATION_SFTP_STARTUP_INVALID'); }
}

function privateUrl(value, tokenRequired = false) {
  let url;
  try { url = new URL(value); } catch { need(false, 'APPLICATION_SFTP_STARTUP_INVALID'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    (!tokenRequired || /^#[A-Za-z0-9_-]{43}$/.test(url.hash)), 'APPLICATION_SFTP_STARTUP_INVALID');
  return url;
}

export async function sftpApplicationStartup(request, text, directory, context = {}) {
  if (request.command !== 'sftp-workspace' || typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{"sftpWorkspace":')) return null;
  let announcement;
  try { announcement = JSON.parse(text); } catch { return null; }
  if (!plain(announcement) || typeof announcement.sftpWorkspace !== 'string') return null;
  const reviewed = await verifySftpApplicationLaunch(request, directory), { selected, binding } = reviewed;
  need(announcement.directory === binding.directory, 'APPLICATION_SFTP_STARTUP_CHANGED');
  const url = privateUrl(announcement.sftpWorkspace, true);
  const ports = request.args.flatMap((value, index) => value === '--port' ? [index] : []);
  need(ports.length === 1 && /^(0|[1-9]\d{0,4})$/.test(request.args[ports[0] + 1] ?? '') &&
    (request.args[ports[0] + 1] === '0' || Number(request.args[ports[0] + 1]) === Number(url.port || 80)),
  'APPLICATION_SFTP_STARTUP_CHANGED');
  const state = await liveState(url);
  need(plain(state) && state.schema === WORKSPACE && state.directory === binding.directory &&
    state.revision === binding.current.revision && state.sourceHash === binding.current.sourceHash &&
    Array.isArray(state.publications) && state.publications.length === binding.current.publications.length,
  'APPLICATION_SFTP_STARTUP_CHANGED', 'The live original workbench differs from the selected saved source.');
  const links = [];
  for (const publication of binding.current.publications) {
    const live = state.publications.find(value => value.id === publication.id);
    need(live && ['query', 'path', 'revision', 'sourceRevisionId', 'sourceHash', 'merchantHash', 'publicationSourceHash']
      .every(name => live[name] === publication[name]), 'APPLICATION_SFTP_STARTUP_CHANGED');
    const consoleUrl = privateUrl(live.consoleUrl);
    if (links.length < 20) links.push({ id: publication.id, label: publication.query + ' publication', url: consoleUrl.href });
  }
  const current = await inspectSftpApplicationWorkspace(binding.directory, { expectedIdentity: binding.sha256 });
  need(current.currentSha256 === binding.currentSha256, 'APPLICATION_SFTP_STARTUP_CHANGED');
  return { url: url.href, links, original: {
    schema: STARTUP, directory: binding.directory, workspaceIdentity: binding.sha256,
    createdAt: binding.createdAt, revision: binding.current.revision,
    sourceHash: binding.current.sourceHash, sourceRevisionId: binding.current.sourceRevisionId,
    sourceRoot: selected.source.sourceRoot, executedSourceRoot: join(request.releaseDirectory, 'source'),
    sourceSha256: selected.source.sha256, sourceFiles: selected.source.files,
    ...(Number.isSafeInteger(context.pid) && context.pid > 0 ? { pid: context.pid } : {}),
    requiredEnvironment: binding.current.requiredEnvironment,
    publications: binding.current.publications,
  } };
}
