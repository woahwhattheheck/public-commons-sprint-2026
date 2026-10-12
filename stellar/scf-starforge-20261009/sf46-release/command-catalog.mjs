// MIT. One original command map for portable and maintained-package installs.
import { relativePath, sha256 } from './release-core.mjs';
import { composeDistribution, contributionPaths } from '../distribution/specification.mjs';

const BASE = 'stellar/scf-starforge-20261009/';
export const CATALOG_PATH = BASE + 'distribution/distribution.json';
export const DOCTOR_PATH = BASE + 'distribution/cli.mjs';
const PORTABLE_ALIASES = {
  pilot: ['sf82-seller-pilot/pilot.mjs', 'Create or resume an OpenAPI seller pilot'],
  'pilot-ops': ['sf96-seller-pilot-ops/pilot-ops.mjs', 'Run the same pilot with operations and support capture'],
  'seller-check': ['sf96-seller-acceptance/audit.mjs', 'Inspect configured seller challenge routes'],
  'catalog-operator': ['sf60-durable-catalog-transaction/operator-cli.mjs', 'Operate the original live catalog'],
  deploy: ['sf99-merchant-deploy/cli.mjs', 'Generate the original HTTPS host deployment'],
};

export function compileCommandCatalog(catalogBytes, hasSource, { prefix = '', sourcePaths = [], readSource } = {}) {
  if (prefix && (!prefix.endsWith('/') || relativePath(prefix.slice(0, -1)) !== prefix.slice(0, -1)))
    throw new Error('Invalid command source prefix');
  // Both callers provide bytes already captured from the same Git tree or
  // verified package inventory. Never discover contributions in the live tree.
  const inputs = [{ path: CATALOG_PATH, bytes: catalogBytes }];
  const contributions = contributionPaths(sourcePaths).map(path => {
    if (!hasSource(path) || typeof readSource !== 'function')
      throw new Error('Original contribution source is required: ' + path);
    const bytes = readSource(path);
    if (typeof bytes !== 'string' && !Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array))
      throw new Error('Original contribution bytes are required: ' + path);
    inputs.push({ path, bytes });
    return { path, data: JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')) };
  });
  const base = JSON.parse(catalogBytes);
  const catalog = contributions.length ? composeDistribution({ base, contributions }).spec : base;
  if (catalog.schema !== 'stellar-forge.merchant-distribution.v1' || !catalog.commands ||
      typeof catalog.commands !== 'object' || Array.isArray(catalog.commands) || !Object.keys(catalog.commands).length)
    throw new Error('Invalid original command catalog');
  const commands = Object.create(null), aliases = [], preservedMappings = [];
  for (const [name, path] of Object.entries(catalog.commands)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || !hasSource(relativePath(path)) || !path.endsWith('.mjs'))
      throw new Error('Original catalog command is not packaged: ' + name);
    commands[name] = { path: prefix + path,
      summary: catalog.commandDescriptions?.[name] ?? 'Original native ' + name + ' command' };
  }
  for (const [name, [path, summary]] of Object.entries(PORTABLE_ALIASES)) {
    if (!hasSource(BASE + path)) continue;
    const selected = prefix + BASE + path;
    if (commands[name] && commands[name].path !== selected)
      preservedMappings.push({ name, catalogPath: commands[name].path, portablePath: selected });
    else if (!commands[name]) aliases.push(name);
    commands[name] = { path: selected, summary };
  }
  return { catalog, commands, commandCatalog: {
    path: prefix + CATALOG_PATH, sha256: sha256(catalogBytes),
    ...(contributions.length ? { inputs: inputs.map(({ path, bytes }) => ({
      path: prefix + path, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes),
    })) } : {}),
    commands: Object.keys(catalog.commands).length, aliases, preservedMappings,
  } };
}
