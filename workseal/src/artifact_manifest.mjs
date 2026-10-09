/** Local artifact evidence. Use an immutable, verifier-controlled directory. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { WorkSealError, assertSha256, sha256Hex } from './canonical.mjs';
import { normalizeResult, normalizeTask } from './protocol.mjs';

export const ARTIFACT_SCHEMA = 'workseal-artifact-manifest/v1';
export const ARTIFACT_REQUIREMENT = 'artifact-manifest';
export const ARTIFACT_LIMITS = Object.freeze({
  maxFiles: 256, maxFileBytes: 256 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024,
});

function fail(code, message) { throw new WorkSealError(code, message); }
function exact(value, keys, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    fail('ARTIFACT_SCHEMA', `${name} must have exactly the documented fields`);
  }
}
function limitsFor(options = {}) {
  const limits = { ...ARTIFACT_LIMITS };
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < 0 ||
        value > limits[key] || (key === 'maxFiles' && value < 1)) {
      fail('ARTIFACT_LIMIT', 'limits must be safe integers within the published ceilings');
    }
    limits[key] = value;
  }
  return limits;
}
function cancelled(signal) {
  if (signal?.aborted) fail('ARTIFACT_CANCELLED', 'artifact verification cancelled');
}
function portablePath(value) {
  if (typeof value !== 'string' || value.length > 512 || value.length === 0) {
    fail('ARTIFACT_PATH', 'artifact paths must be nonempty relative paths of at most 512 characters');
  }
  const segments = value.split('/');
  if (segments.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part) ||
      part.endsWith('.') || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
    fail('ARTIFACT_PATH', 'use portable ASCII path segments without traversal, aliases or reserved names');
  }
  return value;
}
function sortedPaths(paths, limits) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > limits.maxFiles) {
    fail('ARTIFACT_COUNT', 'artifact selection is empty or exceeds the file limit');
  }
  const seen = new Set();
  return Array.from(paths, value => {
    const path = portablePath(value);
    const folded = path.toLowerCase();
    if (seen.has(folded)) fail('ARTIFACT_DUPLICATE', 'duplicate or case-aliased artifact path');
    seen.add(folded);
    return path;
  }).sort();
}

export function normalizeArtifactManifest(manifest, limitOverrides = {}) {
  const limits = limitsFor(limitOverrides);
  exact(manifest, ['schema', 'files'], 'manifest');
  if (manifest.schema !== ARTIFACT_SCHEMA) fail('ARTIFACT_SCHEMA', 'unsupported artifact manifest schema');
  if (!Array.isArray(manifest.files)) fail('ARTIFACT_SCHEMA', 'manifest.files must be an array');
  if (manifest.files.length < 1 || manifest.files.length > limits.maxFiles) fail('ARTIFACT_COUNT', 'artifact selection is empty or exceeds the file limit');
  const byPath = new Map();
  let total = 0;
  // Array.from rejects sparse entries through exact(), instead of skipping them.
  const paths = Array.from(manifest.files, file => {
    exact(file, ['path', 'bytes', 'sha256'], 'manifest file');
    const path = portablePath(file.path);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > limits.maxFileBytes) {
      fail('ARTIFACT_LIMIT', 'invalid or excessive artifact byte count');
    }
    total += file.bytes;
    if (total > limits.maxTotalBytes) fail('ARTIFACT_LIMIT', 'artifact total exceeds byte limit');
    byPath.set(path, { path, bytes: file.bytes, sha256: assertSha256(file.sha256, 'artifact sha256') });
    return path;
  });
  return { schema: ARTIFACT_SCHEMA, files: sortedPaths(paths, limits).map(path => byPath.get(path)) };
}

export function artifactManifestDigest(manifest) {
  return sha256Hex(normalizeArtifactManifest(manifest));
}

/** Include this exact requirement in the buyer's task BEFORE funding. */
export function artifactPolicyRequirement(manifest) {
  return { id: ARTIFACT_REQUIREMENT, description: `${ARTIFACT_SCHEMA}:sha256:${artifactManifestDigest(manifest)}` };
}

/** A deterministic declaration, NOT proof that any file was read. */
export function artifactEvidence(manifest, task, generation) {
  const normalized = normalizeArtifactManifest(manifest);
  const authorizedTask = normalizeTask(task);
  if (!Number.isSafeInteger(generation) || generation < 1) fail('BAD_GENERATION', 'generation must be positive');
  const policy = authorizedTask.acceptancePolicy.requirements.find(entry => entry.id === ARTIFACT_REQUIREMENT);
  if (policy?.description !== artifactPolicyRequirement(normalized).description) {
    fail('ARTIFACT_POLICY', 'task does not pin this exact expected artifact manifest');
  }
  const packet = {
    schema: 'workseal-artifact-evidence/v1',
    taskDigest: sha256Hex(authorizedTask), workerId: authorizedTask.worker.id, generation,
    artifactDigest: artifactManifestDigest(normalized),
    fileCount: normalized.files.length,
    totalBytes: normalized.files.reduce((sum, file) => sum + file.bytes, 0),
  };
  return { packet, evidence: { id: ARTIFACT_REQUIREMENT, digest: sha256Hex(packet) } };
}

function sameFile(a, b) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
}
async function selectedFile(root, path) {
  let current = root;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i]);
    const info = await lstat(current, { bigint: true });
    if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) {
      fail('ARTIFACT_PATH', 'selected paths cannot traverse links or non-directories');
    }
    if (i === parts.length - 1 && !info.isFile()) fail('ARTIFACT_TYPE', 'artifacts must be regular files');
  }
  return current;
}

async function hashFile(root, path, allowance, signal) {
  cancelled(signal);
  const full = await selectedFile(root, path);
  // Nonblocking open prevents a raced-in FIFO from hanging before fstat.
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) fail('ARTIFACT_TYPE', 'artifacts must be single-link regular files');
    if (before.size > BigInt(allowance)) fail('ARTIFACT_LIMIT', 'artifact exceeds remaining byte allowance');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    while (true) {
      cancelled(signal);
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, allowance - bytes + 1), null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > allowance) fail('ARTIFACT_LIMIT', 'artifact grew beyond its byte allowance');
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    const currentPath = await selectedFile(root, path);
    const current = await lstat(currentPath, { bigint: true });
    cancelled(signal);
    if (!sameFile(before, after) || !sameFile(after, current) || BigInt(bytes) !== after.size) {
      fail('ARTIFACT_CHANGED', 'artifact changed while being read');
    }
    return { path, bytes, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

/** Read only explicitly selected files; never recurse, execute, or upload. */
export async function buildArtifactManifest(root, paths, { limits = {}, signal } = {}) {
  const budget = limitsFor(limits);
  const selection = sortedPaths(paths, budget);
  cancelled(signal);
  if (process.platform !== 'linux' || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) {
    fail('ARTIFACT_PLATFORM', 'local acquisition requires Linux no-follow file opens');
  }
  if (typeof root !== 'string' || root.length === 0) fail('ARTIFACT_PATH', 'an explicit artifact root is required');
  const rootPath = resolve(root);
  const rootInfo = await lstat(rootPath, { bigint: true });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('ARTIFACT_PATH', 'artifact root must be a directory, not a link');
  const realRoot = await realpath(rootPath);
  const files = [];
  let total = 0;
  for (const path of selection) {
    const file = await hashFile(realRoot, path, Math.min(budget.maxFileBytes, budget.maxTotalBytes - total), signal);
    files.push(file);
    total += file.bytes;
  }
  const finalRoot = await lstat(rootPath, { bigint: true });
  if (rootInfo.dev !== finalRoot.dev || rootInfo.ino !== finalRoot.ino || finalRoot.isSymbolicLink()) {
    fail('ARTIFACT_CHANGED', 'artifact root was replaced');
  }
  cancelled(signal);
  return normalizeArtifactManifest({ schema: ARTIFACT_SCHEMA, files }, limits);
}

/** Re-read bytes and bind the successful check to an already committed result. */
export async function verifyArtifactDelivery({ root, manifest, task, result, limits = {}, signal }) {
  const expected = normalizeArtifactManifest(manifest, limits);
  const normalizedTask = normalizeTask(task);
  const normalizedResult = normalizeResult(result, normalizedTask);
  const { packet, evidence } = artifactEvidence(expected, normalizedTask, normalizedResult.generation);
  if (normalizedResult.artifactDigest !== packet.artifactDigest) fail('ARTIFACT_DIGEST_MISMATCH', 'result references a different artifact manifest');
  if (normalizedResult.evidence.find(entry => entry.id === evidence.id)?.digest !== evidence.digest) {
    fail('ARTIFACT_EVIDENCE_MISMATCH', 'result does not retain the exact task/worker/generation evidence declaration');
  }
  const observed = await buildArtifactManifest(root, expected.files.map(file => file.path), { limits, signal });
  if (artifactManifestDigest(observed) !== packet.artifactDigest) fail('ARTIFACT_CONTENT_MISMATCH', 'selected bytes do not match the expected manifest');
  return {
    schema: 'workseal-artifact-verification/v1', ok: true,
    taskDigest: packet.taskDigest, resultDigest: sha256Hex(normalizedResult),
    artifactDigest: packet.artifactDigest, fileCount: packet.fileCount, totalBytes: packet.totalBytes,
    evidence, check: { id: ARTIFACT_REQUIREMENT, ok: true, evidenceDigest: evidence.digest },
    writePerformed: false, externalAuthorityGranted: false,
  };
}
