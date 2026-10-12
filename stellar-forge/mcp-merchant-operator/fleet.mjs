import { fleetControlTools, fleetClientTools, fleetDiscoveryTools, digest, tenant, alias, release, identity, revision } from './catalog/fleet.mjs';
export { fleetControlTools } from './catalog/fleet.mjs';
// MIT. Agent operations over the original retained merchant fleet lifecycle.
import { randomUUID } from 'node:crypto';
import { CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST }
  from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { describeFleetPackages, openFleetReleaseOperator, readFleetReleasePlan }
  from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs';







const error = (code, message) => Object.assign(new Error(message), { code });







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
            merchant_fleet_delivery_status: 'deliveryStatus', merchant_fleet_delivery_control: 'deliveryControl',
            merchant_fleet_delivery_events: 'deliveryEvents', merchant_fleet_delivery_transfers: 'deliveryTransfers',
            merchant_fleet_delivery_transfer: 'deliveryTransfer', merchant_fleet_delivery_manifest: 'deliveryTransferManifest',
            merchant_fleet_delivery_file: 'deliveryFile', merchant_fleet_delivery_file_release: 'deliveryFileRelease',
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
            'deliveryStatus', 'deliveryEvents', 'deliveryTransfers', 'deliveryTransferManifest', 'deliveryFile', 'deliveryFileRelease',
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
  cancelDeliveryOperations() { return this.#held?.operator.cancelDeliveryOperations() ?? false; }
  async close() {
    this.#closing = true;
    if (this.#held) await this.#stop(this.#held.id);
  }
}
