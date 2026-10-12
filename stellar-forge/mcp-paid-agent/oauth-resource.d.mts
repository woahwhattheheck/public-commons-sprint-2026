import type { IncomingMessage, ServerResponse } from 'node:http';

export const OAUTH_RESOURCE_SCHEMA: 'stellar-forge.mcp-oauth-resource.v1';
export interface OAuthAuthorizationServer {
  issuer: string;
  jwksUri: string;
  algorithms?: Array<'RS256'|'RS384'|'RS512'|'PS256'|'PS384'|'PS512'|'ES256'|'ES384'|'ES512'|'EdDSA'>;
  tokenTypes?: string[];
  scopeClaim?: 'scope'|'scp';
  /** Exact subjects from this issuer that may use this operator workspace. */
  allowedSubjects?: string[];
}
export interface OAuthResourceConfig {
  schema: typeof OAUTH_RESOURCE_SCHEMA;
  /** Exact intended access-token audience and public MCP URI. */
  resource: string;
  authorizationServers: OAuthAuthorizationServer[];
  requiredScopes?: string[];
  toolScopes?: Record<string,string[]>;
  scopesSupported?: string[];
  clockToleranceSeconds?: number;
  jwksTimeoutMs?: number;
  jwksCacheMaxAgeMs?: number;
  jwksCooldownMs?: number;
  maxJwksBytes?: number;
  maxTokenBytes?: number;
}
export interface NormalizedOAuthResourceConfig extends Required<OAuthResourceConfig> {
  authorizationServers: Array<Required<OAuthAuthorizationServer>>;
}
export interface OAuthResourceContext {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: string;
  readonly scopes: readonly string[];
  readonly clientId: string|null;
  /** NumericDate values are UTC seconds, as in the verified JWT. */
  readonly issuedAt: number|null;
  readonly expiresAt: number;
}
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: ['header'];
  scopes_supported: string[];
}
export interface OAuthResourceLocation {
  resource: string;
  metadataUrl: string;
  metadataPath: string;
}
export interface OAuthResourceDescription extends OAuthResourceLocation {
  schema: 'stellar-forge.mcp-oauth-resource-status.v1';
  authorizationServers: Array<Required<OAuthAuthorizationServer> & {
    keys: {fresh:boolean;reloading:boolean;coolingDown:boolean};
  }>;
  requiredScopes: string[];
  toolScopes: Record<string,string[]>;
  metadata: ProtectedResourceMetadata;
  closed: boolean;
  activeRequests: number;
}
export interface OAuthResourceOptions {
  /** Trusted host transport only. Its request must honor the supplied signal. */
  fetchImpl?: (url:string, options:{
    method:'GET';headers:Record<string,string>;redirect:'manual';signal:AbortSignal;
  })=>Promise<Response>;
  /** UTC milliseconds, used for access-token lifetime validation. */
  clock?: ()=>number;
  /** Rechecked immediately before each original control/tool dispatch. */
  authorize?: (request:{
    context:OAuthResourceContext;tool:string|null;arguments:Record<string,unknown>;signal:AbortSignal;
  })=>boolean|Promise<boolean>;
}
export class OAuthResourceError extends Error {
  status: number;
  code: string;
  readonly requiredScopes: readonly string[];
  constructor(status:number,code:string,message:string,required?:string[]);
}
export interface OAuthResourceAuthorization {
  authenticate(req:IncomingMessage):Promise<OAuthResourceContext>;
  authorizeTool(context:OAuthResourceContext,name?:string|null,args?:Record<string,unknown>):Promise<OAuthResourceContext>;
  respondError(error:unknown,res:ServerResponse,options?:{id?:string|number|null}):void;
  metadataHandler(req:IncomingMessage,res:ServerResponse):boolean;
  describe():OAuthResourceDescription;
  close():Promise<void>;
}
export function validateOAuthResourceConfig(config:OAuthResourceConfig):NormalizedOAuthResourceConfig;
export function resourceMetadataLocation(resource:string):OAuthResourceLocation;
export function createOAuthResourceAuthorization(config:OAuthResourceConfig,options?:OAuthResourceOptions):OAuthResourceAuthorization;
