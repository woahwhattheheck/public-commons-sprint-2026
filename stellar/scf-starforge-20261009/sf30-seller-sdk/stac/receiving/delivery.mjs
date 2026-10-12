// MIT. Portable GIS around the original verified STAC delivery.
// Acquisition, byte assembly, file custody and native reports stay in StacDelivery.
import { join } from 'node:path';
import { StacDelivery } from '../customer.mjs';
import { assetDescriptor, stacItemKey } from '../provider.mjs';
import { StacFile, stacRetain, stacMemberPath, stacSame,
  STAC_MAX_MANIFEST_BYTES } from '../merchant.mjs';
import { absolute, readBytes, parseJson, digest, need, object }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { buildPortableSceneCatalog } from './catalog.mjs';

const PORTABLE = 'starforge.stac-portable-export.v1';
const MANIFEST = 'scene-export.json';
const HASH = /^[a-f0-9]{64}$/u;
const key = (itemId, assetKey) => JSON.stringify([itemId, assetKey]);
const clone = value => structuredClone(value);
const fixed = new Set(['stac-catalog/catalog.json', 'scene-footprints.geojson',
  'scene-collections.json', 'scene-assets.json', 'scene-explorer.html']);
const mime = contentType => contentType.split(';')[0].trim();

function sourceIdentity(delivery) {
  return Object.fromEntries(['schema', 'bundleSha256', 'selectionSha256', 'editionId',
    'editionDigest', 'snapshot', 'nativeBindingSha256'].map(name => [name, delivery.manifest[name]]));
}
function retainedFile(asset, member) {
  need(member && ['path', 'bytes', 'sha256', 'mime'].every(name => member[name] === asset[name]),
    'STAC_PORTABLE_RECEIVED_ASSET_CHANGED');
  return { path: 'edition/' + member.path, bytes: member.bytes,
    sha256: member.sha256, contentType: member.mime };
}
function nativeAssetOutcome(delivery, asset, member, extra = {}) {
  return { collection: asset.collection, itemId: asset.nativeItemId, assetKey: asset.assetKey,
    editionId: delivery.edition.id, sourceHref: asset.href,
    file: member ? retainedFile(asset, member) : null,
    outcome: member ? 'RETAINED' : 'NOT_ACQUIRED',
    reason: member ? null : 'This source file was captured in the edition but was not selected by the original customer.',
    native: { itemKey: asset.itemId, path: asset.path, bytes: asset.bytes, sha256: asset.sha256,
      editionDigest: delivery.edition.digest, selectionSha256: delivery.selection.selectionSha256 },
    ...extra };
}

/** Build only from an already opened original delivery. No provider, Buyer or network. */
export async function projectStacDelivery(delivery, { signal, progress, maxBytes } = {}) {
  need(delivery instanceof StacDelivery, 'STAC_OPEN_ORIGINAL_DELIVERY_REQUIRED');
  need(progress === undefined || typeof progress === 'function', 'STAC_PROGRESS_CALLBACK_INVALID');
  const items = [], receivedAssets = [], used = new Set();
  const collections = delivery.edition.collections;
  need(Array.isArray(collections), 'STAC_ORIGINAL_COLLECTIONS_REQUIRED');
  const byCollection = new Map(collections.map(collection => [collection.id, collection]));
  const members = new Map(delivery.members().map(member => [member.path, member]));
  const assets = new Map(delivery.edition.assets.map(asset => [key(asset.itemId, asset.assetKey), asset]));
  const totalScenes = delivery.datasetManifest.dataset.rows;
  for await (const item of delivery.features({ signal, ...(maxBytes === undefined ? {} : { maxBytes }) })) {
    need(!signal?.aborted, 'STAC_PORTABLE_EXPORT_ABORTED');
    items.push(item);
    const itemKey = stacItemKey(item);
    for (const assetKey of Object.keys(item.assets)) {
      const descriptor = assetDescriptor(item, assetKey, byCollection.get(item.collection));
      const identity = key(itemKey, assetKey), captured = assets.get(identity);
      let outcome;
      if (captured) {
        need(captured.href === descriptor.href, 'STAC_PORTABLE_ORIGINAL_ASSET_HREF_CHANGED');
        outcome = nativeAssetOutcome(delivery, captured, members.get(captured.path));
        used.add(identity);
      } else {
        outcome = { collection: item.collection, itemId: item.id, assetKey,
          editionId: delivery.edition.id, sourceHref: descriptor.href, file: null,
          outcome: descriptor.eligible ? 'NOT_ACQUIRED' : 'UNAVAILABLE',
          reason: descriptor.eligible ? 'The original received edition contains metadata for this asset, without a captured local file.'
            : descriptor.eligibilityReason,
          native: { itemKey, editionDigest: delivery.edition.digest,
            selectionSha256: delivery.selection.selectionSha256 } };
      }
      outcome.rights = { license: descriptor.license, licenseLinks: descriptor.licenseLinks,
        providers: descriptor.providers, requesterPays: descriptor.requesterPays,
        eligibility: descriptor.eligibilityReason, storage: descriptor.storage };
      receivedAssets.push(outcome);
    }
    if (progress && (items.length === 1 || items.length % 100 === 0))
      await progress({ phase: 'catalog', completedScenes: items.length, totalScenes });
  }
  // Explicitly purchased files may belong to a different scene than a dataset filter.
  // Preserve their exact native binding; never attach one to the wrong footprint.
  for (const [identity, asset] of assets) {
    if (used.has(identity) || !members.has(asset.path)) continue;
    receivedAssets.push(nativeAssetOutcome(delivery, asset, members.get(asset.path), {
      reason: 'Retained by the original receiver outside this acquired scene selection.' }));
  }
  if (progress) await progress({ phase: 'catalog', completedScenes: items.length, totalScenes });
  return buildPortableSceneCatalog({ edition: delivery.edition, items, collections,
    receivedAssets, sourceDelivery: sourceIdentity(delivery) });
}

function derivativeRecord(file) {
  need(object(file) && typeof file.contentType === 'string', 'STAC_PORTABLE_FILE_DESCRIPTOR_INVALID');
  return { path: file.path, bytes: file.bytes, sha256: file.sha256, mime: mime(file.contentType) };
}
function allowedOutput(path) {
  return fixed.has(path) || /^stac-catalog\/(?:items|collections)\/[a-f0-9]{64}\.json$/u.test(path);
}

/**
 * The original copyTo resumes completed verified native files and publishes its
 * native manifest first. Derivatives follow through the same immutable writer;
 * their manifest is last. Repeating this call resumes, without another purchase.
 */
export async function exportPortableStacDelivery(delivery, destination, options = {}) {
  need(delivery instanceof StacDelivery, 'STAC_OPEN_ORIGINAL_DELIVERY_REQUIRED');
  const { signal, progress } = options;
  const copied = await delivery.copyTo(absolute(destination), { signal, progress });
  const projection = await projectStacDelivery(copied, options);
  const originalNames = new Set(['manifest.json', ...Object.keys(copied.manifest.files)]);
  const members = [...projection.files.filter(file => file.path !== MANIFEST),
    ...projection.files.filter(file => file.path === MANIFEST)];
  need(members.length === projection.files.length && members.at(-1)?.path === MANIFEST,
    'STAC_PORTABLE_MANIFEST_REQUIRED');
  let completedBytes = 0, completedFiles = 0;
  const totalBytes = members.reduce((sum, file) => sum + file.bytes, 0);
  for (const file of members) {
    need(!signal?.aborted, 'STAC_PORTABLE_EXPORT_ABORTED');
    need(!originalNames.has(file.path) && (file.path === MANIFEST || allowedOutput(file.path)),
      'STAC_PORTABLE_ORIGINAL_PATH_COLLISION');
    await stacRetain(stacMemberPath(copied.directory, file.path), file.body);
    completedBytes += file.bytes; completedFiles++;
    if (progress) await progress({ phase: 'portable-export', path: file.path,
      completedBytes, totalBytes, completedFiles, totalFiles: members.length });
  }
  const saved = members.at(-1);
  return { directory: copied.directory, editionId: copied.edition.id,
    bundleSha256: copied.manifest.bundleSha256, manifest: projection.manifest,
    manifestFile: { path: join(copied.directory, MANIFEST), bytes: saved.bytes, sha256: saved.sha256 },
    paths: clone(projection.manifest.paths), summary: clone(projection.manifest.summary) };
}

/**
 * Reopen the original customer delivery and every derived file offline. A caller
 * carrying an export receipt can also bind the manifest's exact SHA-256.
 */
export async function openPortableStacDelivery(directory, { signal, progress, expectedManifestSha256 } = {}) {
  need(progress === undefined || typeof progress === 'function', 'STAC_PROGRESS_CALLBACK_INVALID');
  need(expectedManifestSha256 === undefined || HASH.test(expectedManifestSha256),
    'STAC_PORTABLE_EXPECTED_MANIFEST_HASH_INVALID');
  const delivery = await StacDelivery.open(absolute(directory), { signal });
  const raw = await readBytes(join(delivery.directory, MANIFEST), STAC_MAX_MANIFEST_BYTES);
  const sha256 = digest(raw), manifest = parseJson(raw);
  if (expectedManifestSha256 !== undefined)
    need(sha256 === expectedManifestSha256, 'STAC_PORTABLE_MANIFEST_HASH_CHANGED');
  need(manifest?.schema === PORTABLE && Array.isArray(manifest.files) &&
    manifest.files.length <= 32773 && Array.isArray(manifest.receivedFiles) &&
    object(manifest.paths) && object(manifest.summary) &&
    manifest.sourceEdition?.id === delivery.edition.id &&
    manifest.sourceEdition?.editionId === delivery.edition.id &&
    manifest.sourceEdition?.digest === delivery.edition.digest &&
    stacSame(manifest.sourceDelivery, sourceIdentity(delivery)),
  'STAC_PORTABLE_SOURCE_IDENTITY_CHANGED');
  const files = new Map(), originalNames = new Set(['manifest.json', ...Object.keys(delivery.manifest.files)]);
  for (const record of manifest.files) {
    need(allowedOutput(record.path) && !files.has(record.path) && !originalNames.has(record.path),
      'STAC_PORTABLE_FILE_SET_CHANGED');
    const file = new StacFile(delivery.directory, derivativeRecord(record));
    files.set(record.path, file);
  }
  need([...fixed].every(path => files.has(path)) &&
    manifest.paths.catalog === 'stac-catalog/catalog.json' &&
    manifest.paths.footprints === 'scene-footprints.geojson' &&
    manifest.paths.collections === 'scene-collections.json' &&
    manifest.paths['asset-inventory'] === 'scene-assets.json' &&
    manifest.paths.explorer === 'scene-explorer.html' &&
    manifest.paths['portable-manifest'] === MANIFEST, 'STAC_PORTABLE_PATHS_CHANGED');
  const originalAssets = new Map(delivery.edition.assets.map(asset => [asset.path, asset]));
  const received = delivery.members().filter(member => member.asset).map(member => {
    const asset = originalAssets.get(member.path);
    need(asset, 'STAC_PORTABLE_ASSET_NOT_IN_EDITION');
    return retainedFile(asset, member);
  }).sort((a, b) => a.path.localeCompare(b.path));
  const declared = [...manifest.receivedFiles].sort((a, b) => a.path.localeCompare(b.path));
  need(stacSame(received, declared), 'STAC_PORTABLE_RECEIVED_FILES_CHANGED');
  let completedBytes = 0, completedFiles = 0;
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  for (const file of files.values()) {
    await file.verify({ signal });
    completedBytes += file.record.bytes; completedFiles++;
    if (progress) await progress({ phase: 'portable-open', path: file.record.path,
      completedBytes, totalBytes, completedFiles, totalFiles: files.size });
  }
  const manifestFile = new StacFile(delivery.directory,
    { path: MANIFEST, bytes: raw.length, sha256, mime: 'application/json' });
  return Object.freeze({ directory: delivery.directory, delivery,
    manifest: clone(manifest), manifestFile, paths: clone(manifest.paths),
    file(path) {
      if (path === MANIFEST) return manifestFile;
      need(files.has(path), 'STAC_PORTABLE_FILE_NOT_DECLARED');
      return files.get(path);
    },
    features: options => delivery.features(options),
    members: () => manifest.files.map(clone),
  });
}
