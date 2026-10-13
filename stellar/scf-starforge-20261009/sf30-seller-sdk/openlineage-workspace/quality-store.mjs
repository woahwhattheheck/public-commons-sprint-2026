import { randomUUID } from "node:crypto";
import { clone, digest } from "./model.mjs";
import { QUALITY_FORMAT, QualityError, qualityState, qualityOverview, qualityHistory, normalizeRule, evaluateQuality } from "./quality.mjs";
import { qualityReport } from "./quality-reports.mjs";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const text = (value, name) => {
  if (typeof value !== "string" || !value.trim()) throw new QualityError(name + " is required");
  return value;
};
const optionalHash = (value, name) => {
  if (value !== undefined && (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) throw new QualityError(name + " must be a SHA-256 value");
};
function selection(args) {
  return { edition: args.edition ?? null, datasetKey: args.datasetKey ?? null, runKey: args.runKey ?? null };
}
function mutable(state) {
  state.quality ??= { schema: QUALITY_FORMAT, rules: [], evaluations: [], dispositions: [] };
  return state.quality;
}
function snapshot(rule) { const { history, ...row } = rule; return clone(row); }
function assertPreview(evaluation, args) {
  optionalHash(args.expectedSelectionHash, "expectedSelectionHash");
  optionalHash(args.expectedRulesHash, "expectedRulesHash");
  if (args.expectedSelectionHash !== undefined && args.expectedSelectionHash !== evaluation.selectionSha256)
    throw new QualityError("The selected original events differ from the reviewed preview. Refresh and review before saving.", 409);
  if (args.expectedRulesHash !== undefined && args.expectedRulesHash !== evaluation.ruleSetSha256)
    throw new QualityError("The quality rules differ from the reviewed preview. Refresh and review before saving.", 409);
}
export async function dispatchQuality(workspace, action, args = {}) {
  if (action === "quality.overview") return qualityOverview(await workspace.read(), selection(args));
  if (action === "quality.history") {
    text(args.datasetKey, "datasetKey");
    return qualityHistory(await workspace.read(), selection(args));
  }
  if (action === "quality.evaluate") return evaluateQuality(await workspace.read(), selection(args));
  if (action === "quality.report.read") {
    const state = await workspace.read();
    let evaluation;
    if (args.evaluationId !== undefined && args.evaluationId !== null) {
      text(args.evaluationId, "evaluationId");
      if (["edition", "datasetKey", "runKey"].some(key => args[key] !== undefined && args[key] !== null))
        throw new QualityError("Choose a saved evaluation or a current selection for the report");
      evaluation = qualityState(state).evaluations.find(row => row.id === args.evaluationId);
      if (!evaluation) throw new QualityError("Unknown saved quality evaluation", 404);
    } else evaluation = evaluateQuality(state, selection(args));
    return { ...qualityReport(evaluation, qualityState(state).dispositions, args.format ?? "json"),
      workspaceId: state.workspaceId, revision: state.revision, evaluationId: evaluation.id };
  }
  if (action === "quality.rule.save") {
    const body = normalizeRule(args.rule);
    if (own(args.rule, "id")) text(args.rule.id, "rule.id");
    return workspace.change(args.operationId, { action, rule: clone(args.rule) }, args.expectedRevision, state => {
      const quality = mutable(state), now = new Date().toISOString();
      let rule;
      if (args.rule.id) {
        const index = quality.rules.findIndex(row => row.id === args.rule.id);
        if (index < 0) throw new QualityError("Unknown quality rule", 404);
        const existing = quality.rules[index];
        if (own(args.rule, "version") && args.rule.version !== existing.version)
          throw new QualityError("The rule has a newer saved version. Refresh and review before saving.", 409);
        rule = { ...body, id: existing.id, version: existing.version + 1, createdAt: existing.createdAt, updatedAt: now,
          history: [...existing.history, snapshot(existing)] };
        quality.rules[index] = rule;
      } else {
        rule = { ...body, id: randomUUID(), version: 1, createdAt: now, updatedAt: now, history: [] };
        quality.rules.push(rule);
      }
      return { rule: clone(rule) };
    });
  }
  if (action === "quality.evaluation.save") {
    text(args.title, "Evaluation title");
    optionalHash(args.expectedSelectionHash, "expectedSelectionHash");
    optionalHash(args.expectedRulesHash, "expectedRulesHash");
    const options = selection(args);
    const input = { action, title: args.title, ...options,
      ...(args.expectedSelectionHash === undefined ? {} : { expectedSelectionHash: args.expectedSelectionHash }),
      ...(args.expectedRulesHash === undefined ? {} : { expectedRulesHash: args.expectedRulesHash }) };
    return workspace.change(args.operationId, input, args.expectedRevision, state => {
      const preview = evaluateQuality(state, options);
      assertPreview(preview, args);
      const body = { ...preview, id: randomUUID(), title: args.title };
      const evaluation = { ...body, contentSha256: digest(body) };
      mutable(state).evaluations.push(evaluation);
      return { evaluation: clone(evaluation) };
    });
  }
  if (action === "quality.disposition.save") {
    text(args.evaluationId, "evaluationId"); text(args.findingId, "findingId"); text(args.reason, "Disposition reason");
    if (!["open", "investigating", "accepted", "resolved"].includes(args.decision)) throw new QualityError("Choose a supported disposition");
    const input = { action, evaluationId: args.evaluationId, findingId: args.findingId, decision: args.decision, reason: args.reason };
    return workspace.change(args.operationId, input, args.expectedRevision, state => {
      const quality = mutable(state), evaluation = quality.evaluations.find(row => row.id === args.evaluationId);
      if (!evaluation) throw new QualityError("Unknown saved quality evaluation", 404);
      if (!evaluation.findings.some(row => row.id === args.findingId)) throw new QualityError("Unknown finding in this saved evaluation", 404);
      const existing = quality.dispositions.find(row => row.evaluationId === args.evaluationId && row.findingId === args.findingId);
      const now = new Date().toISOString();
      const disposition = { id: existing?.id ?? randomUUID(), evaluationId: args.evaluationId, findingId: args.findingId,
        decision: args.decision, reason: args.reason, version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now, updatedAt: now, revision: state.revision,
        history: existing ? [...existing.history, snapshot(existing)] : [] };
      if (existing) quality.dispositions[quality.dispositions.indexOf(existing)] = disposition;
      else quality.dispositions.push(disposition);
      return { disposition: clone(disposition) };
    });
  }
  throw new QualityError("Unknown quality action", 404);
}
