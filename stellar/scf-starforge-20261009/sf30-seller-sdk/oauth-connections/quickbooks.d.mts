// MIT. Typed company selection and original-accounting embedding surface.
import type {OAuthConnectionRegistry,OAuthRegistrySnapshot} from './host.mjs';
import type {OAuthConnectionBinding,OAuthProfile,OAuthSourceIdentity} from './profile.mjs';
import type {OAuthConnectionOptions} from './connection.mjs';

export declare const QUICKBOOKS_SELECTION_SCHEMA: 'stellar-forge.quickbooks-oauth-company-selection.v1';
export declare const QUICKBOOKS_SELECTION_BYTES: number;
export type QuickBooksEnvironment = 'sandbox' | 'production';
export interface QuickBooksCompany {
  schema:'stellar-forge.quickbooks-company.v1';realmId:string;companyName:string;baseCurrency:string;multiCurrencyEnabled:boolean;
  accounts:Array<{value:string;name:string;Active:boolean;AccountType:string;CurrencyRef:{value:string;name?:string}|null;
    selectable:boolean;reasons:Array<{code:string;message:string}>}>;
  summary:{accountCount:number;selectableAccountCount:number;pageCount:number};
  sourceDocuments:{companyInfo:string;preferences:string;accounts:string};
  sourceDigests:Record<'companyInfo'|'preferences'|'accounts',{sha256:string;canonicalSha256:string;bytes:number}>;
  integrity:{sha256:string};
}
export interface QuickBooksCompanySelection {
  schema:typeof QUICKBOOKS_SELECTION_SCHEMA;id:string;createdAt:string;alias:string;profileSha256:string;grantId:string;
  realmId:string;environment:QuickBooksEnvironment;source:OAuthSourceIdentity;binding:OAuthConnectionBinding;
  minorVersion:string|null;capturedAt:string;company:QuickBooksCompany;review:{actor:string;reference:string};integrity:{sha256:string};
}
export interface QuickBooksSelectionSummary {
  schema:typeof QUICKBOOKS_SELECTION_SCHEMA;id:string;alias:string;realmId:string;environment:QuickBooksEnvironment;
  profileSha256:string;grantId:string;minorVersion:string|null;companyName:string;baseCurrency:string;
  accountCount:number;selectableAccountCount:number;companySha256:string;capturedAt:string;
  review:{actor:string;reference:string};integrity:{sha256:string};
}
export interface QuickBooksConnectionChoice {
  alias:string;label:string;directoryEnv:string;profileSha256:string;grantId:string|null;realmId:string|null;
  environment:QuickBooksEnvironment;state:string;review:{actor:string;reference:string;at:string}|null;
  refreshExpiresAt:string|null;refreshHardExpiresAt:string|null;sourceMatches:boolean;ready:boolean;
}
export interface QuickBooksOAuthRuntime extends OAuthConnectionOptions {
  /** Server-owned transport. Browser requests never select this implementation. */
  fetchImpl?:typeof globalThis.fetch;
}
export interface QuickBooksPreviewRequest extends QuickBooksOAuthRuntime {
  registry:OAuthConnectionRegistry;alias:string;profileSha256:string;grantId:string;realmId:string;
  environment:QuickBooksEnvironment;actor:string;reference?:string;id?:string;createdAt?:string;minorVersion?:string|null;signal?:AbortSignal;
}
export interface QuickBooksNativeResponse {
  status:number;ok:boolean;bytes:Uint8Array;headers:Record<string,string>;receivedAt:string;
  request:{method:string;url:string;realmId:string;environment:QuickBooksEnvironment;requestId:string|null};
}
export interface QuickBooksClientInformation {
  available:boolean;realmId:string|null;environment:QuickBooksEnvironment;tokenEnv:string;minorVersion:string|null;
  authorization:{kind:'oauth-connection';alias:string;profileSha256:string;grantId:string;realmId:string;
    environment:QuickBooksEnvironment;companyName:string|null;state:string;lastError:string|null};
}
export interface QuickBooksNativeClient {
  readonly realmId:string;readonly environment:QuickBooksEnvironment;readonly minorVersion:string|null;
  available():boolean;
  info():QuickBooksClientInformation;
  target(value?:{realmId?:string;environment?:QuickBooksEnvironment}):QuickBooksClientInformation;
  endpoint(path:string,options?:{query?:string;requestId?:string}):URL;
  request(path:string,options?:{method?:'GET'|'POST';body?:Uint8Array;requestId?:string;query?:string;signal?:AbortSignal}):Promise<QuickBooksNativeResponse>;
  company(value?:{realmId?:string;environment?:QuickBooksEnvironment},options?:{signal?:AbortSignal}):Promise<{
    company:QuickBooksCompany;connection:QuickBooksClientInformation;capturedAt:string;sourceRequests:unknown[];
  }>;
  searchJournal(plan:unknown,options?:{signal?:AbortSignal}):AsyncGenerator<{response:QuickBooksNativeResponse;rows:unknown[];error:unknown}>;
  readJournal(plan:unknown,journalId:string,options?:{signal?:AbortSignal}):Promise<QuickBooksNativeResponse>;
  createJournal(plan:unknown,options:{requestId:string;bytes:Uint8Array;signal?:AbortSignal}):Promise<QuickBooksNativeResponse>;
}
export interface QuickBooksClientOwner {
  readonly client:QuickBooksNativeClient;
  snapshot():{authorization:Record<string,unknown>;provider:Record<string,unknown>};
  /** Closes this token provider. The existing registry remains with its original owner. */
  close():Promise<unknown>;
}
export interface QuickBooksAccountingOptions extends QuickBooksOAuthRuntime {
  connectionsFile:string;selectionDirectory:string;directory:string;port?:number;host?:'127.0.0.1'|'localhost';
  outboxDir?:string;proofDir?:string;termsFile?:string;recoveredDir?:string;rpcProxyEnv?:string;
  recoveryStateRoot?:string;recoveryBackupRoot?:string;recoveryPassEnv?:string;recoveryStartPaused?:boolean;
}
export interface QuickBooksAccountingOwner {
  readonly accounting:{
    readonly url:string;readonly server:unknown;readonly workspace:unknown;readonly accountant:unknown;
    readonly qbo:unknown;readonly xero:unknown;readonly bitwave:unknown;readonly collection:unknown;
    readonly statements:unknown;readonly maintenance:unknown;close():Promise<void>;
  };
  readonly selection:QuickBooksSelectionSummary;
  connectionStatus():Promise<OAuthRegistrySnapshot>;
  providerStatus():ReturnType<QuickBooksClientOwner['snapshot']>;
  /** Drains original accounting, its token provider, then the original registry. */
  close():Promise<void>;
}
export declare function quickbooksSource():Promise<OAuthSourceIdentity>;
export declare function createQuickBooksProfile(value:{
  clientId:string;clientSecretEnv:string;callbackOrigin:string;environment?:QuickBooksEnvironment;label?:string;
}):Promise<OAuthProfile>;
export declare function listQuickBooksConnections(registry:OAuthConnectionRegistry):Promise<QuickBooksConnectionChoice[]>;
export declare function previewQuickBooksSelection(value:QuickBooksPreviewRequest):Promise<QuickBooksCompanySelection>;
export declare function validateQuickBooksSelection(value:unknown):Promise<QuickBooksCompanySelection>;
export declare function quickBooksSelectionSummary(selection:QuickBooksCompanySelection):QuickBooksSelectionSummary;
export declare function readQuickBooksSelection(directory:string):Promise<QuickBooksCompanySelection>;
export declare function saveQuickBooksSelection(directory:string,value:{
  registry:OAuthConnectionRegistry;selection:QuickBooksCompanySelection;previewSha256:string;expectedSelectionSha256?:string|null;
}):Promise<{selection:QuickBooksCompanySelection;duplicate:boolean}>;
export declare function openQuickBooksOAuthClient(value:QuickBooksOAuthRuntime&{
  registry:OAuthConnectionRegistry;selection:QuickBooksCompanySelection;
}):Promise<QuickBooksClientOwner>;
export declare function startQuickBooksAccountingWorkspace(value:QuickBooksAccountingOptions):Promise<QuickBooksAccountingOwner>;
