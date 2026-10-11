#!/usr/bin/env node
/** MIT. Prepare a portable host registration for the existing local MCP product. */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathValue = (value, field) => {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\0\r\n]/.test(value))
    throw new TypeError(field + ' must be an absolute local path');
  return value;
};
function discoveryValue(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search)
    throw new TypeError('Discovery must be an HTTP(S) base URL without credentials, query or fragment');
  return url.href;
}
function originValue(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.hash || url.search || url.pathname !== '/')
    throw new TypeError('Merchant allowlist entries must be exact HTTP(S) origins');
  return url.origin;
}

/** Only named public configuration is copied. Ambient credentials are never exported. */
export function createMcpClientConfiguration({
  name = 'stellar-forge', discoveryUrl, stateDirectory, allowedResourceOrigins = [],
  operatorModule = null, nodePath = process.execPath,
  entryPath = fileURLToPath(new URL('./stdio.mjs', import.meta.url)), existingConfiguration = {},
} = {}) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ||
      ['constructor', 'prototype'].includes(name)) throw new TypeError('Invalid MCP server name');
  if (!plain(existingConfiguration) || (existingConfiguration.mcpServers !== undefined &&
      !plain(existingConfiguration.mcpServers))) throw new TypeError('Existing host configuration must contain an object mcpServers');
  if (Object.hasOwn(existingConfiguration.mcpServers ?? {}, name))
    throw new TypeError('That MCP server name already exists; choose an unused name');
  if (!Array.isArray(allowedResourceOrigins)) throw new TypeError('Merchant origins must be an array');
  const env = {
    BAZAAR_DISCOVERY_URL: discoveryValue(discoveryUrl),
    MCP_STATE_DIR: pathValue(stateDirectory, 'State directory'),
    PAID_RESOURCE_ORIGINS: [...new Set(allowedResourceOrigins.map(originValue))].join(','),
    // Explicit empty value keeps an unrelated inherited host adapter out of a
    // search/preview registration. An approved adapter is selected by its path.
    MCP_OPERATOR_MODULE: operatorModule === null ? '' : pathValue(operatorModule, 'Operator module'),
  };
  const result = structuredClone(existingConfiguration);
  result.mcpServers = { ...(result.mcpServers ?? {}), [name]: {
    command: pathValue(nodePath, 'Node executable'), args: [pathValue(entryPath, 'MCP entry')], env,
  } };
  return result;
}

const help = `Stellar Forge MCP host configuration

  node client-config.mjs --discovery URL --state ABSOLUTE_DIRECTORY
    [--origin ORIGIN ...] [--operator ABSOLUTE_MODULE] [--name SERVER_NAME]
    [--merge EXISTING_HOST_JSON --output NEW_PRIVATE_JSON]
    [--output NEW_PRIVATE_JSON]

Run on the machine that will launch the server. Generated command and entry paths
refer to this installed Node and source/package. The output uses mcpServers with
command, args and env. A new file is created with mode 0600; existing files and
existing server registrations are preserved. A merge requires a separate output
file so unrelated host credentials stay in private local configuration.
`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(help); return;
  }
  const options = {}, origins = [];
  const allowed = new Set(['--discovery', '--state', '--origin', '--operator', '--name', '--merge', '--output']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed.has(key) || !value || value.startsWith('--') ||
        (key !== '--origin' && Object.hasOwn(options, key))) throw new TypeError('Invalid or repeated option');
    if (key === '--origin') origins.push(value); else options[key] = value;
  }
  if (!options['--discovery'] || !options['--state']) throw new TypeError('--discovery and --state are required');
  if (options['--merge'] && !options['--output']) throw new TypeError('--merge requires a separate --output file');
  let existingConfiguration;
  if (options['--merge']) {
    const metadata = await stat(options['--merge']);
    if (!metadata.isFile() || metadata.size > 1024 * 1024) throw new TypeError('Host configuration must be a JSON file under 1 MiB');
    existingConfiguration = JSON.parse(await readFile(options['--merge'], 'utf8'));
  }
  const name = options['--name'] ?? 'stellar-forge';
  const result = createMcpClientConfiguration({ name, discoveryUrl: options['--discovery'],
    stateDirectory: options['--state'], allowedResourceOrigins: origins,
    operatorModule: options['--operator'] ?? null, existingConfiguration });
  if (options['--output']) {
    const filename = resolve(options['--output']);
    await writeFile(filename, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ file: filename, server: name }) + '\n');
  } else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 2; });
