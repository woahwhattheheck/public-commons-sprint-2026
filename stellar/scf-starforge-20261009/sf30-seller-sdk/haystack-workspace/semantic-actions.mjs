const s = { type: "string" }, n = { type: "integer", minimum: 0 };
const choice = values => ({ enum: values }), list = items => ({ type: "array", items });
const paging = { offset: n, limit: { type: "integer", minimum: 1, maximum: 250 } };
const revision = { expectedRevision: n }, mutation = { ...revision, operationId: s };
const selection = { type: "object", properties: { nativeSourceIds: list(s), intakeIds: list(s) }, required: ["nativeSourceIds", "intakeIds"], additionalProperties: false };
const nullableIndex = { anyOf: [n, { type: "null" }] };
const mapping = { type: "object", properties: {
  intakeId: s, idColumn: nullableIndex, nameColumn: nullableIndex, kindColumn: nullableIndex,
  equipmentColumn: nullableIndex, siteColumn: nullableIndex, unitColumn: nullableIndex,
  kind: choice(["site", "equip", "point", "other"]), defaultClass: s
}, required: ["intakeId", "idColumn", "nameColumn", "kind"], additionalProperties: false };
const naming = { type: "object", properties: { template: s, case: choice(["preserve", "lower", "upper"]), separator: s, description: s },
  required: ["template", "case", "separator", "description"], additionalProperties: false };
const defaultClasses = { type: "object", properties: { site: s, equip: s, point: s, other: s }, additionalProperties: false };
const range = { offset: n, length: { type: "integer", minimum: 1, maximum: 4194304 } };
const model = { modelId: s, versionId: s };
const returns = list({ type: "object", properties: {
  modelId: s, decision: choice(["keep", "adopt"]), expectedLocalHeadId: { anyOf: [s, { type: "null" }] }, expectedIncomingHeadId: s
}, required: ["modelId", "decision", "expectedLocalHeadId", "expectedIncomingHeadId"], additionalProperties: false });
export const semanticDefinitions = [
  ["semantic.catalog", "Read the complete selected Brick ontology term catalogue and exact native dependency/source identities.", {}, [], false],
  ["semantic.intakes.list", "Page every retained original CSV or TSV point list, complete headings and native inspection observations.", { ...revision, ...paging }, ["expectedRevision"], false],
  ["semantic.intake.read", "Page exact original cell strings and row positions from one native-parsed point list.", { ...revision, ...paging, intakeId: s }, ["expectedRevision", "intakeId"], false],
  ["semantic.source.read", "Read the original point-list bytes in content-bound ranges.", { intakeId: s, ...range }, ["intakeId"], false],
  ["semantic.intake.import", "Retain complete original CSV/TSV bytes with the actual Python CSV inspection and full source positions.", { ...mutation, name: s, format: choice(["csv", "tsv"]), delimiter: choice([",", "\t", ";"]), base64: s, sourceUrl: s }, ["operationId", "expectedRevision", "name", "format", "base64"], true],
  ["semantic.model.preview", "Preview explicit source-column and naming mappings over selected original rows without saving a model.", { ...revision, title: s, namespace: s, selection, contextId: s, mappings: list(mapping), naming, defaultClasses }, ["expectedRevision", "title", "namespace", "selection", "mappings", "naming"], false],
  ["semantic.model.assess", "Assess the complete current editable model against its original source context without saving or claiming native conformance.", { ...revision, selection, contextId: s, content: {} }, ["expectedRevision", "contextId", "content"], false],
  ["semantic.models.list", "Page current model heads and their exact-version review and native-validation outcomes.", { ...revision, ...paging }, ["expectedRevision"], false],
  ["semantic.model.read", "Read one complete editable model version, original source context, history, reviews and validator references.", { ...revision, ...model }, ["expectedRevision", "modelId"], false],
  ["semantic.model.create", "Save a complete point-list or native-Haystack mapping as the first immutable semantic model version.", { ...mutation, modelId: s, selection, contextId: s, content: {}, author: s, note: s }, ["operationId", "expectedRevision", "contextId", "content", "author"], true],
  ["semantic.model.save", "Save the complete edited model against its original opened head, retaining source context and every earlier version.", { ...mutation, modelId: s, expectedHeadId: s, selection, contextId: s, content: {}, author: s, note: s }, ["operationId", "expectedRevision", "modelId", "expectedHeadId", "contextId", "content", "author"], true],
  ["semantic.model.review", "Record ready or changes for the exact model head, with an optional selected native report and full reviewer note.", { ...mutation, modelId: s, expectedHeadId: s, decision: choice(["ready", "changes"]), validationId: s, author: s, note: s }, ["operationId", "expectedRevision", "modelId", "expectedHeadId", "decision", "author", "note"], true],
  ["semantic.model.compare", "Page full model, entity, relation and dictionary differences between retained versions of one model.", { ...revision, ...paging, modelId: s, beforeVersionId: s, afterVersionId: s }, ["expectedRevision", "modelId", "beforeVersionId", "afterVersionId"], false],
  ["semantic.validate", "Run the selected local Brick/RDFLib/pySHACL validator over the exact saved model and retain every native output and observation.", { ...mutation, modelId: s, expectedHeadId: s, author: s }, ["operationId", "expectedRevision", "modelId", "expectedHeadId", "author"], true],
  ["semantic.validations.list", "Page complete native-validation references for the selected model or all models.", { ...revision, ...paging, modelId: s }, ["expectedRevision"], false],
  ["semantic.validation.read", "Read the complete actual native SHACL result, mapping observations, runtime identity and retained output metadata.", { ...revision, validationId: s }, ["expectedRevision", "validationId"], false],
  ["semantic.output.read", "Read the original native Turtle model or full SHACL report bytes in content-bound ranges.", { validationId: s, name: s, ...range }, ["validationId", "name"], false],
  ["semantic.return.preview", "Compare every model in a complete returned workspace against current heads, retaining complete original source and version identities.", { ...revision, base64: s }, ["expectedRevision", "base64"], false],
  ["semantic.return.apply", "Apply explicit keep/adopt decisions for every returned model, preserving both complete histories and all original source/validation bytes.", { ...mutation, base64: s, decisions: returns, author: s, note: s }, ["operationId", "expectedRevision", "base64", "decisions", "author", "note"], true],
  ["semantic.returns.list", "Page retained complete contractor-return decisions and their original package identities.", { ...revision, ...paging }, ["expectedRevision"], false],
  ["semantic.return.read", "Read the full original per-model contractor-return decisions and before/after content differences.", { ...revision, returnId: s }, ["expectedRevision", "returnId"], false]
];
