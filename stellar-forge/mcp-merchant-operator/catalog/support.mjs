// MIT. Original tool metadata; provider runtimes load only when selected.
import { CASE_STATUSES } from '../../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-statuses.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };

const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const text = maximum => ({ type: 'string', maxLength: maximum });

const object = properties => ({ type: 'object', properties, additionalProperties: false });

const metadataSchema = object({ merchant: text(480), owner: text(480), status: { enum: CASE_STATUSES },
  followUpOn: text(10), nextAction: text(2400), notes: text(16000) });

const termsSchema = { ...object({ workOrderRef: text(120), sellerDisplayName: text(200), relationshipOwner: text(200),
  proposedWindow: text(8192), delivery: object({ scope: text(8192), deliverables: text(8192), acceptanceCriteria: text(8192) }),
  merchantConsent: { ...object({ status: { enum: ['NOT_RECORDED', 'CONFIRMED'] }, receiptUrl: { type: ['string', 'null'], maxLength: 8192 } }), required: ['status'] },
  commercial: { ...object({ priceApproval: { enum: ['NOT_APPROVED', 'OWNER_APPROVED_PROPOSAL'] }, feeUsd: { type: ['number', 'null'] },
    costUsd: { type: ['number', 'null'] }, approvalReceiptUrl: { type: ['string', 'null'], maxLength: 8192 } }), required: ['priceApproval'] } }),
  required: ['merchantConsent', 'commercial'] };

const selected = { id: uuid, expectedRevision: digest };

const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };

const notificationStatuses = ['PENDING', 'RETRY', 'IN_FLIGHT', 'PAUSED', 'EXHAUSTED', 'DELIVERED', 'CANCELLED'];
const incidentSource = { ...alias, description: 'Original host-declared incident source ID. Required when multiple sources have no host default.' };
const sourceTools = new Set(['merchant_support_profiles', 'merchant_support_configure', 'merchant_support_watch_status',
  'merchant_support_watch_start', 'merchant_support_watch_stop', 'merchant_notifications', 'merchant_incident_notify',
  'merchant_notification_update', 'merchant_incidents', 'merchant_incident_ack', 'merchant_incident_case']);

function supportTools(tool) {
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_support_incident_sources', 'Inspect the original support connection mode, configured incident source IDs/labels, bound source-file digest and host default. Reads no arbitrary path and starts no watcher.', {}, [], read),
    tool('merchant_support_destination', 'Inspect the currently selected source notification configuration at its exact revision. Slack resolves the original host token and reads the actual authenticated workspace/channel; webhook reports configuration resolution. Sends no notification.',
      { incidentSource, expectedConfigRevision: { type: 'integer', minimum: 1 } }, ['expectedConfigRevision'], { ...read, openWorld: true }),
    tool('merchant_incident_view', 'Open one retained original incident with its current revision, last notification ID, sanitized events and actual advertised routes from before/after capture files. Returns capture issues without replacing the original files or observing a seller.',
      { incidentSource, id: uuid }, ['id'], read),
    tool('merchant_support_profiles', 'List host-declared SF93 registration profiles, or inspect one original compiled configuration, its file digest, current configuration revision and actual changes. Notification values remain environment references.',
      { profile: alias }, [], read),
    tool('merchant_support_configure', 'Apply an inspected host profile through the original SF93 configuration transaction. Requires its exact source digest and current configuration revision. After a lost reply, inspect the current configuration before another change.',
      { profile: alias, expectedSourceSha256: digest, expectedConfigRevision: { type: 'integer', minimum: 1 } }, ['profile', 'expectedSourceSha256', 'expectedConfigRevision']),
    tool('merchant_support_watch_status', 'Read the original watcher record and this MCP operator\'s actual ownership. A saved RUNNING record alone does not establish a live worker or ownership by this operator.', {}, [], read),
    tool('merchant_support_watch_start', 'Start the ORIGINAL SF93 watcher for the exact inspected configuration. It acquires the existing kernel lease, polls configured local merchant endpoints and sends the existing configured incident notifications. Does not start a seller or delivery worker.',
      { expectedConfigRevision: { type: 'integer', minimum: 1 }, expectedConfigHash: digest }, ['expectedConfigRevision', 'expectedConfigHash']),
    tool('merchant_support_watch_stop', 'Stop only the original watcher started by this MCP process, using its exact instance ID. Waits for its original final state write and lease release. An identical completed stop can be reopened.',
      { instanceId: uuid }, ['instanceId'], { idempotent: true }),
    tool('merchant_notifications', 'Page through original incident notification records without message bodies, destination URLs or signing keys. Includes actual attempt counts, state and retry reason for recovery.',
      { id: uuid, incidentId: uuid, status: { enum: notificationStatuses }, ...page }, [], read),
    tool('merchant_incident_notify', 'Queue a NEW original reminder for the exact incident revision and current destination. Pass the latest expectedNotificationId from merchant_incident_view, or null when none exists, to atomically reject duplicate reminders after a lost response. Source-file mode requires that guard; legacy single-store callers may omit it.',
      { id: uuid, expectedRevision: { type: 'integer', minimum: 1 }, expectedNotificationId: { anyOf: [uuid, { type: 'null' }] } }, ['id', 'expectedRevision']),
    tool('merchant_notification_update', 'Retry an original paused/exhausted notification or cancel an unfinished one, using its exact attempt count and named operator. Existing destination, in-flight and completed-event checks remain authoritative.',
      { id: uuid, expectedAttempts: { type: 'integer', minimum: 0 }, action: { enum: ['retry', 'cancel'] }, by: text(160) }, ['id', 'expectedAttempts', 'action', 'by']),
    tool('merchant_support_sources', 'List host-configured original handoffs/workspace templates, or inspect one with its exact file digest, saved mapping and retained runtime findings. Reads no arbitrary path and starts no observation.',
      { kind: { enum: ['handoff', 'workspace'] }, source: alias }, [], read),
    tool('merchant_incidents', 'Read the original SF93 incident store. Returns actual condition, revision, capture and notification state; does not poll a seller or send a notification.',
      { id: uuid, status: { enum: ['OPEN', 'ACKNOWLEDGED', 'RECOVERED', 'RETIRED'] }, ...page }, [], read),
    tool('merchant_incident_ack', 'Acknowledge an original OPEN incident with its exact revision and named operator. The existing watcher may deliver its configured acknowledgment notification. Recovery remains based on original observations.',
      { id: uuid, expectedRevision: { type: 'integer', minimum: 1 }, by: text(160), notes: text(2000) }, ['id', 'expectedRevision', 'by']),
    tool('merchant_incident_case', 'Save one exact original incident using its host-configured SF74 workspace template and retained route. Supply a new case UUID. An identical retry reuses the initial case version while the incident selection is current. After an interrupted reply, read that original case ID and history first, especially if the incident or saved case has advanced.',
      { id: uuid, incidentId: uuid, expectedIncidentRevision: { type: 'integer', minimum: 1 }, template: alias,
        expectedTemplateSha256: digest, routeId: text(160) }, ['id', 'incidentId', 'expectedIncidentRevision', 'template', 'expectedTemplateSha256', 'routeId']),
    tool('merchant_cases', 'Search original saved cases by text, work status or follow-up date, with their actual current revisions.',
      { q: text(1000), status: { enum: CASE_STATUSES }, dueOn: text(10), ...page }, [], read),
    tool('merchant_case_read', 'Reopen the current or a retained case revision, including original support review, exact source hashes and unfinished owner terms. Original source payloads stay in the private case store.',
      { id: uuid, revision: digest }, ['id'], read),
    tool('merchant_case_history', 'Page through original immutable case revisions; before is the nextBefore digest returned by a prior page.',
      { id: uuid, before: digest, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['id'], read),
    tool('merchant_case_import', 'Import an exact host-configured complete SF74 handoff as a new case, preserving all original source bytes, metadata and raw owner terms. Inspect its alias first; supply a new UUID and exact file digest.',
      { id: uuid, source: alias, expectedSourceSha256: digest }, ['id', 'source', 'expectedSourceSha256']),
    tool('merchant_case_update', 'Save owner-entered metadata or terms and workorder source choice as a new original case version. Uses the exact current revision; omitted fields and original captures are preserved. Recording a proposal does not send or accept it.',
      { ...selected, metadata: metadataSchema, terms: termsSchema, workorderSource: { enum: ['diagnostic', 'runtime'] }, baselineOnly: { type: 'boolean' } }, ['id', 'expectedRevision']),
    tool('merchant_case_restore', 'Restore a retained case revision as a new current version through the original writer. Preserves later versions in history and requires the current expected revision.',
      { ...selected, revision: digest }, ['id', 'expectedRevision', 'revision']),
    tool('merchant_case_workorder', 'Prepare the original SF77 workorder from an exact saved case revision, its selected original sources and recorded owner terms. Returns the original packet without seller, payment or contact calls.', selected, ['id', 'expectedRevision'], read),
    tool('merchant_case_export', 'Publish a private named export of the exact saved case, complete original support handoff and readable support report. includeWorkorder adds the same original SF77 packet, HTML and checklist. Export IDs never replace an existing delivery.',
      { ...selected, exportId: alias, includeWorkorder: { type: 'boolean' } }, ['id', 'expectedRevision', 'exportId']),
    tool('merchant_support_export_status', 'Inspect a named support export and verify the retained original files against its completion manifest. Reconcile an interrupted export before choosing a new ID.',
      { exportId: alias }, ['exportId'], read),
    tool('merchant_support_export_manifest', 'Read the original completion manifest and its exact file digest without rereading every exported payload. MANIFEST_RETAINED identifies the saved manifest; individual file retrieval verifies the original bytes. Includes this operator\'s active file reads.',
      { exportId: alias }, ['exportId'], read),
    tool('merchant_support_export_file', 'Retrieve a named original support export file in bounded base64 chunks. Pin the completion manifest and repeat the returned readId/expectedSha256 for continuation. After restart or expiry, omit readId and resume at the saved offset with the same digests. Does not regenerate an export.',
      { exportId: alias, file: { enum: [...exportNames, 'support-export.json'] }, expectedManifestSha256: digest,
        readId: uuid, expectedSha256: digest, offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
      ['exportId', 'file', 'expectedManifestSha256'], read),
    tool('merchant_support_export_file_release', 'Release this operator\'s unfinished verified support-file read. Its original export and case remain retained.',
      { exportId: alias, readId: uuid }, ['exportId', 'readId'], { idempotent: true }),
  ].map(value => sourceTools.has(value.name) ? { ...value, inputSchema: {
    ...value.inputSchema, properties: { ...value.inputSchema.properties, incidentSource }
  } } : value);
}

const exportNames = ['case.json', 'merchant-workspace.json', 'merchant-support.json', 'support.html',
  'owner-terms.json', 'packet.json', 'seller-packet.html', 'acceptance-checklist.md'];

export { supportTools, alias, digest, uuid, notificationStatuses, page, text, selected, metadataSchema, termsSchema, exportNames, object };
