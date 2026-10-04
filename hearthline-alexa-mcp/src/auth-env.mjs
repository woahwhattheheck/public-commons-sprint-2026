import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function splitCsv(value) { return String(value ?? '').split(',').map((part) => part.trim()).filter(Boolean); }

export async function loadAuthConfigFromEnv({ env = process.env, cwd = process.cwd(), required = true } = {}) {
  const resource = String(env.HEARTHLINE_MCP_RESOURCE ?? '').trim();
  const authorizationServers = splitCsv(env.HEARTHLINE_AUTHORIZATION_SERVERS);
  const scopesSupported = splitCsv(env.HEARTHLINE_MCP_SCOPES);
  const verifierModule = String(env.HEARTHLINE_BEARER_VERIFIER_MODULE ?? '').trim();
  const anyConfigured = Boolean(resource || authorizationServers.length || scopesSupported.length || verifierModule);
  if (!anyConfigured && !required) return null;
  if (!resource) throw new Error('HEARTHLINE_MCP_RESOURCE is required when MCP bearer auth is enabled');
  if (authorizationServers.length === 0) throw new Error('HEARTHLINE_AUTHORIZATION_SERVERS is required when MCP bearer auth is enabled');
  if (!verifierModule) throw new Error('HEARTHLINE_BEARER_VERIFIER_MODULE is required when MCP bearer auth is enabled');
  const verifierUrl = verifierModule.startsWith('file:') ? new URL(verifierModule) : pathToFileURL(resolve(cwd, verifierModule));
  const loaded = await import(verifierUrl.href);
  const verifyBearerToken = loaded.verifyBearerToken ?? loaded.default;
  if (typeof verifyBearerToken !== 'function') throw new Error('bearer verifier module must export verifyBearerToken (or a default function)');
  return {
    resource,
    authorizationServers,
    scopesSupported: scopesSupported.length ? scopesSupported : ['mcp:service', 'mcp:tools', 'mcp:resources'],
    verifyBearerToken,
  };
}
