// MIT. Typed metadata over the original SAM workspace actions and retained receiving.
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const text = (maximum = 200, minimum = 1) => ({type: 'string', minLength: minimum, maxLength: maximum});
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({type: 'integer', minimum, maximum});
const choice = values => ({type: 'string', enum: values});
const object = (properties, required = []) => ({type: 'object', properties, required, additionalProperties: false});
const alias = {type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$'};
const hash = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const uuid = {type: 'string', pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};
const date = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const id = text(240), note = text(20000, 0);
const ids = {type: 'array', items: id, uniqueItems: true, maxItems: 5000000};
const deadline = {anyOf: [
  object({at: text(100), timeZone: text(100), reason: text(4000)}, ['at', 'timeZone', 'reason']),
  {type: 'null'},
]};
const filters = object({
  postedFrom: date, postedTo: date, noticeid: text(500), solnum: text(500), title: text(1000),
  ptype: {anyOf: [choice(['u','p','a','r','s','o','g','k','i']),
    {type: 'array', items: choice(['u','p','a','r','s','o','g','k','i']), minItems: 1, maxItems: 9, uniqueItems: true}]},
  organizationCode: text(500), organizationName: text(500), ncode: {type: 'string', pattern: '^\\d{1,6}$'},
  ccode: text(500), typeOfSetAside: text(500), state: text(500), zip: text(500), rdlfrom: date, rdlto: date,
}, ['postedFrom', 'postedTo']);
const query = {anyOf: [{type: 'string', maxLength: 20000},
  {type: 'object', additionalProperties: {anyOf: [{type: 'string'}, {type: 'number'}]}}]};
const envelope = {expectedRevision: integer(), requestId: text(200)};
export const SAM_MUTATION_TOOLS = Object.freeze({
  merchant_samgov_save_query: {action: 'save_query',
    description: 'Save the original named SAM query revision. Dates use YYYY-MM-DD; the native transport converts to GSA dates. Posted/deadline windows retain the original one-year rule and page-index semantics.',
    properties: {queryId: id, name: text(240), filters, pageSize: integer(1,1000), maxRecords: integer(1,5000000), sourceTerms: note},
    required: ['name','filters']},
  merchant_samgov_create_capture: {action: 'start_capture',
    description: 'Create or recover the original capture for the exact saved query revision. This retains its capture ID before acquisition; run that same capture with the separate run control.',
    properties: {queryId: id, queryRevision: integer(1), name: text(240)}, required: ['queryId','queryRevision']},
  merchant_samgov_resize_capture: {action: 'resize_capture',
    description: 'Increase the retained original capture capacity while keeping its exact query, page cursor, source receipts and capture ID.',
    properties: {captureId: id, maxRecords: integer(1,5000000)}, required: ['captureId','maxRecords']},
  merchant_samgov_save_selection: {action: 'save_selection',
    description: 'Save a named selection from one retained source edition. The exact notice IDs and original selection revision remain available to reviews, merchants and handoffs.',
    properties: {selectionId: id, editionId: id, name: text(240), noticeIds: ids, notes: note},
    required: ['editionId','name','noticeIds']},
  merchant_samgov_review_notice: {action: 'review_notice',
    description: 'Record qualification, owner, notes and an explicitly reviewed deadline against the original notice and edition. An absent or unqualified source timezone is never inferred.',
    properties: {editionId: id, noticeId: id, status: choice(['unreviewed','watching','qualified','declined','needs_review']),
      owner: text(240), notes: note, deadline}, required: ['editionId','noticeId','status','owner']},
  merchant_samgov_review_change: {action: 'review_change',
    description: 'Record a reviewed, follow-up or dismissed decision against the original before/after source editions and notice identity.',
    properties: {beforeEditionId: id, afterEditionId: id, noticeId: id,
      decision: choice(['reviewed','follow_up','dismissed']), owner: text(240), note},
    required: ['beforeEditionId','afterEditionId','noticeId','decision','owner','note']},
  merchant_samgov_create_handoff: {action: 'create_handoff',
    description: 'Freeze the original named handoff for a reviewed saved selection. It binds the source revision, selection revision, exact records, original files and full authored history.',
    properties: {name: text(240), selectionId: id, note}, required: ['name','selectionId']},
  merchant_samgov_capture_resources: {action: 'capture_resources', openWorld: true,
    description: 'Retain the selected notices’ actual issued description/attachment URLs using the original source transport, credential policy and limits. Inspect the retained result after an interrupted return.',
    properties: {editionId: id, noticeIds: ids, descriptions: {type: 'boolean'}, attachments: {type: 'boolean'},
      resourceUrls: {type: 'array', items: text(12000), uniqueItems: true, maxItems: 5000000}},
    required: ['editionId','noticeIds']},
  merchant_samgov_buyer_review: {action: 'buyer_review', openWorld: true,
    description: 'Read the actual existing seller offer for the retained merchant preparation and save its original offer identity. This uses the native buyer review operation.',
    properties: {publicationId: id, seller: text(4000), query}, required: ['publicationId','seller']},
  merchant_samgov_buyer_prepare: {action: 'prepare_buyer',
    description: 'Prepare the original buyer intent against its exact saved review, offer SHA and accepted option. The original buyer account and execution workflow consume this preparation.',
    properties: {publicationId: id, reviewId: id, intentId: id, acceptIndex: integer(), offerSha256: hash},
    required: ['publicationId','reviewId','intentId','acceptIndex','offerSha256']},
  merchant_samgov_prepare_opportunity: {action: 'prepare_opportunity',
    description: 'Receive the selected original SAM notice and retained issued files into the host-configured LGNDX opportunity workspace. Keep its original project ID/revision on continuation.',
    properties: {selectionId: id, noticeId: id, projectId: id, expectedProjectRevision: integer(),
      title: text(240), documentKind: choice(['rfi','sources_sought','solicitation','other']), deadline},
    required: ['selectionId','noticeId']},
});
export function samgovWorkspaceTools(tool) {
  const scoped = properties => ({workspace: alias, ...properties});
  const read = {readOnly: true, idempotent: true};
  const tools = [
    tool('merchant_samgov_status', 'List host-declared SAM workspaces and permitted retained inputs/merchant profiles, or inspect the connected original workspace. Every returned collection has its own total/nextOffset; page its retained source/history completely.',
      scoped({offset: integer(), limit: integer(1,1000)}), [], read),
    tool('merchant_samgov_connect', 'Attach to the same original SAM listener started by Applications. Re-read its private connection and authenticate its native state. A repeated connection to the same instance reuses it; after a changed start, inspect and reconnect explicitly.',
      scoped({expectedInstanceId: uuid}), ['workspace'], {idempotent: true}),
    tool('merchant_samgov_disconnect', 'Release this MCP attachment and its open file reads for the exact connected instance. Applications retains ownership of the original server, captures, writer and Stop operation.',
      scoped({instanceId: uuid}), ['workspace','instanceId'], {idempotent: true}),
    tool('merchant_samgov_browser', 'Return the private browser link for the currently connected original SAM workspace. The tab and typed tools use that same authenticated listener and source writer.',
      scoped({}), ['workspace'], read),
    tool('merchant_samgov_record', 'Read the original query, capture, edition, selection, handoff or publication by ID. Capture reads include original page attempts and pending request; edition/selection notices use returned paging.',
      scoped({id, offset: integer(), limit: integer(1,1000), search: text(1000,0)}), ['workspace','id'], read),
    tool('merchant_samgov_notice', 'Read an exact retained notice with its original source row, issued resources, deadline status, qualification reviews and change decisions.',
      scoped({editionId: id, noticeId: id}), ['workspace','editionId','noticeId'], read),
    tool('merchant_samgov_compare', 'Compare two original retained source editions, preserving their published-source coverage and exact added/removed/changed/unchanged records.',
      scoped({beforeEditionId: id, afterEditionId: id}), ['workspace','beforeEditionId','afterEditionId'], read),
    tool('merchant_samgov_capture_run', 'Run or resume the existing retained capture through the original server task owner. Reuses a running capture. The response is its actual task status; inspect the same capture after a lost response.',
      scoped({captureId: id}), ['workspace','captureId'], {idempotent: true, openWorld: true}),
    tool('merchant_samgov_capture_status', 'Read the original server task and retained capture identity without another acquisition.',
      scoped({captureId: id}), ['workspace','captureId'], read),
    tool('merchant_samgov_capture_pause', 'Ask the original capture owner to pause its same saved cursor. Read its status to observe the actual completed pause.',
      scoped({captureId: id}), ['workspace','captureId'], {idempotent: true}),
    tool('merchant_samgov_import', 'Import one host-declared, SHA-bound original source-action file containing import_notice, import_capture or retain_resource. The original parser/issued-URL validator keeps exact bytes and provenance; requestId/expectedRevision come from this reviewed mutation.',
      scoped({...envelope, sourceImport: alias, expectedSourceSha256: hash}),
      ['workspace','requestId','expectedRevision','sourceImport','expectedSourceSha256'], {idempotent: true}),
    tool('merchant_samgov_receive', 'Receive one host-declared complete original portable packet at its reviewed SHA. The native importer verifies every original object/version and reuses its existing matching history on a repeated receive.',
      scoped({sourceImport: alias, expectedSourceSha256: hash}),
      ['workspace','sourceImport','expectedSourceSha256'], {idempotent: true}),
    tool('merchant_samgov_prepare_merchant', 'Prepare the original selected-notice merchant using a host-declared reviewed profile of origin, route and payment terms. Retains the source selection and original publication identity.',
      scoped({...envelope, selectionId: id, profile: alias}),
      ['workspace','requestId','expectedRevision','selectionId','profile'], {idempotent: true}),
    tool('merchant_samgov_merchant_start', 'Start the exact retained merchant preparation on its original private-loopback seller. Reuses an existing running host; the original SAM server owns and drains it.',
      scoped({publicationId: id, port: integer(0,65535)}), ['workspace','publicationId'], {idempotent: true}),
    tool('merchant_samgov_merchant_stop', 'Close the original private seller for this retained publication and await its native drain.',
      scoped({publicationId: id}), ['workspace','publicationId'], {idempotent: true}),
    tool('merchant_samgov_export', 'Retain the exact original export bytes for a fixed workspace revision or named handoff. Save requestId before calling; exact retries return the already retained file descriptor. Formats preserve the native complete source packet and readable reports.',
      scoped({requestId: text(200), format: choice(['portable','html','markdown','notices','reviews','changes','sources']),
        revision: integer(1), selectionId: id, handoffId: id}),
      ['workspace','requestId','format'], {idempotent: true}),
    tool('merchant_samgov_exports', 'List completed exact exports retained by this configured customer operator, including their original source selection and download identities.',
      scoped({offset: integer(), limit: integer(1,1000)}), ['workspace'], read),
    tool('merchant_samgov_file', 'Read the exact original source or completed export in SHA-bound chunks. Continue readId/expectedSha256/nextOffset, or reopen the same retained identity after MCP restart. The original reader releases its descriptor at EOF.',
      scoped({kind: choice(['source','export']), id, readId: uuid, expectedSha256: hash,
        offset: integer(), limit: integer(1,MAX_RETAINED_CHUNK_BYTES)}), ['workspace','kind','id'], read),
    tool('merchant_samgov_file_release', 'Release one unfinished original file read for this configured workspace; retained source and export bytes remain available.',
      scoped({readId: uuid}), ['workspace','readId'], {idempotent: true}),
  ];
  for (const [name, definition] of Object.entries(SAM_MUTATION_TOOLS))
    tools.push(tool(name, definition.description, scoped({...envelope, ...definition.properties}),
      ['workspace','requestId','expectedRevision',...definition.required],
      {idempotent: true, ...(definition.openWorld ? {openWorld: true} : {})}));
  return tools;
}
