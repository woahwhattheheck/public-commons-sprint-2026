// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const SHA256 = /^[a-f0-9]{64}$/;

const PROFILE = /^p-[a-f0-9]{64}$/;

const REQUEST = /^r-[a-f0-9]{64}$/;

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuid = { type: 'string', pattern: UUID.source };

const digest = { type: 'string', pattern: SHA256.source };

const profile = { type: 'string', pattern: PROFILE.source };

const request = { type: 'string', pattern: REQUEST.source };

const generation = { type: 'integer', minimum: 1 };

const pageSize = { type: 'integer', minimum: 1, maximum: 100 };

const selected = { workspace: alias };

const inProfile = { ...selected, profile };

const inOperation = { ...inProfile, operationKey: digest };

const read = { readOnly: true, idempotent: true };

const reference = { type: 'string', minLength: 8, maxLength: 240 };

const requestBody = { type: 'object', additionalProperties: false,
  required: ['block_number', 'transaction_index', 'from', 'to', 'input', 'gas', 'value'],
  properties: {
    block_number: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    transaction_index: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    from: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    to: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    input: { type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$', maxLength: 524290 },
    gas: { type: 'integer', minimum: 1, maximum: 1000000000 },
    value: { type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$' },
  } };

function tenderlyWorkspaceTools(tool) {
  return [
    tool('merchant_tenderly_workspaces', 'List the host-declared Tenderly workspace aliases, owned browser instances, active profile and retained file reads. Opens no merchant or provider connection.', {}, [], read),
    tool('merchant_tenderly_open', 'Open one original private Tenderly workspace and its existing browser interface. Reuses this process-owned instance and returns its current browser URL, saved profiles, original plan template and state. Opening does not start a seller.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_tenderly_close', 'Drain and close this exact process-owned browser, original merchant and model after their active work finishes. Keep the returned original workspace identity for reopening the same host alias.', {
      ...selected, instanceId: uuid,
    }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_tenderly_status', 'Read the original workspace and merchant state, current browser URL and owned verified file-read sessions. Browser and MCP share this same model.', selected, ['workspace'], read),
    tool('merchant_tenderly_profile_preview', 'Validate a merchant plan with the original Tenderly product compiler and return its exact normalized plan, hash, route, payment and environment references. Omit plan for the original template and explicit-block example request.', {
      ...selected, plan: { type: 'object' },
    }, ['workspace'], read),
    tool('merchant_tenderly_profile_save', 'Save the reviewed plan through the original content-addressed profile writer. Repeating identical normalized plan bytes reopens that same profile and preserves its first saved label. Does not switch or start the merchant.', {
      ...selected, plan: { type: 'object' }, label: { type: 'string', maxLength: 120 },
    }, ['workspace', 'plan'], { idempotent: true }),
    tool('merchant_tenderly_profiles', 'Page the original saved merchant profiles using nextCursor verbatim as before.', {
      ...selected, before: profile, limit: pageSize,
    }, ['workspace'], read),
    tool('merchant_tenderly_profile', 'Inspect the original saved profile, normalized merchant plan and exact plan hash.', inProfile, ['workspace', 'profile'], read),
    tool('merchant_tenderly_prepare', 'Prepare or reopen the original product package for a saved profile: merchant configuration, operation state, Node/Python customer interfaces and buyer handoff. Preserves the original prepared-package identity.', inProfile, ['workspace', 'profile'], { idempotent: true }),
    tool('merchant_tenderly_profile_open', 'Open the saved profile on the original operation controller, preparing its original package if needed. Stop a running merchant before selecting another profile. Reopening the active profile preserves its state.', inProfile, ['workspace', 'profile'], { idempotent: true }),
    tool('merchant_tenderly_start', 'Start the original selected merchant on an ephemeral loopback seller port and operation port. Uses the host-selected facilitator when configured. After a lost reply inspect status before starting again.', inProfile, ['workspace', 'profile'], { openWorld: true }),
    tool('merchant_tenderly_stop', 'Drain the original running merchant and reopen its same operation controller for review. Saved profiles, requests, provider observations and results remain available.', inProfile, ['workspace', 'profile'], { destructive: true, idempotent: true }),
    tool('merchant_tenderly_issue', 'Issue and retain an original merchant request ticket for one exact EVM block/transaction position and complete call bytes. Keep id, subject and expiresAt unchanged when recovering a lost issuance reply; the original operation identity and request packet remain stable. This issues a ticket without dispatching the simulation.', {
      ...inProfile, body: requestBody,
      id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' },
      subject: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' },
      expiresAt: { type: 'integer', minimum: 1, description: 'Original ticket expiry in Unix milliseconds, e.g. Date.now() + 3600000; within the saved plan maxTicketSeconds.' },
    }, ['workspace', 'profile', 'body', 'id', 'subject', 'expiresAt'], { idempotent: true }),
    tool('merchant_tenderly_requests', 'Page saved original request packets for this profile. Continue with nextCursor as before.', {
      ...inProfile, before: request, limit: pageSize,
    }, ['workspace', 'profile'], read),
    tool('merchant_tenderly_request', 'Read one complete original saved request packet, ticket, request hash and customer identity. The selected profile must own that request.', {
      ...inProfile, requestId: request,
    }, ['workspace', 'profile', 'requestId'], read),
    tool('merchant_tenderly_operations', 'Page the original merchant operation controller using its native cursor and optional state. Includes the current generation for subsequent recovery.', {
      ...inProfile, state: { type: 'string', enum: ['IN_FLIGHT', 'COMPLETE', 'UNCERTAIN', 'RETRY_READY'] },
      cursor: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', maxLength: 256 }, limit: pageSize,
    }, ['workspace', 'profile'], read),
    tool('merchant_tenderly_operation', 'Read one original operation, exact request hash, current generation and terminal state before reconciling its outcome.', inOperation, ['workspace', 'profile', 'operationKey'], read),
    tool('merchant_tenderly_audit', 'Page the original audit events for this operation using nextAfter verbatim as after.', {
      ...inOperation, after: { type: 'integer', minimum: 0 }, limit: pageSize,
    }, ['workspace', 'profile', 'operationKey'], read),
    tool('merchant_tenderly_result', 'Inspect an original retained merchant response: HTTP status, complete byte count, SHA256 and provider simulation summary. Retrieve all response bytes through merchant_tenderly_file_read with kind=response.', inOperation, ['workspace', 'profile', 'operationKey'], read),
    tool('merchant_tenderly_recover', 'Apply the original generation-checked operator recovery after provider review. For complete supply the exact provider response bytes as base64; for retry use the original provider-confirmed reference. Prefer provider_lookup and provider_recover when a saved simulation ID is available. Inspect the original operation after an uncertain reply.', {
      ...inOperation, requestHash: digest, expectedGeneration: generation,
      action: { type: 'string', enum: ['complete', 'retry'] }, reference: { ...reference, maxLength: 512 },
      response: { type: 'object', additionalProperties: false, required: ['status', 'headers', 'bodyBase64'], properties: {
        status: { type: 'integer', minimum: 100, maximum: 599 },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        bodyBase64: { type: 'string', maxLength: 1398104 },
      } },
    }, ['workspace', 'profile', 'operationKey', 'requestHash', 'expectedGeneration', 'action', 'reference'], { destructive: true }),
    tool('merchant_tenderly_provider_lookup', 'Read a saved Tenderly simulation using the original provider contract and retain its complete response. Repeating the same operationKey/simulationId reopens saved observations without HTTP; refresh=true explicitly requests another observation and respects the provider Retry-After. Returns MATCHED, MISMATCH, PROVIDER_ERROR or RESPONSE_PENDING with original request comparison.', {
      ...inOperation, simulationId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' },
      refresh: { type: 'boolean', default: false },
    }, ['workspace', 'profile', 'operationKey', 'simulationId'], { openWorld: true }),
    tool('merchant_tenderly_provider_lookups', 'Page the original saved-provider lookups for this merchant operation, including latest observation, source identity and complete-result hash. Reads retained observations only.', {
      ...inOperation, before: digest, limit: pageSize,
    }, ['workspace', 'profile', 'operationKey'], read),
    tool('merchant_tenderly_provider_inspect', 'Review one retained lookup, its exact original request, current merchant generation and every saved observation. Prior matched observations remain available after a later provider error.', {
      ...inProfile, lookupId: digest,
    }, ['workspace', 'profile', 'lookupId'], read),
    tool('merchant_tenderly_provider_recover', 'Complete the original merchant generation using one reviewed MATCHED provider observation. Revalidates its original request and full retained response, then calls the original operation recovery. Repeating the same reviewed command reopens its saved reconciliation.', {
      ...inProfile, lookupId: digest, observationId: uuid, expectedGeneration: generation, reference,
    }, ['workspace', 'profile', 'lookupId', 'observationId', 'expectedGeneration', 'reference'], { idempotent: true, destructive: true }),
    tool('merchant_tenderly_file_read', 'Read exact original plan, request, merchant response or saved provider response as resumable SHA256-pinned base64 chunks. id is request ID for request, operation key for response, lookup ID for provider-response; only provider-response needs observationId. Continue with the same readId, expectedSha256 and nextOffset. After close/expiry/restart omit readId and resume the original selection, SHA256 and offset.', {
      ...inProfile, kind: { type: 'string', enum: ['plan', 'request', 'response', 'provider-response'] },
      id: { type: 'string', maxLength: 66 }, observationId: uuid, readId: uuid,
      expectedSha256: digest, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'profile', 'kind'], read),
    tool('merchant_tenderly_file_release', 'Release this workspace owned temporary verified file-read snapshot. Original merchant and provider response files remain intact.', {
      ...selected, readId: uuid,
    }, ['workspace', 'readId'], read),
  ];
}

export { tenderlyWorkspaceTools, read, selected, uuid, profile, pageSize, inProfile, requestBody, request, inOperation, digest, generation, reference, alias, UUID, PROFILE, REQUEST, SHA256 };
