// MIT. Explicit managed Xero tenant selection and original accounting embedding.
import type {Agent} from 'node:http';
import type {OAuthConnectionRegistry,OAuthRegistrySnapshot} from './host.mjs';
import type {OAuthConnectionBinding,OAuthProfile,OAuthSourceIdentity} from './profile.mjs';
import type {OAuthConnectionOptions} from './connection.mjs';

export declare const XERO_SELECTION_SCHEMA:'stellar-forge.xero-oauth-tenant-selection.v1';
export declare const XERO_TENANTS_SCHEMA:'stellar-forge.xero-oauth-connected-tenants.v1';
export declare const XERO_SELECTION_BYTES:number;
export interface XeroTenant {
  id:string;tenantId:string;authEventId:string|null;tenantType:'ORGANISATION'|'PRACTICE';tenantName:string;
  createdDateUtc:string|null;updatedDateUtc:string|null;selectable:boolean;
}
export interface XeroAccount {
  id:string;code:string;name:string;type:string;status:string;systemAccount:string;eligible:boolean;
}
export interface XeroOrganization {
  id:string;name:string;baseCurrency:string;isDemoCompany:boolean;status:'ACTIVE';
}
export interface XeroContext {
  schema:'stellar-forge.xero-context.v1';id:string;name:string;actor:string;createdAt:string;tenantId:string;
  organization:XeroOrganization;accounts:XeroAccount[];
  source:Array<{name:string;bytes:number;sha256:string}>;docs:Record<string,string>;sha256:string;
}
export interface XeroSourceRequest {
  method:string;url:string;tenantId:string|null;idempotencyKey:string|null;
}
export interface XeroNativeResponse {
  status:number;ok:boolean;bytes:Uint8Array;headers:Record<string,string>;receivedAt:string;request:XeroSourceRequest;
}
export interface XeroRetainedResponse {
  name:'connections.json'|'organization.json'|'accounts.json';status:200;receivedAt:string;
  request:XeroSourceRequest;headers:Record<string,string>;bytes:number;sha256:string;
  /** Complete original UTF-8 provider response, including native wrapping fields. */
  json:string;
}
export interface XeroTenantSnapshot {
  schema:typeof XERO_TENANTS_SCHEMA;alias:string;profileSha256:string;grantId:string;
  source:OAuthSourceIdentity;binding:OAuthConnectionBinding;capturedAt:string;connections:XeroTenant[];
  response:XeroRetainedResponse;integrity:{sha256:string};
}
export interface XeroTenantSelection {
  schema:typeof XERO_SELECTION_SCHEMA;id:string;createdAt:string;alias:string;profileSha256:string;grantId:string;
  connectionId:string;tenantId:string;source:OAuthSourceIdentity;binding:OAuthConnectionBinding;capturedAt:string;
  connection:XeroTenant;context:XeroContext;
  responses:{connections:XeroRetainedResponse;organization:XeroRetainedResponse;accounts:XeroRetainedResponse};
  review:{actor:string;reference:string};integrity:{sha256:string};
}
export interface XeroSelectionSummary {
  schema:typeof XERO_SELECTION_SCHEMA;id:string;alias:string;profileSha256:string;grantId:string;
  connectionId:string;tenantId:string;authEventId:string|null;tenantName:string;tenantType:'ORGANISATION'|'PRACTICE';
  organizationName:string;baseCurrency:string;isDemoCompany:boolean;accountCount:number;eligibleAccountCount:number;
  contextSha256:string;capturedAt:string;review:{actor:string;reference:string};integrity:{sha256:string};
}
export interface XeroConnectionChoice {
  alias:string;label:string;directoryEnv:string;profileSha256:string;grantId:string|null;state:string;
  review:{actor:string;reference:string;at:string}|null;refreshExpiresAt:string|null;sourceMatches:boolean;ready:boolean;
}
export interface XeroOAuthRuntime extends OAuthConnectionOptions {
  /** Trusted native resource transport; the original OAuth transport uses agent/lookup. */
  fetchImpl?:typeof globalThis.fetch;
  /** Borrowed by original OAuth token requests. Its caller owns destruction after owner close. */
  agent?:Agent;
  timeoutMs?:number;
}
export interface XeroTenantRequest extends XeroOAuthRuntime {
  registry:OAuthConnectionRegistry;alias:string;profileSha256:string;grantId:string;signal?:AbortSignal;
}
export interface XeroPreviewRequest extends XeroTenantRequest {
  connectionId:string;tenantId:string;actor:string;reference?:string;id?:string;createdAt?:string;
}
export interface XeroManagedAuthorization {
  kind:'oauth-connection';alias:string;profileSha256:string;grantId:string;connectionId:string;tenantId:string;
  tenantName:string|null;organizationName:string|null;baseCurrency:string|null;isDemoCompany:boolean|null;
  selectionSha256:string|null;state:string;lastError:string|null;lastTenantReadAt:string|null;
}
export interface XeroClientInformation {
  available:boolean;tokenEnv:null;authorization:XeroManagedAuthorization;
}
export interface XeroNativeClient {
  available():boolean;
  info():XeroClientInformation;
  request(tenantId:string,path:string,options?:{
    method?:'GET'|'PUT';body?:unknown;idempotencyKey?:string;signal?:AbortSignal;
  }):Promise<XeroNativeResponse>;
  context(tenantId:string,options?:{signal?:AbortSignal}):Promise<{
    organization:XeroNativeResponse;accounts:XeroNativeResponse|null;
  }>;
  /** Uses the original retained plan payload and Idempotency-Key. */
  createDraft(plan:unknown,index:number,options?:{signal?:AbortSignal}):Promise<XeroNativeResponse>;
  /** Uses the original returned UUID or complete exact-narration search. */
  readJournal(plan:unknown,index:number,options?:{journalId?:string;signal?:AbortSignal}):Promise<XeroNativeResponse[]>;
}
export interface XeroClientOwner {
  readonly client:XeroNativeClient;
  fetchTenants(options?:{signal?:AbortSignal}):Promise<{connections:XeroTenant[];source:XeroRetainedResponse}>;
  snapshot():{authorization:XeroManagedAuthorization;provider:Record<string,unknown>};
  /** Aborts/drains owned resource requests, then closes its token provider. Registry and Agent remain with their callers. */
  close():Promise<void>;
}
export interface XeroAccountingOptions extends XeroOAuthRuntime {
  connectionsFile:string;selectionDirectory:string;directory:string;port?:number;host?:'127.0.0.1'|'localhost';
  outboxDir?:string;proofDir?:string;termsFile?:string;recoveredDir?:string;rpcProxyEnv?:string;
  recoveryStateRoot?:string;recoveryBackupRoot?:string;recoveryPassEnv?:string;recoveryStartPaused?:boolean;signal?:AbortSignal;
}
export interface XeroAccountingOwner {
  readonly accounting:{
    readonly url:string;readonly server:unknown;readonly workspace:unknown;readonly accountant:unknown;
    readonly xero:unknown;readonly qbo:unknown;readonly bitwave:unknown;readonly collection:unknown;
    readonly statements:unknown;readonly maintenance:unknown;close():Promise<void>;
  };
  readonly selection:XeroSelectionSummary;
  connectionStatus():Promise<OAuthRegistrySnapshot>;
  providerStatus():ReturnType<XeroClientOwner['snapshot']>;
  /** Drains original accounting, this native client/token provider, then its owned registry. */
  close():Promise<void>;
}
export declare function xeroSource():Promise<OAuthSourceIdentity>;
export declare function createXeroProfile(value:{
  clientId:string;clientSecretEnv:string;callbackOrigin:string;label?:string;
}):Promise<OAuthProfile>;
export declare function listXeroConnections(registry:OAuthConnectionRegistry):Promise<XeroConnectionChoice[]>;
export declare function listXeroTenants(value:XeroTenantRequest):Promise<XeroTenantSnapshot>;
export declare function previewXeroSelection(value:XeroPreviewRequest):Promise<XeroTenantSelection>;
export declare function validateXeroSelection(value:unknown):Promise<XeroTenantSelection>;
export declare function xeroSelectionSummary(selection:XeroTenantSelection):XeroSelectionSummary;
export declare function readXeroSelection(directory:string):Promise<XeroTenantSelection>;
export declare function saveXeroSelection(directory:string,value:{
  registry:OAuthConnectionRegistry;selection:XeroTenantSelection;previewSha256:string;expectedSelectionSha256?:string|null;
}):Promise<{selection:XeroTenantSelection;duplicate:boolean}>;
export declare function openXeroOAuthClient(value:XeroOAuthRuntime&{
  registry:OAuthConnectionRegistry;selection:XeroTenantSelection;signal?:AbortSignal;
}):Promise<XeroClientOwner>;
export declare function startXeroAccountingWorkspace(value:XeroAccountingOptions):Promise<XeroAccountingOwner>;
