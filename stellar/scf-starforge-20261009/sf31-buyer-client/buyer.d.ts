export interface PaymentTerms { scheme:string; network:string; amount:string; asset:string; payTo:string; maxTimeoutSeconds:number; extra?:Record<string,unknown> }
export interface PaymentRequired { x402Version:2; resource:{url:string;description?:string;mimeType?:string}; accepts:PaymentTerms[]; extensions?:Record<string,unknown> }
export interface PaymentPayload { x402Version:2; resource:PaymentRequired['resource']; accepted:PaymentTerms; payload:Record<string,unknown>; extensions?:Record<string,unknown> }
export interface BuyerIntent { readonly intentId:string;readonly url:string;readonly method:string;readonly scheme:string;readonly network:string;readonly amount:string;readonly asset:string;readonly payTo:string;readonly maxAtomic:string }
export type Approver=(intent:BuyerIntent)=>Promise<boolean>|boolean;
export type Signer=(request:{intent:BuyerIntent;challenge:PaymentRequired;accepted:PaymentTerms})=>Promise<PaymentPayload>|PaymentPayload;
export interface BuyerResult { intentId:string;status:string;resource:string;requirement:PaymentTerms|null;attempts:number;settlement:string;receipt:Record<string,unknown>|null;reason:string|null;httpStatus:number;contentType:string|null;response:Response }
export class BuyerError extends Error { readonly code:string; readonly paymentSent:boolean }
export class X402BuyerClient {
 constructor(args?:{fetchImpl?:typeof fetch;allowLocal?:boolean});
 discover(args:{origin:string;query?:string;filters?:Record<string,string>;limit?:number;signal?:AbortSignal}):Promise<{source:string;resources:unknown[];pagination:Record<string,unknown>}>;
 call(args:{url:string;method?:string;body?:string|Uint8Array;headers?:Record<string,string>;expect:{scheme?:string;network:string;asset:string;payTo:string;maxAtomic:string;paymentFlow?:string};approve:Approver;sign:Signer;signal?:AbortSignal;intentId?:string}):Promise<BuyerResult>;
}
