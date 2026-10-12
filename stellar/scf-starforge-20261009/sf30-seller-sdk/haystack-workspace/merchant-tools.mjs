import { tools as nativeTools } from "./catalog.mjs";
const alias = { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const workspace = { workspace: alias };
const read = { readOnly: true, idempotent: true }, write = { idempotent: true };
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
    tool("merchant_haystack_cancel", "Cancel an active local wait and retain its original native operation for outcome recovery.", { ...workspace, operationId: { type: "string" } }, ["workspace", "operationId"], write)
  ];
}
