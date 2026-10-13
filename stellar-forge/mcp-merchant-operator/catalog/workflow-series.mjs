// MIT. Agent metadata for the original Console's recurring customer work.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

export const WORKFLOW_SERIES_AGENT_PREFIX = 'merchant_workflow_series_';
export const WORKFLOW_SERIES_AGENT_REQUEST_BYTES = 128 * 1024 * 1024;
// Keep the original complete profile capacity plus the JSON-RPC envelope.
export const WORKFLOW_SERIES_AGENT_HTTP_BYTES = WORKFLOW_SERIES_AGENT_REQUEST_BYTES + 1024 * 1024;
export const WORKFLOW_SERIES_ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const alias = { type: 'string', pattern: WORKFLOW_SERIES_ALIAS.source };
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = { type: 'integer', minimum: 1 };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const record = description => ({ type: 'object', description, additionalProperties: true });
const connection = { console: alias };
const on = properties => ({ ...connection, ...properties });
const input = description => on({ input: record(description) });
const stableInput = description => on({ input: { ...record(description), properties: { id }, required: ['id'] } });
const prep = kind => on({ preparation: record('The complete unchanged ' + kind + ' preparation returned by the preceding review, including its full review, action and contentSha256.') });
const selected = on({ id });
const period = { type: 'object', additionalProperties: false, required: ['start', 'end'],
  properties: { start: text(10), end: text(10) } };
const control = on({ id, expectedRevision: revision });
const agenda = on({ profileId: id, from: text(10), to: text(10), today: text(10), query: { type: 'string', maxLength: 160 },
  status: { type: 'string', enum: ['all', 'open', 'PROPOSED', 'PLANNED', 'READY', 'RUNNING', 'PAUSED', 'WAITING', 'COMPLETE', 'CANCELLED'] },
  includeOverdue: { type: 'boolean' }, includeProposed: { type: 'boolean' }, ...page });
const range = { readId: id, expectedSha256: sha, offset: { type: 'integer', minimum: 0 },
  limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
const handover = on({ handoverId: alias, incoming: alias });
const descriptions = [
  ['connections', 'List configured recurring-work Consoles and their declared incoming customer handovers.', {}, [], true],
  ['host', 'Read the selected Console, current native tool composition, workspace identity and host fingerprint.', connection, ['console'], true],
  ['profiles', 'Read the complete list of original customer profiles on this Console.', connection, ['console'], true],
  ['profile', 'Read the complete original profile, saved requests, calls, workflows and customer receiving state.', selected, ['console', 'id'], true],
  ['profile_save', 'Create or edit an original customer profile. Use a stable id and the displayed expectedRevision when editing.',
    on({ id, name: text(160), expectedRevision: revision, favorites: { type: 'array', maxItems: 200, items: text(128) } }), ['console', 'id', 'name'], false],
  ['profile_bind', 'Bind the saved profile to the reviewed current host and tool composition using its current revision.',
    on({ id, expectedRevision: revision, expectedHostFingerprint: sha, expectedCompositionFingerprint: sha }),
    ['console', 'id', 'expectedRevision', 'expectedHostFingerprint'], false],
  ['tools', 'Read a complete page of native Console tools. Follow nextOffset to retain the whole selection.',
    on({ family: text(64), query: { type: 'string', maxLength: 240 }, profileId: id, offset: { type: 'integer', minimum: 0 } }), ['console'], true],
  ['tool', 'Read one complete native tool definition and its schema SHA256.', on({ name: text(128) }), ['console', 'name'], true],
  ['draft', 'Read a complete original saved native request at its selected revision.', on({ id, revision }), ['console', 'id'], true],
  ['draft_save', 'Save the complete original native request used by a workflow step, retaining its tool, arguments and expected revision.',
    stableInput('The original drafts API request: stable id, profileId, name, tool, complete arguments, recoveryOf for a linked native recovery, and expectedRevision when editing.'), ['console', 'input'], false],
  ['workflows', 'List the original workflow definitions and runs for a customer profile.', on({ profileId: id }), ['console', 'profileId'], true],
  ['workflow', 'Read the complete original workflow at a selected saved revision.', on({ id, revision }), ['console', 'id'], true],
  ['workflow_save', 'Save a complete original Console workflow definition, preserving its steps, bindings, policies and expectedRevision.',
    stableInput('The complete original workflows API request with profileId, stable id, name, complete steps and revision controls.'), ['console', 'input'], false],
  ['recipes', 'List the retained recipe installations for this original customer profile.', on({ profileId: id }), ['console', 'profileId'], true],
  ['recipe_prepare', 'Prepare a complete recipe installation against the original destination tool definitions and inputs.',
    input('The original recipe preparation input, including stable id, profileId, complete recipe or maintenance/receiving source, inputs and acceptToolChanges.'), ['console', 'input'], true],
  ['recipe_install', 'Install the exact complete recipe preparation returned by recipe_prepare.', prep('recipe'), ['console', 'preparation'], false],
  ['recipe_installation', 'Read the complete saved installation, its original definition and run inputs.', selected, ['console', 'id'], true],
  ['recipe_export', 'Export an original workflow as a complete reusable recipe with its full declared inputs and bindings.',
    input('The original workflow-recipe-export request.'), ['console', 'input'], true],
  ['list', 'List every saved recurring series for the selected customer profile.', on({ profileId: id }), ['console', 'profileId'], true],
  ['get', 'Read one complete saved series edition and a page of its original periods. Follow nextOffset through its whole history.',
    on({ id, revision, ...page }), ['console', 'id'], true],
  ['save', 'Save an original recurring customer task, its exact workflow revision, full base inputs, cadence and cycle bindings.',
    input('The original series save request: requestId, id, profileId, expectedRevision (zero for new), name, customer, task, workflowId, workflowRevision, baseInputs, cycleBindings, cadence and enabled.'),
    ['console', 'input'], false],
  ['calendar', 'Prepare original dated period proposals for this saved series without dispatching work.',
    on({ id, revision, from: text(10), to: text(10), limit: { type: 'integer', minimum: 1, maximum: 100 } }), ['console', 'id', 'from', 'to'], true],
  ['agenda', 'Read customer work due, overdue and proposed in the complete selected period, with saved run state and source revisions.',
    agenda, ['console', 'profileId', 'from', 'to'], true],
  ['agenda_calendar', 'Export the complete selected customer agenda as an iCalendar document. Calendar export includes the full selection across all pages.',
    agenda, ['console', 'profileId', 'from', 'to'], true],
  ['cycle_prepare', 'Prepare an original period with exact source edition, dates, prior-period linkage and complete inputs; return its full sealed review.',
    on({ seriesId: id, seriesRevision: revision, key: text(160), label: text(160), period, dueDate: text(10),
      sourceEdition: { type: 'string', maxLength: 8000 }, reason: text(8000),
      previousCycleId: { anyOf: [id, { type: 'null' }] }, inputs: record('Complete original workflow inputs for this period.') }),
    ['console', 'seriesId', 'seriesRevision', 'key', 'label', 'period', 'dueDate', 'reason'], true],
  ['cycle_save', 'Save the exact original period preparation. The same series and period key reopen the saved period with unchanged inputs.',
    prep('cycle'), ['console', 'preparation'], false],
  ['cycle', 'Read the complete saved period and its original run, checkpoints and recovery state.', selected, ['console', 'id'], true],
  ['cycle_start_prepare', 'Review the first native start of this exact saved period against the current host. An existing run is returned for recovery.',
    selected, ['console', 'id'], true],
  ['cycle_start', 'Start the exact reviewed saved period through the original native dispatcher. Repeating an accepted start returns the same run.',
    prep('start'), ['console', 'preparation'], false],
  ['cycle_cancel', 'Cancel a period before its native run is reserved, retaining the original cancellation request and reason.',
    on({ id, requestId: id, reason: text(8000) }), ['console', 'id', 'requestId', 'reason'], false],
  ['cycle_wait', 'Wait for this original period to pause, finish, require recovery or reach the caller-selected wait interval; retain its complete current state.',
    on({ id, timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 }, pollMs: { type: 'integer', minimum: 100, maximum: 10000 } }), ['console', 'id'], true],
  ['run', 'Read one complete original run, including original call IDs, step results, revisions and handovers.', selected, ['console', 'id'], true],
  ['run_pause', 'Pause the selected original run using its current revision; native in-flight work remains owned by that run.', control, ['console', 'id', 'expectedRevision'], false],
  ['run_resume', 'Continue the original paused run at its current saved revision and checkpoints.', control, ['console', 'id', 'expectedRevision'], false],
  ['run_resolve', 'Resolve a waiting step with its exact original completed native call and a retained operator note.',
    on({ id, expectedRevision: revision, stepId: id, callId: id, note: text(8000) }), ['console', 'id', 'expectedRevision', 'stepId', 'callId', 'note'], false],
  ['run_handover', 'Transfer the reviewed run to the selected original workspace and host while retaining its handover ID, revision and note.',
    on({ id, expectedRevision: revision, handoverId: id, workspaceId: id, hostFingerprint: sha, note: text(8000) }),
    ['console', 'id', 'expectedRevision', 'handoverId', 'workspaceId', 'hostFingerprint', 'note'], false],
  ['call_start', 'Dispatch or recover the exact original saved native request through the Console, retaining a stable call ID for workflow recovery.',
    input('The complete original calls API request, including stable id, profileId, draftId, draftRevision and expectedHostFingerprint.'), ['console', 'input'], false],
  ['call', 'Read the complete original native call, arguments, return JSON, error and source identities.', selected, ['console', 'id'], true],
  ['call_recovery', 'Read the original Console recovery inspection and control tools with arguments derived from this saved native call.', selected, ['console', 'id'], true],
  ['customer_receive', 'Receive every original customer file from the complete selected native export through the Console customer owner.',
    input('The complete original customers API selection: profileId, family, optional workspace, exportId, expectedManifestSha256 and expectedHostFingerprint.'), ['console', 'input'], false],
  ['customer_receive_run', 'Receive every original OpenAPI package file from its completed export run through the Console customer owner.',
    on({ runId: id, expectedHostFingerprint: sha }), ['console', 'runId'], false],
  ['customer_pause', 'Pause the original customer file transfer while retaining its receiving record and selected native export.', selected, ['console', 'id'], false],
  ['customer_wait', 'Read the original customer receiving job until complete or the selected interval, preserving its saved delivery identity.',
    on({ profileId: id, deliveryId: id, timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 },
      pollMs: { type: 'integer', minimum: 100, maximum: 10000 } }), ['console', 'profileId', 'deliveryId'], true],
  ['profile_export', 'Export the complete original profile archive, including all definitions, periods, calls, runs and receiving records.',
    selected, ['console', 'id'], true],
  ['profile_import', 'Receive the complete original profile archive and reconcile it with retained local history.',
    on({ archive: record('The complete original profile archive with its contentSha256.') }), ['console', 'archive'], false],
  ['handover_capture', 'Retain the complete original customer profile and all selected completed customer files in a stable named handover; resume the same capture after interruption.',
    on({ handoverId: alias, profileId: id, deliveryIds: { type: 'array', maxItems: 1000, items: id } }), ['console', 'handoverId', 'profileId'], false],
  ['handover_reopen', 'Reopen and verify every file in the complete retained handover, including profile, selection and handover metadata.', handover, ['console'], true],
  ['handover_receive', 'Receive a complete retained handover or a host-declared incoming handover through the original profile importer.',
    on({ handoverId: alias, sourceConsole: alias, incoming: alias }), ['console'], false],
  ['handover_file', 'Read a complete retained handover member through the original resumable file reader using the displayed handover and member SHA256 values.',
    on({ handoverId: alias, incoming: alias, expectedContentSha256: sha, file: text(4096), ...range }),
    ['console', 'expectedContentSha256', 'file', 'expectedSha256'], true],
  ['handover_file_release', 'Release a retained customer file read after completion or interruption.',
    on({ handoverId: alias, incoming: alias, readId: id }), ['console', 'readId'], false],
];
export const workflowSeriesAgentDefinitions = Object.freeze(descriptions.map(
  ([action, description, properties, required, readOnly]) => Object.freeze({
    name: WORKFLOW_SERIES_AGENT_PREFIX + action, action, description, properties, required, readOnly,
  })));
const byName = new Map(workflowSeriesAgentDefinitions.map(value => [value.name, value]));
function accepted(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(item => accepted(item, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer') return Number.isSafeInteger(value) &&
    value >= (schema.minimum ?? Number.MIN_SAFE_INTEGER) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER);
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) &&
    value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === 'array') return Array.isArray(value) && value.length <= (schema.maxItems ?? Infinity) &&
    value.every(item => accepted(schema.items, item));
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (schema.required ?? []).every(key => Object.hasOwn(value, key)) &&
    Object.entries(value).every(([key, item]) => schema.properties?.[key] ? accepted(schema.properties[key], item) : schema.additionalProperties !== false);
  return false;
}
export function validateWorkflowSeriesAgentArguments(name, args = {}) {
  const definition = byName.get(name);
  if (!definition || !accepted({ type: 'object', properties: definition.properties,
    required: definition.required, additionalProperties: false }, args))
    throw Object.assign(new TypeError('Use the declared recurring-work operation and complete original arguments.'), { code: 'WORKFLOW_SERIES_AGENT_INPUT' });
  if (Buffer.byteLength(JSON.stringify(args)) > WORKFLOW_SERIES_AGENT_REQUEST_BYTES)
    throw Object.assign(new RangeError('The complete request exceeds the original 128 MiB profile capacity.'), { code: 'WORKFLOW_SERIES_AGENT_SIZE' });
  return definition.action;
}
export function workflowSeriesAgentTools(tool) {
  return workflowSeriesAgentDefinitions.map(value => tool(value.name, value.description, value.properties, value.required,
    { readOnly: value.readOnly, idempotent: true, openWorld: false }));
}
