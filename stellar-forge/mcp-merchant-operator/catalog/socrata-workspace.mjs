// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const text = { type: 'string', minLength: 1, maxLength: 200 };

const object = { type: 'object', additionalProperties: true };

const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const read = { readOnly: true, idempotent: true };

const publisherActions = new Set([
  'publisher.status', 'publisher.prepare', 'publisher.preview', 'publisher.reviewDraft', 'publisher.publish',
  'publisher.activateSnapshot', 'publisher.collect', 'publisher.release.stage', 'publisher.release.inspect',
  'publisher.release.activate', 'publisher.release.rollback', 'publisher.release.start', 'publisher.release.stop',
  'publisher.buyer.review', 'publisher.buyer.prepare', 'publisher.buyer.session', 'publisher.buyer.run',
  'publisher.buyer.recover', 'publisher.buyer.account', 'publisher.buyer.export'
]);

function socrataWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, ...properties });
  const chunk = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  return [
    tool('merchant_socrata_status', 'List declared source/customer workspaces, or read an opened original workspace and publisher. Retains source, capture, edition, export and acquisition identities. Histories page from the oldest retained entry; use the returned offsets.',
      scoped({ offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), [], read),
    tool('merchant_socrata_open', 'Open the declared original Socrata operator under its existing workspace lease. Reuses the same instance on repeat. The original publisher opens lazily when its first action is chosen.',
      scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_socrata_close', 'Close this exact process-owned Socrata instance after accepted operations and its borrowed browser drain. The original source, publisher and customer stores remain available for reopening.',
      scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_socrata_source', 'Configure or inspect a source, or search its actual provider catalog. Domains must be host-declared. Configure uses the original source schema; inspect/search contact the real provider.',
      scoped({ action: { enum: ['configure', 'inspect', 'search'] }, source: object, query: { type: 'string', maxLength: 1000 },
        domain: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }),
      ['workspace', 'action'], { openWorld: true }),
    tool('merchant_socrata_capture', 'Start, advance, pause or resume the same original capture, or import a host-declared complete source manifest. Inspect retained state after a lost response. Advance stores each actual page before its next request; resume keeps the native capture ID.',
      scoped({ action: { enum: ['start', 'advance', 'pause', 'resume', 'import'] },
        pages: { type: 'integer', minimum: 1, maximum: 100 }, sourceImport: alias }),
      ['workspace', 'action'], { openWorld: true }),
    tool('merchant_socrata_mapping', 'Save the complete reviewed native dataset mapping: source/output fields, explicit types/null rules, identity columns, filters, ranges, sorts and page sizes. The original mapper validates actual source values when building the edition.',
      scoped({ mapping: object }), ['workspace', 'mapping']),
    tool('merchant_socrata_edition', 'Build an edition from the complete retained capture and saved mapping, or activate a retained edition by its original ID. Uses the original CSV dataset engine and comparison history.',
      scoped({ action: { enum: ['build', 'activate'] }, editionId: text }), ['workspace', 'action']),
    tool('merchant_socrata_query', 'Run the selected edition through the original native query, projection, sort and cursor engine. Saves the exact accepted query and unchanged continuation for that edition.',
      scoped({ query: { anyOf: [object, { type: 'string', maxLength: 16384 }] } }), ['workspace', 'query']),
    tool('merchant_socrata_merchant', 'Prepare the selected native edition using a host-declared profile of actual public merchant terms. The original seller compiler supplies the generated configuration.',
      scoped({ profile: alias }), ['workspace', 'profile']),
    tool('merchant_socrata_export', 'Create the original complete portable source/customer package and its CSV, configuration, provenance, saved-query and merchant files. Inspect existing exports after a lost response before choosing another export.',
      scoped({}), ['workspace']),
    tool('merchant_socrata_restore', 'Restore a host-declared complete portable package into this original empty workspace. The original importer verifies all retained source files, native snapshots and saved selection.',
      scoped({ sourceImport: alias }), ['workspace', 'sourceImport']),
    tool('merchant_socrata_file', 'Read an exact original source export or publisher customer file in complete verified chunks. The first chunk returns its SHA-256. Continue with readId, expectedSha256 and nextOffset; the shared retained reader loads the original file once and releases its snapshot at EOF.',
      scoped({ kind: { enum: ['source-export', 'draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'] },
        id: text, filename: { type: 'string', maxLength: 160 }, ...chunk }), ['workspace', 'kind', 'id'], read),
    tool('merchant_socrata_file_release', 'Release a selected unfinished retained-file read. Its original source export remains available.',
      scoped({ readId: uuid }), ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_socrata_publisher', 'Use the original dataset publisher, SF82 release lifecycle or SF88 acquisition. Prepare selects exportId from this workspace. Release staging uses host runtime settings. Buyer sessions select a host buyerWorkspace alias; original reviews, policy, ledger and page attempts govern execution. Explicit unpaid-page continuation uses publisher.buyer.run payload retryUnpaid:true and expectedAttemptSha256 from the original session report.',
      scoped({ action: { enum: [...publisherActions] }, payload: object }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_socrata_browser', 'Open or close the industrial browser over this exact original operator object and its lazy publisher. Returns a private local session URL. Closing this borrowed browser leaves the MCP-owned operator open.',
      scoped({ action: { enum: ['open', 'close'] }, port: { type: 'integer', minimum: 0, maximum: 65535 } }), ['workspace', 'action']),
  ];
}

export { socrataWorkspaceTools, alias, hash, uuid, read, object, text, publisherActions };
