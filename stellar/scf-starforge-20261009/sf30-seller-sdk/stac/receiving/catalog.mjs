// MIT. Portable STAC/GeoJSON projections of the original customer delivery.
// Input file descriptors come from StacDelivery; this module neither acquires
// source data nor treats an edition's declared file as a received file.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { renderSceneExplorer } from './explorer.mjs';

const REVIEW = 'starforge.stac-portable-review.v1';
const EXPORT = 'starforge.stac-portable-export.v1';
const INVENTORY = 'starforge.stac-asset-inventory.v1';
const HASH = /^[a-f0-9]{64}$/u;
const STRUCTURAL = new Set(['self', 'root', 'parent', 'child', 'item', 'items', 'collection', 'next', 'prev', 'previous', 'search', 'data', 'conformance', 'http://www.opengis.net/def/rel/ogc/1.0/conformance']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw new TypeError(message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const copy = value => JSON.parse(JSON.stringify(value));
const sourceId = (collection, id) => JSON.stringify([collection ?? null, id]);
const assetId = (collection, id, key) => JSON.stringify([collection ?? null, id, key]);

/** Identity is Collection + original Item ID, not an unscoped scene ID. */
export function stacSceneKey(item) {
  need(object(item) && typeof item.id === 'string' && item.id.length > 0 &&
    (item.collection === undefined || item.collection === null || typeof item.collection === 'string'),
  'STAC scenes require their original string ID and optional Collection ID.');
  return sourceId(item.collection, item.id);
}

function relativeMember(path) {
  need(typeof path === 'string' && path.length > 0 && path.length <= 4096 && !/[\\\x00-\x1f\x7f]/u.test(path) &&
    !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..') &&
    !/^[a-z][a-z0-9+.-]*:/iu.test(path), 'Use an unchanged relative received-file path.');
  return path;
}
const encodePath = path => path.split('/').map(part => part === '..' || part === '.' ? part : encodeURIComponent(part)).join('/');
const localLink = (from, to) => encodePath(posix.relative(posix.dirname(from), to) || posix.basename(to));
function sourceBase(doc) {
  const self = (doc.links ?? []).find(link => object(link) && link.rel === 'self' && typeof link.href === 'string');
  if (!self) return null;
  try { const url = new URL(self.href); return ['javascript:', 'data:', 'vbscript:', 'file:'].includes(url.protocol) ? null : url.href; } catch { return null; }
}
function sourceHref(href, base) {
  if (typeof href !== 'string' || !href.length) return null;
  try { const url = base ? new URL(href, base) : new URL(href); return ['javascript:', 'data:', 'vbscript:', 'file:'].includes(url.protocol) ? null : url.href; } catch { return null; }
}
function keptLinks(doc, issues, label) {
  const base = sourceBase(doc), result = [];
  for (const link of doc.links ?? []) {
    if (!object(link) || STRUCTURAL.has(link.rel)) continue;
    const href = sourceHref(link.href, base);
    if (!href) {
      issues.push({ code: 'SOURCE_LINK_RELATIVE_WITHOUT_BASE', itemId: label,
        message: 'A source link has no resolvable original base. It remains in the original metadata, outside the derived traversal links.' });
      continue;
    }
    result.push({ ...copy(link), href });
  }
  const via = sourceBase(doc);
  if (via && !result.some(link => link.rel === 'via' && link.href === via)) result.push({ rel: 'via', href: via, type: 'application/json', title: 'Original source metadata' });
  return result;
}
function geometryDescription(geometry) {
  if (geometry === null) return { renderable: false, message: 'Source geometry is null; no footprint was inferred.' };
  if (!object(geometry)) return { renderable: false, message: 'Source geometry is absent; original metadata is retained.' };
  const depths = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
  if (!Object.hasOwn(depths, geometry.type)) return { renderable: false, message: 'The original geometry type is not renderable as a STAC footprint: ' + String(geometry.type) };
  const valid = (value, depth) => depth ? Array.isArray(value) && value.length > 0 && value.every(child => valid(child, depth - 1)) :
    Array.isArray(value) && value.length >= 2 && value.every(x => typeof x === 'number' && Number.isFinite(x)) &&
    Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
  if (!valid(geometry.coordinates, depths[geometry.type]))
    return { renderable: false, message: 'Source coordinates are not a renderable WGS84 longitude/latitude array; they remain unchanged in the GeoJSON.' };
  return { renderable: true, message: geometry.type + ' · original WGS84 longitude/latitude' };
}
function receiveDescriptor(entry, editionId) {
  need(object(entry) && typeof entry.itemId === 'string' && typeof entry.assetKey === 'string' &&
    (entry.collection === null || entry.collection === undefined || typeof entry.collection === 'string'),
  'A received asset must identify its original Collection, Item and asset key.');
  if (entry.editionId !== undefined) need(entry.editionId === editionId, 'Received asset belongs to a different edition.');
  const result = copy(entry);
  if (result.file !== undefined && result.file !== null) {
    need(object(result.file) && HASH.test(result.file.sha256) && Number.isSafeInteger(result.file.bytes) && result.file.bytes >= 0,
      'A retained asset requires its original verified SHA-256 and exact byte count.');
    relativeMember(result.file.path);
  } else result.file = null;
  return result;
}
function publicEdition(edition) {
  const result = { editionId: edition.id, id: edition.id };
  for (const key of ['schema', 'digest', 'capture', 'query'])
    if (edition[key] !== undefined) result[key] = copy(edition[key]);
  return result;
}

/**
 * Produce derived files without filesystem or network operations.
 *
 * items/collections are the original parsed STAC objects. receivedAssets are
 * explicitly selected by the original receiver, with Collection/Item/asset
 * binding and an already verified file descriptor (or a retained outcome).
 * Descriptor paths are relative to the root that will contain review.html.
 *
 * The caller retains the original source bytes and writes returned files via
 * its existing private delivery writer. Parsed JSON exports do not claim to
 * preserve source whitespace or numeric-token formatting.
 */
export function buildPortableSceneCatalog({ edition, items, collections = [], receivedAssets = [], sourceDelivery = null } = {}) {
  need(object(edition) && typeof edition.id === 'string' && edition.id.length > 0 && HASH.test(edition.digest ?? ''),
    'Use the original immutable edition manifest.');
  need(Array.isArray(items) && Array.isArray(collections) && Array.isArray(receivedAssets),
    'Supply original Item/Collection arrays and the original receiver asset outcomes.');
  const editionId = edition.id;
  if (sourceDelivery !== null) need(object(sourceDelivery) && HASH.test(sourceDelivery.bundleSha256 ?? '') &&
    HASH.test(sourceDelivery.selectionSha256 ?? '') && sourceDelivery.editionId === editionId &&
    sourceDelivery.editionDigest === edition.digest, 'Use the original received delivery identity.');
  const issues = [], scenes = [], collectionRows = [], collectionIndex = new Map(), itemKeys = new Set(), receivedIndex = new Map();
  const files = [], names = new Set(), localFiles = new Map(), usedReceipts = new Set();
  const paths = { catalog: 'stac-catalog/catalog.json', footprints: 'scene-footprints.geojson',
    'asset-inventory': 'scene-assets.json', 'portable-manifest': 'scene-export.json', explorer: 'scene-explorer.html',
    collections: 'scene-collections.json' };
  const reservedPaths = new Set(Object.values(paths));
  const add = (path, contentType, data) => {
    relativeMember(path); need(!names.has(path), 'Duplicate derived STAC member: ' + path);
    need(!localFiles.has(path), 'A derived output would overwrite a received asset path: ' + path);
    const body = Buffer.isBuffer(data) ? data : bytes(data); names.add(path);
    files.push({ path, contentType, body, bytes: body.length, sha256: digest(body) });
  };
  for (const raw of collections) {
    need(object(raw) && raw.type === 'Collection' && typeof raw.id === 'string' && raw.id.length > 0 &&
      Array.isArray(raw.links), 'Use original STAC Collection objects.');
    need(!collectionIndex.has(raw.id), 'More than one retained Collection version has the same ID; select its exact edition before exporting.');
    const path = 'stac-catalog/collections/' + digest(raw.id) + '.json';
    const row = { id: raw.id, path, original: copy(raw), attributionLinks: [] };
    for (const link of raw.links) if (object(link) && ['license', 'about', 'documentation', 'cite-as'].includes(link.rel)) {
      const href = sourceHref(link.href, sourceBase(raw)); if (href) row.attributionLinks.push({ ...copy(link), href });
    }
    if (typeof raw.license !== 'string' || !raw.license.length) issues.push({ code: 'COLLECTION_LICENSE_MISSING', itemId: raw.id,
      message: 'The original Collection has no license value. No replacement license or redistribution permission was inferred.' });
    collectionIndex.set(raw.id, row); collectionRows.push(row);
  }
  for (const raw of receivedAssets) {
    const entry = receiveDescriptor(raw, editionId), key = assetId(entry.collection, entry.itemId, entry.assetKey);
    need(!receivedIndex.has(key), 'More than one receiver outcome was selected for the same original asset; retain the chosen outcome explicitly.');
    receivedIndex.set(key, entry);
    if (entry.file) {
      need(!reservedPaths.has(entry.file.path), 'A received asset uses a reserved derived output path: ' + entry.file.path);
      const previous = localFiles.get(entry.file.path);
      need(!previous || (previous.sha256 === entry.file.sha256 && previous.bytes === entry.file.bytes),
        'A retained path has inconsistent file identities.');
      localFiles.set(entry.file.path, { path: entry.file.path, bytes: entry.file.bytes, sha256: entry.file.sha256,
        ...(entry.file.contentType ? { contentType: entry.file.contentType } : {}) });
    }
  }
  for (const raw of items) {
    need(object(raw) && raw.type === 'Feature' && typeof raw.stac_version === 'string' && object(raw.properties) &&
      object(raw.assets) && Array.isArray(raw.links), 'Use complete original STAC Item objects.');
    const key = stacSceneKey(raw);
    need(!itemKeys.has(key), 'Duplicate original Collection/Item identity in the selected edition.');
    itemKeys.add(key);
    const collection = raw.collection ?? null, path = 'stac-catalog/items/' + digest(key) + '.json';
    const geo = geometryDescription(raw.geometry), original = copy(raw), assets = [];
    if (!geo.renderable && raw.geometry !== null) issues.push({ code: 'GEOMETRY_NOT_RENDERED', itemId: raw.id, message: geo.message });
    if (collection !== null && !collectionIndex.has(collection)) issues.push({ code: 'COLLECTION_NOT_RETAINED', itemId: raw.id,
      message: 'The Item references a Collection whose original metadata is not included; source collection links remain external.' });
    for (const [assetKey, sourceAsset] of Object.entries(raw.assets)) {
      need(object(sourceAsset) && typeof sourceAsset.href === 'string', 'A STAC asset must retain its original href.');
      const rkey = assetId(collection, raw.id, assetKey), receiver = receivedIndex.get(rkey);
      if (receiver) {
        need(receiver.sourceHref === undefined || receiver.sourceHref === sourceAsset.href,
          'The receiver asset href differs from the selected original Item: ' + raw.id + '/' + assetKey);
        usedReceipts.add(rkey);
      }
      const resolved = sourceHref(sourceAsset.href, sourceBase(raw));
      if (!resolved && !receiver?.file) issues.push({ code: 'ASSET_HREF_RELATIVE_WITHOUT_BASE', itemId: raw.id,
        message: 'An unavailable asset has no usable portable data location. Its original href remains in the source metadata and inventory, outside the derived asset links.' });
      assets.push({ key: assetKey, original: copy(sourceAsset), sourceHref: resolved,
        file: receiver?.file ? copy(receiver.file) : null,
        outcome: receiver?.outcome ?? (receiver?.file ? 'RETAINED' : 'NOT_RETAINED'),
        reason: receiver?.reason ?? (receiver?.file ? null : 'No retained file was supplied by the original customer receiver.'),
        receivedAt: receiver?.receivedAt ?? null, receipt: receiver ? copy(receiver) : null });
    }
    scenes.push({ key, id: raw.id, collection, path, original, assets, geometryRenderable: geo.renderable, geometryMessage: geo.message });
  }
  const unboundAssets = [];
  for (const [key, receipt] of receivedIndex) if (!usedReceipts.has(key)) {
    unboundAssets.push(copy(receipt));
    issues.push({ code: 'RECEIVED_ASSET_OUTSIDE_SCENE_SELECTION', itemId: receipt.itemId,
      message: 'The receiver retained an asset outcome outside this scene selection. It remains in scene-assets.json with its exact original binding' +
        (receipt.file ? ' and received file ' + receipt.file.path : '') + '.' });
  }
  const counts = { scenes: scenes.length, assets: scenes.reduce((n, s) => n + s.assets.length, 0),
    retainedReferences: scenes.reduce((n, s) => n + s.assets.filter(a => a.file).length, 0),
    retained: localFiles.size, retainedBytes: [...localFiles.values()].reduce((n, f) => n + f.bytes, 0),
    unboundAssetOutcomes: unboundAssets.length };
  counts.notRetained = counts.assets - counts.retainedReferences;
  const model = { schema: REVIEW, edition: publicEdition(edition), sourceDelivery: sourceDelivery ? copy(sourceDelivery) : null,
    description: 'Original selected scenes and exact receiver outcomes. Source metadata may describe assets that were not acquired.',
    paths, summary: counts, scenes, collections: collectionRows, issues, unboundAssets };
  const catalog = { type: 'Catalog', stac_version: '1.0.0',
    id: editionId + '-received-scenes', title: 'Retained STAC scenes',
    description: 'A local traversal of the original scenes selected in edition ' + editionId +
      '. Item and Collection metadata remain source-derived. Local asset hrefs identify files retained by the original receiver; other hrefs remain source references.',
    links: [{ rel: 'self', href: 'catalog.json', type: 'application/json' },
      { rel: 'root', href: 'catalog.json', type: 'application/json' }] };
  for (const c of collectionRows) {
    const doc = copy(c.original);
    doc.links = [...keptLinks(c.original, issues, c.id),
      { rel: 'self', href: encodePath(posix.basename(c.path)), type: 'application/json' },
      { rel: 'root', href: localLink(c.path, paths.catalog), type: 'application/json' },
      { rel: 'parent', href: localLink(c.path, paths.catalog), type: 'application/json' },
      ...scenes.filter(s => s.collection === c.id).map(s => ({ rel: 'item', href: localLink(c.path, s.path), type: 'application/geo+json' }))];
    // Collection-level assets stay source references; no Item receipt is reused.
    for (const [assetKey, asset] of Object.entries(doc.assets ?? {})) {
      const resolved = object(asset) ? sourceHref(asset.href, sourceBase(c.original)) : null;
      if (resolved) asset.href = resolved;
      else {
        delete doc.assets[assetKey];
        issues.push({ code: 'COLLECTION_ASSET_HREF_UNRESOLVED', itemId: c.id, assetKey,
          message: 'A Collection-level asset has no usable original location. Its exact metadata remains in scene-collections.json; no local location was inferred.' });
      }
    }
    add(c.path, 'application/json', doc);
    catalog.links.push({ rel: 'child', href: localLink(paths.catalog, c.path), type: 'application/json', title: c.original.title ?? c.id });
  }
  for (const scene of scenes) {
    const doc = copy(scene.original), c = collectionIndex.get(scene.collection);
    doc.links = [...keptLinks(scene.original, issues, scene.id),
      { rel: 'self', href: encodePath(posix.basename(scene.path)), type: 'application/geo+json' },
      { rel: 'root', href: localLink(scene.path, paths.catalog), type: 'application/json' },
      { rel: 'parent', href: localLink(scene.path, c?.path ?? paths.catalog), type: 'application/json' }];
    if (c) doc.links.push({ rel: 'collection', href: localLink(scene.path, c.path), type: 'application/json' });
    else {
      for (const original of scene.original.links.filter(link => link.rel === 'collection')) {
        const href = sourceHref(original.href, sourceBase(scene.original));
        if (href) doc.links.push({ ...copy(original), href });
      }
      catalog.links.push({ rel: 'item', href: localLink(paths.catalog, scene.path), type: 'application/geo+json', title: scene.id });
    }
    for (const asset of scene.assets) {
      if (asset.file) doc.assets[asset.key].href = localLink(scene.path, asset.file.path);
      else if (asset.sourceHref) doc.assets[asset.key].href = asset.sourceHref;
      else delete doc.assets[asset.key]; // Retained in original metadata/inventory; no false local location.
    }
    add(scene.path, 'application/geo+json', doc);
  }
  add(paths.catalog, 'application/json', catalog);
  add(paths.footprints, 'application/geo+json', { type: 'FeatureCollection', features: scenes.map(s => s.original) });
  add(paths.collections, 'application/json', { collections: collectionRows.map(c => c.original) });
  add(paths['asset-inventory'], 'application/json', {
    schema: INVENTORY, edition: publicEdition(edition), summary: counts,
    assets: scenes.flatMap(s => s.assets.map(a => ({ collection: s.collection, itemId: s.id, assetKey: a.key,
      original: a.original, sourceHref: a.sourceHref, outcome: a.outcome, file: a.file,
      reason: a.reason, receivedAt: a.receivedAt, receipt: a.receipt }))),
    unboundAssets, receivedFiles: [...localFiles.values()], issues,
  });
  // Rendering is last so every source-link observation is present in the view.
  add(paths.explorer, 'text/html; charset=utf-8', Buffer.from(renderSceneExplorer(model)));
  for (const name of names) need(!localFiles.has(name), 'A derived output would overwrite a received asset path: ' + name);
  const manifest = { schema: EXPORT, sourceEdition: publicEdition(edition), sourceDelivery: sourceDelivery ? copy(sourceDelivery) : null,
    description: 'Derived local STAC traversal and offline scene/asset projection; original customer delivery remains the source and file-verification authority.',
    summary: counts, paths, receivedFiles: [...localFiles.values()],
    files: files.map(({ path, bytes, sha256, contentType }) => ({ path, bytes, sha256, contentType })), issues,
    originalMetadata: 'GeoJSON/Collection JSON preserve parsed source objects. Exact source response bytes remain in the original StacDelivery, with its own hashes.' };
  add(paths['portable-manifest'], 'application/json', manifest);
  return { manifest, model, files };
}
