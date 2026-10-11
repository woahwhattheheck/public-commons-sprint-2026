// MIT. Event data handlers composed with the existing SF30 x402 seller lifecycle.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSellerService, validateSellerServiceConfig } from '../serve.mjs';
import { compileHttpSellerOffer } from '../seller.mjs';
import { FeedError, PAGE_SCHEMA, isRecord, requireId, digest } from './model.mjs';

function failure(error) {
  if (!(error instanceof FeedError)) throw error;
  return { status: error.status, body: { error: error.code, ...error.details } };
}
export function createWebhookFeedHandlers({ store, feeds }) {
  if (!store || !Array.isArray(feeds) || !feeds.length) throw new TypeError('Store and pinned feeds required');
  const handlers = {};
  for (const [index, feed] of feeds.entries()) {
    requireId(feed.id);
    if (!/^[a-f0-9]{64}$/.test(feed.revision ?? '')) throw new TypeError('Exact feed revision required');
    const read = input => store.readPage(feed.id, input ?? {}, { expectedRevision: feed.revision });
    handlers['admitFeed' + index] = context => {
      try { read(context.query); return true; }
      catch (error) { if (error instanceof FeedError && error.status < 500) return failure(error); throw error; }
    };
    handlers['readFeed' + index] = context => {
      try { return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: read(context.query) }; }
      catch (error) { return failure(error); }
    };
  }
  return handlers;
}
export function buildWebhookFeedService({ store, plan }) {
  if (!isRecord(plan) || plan.schema !== 'stellar-forge.webhook-feed-merchant.v1' || !Array.isArray(plan.feeds) || !plan.feeds.length || plan.feeds.length > 64) throw new FeedError('INVALID_MERCHANT_PLAN', 422);
  if (Object.keys(plan).some(key => !['schema', 'publicOrigin', 'feeds'].includes(key))) throw new FeedError('INVALID_MERCHANT_PLAN', 422);
  const seen = new Set(), pinned = [], routes = [];
  for (const [index, entry] of plan.feeds.entries()) {
    if (!isRecord(entry) || Object.keys(entry).some(key => !['feedId', 'payment', 'paymentOptions'].includes(key))) throw new FeedError('INVALID_FEED_PAYMENT', 422);
    requireId(entry.feedId);
    if (seen.has(entry.feedId)) throw new FeedError('DUPLICATE_MERCHANT_FEED', 422);
    seen.add(entry.feedId);
    const feed = store.definition('feed', entry.feedId, { enabled: true });
    pinned.push({ id: feed.id, revision: feed.revision, maxPageBytes: feed.maxPageBytes });
    routes.push({ id: feed.id, path: '/feeds/' + feed.id, handler: 'readFeed' + index, admit: 'admitFeed' + index,
      definition: { method: 'GET', description: feed.description, serviceName: 'Starforge Event Feeds', tags: ['events', 'webhooks'],
        ...(Object.hasOwn(entry, 'payment') ? { payment: entry.payment } : {}),
        ...(Object.hasOwn(entry, 'paymentOptions') ? { paymentOptions: entry.paymentOptions } : {}),
        queryParameters: [
          { name: 'cursor', type: 'string', required: false, description: 'Opaque nextCursor or resumeCursor from this exact feed; omit on first read.', example: '' },
          { name: 'limit', type: 'integer', required: false, description: 'Maximum events per paid response (1–' + feed.maxPageSize + ').', example: feed.defaultPageSize },
        ],
        outputExample: { schema: PAGE_SCHEMA, storeId: store.storeId, feedId: feed.id, feedRevision: feed.revision, items: [],
          page: { afterSequence: 0, throughSequence: 0, returned: 0, hasMore: false, nextCursor: null, resumeCursor: '<opaque-resume-cursor>' } },
      } });
  }
  const config = { schema: 'stellar-forge.seller-service.v1', ...(plan.publicOrigin ? { publicOrigin: plan.publicOrigin } : {}),
    maxResponseBytes: Math.max(...pinned.map(feed => feed.maxPageBytes)) + 8192, routes };
  validateSellerServiceConfig(config);
  for (const route of routes) compileHttpSellerOffer({ ...route.definition, url: (plan.publicOrigin ?? 'http://127.0.0.1:1') + route.path }, { allowLocalhost: !plan.publicOrigin });
  return { config, feeds: pinned, handlers: createWebhookFeedHandlers({ store, feeds: pinned }) };
}
export async function startWebhookFeedMerchant({ store, plan, port = 8492, nativeFactory = null, ...options }) {
  const prepared = buildWebhookFeedService({ store, plan });
  const session = await startSellerService({ config: prepared.config, handlers: prepared.handlers, port, nativeFactory, ...options });
  return { ...session, feeds: prepared.feeds };
}
export async function prepareWebhookFeedRelease({ store, plan, directory, stateEnv = 'STARFORGE_WEBHOOK_STATE' }) {
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(stateEnv)) throw new FeedError('INVALID_STATE_ENV', 422);
  const prepared = buildWebhookFeedService({ store, plan });
  if (!prepared.config.publicOrigin) throw new FeedError('PUBLIC_ORIGIN_REQUIRED', 422);
  const target = resolve(directory); await mkdir(target, { mode: 0o700 });
  const handlerSource = `// Generated private deployment module. Feed definitions remain pinned.\nimport { EventFeedStore, createWebhookFeedHandlers } from '@tokenjunkielabs/starforge-merchant/seller/webhook-feed';\nconst directory = process.env[${JSON.stringify(stateEnv)}];\nif (!directory) throw new Error('Set ${stateEnv} to the existing private event store');\nconst store = new EventFeedStore(directory);\nconst handlers = createWebhookFeedHandlers({store,feeds:${JSON.stringify(prepared.feeds)}});\n${prepared.feeds.map((_feed, index) => `export const readFeed${index} = handlers.readFeed${index};\nexport const admitFeed${index} = handlers.admitFeed${index};`).join('\n')}\nexport const close = () => store.close();\n`;
  const files = { 'seller-service.json': JSON.stringify(prepared.config, null, 2) + '\n',
    'merchant-plan.json': JSON.stringify(plan, null, 2) + '\n', 'handlers.mjs': handlerSource };
  for (const [name, content] of Object.entries(files)) await writeFile(resolve(target, name), content, { flag: 'wx', mode: 0o600 });
  const manifest = { schema: 'stellar-forge.webhook-feed-release.v1', storeId: store.storeId, feeds: prepared.feeds, stateEnv,
    pageSchema: PAGE_SCHEMA, files: Object.entries(files).map(([name, content]) => ({ name, bytes: Buffer.byteLength(content), sha256: digest(content) })) };
  await writeFile(resolve(target, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory: target, ...manifest };
}
