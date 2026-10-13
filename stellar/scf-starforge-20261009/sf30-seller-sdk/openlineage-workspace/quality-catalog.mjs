const string = { type: "string", minLength: 1 };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const integer = { type: "integer", minimum: 0 };
const selection = { edition: string, datasetKey: string, runKey: string };
const mutation = { operationId: string, expectedRevision: integer };
const rule = { type: "object", additionalProperties: false,
  properties: { id: string, version: { type: "integer", minimum: 1 }, title: string, datasetKey: string,
    enabled: { type: "boolean" }, severity: { enum: ["error", "warning", "info"] },
    scope: { enum: ["any", "dataset", "input", "output"] }, kind: { enum: ["metric", "assertion"] },
    metricPath: string, operator: { enum: ["eq", "ne", "lt", "lte", "gt", "gte", "between"] },
    value: { type: "number" }, upper: { type: "number" },
    assertion: { type: "object", properties: { name: string, column: { type: ["string", "null"] } },
      required: ["name"], additionalProperties: false },
    expectedSuccess: { type: "boolean" }, missing: { enum: ["unknown", "fail"] } },
  required: ["title", "datasetKey", "kind"] };
const definitions = [
  ["quality.overview", "Read original quality metrics/assertions by dataset, saved quality rules, assessments and finding dispositions.", selection, [], false],
  ["quality.history", "Inspect original quality facet history and source locations for one exact dataset, preserving event direction, facet scope and tombstones.", selection, ["datasetKey"], false],
  ["quality.rule.save", "Create or revise an operator-authored dataset quality rule with revision checking and complete prior rule editions.", { ...mutation, rule }, ["operationId", "expectedRevision", "rule"], true],
  ["quality.evaluate", "Preview quality findings from the selected original observations and current enabled rule editions without changing workspace state.", selection, [], false],
  ["quality.evaluation.save", "Save an immutable source-linked quality evaluation. Supply preview hashes to bind the save to the reviewed selection and rule editions.", { ...mutation, ...selection, title: string, expectedSelectionHash: hash, expectedRulesHash: hash }, ["operationId", "expectedRevision", "title"], true],
  ["quality.disposition.save", "Record a reasoned disposition for one exact finding in a saved quality evaluation, retaining disposition history and original finding.", { ...mutation, evaluationId: string, findingId: string, decision: { enum: ["open", "investigating", "accepted", "resolved"] }, reason: string }, ["operationId", "expectedRevision", "evaluationId", "findingId", "decision", "reason"], true],
  ["quality.report.read", "Export a saved quality evaluation or current preview as complete JSON, spreadsheet-safe CSV or printable HTML with original source references and operator dispositions.", { ...selection, evaluationId: string, format: { enum: ["json", "csv", "html"] } }, [], false]
];
export const qualityTools = definitions.map(([action, description, properties, required, write]) => ({
  name: "lineage_" + action.replaceAll(".", "_"), description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: true, openWorldHint: false }, action
}));
