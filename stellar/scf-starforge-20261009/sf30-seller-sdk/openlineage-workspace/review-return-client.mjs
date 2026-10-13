// MIT. Preserve the original LineageClient transport, instance and workspace binding.
import { LineageClient } from "./client.mjs";
export class ReviewReturnClient extends LineageClient {
  reviewReturns(){return this.action("review-return.overview");}
  previewRecipientRequest(args){return this.action("review-return.request.preview",args);}
  saveRecipientRequest(args){return this.action("review-return.request.save",args);}
  previewReturnedReview(requestId,originalText){return this.action("review-return.response.preview",{requestId,originalText});}
  retainReturnedReview(args){return this.action("review-return.response.save",args);}
  getReviewReturn(requestId){return this.action("review-return.get",{requestId});}
  reviewReturnReport(requestId,format="json"){return this.action("review-return.report",{requestId,format});}
  reviewReturnOperation(operationId,expectedRevision){return this.action("review-return.operation.get",{operationId,expectedRevision});}
}
