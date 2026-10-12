// MIT. Census metadata is available without opening native provider runtimes.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

const HASH = /^[a-f0-9]{64}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuid = { type: 'string', pattern: UUID.source };

const hash = { type: 'string', pattern: HASH.source };

const object = { type: 'object', additionalProperties: true };

const integer = { type: 'integer', minimum: 0 };

const read = { readOnly: true, idempotent: true };

const publisherFields = {
  'publisher.open': [], 'publisher.status': [], 'publisher.prepareEdition': ['id'],
  'publisher.preview': ['target', 'query'],
  'publisher.reviewDraft': ['draftId', 'expectedSnapshot', 'expectedRevision'],
  'publisher.publish': ['draftId', 'expectedSnapshot', 'expectedRevision'],
  'publisher.activateSnapshot': ['snapshot', 'expectedSnapshot', 'expectedRevision'],
  'publisher.collect': [], 'publisher.release.stage': ['draftId', 'id', 'label'],
  'publisher.release.inspect': ['id'], 'publisher.release.activate': ['id', 'expectedGeneration'],
  'publisher.release.rollback': ['expectedGeneration'], 'publisher.release.start': ['expectedGeneration'],
  'publisher.release.stop': [], 'publisher.buyer.review': ['snapshot', 'query'],
  'publisher.buyer.prepare': ['review', 'intentId', 'acceptIndex', 'offerSha256'],
  'publisher.buyer.session': ['buyerId', 'buyerWorkspace', 'maxPages', 'maxTotalAtomic', 'maxRows', 'maxPageBytes'],
  'publisher.buyer.run': ['id', 'retryUnpaid', 'expectedAttemptSha256'],
  'publisher.buyer.recover': ['id'], 'publisher.buyer.account': ['id'], 'publisher.buyer.export': ['id'],
};

const publisherFileKinds = ['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'];

export function censusGeocoderWorkspaceTools(tool) {
  const scoped = value => ({ workspace: alias, ...value });
  return [
    tool('merchant_census_geocoder_status', 'List declared host inputs, visible merchant profiles and original buyer workspaces, or inspect retained geocoder history. History arrays are paginated; no provider request or publisher is started.',
      scoped({ offset: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } }), [], read),
    tool('merchant_census_geocoder_open', 'Open the original geocoder writer and retain its native workspace ID. create:true initializes only an empty host-declared directory using the original native initializer; normal reopen preserves all captures, editions and customer sessions.',
      scoped({ create: { type: 'boolean' } }), ['workspace'], { idempotent: true }),
    tool('merchant_census_geocoder_close', 'Drain this process-owned workspace, original publisher, customer operations, file reads and borrowed browser, preserving all retained state. Use its actual instanceId.',
      scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_census_geocoder_discovery', 'Request and retain the actual official Census benchmark list or vintages for a benchmark from a retained discovery. Vintages payload requires discoveryId and benchmark. Uses the original Census API and capture lifecycle.',
      scoped({ action: { enum: ['benchmarks', 'vintages'] }, payload: object }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_census_geocoder_batch', 'Create a batch from a declared exact address CSV and retained official benchmark/vintage selection, inspect original match rows with pagination, or capture its actual Census response. Capture requires batchId; only explicit retry:true repeats an incomplete prior request. history returns paginated original attempt records.',
      scoped({ action: { enum: ['create', 'inspect', 'history', 'capture'] }, payload: object }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_census_geocoder_customer', 'Retain a declared original customer CSV, preview explicit address-column mapping and row exceptions, save exact reviewed corrections/exclusions, create its native Census batch, or bind an already captured exact submission. Original business columns and row order remain in the joined edition. source payload selects sourceImport; mapping/batch/bind require expectedReviewSha256 from the current preview. inspect is paginated; original source and full mapping are available through retained file reads.',
      scoped({ action: { enum: ['source', 'preview', 'mapping', 'inspect', 'batch', 'bind'] }, payload: object }), ['workspace', 'action'], { idempotent: true }),
    tool('merchant_census_geocoder_import', 'Adopt a declared complete original Census capture directory without another HTTP request. Native import validates exact submitted addresses, official metadata, HTTP response and every original digest, and reuses a completed recording identity.',
      scoped({ sourceImport: alias }), ['workspace', 'sourceImport'], { idempotent: true }),
    tool('merchant_census_geocoder_review', 'Save the explicit native match selection bound to batchId, attemptId and responseSha256. plan selects known columns, match categories, omitted IDs, query controls and a visible note; record_id and match_status remain required.',
      scoped({ batchId: uuid, attemptId: uuid, responseSha256: hash, plan: object }), ['workspace', 'batchId', 'attemptId', 'responseSha256', 'plan']),
    tool('merchant_census_geocoder_edition', 'Build or reopen the original edition bound to reviewId and an optional declared public merchant profile. This retains original Census provenance and uses the existing seller compiler. The same review/profile returns its retained edition. Optional mappingId joins all original customer records only when that saved mapping is bound to the exact reviewed batch.',
      scoped({ reviewId: uuid, profile: alias, mappingId: uuid }), ['workspace', 'reviewId'], { idempotent: true }),
    tool('merchant_census_geocoder_query', 'Query a retained edition through the original SF30 dataset handler, including its native projection, sorting, filters and snapshot cursor.',
      scoped({ id: uuid, query: { type: 'string', maxLength: 8192 } }), ['workspace', 'id', 'query'], read),
    tool('merchant_census_geocoder_export', 'Write the complete original portable edition into this host’s declared customer export root. Retains dataset, seller, review, original address/HTTP files and their native manifest, with the original exact-byte reopen check.',
      scoped({ id: uuid }), ['workspace', 'id'], { idempotent: true }),
    tool('merchant_census_geocoder_file', 'Read an original address/response, complete edition member, or publisher/customer delivery file in verified retained chunks. Continue with readId, expectedSha256 and nextOffset; release unfinished reads explicitly. edition-file filename comes from the original exported manifest.',
      scoped({ kind: { enum: ['input', 'response', 'dataset', 'provenance', 'seller', 'manifest', 'edition-file', 'customer-input', 'customer-mapping', 'customer-submitted', 'customer-results', 'customer-results-json', ...publisherFileKinds] },
        id: uuid, filename: { type: 'string', minLength: 1, maxLength: 500 }, expectedSha256: hash, readId: uuid,
        offset: integer, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }), ['workspace', 'kind', 'id'], read),
    tool('merchant_census_geocoder_file_release', 'Release an unfinished retained file snapshot while preserving the original source or customer delivery.',
      scoped({ readId: uuid }), ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_census_geocoder_publisher', 'Use the SAME original publisher, draft review, SF82 release generations and SF88 buyer sessions. prepareEdition selects an original edition ID; release.stage uses the host runtime; buyer.session selects a declared buyerWorkspace. Buyer execution retains its original terminal approval and native recovery/accounting.',
      scoped({ action: { enum: Object.keys(publisherFields) }, payload: object }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_census_geocoder_cancel', 'Request cancellation of this workspace’s actual in-flight Census metadata or batch HTTP capture. Native capture retains its original attempt and observed response. This does not stop or replay payment execution.',
      scoped({}), ['workspace']),
    tool('merchant_census_geocoder_browser', 'Open or close the existing industrial Census browser on this exact MCP-owned workspace and publisher. Closing only the browser leaves the workspace available; full close drains both original surfaces.',
      scoped({ action: { enum: ['open', 'close'] }, port: { type: 'integer', minimum: 0, maximum: 65535 } }), ['workspace', 'action']),
  ];
}

export { UUID, HASH, publisherFields, publisherFileKinds };
