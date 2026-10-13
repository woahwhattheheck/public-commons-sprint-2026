// MIT. Reuse the original HTTP owner and complete workspace operation journal.
import { LineageClient } from "./client.mjs";
import { normalizeCustomerReviewDocument } from "./customer-service-review.mjs";
import { digest } from "./model.mjs";

export class CustomerServiceReviewClient extends LineageClient {
  readCustomerReviews() { return this.action("customer-review.overview"); }
  readCustomerReviewOriginal(kind,id,expectedSha256) { return this.action("customer-review.original",{kind,id,expectedSha256}); }
  previewCustomerReview(document) { return this.action("customer-review.preview", { document }); }
  saveCustomerReview(args) { return this.action("customer-review.save", args); }
  getCustomerReview(id) { return this.action("customer-review.get", { id }); }
  customerReviewReport(id, format = "json") { return this.action("customer-review.report", { id, format }); }
  async findCustomerReviewRequest(args) {
    const captured = structuredClone(args);
    const document = normalizeCustomerReviewDocument(captured.document);
    if (Object.keys(captured).sort().join(",") !== "document,expectedPreviewSha256,expectedRevision,operationId" ||
        typeof captured.operationId !== "string" || !captured.operationId.trim() || captured.operationId.length > 400 || captured.operationId.includes("\0") ||
        !/^[0-9a-f]{64}$/.test(captured.expectedPreviewSha256) ||
        !Number.isSafeInteger(captured.expectedRevision) || captured.expectedRevision < 0)
      throw new Error("Use the complete retained original customer review request");
    const requestHash = digest({ action:"customer-review.save", document, expectedPreviewSha256:captured.expectedPreviewSha256 });
    const metadata = await this.metadata();
    let offset = 0;
    for (;;) {
      const page = await this.records({collection:"operations",expectedRevision:metadata.revision,offset,limit:1000});
      const row = page.items.find(item => item.id === captured.operationId);
      if (row) {
        if (row.requestHash !== requestHash) throw Object.assign(new Error("Original operation ID belongs to different arguments"),{status:409});
        return {found:true,workspaceId:metadata.workspaceId,revision:metadata.revision,requestHash,result:row.result};
      }
      if (page.nextOffset === null) return {found:false,workspaceId:metadata.workspaceId,revision:metadata.revision,requestHash};
      if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error("Original operation history made no progress");
      offset=page.nextOffset;
    }
  }
}
