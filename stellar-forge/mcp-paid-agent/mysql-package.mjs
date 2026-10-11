// MIT. Retain an original MySQL merchant as a reviewed native paid MCP package.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { prepareMysqlRelease, stageMysqlRelease, inspectMysqlRelease }
  from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-mysql.mjs';
import { validateConfig } from '../../stellar/scf-starforge-20261009/native-facilitator/config.mjs';
import { compileDataToolDeclarations } from './data-tools.mjs';
import { validateTerms } from './paid-tool-server.mjs';

export const MYSQL_MCP_PLAN_SCHEMA = 'stellar-forge.mysql-data-mcp-plan.v1';
export const MYSQL_MCP_PACKAGE_SCHEMA = 'stellar-forge.mysql-data-mcp-package.v1';
const REVIEW_SCHEMA = 'stellar-forge.mysql-data-mcp-review.v1';
const CUSTOMER_SCHEMA = 'stellar-forge.mysql-data-mcp-customer.v1';
const SOURCE = 'mysql/package';
const FILE_LIMIT = 16 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
const normalize = value => Array.isArray(value) ? value.map(normalize) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const stable = value => JSON.stringify(normalize(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireValue = (value, code) => { if (!value) fail(code); };
const fields = (value, allowed, code) => requireValue(plain(value) &&
  Object.keys(value).every(key => allowed.includes(key)), code);
const descriptor = (file, value) => ({ file, bytes: value.length, sha256: hash(value) });
const ordered = files => files.sort((a, b) => a.file.localeCompare(b.file));
const SERVER_FIELDS = ['host', 'port', 'path', 'publicEndpoint', 'name', 'version',
  'maxSessions', 'sessionIdleMs', 'maxInFlight', 'maxRequestBytes', 'maxResultBytes', 'enableJsonResponse'];

async function snapshot(path, maximum = FILE_LIMIT) {
  const absolute = resolve(path);
  requireValue(await realpath(absolute) === absolute, 'MYSQL_MCP_CANONICAL_FILE_REQUIRED');
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    requireValue(before.isFile() && before.size <= BigInt(maximum), 'MYSQL_MCP_FILE_LIMIT');
    const bytes = Buffer.alloc(Number(before.size) + 1); let used = 0;
    while (used < bytes.length) {
      const part = await file.read(bytes, used, bytes.length - used, null);
      if (!part.bytesRead) break;
      used += part.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    requireValue(BigInt(used) === before.size && after.size === before.size &&
      after.mtimeNs === before.mtimeNs, 'MYSQL_MCP_FILE_CHANGED');
    return bytes.subarray(0, used);
  } finally { await file.close(); }
}
async function put(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function requiredPath(value) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    !/[\0\r\n]/.test(value), 'MYSQL_MCP_PATH_REQUIRED');
  return resolve(value);
}
function endpointFor(server) {
  fields(server, SERVER_FIELDS, 'MYSQL_MCP_SERVER_FIELDS_INVALID');
  requireValue(typeof server.publicEndpoint === 'string' && server.publicEndpoint.length <= 4096,
    'MYSQL_MCP_PUBLIC_ENDPOINT_REQUIRED');
  let endpoint;
  try { endpoint = new URL(server.publicEndpoint); } catch { fail('MYSQL_MCP_PUBLIC_ENDPOINT_INVALID'); }
  requireValue(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash &&
    endpoint.pathname === (server.path ?? '/mcp') && (endpoint.protocol === 'https:' ||
      endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)),
    'MYSQL_MCP_PUBLIC_ENDPOINT_INVALID');
  return endpoint;
}
function publicTool(tool) {
  return { routeId: tool.routeId, name: tool.name, description: tool.description,
    resource: 'mcp://tool/' + tool.name, inputSchema: copy(tool.inputSchema),
    ...(tool.example === undefined ? {} : { example: copy(tool.example) }),
    accepts: copy(tool.accepts), annotations: copy(tool.annotations) };
}
function customerFor(review) {
  const endpoint = new URL(review.server.publicEndpoint);
  return { schema: CUSTOMER_SCHEMA, provider: 'mysql', transport: 'streamable-http',
    endpoint: endpoint.href, discoveryUrl: new URL('/discovery/search', endpoint).href,
    sourceSemantics: review.sourceSemantics, packageManifestSha256: review.packageManifestSha256,
    sourceExecutionSha256: review.sourceExecutionSha256, reviewId: review.reviewId,
    tools: review.tools.map(({ originalHttpAccepts, ...tool }) => copy(tool)) };
}
function customerReadme(customer) {
  const origin = new URL(customer.endpoint).origin, tick = '\u0060', fence = tick.repeat(3);
  const examples = customer.tools.map(tool => ({ name: tool.name, arguments: tool.example ?? {},
    inputSchema: tool.inputSchema, accepts: tool.accepts }));
  return [
    '# MySQL data tools', '',
    'This handoff describes the approved tools at ' + customer.endpoint + '.',
    'The original MySQL merchant executes its named read queries. Callers provide the declared arguments.',
    'Rows remain live database reads; the retained package fixes the queries, schemas and payment alternatives.', '',
    '## Connect and review', '',
    '- Transport: Streamable HTTP MCP.',
    '- Discovery: ' + customer.discoveryUrl,
    '- Allowed paid origin: ' + origin,
    '- Tool declarations and complete payment alternatives: ' + tick + 'mcp.json' + tick + '.',
    '- Source package: ' + tick + customer.packageManifestSha256 + tick + '.',
    '- Reviewed MCP configuration: ' + tick + customer.reviewId + tick + '.', '',
    'Use the existing Starforge MCP buyer with its own private operator module, payer and durable state.',
    'Set ' + tick + 'BAZAAR_DISCOVERY_URL' + tick + ' to ' + origin + ' and ' +
      tick + 'PAID_RESOURCE_ORIGINS' + tick + ' to that same approved origin.',
    'The operator supplies ' + tick + 'MCP_OPERATOR_MODULE' + tick + ', ' + tick + 'MCP_STATE_DIR' + tick +
      ' and its private access token when starting ' + tick + 'starforge mcp-buyer' + tick + '.', '',
    '1. Call bazaar_search, then bazaar_describe on the returned handle.',
    '2. Select the advertised payment alternative and call bazaar_preview with the declared arguments.',
    '3. Execute the retained quote through bazaar_execute_approved; the trusted operator approves the purchase.',
    '4. Read bazaar_status and bazaar_results. Use bazaar_read_result for complete retained result bytes.',
    '5. Reopen the same buyer state directory to inspect or export the original result and receipt.', '',
    'The existing buyer retains its original once-per-quote signed dispatch and outcome reconciliation.',
    'Native x402 payment metadata and the original query result remain together in the saved MCP result.', '',
    '## Approved tool examples', '',
    'These are the merchant examples, or an empty object when it supplied none. The input schema controls required fields.', '',
    fence + 'json', JSON.stringify(examples, null, 2), fence, '',
    '## Original guides', '',
    '- [Native MCP buyer and operator](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/mcp-paid-agent/REMOTE_MCP.md)',
    '- [Complete result inbox and export](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/mcp-paid-agent/RESULTS.md)',
    '- [MySQL preparation and operation](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/mcp-paid-agent/MYSQL_PACKAGES.md)', '',
  ].join('\n');
}

async function inputs({ packageDirectory, planFile }) {
  const sourceDirectory = requiredPath(packageDirectory), planPath = requiredPath(planFile);
  const prepared = await prepareMysqlRelease(sourceDirectory);
  const planBytes = await snapshot(planPath, 262144), plan = parse(planBytes);
  fields(plan, ['schema', 'facilitatorFile', 'tools', 'server'], 'MYSQL_MCP_PLAN_FIELDS_INVALID');
  requireValue(plan.schema === MYSQL_MCP_PLAN_SCHEMA, 'MYSQL_MCP_PLAN_SCHEMA_INVALID');
  requireValue(typeof plan.facilitatorFile === 'string' && plan.facilitatorFile.length > 0 &&
    plan.facilitatorFile.length <= 4096 && !/[\0\r\n]/.test(plan.facilitatorFile), 'MYSQL_MCP_FACILITATOR_FILE_REQUIRED');
  requireValue(Array.isArray(plan.tools) && plan.tools.length > 0 && plan.tools.length <= 32 &&
    plan.tools.every(tool => plain(tool) && Array.isArray(tool.accepts) && tool.accepts.length > 0),
    'MYSQL_MCP_EXPLICIT_NATIVE_TERMS_REQUIRED');
  const endpoint = endpointFor(plan.server);
  const facilitatorBytes = await snapshot(resolve(dirname(planPath), plan.facilitatorFile), 65536);
  const policy = validateConfig(parse(facilitatorBytes));
  const sourceBytes = await snapshot(join(prepared.directory, 'source.json'), 262144);
  requireValue(hash(sourceBytes) === prepared.manifest.files['source.json'].sha256 &&
    sourceBytes.length === prepared.manifest.files['source.json'].bytes, 'MYSQL_MCP_SOURCE_CHANGED');
  const source = parse(sourceBytes);
  const declarations = compileDataToolDeclarations({ description: prepared.mysql.queries,
    serviceConfig: prepared.service, bindings: source.bindings, selections: plan.tools });
  const tools = declarations.map(tool => ({ ...tool,
    accepts: tool.accepts.map(terms => validateTerms(terms, policy)) }));
  const retainedPlan = { schema: MYSQL_MCP_PLAN_SCHEMA, facilitatorFile: 'facilitator.json',
    tools: tools.map(tool => ({ routeId: tool.routeId, name: tool.name, accepts: copy(tool.accepts) })),
    server: { ...copy(plan.server), publicEndpoint: endpoint.href } };
  const contract = { packageManifestSha256: prepared.mysql.packageManifestSha256,
    sourceExecutionSha256: prepared.mysql.executionSha256, sourceSemantics: prepared.mysql.sourceSemantics,
    facilitatorConfigSha256: hash(facilitatorBytes), tools: tools.map(publicTool), server: retainedPlan.server };
  const review = { schema: REVIEW_SCHEMA, reviewId: hash(stable(contract)), ...contract,
    originalPlanSha256: hash(planBytes),
    requiredEnvironment: [...new Set([...(prepared.mysql.credentialReferences ?? []),
      ...policy.signers.map(signer => signer.secretEnv), ...(policy.feeBumpSigner ? [policy.feeBumpSigner.secretEnv] : [])])].sort(),
    facilitator: copy(policy),
    tools: tools.map(tool => ({ ...publicTool(tool), originalHttpAccepts:
      copy(prepared.service.routes.find(route => route.id === tool.routeId).offer.accepts) })) };
  const config = { schema: 'stellar-forge.data-mcp.v1', provider: 'mysql',
    preparedDirectory: SOURCE, facilitatorFile: 'facilitator.json', tools: retainedPlan.tools, server: retainedPlan.server };
  return { prepared, planBytes, facilitatorBytes, retainedPlan, config, review, customer: customerFor(review) };
}

/** Uses the original source compiler and native terms policy; opens no database or signer. */
export async function reviewMysqlMcpPackage(options) {
  return (await inputs(options)).review;
}

// Retain the descriptor lock across publication, as the original MySQL workspace does.
// A process exit releases the lock without consuming the final package directory.
async function publicationLease(destination) {
  const path = join(dirname(destination), '.' + basename(destination) + '.mysql-mcp.lock');
  const handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  const assert = async () => {
    const [opened, named] = await Promise.all([handle.stat(), lstat(path)]);
    requireValue(opened.isFile() && named.isFile() && !named.isSymbolicLink() && opened.nlink === 1 &&
      !(opened.mode & 0o077) && opened.dev === named.dev && opened.ino === named.ino, 'MYSQL_MCP_PREPARATION_LEASE_LOST');
  };
  try {
    await assert();
    const lock = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
      { stdio: ['ignore', 'ignore', 'ignore', handle.fd] });
    requireValue(lock.status !== 73, 'MYSQL_MCP_PREPARATION_ACTIVE');
    requireValue(!lock.error && lock.status === 0, 'MYSQL_MCP_PREPARATION_LOCK_UNAVAILABLE');
    await assert();
    return { assert, close: () => handle.close() };
  } catch (issue) { await handle.close(); throw issue; }
}
async function absent(path) {
  try { await lstat(path); } catch (issue) { if (issue.code === 'ENOENT') return; throw issue; }
  fail('MYSQL_MCP_DESTINATION_EXISTS');
}

/** Publish one complete private directory from original declared package bytes. */
export async function prepareMysqlMcpPackage({ packageDirectory, planFile, directory, expectedReviewId } = {}) {
  const selected = await inputs({ packageDirectory, planFile }), destination = requiredPath(directory);
  requireValue(expectedReviewId === undefined || /^[a-f0-9]{64}$/.test(expectedReviewId) &&
    expectedReviewId === selected.review.reviewId, 'MYSQL_MCP_REVIEW_CHANGED');
  const parent = dirname(destination);
  requireValue(parent !== destination && await realpath(parent) === parent, 'MYSQL_MCP_CANONICAL_PARENT_REQUIRED');
  const within = relative(selected.prepared.directory, destination);
  requireValue(within && (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)),
    'MYSQL_MCP_DESTINATION_INSIDE_SOURCE');
  const lease = await publicationLease(destination);
  let stage, captured = false, committed = false;
  try {
    await absent(destination);
    stage = join(parent, '.' + basename(destination) + '.prepare-' + randomUUID());
    const retained = await stageMysqlRelease(stage, selected.prepared.directory); captured = true;
    requireValue(retained.mysql.packageManifestSha256 === selected.review.packageManifestSha256 &&
      retained.mysql.executionSha256 === selected.review.sourceExecutionSha256, 'MYSQL_MCP_SOURCE_CHANGED');
    await mkdir(join(stage, 'customer'), { mode: 0o700 });
    const additions = [
      ['data-mcp.json', encode(selected.config)], ['facilitator.json', selected.facilitatorBytes],
      ['mysql-mcp-plan.json', encode(selected.retainedPlan)], ['authoring-plan.json', selected.planBytes],
      ['customer/mcp.json', encode(selected.customer)],
      ['customer/README.md', Buffer.from(customerReadme(selected.customer))],
    ];
    for (const [name, bytes] of additions) await put(join(stage, name), bytes);
    const manifest = { schema: MYSQL_MCP_PACKAGE_SCHEMA, createdAt: new Date().toISOString(),
      reviewId: selected.review.reviewId, originalPlanSha256: selected.review.originalPlanSha256,
      packageManifestSha256: selected.review.packageManifestSha256,
      sourceExecutionSha256: selected.review.sourceExecutionSha256,
      files: ordered([...retained.files, ...additions.map(([name, bytes]) => descriptor(name, bytes))]) };
    await put(join(stage, 'mcp-package.json'), encode(manifest));
    await syncDirectory(join(stage, 'customer')); await syncDirectory(stage);
    const inspected = await inspectMysqlMcpPackage(stage);
    requireValue(inspected.review.reviewId === selected.review.reviewId, 'MYSQL_MCP_REVIEW_CHANGED');
    await lease.assert(); await absent(destination);
    await rename(stage, destination); committed = true; await syncDirectory(parent);
    return { directory: destination, configFile: join(destination, 'data-mcp.json'),
      customerDirectory: join(destination, 'customer'), manifest,
      review: { ...inspected.review, originalPlanSha256: manifest.originalPlanSha256 } };
  } finally {
    if (captured && !committed) await rm(stage, { recursive: true, force: true });
    await lease.close();
  }
}

/** Reopen the retained source, native plan and customer handoff through their original validators. */
export async function inspectMysqlMcpPackage(directory) {
  const root = requiredPath(directory), info = await lstat(root);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    await realpath(root) === root, 'MYSQL_MCP_PRIVATE_DIRECTORY_REQUIRED');
  const manifestBytes = await snapshot(join(root, 'mcp-package.json'), 2 * 1024 * 1024);
  const manifest = parse(manifestBytes);
  fields(manifest, ['schema', 'createdAt', 'reviewId', 'originalPlanSha256', 'packageManifestSha256',
    'sourceExecutionSha256', 'files'], 'MYSQL_MCP_PACKAGE_FIELDS_INVALID');
  requireValue(manifest.schema === MYSQL_MCP_PACKAGE_SCHEMA && Array.isArray(manifest.files) &&
    manifest.files.length > 0 && manifest.files.length <= 256 &&
    typeof manifest.createdAt === 'string' && Number.isFinite(Date.parse(manifest.createdAt)) &&
    ['reviewId', 'originalPlanSha256', 'packageManifestSha256', 'sourceExecutionSha256']
      .every(key => /^[a-f0-9]{64}$/.test(manifest[key] ?? '')), 'MYSQL_MCP_PACKAGE_MANIFEST_INVALID');
  const retained = await inspectMysqlRelease(root);
  const selected = await inputs({ packageDirectory: join(root, SOURCE), planFile: join(root, 'mysql-mcp-plan.json') });
  const additions = ['data-mcp.json', 'facilitator.json', 'mysql-mcp-plan.json', 'authoring-plan.json',
    'customer/mcp.json', 'customer/README.md'];
  const expectedNames = [...retained.files.map(entry => entry.file), ...additions].sort();
  requireValue(manifest.files.every(entry => plain(entry) &&
    Object.keys(entry).length === 3 && typeof entry.file === 'string' &&
    Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= FILE_LIMIT &&
    /^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) &&
    stable(manifest.files.map(entry => entry.file).sort()) === stable(expectedNames) &&
    manifest.reviewId === selected.review.reviewId &&
    manifest.packageManifestSha256 === retained.mysql.packageManifestSha256 &&
    manifest.sourceExecutionSha256 === retained.mysql.executionSha256, 'MYSQL_MCP_RETAINED_CONTRACT_CHANGED');
  const entries = new Map(manifest.files.map(entry => [entry.file, entry]));
  for (const entry of retained.files)
    requireValue(stable(entries.get(entry.file)) === stable(entry), 'MYSQL_MCP_RETAINED_SOURCE_CHANGED');
  const saved = new Map();
  for (const name of additions) {
    const bytes = await snapshot(join(root, name));
    requireValue(stable(entries.get(name)) === stable(descriptor(name, bytes)), 'MYSQL_MCP_RETAINED_FILE_CHANGED');
    saved.set(name, bytes);
  }
  requireValue(hash(saved.get('authoring-plan.json')) === manifest.originalPlanSha256 &&
    saved.get('facilitator.json').equals(selected.facilitatorBytes) &&
    stable(parse(saved.get('data-mcp.json'))) === stable(selected.config) &&
    stable(parse(saved.get('mysql-mcp-plan.json'))) === stable(selected.retainedPlan) &&
    stable(parse(saved.get('customer/mcp.json'))) === stable(selected.customer),
    'MYSQL_MCP_RETAINED_PLAN_CHANGED');
  // The completion keeps the original customer prose bytes through later software upgrades.
  new TextDecoder('utf-8', { fatal: true }).decode(saved.get('customer/README.md'));
  // Reuse the original launcher parser for the actual retained provider configuration.
  const { readDataMcpConfig } = await import('./data-serve.mjs');
  const config = await readDataMcpConfig(join(root, 'data-mcp.json'));
  requireValue(config.provider === 'mysql' && config.preparedDirectory === join(root, SOURCE) &&
    config.facilitatorFile === join(root, 'facilitator.json'), 'MYSQL_MCP_LAUNCH_CONFIGURATION_CHANGED');
  return { directory: root, configFile: join(root, 'data-mcp.json'), customerDirectory: join(root, 'customer'),
    manifest, manifestSha256: hash(manifestBytes),
    review: { ...selected.review, originalPlanSha256: manifest.originalPlanSha256 }, customer: selected.customer };
}

/** The existing paid data launcher owns source admission, native settlement and drain. */
export async function startMysqlMcpPackage(directory, { environment = process.env } = {}) {
  const retained = await inspectMysqlMcpPackage(directory);
  const { startDataMcpFile } = await import('./data-serve.mjs');
  const server = await startDataMcpFile(retained.configFile, { environment });
  try {
    requireValue((await inspectMysqlMcpPackage(directory)).manifestSha256 === retained.manifestSha256,
      'MYSQL_MCP_PACKAGE_CHANGED_DURING_START');
    return { ...server, mysqlPackage: { reviewId: retained.review.reviewId,
      manifestSha256: retained.manifestSha256, packageManifestSha256: retained.manifest.packageManifestSha256,
      sourceSemantics: retained.review.sourceSemantics } };
  } catch (issue) { await server.close(); throw issue; }
}

const HELP = 'Reviewed MySQL native paid MCP package (Node 22.16+, Linux flock)\n' +
  '  mysql review --package PREPARED_MYSQL --plan mysql-mcp-plan.json\n' +
  '  mysql prepare --package PREPARED_MYSQL --plan mysql-mcp-plan.json --directory NEW_PRIVATE_DIRECTORY [--review SHA256]\n' +
  '  mysql inspect --directory PRIVATE_DIRECTORY\n' +
  '  mysql run --directory PRIVATE_DIRECTORY\n' +
  'review, prepare and inspect use the original source and native terms validators without database or signer access.';

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { process.stdout.write(HELP + '\n'); return; }
  const command = args[0], options = new Map();
  const allowed = { review: ['--package', '--plan'], prepare: ['--package', '--plan', '--directory', '--review'],
    inspect: ['--directory'], run: ['--directory'] };
  requireValue(Object.hasOwn(allowed, command), 'MYSQL_MCP_COMMAND_INVALID');
  for (let i = 1; i < args.length; i += 2) {
    requireValue(allowed[command].includes(args[i]) && !options.has(args[i]) && typeof args[i + 1] === 'string' &&
      args[i + 1].length > 0 && !args[i + 1].startsWith('--'), 'MYSQL_MCP_OPTION_INVALID');
    options.set(args[i], args[i + 1]);
  }
  for (const flag of allowed[command].filter(flag => flag !== '--review'))
    requireValue(options.has(flag), 'MYSQL_MCP_REQUIRED_OPTION_MISSING');
  let result;
  if (command === 'review') result = await reviewMysqlMcpPackage({
    packageDirectory: options.get('--package'), planFile: options.get('--plan') });
  else if (command === 'prepare') result = await prepareMysqlMcpPackage({
    packageDirectory: options.get('--package'), planFile: options.get('--plan'),
    directory: options.get('--directory'), expectedReviewId: options.get('--review') });
  else if (command === 'inspect') result = await inspectMysqlMcpPackage(options.get('--directory'));
  else {
    const server = await startMysqlMcpPackage(options.get('--directory'));
    let stopping;
    const close = () => stopping ??= server.close().finally(() => {
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    });
    const stop = () => void close().then(
      value => process.stdout.write(JSON.stringify({ state: 'CLOSED', drained: value.drained }) + '\n'),
      () => { process.stderr.write('MYSQL_MCP_DRAIN_FAILED\n'); process.exitCode = 1; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    process.stdout.write(JSON.stringify({ mode: 'NATIVE_PAID_DATA_MCP', endpoint: server.endpoint,
      discoveryUrl: server.discoveryUrl, tools: server.tools().map(tool => tool.name),
      source: server.sourceStatus(), mysqlPackage: server.mysqlPackage }) + '\n');
    return { ...server, close };
  }
  process.stdout.write(JSON.stringify(result) + '\n'); return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    process.stderr.write((/^[A-Z][A-Z0-9_]{0,127}$/.test(issue?.code ?? '') ? issue.code : 'MYSQL_MCP_OPERATION_FAILED') + '\n');
    process.exitCode = 1;
  });
