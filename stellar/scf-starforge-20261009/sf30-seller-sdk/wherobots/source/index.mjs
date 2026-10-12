import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const operations = {
  state: [],
  runtime: [],
  logs: ["operation_id"],
  get: ["kind", "id"],
  list: ["kind"],
  events: ["kind", "id"],
  import_source: ["path"],
  save_workflow: ["definition"],
  adopt: ["input", "files", "account"],
  review: ["workflow_id", "operation_id", "expected_revision"],
  submit: ["operation_id"],
  recover: ["operation_id"],
  refresh: ["operation_id"],
  cancel: ["operation_id"],
  capture: ["operation_id"],
  compare: ["left_id", "right_id"],
  rows: ["edition_id", "dataset_id"],
  export: ["workflow_id", "destination"],
  export_dataset: ["edition_id", "dataset_id", "destination"],
  import: ["source"],
};
const properties = {
  kind: {type: "string", enum: ["workflow", "operation", "capture", "edition", "receiving", "task"]},
  id: {type: "string"}, path: {type: "string"}, filename: {type: "string"},
  script: {type: "boolean"}, definition: {type: "object"},
  expected_revision: {type: ["string", "null"]}, actor: {type: "string"},
  input: {type: "string"}, files: {type: "object"}, account: {type: "object"},
  workflow_id: {type: "string"}, operation_id: {type: "string"},
  mode: {type: "string", enum: ["submit", "attach"]}, native_run_id: {type: "string"},
  include_logs: {type: "boolean"}, left_id: {type: "string"}, right_id: {type: "string"},
  edition_id: {type: "string"}, dataset_id: {type: "string"},
  offset: {type: "integer", minimum: 0}, limit: {type: "integer", minimum: 1, maximum: 1000},
  capture: {type: "integer", minimum: 0},
  after: {type: "integer", minimum: 0}, destination: {type: "string"}, source: {type: "string"},
};
const optional = {
  events: ["after", "limit"], import_source: ["filename", "script"],
  save_workflow: ["expected_revision", "actor"], adopt: ["expected_revision", "actor"],
  review: ["actor", "mode"], recover: ["native_run_id"], refresh: ["include_logs"],
  rows: ["offset", "limit"], logs: ["capture", "offset", "limit"],
};
const descriptions = {
  state: "Open the original Wherobots workspace and its saved workflows, native runs and editions.",
  runtime: "Read the selected SDK, output engines and original account target without exposing connection secrets.",
  logs: "Page every entry from a selected original native log capture.",
  get: "Read one exact retained workspace record.",
  list: "Read the complete retained record collection for one kind.",
  events: "Continue the original operation's receiving progress cursor.",
  import_source: "Retain a complete local source file with its content identity.",
  save_workflow: "Save the original job, account selection, source and output definition using its saved revision.",
  adopt: "Adopt the unchanged customer workflow JSON and every named original source file.",
  review: "Retain one exact reviewed operation before native submission or attachment.",
  submit: "Submit the reviewed source through the original Wherobots SDK and retain its native run ID.",
  recover: "Reconcile the original submission or attach the reviewed source to an existing native run.",
  refresh: "Read the original native status, metrics, cost and optional complete logs.",
  cancel: "Request cancellation of the exact original native run.",
  capture: "Resume the complete native output inventory and receive every original output part.",
  compare: "Compare every record, schema and geometry in two complete output editions.",
  rows: "Page exact typed values from a complete original output edition.",
  export: "Package complete original source, operations, native records, objects and editable operator code.",
  export_dataset: "Export the received dataset and complete source binding for the original SF30 dataset merchant.",
  import: "Independently reopen a complete original or corrected handover.",
};

export const wherobotsToolDefinitions = Object.entries(operations).map(([operation, required]) => ({
  name: "wherobots_" + operation,
  description: descriptions[operation],
  inputSchema: {
    type: "object",
    properties: Object.fromEntries([...required, ...(optional[operation] || [])].map((name) => [name, properties[name]])),
    required,
    additionalProperties: false,
  },
}));

export function createWherobotsWorkspace({ directory, python = process.env.WHEROBOTS_PYTHON || "python3", env = process.env } = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new TypeError("Select the original absolute private workspace directory.");
  if (typeof python !== "string" || !python) throw new TypeError("Select the installed Python runtime.");
  async function execute(operation, args = {}) {
    if (!Object.hasOwn(operations, operation) || !args || typeof args !== "object" || Array.isArray(args)) throw new TypeError("Choose a documented Wherobots operation.");
    const allowed = new Set([...operations[operation], ...(optional[operation] || [])]);
    if (Object.keys(args).some((key) => !allowed.has(key)) || operations[operation].some((key) => !(key in args))) throw new TypeError("The operation has missing or unknown arguments.");
    const request = JSON.stringify({operation, arguments: args});
    if (Buffer.byteLength(request) > 2 * 1024 * 1024) throw new RangeError("Use a JSON operation within 2 MiB.");
    return await new Promise((resolve, reject) => {
      const child = spawn(python, [path.join(sourceDirectory, "operate.py"), "--workspace", directory, "rpc"],
        {env, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true});
      let stdout = [], bytes = 0, stderr = "", settled = false;
      const fail = (error) => { if (!settled) { settled = true; reject(error); } };
      child.on("error", fail);
      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024 * 1024) {
          child.kill("SIGTERM");
          fail(new Error("The local response exceeded 64 MiB. Reopen the original saved operation and page its data."));
        } else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
      child.stdin.on("error", (error) => { if (error.code !== "EPIPE") fail(error); });
      child.on("close", (code, signal) => {
        if (settled) return;
        let result;
        try { result = JSON.parse(Buffer.concat(stdout).toString("utf8")); }
        catch {
          const error = new Error("The original local operation ended without a complete JSON reply. Reopen its retained operation ID.");
          error.code = "WHEROBOTS_LOCAL_REPLY"; error.exitCode = code; error.signal = signal;
          fail(error); return;
        }
        if (code !== 0 || result?.error) {
          const error = new Error(result.message || "The original Wherobots operation failed.");
          error.code = result.error || result.code || "WHEROBOTS_OPERATION";
          error.details = result.details; error.operation = operation;
          fail(error); return;
        }
        settled = true; resolve(result);
      });
      child.stdin.end(request);
    });
  }
  return Object.freeze({
    directory,
    execute,
    tools: () => structuredClone(wherobotsToolDefinitions),
    callTool: async (name, args) => {
      if (!name.startsWith("wherobots_")) throw new TypeError("Choose a Wherobots workspace tool.");
      const value = await execute(name.slice("wherobots_".length), args);
      return {content: [{type: "text", text: JSON.stringify(value)}], structuredContent: value, isError: false};
    },
    ...Object.fromEntries(Object.keys(operations).map((name) => [name, (args) => execute(name, args)])),
  });
}
