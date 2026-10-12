import { join, resolve } from 'node:path';
import { openStacWorkspace } from '../workspace.mjs';
import { stacItemKey } from '../provider.mjs';
import { privateDirectory, readJson, writeJson, exists } from '../../../sf88-operator-buyer-cli/node/store.mjs';
const root = resolve(process.env.STAC_NATIVE_DIRECTORY ?? './stac-native-operation');
await privateDirectory(root);
const journalPath = join(root, 'operation.json');
const journal = await exists(journalPath) ? await readJson(journalPath) : { id: 'b710-stac-austin-20261011', startedAt: new Date().toISOString(), stage: 'PREPARED' };
async function checkpoint(stage, update = {}) { Object.assign(journal, update, { stage, updatedAt: new Date().toISOString() }); await writeJson(journalPath, journal); console.log(JSON.stringify({ stage, ...update })); }
const transport = process.env.HTTPS_PROXY ? { mode: 'explicit-connect', origin: 'https://earth-search.aws.element84.com', proxyEnv: 'HTTPS_PROXY' } : undefined;
const workspace = await openStacWorkspace({ directory: join(root, 'workspace'), title: 'Austin imagery operations', transport });
try {
  const catalog = await workspace.discover({ operationId: 'b710-earth-search-discover-20261011' });
  await checkpoint('CATALOG_READY', { catalogId: catalog.catalog.id, collectionsCount: catalog.collections.length });
  if (!journal.queryId) {
    const query = await workspace.saveQuery({ name: 'Austin — September 2026, cloud cover up to 70%', collections: ['sentinel-2-l2a'],
      bbox: [-97.85, 30.15, -97.55, 30.45], datetime: '2026-09-01T00:00:00Z/2026-09-30T23:59:59Z',
      cloudCoverMax: 70, pageSize: 5, maxPages: 2 });
    const review = await workspace.reviewSearch({ queryId: query.id });
    await checkpoint('SEARCH_REVIEWED', { queryId: query.id, reviewId: review.id, request: review.request });
  }
  let edition = await workspace.acquire({ reviewId: journal.reviewId, operationId: 'b710-austin-september-edition-1' });
  await checkpoint('SEARCH_CAPTURED', { editionId: edition.id, status: edition.status, itemsCount: edition.itemsCount, pagesCount: edition.pagesCount });
  while (edition.status === 'PARTIAL') {
    edition = await workspace.resume({ editionId: edition.id });
    await checkpoint('SEARCH_RESUMED', { editionId: edition.id, status: edition.status, itemsCount: edition.itemsCount, pagesCount: edition.pagesCount });
  }
  const detail = await workspace.getEdition(edition.id);
  const items = detail.items.toSorted((a, b) => (a.properties['eo:cloud_cover'] ?? 100) - (b.properties['eo:cloud_cover'] ?? 100));
  const choice = items.find(item => item.assets.thumbnail?.href?.startsWith('https:')) ?? items.find(item =>
    Object.values(item.assets).some(asset => asset.roles?.includes('thumbnail') && asset.href?.startsWith('https:')));
  const choices = choice ? Object.entries(choice.assets).filter(([, asset]) => asset.href?.startsWith('https:') &&
    asset.roles?.some(role => ['thumbnail', 'overview', 'visual'].includes(role))).map(([key, asset]) => ({ key, ...asset })) : [];
  if (choice) {
    const key = choice.assets.thumbnail ? 'thumbnail' : choices.find(v => v.roles?.includes('thumbnail'))?.key;
    await workspace.setDecision({ editionId: edition.id, itemId: stacItemKey(choice), status: 'SELECTED',
      actor: 'Reidgardas', note: 'Selected the lowest-cloud returned scene for a reviewed public preview and original metadata delivery.', assetKeys: key ? [key] : [] });
    if (key && !journal.assetReviewId) {
      const review = await workspace.reviewAsset({ editionId: edition.id, itemId: stacItemKey(choice), assetKey: key, maxBytes: 16 * 1024 * 1024 });
      await checkpoint('ASSET_REVIEWED', { assetReviewId: review.id, assetReview: { href: review.href, type: review.type,
        license: review.license, requesterPays: review.requesterPays, eligible: review.eligible, itemId: review.itemId, assetKey: review.assetKey } });
    }
  }
  await checkpoint('SCENES_READY', { editionId: edition.id, status: edition.status, itemsCount: edition.itemsCount, pagesCount: edition.pagesCount,
    coverage: edition.coverage, selectedItem: choice ? { id: choice.id, collection: choice.collection, cloudCover: choice.properties['eo:cloud_cover'], choices } : null });
  await writeJson(join(root, 'capture-result.json'), journal);
} catch (error) {
  await checkpoint('FAILED', { error: { code: error.code ?? 'STAC_NATIVE_FAILED', message: String(error.message).slice(0, 500) } });
  process.exitCode = 1;
} finally { await workspace.close(); }
