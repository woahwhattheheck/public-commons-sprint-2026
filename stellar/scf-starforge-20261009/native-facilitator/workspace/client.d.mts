/** The original authenticated native facilitator operator API. */
export type StellarNetwork = 'stellar:testnet' | 'stellar:pubnet';
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type JsonObject = {[key:string]:Json};
export interface NativeSigner {address:string; secretEnv:string}
export interface NativeCatalogBinding {sellerId:string; signer:string; origin:string; payTo:string}
export interface NativeConfiguration {
  schema:'stellar-forge.native-facilitator.v1';
  network:StellarNetwork;
  rpcUrl?:string;
  signers:NativeSigner[];
  feeBumpSigner?:NativeSigner | null;
  payments:{
    assets:string[]; recipients:string[]; maxAtomic:string;
    paymentFlows?:Array<'authorization' | 'upfront'>;
  };
  catalog?:{directory:string; merchants:NativeCatalogBinding[]} | null;
  limits:{
    maxTransactionFeeStroops:number; inclusionFeeStroops?:number;
    maxVerifyInFlight?:number; maxSettleInFlight?:number; drainGraceMs?:number;
  };
  operations?:{
    ownershipDirectory?:string | null; rpcTimeoutMs?:number; readinessMaxAgeMs?:number;
    maxLedgerAgeSeconds?:number; requireReady?:boolean;
  };
}
export interface NativeProfileReview {
  config:NativeConfiguration; sha256:string; bytes:number;
  summary:Record<string, unknown> & {mode:'OFFLINE_FACILITATOR_REVIEW'; network:StellarNetwork};
}
export interface NativeProfile extends NativeProfileReview {
  name:string; path:string; reviewSha256:string;
  commands:{review:string[]; serve:string[]};
}
export type NativeProfileItem =
  | {name:string; sha256:string; bytes:number; summary:NativeProfileReview['summary']; unavailable?:false}
  | {name:string; unavailable:true; error:string};
export interface NativeProfilePage {items:NativeProfileItem[]; next:string | null}
export interface NativeCatalogStatus {
  enabled:boolean; state:string; version:number; head:string;
  resources:number; operations:number; pending:number;
  counters:Record<string, number>;
  batch:{
    queued:number; inFlight:number; batchSizeLimit:number; groups:number;
    commitAttempts:number; commits:number; committedOperations:number;
    isolatedRejections:number; largestCommit:number;
  };
  lastError:string | null;
  [key:string]:unknown;
}
export interface NativeRuntime {
  id:string; name:string; sha256:string; startedAt:string; url:string; stopping:boolean;
  status:Record<string, unknown> & {catalog?:NativeCatalogStatus | {enabled:false}};
  supported:Record<string, unknown>;
}
export interface NativeControllerView {
  operation:string | null; closing:boolean; runtime:NativeRuntime | null;
}
export interface NativeOperatorIdentity {
  schema:'stellar-forge.native-operator-launch.v1'; instanceId:string;
  directory:string; ownershipDirectory:string; pid:number; ppid:number; startedAt:string;
}
export interface NativeOperatorStatus extends NativeControllerView {workspace:NativeOperatorIdentity}
export interface NativeDiscoveryResource {
  resource:JsonObject;
  accepts:Array<JsonObject & {network:string; scheme:string; asset:string; payTo:string;
    amount?:string; maxAmountRequired?:string}>;
  extensions?:JsonObject;
  [key:string]:unknown;
}
export interface NativeCatalogPageIdentity {
  schema:'stellar-forge.native-catalog-page.v1'; runtimeId:string;
  profile:{name:string; sha256:string}; network:StellarNetwork;
  observedAt:string; catalog:NativeCatalogStatus; query:string;
}
export type NativeCatalogPage = NativeCatalogPageIdentity & (
  | {mode:'list'; page:{resources:NativeDiscoveryResource[];
      pagination:{offset:number; limit:number; total:number}}}
  | {mode:'search'; page:{resources:NativeDiscoveryResource[]; partialResults:boolean;
      pagination:{limit:number; cursor:string | null}}}
);
export interface NativeCatalogSelection {
  runtimeId:string;
  /** Original discovery filters. Complete receiving starts at the first matching resource. */
  query?:string;
  /** Omit for a new observation; receiving fixes all later pages to the first version. */
  expectedVersion?:number | null;
}
export interface NativeCatalogExportMetadata {
  schema:'stellar-forge.native-catalog-export.v1'; runtimeId:string;
  profile:{name:string; sha256:string}; network:StellarNetwork; observedAt:string;
  catalog:NativeCatalogStatus; mode:'list' | 'search'; query:string;
}
export interface NativeCatalogExport extends NativeCatalogExportMetadata {
  resources:NativeDiscoveryResource[]; resourceCount:number; pages:number;
}
export interface NativeCatalogCompletion {
  metadata:NativeCatalogExportMetadata; resourceCount:number; pages:number;
}
export interface NativeCatalogReceiving extends NativeCatalogCompletion {
  /** Complete UTF-8 JSON content, assembled only after the original final page arrives. */
  parts:string[];
}
export interface NativeCatalogProgress {
  runtimeId:string; version:number; resourceCount:number; pages:number;
}
export interface RequestOptions {signal?:AbortSignal}
export interface CatalogReceivingOptions extends RequestOptions {
  onProgress?:(progress:NativeCatalogProgress) => void | Promise<void>;
}
export interface CatalogStreamingOptions extends CatalogReceivingOptions {
  /** A page is accepted only after its entire UTF-8 JSON fragment has been written. */
  write:(part:string) => void | Promise<void>;
}
export type NativeProbeSelection = {runtimeId:string} | {name:string; sha256:string};

export class NativeOperatorError extends Error {
  code:string; status:number | null; method:string | null; path:string | null;
  constructor(code:string, options?:{status?:number | null; method?:string | null;
    path?:string | null; cause?:unknown});
}
export interface NativeOperatorClient {
  readonly origin:string;
  status(options?:RequestOptions):Promise<NativeOperatorStatus>;
  profiles(options?:RequestOptions & {after?:string; limit?:number}):Promise<NativeProfilePage>;
  profile(name:string, options?:RequestOptions):Promise<NativeProfile>;
  /** Retains the exact canonical bytes of the selected original JSON file. */
  downloadProfile(selection:{name:string; sha256:string}, options?:RequestOptions):Promise<string>;
  review(config:NativeConfiguration, options?:RequestOptions):Promise<NativeProfileReview>;
  save(input:{name:string; config:NativeConfiguration; expectedSha256:string},
    options?:RequestOptions):Promise<NativeProfile & {reused:boolean}>;
  /** The original controller reconciles an identical running profile and requested port. */
  start(input:{name:string; sha256:string; port?:number},
    options?:RequestOptions):Promise<NativeOperatorStatus & {reused:boolean}>;
  stop(runtimeId:string, options?:RequestOptions):Promise<NativeOperatorStatus & {drain:Record<string, unknown>}>;
  probe(input:NativeProbeSelection,
    options?:RequestOptions):Promise<NativeOperatorStatus & {observation:Record<string, unknown>}>;
  catalog(selection:NativeCatalogSelection, options?:RequestOptions):Promise<NativeCatalogPage>;
  exportCatalog(selection:NativeCatalogSelection, options?:CatalogReceivingOptions):Promise<NativeCatalogExport>;
  receiveCatalog(selection:NativeCatalogSelection, options?:CatalogReceivingOptions):Promise<NativeCatalogReceiving>;
  /** Streams verified original pages; publish the receiving file only after completion. */
  streamCatalog(selection:NativeCatalogSelection, options:CatalogStreamingOptions):Promise<NativeCatalogCompletion>;
}
export function createNativeOperatorClient(options:{
  /** Printed original loopback operator URL, including its token fragment. */
  operatorUrl:string;
  /** Optional separate token when operatorUrl contains only the original origin. */
  token?:string;
  fetch?:typeof globalThis.fetch;
  /** Maximum encoded bytes per original HTTP response; default 32 MiB. */
  maxResponseBytes?:number;
}):Readonly<NativeOperatorClient>;
