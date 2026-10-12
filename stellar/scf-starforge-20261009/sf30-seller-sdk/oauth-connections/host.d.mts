// MIT. Declarations for the original host-owned alias registry.
import type {
  OAuthEnvironment, OAuthLookup, OAuthAgent, OAuthConnectionSnapshot, OAuthStatusRequest,
  OAuthBeginRequest, OAuthAuthorizationStart, OAuthCompleteRequest, OAuthFlow,
  OAuthApproveRequest, OAuthCommandReceipt, OAuthDiscardRequest, OAuthRefreshRequest,
  OAuthDisconnectRequest, OAuthRevokeRequest,
} from './connection.mjs';
import type { OAuthConnectionBinding } from './profile.mjs';

export declare const HOST_CONNECTIONS_SCHEMA: 'stellar-forge.oauth-host-connections.v1';

export interface OAuthHostConnection {
  alias: string;
  /** Environment-variable name, never a resolved directory path. */
  directoryEnv: string;
}
export interface OAuthHostConnectionsFile {
  schema: typeof HOST_CONNECTIONS_SCHEMA;
  connections: readonly OAuthHostConnection[];
}
export interface OAuthRegistryOptions {
  connections?: readonly OAuthHostConnection[];
  /** Snapshot once at registry creation; it also reaches the original provider transport. */
  env?: OAuthEnvironment;
  allowLoopback?: boolean;
  lookup?: OAuthLookup;
  /** Borrowed runtime transport, shared by this registry's original connections. */
  agent?: OAuthAgent;
}
export interface OAuthHostDirectoryIdentity {
  device: string;
  inode: string;
  uid: number;
}
export interface OAuthRegistrySnapshot extends OAuthConnectionSnapshot {
  alias: string;
  directoryEnv: string;
}
export interface OAuthBindingRequest {
  requiredScopes: readonly string[];
  resourceOrigin: string;
  sourceSha256: string;
  scheme: string;
}

/** A structural local host error. The registry does not attach an HTTP status. */
export interface OAuthHostFailure extends Error { code: string }

export interface OAuthConnectionRegistry {
  readonly list: () => Promise<OAuthRegistrySnapshot[]>;
  readonly status: (alias: string, request?: OAuthStatusRequest) => Promise<OAuthRegistrySnapshot>;
  /** Recheck exact source, scheme, origin, scopes and the currently reviewed grant. */
  readonly binding: (alias: string, request: OAuthBindingRequest) => Promise<OAuthConnectionBinding>;
  /** Forwarded methods return the original core result, without an alias wrapper. */
  readonly begin: (alias: string, request: OAuthBeginRequest) => Promise<OAuthAuthorizationStart>;
  readonly complete: (alias: string, request: OAuthCompleteRequest) => Promise<OAuthFlow>;
  readonly approve: (alias: string, request: OAuthApproveRequest) => Promise<OAuthCommandReceipt>;
  readonly discard: (alias: string, request: OAuthDiscardRequest) => Promise<OAuthFlow>;
  readonly refresh: (alias: string, request: OAuthRefreshRequest) => Promise<OAuthCommandReceipt>;
  readonly disconnect: (alias: string, request: OAuthDisconnectRequest) => Promise<OAuthCommandReceipt>;
  readonly revoke: (alias: string, request: OAuthRevokeRequest) => Promise<OAuthCommandReceipt>;
  /** Close all original cores and await their active operations. Repeated close reuses the result. */
  readonly close: () => Promise<void>;
}

export declare function normalizeOAuthHostConnections(
  connections: unknown,
): Array<Readonly<OAuthHostConnection>>;
/** Returns the validated connections array, not the surrounding JSON document. */
export declare function readOAuthHostConnections(file: string): Promise<Array<Readonly<OAuthHostConnection>>>;
export declare function inspectOAuthHostDirectory(
  directory: string, options?: { directoryEnv?: string; ownerUid?: number },
): Promise<OAuthHostDirectoryIdentity>;
export declare function openOAuthConnectionRegistry(options?: OAuthRegistryOptions): Promise<OAuthConnectionRegistry>;

