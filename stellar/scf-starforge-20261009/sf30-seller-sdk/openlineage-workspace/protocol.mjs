import { createInterface } from "node:readline";
import { tools } from "./catalog.mjs";
export { tools } from "./catalog.mjs";

function checkArguments(tool, args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new Error("Tool arguments must be an object");
  for (const required of tool.inputSchema.required) if (args[required] === undefined) throw new Error("Missing " + required);
  for (const key of Object.keys(args)) if (!(key in tool.inputSchema.properties)) throw new Error("Unknown argument " + key);
  if (tool.action === "source.import" && (typeof args.text === "string") === (typeof args.base64 === "string")) throw new Error("Provide exactly one of text or base64");
}
export async function handleRpc(workspace, request) {
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return { jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request" } };
  if (request.id === undefined) return null;
  const response = result => ({ jsonrpc: "2.0", id: request.id, result });
  try {
    if (request.method === "initialize") return response({ protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "tjlabs-openlineage-workspace", version: "0.1.0" } });
    if (request.method === "ping") return response({});
    if (request.method === "tools/list") return response({ tools: tools.map(({ action, ...tool }) => tool) });
    if (request.method === "tools/call") {
      const tool = tools.find(item => item.name === request.params?.name);
      if (!tool) return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Unknown tool" } };
      try {
        const args = request.params?.arguments ?? {};
        checkArguments(tool, args);
        const result = await workspace.dispatch(tool.action, args);
        return response({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (error) {
        return response({ content: [{ type: "text", text: error.message }], isError: true, structuredContent: { error: error.message, status: error.status ?? 400, ...(error.details ? { details: error.details } : {}) } });
      }
    }
    return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } };
  } catch (error) { return { jsonrpc: "2.0", id: request.id, error: { code: -32603, message: error.message } }; }
}
export async function serveStdio(workspace, { input = process.stdin, output = process.stdout } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let result;
    try { result = await handleRpc(workspace, JSON.parse(line)); }
    catch { result = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }; }
    if (result) await new Promise((resolve, reject) => output.write(JSON.stringify(result) + "\n", error => error ? reject(error) : resolve()));
  }
}
