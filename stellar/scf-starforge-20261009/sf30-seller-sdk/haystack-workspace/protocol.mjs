import { stringifyJson } from "./json-codec.mjs";
import { createInterface } from "node:readline";
import { tools } from "./catalog.mjs";
export { tools } from "./catalog.mjs";
export async function handleRpc(workspace, request) {
  const requestId = request?.id ?? null;
  const error = (code, message) => ({ jsonrpc: "2.0", id: requestId, error: { code, message } });
  if (!request || Array.isArray(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") return error(-32600, "Invalid JSON-RPC request");
  if (request.id === undefined) return null;
  if (!["string", "number"].includes(typeof request.id) && request.id !== null) return error(-32600, "Invalid JSON-RPC request identity");
  const reply = result => ({ jsonrpc: "2.0", id: request.id, result });
  if (request.method === "initialize") return reply({ protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "tjlabs-haystack-workspace", version: "0.2.0" } });
  if (request.method === "ping") return reply({});
  if (request.method === "tools/list") return reply({ tools: tools.map(({ action, ...tool }) => tool) });
  if (request.method !== "tools/call") return error(-32601, "Method not found");
  const tool = tools.find(item => item.name === request.params?.name);
  if (!tool) return error(-32602, "Unknown Haystack tool");
  try {
    const result = await workspace.dispatch(tool.action, request.params?.arguments ?? {});
    return reply({ content: [{ type: "text", text: stringifyJson(result) }], structuredContent: result, isError: false });
  } catch (failure) {
    const result = { error: failure.message, code: failure.code || "HAYSTACK_INTERNAL", status: failure.status || 500, ...(failure.details ? { details: failure.details } : {}) };
    return reply({ content: [{ type: "text", text: stringifyJson(result) }], structuredContent: result, isError: true });
  }
}
export async function serveStdio(workspace, { input = process.stdin, output = process.stdout } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let result;
    try { result = await handleRpc(workspace, JSON.parse(line)); }
    catch { result = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }; }
    if (result) await new Promise((resolve, reject) => output.write(stringifyJson(result) + "\n", error => error ? reject(error) : resolve()));
  }
}
