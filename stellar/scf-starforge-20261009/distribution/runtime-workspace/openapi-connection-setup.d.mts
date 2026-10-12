// MIT. Applications setup API and the trusted private accounting facade contract.
import type {SetupContextInput} from '../../sf30-seller-sdk/oauth-connections/setup/model.mjs';
import type {SetupRuntimeBinding, SetupEditionSelection, SetupActionInputs, SetupActionResults,
  SetupCatalog, SetupPrepared, SetupEditionSummary, PrivateSetupHostEdition,
  AccountingSelectionOwner} from '../../sf30-seller-sdk/oauth-connections/setup/workspace.mjs';
import type {SetupProviderCatalogEntry} from '../../sf30-seller-sdk/oauth-connections/setup/providers.mjs';
import type {OAuthSourceIdentity} from '../../sf30-seller-sdk/oauth-connections/profile.mjs';

export interface OpenApiSetupPolicy {
  directory?: string; grantRoot?: string; selectionRoot?: string; allowLoopbackOAuth?: boolean;
}
export interface DisabledOpenApiSetupCatalog {
  schema: 'stellar-forge.oauth-setup-catalog.v1'; enabled: false; reason: string;
  runtimeBinding: SetupRuntimeBinding | null;
  limits: import('../../sf30-seller-sdk/oauth-connections/setup/model.mjs').SetupLimits;
  providers: SetupProviderCatalogEntry[]; policy: {allowLoopbackOAuth: boolean};
}
export interface OpenApiSetupRouteMap {
  catalog: 'catalog'; 'import-source': 'source.import'; 'import-provider': 'source.provider';
  'inspect-source': 'source.inspect'; review: 'review'; commit: 'commit'; status: 'status';
  activate: 'activate'; download: 'download'; recover: 'recover';
}
export declare const OPENAPI_SETUP_ROUTES: Readonly<OpenApiSetupRouteMap>;
export declare function openApiSetupBodyLimit(action: keyof OpenApiSetupRouteMap): number;
export type OpenApiSetupResult<A extends keyof OpenApiSetupRouteMap> =
  A extends 'catalog' ? SetupCatalog | DisabledOpenApiSetupCatalog : SetupActionResults[OpenApiSetupRouteMap[A]];
export declare function openApiConnectionSetupAction<A extends keyof OpenApiSetupRouteMap>(
  root: string,
  request: {action: A; runtimeId: string; runtimeDirectory?: string; context?: SetupContextInput;
    input: SetupActionInputs[OpenApiSetupRouteMap[A]]},
  options?: {policy?: OpenApiSetupPolicy}
): Promise<OpenApiSetupResult<A>>;
/** Trusted host API only. Its private environment must never become an HTTP result. */
export declare function resolveOpenApiSetupEdition(
  root: string,
  selection: SetupEditionSelection & {runtimeId: string; runtimeDirectory?: string},
  options?: {policy?: OpenApiSetupPolicy}
): Promise<PrivateSetupHostEdition>;
export interface OpenApiSetupEditionSummary {
  schema: 'stellar-forge.oauth-setup-accounting-binding.v1';
  edition: SetupEditionSummary; provider: 'quickbooks' | 'xero'; prepared: SetupPrepared;
  alias: string; directoryEnv: string; profileSha256: string; source: OAuthSourceIdentity;
  callbackUri: string;
  grant: {id: string | null; state: string; scopes: string[]};
  selection: {directory: string; key: string; owner: AccountingSelectionOwner};
}
export declare function openApiSetupEditionSummary(binding: PrivateSetupHostEdition): OpenApiSetupEditionSummary;
