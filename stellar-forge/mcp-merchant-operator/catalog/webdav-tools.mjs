// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const SHA256 = /^[a-f0-9]{64}$/;

const uuid = { type: 'string', pattern: UUID.source };

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const hash = { type: 'string', pattern: SHA256.source };

const object = { type: 'object', additionalProperties: true };

const shortText = { type: 'string', minLength: 1, maxLength: 200 };

const readOnly = { readOnly: true, idempotent: true };

const mutation = { operationId: uuid, expectedRevision: { type: 'integer', minimum: 0 }, expectedProfileSha256: hash };

const SOURCE_KINDS = ['source', 'listing', 'capture', 'edition', 'export', 'packet'];

const PUBLISHER_KINDS = ['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'];

const PUBLISHER_ACTIONS = [
  'publisher.status', 'publisher.preview', 'publisher.reviewDraft', 'publisher.publish',
  'publisher.activateSnapshot', 'publisher.collect', 'publisher.release.stage',
  'publisher.release.inspect', 'publisher.release.activate', 'publisher.release.rollback',
  'publisher.release.start', 'publisher.release.stop', 'publisher.buyer.review',
  'publisher.buyer.prepare', 'publisher.buyer.session', 'publisher.buyer.run',
  'publisher.buyer.recover', 'publisher.buyer.account', 'publisher.buyer.export',
];

function webDavWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, ...properties });
  const changed = properties => scoped({ ...mutation, ...properties });
  const required = ['workspace', 'operationId', 'expectedRevision'];
  const chunk = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  return [
    tool('merchant_webdav_status', 'List host-declared source, merchant, buyer and receiving profiles, or page the exact opened WebDAV workspace. Returned pagination covers all retained arrays; original operations expose the newest 100 records and remain readable by UUID.',
      scoped({ offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), [], readOnly),
    tool('merchant_webdav_open', 'Open the original WebDAV workspace and its native industrial browser in one owned instance. Reopening retains original sources, captures, mappings, editions, publisher and customer operation IDs.',
      scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_webdav_close', 'Close the exact MCP-owned WebDAV instance, cancel source work, drain original publishers and releases, close file reads and release its native lease.',
      scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_webdav_source', 'Save a selected host-declared source profile as an original retained revision. The source configuration contains environment reference names; credentials remain in the host process.',
      changed({ profile: alias }), [...required, 'profile']),
    tool('merchant_webdav_catalogue', 'Capture the configured WebDAV collection through the original PROPFIND implementation. Retains the response and individual property outcomes. Use merchant_webdav_listing to page these same saved bytes.',
      changed({ href: { type: 'string', maxLength: 8192 }, depth: { enum: [0, 1] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }), required, { openWorld: true }),
    tool('merchant_webdav_listing', 'Page an already retained original WebDAV listing without another provider request. Keep its sourceId, listing id, original href, ETag and size for file selection.',
      scoped({ sourceId: uuid, id: uuid, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }), ['workspace', 'sourceId', 'id'], readOnly),
    tool('merchant_webdav_capture', 'Start, resume or sample the original conditional file capture. Start takes the exact original selection; resume keeps captureId and verified prefix. Sample retains the complete source record count and chosen sample.',
      changed({ action: { enum: ['start', 'resume', 'sample'] }, selection: object, captureId: uuid,
        format: { enum: ['csv', 'json', 'ndjson'] }, recordsPointer: { type: 'string', maxLength: 2048 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), [...required, 'action'], { openWorld: true }),
    tool('merchant_webdav_mapping', 'Save the complete reviewed native projection against its original capture SHA256. Original SFTP scalar/null/pointer rules and dataset validation remain authoritative.',
      changed({ captureId: uuid, expectedCaptureSha256: hash, projection: object }), [...required, 'captureId', 'expectedCaptureSha256', 'projection']),
    tool('merchant_webdav_edition', 'Build a complete native CSV edition from a saved mapping and explicit dataset contract, or export a reviewed edition with its original merchant terms. Original files and snapshot IDs remain retained.',
      changed({ action: { enum: ['build', 'export'] }, mappingId: uuid, dataset: object, review: object,
        editionId: uuid, merchantId: uuid, reviewer: shortText, note: { type: 'string', maxLength: 4000 } }), [...required, 'action']),
    tool('merchant_webdav_preview', 'Query the exact original retained dataset edition. Large complete results are available through merchant_webdav_file with kind result and the returned read key.',
      scoped({ editionId: uuid, query: { type: 'string', maxLength: 8192 } }), ['workspace', 'editionId'], readOnly),
    tool('merchant_webdav_merchant', 'Save a selected host-declared merchant profile for an exact edition through the original native seller compiler. Retains the public origin, route, full payment terms and reviewer.',
      changed({ editionId: uuid, profile: alias, reviewer: shortText, note: { type: 'string', maxLength: 4000 } }), [...required, 'editionId', 'profile', 'reviewer']),
    tool('merchant_webdav_publisher', 'Prepare an original publisher from a retained export or invoke its native release/customer workflow. Uses host-selected runtime and buyer directory aliases. Keep the original review, page attempt, policy and ledger identities during recovery.',
      changed({ action: { enum: ['publisher.prepare', ...PUBLISHER_ACTIONS] }, productId: uuid, payload: object }), [...required, 'action'], { openWorld: true }),
    tool('merchant_webdav_operation', 'Read an original operation, capture, mapping or publisher by its retained UUID while source work is running. Complete large operation results use the result-file selector returned by this tool.',
      scoped({ kind: { enum: ['operation', 'capture', 'mapping', 'publisher'] }, id: uuid }), ['workspace', 'kind', 'id'], readOnly),
    tool('merchant_webdav_cancel', 'Request cancellation of this original active operation immediately. Inspect its native outcome and retain the same capture or publisher identity.',
      scoped({ operationId: uuid }), ['workspace', 'operationId'], { idempotent: true }),
    tool('merchant_webdav_packet', 'Create the original portable WebDAV source packet. The original source engine retains exact files, IDs and source metadata; receiving prepares its own native publisher on the destination host.',
      changed({}), required),
    tool('merchant_webdav_receive', 'Inspect or receive a host-declared SHA256-pinned original source packet into its declared closed workspace. Completed same-packet receiving is read back; an incomplete original destination remains available for inspection.',
      scoped({ action: { enum: ['inspect', 'receive'] }, packet: alias, expectedSha256: hash,
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), ['workspace', 'action', 'packet', 'expectedSha256']),
    tool('merchant_webdav_file', 'Read complete original source, listing, capture, edition, merchant export, source packet, native publisher file or retained result in verified chunks. Continue with readId, expectedSha256 and nextOffset. Restart resumes the same retained native source with expectedSha256 and offset.',
      scoped({ kind: { enum: [...SOURCE_KINDS, 'publisher', 'result'] }, id: { type: 'string', minLength: 1, maxLength: 200 },
        filename: { type: 'string', maxLength: 160 }, sourceId: uuid, productId: uuid,
        publisherKind: { enum: PUBLISHER_KINDS }, ...chunk }), ['workspace', 'kind', 'id'], readOnly),
    tool('merchant_webdav_file_release', 'Release an unfinished transport read. The original native source, packet, result or customer file remains retained.',
      scoped({ readId: uuid }), ['workspace', 'readId'], { idempotent: true }),
  ];
}

export { webDavWorkspaceTools, alias, mutation, hash, uuid, readOnly, object, shortText, PUBLISHER_ACTIONS, SOURCE_KINDS, PUBLISHER_KINDS, SHA256, UUID };

export function webDavBindingSelection(tool, args) {
  if (tool === 'merchant_webdav_source') return { kind: 'source', profile: args.profile };
  if (tool === 'merchant_webdav_merchant') return { kind: 'merchant', profile: args.profile };
  if (tool === 'merchant_webdav_publisher' && args.action === 'publisher.release.stage')
    return { kind: 'runtime', profile: null };
  if (tool === 'merchant_webdav_publisher' && args.action === 'publisher.buyer.session')
    return { kind: 'buyer', profile: args.payload?.buyerWorkspace };
  return null;
}
