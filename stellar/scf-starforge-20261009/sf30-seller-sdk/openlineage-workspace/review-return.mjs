// MIT. Complete recipient responses retain the original saved review and entered return.
import { clone, canonical, digest, sha256 } from "./model.mjs";
export const RETURN_STATE_SCHEMA = "commons.openlineage.review-returns.v1";
export const REQUEST_SCHEMA = "commons.openlineage.recipient-review.v1";
export const RESPONSE_SCHEMA = "commons.openlineage.recipient-review-response.v1";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const HASH = /^[0-9a-f]{64}$/;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
export class ReviewReturnError extends Error {
  constructor(message, status = 400) { super(message); this.name = "ReviewReturnError"; this.status = status; }
}
const need = (ok, message, status) => { if (!ok) throw new ReviewReturnError(message, status); };
export function text(value, label, { blank = false, max = 100000 } = {}) {
  need(typeof value === "string" && (blank || value.trim()) && value.length <= max, label + " must be text within the supported length");
  return value;
}
function exactKeys(value, names, label) {
  need(object(value) && Object.keys(value).every(key => names.includes(key) && !forbidden.has(key)), "Invalid " + label + " fields");
}
function plain(value, depth = 0) {
  need(depth <= 60, "The complete review exceeds the supported JSON nesting");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { need(Number.isFinite(value), "Review numbers must be finite"); return; }
  if (Array.isArray(value)) { for (const item of value) plain(item, depth + 1); return; }
  need(object(value) && Object.getPrototypeOf(value) === Object.prototype, "Keep plain complete JSON source");
  for (const [key, item] of Object.entries(value)) { need(!forbidden.has(key), "Unsupported review object key"); plain(item, depth + 1); }
}
export function jsonSize(value) {
  plain(value); need(Buffer.byteLength(JSON.stringify(value), "utf8") <= 8000000, "Review package exceeds the 8 MB receiving limit"); return value;
}
export function recipient(value) {
  exactKeys(value, ["name", "organisation", "reference"], "recipient");
  return { name: text(value.name, "Recipient name", { max: 1000 }),
    organisation: text(value.organisation ?? "", "Recipient organisation", { blank: true, max: 1000 }),
    reference: text(value.reference ?? "", "Recipient reference", { blank: true, max: 2000 }) };
}
// The existing review author supplies this adapter projection from its saved edition.
// Each complete source record is retained; this module never recomputes service or quality outcomes.
export function normalizeReviewReturnSource(state, supplied) {
  jsonSize(supplied);
  exactKeys(supplied, ["workspaceId", "reviewId", "review", "title", "customer", "period", "items"], "saved review source");
  need(supplied.workspaceId === state.workspaceId, "Choose a review from this original workspace", 409);
  const reviewId = text(supplied.reviewId, "Saved review ID", { max: 1000 });
  need(object(supplied.review), "Retain the complete saved review edition");
  const ids = new Set();
  need(Array.isArray(supplied.items) && supplied.items.length <= 10000, "Keep the complete selected review items");
  const items = supplied.items.map(item => {
    exactKeys(item, ["id", "title", "kind", "source"], "review item");
    const id = text(item.id, "Original review item ID", { max: 2000 });
    need(!ids.has(id), "Review item IDs must be distinct"); ids.add(id);
    need(object(item.source) || Array.isArray(item.source), "Keep the complete source for each review item");
    return { id, title: text(item.title, "Review item title", { max: 4000 }),
      kind: text(item.kind, "Review item kind", { max: 1000 }), source: clone(item.source) };
  });
  return { workspaceId: state.workspaceId, reviewId, review: clone(supplied.review),
    title: text(supplied.title, "Review title", { max: 4000 }),
    customer: text(supplied.customer ?? "", "Review customer", { blank: true, max: 4000 }),
    period: text(supplied.period ?? "", "Review period", { blank: true, max: 4000 }), items };
}
export function returnData(state) {
  return state.customerReviewReturns ?? { schema: RETURN_STATE_SCHEMA, requests: [], responses: [] };
}
export function requestById(state, id) {
  const selected = returnData(state).requests.find(row => row.id === id);
  need(selected, "Unknown saved recipient review", 404); return selected;
}
export function requestPreview(state, source, args) {
  const normalized = normalizeReviewReturnSource(state, source);
  const body = { schema: REQUEST_SCHEMA, workspaceId: state.workspaceId, revision: state.revision,
    source: normalized, sourceSha256: digest(normalized), recipient: recipient(args.recipient),
    instructions: text(args.instructions ?? "", "Review instructions", { blank: true }),
    requestedBy: text(args.requestedBy, "Requesting operator", { max: 1000 }) };
  return { ...body, previewSha256: digest(body) };
}
function timestamp(value, label) {
  need(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)), "Keep an ISO UTC " + label); return value;
}
export function parseReturnedReview(originalText, request) {
  text(originalText, "Complete returned JSON", { max: 8000000 });
  need(Buffer.byteLength(originalText, "utf8") <= 8000000, "Returned JSON exceeds 8 MB");
  let value; try { value = JSON.parse(originalText); } catch { throw new ReviewReturnError("Choose the complete downloaded response JSON"); }
  jsonSize(value);
  exactKeys(value, ["schema", "responseId", "workspaceId", "requestId", "requestSha256", "sourceSha256",
    "respondent", "respondedAt", "overall", "comment", "items"], "returned response");
  need(value.schema === RESPONSE_SCHEMA && value.workspaceId === request.workspaceId &&
    value.requestId === request.id && value.requestSha256 === request.contentSha256 &&
    value.sourceSha256 === request.sourceSha256, "The return belongs to a different original review request", 409);
  text(value.responseId, "Original response ID", { max: 1000 });
  exactKeys(value.respondent, ["name", "organisation", "role"], "respondent");
  const respondent = { name: text(value.respondent.name, "Respondent name", { max: 1000 }),
    organisation: text(value.respondent.organisation ?? "", "Respondent organisation", { blank: true, max: 1000 }),
    role: text(value.respondent.role ?? "", "Respondent role", { blank: true, max: 1000 }) };
  need(["comments", "acknowledged", "changes_requested"].includes(value.overall), "Choose an overall response");
  const comment = text(value.comment, "Overall response comment", { blank: true });
  need(Array.isArray(value.items) && value.items.length === request.source.items.length, "Return every original review item exactly once");
  const originals = new Map(request.source.items.map(row => [row.id, row])), seen = new Set();
  const items = value.items.map(row => {
    exactKeys(row, ["itemId", "sourceSha256", "response", "comment"], "item response");
    const original = originals.get(row.itemId);
    need(original && !seen.has(row.itemId) && row.sourceSha256 === digest(original), "Returned item source or identity differs", 409);
    seen.add(row.itemId);
    need(["not_reviewed", "acknowledged", "question", "change_requested"].includes(row.response), "Choose an item response");
    const entered = text(row.comment, "Item response comment", { blank: true });
    if (["question", "change_requested"].includes(row.response)) need(entered.trim(), "Explain each question or requested change");
    return { itemId: row.itemId, sourceSha256: row.sourceSha256, response: row.response, comment: entered };
  });
  if (value.overall === "acknowledged") need(items.every(row => row.response === "acknowledged"),
    "Acknowledge all original items before choosing overall acknowledgment");
  if (value.overall === "changes_requested") need(comment.trim() || items.some(row => row.response === "change_requested"),
    "Explain the requested change");
  return { schema: RESPONSE_SCHEMA, responseId: value.responseId, workspaceId: value.workspaceId,
    requestId: value.requestId, requestSha256: value.requestSha256, sourceSha256: value.sourceSha256,
    respondent, respondedAt: timestamp(value.respondedAt, "response time"), overall: value.overall, comment, items };
}
export function responsePreview(state, args) {
  const request = requestById(state, text(args.requestId, "Original request ID"));
  const response = parseReturnedReview(args.originalText, request);
  const originalSha256 = sha256(Buffer.from(args.originalText, "utf8")), responseSha256 = digest(response);
  const previous = returnData(state).responses.find(row => row.response.responseId === response.responseId);
  if (previous && previous.responseSha256 !== responseSha256)
    throw new ReviewReturnError("This response identity already refers to a different saved return. Preserve it and export a new response edition.", 409);
  const counts = { not_reviewed: 0, acknowledged: 0, question: 0, change_requested: 0 };
  response.items.forEach(row => counts[row.response]++);
  const body = { workspaceId: state.workspaceId, revision: state.revision, requestId: request.id,
    requestSha256: request.contentSha256, originalSha256, responseSha256, response,
    recipient: clone(request.recipient), counts, existingResponseId: previous?.id ?? null };
  return { ...body, previewSha256: digest(body) };
}
export function validateReviewReturns(state, resolveSource) {
  if (state.customerReviewReturns === undefined) return state;
  const data = state.customerReviewReturns;
  need(object(data) && data.schema === RETURN_STATE_SCHEMA && Array.isArray(data.requests) &&
    Array.isArray(data.responses), "Invalid complete recipient return history");
  const ids = new Set(), responseIds = new Set(), operationIds = new Set();
  const saved = (row, label) => {
    need(object(row) && typeof row.id === "string" && !ids.has(row.id) && HASH.test(row.contentSha256 ?? ""),
      "Invalid or duplicate " + label); ids.add(row.id);
    const { contentSha256, ...body } = row;
    need(digest(body) === contentSha256 && row.workspaceId === state.workspaceId &&
      Number.isSafeInteger(row.savedRevision) && row.savedRevision > 0 && row.savedRevision <= state.revision,
      label + " identity or content differs", 409); timestamp(row.createdAt, label + " creation time");
    text(row.operationId, "Original save operation");
    need(!operationIds.has(row.operationId), "Duplicate recipient-return save operation"); operationIds.add(row.operationId);
  };
  for (const row of data.requests) {
    saved(row, "saved recipient request");
    need(row.schema === REQUEST_SCHEMA && row.revision === row.savedRevision - 1, "Original request preview revision differs", 409);
    const { id, operationId, savedRevision, createdAt, contentSha256, previewSha256, ...previewBody } = row;
    need(digest(previewBody) === previewSha256, "Original request preview differs", 409);
    const operation = state.operations.find(item => item.id === operationId);
    const originalInput = { action: "review-return.request.save", reviewId: row.source.reviewId, recipient: row.recipient,
      instructions: row.instructions, requestedBy: row.requestedBy, expectedPreviewSha256: previewSha256 };
    need(operation && operation.requestHash === digest(originalInput) && operation.result?.workspaceId === state.workspaceId &&
      operation.result.operationId === operationId && operation.result.revision === savedRevision &&
      canonical(operation.result.request) === canonical(row), "The original recipient request receipt differs", 409);
    const normalized = normalizeReviewReturnSource(state, row.source);
    need(digest(normalized) === row.sourceSha256, "Saved request source differs", 409);
    recipient(row.recipient); text(row.requestedBy, "Requesting operator"); text(row.instructions, "Instructions", { blank: true });
    if (resolveSource) {
      const current = normalizeReviewReturnSource(state, resolveSource(state, row.source.reviewId));
      need(canonical(current) === canonical(normalized), "The original saved review edition differs", 409);
    }
  }
  for (const row of data.responses) {
    saved(row, "saved recipient response");
    const request = requestById(state, row.requestId), response = parseReturnedReview(row.originalText, request);
    need(request.savedRevision < row.savedRevision, "The original recipient request must precede its response", 409);
    need(!responseIds.has(response.responseId), "Duplicate returned response identity"); responseIds.add(response.responseId);
    need(canonical(response) === canonical(row.response) && digest(response) === row.responseSha256 &&
      sha256(Buffer.from(row.originalText, "utf8")) === row.originalSha256 &&
      row.requestSha256 === request.contentSha256, "Saved original return bytes or source differ", 409);
    text(row.receivedBy, "Receiving operator"); text(row.operatorNote, "Operator note", { blank: true });
    const operation = state.operations.find(item => item.id === row.operationId);
    const originalInput = { action: "review-return.response.save", requestId: row.requestId, originalText: row.originalText,
      expectedPreviewSha256: row.expectedPreviewSha256, receivedBy: row.receivedBy, operatorNote: row.operatorNote };
    need(operation && operation.requestHash === digest(originalInput) && operation.result?.workspaceId === state.workspaceId &&
      operation.result.operationId === row.operationId && operation.result.revision === row.savedRevision &&
      canonical(operation.result.response) === canonical(row), "The original returned-response receipt differs", 409);
    const originalState = { ...state, revision: row.savedRevision - 1, customerReviewReturns: {
      ...data, requests: data.requests.filter(item => item.savedRevision < row.savedRevision), responses: data.responses.filter(item => item.savedRevision < row.savedRevision) } };
    need(responsePreview(originalState, { requestId: row.requestId, originalText: row.originalText }).previewSha256 === row.expectedPreviewSha256,
      "The reviewed returned-response preview differs", 409);
  }
  return state;
}
