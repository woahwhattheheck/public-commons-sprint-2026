// MIT. Configured MCP access to the original incident, case and workorder lifecycle.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { incidentStatus, acknowledgeIncident, exportIncident, configureIncidents, remindIncident,
  operateNotification } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-operator.mjs';
import { readPrivateFile, openIncidentStore } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-store.mjs';
import { compileConfig as compileWatchConfig, configHash as watchConfigHash } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/incident-config.mjs';
import { runIncidentWatch } from '../../stellar/scf-starforge-20261009/sf93-seller-support-bundle/watch.mjs';
import { openCaseStore, caseMetadata, CASE_STATUSES } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-store.mjs';
import { parseWorkspace, serializeWorkspace, MAX_WORKSPACE_BYTES } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs';
import { importRuntimeHandoff, exportRuntimeHandoff, reviewRuntime, MAX_HANDOFF_BYTES } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';
import { termsDraftFromDocument, termsDocumentFromDraft } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/terms-editor.mjs';
import { workorderFromSources } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs';
import { failure, exact, identifier, writePrivate, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const json = value => JSON.stringify(value, null, 2) + '\n';
const DRAFT_SCHEMA = 'stellar-forge.merchant-terms-draft.v1';
const EXPORT_SCHEMA = 'stellar-forge.merchant-support-export.v1';
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
export function supportTools(tool) {
  const read = { readOnly: true, idempotent: true };
  return [
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
    tool('merchant_incident_notify', 'Queue a NEW original metadata-only reminder for the exact incident revision. This explicitly selects the currently configured notification destination; inspect current notification records after an interrupted reply.',
      { id: uuid, expectedRevision: { type: 'integer', minimum: 1 } }, ['id', 'expectedRevision']),
    tool('merchant_notification_update', 'Retry an original paused/exhausted notification or cancel an unfinished one, using its exact attempt count and named operator. Existing destination, in-flight and completed-event checks remain authoritative.',
      { id: uuid, expectedAttempts: { type: 'integer', minimum: 0 }, action: { enum: ['retry', 'cancel'] }, by: text(160) }, ['id', 'expectedAttempts', 'action', 'by']),
    tool('merchant_support_sources', 'List host-configured original handoffs/workspace templates, or inspect one with its exact file digest, saved mapping and retained runtime findings. Reads no arbitrary path and starts no observation.',
      { kind: { enum: ['handoff', 'workspace'] }, source: alias }, [], read),
    tool('merchant_incidents', 'Read the original SF93 incident store. Returns actual condition, revision, capture and notification state; does not poll a seller or send a notification.',
      { id: uuid, status: { enum: ['OPEN', 'ACKNOWLEDGED', 'RECOVERED', 'RETIRED'] }, ...page }, [], read),
    tool('merchant_incident_ack', 'Acknowledge an original OPEN incident with its exact revision and named operator. The existing watcher may deliver its configured acknowledgment notification. Recovery remains based on original observations.',
      { id: uuid, expectedRevision: { type: 'integer', minimum: 1 }, by: text(160), notes: text(2000) }, ['id', 'expectedRevision', 'by']),
    tool('merchant_incident_case', 'Export one exact original incident through SF93 using a host-configured SF74 workspace template and explicit route, then retain it as a new original support case. Supply a new UUID; an identical retry reuses its case version.',
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
  ];
}
function expected(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw failure('INVALID_PARAMS', 'Use the exact inspected SHA-256 or case revision.');
  return value;
}
function caseId(value) {
  if (typeof value !== 'string' || !new RegExp(uuid.pattern).test(value)) throw failure('INVALID_CASE_ID', 'Use an original case UUID.');
  return value;
}
function configurationRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw failure('INVALID_PARAMS', 'Use the exact current original configuration revision.');
  return value;
}
function originalWatchError(error) {
  if (/^[A-Z][A-Z0-9_]+$/.test(error.code ?? '')) return error.code;
  if (/^(SF93|FLEET)_[A-Z0-9_]+$/.test(error.message ?? '')) return error.message;
  return 'INCIDENT_WATCH_FAILED';
}
function configurationChanges(before, after) {
  const prior = new Map(before.merchants.map(row => [row.id, row])), next = new Map(after.merchants.map(row => [row.id, row]));
  return { addedMerchants: [...next.keys()].filter(id => !prior.has(id)),
    removedMerchants: [...prior.keys()].filter(id => !next.has(id)),
    changedMerchants: [...next.keys()].filter(id => prior.has(id) && JSON.stringify(prior.get(id)) !== JSON.stringify(next.get(id))),
    merchantOrderChanged: JSON.stringify([...prior.keys()]) !== JSON.stringify([...next.keys()]),
    settings: Object.keys(after).filter(key => !['schema', 'merchants'].includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])) };
}
function draftTerms(workspace) {
  if (!workspace.termsText) throw failure('CASE_TERMS_REQUIRED', 'Record the owner terms in this case before creating its workorder.');
  const value = JSON.parse(workspace.termsText);
  exact(value, ['schema', 'values'], ['schema', 'values']);
  if (value.schema !== DRAFT_SCHEMA) throw failure('CASE_TERMS_INVALID', 'Open this case in the original support console and review its terms.');
  return termsDocumentFromDraft(value.values);
}
function ownerDraft(terms) {
  exact(terms, Object.keys(termsSchema.properties), termsSchema.required);
  exact(terms.merchantConsent, Object.keys(termsSchema.properties.merchantConsent.properties), ['status']);
  exact(terms.commercial, Object.keys(termsSchema.properties.commercial.properties), ['priceApproval']);
  const values = termsDraftFromDocument(terms);
  for (const [key, value] of Object.entries(values)) {
    if (value.length > 8192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
        !['deliveryScope', 'deliverables', 'acceptanceCriteria'].includes(key) && /[\r\n\t]/.test(value))
      throw failure('INVALID_PARAMS', 'Owner terms must reopen in their original form fields. Use delivery fields for multiline text.');
  }
  return JSON.stringify({ schema: DRAFT_SCHEMA, values });
}
function sourcePacket(record, workspace) {
  const terms = draftTerms(workspace), inputs = { terms: Buffer.from(json(terms)).toString('base64') };
  if (workspace.workorderSource === 'runtime') {
    if (!record.supportText) throw failure('CASE_RUNTIME_REQUIRED', 'This case has no retained runtime capture.');
    inputs.supportText = record.supportText; inputs.inputs = workspace.inputs;
  } else {
    inputs.before = workspace.sources.before;
    if (!workspace.baselineOnly && workspace.sources.after) {
      inputs.after = workspace.sources.after;
      if (Boolean(workspace.sources.postBefore) !== Boolean(workspace.sources.postAfter))
        throw failure('CASE_SOURCE_PAIR_REQUIRED', 'Keep both original browser checks or clear the unpaired check in the support console.');
      if (workspace.sources.postBefore) { inputs.postBefore = workspace.sources.postBefore; inputs.postAfter = workspace.sources.postAfter; }
    }
  }
  const result = workorderFromSources(inputs);
  result.packet.caseSource = { id: record.id, revision: record.revision, workspaceSha256: sha(record.workspaceText),
    supportSha256: record.supportText === null ? null : sha(record.supportText) };
  return { ...result, terms };
}
async function caseView(record) {
  const { workspaceText, supportText, ...summary } = record, workspace = await parseWorkspace(workspaceText);
  let terms = null, termsIssue = null;
  try { terms = draftTerms(workspace); } catch (error) { termsIssue = error.code ?? 'CASE_TERMS_DRAFT_INCOMPLETE'; }
  return { ...summary, workorderSource: workspace.workorderSource ?? 'diagnostic', baselineOnly: workspace.baselineOnly,
    workspaceSha256: sha(workspaceText), supportSha256: supportText === null ? null : sha(supportText),
    terms, termsIssue, termsText: workspace.termsText,
    runtimeReview: supportText === null ? null : reviewRuntime(supportText, workspace.inputs) };
}
const exportNames = ['case.json', 'merchant-workspace.json', 'merchant-support.json', 'support.html',
  'owner-terms.json', 'packet.json', 'seller-packet.html', 'acceptance-checklist.md'];

/** Same original completion format for host verification and client persistence. */
export function parseSupportExportManifest(bytes, exportId) {
  identifier(exportId, 'Export ID');
  if (bytes.length > 65000) throw failure('SUPPORT_EXPORT_INVALID', 'The original support export manifest is oversized.');
  let manifest;
  try { manifest = JSON.parse(decode(bytes)); }
  catch { throw failure('SUPPORT_EXPORT_INVALID', 'The original support export manifest is not valid UTF-8 JSON.'); }
  const invalid = () => { throw failure('SUPPORT_EXPORT_INVALID', 'The original support export manifest is inconsistent.'); };
  if (manifest?.schema !== EXPORT_SCHEMA || manifest.exportId !== exportId || !Array.isArray(manifest.files) ||
      manifest.files.length < 2 || manifest.files.length > exportNames.length || typeof manifest.workorderIncluded !== 'boolean' ||
      !manifest.case || !new RegExp(uuid.pattern).test(manifest.case.id) || !new RegExp(digest.pattern).test(manifest.case.revision) ||
      !new RegExp(digest.pattern).test(manifest.case.workspaceSha256) ||
      manifest.case.supportSha256 !== null && !new RegExp(digest.pattern).test(manifest.case.supportSha256)) invalid();
  const names = new Set();
  for (const file of manifest.files) {
    if (!file || !exportNames.includes(file.name) || names.has(file.name) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_HANDOFF_BYTES ||
        typeof file.sha256 !== 'string' || !new RegExp(digest.pattern).test(file.sha256)) invalid();
    names.add(file.name);
  }
  if (!names.has('case.json') || !names.has('merchant-workspace.json') ||
      manifest.files.find(file => file.name === 'merchant-workspace.json').sha256 !== manifest.case.workspaceSha256 ||
      ['merchant-support.json', 'support.html'].some(name => names.has(name) !== (manifest.case.supportSha256 !== null)) ||
      ['owner-terms.json', 'packet.json', 'seller-packet.html', 'acceptance-checklist.md'].some(name => names.has(name) !== manifest.workorderIncluded)) invalid();
  return manifest;
}
function exportFileType(name) {
  return name.endsWith('.json') ? 'application/json' : name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8';
}

export class MerchantSupport {
  #config; #store; #watch = null; #lastWatchExit = null; #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'SUPPORT' });
  constructor(config) { this.#config = config; }
  get summary() {
    const value = this.#config.support;
    return { configured: Boolean(value), incidentsConfigured: Boolean(value?.incidentsDirectory),
      fileReads: this.#reads.summary,
      watcher: { ownedInstanceId: this.#watch?.instanceId ?? null, state: this.#watch?.state ?? 'NOT_OWNED', lastExit: this.#lastWatchExit },
      profiles: Object.entries(value?.profiles ?? {}).map(([profile, entry]) => ({ profile, label: entry.label })),
      sources: value ? ['handoffs', 'workspaces'].flatMap(kind => Object.entries(value[kind]).map(([source, entry]) =>
        ({ kind: kind === 'handoffs' ? 'handoff' : 'workspace', source, label: entry.label }))) : [] };
  }
  #configured() {
    if (!this.#config.support) throw failure('SUPPORT_NOT_CONFIGURED', 'Add supportConnection to the host merchant configuration, then restart this MCP operator.');
    return this.#config.support;
  }
  async #cases() { return this.#store ??= openCaseStore(this.#configured().casesDirectory); }
  #incidents() {
    const directory = this.#configured().incidentsDirectory;
    if (!directory) throw failure('INCIDENTS_NOT_CONFIGURED', 'Register the existing SF93 incident directory in the host support connection.');
    return directory;
  }
  async #profile(profile, sourceDigest) {
    const entry = (this.#configured().profiles ?? {})[identifier(profile, 'Support profile alias')];
    if (!entry) throw failure('SUPPORT_PROFILE_NOT_FOUND', 'Choose a host profile returned by merchant_support_profiles.');
    const bytes = await readPrivateFile(entry.file, 65536), sourceSha256 = sha(bytes);
    if (sourceDigest !== undefined && sourceSha256 !== expected(sourceDigest))
      throw failure('SUPPORT_SOURCE_CHANGED', 'The configured profile changed. Inspect its actual original configuration before applying it.');
    const configuration = compileWatchConfig(JSON.parse(decode(bytes)));
    return { profile, label: entry.label, sourceSha256, configHash: watchConfigHash(configuration), configuration };
  }
  async #profiles(profile) {
    const state = await (await openIncidentStore(this.#incidents())).read();
    const current = { configRevision: state.configRevision, configHash: state.configHash, configuration: state.config };
    if (profile === undefined) return { profiles: this.summary.profiles, current };
    const selected = await this.#profile(profile);
    return { ...selected, current, matchesCurrent: selected.configHash === state.configHash,
      changes: configurationChanges(state.config, selected.configuration) };
  }
  async #watchStatus() {
    const state = await incidentStatus({ directory: this.#incidents() });
    return { schema: 'stellar-forge.merchant-support-watch.v1', configRevision: state.configRevision,
      configHash: state.configHash, worker: state.worker,
      owned: this.#watch ? { instanceId: this.#watch.instanceId, state: this.#watch.state,
        startedConfiguration: this.#watch.startedConfiguration } : null,
      lastOwnedExit: this.#lastWatchExit };
  }
  #watchExited(handle, error) {
    handle.state = error ? 'FAILED' : 'STOPPED';
    this.#lastWatchExit = { instanceId: handle.instanceId, state: handle.state,
      completedAt: new Date().toISOString(), code: error ? originalWatchError(error) : null };
    if (this.#watch === handle) this.#watch = null;
  }
  async #startWatch(args) {
    const directory = this.#incidents();
    configurationRevision(args.expectedConfigRevision); expected(args.expectedConfigHash);
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'Merchant support is closing.');
    if (this.#watch) throw failure('INCIDENT_WATCH_ALREADY_OWNED', 'This operator already owns a watcher. Read merchant_support_watch_status.');
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const handle = { controller: new AbortController(), instanceId: null, state: 'STARTING', startedConfiguration: null, done: null };
    this.#watch = handle;
    handle.done = runIncidentWatch({ directory, signal: handle.controller.signal,
      expectedConfigRevision: args.expectedConfigRevision, expectedConfigHash: args.expectedConfigHash,
      onReady: value => {
        handle.instanceId = value.instanceId; handle.state = 'RUNNING';
        handle.startedConfiguration = { configRevision: value.configRevision, configHash: value.configHash };
        resolveReady();
      } }).then(result => {
        this.#watchExited(handle);
        if (!handle.instanceId) rejectReady(failure('INCIDENT_WATCH_NOT_STARTED', 'The original watcher ended before it became ready.'));
        return result;
      }, error => { this.#watchExited(handle, error); rejectReady(error); throw error; });
    // Keep a background failure visible in status without an unhandled rejection.
    handle.done.catch(() => {});
    await ready;
    return this.#watchStatus();
  }
  async #stopWatch(instanceId) {
    caseId(instanceId);
    const handle = this.#watch;
    if (!handle && this.#lastWatchExit?.instanceId === instanceId && this.#lastWatchExit.state === 'STOPPED')
      return { ...await this.#watchStatus(), unchanged: true };
    if (!handle || handle.instanceId !== instanceId)
      throw failure('INCIDENT_WATCH_INSTANCE_CONFLICT', 'This MCP operator does not own that watcher instance. Read merchant_support_watch_status.');
    handle.state = 'STOPPING'; handle.controller.abort(); await handle.done;
    return this.#watchStatus();
  }
  async #notifications(args) {
    const state = await incidentStatus({ directory: this.#incidents() }), offset = args.offset ?? 0, limit = args.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        args.status !== undefined && !notificationStatuses.includes(args.status)) throw failure('INVALID_PARAMS', 'Use a valid notification state and page.');
    if (args.id !== undefined) caseId(args.id);
    if (args.incidentId !== undefined) caseId(args.incidentId);
    const found = state.notifications.filter(row => (args.id === undefined || row.id === args.id) &&
      (args.incidentId === undefined || row.incidentId === args.incidentId) && (args.status === undefined || row.status === args.status));
    return { directoryRevision: state.directoryRevision, notifications: found.slice(offset, offset + limit),
      total: found.length, offset, limit, nextOffset: offset + limit < found.length ? offset + limit : null,
      notificationCapacityEvents: state.notificationCapacityEvents };
  }
  async #input(kind, source, digest) {
    if (!['handoff', 'workspace'].includes(kind)) throw failure('INVALID_PARAMS', 'Choose handoff or workspace.');
    const entry = this.#configured()[kind === 'handoff' ? 'handoffs' : 'workspaces'][identifier(source, 'Support source alias')];
    if (!entry) throw failure('SUPPORT_SOURCE_NOT_FOUND', 'Choose an alias returned by merchant_support_sources.');
    const bytes = await readPrivateFile(entry.file, kind === 'handoff' ? MAX_HANDOFF_BYTES : MAX_WORKSPACE_BYTES);
    const sourceSha256 = sha(bytes);
    if (digest !== undefined && sourceSha256 !== expected(digest)) throw failure('SUPPORT_SOURCE_CHANGED', 'The configured input changed. Inspect its actual digest and mapping before importing it.');
    const value = kind === 'handoff' ? await importRuntimeHandoff(decode(bytes)) : { workspaceText: decode(bytes), supportText: null, metadata: {} };
    await parseWorkspace(value.workspaceText);
    return { ...value, kind, source, label: entry.label, sourceSha256, bytes: bytes.length, file: entry.file };
  }
  async #selected(args) {
    expected(args.expectedRevision);
    const record = await (await this.#cases()).read(caseId(args.id));
    if (record.currentRevision !== args.expectedRevision) throw failure('CASE_CONFLICT', 'A newer original case revision exists. Reopen the case before this operation.');
    return record;
  }
  async #update(args) {
    const record = await (await this.#cases()).read(caseId(args.id), expected(args.expectedRevision)), workspace = await parseWorkspace(record.workspaceText);
    if (!['metadata', 'terms', 'workorderSource', 'baselineOnly'].some(key => Object.hasOwn(args, key)))
      throw failure('INVALID_PARAMS', 'Provide a case metadata, terms or source-choice change.');
    if (args.workorderSource !== undefined && !['runtime', 'diagnostic'].includes(args.workorderSource) ||
        args.baselineOnly !== undefined && typeof args.baselineOnly !== 'boolean') throw failure('INVALID_PARAMS', 'Invalid saved workorder choice.');
    const metadata = args.metadata === undefined ? record.metadata : caseMetadata({ ...record.metadata, ...args.metadata });
    if (args.metadata !== undefined) exact(args.metadata, Object.keys(metadataSchema.properties));
    const next = { name: workspace.name, inputs: workspace.inputs, sources: workspace.sources, termsText: workspace.termsText,
      baselineOnly: args.baselineOnly ?? workspace.baselineOnly, workorderSource: args.workorderSource ?? workspace.workorderSource ?? 'diagnostic' };
    if (args.terms !== undefined) next.termsText = ownerDraft(args.terms);
    // Keep the original save timestamp: metadata/terms updates do not change source observations,
    // and an identical request can use the original case writer's lost-response retry handling.
    const workspaceText = ['terms', 'workorderSource', 'baselineOnly'].some(key => Object.hasOwn(args, key))
      ? await serializeWorkspace(next, { now: workspace.savedAt }) : record.workspaceText;
    return (await this.#cases()).save({ id: args.id, expectedRevision: args.expectedRevision,
      workspaceText, supportText: record.supportText, metadata });
  }
  async #export(args) {
    const record = await this.#selected(args), workspace = await parseWorkspace(record.workspaceText);
    if (args.includeWorkorder !== undefined && typeof args.includeWorkorder !== 'boolean') throw failure('INVALID_PARAMS', 'includeWorkorder must be a boolean.');
    const generated = args.includeWorkorder ? sourcePacket(record, workspace) : null;
    const { workspaceText, supportText, ...summary } = record;
    const files = [['case.json', json(summary)], ['merchant-workspace.json', workspaceText]];
    if (supportText !== null) {
      const handoff = await exportRuntimeHandoff({ workspaceText, supportText, metadata: record.metadata });
      files.push(['merchant-support.json', handoff.handoff], ['support.html', handoff.html]);
    }
    if (generated) files.push(['owner-terms.json', json(generated.terms)], ['packet.json', json(generated.packet)],
      ['seller-packet.html', generated.html], ['acceptance-checklist.md', generated.checklist]);
    const exportId = identifier(args.exportId, 'Export ID'), root = await privateSupportDirectory(this.#config.exportsDirectory), folder = join(root, exportId);
    const manifest = { schema: EXPORT_SCHEMA, exportId, createdAt: new Date().toISOString(),
      case: { id: record.id, revision: record.revision, workspaceSha256: sha(workspaceText), supportSha256: supportText === null ? null : sha(supportText) },
      workorderIncluded: Boolean(generated), files: files.map(([name, body]) => ({ name, bytes: Buffer.byteLength(body), sha256: sha(body) })) };
    await mkdir(folder, { mode: 0o700 });
    for (const [name, body] of files) await writePrivate(join(folder, name), body);
    // Last, create-only: absence means an interrupted export, never a completed handoff.
    await writePrivate(join(folder, 'support-export.json'), manifest);
    return { ...manifest, state: 'COMPLETE' };
  }
  async #exportStatus(exportId) {
    identifier(exportId, 'Export ID'); const folder = join(this.#config.exportsDirectory, exportId);
    try { await privateSupportDirectory(folder); }
    catch (error) { if (error.code === 'ENOENT') return { exportId, state: 'NOT_FOUND' }; throw error; }
    let value;
    try { value = await this.#readExportManifest(exportId); }
    catch (error) { if (error.code === 'ENOENT') return { exportId, state: 'INCOMPLETE_OR_OTHER_EXPORT', action: 'Inspect this private directory locally; existing output is never overwritten.' }; throw error; }
    const { manifest } = value;
    for (const file of manifest.files) {
      const bytes = await readPrivateFile(join(folder, file.name), MAX_HANDOFF_BYTES);
      if (bytes.length !== file.bytes || sha(bytes) !== expected(file.sha256)) throw failure('SUPPORT_EXPORT_CHANGED', 'A retained support export file differs from its original completion manifest.');
    }
    return { ...manifest, state: 'COMPLETE' };
  }
  async #readExportManifest(exportId) {
    identifier(exportId, 'Export ID');
    const folder = await privateSupportDirectory(join(this.#config.exportsDirectory, exportId));
    const bytes = await readPrivateFile(join(folder, 'support-export.json'), 65000);
    return { folder, bytes, manifest: parseSupportExportManifest(bytes, exportId),
      manifestFile: { name: 'support-export.json', contentType: 'application/json', bytes: bytes.length, sha256: sha(bytes) } };
  }
  async #exportManifest(exportId) {
    const value = await this.#readExportManifest(exportId);
    return { ...value.manifest, state: 'MANIFEST_RETAINED', manifestFile: value.manifestFile, fileReads: this.#reads.status(exportId) };
  }
  async #exportFile(args) {
    const exportId = identifier(args.exportId, 'Export ID'), manifestSha256 = expected(args.expectedManifestSha256);
    if (![...exportNames, 'support-export.json'].includes(args.file)) throw failure('INVALID_PARAMS', 'Choose a filename from the original support export manifest.');
    if (args.readId !== undefined) caseId(args.readId);
    return { exportId, manifestSha256, ...await this.#reads.read({ scope: exportId,
      key: JSON.stringify([exportId, args.file, manifestSha256]), kind: 'support-export',
      directory: join(this.#config.exportsDirectory, exportId), readId: args.readId, offset: args.offset,
      limit: args.limit, expectedSha256: args.expectedSha256,
      load: async () => {
        const value = await this.#readExportManifest(exportId);
        if (value.manifestFile.sha256 !== manifestSha256)
          throw failure('SUPPORT_EXPORT_CHANGED', 'The retained completion manifest differs from the inspected export.');
        const file = args.file === 'support-export.json' ? value.manifestFile : value.manifest.files.find(file => file.name === args.file);
        if (!file) throw failure('SUPPORT_EXPORT_FILE_NOT_FOUND', 'This completed export does not contain that support file.');
        const bytes = args.file === 'support-export.json' ? value.bytes : await readPrivateFile(join(value.folder, file.name), MAX_HANDOFF_BYTES);
        if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
          throw failure('SUPPORT_EXPORT_CHANGED', 'A retained support export file differs from its original completion manifest.');
        return { bytes, name: file.name, type: exportFileType(file.name) };
      } }) };
  }
  async call(name, args) {
    this.#configured();
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'Merchant support is closing.');
    try {
      return await (async () => {
      switch (name) {
        case 'merchant_support_profiles': return this.#profiles(args.profile);
        case 'merchant_support_configure': {
          configurationRevision(args.expectedConfigRevision); expected(args.expectedSourceSha256);
          const selected = await this.#profile(args.profile, args.expectedSourceSha256);
          const result = await configureIncidents({ directory: this.#incidents(), config: selected.configuration,
            expectedConfigRevision: args.expectedConfigRevision });
          return { ...result, profile: selected.profile, sourceSha256: selected.sourceSha256,
            unchanged: result.configRevision === args.expectedConfigRevision };
        }
        case 'merchant_support_watch_status': return this.#watchStatus();
        case 'merchant_support_watch_start': return this.#startWatch(args);
        case 'merchant_support_watch_stop': return this.#stopWatch(args.instanceId);
        case 'merchant_notifications': return this.#notifications(args);
        case 'merchant_incident_notify': return remindIncident({ directory: this.#incidents(), id: caseId(args.id), expectedRevision: configurationRevision(args.expectedRevision) });
        case 'merchant_notification_update': {
          if (!Number.isSafeInteger(args.expectedAttempts) || args.expectedAttempts < 0 || !['retry', 'cancel'].includes(args.action))
            throw failure('INVALID_PARAMS', 'Choose retry or cancel with the exact original notification attempt count.');
          return operateNotification({ directory: this.#incidents(), id: caseId(args.id), expectedAttempts: args.expectedAttempts, action: args.action, by: args.by });
        }
        case 'merchant_support_sources': {
          if (args.source === undefined && args.kind === undefined) return this.summary;
          if (args.source === undefined || args.kind === undefined) throw failure('INVALID_PARAMS', 'Inspect a source with both kind and source alias.');
          const value = await this.#input(args.kind, args.source), workspace = await parseWorkspace(value.workspaceText);
          return { kind: value.kind, source: value.source, label: value.label, bytes: value.bytes, sourceSha256: value.sourceSha256,
            name: workspace.name, inputs: workspace.inputs, metadata: caseMetadata(value.metadata), workspace: workspace.summary,
            workorderSource: workspace.workorderSource ?? 'diagnostic', runtimeReview: value.supportText === null ? null : reviewRuntime(value.supportText, workspace.inputs) };
        }
        case 'merchant_incidents': {
          const value = await incidentStatus({ directory: this.#incidents(), details: true }), offset = args.offset ?? 0, limit = args.limit ?? 50;
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
              args.status !== undefined && !['OPEN', 'ACKNOWLEDGED', 'RECOVERED', 'RETIRED'].includes(args.status)) throw failure('INVALID_PARAMS', 'Use a valid incident status and page.');
          if (args.id !== undefined) caseId(args.id);
          const found = value.incidents.filter(row => (args.id === undefined || row.id === args.id) && (args.status === undefined || row.status === args.status));
          const incidents = found.slice(offset, offset + limit), ids = new Set(incidents.map(row => row.id));
          return { schema: value.schema, directoryRevision: value.directoryRevision, configRevision: value.configRevision, configHash: value.configHash,
            worker: value.worker, active: value.active, incidents, total: found.length, offset, limit,
            nextOffset: offset + limit < found.length ? offset + limit : null,
            notifications: value.notifications.filter(row => ids.has(row.incidentId)), captureStorage: value.captureStorage };
        }
        case 'merchant_incident_ack': return acknowledgeIncident({ directory: this.#incidents(), id: caseId(args.id), expectedRevision: args.expectedRevision, by: args.by, notes: args.notes });
        case 'merchant_incident_case': {
          caseId(args.id); caseId(args.incidentId); expected(args.expectedTemplateSha256);
          if (typeof args.routeId !== 'string' || !args.routeId || args.routeId.length > 160) throw failure('INVALID_PARAMS', 'Choose an actual route ID from the original capture.');
          const template = await this.#input('workspace', args.template, args.expectedTemplateSha256);
          const temporary = await mkdtemp(join(await privateSupportDirectory(this.#config.exportsDirectory), '.incident-'));
          try {
            // Snapshot the inspected original template to close a host-edit race before SF93 reads it.
            const workspaceFile = join(temporary, 'workspace.json'); await writePrivate(workspaceFile, template.workspaceText);
            const out = join(temporary, 'original');
            await exportIncident({ directory: this.#incidents(), id: args.incidentId, expectedRevision: args.expectedIncidentRevision,
              workspaceFile, routeId: args.routeId, out });
            const handoff = await importRuntimeHandoff(decode(await readPrivateFile(join(out, 'support-handoff.json'), MAX_HANDOFF_BYTES)));
            return { ...await (await this.#cases()).save({ id: args.id, expectedRevision: null, ...handoff }),
              incident: { id: args.incidentId, revision: args.expectedIncidentRevision }, templateSha256: template.sourceSha256 };
          } finally { await rm(temporary, { recursive: true, force: true }); }
        }
        case 'merchant_cases': return (await this.#cases()).list(args);
        case 'merchant_case_read': return caseView(await (await this.#cases()).read(args.id, args.revision ?? null));
        case 'merchant_case_history': { const { id, ...options } = args; return (await this.#cases()).history(id, options); }
        case 'merchant_case_import': {
          if (args.expectedRevision !== undefined) throw failure('INVALID_PARAMS', 'Import creates a new case; use merchant_case_update for an existing case.');
          expected(args.expectedSourceSha256); caseId(args.id);
          const input = await this.#input('handoff', args.source, args.expectedSourceSha256);
          return { ...await (await this.#cases()).save({ id: args.id, expectedRevision: null, workspaceText: input.workspaceText,
            supportText: input.supportText, metadata: caseMetadata(input.metadata) }), sourceSha256: input.sourceSha256 };
        }
        case 'merchant_case_update': return this.#update(args);
        case 'merchant_case_restore': {
          expected(args.expectedRevision);
          const record = await (await this.#cases()).read(args.id, expected(args.revision));
          return (await this.#cases()).save({ id: args.id, expectedRevision: args.expectedRevision,
            workspaceText: record.workspaceText, supportText: record.supportText, metadata: record.metadata });
        }
        case 'merchant_case_workorder': {
          const record = await this.#selected(args), workspace = await parseWorkspace(record.workspaceText);
          return { case: { id: record.id, revision: record.revision }, packet: sourcePacket(record, workspace).packet };
        }
        case 'merchant_case_export': return this.#export(args);
        case 'merchant_support_export_status': return this.#exportStatus(args.exportId);
        case 'merchant_support_export_manifest': return this.#exportManifest(args.exportId);
        case 'merchant_support_export_file': return this.#exportFile(args);
        case 'merchant_support_export_file_release':
          await this.#reads.release(identifier(args.exportId, 'Export ID'), caseId(args.readId));
          return { exportId: args.exportId, readId: args.readId, released: true };
        default: throw failure('TOOL_NOT_FOUND', 'Unknown merchant support operation.');
      }
      })();
    } catch (error) {
      // Preserve original conflict/validation codes; filesystem failures expose no host paths.
      if (error.path || error.syscall) throw failure('SUPPORT_STORAGE_UNAVAILABLE', 'Host support storage could not complete normally. Inspect the original saved case or export before retrying.');
      if (/^(SF93|FLEET)_[A-Z0-9_]+$/.test(error.message ?? '')) throw failure(error.message, 'Original incident operation: ' + error.message + '. Read current incident state before retrying.');
      throw error;
    }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      const handle = this.#watch;
      const readsClosing = this.#reads.close();
      try {
        if (handle) { handle.state = 'STOPPING'; handle.controller.abort(); await handle.done; }
      } finally { await readsClosing; }
    })();
    return this.#close;
  }
}
