import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
import { operations, optional, wherobotsToolDefinitions } from "./tools.mjs";
export { wherobotsToolDefinitions } from "./tools.mjs";

export function createWherobotsWorkspace({ directory, workspaceId, python = process.env.WHEROBOTS_PYTHON || "python3", env = process.env } = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new TypeError("Select the original absolute private workspace directory.");
  if (typeof python !== "string" || !python) throw new TypeError("Select the installed Python runtime.");
  if (workspaceId !== undefined && (typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 240)) throw new TypeError("Pin the original workspace identity.");
  const pending = new Set();
  let closing = false, closed;
  async function execute(operation, args = {}) {
    if (closing) throw Object.assign(new Error("The Wherobots client is closing."), {code:"WHEROBOTS_CLOSING"});
    if (!Object.hasOwn(operations, operation) || !args || typeof args !== "object" || Array.isArray(args)) throw new TypeError("Choose a documented Wherobots operation.");
    const allowed = new Set([...operations[operation], ...(optional[operation] || [])]);
    if (Object.keys(args).some((key) => !allowed.has(key)) || operations[operation].some((key) => !(key in args))) throw new TypeError("The operation has missing or unknown arguments.");
    const request = JSON.stringify({operation, arguments: args, ...(workspaceId ? {workspace_id: workspaceId} : {})});
    if (Buffer.byteLength(request) > 2 * 1024 * 1024) throw new RangeError("Use a JSON operation within 2 MiB.");
    return await new Promise((resolve, reject) => {
      const child = spawn(python, [path.join(sourceDirectory, "operate.py"), "--workspace", directory, "rpc"],
        {env, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true});
      const lifetime = new Promise((done) => child.once("close", done));
      pending.add(lifetime); lifetime.then(() => pending.delete(lifetime));
      let stdout = [], bytes = 0, settled = false;
      const fail = (error) => { if (!settled) { settled = true; reject(error); } };
      child.on("error", fail);
      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024 * 1024) {
          child.kill("SIGTERM");
          fail(new Error("The local response exceeded 64 MiB. Reopen the original saved operation and page its data."));
        } else stdout.push(chunk);
      });
      child.stderr.resume();
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
    directory, workspaceId,
    get summary() { return {active_processes: pending.size, closing}; },
    close: () => { closing = true; return closed ??= Promise.allSettled([...pending]).then(() => undefined); },
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
