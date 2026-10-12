import type {
  OAuthResourceConfig, NormalizedOAuthResourceConfig, OAuthAuthorizationServer, OAuthResourceDescription,
} from './oauth-resource.mjs';
import type { OAuthDiscoveryReport, OAuthProbeReport } from './oauth-discovery.mjs';

export interface OAuthOperatorConfigurationInput {
  resource: string;
  issuer: string;
  jwksUri: string;
  /** At least one exact issuer subject for the selected original shared workspace. */
  subjects: string[];
  scopes?: string[];
  toolScopes?: Record<string, string[]>;
  algorithms?: OAuthAuthorizationServer['algorithms'];
  tokenTypes?: string[];
  scopeClaim?: 'scope' | 'scp';
}
export interface OAuthClaudeConfigurationInput {
  config: OAuthResourceConfig;
  name?: string;
  existingConfiguration?: Record<string, unknown> & { mcpServers?: Record<string, unknown> };
}
export type OAuthClaudeConfiguration = Record<string, unknown> & { mcpServers: Record<string, unknown> };
export interface OAuthSavedJson {
  file: string;
  bytes: number;
  sha256: string;
}

export function createOAuthOperatorConfiguration(input: OAuthOperatorConfigurationInput): NormalizedOAuthResourceConfig;
/** Preserves existing settings and refuses a server-name collision. */
export function createOAuthClientConfiguration(input: OAuthClaudeConfigurationInput): OAuthClaudeConfiguration;
/** Publishes a complete new mode-0600 JSON file without replacing a destination. */
export function writeNewOAuthJson(filename: string, value: unknown): Promise<OAuthSavedJson>;
export function main(args?: string[]): Promise<NormalizedOAuthResourceConfig | OAuthResourceDescription |
  OAuthDiscoveryReport | OAuthProbeReport | OAuthClaudeConfiguration | void>;
