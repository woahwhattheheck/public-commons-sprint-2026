// MIT. Reuse the original HTTP owner and complete workspace operation journal.
import { LineageClient } from "./client.mjs";
import { normalizePolicyPlan } from "./service-policy-rollout.mjs";
import { digest } from "./model.mjs";

export class PolicyRolloutClient extends LineageClient {
  readPolicyRollouts() { return this.action("service-policy-rollout.read"); }
  previewPolicyRollout(plan) { return this.action("service-policy-rollout.preview", { plan }); }
  applyPolicyRollout(args) { return this.action("service-policy-rollout.apply", args); }
  getPolicyRollout(id) { return this.action("service-policy-rollout.get", { id }); }
  policyRolloutReport(id, format = "json") { return this.action("service-policy-rollout.report", { id, format }); }
  async findPolicyRolloutRequest(args) {
    const captured = structuredClone(args);
    const plan = normalizePolicyPlan(captured.plan);
    if (Object.keys(captured).sort().join(",") !== "expectedPreviewSha256,expectedRevision,operationId,plan" ||
        typeof captured.operationId !== "string" || !captured.operationId.trim() || captured.operationId.length > 400 || captured.operationId.includes("\0") ||
        !/^[0-9a-f]{64}$/.test(captured.expectedPreviewSha256) ||
        !Number.isSafeInteger(captured.expectedRevision) || captured.expectedRevision < 0)
      throw new Error("Use the complete retained original rollout request");
    const requestHash = digest({ action:"service-policy-rollout.apply", plan, expectedPreviewSha256:captured.expectedPreviewSha256 });
    const metadata = await this.metadata();
    let offset = 0;
    for (;;) {
      const page = await this.records({collection:"operations",expectedRevision:metadata.revision,offset,limit:1000});
      const row = page.items.find(item => item.id === captured.operationId.trim());
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
