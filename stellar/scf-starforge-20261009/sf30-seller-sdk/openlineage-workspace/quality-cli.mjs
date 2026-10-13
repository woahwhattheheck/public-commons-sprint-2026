import { promises as fs } from "node:fs";
import { resolve } from "node:path";
const commands = {
  overview: "quality.overview", history: "quality.history", evaluate: "quality.evaluate",
  "rule-save": "quality.rule.save", "evaluation-save": "quality.evaluation.save",
  "disposition-save": "quality.disposition.save", report: "quality.report.read"
};
export const QUALITY_HELP = [
  "  scf-lineage quality overview --workspace DIR [--edition ID] [--dataset-key KEY] [--run-key KEY]",
  "  scf-lineage quality history --workspace DIR --dataset-key KEY [--edition ID] [--run-key KEY]",
  "  scf-lineage quality evaluate --workspace DIR [--edition ID] [--dataset-key KEY] [--run-key KEY]",
  "  scf-lineage quality rule-save --workspace DIR --input RULE.json --operation-id ID --revision N",
  "  scf-lineage quality evaluation-save --workspace DIR --title TITLE --operation-id ID --revision N [--edition ID] [--dataset-key KEY] [--run-key KEY] [--selection-hash SHA256] [--rules-hash SHA256]",
  "  scf-lineage quality disposition-save --workspace DIR --input DISPOSITION.json --operation-id ID --revision N",
  "  scf-lineage quality report --workspace DIR --out NEW_FILE [--evaluation-id ID] [--format json|csv|html]",
  "  Every quality action is also available through the original action command, HTTP SDK and MCP catalog."
];
const present = (value, name) => { if (typeof value !== "string" || !value.trim()) throw new Error(name + " is required"); return value; };
function optionsCheck(options, allowed) { for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error("Unknown quality option --" + key); }
function selection(options) {
  return Object.fromEntries([["edition", options.edition], ["datasetKey", options["dataset-key"]], ["runKey", options["run-key"]]].filter(([, value]) => value !== undefined));
}
async function readInput(path) {
  const value = JSON.parse(await fs.readFile(present(path, "--input"), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Quality input must be a JSON object");
  return value;
}
export async function qualityCommand(workspace, positional, options) {
  const command = positional[0], action = commands[command];
  if (!action || positional.length !== 1) throw new Error("Choose quality overview, history, evaluate, rule-save, evaluation-save, disposition-save or report");
  const shared = ["workspace"], filters = ["edition", "dataset-key", "run-key"], mutations = ["operation-id", "revision"];
  let args;
  if (["overview", "history", "evaluate"].includes(command)) {
    optionsCheck(options, [...shared, ...filters]); args = selection(options);
    if (command === "history") present(args.datasetKey, "--dataset-key");
  } else if (command === "report") {
    optionsCheck(options, [...shared, ...filters, "evaluation-id", "format", "out"]);
    args = { ...selection(options), format: options.format ?? "json", ...(options["evaluation-id"] === undefined ? {} : { evaluationId: options["evaluation-id"] }) };
    present(options.out, "--out");
  } else {
    optionsCheck(options, [...shared, ...mutations, ...(command === "evaluation-save" ? [...filters, "title", "selection-hash", "rules-hash"] : ["input"])]);
    const expectedRevision = Number(present(options.revision, "--revision"));
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("--revision must be a nonnegative integer");
    args = command === "rule-save" ? { rule: await readInput(options.input) } :
      command === "disposition-save" ? await readInput(options.input) :
      { ...selection(options), title: present(options.title, "--title"),
        ...(options["selection-hash"] === undefined ? {} : { expectedSelectionHash: options["selection-hash"] }),
        ...(options["rules-hash"] === undefined ? {} : { expectedRulesHash: options["rules-hash"] }) };
    if (command === "disposition-save") for (const key of Object.keys(args))
      if (!["evaluationId", "findingId", "decision", "reason"].includes(key)) throw new Error("Unknown disposition field " + key);
    args = { ...args, operationId: present(options["operation-id"], "--operation-id"), expectedRevision };
  }
  const result = await workspace.dispatch(action, args);
  if (command === "report") {
    const out = resolve(options.out);
    await fs.writeFile(out, result.text, { flag: "wx", mode: 0o600 });
    return { out, workspaceId: result.workspaceId, revision: result.revision, evaluationId: result.evaluationId, mediaType: result.mediaType };
  }
  return result;
}
