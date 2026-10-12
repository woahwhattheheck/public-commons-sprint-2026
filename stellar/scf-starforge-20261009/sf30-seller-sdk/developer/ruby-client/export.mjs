// MIT. Ruby customer continuation of the ORIGINAL five-file JS seller export.
import { constants } from 'node:fs';
import { readFile, open, lstat, mkdir, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { exportSellerClient, inspectSellerClientExport, readSellerClientFile,
  CLIENT_EXPORT_MANIFEST, CLIENT_EXPORT_FILES } from '../client-export.mjs';

export const RUBY_CLIENT_MANIFEST = 'ruby-client.json';
export const RUBY_CLIENT_FILES = Object.freeze(['seller_client.rb', 'seller_client.rbs',
  'seller-client-bridge.mjs', 'seller-buyer-bridge.mjs', 'seller-contract.json',
  'rails_receiving.rb', 'customer.rb', 'RUBY.md']);
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

The same commands work with: node developer/ruby-client/export.mjs ...
Request construction delegates to the original exported JS runtime. The Ruby
application delegates preparation, review, execution and recovery to the original
Node Buyer. See the generated RUBY.md for the complete customer flow.`;

async function directoryAt(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw error('DIRECTORY_REQUIRED', 'Select the original customer directory');
  const path = resolve(value), info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw error('DIRECTORY_REQUIRED', 'Select a real directory, not a symbolic link');
  return path;
}
async function bytesAt(directory, name, maximum = LIMIT) {
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
  const temporary = join(directory, '.ruby-client-' + randomUUID()); let file;
  try {
    file = await open(temporary, 'wx', 0o600); await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    try { await link(temporary, join(directory, name)); await syncDirectory(directory); }
    catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
      if (!(await bytesAt(directory, name)).equals(bytes)) throw error('FILE_CONFLICT', 'Retained file differs; preserve it and use a new export directory: ' + name);
    }
  } finally { if (file) await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
function fileRecord(name, bytes) { return { name, bytes: bytes.length, sha256: sha(bytes) }; }
function checkManifest(value, original) {
  if (!value || value.schema !== SCHEMA || value.sourceSha256 !== original.sourceSha256 ||
      value.originalManifestSha256 !== original.manifestFile.sha256 || !Array.isArray(value.files) ||
      value.files.length !== RUBY_CLIENT_FILES.length || value.files.some((file, i) =>
        file?.name !== RUBY_CLIENT_FILES[i] || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > LIMIT ||
        typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)))
    throw error('MANIFEST_INVALID', 'Ruby completion does not match the original complete seller export');
}

function declarations(snapshot) {
  const operationIds = snapshot.operations.map(operation => JSON.stringify(operation.id)).join(' | ') || 'String';
  return `# MIT. Generated from original seller OpenAPI ${snapshot.sourceSha256}.
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
end
`;
}
async function payloads(original) {
  return new Map([
    ['seller_client.rb', await readFile(new URL('./seller_client.rb', import.meta.url))],
    ['seller_client.rbs', Buffer.from(declarations(original.snapshot))],
    ['seller-client-bridge.mjs', await readFile(new URL('./request-bridge.mjs', import.meta.url))],
    ['seller-buyer-bridge.mjs', await readFile(new URL('./buyer-bridge.mjs', import.meta.url))],
    ['seller-contract.json', json(original.snapshot)],
    ['rails_receiving.rb', await readFile(new URL('./rails_receiving.rb', import.meta.url))],
    ['customer.rb', await readFile(new URL('./examples/customer.rb', import.meta.url))],
    ['RUBY.md', await readFile(new URL('./RUBY.md', import.meta.url))],
  ]);
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

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { process.stdout.write(USAGE + '\n'); return; }
  const command = args[0], flags = args.slice(1), options = new Map();
  const allowed = command === 'export' ? ['--openapi', '--out'] : ['copy', 'copy-resume'].includes(command) ? ['--dir', '--out']
    : ['resume', 'status'].includes(command) ? ['--dir'] : null;
  if (!allowed || flags.length !== allowed.length * 2) throw new TypeError(USAGE);
  for (let i = 0; i < flags.length; i += 2) {
    if (!allowed.includes(flags[i]) || options.has(flags[i]) || !flags[i + 1] || flags[i + 1].startsWith('--')) throw new TypeError(USAGE);
    options.set(flags[i], flags[i + 1]);
  }
  const selected = { directory: options.get('--dir'), out: options.get('--out'), openapi: options.get('--openapi'), resume: command === 'copy-resume' };
  const result = await ({ export: exportRubySellerClient, resume: completeRubySellerClient,
    status: inspectRubySellerClient, copy: copyRubySellerClient, 'copy-resume': copyRubySellerClient }[command])(selected);
  process.stdout.write(JSON.stringify(result) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(cause => { process.stderr.write(`${cause.code ?? 'RUBY_CLIENT_ERROR'}: ${cause.message}\n`); process.exitCode = 1; });
