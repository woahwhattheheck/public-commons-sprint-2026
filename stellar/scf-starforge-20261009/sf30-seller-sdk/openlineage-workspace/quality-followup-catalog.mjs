// MIT. Same-workspace comparison and explicit follow-up operations.
const string = { type: "string", minLength: 1 };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const integer = { type: "integer", minimum: 0 };
const pairs = (before, after) => ({ type: "array", items: { type: "object",
  properties: { [before]: string, [after]: string }, required: [before, after], additionalProperties: false } });
const selection = { beforeEvaluationId: string, afterEvaluationId: string,
  runPairs: pairs("beforeRunKey", "afterRunKey"), findingPairs: pairs("beforeFindingId", "afterFindingId") };
const mutation = { operationId: string, expectedRevision: integer };
const definitions = [
  ["quality.followup.overview", "Read saved quality comparisons, follow-up history, original evaluation choices and existing result evidence.", {}, [], false],
  ["quality.followup.compare", "Compare two original saved evaluations with explicit same-job run correspondence and one-to-one ambiguous finding decisions. Absence never implies resolution.",
    selection, ["beforeEvaluationId", "afterEvaluationId"], false],
  ["quality.followup.comparison.save", "Save the exact reviewed immutable comparison, original evaluation identities and explicit correspondence choices.",
    { ...selection, ...mutation, title: string, expectedComparisonHash: hash },
    ["beforeEvaluationId", "afterEvaluationId", "operationId", "expectedRevision", "title", "expectedComparisonHash"], true],
  ["quality.followup.save", "Create or revise a reasoned follow-up on one later compared finding, retaining history, original disposition reference and existing complete evidence files.",
    { ...mutation, id: string, version: { type: "integer", minimum: 1 }, comparisonId: string, rowId: string,
      decision: { enum: ["open", "investigating", "accepted", "resolved"] }, reason: string,
      owner: { type: "string" }, dueDate: { type: ["string", "null"] },
      evidenceResultIds: { type: "array", items: string, uniqueItems: true },
      sourceDisposition: { anyOf: [{ type: "null" }, { type: "object", properties: {
        evaluationId: string, findingId: string, version: { type: "integer", minimum: 1 } },
        required: ["evaluationId", "findingId", "version"], additionalProperties: false }] } },
    ["operationId", "expectedRevision", "comparisonId", "rowId", "decision", "reason"], true],
  ["quality.followup.report.read", "Download complete saved comparison, current follow-up histories, original evaluations and source/evidence references as JSON, spreadsheet-safe CSV or printable HTML.",
    { comparisonId: string, format: { enum: ["json", "csv", "html"] } }, ["comparisonId"], false]
];
export const qualityFollowupTools = definitions.map(([action, description, properties, required, write]) => ({
  name: "lineage_" + action.replaceAll(".", "_"), description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: true, openWorldHint: false }, action
}));
