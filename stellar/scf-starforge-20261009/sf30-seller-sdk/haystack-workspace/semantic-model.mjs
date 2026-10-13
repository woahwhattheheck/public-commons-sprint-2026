import { clone, digest, sha256, base64, need, plain, own, hash, id, text, integer, fields, now, page, canonical } from "./util.mjs";

export const SEMANTIC_FORMAT = "commons.haystack.semantic-work.v1";
export const MAX_SEMANTIC_ROWS = 25000;
const BRICK = "https://brickschema.org/schema/Brick#";
const REC = "https://w3id.org/rec#";
const FIELD_LIMIT = 16000;
const sourceRefKey = ref => ref.kind + ":" + ref.sourceId + ":" + ref.rowIndex;
const byId = (rows, value, label) => {
  const found = rows.find(row => row.id === value);
  need(found, "The complete " + label + " is not retained.", "HAYSTACK_SEMANTIC_MISSING", 404);
  return found;
};
function object(value, allowed, required = []) { return fields(value, allowed, required); }
function list(value, name, limit) { need(Array.isArray(value) && value.length <= limit, "Supply the complete " + name + " within " + limit + " entries."); return value; }
function distinct(rows, key, name) { need(new Set(rows.map(row => row[key])).size === rows.length, "The complete " + name + " contains duplicate identities."); }
function rawHash(value) { const copy = clone(value); delete copy.id; return digest(copy); }
function hashRecord(value) { const copy = clone(value); return { ...copy, id: digest(copy) }; }
function safeIri(value, label = "absolute IRI") {
  text(value, label, 4000, true);
  need(/^(https?:\/\/|urn:)[^\s<>"{}|\\^`]*$/.test(value) && !/[\u0000-\u0020\u007f]/.test(value), "Use a complete HTTP, HTTPS or URN " + label + ".");
  if (/^https?:/.test(value)) { let url; try { url = new URL(value); } catch {} need(url && !url.username && !url.password && url.hostname, "Use an absolute public-name IRI without credentials."); }
  return value;
}
function dateText(value) {
  text(value, "observation date", 10);
  if (!value) return value;
  need(/^\d{4}-\d{2}-\d{2}$/.test(value), "Use an observation date in YYYY-MM-DD form.");
  const parsed = new Date(value + "T00:00:00Z"); need(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, "Use an actual Gregorian observation date.");
  return value;
}
export function semanticState(state) {
  if (!state.semantics) state.semantics = { format: SEMANTIC_FORMAT, assets: [], intakes: [], contexts: [], models: [], versions: [], validations: [], reviews: [], returns: [] };
  return state.semantics;
}
export function semanticSummary(state) {
  const s = state.semantics;
  return { intakeCount: s?.intakes.length || 0, modelCount: s?.models.length || 0, versionCount: s?.versions.length || 0, validationCount: s?.validations.length || 0, returnCount: s?.returns.length || 0 };
}
function asset(s, bytes) {
  const raw = Buffer.from(bytes), identity = sha256(raw), found = s.assets.find(row => row.id === identity);
  if (!found) s.assets.push({ id: identity, bytes: raw.length, base64: raw.toString("base64") });
  return identity;
}
function retainedAsset(s, identity) {
  const found = byId(s.assets, hash(identity), "source asset");
  const bytes = base64(found.base64, 64 * 1024 * 1024);
  need(bytes.length === found.bytes && sha256(bytes) === identity, "The complete retained semantic source bytes differ.", "HAYSTACK_SEMANTIC_SOURCE", 409);
  return bytes;
}
export function intakeImport(state, args, inspected, execution) {
  const s = semanticState(state), raw = base64(args.base64, 32 * 1024 * 1024);
  text(args.name, "original point-list name", 240, true);
  need(inspected?.ok && inspected.action === "inspect" && inspected.file.sha256 === sha256(raw) && inspected.file.bytes === raw.length, "The native point-list inspection does not match the complete original file.", "HAYSTACK_SEMANTIC_INSPECTION", 409);
  list(inspected.columns, "source columns", 256).forEach(column => text(column, "original column heading", 65536));
  list(inspected.rows, "source rows", MAX_SEMANTIC_ROWS).forEach(row => list(row, "source cells", 256).forEach(cell => text(cell, "original cell text", 1048576)));
  need(inspected.rowEndLines?.length === inspected.rows.length, "The point-list inspection must retain every original row position.");
  inspected.rowEndLines.forEach(line => integer(line, "original physical end line", 1));
  const record = { id: id(args.operationId), name: args.name, format: args.format, delimiter: inspected.delimiter,
    assetId: asset(s, raw), bytes: raw.length, importedAt: now(), importedRevision: state.revision + 1,
    columns: clone(inspected.columns), rows: clone(inspected.rows), rowEndLines: clone(inspected.rowEndLines),
    encoding: inspected.encoding, diagnostics: clone(inspected.diagnostics || []),
    inspection: { runtime: clone(inspected.runtime || inspected.metadata || {}), nativeFile: clone(inspected.file), execution: clone(execution) }, sourceUrl: text(args.sourceUrl || "", "original source URL", 4000) };
  record.contentSha256 = digest({ columns: record.columns, rows: record.rows, rowEndLines: record.rowEndLines });
  need(!s.intakes.some(row => row.id === record.id), "This intake identity already belongs to an original import.");
  s.intakes.push(record);
  return { intake: intakeSummary(record) };
}
export function intakeSummary(record) { const { rows, rowEndLines, ...rest } = record; return { ...clone(rest), rowCount: rows.length }; }
function sourceRef(ref) {
  object(ref, ["kind", "sourceId", "rowIndex"], ["kind", "sourceId", "rowIndex"]);
  need(["native", "intake"].includes(ref.kind), "Choose an original native-grid or point-list source reference.");
  if (ref.kind === "native") hash(ref.sourceId, "native source identity"); else id(ref.sourceId, "point-list intake ID");
  integer(ref.rowIndex, "source row index", 0, MAX_SEMANTIC_ROWS - 1);
  return ref;
}
function typedText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    if (own(value, "val")) return String(value.val);
    if (own(value, "value")) return String(value.value);
  }
  return canonical(value);
}
function nativeId(tags) {
  const value = tags.id;
  if (value && typeof value === "object" && typeof value.val === "string") return value.val;
  if (value && typeof value === "object" && typeof value.value === "string") return value.value;
  return typeof value === "string" ? value.replace(/^r:/, "") : "";
}
export function captureSemanticContext(state, selection, { analyzed, materialize }) {
  object(selection, ["nativeSourceIds", "intakeIds"], ["nativeSourceIds", "intakeIds"]);
  list(selection.nativeSourceIds, "native source selection", 100).forEach(hash);
  list(selection.intakeIds, "point-list selection", 100).forEach(value => id(value));
  need(new Set(selection.nativeSourceIds).size === selection.nativeSourceIds.length && new Set(selection.intakeIds).size === selection.intakeIds.length, "Select each complete source once.");
  const s = state.semantics || { intakes: [], assets: [] }, current = analyzed(state), nativeSelected = new Set(selection.nativeSourceIds);
  need(selection.nativeSourceIds.every(value => current.sourceIds.includes(value)), "Choose native sources in the current reviewed workspace selection.", "HAYSTACK_SEMANTIC_SELECTION", 409);
  const records = current.records.filter(row => nativeSelected.has(row.sourceId)).map(row => ({
    ref: { kind: "native", sourceId: row.sourceId, rowIndex: row.rowIndex ?? Number(row.key.split(":")[1]) },
    recordKey: row.key, nativeId: row.id || nativeId(row.tags), display: row.display || "", roles: clone(row.roles),
    sourceName: state.sources.find(source => source.id === row.sourceId).name, tags: clone(row.tags)
  }));
  for (const intakeId of selection.intakeIds) {
    const intake = byId(s.intakes, intakeId, "point-list intake");
    for (let rowIndex = 0; rowIndex < intake.rows.length; rowIndex++) records.push({
      ref: { kind: "intake", sourceId: intake.id, rowIndex }, sourceName: intake.name,
      columns: clone(intake.columns), cells: clone(intake.rows[rowIndex]), physicalEndLine: intake.rowEndLines[rowIndex],
      nativeId: "", display: "", roles: []
    });
  }
  need(records.length > 0 && records.length <= MAX_SEMANTIC_ROWS, "Select between one and 25,000 complete source records.");
  const nativeSources = selection.nativeSourceIds.map(value => {
    const source = state.sources.find(row => row.id === value), { base64: omitted, ...metadata } = source;
    return { ...clone(metadata), assetId: source.id };
  });
  const nativeProposalIds = current.approvedProposalIds.filter(proposalId => state.proposals.find(row => row.id === proposalId).changes.some(change => nativeSelected.has(change.recordKey.split(":")[0])));
  const context = hashRecord({ format: "commons.haystack.semantic-context.v1", workspaceId: state.workspaceId,
    selection: clone(selection), materialSha256: current.contentSha256, nativeSources,
    nativeProposals: nativeProposalIds.map(value => clone(state.proposals.find(row => row.id === value))),
    intakes: selection.intakeIds.map(value => clone(byId(s.intakes, value, "point-list intake"))), records });
  return context;
}
function contextFor(state, args, helpers, persist) {
  const s = persist ? semanticState(state) : state.semantics;
  if (args.selection) {
    const context = captureSemanticContext(state, args.selection, helpers);
    if (args.contextId) need(args.contextId === context.id, "The source selection or accepted edits changed after the model preview.", "HAYSTACK_SEMANTIC_CONTEXT", 409);
    if (persist && !s.contexts.some(row => row.id === context.id)) {
      for (const source of context.nativeSources) {
        const original = state.sources.find(row => row.id === source.id);
        need(asset(s, base64(original.base64, 32 * 1024 * 1024)) === source.id, "The original native bytes differ.");
      }
      s.contexts.push(context);
    }
    return context;
  }
  need(s, "Preview and retain the model's complete source context first.");
  return byId(s.contexts, hash(args.contextId, "source context identity"), "source context");
}
function mappedCell(row, index) { return index === null || index === undefined ? "" : row.cells[index] ?? ""; }
function mappingRows(context, mappings) {
  list(mappings, "point-list mappings", 100);
  distinct(mappings, "intakeId", "point-list mappings");
  for (const mapping of mappings) {
    object(mapping, ["intakeId", "idColumn", "nameColumn", "kindColumn", "equipmentColumn", "siteColumn", "unitColumn", "kind", "defaultClass"], ["intakeId", "idColumn", "nameColumn", "kind"]);
    id(mapping.intakeId); need(context.selection.intakeIds.includes(mapping.intakeId), "Map a selected original point list.");
    const columns = byId(context.intakes, mapping.intakeId, "point-list intake").columns;
    for (const key of ["idColumn", "nameColumn", "kindColumn", "equipmentColumn", "siteColumn", "unitColumn"]) {
      if (mapping[key] !== undefined && mapping[key] !== null) integer(mapping[key], key, 0, columns.length - 1);
    }
    need(["site", "equip", "point", "other"].includes(mapping.kind), "Choose the proposed record kind.");
    if (mapping.defaultClass) safeIri(mapping.defaultClass, "default class IRI");
  }
  need(context.selection.intakeIds.every(value => mappings.some(mapping => mapping.intakeId === value)), "Retain an explicit column mapping for every selected point list.");
  return context.records.map(row => {
    if (row.ref.kind === "native") return { ...clone(row), proposedKind: row.roles.includes("point") ? "point" : row.roles.includes("equip") ? "equip" : row.roles.includes("site") ? "site" : "other" };
    const mapping = mappings.find(item => item.intakeId === row.ref.sourceId);
    const kindText = mappedCell(row, mapping.kindColumn).trim().toLowerCase();
    return { ...clone(row), nativeId: mappedCell(row, mapping.idColumn), display: mappedCell(row, mapping.nameColumn),
      proposedKind: ["site", "equip", "point", "other"].includes(kindText) ? kindText : mapping.kind,
      equipmentName: mappedCell(row, mapping.equipmentColumn), siteName: mappedCell(row, mapping.siteColumn),
      unitText: mappedCell(row, mapping.unitColumn), defaultClass: mapping.defaultClass || "" };
  });
}
function namingConfig(value) {
  object(value, ["template", "case", "separator", "description"], ["template", "case", "separator", "description"]);
  text(value.template, "naming template", 1000, true); text(value.description, "naming convention", FIELD_LIMIT);
  text(value.separator, "name separator", 8); need(["preserve", "lower", "upper"].includes(value.case), "Choose the intended name case.");
  const unknown = [...value.template.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).filter(key => !["nativeId", "name", "source", "row", "equipment", "site", "kind"].includes(key));
  need(!unknown.length && !/[{}]/.test(value.template.replace(/\{[^{}]+\}/g, "")), "Use only the declared complete naming tokens.");
  return value;
}
function proposedName(row, config) {
  const values = { nativeId: row.nativeId, name: row.display, source: row.sourceName, row: String(row.ref.rowIndex + 1), equipment: row.equipmentName || "", site: row.siteName || "", kind: row.proposedKind };
  let result = config.template.replace(/\{([^{}]+)\}/g, (_, key) => values[key] || "").trim().replace(/\s+/g, () => config.separator);
  if (config.case === "lower") result = result.toLocaleLowerCase("en-US");
  if (config.case === "upper") result = result.toLocaleUpperCase("en-US");
  return result;
}
export function previewSemanticModel(state, args, helpers) {
  text(args.title, "model title", 160, true); safeIri(args.namespace, "model namespace");
  need(/[\/#:]$/.test(args.namespace), "End the model namespace with /, # or :.");
  const context = contextFor(state, args, helpers, false), naming = namingConfig(args.naming);
  const mappings = args.mappings || [], mapped = mappingRows(context, mappings), defaults = args.defaultClasses || {};
  object(defaults, ["site", "equip", "point", "other"]);
  for (const value of Object.values(defaults)) if (value) safeIri(value, "default class IRI");
  const entities = mapped.map(row => {
    const entityId = sourceRefKey(row.ref), defaultClass = row.defaultClass || defaults[row.proposedKind] || ({ site: REC + "Building", equip: BRICK + "Equipment", point: BRICK + "Point" })[row.proposedKind] || "";
    return { id: entityId, sourceRefs: [clone(row.ref)], name: proposedName(row, naming), label: row.display || row.nativeId || row.sourceName + " row " + (row.ref.rowIndex + 1),
      kind: row.proposedKind, classes: defaultClass ? [defaultClass] : [], tags: [], attributes: [],
      observation: { status: "unreviewed", date: "", author: "", evidence: "" }, note: "" };
  });
  const content = { title: args.title, namespace: args.namespace, naming: clone(naming), mappings: clone(mappings),
    entities, relations: [], dictionary: [], notes: "" };
  validateSemanticContent(content, context);
  return { contextId: context.id, selection: clone(context.selection), content, sourceRows: mapped,
    assessment: assessSemanticContent(content, context), materialSha256: context.materialSha256 };
}
export function assessSemanticDraft(state, args, helpers) {
  const context = contextFor(state, args, helpers, false);
  validateSemanticContent(args.content, context);
  return { contextId: context.id, contentSha256: digest(args.content), assessment: assessSemanticContent(args.content, context) };
}
function validateObservation(value) {
  object(value, ["status", "date", "author", "evidence"], ["status", "date", "author", "evidence"]);
  need(["unreviewed", "observed-live", "observed-offline", "configured-only", "not-observed"].includes(value.status), "Choose the actual source observation status.");
  dateText(value.date); text(value.author, "observation author", 240); text(value.evidence, "observation evidence", FIELD_LIMIT);
  if (value.status !== "unreviewed") need(value.author.trim() && value.evidence.trim(), "Record who supplied the observation and its source evidence.");
}
export function validateSemanticContent(content, context) {
  object(content, ["title", "namespace", "naming", "mappings", "entities", "relations", "dictionary", "notes"], ["title", "namespace", "naming", "mappings", "entities", "relations", "dictionary", "notes"]);
  text(content.title, "model title", 160, true); safeIri(content.namespace, "model namespace");
  need(/[\/#:]$/.test(content.namespace), "End the model namespace with /, # or :.");
  namingConfig(content.naming); mappingRows(context, content.mappings); text(content.notes, "complete model notes", 65536);
  list(content.entities, "model entities", MAX_SEMANTIC_ROWS); distinct(content.entities, "id", "model entities");
  const validRefs = new Set(context.records.map(row => sourceRefKey(row.ref)));
  for (const entity of content.entities) {
    object(entity, ["id", "sourceRefs", "name", "label", "kind", "classes", "tags", "attributes", "observation", "note"], ["id", "sourceRefs", "name", "label", "kind", "classes", "tags", "attributes", "observation", "note"]);
    text(entity.id, "stable entity identity", 500, true); need(!/[\u0000-\u001f]/.test(entity.id), "Use a printable stable entity identity.");
    text(entity.name, "reviewed entity name", 1000); text(entity.label, "entity label", 2000);
    need(["site", "equip", "point", "other"].includes(entity.kind), "Choose the entity kind.");
    list(entity.sourceRefs, "entity source references", 1000).forEach(ref => { sourceRef(ref); need(validRefs.has(sourceRefKey(ref)), "The entity source reference is absent from its complete retained context."); });
    need(new Set(entity.sourceRefs.map(sourceRefKey)).size === entity.sourceRefs.length, "Retain each entity source reference once.");
    for (const key of ["classes", "tags"]) { list(entity[key], "entity " + key, 128).forEach(value => safeIri(value)); need(new Set(entity[key]).size === entity[key].length, "Declare each entity " + key + " once."); }
    list(entity.attributes, "entity attributes", 256).forEach(attribute => {
      object(attribute, ["predicate", "kind", "value", "datatype", "language"], ["predicate", "kind", "value"]);
      safeIri(attribute.predicate, "attribute predicate"); need(["iri", "literal"].includes(attribute.kind), "Choose an IRI or literal attribute.");
      if (attribute.kind === "iri") { safeIri(attribute.value, "attribute value"); need(!attribute.datatype && !attribute.language, "IRI attributes do not have literal language or datatype."); }
      else { text(attribute.value, "literal value", 65536); if (attribute.datatype) safeIri(attribute.datatype, "literal datatype"); if (attribute.language) { text(attribute.language, "literal language", 80); need(/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(attribute.language), "Use a valid language tag."); } need(!attribute.language || !attribute.datatype, "A literal uses either a language or an explicit datatype."); }
    });
    validateObservation(entity.observation); text(entity.note, "entity note", FIELD_LIMIT);
  }
  const entityIds = new Set(content.entities.map(row => row.id));
  list(content.relations, "model relations", MAX_SEMANTIC_ROWS * 8); distinct(content.relations, "id", "model relations");
  for (const relation of content.relations) {
    object(relation, ["id", "subjectId", "predicate", "objectId", "note"], ["id", "subjectId", "predicate", "objectId", "note"]);
    text(relation.id, "stable relationship identity", 500, true); safeIri(relation.predicate, "relationship predicate");
    need(entityIds.has(relation.subjectId) && entityIds.has(relation.objectId), "Every relationship retains both declared model entities.");
    text(relation.note, "relationship source/review note", FIELD_LIMIT);
  }
  list(content.dictionary, "reviewed dictionary", 10000); distinct(content.dictionary, "id", "dictionary rows");
  for (const row of content.dictionary) {
    object(row, ["id", "term", "iri", "kind", "definition", "sourceUrl", "note"], ["id", "term", "iri", "kind", "definition", "sourceUrl", "note"]);
    text(row.id, "dictionary row ID", 500, true); text(row.term, "dictionary term", 1000, true);
    need(["class", "tag", "relation", "unit", "attribute", "naming"].includes(row.kind), "Choose a dictionary term kind.");
    if (row.iri) safeIri(row.iri, "dictionary IRI");
    text(row.definition, "dictionary definition", FIELD_LIMIT); text(row.sourceUrl, "dictionary source URL", 4000); text(row.note, "dictionary review note", FIELD_LIMIT);
  }
  return content;
}
export function assessSemanticContent(content, context) {
  const used = new Map(), names = new Map(), observations = [], entities = content.entities;
  for (const row of entities) {
    for (const ref of row.sourceRefs) { const key = sourceRefKey(ref); if (!used.has(key)) used.set(key, []); used.get(key).push(row.id); }
    if (row.name) { if (!names.has(row.name)) names.set(row.name, []); names.get(row.name).push(row.id); }
    if (!row.name) observations.push({ code: "MISSING_NAME", entityId: row.id, message: "This entity has no reviewed name." });
    if (!row.classes.length) observations.push({ code: "UNCLASSIFIED", entityId: row.id, message: "This entity has no declared standard class." });
    if (row.observation.status === "unreviewed") observations.push({ code: "OBSERVATION_UNREVIEWED", entityId: row.id, message: "Physical/liveness evidence has not been reviewed." });
    if (!row.sourceRefs.length) observations.push({ code: "MANUAL_ENTITY", entityId: row.id, message: "This manually declared entity needs its retained source/review note." });
  }
  for (const row of context.records) {
    const key = sourceRefKey(row.ref), mapped = used.get(key) || [];
    if (!mapped.length) observations.push({ code: "UNMAPPED_SOURCE_ROW", sourceRef: clone(row.ref), message: "The complete original source row is not mapped to a model entity." });
    if (mapped.length > 1) observations.push({ code: "SOURCE_ROW_REUSED", sourceRef: clone(row.ref), entityIds: mapped, message: "Several declared entities reference this original row; review that relationship explicitly." });
  }
  for (const [name, entityIds] of names) if (entityIds.length > 1) observations.push({ code: "DUPLICATE_NAME", name, entityIds, message: "Distinct source entities share this proposed display name; their identities remain separate." });
  return { sourceRows: context.records.length, entities: entities.length, relations: content.relations.length, dictionaryTerms: content.dictionary.length,
    mappedSourceRows: [...used.keys()].length, unmappedSourceRows: context.records.length - used.size,
    unclassified: entities.filter(row => !row.classes.length).length, unreviewedObservations: entities.filter(row => row.observation.status === "unreviewed").length,
    observations };
}
function modelVersion(s, modelId, versionId = null) {
  const model = byId(s.models, id(modelId, "model ID"), "semantic model");
  const version = byId(s.versions, versionId || model.headId, "model version");
  need(version.modelId === model.id, "The selected version belongs to another model.");
  return { model, version, context: byId(s.contexts, version.contextId, "source context") };
}
function newVersion(s, model, content, contextId, args, parents = []) {
  const version = hashRecord({ format: "commons.haystack.semantic-version.v1", modelId: model.id, parents: [...new Set(parents)],
    contextId, content: clone(content), contentSha256: digest(content), createdAt: now(), author: text(args.author, "model author", 240, true), note: text(args.note || "", "model revision note", FIELD_LIMIT) });
  s.versions.push(version); model.headId = version.id; return version;
}
function modelResult(state, model, version, { full = false } = {}) {
  const s = state.semantics, context = byId(s.contexts, version.contextId, "source context");
  const assessment = assessSemanticContent(version.content, context);
  const validation = s.validations.filter(row => row.modelId === model.id && row.versionId === version.id).at(-1) || null;
  const selectedVersion = clone(version);
  if (!full) { delete selectedVersion.content; delete assessment.observations; }
  return { model: clone(model), version: selectedVersion, contextId: context.id, assessment,
    latestReview: clone(s.reviews.filter(row => row.modelId === model.id && row.versionId === version.id).at(-1) || null),
    latestValidation: validation ? (full ? clone(validation) : validationSummary(validation)) : null };
}
export function applySemanticAction(state, action, args, helpers) {
  const s = semanticState(state);
  if (action === "semantic.model.create") {
    const context = contextFor(state, args, helpers, true); validateSemanticContent(args.content, context);
    const model = { id: id(args.modelId || args.operationId, "model ID"), createdAt: now(), createdBy: text(args.author, "model author", 240, true), headId: null };
    need(!s.models.some(row => row.id === model.id), "This original model identity already exists.", "HAYSTACK_SEMANTIC_MODEL", 409);
    s.models.push(model); return modelResult(state, model, newVersion(s, model, args.content, context.id, args));
  }
  if (action === "semantic.model.save") {
    const { model, version } = modelVersion(s, args.modelId);
    need(version.id === hash(args.expectedHeadId), "The model advanced after this draft was opened. Preserve the draft and compare the current version.", "HAYSTACK_SEMANTIC_HEAD", 409, { expectedHeadId: args.expectedHeadId, actualHeadId: version.id });
    const context = contextFor(state, args, helpers, true); validateSemanticContent(args.content, context);
    need(digest(args.content) !== version.contentSha256 || context.id !== version.contextId, "This complete model version is unchanged.", "HAYSTACK_NO_CHANGE", 400);
    return modelResult(state, model, newVersion(s, model, args.content, context.id, args, [version.id]));
  }
  if (action === "semantic.model.review") {
    const { model, version } = modelVersion(s, args.modelId);
    need(version.id === hash(args.expectedHeadId), "Review the exact current model version.", "HAYSTACK_SEMANTIC_HEAD", 409);
    need(["ready", "changes"].includes(args.decision), "Choose ready or changes for this model review.");
    text(args.note, "complete model review", FIELD_LIMIT, true);
    if (args.validationId) {
      const validation = byId(s.validations, hash(args.validationId), "native validation");
      need(validation.modelId === model.id && validation.versionId === version.id, "The selected validator report belongs to another model version.");
    }
    const review = hashRecord({ format: "commons.haystack.semantic-review.v1", modelId: model.id, versionId: version.id, decision: args.decision,
      author: text(args.author, "review author", 240, true), note: args.note, validationId: args.validationId || null, reviewedAt: now() });
    s.reviews.push(review); return { review: clone(review), ...modelResult(state, model, version) };
  }
  need(false, "Choose a declared semantic model mutation.", "HAYSTACK_ACTION", 404);
}
export function semanticModelRows(state) {
  const s = state.semantics; if (!s) return [];
  return s.models.map(model => {
    const version = byId(s.versions, model.headId, "model version"), context = byId(s.contexts, version.contextId, "source context");
    const review = s.reviews.filter(row => row.modelId === model.id && row.versionId === version.id).at(-1) || null;
    const validation = s.validations.filter(row => row.modelId === model.id && row.versionId === version.id).at(-1) || null;
    return { ...clone(model), title: version.content.title, contextId: context.id, contentSha256: version.contentSha256,
      entities: version.content.entities.length, relations: version.content.relations.length,
      review: review ? { id: review.id, decision: review.decision, author: review.author, reviewedAt: review.reviewedAt } : null,
      validation: validation ? { id: validation.id, conforms: validation.conforms, createdAt: validation.createdAt } : null };
  });
}
export function semanticModelRead(state, args) {
  const s = state.semantics; need(s, "This workspace has no semantic model.");
  const { model, version, context } = modelVersion(s, args.modelId, args.versionId);
  return { ...modelResult(state, model, version, { full: true }), context: clone(context), history: s.versions.filter(row => row.modelId === model.id).map(row => ({ id: row.id, parents: clone(row.parents), contextId: row.contextId, contentSha256: row.contentSha256, createdAt: row.createdAt, author: row.author, note: row.note })),
    reviews: clone(s.reviews.filter(row => row.modelId === model.id)), validations: s.validations.filter(row => row.modelId === model.id).map(validationSummary) };
}
export function semanticNativeModel(state, args) {
  const s = state.semantics; need(s, "This workspace has no semantic model.");
  const { model, version, context } = modelVersion(s, args.modelId, args.versionId);
  if (args.expectedHeadId) need(version.id === args.expectedHeadId && model.headId === version.id, "Validate the exact reviewed current model head.", "HAYSTACK_SEMANTIC_HEAD", 409);
  const originalByReference = new Map(context.records.map(row => [sourceRefKey(row.ref), row]));
  return { modelId: model.id, versionId: version.id, contentSha256: version.contentSha256, namespace: version.content.namespace,
    entities: version.content.entities.map(entity => ({ id: entity.id, iri: version.content.namespace + encodeURIComponent(entity.id),
      label: entity.name || entity.label, classes: clone(entity.classes), tags: clone(entity.tags), attributes: clone(entity.attributes),
      sourceRefs: entity.sourceRefs.map(ref => { const original = originalByReference.get(sourceRefKey(ref)); need(original, "Retain the complete original source reference before native validation.", "HAYSTACK_SEMANTIC_SOURCE", 409); return { ...clone(ref), ...(original.recordKey ? { recordKey: original.recordKey } : {}), externalId: original.nativeId || "" }; }) })),
    relations: version.content.relations.map(row => ({ id: row.id, subjectId: row.subjectId, predicate: row.predicate, objectId: row.objectId })) };
}
export function retainSemanticValidation(state, args, result, execution) {
  const s = semanticState(state), { model, version, context } = modelVersion(s, args.modelId);
  need(version.id === args.expectedHeadId && result.ok && result.action === "validate" && result.modelId === model.id && result.versionId === version.id && result.contentSha256 === version.contentSha256,
    "The complete native validation belongs to another model version.", "HAYSTACK_SEMANTIC_VALIDATION", 409);
  need(typeof result.conforms === "boolean", "The native validator must return its actual conformance outcome.");
  const outputs = list(result.outputs, "complete native output files", 16).map(output => {
    text(output.name, "native output filename", 240, true); need(!/[\\/\0]/.test(output.name), "Retain each native output basename.");
    text(output.mediaType, "native output media type", 240, true);
    const bytes = base64(output.base64, 32 * 1024 * 1024);
    need(bytes.length === output.bytes && sha256(bytes) === output.sha256, "A complete native validator output differs.", "HAYSTACK_SEMANTIC_VALIDATION", 409);
    return { name: output.name, mediaType: output.mediaType, bytes: bytes.length, sha256: asset(s, bytes) };
  });
  distinct(outputs, "name", "native outputs");
  need(["model.ttl", "model.json", "validation-report.ttl", "validation-report.txt", "brick-wrapper-report.ttl", "brick-wrapper-report.txt", "validation-expanded.ttl"].every(name => outputs.some(row => row.name === name)), "Retain the complete original model, full native report, original Brick wrapper report and expanded validation graph.");
  const { outputs: omitted, ...native } = clone(result);
  const validation = hashRecord({ format: "commons.haystack.semantic-validation.v1", modelId: model.id, versionId: version.id,
    contentSha256: version.contentSha256, contextId: context.id, conforms: result.conforms, createdAt: now(),
    author: text(args.author, "validation operator", 240, true), native, execution: clone(execution), outputs,
    assessment: assessSemanticContent(version.content, context) });
  s.validations.push(validation); return { validation: validationSummary(validation), ...modelResult(state, model, version) };
}
export function validationSummary(row) { const { native, assessment, ...rest } = row; return { ...clone(rest), results: Array.isArray(native.results) ? native.results.length : null, mappingObservations: Array.isArray(native.mappingObservations) ? native.mappingObservations.length : null }; }
export function semanticOutput(state, args) {
  const s = state.semantics; need(s, "This workspace has no retained semantic output.");
  const validation = byId(s.validations, hash(args.validationId), "native validation"), file = validation.outputs.find(row => row.name === args.name);
  need(file, "Choose an output from this exact native validation.", "HAYSTACK_SEMANTIC_OUTPUT", 404);
  return { metadata: clone(file), bytes: retainedAsset(s, file.sha256), validationId: validation.id };
}
export function semanticSource(state, args) {
  const s = state.semantics; need(s, "This workspace has no point-list intake.");
  const intake = byId(s.intakes, id(args.intakeId), "point-list intake");
  return { metadata: { name: intake.name, mediaType: intake.format === "tsv" ? "text/tab-separated-values" : "text/csv", sha256: intake.assetId, bytes: intake.bytes }, bytes: retainedAsset(s, intake.assetId), intakeId: intake.id };
}
function contentChanges(left, right) {
  const changes = [];
  for (const key of ["title", "namespace", "naming", "mappings", "notes"]) if (digest(left?.[key] ?? null) !== digest(right?.[key] ?? null)) changes.push({ kind: "model", id: key, before: clone(left?.[key] ?? null), after: clone(right?.[key] ?? null) });
  for (const key of ["entities", "relations", "dictionary"]) {
    const leftOrder = (left?.[key] || []).map(row => row.id), rightOrder = (right?.[key] || []).map(row => row.id);
    if (digest(leftOrder) !== digest(rightOrder)) changes.push({ kind: "order", id: key, before: leftOrder, after: rightOrder });
    const a = new Map((left?.[key] || []).map(row => [row.id, row])), b = new Map((right?.[key] || []).map(row => [row.id, row]));
    for (const identity of [...new Set([...a.keys(), ...b.keys()])].sort()) if (digest(a.get(identity) || null) !== digest(b.get(identity) || null))
      changes.push({ kind: key, id: identity, before: clone(a.get(identity) || null), after: clone(b.get(identity) || null) });
  }
  return changes;
}
export function semanticVersionCompare(state, args) {
  const s = state.semantics; need(s, "This workspace has no semantic model.");
  const before = modelVersion(s, args.modelId, args.beforeVersionId).version, after = modelVersion(s, args.modelId, args.afterVersionId).version;
  const rows = contentChanges(before.content, after.content);
  return { modelId: args.modelId, beforeVersionId: before.id, afterVersionId: after.id, beforeContextId: before.contextId, afterContextId: after.contextId, totalChanges: rows.length, ...page(rows, args) };
}
export function previewSemanticReturn(state, verified) {
  need(verified.state.workspaceId === state.workspaceId, "Receive a returned model from this original workspace.", "HAYSTACK_SEMANTIC_RETURN", 409);
  validateSemanticState(verified.state);
  const incoming = verified.state.semantics, local = state.semantics;
  need(incoming && incoming.models.length, "The complete returned workspace contains no semantic model.");
  const models = incoming.models.map(model => {
    const right = byId(incoming.versions, model.headId, "returned model version");
    const existing = local?.models.find(row => row.id === model.id), left = existing ? byId(local.versions, existing.headId, "original model version") : null;
    return { modelId: model.id, title: right.content.title, localHeadId: left?.id || null, incomingHeadId: right.id,
      same: left?.id === right.id, localContextId: left?.contextId || null, incomingContextId: right.contextId,
      changes: contentChanges(left?.content, right.content),
      incomingAssessment: assessSemanticContent(right.content, byId(incoming.contexts, right.contextId, "returned source context")) };
  });
  return { packageSha256: verified.packageSha256, workspaceId: state.workspaceId, incomingRevision: verified.state.revision,
    comparisonMeaning: "Each decision keeps the complete local model or adopts the complete returned model version. Both version histories and all original sources remain retained; fields are never silently combined.",
    models };
}
export function applySemanticReturn(state, args, verified) {
  const preview = previewSemanticReturn(state, verified), s = semanticState(state), incoming = verified.state.semantics;
  list(args.decisions, "complete per-model return decisions", 200);
  distinct(args.decisions, "modelId", "return decisions");
  need(args.decisions.length === preview.models.length && preview.models.every(row => args.decisions.some(decision => decision.modelId === row.modelId)), "Decide every model in the complete returned workspace.");
  for (const decision of args.decisions) {
    object(decision, ["modelId", "decision", "expectedLocalHeadId", "expectedIncomingHeadId"], ["modelId", "decision", "expectedLocalHeadId", "expectedIncomingHeadId"]);
    const comparison = preview.models.find(row => row.modelId === decision.modelId);
    need(comparison && ["keep", "adopt"].includes(decision.decision) && comparison.localHeadId === decision.expectedLocalHeadId && comparison.incomingHeadId === decision.expectedIncomingHeadId,
      "The model heads changed after the complete return review.", "HAYSTACK_SEMANTIC_HEAD", 409);
  }
  function mergeRows(key, selected) {
    const retained = new Map(s[key].map(row => [row.id, row]));
    for (const row of incoming[key]) {
      if (!selected(row)) continue;
      const existing = retained.get(row.id);
      need(!existing || digest(existing) === digest(row), "The returned immutable " + key + " identity differs.", "HAYSTACK_SEMANTIC_RETURN", 409);
      if (!existing) { const accepted = clone(row); s[key].push(accepted); retained.set(accepted.id, accepted); }
    }
  }
  // Keep/adopt chooses the active model head, not whether evidence survives.
  // Retain every returned immutable source, version, review and native output
  // once by identity, including models explicitly kept out of the active list.
  for (const key of ["assets", "intakes", "contexts", "versions", "validations", "reviews", "returns"]) mergeRows(key, () => true);
  for (const incomingModel of incoming.models) {
    const localModel = s.models.find(row => row.id === incomingModel.id);
    if (localModel) need(localModel.createdAt === incomingModel.createdAt && localModel.createdBy === incomingModel.createdBy,
      "The returned model identity belongs to another original creation.", "HAYSTACK_SEMANTIC_RETURN", 409);
  }
  const outcomes = [];
  for (const decision of args.decisions) {
    const comparison = preview.models.find(row => row.modelId === decision.modelId);
    if (decision.decision === "keep") { outcomes.push({ ...clone(decision), headId: comparison.localHeadId }); continue; }
    const foreignModel = byId(incoming.models, decision.modelId, "returned model"), foreignVersion = byId(incoming.versions, foreignModel.headId, "returned model version");
    let model = s.models.find(row => row.id === decision.modelId);
    if (!model) { model = clone(foreignModel); s.models.push(model); }
    else if (model.headId !== foreignVersion.id) {
      const currentId = model.headId;
      newVersion(s, model, foreignVersion.content, foreignVersion.contextId, args, [currentId, foreignVersion.id]);
    }
    outcomes.push({ ...clone(decision), headId: model.headId });
  }
  const receipt = hashRecord({ format: "commons.haystack.semantic-return.v1", packageSha256: verified.packageSha256, payloadSha256: verified.payloadSha256,
    incomingRevision: verified.state.revision, incomingStateSha256: verified.state.sha256,
    incomingModels: clone(incoming.models),
    application: [...verified.application].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) })),
    receivedAt: now(), author: text(args.author, "return reviewer", 240, true),
    note: text(args.note, "complete return decision note", FIELD_LIMIT, true), decisions: outcomes,
    comparisons: preview.models.map(row => ({ modelId: row.modelId, localHeadId: row.localHeadId, incomingHeadId: row.incomingHeadId, changes: clone(row.changes) })) });
  s.returns.push(receipt); const { comparisons: omittedComparisons, ...summary } = receipt; return { return: clone(summary), models: semanticModelRows(state) };
}
export function validateSemanticState(state) {
  const s = state.semantics; if (s === undefined) return state;
  object(s, ["format", "assets", "intakes", "contexts", "models", "versions", "validations", "reviews", "returns"], ["format", "assets", "intakes", "contexts", "models", "versions", "validations", "reviews", "returns"]);
  need(s.format === SEMANTIC_FORMAT, "Use the complete supported semantic workspace history.", "HAYSTACK_SEMANTIC_STATE", 409);
  for (const key of ["assets", "intakes", "contexts", "models", "versions", "validations", "reviews", "returns"]) { list(s[key], "semantic " + key, key === "models" ? 200 : key === "intakes" ? 100 : 10000); distinct(s[key], "id", key); }
  for (const row of s.assets) { hash(row.id); integer(row.bytes, "semantic source bytes", 0, 64 * 1024 * 1024); retainedAsset(s, row.id); }
  for (const row of s.intakes) {
    id(row.id); need(retainedAsset(s, row.assetId).length === row.bytes, "The complete original point-list source differs.");
    list(row.columns, "source columns", 256); list(row.rows, "source rows", MAX_SEMANTIC_ROWS);
    need(row.rowEndLines.length === row.rows.length && digest({ columns: row.columns, rows: row.rows, rowEndLines: row.rowEndLines }) === row.contentSha256, "The complete native point-list inspection differs.", "HAYSTACK_SEMANTIC_SOURCE", 409);
  }
  for (const context of s.contexts) {
    need(context.format === "commons.haystack.semantic-context.v1" && context.id === rawHash(context) && context.workspaceId === state.workspaceId, "The original semantic source context differs.", "HAYSTACK_SEMANTIC_CONTEXT", 409);
    list(context.records, "source context records", MAX_SEMANTIC_ROWS); need(new Set(context.records.map(row => sourceRefKey(row.ref))).size === context.records.length, "A source context repeats an original row.");
    context.records.forEach(row => sourceRef(row.ref));
    context.nativeSources.forEach(row => need(retainedAsset(s, row.assetId).length === row.bytes, "The model lost a complete original native source."));
    context.intakes.forEach(row => need(digest(row) === digest(byId(s.intakes, row.id, "point-list intake")), "The model's original point-list inspection differs."));
  }
  const versions = new Map(s.versions.map(row => [row.id, row]));
  for (const version of s.versions) {
    need(version.format === "commons.haystack.semantic-version.v1" && version.id === rawHash(version) && version.contentSha256 === digest(version.content), "The complete original model version differs.", "HAYSTACK_SEMANTIC_VERSION", 409);
    id(version.modelId); list(version.parents, "version parents", 2); need(new Set(version.parents).size === version.parents.length, "A version repeats its parent.");
    validateSemanticContent(version.content, byId(s.contexts, version.contextId, "model source context"));
    for (const parent of version.parents) need(versions.get(parent)?.modelId === version.modelId && parent !== version.id, "The model version loses its complete original ancestry.");
  }
  const colors = new Map();
  for (const root of versions.keys()) {
    if (colors.get(root) === 2) continue;
    const stack = [{ key: root, leaving: false }];
    while (stack.length) {
      const frame = stack.pop();
      if (frame.leaving) { colors.set(frame.key, 2); continue; }
      need(colors.get(frame.key) !== 1, "The model ancestry contains a cycle.");
      if (colors.get(frame.key) === 2) continue;
      colors.set(frame.key, 1); stack.push({ key: frame.key, leaving: true });
      for (const parent of versions.get(frame.key).parents) stack.push({ key: parent, leaving: false });
    }
  }
  for (const model of s.models) { id(model.id); need(versions.get(model.headId)?.modelId === model.id, "The model head belongs to another history."); }
  for (const row of s.validations) {
    need(row.id === rawHash(row) && versions.get(row.versionId)?.modelId === row.modelId && versions.get(row.versionId).contentSha256 === row.contentSha256 && typeof row.conforms === "boolean", "The native validation identity differs.");
    row.outputs.forEach(file => need(retainedAsset(s, file.sha256).length === file.bytes, "The complete native validation output differs."));
  }
  for (const row of s.reviews) need(row.id === rawHash(row) && versions.get(row.versionId)?.modelId === row.modelId && (!row.validationId || s.validations.some(validation => validation.id === row.validationId && validation.versionId === row.versionId)), "The original model review refers to different source.");
  for (const row of s.returns) {
    need(row.id === rawHash(row), "The original returned-model decision differs.");
    hash(row.packageSha256); hash(row.payloadSha256); hash(row.incomingStateSha256);
    list(row.incomingModels, "returned model creation identities", 200);
    for (const model of row.incomingModels) {
      id(model.id); need(versions.get(model.headId)?.modelId === model.id, "The kept or adopted returned model loses its original complete version.");
    }
    for (const decision of row.decisions) {
      need(["keep", "adopt"].includes(decision.decision) && versions.get(decision.expectedIncomingHeadId)?.modelId === decision.modelId,
        "The original model return lost its complete incoming history.");
      if (decision.headId) need(versions.get(decision.headId)?.modelId === decision.modelId, "The original model return lost its selected result history.");
    }
  }
  return state;
}
