// MIT. Private review/release state; original SQL Server source and seller own execution.
import { constants } from 'node:fs';
import { open, mkdir, mkdtemp, readdir, lstat, realpath, rename, rm } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readMssqlSourceFile, openMssqlSourceFile } from '../config.mjs';
import { inspectMssqlCatalog } from '../catalog.mjs';
import { prepareMssqlSeller, verifyPreparedMssqlSeller } from '../prepare.mjs';
import { startMssqlSeller } from '../merchant.mjs';
import { compileWorkspacePlan, describeRelation, fingerprint, fields, fail } from './plan.mjs';

const SCHEMA = 'stellar-forge.mssql-workspace-release.v1';
const idPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const safeId = id => {
  if (typeof id !== 'string' || !idPattern.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) fail('RELEASE_ID_INVALID');
  return id;
};
async function limited(path, maximum = 262144) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) fail('WORKSPACE_FILE_INVALID');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) fail('WORKSPACE_FILE_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}
async function put(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || await realpath(path) !== path)
    fail('PRIVATE_REAL_DIRECTORY_REQUIRED');
}
async function directorySync(path) {
  const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}

async function sourceSnapshot(sourceFile) {
  const before = await limited(sourceFile), declaration = await readMssqlSourceFile(sourceFile);
  const after = await limited(sourceFile);
  if (!before.equals(after) || fingerprint(JSON.parse(before)) !== fingerprint(declaration.config)) fail('SOURCE_PROFILE_CHANGED', 409);
  let ca;
  if (declaration.config.connection.caFile) ca = await limited(resolve(dirname(sourceFile), declaration.config.connection.caFile), 1048576);
  return { config: declaration.config, ca, profileId: fingerprint({ source: hash(before), ca: ca ? hash(ca) : null }) };
}
async function stageSource(directory, source, ca) {
  const config = structuredClone(source);
  if (ca) { config.connection.caFile = 'database-ca.pem'; await put(resolve(directory, 'database-ca.pem'), ca); }
  const path = resolve(directory, 'candidate-source.json'); await put(path, encode(config));
  return path;
}
function clientArchive(directory) {
  return new Promise((done, reject) => {
    const child = spawn('tar', ['-czf', '-', '-C', directory, '--', 'openapi.json',
      'client/seller-client.mjs', 'client/seller-client.d.mts', 'client/seller-openapi.json', 'client/package.json', 'client/README.md'],
    { stdio: ['ignore', 'pipe', 'ignore'], signal: AbortSignal.timeout(15000) });
    let size = 0, failed = false; const chunks = [];
    child.stdout.on('data', bytes => {
      size += bytes.length;
      if (size > 33554432) { failed = true; child.kill('SIGTERM'); } else chunks.push(bytes);
    });
    child.once('error', () => reject(new Error('MSSQL_CLIENT_ARCHIVE_UNAVAILABLE')));
    child.once('close', code => code === 0 && !failed ? done(Buffer.concat(chunks)) : reject(new Error('MSSQL_CLIENT_ARCHIVE_UNAVAILABLE')));
  });
}

export async function createMssqlWorkspace({ sourceFile, stateDirectory, environment = process.env,
  sellerPort = 0, operationsPort = 0, nativeFactory = null, drainGraceMs = 60000 } = {}) {
  if (typeof sourceFile !== 'string' || !isAbsolute(sourceFile) || typeof stateDirectory !== 'string' ||
      !isAbsolute(stateDirectory) || resolve(stateDirectory) === '/') fail('ABSOLUTE_SOURCE_AND_STATE_REQUIRED');
  const root = resolve(stateDirectory), sourcePath = resolve(sourceFile), releases = resolve(root, 'releases');
  await privateDirectory(root); await privateDirectory(releases); await privateDirectory(resolve(root, 'temporary'));
  await privateDirectory(resolve(root, 'availability')); await privateDirectory(resolve(root, 'locks'));
  await sourceSnapshot(sourcePath);
  for (const value of [sellerPort, operationsPort]) if (!Number.isInteger(value) || value < 0 || value > 65535) fail('WORKSPACE_PORT_INVALID');
  const reviews = new Map(); let pending = Promise.resolve(), closing = false, active = null, closingPromise;
  const serialize = fn => {
    if (closing) return Promise.reject(Object.assign(new Error('WORKSPACE_CLOSING'), { status: 503 }));
    const next = pending.then(fn); pending = next.catch(() => {}); return next;
  };
  const currentRuntime = () => active ? { runId: active.runId, releaseId: active.releaseId,
    manifestSha256: active.manifestSha256, startedAt: active.startedAt, status: active.status,
    mode: active.session.mode, url: active.session.url, docs: active.session.url + '/_seller/docs',
    openapi: active.session.url + '/_seller/openapi.json', operations: active.session.operations?.url,
    availability: active.session.operations?.availabilityUrl, availabilityControl: active.session.operations?.availabilityControlUrl } : null;
  async function lockRelease(id) {
    // The original availability store uses this same retained-description flock
    // pattern. A process exit releases the lock without consuming the release ID.
    const path = resolve(root, 'locks', id + '.lock');
    const handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    const assertLease = async () => {
      const [opened, named] = await Promise.all([handle.stat(), lstat(path)]);
      if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || opened.nlink !== 1 ||
          (opened.mode & 0o077) || opened.dev !== named.dev || opened.ino !== named.ino) fail('MSSQL_RELEASE_LEASE_LOST', 503);
    };
    try {
      await assertLease();
      const result = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
        { stdio: ['ignore', 'ignore', 'ignore', handle.fd] });
      if (result.status === 73) fail('MSSQL_RELEASE_PREPARATION_ACTIVE', 409);
      if (result.error || result.status !== 0) fail('MSSQL_RELEASE_LOCK_UNAVAILABLE', 503);
      await assertLease();
      return { assert: assertLease, close: () => handle.close() };
    } catch (issue) { await handle.close(); throw issue; }
  }
  async function readMetadata(id) {
    safeId(id); const directory = resolve(releases, id), stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('RELEASE_DIRECTORY_INVALID');
    const saved = JSON.parse(await limited(resolve(directory, 'workspace.json'), 1048576));
    if (saved?.schema !== SCHEMA || saved.releaseId !== id || !/^[a-f0-9]{64}$/.test(saved.manifestSha256 ?? '') ||
        !/^[a-f0-9]{64}$/.test(saved.planId ?? '') || typeof saved.label !== 'string') fail('RELEASE_METADATA_INVALID');
    return { saved, directory };
  }
  async function verifiedRelease(id, expected) {
    const value = await readMetadata(id), prepared = await verifyPreparedMssqlSeller(resolve(value.directory, 'package'));
    if (prepared.manifestSha256 !== value.saved.manifestSha256 || expected && expected !== prepared.manifestSha256)
      fail('RELEASE_CHANGED', 409);
    return { ...value, prepared };
  }
  function releaseSummary(value) {
    const { saved, directory, prepared } = value;
    return { schema: SCHEMA, releaseId: saved.releaseId, label: saved.label, planId: saved.planId,
      createdAt: saved.createdAt, manifestSha256: saved.manifestSha256, choices: saved.choices,
      directory: resolve(directory, 'package'), routes: prepared.routes, requiredEnvironment: saved.requiredEnvironment,
      files: Object.keys(prepared.files).map(name => ({ name, ...prepared.files[name] })), runtime: currentRuntime() };
  }
  async function relationsFor(input, snapshot) {
    if (!Array.isArray(input?.endpoints) || !input.endpoints.length || input.endpoints.length > 64) fail('SELECT_1_TO_64_UNIQUE_ENDPOINTS');
    const relations = new Map();
    for (const table of new Set(input.endpoints.map(endpoint => endpoint?.table))) {
      const catalog = await inspectMssqlCatalog(sourcePath, { environment, table });
      relations.set(table, describeRelation(catalog, snapshot.profileId));
    }
    if ((await sourceSnapshot(sourcePath)).profileId !== snapshot.profileId) fail('SOURCE_PROFILE_CHANGED', 409);
    return relations;
  }
  function reviewPublic(value) {
    return { reviewId: value.reviewId, planId: value.planId, expiresAt: value.expiresAt,
      releaseId: value.compiled.choices.releaseId, label: value.compiled.choices.label,
      profileId: value.snapshot.profileId, requiredEnvironment: value.snapshot.config.connection.passwordEnv ?? null,
      endpoints: value.compiled.endpoints, publicContract: value.compiled.service, merchantPlan: value.compiled.plan };
  }
  function getReview(id, planId) {
    const value = reviews.get(id);
    if (!value || value.planId !== planId || Date.now() > Date.parse(value.expiresAt)) fail('REVIEW_CURRENT_CHOICES_REQUIRED', 409);
    return value;
  }
  async function refreshReview(value) {
    const snapshot = await sourceSnapshot(sourcePath);
    if (snapshot.profileId !== value.snapshot.profileId) fail('SOURCE_PROFILE_CHANGED', 409);
    const relations = await relationsFor(value.compiled.choices, snapshot);
    const compiled = compileWorkspacePlan(value.compiled.choices, relations, snapshot.config);
    if (fingerprint({ profileId: snapshot.profileId, compiled }) !== value.planId) fail('SOURCE_SCHEMA_CHANGED', 409);
    return { snapshot, compiled };
  }

  return {
    stateDirectory: root,
    info: () => serialize(async () => {
      const snapshot = await sourceSnapshot(sourcePath), c = snapshot.config.connection;
      return { schema: 'stellar-forge.mssql-workspace.v1', stateDirectory: root, sourceFile: sourcePath,
        source: { database: c.database, host: c.host, user: c.user, tls: c.tls ?? 'verify-full', passwordEnv: c.passwordEnv ?? null },
        profileId: snapshot.profileId, runtime: currentRuntime(), mode: nativeFactory ? 'NATIVE_FACILITATOR' : 'CHALLENGE_ONLY' };
    }),
    catalog: table => serialize(async () => {
      const snapshot = await sourceSnapshot(sourcePath), catalog = await inspectMssqlCatalog(sourcePath, { environment, table });
      if ((await sourceSnapshot(sourcePath)).profileId !== snapshot.profileId) fail('SOURCE_PROFILE_CHANGED', 409);
      return table === undefined ? { ...catalog, profileId: snapshot.profileId } : describeRelation(catalog, snapshot.profileId);
    }),
    review: input => serialize(async () => {
      const snapshot = await sourceSnapshot(sourcePath), relations = await relationsFor(input, snapshot);
      const compiled = compileWorkspacePlan(input, relations, snapshot.config);
      const value = { reviewId: randomUUID(), planId: fingerprint({ profileId: snapshot.profileId, compiled }),
        expiresAt: new Date(Date.now() + 900000).toISOString(), snapshot, compiled };
      for (const [key, previous] of reviews) if (Date.now() > Date.parse(previous.expiresAt)) reviews.delete(key);
      while (reviews.size >= 8) reviews.delete(reviews.keys().next().value);
      reviews.set(value.reviewId, value); return reviewPublic(value);
    }),
    preview: input => serialize(async () => {
      fields(input, ['reviewId', 'planId', 'endpointId']); const reviewed = getReview(input.reviewId, input.planId);
      const { snapshot, compiled } = await refreshReview(reviewed);
      const route = compiled.plan.routes.find(item => item.id === input.endpointId);
      if (!route) fail('ENDPOINT_NOT_IN_REVIEW');
      const directory = await mkdtemp(resolve(root, 'temporary', 'preview-')); let source;
      try {
        const path = await stageSource(directory, compiled.source, snapshot.ca);
        ({ source } = await openMssqlSourceFile(path, { environment }));
        const result = await source.query(route.query, route.example);
        return { kind: 'PRIVATE_OPERATOR_PREVIEW', endpointId: route.id, example: route.example, result };
      } finally { try { await source?.close(); } finally { await rm(directory, { recursive: true, force: true }); } }
    }),
    prepare: input => serialize(async () => {
      fields(input, ['reviewId', 'planId']); const reviewed = getReview(input.reviewId, input.planId);
      const id = safeId(reviewed.compiled.choices.releaseId);
      const destination = resolve(releases, id), lease = await lockRelease(id);
      try {
        let exists = false;
        try { await lstat(destination); exists = true; } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
        if (exists) {
          const previous = await verifiedRelease(id);
          if (previous.saved.planId !== reviewed.planId) fail('RELEASE_ID_ALREADY_USED', 409);
          return { ...releaseSummary(previous), reopened: true };
        }
        const { snapshot, compiled } = await refreshReview(reviewed);
        const stage = await mkdtemp(resolve(root, 'temporary', 'release-'));
        let committed = false;
        try {
          const candidate = await stageSource(stage, compiled.source, snapshot.ca), planPath = resolve(stage, 'candidate-plan.json');
          await put(planPath, encode(compiled.plan));
          const prepared = await prepareMssqlSeller({ sourceFile: candidate, planFile: planPath, directory: resolve(stage, 'package') });
          const saved = { schema: SCHEMA, releaseId: id, label: compiled.choices.label, planId: reviewed.planId,
            createdAt: prepared.createdAt, manifestSha256: prepared.manifestSha256, choices: compiled.choices,
            requiredEnvironment: snapshot.config.connection.passwordEnv ?? null };
          await put(resolve(stage, 'workspace.json'), encode(saved));
          await rm(candidate); await rm(planPath); if (snapshot.ca) await rm(resolve(stage, 'database-ca.pem'));
          await verifyPreparedMssqlSeller(resolve(stage, 'package')); await directorySync(stage);
          await lease.assert();
          await rename(stage, destination); committed = true; await directorySync(releases);
          return releaseSummary({ saved, directory: destination, prepared });
        } finally {
          if (!committed) await rm(stage, { recursive: true, force: true });
        }
      } finally { await lease.close(); }
    }),
    list: (page = 0) => serialize(async () => {
      if (!Number.isInteger(page) || page < 0 || page > 100000) fail('RELEASE_PAGE_INVALID');
      const names = (await readdir(releases, { withFileTypes: true })).filter(item => item.isDirectory() && idPattern.test(item.name))
        .map(item => item.name).sort();
      const items = [];
      for (const id of names.slice(page * 50, (page + 1) * 50)) {
        try { const { saved } = await readMetadata(id); items.push({ releaseId: id, label: saved.label, createdAt: saved.createdAt,
          manifestSha256: saved.manifestSha256, endpoints: saved.choices?.endpoints?.length ?? 0 }); }
        catch { items.push({ releaseId: id, error: 'RELEASE_METADATA_UNAVAILABLE' }); }
      }
      return { items, page, total: names.length, hasMore: names.length > (page + 1) * 50, runtime: currentRuntime() };
    }),
    open: id => serialize(async () => releaseSummary(await verifiedRelease(id))),
    run: input => serialize(async () => {
      fields(input, ['releaseId', 'manifestSha256']);
      const value = await verifiedRelease(input.releaseId, input.manifestSha256);
      if (!/^[a-f0-9]{64}$/.test(input.manifestSha256 ?? '')) fail('REVIEW_RELEASE_BEFORE_START', 409);
      if (active) {
        if (active.releaseId === input.releaseId && active.manifestSha256 === input.manifestSha256) return currentRuntime();
        fail('STOP_CURRENT_MERCHANT_BEFORE_START', 409);
      }
      const session = await startMssqlSeller({ sourceFile: resolve(value.directory, 'package', 'source.json'),
        configFile: resolve(value.directory, 'package', 'service.json'), environment, port: sellerPort, operationsPort,
        nativeFactory, drainGraceMs, availabilityDirectory: resolve(root, 'availability', input.releaseId) });
      active = { session, runId: randomUUID(), releaseId: input.releaseId, manifestSha256: input.manifestSha256,
        startedAt: new Date().toISOString(), status: 'running' };
      return currentRuntime();
    }),
    stop: input => serialize(async () => {
      fields(input, ['runId']);
      if (!active || active.runId !== input.runId) fail('MERCHANT_RUN_CHANGED', 409);
      active.status = 'stopping'; await active.session.close(); active = null; return { stopped: true };
    }),
    runtime: () => Promise.resolve(currentRuntime()),
    exportClient: input => serialize(async () => {
      fields(input, ['releaseId', 'manifestSha256']);
      if (!/^[a-f0-9]{64}$/.test(input.manifestSha256 ?? '')) fail('REVIEW_RELEASE_BEFORE_EXPORT', 409);
      const value = await verifiedRelease(input.releaseId, input.manifestSha256);
      const bytes = await clientArchive(resolve(value.directory, 'package'));
      return { filename: input.releaseId + '-customer-client.tar.gz', bytes, sha256: hash(bytes) };
    }),
    close() {
      closing = true;
      return closingPromise ??= pending.then(async () => {
        if (active) { active.status = 'stopping'; await active.session.close(); active = null; }
        reviews.clear();
      });
    },
  };
}
