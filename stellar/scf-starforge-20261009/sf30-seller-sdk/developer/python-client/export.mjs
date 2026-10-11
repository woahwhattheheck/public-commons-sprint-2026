// MIT. Python customer continuation of the ORIGINAL five-file JS seller export.
import { constants } from 'node:fs';
import { readFile, open, lstat, mkdir, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { exportSellerClient, inspectSellerClientExport, readSellerClientFile,
  CLIENT_EXPORT_MANIFEST, CLIENT_EXPORT_FILES } from '../client-export.mjs';

export const PYTHON_CLIENT_MANIFEST = 'python-client.json';
export const PYTHON_CLIENT_FILES = Object.freeze(['seller_client.py', 'seller_client.pyi',
  'seller-client-bridge.mjs', 'seller-contract.json', 'PYTHON.md']);
const SCHEMA = 'stellar-forge.python-seller-client.v1';
const LIMIT = 64 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const error = (code, message) => Object.assign(new Error(message), { code: 'PYTHON_CLIENT_' + code });
const USAGE = `Original Python customer package:
  starforge client python export --openapi SELLER_OPENAPI.json --out NEW_DIRECTORY
  starforge client python resume --dir ORIGINAL_COMPLETED_JS_EXPORT
  starforge client python status --dir CUSTOMER_DIRECTORY
  starforge client python copy --dir CUSTOMER_DIRECTORY --out NEW_DIRECTORY
  starforge client python copy-resume --dir CUSTOMER_DIRECTORY --out INTERRUPTED_COPY

The same commands work with: node developer/python-client/export.mjs ...
Request construction delegates to the original exported JS runtime. The Python
application delegates preparation, review, execution and recovery to the original
stellar_forge_buyer. See the generated PYTHON.md for the complete customer flow.`;

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
  const temporary = join(directory, '.python-client-' + randomUUID()); let file;
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
      value.files.length !== PYTHON_CLIENT_FILES.length || value.files.some((file, i) =>
        file?.name !== PYTHON_CLIENT_FILES[i] || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > LIMIT ||
        typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)))
    throw error('MANIFEST_INVALID', 'Python completion does not match the original complete seller export');
}

function declarations(snapshot) {
  return `# MIT. Generated from original seller OpenAPI ${snapshot.sourceSha256}.
from pathlib import Path
from typing import Any, Literal, Mapping, TypedDict
from stellar_forge_buyer.client import Buyer, Operation

OperationId = Literal[${snapshot.operations.map(operation => JSON.stringify(operation.id)).join(', ')}]

class MultipartBody(TypedDict):
    body: bytes
    contentType: str

class RequestInputs(TypedDict, total=False):
    path: dict[str, str]
    query: dict[str, str | list[str]]
    body: Any
    multipart: MultipartBody
    omitBody: bool

class SellerClientError(ValueError): ...

class BoundRequest:
    body: bytes | None
    @property
    def source_sha256(self) -> str: ...
    @property
    def operation_id(self) -> OperationId: ...
    @property
    def intent_id(self) -> str: ...
    def describe(self) -> dict[str, Any]: ...
    def configuration(self) -> dict[str, Any]: ...
    def save(self, directory: str | Path) -> Path: ...

class SellerClient:
    def __init__(self, directory: str | Path | None = ..., *, node: str = ..., timeout: float = ...,
                 environment: Mapping[str, str] | None = ...) -> None: ...
    @property
    def source(self) -> dict[str, Any]: ...
    @property
    def operations(self) -> list[dict[str, Any]]: ...
    def build_request(self, operation_id: OperationId, inputs: RequestInputs, *, intent_id: str,
                      max_atomic: str, accept_index: int | None = ...,
                      payment_flow: Literal["authorization", "upfront"] | None = ...) -> BoundRequest: ...
    def load_request(self, directory: str | Path) -> BoundRequest: ...
    def prepare(self, buyer: Buyer, bound: BoundRequest) -> Operation: ...
    def resume_preparation(self, buyer: Buyer, bound: BoundRequest) -> Operation: ...
    def reopen(self, buyer: Buyer, intent_id: str) -> Operation: ...
`;
}
async function payloads(original) {
  const snapshot = original.snapshot;
  return new Map([
    ['seller_client.py', await readFile(new URL('./seller_client.py', import.meta.url))],
    ['seller_client.pyi', Buffer.from(declarations(snapshot))],
    ['seller-client-bridge.mjs', await readFile(new URL('./request-bridge.mjs', import.meta.url))],
    ['seller-contract.json', json(snapshot)],
    ['PYTHON.md', await readFile(new URL('./PYTHON.md', import.meta.url))],
  ]);
}

/** Inspect complete original JS and Python source bytes, without executing them. */
export async function inspectPythonSellerClient({ directory } = {}) {
  const original = await inspectSellerClientExport({ directory });
  if (original.state !== 'COMPLETE') return { state: 'ORIGINAL_EXPORT_INCOMPLETE', original };
  directory = original.directory;
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytesAt(directory, PYTHON_CLIENT_MANIFEST, 131072))); }
  catch (cause) {
    if (cause.code === 'ENOENT') return { state: 'PYTHON_EXPORT_INCOMPLETE', directory, sourceSha256: original.sourceSha256,
      originalManifestSha256: original.manifestFile.sha256 };
    throw cause;
  }
  checkManifest(manifest, original);
  for (const entry of manifest.files) {
    const bytes = await bytesAt(directory, entry.name);
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw error('FILE_CHANGED', 'Python customer file differs from completion: ' + entry.name);
  }
  return { state: 'COMPLETE', directory, sourceSha256: original.sourceSha256,
    origin: original.origin, mode: original.mode, operations: original.operations,
    manifest, manifestSha256: sha(await bytesAt(directory, PYTHON_CLIENT_MANIFEST, 131072)),
    files: [...original.files, original.manifestFile, ...manifest.files] };
}

/** Complete interrupted additive output, keeping all five original JS files intact. */
export async function completePythonSellerClient({ directory } = {}) {
  directory = await directoryAt(directory);
  const original = await inspectSellerClientExport({ directory, includeOffers: true });
  if (original.state !== 'COMPLETE') throw error('ORIGINAL_COMPLETION_REQUIRED', 'Complete or explicitly adopt the original JS export first');
  const current = await inspectPythonSellerClient({ directory });
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
  await publishOnce(directory, PYTHON_CLIENT_MANIFEST, json(manifest));
  return inspectPythonSellerClient({ directory });
}

export async function exportPythonSellerClient({ openapi, out, provenance } = {}) {
  await exportSellerClient({ openapi, out, provenance });
  return completePythonSellerClient({ directory: out });
}

/** Transfer the exact retained package, rather than regenerating against newer code. */
export async function copyPythonSellerClient({ directory, out, resume = false } = {}) {
  const source = await inspectPythonSellerClient({ directory });
  if (source.state !== 'COMPLETE') throw error('COMPLETION_REQUIRED', 'Copy a complete original customer package');
  if (typeof out !== 'string' || !out || out.includes('\0')) throw error('DIRECTORY_REQUIRED', 'Supply a new destination directory');
  const receipt = await bytesAt(source.directory, PYTHON_CLIENT_MANIFEST, 131072);
  if (sha(receipt) !== source.manifestSha256) throw error('SOURCE_CHANGED', 'Customer source changed before transfer');
  out = resolve(out); await directoryAt(dirname(out));
  try { await mkdir(out, { mode: 0o700 }); await syncDirectory(dirname(out)); }
  catch (cause) {
    if (!resume || cause.code !== 'EEXIST') throw cause;
    await directoryAt(out);
    try {
      const retained = await bytesAt(out, PYTHON_CLIENT_MANIFEST, 131072);
      if (!retained.equals(receipt)) throw error('FILE_CONFLICT', 'Destination is a different completed Python customer package');
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
  const completed = await inspectPythonSellerClient({ directory: source.directory });
  if (completed.state !== 'COMPLETE' || completed.manifestSha256 !== source.manifestSha256)
    throw error('SOURCE_CHANGED', 'Customer source changed during transfer');
  await publishOnce(out, PYTHON_CLIENT_MANIFEST, receipt);
  return inspectPythonSellerClient({ directory: out });
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
  const result = await ({ export: exportPythonSellerClient, resume: completePythonSellerClient,
    status: inspectPythonSellerClient, copy: copyPythonSellerClient, 'copy-resume': copyPythonSellerClient }[command])(selected);
  process.stdout.write(JSON.stringify(result) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(cause => { process.stderr.write(`${cause.code ?? 'PYTHON_CLIENT_ERROR'}: ${cause.message}\n`); process.exitCode = 1; });
