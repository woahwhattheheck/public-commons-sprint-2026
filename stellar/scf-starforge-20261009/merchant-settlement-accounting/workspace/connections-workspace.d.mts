// MIT. Original OAuth and native company-selection workspace.
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {OAuthConnectionOptions} from '../../sf30-seller-sdk/oauth-connections/connection.mjs';
import type {OAuthRegistrySnapshot} from '../../sf30-seller-sdk/oauth-connections/host.mjs';
import type {QuickBooksCompanySelection,QuickBooksSelectionSummary,QuickBooksConnectionChoice,
  QuickBooksNativeClient,QuickBooksEnvironment,QuickBooksCompany} from '../../sf30-seller-sdk/oauth-connections/quickbooks.mjs';
import type {XeroTenantSelection,XeroSelectionSummary,XeroConnectionChoice,XeroNativeClient,
  XeroTenantSnapshot,XeroAccount} from '../../sf30-seller-sdk/oauth-connections/xero.mjs';

export declare const ACCOUNTING_CONNECTION_REQUEST_BYTES:number;
export declare const ACCOUNTING_SELECTION_REVIEW_SCHEMA:'stellar-forge.accounting-connection-review.v1';
export declare const ACCOUNTING_CONNECTION_SCOPE_SCHEMA:'stellar-forge.accounting-connection-scope.v1';
export type AccountingProvider='quickbooks'|'xero';
export interface AccountingSavedSelections {
  quickbooks:QuickBooksCompanySelection|null;xero:XeroTenantSelection|null;
}
export interface AccountingSelectionSummaries {
  quickbooks:QuickBooksSelectionSummary|null;xero:XeroSelectionSummary|null;
}
interface ReviewIdentity {
  id:string;createdAt:string;alias:string;profileSha256:string;grantId:string;
  actor:string;reference:string;expectedSelectionSha256:string|null;
}
export interface QuickBooksCompanyReviewRequest extends ReviewIdentity {
  kind:'quickbooks';realmId:string;environment:QuickBooksEnvironment;minorVersion?:string|null;
  connectionId?:never;tenantId?:never;
}
export interface XeroTenantReviewRequest extends ReviewIdentity {
  kind:'xero';connectionId:string;tenantId:string;realmId?:never;environment?:never;minorVersion?:never;
}
export type AccountingCompanyReviewRequest=QuickBooksCompanyReviewRequest|XeroTenantReviewRequest;
export interface AccountingCompanyReview {
  schema:typeof ACCOUNTING_SELECTION_REVIEW_SCHEMA;id:string;kind:AccountingProvider;createdAt:string;
  state:'PENDING'|'PREVIEWED'|'SAVED';expectedSelectionSha256:string|null;
  target:{alias:string;profileSha256:string;grantId:string;actor:string;reference:string;
    realmId?:string;environment?:QuickBooksEnvironment;connectionId?:string;tenantId?:string};
  previewSha256:string|null;selection:QuickBooksSelectionSummary|XeroSelectionSummary|null;
  files:Array<'request.json'|'selection.json'>;savedAt:string|null;
}
export interface AccountingConnectionState {
  scope:string;
  providers:{
    quickbooks:{selected:QuickBooksSelectionSummary|null;active:QuickBooksSelectionSummary|null;restartRequired:boolean};
    xero:{selected:XeroSelectionSummary|null;active:XeroSelectionSummary|null;restartRequired:boolean};
  };
  connections:{quickbooks:QuickBooksConnectionChoice[];xero:XeroConnectionChoice[]};
  callbackOrigin:string;
}
export interface AccountingOAuthAdapter {
  list():Promise<{connections:OAuthRegistrySnapshot[];callbackOrigin:string}>;
  status(alias:string,flowId?:string):Promise<OAuthRegistrySnapshot>;
  command(value:{alias:string;action:'begin'|'approve'|'discard'|'refresh'|'disconnect'|'revoke';args?:Record<string,unknown>}):Promise<unknown>;
  acceptCallbackRequest(request:IncomingMessage,url:URL):boolean;
  callback(request:IncomingMessage,response:ServerResponse,url:URL):Promise<boolean>;
  returned(response:ServerResponse,url:URL):boolean;
  /** This adapter borrows its registry; the complete owner closes it last. */
  close():Promise<void>;
}
export interface AccountingConnectionRuntime extends OAuthConnectionOptions {
  fetchImpl?:typeof globalThis.fetch;timeoutMs?:number;agent?:import('node:https').Agent;
}
export interface AccountingConnectionsOptions extends AccountingConnectionRuntime {
  connectionsFile:string;selectionDirectory:string;origin:()=>string;
}
export interface AccountingNativeInformation {
  available:boolean;tokenEnv:string|null;authorization:Record<string,unknown>;
  realmId?:string|null;environment?:QuickBooksEnvironment;minorVersion?:string|null;
}
export interface AccountingConnectionsOwner {
  readonly qboClient:Omit<QuickBooksNativeClient,'info'|'target'>&{
    info():AccountingNativeInformation;
    target(value?:{realmId?:string;environment?:QuickBooksEnvironment}):AccountingNativeInformation;
  };
  readonly xeroClient:Omit<XeroNativeClient,'info'>&{info():AccountingNativeInformation};
  readonly activeSelections:Readonly<AccountingSelectionSummaries>;
  readonly oauth:AccountingOAuthAdapter;
  readonly scope:string;
  assertOpen():void;
  assertScope(scope:string):void;
  state():Promise<AccountingConnectionState>;
  history(options?:{offset?:number;limit?:number}):Promise<{
    reviews:AccountingCompanyReview[];total:number;nextOffset:number|null;
  }>;
  preview(request:AccountingCompanyReviewRequest):Promise<AccountingCompanyReview>;
  review(id:string):Promise<AccountingCompanyReview>;
  resumeReview(id:string):Promise<AccountingCompanyReview>;
  save(id:string,value:{previewSha256:string;selectionConfirmed:true}):Promise<
    AccountingCompanyReview&{duplicate:boolean;restartRequired:boolean}
  >;
  tenants(value:{alias:string;profileSha256:string;grantId:string}):Promise<XeroTenantSnapshot>;
  accounts(id:string,options?:{offset?:number;limit?:number;query?:string}):Promise<{
    reviewId:string;previewSha256:string;total:number;matched:number;offset:number;
    accounts:Array<QuickBooksCompany['accounts'][number]|XeroAccount>;nextOffset:number|null;
  }>;
  download(id:string,name:'request.json'|'selection.json'):Promise<{bytes:Uint8Array;name:string;type:string}>;
  /** Stop admission and abort current native captures; close drains admitted work. */
  stop():void;
  /** After original accounting closes, drain native owners, the adapter and registry. */
  close():Promise<void>;
}
export declare function readAccountingSelections(directory:string):Promise<AccountingSavedSelections>;
export declare function openAccountingConnections(options:AccountingConnectionsOptions):Promise<AccountingConnectionsOwner>;
export declare function handleAccountingConnections(owner:AccountingConnectionsOwner|null|undefined,request:{
  method:string;path:string;value?:Record<string,unknown>;query?:Record<string,string>;scope?:string;
}):Promise<null|{value:unknown}|{file:{bytes:Uint8Array;name:string;type:string}}>;
