// MIT. Receive a complete original Intrinio customer through its native listener.
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importIntrinioWorkspace, inspectIntrinioWorkspace, writeNewOutput } from '../workspace.mjs';
import { prepareIntrinioManagedSelection, startManagedIntrinioWorkspace,
  verifyIntrinioManagedStartup } from '../managed.mjs';
import { parseIndex, INDEX_PATH } from '../public/data.mjs';
import { absolute, need, privateDirectory, regular, digest, json } from '../../../distribution/runtime-workspace/storage.mjs';

const EXPORT_SCHEMA = 'stellar-forge.python-workspace-export.v1';
const LIMIT = 256 * 1024 * 1024;
const FORMATS = { export_selection_json: 'json', export_selection_csv: 'csv', export_selection_html: 'html' };

export async function restoreIntrinioCustomer({ bundleFile, workspaceDirectory }) {
  const bytes = await regular(absolute(bundleFile), LIMIT), original = JSON.parse(bytes.toString('utf8'));
  need(original.schema === EXPORT_SCHEMA && original.workspace?.metadata && Array.isArray(original.blobs),
    'INTRINIO_RECEIVING_EXPORT_REQUIRED');
  const sha256 = digest(bytes);
  let snapshot;
  try { snapshot = await inspectIntrinioWorkspace(absolute(workspaceDirectory)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const workspace = await importIntrinioWorkspace(workspaceDirectory, bytes);
    try { snapshot = await workspace.state(); snapshot.workspace = snapshot.native.workspace; }
    finally { await workspace.close(); }
  }
  need(snapshot.workspace.id === original.workspace.metadata.id &&
    snapshot.workspace.importSha256 === sha256, 'INTRINIO_RECEIVING_SOURCE_CHANGED');
  return { original, bundle: { path: bundleFile, bytes: bytes.length, sha256 }, snapshot };
}
async function privateOutput(directory) {
  directory = absolute(directory);
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(directory);
}
async function output(path, bytes) {
  try { await writeNewOutput(path, bytes); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await regular(path, LIMIT);
    need(existing.equals(bytes), 'INTRINIO_RECEIVING_OUTPUT_CHANGED');
  }
  return { path, bytes: bytes.length, sha256: digest(bytes) };
}
async function getBytes(operatorUrl, path, limit = LIMIT) {
  const url = new URL(operatorUrl);
  need(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    !url.username && !url.password && !url.search && /^#[a-f0-9]{64}$/.test(url.hash),
  'INTRINIO_RECEIVING_LOCAL_URL_REQUIRED');
  const response = await fetch(new URL(path, url.origin), {
    headers: { 'x-python-workspace-token': url.hash.slice(1) }, redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  need(response.ok, 'INTRINIO_RECEIVING_HTTP_FAILED', 'Original workspace returned HTTP ' + response.status);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; need(size <= limit, 'INTRINIO_RECEIVING_OUTPUT_LIMIT');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size), returned = response.headers.get('x-content-sha256');
  if (returned) need(returned === digest(bytes), 'INTRINIO_RECEIVING_DOWNLOAD_CHANGED');
  return bytes;
}
const getJson = async (url, path) => JSON.parse((await getBytes(url, path)).toString('utf8'));
export function verifyIntrinioCustomerArchive(original, restored) {
  need(restored.schema === EXPORT_SCHEMA && restored.workspace?.metadata?.id === original.workspace.metadata.id,
    'INTRINIO_RECEIVING_WORKSPACE_CHANGED');
  const revisions = new Map(restored.workspace.revisions.map(row => [row.id, row]));
  for (const revision of original.workspace.revisions)
    need(revisions.get(revision.id)?.digest === revision.digest, 'INTRINIO_RECEIVING_REVISION_MISSING');
  const blobs = new Map(restored.blobs.map(blob => [blob.sha256, blob]));
  for (const originalBlob of original.blobs) {
    const blob = blobs.get(originalBlob.sha256);
    need(blob?.bytes === originalBlob.bytes && blob.base64 === originalBlob.base64 &&
      digest(Buffer.from(blob.base64, 'base64')) === blob.sha256,
    'INTRINIO_RECEIVING_ORIGINAL_BYTES_CHANGED');
  }
  const previews = new Map(restored.workspace.previews.map(row => [row.id, row]));
  for (const originalPreview of original.workspace.previews.filter(row => row.status === 'COMPLETED'))
    need(previews.get(originalPreview.id)?.status === 'COMPLETED' &&
      previews.get(originalPreview.id)?.result?.sha256 === originalPreview.result?.sha256,
    'INTRINIO_RECEIVING_PREVIEW_CHANGED');
  const releases = new Map(restored.releaseStore.releases.map(row => [row.id, row]));
  for (const release of original.releaseStore.releases)
    need(JSON.stringify(releases.get(release.id)?.files) === JSON.stringify(release.files),
      'INTRINIO_RECEIVING_RELEASE_CHANGED');
  const customers = new Map(restored.customerFiles.map(row => [row.id, row]));
  for (const customer of original.customerFiles)
    need(JSON.stringify(customers.get(customer.id)?.files) === JSON.stringify(customer.files),
      'INTRINIO_RECEIVING_CUSTOMER_CHANGED');
  return { revisions: original.workspace.revisions.length, blobs: original.blobs.length,
    previews: original.workspace.previews.length, releases: original.releaseStore.releases.length,
    customerExports: original.customerFiles.length };
}

/** Download all retained customer selections and the complete original recovery archive. */
export async function receiveIntrinioCustomerSession({ startup, selection, original, outputDirectory }) {
  outputDirectory = await privateOutput(outputDirectory);
  const verified = await verifyIntrinioManagedStartup(startup, {
    selection, sourceRoot: startup.binding.sourceRoot, pid: startup.binding.pid,
  });
  const state = await getJson(verified.url, '/api/state');
  const file = await getJson(verified.url, '/api/file?revision=' +
    encodeURIComponent(state.workspace.head) + '&path=' + encodeURIComponent(INDEX_PATH));
  const index = parseIndex(file);
  const root = startup.binding.sourceRoot, product = 'stellar/scf-starforge-20261009/sf30-seller-sdk/intrinio/';
  for (const [url, path] of [
    ['/intrinio', 'public/index.html'], ['/intrinio/app.mjs', 'public/app.mjs'],
    ['/intrinio/data.mjs', 'public/data.mjs'], ['/intrinio/style.css', 'public/style.css'],
  ]) {
    const bytes = await getBytes(verified.url, url, 2 * 1024 * 1024);
    const expected = await regular(join(root, product + path), 2 * 1024 * 1024);
    need(bytes.equals(expected), 'INTRINIO_RECEIVING_BROWSER_SOURCE_CHANGED');
  }
  const customerOutputs = [];
  for (const preview of original.workspace.previews) {
    const format = FORMATS[preview.function];
    if (!format || preview.status !== 'COMPLETED' || !preview.result) continue;
    const bytes = await getBytes(verified.url, '/api/preview-output?id=' + encodeURIComponent(preview.id));
    need(bytes.length === preview.result.bytes && digest(bytes) === preview.result.sha256,
      'INTRINIO_RECEIVING_CUSTOMER_OUTPUT_CHANGED');
    customerOutputs.push({ previewId: preview.id, format,
      ...await output(join(outputDirectory, preview.id + '.' + format), bytes) });
  }
  const receivedBytes = await getBytes(verified.url, '/api/export');
  const received = JSON.parse(receivedBytes.toString('utf8'));
  const retained = verifyIntrinioCustomerArchive(original, received);
  const archivePath = join(outputDirectory, 'intrinio.python-workspace.json');
  let archive;
  try {
    const existing = await regular(archivePath, LIMIT);
    verifyIntrinioCustomerArchive(original, JSON.parse(existing.toString('utf8')));
    archive = { path: archivePath, bytes: existing.length, sha256: digest(existing) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    archive = await output(archivePath, receivedBytes);
  }
  return {
    workspaceId: state.workspace.id, head: state.workspace.head,
    selectedRevision: selection.revision.id, sourceSha256: selection.source.sha256,
    instanceId: startup.binding.instanceId, pid: startup.binding.pid,
    editions: index.document.editions.length, sourceViews: Object.keys(index.editions).length,
    reviewedFacts: index.document.reviews.length,
    savedReviews: Object.keys(index.document.operator?.reviews ?? {}).length,
    projections: Object.keys(index.projections ?? {}).length,
    retained, customerOutputs, archive,
  };
}

/** Complete two source-native Start/Open/Stop cycles on the same restored customer. */
export async function receiveIntrinioNativeCustomer({ bundleFile, workspaceDirectory, outputDirectory, port = 0 }) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INTRINIO_RECEIVING_PORT_INVALID');
  const restored = await restoreIntrinioCustomer({ bundleFile, workspaceDirectory });
  await privateOutput(outputDirectory);
  const sessions = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    const selection = await prepareIntrinioManagedSelection(workspaceDirectory);
    const server = await startManagedIntrinioWorkspace(workspaceDirectory, { selection, port });
    try {
      sessions.push(await receiveIntrinioCustomerSession({
        startup: server.startup, selection, original: restored.original, outputDirectory,
      }));
    } finally { await server.close(); await server.closed; }
    const reopened = await inspectIntrinioWorkspace(workspaceDirectory);
    need(reopened.workspace.id === restored.original.workspace.metadata.id,
      'INTRINIO_RECEIVING_REOPEN_CHANGED');
  }
  need(sessions[0].instanceId !== sessions[1].instanceId, 'INTRINIO_RECEIVING_INSTANCE_REUSED');
  const report = { schema: 'stellar-forge.intrinio-native-customer-receiving.v1',
    completedAt: new Date().toISOString(), input: restored.bundle, workspaceDirectory, sessions };
  await writeNewOutput(join(outputDirectory, 'native-customer-' + sessions[0].instanceId + '.json'), Buffer.from(json(report)));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length < 3 || args.length > 4) {
    process.stdout.write('Usage: starforge intrinio-receive BUNDLE_JSON PRIVATE_WORKSPACE PRIVATE_OUTPUT [PORT]\n');
    if (!args.includes('--help')) process.exitCode = 2;
  } else {
  const [bundleFile, workspaceDirectory, outputDirectory, port = '0'] = args;
  receiveIntrinioNativeCustomer({ bundleFile, workspaceDirectory, outputDirectory, port: Number(port) })
    .then(result => process.stdout.write(json(result)))
    .catch(error => { process.stderr.write(json({ error: error.code ?? 'INTRINIO_RECEIVING', message: error.message })); process.exitCode = 1; });
  }
}
