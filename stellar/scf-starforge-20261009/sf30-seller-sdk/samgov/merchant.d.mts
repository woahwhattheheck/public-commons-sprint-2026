/// <reference types="node" />
import type {Server} from 'node:http';
import type {SamEdition,SamSelection,SamNotice,SamSource,SamCapture,SamJson} from './workspace.mjs';
export interface SamMerchantBundle {
  schema:'stellar-forge.samgov-merchant.v1';id:string;workspaceId:string;sourceRevision:number;inputSha256:string;
  createdAt:string;selectionId:string;selectionRevision:number;editionId:string;sourceEditionSha256:string;
  sourceRowsSha256:string;dataset:{name:string;snapshot:string;rowCount:number;columns:unknown[];defaultLimit:number;maxLimit:number;[key:string]:unknown};
  sourceBasis:'latest_api_observation';complete:boolean;files:Record<string,{sha256:string;bytes:number}>;
  seller:{origin:string;path:string;resource:string;config:'seller.json'}|null;
  publisher:{kind:'original_dataset_versions';directory:'runtime/versions';snapshotSelection:true};
  publicationKind:'configured_merchant'|'retained_dataset';
}
export interface SamMerchantDataset {describe():SamMerchantBundle['dataset'];admit(context:unknown):unknown;handle(context:unknown):unknown}
export interface SamMerchantService {
  server:Server;publicationId:string;sourceEditionId:string;snapshot:string;compiled:unknown;controlPath:string|null;
  versions:{directory:string;describe():SamMerchantBundle['dataset'];status():Record<string,unknown>;close():Promise<void>;[key:string]:unknown};
  close():Promise<void>;[key:string]:unknown;
}
export function prepareSamMerchant(options:{directory:string;publicationId:string;workspaceId:string;sourceRevision:number;
  selection:SamSelection;edition:SamEdition;rows:SamNotice[];sources?:SamSource[];capture?:SamCapture|null;
  payment?:Record<string,SamJson>;origin?:string;path?:string;defaultLimit?:number;maxLimit?:number}):Promise<{
    directory:string;bundle:SamMerchantBundle;files:Array<{path:string;sha256:string;bytes:number;absolutePath:string}>;
    launch:{module:string;function:string;publicationId:string;relativeDirectory:string;dataset:string;seller:string|null}}>;
export function loadSamMerchant(directory:string):Promise<{directory:string;bundle:SamMerchantBundle;dataset:SamMerchantDataset}>;
export function previewSamMerchant(directory:string,query?:Record<string,string|number>|string):Promise<{
  mode:'LOCAL_ORIGINAL_DATASET';publicationId:string;snapshot:string;response:unknown}>;
export function serveSamMerchant(directory:string,options?:{port?:number;nativeFactory?:unknown;control?:boolean;
  controlTransport?:'loopback'|'unix';maxInFlight?:number;drainGraceMs?:number}):Promise<SamMerchantService>;
export interface SamBuyerReview {seller:string;resource:string;url:string;snapshot:string;query:string;inputQuery:string;
  offerSha256:string;publicationId:string;editionId:string;accepts:unknown[];offer:Record<string,unknown>;mode:string}
export function reviewSamBuyer(options:{directory:string;seller:string;query?:Record<string,string|number>|string}):Promise<SamBuyerReview>;
export function prepareSamBuyer(options:{directory:string;review:SamBuyerReview;intentId:string;acceptIndex:number;
  offerSha256:string}):Promise<{mode:'ORIGINAL_SF88_CONFIG_PREPARED';sellerMode:string;snapshot:string;url:string;
    offerSha256:string;configSha256:string;config:unknown;configText:string}>;
