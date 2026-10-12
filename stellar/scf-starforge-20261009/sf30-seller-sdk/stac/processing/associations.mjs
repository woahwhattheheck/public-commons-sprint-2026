// MIT. Exact native identifiers and retained payload bytes drive associations.
import { need } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { canonicalJson, sha256, stacItemKey } from '../provider.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const escape = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const nativePair = (collection, id) => canonicalJson([collection, id]);

function payloadReferences(document) {
  const features = [], links = []; let count = 0;
  function visit(value, pointer) {
    need(++count <= 1000000, 'PROCESSING_PAYLOAD_TOO_COMPLEX');
    if (!value || typeof value !== 'object') return;
    if (object(value) && value.type === 'Feature' && typeof value.id === 'string')
      features.push({ pointer, feature: value });
    if (object(value) && typeof value.href === 'string') links.push({ pointer: pointer + '/href', href: value.href });
    if (Array.isArray(value)) value.forEach((child, index) => visit(child, pointer + '/' + index));
    else for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object')
      visit(child, pointer + '/' + escape(key));
  }
  visit(document, ''); return { features, links };
}

export function proposeProcessingAssociations({ processingRuns, stacEdition } = {}) {
  need(Array.isArray(processingRuns) && Array.isArray(stacEdition?.items), 'PROCESSING_ASSOCIATION_INPUT_INVALID');
  const items = stacEdition.items.map(item => ({
    itemId: stacItemKey(item), collection: item.collection ?? null, nativeItemId: item.id,
    nativeSha256: sha256(canonicalJson(item)),
    assets: Object.entries(item.assets ?? {}).filter(([, asset]) => object(asset)).map(([key, asset]) => ({
      key, href: typeof asset.href === 'string' ? asset.href : null, type: asset.type ?? null,
      roles: Array.isArray(asset.roles) ? [...asset.roles] : []
    }))
  }));
  const byPair = new Map(), byHref = new Map();
  for (const item of items) {
    const key = nativePair(item.collection, item.nativeItemId);
    byPair.set(key, [...(byPair.get(key) ?? []), item]);
    for (const asset of item.assets) if (asset.href) byHref.set(asset.href, [...(byHref.get(asset.href) ?? []), { item, asset }]);
  }
  const selectedItemIds = stacEdition.decisions?.filter(v => v.status === 'SELECTED').map(v => v.itemId) ?? [];
  const runs = processingRuns.map(run => {
    need(typeof run.key === 'string' && object(run.latest), 'PROCESSING_RUN_IDENTITY_INVALID');
    const candidates = [], unmatched = [], payloads = [], fingerprints = new Set();
    const add = candidate => {
      const key = sha256(canonicalJson(candidate));
      if (!fingerprints.has(key)) { fingerprints.add(key); candidates.push(candidate); }
    };
    for (const detail of run.details ?? []) {
      if (!['input_payload', 'output_payload'].includes(detail.kind)) continue;
      const origin = { kind: detail.kind, captureSha256: detail.metadata?.sha256 ?? null,
        captureDirectory: detail.captureDirectory, capturedAt: detail.metadata?.capturedAt ?? null };
      need(typeof origin.captureSha256 === 'string' && /^[a-f0-9]{64}$/.test(origin.captureSha256),
        'PROCESSING_PAYLOAD_CAPTURE_IDENTITY_REQUIRED');
      payloads.push({ ...origin, status: detail.metadata.status, request: detail.request });
      const refs = payloadReferences(detail.document);
      for (const { pointer, feature } of refs.features) {
        if (typeof feature.collection !== 'string') {
          unmatched.push({ ...origin, pointer, nativeItemId: feature.id, reason: 'NATIVE_COLLECTION_ABSENT' }); continue;
        }
        const matches = byPair.get(nativePair(feature.collection, feature.id)) ?? [];
        if (!matches.length) unmatched.push({ ...origin, pointer, collection: feature.collection,
          nativeItemId: feature.id, reason: 'ITEM_OUTSIDE_BOUND_EDITION' });
        for (const item of matches) add({ ...origin, pointer, itemId: item.itemId, collection: item.collection,
          nativeItemId: item.nativeItemId, match: 'same-native-collection-and-item-id',
          assets: item.assets.filter(asset => object(feature.assets?.[asset.key]) && feature.assets[asset.key].href === asset.href)
            .map(asset => ({ key: asset.key, href: asset.href, match: 'same-asset-key-and-href' })) });
      }
      for (const { pointer, href } of refs.links) for (const { item, asset } of byHref.get(href) ?? [])
        add({ ...origin, pointer, itemId: item.itemId, collection: item.collection, nativeItemId: item.nativeItemId,
          match: 'same-native-asset-href', assets: [{ key: asset.key, href, match: 'same-native-asset-href' }] });
    }
    const unique = [...new Set(candidates.map(v => v.itemId))];
    return { runKey: run.key,
      identity: Object.fromEntries(['source_id', 'workflow_definition_id', 'run_id', 'payload_id', 'workflow_id']
        .map(key => [key, run.latest[key] ?? null])),
      state: run.latest.state ?? null, latestError: run.latest.last_error ?? null,
      status: unique.length === 0 ? 'UNMATCHED' : unique.length === 1 ? 'ONE_NATIVE_ITEM' : 'MULTIPLE_NATIVE_ITEMS',
      candidates, unmatched, payloads, selectedItemIds: unique.filter(v => selectedItemIds.includes(v)) };
  });
  return { schema: 'scf-stac-processing-associations/v1', items, runs };
}

export function validateProcessingAssociation({ model, runKey, itemId, assetKey = null, actor, note = '' } = {}) {
  const run = model?.proposals?.runs.find(v => v.runKey === runKey);
  const item = model?.proposals?.items.find(v => v.itemId === itemId);
  need(run && item && model.binding, 'PROCESSING_NATIVE_ASSOCIATION_SELECTION_REQUIRED');
  need(typeof actor === 'string' && actor.trim().length > 0 && actor.length <= 160, 'PROCESSING_REVIEW_ACTOR_REQUIRED');
  need(typeof note === 'string' && note.length <= 4000, 'PROCESSING_ASSOCIATION_NOTE_INVALID');
  const asset = assetKey === null ? null : item.assets.find(v => v.key === assetKey);
  need(assetKey === null || asset, 'PROCESSING_NATIVE_ASSET_SELECTION_REQUIRED');
  const candidates = run.candidates.filter(v => v.itemId === itemId &&
    (assetKey === null || v.assets.some(a => a.key === assetKey && a.href === asset.href)));
  need(candidates.length > 0 || note.trim().length > 0, 'PROCESSING_MANUAL_ASSOCIATION_REASON_REQUIRED');
  return { runKey, runIdentity: run.identity, binding: model.binding, itemId,
    collection: item.collection, nativeItemId: item.nativeItemId, nativeItemSha256: item.nativeSha256,
    assetKey, assetHref: asset?.href ?? null,
    basis: candidates.length ? 'native-payload-identity' : 'operator-selected-association',
    evidence: candidates.map(v => ({ kind: v.kind, pointer: v.pointer, match: v.match,
      captureSha256: v.captureSha256, captureDirectory: v.captureDirectory })),
    actor: actor.trim(), note };
}
