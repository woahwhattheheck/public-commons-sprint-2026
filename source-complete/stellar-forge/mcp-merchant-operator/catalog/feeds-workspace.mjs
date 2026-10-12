// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const SHA = /^[0-9a-f]{64}$/;

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const sha = { type: 'string', pattern: SHA.source };

const nativeId = { type: 'string', pattern: ID.source };

const uuid = { type: 'string', pattern: UUID.source };

const object = { type: 'object' };

const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: sha };

const scoped = properties => ({ workspace: alias, ...properties });

const readOnly = { readOnly: true, idempotent: true };

const actionKeys = {
  'collection-save': ['collectionId', 'title', 'members', 'newFeeds', 'expectedRevision', 'operationId'],
  'collection-capture': ['collectionId', 'expectedRevision', 'expectedRevisions', 'operationId', 'pageLimit', 'force'],
  'collection-resume': ['runId'],
  'collection-edition': ['runId', 'name', 'fields', 'expectedRevisions', 'operationId'],
  register: ['feedId', 'config', 'expectedRevision', 'operationId'],
  capture: ['feedId', 'operationId', 'followPages', 'pageLimit', 'force', 'fromCapture'],
  resume: ['captureId'],
  apply: ['captureId', 'expectedRevision', 'operationId', 'decisions', 'acceptIdentity'],
  annotate: ['feedId', 'identity', 'expectedRevision', 'operationId', 'note', 'tags', 'starred'],
  edition: ['feedIds', 'name', 'fields', 'expectedRevisions', 'operationId'],
  query: ['editionId', 'params'], compare: ['beforeId', 'afterId'],
};

const feedConfigSchema = { type: 'object', properties: {
  url: { type: 'string', maxLength: 8192 }, label: { type: 'string', minLength: 1, maxLength: 160 },
  rssIdentity: { type: 'string', enum: ['guid','guid-or-link'] },
  allowedOrigins: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string' } }
}, required: ['url'], additionalProperties: false };

const fieldsSchema = { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true,
  items: { type: 'string', enum: ['key','id','title','link','published','updated','summary','content','authors','categories','enclosures','feed_id','source_url','source_sha256'] } };

const revisionSchema = { type: 'integer', minimum: 0 };

const revisionsSchema = { type: 'object', additionalProperties: revisionSchema };

const actionInputSchema = { type: 'object', additionalProperties: false, properties: {
  operationId: nativeId, feedId: nativeId, config: feedConfigSchema, expectedRevision: revisionSchema,
  collectionId: nativeId, title: { type: 'string', minLength: 1, maxLength: 160 },
  members: { type: 'array', minItems: 1, maxItems: 10000, items: { type: 'object', properties: {
    sourceId: { anyOf: [sha, {type:'null'}] }, entryId: { anyOf: [{type:'string'}, {type:'null'}] },
    feedId: { anyOf: [nativeId, {type:'null'}] }, enabled: { type: 'boolean' }
  }, required: ['sourceId','entryId','feedId','enabled'], additionalProperties: false } },
  newFeeds: { type: 'object', additionalProperties: feedConfigSchema }, expectedRevisions: revisionsSchema,
  pageLimit: { type: 'integer', minimum: 1, maximum: 1000 }, followPages: { type: 'boolean' }, force: { type: 'boolean' },
  fromCapture: sha, captureId: sha, runId: sha,
  decisions: { type: 'object', additionalProperties: { anyOf: [sha, {const:'keep'}] } }, acceptIdentity: { type: 'boolean' },
  identity: sha, note: { type: 'string', maxLength: 20000 }, tags: { type: 'array', maxItems: 32, items: {type:'string',minLength:1,maxLength:80} },
  starred: { type: 'boolean' }, feedIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: nativeId },
  name: { type: 'string', minLength: 1, maxLength: 128 }, fields: fieldsSchema,
  editionId: sha, params: { type: 'object', additionalProperties: { type:'string' } }, beforeId: sha, afterId: sha,
} };

const publisherActions = [
  'publisher.status', 'publisher.preview', 'publisher.reviewDraft', 'publisher.publish',
  'publisher.activateSnapshot', 'publisher.collect', 'publisher.release.stage', 'publisher.release.inspect',
  'publisher.release.activate', 'publisher.release.rollback', 'publisher.release.start', 'publisher.release.stop',
  'publisher.buyer.review', 'publisher.buyer.prepare', 'publisher.buyer.session',
  'publisher.buyer.run', 'publisher.buyer.recover', 'publisher.buyer.account', 'publisher.buyer.export',
];

function feedsWorkspaceTools(tool) {
  return [
    tool('merchant_feeds_workspaces', 'List host-declared original feed consoles, source/packet handles, merchant profiles and existing buyer workspaces. Opens no second writer or browser.', {}, [], readOnly),
    tool('merchant_feeds_status', 'Read original asynchronous activity and saved feed/subscription counts. RUNNING describes the actual console worker; RESULT_RETAINED is available by original operation ID after restart.', scoped({}), ['workspace'], readOnly),
    tool('merchant_feeds_inventory', 'Page registered feeds, immutable editions, OPML sources or saved collections. Continue the same inventory with expectedSnapshot.', scoped({ kind: { type: 'string', enum: ['feeds', 'editions', 'subscription-sources', 'collections'] }, ...page }), ['workspace', 'kind'], readOnly),
    tool('merchant_feeds_read', 'Read the original operation, subscription plan, collection, collection run, capture/review/requests/records, edition or comparison. Large complete responses remain downloadable. array selects a saved response array for exact snapshot pagination.', scoped({
      kind: { type: 'string', enum: ['operation', 'subscription-plan', 'collection', 'collection-run', 'captures', 'review', 'requests', 'records', 'edition', 'changes'] },
      id: nativeId, family: { type: 'string', enum: ['feed', 'collection'] }, revision: { type: 'integer', minimum: 1 },
      query: { type: 'string', maxLength: 1000 }, state: { type: 'string', enum: ['active', 'deleted', 'all'] },
      array: { type: 'string', enum: ['entries', 'items', 'requests', 'collection.members', 'feeds', 'registrations', 'runs', 'editions', 'revisions'] }, ...page }), ['workspace', 'kind', 'id'], readOnly),
    tool('merchant_feeds_action', 'Submit an original feed action. HTTP202 is an accepted worker, not completed work. Preserve operationId and poll status/read; resume captures and collections by their original IDs. The original source validates complete configs, member choices, revisions, conflicts and scalar-string query parameters.', scoped({
      action: { type: 'string', enum: Object.keys(actionKeys) }, input: actionInputSchema }), ['workspace', 'action', 'input'], { openWorld: true }),
    tool('merchant_feeds_intake', 'Import a host-declared exact feed XML or OPML source through the existing console. The original server checks the selected full SHA256 before starting its retained operation.', scoped({
      file: alias, operationId: nativeId, feedId: nativeId, sourceUrl: { type: 'string', maxLength: 8192 } }), ['workspace', 'file', 'operationId']),
    tool('merchant_feeds_cancel', 'Request cancellation only for the exact currently running console job. The original operation retains its progress; inspect it before resuming.', scoped({ jobId: sha }), ['workspace', 'jobId'], { idempotent: true }),
    tool('merchant_feeds_export', 'Retain a complete original feed/collection project, native dataset, OPML selection/source, HTTP body, XML source or changes file. The same operationId recovers its first complete export after restart.', scoped({
      operationId: nativeId, kind: { type: 'string', enum: ['feed-project', 'collection-project', 'dataset', 'opml', 'opml-source', 'source', 'http-body', 'changes'] },
      id: nativeId, revision: { type: 'integer', minimum: 1 } }), ['workspace', 'operationId', 'kind', 'id'], { idempotent: true }),
    tool('merchant_feeds_exports', 'Page complete retained deliveries and unfinished preparation intents. Saved complete files remain usable without a console or publisher process.', scoped(page), ['workspace'], readOnly),
    tool('merchant_feeds_receive', 'Receive one exact original feed or collection project through the existing destination console. Select a host packet or a complete retained export from a configured source workspace; native reconstruction retains sources, operations and editions.', scoped({
      operationId: nativeId, file: alias, fromWorkspace: alias, exportId: sha }), ['workspace', 'operationId']),
    tool('merchant_feeds_publisher_prepare', 'Materialize the original selected feed dataset/lineage, prepare its native merchant source package and adopt it into the existing dataset publisher. The same productId retains draft/review, release, buyer and source history.', scoped({
      productId: uuid, editionId: sha, profile: alias }), ['workspace', 'productId', 'editionId', 'profile'], { idempotent: true }),
    tool('merchant_feeds_publishers', 'List retained original publisher product IDs, or read one complete native draft/release/customer state after reopen. Publisher IDs are durable; release ownership remains the original native lifecycle.', scoped({ productId: uuid }), ['workspace'], readOnly),
    tool('merchant_feeds_publisher', 'Operate the original dataset publisher: preview/review/publish, SF82 stage/activate/rollback/start/drain, and reviewed SF88/SF100 buyer session/run/recover/account/export. Stage uses host runtime. buyer.session uses a named buyerWorkspace; signer and approval settings remain in that original workspace.', scoped({
      productId: uuid, action: { type: 'string', enum: publisherActions }, input: object }), ['workspace', 'productId', 'action', 'input']),
    tool('merchant_feeds_publisher_export', 'Retain original publisher CSV/review/config, or the complete completed customer result (acquisition manifest, CSV, JSONL and review). Reads actual native saved outputs; no new purchase.', scoped({
      productId: uuid, operationId: nativeId, id: uuid,
      kind: { type: 'string', enum: ['draft-csv', 'draft-review', 'buyer-config', 'customer'] } }), ['workspace', 'productId', 'operationId', 'id', 'kind'], { idempotent: true }),
    tool('merchant_feeds_download_manifest', 'Inspect the exact retained delivery manifest before downloading its complete files.', scoped({ exportId: sha }), ['workspace', 'exportId'], readOnly),
    tool('merchant_feeds_download_file', 'Read one original retained file in bounded verified chunks. Continue with readId, nextOffset and the same manifest/file SHA256; an expired read can reopen the same immutable file without regenerating an export.', scoped({
      exportId: sha, file: { type: 'string', minLength: 1, maxLength: 160 }, expectedManifestSha256: sha, expectedSha256: sha,
      readId: uuid, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES }
    }), ['workspace', 'exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], readOnly),
    tool('merchant_feeds_download_file_release', 'Release this transport read while preserving its complete retained original delivery.', scoped({ exportId: sha, readId: uuid }), ['workspace', 'exportId', 'readId'], { idempotent: true }),
  ];
}

export { feedsWorkspaceTools, readOnly, scoped, page, nativeId, actionKeys, actionInputSchema, alias, sha, uuid, publisherActions, object, ID, feedConfigSchema, revisionSchema, revisionsSchema, fieldsSchema, SHA, UUID };
