// MIT. Same-workspace immutable requests and explicit returned-review adoption.
import { randomUUID } from "node:crypto";
import { clone, digest } from "./model.mjs";
import { RETURN_STATE_SCHEMA, ReviewReturnError, returnData, requestById, requestPreview, responsePreview, text, recipient as normalizeRecipient } from "./review-return.mjs";
import { resolveReviewReturnSource } from "./review-return-source.mjs";
import { reviewReturnReport } from "./review-return-reports.mjs";
const ensure = state => state.customerReviewReturns ??= { schema: RETURN_STATE_SCHEMA, requests: [], responses: [] };
function hash(value) { if (!/^[a-f0-9]{64}$/.test(value ?? "")) throw new ReviewReturnError("Retain the exact displayed preview SHA-256"); return value; }
function keys(args, allowed) {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => !allowed.includes(key)))
    throw new ReviewReturnError("Choose only declared recipient return fields");
}
const requestArgs = ["reviewId", "recipient", "instructions", "requestedBy"];
const returnArgs = ["requestId", "originalText"];
const mutation = ["operationId", "expectedRevision", "expectedPreviewSha256"];
function requestInput(args) {
  return { reviewId: text(args.reviewId, "Saved customer review ID"), recipient: normalizeRecipient(args.recipient),
    instructions: text(args.instructions ?? "", "Review instructions", { blank: true }), requestedBy: text(args.requestedBy, "Requesting operator", { max: 1000 }) };
}
export async function dispatchReviewReturns(workspace, action, args = {}) {
  if (action === "review-return.operation.get") {
    keys(args, ["operationId", "expectedRevision"]);
    text(args.operationId, "Original operation ID");
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0)
      throw new ReviewReturnError("Keep the original expected workspace revision");
    const state = await workspace.read(), operation = state.operations.find(row => row.id === args.operationId);
    return { workspaceId: state.workspaceId, revision: state.revision, operation: clone(operation ?? null),
      absentAtLaterRevision: !operation && state.revision > args.expectedRevision };
  }
  if (action === "review-return.overview") {
    keys(args, []); const state = await workspace.read(), data = returnData(state);
    return { workspaceId: state.workspaceId, revision: state.revision,
      reviews: (state.customerServiceReviews ?? []).map(row => ({ id: row.id, title: row.preview.document.title,
        customer: row.preview.document.customer, edition: row.edition, contentSha256: row.contentSha256 })),
      requests: data.requests.map(row => ({ id: row.id, reviewId: row.source.reviewId, title: row.source.title,
        recipient: clone(row.recipient), createdAt: row.createdAt, contentSha256: row.contentSha256,
        responseCount: data.responses.filter(response => response.requestId === row.id).length })),
      responses: data.responses.map(row => ({ id: row.id, requestId: row.requestId, responseId: row.response.responseId,
        respondent: clone(row.response.respondent), overall: row.response.overall, createdAt: row.createdAt,
        contentSha256: row.contentSha256 })) };
  }
  if (action === "review-return.request.preview") {
    keys(args, requestArgs); const state = await workspace.read(), input = requestInput(args);
    return requestPreview(state, resolveReviewReturnSource(state, input.reviewId), input);
  }
  if (action === "review-return.request.save") {
    keys(args, [...requestArgs, ...mutation]); const input = requestInput(args), expectedPreviewSha256 = hash(args.expectedPreviewSha256);
    return workspace.change(args.operationId, { action, ...input, expectedPreviewSha256 }, args.expectedRevision, state => {
      const preview = requestPreview(state, resolveReviewReturnSource(state, input.reviewId), input);
      if (preview.previewSha256 !== expectedPreviewSha256) throw new ReviewReturnError("The request preview changed. Review it before saving.", 409);
      const body = { ...preview, id: randomUUID(), operationId: args.operationId,
        savedRevision: state.revision + 1, createdAt: new Date().toISOString() };
      const request = { ...body, contentSha256: digest(body) }; ensure(state).requests.push(request);
      return { request: clone(request) };
    });
  }
  if (action === "review-return.response.preview") {
    keys(args, returnArgs); return responsePreview(await workspace.read(), args);
  }
  if (action === "review-return.response.save") {
    keys(args, [...returnArgs, ...mutation, "receivedBy", "operatorNote"]);
    const input = { action, requestId: text(args.requestId, "Original request ID"),
      originalText: text(args.originalText, "Complete original return", { max: 8000000 }),
      expectedPreviewSha256: hash(args.expectedPreviewSha256), receivedBy: text(args.receivedBy, "Receiving operator", { max: 1000 }),
      operatorNote: text(args.operatorNote ?? "", "Operator note", { blank: true }) };
    return workspace.change(args.operationId, input, args.expectedRevision, state => {
      const preview = responsePreview(state, input);
      if (preview.previewSha256 !== input.expectedPreviewSha256) throw new ReviewReturnError("The returned review preview changed. Inspect the current saved history first.", 409);
      if (preview.existingResponseId) throw new ReviewReturnError("This complete response is already saved. Open its existing history or replay the original save operation.", 409);
      const body = { id: randomUUID(), workspaceId: state.workspaceId, savedRevision: state.revision + 1,
        operationId: args.operationId, createdAt: new Date().toISOString(), requestId: preview.requestId,
        requestSha256: preview.requestSha256, originalText: input.originalText, originalSha256: preview.originalSha256,
        responseSha256: preview.responseSha256, response: clone(preview.response), receivedBy: input.receivedBy,
        operatorNote: input.operatorNote, expectedPreviewSha256: input.expectedPreviewSha256 };
      const response = { ...body, contentSha256: digest(body) }; ensure(state).responses.push(response);
      return { response: clone(response) };
    });
  }
  if (action === "review-return.get" || action === "review-return.report") {
    keys(args, action === "review-return.report" ? ["requestId", "format"] : ["requestId"]);
    const state = await workspace.read(), request = requestById(state, args.requestId);
    const responses = returnData(state).responses.filter(row => row.requestId === request.id);
    return { workspaceId: state.workspaceId, revision: state.revision,
      ...(action === "review-return.get" ? { request: clone(request), responses: clone(responses) } :
        reviewReturnReport(request, responses, args.format ?? "json")) };
  }
  throw new ReviewReturnError("Unknown recipient return action", 404);
}
