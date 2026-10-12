#!/usr/bin/env node
/** MIT. Configure and receive an existing Stellar Forge OAuth MCP deployment. */
import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { validateOAuthResourceConfig, resourceMetadataLocation, createOAuthResourceAuthorization } from './oauth-resource.mjs';
import { discoverOAuthResource, probeOAuthResource, OAuthOperatorError } from './oauth-discovery.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const optionSets = {
  init: ['resource', 'issuer', 'jwks', 'subject', 'scope', 'tool-scope', 'algorithm', 'token-type', 'scope-claim', 'output'],
  describe: ['config', 'output'],
  discover: ['config', 'resource', 'issuer', 'trusted-origin', 'timeout-ms', 'max-bytes', 'output'],
  probe: ['config', 'token-env', 'token-file', 'timeout-ms', 'max-bytes', 'max-pages', 'output'],
  'client-config': ['config', 'name', 'merge', 'output'],
};
const repeated = new Set(['subject', 'scope', 'tool-scope', 'algorithm', 'token-type', 'trusted-origin']);

/** Read from one opened regular file, counting bytes even if it grows. */
async function readSelectedFile(filename, { limit = 1024 * 1024, privateMode = false } = {}) {
  const handle = await open(resolve(filename), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > limit) throw new TypeError('Selected file must be a regular file within the byte limit');
    if (privateMode && process.platform !== 'win32' && (metadata.mode & 0o077))
      throw new TypeError('Token file must have owner-only permissions; set mode 0600 before selecting it');
    const chunks = []; let size = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(16384, limit + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw new TypeError('Selected file exceeds the byte limit');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } finally { await handle.close(); }
}
async function readJson(filename) {
  const contents = await readSelectedFile(filename);
  try { return JSON.parse(contents); } catch { throw new TypeError('Selected configuration is not valid JSON'); }
}

/** Private atomic no-replace publication; unrelated output files are never modified. */
export async function writeNewOAuthJson(filename, value) {
  const destination = resolve(filename), temporary = resolve(dirname(destination), '.' + basename(destination) + '.' + randomUUID() + '.tmp');
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  let handle, ownTemporary = false;
  try {
    handle = await open(temporary, 'wx', 0o600); ownTemporary = true;
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    await link(temporary, destination);
    await unlink(temporary); ownTemporary = false;
    return { file: destination, bytes: bytes.length, sha256: hash(bytes) };
  } finally {
    if (handle) await handle.close();
    if (ownTemporary) await unlink(temporary).catch(() => {});
  }
}

export function createOAuthClientConfiguration({ config, name = 'stellar-forge', existingConfiguration = {} } = {}) {
  const normalized = validateOAuthResourceConfig(config);
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name))
    throw new TypeError('Claude Code server name must use 1–64 letters, numbers, hyphens or underscores');
  if (!plain(existingConfiguration) || existingConfiguration.mcpServers !== undefined && !plain(existingConfiguration.mcpServers))
    throw new TypeError('Existing Claude Code configuration must contain an object mcpServers');
  if (Object.hasOwn(existingConfiguration.mcpServers ?? {}, name))
    throw new TypeError('That server name already exists; select an unused name');
  const result = structuredClone(existingConfiguration);
  result.mcpServers = { ...(result.mcpServers ?? {}), [name]: { type: 'http', url: normalized.resource } };
  return result;
}

export function createOAuthOperatorConfiguration({ resource, issuer, jwksUri, subjects, scopes = ['mcp:read'],
  toolScopes = {}, algorithms = ['RS256'], tokenTypes = ['at+jwt'], scopeClaim = 'scope' } = {}) {
  if (!Array.isArray(subjects) || !subjects.length || subjects.some(subject => typeof subject !== 'string' || !subject))
    throw new TypeError('Select at least one exact issuer subject for the original single-workspace service');
  return validateOAuthResourceConfig({ schema: 'stellar-forge.mcp-oauth-resource.v1', resource,
    authorizationServers: [{ issuer, jwksUri, algorithms, tokenTypes, scopeClaim, allowedSubjects: subjects }],
    requiredScopes: scopes, toolScopes });
}

function parseOptions(command, args) {
  const allowed = new Set(optionSets[command]);
  if (!optionSets[command]) throw new TypeError('Unknown command; use --help');
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, ''), value = args[index + 1];
    if (!args[index]?.startsWith('--') || !allowed.has(key) || value === undefined || value === '' || value.startsWith('--') ||
        Object.hasOwn(options, key) && !repeated.has(key)) throw new TypeError('Invalid, missing or repeated command option');
    if (repeated.has(key)) (options[key] ??= []).push(value); else options[key] = value;
  }
  return options;
}
function required(options, name) {
  if (!options[name]) throw new TypeError('--' + name + ' is required');
  return options[name];
}
function integerOption(options, name) {
  if (options[name] === undefined) return undefined;
  if (!/^\d+$/.test(options[name])) throw new TypeError('--' + name + ' must be an integer');
  return Number(options[name]);
}
function networkOptions(options) {
  return {
    ...(options['trusted-origin'] ? { trustedOrigins: options['trusted-origin'] } : {}),
    ...(options['timeout-ms'] ? { timeoutMs: integerOption(options, 'timeout-ms') } : {}),
    ...(options['max-bytes'] ? { maxBytes: integerOption(options, 'max-bytes') } : {}),
  };
}
function selectedToolScopes(entries = []) {
  const result = Object.create(null);
  for (const entry of entries) {
    const separator = entry.indexOf('='), name = entry.slice(0, separator), scopes = entry.slice(separator + 1).split(',');
    if (separator <= 0 || !/^[-A-Za-z0-9_.]{1,128}$/.test(name) || scopes.some(scope => !scope))
      throw new TypeError('--tool-scope must use TOOL=SCOPE[,SCOPE]');
    result[name] = [...new Set([...(result[name] ?? []), ...scopes])];
  }
  return result;
}

const help = `Stellar Forge OAuth MCP operator

  node oauth-resource-cli.mjs init --resource HTTPS_MCP_URL --issuer EXACT_ISSUER
    --jwks HTTPS_JWKS_URL --subject EXACT_SUBJECT [--subject EXACT_SUBJECT ...]
    [--scope SCOPE ...] [--tool-scope TOOL=SCOPE[,SCOPE] ...]
    [--algorithm ALG ...] [--token-type TYPE ...] [--scope-claim CLAIM]
    --output NEW_PRIVATE_CONFIG

  node oauth-resource-cli.mjs describe --config CONFIG [--output NEW_REPORT]

  node oauth-resource-cli.mjs discover (--config CONFIG | --resource HTTPS_MCP_URL)
    [--issuer EXACT_ISSUER] [--trusted-origin EXACT_HTTPS_ORIGIN ...]
    [--timeout-ms INTEGER] [--max-bytes INTEGER] [--output NEW_REPORT]

  node oauth-resource-cli.mjs probe --config CONFIG
    (--token-env ENVIRONMENT_VARIABLE_NAME | --token-file PRIVATE_TOKEN_FILE)
    [--timeout-ms INTEGER] [--max-bytes INTEGER] [--max-pages INTEGER]
    [--output NEW_REPORT]

  node oauth-resource-cli.mjs client-config --config CONFIG [--name SERVER_NAME]
    [--merge EXISTING_CLAUDE_CONFIG] --output NEW_PRIVATE_CLAUDE_CONFIG

init defaults: RS256, at+jwt, scope claim "scope", baseline "mcp:read".
Choose these from the provider's access-token configuration. The HTTP service
uses an existing OAuth issuer; this tool does not create an authorization server.

Discovery sends no credentials. Public metadata uses the existing SF31 guarded
HTTPS transport. --trusted-origin explicitly permits a selected HTTPS private or
custom-port metadata origin. No redirects are followed. Probe sends its opaque
token only to the exact configured MCP resource and receives all tools/list pages.
The supported MCP transport protocol remains 2025-11-25.

Every output is a new mode-0600 file. A merge preserves other registrations and
credentials and requires a separate output. Token values are never command-line
arguments or report fields. A token file may end with one LF or CRLF; all other
whitespace is rejected. See OAUTH_RESOURCE.md for the complete deployment flow.
`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(help); return; }
  const [command, ...rest] = args, options = parseOptions(command, rest);
  let result;
  if (command === 'init') {
    required(options, 'output');
    result = createOAuthOperatorConfiguration({ resource: required(options, 'resource'), issuer: required(options, 'issuer'),
      jwksUri: required(options, 'jwks'), subjects: required(options, 'subject'), scopes: options.scope,
      toolScopes: selectedToolScopes(options['tool-scope']), algorithms: options.algorithm,
      tokenTypes: options['token-type'], scopeClaim: options['scope-claim'] });
  } else if (command === 'describe') {
    const config = validateOAuthResourceConfig(await readJson(required(options, 'config')));
    const authorizer = createOAuthResourceAuthorization(config);
    try { result = authorizer.describe(); } finally { await authorizer.close(); }
  } else if (command === 'discover') {
    if (Boolean(options.config) === Boolean(options.resource)) throw new TypeError('Select exactly one of --config or --resource');
    let resource = options.resource, issuer = options.issuer, expectedAuthorizationServer;
    if (options.config) {
      const config = validateOAuthResourceConfig(await readJson(options.config));
      resource = config.resource;
      issuer ??= config.authorizationServers.length === 1 ? config.authorizationServers[0].issuer : undefined;
      if (issuer) {
        expectedAuthorizationServer = config.authorizationServers.find(server => server.issuer === issuer);
        if (!expectedAuthorizationServer) throw new TypeError('Selected issuer is not in the explicit resource configuration');
      }
    }
    result = await discoverOAuthResource({ resource, issuer, expectedAuthorizationServer, ...networkOptions(options) });
    if (!result.compatible) process.exitCode = 2;
  } else if (command === 'probe') {
    const config = validateOAuthResourceConfig(await readJson(required(options, 'config')));
    if (Boolean(options['token-env']) === Boolean(options['token-file'])) throw new TypeError('Select exactly one token environment variable or token file');
    let token;
    if (options['token-env']) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options['token-env'])) throw new TypeError('--token-env requires an environment variable name');
      token = process.env[options['token-env']];
    } else {
      token = (await readSelectedFile(options['token-file'], { limit: config.maxTokenBytes + 2, privateMode: true })).replace(/\r?\n$/, '');
    }
    result = await probeOAuthResource({ config, token, ...networkOptions(options),
      ...(options['max-pages'] ? { maxPages: integerOption(options, 'max-pages') } : {}) });
    if (result.termination.state === 'failed') process.exitCode = 2;
  } else {
    const config = validateOAuthResourceConfig(await readJson(required(options, 'config')));
    required(options, 'output');
    if (options.merge && resolve(options.merge) === resolve(options.output)) throw new TypeError('Merge output must be a separate new file');
    const existingConfiguration = options.merge ? await readJson(options.merge) : {};
    result = createOAuthClientConfiguration({ config, name: options.name, existingConfiguration });
  }
  if (options.output) {
    const saved = await writeNewOAuthJson(options.output, result);
    process.stdout.write(JSON.stringify({ ...saved,
      ...(command === 'init' ? resourceMetadataLocation(result.resource) : {}),
      ...(command === 'client-config' ? { client: 'Claude Code', server: options.name ?? 'stellar-forge' } : {}),
      ...(command === 'discover' ? { compatible: result.compatible } : {}),
      ...(command === 'probe' ? { catalogComplete: result.catalogComplete, toolCount: result.toolCount, termination: result.termination } : {}) }) + '\n');
  } else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'CONFIGURATION_ERROR',
      message: error instanceof OAuthOperatorError || error instanceof TypeError ? error.message : 'Operator command failed',
      ...(error instanceof OAuthOperatorError ? { details: error.details } : {}) }) + '\n');
    process.exitCode = 2;
  });
}
