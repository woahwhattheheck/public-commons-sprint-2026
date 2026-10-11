// MIT. One workbook customer uses the original Node Dataset lifecycle.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatasetDelivery } from '../../../sf88-operator-buyer-cli/node/index.mjs';
import { canonical, digest as nativeDigest } from '../../../sf88-operator-buyer-cli/dataset-page.mjs';
import { openWorkspace } from '../../../sf88-operator-buyer-cli/workspace.mjs';
import { absolute, privateDirectory, readJson, readBytes, digest, jsonBytes,
  exists, object, need } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { createWorkbookPacket, openWorkbookPacket, retainSame } from './packet.mjs';
import { WorkbookDelivery } from './delivery.mjs';

const ACQUISITION = 'stellar-forge.workbook-customer-acquisition.v1';
const RETAINED_DELIVERY = 'stellar-forge.workbook-customer-native-delivery.v1';
const HASH = /^[a-f0-9]{64}$/;
const same = (left, right) => canonical(left) === canonical(right);
const nativeOK = result => result?.process?.exitCode === 0 && !result.process.errorCode;
const clone = value => structuredClone(value);

function buyerRequired(buyer) {
  need(buyer && typeof buyer.dataset === 'function' && typeof buyer.createDataset === 'function' &&
    typeof buyer.attachDataset === 'function' && typeof buyer.stateDirectory === 'string' &&
    typeof buyer.runtime?.directory === 'string', 'WORKBOOK_ORIGINAL_NODE_BUYER_REQUIRED');
  return buyer;
}
function compareSource(config, packet) {
  need(object(config) && same(config.operation, packet.config.operation) &&
    same(config.preparedFrom, packet.config.preparedFrom) &&
    config.captureBody !== true, 'WORKBOOK_NATIVE_SOURCE_CONFIG_CHANGED');
}

async function checkedReport(dataset, packet, result, binding = null) {
  const report = result?.native;
  need(report?.schema === 'stellar-forge.sf88.dataset-acquisition.v1' &&
    typeof report.directory === 'string', 'WORKBOOK_ORIGINAL_DATASET_REPORT_REQUIRED');
  if (report.status === 'RUNNING') {
    need(binding && report.directory === binding.sessionDirectory, 'WORKBOOK_NATIVE_SESSION_RUNNING');
    return report;
  }
  need(HASH.test(report.configurationSha256 ?? '') &&
    report.sessionId === packet.request.intentId &&
    report.expectedSnapshot === packet.request.snapshot &&
    (report.snapshot === null || report.snapshot === undefined || report.snapshot === packet.request.snapshot),
  'WORKBOOK_NATIVE_SELECTION_CHANGED');
  // Read the original immutable session definition solely to connect this
  // source review to the native configured query. Native Dataset remains the
  // owner of session creation, locks, attempts, recovery and page validation.
  const definition = await readJson(join(absolute(report.directory), 'session.json'), 262144);
  need(definition.schema === 'stellar-forge.sf88.dataset-session.v1' &&
    definition.directory === report.directory &&
    definition.configurationSha256 === report.configurationSha256 &&
    nativeDigest(canonical(definition.config)) === report.configurationSha256 &&
    definition.expectedSnapshot === packet.request.snapshot, 'WORKBOOK_NATIVE_SESSION_BINDING_CHANGED');
  compareSource(definition.config, packet);
  if (binding) {
    need(binding.packetSha256 === packet.manifest.packetSha256 &&
      binding.datasetId === packet.request.datasetId && binding.entryDirectory === dataset.directory &&
      binding.sessionDirectory === report.directory && binding.sessionId === report.sessionId &&
      binding.configurationSha256 === report.configurationSha256 &&
      binding.expectedSnapshot === report.expectedSnapshot &&
      same(binding.limits, report.limits) &&
      binding.workspaceDirectory === (report.workspaceDirectory ?? null),
    'WORKBOOK_CUSTOMER_ACQUISITION_CHANGED');
  }
  return report;
}

function checkDelivery(packet, binding, delivery) {
  need(delivery instanceof DatasetDelivery &&
    delivery.report.sourceDirectory === binding.sessionDirectory &&
    delivery.report.nativeStatus?.snapshot === packet.request.snapshot &&
    delivery.manifest.dataset?.snapshot === packet.request.snapshot &&
    same(delivery.manifest.dataset.projectedFields, packet.request.prepared.fields),
  'WORKBOOK_DELIVERY_SELECTION_CHANGED');
}

/** Receives the original publisher's exported review and prepared buyer file.
 * Operator keys, signer profiles and execution remain in the supplied Buyer.
 */
export class WorkbookCustomer {
  constructor({directory, buyer}) {
    this.directory = absolute(directory);
    this.buyer = buyer === undefined ? null : buyerRequired(buyer);
  }
  static async create({directory, reviewFile, configFile, datasetId, buyer}) {
    await createWorkbookPacket({directory, reviewFile, configFile, datasetId});
    return new WorkbookCustomer({directory, buyer});
  }
  static async open({directory, buyer}) {
    await openWorkbookPacket(directory);
    return new WorkbookCustomer({directory, buyer});
  }
  async review() {
    const packet = await openWorkbookPacket(this.directory);
    return {packetSha256:packet.manifest.packetSha256, request:clone(packet.request), publisherReview:clone(packet.review)};
  }
  async _binding() {
    const packet = await openWorkbookPacket(this.directory);
    const binding = await readJson(join(this.directory, 'acquisition.json'), 65536);
    need(binding?.schema === ACQUISITION && binding.packetSha256 === packet.manifest.packetSha256 &&
      binding.datasetId === packet.request.datasetId && binding.expectedSnapshot === packet.request.snapshot,
    'WORKBOOK_CUSTOMER_ACQUISITION_REQUIRED');
    return {packet, binding};
  }
  async _dataset() {
    const buyer = buyerRequired(this.buyer);
    const {packet, binding} = await this._binding();
    need(binding.buyerStateDirectory === buyer.stateDirectory, 'WORKBOOK_ORIGINAL_BUYER_APP_REQUIRED');
    const dataset = buyer.dataset(packet.request.datasetId);
    need(dataset.directory === binding.entryDirectory, 'WORKBOOK_ORIGINAL_DATASET_ENTRY_REQUIRED');
    return {packet, binding, dataset};
  }
  async _retainBinding(dataset, packet, result) {
    need(nativeOK(result), result?.process?.errorCode ?? 'WORKBOOK_NATIVE_INITIALIZATION_INCOMPLETE');
    const report = await checkedReport(dataset, packet, result);
    need(report.status !== 'RUNNING', 'WORKBOOK_NATIVE_SESSION_RUNNING');
    const binding = {schema:ACQUISITION, packetSha256:packet.manifest.packetSha256,
      buyerStateDirectory:this.buyer.stateDirectory, datasetId:dataset.id, entryDirectory:dataset.directory,
      sessionDirectory:report.directory, sessionId:report.sessionId,
      configurationSha256:report.configurationSha256, expectedSnapshot:report.expectedSnapshot,
      limits:clone(report.limits), workspaceDirectory:report.workspaceDirectory ?? null};
    await retainSame(join(this.directory, 'acquisition.json'), jsonBytes(binding));
    return {binding, result};
  }
  /** Offline create/reopen. A lost creation reply reuses the same original entry. */
  async initialize(options = {}) {
    const {operatorProfile, maxPages, maxTotalAtomic, maxRows = 1000000,
      maxPageBytes = 1048576, signal} = options;
    let {workspaceDirectory} = options;
    const buyer = buyerRequired(this.buyer), packet = await openWorkbookPacket(this.directory);
    if (workspaceDirectory !== undefined) {
      workspaceDirectory = absolute(workspaceDirectory);
      need(operatorProfile === undefined, 'WORKBOOK_WORKSPACE_PROFILE_CONFLICT');
      const workspace = await openWorkspace(['--dir', workspaceDirectory]);
      compareSource(workspace.config, packet);
    }
    const dataset = buyer.dataset(packet.request.datasetId);
    let result;
    if (await exists(dataset.directory)) {
      result = await dataset.initialize({signal});
      // Explicit changed initialization limits are a different acquisition.
      for (const key of ['maxPages','maxTotalAtomic','maxRows','maxPageBytes'])
        if (options[key] !== undefined)
          need(result.native?.limits?.[key] === options[key], 'WORKBOOK_ACQUISITION_LIMITS_CHANGED');
      if (workspaceDirectory !== undefined)
        need(result.native?.workspaceDirectory === workspaceDirectory, 'WORKBOOK_OPERATOR_WORKSPACE_CHANGED');
    } else {
      need(Number.isSafeInteger(maxPages) && typeof maxTotalAtomic === 'string',
        'WORKBOOK_EXPLICIT_ACQUISITION_LIMITS_REQUIRED');
      await buyer.createDataset({id:packet.request.datasetId,
        ...(workspaceDirectory === undefined
          ? {config:packet.config, ...(operatorProfile === undefined ? {} : {operatorProfile})}
          : {workspaceDirectory}),
        maxPages, maxTotalAtomic, maxRows, maxPageBytes, expectedSnapshot:packet.request.snapshot});
      result = await dataset.inspect({signal});
    }
    const retained = await this._retainBinding(dataset, packet, result);
    return {request:clone(packet.request), ...retained};
  }
  /** Adopt an existing original acquisition of this exact prepared selection. */
  async attach({session, signal} = {}) {
    const buyer = buyerRequired(this.buyer), packet = await openWorkbookPacket(this.directory);
    session = absolute(session);
    const dataset = buyer.dataset(packet.request.datasetId);
    if (!await exists(dataset.directory))
      await buyer.attachDataset({id:packet.request.datasetId, directory:session});
    const result = await dataset.initialize({signal});
    need(result.native?.directory === session, 'WORKBOOK_EXISTING_SESSION_CHANGED');
    return this._retainBinding(dataset, packet, result);
  }
  async inspect(options) {
    const {packet,binding,dataset} = await this._dataset();
    const result = await dataset.inspect(options);
    await checkedReport(dataset, packet, result, binding);
    return result;
  }
  /** Only the original Dataset.run acquires new pages and requests approval. */
  async run(options) {
    const {packet,binding,dataset} = await this._dataset();
    const before = await dataset.inspect(options);
    await checkedReport(dataset, packet, before, binding);
    need(before.native.status !== 'RUNNING', 'WORKBOOK_NATIVE_SESSION_RUNNING');
    const result = await dataset.run(options);
    await checkedReport(dataset, packet, result, binding);
    return result;
  }
  async recover(options) {
    const {packet,binding,dataset} = await this._dataset();
    const result = await dataset.recover(options);
    await checkedReport(dataset, packet, result, binding);
    return result;
  }
  async accounting(options) {
    const {dataset} = await this._dataset();
    return dataset.accounting(options);
  }
  async finalize(options) {
    const {dataset} = await this._dataset();
    return dataset.finalize(options);
  }
  async *finalizeAll(options) {
    const {dataset} = await this._dataset();
    yield* dataset.finalizeAll(options);
  }
  async exportAccounting(destination, options) {
    const {dataset} = await this._dataset();
    return dataset.exportAccounting(destination, options);
  }
  /** Create or reopen the original SF100 room, keeping all native report fields. */
  async deliver(destination, options) {
    destination = absolute(destination);
    const {packet,binding,dataset} = await this._dataset();
    const inspected = await dataset.inspect(options);
    await checkedReport(dataset, packet, inspected, binding);
    need(inspected.native.status === 'COMPLETE', 'WORKBOOK_COMPLETE_ACQUISITION_REQUIRED');
    const recordPath = join(this.directory, 'deliveries', digest(destination) + '.json');
    if (await exists(recordPath)) return this.openDelivery(destination);
    const delivered = await dataset.deliver(destination, options);
    // A host may pass a Buyer from another installed copy of the original SDK.
    // Reopen its unchanged native report through this original reader so module
    // instance identity cannot strand an already completed native delivery.
    const native = delivered instanceof DatasetDelivery ? delivered : await DatasetDelivery.open(delivered?.report);
    checkDelivery(packet, binding, native);
    const record = {schema:RETAINED_DELIVERY, packetSha256:packet.manifest.packetSha256,
      acquisitionSha256:digest(jsonBytes(binding)), native:clone(native.report)};
    await privateDirectory(join(this.directory, 'deliveries'));
    await retainSame(recordPath, jsonBytes(record));
    return WorkbookDelivery.fromOriginal({packet, binding, native});
  }
  /** Offline existing-file reopening; no buyer runtime or merchant is required. */
  async openDelivery(destination) {
    destination = absolute(destination);
    const {packet,binding} = await this._binding();
    const record = await readJson(join(this.directory, 'deliveries', digest(destination) + '.json'), 33554432);
    need(record?.schema === RETAINED_DELIVERY &&
      record.packetSha256 === packet.manifest.packetSha256 &&
      record.acquisitionSha256 === digest(jsonBytes(binding)) &&
      record.native?.directory === destination, 'WORKBOOK_RETAINED_DELIVERY_CHANGED');
    const native = await DatasetDelivery.open(record.native);
    checkDelivery(packet, binding, native);
    return WorkbookDelivery.fromOriginal({packet, binding, native});
  }
  async *deliveries() {
    const {packet,binding} = await this._binding();
    const directory = join(this.directory, 'deliveries');
    if (!await exists(directory)) return;
    await privateDirectory(directory, {create:false});
    for (const name of (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
      const record = await readJson(join(directory, name), 33554432);
      need(record.schema === RETAINED_DELIVERY && record.packetSha256 === packet.manifest.packetSha256 &&
        record.acquisitionSha256 === digest(jsonBytes(binding)) &&
        digest(record.native?.directory ?? '') + '.json' === name, 'WORKBOOK_RETAINED_DELIVERY_CHANGED');
      yield {directory:record.native.directory, snapshot:record.native.nativeStatus?.snapshot,
        rows:record.native.nativeStatus?.rows, sourceBindingSha256:record.native.sourceBindingSha256,
        paymentStatus:clone(record.native.paymentStatus)};
    }
  }
  /** Exact same-session information for the existing live Analysis attach API. */
  async analysisSource(destination) {
    const {packet,binding} = await this._binding();
    const delivery = await this.openDelivery(destination);
    need(HASH.test(delivery.native.sourceBindingSha256 ?? ''), 'WORKBOOK_NATIVE_DELIVERY_BINDING_REQUIRED');
    return {acquisitionId:packet.request.datasetId, session:binding.sessionDirectory,
      room:delivery.native.directory, sessionId:binding.sessionId,
      configurationSha256:binding.configurationSha256,
      sourceBindingSha256:delivery.native.sourceBindingSha256};
  }
}
