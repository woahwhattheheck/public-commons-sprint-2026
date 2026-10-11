// MIT. Durable native report/terms authoring; the browser consumes this same store.
import { constants } from 'node:fs';
import { open, mkdir, readdir, rename, rm, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readMongoSourceFile, validateMongoSource, openMongoSourceFile } from './config.mjs';
import { inspectMongoSourceFile } from './catalog.mjs';
import { compileMongoMerchantPlan, prepareMongoSeller } from './prepare.mjs';
import { encode, digest, limited, readJson, writeNew, syncDirectory, privateDirectory, fail, integer } from './common.mjs';

const SCHEMA = 'stellar-forge.mongodb-workspace.v1';
const revisionName = value => String(integer(value, 1, 100000000, 'MONGODB_REVISION_INVALID')).padStart(9, '0');
async function head(root) {
  const value = await readJson(resolve(root, 'workspace.json'));
  if (value?.schema !== SCHEMA || !Number.isSafeInteger(value.revision)) fail('MONGODB_WORKSPACE_HEAD_INVALID');
  return value;
}
async function readRevision(root, revision) {
  const directory = resolve(root, 'revisions', revisionName(revision)); await privateDirectory(directory);
  const metadata = await readJson(resolve(directory, 'revision.json'));
  if (metadata?.schema !== SCHEMA || metadata.revision !== revision) fail('MONGODB_WORKSPACE_REVISION_INVALID');
  const sourceFile = resolve(directory, 'source.json'), planFile = resolve(directory, 'merchant-plan.json');
  const sourceBytes = await limited(sourceFile), planBytes = await limited(planFile);
  if (digest(sourceBytes) !== metadata.sourceSha256 || digest(planBytes) !== metadata.planSha256)
    fail('MONGODB_RETAINED_PLAN_CHANGED', 409);
  if (metadata.caSha256 && digest(await limited(resolve(directory, 'database-ca.pem'), 1048576)) !== metadata.caSha256)
    fail('MONGODB_RETAINED_CA_CHANGED', 409);
  const source = validateMongoSource(JSON.parse(sourceBytes)), plan = JSON.parse(planBytes);
  compileMongoMerchantPlan(source.queries, plan);
  return { ...metadata, directory: root, sourceFile, planFile, source, plan };
}
export async function openMongoWorkspace(directory, { revision } = {}) {
  const root = await privateDirectory(directory), current = await head(root);
  const result = await readRevision(root, revision ?? current.revision);
  return { ...result, currentRevision: current.revision, createdAt: current.createdAt };
}
async function locked(root, operation) {
  const lock = await open(resolve(root, 'authoring.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await lock.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || stat.nlink !== 1) fail('MONGODB_WORKSPACE_LOCK_INVALID');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'ignore', 'ignore', lock.fd] });
    if (result.status === 73) fail('MONGODB_AUTHORING_IN_PROGRESS', 409);
    if (result.error || result.status !== 0) fail('MONGODB_WORKSPACE_LOCK_UNAVAILABLE', 503);
    const named = await lstat(resolve(root, 'authoring.lock'));
    if (named.dev !== stat.dev || named.ino !== stat.ino) fail('MONGODB_WORKSPACE_LOCK_CHANGED', 409);
    return await operation();
  } finally { await lock.close(); }
}
async function writeRevision(root, source, plan, { ca, parentRevision = null, createdAt, inputHashes } = {}) {
  validateMongoSource(source); compileMongoMerchantPlan(source.queries, plan);
  const existing = await readdir(resolve(root, 'revisions'));
  const revision = Math.max(0, ...existing.filter(name => /^\d{9}$/.test(name)).map(Number)) + 1;
  const directory = resolve(root, 'revisions', revisionName(revision)); await mkdir(directory, { mode: 0o700 });
  const savedSource = structuredClone(source);
  if (ca) savedSource.connection.caFile = 'database-ca.pem';
  const sourceBytes = encode(savedSource), planBytes = encode(plan);
  const updatedAt = new Date().toISOString();
  const metadata = { schema: SCHEMA, revision, parentRevision, createdAt: createdAt ?? updatedAt, updatedAt,
    sourceSha256: digest(sourceBytes), planSha256: digest(planBytes), ...(ca ? { caSha256: digest(ca) } : {}),
    ...(inputHashes ? { imported: inputHashes } : {}) };
  metadata.profileId = digest(encode({ source: metadata.sourceSha256, plan: metadata.planSha256, ca: metadata.caSha256 ?? null }));
  try {
    await writeNew(resolve(directory, 'source.json'), sourceBytes); await writeNew(resolve(directory, 'merchant-plan.json'), planBytes);
    if (ca) await writeNew(resolve(directory, 'database-ca.pem'), ca);
    await writeNew(resolve(directory, 'revision.json'), encode(metadata)); await syncDirectory(directory);
    const temporary = resolve(root, 'head-' + randomUUID() + '.json');
    await writeNew(temporary, encode({ schema: SCHEMA, revision, createdAt: metadata.createdAt, updatedAt }));
    await rename(temporary, resolve(root, 'workspace.json')); await syncDirectory(root);
    return openMongoWorkspace(root);
  } catch (issue) {
    // An already committed head remains intact; never remove a published revision.
    const current = await head(root).catch(() => null);
    if (current?.revision !== revision) await rm(directory, { recursive: true, force: true });
    throw issue;
  }
}
export async function createMongoWorkspace({ directory, sourceFile, planFile } = {}) {
  if (![directory, sourceFile, planFile].every(value => typeof value === 'string' && value.length)) fail('MONGODB_WORKSPACE_INPUTS_REQUIRED');
  const declaration = await readMongoSourceFile(sourceFile), planBytes = await limited(planFile), plan = JSON.parse(planBytes);
  compileMongoMerchantPlan(declaration.config.queries, plan);
  const sourceBytes = await limited(sourceFile);
  if (digest(encode(JSON.parse(sourceBytes))) !== digest(encode(declaration.config))) fail('MONGODB_SOURCE_CHANGED_DURING_IMPORT', 409);
  const ca = declaration.config.connection.caFile ? await limited(resolve(dirname(declaration.path), declaration.config.connection.caFile), 1048576) : null;
  const root = await privateDirectory(directory, true);
  try {
    await mkdir(resolve(root, 'revisions'), { mode: 0o700 });
    return await locked(root, () => writeRevision(root, declaration.config, plan, { ca,
      inputHashes: { sourceSha256: digest(sourceBytes), planSha256: digest(planBytes) } }));
  } catch (issue) { await rm(root, { recursive: true, force: true }); throw issue; }
}
export async function saveMongoWorkspacePlan({ directory, source, plan, expectedRevision } = {}) {
  const root = await privateDirectory(directory); revisionName(expectedRevision);
  return locked(root, async () => {
    const current = await openMongoWorkspace(root);
    if (current.revision !== expectedRevision) fail('MONGODB_WORKSPACE_REVISION_CHANGED', 409);
    const next = source ?? current.source;
    if (next.connection?.caFile !== current.source.connection.caFile) fail('MONGODB_CA_REQUIRES_NEW_IMPORTED_PROFILE');
    const ca = current.caSha256 ? await limited(resolve(dirname(current.sourceFile), 'database-ca.pem'), 1048576) : null;
    return writeRevision(root, next, plan, { ca, parentRevision: current.revision, createdAt: current.createdAt });
  });
}
export async function listMongoWorkspaceRevisions(directory, { before, limit = 20 } = {}) {
  integer(limit, 1, 100, 'MONGODB_HISTORY_LIMIT_INVALID');
  if (before !== undefined) revisionName(before);
  const root = await privateDirectory(directory), current = await head(root), revisions = [];
  let revision = current.revision;
  while (revision !== null && revisions.length < limit) {
    const metadata = await readJson(resolve(root, 'revisions', revisionName(revision), 'revision.json'));
    if (metadata.schema !== SCHEMA || metadata.revision !== revision || metadata.parentRevision !== null &&
        (!Number.isSafeInteger(metadata.parentRevision) || metadata.parentRevision >= revision)) fail('MONGODB_HISTORY_INVALID');
    if (before === undefined || revision < before) revisions.push(metadata);
    revision = metadata.parentRevision;
  }
  return { schema: 'stellar-forge.mongodb-revisions.v1', currentRevision: current.revision, revisions,
    nextBefore: revision !== null && revisions.length ? revisions.at(-1).revision : null };
}
export async function inspectMongoWorkspace(directory, options = {}) {
  const snapshot = await openMongoWorkspace(directory);
  return { ...await inspectMongoSourceFile(snapshot.sourceFile, options), revision: snapshot.revision, profileId: snapshot.profileId };
}
export async function previewMongoWorkspace({ directory, query, input, expectedRevision, environment = process.env } = {}) {
  const snapshot = await openMongoWorkspace(directory);
  if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) fail('MONGODB_WORKSPACE_REVISION_CHANGED', 409);
  const { source } = await openMongoSourceFile(snapshot.sourceFile, { environment });
  try { return { ...await source.query(query, input), workspaceRevision: snapshot.revision, profileId: snapshot.profileId }; }
  finally { await source.close(); }
}
export async function prepareMongoWorkspace({ directory, destination, expectedRevision } = {}) {
  const root = await privateDirectory(directory); revisionName(expectedRevision);
  return locked(root, async () => {
    const snapshot = await openMongoWorkspace(root);
    if (snapshot.revision !== expectedRevision) fail('MONGODB_WORKSPACE_REVISION_CHANGED', 409);
    return { ...await prepareMongoSeller({ sourceFile: snapshot.sourceFile, planFile: snapshot.planFile, directory: destination }),
      workspaceRevision: snapshot.revision, profileId: snapshot.profileId };
  });
}
