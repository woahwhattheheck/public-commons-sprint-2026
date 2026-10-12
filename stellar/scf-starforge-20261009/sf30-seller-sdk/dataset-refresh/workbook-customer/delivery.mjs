// MIT. Portable receiving of original SF100 bytes and their source association.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatasetDelivery } from '../../../sf88-operator-buyer-cli/node/index.mjs';
import { absolute, privateDirectory, readBytes, readJson, parseJson, digest, jsonBytes,
  exists, object, need } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { PACKET_FILES, openWorkbookPacket, retainSame, fileRecord, validateFileRecords,
  readRecorded, MAX_REVIEW_BYTES } from './packet.mjs';

const SCHEMA = 'stellar-forge.workbook-customer-delivery.v1';
const ACQUISITION = 'stellar-forge.workbook-customer-acquisition.v1';
const OUTPUTS = ['dataset.jsonl','dataset.csv','review.html','manifest.json'];
const SOURCE_FILES = [...PACKET_FILES, 'manifest.json'];
const FILES = [...SOURCE_FILES.map(name => 'source/' + name),
  'acquisition.json', 'native-delivery.json', ...OUTPUTS.map(name => 'dataset/' + name)];
const HASH = /^[a-f0-9]{64}$/;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const clone = value => structuredClone(value);
const same = (a, b) => jsonBytes(a).equals(jsonBytes(b));
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function limit(name) {
  if (name === 'native-delivery.json') return 33554432;
  if (name === 'source/publisher-review.json' || name === 'source/request.json') return MAX_REVIEW_BYTES;
  if (name.startsWith('source/') || name === 'acquisition.json') return 65536;
  if (name === 'dataset/manifest.json') return 4 * 1024 * 1024;
  return MAX_OUTPUT_BYTES;
}
function checkBinding(packet, binding, report) {
  need(binding?.schema === ACQUISITION && binding.packetSha256 === packet.manifest.packetSha256 &&
    binding.datasetId === packet.request.datasetId && binding.sessionId === packet.request.intentId &&
    binding.expectedSnapshot === packet.request.snapshot && HASH.test(binding.configurationSha256 ?? '') &&
    report?.schema === 'stellar-forge.sf88.dataset-delivery.v1' &&
    report.sourceDirectory === binding.sessionDirectory &&
    report.nativeStatus?.finalized === true && report.nativeStatus.snapshot === packet.request.snapshot &&
    HASH.test(report.sourceBindingSha256 ?? '') && object(report.outputs),
  'WORKBOOK_NATIVE_DELIVERY_ASSOCIATION_CHANGED');
  for (const name of OUTPUTS) {
    const saved = report.outputs[name];
    need(object(saved) && saved.path === join(absolute(report.directory), name) &&
      Number.isSafeInteger(saved.bytes) && saved.bytes >= 0 && saved.bytes <= limit('dataset/' + name) &&
      HASH.test(saved.sha256 ?? ''), 'WORKBOOK_NATIVE_OUTPUT_METADATA_CHANGED');
  }
}
async function sourceBytes(packet, binding, nativeBytes) {
  const files = {};
  for (const name of SOURCE_FILES) files['source/' + name] = await readBytes(join(packet.directory, name),
    name === 'publisher-review.json' || name === 'request.json' ? MAX_REVIEW_BYTES : 65536);
  files['acquisition.json'] = jsonBytes(binding);
  files['native-delivery.json'] = nativeBytes;
  return files;
}
function outputRecords(native) {
  return Object.fromEntries(OUTPUTS.map(name => ['dataset/' + name,
    {bytes:native.outputs[name].bytes, sha256:native.outputs[name].sha256}]));
}
function manifestFor(packet, binding, native, smallFiles) {
  const files = {...Object.fromEntries(Object.entries(smallFiles).map(([name, raw]) => [name, fileRecord(raw)])),
    ...outputRecords(native)};
  const identity = {schema:SCHEMA, packetSha256:packet.manifest.packetSha256,
    snapshot:packet.request.snapshot, configurationSha256:binding.configurationSha256,
    sourceBindingSha256:native.sourceBindingSha256, files};
  return {...identity, bundleSha256:digest(jsonBytes(identity))};
}

/** Public native statuses remain unchanged. localView resolves only file paths
 * so the original DatasetDelivery can verify and consume a relocated export.
 */
export class WorkbookDelivery {
  constructor({packet, binding, native, data, smallFiles, bundleDirectory = null, manifest = null}) {
    this.request = freeze(clone(packet.request));
    this.publisherReview = freeze(clone(packet.review));
    this.native = freeze(clone(native));
    this.pathMapping = freeze({originalDirectory:native.directory, localDirectory:data.report.directory,
      files:Object.fromEntries(OUTPUTS.map(name => [name,
        {original:native.outputs[name].path, local:data.report.outputs[name].path}]))});
    this.bundleDirectory = bundleDirectory;
    this.manifest = manifest === null ? null : freeze(clone(manifest));
    Object.defineProperties(this, {
      _packet:{value:packet}, _binding:{value:binding}, _data:{value:data}, _smallFiles:{value:smallFiles},
    });
  }
  static async fromOriginal({packet, binding, native}) {
    const fresh = await openWorkbookPacket(packet.directory);
    need(fresh.manifest.packetSha256 === packet.manifest.packetSha256, 'WORKBOOK_SOURCE_PACKET_CHANGED');
    need(native instanceof DatasetDelivery, 'WORKBOOK_ORIGINAL_DATASET_DELIVERY_REQUIRED');
    checkBinding(fresh, binding, native.report);
    need(same(native.manifest.dataset.projectedFields, fresh.request.prepared.fields),
      'WORKBOOK_DELIVERED_COLUMNS_CHANGED');
    const smallFiles = await sourceBytes(fresh, binding, jsonBytes(native.report));
    return new WorkbookDelivery({packet:fresh, binding, native:native.report, data:native, smallFiles});
  }
  /** Reopen a receiving directory entirely through local native file readers. */
  static async open(directory) {
    directory = await privateDirectory(absolute(directory), {create:false});
    const rawManifest = await readBytes(join(directory, 'manifest.json'), 65536);
    const manifest = parseJson(rawManifest);
    need(manifest?.schema === SCHEMA && HASH.test(manifest.bundleSha256 ?? ''), 'WORKBOOK_DELIVERY_MANIFEST_INVALID');
    validateFileRecords(manifest.files, FILES);
    const identity = {...manifest}; delete identity.bundleSha256;
    need(digest(jsonBytes(identity)) === manifest.bundleSha256, 'WORKBOOK_DELIVERY_MANIFEST_CHANGED');
    await privateDirectory(join(directory, 'source'), {create:false});
    await privateDirectory(join(directory, 'dataset'), {create:false});
    const smallFiles = {};
    for (const name of FILES.filter(name => !name.startsWith('dataset/')))
      smallFiles[name] = await readRecorded(join(directory, name), manifest.files[name], limit(name));
    const packet = await openWorkbookPacket(join(directory, 'source'));
    const binding = parseJson(smallFiles['acquisition.json']), original = parseJson(smallFiles['native-delivery.json']);
    checkBinding(packet, binding, original);
    need(manifest.packetSha256 === packet.manifest.packetSha256 && manifest.snapshot === packet.request.snapshot &&
      manifest.configurationSha256 === binding.configurationSha256 &&
      manifest.sourceBindingSha256 === original.sourceBindingSha256,
    'WORKBOOK_DELIVERY_SOURCE_CHANGED');
    for (const name of OUTPUTS) {
      const record = manifest.files['dataset/' + name], output = original.outputs[name];
      need(record.bytes === output.bytes && record.sha256 === output.sha256, 'WORKBOOK_NATIVE_OUTPUT_METADATA_CHANGED');
    }
    const local = clone(original);
    local.directory = join(directory, 'dataset');
    local.outputs = Object.fromEntries(OUTPUTS.map(name => [name,
      {...original.outputs[name], path:join(local.directory, name)}]));
    const data = await DatasetDelivery.open(local);
    need(same(data.manifest.dataset.projectedFields, packet.request.prepared.fields),
      'WORKBOOK_DELIVERED_COLUMNS_CHANGED');
    // Fixed native outputs only. Each original reader verifies complete size/hash
    // without buffering the dataset; no file path comes from an untrusted name.
    for (const name of OUTPUTS) await data.file(name).verify();
    return new WorkbookDelivery({packet, binding, native:original, data, smallFiles,
      bundleDirectory:directory, manifest});
  }
  file(name) { return this._data.file(name); }
  rows(options) { return this._data.rows(options); }
  readRows(options) { return this._data.readRows(options); }
  get datasetManifest() { return this._data.manifest; }

  /** Stream/copy complete files with original VerifiedFile.saveAs. An interrupted
   * copy retains its completed prefix and repeats without merchant requests.
   */
  async copyTo(destination, {signal, maxOutputBytes, progress} = {}) {
    destination = absolute(destination);
    need(signal === undefined || signal instanceof AbortSignal, 'WORKBOOK_COPY_SIGNAL_INVALID');
    need(progress === undefined || typeof progress === 'function', 'WORKBOOK_COPY_PROGRESS_INVALID');
    const expected = manifestFor(this._packet, this._binding, this.native, this._smallFiles);
    const totalBytes = Object.values(expected.files).reduce((total, file) => total + file.bytes, 0);
    need(maxOutputBytes === undefined || Number.isSafeInteger(maxOutputBytes) && maxOutputBytes >= 0 &&
      totalBytes <= maxOutputBytes, 'WORKBOOK_COPY_CAP_EXCEEDED');
    await privateDirectory(destination);
    need((await readdir(destination)).every(name =>
      ['source','dataset','acquisition.json','native-delivery.json','manifest.json'].includes(name) ||
      /^\.write-[a-f0-9-]{36}$/.test(name)), 'WORKBOOK_SEPARATE_DELIVERY_DIRECTORY_REQUIRED');
    if (await exists(join(destination, 'manifest.json'))) {
      const retained = await WorkbookDelivery.open(destination);
      need(retained.manifest.bundleSha256 === expected.bundleSha256, 'WORKBOOK_RECEIVING_DIRECTORY_HAS_DIFFERENT_DELIVERY');
      return retained;
    }
    await privateDirectory(join(destination, 'source'));
    await privateDirectory(join(destination, 'dataset'));
    let completedFiles = 0;
    const notify = (file, complete = false) => progress?.({file, completedFiles, totalFiles:FILES.length, totalBytes, complete});
    for (const [name, raw] of Object.entries(this._smallFiles)) {
      need(!signal?.aborted, 'WORKBOOK_COPY_ABORTED');
      await retainSame(join(destination, name), raw);
      completedFiles++; notify(name);
    }
    for (const name of OUTPUTS) {
      need(!signal?.aborted, 'WORKBOOK_COPY_ABORTED');
      const target = join(destination, 'dataset', name);
      if (await exists(target)) {
        // Original DatasetFile is the exact fixed-file verifier for the copied
        // representation too. Only its local path changes.
        const {DatasetFile} = await import('../../../sf88-operator-buyer-cli/node/index.mjs');
        await new DatasetFile({name, ...this.native.outputs[name], path:target}, join(destination, 'dataset')).verify({signal});
      } else await this.file(name).saveAs(target, {signal});
      completedFiles++; notify('dataset/' + name);
    }
    need(!signal?.aborted, 'WORKBOOK_COPY_ABORTED');
    await retainSame(join(destination, 'manifest.json'), jsonBytes(expected));
    const reopened = await WorkbookDelivery.open(destination);
    notify('manifest.json', true);
    return reopened;
  }
}
