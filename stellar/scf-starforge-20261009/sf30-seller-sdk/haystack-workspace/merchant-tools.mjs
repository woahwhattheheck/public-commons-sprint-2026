import { tools as nativeTools } from "./catalog.mjs";
const alias = { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const workspace = { workspace: alias };
const read = { readOnly: true, idempotent: true }, write = { idempotent: true };
const file = { input: alias, expectedSha256: hash };
const jsonRange = { offset: { type: "integer", minimum: 0 }, length: { type: "integer", minimum: 1, maximum: 4194304 }, expectedResponseSha256: hash };
export const HAYSTACK_SEMANTIC_READ_ACTIONS = nativeTools.filter(value => !value.annotations?.readOnlyHint ? false :
  value.action.startsWith("semantic.") && (value.action.endsWith(".list") || value.action.endsWith(".read") || ["semantic.catalog", "semantic.model.compare"].includes(value.action)) &&
  !["semantic.source.read", "semantic.output.read"].includes(value.action)).map(value => value.action);
function fileAction(tool, action, description) {
  const native = nativeTools.find(value => value.action === action);
  if (!native) throw new Error("The selected original Haystack catalog lacks " + action + ".");
  const { base64, name, format, delimiter, ...properties } = native.inputSchema.properties;
  return tool("merchant_haystack_" + action.replaceAll(".", "_") + "_file", description,
    { ...workspace, ...properties, ...file, ...(action === "semantic.return.preview" ? jsonRange : {}) },
    ["workspace", ...native.inputSchema.required.filter(key => !["base64", "name", "format", "delimiter"].includes(key)), "input", "expectedSha256"],
    { readOnly: native.annotations.readOnlyHint, idempotent: native.annotations.idempotentHint });
}
export const HAYSTACK_MERCHANT_REQUEST_BYTES = 8 * 1024 * 1024;
export const HAYSTACK_MERCHANT_RESPONSE_BYTES = 8 * 1024 * 1024;
export function haystackWorkspaceTools(tool) {
  return [
    tool("merchant_haystack_workspaces", "List complete configured native building-workspace and source-file aliases.", {}, [], read),
    tool("merchant_haystack_connection", "Inspect the original running application's current identity.", workspace, ["workspace"], read),
    tool("merchant_haystack_reconnect", "Attach the explicitly selected current instance of the same original workspace after restart.", { ...workspace, expectedInstanceId: { type: "string" } }, ["workspace", "expectedInstanceId"], write),
    ...nativeTools.map(native => tool("merchant_" + native.name, native.description + " Uses the configured original workspace alias.",
      { ...workspace, ...native.inputSchema.properties }, ["workspace", ...native.inputSchema.required],
      { readOnly: native.annotations.readOnlyHint, idempotent: native.annotations.idempotentHint })),
    tool("merchant_haystack_input", "Read source-file alias metadata after checking its full original SHA-256.", { ...workspace, input: alias, expectedSha256: hash }, ["workspace", "input"], read),
    tool("merchant_haystack_import_file", "Import one complete host-selected original Haystack JSON v4 grid with exact-request recovery.", {
      ...workspace, operationId: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 },
      input: alias, expectedSha256: hash, sourceUrl: { type: "string" }, select: { type: "boolean" }
    }, ["workspace", "operationId", "expectedRevision", "input", "expectedSha256"], write),
    tool("merchant_haystack_semantic_read", "Read a complete original semantic JSON view through content-bound byte ranges. Keep the same action, arguments, workspace revision and returned SHA-256 for every range, then decode the complete UTF-8 JSON.",
      { ...workspace, action: { type: "string", enum: HAYSTACK_SEMANTIC_READ_ACTIONS }, args: { type: "object" }, ...jsonRange }, ["workspace", "action", "args"], read),
    fileAction(tool, "semantic.intake.import", "Import the complete pinned CSV/TSV through the original native point-list inspector; its declared format, delimiter, source and request identity remain exact."),
    fileAction(tool, "semantic.return.preview", "Read the complete pinned contractor workspace and compare every returned model against its exact current local heads. Optional offset/length returns the complete original JSON view in SHA-bound ranges for large comparisons."),
    fileAction(tool, "semantic.return.apply", "Apply the complete explicitly reviewed keep/adopt decisions from the same pinned returned workspace, retaining both histories and the original request."),
    tool("merchant_haystack_cancel", "Cancel an active local wait and retain its original native operation for outcome recovery.", { ...workspace, operationId: { type: "string" } }, ["workspace", "operationId"], write)
  ];
}
