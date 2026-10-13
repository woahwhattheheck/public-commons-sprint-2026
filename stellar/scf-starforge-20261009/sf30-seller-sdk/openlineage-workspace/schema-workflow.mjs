// MIT. Saved schema review uses the original workspace writer, revision and operation recovery.
import { randomUUID } from "node:crypto";
import { canonical, clone } from "./model.mjs";
import {
  SchemaError, SCHEMA_REVIEW, SCHEMA_DECISIONS, compareSchemas, comparisonChanges,
  schemaImpact, reviewSummary, resolveEvidence, schemaReport, schemaReportCsv, schemaReportHtml
} from "./schema-domain.mjs";

function text(value, name, { optional = false } = {}) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string" || !optional && !value.trim()) throw new SchemaError(name + " is required.");
  return value;
}
function conflict(message, details) { const error = new SchemaError(message, details); error.status = 409; throw error; }
function exactComparison(state, args) {
  const comparison = compareSchemas(state, args);
  if (args.comparisonId !== undefined && comparison.id !== args.comparisonId)
    conflict("The selected comparison differs from the original saved editions.", { comparisonId: comparison.id });
  return comparison;
}
export async function saveSchemaReview(workspace, args) {
  const { operationId, expectedRevision } = args;
  const id = args.id ?? null;
  if (id !== null) text(id, "Existing review ID");
  const from = text(args.from, "Before edition"), to = text(args.to, "After edition");
  const comparisonId = text(args.comparisonId, "Original comparison ID");
  const reviewer = text(args.reviewer, "Reviewer"), reason = text(args.reason, "Decision reason");
  const owner = text(args.owner, "Follow-up owner", { optional: true });
  const action = text(args.action, "Follow-up action", { optional: true });
  const resolution = text(args.resolution, "Resolution", { optional: true });
  if (!SCHEMA_DECISIONS.includes(args.decision)) throw new SchemaError("Choose observed, needs-work, accepted or resolved.");
  if (!Array.isArray(args.changeIds) || !args.changeIds.length || args.changeIds.some(value => typeof value !== "string") ||
      new Set(args.changeIds).size !== args.changeIds.length) throw new SchemaError("Select distinct original schema changes.");
  if (args.decision === "needs-work" && (!owner.trim() || !action.trim()))
    throw new SchemaError("Assign an owner and next action for changes that need work.");
  if (args.decision === "resolved" && !resolution.trim())
    throw new SchemaError("Describe the completed resolution.");
  const evidence = args.evidence ?? [];
  if (!Array.isArray(evidence)) throw new SchemaError("Evidence must be a list.");
  const input = { action: "schema.review.save", id, from, to, comparisonId, changeIds: [...args.changeIds],
    reviewer, reason, owner, followUpAction: action, resolution, decision: args.decision, evidence: clone(evidence) };
  return workspace.change(operationId, input, expectedRevision, state => {
    const comparison = exactComparison(state, { from, to, comparisonId });
    const validChanges = new Set(comparisonChanges(comparison).map(change => change.id));
    if (input.changeIds.some(changeId => !validChanges.has(changeId)))
      throw new SchemaError("A selected change is absent from the original comparison.");
    state.schemaComparisons ??= []; state.schemaReviews ??= [];
    const prior = id === null ? null : state.schemaReviews.find(review => review.id === id);
    if (id !== null && !prior) throw new SchemaError("The selected schema review is absent.");
    if (prior && (prior.comparisonId !== comparisonId || canonical(prior.changeIds) !== canonical(input.changeIds)))
      conflict("An existing review keeps its original comparison and change selection. Create a separate review for another selection.",
        { reviewId: prior.id, comparisonId: prior.comparisonId, changeIds: prior.changeIds });
    const selectedEvidence = resolveEvidence(state, evidence);
    const now = new Date().toISOString();
    const previous = prior ? clone(prior) : null;
    if (previous) delete previous.history;
    const review = { schema: SCHEMA_REVIEW, workspaceId: state.workspaceId, id: id ?? randomUUID(),
      comparisonId, from, to, changeIds: [...input.changeIds], reviewer, decision: input.decision, reason,
      owner, action, resolution, evidence: selectedEvidence, savedRevision: state.revision + 1,
      createdAt: prior?.createdAt ?? now, updatedAt: now, history: prior ? [...prior.history, previous] : [] };
    if (!state.schemaComparisons.some(value => value.id === comparisonId)) state.schemaComparisons.push(comparison);
    if (prior) state.schemaReviews[state.schemaReviews.findIndex(value => value.id === id)] = review;
    else state.schemaReviews.push(review);
    return { review, comparisonId, summary: reviewSummary(state, comparison) };
  });
}
export async function dispatchSchema(workspace, action, args = {}) {
  if (action === "schema.review.save") return saveSchemaReview(workspace, args);
  const state = await workspace.read();
  if (action === "schema.compare") {
    const comparison = exactComparison(state, args);
    return { workspaceId: state.workspaceId, revision: state.revision, comparison, ...reviewSummary(state, comparison) };
  }
  if (action === "schema.impact") {
    const comparison = exactComparison(state, args);
    return { workspaceId: state.workspaceId, revision: state.revision, ...schemaImpact(comparison, args) };
  }
  if (action === "schema.report") {
    const value = schemaReport(state, args);
    if (args.format === undefined || args.format === "json")
      return { mediaType: "application/json", text: JSON.stringify(value, null, 2) };
    if (args.format === "csv") return { mediaType: "text/csv", text: schemaReportCsv(value) };
    if (args.format === "html") return { mediaType: "text/html", text: schemaReportHtml(value) };
    throw new SchemaError("Choose a JSON, CSV or HTML schema report.");
  }
  throw new SchemaError("Unknown schema action: " + action);
}
