#!/usr/bin/env node
// MIT. Complete service-level operation through the existing workspace or HTTP owner.
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LineageWorkspace } from "./store.mjs";
import { ServiceLevelClient } from "./service-levels-client.mjs";

const HELP = [
  "OpenLineage pipeline service levels",
  "",
  "  openlineage service-levels status --workspace DIR",
  "  openlineage service-levels policy --workspace DIR --input POLICY.json --reason TEXT --operation-id ID [--revision N]",
  "  openlineage service-levels evaluate --workspace DIR --at RFC3339 [--edition ID]",
  "  openlineage service-levels record --workspace DIR --at RFC3339 --operation-id ID [--revision N] [--edition ID] [--historical]",
  "  openlineage service-levels incident --workspace DIR --id ID --decision acknowledge|assign|resolve|accept|reopen --reason TEXT --operation-id ID [--owner NAME] [--revision N]",
  "  openlineage service-levels report --workspace DIR --format json|csv|html --out NEW_FILE [--assessment ID]",
  "",
  "Replace --workspace DIR with --url URL [--token-file FILE] for the same HTTP service.",
  "Use --expected-workspace-id ID and --instance-id ID to bind a reviewed URL connection.",
  "The selected original workspace remains the only writer. Record an explicit evaluation",
  "time and preserve the same operation ID and input after an uncertain response.",
  "--historical saves the assessment without changing current incidents.",
  "See SERVICE_LEVELS.md for policy semantics and complete customer receiving."
].join("\n");
function parse(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error("Unexpected argument " + key);
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) throw new Error("Repeated option " + key);
    if (name === "historical") { options[name] = true; continue; }
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error("Missing value for " + key);
    options[name] = argv[++i];
  }
  return options;
}
function required(value, name) { if (!value) throw new Error(name + " is required"); return value; }
function permitted(options, names) {
  const allowed = new Set(["workspace", "url", "token-file", "expected-workspace-id", "instance-id", ...names]);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new Error("Unknown option --" + key);
}
async function destination(options) {
  if (Boolean(options.workspace) === Boolean(options.url)) throw new Error("Choose exactly one of --workspace and --url");
  if (options.workspace) {
    if (options["token-file"] || options["instance-id"]) throw new Error("--token-file and --instance-id apply to a URL connection");
    const workspace = new LineageWorkspace(options.workspace);
    if (options["expected-workspace-id"] && (await workspace.metadata()).workspaceId !== options["expected-workspace-id"])
      throw Object.assign(new Error("Selected workspace identity differs from the reviewed workspace"), { status: 409 });
    return { dispatch: (action, args) => workspace.dispatch(action, args), metadata: () => workspace.metadata() };
  }
  const token = options["token-file"] ? (await fs.readFile(options["token-file"], "utf8")).trim() : null;
  const client = new ServiceLevelClient(options.url, { token, expectedWorkspaceId: options["expected-workspace-id"] ?? null, instanceId: options["instance-id"] ?? null });
  const identity = await client.requestJSON("/api/identity");
  if (identity?.schema !== "commons.openlineage.startup.v1" || typeof identity.workspaceId !== "string" || typeof identity.instanceId !== "string")
    throw new Error("The endpoint did not return an original OpenLineage workspace identity");
  if ((options["expected-workspace-id"] && identity.workspaceId !== options["expected-workspace-id"]) ||
      (options["instance-id"] && identity.instanceId !== options["instance-id"]))
    throw Object.assign(new Error("The HTTP workspace differs from the reviewed connection"), { status: 409 });
  client.expectedWorkspaceId = identity.workspaceId; client.instanceId = identity.instanceId;
  return { dispatch: (action, args) => client.action(action, args), metadata: () => client.metadata() };
}
async function mutation(options, target) {
  const expectedRevision = options.revision === undefined ? (await target.metadata()).revision : Number(options.revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("--revision must be a non-negative integer");
  return { operationId: required(options["operation-id"], "--operation-id"), expectedRevision };
}
export async function serviceLevelMain(argv = process.argv.slice(2)) {
  const [command, ...remaining] = argv;
  if (!command || ["help", "--help", "-h"].includes(command)) { console.log(HELP); return 0; }
  const options = parse(remaining);
  const names = {
    status: [], policy: ["input", "reason", "operation-id", "revision"],
    evaluate: ["at", "edition"], record: ["at", "edition", "historical", "operation-id", "revision"],
    incident: ["id", "decision", "reason", "owner", "operation-id", "revision"],
    report: ["format", "out", "assessment"]
  }[command];
  if (!names) throw new Error("Unknown service-level command; use --help");
  permitted(options, names);
  const target = await destination(options);
  let result;
  if (command === "status") result = await target.dispatch("service-levels.read", {});
  if (command === "policy") {
    const policy = JSON.parse(await fs.readFile(required(options.input, "--input"), "utf8"));
    result = await target.dispatch("service-levels.policy.save", { ...await mutation(options, target), policy, reason: required(options.reason, "--reason") });
  }
  if (command === "evaluate") result = await target.dispatch("service-levels.evaluate", { asOf: required(options.at, "--at"), editionId: options.edition ?? null });
  if (command === "record") result = await target.dispatch("service-levels.assessment.save", {
    ...await mutation(options, target), asOf: required(options.at, "--at"), editionId: options.edition ?? null, applyToIncidents: !options.historical
  });
  if (command === "incident") result = await target.dispatch("service-levels.incident.review", {
    ...await mutation(options, target), id: required(options.id, "--id"), decision: required(options.decision, "--decision"),
    reason: required(options.reason, "--reason"), ...(options.owner === undefined ? {} : { owner: options.owner })
  });
  if (command === "report") {
    const format = required(options.format, "--format");
    result = await target.dispatch("service-levels.report", { format, assessmentId: options.assessment ?? null });
    const path = resolve(required(options.out, "--out"));
    await fs.writeFile(path, result.text, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ path, mediaType: result.mediaType, bytes: Buffer.byteLength(result.text) }, null, 2));
    return 0;
  }
  console.log(JSON.stringify(result, null, 2)); return 0;
}
if (process.argv[1] && await fs.realpath(resolve(process.argv[1])).then(path => path === fileURLToPath(import.meta.url), () => false))
  serviceLevelMain().then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ error: error.message, status: error.status ?? 1, ...(error.details ? { details: error.details } : {}) }));
    process.exitCode = 1;
  });
