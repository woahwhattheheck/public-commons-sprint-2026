import { CanadaBuysClient } from '../client.mjs';
import type { RequestOptions,RawResponse } from '../client.mjs';
import type { ResponseStatus,SavedResponse,ResponseTransfer,PrepareInput,PrepareResult,CompareInput,CompareResult,ApplyInput,ApplyResult } from './workspace.mjs';
export type * from './workspace.mjs';
export declare class CanadaBuysResponseReviewClient {
 constructor(origin:string|CanadaBuysClient,options?:{fetch?:typeof fetch;headers?:Record<string,string>;timeoutMs?:number;maxResponseBytes?:number});
 readonly client:CanadaBuysClient;
 status(options?:RequestOptions):Promise<ResponseStatus>;
 record(id:string,options?:RequestOptions&{revision?:number}):Promise<SavedResponse>;
 prepare(input:PrepareInput,options?:RequestOptions):Promise<PrepareResult>;
 export(id:string,options?:RequestOptions&{revision?:number}):Promise<ResponseTransfer>;
 editor(id:string,options?:RequestOptions&{revision?:number}):Promise<RawResponse>;
 markdown(id:string,options?:RequestOptions&{revision?:number}):Promise<RawResponse>;
 compare(input:CompareInput,options?:RequestOptions):Promise<CompareResult>;
 apply(input:ApplyInput,options?:RequestOptions):Promise<ApplyResult>;
}
