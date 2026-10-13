export declare class AnalysisReportReviewClient{
 constructor(options:{launch:unknown;workspaceId:string;signal?:AbortSignal});
 readonly workspaceId:string;
 state():Promise<Record<string,unknown>>;
 history(options?:{before?:number;limit?:number}):Promise<Record<string,unknown>>;
 detail(id:string,options?:{returns_before?:number;applies_before?:number;limit?:number}):Promise<Record<string,unknown>>;
 returned(id:string):Promise<Record<string,unknown>>;
 status(id:string):Promise<Record<string,unknown>>;
 preview(id:string,mapping?:Array<number|null>|null):Promise<Record<string,unknown>>;
 download(id:string,name:'review.html'|'package.json',output:string):Promise<{bytes:number;sha256:string;path:string}>;
 dispatch(action:'issue'|'receive'|'apply',request:Record<string,unknown>,options?:{returnId?:string}):Promise<Record<string,unknown>>;
 mutate(action:'issue'|'receive'|'apply',request:Record<string,unknown>,operation:string,options?:{returnId?:string}):Promise<Record<string,unknown>>;
 close():void;
}
export declare const REPORT_REVIEW_ID:RegExp;
export declare const REPORT_REVIEW_SHA:RegExp;
export declare const REPORT_REVIEW_MAX_RETURN:number;
export declare function canonical(value:unknown):string;
export declare function encode(value:unknown):Uint8Array;
export declare function digest(value:string|Uint8Array):string;
export declare function need(ok:unknown,message:string,code?:string):asserts ok;
export declare function identity(value:string):string;
export declare function plain(value:unknown):value is Record<string,unknown>;
