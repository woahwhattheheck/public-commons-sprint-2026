// MIT. Standalone product around the original native MPP workspace and merchant MCP.
import { mkdir, lstat, realpath, open, link, rename, unlink, readdir } from 'node:fs/promises';
import { constants as C } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { digest, canonical, plain, need, regular, readJSON, saveJSON, privateDirectory,
  operationLease } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { openWorkspace, nativeRecordGroups } from '../../stellar/scf-starforge-20261009/mpp-charge/storage.mjs';
import { versions } from '../../stellar/scf-starforge-20261009/mpp-charge/runtime.mjs';

export const MPP_PRODUCT_SCHEMA = 'stellar-forge.mpp-product.v1';
export const MPP_PRODUCT_CUSTOMERS_SCHEMA = 'stellar-forge.mpp-product-customers.v1';
export const MPP_PRODUCT_SESSION_SCHEMA = 'stellar-forge.mpp-product-session.v1';
export const CONSOLE_TOKEN_ENV = 'STARFORGE_MPP_PRODUCT_CONSOLE_TOKEN';
export const stable = value => JSON.stringify(canonical(value));
export const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
export const fullPath = value => {
  need(typeof value === 'string' && value && value === resolve(value) && !/[\0\r\n]/.test(value),
    'MPP_PRODUCT_PATH_REQUIRED', 'Use an absolute original private directory or file.');
  return value;
};
export const displayName = value => {
  need(typeof value === 'string' && value.trim() && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value),
    'MPP_PRODUCT_NAME_INVALID', 'Use a printable product name of up to 160 characters.');
  return value.trim();
};
export const alias = value => {
  need(typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value),
    'MPP_PRODUCT_ALIAS_INVALID', 'Use a lowercase customer alias.');
  return value;
};
export const sha = value => {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    'MPP_PRODUCT_HASH_REQUIRED', 'Use the exact inspected SHA-256.');
  return value;
};
export const environmentName = value => {
  need(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value),
    'MPP_PRODUCT_ENVIRONMENT_INVALID', 'Select an environment-variable name.');
  return value;
};
export function portNumber(value, label = 'Port') {
  need(/^(0|[1-9][0-9]{0,4})$/.test(String(value)) && Number(value) <= 65535,
    'MPP_PRODUCT_PORT_INVALID', label + ' must be 0–65535.');
  return Number(value);
}
export async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function privateFile(path, maximum = 4 * 1024 * 1024) {
  const filename = fullPath(path), info = await lstat(filename);
  need(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    (process.getuid === undefined || info.uid === process.getuid()),
  'MPP_PRODUCT_PRIVATE_FILE_REQUIRED', 'Use a private regular file owned by the current operator.');
  return regular(filename, maximum);
}
export async function makeDirectory(path) {
  fullPath(path);
  need(await realpath(dirname(path)) === dirname(path), 'MPP_PRODUCT_REAL_PARENT_REQUIRED');
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return privateDirectory(path);
}
/** Whole-file publication; an interrupted write never becomes retained setup. */
export async function writePrivate(path, value, replace = false) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  let previous;
  try { previous = await privateFile(path, 16 * 1024 * 1024); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.equals(bytes)) return;
  need(!previous || replace, 'MPP_PRODUCT_FILE_CONFLICT', 'The original file already contains different bytes: ' + path);
  const temporary = path + '.pending-' + randomUUID();
  const handle = await open(temporary, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    if (replace) await rename(temporary, path);
    else {
      try { await link(temporary, path); }
      catch (error) { if (error.code !== 'EEXIST' || !(await privateFile(path, bytes.length)).equals(bytes)) throw error; }
      await unlink(temporary);
    }
    const parent = await open(dirname(path), C.O_RDONLY | C.O_DIRECTORY);
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function fixedPaths(directory) {
  return { directory, operatorDirectory: join(directory, 'operator'),
    configuration: join(directory, 'operator', 'merchant-mcp.json'),
    connection: join(directory, 'mpp-connections.json'), customersFile: join(directory, 'customers.json'),
    customerFiles: join(directory, 'customers'), receivingDirectory: join(directory, 'receiving'),
    sessionFile: join(directory, 'session.json') };
}
async function productLease(directory) {
  try { return await operationLease(join(directory, '.product.lock')); }
  catch (error) {
    if (error.code === 'RUNTIME_WORKSPACE_OPERATION_RUNNING')
      throw Object.assign(new Error('This MPP product has a live owner. Use its original browser and agent, or stop that application before editing setup.'),
        { code: 'MPP_PRODUCT_ALREADY_OPEN' });
    throw error;
  }
}
export async function inspectNativeSelection(dependencyRoot) {
  const directory = await privateDirectory(fullPath(dependencyRoot));
  const files = [];
  for (const name of ['package.json', 'package-lock.json']) {
    const actual = await regular(join(directory, name), 256 * 1024);
    const original = await regular(new URL('../../stellar/scf-starforge-20261009/mpp-charge/' + name, import.meta.url), 256 * 1024);
    need(actual.equals(original), 'MPP_PRODUCT_RUNTIME_SELECTION_CHANGED',
      'Select the runtime containing this product’s original package manifest and exact lockfile.');
    files.push({ role: 'nativeRuntime:' + name, path: join(directory, name), bytes: actual.length, sha256: digest(actual) });
  }
  const installed = [];
  for (const [name, version] of Object.entries(versions)) {
    const path = join(directory, 'node_modules', name, 'package.json');
    try {
      const bytes = await regular(path, 256 * 1024), metadata = decode(bytes);
      need(metadata.name === name && metadata.version === version,
        'MPP_PRODUCT_RUNTIME_VERSION_CHANGED', 'Use the exact installed native MPP versions.');
      installed.push({ name, version, path, bytes: bytes.length, sha256: digest(bytes) });
    } catch (error) { if (error.code !== 'ENOENT') throw error; installed.push({ name, version, installed: false }); }
  }
  return { directory, versions, files, installed,
    state: installed.every(value => value.sha256) ? 'PACKAGES_PRESENT' : 'RECEIVING_REQUIRED' };
}
export async function readNativeIdentity(directory) {
  await privateDirectory(directory);
  const metadata = decode(await privateFile(join(directory, 'workspace.json'), 16384));
  need(metadata.schema === 'stellar-forge.mpp-workspace.v1' &&
    Number.isSafeInteger(metadata.revision) && metadata.revision >= 0 &&
    typeof metadata.createdAt === 'string' && Number.isFinite(Date.parse(metadata.createdAt)),
  'MPP_PRODUCT_WORKSPACE_CHANGED', 'Select the original native MPP workspace.');
  const profiles = {};
  for (const kind of ['merchant', 'buyer', 'customer']) {
    const id = metadata[kind];
    if (id === null || id === undefined) { profiles[kind] = null; continue; }
    sha(id);
    const bytes = await privateFile(join(directory, 'profiles', digest(id) + '.json'), 4 * 1024 * 1024);
    const record = decode(bytes), profile = record.value;
    need(record.schema === 'stellar-forge.mpp-record.v1' && record.key === id && plain(profile) && digest(stable(profile)) === id, 'MPP_PRODUCT_PROFILE_CHANGED', 'The saved native profile differs from its original identity.');
    profiles[kind] = { id, path: join(directory, 'profiles', digest(id) + '.json'),
      bytes: bytes.length, sha256: digest(bytes), profile };
  }
  return { directory, metadata, profiles };
}
export async function readProductCustomers(profile) {
  const value = decode(await privateFile(profile.customersFile, 2 * 1024 * 1024));
  need(value.schema === MPP_PRODUCT_CUSTOMERS_SCHEMA && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    plain(value.customers) && Object.keys(value.customers).length <= 32,
  'MPP_PRODUCT_CUSTOMERS_CHANGED', 'Use the original retained customer selections.');
  for (const [key, item] of Object.entries(value.customers)) {
    alias(key); displayName(item.label); sha(item.sha256);
    need(item.file === join(profile.customerFiles, item.sha256 + '.json'),
      'MPP_PRODUCT_CUSTOMERS_CHANGED');
    const bytes = await privateFile(item.file, 2 * 1024 * 1024), configuration = decode(bytes);
    need(digest(bytes) === item.sha256 && configuration.workspace === profile.workspaceDirectory &&
      configuration.dependencyRoot === profile.dependencyRoot,
    'MPP_PRODUCT_CUSTOMER_CHANGED', 'The customer must retain this original workspace and native runtime.');
  }
  return value;
}
export function connectionDefinition(profile, customers, origin = 'http://127.0.0.1:0') {
  return { schema: 'stellar-forge.merchant-mpp-connection.v1', consoles: { native: {
    label: profile.name, origin, tokenEnv: CONSOLE_TOKEN_ENV, workspace: profile.workspaceDirectory,
    customers: Object.fromEntries(Object.entries(customers.customers).map(([key, value]) =>
      [key, { label: value.label, configuration: value.file }])) } } };
}
export async function readMppProduct(directory, { validateOperator = true } = {}) {
  directory = await privateDirectory(fullPath(directory));
  const profile = decode(await privateFile(join(directory, 'product.json')));
  need(profile.schema === MPP_PRODUCT_SCHEMA && profile.directory === directory &&
    stable(fixedPaths(directory)) === stable(Object.fromEntries(Object.keys(fixedPaths(directory)).map(key => [key, profile[key]]))) &&
    typeof profile.createdAt === 'string' && ['CREATED', 'ATTACHED'].includes(profile.workspaceOwnership),
  'MPP_PRODUCT_CONFIGURATION_CHANGED', 'Open the original MPP product directory.');
  displayName(profile.name); fullPath(profile.workspaceDirectory); fullPath(profile.dependencyRoot);
  const native = await readNativeIdentity(profile.workspaceDirectory);
  need(native.metadata.createdAt === profile.workspaceCreatedAt, 'MPP_PRODUCT_WORKSPACE_CHANGED');
  await inspectNativeSelection(profile.dependencyRoot);
  for (const path of [profile.customerFiles, profile.receivingDirectory, profile.operatorDirectory])
    await privateDirectory(path);
  const customers = await readProductCustomers(profile);
  if (validateOperator) {
    const raw = decode(await privateFile(profile.configuration));
    need(resolve(dirname(profile.configuration), raw.mppConnection ?? '') === profile.connection,
      'MPP_PRODUCT_CONFIGURATION_CHANGED', 'The merchant agent must use this product’s original MPP connection.');
    const { readMerchantConfig } = await import('../../stellar-forge/mcp-merchant-operator/config.mjs');
    const configured = await readMerchantConfig(profile.configuration), selected = configured.mpp?.consoles.native;
    need(selected?.workspace === profile.workspaceDirectory && selected.createdAt === profile.workspaceCreatedAt &&
      selected.tokenEnv === CONSOLE_TOKEN_ENV &&
      stable(Object.fromEntries(Object.entries(selected.customers).map(([key, value]) => [key, value.configurationSha256]))) ===
        stable(Object.fromEntries(Object.entries(customers.customers).map(([key, value]) => [key, value.sha256]))),
    'MPP_PRODUCT_CONFIGURATION_CHANGED', 'The original agent/customer selections differ from this product.');
  }
  return profile;
}
/** Create one native workspace or attach a stopped original workspace; retries finish the same setup. */
export async function initializeMppProduct({ directory, name, workspaceDirectory, dependencyRoot } = {}) {
  directory = fullPath(directory);
  await makeDirectory(directory);
  const lease = await productLease(directory);
  try {
    const setupFile = join(directory, 'product.setup.json');
    let setup;
    if (await exists(setupFile)) setup = decode(await privateFile(setupFile));
    else need((await readdir(directory)).every(value => value === '.product.lock'),
      'MPP_PRODUCT_SETUP_CONFLICT', 'Select an empty private product directory or its retained original setup.');
    const selected = {
      schema: MPP_PRODUCT_SCHEMA, name: displayName(name ?? setup?.name ?? 'Native MPP merchant and customer'),
      ...fixedPaths(directory),
      workspaceDirectory: fullPath(workspaceDirectory ?? setup?.workspaceDirectory ?? join(directory, 'workspace')),
      dependencyRoot: fullPath(dependencyRoot ?? setup?.dependencyRoot),
      workspaceOwnership: setup?.workspaceOwnership ?? (workspaceDirectory === undefined ? 'CREATED' : 'ATTACHED'),
      createdAt: setup?.createdAt ?? new Date().toISOString()
    };
    if (setup) need(stable(setup) === stable(selected), 'MPP_PRODUCT_SETUP_CONFLICT',
      'Resume this product with its original name, workspace and runtime selection.');
    await inspectNativeSelection(selected.dependencyRoot);
    await writePrivate(setupFile, selected);
    if (await exists(join(directory, 'product.json')))
      return { ...await readMppProduct(directory), state: 'INITIALIZED', reused: true };
    for (const path of [selected.customerFiles, selected.receivingDirectory]) await makeDirectory(path);
    if (selected.workspaceOwnership === 'CREATED' && !await exists(join(selected.workspaceDirectory, 'workspace.json'))) {
      // Only this retained setup may finish creation of its owned empty native root.
      if (await exists(selected.workspaceDirectory))
        need((await readdir(selected.workspaceDirectory)).every(value =>
          ['.mpp-workspace.lock', ...nativeRecordGroups].includes(value)),
        'MPP_PRODUCT_SETUP_CONFLICT', 'The selected native workspace contains unrelated files.');
      const original = await openWorkspace(selected.workspaceDirectory, { create: !await exists(selected.workspaceDirectory) });
      await original.close();
    }
    const native = await readNativeIdentity(selected.workspaceDirectory);
    const profile = { ...selected, workspaceCreatedAt: native.metadata.createdAt };
    await writePrivate(profile.customersFile, { schema: MPP_PRODUCT_CUSTOMERS_SCHEMA, revision: 0, customers: {} });
    await writePrivate(profile.connection, connectionDefinition(profile, await readProductCustomers(profile)));
    if (!await exists(profile.operatorDirectory)) {
      const { initializeMppMerchant } = await import('../../stellar-forge/mcp-merchant-operator/config.mjs');
      const stage = join(directory, '.operator-' + randomUUID());
      await initializeMppMerchant({ directory: stage, connection: profile.connection, name: profile.name });
      await rename(stage, profile.operatorDirectory);
    }
    await writePrivate(join(directory, 'product.json'), profile);
    await readMppProduct(directory);
    return { ...profile, state: 'INITIALIZED', reused: Boolean(setup), console: 'native' };
  } finally { await lease.close(); }
}
/** Register exact private customer files for the original MCP review; old selections remain retained. */
export async function registerMppCustomer({ directory, customer, file, label, expectedRevision, remove = false }) {
  const profile = await readMppProduct(directory), lease = await productLease(profile.directory);
  try {
    customer = alias(customer);
    const previous = await readProductCustomers(profile);
    need(Number.isSafeInteger(expectedRevision) && expectedRevision === previous.revision,
      'MPP_PRODUCT_CUSTOMER_REVISION_CHANGED', 'Reload the current customer selection before saving.');
    const next = structuredClone(previous);
    if (remove) {
      need(Object.hasOwn(next.customers, customer), 'MPP_PRODUCT_CUSTOMER_NOT_FOUND');
      delete next.customers[customer];
    } else {
      const bytes = await privateFile(fullPath(file), 2 * 1024 * 1024), configuration = decode(bytes);
      need(plain(configuration) && configuration.workspace === profile.workspaceDirectory &&
        configuration.dependencyRoot === profile.dependencyRoot, 'MPP_PRODUCT_CUSTOMER_CHANGED',
      'The original customer configuration must select this product’s workspace and native runtime.');
      const sha256 = digest(bytes), path = join(profile.customerFiles, sha256 + '.json');
      await writePrivate(path, bytes);
      next.customers[customer] = { label: displayName(label ?? customer), file: path, sha256 };
      if (stable(next.customers) === stable(previous.customers))
        return { schema: next.schema, revision: previous.revision, customer, state: 'REGISTERED', reused: true };
    }
    need(Object.keys(next.customers).length <= 32, 'MPP_PRODUCT_CUSTOMER_LIMIT');
    // Validate the complete original connection before publishing its new selector.
    const validation = join(profile.directory, '.customers-' + randomUUID() + '.json');
    try {
      await writePrivate(validation, connectionDefinition(profile, next));
      await (await import('../../stellar-forge/mcp-merchant-operator/mpp-config.mjs')).readMppConfiguration(validation);
    } finally { await unlink(validation).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    next.revision++;
    // A retained journal lets the same invocation recover a reply or process loss between the two files.
    const journal = { schema: 'stellar-forge.mpp-customer-selection-change.v1',
      previousRevision: previous.revision, next, customer, operationId: randomUUID() };
    const journalFile = join(profile.directory, 'customer-selection.pending.json');
    await writePrivate(journalFile, journal);
    await finishCustomerSelection(profile, journal);
    return { schema: next.schema, revision: next.revision, customer,
      state: remove ? 'REMOVED' : 'REGISTERED', reused: false };
  } finally { await lease.close(); }
}
async function finishCustomerSelection(profile, journal) {
  const current = await readProductCustomers(profile);
  need(current.revision === journal.previousRevision || stable(current) === stable(journal.next),
    'MPP_PRODUCT_CUSTOMER_REVISION_CHANGED');
  await writePrivate(profile.connection, connectionDefinition(profile, journal.next), true);
  await writePrivate(profile.customersFile, journal.next, true);
  await unlink(join(profile.directory, 'customer-selection.pending.json'));
}
export async function recoverMppProductSetup(directory) {
  const profile = await readMppProduct(directory, { validateOperator: false }), lease = await productLease(profile.directory);
  try {
    const journal = await readJSON(join(profile.directory, 'customer-selection.pending.json'), true);
    if (journal) {
      need(journal.schema === 'stellar-forge.mpp-customer-selection-change.v1' && plain(journal.next),
        'MPP_PRODUCT_SETUP_CONFLICT');
      await finishCustomerSelection(profile, journal);
    }
    return { ...await readMppProduct(directory), state: 'INITIALIZED', recovered: Boolean(journal) };
  } finally { await lease.close(); }
}
export async function configureMppProfile({ directory, kind, file, expectedRevision }) {
  const profile = await readMppProduct(directory), lease = await productLease(profile.directory);
  let native;
  try {
    need(['merchant', 'buyer', 'customer'].includes(kind), 'MPP_PRODUCT_PROFILE_KIND');
    const input = decode(await privateFile(fullPath(file), 2 * 1024 * 1024));
    const original = await import('../../stellar/scf-starforge-20261009/mpp-charge/config.mjs');
    const normalized = kind === 'merchant' ? original.merchantConfig(input) :
      kind === 'buyer' ? original.buyerConfig(input) :
      (await import('../../stellar/scf-starforge-20261009/mpp-charge/customer/workbench.mjs'))
        .customerWorkbenchProfile(input, profile.workspaceDirectory);
    const dependencyRoot = normalized.configuration?.dependencyRoot ?? normalized.dependencyRoot;
    need(dependencyRoot === profile.dependencyRoot, 'MPP_PRODUCT_RUNTIME_SELECTION_CHANGED');
    native = await openWorkspace(profile.workspaceDirectory);
    const result = await native.configure(kind, normalized, expectedRevision);
    return { schema: 'stellar-forge.mpp-profile-selection.v1', workspace: native.root, ...result,
      metadata: await native.metadata() };
  } finally { await native?.close(); await lease.close(); }
}
export async function inspectMppProduct(directory) {
  const profile = await readMppProduct(directory), native = await readNativeIdentity(profile.workspaceDirectory);
  const customers = await readProductCustomers(profile);
  const runtime = await inspectNativeSelection(profile.dependencyRoot);
  let session = await readJSON(profile.sessionFile, true), console;
  try {
    const { connectMppProduct } = await import('./client.mjs');
    const client = await connectMppProduct({ directory });
    try { console = { reachable: true, identity: await client.identity(), state: await client.state() }; }
    finally { await client.close(); }
  } catch (error) { console = { reachable: false, code: error.code ?? 'MPP_PRODUCT_UNAVAILABLE' }; }
  return { ...profile, native: { metadata: native.metadata }, runtime, customers, session, console };
}
/** One product owns the original console lease and drains the borrowed agent before that console. */
export async function openMppProduct({ directory, port = 0, mcpPort = 0, browserOnly = false,
  tokenEnv = 'MCP_ACCESS_TOKEN', environment = process.env, managedBindingSha256 } = {}) {
  let profile = await readMppProduct(directory);
  port = portNumber(port, 'Browser port'); mcpPort = portNumber(mcpPort, 'Agent port');
  need(typeof browserOnly === 'boolean', 'MPP_PRODUCT_OPTIONS_INVALID'); environmentName(tokenEnv);
  need(browserOnly || port === 0 || mcpPort === 0 || port !== mcpPort,
    'MPP_PRODUCT_PORT_INVALID', 'Choose separate browser and agent ports or use 0.');
  const lease = await productLease(profile.directory);
  let app, agent, launch, session, closing, closed = false, keepAlive;
  let appClosed = false, agentClosed = false, failure;
  const inspectLaunch = async () => {
    const value = await (await import('./managed.mjs')).inspectMppLaunch({
      directory: profile.directory, port, mcpPort, browserOnly, tokenEnv }, { environment });
    need(value.bindingSha256 === managedBindingSha256, 'MPP_PRODUCT_LAUNCH_CHANGED',
      'Review the current original native workspace, runtime and customer selection before starting.');
    return value;
  };
  const finish = async () => {
    if (closed) return;
    keepAlive ??= setInterval(() => {}, 1000);
    const errors = [];
    const attempt = async action => { try { await action(); } catch (error) { errors.push(error); } };
    if (session) await attempt(() => writePrivate(profile.sessionFile,
      { ...session, state: 'DRAINING', updatedAt: new Date().toISOString() }, true));
    if (agent && !agentClosed) await attempt(async () => { await agent.close(); agentClosed = true; });
    if ((!agent || agentClosed) && app && !appClosed)
      await attempt(async () => { await app.close(); appClosed = true; });
    if (!errors.length) await attempt(async () => {
      if (session) await writePrivate(profile.sessionFile, { ...session,
        state: failure ? 'FAILED' : 'CLOSED', stoppedAt: new Date().toISOString(),
        ...(failure ? { error: failure.code ?? 'MPP_PRODUCT_OPEN_FAILED' } : {}) }, true);
      await lease.close(); closed = true; clearInterval(keepAlive);
    });
    if (errors.length) throw Object.assign(new AggregateError(errors,
      'MPP product shutdown is still draining. Retry close on this same owner.'), {
      code: 'MPP_PRODUCT_CLOSE_PENDING', close });
  };
  const close = () => {
    if (closing) return closing;
    const attempt = finish(); closing = attempt;
    void attempt.catch(() => { if (closing === attempt) closing = undefined; });
    return attempt;
  };
  try {
    if (managedBindingSha256 !== undefined) { sha(managedBindingSha256); launch = await inspectLaunch(); profile = launch.profile; }
    session = { schema: MPP_PRODUCT_SESSION_SCHEMA, state: 'STARTING', directory: profile.directory,
      workspace: profile.workspaceDirectory, workspaceCreatedAt: profile.workspaceCreatedAt,
      pid: process.pid, ppid: process.ppid, startedAt: new Date().toISOString(),
      tokenEnv, browserOnly, ...(launch ? { bindingSha256: launch.bindingSha256, resourceId: launch.resourceId } : {}) };
    await writePrivate(profile.sessionFile, session, true);
    const nativeEnvironment = { ...environment, [CONSOLE_TOKEN_ENV]: randomBytes(32).toString('hex') };
    const { serveWorkspace } = await import('../../stellar/scf-starforge-20261009/mpp-charge/server.mjs');
    app = await serveWorkspace({ directory: profile.workspaceDirectory, port,
      tokenEnv: CONSOLE_TOKEN_ENV, environment: nativeEnvironment });
    const identity = await app.identity();
    need(identity.workspace === profile.workspaceDirectory && identity.createdAt === profile.workspaceCreatedAt &&
      identity.pid === process.pid && identity.ppid === process.ppid, 'MPP_PRODUCT_WORKSPACE_CHANGED');
    await writePrivate(profile.connection,
      connectionDefinition(profile, await readProductCustomers(profile), app.origin), true);
    if (!browserOnly) {
      const { startMerchantMcp } = await import('../../stellar-forge/mcp-merchant-operator/serve.mjs');
      agent = await startMerchantMcp({ configPath: profile.configuration, port: mcpPort,
        tokenEnv, environment: nativeEnvironment });
    }
    if (launch) await inspectLaunch();
    session = { ...session, state: 'OPEN', browserUrl: app.url, mcpUrl: agent?.url ?? null,
      console: 'native', versions, authorization: agent?.authorization ?? null };
    await writePrivate(profile.sessionFile, session, true);
    return { ...profile, ...session, ...(launch ? { launch } : {}), close };
  } catch (error) {
    failure = error;
    try { await close(); }
    catch (cleanup) { throw Object.assign(new AggregateError([error, cleanup], error.message),
      { code: 'MPP_PRODUCT_CLOSE_PENDING', close }); }
    throw error;
  }
}
