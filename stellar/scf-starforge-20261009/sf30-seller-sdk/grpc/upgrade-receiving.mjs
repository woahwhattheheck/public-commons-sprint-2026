// MIT. Complete source-bound receiving for the original immutable upgrade review.
import { constants } from 'node:fs';
import { open, lstat, mkdir, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, sha256, fail, record, syncDirectory } from './common.mjs';
import { validateGrpcConfig } from './config.mjs';

export const GRPC_UPGRADE_MAX_BYTES = 96 * 1024 * 1024;
export const GRPC_UPGRADE_FILES = Object.freeze([
  { path: 'grpc-upgrade-review.json', maximum: 9 * 1024 * 1024 },
  { path: 'grpc-upgrade-base.json', maximum: 40 * 1024 * 1024 },
  { path: 'grpc-upgrade-candidate.json', maximum: 40 * 1024 * 1024 },
  { path: 'grpc-upgrade-plan.json', maximum: 262145 },
]);
const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = value => sha256(canonical(value));
const same = (a, b) => canonical(a) === canonical(b);
const selection = (a, b) => a?.revision === b?.revision && a?.generation === b?.generation;
const requireValue = (ok, code = 'GRPC_UPGRADE_RECEIVING_CHANGED') => { if (!ok) fail(code, 409); };

function revisionIdentity(value) {
  requireValue(record(value) && SHA.test(value.id ?? '') && record(value.source) &&
    record(value.protoSource) && record(value.plan) && typeof value.title === 'string');
  requireValue(value.id === digest({ source: value.source, protoSource: value.protoSource,
    plan: value.plan, title: value.title }), 'GRPC_UPGRADE_REVISION_CHANGED');
  return value;
}
function immutableReview(value) {
  requireValue(record(value));
  const { adoption, adoptionIntent, currentSelection, revision, ...report } = value;
  const { reviewSha256, ...document } = report;
  requireValue(report.schema === 'stellar-forge.grpc-workspace-upgrade.v1' &&
    UUID.test(report.id ?? '') && report.request?.id === report.id &&
    SHA.test(reviewSha256 ?? '') && reviewSha256 === digest(document) &&
    report.requestSha256 === digest(report.request), 'GRPC_UPGRADE_REVIEW_CHANGED');
  return report;
}

/** Hash/source receiving is dependency-light. Explicit native compilation uses the original compiler lazily. */
export async function verifyGrpcUpgradeValues(values, { expectedReviewSha256, native = false } = {}) {
  requireValue(record(values));
  const { review, base, candidate, plan } = values, report = immutableReview(review);
  if (expectedReviewSha256 !== undefined)
    requireValue(SHA.test(expectedReviewSha256) && expectedReviewSha256 === report.reviewSha256,
      'GRPC_UPGRADE_REVIEW_CHANGED');
  const before = revisionIdentity(base), request = report.request;
  requireValue(request.baseRevision === before.id && report.before?.revision === before.id &&
    report.baseSelection?.revision === before.id && Number.isSafeInteger(report.baseSelection.generation) &&
    report.baseSelection.generation >= 0 && report.before.protoSha256 === before.protoSource.sha256 &&
    report.before.sourceSha256 === digest(before.source), 'GRPC_UPGRADE_BASE_CHANGED');
  requireValue(record(plan) && same(plan, request.plan) &&
    report.planValidation?.planSha256 === digest(plan), 'GRPC_UPGRADE_PLAN_CHANGED');

  let after, identity;
  if (request.candidate?.kind === 'revision') {
    after = revisionIdentity(candidate);
    requireValue(after.id === request.candidate.id, 'GRPC_UPGRADE_CANDIDATE_CHANGED');
    identity = { kind: 'revision', id: after.id, protoSha256: after.protoSource.sha256,
      sourceSha256: digest(after.source) };
  } else {
    requireValue(request.candidate?.kind === 'reflection' &&
      candidate?.schema === 'stellar-forge.grpc-workspace-reflection.v1' &&
      UUID.test(candidate.id ?? '') && candidate.id === request.candidate.id &&
      candidate.requestSha256 === digest(candidate.request) &&
      candidate.captureSha256 === digest({ request: candidate.request, protoSource: candidate.protoSource }) &&
      candidate.captureSha256 === request.candidate.captureSha256, 'GRPC_UPGRADE_CAPTURE_CHANGED');
    after = { source: validateGrpcConfig(candidate.request.source), protoSource: candidate.protoSource };
    identity = { kind: 'reflection', id: candidate.id, captureSha256: candidate.captureSha256,
      protoSha256: after.protoSource.sha256, sourceSha256: digest(after.source) };
  }
  requireValue(same(identity, report.candidate) && same(report.source?.before, before.source) &&
    same(report.source?.after, after.source) &&
    report.source.changed === !same(before.source, after.source), 'GRPC_UPGRADE_SOURCE_CHANGED');
  const targetRevision = digest({ source: after.source, protoSource: after.protoSource,
    plan, title: request.title });
  const intended = { revision: targetRevision, generation: report.baseSelection.generation + 1 };
  if (review.adoptionIntent) {
    const intent = review.adoptionIntent;
    requireValue(intent.schema === 'stellar-forge.grpc-upgrade-adopt-intent.v1' &&
      intent.id === report.id && intent.reviewSha256 === report.reviewSha256 &&
      selection(intent.before, report.baseSelection) && selection(intent.after, intended),
      'GRPC_UPGRADE_ADOPTION_CHANGED');
  }
  if (review.adoption) {
    const adopted = review.adoption;
    requireValue(adopted.schema === 'stellar-forge.grpc-upgrade-adoption.v1' &&
      adopted.id === report.id && adopted.reviewSha256 === report.reviewSha256 &&
      adopted.baseRevision === before.id && adopted.revision === targetRevision &&
      selection(adopted.selection, intended), 'GRPC_UPGRADE_ADOPTION_CHANGED');
  }
  if (review.revision) requireValue(revisionIdentity(review.revision).id === targetRevision,
    'GRPC_UPGRADE_ADOPTION_CHANGED');

  if (native) {
    const [{ compileProtoSource }, { compileGrpcMerchantPlan }] = await Promise.all([
      import('./proto.mjs'), import('./prepare.mjs'),
    ]);
    const previous = compileProtoSource(before.protoSource), next = compileProtoSource(after.protoSource);
    requireValue(previous.source.sha256 === report.before.protoSha256 &&
      next.source.sha256 === identity.protoSha256, 'GRPC_UPGRADE_SOURCE_CHANGED');
    let compiled, problem;
    try {
      if (!plan.routes?.length) fail('GRPC_SELECT_AT_LEAST_ONE_SINGLE_REQUEST_METHOD');
      compiled = compileGrpcMerchantPlan(next, plan, { limits: after.source.limits });
    } catch (error) { problem = error; }
    requireValue(Boolean(compiled) === report.planValidation.valid, 'GRPC_UPGRADE_COMPILER_RESULT_CHANGED');
    if (compiled) requireValue(report.planValidation.customerMethodsSha256 === digest(compiled.methods) &&
      report.planValidation.serviceSha256 === digest(compiled.service), 'GRPC_UPGRADE_COMPILER_RESULT_CHANGED');
    else requireValue(report.planValidation.error?.code === (problem?.code ?? 'GRPC_UPGRADE_PLAN_INVALID'),
      'GRPC_UPGRADE_COMPILER_RESULT_CHANGED');
  }
  return { schema: 'stellar-forge.grpc-upgrade-received.v1', id: report.id,
    reviewSha256: report.reviewSha256, baseRevision: before.id, candidate: identity,
    planSha256: digest(plan), readyToAdopt: report.planValidation.valid,
    routeCount: plan.routes.length, targetRevision, adoption: review.adoption ?? null,
    nativeCompiled: native };
}

/** Read the exact existing review and source records; never capture, adopt, call or publish. */
export async function collectGrpcUpgrade({ readUpgrade, readRevision, readReflection }, id, expectedReviewSha256) {
  const review = await readUpgrade(id), report = immutableReview(review);
  requireValue(report.id === id, 'GRPC_UPGRADE_REVIEW_CHANGED');
  const [base, candidate] = await Promise.all([
    readRevision(report.request.baseRevision),
    report.request.candidate.kind === 'revision' ? readRevision(report.request.candidate.id)
      : readReflection(report.request.candidate.id),
  ]);
  const values = { review, base, candidate, plan: structuredClone(report.request.plan) };
  const result = await verifyGrpcUpgradeValues(values, { expectedReviewSha256 });
  let total = 0;
  const sources = GRPC_UPGRADE_FILES.map((file, index) => {
    const bytes = Buffer.from(JSON.stringify(values[['review', 'base', 'candidate', 'plan'][index]]) + '\n');
    total += bytes.length;
    if (bytes.length > file.maximum || total > GRPC_UPGRADE_MAX_BYTES) fail('GRPC_UPGRADE_EXPORT_TOO_LARGE', 413);
    return { ...file, bytes, contentType: 'application/json' };
  });
  return { values, result, sources, original: { revision: base.id, operationId: id,
    reviewSha256: report.reviewSha256, topic: 'contract-upgrade' } };
}

async function privateDirectory(path, create = false) {
  path = resolve(path);
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && info.mode & 0o077)
    fail('GRPC_UPGRADE_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
export async function readGrpcUpgradeBytes(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum || process.platform !== 'win32' && before.mode & 0o077)
      fail('GRPC_UPGRADE_PRIVATE_FILE_REQUIRED');
    const chunks = []; let count = 0;
    while (count <= maximum) {
      const buffer = Buffer.alloc(Math.min(65536, maximum + 1 - count));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead)); count += bytesRead;
    }
    const after = await handle.stat();
    requireValue(count <= maximum && count === before.size && count === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'GRPC_UPGRADE_FILE_CHANGED');
    const bytes = Buffer.concat(chunks, count);
    return bytes;
  } finally { await handle.close(); }
}
export async function readGrpcUpgradeJson(path, maximum) {
  const bytes = await readGrpcUpgradeBytes(path, maximum);
  return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
}
async function publishFile(path, bytes) {
  const temporary = join(dirname(path), '.upgrade-' + randomUUID() + '.tmp');
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, path).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readGrpcUpgradeJson(path, bytes.length);
      requireValue(existing.bytes.length === bytes.length && sha256(existing.bytes) === sha256(bytes),
        'GRPC_UPGRADE_RECEIVING_FILE_EXISTS');
    });
    await syncDirectory(dirname(path));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** New complete files become visible atomically; retries preserve equal already-received files. */
export async function writeGrpcUpgradeDirectory(directory, payload) {
  directory = await privateDirectory(directory, true);
  const result = await verifyGrpcUpgradeValues(payload.values, { expectedReviewSha256: payload.result.reviewSha256 });
  for (let index = 0; index < GRPC_UPGRADE_FILES.length; index++) {
    const file = GRPC_UPGRADE_FILES[index], source = payload.sources[index];
    requireValue(source?.path === file.path && Buffer.isBuffer(source.bytes) &&
      source.bytes.length <= file.maximum &&
      same(JSON.parse(source.bytes.toString('utf8')), payload.values[['review', 'base', 'candidate', 'plan'][index]]));
    await publishFile(join(directory, file.path), source.bytes);
  }
  return { ...result, directory, files: payload.sources.map(file => ({
    path: file.path, bytes: file.bytes.length, sha256: sha256(file.bytes) })) };
}

export async function readGrpcUpgradeDirectory(directory, { expectedReviewSha256, native = false } = {}) {
  directory = await privateDirectory(directory);
  const values = {}, files = [];
  let total = 0;
  for (let index = 0; index < GRPC_UPGRADE_FILES.length; index++) {
    const file = GRPC_UPGRADE_FILES[index], read = await readGrpcUpgradeJson(join(directory, file.path), file.maximum);
    total += read.bytes.length;
    if (total > GRPC_UPGRADE_MAX_BYTES) fail('GRPC_UPGRADE_EXPORT_TOO_LARGE', 413);
    values[['review', 'base', 'candidate', 'plan'][index]] = read.value;
    files.push({ path: file.path, bytes: read.bytes.length, sha256: sha256(read.bytes) });
  }
  return { summary: await verifyGrpcUpgradeValues(values, { expectedReviewSha256, native }), directory, files, values };
}
