// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const recordId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' };

const text = { type: 'string', minLength: 1, maxLength: 240 };

const object = { type: 'object', additionalProperties: true };

const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const read = { readOnly: true, idempotent: true };

const paging = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };

function odataWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, ...properties });
  const chunks = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  return [
    tool('merchant_odata_status', 'List host-declared source/customer workspaces or page an open original workspace: connections, saved queries, editions, reviews, exports, live products and owned imports. Each history returns its own nextOffset.',
      scoped(paging), [], read),
    tool('merchant_odata_open', 'Open a declared original OData workspace and reuse the same process instance on repeat. Provider requests, merchant runtimes and the browser open only through their selected operations.',
      scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_odata_close', 'Drain accepted operations, pause owned imports and close this exact process-owned workspace, merchant runtimes and borrowed browser. Retained source editions and customer files remain available on reopen.',
      scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_odata_source', 'Connect a host-declared OData service under a stable connectionId or refresh the original catalog of an existing connection. Uses the actual service document and CSDL metadata; credential values remain in the original host environment.',
      scoped({ action: { enum: ['connect', 'refresh'] }, service: alias, connectionId: recordId, name: text }),
      ['workspace', 'action', 'connectionId'], { openWorld: true }),
    tool('merchant_odata_catalog', 'Page advertised original entity sets or the exact structural properties of one entity set. Returns retained metadata/source hashes, entity keys, types, nullable and collection details.',
      scoped({ connectionId: recordId, entitySet: text, ...paging }), ['workspace', 'connectionId'], read),
    tool('merchant_odata_plan', 'Save, inspect or review a native structured OData query. Save uses a stable planId, complete select/filter/order/count/pageSize/top input and the original compiler. Repeating the same saved query returns its original ID.',
      scoped({ action: { enum: ['save', 'inspect', 'review'] }, planId: recordId, connectionId: recordId, name: text, query: object,
        note: { type: 'string', minLength: 1, maxLength: 4000 } }), ['workspace', 'action', 'planId']),
    tool('merchant_odata_capture', 'Start, resume or pause an original source edition. Start requires a stable editionId and reviewed planId. Each provider page and nextLink is committed before the following request. The default returns immediately so status and pause remain usable; wait:true awaits this native capture step.',
      scoped({ action: { enum: ['start', 'resume', 'pause'] }, editionId: recordId, planId: recordId, label: text,
        pageBudget: { type: 'integer', minimum: 1, maximum: 100000 }, wait: { type: 'boolean' } }),
      ['workspace', 'action', 'editionId'], { openWorld: true }),
    tool('merchant_odata_edition', 'Inspect an original edition with paged source receipts and receiving decisions, or accept/request work on a complete edition. Acceptance selects the existing edition for dataset export.',
      scoped({ action: { enum: ['inspect', 'review'] }, editionId: recordId, decision: { enum: ['accept', 'needs-work'] },
        note: { type: 'string', minLength: 1, maxLength: 4000 }, ...paging }), ['workspace', 'action', 'editionId']),
    tool('merchant_odata_rows', 'Read a page of retained native entity rows by editionId. Reads only overlapping original normalized pages, verifies their hashes and keeps Decimal/Int64 text and null/missing distinctions.',
      scoped({ editionId: recordId, ...paging }), ['workspace', 'editionId'], read),
    tool('merchant_odata_compare', 'Compute the original keyed difference between two complete editions, retain that whole comparison once, and page added/removed/changed records. Its comparisonId downloads the complete unchanged comparison.',
      scoped({ beforeId: recordId, afterId: recordId, ...paging }), ['workspace', 'beforeId', 'afterId'], { idempotent: true }),
    tool('merchant_odata_semantics', 'Preview the original CSDL source dictionary for a complete retained edition and selected value/state columns. Returns the exact semantic digest for the existing export binding.',
      scoped({ editionId: recordId, fields: { type: 'array', minItems: 1, maxItems: 32, items: text } }),
      ['workspace', 'editionId'], read),
    tool('merchant_odata_export', 'Export an accepted edition through the original typed dataset projection. An optional declared merchant profile adds its public payment terms. Returns the original immutable exportId, reviewed dictionary and complete CSV/JSON/CSDL/source/seller file list.',
      scoped({ editionId: recordId, name: text, fields: { type: 'array', minItems: 1, maxItems: 32, items: text }, profile: alias, expectedSemanticSha256: hash,
        defaultLimit: { type: 'integer', minimum: 1, maximum: 10000 }, maxLimit: { type: 'integer', minimum: 1, maximum: 10000 } }),
      ['workspace', 'editionId'], { idempotent: true }),
    tool('merchant_odata_query', 'Query an original dataset export using its native query string, projection, sorting and cursor. The dataset engine returns the original status and body.',
      scoped({ exportId: recordId, query: { type: 'string', maxLength: 32768 } }), ['workspace', 'exportId'], read),
    tool('merchant_odata_publisher', 'Operate this workspace’s original SF82 dataset release store: inspect/status, prepare, activate/rollback, start or stop. Selection changes use the observed generation; startup also checks the inspected digest. Original child lifecycle and configured host runtime govern execution.',
      scoped({ action: { enum: ['status', 'prepare', 'inspect', 'activate', 'rollback', 'start', 'stop'] }, exportId: recordId,
        releaseId: recordId, label: text, expectedGeneration: { type: 'integer', minimum: 0 }, expectedDigest: hash,
        reason: text, instanceId: uuid }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_odata_live', 'Prepare a live product from a reviewed saved query and a declared public merchant profile, inspect/page its original buyer and receiving histories, or start/stop the same native merchant and private operations listener.',
      scoped({ action: { enum: ['status', 'prepare', 'detail', 'start', 'stop'] }, liveServiceId: recordId, planId: recordId,
        profile: alias, name: text, operation: recordId, ...paging }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_odata_buyer', 'Prepare or reopen the original SF88 request/offers/buyer handoff for a stable purchase intent. Supply receivedId to continue that original paid-page cursor. The existing SF88 buyer executes the returned configuration with its configured signer and purchase policy.',
      scoped({ liveServiceId: recordId, intentId: text, receivedId: hash }), ['workspace', 'liveServiceId', 'intentId'], { idempotent: true }),
    tool('merchant_odata_receive', 'Receive the exact saved merchant response from a host-declared response alias or this live product’s original buyer response file. The existing validator retains its original bytes, normalized rows and unchanged next-page request; duplicate bytes reuse the same receivedId.',
      scoped({ liveServiceId: recordId, response: alias, buyerId: hash }), ['workspace', 'liveServiceId'], { idempotent: true }),
    tool('merchant_odata_transfer', 'Create/list a complete retained workspace transfer, or restore a declared original transfer file or another declared workspace’s transfer into the empty destination. Create keeps the stable transferId on repeat; restore reconciles the original committed transfer identity.',
      scoped({ action: { enum: ['create', 'list', 'restore'] }, transferId: recordId, sourceImport: alias, sourceWorkspace: alias, ...paging }),
      ['workspace', 'action'], { idempotent: true }),
    tool('merchant_odata_file', 'Read a complete original source, dataset, live package, SF88 handoff, received page, transfer or comparison through the shared retained-file reader. Continue with readId, expectedSha256 and nextOffset; the original file is loaded once and released at EOF.',
      scoped({ kind: { enum: ['source', 'dataset', 'live-package', 'buyer', 'receiving', 'transfer', 'comparison'] },
        id: recordId, recordId, filename: { type: 'string', maxLength: 160 }, ...chunks }), ['workspace', 'kind', 'id'], read),
    tool('merchant_odata_file_release', 'Release an unfinished retained-file read while keeping its original file.',
      scoped({ readId: uuid }), ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_odata_browser', 'Open or close the industrial browser over the same original workspace and live operations object. Closing this borrowed browser leaves the agent-owned source imports and merchant services open.',
      scoped({ action: { enum: ['open', 'close'] }, port: { type: 'integer', minimum: 0, maximum: 65535 } }),
      ['workspace', 'action'], { idempotent: true }),
  ];
}

export { odataWorkspaceTools, alias, hash, uuid, paging, read, recordId, text, object };
