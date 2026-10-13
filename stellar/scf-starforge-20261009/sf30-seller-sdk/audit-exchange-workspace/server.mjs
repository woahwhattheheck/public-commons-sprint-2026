import { spawnAudit } from "./native.mjs";
export { AuditExchangeClient } from "./client.mjs";
export function startAuditServer({directory,workspaceId,port=8769,stdio="inherit"}={}) {
  if (!directory || !Number.isSafeInteger(port) || port<0 || port>65535) throw new Error("Select an original directory and local port.");
  return spawnAudit(["serve","--directory",directory,"--host","127.0.0.1","--port",String(port),
    ...(workspaceId?["--workspace-id",workspaceId]:[])],{stdio});
}
