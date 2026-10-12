// MIT. Portable processing history composes the original STAC handover.
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, exists, need, intent }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { canonicalJson, sha256 } from '../provider.mjs';

const SCHEMA = 'scf-stac-processing-handover/v1';
const PACK = 'scf-stac-processing-packed/v1';
const MAX_FILE = 128 * 1024 * 1024, MAX_TOTAL = 512 * 1024 * 1024;
const stamp = () => new Date().toISOString();
const digest = value => sha256(canonicalJson(value));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const pathName = value => {
  need(typeof value === 'string' && value.length <= 2048 &&
    value.split('/').every(p => /^[A-Za-z0-9._-]+$/.test(p) && !['.', '..'].includes(p)),
    'PROCESSING_HANDOVER_PATH_INVALID'); return value;
};
function selectPayload(state, selected) {
  const ids = new Set(selected); let expanded = true;
  while (expanded) {
    expanded = false;
    for (const id of [...ids]) {
      const edition = state.editions.find(v => v.id === id);
      need(edition, 'PROCESSING_HANDOVER_EDITION_NOT_FOUND');
      if (edition.selection.inventoryId && !ids.has(edition.selection.inventoryId)) {
        ids.add(edition.selection.inventoryId); expanded = true;
      }
    }
  }
  const editions = state.editions.filter(v => ids.has(v.id));
  need(editions.length > 0 && editions.every(v => !v.lease), 'PROCESSING_HANDOVER_ACTIVE_CAPTURE');
  const deploymentKeys = new Set(editions.map(v => v.deploymentKey));
  const reviewIds = new Set(editions.map(v => v.selection.reviewId).filter(Boolean));
  const associations = state.associations.filter(v => ids.has(v.editionId));
  const associationIds = new Set(associations.map(v => v.id));
  return { schema: state.schema, sourceWorkspaceId: state.id,
    deployments: state.deployments.filter(v => deploymentKeys.has(v.key)),
    reviews: state.reviews.filter(v => reviewIds.has(v.id)), editions, associations,
    operations: Object.fromEntries(Object.entries(state.operations).filter(([, v]) =>
      ids.has(v.editionId) || reviewIds.has(v.reviewId) || associationIds.has(v.associationId))) };
}
async function sameFile(path, bytes) {
  await privateDirectory(dirname(path));
  if (await exists(path)) need((await readBytes(path, bytes.length)).equals(bytes), 'PROCESSING_HANDOVER_DESTINATION_CONFLICT');
  else await writeBytes(path, bytes, { exclusive: true });
}
async function verifyManifest(directory, manifest) {
  need(manifest?.schema === SCHEMA && Array.isArray(manifest.files) && manifest.files.length <= 1000000,
    'PROCESSING_HANDOVER_INVALID');
  const { digest: expected, ...core } = manifest;
  need(expected === digest(core), 'PROCESSING_HANDOVER_DIGEST_MISMATCH');
  const names = new Set(); let total = 0;
  for (const file of manifest.files) {
    pathName(file.path); need(!names.has(file.path), 'PROCESSING_HANDOVER_DUPLICATE_PATH'); names.add(file.path);
    need(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_FILE &&
      /^[a-f0-9]{64}$/.test(file.sha256), 'PROCESSING_HANDOVER_FILE_METADATA_INVALID');
    total += file.bytes; need(total <= MAX_TOTAL, 'PROCESSING_HANDOVER_TOTAL_TOO_LARGE');
    const bytes = await readBytes(join(directory, file.path), file.bytes);
    need(bytes.length === file.bytes && sha256(bytes) === file.sha256, 'PROCESSING_HANDOVER_FILE_CHANGED');
  }
  need(names.has('processing-state.json') && total === manifest.bytes, 'PROCESSING_HANDOVER_STATE_OR_SIZE_INVALID');
  return { names, bytes: total };
}

export async function exportProcessingHandover(workspace, { editionIds, directory: destination,
  operationId, includeStacAssets = false } = {}) {
  need(workspace?.directory && typeof workspace.getState === 'function', 'PROCESSING_WORKSPACE_REQUIRED');
  need(typeof destination === 'string' && destination.length > 0, 'PROCESSING_HANDOVER_DIRECTORY_REQUIRED');
  destination = resolve(destination);
  const original = resolve(workspace.directory);
  need(destination !== original && !destination.startsWith(original + '/'),
    'PROCESSING_HANDOVER_SEPARATE_DIRECTORY_REQUIRED');
  const state = await workspace.getState();
  const selected = editionIds ?? state.editions.map(v => v.id);
  need(Array.isArray(selected) && selected.length && selected.every(v => typeof v === 'string'),
    'PROCESSING_HANDOVER_SELECTION_REQUIRED');
  const payload = selectPayload(state, [...new Set(selected)]), payloadHash = digest(payload);
  const selection = { payloadHash, includeStacAssets: Boolean(includeStacAssets) };
  const manifestPath = join(destination, 'manifest.json'), planPath = join(destination, 'export-plan.json');
  await privateDirectory(destination);
  if (await exists(manifestPath)) {
    const manifest = await readJson(manifestPath, MAX_FILE);
    need(manifest.selectionHash === digest(selection), 'PROCESSING_HANDOVER_SELECTION_CHANGED');
    await verifyManifest(destination, manifest);
    return { directory: destination, manifest };
  }
  let plan;
  if (await exists(planPath)) {
    plan = await readJson(planPath);
    need(plan.selectionHash === digest(selection), 'PROCESSING_HANDOVER_SELECTION_CHANGED');
    if (operationId) need(plan.operationId === intent(operationId), 'PROCESSING_HANDOVER_OPERATION_CHANGED');
  } else {
    need((await readdir(destination)).length === 0, 'PROCESSING_HANDOVER_NEW_DIRECTORY_REQUIRED');
    plan = { operationId: operationId ? intent(operationId) : 'export-' + randomUUID().replaceAll('-', ''),
      selectionHash: digest(selection), createdAt: stamp() };
    await writeJson(planPath, plan, { exclusive: true });
  }
  const paths = new Set(payload.deployments.map(v => pathName(v.source.path)));
  for (const edition of payload.editions) for (const task of edition.tasks) {
    for (const page of task.pages) {
      const captured = await workspace.readCapture(page.directory);
      need(captured && captured.record.sha256 === page.sha256, 'PROCESSING_HANDOVER_CAPTURE_CHANGED');
    }
    const directories = new Set([...task.attempts, ...(task.pending ? [task.pending] : []), ...task.pages].map(v => v.directory));
    for (const directory of directories) {
      pathName(directory); need(directory.startsWith('captures/'), 'PROCESSING_HANDOVER_CAPTURE_PATH_INVALID');
      for (const name of ['request.json', 'response-head.json', 'response.bin', 'response.json', 'error.json']) {
        const path = directory + '/' + name;
        if (await exists(join(original, path))) paths.add(path);
      }
    }
  }
  const files = []; let bytesTotal = 0;
  async function retain(path, bytes) {
    pathName(path); bytesTotal += bytes.length;
    need(bytes.length <= MAX_FILE && bytesTotal <= MAX_TOTAL, 'PROCESSING_HANDOVER_TOTAL_TOO_LARGE');
    await sameFile(join(destination, path), bytes);
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  for (const path of [...paths].sort()) await retain(path, await readBytes(join(original, path), MAX_FILE));
  await retain('processing-state.json', jsonBytes(payload));
  const stacIds = [...new Set(payload.editions.map(v => v.selection.stac?.editionId).filter(Boolean))];
  let stac = null;
  if (stacIds.length) {
    need(workspace.stacWorkspace, 'PROCESSING_ORIGINAL_STAC_WORKSPACE_REQUIRED');
    const bundle = await workspace.stacWorkspace.exportHandover({ editionIds: stacIds, includeAssets: Boolean(includeStacAssets) });
    const packed = gzipSync(jsonBytes(bundle), { level: 6, mtime: 0 });
    await retain('stac-handover.json.gz', packed);
    stac = { path: 'stac-handover.json.gz', encoding: 'gzip', digest: bundle.digest,
      sourceWorkspaceId: bundle.sourceWorkspaceId, editionIds: stacIds, includeAssets: Boolean(includeStacAssets) };
  }
  need(digest(selectPayload(await workspace.getState(), [...new Set(selected)])) === payloadHash,
    'PROCESSING_HANDOVER_SOURCE_ADVANCED');
  const core = { schema: SCHEMA, operationId: plan.operationId, createdAt: plan.createdAt,
    sourceWorkspaceId: state.id, selectionHash: plan.selectionHash, payloadHash,
    editionIds: payload.editions.map(v => v.id), requestedEditionIds: [...new Set(selected)],
    deployments: payload.deployments.map(v => ({ key: v.key, fingerprint: v.fingerprint, sourceSha256: v.source.sha256 })),
    stac, files: files.sort((a, b) => a.path.localeCompare(b.path)), bytes: bytesTotal };
  const manifest = { ...core, digest: digest(core) };
  await writeJson(manifestPath, manifest, { exclusive: true });
  await verifyManifest(destination, manifest);
  return { directory: destination, manifest };
}

export async function readProcessingHandover({ directory } = {}) {
  directory = await privateDirectory(directory, { create: false });
  const manifest = await readJson(join(directory, 'manifest.json'), MAX_FILE);
  const checked = await verifyManifest(directory, manifest);
  const read = async path => {
    const file = manifest.files.find(v => v.path === path); need(file, 'PROCESSING_HANDOVER_MEMBER_NOT_FOUND');
    const bytes = await readBytes(join(directory, pathName(path)), file.bytes);
    need(bytes.length === file.bytes && sha256(bytes) === file.sha256, 'PROCESSING_HANDOVER_FILE_CHANGED'); return bytes;
  };
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('processing-state.json')));
  need(payload.schema === 'scf-stac-processing-workspace/v1' && digest(payload) === manifest.payloadHash &&
    payload.sourceWorkspaceId === manifest.sourceWorkspaceId, 'PROCESSING_HANDOVER_PAYLOAD_CHANGED');
  for (const field of ['deployments', 'reviews', 'editions', 'associations'])
    need(Array.isArray(payload[field]), 'PROCESSING_HANDOVER_STATE_INVALID');
  need(payload.editions.every(v => !v.lease) && payload.operations && typeof payload.operations === 'object',
    'PROCESSING_HANDOVER_ACTIVE_CAPTURE');
  const editionIds = new Set(payload.editions.map(v => v.id)), deploymentKeys = new Set(payload.deployments.map(v => v.key));
  need(editionIds.size === payload.editions.length && canonicalJson([...editionIds].sort()) === canonicalJson([...manifest.editionIds].sort()),
    'PROCESSING_HANDOVER_EDITION_IDENTITY_INVALID');
  for (const deployment of payload.deployments) need(checked.names.has(deployment.source.path),
    'PROCESSING_HANDOVER_SOURCE_MISSING');
  for (const edition of payload.editions) {
    need(deploymentKeys.has(edition.deploymentKey), 'PROCESSING_HANDOVER_DEPLOYMENT_MISSING');
    if (edition.selection.inventoryId) need(editionIds.has(edition.selection.inventoryId), 'PROCESSING_HANDOVER_INVENTORY_MISSING');
    for (const task of edition.tasks) for (const page of task.pages)
      need(checked.names.has(page.directory + '/response.bin') && checked.names.has(page.directory + '/request.json'),
        'PROCESSING_HANDOVER_CAPTURE_MISSING');
  }
  let stac = null;
  if (manifest.stac) {
    need(manifest.stac.encoding === 'gzip' && checked.names.has(manifest.stac.path), 'PROCESSING_HANDOVER_STAC_SOURCE_MISSING');
    const raw = gunzipSync(await read(manifest.stac.path), { maxOutputLength: MAX_TOTAL });
    stac = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    need(stac.digest === manifest.stac.digest && stac.sourceWorkspaceId === manifest.stac.sourceWorkspaceId,
      'PROCESSING_HANDOVER_STAC_IDENTITY_CHANGED');
  }
  return { directory, manifest, payload, stac, read };
}

export async function importProcessingHandover(workspace, { directory, operationId } = {}) {
  need(workspace?._mergePortable, 'PROCESSING_WORKSPACE_REQUIRED');
  const opened = await readProcessingHandover({ directory }), { manifest, payload } = opened;
  const state = await workspace.getState(), prior = state.imports.find(v => v.digest === manifest.digest);
  if (prior) return prior;
  for (const field of ['deployments', 'reviews', 'editions', 'associations']) for (const value of payload[field]) {
    const key = field === 'deployments' ? 'key' : 'id', current = state[field].find(v => v[key] === value[key]);
    need(!current || digest(current) === digest(value), 'PROCESSING_PORTABLE_IDENTITY_CONFLICT');
  }
  for (const [key, value] of Object.entries(payload.operations))
    need(!state.operations[key] || digest(state.operations[key]) === digest(value), 'PROCESSING_PORTABLE_OPERATION_CONFLICT');
  if (opened.stac) need(workspace.stacWorkspace, 'PROCESSING_ORIGINAL_STAC_WORKSPACE_REQUIRED');
  for (const file of manifest.files.filter(v => /^(sources|captures)\//.test(v.path)))
    await sameFile(join(workspace.directory, pathName(file.path)), await opened.read(file.path));
  const stacReceipt = opened.stac ? await workspace.stacWorkspace.importHandover(opened.stac) : null;
  const receipt = { id: 'processing-import-' + manifest.digest.slice(0, 24), digest: manifest.digest,
    operationId: operationId ? intent(operationId) : manifest.operationId, sourceWorkspaceId: manifest.sourceWorkspaceId,
    editionIds: manifest.editionIds, files: manifest.files.length, bytes: manifest.bytes,
    stac: stacReceipt, completedAt: stamp() };
  await workspace._mergePortable(payload, receipt);
  for (const deployment of payload.deployments) await workspace.sourceFor(deployment.key);
  for (const edition of payload.editions) for (const task of edition.tasks) for (const page of task.pages) {
    const captured = await workspace.readCapture(page.directory);
    need(captured && captured.record.sha256 === page.sha256, 'PROCESSING_IMPORTED_CAPTURE_CHANGED');
  }
  return receipt;
}

// The complete directory form is always available. A compact transfer is opt-in
// and fails visibly if its declared size ceiling is exceeded; no member is omitted.
export async function packProcessingHandover({ directory, maxBytes = 64 * 1024 * 1024 } = {}) {
  need(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_TOTAL, 'PROCESSING_PACK_LIMIT_INVALID');
  const opened = await readProcessingHandover({ directory });
  need(opened.manifest.bytes <= maxBytes, 'PROCESSING_PACK_LIMIT_USE_COMPLETE_DIRECTORY');
  const files = [];
  for (const file of opened.manifest.files) files.push({ path: file.path, contentBase64: (await opened.read(file.path)).toString('base64') });
  const bytes = gzipSync(jsonBytes({ schema: PACK, manifest: opened.manifest, files }), { level: 6, mtime: 0 });
  return { bytes, mime: 'application/gzip', filename: opened.manifest.operationId + '.processing.json.gz',
    sha256: sha256(bytes), manifest: opened.manifest };
}

export async function unpackProcessingHandover({ body, directory } = {}) {
  need(Buffer.isBuffer(body) && body.length > 0 && body.length <= MAX_FILE, 'PROCESSING_PACK_BYTES_INVALID');
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(gunzipSync(body, { maxOutputLength: 768 * 1024 * 1024 })));
  need(document.schema === PACK && document.manifest?.schema === SCHEMA && Array.isArray(document.files),
    'PROCESSING_PACK_SCHEMA_INVALID');
  const { digest: expected, ...core } = document.manifest;
  need(expected === digest(core), 'PROCESSING_PACK_DIGEST_MISMATCH');
  need(document.files.length === document.manifest.files.length, 'PROCESSING_PACK_MEMBER_COUNT_CHANGED');
  const members = new Map(); let total = 0;
  for (const member of document.files) {
    pathName(member.path); need(!members.has(member.path), 'PROCESSING_PACK_DUPLICATE_MEMBER');
    const descriptor = document.manifest.files.find(v => v.path === member.path);
    need(descriptor && typeof member.contentBase64 === 'string' && member.contentBase64.length <= Math.ceil(MAX_FILE / 3) * 4,
      'PROCESSING_PACK_MEMBER_INVALID');
    const bytes = Buffer.from(member.contentBase64, 'base64'); total += bytes.length;
    need(total <= MAX_TOTAL && bytes.length === descriptor.bytes && sha256(bytes) === descriptor.sha256 &&
      bytes.toString('base64') === member.contentBase64, 'PROCESSING_PACK_MEMBER_CHANGED');
    members.set(member.path, member);
  }
  directory = await privateDirectory(directory);
  for (const member of members.values()) await sameFile(join(directory, member.path), Buffer.from(member.contentBase64, 'base64'));
  if (await exists(join(directory, 'manifest.json')))
    need(digest(await readJson(join(directory, 'manifest.json'), MAX_FILE)) === digest(document.manifest), 'PROCESSING_PACK_DESTINATION_CONFLICT');
  else await writeJson(join(directory, 'manifest.json'), document.manifest, { exclusive: true });
  return readProcessingHandover({ directory });
}
