import { parseGrid, validateGrid, isTagName } from "./haystack-types.mjs";
import { applyCorrectiveAction, validateCorrectiveState, workSummary } from "./corrective-work.mjs";
import { analyzeGrids } from "./haystack-index.mjs";
import { clone, digest, sha256, canonical, now, newId, need, plain, own, hash, id, text, integer, fields, base64, recordKey, splitRecordKey, page } from "./util.mjs";

export const FORMAT = "commons.haystack.workspace.v1";
export const SOURCE_MAX_BYTES = 32 * 1024 * 1024;
export const STATE_MAX_BYTES = 128 * 1024 * 1024;
export const SOURCE_MAX_COUNT = 100;
export const EDIT_MAX_COUNT = 2000;

export function freshState(title = "Building turnover") {
  text(title, "a workspace title", 160, true);
  const state = { format: FORMAT, workspaceId: newId(), title, revision: 0, createdAt: now(),
    selectedSourceIds: [], sources: [], proposals: [], editions: [], operations: [] };
  return seal(state);
}
export function seal(value) {
  const state = clone(value); delete state.sha256; state.sha256 = digest(state); return state;
}
export function sourceSummary(source) {
  const { base64: omitted, ...metadata } = source; return clone(metadata);
}
export function sourceGrid(source) {
  const raw = base64(source.base64, SOURCE_MAX_BYTES);
  need(raw.length === source.bytes && sha256(raw) === source.id, "The retained original source bytes differ.", "HAYSTACK_SOURCE", 409);
  return parseGrid(raw, { format: source.format }).grid;
}
export function sourceRecord(raw, { name, sourceUrl = "", format = "json-v4" }) {
  text(name, "the original source name", 240, true); text(sourceUrl, "the original source URL", 4000);
  need(format === "json-v4", "Import a complete Haystack JSON v4 grid.", "HAYSTACK_FORMAT");
  const bytes = Buffer.from(raw); need(bytes.length > 0 && bytes.length <= SOURCE_MAX_BYTES, "Import a complete grid of at most 32 MiB.", "HAYSTACK_SIZE", 413);
  const decoded = parseGrid(bytes, { format });
  return { id: sha256(bytes), name, sourceUrl, format, bytes: bytes.length, importedAt: now(),
    gridSha256: digest(decoded.grid), rows: decoded.grid.rows.length, columns: decoded.grid.cols.length,
    diagnostics: clone(decoded.diagnostics || []), base64: bytes.toString("base64") };
}
export function findSource(state, sourceId) {
  hash(sourceId, "source identity"); const source = state.sources.find(item => item.id === sourceId);
  need(source, "This workspace does not retain the selected source.", "HAYSTACK_SOURCE_MISSING", 404); return source;
}
export function findProposal(state, proposalId) {
  id(proposalId, "proposal ID"); const proposal = state.proposals.find(item => item.id === proposalId);
  need(proposal, "This workspace does not retain the selected proposal.", "HAYSTACK_PROPOSAL_MISSING", 404); return proposal;
}
export function findEdition(state, editionId) {
  hash(editionId, "edition identity"); const edition = state.editions.find(item => item.id === editionId);
  need(edition, "This workspace does not retain the selected edition.", "HAYSTACK_EDITION_MISSING", 404); return edition;
}
export function cell(row, tag) { return own(row, tag) ? { present: true, value: clone(row[tag]) } : { present: false }; }
function assign(row, tag, value) { Object.defineProperty(row, tag, { value: clone(value), enumerable: true, configurable: true, writable: true }); }
function applyChanges(grids, changes, expected = true) {
  const map = new Map(grids.map(item => [item.sourceId, item.grid]));
  const touched = new Set();
  for (const change of changes) {
    const { sourceId, rowIndex } = splitRecordKey(change.recordKey), grid = map.get(sourceId);
    if (!grid) continue;
    need(rowIndex < grid.rows.length, "The source row is unavailable.", "HAYSTACK_ROW", 409);
    const row = grid.rows[rowIndex];
    if (expected) need(digest(cell(row, change.tag)) === digest(change.before), "The original cell changed before this proposal.", "HAYSTACK_PROPOSAL_SOURCE", 409, { recordKey: change.recordKey, tag: change.tag });
    if (change.after.present) {
      assign(row, change.tag, change.after.value);
      if (!grid.cols.some(column => column.name === change.tag)) grid.cols.push({ name: change.tag });
    } else delete row[change.tag];
    touched.add(sourceId);
  }
  for (const sourceId of touched) validateGrid(map.get(sourceId));
}
export function materialize(state, selection = null) {
  const sourceIds = selection ? selection.sourceIds : state.selectedSourceIds;
  need(Array.isArray(sourceIds) && new Set(sourceIds).size === sourceIds.length, "Select each original source once.");
  const selected = new Set(sourceIds), grids = sourceIds.map(sourceId => ({ sourceId, grid: sourceGrid(findSource(state, sourceId)) }));
  let proposals;
  if (selection) proposals = selection.approvedProposalIds.map(proposalId => {
    const proposal = findProposal(state, proposalId);
    need(proposal.state === "accepted", "The edition references an unaccepted proposal.", "HAYSTACK_EDITION", 409); return proposal;
  });
  else proposals = state.proposals.filter(item => item.state === "accepted" && item.changes.some(change => selected.has(splitRecordKey(change.recordKey).sourceId)));
  proposals.sort((left, right) => left.reviewedRevision - right.reviewedRevision);
  for (const proposal of proposals) applyChanges(grids, proposal.changes);
  const approvedProposalIds = proposals.map(item => item.id);
  const content = { sourceIds: [...sourceIds], approvedProposalIds, grids };
  return { ...content, contentSha256: digest(content) };
}
export function analyzed(state, selection = null) {
  const material = materialize(state, selection), analysis = analyzeGrids(material.grids);
  const sources = material.sourceIds.map(sourceId => sourceSummary(findSource(state, sourceId)));
  const originalSourceDiagnostics = sources.flatMap(source => source.diagnostics.map(diagnostic => ({ ...diagnostic, sourceId: source.id, scope: "original-source", id: digest({ sourceId: source.id, diagnostic }) })));
  return { workspaceId: state.workspaceId, revision: state.revision, title: state.title, ...material, ...analysis, sources, originalSourceDiagnostics };
}
export function summary(state) {
  const current = analyzed(state);
  return { format: state.format, workspaceId: state.workspaceId, title: state.title, revision: state.revision,
    createdAt: state.createdAt, sha256: state.sha256, materialSha256: current.contentSha256,
    selectedSourceIds: [...state.selectedSourceIds], sourceCount: state.sources.length, editionCount: state.editions.length,
    proposalCount: state.proposals.length, pendingProposals: state.proposals.filter(item => item.state === "proposed").length,
    recordCount: current.records.length, counts: current.counts,
    workCounts: workSummary(state),
    diagnosticCount: current.diagnostics.length, sourceDiagnostics: current.sources.reduce((total, source) => total + source.diagnostics.length, 0) };
}
export function proposedChanges(state, edits) {
  need(Array.isArray(edits) && edits.length > 0 && edits.length <= EDIT_MAX_COUNT, "Prepare between 1 and 2,000 complete tag edits.");
  const current = materialize(state), gridMap = new Map(current.grids.map(item => [item.sourceId, item.grid]));
  const keys = new Set(), changes = [];
  for (const edit of edits) {
    fields(edit, ["recordKey", "tag", "action", "value"], ["recordKey", "tag", "action"]);
    const { sourceId, rowIndex } = splitRecordKey(edit.recordKey), grid = gridMap.get(sourceId);
    need(grid && rowIndex < grid.rows.length, "Choose a row in the current selected sources.", "HAYSTACK_ROW", 409);
    need(isTagName(edit.tag), "Choose a valid Haystack tag name.");
    need(edit.action === "set" || edit.action === "remove", "Choose set or remove for the complete tag edit.");
    need((edit.action === "set") === own(edit, "value"), "A set edit needs its typed value; remove uses the original tag identity.");
    const key = edit.recordKey + "\0" + edit.tag;
    need(!keys.has(key), "Edit each source row/tag once in a proposal."); keys.add(key);
    const before = cell(grid.rows[rowIndex], edit.tag), after = edit.action === "set" ? { present: true, value: clone(edit.value) } : { present: false };
    need(digest(before) !== digest(after), "The proposed tag already has this complete value.", "HAYSTACK_NO_CHANGE", 400, { recordKey: edit.recordKey, tag: edit.tag });
    changes.push({ recordKey: edit.recordKey, tag: edit.tag, before, after });
  }
  const projected = clone(current.grids); applyChanges(projected, changes);
  return { materialSha256: current.contentSha256, changes, preview: analyzeGrids(projected) };
}
export function proposalView(state, proposal) {
  const current = materialize(state);
  return { ...clone(proposal), stale: proposal.state === "proposed" && proposal.baseMaterialSha256 !== current.contentSha256 };
}
export function applyAction(state, action, args) {
  if (action.startsWith("work.")) return applyCorrectiveAction(state, action, args, { analyzed, editionView, materialize });
  if (action === "workspace.rename") { text(args.title, "a workspace title", 160, true); state.title = args.title; return { title: state.title }; }
  if (action === "source.import") {
    const source = sourceRecord(base64(args.base64, SOURCE_MAX_BYTES), args), prior = state.sources.find(item => item.id === source.id);
    if (prior) return { source: sourceSummary(prior), alreadyRetained: true };
    need(state.sources.length < SOURCE_MAX_COUNT, "This workspace retains its complete 100-source limit.", "HAYSTACK_SIZE", 413);
    state.sources.push(source); if (args.select !== false) state.selectedSourceIds.push(source.id);
    return { source: sourceSummary(source), selected: state.selectedSourceIds.includes(source.id) };
  }
  if (action === "source.select") {
    need(Array.isArray(args.sourceIds) && args.sourceIds.length <= SOURCE_MAX_COUNT && new Set(args.sourceIds).size === args.sourceIds.length, "Select each complete source once.");
    for (const sourceId of args.sourceIds) findSource(state, sourceId);
    state.selectedSourceIds = [...args.sourceIds]; return { sourceIds: [...state.selectedSourceIds] };
  }
  if (action === "proposal.prepare") {
    text(args.title, "a proposal title", 160, true); text(args.note ?? "", "the complete proposal note");
    const prepared = proposedChanges(state, args.edits);
    const proposal = { id: id(args.proposalId || args.operationId, "proposal ID"), title: args.title, note: args.note || "",
      createdAt: now(), createdRevision: state.revision + 1, baseMaterialSha256: prepared.materialSha256,
      state: "proposed", changes: prepared.changes, review: null };
    need(!state.proposals.some(item => item.id === proposal.id), "This proposal identity already belongs to original work.", "HAYSTACK_PROPOSAL_ID", 409);
    proposal.sha256 = digest(proposal); state.proposals.push(proposal);
    return { proposal: proposalView(state, proposal), preview: { counts: prepared.preview.counts, diagnostics: prepared.preview.diagnostics } };
  }
  if (action === "proposal.review") {
    const proposal = findProposal(state, args.proposalId);
    need(proposal.state === "proposed", "This proposal retains its completed review.", "HAYSTACK_PROPOSAL_TERMINAL", 409);
    need(args.decision === "accept" || args.decision === "reject", "Choose accept or reject.");
    text(args.note ?? "", "the complete review note");
    if (args.decision === "accept") need(materialize(state).contentSha256 === proposal.baseMaterialSha256,
      "The selected source or accepted edits changed. Prepare the complete intended edits against the current view.", "HAYSTACK_PROPOSAL_STALE", 409);
    const original = clone(proposal); delete original.sha256;
    need(digest(original) === proposal.sha256, "The proposed review changed.", "HAYSTACK_PROPOSAL", 409);
    proposal.review = { decision: args.decision, note: args.note || "", reviewedAt: now(), proposalSha256: proposal.sha256 };
    proposal.state = args.decision === "accept" ? "accepted" : "rejected"; proposal.reviewedRevision = state.revision + 1;
    delete proposal.sha256; proposal.sha256 = digest(proposal);
    if (args.decision === "accept") materialize(state);
    return { proposal: proposalView(state, proposal) };
  }
  if (action === "edition.save") {
    text(args.title, "an edition title", 160, true); text(args.note ?? "", "the complete edition note");
    const current = analyzed(state);
    need(current.sourceIds.length > 0, "Select the original source grids for this edition.");
    const edition = { title: args.title, note: args.note || "", savedAt: now(), savedRevision: state.revision + 1,
      sourceIds: current.sourceIds, approvedProposalIds: current.approvedProposalIds,
      materialSha256: current.contentSha256, counts: clone(current.counts),
      diagnosticCount: current.diagnostics.length, diagnosticSha256: digest(current.diagnostics) };
    edition.id = digest(edition); state.editions.push(edition); return { edition: clone(edition) };
  }
  need(false, "Choose a declared Haystack mutation.", "HAYSTACK_ACTION", 404);
}
export function editionView(state, editionId) {
  const edition = findEdition(state, editionId), result = analyzed(state, edition);
  need(result.contentSha256 === edition.materialSha256, "This edition differs from its retained source and accepted edits.", "HAYSTACK_EDITION", 409);
  return { ...result, edition: clone(edition) };
}
export function compareEditions(state, beforeId, afterId, { sourcePairs = [] } = {}) {
  const before = editionView(state, beforeId), after = editionView(state, afterId);
  need(Array.isArray(sourcePairs) && sourcePairs.length <= SOURCE_MAX_COUNT, "Choose complete source pairs for comparison.");
  const leftGroups = new Map(), rightGroups = new Map();
  sourcePairs.forEach((pair, index) => {
    fields(pair, ["beforeSourceId", "afterSourceId"], ["beforeSourceId", "afterSourceId"]);
    hash(pair.beforeSourceId); hash(pair.afterSourceId);
    need(before.sourceIds.includes(pair.beforeSourceId) && after.sourceIds.includes(pair.afterSourceId),
      "A comparison pair must select a source from each edition.");
    need(!leftGroups.has(pair.beforeSourceId) && !rightGroups.has(pair.afterSourceId), "Pair each source at most once.");
    leftGroups.set(pair.beforeSourceId, "pair:" + index); rightGroups.set(pair.afterSourceId, "pair:" + index);
  });
  function keyed(records, groups) {
    const groupedId = row => (groups.get(row.sourceId) || "source:" + row.sourceId) + "\0" + row.id;
    const counts = new Map();
    for (const row of records) if (row.id) counts.set(groupedId(row), (counts.get(groupedId(row)) || 0) + 1);
    return new Map(records.map(row => {
      const group = groups.get(row.sourceId) || "source:" + row.sourceId;
      const key = groups.has(row.sourceId) && row.id && counts.get(groupedId(row)) === 1 ? group + ":id:" + row.id : "row:" + row.key;
      return [key, row];
    }));
  }
  const left = keyed(before.records, leftGroups), right = keyed(after.records, rightGroups), rows = [];
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(key) || null, b = right.get(key) || null;
    const outcome = !a ? "added" : !b ? "removed" : digest(a.tags) === digest(b.tags) ? "same" : "changed";
    const tags = [...new Set([...Object.keys(a?.tags || {}), ...Object.keys(b?.tags || {})])].sort();
    const changes = tags.filter(tag => digest(cell(a?.tags || {}, tag)) !== digest(cell(b?.tags || {}, tag)))
      .map(tag => ({ tag, before: cell(a?.tags || {}, tag), after: cell(b?.tags || {}, tag) }));
    rows.push({ key, state: outcome, before: a, after: b, changes });
  }
  return { beforeEditionId: beforeId, afterEditionId: afterId, sourcePairs: clone(sourcePairs),
    counts: Object.fromEntries(["added", "removed", "changed", "same"].map(name => [name, rows.filter(row => row.state === name).length])), rows };
}
export function validateState(state, { sources = true } = {}) {
  need(plain(state) && state.format === FORMAT, "Use a complete Haystack workspace.", "HAYSTACK_WORKSPACE", 409);
  id(state.workspaceId, "workspace ID"); text(state.title, "a workspace title", 160, true); integer(state.revision, "workspace revision");
  for (const key of ["selectedSourceIds", "sources", "proposals", "editions", "operations"]) need(Array.isArray(state[key]), "The complete workspace lacks " + key + ".", "HAYSTACK_WORKSPACE", 409);
  const body = clone(state); delete body.sha256;
  need(hash(state.sha256) === digest(body), "The complete saved workspace changed.", "HAYSTACK_WORKSPACE", 409);
  need(state.operations.length === state.revision && state.sources.length <= SOURCE_MAX_COUNT, "The original workspace revision/count differs.", "HAYSTACK_WORKSPACE", 409);
  for (const [array, key] of [[state.sources, "id"], [state.proposals, "id"], [state.editions, "id"], [state.operations, "id"]])
    need(new Set(array.map(item => item[key])).size === array.length, "The original workspace has duplicate identities.", "HAYSTACK_WORKSPACE", 409);
  let prior = null;
  for (let index = 0; index < state.operations.length; index++) {
    const op = state.operations[index], content = clone(op); delete content.sha256;
    need(op.revision === index + 1 && op.previousSha256 === prior && op.sha256 === digest(content), "The original operation history differs.", "HAYSTACK_WORKSPACE", 409);
    id(op.id); hash(op.argumentsSha256); prior = op.sha256;
  }
  for (const source of state.sources) {
    hash(source.id); integer(source.bytes, "original source bytes", 1, SOURCE_MAX_BYTES);
    if (sources) { const grid = sourceGrid(source); need(digest(grid) === source.gridSha256 && grid.rows.length === source.rows && grid.cols.length === source.columns, "The native source grid metadata differs.", "HAYSTACK_SOURCE", 409); }
  }
  for (const proposal of state.proposals) {
    const content = clone(proposal); delete content.sha256;
    need(proposal.sha256 === digest(content) && ["proposed", "accepted", "rejected"].includes(proposal.state), "The complete proposal history changed.", "HAYSTACK_PROPOSAL", 409);
    id(proposal.id); hash(proposal.baseMaterialSha256); need(Array.isArray(proposal.changes) && proposal.changes.length > 0 && proposal.changes.length <= EDIT_MAX_COUNT, "The proposal lacks its full edits.");
    for (const change of proposal.changes) {
      splitRecordKey(change.recordKey); need(isTagName(change.tag) && plain(change.before) && plain(change.after), "The proposal has an incomplete source edit.");
      for (const side of [change.before, change.after]) need(typeof side.present === "boolean" && (side.present === own(side, "value")), "The source edit loses its original presence/value.");
    }
  }
  for (const edition of state.editions) {
    const content = clone(edition); delete content.id;
    need(edition.id === digest(content) && Array.isArray(edition.sourceIds) && Array.isArray(edition.approvedProposalIds), "The saved edition changed.", "HAYSTACK_EDITION", 409);
    if (sources) need(materialize(state, edition).contentSha256 === edition.materialSha256, "The edition loses its original materialization.", "HAYSTACK_EDITION", 409);
  }
  materialize(state); validateCorrectiveState(state, { materialize }); return state;
}
