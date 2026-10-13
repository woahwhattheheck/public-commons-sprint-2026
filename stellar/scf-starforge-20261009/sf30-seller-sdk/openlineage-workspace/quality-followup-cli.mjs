import { promises as fs } from "node:fs";
import { resolve } from "node:path";
export const QUALITY_FOLLOWUP_HELP = [
  "  scf-lineage quality-followup overview --workspace DIR",
  "  scf-lineage quality-followup compare --workspace DIR --input SELECTION.json",
  "  scf-lineage quality-followup comparison-save --workspace DIR --input REVIEWED.json --operation-id ID --revision N",
  "  scf-lineage quality-followup save --workspace DIR --input FOLLOWUP.json --operation-id ID --revision N",
  "  scf-lineage quality-followup report --workspace DIR --comparison-id ID --format json|csv|html --out NEW_FILE",
  "  REVIEWED.json contains title, original evaluation IDs, correspondence choices and expectedComparisonHash from compare."
];
const actions = {overview: "quality.followup.overview", compare: "quality.followup.compare",
  "comparison-save": "quality.followup.comparison.save", save: "quality.followup.save", report: "quality.followup.report.read"};
const text = (value, name) => { if (typeof value !== "string" || !value.trim()) throw new Error(name + " is required"); return value; };
export async function qualityFollowupCommand(workspace, positional, options) {
  const command = positional[0], action = actions[command];
  if (!action || positional.length !== 1) throw new Error("Choose quality-followup overview, compare, comparison-save, save or report");
  const write = ["comparison-save", "save"].includes(command);
  const allowed = ["workspace", ...(command === "report" ? ["comparison-id", "format", "out"] :
    command === "overview" ? [] : ["input"]), ...(write ? ["operation-id", "revision"] : [])];
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error("Unknown quality-followup option --" + key);
  let args = {};
  if (!["overview", "report"].includes(command)) {
    args = JSON.parse(await fs.readFile(text(options.input, "--input"), "utf8"));
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Input must contain one complete JSON object");
    if ("operationId" in args || "expectedRevision" in args) throw new Error("Supply --operation-id and --revision separately from the input file");
  }
  if (write) {
    const expectedRevision = Number(text(options.revision, "--revision"));
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("--revision must be a nonnegative integer");
    args = {...args, expectedRevision, operationId: text(options["operation-id"], "--operation-id")};
  }
  if (command === "report") args = {comparisonId: text(options["comparison-id"], "--comparison-id"), format: options.format ?? "json"};
  if (command === "report") text(options.out, "--out");
  const result = await workspace.dispatch(action, args);
  if (command !== "report") return result;
  const out = resolve(options.out);
  await fs.writeFile(out, result.text, {flag: "wx", mode: 0o600});
  return {out, workspaceId: result.workspaceId, revision: result.revision, comparisonId: result.comparisonId, mediaType: result.mediaType};
}
