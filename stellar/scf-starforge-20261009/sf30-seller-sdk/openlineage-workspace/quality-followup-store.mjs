// MIT. Follow-up writes use the original workspace journal and exact replay.
import { randomUUID } from "node:crypto";
import { clone, digest } from "./model.mjs";
import { QualityError } from "./quality.mjs";
import { FOLLOWUP_SCHEMA, compareQualityEvaluations, qualityFollowupState,
  qualityFollowupOverview, normalizeQualityFollowup } from "./quality-followup.mjs";
import { qualityFollowupReport } from "./quality-followup-reports.mjs";

const text = (value, name) => {
  if (typeof value !== "string" || !value.trim()) throw new QualityError(name + " is required");
  return value;
};
function mutable(state) {
  return state.qualityFollowup ??= { schema: FOLLOWUP_SCHEMA, comparisons: [], followups: [] };
}
function selection(args) {
  return { beforeEvaluationId: text(args.beforeEvaluationId, "Earlier evaluation"),
    afterEvaluationId: text(args.afterEvaluationId, "Later evaluation"),
    runPairs: clone(args.runPairs ?? []), findingPairs: clone(args.findingPairs ?? []) };
}
function exactHash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new QualityError("Retain the exact reviewed comparison SHA-256");
  return value;
}
export async function dispatchQualityFollowup(workspace, action, args = {}) {
  if (action === "quality.followup.overview") return qualityFollowupOverview(await workspace.read());
  if (action === "quality.followup.compare") return compareQualityEvaluations(await workspace.read(), selection(args));
  if (action === "quality.followup.report.read") {
    const state = await workspace.read();
    const comparison = qualityFollowupState(state).comparisons.find(row => row.id === text(args.comparisonId, "Comparison ID"));
    if (!comparison) throw new QualityError("Unknown saved comparison", 404);
    return { ...qualityFollowupReport(state, comparison, args.format ?? "json"),
      workspaceId: state.workspaceId, revision: state.revision, comparisonId: comparison.id };
  }
  if (action === "quality.followup.comparison.save") {
    const title = text(args.title, "Comparison title"), selected = selection(args);
    const expectedComparisonHash = exactHash(args.expectedComparisonHash);
    return workspace.change(args.operationId, { action, title, ...selected, expectedComparisonHash }, args.expectedRevision, state => {
      const preview = compareQualityEvaluations(state, selected);
      if (preview.comparisonSha256 !== expectedComparisonHash)
        throw new QualityError("The original comparison changed. Read and review the current preview before saving.", 409);
      const body = { ...preview, id: randomUUID(), title, createdAt: new Date().toISOString() };
      const comparison = { ...body, contentSha256: digest(body) };
      mutable(state).comparisons.push(comparison);
      return { comparison: clone(comparison) };
    });
  }
  if (action === "quality.followup.save") {
    const input = { action, comparisonId: text(args.comparisonId, "Comparison ID"),
      rowId: text(args.rowId, "Compared finding"), decision: text(args.decision, "Follow-up decision"),
      reason: text(args.reason, "Follow-up reason"), owner: args.owner ?? "", dueDate: args.dueDate ?? null,
      evidenceResultIds: clone(args.evidenceResultIds ?? []), sourceDisposition: clone(args.sourceDisposition ?? null),
      ...(args.id === undefined ? {} : { id: text(args.id, "Follow-up identity"), version: args.version }) };
    if (args.id !== undefined && (!Number.isSafeInteger(args.version) || args.version < 1))
      throw new QualityError("Retain the exact opened follow-up version");
    return workspace.change(args.operationId, input, args.expectedRevision, state => {
      const data = mutable(state), normalized = normalizeQualityFollowup(state, input);
      const existing = input.id === undefined ? null : data.followups.find(row => row.id === input.id);
      if (input.id !== undefined && !existing) throw new QualityError("Unknown follow-up", 404);
      if (existing && (existing.version !== input.version || existing.comparisonId !== normalized.comparisonId || existing.rowId !== normalized.rowId))
        throw new QualityError("The current follow-up version or original finding differs. Review the saved record first.", 409);
      if (!existing && data.followups.some(row => row.comparisonId === normalized.comparisonId && row.rowId === normalized.rowId))
        throw new QualityError("This compared finding already has a follow-up. Open its current version before updating.", 409);
      const now = new Date().toISOString();
      const body = { ...normalized, id: existing?.id ?? randomUUID(), workspaceId: state.workspaceId,
        version: (existing?.version ?? 0) + 1, revision: state.revision + 1,
        createdAt: existing?.createdAt ?? now, updatedAt: now };
      const snapshot = { ...body, contentSha256: digest(body) };
      const followup = { ...snapshot, history: existing ? [...existing.history,
        (({ history, ...version }) => clone(version))(existing)] : [] };
      if (existing) data.followups[data.followups.indexOf(existing)] = followup;
      else data.followups.push(followup);
      return { followup: clone(followup) };
    });
  }
  throw new QualityError("Unknown quality follow-up action", 404);
}
