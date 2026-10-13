export interface ApplicationInputSetEditionAPI {
 applicationInputSetEditionReview(input:{selectionRequestId:string;name?:string}):Promise<Record<string,unknown>>;
 applicationInputSetEditionCapture(input:{requestId:string;review:Record<string,unknown>}):Promise<Record<string,unknown>>;
 applicationInputSetEditionRead(input:{requestId:string}):Promise<Record<string,unknown>>;
 applicationInputSetEditionReceived(input:{requestId:string}):Promise<Record<string,unknown>>;
 applicationInputSetEditionsState(input?:{selectionRequestId?:string;offset?:number;limit?:number}):Promise<Record<string,unknown>>;
 applicationInputSetEditionExport(input:{requestId:string;directory:string}):Promise<Record<string,unknown>>;
 applicationInputSetEditionReceive(input:{requestId:string;directory:string}):Promise<Record<string,unknown>>;
}
export declare function createApplicationInputSetEditionsAPI(root:string,workspaceId:string,model:()=>Record<string,unknown>):ApplicationInputSetEditionAPI;
