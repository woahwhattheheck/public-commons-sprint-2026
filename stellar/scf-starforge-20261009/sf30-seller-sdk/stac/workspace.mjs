// MIT. Durable STAC analyst workspace; native settlement stays in SF30/SF88.
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { hostname } from 'node:os';
import { open, readdir, unlink, stat, lstat, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, jsonBytes, exists, need }
  from '../../sf88-operator-buyer-cli/node/store.mjs';
import { DEFAULT_ENDPOINT, normalizeEndpoint, normalizeQuery, canonicalJson, sha256, stacItemKey,
  searchRequest, nextRequest, createStacProvider, assetDescriptor, scenesCsv, sceneRows, publicURL } from './provider.mjs';

const active = new Map();
const stamp = () => new Date().toISOString();
const identity = prefix => prefix + '-' + randomUUID().replaceAll('-', '').slice(0, 24);
const digestJson = value => sha256(canonicalJson(value));
const opId = value => { need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'STAC_OPERATION_ID_REQUIRED'); return value; };
const safePath = path => { need(typeof path === 'string' && path.length && path.split('/').every(p =>
  /^[A-Za-z0-9._-]+$/.test(p) && !['.', '..'].includes(p)), 'STAC_RELATIVE_PATH_INVALID'); return path; };
const cleanError = error => ({ code: /^[A-Z0-9_]{1,150}$/.test(error.code ?? '') ? error.code : 'STAC_OPERATION_FAILED',
  message: String(error.message ?? error).slice(0, 500), at: stamp() });
const html = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const withoutUndefined = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

export async function openStacWorkspace({ directory, title = 'Satellite imagery workspace',
  endpoint, transport, create = true } = {}) {
  directory = await privateDirectory(directory, { create });
  const versions = await privateDirectory(join(directory, 'versions'), { create });
  await privateDirectory(join(directory, 'captures'), { create });
  await privateDirectory(join(directory, 'locks'), { create });
  let queue = Promise.resolve();
  const verifiedAssets = new Map();
  const versionFile = revision => join(versions, String(revision).padStart(12, '0') + '.json');
  async function readState() {
    for (let retry = 0; retry < 8; retry++) {
      const files = (await readdir(versions)).filter(name => /^\d{12}\.json$/.test(name)).sort();
      need(files.length, 'STAC_WORKSPACE_NOT_INITIALIZED');
      try { return await readJson(join(versions, files.at(-1)), 128 * 1024 * 1024); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    need(false, 'STAC_WORKSPACE_CONCURRENT_WRITER');
  }
  async function pruneStateVersions() {
    const files = (await readdir(versions)).filter(name => /^\d{12}\.json$/.test(name)).sort();
    for (const file of files.slice(0, -8)) await unlink(join(versions, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  if (!(await readdir(versions)).some(name => /^\d{12}\.json$/.test(name))) {
    need(create, 'STAC_WORKSPACE_NOT_FOUND');
    const initial = { schema: 'scf-stac-workspace/v1', id: identity('stac'), revision: 0, title,
      endpoint: normalizeEndpoint(endpoint ?? DEFAULT_ENDPOINT), createdAt: stamp(), updatedAt: stamp(),
      catalog: null, collections: [], catalogSources: [], queries: [], reviews: [], editions: [], assetReviews: [],
      assets: [], decisions: [], operations: {}, imports: [] };
    try { await writeJson(versionFile(0), initial, { exclusive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const opening = await readState();
  if (endpoint !== undefined) need(normalizeEndpoint(endpoint) === opening.endpoint, 'STAC_WORKSPACE_ENDPOINT_MISMATCH');
  let provider = createStacProvider({ endpoint: opening.endpoint, transport });
  async function mutate(change, expectedRevision) {
    const action = queue.then(async () => {
      for (let retry = 0; retry < 8; retry++) {
        const state = await readState();
        if (expectedRevision !== undefined) need(state.revision === expectedRevision, 'STAC_WORKSPACE_REVISION_CHANGED');
        const result = change(state);
        state.revision++; state.updatedAt = stamp();
        try { await writeJson(versionFile(state.revision), state, { exclusive: true }); await pruneStateVersions(); return structuredClone(result); }
        catch (e) { if (e.code !== 'EEXIST') throw e; }
      }
      need(false, 'STAC_WORKSPACE_CONCURRENT_WRITER');
    });
    queue = action.catch(() => {}); return action;
  }
  async function lease(key, run) {
    const file = join(directory, 'locks', sha256(key) + '.json');
    const token = identity('lease'); let handle;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { handle = await open(file, 'wx', 0o600); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const previous = await readJson(file);
        need(previous.host === hostname(), 'STAC_OPERATION_ACTIVE_ON_OTHER_HOST');
        let alive = true; try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
        need(!alive, 'STAC_OPERATION_ALREADY_RUNNING');
        const current = await readJson(file); need(current.token === previous.token, 'STAC_OPERATION_LEASE_CHANGED');
        await unlink(file);
      }
    }
    need(handle, 'STAC_OPERATION_LEASE_UNAVAILABLE');
    await handle.writeFile(jsonBytes({ token, pid: process.pid, host: hostname(), startedAt: stamp(), key }));
    await handle.sync(); await handle.close();
    try { return await run(); }
    finally { if (await exists(file)) { const current = await readJson(file); if (current.token === token) await unlink(file); } }
  }
  async function capture(request, kind, register, signal) {
    const relative = 'captures/' + identity(kind);
    await register({ directory: relative, requestHash: digestJson(request), request, status: 'PENDING', startedAt: stamp() });
    try {
      const result = await provider.captureJson(request, { directory: join(directory, relative), signal });
      return { ...result, source: { directory: relative, ...result.record, status: 'RECEIVED', kind } };
    } catch (error) { error.stacCapture = relative; throw error; }
  }
  async function discover({ operationId, expectedRevision } = {}) {
    operationId = opId(operationId);
    const prior = (await readState()).operations[operationId];
    if (prior) {
      need(prior.kind === 'DISCOVER', 'STAC_OPERATION_INPUT_CHANGED');
      if (prior.status === 'COMPLETE') return { catalog: (await readState()).catalog, collections: (await readState()).collections };
    }
    return lease('operation:' + operationId, async () => {
      await mutate(s => {
        if (s.operations[operationId]) need(s.operations[operationId].kind === 'DISCOVER', 'STAC_OPERATION_INPUT_CHANGED');
        s.operations[operationId] = { kind: 'DISCOVER', status: 'RUNNING', startedAt: stamp() };
      }, expectedRevision);
      const sources = [], found = new Map();
      const register = attempt => mutate(s => { s.catalogSources.push(attempt); });
      try {
        const root = await capture({ url: provider.endpoint, method: 'GET', headers: { accept: 'application/json' } }, 'catalog', register);
        need(root.document.type === 'Catalog' && Array.isArray(root.document.links), 'STAC_CATALOG_INVALID');
        sources.push(root.source);
        const data = root.document.links.find(link => link.rel === 'data');
        need(data, 'STAC_COLLECTIONS_LINK_REQUIRED');
        let current = { url: publicURL(data.href, provider.endpoint), method: 'GET', headers: { accept: 'application/json' } };
        need(new URL(current.url).origin === new URL(provider.endpoint).origin, 'STAC_COLLECTIONS_ORIGIN_CHANGED');
        const original = structuredClone(current), visited = new Set();
        while (current) {
          const requestHash = digestJson(current); need(!visited.has(requestHash), 'STAC_COLLECTION_PAGINATION_CYCLE'); visited.add(requestHash);
          const page = await capture(current, 'collections', register);
          need(Array.isArray(page.document.collections), 'STAC_COLLECTIONS_INVALID');
          for (const collection of page.document.collections) {
            need(collection.type === 'Collection' && typeof collection.id === 'string', 'STAC_COLLECTION_INVALID');
            if (found.has(collection.id)) need(digestJson(found.get(collection.id)) === digestJson(collection), 'STAC_COLLECTION_VERSION_CHANGED_DURING_DISCOVERY');
            found.set(collection.id, collection);
          }
          sources.push(page.source);
          current = nextRequest(page.document, current, original, provider.endpoint);
        }
        await mutate(s => {
          s.catalog = root.document; s.collections = [...found.values()];
          for (const source of sources) { const row = s.catalogSources.find(v => v.directory === source.directory); Object.assign(row, source); }
          s.operations[operationId] = { ...s.operations[operationId], status: 'COMPLETE', completedAt: stamp(),
            catalogDigest: digestJson(root.document), collectionsDigest: digestJson([...found.values()]) };
        });
        return { catalog: root.document, collections: [...found.values()] };
      } catch (error) {
        await mutate(s => { s.operations[operationId].status = 'FAILED'; s.operations[operationId].error = cleanError(error); });
        throw error;
      }
    });
  }
  async function saveQuery(input) {
    const state = await readState(), id = input.id ?? identity('query');
    const normalized = normalizeQuery(input, { endpoint: state.endpoint, collections: state.collections });
    const name = input.name ?? 'Scene search';
    need(typeof name === 'string' && name.trim().length > 0 && name.length <= 240, 'STAC_QUERY_NAME_INVALID');
    return mutate(s => {
      const existing = s.queries.find(v => v.id === id);
      if (input.id) need(existing, 'STAC_QUERY_NOT_FOUND');
      const query = { id, name: name.trim(), ...normalized, updatedAt: stamp() };
      if (existing) Object.assign(existing, query); else s.queries.push(query);
      return query;
    }, input.expectedRevision);
  }
  async function reviewSearch({ queryId } = {}) {
    const state = await readState(); need(state.catalog, 'STAC_DISCOVERY_REQUIRED');
    const query = state.queries.find(v => v.id === queryId); need(query, 'STAC_QUERY_NOT_FOUND');
    const request = searchRequest(state.catalog, query), id = identity('review');
    const review = { id, queryId, query: structuredClone(query), queryDigest: digestJson(query), request,
      collections: state.collections.filter(v => query.collections.includes(v.id)), catalog: state.catalog,
      catalogSources: state.catalogSources.filter(v => v.status === 'RECEIVED'), createdAt: stamp() };
    return mutate(s => { s.reviews.push(review); return review; }, state.revision);
  }
  async function itemsFor(edition) {
    const items = new Map();
    for (const page of edition.pages) {
      const raw = await readBytes(join(directory, safePath(page.directory + '/response.bin')), 64 * 1024 * 1024);
      need(sha256(raw) === page.sha256, 'STAC_CAPTURE_HASH_MISMATCH');
      const document = JSON.parse(raw.toString('utf8'));
      for (const item of document.features) {
        const key = stacItemKey(item);
        if (items.has(key)) need(digestJson(items.get(key)) === digestJson(item), 'STAC_PAGE_ITEM_VERSION_CONFLICT');
        items.set(key, item);
      }
    }
    return [...items.values()];
  }
  async function getEdition(id) {
    const state = await readState(), edition = state.editions.find(v => v.id === id); need(edition, 'STAC_EDITION_NOT_FOUND');
    return { edition, items: await itemsFor(edition), decisions: state.decisions.filter(v => v.editionId === id),
      assets: state.assets.filter(v => v.editionId === id) };
  }
  async function runEdition(id) {
    const activeKey = directory + ':' + id;
    need(!active.has(activeKey), 'STAC_OPERATION_ALREADY_RUNNING');
    const controller = new AbortController(); active.set(activeKey, controller);
    try {
      return await lease('edition:' + id, async () => {
        let state = await readState(), edition = state.editions.find(v => v.id === id);
        need(edition && !edition.receivedFrom, 'STAC_SOURCE_EDITION_REQUIRED');
        if (edition.status === 'COMPLETE') return edition;
        await mutate(s => { const e = s.editions.find(v => v.id === id); e.status = 'RUNNING'; e.cancelRequested = false; e.error = null; });
        edition = (await readState()).editions.find(v => v.id === id);
        const index = new Map((await itemsFor(edition)).map(item => [stacItemKey(item), digestJson(item)]));
        const visited = new Set(edition.pages.map(v => v.requestHash));
        let current = edition.nextRequest, count = 0;
        try {
          while (current && count < edition.query.maxPages) {
            state = await readState(); const live = state.editions.find(v => v.id === id);
            if (live.cancelRequested) controller.abort(new Error('STAC_CANCELLED'));
            controller.signal.throwIfAborted();
            const requestHash = digestJson(current);
            need(!visited.has(requestHash), 'STAC_PAGINATION_CYCLE');
            const page = await capture(current, 'search', attempt => mutate(s => {
              const e = s.editions.find(v => v.id === id); e.attempts.push(attempt);
            }), controller.signal);
            need(page.document.type === 'FeatureCollection' && Array.isArray(page.document.features), 'STAC_ITEM_COLLECTION_INVALID');
            let duplicates = 0; const pending = new Map(index);
            for (const item of page.document.features) {
              need(item.type === 'Feature' && item.properties && typeof item.properties === 'object' &&
                item.assets && typeof item.assets === 'object' && !Array.isArray(item.assets), 'STAC_ITEM_INVALID');
              need(edition.query.collections.includes(item.collection), 'STAC_UNREQUESTED_COLLECTION');
              const key = stacItemKey(item), hash = digestJson(item);
              if (pending.has(key)) { need(pending.get(key) === hash, 'STAC_PAGE_ITEM_VERSION_CONFLICT'); duplicates++; }
              pending.set(key, hash);
            }
            const next = nextRequest(page.document, current, edition.originalRequest, edition.query.endpoint);
            need(!next || !visited.has(digestJson(next)) && digestJson(next) !== requestHash, 'STAC_PAGINATION_CYCLE');
            await mutate(s => {
              const e = s.editions.find(v => v.id === id);
              const record = { ...page.source, requestHash, itemsReturned: page.document.features.length,
                matched: page.document.numberMatched ?? page.document.context?.matched ?? null };
              e.pages.push(record); e.pagesCount = e.pages.length; e.itemsCount = pending.size;
              e.duplicateItems += duplicates; e.nextRequest = next;
              Object.assign(e.attempts.find(v => v.directory === page.source.directory), page.source);
              e.coverage = { complete: next === null, uniqueItems: pending.size,
                returnedItems: e.pages.reduce((n, p) => n + p.itemsReturned, 0), duplicateItems: e.duplicateItems,
                providerMatched: record.matched, reason: next ? 'MORE_PROVIDER_PAGES' : 'PROVIDER_PAGINATION_EXHAUSTED' };
            });
            index.clear(); for (const [key, value] of pending) index.set(key, value);
            visited.add(requestHash); current = next; count++;
          }
          return mutate(s => {
            const e = s.editions.find(v => v.id === id);
            e.status = e.nextRequest ? 'PARTIAL' : 'COMPLETE';
            e.coverage.reason = e.nextRequest ? 'PAGE_BUDGET_REACHED_RESUMABLE' : 'PROVIDER_PAGINATION_EXHAUSTED';
            if (!e.nextRequest) e.completedAt = stamp();
            s.operations[e.operationId].status = e.status;
            return e;
          });
        } catch (error) {
          await mutate(s => {
            const e = s.editions.find(v => v.id === id);
            e.status = controller.signal.aborted ? 'CANCELLED' : 'FAILED'; e.error = cleanError(error);
            e.coverage = { ...e.coverage, complete: false, reason: e.status };
            s.operations[e.operationId].status = e.status;
          });
          if (controller.signal.aborted) return (await readState()).editions.find(v => v.id === id);
          throw error;
        }
      });
    } finally { active.delete(activeKey); }
  }
  async function acquire({ reviewId, operationId } = {}) {
    operationId = opId(operationId);
    const state = await readState(), prior = state.operations[operationId];
    if (prior) { need(prior.kind === 'SEARCH' && prior.reviewId === reviewId, 'STAC_OPERATION_INPUT_CHANGED'); return getEdition(prior.editionId).then(v => v.edition); }
    const review = state.reviews.find(v => v.id === reviewId); need(review, 'STAC_SEARCH_REVIEW_REQUIRED');
    const query = state.queries.find(v => v.id === review.queryId);
    need(query && digestJson(query) === review.queryDigest, 'STAC_QUERY_CHANGED_REVIEW_REQUIRED');
    const id = identity('edition');
    await mutate(s => {
      need(!s.operations[operationId], 'STAC_OPERATION_ALREADY_EXISTS');
      const edition = { id, queryId: review.queryId, operationId, reviewId, query: review.query,
        collections: review.collections, catalog: review.catalog, catalogSources: review.catalogSources,
        status: 'PREPARED', startedAt: stamp(), completedAt: null, pages: [], attempts: [], pagesCount: 0, itemsCount: 0,
        duplicateItems: 0, originalRequest: review.request, nextRequest: review.request, cancelRequested: false, error: null,
        coverage: { complete: false, uniqueItems: 0, returnedItems: 0, duplicateItems: 0, providerMatched: null, reason: 'NOT_STARTED' } };
      s.editions.push(edition);
      s.operations[operationId] = { kind: 'SEARCH', reviewId, editionId: id, status: 'PREPARED' };
    }, state.revision);
    return runEdition(id);
  }
  async function cancel({ editionId } = {}) {
    active.get(directory + ':' + editionId)?.abort(new Error('STAC_CANCELLED'));
    return mutate(s => {
      const e = s.editions.find(v => v.id === editionId); need(e, 'STAC_EDITION_NOT_FOUND');
      if (e.status !== 'COMPLETE') { e.cancelRequested = true; if (e.status !== 'RUNNING') e.status = 'CANCELLED'; }
      return e;
    });
  }
  async function reviewAsset({ editionId, itemId, assetKey, maxBytes = 16 * 1024 * 1024 } = {}) {
    need(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 2 * 1024 ** 3, 'STAC_ASSET_BYTE_BUDGET_INVALID');
    const detail = await getEdition(editionId), item = detail.items.find(v => stacItemKey(v) === itemId);
    need(item, 'STAC_ITEM_NOT_FOUND');
    const review = { id: identity('asset-review'), editionId, ...assetDescriptor(item, assetKey,
      detail.edition.collections.find(v => v.id === item.collection)), itemDigest: digestJson(item), maxBytes, createdAt: stamp() };
    return mutate(s => { s.assetReviews.push(review); return review; });
  }
  async function acquireAsset({ reviewId, operationId } = {}) {
    operationId = opId(operationId);
    const state = await readState(), review = state.assetReviews.find(v => v.id === reviewId);
    need(review?.eligible, 'STAC_ELIGIBLE_ASSET_REVIEW_REQUIRED');
    const prior = state.operations[operationId];
    if (prior) {
      need(prior.kind === 'ASSET' && prior.reviewId === reviewId, 'STAC_OPERATION_INPUT_CHANGED');
      if (prior.status === 'COMPLETE') return state.assets.find(v => v.id === prior.assetId);
    }
    return lease('operation:' + operationId, async () => {
      const id = prior?.assetId ?? identity('asset'), relative = 'captures/' + identity('asset-download');
      await mutate(s => {
        s.operations[operationId] = { kind: 'ASSET', reviewId, assetId: id, status: 'RUNNING', startedAt: stamp() };
        let asset = s.assets.find(v => v.id === id);
        if (!asset) { asset = { id, editionId: review.editionId, itemId: review.itemId, collection: review.collection,
          nativeItemId: review.nativeItemId, assetKey: review.assetKey, href: review.href, descriptor: review, attempts: [] }; s.assets.push(asset); }
        asset.status = 'RUNNING'; asset.attempts.push(relative);
      });
      try {
        const result = await provider.downloadAsset(review, { directory: join(directory, relative), maxBytes: review.maxBytes });
        return mutate(s => {
          const asset = s.assets.find(v => v.id === id);
          Object.assign(asset, result, { status: 'COMPLETE', sourceStatus: result.status, path: relative + '/asset.bin' });
          s.operations[operationId].status = 'COMPLETE'; return asset;
        });
      } catch (error) {
        await mutate(s => { const a = s.assets.find(v => v.id === id); a.status = 'FAILED'; a.error = cleanError(error); s.operations[operationId].status = 'FAILED'; });
        throw error;
      }
    });
  }
  async function setDecision({ editionId, itemId, status, actor, note = '', assetKeys = [], expectedRevision } = {}) {
    need(['SELECTED', 'REJECTED', 'REVIEW'].includes(status) && typeof actor === 'string' && actor.trim().length > 0 &&
      actor.length <= 240 && typeof note === 'string' && note.length <= 10000 && Array.isArray(assetKeys), 'STAC_DECISION_INVALID');
    const detail = await getEdition(editionId), item = detail.items.find(v => stacItemKey(v) === itemId); need(item, 'STAC_ITEM_NOT_FOUND');
    need(assetKeys.every(key => typeof key === 'string' && Object.hasOwn(item.assets, key)), 'STAC_DECISION_ASSET_NOT_FOUND');
    return mutate(s => {
      const existing = s.decisions.find(v => v.editionId === editionId && v.itemId === itemId);
      const decision = { id: existing?.id ?? identity('decision'), editionId, itemId, collection: item.collection, nativeItemId: item.id,
        status, actor: actor.trim(), note, assetKeys: [...new Set(assetKeys)], updatedAt: stamp() };
      if (existing) Object.assign(existing, decision); else s.decisions.push(decision);
      return decision;
    }, expectedRevision);
  }
  async function compare({ leftEditionId, rightEditionId } = {}) {
    const left = await getEdition(leftEditionId), right = await getEdition(rightEditionId);
    const a = new Map(left.items.map(v => [stacItemKey(v), v])), b = new Map(right.items.map(v => [stacItemKey(v), v]));
    const result = { leftEditionId, rightEditionId, leftCoverage: left.edition.coverage, rightCoverage: right.edition.coverage,
      comparableQuery: digestJson(normalizeQuery(left.edition.query)) === digestJson(normalizeQuery(right.edition.query)),
      added: [], removed: [], changed: [], unchanged: [] };
    for (const [key, item] of a) {
      const next = b.get(key);
      if (!next) result.removed.push({ itemId: key, collection: item.collection, nativeItemId: item.id, item });
      else if (digestJson(item) === digestJson(next)) result.unchanged.push({ itemId: key, collection: item.collection, nativeItemId: item.id, sha256: digestJson(item) });
      else result.changed.push({ itemId: key, collection: item.collection, nativeItemId: item.id,
        beforeSha256: digestJson(item), afterSha256: digestJson(next), before: item, after: next,
        changedFields: [...new Set([...Object.keys(item), ...Object.keys(next)])].filter(name =>
          canonicalJson(item[name] ?? null) !== canonicalJson(next[name] ?? null)) });
    }
    for (const [key, item] of b) if (!a.has(key)) result.added.push({ itemId: key, collection: item.collection, nativeItemId: item.id, item });
    return result;
  }
  async function getAssetFile(assetId) {
    const asset = (await readState()).assets.find(v => v.id === assetId);
    need(asset?.status === 'COMPLETE', 'STAC_COMPLETED_ASSET_REQUIRED');
    const path = join(directory, safePath(asset.path));
    const fingerprint = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String).join(':');
    const info = await lstat(path, { bigint: true });
    need(info.isFile() && !info.isSymbolicLink() && info.size === BigInt(asset.bytes), 'STAC_ASSET_FILE_CHANGED');
    const key = fingerprint(info);
    if (verifiedAssets.get(assetId) !== key + ':' + asset.sha256) {
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        need(fingerprint(await handle.stat({ bigint: true })) === key, 'STAC_ASSET_FILE_CHANGED');
        const hash = createHash('sha256'); let count = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false })) { hash.update(chunk); count += chunk.length; }
        need(count === asset.bytes && hash.digest('hex') === asset.sha256, 'STAC_ASSET_HASH_MISMATCH');
        need(fingerprint(await handle.stat({ bigint: true })) === key &&
          fingerprint(await lstat(path, { bigint: true })) === key, 'STAC_ASSET_FILE_CHANGED');
      } finally { await handle.close(); }
      verifiedAssets.set(assetId, key + ':' + asset.sha256);
    }
    return { metadata: asset, path };
  }
  async function getAsset(assetId) {
    const { metadata, path } = await getAssetFile(assetId), bytes = await readBytes(path, metadata.bytes);
    need(sha256(bytes) === metadata.sha256, 'STAC_ASSET_HASH_MISMATCH');
    return { metadata, bytes };
  }
  async function exportReport({ editionId, format = 'json' } = {}) {
    const detail = await getEdition(editionId);
    const report = { schema: 'scf-stac-report/v1', ...detail, rows: sceneRows(detail.items, detail.decisions) };
    if (format === 'json') return { filename: editionId + '.json', mime: 'application/json', bytes: jsonBytes(report) };
    if (format === 'csv') return { filename: editionId + '.csv', mime: 'text/csv', bytes: Buffer.from(scenesCsv(detail.items, detail.decisions)) };
    need(format === 'html', 'STAC_REPORT_FORMAT_INVALID');
    return { filename: editionId + '.html', mime: 'text/html', bytes: Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scene review</title><style>body{font:15px system-ui;margin:2rem;color:#202124}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ccc;padding:.6rem;overflow-wrap:anywhere}main{overflow:auto}</style></head><body><h1>Satellite scene review</h1><p>' +
      html(editionId) + ' · ' + html(detail.edition.status) + ' · ' + detail.items.length + ' scenes · ' + html(detail.edition.coverage.reason) +
      '</p><main><table><thead><tr><th>Collection / scene</th><th>Acquisition</th><th>Cloud %</th><th>Decision</th><th>Note</th></tr></thead><tbody>' +
      report.rows.map(r => '<tr><td>' + html(r.collection + ' / ' + r.item_id) + '</td><td>' + html(r.datetime ?? r.start_datetime) +
        '</td><td>' + html(r.cloud_cover) + '</td><td>' + html(r.decision_status) + '</td><td>' + html(r.decision_note) + '</td></tr>').join('') +
      '</tbody></table></main><h2>Source and coverage</h2><pre style="white-space:pre-wrap">' +
      html(JSON.stringify({ query: detail.edition.query, coverage: detail.edition.coverage,
        collections: detail.edition.collections.map(c => ({ id: c.id, license: c.license, links: c.links.filter(l => ['license', 'cite-as'].includes(l.rel)), providers: c.providers })) }, null, 2)) + '</pre></body></html>') };
  }
  function editionPaths(edition, assets) {
    const paths = new Set();
    for (const record of [...edition.catalogSources, ...edition.attempts]) {
      for (const name of ['request.json', 'response.json', 'response.bin', 'error.json']) paths.add(record.directory + '/' + name);
    }
    for (const asset of assets) for (const attempt of asset.attempts)
      for (const name of ['request.json', 'response.json', 'error.json', 'asset.bin']) paths.add(attempt + '/' + name);
    for (const path of paths) { safePath(path); need(path.startsWith('captures/'), 'STAC_SOURCE_PATH_INVALID'); }
    return [...paths];
  }
  async function exportEdition({ editionId, directory: destination } = {}) {
    destination = await privateDirectory(destination);
    need(resolve(destination) !== directory && !resolve(destination).startsWith(directory + '/'), 'STAC_EXPORT_SEPARATE_DIRECTORY_REQUIRED');
    const detail = await getEdition(editionId), files = [], assets = [];
    async function write(path, data, mime) {
      safePath(path); await privateDirectory(dirname(join(destination, path)));
      if (await exists(join(destination, path))) need(sha256(await readBytes(join(destination, path), data.length)) === sha256(data), 'STAC_EXPORT_DESTINATION_CONFLICT');
      else await writeBytes(join(destination, path), data, { exclusive: true });
      files.push({ path, mime, bytes: data.length, sha256: sha256(data) });
    }
    await write('scenes.csv', Buffer.from(scenesCsv(detail.items, detail.decisions)), 'text/csv');
    await write('items.geojson', jsonBytes({ type: 'FeatureCollection', features: detail.items }), 'application/geo+json');
    await write('decisions.json', jsonBytes({ decisions: detail.decisions }), 'application/json');
    const selected = new Map(detail.decisions.filter(d => d.status === 'SELECTED').map(d => [d.itemId, d]));
    const assetVersions = new Map();
    for (const asset of detail.assets.filter(v => v.status === 'COMPLETE').sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))) {
      const decision = selected.get(asset.itemId);
      if (decision && (!decision.assetKeys.length || decision.assetKeys.includes(asset.assetKey)))
        assetVersions.set(asset.itemId + '\0' + asset.assetKey, asset);
    }
    const completedAssets = [...assetVersions.values()];
    const binaryPaths = new Set(completedAssets.map(v => v.path));
    for (const path of editionPaths(detail.edition, completedAssets)) {
      if (!await exists(join(directory, path)) || binaryPaths.has(path)) continue;
      await write(path, await readBytes(join(directory, path), 64 * 1024 * 1024), path.endsWith('.bin') ? 'application/octet-stream' : 'application/json');
    }
    for (const asset of completedAssets) {
      const target = 'assets/' + asset.id + '.bin'; await privateDirectory(dirname(join(destination, target)));
      const source = await getAssetFile(asset.id);
      const file = await open(source.path, 'r'); const hash = (await import('node:crypto')).createHash('sha256'); let count = 0;
      try { for await (const chunk of file.createReadStream({ autoClose: false })) { hash.update(chunk); count += chunk.length; } } finally { await file.close(); }
      need(count === asset.bytes && hash.digest('hex') === asset.sha256, 'STAC_ASSET_HASH_MISMATCH');
      if (await exists(join(destination, target))) {
        const prior = await stat(join(destination, target)); need(prior.size === asset.bytes, 'STAC_EXPORT_DESTINATION_CONFLICT');
        const check = await open(join(destination, target), 'r'), h = (await import('node:crypto')).createHash('sha256');
        try { for await (const chunk of check.createReadStream({ autoClose: false })) h.update(chunk); } finally { await check.close(); }
        need(h.digest('hex') === asset.sha256, 'STAC_EXPORT_DESTINATION_CONFLICT');
      } else await copyFile(source.path, join(destination, target), 1);
      files.push({ path: target, mime: asset.mime, bytes: asset.bytes, sha256: asset.sha256 });
      assets.push({ itemId: asset.itemId, collection: asset.collection, nativeItemId: asset.nativeItemId, assetKey: asset.assetKey,
        path: target, mime: asset.mime, bytes: asset.bytes, sha256: asset.sha256, href: asset.href });
    }
    files.sort((a, b) => a.path.localeCompare(b.path)); assets.sort((a, b) => (a.itemId + '/' + a.assetKey).localeCompare(b.itemId + '/' + b.assetKey));
    const core = { schema: 'scf-stac-edition/v1',
      capture: { id: detail.edition.id, queryId: detail.edition.queryId, coverage: detail.edition.coverage,
        status: detail.edition.status, itemsCount: detail.edition.itemsCount, pagesCount: detail.edition.pagesCount,
        startedAt: detail.edition.startedAt, completedAt: detail.edition.completedAt },
      query: detail.edition.query, catalog: detail.edition.catalog, collections: detail.edition.collections,
      files, assets, paths: { csv: 'scenes.csv', items: 'items.geojson', decisions: 'decisions.json' } };
    const digest = digestJson(core), manifest = { ...core, id: 'stac-edition-' + digest.slice(0, 24), digest };
    const target = join(destination, 'manifest.json');
    if (await exists(target)) need(digestJson(await readJson(target, 64 * 1024 * 1024)) === digestJson(manifest), 'STAC_EXPORT_DESTINATION_CONFLICT');
    else await writeJson(target, manifest, { exclusive: true });
    return { directory: destination, manifest };
  }
  async function exportHandover({ editionIds, includeAssets = true } = {}) {
    const state = await readState(), editions = state.editions.filter(v => !editionIds || editionIds.includes(v.id));
    need(editions.length && (!editionIds || editions.length === new Set(editionIds).size), 'STAC_HANDOVER_EDITIONS_REQUIRED');
    const ids = new Set(editions.map(v => v.id)), assets = state.assets.filter(v => ids.has(v.editionId) && v.status === 'COMPLETE');
    const paths = new Set(editions.flatMap(e => editionPaths(e, includeAssets ? assets.filter(a => a.editionId === e.id) : [])));
    const files = []; let total = 0;
    for (const path of [...paths].sort()) {
      if (!await exists(join(directory, path))) continue;
      const info = await stat(join(directory, path)); total += info.size;
      need(total <= 256 * 1024 * 1024, 'STAC_LARGE_HANDOVER_USE_EDITION_DIRECTORY');
      const bytes = await readBytes(join(directory, path), info.size);
      files.push({ path, bytes: bytes.length, sha256: sha256(bytes), contentBase64: bytes.toString('base64') });
    }
    const core = { schema: 'scf-stac-handover/v1', sourceWorkspaceId: state.id, endpoint: state.endpoint, title: state.title,
      catalog: state.catalog, collections: state.collections, editions, queries: state.queries.filter(q => editions.some(e => e.queryId === q.id)),
      reviews: state.reviews.filter(r => editions.some(e => e.reviewId === r.id)), catalogSources: state.catalogSources.filter(r => paths.has(r.directory + '/response.bin')),
      assets: includeAssets ? assets : [], assetReviews: state.assetReviews.filter(r => ids.has(r.editionId)),
      decisions: state.decisions.filter(d => ids.has(d.editionId)), files };
    return { ...core, digest: digestJson(core) };
  }
  async function importHandover(bundle) {
    need(bundle?.schema === 'scf-stac-handover/v1' && Array.isArray(bundle.files), 'STAC_HANDOVER_INVALID');
    const { digest, ...core } = bundle; need(digest === digestJson(core), 'STAC_HANDOVER_DIGEST_MISMATCH');
    const priorImport = (await readState()).imports.find(v => v.digest === digest); if (priorImport) return priorImport;
    let total = 0; const names = new Set();
    for (const file of bundle.files) {
      safePath(file.path); need(!names.has(file.path) && file.path.startsWith('captures/'), 'STAC_HANDOVER_PATH_CONFLICT'); names.add(file.path);
      need(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 256 * 1024 * 1024 && typeof file.contentBase64 === 'string' && file.contentBase64.length <= Math.ceil(file.bytes / 3) * 4, 'STAC_HANDOVER_FILE_SIZE_INVALID');
      const bytes = Buffer.from(file.contentBase64, 'base64'); total += bytes.length;
      need(total <= 256 * 1024 * 1024 && bytes.length === file.bytes && sha256(bytes) === file.sha256 &&
        bytes.toString('base64') === file.contentBase64, 'STAC_HANDOVER_FILE_MISMATCH');
      await privateDirectory(dirname(join(directory, file.path)));
      if (await exists(join(directory, file.path))) need(sha256(await readBytes(join(directory, file.path), bytes.length)) === file.sha256, 'STAC_HANDOVER_FILE_CONFLICT');
      else await writeBytes(join(directory, file.path), bytes, { exclusive: true });
    }
    for (const edition of bundle.editions) {
      for (const page of edition.pages) need(names.has(page.directory + '/response.bin'), 'STAC_HANDOVER_SOURCE_MISSING');
    }
    for (const asset of bundle.assets) need(names.has(asset.path), 'STAC_HANDOVER_ASSET_MISSING');
    const imported = await mutate(s => {
      const prior = s.imports.find(v => v.digest === digest); if (prior) return prior;
      need(!s.editions.length || s.endpoint === bundle.endpoint, 'STAC_HANDOVER_ENDPOINT_MISMATCH');
      s.endpoint = bundle.endpoint; s.catalog = bundle.catalog; s.collections = bundle.collections;
      for (const field of ['queries', 'reviews', 'catalogSources', 'assets', 'assetReviews', 'decisions']) {
        for (const value of bundle[field]) {
          const key = field === 'catalogSources' ? 'directory' : 'id', existing = s[field].find(v => v[key] === value[key]);
          if (existing) need(digestJson(existing) === digestJson(value), 'STAC_HANDOVER_RECORD_CONFLICT');
          else s[field].push(value);
        }
      }
      for (const edition of bundle.editions) {
        const existing = s.editions.find(v => v.id === edition.id);
        if (existing) { const { receivedFrom, ...original } = existing; need(digestJson(original) === digestJson(edition), 'STAC_HANDOVER_EDITION_CONFLICT'); }
        else s.editions.push({ ...edition, receivedFrom: bundle.sourceWorkspaceId });
      }
      const receipt = { id: identity('import'), digest, sourceWorkspaceId: bundle.sourceWorkspaceId, editionIds: bundle.editions.map(v => v.id),
        files: bundle.files.length, bytes: total, completedAt: stamp() }; s.imports.push(receipt); return receipt;
    });
    provider = createStacProvider({ endpoint: bundle.endpoint, transport });
    return imported;
  }
  return Object.freeze({ directory, getState: readState, discover, saveQuery, reviewSearch, acquire, resume: ({ editionId }) => runEdition(editionId),
    cancel, getEdition, reviewAsset, acquireAsset, setDecision, compare, exportHandover, importHandover, getAsset, getAssetFile,
    exportReport, exportEdition, close: async () => { for (const [key, controller] of active) if (key.startsWith(directory + ':')) controller.abort(new Error('STAC_WORKSPACE_CLOSED')); await queue; } });
}
