// MIT. Ruby customer continuation of the ORIGINAL five-file JS seller export.
import { constants } from 'node:fs';
import { readFile, open, lstat, mkdir, link, unlink, realpath, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { exportSellerClient, inspectSellerClientExport, readSellerClientFile,
  CLIENT_EXPORT_MANIFEST, CLIENT_EXPORT_FILES } from '../client-export.mjs';

export const RUBY_CLIENT_MANIFEST = 'ruby-client.json';
export const LEGACY_RUBY_CLIENT_FILES = Object.freeze(["seller_client.rb","seller_client.rbs","seller-client-bridge.mjs","seller-buyer-bridge.mjs","seller-contract.json","rails_receiving.rb","customer.rb","RUBY.md"]);
export const LEGACY_DATASET_RUBY_CLIENT_FILES = Object.freeze(["seller_client.rb","seller_client.rbs","seller-client-bridge.mjs","seller-buyer-bridge.mjs","seller-contract.json","rails_receiving.rb","customer.rb","RUBY.md","seller-dataset-bridge.mjs","dataset_delivery.rb","dataset_receiving.rb","dataset_customer.rb","rails_dataset.rb","DATASETS.md","examples/dataset_lifecycle.rb","examples/rails_dataset/create_dataset_import_tables.rb","examples/rails_dataset/models.rb","examples/rails_dataset/import_dataset_job.rb","examples/rails_dataset/commission.rb","examples/rails_dataset/mapping.json","examples/rails_dataset/README.md"]);
export const LEGACY_COMPLETE_RUBY_CLIENT_FILES = Object.freeze([...LEGACY_DATASET_RUBY_CLIENT_FILES,...["native_dataset.rb","native_dataset_receiving.rb","native_dataset_customer.rb","NATIVE_DATASETS.md","examples/native_dataset_lifecycle.rb"]]);
export const DATASET_OPERATOR_FILES = Object.freeze(["examples/rails_dataset/operator/workspace.rb","examples/rails_dataset/operator/jobs.rb","examples/rails_dataset/operator/controller.rb","examples/rails_dataset/operator/commission.rb","examples/rails_dataset/operator/README.md","examples/rails_dataset/operator/install.rb","examples/rails_dataset/operator/operator.css","examples/rails_dataset/operator/views/layouts/starforge_dataset_operator.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/index.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/show.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/changes.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/history.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/attachments.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/error.html.erb"]);
export const RUBY_CLIENT_FILES = Object.freeze([...LEGACY_COMPLETE_RUBY_CLIENT_FILES,...DATASET_OPERATOR_FILES]);
export const LEGACY_NATIVE_RUBY_CLIENT_FILES = Object.freeze(["seller_client.rb","seller_client.rbs","dataset_delivery.rb","native_dataset.rb","native_dataset_receiving.rb","native_dataset_customer.rb","rails_dataset.rb","NATIVE_DATASETS.md","DATASETS.md","examples/native_dataset_lifecycle.rb","examples/rails_dataset/create_dataset_import_tables.rb","examples/rails_dataset/models.rb","examples/rails_dataset/import_dataset_job.rb","examples/rails_dataset/commission.rb","examples/rails_dataset/mapping.json","examples/rails_dataset/README.md"]);
export const NATIVE_RUBY_CLIENT_FILES = Object.freeze([...LEGACY_NATIVE_RUBY_CLIENT_FILES,...DATASET_OPERATOR_FILES]);
export const NATIVE_RUBY_CLIENT_MANIFEST = 'native-dataset-client.json';
const NATIVE_SCHEMA = 'stellar-forge.ruby-native-dataset-client.v1';
const NATIVE_SELECTION = 'native-client-source.json';
const SCHEMA = 'stellar-forge.ruby-seller-client.v1';
const LIMIT = 64 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const error = (code, message) => Object.assign(new Error(message), { code: 'RUBY_CLIENT_' + code });
const USAGE = `Original Ruby customer package:
  starforge client ruby export --openapi SELLER_OPENAPI.json --out NEW_DIRECTORY
  starforge client ruby resume --dir ORIGINAL_COMPLETED_JS_EXPORT
  starforge client ruby status --dir CUSTOMER_DIRECTORY
  starforge client ruby copy --dir CUSTOMER_DIRECTORY --out NEW_DIRECTORY
  starforge client ruby copy-resume --dir CUSTOMER_DIRECTORY --out INTERRUPTED_COPY
  starforge client ruby native-export --out NEW_NATIVE_CUSTOMER_DIRECTORY
  starforge client ruby native-resume --dir INTERRUPTED_NATIVE_PACKAGE
  starforge client ruby native-status --dir NATIVE_CUSTOMER_DIRECTORY
  starforge client ruby native-copy --dir NATIVE_CUSTOMER_DIRECTORY --out NEW_DIRECTORY
  starforge client ruby native-copy-resume --dir NATIVE_CUSTOMER_DIRECTORY --out INTERRUPTED_COPY

The same commands work with: node developer/ruby-client/export.mjs ...
Request construction delegates to the original exported JS runtime. The Ruby
application delegates preparation, review, execution and recovery to the original
Node Buyer. See RUBY.md for saved responses and DATASETS.md plus the delivered\nRails examples for complete dataset receiving and transactional application editions.
The standalone native package receives an existing finalized SF100 room through
its original receiver. See NATIVE_DATASETS.md for complete source/recipient use.`;

async function directoryAt(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw error('DIRECTORY_REQUIRED', 'Select the original customer directory');
  const path = resolve(value), info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw error('DIRECTORY_REQUIRED', 'Select a real directory, not a symbolic link');
  return path;
}
async function parentAt(directory, name, create = false) {
  const parts = name.split('/');
  if (!parts.length || parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part) || part === '.' || part === '..'))
    throw error('FILE_NAME_INVALID', 'Choose an original customer package file');
  let parent = directory;
  for (const part of parts.slice(0,-1)) {
    const next = join(parent,part);
    if (create) {
      try { await mkdir(next,{mode:0o700}); await syncDirectory(parent); }
      catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
    }
    await directoryAt(next);
    parent = next;
  }
  return parent;
}
async function bytesAt(directory, name, maximum = LIMIT) {
  await parentAt(directory,name);
  const file = await open(join(directory, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > maximum) throw error('FILE_INVALID', 'Expected a complete regular customer file: ' + name);
    const bytes = await file.readFile(), after = await file.stat();
    if (bytes.length !== before.size || bytes.length > maximum || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw error('FILE_CHANGED', 'Customer file changed during read: ' + name);
    return bytes;
  } finally { await file.close(); }
}
async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const file = await open(directory, 'r');
  try { await file.sync(); } finally { await file.close(); }
}
async function publishOnce(directory, name, bytes) {
  const parent = await parentAt(directory,name,true);
  const temporary = join(parent, '.ruby-client-' + randomUUID()); let file;
  try {
    file = await open(temporary, 'wx', 0o600); await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    try { await link(temporary, join(directory, name)); await syncDirectory(parent); }
    catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
      if (!(await bytesAt(directory, name)).equals(bytes)) throw error('FILE_CONFLICT', 'Retained file differs; preserve it and use a new export directory: ' + name);
    }
  } finally { if (file) await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
function fileRecord(name, bytes) { return { name, bytes: bytes.length, sha256: sha(bytes) }; }
function checkManifest(value, original) {
  const expected = [LEGACY_RUBY_CLIENT_FILES,LEGACY_DATASET_RUBY_CLIENT_FILES,LEGACY_COMPLETE_RUBY_CLIENT_FILES,RUBY_CLIENT_FILES]
    .find(files => value?.files?.length === files.length);
  if (!value || value.schema !== SCHEMA || value.sourceSha256 !== original.sourceSha256 ||
      value.originalManifestSha256 !== original.manifestFile.sha256 || !Array.isArray(value.files) || !expected ||
      value.files.length !== expected.length || value.files.some((file, i) =>
        file?.name !== expected[i] || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > LIMIT ||
        typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)))
    throw error('MANIFEST_INVALID', 'Ruby completion does not match the original complete seller export');
}

function declarations(snapshot) {
  const operationIds = (snapshot?.operations ?? []).map(operation => JSON.stringify(operation.id)).join(' | ') || 'String';
  return `# MIT. ${snapshot ? "Generated from original seller OpenAPI " + snapshot.sourceSha256 : "Original finalized SF100 customer receiving and Rails editions"}.
module Starforge
  type operation_id = ${operationIds}
  type json_object = Hash[String, untyped]

  class Error < StandardError
    attr_reader code: String
    attr_reader call_id: String?
    attr_reader intent_id: String?
  end

  class Cancellation
    def initialize: () -> void
    def cancel: () -> bool
    def cancelled?: () -> bool
  end

  class BoundRequest
    attr_reader body: String?
    def source_sha256: () -> String
    def operation_id: () -> operation_id
    def intent_id: () -> String
    def describe: () -> json_object
    def input_bytes: () -> String
    def record_bytes: () -> String
    def save: (String directory) -> String
  end

  class SellerClient
    attr_reader directory: String
    attr_reader manifest_sha256: String
    def initialize: (?String directory, ?node: String, ?environment: Hash[String, String]?, ?timeout: Numeric) -> void
    def verify_package!: () -> bool
    def dataset_available?: () -> bool
    def native_dataset_available?: () -> bool
    def source: () -> json_object
    def operations: () -> Array[json_object]
    def build_request: (operation_id operation_id, json_object inputs, intent_id: String,
      max_atomic: String, ?accept_index: Integer?, ?payment_flow: String?) -> BoundRequest
    def load_request: (String directory) -> BoundRequest
    def prepare: (Buyer buyer, BoundRequest bound, ?response_file: json_object?,
      ?call_id: String?, ?cancel: Cancellation?) -> Operation
    def reopen: (Buyer buyer, String intent_id) -> Operation
  end

  class Buyer
    attr_reader directory: String
    def initialize: (client: SellerClient, runtime_directory: String, state_directory: String,
      ?node: String, ?environment: Hash[String, String]?, ?operator_profile: String?,
      ?workspace_directory: String?, ?timeout: Numeric, ?output_limit: Integer) -> void
    def ready: () -> json_object
    def close: () -> nil
  end

  class Operation
    attr_reader buyer: Buyer
    attr_reader intent_id: String
    attr_reader source_sha256: String
    def status: (?call_id: String?, ?cancel: Cancellation?) -> json_object
    def review: (?call_id: String?, ?cancel: Cancellation?) -> json_object
    def execute: (review: json_object, ?call_id: String?, ?cancel: Cancellation?) -> json_object
    def recover: (?call_id: String?, ?cancel: Cancellation?) -> json_object?
    def receive: (String directory, ?call_id: String?, ?cancel: Cancellation?) -> Delivery
  end

  class Receiving
    attr_reader directory: String
    attr_reader intent_id: String
    def self.intent_id: (String key) -> String
    def self.received: (directory: String, key: String, ?expected_manifest_sha256: String?) -> Delivery
    def initialize: (client: SellerClient, buyer: Buyer, directory: String, key: String,
      bound: BoundRequest, ?response_file: json_object?) -> void
    def complete?: () -> bool
    def delivery: () -> Delivery
    def prepare: (?cancel: Cancellation?) -> Operation
    def review: (?cancel: Cancellation?) -> json_object
    def execute: (review: json_object, ?cancel: Cancellation?) -> json_object
    def recover: (?cancel: Cancellation?) -> json_object?
    def status: (?cancel: Cancellation?) -> json_object
    def receive: (?cancel: Cancellation?) -> Delivery
  end

  class Delivery
    attr_reader directory: String
    attr_reader manifest_sha256: String
    def self.open: (String directory, expected_manifest_sha256: String) -> Delivery
    def manifest: () -> json_object
    def descriptor: (String name) -> json_object
    def bytes: (?limit: Integer) -> String
    def json: (?limit: Integer) -> untyped
    def json_file: (String name, ?limit: Integer) -> untyped
    def each_chunk: (?chunk_size: Integer) { (String) -> void } -> untyped
                 | (?chunk_size: Integer) -> Enumerator[String, untyped]
    def each_csv: (?headers: bool) { (untyped) -> void } -> untyped
               | (?headers: bool) -> Enumerator[untyped, untyped]
  end

  class DatasetDelivery
    attr_reader directory: String
    attr_reader manifest_sha256: String
    attr_reader manifest: json_object
    attr_reader native_manifest: json_object
    attr_reader semantics: json_object?
    def self.open: (String directory, expected_manifest_sha256: String) -> DatasetDelivery
    def fields: () -> Array[String]
    def row_count: () -> Integer
    def snapshot: () -> String
    def source_sha256: () -> String
    def selection: () -> json_object
    def acquisition: () -> json_object?
    def source_format: () -> String
    def membership: () -> json_object
    def native_delivery: () -> json_object
    def source: () -> json_object
    def descriptor: (String name) -> json_object
    def file_bytes: (String name, ?limit: Integer) -> String
    def json_file: (String name, ?limit: Integer) -> untyped
    def each_chunk: (String name, ?chunk_size: Integer) { (String) -> void } -> nil
                  | (String name, ?chunk_size: Integer) -> Enumerator[String, nil]
    def each_record: (?max_row_bytes: Integer) { (json_object) -> void } -> nil
                   | (?max_row_bytes: Integer) -> Enumerator[json_object, nil]
    def each_row: (?max_row_bytes: Integer) { (json_object) -> void } -> nil
                | (?max_row_bytes: Integer) -> Enumerator[json_object, nil]
    def copy_to: (String destination) -> DatasetDelivery
  end

  class NativeDatasetDelivery < DatasetDelivery
    attr_reader native_receipt: json_object
  end

  class NativeDatasetReceiving
    attr_reader directory: String
    def self.received: (directory: String, ?expected_manifest_sha256: String?) -> NativeDatasetDelivery
    def self.resume: (directory: String, ?cancel: Cancellation?, ?timeout: Numeric) -> NativeDatasetDelivery
    def self.status: (directory: String) -> json_object
    def initialize: (directory: String, room: String, source_key: String, dataset_id: String,
      expected_native_manifest_sha256: String, checkout: String, python: String, node: String) -> void
    def receive: (?cancel: Cancellation?, ?timeout: Numeric) -> NativeDatasetDelivery
  end

  class DatasetReceiving
    attr_reader directory: String
    attr_reader dataset_id: String
    def self.dataset_id: (String key) -> String
    def self.normalize_limits: (json_object limits, ?historical: bool) -> json_object
    def self.directory_for: (String directory, String key, ?create: bool) -> String
    def self.retained_job: (directory: String, key: String) -> json_object
    def self.received: (directory: String, key: String, ?expected_manifest_sha256: String?) -> DatasetDelivery
    def initialize: (client: SellerClient, buyer: Buyer, directory: String, key: String,
      bound: BoundRequest, limits: json_object, ?expected_snapshot: String?, ?original_session: json_object?) -> void
    def complete?: () -> bool
    def delivery: () -> DatasetDelivery
    def prepare: (?cancel: Cancellation?) -> json_object
    def review: (?cancel: Cancellation?) -> json_object
    def recover: (?cancel: Cancellation?) -> json_object
    def status: (?cancel: Cancellation?) -> json_object
    def run: (review: json_object, action_key: String, ?cancel: Cancellation?) -> json_object
    def receive: (?cancel: Cancellation?) -> DatasetDelivery
  end

  class RailsDataset
    class ImportError < StandardError
      attr_reader code: String
      attr_reader details: Hash[Symbol, untyped]
    end

    class Mapping
      attr_reader definition: json_object
      attr_reader columns: Hash[String, json_object]
      attr_reader key_columns: Array[String]
      attr_reader sha256: String
      attr_reader key_sha256: String
      attr_reader removal: json_object
    end

    class Preview
      attr_reader binding: json_object
      attr_reader counts: Hash[String, Integer]
      attr_reader sha256: String
      attr_reader entries_sha256: String
      attr_reader row_count: Integer
      def summary: () -> json_object
      def each_entry: () { (json_object) -> void } -> Preview
                    | () -> Enumerator[json_object, Preview]
      def write_json: (untyped io) -> Preview
      def write_csv: (untyped io) -> Preview
      def close: () -> void
    end

    attr_reader mapping: Mapping
    def initialize: (delivery: DatasetDelivery, scope: untyped, stream: untyped,
      models: Hash[Symbol, untyped], mapping: json_object) -> void
    def preview: () -> Preview
    def import!: (operation_key: String, expected_preview_sha256: String) -> json_object
    def receipt: (operation_key: String) -> json_object
    def write_receipt: (untyped io, operation_key: String) -> json_object
  end
end
`;
}
async function payloads(original) {
  const result = new Map([
    ['seller_client.rb', await readFile(new URL('./seller_client.rb', import.meta.url))],
    ['seller_client.rbs', Buffer.from(declarations(original.snapshot))],
    ['seller-client-bridge.mjs', await readFile(new URL('./request-bridge.mjs', import.meta.url))],
    ['seller-buyer-bridge.mjs', await readFile(new URL('./buyer-bridge.mjs', import.meta.url))],
    ['seller-contract.json', json(original.snapshot)],
    ['rails_receiving.rb', await readFile(new URL('./rails_receiving.rb', import.meta.url))],
    ['customer.rb', await readFile(new URL('./examples/customer.rb', import.meta.url))],
    ['RUBY.md', await readFile(new URL('./RUBY.md', import.meta.url))],
    ['seller-dataset-bridge.mjs', await readFile(new URL('./dataset-bridge.mjs', import.meta.url))],
    ['dataset_delivery.rb', await readFile(new URL('./dataset_delivery.rb', import.meta.url))],
    ['dataset_receiving.rb', await readFile(new URL('./dataset_receiving.rb', import.meta.url))],
    ['dataset_customer.rb', await readFile(new URL('./examples/dataset_customer.rb', import.meta.url))],
    ['rails_dataset.rb', await readFile(new URL('./rails_dataset.rb', import.meta.url))],
    ['DATASETS.md', await readFile(new URL('./DATASETS.md', import.meta.url))],
    ['examples/dataset_lifecycle.rb', await readFile(new URL('./examples/dataset_lifecycle.rb', import.meta.url))],
    ['examples/rails_dataset/create_dataset_import_tables.rb', await readFile(new URL('./examples/rails_dataset/create_dataset_import_tables.rb', import.meta.url))],
    ['examples/rails_dataset/models.rb', await readFile(new URL('./examples/rails_dataset/models.rb', import.meta.url))],
    ['examples/rails_dataset/import_dataset_job.rb', await readFile(new URL('./examples/rails_dataset/import_dataset_job.rb', import.meta.url))],
    ['examples/rails_dataset/commission.rb', await readFile(new URL('./examples/rails_dataset/commission.rb', import.meta.url))],
    ['examples/rails_dataset/mapping.json', await readFile(new URL('./examples/rails_dataset/mapping.json', import.meta.url))],
    ['examples/rails_dataset/README.md', await readFile(new URL('./examples/rails_dataset/README.md', import.meta.url))],
    ['native_dataset.rb', await readFile(new URL('./native_dataset.rb', import.meta.url))],
    ['native_dataset_receiving.rb', await readFile(new URL('./native_dataset_receiving.rb', import.meta.url))],
    ['native_dataset_customer.rb', await readFile(new URL('./examples/native_dataset_customer.rb', import.meta.url))],
    ['NATIVE_DATASETS.md', await readFile(new URL('./NATIVE_DATASETS.md', import.meta.url))],
    ['examples/native_dataset_lifecycle.rb', await readFile(new URL('./examples/native_dataset_lifecycle.rb', import.meta.url))],
  ]);
  for(const name of DATASET_OPERATOR_FILES) result.set(name,await readFile(new URL('./'+name,import.meta.url)));
  return result;
}

/** Inspect complete original JS and Ruby source bytes, without executing them. */
export async function inspectRubySellerClient({ directory } = {}) {
  const original = await inspectSellerClientExport({ directory });
  if (original.state !== 'COMPLETE') return { state: 'ORIGINAL_EXPORT_INCOMPLETE', original };
  directory = original.directory;
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytesAt(directory, RUBY_CLIENT_MANIFEST, 131072))); }
  catch (cause) {
    if (cause.code === 'ENOENT') return { state: 'RUBY_EXPORT_INCOMPLETE', directory, sourceSha256: original.sourceSha256,
      originalManifestSha256: original.manifestFile.sha256 };
    throw cause;
  }
  checkManifest(manifest, original);
  for (const entry of manifest.files) {
    const bytes = await bytesAt(directory, entry.name);
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw error('FILE_CHANGED', 'Ruby customer file differs from completion: ' + entry.name);
  }
  return { state: 'COMPLETE', directory, sourceSha256: original.sourceSha256,
    origin: original.origin, mode: original.mode, operations: original.operations,
    capabilities:manifest.files.length === LEGACY_RUBY_CLIENT_FILES.length ? ['single-response'] :
      ['single-response','dataset','rails-dataset-editions',...(manifest.files.some(item=>item.name==='native_dataset.rb')?['direct-sf100-dataset']:[]),
        ...(manifest.files.some(item=>item.name==='examples/rails_dataset/operator/controller.rb')?['rails-dataset-operator']:[])],
    manifest, manifestSha256: sha(await bytesAt(directory, RUBY_CLIENT_MANIFEST, 131072)),
    files: [...original.files, original.manifestFile, ...manifest.files] };
}

/** Complete interrupted additive output, keeping all five original JS files intact. */
export async function completeRubySellerClient({ directory } = {}) {
  directory = await directoryAt(directory);
  const original = await inspectSellerClientExport({ directory, includeOffers: true });
  if (original.state !== 'COMPLETE') throw error('ORIGINAL_COMPLETION_REQUIRED', 'Complete or explicitly adopt the original JS export first');
  const current = await inspectRubySellerClient({ directory });
  if (current.state === 'COMPLETE') return { ...current, reused: true };
  const files = await payloads(original);
  for (const [name, bytes] of files) await publishOnce(directory, name, bytes);
  // Source upgrades during an interrupted addition must not mix two packages.
  const after = await inspectSellerClientExport({ directory });
  if (after.state !== 'COMPLETE' || after.manifestFile.sha256 !== original.manifestFile.sha256)
    throw error('SOURCE_CHANGED', 'Original customer export changed; retain this directory for inspection');
  const manifest = { schema: SCHEMA, sourceSha256: original.sourceSha256,
    originalManifestSha256: original.manifestFile.sha256,
    files: [...files].map(([name, bytes]) => fileRecord(name, bytes)) };
  await publishOnce(directory, RUBY_CLIENT_MANIFEST, json(manifest));
  return inspectRubySellerClient({ directory });
}

export async function exportRubySellerClient({ openapi, out, provenance } = {}) {
  await exportSellerClient({ openapi, out, provenance });
  return completeRubySellerClient({ directory: out });
}

/** Transfer the exact retained package, rather than regenerating against newer code. */
export async function copyRubySellerClient({ directory, out, resume = false } = {}) {
  const source = await inspectRubySellerClient({ directory });
  if (source.state !== 'COMPLETE') throw error('COMPLETION_REQUIRED', 'Copy a complete original customer package');
  if (typeof out !== 'string' || !out || out.includes('\0')) throw error('DIRECTORY_REQUIRED', 'Supply a new destination directory');
  const receipt = await bytesAt(source.directory, RUBY_CLIENT_MANIFEST, 131072);
  if (sha(receipt) !== source.manifestSha256) throw error('SOURCE_CHANGED', 'Customer source changed before transfer');
  out = resolve(out); await directoryAt(dirname(out));
  try { await mkdir(out, { mode: 0o700 }); await syncDirectory(dirname(out)); }
  catch (cause) {
    if (!resume || cause.code !== 'EEXIST') throw cause;
    await directoryAt(out);
    try {
      const retained = await bytesAt(out, RUBY_CLIENT_MANIFEST, 131072);
      if (!retained.equals(receipt)) throw error('FILE_CONFLICT', 'Destination is a different completed Ruby customer package');
    } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
  }
  for (const name of [...CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST]) {
    const original = await readSellerClientFile({ directory: source.directory, file: name,
      expectedManifestSha256: source.manifest.originalManifestSha256 });
    await publishOnce(out, name, original.bytes);
  }
  for (const entry of source.manifest.files) {
    const bytes = await bytesAt(source.directory, entry.name);
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw error('FILE_CHANGED', 'Retained customer file changed during transfer');
    await publishOnce(out, entry.name, bytes);
  }
  const completed = await inspectRubySellerClient({ directory: source.directory });
  if (completed.state !== 'COMPLETE' || completed.manifestSha256 !== source.manifestSha256)
    throw error('SOURCE_CHANGED', 'Customer source changed during transfer');
  await publishOnce(out, RUBY_CLIENT_MANIFEST, receipt);
  return inspectRubySellerClient({ directory: out });
}


async function nativePayloads() {
  const result = new Map();
  for (const name of NATIVE_RUBY_CLIENT_FILES) {
    const source = name === 'native_dataset_customer.rb' ? 'examples/native_dataset_customer.rb' : name;
    result.set(name,name === 'seller_client.rbs' ? Buffer.from(declarations(null)) :
      await readFile(new URL('./'+source,import.meta.url)));
  }
  return result;
}
function nativeManifest(files) {
  return {schema:NATIVE_SCHEMA,files:[...files].map(([name,bytes])=>fileRecord(name,bytes))};
}
function checkNativeManifest(value) {
  const expected = [LEGACY_NATIVE_RUBY_CLIENT_FILES,NATIVE_RUBY_CLIENT_FILES]
    .find(files=>files.length===value?.files?.length);
  if (!value || value.schema !== NATIVE_SCHEMA || !Array.isArray(value.files) || !expected ||
      value.files.length !== expected.length || value.files.some((file,index)=>
        file?.name !== expected[index] || !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 || file.bytes > LIMIT || typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(file.sha256)))
    throw error('NATIVE_MANIFEST_INVALID','Choose the complete original native Ruby package');
  return value;
}

/** Portable native receiving source, selected independently of a seller contract. */
export async function inspectNativeRubyClient({directory}={}) {
  directory = await directoryAt(directory);
  let bytes;
  try { bytes = await bytesAt(directory,NATIVE_RUBY_CLIENT_MANIFEST,131072); }
  catch(cause) {
    if(cause.code==='ENOENT') return {state:'NATIVE_RUBY_EXPORT_INCOMPLETE',directory};
    throw cause;
  }
  const manifest = checkNativeManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  for(const item of manifest.files) {
    const current = await bytesAt(directory,item.name);
    if(current.length!==item.bytes || sha(current)!==item.sha256)
      throw error('NATIVE_FILE_CHANGED','The selected native customer source differs: '+item.name);
  }
  return {state:'COMPLETE',directory,manifest,manifestSha256:sha(bytes),
    capabilities:['direct-sf100-dataset','offline-dataset-receiving','rails-dataset-editions',
      ...(manifest.files.some(file=>file.name==='examples/rails_dataset/operator/controller.rb')?['rails-dataset-operator']:[])],
    files:manifest.files};
}

async function finishNative(directory, selected, payload) {
  const manifest = checkNativeManifest(JSON.parse(selected.toString('utf8')));
  const selectedPayload = new Map(manifest.files.map(item=>[item.name,payload.get(item.name)]));
  if([...selectedPayload.values()].some(bytes=>!Buffer.isBuffer(bytes)) ||
    JSON.stringify(manifest)!==JSON.stringify(nativeManifest(selectedPayload)))
    throw error('NATIVE_SOURCE_CHANGED','Resume with the source edition retained in native-client-source.json');
  for(const [name,bytes] of selectedPayload) await publishOnce(directory,name,bytes);
  await publishOnce(directory,NATIVE_RUBY_CLIENT_MANIFEST,selected);
  return inspectNativeRubyClient({directory});
}

export async function exportNativeRubyClient({out}={}) {
  if(typeof out!=='string'||!out||out.includes('\0')) throw error('DIRECTORY_REQUIRED','Choose a new native customer directory');
  const payload = await nativePayloads(), selected = json(nativeManifest(payload));
  out = resolve(out);
  await directoryAt(dirname(out));
  await mkdir(out,{mode:0o700});
  await syncDirectory(dirname(out));
  await publishOnce(out,NATIVE_SELECTION,selected);
  return finishNative(out,selected,payload);
}

export async function completeNativeRubyClient({directory}={}) {
  const current = await inspectNativeRubyClient({directory});
  if(current.state==='COMPLETE') return {...current,reused:true};
  const payload = await nativePayloads();
  let selected;
  try { selected = await bytesAt(current.directory,NATIVE_SELECTION,131072); }
  catch(cause) {
    if(cause.code!=='ENOENT') throw cause;
    const info = await lstat(current.directory);
    if((typeof process.getuid==='function' && info.uid!==process.getuid()) || (info.mode&0o077)!==0 ||
      (await readdir(current.directory)).length!==0)
      throw error('NATIVE_SOURCE_REQUIRED','Select the original source for this nonempty interrupted package');
    selected = json(nativeManifest(payload));
    await publishOnce(current.directory,NATIVE_SELECTION,selected);
  }
  return finishNative(current.directory,selected,payload);
}

export async function copyNativeRubyClient({directory,out,resume=false}={}) {
  const source = await inspectNativeRubyClient({directory});
  if(source.state!=='COMPLETE') throw error('NATIVE_COMPLETION_REQUIRED','Select the complete original native customer package');
  if(typeof out!=='string'||!out||out.includes('\0')) throw error('DIRECTORY_REQUIRED','Choose a native customer destination');
  const selected = await bytesAt(source.directory,NATIVE_RUBY_CLIENT_MANIFEST,131072);
  if(sha(selected)!==source.manifestSha256) throw error('NATIVE_SOURCE_CHANGED','The selected package changed before transfer');
  out=resolve(out);await directoryAt(dirname(out));
  try {await mkdir(out,{mode:0o700});await syncDirectory(dirname(out));}
  catch(cause){if(!resume||cause.code!=='EEXIST')throw cause;await directoryAt(out);}
  await publishOnce(out,NATIVE_SELECTION,selected);
  for(const item of source.manifest.files) {
    const bytes=await bytesAt(source.directory,item.name);
    if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)
      throw error('NATIVE_SOURCE_CHANGED','The selected customer source changed during transfer');
    await publishOnce(out,item.name,bytes);
  }
  const after=await inspectNativeRubyClient({directory:source.directory});
  if(after.manifestSha256!==source.manifestSha256)
    throw error('NATIVE_SOURCE_CHANGED','The selected customer completion changed during transfer');
  await publishOnce(out,NATIVE_RUBY_CLIENT_MANIFEST,selected);
  return inspectNativeRubyClient({directory:out});
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { process.stdout.write(USAGE + '\n'); return; }
  const command = args[0], flags = args.slice(1), options = new Map();
  const allowed = command === 'export' ? ['--openapi', '--out'] :
    command === 'native-export' ? ['--out'] :
    ['copy','copy-resume','native-copy','native-copy-resume'].includes(command) ? ['--dir','--out'] :
    ['resume','status','native-resume','native-status'].includes(command) ? ['--dir'] : null;
  if (!allowed || flags.length !== allowed.length * 2) throw new TypeError(USAGE);
  for (let i = 0; i < flags.length; i += 2) {
    if (!allowed.includes(flags[i]) || options.has(flags[i]) || !flags[i + 1] || flags[i + 1].startsWith('--')) throw new TypeError(USAGE);
    options.set(flags[i], flags[i + 1]);
  }
  const selected = { directory: options.get('--dir'), out: options.get('--out'), openapi: options.get('--openapi'), resume: ['copy-resume','native-copy-resume'].includes(command) };
  const result = await ({ export: exportRubySellerClient, resume: completeRubySellerClient,
    status: inspectRubySellerClient, copy: copyRubySellerClient, 'copy-resume': copyRubySellerClient,
    'native-export':exportNativeRubyClient,'native-resume':completeNativeRubyClient,
    'native-status':inspectNativeRubyClient,'native-copy':copyNativeRubyClient,
    'native-copy-resume':copyNativeRubyClient }[command])(selected);
  process.stdout.write(JSON.stringify(result) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(cause => { process.stderr.write(`${cause.code ?? 'RUBY_CLIENT_ERROR'}: ${cause.message}\n`); process.exitCode = 1; });
