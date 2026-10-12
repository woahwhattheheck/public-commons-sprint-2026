import { clone, digest, sha256, canonical, base64, fields, hash, id, integer, text, plain, need, now, splitRecordKey } from "./util.mjs";

export const WORK_FORMAT = "commons.haystack.corrective-work.v1";
export const WORK_STATUSES = ["open", "in-progress", "submitted", "verified", "exception"];
export const WORK_PRIORITIES = ["routine", "high", "critical"];
export const WORK_FIELDS = ["title", "description", "assignee", "dueDate", "priority"];
export const EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;
const ITEM_LIMIT = 10000, EVENT_LIMIT = 100000;
const empty = () => ({ format: WORK_FORMAT, items: [], events: [], contexts: [], evidence: [], returns: [] });
const equal = (a, b) => canonical(a) === canonical(b);
const seal = body => ({ ...clone(body), sha256: digest(body) });
const index = values => new Map(values.map(value => [value.sha256 || value.id, value]));
function saved(state, create = false) {
  if (!state.correctiveWork && create) state.correctiveWork = empty();
  return state.correctiveWork || empty();
}
function unchangedHash(value, label) {
  const body = clone(value); delete body.sha256;
  need(hash(value.sha256) === digest(body), label + " differs from its retained content.", "HAYSTACK_WORK_HISTORY", 409);
}
function date(value) {
  text(value, "a due date", 10);
  const parsed = value ? new Date(value + "T00:00:00.000Z") : null;
  need(value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value),
    "Use a complete valid YYYY-MM-DD due date or an empty date.");
}
function workFields(value) {
  fields(value, WORK_FIELDS, WORK_FIELDS);
  text(value.title, "a work-item title", 160, true);
  text(value.description, "the complete work description", 12000);
  text(value.assignee, "the responsible person or team", 240);
  date(value.dueDate);
  need(WORK_PRIORITIES.includes(value.priority), "Choose routine, high or critical priority.");
  return value;
}
function actor(args) {
  text(args.author, "the operator's name", 240, true);
  text(args.note ?? "", "the complete work note", 12000);
}
export function findWork(state, itemId) {
  id(itemId, "work-item ID");
  const item = saved(state).items.find(value => value.id === itemId);
  need(item, "This workspace does not retain that work item.", "HAYSTACK_WORK_MISSING", 404);
  return item;
}
function head(work, item) {
  const event = work.events.find(value => value.sha256 === item.headSha256);
  need(event && event.itemId === item.id, "The work item lost its original history.", "HAYSTACK_WORK_HISTORY", 409);
  return event;
}
function append(work, item, args, kind, patch = {}) {
  need(work.events.length < EVENT_LIMIT, "The complete work history has reached its 100,000-event capacity.", "HAYSTACK_SIZE", 413);
  const previous = item.headSha256 ? head(work, item) : null;
  const body = {
    itemId: item.id, sequence: (previous?.sequence || 0) + 1,
    previousSha256: previous?.sha256 || null, operationId: id(args.operationId),
    at: now(), author: args.author, kind, note: args.note || "",
    fields: clone(previous?.fields || patch.fields),
    status: previous?.status || "open", evidenceIds: [...(previous?.evidenceIds || [])],
    submission: clone(previous?.submission || null), review: clone(previous?.review || null),
    ...clone(patch)
  };
  workFields(body.fields);
  const event = seal(body);
  need(!work.events.some(value => value.sha256 === event.sha256), "This complete work event is already retained.", "HAYSTACK_WORK_HISTORY", 409);
  work.events.push(event); item.headSha256 = event.sha256;
  return event;
}
function editable(current) {
  need(["open", "in-progress"].includes(current.status),
    "Reopen the submitted or completed work before changing its assignment or evidence.", "HAYSTACK_WORK_STATE", 409);
}
function diagnostics(view) { return [...view.diagnostics, ...(view.originalSourceDiagnostics || [])]; }
export function findingAt(view, origin) {
  const common = { currentMaterialSha256: view.contentSha256 };
  if (!view.sourceIds.includes(origin.sourceId)) return { ...common, state: "source-unselected", diagnostic: null };
  if (origin.recordKey && !view.records.some(record => record.key === origin.recordKey))
    return { ...common, state: "record-unavailable", diagnostic: null };
  if (!origin.diagnostic) return { ...common, state: "manual", diagnostic: null };
  const current = diagnostics(view).find(item => item.id === origin.diagnostic.id);
  return { ...common, state: !current ? "absent" : digest(current) === origin.diagnosticSha256 ? "present" : "changed",
    diagnostic: current ? clone(current) : null };
}
function viewFor(state, args, api) { return args.editionId ? api.editionView(state, args.editionId) : api.analyzed(state); }
function retainContext(state, view) {
  const work = saved(state, true);
  const proposals = view.approvedProposalIds.map(proposalId => {
    const proposal = state.proposals.find(item => item.id === proposalId);
    need(proposal?.state === "accepted", "The reviewed material lacks its accepted proposal.", "HAYSTACK_WORK_CONTEXT", 409);
    return clone(proposal);
  });
  const body = { materialSha256: view.contentSha256, sourceIds: [...view.sourceIds],
    approvedProposalIds: [...view.approvedProposalIds], proposals };
  const contextId = digest(body);
  if (!work.contexts.some(item => item.id === contextId)) work.contexts.push(seal({ id: contextId, ...body }));
  return contextId;
}
function captureOrigin(state, args, api) {
  const view = viewFor(state, args, api);
  need(hash(args.materialSha256) === view.contentSha256,
    "The finding view changed. Read the complete current record or diagnostic before saving it.", "HAYSTACK_WORK_CONTEXT", 409);
  let diagnostic = null;
  if (args.diagnosticId) {
    hash(args.diagnosticId, "diagnostic ID"); hash(args.diagnosticSha256, "complete diagnostic SHA-256");
    diagnostic = diagnostics(view).find(value => value.id === args.diagnosticId);
    need(diagnostic && digest(diagnostic) === args.diagnosticSha256,
      "The complete diagnostic changed. Read its current details before recording the work.", "HAYSTACK_WORK_DIAGNOSTIC", 409);
  } else need(args.diagnosticSha256 === undefined, "A diagnostic SHA-256 needs its original diagnostic ID.");
  const recordKey = args.recordKey || diagnostic?.recordKey || null;
  need(recordKey || diagnostic, "Choose one original record or a complete diagnostic for the finding.");
  if (diagnostic?.recordKey && args.recordKey) need(args.recordKey === diagnostic.recordKey, "The selected record differs from this diagnostic.");
  const sourceId = recordKey ? splitRecordKey(recordKey).sourceId : diagnostic.sourceId;
  need(view.sourceIds.includes(sourceId), "Choose a finding in the selected original sources.");
  const record = recordKey ? view.records.find(value => value.key === recordKey) : null;
  need(!recordKey || record, "The complete finding record is unavailable.", "HAYSTACK_WORK_CONTEXT", 409);
  const contextId = retainContext(state, view);
  return seal({
    workspaceId: state.workspaceId, sourceId, recordKey, materialSha256: view.contentSha256, contextId,
    edition: view.edition ? clone(view.edition) : null,
    diagnostic: diagnostic ? clone(diagnostic) : null,
    diagnosticSha256: diagnostic ? digest(diagnostic) : null,
    record: record ? clone(record) : null,
    recordSha256: record ? digest(record) : null
  });
}
function progressSnapshot(state, item, args, api) {
  const view = viewFor(state, args, api), finding = findingAt(view, item.origin);
  need(!["source-unselected", "record-unavailable"].includes(finding.state),
    "Select the original source and record before submitting or reviewing this work.", "HAYSTACK_WORK_CONTEXT", 409);
  return { materialSha256: view.contentSha256, contextId: retainContext(state, view),
    edition: view.edition ? clone(view.edition) : null, finding };
}
function evidenceRecord(state, args) {
  const body = { kind: args.kind, author: args.author, note: args.note || "", recordedAt: now() };
  if (args.kind === "file") {
    need(args.proposalId === undefined, "A file attachment keeps its own identity.");
    text(args.name, "the complete evidence filename", 240, true);
    need(!/[\\/\u0000-\u001f\u007f]/.test(args.name), "Use a filename without path or control characters.");
    text(args.mediaType || "application/octet-stream", "the evidence media type", 160, true);
    need(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+(?:;[ -~]*)?$/.test(args.mediaType || "application/octet-stream"),
      "Use a complete single-line media type.");
    const bytes = base64(args.base64, EVIDENCE_MAX_BYTES);
    need(bytes.length > 0, "Retain a complete nonempty evidence file.");
    Object.assign(body, { name: args.name, mediaType: args.mediaType || "application/octet-stream",
      bytes: bytes.length, fileSha256: sha256(bytes), base64: args.base64 });
  } else if (args.kind === "proposal") {
    need(args.base64 === undefined && args.name === undefined && args.mediaType === undefined, "A proposal attachment retains the complete original proposal.");
    const proposal = state.proposals.find(value => value.id === id(args.proposalId, "proposal ID"));
    need(proposal, "Choose a retained native tag proposal.", "HAYSTACK_PROPOSAL_MISSING", 404);
    body.proposal = clone(proposal);
  } else {
    need(args.kind === "note" && args.base64 === undefined && args.proposalId === undefined &&
      args.name === undefined && args.mediaType === undefined, "Choose file, proposal or note evidence with its declared fields.");
    text(args.note, "a complete observation or evidence note", 12000, true);
  }
  const result = seal(body);
  return { ...result, id: result.sha256 };
}
function evidenceBody(record) {
  if (record.kind === "file") return { bytes: base64(record.base64, EVIDENCE_MAX_BYTES),
    name: record.name, mediaType: record.mediaType, sha256: record.fileSha256 };
  const body = clone(record); delete body.base64;
  const bytes = Buffer.from(canonical(body) + "\n");
  return { bytes, name: "haystack-" + record.kind + "-" + record.id.slice(0, 12) + ".json",
    mediaType: "application/json", sha256: sha256(bytes) };
}
export function evidenceSummary(record) {
  const { base64: omitted, ...metadata } = record, body = evidenceBody(record);
  return { ...clone(metadata), sha256: body.sha256, bytes: body.bytes.length, name: body.name, mediaType: body.mediaType };
}
export function evidenceBytes(state, evidenceId) {
  hash(evidenceId, "evidence identity");
  const record = saved(state).evidence.find(value => value.id === evidenceId);
  need(record, "This workspace does not retain that evidence.", "HAYSTACK_EVIDENCE_MISSING", 404);
  return { evidenceId, ...evidenceBody(record) };
}
function result(item, current, extra = {}) { return { itemId: item.id, headSha256: current.sha256, status: current.status, ...extra }; }
export function applyCorrectiveAction(state, action, args, api) {
  actor(args);
  const work = saved(state, true);
  if (action === "work.capture") {
    const values = workFields({ title: args.title, description: args.description || "", assignee: args.assignee || "",
      dueDate: args.dueDate || "", priority: args.priority || "routine" });
    const origin = captureOrigin(state, args, api);
    const existing = work.items.find(item => item.origin.sha256 === origin.sha256);
    if (existing) return result(existing, head(work, existing), { alreadyRetained: true });
    need(work.items.length < ITEM_LIMIT, "The complete work register has reached 10,000 items.", "HAYSTACK_SIZE", 413);
    const item = { id: id(args.operationId, "work-item ID"), origin, headSha256: null };
    need(!work.items.some(value => value.id === item.id), "This work-item ID already belongs to original work.", "HAYSTACK_WORK_ID", 409);
    work.items.push(item);
    return result(item, append(work, item, args, "capture", { fields: values }));
  }
  const item = findWork(state, args.itemId), current = head(work, item);
  need(hash(args.expectedHeadSha256) === current.sha256, "This work item changed. Read its complete current history before saving.", "HAYSTACK_WORK_STALE", 409);
  if (action === "work.update") {
    editable(current); const values = workFields(clone(args.fields));
    need(!equal(values, current.fields), "The work item already has these exact assignment details.", "HAYSTACK_NO_CHANGE");
    return result(item, append(work, item, args, "update", { fields: values, status: "in-progress" }));
  }
  if (action === "work.evidence") {
    editable(current);
    const evidence = evidenceRecord(state, args);
    if (!work.evidence.some(value => value.id === evidence.id)) work.evidence.push(evidence);
    return result(item, append(work, item, args, "evidence", { status: "in-progress",
      evidenceIds: [...new Set([...current.evidenceIds, evidence.id])] }), { evidence: evidenceSummary(evidence) });
  }
  if (action === "work.submit") {
    editable(current); text(args.note, "a complete submission note", 12000, true);
    need(current.evidenceIds.length > 0, "Retain the completed work's file, proposal or observation before submitting it.");
    const context = progressSnapshot(state, item, args, api);
    const priorRounds = work.events.filter(event => event.itemId === item.id && event.kind === "submit").map(event => event.submission?.round || 0);
    const submission = seal({ round: priorRounds.reduce((maximum, round) => Math.max(maximum, round), 0) + 1, at: now(), author: args.author, note: args.note,
      ...context, evidenceIds: [...current.evidenceIds], workHeadSha256: current.sha256 });
    return result(item, append(work, item, args, "submit", { status: "submitted", submission, review: null }), { submission });
  }
  if (action === "work.review") {
    need(["verify", "reopen", "accept-exception"].includes(args.decision), "Choose verify, reopen or accept-exception.");
    text(args.note, "the complete review decision", 12000, true);
    if (args.decision === "reopen") {
      need(["submitted", "verified", "exception"].includes(current.status), "Only submitted or completed work needs to be reopened.", "HAYSTACK_WORK_STATE", 409);
      return result(item, append(work, item, args, "reopen", { status: "in-progress", submission: null, review: null }));
    }
    const context = progressSnapshot(state, item, args, api);
    if (args.decision === "verify") {
      need(current.status === "submitted" && current.submission && hash(args.submissionSha256, "submission SHA-256") === current.submission.sha256,
        "Verify the exact retained submission currently awaiting review.", "HAYSTACK_WORK_SUBMISSION", 409);
      need(context.materialSha256 === current.submission.materialSha256,
        "The reviewed material changed after submission. Reopen the work and submit the current completed edition.", "HAYSTACK_WORK_SUBMISSION", 409);
      need(["absent", "manual"].includes(context.finding.state),
        "The captured diagnostic still appears in this edition. Complete its correction or record an explicit accepted exception.", "HAYSTACK_WORK_FINDING_PRESENT", 409);
    } else {
      need(!["verified", "exception"].includes(current.status), "Reopen completed work before making a new disposition.", "HAYSTACK_WORK_STATE", 409);
      if (args.submissionSha256 !== undefined) need(current.submission?.sha256 === hash(args.submissionSha256), "The reviewed submission changed.", "HAYSTACK_WORK_SUBMISSION", 409);
    }
    const review = { decision: args.decision, author: args.author, note: args.note, at: now(),
      submissionSha256: current.submission?.sha256 || null, ...context };
    return result(item, append(work, item, args, "review", { status: args.decision === "verify" ? "verified" : "exception", review }));
  }
  need(false, "Choose a declared corrective-work action.", "HAYSTACK_ACTION", 404);
}
export function workSummary(state) {
  const work = saved(state), events = index(work.events), counts = Object.fromEntries(WORK_STATUSES.map(value => [value, 0]));
  for (const item of work.items) counts[events.get(item.headSha256).status]++;
  return { total: work.items.length, ...counts, evidence: work.evidence.length, returns: work.returns.length };
}
export function workRows(state, args, api) {
  const work = saved(state), events = index(work.events), view = api.analyzed(state);
  const query = (args.query || "").trim().toLocaleLowerCase("en-US");
  text(query, "a work-register search", 1000);
  return work.items.map(item => {
    const current = events.get(item.headSha256);
    return { ...clone(item), current: clone(current), finding: findingAt(view, item.origin), evidenceCount: current.evidenceIds.length };
  }).filter(item => (!args.status || item.current.status === args.status) &&
    (!args.assignee || item.current.fields.assignee === args.assignee) &&
    (!args.priority || item.current.fields.priority === args.priority) &&
    (!args.sourceId || item.origin.sourceId === args.sourceId) &&
    (!query || [item.id, item.origin.recordKey || "", ...Object.values(item.current.fields)]
      .some(value => value.toLocaleLowerCase("en-US").includes(query))));
}
export function workView(state, itemId, api) {
  const item = findWork(state, itemId), work = saved(state), current = head(work, item);
  const history = work.events.filter(event => event.itemId === item.id).sort((a, b) => a.at.localeCompare(b.at) || a.sequence - b.sequence || a.sha256.localeCompare(b.sha256));
  const evidenceIds = new Set(history.flatMap(event => event.evidenceIds));
  return { ...clone(item), current: clone(current), history: clone(history),
    evidence: work.evidence.filter(value => evidenceIds.has(value.id)).map(evidenceSummary),
    finding: findingAt(api.analyzed(state), item.origin),
    context: clone(work.contexts.find(value => value.id === item.origin.contextId)) };
}
function parents(event) {
  return [...new Set([event.previousSha256, event.returnedHeadSha256].filter(Boolean))];
}
function orderedHistory(events, roots) {
  const colors = new Map(), order = [];
  for (const root of roots) {
    if (colors.get(root) === 2) continue;
    const stack = [{ sha256: root, next: 0 }]; colors.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1], event = events.get(frame.sha256);
      need(event, "The returned work history is incomplete.", "HAYSTACK_WORK_HISTORY", 409);
      const edges = parents(event);
      if (frame.next < edges.length) {
        const parentId = edges[frame.next++], parent = events.get(parentId);
        need(parent && parent.itemId === event.itemId, "The returned work history loses an original branch.", "HAYSTACK_WORK_HISTORY", 409);
        need(colors.get(parentId) !== 1, "The returned work history has a cycle.", "HAYSTACK_WORK_HISTORY", 409);
        if (colors.get(parentId) !== 2) { colors.set(parentId, 1); stack.push({ sha256: parentId, next: 0 }); }
      } else {
        stack.pop(); colors.set(frame.sha256, 2); order.push(event);
        need(order.length <= EVENT_LIMIT, "The returned work history exceeds its complete capacity.", "HAYSTACK_SIZE", 413);
      }
    }
  }
  return order.reverse();
}
function mergeBases(localHistory, incomingHistory) {
  const localIds = new Set(localHistory.map(event => event.sha256));
  const shared = new Map(incomingHistory.filter(event => localIds.has(event.sha256)).map(event => [event.sha256, event]));
  const older = new Set();
  for (const event of shared.values()) for (const parent of parents(event)) if (shared.has(parent)) older.add(parent);
  return [...shared.values()].filter(event => !older.has(event.sha256)).sort((a, b) => a.sha256.localeCompare(b.sha256));
}
const progress = event => event ? { status: event.status, submission: clone(event.submission), review: clone(event.review) } : null;
function mergeValue(bases, select, local, incoming) {
  const alternatives = bases.map(event => ({ headSha256: event.sha256, value: clone(select(event)) }));
  const base = alternatives[0]?.value ?? null;
  const ambiguous = alternatives.some(value => !equal(value.value, base));
  const conflict = !equal(local, incoming) && (ambiguous || (!equal(local, base) && !equal(incoming, base)));
  return { base: clone(base), local: clone(local), incoming: clone(incoming),
    suggested: clone(!ambiguous && equal(local, base) ? incoming : local), conflict,
    ...(ambiguous ? { baseAlternatives: alternatives, baseAmbiguous: true } : {}) };
}
export function previewReturn(state, verified) {
  const remote = verified.state;
  need(remote.workspaceId === state.workspaceId && remote.createdAt === state.createdAt,
    "Return the received copy of this original workspace.", "HAYSTACK_RETURN_WORKSPACE", 409);
  let commonRevision = 0;
  while (commonRevision < Math.min(state.operations.length, remote.operations.length) &&
    state.operations[commonRevision].sha256 === remote.operations[commonRevision].sha256) commonRevision++;
  const localWork = saved(state), incomingWork = saved(remote),
    localEvents = index(localWork.events), incomingEvents = index(incomingWork.events),
    localItems = new Map(localWork.items.map(item => [item.id, item]));
  need(incomingWork.items.length > 0, "The returned workspace contains no saved corrective work.", "HAYSTACK_RETURN_EMPTY");
  const items = incomingWork.items.map(incoming => {
    const local = localItems.get(incoming.id),
      incomingChain = orderedHistory(incomingEvents, [incoming.headSha256]), incomingCurrent = incomingChain[0];
    let localChain = [], localCurrent = null, common = [], kind = "new";
    if (local) {
      need(equal(local.origin, incoming.origin), "The returned item has a different original finding.", "HAYSTACK_RETURN_ORIGIN", 409, { itemId: local.id });
      localChain = orderedHistory(localEvents, [local.headSha256]); localCurrent = localChain[0];
      common = mergeBases(localChain, incomingChain);
      need(common.length, "The returned item lacks this finding's shared original history.", "HAYSTACK_RETURN_ORIGIN", 409, { itemId: local.id });
      kind = local.headSha256 === incoming.headSha256 ? "same" :
        incomingChain.some(event => event.sha256 === local.headSha256) ? "incoming" :
        localChain.some(event => event.sha256 === incoming.headSha256) ? "local-ahead" : "diverged";
    }
    const values = Object.fromEntries(WORK_FIELDS.map(key => [key, mergeValue(common, event => event.fields[key],
      localCurrent?.fields[key] ?? null, incomingCurrent.fields[key])]));
    values.progress = mergeValue(common, progress, progress(localCurrent), progress(incomingCurrent));
    return { itemId: incoming.id, title: incomingCurrent.fields.title, kind,
      localHeadSha256: local?.headSha256 || null, incomingHeadSha256: incoming.headSha256,
      commonHeadSha256: common.length === 1 ? common[0].sha256 : null,
      commonHeadSha256s: common.map(event => event.sha256), fields: values,
      conflicts: Object.entries(values).filter(([, value]) => value.conflict).map(([key]) => key),
      localEvidenceIds: [...(localCurrent?.evidenceIds || [])], incomingEvidenceIds: [...incomingCurrent.evidenceIds],
      origin: clone(incoming.origin) };
  });
  return { packageSha256: verified.packageSha256, payloadSha256: verified.payloadSha256,
    incomingWorkspaceId: remote.workspaceId, incomingRevision: remote.revision,
    commonRevision, items };
}
function importItemDependencies(state, remote, incoming) {
  const target = saved(state, true), source = saved(remote), itemEvents = source.events.filter(event => event.itemId === incoming.id);
  const contexts = new Set([incoming.origin.contextId]), evidenceIds = new Set();
  function retainSource(sourceId) {
    const original = remote.sources.find(value => value.id === sourceId);
    need(original, "The return lacks an original source.", "HAYSTACK_RETURN_INCOMPLETE", 409);
    const local = state.sources.find(value => value.id === sourceId);
    if (local) need(local.base64 === original.base64, "The returned original source bytes differ.", "HAYSTACK_RETURN_INCOMPLETE", 409);
    else state.sources.push(clone(original));
  }
  for (const event of itemEvents) {
    event.evidenceIds.forEach(value => evidenceIds.add(value));
    if (event.submission) contexts.add(event.submission.contextId);
    if (event.review) contexts.add(event.review.contextId);
  }
  for (const contextId of contexts) {
    const context = source.contexts.find(value => value.id === contextId);
    need(context, "The return lacks the reviewed material context.", "HAYSTACK_RETURN_INCOMPLETE", 409);
    const retained = target.contexts.find(value => value.id === contextId);
    need(!retained || equal(retained, context), "The returned material context differs.", "HAYSTACK_RETURN_INCOMPLETE", 409);
    if (!retained) target.contexts.push(clone(context));
    for (const sourceId of context.sourceIds) retainSource(sourceId);
  }
  for (const evidenceId of evidenceIds) {
    const evidence = source.evidence.find(value => value.id === evidenceId), retained = target.evidence.find(value => value.id === evidenceId);
    need(evidence && (!retained || equal(retained, evidence)), "The complete returned evidence differs.", "HAYSTACK_RETURN_INCOMPLETE", 409);
    if (evidence.kind === "proposal") for (const change of evidence.proposal.changes) retainSource(splitRecordKey(change.recordKey).sourceId);
    if (!retained) target.evidence.push(clone(evidence));
  }
  const localEvents = index(target.events);
  for (const event of itemEvents) {
    const retained = localEvents.get(event.sha256);
    need(!retained || equal(retained, event), "The original returned event differs.", "HAYSTACK_RETURN_INCOMPLETE", 409);
    if (!retained) { target.events.push(clone(event)); localEvents.set(event.sha256, event); }
  }
}
export function applyReturn(state, args, verified) {
  actor(args); text(args.note, "the original operator's complete return decision", 12000, true);
  const preview = previewReturn(state, verified), work = saved(state, true);
  need(Array.isArray(args.decisions) && args.decisions.length === preview.items.length,
    "Review every returned item with an explicit keep or accept decision.");
  const decisions = new Map();
  for (const decision of args.decisions) {
    fields(decision, ["itemId", "decision", "expectedHeadSha256", "choices"], ["itemId", "decision", "expectedHeadSha256"]);
    id(decision.itemId, "work-item ID");
    need(!decisions.has(decision.itemId) && ["keep", "accept"].includes(decision.decision), "Decide each returned work item once.");
    if (decision.expectedHeadSha256 !== null) hash(decision.expectedHeadSha256);
    fields(decision.choices || {}, [...WORK_FIELDS, "progress"]);
    for (const value of Object.values(decision.choices || {})) need(["local", "incoming"].includes(value), "Resolve each conflict with local or incoming work.");
    decisions.set(decision.itemId, decision);
  }
  const results = [];
  for (const row of preview.items) {
    const decision = decisions.get(row.itemId);
    need(decision && decision.expectedHeadSha256 === row.localHeadSha256,
      "The original work item changed after the return preview.", "HAYSTACK_WORK_STALE", 409, { itemId: row.itemId });
    for (const key of Object.keys(decision.choices || {})) need(row.conflicts.includes(key), "Supply choices only for actual return conflicts.");
    if (decision.decision === "keep") {
      results.push({ itemId: row.itemId, decision: "keep", priorHeadSha256: row.localHeadSha256,
        incomingHeadSha256: row.incomingHeadSha256, headSha256: row.localHeadSha256, choices: {} });
      continue;
    }
    for (const key of row.conflicts) need(decision.choices?.[key], "Resolve the complete " + key + " conflict before accepting this return.",
      "HAYSTACK_RETURN_CONFLICT", 409, { itemId: row.itemId, field: key });
    const incoming = saved(verified.state).items.find(item => item.id === row.itemId);
    importItemDependencies(state, verified.state, incoming);
    let item = work.items.find(value => value.id === row.itemId);
    if (!item) { item = clone(incoming); work.items.push(item); }
    const selected = Object.fromEntries(Object.entries(row.fields).map(([key, value]) => [key,
      clone(value.conflict ? value[decision.choices[key]] : value.suggested)]));
    const mergedFields = Object.fromEntries(WORK_FIELDS.map(key => [key, selected[key]]));
    workFields(mergedFields);
    const event = append(work, item, args, "return", { fields: mergedFields, ...selected.progress,
      evidenceIds: [...new Set([...row.localEvidenceIds, ...row.incomingEvidenceIds])],
      returnedHeadSha256: row.incomingHeadSha256, returnPackageSha256: preview.packageSha256,
      returnDecision: clone(decision) });
    results.push({ itemId: row.itemId, decision: "accept", priorHeadSha256: row.localHeadSha256,
      incomingHeadSha256: row.incomingHeadSha256, headSha256: event.sha256, choices: clone(decision.choices || {}) });
  }
  need(work.items.length <= ITEM_LIMIT && work.events.length <= EVENT_LIMIT, "The returned work exceeds this workspace's complete capacity.", "HAYSTACK_SIZE", 413);
  const receipt = seal({ id: id(args.operationId, "return decision ID"), packageSha256: preview.packageSha256,
    payloadSha256: preview.payloadSha256, incomingWorkspaceId: verified.state.workspaceId,
    incomingRevision: verified.state.revision, incomingStateSha256: verified.state.sha256,
    commonRevision: preview.commonRevision, author: args.author, note: args.note, at: now(),
    application: [...verified.application].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) })),
    decisions: results });
  work.returns.push(receipt);
  return { returnId: receipt.id, packageSha256: receipt.packageSha256,
    accepted: results.filter(value => value.decision === "accept").length,
    kept: results.filter(value => value.decision === "keep").length, decisions: results };
}
export function returnRows(state) { return clone(saved(state).returns); }
export function returnView(state, returnId) {
  id(returnId, "return decision ID"); const receipt = saved(state).returns.find(item => item.id === returnId);
  need(receipt, "This original return decision is unavailable.", "HAYSTACK_RETURN_MISSING", 404);
  return clone(receipt);
}
export function validateCorrectiveState(state, api) {
  if (state.correctiveWork === undefined) return;
  const work = state.correctiveWork;
  fields(work, ["format", "items", "events", "contexts", "evidence", "returns"], ["format", "items", "events", "contexts", "evidence", "returns"]);
  need(work.format === WORK_FORMAT, "Use the complete corrective-work format.", "HAYSTACK_WORK_HISTORY", 409);
  for (const key of ["items", "events", "contexts", "evidence", "returns"])
    need(Array.isArray(work[key]), "The complete work history lacks " + key + ".", "HAYSTACK_WORK_HISTORY", 409);
  need(work.items.length <= ITEM_LIMIT && work.events.length <= EVENT_LIMIT, "The work history exceeds its complete capacity.", "HAYSTACK_SIZE", 413);
  for (const [values, key] of [[work.items, "id"], [work.events, "sha256"], [work.contexts, "id"], [work.evidence, "id"], [work.returns, "id"]])
    need(new Set(values.map(value => value[key])).size === values.length, "The complete work history has duplicate identities.", "HAYSTACK_WORK_HISTORY", 409);
  const items = new Map(work.items.map(item => [item.id, item])), events = index(work.events),
    contexts = new Map(work.contexts.map(value => [value.id, value])), evidence = new Map(work.evidence.map(value => [value.id, value]));
  for (const context of work.contexts) {
    unchangedHash(context, "The reviewed material");
    const body = clone(context); delete body.id; delete body.sha256;
    need(hash(context.id) === digest(body), "The reviewed proposal-version identity differs.", "HAYSTACK_WORK_CONTEXT", 409);
    hash(context.materialSha256); need(Array.isArray(context.proposals), "The material context needs its complete accepted proposals.");
    for (const proposal of context.proposals) unchangedHash(proposal, "The original accepted proposal");
    need(equal(context.approvedProposalIds, context.proposals.map(value => value.id)), "The reviewed material proposal order differs.", "HAYSTACK_WORK_CONTEXT", 409);
    const material = api.materialize({ ...state, proposals: context.proposals },
      { sourceIds: context.sourceIds, approvedProposalIds: context.approvedProposalIds });
    need(material.contentSha256 === context.materialSha256, "The reviewed material loses its exact original native grids.", "HAYSTACK_WORK_CONTEXT", 409);
  }
  for (const record of work.evidence) {
    const body = clone(record); delete body.id;
    unchangedHash(body, "The original evidence");
    need(record.id === record.sha256, "The evidence identity differs.", "HAYSTACK_EVIDENCE", 409);
    text(record.author, "the evidence author", 240, true); text(record.note, "the complete evidence note", 12000);
    need(["file", "proposal", "note"].includes(record.kind), "The evidence kind differs.");
    if (record.kind === "file") {
      const bytes = base64(record.base64, EVIDENCE_MAX_BYTES);
      need(bytes.length === record.bytes && bytes.length > 0 && sha256(bytes) === record.fileSha256,
        "The complete evidence file differs.", "HAYSTACK_EVIDENCE", 409);
    }
    if (record.kind === "proposal") unchangedHash(record.proposal, "The original proposal evidence");
  }
  for (const item of work.items) {
    id(item.id, "work-item ID"); unchangedHash(item.origin, "The original finding");
    const origin = item.origin, context = contexts.get(origin.contextId);
    need(origin.workspaceId === state.workspaceId && context && context.materialSha256 === origin.materialSha256 && context.sourceIds.includes(origin.sourceId),
      "The original finding loses its source context.", "HAYSTACK_WORK_CONTEXT", 409);
    if (origin.recordKey) {
      const key = splitRecordKey(origin.recordKey), source = state.sources.find(value => value.id === key.sourceId);
      need(key.sourceId === origin.sourceId && source && key.rowIndex < source.rows && origin.record?.key === origin.recordKey &&
        digest(origin.record) === origin.recordSha256, "The original finding record differs.", "HAYSTACK_WORK_CONTEXT", 409);
    }
    if (origin.diagnostic) need(digest(origin.diagnostic) === origin.diagnosticSha256, "The captured diagnostic differs.", "HAYSTACK_WORK_DIAGNOSTIC", 409);
    need(events.get(item.headSha256)?.itemId === item.id, "The work item loses its current original history.", "HAYSTACK_WORK_HISTORY", 409);
  }
  for (const event of work.events) {
    unchangedHash(event, "The original work event");
    need(items.has(event.itemId), "The work event has no original item.", "HAYSTACK_WORK_HISTORY", 409);
    id(event.operationId); text(event.author, "the work author", 240, true); text(event.note, "the work note", 12000);
    integer(event.sequence, "work-event sequence", 1); workFields(event.fields);
    need(WORK_STATUSES.includes(event.status) && Array.isArray(event.evidenceIds) &&
      new Set(event.evidenceIds).size === event.evidenceIds.length && event.evidenceIds.every(value => evidence.has(value)),
      "The work event loses its disposition or retained evidence.", "HAYSTACK_WORK_HISTORY", 409);
    const previous = event.previousSha256 === null ? null : events.get(event.previousSha256);
    need(event.previousSha256 === null ? event.sequence === 1 && event.kind === "capture" :
      previous && previous.itemId === event.itemId && previous.sequence + 1 === event.sequence,
      "The original work-event chain differs.", "HAYSTACK_WORK_HISTORY", 409);
    if (event.returnedHeadSha256) {
      need(event.kind === "return" && events.get(event.returnedHeadSha256)?.itemId === event.itemId,
        "The original recipient return branch is incomplete.", "HAYSTACK_WORK_HISTORY", 409);
      hash(event.returnPackageSha256, "the original return package SHA-256");
      need(event.returnDecision?.itemId === event.itemId && event.returnDecision?.decision === "accept",
        "The accepted return loses its explicit original decision.", "HAYSTACK_WORK_HISTORY", 409);
    } else need(event.kind !== "return", "A return needs its original recipient branch.", "HAYSTACK_WORK_HISTORY", 409);
    if (event.submission) {
      unchangedHash(event.submission, "The submitted work");
      const submission = event.submission;
      hash(submission.contextId, "the complete submission context"); hash(submission.materialSha256, "the submitted native material");
      need(contexts.get(submission.contextId)?.materialSha256 === submission.materialSha256 && Array.isArray(submission.evidenceIds) && submission.evidenceIds.length > 0 &&
        submission.evidenceIds.every(value => evidence.has(value)) && events.get(submission.workHeadSha256)?.itemId === event.itemId,
        "The exact submitted work is incomplete.", "HAYSTACK_WORK_SUBMISSION", 409);
    }
    if (event.review) {
      hash(event.review.contextId, "the complete review context"); hash(event.review.materialSha256, "the reviewed native material");
      need(contexts.get(event.review.contextId)?.materialSha256 === event.review.materialSha256, "The review loses its complete source material.", "HAYSTACK_WORK_CONTEXT", 409);
    }
    if (event.status === "submitted") need(event.submission && event.review === null, "Submitted work needs its exact reviewable submission.");
    else if (event.status === "verified") need(event.submission && event.review?.decision === "verify" &&
      event.review.submissionSha256 === event.submission.sha256 && event.review.materialSha256 === event.submission.materialSha256 &&
      ["absent", "manual"].includes(event.review.finding?.state), "Verified work loses its exact completed submission.", "HAYSTACK_WORK_SUBMISSION", 409);
    else if (event.status === "exception") need(event.review?.decision === "accept-exception", "An accepted exception needs its explicit decision.");
    else need(event.submission === null && event.review === null, "Open work must be resubmitted before review.");
  }
  orderedHistory(events, events.keys());
  for (const receipt of work.returns) {
    unchangedHash(receipt, "The original return decision"); id(receipt.id); hash(receipt.packageSha256); hash(receipt.payloadSha256);
    need(receipt.incomingWorkspaceId === state.workspaceId && Array.isArray(receipt.decisions), "The original return decision lost its workspace.", "HAYSTACK_RETURN_WORKSPACE", 409);
    for (const decision of receipt.decisions) if (decision.decision === "accept")
      need(events.get(decision.headSha256)?.itemId === decision.itemId && events.get(decision.incomingHeadSha256)?.itemId === decision.itemId,
        "The accepted recipient work lost its retained branches.", "HAYSTACK_RETURN_INCOMPLETE", 409);
  }
}
