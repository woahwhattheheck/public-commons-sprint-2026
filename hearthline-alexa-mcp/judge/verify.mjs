import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_COUNT = 47;
const REQUIRED_FALSE_CLAIMS = [
  'alexaSubmitted',
  'awsDeployed',
  'devpostSubmitted',
  'prizeOrRevenueClaimed',
];

export class JudgePacketError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'JudgePacketError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new JudgePacketError(code, message); };

export function gitBlobSha(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1')
    .update(Buffer.from(`blob ${body.length}\0`, 'utf8'))
    .update(body)
    .digest('hex');
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    fail('UNSAFE_PATH', label);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '.' || normalized === '..' || normalized.startsWith('../') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail('UNSAFE_PATH', label);
  }
  return value;
}

async function readJson(rootDir, relative, readFileImpl) {
  const file = path.join(rootDir, ...safeRelative(relative, relative).split('/'));
  let text;
  try { text = await readFileImpl(file, 'utf8'); }
  catch (error) { fail('MISSING_ARTIFACT', `${relative}: ${error?.code ?? error?.message ?? error}`); }
  try { return JSON.parse(text); }
  catch { fail('INVALID_JSON', relative); }
}

function assertHex(value, length, label) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) fail('INVALID_DIGEST', label);
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export async function verifyJudgePacket({ rootDir = PROJECT_ROOT, readFileImpl = readFile, statImpl = stat } = {}) {
  const provenance = await readJson(rootDir, 'PUBLIC_CARRIER_PROVENANCE.json', readFileImpl);
  const matrix = await readJson(rootDir, 'judge/source-blobs.json', readFileImpl);
  const manifest = await readJson(rootDir, 'release/public-release.manifest.json', readFileImpl);
  const submission = await readJson(rootDir, 'judge/submission-fields.json', readFileImpl);

  if (provenance.schema !== 'hearthline-public-carrier-provenance/v1') fail('PROVENANCE_SCHEMA', String(provenance.schema));
  if (matrix.schema !== 'hearthline-public-source-blobs/v1') fail('MATRIX_SCHEMA', String(matrix.schema));
  if (provenance.authority !== 'MANIFEST_ALLOWLIST_ONLY') fail('PROVENANCE_AUTHORITY', String(provenance.authority));
  if (provenance.byteIdentity !== 'TARGET_GIT_BLOB_SHA_EQUALS_SOURCE_FOR_ALL_MANIFEST_FILES') fail('PROVENANCE_IDENTITY', String(provenance.byteIdentity));
  if (matrix.authority !== 'PUBLIC_CARRIER_PROVENANCE_PLUS_MANIFEST_ALLOWLIST') fail('MATRIX_AUTHORITY', String(matrix.authority));

  assertHex(provenance.sourceCommit, 40, 'provenance.sourceCommit');
  assertHex(provenance.sourceSubtree, 40, 'provenance.sourceSubtree');
  assertHex(provenance.manifestBlob, 40, 'provenance.manifestBlob');
  for (const [field, value] of [['sourceCommit', matrix.sourceCommit], ['sourceSubtree', matrix.sourceSubtree], ['manifestBlob', matrix.manifestBlob]]) {
    if (value !== provenance[field]) fail('PROVENANCE_MATRIX_MISMATCH', field);
  }

  if (provenance.publishedSourceFiles !== SOURCE_COUNT || !Array.isArray(matrix.files) || matrix.files.length !== SOURCE_COUNT) {
    fail('SOURCE_COUNT', `expected ${SOURCE_COUNT}`);
  }
  if (provenance.sourceModes?.['100644'] !== 46 || provenance.sourceModes?.['100755'] !== 1) fail('SOURCE_MODE_SUMMARY', 'expected 46 regular + 1 executable');

  const seenPaths = new Set();
  let totalBytes = 0;
  let executableFiles = 0;
  for (const entry of matrix.files) {
    const relative = safeRelative(entry?.path, 'matrix.files[].path');
    if (seenPaths.has(relative)) fail('DUPLICATE_SOURCE_PATH', relative);
    seenPaths.add(relative);
    if (!['100644', '100755'].includes(entry.mode)) fail('INVALID_SOURCE_MODE', relative);
    assertHex(entry.blob, 40, `${relative}.blob`);

    const absolute = path.join(rootDir, ...relative.split('/'));
    let bytes;
    let info;
    try {
      bytes = await readFileImpl(absolute);
      info = await statImpl(absolute);
    } catch (error) {
      fail('MISSING_SOURCE', `${relative}: ${error?.code ?? error?.message ?? error}`);
    }
    if (!info.isFile()) fail('SOURCE_NOT_FILE', relative);
    const actualMode = (info.mode & 0o111) !== 0 ? '100755' : '100644';
    if (actualMode !== entry.mode) fail('SOURCE_MODE_MISMATCH', `${relative}: ${actualMode} != ${entry.mode}`);
    if (actualMode === '100755') executableFiles += 1;
    const actualBlob = gitBlobSha(bytes);
    if (actualBlob !== entry.blob) fail('SOURCE_BLOB_MISMATCH', `${relative}: ${actualBlob} != ${entry.blob}`);
    totalBytes += bytes.length;
  }

  if (executableFiles !== 1) fail('EXECUTABLE_COUNT', String(executableFiles));

  if (!Array.isArray(manifest.files) || manifest.files.length !== SOURCE_COUNT) fail('MANIFEST_COUNT', `expected ${SOURCE_COUNT}`);
  const manifestSources = manifest.files.map((entry, index) => safeRelative(entry?.source, `manifest.files[${index}].source`));
  if (!sameSet(manifestSources, [...seenPaths])) fail('MANIFEST_MATRIX_MISMATCH', 'manifest allowlist differs from source-blob matrix');
  const manifestEntry = matrix.files.find((entry) => entry.path === 'release/public-release.manifest.json');
  if (!manifestEntry || manifestEntry.blob !== provenance.manifestBlob) fail('MANIFEST_BLOB_BINDING', 'manifest matrix entry does not bind provenance');

  if (!provenance.externalClaims || typeof provenance.externalClaims !== 'object') fail('EXTERNAL_CLAIMS', 'missing public-carrier truth boundary');
  for (const claim of REQUIRED_FALSE_CLAIMS) {
    if (provenance.externalClaims[claim] !== false) fail('EXTERNAL_CLAIM_TRUE', `provenance.${claim}`);
  }
  if (submission.schema !== 'hearthline-judge-submission-fields/v1') fail('SUBMISSION_SCHEMA', String(submission.schema));
  if (!submission.truthBoundary || typeof submission.truthBoundary !== 'object') fail('SUBMISSION_TRUTH_BOUNDARY', 'missing');
  for (const [claim, value] of Object.entries(submission.truthBoundary)) {
    if (value !== false) fail('SUBMISSION_CLAIM_TRUE', claim);
  }
  if (!Array.isArray(submission.ownerActionsRequired) || submission.ownerActionsRequired.length < 3) fail('OWNER_ACTIONS', 'submission handoff must expose unresolved owner actions');

  for (const required of ['JUDGE_PACKET.md', 'judge/packet.mjs', 'judge/source-blobs.json', 'judge/submission-fields.json', 'judge/verify.mjs']) {
    const absolute = path.join(rootDir, ...required.split('/'));
    try {
      const info = await statImpl(absolute);
      if (!info.isFile()) fail('JUDGE_ARTIFACT_NOT_FILE', required);
    } catch (error) {
      if (error instanceof JudgePacketError) throw error;
      fail('MISSING_JUDGE_ARTIFACT', `${required}: ${error?.code ?? error?.message ?? error}`);
    }
  }

  return {
    schema: 'hearthline-judge-verification/v1',
    ok: true,
    sourceFiles: SOURCE_COUNT,
    sourceBytes: totalBytes,
    executableFiles,
    sourceCommit: provenance.sourceCommit,
    sourceSubtree: provenance.sourceSubtree,
    manifestBlob: provenance.manifestBlob,
    truthBoundary: 'NO_EXTERNAL_SUBMISSION_DEPLOYMENT_PRIZE_OR_PAYMENT_CLAIMS',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifyJudgePacket();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code ?? 'VERIFY_FAILED', error: error?.message ?? String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
