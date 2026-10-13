// Declaration .js resolution binds the shipped client.d.ts; runtime imports client.mjs.
import {LineageClient} from "./client.js";
export interface CustomerReviewDocument {
 schema:"commons.openlineage.customer-review-document.v1";title:string;customer:string;periodStart:string;periodEnd:string;
 scope:string;narrative?:string;recordedBy:string;assessmentIds:string[];evaluationIds:string[];comparisonIds:string[];resultIds:string[];
 supersedes?:null|{id:string;contentSha256:string};
}
export type CustomerReviewOriginalKind="assessment"|"evaluation"|"comparison"|"result";
export type OriginalRecord=Record<string,unknown>&{id:string};
export interface CustomerReviewOriginals {
 assessments:OriginalRecord[];evaluations:OriginalRecord[];comparisons:OriginalRecord[];incidents:OriginalRecord[];
 dispositions:OriginalRecord[];followups:OriginalRecord[];editions:OriginalRecord[];sources:OriginalRecord[];events:OriginalRecord[];results:OriginalRecord[];
}
export type CustomerReviewCounts={ [K in keyof CustomerReviewOriginals]:number };
export interface CustomerReviewPreview {
 schema:"commons.openlineage.customer-review-preview.v1";workspaceId:string;sourceRevision:number;
 document:Required<CustomerReviewDocument>;originals:CustomerReviewOriginals;counts:CustomerReviewCounts;
 lineage:null|{id:string;edition:number;previousId:string;previousSha256:string};notice:string;previewSha256:string;
}
export interface CustomerServiceReview {
 schema:"commons.openlineage.customer-review.v1";id:string;lineageId:string;edition:number;operationId:string;
 revision:number;createdAt:string;preview:CustomerReviewPreview;contentSha256:string;
}
export interface CustomerReviewSummary {
 id:string;lineageId:string;edition:number;title:string;customer:string;periodStart:string;periodEnd:string;recordedBy:string;
 createdAt:string;sourceRevision:number;revision:number;contentSha256:string;previewSha256:string;
 supersedes:null|{id:string;contentSha256:string};counts:CustomerReviewCounts;
}
export interface CustomerReviewChoice extends OriginalRecord {title:string;createdAt:string;sha256:string;}
export interface CustomerReviewOverview {
 workspaceId:string;revision:number;reviews:CustomerReviewSummary[];
 choices:{assessments:CustomerReviewChoice[];evaluations:CustomerReviewChoice[];comparisons:CustomerReviewChoice[];results:CustomerReviewChoice[]};
}
export interface CustomerReviewRequest {operationId:string;expectedRevision:number;document:CustomerReviewDocument;expectedPreviewSha256:string;}
export interface CustomerReviewReceipt {workspaceId:string;revision:number;operationId:string;replayed?:boolean;customerReview:CustomerServiceReview;}
export type CustomerReviewRequestObservation={found:false;workspaceId:string;revision:number;requestHash:string}|
 {found:true;workspaceId:string;revision:number;requestHash:string;result:CustomerReviewReceipt};
export class CustomerServiceReviewClient extends LineageClient {
 readCustomerReviews():Promise<CustomerReviewOverview>;
 readCustomerReviewOriginal(kind:CustomerReviewOriginalKind,id:string,expectedSha256:string):Promise<{workspaceId:string;revision:number;kind:CustomerReviewOriginalKind;sha256:string;original:OriginalRecord}>;
 previewCustomerReview(document:CustomerReviewDocument):Promise<CustomerReviewPreview>;
 saveCustomerReview(args:CustomerReviewRequest):Promise<CustomerReviewReceipt>;
 getCustomerReview(id:string):Promise<{workspaceId:string;revision:number;customerReview:CustomerServiceReview}>;
 customerReviewReport(id:string,format?:"json"|"csv"|"html"):Promise<{workspaceId:string;revision:number;id:string;mediaType:string;text:string}>;
 findCustomerReviewRequest(args:CustomerReviewRequest):Promise<CustomerReviewRequestObservation>;
}
