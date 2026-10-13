// MIT. Projection of the original immutable customer-service-review edition.
import { clone, digest } from "./model.mjs";
import { CUSTOMER_REVIEW } from "./customer-service-review.mjs";
import { ReviewReturnError } from "./review-return.mjs";
export function resolveReviewReturnSource(state, reviewId) {
  const review = (state.customerServiceReviews ?? []).find(row => row.id === reviewId);
  if (!review) throw new ReviewReturnError("Choose an original saved customer service review", 404);
  const { contentSha256, ...body } = review;
  if (review.schema !== CUSTOMER_REVIEW || review.preview?.workspaceId !== state.workspaceId ||
      digest(body) !== contentSha256) throw new ReviewReturnError("The saved customer review edition differs", 409);
  const document = review.preview.document, originals = review.preview.originals;
  const groups = [
    ["assessments", "Service assessment", row => row.assessment.asOf],
    ["evaluations", "Quality evaluation", row => row.title],
    ["comparisons", "Quality comparison", row => row.title],
    ["incidents", "Service incident", row => row.latestFinding?.title ?? row.id],
    ["dispositions", "Quality disposition", row => row.findingId],
    ["followups", "Quality follow-up", row => row.afterFindingId],
    ["results", "Evidence result", row => row.name]
  ];
  const items = [];
  for (const [kind, label, title] of groups) {
    if (!Array.isArray(originals[kind])) throw new ReviewReturnError("The complete saved review selection is missing", 409);
    for (const row of originals[kind]) items.push({
      id: kind + ":" + row.id, title: label + " — " + (title(row) ?? row.id), kind, source: clone(row)
    });
  }
  return { workspaceId: state.workspaceId, reviewId: review.id, review: clone(review),
    title: document.title, customer: document.customer,
    period: document.periodStart + " to " + document.periodEnd, items };
}
