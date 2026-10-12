// MIT. Receive original public-source bodies through the existing CKAN capture engine.
import { join, resolve, dirname } from 'node:path';
import { lstat, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { captureCkanResource, captureSelection, parseCkanJson } from './capture.mjs';
import { bytes, createFile, digest, fault, identity, privateDirectory, readPrivate,
  syncDirectory } from '../postgres/publisher/files.mjs';

const HASH = /^[a-f0-9]{64}$/;
const SOURCE = /^(package|resource|resource-after|schema|schema-after)\.json$|^pages\/\d{8}\.json$/;
const MAX_BUNDLE = 100663296;
const requireValue = (value, code, message) => { if (!value) throw fault(code, message); };
const exists = async file => {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const sameBytes = (raw, item) => raw.length === item.bytes && digest(raw) === item.sha256;

// Atomic, exclusive companion creation; an interrupted temporary file can never
// become the next run's accepted source receipt or binding.
async function retain(directory, name, raw) {
  const target = join(directory, name);
  if (await exists(target)) {
    requireValue((await readPrivate(target, MAX_BUNDLE)).equals(raw),
      'CKAN_SOURCE_RECEIVING_CHANGED', 'Use the original source bundle and receiving directory.');
    return;
  }
  const temporary = join(directory, '.source-pending-' + randomUUID());
  try {
    await createFile(temporary, raw);
    try { await link(temporary, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireValue((await readPrivate(target, MAX_BUNDLE)).equals(raw),
        'CKAN_SOURCE_RECEIVING_CHANGED', 'The receiving directory belongs to another source bundle.');
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  await syncDirectory(directory);
}

/**
 * Receive a complete commons.source-bundle/v1 acquired by connected_public_source.
 * The source engine receives literal saved bytes through its normal fetch option.
 * Reuse this bundle and directory to continue the original capture.
 */
export async function receivePublicSourceCapture({
  bundleFile, bundleBytes, bundleSha256, operationId, selection, captureDirectory,
}, options = {}) {
  requireValue(Number.isSafeInteger(bundleBytes) && bundleBytes > 0 && bundleBytes <= MAX_BUNDLE &&
    HASH.test(bundleSha256 ?? '') && typeof operationId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(operationId),
  'CKAN_SOURCE_BUNDLE_IDENTITY_REQUIRED', 'Provide the original operation ID, complete bundle byte count and SHA-256.');
  const config = captureSelection(selection);
  requireValue(!config.authTokenEnv, 'CKAN_PUBLIC_SOURCE_REQUIRED',
    'This receiving path consumes public source responses without an API token.');
  bundleFile = resolve(bundleFile); captureDirectory = resolve(captureDirectory);
  await privateDirectory(dirname(bundleFile));
  const bundleRaw = await readPrivate(bundleFile, bundleBytes);
  requireValue(sameBytes(bundleRaw, { bytes: bundleBytes, sha256: bundleSha256 }),
    'CKAN_SOURCE_BUNDLE_CHANGED', 'The complete source bundle differs from its original identity.');
  const bundle = parseCkanJson(bundleRaw);
  requireValue(bundle.schema === 'commons.source-bundle/v1' &&
    bundle.scope?.operation_id === operationId &&
    bundle.scope?.transport === 'notion_public_https_file_import' &&
    Array.isArray(bundle.files) && bundle.files.length >= 5 && bundle.files.length <= 257,
  'CKAN_SOURCE_BUNDLE_INVALID', 'Use the complete connected public-source bundle for this operation.');

  const members = new Map();
  for (const item of bundle.files) {
    requireValue((SOURCE.test(item.path ?? '') || item.path === 'public-source-receipt.json') &&
      !members.has(item.path) && Number.isSafeInteger(item.bytes) && item.bytes > 0 &&
      item.bytes <= 67108864 && HASH.test(item.sha256 ?? '') &&
      item.encoding === 'base64' && typeof item.content === 'string',
    'CKAN_SOURCE_MEMBER_INVALID', 'The source bundle contains an invalid or repeated member.');
    const raw = Buffer.from(item.content, 'base64');
    requireValue(raw.toString('base64') === item.content && sameBytes(raw, item),
      'CKAN_SOURCE_MEMBER_CHANGED', 'An original source member differs: ' + item.path);
    members.set(item.path, { ...item, raw });
  }
  const receiptMember = members.get('public-source-receipt.json');
  requireValue(receiptMember, 'CKAN_SOURCE_RECEIPT_MISSING', 'Retain the complete acquisition receipt.');
  const receipt = parseCkanJson(receiptMember.raw);
  requireValue(receipt.schema === 'commons.connected_public_source_receipt/v1' &&
    receipt.state === 'COMPLETE' && receipt.request_id === operationId &&
    Number.isSafeInteger(receipt.requested_sources) && receipt.requested_sources > 0 &&
    receipt.received_sources === receipt.requested_sources &&
    Array.isArray(receipt.sources) && receipt.sources.length === receipt.received_sources &&
    members.size === receipt.sources.length + 1,
  'CKAN_SOURCE_ACQUISITION_INCOMPLETE', 'Receive all original source responses before the native capture.');
  const sources = new Map();
  for (const item of receipt.sources) {
    const member = members.get(item.path);
    let address;
    try { address = new URL(item.source_url); } catch { throw fault('CKAN_SOURCE_URL_INVALID'); }
    const upload = item.upload, download = item.download;
    requireValue(member && SOURCE.test(item.path) && !sources.has(item.path) &&
      item.bytes === member.bytes && item.sha256 === member.sha256 &&
      address.origin === config.catalogOrigin && !address.username && !address.password && !address.hash &&
      item.transport === 'notion_public_https_file_import' &&
      upload?.metadata?.status === 'uploaded' && typeof upload.metadata.file_upload_id === 'string' &&
      upload.metadata.file_upload_id.length > 0 &&
      upload.request?.source_url === item.source_url &&
      upload.metadata.file_upload_id === download?.metadata?.file_upload_id &&
      download.request?.file_upload_id === upload.metadata.file_upload_id &&
      download.content_file?.path === item.path && download.content_file?.bytes === member.bytes &&
      download.content_file?.sha256 === member.sha256 &&
      item.upstream_http_status === null && item.upstream_http_headers === null,
    'CKAN_SOURCE_RECEIPT_CHANGED', 'The original source and carrier receipt differ: ' + item.path);
    sources.set(item.path, { ...item, raw: member.raw });
  }
  const pageNames = [...sources.keys()].filter(name => name.startsWith('pages/')).sort();
  requireValue(pageNames.length > 0 && pageNames.every((name, index) =>
    name === 'pages/' + String(index).padStart(8, '0') + '.json'),
  'CKAN_SOURCE_PAGE_MISSING', 'Retain every original page in capture order.');
  const order = ['package.json', 'resource.json', ...(config.schemaUrl ? ['schema.json'] : []),
    ...pageNames, 'resource-after.json', ...(config.schemaUrl ? ['schema-after.json'] : [])];
  requireValue(order.length === sources.size && order.every(name => sources.has(name)),
    'CKAN_SOURCE_SELECTION_INCOMPLETE', 'Retain the package, resource, pages and independent following metadata.');

  await privateDirectory(dirname(captureDirectory));
  await privateDirectory(captureDirectory, true);
  const inputBinding = {
    schema: 'stellar-forge.ckan-public-source-input.v1', operationId,
    sourceBundle: { bytes: bundleBytes, sha256: bundleSha256 },
    sourceReceipt: { file: 'source-acquisition.json', bytes: receiptMember.bytes, sha256: receiptMember.sha256 },
    selectionHash: identity(config), transport: 'notion_public_https_file_import',
  };
  await retain(captureDirectory, 'source-input.json', bytes(inputBinding));
  await retain(captureDirectory, 'source-acquisition.json', receiptMember.raw);

  // Build the remaining sequence only when the original engine owns its capture
  // lock. Read actual files as well as progress: a process can stop after saving
  // a body and before its progress projection.
  let pending;
  const initialState = await exists(join(captureDirectory, 'capture.json')) ||
    await exists(join(captureDirectory, 'progress.json'));
  if (!initialState) for (const name of order)
    requireValue(!await exists(join(captureDirectory, name)), 'CKAN_CAPTURE_STATE_MISSING',
      'Use the original capture progress for previously saved response files.');
  const transport = async (url, request) => {
    requireValue(request.method === 'GET' && !request.headers?.authorization,
      'CKAN_PUBLIC_SOURCE_REQUIRED', 'Receive the original public selection.');
    request.signal?.throwIfAborted();
    if (!pending) {
      pending = [];
      for (const name of order) {
        const item = sources.get(name), file = join(captureDirectory, name);
        if (await exists(file)) requireValue(sameBytes(await readPrivate(file, item.bytes), item),
          'CKAN_RETAINED_PAGE_CHANGED', 'The interrupted capture belongs to another source response.');
        else pending.push(item);
      }
    }
    const item = pending.shift();
    requireValue(item && new URL(item.source_url).href === new URL(url).href,
      'CKAN_SOURCE_REQUEST_CHANGED', 'The capture engine requested a different source selection or page.');
    // Success belongs to the retained import/body. The connector omitted
    // upstream status and headers, which remain absent in the native receipt.
    return { ok: true, status: null, headers: { get: () => null },
      body: { async *[Symbol.asyncIterator]() { yield item.raw; } } };
  };
  const capture = await captureCkanResource(config, captureDirectory, {
    ...options, fetch: transport,
  });
  requireValue((!pending || pending.length === 0) && capture.manifest.files.length === sources.size,
    'CKAN_SOURCE_SELECTION_UNUSED', 'The native capture must consume the complete original selection.');
  for (const item of capture.manifest.files) {
    const source = sources.get(item.file);
    requireValue(source && source.sha256 === item.sha256 && source.bytes === item.bytes,
      'CKAN_RETAINED_PAGE_CHANGED', 'The native capture differs from the original received bytes.');
  }
  const binding = {
    ...inputBinding, schema: 'stellar-forge.ckan-public-source-receiving.v1',
    capture: { file: 'capture.json', manifestSha256: capture.manifestSha256,
      rows: capture.rows.length, pages: capture.manifest.pages.length },
    upstreamHttpMetadata: 'not_returned_by_this_connector',
  };
  await retain(captureDirectory, 'source-acquisition-binding.json', bytes(binding));
  return { capture, binding,
    locator: { file: capture.manifestFile, manifestSha256: capture.manifestSha256 } };
}
