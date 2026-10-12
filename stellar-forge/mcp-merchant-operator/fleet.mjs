// MIT. Agent operations over the original retained merchant fleet lifecycle.
import { randomUUID } from 'node:crypto';
import { CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST }
  from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { describeFleetPackages, openFleetReleaseOperator, readFleetReleasePlan }
  from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs';

const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const alias = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' };
const tenant = { type: 'string', pattern: '^[a-z][a-z0-9-]{1,39}$' };
const release = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const identity = { type: 'string', minLength: 1, maxLength: 128 };
const revision = { type: 'integer', minimum: 1 };
const error = (code, message) => Object.assign(new Error(message), { code });

function fleetClientTools(tool) {
  const scope = { tenant, slot: alias }, selected = { ...scope, exportId: release };
  return [
    tool('merchant_fleet_client_list', 'List original retained customer SDK exports for one declared merchant and slot. Completion receipts and interrupted exports remain available when that slot is stopped.',
      { ...scope, after: release, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['tenant', 'slot'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_client_status', 'Inspect the original five customer files, exact saved payment terms, completion receipt and release provenance for this merchant and slot.',
      selected, ['tenant', 'slot', 'exportId'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_client_generate', 'Generate the original customer SDK from this exact fleet-owned merchant instance into a new retained export ID. Read the actual slot instanceId from merchant_fleet_status; the source is its live original OpenAPI.',
      { ...scope, id: release, instanceId: identity }, ['tenant', 'slot', 'id', 'instanceId']),
    tool('merchant_fleet_client_adopt', 'Retain a completion receipt for the inspected original five legacy customer files in this slot. Requires their exact complete files digest and preserves all payload bytes.',
      { ...selected, expectedFilesSha256: digest }, ['tenant', 'slot', 'exportId', 'expectedFilesSha256'], { idempotent: true }),
    tool('merchant_fleet_client_manifest', 'Read the original customer completion manifest and its exact identity in this merchant and slot. Use its SHA-256 to select retained file downloads.',
      selected, ['tenant', 'slot', 'exportId'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_client_file', 'Read bounded SHA-pinned original customer bytes within one declared merchant, slot and export. Continue using readId, offset and inspected hashes; released or expired reads can reopen the same immutable bytes.',
      { ...selected, file: { type: 'string', enum: [CLIENT_EXPORT_MANIFEST, ...CLIENT_EXPORT_FILES] },
        expectedManifestSha256: digest, expectedSha256: digest, readId: identity,
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
      ['tenant', 'slot', 'exportId', 'file', 'expectedManifestSha256'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_client_file_release', 'Release only this merchant and slot’s temporary original customer file read. The retained customer files and completion receipt remain available.',
      { ...selected, readId: identity }, ['tenant', 'slot', 'exportId', 'readId'], { readOnly: true, idempotent: true }),
  ];
}

function fleetDiscoveryTools(tool) {
  const scope = { tenant, slot: alias, instanceId: identity };
  const page = {
    view: { type: 'string', enum: ['list', 'search'] },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0, maximum: 9999999 },
    query: { type: 'string', minLength: 1, maxLength: 1024 },
    cursor: { type: 'string', minLength: 1, maxLength: 512 },
    network: { type: 'string', enum: ['stellar:testnet', 'stellar:pubnet'] },
    type: { type: 'string', enum: ['http', 'mcp'] },
    scheme: { type: 'string', maxLength: 256 }, payTo: { type: 'string', maxLength: 256 },
    extensions: { type: 'string', maxLength: 256 },
  };
  return [
    tool('merchant_fleet_discovery_status', 'Read one tenant’s original seller enrollment, serving release and instance, exact payment terms, catalogue head and original buyer explorer. The signing identity belongs to the tenant across release slots. Interrupted setup includes its inspected recovery identity.',
      { tenant }, ['tenant'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_discovery_enrollment', 'Read the original public seller enrollment and pinned public key for this tenant, with its original source and accepted origin, recipients, networks and schemes.',
      { tenant }, ['tenant'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_discovery_enrollment_review', 'Review the exact serving tenant release, actual offers and source-derived permissions before original seller enrollment. For an incomplete setup, pass expectedIncompleteId from current status to review preservation of its partial files followed by enrollment.',
      { ...scope, sellerId: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' },
        sourceURL: { type: 'string', minLength: 1, maxLength: 4096 }, expectedIncompleteId: digest },
      ['tenant', 'slot', 'instanceId', 'sellerId'], { readOnly: true }),
    tool('merchant_fleet_discovery_enroll', 'Create this tenant’s original seller identity from the exact enrollment review. The current routing guard spans original setup. A reviewed incomplete setup is preserved intact before creating its replacement; completed enrollment reopens its existing identity.',
      { tenant, reviewId: identity }, ['tenant', 'reviewId']),
    tool('merchant_fleet_discovery_start', 'Start or reopen this tenant’s original signed catalogue and its original SF61 buyer explorer. Reuses the retained seller identity and journal across blue/green deployments.',
      { tenant }, ['tenant'], { idempotent: true }),
    tool('merchant_fleet_discovery_stop', 'Close this process-owned tenant buyer explorer and catalogue using its exact discovery instanceId. Retains the original enrollment, signed revisions and withdrawals for reopen.',
      { tenant, instanceId: identity }, ['tenant', 'instanceId'], { destructive: true }),
    tool('merchant_fleet_discovery_source', 'Inspect the actual offers, payment choices and catalogue differences of one retained tenant release, including a stopped slot. Select an older route that a replacement release removed.',
      { tenant, slot: alias, releaseId: release }, ['tenant', 'slot', 'releaseId'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_discovery_review', 'Review exact signed publication or withdrawal against the tenant’s original catalogue head and current serving instance. Publishing uses the serving release. A withdrawal may select sourceSlot/sourceReleaseId for an older retained route, with a concrete reason.',
      { ...scope, action: { type: 'string', enum: ['publish', 'withdraw'] },
        routeId: { type: 'string', minLength: 1, maxLength: 256 },
        reason: { type: 'string', minLength: 1, maxLength: 256 }, sourceSlot: alias, sourceReleaseId: release },
      ['tenant', 'slot', 'instanceId', 'action'], { readOnly: true }),
    tool('merchant_fleet_discovery_apply', 'Apply the exact reviewed tenant publication or withdrawal using the original signer and transaction journal. The current routing lock spans signatures and commit. After a lost response, read current status/history to reconcile its durable result.',
      { tenant, reviewId: identity }, ['tenant', 'reviewId']),
    tool('merchant_fleet_discovery_history', 'Read this tenant resource’s original signed lifecycle and journal head, including price revisions and withdrawals. Remains available after the release slot retires and the retained catalogue reopens.',
      { tenant, catalogKey: { type: 'string', minLength: 1, maxLength: 4096 } },
      ['tenant', 'catalogKey'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_discovery_consume', 'Read an actual page from this tenant’s original SF60 discovery through its original SF61 consumer. Preserves pagination, opaque search cursors, source URL and observation time. The buyer explorer exports that exact page for original SF88 preparation.',
      { tenant, ...page }, ['tenant'], { readOnly: true, idempotent: true }),
  ];
}

export function fleetControlTools(tool) {
  return [
    ...fleetClientTools(tool),
    ...fleetDiscoveryTools(tool),
    tool('merchant_fleet_plan', 'Inspect the host-configured original fleet: plan digest, tenant/slot/package aliases, listener ports and limits. Reads original release stores without starting a process or exposing private paths.', {}, [], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_status', 'Read this MCP process ownership and the original live fleet revision, candidates, exact release mapping, retained rollback history, active requests and drain state. A stopped fleet remains stopped.', {}, [], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_start', 'Start or reopen the original retained multi-store fleet using the exact inspected host-plan digest. Starts its original selected merchant sessions and gateway; does not request a paid resource.', { expectedPlanDigest: digest }, ['expectedPlanDigest'], { openWorld: true }),
    tool('merchant_fleet_catalog', 'Inspect the retained original release catalog and selection generation for one declared tenant/slot. Requires this process to own the running fleet.', { tenant, slot: alias }, ['tenant', 'slot'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_stage', 'Stage one host-registered merchant source through its original release engine into a new immutable release in the selected tenant/slot. Uses the configured source kind and capture limits; returns its actual digest and native source facts without routing traffic to it.', { tenant, slot: alias, package: alias, releaseId: release }, ['tenant', 'slot', 'package', 'releaseId']),
    tool('merchant_fleet_review', 'Compare a staged replacement against the currently serving tenant release. Returns exact native changes and a short-lived review bound to the fleet revision and original store generations.', { tenant, slot: alias, releaseId: release }, ['tenant', 'slot', 'releaseId']),
    tool('merchant_fleet_prepare', 'Consume an original replacement review, start its selected merchant session and prepare the native fleet candidate. Returns the candidate ID and exact expected revision for activation.', { reviewId: identity }, ['reviewId'], { openWorld: true }),
    tool('merchant_fleet_activate', 'Activate the exact prepared candidate at its reviewed fleet revision. Existing requests drain on the prior original merchant sessions; new requests use the activated release.', { candidateId: identity, expectedRevision: revision }, ['candidateId', 'expectedRevision']),
    tool('merchant_fleet_rollback_review', 'Review a specific retained original fleet revision, comparing all affected tenant releases and verifying their native immutable source identities.', { targetRevision: revision }, ['targetRevision']),
    tool('merchant_fleet_rollback', 'Consume the original rollback review, reopen any needed retained merchant sessions and restore that exact fleet mapping as a new native revision.', { reviewId: identity }, ['reviewId'], { openWorld: true }),
    tool('merchant_fleet_retire', 'Retire only the named original child instance owned by this fleet after it has no current/candidate routing or draining requests. The original gateway routing mutex spans the child close.', { tenant, slot: alias, instanceId: identity, expectedRevision: revision }, ['tenant', 'slot', 'instanceId', 'expectedRevision'], { destructive: true }),
    tool('merchant_fleet_operations', 'Read the original developer explorer and available merchant operations or private availability desk links for the exact running instance owned by this fleet. Use tenant, slot and instanceId from merchant_fleet_status. Keep the availability control link in the operator session.', { tenant, slot: alias, instanceId: identity }, ['tenant', 'slot', 'instanceId'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_stop', 'Gracefully drain the original gateway and close its owned merchant sessions. Pass managerId from merchant_fleet_status. Preserves native release, mapping and rollback state.', { managerId: identity }, ['managerId'], { destructive: true }),
    tool('merchant_fleet_restart', 'Drain this process-owned fleet, then reopen its retained original state with the inspected host-plan digest. Checks current manager ownership and plan before stopping.', { managerId: identity, expectedPlanDigest: digest }, ['managerId', 'expectedPlanDigest'], { destructive: true, openWorld: true }),
  ];
}

function planView(plan) {
  return { schema: plan.schema, digest: plan.digest, gateway: plan.gateway,
    tenants: plan.tenants.map(row => ({ id: row.id, host: row.host, startupSlot: row.startupSlot,
      slots: Object.entries(row.slots).map(([name, slot]) => ({ name, port: slot.port })),
      packages: Object.keys(row.packages), packageSources: describeFleetPackages(row.packages), limits: row.limits })) };
}
function publicFailure(cause) {
  const code = [cause?.code, cause?.message].find(value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(value)) ?? 'FLEET_OPERATION_FAILED';
  return error(code, `Original fleet operation returned ${code}. Read merchant_fleet_status and review its current state before another change.`);
}
function expectedPlan(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw error('INVALID_PARAMS', 'Use the exact digest returned by merchant_fleet_plan.');
  return value;
}

/** The original provider serializes mutations; native stores own persistence. */
export class MerchantFleet {
  #config; #held = null; #lastOperation = null; #closing = false;
  constructor(config) { this.#config = config ?? null; }
  get summary() {
    return { configured: Boolean(this.#config), managerId: this.#held?.id ?? null,
      running: Boolean(this.#held), closing: this.#closing, lastOperation: this.#lastOperation };
  }
  #configured() {
    if (!this.#config) throw error('FLEET_NOT_CONFIGURED', 'Add the fleet to the host merchant configuration, or use the original init-fleet command.');
    return this.#config;
  }
  #owned(managerId) {
    if (!this.#held || managerId !== undefined && managerId !== this.#held.id)
      throw error('FLEET_MANAGER_CONFLICT', 'This MCP process does not own that fleet manager. Read merchant_fleet_status.');
    return this.#held;
  }
  async #plan() { return readFleetReleasePlan(this.#configured().planFile); }
  async status() {
    return { schema: 'stellar-forge.merchant-fleet-mcp.v1', ...this.summary,
      planDigest: this.#held?.operator.planDigest ?? null,
      fleet: this.#held ? await this.#held.operator.status() : null };
  }
  async #start(expectedPlanDigest) {
    this.#configured(); expectedPlan(expectedPlanDigest);
    if (this.#held) throw error('FLEET_ALREADY_RUNNING', 'This MCP process already owns a fleet. Use its current managerId for stop or restart.');
    const operator = await openFleetReleaseOperator({ ...this.#config, expectedPlanDigest });
    this.#held = { id: randomUUID(), operator };
    this.#lastOperation = { action: 'start', outcome: 'STARTED', managerId: this.#held.id, at: new Date().toISOString() };
    return this.status();
  }
  async #stop(managerId) {
    if (typeof managerId !== 'string' || !managerId)
      throw error('FLEET_MANAGER_CONFLICT', 'Use the current managerId from merchant_fleet_status.');
    const held = this.#owned(managerId);
    try { await held.operator.close(); }
    catch (cause) {
      // The native close may report cleanup errors after the listeners drained.
      // Preserve that result while permitting the next exact native reopen.
      const state = await held.operator.status().catch(() => null);
      if (state?.closed && this.#held === held) this.#held = null;
      this.#lastOperation = { action: 'stop', outcome: state?.closed ? 'STOPPED_WITH_ERRORS' : 'CLOSE_FAILED',
        managerId: held.id, code: publicFailure(cause).code, at: new Date().toISOString() };
      throw cause;
    }
    if (this.#held === held) this.#held = null;
    this.#lastOperation = { action: 'stop', outcome: 'STOPPED', managerId: held.id, at: new Date().toISOString() };
    return this.status();
  }
  async call(name, args) {
    if (this.#closing) throw error('FLEET_OPERATOR_CLOSING', 'Fleet operator is closing.');
    try {
      switch (name) {
        case 'merchant_fleet_plan': return planView(await this.#plan());
        case 'merchant_fleet_status': return await this.status();
        case 'merchant_fleet_start': return await this.#start(args.expectedPlanDigest);
        case 'merchant_fleet_stop': return await this.#stop(args.managerId);
        case 'merchant_fleet_restart': {
          if (typeof args.managerId !== 'string' || !args.managerId)
            throw error('FLEET_MANAGER_CONFLICT', 'Use the current managerId from merchant_fleet_status.');
          this.#owned(args.managerId);
          if ((await this.#plan()).digest !== expectedPlan(args.expectedPlanDigest))
            throw error('FLEET_RELEASE_PLAN_CHANGED', 'Host fleet plan changed. Inspect merchant_fleet_plan before restarting.');
          await this.#stop(args.managerId);
          try { return await this.#start(args.expectedPlanDigest); }
          catch (cause) {
            this.#lastOperation = { action: 'restart', outcome: 'STOPPED_START_FAILED', code: publicFailure(cause).code, at: new Date().toISOString() };
            throw cause;
          }
        }
        default: {
          const methods = { merchant_fleet_catalog: 'catalog', merchant_fleet_stage: 'stage',
            merchant_fleet_review: 'review', merchant_fleet_prepare: 'prepare', merchant_fleet_activate: 'activate',
            merchant_fleet_rollback_review: 'reviewRollback', merchant_fleet_rollback: 'rollback', merchant_fleet_retire: 'retire',
            merchant_fleet_operations: 'operations', merchant_fleet_client_list: 'clientList',
            merchant_fleet_client_status: 'clientInspect', merchant_fleet_client_generate: 'clientGenerate',
            merchant_fleet_client_adopt: 'clientAdopt', merchant_fleet_client_manifest: 'clientManifest',
            merchant_fleet_client_file: 'clientFile', merchant_fleet_client_file_release: 'clientFileRelease',
            merchant_fleet_discovery_status: 'discoveryStatus', merchant_fleet_discovery_enrollment: 'discoveryEnrollment',
            merchant_fleet_discovery_enrollment_review: 'discoveryReviewEnrollment',
            merchant_fleet_discovery_enroll: 'discoveryCreateEnrollment', merchant_fleet_discovery_start: 'discoveryStart',
            merchant_fleet_discovery_stop: 'discoveryStop', merchant_fleet_discovery_source: 'discoverySource',
            merchant_fleet_discovery_review: 'discoveryReview', merchant_fleet_discovery_apply: 'discoveryApply',
            merchant_fleet_discovery_history: 'discoveryHistory', merchant_fleet_discovery_consume: 'discoveryConsume' };
          const method = methods[name];
          if (!method) throw error('TOOL_NOT_FOUND', 'Unknown fleet operation.');
          const held = this.#owned();
          const result = await held.operator[method](args);
          if (!['catalog', 'operations', 'clientList', 'clientInspect', 'clientManifest', 'clientFile', 'clientFileRelease',
            'discoveryStatus', 'discoveryEnrollment', 'discoverySource', 'discoveryHistory', 'discoveryConsume',
            'discoveryReviewEnrollment', 'discoveryReview'].includes(method))
            this.#lastOperation = { action: method, outcome: 'RETURNED', managerId: held.id, at: new Date().toISOString() };
          return { managerId: held.id, ...result };
        }
      }
    } catch (cause) { throw publicFailure(cause); }
  }
  cancelStaging() { return this.#held?.operator.cancelStaging() ?? false; }
  cancelClientTransfers() { return this.#held?.operator.cancelClientTransfers() ?? false; }
  async close() {
    this.#closing = true;
    if (this.#held) await this.#stop(this.#held.id);
  }
}
