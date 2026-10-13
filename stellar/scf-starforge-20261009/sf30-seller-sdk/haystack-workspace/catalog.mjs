import { need, plain, own, fields } from "./util.mjs";
import { semanticDefinitions } from "./semantic-actions.mjs";
const s = { type: "string" }, n = { type: "integer", minimum: 0 }, b = { type: "boolean" };
const choice = values => ({ enum: values }), list = items => ({ type: "array", items });
const paging = { offset: n, limit: { type: "integer", minimum: 1, maximum: 250 } };
const revision = { expectedRevision: n }, edition = { ...revision, editionId: s };
const mutation = { ...revision, operationId: s };
const edits = list({ type: "object", properties: { recordKey: s, tag: s, action: choice(["set", "remove"]), value: {} },
  required: ["recordKey", "tag", "action"], additionalProperties: false });
const sourcePairs = list({ type: "object", properties: { beforeSourceId: s, afterSourceId: s },
  required: ["beforeSourceId", "afterSourceId"], additionalProperties: false });
const workFields = { title: s, description: s, assignee: s, dueDate: s, priority: choice(["routine", "high", "critical"]) };
const workAuthor = { author: s, note: s };
const workMutation = { ...mutation, ...workAuthor, itemId: s, expectedHeadSha256: s };
const workRequired = ["operationId", "expectedRevision", "author", "itemId", "expectedHeadSha256"];
const returnChoices = Object.fromEntries([...Object.keys(workFields), "progress"].map(key => [key, choice(["local", "incoming"])]));
const returnDecisions = list({ type: "object", properties: {
  itemId: s, decision: choice(["keep", "accept"]), expectedHeadSha256: { anyOf: [s, { type: "null" }] },
  choices: { type: "object", properties: returnChoices, additionalProperties: false }
}, required: ["itemId", "decision", "expectedHeadSha256"], additionalProperties: false });
const definitions = [
  ...semanticDefinitions,
  ["workspace.status", "Read the original workspace identity, current revision and complete selection counts.", {}, [], false],
  ["workspace.rename", "Save the operator's workspace title at the reviewed revision.", { ...mutation, title: s }, ["operationId", "expectedRevision", "title"], true],
  ["sources.list", "Page all retained native sources and their explicit selection.", { ...revision, ...paging }, ["expectedRevision"], false],
  ["source.read", "Read the exact original native source bytes in content-bound ranges.", { sourceId: s, offset: n, length: { type: "integer", minimum: 1, maximum: 4194304 } }, ["sourceId"], false],
  ["source.import", "Retain a complete original Haystack JSON v4 grid and its source metadata.", { ...mutation, name: s, base64: s, sourceUrl: s, format: choice(["json-v4"]), select: b }, ["operationId", "expectedRevision", "name", "base64"], true],
  ["source.select", "Save the complete ordered source selection used by the current workspace.", { ...mutation, sourceIds: list(s) }, ["operationId", "expectedRevision", "sourceIds"], true],
  ["records.list", "Page complete typed site, equipment or point records in a current or saved edition.", { ...edition, ...paging, role: choice(["site", "equip", "point", "all"]), sourceId: s, query: s }, ["expectedRevision"], false],
  ["record.read", "Read one complete source row, all its source-local relations and diagnostics.", { ...edition, recordKey: s }, ["expectedRevision", "recordKey"], false],
  ["diagnostics.list", "Page all findings with exact source-row and tag locations.", { ...edition, ...paging, severity: choice(["error", "warning", "info"]), sourceId: s, recordKey: s }, ["expectedRevision"], false],
  ["proposal.preview", "Preview complete typed tag edits against their original selected cells.", { ...revision, edits }, ["expectedRevision", "edits"], false],
  ["proposals.list", "Page original proposals and their explicit accepted, rejected or pending review state.", { ...revision, ...paging, state: choice(["proposed", "accepted", "rejected"]) }, ["expectedRevision"], false],
  ["proposal.read", "Read the complete original proposal, review and available current preview.", { ...revision, proposalId: s }, ["expectedRevision", "proposalId"], false],
  ["proposal.prepare", "Save complete before-and-after typed tag edits for explicit operator review.", { ...mutation, title: s, note: s, edits, proposalId: s }, ["operationId", "expectedRevision", "title", "edits"], true],
  ["proposal.review", "Accept or reject the complete saved proposal with the operator's review note.", { ...mutation, proposalId: s, decision: choice(["accept", "reject"]), note: s }, ["operationId", "expectedRevision", "proposalId", "decision"], true],
  ["editions.list", "Page all immutable editions and their original source selections.", { ...revision, ...paging }, ["expectedRevision"], false],
  ["edition.read", "Read one saved edition's exact source selection, accepted proposals and complete counts.", { ...revision, editionId: s }, ["expectedRevision", "editionId"], false],
  ["edition.save", "Save an immutable edition of the selected native sources and accepted typed edits.", { ...mutation, title: s, note: s }, ["operationId", "expectedRevision", "title"], true],
  ["edition.compare", "Compare all source-linked rows and typed tag changes between two saved editions; cross-source pairing is explicit.", { ...revision, ...paging, beforeEditionId: s, afterEditionId: s, sourcePairs, state: choice(["added", "removed", "changed", "same"]) }, ["expectedRevision", "beforeEditionId", "afterEditionId"], false],
  ["operations.list", "Page the complete original mutation history and retained outcomes at the selected revision.", { ...revision, ...paging }, ["expectedRevision"], false],
  ["operation.read", "Recover the original outcome of one exact saved mutation or completed delivery.", { operationId: s }, ["operationId"], false],
  ["works.list", "Page saved source-bound work items, assignments, dispositions and current finding state.", { ...revision, ...paging, status: choice(["open", "in-progress", "submitted", "verified", "exception"]), assignee: s, priority: choice(["routine", "high", "critical"]), sourceId: s, query: s }, ["expectedRevision"], false],
  ["work.read", "Read one complete work item, its original finding, every retained review branch and evidence.", { ...revision, itemId: s }, ["expectedRevision", "itemId"], false],
  ["work.capture", "Save a complete original record or diagnostic as assigned corrective work against the reviewed material.", { ...mutation, ...workAuthor, ...workFields, materialSha256: s, editionId: s, recordKey: s, diagnosticId: s, diagnosticSha256: s }, ["operationId", "expectedRevision", "author", "title", "materialSha256"], true],
  ["work.update", "Save the complete work assignment and description while retaining prior decisions.", { ...workMutation, fields: { type: "object", properties: workFields, required: Object.keys(workFields), additionalProperties: false } }, [...workRequired, "fields"], true],
  ["work.evidence", "Retain a complete evidence file, native tag proposal or operator observation with the original work item.", { ...workMutation, kind: choice(["file", "proposal", "note"]), name: s, mediaType: s, base64: s, proposalId: s }, [...workRequired, "kind"], true],
  ["evidence.read", "Read a complete immutable work-evidence file or proposal snapshot in content-bound ranges.", { evidenceId: s, offset: n, length: { type: "integer", minimum: 1, maximum: 4194304 } }, ["evidenceId"], false],
  ["work.submit", "Submit the complete corrective work and retained evidence against an immutable material snapshot.", { ...workMutation, editionId: s }, [...workRequired, "note"], true],
  ["work.review", "Verify the exact submitted material, reopen work, or record an explicit accepted exception.", { ...workMutation, decision: choice(["verify", "reopen", "accept-exception"]), submissionSha256: s, editionId: s }, [...workRequired, "decision", "note"], true],
  ["return.preview", "Compare every item in a complete returned workspace with the original project's retained work and shared history.", { ...revision, base64: s }, ["expectedRevision", "base64"], false],
  ["return.apply", "Apply the original operator's per-item return decisions and explicit conflict choices while retaining both work histories.", { ...mutation, ...workAuthor, base64: s, decisions: returnDecisions }, ["operationId", "expectedRevision", "author", "note", "base64", "decisions"], true],
  ["returns.list", "Page all original operator decisions on received corrective-work packages.", { ...revision, ...paging }, ["expectedRevision"], false],
  ["return.read", "Read the complete original operator decision for one received work package.", { ...revision, returnId: s }, ["expectedRevision", "returnId"], false],
  ["delivery.prepare", "Save a complete editable workspace, corrective-work register, source-linked asset register, diagnostic report or native grid.", { ...mutation, kind: choice(["workspace", "register", "diagnostics", "native-grid", "work-register", "semantic-report", "semantic-dictionary", "semantic-output"]), format: choice(["json", "csv", "html"]), editionId: s, sourceId: s, role: choice(["site", "equip", "point", "all"]), modelId: s, versionId: s, validationId: s, name: s }, ["operationId", "expectedRevision", "kind"], true],
  ["delivery.read", "Read the exact bytes of one completed delivery in content-bound ranges.", { operationId: s, offset: n, length: { type: "integer", minimum: 1, maximum: 4194304 } }, ["operationId"], false]
];
export const actions = definitions.map(([action, description, properties, required, writes]) => ({
  action, writes, name: "haystack_" + action.replaceAll(".", "_"), description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: !writes, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}));
export const tools = actions.map(({ writes, ...tool }) => tool);
export const MUTATIONS = new Set(actions.filter(item => item.writes && item.action !== "delivery.prepare").map(item => item.action));
function checkValue(value, schema, path) {
  if (schema.anyOf) {
    let accepted = false;
    for (const alternative of schema.anyOf) {
      try { checkValue(value, alternative, path); accepted = true; break; } catch {}
    }
    need(accepted, "Supply a declared value for " + path + "."); return;
  }
  if (schema.type === "null") need(value === null, "Supply null for " + path + ".");
  if (schema.enum) need(schema.enum.includes(value), "Choose a declared value for " + path + ".");
  if (schema.type === "string") need(typeof value === "string", "Supply text for " + path + ".");
  if (schema.type === "boolean") need(typeof value === "boolean", "Supply true or false for " + path + ".");
  if (schema.type === "integer") need(Number.isSafeInteger(value) && value >= (schema.minimum ?? 0) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER), "Supply the declared integer range for " + path + ".");
  if (schema.type === "array") {
    need(Array.isArray(value), "Supply a complete array for " + path + ".");
    for (const item of value) checkValue(item, schema.items, path + " item");
  }
  if (schema.type === "object") {
    fields(value, Object.keys(schema.properties), schema.required || []);
    for (const key of Object.keys(value)) checkValue(value[key], schema.properties[key], path + "." + key);
  }
}
export function validateArguments(action, args = {}) {
  const definition = actions.find(item => item.action === action);
  need(definition, "Choose a declared Haystack action.", "HAYSTACK_ACTION", 404);
  fields(args, Object.keys(definition.inputSchema.properties), definition.inputSchema.required);
  for (const key of Object.keys(args)) checkValue(args[key], definition.inputSchema.properties[key], key);
  return definition;
}
