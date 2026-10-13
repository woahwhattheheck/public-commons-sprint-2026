import { serviceLevelTools } from "./service-levels-catalog.mjs";
import { qualityTools } from "./quality-catalog.mjs";
import { policyRolloutTools } from "./service-policy-rollout-catalog.mjs";
import { customerReviewTools } from "./customer-service-review-catalog.mjs";
import { reviewReturnTools } from "./review-return-catalog.mjs";
import { qualityFollowupTools } from "./quality-followup-catalog.mjs";

const string = { type: "string" };
const integer = { type: "integer", minimum: 0 };
const stringList = { type: "array", items: string, minItems: 1 };
const evidence = { type: "array", items: { type: "object", properties: { kind: { enum: ["source", "event", "result"] }, id: string }, required: ["kind", "id"], additionalProperties: false } };
const schemaSelection = { from: string, to: string, comparisonId: string };
const mutation = { operationId: string, expectedRevision: integer };
const definitions = [
  ["workspace.metadata", "Read the exact original workspace identity, revision and complete record counts.", {}, []],
  ["records.read", "Page an original collection at its selected workspace revision; continue nextOffset until null. Operation history is workspace-wide: omit edition.", { collection: { enum: ["jobs", "datasets", "runs", "edges", "observedEdges", "sources", "events", "editions", "reviews", "results", "diagnostics", "operations", "schemaComparisons", "schemaReviews", "qualityRules", "qualityEvaluations", "qualityDispositions", "qualityComparisons", "qualityFollowups", "servicePolicyRollouts", "customerServiceReviews", "customerReviewRequests", "customerReviewResponses"] }, edition: string, expectedRevision: integer, offset: integer, limit: { type: "integer", minimum: 1, maximum: 1000 } }, ["collection", "expectedRevision"]],
  ["object.read", "Read exact original source/result bytes in content-bound ranges.", { id: string, offset: integer, length: { type: "integer", minimum: 1, maximum: 4194304 } }, ["id"]],
  ["workspace.read", "Read the saved project and original jobs, datasets and runs.", { edition: string }, []],
  ["source.import", "Retain original OpenLineage JSON/NDJSON bytes and import their event observations.", { ...mutation, name: string, sourceUrl: string, text: string, base64: string, contentEncoding: { enum: ["identity", "gzip"] } }, ["operationId", "expectedRevision", "name"]],
  ["source.read", "Read complete original source or attached result bytes by content identity.", { id: string, decode: { type: "boolean" } }, ["id"]],
  ["entity.read", "Inspect one exact job, dataset or run with its original events, reviews and results.", { key: string, edition: string }, ["key"]],
  ["lineage.read", "Read source-linked lineage around one exact entity.", { key: string, edition: string, direction: { enum: ["upstream", "downstream", "both"] }, maxDepth: { type: "integer", minimum: 0, maximum: 64 } }, ["key"]],
  ["edition.save", "Save the exact current event/source selection as a named immutable edition.", { ...mutation, title: string, description: string }, ["operationId", "expectedRevision", "title"]],
  ["edition.compare", "Compare original entity definitions, boundaries and run outcomes between saved editions.", { from: string, to: string }, ["from"]],
  ["schema.compare", "Compare observed schema facets and nested fields between two named saved editions, retaining exact original events and staff decisions.", schemaSelection, ["from", "to"]],
  ["schema.impact", "Trace the selected change through declared field relationships in both original editions, with event paths and unresolved field identities.", { ...schemaSelection, changeId: string }, ["from", "to", "comparisonId", "changeId"]],
  ["schema.review.save", "Save or revise a staff decision for exact schema changes, with assignment, resolution and original evidence. Recover the same operation after an interrupted response.", { ...mutation, ...schemaSelection, id: string, changeIds: stringList, reviewer: string, decision: { enum: ["observed", "needs-work", "accepted", "resolved"] }, reason: string, owner: string, action: string, resolution: string, evidence }, ["operationId", "expectedRevision", "from", "to", "comparisonId", "changeIds", "reviewer", "decision", "reason"]],
  ["schema.report", "Produce the complete schema comparison, staff decisions, original evidence and declared downstream impact as JSON, spreadsheet-safe CSV or printable HTML.", { from: string, to: string, format: { enum: ["json", "csv", "html"] } }, ["from", "to"]],
  ["review.save", "Save a reasoned operator decision against selected original entities and a reviewed revision.", { ...mutation, id: string, title: string, reason: string, decision: { enum: ["accepted", "needs-work", "excluded", "observed"] }, entityKeys: stringList, editionId: string }, ["operationId", "expectedRevision", "title", "reason", "decision", "entityKeys"]],
  ["result.attach", "Attach complete existing result bytes to their original saved dataset/run context.", { ...mutation, name: string, base64: string, mediaType: string, entityKeys: stringList, editionId: string, sourceReference: string, query: {} }, ["operationId", "expectedRevision", "name", "base64", "entityKeys", "editionId", "sourceReference"]],
  ["workspace.export", "Export complete original sources, results, history and editable application source.", { includeApplication: { type: "boolean" } }, []],
  ["export.read", "Read an exact byte range from an existing export; continue using the returned nextOffset.", { id: string, offset: integer, length: { type: "integer", minimum: 1, maximum: 4194304 } }, ["id"]],
  ["report.read", "Produce the complete JSON, spreadsheet-safe CSV or printable HTML project report.", { edition: string, format: { enum: ["json", "csv", "html"] } }, []]
];
export const tools = [...reviewReturnTools, ...customerReviewTools, ...policyRolloutTools, ...serviceLevelTools, ...qualityTools, ...qualityFollowupTools, ...definitions.map(([action, description, properties, required]) => ({
  name: "lineage_" + action.replaceAll(".", "_"), description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: !["source.import", "edition.save", "review.save", "result.attach", "schema.review.save", "workspace.export"].includes(action), destructiveHint: false, idempotentHint: true, openWorldHint: false },
  action
}))];
