import { LineageClient } from "./client.js";
export interface Recipient { name:string; organisation?:string; reference?:string }
export interface RecipientRequestInput { reviewId:string; recipient:Recipient; requestedBy:string; instructions?:string }
export interface ReviewMutation { operationId:string; expectedRevision:number; expectedPreviewSha256:string }
export interface ReturnedReviewInput { requestId:string; originalText:string; receivedBy:string; operatorNote?:string }
export interface ReviewReturnReport {workspaceId:string;revision:number;mediaType:string;name:string;text:string}
export class ReviewReturnClient extends LineageClient {
 reviewReturns():Promise<Record<string,unknown>>;
 previewRecipientRequest(args:RecipientRequestInput):Promise<Record<string,unknown>>;
 saveRecipientRequest(args:RecipientRequestInput&ReviewMutation):Promise<Record<string,unknown>>;
 previewReturnedReview(requestId:string,originalText:string):Promise<Record<string,unknown>>;
 retainReturnedReview(args:ReturnedReviewInput&ReviewMutation):Promise<Record<string,unknown>>;
 getReviewReturn(requestId:string):Promise<Record<string,unknown>>;
 reviewReturnReport(requestId:string,format?:"editable"|"json"|"html"):Promise<ReviewReturnReport>;
 reviewReturnOperation(operationId:string,expectedRevision:number):Promise<Record<string,unknown>>;
}
