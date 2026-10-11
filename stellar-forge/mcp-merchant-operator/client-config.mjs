#!/usr/bin/env node
/** MIT. Register the original merchant operator in a local subprocess MCP host. */
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readMerchantConfig } from './config.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = message => Object.assign(new Error(message), { code: 'MCP_CLIENT_CONFIGURATION_ERROR' });
function absolutePath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\0\r\n]/.test(value))
    throw failure(label + ' must be an absolute local path.');
  return resolve(value);
}
export function merchantConfigurationPath(value) {
  return absolutePath(value, 'Merchant configuration');
}

/** Only the selected configuration path is added to the host's environment. */
export function createMerchantMcpClientConfiguration({
  configPath, name = 'starforge-merchant', nodePath = process.execPath,
  entryPath = fileURLToPath(new URL('./stdio.mjs', import.meta.url)),
  existingConfiguration = {},
} = {}) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ||
      ['constructor', 'prototype'].includes(name)) throw failure('Use a valid MCP server name.');
  if (!plain(existingConfiguration) || (existingConfiguration.mcpServers !== undefined &&
      !plain(existingConfiguration.mcpServers)))
    throw failure('Existing host configuration must contain an object mcpServers.');
  if (Object.hasOwn(existingConfiguration.mcpServers ?? {}, name))
    throw failure('That MCP server name already exists; choose an unused name.');
  const result = structuredClone(existingConfiguration);
  result.mcpServers = { ...(result.mcpServers ?? {}), [name]: {
    command: absolutePath(nodePath, 'Node executable'),
    args: [absolutePath(entryPath, 'MCP entry')],
    env: { MCP_MERCHANT_CONFIG: merchantConfigurationPath(configPath) },
  } };
  return result;
}

const HELP = `Starforge merchant MCP host configuration

  node client-config.mjs --config /absolute/merchant/merchant-mcp.json
    [--name SERVER_NAME] [--output NEW_PRIVATE_JSON]
    [--merge EXISTING_HOST_JSON --output NEW_PRIVATE_JSON]

Run on the machine that will launch the merchant. The existing configuration is
validated through the original merchant reader before registration. Generated
command and entry paths refer to this Node executable and installed source.
Output files are created with mode 0600. A merge writes a separate new file,
preserving all existing host settings and named servers.
`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(HELP); return;
  }
  const options = {}, allowed = new Set(['--config', '--name', '--merge', '--output']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed.has(key) || !value || value.startsWith('--') || Object.hasOwn(options, key))
      throw failure('Unknown, repeated or incomplete option. Use --help.');
    options[key] = value;
  }
  if (!options['--config']) throw failure('--config is required.');
  if (options['--merge'] && !options['--output'])
    throw failure('--merge requires a separate --output file.');
  if (options['--merge'] && resolve(options['--merge']) === resolve(options['--output']))
    throw failure('Choose a new output file for the merged configuration.');
  const configPath = merchantConfigurationPath(options['--config']);
  await readMerchantConfig(configPath);
  let existingConfiguration;
  if (options['--merge']) {
    const metadata = await lstat(options['--merge']);
    if (!metadata.isFile() || metadata.size > 1024 * 1024)
      throw failure('Existing host configuration must be a regular JSON file under 1 MiB.');
    const bytes = await readFile(options['--merge']);
    if (bytes.length > 1024 * 1024) throw failure('Existing host configuration exceeds 1 MiB.');
    existingConfiguration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const name = options['--name'] ?? 'starforge-merchant';
  const result = createMerchantMcpClientConfiguration({ configPath, name, existingConfiguration });
  if (options['--output']) {
    const filename = resolve(options['--output']);
    await writeFile(filename, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ file: filename, server: name }) + '\n');
  } else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    const message = error.code === 'MCP_CLIENT_CONFIGURATION_ERROR' ? error.message
      : `Unable to prepare merchant MCP registration (${error.code ?? 'CONFIGURATION_ERROR'}). Check the selected local files.`;
    process.stderr.write(message + '\n'); process.exitCode = 2;
  });
