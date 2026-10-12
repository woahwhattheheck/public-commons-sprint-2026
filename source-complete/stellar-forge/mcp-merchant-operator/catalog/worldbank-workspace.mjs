// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$' };

const uuid = { type: 'string', format: 'uuid' };

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const object = { type: 'object', additionalProperties: true };

const integer = { type: 'integer', minimum: 0 };

const text = { type: 'string', maxLength: 200 };

const read = { readOnly: true, idempotent: true };

const publisherActions = new Set([
  'publisher.status','publisher.preview','publisher.reviewDraft','publisher.publish',
  'publisher.activateSnapshot','publisher.collect','publisher.release.stage','publisher.release.inspect',
  'publisher.release.activate','publisher.release.rollback','publisher.release.start','publisher.release.stop',
  'publisher.buyer.review','publisher.buyer.prepare','publisher.buyer.session','publisher.buyer.run',
  'publisher.buyer.recover','publisher.buyer.account','publisher.buyer.export'
]);

const fileKinds = ['source-export','draft-csv','draft-review','buyer-config',
  'session-manifest','session-csv','session-jsonl','session-review'];

function worldbankWorkspaceTools(tool) {
  const scoped = values => ({ workspace: alias, ...values });
  const page = { offset: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  const chunk = { expectedSha256: hash, readId: uuid, offset: integer,
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  return [
    tool('merchant_worldbank_status', 'List declared workspaces, imports and merchant profiles, or inspect the opened native model. Histories carry total and nextOffset; inspect the same saved IDs after an interrupted response.',
      scoped(page), [], read),
    tool('merchant_worldbank_open', 'Open a declared original World Bank model. Repeat reuses this process-owned instance; the publisher opens lazily and the source remains retained.',
      scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_worldbank_close', 'Drain this exact owned model, borrowed browser and file reads. Running capture children retain acquired pages when stopped; the same capture ID resumes them after reopening.',
      scoped({ instanceId: uuid }), ['workspace','instanceId'], { destructive: true }),
    tool('merchant_worldbank_selection', 'Save the exact source ID, countries, indicators, date interval and page size with the current original revision, or zero for a new selection.',
      scoped({ id, title: { type:'string', maxLength:128 }, expectedRevision: integer, spec: object }),
      ['workspace','id','expectedRevision','spec']),
    tool('merchant_worldbank_catalog', 'Search the original sources, countries or indicator catalog. First access and explicit refresh contact the real World Bank API; retained catalogs are otherwise reused.',
      scoped({ kind:{ enum:['sources','countries','indicators'] }, sourceId:{ type:'string', pattern:'^[1-9][0-9]*$' },
        search:text, refresh:{type:'boolean'}, ...page }), ['workspace','kind'], { openWorld:true }),
    tool('merchant_worldbank_capture', 'Start or resume the original capture ID, inspect its retained pages, or cancel this process-owned job. Start/resume returns RUNNING while the actual child acquires pages. Read status until its original job/capture completes.',
      scoped({ action:{enum:['start','resume','inspect','cancel']}, id, selectionId:id, ...page }),
      ['workspace','action','id'], { openWorld:true }),
    tool('merchant_worldbank_inputs', 'Inspect declared source input metadata and SHA256 without importing it. Choose its exact sourceImport alias and retain the hash for import.',
      scoped({ sourceImport:alias }), ['workspace'], read),
    tool('merchant_worldbank_import', 'Import an exact host-declared original page capture or handover ZIP with its inspected SHA256. Stable capture/review IDs retain the original source receipts, numeric tokens and source nulls.',
      scoped({sourceImport:alias,expectedSha256:hash,id,selectionId:id,reviewId:id}),
      ['workspace','sourceImport','expectedSha256','id']),
    tool('merchant_worldbank_observations', 'Page the retained original observations. Values keep their exact source JSON number tokens and nullable states; source page/row and content hashes remain available.',
      scoped({captureId:id,search:text,...page}), ['workspace','captureId'], read),
    tool('merchant_worldbank_compare', 'Compare two complete original capture IDs, returning unchanged/changed/added/absent counts and a page of actual changed observation groups.',
      scoped({captureId:id,baselineId:id,...page}), ['workspace','captureId','baselineId'], read),
    tool('merchant_worldbank_review', 'Save the complete reviewed observation selection and native column projection against the current revision. Keep each original observation identity and an explicit original row for duplicate choices.',
      scoped({id,captureId:id,baselineId:id,title:{type:'string',maxLength:128},note:{type:'string',maxLength:100000},
        excludedKeys:{type:'array',items:{type:'string'}},choices:object,columns:{type:'array',items:{type:'string'}},
        expectedRevision:integer}), ['workspace','id','captureId','expectedRevision']),
    tool('merchant_worldbank_review_read', 'Read a saved review and page its original choices, excluded identities and revision history. Retain the full selection before replacing it.',
      scoped({id,...page}), ['workspace','id'], read),
    tool('merchant_worldbank_export', 'Prepare the original immutable handover and dataset files from the exact saved review revision. Repeating its original export ID reopens the same completion.',
      scoped({id,reviewId:id,expectedRevision:integer}), ['workspace','id','reviewId','expectedRevision']),
    tool('merchant_worldbank_export_read', 'Verify an original export and page its original file manifest. Use download_manifest and the receiver for the complete portable handover.',
      scoped({id,...page}), ['workspace','id'], read),
    tool('merchant_worldbank_merchant', 'Prepare an original retained export with a host-declared merchant profile. The native compiler and original publisher create the dataset candidate and merchant binding.',
      scoped({exportId:id,profile:alias}), ['workspace','exportId','profile']),
    tool('merchant_worldbank_publisher', 'Operate the original dataset publisher, SF82 release and SF88 customer acquisition. Staging uses host runtime settings; buyer sessions select a host buyerWorkspace alias. Preserve native reviews, intent/session IDs, revisions and generations across interruption.',
      scoped({action:{enum:[...publisherActions]},payload:object}), ['workspace','action'], {openWorld:true}),
    tool('merchant_worldbank_browser', 'Open or close the industrial browser on this same original model. Returns its private loopback URL. Closing the borrowed browser leaves the MCP-owned workspace open.',
      scoped({action:{enum:['open','close']},port:{type:'integer',minimum:0,maximum:65535}}),
      ['workspace','action']),
    tool('merchant_worldbank_file', 'Read a named original source export or publisher/customer file in SHA-pinned chunks. Continue with readId, expectedSha256 and nextOffset; the original file is loaded once per retained read.',
      scoped({kind:{enum:fileKinds},id,filename:{type:'string',maxLength:4096},...chunk}),
      ['workspace','kind','id'], read),
    tool('merchant_worldbank_file_release', 'Release a selected unfinished file read while retaining its original source.',
      scoped({readId:uuid}), ['workspace','readId'], {idempotent:true}),
    tool('merchant_worldbank_download_manifest', 'Inspect the deterministic receiving manifest for the six unchanged original edition files, including the complete handover ZIP with every source page.',
      scoped({exportId:id}), ['workspace','exportId'], read),
    tool('merchant_worldbank_download_file', 'Read one exact receiving-manifest file with both the original manifest hash and file hash pinned. Used by the original resumable merchant receiver.',
      scoped({exportId:id,file:{type:'string',maxLength:128},expectedManifestSha256:hash,...chunk}),
      ['workspace','exportId','file','expectedManifestSha256','expectedSha256'], read),
    tool('merchant_worldbank_download_file_release', 'Release this export’s unfinished retained-file snapshot.',
      scoped({exportId:id,readId:uuid}), ['workspace','exportId','readId'], {idempotent:true})
  ];
}

export { worldbankWorkspaceTools, alias, integer, hash, uuid, read, id, object, text, publisherActions, fileKinds };
