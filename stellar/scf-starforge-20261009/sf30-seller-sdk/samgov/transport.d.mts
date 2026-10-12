/// <reference types="node" />
export interface SamSourceReceipt {
  request:{method:'GET';url:string};status:number;startedAt?:string;capturedAt:string;
  headers:Record<string,string>;redirects?:Array<{status:number;from:string;to:string}>;
  finalUrl?:string;mediaType:string;filename:string;body:Buffer;originalSha256?:string;
  redactions?:Array<{kind:string;replacements:number}>;retryAt?:string|null;
  /** Private credential-containing original bytes are never public source data. */
  privateOriginalBody?:Buffer;privateOriginalHeaders?:Record<string,string>;
}
export interface SamTransport {
  describe():{endpoint:string;apiKeyEnv:string;keyConfigured:boolean;maxBytes:number;timeoutMs:number;closed:boolean};
  fetchSource(input:{url:string;kind?:'search'|'description'|'attachment';noticeId?:string;filename?:string;
    signal?:AbortSignal;maximumBytes?:number}):Promise<SamSourceReceipt>;
  sanitizeReceipt<T extends {body:Buffer;headers?:Record<string,string>}>(receipt:T):T & {
    body:Buffer;headers:Record<string,string>;originalSha256:string;redactions:Array<{kind:string;replacements:number}>;
    privateOriginalBody?:Buffer;privateOriginalHeaders?:Record<string,string>};
  close():Promise<void>;
}
export function createSamTransport(options?:{apiKeyEnv?:string;endpoint?:string;environment?:Record<string,string|undefined>;
  fetchImpl?:typeof fetch;timeoutMs?:number;maxBytes?:number}):SamTransport;
