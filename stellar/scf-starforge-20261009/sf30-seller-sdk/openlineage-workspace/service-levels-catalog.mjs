// MIT. Same service-level actions across the original HTTP, stdio and merchant clients.
const text = { type: "string", minLength: 1 };
const nullableText = { anyOf: [text, { type: "null" }] };
const timestamp = { type: "string", format: "date-time" };
const duration = { anyOf: [{ type: "integer", minimum: 1, maximum: 315360000 }, { type: "null" }] };
const mutation = { operationId: text, expectedRevision: { type: "integer", minimum: 0 } };
const policy = {
  type: "object", additionalProperties: false,
  properties: {
    id: nullableText, title: { ...text, maxLength: 400 },
    jobKey: { ...text, maxLength: 4000, description: "Exact JSON job key returned by the original workspace, including namespace and name." },
    owner: { type: "string", maxLength: 400 }, runbook: { type: "string", maxLength: 4000 },
    enabled: { type: "boolean" }, effectiveFrom: timestamp,
    maxCompletionAgeSeconds: duration, maxDurationSeconds: duration,
    failureWindowSeconds: { type: "integer", minimum: 1, maximum: 315360000 },
    monitorFailures: { type: "boolean" }
  },
  required: ["title", "jobKey", "effectiveFrom"]
};
const definitions = [
  ["service-levels.read", "Read all saved pipeline policies, immutable assessments and complete incident decision history.", {}, [], false],
  ["service-levels.policy.save", "Create or revise a named pipeline service policy against one exact job, retaining every policy version and the operator's reason.",
    { ...mutation, policy, reason: text }, ["operationId", "expectedRevision", "policy", "reason"], true],
  ["service-levels.evaluate", "Evaluate saved policies at an explicit time against original retained events or one saved edition. Returns source-linked findings and observation coverage.",
    { asOf: timestamp, editionId: nullableText }, ["asOf"], false],
  ["service-levels.assessment.save", "Save the complete time-bound assessment. Current selections can update incidents; historical editions require applyToIncidents:false.",
    { ...mutation, asOf: timestamp, editionId: nullableText, applyToIncidents: { type: "boolean" } },
    ["operationId", "expectedRevision", "asOf"], true],
  ["service-levels.incident.review", "Acknowledge, assign, resolve, explicitly accept or reopen one saved incident with a reason. Resolution requires a saved assessment showing the condition has cleared.",
    { ...mutation, id: text, decision: { enum: ["acknowledge", "assign", "resolve", "accept", "reopen"] }, reason: text, owner: { type: "string", maxLength: 400 } },
    ["operationId", "expectedRevision", "id", "decision", "reason"], true],
  ["service-levels.report", "Export complete saved policy versions, one selected assessment and all incident histories as JSON, spreadsheet-safe CSV or printable HTML.",
    { assessmentId: nullableText, format: { enum: ["json", "csv", "html"] } }, [], false]
];
export const serviceLevelTools = definitions.map(([action, description, properties, required, mutates]) => ({
  name: "lineage_" + action.replaceAll(/[.-]/g, "_"), description, action,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: !mutates, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}));
