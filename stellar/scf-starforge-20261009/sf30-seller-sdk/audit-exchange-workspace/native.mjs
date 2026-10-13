import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
const ROOT = dirname(fileURLToPath(import.meta.url));
export const AUDIT_PYTHON = process.env.AUDIT_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || "python3";
export function spawnAudit(args, options = {}) {
  return spawn(AUDIT_PYTHON, ["-u", join(ROOT, "application.py"), ...args], {
    cwd: ROOT, env: process.env, stdio: ["pipe","pipe","pipe"], ...options, shell: false
  });
}
export async function nativeCommand(args, input) {
  const child = spawnAudit(args), output = [], errors = [];
  let bytes = 0, errorBytes = 0;
  child.stdout.on("data", part => { bytes += part.length; output.push(part); });
  child.stderr.on("data", part => { errorBytes += part.length; if (errorBytes <= 262144) errors.push(part); });
  const status = new Promise((resolveStatus, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveStatus({code,signal}));
  });
  child.stdin.on("error", error => { if (error.code !== "EPIPE") child.emit("error", error); });
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  const exit = await status, body = Buffer.concat(output).toString("utf8");
  let value;
  try { value = JSON.parse(body); }
  catch (cause) {
    throw Object.assign(new Error("The original native command returned no complete JSON outcome.", {cause}),
      {code:"AUDIT_NATIVE_OUTCOME", outcomeUnknown: input?.requestId !== undefined, exit, stderr:Buffer.concat(errors).toString("utf8")});
  }
  if (exit.code !== 0 || value.ok !== true)
    throw Object.assign(new Error(value.error?.message || "The original native command failed."),
      {code:value.error?.code || "AUDIT_NATIVE_ERROR", details:value.error?.details, stateVersion:value.stateVersion, exit});
  return value;
}
export async function readAuditState(directory, workspaceId) {
  return (await nativeCommand(["state","--directory",resolve(directory),...(workspaceId?["--workspace-id",workspaceId]:[])])).result;
}
export async function nativeAction(directory, envelope, workspaceId) {
  return nativeCommand(["action","--directory",resolve(directory),"--request-json","-",...(workspaceId?["--workspace-id",workspaceId]:[])],envelope);
}
