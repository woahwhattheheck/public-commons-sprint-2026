// MIT. Canonical PostgreSQL + original SF30 files; credentials never enter exports.
import { mkdir, mkdtemp, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePostgresQueries } from '../declaration.mjs';
import { compileSellerRoutes } from '../../resource-server.mjs';
import { WorkspaceInputError } from './plan.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const launcher = fileURLToPath(new URL('../start.mjs', import.meta.url));
const RUN = directory => `node ${quote(launcher)} --source ${quote(join(directory, 'source.json'))} --config ${quote(join(directory, 'service.json'))}`;
const PROFILE_FIELDS = ['maxConnections', 'poolSize', 'maxPending', 'connectTimeoutMs', 'idleTimeoutMs', 'lockTimeoutMs', 'startupTimeoutMs'];

/** Capture only public connection policy from a canonical, already-resolved declaration. */
export function workspaceProfile(declaration, connection) {
  const config = declaration.config, profile = { schema: 'stellar-forge.postgres-source.v1' };
  let ca;
  if (config.connectionEnv !== undefined) {
    profile.connectionEnv = config.connectionEnv;
    profile.tls = config.tls ?? 'verify-full';
    if (config.caFile !== undefined) { profile.caFile = 'ca.pem'; ca = connection.ssl?.ca; }
  } else {
    profile.connection = Object.fromEntries(['host', 'port', 'database', 'user', 'passwordEnv', 'tls']
      .filter(key => Object.hasOwn(config.connection ?? {}, key)).map(key => [key, config.connection[key]]));
    if (config.connection?.caFile !== undefined) { profile.connection.caFile = 'ca.pem'; ca = connection.ssl?.ca; }
  }
  for (const key of PROFILE_FIELDS) if (Object.hasOwn(config, key)) profile[key] = config[key];
  if ((profile.caFile || profile.connection?.caFile) && (typeof ca !== 'string' || !ca))
    throw new WorkspaceInputError('CANONICAL_CA_CONTENT_REQUIRED');
  return Object.freeze({ source: profile, ...(ca ? { ca } : {}) });
}

export async function buildMerchantPackage(plan, { profile } = {}) {
  if (!profile?.source || plan?.schema !== 'stellar-forge.postgres-merchant-plan.v1')
    throw new WorkspaceInputError('CANONICAL_SOURCE_PROFILE_REQUIRED');
  const { parameters, ...query } = plan.query;
  const source = { ...structuredClone(profile.source),
    queries: { [plan.queryName]: { ...query,
      parameterOrder: parameters.map(parameter => parameter.name),
      parameters: Object.fromEntries(parameters.map(({ name, ...spec }) => [name, spec])) } },
    bindings: { [plan.queryName]: { query: plan.queryName, input: 'query' } } };
  const seller = structuredClone(plan.seller);
  // The same compilers used on live launch must accept every package preview.
  try {
    compilePostgresQueries(source.queries);
    const origin = seller.publicOrigin ?? 'http://127.0.0.1:8423';
    compileSellerRoutes(seller.routes.map(route => ({ id: route.id,
      definition: { ...route.definition, url: origin + route.path }, handler: () => {}, admit: () => {} })),
      { allowLocalhost: !seller.publicOrigin });
  } catch { throw new WorkspaceInputError('CANONICAL_SELLER_DECLARATION_REJECTED'); }
  const guide = `# ${plan.queryName} PostgreSQL seller\n\n` +
    `This package was generated from ${JSON.stringify(plan.source.namespace + '.' + plan.source.name)} using PostgreSQL metadata and explicit operator choices.\n\n` +
    `## Run\n\nUse the same existing database credential environment as the workspace. From this package directory:\n\n` +
    '```sh\n' + RUN('.') + '\n```\n\n' +
    `The original seller listens on 127.0.0.1:8423 and its operations console on 127.0.0.1:8424. Developer documentation is at /_seller/docs and OpenAPI at /_seller/openapi.json.\n\n` +
    `Without --facilitator, the original seller serves HTTP 402 challenges. Add the original launcher's --facilitator HTTPS_URL option with your existing native SDK setup to enable payment handling. Use an operator-managed HTTPS proxy for the declared publicOrigin.\n\n` +
    `## Data contract\n\nOnly the explicit projected columns are returned. Optional filters use positional PostgreSQL parameters; omitting a filter leaves it unrestricted. This package is a capped ordered query, not a full-dataset export or automatic pagination. Include a unique key in the selected ordering if stable ordering matters. The adapter returns PostgreSQL text values and null, preserving integer and decimal precision.\n\n` +
    `Metadata examples describe parameter formats and were not sampled from table rows. Keep row access restrictions in the database role, approved views and database row policies. Request filters select results; they do not establish a customer's identity.\n\n` +
    `## Files\n\nsource.json is the canonical named-query adapter declaration. service.json is the original SF30 seller declaration. query.sql is a readable copy of the same fixed query. Keep them together. Connection passwords are absent; only environment names and public connection policy are exported. If a custom CA was selected, ca.pem preserves the resolved certificate bundle.\n`;
  return { source, seller, run: RUN('<EXPORTED_DIRECTORY>'), files: {
    'source.json': json(source), 'service.json': json(seller), 'query.sql': plan.query.sql + ';\n',
    'START.md': guide, ...(profile.ca ? { 'ca.pem': profile.ca } : {}),
  } };
}

/** A fresh 0700 directory per export; private files appear only after all writes succeed. */
export async function saveMerchantPackage(bundle, { outputRoot, queryName, planId } = {}) {
  if (typeof outputRoot !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(queryName ?? '') ||
      !/^[a-f0-9]{64}$/.test(planId ?? '')) throw new WorkspaceInputError('INVALID_EXPORT_DESTINATION');
  const absolute = resolve(outputRoot);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const root = await realpath(absolute);
  const stage = await mkdtemp(join(root, '.sf30-package-'));
  const directory = join(root, queryName + '-' + stage.split('.sf30-package-').at(-1));
  let reserved = false;
  try {
    for (const [name, content] of Object.entries(bundle.files)) {
      if (!['source.json', 'service.json', 'query.sql', 'START.md', 'ca.pem'].includes(name) || typeof content !== 'string')
        throw new WorkspaceInputError('INVALID_EXPORT_FILE');
      await writeFile(join(stage, name), content, { mode: 0o600, flag: 'wx' });
    }
    // Reserve the final name exclusively; POSIX rename may otherwise replace an
    // existing empty directory. Only the directory created here is replaced.
    await mkdir(directory, { mode: 0o700 }); reserved = true;
    await rename(stage, directory);
    return { schema: 'stellar-forge.postgres-workspace-export.v1', directory, planId,
      files: Object.keys(bundle.files), run: RUN(directory) };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    if (reserved) await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
