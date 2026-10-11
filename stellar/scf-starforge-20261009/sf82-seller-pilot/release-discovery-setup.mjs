// MIT. First-run merchant discovery using the original release and catalog services.
import { constants as FS } from 'node:fs';
import { open, mkdir, lstat, realpath, unlink } from 'node:fs/promises';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { inspectReleaseCatalogOffers, readReleaseCatalogConfig, RELEASE_CATALOG_CONFIG } from './release-catalog.mjs';
import { openCatalogOperator, readOperatorPolicy, POLICY_SCHEMA } from '../sf60-durable-catalog-transaction/operator.mjs';
import { openCatalogWorkspace } from '../sf60-durable-catalog-transaction/workspace.mjs';

export const DISCOVERY_SETUP_SCHEMA = 'stellar-forge.merchant-discovery-setup/v1';
export const SELLER_ENROLLMENT_SCHEMA = 'stellar-forge.seller-public-enrollment/v1';
const FILES = Object.freeze({ connection: 'connection.json', policy: 'policy.json',
  privateKey: 'seller-key.pem', publicKey: 'seller-public.pem', enrollment: 'seller-enrollment.json' });
const PUBLIC_FILES = ['connection', 'policy', 'publicKey', 'enrollment'];
const MAX_SETUP_BYTES = 8 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };

async function privateDirectory(path, ownerUid = process.getuid?.()) {
  const meta = await lstat(path);
  if (!meta.isDirectory() || meta.isSymbolicLink() || await realpath(path) !== path ||
      (meta.mode & 0o077) !== 0 || (ownerUid !== undefined && meta.uid !== ownerUid))
    fail('DISCOVERY_PRIVATE_DIRECTORY_REQUIRED', 'Use a real private directory owned by the current operator.');
  return path;
}

function separate(root, directory) {
  if (root === directory || root.startsWith(directory + sep) || directory.startsWith(root + sep))
    fail('DISCOVERY_SEPARATE_DIRECTORY_REQUIRED', 'Keep discovery identity and state beside the release store, in a separate directory.');
}

async function syncDirectory(path) {
  const handle = await open(path, FS.O_RDONLY | (FS.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeNew(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}

async function ownedFile(path, limit = 1024 * 1024, read = true, ownerUid = process.getuid?.()) {
  const file = await open(path, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.nlink !== 1 || (meta.mode & 0o777) !== 0o600 ||
        (ownerUid !== undefined && meta.uid !== ownerUid) || meta.size < 1 || meta.size > limit)
      fail('DISCOVERY_PRIVATE_FILE_REQUIRED', 'Use the intact private files created by discovery setup.');
    if (!read) return { bytes: meta.size, mode: '0600' };
    const buffer = Buffer.alloc(meta.size + 1); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used !== meta.size) fail('DISCOVERY_FILE_CHANGED');
    return buffer.subarray(0, used);
  } finally { await file.close(); }
}

function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('DISCOVERY_SETUP_JSON_INVALID'); }
}

async function sourceOf(root, releaseId, sourceURL) {
  const original = await inspectReleaseCatalogOffers(root, releaseId);
  const { release, offers } = original;
  let source;
  try { source = new URL(sourceURL ?? '/_seller/offers', release.publicOrigin); }
  catch { fail('DISCOVERY_SOURCE_URL_INVALID'); }
  if (source.protocol !== 'https:' || source.origin !== release.publicOrigin || source.username ||
      source.password || source.hash || (sourceURL !== undefined && source.href !== sourceURL))
    fail('DISCOVERY_SOURCE_URL_INVALID', 'Use the exact credential-free HTTPS export URL on this retained release’s public origin.');
  const unique = values => [...new Set(values)].sort();
  const permissions = {
    allowedOrigins: unique(offers.map(item => new URL(item.url).origin)),
    allowedRecipients: unique(offers.flatMap(item => item.entry.accepts.map(payment => payment.payTo))),
    allowedNetworks: unique(offers.flatMap(item => item.entry.accepts.map(payment => payment.network))),
    allowedSchemes: unique(offers.flatMap(item => item.entry.accepts.map(payment => payment.scheme))),
  };
  if (permissions.allowedOrigins.length !== 1 || permissions.allowedOrigins[0] !== release.publicOrigin)
    fail('DISCOVERY_RELEASE_ORIGIN_MISMATCH');
  if (Object.values(permissions).some(values => values.length < 1 || values.length > 64 ||
      values.some(value => typeof value !== 'string' || !value || value.length > 256)))
    fail('DISCOVERY_ORIGINAL_POLICY_LIMIT', 'The retained release exceeds the original catalog policy limits.');
  const sourceIdentity = { releaseId: release.id, digest: release.digest,
    serviceConfigSha256: release.source.serviceConfigSha256, publicOrigin: release.publicOrigin,
    sourceURL: source.href, resources: offers.map(item => ({ routeId: item.routeId, method: item.method,
      url: item.url, catalogKey: item.catalogKey, sourceSha256: item.sourceSha256,
      payment: structuredClone(item.entry.accepts) })) };
  return { source: sourceIdentity, permissions };
}

/** Review the same source-derived enrollment before creating its private identity. */
export async function reviewReleaseDiscoverySetup(root, { releaseId, sellerId, sourceURL } = {}) {
  if (typeof sellerId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(sellerId)) fail('DISCOVERY_SELLER_ID_REQUIRED');
  const original = await sourceOf(resolve(root), releaseId, sourceURL);
  if (jsonBytes(original).length > MAX_SETUP_BYTES - 8192) fail('DISCOVERY_SETUP_SOURCE_LIMIT');
  return { sellerId, ...original };
}

/** Create once from the actual retained merchant. No key or policy is overwritten. */
export async function createReleaseDiscoverySetup(root, { directory, releaseId, sellerId, sourceURL } = {}) {
  if (process.platform === 'win32') fail('POSIX_PRIVATE_PERMISSIONS_REQUIRED');
  if (typeof directory !== 'string' || !directory.trim()) fail('DISCOVERY_SETUP_DIRECTORY_REQUIRED');
  root = resolve(root); directory = resolve(directory); separate(root, directory);
  const reviewed = await reviewReleaseDiscoverySetup(root, { releaseId, sellerId, sourceURL });
  const original = { source: reviewed.source, permissions: reviewed.permissions };
  const parent = dirname(directory);
  if (await realpath(parent) !== parent) fail('DISCOVERY_REAL_PARENT_REQUIRED');
  // mkdir is exclusive. A failed setup retains its private files for the owner;
  // setup.json is written last and incomplete directories cannot be launched.
  await mkdir(directory, { mode: 0o700 });
  let secret;
  try {
    await privateDirectory(directory);
    const keys = generateKeyPairSync('ed25519');
    secret = Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' });
    const publicKeySha256 = sha(keys.publicKey.export({ format: 'der', type: 'spki' }));
    const seller = { sellerId, pinnedPublicKey: publicKey, ...original.permissions };
    const documents = {
      policy: jsonBytes({ schema: POLICY_SCHEMA, sellers: [seller] }),
      connection: jsonBytes({ schema: RELEASE_CATALOG_CONFIG, directory: './catalog',
        sellerId, sourceURL: original.source.sourceURL, keyFile: './' + FILES.privateKey }),
      publicKey: Buffer.from(publicKey),
      enrollment: jsonBytes({ schema: SELLER_ENROLLMENT_SCHEMA, seller, publicKeySha256, source: original.source }),
    };
    await writeNew(join(directory, FILES.privateKey), secret);
    for (const key of PUBLIC_FILES) await writeNew(join(directory, FILES[key]), documents[key]);
    for (const child of ['catalog', 'workspace', 'launches']) await mkdir(join(directory, child), { mode: 0o700 });
    // Compile with the original policy and connection readers before completion.
    await readOperatorPolicy(join(directory, FILES.policy));
    await readReleaseCatalogConfig(join(directory, FILES.connection));
    const record = { schema: DISCOVERY_SETUP_SCHEMA, createdAt: new Date().toISOString(),
      sellerId, publicKeySha256, source: original.source, permissions: original.permissions,
      files: FILES, fingerprints: Object.fromEntries(PUBLIC_FILES.map(key => [key, sha(documents[key])])) };
    await writeNew(join(directory, 'setup.json'), jsonBytes(record));
    await syncDirectory(directory); await syncDirectory(parent);
  } catch (error) {
    error.setupDirectory = directory;
    throw error;
  } finally { secret?.fill(0); }
  return inspectReleaseDiscoverySetup(root, { directory });
}

/** Reopen exact public setup and original source without reading signing bytes. */
export async function inspectReleaseDiscoverySetup(root, { directory, includeEnrollment = false,
  ownerUid = process.getuid?.() } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) fail('DISCOVERY_SETUP_DIRECTORY_REQUIRED');
  if (typeof includeEnrollment !== 'boolean') fail('DISCOVERY_INSPECTION_OPTIONS_INVALID');
  // A trusted host administrator can inspect the declared service account's
  // files without changing ownership or reading its signing key. Launch keeps
  // the current-user default and never accepts this inspection-only option.
  if (ownerUid !== undefined && (!Number.isSafeInteger(ownerUid) || ownerUid < 0))
    fail('DISCOVERY_INSPECTION_OPTIONS_INVALID');
  root = resolve(root); directory = resolve(directory); separate(root, directory);
  await privateDirectory(directory, ownerUid);
  let record;
  try { record = parseJson(await ownedFile(join(directory, 'setup.json'), MAX_SETUP_BYTES, true, ownerUid)); }
  catch (error) {
    if (error.code === 'ENOENT') fail('DISCOVERY_SETUP_INCOMPLETE', 'Setup did not finish. Preserve this directory; create a new setup directory or restore its complete private backup.');
    throw error;
  }
  const expectedFields = ['schema', 'createdAt', 'sellerId', 'publicKeySha256', 'source', 'permissions', 'files', 'fingerprints'];
  if (!plain(record) || !same(Object.keys(record).sort(), expectedFields.sort()) || record.schema !== DISCOVERY_SETUP_SCHEMA ||
      !same(record.files, FILES) || !plain(record.fingerprints) ||
      !same(Object.keys(record.fingerprints).sort(), [...PUBLIC_FILES].sort()) ||
      !/^[a-f0-9]{64}$/.test(record.publicKeySha256 ?? '') ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(record.sellerId ?? '') ||
      typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
      new Date(record.createdAt).toISOString() !== record.createdAt)
    fail('DISCOVERY_SETUP_INVALID');
  const original = await sourceOf(root, record.source?.releaseId, record.source?.sourceURL);
  if (!same(original.source, record.source) || !same(original.permissions, record.permissions))
    fail('DISCOVERY_SETUP_SOURCE_CHANGED', 'Use the retained release that created this discovery setup.');
  const documents = {};
  for (const key of PUBLIC_FILES) {
    const bytes = await ownedFile(join(directory, FILES[key]), MAX_SETUP_BYTES, true, ownerUid);
    if (sha(bytes) !== record.fingerprints[key]) fail('DISCOVERY_SETUP_FILE_CHANGED');
    documents[key] = key === 'publicKey' ? bytes : parseJson(bytes);
  }
  const key = createPublicKey(documents.publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || sha(key.export({ format: 'der', type: 'spki' })) !== record.publicKeySha256)
    fail('DISCOVERY_PUBLIC_KEY_MISMATCH');
  const expectedSeller = { sellerId: record.sellerId,
    pinnedPublicKey: key.export({ format: 'pem', type: 'spki' }), ...record.permissions };
  if (!same(documents.policy, { schema: POLICY_SCHEMA, sellers: [expectedSeller] }) ||
      !same(documents.enrollment, { schema: SELLER_ENROLLMENT_SCHEMA, seller: expectedSeller,
        publicKeySha256: record.publicKeySha256, source: record.source }) ||
      !same(documents.connection, { schema: RELEASE_CATALOG_CONFIG, directory: './catalog',
        sellerId: record.sellerId, sourceURL: record.source.sourceURL, keyFile: './' + FILES.privateKey }))
    fail('DISCOVERY_SETUP_BINDING_CHANGED');
  await readOperatorPolicy(join(directory, FILES.policy));
  const connection = await readReleaseCatalogConfig(join(directory, FILES.connection));
  await ownedFile(connection.keyFile, 16384, false, ownerUid);
  for (const child of ['catalog', 'workspace', 'launches']) await privateDirectory(join(directory, child), ownerUid);
  return { state: 'CONFIGURED', directory, sellerId: record.sellerId,
    publicKeySha256: record.publicKeySha256, source: record.source, permissions: record.permissions,
    connectionFile: join(directory, FILES.connection), policyFile: join(directory, FILES.policy),
    enrollmentFile: join(directory, FILES.enrollment), catalogDirectory: connection.directory,
    workspaceDirectory: join(directory, 'workspace'), policySha256: record.fingerprints.policy,
    ...(includeEnrollment ? { enrollment: documents.enrollment } : {}) };
}

/** Own only the original services started by this call. Close UI before its writer. */
export async function openReleaseDiscoverySetup(root, { directory, port = 0, workspace = true, workspacePort = 0 } = {}) {
  if (typeof workspace !== 'boolean' || [port, workspacePort].some(value => !Number.isInteger(value) || value < 0 || value > 65535))
    fail('DISCOVERY_LAUNCH_OPTIONS_INVALID');
  const setup = await inspectReleaseDiscoverySetup(root, { directory });
  let operator, ui, launchFile, launchIdentity, closePromise, resolveClosed;
  const closed = new Promise(done => { resolveClosed = done; });
  const removeLaunch = async () => {
    if (!launchIdentity) return;
    try {
      const meta = await lstat(launchFile);
      if (meta.dev === launchIdentity.dev && meta.ino === launchIdentity.ino) {
        await unlink(launchFile); await syncDirectory(dirname(launchFile));
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    launchIdentity = null;
  };
  const close = () => {
    if (!closePromise) closePromise = (async () => {
      try { await ui?.close(); }
      finally {
        try { await operator?.close(); }
        finally { try { await removeLaunch(); } finally { resolveClosed(); } }
      }
    })();
    return closePromise;
  };
  try {
    operator = await openCatalogOperator({ directory: setup.catalogDirectory,
      policyFile: setup.policyFile, createEmpty: true, controlTransport: 'loopback', port });
    if (workspace) {
      ui = await openCatalogWorkspace({ directory: setup.catalogDirectory,
        stateDirectory: setup.workspaceDirectory, port: workspacePort });
      launchFile = join(setup.directory, 'launches', randomUUID() + '.txt');
      const file = await open(launchFile, 'wx', 0o600);
      try {
        const meta = await file.stat(); launchIdentity = { dev: meta.dev, ino: meta.ino };
        await file.writeFile(ui.launchURL + '\n'); await file.sync();
      } finally { await file.close(); }
      await syncDirectory(dirname(launchFile));
    }
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  return { state: 'RUNNING', setupDirectory: setup.directory, sellerId: setup.sellerId,
    publicKeySha256: setup.publicKeySha256, connectionFile: setup.connectionFile,
    discoveryOrigin: operator.origin, policySha256: operator.policySha256,
    ...(ui ? { workspaceOrigin: ui.origin, launchFile } : {}), closed, close };
}
