export interface ApplicationResultSelection {applicationId:string;operationId:string;directory:string;name:string;actor:string;note:string}
export interface ApplicationResultSetsAPI {
 applicationResultSetsState(input?:{applicationId?:string;offset?:number;limit?:number}):Promise<Record<string,unknown>>;
 applicationResultSetReview(input:ApplicationResultSelection):Promise<Record<string,unknown>>;
 applicationResultSetCapture(input:{requestId:string;review:Record<string,unknown>}):Promise<Record<string,unknown>>;
 applicationResultSetRead(input:{requestId:string}):Promise<Record<string,unknown>>;
 applicationResultSetReceived(input:{requestId:string}):Promise<Record<string,unknown>>;
 applicationResultSetExport(input:{requestId:string;directory:string;origin?:'capture'|'received'}):Promise<Record<string,unknown>>;
 applicationResultSetReceive(input:{requestId:string;directory:string}):Promise<Record<string,unknown>>;
}
export declare const APPLICATION_RESULT_REVIEW_SCHEMA:string;
export declare const APPLICATION_RESULT_CAPTURE_SCHEMA:string;
export declare const APPLICATION_RESULT_HANDOFF_SCHEMA:string;
export declare const APPLICATION_RESULT_REVIEW_MAX_BYTES:number;
export declare function validateApplicationResultReview(review:unknown):Record<string,unknown>;
export declare function createApplicationResultSetsAPI(root:string,workspaceId:string,model:()=>Record<string,unknown>):ApplicationResultSetsAPI;
